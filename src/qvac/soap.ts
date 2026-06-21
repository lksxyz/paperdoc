import { loadModelByName, unloadModelByName, getQvacSdk } from "./init.js";
import { QWEN3_1_7B_INST_Q4 } from "@qvac/sdk";
import { addEvent } from "./audit.js";

export interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  raw: string;
  stats?: {
    tokensPerSecond?: number;
    timeToFirstToken?: number;
    generatedTokens?: number;
    promptTokens?: number;
    backendDevice?: string;
  };
}

const SOAP_MODEL_FILE = QWEN3_1_7B_INST_Q4;

const SOAP_MODEL_CONFIG = {
  ctx_size: 4096,
};

const SOAP_PROMPT = `You are a clinical scribe converting a doctor-patient conversation transcript into a SOAP note.

SPEAKER ATTRIBUTION:
- Don't trust speaker labels blindly — diarization can be wrong. Infer the true speaker from content: DOCTOR asks exam/history questions, states findings, orders tests, prescribes, gives diagnosis/referral. PATIENT reports symptoms in first person, answers questions, asks lay questions.
- Self-corrections ("I mean X, not Y") belong to the SAME speaker. Only attribute a correction to the other party if they explicitly object ("No, I think it's actually...").

UNCLEAR TEXT:
- Fix only obvious ASR mishearings of common clinical terms. If a word/phrase is garbled and meaning isn't obvious, write [unclear] — don't guess.
- Keep similar-sounding but distinct tests/terms separate (e.g., ECG vs. echocardiogram). List both if both are mentioned.

GROUNDING — STRICT:
- Use only what's explicitly stated. Never infer, estimate, or add anything not said — including vitals, severity, timing, or actions like "requested."
- Omit a vitals line entirely if not stated; never default to "normal."
- Lay language → clinical terms is fine only if the finding is preserved exactly (e.g., "jerky involuntary movements" → "chorea"). Don't invent a different finding.
- ASSESSMENT: only include a diagnosis the clinician actually stated, with their hedging preserved ("looks like...", not stated as confirmed).

SECTIONS:
- SUBJECTIVE: only the patient's own reported symptoms/history/answers.
- OBJECTIVE: only the clinician's direct exam findings/measurements. No tests ordered, meds, diet advice, or referrals here.
- PLAN: every distinct clinician action — each test, medication, lifestyle instruction, referral, follow-up — as its own bullet. Don't merge or drop items.
- If a section has nothing relevant, write exactly: Not discussed.

OUTPUT:
- Output only the four SOAP sections, bullets for multiple items. No extra notes, disclaimers, or commentary.

Example:
Transcript:
"What's going on today?" "I've had a sore throat for like three days, and it hurts to swallow." "Any fever?" "No, I checked, it's normal." "Let me look — your tonsils are pretty red and swollen, no white patches though." "Okay so what is it?" "Looks viral, not strep. Drink fluids, rest your voice, and use lozenges. Come back if it's not better in a week or you get a fever."

SOAP:
SUBJECTIVE: Patient reports sore throat for three days with pain on swallowing. Denies fever; reports checking temperature, which was normal.
OBJECTIVE: Tonsils erythematous and swollen on exam. No white patches/exudate noted.
ASSESSMENT: Clinician suspects viral pharyngitis; states strep is less likely based on exam.
PLAN:
- Supportive care: fluids, voice rest, throat lozenges.
- Follow up in one week if no improvement, or sooner if fever develops.

Now convert this transcript:

Transcript:
{TRANSCRIPT}

SOAP:`;

