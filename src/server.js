const crypto = require("crypto");
const express = require("express");
const path = require("path");

const {
  operationWindow,
  roles,
  workflowSteps,
  tickets: seedTickets,
  operatorRequests: seedOperatorRequests,
  quickChecks,
} = require("./data/mock-data");

const app = express();
const PORT = Number(process.env.PORT || 2000);
const SESSION_COOKIE_NAME = "fix_access_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "fix-access-demo-secret";

const ticketStore = structuredClone(seedTickets);
const operatorRequestStore = structuredClone(seedOperatorRequests);

const demoUsers = {
  admin: {
    username: "admin",
    passwords: ["admin123"],
    displayPassword: "admin123",
    roleCode: "ADMIN",
    fullName: "Administrador Demo",
  },
  creador: {
    username: "creador",
    passwords: ["creador123"],
    displayPassword: "creador123",
    roleCode: "TICKET_CREATOR",
    fullName: "Creador de Ticket Demo",
  },
  verificador: {
    username: "verificador",
    passwords: ["verificador123", "verificador 123"],
    displayPassword: "verificador123",
    roleCode: "TICKET_VERIFIER",
    fullName: "Verificador Demo",
  },
  operador: {
    username: "operador",
    passwords: ["operador123"],
    displayPassword: "operador123",
    roleCode: "OPERATOR",
    fullName: "Operador Demo",
  },
};

const userStore = Object.values(demoUsers).map((user) => ({
  username: user.username,
  passwords: [...user.passwords],
  displayPassword: user.displayPassword,
  roleCode: user.roleCode,
  fullName: user.fullName,
  status: "ACTIVE",
  statusLabel: "Activa",
  createdBy: "Sistema demo",
  createdAt: operationWindow.now,
}));

const roleExperience = {
  ADMIN: {
    heading: "Panel del administrador",
    description:
      "Controlas usuarios, supervisas tickets, revisas validaciones y tienes visibilidad completa del proceso operativo.",
    modules: [
      "Crear y administrar usuarios",
      "Ver la operacion completa",
      "Supervisar solicitudes urgentes",
      "Auditar ingresos y salidas",
    ],
    sections: {
      userAdmin: true,
      roles: true,
      workflow: true,
      tickets: true,
      access: true,
      requests: true,
    },
    tableTitle: "Tickets del dia",
    tableDescription: "Vista global de la operacion con todos los estados.",
  },
  TICKET_CREATOR: {
    heading: "Panel del creador de ticket",
    description:
      "Registras visitas, completas antecedentes y conviertes las solicitudes del operador en tickets listos para verificacion.",
    modules: [
      "Crear ticket manual o desde solicitud urgente",
      "Completar datos del visitante",
      "Poner solicitudes en revision",
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
    },
    tableTitle: "Tickets creados y en seguimiento",
    tableDescription: "Aqui ves tickets listos para verificacion, observados o ya resueltos.",
  },
  TICKET_VERIFIER: {
    heading: "Panel del verificador",
    description:
      "Revisas cada ticket y decides si la visita queda aprobada, observada o rechazada antes del ingreso.",
    modules: [
      "Analizar la solicitud recibida",
      "Dejar observaciones y comentarios",
      "Aprobar o rechazar tickets",
      "Cerrar el ciclo de validacion",
    ],
    sections: {
      roles: false,
      workflow: true,
      tickets: true,
      access: false,
      requests: false,
      creatorTools: false,
      verifierTools: true,
    },
    tableTitle: "Historial de verificacion",
    tableDescription: "Registro de tickets ya aprobados, observados o rechazados.",
  },
  OPERATOR: {
    heading: "Panel del operador",
    description:
      "Validas el ingreso por RUT o carnet, registras entradas y salidas, y escalas solicitudes urgentes desde porteria.",
    modules: [
      "Consultar acceso por RUT",
      "Registrar entrada y salida",
      "Escanear carnet en Android",
      "Elevar solicitud urgente si no hay autorizacion",
    ],
    sections: {
      roles: false,
      workflow: false,
      tickets: true,
      access: true,
      requests: true,
      creatorTools: false,
      verifierTools: false,
    },
    tableTitle: "Tickets operativos",
    tableDescription: "Visitas aprobadas o en revision que impactan la atencion en porteria.",
  },
};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "public")));

