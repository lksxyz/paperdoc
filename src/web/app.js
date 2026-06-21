/**
 * Paperdoc — frontend
 * Three views (Record / Upload / Library), one unified pipeline.
 * Recording streams a live transcript over WebSocket while the timer ticks;
 * on stop, the pipeline runs sequentially (transcribe → diarize → SOAP)
 * and the output is rendered as numbered steps.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  mediaRecorder: null,
  audioChunks: [],
  audioContext: null,
  analyser: null,
  rafId: null,
  startedAt: 0,
  elapsedTimer: null,
  isRecording: false,
  selectedFile: null,
  sessionId: null,
  ws: null,
  currentView: "record",
};

const els = {
  views: $$(".view"),
  navLinks: $$(".nav-link"),

  // record
  stage: $(".stage"),
  timerDigits: $("#timer-digits"),
  timerSuffix: $("#timer-suffix"),
  waveform: $("#waveform"),
  waveformCanvas: $("#waveform-canvas"),
  waveformBars: $("#waveform-bars"),
  stageStatus: $("#stage-status"),
  btnRecord: $("#btn-record"),
  btnStop: $("#btn-stop"),
  livePanel: $("#live-panel"),
  liveStream: $("#live-stream"),
  liveMeta: $("#live-meta"),
  output: $("#output"),

  // upload
  dropzone: $("#dropzone"),
  fileInput: $("#file-input"),
  dropzoneEmpty: $("#dropzone-empty"),
  dropzoneFile: $("#dropzone-file"),
  fileName: $("#file-name"),
  fileSize: $("#file-size"),
  btnRemoveFile: $("#btn-remove-file"),
  btnGenerate: $("#btn-generate"),
  uploadOutput: $("#upload-output"),

  // library
  library: $("#library"),
  libraryEmpty: $("#library-empty"),
  libraryList: $("#library-list"),
  libraryDetail: $("#library-detail"),

  // system pill
  systemPill: $(".system-pill"),
  systemLabel: $("#system-label"),
};

/* ---------- System pill ------------------------------------------------- */
function setSystem(status, label) {
  els.systemPill.dataset.system = status;
  els.systemLabel.textContent = label;
}

/* ---------- Navigation -------------------------------------------------- */
const VALID_TABS = new Set(["record", "upload", "library"]);

function readTabFromUrl() {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return VALID_TABS.has(tab) ? tab : "record";
}

function applyView(name) {
  state.currentView = name;
  els.views.forEach((v) => {
    const isActive = v.dataset.view === name;
    v.classList.toggle("is-active", isActive);
    v.hidden = !isActive;
  });
  els.navLinks.forEach((b) => {
    b.classList.toggle("is-active", b.dataset.view === name);
  });
  if (name === "library") loadLibrary();
}

function setView(name) {
  if (!VALID_TABS.has(name)) name = "record";
  applyView(name);
  const url = new URL(window.location.href);
  if (url.searchParams.get("tab") !== name) {
    url.searchParams.set("tab", name);
    history.replaceState({ tab: name }, "", url.toString());
  }
}

els.navLinks.forEach((b) =>
  b.addEventListener("click", () => setView(b.dataset.view)),
);
window.addEventListener("popstate", () => applyView(readTabFromUrl()));

/* ---------- Timer ------------------------------------------------------- */
function fmtTime(ms) {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const tenths = Math.floor((totalSec * 10) % 10);
  return {
    digits: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
    suffix: `.${tenths}`,
  };
}
function startTimer() {
  state.startedAt = performance.now();
  const tick = () => {
    if (!state.isRecording) return;
    const t = fmtTime(performance.now() - state.startedAt);
    els.timerDigits.textContent = t.digits;
    els.timerSuffix.textContent = t.suffix;
    state.elapsedTimer = requestAnimationFrame(tick);
  };
  tick();
}
function stopTimer() {
  if (state.elapsedTimer) cancelAnimationFrame(state.elapsedTimer);
  state.elapsedTimer = null;
  const t = fmtTime(performance.now() - state.startedAt);
  els.timerDigits.textContent = t.digits;
  els.timerSuffix.textContent = t.suffix;
  return `${t.digits}${t.suffix}`;
}

