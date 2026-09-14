import { BRAND_CSS, brandHead, logoDataUrl } from "./brand.js";

export interface ConnectionWindowDeps {
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
}

/**
 * Janela "Conexão" do agente: mostra API, status ao vivo e permite
 * trocar de loja/servidor (apaga o token e relança no assistente).
 * HTML lê o próprio config do disco (nodeIntegration local).
 */
export function buildConnectionHtml(opts: { configPath: string; apiUrl: string }): string {
  const injected = JSON.stringify({ configPath: opts.configPath, apiUrl: opts.apiUrl });
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>PrintBridge — Conexão</title>
<style>
${BRAND_CSS}
.row{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #27272a;font-size:13px}
.row:last-child{border-bottom:0}.k{color:#a1a1aa}.v{color:#fafafa;word-break:break-all;text-align:right}
.ok{color:#6ee7b7}.bad{color:#fca5a5}
button{width:100%;height:42px;margin-top:12px;border-radius:8px;font-weight:800;font-size:14px;cursor:pointer;border:0}
#swap{background:#27272a;color:#fafafa}#swap:hover{background:#3f3f46}
#close{background:#fafafa;color:#09090b}#close:hover{background:#e4e4e7}
#msg{font-size:12px;color:#a1a1aa;margin-top:8px;min-height:16px}
</style></head><body>
<div class="wrap">
${brandHead(logoDataUrl())}
<div class="card">
<h1>Conexão</h1>
<div class="row"><span class="k">Servidor</span><span class="v" id="api">…</span></div>
<div class="row"><span class="k">Status</span><span class="v" id="status">verificando…</span></div>
<div class="row"><span class="k">Impressoras</span><span class="v" id="printers">…</span></div>
<button id="swap">Trocar de loja / servidor</button>
<button id="close">Fechar</button>
<div id="msg"></div>
</div>
<script>
(function(){
const CFG = ${injected};
const fs = require('fs');
function cfg() { try { return JSON.parse(fs.readFileSync(CFG.configPath, 'utf8')); } catch(e) { return {}; } }
async function refresh() {
  const c = cfg();
  document.getElementById('api').textContent = c.apiBaseUrl || CFG.apiUrl || '—';
  const st = document.getElementById('status'), pr = document.getElementById('printers');
  if (!c.token) { st.innerHTML = '<span class="bad">sem token</span>'; pr.textContent = '—'; return; }
  try {
    const h = await fetch(c.apiBaseUrl + '/health');
    if (!h.ok) throw new Error('HTTP ' + h.status);
    const r = await fetch(c.apiBaseUrl + '/print-agent/printers', { headers: { Authorization: 'Bearer ' + c.token } });
    if (r.status === 401) throw new Error('token inválido ou revogado');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const printers = (await r.json()).printers || [];
    st.innerHTML = '<span class="ok">conectado</span>';
    pr.textContent = printers.length ? printers.map(p => p.name).join(', ') : 'nenhuma sincronizada';
  } catch(e) { st.innerHTML = '<span class="bad">fora do ar</span>'; pr.textContent = e.message || e; }
}
document.getElementById('swap').onclick = function(){
  const c = cfg(); delete c.token;
  fs.writeFileSync(CFG.configPath, JSON.stringify(c, null, 2), { mode: 0o600 });
  document.getElementById('msg').textContent = 'Token apagado — o agente vai voltar ao assistente.';
};
document.getElementById('close').onclick = function(){ window.close(); };
refresh();
})();
</script></body></html>`;
}

/** Abre a janela; o chamador fecha quando quiser (botão Fechar da página). */
export function openConnectionWindow(
  deps: ConnectionWindowDeps,
  opts: { configPath: string; apiUrl: string },
): { close(): void } {
  const win = new deps.BrowserWindow({
    width: 500,
    height: 560,
    resizable: false,
    autoHideMenuBar: true,
    title: "PrintBridge — Conexão",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildConnectionHtml(opts))}`);
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  } catch {
    // Electron antigo — will-navigate já cobre
  }
  return { close: () => { if (!win.isDestroyed()) win.close(); } };
}