function normalizeRut(value) {
  return String(value || "")
    .trim()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateTimeForInput(dateString) {
  return String(dateString || "").slice(0, 16);
}

function toOperationOffsetDateTime(dateTimeLocalValue) {
  const value = String(dateTimeLocalValue || "").trim();
  if (!value) {
    return "";
  }

  return `${value}:00-04:00`;
}

function isWithinSchedule(nowValue, startValue, endValue) {
  const now = new Date(nowValue).getTime();
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  return now >= start && now <= end;
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((item) => item.trim())
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

function createSessionCookieValue(user) {
  const payload = {
    username: user.username,
    roleCode: user.roleCode,
    fullName: user.fullName,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function findUserByUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  return userStore.find((user) => user.username === normalizedUsername) || null;
}

function isUserActive(user) {
  return Boolean(user) && user.status === "ACTIVE";
}

function buildUserStatusLabel(status) {
  return status === "BLOCKED" ? "Bloqueada" : "Activa";
}

function readSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionValue = cookies[SESSION_COOKIE_NAME];

  if (!sessionValue || !sessionValue.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = sessionValue.split(".");
  if (!encodedPayload || !signature || signValue(encodedPayload) !== signature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const account = findUserByUsername(payload.username);
    if (!account || account.roleCode !== payload.roleCode || !isUserActive(account)) {
      return null;
    }

    return {
      username: account.username,
      roleCode: account.roleCode,
      fullName: account.fullName,
    };
  } catch (_error) {
    return null;
  }
}

function setSessionCookie(res, user) {
  const value = createSessionCookieValue(user);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function passwordMatches(account, password) {
  return Array.isArray(account.passwords) && account.passwords.includes(password);
}

function requireAuthPage(req, res, next) {
  if (!req.currentUser) {
    return res.redirect("/");
  }

  return next();
}

function requireAuthApi(req, res, next) {
  if (!req.currentUser) {
    return res.status(401).json({
      ok: false,
      error: "auth_required",
      message: "Debes iniciar sesion para usar este endpoint.",
    });
  }

  return next();
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.currentUser) {
      return res.redirect("/");
    }

    if (!allowedRoles.includes(req.currentUser.roleCode)) {
      return redirectToDashboard(res, {
        error: "Tu rol no tiene permiso para ejecutar esa accion.",
      });
    }

    return next();
  };
}

function redirectToDashboard(res, params = {}, hash = "") {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();
  const querySuffix = query ? `?${query}` : "";
  res.redirect(`/dashboard${querySuffix}${hash}`);
}

function buildDisplayNote(ticket) {
  return ticket.verificationNotes || ticket.notes || "Sin observaciones registradas.";
}

function buildGenericSummary() {
  const approved = ticketStore.filter((ticket) => ticket.status === "APROBADO").length;
  const pending = ticketStore.filter((ticket) =>
    ["PENDIENTE_VERIFICACION", "OBSERVADO"].includes(ticket.status)
  ).length;
  const urgentRequests = operatorRequestStore.filter((request) =>
    ["PENDIENTE_RESPUESTA", "EN_REVISION"].includes(request.status)
  ).length;

  return [
    {
      label: "Tickets del dia",
      value: String(ticketStore.length).padStart(2, "0"),
      tone: "lime",
    },
    {
      label: "Tickets aprobados",
      value: String(approved).padStart(2, "0"),
      tone: "cyan",
    },
    {
      label: "Pendientes de revision",
      value: String(pending).padStart(2, "0"),
      tone: "orange",
    },
    {
      label: "Solicitudes urgentes",
      value: String(urgentRequests).padStart(2, "0"),
      tone: "red",
    },
  ];
}

function buildSummaryForRole(roleCode) {
  const approved = ticketStore.filter((ticket) => ticket.status === "APROBADO").length;
  const pendingVerification = ticketStore.filter(
    (ticket) => ticket.status === "PENDIENTE_VERIFICACION"
  ).length;
  const observed = ticketStore.filter((ticket) => ticket.status === "OBSERVADO").length;
  const rejected = ticketStore.filter((ticket) => ticket.status === "RECHAZADO").length;
  const urgentRequests = operatorRequestStore.filter((request) =>
    ["PENDIENTE_RESPUESTA", "EN_REVISION"].includes(request.status)
  ).length;
  const activeUsers = userStore.filter((user) => user.status === "ACTIVE").length;
  const activeOperators = userStore.filter(
    (user) => user.roleCode === "OPERATOR" && user.status === "ACTIVE"
  ).length;
  const liveApproved = ticketStore.filter(
    (ticket) =>
      ticket.status === "APROBADO" &&
      isWithinSchedule(operationWindow.now, ticket.scheduledEntryAt, ticket.scheduledExitAt)
  ).length;

  if (roleCode === "ADMIN") {
    return [
      {
        label: "Usuarios activos",
        value: String(activeUsers).padStart(2, "0"),
        tone: "lime",
      },
      {
        label: "Operadores activos",
        value: String(activeOperators).padStart(2, "0"),
        tone: "cyan",
      },
      {
        label: "Tickets del dia",
        value: String(ticketStore.length).padStart(2, "0"),
        tone: "orange",
      },
      {
        label: "Solicitudes urgentes",
        value: String(urgentRequests).padStart(2, "0"),
        tone: "red",
      },
    ];
  }

  if (roleCode === "TICKET_CREATOR") {
    return [
      {
        label: "Tickets registrados",
        value: String(ticketStore.length).padStart(2, "0"),
        tone: "lime",
      },
      {
        label: "Listos para verificacion",
        value: String(pendingVerification).padStart(2, "0"),
        tone: "cyan",
      },
      {
        label: "Tickets observados",
        value: String(observed).padStart(2, "0"),
        tone: "orange",
      },
      {
        label: "Solicitudes del operador",
        value: String(urgentRequests).padStart(2, "0"),
        tone: "red",
      },
    ];
  }

  if (roleCode === "TICKET_VERIFIER") {
    return [
      {
        label: "Pendientes por revisar",
        value: String(pendingVerification).padStart(2, "0"),
        tone: "orange",
      },
      {
        label: "Observados",
        value: String(observed).padStart(2, "0"),
        tone: "cyan",
      },
      {
        label: "Aprobados",
        value: String(approved).padStart(2, "0"),
        tone: "lime",
      },
      {
        label: "Rechazados",
        value: String(rejected).padStart(2, "0"),
        tone: "red",
      },
    ];
  }

  if (roleCode === "OPERATOR") {
    return [
      {
        label: "Accesos autorizados",
        value: String(liveApproved).padStart(2, "0"),
        tone: "lime",
      },
      {
        label: "Tickets aun pendientes",
        value: String(pendingVerification + observed).padStart(2, "0"),
        tone: "orange",
      },
      {
        label: "Urgencias abiertas",
        value: String(urgentRequests).padStart(2, "0"),
        tone: "cyan",
      },
      {
        label: "Ingresos rechazados",
        value: String(rejected).padStart(2, "0"),
        tone: "red",
      },
    ];
  }

  return buildGenericSummary();
}

function buildAccessDecision(rawRut) {
  const cleanRut = normalizeRut(rawRut);
  const matchingTickets = ticketStore.filter(
    (ticket) => normalizeRut(ticket.person.rut) === cleanRut
  );

  if (!matchingTickets.length) {
    return {
      allowed: false,
      severity: "denied",
      icon: "X",
      title: "Acceso denegado",
      message:
        "La persona no tiene un ticket registrado para la operacion actual. Puedes elevar una solicitud urgente desde el modulo del operador.",
      rut: rawRut || "",
      statusLabel: "Sin registro",
      actionLabel: "Elevar solicitud de acceso",
      personName: "Sin coincidencias",
      company: "No disponible",
      hostName: "No disponible",
      ticketCode: "-",
      scheduleLabel: "Sin horario autorizado",
    };
  }

  const approvedTicket = matchingTickets.find(
    (ticket) =>
      ticket.status === "APROBADO" &&
      isWithinSchedule(
        operationWindow.now,
        ticket.scheduledEntryAt,
        ticket.scheduledExitAt
      )
  );

  if (approvedTicket) {
    return {
      allowed: true,
      severity: "allowed",
      icon: "OK",
      title: "Acceso autorizado",
      message:
        "La persona cuenta con un ticket vigente y puede ingresar a las dependencias para recibir instrucciones de seguridad.",
      rut: approvedTicket.person.rut,
      statusLabel: approvedTicket.statusLabel,
      actionLabel: "Registrar entrada",
      personName: `${approvedTicket.person.firstName} ${approvedTicket.person.lastName}`,
      company: approvedTicket.company,
      hostName: approvedTicket.hostName,
      ticketCode: approvedTicket.ticketCode,
      scheduleLabel: `${formatDateTime(
        approvedTicket.scheduledEntryAt
      )} a ${formatDateTime(approvedTicket.scheduledExitAt)}`,
    };
  }

  const pendingTicket = matchingTickets.find((ticket) =>
    ["PENDIENTE_VERIFICACION", "OBSERVADO"].includes(ticket.status)
  );

  if (pendingTicket) {
    return {
      allowed: false,
      severity: "warning",
      icon: "!",
      title: "Ticket aun no habilitado",
      message:
        "Existe una solicitud en proceso, pero todavia no esta aprobada por verificacion. El operador debe esperar respuesta o generar seguimiento.",
      rut: pendingTicket.person.rut,
      statusLabel: pendingTicket.statusLabel,
      actionLabel: "Esperar respuesta del creador",
      personName: `${pendingTicket.person.firstName} ${pendingTicket.person.lastName}`,
      company: pendingTicket.company,
      hostName: pendingTicket.hostName,
      ticketCode: pendingTicket.ticketCode,
      scheduleLabel: `${formatDateTime(
        pendingTicket.scheduledEntryAt
      )} a ${formatDateTime(pendingTicket.scheduledExitAt)}`,
    };
  }

  const rejectedTicket = matchingTickets.find((ticket) => ticket.status === "RECHAZADO");

  if (rejectedTicket) {
    return {
      allowed: false,
      severity: "denied",
      icon: "X",
      title: "Ingreso rechazado",
      message:
        "La persona si figura en el sistema, pero su ticket fue rechazado o no esta vigente para el horario consultado.",
      rut: rejectedTicket.person.rut,
      statusLabel: rejectedTicket.statusLabel,
      actionLabel: "Solicitar nueva autorizacion",
      personName: `${rejectedTicket.person.firstName} ${rejectedTicket.person.lastName}`,
      company: rejectedTicket.company,
      hostName: rejectedTicket.hostName,
      ticketCode: rejectedTicket.ticketCode,
      scheduleLabel: `${formatDateTime(
        rejectedTicket.scheduledEntryAt
      )} a ${formatDateTime(rejectedTicket.scheduledExitAt)}`,
    };
  }

  const fallbackTicket = matchingTickets[0];
  return {
    allowed: false,
    severity: "warning",
    icon: "?",
    title: "Revision manual requerida",
    message:
      "La persona tiene informacion en el sistema, pero no hay una autorizacion operativa lista para este momento.",
    rut: fallbackTicket.person.rut,
    statusLabel: fallbackTicket.statusLabel,
    actionLabel: "Escalar a creador de ticket",
    personName: `${fallbackTicket.person.firstName} ${fallbackTicket.person.lastName}`,
    company: fallbackTicket.company,
    hostName: fallbackTicket.hostName,
    ticketCode: fallbackTicket.ticketCode,
    scheduleLabel: `${formatDateTime(
      fallbackTicket.scheduledEntryAt
    )} a ${formatDateTime(fallbackTicket.scheduledExitAt)}`,
  };
}

function buildVisibleTickets(roleCode) {
  if (roleCode === "OPERATOR") {
    return ticketStore.filter((ticket) =>
      ["APROBADO", "PENDIENTE_VERIFICACION", "OBSERVADO", "RECHAZADO"].includes(ticket.status)
    );
  }

  if (roleCode === "TICKET_VERIFIER") {
    return ticketStore.filter((ticket) =>
      ["PENDIENTE_VERIFICACION", "OBSERVADO", "APROBADO", "RECHAZADO"].includes(ticket.status)
    );
  }

  return ticketStore;
}

function buildVerificationQueue() {
  return ticketStore
    .filter((ticket) => ["PENDIENTE_VERIFICACION", "OBSERVADO"].includes(ticket.status))
    .map((ticket) => ({
      ...ticket,
      displayNote: buildDisplayNote(ticket),
    }));
}

function buildRecentVerifications() {
  return ticketStore
    .filter((ticket) => ["APROBADO", "RECHAZADO", "OBSERVADO"].includes(ticket.status))
    .map((ticket) => ({
      ...ticket,
      displayNote: buildDisplayNote(ticket),
    }))
    .slice(0, 6);
}

function findRequestById(requestId) {
  return operatorRequestStore.find((request) => request.id === requestId) || null;
}

function buildCreatorForm(query) {
  const requestId = String(query.requestId || "").trim();
  const sourceRequest = findRequestById(requestId);

  return {
    requestId,
    sourceRequest,
    fields: {
      rut: sourceRequest ? sourceRequest.rut : "",
      firstName: sourceRequest ? sourceRequest.firstName : "",
      lastName: sourceRequest ? sourceRequest.lastName : "",
      company: sourceRequest ? sourceRequest.company : "",
      hostName: sourceRequest ? sourceRequest.hostName : "",
      activityDescription: sourceRequest ? sourceRequest.activityDescription : "",
      scheduledEntryAt: sourceRequest
        ? formatDateTimeForInput(sourceRequest.desiredEntryAt)
        : "",
      scheduledExitAt: sourceRequest ? formatDateTimeForInput(sourceRequest.desiredExitAt) : "",
      notes: sourceRequest ? sourceRequest.notes : "",
    },
  };
}

function buildAdminForm(query) {
  return {
    fields: {
      fullName: String(query.fullName || "").trim(),
      username: String(query.username || "").trim(),
      roleCode: String(query.roleCode || "OPERATOR").trim(),
    },
  };
}

function buildManagedUsers() {
  return userStore
    .map((user) => {
      const role = roles.find((item) => item.code === user.roleCode);
      return {
        ...user,
        roleName: role ? role.name : user.roleCode,
        createdAtLabel: user.createdAt ? formatDateTime(user.createdAt) : "Sin registro",
      };
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName, "es"));
}

function nextTicketCode() {
  const sequence = String(ticketStore.length + 1).padStart(3, "0");
  return `ACC-20260417-${sequence}`;
}

function buildDemoAccounts() {
  return Object.values(demoUsers).map((user) => {
    const role = roles.find((item) => item.code === user.roleCode);
    return {
      username: user.username,
      password: user.displayPassword,
      roleName: role ? role.name : user.roleCode,
    };
  });
}

function buildDashboardViewModel(currentUser, query = {}) {
  const ui = roleExperience[currentUser.roleCode] || roleExperience.ADMIN;
  const currentRole = roles.find((role) => role.code === currentUser.roleCode);
  const initialAccessResult = buildAccessDecision(quickChecks[0].rut);

  return {
    currentUser,
    currentRole,
    ui,
    operationWindow,
    roles,
    workflowSteps,
    tickets: buildVisibleTickets(currentUser.roleCode),
    operatorRequests: operatorRequestStore,
    quickChecks,
    summaryCards: buildSummaryForRole(currentUser.roleCode),
    initialAccessResult,
    serializedInitialAccessResult: JSON.stringify(initialAccessResult),
    noticeMessage: String(query.notice || ""),
    errorMessage: String(query.error || ""),
    availableRoles: roles,
    adminForm: buildAdminForm(query),
    managedUsers: buildManagedUsers(),
    creatorForm: buildCreatorForm(query),
    verificationQueue: buildVerificationQueue(),
    recentVerifications: buildRecentVerifications(),
  };
}

app.use((req, res, next) => {
  req.currentUser = readSessionFromRequest(req);
  res.locals.currentUser = req.currentUser;
  next();
});

app.get("/", (req, res) => {
  if (req.currentUser) {
    return res.redirect("/dashboard");
  }

  return res.render("login", {
    errorMessage: null,
    lastUsername: "",
    demoAccounts: buildDemoAccounts(),
  });
});

app.post("/login", (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "").trim();
  const account = findUserByUsername(username);

  if (account && !isUserActive(account)) {
    return res.status(403).render("login", {
      errorMessage: "La cuenta esta bloqueada. Solo el administrador puede reactivarla.",
      lastUsername: username,
      demoAccounts: buildDemoAccounts(),
    });
  }

  if (!account || !passwordMatches(account, password)) {
    return res.status(401).render("login", {
      errorMessage: "Usuario o contrasena incorrectos. Prueba una de las credenciales demo.",
      lastUsername: username,
      demoAccounts: buildDemoAccounts(),
    });
  }

  setSessionCookie(res, account);
  return res.redirect("/dashboard");
});

app.post("/logout", (req, res) => {
  clearSessionCookie(res);
  return res.redirect("/");
});

app.get("/dashboard", requireAuthPage, (req, res) => {
  return res.render("index", buildDashboardViewModel(req.currentUser, req.query));
});

app.post("/admin/users", requireRole(["ADMIN"]), (req, res) => {
  const fullName = String(req.body.fullName || "").trim();
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "").trim();
  const roleCode = String(req.body.roleCode || "").trim();
  const role = roles.find((item) => item.code === roleCode);
  const redirectDraft = {
    fullName,
    username,
    roleCode,
  };

  if (!fullName || !username || !password || !roleCode) {
    return redirectToDashboard(
      res,
      {
        error: "Completa nombre, usuario, contrasena y rol para crear la cuenta.",
        ...redirectDraft,
      },
      "#admin-tools"
    );
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    return redirectToDashboard(
      res,
      {
        error: "El usuario solo puede contener letras, numeros, punto, guion o guion bajo.",
        ...redirectDraft,
      },
      "#admin-tools"
    );
  }

  if (password.length < 6) {
    return redirectToDashboard(
      res,
      {
        error: "La contrasena debe tener al menos 6 caracteres.",
        ...redirectDraft,
      },
      "#admin-tools"
    );
  }

  if (!role) {
    return redirectToDashboard(
      res,
      {
        error: "Selecciona un rol valido para el nuevo usuario.",
        ...redirectDraft,
      },
      "#admin-tools"
    );
  }

  if (findUserByUsername(username)) {
    return redirectToDashboard(
      res,
      {
        error: `El usuario @${username} ya existe en el sistema.`,
        ...redirectDraft,
      },
      "#admin-tools"
    );
  }

  userStore.unshift({
    username,
    passwords: [password],
    displayPassword: password,
    roleCode,
    fullName,
    status: "ACTIVE",
    statusLabel: buildUserStatusLabel("ACTIVE"),
    createdBy: req.currentUser.fullName,
    createdAt: new Date().toISOString(),
  });

  return redirectToDashboard(
    res,
    {
      notice: `Usuario @${username} creado correctamente con rol ${role.name}.`,
    },
    "#admin-tools"
  );
});

