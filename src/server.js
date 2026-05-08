process.env.TZ = process.env.TZ || "America/Santiago";

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");

const { demoAccounts, quickChecks, roles, workflowSteps } = require("./data/app-content");
const { DEFAULT_SYSTEM_SETTINGS } = require("./data/default-settings");
const {
  closePool,
  getLookupId,
  initializeDatabase,
  insertAuditLog,
  insertTicketHistory,
  query,
  upsertCompany,
  upsertPerson,
  withTransaction,
} = require("./db");
const { toCsv } = require("./lib/csv");
const { buildPasswordPolicySummary, validatePasswordWithPolicy } = require("./lib/password-policy");
const { extractRutFromText, formatRut, isValidRut, normalizeRut, splitFullName } = require("./lib/rut");
const { createStoredFileName, ensureUploadsDir, uploadsRoot } = require("./lib/uploads");

const app = express();
const PORT = Number(process.env.PORT || 2000);
const SESSION_COOKIE_NAME = "fix_access_session";
const CSRF_COOKIE_NAME = "fix_access_csrf";
const SESSION_SECRET = process.env.SESSION_SECRET || "fix-access-demo-secret";
const FALLBACK_SESSION_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS || 30 * 60 * 1000);
const DEFAULT_WEBHOOK_TOKEN = process.env.EMAIL_INTAKE_TOKEN || "";

let initializationPromise = null;
let serverInstance = null;
const loginAttemptStore = new Map();

const roleExperience = {
  ADMIN: {
    heading: "Panel del administrador",
    description:
      "Controlas usuarios, reportes, trazabilidad, tickets, solicitudes urgentes y todo el historial de accesos.",
    modules: [
      "Gestion de usuarios y roles",
      "Auditoria completa del sistema",
      "Reportes de tickets y accesos",
      "Visibilidad transversal de la operacion",
    ],
    sections: {
      userAdmin: true,
      roles: true,
      workflow: true,
      tickets: true,
      access: true,
      requests: true,
      creatorTools: true,
      verifierTools: true,
      reports: true,
    },
    tableTitle: "Tickets del sistema",
    tableDescription: "Vista global del proceso con filtros, estados y trazabilidad.",
  },
  TICKET_CREATOR: {
    heading: "Panel del creador de ticket",
    description:
      "Registras visitas, respondes solicitudes urgentes y corriges tickets observados antes de reenviarlos a verificacion.",
    modules: [
      "Crear ticket manual o desde solicitud",
      "Responder solicitudes del operador",
      "Editar tickets observados",
      "Enviar tickets al verificador",
    ],
    sections: {
      roles: false,
      workflow: true,
      tickets: true,
      access: false,
      requests: true,
      creatorTools: true,
      verifierTools: false,
      reports: false,
      userAdmin: false,
    },
    tableTitle: "Tickets creados y en seguimiento",
    tableDescription: "Aqui ves tickets pendientes, observados, aprobados, vencidos o ya cerrados.",
  },
  TICKET_VERIFIER: {
    heading: "Panel del verificador",
    description:
      "Revisas cada ticket, dejas observaciones y decides si la visita puede ser autorizada para ingreso.",
    modules: [
      "Cola de revision pendiente",
      "Aprobacion, observacion o rechazo",
      "Historial reciente de decisiones",
      "Seguimiento del estado del ticket",
    ],
    sections: {
      roles: false,
      workflow: true,
      tickets: true,
      access: false,
      requests: false,
      creatorTools: false,
      verifierTools: true,
      reports: false,
      userAdmin: false,
    },
    tableTitle: "Historial de verificacion",
    tableDescription: "Registro de tickets con sus decisiones y notas del proceso de validacion.",
  },
  OPERATOR: {
    heading: "Panel del operador",
    description:
      "Consultas acceso por RUT o escaneo demo, registras entradas y salidas y elevas solicitudes urgentes desde porteria.",
    modules: [
      "Busqueda por RUT",
      "Escaneo demo de carnet",
      "Registro de entrada y salida",
      "Solicitud urgente sin autorizacion vigente",
    ],
    sections: {
      roles: false,
      workflow: false,
      tickets: true,
      access: true,
      requests: true,
      creatorTools: false,
      verifierTools: false,
      reports: false,
      userAdmin: false,
    },
    tableTitle: "Tickets operativos",
    tableDescription: "Visitas visibles para el turno y su impacto directo en la atencion de porteria.",
  },
};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

ensureUploadsDir();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      ensureUploadsDir();
      callback(null, uploadsRoot);
    },
    filename(_req, file, callback) {
      callback(null, createStoredFileName(file.originalname));
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5,
  },
});

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function appendSetCookie(res, cookieValue) {
  const currentValue = res.getHeader("Set-Cookie");
  if (!currentValue) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }

  const nextValue = Array.isArray(currentValue) ? [...currentValue, cookieValue] : [currentValue, cookieValue];
  res.setHeader("Set-Cookie", nextValue);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "1" || value === 1 || value === "on" || value === "yes") {
    return true;
  }

  if (value === "false" || value === "0" || value === 0 || value === "off" || value === "no") {
    return false;
  }

  return fallback;
}

function mergeSettingsSection(defaultSection, loadedSection = {}) {
  return Object.entries(defaultSection).reduce((accumulator, [key, value]) => {
    const loadedValue = loadedSection[key];
    if (typeof value === "boolean") {
      accumulator[key] = normalizeBoolean(loadedValue, value);
      return accumulator;
    }

    if (typeof value === "number") {
      const numericValue = Number(loadedValue);
      accumulator[key] = Number.isFinite(numericValue) ? numericValue : value;
      return accumulator;
    }

    accumulator[key] =
      loadedValue !== undefined && loadedValue !== null && String(loadedValue).trim() !== ""
        ? loadedValue
        : value;
    return accumulator;
  }, {});
}

async function getSystemSettings() {
  const result = await query("SELECT key, value FROM system_settings");
  const loaded = result.rows.reduce((accumulator, row) => {
    accumulator[row.key] = row.value || {};
    return accumulator;
  }, {});

  return {
    OPERATION: mergeSettingsSection(DEFAULT_SYSTEM_SETTINGS.OPERATION, loaded.OPERATION),
    SECURITY: mergeSettingsSection(DEFAULT_SYSTEM_SETTINGS.SECURITY, loaded.SECURITY),
    EMAIL_INTAKE: mergeSettingsSection(DEFAULT_SYSTEM_SETTINGS.EMAIL_INTAKE, loaded.EMAIL_INTAKE),
  };
}

function getSessionTimeoutMs(settings) {
  const configuredMinutes = Number(settings?.SECURITY?.sessionTimeoutMinutes || 0);
  if (configuredMinutes > 0) {
    return configuredMinutes * 60 * 1000;
  }

  return FALLBACK_SESSION_TIMEOUT_MS;
}

function getCookieSecureValue(settings) {
  if (normalizeBoolean(process.env.COOKIE_SECURE, false)) {
    return true;
  }

  if (String(process.env.NODE_ENV || "").trim() === "production") {
    return true;
  }

  return normalizeBoolean(settings?.SECURITY?.secureCookies, false);
}

function getClientAddress(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || req.ip || "unknown";
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, chunk) => {
      const separatorIndex = chunk.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = chunk.slice(0, separatorIndex);
      const value = chunk.slice(separatorIndex + 1);
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function signValue(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function createSignedToken(rawValue, scope) {
  return `${rawValue}.${signValue(`${scope}:${rawValue}`)}`;
}

function readSignedToken(signedValue, scope) {
  if (!signedValue || !signedValue.includes(".")) {
    return "";
  }

  const [rawValue, signature] = String(signedValue).split(".");
  if (signValue(`${scope}:${rawValue}`) !== signature) {
    return "";
  }

  return rawValue;
}

function createSessionCookieValue(user) {
  const payload = Buffer.from(
    JSON.stringify({
      userId: user.id,
      username: user.username,
      lastActivityAt: Date.now(),
    })
  ).toString("base64url");

  return `${payload}.${signValue(payload)}`;
}

function readSessionPayload(sessionValue) {
  if (!sessionValue || !sessionValue.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = sessionValue.split(".");
  if (signValue(encodedPayload) !== signature) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function setSessionCookie(res, user, settings) {
  const value = createSessionCookieValue(user);
  const secureFlag = getCookieSecureValue(settings) ? "; Secure" : "";
  appendSetCookie(
    res,
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      getSessionTimeoutMs(settings) / 1000
    )}${secureFlag}`
  );
}

function clearSessionCookie(res, settings) {
  const secureFlag = getCookieSecureValue(settings) ? "; Secure" : "";
  appendSetCookie(
    res,
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`
  );
}

function setCsrfCookie(res, csrfToken, settings) {
  const secureFlag = getCookieSecureValue(settings) ? "; Secure" : "";
  appendSetCookie(
    res,
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(createSignedToken(csrfToken, "csrf"))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      getSessionTimeoutMs(settings) / 1000
    )}${secureFlag}`
  );
}

function clearCsrfCookie(res, settings) {
  const secureFlag = getCookieSecureValue(settings) ? "; Secure" : "";
  appendSetCookie(
    res,
    `${CSRF_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`
  );
}

function roleLabel(code) {
  const role = roles.find((item) => item.code === code);
  return role ? role.name : code;
}

function statusPillClass(code) {
  return String(code || "").toLowerCase();
}

function buildFullName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ");
}

function formatDateTime(value) {
  if (!value) {
    return "Sin registro";
  }

  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDateOnly(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatDateTimeForInput(value) {
  if (!value) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(value)).reduce((accumulator, part) => {
    accumulator[part.type] = part.value;
    return accumulator;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function parseDateTimeLocal(value) {
  const date = new Date(String(value || "").trim());
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function buildOperationWindow() {
  return {
    label: formatDateTime(new Date()),
    now: new Date().toISOString(),
  };
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function buildDisplayNote(ticket) {
  return (
    ticket.verificationNotes ||
    ticket.rejectionReason ||
    ticket.ticketNotes ||
    "Sin observaciones registradas."
  );
}

function buildReportFilters(queryString) {
  return {
    rut: String(queryString.rut || "").trim(),
    company: String(queryString.company || "").trim(),
    hostName: String(queryString.hostName || "").trim(),
    status: String(queryString.status || "").trim(),
    from: String(queryString.from || "").trim(),
    to: String(queryString.to || "").trim(),
    requestStatus: String(queryString.requestStatus || "").trim(),
  };
}

function applyDateFilters(dateValue, filters) {
  if (!filters.from && !filters.to) {
    return true;
  }

  const candidate = new Date(dateValue);
  if (Number.isNaN(candidate.getTime())) {
    return false;
  }

  if (filters.from) {
    const fromDate = new Date(`${filters.from}T00:00:00`);
    if (candidate < fromDate) {
      return false;
    }
  }

  if (filters.to) {
    const toDate = new Date(`${filters.to}T23:59:59`);
    if (candidate > toDate) {
      return false;
    }
  }

  return true;
}

function filterTickets(tickets, filters) {
  return tickets.filter((ticket) => {
    if (filters.status && ticket.statusCode !== filters.status) {
      return false;
    }

    if (filters.rut && !normalizeRut(ticket.person.rut).includes(normalizeRut(filters.rut))) {
      return false;
    }

    if (filters.company && !ticket.company.toLowerCase().includes(filters.company.toLowerCase())) {
      return false;
    }

    if (filters.hostName && !ticket.hostName.toLowerCase().includes(filters.hostName.toLowerCase())) {
      return false;
    }

    return applyDateFilters(ticket.scheduledEntryAt, filters);
  });
}

function filterRequests(requests, filters) {
  return requests.filter((request) => {
    if (filters.requestStatus && request.statusCode !== filters.requestStatus) {
      return false;
    }

    if (filters.rut && !normalizeRut(request.rut).includes(normalizeRut(filters.rut))) {
      return false;
    }

    if (filters.company && !String(request.company || "").toLowerCase().includes(filters.company.toLowerCase())) {
      return false;
    }

    return applyDateFilters(request.createdAt, filters);
  });
}

function filterEvents(events, filters) {
  return events.filter((event) => {
    if (filters.rut && !normalizeRut(event.rut || "").includes(normalizeRut(filters.rut))) {
      return false;
    }

    if (filters.company && !String(event.company || "").toLowerCase().includes(filters.company.toLowerCase())) {
      return false;
    }

    if (filters.hostName && !String(event.hostName || "").toLowerCase().includes(filters.hostName.toLowerCase())) {
      return false;
    }

    return applyDateFilters(event.observedAt, filters);
  });
}

function filterAuditLogs(logs, filters) {
  return logs.filter((log) => {
    if (filters.from || filters.to) {
      return applyDateFilters(log.createdAt, filters);
    }

    return true;
  });
}

function buildQuerySuffix(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      searchParams.set(key, String(value));
    }
  });
  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
}

function redirectToDashboard(res, params = {}, hash = "") {
  res.redirect(`/dashboard${buildQuerySuffix(params)}${hash}`);
}

function getPasswordPolicy(settings) {
  return {
    minPasswordLength: Number(settings.SECURITY.minPasswordLength || DEFAULT_SYSTEM_SETTINGS.SECURITY.minPasswordLength),
    requireUppercase: normalizeBoolean(
      settings.SECURITY.requireUppercase,
      DEFAULT_SYSTEM_SETTINGS.SECURITY.requireUppercase
    ),
    requireLowercase: normalizeBoolean(
      settings.SECURITY.requireLowercase,
      DEFAULT_SYSTEM_SETTINGS.SECURITY.requireLowercase
    ),
    requireDigit: normalizeBoolean(settings.SECURITY.requireDigit, DEFAULT_SYSTEM_SETTINGS.SECURITY.requireDigit),
    requireSpecialChar: normalizeBoolean(
      settings.SECURITY.requireSpecialChar,
      DEFAULT_SYSTEM_SETTINGS.SECURITY.requireSpecialChar
    ),
  };
}

function getCsrfTokenFromRequest(req) {
  const bodyToken =
    req.body && typeof req.body === "object" && req.body !== null ? String(req.body.csrfToken || "") : "";
  const queryToken =
    req.query && typeof req.query === "object" && req.query !== null ? String(req.query.csrfToken || "") : "";
  const headerToken = String(req.headers["x-csrf-token"] || "");
  return bodyToken || queryToken || headerToken;
}

function sanitizeEmailIntakeQuery(input = {}) {
  return {
    senderName: String(input.senderName || "").trim(),
    senderEmail: String(input.senderEmail || "").trim(),
    subject: String(input.subject || "").trim(),
    body: String(input.body || "").trim(),
    companyName: String(input.companyName || "").trim(),
    requestedRut: String(input.requestedRut || "").trim(),
    requestedFirstName: String(input.requestedFirstName || "").trim(),
    requestedLastName: String(input.requestedLastName || "").trim(),
    emailHostName: String(input.hostName || input.emailHostName || "").trim(),
    emailActivityDescription: String(input.activityDescription || input.emailActivityDescription || "").trim(),
    emailDesiredEntryAt: String(input.desiredEntryAt || input.emailDesiredEntryAt || "").trim(),
    emailDesiredExitAt: String(input.desiredExitAt || input.emailDesiredExitAt || "").trim(),
    emailNotes: String(input.notes || input.emailNotes || "").trim(),
  };
}

function registerLoginFailure(req, username, settings) {
  const key = `${getClientAddress(req)}::${String(username || "").trim().toLowerCase()}`;
  const current = loginAttemptStore.get(key) || {
    attempts: 0,
    blockedUntil: 0,
  };
  current.attempts += 1;

  const maxAttempts = Number(settings.SECURITY.maxLoginAttempts || DEFAULT_SYSTEM_SETTINGS.SECURITY.maxLoginAttempts);
  const lockoutMinutes = Number(settings.SECURITY.lockoutMinutes || DEFAULT_SYSTEM_SETTINGS.SECURITY.lockoutMinutes);
  if (current.attempts >= maxAttempts) {
    current.blockedUntil = Date.now() + lockoutMinutes * 60 * 1000;
    current.attempts = 0;
  }

  loginAttemptStore.set(key, current);
  return current;
}

function clearLoginFailures(req, username) {
  const key = `${getClientAddress(req)}::${String(username || "").trim().toLowerCase()}`;
  loginAttemptStore.delete(key);
}

function getLoginBlockState(req, username) {
  const key = `${getClientAddress(req)}::${String(username || "").trim().toLowerCase()}`;
  const current = loginAttemptStore.get(key);
  if (!current) {
    return {
      blocked: false,
      remainingMinutes: 0,
    };
  }

  if (current.blockedUntil && current.blockedUntil > Date.now()) {
    return {
      blocked: true,
      remainingMinutes: Math.ceil((current.blockedUntil - Date.now()) / 60000),
    };
  }

  if (current.blockedUntil && current.blockedUntil <= Date.now()) {
    loginAttemptStore.delete(key);
  }

  return {
    blocked: false,
    remainingMinutes: 0,
  };
}

async function listEmailIntakeRequests() {
  const result = await query(
    `
      SELECT
        intake.id,
        intake.intake_code,
        intake.sender_name,
        intake.sender_email,
        intake.subject,
        intake.body,
        intake.company_name,
        intake.requested_rut,
        intake.requested_first_name,
        intake.requested_last_name,
        intake.host_name,
        intake.activity_description,
        intake.desired_entry_at,
        intake.desired_exit_at,
        intake.notes,
        intake.created_at,
        intake.updated_at,
        status.code AS status_code,
        status.name AS status_name,
        CONCAT_WS(' ', creator.first_name, creator.last_name) AS assigned_creator_name,
        ticket.ticket_code AS related_ticket_code
      FROM email_intake_requests intake
      JOIN email_intake_statuses status ON status.id = intake.status_id
      LEFT JOIN users creator ON creator.id = intake.assigned_creator_user_id
      LEFT JOIN access_tickets ticket ON ticket.id = intake.related_ticket_id
      ORDER BY intake.created_at DESC, intake.intake_code DESC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    intakeCode: row.intake_code,
    senderName: row.sender_name || "",
    senderEmail: row.sender_email,
    subject: row.subject,
    body: row.body,
    companyName: row.company_name || "",
    requestedRut: row.requested_rut ? formatRut(row.requested_rut) : "",
    requestedFirstName: row.requested_first_name || "",
    requestedLastName: row.requested_last_name || "",
    requestedFullName: buildFullName(row.requested_first_name, row.requested_last_name),
    hostName: row.host_name || "",
    activityDescription: row.activity_description || "",
    desiredEntryAt: row.desired_entry_at,
    desiredExitAt: row.desired_exit_at,
    desiredEntryLabel: row.desired_entry_at ? formatDateTime(row.desired_entry_at) : "Sin fecha",
    desiredExitLabel: row.desired_exit_at ? formatDateTime(row.desired_exit_at) : "Sin fecha",
    notes: row.notes || "",
    statusCode: row.status_code,
    statusLabel: row.status_name,
    statusClass: statusPillClass(row.status_code),
    assignedCreatorName: row.assigned_creator_name || "Sin asignar",
    relatedTicketCode: row.related_ticket_code || "",
    createdAt: row.created_at,
    createdAtLabel: formatDateTime(row.created_at),
  }));
}

