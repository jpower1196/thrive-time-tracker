const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "timers.json");

const clients = new Set();

const TIMER_PRESETS = [
  { id: "bed-1", name: "Bed 1", minutes: 10 },
  { id: "bed-2", name: "Bed 2", minutes: 10 },
  { id: "bed-3", name: "Bed 3", minutes: 10 },
  { id: "bed-4", name: "Bed 4", minutes: 10 },
  { id: "bed-5", name: "Bed 5", minutes: 10 },
  { id: "roller-table-1", name: "Roller Table 1", minutes: 10 },
  { id: "roller-table-2", name: "Roller Table 2", minutes: 10 },
  { id: "decompression-chair", name: "Decompression Chair", minutes: 12 }
];

function createTimer(name = "Bed 1", minutes = 10, id = null) {
  const durationMs = Math.max(0, Number(minutes) || 10) * 60 * 1000;

  return {
    id: id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || "Timer").trim().slice(0, 80) || "Timer",
    durationMs,
    remainingMs: durationMs,
    running: false,
    startedAt: null,
    updatedAt: Date.now(),
    changedBy: "System"
  };
}

function defaultState() {
  const timers = TIMER_PRESETS.map((timer) => (
    createTimer(timer.name, timer.minutes, timer.id)
  ));

  return {
    activeTimerId: timers[0].id,
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
      timers: parsed.timers.map((timer) => ({
        id: String(timer.id || createTimer().id),
        name: String(timer.name || "Timer").trim().slice(0, 80) || "Timer",
        durationMs: Math.max(0, Number(timer.durationMs) || 0),
        remainingMs: Math.max(0, Number(timer.remainingMs) || 0),
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

    if (!existing) {
      return createTimer(preset.name, preset.minutes, preset.id);
    }

    return {
      ...existing,
      id: preset.id,
      name: preset.name,
      durationMs,
      remainingMs: Math.min(
        Math.max(0, Number(existing.remainingMs) || durationMs),
        durationMs
      )
    };
  });

  return {
    activeTimerId: timers.some((timer) => timer.id === inputState.activeTimerId)
      ? inputState.activeTimerId
      : timers[0].id,
    timers
  };
}

let state = normalizeFixedState(loadState());

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function currentRemainingMs(timer) {
  if (!timer.running || !timer.startedAt) {
    return timer.remainingMs;
  }

  return Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt));
}

function normalizeTimers() {
  let changed = false;
  const fixedState = normalizeFixedState(state);

  if (JSON.stringify(fixedState.timers.map(({ id, name, durationMs }) => ({ id, name, durationMs }))) !==
    JSON.stringify(state.timers.map(({ id, name, durationMs }) => ({ id, name, durationMs })))) {
    state = fixedState;
    changed = true;
  }

  for (const timer of state.timers) {
    const remainingMs = currentRemainingMs(timer);

    if (timer.running && remainingMs <= 0) {
      timer.running = false;
      timer.remainingMs = 0;
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
    durationMs: timer.durationMs,
    remainingMs: currentRemainingMs(timer),
    running: timer.running,
    updatedAt: timer.updatedAt,
    changedBy: timer.changedBy
  };
}

function snapshot() {
  normalizeTimers();

  return {
    activeTimerId: state.activeTimerId,
    timers: state.timers.map(publicTimer)
  };
}

function getTimer(id) {
  return state.timers.find((timer) => timer.id === id);
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
  const remaining = currentRemainingMs(timer);

  if (action === "start") {
    timer.remainingMs = remaining <= 0 ? timer.durationMs : remaining;
    timer.running = true;
    timer.startedAt = Date.now();
  }

  if (action === "stop") {
    timer.remainingMs = remaining;
    timer.running = false;
    timer.startedAt = null;
  }

  if (action === "reset") {
    timer.remainingMs = timer.durationMs;
    timer.running = false;
    timer.startedAt = null;
  }

  if (action === "add") {
    const nextRemaining = Math.max(0, remaining + seconds * 1000);
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

  timer.updatedAt = Date.now();
  timer.changedBy = actor || "Someone";
  saveState();
  broadcast();
}

function updateTimerDetails(timer, body, actor) {
  const name = String(body.name || "").trim();
  const seconds = Number(body.seconds);

  if (name) {
    timer.name = name.slice(0, 80);
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
      const allowedActions = new Set(["start", "stop", "reset", "add", "set"]);

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