app.post("/admin/users/:username/toggle-status", requireRole(["ADMIN"]), (req, res) => {
  const username = normalizeUsername(req.params.username);
  const account = findUserByUsername(username);

  if (!account) {
    return redirectToDashboard(
      res,
      {
        error: "No se encontro la cuenta indicada.",
      },
      "#admin-tools"
    );
  }

  if (account.username === req.currentUser.username) {
    return redirectToDashboard(
      res,
      {
        error: "No puedes bloquear la sesion de administrador que estas usando.",
      },
      "#admin-tools"
    );
  }

  account.status = account.status === "ACTIVE" ? "BLOCKED" : "ACTIVE";
  account.statusLabel = buildUserStatusLabel(account.status);

  return redirectToDashboard(
    res,
    {
      notice:
        account.status === "ACTIVE"
          ? `La cuenta @${account.username} fue reactivada.`
          : `La cuenta @${account.username} fue bloqueada.`,
    },
    "#admin-tools"
  );
});

app.post(
  "/creator/requests/:requestId/take",
  requireRole(["TICKET_CREATOR", "ADMIN"]),
  (req, res) => {
    const request = findRequestById(req.params.requestId);
    if (!request) {
      return redirectToDashboard(res, {
        error: "No se encontro la solicitud del operador.",
      });
    }

    request.status = "EN_REVISION";
    request.statusLabel = "En revision";
    request.responseNotes = `Solicitud tomada por ${req.currentUser.fullName} para generar ticket.`;

    return redirectToDashboard(
      res,
      {
        notice: `Solicitud ${request.id} tomada para revision.`,
        requestId: request.id,
      },
      "#creator-tools"
    );
  }
);

