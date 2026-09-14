import { Router, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getDb } from "../infra/db.js";
import {
  InvalidTransitionError,
  JobConflictError,
  JobNotFoundError,
  PayloadTooLargeError,
  PrintJobRepository,
} from "../infra/printJobRepository.js";
import { createAgent, hashToken, listAgents, revokeAgent } from "../infra/tokenStore.js";
import { agentAuth, agentOrOwnerAuth, isOwner, ownerAuth, type AuthedRequest } from "../middleware/auth.js";
import type { PrintJob } from "../domain/printJob.js";
import type { PrintProvider } from "../services/provider.js";
import {
  createWebhook,
  deleteWebhook,
  deliverDue,
  dispatchJobEvent,
  listWebhooks,
  OFFLINE_AFTER_MS,
  type WebhookEvent,
} from "../services/webhooks.js";

/** Dispara webhooks sem bloquear a resposta (log + retry ficam no sweeper). */
function notify(job: Parameters<typeof dispatchJobEvent>[0], event: WebhookEvent): void {
  try {
    dispatchJobEvent(job, event);
  } catch (e) {
    console.error("[webhooks] dispatch", (e as Error).message);
    return;
  }
  deliverDue().catch((e) => console.error("[webhooks] deliver", (e as Error).message));
}

const enqueueSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  orderId: z.string().max(128).optional().nullable(),
  payloadType: z.enum(["pdf", "raw"]),
  payloadBase64: z.string().min(1).max(7_000_000),
  printerId: z.string().min(1).max(256),
  copies: z.number().int().min(1).max(10).default(1),
  paperWidth: z.number().int().refine((v) => v === 58 || v === 80, "paperWidth deve ser 58 ou 80").default(80),
});

const statusSchema = z.object({
  status: z.enum(["received", "printing", "completed", "failed", "pending"]),
  errorMessage: z.string().max(2000).optional().nullable(),
});

const printersSyncSchema = z.object({
  printers: z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        isDefault: z.boolean().default(false),
        status: z.enum(["ready", "offline", "error"]).default("ready"),
      }),
    )
    .min(1)
    .max(32),
});

const webhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z
    .array(z.enum([
      "job.created", "job.received", "job.printing", "job.completed", "job.failed", "job.requeued",
      "printer.offline", "printer.online",
    ]))
    .max(8)
    .optional(),
  printerIds: z.array(z.string().min(1).max(256)).max(32).optional(),
});

