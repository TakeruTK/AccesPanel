const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

process.env.TZ = "America/Santiago";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://fixaccess:fixaccess@localhost:5432/fixaccess";

const { app, initializeApp, listAccessEvents, listOperatorRequests, listTickets } = require("../src/server");
const { closePool, query, resetDatabase } = require("../src/db");

function extractCsrfToken(html) {
  const metaMatch = String(html || "").match(/<meta name="csrf-token" content="([^"]+)"/i);
  assert.ok(metaMatch, "la respuesta debe incluir un token CSRF");
  return metaMatch[1];
}

async function getCsrfToken(agent, path = "/dashboard") {
  const response = await agent.get(path).expect(200);
  return extractCsrfToken(response.text);
}

async function postFormWithCsrf(agent, path, payload, pagePath = "/dashboard", expectedStatus = 302) {
  const csrfToken = await getCsrfToken(agent, pagePath);
  return agent
    .post(path)
    .type("form")
    .send({
      ...payload,
      csrfToken,
    })
    .expect(expectedStatus);
}

async function loginAs(username, password) {
  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent, "/");
  await agent.post("/login").type("form").send({ username, password, csrfToken }).expect(302);
  return agent;
}

test.before(async () => {
  await initializeApp();
});

test.beforeEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await closePool();
});

test("el operador puede elevar una solicitud urgente", async () => {
  const agent = await loginAs("operador", "operador123");

  await postFormWithCsrf(agent, "/operator/requests", {
      rut: "17.234.567-0",
      firstName: "Rocio",
      lastName: "Paredes",
      company: "Nueva Energia",
      hostName: "Daniela Rojas",
      activityDescription: "Inspeccion de tablero principal",
      desiredEntryAt: "2026-05-05T10:00",
      desiredExitAt: "2026-05-05T12:00",
      operatorNotes: "Persona en porteria con respaldo del servicio.",
      sourceCode: "RUT",
    });

  const requests = await listOperatorRequests();
  const createdRequest = requests.find((item) => item.rut === "17.234.567-0");

  assert.ok(createdRequest, "la solicitud urgente debio haberse creado");
  assert.equal(createdRequest.statusCode, "PENDIENTE_RESPUESTA");
});

test("un ticket observado puede corregirse y reenviarse a verificacion", async () => {
  const verifierAgent = await loginAs("verificador", "verificador123");
  const pendingTicket = (await listTickets()).find((ticket) => ticket.statusCode === "PENDIENTE_VERIFICACION");

  assert.ok(pendingTicket, "debe existir un ticket pendiente para la prueba");

  await postFormWithCsrf(verifierAgent, `/verifier/tickets/${pendingTicket.ticketCode}/decision`, {
      decision: "observe",
      notes: "Falta numero de OT en la solicitud.",
    });

  const observedTicket = (await listTickets()).find((ticket) => ticket.ticketCode === pendingTicket.ticketCode);
  assert.equal(observedTicket.statusCode, "OBSERVADO");

  const creatorAgent = await loginAs("creador", "creador123");
  await postFormWithCsrf(creatorAgent, "/creator/tickets", {
      ticketCode: observedTicket.ticketCode,
      requestCode: observedTicket.relatedRequestCode,
      rut: observedTicket.person.rut,
      firstName: observedTicket.person.firstName,
      lastName: observedTicket.person.lastName,
      company: observedTicket.company,
      hostName: observedTicket.hostName,
      activityDescription: observedTicket.activityDescription,
      scheduledEntryAt: observedTicket.scheduledEntryAt,
      scheduledExitAt: observedTicket.scheduledExitAt,
      ticketNotes: "Se agrego el numero de OT y se reenvia.",
    });

  const resubmittedTicket = (await listTickets()).find((ticket) => ticket.ticketCode === observedTicket.ticketCode);
  assert.equal(resubmittedTicket.statusCode, "PENDIENTE_VERIFICACION");
});

