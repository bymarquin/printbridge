import type { Logger } from "../infra/logger.js";
import type { MenuLike, TrayCtor, TrayLike } from "./types.js";

export interface TrayCallbacks {
  getStatus: () => string;
  onOpenLogs: () => void;
  onCheckUpdates: () => void;
  onQuit: () => void;
}

export interface TrayHandle {
  tray: TrayLike;
  /** Re-renderiza tooltip + menu (chamar periodicamente — ex.: 5s). */
  refresh: () => void;
}

/**
 * Bandeja (tray) — único UI do agente. Sem janela principal.
 * Tray e Menu injetados: roda com fakes nos testes, Electron real no Windows.
 */
export function buildTray(
  Tray: TrayCtor,
  Menu: MenuLike,
  iconPath: string,
  version: string,
  cb: TrayCallbacks,
  log: Logger,
): TrayHandle {
  // Sem guid: no Windows ele precisa ser GUID válido e não precisamos fixar posição.
  const tray = new Tray(iconPath);
  const refresh = () => {
    try {
      tray.setToolTip(`PrintBridge v${version} — ${cb.getStatus()}`);
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: `PrintBridge v${version}`, enabled: false },
          { label: `Status: ${cb.getStatus()}`, enabled: false },
          { type: "separator" },
          { label: "Abrir pasta de logs", click: cb.onOpenLogs },
          { label: "Verificar atualizações", click: cb.onCheckUpdates },
          { type: "separator" },
          { label: "Sair", click: cb.onQuit },
        ]),
      );
    } catch (e) {
      log.error("falha ao montar tray", e);
    }
  };
  refresh();
  return { tray, refresh };
}
