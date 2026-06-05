import { Effect } from "effect";

export interface TranscriptionResult {
  readonly text: string;
}

export interface TranscriptionError {
  readonly message: string;
}

export const TranscriptionService = Effect.gen(function* () {
  yield* Effect.log("Transcription service initialized");
});
