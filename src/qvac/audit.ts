type ModelTypeInput = string | Record<string, unknown>;

export interface AuditEvent {
  timestamp: string;
  event: "model_load" | "model_unload" | "inference";
  model_name: string;
  model_type: string;
  status: "start" | "success" | "error";
  duration_ms?: number;
  inference_type?: string;
  input_size?: number;
  tokens_generated?: number;
  ttft_ms?: number;
  tokens_per_sec?: number;
  error?: string;
}

function resolveModelType(mt: ModelTypeInput): string {
  if (typeof mt === "string") return mt;
  if (mt && typeof mt === "object" && "name" in mt) {
    return String((mt as any).name);
  }
  return "descriptor";
}

const events: AuditEvent[] = [];

export function addEvent(e: Omit<AuditEvent, "model_type" | "timestamp"> & { model_type: ModelTypeInput }) {
  events.push({
    ...e,
    model_type: resolveModelType(e.model_type),
    timestamp: new Date().toISOString(),
  });
}

export function getLog(): AuditEvent[] {
  return [...events];
}

export function clearLog() {
  events.length = 0;
}

export function dumpJSON(): string {
  return JSON.stringify(events, null, 2);
}
