#!/usr/bin/env node
// Job Inbox — local web UI (local customization). http://localhost:4317
//   • Paste a job link   → read JD, English-only check, CV score, saved to
//                          data/pipeline.md + data/matches.json, alert if it matches.
//   • Paste a careers site → added to the daily watch as a PRIORITY source
//                          (portals.yml, or a watched page if no scanner fits).
//   • See matches, mark Applied / Dismiss, run the scan now, send a test alert.
// Listens on 127.0.0.1 only.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, loadMatches, setStatus, appendPipeline, priorityCompanies, loadWatchPages, pipelineEntries } from './lib/job-store.mjs';
import { evaluatePosting, classifyUrl, addCareersSite, THRESHOLD } from './lib/job-intake.mjs';
import { notifyMatches, channelStatus } from './lib/notify.mjs';
import { syncUp, pull, isRepo } from './lib/git-sync.mjs';

const PORT = 4317;
const LOG = path.join(ROOT, 'data', 'daily-scan.log');
let running = null;
let lastSync = { at: null, ok: null, out: '' };

// Push local changes to GitHub in the background (debounced).
let syncTimer = null;
function scheduleSync(msg) {
  if (!isRepo()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const r = syncUp(msg);
    lastSync = { at: new Date().toISOString(), ...r };
  }, 3000);
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
async function readBody(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 20_000) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}
function logTail(n = 60) {
  try { return fs.readFileSync(LOG, 'utf8').split(/\r?\n/).slice(-n).join('\n'); } catch { return ''; }
}
function runDaily() {
  if (running) return false;
  const out = fs.openSync(LOG, 'a');
  fs.writeSync(out, `===== ${new Date().toLocaleString()} (Job Inbox: Run now) =====\n`);
  pull();
  running = spawn(process.execPath, ['daily-run.mjs'], { cwd: ROOT, stdio: ['ignore', out, out], windowsHide: true });
  running.on('close', () => { running = null; fs.closeSync(out); scheduleSync('PC: manual scan from Job Inbox'); });
  return true;
}

