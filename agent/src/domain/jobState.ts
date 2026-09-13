/**
 * Reaproveita a máquina do backend (mesma semântica, sem duplicar regra).
 * Espelho intencional de src/domain/printJob.ts para o agent rodar standalone.
 */
export type LocalStatus = "pending" | "received" | "printing" | "completed" | "failed";

const ALLOWED: Record<LocalStatus, readonly LocalStatus[]> = {
  pending: ["received"],
  received: ["printing", "pending"],
  printing: ["completed", "failed"],
  completed: [],
  failed: ["pending"],
};

export function canTransition(from: LocalStatus, to: LocalStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function nextRetryDelayMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.min(attempts, 6), 300_000);
}
