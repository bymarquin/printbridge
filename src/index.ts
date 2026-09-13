import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { createApp } from "./app.js";
import { findAgentByToken } from "./infra/tokenStore.js";
import { PrintJobRepository } from "./infra/printJobRepository.js";

const PORT = Number(process.env.PORT ?? 3001);

const clients = new Map<string, Set<WebSocket>>();
const broadcast = (jobId: string, agentId?: string | null) => {
  const msg = JSON.stringify({ type: "new-job", jobId });
  const targets = agentId ? [clients.get(agentId)] : [...clients.values()];
  for (const set of targets) {
    if (!set) continue;
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
};

const app = createApp(broadcast, { webhookSweeper: true });
const server = createServer(app);

const wss = new WebSocketServer({ server, path: "/print-agent/ws" });
wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const token = url.searchParams.get("token") ?? "";
  const agent = findAgentByToken(token);
  if (!agent) {
    ws.close(4401, "unauthorized");
    return;
  }
  if (!clients.has(agent.id)) clients.set(agent.id, new Set());
  clients.get(agent.id)!.add(ws);
  // Backlog só da própria loja.
  const pending = new PrintJobRepository().listPending(20, agent.id);
  ws.send(JSON.stringify({ type: "backlog", jobs: pending.map((j) => j.id) }));
  ws.on("close", () => clients.get(agent.id)?.delete(ws));
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(String(data));
      if (msg?.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    } catch {
      // ignora frame inválido sem derrubar conexão
    }
  });
});

server.listen(PORT, () => {
  console.log(`[printbridge] http://localhost:${PORT}`);
});
