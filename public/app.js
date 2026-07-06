const els = {
  timerList: document.querySelector("#timerList"),
  providerList: document.querySelector("#providerList")
};

let state = {
  activeTimerId: null,
  timers: []
};

const temporaryNames = new Map();

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

async function changeTimerFor(timerId, action) {
  if (action === "reset") {
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
  return state.timers.filter((timer) => timer.group !== "provider");
}

function isTypingTarget(element) {
  return element?.matches?.("input, textarea, select, [contenteditable='true']");
}

function connectKeypadShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.repeat || isTypingTarget(document.activeElement)) {
      return;
    }

    const keypadMatch = event.code.match(/^Numpad([1-8])$/);
    const numberMatch = event.code.match(/^Digit([1-8])$/);
    const timerIndex = Number(keypadMatch?.[1] || numberMatch?.[1] || 0) - 1;

    if (timerIndex < 0) {
      return;
    }

    const timer = therapyTimers()[timerIndex];

    if (timer) {
      event.preventDefault();
      changeTimerFor(timer.id, "start");
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
  els.providerList.innerHTML = "";

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
        <input class="temp-name-input" type="text" maxlength="32" placeholder="Name" aria-label="Temporary name for ${timer.name}">
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
            <button class="button compact adjust-time subtract-time" type="button">-5s</button>
            <button class="button compact adjust-time add-time" type="button">+5s</button>
          </div>
        `}
      </div>
    `;
    card.querySelector(".tile-name").textContent = timer.name;
    const nameInput = card.querySelector(".temp-name-input");
    nameInput.dataset.timerId = timer.id;
    nameInput.value = temporaryNames.get(timer.id) || "";
    nameInput.addEventListener("input", () => {
      const value = nameInput.value.trim();

      if (value) {
        temporaryNames.set(timer.id, nameInput.value);
      } else {
        temporaryNames.delete(timer.id);
      }
    });
    card.querySelector(".toggle-timer").addEventListener("click", () => {
      changeTimerFor(timer.id, timer.running ? "stop" : "start");
    });
    card.querySelector(".flare-toggle")?.addEventListener("click", () => {
      changeTimerFor(timer.id, "flare");
    });
    card.querySelector(".subtract-time")?.addEventListener("click", () => {
      addSecondsFor(timer.id, -5);
    });
    card.querySelector(".add-time")?.addEventListener("click", () => {
      addSecondsFor(timer.id, 5);
    });
    card.querySelector(".reset-timer").addEventListener("click", () => {
      changeTimerFor(timer.id, "reset");
    });

    if (isProvider) {
      els.providerList.append(card);
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
