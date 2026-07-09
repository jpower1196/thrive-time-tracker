const els = {
  timerList: document.querySelector("#timerList"),
  providerList: document.querySelector("#providerList"),
  patientList: document.querySelector("#patientList"),
  quickAlertFeed: document.querySelector("#quickAlertFeed")
};

let state = {
  activeTimerId: null,
  totalSessionsTracked: 0,
  completedPatients: [],
  timers: []
};

const temporaryNames = new Map();
const patientNameTimers = new Map();
const patientNameLastSent = new Map();
const patientFocusItems = [
  { key: "lightning", icon: "⚡", label: "Lightning" },
  { key: "spine", icon: "🦴", label: "Spine" },
  { key: "strength", icon: "🏋", label: "Strength" }
];

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

  if (timer.running) {
    return `${patientName} is in ${timer.name}.`;
  }

  if (isTimerAtFullTime(timer)) {
    return `${patientName} has not started ${timer.name}.`;
  }

  return `${patientName} is paused in ${timer.name}.`;
}

function quickAlertMessage() {
  const therapyTimers = state.timers.filter((timer) => timer.group === "therapy");
  const flareTimers = therapyTimers.filter((timer) => timer.flare);
  const patientStatuses = therapyTimers
    .map(therapyStatusPhrase)
    .filter(Boolean);
  const messages = [];

  if (flareTimers.length > 0) {
    messages.push(`Flare-up indicated for ${sentenceList(flareTimers.map((timer) => timer.patientName?.trim() || timer.name))}.`);
  }

  if (patientStatuses.length > 0) {
    messages.push(patientStatuses.slice(0, 4).join(" "));
  }

  return messages.join(" ") || "No active patient status updates";
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
  els.quickAlertFeed.textContent = quickAlertMessage();
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
        <button class="flare-toggle${timer.flare ? " active" : ""}" type="button" aria-pressed="${timer.flare}" aria-label="Toggle flare-up alert for ${timer.name}">
          <span aria-hidden="true">🔥</span>
        </button>
      `}
      <div class="tile-main">
        <h3 class="tile-name"></h3>
        <span class="tile-meta">${timerMeta(timer)}</span>
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
            <button class="button compact adjust-time subtract-time" type="button">-5s</button>
          </div>
        `}
      </div>
    `;
    card.querySelector(".tile-name").textContent = timer.name;
    const nameInput = card.querySelector(".temp-name-input");
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
    card.querySelector(".flare-toggle")?.addEventListener("click", () => {
      changeTimerFor(timer.id, "flare");
    });
    card.querySelector(".subtract-thirty-time")?.addEventListener("click", () => {
      addSecondsFor(timer.id, -30);
    });
    card.querySelector(".subtract-ten-time")?.addEventListener("click", () => {
      addSecondsFor(timer.id, -10);
    });
    card.querySelector(".subtract-time")?.addEventListener("click", () => {
      addSecondsFor(timer.id, -5);
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
    patientChecks: patient.patientChecks || {}
  }));

  els.patientList.innerHTML = "";

  if (patientItems.length === 0) {
    els.patientList.innerHTML = `<p class="patient-empty">No completed treatments yet</p>`;
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
    for (const focus of patientFocusItems) {
      const button = document.createElement("button");
      button.className = `patient-bubble ${focus.key}${checks[focus.key] ? " active" : ""}`;
      button.type = "button";
      button.title = focus.label;
      button.setAttribute("aria-label", `${focus.label} for ${patient.patientName}`);
      button.setAttribute("aria-pressed", String(Boolean(checks[focus.key])));
      button.textContent = focus.icon;
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

function connectEvents() {
  const events = new EventSource("/api/timers/events");

  events.addEventListener("timers", (event) => {
    state = JSON.parse(event.data);
    renderTimerList();
  });
}

renderTimerList();
connectEvents();
connectKeypadShortcuts();