/* ---------- Waveform: idle bars + active canvas ------------------------ */
function buildIdleBars(n = 48) {
  els.waveformBars.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const bar = document.createElement("span");
    bar.style.height = `${20 + Math.round(Math.sin(i / 2.3) * 10 + Math.random() * 14)}%`;
    els.waveformBars.appendChild(bar);
  }
}
function startWaveform() {
  const canvas = els.waveformCanvas;
  const ctx = canvas.getContext("2d");
  const ro = new ResizeObserver(() => {
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
  });
  ro.observe(canvas);
  canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  canvas.height = canvas.offsetHeight * window.devicePixelRatio;

  const buf = new Uint8Array(state.analyser.frequencyBinCount);
  const accent = getCss("--live");
  const dim = getCss("--paper-2");

  const draw = () => {
    if (!state.isRecording) return;
    state.rafId = requestAnimationFrame(draw);
    state.analyser.getByteTimeDomainData(buf);

    ctx.fillStyle = dim;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2 * window.devicePixelRatio;
    ctx.strokeStyle = accent;
    ctx.beginPath();
    const slice = canvas.width / buf.length;
    let x = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] / 128.0;
      const y = (v * canvas.height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += slice;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  };
  draw();
}
function getCss(varName) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
}

/* ---------- Live transcript WebSocket ---------------------------------- */
function openLiveSocket() {
  if (state.ws && state.ws.readyState <= 1) return state.ws;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "start" }));
    setSystem("recording", "Recording");
  });
  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "transcript" && msg.text) {
      appendLive(msg.text);
    } else if (msg.type === "transcript_final" && msg.text) {
      finalizeLive(msg.text);
    } else if (msg.type === "error") {
      appendLive(`[stream error] ${msg.message}`, true);
    }
  });
  ws.addEventListener("close", () => {
    state.ws = null;
  });
  ws.addEventListener("error", () => {
    /* surfaced by close */
  });
  return ws;
}
function closeLiveSocket() {
  if (state.ws && state.ws.readyState <= 1) {
    state.ws.send(JSON.stringify({ type: "stop" }));
  }
}
function appendLive(text, isError = false) {
  const stream = els.liveStream;
  const placeholder = stream.querySelector(".live-placeholder");
  if (placeholder) placeholder.remove();
  const span = document.createElement("span");
  span.className = isError ? "live-error" : "live-chunk";
  span.textContent =
    (stream.dataset.tail === " " || stream.dataset.tail === undefined
      ? ""
      : " ") + text;
  stream.dataset.tail = text.slice(-1);
  stream.appendChild(span);
  stream.scrollTop = stream.scrollHeight;
}
function finalizeLive(text) {
  const stream = els.liveStream;
  const placeholder = stream.querySelector(".live-placeholder");
  if (placeholder) placeholder.remove();
  const final = document.createElement("div");
  final.className = "live-final";
  final.textContent = text;
  stream.appendChild(final);
  stream.scrollTop = stream.scrollHeight;
  els.liveMeta.textContent = "stream closed";
}
function clearLive() {
  els.liveStream.innerHTML =
    '<span class="live-placeholder">Awaiting audio…</span>';
  els.liveMeta.textContent = "streaming from this device";
}

