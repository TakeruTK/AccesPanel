function buildPasswordPolicySummary(policy) {
  const rules = [`minimo ${policy.minPasswordLength} caracteres`];
  if (policy.requireUppercase) {
    rules.push("una mayuscula");
  }
  if (policy.requireLowercase) {
    rules.push("una minuscula");
  }
  if (policy.requireDigit) {
    rules.push("un numero");
  }
  if (policy.requireSpecialChar) {
    rules.push("un simbolo");
  }
  return rules.join(", ");
}

function validatePasswordWithPolicy(password, policy) {
  const value = String(password || "");
  if (value.length < Number(policy.minPasswordLength || 0)) {
    return `La contrasena debe tener al menos ${policy.minPasswordLength} caracteres.`;
  }

  if (policy.requireUppercase && !/[A-Z]/.test(value)) {
    return "La contrasena debe incluir al menos una letra mayuscula.";
  }

  if (policy.requireLowercase && !/[a-z]/.test(value)) {
    return "La contrasena debe incluir al menos una letra minuscula.";
  }

  if (policy.requireDigit && !/\d/.test(value)) {
    return "La contrasena debe incluir al menos un numero.";
  }

  if (policy.requireSpecialChar && !/[^A-Za-z0-9]/.test(value)) {
    return "La contrasena debe incluir al menos un simbolo.";
  }

  return "";
}

module.exports = {
  buildPasswordPolicySummary,
  validatePasswordWithPolicy,
};
