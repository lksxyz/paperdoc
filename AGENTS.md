# Paperdoc — Medical Scribe AI

## Project Overview

Paperdoc is a local-first Medical Scribe AI that runs entirely on the doctor's machine. It records doctor-patient conversations, transcribes them with speaker diarization, and generates structured SOAP notes — all offline, no cloud calls, no PHI leaves the device.

## Tech Stack

- **Runtime**: Bun (bundled inside AppImage)
- **Package Manager**: pnpm (development)
- **AI SDK**: QVAC (`@qvac/sdk`) — local-first AI by Tether
- **Web Server**: Hono
- **Database**: SQLite (better-sqlite3)
- **Distribution**: AppImage for Linux

## Pipeline

1. **Record**: Browser captures audio via MediaRecorder → streams chunks to server via WebSocket
2. **Live Display**: Server runs Whisper Tiny `transcribeStream()` → real-time transcript shown in browser (undifferentiated, confirmation only)
3. **Stop & Process**: Full audio file → Parakeet TDT + Sortformer batch diarization → produces speaker-labeled transcript ("Doctor: ... / Patient: ...")
4. **SOAP Generation**: Diarized transcript → Qwen3-4B with structured prompt → editable SUBJECTIVE / OBJECTIVE / ASSESSMENT / PLAN sections
5. **Export**: Doctor reviews, edits, downloads as `.txt`

## Model Mapping

| Purpose | QVAC Constant | Cached File |
|---------|---------------|-------------|
| Live ASR | `WHISPER_TINY` | `574dfe543bfdae68_ggml-tiny.bin` (~78MB) |
| Batch Transcription | `PARAKEET_TDT` | `cefd830cf8c3dc92_parakeet-tdt-0.6b-v3.q8_0.gguf` (~750MB) |
| Speaker Diarization | `SORTFORMER_4SPK` | `8ac9c06324638ada_diar_streaming_sortformer_4spk-v2.1.q8_0.gguf` (~140MB) |
| SOAP Generation | `QWEN3_1_7B_INST_Q4` | `<hash>_Qwen3-1.7B-Inst-Q4.gguf` (~1.1GB, hash set on first download) |

## CLI Commands

```bash
./Paperdoc-x86_64.AppImage run              # Start server (auto-setup on first run)
./Paperdoc-x86_64.AppImage download-model   # Force re-download all models
```

## Configuration

- **Port**: `7321` (configurable via `~/.paperdoc/config.yml`)
- **Model directory**: Auto-detects `~/.qvac/models/`, symlinks into `~/.paperdoc/models/`
- **Database**: `~/.paperdoc/data.db`
- **Language**: English only

## Important Constraints

- **No cloud calls** — everything runs locally
- **PHI never leaves the device** — no analytics, no crash reporting with transcript contents
- **AI-generated disclaimer** — persistent banner: "AI-generated draft — requires clinician review"
- **FFmpeg** is a system dependency; AppImage checks and prompts to install if missing

## QVAC Reference

- Docs: `docs/qvac-llms.txt` (index) and `docs/qvac-llms-full.txt` (full dump)
- SDK version: v0.13.3
- Requires: Node.js >= v22.17, Vulkan runtime on Linux

## Architecture Notes

- QVAC SDK spawns a Bare worker process dynamically; cannot be bundled into a single compiled binary
- AppImage bundles Bun runtime + JS code + assets; models are external (too large)
- On first run, server starts immediately and browser shows `/setup` with live download progress
