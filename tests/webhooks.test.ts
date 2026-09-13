import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { migrate } from "../src/infra/db.js";
import {
  assertPublicUrl,
  createWebhook,
  deleteWebhook,
  deliverDue,
  dispatchJobEvent,
  isBlockedV4,
  isBlockedV6,
  listWebhooks,
  signPayload,
  verifySignature,
} from "../src/services/webhooks.js";
import type { PrintJob } from "../src/domain/printJob.js";

function testDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

const baseJob: PrintJob = {
  id: "job-1",
  idempotencyKey: "order-1",
  orderId: "order-1",
  payloadType: "raw",
  payloadBase64: "eA==", agentId: null,
  printerId: "cozinha",
  copies: 1,
  paperWidth: 80,
  status: "completed",
  attempts: 0,
  lastError: null,
  nextAttemptAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function localHookServer(onPost: (headers: Record<string, string | string[] | undefined>, body: string) => void) {
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      onPost(req.headers, body);
      res.writeHead(200).end("ok");
    });
  });
  return { server, received };
}

describe("webhooks", () => {
  let db: Database.Database;
  beforeEach(() => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = "1"; // testes usam loopback local
    db = testDb();
  });

  it("HMAC assina e verifica; adulteração falha", () => {
    const body = '{"a":1}';
    const sig = signPayload("s3cr3t", body);
    expect(verifySignature("s3cr3t", body, sig)).toBe(true);
    expect(verifySignature("s3cr3t", '{"a":2}', sig)).toBe(false);
    expect(verifySignature("outro", body, sig)).toBe(false);
  });

  it("exige https (http só localhost) e valida eventos", async () => {
    await expect(createWebhook({ url: "http://api.exemplo.com/hook" }, null, db)).rejects.toThrow(/https|privado/i);
    await expect(createWebhook({ url: "https://x.com/h", events: ["nope" as never] }, null, db)).rejects.toThrow(/desconhecido/);
    const wh = await createWebhook({ url: "https://sistema.exemplo.com/hook" }, null, db);
    expect(wh.secret.length).toBeGreaterThan(30);
    expect(listWebhooks(db)).toHaveLength(1);
    expect(listWebhooks(db)[0]).not.toHaveProperty("secret"); // segredo nunca lista
    expect(deleteWebhook(wh.id, db)).toBe(true);
    expect(deleteWebhook(wh.id, db)).toBe(false);
  });

  it("SSRF: bloqueia IPv4-mapeado em IPv6 e redirects", async () => {
    // Mapeados caem no julgamento do IPv4 embutido (incl. forma comprimida RFC 5952).
    expect(isBlockedV6("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedV6("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedV6("::ffff:7f00:1")).toBe(true);
    expect(isBlockedV6("::ffff:c0a8:101")).toBe(true); // 192.168.1.1 comprimido
    expect(isBlockedV6("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedV4("8.8.8.8")).toBe(false);
    expect(isBlockedV4("169.254.169.254")).toBe(true);
    delete process.env.ALLOW_PRIVATE_WEBHOOKS;
    try {
      await expect(assertPublicUrl(new URL("http://127.0.0.1:9/x"))).rejects.toThrow(/SSRF/i);
    } finally {
      process.env.ALLOW_PRIVATE_WEBHOOKS = "1";
    }
    // Redirect 302 não é seguido: entrega falha em vez de vazar para o destino.
    const { server } = await new Promise<{ server: import("node:http").Server }>((resolve) => {
      const s = createServer((_req, res) => {
        res.writeHead(302, { Location: "http://127.0.0.1:9/alvo" }).end();
      });
      s.listen(0, "127.0.0.1", () => resolve({ server: s }));
    });
    const port = (server.address() as AddressInfo).port;
    try {
      await createWebhook({ url: `http://127.0.0.1:${port}/hook` }, null, db);
      dispatchJobEvent(baseJob, "job.completed", db);
      const r = await deliverDue(20, db);
      expect(r.failed).toBe(1);
      const row = db.prepare("SELECT status, last_error FROM webhook_deliveries").get() as {
        status: string; last_error: string;
      };
      expect(row.status).toBe("pending"); // retenta depois (1ª falha)
      expect(row.last_error).toMatch(/redirect bloqueado/i);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("entrega evento com assinatura válida", async () => {
    const { server, received } = localHookServer(() => {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const wh = await createWebhook({ url: `http://127.0.0.1:${port}/hook`, events: ["job.completed"] }, null, db);
      expect(dispatchJobEvent(baseJob, "job.completed", db)).toBe(1);
      expect(dispatchJobEvent({ ...baseJob, id: "x", printerId: "bar" }, "job.printing", db)).toBe(0); // filtro evento
      const r = await deliverDue(20, db);
      expect(r).toEqual({ delivered: 1, failed: 0 });
      expect(received).toHaveLength(1);
      const body = JSON.parse(received[0].body) as { event: string; job: { id: string } };
      expect(body.event).toBe("job.completed");
      expect(body.job.id).toBe("job-1");
      const sig = received[0].headers["x-printbridge-signature"] as string;
      expect(verifySignature(wh.secret, received[0].body, sig)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("claim atômico: dois sweepers concorrentes entregam 1x só", async () => {
    const { server, received } = localHookServer(() => {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      await createWebhook({ url: `http://127.0.0.1:${port}/hook` }, null, db);
      dispatchJobEvent(baseJob, "job.completed", db);
      const [a, b] = await Promise.all([deliverDue(20, db), deliverDue(20, db)]);
      expect(a.delivered + b.delivered).toBe(1);
      expect(received).toHaveLength(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  it("filtro por impressora: cozinha não recebe evento do bar", async () => {
    await createWebhook({ url: "https://a.exemplo.com/h", printerIds: ["cozinha"] }, null, db);
    expect(dispatchJobEvent(baseJob, "job.completed", db)).toBe(1);
    expect(dispatchJobEvent({ ...baseJob, id: "y", printerId: "bar" }, "job.completed", db)).toBe(0);
  });

  it("falha retenta 2x e depois marca dead (sem perder silencioso)", async () => {
    await createWebhook({ url: "http://127.0.0.1:1/inválida" }, null, db); // porta fechada
    dispatchJobEvent(baseJob, "job.failed", db);
    const forceDue = () =>
      db.prepare("UPDATE webhook_deliveries SET next_attempt_at = '2020-01-01T00:00:00.000Z'").run();
    await deliverDue(20, db);
    let row = db.prepare("SELECT status, attempts FROM webhook_deliveries").get() as { status: string; attempts: number };
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    forceDue();
    await deliverDue(20, db);
    row = db.prepare("SELECT status, attempts FROM webhook_deliveries").get() as { status: string; attempts: number };
    expect(row).toMatchObject({ status: "pending", attempts: 2 });
    forceDue();
    await deliverDue(20, db);
    row = db.prepare("SELECT status, attempts FROM webhook_deliveries").get() as { status: string; attempts: number };
    expect(row).toMatchObject({ status: "dead", attempts: 3 });
  });
});
