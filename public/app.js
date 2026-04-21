const resultCard = document.getElementById("access-result-card");
const resultIcon = document.getElementById("result-icon");
const resultTitle = document.getElementById("result-title");
const resultMessage = document.getElementById("result-message");
const detailPerson = document.getElementById("detail-person");
const detailCompany = document.getElementById("detail-company");
const detailTicket = document.getElementById("detail-ticket");
const detailStatus = document.getElementById("detail-status");
const detailHost = document.getElementById("detail-host");
const detailSchedule = document.getElementById("detail-schedule");
const detailAction = document.getElementById("detail-action");
const form = document.getElementById("access-check-form");
const rutInput = document.getElementById("rut");

if (resultCard && form && rutInput) {
  function renderResult(result) {
    resultCard.classList.remove("access-allowed", "access-warning", "access-denied");
    resultCard.classList.add(`access-${result.severity}`);

    resultIcon.textContent = result.icon;
    resultTitle.textContent = result.title;
    resultMessage.textContent = result.message;
    detailPerson.textContent = result.personName;
    detailCompany.textContent = result.company;
    detailTicket.textContent = result.ticketCode;
    detailStatus.textContent = result.statusLabel;
    detailHost.textContent = result.hostName;
    detailSchedule.textContent = result.scheduleLabel;
    detailAction.textContent = result.actionLabel;
  }

  async function fetchAccessResult(rut) {
    const response = await fetch(`/api/access/check?rut=${encodeURIComponent(rut)}`);
    if (!response.ok) {
      throw new Error("No fue posible consultar el acceso.");
    }

    return response.json();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rut = rutInput.value.trim();

    if (!rut) {
      rutInput.focus();
      return;
    }

    const submitButton = form.querySelector("button");
    const previousButtonText = submitButton.textContent;
    submitButton.textContent = "Validando...";

    try {
      const result = await fetchAccessResult(rut);
      renderResult(result);
    } catch (error) {
      renderResult({
        severity: "denied",
        icon: "X",
        title: "Error de consulta",
        message: error.message,
        personName: "No disponible",
        company: "No disponible",
        ticketCode: "-",
        statusLabel: "Sin respuesta",
        hostName: "No disponible",
        scheduleLabel: "No disponible",
        actionLabel: "Reintentar consulta",
      });
    } finally {
      submitButton.textContent = previousButtonText;
    }
  });

  document.querySelectorAll(".quick-check").forEach((button) => {
    button.addEventListener("click", async () => {
      rutInput.value = button.dataset.rut || "";
      const result = await fetchAccessResult(rutInput.value);
      renderResult(result);
    });
  });

  if (window.fixAccessInitialResult) {
    renderResult(window.fixAccessInitialResult);
  }
}