export async function generateSoap(transcript: string): Promise<SoapNote> {
  const sdk = await getQvacSdk();
  const modelId = await loadModelByName(
    "llm",
    SOAP_MODEL_FILE,
    SOAP_MODEL_CONFIG,
    "llamacpp-completion",
  );

  const prompt = SOAP_PROMPT.replace("{TRANSCRIPT}", transcript);
  console.log(`  [SOAP] Prompt: ${prompt.length} chars`);

  addEvent({
    event: "inference",
    model_name: "llm",
    model_type: QWEN3_1_7B_INST_Q4,
    inference_type: "completion",
    status: "start",
    input_size: prompt.length,
  });
  const start = Date.now();

  let fullText: string;
  let stats: SoapNote["stats"] = undefined;
  try {
    const result: any = sdk.completion({
      modelId,
      history: [{ role: "user", content: prompt }],
      stream: false,
    });

    fullText = await result.text;

    if (result && typeof result === "object" && "final" in result) {
      const final = await result.final;
      if (final && final.stats) {
        stats = {
          tokensPerSecond: final.stats.tokensPerSecond,
          timeToFirstToken: final.stats.timeToFirstToken,
          generatedTokens: final.stats.generatedTokens,
          promptTokens: final.stats.promptTokens,
          backendDevice: final.stats.backendDevice,
        };
        console.log(
          `  [SOAP] Stats: ${stats.tokensPerSecond?.toFixed(1)} tok/s, ${stats.generatedTokens} tokens, ${stats.backendDevice}`,
        );
      }
    }
  } catch (err) {
    addEvent({
      event: "inference",
      model_name: "llm",
      model_type: QWEN3_1_7B_INST_Q4,
      inference_type: "completion",
      status: "error",
      duration_ms: Date.now() - start,
      input_size: prompt.length,
      error: String(err),
    });
    await unloadModelByName("llm");
    throw err;
  }

  const duration = Date.now() - start;
  addEvent({
    event: "inference",
    model_name: "llm",
    model_type: QWEN3_1_7B_INST_Q4,
    inference_type: "completion",
    status: "success",
    duration_ms: duration,
    input_size: prompt.length,
    tokens_generated: stats?.generatedTokens ?? fullText.length,
    ttft_ms: stats?.timeToFirstToken,
    tokens_per_sec: stats?.tokensPerSecond,
  });

  console.log(`  ✓ SOAP: ${fullText.length} chars`);

  await unloadModelByName("llm");
  const note = parseSoap(fullText);
  note.stats = stats;
  return note;
}

export type SoapStreamEvent =
  | {
      type: "token";
      token: string;
      text: string;
      tokenCount: number;
      tokensPerSecond: number;
      elapsedMs: number;
    }
  | { type: "ttft"; timeToFirstToken: number }
  | {
      type: "done";
      soap: SoapNote;
      tokenCount: number;
      tokensPerSecond: number;
      elapsedMs: number;
      timeToFirstToken: number;
      backendDevice?: string;
    }
  | { type: "error"; message: string };