app.post(
  "/creator/tickets",
  requireRole(["TICKET_CREATOR", "ADMIN"]),
  (req, res) => {
    const requestId = String(req.body.requestId || "").trim();
    const rut = String(req.body.rut || "").trim();
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const company = String(req.body.company || "").trim();
    const hostName = String(req.body.hostName || "").trim();
    const activityDescription = String(req.body.activityDescription || "").trim();
    const scheduledEntryAt = String(req.body.scheduledEntryAt || "").trim();
    const scheduledExitAt = String(req.body.scheduledExitAt || "").trim();
    const notes = String(req.body.notes || "").trim();

    if (
      !rut ||
      !firstName ||
      !lastName ||
      !company ||
      !hostName ||
      !activityDescription ||
      !scheduledEntryAt ||
      !scheduledExitAt
    ) {
      return redirectToDashboard(
        res,
        {
          error: "Completa todos los campos requeridos para crear el ticket.",
          requestId,
        },
        "#creator-tools"
      );
    }

    const entryValue = toOperationOffsetDateTime(scheduledEntryAt);
    const exitValue = toOperationOffsetDateTime(scheduledExitAt);
    const entryDate = new Date(entryValue);
    const exitDate = new Date(exitValue);
    if (!(entryDate instanceof Date) || Number.isNaN(entryDate.getTime())) {
      return redirectToDashboard(
        res,
        {
          error: "La fecha de entrada no es valida.",
          requestId,
        },
        "#creator-tools"
      );
    }

    if (!(exitDate instanceof Date) || Number.isNaN(exitDate.getTime()) || exitDate <= entryDate) {
      return redirectToDashboard(
        res,
        {
          error: "La fecha de salida debe ser mayor a la fecha de entrada.",
          requestId,
        },
        "#creator-tools"
      );
    }

    const ticketCode = nextTicketCode();
    const sourceRequest = requestId ? findRequestById(requestId) : null;

    const newTicket = {
      ticketCode,
      status: "PENDIENTE_VERIFICACION",
      statusLabel: "Pendiente verificacion",
      person: {
        rut,
        firstName,
        lastName,
      },
      company,
      hostName,
      activityDescription,
      scheduledEntryAt: entryValue,
      scheduledExitAt: exitValue,
      creatorName: req.currentUser.fullName,
      verifierName: null,
      notes: notes || "Ticket creado manualmente por el creador.",
      verificationNotes: "",
      relatedRequestId: sourceRequest ? sourceRequest.id : null,
    };

    ticketStore.unshift(newTicket);

    if (sourceRequest) {
      sourceRequest.status = "EN_REVISION";
      sourceRequest.statusLabel = "En revision";
      sourceRequest.responseNotes = `Ticket ${ticketCode} creado por ${req.currentUser.fullName} y enviado a verificacion.`;
    }

    return redirectToDashboard(
      res,
      {
        notice: `Ticket ${ticketCode} creado y enviado a verificacion.`,
      },
      "#creator-tools"
    );
  }
);

