import { describe, it, expect } from "vitest";
import { buildManifests, installerUrl, PACKAGE_ID } from "../scripts/winget-bump.mjs";

describe("winget", () => {
  it("gera URL do release no padrão GitHub", () => {
    expect(installerUrl("SUA-ORG", "printbridge", "0.1.0")).toBe(
      "https://github.com/SUA-ORG/printbridge/releases/download/v0.1.0/PrintBridge-Agent-0.1.0-setup.exe",
    );
  });

  it("manifestos contêm campos exigidos pelo winget-pkgs", () => {
    const files = buildManifests({ version: "0.1.0", url: "https://x/y.exe", sha: "A".repeat(64) });
    expect(Object.keys(files)).toHaveLength(3);
    expect(files[`${PACKAGE_ID}.installer.yaml`]).toContain("InstallerType: nullsoft");
    expect(files[`${PACKAGE_ID}.installer.yaml`]).toContain("Scope: user");
    expect(files[`${PACKAGE_ID}.installer.yaml`]).toContain("Silent: /S");
    expect(files[`${PACKAGE_ID}.installer.yaml`]).toContain("https://x/y.exe");
    expect(files[`${PACKAGE_ID}.locale.en-US.yaml`]).toContain("PackageName: PrintBridge Agent");
  });
});
