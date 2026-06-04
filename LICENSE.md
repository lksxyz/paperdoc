# AI Medical Scribe — Open Source License

> _Modeled after [Orthanc](https://www.orthanc-server.com/) — a free, open-source DICOM server for healthcare._
>
> Orthanc is published under the **GNU General Public License version 3 (GPLv3)**.
> This project follows the same philosophy: free, open, and built for the benefit of healthcare workers worldwide.

---

## License

Copyright (C) 2025 — AI Medical Scribe Contributors

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License version 3** as published by the Free Software Foundation.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

---

## Third-Party Components & Their Licenses

This project uses the following open-source components. Each retains its original license.

### Core AI / Inference

| Component | License | Notes |
|-----------|---------|-------|
| [QVAC SDK](https://qvac.tether.io/) | Tether's license | Local inference engine for AI tasks |
| [MedPsy models](https://huggingface.co/collections/qvac/medpsy) | Apache 2.0 or model-specific | Medical/psychology LLM GGUF models |
| [QVAC Fabric LLM](https://github.com/tetherto/qvac-fabric-llm.cpp) | Tether's license | Text generation backend |
| [Whisper (QVAC)](https://github.com/tetherto/) | Tether's license | ASR / transcription backend |
| [GGML](https://github.com/ggerganov/ggml) | MIT | Tensor computation backend |
| [llama.cpp](https://github.com/ggerganov/llama.cpp) | MIT | LLM inference engine |

### Data / Storage

| Component | License | Notes |
|-----------|---------|-------|
| [FHIR](https://hl7.org/fhir/) | Creative Commons Zero (CC0) | FHIR resources and specifications |
| [HAPI FHIR](https://hapifhir.io/) | Apache 2.0 | Open-source FHIR server (if used) |
| [Microsoft FHIR Server](https://github.com/microsoft/fhir-server) | MIT | Alternative FHIR server |
| [Orthanc](https://www.orthanc-server.com/) | GPLv3 | PACS integration reference |

### Audio Processing

| Component | License | Notes |
|-----------|---------|-------|
| [FFmpeg](https://ffmpeg.org/) | LGPLv2.1 / GPLv2 | Audio/video compression |
| [Opus Codec](https://opus-codec.org/) | BSD-style | Audio compression for storage |

### Frontend / App

| Component | License | Notes |
|-----------|---------|-------|
| [React](https://react.dev/) | MIT | UI framework |
| [Next.js](https://nextjs.org/) | MIT | Web framework |
| [Expo](https://expo.dev/) | MIT | Mobile framework |
| [shadcn/ui](https://ui.shadcn.com/) | MIT | UI component library |

### Infrastructure / P2P

| Component | License | Notes |
|-----------|---------|-------|
| [Holepunch](https://holepunch.to/) | Unknown / check with Tether | P2P delegation stack |
| [Bare](https://bare.pears.com/) | MIT | JavaScript runtime (QVAC dependency) |

---

## Contribution Policy

Contributions are welcome. By submitting a pull request, you agree that your contribution will be licensed under the same GPLv3 license as this project.

### Contribution Guidelines

1. **Code style** — Match the existing project conventions
2. **Testing** — All new features must include tests
3. **Documentation** — Update relevant docs when changing behavior
4. **No breaking changes to medical workflows** — Without prior discussion
5. **HIPAA equivalent compliance** — Contributions must not weaken data privacy defaults

---

## Medical Disclaimer

This software is intended as a **clinical decision support tool** and is **not a medical device** as defined by applicable regulatory frameworks (e.g., FDA, EU MDR).

- It does not provide diagnostic advice
- It does not replace clinical judgment
- All generated notes require review and sign-off by a licensed physician
- The authors and contributors accept no liability for clinical outcomes arising from the use of this software

> ⚠️ **Deployers are solely responsible for ensuring compliance with applicable healthcare regulations in their jurisdiction, including but not limited to HIPAA (US), GDPR (EU), PDPA (Thailand), or equivalent laws.**

---

## Export Control

This project is subject to applicable export control laws. Users are responsible for compliance.

---

## Trademark

"AI Medical Scribe" is an open-source project. The name may not be used for commercial products without prior written permission from the contributors.

---

## Questions?

Open an issue at the project repository or contact the maintainers.
