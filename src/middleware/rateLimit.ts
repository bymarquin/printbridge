import type { NextFunction, Request, Response } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate limit em memória por IP — protege endpoints públicos (pareamento)
 * contra bruteforce de códigos. Suficiente para o volume de onboard;
 * não é proteção DDoS (isso é papel do proxy/CDN).
 */
export function rateLimit(maxPerMinute: number) {
  // Um Map por instância: limiters diferentes nunca dividem budget.
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || b.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    b.count += 1;
    if (b.count > maxPerMinute) {
      res.status(429).json({ error: "muitas tentativas — aguarde um minuto" });
      return;
    }
    next();
    if (buckets.size > 10_000) buckets.clear();
  };
}

export const pairLimit = rateLimit(30);
/** Polling do agente é frequente por desenho: bucket separado e mais folgado. */
export const pairStatusLimit = rateLimit(60);
