const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const { demoAccounts } = require("./data/app-content");
const { DEFAULT_SYSTEM_SETTINGS } = require("./data/default-settings");
const { buildSeedScenario } = require("./data/seed-data");
const { normalizeRut, splitFullName } = require("./lib/rut");

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://fixaccess:fixaccess@localhost:5432/fixaccess";

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const schemaSql = fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8");

async function query(text, params = []) {
  return pool.query(text, params);
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getLookupId(client, tableName, code) {
  const result = await client.query(`SELECT id FROM ${tableName} WHERE code = $1`, [code]);
  return result.rows[0] ? result.rows[0].id : null;
}

async function upsertCompany(client, name) {
  if (!name) {
    return null;
  }

  const result = await client.query(
    `
      INSERT INTO companies (name)
      VALUES ($1)
      ON CONFLICT (name)
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `,
    [name.trim()]
  );

  return result.rows[0].id;
}

async function upsertPerson(client, person, companyId) {
  const rut = normalizeRut(person.rut);
  const result = await client.query(
    `
      INSERT INTO people (rut, first_name, last_name, company_id, is_active)
      VALUES ($1, $2, $3, $4, TRUE)
      ON CONFLICT (rut)
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        company_id = EXCLUDED.company_id,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `,
    [rut, person.firstName.trim(), person.lastName.trim(), companyId]
  );

  return result.rows[0].id;
}

async function insertTicketHistory(client, ticketId, previousStatusCode, nextStatusCode, userId, notes) {
  await client.query(
    `
      INSERT INTO ticket_status_history (
        ticket_id,
        previous_status_id,
        new_status_id,
        changed_by_user_id,
        notes
      )
      VALUES (
        $1,
        (SELECT id FROM ticket_statuses WHERE code = $2),
        (SELECT id FROM ticket_statuses WHERE code = $3),
        $4,
        $5
      )
    `,
    [ticketId, previousStatusCode, nextStatusCode, userId, notes]
  );
}

async function insertAuditLog(client, payload) {
  await client.query(
    `
      INSERT INTO audit_logs (user_id, entity_type, entity_id, action, details)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      payload.userId || null,
      payload.entityType,
      payload.entityId || null,
      payload.action,
      JSON.stringify(payload.details || {}),
    ]
  );
}

async function ensureDefaultSettings(client) {
  for (const [key, value] of Object.entries(DEFAULT_SYSTEM_SETTINGS)) {
    await client.query(
      `
        INSERT INTO system_settings (key, value, updated_by)
        VALUES ($1, $2::jsonb, NULL)
        ON CONFLICT (key) DO NOTHING
      `,
      [key, JSON.stringify(value)]
    );
  }
}

async function insertSeedUsers(client) {
  const roleIds = {};
  for (const account of demoAccounts) {
    roleIds[account.roleCode] = await getLookupId(client, "roles", account.roleCode);
  }

  let adminId = null;
  for (const account of demoAccounts) {
    const names = splitFullName(account.fullName);
    const passwordHash = await bcrypt.hash(account.password, 10);
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
      [
        roleIds[account.roleCode],
        account.username,
        account.email,
        passwordHash,
        names.firstName,
        names.lastName,
        adminId,
      ]
    );

    if (account.roleCode === "ADMIN") {
      adminId = result.rows[0].id;
      await client.query("UPDATE users SET created_by = $1 WHERE id = $1", [adminId]);
    }
  }
}

async function seedDemoData() {
  await withTransaction(async (client) => {
    await ensureDefaultSettings(client);

    const userCount = Number((await client.query("SELECT COUNT(*)::int AS count FROM users")).rows[0].count);
    if (userCount === 0) {
      await insertSeedUsers(client);
    }

    const ticketCount = Number(
      (await client.query("SELECT COUNT(*)::int AS count FROM access_tickets")).rows[0].count
    );
    const requestCount = Number(
      (await client.query("SELECT COUNT(*)::int AS count FROM operator_access_requests")).rows[0].count
    );
    const accessEventCount = Number(
      (await client.query("SELECT COUNT(*)::int AS count FROM access_events")).rows[0].count
    );
    const emailIntakeCount = Number(
      (await client.query("SELECT COUNT(*)::int AS count FROM email_intake_requests")).rows[0].count
    );

    if (ticketCount > 0 || requestCount > 0 || accessEventCount > 0 || emailIntakeCount > 0) {
      return;
    }

    const usersResult = await client.query(
      `
        SELECT u.id, u.username
        FROM users u
      `
    );
    const userIdsByUsername = usersResult.rows.reduce((accumulator, row) => {
      accumulator[row.username] = row.id;
      return accumulator;
    }, {});

    const scenario = buildSeedScenario(new Date());
    const ticketIdsByCode = {};
    const requestIdsByCode = {};
    const companyIdsByName = {};

    for (const ticket of scenario.tickets) {
      const companyId =
        companyIdsByName[ticket.company] || (await upsertCompany(client, ticket.company));
      companyIdsByName[ticket.company] = companyId;
      const personId = await upsertPerson(client, ticket.person, companyId);
      const statusId = await getLookupId(client, "ticket_statuses", ticket.statusCode);
      const creatorUserId = userIdsByUsername[ticket.creatorUsername];
      const verifierUserId = ticket.verifierUsername ? userIdsByUsername[ticket.verifierUsername] : null;

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
            verifier_user_id,
            ticket_notes,
            verification_notes,
            rejection_reason,
            created_at,
            verified_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id
        `,
        [
          ticket.ticketCode,
          personId,
          companyId,
          ticket.hostName,
          ticket.activityDescription,
          ticket.scheduledEntryAt.toISOString(),
          ticket.scheduledExitAt.toISOString(),
          statusId,
          creatorUserId,
          verifierUserId,
          ticket.ticketNotes,
          ticket.verificationNotes,
          ticket.rejectionReason || null,
        ]
      );

      ticketIdsByCode[ticket.ticketCode] = insertedTicket.rows[0].id;
      await insertTicketHistory(
        client,
        insertedTicket.rows[0].id,
        null,
        ticket.statusCode,
        verifierUserId || creatorUserId,
        ticket.verificationNotes || ticket.ticketNotes
      );
    }

    for (const request of scenario.requests) {
      const companyId =
        request.company && (companyIdsByName[request.company] || (await upsertCompany(client, request.company)));
      if (request.company) {
        companyIdsByName[request.company] = companyId;
      }

      const personId =
        request.rut && request.firstName && request.lastName
          ? await upsertPerson(
              client,
              {
                rut: request.rut,
                firstName: request.firstName,
                lastName: request.lastName,
              },
              companyId
            )
          : null;

      const statusId = await getLookupId(client, "operator_request_statuses", request.statusCode);
      const operatorUserId = userIdsByUsername[request.operatorUsername];

      const insertedRequest = await client.query(
        `
          INSERT INTO operator_access_requests (
            request_code,
            person_id,
            related_ticket_id,
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
            responded_by_user_id,
            response_notes,
            created_at,
            responded_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id
        `,
        [
          request.requestCode,
          personId,
          request.relatedTicketCode ? ticketIdsByCode[request.relatedTicketCode] || null : null,
          normalizeRut(request.rut),
          request.firstName,
          request.lastName,
          request.company,
          request.hostName,
          request.activityDescription,
          request.desiredEntryAt ? request.desiredEntryAt.toISOString() : null,
          request.desiredExitAt ? request.desiredExitAt.toISOString() : null,
          request.notes,
          statusId,
          operatorUserId,
          request.statusCode === "PENDIENTE_RESPUESTA" ? null : userIdsByUsername.creador,
          request.responseNotes,
        ]
      );

      requestIdsByCode[request.requestCode] = insertedRequest.rows[0].id;
    }

    for (const event of scenario.accessEvents) {
      const eventTypeId = await getLookupId(client, "access_event_types", event.eventTypeCode);
      const sourceId = await getLookupId(client, "access_sources", event.sourceCode);
      const operatorUserId = userIdsByUsername[event.operatorUsername];
      const personResult = await client.query("SELECT id FROM people WHERE rut = $1", [
        normalizeRut(event.rut),
      ]);

      await client.query(
        `
          INSERT INTO access_events (
            ticket_id,
            person_id,
            operator_user_id,
            event_type_id,
            source_id,
            observed_at,
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          ticketIdsByCode[event.ticketCode] || null,
          personResult.rows[0] ? personResult.rows[0].id : null,
          operatorUserId,
          eventTypeId,
          sourceId,
          event.observedAt.toISOString(),
          event.notes,
        ]
      );
    }

    for (const emailRequest of scenario.emailRequests || []) {
      const statusId = await getLookupId(client, "email_intake_statuses", emailRequest.statusCode);
      const createdByUserId = emailRequest.createdByUsername
        ? userIdsByUsername[emailRequest.createdByUsername]
        : null;
      const assignedCreatorUserId = emailRequest.assignedCreatorUsername
        ? userIdsByUsername[emailRequest.assignedCreatorUsername]
        : null;
      const relatedTicketId = emailRequest.relatedTicketCode
        ? ticketIdsByCode[emailRequest.relatedTicketCode] || null
        : null;

      await client.query(
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
            assigned_creator_user_id,
            related_ticket_id,
            notes,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [
          emailRequest.intakeCode,
          emailRequest.senderName,
          emailRequest.senderEmail,
          emailRequest.subject,
          emailRequest.body,
          emailRequest.companyName,
          emailRequest.requestedRut ? normalizeRut(emailRequest.requestedRut) : null,
          emailRequest.requestedFirstName,
          emailRequest.requestedLastName,
          emailRequest.hostName,
          emailRequest.activityDescription,
          emailRequest.desiredEntryAt ? emailRequest.desiredEntryAt.toISOString() : null,
          emailRequest.desiredExitAt ? emailRequest.desiredExitAt.toISOString() : null,
          statusId,
          createdByUserId,
          assignedCreatorUserId,
          relatedTicketId,
          emailRequest.notes || "",
        ]
      );
    }

    await insertAuditLog(client, {
      userId: userIdsByUsername.admin,
      entityType: "SYSTEM",
      entityId: null,
      action: "SEED_BOOTSTRAP",
      details: {
        users: demoAccounts.length,
        tickets: scenario.tickets.length,
        requests: scenario.requests.length,
        accessEvents: scenario.accessEvents.length,
        emailRequests: (scenario.emailRequests || []).length,
      },
    });
  });
}

async function initializeDatabase() {
  await pool.query(schemaSql);
  await seedDemoData();
}

async function resetDatabase() {
  await withTransaction(async (client) => {
    await client.query(
      `
        TRUNCATE TABLE
          audit_logs,
          access_events,
          operator_access_requests,
          ticket_status_history,
          access_tickets,
          people,
          companies,
          users
        RESTART IDENTITY CASCADE
      `
    );
  });
  await initializeDatabase();
}

async function closePool() {
  await pool.end();
}

module.exports = {
  closePool,
  initializeDatabase,
  insertAuditLog,
  insertTicketHistory,
  query,
  resetDatabase,
  upsertCompany,
  upsertPerson,
  withTransaction,
  getLookupId,
};
