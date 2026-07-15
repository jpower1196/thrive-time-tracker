const els = {
  timerList: document.querySelector("#timerList"),
  providerList: document.querySelector("#providerList"),
  patientList: document.querySelector("#patientList"),
  quickAlertFeed: document.querySelector("#quickAlertFeed"),
  addPatientToggle: document.querySelector("#addPatientToggle"),
  addPatientDialog: document.querySelector("#addPatientDialog"),
  addPatientForm: document.querySelector("#addPatientForm"),
  closeAddPatient: document.querySelector("#closeAddPatient"),
  cancelAddPatient: document.querySelector("#cancelAddPatient"),
  newPatientName: document.querySelector("#newPatientName"),
  scheduleOrderToggle: document.querySelector("#scheduleOrderToggle"),
  scheduleOrderDialog: document.querySelector("#scheduleOrderDialog"),
  scheduleOrderForm: document.querySelector("#scheduleOrderForm"),
  closeScheduleOrder: document.querySelector("#closeScheduleOrder"),
  clearScheduleOrder: document.querySelector("#clearScheduleOrder"),
  schedulePatientName: document.querySelector("#schedulePatientName"),
  scheduleLineup: document.querySelector("#scheduleLineup")
};

let state = {
  activeTimerId: null,
  totalSessionsTracked: 0,
  completedPatients: [],
  scheduleOrders: [],
  timers: []
};

const temporaryNames = new Map();
const patientNameTimers = new Map();
const patientNameLastSent = new Map();
const EMPTY_PATIENT_STATUS = "No active patient status updates";
const spineIcon = `
  <svg class="spine-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.2v17.6" />
    <path d="M12 5.2c2.3 0 4 1.2 4 2.7s-1.7 2.7-4 2.7-4-1.2-4-2.7 1.7-2.7 4-2.7Z" />
    <path d="M12 10.1c2.1 0 3.7 1.1 3.7 2.5s-1.6 2.5-3.7 2.5-3.7-1.1-3.7-2.5 1.6-2.5 3.7-2.5Z" />
    <path d="M12 14.7c1.8 0 3.2 1 3.2 2.2s-1.4 2.2-3.2 2.2-3.2-1-3.2-2.2 1.4-2.2 3.2-2.2Z" />
  </svg>
`;
const rollerTableIcon = `
  <svg class="roller-table-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 14.2h16" />
    <path d="M5.5 14.2v4" />
    <path d="M18.5 14.2v4" />
    <path d="M7 12.6h9.8c1 0 1.8.7 2 1.6" />
    <circle cx="6.8" cy="10.5" r="1.7" />
    <path d="M8.8 11.3l4.2 1.3" />
    <path d="M7 18.5h10" />
  </svg>
`;
const patientFocusItems = [
  { key: "lightning", icon: "⚡", label: "STIM" },
  { key: "spine", icon: spineIcon, label: "Adjustment" },
  { key: "decomp", icon: "🪑", label: "Decomp" },
  { key: "strength", icon: "🏋", label: "Rehab" },
  { key: "roller", icon: rollerTableIcon, label: "Roller Table" }
];
const scheduleTreatmentOptions = [
  { key: "", label: "None" },
  { key: "lightning", label: "STIM" },
  { key: "spine", label: "Adjustment" },
  { key: "decomp", label: "Decomp" },
  { key: "strength", label: "Rehab" },
  { key: "roller", label: "Roller Table" }
];

function visiblePatientFocusItems(patient = {}) {
  const selectedTreatments = Array.isArray(patient.patientTreatments)
    ? patient.patientTreatments
    : patientFocusItems.map((focus) => focus.key);

  return patientFocusItems.filter((focus) => selectedTreatments.includes(focus.key));
}

