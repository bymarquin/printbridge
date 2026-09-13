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
body{font-family:Segoe UI,Arial,sans-serif;background:#1a1a2e;color:#eee;margin:0;padding:24px;max-width:460px}
h2{margin-top:0}.card{background:#242442;border-radius:8px;padding:16px;margin:12px 0}
label{display:block;margin:8px 0 4px;font-size:13px;color:#bbb}
input[type=text]{width:100%;padding:8px;border-radius:4px;border:1px solid #555;background:#111;color:#eee;box-sizing:border-box}
button{background:#00b4a0;border:0;color:#001;padding:10px 16px;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:12px}
#error{color:#ff8080;margin-top:10px;white-space:pre-wrap}#ok{color:#7dffb0;margin-top:10px}
.small{font-size:12px;color:#999}
</style></head><body>
<h2>🖨️ PrintBridge Agent</h2>
<p class="small">Conecte este computador ao servidor da loja. Precisa só uma vez.</p>
<div class="card">
<label>Endereço da API (VPS)</label>
<input id="api" type="text" placeholder="https://impressao.sualoja.com">
<label><input id="haveToken" type="checkbox"> Já tenho o token do agente</label>
<div id="tokenBox" style="display:none">
<label>Token (pb_…)</label><input id="token" type="text">
</div>
<div id="enrollBox">
<label>Chave de instalação (owner)</label><input id="setupKey" type="text">
<label>Nome deste computador</label><input id="label" type="text" placeholder="caixa-1">
</div>
<button id="go">Conectar</button>
<div id="error"></div><div id="ok"></div>
</div>
<script>
(function(){
const CFG = ${injected};
const fs = require('fs'), path = require('path');
document.getElementById('haveToken').onchange = function(e){
  document.getElementById('tokenBox').style.display = e.target.checked ? 'block' : 'none';
  document.getElementById('enrollBox').style.display = e.target.checked ? 'none' : 'block';
};
document.getElementById('api').value = CFG.apiUrl;
document.getElementById('go').onclick = async function(){
  const err = document.getElementById('error'), ok = document.getElementById('ok');
  err.textContent = ''; ok.textContent = 'Conectando…';
  try {
    const api = document.getElementById('api').value.replace(/\\/$/,'');
    let token;
    if (document.getElementById('haveToken').checked) {
      token = document.getElementById('token').value.trim();
      if (!token) throw new Error('cole o token do agente');
      const r = await fetch(api + '/print-agent/jobs?limit=1', { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 401) throw new Error('token inválido');
      if (!r.ok) throw new Error('API respondeu HTTP ' + r.status);
    } else {
      const setupKey = document.getElementById('setupKey').value.trim();
      const label = document.getElementById('label').value.trim() || 'loja';
      const r = await fetch(api + '/print-agent/enroll', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-setup-key': setupKey },
        body: JSON.stringify({ label }) });
      if (r.status === 403) throw new Error('chave de instalação inválida');
      if (!r.ok) throw new Error('enroll falhou: HTTP ' + r.status);
      token = (await r.json()).token;
    }
    fs.mkdirSync(path.dirname(CFG.configPath), { recursive: true });
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(CFG.configPath, 'utf8')); } catch(e) {}
    fs.writeFileSync(CFG.configPath,
      JSON.stringify(Object.assign({}, prev, { apiBaseUrl: api, token }), null, 2),
      { mode: 0o600 });
    ok.textContent = '✅ Conectado! O agente vai iniciar sozinho.';
  } catch(e) { ok.textContent = ''; err.textContent = '❌ ' + (e.message || e); }
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
    height: 620,
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
