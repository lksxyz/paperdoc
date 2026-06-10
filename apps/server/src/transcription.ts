import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PARAKEET_TDT_0_6B_V3_Q8_0, loadModel, transcribe, unloadModel } from "@qvac/sdk";

let modelId: number | null = null;
let loadingPromise: Promise<number> | null = null;

async function getModel(): Promise<number> {
  if (modelId !== null) return modelId;
  if (loadingPromise) return await loadingPromise;

  const promise = loadModel({
    modelSrc: PARAKEET_TDT_0_6B_V3_Q8_0,
    modelType: "parakeet-transcription",
    onProgress: (progress: { percentage: number }) => {
      console.log(`[parakeet] download ${progress.percentage.toFixed(1)}%`);
    },
  });
  loadingPromise = promise;

  try {
    const id = await promise;
    modelId = id;
    return id;
  } finally {
    loadingPromise = null;
  }
}

function decodeToWav16kMono(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-f",
        "wav",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        "16000",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const chunks: Buffer[] = [];
    let stderr = "";
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    ffmpeg.stdin.on("error", reject);
    ffmpeg.stdin.write(input);
    ffmpeg.stdin.end();
  });
}

async function writeTempWav(wav: Buffer): Promise<string> {
  const dir = join(tmpdir(), "paperdoc-transcribe");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${Date.now()}-${randomBytes(6).toString("hex")}.wav`);
  await writeFile(path, wav);
  return path;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
): Promise<{ text: string; durationMs: number }> {
  const start = Date.now();
  const id = await getModel();
  const wav = await decodeToWav16kMono(audioBuffer);
  const tmpPath = await writeTempWav(wav);

  try {
    const text = await transcribe({ modelId: id, audioChunk: tmpPath });
    return { text, durationMs: Date.now() - start };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

let shutdownRegistered = false;
function registerShutdown(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const handler = (signal: NodeJS.Signals) => {
    shutdown()
      .catch((err) => console.error(`[parakeet] shutdown error:`, err))
      .finally(() => process.exit(0));
    console.log(`[parakeet] received ${signal}, unloading model…`);
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}

export async function shutdown(): Promise<void> {
  if (modelId === null) return;
  const id = modelId;
  modelId = null;
  try {
    await unloadModel({ modelId: id });
  } catch (err) {
    console.error("[parakeet] unload failed:", err);
  }
}

registerShutdown();