function actor() {
  return "Site visitor";
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatMinutes(ms) {
  return Math.round(ms / 60000);
}

function timerMeta(timer) {
  if (timer.mode === "countup") {
    return "Patient Wait";
  }

  return `${formatMinutes(timer.durationMs)} min session`;
}

function bedNumber(timer) {
  return timer.name.match(/^Bed\s+(\d+)$/i)?.[1] || null;
}

function sentenceList(items) {
  if (items.length <= 1) {
    return items[0] || "";
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function therapyStatusPhrase(timer) {
  const patientName = timer.patientName?.trim();

  if (!patientName) {
    return null;
  }

  const therapyName = timer.name === "Rehab Therapy"
    ? "rehabilitation therapy"
    : timer.name.match(/^Bed\s+\d+$/i)
      ? "STIM"
      : timer.name;
  const locationPhrase = timer.name.match(/^Bed\s+\d+$/i)
    ? "is on STIM"
    : timer.name === "Decomp"
    ? "is on Decomp"
    : `is in ${therapyName}`;

  if (timer.running) {
    return {
      name: patientName,
      activity: locationPhrase
    };
  }

  if (isTimerAtFullTime(timer)) {
    return {
      name: patientName,
      activity: null
    };
  }

  return {
    name: patientName,
    activity: `is paused in ${therapyName}`
  };
}

function completedTreatmentLabels(checks = {}) {
  const labels = [];

  if (checks.lightning) {
    labels.push("STIM");
  }
  if (checks.spine) {
    labels.push("adjustment");
  }
  if (checks.decomp) {
    labels.push("Decomp");
  }
  if (checks.strength) {
    labels.push("rehabilitation therapy");
  }
  if (checks.roller) {
    labels.push("Roller Table");
  }

  return labels;
}

function completedPatientStatusPhrase(patient) {
  const patientName = patient.patientName?.trim();

  if (!patientName) {
    return null;
  }

  const completedLabels = completedTreatmentLabels(patient.patientChecks);

  if (completedLabels.length === 0) {
    return null;
  }

  return {
    name: patientName,
    completedLabels
  };
}

function patientStatusItems() {
  const therapyTimers = state.timers.filter((timer) => timer.group === "therapy");
  const groupedStatuses = new Map();

  function getStatusGroup(name) {
    const key = name.toLowerCase();

    if (!groupedStatuses.has(key)) {
      groupedStatuses.set(key, {
        name,
        activities: [],
        completedLabels: []
      });
    }

    return groupedStatuses.get(key);
  }

  for (const status of therapyTimers.map(therapyStatusPhrase).filter(Boolean)) {
    const group = getStatusGroup(status.name);

    if (status.activity) {
      group.activities.push(status.activity);
    }
  }

  const completedStatuses = (state.completedPatients || [])
    .map(completedPatientStatusPhrase)
    .filter(Boolean);

  for (const status of completedStatuses) {
    const group = getStatusGroup(status.name);

    for (const label of status.completedLabels) {
      if (!group.completedLabels.includes(label)) {
        group.completedLabels.push(label);
      }
    }
  }

  return [...groupedStatuses.values()]
    .map((status) => {
      const details = [];

      if (status.activities.length > 0) {
        details.push(sentenceList(status.activities));
      }
      if (status.completedLabels.length > 0) {
        details.push(`has completed ${sentenceList(status.completedLabels)}`);
      }

      if (details.length === 0) {
        return null;
      }

      return {
        name: status.name,
        text: `${status.name} ${details.join(", ")}.`
      };
    })
    .filter(Boolean);
}

function renderPatientStatus() {
  const statuses = patientStatusItems();

  els.quickAlertFeed.innerHTML = "";
  els.quickAlertFeed.classList.toggle("is-empty", statuses.length === 0);

  if (statuses.length === 0) {
    els.quickAlertFeed.textContent = EMPTY_PATIENT_STATUS;
    return;
  }

  for (const status of statuses) {
    const item = document.createElement("p");
    item.className = "patient-status-item";
    item.textContent = status.text;
    els.quickAlertFeed.append(item);
  }
}

async function updatePatientChecksFor(item, patientChecks) {
  const url = item.source === "completed"
    ? `/api/completed-patients/${item.id}`
    : `/api/timers/${item.id}`;

  await requestJson(url, {
    method: "PATCH",
    body: JSON.stringify({
      patientChecks,
      actor: actor()
    })
  });
}

function removePatientFor(item) {
  if (item.source === "completed") {
    return requestJson(`/api/completed-patients/${item.id}`, {
      method: "DELETE"
    });
  }

  clearTimeout(patientNameTimers.get(item.id));
  patientNameTimers.delete(item.id);
  temporaryNames.delete(item.id);
  patientNameLastSent.set(item.id, "");

  return requestJson(`/api/timers/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      patientName: "",
      patientChecks: {},
      actor: actor()
    })
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    throw new Error("Timer update failed.");
  }

  state = await response.json();
  renderTimerList();
}

async function updatePatientNameFor(timerId, patientName) {
  if (patientNameLastSent.get(timerId) === patientName) {
    return;
  }

  patientNameLastSent.set(timerId, patientName);

  const response = await fetch(`/api/timers/${timerId}`, {
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH",
    body: JSON.stringify({
      patientName,
      actor: actor()
    })
  });

  if (!response.ok) {
    throw new Error("Name update failed.");
  }

  const nextState = await response.json();
  state = nextState;

  if (temporaryNames.get(timerId) === patientName && document.activeElement?.dataset?.timerId !== timerId) {
    temporaryNames.delete(timerId);
  }
}

function queuePatientNameUpdate(timerId, patientName) {
  if (patientNameLastSent.get(timerId) === patientName) {
    return;
  }

  clearTimeout(patientNameTimers.get(timerId));
  patientNameTimers.set(timerId, setTimeout(() => {
    patientNameTimers.delete(timerId);
    updatePatientNameFor(timerId, patientName);
  }, 800));
}

function flushPatientNameUpdate(timerId, patientName) {
  clearTimeout(patientNameTimers.get(timerId));
  patientNameTimers.delete(timerId);
  updatePatientNameFor(timerId, patientName);
}

async function changeTimerFor(timerId, action) {
  if (action === "reset") {
    clearTimeout(patientNameTimers.get(timerId));
    patientNameTimers.delete(timerId);
    temporaryNames.delete(timerId);
  }

  await requestJson(`/api/timers/${timerId}`, {
    method: "POST",
    body: JSON.stringify({
      action,
      seconds: 0,
      actor: actor()
    })
  });
}

async function addSecondsFor(timerId, seconds) {
  await requestJson(`/api/timers/${timerId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "add",
      seconds,
      actor: actor()
    })
  });
}

async function addPatientRecord(patientName, patientTreatments) {
  await requestJson("/api/completed-patients", {
    method: "POST",
    body: JSON.stringify({
      patientName,
      patientTreatments,
      actor: actor()
    })
  });
}

async function addScheduleOrder(patientName, sequence, notes) {
  await requestJson("/api/schedule-orders", {
    method: "POST",
    body: JSON.stringify({
      patientName,
      sequence,
      notes,
      actor: actor()
    })
  });
}

async function removeScheduleOrder(id) {
  await requestJson(`/api/schedule-orders/${id}`, {
    method: "DELETE"
  });
}

async function clearScheduleOrders() {
  await requestJson("/api/schedule-orders", {
    method: "DELETE"
  });
}

function therapyTimers() {
  return state.timers.filter((timer) => timer.group === "therapy");
}

function isTimerAtFullTime(timer) {
  return Math.abs(timer.durationMs - timer.remainingMs) < 1000;
}

function isTypingTarget(element) {
  return element?.matches?.("input, textarea, select, [contenteditable='true']");
}

function connectKeypadShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.repeat || isTypingTarget(document.activeElement)) {
      return;
    }

    const keypadMatch = event.code.match(/^Numpad([1-9])$/);
    const numberMatch = event.code.match(/^Digit([1-9])$/);
    const timerIndex = Number(keypadMatch?.[1] || numberMatch?.[1] || 0) - 1;

    if (timerIndex < 0) {
      return;
    }

    const timer = therapyTimers()[timerIndex];

    if (timer) {
      event.preventDefault();
      changeTimerFor(timer.id, timer.running || !isTimerAtFullTime(timer) ? "prepare" : "start");
    }
  });
}

