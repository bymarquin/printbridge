import { z } from "zod";
import type { AgentConfig } from "../config.js";

const jobSchema = z.object({
  id: z.string(),
  payloadType: z.enum(["pdf", "raw"]),
  payloadBase64: z.string(),
  printerId: z.string(),
  copies: z.number().int().min(1).max(10).default(1),
});

export type RemoteJob = z.infer<typeof jobSchema>;

function headers(cfg: AgentConfig): HeadersInit {
  return { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" };
}

async function req(path: string, cfg: AgentConfig, init?: RequestInit, timeoutMs = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.apiBaseUrl}${path}`, { ...init, headers: headers(cfg), signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function pollPendingJobs(cfg: AgentConfig, limit = 20): Promise<RemoteJob[]> {
  const res = await req(`/print-agent/jobs?limit=${limit}`, cfg);
  if (!res.ok) throw new Error(`poll falhou: HTTP ${res.status}`);
  const data = (await res.json()) as { jobs: unknown[] };
  return z.array(jobSchema).parse(data.jobs);
}

export async function reportStatus(
  cfg: AgentConfig,
  jobId: string,
  status: "received" | "printing" | "completed" | "failed" | "pending",
  errorMessage?: string,
): Promise<void> {
  const res = await req(`/print-agent/jobs/${jobId}`, cfg, {
    method: "PATCH",
    body: JSON.stringify({ status, errorMessage: errorMessage?.slice(0, 2000) }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`report falhou: HTTP ${res.status}`);
  }
  // 409 = race benigna (outro worker reivindicou) — não é erro fatal.
}

export async function syncPrinters(
  cfg: AgentConfig,
  printers: Array<{ name: string; isDefault: boolean; status: string }>,
): Promise<void> {
  const res = await req(`/print-agent/printers/sync`, cfg, {
    method: "POST",
    body: JSON.stringify({ printers }),
  });
  if (!res.ok) throw new Error(`sync printers falhou: HTTP ${res.status}`);
}
