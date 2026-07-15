const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "timers.json");
const SESSION_TOTAL_FILE = path.join(DATA_DIR, "session-total.json");

const clients = new Set();

const TIMER_PRESETS = [
  { id: "bed-1", name: "Bed 1", minutes: 10, mode: "countdown", group: "therapy" },
  { id: "bed-2", name: "Bed 2", minutes: 10, mode: "countdown", group: "therapy" },
  { id: "bed-3", name: "Bed 3", minutes: 10, mode: "countdown", group: "therapy" },
  { id: "bed-4", name: "Bed 4", minutes: 10, mode: "countdown", group: "therapy" },
  { id: "bed-5", name: "Bed 5", minutes: 10, mode: "countdown", group: "therapy" },
  { id: "roller-table-1", name: "Roller Table 1", minutes: 10, mode: "countdown", group: "therapy" },
  { id: "roller-table-2", name: "Roller Table 2", minutes: 10, mode: "countdown", group: "therapy" },
  { id: "decompression-chair", name: "Decomp", minutes: 12, mode: "countdown", group: "therapy" },
  { id: "rehab-therapy", name: "Rehab Therapy", minutes: 10, mode: "countdown", group: "therapy" }
];

const DEFAULT_PATIENT_CHECKS = {
  lightning: false,
  spine: false,
  decomp: false,
  strength: false,
  roller: false
};
const PATIENT_TREATMENTS = Object.keys(DEFAULT_PATIENT_CHECKS);
const SCHEDULE_TREATMENTS = new Set(PATIENT_TREATMENTS);

function cleanPatientChecks(checks = {}) {
  const source = checks && typeof checks === "object" ? checks : {};

  return {
    lightning: Boolean(source.lightning),
    spine: Boolean(source.spine),
    decomp: Boolean(source.decomp),
    strength: Boolean(source.strength),
    roller: Boolean(source.roller)
  };
}

function cleanPatientTreatments(treatments = PATIENT_TREATMENTS) {
  if (!Array.isArray(treatments)) {
    return [...PATIENT_TREATMENTS];
  }

  const cleanTreatments = treatments
    .map((treatment) => String(treatment || ""))
    .filter((treatment, index, source) => (
      PATIENT_TREATMENTS.includes(treatment) && source.indexOf(treatment) === index
    ));

  return cleanTreatments.length > 0 ? cleanTreatments : [...PATIENT_TREATMENTS];
}

