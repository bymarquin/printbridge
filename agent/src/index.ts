import { pathToFileURL } from "node:url";
import { enrollAgent, loadConfig, loadEffectiveConfig, saveFileConfig } from "./config.js";
import { pollPendingJobs, reportStatus, syncPrinters } from "./api/client.js";
import { AgentWs } from "./api/wsClient.js";
import { LocalQueue } from "./infra/localQueue.js";
import { WindowsPrinterLister, type OsPrinter } from "./printers/windowsPrinters.js";
import { WindowsPrintExecutor } from "./printers/printExecutor.js";
import { resolvePrinter } from "./printers/resolvePrinter.js";
import { SpoolerHealer } from "./printers/spoolerHealer.js";

const HEARTBEAT_MS = 30_000;

export interface TickDeps {
  executor?: { execute(args: { payloadType: "pdf" | "raw"; payloadBase64: string; printerName: string; copies: number }): Promise<void> };
  poll?: typeof pollPendingJobs;
  report?: typeof reportStatus;
  /** Resolve destino final; default: nome do job ou defaultPrinter. */
  resolvePrinter?: (printerId: string) => string;
  onPrintSuccess?: () => void;
  onPrintError?: (message: string) => void;
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
      // O job manda; com 1 impressora na loja, qualquer nome cai nela (zero mapeamento).
      const resolve = deps.resolvePrinter ?? ((wanted: string) => wanted || cfg.defaultPrinter || "");
      const printer = resolve(local.printerId);
      if (!printer) throw new Error("sem impressora (job sem printerId e sem DEFAULT_PRINTER)");
      await executor.execute({ payloadType: local.payloadType, payloadBase64: local.payloadBase64, printerName: printer, copies: local.copies });
      queue.transition(local.jobId, "completed");
      await report(cfg, local.jobId, "completed").catch((e) =>
        console.error("[agent] report completed", (e as Error).message),
      );
      queue.remove(local.jobId);
      deps.onPrintSuccess?.();
    } catch (e) {
      const msg = (e as Error).message;
      queue.transition(local.jobId, "failed", msg);
      await report(cfg, local.jobId, "failed", msg).catch((err) =>
        console.error("[agent] report failed", (err as Error).message),
      );
      deps.onPrintError?.(msg);
    }
  }
}

export async function heartbeat(
  cfg: ReturnType<typeof loadConfig>,
  lister: { list(): Promise<OsPrinter[]> } = new WindowsPrinterLister(),
): Promise<OsPrinter[]> {
  const printers = await lister.list().catch(() => []);
  if (printers.length === 0) return [];
  await syncPrinters(cfg, printers.map((p) => ({ name: p.name, isDefault: p.isDefault, status: p.status }))).catch((e) =>
    console.error("[agent] heartbeat", (e as Error).message),
  );
  return printers;
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
  lister?: { list(): Promise<OsPrinter[]> };
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
  // Última lista do Windows alimenta a descoberta por prioridade.
  let lastSeen: OsPrinter[] = [];
  const runHeartbeat = async () => {
    const list = await heartbeat(cfg, deps.lister);
    if (list.length > 0) lastSeen = list;
  };
  const healer = new SpoolerHealer();
  let lastTick: string | null = null;
  const pickPrinter = (wanted: string): string =>
    resolvePrinter(wanted, lastSeen, cfg.defaultPrinter, (m) => console.log(`[agent] ${m}`));
  const runTick = async () => {
    await tick(cfg, queue, {
      ...deps,
      resolvePrinter: pickPrinter,
      onPrintSuccess: () => healer.recordSuccess(),
      onPrintError: (msg) => {
        if (healer.recordFailure()) {
          void healer.heal((m) => console.log(m)).then((healed) => {
            if (healed) void runTick(); // tenta de novo após curar
          });
        }
        deps.onPrintError?.(msg);
      },
    });
    lastTick = new Date().toISOString();
  };
  const ws = new AgentWs(cfg, () => void runTick());
  ws.start();
  void runHeartbeat();
  const hbMs = deps.heartbeatMs ?? HEARTBEAT_MS;
  const hb = setInterval(() => void runHeartbeat(), hbMs);
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

// Roda o CLI só quando executado direto (node dist/index.js).
// Importado no Electron (entry) ou nos testes, NÃO executa — senão o app
// se matava no boot antes do assistente abrir.
const isMainEntry =
  !!process.argv[1] &&
  !process.versions.electron &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (process.env.VITEST !== "true" && isMainEntry) void main();
