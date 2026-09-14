/**
 * Entry point do Electron (main process). Só executa dentro do Electron no Windows.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { configFilePath, loadEffectiveConfig, loadFileConfig } from "../config.js";
import { createLogger, type Logger } from "../infra/logger.js";
import { startAgent, type AgentRuntime } from "../index.js";
import { configureAutostart } from "./autostart.js";
import { openSetupWindow } from "./setupWindow.js";
import { buildTray } from "./tray.js";
import { checkForUpdates, wireAutoInstall, type UpdaterLike } from "./updater.js";
import type { AppLike, MenuLike, TrayCtor } from "./types.js";

const req = createRequire(import.meta.url);
// Tray-only: sem janela pesada, GPU só gastaria RAM no notebook da loja.
(req("electron") as { app: { disableHardwareAcceleration(): void } }).app.disableHardwareAcceleration();
const { app, Tray, Menu, BrowserWindow, shell, dialog } = req("electron") as {
  app: AppLike & {
    getPath(n: string): string;
    whenReady(): Promise<void>;
    relaunch(): void;
  };
  Tray: TrayCtor;
  Menu: MenuLike;
  BrowserWindow: new (opts: Record<string, unknown>) => {
    loadURL(url: string): Promise<void>;
    on(event: string, fn: () => void): void;
    close(): void;
    isDestroyed(): boolean;
    webContents: {
      on(event: string, fn: (e: { preventDefault(): void }) => void): void;
      setWindowOpenHandler(fn: () => { action: "deny" }): void;
    };
  };
  shell: { showItemInFolder(p: string): void };
  dialog: { showErrorBox(title: string, content: string): void };
};

const TRAY_REFRESH_MS = 5_000;
const SETUP_POLL_MS = 1_500;

async function boot(): Promise<void> {
  const log = createLogger("agent");
  try {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    await app.whenReady();

    // Primeira execução: assistente grava %APPDATA%/PrintBridge Agent/config.json.
    let cfg = loadEffectiveConfig();
    if (!cfg.token) {
      await runFirstSetup(log);
      cfg = loadEffectiveConfig();
      if (!cfg.token) {
        app.quit();
        return;
      }
    }

    const runtime = startAgent(cfg);
    configureAutostart(app, true, log);

    const handle = buildTray(
      Tray,
      Menu,
      iconFor(),
      appVersion(app),
      {
        getStatus: () => (runtime.lastTickAt() ? `ok (tick ${runtime.lastTickAt()})` : "iniciando…"),
        onOpenLogs: () => shell.showItemInFolder(logDir()),
        onCheckUpdates: () => void checkForUpdates(loadUpdater(), log),
        onQuit: () => shutdown(runtime, handle.tray.destroy.bind(handle.tray)),
      },
      log,
    );
    setInterval(() => handle.refresh(), TRAY_REFRESH_MS);

    // Reconfiguração pelo assistente: token trocado no arquivo => relança.
    watchConfigToken(cfg.token, log);
    const updater = loadUpdater();
    wireAutoInstall(updater, log, () => runtime.isIdle());
    // Escuta de atualização: 1min após boot + a cada 6h; avisa na bandeja.
    const checkUpdates = () =>
      checkForUpdates(updater, log).then((r) => {
        if (r === "downloaded") {
          handle.tray.displayBalloon?.({
            title: "PrintBridge atualizado",
            content: "Nova versão baixada — será aplicada ao fechar.",
          });
        }
      }).catch((e) => log.error("check inicial de update", e));
    setTimeout(() => void checkUpdates(), 60_000);
    setInterval(() => void checkUpdates(), 6 * 3600_000);
    log.info(`agente iniciado v${appVersion(app)}`);
  } catch (e) {
    // Boot sem tray: nunca falha silencioso — log + diálogo + quit.
    // Exceção: setup cancelado no X — quit silencioso, foi escolha do usuário.
    if (e instanceof SetupCancelled) {
      app.quit();
      return;
    }
    const msg = (e as Error).message;
    try {
      createLogger("agent").error("boot falhou", e);
    } catch {
      console.error("[agent] boot falhou", msg);
    }
    try {
      dialog.showErrorBox("PrintBridge Agent", `Falha ao iniciar: ${msg}`);
    } catch {
      // sem display — segue para quit
    }
    app.quit();
  }
}

function shutdown(runtime: AgentRuntime, destroyTray: () => void): void {
  runtime.stop();
  destroyTray();
  app.quit();
}

/** Abre o assistente e resolve quando o token aparece no arquivo. Rejeita se fechar no X. */
function runFirstSetup(log: Logger): Promise<void> {
  const file = configFilePath();
  const apiUrl = process.env.PRINTBRIDGE_API ?? "https://";
  const setup = openSetupWindow({ BrowserWindow }, { configPath: file, apiUrl });
  log.info("primeira execução — assistente de configuração aberto");
  return new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      if (loadFileConfig(file)?.token) {
        clearInterval(timer);
        setup.close();
        resolve();
      }
    }, SETUP_POLL_MS);
    setup.onClosed(() => {
      clearInterval(timer);
      reject(new SetupCancelled());
    });
  });
}

class SetupCancelled extends Error {
  constructor() {
    super("setup cancelado pelo usuário");
    this.name = "SetupCancelled";
  }
}

/** Se o token mudar no disco (reconfiguração), relança para aplicar. */
function watchConfigToken(initialToken: string, log: Logger): void {
  const file = configFilePath();
  setInterval(() => {
    const current = loadFileConfig(file)?.token;
    if (current && current !== initialToken) {
      log.info("config alterada — relançando agente");
      app.relaunch();
      app.quit();
    }
  }, SETUP_POLL_MS);
}

function loadUpdater(): UpdaterLike {
  return req("electron-updater").autoUpdater as UpdaterLike;
}

function appVersion(app: AppLike): string {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

function logDir(): string {
  try {
    return app.getPath("logs");
  } catch {
    return "./logs";
  }
}

function iconFor(): string {
  // fileURLToPath: pathname cru gera "/C:/..." inválido no Windows.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ico = path.join(here, "..", "..", "assets", "tray.ico");
  const png = path.join(here, "..", "..", "assets", "tray.png");
  return process.platform === "win32" ? ico : png;
}

void boot();
