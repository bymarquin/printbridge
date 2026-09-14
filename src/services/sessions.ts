import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "../infra/db.js";

export const ACCESS_TTL_MS = 15 * 60_000; // chave rotativa curta
export const REFRESH_TTL_MS = 30 * 24 * 3600_000; // login persistente longo

export interface SessionPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

function sha(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function dbOf(database?: Database.Database): Database.Database {
  return database ?? getDb();
}

function issue(subject: string, db: Database.Database): SessionPair {
  const accessToken = `pba_${randomBytes(24).toString("hex")}`;
  const refreshToken = `pbr_${randomBytes(24).toString("hex")}`;
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TTL_MS).toISOString();
  const refreshExpiresAt = new Date(now + REFRESH_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, subject, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    `se_${randomBytes(8).toString("hex")}`,
    subject,
    sha(accessToken),
    accessExpiresAt,
    sha(refreshToken),
    refreshExpiresAt,
  );
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

export function createSession(subject: string, database?: Database.Database): SessionPair {
  return issue(subject, dbOf(database));
}

/** Dono da sessão de um access token válido (null = inválido/expirado). */
export function verifyAccess(token: string, database?: Database.Database): string | null {
  const row = dbOf(database)
    .prepare("SELECT subject, access_expires_at, revoked FROM sessions WHERE access_hash = ?")
    .get(sha(token)) as { subject: string; access_expires_at: string; revoked: number } | undefined;
  if (!row || row.revoked) return null;
  if (Date.parse(row.access_expires_at) <= Date.now()) return null;
  return row.subject;
}

/**
 * Rotação: refresh válido gera par novo e revoga o antigo.
 * Reuso de refresh já revogado = possível roubo → derruba TODAS as sessões do dono.
 */
export function refreshSession(refreshToken: string, database?: Database.Database): SessionPair {
  const db = dbOf(database);
  const row = db
    .prepare("SELECT id, subject, refresh_expires_at, revoked FROM sessions WHERE refresh_hash = ?")
    .get(sha(refreshToken)) as
    | { id: string; subject: string; refresh_expires_at: string; revoked: number }
    | undefined;
  if (!row) throw new Error("refresh inválido");
  if (row.revoked) {
    db.prepare("UPDATE sessions SET revoked = 1 WHERE subject = ?").run(row.subject);
    throw new Error("refresh reutilizado — sessões derrubadas por segurança");
  }
  if (Date.parse(row.refresh_expires_at) <= Date.now()) throw new Error("refresh expirado");
  const tx = db.transaction(() => {
    db.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").run(row.id);
    return issue(row.subject, db);
  });
  return tx() as SessionPair;
}

export function revokeSession(refreshToken: string, database?: Database.Database): boolean {
  return (
    dbOf(database).prepare("UPDATE sessions SET revoked = 1 WHERE refresh_hash = ?").run(sha(refreshToken))
      .changes > 0
  );
}
