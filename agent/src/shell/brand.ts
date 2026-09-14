import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Marca embutida (data URL) para as janelas do agente.
 * Lê de package/assets/logo-icon.png; ausente => string vazia (sem quebrar).
 */
export function logoDataUrl(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(here, "..", "..", "assets", "logo-icon.png");
    const bin = fs.readFileSync(file);
    if (bin.length === 0 || bin.length > 500_000) return "";
    return `data:image/png;base64,${bin.toString("base64")}`;
  } catch {
    return "";
  }
}

export function brandHead(logoUrl: string): string {
  const img = logoUrl
    ? `<img class="mark" src="${logoUrl}" alt="PrintBridge">`
    : `<div class="mark fallback">P</div>`;
  return `<div class="brand">${img}<div><b>PrintBridge</b><small>Impressão para estabelecimentos</small></div></div>`;
}

export const BRAND_CSS = `
*{box-sizing:border-box}body{font-family:Inter,"Segoe UI",Arial,sans-serif;background:#09090b;color:#f4f4f5;margin:0;padding:24px;display:flex;justify-content:center}
.wrap{width:100%;max-width:420px}.brand{display:flex;align-items:center;gap:12px;margin:10px 0 6px}
.mark{width:44px;height:44px;border-radius:10px;border:1px solid #3f3f46}
.mark.fallback{background:#2dd4bf;color:#09090b;font-weight:800;font-size:20px;display:flex;align-items:center;justify-content:center}
.brand b{font-size:18px;font-weight:800;letter-spacing:-.02em}.brand small{display:block;color:#a1a1aa;font-size:12px;font-weight:400}
.card{background:#18181b;border:1px solid #27272a;border-top:3px solid #2dd4bf;border-radius:10px;padding:20px;margin-top:16px}
h1{font-size:19px;font-weight:800;margin:0;letter-spacing:-.01em}.sub{color:#a1a1aa;font-size:13px;margin:4px 0 0}
label{display:block;margin:14px 0 6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa}
input[type=text]{width:100%;height:42px;padding:0 12px;border-radius:8px;border:1px solid #3f3f46;background:#09090b;color:#f4f4f5;font-size:14px;outline:none}
input[type=text]:focus{border-color:#fafafa}
button.go{width:100%;height:42px;margin-top:16px;background:#fafafa;border:0;color:#09090b;font-weight:800;font-size:14px;border-radius:8px;cursor:pointer}
button.go:hover{background:#e4e4e7}
#error{color:#fca5a5;margin-top:12px;font-size:13px;white-space:pre-wrap}
#ok{color:#6ee7b7;margin-top:12px;font-size:13px}`;
