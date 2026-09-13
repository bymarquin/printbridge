import type { Logger } from "../infra/logger.js";
import type { AppLike } from "./types.js";

/**
 * Auto-start com Windows via API nativa do Electron.
 * Sem dependência extra (auto-launch desnecessário no Windows).
 */
export function configureAutostart(app: AppLike, openAtLogin: boolean, log: Logger): void {
  try {
    app.setLoginItemSettings({ openAtLogin, openAsHidden: true });
    log.info(`autostart ${openAtLogin ? "ativado" : "desativado"}`);
  } catch (e) {
    log.error("falha ao configurar autostart", e);
  }
}