async function listAttachments() {
  const result = await query(
    `
      SELECT
        att.id,
        att.entity_type,
        att.entity_id,
        att.original_name,
        att.stored_name,
        att.mime_type,
        att.size_bytes,
        att.file_path,
        att.created_at,
        CONCAT_WS(' ', creator.first_name, creator.last_name) AS created_by_name
      FROM attachments att
      LEFT JOIN users creator ON creator.id = att.created_by_user_id
      ORDER BY att.created_at DESC, att.id DESC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType: row.mime_type || "application/octet-stream",
    sizeBytes: Number(row.size_bytes || 0),
    sizeLabel: `${Math.max(1, Math.round(Number(row.size_bytes || 0) / 1024))} KB`,
    filePath: row.file_path,
    createdAt: row.created_at,
    createdAtLabel: formatDateTime(row.created_at),
    createdByName: row.created_by_name || "Sistema",
    downloadUrl: `/attachments/${row.id}/download`,
  }));
}

function groupAttachmentsByEntity(attachments, entityType) {
  return attachments
    .filter((attachment) => attachment.entityType === entityType)
    .reduce((accumulator, attachment) => {
      if (!accumulator[attachment.entityId]) {
        accumulator[attachment.entityId] = [];
      }
      accumulator[attachment.entityId].push(attachment);
      return accumulator;
    }, {});
}

async function persistAttachments(client, entityType, entityId, files, createdByUserId) {
  for (const file of files || []) {
    await client.query(
      `
        INSERT INTO attachments (
          entity_type,
          entity_id,
          original_name,
          stored_name,
          mime_type,
          size_bytes,
          file_path,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        entityType,
        entityId,
        file.originalname,
        file.filename,
        file.mimetype,
        file.size,
        file.path,
        createdByUserId || null,
      ]
    );
  }
}

function removeUploadedFiles(files) {
  for (const file of files || []) {
    if (file && file.path) {
      fs.rmSync(file.path, { force: true });
    }
  }
}