/* ---------- Recording -------------------------------------------------- */
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    source.connect(state.analyser);

    state.mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    state.audioChunks = [];
    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        state.audioChunks.push(e.data);
        if (state.ws && state.ws.readyState === 1) {
          // forward raw chunk to the server-side live transcriber
          e.data.arrayBuffer().then((buf) => state.ws.send(buf));
        }
      }
    };
    state.mediaRecorder.start(250);

    // create the session row up front
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Consultation · ${new Date().toLocaleString()}`,
      }),
    });
    const { id } = await res.json();
    state.sessionId = id;

    state.isRecording = true;
    els.stage.dataset.stage = "recording";
    els.btnRecord.hidden = true;
    els.btnStop.hidden = false;
    els.stageStatus.textContent = "Capturing audio from this device";
    els.livePanel.hidden = false;
    clearLive();
    openLiveSocket();
    startTimer();
    startWaveform();
  } catch (err) {
    alert("Failed to access microphone: " + err.message);
  }
}

async function stopRecording() {
  if (!state.mediaRecorder || !state.isRecording) return;
  state.isRecording = false;

  if (state.rafId) cancelAnimationFrame(state.rafId);
  if (state.audioContext) state.audioContext.close();
  state.mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  closeLiveSocket();
  const duration = stopTimer();

  els.btnRecord.hidden = false;
  els.btnStop.hidden = true;
  els.stage.dataset.stage = "processing";
  els.stageStatus.textContent = "Processing locally…";
  setSystem("processing", "Processing");

  const blob = new Blob(state.audioChunks, { type: "audio/webm" });
  try {
    await runPipeline(blob, "audio/webm", els.output, {
      title: `Consultation · ${duration}`,
    });
  } catch (err) {
    setSystem("error", "Error");
  } finally {
    els.stage.dataset.stage = "idle";
    els.stageStatus.textContent = "Press record to begin capturing audio";
    setSystem("ready", "Ready");
  }
}
els.btnRecord.addEventListener("click", startRecording);
els.btnStop.addEventListener("click", stopRecording);

/* ---------- Pipeline ---------------------------------------------------- */
const STEPS = [
  {
    id: "transcribe",
    num: "01",
    title: "Transcription",
    running: "Transcribing audio…",
  },
  {
    id: "diarize",
    num: "02",
    title: "Speaker diarization",
    running: "Identifying speakers…",
  },
  { id: "soap", num: "03", title: "SOAP note", running: "Drafting SOAP note…" },
];

function buildPipeline(container) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "pipeline";
  wrap.addEventListener("click", async (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    const dlBtn = e.target.closest("[data-download]");
    const btn = copyBtn || dlBtn;
    if (!btn) return;
    const body = btn.closest(".step-body");
    const text = body?.querySelector(".transcript-text");
    if (!text) return;
    const raw = text.innerText.trim();
    if (!raw) return;

    if (dlBtn) {
      const blob = new Blob([raw], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${body.parentElement.dataset.step || "transcript"}_${state.sessionId || "draft"}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    try {
      await navigator.clipboard.writeText(raw);
      const original = btn.textContent;
      btn.textContent = "Copied";
      btn.classList.add("is-copied");
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("is-copied");
      }, 1400);
    } catch {
      /* clipboard blocked */
    }
  });
  const refs = {};
  for (const s of STEPS) {
    const step = document.createElement("div");
    step.className = "step";
    step.dataset.step = s.id;
    step.innerHTML = `
      <div class="step-head">
        <span class="step-index">${s.num}</span>
        <span class="step-title">${s.title}</span>
        <span class="step-status">Queued</span>
      </div>
      <div class="step-body"></div>
    `;
    wrap.appendChild(step);
    refs[s.id] = {
      el: step,
      head: step,
      body: step.querySelector(".step-body"),
      status: step.querySelector(".step-status"),
    };
  }
  container.appendChild(wrap);
  return refs;
}

function setStep(refs, id, state, statusText) {
  const r = refs[id];
  if (!r) return;
  r.el.classList.remove("is-active", "is-done", "is-error");
  if (state === "active") r.el.classList.add("is-active");
  if (state === "done") r.el.classList.add("is-done");
  if (state === "error") r.el.classList.add("is-error");
  r.status.textContent =
    statusText ||
    (state === "active"
      ? "Running"
      : state === "done"
        ? "Complete"
        : state === "error"
          ? "Failed"
          : "Queued");
}

function summarizeSoap(soap) {
  const sections = [
    { key: "subjective", label: "Subjective" },
    { key: "objective", label: "Objective" },
    { key: "assessment", label: "Assessment" },
    { key: "plan", label: "Plan" },
  ];
  return sections
    .map(({ key, label }) => {
      const raw = (soap[key] || "").trim();
      const isEmpty = !raw || raw.toLowerCase() === "not discussed.";
      const words = isEmpty ? 0 : raw.split(/\s+/).filter(Boolean).length;
      const preview = isEmpty
        ? "Not discussed"
        : raw.length > 90
          ? raw.slice(0, 90).trimEnd() + "…"
          : raw;
      return `
      <div class="soap-summary-row${isEmpty ? " is-empty" : ""}">
        <div class="soap-summary-label">${label}</div>
        <div class="soap-summary-meta">${words} ${words === 1 ? "word" : "words"}</div>
        <div class="soap-summary-preview">${escapeHtml(preview)}</div>
      </div>
    `;
    })
    .join("");
}

function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function renderTranscriptResult(text, opts = {}) {
  const { words, chars } = {
    words: countWords(text),
    chars: text ? text.length : 0,
  };
  const segments = opts.segments;
  const speakers = opts.speakers;
  const statItems = [];
  statItems.push([`Words`, String(words)]);
  statItems.push([`Characters`, String(chars)]);
  if (typeof segments === "number")
    statItems.push([`Segments`, String(segments)]);
  if (typeof speakers === "number")
    statItems.push([`Speakers`, String(speakers)]);

  const stats = statItems
    .map(
      ([k, v]) =>
        `<span><span class="stat-label">${k}</span><span class="stat-value">${v}</span></span>`,
    )
    .join("");

  const safeText = (text || "").toString();

  return `
    <div class="result-bar">
      <div class="result-stats">${stats}</div>
      <div class="result-actions">
        <button type="button" class="result-copy" data-copy="1">Copy</button>
        <button type="button" class="result-copy" data-download="1">Download</button>
      </div>
    </div>
    <div class="transcript-text">${safeText || "<em>No text returned.</em>"}</div>
  `;
}

function renderDiarized(diarized, fallbackTranscript) {
  if (!diarized || diarized.length === 0) {
    return fallbackTranscript || "";
  }
  const map = new Map();
  let idx = 0;
  return diarized
    .filter((s) => s.text)
    .map((s) => {
      if (!map.has(s.speaker)) {
        map.set(s.speaker, idx === 0 ? "Doctor" : "Patient");
        idx++;
      }
      const label = map.get(s.speaker);
      return `<span class="speaker-${label.toLowerCase()}">${label}:</span> ${escapeHtml(s.text)}`;
    })
    .join("\n");
}

function renderSoap(container, soap) {
  const wrap = document.createElement("div");
  wrap.className = "soap";

  const sections = [
    { key: "subjective", num: "01", label: "Subjective" },
    { key: "objective", num: "02", label: "Objective" },
    { key: "assessment", num: "03", label: "Assessment" },
    { key: "plan", num: "04", label: "Plan" },
  ];

  const grid = document.createElement("div");
  grid.className = "soap-grid";
  for (const { key, num, label } of sections) {
    const cell = document.createElement("div");
    cell.className = "soap-cell";
    cell.innerHTML = `
      <div class="soap-cell-header">
        <span class="soap-cell-num">${num}</span>
        <span class="soap-cell-label">${label}</span>
      </div>
      <div class="soap-cell-body" contenteditable="true" data-soap="${key}">${escapeHtml(soap[key] || "")}</div>
    `;
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);

  if (soap.stats) {
    const s = soap.stats;
    const items = [];
    if (s.tokensPerSecond)
      items.push(["Throughput", `${s.tokensPerSecond.toFixed(1)} tok/s`]);
    if (s.generatedTokens) items.push(["Tokens", `${s.generatedTokens}`]);
    if (s.timeToFirstToken)
      items.push([
        "Time to first",
        `${(s.timeToFirstToken / 1000).toFixed(1)}s`,
      ]);
    if (s.backendDevice)
      items.push(["Device", String(s.backendDevice).toUpperCase()]);
    if (items.length) {
      const stats = document.createElement("div");
      stats.className = "soap-stats";
      stats.innerHTML = items
        .map(
          ([k, v]) =>
            `<span><span class="stat-label">${k}</span><span class="stat-value">${v}</span></span>`,
        )
        .join("");
      wrap.appendChild(stats);
    }
  }
  container.appendChild(wrap);
  return wrap;
}

function getEditedSoap(root) {
  const out = {};
  $$("[data-soap]", root).forEach((el) => {
    out[el.dataset.soap] = el.innerText.trim();
  });
  return out;
}

/* ---------- SOAP streaming (SSE) ---------------------------------------- */
function renderSoapStreamInit() {
  return `
    <div class="soap-stream" data-soap-stream>
      <div class="soap-stream-head">
        <span class="soap-stream-pulse" aria-hidden="true"></span>
        <span class="soap-stream-label">Streaming SOAP note</span>
      </div>
      <div class="soap-stream-metrics">
        <div class="soap-stream-metric">
          <div class="metric-label">Tokens / sec</div>
          <div class="metric-value" data-metric="tps">—</div>
        </div>
        <div class="soap-stream-metric">
          <div class="metric-label">Tokens</div>
          <div class="metric-value" data-metric="tokens">0</div>
        </div>
        <div class="soap-stream-metric">
          <div class="metric-label">Elapsed</div>
          <div class="metric-value" data-metric="elapsed">0.0s</div>
        </div>
        <div class="soap-stream-metric">
          <div class="metric-label">Time to first</div>
          <div class="metric-value" data-metric="ttft">—</div>
        </div>
        <div class="soap-stream-metric">
          <div class="metric-label">Device</div>
          <div class="metric-value" data-metric="device">—</div>
        </div>
      </div>
      <div class="soap-stream-preview" data-metric="preview">Waiting for first token…</div>
    </div>
  `;
}

function updateSoapStream(root, patch) {
  if (!root) return;
  const tps = root.querySelector('[data-metric="tps"]');
  const tokens = root.querySelector('[data-metric="tokens"]');
  const elapsed = root.querySelector('[data-metric="elapsed"]');
  const ttft = root.querySelector('[data-metric="ttft"]');
  const device = root.querySelector('[data-metric="device"]');
  const preview = root.querySelector('[data-metric="preview"]');

  if (patch.tokensPerSecond !== undefined && tps) {
    tps.textContent = patch.tokensPerSecond.toFixed(1);
  }
  if (patch.tokenCount !== undefined && tokens) {
    tokens.textContent = String(patch.tokenCount);
  }
  if (patch.elapsedMs !== undefined && elapsed) {
    elapsed.textContent = `${(patch.elapsedMs / 1000).toFixed(1)}s`;
  }
  if (patch.timeToFirstToken !== undefined && ttft) {
    ttft.textContent = `${(patch.timeToFirstToken / 1000).toFixed(2)}s`;
  }
  if (patch.backendDevice && device && device.textContent === "—") {
    device.textContent = String(patch.backendDevice).toUpperCase();
  }
  if (patch.text && preview) {
    const trimmed =
      patch.text.length > 400
        ? "…" + patch.text.slice(patch.text.length - 400)
        : patch.text;
    preview.textContent = trimmed;
    preview.scrollTop = preview.scrollHeight;
  }
}

function parseSSEChunk(buffer) {
  const events = [];
  let rest = buffer;
  // SSE messages are separated by a blank line (\n\n)
  let sepIdx;
  while ((sepIdx = rest.indexOf("\n\n")) !== -1) {
    const raw = rest.slice(0, sepIdx);
    rest = rest.slice(sepIdx + 2);
    let event = "message";
    const dataLines = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length) {
      const dataStr = dataLines.join("\n");
      try {
        events.push({ event, data: JSON.parse(dataStr) });
      } catch {
        events.push({ event, data: dataStr });
      }
    }
  }
  return { events, rest };
}

async function runSoapStream(sessionId, transcript, stepBody) {
  const res = await fetch(`/api/sessions/${sessionId}/soap/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`SOAP stream failed (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let soap = null;
  let lastText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSSEChunk(buffer);
    buffer = rest;

    for (const { event, data } of events) {
      if (event === "token") {
        lastText = data.text ?? lastText;
        updateSoapStream(stepBody, {
          tokenCount: data.tokenCount,
          tokensPerSecond: data.tokensPerSecond,
          elapsedMs: data.elapsedMs,
          text: lastText,
        });
      } else if (event === "ttft") {
        updateSoapStream(stepBody, { timeToFirstToken: data.timeToFirstToken });
      } else if (event === "done") {
        soap = data.soap;
        updateSoapStream(stepBody, {
          tokenCount: data.tokenCount,
          tokensPerSecond: data.tokensPerSecond,
          elapsedMs: data.elapsedMs,
          timeToFirstToken: data.timeToFirstToken,
          backendDevice: data.backendDevice,
        });
      } else if (event === "error") {
        throw new Error(data.message || "SOAP generation failed");
      }
    }
  }

  if (!soap) throw new Error("SOAP stream ended without a result");
  return soap;
}

async function runPipeline(audioBlob, contentType, outputEl, meta = {}) {
  outputEl.hidden = false;
  outputEl.innerHTML = "";
  const refs = buildPipeline(outputEl);
  const buf = await audioBlob.arrayBuffer();

  // 01 — transcribe
  setStep(refs, "transcribe", "active", "Transcribing audio");
  let transcript = "";
  try {
    const res = await fetch(`/api/sessions/${state.sessionId}/transcribe`, {
      method: "POST",
      body: buf,
      headers: { "Content-Type": contentType },
    });
    if (!res.ok) throw new Error("Transcription failed");
    const data = await res.json();
    transcript = data.transcript || "";
    refs.transcribe.body.innerHTML = renderTranscriptResult(transcript);
    setStep(refs, "transcribe", "done");
  } catch (err) {
    setStep(refs, "transcribe", "error", err.message);
    throw err;
  }

  // 02 — diarize
  setStep(refs, "diarize", "active", "Identifying speakers");
  let diarizedText = "";
  let diarizedSegments = [];
  try {
    const res = await fetch(`/api/sessions/${state.sessionId}/diarize`, {
      method: "POST",
      body: buf,
      headers: { "Content-Type": contentType },
    });
    if (!res.ok) throw new Error("Diarization failed");
    const data = await res.json();
    diarizedSegments = data.diarized || [];
    diarizedText = renderDiarized(diarizedSegments, transcript);
    const speakerSet = new Set(diarizedSegments.map((s) => s.speaker));
    refs.diarize.body.innerHTML = renderTranscriptResult(
      diarizedText || "<em>No segments detected.</em>",
      { segments: diarizedSegments.length, speakers: speakerSet.size },
    );
    setStep(refs, "diarize", "done");
  } catch (err) {
    setStep(refs, "diarize", "error", err.message);
    throw err;
  }

  // 03 — SOAP (SSE streaming with live perf metrics)
  setStep(refs, "soap", "active", "Drafting SOAP note");
  refs.soap.body.innerHTML = renderSoapStreamInit();
  let soap;
  try {
    soap = await runSoapStream(
      state.sessionId,
      diarizedText || transcript,
      refs.soap.body,
    );
    refs.soap.body.innerHTML = `<div class="soap-summary">${summarizeSoap(soap)}</div>`;
    setStep(refs, "soap", "done");
  } catch (err) {
    setStep(refs, "soap", "error", err.message);
    throw err;
  }

  // render SOAP note + actions
  const soapEl = renderSoap(outputEl, soap);
  const actions = document.createElement("div");
  actions.className = "soap-actions";
  actions.style.cssText =
    "display:flex;gap:8px;padding:0 24px 24px;background:var(--surface);border-top:1px solid var(--hairline);margin-top:1rem;";
  actions.innerHTML = `
    <button class="btn-secondary" data-action="copy">Copy note</button>
    <button class="btn-primary" data-action="export" style="margin-left:auto;">Export SOAP</button>
  `;
  soapEl.appendChild(actions);

  actions.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "copy") {
      const text = formatSoapForExport(getEditedSoap(soapEl));
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = "Copy note"), 1500);
      } catch {
        /* ignore */
      }
    } else if (btn.dataset.action === "export") {
      const text = formatSoapForExport(getEditedSoap(soapEl));
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `soap_${state.sessionId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  // Scroll the result into view so the user actually sees it
  requestAnimationFrame(() => {
    refs.transcribe.el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function formatSoapForExport(soap) {
  return [
    "SOAP NOTE",
    "AI-generated draft — requires clinician review",
    "",
    "SUBJECTIVE:",
    soap.subjective || "Not discussed.",
    "",
    "OBJECTIVE:",
    soap.objective || "Not discussed.",
    "",
    "ASSESSMENT:",
    soap.assessment || "Not discussed.",
    "",
    "PLAN:",
    soap.plan || "Not discussed.",
  ].join("\n");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- Upload ------------------------------------------------------ */
els.dropzone.addEventListener("click", (e) => {
  if (e.target.closest("#btn-remove-file")) return;
  els.fileInput.click();
});
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.dropzone.classList.add("is-dragging");
});
els.dropzone.addEventListener("dragleave", () =>
  els.dropzone.classList.remove("is-dragging"),
);
els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropzone.classList.remove("is-dragging");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
els.fileInput.addEventListener("change", (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});
els.btnRemoveFile.addEventListener("click", (e) => {
  e.stopPropagation();
  clearFile();
});
els.btnGenerate.addEventListener("click", processUpload);

function handleFile(file) {
  if (
    !file.type.startsWith("audio/") &&
    !file.name.match(/\.(m4a|mp3|wav|webm)$/i)
  ) {
    alert("Please select an audio file (M4A, MP3, WAV, or WEBM).");
    return;
  }
  state.selectedFile = file;
  els.fileName.textContent = file.name;
  els.fileSize.textContent = humanSize(file.size);
  els.dropzoneEmpty.hidden = true;
  els.dropzoneFile.hidden = false;
  els.btnGenerate.disabled = false;
  els.uploadOutput.innerHTML = "";
}
function clearFile() {
  state.selectedFile = null;
  els.fileInput.value = "";
  els.dropzoneEmpty.hidden = false;
  els.dropzoneFile.hidden = true;
  els.btnGenerate.disabled = true;
  els.uploadOutput.innerHTML = "";
}
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function processUpload() {
  if (!state.selectedFile) return;
  els.btnGenerate.disabled = true;
  els.btnRemoveFile.disabled = true;
  setSystem("processing", "Processing");
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: state.selectedFile.name }),
    });
    const { id } = await res.json();
    state.sessionId = id;
    await runPipeline(
      state.selectedFile,
      state.selectedFile.type || "audio/m4a",
      els.uploadOutput,
    );
  } catch {
    setSystem("error", "Error");
  } finally {
    els.btnRemoveFile.disabled = false;
    els.btnGenerate.disabled = !state.selectedFile;
    setSystem("ready", "Ready");
  }
}

