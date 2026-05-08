function buildTicketCode(datePart, sequence) {
  return `ACC-${datePart}-${String(sequence).padStart(3, "0")}`;
}

function buildRequestCode(datePart, sequence) {
  return `SOL-${datePart}-${String(sequence).padStart(3, "0")}`;
}

function datePartFrom(referenceDate) {
  const year = referenceDate.getFullYear();
  const month = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const day = String(referenceDate.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function shiftHours(referenceDate, hours) {
  return new Date(referenceDate.getTime() + hours * 60 * 60 * 1000);
}

function buildSeedScenario(referenceDate = new Date()) {
  const datePart = datePartFrom(referenceDate);
  const ticketCodes = {
    approvedActive: buildTicketCode(datePart, 1),
    pending: buildTicketCode(datePart, 2),
    observed: buildTicketCode(datePart, 3),
    rejected: buildTicketCode(datePart, 4),
    approvedLinked: buildTicketCode(datePart, 5),
    completed: buildTicketCode(datePart, 6),
  };

  const requestCodes = {
    pending: buildRequestCode(datePart, 1),
    review: buildRequestCode(datePart, 2),
    approved: buildRequestCode(datePart, 3),
  };

  const emailCodes = {
    received: `MAIL-${datePart}-001`,
    review: `MAIL-${datePart}-002`,
  };

  return {
    tickets: [
      {
        ticketCode: ticketCodes.approvedActive,
        statusCode: "APROBADO",
        person: {
          rut: "15.123.456-9",
          firstName: "Carlos",
          lastName: "Soto",
        },
        company: "MetalSur",
        hostName: "Daniela Rojas",
        activityDescription: "Mantenimiento de tableros electricos",
        scheduledEntryAt: shiftHours(referenceDate, -2),
        scheduledExitAt: shiftHours(referenceDate, 6),
        creatorUsername: "creador",
        verifierUsername: "verificador",
        ticketNotes: "PPE completo confirmado",
        verificationNotes: "Validado para ingreso y charla inicial de seguridad.",
      },
      {
        ticketCode: ticketCodes.pending,
        statusCode: "PENDIENTE_VERIFICACION",
        person: {
          rut: "18.765.432-7",
          firstName: "Andrea",
          lastName: "Mella",
        },
        company: "TecnoRed",
        hostName: "Felipe Cortes",
        activityDescription: "Levantamiento de fibra y cableado",
        scheduledEntryAt: shiftHours(referenceDate, 1),
        scheduledExitAt: shiftHours(referenceDate, 8),
        creatorUsername: "creador",
        verifierUsername: null,
        ticketNotes: "Pendiente validar disponibilidad de sala tecnica",
        verificationNotes: "",
      },
      {
        ticketCode: ticketCodes.observed,
        statusCode: "OBSERVADO",
        person: {
          rut: "14.222.333-3",
          firstName: "Miguel",
          lastName: "Araya",
        },
        company: "SafetyCheck",
        hostName: "Lorena Fuentes",
        activityDescription: "Inspeccion de extintores",
        scheduledEntryAt: shiftHours(referenceDate, 3),
        scheduledExitAt: shiftHours(referenceDate, 5),
        creatorUsername: "creador",
        verifierUsername: "verificador",
        ticketNotes: "Falta numero de orden de trabajo",
        verificationNotes: "Completar el numero de OT antes de reenviar a verificacion.",
        linkedRequestCode: requestCodes.review,
      },
      {
        ticketCode: ticketCodes.rejected,
        statusCode: "RECHAZADO",
        person: {
          rut: "12.345.678-5",
          firstName: "Sofia",
          lastName: "Mardones",
        },
        company: "Andes Lift",
        hostName: "Mauricio Tapia",
        activityDescription: "Mantencion de elevadores",
        scheduledEntryAt: shiftHours(referenceDate, 2),
        scheduledExitAt: shiftHours(referenceDate, 4),
        creatorUsername: "creador",
        verifierUsername: "verificador",
        ticketNotes: "Se detecto cruce con otra mantencion mayor",
        verificationNotes: "Franja rechazada por incompatibilidad operacional.",
        rejectionReason: "El area estara cerrada durante la franja solicitada.",
      },
      {
        ticketCode: ticketCodes.approvedLinked,
        statusCode: "APROBADO",
        person: {
          rut: "20.112.334-8",
          firstName: "Pedro",
          lastName: "Gallardo",
        },
        company: "SecuriPlus",
        hostName: "Mauricio Tapia",
        activityDescription: "Mantencion de sensores de acceso",
        scheduledEntryAt: shiftHours(referenceDate, 4),
        scheduledExitAt: shiftHours(referenceDate, 8),
        creatorUsername: "creador",
        verifierUsername: "verificador",
        ticketNotes: "Solicitud urgente convertida a ticket formal",
        verificationNotes: "Aprobado luego de validar respaldo del servicio.",
        linkedRequestCode: requestCodes.approved,
      },
      {
        ticketCode: ticketCodes.completed,
        statusCode: "SALIDA_REGISTRADA",
        person: {
          rut: "9.876.543-3",
          firstName: "Valentina",
          lastName: "Nunez",
        },
        company: "Clima Austral",
        hostName: "Rene Osorio",
        activityDescription: "Ajuste de climatizacion central",
        scheduledEntryAt: shiftHours(referenceDate, -8),
        scheduledExitAt: shiftHours(referenceDate, -1),
        creatorUsername: "creador",
        verifierUsername: "verificador",
        ticketNotes: "Visita completada durante el turno anterior",
        verificationNotes: "Visita finalizada y salida registrada.",
      },
    ],
    requests: [
      {
        requestCode: requestCodes.pending,
        rut: "16.444.555-0",
        firstName: "Javier",
        lastName: "Orellana",
        company: "FastNet",
        hostName: "Daniela Rojas",
        activityDescription: "Revision de backbone y enlace principal",
        desiredEntryAt: shiftHours(referenceDate, 1),
        desiredExitAt: shiftHours(referenceDate, 5),
        statusCode: "PENDIENTE_RESPUESTA",
        operatorUsername: "operador",
        notes: "Tecnico en porteria esperando confirmacion del correo original.",
        responseNotes: "",
        relatedTicketCode: null,
      },
      {
        requestCode: requestCodes.review,
        rut: "14.222.333-3",
        firstName: "Miguel",
        lastName: "Araya",
        company: "SafetyCheck",
        hostName: "Lorena Fuentes",
        activityDescription: "Inspeccion de extintores",
        desiredEntryAt: shiftHours(referenceDate, 3),
        desiredExitAt: shiftHours(referenceDate, 5),
        statusCode: "EN_REVISION",
        operatorUsername: "operador",
        notes: "Se adjunto respaldo del servicio; se espera correccion del ticket observado.",
        responseNotes: "Solicitud en revision mientras el creador ajusta el ticket.",
        relatedTicketCode: ticketCodes.observed,
      },
      {
        requestCode: requestCodes.approved,
        rut: "20.112.334-8",
        firstName: "Pedro",
        lastName: "Gallardo",
        company: "SecuriPlus",
        hostName: "Mauricio Tapia",
        activityDescription: "Mantencion de sensores de acceso",
        desiredEntryAt: shiftHours(referenceDate, 4),
        desiredExitAt: shiftHours(referenceDate, 8),
        statusCode: "APROBADA",
        operatorUsername: "operador",
        notes: "Solicitud urgente ingresada desde porteria.",
        responseNotes: "Se genero ticket y quedo aprobado para el horario solicitado.",
        relatedTicketCode: ticketCodes.approvedLinked,
      },
    ],
    accessEvents: [
      {
        ticketCode: ticketCodes.completed,
        rut: "9.876.543-3",
        operatorUsername: "operador",
        eventTypeCode: "LOOKUP",
        sourceCode: "RUT",
        observedAt: shiftHours(referenceDate, -7.8),
        notes: "Consulta de acceso previa al ingreso.",
      },
      {
        ticketCode: ticketCodes.completed,
        rut: "9.876.543-3",
        operatorUsername: "operador",
        eventTypeCode: "CHECK_IN",
        sourceCode: "RUT",
        observedAt: shiftHours(referenceDate, -7.6),
        notes: "Ingreso autorizado en porteria norte.",
      },
      {
        ticketCode: ticketCodes.completed,
        rut: "9.876.543-3",
        operatorUsername: "operador",
        eventTypeCode: "CHECK_OUT",
        sourceCode: "MANUAL",
        observedAt: shiftHours(referenceDate, -1.1),
        notes: "Salida registrada al terminar la visita.",
      },
    ],
    emailRequests: [
      {
        intakeCode: emailCodes.received,
        senderName: "Marta Salgado",
        senderEmail: "marta.salgado@metalsur.cl",
        subject: "Solicitud de ingreso tecnico externo",
        body:
          "Solicitamos el ingreso del tecnico Carlos Soto para mantenimiento de tableros. Se adjunta respaldo del servicio.",
        companyName: "MetalSur",
        requestedRut: "15.123.456-9",
        requestedFirstName: "Carlos",
        requestedLastName: "Soto",
        hostName: "Daniela Rojas",
        activityDescription: "Mantenimiento de tableros electricos",
        desiredEntryAt: shiftHours(referenceDate, 2),
        desiredExitAt: shiftHours(referenceDate, 8),
        statusCode: "RECEIVED",
        createdByUsername: "creador",
        notes: "Correo pendiente de convertir a ticket.",
      },
      {
        intakeCode: emailCodes.review,
        senderName: "Patricio Ruiz",
        senderEmail: "patricio.ruiz@fastnet.cl",
        subject: "Ingreso de respaldo para enlace principal",
        body:
          "Se requiere ingreso urgente para revisar el backbone principal. Favor validar con el responsable interno.",
        companyName: "FastNet",
        requestedRut: "16.444.555-0",
        requestedFirstName: "Javier",
        requestedLastName: "Orellana",
        hostName: "Daniela Rojas",
        activityDescription: "Revision de backbone y enlace principal",
        desiredEntryAt: shiftHours(referenceDate, 1),
        desiredExitAt: shiftHours(referenceDate, 5),
        statusCode: "IN_REVIEW",
        createdByUsername: "creador",
        assignedCreatorUsername: "creador",
        notes: "Correo tomado por el creador para generar ticket.",
      },
    ],
  };
}

module.exports = {
  buildSeedScenario,
};
