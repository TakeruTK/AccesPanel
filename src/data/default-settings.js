const DEFAULT_SYSTEM_SETTINGS = {
  OPERATION: {
    earlyEntryToleranceMinutes: 15,
    lateExitToleranceMinutes: 30,
    defaultVisitDurationHours: 2,
    strictRutValidation: true,
  },
  SECURITY: {
    sessionTimeoutMinutes: 30,
    maxLoginAttempts: 5,
    lockoutMinutes: 15,
    minPasswordLength: 10,
    requireUppercase: true,
    requireLowercase: true,
    requireDigit: true,
    requireSpecialChar: true,
    secureCookies: false,
    showDemoCredentials: false,
  },
  EMAIL_INTAKE: {
    intakeEnabled: true,
    requireAttachment: false,
    acceptedFileTypes:
      "application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    webhookToken: "",
  },
};

module.exports = {
  DEFAULT_SYSTEM_SETTINGS,
};
