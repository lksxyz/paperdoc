import { type ServerWebSocket } from "bun";
import { transcribeLive } from "../qvac/transcribe.js";
import { saveTranscript } from "./db.js";

interface WsData {
  type: "transcription";
  sessionId?: number;
  buffer: Buffer[];
  isRecording: boolean;
}

// Track active WebSocket connections
const activeConnections = new Map<ServerWebSocket<WsData>, WsData>();

export function setupWs(ws: ServerWebSocket<WsData>) {
  const data: WsData = {
    type: "transcription",
    buffer: [],
    isRecording: false,
  };
  activeConnections.set(ws, data);
  ws.send(JSON.stringify({ type: "ready" }));
}

export async function handleWsMessage(ws: ServerWebSocket<WsData>, message: string | Buffer) {
  const data = activeConnections.get(ws);
  if (!data) return;

  if (typeof message === "string") {
    try {
      const parsed = JSON.parse(message);

      if (parsed.type === "start") {
        data.isRecording = true;
        data.buffer = [];
        ws.send(JSON.stringify({ type: "started" }));
      } else if (parsed.type === "stop") {
        data.isRecording = false;
        ws.send(JSON.stringify({ type: "stopped" }));

        // Process accumulated audio for live transcription
        if (data.buffer.length > 0) {
          const audioBuffer = Buffer.concat(data.buffer);
          try {
            const text = await transcribeLive(audioBuffer, (chunk) => {
              ws.send(JSON.stringify({ type: "transcript", text: chunk }));
            });
            ws.send(JSON.stringify({ type: "transcript_final", text }));
          } catch (err) {
            ws.send(JSON.stringify({ type: "error", message: String(err) }));
          }
        }
      }
    } catch {
      // ignore non-JSON
    }
  } else if (Buffer.isBuffer(message) && data.isRecording) {
    data.buffer.push(message);
  }
}

export function cleanupWs(ws: ServerWebSocket<WsData>) {
  activeConnections.delete(ws);
}
