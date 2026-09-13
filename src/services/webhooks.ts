import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import type Database from "better-sqlite3";
import { getDb } from "../infra/db.js";
import type { PrintJob } from "../domain/printJob.js";

export type WebhookEvent =
  | "job.created"
  | "job.received"
  | "job.printing"
  | "job.completed"
  | "job.failed"
  | "job.requeued"
  | "printer.offline"
  | "printer.online";

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  printerIds: string[];
  /** Dono (loja). NULL = criado pelo owner = dispara para todas as lojas. */
  agentId: string | null;
}

export interface WebhookWithSecret extends Webhook {
  /** Retornado UMA vez na criação — guarde no sistema chamador. */
  secret: string;
}

const ALL_EVENTS: WebhookEvent[] = [
  "job.created", "job.received", "job.printing", "job.completed", "job.failed", "job.requeued",
  "printer.offline", "printer.online",
];
const RETRY_DELAYS_MS = [30_000, 5 * 60_000]; // após a tentativa imediata
const DELIVERY_TIMEOUT_MS = 8_000;
/** Mesmo critério do GET /printers (derivedStatus) — fonte única. */
export const OFFLINE_AFTER_MS = 90_000;

/** Assina o corpo bruto: header `x-printbridge-signature: sha256=<hex>`. */
export function signPayload(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifySignature(secret: string, body: string, header: string): boolean {
  const a = Buffer.from(header);
  const b = Buffer.from(signPayload(secret, body));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function dbOf(database?: Database.Database): Database.Database {
  return database ?? getDb();
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

const V4_BLOCKS: Array<[number, number]> = [
  [0x0a000000, 8], [0xac100000, 12], [0xc0a80000, 16], // RFC1918
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local (incl. metadata cloud 169.254.169.254)
  [0x00000000, 8], // "this network"
  [0xe0000000, 4], // multicast
  [0xffffffff, 32], // broadcast
];

/** Exportados para teste direto das faixas. */
export function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // não reconheço => bloqueia
  return V4_BLOCKS.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
}

/** Exportados para teste direto das faixas. */
export function isBlockedV6(ip: string): boolean {
  const h = ip.toLowerCase();
  // IPv4-mapeado (::ffff:127.0.0.1 ou ::ffff:c0a8:101): julga o IPv4 embutido.
  if (h.startsWith("::ffff:")) {
    const tail = h.slice("::ffff:".length);
    if (tail.includes(".")) return isBlockedV4(tail);
    const groups = tail.split(":");
    if (groups.length === 2 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
      // Monta o inteiro via shift (pad por construção — sem concatenar strings).
      const n = ((parseInt(groups[0], 16) << 16) | parseInt(groups[1], 16)) >>> 0;
      const dotted = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
      return isBlockedV4(dotted);
    }
    return true; // forma irreconhecível => bloqueia
  }
  return (
    h === "::1" || h === "::" ||
    h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd") ||
    h.startsWith("ff")
  );
}

/**
 * B2: rejeita destino em rede privada. Chamado no cadastro E antes de cada
 * entrega (mitiga DNS rebinding). ALLOW_PRIVATE_WEBHOOKS=1 libera (testes).
 */
export async function assertPublicUrl(url: URL): Promise<void> {
  // Protocolo vale sempre (até em testes): http só em hostname loopback.
  if (url.protocol === "http:") {
    const host = url.hostname.toLowerCase();
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      throw new Error("webhook exige https (http só em localhost)");
    }
  }
  if (process.env.ALLOW_PRIVATE_WEBHOOKS === "1") return; // pula só o DNS (testes)
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(url.hostname, { all: true });
  } catch {
    throw new Error("hostname não resolve");
  }
  for (const a of addrs) {
    const blocked = a.address.includes(":") ? isBlockedV6(a.address) : isBlockedV4(a.address);
    if (blocked) throw new Error("webhook para IP privado/loopback bloqueado (SSRF)");
  }
}

function parseList(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** http em hostname não-local é rejeitado; https sempre passa no protocolo. */
export async function createWebhook(
  input: { url: string; events?: WebhookEvent[]; printerIds?: string[] },
  creatorAgentId: string | null = null,
  database?: Database.Database,
): Promise<WebhookWithSecret> {
  const db = dbOf(database);
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error("url inválida");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("webhook exige https (http só em localhost)");
  }
  // B2 anti-SSRF: resolve o hostname e rejeita IP privado/loopback/link-local,
  // salvo ALLOW_PRIVATE_WEBHOOKS=1 (testes/dev local).
  await assertPublicUrl(url);
  const id = `wh_${randomBytes(8).toString("hex")}`;
  const secret = randomBytes(32).toString("hex");
  const events = input.events?.length ? input.events : [...ALL_EVENTS];
  for (const e of events) {
    if (!ALL_EVENTS.includes(e)) throw new Error(`evento desconhecido: ${e}`);
  }
  db.prepare("INSERT INTO webhooks (id, url, secret, events, printer_ids, agent_id) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    url.toString(),
    secret, // guardado em claro: assinar HMAC exige o valor original (como Stripe)
    JSON.stringify(events),
    JSON.stringify(input.printerIds ?? []),
    creatorAgentId,
  );
  return { id, url: url.toString(), secret, events, printerIds: input.printerIds ?? [], agentId: creatorAgentId };
}