export async function* generateSoapStream(
  transcript: string,
): AsyncGenerator<SoapStreamEvent> {
  const sdk = await getQvacSdk();
  const modelId = await loadModelByName(
    "llm",
    SOAP_MODEL_FILE,
    SOAP_MODEL_CONFIG,
    "llamacpp-completion",
  );

  const prompt = SOAP_PROMPT.replace("{TRANSCRIPT}", transcript);
  console.log(`  [SOAP stream] Prompt: ${prompt.length} chars`);

  addEvent({
    event: "inference",
    model_name: "llm",
    model_type: QWEN3_1_7B_INST_Q4,
    inference_type: "completion",
    status: "start",
    input_size: prompt.length,
  });
  const startTime = Date.now();
  let tokenCount = 0;
  let fullText = "";
  let timeToFirstTokenMs: number | null = null;

  const result: any = sdk.completion({
    modelId,
    history: [{ role: "user", content: prompt }],
    stream: true,
  });

  try {
    for await (const token of result.tokenStream) {
      const tokenStr = String(token);
      if (timeToFirstTokenMs === null) {
        timeToFirstTokenMs = Date.now() - startTime;
        yield { type: "ttft", timeToFirstToken: timeToFirstTokenMs };
      }
      fullText += tokenStr;
      tokenCount++;
      const elapsedMs = Date.now() - startTime;
      const tokensPerSecond =
        elapsedMs > 0 ? (tokenCount * 1000) / elapsedMs : 0;
      yield {
        type: "token",
        token: tokenStr,
        text: fullText,
        tokenCount,
        tokensPerSecond,
        elapsedMs,
      };
    }
  } catch (err) {
    addEvent({
      event: "inference",
      model_name: "llm",
      model_type: QWEN3_1_7B_INST_Q4,
      inference_type: "completion",
      status: "error",
      duration_ms: Date.now() - startTime,
      input_size: prompt.length,
      error: String(err),
    });
    await unloadModelByName("llm").catch(() => {});
    yield { type: "error", message: String(err) };
    return;
  }

  let finalStats: any = {};
  if (result && typeof result === "object" && "final" in result) {
    const final = await result.final;
    if (final && final.stats) {
      finalStats = {
        tokensPerSecond: final.stats.tokensPerSecond,
        timeToFirstToken: final.stats.timeToFirstToken,
        generatedTokens: final.stats.generatedTokens,
        promptTokens: final.stats.promptTokens,
        backendDevice: final.stats.backendDevice,
      };
    }
  }

  const inferenceDuration = Date.now() - startTime;
  const finalTtft =
    finalStats.timeToFirstToken ?? timeToFirstTokenMs ?? undefined;
  const finalTokPerSec =
    finalStats.tokensPerSecond ??
    (inferenceDuration > 0 ? (tokenCount * 1000) / inferenceDuration : 0);
  addEvent({
    event: "inference",
    model_name: "llm",
    model_type: QWEN3_1_7B_INST_Q4,
    inference_type: "completion",
    status: "success",
    duration_ms: inferenceDuration,
    input_size: prompt.length,
    tokens_generated: finalStats.generatedTokens ?? tokenCount,
    ttft_ms: finalTtft,
    tokens_per_sec: finalTokPerSec,
  });

  await unloadModelByName("llm");

  const note = parseSoap(fullText);
  note.raw = fullText;
  note.stats = {
    tokensPerSecond: finalStats.tokensPerSecond,
    timeToFirstToken: finalTtft,
    generatedTokens: finalStats.generatedTokens ?? tokenCount,
    promptTokens: finalStats.promptTokens,
    backendDevice: finalStats.backendDevice,
  };

  const elapsedMs = Date.now() - startTime;
  yield {
    type: "done",
    soap: note,
    tokenCount,
    tokensPerSecond: finalTokPerSec,
    elapsedMs,
    timeToFirstToken: finalTtft ?? 0,
    backendDevice: note.stats.backendDevice,
  };

  console.log(
    `  ✓ SOAP stream: ${tokenCount} tokens in ${(elapsedMs / 1000).toFixed(1)}s`,
  );
}

function parseSoap(raw: string): SoapNote {
  const sections: SoapNote = {
    subjective: "Not discussed.",
    objective: "Not discussed.",
    assessment: "Not discussed.",
    plan: "Not discussed.",
    raw,
  };

  if (!raw) return sections;

  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  const patterns = [
    {
      key: "subjective" as const,
      regex: /SUBJECTIVE:\s*([\s\S]*?)(?=OBJECTIVE:|ASSESSMENT:|PLAN:|$)/i,
    },
    {
      key: "objective" as const,
      regex: /OBJECTIVE:\s*([\s\S]*?)(?=ASSESSMENT:|PLAN:|SUBJECTIVE:|$)/i,
    },
    {
      key: "assessment" as const,
      regex: /ASSESSMENT:\s*([\s\S]*?)(?=PLAN:|SUBJECTIVE:|OBJECTIVE:|$)/i,
    },
    {
      key: "plan" as const,
      regex: /PLAN:\s*([\s\S]*?)(?=SUBJECTIVE:|OBJECTIVE:|ASSESSMENT:|$)/i,
    },
  ];

  for (const { key, regex } of patterns) {
    const match = cleaned.match(regex);
    if (match) {
      const text = match[1].trim();
      if (text) sections[key] = text;
    }
  }

  return sections;
}