function cleanCompletedPatients(completedPatients = []) {
  if (!Array.isArray(completedPatients)) {
    return [];
  }

  return completedPatients.map((patient) => ({
    id: String(patient.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    timerId: String(patient.timerId || ""),
    timerName: String(patient.timerName || "Timer").trim().slice(0, 80) || "Timer",
    patientName: String(patient.patientName || "").trim().slice(0, 32),
    patientChecks: cleanPatientChecks(patient.patientChecks),
    patientTreatments: cleanPatientTreatments(patient.patientTreatments),
    completedAt: Number(patient.completedAt) || Date.now()
  })).filter((patient) => patient.patientName);
}

function cleanScheduleOrders(scheduleOrders = []) {
  if (!Array.isArray(scheduleOrders)) {
    return [];
  }

  return scheduleOrders.map((order) => ({
    id: String(order.id || `schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
    patientName: String(order.patientName || "").trim().slice(0, 32),
    sequence: Array.isArray(order.sequence)
      ? order.sequence
        .map((treatment) => String(treatment || ""))
        .filter((treatment) => SCHEDULE_TREATMENTS.has(treatment))
        .slice(0, 5)
      : [],
    notes: String(order.notes || "").trim().slice(0, 180),
    createdAt: Number(order.createdAt) || Date.now()
  })).filter((order) => order.patientName && order.sequence.length > 0);
}

function storedSessionTotal() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SESSION_TOTAL_FILE, "utf8"));
    const total = typeof parsed === "number" ? parsed : parsed.totalSessionsTracked;
    return Math.max(0, Number(total) || 0);
  } catch (error) {
    return 0;
  }
}

function createTimer(name = "Bed 1", minutes = 10, id = null, mode = "countdown", group = "therapy") {
  const durationMs = Math.max(0, Number(minutes) || 0) * 60 * 1000;

  return {
    id: id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || "Timer").trim().slice(0, 80) || "Timer",
    mode,
    group,
    durationMs,
    remainingMs: mode === "countup" ? 0 : durationMs,
    patientName: "",
    patientChecks: { ...DEFAULT_PATIENT_CHECKS },
    patientRecordId: null,
    flare: false,
    running: false,
    startedAt: null,
    updatedAt: Date.now(),
    changedBy: "System"
  };
}

function defaultState() {
  const timers = TIMER_PRESETS.map((timer) => (
    createTimer(timer.name, timer.minutes, timer.id, timer.mode, timer.group)
  ));

  return {
    activeTimerId: timers[0].id,
    totalSessionsTracked: storedSessionTotal(),
    completedPatients: [],
    scheduleOrders: [],
    timers
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.timers) || parsed.timers.length === 0) {
      return defaultState();
    }

    return normalizeFixedState({
      activeTimerId: parsed.activeTimerId || parsed.timers[0].id,
      totalSessionsTracked: Math.max(
        storedSessionTotal(),
        Math.max(0, Number(parsed.totalSessionsTracked) || 0)
      ),
      completedPatients: cleanCompletedPatients(parsed.completedPatients),
      scheduleOrders: cleanScheduleOrders(parsed.scheduleOrders),
      timers: parsed.timers.map((timer) => ({
        id: String(timer.id || createTimer().id),
        name: String(timer.name || "Timer").trim().slice(0, 80) || "Timer",
        mode: String(timer.mode || "countdown"),
        group: String(timer.group || "therapy"),
        durationMs: Math.max(0, Number(timer.durationMs) || 0),
        remainingMs: Math.max(0, Number(timer.remainingMs) || 0),
        patientName: String(timer.patientName || "").trim().slice(0, 32),
        patientChecks: cleanPatientChecks(timer.patientChecks),
        patientRecordId: timer.patientRecordId ? String(timer.patientRecordId) : null,
        flare: Boolean(timer.flare),
        running: Boolean(timer.running),
        startedAt: timer.startedAt ? Number(timer.startedAt) : null,
        updatedAt: Number(timer.updatedAt) || Date.now(),
        changedBy: String(timer.changedBy || "System").slice(0, 40)
      }))
    });
  } catch (error) {
    return defaultState();
  }
}

function normalizeFixedState(inputState) {
  const previousTimers = Array.isArray(inputState.timers) ? inputState.timers : [];
  const timers = TIMER_PRESETS.map((preset) => {
    const existing = previousTimers.find((timer) => (
      timer.id === preset.id || timer.name.toLowerCase() === preset.name.toLowerCase()
    ));
    const durationMs = preset.minutes * 60 * 1000;
    const savedMs = Math.max(0, Number(existing?.remainingMs) || 0);

    if (!existing) {
      return createTimer(preset.name, preset.minutes, preset.id, preset.mode, preset.group);
    }

    return {
      ...existing,
      id: preset.id,
      name: preset.name,
      mode: preset.mode,
      group: preset.group,
      patientName: String(existing.patientName || "").trim().slice(0, 32),
      patientChecks: cleanPatientChecks(existing.patientChecks),
      patientRecordId: existing.patientRecordId ? String(existing.patientRecordId) : null,
      flare: Boolean(existing.flare),
      durationMs,
      remainingMs: preset.mode === "countup" ? savedMs : Math.min(savedMs || durationMs, durationMs)
    };
  });

  return {
    activeTimerId: timers.some((timer) => timer.id === inputState.activeTimerId)
      ? inputState.activeTimerId
      : timers[0].id,
    totalSessionsTracked: Math.max(0, Number(inputState.totalSessionsTracked) || 0),
    completedPatients: cleanCompletedPatients(inputState.completedPatients),
    scheduleOrders: cleanScheduleOrders(inputState.scheduleOrders),
    timers
  };
}

let state = normalizeFixedState(loadState());

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  fs.writeFileSync(SESSION_TOTAL_FILE, JSON.stringify({
    totalSessionsTracked: Math.max(0, Number(state.totalSessionsTracked) || 0)
  }, null, 2));
}

function currentTimerMs(timer) {
  if (!timer.running || !timer.startedAt) {
    return timer.remainingMs;
  }

  if (timer.mode === "countup") {
    return timer.remainingMs + (Date.now() - timer.startedAt);
  }

  return Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt));
}

function upsertPatientRecord(timer, patientName = timer.patientName) {
  const cleanName = String(patientName || "").trim().slice(0, 32);

  if (!cleanName) {
    return null;
  }

  const completedPatients = cleanCompletedPatients(state.completedPatients);
  const existingIndex = timer.patientRecordId
    ? completedPatients.findIndex((patient) => patient.id === timer.patientRecordId)
    : -1;

  if (existingIndex >= 0) {
    completedPatients[existingIndex] = {
      ...completedPatients[existingIndex],
      timerId: timer.id,
      timerName: timer.name,
      patientName: cleanName,
      patientChecks: cleanPatientChecks(timer.patientChecks),
      patientTreatments: cleanPatientTreatments(completedPatients[existingIndex].patientTreatments)
    };
    state.completedPatients = completedPatients;
    return completedPatients[existingIndex];
  }

  const patient = {
    id: `${timer.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timerId: timer.id,
    timerName: timer.name,
    patientName: cleanName,
    patientChecks: cleanPatientChecks(timer.patientChecks),
    patientTreatments: [...PATIENT_TREATMENTS],
    completedAt: Date.now()
  };

  timer.patientRecordId = patient.id;
  state.completedPatients = cleanCompletedPatients([...completedPatients, patient]);
  return patient;
}

function completePatientTreatment(timer) {
  const patientName = String(timer.patientName || "").trim();

  if (!patientName) {
    return;
  }

  const patient = upsertPatientRecord(timer, patientName);

  if (patient) {
    state.completedPatients = cleanCompletedPatients(state.completedPatients).map((item) => (
      item.id === patient.id ? { ...item, completedAt: Date.now() } : item
    ));
  }
}

function addManualPatientRecord(body = {}) {
  const patientName = String(body.patientName || "").trim().slice(0, 32);
  const selectedTreatments = Array.isArray(body.patientTreatments) ? body.patientTreatments : [];
  const patientTreatments = cleanPatientTreatments(selectedTreatments);
  const hasValidTreatment = selectedTreatments.some((treatment) => (
    PATIENT_TREATMENTS.includes(String(treatment || ""))
  ));

  if (!patientName || !hasValidTreatment) {
    return null;
  }

  const patient = {
    id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timerId: "manual",
    timerName: "Manual Add",
    patientName,
    patientChecks: { ...DEFAULT_PATIENT_CHECKS },
    patientTreatments,
    completedAt: Date.now()
  };

  state.completedPatients = cleanCompletedPatients([
    ...cleanCompletedPatients(state.completedPatients),
    patient
  ]);

  return patient;
}

function normalizeTimers() {
  let changed = false;
  const fixedState = normalizeFixedState(state);

  if (JSON.stringify(fixedState.timers.map(({ id, name, mode, group, durationMs }) => ({ id, name, mode, group, durationMs }))) !==
    JSON.stringify(state.timers.map(({ id, name, mode, group, durationMs }) => ({ id, name, mode, group, durationMs })))) {
    state = fixedState;
    changed = true;
  }

  for (const timer of state.timers) {
    const remainingMs = currentTimerMs(timer);

    if (timer.mode !== "countup" && timer.running && remainingMs <= 0) {
      timer.running = false;
      timer.remainingMs = 0;
      timer.patientName = "";
      timer.patientChecks = { ...DEFAULT_PATIENT_CHECKS };
      timer.patientRecordId = null;
      timer.startedAt = null;
      timer.updatedAt = Date.now();
      timer.changedBy = "Timer";
      changed = true;
    }
  }

  if (!state.timers.some((timer) => timer.id === state.activeTimerId)) {
    state.activeTimerId = state.timers[0]?.id || null;
    changed = true;
  }

  if (changed) {
    saveState();
  }
}

function publicTimer(timer) {
  return {
    id: timer.id,
    name: timer.name,
    mode: timer.mode,
    group: timer.group,
    patientName: timer.patientName || "",
    patientChecks: cleanPatientChecks(timer.patientChecks),
    patientRecordId: timer.patientRecordId,
    flare: Boolean(timer.flare),
    durationMs: timer.durationMs,
    remainingMs: currentTimerMs(timer),
    running: timer.running,
    updatedAt: timer.updatedAt,
    changedBy: timer.changedBy
  };
}

function snapshot() {
  normalizeTimers();

  return {
    activeTimerId: state.activeTimerId,
    totalSessionsTracked: state.totalSessionsTracked || 0,
    completedPatients: cleanCompletedPatients(state.completedPatients),
    scheduleOrders: cleanScheduleOrders(state.scheduleOrders),
    timers: state.timers.map(publicTimer)
  };
}

function addScheduleOrder(body = {}) {
  const patientName = String(body.patientName || "").trim().slice(0, 32);
  const sequence = Array.isArray(body.sequence)
    ? body.sequence
      .map((treatment) => String(treatment || ""))
      .filter((treatment) => SCHEDULE_TREATMENTS.has(treatment))
      .slice(0, 5)
    : [];
  const notes = String(body.notes || "").trim().slice(0, 180);

  if (!patientName || sequence.length === 0) {
    return null;
  }

  const order = {
    id: `schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    patientName,
    sequence,
    notes,
    createdAt: Date.now()
  };

  state.scheduleOrders = cleanScheduleOrders([
    ...cleanScheduleOrders(state.scheduleOrders),
    order
  ]);

  return order;
}

function getTimer(id) {
  return state.timers.find((timer) => timer.id === id);
}

function getCompletedPatient(id) {
  return cleanCompletedPatients(state.completedPatients).find((patient) => patient.id === id);
}

function sendEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast() {
  const data = snapshot();
  for (const client of clients) {
    sendEvent(client, "timers", data);
  }
}

function applyTimerChange(timer, action, seconds, actor) {
  const current = currentTimerMs(timer);
  const wasRunning = timer.running;

  if (action === "start") {
    if (!wasRunning && timer.group === "therapy") {
      state.totalSessionsTracked = Math.max(0, Number(state.totalSessionsTracked) || 0) + 1;
    }

    timer.remainingMs = timer.mode === "countup" || timer.running
      ? current
      : timer.durationMs;
    timer.running = true;
    timer.startedAt = Date.now();
  }

  if (action === "restart") {
    if (timer.group === "therapy") {
      state.totalSessionsTracked = Math.max(0, Number(state.totalSessionsTracked) || 0) + 1;
    }

    timer.remainingMs = timer.mode === "countup" ? 0 : timer.durationMs;
    timer.running = true;
    timer.startedAt = Date.now();
  }

  if (action === "prepare") {
    timer.remainingMs = timer.mode === "countup" ? 0 : timer.durationMs;
    timer.running = false;
    timer.startedAt = null;
  }

  if (action === "stop") {
    timer.remainingMs = current;
    timer.running = false;
    timer.startedAt = null;
  }

  if (action === "reset") {
    timer.remainingMs = timer.mode === "countup" ? 0 : timer.durationMs;
    timer.patientName = "";
    timer.patientChecks = { ...DEFAULT_PATIENT_CHECKS };
    timer.patientRecordId = null;
    timer.running = false;
    timer.startedAt = null;
  }

  if (action === "add") {
    const nextRemaining = Math.max(0, current + seconds * 1000);
    timer.remainingMs = nextRemaining;
    timer.durationMs = Math.max(timer.durationMs, nextRemaining);
    timer.startedAt = timer.running ? Date.now() : null;
  }

  if (action === "set") {
    const nextDuration = Math.max(0, seconds * 1000);
    timer.durationMs = nextDuration;
    timer.remainingMs = nextDuration;
    timer.running = false;
    timer.startedAt = null;
  }

  if (action === "flare") {
    timer.flare = !timer.flare;
  }

  if (action === "complete-patient") {
    upsertPatientRecord(timer);
  }

  timer.updatedAt = Date.now();
  timer.changedBy = actor || "Someone";
  saveState();
  broadcast();
}

function updateTimerDetails(timer, body, actor) {
  const name = String(body.name || "").trim();
  const patientName = String(body.patientName || "").trim();
  const seconds = Number(body.seconds);

  if (name) {
    timer.name = name.slice(0, 80);
  }

  if ("patientName" in body) {
    timer.patientName = patientName.slice(0, 32);
    if (!timer.patientName) {
      timer.patientChecks = { ...DEFAULT_PATIENT_CHECKS };
      timer.patientRecordId = null;
    }
  }

  if ("patientChecks" in body) {
    timer.patientChecks = cleanPatientChecks(body.patientChecks);
    if (timer.patientRecordId) {
      state.completedPatients = cleanCompletedPatients(state.completedPatients).map((item) => (
        item.id === timer.patientRecordId
          ? { ...item, patientChecks: cleanPatientChecks(timer.patientChecks) }
          : item
      ));
    }
  }

  if (Number.isFinite(seconds)) {
    const nextDuration = Math.max(0, seconds * 1000);
    timer.durationMs = nextDuration;
    timer.remainingMs = nextDuration;
    timer.running = false;
    timer.startedAt = null;
  }

  timer.updatedAt = Date.now();
  timer.changedBy = actor || "Someone";
  saveState();
  broadcast();
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function serveFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const typeByExt = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": typeByExt[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/api/timers/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.write(": connected\n\n");
    clients.add(response);
    sendEvent(response, "timers", snapshot());

    request.on("close", () => {
      clients.delete(response);
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/timers") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(snapshot()));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/timers/active") {
    try {
      const body = await readJson(request);
      const timer = getTimer(String(body.id || ""));

      if (!timer) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Timer not found." }));
        return;
      }

      state.activeTimerId = timer.id;
      saveState();
      broadcast();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(snapshot()));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Invalid JSON." }));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/completed-patients") {
    try {
      const body = await readJson(request);
      const patient = addManualPatientRecord(body);

      if (!patient) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Patient name is required." }));
        return;
      }

      saveState();
      broadcast();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(snapshot()));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Invalid JSON." }));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/schedule-orders") {
    try {
      const body = await readJson(request);
      const order = addScheduleOrder(body);

      if (!order) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Patient name and sequence are required." }));
        return;
      }

      saveState();
      broadcast();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(snapshot()));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Invalid JSON." }));
    }
    return;
  }

  if (request.method === "DELETE" && url.pathname === "/api/schedule-orders") {
    state.scheduleOrders = [];
    saveState();
    broadcast();
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(snapshot()));
    return;
  }

  const scheduleOrderMatch = url.pathname.match(/^\/api\/schedule-orders\/([^/]+)$/);

  if (scheduleOrderMatch && request.method === "DELETE") {
    state.scheduleOrders = cleanScheduleOrders(state.scheduleOrders)
      .filter((order) => order.id !== scheduleOrderMatch[1]);
    saveState();
    broadcast();
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(snapshot()));
    return;
  }

  const completedPatientMatch = url.pathname.match(/^\/api\/completed-patients\/([^/]+)$/);

  if (completedPatientMatch && request.method === "PATCH") {
    try {
      const body = await readJson(request);
      const patient = getCompletedPatient(completedPatientMatch[1]);

      if (!patient) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Completed patient not found." }));
        return;
      }

      state.completedPatients = cleanCompletedPatients(state.completedPatients).map((item) => (
        item.id === patient.id
          ? { ...item, patientChecks: cleanPatientChecks(body.patientChecks) }
          : item
      ));
      for (const timer of state.timers) {
        if (timer.patientRecordId === patient.id) {
          timer.patientChecks = cleanPatientChecks(body.patientChecks);
        }
      }
      saveState();
      broadcast();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(snapshot()));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Invalid JSON." }));
    }
    return;
  }

  if (completedPatientMatch && request.method === "DELETE") {
    const patient = getCompletedPatient(completedPatientMatch[1]);

    if (!patient) {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Completed patient not found." }));
      return;
    }

    state.completedPatients = cleanCompletedPatients(state.completedPatients)
      .filter((item) => item.id !== patient.id);
    for (const timer of state.timers) {
      if (timer.patientRecordId === patient.id) {
        timer.patientRecordId = null;
        timer.patientName = "";
        timer.patientChecks = { ...DEFAULT_PATIENT_CHECKS };
      }
    }
    saveState();
    broadcast();
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(snapshot()));
    return;
  }

  const timerMatch = url.pathname.match(/^\/api\/timers\/([^/]+)$/);

  if (timerMatch && request.method === "PATCH") {
    try {
      const timer = getTimer(timerMatch[1]);

      if (!timer) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Timer not found." }));
        return;
      }

      const body = await readJson(request);
      const actor = String(body.actor || "").trim().slice(0, 40);
      updateTimerDetails(timer, body, actor);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(snapshot()));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Invalid JSON." }));
    }
    return;
  }

  if (timerMatch && request.method === "POST") {
    try {
      const timer = getTimer(timerMatch[1]);

      if (!timer) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Timer not found." }));
        return;
      }

      const body = await readJson(request);
      const action = String(body.action || "");
      const seconds = Number(body.seconds || 0);
      const actor = String(body.actor || "").trim().slice(0, 40);
      const allowedActions = new Set(["start", "restart", "prepare", "stop", "reset", "add", "set", "flare", "complete-patient"]);

      if (!allowedActions.has(action) || !Number.isFinite(seconds)) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Invalid timer action." }));
        return;
      }

      state.activeTimerId = timer.id;
      applyTimerChange(timer, action, seconds, actor);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(snapshot()));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Invalid JSON." }));
    }
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  serveFile(response, filePath);
});

setInterval(() => {
  if (state.timers.some((timer) => timer.running)) {
    broadcast();
  }
}, 1000);

saveState();

server.listen(PORT, () => {
  console.log(`Shared timers running at http://127.0.0.1:${PORT}`);
});
