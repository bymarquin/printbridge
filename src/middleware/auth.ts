import type { NextFunction, Request, Response } from "express";
import { findAgentByToken, safeEqualString } from "../infra/tokenStore.js";
import { verifyAccess } from "../services/sessions.js";

export interface AuthedRequest extends Request {
  agentId?: string;
  sessionOwner?: boolean;
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

/** Dono: sessão rotativa OU chave owner via header. */
export function ownerAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!isOwner(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  req.sessionOwner = true;
  next();
}

/**
 * Rotas compartilhadas (ex.: webhooks do painel): aceita bearer de agente,
 * chave owner OU sessão de dono. Com owner, req.agentId fica indefinido.
 */
export function agentOrOwnerAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  req.agentId = tryAgent(req) ?? undefined;
  const owner = !req.agentId && isOwner(req);
  if (req.agentId || owner) {
    req.sessionOwner = owner || undefined;
    next();
    return;
  }
  res.status(401).json({ error: "invalid token" });
}

function bearerOf(req: Request): string {
  const header = req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function tryAgent(req: Request): string | null {
  const token = bearerOf(req);
  if (!token) return null;
  const agent = findAgentByToken(token);
  return agent ? agent.id : null;
}

export function isOwner(req: Request): boolean {  // Sessão rotativa (15min) tem precedência; chave estática continua valendo.
  const token = bearerOf(req);
  if (token && verifyAccess(token) === "owner") return true;
  const setupKey = process.env.OWNER_SETUP_KEY;
  const provided = req.header("x-setup-key") ?? "";
  return !!setupKey && safeEqualString(provided, setupKey);
}
