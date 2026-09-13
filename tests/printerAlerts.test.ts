import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { migrate } from "../src/infra/db.js";
import { checkPrinterAlerts, createWebhook, deliverDue, verifySignature } from "../src/services/webhooks.js";

function testDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function seedAgent(db: Database.Database, id: string, label: string): void {
  db.prepare("INSERT INTO agents (id, label, token_hash) VALUES (?, ?, ?)").run(id, label, `hash-${id}`);
}

function seedPrinter(
  db: Database.Database,
  opts: { id: string; agentId: string; name: string; lastSeenAt: string; lastAlertStatus?: string | null },
): void {
  db.prepare(
    `INSERT INTO printers (id, agent_id, name, is_default, status, last_seen_at, last_alert_status)
     VALUES (?, ?, ?, 0, 'ready', ?, ?)`,
  ).run(opts.id, opts.agentId, opts.name, opts.lastSeenAt, opts.lastAlertStatus ?? null);
}

const OLD = new Date(Date.now() - 5 * 60_000).toISOString(); // > 90s atrás
const NOW = new Date().toISOString();

describe("alerta de impressora offline/online", () => {
  beforeEach(() => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = "1"; // testes usam URL fictícia/loopback
  });

  it("primeira varredura só grava baseline — não dispara alerta", async () => {
    const db = testDb();
    seedAgent(db, "ag1", "loja-a");
    // Já nasce "velha" (fora do heartbeat), mas last_alert_status ainda é NULL.
    seedPrinter(db, { id: "p1", agentId: "ag1", name: "cozinha", lastSeenAt: OLD });
    await createWebhook({ url: "https://x.exemplo.com/h", events: ["printer.offline"] }, "ag1", db);

    const fired = checkPrinterAlerts(db);
    expect(fired).toBe(0);
    const row = db.prepare("SELECT last_alert_status FROM printers WHERE id = 'p1'").get() as { last_alert_status: string };
    expect(row.last_alert_status).toBe("offline"); // baseline gravada como offline
  });

  it("transição ready->offline dispara printer.offline; volta a responder dispara printer.online", async () => {
    const db = testDb();
    seedAgent(db, "ag1", "loja-a");
    seedPrinter(db, { id: "p1", agentId: "ag1", name: "cozinha", lastSeenAt: NOW, lastAlertStatus: "ready" });
    const wh = await createWebhook({ url: "https://x.exemplo.com/h", events: ["printer.offline", "printer.online"] }, "ag1", db);

    // Sem mudança: continua "ready" (heartbeat recente).
    expect(checkPrinterAlerts(db)).toBe(0);

    // Simula heartbeat parado.
    db.prepare("UPDATE printers SET last_seen_at = ? WHERE id = 'p1'").run(OLD);
    expect(checkPrinterAlerts(db)).toBe(1);
    const firstDelivery = db.prepare("SELECT event, payload FROM webhook_deliveries WHERE webhook_id = ?").all(wh.id) as Array<{ event: string; payload: string }>;
    expect(firstDelivery).toHaveLength(1);
    expect(firstDelivery[0].event).toBe("printer.offline");
    const payload = JSON.parse(firstDelivery[0].payload) as { printer: { name: string; agentId: string } };
    expect(payload.printer.name).toBe("cozinha");
    expect(payload.printer.agentId).toBe("ag1");

    // Não repete o alerta enquanto continuar offline.
    expect(checkPrinterAlerts(db)).toBe(0);

    // Heartbeat volta.
    db.prepare("UPDATE printers SET last_seen_at = ? WHERE id = 'p1'").run(new Date().toISOString());
    expect(checkPrinterAlerts(db)).toBe(1);
    const allDeliveries = db.prepare("SELECT event FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at").all(wh.id) as Array<{ event: string }>;
    expect(allDeliveries.map((d) => d.event)).toEqual(["printer.offline", "printer.online"]);
  });

  it("isolamento: webhook da loja B não recebe alerta da impressora da loja A", async () => {
    const db = testDb();
    seedAgent(db, "ag1", "loja-a");
    seedAgent(db, "ag2", "loja-b");
    seedPrinter(db, { id: "p1", agentId: "ag1", name: "cozinha", lastSeenAt: NOW, lastAlertStatus: "ready" });
    const whB = await createWebhook({ url: "https://b.exemplo.com/h", events: ["printer.offline"] }, "ag2", db);
    const whGlobal = await createWebhook({ url: "https://owner.exemplo.com/h", events: ["printer.offline"] }, null, db);

    db.prepare("UPDATE printers SET last_seen_at = ? WHERE id = 'p1'").run(OLD);
    const fired = checkPrinterAlerts(db);
    expect(fired).toBe(1); // só o global — o da loja B não bate

    const deliveredTo = db.prepare("SELECT webhook_id FROM webhook_deliveries").all() as Array<{ webhook_id: string }>;
    expect(deliveredTo.map((d) => d.webhook_id)).toEqual([whGlobal.id]);
    expect(deliveredTo.some((d) => d.webhook_id === whB.id)).toBe(false);
  });

  it("entrega HTTP real do alerta com assinatura válida", async () => {
    const db = testDb();
    const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      seedAgent(db, "ag1", "loja-a");
      seedPrinter(db, { id: "p1", agentId: "ag1", name: "cozinha", lastSeenAt: NOW, lastAlertStatus: "ready" });
      const wh = await createWebhook({ url: `http://127.0.0.1:${port}/hook`, events: ["printer.offline"] }, "ag1", db);

      db.prepare("UPDATE printers SET last_seen_at = ? WHERE id = 'p1'").run(OLD);
      expect(checkPrinterAlerts(db)).toBe(1);
      const r = await deliverDue(20, db);
      expect(r).toEqual({ delivered: 1, failed: 0 });
      expect(received).toHaveLength(1);
      const body = JSON.parse(received[0].body) as { event: string; printer: { name: string } };
      expect(body.event).toBe("printer.offline");
      expect(body.printer.name).toBe("cozinha");
      const sig = received[0].headers["x-printbridge-signature"] as string;
      expect(verifySignature(wh.secret, received[0].body, sig)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
