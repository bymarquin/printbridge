import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate, closeDb } from "../src/infra/db.js";
import {
  createSession,
  refreshSession,
  revokeSession,
  verifyAccess,
} from "../src/services/sessions.js";
import { createApp } from "../src/app.js";

const SETUP = "sess-setup-key";

function memDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

describe("sessões (unidade)", () => {
  it("ciclo login → uso → refresh rotativo → logout", () => {
    const db = memDb();
    const s1 = createSession("owner", db);
    expect(verifyAccess(s1.accessToken, db)).toBe("owner");
    expect(verifyAccess("lixo", db)).toBeNull();

    const s2 = refreshSession(s1.refreshToken, db);
    expect(s2.accessToken).not.toBe(s1.accessToken);
    expect(verifyAccess(s2.accessToken, db)).toBe("owner");
    // rotação mata o par antigo por inteiro (access junto — sem janela dupla)
    expect(verifyAccess(s1.accessToken, db)).toBeNull();

    expect(revokeSession(s2.refreshToken, db)).toBe(true);
    // reuso pós-logout cai na defesa anti-roubo (indistinguível — seguro por padrão)
    expect(() => refreshSession(s2.refreshToken, db)).toThrow(/revogad|inválido|expirado|derrubadas/);
  });

  it("reuso de refresh revogado derruba a cadeia inteira", () => {
    const db = memDb();
    const s1 = createSession("owner", db);
    const s2 = refreshSession(s1.refreshToken, db);
    expect(() => refreshSession(s1.refreshToken, db)).toThrow(/derrubadas/);
    // cadeia morta: até o access do par novo cai na hora
    expect(() => refreshSession(s2.refreshToken, db)).toThrow();
    expect(verifyAccess(s2.accessToken, db)).toBeNull();
  });

  it("access expirado nega", () => {
    const db = memDb();
    const s = createSession("owner", db);
    db.prepare("UPDATE sessions SET access_expires_at = '2020-01-01T00:00:00.000Z'").run();
    expect(verifyAccess(s.accessToken, db)).toBeNull();
  });
});

describe("sessões (http)", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-sess-"));
    process.env.PRINTBRIDGE_DB = path.join(tmp, "s.db");
    process.env.OWNER_SETUP_KEY = SETUP;
    server = createServer(createApp());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    closeDb();
  });

  it("login/recusa + owner via sessão + chave estática segue valendo", async () => {
    const bad = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setupKey: "errada" }),
    });
    expect(bad.status).toBe(403);

    const ok = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setupKey: SETUP }),
    });
    expect(ok.status).toBe(200);
    const { session } = (await ok.json()) as { session: { accessToken: string; refreshToken: string } };

    const me = await fetch(`${base}/print-agent/agents`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(me.status).toBe(200);

    const legacy = await fetch(`${base}/print-agent/agents`, { headers: { "x-setup-key": SETUP } });
    expect(legacy.status).toBe(200);

    const bye = await fetch(`${base}/auth/logout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    expect(bye.status).toBe(204);
  });
});
