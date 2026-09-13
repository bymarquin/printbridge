import { enrollAgent, loadConfig, loadEffectiveConfig, saveFileConfig } from "./config.js";
import { pollPendingJobs, reportStatus, syncPrinters } from "./api/client.js";
import { AgentWs } from "./api/wsClient.js";
import { LocalQueue } from "./infra/localQueue.js";
import { WindowsPrinterLister } from "./printers/windowsPrinters.js";
import { WindowsPrintExecutor } from "./printers/printExecutor.js";

const HEARTBEAT_MS = 30_000;

export interface TickDeps {
  executor?: { execute(args: { payloadType: "pdf" | "raw"; payloadBase64: string; printerName: string; copies: number }): Promise<void> };
  poll?: typeof pollPendingJobs;
  report?: typeof reportStatus;
}

export async function tick(cfg: ReturnType<typeof loadConfig>, queue: LocalQueue, deps: TickDeps = {}): Promise<void> {
  const poll = deps.poll ?? pollPendingJobs;
  const report = deps.report ?? reportStatus;
  // 1. Puxa pendentes (polling fallback — WS é otimização, não dependência).
  const remote = await poll(cfg).catch((e) => {
    console.error("[agent] poll", (e as Error).message);
    return [];
  });
  for (const j of remote) {
    queue.upsert({ jobId: j.id, payloadType: j.payloadType, payloadBase64: j.payloadBase64, printerId: j.printerId, copies: j.copies });
  }
  // 2. Executa vencidos da fila local.
  const executor = deps.executor ?? new WindowsPrintExecutor();
  for (const local of queue.nextDue(5)) {
    // Retry explícito: failed só volta ao jogo via failed->pending.
    if (local.status === "failed") {
      const retried = queue.transition(local.jobId, "pending");
      if (!retried) continue;
    }
    const claimed = queue.transition(local.jobId, "received");
    if (!claimed) continue; // retorno é autoritativo — stale/race não executa
    const printing = queue.transition(local.jobId, "printing");
    if (!printing) continue;
    // Espelha o claim no backend (pending->received) antes de printing —
    // sem isso o backend rejeita printing/completed/failed com 422.
    await report(cfg, local.jobId, "received").catch((e) =>
      console.error("[agent] report received", (e as Error).message),
    );
    await report(cfg, local.jobId, "printing").catch((e) =>
      console.error("[agent] report printing", (e as Error).message),
    );
    try {
      // O job manda; default é só fallback se printerId vier vazio.
      const printer = local.printerId || cfg.defaultPrinter;
      if (!printer) throw new Error("sem impressora (job sem printerId e sem DEFAULT_PRINTER)");
      await executor.execute({ payloadType: local.payloadType, payloadBase64: local.payloadBase64, printerName: printer, copies: local.copies });
      queue.transition(local.jobId, "completed");
      await report(cfg, local.jobId, "completed").catch((e) =>
        console.error("[agent] report completed", (e as Error).message),
      );
      queue.remove(local.jobId);
    } catch (e) {
      const msg = (e as Error).message;
      queue.transition(local.jobId, "failed", msg);
      await report(cfg, local.jobId, "failed", msg).catch((err) =>
        console.error("[agent] report failed", (err as Error).message),
      );
    }
  }
}

export async function heartbeat(
  cfg: ReturnType<typeof loadConfig>,
  lister: { list(): Promise<Array<{ name: string; isDefault: boolean; status: string }>> } = new WindowsPrinterLister(),
): Promise<void> {
  const printers = await lister.list().catch(() => []);
  if (printers.length === 0) return;
  await syncPrinters(cfg, printers.map((p) => ({ name: p.name, isDefault: p.isDefault, status: p.status }))).catch((e) =>
    console.error("[agent] heartbeat", (e as Error).message),
  );
}

export interface AgentRuntime {
  stop(): void;
  queue: LocalQueue;
  lastTickAt(): string | null;
  /** Sem jobs em voo — gate do auto-install. */
  isIdle(): boolean;
}

export type StartDeps = TickDeps & {
  heartbeatMs?: number;
  lister?: { list(): Promise<Array<{ name: string; isDefault: boolean; status: string }>> };
};

/** Sobe o núcleo (WS + heartbeat + poll). Usado pelo CLI e pelo shell Electron. */
export function startAgent(
  cfg: ReturnType<typeof loadConfig>,
  deps: StartDeps = {},
): AgentRuntime {
  const queue = new LocalQueue(cfg.dbPath);
  // Reaper de boot: crash/kill/update anterior pode ter preso jobs em voo.
  const requeued = queue.requeueStale(10 * 60_000);
  if (requeued > 0) console.log(`[agent] reaper: ${requeued} job(s) travado(s) -> pending`);
  let lastTick: string | null = null;
  const runTick = async () => {
    await tick(cfg, queue, deps);
    lastTick = new Date().toISOString();
  };
  const ws = new AgentWs(cfg, () => void runTick());
  ws.start();
  void heartbeat(cfg, deps.lister);
  const hbMs = deps.heartbeatMs ?? HEARTBEAT_MS;
  const hb = setInterval(() => void heartbeat(cfg, deps.lister), hbMs);
  void runTick();
  const poll = setInterval(() => void runTick(), cfg.pollIntervalMs);
  console.log(`[agent] rodando -> ${cfg.apiBaseUrl} (poll ${cfg.pollIntervalMs}ms)`);
  return {
    queue,
    lastTickAt: () => lastTick,
    isIdle: () => queue.countActive() === 0,
    stop: () => {
      ws.stop();
      clearInterval(hb);
      clearInterval(poll);
      queue.close();
    },
  };
}

export function parseSetupArgs(argv: string[]): {
  api: string; setupKey: string; label: string; token: string;
} | null {
  if (!argv.includes("--setup")) return null;
  const get = (flag: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : "";
  };
  return {
    api: get("--api"),
    setupKey: get("--setup-key"),
    label: get("--label") || "loja",
    token: get("--token"),
  };
}

/** Instalação sem janela: grava %APPDATA%/PrintBridge Agent/config.json e sai. */
export async function runSetupCli(args: Exclude<ReturnType<typeof parseSetupArgs>, null>): Promise<void> {
  if (!args.api) {
    console.error("Uso: agent --setup --api https://sua-api (--setup-key KEY --label caixa-1 | --token pb_...)");
    process.exit(2);
  }
  const token = args.token || (await enrollAgent(args.api, args.setupKey, args.label)).token;
  const file = saveFileConfig({ apiBaseUrl: args.api, token });
  console.log(`configurado: ${file}`);
}

async function main(): Promise<void> {
  const setup = parseSetupArgs(process.argv.slice(2));
  if (setup) {
    await runSetupCli(setup);
    return;
  }
  const cfg = loadEffectiveConfig();
  if (!cfg.token) {
    console.error("Sem token: rode com --setup ou configure PRINT_AGENT_TOKEN");
    process.exit(1);
  }
  startAgent(cfg);
}

if (process.env.VITEST !== "true") void main();
