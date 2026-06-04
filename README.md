# AI Medical Scribe

Open-source clinical note generator. Transcribes doctor-patient conversations, generates structured SOAP notes with PII stripping, and saves to a local FHIR-compliant HIS.

GPLv3. Fully on-premise. No cloud dependency.

## Features

- Live ASR transcription via local inference
- SOAP note + patient summary + clinical deltas generation
- Doctor review and edit before saving
- PII stripping for patient-facing notes
- Audio compression and storage
- P2P inference delegation for low-spec devices
- FHIR-compliant data storage

## Tech Stack

| Layer | Technology |
|-------|------------|
| App | React (web) + Expo (mobile) |
| AI Inference | QVAC SDK + MedPsy 4B |
| Transcription | QVAC Whisper |
| Audio | FFmpeg + Opus |
| Data | Local FHIR server |
| License | GPLv3 |

## Architecture

```
Doctor App → Patient Context (FHIR) → Live ASR → QVAC/MedPsy → SOAP Note
                                                       ↓
                                       Doctor Reviews → FHIR Storage
                                       Audio (compressed) + Transcript + Note
```

## Data Flow

1. Doctor selects patient → context loaded from FHIR
2. Consultation → live ASR transcription
3. AI generates SOAP + summary + clinical deltas
4. Doctor reviews, edits, approves
5. All saved locally (audio, transcript, note)

## Requirements

- QVAC SDK compatible device (macOS 14+, Ubuntu 22+, Android 12+, iOS 17+)
- 4GB+ RAM recommended
- FHIR server (local, on-premise)

## License

GPLv3. See [LICENSE.md](./LICENSE.md).

## Documentation

- [PLAN.md](./PLAN.md) — full project specification
- [QVAC Docs](https://docs.qvac.tether.io/)
- [MedPsy Models](https://huggingface.co/collections/qvac/medpsy)
- [FHIR Standard](https://hl7.org/fhir/)
