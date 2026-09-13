import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

export interface PrintTask {
  payloadType: "pdf" | "raw";
  payloadBase64: string;
  printerName: string;
  copies: number;
}

export interface PrintExecutor {
  execute(task: PrintTask): Promise<void>;
}

function execTimeout(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, _o, stderr) => {
      if (err) reject(new Error(`impressão falhou: ${(stderr || err.message).slice(0, 1000)}`));
      else resolve();
    });
  });
}

/**
 * Executor real Windows:
 * - PDF via pdf-to-printer (lazy import — só no win32, evita peso no dev Mac/Linux).
 * - RAW (ESC/POS/ZPL) via spool: grava .bin e imprime com cópias.
 */
export class WindowsPrintExecutor implements PrintExecutor {
  constructor(private readonly timeoutMs = 30_000) {}

  async execute(task: PrintTask): Promise<void> {
    if (process.platform !== "win32") {
      throw new Error("executor Windows indisponível nesta plataforma");
    }
    const buf = Buffer.from(task.payloadBase64, "base64");
    if (buf.length === 0 || buf.length > 25 * 1024 * 1024) {
      throw new Error("payload inválido ou excede 25MB");
    }
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pb-"));
    try {
      if (task.payloadType === "pdf") {
        const file = path.join(tmp, "job.pdf");
        await fs.writeFile(file, buf);
        // Lazy: pacote Windows-only, ausente no dev Mac/Linux até npm install.
        const { print } = await import("pdf-to-printer").catch(() => {
          throw new Error("pdf-to-printer ausente — rode no Windows com as dependencies instaladas");
        });
        await print(file, { printer: task.printerName, copies: task.copies, silent: true });
      } else {
        // RAW: ESC/POS ou ZPL direto no spool via PowerShell Out-Printer (bytes).
        const file = path.join(tmp, "job.bin");
        await fs.writeFile(file, buf);
        for (let i = 0; i < task.copies; i++) {
          await execTimeout(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command",
              `Get-Content -Raw -AsByteStream '${file}' | Out-Printer -Name '${task.printerName.replace(/'/g, "''")}'`],
            this.timeoutMs,
          );
        }
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
}
