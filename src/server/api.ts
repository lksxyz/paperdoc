import { Hono } from "hono";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  createSession,
  updateSessionStatus,
  saveTranscript,
  saveSoapNote,
  getSession,
  getSessions,
  deleteSession,
} from "./db.js";
import { transcribeWithDiarization, transcribeLive, transcribeBatch } from "../qvac/transcribe.js";
import { generateSoap } from "../qvac/soap.js";
import { getLog, clearLog } from "../qvac/audit.js";

export const apiRoutes = new Hono();

apiRoutes.get("/health", (c) => c.json({ status: "ok" }));

apiRoutes.get("/audit-log", (c) => c.json({ events: getLog() }));

apiRoutes.delete("/audit-log", (c) => {
  clearLog();
  return c.json({ ok: true });
});

apiRoutes.get("/sessions", (c) => {
  const sessions = getSessions();
  return c.json({ sessions });
});

apiRoutes.post("/sessions", async (c) => {
  const body = await c.req.json();
  const id = createSession(body.title);
  return c.json({ id, status: "recording" }, 201);
});

apiRoutes.get("/sessions/:id", (c) => {
  const id = Number(c.req.param("id"));
  const data = getSession(id);
  if (!data.session) return c.json({ error: "Not found" }, 404);
  return c.json(data);
});

apiRoutes.delete("/sessions/:id", (c) => {
  const id = Number(c.req.param("id"));
  deleteSession(id);
  return c.json({ ok: true });
});

// Step 1: Transcribe audio (returns raw text immediately)
apiRoutes.post("/sessions/:id/transcribe", async (c) => {
  const sessionId = Number(c.req.param("id"));
  const body = await c.req.arrayBuffer();

  if (!body || body.byteLength === 0) {
    return c.json({ error: "No audio data" }, 400);
  }

  const wavPath = await saveAndConvert(sessionId, body, c.req.header("content-type") || "");
  if (typeof wavPath === "object") return wavPath; // error response

  try {
    const text = await transcribeBatch(wavPath);
    await saveRawTranscript(sessionId, text);
    try { rmSync(wavPath); } catch {}
    return c.json({ transcript: text });
  } catch (err) {
    try { rmSync(wavPath); } catch {}
    return c.json({ error: "Transcription failed", detail: String(err) }, 500);
  }
});

// Step 2: Diarization (accepts audio + optional transcript in query for text mapping)
apiRoutes.post("/sessions/:id/diarize", async (c) => {
  const sessionId = Number(c.req.param("id"));
  const body = await c.req.arrayBuffer();

  if (!body || body.byteLength === 0) {
    return c.json({ error: "No audio data" }, 400);
  }

  const wavPath = await saveAndConvert(sessionId, body, c.req.header("content-type") || "");
  if (typeof wavPath === "object") return wavPath;

  try {
    const session = getSession(sessionId);
    const storedTranscript = (session.transcripts || [])
      .map(t => t.text)
      .join(" ");

    const { runSortformerWithText } = await import("../qvac/transcribe.js");
    const segments = await runSortformerWithText(wavPath, storedTranscript);

    for (const seg of segments) {
      saveTranscript(sessionId, seg.speaker, seg.text, seg.startMs, seg.endMs);
    }

    try { rmSync(wavPath); } catch {}
    return c.json({ diarized: segments });
  } catch (err) {
    try { rmSync(wavPath); } catch {}
    return c.json({ error: "Diarization failed", detail: String(err) }, 500);
  }
});

// Step 3: Generate SOAP (returns SOAP note immediately)
apiRoutes.post("/sessions/:id/soap", async (c) => {
  const sessionId = Number(c.req.param("id"));
  const body = await c.req.json();
  const transcript = body.transcript || "";

  if (!transcript) {
    return c.json({ error: "No transcript provided" }, 400);
  }

  try {
    const soap = await generateSoap(transcript);
    saveSoapNote(sessionId, soap);
    updateSessionStatus(sessionId, "completed");
    return c.json({ soap });
  } catch (err) {
    return c.json({ error: "SOAP generation failed", detail: String(err) }, 500);
  }
});

