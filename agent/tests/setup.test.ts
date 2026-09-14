import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configFilePath,
  loadEffectiveConfig,
  loadFileConfig,
  saveFileConfig,
} from "../src/config.js";
import { buildSetupHtml, openSetupWindow } from "../src/shell/setupWindow.js";
import { parseSetupArgs } from "../src/index.js";

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pb-cfg-")), "config.json");
}

describe("instalação fácil", () => {
  it("config file: salva, lê e env vence arquivo", () => {
    const file = tmpFile();
    expect(loadFileConfig(file)).toBeNull();
    saveFileConfig({ apiBaseUrl: "https://api.loja.com", token: "pb_file" }, file);
    expect(loadFileConfig(file)?.token).toBe("pb_file");
    // merge preserva campos antigos
    saveFileConfig({ defaultPrinter: "cozinha" }, file);
    expect(loadFileConfig(file)?.token).toBe("pb_file");
    // env vence arquivo
    const cfg = loadEffectiveConfig({ PRINT_AGENT_TOKEN: "pb_env" } as NodeJS.ProcessEnv, file);
    expect(cfg.token).toBe("pb_env");
    expect(cfg.apiBaseUrl).toBe("https://api.loja.com");
    const cfg2 = loadEffectiveConfig({} as NodeJS.ProcessEnv, file);
    expect(cfg2.token).toBe("pb_file");
  });

  it("configFilePath usa %APPDATA% no Windows", () => {
    expect(configFilePath("win32")).toContain("PrintBridge Agent");
    expect(configFilePath("darwin")).toContain(".config");
  });

  it("assistente gera HTML com campos e caminho embutido", () => {
    const html = buildSetupHtml({ configPath: "C:\\cfg\\config.json", apiUrl: "https://x" });
    expect(html).toContain("Servidor");
    expect(html).toContain("Token da loja");
    expect(html).toContain("C:\\\\cfg\\\\config.json"); // JSON-escaped dentro do script
    expect(html).toContain("/print-agent/me");
    expect(html).toContain("data:image/png;base64"); // logotipo embutida
  });

  it("openSetupWindow abre data URL com nodeIntegration + travas", async () => {
    let loaded = "";
    let opts: Record<string, unknown> = {};
    const handlers: Record<string, Array<(...a: never[]) => void>> = {};
    class FakeBW {
      webContents = {
        on: (ev: string, fn: (...a: never[]) => void) => { (handlers[ev] ??= []).push(fn); },
        setWindowOpenHandler: (_fn: () => { action: "deny" }) => {},
      };
      constructor(o: Record<string, unknown>) { opts = o; }
      async loadURL(url: string) { loaded = url; }
      on(ev: string, fn: () => void) { (handlers[ev] ??= []).push(fn as (...a: never[]) => void); }
      close() {}
      isDestroyed() { return false; }
    }
    const handle = openSetupWindow({ BrowserWindow: FakeBW }, { configPath: "/tmp/c.json", apiUrl: "https://x" });
    await new Promise((r) => setTimeout(r, 10));
    expect(loaded.startsWith("data:text/html")).toBe(true);
    expect((opts.webPreferences as Record<string, unknown>).nodeIntegration).toBe(true);
    expect(handlers["will-navigate"]?.length).toBe(1);
    // Fechar no X propaga via onClosed (sem isso o boot vira zumbi).
    let closed = false;
    handle.onClosed(() => { closed = true; });
    for (const fn of handlers["closed"] ?? []) fn();
    expect(closed).toBe(true);
  });

  it("parseSetupArgs entende --setup", () => {
    expect(parseSetupArgs([])).toBeNull();
    expect(parseSetupArgs(["--setup", "--api", "https://x", "--setup-key", "k", "--label", "caixa"])).toEqual({
      api: "https://x",
      setupKey: "k",
      label: "caixa",
      token: "",
    });
  });
});
