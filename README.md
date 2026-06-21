# Paperdoc — Medical Scribe AI

**AI-powered SOAP note generation from doctor-patient conversations — entirely offline, no cloud, no PHI leaves the device.**

Built for the [QVAC Hackathon I — Unleash Edge AI](https://dorahacks.io/hackathon/qvac-unleach-edge-ai-i/detail), Paperdoc is a local-first medical scribe that runs entirely on the doctor's machine. It records conversations, transcribes them with speaker diarization, and generates structured SOAP notes — all using the [QVAC SDK](https://qvac.tether.io/dev/sdk/) for on-device inference with zero cloud calls.

## Pipeline

1. **Record** — Browser captures audio via MediaRecorder, streams chunks to the server over WebSocket
2. **Live display** — Whisper Tiny runs real-time streaming transcription (undifferentiated, confirmation only)
3. **Stop & process** — Full audio → Parakeet TDT batch transcription + Sortformer diarization → speaker-labeled transcript
4. **SOAP generation** — Qwen3-1.7B generates editable SUBJECTIVE / OBJECTIVE / ASSESSMENT / PLAN sections
5. **Export** — Review, edit inline, download as `.txt`

## Features

-   Real-time streaming transcript during recording
-   Speaker diarization (Doctor / Patient labeling)
-   Editable SOAP note with live SSE streaming metrics (tok/s, TTFT)
-   Session library to revisit past consultations
-   Upload pre-recorded audio for batch processing
-   Full audit trail (model loads, inference performance, timing)
-   Graceful shutdown — waits for in-flight inference to complete
-   AI-generated draft disclaimer — persistent banner

## Prerequisites

| Dependency | Required | Notes |
|---|---|---|
| **Bun** >= 1.1.0 | Yes | Runtime (download from [bun.sh](https://bun.sh)) |
| **FFmpeg** | Yes | Audio processing; install via system package manager |
| **Vulkan runtime** | Yes | Required by QVAC SDK for GPU inference on Linux |
| **Node.js** >= 22.17 | Yes | Required by QVAC SDK Bare worker process |
| **pnpm** | For dev | Package manager (npm, yarn, or bun also work) |
| **~2 GB disk space** | Yes | Models: Whisper Tiny (44MB) + Parakeet TDT (750MB) + Sortformer (140MB) + Qwen3-1.7B (1.1GB) |

### FFmpeg install

```bash
# Debian / Ubuntu
sudo apt install ffmpeg

# Fedora
sudo dnf install ffmpeg

# Arch
sudo pacman -S ffmpeg

# macOS
brew install ffmpeg
```

## Quick Start (Development)

```bash
# 1. Clone the repo
git clone https://github.com/lksxyz/paperdoc.git
cd paperdoc

# 2. Install dependencies
pnpm install

# 3. Download AI models (Whisper, Parakeet TDT, Sortformer, Qwen3-1.7B)
#    ~2GB total — models are cached in ~/.qvac/models/
bun run download-model

# 4. Start the server
bun run dev
```

Open **http://localhost:7321** in your browser. The server auto-detects models from `~/.qvac/models/` and symlinks them into `~/.paperdoc/models/`.

On first run, models that weren't pre-downloaded will be fetched on-demand with a live progress bar shown in the terminal. You can also download them all upfront with `bun run download-model`.

## Build AppImage (Linux)

```bash
./build/appimage.sh
```

Output: `build/Paperdoc-x86_64.AppImage`

## Configuration

Customize via `~/.paperdoc/config.yml`:

```yaml
port: 7321
models:
  asr_live: "WHISPER_EN_TINY_Q8_0"
  asr_batch: "PARAKEET_TDT_0_6B_V3_Q8_0"
  diarization: "PARAKEET_SORTFORMER_4SPK_V2_1_Q8_0"
  llm: "QWEN3_1_7B_INST_Q4"
ui:
  theme: "light"
  language: "en"
download:
  auto_download: true
  parallel: false
```

## Tech Stack

-   **AI SDK**: [QVAC SDK](https://qvac.tether.io/dev/sdk/) v0.13.3 — local-first AI by Tether
-   **Runtime**: Bun (bundled inside AppImage)
-   **Web server**: [Hono](https://hono.dev/)
-   **Database**: SQLite (better-sqlite3 via QVAC)
-   **Frontend**: Vanilla JS + CSS (no framework)
-   **Distribution**: AppImage for Linux

## Models

| Purpose | QVAC Constant | Size |
|---|---|---|
| Live ASR (streaming) | `WHISPER_EN_TINY_Q8_0` | ~44 MB |
| Batch transcription | `PARAKEET_TDT_0_6B_V3_Q8_0` | ~750 MB |
| Speaker diarization | `PARAKEET_SORTFORMER_4SPK_V2_1_Q8_0` | ~140 MB |
| SOAP generation | `QWEN3_1_7B_INST_Q4` | ~1.1 GB |

## Data Privacy

- **No cloud calls** — all inference runs locally on the device
- **PHI never leaves the machine** — no analytics, no crash reporting with transcript content
- **SQLite database** in `~/.paperdoc/data.db` — all sessions stored locally
- **AI-generated disclaimer** — persistent banner: "AI-generated draft — requires clinician review"

## QVAC Hackathon — Submission

This project was built for [QVAC Hackathon I — Unleash Edge AI](https://dorahacks.io/hackathon/qvac-unleach-edge-ai-i/detail), demonstrating that a full medical scribe pipeline (ASR → diarization → LLM) can run entirely on consumer hardware with zero cloud dependencies.

**Track**: Local-first AI applications

**Verification**: All inference uses `@qvac/sdk` — full audit trail available at `/api/audit-log` showing model loads, inference throughput, and timing for every pipeline step.
