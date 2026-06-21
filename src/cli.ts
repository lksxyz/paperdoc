#!/usr/bin/env bun
import { existsSync, symlinkSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, PAPERDOC_DIR, PAPERDOC_MODELS_DIR, QVAC_MODELS_DIR, ensureDirs } from "./config.js";
import { spawnSync } from "node:child_process";

const command = process.argv[2];

function printBanner() {
  console.log(`
  PAPERDOC — Medical Scribe AI (Local-first, offline)
  `);
}

function checkFFmpeg(): boolean {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

function linkModels() {
  ensureDirs();

  if (!existsSync(QVAC_MODELS_DIR)) {
    console.log("  ⚠ ~/.qvac/models/ not found. Models will be downloaded on first use.");
    return;
  }

  const qvacFiles = readdirSync(QVAC_MODELS_DIR);
  let linked = 0;

  for (const file of qvacFiles) {
    const src = join(QVAC_MODELS_DIR, file);
    
    // Strip hash prefix (e.g., "574dfe543bfdae68_ggml-tiny.bin" -> "ggml-tiny.bin")
    const cleanName = file.replace(/^[a-f0-9]{16}_/, "");
    const dest = join(PAPERDOC_MODELS_DIR, cleanName);

    if (existsSync(dest)) {
      try {
        unlinkSync(dest);
      } catch {
        // ignore
      }
    }

    try {
      symlinkSync(src, dest);
      linked++;
    } catch {
      // ignore failed symlinks
    }
  }

  if (linked > 0) {
    console.log(`  ✓ Linked ${linked} model(s) from ~/.qvac/models/`);
  }
}

async function downloadModels() {
  printBanner();
  console.log("  Downloading models...\n");

  const config = loadConfig();
  const { loadModel, unloadModel } = await import("@qvac/sdk");

  const models = [
    { name: "Live ASR (Whisper Tiny)", const: config.models.asr_live, type: "whispercpp-transcription" },
    { name: "Batch Transcription (Parakeet TDT)", const: config.models.asr_batch, type: "parakeet-transcription" },
    { name: "Speaker Diarization (Sortformer)", const: config.models.diarization, type: "parakeet-transcription" },
    { name: "SOAP LLM (Qwen3-4B)", const: config.models.llm, type: "llamacpp-completion" },
  ];

  for (const model of models) {
    console.log(`  ▸ ${model.name}`);
    try {
      const modelId = await loadModel({
        modelSrc: model.const,
        modelType: model.type,
        onProgress: (p) => {
          const mb = (n: number) => (n / 1e6).toFixed(1);
          const line = `    ${p.percentage.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)`;
          process.stderr.write(process.stderr.isTTY ? `\r${line}` : `${line}\n`);
          if (p.percentage >= 100) process.stderr.write("\n");
        },
      });
      await unloadModel({ modelId });
      console.log(`    ✓ Done`);
    } catch (err) {
      console.error(`    ✖ Failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\n  All downloads complete.");
}

async function runServer() {
  printBanner();

  if (!checkFFmpeg()) {
    console.error("  ✖ FFmpeg is not installed.");
    console.error("    Install it with:");
    console.error("      Debian/Ubuntu: sudo apt install ffmpeg");
    console.error("      Fedora:        sudo dnf install ffmpeg");
    console.error("      Arch:          sudo pacman -S ffmpeg");
    process.exit(1);
  }

  console.log("  ✓ FFmpeg detected");
  linkModels();

  const config = loadConfig();
  console.log(`  ▸ Starting server on http://localhost:${config.port}\n`);

  const { startServer } = await import("./server/index.js");
  await startServer(config.port);
}

async function main() {
  if (command === "download-model") {
    await downloadModels();
  } else if (command === "run" || !command) {
    await runServer();
  } else {
    console.log(`Usage: paperdoc <command>

Commands:
  run            Start the Paperdoc server (default)
  download-model Download all required AI models

Examples:
  ./paperdoc run
  ./paperdoc download-model
`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
