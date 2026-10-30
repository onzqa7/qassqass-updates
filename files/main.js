// قص قص (QassQass) — Electron main process
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, session, net } = require('electron');
const TILEP = require('./app/js/atlas/providers.js');
// ---- performance: use the discrete GPU, GPU rasterisation, zero-copy uploads, more JS heap ----
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const ffargs = require('./app/js/ffargs.js');

const APP_DIR = path.join(__dirname, 'app');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg'
};

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function ffmpegPath() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (app.isPackaged) { const p = path.join(process.resourcesPath, 'bin', exe); if (fs.existsSync(p)) return p; }
  const local = path.join(__dirname, 'bin', 'win', exe);
  return (process.platform === 'win32' && fs.existsSync(local)) ? local : 'ffmpeg';
}

// Serve a file with HTTP range support (needed for video seeking).
async function serveFile(file, req) {
  let st;
  try { st = await fs.promises.stat(file); } catch (e) { return new Response('not found', { status: 404 }); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.get('range');
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = 0, end = st.size - 1;
    if (m && m[1]) { start = parseInt(m[1], 10); if (m[2]) end = parseInt(m[2], 10); }
    else if (m && m[2]) { start = Math.max(0, st.size - parseInt(m[2], 10)); }
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream), { status: 206, headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${st.size}` } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'Content-Length': String(st.size) } });
}

let win = null, dirty = false, forceClose = false;
const projectArg = (argv) => argv.slice(1).find(a => /\.(gwproj|qass)$/i.test(a)) || null;
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', (e, argv) => {
  if (!win) return; if (win.isMinimized()) win.restore(); win.focus();
  const f = projectArg(argv); if (f) win.webContents.send('app:open-file', f);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1680, height: 1000, minWidth: 1100, minHeight: 680, backgroundColor: '#1b1b1b', show: false,
    title: 'قص قص', icon: path.join(__dirname, 'app', 'img', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false }
  });
  win.setMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL('app://gws/index.html');
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('close', (e) => {
    if (forceClose || !dirty) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['حفظ', 'عدم الحفظ', 'إلغاء'], defaultId: 0, cancelId: 2, title: 'قص قص', message: 'هل تريد حفظ التغييرات على المشروع قبل الإغلاق؟' });
    if (r === 0) win.webContents.send('app:save-then-close');
    else if (r === 1) { forceClose = true; win.close(); }
  });
}

/* ---- map tiles: disk cache → network → bundled offline pyramid ---- */
const tileInflight = new Map(); const tileOffline = {}; // provider → retry-after timestamp (network down / blocked)
async function serveTile(prov, z, x, y) {
  const P = TILEP.P[prov]; if (!P || !(z >= 0 && z <= 22)) return new Response('', { status: 404 });
  const dir = path.join(app.getPath('userData'), 'tiles', prov, String(z), String(x)); const f = path.join(dir, y + '.img');
  const type = (P.url || '').match(/\.png/) || prov === 'night' ? 'image/png' : 'image/jpeg';
  try { const b = await fs.promises.readFile(f); return new Response(b, { headers: { 'Content-Type': type, 'Cache-Control': 'max-age=31536000' } }); } catch (e) {}
  const k = prov + '/' + z + '/' + x + '/' + y;
  if (P.url && !(tileOffline[prov] > Date.now())) {
    let p = tileInflight.get(k);
    if (!p) {
      p = (async () => {
        const url = TILEP.url(prov, z, x, y).replace('://a.', '://' + 'abc'[(x + y) % 3] + '.');
        let r; try { r = await net.fetch(url, { headers: { 'User-Agent': 'QassQass/2.0 (video editor; +desktop)', 'Referer': 'https://qassqass.app/' }, signal: AbortSignal.timeout(9000) }); }
        catch (e) { tileOffline[prov] = Date.now() + 45000; throw e; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const b = Buffer.from(await r.arrayBuffer()); if (b.length < 64) throw new Error('empty');
        fs.promises.mkdir(dir, { recursive: true }).then(() => fs.promises.writeFile(f, b)).catch(() => {});
        return b;
      })();
      tileInflight.set(k, p); p.finally(() => tileInflight.delete(k)).catch(() => {});
    }
    try { const b = await p; return new Response(b, { headers: { 'Content-Type': type } }); } catch (e) {}
  }
  // offline fallback: bundled low-zoom pyramid
  if (P.bundle && z <= (TILEP.BUNDLE_MAX[P.bundle] || 0)) { const bf = path.join(APP_DIR, 'tiles', P.bundle, String(z), String(x), y + '.jpg'); try { const b = await fs.promises.readFile(bf); return new Response(b, { headers: { 'Content-Type': 'image/jpeg' } }); } catch (e) {} }
  return new Response('', { status: 404 });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/__tile/')) { const [, , prov, z, x, y] = u.pathname.split('/'); return serveTile(prov, +z, +x, +y); }
    if (u.pathname.startsWith('/__media/')) {
      const enc = u.pathname.slice('/__media/'.length).split('/')[0];
      const file = Buffer.from(decodeURIComponent(enc), 'base64url').toString('utf8');
      return serveFile(file, req);
    }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR)) return new Response('forbidden', { status: 403 });
    return serveFile(file, req);
  });
  const allow = ['local-fonts', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'];
  // microphone (voice-over recording): audio capture only, and only for the app's own pages (app://gws)
  const ownOrigin = (u) => /^app:\/\/gws(\/|$)/.test(String(u || ''));
  const micOk = (wc, d) => ownOrigin((d && (d.requestingUrl || d.securityOrigin)) || (wc && wc.getURL && wc.getURL())) && !(d && Array.isArray(d.mediaTypes) && d.mediaTypes.some(t => t !== 'audio'));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(allow.includes(perm) || (perm === 'media' && micOk(wc, details))));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin, details) => allow.includes(perm) || (perm === 'media' && ownOrigin(origin || (details && details.securityOrigin)) && !(details && details.mediaType === 'video')));
  createWindow();
});
app.on('window-all-closed', () => app.quit());

/* ---------------- IPC: dialogs & files ---------------- */
const FILTERS = {
  media: [{ name: 'وسائط', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'mts', 'm2ts', 'mpg', 'mpeg', 'flv', '3gp', 'mxf', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg'] }, { name: 'كل الملفات', extensions: ['*'] }],
  project: [{ name: 'مشروع قص قص', extensions: ['qass', 'gwproj'] }],
  image: [{ name: 'صور', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }],
  json: [{ name: 'JSON', extensions: ['json'] }],
  cube: [{ name: 'LUT (.cube)', extensions: ['cube'] }],
  font: [{ name: 'خطوط', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
};
ipcMain.handle('dlg:open', async (e, o = {}) => {
  const r = await dialog.showOpenDialog(win, { title: o.title || 'فتح', filters: FILTERS[o.filter] || undefined, properties: [o.folder ? 'openDirectory' : 'openFile', ...(o.multi ? ['multiSelections'] : []), 'createDirectory'], defaultPath: o.defaultPath });
  if (r.canceled) return [];
  return r.filePaths.map(p => { let size = 0; try { size = fs.statSync(p).size; } catch (e) {} return { path: p, name: path.basename(p), size }; });
});
ipcMain.handle('dlg:save', async (e, o = {}) => {
  const r = await dialog.showSaveDialog(win, { title: o.title || 'حفظ', defaultPath: o.defaultPath, filters: o.ext ? [{ name: o.ext.toUpperCase(), extensions: [o.ext] }] : FILTERS[o.filter] });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('fs:readText', async (e, p) => fs.promises.readFile(p, 'utf8'));
ipcMain.handle('fs:writeText', async (e, p, s) => { await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, s, 'utf8'); return true; });
ipcMain.handle('fs:writeBin', async (e, p, buf) => { await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, Buffer.from(buf)); return true; });
ipcMain.handle('fs:exists', async (e, p) => fs.existsSync(p));
ipcMain.handle('fs:remove', async (e, p) => { try { await fs.promises.rm(p, { force: true, recursive: true }); } catch (er) {} return true; });
ipcMain.handle('app:paths', async () => {
  const docs = app.getPath('documents');
  const cache = path.join(app.getPath('userData'), 'media-cache');
  fs.mkdirSync(cache, { recursive: true });
  return { docs, cache, userData: app.getPath('userData'), temp: os.tmpdir(), renders: path.join(docs, 'QassQass'), sfxDir: (UPD && UPD.sfxDir()) || (app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'app', 'sfx') : path.join(APP_DIR, 'sfx')), version: app.getVersion(), platform: process.platform, sep: path.sep };
});
ipcMain.handle('app:argv-file', async () => projectArg(process.argv));
ipcMain.handle('app:dirty', async (e, d) => { dirty = !!d; return true; });
ipcMain.handle('app:close-now', async () => { forceClose = true; win.close(); });
ipcMain.handle('app:title', async (e, t) => { win.setTitle(t); });
ipcMain.handle('shell:show', async (e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:open', async (e, p) => shell.openPath(p));

/* ---------------- IPC: ffmpeg ---------------- */
const jobs = new Map();
let jobSeq = 1;
function runFF(args, onData) {
  return new Promise((resolve) => {
    let log = '', p;
    try { p = spawn(ffmpegPath(), args, { windowsHide: true }); } catch (err) { resolve({ ok: false, log: String(err) }); return; }
    p.stderr.on('data', d => { const s = d.toString(); log = (log + s).slice(-20000); if (onData) onData(s); });
    p.on('error', err => resolve({ ok: false, log: log + '\n' + err }));
    p.on('close', code => resolve({ ok: code === 0, code, log }));
  });
}
ipcMain.handle('ff:available', async () => (await runFF(['-hide_banner', '-version'])).ok);
ipcMain.handle('ff:probe', async (e, file) => ffargs.parseProbe((await runFF(['-hide_banner', '-i', file])).log));
ipcMain.handle('ff:run', async (e, id, args) => runFF(args, (s) => {
  const m = /time=(\d+):(\d+):([\d.]+)/.exec(s);
  if (m && win) win.webContents.send('ff:progress', id, (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]));
}));
ipcMain.handle('ff:start', async (e, o) => {
  const id = jobSeq++;
  const args = ffargs.encodeArgs(o);
  try { fs.mkdirSync(path.dirname(o.out), { recursive: true }); } catch (er) {}
  let p;
  try { p = spawn(ffmpegPath(), args, { windowsHide: true }); } catch (err) { return { ok: false, error: String(err) }; }
  const job = { p, log: '', failed: false };
  job.done = new Promise(res => { p.on('close', code => res(code)); p.on('error', err => { job.failed = true; job.log += String(err); res(-1); }); });
  p.stderr.on('data', d => { job.log = (job.log + d.toString()).slice(-30000); });
  p.stdin.on('error', () => { job.failed = true; });
  jobs.set(id, job);
  return { ok: true, id };
});
ipcMain.handle('ff:frame', async (e, id, buf) => {
  const job = jobs.get(id);
  if (!job || job.failed) return false;
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (!job.p.stdin.write(b)) await new Promise(r => { job.p.stdin.once('drain', r); job.p.once('close', r); });
  if (job.failed || job.p.exitCode !== null) return false;
  return true;
});
ipcMain.handle('ff:end', async (e, id) => {
  const job = jobs.get(id); if (!job) return { ok: false, log: 'no job' };
  job.p.stdin.end();
  const code = await job.done; jobs.delete(id);
  return { ok: code === 0 && !job.failed, code, log: job.log };
});
ipcMain.handle('ff:cancel', async (e, id) => { const job = jobs.get(id); if (job) { try { job.p.stdin.destroy(); job.p.kill(); } catch (er) {} jobs.delete(id); } return true; });

/* ===== updater ===== (in-app delta updates: see updater.js / bootstrap.js / tools/make_update.mjs) */
let UPD = null;
try { UPD = require('./updater.js'); UPD.init({ getWin: () => win }); } catch (e) { console.error('updater disabled:', e); UPD = null; }
/* ===== /updater ===== */

/* ===== whisper ===== (speech-to-text & captions: whisper.cpp engines, model downloads, transcription jobs — helpers in app/js/asr_core.js) */
const ASR = (() => {
  const core = require('./app/js/asr_core.js');
  const isWin = process.platform === 'win32';
  const EXE = isWin ? 'whisper-cli.exe' : 'whisper-cli';
  const st = { jobs: new Map(), dls: new Map(), cudaBad: false, gpu: null };
  const userDir = () => app.getPath('userData');
  const modelsDir = () => process.env.QASS_ASR_MODELS || path.join(userDir(), 'models');
  const send = (p) => { try { if (win && !win.isDestroyed()) win.webContents.send('asr:progress', p); } catch (e) {} };
  // engine search order: env override (dev/tests) → bundled (installer) → dev tree → downloaded into userData
  function engineDirs(v) {
    const d = [];
    if (process.env.QASS_WHISPER_DIR) d.push(path.join(process.env.QASS_WHISPER_DIR, v));
    if (app.isPackaged) d.push(path.join(process.resourcesPath, 'bin', 'whisper', v));
    d.push(path.join(__dirname, 'bin', 'win', 'whisper', v), path.join(userDir(), 'whisper', v));
    return d;
  }
  function engine(v) { for (const d of engineDirs(v)) { const exe = path.join(d, EXE); if (fs.existsSync(exe)) return { dir: d, exe }; } return null; }
  function proc(job, exe, args, opts, onErr, onOut) {
    return new Promise((resolve) => {
      let log = '', carry = '', p;
      try { p = spawn(exe, args, Object.assign({ windowsHide: true }, opts)); } catch (err) { resolve({ ok: false, code: -1, log: String(err) }); return; }
      if (job) job.procs.add(p);
      p.stderr.on('data', d => { const s = d.toString(); log = (log + s).slice(-40000); if (onErr) onErr(s); });
      p.stdout.on('data', d => { const s = carry + d.toString(); const i = s.lastIndexOf('\n'); carry = i < 0 ? s : s.slice(i + 1); const done = i < 0 ? '' : s.slice(0, i + 1); log = (log + d).slice(-40000); if (onOut && done) onOut(done); });
      p.on('error', err => { if (job) job.procs.delete(p); resolve({ ok: false, code: -1, log: log + '\n' + err }); });
      p.on('close', code => { if (job) job.procs.delete(p); if (onOut && carry) onOut(carry); resolve({ ok: code === 0, code, log }); });
    });
  }
  async function detectGpu() {
    if (st.gpu) return st.gpu;
    const g = { nvidia: false };
    if (isWin) {
      const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
      for (const exe of [path.join(sys, 'nvidia-smi.exe'), 'nvidia-smi']) {
        const r = await Promise.race([proc(null, exe, ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits']), new Promise(r => setTimeout(() => r({ ok: false }), 8000))]);
        const line = r.ok ? String(r.log).trim().split(/\r?\n/).find(l => l.includes(',')) : null;
        if (line) { const [name, mem, drv] = line.split(',').map(s => s.trim()); Object.assign(g, { nvidia: true, name, vram: +mem || 0, driver: drv }); break; }
      }
      if (!g.nvidia && fs.existsSync(path.join(sys, 'nvcuda.dll'))) g.nvidia = true;
    }
    if (process.env.QASS_FAKE_NVIDIA) Object.assign(g, { nvidia: true, name: process.env.QASS_FAKE_NVIDIA });
    g.driverOk = !g.driver || parseFloat(g.driver) >= 551.61; // CUDA 12.4 needs driver ≥ 551.61 on Windows
    return (st.gpu = g);
  }
  async function status() {
    const gpu = await detectGpu(); const md = modelsDir();
    const sz = f => { try { return fs.statSync(path.join(md, f)).size; } catch (e) { return 0; } };
    const models = core.MODELS.map(m => ({ id: m.id, file: m.file, n: m.n, mb: m.mb, rec: m.rec || 0, url: m.url, installed: sz(m.file) > 0, bytes: sz(m.file), partial: sz(m.file + '.part'), downloading: st.dls.has('model:' + m.id) }));
    try { for (const f of fs.readdirSync(md)) if (/^ggml-.*\.bin$/i.test(f) && !models.some(m => m.file === f)) models.push({ id: 'file:' + f, file: f, n: f.replace(/^ggml-|\.bin$/gi, ''), custom: 1, installed: true, bytes: sz(f), partial: 0, downloading: false }); } catch (e) {}
    const engines = {};
    for (const v of ['cpu', 'cuda']) { const e = engine(v); engines[v] = { installed: !!e, dir: e ? e.dir : null, size: core.ENGINES[v].size, downloadable: isWin || !!process.env.QASS_ASR_ENGINE_BASEURL, downloading: st.dls.has('engine:' + v) }; }
    return { platform: process.platform, gpu, engines, models, modelsDir: md, cudaBad: st.cudaBad, cpus: os.cpus().length, version: core.WVER };
  }
  async function dl(kind, id) {
    const key = kind + ':' + id; if (st.dls.has(key)) return { ok: false, error: 'busy' };
    const ac = new AbortController(); st.dls.set(key, ac);
    const prog = (phase) => (p) => send({ kind: 'download', target: kind, id, phase, got: p.got != null ? p.got : p.done, total: p.total });
    const fetchImpl = (u, o) => net.fetch(u, o);
    try {
      if (kind === 'model') {
        const m = core.MODELS.find(x => x.id === id); if (!m) throw new Error('نموذج غير معروف');
        const url = process.env.QASS_ASR_BASEURL ? process.env.QASS_ASR_BASEURL + m.file : m.url;
        await core.download(url, path.join(modelsDir(), m.file), { fetch: fetchImpl, expectedSize: m.size, sizeTolerance: 0.03, sha1: m.sha1, signal: ac.signal, onProgress: prog('download') });
      } else {
        const E = core.ENGINES[id]; if (!E) throw new Error('محرك غير معروف');
        const url = process.env.QASS_ASR_ENGINE_BASEURL ? process.env.QASS_ASR_ENGINE_BASEURL + path.basename(E.url) : E.url;
        const base = path.join(userDir(), 'whisper'); const zip = path.join(base, id + '.zip'); const dir = path.join(base, id);
        await core.download(url, zip, { fetch: fetchImpl, expectedSize: E.size, sha256: E.sha256, signal: ac.signal, onProgress: prog('download') });
        send({ kind: 'download', target: kind, id, phase: 'extract', got: 0, total: 1 });
        await fs.promises.rm(dir, { recursive: true, force: true });
        await core.unzip(zip, dir, core.ENGINE_KEEP, prog('extract'));
        const b = engine('cpu'); // app-local VC++ runtime copied from the bundled CPU engine
        if (b && b.dir !== dir) for (const f of fs.readdirSync(b.dir)) if (/^(msvcp|vcruntime|vcomp)140/i.test(f) && !fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(b.dir, f), path.join(dir, f));
        await fs.promises.rm(zip, { force: true });
        if (id === 'cuda') st.cudaBad = false;
      }
      send({ kind: 'download', target: kind, id, phase: 'done' });
      return { ok: true };
    } catch (e) {
      const err = e.cancelled ? 'cancelled' : String(e.message || e);
      send({ kind: 'download', target: kind, id, phase: e.cancelled ? 'cancelled' : 'error', error: err });
      return { ok: false, cancelled: !!e.cancelled, error: err };
    } finally { st.dls.delete(key); }
  }
  function dllHint(code) {
    const c = code >>> 0;
    if (c === 0xC0000135) return 'missing-dll'; // VC++ runtime / CUDA DLL not found
    if (c === 0xC000001D) return 'illegal-instruction';
    return null;
  }
  async function run(o) {
    const id = String(o.id || ('j' + Date.now())); const md = modelsDir();
    const m = core.MODELS.find(x => x.id === o.model); const file = m ? m.file : String(o.model || '').replace(/^file:/, '');
    if (!file || !fs.existsSync(path.join(md, file))) return { ok: false, error: 'model-missing' };
    if (!engine('cpu') && !engine('cuda')) return { ok: false, error: 'engine-missing' };
    await fs.promises.mkdir(path.join(md, '.jobs'), { recursive: true });
    const job = { id, procs: new Set(), cancelled: false }; st.jobs.set(id, job);
    // every path handed to whisper-cli is relative to cwd=models dir (ASCII-only argv, see asr_core.buildArgs)
    const base = 'asr_' + id.replace(/[^\w]/g, ''); const wavRel = path.join('.jobs', base + '.wav'), outRel = path.join('.jobs', base);
    try {
      send({ kind: 'run', id, phase: 'prepare', pct: 0 });
      const fa = ['-y', '-hide_banner', '-loglevel', 'error'];
      if (o.ss > 0) fa.push('-ss', String(o.ss));
      if (o.dur > 0) fa.push('-t', String(o.dur));
      fa.push('-i', o.input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavRel);
      const r1 = await proc(job, ffmpegPath(), fa, { cwd: md });
      if (job.cancelled) return { ok: false, cancelled: true };
      if (!r1.ok) return { ok: false, error: 'تعذر استخراج الصوت: ' + r1.log.slice(-400) };
      const gpu = await detectGpu(); const pref = o.device || 'auto';
      const cu = engine('cuda'), cpu = engine('cpu'); const order = [];
      if (pref !== 'cpu' && cu && (pref === 'cuda' || (gpu.nvidia && !st.cudaBad))) order.push(['cuda', cu]);
      if (cpu) order.push(['cpu', cpu]);
      let last = null;
      for (const [v, e] of order) {
        if (job.cancelled) break;
        const args = core.buildArgs({ model: file, wav: wavRel, outBase: outRel, lang: o.lang, translate: o.translate, threads: o.threads || core.defaultThreads(os.cpus().length, v === 'cuda'), dtw: o.dtw && m ? m.dtw : null, prompt: o.prompt, beam: o.beam });
        const jf = path.join(md, outRel + '.json'); try { fs.rmSync(jf, { force: true }); } catch (er) {}
        send({ kind: 'run', id, phase: 'transcribe', pct: 0, backend: v });
        const t0 = Date.now();
        const r = await proc(job, e.exe, args, { cwd: md },
          (s) => { const p = core.parseProgress(s); if (p != null) send({ kind: 'run', id, phase: 'transcribe', pct: p, backend: v }); },
          (s) => { const segs = core.parseLiveSegments(s); if (segs.length) send({ kind: 'run', id, phase: 'transcribe', segs, backend: v }); });
        if (job.cancelled) break;
        if (r.ok && fs.existsSync(jf)) {
          const result = core.parseWhisperJSON(fs.readFileSync(jf, 'utf8'));
          return { ok: true, result, engine: v, backend: v === 'cuda' ? core.backendFromLog(r.log) : 'cpu', secs: (Date.now() - t0) / 1000, fallback: last ? last.error : null, log: r.log.slice(-3000) };
        }
        last = { engine: v, code: r.code, error: dllHint(r.code) || ('code ' + r.code + ': ' + r.log.slice(-1500)) };
        if (v === 'cuda') { st.cudaBad = true; send({ kind: 'run', id, phase: 'fallback', backend: 'cpu', error: last.error }); }
      }
      if (job.cancelled) return { ok: false, cancelled: true };
      return { ok: false, error: last ? last.error : 'failed', code: last && last.code };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
    finally {
      st.jobs.delete(id);
      for (const f of [wavRel, outRel + '.json']) fs.promises.rm(path.join(md, f), { force: true }).catch(() => {});
    }
  }
  function cancel(id) {
    const j = st.jobs.get(String(id)); if (j) { j.cancelled = true; for (const p of j.procs) { try { p.kill(); } catch (e) {} } }
    for (const k of [String(id), 'model:' + id, 'engine:' + id]) { const a = st.dls.get(k); if (a) a.abort(); }
    return true;
  }
  async function removeModel(id) {
    const m = core.MODELS.find(x => x.id === id); const f = m ? m.file : String(id).replace(/^file:/, '');
    if (!/^ggml-[\w.-]+\.bin$/i.test(f)) return false;
    for (const x of [f, f + '.part']) await fs.promises.rm(path.join(modelsDir(), x), { force: true });
    return true;
  }
  async function importModel(src) { // offline install of a ggml-*.bin the user already has
    const name = /^ggml-.*\.bin$/i.test(path.basename(src)) ? path.basename(src) : 'ggml-' + path.basename(src).replace(/[^\w.-]+/g, '_').replace(/\.bin$/i, '') + '.bin';
    await fs.promises.mkdir(modelsDir(), { recursive: true }); await fs.promises.copyFile(src, path.join(modelsDir(), name));
    return { ok: true, file: name };
  }
  return { status, dl, run, cancel, removeModel, importModel, modelsDir, engine, detectGpu };
})();
ipcMain.handle('asr:status', async () => ASR.status());
ipcMain.handle('asr:models', async () => (await ASR.status()).models);
ipcMain.handle('asr:download', async (e, kind, id) => ASR.dl(kind, id));
ipcMain.handle('asr:run', async (e, o) => ASR.run(o || {}));
ipcMain.handle('asr:cancel', async (e, id) => ASR.cancel(id));
ipcMain.handle('asr:remove-model', async (e, id) => ASR.removeModel(id));
ipcMain.handle('asr:import-model', async (e, p) => ASR.importModel(p));
ipcMain.handle('asr:open-models', async () => { await fs.promises.mkdir(ASR.modelsDir(), { recursive: true }); return shell.openPath(ASR.modelsDir()); });
/* ===== /whisper ===== */

/* ===== api ===== (local automation API for an AI assistant: JSON-RPC 2.0 over http://127.0.0.1:<random port>/, token in <userData>/api.json;
   off unless the user enables "السماح للمساعد الذكي بالتحكم"; every call is forwarded to GW.API in the renderer — see app/js/api.js, tools/mcp/) */
const APIS = (() => {
  const http = require('http'); const crypto = require('crypto');
  const ud = () => app.getPath('userData');
  const apiFile = () => path.join(ud(), 'api.json'), setFile = () => path.join(ud(), 'api-settings.json');
  const readSet = () => { try { return JSON.parse(fs.readFileSync(setFile(), 'utf8')) || {}; } catch (e) { return {}; } };
  const writeSet = (o) => { try { fs.mkdirSync(ud(), { recursive: true }); fs.writeFileSync(setFile(), JSON.stringify(o, null, 2)); } catch (e) {} };
  const mcpDir = () => { const c = [app.isPackaged ? path.join(process.resourcesPath, 'mcp') : null, path.join(__dirname, 'tools', 'mcp'), path.join(app.getAppPath(), 'tools', 'mcp')].filter(Boolean); return c.find(d => fs.existsSync(path.join(d, 'qassqass-mcp.js'))) || c[0]; };
  let server = null, token = null, port = 0, seq = 1; const pending = new Map();
  const status = () => ({ enabled: !!server, port: server ? port : null, apiFile: apiFile(), mcpDir: mcpDir(), mcpScript: path.join(mcpDir(), 'qassqass-mcp.js'), exePath: process.execPath, packaged: app.isPackaged });
  function toRenderer(method, params, ms) {
    return new Promise((resolve, reject) => {
      if (!win || win.isDestroyed()) return reject(new Error('QassQass window is not open'));
      const id = seq++; const t = setTimeout(() => { pending.delete(id); reject(new Error('timeout after ' + Math.round(ms / 1000) + 's (method ' + method + ')')); }, ms);
      pending.set(id, { resolve: (r) => { clearTimeout(t); resolve(r); }, reject });
      win.webContents.send('api:call', id, method, params || {});
    });
  }
  ipcMain.on('api:result', (e, id, res) => { const p = pending.get(id); if (p) { pending.delete(id); p.resolve(res); } });
  function send(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b), 'Cache-Control': 'no-store' }); res.end(b); }
  async function handle(req, res) {
    // only local, non-browser clients: no Origin (blocks web pages / CSRF), Host must be the loopback address (blocks DNS rebinding)
    if (req.headers.origin) return send(res, 403, { error: 'forbidden' });
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(req.headers.host || ''))) return send(res, 403, { error: 'bad host' });
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-qassqass-token'] || '');
    const okTok = auth.length === token.length && crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(token));
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, app: 'QassQass', version: app.getVersion(), authorized: okTok });
    if (!okTok) return send(res, 401, { error: 'unauthorized: send the token from api.json as "Authorization: Bearer <token>"' });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST JSON-RPC 2.0 to /' });
    let body = ''; let size = 0;
    for await (const ch of req) { size += ch.length; if (size > 8e6) return send(res, 413, { error: 'too large' }); body += ch; }
    let msg; try { msg = JSON.parse(body); } catch (e) { return send(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    const one = async (m) => {
      if (!m || typeof m.method !== 'string') return { jsonrpc: '2.0', id: m && m.id != null ? m.id : null, error: { code: -32600, message: 'invalid request' } };
      const ms = m.method === 'export' || m.method === 'batch' ? 4 * 3600e3 : (+((m.params || {}).timeoutMs) || 180e3);
      try { const r = await toRenderer(m.method, m.params, ms); return r.ok ? { jsonrpc: '2.0', id: m.id ?? null, result: r.result } : { jsonrpc: '2.0', id: m.id ?? null, error: { code: -32000, message: r.error } }; }
      catch (e) { return { jsonrpc: '2.0', id: m.id ?? null, error: { code: -32001, message: e.message } }; }
    };
    send(res, 200, Array.isArray(msg) ? await Promise.all(msg.map(one)) : await one(msg));
  }
  function start() {
    if (server) return Promise.resolve(status());
    token = crypto.randomBytes(24).toString('hex');
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => { handle(req, res).catch(e => { try { send(res, 500, { error: e.message }); } catch (er) {} }); });
      s.on('error', reject);
      s.listen(0, '127.0.0.1', () => {
        server = s; port = s.address().port;
        const info = { app: 'QassQass', url: 'http://127.0.0.1:' + port + '/', port, token, pid: process.pid, version: app.getVersion(), started: new Date().toISOString() };
        try { fs.mkdirSync(ud(), { recursive: true }); fs.writeFileSync(apiFile(), JSON.stringify(info, null, 2), { mode: 0o600 }); } catch (e) {}
        resolve(status());
      });
    });
  }
  function stop() { if (server) { try { server.close(); } catch (e) {} server = null; } try { const o = JSON.parse(fs.readFileSync(apiFile(), 'utf8')); if (o.pid === process.pid) fs.rmSync(apiFile(), { force: true }); } catch (e) {} return status(); }
  ipcMain.handle('api:status', async () => status());
  ipcMain.handle('api:enable', async (e, on) => { writeSet({ ...readSet(), enabled: !!on }); return on ? start() : stop(); });
  app.whenReady().then(() => { if (readSet().enabled) start().catch(e => console.error('api server', e)); });
  app.on('will-quit', stop);
  return { start, stop, status };
})();
/* ===== /api ===== */

/* ===== media perf ===== (background ffmpeg jobs at low priority + cancellable, file stat for cache keys, HW encoder detection) */
const MP = (() => {
  const procs = new Map(); let capsP = null;
  ipcMain.handle('mp:stat', async (e, p) => { try { const st = await fs.promises.stat(p); return { size: st.size, mtimeMs: st.mtimeMs }; } catch (er) { return null; } });
  // like ff:run, but the process runs below normal priority (proxies/audio conforming never starve playback or export) and can be killed
  ipcMain.handle('mp:run', async (e, id, args, o = {}) => new Promise((resolve) => {
    let log = '', p;
    try { p = spawn(ffmpegPath(), args, { windowsHide: true }); } catch (err) { resolve({ ok: false, log: String(err) }); return; }
    procs.set(id, p);
    if (o.low) { try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (er) {} }
    let lastT = -1, lastSend = 0;
    p.stderr.on('data', d => {
      const s = d.toString(); log = (log + s).slice(-20000);
      const m = /time=(\d+):(\d+):([\d.]+)/.exec(s); const now = Date.now();
      if (m && win && now - lastSend > 250) { const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]); if (t !== lastT) { lastT = t; lastSend = now; win.webContents.send('ff:progress', id, t); } }
    });
    p.on('error', err => { procs.delete(id); resolve({ ok: false, log: log + '\n' + err }); });
    p.on('close', code => { procs.delete(id); resolve({ ok: code === 0, code, log, killed: !!p._killed }); });
  }));
  ipcMain.handle('mp:existsMany', async (e, list) => Promise.all((list || []).map(p => fs.promises.access(p).then(() => true, () => false))));
  ipcMain.handle('mp:kill', async (e, id) => { const p = procs.get(id); if (p) { p._killed = true; try { p.kill(); } catch (er) {} } return !!p; });
  // one tiny lavfi encode per hardware encoder, run once per app session
  ipcMain.handle('mp:caps', async () => capsP || (capsP = (async () => {
    const out = {};
    await Promise.all(['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_qsv', 'hevc_qsv'].map(async enc => { out[enc] = (await runFF(ffargs.capsTestArgs(enc))).ok; }));
    return out;
  })()));
  // export decoders: sequential ffmpeg decode (HW-accelerated) of a clip's frames as raw yuv420p, resampled to the export
  // frame rate — avoids one <video> seek (= GOP re-decode) per exported frame on long-GOP 4K footage
  const decs = new Map(); let decSeq = 1;
  function decPump(d) {
    while (d.waiters.length && d.have >= d.fb) {
      const out = Buffer.allocUnsafe(d.fb); let o = 0;
      while (o < d.fb) { const c = d.chunks[0]; const n = Math.min(c.length, d.fb - o); c.copy(out, o, 0, n); o += n; if (n === c.length) d.chunks.shift(); else d.chunks[0] = c.subarray(n); }
      d.have -= d.fb; d.waiters.shift()(out);
    }
    if (d.have < d.fb * 3 && d.paused) { d.paused = false; d.p.stdout.resume(); }
    if (d.ended && d.have < d.fb) while (d.waiters.length) d.waiters.shift()(null);
  }
  ipcMain.handle('mp:decOpen', async (e, o) => {
    const id = decSeq++; const w = o.w & ~1, h = o.h & ~1;
    const args = ['-hide_banner', '-loglevel', 'error', ...(o.hw === false ? [] : ['-hwaccel', 'auto']), '-ss', String(Math.max(0, o.start || 0)), '-i', o.path, '-map', '0:v:0', '-an', '-sn', '-dn',
      '-vf', `setpts=PTS-${Math.max(0, +o.offset || 0).toFixed(6)}/TB,fps=fps=${o.fps}:round=up:start_time=0,scale=${w}:${h}:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-f', 'rawvideo', 'pipe:1'];
    let p; try { p = spawn(ffmpegPath(), args, { windowsHide: true }); } catch (err) { return { ok: false, error: String(err) }; }
    const d = { p, chunks: [], have: 0, fb: w * h * 3 / 2, waiters: [], ended: false, paused: false, log: '' };
    p.stdout.on('data', b => { d.chunks.push(b); d.have += b.length; if (d.have > d.fb * 4 && !d.paused) { d.paused = true; p.stdout.pause(); } decPump(d); });
    p.stdout.on('end', () => { d.ended = true; decPump(d); });
    p.stderr.on('data', b => { d.log = (d.log + b).slice(-4000); });
    p.on('error', () => { d.ended = true; decPump(d); });
    decs.set(id, d);
    return { ok: true, id, w, h };
  });
  ipcMain.handle('mp:decRead', (e, id) => new Promise(res => { const d = decs.get(id); if (!d) return res(null); d.waiters.push(res); decPump(d); }));
  ipcMain.handle('mp:decClose', async (e, id) => { const d = decs.get(id); if (d) { decs.delete(id); try { d.p.stdout.destroy(); d.p.kill(); } catch (er) {} while (d.waiters.length) d.waiters.shift()(null); } return true; });
  app.on('will-quit', () => { for (const [, p] of procs) { try { p.kill(); } catch (er) {} } for (const [, d] of decs) { try { d.p.kill(); } catch (er) {} } });
  return { procs, decs };
})();
/* ===== /media perf ===== */

