const els = {
  timerList: document.querySelector("#timerList")
};

let state = {
  activeTimerId: null,
  timers: []
};

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
  await requestJson(`/api/timers/${timerId}`, {
    method: "POST",
    body: JSON.stringify({
      action,
      seconds: 0,
      actor: actor()
    })
  });
}

function renderTimerList() {
  els.timerList.innerHTML = "";

  for (const timer of state.timers) {
    const card = document.createElement("article");
    const percent = timer.durationMs > 0 ? timer.remainingMs / timer.durationMs : 0;
    card.className = `timer-card${timer.running ? " running" : ""}`;
    card.dataset.id = timer.id;
    card.innerHTML = `
      <div class="card-topline">
        <span class="timer-state">${timer.running ? "Running" : "Stopped"}</span>
        <span class="tile-dot" aria-hidden="true"></span>
      </div>
      <div class="tile-main">
        <h3 class="tile-name"></h3>
        <span class="tile-meta">${formatMinutes(timer.durationMs)} min session</span>
      </div>
      <div class="tile-time">${formatTime(timer.remainingMs)}</div>
      <div class="mini-progress" aria-hidden="true">
        <span style="transform: scaleX(${Math.max(0, Math.min(1, percent))})"></span>
      </div>
      <div class="card-actions">
        <button class="button compact toggle-timer" type="button">${timer.running ? "Stop" : "Start"}</button>
        <button class="button compact reset-timer" type="button">Reset</button>
      </div>
    `;
    card.querySelector(".tile-name").textContent = timer.name;
    card.querySelector(".toggle-timer").addEventListener("click", () => {
      changeTimerFor(timer.id, timer.running ? "stop" : "start");
    });
    card.querySelector(".reset-timer").addEventListener("click", () => {
      changeTimerFor(timer.id, "reset");
    });
    els.timerList.append(card);
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
