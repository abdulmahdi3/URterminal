/**
 * The web/mobile dashboard (#25) served by the local control server at `/`.
 * Self-contained HTML + vanilla JS (no build step, no deps). All data calls are
 * token-gated; the page reads the token from `?token=` (or localStorage) and
 * talks only to its own loopback origin. Live pane output streams over SSE.
 *
 * NOTE: the inner script deliberately uses string concatenation (no backticks,
 * no ${...}) so it nests cleanly inside this TS template literal.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<title>URterminal</title>
<style>
  :root { --bg:#0f1115; --elev:#171a21; --elev2:#1e222b; --border:#2a2f3a; --text:#e6e8ee; --dim:#9aa3b2; --accent:#5b8cff; --ok:#22c55e; --err:#ef4444; }
  * { box-sizing:border-box; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
  header { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border); background:var(--elev); }
  header .dot { width:8px; height:8px; border-radius:50%; background:var(--err); }
  header .dot.on { background:var(--ok); }
  header h1 { font-size:15px; margin:0; font-weight:600; }
  header .sp { flex:1; }
  .tabs { display:flex; gap:6px; overflow-x:auto; padding:8px 14px; border-bottom:1px solid var(--border); }
  .tab { white-space:nowrap; padding:4px 12px; border-radius:999px; background:var(--elev2); border:1px solid var(--border); color:var(--dim); cursor:pointer; font-size:13px; }
  .tab.active { color:#fff; background:var(--accent); border-color:var(--accent); }
  main { display:flex; height:calc(100% - 98px); }
  .panes { width:240px; flex:0 0 240px; border-right:1px solid var(--border); overflow-y:auto; padding:8px; }
  .pane { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer; }
  .pane:hover { background:var(--elev); }
  .pane.sel { background:var(--elev2); outline:1px solid var(--accent); }
  .pane .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  .pane .ty { font-size:11px; color:var(--dim); }
  .pane .x { color:var(--dim); border:none; background:none; cursor:pointer; font-size:14px; padding:0 4px; }
  .pane .x:hover { color:var(--err); }
  .new { display:flex; gap:6px; padding:8px 4px; }
  .new button { flex:1; }
  button.btn { background:var(--elev2); color:var(--text); border:1px solid var(--border); border-radius:7px; padding:6px 10px; cursor:pointer; font-size:13px; }
  button.btn:hover { border-color:var(--accent); }
  button.btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .view { flex:1; display:flex; flex-direction:column; min-width:0; }
  pre.out { flex:1; margin:0; overflow:auto; padding:12px 14px; white-space:pre-wrap; word-break:break-word; font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; color:#cfd6e4; }
  .composer { display:flex; gap:8px; padding:10px; border-top:1px solid var(--border); background:var(--elev); }
  .composer textarea { flex:1; resize:none; height:42px; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:9px 11px; font:14px -apple-system,sans-serif; }
  .composer textarea:disabled { opacity:.5; }
  .empty { margin:auto; color:var(--dim); text-align:center; padding:24px; }
  .gate { max-width:340px; margin:60px auto; padding:0 16px; text-align:center; }
  .gate input { width:100%; margin:10px 0; padding:9px 11px; background:var(--bg); border:1px solid var(--border); color:var(--text); border-radius:8px; }
  @media (max-width:680px) {
    main { flex-direction:column; height:calc(100% - 98px); }
    .panes { width:100%; flex:0 0 auto; max-height:38%; border-right:none; border-bottom:1px solid var(--border); }
  }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function () {
  var qs = new URLSearchParams(location.search);
  var TOKEN = qs.get('token') || localStorage.getItem('urt_token') || '';
  if (TOKEN) localStorage.setItem('urt_token', TOKEN);
  var selected = null, es = null, app = document.getElementById('app'), outEl = null, inputEl = null;

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + TOKEN }, opts.headers || {});
    return fetch(path, opts);
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function gate(msg) {
    app.innerHTML = '';
    var d = document.createElement('div'); d.className = 'gate';
    var h = document.createElement('h2'); h.textContent = 'URterminal dashboard';
    var p = document.createElement('p'); p.style.color = 'var(--dim)'; p.textContent = msg || 'Enter your control-server access token.';
    var i = document.createElement('input'); i.placeholder = 'access token'; i.value = '';
    var b = document.createElement('button'); b.className = 'btn primary'; b.textContent = 'Connect'; b.style.width = '100%';
    b.onclick = function () { TOKEN = i.value.trim(); if (TOKEN) { localStorage.setItem('urt_token', TOKEN); boot(); } };
    i.onkeydown = function (e) { if (e.key === 'Enter') b.onclick(); };
    d.appendChild(h); d.appendChild(p); d.appendChild(i); d.appendChild(b); app.appendChild(d);
  }
  function setDot(on) { var dot = document.querySelector('header .dot'); if (dot) dot.className = 'dot' + (on ? ' on' : ''); }

  function shell() {
    app.innerHTML = '';
    var hdr = document.createElement('header');
    var dot = document.createElement('span'); dot.className = 'dot';
    var h1 = document.createElement('h1'); h1.textContent = 'URterminal';
    var sp = document.createElement('span'); sp.className = 'sp';
    hdr.appendChild(dot); hdr.appendChild(h1); hdr.appendChild(sp);
    var tabs = document.createElement('div'); tabs.className = 'tabs'; tabs.id = 'tabs';
    var m = document.createElement('main');
    var panes = document.createElement('div'); panes.className = 'panes'; panes.id = 'panes';
    var view = document.createElement('div'); view.className = 'view';
    outEl = document.createElement('pre'); outEl.className = 'out'; outEl.textContent = '';
    var comp = document.createElement('div'); comp.className = 'composer';
    inputEl = document.createElement('textarea'); inputEl.placeholder = 'Message the selected pane…'; inputEl.disabled = true;
    inputEl.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    var sendBtn = document.createElement('button'); sendBtn.className = 'btn primary'; sendBtn.textContent = 'Send'; sendBtn.onclick = send;
    comp.appendChild(inputEl); comp.appendChild(sendBtn);
    view.appendChild(outEl); view.appendChild(comp);
    m.appendChild(panes); m.appendChild(view);
    app.appendChild(hdr); app.appendChild(tabs); app.appendChild(m);
  }

  function render(st) {
    if (!document.querySelector('header')) shell();
    setDot(true);
    var tabs = document.getElementById('tabs'); tabs.innerHTML = '';
    (st.workspaces || []).forEach(function (w) {
      var t = document.createElement('div'); t.className = 'tab' + (w.active ? ' active' : ''); t.textContent = w.name;
      t.onclick = function () { post('/workspaces/switch', { id: w.id }); };
      tabs.appendChild(t);
    });
    var panes = document.getElementById('panes'); panes.innerHTML = '';
    var nb = document.createElement('div'); nb.className = 'new';
    var ai = document.createElement('button'); ai.className = 'btn'; ai.textContent = '+ Agent'; ai.onclick = function () { post('/panes', { type: 'ai', command: 'claude' }); };
    var sh = document.createElement('button'); sh.className = 'btn'; sh.textContent = '+ Shell'; sh.onclick = function () { post('/panes', { type: 'shell' }); };
    nb.appendChild(ai); nb.appendChild(sh); panes.appendChild(nb);
    (st.panes || []).forEach(function (p) {
      var row = document.createElement('div'); row.className = 'pane' + (p.id === selected ? ' sel' : ''); row.dataset.pid = p.id;
      var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = p.title || p.id;
      var ty = document.createElement('span'); ty.className = 'ty'; ty.textContent = p.type;
      var x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Close pane';
      x.onclick = function (e) { e.stopPropagation(); post('/panes/close', { paneId: p.id }); };
      row.appendChild(nm); row.appendChild(ty); row.appendChild(x);
      row.onclick = function () { selectPane(p.id, p.type); };
      panes.appendChild(row);
    });
    if (selected && !(st.panes || []).some(function (p) { return p.id === selected; })) {
      selected = null; if (outEl) outEl.textContent = ''; if (inputEl) inputEl.disabled = true;
    }
    if (!selected && (st.panes || []).length) selectPane(st.panes[0].id, st.panes[0].type);
  }

  function selectPane(id, type) {
    selected = id;
    document.querySelectorAll('#panes .pane').forEach(function (n) {
      n.classList.toggle('sel', n.dataset.pid === id);
    });
    inputEl.disabled = (type === 'stream' || type === 'empty');
    api('/pane/output?paneId=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (o) {
      if (selected !== id) return; // a newer selection won the race
      outEl.textContent = (o && o.output) || '';
      outEl.scrollTop = outEl.scrollHeight;
    }).catch(function () {});
  }

  function send() {
    var t = inputEl.value;
    if (!t.trim() || !selected) return;
    post('/input', { paneId: selected, text: t });
    inputEl.value = '';
  }

  function connect() {
    if (es) es.close();
    es = new EventSource('/events?token=' + encodeURIComponent(TOKEN));
    es.onopen = function () { setDot(true); };
    es.onerror = function () { setDot(false); };
    es.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.type === 'data' && m.paneId === selected) {
        outEl.textContent += m.data;
        if (outEl.textContent.length > 200000) outEl.textContent = outEl.textContent.slice(-160000);
        outEl.scrollTop = outEl.scrollHeight;
      } else if (m.type === 'state') {
        loadState();
      }
    };
  }

  function loadState() {
    api('/state').then(function (r) {
      if (r.status === 401) { gate('That token was rejected. Try again.'); return null; }
      return r.json();
    }).then(function (st) { if (st) render(st); }).catch(function () { setDot(false); });
  }

  function boot() {
    if (!TOKEN) { gate(); return; }
    shell();
    loadState();
    connect();
  }
  boot();
})();
</script>
</body>
</html>`
