const operationWindow = {
  label: "Viernes 17 de abril de 2026, 10:15",
  now: "2026-04-17T10:15:00-04:00",
};

const roles = [
  {
    code: "ADMIN",
    name: "Administrador",
    tagline: "Control total del sistema y la seguridad.",
    capabilities: [
      "Crear cualquier tipo de usuario",
      "Asignar roles y activar o bloquear cuentas",
      "Revisar auditoria completa y trazabilidad",
    ],
  },
  {
    code: "TICKET_CREATOR",
    name: "Creador de ticket",
    tagline: "Convierte la solicitud del correo en una autorizacion formal.",
    capabilities: [
      "Registrar datos del visitante y la empresa",
      "Crear tickets con horario de entrada y salida",
      "Responder solicitudes elevadas por el operador",
    ],
  },
  {
    code: "TICKET_VERIFIER",
    name: "Verificador",
    tagline: "Aprueba o rechaza la visita antes del ingreso.",
    capabilities: [
      "Corroborar identidad, actividad y responsable interno",
      "Aprobar, observar o rechazar tickets",
      "Registrar comentarios de validacion",
    ],
  },
  {
    code: "OPERATOR",
    name: "Operador",
    tagline: "Valida ingresos en terreno desde Android.",
    capabilities: [
      "Buscar personas por RUT",
      "Escanear carnet de identidad",
      "Registrar entrada, salida y solicitudes urgentes",
    ],
  },
];

const workflowSteps = [
  {
    step: "1",
    title: "Solicitud por correo",
    description: "La empresa informa la visita y entrega los antecedentes iniciales.",
  },
  {
    step: "2",
    title: "Creacion del ticket",
    description: "El creador captura RUT, nombre, empresa, anfitrion y horarios.",
  },
  {
    step: "3",
    title: "Verificacion",
    description: "El verificador valida disponibilidad, actividad y consistencia.",
  },
  {
    step: "4",
    title: "Ingreso en porteria",
    description: "El operador consulta por RUT o escanea el carnet desde Android.",
  },
  {
    step: "5",
    title: "Solicitud urgente",
    description: "Si no existe autorizacion, el operador eleva una solicitud al creador.",
  },
];

const tickets = [
  {
    ticketCode: "ACC-20260417-001",
    status: "APROBADO",
    statusLabel: "Aprobado",
    person: {
      rut: "15.123.456-7",
      firstName: "Carlos",
      lastName: "Soto",
    },
    company: "MetalSur",
    hostName: "Daniela Rojas",
    activityDescription: "Mantenimiento de tableros electricos",
    scheduledEntryAt: "2026-04-17T08:30:00-04:00",
    scheduledExitAt: "2026-04-17T17:30:00-04:00",
    creatorName: "Paola Vega",
    verifierName: "Ignacio Toro",
    notes: "PPE completo confirmado",
  },
  {
    ticketCode: "ACC-20260417-002",
    status: "PENDIENTE_VERIFICACION",
    statusLabel: "Pendiente verificacion",
    person: {
      rut: "18.765.432-K",
      firstName: "Andrea",
      lastName: "Mella",
    },
    company: "TecnoRed",
    hostName: "Felipe Cortes",
    activityDescription: "Levantamiento de fibra y cableado",
    scheduledEntryAt: "2026-04-17T11:00:00-04:00",
    scheduledExitAt: "2026-04-17T18:00:00-04:00",
    creatorName: "Paola Vega",
    verifierName: null,
    notes: "Pendiente validar disponibilidad de sala tecnica",
  },
  {
    ticketCode: "ACC-20260417-003",
    status: "OBSERVADO",
    statusLabel: "Observado",
    person: {
      rut: "14.222.333-4",
      firstName: "Miguel",
      lastName: "Araya",
    },
    company: "SafetyCheck",
    hostName: "Lorena Fuentes",
    activityDescription: "Inspeccion de extintores",
    scheduledEntryAt: "2026-04-17T13:30:00-04:00",
    scheduledExitAt: "2026-04-17T15:00:00-04:00",
    creatorName: "Natalia Reyes",
    verifierName: "Ignacio Toro",
    notes: "Falta numero de orden de trabajo",
  },
  {
    ticketCode: "ACC-20260417-004",
    status: "RECHAZADO",
    statusLabel: "Rechazado",
    person: {
      rut: "12.345.678-5",
      firstName: "Sofia",
      lastName: "Mardones",
    },
    company: "Andes Lift",
    hostName: "Mauricio Tapia",
    activityDescription: "Mantencion de elevadores",
    scheduledEntryAt: "2026-04-17T09:00:00-04:00",
    scheduledExitAt: "2026-04-17T12:00:00-04:00",
    creatorName: "Natalia Reyes",
    verifierName: "Ignacio Toro",
    notes: "Bloque operativo ocupado durante la franja solicitada",
  },
  {
    ticketCode: "ACC-20260417-005",
    status: "APROBADO",
    statusLabel: "Aprobado",
    person: {
      rut: "9.876.543-2",
      firstName: "Valentina",
      lastName: "Nunez",
    },
    company: "Clima Austral",
    hostName: "Rene Osorio",
    activityDescription: "Ajuste de climatizacion central",
    scheduledEntryAt: "2026-04-17T07:30:00-04:00",
    scheduledExitAt: "2026-04-17T16:00:00-04:00",
    creatorName: "Paola Vega",
    verifierName: "Ignacio Toro",
    notes: "Ingreso por puerta norte",
  },
];