function renderTimerList() {
  const focusedInput = document.activeElement?.classList?.contains("temp-name-input")
    ? document.activeElement
    : null;
  const focusedTimerId = focusedInput?.dataset.timerId || null;
  const selectionStart = focusedInput?.selectionStart || 0;
  const selectionEnd = focusedInput?.selectionEnd || selectionStart;

  els.timerList.innerHTML = "";
  if (els.providerList) {
    els.providerList.innerHTML = "";
  }
  renderPatientStatus();
  renderPatientList();

  for (const timer of state.timers) {
    const card = document.createElement("article");
    const percent = timer.mode === "countup"
      ? timer.remainingMs / (5 * 60 * 1000)
      : timer.remainingMs / timer.durationMs;
    const isProvider = timer.group === "provider";
    const isWarning = isProvider && timer.remainingMs > 2.5 * 60 * 1000 && timer.remainingMs <= 5 * 60 * 1000;
    const isOverdue = isProvider && timer.remainingMs > 5 * 60 * 1000;
    const isTherapy = !isProvider;
    const isTherapyCaution = isTherapy && timer.remainingMs > 2.5 * 60 * 1000 && timer.remainingMs <= 5 * 60 * 1000;
    const isTherapyUrgent = isTherapy && timer.remainingMs <= 2.5 * 60 * 1000;
    card.className = `timer-card${isTherapy ? " therapy-card" : ""}${isTherapyCaution ? " therapy-caution" : ""}${isTherapyUrgent ? " therapy-urgent" : ""}${isProvider ? " provider-card" : ""}${isWarning ? " warning" : ""}${isOverdue ? " overdue" : ""}${timer.running ? " running" : ""}`;
    card.dataset.id = timer.id;
    card.innerHTML = `
      <div class="card-topline">
        <input class="temp-name-input" type="text" maxlength="32" placeholder="Name" aria-label="Patient name for ${timer.name}">
        <span class="tile-dot" aria-hidden="true"></span>
      </div>
      ${isProvider ? "" : `
      `}
      <div class="tile-main">
        <h3 class="tile-name"></h3>
      </div>
      <div class="tile-time">${formatTime(timer.remainingMs)}</div>
      <div class="mini-progress${timer.mode === "countup" ? " wait-progress" : ""}" aria-hidden="true">
        <span style="transform: scaleX(${Math.max(0, Math.min(1, percent))})"></span>
      </div>
      <div class="card-actions">
        <button class="button compact toggle-timer" type="button">${timer.running ? "Stop" : "Start"}</button>
        <button class="button compact reset-timer" type="button">Reset</button>
        ${isProvider ? "" : `
          <div class="time-adjustments">
            <button class="button compact adjust-time subtract-thirty-time" type="button">-30s</button>
            <button class="button compact adjust-time subtract-ten-time" type="button">-10s</button>
          </div>
        `}
      </div>
    `;
    card.querySelector(".tile-name").textContent = timer.name;
    const nameInput = card.querySelector(".temp-name-input");
    const timerFinished = timer.mode !== "countup" && !timer.running && timer.remainingMs <= 0;

    if (timerFinished) {
      temporaryNames.delete(timer.id);
      patientNameLastSent.set(timer.id, "");
    }

    nameInput.dataset.timerId = timer.id;
    nameInput.value = temporaryNames.has(timer.id) ? temporaryNames.get(timer.id) : timer.patientName || "";
    nameInput.addEventListener("input", () => {
      const value = nameInput.value;

      if (value.trim()) {
        temporaryNames.set(timer.id, nameInput.value);
      } else {
        temporaryNames.delete(timer.id);
      }

      queuePatientNameUpdate(timer.id, value);
    });
    nameInput.addEventListener("change", () => {
      flushPatientNameUpdate(timer.id, nameInput.value);
    });
    nameInput.addEventListener("blur", () => {
      flushPatientNameUpdate(timer.id, nameInput.value);
    });
    card.querySelector(".toggle-timer").addEventListener("click", () => {
      changeTimerFor(timer.id, timer.running ? "stop" : "start");
    });
    card.querySelector(".subtract-thirty-time")?.addEventListener("click", () => {
      addSecondsFor(timer.id, -30);
    });
    card.querySelector(".subtract-ten-time")?.addEventListener("click", () => {
      addSecondsFor(timer.id, -10);
    });
    card.querySelector(".reset-timer").addEventListener("click", () => {
      changeTimerFor(timer.id, "reset");
    });

    if (isProvider) {
      els.providerList?.append(card);
    } else {
      els.timerList.append(card);
    }
  }

  if (focusedTimerId) {
    const nextInput = document.querySelector(`.temp-name-input[data-timer-id="${focusedTimerId}"]`);

    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(selectionStart, selectionEnd);
    }
  }
}

