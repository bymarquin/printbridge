import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;
  const resolved =
    dbPath ??
    process.env.PRINTBRIDGE_DB ??
    path.join(process.cwd(), "data", "printbridge.db");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** Fecha conexão (útil em testes). */
export function closeDb(): void {
  db?.close();
  db = null;
}

/** Roda as migrations numa conexão arbitrária (testes usam :memory:). */
export function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      order_id TEXT,
      payload_type TEXT NOT NULL CHECK (payload_type IN ('pdf','raw')),
      payload_base64 TEXT NOT NULL,
      printer_id TEXT NOT NULL,
      copies INTEGER NOT NULL DEFAULT 1,
      paper_width INTEGER NOT NULL DEFAULT 80,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','received','printing','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_next ON print_jobs(status, next_attempt_at);

    CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(agent_id, name)
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      printer_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_due ON webhook_deliveries(status, next_attempt_at);
  `);
  // Colunas de escopo por loja (adicionadas após o MVP inicial).
  ensureColumn(database, "print_jobs", "agent_id", "TEXT REFERENCES agents(id) ON DELETE SET NULL");
  ensureColumn(database, "webhooks", "agent_id", "TEXT REFERENCES agents(id) ON DELETE CASCADE");
}

/** ADD COLUMN idempotente (SQLite não tem IF NOT EXISTS para isso). */
function ensureColumn(database: Database.Database, table: string, column: string, ddl: string): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
