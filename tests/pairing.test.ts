import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate, closeDb } from "../src/infra/db.js";
import { approvePairing, pollPairing, requestPairing } from "../src/services/pairing.js";
import { rateLimit } from "../src/middleware/rateLimit.js";
import { createApp } from "../src/app.js";

describe("rateLimit", () => {
  it("instâncias não dividem budget", () => {
    const a = rateLimit(30);
    const b = rateLimit(60);
    let status = 0;
    const res = { status: (c: number) => { status = c; return { json: () => {} }; } };
    const req = { headers: {}, socket: { remoteAddress: "9.9.9.9" } };
    const next = () => { status = 200; };
    for (let i = 0; i < 40; i++) b(req as never, res as never, next); // esgota SÓ o b
    expect(status).toBe(200);
    a(req as never, res as never, next); // a intacto
    expect(status).toBe(200);
  });
});

function memDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

describe("pareamento", () => {
  it("fluxo completo: request → approve → poll consome 1x", () => {
    const db = memDb();
    const { code, expiresAt } = requestPairing("caixa-1", db);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

    expect(pollPairing(code, db)).toEqual({ status: "pending" });

    const ap = approvePairing(code, db);
    expect(ap.token.startsWith("pb_")).toBe(true);
    expect(ap.label).toBe("caixa-1");

    const got = pollPairing(code, db);
    expect(got.status).toBe("approved");
    expect(got.token).toBe(ap.token);

    // segunda leitura: já consumido, sem token
    expect(pollPairing(code, db)).toEqual({ status: "consumed" });
    awaitExpectApproveFails();
    function awaitExpectApproveFails() {
      expect(() => approvePairing(code, db)).toThrow(/utilizado/);
    }
  });

  it("código inválido e expirado", () => {
    const db = memDb();
    expect(() => pollPairing("XXXXXX", db)).toThrow(/inválido/);
    expect(() => approvePairing("XXXXXX", db)).toThrow(/inválido/);
    const { code } = requestPairing("x", db);
    db.prepare("UPDATE pairing_codes SET expires_at = '2020-01-01T00:00:00.000Z' WHERE code = ?").run(code);
    expect(() => pollPairing(code, db)).toThrow(/expirado/);
    expect(() => approvePairing(code, db)).toThrow(/expirado|inválido/);
  });

  it("case-insensitive", () => {
    const db = memDb();
    const { code } = requestPairing("y", db);
    expect(pollPairing(code.toLowerCase(), db)).toEqual({ status: "pending" });
  });
});

describe("pareamento (http)", () => {
  const SETUP = "pair-http-key";
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-pair-"));
    process.env.PRINTBRIDGE_DB = path.join(tmp, "pair.db");
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

  it("fluxo http: request → status pending → approve → status com token 1x", async () => {
    const req = await fetch(`${base}/print-agent/pairing/request`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "quiosque" }),
    });
    expect(req.status).toBe(201);
    const { code } = (await req.json()) as { code: string };

    const st1 = (await (await fetch(`${base}/print-agent/pairing/status?code=${code}`)).json()) as { status: string };
    expect(st1.status).toBe("pending");

    const ap = await fetch(`${base}/print-agent/pairing/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-setup-key": SETUP },
      body: JSON.stringify({ code }),
    });
    expect(ap.status).toBe(201);
    const approved = (await ap.json()) as { token: string };
    expect(approved.token.startsWith("pb_")).toBe(true);

    const st2 = (await (await fetch(`${base}/print-agent/pairing/status?code=${code}`)).json()) as {
      status: string; token?: string;
    };
    expect(st2.status).toBe("approved");
    expect(st2.token).toBe(approved.token);

    // segunda leitura: consumido, sem token (mesmo endpoint, sem auth)
    const st3 = (await (await fetch(`${base}/print-agent/pairing/status?code=${code}`)).json()) as { status: string };
    expect(st3.status).toBe("consumed");
    expect("token" in st3).toBe(false);
  });
});
