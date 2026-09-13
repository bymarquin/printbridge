/** Painel admin do dono — servido em GET /app/admin (HTML único, sem build). */
export const ADMIN_HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PrintBridge — Admin</title>
<style>
:root{color-scheme:dark}body{font-family:Segoe UI,Arial,sans-serif;background:#141422;color:#eee;margin:0;padding:20px;max-width:1100px}
h1{margin:0 0 4px}h2{margin-top:28px;border-bottom:1px solid #333;padding-bottom:6px}
.card{background:#1e1e33;border-radius:8px;padding:14px;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #2c2c48}
th{color:#999;font-weight:normal}input,select{padding:8px;border-radius:5px;border:1px solid #555;background:#111;color:#eee;margin:4px 4px 4px 0}
button{background:#00b4a0;border:0;color:#001;padding:8px 14px;border-radius:6px;font-weight:bold;cursor:pointer;margin:4px 4px 4px 0}
button.danger{background:#e5484d;color:#fff}button.ghost{background:#333;color:#eee}
.badge{padding:2px 8px;border-radius:10px;font-size:12px}.ok{background:#123f2a;color:#7dffb0}.bad{background:#4a1d1d;color:#ff9a9a}.warn{background:#4a3a12;color:#ffd47d}.mut{background:#333;color:#bbb}
code{background:#000;padding:2px 6px;border-radius:4px;word-break:break-all}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:end}
label{font-size:12px;color:#999;display:block}
#login{max-width:420px;margin:60px auto;text-align:center}
.hidden{display:none}
</style></head><body>
<div id="login" class="card">
<h1>🖨️ PrintBridge</h1><p>Painel do dono — cole a chave owner (<code>x-setup-key</code>)</p>
<input id="key" type="text" placeholder="OWNER_SETUP_KEY" style="width:100%;box-sizing:border-box">
<button onclick="entrar()">Entrar</button>
<div id="loginErr" style="color:#ff8080"></div>
</div>
<div id="app" class="hidden">
<h1>🖨️ PrintBridge <span class="badge mut" id="apiInfo"></span></h1>
<div class="row"><button class="ghost" onclick="sair()">Sair</button><button class="ghost" onclick="recarregar()">↻ Atualizar tudo</button></div>

<h2>🏪 Lojas</h2>
<div class="card"><div class="row">
<div><label>Nome da loja</label><input id="newLabel" placeholder="Ex.: Embraza Gringos"></div>
<div><button onclick="enroll()">Cadastrar loja</button></div>
</div><div id="enrollOut"></div></div>
<div class="card"><table><thead><tr><th>Loja</th><th>ID</th><th>Criada</th><th></th></tr></thead><tbody id="agents"></tbody></table></div>

<h2>🖨️ Impressoras</h2>
<div class="card"><table><thead><tr><th>Loja</th><th>Impressora</th><th>Padrão</th><th>Status</th><th>Vista</th></tr></thead><tbody id="printers"></tbody></table></div>

<h2>🧪 Teste de impressão</h2>
<div class="card"><div class="row">
<div><label>Loja</label><select id="tAgent"></select></div>
<div><label>Token da loja</label><input id="tToken" placeholder="pb_… (salvo no enroll)"></div>
<div><label>Impressora</label><input id="tPrinter" value="cozinha"></div>
<div><label>Texto</label><input id="tText" value="TESTE PrintBridge"></div>
<div><label>Cópias</label><input id="tCopies" value="1" style="width:60px"></div>
<div><button onclick="testPrint()">Imprimir teste</button></div>
</div><div id="testOut"></div></div>

<h2>📋 Jobs recentes</h2>
<div class="card"><table><thead><tr><th>Pedido/Key</th><th>Impressora</th><th>Status</th><th>Tent.</th><th>Erro</th><th></th></tr></thead><tbody id="jobs"></tbody></table></div>

<h2>🔔 Webhooks</h2>
<div class="card"><div class="row">
<div><label>URL https</label><input id="wUrl" placeholder="https://seu-sistema.com/hooks/print" style="width:320px"></div>
<div><button onclick="addWebhook()">Assinar tudo</button></div>
</div></div>
<div class="card"><table><thead><tr><th>ID</th><th>URL</th><th>Eventos</th><th></th></tr></thead><tbody id="hooks"></tbody></table></div>
</div>
<script>
(function(){
const $ = id => document.getElementById(id);
const base = location.origin;
let KEY = sessionStorage.getItem('pb_owner') || '';
let TOKENS = JSON.parse(localStorage.getItem('pb_tokens') || '{}');

async function api(path, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'x-setup-key': KEY }, opts.headers || {});
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
  return data;
}
function bearer(agentId) {
  const t = TOKENS[agentId] || $('tToken').value.trim();
  if (!t) { alert('Cole o token da loja (mostrado uma vez no cadastro)'); throw new Error('sem token'); }
  return t;
}
window.entrar = async function() {
  KEY = $('key').value.trim();
  try {
    await api('/print-agent/agents');
    sessionStorage.setItem('pb_owner', KEY);
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    $('apiInfo').textContent = base;
    await recarregar();
  } catch (e) { $('loginErr').textContent = '❌ ' + e.message; }
};
window.sair = function() { sessionStorage.removeItem('pb_owner'); location.reload(); };
window.recarregar = async function() { await Promise.all([loadAgents(), loadPrinters(), loadJobs(), loadHooks()]); };

window.loadAgents = async function() {
  const d = await api('/print-agent/agents');
  $('agents').innerHTML = d.agents.map(a =>
    '<tr><td><b>' + esc(a.label) + '</b></td><td><code>' + a.id + '</code></td><td>' + fmt(a.createdAt) + '</td>' +
    '<td><button class="danger" onclick="revogar(\\'' + a.id + '\\')">Revogar</button></td></tr>').join('') || '<tr><td colspan=4>Nenhuma loja.</td></tr>';
  $('tAgent').innerHTML = d.agents.map(a => '<option value="' + a.id + '">' + esc(a.label) + '</option>').join('');
};
window.enroll = async function() {
  const label = $('newLabel').value.trim();
  if (!label) return alert('Dê um nome à loja');
  const d = await api('/print-agent/enroll', { method: 'POST', body: { label } });
  TOKENS[d.agentId] = d.token;
  localStorage.setItem('pb_tokens', JSON.stringify(TOKENS));
  $('enrollOut').innerHTML = '<p>✅ Loja criada! Token (aparece <b>uma vez</b>, já salvo neste navegador):<br><code>' + d.token + '</code></p>';
  $('newLabel').value = '';
  await loadAgents();
};
window.revogar = async function(id) {
  if (!confirm('Revogar acesso da loja ' + id + '? O agente dela para de funcionar.')) return;
  await api('/print-agent/agents/' + id, { method: 'DELETE' });
  delete TOKENS[id];
  localStorage.setItem('pb_tokens', JSON.stringify(TOKENS));
  await loadAgents();
};

window.loadPrinters = async function() {
  const d = await api('/print-agent/printers/all');
  const cls = s => s === 'ready' ? 'ok' : (s === 'offline' ? 'bad' : 'warn');
  $('printers').innerHTML = d.printers.map(p =>
    '<tr><td>' + esc(p.agent) + '</td><td><b>' + esc(p.name) + '</b></td><td>' + (p.isDefault ? '⭐' : '') + '</td>' +
    '<td><span class="badge ' + cls(p.derivedStatus) + '">' + p.derivedStatus + '</span></td><td>' + fmt(p.lastSeenAt) + '</td></tr>').join('') || '<tr><td colspan=5>Nenhuma impressora sincronizada.</td></tr>';
};

window.testPrint = async function() {
  const agentId = $('tAgent').value;
  const t = bearer(agentId);
  if ($('tToken').value.trim()) { TOKENS[agentId] = $('tToken').value.trim(); localStorage.setItem('pb_tokens', JSON.stringify(TOKENS)); }
  const key = 'teste-' + Date.now();
  const d = await api('/print-agent/jobs', { method: 'POST', headers: { Authorization: 'Bearer ' + t },
    body: { idempotencyKey: key, payloadType: 'raw', payloadBase64: btoa(unescape(encodeURIComponent($('tText').value + '\\n'))),
      printerId: $('tPrinter').value.trim() || 'cozinha', copies: Number($('tCopies').value) || 1 } });
  $('testOut').innerHTML = '<p>✅ Job <code>' + d.job.id + '</code> (' + (d.deduplicated ? 'deduplicado' : 'criado') + ') — <button onclick="jobStatus(\\'' + d.job.id + '\\')">ver status</button></p>';
  await loadJobs();
};
window.jobStatus = async function(id) {
  const agentId = $('tAgent').value;
  const d = await api('/print-agent/jobs/' + id, { headers: { Authorization: 'Bearer ' + bearer(agentId) } });
  alert('Job ' + id + '\\nStatus: ' + d.job.status + '\\nTentativas: ' + d.job.attempts + '\\nErro: ' + (d.job.lastError || '—'));
};

window.loadJobs = async function() {
  const d = await api('/print-agent/jobs/recent?limit=30');
  const cls = s => s === 'completed' ? 'ok' : (s === 'failed' ? 'bad' : (s === 'pending' ? 'warn' : 'mut'));
  $('jobs').innerHTML = d.jobs.map(j =>
    '<tr><td><code>' + esc((j.orderId || j.idempotencyKey || '').slice(0, 24)) + '</code></td><td>' + esc(j.printerId) + '</td>' +
    '<td><span class="badge ' + cls(j.status) + '">' + j.status + '</span></td><td>' + j.attempts + '</td>' +
    '<td>' + esc((j.lastError || '').slice(0, 60)) + '</td>' +
    '<td>' + (j.status === 'failed' ? '<button onclick="retryJob(\\'' + j.id + '\\')">Retry</button>' : '') + '</td></tr>').join('') || '<tr><td colspan=6>Nenhum job.</td></tr>';
};
window.retryJob = async function(id) {
  const agentId = $('tAgent').value;
  await api('/print-agent/jobs/' + id, { method: 'PATCH', headers: { Authorization: 'Bearer ' + bearer(agentId) }, body: { status: 'pending' } });
  await loadJobs();
};

window.loadHooks = async function() {
  const d = await api('/print-agent/webhooks');
  $('hooks').innerHTML = d.webhooks.map(w =>
    '<tr><td><code>' + w.id + '</code></td><td>' + esc(w.url) + '</td><td>' + w.events.join(', ') + '</td>' +
    '<td><button class="danger" onclick="delHook(\\'' + w.id + '\\')">Excluir</button></td></tr>').join('') || '<tr><td colspan=4>Nenhum webhook.</td></tr>';
};
window.addWebhook = async function() {
  const url = $('wUrl').value.trim();
  if (!url) return alert('Cole a URL https');
  const d = await api('/print-agent/webhooks', { method: 'POST', body: { url } });
  alert('Webhook criado! Secret (uma vez):\\n' + d.webhook.secret);
  $('wUrl').value = '';
  await loadHooks();
};
window.delHook = async function(id) {
  if (!confirm('Excluir webhook ' + id + '?')) return;
  await api('/print-agent/webhooks/' + id, { method: 'DELETE' });
  await loadHooks();
};

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function fmt(iso) { try { return new Date(iso).toLocaleString('pt-BR'); } catch (e) { return iso; } }
if (KEY) { $('key').value = KEY; entrar(); }
})();
</script></body></html>`;
