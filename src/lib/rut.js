function normalizeRut(value) {
  return String(value || "")
    .trim()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

function formatRut(value) {
  const normalized = normalizeRut(value);
  if (normalized.length < 2) {
    return normalized;
  }

  const body = normalized.slice(0, -1);
  const verifierDigit = normalized.slice(-1);
  const reversed = body.split("").reverse();
  const chunks = [];

  for (let index = 0; index < reversed.length; index += 3) {
    chunks.push(reversed.slice(index, index + 3).reverse().join(""));
  }

  return `${chunks.reverse().join(".")}-${verifierDigit}`;
}

function computeVerifierDigit(body) {
  let sum = 0;
  let multiplier = 2;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  if (remainder === 11) {
    return "0";
  }

  if (remainder === 10) {
    return "K";
  }

  return String(remainder);
}

function isValidRut(value) {
  const normalized = normalizeRut(value);
  if (!/^\d{7,8}[0-9K]$/.test(normalized)) {
    return false;
  }

  const body = normalized.slice(0, -1);
  const verifierDigit = normalized.slice(-1);
  return computeVerifierDigit(body) === verifierDigit;
}

function extractRutFromText(text) {
  const input = String(text || "");
  const directMatch = input.match(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[0-9Kk]\b/);
  if (directMatch) {
    return formatRut(directMatch[0]);
  }

  const compactMatch = input.match(/\b\d{7,8}[0-9Kk]\b/);
  if (compactMatch) {
    return formatRut(compactMatch[0]);
  }

  return "";
}

function splitFullName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return {
      firstName: "",
      lastName: "",
    };
  }

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: "Usuario",
    };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1).join(" "),
  };
}

module.exports = {
  extractRutFromText,
  formatRut,
  isValidRut,
  normalizeRut,
  splitFullName,
};