/* ---------- Library ----------------------------------------------------- */
async function loadLibrary() {
  try {
    const res = await fetch("/api/sessions");
    const { sessions } = await res.json();
    renderLibrary(sessions || []);
  } catch (err) {
    els.libraryEmpty.querySelector(".library-empty-hint").textContent =
      "Could not load sessions: " + err.message;
  }
}

function renderLibrary(sessions) {
  if (!sessions.length) {
    els.libraryEmpty.hidden = false;
    els.libraryList.hidden = true;
    els.libraryList.innerHTML = "";
    return;
  }
  els.libraryEmpty.hidden = true;
  els.libraryList.hidden = false;
  els.libraryList.innerHTML = sessions
    .map((s) => {
      const tag = (s.status || "recording").toLowerCase();
      const date = new Date(s.created_at);
      return `
      <div class="session-card" data-id="${s.id}">
        <div class="session-info">
          <div class="session-title">${escapeHtml(s.title || "Untitled session")}</div>
          <div class="session-meta">
            <time>${date.toLocaleString()}</time>
            <span>·</span>
            <span>#${s.id}</span>
          </div>
        </div>
        <span class="session-tag tag-${tag}">${tag}</span>
        <span class="session-open" aria-hidden="true">→</span>
      </div>
    `;
    })
    .join("");

  $$(".session-card", els.libraryList).forEach((card) => {
    card.addEventListener("click", () => openSession(Number(card.dataset.id)));
  });
}

