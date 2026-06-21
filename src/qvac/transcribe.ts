import { loadModelByName, unloadModelByName, getQvacSdk } from "./init.js";

export interface DiarizedSegment {
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptionResult {
  raw: string;
  diarized: DiarizedSegment[];
  formatted: string;
}

export async function transcribeLive(
  audioBuffer: Buffer,
  onChunk?: (text: string) => void
): Promise<string> {
  const sdk = await getQvacSdk();
  const modelId = await loadModelByName("asr_live", "WHISPER_TINY", {
    language: "en",
    no_timestamps: true,
    suppress_blank: true,
    suppress_nst: true,
    temperature: 0.0,
  });

  const session = await sdk.transcribeStream({ modelId });

  session.write(audioBuffer);
  session.end();

  let fullText = "";
  for await (const text of session) {
    fullText += text;
    if (onChunk) onChunk(text);
  }

  await unloadModelByName("asr_live");
  return fullText.trim();
}

export async function transcribeBatch(audioPath: string): Promise<string> {
  const sdk = await getQvacSdk();

  console.log(`  ▸ Transcribing with Parakeet TDT...`);
  const modelId = await loadModelByName(
    "asr_batch",
    "parakeet-tdt-0.6b-v3.q8_0.gguf",
    {},
    "parakeet-transcription"
  );

  const result = await sdk.transcribe({
    modelId,
    audioChunk: audioPath,
  });

  let text = "";
  if (typeof result === "string") {
    text = result;
  } else if (result && typeof result === "object") {
    if ("text" in result && typeof (result as any).text === "string") {
      text = (result as any).text;
    } else if ("tokenStream" in result) {
      for await (const token of (result as any).tokenStream) {
        text += String(token);
      }
    }
  }

  console.log(`  ✓ Transcribed ${text.length} characters`);

  await unloadModelByName("asr_batch");
  return text.trim();
}

function parseSortformerString(output: string): DiarizedSegment[] {
  const segments: DiarizedSegment[] = [];
  const lines = output.split('\n').filter(l => l.trim());

  for (const line of lines) {
    const match = line.match(/Speaker\s+(\d+):\s*(\d+):(\d+):(\d+)\.(\d+)\s*-\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (match) {
      const speaker = `Speaker ${match[1]}`;
      const h1 = parseInt(match[2]), m1 = parseInt(match[3]), s1 = parseInt(match[4]), ms1 = parseInt(match[5]);
      const h2 = parseInt(match[6]), m2 = parseInt(match[7]), s2 = parseInt(match[8]), ms2 = parseInt(match[9]);
      const startMs = h1 * 3600000 + m1 * 60000 + s1 * 1000 + ms1 * 10;
      const endMs = h2 * 3600000 + m2 * 60000 + s2 * 1000 + ms2 * 10;
      const realStart = Math.min(startMs, endMs);
      const realEnd = Math.max(startMs, endMs);
      segments.push({ speaker, text: "", startMs: realStart, endMs: realEnd });
    }
  }

  segments.sort((a, b) => a.startMs - b.startMs);
  return segments;
}

export function splitTranscriptBySegments(transcript: string, segments: DiarizedSegment[]): DiarizedSegment[] {
  if (segments.length === 0 || !transcript) return segments;

  const sentences = transcript
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim());

  if (sentences.length === 0) return segments;

  const totalDuration = segments[segments.length - 1].endMs;
  const timePerSentence = Math.max(totalDuration / sentences.length, 1);

  const segmentTexts: string[][] = segments.map(() => []);

  for (let i = 0; i < sentences.length; i++) {
    const expectedMs = i * timePerSentence + timePerSentence / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < segments.length; j++) {
      const segMid = (segments[j].startMs + segments[j].endMs) / 2;
      const dist = Math.abs(segMid - expectedMs);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = j;
      }
    }
    segmentTexts[bestIdx].push(sentences[i]);
  }

  return segments.map((seg, i) => ({
    ...seg,
    text: segmentTexts[i].join(' ').trim(),
  }));
}

export async function runSortformer(audioPath: string): Promise<DiarizedSegment[]> {
  const sdk = await getQvacSdk();

  console.log(`  ▸ Running Sortformer diarization...`);
  const modelId = await loadModelByName(
    "diarization",
    "diar_streaming_sortformer_4spk-v2.1.q8_0.gguf",
    {},
    "parakeet-transcription"
  );

  const result = await sdk.transcribe({
    modelId,
    audioChunk: audioPath,
  });

  let outputStr = "";
  if (typeof result === "string") {
    outputStr = result;
  } else if (result && typeof result === "object") {
    if ("text" in result) outputStr = String((result as any).text);
    else if ("tokenStream" in result) {
      for await (const token of (result as any).tokenStream) {
        outputStr += String(token);
      }
    }
  }

  const segments = parseSortformerString(outputStr);
  console.log(`  ✓ Detected ${segments.length} speaker segments`);

  await unloadModelByName("diarization");
  return segments;
}

export async function runSortformerWithText(audioPath: string, transcript: string): Promise<DiarizedSegment[]> {
  const rawSegments = await runSortformer(audioPath);
  return splitTranscriptBySegments(transcript, rawSegments);
}

export async function transcribeWithDiarization(audioPath: string): Promise<TranscriptionResult> {
  const text = await transcribeBatch(audioPath);
  const rawSegments = await runSortformer(audioPath);
  const segments = splitTranscriptBySegments(text, rawSegments);

  const speakerMap = new Map<string, string>();
  let speakerIdx = 0;
  for (const seg of segments) {
    if (!speakerMap.has(seg.speaker)) {
      speakerMap.set(seg.speaker, speakerIdx === 0 ? "Doctor" : "Patient");
      speakerIdx++;
    }
  }

  let formatted = "";
  if (segments.length > 0) {
    formatted = segments
      .map(s => `${speakerMap.get(s.speaker) || s.speaker}: ${s.text}`)
      .filter(l => l.split(': ')[1])
      .join("\n");
    if (!formatted) formatted = text;
  } else {
    formatted = `Speaker: ${text}`;
  }

  return {
    raw: text,
    diarized: segments,
    formatted,
  };
}