export function printAgentRouter(provider: PrintProvider): Router {
  const r = Router();
  const repo = new PrintJobRepository();

  /**
   * Isolamento por loja: job de outra loja (ou inexistente) => 404 idêntico,
   * sem vazar existência. Owner não passa por aqui (rotas owner são separadas).
   */
  const ownedOr404 = (req: AuthedRequest, res: Response): PrintJob | null => {
    const job = repo.getById(req.params.id);
    if (!job || (job.agentId !== null && job.agentId !== req.agentId)) {
      res.status(404).json({ error: "not found" });
      return null;
    }
    return job;
  };

  // Enroll — dono via sessão rotativa ou chave owner (B1: comparação constante).
  r.post("/enroll", (req, res) => {
    if (!isOwner(req)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const label = z.object({ label: z.string().min(1).max(128) })
      .safeParse(req.body);
    if (!label.success) {
      res.status(400).json({ error: label.error.flatten() });
      return;
    }
    const token = `pb_${randomBytes(24).toString("hex")}`;
    const agent = createAgent(label.data.label, hashToken(token));
    res.status(201).json({ agentId: agent.id, token });
  });

  // ---- Owner (painel admin): antes do agentAuth ----
  r.get("/agents", ownerAuth, (_req, res) => {
    res.json({ agents: listAgents() });
  });

  r.delete("/agents/:id", ownerAuth, (req, res) => {
    if (!revokeAgent(req.params.id)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(204).end();
  });

  r.get("/jobs/recent", ownerAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 30), 100);
    res.json({ jobs: repo.listRecent(Number.isFinite(limit) ? limit : 30) });
  });

  r.get("/printers/all", ownerAuth, (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT p.name, p.is_default as isDefault, p.status, p.last_seen_at as lastSeenAt, a.label as agent
         FROM printers p JOIN agents a ON a.id = p.agent_id ORDER BY a.label, p.name`,
      )
      .all() as Array<{ name: string; isDefault: number; status: string; lastSeenAt: string; agent: string }>;
    const now = Date.now();
    res.json({
      printers: rows.map((p) => ({
        agent: p.agent,
        name: p.name,
        isDefault: p.isDefault === 1,
        derivedStatus: now - Date.parse(p.lastSeenAt) > OFFLINE_AFTER_MS ? "offline" : p.status,
        lastSeenAt: p.lastSeenAt,
      })),
    });
  });

  // Webhooks: bearer da loja OU chave owner (painel) — antes do agentAuth.
  r.post("/webhooks", agentOrOwnerAuth, async (req: AuthedRequest, res) => {
    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const wh = await createWebhook(parsed.data, req.agentId ?? null);
      res.status(201).json({ webhook: wh });
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  });

  r.get("/webhooks", agentOrOwnerAuth, (req: AuthedRequest, res) => {
    const all = listWebhooks();
    // Owner vê tudo; loja vê os globais + os seus (nunca os da vizinha).
    const visible = req.agentId ? all.filter((w) => w.agentId === null || w.agentId === req.agentId) : all;
    res.json({ webhooks: visible.map(({ agentId: _o, ...w }) => w) });
  });

  r.delete("/webhooks/:id", agentOrOwnerAuth, (req: AuthedRequest, res) => {
    if (req.agentId) {
      const target = listWebhooks().find((w) => w.id === req.params.id);
      if (!target || target.agentId !== req.agentId) {
        res.status(404).json({ error: "not found" });
        return;
      }
    }
    if (!deleteWebhook(req.params.id)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(204).end();
  });

  r.use(agentAuth);

  // Quem sou eu: o agente confirma a loja dona do token (exibido no setup).
  r.get("/me", (req: AuthedRequest, res) => {
    const db = getDb();
    const row = db.prepare("SELECT id, label FROM agents WHERE id = ?").get(req.agentId!) as
      | { id: string; label: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ agent: row });
  });

  // Enfileirar (idempotente por idempotencyKey).
  // Nota: mesma key + payload diferente retorna o job original (dedupe intencional).
  // O job nasce com o dono = bearer chamador (isolamento por loja).
  r.post("/jobs", (req: AuthedRequest, res) => {
    const parsed = enqueueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const { job, deduplicated } = provider.submit({ ...parsed.data, agentId: req.agentId ?? null });
      if (!deduplicated) notify(job, "job.created");
      res.status(deduplicated ? 200 : 201).json({ job, deduplicated });
    } catch (e) {
      // B2: nunca vaza mensagem interna crua — mapeia conhecidas, resto é genérico.
      console.error("[print-agent] POST /jobs", e);
      if (e instanceof PayloadTooLargeError) {
        res.status(422).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: "internal error" });
    }
  });

  // Polling fallback (10s no agente) — só jobs da própria loja.
  r.get("/jobs", (req: AuthedRequest, res) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 50);
    res.json({ jobs: repo.listPending(Number.isFinite(limit) ? limit : 20, req.agentId) });
  });

  r.get("/jobs/:id", (req: AuthedRequest, res) => {
    const job = ownedOr404(req, res);
    if (!job) return;
    res.json({ job });
  });

  // Claim atômico — 404 se não existe (ou é de outra loja), 409 se já reivindicado.
  r.post("/jobs/:id/claim", (req: AuthedRequest, res) => {
    const existing = ownedOr404(req, res);
    if (!existing) return;
    const claimed = repo.claim(req.params.id);
    if (!claimed) {
      res.status(409).json({ error: "job já reivindicado ou estado inválido" });
      return;
    }
    notify(claimed, "job.received");
    res.json({ job: claimed });
  });

  r.patch("/jobs/:id", (req: AuthedRequest, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      // Claim implícito: pending->received via PATCH usa o mesmo CAS do claim().
      if (parsed.data.status === "received") {
        const current = ownedOr404(req, res);
        if (!current) return;
        if (current.status === "pending") {
          const claimed = repo.claim(current.id);
          if (!claimed) {
            res.status(409).json({ error: "race: job já reivindicado" });
            return;
          }
          notify(claimed, "job.received");
          res.json({ job: claimed });
          return;
        }
      }
      // Dono verificado antes de qualquer transição (isolamento por loja).
      const current = ownedOr404(req, res);
      if (!current) return;
      const job = repo.transition(
        req.params.id,
        parsed.data.status,
        parsed.data.errorMessage ?? null,
      );
      notify(job, job.status === "pending" ? "job.requeued" : `job.${job.status}` as WebhookEvent);
      res.json({ job });
    } catch (e) {
      // B2: mapeia erros de domínio, resto é genérico + log.
      if (e instanceof JobNotFoundError) {
        res.status(404).json({ error: "not found" });
        return;
      }
      if (e instanceof JobConflictError) {
        res.status(409).json({ error: e.message });
        return;
      }
      if (e instanceof InvalidTransitionError) {
        res.status(422).json({ error: e.message });
        return;
      }
      console.error("[print-agent] PATCH /jobs/:id", e);
      res.status(500).json({ error: "internal error" });
    }
  });

  // Sync impressoras + heartbeat
  r.post("/printers/sync", (req: AuthedRequest, res) => {
    const parsed = printersSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const db = getDb();
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const p of parsed.data.printers) {
        const id = `${req.agentId}:${p.name}`;
        db.prepare(
          `INSERT INTO printers (id, agent_id, name, is_default, status, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             is_default = excluded.is_default,
             status = excluded.status,
             last_seen_at = excluded.last_seen_at`,
        ).run(id, req.agentId!, p.name, p.isDefault ? 1 : 0, p.status, now);
      }
      if (parsed.data.printers.some((p) => p.isDefault)) {
        // Garante um único default por agente.
        const def = parsed.data.printers.find((p) => p.isDefault)!.name;
        db.prepare(
          `UPDATE printers SET is_default = CASE WHEN name = ? THEN 1 ELSE 0 END
           WHERE agent_id = ?`,
        ).run(def, req.agentId!);
      }
    });
    tx();
    res.json({ ok: true, synced: parsed.data.printers.length });
  });

  r.get("/printers", (req: AuthedRequest, res) => {
    const db = getDb();
    const rows = db
      .prepare("SELECT id, name, is_default as isDefault, status, last_seen_at as lastSeenAt FROM printers WHERE agent_id = ?")
      .all(req.agentId!) as Array<{
        id: string; name: string; isDefault: number; status: string; lastSeenAt: string;
      }>;
    const now = Date.now();
    const printers = rows.map((p) => ({
      ...p,
      isDefault: p.isDefault === 1,
      // Offline derivado do heartbeat (90s sem sync) — mesma semântica do selectedState().
      derivedStatus:
        now - Date.parse(p.lastSeenAt) > OFFLINE_AFTER_MS ? "offline" : p.status,
    }));
    res.json({ printers });
  });

  return r;
}
