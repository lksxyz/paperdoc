import { loadModelByName, unloadModelByName, getQvacSdk } from "./init.js";

import { QWEN3_1_7B_INST_Q4 } from "@qvac/sdk";

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

Rules:
- The transcript has no speaker labels. Use context (questions vs. answers, lay language vs. clinical language, who would plausibly report a symptom vs. state a finding) to determine who said what.
- Use ONLY information explicitly stated in the transcript. Never infer, assume, or add anything not present — this applies especially to ASSESSMENT: only state a diagnosis if the clinician actually said it, even if symptoms strongly suggest one.
- If a section has no relevant information, write exactly: Not discussed.
- You may lightly rephrase patient language into standard clinical phrasing in SUBJECTIVE, but do not add severity, duration, or causation the patient didn't state.
- Do not repeat these instructions, add commentary, or include anything other than the SOAP note itself.

Example:
Transcript:
"What's going on today?" "I've had a sore throat for like three days, and it hurts to swallow." "Any fever?" "No, I checked, it's normal." "Let me look — your tonsils are pretty red and swollen, no white patches though." "Okay so what is it?" "Looks viral, not strep. Drink fluids, rest your voice, and use lozenges. Come back if it's not better in a week or you get a fever."

SOAP:
SUBJECTIVE: Patient reports sore throat for three days with pain on swallowing. Denies fever; reports checking temperature, which was normal.
OBJECTIVE: Tonsils erythematous and swollen on exam. No white patches/exudate noted.
ASSESSMENT: Likely viral pharyngitis; strep less likely based on exam.
PLAN: Supportive care — fluids, voice rest, throat lozenges. Follow up if no improvement in one week or if fever develops.

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

  const result: any = sdk.completion({
    modelId,
    history: [{ role: "user", content: prompt }],
    stream: false,
  });

  const fullText: string = await result.text;

  let stats: SoapNote["stats"] = undefined;
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

  await unloadModelByName("llm");

  const note = parseSoap(fullText);
  note.raw = fullText;
  note.stats = {
    tokensPerSecond: finalStats.tokensPerSecond,
    timeToFirstToken:
      finalStats.timeToFirstToken ?? timeToFirstTokenMs ?? undefined,
    generatedTokens: finalStats.generatedTokens ?? tokenCount,
    promptTokens: finalStats.promptTokens,
    backendDevice: finalStats.backendDevice,
  };

  const elapsedMs = Date.now() - startTime;
  yield {
    type: "done",
    soap: note,
    tokenCount,
    tokensPerSecond:
      note.stats.tokensPerSecond ??
      (elapsedMs > 0 ? (tokenCount * 1000) / elapsedMs : 0),
    elapsedMs,
    timeToFirstToken: note.stats.timeToFirstToken ?? 0,
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
