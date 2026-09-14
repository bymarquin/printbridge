import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "../infra/db.js";
import { createAgent, hashToken } from "../infra/tokenStore.js";

export const PAIR_TTL_MS = 10 * 60_000;
// Alfabeto sem ambíguos (0/O, 1/I/L fora).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type PairStatus = "pending" | "approved" | "consumed";

function dbOf(database?: Database.Database): Database.Database {
  return database ?? getDb();
}

function newCode(db: Database.Database): string {
  for (let i = 0; i < 10; i++) {
    const bytes = randomBytes(6);
    let code = "";
    for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
    const exists = db.prepare("SELECT 1 FROM pairing_codes WHERE code = ?").get(code);
    if (!exists) return code;
  }
  throw new Error("não foi possível gerar código único");
}

/** Passo 1 (agente, público): pede código curto para exibir na tela da loja. */
export function requestPairing(label: string, database?: Database.Database): { code: string; expiresAt: string } {
  const db = dbOf(database);
  const clean = label.trim().slice(0, 64) || "loja";
  db.prepare("DELETE FROM pairing_codes WHERE expires_at <= ?").run(new Date().toISOString());
  const code = newCode(db);
  const expiresAt = new Date(Date.now() + PAIR_TTL_MS).toISOString();
  db.prepare("INSERT INTO pairing_codes (code, label, expires_at) VALUES (?, ?, ?)").run(code, clean, expiresAt);
  return { code, expiresAt };
}

export interface PairStatusResult {
  status: PairStatus;
  /** Token UMA vez (primeira leitura após approve) — depois a linha vira consumed. */
  token?: string;
  agentId?: string;
}

/** Passo 3 (agente, público): consulta; consome o token na primeira leitura. */
export function pollPairing(code: string, database?: Database.Database): PairStatusResult {
  const db = dbOf(database);
  const row = db
    .prepare("SELECT status, agent_id, token, expires_at FROM pairing_codes WHERE code = ?")
    .get(code.toUpperCase().trim()) as
    | { status: PairStatus; agent_id: string | null; token: string | null; expires_at: string }
    | undefined;
  if (!row) throw new Error("código inválido");
  if (row.status === "consumed") return { status: "consumed" };
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM pairing_codes WHERE code = ?").run(code.toUpperCase().trim());
    throw new Error("código expirado");
  }
  if (row.status === "pending") return { status: "pending" };
  // approved: entrega o token uma única vez e consome
  const tx = db.transaction(() => {
    db.prepare("UPDATE pairing_codes SET status = 'consumed', token = NULL WHERE code = ?").run(
      code.toUpperCase().trim(),
    );
    return { status: "approved" as const, token: row.token ?? undefined, agentId: row.agent_id ?? undefined };
  });
  return tx() as PairStatusResult;
}

/** Passo 2 (dono): aprova o código exibido na loja — cria agente + token. */
export function approvePairing(
  code: string,
  database?: Database.Database,
): { agentId: string; token: string; label: string } {
  const db = dbOf(database);
  const normalized = code.toUpperCase().trim();
  const row = db
    .prepare("SELECT label, status, expires_at FROM pairing_codes WHERE code = ?")
    .get(normalized) as
    | { label: string; status: PairStatus; expires_at: string }
    | undefined;
  if (!row) throw new Error("código inválido");
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM pairing_codes WHERE code = ?").run(normalized);
    throw new Error("código expirado");
  }
  if (row.status !== "pending") throw new Error("código já utilizado");
  const token = `pb_${randomBytes(24).toString("hex")}`;
  const agent = createAgent(row.label, hashToken(token), db);
  db.prepare("UPDATE pairing_codes SET status = 'approved', agent_id = ?, token = ? WHERE code = ?").run(
    agent.id,
    token,
    normalized,
  );
  return { agentId: agent.id, token, label: row.label };
}