function getAcceptedFileTypes(settings) {
  return String(settings.EMAIL_INTAKE.acceptedFileTypes || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function saveSystemSettings(sectionKey, nextValue, currentUser) {
  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE system_settings
        SET value = $2::jsonb, updated_by = $3, updated_at = CURRENT_TIMESTAMP
        WHERE key = $1
      `,
      [sectionKey, JSON.stringify(nextValue), currentUser.id]
    );

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "SYSTEM_SETTINGS",
      entityId: null,
      action: `UPDATE_${sectionKey}`,
      details: nextValue,
    });
  });
}

function mapTicketRow(row) {
  return {
    id: row.id,
    ticketCode: row.ticket_code,
    statusCode: row.status_code,
    statusLabel: row.status_name,
    statusClass: statusPillClass(row.status_code),
    person: {
      id: row.person_id,
      rut: formatRut(row.person_rut),
      firstName: row.person_first_name,
      lastName: row.person_last_name,
      fullName: buildFullName(row.person_first_name, row.person_last_name),
    },
    company: row.company_name || "Sin empresa",
    hostName: row.host_name,
    activityDescription: row.activity_description,
    scheduledEntryAt: row.scheduled_entry_at,
    scheduledExitAt: row.scheduled_exit_at,
    scheduledEntryLabel: formatDateTime(row.scheduled_entry_at),
    scheduledExitLabel: formatDateTime(row.scheduled_exit_at),
    creatorName: row.creator_name,
    verifierName: row.verifier_name,
    ticketNotes: row.ticket_notes || "",
    verificationNotes: row.verification_notes || "",
    rejectionReason: row.rejection_reason || "",
    relatedRequestCode: row.related_request_code || "",
    createdAt: row.created_at,
    createdAtLabel: formatDateTime(row.created_at),
    updatedAt: row.updated_at,
  };
}

function mapRequestRow(row) {
  return {
    id: row.id,
    requestCode: row.request_code,
    rut: formatRut(row.requested_rut),
    firstName: row.requested_first_name,
    lastName: row.requested_last_name,
    fullName: buildFullName(row.requested_first_name, row.requested_last_name),
    company: row.company_name || "",
    hostName: row.host_name || "",
    activityDescription: row.activity_description || "",
    desiredEntryAt: row.desired_entry_at,
    desiredExitAt: row.desired_exit_at,
    desiredEntryLabel: row.desired_entry_at ? formatDateTime(row.desired_entry_at) : "Sin fecha",
    desiredExitLabel: row.desired_exit_at ? formatDateTime(row.desired_exit_at) : "Sin fecha",
    statusCode: row.status_code,
    statusLabel: row.status_name,
    statusClass: statusPillClass(row.status_code),
    operatorName: row.operator_name,
    respondedByName: row.responded_by_name || "Pendiente",
    notes: row.operator_notes || "",
    responseNotes: row.response_notes || "",
    relatedTicketCode: row.related_ticket_code || "",
    createdAt: row.created_at,
    createdAtLabel: formatDateTime(row.created_at),
  };
}

function mapUserRow(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: buildFullName(row.first_name, row.last_name),
    email: row.email || "Sin correo",
    roleCode: row.role_code,
    roleName: row.role_name,
    statusCode: row.is_active ? "ACTIVE" : "BLOCKED",
    statusLabel: row.is_active ? "Activa" : "Bloqueada",
    statusClass: row.is_active ? "active" : "blocked",
    createdBy: row.created_by_name || "Sistema",
    createdAt: row.created_at,
    createdAtLabel: formatDateTime(row.created_at),
  };
}

function mapAccessEventRow(row) {
  return {
    id: row.id,
    ticketCode: row.ticket_code || "-",
    rut: row.person_rut ? formatRut(row.person_rut) : "",
    personName: row.person_full_name || "Sin coincidencia",
    company: row.company_name || "Sin empresa",
    hostName: row.host_name || "",
    eventTypeCode: row.event_type_code,
    eventTypeLabel: row.event_type_name,
    sourceCode: row.source_code,
    sourceLabel: row.source_name,
    operatorName: row.operator_name,
    notes: row.notes || "",
    observedAt: row.observed_at,
    observedAtLabel: formatDateTime(row.observed_at),
  };
}

function mapAuditLogRow(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    details: row.details || {},
    detailsText: JSON.stringify(row.details || {}),
    userName: row.user_name || "Sistema",
    createdAt: row.created_at,
    createdAtLabel: formatDateTime(row.created_at),
  };
}

async function getUserByUsername(username) {
  const result = await query(
    `
      SELECT
        u.id,
        u.username,
        u.email,
        u.password_hash,
        u.first_name,
        u.last_name,
        u.is_active,
        u.created_at,
        r.code AS role_code,
        r.name AS role_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE LOWER(u.username) = LOWER($1)
      LIMIT 1
    `,
    [String(username || "").trim()]
  );

  return result.rows[0]
    ? {
        id: result.rows[0].id,
        username: result.rows[0].username,
        email: result.rows[0].email,
        passwordHash: result.rows[0].password_hash,
        firstName: result.rows[0].first_name,
        lastName: result.rows[0].last_name,
        fullName: buildFullName(result.rows[0].first_name, result.rows[0].last_name),
        roleCode: result.rows[0].role_code,
        roleName: result.rows[0].role_name,
        isActive: result.rows[0].is_active,
      }
    : null;
}

async function getUserById(id) {
  const result = await query(
    `
      SELECT
        u.id,
        u.username,
        u.email,
        u.password_hash,
        u.first_name,
        u.last_name,
        u.is_active,
        u.created_at,
        r.code AS role_code,
        r.name AS role_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0]
    ? {
        id: result.rows[0].id,
        username: result.rows[0].username,
        email: result.rows[0].email,
        passwordHash: result.rows[0].password_hash,
        firstName: result.rows[0].first_name,
        lastName: result.rows[0].last_name,
        fullName: buildFullName(result.rows[0].first_name, result.rows[0].last_name),
        roleCode: result.rows[0].role_code,
        roleName: result.rows[0].role_name,
        isActive: result.rows[0].is_active,
      }
    : null;
}

async function listManagedUsers() {
  const result = await query(
    `
      SELECT
        u.id,
        u.username,
        u.email,
        u.first_name,
        u.last_name,
        u.is_active,
        u.created_at,
        r.code AS role_code,
        r.name AS role_name,
        CONCAT_WS(' ', creator.first_name, creator.last_name) AS created_by_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN users creator ON creator.id = u.created_by
      ORDER BY u.first_name ASC, u.last_name ASC
    `
  );

  return result.rows.map(mapUserRow);
}

async function listTickets() {
  const result = await query(
    `
      SELECT
        t.id,
        t.ticket_code,
        p.id AS person_id,
        p.rut AS person_rut,
        p.first_name AS person_first_name,
        p.last_name AS person_last_name,
        c.name AS company_name,
        t.host_name,
        t.activity_description,
        t.scheduled_entry_at,
        t.scheduled_exit_at,
        ts.code AS status_code,
        ts.name AS status_name,
        t.ticket_notes,
        t.verification_notes,
        t.rejection_reason,
        CONCAT_WS(' ', creator.first_name, creator.last_name) AS creator_name,
        CONCAT_WS(' ', verifier.first_name, verifier.last_name) AS verifier_name,
        req.request_code AS related_request_code,
        t.created_at,
        t.updated_at
      FROM access_tickets t
      JOIN people p ON p.id = t.person_id
      LEFT JOIN companies c ON c.id = t.company_id
      JOIN ticket_statuses ts ON ts.id = t.status_id
      JOIN users creator ON creator.id = t.creator_user_id
      LEFT JOIN users verifier ON verifier.id = t.verifier_user_id
      LEFT JOIN operator_access_requests req ON req.related_ticket_id = t.id
      ORDER BY t.created_at DESC, t.ticket_code DESC
    `
  );

  return result.rows.map(mapTicketRow);
}

async function listOperatorRequests() {
  const result = await query(
    `
      SELECT
        req.id,
        req.request_code,
        req.requested_rut,
        req.requested_first_name,
        req.requested_last_name,
        req.company_name,
        req.host_name,
        req.activity_description,
        req.desired_entry_at,
        req.desired_exit_at,
        req.operator_notes,
        req.response_notes,
        req.created_at,
        ors.code AS status_code,
        ors.name AS status_name,
        CONCAT_WS(' ', operator_user.first_name, operator_user.last_name) AS operator_name,
        CONCAT_WS(' ', responder.first_name, responder.last_name) AS responded_by_name,
        ticket.ticket_code AS related_ticket_code
      FROM operator_access_requests req
      JOIN operator_request_statuses ors ON ors.id = req.status_id
      JOIN users operator_user ON operator_user.id = req.operator_user_id
      LEFT JOIN users responder ON responder.id = req.responded_by_user_id
      LEFT JOIN access_tickets ticket ON ticket.id = req.related_ticket_id
      ORDER BY req.created_at DESC, req.request_code DESC
    `
  );

  return result.rows.map(mapRequestRow);
}

async function listAccessEvents() {
  const result = await query(
    `
      SELECT
        ae.id,
        ae.notes,
        ae.observed_at,
        ticket.ticket_code,
        person.rut AS person_rut,
        CONCAT_WS(' ', person.first_name, person.last_name) AS person_full_name,
        company.name AS company_name,
        ticket.host_name,
        aet.code AS event_type_code,
        aet.name AS event_type_name,
        src.code AS source_code,
        src.name AS source_name,
        CONCAT_WS(' ', operator_user.first_name, operator_user.last_name) AS operator_name
      FROM access_events ae
      JOIN access_event_types aet ON aet.id = ae.event_type_id
      JOIN access_sources src ON src.id = ae.source_id
      JOIN users operator_user ON operator_user.id = ae.operator_user_id
      LEFT JOIN access_tickets ticket ON ticket.id = ae.ticket_id
      LEFT JOIN people person ON person.id = ae.person_id
      LEFT JOIN companies company ON company.id = COALESCE(ticket.company_id, person.company_id)
      ORDER BY ae.observed_at DESC, ae.id DESC
    `
  );

  return result.rows.map(mapAccessEventRow);
}

async function listAuditLogs() {
  const result = await query(
    `
      SELECT
        audit.id,
        audit.entity_type,
        audit.entity_id,
        audit.action,
        audit.details,
        audit.created_at,
        CONCAT_WS(' ', actor.first_name, actor.last_name) AS user_name
      FROM audit_logs audit
      LEFT JOIN users actor ON actor.id = audit.user_id
      ORDER BY audit.created_at DESC, audit.id DESC
    `
  );

  return result.rows.map(mapAuditLogRow);
}

async function getTicketByCode(ticketCode) {
  const tickets = await listTickets();
  return tickets.find((ticket) => ticket.ticketCode === ticketCode) || null;
}

async function getRequestByCode(requestCode) {
  const requests = await listOperatorRequests();
  return requests.find((request) => request.requestCode === requestCode) || null;
}

async function syncExpiredTickets() {
  await withTransaction(async (client) => {
    const staleResult = await client.query(
      `
        SELECT
          t.id,
          t.ticket_code,
          ts.code AS status_code
        FROM access_tickets t
        JOIN ticket_statuses ts ON ts.id = t.status_id
        WHERE
          ts.code IN ('PENDIENTE_VERIFICACION', 'APROBADO', 'OBSERVADO')
          AND t.scheduled_exit_at < CURRENT_TIMESTAMP
      `
    );

    if (!staleResult.rows.length) {
      return;
    }

    const expiredStatusId = await getLookupId(client, "ticket_statuses", "VENCIDO");
    for (const row of staleResult.rows) {
      await client.query(
        `
          UPDATE access_tickets
          SET status_id = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [row.id, expiredStatusId]
      );
      await insertTicketHistory(client, row.id, row.status_code, "VENCIDO", null, "Ticket vencido automaticamente por horario.");
      await insertAuditLog(client, {
        userId: null,
        entityType: "TICKET",
        entityId: row.id,
        action: "AUTO_EXPIRE_TICKET",
        details: {
          ticketCode: row.ticket_code,
        },
      });
    }
  });
}

function findOpenVisit(accessEvents, ticketId) {
  const timeline = accessEvents
    .filter((event) => event.ticketCode !== "-" && ticketId && event.ticketCode === ticketId)
    .sort((left, right) => new Date(left.observedAt) - new Date(right.observedAt));

  let openVisit = null;
  for (const event of timeline) {
    if (event.eventTypeCode === "CHECK_IN") {
      openVisit = event;
    }
    if (event.eventTypeCode === "CHECK_OUT") {
      openVisit = null;
    }
  }

  return openVisit;
}

async function ensureNoOverlappingTicket(rut, scheduledEntryAt, scheduledExitAt, excludeTicketCode) {
  const tickets = await listTickets();
  const normalizedRut = normalizeRut(rut);
  const blockedStatuses = new Set(["RECHAZADO", "CANCELADO", "SALIDA_REGISTRADA", "VENCIDO"]);

  return tickets.find((ticket) => {
    if (excludeTicketCode && ticket.ticketCode === excludeTicketCode) {
      return false;
    }

    if (blockedStatuses.has(ticket.statusCode)) {
      return false;
    }

    if (normalizeRut(ticket.person.rut) !== normalizedRut) {
      return false;
    }

    return overlaps(
      new Date(ticket.scheduledEntryAt).getTime(),
      new Date(ticket.scheduledExitAt).getTime(),
      scheduledEntryAt.getTime(),
      scheduledExitAt.getTime()
    );
  });
}

function buildAccessDecision({ rawRut, tickets, accessEvents, settings }) {
  const normalizedRut = normalizeRut(rawRut);
  const formattedLookupRut = normalizedRut ? formatRut(normalizedRut) : "";
  const operationSettings = settings?.OPERATION || DEFAULT_SYSTEM_SETTINGS.OPERATION;
  const strictRutValidation = normalizeBoolean(operationSettings.strictRutValidation, true);
  const earlyToleranceMs = Number(operationSettings.earlyEntryToleranceMinutes || 0) * 60 * 1000;
  const lateToleranceMs = Number(operationSettings.lateExitToleranceMinutes || 0) * 60 * 1000;

  if (!normalizedRut) {
    return {
      allowed: false,
      severity: "warning",
      icon: "!",
      title: "Ingresa un RUT para consultar",
      message: "Escribe o escanea un RUT valido para revisar si la persona puede ingresar.",
      rut: "",
      personName: "Sin consulta",
      company: "No disponible",
      hostName: "No disponible",
      ticketCode: "-",
      statusLabel: "Sin consulta",
      scheduleLabel: "Sin horario autorizado",
      actionLabel: "Realizar consulta",
      canCheckIn: false,
      canCheckOut: false,
      canRequest: false,
      firstName: "",
      lastName: "",
      activityDescription: "",
      sourceCode: "RUT",
    };
  }

  if (strictRutValidation && !isValidRut(normalizedRut)) {
    return {
      allowed: false,
      severity: "denied",
      icon: "X",
      title: "RUT invalido",
      message: "El formato o digito verificador del RUT no es valido. Corrigelo antes de continuar.",
      rut: formattedLookupRut,
      personName: "No disponible",
      company: "No disponible",
      hostName: "No disponible",
      ticketCode: "-",
      statusLabel: "RUT invalido",
      scheduleLabel: "Sin horario autorizado",
      actionLabel: "Corregir RUT",
      canCheckIn: false,
      canCheckOut: false,
      canRequest: false,
      firstName: "",
      lastName: "",
      activityDescription: "",
      sourceCode: "RUT",
    };
  }

  const now = Date.now();
  const matchingTickets = tickets
    .filter((ticket) => normalizeRut(ticket.person.rut) === normalizedRut)
    .sort((left, right) => new Date(left.scheduledEntryAt) - new Date(right.scheduledEntryAt));

  const activeApproved = matchingTickets.find((ticket) => {
    if (ticket.statusCode !== "APROBADO") {
      return false;
    }

    const start = new Date(ticket.scheduledEntryAt).getTime() - earlyToleranceMs;
    const end = new Date(ticket.scheduledExitAt).getTime() + lateToleranceMs;
    return now >= start && now <= end;
  });

  const openVisit = activeApproved ? findOpenVisit(accessEvents, activeApproved.ticketCode) : null;
  if (activeApproved && openVisit) {
    return {
      allowed: true,
      severity: "allowed",
      icon: "OUT",
      title: "Persona actualmente dentro",
      message:
        "El ticket ya tiene una entrada registrada y queda habilitada la salida cuando la persona abandone las dependencias.",
      rut: activeApproved.person.rut,
      personName: activeApproved.person.fullName,
      company: activeApproved.company,
      hostName: activeApproved.hostName,
      ticketCode: activeApproved.ticketCode,
      statusLabel: "Ingreso registrado",
      scheduleLabel: `${activeApproved.scheduledEntryLabel} a ${activeApproved.scheduledExitLabel}`,
      actionLabel: "Registrar salida",
      canCheckIn: false,
      canCheckOut: true,
      canRequest: false,
      firstName: activeApproved.person.firstName,
      lastName: activeApproved.person.lastName,
      activityDescription: activeApproved.activityDescription,
      sourceCode: "RUT",
    };
  }

  if (activeApproved) {
    return {
      allowed: true,
      severity: "allowed",
      icon: "OK",
      title: "Acceso autorizado",
      message:
        "La persona cuenta con un ticket aprobado y vigente para este horario. Puedes registrar la entrada.",
      rut: activeApproved.person.rut,
      personName: activeApproved.person.fullName,
      company: activeApproved.company,
      hostName: activeApproved.hostName,
      ticketCode: activeApproved.ticketCode,
      statusLabel: activeApproved.statusLabel,
      scheduleLabel: `${activeApproved.scheduledEntryLabel} a ${activeApproved.scheduledExitLabel}`,
      actionLabel: "Registrar entrada",
      canCheckIn: true,
      canCheckOut: false,
      canRequest: false,
      firstName: activeApproved.person.firstName,
      lastName: activeApproved.person.lastName,
      activityDescription: activeApproved.activityDescription,
      sourceCode: "RUT",
    };
  }

  const pendingOrObserved = matchingTickets.find((ticket) =>
    ["PENDIENTE_VERIFICACION", "OBSERVADO"].includes(ticket.statusCode)
  );
  if (pendingOrObserved) {
    return {
      allowed: false,
      severity: "warning",
      icon: "!",
      title: "Ticket aun no habilitado",
      message:
        "Existe una solicitud en proceso, pero todavia no queda autorizada para el ingreso. Debe esperar respuesta del creador o del verificador.",
      rut: pendingOrObserved.person.rut,
      personName: pendingOrObserved.person.fullName,
      company: pendingOrObserved.company,
      hostName: pendingOrObserved.hostName,
      ticketCode: pendingOrObserved.ticketCode,
      statusLabel: pendingOrObserved.statusLabel,
      scheduleLabel: `${pendingOrObserved.scheduledEntryLabel} a ${pendingOrObserved.scheduledExitLabel}`,
      actionLabel: "Esperar respuesta",
      canCheckIn: false,
      canCheckOut: false,
      canRequest: false,
      firstName: pendingOrObserved.person.firstName,
      lastName: pendingOrObserved.person.lastName,
      activityDescription: pendingOrObserved.activityDescription,
      sourceCode: "RUT",
    };
  }

  const rejectedOrExpired = matchingTickets.find((ticket) =>
    ["RECHAZADO", "VENCIDO"].includes(ticket.statusCode)
  );
  if (rejectedOrExpired) {
    return {
      allowed: false,
      severity: "denied",
      icon: "X",
      title: "Ingreso no autorizado",
      message:
        "La persona figura en el sistema, pero su ticket esta rechazado o vencido para la franja consultada.",
      rut: rejectedOrExpired.person.rut,
      personName: rejectedOrExpired.person.fullName,
      company: rejectedOrExpired.company,
      hostName: rejectedOrExpired.hostName,
      ticketCode: rejectedOrExpired.ticketCode,
      statusLabel: rejectedOrExpired.statusLabel,
      scheduleLabel: `${rejectedOrExpired.scheduledEntryLabel} a ${rejectedOrExpired.scheduledExitLabel}`,
      actionLabel: "Elevar nueva solicitud",
      canCheckIn: false,
      canCheckOut: false,
      canRequest: true,
      firstName: rejectedOrExpired.person.firstName,
      lastName: rejectedOrExpired.person.lastName,
      activityDescription: rejectedOrExpired.activityDescription,
      sourceCode: "RUT",
    };
  }

  const completedVisit = matchingTickets.find((ticket) => ticket.statusCode === "SALIDA_REGISTRADA");
  if (completedVisit) {
    return {
      allowed: false,
      severity: "warning",
      icon: "DONE",
      title: "Visita ya cerrada",
      message: "La persona ya registró salida en una visita previa. Si necesita volver a entrar, debe generarse un nuevo ticket.",
      rut: completedVisit.person.rut,
      personName: completedVisit.person.fullName,
      company: completedVisit.company,
      hostName: completedVisit.hostName,
      ticketCode: completedVisit.ticketCode,
      statusLabel: completedVisit.statusLabel,
      scheduleLabel: `${completedVisit.scheduledEntryLabel} a ${completedVisit.scheduledExitLabel}`,
      actionLabel: "Crear nuevo ticket",
      canCheckIn: false,
      canCheckOut: false,
      canRequest: true,
      firstName: completedVisit.person.firstName,
      lastName: completedVisit.person.lastName,
      activityDescription: completedVisit.activityDescription,
      sourceCode: "RUT",
    };
  }

  return {
    allowed: false,
    severity: "denied",
    icon: "X",
    title: "Sin ticket vigente",
    message:
      "No existe un ticket aprobado y activo para este RUT. El operador puede elevar una solicitud urgente al creador.",
    rut: formattedLookupRut,
    personName: "Sin coincidencias",
    company: "No disponible",
    hostName: "No disponible",
    ticketCode: "-",
    statusLabel: "Sin registro operativo",
    scheduleLabel: "Sin horario autorizado",
    actionLabel: "Elevar solicitud urgente",
    canCheckIn: false,
    canCheckOut: false,
    canRequest: true,
    firstName: "",
    lastName: "",
    activityDescription: "",
    sourceCode: "RUT",
  };
}

async function recordAccessLookup(rut, currentUser, sourceCode, decision) {
  if (!currentUser) {
    return;
  }

  await withTransaction(async (client) => {
    const personResult = await client.query("SELECT id FROM people WHERE rut = $1 LIMIT 1", [
      normalizeRut(rut),
    ]);
    const ticketIdResult =
      decision.ticketCode && decision.ticketCode !== "-"
        ? await client.query("SELECT id FROM access_tickets WHERE ticket_code = $1 LIMIT 1", [
            decision.ticketCode,
          ])
        : { rows: [] };

    const lookupEventTypeId = await getLookupId(client, "access_event_types", "LOOKUP");
    const deniedEventTypeId = await getLookupId(client, "access_event_types", "DENIED");
    const sourceId = await getLookupId(client, "access_sources", sourceCode || "RUT");

    await client.query(
      `
        INSERT INTO access_events (
          ticket_id,
          person_id,
          operator_user_id,
          event_type_id,
          source_id,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        ticketIdResult.rows[0] ? ticketIdResult.rows[0].id : null,
        personResult.rows[0] ? personResult.rows[0].id : null,
        currentUser.id,
        lookupEventTypeId,
        sourceId,
        `Consulta de acceso para ${formatRut(rut)}. Resultado: ${decision.statusLabel}.`,
      ]
    );

    if (!decision.allowed) {
      await client.query(
        `
          INSERT INTO access_events (
            ticket_id,
            person_id,
            operator_user_id,
            event_type_id,
            source_id,
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          ticketIdResult.rows[0] ? ticketIdResult.rows[0].id : null,
          personResult.rows[0] ? personResult.rows[0].id : null,
          currentUser.id,
          deniedEventTypeId,
          sourceId,
          `Ingreso denegado al consultar ${formatRut(rut)}.`,
        ]
      );
    }

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "ACCESS_LOOKUP",
      entityId: null,
      action: "LOOKUP_ACCESS",
      details: {
        rut: formatRut(rut),
        sourceCode,
        ticketCode: decision.ticketCode,
        allowed: decision.allowed,
        statusLabel: decision.statusLabel,
      },
    });
  });
}

async function createUserAction(input, currentUser) {
  const settings = await getSystemSettings();
  const passwordPolicy = getPasswordPolicy(settings);
  const fullName = String(input.fullName || "").trim();
  const username = String(input.username || "").trim().toLowerCase();
  const password = String(input.password || "").trim();
  const roleCode = String(input.roleCode || "").trim();
  const email = String(input.email || "").trim() || `${username}@fixaccess.local`;

  if (!fullName || !username || !password || !roleCode) {
    throw new Error("Completa nombre, usuario, contrasena y rol para crear la cuenta.");
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error("El usuario solo puede contener letras, numeros, punto, guion o guion bajo.");
  }

  const passwordError = validatePasswordWithPolicy(password, passwordPolicy);
  if (passwordError) {
    throw new Error(passwordError);
  }

  if (!roles.find((role) => role.code === roleCode)) {
    throw new Error("Selecciona un rol valido para el nuevo usuario.");
  }

  const existingUser = await getUserByUsername(username);
  if (existingUser) {
    throw new Error(`El usuario @${username} ya existe en el sistema.`);
  }

  const names = splitFullName(fullName);
  const passwordHash = await bcrypt.hash(password, 10);

  await withTransaction(async (client) => {
    const roleId = await getLookupId(client, "roles", roleCode);
    const result = await client.query(
      `
        INSERT INTO users (
          role_id,
          username,
          email,
          password_hash,
          first_name,
          last_name,
          is_active,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
        RETURNING id
      `,
      [roleId, username, email, passwordHash, names.firstName, names.lastName, currentUser.id]
    );

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "USER",
      entityId: result.rows[0].id,
      action: "CREATE_USER",
      details: {
        username,
        roleCode,
        email,
      },
    });
  });

  return {
    username,
    roleCode,
    password,
  };
}

async function toggleUserStatusAction(username, currentUser) {
  const account = await getUserByUsername(username);
  if (!account) {
    throw new Error("No se encontro la cuenta indicada.");
  }

  if (account.username === currentUser.username) {
    throw new Error("No puedes bloquear la sesion de administrador que estas usando.");
  }

  let newStatus = "BLOCKED";
  await withTransaction(async (client) => {
    const result = await client.query(
      `
        UPDATE users
        SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
        WHERE LOWER(username) = LOWER($1)
        RETURNING id, is_active
      `,
      [username]
    );

    newStatus = result.rows[0].is_active ? "ACTIVE" : "BLOCKED";
    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "USER",
      entityId: result.rows[0].id,
      action: newStatus === "ACTIVE" ? "REACTIVATE_USER" : "BLOCK_USER",
      details: {
        username,
      },
    });
  });

  return newStatus;
}

async function nextTicketCode(client) {
  const datePart = formatDateOnly(new Date()).replace(/-/g, "");
  const result = await client.query(
    `
      SELECT ticket_code
      FROM access_tickets
      WHERE ticket_code LIKE $1
      ORDER BY ticket_code DESC
      LIMIT 1
    `,
    [`ACC-${datePart}-%`]
  );

  const lastSequence = result.rows[0]
    ? Number(String(result.rows[0].ticket_code).split("-").slice(-1)[0])
    : 0;

  return `ACC-${datePart}-${String(lastSequence + 1).padStart(3, "0")}`;
}

async function nextRequestCode(client) {
  const datePart = formatDateOnly(new Date()).replace(/-/g, "");
  const result = await client.query(
    `
      SELECT request_code
      FROM operator_access_requests
      WHERE request_code LIKE $1
      ORDER BY request_code DESC
      LIMIT 1
    `,
    [`SOL-${datePart}-%`]
  );

  const lastSequence = result.rows[0]
    ? Number(String(result.rows[0].request_code).split("-").slice(-1)[0])
    : 0;

  return `SOL-${datePart}-${String(lastSequence + 1).padStart(3, "0")}`;
}

async function nextEmailIntakeCode(client) {
  const datePart = formatDateOnly(new Date()).replace(/-/g, "");
  const result = await client.query(
    `
      SELECT intake_code
      FROM email_intake_requests
      WHERE intake_code LIKE $1
      ORDER BY intake_code DESC
      LIMIT 1
    `,
    [`MAIL-${datePart}-%`]
  );

  const lastSequence = result.rows[0]
    ? Number(String(result.rows[0].intake_code).split("-").slice(-1)[0])
    : 0;

  return `MAIL-${datePart}-${String(lastSequence + 1).padStart(3, "0")}`;
}

async function changePasswordAction(input, currentUser) {
  const currentPassword = String(input.currentPassword || "").trim();
  const newPassword = String(input.newPassword || "").trim();
  const confirmPassword = String(input.confirmPassword || "").trim();

  if (!currentPassword || !newPassword || !confirmPassword) {
    throw new Error("Completa la contrasena actual, la nueva y la confirmacion.");
  }

  if (newPassword !== confirmPassword) {
    throw new Error("La confirmacion de la nueva contrasena no coincide.");
  }

  const settings = await getSystemSettings();
  const policy = getPasswordPolicy(settings);
  const validationMessage = validatePasswordWithPolicy(newPassword, policy);
  if (validationMessage) {
    throw new Error(validationMessage);
  }

  const account = await getUserById(currentUser.id);
  const isPasswordValid = account && (await bcrypt.compare(currentPassword, account.passwordHash));
  if (!isPasswordValid) {
    throw new Error("La contrasena actual no coincide con la registrada.");
  }

  if (currentPassword === newPassword) {
    throw new Error("La nueva contrasena debe ser distinta a la actual.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE users
        SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [currentUser.id, passwordHash]
    );

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "USER",
      entityId: currentUser.id,
      action: "CHANGE_PASSWORD",
      details: {
        username: currentUser.username,
      },
    });
  });
}

function buildSecuritySettingsPayload(input) {
  return {
    sessionTimeoutMinutes: Math.max(5, Number(input.sessionTimeoutMinutes || DEFAULT_SYSTEM_SETTINGS.SECURITY.sessionTimeoutMinutes)),
    maxLoginAttempts: Math.max(3, Number(input.maxLoginAttempts || DEFAULT_SYSTEM_SETTINGS.SECURITY.maxLoginAttempts)),
    lockoutMinutes: Math.max(1, Number(input.lockoutMinutes || DEFAULT_SYSTEM_SETTINGS.SECURITY.lockoutMinutes)),
    minPasswordLength: Math.max(8, Number(input.minPasswordLength || DEFAULT_SYSTEM_SETTINGS.SECURITY.minPasswordLength)),
    requireUppercase: normalizeBoolean(input.requireUppercase, false),
    requireLowercase: normalizeBoolean(input.requireLowercase, false),
    requireDigit: normalizeBoolean(input.requireDigit, false),
    requireSpecialChar: normalizeBoolean(input.requireSpecialChar, false),
    secureCookies: normalizeBoolean(input.secureCookies, false),
    showDemoCredentials: normalizeBoolean(input.showDemoCredentials, false),
  };
}

function buildOperationSettingsPayload(input) {
  return {
    earlyEntryToleranceMinutes: Math.max(0, Number(input.earlyEntryToleranceMinutes || DEFAULT_SYSTEM_SETTINGS.OPERATION.earlyEntryToleranceMinutes)),
    lateExitToleranceMinutes: Math.max(0, Number(input.lateExitToleranceMinutes || DEFAULT_SYSTEM_SETTINGS.OPERATION.lateExitToleranceMinutes)),
    defaultVisitDurationHours: Math.max(1, Number(input.defaultVisitDurationHours || DEFAULT_SYSTEM_SETTINGS.OPERATION.defaultVisitDurationHours)),
    strictRutValidation: normalizeBoolean(input.strictRutValidation, false),
  };
}

function buildEmailSettingsPayload(input) {
  return {
    intakeEnabled: normalizeBoolean(input.intakeEnabled, false),
    requireAttachment: normalizeBoolean(input.requireAttachment, false),
    acceptedFileTypes:
      String(input.acceptedFileTypes || DEFAULT_SYSTEM_SETTINGS.EMAIL_INTAKE.acceptedFileTypes).trim() ||
      DEFAULT_SYSTEM_SETTINGS.EMAIL_INTAKE.acceptedFileTypes,
    webhookToken:
      String(input.webhookToken || DEFAULT_WEBHOOK_TOKEN || DEFAULT_SYSTEM_SETTINGS.EMAIL_INTAKE.webhookToken).trim(),
  };
}

function validateEmailIntakePayload(input, settings) {
  const senderName = String(input.senderName || "").trim();
  const senderEmail = String(input.senderEmail || "").trim().toLowerCase();
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "").trim();
  const extractedRut = extractRutFromText(body);
  const requestedRut = String(input.requestedRut || extractedRut || "").trim();
  const requestedFirstName = String(input.requestedFirstName || "").trim();
  const requestedLastName = String(input.requestedLastName || "").trim();
  const companyName = String(input.companyName || "").trim();
  const hostName = String(input.hostName || "").trim();
  const activityDescription = String(input.activityDescription || subject || "").trim();
  const notes = String(input.notes || "").trim();
  const desiredEntryAt = input.desiredEntryAt ? parseDateTimeLocal(input.desiredEntryAt) : null;
  const desiredExitAt = input.desiredExitAt ? parseDateTimeLocal(input.desiredExitAt) : null;

  if (!settings.EMAIL_INTAKE.intakeEnabled) {
    throw new Error("La bandeja de correo entrante esta deshabilitada por configuracion.");
  }

  if (!senderEmail || !subject || !body) {
    throw new Error("Completa remitente, asunto y cuerpo del correo para registrar la solicitud.");
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(senderEmail)) {
    throw new Error("El correo del remitente no tiene un formato valido.");
  }

  if (requestedRut && settings.OPERATION.strictRutValidation && !isValidRut(requestedRut)) {
    throw new Error("El RUT extraido o informado en el correo no es valido.");
  }

  if ((desiredEntryAt && !desiredExitAt) || (!desiredEntryAt && desiredExitAt)) {
    throw new Error("Si indicas una fecha para el correo, debes completar tanto entrada como salida.");
  }

  if (desiredEntryAt && desiredExitAt && desiredExitAt <= desiredEntryAt) {
    throw new Error("La salida estimada del correo debe ser mayor a la entrada estimada.");
  }

  return {
    senderName,
    senderEmail,
    subject,
    body,
    companyName,
    requestedRut: requestedRut ? formatRut(requestedRut) : "",
    requestedFirstName,
    requestedLastName,
    hostName,
    activityDescription,
    notes,
    desiredEntryAt,
    desiredExitAt,
  };
}

async function createEmailIntakeAction(input, files, currentUser, isWebhook = false) {
  const settings = await getSystemSettings();
  const payload = validateEmailIntakePayload(input, settings);

  if (settings.EMAIL_INTAKE.requireAttachment && (!files || !files.length)) {
    throw new Error("La configuracion actual exige al menos un adjunto para registrar el correo.");
  }

  const acceptedFileTypes = getAcceptedFileTypes(settings);
  const invalidFile = (files || []).find(
    (file) => acceptedFileTypes.length && !acceptedFileTypes.includes(file.mimetype)
  );
  if (invalidFile) {
    throw new Error(`El archivo ${invalidFile.originalname} no coincide con los tipos permitidos.`);
  }

  return withTransaction(async (client) => {
    const intakeCode = await nextEmailIntakeCode(client);
    const statusId = await getLookupId(client, "email_intake_statuses", "RECEIVED");
    const result = await client.query(
      `
        INSERT INTO email_intake_requests (
          intake_code,
          sender_name,
          sender_email,
          subject,
          body,
          company_name,
          requested_rut,
          requested_first_name,
          requested_last_name,
          host_name,
          activity_description,
          desired_entry_at,
          desired_exit_at,
          status_id,
          created_by_user_id,
          notes,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [
        intakeCode,
        payload.senderName,
        payload.senderEmail,
        payload.subject,
        payload.body,
        payload.companyName || null,
        payload.requestedRut ? normalizeRut(payload.requestedRut) : null,
        payload.requestedFirstName || null,
        payload.requestedLastName || null,
        payload.hostName || null,
        payload.activityDescription || null,
        payload.desiredEntryAt ? payload.desiredEntryAt.toISOString() : null,
        payload.desiredExitAt ? payload.desiredExitAt.toISOString() : null,
        statusId,
        currentUser ? currentUser.id : null,
        payload.notes || null,
      ]
    );

    await persistAttachments(client, "EMAIL_INTAKE", result.rows[0].id, files, currentUser ? currentUser.id : null);

    await insertAuditLog(client, {
      userId: currentUser ? currentUser.id : null,
      entityType: "EMAIL_INTAKE",
      entityId: result.rows[0].id,
      action: isWebhook ? "CREATE_EMAIL_INTAKE_WEBHOOK" : "CREATE_EMAIL_INTAKE",
      details: {
        intakeCode,
        senderEmail: payload.senderEmail,
        attachments: (files || []).length,
      },
    });

    return intakeCode;
  });
}

async function updateEmailIntakeStatusAction(intakeCode, nextStatusCode, currentUser, notes = "") {
  const noteText = String(notes || "").trim();
  return withTransaction(async (client) => {
    const intakeResult = await client.query(
      `
        SELECT
          intake.id,
          status.code AS status_code
        FROM email_intake_requests intake
        JOIN email_intake_statuses status ON status.id = intake.status_id
        WHERE intake.intake_code = $1
        LIMIT 1
      `,
      [intakeCode]
    );

    if (!intakeResult.rows[0]) {
      throw new Error("No se encontro la solicitud por correo indicada.");
    }

    const nextStatusId = await getLookupId(client, "email_intake_statuses", nextStatusCode);
    await client.query(
      `
        UPDATE email_intake_requests
        SET
          status_id = $2,
          assigned_creator_user_id = $3,
          notes = COALESCE($4, notes),
          updated_at = CURRENT_TIMESTAMP
        WHERE intake_code = $1
      `,
      [intakeCode, nextStatusId, currentUser.id, noteText || null]
    );

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "EMAIL_INTAKE",
      entityId: intakeResult.rows[0].id,
        action: `EMAIL_INTAKE_${nextStatusCode}`,
        details: {
          intakeCode,
          notes: noteText,
        },
      });
    });
}

function validateTicketPayload(payload, settings) {
  const rut = String(payload.rut || "").trim();
  const firstName = String(payload.firstName || "").trim();
  const lastName = String(payload.lastName || "").trim();
  const company = String(payload.company || "").trim();
  const hostName = String(payload.hostName || "").trim();
  const activityDescription = String(payload.activityDescription || "").trim();
  const ticketNotes = String(payload.ticketNotes || payload.notes || "").trim();
  const scheduledEntryAt = parseDateTimeLocal(payload.scheduledEntryAt);
  const scheduledExitAt = parseDateTimeLocal(payload.scheduledExitAt);

  if (!rut || !firstName || !lastName || !company || !hostName || !activityDescription) {
    throw new Error("Completa todos los campos requeridos para crear o actualizar el ticket.");
  }

  if (normalizeBoolean(settings.OPERATION.strictRutValidation, true) && !isValidRut(rut)) {
    throw new Error("El RUT ingresado no es valido.");
  }

  if (!scheduledEntryAt || !scheduledExitAt) {
    throw new Error("La fecha y hora de entrada y salida son obligatorias.");
  }

  if (scheduledExitAt <= scheduledEntryAt) {
    throw new Error("La salida estimada debe ser mayor a la entrada estimada.");
  }

  return {
    rut: formatRut(rut),
    firstName,
    lastName,
    company,
    hostName,
    activityDescription,
    ticketNotes,
    scheduledEntryAt,
    scheduledExitAt,
    requestCode: String(payload.requestCode || "").trim(),
    ticketCode: String(payload.ticketCode || "").trim(),
    emailIntakeCode: String(payload.emailIntakeCode || "").trim(),
  };
}

async function createOrUpdateTicketAction(input, currentUser) {
  const settings = await getSystemSettings();
  const payload = validateTicketPayload(input, settings);
  await syncExpiredTickets();

  const overlappingTicket = await ensureNoOverlappingTicket(
    payload.rut,
    payload.scheduledEntryAt,
    payload.scheduledExitAt,
    payload.ticketCode || null
  );

  if (overlappingTicket) {
    throw new Error(`Ya existe un ticket en conflicto para ese RUT dentro del rango horario: ${overlappingTicket.ticketCode}.`);
  }

  return withTransaction(async (client) => {
    const companyId = await upsertCompany(client, payload.company);
    const personId = await upsertPerson(
      client,
      {
        rut: payload.rut,
        firstName: payload.firstName,
        lastName: payload.lastName,
      },
      companyId
    );
    const pendingStatusId = await getLookupId(client, "ticket_statuses", "PENDIENTE_VERIFICACION");

    if (payload.ticketCode) {
      const currentTicketResult = await client.query(
        `
          SELECT
            t.id,
            ts.code AS status_code
          FROM access_tickets t
          JOIN ticket_statuses ts ON ts.id = t.status_id
          WHERE t.ticket_code = $1
          LIMIT 1
        `,
        [payload.ticketCode]
      );

      if (!currentTicketResult.rows[0]) {
        throw new Error("No se encontro el ticket indicado para correccion.");
      }

      if (currentTicketResult.rows[0].status_code !== "OBSERVADO") {
        throw new Error("Solo puedes reenviar tickets que esten en estado observado.");
      }

      await client.query(
        `
          UPDATE access_tickets
          SET
            person_id = $2,
            company_id = $3,
            host_name = $4,
            activity_description = $5,
            scheduled_entry_at = $6,
            scheduled_exit_at = $7,
            status_id = $8,
            verifier_user_id = NULL,
            ticket_notes = $9,
            verification_notes = NULL,
            rejection_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE ticket_code = $1
        `,
        [
          payload.ticketCode,
          personId,
          companyId,
          payload.hostName,
          payload.activityDescription,
          payload.scheduledEntryAt.toISOString(),
          payload.scheduledExitAt.toISOString(),
          pendingStatusId,
          payload.ticketNotes,
        ]
      );

      await insertTicketHistory(
        client,
        currentTicketResult.rows[0].id,
        currentTicketResult.rows[0].status_code,
        "PENDIENTE_VERIFICACION",
        currentUser.id,
        "Ticket corregido por el creador y reenviado a verificacion."
      );

      if (payload.requestCode) {
        const revisionStatusId = await getLookupId(client, "operator_request_statuses", "EN_REVISION");
        await client.query(
          `
            UPDATE operator_access_requests
            SET
              status_id = $2,
              responded_by_user_id = $3,
              response_notes = $4,
              responded_at = CURRENT_TIMESTAMP
            WHERE request_code = $1
          `,
          [
            payload.requestCode,
            revisionStatusId,
            currentUser.id,
            `Ticket ${payload.ticketCode} corregido y reenviado a verificacion.`,
          ]
        );
      }

      if (payload.emailIntakeCode) {
        const reviewStatusId = await getLookupId(client, "email_intake_statuses", "IN_REVIEW");
        await client.query(
          `
            UPDATE email_intake_requests
            SET
              status_id = $2,
              assigned_creator_user_id = $3,
              related_ticket_id = (
                SELECT id
                FROM access_tickets
                WHERE ticket_code = $4
              ),
              notes = $5,
              updated_at = CURRENT_TIMESTAMP
            WHERE intake_code = $1
          `,
          [
            payload.emailIntakeCode,
            reviewStatusId,
            currentUser.id,
            payload.ticketCode,
            `Correo corregido y ticket ${payload.ticketCode} reenviado a verificacion.`,
          ]
        );
      }

      await insertAuditLog(client, {
        userId: currentUser.id,
        entityType: "TICKET",
        entityId: currentTicketResult.rows[0].id,
        action: "RESUBMIT_TICKET",
        details: {
          ticketCode: payload.ticketCode,
          requestCode: payload.requestCode || null,
          emailIntakeCode: payload.emailIntakeCode || null,
        },
      });

      return {
        ticketCode: payload.ticketCode,
        mode: "updated",
      };
    }

    const ticketCode = await nextTicketCode(client);
    const insertedTicket = await client.query(
      `
        INSERT INTO access_tickets (
          ticket_code,
          person_id,
          company_id,
          host_name,
          activity_description,
          scheduled_entry_at,
          scheduled_exit_at,
          status_id,
          creator_user_id,
          ticket_notes,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [
        ticketCode,
        personId,
        companyId,
        payload.hostName,
        payload.activityDescription,
        payload.scheduledEntryAt.toISOString(),
        payload.scheduledExitAt.toISOString(),
        pendingStatusId,
        currentUser.id,
        payload.ticketNotes,
      ]
    );

    await insertTicketHistory(
      client,
      insertedTicket.rows[0].id,
      null,
      "PENDIENTE_VERIFICACION",
      currentUser.id,
      "Ticket creado por el creador."
    );

    if (payload.requestCode) {
      const revisionStatusId = await getLookupId(client, "operator_request_statuses", "EN_REVISION");
      await client.query(
        `
          UPDATE operator_access_requests
          SET
            status_id = $2,
            related_ticket_id = $3,
            responded_by_user_id = $4,
            response_notes = $5,
            responded_at = CURRENT_TIMESTAMP
          WHERE request_code = $1
        `,
        [
          payload.requestCode,
          revisionStatusId,
          insertedTicket.rows[0].id,
          currentUser.id,
          `Se genero el ticket ${ticketCode} y fue enviado a verificacion.`,
        ]
      );
    }

    if (payload.emailIntakeCode) {
      const reviewStatusId = await getLookupId(client, "email_intake_statuses", "IN_REVIEW");
      await client.query(
        `
          UPDATE email_intake_requests
          SET
            status_id = $2,
            assigned_creator_user_id = $3,
            related_ticket_id = $4,
            notes = $5,
            updated_at = CURRENT_TIMESTAMP
          WHERE intake_code = $1
        `,
        [
          payload.emailIntakeCode,
          reviewStatusId,
          currentUser.id,
          insertedTicket.rows[0].id,
          `Correo convertido a ticket ${ticketCode} y enviado a verificacion.`,
        ]
      );
    }

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "TICKET",
      entityId: insertedTicket.rows[0].id,
      action: "CREATE_TICKET",
      details: {
        ticketCode,
        requestCode: payload.requestCode || null,
        emailIntakeCode: payload.emailIntakeCode || null,
      },
    });

    return {
      ticketCode,
      mode: "created",
    };
  });
}

async function takeRequestAction(requestCode, currentUser) {
  await withTransaction(async (client) => {
    const requestResult = await client.query(
      `
        SELECT req.id, ors.code AS status_code
        FROM operator_access_requests req
        JOIN operator_request_statuses ors ON ors.id = req.status_id
        WHERE req.request_code = $1
        LIMIT 1
      `,
      [requestCode]
    );

    if (!requestResult.rows[0]) {
      throw new Error("No se encontro la solicitud del operador.");
    }

    if (["RECHAZADA", "CERRADA"].includes(requestResult.rows[0].status_code)) {
      throw new Error("La solicitud ya fue cerrada y no puede volver a tomarse.");
    }

    const reviewStatusId = await getLookupId(client, "operator_request_statuses", "EN_REVISION");
    await client.query(
      `
        UPDATE operator_access_requests
        SET
          status_id = $2,
          responded_by_user_id = $3,
          response_notes = $4,
          responded_at = CURRENT_TIMESTAMP
        WHERE request_code = $1
      `,
      [
        requestCode,
        reviewStatusId,
        currentUser.id,
        `Solicitud tomada por ${currentUser.fullName} para generar o corregir ticket.`,
      ]
    );

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "OPERATOR_REQUEST",
      entityId: requestResult.rows[0].id,
      action: "TAKE_OPERATOR_REQUEST",
      details: {
        requestCode,
      },
    });
  });
}

async function rejectRequestAction(requestCode, currentUser, responseNotes) {
  const notes = String(responseNotes || "").trim() || "Solicitud rechazada por informacion insuficiente o inconsistente.";
  await withTransaction(async (client) => {
    const requestResult = await client.query(
      `
        SELECT id
        FROM operator_access_requests
        WHERE request_code = $1
        LIMIT 1
      `,
      [requestCode]
    );

    if (!requestResult.rows[0]) {
      throw new Error("No se encontro la solicitud del operador.");
    }

    const rejectedStatusId = await getLookupId(client, "operator_request_statuses", "RECHAZADA");
    await client.query(
      `
        UPDATE operator_access_requests
        SET
          status_id = $2,
          responded_by_user_id = $3,
          response_notes = $4,
          responded_at = CURRENT_TIMESTAMP
        WHERE request_code = $1
      `,
      [requestCode, rejectedStatusId, currentUser.id, notes]
    );

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "OPERATOR_REQUEST",
      entityId: requestResult.rows[0].id,
      action: "REJECT_OPERATOR_REQUEST",
      details: {
        requestCode,
        notes,
      },
    });
  });
}

async function decideTicketAction(ticketCode, decision, notes, currentUser) {
  const normalizedDecision = String(decision || "").trim();
  const decisionNotes = String(notes || "").trim();

  if (!["approve", "observe", "reject"].includes(normalizedDecision)) {
    throw new Error("La decision enviada no es valida.");
  }

  return withTransaction(async (client) => {
    const ticketResult = await client.query(
      `
        SELECT
          t.id,
          ts.code AS status_code,
          req.request_code AS related_request_code,
          intake.id AS email_intake_id,
          intake.intake_code AS email_intake_code
        FROM access_tickets t
        JOIN ticket_statuses ts ON ts.id = t.status_id
        LEFT JOIN operator_access_requests req ON req.related_ticket_id = t.id
        LEFT JOIN email_intake_requests intake ON intake.related_ticket_id = t.id
        WHERE t.ticket_code = $1
        LIMIT 1
      `,
      [ticketCode]
    );

    if (!ticketResult.rows[0]) {
      throw new Error("No se encontro el ticket indicado para verificacion.");
    }

    if (!["PENDIENTE_VERIFICACION", "OBSERVADO"].includes(ticketResult.rows[0].status_code)) {
      throw new Error("El ticket no esta disponible para una nueva decision de verificacion.");
    }

    const nextStatusCode =
      normalizedDecision === "approve"
        ? "APROBADO"
        : normalizedDecision === "observe"
          ? "OBSERVADO"
          : "RECHAZADO";
    const nextStatusId = await getLookupId(client, "ticket_statuses", nextStatusCode);
    const noteText =
      decisionNotes ||
      (normalizedDecision === "approve"
        ? "Ticket aprobado para control de ingreso."
        : normalizedDecision === "observe"
          ? "Ticket observado. Se requieren correcciones antes de aprobar."
          : "Ticket rechazado por inconsistencia o falta de disponibilidad.");

    await client.query(
      `
        UPDATE access_tickets
        SET
          status_id = $2,
          verifier_user_id = $3,
          verification_notes = $4,
          rejection_reason = $5,
          verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE ticket_code = $1
      `,
      [
        ticketCode,
        nextStatusId,
        currentUser.id,
        noteText,
        nextStatusCode === "RECHAZADO" ? noteText : null,
      ]
    );

    await insertTicketHistory(
      client,
      ticketResult.rows[0].id,
      ticketResult.rows[0].status_code,
      nextStatusCode,
      currentUser.id,
      noteText
    );

    if (ticketResult.rows[0].related_request_code) {
      const relatedRequestStatus =
        nextStatusCode === "APROBADO"
          ? "APROBADA"
          : nextStatusCode === "OBSERVADO"
            ? "EN_REVISION"
            : "RECHAZADA";
      const relatedRequestStatusId = await getLookupId(
        client,
        "operator_request_statuses",
        relatedRequestStatus
      );
      await client.query(
        `
          UPDATE operator_access_requests
          SET
            status_id = $2,
            responded_by_user_id = $3,
            response_notes = $4,
            responded_at = CURRENT_TIMESTAMP
          WHERE request_code = $1
        `,
        [
          ticketResult.rows[0].related_request_code,
          relatedRequestStatusId,
          currentUser.id,
          noteText,
        ]
      );
    }

    if (ticketResult.rows[0].email_intake_id) {
      const relatedEmailStatusCode =
        nextStatusCode === "APROBADO"
          ? "CONVERTED_TO_TICKET"
          : nextStatusCode === "OBSERVADO"
            ? "IN_REVIEW"
            : "DISMISSED";
      const relatedEmailStatusId = await getLookupId(client, "email_intake_statuses", relatedEmailStatusCode);
      await client.query(
        `
          UPDATE email_intake_requests
          SET
            status_id = $2,
            assigned_creator_user_id = COALESCE(assigned_creator_user_id, $3),
            notes = $4,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [
          ticketResult.rows[0].email_intake_id,
          relatedEmailStatusId,
          currentUser.id,
          nextStatusCode === "APROBADO"
            ? `Correo convertido exitosamente en ticket ${ticketCode} aprobado.`
            : nextStatusCode === "OBSERVADO"
              ? `Ticket ${ticketCode} observado por verificacion.`
              : `Correo descartado luego del rechazo del ticket ${ticketCode}.`,
        ]
      );
    }

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "TICKET",
      entityId: ticketResult.rows[0].id,
      action: `VERIFY_TICKET_${nextStatusCode}`,
      details: {
        ticketCode,
        decision: normalizedDecision,
        notes: noteText,
      },
    });

    return nextStatusCode;
  });
}

