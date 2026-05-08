const roles = [
  {
    code: "ADMIN",
    name: "Administrador",
    tagline: "Control total del sistema y de la trazabilidad operativa.",
    capabilities: [
      "Crear cualquier tipo de usuario",
      "Bloquear o reactivar cuentas",
      "Revisar auditoria, accesos y reportes",
    ],
  },
  {
    code: "TICKET_CREATOR",
    name: "Creador de ticket",
    tagline: "Convierte la solicitud en una autorizacion formal.",
    capabilities: [
      "Registrar tickets desde cero o desde una solicitud urgente",
      "Corregir tickets observados y reenviarlos a verificacion",
      "Responder solicitudes del operador",
    ],
  },
  {
    code: "TICKET_VERIFIER",
    name: "Verificador",
    tagline: "Aprueba, observa o rechaza antes del ingreso.",
    capabilities: [
      "Validar disponibilidad y datos del visitante",
      "Aprobar, observar o rechazar tickets",
      "Dejar trazabilidad de cada decision",
    ],
  },
  {
    code: "OPERATOR",
    name: "Operador",
    tagline: "Controla ingresos y salidas desde porteria.",
    capabilities: [
      "Consultar acceso por RUT",
      "Procesar un escaneo demo de carnet",
      "Registrar entrada, salida y solicitudes urgentes",
    ],
  },
];

const workflowSteps = [
  {
    step: "1",
    title: "Solicitud inicial",
    description: "La empresa informa la visita y entrega antecedentes por correo o canal interno.",
  },
  {
    step: "2",
    title: "Creacion del ticket",
    description: "El creador registra RUT, identidad, empresa, responsable interno, actividad y horarios.",
  },
  {
    step: "3",
    title: "Verificacion",
    description: "El verificador aprueba, observa o rechaza segun disponibilidad y consistencia.",
  },
  {
    step: "4",
    title: "Control de ingreso",
    description: "El operador valida por RUT o escaneo y registra la entrada si la autorizacion esta vigente.",
  },
  {
    step: "5",
    title: "Control de salida",
    description: "Al terminar la visita se registra la salida y queda el historial completo del acceso.",
  },
];

const demoAccounts = [
  {
    username: "admin",
    password: "admin123",
    roleCode: "ADMIN",
    roleName: "Administrador",
    fullName: "Administrador Demo",
    email: "admin@fixaccess.local",
  },
  {
    username: "creador",
    password: "creador123",
    roleCode: "TICKET_CREATOR",
    roleName: "Creador de ticket",
    fullName: "Creador de Ticket Demo",
    email: "creador@fixaccess.local",
  },
  {
    username: "verificador",
    password: "verificador123",
    alternatePasswords: ["verificador 123"],
    roleCode: "TICKET_VERIFIER",
    roleName: "Verificador",
    fullName: "Verificador Demo",
    email: "verificador@fixaccess.local",
  },
  {
    username: "operador",
    password: "operador123",
    roleCode: "OPERATOR",
    roleName: "Operador",
    fullName: "Operador Demo",
    email: "operador@fixaccess.local",
  },
];

const quickChecks = [
  { label: "RUT aprobado", rut: "15.123.456-9" },
  { label: "RUT pendiente", rut: "18.765.432-7" },
  { label: "RUT no registrado", rut: "11.111.111-1" },
];

module.exports = {
  demoAccounts,
  quickChecks,
  roles,
  workflowSteps,
};
