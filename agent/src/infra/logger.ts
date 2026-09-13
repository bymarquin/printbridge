import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface Logger {
  info(message: string): void;
  error(message: string, cause?: unknown): void;
}

const MAX_FILE_BYTES = 1_000_000;
const KEEP_FILES = 3;

/**
 * Logger com rotação simples por tamanho.
 * Usa electron-log quando disponível (Electron); senão arquivo próprio + console.
 * `forceFile` existe para os testes exercitarem o fallback mesmo com electron-log instalado.
 */
export function createLogger(tag: string, logDir?: string, opts: { forceFile?: boolean } = {}): Logger {
  if (!opts.forceFile) {
    try {
      const req = createRequire(import.meta.url);
      const el = req("electron-log") as {
        info(...args: unknown[]): void;
        error(...args: unknown[]): void;
      };
      return {
        info: (m) => el.info(`[${tag}]`, m),
        error: (m, c) => el.error(`[${tag}]`, m, c ?? ""),
      };
    } catch {
      // sem electron-log — cai no arquivo próprio abaixo
    }
  }
  const dir = path.resolve(logDir ?? "./logs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tag}.log`);
  const write = (level: string, message: string) => {
    try {
      rotate(file);
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${message}\n`);
    } catch {
      // log nunca derruba o agente
    }
    if (level === "ERROR") console.error(`[${tag}]`, message);
    else console.log(`[${tag}]`, message);
  };
  return { info: (m) => write("INFO", m), error: (m) => write("ERROR", m) };
}

function rotate(file: string): void {
  try {
    const stat = fs.statSync(file);
    if (stat.size < MAX_FILE_BYTES) return;
    for (let i = KEEP_FILES - 1; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      const to = `${file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
  } catch {
    // arquivo ainda não existe — nada a rodar
  }
}

export function logFilePath(tag: string, logDir?: string): string {
  return path.resolve(logDir ?? "./logs", `${tag}.log`);
}
