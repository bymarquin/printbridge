import { BRAND_CSS, brandHead, logoDataUrl } from "./brand.js";

export interface SetupWindowDeps {
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
 * HTML do assistente de primeira execução (data URL, nodeIntegration local).
 * Puro e testável: recebe o caminho do config e a URL default da API.
 */
export function buildSetupHtml(opts: { configPath: string; apiUrl: string }): string {
  const injected = JSON.stringify({ configPath: opts.configPath, apiUrl: opts.apiUrl });
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>PrintBridge — Configuração</title>
<style>
${BRAND_CSS}
.check{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:#d4d4d8;cursor:pointer}
button#go{width:100%;height:42px;margin-top:16px;background:#fafafa;border:0;color:#09090b;font-weight:800;font-size:14px;border-radius:8px;cursor:pointer}
button#go:hover{background:#e4e4e7}
</style></head><body>
<div class="wrap">
${brandHead(logoDataUrl())}
<div class="card">
<h1>Bem-vindo(a)</h1>
<p class="sub">Conecte este computador ao servidor da loja. Precisa só uma vez.</p>
<label>Servidor</label>
<p style="margin:0 0 4px;font-size:14px;color:#fafafa" id="apiFixed"></p>
<a href="#" id="apiChange" style="font-size:12px;color:#71717a">trocar servidor (avançado)</a>
<input id="api" type="text" style="display:none" placeholder="URL da sua API">
<label>Token da loja</label><input id="token" type="text" placeholder="Token gerado no painel">
<p class="sub" style="margin-top:8px">No painel, vá em Lojas → Cadastrar. O token aparece uma única vez.</p>
<label>Nome deste computador</label><input id="label" type="text" placeholder="Nome do seu computador">
<button id="go">Conectar</button>
<div id="error"></div><div id="ok"></div>
</div>
<script>
(function(){
const CFG = ${injected};
const fs = require('fs'), path = require('path');
const normalizeApi = (v) => v.trim().replace(/\/$/,'')
  .replace(/\/print-agent(\/enroll)?\/?$/,'') || v.trim();
// fetch com timeout: sem isso, rede travada = "Conectando…" para sempre.
async function tfetch(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 15000);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } catch(e) {
    throw new Error(e.name === 'AbortError' ? 'sem resposta da API em 15s — confira o endereço e a internet' : (e.message || e));
  } finally { clearTimeout(t); }
}
document.getElementById('api').value = CFG.apiUrl;
document.getElementById('apiFixed').textContent = CFG.apiUrl;
try { document.getElementById('label').value = require('os').hostname(); } catch(e) {}
document.getElementById('apiChange').onclick = function(e){
  e.preventDefault();
  const inp = document.getElementById('api');
  inp.style.display = inp.style.display === 'none' ? 'block' : 'none';
};
document.getElementById('go').onclick = async function(){
  const err = document.getElementById('error'), ok = document.getElementById('ok');
  err.textContent = ''; ok.textContent = 'Conectando…';
  try {
    const api = normalizeApi(document.getElementById('api').value);
    if (!/^https?:\/\//.test(api)) throw new Error('endereço inválido — use https://sua-api');
    const token = document.getElementById('token').value.trim();
    if (!token) throw new Error('cole o token gerado no painel');
    const me = await tfetch(api + '/print-agent/me', { headers: { Authorization: 'Bearer ' + token } });
    if (me.status === 401) throw new Error('token inválido ou revogado');
    if (!me.ok) throw new Error('falhou: HTTP ' + me.status);
    const label = (await me.json()).agent.label;
    const computerName = document.getElementById('label').value.trim();
    fs.mkdirSync(path.dirname(CFG.configPath), { recursive: true });
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(CFG.configPath, 'utf8')); } catch(e) {}
    fs.writeFileSync(CFG.configPath,
      JSON.stringify(Object.assign({}, prev, { apiBaseUrl: api, token, computerName: computerName || undefined }), null, 2),
      { mode: 0o600 });
    ok.textContent = 'Conectado como ' + label + '. O agente vai iniciar sozinho.';
  } catch(e) { ok.textContent = ''; err.textContent = (e.message || e); }
};
})();
</script></body></html>`;
}

export interface SetupHandle {
  close(): void;
  /** Chamado quando o usuário fecha a janela no X (sem concluir). */
  onClosed(fn: () => void): void;
}

/** Abre o assistente; o chamador detecta conclusão observando o arquivo de config. */
export function openSetupWindow(
  deps: SetupWindowDeps,
  opts: { configPath: string; apiUrl: string },
): SetupHandle {
  const win = new deps.BrowserWindow({
    width: 520,
    height: 600,
    resizable: false,
    autoHideMenuBar: true,
    title: "PrintBridge — Configuração",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  const html = buildSetupHtml(opts);
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  // Página é data URL local, mas trava navegação mesmo assim (anti-RCE futuro).
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  } catch {
    // Electron antigo sem setWindowOpenHandler — will-navigate já cobre
  }
  return {
    close: () => { if (!win.isDestroyed()) win.close(); },
    onClosed: (fn) => win.on("closed", fn),
  };
}