const operatorRequests = [
  {
    id: "SOL-081",
    rut: "16.444.555-6",
    firstName: "Javier",
    lastName: "Orellana",
    fullName: "Javier Orellana",
    company: "FastNet",
    hostName: "Daniela Rojas",
    activityDescription: "Revision de backbone y enlace principal",
    desiredEntryAt: "2026-04-17T10:30:00-04:00",
    desiredExitAt: "2026-04-17T14:00:00-04:00",
    status: "PENDIENTE_RESPUESTA",
    statusLabel: "Pendiente respuesta",
    requestedAt: "09:42",
    notes: "Tecnico en porteria esperando confirmacion del correo original.",
    responseNotes: "",
  },
  {
    id: "SOL-082",
    rut: "13.998.777-1",
    firstName: "Romina",
    lastName: "Salinas",
    fullName: "Romina Salinas",
    company: "Hidra Works",
    hostName: "Lorena Fuentes",
    activityDescription: "Inspeccion de bomba y manifold",
    desiredEntryAt: "2026-04-17T11:30:00-04:00",
    desiredExitAt: "2026-04-17T16:30:00-04:00",
    status: "EN_REVISION",
    statusLabel: "En revision",
    requestedAt: "10:03",
    notes: "Se envio respaldo del servicio, falta visto bueno del area.",
    responseNotes: "Solicitud recibida y siendo revisada por el creador de tickets.",
  },
  {
    id: "SOL-083",
    rut: "20.112.334-9",
    firstName: "Pedro",
    lastName: "Gallardo",
    fullName: "Pedro Gallardo",
    company: "SecuriPlus",
    hostName: "Mauricio Tapia",
    activityDescription: "Mantencion de sensores de acceso",
    desiredEntryAt: "2026-04-17T08:30:00-04:00",
    desiredExitAt: "2026-04-17T12:30:00-04:00",
    status: "APROBADA",
    statusLabel: "Aprobada",
    requestedAt: "08:18",
    notes: "Ticket creado y reenviado a verificacion.",
    responseNotes: "El creador ya genero el ticket y lo envio a verificacion.",
  },
];

const quickChecks = [
  {
    label: "RUT aprobado",
    rut: "15.123.456-7",
  },
  {
    label: "RUT pendiente",
    rut: "18.765.432-K",
  },
  {
    label: "RUT no registrado",
    rut: "11.111.111-1",
  },
];

module.exports = {
  operationWindow,
  roles,
  workflowSteps,
  tickets,
  operatorRequests,
  quickChecks,
};
