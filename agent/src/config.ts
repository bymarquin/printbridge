import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** Servidor oficial — o agente já nasce apontando para o PrintBridge. */
export const DEFAULT_API_URL = "https://printbridge.duckdns.org";

const configSchema = z.object({
  apiBaseUrl: z.string().url().default(DEFAULT_API_URL),
  token: z.string().default(""),
  pollIntervalMs: z.coerce.number().int().min(2000).default(10000),
  dbPath: z.string().default("./data/agent.db"),
  defaultPrinter: z.string().optional(),
});

export type AgentConfig = z.infer<typeof configSchema>;

const fileSchema = configSchema.partial();

export type FileConfig = z.infer<typeof fileSchema>;

/** Onde o instalador/assistente grava — sobrevive a reinstall (fora do AppData deletável). */
export function configFilePath(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const base = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "PrintBridge Agent", "config.json");
  }
  return path.join(os.homedir(), ".config", "printbridge-agent", "config.json");
}

/** Lê o arquivo se existir; null = primeira execução (abre o assistente). */
export function loadFileConfig(filePath: string = configFilePath()): FileConfig | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return fileSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveFileConfig(partial: FileConfig, filePath: string = configFilePath()): string {
  const current = loadFileConfig(filePath) ?? {};
  const merged = fileSchema.parse({ ...current, ...partial });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return filePath;
}

/** Env (legado/CI) tem precedência sobre o arquivo. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return configSchema.parse({
    apiBaseUrl: env.PRINTBRIDGE_API ?? DEFAULT_API_URL,
    token: env.PRINT_AGENT_TOKEN ?? "",
    pollIntervalMs: env.POLL_INTERVAL_MS ?? 10000,
    dbPath: env.AGENT_DB ?? "./data/agent.db",
    defaultPrinter: env.DEFAULT_PRINTER,
  });
}

/** Config efetiva: arquivo + env por cima (usada pelo CLI e pelo Electron). */
export function loadEffectiveConfig(
  env: NodeJS.ProcessEnv = process.env,
  filePath: string = configFilePath(),
): AgentConfig {
  const file = loadFileConfig(filePath) ?? {};
  const fromEnv: Record<string, unknown> = {};
  if (env.PRINTBRIDGE_API) fromEnv.apiBaseUrl = env.PRINTBRIDGE_API;
  if (env.PRINT_AGENT_TOKEN) fromEnv.token = env.PRINT_AGENT_TOKEN;
  if (env.POLL_INTERVAL_MS) fromEnv.pollIntervalMs = env.POLL_INTERVAL_MS;
  if (env.AGENT_DB) fromEnv.dbPath = env.AGENT_DB;
  if (env.DEFAULT_PRINTER) fromEnv.defaultPrinter = env.DEFAULT_PRINTER;
  return configSchema.parse({ ...file, ...fromEnv });
}

const enrollResponse = z.object({ agentId: z.string(), token: z.string().min(1) });

/** Troca (setupKey + label) pelo token do agente — usado pelo assistente e pelo CLI --setup. */
export async function enrollAgent(
  apiBaseUrl: string,
  setupKey: string,
  label: string,
  timeoutMs = 15000,
): Promise<{ agentId: string; token: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/print-agent/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-setup-key": setupKey },
      body: JSON.stringify({ label }),
      signal: ctrl.signal,
    });
    if (res.status === 403) throw new Error("chave de instalação inválida (x-setup-key)");
    if (!res.ok) throw new Error(`enroll falhou: HTTP ${res.status}`);
    return enrollResponse.parse(await res.json());
  } finally {
    clearTimeout(t);
  }
}