test("el operador puede registrar entrada y salida de un ticket aprobado", async () => {
  const operatorAgent = await loginAs("operador", "operador123");
  const approvedTicket = (await listTickets()).find((ticket) => {
    if (ticket.statusCode !== "APROBADO") {
      return false;
    }

    const now = Date.now();
    return now >= new Date(ticket.scheduledEntryAt).getTime() && now <= new Date(ticket.scheduledExitAt).getTime();
  });

  assert.ok(approvedTicket, "debe existir un ticket aprobado para registrar la entrada");

  await postFormWithCsrf(operatorAgent, "/operator/check-in", {
      ticketCode: approvedTicket.ticketCode,
      rut: approvedTicket.person.rut,
      sourceCode: "RUT",
    });

  const ingressedTicket = (await listTickets()).find((ticket) => ticket.ticketCode === approvedTicket.ticketCode);
  assert.equal(ingressedTicket.statusCode, "INGRESADO");

  await postFormWithCsrf(operatorAgent, "/operator/check-out", {
      ticketCode: approvedTicket.ticketCode,
      rut: approvedTicket.person.rut,
      sourceCode: "MANUAL",
    });

  const closedTicket = (await listTickets()).find((ticket) => ticket.ticketCode === approvedTicket.ticketCode);
  assert.equal(closedTicket.statusCode, "SALIDA_REGISTRADA");

  const events = await listAccessEvents();
  const ticketEvents = events.filter((event) => event.ticketCode === approvedTicket.ticketCode);
  assert.ok(ticketEvents.some((event) => event.eventTypeCode === "CHECK_IN"));
  assert.ok(ticketEvents.some((event) => event.eventTypeCode === "CHECK_OUT"));
});

test("el creador puede registrar un correo entrante con adjunto", async () => {
  const creatorAgent = await loginAs("creador", "creador123");
  const csrfToken = await getCsrfToken(creatorAgent, "/dashboard");

  await creatorAgent
    .post(`/creator/email-intake?csrfToken=${encodeURIComponent(csrfToken)}`)
    .field("senderName", "Rosa Alarcon")
    .field("senderEmail", "rosa.alarcon@proveedor.cl")
    .field("subject", "Ingreso urgente de tecnico")
    .field("body", "Solicitamos ingreso para 20.112.334-8 por atencion de bomba principal.")
    .field("companyName", "Proveedor Azul")
    .field("requestedRut", "20.112.334-8")
    .field("requestedFirstName", "Pedro")
    .field("requestedLastName", "Gallardo")
    .field("hostName", "Daniela Rojas")
    .field("activityDescription", "Atencion correctiva de bomba principal")
    .field("desiredEntryAt", "2026-05-05T11:00")
    .field("desiredExitAt", "2026-05-05T13:00")
    .field("notes", "Correo ingresado manualmente desde bandeja.")
    .attach("attachments", Buffer.from("PNG"), { filename: "respaldo.png", contentType: "image/png" })
    .expect(302);

  const emailRequests = await creatorAgent.get("/api/email-intake").expect(200);
  const createdEmail = emailRequests.body.items.find((item) => item.senderEmail === "rosa.alarcon@proveedor.cl");
  assert.ok(createdEmail, "el correo entrante debio registrarse");
  assert.equal(createdEmail.statusCode, "RECEIVED");

  const attachmentResult = await query(
    `
      SELECT COUNT(*)::int AS count
      FROM attachments
      WHERE entity_type = 'EMAIL_INTAKE' AND entity_id = $1
    `,
    [createdEmail.id]
  );
  assert.equal(Number(attachmentResult.rows[0].count), 1);
});

test("el administrador puede actualizar la politica operativa", async () => {
  const adminAgent = await loginAs("admin", "admin123");

  await postFormWithCsrf(adminAgent, "/admin/settings/operation", {
    earlyEntryToleranceMinutes: "45",
    lateExitToleranceMinutes: "60",
    defaultVisitDurationHours: "4",
    strictRutValidation: "on",
  });

  const result = await query("SELECT value FROM system_settings WHERE key = 'OPERATION' LIMIT 1");
  assert.equal(Number(result.rows[0].value.earlyEntryToleranceMinutes), 45);
  assert.equal(Number(result.rows[0].value.lateExitToleranceMinutes), 60);
  assert.equal(Number(result.rows[0].value.defaultVisitDurationHours), 4);
  assert.equal(Boolean(result.rows[0].value.strictRutValidation), true);
});
