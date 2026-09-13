import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { canTransition, nextRetryDelayMs, type LocalStatus } from "../domain/jobState.js";

export interface LocalJob {
  jobId: string;
  payloadType: "pdf" | "raw";
  payloadBase64: string;
  printerId: string;
  copies: number;
  status: LocalStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
}

interface LocalRow {
  job_id: string;
  payload_type: "pdf" | "raw";
  payload_base64: string;
  printer_id: string;
  copies: number;
  status: LocalStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
}

function toLocal(r: LocalRow): LocalJob {
  return {
    jobId: r.job_id,
    payloadType: r.payload_type,
    payloadBase64: r.payload_base64,
    printerId: r.printer_id,
    copies: r.copies,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    nextAttemptAt: r.next_attempt_at,
  };
}
/** Fila local persistente — mesmo padrão CAS do backend (claim + transition atômicos). */
export class LocalQueue {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new Database(path.resolve(dbPath));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_jobs (
        job_id TEXT PRIMARY KEY,
        payload_type TEXT NOT NULL CHECK (payload_type IN ('pdf','raw')),
        payload_base64 TEXT NOT NULL,
        printer_id TEXT NOT NULL,
        copies INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_status ON local_jobs(status, next_attempt_at);
    `);
  }

  /** Dedupe por jobId — reconnect WS + poll concorrente nunca duplica. */
  upsert(job: Omit<LocalJob, "status" | "attempts" | "lastError" | "nextAttemptAt">): boolean {
    const now = new Date().toISOString();
    const r = this.db
      .prepare(
        `INSERT INTO local_jobs (job_id, payload_type, payload_base64, printer_id, copies, status, attempts, next_attempt_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT(job_id) DO NOTHING`,
      )
      .run(job.jobId, job.payloadType, job.payloadBase64, job.printerId, job.copies, now, now);
    return r.changes > 0;
  }

  nextDue(limit = 5): LocalJob[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(`SELECT * FROM local_jobs WHERE status IN ('pending','failed') AND next_attempt_at <= ? ORDER BY updated_at ASC LIMIT ?`)
      .all(now, limit) as LocalRow[];
    return rows.map(toLocal);
  }

  transition(jobId: string, to: LocalStatus, lastError?: string | null): LocalJob | null {
    const raw = this.db.prepare(`SELECT * FROM local_jobs WHERE job_id = ?`).get(jobId) as LocalRow | undefined;
    if (!raw) return null;
    const cur = toLocal(raw);
    if (!canTransition(cur.status, to)) return null;
    const now = new Date().toISOString();
    const attempts = to === "failed" ? cur.attempts + 1 : cur.attempts;
    const next = to === "failed"
      ? new Date(Date.now() + nextRetryDelayMs(cur.attempts)).toISOString()
      : now;
    const row = this.db
      .prepare(
        `UPDATE local_jobs SET status=?, attempts=?, last_error=?, next_attempt_at=?, updated_at=?
         WHERE job_id=? AND status=? RETURNING *`,
      )
      .get(to, attempts, lastError ?? cur.lastError, next, now, jobId, cur.status) as LocalRow | undefined;
    return row ? toLocal(row) : null;
  }

  remove(jobId: string): void {
    this.db.prepare(`DELETE FROM local_jobs WHERE job_id = ?`).run(jobId);
  }

  /**
   * Reaper de boot: jobs presos em received/printing (crash, kill, update)
   * mais velhos que maxAgeMs voltam a pending para nova tentativa.
   * O backend tolera o reanúncio (refresh idempotente printing->printing).
   */
  requeueStale(maxAgeMs: number): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const now = new Date().toISOString();
    const r = this.db
      .prepare(
        `UPDATE local_jobs SET status='pending', last_error='requeue: restart', next_attempt_at=?, updated_at=?
         WHERE status IN ('received','printing') AND updated_at <= ?`,
      )
      .run(now, now, cutoff);
    return Number(r.changes);
  }

  /** Jobs em voo (received/printing) — gate do auto-install. */
  countActive(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as n FROM local_jobs WHERE status IN ('received','printing')`)
      .get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