export function listWebhooks(database?: Database.Database): Webhook[] {
  const rows = dbOf(database)
    .prepare("SELECT id, url, events, printer_ids, agent_id FROM webhooks ORDER BY created_at ASC")
    .all() as Array<{ id: string; url: string; events: string; printer_ids: string; agent_id: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    events: parseList(r.events) as WebhookEvent[],
    printerIds: parseList(r.printer_ids),
    agentId: r.agent_id ?? null,
  }));
}

export function deleteWebhook(id: string, database?: Database.Database): boolean {
  return dbOf(database).prepare("DELETE FROM webhooks WHERE id = ?").run(id).changes > 0;
}

export interface WebhookEventPayload {
  event: WebhookEvent;
  job: {
    id: string;
    orderId: string | null;
    printerId: string;
    status: string;
    attempts: number;
    lastError: string | null;
  };
  timestamp: string;
}

export interface PrinterEventPayload {
  event: WebhookEvent;
  printer: { agentId: string; agentLabel: string; name: string; isDefault: boolean; lastSeenAt: string };
  timestamp: string;
}

function buildJobPayload(job: PrintJob, event: WebhookEvent): WebhookEventPayload {
  return {
    event,
    job: {
      id: job.id,
      orderId: job.orderId,
      printerId: job.printerId,
      status: job.status,
      attempts: job.attempts,
      lastError: job.lastError,
    },
    timestamp: new Date().toISOString(),
  };
}

/** Filtra assinantes (isolamento por loja + filtro opcional de impressora) e grava as entregas. */
function enqueueDeliveries(
  db: Database.Database,
  event: WebhookEvent,
  agentId: string | null,
  printerId: string,
  payload: unknown,
): number {
  const subs = listWebhooks(db).filter(
    (w) =>
      w.events.includes(event) &&
      (w.printerIds.length === 0 || w.printerIds.includes(printerId)) &&
      (w.agentId === null || w.agentId === agentId),
  );
  const now = new Date().toISOString();
  const body = JSON.stringify(payload);
  const insert = db.prepare(
    "INSERT INTO webhook_deliveries (id, webhook_id, event, payload, next_attempt_at) VALUES (?, ?, ?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const w of subs) {
      insert.run(`wd_${randomBytes(8).toString("hex")}`, w.id, event, body, now);
    }
  });
  tx();
  return subs.length;
}

/** Enfileira entregas (isolamento: webhook da loja A nunca vê job da loja B). */
export function dispatchJobEvent(job: PrintJob, event: WebhookEvent, database?: Database.Database): number {
  const db = dbOf(database);
  return enqueueDeliveries(db, event, job.agentId, job.printerId, buildJobPayload(job, event));
}

interface PrinterRow {
  id: string;
  agent_id: string;
  agent_label: string;
  name: string;
  is_default: number;
  status: string;
  last_seen_at: string;
  last_alert_status: string | null;
}

/**
 * Varre as impressoras e dispara printer.offline/printer.online só na
 * transição de estado (não a cada sweep) — mesmo critério de offline do
 * GET /printers (derivedStatus). Chamado pelo sweeper periódico do app.
 */
export function checkPrinterAlerts(database?: Database.Database): number {
  const db = dbOf(database);
  const rows = db
    .prepare(
      `SELECT p.id, p.agent_id, a.label as agent_label, p.name, p.is_default, p.status,
              p.last_seen_at, p.last_alert_status
       FROM printers p JOIN agents a ON a.id = p.agent_id`,
    )
    .all() as PrinterRow[];
  const now = Date.now();
  let fired = 0;
  const setAlertStatus = db.prepare("UPDATE printers SET last_alert_status = ? WHERE id = ?");
  for (const p of rows) {
    const derived = now - Date.parse(p.last_seen_at) > OFFLINE_AFTER_MS ? "offline" : p.status;
    const wasOffline = p.last_alert_status === "offline";
    const isOffline = derived === "offline";
    // Baseline (coluna nova/nunca avaliada): grava sem alertar.
    if (p.last_alert_status !== null && wasOffline !== isOffline) {
      const event: WebhookEvent = isOffline ? "printer.offline" : "printer.online";
      const payload: PrinterEventPayload = {
        event,
        printer: {
          agentId: p.agent_id, agentLabel: p.agent_label, name: p.name,
          isDefault: p.is_default === 1, lastSeenAt: p.last_seen_at,
        },
        timestamp: new Date().toISOString(),
      };
      fired += enqueueDeliveries(db, event, p.agent_id, p.name, payload);
    }
    setAlertStatus.run(derived, p.id);
  }
  return fired;
}