/* ===== tts ===== (offline text-to-speech: Piper engine + voice downloads into userData, synthesis jobs — helpers in app/js/tts_core.js) */
const TTS = (() => {
  const core = require('./app/js/tts_core.js');
  const isWin = process.platform === 'win32';
  const EXE = isWin ? 'piper.exe' : 'piper';
  const st = { jobs: new Map(), dls: new Map() };
  const userDir = () => app.getPath('userData');
  const voicesDir = () => process.env.QASS_TTS_VOICES || path.join(userDir(), 'voices');
  const send = (p) => { try { if (win && !win.isDestroyed()) win.webContents.send('tts:progress', p); } catch (e) {} };
  // engine search order: env override (dev/tests) → bundled (installer) → dev tree → downloaded into userData
  function engineDirs() {
    const d = [];
    if (process.env.QASS_PIPER_DIR) d.push(process.env.QASS_PIPER_DIR);
    if (app.isPackaged) d.push(path.join(process.resourcesPath, 'bin', 'piper'));
    d.push(path.join(__dirname, 'bin', 'win', 'piper'), path.join(userDir(), 'piper'));
    return d;
  }
  function engine() { for (const d of engineDirs()) { const exe = path.join(d, EXE); if (fs.existsSync(exe)) return { dir: d, exe }; } return null; }
  const sz = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
  function voiceList() {
    const vd = voicesDir(); const out = core.VOICES.map(v => ({ id: v.id, lang: v.lang, n: v.n, mb: v.mb, rec: v.rec || 0, url: v.url, installed: sz(path.join(vd, v.onnx)) > 0 && sz(path.join(vd, v.json)) > 0, bytes: sz(path.join(vd, v.onnx)), partial: sz(path.join(vd, v.onnx + '.part')), downloading: st.dls.has('voice:' + v.id) }));
    try { for (const f of fs.readdirSync(vd)) if (/\.onnx$/i.test(f) && !out.some(v => v.id + '.onnx' === f) && sz(path.join(vd, f + '.json')) > 0) out.push({ id: 'file:' + f.replace(/\.onnx$/i, ''), lang: /^ar/i.test(f) ? 'ar' : /^en/i.test(f) ? 'en' : '', n: f.replace(/\.onnx$/i, ''), custom: 1, installed: true, bytes: sz(path.join(vd, f)), partial: 0, downloading: false }); } catch (e) {}
    return out;
  }
  function status() {
    const e = engine();
    return { platform: process.platform, engine: { installed: !!e, dir: e ? e.dir : null, size: core.ENGINE.size, version: core.PVER, downloadable: isWin || !!process.env.QASS_TTS_ENGINE_URL, downloading: st.dls.has('engine:piper') }, voices: voiceList(), voicesDir: voicesDir() };
  }
  async function dl(kind, id) {
    const key = kind + ':' + id; if (st.dls.has(key)) return { ok: false, error: 'busy' };
    const ac = new AbortController(); st.dls.set(key, ac);
    const prog = (phase) => (p) => send({ kind: 'download', target: kind, id, phase, got: p.got != null ? p.got : p.done, total: p.total });
    const fetchImpl = (u, o) => net.fetch(u, o);
    try {
      if (kind === 'voice') {
        const v = core.VOICES.find(x => x.id === id); if (!v) throw new Error('صوت غير معروف');
        const vd = voicesDir(); const base = process.env.QASS_TTS_BASEURL;
        // the small JSON first (it tells us the model is what we think it is), then the onnx
        await core.download(base ? base + v.json : v.jsonUrl, path.join(vd, v.json), { fetch: fetchImpl, signal: ac.signal, onProgress: prog('download') });
        if (!core.validVoiceJson(fs.readFileSync(path.join(vd, v.json), 'utf8'))) { fs.rmSync(path.join(vd, v.json), { force: true }); throw new Error('ملف إعدادات الصوت غير صالح'); }
        await core.download(base ? base + v.onnx : v.url, path.join(vd, v.onnx), { fetch: fetchImpl, expectedSize: v.size || 0, sha256: v.sha256, signal: ac.signal, onProgress: prog('download') });
        if (sz(path.join(vd, v.onnx)) < 1048576) { fs.rmSync(path.join(vd, v.onnx), { force: true }); throw new Error('ملف الصوت أصغر من المتوقع'); }
      } else {
        const E = core.ENGINE; const url = process.env.QASS_TTS_ENGINE_URL || E.url;
        const base = path.join(userDir(), 'piper'); const zip = base + '.zip';
        await core.download(url, zip, { fetch: fetchImpl, expectedSize: process.env.QASS_TTS_ENGINE_URL ? 0 : E.size, sha256: process.env.QASS_TTS_ENGINE_URL ? null : E.sha256, signal: ac.signal, onProgress: prog('download') });
        send({ kind: 'download', target: kind, id, phase: 'extract', got: 0, total: 1 });
        await fs.promises.rm(base, { recursive: true, force: true });
        await core.unzipTree(zip, base, core.ENGINE_KEEP, 1, prog('extract'));
        await fs.promises.rm(zip, { force: true });
        if (!fs.existsSync(path.join(base, EXE))) throw new Error('الملف المضغوط لا يحتوي على ' + EXE);
      }
      send({ kind: 'download', target: kind, id, phase: 'done' });
      return { ok: true };
    } catch (e) {
      const err = e.cancelled ? 'cancelled' : String(e.message || e);
      send({ kind: 'download', target: kind, id, phase: e.cancelled ? 'cancelled' : 'error', error: err });
      return { ok: false, cancelled: !!e.cancelled, error: err };
    } finally { st.dls.delete(key); }
  }
  // synthesize one text → WAV at o.out (absolute, may contain Arabic: piper only ever sees relative ASCII paths + stdin)
  async function run(o) {
    const id = String(o.id || ('t' + Date.now())); const vd = voicesDir(); const e = engine();
    if (!e) return { ok: false, error: 'engine-missing' };
    const v = core.VOICES.find(x => x.id === o.voice); const onnx = v ? v.onnx : String(o.voice || '').replace(/^file:/, '') + '.onnx';
    if (!/^[\w.-]+\.onnx$/i.test(onnx) || !fs.existsSync(path.join(vd, onnx)) || !fs.existsSync(path.join(vd, onnx + '.json'))) return { ok: false, error: 'voice-missing' };
    const text = core.oneLine(o.text); if (!text) return { ok: false, error: 'empty-text' };
    await fs.promises.mkdir(path.join(vd, '.jobs'), { recursive: true });
    const job = { id, procs: new Set(), cancelled: false }; st.jobs.set(id, job);
    const base = 'tts_' + id.replace(/[^\w]/g, ''); const outRel = path.join('.jobs', base + '.wav');
    const args = core.buildArgs({ model: onnx, config: onnx + '.json', out: outRel, speed: o.speed, pause: o.pause, speaker: o.speaker, noiseScale: o.noiseScale, noiseW: o.noiseW });
    const env = Object.assign({}, process.env); if (isWin) env.ESPEAK_DATA_PATH = path.join(e.dir, 'espeak-ng-data');
    try {
      send({ kind: 'run', id, phase: 'synth' });
      const r = await new Promise((resolve) => {
        let log = '', p;
        try { p = spawn(e.exe, args, { cwd: vd, env, windowsHide: true }); } catch (err) { resolve({ ok: false, code: -1, log: String(err) }); return; }
        job.procs.add(p);
        p.stderr.on('data', d => { log = (log + d).slice(-20000); });
        p.stdout.on('data', d => { log = (log + d).slice(-20000); });
        p.on('error', err => { job.procs.delete(p); resolve({ ok: false, code: -1, log: log + '\n' + err }); });
        p.on('close', code => { job.procs.delete(p); resolve({ ok: code === 0, code, log }); });
        p.stdin.on('error', () => {}); p.stdin.end(text + '\n', 'utf8');
      });
      if (job.cancelled) return { ok: false, cancelled: true };
      const tmp = path.join(vd, outRel); const info = fs.existsSync(tmp) ? core.wavInfo(fs.readFileSync(tmp)) : null;
      if (!r.ok || !info || !info.samples) return { ok: false, error: 'code ' + r.code + ': ' + r.log.slice(-1200), code: r.code };
      await fs.promises.mkdir(path.dirname(o.out), { recursive: true });
      await fs.promises.copyFile(tmp, o.out); await fs.promises.rm(tmp, { force: true });
      send({ kind: 'run', id, phase: 'done' });
      return { ok: true, path: o.out, seconds: info.seconds, rate: info.rate, channels: info.channels, log: r.log.slice(-800) };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
    finally { st.jobs.delete(id); fs.promises.rm(path.join(vd, outRel), { force: true }).catch(() => {}); }
  }
  function cancel(id) {
    const j = st.jobs.get(String(id)); if (j) { j.cancelled = true; for (const p of j.procs) { try { p.kill(); } catch (e) {} } }
    for (const k of [String(id), 'voice:' + id, 'engine:' + id]) { const a = st.dls.get(k); if (a) a.abort(); }
    return true;
  }
  async function removeVoice(id) {
    const v = core.VOICES.find(x => x.id === id); const f = v ? v.onnx : String(id).replace(/^file:/, '') + '.onnx';
    if (!/^[\w.-]+\.onnx$/i.test(f)) return false;
    for (const x of [f, f + '.json', f + '.part']) await fs.promises.rm(path.join(voicesDir(), x), { force: true });
    return true;
  }
  async function importVoice(src) { // offline install: an .onnx the user already has (its .onnx.json must sit next to it)
    if (!/\.onnx$/i.test(src) || !fs.existsSync(src + '.json')) return { ok: false, error: 'يلزم ملف .onnx ومعه ملف .onnx.json بنفس الاسم' };
    const name = path.basename(src).replace(/[^\w.-]+/g, '_');
    await fs.promises.mkdir(voicesDir(), { recursive: true });
    await fs.promises.copyFile(src, path.join(voicesDir(), name)); await fs.promises.copyFile(src + '.json', path.join(voicesDir(), name + '.json'));
    return { ok: true, id: 'file:' + name.replace(/\.onnx$/i, '') };
  }
  return { status, dl, run, cancel, removeVoice, importVoice, voicesDir, engine };
})();
ipcMain.handle('tts:status', async () => TTS.status());
ipcMain.handle('tts:download', async (e, kind, id) => TTS.dl(kind, id));
ipcMain.handle('tts:run', async (e, o) => TTS.run(o || {}));
ipcMain.handle('tts:cancel', async (e, id) => TTS.cancel(id));
ipcMain.handle('tts:remove-voice', async (e, id) => TTS.removeVoice(id));
ipcMain.handle('tts:import-voice', async (e, p) => TTS.importVoice(p));
ipcMain.handle('tts:open-voices', async () => { await fs.promises.mkdir(TTS.voicesDir(), { recursive: true }); return shell.openPath(TTS.voicesDir()); });
/* ===== /tts ===== */

/* ===== project organisation / media browser ===== (ui_project.js consolidate, ui_browser.js) */
ipcMain.handle('fs:copyFile', async (e, src, dst) => { try { await fs.promises.mkdir(path.dirname(dst), { recursive: true }); await fs.promises.copyFile(src, dst); return true; } catch (er) { console.error('copyFile', er.message); return false; } });
ipcMain.handle('fs:listDir', async (e, dir) => { // → { dir, parent, entries:[{name, path, dir:bool, size, mtimeMs}] } (hidden files skipped)
  try {
    const d = dir || require('os').homedir(); const names = await fs.promises.readdir(d);
    const entries = []; for (const n of names) { if (n.startsWith('.') || n.startsWith('$')) continue; const p = path.join(d, n); try { const st = await fs.promises.stat(p); entries.push({ name: n, path: p, dir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs }); } catch (er) {} }
    entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    const parent = path.dirname(d); return { dir: d, parent: parent === d ? null : parent, entries };
  } catch (er) { return { dir, parent: null, entries: [], error: er.message }; }
});
ipcMain.handle('fs:roots', async () => { // drives (Windows) or home / root (others)
  const os = require('os'); const out = [{ name: 'المنزل', path: os.homedir() }];
  if (process.platform === 'win32') { for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const r = L + ':\\'; try { if (fs.existsSync(r)) out.push({ name: r, path: r }); } catch (e) {} } } else out.push({ name: '/', path: '/' });
  return out;
});
/* ===== /project organisation ===== */
