export interface DiagBrowserWindow {
  loadURL(url: string): Promise<void>;
  isDestroyed(): boolean;
  webContents: {
    executeJavaScript(code: string): Promise<unknown>;
  };
}

export interface DiagnoseHandle {
  step(name: string, ok: boolean, detail?: string): Promise<void>;
  fail(message: string): Promise<void>;
  close(): void;
}

const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>PrintBridge — Diagnóstico</title>
<style>
body{font-family:Consolas,monospace;background:#09090b;color:#e4e4e7;margin:0;padding:20px}
h2{font-size:14px;margin:0 0 12px;color:#a1a1aa}ul{list-style:none;margin:0;padding:0}
li{padding:6px 0;border-bottom:1px solid #27272a;font-size:13px}
.ok{color:#6ee7b7}.bad{color:#fca5a5}.dim{color:#71717a;font-size:11px}
#fail{display:none;margin-top:12px;padding:10px;border:1px solid #7f1d1d;border-radius:6px;background:#450a0a;color:#fecaca;font-size:12px;white-space:pre-wrap}
</style></head><body>
<h2>PrintBridge — boot (modo diagnóstico)</h2>
<ul id="steps"></ul>
<div id="fail"></div>
<script>
window.__pbDiag = function(name, ok, detail) {
  var li = document.createElement('li');
  li.innerHTML = '<span class="' + (ok ? 'ok">● ' : 'bad">● ') + '</span>' +
    name.replace(/&/g,'&amp;').replace(/</g,'&lt;') +
    (detail ? ' <span class="dim">' + detail.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>' : '');
  document.getElementById('steps').appendChild(li);
};
window.__pbFail = function(msg) {
  var f = document.getElementById('fail');
  f.style.display = 'block';
  f.textContent = msg;
};
</script></body></html>`;

/** Janela que narra o boot passo a passo. Sem Electron real aqui: BrowserWindow injetado. */
export async function createDiagnoseWindow(
  BrowserWindow: new (opts: Record<string, unknown>) => DiagBrowserWindow,
): Promise<DiagnoseHandle> {
  const win = new BrowserWindow({
    width: 560,
    height: 480,
    autoHideMenuBar: true,
    title: "PrintBridge — Diagnóstico",
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  const js = (code: string): Promise<void> =>
    win.isDestroyed() ? Promise.resolve() : win.webContents.executeJavaScript(code).then(() => {});
  return {
    step: (name, ok, detail) =>
      js(`window.__pbDiag(${JSON.stringify(name)},${ok ? "true" : "false"},${JSON.stringify(detail ?? "")})`),
    fail: (message) => js(`window.__pbFail(${JSON.stringify(message)})`),
    close: () => {},
  };
}
