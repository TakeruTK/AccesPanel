const resultCard = document.getElementById("access-result-card");
const resultIcon = document.getElementById("result-icon");
const resultTitle = document.getElementById("result-title");
const resultMessage = document.getElementById("result-message");
const detailRut = document.getElementById("detail-rut");
const detailPerson = document.getElementById("detail-person");
const detailCompany = document.getElementById("detail-company");
const detailTicket = document.getElementById("detail-ticket");
const detailStatus = document.getElementById("detail-status");
const detailHost = document.getElementById("detail-host");
const detailSchedule = document.getElementById("detail-schedule");
const detailActivity = document.getElementById("detail-activity");
const detailAction = document.getElementById("detail-action");

const form = document.getElementById("access-check-form");
const rutInput = document.getElementById("rut");
const scanForm = document.getElementById("scan-payload-form");
const scanPayloadInput = document.getElementById("scan-payload");

const checkInForm = document.getElementById("check-in-form");
const checkInButton = document.getElementById("check-in-button");
const checkInTicketCode = document.getElementById("check-in-ticket-code");
const checkInRut = document.getElementById("check-in-rut");
const checkInSource = document.getElementById("check-in-source");

const checkOutForm = document.getElementById("check-out-form");
const checkOutButton = document.getElementById("check-out-button");
const checkOutTicketCode = document.getElementById("check-out-ticket-code");
const checkOutRut = document.getElementById("check-out-rut");
const checkOutSource = document.getElementById("check-out-source");

const operatorRequestForm = document.getElementById("operator-request-form");
const requestSourceCode = document.getElementById("request-source-code");
const requestSubmitButton = document.getElementById("request-submit-button");
const requestRut = document.getElementById("request-rut");
const requestFirstName = document.getElementById("request-first-name");
const requestLastName = document.getElementById("request-last-name");
const requestCompany = document.getElementById("request-company");
const requestHostName = document.getElementById("request-host-name");
const requestActivityDescription = document.getElementById("request-activity-description");
const requestEntryAt = document.getElementById("request-entry-at");
const requestExitAt = document.getElementById("request-exit-at");
const requestOperatorNotes = document.getElementById("request-operator-notes");

let currentSourceCode = "RUT";
const defaultVisitDurationHours = Number(window.fixAccessConfig?.defaultVisitDurationHours || 2);

function extractRutFromText(text) {
  const input = String(text || "");
  const directMatch = input.match(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[0-9Kk]\b/);
  if (directMatch) {
    return directMatch[0];
  }

  const compactMatch = input.match(/\b\d{7,8}[0-9Kk]\b/);
  if (compactMatch) {
    return compactMatch[0];
  }

  return "";
}

function toDateTimeLocalValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function ensureRequestDefaults() {
  if (!requestEntryAt || !requestExitAt) {
    return;
  }

  if (!requestEntryAt.value) {
    const now = new Date();
    requestEntryAt.value = toDateTimeLocalValue(now);
  }

  if (!requestExitAt.value) {
    const later = new Date();
    later.setHours(later.getHours() + defaultVisitDurationHours);
    requestExitAt.value = toDateTimeLocalValue(later);
  }
}

function setButtonState(button, enabled) {
  if (!button) {
    return;
  }

  button.disabled = !enabled;
}

function renderResult(result, sourceCode) {
  currentSourceCode = sourceCode || currentSourceCode || "RUT";
  resultCard.classList.remove("access-allowed", "access-warning", "access-denied");
  resultCard.classList.add(`access-${result.severity}`);

  resultIcon.textContent = result.icon;
  resultTitle.textContent = result.title;
  resultMessage.textContent = result.message;
  detailRut.textContent = result.rut || "-";
  detailPerson.textContent = result.personName;
  detailCompany.textContent = result.company;
  detailTicket.textContent = result.ticketCode;
  detailStatus.textContent = result.statusLabel;
  detailHost.textContent = result.hostName;
  detailSchedule.textContent = result.scheduleLabel;
  detailActivity.textContent = result.activityDescription || "No disponible";
  detailAction.textContent = result.actionLabel;

  if (checkInTicketCode) {
    checkInTicketCode.value = result.ticketCode && result.ticketCode !== "-" ? result.ticketCode : "";
    checkInRut.value = result.rut || "";
    checkInSource.value = currentSourceCode;
    setButtonState(checkInButton, Boolean(result.canCheckIn));
  }

  if (checkOutTicketCode) {
    checkOutTicketCode.value = result.ticketCode && result.ticketCode !== "-" ? result.ticketCode : "";
    checkOutRut.value = result.rut || "";
    checkOutSource.value = currentSourceCode === "CARD_SCAN" ? "CARD_SCAN" : "MANUAL";
    setButtonState(checkOutButton, Boolean(result.canCheckOut));
  }

  if (operatorRequestForm) {
    requestSourceCode.value = currentSourceCode;
    requestRut.value = result.rut || "";
    requestFirstName.value = result.firstName || "";
    requestLastName.value = result.lastName || "";
    requestCompany.value = result.company && result.company !== "No disponible" ? result.company : "";
    requestHostName.value = result.hostName && result.hostName !== "No disponible" ? result.hostName : "";
    requestActivityDescription.value = result.activityDescription || "";
    if (!requestOperatorNotes.value) {
      requestOperatorNotes.value = `Solicitud elevada desde porteria. Estado consultado: ${result.statusLabel}.`;
    }
    setButtonState(requestSubmitButton, Boolean(result.canRequest));
  }
}

