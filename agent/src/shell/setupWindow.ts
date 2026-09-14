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
*{box-sizing:border-box}body{font-family:Inter,"Segoe UI",Arial,sans-serif;background:#09090b;color:#f4f4f5;margin:0;padding:24px;display:flex;justify-content:center}
.wrap{width:100%;max-width:420px}.brand{display:flex;align-items:center;gap:10px;margin:8px 0 4px}
.dot{width:36px;height:36px;border-radius:10px;background:#2dd4bf;color:#09090b;font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center}
.brand b{font-size:17px;letter-spacing:-.02em}.brand small{display:block;color:#a1a1aa;font-size:12px;font-weight:400}
.card{background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px;margin-top:16px}
h1{font-size:18px;margin:0;letter-spacing:-.01em}.sub{color:#a1a1aa;font-size:13px;margin:4px 0 0}
label{display:block;margin:14px 0 6px;font-size:12px;font-weight:500;color:#a1a1aa}
input[type=text]{width:100%;height:40px;padding:0 12px;border-radius:6px;border:1px solid #3f3f46;background:#09090b;color:#f4f4f5;font-size:14px;outline:none}
input[type=text]:focus{border-color:#fafafa}
.check{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:#d4d4d8;cursor:pointer}
button#go{width:100%;height:40px;margin-top:16px;background:#fafafa;border:0;color:#09090b;font-weight:700;font-size:14px;border-radius:6px;cursor:pointer}
button#go:hover{background:#e4e4e7}button#go:disabled{opacity:.6;cursor:wait}
#error{color:#fca5a5;margin-top:12px;font-size:13px;white-space:pre-wrap}
#ok{color:#6ee7b7;margin-top:12px;font-size:13px}
</style></head><body>
<div class="wrap">
<div class="brand"><div class="dot">P</div><div><b>PrintBridge</b><small>Impressão para estabelecimentos</small></div></div>
<div class="card">
<h1>Bem-vindo(a)</h1>
<p class="sub">Conecte este computador ao servidor da loja. Precisa só uma vez.</p>
<label>Endereço da API (VPS)</label>
<input id="api" type="text" placeholder="URL da sua API">
<label class="check"><input id="haveToken" type="checkbox"> Já tenho o token do agente</label>
<div id="tokenBox" style="display:none">
<label>Token da sua loja</label><input id="token" type="text">
</div>
<div id="enrollBox">
<label>Chave de instalação (owner)</label><input id="setupKey" type="text">
<label>Nome deste computador</label><input id="label" type="text" placeholder="Nome do seu computador">
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
  const normalizeApi = (v) => v.trim().replace(/\\/$/,'')
    .replace(/\\/print-agent(\\/enroll)?\\/?$/,'') || v.trim();
  try {
    const api = normalizeApi(document.getElementById('api').value);
    if (!/^https?:\\/\\//.test(api)) throw new Error('endereço inválido — use https://sua-api (somente o início, sem /print-agent/...)');
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
