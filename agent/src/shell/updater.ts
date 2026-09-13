import type { Logger } from "../infra/logger.js";

export interface UpdaterLike {
  autoDownload: boolean;
  checkForUpdates(): Promise<{ updateInfo?: { version?: string } } | null>;
  quitAndInstall(): void;
  on(event: "update-downloaded", listener: () => void): void;
  on(event: "error", listener: (e: Error) => void): void;
}

export type UpdateResult = "downloaded" | "not-available" | "error";

/**
 * Auto-update (MSI silencioso no Windows via electron-updater).
 * electron-updater injetado — lazy import só existe no pacote instalado.
 */
export async function checkForUpdates(updater: UpdaterLike, log: Logger): Promise<UpdateResult> {
  try {
    updater.autoDownload = true;
    const result = await updater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (version) {
      log.info(`atualização baixada: v${version} — será aplicada ao sair`);
      return "downloaded";
    }
    log.info("sem atualizações");
    return "not-available";
  } catch (e) {
    log.error("falha ao verificar atualização", e);
    return "error";
  }
}

export function wireAutoInstall(
  updater: UpdaterLike,
  log: Logger,
  canQuit: () => boolean = () => true,
): void {
  updater.on("update-downloaded", () => {
    // Nunca mata impressão em voo: adia até a fila esvaziar (teto 5min).
    let tries = 0;
    const attempt = () => {
      tries += 1;
      if (canQuit()) {
        log.info("fila livre — instalando atualização");
        updater.quitAndInstall();
      } else if (tries < 10) {
        log.info(`adiando install: impressão em voo (tentativa ${tries}/10)`);
        setTimeout(attempt, 30_000);
      } else {
        log.error("install adiado 5min com fila ocupada — será aplicado ao sair");
      }
    };
    attempt();
  });
  updater.on("error", (e) => log.error("updater error", e));
}
