import type { NextFunction, Request, Response } from "express";
import { findAgentByToken } from "../infra/tokenStore.js";

export interface AuthedRequest extends Request {
  agentId?: string;
}

export function agentAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }
  const agent = findAgentByToken(token);
  if (!agent) {
    res.status(401).json({ error: "invalid token" });
    return;
  }
  req.agentId = agent.id;
  next();
}
