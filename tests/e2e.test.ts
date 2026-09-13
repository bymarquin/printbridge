import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { closeDb } from "../src/infra/db.js";
import { findAgentByToken } from "../src/infra/tokenStore.js";
import { PrintJobRepository } from "../src/infra/printJobRepository.js";
import { LocalQueue } from "../agent/src/infra/localQueue.js";
import { AgentWs } from "../agent/src/api/wsClient.js";
import { tick } from "../agent/src/index.js";

const SETUP_KEY = "e2e-setup-key";

let server: Server;
let baseUrl = "";
let agentToken = "";
let tmpDir = "";
const wssClients = new Set<WebSocket>();

function auth(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function waitFor(cond: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout esperando condição e2e");
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-e2e-"));
  process.env.PRINTBRIDGE_DB = path.join(tmpDir, "backend.db");
  process.env.OWNER_SETUP_KEY = SETUP_KEY;

  const broadcast = (jobId: string) => {
    const msg = JSON.stringify({ type: "new-job", jobId });
    for (const ws of wssClients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  };
  const app = createApp(broadcast);
  server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/print-agent/ws" });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!findAgentByToken(url.searchParams.get("token") ?? "")) {
      ws.close(4401, "unauthorized");
      return;
    }
    wssClients.add(ws);
    const pending = new PrintJobRepository().listPending(20);
    ws.send(JSON.stringify({ type: "backlog", jobs: pending.map((j) => j.id) }));
    ws.on("close", () => wssClients.delete(ws));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  // Enroll real (sem mock) — gera token do agente.
  const enroll = await fetch(`${baseUrl}/print-agent/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-setup-key": SETUP_KEY },
    body: JSON.stringify({ label: "e2e-notebook" }),
  });
  expect(enroll.status).toBe(201);
  agentToken = ((await enroll.json()) as { token: string }).token;
  expect(agentToken.length).toBeGreaterThan(10);
}, 30000);

afterAll(async () => {
  for (const ws of wssClients) ws.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function agentCfg(dbName: string) {
  return {
    apiBaseUrl: baseUrl,
    token: agentToken,
    pollIntervalMs: 10000,
    dbPath: path.join(tmpDir, dbName),
  } as never;
}

async function createJob(printerId = "cozinha", payloadType: "pdf" | "raw" = "raw") {
  const res = await fetch(`${baseUrl}/print-agent/jobs`, {
    method: "POST",
    headers: auth(agentToken),
    body: JSON.stringify({
      idempotencyKey: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      payloadType,
      payloadBase64: Buffer.from("COMANDA E2E").toString("base64"),
      printerId,
      copies: 1,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { job: { id: string } }).job.id;
}

describe("E2E backend <-> agente (sem mocks de rede)", () => {
  it("(1) job chega via WS em tempo real", async () => {
    const seen: string[] = [];
    const ws = new AgentWs(
      { apiBaseUrl: baseUrl, token: agentToken } as never,
      (id) => seen.push(id),
    );
    ws.start();
    // backlog inicial pode chegar; limpa após conectar
    await new Promise((r) => setTimeout(r, 500));
    seen.length = 0;
    const jobId = await createJob();
    await waitFor(() => seen.includes(jobId));
    ws.stop();
    // Completa o job para não vazar pendente para os testes seguintes (isolamento).
    for (const s of ["received", "printing", "completed"]) {
      await fetch(`${baseUrl}/print-agent/jobs/${jobId}`, {
        method: "PATCH",
        headers: auth(agentToken),
        body: JSON.stringify({ status: s }),
      });
    }
  }, 15000);

  it("(1b) polling fallback pega sozinho com WS desligado + completa", async () => {
    const queue = new LocalQueue(path.join(tmpDir, "poll.db"));
    const jobId = await createJob("balcao");
    const executed: string[] = [];
    await tick(agentCfg("poll.db"), queue, {
      executor: { execute: async (t) => { executed.push(t.printerName); } },
    });
    // tick processa toda a fila pendente (realista); o nosso job tem que estar no meio.
    expect(executed).toContain("balcao");
    // Refletido no backend como completed…
    const res = await fetch(`${baseUrl}/print-agent/jobs/${jobId}`, { headers: auth(agentToken) });
    expect(((await res.json()) as { job: { status: string } }).job.status).toBe("completed");
    // …e fila local esvaziada.
    expect(queue.nextDue().length).toBe(0);
    queue.close();
  }, 15000);

  it("(2) printers sync aparece em GET /printers com derivedStatus", async () => {
    const sync = await fetch(`${baseUrl}/print-agent/printers/sync`, {
      method: "POST",
      headers: auth(agentToken),
      body: JSON.stringify({ printers: [{ name: "cozinha", isDefault: true, status: "ready" }] }),
    });
    expect(sync.status).toBe(200);
    const list = await fetch(`${baseUrl}/print-agent/printers`, { headers: auth(agentToken) });
    const data = (await list.json()) as { printers: Array<{ name: string; derivedStatus: string; isDefault: boolean }> };
    const p = data.printers.find((x) => x.name === "cozinha");
    expect(p?.derivedStatus).toBe("ready");
    expect(p?.isDefault).toBe(true);
  }, 15000);

  it("(3) falha -> retry manual -> completed nos dois lados", async () => {
    const queue = new LocalQueue(path.join(tmpDir, "retry.db"));
    const jobId = await createJob("cozinha");
    const cfg = agentCfg("retry.db");
    // Executor quebrado — falha real.
    await tick(cfg, queue, {
      executor: { execute: async () => { throw new Error("paper jam e2e"); } },
    });
    let res = await fetch(`${baseUrl}/print-agent/jobs/${jobId}`, { headers: auth(agentToken) });
    let job = ((await res.json()) as { job: { status: string; attempts?: number; lastError?: string } }).job;
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain("paper jam");
    // Retry manual pelo operador.
    const retry = await fetch(`${baseUrl}/print-agent/jobs/${jobId}`, {
      method: "PATCH",
      headers: auth(agentToken),
      body: JSON.stringify({ status: "pending" }),
    });
    expect(retry.status).toBe(200);
    // Executor saudável — sucesso refletido nos dois lados.
    // Backoff local é 5s: repete tick até o job failed ficar elegível de novo
    // (exercita o branch failed->pending de verdade, sem mock de clock).
    const started = Date.now();
    let doneStatus = "";
    while (Date.now() - started < 15000) {
      await tick(cfg, queue, { executor: { execute: async () => {} } });
      res = await fetch(`${baseUrl}/print-agent/jobs/${jobId}`, { headers: auth(agentToken) });
      doneStatus = ((await res.json()) as { job: { status: string } }).job.status;
      if (doneStatus === "completed") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(doneStatus).toBe("completed");
    expect(queue.nextDue().length).toBe(0);
    queue.close();
  }, 20000);
});
