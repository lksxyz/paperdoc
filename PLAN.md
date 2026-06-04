# AI Medical Scribe — Project Plan

## Overview

AI-powered clinical note generator that transcribes doctor-patient conversations, generates structured SOAP notes with PII stripping, and integrates with a local FHIR-compliant HIS via P2P edge inference.

**Design Principles**

- Fully on-premise — no cloud dependency
- FHIR-compliant data model
- QVAC SDK + MedPsy 4B for local inference
- Two-tier inference: local on capable devices, P2P delegation to central server when phone is too weak

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      DOCTOR APP                         │
│  Web (React) + Expo (iOS/Android)                       │
│  ┌─────────┐  ┌──────────┐  ┌─────────────────────────┐ │
│  │Booking  │→ │ Patient  │→ │ Live ASR (Whisper/QVAC)│ │
│  │(FHIR    │  │ Context  │  └───────────┬─────────────┘ │
│  │Appoint- │  │ (FHIR)   │              │               │
│  │ment)    │  │          │  ┌───────────┴─────────────┐ │
│  └─────────┘  └──────────┘  │ QVAC Inference Engine │ │
│                             │  MedPsy 4B GGUF        │ │
│                             │  (or P2P delegation)   │ │
│                             └───────────┬─────────────┘ │
│                                         │               │
│                             ┌───────────┴─────────────┐ │
│                             │ Review Editor           │ │
│                             │ soap_note               │ │
│                             │ patient_summary         │ │
│                             │ clinical_deltas         │ │
│                             └───────────┬─────────────┘ │
└─────────────────────────────────────────┼───────────────┘
                                          │ save to FHIR
┌─────────────────────────────────────────┼───────────────┐
│                  LOCAL FHIR SERVER       │               │
│  ┌──────────────────────────────────────┴─────────────┐ │
│  │ Composition (SOAP note — accepted/corrected)       │ │
│  │ Composition (Patient note — PII-stripped)          │ │
│  │ DocumentReference (Transcript + Audio compressed) │ │
│  │ Observation (Clinical deltas)                      │ │
│  │ Patient / Condition / Medication (context)         │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

