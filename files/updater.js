// قص قص (QassQass) — in-app delta updater (main process). Required from main.js.
//
// Feed layout (any static host; default GitHub raw, big files may live on GitHub Releases):
//   <feed>/latest.json        { version, date, notes_ar, notes_en, minBootstrap, electron, base: "files/",
//                               files: [{ path, size, sha256, url? }], sig }
//   <feed>/files/<path>       payload files (main.js, preload.js, updater.js, package.json, app/**)
//   url (optional, per file)  absolute https URL (e.g. a GitHub Release asset) or a path relative to <feed>
// check(): fetch latest.json (Electron net.fetch), hash the payload this process runs from
// (bundled app.asar contents or <userData>/app-update/current/) and count the files whose sha256
// differs. download(): copy unchanged files locally, download only the changed ones into
// <userData>/app-update/staging-<ver>/, verify every hash, mark it ready (state.pending).
// bootstrap.js rotates it in on the next start (current → previous, staging → current) and rolls
// back if it fails to start. Feeds are produced by tools/make_update.mjs (see tools/UPDATES.md).
'use strict';
const { app, ipcMain, net, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Default feed. Overrides: env QQ_UPDATE_URL, or { "updateFeed": "https://…/" } in <userData>/settings.json.
const UPDATE_FEED = 'https://raw.githubusercontent.com/onzqa7/qassqass-updates/main/';
// Ed25519 public key (SPKI DER, base64) that must have signed latest.json (tools/make_update.mjs signs
// with tools/keys/update_ed25519_private.pem — back it up, never publish it). Empty string = no check.
const PUBKEY = 'MCowBQYDK2VwAyEAUlFTq1FWLxIefAF9QgUn823n8cPKb/vb/64eY1g0daA=';
const PARALLEL = 4, RETRIES = 3, FILE_TIMEOUT = 180000;
const REQUIRED = ['main.js', 'preload.js', 'package.json', 'updater.js', 'app/index.html'];

const BOOT = global.__qqBoot || null;
const BOOTSTRAP_VERSION = BOOT ? BOOT.bootstrapVersion : 0;
const PAYLOAD_DIR = __dirname;                       // the payload this process runs from
const ROOT = (BOOT && BOOT.root) || path.join(app.getPath('userData'), 'app-update');
const STATE = path.join(ROOT, 'state.json');
const CUR = path.join(ROOT, 'current'), PREV = path.join(ROOT, 'previous');
const SFX = path.join(ROOT, 'sfx');                  // stable sfx library (paths stored in projects survive updates)
const stagingDir = (v) => path.join(ROOT, 'staging-' + v);
const cmpVer = (BOOT && BOOT.cmpVer) || ((a, b) => { const p = v => String(v).split('-')[0].split('.').map(x => parseInt(x, 10) || 0); const A = p(a), B = p(b); for (let i = 0; i < 3; i++) { if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) > (B[i] || 0) ? 1 : -1; } return 0; });
const bundledVersion = () => BOOT ? BOOT.bundledVersion : app.getVersion();
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function readState() {
  if (BOOT && BOOT.readState) return BOOT.readState();
  let s = {}; try { s = JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch (e) {}
  s.bad = Array.isArray(s.bad) ? s.bad : []; return s;
}
function writeState(s) {
  if (BOOT && BOOT.writeState) return BOOT.writeState(s);
  try { fs.mkdirSync(ROOT, { recursive: true }); const t = STATE + '.tmp'; fs.writeFileSync(t, JSON.stringify(s, null, 1)); fs.renameSync(t, STATE); return true; } catch (e) { return false; }
}
function payloadVersion(dir) {
  if (BOOT && BOOT.payloadVersion) return BOOT.payloadVersion(dir);
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null; } catch (e) { return null; }
}
function settings() { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')) || {}; } catch (e) { return {}; } }
function feedUrl() {
  const st = settings();
  const u = String(process.env.QQ_UPDATE_URL || st.updateFeed || st.updateUrl || UPDATE_FEED).trim();
  if (!/^(https?|file):\/\//i.test(u)) return null;
  return u.endsWith('/') ? u : u + '/';
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
function fileUrl(feed, m, f) {
  if (f.url) return /^https?:\/\//i.test(f.url) ? f.url : feed + f.url.replace(/^\/+/, '');
  // ?v= busts CDN caches (raw.githubusercontent.com caches ~5 min) so a fresh manifest never meets a stale file
  return feed + (m.base || 'files/') + encPath(f.path) + (/^https?:/i.test(feed) ? '?v=' + f.sha256.slice(0, 12) : '');
}

/* ---------- integrity ---------- */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function verifyManifest(m) {
  if (!m || typeof m !== 'object' || typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version) || !Array.isArray(m.files) || !m.files.length) throw new Error('bad manifest');
  if (PUBKEY) {
    if (!m.sig) throw new Error('manifest not signed');
    const { sig, ...rest } = m;
    const key = crypto.createPublicKey({ key: Buffer.from(PUBKEY, 'base64'), format: 'der', type: 'spki' });
    if (!crypto.verify(null, Buffer.from(canonical(rest)), key, Buffer.from(sig, 'base64'))) throw new Error('bad manifest signature');
  }
  const seen = new Set();
  for (const f of m.files) {
    const p = f && f.path;
    if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('\\') || p.includes(':') || p.split('/').some(s => s === '..' || s === '.' || s === '') ||
        /^(node_modules\/|bootstrap\.js$|\.qq-)/.test(p) || seen.has(p.toLowerCase())) throw new Error('bad path in manifest: ' + p);
    if (!/^[0-9a-f]{64}$/.test(f.sha256) || !(Number.isInteger(f.size) && f.size >= 0)) throw new Error('bad entry: ' + p);
    if (f.url != null && (typeof f.url !== 'string' || (!/^https?:\/\//i.test(f.url) && f.url.split(/[\\/]/).includes('..')))) throw new Error('bad url: ' + p);
    seen.add(p.toLowerCase());
  }
  for (const req of REQUIRED) if (!seen.has(req)) throw new Error('manifest lacks ' + req);
  return m;
}
const hashCache = new Map(); // abs path → { size, mtime, sha }
function hashFile(file) {
  return new Promise((res) => {
    let st; try { st = fs.statSync(file); if (!st.isFile()) throw 0; } catch (e) { res(null); return; }
    const c = hashCache.get(file); if (c && c.size === st.size && c.mtime === +st.mtime) { res(c); return; }
    const h = crypto.createHash('sha256'); const s = fs.createReadStream(file);
    s.on('data', d => h.update(d)); s.on('error', () => res(null));
    s.on('end', () => { const r = { size: st.size, mtime: +st.mtime, sha: h.digest('hex') }; hashCache.set(file, r); res(r); });
  });
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } })); }

