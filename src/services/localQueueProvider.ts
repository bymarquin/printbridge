import { PrintJobRepository, type EnqueueInput } from "../infra/printJobRepository.js";
import type { PrintProvider } from "./provider.js";

type Broadcaster = (jobId: string, agentId?: string | null) => void;

/** Implementação real: fila durável SQLite + broadcast WS. */
export class LocalQueueProvider implements PrintProvider {
  readonly name = "local-queue";
  private repo = new PrintJobRepository();

  constructor(private readonly onEnqueue?: Broadcaster) {}

  submit(input: EnqueueInput) {
    const result = this.repo.enqueue(input);
    if (!result.deduplicated) this.onEnqueue?.(result.job.id, result.job.agentId);
    return result;
  }
}
