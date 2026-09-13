import { createHash, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compara strings em tempo constante (tokens, setup keys). */
export function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Compara hashes em tempo constante para evitar timing attack. */
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface Agent {
  id: string;
  label: string;
  tokenHash: string;
}

export function findAgentByToken(
  token: string,
  database?: Database.Database,
): Agent | null {
  const db = database ?? getDb();
  // Token estático de emergência (1 loja / dev) — comparação constante (B1).
  const staticToken = process.env.PRINT_AGENT_TOKEN;
  if (staticToken && safeEqualString(token, staticToken)) {
    return { id: "static", label: "static", tokenHash: hashToken(token) };
  }
  const hash = hashToken(token);
  // Busca por hash e confirma com comparação constante.
  const row = db
    .prepare("SELECT id, label, token_hash as tokenHash FROM agents WHERE token_hash = ?")
    .get(hash) as Agent | undefined;
  if (!row || !safeEqualHex(row.tokenHash, hash)) return null;
  return row;
}

export function createAgent(
  label: string,
  tokenHash: string,
  database?: Database.Database,
): Agent {
  const db = database ?? getDb();
  const id = `ag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare("INSERT INTO agents (id, label, token_hash) VALUES (?, ?, ?)").run(
    id,
    label,
    tokenHash,
  );
  return { id, label, tokenHash };
}

export function revokeAgent(id: string, database?: Database.Database): boolean {
  const db = database ?? getDb();
  return db.prepare("DELETE FROM agents WHERE id = ?").run(id).changes > 0;
}
