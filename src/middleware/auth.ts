import type { NextFunction, Request, Response } from "express";
import { findAgentByToken, safeEqualString } from "../infra/tokenStore.js";

export interface AuthedRequest extends Request {
  agentId?: string;
}

export function agentAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const agentId = tryAgent(req);
  if (!agentId) {
    res.status(401).json({ error: "invalid token" });
    return;
  }
  req.agentId = agentId;
  next();
}

/** Dono: chave owner via header (painel admin). Comparação constante. */
export function ownerAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isOwner(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

/**
 * Rotas compartilhadas (ex.: webhooks do painel): aceita bearer de agente
 * OU chave owner. Com owner, req.agentId fica indefinido.
 */
export function agentOrOwnerAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  req.agentId = tryAgent(req) ?? undefined;
  if (req.agentId || isOwner(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "invalid token" });
}

function tryAgent(req: Request): string | null {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const agent = findAgentByToken(token);
  return agent ? agent.id : null;
}

function isOwner(req: Request): boolean {
  const setupKey = process.env.OWNER_SETUP_KEY;
  const provided = req.header("x-setup-key") ?? "";
  return !!setupKey && safeEqualString(provided, setupKey);
}
