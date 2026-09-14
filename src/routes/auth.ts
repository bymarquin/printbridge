import { Router } from "express";
import { z } from "zod";
import { safeEqualString } from "../infra/tokenStore.js";
import { createSession, refreshSession, revokeSession } from "../services/sessions.js";

/**
 * Sessão do dono: login persistente (refresh 30d) com chave curta rotativa (15min).
 * Agentes Windows continuam com bearer estático — intocado.
 */
export function authRouter(): Router {
  const r = Router();

  r.post("/login", (req, res) => {
    const parsed = z.object({ setupKey: z.string().min(1).max(256) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "setupKey ausente" });
      return;
    }
    const setupKey = process.env.OWNER_SETUP_KEY;
    if (!setupKey || !safeEqualString(parsed.data.setupKey, setupKey)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.json({ session: createSession("owner"), tokenType: "bearer" });
  });

  r.post("/refresh", (req, res) => {
    const parsed = z.object({ refreshToken: z.string().min(1).max(256) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "refreshToken ausente" });
      return;
    }
    try {
      res.json({ session: refreshSession(parsed.data.refreshToken), tokenType: "bearer" });
    } catch (e) {
      res.status(403).json({ error: (e as Error).message });
    }
  });

  r.post("/logout", (req, res) => {
    const parsed = z.object({ refreshToken: z.string().min(1).max(256) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "refreshToken ausente" });
      return;
    }
    revokeSession(parsed.data.refreshToken);
    res.status(204).end();
  });

  return r;
}