function validateOperatorRequestPayload(payload) {
  const rut = String(payload.rut || "").trim();
  const firstName = String(payload.firstName || "").trim();
  const lastName = String(payload.lastName || "").trim();
  const company = String(payload.company || "").trim();
  const hostName = String(payload.hostName || "").trim();
  const activityDescription = String(payload.activityDescription || "").trim();
  const operatorNotes = String(payload.operatorNotes || "").trim();
  const desiredEntryAt = parseDateTimeLocal(payload.desiredEntryAt);
  const desiredExitAt = parseDateTimeLocal(payload.desiredExitAt);

  if (!rut || !firstName || !lastName || !company || !hostName || !activityDescription) {
    throw new Error("Completa todos los datos minimos para elevar la solicitud urgente.");
  }

  if (payload.strictRutValidation && !isValidRut(rut)) {
    throw new Error("El RUT de la solicitud urgente no es valido.");
  }

  if (!desiredEntryAt || !desiredExitAt || desiredExitAt <= desiredEntryAt) {
    throw new Error("La solicitud urgente necesita una entrada y salida validas.");
  }

  return {
    rut: formatRut(rut),
    firstName,
    lastName,
    company,
    hostName,
    activityDescription,
    operatorNotes,
    desiredEntryAt,
    desiredExitAt,
  };
}

