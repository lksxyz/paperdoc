import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { PAPERDOC_DB_PATH, PAPERDOC_DATA_DIR } from "../config.js";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    if (!existsSync(PAPERDOC_DATA_DIR)) {
      mkdirSync(PAPERDOC_DATA_DIR, { recursive: true });
    }
    db = new Database(PAPERDOC_DB_PATH);
    db.run("PRAGMA journal_mode = WAL;");
    initSchema();
  }
  return db;
}

function initSchema() {
  const database = db!;
  database.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      title TEXT,
      status TEXT DEFAULT 'recording'
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      speaker TEXT,
      text TEXT NOT NULL,
      start_ms INTEGER,
      end_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS soap_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL UNIQUE,
      subjective TEXT,
      objective TEXT,
      assessment TEXT,
      plan TEXT,
      raw TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(session_id);
  `);
}

export function createSession(title?: string): number {
  const database = getDb();
  const result = database.run("INSERT INTO sessions (title, status) VALUES (?, ?)", [
    title || "Untitled Session",
    "recording",
  ]);
  return Number(result.lastInsertRowid);
}

export function updateSessionStatus(id: number, status: string) {
  const database = getDb();
  database.run("UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, id]);
}

export function saveTranscript(sessionId: number, speaker: string, text: string, startMs?: number, endMs?: number) {
  const database = getDb();
  database.run(
    "INSERT INTO transcripts (session_id, speaker, text, start_ms, end_ms) VALUES (?, ?, ?, ?, ?)",
    [sessionId, speaker, text, startMs ?? null, endMs ?? null]
  );
}

export function saveSoapNote(
  sessionId: number,
  note: { subjective: string; objective: string; assessment: string; plan: string; raw: string }
) {
  const database = getDb();
  database.run(
    `INSERT INTO soap_notes (session_id, subjective, objective, assessment, plan, raw)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       subjective = excluded.subjective,
       objective = excluded.objective,
       assessment = excluded.assessment,
       plan = excluded.plan,
       raw = excluded.raw,
       updated_at = CURRENT_TIMESTAMP`,
    [sessionId, note.subjective, note.objective, note.assessment, note.plan, note.raw]
  );
}

export function getSession(sessionId: number) {
  const database = getDb();
  const session = database.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;
  const transcripts = database.query("SELECT * FROM transcripts WHERE session_id = ? ORDER BY id").all(sessionId) as any[];
  const soap = database.query("SELECT * FROM soap_notes WHERE session_id = ?").get(sessionId) as any;
  return { session, transcripts, soap };
}

export function getSessions() {
  const database = getDb();
  return database.query("SELECT * FROM sessions ORDER BY created_at DESC").all() as any[];
}

export function deleteSession(sessionId: number) {
  const database = getDb();
  database.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
}

export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch { /* ignore */ }
    db = null;
  }
}