function renderPatientList() {
  const patientItems = (state.completedPatients || []).map((patient) => ({
    id: patient.id,
    source: "completed",
    timerName: patient.timerName,
    patientName: patient.patientName,
    patientChecks: patient.patientChecks || {},
    patientTreatments: patient.patientTreatments
  }));

  els.patientList.innerHTML = "";

  if (patientItems.length === 0) {
    els.patientList.innerHTML = `<p class="patient-empty">No patient treatments yet</p>`;
    return;
  }

  for (const patient of patientItems) {
    const item = document.createElement("article");
    const checks = patient.patientChecks || {};
    item.className = "patient-focus-item";
    item.innerHTML = `
      <div class="patient-focus-copy">
        <strong></strong>
      </div>
      <span class="patient-row-spacer" aria-hidden="true"></span>
      <div class="patient-bubbles"></div>
      <span class="patient-delete-spacer" aria-hidden="true"></span>
      <button class="patient-remove" type="button" aria-label="Remove ${patient.patientName}">×</button>
    `;
    item.querySelector("strong").textContent = patient.patientName.trim();

    const bubbles = item.querySelector(".patient-bubbles");
    for (const focus of visiblePatientFocusItems(patient)) {
      const button = document.createElement("button");
      button.className = `patient-bubble ${focus.key}${checks[focus.key] ? " active" : ""}`;
      button.type = "button";
      button.title = focus.label;
      button.setAttribute("aria-label", `${focus.label} for ${patient.patientName}`);
      button.setAttribute("aria-pressed", String(Boolean(checks[focus.key])));
      button.innerHTML = checks[focus.key] ? "✓" : focus.icon;
      button.addEventListener("click", () => {
        updatePatientChecksFor(patient, {
          ...checks,
          [focus.key]: !checks[focus.key]
        });
      });
      bubbles.append(button);
    }

    item.querySelector(".patient-remove").addEventListener("click", () => {
      removePatientFor(patient);
    });
    els.patientList.append(item);
  }
}

