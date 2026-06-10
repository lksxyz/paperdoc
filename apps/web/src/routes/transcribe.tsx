import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/transcribe")({
  component: TranscribePage,
});

function TranscribePage() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState<string>("");
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    setText("");
    setDurationMs(null);

    const form = new FormData();
    form.append("audio", file);

    try {
      const res = await fetch(`${import.meta.env.VITE_SERVER_URL}/transcribe`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        durationMs?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setText(data.text ?? "");
      setDurationMs(data.durationMs ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">Transcribe audio</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Upload a short clip and the server will transcribe it with NVIDIA Parakeet TDT (~750MB
        model, first run downloads the GGUF).
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <input
          type="file"
          accept="audio/*"
          disabled={loading}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError("");
            setText("");
          }}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-primary-foreground hover:file:bg-primary/90"
        />
        <button
          type="submit"
          disabled={!file || loading}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Transcribing…" : "Transcribe"}
        </button>
      </form>

      {error && (
        <div className="mt-6 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {text && (
        <div className="mt-6 space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Result</h2>
            {durationMs !== null && (
              <span className="text-xs text-muted-foreground">{durationMs} ms</span>
            )}
          </div>
          <p className="whitespace-pre-wrap rounded-md border bg-card p-4 text-sm leading-relaxed">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}