async function createOperatorRequestAction(input, currentUser) {
  const settings = await getSystemSettings();
  const payload = validateOperatorRequestPayload({
    ...input,
    strictRutValidation: normalizeBoolean(settings.OPERATION.strictRutValidation, true),
  });
  const pendingRequests = await listOperatorRequests();
  const duplicated = pendingRequests.find((request) => {
    if (!["PENDIENTE_RESPUESTA", "EN_REVISION"].includes(request.statusCode)) {
      return false;
    }

    if (normalizeRut(request.rut) !== normalizeRut(payload.rut)) {
      return false;
    }

    if (!request.desiredEntryAt || !request.desiredExitAt) {
      return false;
    }

    return overlaps(
      new Date(request.desiredEntryAt).getTime(),
      new Date(request.desiredExitAt).getTime(),
      payload.desiredEntryAt.getTime(),
      payload.desiredExitAt.getTime()
    );
  });

  if (duplicated) {
    throw new Error(`Ya existe una solicitud urgente en curso para ese RUT: ${duplicated.requestCode}.`);
  }

  return withTransaction(async (client) => {
    const companyId = await upsertCompany(client, payload.company);
    const personId = await upsertPerson(
      client,
      {
        rut: payload.rut,
        firstName: payload.firstName,
        lastName: payload.lastName,
      },
      companyId
    );
    const requestCode = await nextRequestCode(client);
    const statusId = await getLookupId(client, "operator_request_statuses", "PENDIENTE_RESPUESTA");

    const insertedRequest = await client.query(
      `
        INSERT INTO operator_access_requests (
          request_code,
          person_id,
          requested_rut,
          requested_first_name,
          requested_last_name,
          company_name,
          host_name,
          activity_description,
          desired_entry_at,
          desired_exit_at,
          operator_notes,
          status_id,
          operator_user_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [
        requestCode,
        personId,
        normalizeRut(payload.rut),
        payload.firstName,
        payload.lastName,
        payload.company,
        payload.hostName,
        payload.activityDescription,
        payload.desiredEntryAt.toISOString(),
        payload.desiredExitAt.toISOString(),
        payload.operatorNotes,
        statusId,
        currentUser.id,
      ]
    );

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "OPERATOR_REQUEST",
      entityId: insertedRequest.rows[0].id,
      action: "CREATE_OPERATOR_REQUEST",
      details: {
        requestCode,
        rut: payload.rut,
      },
    });

    return requestCode;
  });
}

async function checkInAction(input, currentUser) {
  const ticketCode = String(input.ticketCode || "").trim();
  const sourceCode = String(input.sourceCode || "RUT").trim() || "RUT";

  if (!ticketCode) {
    throw new Error("Selecciona un ticket valido para registrar la entrada.");
  }

  await syncExpiredTickets();
  const settings = await getSystemSettings();
  const earlyToleranceMs = Number(settings.OPERATION.earlyEntryToleranceMinutes || 0) * 60 * 1000;
  const lateToleranceMs = Number(settings.OPERATION.lateExitToleranceMinutes || 0) * 60 * 1000;
  const tickets = await listTickets();
  const accessEvents = await listAccessEvents();
  const ticket = tickets.find((item) => item.ticketCode === ticketCode);

  if (!ticket) {
    throw new Error("No se encontro el ticket para registrar la entrada.");
  }

  if (ticket.statusCode !== "APROBADO") {
    throw new Error("Solo los tickets aprobados pueden registrar entrada.");
  }

  const now = Date.now();
  if (
    now < new Date(ticket.scheduledEntryAt).getTime() - earlyToleranceMs ||
    now > new Date(ticket.scheduledExitAt).getTime() + lateToleranceMs
  ) {
    throw new Error("La persona esta fuera del horario autorizado para registrar entrada.");
  }

  if (findOpenVisit(accessEvents, ticket.ticketCode)) {
    throw new Error("Este ticket ya tiene una entrada registrada y aun no registra salida.");
  }

  await withTransaction(async (client) => {
    const checkInTypeId = await getLookupId(client, "access_event_types", "CHECK_IN");
    const sourceId = await getLookupId(client, "access_sources", sourceCode);
    const ticketIdResult = await client.query(
      `
        SELECT
          t.id,
          ts.code AS status_code,
          req.request_code
        FROM access_tickets t
        JOIN ticket_statuses ts ON ts.id = t.status_id
        LEFT JOIN operator_access_requests req ON req.related_ticket_id = t.id
        WHERE t.ticket_code = $1
        LIMIT 1
      `,
      [ticketCode]
    );

    await client.query(
      `
        INSERT INTO access_events (
          ticket_id,
          person_id,
          operator_user_id,
          event_type_id,
          source_id,
          notes
        )
        VALUES (
          $1,
          (SELECT person_id FROM access_tickets WHERE id = $1),
          $2,
          $3,
          $4,
          $5
        )
      `,
      [
        ticketIdResult.rows[0].id,
        currentUser.id,
        checkInTypeId,
        sourceId,
        `Entrada registrada para ticket ${ticketCode}.`,
      ]
    );

    const ingressedStatusId = await getLookupId(client, "ticket_statuses", "INGRESADO");
    await client.query(
      `
        UPDATE access_tickets
        SET status_id = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [ticketIdResult.rows[0].id, ingressedStatusId]
    );

    await insertTicketHistory(
      client,
      ticketIdResult.rows[0].id,
      ticketIdResult.rows[0].status_code,
      "INGRESADO",
      currentUser.id,
      "Entrada registrada por operador."
    );

    if (ticketIdResult.rows[0].request_code) {
      const closedStatusId = await getLookupId(client, "operator_request_statuses", "CERRADA");
      await client.query(
        `
          UPDATE operator_access_requests
          SET
            status_id = $2,
            responded_by_user_id = $3,
            response_notes = $4,
            responded_at = CURRENT_TIMESTAMP
          WHERE request_code = $1
        `,
        [
          ticketIdResult.rows[0].request_code,
          closedStatusId,
          currentUser.id,
          `Ingreso ejecutado con ticket ${ticketCode}. Solicitud cerrada.`,
        ]
      );
    }

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "ACCESS_EVENT",
      entityId: ticketIdResult.rows[0].id,
      action: "CHECK_IN",
      details: {
        ticketCode,
        sourceCode,
      },
    });
  });
}

