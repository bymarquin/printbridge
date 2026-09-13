import { execFile } from "node:child_process";

export interface OsPrinter {
  name: string;
  status: string;
  isDefault: boolean;
}

export interface PrinterLister {
  list(): Promise<OsPrinter[]>;
}

function runWithTimeout(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`printer list falhou: ${(stderr || err.message).slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });
    child.on("error", (e) => reject(new Error(`spawn falhou: ${e.message}`)));
  });
}

/**
 * Lista impressoras do Windows via PowerShell (Win32_Printer).
 * Timeout obrigatório — WMI pode travar (ajuste do revisor).
 */
export class WindowsPrinterLister implements PrinterLister {
  constructor(private readonly timeoutMs = 8000) {}

  async list(): Promise<OsPrinter[]> {
    if (process.platform !== "win32") return [];
    const ps = `Get-CimInstance Win32_Printer | Select-Object Name,WorkOffline,Default | ConvertTo-Json -Compress`;
    const out = await runWithTimeout("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], this.timeoutMs);
    try {
      const raw = JSON.parse(out);
      const arr = Array.isArray(raw) ? raw : [raw];
      return arr.map((p: { Name: string; WorkOffline: boolean; Default: boolean }) => ({
        name: String(p.Name),
        status: p.WorkOffline ? "offline" : "ready",
        isDefault: Boolean(p.Default),
      }));
    } catch {
      throw new Error("resposta Win32_Printer inválida");
    }
  }
}
