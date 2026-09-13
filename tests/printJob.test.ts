import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/infra/db.js";
import {
  InvalidTransitionError,
  JobConflictError,
  PayloadTooLargeError,
  PrintJobRepository,
} from "../src/infra/printJobRepository.js";
import type { PrintJob } from "../src/domain/printJob.js";

// Banco em memória por teste — mesmo schema de produção via migrate().
function testDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

const base = {
  idempotencyKey: "order-123",
  payloadType: "raw" as const,
  payloadBase64: Buffer.from("teste").toString("base64"),
  printerId: "cozinha",
};

describe("PrintJob — máquina de estados + idempotência", () => {
  let repo: PrintJobRepository;
  beforeEach(() => {
    repo = new PrintJobRepository(testDb());
  });

  it("enqueue é idempotente por idempotencyKey", () => {
    const first = repo.enqueue(base);
    const second = repo.enqueue(base);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.job.id).toBe(first.job.id);
  });

  it("ciclo feliz pending->received->printing->completed", () => {
    const { job } = repo.enqueue({ ...base, idempotencyKey: "a1" });
    const claimed = repo.claim(job.id);
    expect(claimed?.status).toBe("received");
    expect(repo.transition(job.id, "printing").status).toBe("printing");
    expect(repo.transition(job.id, "completed").status).toBe("completed");
  });

  it("rejeita transição inválida pending->completed com erro tipado", () => {
    const { job } = repo.enqueue({ ...base, idempotencyKey: "a2" });
    expect(() => repo.transition(job.id, "completed")).toThrow(InvalidTransitionError);
  });

  it("claim é atômico — segundo claim retorna null (sem race)", () => {
    const { job } = repo.enqueue({ ...base, idempotencyKey: "a3" });
    expect(repo.claim(job.id)?.status).toBe("received");
    expect(repo.claim(job.id)).toBeNull();
  });

  it("falha registra erro + incrementa attempts + permite retry para pending", () => {
    const { job } = repo.enqueue({ ...base, idempotencyKey: "a4" });
    repo.claim(job.id);
    repo.transition(job.id, "printing");
    const failed = repo.recordFailure(job.id, "paper jam");
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("paper jam");
    expect(repo.transition(job.id, "pending").status).toBe("pending");
  });

  it("CAS: snapshot stale perde o UPDATE e gera JobConflictError de verdade", () => {
    const db = testDb();
    const writer = new PrintJobRepository(db);
    const { job } = writer.enqueue({ ...base, idempotencyKey: "a5b" });
    const staleSnap = writer.getById(job.id) as PrintJob; // pending
    // Outro worker avança o estado real para received…
    expect(writer.claim(job.id)?.status).toBe("received");
    // …o worker stale ainda enxerga pending e tenta pending->received (válida no papel).
    class StaleReader extends PrintJobRepository {
      override getById(): PrintJob | null {
        return staleSnap;
      }
    }
    const stale = new StaleReader(db);
    // WHERE status='pending' não bate mais em nada: 0 linhas -> 409.
    expect(() => stale.transition(job.id, "received")).toThrow(JobConflictError);
  });

  it("payload acima de 5MB gera PayloadTooLargeError tipado", () => {
    const big = "A".repeat(6 * 1024 * 1024);
    expect(() => repo.enqueue({ ...base, idempotencyKey: "big1", payloadBase64: big })).toThrow(
      PayloadTooLargeError,
    );
  });

  it("printing->printing é refresh idempotente (reanúncio pós-restart)", () => {
    const { job } = repo.enqueue({ ...base, idempotencyKey: "refresh1" });
    repo.claim(job.id);
    repo.transition(job.id, "printing");
    const refreshed = repo.transition(job.id, "printing");
    expect(refreshed.status).toBe("printing");
    expect(refreshed.attempts).toBe(0); // refresh não conta como falha
    expect(repo.transition(job.id, "completed").status).toBe("completed");
  });
});