async function checkOutAction(input, currentUser) {
  const ticketCode = String(input.ticketCode || "").trim();
  const sourceCode = String(input.sourceCode || "MANUAL").trim() || "MANUAL";

  if (!ticketCode) {
    throw new Error("Selecciona un ticket valido para registrar la salida.");
  }

  const tickets = await listTickets();
  const accessEvents = await listAccessEvents();
  const ticket = tickets.find((item) => item.ticketCode === ticketCode);
  if (!ticket) {
    throw new Error("No se encontro el ticket para registrar la salida.");
  }

  if (!findOpenVisit(accessEvents, ticket.ticketCode)) {
    throw new Error("No existe una entrada previa abierta para ese ticket.");
  }

  await withTransaction(async (client) => {
    const checkOutTypeId = await getLookupId(client, "access_event_types", "CHECK_OUT");
    const sourceId = await getLookupId(client, "access_sources", sourceCode);
    const ticketIdResult = await client.query(
      `
        SELECT
          t.id,
          ts.code AS status_code
        FROM access_tickets t
        JOIN ticket_statuses ts ON ts.id = t.status_id
        WHERE t.ticket_code = $1
        LIMIT 1
      `,
      [ticketCode]
    );

    await client.query(
      `
        INSERT INTO access_events (
          ticket_id,
          person_id,
          operator_user_id,
          event_type_id,
          source_id,
          notes
        )
        VALUES (
          $1,
          (SELECT person_id FROM access_tickets WHERE id = $1),
          $2,
          $3,
          $4,
          $5
        )
      `,
      [
        ticketIdResult.rows[0].id,
        currentUser.id,
        checkOutTypeId,
        sourceId,
        `Salida registrada para ticket ${ticketCode}.`,
      ]
    );

    const statusId = await getLookupId(client, "ticket_statuses", "SALIDA_REGISTRADA");
    await client.query(
      `
        UPDATE access_tickets
        SET status_id = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [ticketIdResult.rows[0].id, statusId]
    );

    await insertTicketHistory(
      client,
      ticketIdResult.rows[0].id,
      ticketIdResult.rows[0].status_code,
      "SALIDA_REGISTRADA",
      currentUser.id,
      "Salida registrada por operador."
    );

    await insertAuditLog(client, {
      userId: currentUser.id,
      entityType: "ACCESS_EVENT",
      entityId: ticketIdResult.rows[0].id,
      action: "CHECK_OUT",
      details: {
        ticketCode,
        sourceCode,
      },
    });
  });
}

function buildDemoAccounts() {
  return demoAccounts.map((account) => ({
    username: account.username,
    password: account.password,
    roleName: account.roleName,
  }));
}

function buildSummaryCards(roleCode, context) {
  const totalTickets = context.tickets.length;
  const pendingVerification = context.tickets.filter((ticket) => ticket.statusCode === "PENDIENTE_VERIFICACION").length;
  const observed = context.tickets.filter((ticket) => ticket.statusCode === "OBSERVADO").length;
  const approved = context.tickets.filter((ticket) => ticket.statusCode === "APROBADO").length;
  const ingressed = context.tickets.filter((ticket) => ticket.statusCode === "INGRESADO").length;
  const urgentRequests = context.requests.filter((request) =>
    ["PENDIENTE_RESPUESTA", "EN_REVISION"].includes(request.statusCode)
  ).length;

  if (roleCode === "ADMIN") {
    return [
      { label: "Usuarios activos", value: String(context.users.filter((user) => user.statusCode === "ACTIVE").length).padStart(2, "0"), tone: "lime" },
      { label: "Tickets totales", value: String(totalTickets).padStart(2, "0"), tone: "cyan" },
      { label: "Pendientes o observados", value: String(pendingVerification + observed).padStart(2, "0"), tone: "orange" },
      { label: "Solicitudes urgentes", value: String(urgentRequests).padStart(2, "0"), tone: "red" },
    ];
  }

  if (roleCode === "TICKET_CREATOR") {
    return [
      { label: "Tickets creados", value: String(totalTickets).padStart(2, "0"), tone: "cyan" },
      { label: "Pendientes de verificacion", value: String(pendingVerification).padStart(2, "0"), tone: "orange" },
      { label: "Observados para corregir", value: String(observed).padStart(2, "0"), tone: "red" },
      { label: "Solicitudes por responder", value: String(urgentRequests).padStart(2, "0"), tone: "lime" },
    ];
  }

  if (roleCode === "TICKET_VERIFIER") {
    return [
      { label: "Pendientes", value: String(pendingVerification).padStart(2, "0"), tone: "orange" },
      { label: "Aprobados", value: String(approved).padStart(2, "0"), tone: "lime" },
      { label: "Observados", value: String(observed).padStart(2, "0"), tone: "cyan" },
      { label: "Rechazados", value: String(context.tickets.filter((ticket) => ticket.statusCode === "RECHAZADO").length).padStart(2, "0"), tone: "red" },
    ];
  }

  return [
    { label: "Tickets visibles", value: String(totalTickets).padStart(2, "0"), tone: "cyan" },
    { label: "Aprobados vigentes", value: String(approved).padStart(2, "0"), tone: "lime" },
    { label: "Personas dentro", value: String(ingressed).padStart(2, "0"), tone: "orange" },
    { label: "Solicitudes urgentes", value: String(urgentRequests).padStart(2, "0"), tone: "red" },
  ];
}

function buildCreatorFormState(queryString, tickets, requests, emailRequests) {
  const requestCode = String(queryString.requestCode || "").trim();
  const ticketCode = String(queryString.ticketCode || "").trim();
  const emailIntakeCode = String(queryString.emailIntakeCode || "").trim();
  const sourceRequest = requestCode ? requests.find((request) => request.requestCode === requestCode) : null;
  const sourceEmail = emailIntakeCode
    ? emailRequests.find((request) => request.intakeCode === emailIntakeCode)
    : null;
  const observedTicket =
    ticketCode && sourceRequest
      ? tickets.find((ticket) => ticket.ticketCode === ticketCode)
      : ticketCode
        ? tickets.find((ticket) => ticket.ticketCode === ticketCode && ticket.statusCode === "OBSERVADO")
        : null;
  const linkedEmail = sourceEmail ||
    (observedTicket ? emailRequests.find((request) => request.relatedTicketCode === observedTicket.ticketCode) : null);
  const seed = observedTicket || sourceRequest || linkedEmail;

  return {
    requestCode: sourceRequest ? sourceRequest.requestCode : observedTicket ? observedTicket.relatedRequestCode : "",
    ticketCode: observedTicket ? observedTicket.ticketCode : "",
    emailIntakeCode: linkedEmail ? linkedEmail.intakeCode : "",
    isEditingObserved: Boolean(observedTicket),
    sourceRequest,
    sourceEmail: linkedEmail,
    observedTicket,
    fields: {
      rut: seed
        ? seed.person
          ? seed.person.rut
          : seed.rut || seed.requestedRut || ""
        : "",
      firstName: seed
        ? seed.person
          ? seed.person.firstName
          : seed.firstName || seed.requestedFirstName || ""
        : "",
      lastName: seed
        ? seed.person
          ? seed.person.lastName
          : seed.lastName || seed.requestedLastName || ""
        : "",
      company: seed ? seed.company || seed.companyName || "" : "",
      hostName: seed ? seed.hostName || "" : "",
      activityDescription: seed ? seed.activityDescription : "",
      scheduledEntryAt: seed
        ? formatDateTimeForInput(seed.scheduledEntryAt || seed.desiredEntryAt)
        : "",
      scheduledExitAt: seed
        ? formatDateTimeForInput(seed.scheduledExitAt || seed.desiredExitAt)
        : "",
      ticketNotes: seed
        ? seed.ticketNotes || seed.notes || seed.body || ""
        : "",
    },
  };
}

async function buildDashboardViewModel(currentUser, queryString = {}) {
  await syncExpiredTickets();

  const systemSettings = await getSystemSettings();
  const [users, tickets, requests, accessEvents, auditLogs, emailRequests, attachments] = await Promise.all([
    listManagedUsers(),
    listTickets(),
    listOperatorRequests(),
    listAccessEvents(),
    listAuditLogs(),
    listEmailIntakeRequests(),
    listAttachments(),
  ]);

  const ui = roleExperience[currentUser.roleCode] || roleExperience.ADMIN;
  const currentRole = roles.find((role) => role.code === currentUser.roleCode);
  const filters = buildReportFilters(queryString);
  const visibleTickets = filterTickets(tickets, filters);
  const visibleRequests = filterRequests(requests, filters);
  const visibleEvents = filterEvents(accessEvents, filters);
  const visibleAuditLogs = filterAuditLogs(auditLogs, filters);
  const emailAttachmentsByRequestId = groupAttachmentsByEntity(attachments, "EMAIL_INTAKE");
  const creatorForm = buildCreatorFormState(queryString, tickets, requests, emailRequests);
  const lookupRut = String(queryString.lookupRut || "").trim() || quickChecks[0].rut;
  const initialAccessResult = buildAccessDecision({
    rawRut: lookupRut,
    tickets,
    accessEvents,
    settings: systemSettings,
  });
  const observedTickets = tickets.filter((ticket) => ticket.statusCode === "OBSERVADO");
  const verificationQueue = tickets.filter((ticket) =>
    ["PENDIENTE_VERIFICACION", "OBSERVADO"].includes(ticket.statusCode)
  );
  const recentVerifications = tickets
    .filter((ticket) => ["APROBADO", "OBSERVADO", "RECHAZADO"].includes(ticket.statusCode))
    .slice(0, 6);

  return {
    currentUser,
    currentRole,
    ui,
    roles,
    workflowSteps,
    operationWindow: buildOperationWindow(),
    systemSettings,
    passwordPolicySummary: buildPasswordPolicySummary(getPasswordPolicy(systemSettings)),
    summaryCards: buildSummaryCards(currentUser.roleCode, {
      users,
      tickets,
      requests,
    }),
    tickets: visibleTickets,
    allTickets: tickets,
    operatorRequests: visibleRequests,
    allRequests: requests,
    accessEvents: visibleEvents.slice(0, 20),
    auditLogs: visibleAuditLogs.slice(0, 20),
    quickChecks,
    managedUsers: users,
    adminForm: {
      fields: {
        fullName: String(queryString.fullName || "").trim(),
        username: String(queryString.username || "").trim(),
        email: String(queryString.email || "").trim(),
        roleCode: String(queryString.roleCode || "OPERATOR").trim(),
      },
    },
    creatorForm,
    emailIntakeForm: {
      fields: {
        senderName: String(queryString.senderName || "").trim(),
        senderEmail: String(queryString.senderEmail || "").trim(),
        subject: String(queryString.subject || "").trim(),
        body: String(queryString.body || "").trim(),
        companyName: String(queryString.companyName || "").trim(),
        requestedRut: String(queryString.requestedRut || "").trim(),
        requestedFirstName: String(queryString.requestedFirstName || "").trim(),
        requestedLastName: String(queryString.requestedLastName || "").trim(),
        hostName: String(queryString.emailHostName || "").trim(),
        activityDescription: String(queryString.emailActivityDescription || "").trim(),
        desiredEntryAt: String(queryString.emailDesiredEntryAt || "").trim(),
        desiredExitAt: String(queryString.emailDesiredExitAt || "").trim(),
        notes: String(queryString.emailNotes || "").trim(),
      },
    },
    observedTickets,
    verificationQueue,
    recentVerifications,
    emailRequests,
    emailAttachmentsByRequestId,
    initialAccessResult,
    serializedInitialAccessResult: JSON.stringify(initialAccessResult),
    noticeMessage: String(queryString.notice || ""),
    errorMessage: String(queryString.error || ""),
    availableRoles: roles,
    filters,
    statusOptions: [
      "PENDIENTE_VERIFICACION",
      "OBSERVADO",
      "APROBADO",
      "RECHAZADO",
      "INGRESADO",
      "SALIDA_REGISTRADA",
      "VENCIDO",
    ],
    requestStatusOptions: [
      "PENDIENTE_RESPUESTA",
      "EN_REVISION",
      "APROBADA",
      "RECHAZADA",
      "CERRADA",
    ],
    reportLinks: {
      ticketsCsv: `/reports/tickets.csv${buildQuerySuffix(filters)}`,
      accessEventsCsv: `/reports/access-events.csv${buildQuerySuffix(filters)}`,
    },
    securityForm: systemSettings.SECURITY,
    operationSettingsForm: systemSettings.OPERATION,
    emailSettingsForm: systemSettings.EMAIL_INTAKE,
    accountSecurityForm: {
      fields: {
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      },
    },
  };
}

app.use(
  asyncHandler(async (req, res, next) => {
    const settings = await getSystemSettings();
    req.systemSettings = settings;
    res.locals.systemSettings = settings;

    const cookies = parseCookies(req.headers.cookie);
    const csrfFromCookie = readSignedToken(cookies[CSRF_COOKIE_NAME], "csrf");
    const csrfToken = csrfFromCookie || crypto.randomBytes(24).toString("hex");
    req.csrfToken = csrfToken;
    res.locals.csrfToken = csrfToken;
    if (!csrfFromCookie) {
      setCsrfCookie(res, csrfToken, settings);
    }

    const sessionPayload = readSessionPayload(cookies[SESSION_COOKIE_NAME]);
    if (!sessionPayload) {
      req.currentUser = null;
      res.locals.currentUser = null;
      return next();
    }

    if (Date.now() - Number(sessionPayload.lastActivityAt || 0) > getSessionTimeoutMs(settings)) {
      clearSessionCookie(res, settings);
      clearCsrfCookie(res, settings);
      req.currentUser = null;
      res.locals.currentUser = null;
      return next();
    }

    const currentUser = await getUserById(sessionPayload.userId);
    if (!currentUser || !currentUser.isActive) {
      clearSessionCookie(res, settings);
      clearCsrfCookie(res, settings);
      req.currentUser = null;
      res.locals.currentUser = null;
      return next();
    }

    req.currentUser = currentUser;
    res.locals.currentUser = currentUser;
    setSessionCookie(res, currentUser, settings);
    return next();
  })
);

app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  if (req.path === "/api/email-intake") {
    return next();
  }

  const requestToken = getCsrfTokenFromRequest(req);
  if (!requestToken || requestToken !== req.csrfToken) {
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ error: "Token CSRF invalido o ausente." });
    }

    if (req.currentUser) {
      return redirectToDashboard(res, { error: "La sesion del formulario expiro. Vuelve a intentarlo." });
    }

    return res.status(403).render("login", {
      errorMessage: "La sesion del formulario expiro. Recarga la pagina e intenta nuevamente.",
      lastUsername: String(req.body.username || ""),
      demoAccounts: buildDemoAccounts(),
      showDemoCredentials: normalizeBoolean(req.systemSettings?.SECURITY?.showDemoCredentials, false),
    });
  }

  return next();
});

function requireAuthPage(req, res, next) {
  if (!req.currentUser) {
    return res.redirect("/");
  }

  return next();
}

function requireAuthApi(req, res, next) {
  if (!req.currentUser) {
    return res.status(401).json({ error: "No autenticado" });
  }

  return next();
}

function requireRole(allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.currentUser) {
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "No autenticado" });
      }
      return res.redirect("/");
    }

    if (!allowedRoles.includes(req.currentUser.roleCode)) {
      if (req.path.startsWith("/api/")) {
        return res.status(403).json({ error: "No autorizado" });
      }
      return res.status(403).render("login", {
        errorMessage: "No tienes permisos para realizar esa accion.",
        lastUsername: req.currentUser.username,
        demoAccounts: buildDemoAccounts(),
        showDemoCredentials: normalizeBoolean(req.systemSettings?.SECURITY?.showDemoCredentials, false),
      });
    }

    return next();
  };
}

app.get("/", (req, res) => {
  if (req.currentUser) {
    return res.redirect("/dashboard");
  }

  return res.render("login", {
    errorMessage: null,
    lastUsername: "",
    demoAccounts: buildDemoAccounts(),
    showDemoCredentials: normalizeBoolean(req.systemSettings?.SECURITY?.showDemoCredentials, false),
  });
});

app.post(
  "/login",
  asyncHandler(async (req, res) => {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();
    const account = await getUserByUsername(username);
    const settings = req.systemSettings || (await getSystemSettings());
    const loginBlockState = getLoginBlockState(req, username);

    if (loginBlockState.blocked) {
      return res.status(429).render("login", {
        errorMessage: `Cuenta temporalmente bloqueada por intentos fallidos. Intenta nuevamente en ${loginBlockState.remainingMinutes} minuto(s).`,
        lastUsername: username,
        demoAccounts: buildDemoAccounts(),
        showDemoCredentials: normalizeBoolean(settings.SECURITY.showDemoCredentials, false),
      });
    }

    const alternateMatch = demoAccounts.find(
      (item) =>
        item.username === username &&
        Array.isArray(item.alternatePasswords) &&
        item.alternatePasswords.includes(password)
    );
    const isPasswordValid =
      account &&
      ((await bcrypt.compare(password, account.passwordHash)) || Boolean(alternateMatch));

    if (account && !account.isActive) {
      return res.status(403).render("login", {
        errorMessage: "La cuenta esta bloqueada. Solo el administrador puede reactivarla.",
        lastUsername: username,
        demoAccounts: buildDemoAccounts(),
        showDemoCredentials: normalizeBoolean(settings.SECURITY.showDemoCredentials, false),
      });
    }

    if (!account || !isPasswordValid) {
      const failureState = registerLoginFailure(req, username, settings);
      await withTransaction(async (client) => {
        await insertAuditLog(client, {
          userId: account ? account.id : null,
          entityType: "SESSION",
          entityId: account ? account.id : null,
          action: "LOGIN_FAILURE",
          details: {
            username,
            blockedUntil: failureState.blockedUntil || null,
            ipAddress: getClientAddress(req),
          },
        });
      });
      return res.status(401).render("login", {
        errorMessage:
          failureState.blockedUntil && failureState.blockedUntil > Date.now()
            ? `Usuario o contrasena incorrectos. El acceso se bloqueo temporalmente por seguridad durante ${settings.SECURITY.lockoutMinutes} minuto(s).`
            : "Usuario o contrasena incorrectos.",
        lastUsername: username,
        demoAccounts: buildDemoAccounts(),
        showDemoCredentials: normalizeBoolean(settings.SECURITY.showDemoCredentials, false),
      });
    }

    clearLoginFailures(req, username);
    setSessionCookie(res, account, settings);
    setCsrfCookie(res, req.csrfToken, settings);
    await withTransaction(async (client) => {
      await insertAuditLog(client, {
        userId: account.id,
        entityType: "SESSION",
        entityId: account.id,
        action: "LOGIN_SUCCESS",
        details: {
          username: account.username,
        },
      });
    });

    return res.redirect("/dashboard");
  })
);

app.post(
  "/logout",
  asyncHandler(async (req, res) => {
    if (req.currentUser) {
      await withTransaction(async (client) => {
        await insertAuditLog(client, {
          userId: req.currentUser.id,
          entityType: "SESSION",
          entityId: req.currentUser.id,
          action: "LOGOUT",
          details: {
            username: req.currentUser.username,
          },
        });
      });
    }

    clearSessionCookie(res, req.systemSettings);
    clearCsrfCookie(res, req.systemSettings);
    return res.redirect("/");
  })
);

app.get(
  "/dashboard",
  requireAuthPage,
  asyncHandler(async (req, res) => {
    const viewModel = await buildDashboardViewModel(req.currentUser, req.query);
    return res.render("index", viewModel);
  })
);

app.post(
  "/account/password",
  requireAuthPage,
  asyncHandler(async (req, res) => {
    try {
      await changePasswordAction(req.body, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: "La contrasena fue actualizada correctamente.",
        },
        "#account-security"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#account-security");
    }
  })
);

app.post(
  "/admin/users",
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      const createdUser = await createUserAction(req.body, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: `Usuario @${createdUser.username} creado con rol ${roleLabel(createdUser.roleCode)}. Clave temporal: ${createdUser.password}`,
        },
        "#admin-tools"
      );
    } catch (error) {
      return redirectToDashboard(
        res,
        {
          error: error.message,
          fullName: req.body.fullName,
          username: req.body.username,
          email: req.body.email,
          roleCode: req.body.roleCode,
        },
        "#admin-tools"
      );
    }
  })
);

app.post(
  "/admin/users/:username/toggle-status",
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      const newStatus = await toggleUserStatusAction(req.params.username, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice:
            newStatus === "ACTIVE"
              ? `La cuenta @${req.params.username} fue reactivada.`
              : `La cuenta @${req.params.username} fue bloqueada.`,
        },
        "#admin-tools"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#admin-tools");
    }
  })
);

app.post(
  "/admin/settings/security",
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      const payload = buildSecuritySettingsPayload(req.body);
      await saveSystemSettings("SECURITY", payload, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: "La configuracion de seguridad fue actualizada.",
        },
        "#admin-settings"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#admin-settings");
    }
  })
);

app.post(
  "/admin/settings/operation",
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      const payload = buildOperationSettingsPayload(req.body);
      await saveSystemSettings("OPERATION", payload, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: "La configuracion operativa fue actualizada.",
        },
        "#admin-settings"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#admin-settings");
    }
  })
);

app.post(
  "/admin/settings/email-intake",
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      const payload = buildEmailSettingsPayload(req.body);
      await saveSystemSettings("EMAIL_INTAKE", payload, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: "La configuracion del correo entrante fue actualizada.",
        },
        "#admin-settings"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#admin-settings");
    }
  })
);

app.post(
  "/creator/requests/:requestCode/take",
  requireRole(["TICKET_CREATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      await takeRequestAction(req.params.requestCode, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: `Solicitud ${req.params.requestCode} tomada para revision.`,
          requestCode: req.params.requestCode,
        },
        "#creator-tools"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#creator-tools");
    }
  })
);

app.post(
  "/creator/requests/:requestCode/reject",
  requireRole(["TICKET_CREATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      await rejectRequestAction(req.params.requestCode, req.currentUser, req.body.responseNotes);
      return redirectToDashboard(
        res,
        {
          notice: `Solicitud ${req.params.requestCode} rechazada.`,
        },
        "#creator-tools"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#creator-tools");
    }
  })
);

app.post(
  "/creator/email-intake",
  requireRole(["TICKET_CREATOR", "ADMIN"]),
  upload.array("attachments", 5),
  asyncHandler(async (req, res) => {
    try {
      const intakeCode = await createEmailIntakeAction(req.body, req.files, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: `Correo ${intakeCode} registrado en la bandeja del creador.`,
        },
        "#creator-tools"
      );
    } catch (error) {
      removeUploadedFiles(req.files);
      return redirectToDashboard(
        res,
        {
          error: error.message,
          ...sanitizeEmailIntakeQuery(req.body),
        },
        "#creator-tools"
      );
    }
  })
);

app.post(
  "/creator/email-intake/:intakeCode/take",
  requireRole(["TICKET_CREATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      await updateEmailIntakeStatusAction(
        req.params.intakeCode,
        "IN_REVIEW",
        req.currentUser,
        `Correo ${req.params.intakeCode} tomado por ${req.currentUser.fullName}.`
      );
      return redirectToDashboard(
        res,
        {
          notice: `Correo ${req.params.intakeCode} tomado para revision.`,
          emailIntakeCode: req.params.intakeCode,
        },
        "#creator-tools"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#creator-tools");
    }
  })
);

app.post(
  "/creator/email-intake/:intakeCode/dismiss",
  requireRole(["TICKET_CREATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      await updateEmailIntakeStatusAction(
        req.params.intakeCode,
        "DISMISSED",
        req.currentUser,
        String(req.body.dismissNotes || "").trim() || `Correo ${req.params.intakeCode} descartado por el creador.`
      );
      return redirectToDashboard(
        res,
        {
          notice: `Correo ${req.params.intakeCode} descartado.`,
        },
        "#creator-tools"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#creator-tools");
    }
  })
);

app.post(
  "/creator/tickets",
  requireRole(["TICKET_CREATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      const result = await createOrUpdateTicketAction(req.body, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice:
            result.mode === "created"
              ? `Ticket ${result.ticketCode} creado y enviado a verificacion.`
              : `Ticket ${result.ticketCode} corregido y reenviado a verificacion.`,
          ticketCode: result.ticketCode,
          lookupRut: req.body.rut,
        },
        "#creator-tools"
      );
    } catch (error) {
      return redirectToDashboard(
        res,
        {
          error: error.message,
          requestCode: req.body.requestCode,
          ticketCode: req.body.ticketCode,
          emailIntakeCode: req.body.emailIntakeCode,
        },
        "#creator-tools"
      );
    }
  })
);

app.post(
  "/verifier/tickets/:ticketCode/decision",
  requireRole(["TICKET_VERIFIER", "ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      const nextStatus = await decideTicketAction(
        req.params.ticketCode,
        req.body.decision,
        req.body.notes,
        req.currentUser
      );
      return redirectToDashboard(
        res,
        {
          notice: `Ticket ${req.params.ticketCode} ${nextStatus.toLowerCase()} correctamente.`,
        },
        "#verification-tools"
      );
    } catch (error) {
      return redirectToDashboard(res, { error: error.message }, "#verification-tools");
    }
  })
);

app.post(
  "/operator/check-in",
  requireRole(["OPERATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      await checkInAction(req.body, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: `Entrada registrada para el ticket ${req.body.ticketCode}.`,
          lookupRut: req.body.rut,
        },
        "#operator-tools"
      );
    } catch (error) {
      return redirectToDashboard(
        res,
        {
          error: error.message,
          lookupRut: req.body.rut,
        },
        "#operator-tools"
      );
    }
  })
);

app.post(
  "/operator/check-out",
  requireRole(["OPERATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      await checkOutAction(req.body, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: `Salida registrada para el ticket ${req.body.ticketCode}.`,
          lookupRut: req.body.rut,
        },
        "#operator-tools"
      );
    } catch (error) {
      return redirectToDashboard(
        res,
        {
          error: error.message,
          lookupRut: req.body.rut,
        },
        "#operator-tools"
      );
    }
  })
);

app.post(
  "/operator/requests",
  requireRole(["OPERATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    try {
      const requestCode = await createOperatorRequestAction(req.body, req.currentUser);
      return redirectToDashboard(
        res,
        {
          notice: `Solicitud urgente ${requestCode} enviada al creador de tickets.`,
          lookupRut: req.body.rut,
        },
        "#operator-tools"
      );
    } catch (error) {
      return redirectToDashboard(
        res,
        {
          error: error.message,
          lookupRut: req.body.rut,
        },
        "#operator-tools"
      );
    }
  })
);

app.get(
  "/reports/tickets.csv",
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const tickets = filterTickets(await listTickets(), buildReportFilters(req.query));
    const csv = toCsv(
      [
        { key: "ticketCode", label: "Ticket" },
        { key: "rut", label: "RUT" },
        { key: "personName", label: "Persona" },
        { key: "company", label: "Empresa" },
        { key: "hostName", label: "Responsable" },
        { key: "statusLabel", label: "Estado" },
        { key: "scheduledEntryLabel", label: "Entrada" },
        { key: "scheduledExitLabel", label: "Salida" },
      ],
      tickets.map((ticket) => ({
        ticketCode: ticket.ticketCode,
        rut: ticket.person.rut,
        personName: ticket.person.fullName,
        company: ticket.company,
        hostName: ticket.hostName,
        statusLabel: ticket.statusLabel,
        scheduledEntryLabel: ticket.scheduledEntryLabel,
        scheduledExitLabel: ticket.scheduledExitLabel,
      }))
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="tickets-fix-access.csv"');
    return res.send(csv);
  })
);

app.get(
  "/reports/access-events.csv",
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const events = filterEvents(await listAccessEvents(), buildReportFilters(req.query));
    const csv = toCsv(
      [
        { key: "observedAtLabel", label: "Fecha" },
        { key: "ticketCode", label: "Ticket" },
        { key: "rut", label: "RUT" },
        { key: "personName", label: "Persona" },
        { key: "company", label: "Empresa" },
        { key: "eventTypeLabel", label: "Evento" },
        { key: "sourceLabel", label: "Origen" },
        { key: "operatorName", label: "Operador" },
        { key: "notes", label: "Notas" },
      ],
      events
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="accesos-fix-access.csv"');
    return res.send(csv);
  })
);

app.get(
  "/attachments/:attachmentId/download",
  requireAuthPage,
  asyncHandler(async (req, res) => {
    const attachmentId = Number(req.params.attachmentId);
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
      return res.status(400).send("Adjunto invalido.");
    }

    const result = await query(
      `
        SELECT id, original_name, mime_type, file_path
        FROM attachments
        WHERE id = $1
        LIMIT 1
      `,
      [attachmentId]
    );

    if (!result.rows[0]) {
      return res.status(404).send("No se encontro el adjunto solicitado.");
    }

    if (!fs.existsSync(result.rows[0].file_path)) {
      return res.status(404).send("El archivo solicitado ya no se encuentra disponible.");
    }

    res.type(result.rows[0].mime_type || "application/octet-stream");
    return res.download(result.rows[0].file_path, result.rows[0].original_name);
  })
);

app.get(
  "/health",
  asyncHandler(async (_req, res) => {
    await query("SELECT 1");
    res.json({
      ok: true,
      service: "fix-access",
      port: PORT,
      operationWindow: buildOperationWindow().label,
      database: "up",
    });
  })
);

app.get(
  "/api/tickets",
  requireAuthApi,
  asyncHandler(async (req, res) => {
    const tickets = filterTickets(await listTickets(), buildReportFilters(req.query));
    return res.json({ items: tickets });
  })
);

app.get(
  "/api/operator-requests",
  requireAuthApi,
  asyncHandler(async (req, res) => {
    const requests = filterRequests(await listOperatorRequests(), buildReportFilters(req.query));
    return res.json({ items: requests });
  })
);

app.get(
  "/api/access-events",
  requireAuthApi,
  asyncHandler(async (req, res) => {
    const events = filterEvents(await listAccessEvents(), buildReportFilters(req.query));
    return res.json({ items: events });
  })
);

app.get(
  "/api/audit-logs",
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const logs = filterAuditLogs(await listAuditLogs(), buildReportFilters(req.query));
    return res.json({ items: logs });
  })
);

app.get(
  "/api/email-intake",
  requireRole(["TICKET_CREATOR", "ADMIN"]),
  asyncHandler(async (_req, res) => {
    const items = await listEmailIntakeRequests();
    return res.json({ items });
  })
);

app.post("/api/email-intake", upload.array("attachments", 5), async (req, res) => {
  try {
    const settings = req.systemSettings || (await getSystemSettings());
    const expectedToken = String(settings.EMAIL_INTAKE.webhookToken || DEFAULT_WEBHOOK_TOKEN).trim();
    const requestToken = String(req.headers["x-webhook-token"] || req.body?.webhookToken || req.query?.webhookToken || "").trim();

    if (!expectedToken) {
      removeUploadedFiles(req.files);
      return res.status(503).json({ error: "El webhook de correo entrante no tiene token configurado." });
    }

    if (requestToken !== expectedToken) {
      removeUploadedFiles(req.files);
      return res.status(403).json({ error: "Webhook token invalido." });
    }

    const intakeCode = await createEmailIntakeAction(req.body, req.files, null, true);
    return res.status(201).json({ ok: true, intakeCode });
  } catch (error) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: error.message || "No fue posible registrar el correo entrante." });
  }
});

app.get(
  "/api/access/check",
  requireAuthApi,
  asyncHandler(async (req, res) => {
    await syncExpiredTickets();
    const settings = await getSystemSettings();
    const tickets = await listTickets();
    const accessEvents = await listAccessEvents();
    const decision = buildAccessDecision({
      rawRut: String(req.query.rut || ""),
      tickets,
      accessEvents,
      settings,
    });
    const sourceCode = String(req.query.source || "RUT").trim() || "RUT";
    await recordAccessLookup(String(req.query.rut || ""), req.currentUser, sourceCode, decision);
    return res.json(decision);
  })
);

app.post(
  "/api/access/check-in",
  requireRole(["OPERATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    await checkInAction(req.body, req.currentUser);
    return res.json({ ok: true });
  })
);

app.post(
  "/api/access/check-out",
  requireRole(["OPERATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    await checkOutAction(req.body, req.currentUser);
    return res.json({ ok: true });
  })
);

app.post(
  "/api/operator-requests",
  requireRole(["OPERATOR", "ADMIN"]),
  asyncHandler(async (req, res) => {
    const requestCode = await createOperatorRequestAction(req.body, req.currentUser);
    return res.status(201).json({ ok: true, requestCode });
  })
);

app.use((error, req, res, _next) => {
  console.error(error);
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ error: error.message || "Error interno del servidor" });
  }

  if (req.currentUser) {
    return redirectToDashboard(res, { error: error.message || "Ocurrio un error inesperado." });
  }

  return res.status(500).render("login", {
    errorMessage: error.message || "Ocurrio un error inesperado.",
    lastUsername: "",
    demoAccounts: buildDemoAccounts(),
    showDemoCredentials: normalizeBoolean(req.systemSettings?.SECURITY?.showDemoCredentials, false),
  });
});

async function initializeApp() {
  if (!initializationPromise) {
    initializationPromise = initializeDatabase();
  }
  return initializationPromise;
}

async function startServer() {
  await initializeApp();

  return new Promise((resolve) => {
    serverInstance = app.listen(PORT, () => {
      console.log(`Fix Access escuchando en http://localhost:${PORT}`);
      resolve(serverInstance);
    });
  });
}

async function closeServer() {
  if (serverInstance) {
    await new Promise((resolve, reject) => {
      serverInstance.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    serverInstance = null;
  }

  await closePool();
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("No fue posible iniciar Fix Access", error);
    process.exit(1);
  });
}

module.exports = {
  app,
  buildAccessDecision,
  closeServer,
  initializeApp,
  listAccessEvents,
  listAuditLogs,
  listOperatorRequests,
  listTickets,
  startServer,
};