app.post(
  "/verifier/tickets/:ticketCode/decision",
  requireRole(["TICKET_VERIFIER", "ADMIN"]),
  (req, res) => {
    const ticketCode = String(req.params.ticketCode || "").trim();
    const decision = String(req.body.decision || "").trim();
    const notes = String(req.body.notes || "").trim();
    const ticket = ticketStore.find((item) => item.ticketCode === ticketCode);

    if (!ticket) {
      return redirectToDashboard(
        res,
        {
          error: "No se encontro el ticket indicado para verificacion.",
        },
        "#verification-tools"
      );
    }

    if (!["approve", "observe", "reject"].includes(decision)) {
      return redirectToDashboard(
        res,
        {
          error: "La decision enviada no es valida.",
        },
        "#verification-tools"
      );
    }

    ticket.verifierName = req.currentUser.fullName;

    if (decision === "approve") {
      ticket.status = "APROBADO";
      ticket.statusLabel = "Aprobado";
      ticket.verificationNotes =
        notes || "Ticket aprobado por verificacion y listo para control de acceso.";
    }

    if (decision === "observe") {
      ticket.status = "OBSERVADO";
      ticket.statusLabel = "Observado";
      ticket.verificationNotes =
        notes || "Ticket observado. Se requiere completar informacion antes de aprobar.";
    }

    if (decision === "reject") {
      ticket.status = "RECHAZADO";
      ticket.statusLabel = "Rechazado";
      ticket.verificationNotes =
        notes || "Ticket rechazado por verificacion por inconsistencia en la solicitud.";
    }

    if (ticket.relatedRequestId) {
      const relatedRequest = findRequestById(ticket.relatedRequestId);
      if (relatedRequest) {
        if (decision === "approve") {
          relatedRequest.status = "CERRADA";
          relatedRequest.statusLabel = "Cerrada";
          relatedRequest.responseNotes = `Ticket ${ticket.ticketCode} aprobado por ${req.currentUser.fullName}.`;
        }

        if (decision === "observe") {
          relatedRequest.status = "EN_REVISION";
          relatedRequest.statusLabel = "En revision";
          relatedRequest.responseNotes = `Ticket ${ticket.ticketCode} observado por ${req.currentUser.fullName}.`;
        }

        if (decision === "reject") {
          relatedRequest.status = "RECHAZADA";
          relatedRequest.statusLabel = "Rechazada";
          relatedRequest.responseNotes = `Ticket ${ticket.ticketCode} rechazado por ${req.currentUser.fullName}.`;
        }
      }
    }

    const actionLabel =
      decision === "approve"
        ? "aprobado"
        : decision === "observe"
          ? "observado"
          : "rechazado";

    return redirectToDashboard(
      res,
      {
        notice: `Ticket ${ticket.ticketCode} ${actionLabel} correctamente.`,
      },
      "#verification-tools"
    );
  }
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "fix-access",
    port: PORT,
    operationWindow: operationWindow.label,
  });
});

app.get("/api/tickets", requireAuthApi, (req, res) => {
  res.json({ items: buildVisibleTickets(req.currentUser.roleCode) });
});

app.get("/api/operator-requests", requireAuthApi, (_req, res) => {
  res.json({ items: operatorRequestStore });
});

app.get("/api/access/check", requireAuthApi, (req, res) => {
  const rut = String(req.query.rut || "");
  res.json(buildAccessDecision(rut));
});

app.listen(PORT, () => {
  console.log(`Fix Access escuchando en http://localhost:${PORT}`);
});
