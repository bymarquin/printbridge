import { execFile } from "node:child_process";

const FAILURES_BEFORE_HEAL = 3;
const HEAL_COOLDOWN_MS = 10 * 60_000;

/**
 * Auto-cura do spooler do Windows: N falhas seguidas de impressão
 * disparam um restart do serviço de spool (fila travada é a causa
 * mais comum de falhas genéricas repetidas). Com cooldown para não
 * entrar em loop, e no-op fora do Windows.
 */
export class SpoolerHealer {
  private consecutive = 0;
  private lastHeal = 0;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly run: (cmd: string, args: string[], timeoutMs: number) => Promise<void> = defaultRun,
  ) {}

  recordSuccess(): void {
    this.consecutive = 0;
  }

  /** Retorna true quando é hora de tentar curar. */
  recordFailure(): boolean {
    this.consecutive += 1;
    return this.consecutive >= FAILURES_BEFORE_HEAL;
  }

  async heal(log: (msg: string) => void = console.log): Promise<boolean> {
    if (this.platform !== "win32") return false;
    if (Date.now() - this.lastHeal < HEAL_COOLDOWN_MS) {
      log("[healer] cooldown — pulando restart do spooler");
      return false;
    }
    this.lastHeal = Date.now();
    this.consecutive = 0;
    try {
      // Restart não limpa jobs, só destrava o serviço.
      await this.run("net", ["stop", "spooler"], 20_000);
      await this.run("net", ["start", "spooler"], 20_000);
      log("[healer] spooler reiniciado após falhas consecutivas");
      return true;
    } catch (e) {
      log(`[healer] restart do spooler falhou: ${(e as Error).message}`);
      return false;
    }
  }
}

function defaultRun(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, _o, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(0, 500)));
      else resolve();
    });
  });
}
