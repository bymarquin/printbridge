import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { closeDb } from "../src/infra/db.js";
import { openApiDocument } from "../src/openapi.js";
import { ADMIN_HTML } from "../src/admin.js";

const SETUP = "admin-test-key";
let server: Server;
let base = "";

beforeAll(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-admin-"));
  process.env.PRINTBRIDGE_DB = path.join(tmp, "admin.db");
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

const owner = (): HeadersInit => ({ "x-setup-key": SETUP, "Content-Type": "application/json" });

describe("admin", () => {
  it("GET /app/admin serve o painel sem auth (login é na página)", async () => {
    const r = await fetch(`${base}/app/admin`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(ADMIN_HTML).toContain("PrintBridge");
  });

  it("GET /openapi.json expõe contrato com webhooks e admin", async () => {
    const r = await fetch(`${base}/openapi.json`);
    const doc = (await r.json()) as { paths: Record<string, unknown> };
    expect(doc.paths["/print-agent/webhooks"]).toBeDefined();
    expect(doc.paths["/print-agent/agents"]).toBeDefined();
    expect(doc.paths["/app/admin"]).toBeDefined();
    expect(openApiDocument.paths["/app/admin"]).toBeDefined();
  });

  it("owner lista/enroll/revoga lojas; sem chave nega", async () => {
    expect((await fetch(`${base}/print-agent/agents`)).status).toBe(403);
    const enroll = await fetch(`${base}/print-agent/enroll`, {
      method: "POST", headers: owner(), body: JSON.stringify({ label: "loja-teste" }),
    });
    expect(enroll.status).toBe(201);
    const { agentId, token } = (await enroll.json()) as { agentId: string; token: string };
    const me = await fetch(`${base}/print-agent/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { agent: { id: string; label: string } }).agent).toMatchObject({
      id: agentId,
      label: "loja-teste",
    });
    expect((await fetch(`${base}/print-agent/me`)).status).toBe(401);
    const list = (await (await fetch(`${base}/print-agent/agents`, { headers: owner() })).json()) as {
      agents: Array<{ id: string; label: string }>;
    };
    expect(list.agents.some((a) => a.id === agentId)).toBe(true);
    expect((await fetch(`${base}/print-agent/agents/${agentId}`, { method: "DELETE", headers: owner() })).status).toBe(204);
    expect((await fetch(`${base}/print-agent/agents/${agentId}`, { method: "DELETE", headers: owner() })).status).toBe(404);
  });

  it("jobs/recent e printers/all exigem owner e voltam vazios no banco novo", async () => {
    expect((await fetch(`${base}/print-agent/jobs/recent`)).status).toBe(403);
    const jobs = (await (await fetch(`${base}/print-agent/jobs/recent`, { headers: owner() })).json()) as { jobs: unknown[] };
    expect(jobs.jobs).toEqual([]);
    const printers = (await (await fetch(`${base}/print-agent/printers/all`, { headers: owner() })).json()) as {
      printers: unknown[];
    };
    expect(printers.printers).toEqual([]);
  });
});