/* ---------- state / status ---------- */
let lastCheck = null, busy = null, progress = null, pendingRelaunch = 0, getWin = () => BrowserWindow.getAllWindows()[0];
function stagedVersion() { // downloaded, verified and waiting for a restart
  const s = readState(), v = s.pending;
  if (v && cmpVer(v, app.getVersion()) > 0 && !s.bad.includes(v) && fs.existsSync(path.join(stagingDir(v), '.qq-ready'))) return v;
  return null;
}
function status() {
  const s = readState();
  return {
    version: app.getVersion(), bundledVersion: bundledVersion(), bootstrap: BOOTSTRAP_VERSION,
    runningUpdate: !!(BOOT && BOOT.updateDir), payloadDir: PAYLOAD_DIR, confirmed: BOOT ? !!BOOT.confirmed : true,
    applied: BOOT && BOOT.applied, rolledBack: BOOT && BOOT.rolledBack, staged: stagedVersion(), feed: feedUrl(), autoCheck: settings().autoUpdate !== false,
    busy: !!busy, progress, last: lastCheck && { version: lastCheck.version, available: lastCheck.available },
    state: { current: s.current || null, previous: s.previous || null, pending: s.pending || null, bad: s.bad }
  };
}
function send(p) { progress = p; for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('upd:progress', p); } catch (e) {} } }

