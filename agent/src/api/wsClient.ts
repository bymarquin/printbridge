import WebSocket from "ws";
import type { AgentConfig } from "../config.js";

/**
 * WS com reconnect exponencial + jitter.
 * Dedupe garantido pela fila local (upsert por jobId).
 */
export class AgentWs {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly onNewJob: (jobId: string) => void,
    private readonly onBacklog?: (ids: string[]) => void,
  ) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
  }

  private connect(): void {
    if (this.closed) return;
    const url = `${this.cfg.apiBaseUrl.replace(/^http/, "ws")}/print-agent/ws?token=${encodeURIComponent(this.cfg.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => {
      this.attempt = 0;
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type: string; jobId?: string; jobs?: string[] };
        if (msg.type === "new-job" && msg.jobId) this.onNewJob(msg.jobId);
        else if (msg.type === "backlog" && msg.jobs) this.onBacklog?.(msg.jobs);
      } catch {
        // frame inválido — ignora sem derrubar
      }
    });
    ws.on("close", () => this.scheduleReconnect());
    ws.on("error", () => ws.close());
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.attempt += 1;
    const delay = Math.min(1000 * 2 ** Math.min(this.attempt, 6), 30000) + Math.random() * 500;
    setTimeout(() => this.connect(), delay);
  }
}