function treatmentLabel(key) {
  return scheduleTreatmentOptions.find((option) => option.key === key)?.label || key;
}

function renderScheduleLineup() {
  if (!els.scheduleLineup) {
    return;
  }

  const orders = state.scheduleOrders || [];
  els.scheduleLineup.innerHTML = "";

  if (orders.length === 0) {
    els.scheduleLineup.innerHTML = `<p class="schedule-empty">No schedule order yet</p>`;
    return;
  }

  orders.forEach((order, index) => {
    const row = document.createElement("article");
    row.className = "schedule-lineup-item";
    const sequence = (order.sequence || []).map(treatmentLabel).join(" → ");
    row.innerHTML = `
      <div class="schedule-lineup-copy">
        <strong></strong>
        <span class="schedule-lineup-sequence"></span>
        <span class="schedule-lineup-notes"></span>
      </div>
      <button class="schedule-remove" type="button" aria-label="Remove ${order.patientName} from schedule order">×</button>
    `;
    row.querySelector("strong").textContent = `${index + 1}. ${order.patientName}`;
    row.querySelector(".schedule-lineup-sequence").textContent = sequence || "No therapies selected";
    row.querySelector(".schedule-lineup-notes").textContent = order.notes ? `Notes: ${order.notes}` : "";
    row.querySelector(".schedule-remove").addEventListener("click", () => {
      removeScheduleOrder(order.id);
    });
    els.scheduleLineup.append(row);
  });
}

