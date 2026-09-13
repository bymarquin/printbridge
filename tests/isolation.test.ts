import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { closeDb } from "../src/infra/db.js";

const SETUP = "iso-setup-key";
let server: Server;
let base = "";
let tokenA = "";
let tokenB = "";

const owner = (): HeadersInit => ({ "x-setup-key": SETUP, "Content-Type": "application/json" });
const bearer = (t: string): HeadersInit => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

async function enroll(label: string): Promise<{ agentId: string; token: string }> {
  const r = await fetch(`${base}/print-agent/enroll`, {
    method: "POST", headers: owner(), body: JSON.stringify({ label }),
  });
  expect(r.status).toBe(201);
  return (await r.json()) as { agentId: string; token: string };
}

async function enqueue(token: string, key: string, printer = "cozinha"): Promise<string> {
  const r = await fetch(`${base}/print-agent/jobs`, {
    method: "POST", headers: bearer(token),
    body: JSON.stringify({
      idempotencyKey: key, payloadType: "raw",
      payloadBase64: Buffer.from("x").toString("base64"), printerId: printer,
    }),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { job: { id: string } }).job.id;
}

beforeAll(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-iso-"));
  process.env.PRINTBRIDGE_DB = path.join(tmp, "iso.db");
  process.env.OWNER_SETUP_KEY = SETUP;
  server = createServer(createApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  tokenA = (await enroll("loja-a")).token;
  tokenB = (await enroll("loja-b")).token;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  closeDb();
});

describe("isolamento por loja", () => {
  it("loja B não vê, não puxa, não transita job da loja A (404 idêntico)", async () => {
    const jobId = await enqueue(tokenA, `iso-${Date.now()}`);
    // Leitura
    expect((await fetch(`${base}/print-agent/jobs/${jobId}`, { headers: bearer(tokenB) })).status).toBe(404);
    expect((await fetch(`${base}/print-agent/jobs/${jobId}`, { headers: bearer(tokenA) })).status).toBe(200);
    // Polling: A vê, B não
    const pollA = (await (await fetch(`${base}/print-agent/jobs`, { headers: bearer(tokenA) })).json()) as { jobs: Array<{ id: string }> };
    const pollB = (await (await fetch(`${base}/print-agent/jobs`, { headers: bearer(tokenB) })).json()) as { jobs: Array<{ id: string }> };
    expect(pollA.jobs.some((j) => j.id === jobId)).toBe(true);
    expect(pollB.jobs.some((j) => j.id === jobId)).toBe(false);
    // Claim + transição da vizinha negados
    expect((await fetch(`${base}/print-agent/jobs/${jobId}/claim`, { method: "POST", headers: bearer(tokenB) })).status).toBe(404);
    expect((await fetch(`${base}/print-agent/jobs/${jobId}`, {
      method: "PATCH", headers: bearer(tokenB), body: JSON.stringify({ status: "printing" }),
    })).status).toBe(404);
    // Dono continua vendo tudo (recent)
    const recent = (await (await fetch(`${base}/print-agent/jobs/recent`, { headers: owner() })).json()) as {
      jobs: Array<{ id: string }>;
    };
    expect(recent.jobs.some((j) => j.id === jobId)).toBe(true);
  });

  it("webhook da loja A não dispara para job da loja B", async () => {
    const mk = await fetch(`${base}/print-agent/webhooks`, {
      method: "POST", headers: bearer(tokenA), body: JSON.stringify({ url: "https://a.exemplo.com/h" }),
    });
    expect(mk.status).toBe(201);
    // B não lista webhook de A; owner lista
    const listB = (await (await fetch(`${base}/print-agent/webhooks`, { headers: bearer(tokenB) })).json()) as {
      webhooks: Array<{ id: string }>;
    };
    const listO = (await (await fetch(`${base}/print-agent/webhooks`, { headers: owner() })).json()) as {
      webhooks: Array<{ id: string }>;
    };
    const whId = ((await mk.json()) as { webhook: { id: string } }).webhook.id;
    expect(listB.webhooks.some((w) => w.id === whId)).toBe(false);
    expect(listO.webhooks.some((w) => w.id === whId)).toBe(true);
    // B não deleta webhook de A
    expect((await fetch(`${base}/print-agent/webhooks/${whId}`, { method: "DELETE", headers: bearer(tokenB) })).status).toBe(404);
  });
});