const api = {
  'GET /api/state': () => ({
    matches: loadMatches().sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0)),
    priority: priorityCompanies().map((c) => ({ name: c.name, url: c.careers_url, kind: 'scanner' }))
      .concat(loadWatchPages().map((w) => ({ name: w.name, url: w.url, kind: 'watched page', lastChecked: w.lastChecked }))),
    channels: channelStatus(),
    threshold: THRESHOLD,
    pending: pipelineEntries().filter((e) => !e.done).length,
    running: Boolean(running),
    log: logTail(),
    sync: { repo: isRepo(), ...lastSync },
  }),
  'POST /api/sync': async () => {
    const p = pull();
    const r = syncUp('PC: Job Inbox sync');
    lastSync = { at: new Date().toISOString(), ...r };
    return { ok: r.ok, message: r.ok ? `Synced with GitHub (${p.ok ? 'pulled cloud results' : 'pull: ' + p.out}).` : `Sync failed: ${r.out}` };
  },
  'POST /api/add': async (b) => {
    const url = String(b.url || '').trim();
    if (!url) return { ok: false, message: 'Paste a link first.' };
    const kind = b.kind === 'job' || b.kind === 'site' ? b.kind : await classifyUrl(url);
    if (kind === 'site') {
      const r = await addCareersSite(url, String(b.name || ''));
      if (r.ok && !r.already) scheduleSync(`PC: watch careers site ${r.name}`);
      return { kind, ...r };
    }
    const rec = await evaluatePosting({ url, company: String(b.name || ''), source: 'manual' });
    if (rec.englishIssue) {
      return { ok: true, kind, rec, message: `Saved as rejected — ${rec.englishIssue}. (English-only rule)` };
    }
    const added = appendPipeline({ ...rec, note: `manual ${new Date().toISOString().slice(0, 10)} · match ${rec.score}` });
    scheduleSync(`PC: added ${rec.company} — ${rec.title}`);
    const alert = ' It goes in the next daily digest.';
    return {
      ok: true, kind, rec,
      message: `${rec.isMatch ? '✅ Match' : 'Saved'} — ${rec.company}: ${rec.title} · score ${rec.score}/100.${added ? ' Added to pipeline.' : ' Already in pipeline.'}${alert}`,
    };
  },
  'POST /api/status': async (b) => {
    const ok = setStatus(String(b.url || ''), ['new', 'applied', 'dismissed'].includes(b.status) ? b.status : 'new');
    if (ok) scheduleSync(`PC: marked ${b.status}`);
    return { ok };
  },
  'POST /api/run': async () => ({ ok: runDaily(), message: running ? 'Scan running — results appear here when done (a few minutes).' : 'A scan is already running.' }),
  'POST /api/test-alert': async () => {
    const r = await notifyMatches([{ company: 'Job Inbox', title: 'TEST alert — Analytics Engineer', location: 'Paris, France', url: `http://localhost:${PORT}`, score: 90, hits: ['Power BI', 'SQL', 'dbt'], priority: true }], { reason: 'test alert' });
    return { ok: true, message: Object.entries(r).map(([k, v]) => `${k}: ${v.ok ? 'sent ✓' : `failed — ${v.error}`}`).join(' · ') || 'No channel configured.' };
  },
};

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || '');
  if (!/^(localhost|127\.0\.0\.1):4317$/.test(host)) return send(res, 403, { error: 'forbidden host' });
  const route = `${req.method} ${req.url.split('?')[0]}`;
  if (route === 'GET /') return send(res, 200, PAGE, 'text/html');
  const fn = api[route];
  if (!fn) return send(res, 404, { error: 'not found' });
  if (req.method === 'POST' && req.headers['x-job-inbox'] !== '1') return send(res, 403, { error: 'missing header' });
  try {
    send(res, 200, await fn(req.method === 'POST' ? await readBody(req) : {}));
  } catch (err) {
    send(res, 500, { ok: false, message: err.message });
  }
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') { console.log(`Job Inbox already running: http://localhost:${PORT}`); process.exit(0); }
  throw err;
});
server.listen(PORT, '127.0.0.1', () => console.log(`Job Inbox: http://localhost:${PORT}`));

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Inbox</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--muted:#5f6672;--line:#e3e6eb;--accent:#2457d6;--good:#147a3d;--goodbg:#e3f5ea;--mid:#8a5a00;--midbg:#fdf1d8;--bad:#a1262b;--badbg:#fbe5e6;--star:#c98a00}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1a1d24;--ink:#e8eaee;--muted:#9aa1ad;--line:#2b303a;--accent:#7aa2ff;--good:#6fd39a;--goodbg:#173a26;--mid:#f0c060;--midbg:#3a2f14;--bad:#ff8c90;--badbg:#3d1c1f;--star:#f2c14e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 "Segoe UI",system-ui,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:20px 16px 60px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
h1{font-size:22px;margin:0}h1 small{display:block;font-size:13px;font-weight:400;color:var(--muted)}
.pills{display:flex;gap:6px;flex-wrap:wrap}.pill{font-size:12px;padding:3px 9px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.pill.on{color:var(--good);border-color:var(--good)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
.add{display:grid;grid-template-columns:1fr 180px auto;gap:8px}
@media (max-width:700px){.add{grid-template-columns:1fr}}
input,button{font:inherit}input[type=url],input[type=text]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
button{padding:9px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}button:disabled{opacity:.5;cursor:wait}
.kinds{display:flex;gap:14px;margin-top:10px;font-size:13px;color:var(--muted);flex-wrap:wrap}
.msg{margin-top:10px;font-size:14px;min-height:1.2em}
.tabs{display:flex;gap:6px;margin:6px 0 12px;flex-wrap:wrap}.tabs button.sel{border-color:var(--accent);color:var(--accent);font-weight:600}
.job{display:grid;grid-template-columns:58px 1fr auto;gap:12px;align-items:start;padding:12px 0;border-top:1px solid var(--line)}
.job:first-child{border-top:0}
.score{font-weight:700;font-size:18px;text-align:center;border-radius:10px;padding:8px 0}
.s-strong{background:var(--goodbg);color:var(--good)}.s-match{background:var(--midbg);color:var(--mid)}.s-low{background:var(--bg);color:var(--muted)}.s-rej{background:var(--badbg);color:var(--bad);font-size:12px}
.t{font-weight:600}.co{color:var(--muted);font-size:13px}.star{color:var(--star)}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.chip{font-size:11.5px;padding:2px 7px;border-radius:99px;background:var(--bg);border:1px solid var(--line)}
.chip.gap{color:var(--bad);border-color:var(--badbg)}
.why{font-size:12.5px;color:var(--bad);margin-top:4px}
.acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.acts a,.acts button{font-size:13px;padding:6px 10px}
.acts a{color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:8px}
.empty{color:var(--muted);padding:18px 0;text-align:center}
.src{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:14px}.src:first-child{border-top:0}
pre{white-space:pre-wrap;font-size:12px;color:var(--muted);max-height:260px;overflow:auto;margin:8px 0 0}
details summary{cursor:pointer;font-weight:600}
.row{display:flex;gap:8px;flex-wrap:wrap}
@media (max-width:640px){.job{grid-template-columns:50px 1fr}.acts{grid-column:1/-1;justify-content:flex-start}}
</style></head><body><div class="wrap">
<header><h1>Job Inbox<small>Murali Krishna · France · English-only · data roles</small></h1>
<div class="row"><div class="pills" id="pills"></div><button id="sync">Sync now</button><button id="run">Run scan now</button><button id="test">Test alert</button></div></header>

<section class="card">
<form id="addf"><div class="add">
<input type="url" id="url" placeholder="Paste a job link or a careers-site link…" required>
<input type="text" id="name" placeholder="Company name (optional)">
<button class="primary" id="addb" type="submit">Add</button></div>
<div class="kinds"><label><input type="radio" name="k" value="auto" checked> Detect automatically</label>
<label><input type="radio" name="k" value="job"> It's one job posting</label>
<label><input type="radio" name="k" value="site"> It's a careers site — watch it daily (priority)</label></div>
<div class="msg" id="msg"></div></form>
</section>

<section class="card"><div class="tabs" id="tabs"></div><div id="list"></div></section>

<section class="card"><details><summary>Priority sources (scanned first every morning)</summary><div id="srcs" style="margin-top:8px"></div></details></section>
<section class="card"><details><summary>Last scan log</summary><pre id="log"></pre></details></section>
</div>
<script>
const H={'content-type':'application/json','x-job-inbox':'1'};
let S=null,tab='matches';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function post(p,b){const r=await fetch(p,{method:'POST',headers:H,body:JSON.stringify(b||{})});return r.json()}
function filt(){const m=S.matches;return{
 matches:m.filter(x=>x.isMatch&&x.status==='new'),
 all:m.filter(x=>!x.englishIssue&&x.status!=='dismissed'),
 applied:m.filter(x=>x.status==='applied'),
 rejected:m.filter(x=>x.englishIssue),
 dismissed:m.filter(x=>x.status==='dismissed'&&!x.englishIssue)}}
const LABEL={matches:'Matches',all:'All English postings',applied:'Applied',rejected:'Rejected (French)',dismissed:'Dismissed'};
function render(){
 const c=S.channels,sy=S.sync||{};document.getElementById('pills').innerHTML=[['Popup',c.desktop],['Gmail',c.gmail],['WhatsApp',c.whatsapp]].map(([n,o])=>'<span class="pill '+(o?'on':'')+'">'+n+' '+(o?'✓':'– not set')+'</span>').join('')
  +'<span class="pill '+(sy.repo&&sy.ok!==false?'on':'')+'" title="'+esc(sy.out||'')+'">GitHub '+(!sy.repo?'– not linked':sy.ok===false?'⚠ sync failed':sy.at?'✓ synced '+new Date(sy.at).toLocaleTimeString():'✓')+'</span>';
 const F=filt();document.getElementById('tabs').innerHTML=Object.keys(LABEL).map(k=>'<button data-t="'+k+'" class="'+(k===tab?'sel':'')+'">'+LABEL[k]+' ('+F[k].length+')</button>').join('');
 const L=F[tab];document.getElementById('list').innerHTML=L.length?L.map(job).join(''):'<div class="empty">'+(tab==='matches'?'No new matches yet. The 08:00 scan checks Allianz France first, then everything else.':'Nothing here.')+'</div>';
 document.getElementById('srcs').innerHTML=S.priority.map(p=>'<div class="src"><span>⭐ <b>'+esc(p.name)+'</b> <span class="co">· '+esc(p.kind)+'</span></span><a href="'+esc(p.url)+'" target="_blank" rel="noopener">'+esc(p.url)+'</a></div>').join('')||'<div class="empty">None yet.</div>';
 document.getElementById('log').textContent=S.log||'No runs yet.';
 const rb=document.getElementById('run');rb.disabled=S.running;rb.textContent=S.running?'Scanning…':'Run scan now';
}
function job(m){
 const cls=m.englishIssue?'s-rej':m.verdict==='strong'?'s-strong':m.verdict==='match'?'s-match':'s-low';
 return '<div class="job"><div class="score '+cls+'">'+(m.englishIssue?'FR':m.score)+'</div><div>'
 +'<div class="t">'+(m.priority?'<span class="star">⭐ </span>':'')+esc(m.title)+'</div>'
 +'<div class="co">'+esc(m.company)+' · '+esc(m.location||'France')+(m.posted?' · posted '+esc(m.posted):'')+' · '+esc(m.source)+(m.statedYears?' · asks '+m.statedYears+'+ yrs':'')+'</div>'
 +(m.englishIssue?'<div class="why">'+esc(m.englishIssue)+'</div>':'')
 +'<div class="chips">'+(m.hits||[]).map(h=>'<span class="chip">'+esc(h)+'</span>').join('')+(m.gaps||[]).map(g=>'<span class="chip gap">gap: '+esc(g)+'</span>').join('')+'</div></div>'
 +'<div class="acts"><a href="'+esc(m.url)+'" target="_blank" rel="noopener">Open</a>'
 +(m.status!=='applied'?'<button data-s="applied" data-u="'+esc(m.url)+'">Applied</button>':'')
 +(m.status!=='dismissed'?'<button data-s="dismissed" data-u="'+esc(m.url)+'">Dismiss</button>':'<button data-s="new" data-u="'+esc(m.url)+'">Restore</button>')+'</div></div>';
}
async function load(){S=await (await fetch('/api/state')).json();render()}
document.getElementById('tabs').onclick=e=>{const t=e.target.dataset.t;if(t){tab=t;render()}};
document.getElementById('list').onclick=async e=>{const b=e.target;if(b.dataset.s){await post('/api/status',{url:b.dataset.u,status:b.dataset.s});load()}};
document.getElementById('addf').onsubmit=async e=>{e.preventDefault();const b=document.getElementById('addb'),m=document.getElementById('msg');b.disabled=true;m.textContent='Reading the page, checking language and scoring against your CV…';
 try{const r=await post('/api/add',{url:document.getElementById('url').value,name:document.getElementById('name').value,kind:document.querySelector('input[name=k]:checked').value});m.textContent=r.message||JSON.stringify(r);if(r.ok)document.getElementById('url').value='';if(r.rec&&r.rec.isMatch)tab='matches';}catch(err){m.textContent='Error: '+err.message}
 b.disabled=false;load()};
document.getElementById('run').onclick=async()=>{const r=await post('/api/run');document.getElementById('msg').textContent=r.message;load()};
document.getElementById('sync').onclick=async()=>{const m=document.getElementById('msg');m.textContent='Syncing with GitHub…';const r=await post('/api/sync');m.textContent=r.message;load()};
document.getElementById('test').onclick=async()=>{document.getElementById('msg').textContent='Sending test alert…';const r=await post('/api/test-alert');document.getElementById('msg').textContent=r.message};
load();setInterval(()=>{if(S&&S.running)load()},8000);
</script></body></html>`;
