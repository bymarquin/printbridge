import type { PrintJob } from "../domain/printJob.js";
import type { EnqueueInput } from "../infra/printJobRepository.js";

/**
 * Abstração mínima de provedor (revisor #4):
 * só existe porque há implementação real (fila local).
 * Nada de providers hipotéticos.
 */
export interface PrintProvider {
  readonly name: string;
  submit(input: EnqueueInput): { job: PrintJob; deduplicated: boolean };
}
