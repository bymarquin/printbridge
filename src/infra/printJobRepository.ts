import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db.js";
import {
  assertTransition,
  canTransition,
  nextRetryDelayMs,
  type PayloadType,
  type PrintJob,
  type PrintJobStatus,
} from "../domain/printJob.js";

interface JobRow {
  id: string;
  idempotency_key: string;
  order_id: string | null;
  agent_id: string | null;
  payload_type: PayloadType;
  payload_base64: string;
  printer_id: string;
  copies: number;
  paper_width: number;
  status: PrintJobStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
}

function toDomain(r: JobRow): PrintJob {
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key,
    orderId: r.order_id,
    agentId: r.agent_id ?? null,
    payloadType: r.payload_type,
    payloadBase64: r.payload_base64,
    printerId: r.printer_id,
    copies: r.copies,
    paperWidth: r.paper_width,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    nextAttemptAt: r.next_attempt_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface EnqueueInput {
  idempotencyKey: string;
  orderId?: string | null;
  /** Dono (loja) — a rota preenche com o bearer chamador. */
  agentId?: string | null;
  payloadType: PayloadType;
  payloadBase64: string;
  printerId: string;
  copies?: number;
  paperWidth?: number;
}

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super("Job não encontrado");
    this.name = "JobNotFoundError";
  }
}

export class JobConflictError extends Error {
  constructor(msg = "job já reivindicado ou estado inválido") {
    super(msg);
    this.name = "JobConflictError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Transição inválida: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class PayloadTooLargeError extends Error {
  constructor(readonly bytes: number, readonly maxBytes: number = MAX_PAYLOAD_BYTES) {
    super(`Payload excede ${Math.round(maxBytes / 1024 / 1024)}MB`);
    this.name = "PayloadTooLargeError";
  }
}

export class PrintJobRepository {
  constructor(private readonly database?: Database.Database) {}

  private db(): Database.Database {
    return this.database ?? getDb();
  }

  /**
   * Idempotente: se idempotencyKey já existe, retorna o job original
   * sem criar duplicata (exigência do revisor #3).
   */
  enqueue(input: EnqueueInput): { job: PrintJob; deduplicated: boolean } {
    const payloadBytes = Buffer.byteLength(input.payloadBase64, "utf8");
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      throw new PayloadTooLargeError(payloadBytes);
    }
    const db = this.db();
    const existing = db
      .prepare("SELECT * FROM print_jobs WHERE idempotency_key = ?")
      .get(input.idempotencyKey) as JobRow | undefined;
    if (existing) return { job: toDomain(existing), deduplicated: true };

    const now = new Date().toISOString();
    const row: JobRow = {
      id: randomUUID(),
      idempotency_key: input.idempotencyKey,
      order_id: input.orderId ?? null,
      agent_id: input.agentId ?? null,
      payload_type: input.payloadType,
      payload_base64: input.payloadBase64,
      printer_id: input.printerId,
      copies: input.copies ?? 1,
      paper_width: input.paperWidth ?? 80,
      status: "pending",
      attempts: 0,
      last_error: null,
      next_attempt_at: now,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO print_jobs
       (id, idempotency_key, order_id, agent_id, payload_type, payload_base64, printer_id,
        copies, paper_width, status, attempts, last_error, next_attempt_at, created_at, updated_at)
       VALUES (@id, @idempotency_key, @order_id, @agent_id, @payload_type, @payload_base64, @printer_id,
        @copies, @paper_width, @status, @attempts, @last_error, @next_attempt_at, @created_at, @updated_at)`,
    ).run(row);
    const created = db
      .prepare("SELECT * FROM print_jobs WHERE id = ?")
      .get(row.id) as JobRow;
    return { job: toDomain(created), deduplicated: false };
  }

  /**
   * Pendentes da LOJA (agentId obrigatório nas rotas de agente).
   * Sem agentId = sem filtro (uso interno/admin).
   */
  listPending(limit = 20, agentId?: string): PrintJob[] {
    const now = new Date().toISOString();
    const sql = agentId
      ? `SELECT * FROM print_jobs
         WHERE status = 'pending' AND next_attempt_at <= ? AND agent_id = ?
         ORDER BY created_at ASC LIMIT ?`
      : `SELECT * FROM print_jobs
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY created_at ASC LIMIT ?`;
    const rows = (agentId
      ? this.db().prepare(sql).all(now, agentId, limit)
      : this.db().prepare(sql).all(now, limit)) as JobRow[];
    return rows.map(toDomain);
  }

  /** Últimos jobs em qualquer estado — painel admin. Sem payload (pesado). */
  listRecent(limit = 30): Array<Omit<PrintJob, "payloadBase64">> {
    const rows = this.db()
      .prepare(
        `SELECT id, idempotency_key, order_id, agent_id, payload_type, '' as payload_base64, printer_id,
                copies, paper_width, status, attempts, last_error, next_attempt_at, created_at, updated_at
         FROM print_jobs ORDER BY created_at DESC LIMIT ?`,
      )
      .all(Math.min(Math.max(limit, 1), 100)) as JobRow[];
    return rows.map((r) => {
      const { payloadBase64: _omit, ...rest } = toDomain(r);
      return rest;
    });
  }

  getById(id: string): PrintJob | null {
    const row = this.db()
      .prepare("SELECT * FROM print_jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row ? toDomain(row) : null;
  }

  /**
   * Claim atômico (revisor #6 — sem race):
   * só transita pending->received se ainda estiver pending.
   * Retorna null se outro worker já reivindicou.
   */
  claim(id: string): PrintJob | null {
    const db = this.db();
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE print_jobs
         SET status = 'received', updated_at = ?
         WHERE id = ? AND status = 'pending'
         RETURNING *`,
      )
      .get(now, id) as JobRow | undefined;
    return result ? toDomain(result) : null;
  }

  /**
   * Transição validada + CAS atômico (B3):
   * valida pela máquina de estados e grava com
   * UPDATE ... WHERE status = <esperado> — 0 linhas = race (409).
   */
  transition(id: string, to: PrintJobStatus, lastError?: string | null): PrintJob {
    const db = this.db();
    const current = this.getById(id);
    if (!current) throw new JobNotFoundError(id);
    if (!canTransition(current.status, to)) {
      throw new InvalidTransitionError(current.status, to);
    }
    // assertTransition mantém invariante em código (defesa extra, sem throw novo).
    assertTransition(current.status, to);

    const now = new Date().toISOString();
    const attempts =
      to === "failed" ? current.attempts + 1 : current.attempts;
    const nextAttemptAt =
      to === "failed"
        ? new Date(Date.now() + nextRetryDelayMs(current.attempts)).toISOString()
        : to === "pending"
          ? now // retry liberado imediatamente pelo operador
          : current.nextAttemptAt;

    const updated = db
      .prepare(
        `UPDATE print_jobs
         SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
         WHERE id = ? AND status = ? RETURNING *`,
      )
      .get(
        to,
        attempts,
        lastError ?? (to === "pending" ? null : current.lastError),
        nextAttemptAt,
        now,
        id,
        current.status,
      ) as JobRow | undefined;
    if (!updated) throw new JobConflictError();
    return toDomain(updated);
  }

  /** Falha com backoff — nunca silencia exceção (revisor #5). */
  recordFailure(id: string, error: string): PrintJob {
    return this.transition(id, "failed", error.slice(0, 2000));
  }
}
