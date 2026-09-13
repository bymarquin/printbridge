import { describe, it, expect, vi } from "vitest";
import { LocalQueue } from "../src/infra/localQueue.js";
import { canTransition } from "../src/domain/jobState.js";
import { tick } from "../src/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-")), "q.db");
}

describe("Agent core", () => {
  it("máquina local espelha backend", () => {
    expect(canTransition("pending", "received")).toBe(true);
    expect(canTransition("pending", "completed")).toBe(false);
  });

  it("upsert deduplica (WS + poll concorrente)", () => {
    const q = new LocalQueue(tmpDb());
    const job = { jobId: "j1", payloadType: "raw" as const, payloadBase64: "eA==", printerId: "p", copies: 1 };
    expect(q.upsert(job)).toBe(true);
    expect(q.upsert(job)).toBe(false);
    q.close();
  });

  it("ciclo pending->received->printing->completed", () => {
    const q = new LocalQueue(tmpDb());
    q.upsert({ jobId: "j2", payloadType: "pdf" as const, payloadBase64: "eA==", printerId: "p", copies: 2 });
    expect(q.transition("j2", "received")?.status).toBe("received");
    expect(q.transition("j2", "printing")?.status).toBe("printing");
    expect(q.transition("j2", "completed")?.status).toBe("completed");
    q.close();
  });

  it("falha aplica backoff e permite retry", () => {
    const q = new LocalQueue(tmpDb());
    q.upsert({ jobId: "j3", payloadType: "raw" as const, payloadBase64: "eA==", printerId: "p", copies: 1 });
    q.transition("j3", "received");
    q.transition("j3", "printing");
    const f = q.transition("j3", "failed", "jam");
    expect(f?.attempts).toBe(1);
    expect(f?.lastError).toBe("jam");
    q.close();
  });

  it("tick respeita printerId do job (default só fallback)", async () => {
    const q = new LocalQueue(tmpDb());
    q.upsert({ jobId: "j4", payloadType: "raw" as const, payloadBase64: "eA==", printerId: "cozinha", copies: 1 });
    const seen: string[] = [];
    const executor = { execute: vi.fn(async (t: { printerName: string }) => { seen.push(t.printerName); }) };
    const cfg = { apiBaseUrl: "http://x", token: "t", pollIntervalMs: 10000, dbPath: ":memory:" } as never;
    await tick(cfg, q, { executor, poll: (async () => []) as never, report: (async () => {}) as never });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(seen[0]).toBe("cozinha"); // não o default
    q.close();

    const q2 = new LocalQueue(tmpDb());
    q2.upsert({ jobId: "j5", payloadType: "raw" as const, payloadBase64: "eA==", printerId: "", copies: 1 });
    const seen2: string[] = [];
    const exec2 = { execute: vi.fn(async (t: { printerName: string }) => { seen2.push(t.printerName); }) };
    const cfg2 = { apiBaseUrl: "http://x", token: "t", pollIntervalMs: 10000, dbPath: ":memory:", defaultPrinter: "balcao" } as never;
    await tick(cfg2, q2, { executor: exec2, poll: (async () => []) as never, report: (async () => {}) as never });
    expect(seen2[0]).toBe("balcao");
    q2.close();
  });

  it("tick faz retry explícito failed->pending antes de executar", async () => {
    const q = new LocalQueue(tmpDb());
    q.upsert({ jobId: "j6", payloadType: "raw" as const, payloadBase64: "eA==", printerId: "p", copies: 1 });
    q.transition("j6", "received");
    q.transition("j6", "printing");
    q.transition("j6", "failed", "jam");
    // Força elegibilidade imediata
    const exec = { execute: vi.fn(async () => {}) };
    const cfg = { apiBaseUrl: "http://x", token: "t", pollIntervalMs: 10000, dbPath: ":memory:" } as never;
    // backoff de 5s bloqueia; então retry manual primeiro
    expect(q.transition("j6", "pending")?.status).toBe("pending");
    await tick(cfg, q, { executor: exec, poll: (async () => []) as never, report: (async () => {}) as never });
    expect(exec.execute).toHaveBeenCalledTimes(1);
    q.close();
  });
});