function connectEvents() {
  const events = new EventSource("/api/timers/events");

  events.addEventListener("timers", (event) => {
    state = JSON.parse(event.data);
    renderTimerList();
    renderScheduleLineup();
  });
}

function openAddPatientDialog() {
  if (!els.addPatientDialog) {
    return;
  }

  els.addPatientForm?.reset();
  els.addPatientDialog.showModal();
  setTimeout(() => els.newPatientName?.focus(), 0);
}

function closeAddPatientDialog() {
  els.addPatientDialog?.close();
}

function connectAddPatientDialog() {
  els.addPatientToggle?.addEventListener("click", openAddPatientDialog);
  els.closeAddPatient?.addEventListener("click", closeAddPatientDialog);
  els.cancelAddPatient?.addEventListener("click", closeAddPatientDialog);

  els.addPatientDialog?.addEventListener("click", (event) => {
    if (event.target === els.addPatientDialog) {
      closeAddPatientDialog();
    }
  });

  els.addPatientForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(els.addPatientForm);
    const patientName = String(formData.get("patientName") || "").trim();
    const patientTreatments = formData.getAll("treatments").map(String);

    if (!patientName || patientTreatments.length === 0) {
      if (patientTreatments.length === 0) {
        const firstTreatment = els.addPatientForm.querySelector('input[name="treatments"]');
        firstTreatment?.setCustomValidity("Select at least one treatment.");
        firstTreatment?.reportValidity();
        els.addPatientForm.querySelectorAll('input[name="treatments"]').forEach((input) => {
          input.addEventListener("change", () => firstTreatment.setCustomValidity(""), { once: true });
        });
      }
      return;
    }

    await addPatientRecord(patientName, patientTreatments);
    closeAddPatientDialog();
  });
}

function populateScheduleSelects() {
  els.scheduleOrderForm?.querySelectorAll('select[name="sequence"]').forEach((select) => {
    select.innerHTML = scheduleTreatmentOptions.map((option) => (
      `<option value="${option.key}">${option.label}</option>`
    )).join("");
  });
}

function openScheduleOrderDialog() {
  if (!els.scheduleOrderDialog) {
    return;
  }

  els.scheduleOrderForm?.reset();
  renderScheduleLineup();
  els.scheduleOrderDialog.showModal();
  setTimeout(() => els.schedulePatientName?.focus(), 0);
}

function closeScheduleOrderDialog() {
  els.scheduleOrderDialog?.close();
}

function connectScheduleOrderDialog() {
  populateScheduleSelects();
  els.scheduleOrderToggle?.addEventListener("click", openScheduleOrderDialog);
  els.closeScheduleOrder?.addEventListener("click", closeScheduleOrderDialog);
  els.clearScheduleOrder?.addEventListener("click", async () => {
    const confirmed = window.confirm("This will clear all data in the Schedule Order lineup. Continue?");

    if (!confirmed) {
      return;
    }

    await clearScheduleOrders();
  });

  els.scheduleOrderDialog?.addEventListener("click", (event) => {
    if (event.target === els.scheduleOrderDialog) {
      closeScheduleOrderDialog();
    }
  });

  els.scheduleOrderForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(els.scheduleOrderForm);
    const patientName = String(formData.get("patientName") || "").trim();
    const sequence = formData.getAll("sequence").map(String).filter(Boolean);
    const notes = String(formData.get("notes") || "").trim();

    if (!patientName || sequence.length === 0) {
      return;
    }

    await addScheduleOrder(patientName, sequence, notes);
    els.scheduleOrderForm.reset();
    els.schedulePatientName?.focus();
  });
}

renderTimerList();
connectAddPatientDialog();
connectScheduleOrderDialog();
connectEvents();
connectKeypadShortcuts();
