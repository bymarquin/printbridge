import express from "express";
import { getDb } from "./infra/db.js";
import { printAgentRouter } from "./routes/printAgent.js";
import { LocalQueueProvider } from "./services/localQueueProvider.js";

export type Broadcaster = (jobId: string) => void;

export function createApp(onEnqueue?: Broadcaster) {
  getDb(); // garante migrate
  const app = express();
  app.use(express.json({ limit: "8mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "printbridge", version: "0.1.0" });
  });

  const provider = new LocalQueueProvider(onEnqueue);
  app.use("/print-agent", printAgentRouter(provider));

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