async function openSession(id) {
  els.libraryDetail.hidden = false;
  els.libraryDetail.innerHTML = `<div class="detail-body" style="padding:32px;color:var(--ink-4);">Loading…</div>`;
  try {
    const res = await fetch(`/api/sessions/${id}`);
    const data = await res.json();
    if (!data.session) {
      els.libraryDetail.innerHTML = `<div class="detail-body" style="padding:32px;color:var(--ink-4);">Session not found.</div>`;
      return;
    }
    const s = data.session;
    const tag = (s.status || "recording").toLowerCase();
    const transcriptHtml = (data.transcripts || [])
      .map(
        (t) =>
          `<span class="speaker-${(t.speaker || "speaker").toLowerCase()}">${escapeHtml(t.speaker || "Speaker")}:</span> ${escapeHtml(t.text)}`,
      )
      .join("\n");

    els.libraryDetail.innerHTML = `
      <div class="detail-head">
        <div>
          <div class="detail-title">${escapeHtml(s.title || "Untitled session")}</div>
          <div class="detail-meta">${new Date(s.created_at).toLocaleString()} · #${s.id}</div>
        </div>
        <span class="session-tag tag-${tag}">${tag}</span>
      </div>
      <div class="detail-body">
        ${
          data.soap
            ? `<div id="detail-soap"></div>
             <h3 class="workspace-eyebrow" style="margin-top:32px;">Transcript</h3>
             <div class="transcript-text" style="margin-top:8px;">${transcriptHtml || "<em>No transcript.</em>"}</div>`
            : `<h3 class="workspace-eyebrow">Transcript</h3>
             <div class="transcript-text" style="margin-top:8px;">${transcriptHtml || "<em>No transcript.</em>"}</div>
             <p style="margin-top:16px;color:var(--ink-4);">No SOAP note generated yet.</p>`
        }
      </div>
    `;
    if (data.soap) {
      renderSoap($("#detail-soap"), data.soap);
    }
    els.libraryDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    els.libraryDetail.innerHTML = `<div class="detail-body" style="padding:32px;color:var(--live);">${escapeHtml(err.message)}</div>`;
  }
}

/* ---------- Boot -------------------------------------------------------- */
buildIdleBars();
setSystem("ready", "Ready");
setView(readTabFromUrl());

fetch("/api/health")
  .then((r) => r.json())
  .then(() => console.log("Paperdoc connected"))
  .catch(() => console.error("Server unreachable"));