async function fetchAccessResult(rut, sourceCode) {
  const response = await fetch(
    `/api/access/check?rut=${encodeURIComponent(rut)}&source=${encodeURIComponent(sourceCode || "RUT")}`
  );
  if (!response.ok) {
    throw new Error("No fue posible consultar el acceso.");
  }

  return response.json();
}

if (
  resultCard &&
  form &&
  rutInput &&
  scanForm &&
  scanPayloadInput &&
  operatorRequestForm &&
  checkInForm &&
  checkOutForm
) {
  ensureRequestDefaults();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rut = rutInput.value.trim();
    if (!rut) {
      rutInput.focus();
      return;
    }

    const submitButton = form.querySelector("button");
    const previousLabel = submitButton.textContent;
    submitButton.textContent = "Validando...";

    try {
      const result = await fetchAccessResult(rut, "RUT");
      renderResult(result, "RUT");
    } catch (error) {
      renderResult(
        {
          severity: "denied",
          icon: "X",
          title: "Error de consulta",
          message: error.message,
          rut,
          personName: "No disponible",
          company: "No disponible",
          ticketCode: "-",
          statusLabel: "Sin respuesta",
          hostName: "No disponible",
          scheduleLabel: "No disponible",
          actionLabel: "Reintentar consulta",
          canCheckIn: false,
          canCheckOut: false,
          canRequest: false,
          firstName: "",
          lastName: "",
          activityDescription: "",
        },
        "RUT"
      );
    } finally {
      submitButton.textContent = previousLabel;
    }
  });

  scanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const extractedRut = extractRutFromText(scanPayloadInput.value);
    if (!extractedRut) {
      renderResult(
        {
          severity: "warning",
          icon: "!",
          title: "Escaneo sin RUT reconocible",
          message: "No se encontro un RUT dentro del texto escaneado. Revisa el contenido e intenta nuevamente.",
          rut: "",
          personName: "No disponible",
          company: "No disponible",
          ticketCode: "-",
          statusLabel: "Escaneo invalido",
          hostName: "No disponible",
          scheduleLabel: "No disponible",
          actionLabel: "Repetir escaneo",
          canCheckIn: false,
          canCheckOut: false,
          canRequest: false,
          firstName: "",
          lastName: "",
          activityDescription: "",
        },
        "CARD_SCAN"
      );
      return;
    }

    rutInput.value = extractedRut;
    const submitButton = scanForm.querySelector("button");
    const previousLabel = submitButton.textContent;
    submitButton.textContent = "Procesando...";

    try {
      const result = await fetchAccessResult(extractedRut, "CARD_SCAN");
      renderResult(result, "CARD_SCAN");
    } catch (error) {
      renderResult(
        {
          severity: "denied",
          icon: "X",
          title: "Error de escaneo",
          message: error.message,
          rut: extractedRut,
          personName: "No disponible",
          company: "No disponible",
          ticketCode: "-",
          statusLabel: "Sin respuesta",
          hostName: "No disponible",
          scheduleLabel: "No disponible",
          actionLabel: "Reintentar consulta",
          canCheckIn: false,
          canCheckOut: false,
          canRequest: false,
          firstName: "",
          lastName: "",
          activityDescription: "",
        },
        "CARD_SCAN"
      );
    } finally {
      submitButton.textContent = previousLabel;
    }
  });

  document.querySelectorAll(".quick-check").forEach((button) => {
    button.addEventListener("click", async () => {
      rutInput.value = button.dataset.rut || "";
      const result = await fetchAccessResult(rutInput.value, "RUT");
      renderResult(result, "RUT");
    });
  });

  if (window.fixAccessInitialResult) {
    renderResult(window.fixAccessInitialResult, "RUT");
  }
}
