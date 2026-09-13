export type PayloadType = "pdf" | "raw";

export type PrintJobStatus =
  | "pending"
  | "received"
  | "printing"
  | "completed"
  | "failed";

export interface PrintJob {
  id: string;
  idempotencyKey: string;
  orderId: string | null;
  payloadType: PayloadType;
  /** base64 do PDF ou texto/bytes ESC/POS em base64 */
  payloadBase64: string;
  printerId: string;
  copies: number;
  paperWidth: number;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  /** ISO timestamp — próxima tentativa elegível (backoff) */
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Máquina de estados explícita.
 * pending -> received -> printing -> completed | failed
 * failed -> pending (retry operador/sistema)
 * printing -> printing (refresh idempotente: agente reiniciado reanuncia
 *   job em voo sem mudar attempts — evita job preso após kill/restart)
 */
const ALLOWED: Record<PrintJobStatus, readonly PrintJobStatus[]> = {
  pending: ["received"],
  received: ["printing", "pending"],
  printing: ["completed", "failed", "printing"],
  completed: [],
  failed: ["pending"],
};

export function canTransition(
  from: PrintJobStatus,
  to: PrintJobStatus,
): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: PrintJobStatus, to: PrintJobStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Transição inválida: ${from} -> ${to}`);
  }
}

/** Backoff exponencial: 5s * 2^attempts, teto 5min */
export function nextRetryDelayMs(attempts: number): number {
  const base = 5_000;
  const delay = base * 2 ** Math.min(attempts, 6);
  return Math.min(delay, 300_000);
}
