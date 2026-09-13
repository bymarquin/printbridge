import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { createApp } from "./app.js";
import { findAgentByToken } from "./infra/tokenStore.js";
import { PrintJobRepository } from "./infra/printJobRepository.js";

const PORT = Number(process.env.PORT ?? 3001);

const clients = new Set<WebSocket>();
const broadcast = (jobId: string) => {
  const msg = JSON.stringify({ type: "new-job", jobId });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
};

const app = createApp(broadcast);
const server = createServer(app);

const wss = new WebSocketServer({ server, path: "/print-agent/ws" });
wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const token = url.searchParams.get("token") ?? "";
  if (!findAgentByToken(token)) {
    ws.close(4401, "unauthorized");
    return;
  }
  clients.add(ws);
  // Entrega imediata do backlog para o agente que acabou de conectar.
  const pending = new PrintJobRepository().listPending(20);
  ws.send(JSON.stringify({ type: "backlog", jobs: pending.map((j) => j.id) }));
  ws.on("close", () => clients.delete(ws));
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