/* ---------- check ---------- */
async function fetchManifest(feed) {
  const r = await net.fetch(feed + 'latest.json' + (/^https?:/i.test(feed) ? '?t=' + Date.now() : ''), { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return verifyManifest(JSON.parse(await r.text()));
}
async function plan(m) { // which files must be downloaded (sha256 differs from the running payload)
  const changed = []; let bytes = 0;
  await pool(m.files, 8, async (f) => { const h = await hashFile(path.join(PAYLOAD_DIR, f.path)); if (!h || h.sha !== f.sha256) { changed.push(f); bytes += f.size; } });
  return { changed, bytes };
}
async function check() {
  const feed = feedUrl(); if (!feed) return { ok: false, error: 'not-configured' };
  try {
    const m = await fetchManifest(feed), cur = app.getVersion(), s = readState();
    const out = { ok: true, current: cur, version: m.version, date: m.date || '', notes_ar: m.notes_ar || '', notes_en: m.notes_en || '', available: false };
    if (cmpVer(m.version, cur) <= 0 || s.bad.includes(m.version)) { lastCheck = { ...out, m, feed }; if (s.bad.includes(m.version)) out.bad = true; return out; }
    out.available = true;
    const eMajor = (v) => String(v || '').split('.')[0];
    if ((m.minBootstrap || 1) > BOOTSTRAP_VERSION || (m.electron && eMajor(m.electron) !== eMajor(process.versions.electron))) { out.needsFull = true; out.fullUrl = m.fullUrl || ''; }
    else if (stagedVersion() === m.version) out.staged = true;
    else { const p = await plan(m); out.files = p.changed.length; out.totalFiles = m.files.length; out.bytes = p.bytes; }
    lastCheck = { ...out, m, feed };
    return out;
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/* ---------- download + stage ---------- */
async function fetchTo(url, dest, f, onBytes) {
  let lastErr;
  for (let a = 0; a < RETRIES; a++) {
    let got = 0;
    try {
      const r = await net.fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(FILE_TIMEOUT) });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + f.path);
      const h = crypto.createHash('sha256'); const tmp = dest + '.part';
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const fd = fs.openSync(tmp, 'w');
      try { const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; const b = Buffer.from(value); h.update(b); fs.writeSync(fd, b); got += b.length; onBytes(b.length); if (got > f.size) throw new Error('too large: ' + f.path); } }
      finally { fs.closeSync(fd); }
      const sha = h.digest('hex');
      if (got !== f.size || sha !== f.sha256) { fs.rmSync(tmp, { force: true }); throw new Error('hash mismatch ' + f.path); }
      fs.renameSync(tmp, dest); return;
    } catch (e) { lastErr = e; onBytes(-got); try { fs.rmSync(dest + '.part', { force: true }); } catch (er) {} await new Promise(r => setTimeout(r, 700 * (a + 1))); }
  }
  throw lastErr;
}
async function copyLocal(src, dest, f) { // copy an unchanged file from the running payload (works from inside app.asar)
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const b = await fs.promises.readFile(src);
  if (b.length !== f.size || crypto.createHash('sha256').update(b).digest('hex') !== f.sha256) return false;
  await fs.promises.writeFile(dest + '.part', b); fs.renameSync(dest + '.part', dest); return true;
}
function syncSfx(dir, m) { // keep a stable, add-only copy of the sfx library (real files for FFmpeg)
  for (const f of m.files) {
    if (!f.path.startsWith('app/sfx/')) continue;
    const dst = path.join(SFX, f.path.slice('app/sfx/'.length));
    try {
      const st = fs.existsSync(dst) && fs.statSync(dst);
      if (st && st.size === f.size && (f.path.endsWith('.json') ? crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex') === f.sha256 : true)) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(dir, f.path), dst + '.tmp'); fs.renameSync(dst + '.tmp', dst);
    } catch (e) {}
  }
}
async function download() {
  if (busy) return busy;
  busy = (async () => {
    try {
      if (!lastCheck || !lastCheck.m || !lastCheck.available) { const c = await check(); if (!c.ok) throw new Error(c.error); if (!c.available) return { ok: true, upToDate: true, version: c.version }; }
      const { m, feed } = lastCheck;
      if (lastCheck.needsFull) return { ok: false, needsFull: true, fullUrl: m.fullUrl || '' };
      if (stagedVersion() === m.version) { send({ phase: 'ready', version: m.version, done: 1, total: 1 }); return { ok: true, version: m.version, staged: true, downloaded: [], copied: 0, bytes: 0 }; }
      const stage = stagingDir(m.version);
      if (samePath(stage, PAYLOAD_DIR)) throw new Error('version already running');
      try { fs.rmSync(path.join(stage, '.qq-ready'), { force: true }); } catch (e) {}
      fs.mkdirSync(stage, { recursive: true });
      const need = [], downloaded = []; let copied = 0, resumed = 0;
      send({ phase: 'prepare', version: m.version, done: 0, total: 0 });
      await pool(m.files, 8, async (f) => {
        const dest = path.join(stage, f.path);
        const have = await hashFile(dest); if (have && have.sha === f.sha256) { resumed++; return; }  // resumed after an interrupted download
        const loc = await hashFile(path.join(PAYLOAD_DIR, f.path));
        if (loc && loc.sha === f.sha256 && await copyLocal(path.join(PAYLOAD_DIR, f.path), dest, f).catch(() => false)) { copied++; return; }
        need.push(f);
      });
      const total = need.reduce((a, f) => a + f.size, 0); let done = 0, lastSend = 0;
      send({ phase: 'download', version: m.version, done: 0, total, files: need.length });
      await pool(need, PARALLEL, async (f) => {
        await fetchTo(fileUrl(feed, m, f), path.join(stage, f.path), f, (n) => {
          done += n; const t = Date.now(); if (t - lastSend > 150) { lastSend = t; send({ phase: 'download', version: m.version, done, total, files: need.length }); }
        });
        downloaded.push(f.path);
      });
      send({ phase: 'verify', version: m.version, done: total, total, files: need.length });
      for (const f of m.files) { const p = path.join(stage, f.path); hashCache.delete(p); const h = await hashFile(p); if (!h || h.sha !== f.sha256) throw new Error('verification failed: ' + f.path); }
      // drop anything in the staging folder that is not part of this payload (left-overs from an older attempt)
      const want = new Set(m.files.map(f => path.join(stage, f.path)));
      (function prune(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { prune(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); } else if (!want.has(p)) fs.rmSync(p, { force: true }); } })(stage);
      fs.writeFileSync(path.join(stage, '.qq-manifest.json'), JSON.stringify(m));
      fs.writeFileSync(path.join(stage, '.qq-ready'), JSON.stringify({ version: m.version, at: Date.now(), downloaded: downloaded.length, copied: copied + resumed }));
      syncSfx(stage, m);
      const s = readState();
      const old = s.pending; s.pending = m.version; s.bad = s.bad.filter(v => v !== m.version);
      writeState(s);
      if (old && old !== m.version) { try { fs.rmSync(stagingDir(old), { recursive: true, force: true }); } catch (e) {} }
      const res = { ok: true, version: m.version, downloaded: downloaded.sort(), copied, resumed, bytes: total };
      send({ phase: 'ready', version: m.version, done: total, total, downloaded: downloaded.length });
      return res;
    } catch (e) {
      const r = { ok: false, error: String(e && e.message || e) }; send({ phase: 'error', error: r.error }); return r;
    } finally { setTimeout(() => { busy = null; }, 0); }
  })();
  return busy;
}

/* ---------- housekeeping: drop stale payloads (never the running, current, previous or pending one) ---------- */
function gc() {
  try {
    if (busy) return;
    const s = readState(), bundled = bundledVersion();
    for (const n of fs.readdirSync(ROOT)) {
      const p = path.join(ROOT, n); let mm;
      if (samePath(p, PAYLOAD_DIR)) continue;
      if ((mm = /^staging-(.+)$/.exec(n)) && mm[1] !== s.pending) fs.rmSync(p, { recursive: true, force: true });
      else if (/^v-/.test(n)) fs.rmSync(p, { recursive: true, force: true });              // layout of early test builds
      else if (n === 'current' || n === 'previous') { const v = payloadVersion(p); if (!v || cmpVer(v, bundled) <= 0 || s.bad.includes(v)) { fs.rmSync(p, { recursive: true, force: true }); if (n === 'previous') s.previous = null; else s.current = null; writeState(s); } }
    }
  } catch (e) {}
}

function sfxDir() { // used by main.js app:paths when running from an update folder
  if (!(BOOT && BOOT.updateDir)) return null;
  if (fs.existsSync(path.join(SFX, 'catalog.json'))) return SFX;
  return path.join(PAYLOAD_DIR, 'app', 'sfx');
}

function init(o = {}) {
  if (o.getWin) getWin = o.getWin;
  ipcMain.handle('upd:check', () => check());
  ipcMain.handle('upd:download', () => download());
  ipcMain.handle('upd:status', () => status());
  ipcMain.handle('upd:open-full', (e, url) => { const u = url || (lastCheck && lastCheck.fullUrl); if (u && /^https?:\/\//.test(u)) shell.openExternal(u); return !!u; });
  ipcMain.handle('upd:restart', () => {
    if (!stagedVersion()) return false;
    pendingRelaunch = Date.now();
    const w = getWin();
    if (w && !w.isDestroyed()) w.close(); else app.quit();   // goes through the normal "save changes?" prompt
    return true;
  });
  app.on('will-quit', () => { if (pendingRelaunch && Date.now() - pendingRelaunch < 5 * 60000 && stagedVersion() && !process.env.QQ_UPD_NO_RELAUNCH) app.relaunch(); });
  app.whenReady().then(() => setTimeout(gc, 15000).unref());
}

module.exports = { init, sfxDir, status, check, download, canonical, verifyManifest, UPDATE_FEED };