INFERENCE TIER
┌─────────────────┐     P2P      ┌─────────────────┐
│ Doctor device    │◄───────────►│ Central server  │
│ (capable)       │  delegated  │ (GPU-accelerated│
│ local inference │  inference  │ QVAC on-premise) │
└─────────────────┘             └─────────────────┘
```

---

## Tech Stack

| Layer                | Technology                                 |
| -------------------- | ------------------------------------------ |
| Frontend             | Web (React/Next.js) + Expo (iOS/Android)   |
| AI Inference engine  | QVAC SDK + MedPsy-4B GGUF                  |
| ASR                  | QVAC Whisper (live transcription)          |
| P2P delegation       | QVAC Holepunch stack                       |
| Audio compression    | FFmpeg + Opus codec                        |
| HIS / Data layer     | Local FHIR-compliant server                |
| Audio storage format | FFmpeg/Opus compressed → DocumentReference |
| Deployment           | Fully on-premise                           |

---

## Data Storage (FHIR Resources)

| Data            | FHIR Resource                       | Notes                                |
| --------------- | ----------------------------------- | ------------------------------------ |
| Booking list    | `Appointment`                       | Pulled from FHIR `Appointment`       |
| Patient info    | `Patient`                           | Age, gender, allergies               |
| Active problems | `Condition`                         | ICD-10 coded                         |
| Current meds    | `MedicationStatement`               | Name, dosage, frequency              |
| Vitals          | `Observation`                       | BP, heart rate                       |
| Audio           | `DocumentReference`                 | FFmpeg/Opus compressed binary        |
| Transcript      | `DocumentReference` / `Composition` | Raw + structured                     |
| SOAP note       | `Composition`                       | Doctor-accepted/corrected version    |
| Patient summary | `Composition`                       | PII-stripped, patient-facing version |
| Clinical deltas | `Observation` / custom              | Medication/problem changes           |

---

## User Flow

1. **Frontdesk** receives booking list from FHIR `Appointment`
2. **Doctor** receives booking list on app
3. **Patient arrives** → Doctor selects patient → Patient context loaded from FHIR
4. **Consultation** → Live ASR transcription via QVAC/Whisper
5. **Generation** → QVAC + MedPsy generates soap_note, patient_summary, clinical_deltas
6. **Review** → Doctor reviews/edits in single editor → saves independently to FHIR
7. **Storage** → All artifacts saved locally (audio compressed with FFmpeg/Opus, transcript linked)

---

## Output Format (Generated)

```json
{
    "soap_note": {
        "subjective": "Patient reports ...",
        "objective": "Blood pressure is elevated at ...",
        "assessment": "1. Essential Hypertension (ICD-10: I10) ...",
        "plan": "1. Restart Lisinopril 10mg daily ..."
    },
    "patient_summary": "Take your Lisinopril pill every morning ...",
    "clinical_deltas": {
        "medications": {
            "added": [],
            "discontinued": [],
            "updated": [{ "name": "Lisinopril", "action": "RESUMED_COMPLIANCE", "details": "..." }]
        },
        "problems": {
            "added": [],
            "resolved": []
        }
    }
}
```

---

## Input Format (Patient Context + Encounter)

```json
{
    "patient_context": {
        "age": 45,
        "gender": "male",
        "allergies": ["Penicillin"],
        "active_problems": [{ "name": "Essential Hypertension", "code": "I10" }],
        "current_medications": [
            { "name": "Lisinopril", "dosage": "10mg", "frequency": "once daily" }
        ]
    },
    "current_encounter": {
        "vitals": { "blood_pressure": "148/92 mmHg", "heart_rate": "78 bpm" },
        "transcript": "Dr. Evans: Good afternoon... [raw transcript] ..."
    }
}
```

---

## Features

- [x] Booking list from FHIR Appointment
- [x] Patient context loading from FHIR (Patient, Condition, MedicationStatement)
- [x] Live ASR transcription (QVAC/Whisper)
- [x] SOAP note generation (QVAC + MedPsy)
- [x] PII stripping in patient_summary
- [x] Doctor review + edit editor
- [x] Clinical deltas tracking (medications, problems)
- [x] Audio compression (FFmpeg + Opus)
- [x] FHIR storage (Composition, DocumentReference, Observation)
- [x] P2P inference delegation (QVAC Holepunch)
- [x] Prior encounter context (doctor reviews transcript, input, and output to improve)

---

## QVAC Integration

**Models:** MedPsy-4B-GGUF (QVAC collection on HuggingFace)

**SDK usage:**

- `loadModel()` — load MedPsy for inference
- `completion()` — generate SOAP + summary + deltas
- `textEmbeddings()` — semantic search over transcripts (for finding similar cases)
- `transcription()` — live ASR via Whisper backend
- P2P delegation via `qvac.config.*` for P2P settings

**System requirements (per doctor device):**

- macOS 14+ (Metal), iOS 17+ (Expo), Ubuntu 22+ (Vulkan), Android 12+ (Vulkan)
- Min 4GB RAM recommended

**Central server:**

- GPU-accelerated Vulkan/Metal for concurrent sessions

---

## Open Questions / TODOs

- [ ] FHIR server selection (HAPI FHIR, IBM FHIR, custom)
- [ ] User auth (FHIR SMART on FHIR? Or custom?)
- [ ] PII encryption at rest
- [ ] Model fine-tuning with domain-specific data (LoRA via QVAC)
- [ ] Audit trail for corrections (medico-legal)
- [ ] Medication dictionary (for structured delta output)
- [ ] ICD-10 code assist in assessment field

---

## Documentation

- QVAC SDK: https://docs.qvac.tether.io/
- MedPsy models: https://huggingface.co/collections/qvac/medpsy
- FHIR: https://hl7.org/fhir/
- QVAC Holepunch (P2P): https://holepunch.to