// Step 3 (streaming): Generate SOAP with SSE — emits token + stats events
apiRoutes.post("/sessions/:id/soap/stream", async (c) => {
  const sessionId = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const transcript = body.transcript || "";

  if (!transcript) {
    return c.json({ error: "No transcript provided" }, 400);
  }

  updateSessionStatus(sessionId, "processing");

  const encoder = new TextEncoder();
  let savedSoapId: number | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream closed */ }
      };

      try {
        const { generateSoapStream } = await import("../qvac/soap.js");
        for await (const ev of generateSoapStream(transcript)) {
          if (ev.type === "token") {
            send("token", {
              token: ev.token,
              text: ev.text,
              tokenCount: ev.tokenCount,
              tokensPerSecond: ev.tokensPerSecond,
              elapsedMs: ev.elapsedMs,
            });
          } else if (ev.type === "ttft") {
            send("ttft", { timeToFirstToken: ev.timeToFirstToken });
          } else if (ev.type === "done") {
            saveSoapNote(sessionId, ev.soap);
            updateSessionStatus(sessionId, "completed");
            send("done", {
              soap: ev.soap,
              tokenCount: ev.tokenCount,
              tokensPerSecond: ev.tokensPerSecond,
              elapsedMs: ev.elapsedMs,
              timeToFirstToken: ev.timeToFirstToken,
              backendDevice: ev.backendDevice,
            });
          } else if (ev.type === "error") {
            updateSessionStatus(sessionId, "error");
            send("error", { message: ev.message });
          }
        }
      } catch (err) {
        updateSessionStatus(sessionId, "error");
        send("error", { message: String(err) });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      // client disconnected — best-effort, the in-flight generator will drain
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// Full pipeline (original endpoint, kept for compatibility)
apiRoutes.post("/sessions/:id/process", async (c) => {
  const sessionId = Number(c.req.param("id"));
  const body = await c.req.arrayBuffer();

  if (!body || body.byteLength === 0) {
    return c.json({ error: "No audio data" }, 400);
  }

  const wavPath = await saveAndConvert(sessionId, body, c.req.header("content-type") || "");
  if (typeof wavPath === "object") return wavPath;

  updateSessionStatus(sessionId, "processing");

  try {
    const result = await transcribeWithDiarization(wavPath);

    for (const seg of result.diarized) {
      saveTranscript(sessionId, seg.speaker, seg.text, seg.startMs, seg.endMs);
    }

    const transcript = result.formatted || `Speaker: ${result.raw}`;
    const soap = await generateSoap(transcript);
    saveSoapNote(sessionId, soap);
    updateSessionStatus(sessionId, "completed");

    try { rmSync(wavPath); } catch {}

    return c.json({
      transcript: result.formatted || result.raw,
      diarized: result.diarized,
      soap,
    });
  } catch (err) {
    updateSessionStatus(sessionId, "error");
    console.error("Processing error:", err);
    try { rmSync(wavPath); } catch {}
    return c.json({ error: "Processing failed", detail: String(err) }, 500);
  }
});

async function runDiarization(wavPath: string): Promise<{speaker: string, text: string, startMs: number, endMs: number}[]> {
  const { runSortformer } = await import("../qvac/transcribe.js");
  return await runSortformer(wavPath);
}

async function saveRawTranscript(sessionId: number, text: string) {
  saveTranscript(sessionId, "Speaker", text, 0, 0);
}

async function saveAndConvert(sessionId: number, body: ArrayBuffer, contentType: string): Promise<string | Response> {
  const tempDir = join(tmpdir(), "paperdoc", String(sessionId));
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  const id = randomUUID();

  let detectedExt = "webm";
  if (contentType.includes("mp4") || contentType.includes("m4a") || contentType.includes("aac")) {
    detectedExt = "m4a";
  } else if (contentType.includes("wav")) {
    detectedExt = "wav";
  } else if (contentType.includes("mpeg") || contentType.includes("mp3")) {
    detectedExt = "mp3";
  }

  const inputPath = join(tempDir, `audio_${id}.${detectedExt}`);
  const wavPath = join(tempDir, `audio_${id}_converted.wav`);

  writeFileSync(inputPath, Buffer.from(body));

  const ffmpegResult = spawnSync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-ac", "1",
    "-ar", "16000",
    "-f", "wav",
    wavPath
  ], { stdio: ["ignore", "ignore", "pipe"] });

  try { rmSync(inputPath); } catch {}

  if (ffmpegResult.status !== 0) {
    const msg = ffmpegResult.stderr?.toString() || "Unknown FFmpeg error";
    console.error("FFmpeg error:", msg);
    throw new Error(msg);
  }

  return wavPath;
}

apiRoutes.get("/sessions/:id/export", (c) => {
  const sessionId = Number(c.req.param("id"));
  const data = getSession(sessionId);

  if (!data.soap) {
    return c.json({ error: "No SOAP note found" }, 404);
  }

  const content = `SOAP NOTE
Generated by Paperdoc (AI-generated draft — requires clinician review)
Session: ${data.session?.title || "Untitled"}
Date: ${data.session?.created_at || new Date().toISOString()}

---

SUBJECTIVE:
${data.soap.subjective || "Not discussed."}

OBJECTIVE:
${data.soap.objective || "Not discussed."}

ASSESSMENT:
${data.soap.assessment || "Not discussed."}

PLAN:
${data.soap.plan || "Not discussed."}

---

Transcript:
${data.transcripts?.map((t: any) => `${t.speaker}: ${t.text}`).join("\n") || ""}
`;

  c.header("Content-Type", "text/plain");
  c.header("Content-Disposition", `attachment; filename="soap_${sessionId}.txt"`);
  return c.body(content);
});
