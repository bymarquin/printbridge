import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureAutostart } from "../src/shell/autostart.js";
import { buildTray } from "../src/shell/tray.js";
import { buildConnectionHtml, openConnectionWindow } from "../src/shell/connectionWindow.js";
import { createDiagnoseWindow } from "../src/shell/diagnoseWindow.js";
import { checkForUpdates, wireAutoInstall } from "../src/shell/updater.js";
import { LocalQueue } from "../src/infra/localQueue.js";
import { createLogger, logFilePath } from "../src/infra/logger.js";

describe("shell", () => {
  it("autostart ativa via setLoginItemSettings", () => {
    const app = { setLoginItemSettings: vi.fn() };
    const log = { info: vi.fn(), error: vi.fn() };
    configureAutostart(app as never, true, log);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, openAsHidden: true });
    expect(log.info).toHaveBeenCalledOnce();
  });

  it("tray monta menu com status e versão + refresh atualiza", () => {
    const instances: Array<{ tooltip: string; menu: unknown }> = [];
    class FakeTray {
      tooltip = "";
      menu: unknown;
      constructor(public icon: string, public guid?: string) {
        instances.push({ tooltip: "", menu: null });
      }
      setToolTip(t: string) { this.tooltip = t; instances[0].tooltip = t; }
      setContextMenu(m: unknown) { this.menu = m; instances[0].menu = m; }
      destroy() {}
    }
    let template: Array<Record<string, unknown>> = [];
    const Menu = { buildFromTemplate: (t: typeof template) => { template = t; return { template: t }; } };
    const log = { info: vi.fn(), error: vi.fn() };
    let status = "iniciando…";
    const cb = { getStatus: () => status, onOpenLogs: vi.fn(), onCheckUpdates: vi.fn(), onConnection: vi.fn(), onQuit: vi.fn() };
    const handle = buildTray(FakeTray as never, Menu, "icon.ico", "0.1.0", cb, log);
    expect(instances[0].tooltip).toContain("0.1.0");
    expect(instances[0].tooltip).toContain("iniciando");
    status = "ok";
    handle.refresh();
    expect(instances[0].tooltip).toContain("ok");
    expect((template.map((i) => i.label) as string[])).toContain("Conexão…");
    const labels = template.map((i) => i.label);
    expect(labels).toContain("Abrir pasta de logs");
    expect(labels).toContain("Verificar atualizações");
    expect(labels).toContain("Sair");
    expect(log.error).not.toHaveBeenCalled();
  });

  it("updater adia install com impressão em voo e instala quando livre", async () => {
    vi.useFakeTimers();
    try {
      const log = { info: vi.fn(), error: vi.fn() };
      const events: Record<string, () => void> = {};
      const updater = {
        autoDownload: false,
        checkForUpdates: async () => null,
        quitAndInstall: vi.fn(),
        on: vi.fn((ev: string, fn: () => void) => { events[ev] = fn; }),
      };
      let idle = false;
      wireAutoInstall(updater, log, () => idle);
      events["update-downloaded"]();
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
      idle = true;
      await vi.advanceTimersByTimeAsync(31_000);
      expect(updater.quitAndInstall).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("requeueStale recupera jobs presos no boot", () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pb-reap-")), "q.db");
    const q = new LocalQueue(dbPath);
    q.upsert({ jobId: "stuck", payloadType: "raw" as const, payloadBase64: "eA==", printerId: "p", copies: 1 });
    q.transition("stuck", "received");
    q.transition("stuck", "printing");
    // Recém-atualizado: nada a recuperar.
    expect(q.requeueStale(10 * 60_000)).toBe(0);
    // Simula updated_at velho (crash há 1h).
    const raw = new Database(dbPath);
    raw.prepare(`UPDATE local_jobs SET updated_at = '2020-01-01T00:00:00.000Z' WHERE job_id = 'stuck'`).run();
    raw.close();
    expect(q.requeueStale(10 * 60_000)).toBe(1);
    expect(q.transition("stuck", "received")?.status).toBe("received");
    expect(q.countActive()).toBe(1);
    q.close();
  });

  it("updater retorna not-available sem update e error sem quebrar", async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const none = { autoDownload: false, checkForUpdates: async () => null, quitAndInstall: vi.fn(), on: vi.fn() };
    expect(await checkForUpdates(none, log)).toBe("not-available");
    const avail = { autoDownload: false, checkForUpdates: async () => ({ updateInfo: { version: "0.2.0" } }), quitAndInstall: vi.fn(), on: vi.fn() };
    expect(await checkForUpdates(avail, log)).toBe("downloaded");
    const broken = { autoDownload: false, checkForUpdates: async () => { throw new Error("rede"); }, quitAndInstall: vi.fn(), on: vi.fn() };
    expect(await checkForUpdates(broken, log)).toBe("error");
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("diagnóstico narra etapas e falha sem fechar", async () => {
    const calls: string[] = [];
    let url = "";
    class FakeWin {
      constructor(_o: Record<string, unknown>) {}
      async loadURL(u: string) { url = u; }
      isDestroyed() { return false; }
      webContents = { executeJavaScript: async (c: string) => { calls.push(c); } };
    }
    const diag = await createDiagnoseWindow(FakeWin as never);
    expect(url.startsWith("data:text/html")).toBe(true);
    await diag.step("config", true, "token presente");
    await diag.step("tray", false);
    await diag.fail("Parou aqui:\nboom");
    expect(calls.some((c) => c.includes("token presente"))).toBe(true);
    expect(calls.some((c) => c.includes("Parou aqui"))).toBe(true);
  });

  it("janela Conexão mostra status e troca de loja", async () => {
    const html = buildConnectionHtml({ configPath: "/tmp/c.json", apiUrl: "https://x" });
    expect(html).toContain("Trocar de loja / servidor");
    expect(html).toContain("/print-agent/printers");
    let loaded = "";
    class FakeBW {
      webContents = {
        on: () => {},
        setWindowOpenHandler: (_fn: () => { action: "deny" }) => {},
      };
      async loadURL(url: string) { loaded = url; }
      on() {}
      close() {}
      isDestroyed() { return false; }
    }
    openConnectionWindow({ BrowserWindow: FakeBW }, { configPath: "/tmp/c.json", apiUrl: "https://x" });
    await new Promise((r) => setTimeout(r, 10));
    expect(loaded.startsWith("data:text/html")).toBe(true);
  });

  it("logger fallback escreve em arquivo com rotação", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-log-"));
    const log = createLogger("test", dir, { forceFile: true });
    log.info("hello");
    log.error("boom");
    const content = fs.readFileSync(logFilePath("test", dir), "utf8");
    expect(content).toContain("hello");
    expect(content).toContain("boom");
  });
});