const CLAIM_LEASE_MS = 5 * 60_000; // dono do claim tem 5min p/ POST (timeout é 8s)

/**
 * Tenta entregar o que venceu. Chamado após dispatch e pelo sweeper do app.
 * B1: claim atômico por lease (UPDATE ... WHERE pending AND due RETURNING) —
 * dois sweepers nunca entregam a mesma linha em duplicata.
 */
export async function deliverDue(limit = 20, database?: Database.Database): Promise<{ delivered: number; failed: number }> {
  const db = dbOf(database);
  const now = new Date().toISOString();
  const ids = db
    .prepare(
      `SELECT id FROM webhook_deliveries
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(now, limit) as Array<{ id: string }>;
  const claim = db.prepare(
    `UPDATE webhook_deliveries SET next_attempt_at = ?
     WHERE id = ? AND status = 'pending' AND next_attempt_at <= ?
     RETURNING id, webhook_id, event, payload, attempts`,
  );
  let delivered = 0;
  let failed = 0;
  for (const { id } of ids) {
    const lease = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
    const at = new Date().toISOString();
    const owned = claim.get(lease, id, at) as
      | { id: string; webhook_id: string; event: string; payload: string; attempts: number }
      | undefined;
    if (!owned) continue; // outro worker reivindicou — sem duplicata
    const sub = db
      .prepare("SELECT url, secret FROM webhooks WHERE id = ?")
      .get(owned.webhook_id) as { url: string; secret: string } | undefined;
    if (!sub) {
      db.prepare("UPDATE webhook_deliveries SET status = 'dead', last_error = 'webhook removido' WHERE id = ?").run(id);
      failed += 1;
      continue;
    }
    // Revalida destino a cada entrega (DNS rebinding): bloqueado => dead imediato.
    try {
      await assertPublicUrl(new URL(sub.url));
    } catch (e) {
      db.prepare("UPDATE webhook_deliveries SET status = 'dead', last_error = ? WHERE id = ?").run(
        `SSRF bloqueado: ${(e as Error).message}`.slice(0, 500), id,
      );
      failed += 1;
      continue;
    }
    const err = await postWebhook(sub.url, sub.secret, owned.event, owned.payload);
    if (err === null) {
      db.prepare("UPDATE webhook_deliveries SET status = 'delivered', attempts = attempts + 1 WHERE id = ?").run(id);
      delivered += 1;
    } else {
      const attempts = owned.attempts + 1;
      if (attempts > RETRY_DELAYS_MS.length) {
        db.prepare("UPDATE webhook_deliveries SET status = 'dead', attempts = ?, last_error = ? WHERE id = ?").run(
          attempts, err, id,
        );
      } else {
        const next = new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]).toISOString();
        db.prepare("UPDATE webhook_deliveries SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?").run(
          attempts, next, err, id,
        );
      }
      failed += 1;
    }
  }
  return { delivered, failed };
}

async function postWebhook(url: string, secret: string, event: string, payload: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual", // fetch segue 302 por padrão: URL pública redirecionando p/ metadata = SSRF
      headers: {
        "Content-Type": "application/json",
        "x-printbridge-event": event,
        "x-printbridge-signature": signPayload(secret, payload),
      },
      body: payload,
      signal: ctrl.signal,
    });
    if (res.status >= 300 && res.status < 400) return `redirect bloqueado (HTTP ${res.status})`;
    if (!res.ok) return `HTTP ${res.status}`;
    return null;
  } catch (e) {
    return (e as Error).message.slice(0, 500);
  } finally {
    clearTimeout(t);
  }
}

/** Sweeper periódico — entrega webhooks pendentes + detecta impressora offline/online. */
export function startWebhookSweeper(intervalMs = 15_000): () => void {
  const timer = setInterval(() => {
    deliverDue().catch((e) => console.error("[webhooks] sweeper", (e as Error).message));
    try {
      checkPrinterAlerts();
    } catch (e) {
      console.error("[webhooks] printer-alerts", (e as Error).message);
    }
  }, intervalMs);
  if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }
  return () => clearInterval(timer);
}
