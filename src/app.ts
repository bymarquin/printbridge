import cors from "cors";
import express from "express";
import { getDb } from "./infra/db.js";
import { printAgentRouter } from "./routes/printAgent.js";
import { LocalQueueProvider } from "./services/localQueueProvider.js";
import { openApiDocument } from "./openapi.js";
import { ADMIN_HTML } from "./admin.js";
import { startWebhookSweeper } from "./services/webhooks.js";

export type Broadcaster = (jobId: string, agentId?: string | null) => void;

export function createApp(onEnqueue?: Broadcaster, opts: { webhookSweeper?: boolean } = {}) {
  getDb(); // garante migrate
  const app = express();
  // API pública p/ sistemas web de qualquer origem: libera CORS total.
  // Auth continua por bearer owner/agent — origem aberta não é permissão.
  app.use(cors());
  app.use(express.json({ limit: "8mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "printbridge", version: "0.1.0" });
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });

  app.get("/app/admin", (_req, res) => {
    res.type("html").send(ADMIN_HTML);
  });

  const provider = new LocalQueueProvider(onEnqueue);
  app.use("/print-agent", printAgentRouter(provider));

  if (opts.webhookSweeper) startWebhookSweeper();

  // 404 + handler central (nunca silencia erro — revisor #5)
  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[printbridge]", err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
