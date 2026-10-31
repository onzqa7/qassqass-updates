'use strict';
/* Adobe / Red Giant / Video Copilot library indexer (node; runs in a worker thread of the main process — see the
   «adobe import» block in main.js). Walks the configured folders, parses preset files with adobe_import.js and returns a
   compact JSON library. Files are only READ, never copied or modified. Usage (also from a plain node shell for tests):
     require('./adobe_scan.js').index({ roots:[{path, media, kind}], plugins:true }, (p) => progress)  → Promise<library> */
const fs = require('fs');
const path = require('path');
const os = require('os');
const AI = require('./adobe_import.js');

const SKIP_DIR = /^(node_modules|\.git|\$RECYCLE\.BIN|System Volume Information|__MACOSX|CEP|Frameworks|Locales|locales|Required|Microsoft\.VC.*|amt|dynamiclink|AMT|resources\.pak|nls|AdobeCleanUX|pdfl|webkit|Qt.*)$/;
const MEDIA_EXT = /\.(mov|mp4|m4v|webm|wav|mp3|aif|aiff|m4a|png|jpg|jpeg|tif|tiff|psd)$/i;

/* default folders per platform (Windows paths match the user's machine layout) */
function defaults() {
  const home = os.homedir(); const docs = path.join(home, 'Documents'); const out = [];
  const add = (p, kind, media) => out.push({ path: p, kind, media: !!media, exists: fs.existsSync(p) });
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'; const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    add(path.join(docs, 'Adobe'), 'adobe-docs', true);
    try { for (const n of fs.readdirSync(path.join(pf, 'Adobe'))) if (/^Adobe (After Effects|Premiere Pro|Media Encoder)/i.test(n)) add(path.join(pf, 'Adobe', n), 'adobe-app', false); } catch (e) {}
    add(path.join(pf, 'Adobe', 'Common'), 'adobe-common', false);
    add(path.join(pf, 'Red Giant'), 'redgiant', false);
    add(path.join(docs, 'Red Giant'), 'redgiant-docs', true);
    add(path.join(docs, 'VideoCopilot'), 'videocopilot', true);
    add(path.join(la, 'Microsoft', 'Windows', 'Fonts'), 'fonts', false);
  } else if (process.platform === 'darwin') {
    add(path.join(docs, 'Adobe'), 'adobe-docs', true);
    try { for (const n of fs.readdirSync('/Applications')) if (/^Adobe (After Effects|Premiere Pro|Media Encoder)/i.test(n)) add(path.join('/Applications', n), 'adobe-app', false); } catch (e) {}
    add('/Library/Application Support/Adobe/Common', 'adobe-common', false);
    add('/Library/Application Support/Red Giant', 'redgiant', false); add('/Applications/Red Giant', 'redgiant', false);
    add(path.join(docs, 'VideoCopilot'), 'videocopilot', true); add(path.join(home, 'Library', 'Fonts'), 'fonts', false);
  } else {
    add(path.join(docs, 'Adobe'), 'adobe-docs', true); add(path.join(docs, 'VideoCopilot'), 'videocopilot', true); add(path.join(home, '.fonts'), 'fonts', false);
  }
  return out;
}

async function walk(root, cb, o) {
  const st = [[root, 0]]; let n = 0;
  while (st.length) {
    const [d, depth] = st.pop(); let ents;
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < (o.maxDepth || 12) && !SKIP_DIR.test(e.name)) st.push([p, depth + 1]); continue; }
      if (!e.isFile()) continue;
      if (++n > (o.maxFiles || 400000)) return;
      cb(p, e.name);
    }
  }
}

/* plug-in identity from the PiPL resource ('MIB8' + reversed keys) and the version-info strings; reads at most the last 6 MB */
function pipl(file) {
  let b; try { const st = fs.statSync(file); const fd = fs.openSync(file, 'r'); const n = Math.min(st.size, 6e6); b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd); } catch (e) { return null; }
  const r = {}; let i = 0;
  while ((i = b.indexOf('MIB8', i)) >= 0 && i + 16 < b.length) {
    const k = b.toString('latin1', i + 4, i + 8).split('').reverse().join(''); const L = b.readUInt32LE(i + 12); const d = b.subarray(i + 16, i + 16 + Math.min(L, 300));
    if ((k === 'name' || k === 'catg' || k === 'eMNA') && d.length) { const n = d[0]; let v = d.toString('latin1', 1, 1 + n); if (k === 'eMNA' && !/^[\x20-\x7e]+$/.test(v)) v = d.toString('latin1').split('\0')[0]; (r[k] = r[k] || []).includes(v) || r[k].push(v); }
    i += 8;
  }
  for (const key of ['CompanyName', 'FileDescription', 'ProductName', 'FileVersion']) {
    const kk = Buffer.from(key, 'utf16le'); const j = b.lastIndexOf(kk); if (j < 0) continue; let s = j + kk.length; while (s < b.length - 1 && b[s] === 0 && b[s + 1] === 0) s += 2;
    const e = b.indexOf(Buffer.from([0, 0, 0]), s); if (e > s) { const v = b.toString('utf16le', s, e + 1).replace(/\0/g, '').trim(); if (v) r[key] = v.slice(0, 120); }
  }
  return r;
}

const MAPPED = (m) => !!(AI.MAP[m] || AI.BEHAVIOR[m] || /^ADBE (Motion|Opacity|Geometry2?|Basic 3D|Graphic Group)$/.test(m));

async function index(o = {}, progress = () => {}) {
  const roots = (o.roots && o.roots.length ? o.roots : defaults()).filter(r => r && r.path);
  const files = {}; const push = (k, v) => (files[k] = files[k] || []).push(v);
  const t0 = Date.now();
  for (const r of roots) {
    if (!fs.existsSync(r.path)) continue;
    progress({ phase: 'scan', root: r.path });
    await walk(r.path, (p, name) => {
      const ext = name.toLowerCase().split('.').pop(); const cls = AI.EXT[ext];
      if (cls === 'footage' || cls === 'image' || cls === 'sound') { if (r.media && MEDIA_EXT.test(name) && !/[\\/]_media[\\/]/.test(p) && !/[\\/](Thumbnails?|thumbs|Icons?|Help)[\\/]/i.test(p)) push('media', { p, k: cls, root: r.kind }); return; }
      if (cls) push(cls, { p, root: r.kind });
    }, o);
  }
  const lib = { v: 1, at: Date.now(), roots, counts: {}, ffx: [], prfpset: [], epr: [], essentialsound: [], rgx: [], luts: [], looks: [], models: [], e3d: [], fonts: [], media: [], plugins: [], scripts: [], errors: [] };
  for (const k in files) lib.counts[k] = files[k].length;
  const err = (p, e) => { if (lib.errors.length < 200) lib.errors.push({ p, e: String(e && e.message || e) }); };
  const slim = (pr) => { for (const e of pr.effects || []) if (!MAPPED(e.match)) e.params = []; return pr; };
  // AE animation presets
  let i = 0;
  // User choice: AE presets are not imported by default (only his «Default CRT» preset); the full converter stays available
  // for later via o.ffxAll / localStorage 'qq.adobe.ffxAll' passed in by the UI.
  const ffxAll = !!(o && o.ffxAll); const ffxKeep = /default\s*crt/i;
  files.ffx = (files.ffx || []).filter(f => ffxAll || ffxKeep.test(path.basename(f.p)));
  for (const f of files.ffx || []) {
    if (++i % 25 === 0) { progress({ phase: 'ffx', i, n: files.ffx.length }); await new Promise(r => setImmediate(r)); }
    try { const pr = AI.parseFFX(fs.readFileSync(f.p), path.basename(f.p, path.extname(f.p))); pr.file = f.p; pr.folder = path.basename(path.dirname(f.p)); slim(pr); if (pr.props && pr.props.length > 80) pr.props = pr.props.filter(p => p.keys || /^ADBE (Opacity|Scale|Position|Rotate Z)$/.test(p.match)).slice(0, 80); lib.ffx.push(pr); } catch (e) { err(f.p, e); }
  }
  // Premiere effect presets: newest profile first, duplicates (same folder/name/effects) dropped
  const vOf = (p) => { const m = /(\d+)\.(\d+)[\\/]Profile/i.exec(p); return m ? (+m[1]) * 100 + (+m[2]) - (/Beta/i.test(p) ? 1 : 0) : 0; };
  const seen = new Set();
  for (const f of (files.prfpset || []).filter(f => !/LocalizedPresets[\\/](?!en_US)/i.test(f.p)).sort((a, b) => vOf(b.p) - vOf(a.p))) {
    progress({ phase: 'prfpset', file: f.p });
    try {
      const st = fs.statSync(f.p); if (st.size > 1.5e9) { err(f.p, 'too large'); continue; }
      let buf = fs.readFileSync(f.p); const list = AI.parsePrfpset(buf, { keepParams: MAPPED }); buf = null;
      for (const pr of list) { const key = pr.path.join('/') + '|' + pr.name + '|' + pr.effects.map(e => e.match).join(','); if (seen.has(key)) continue; seen.add(key); pr.file = f.p; lib.prfpset.push(pr); }
    } catch (e) { err(f.p, e); }
  }
  for (const f of files.epr || []) { try { lib.epr.push(AI.parseEPR(fs.readFileSync(f.p, 'utf8'), f.p)); } catch (e) { err(f.p, e); } }
  const esSeen = new Set();
  for (const f of (files.essentialsound || []).sort((a, b) => vOf(b.p) - vOf(a.p))) { try { const es = AI.parseEssentialSound(fs.readFileSync(f.p, 'utf8'), f.p); if (es.isConfig) continue; const k = es.mode + '|' + es.name; if (esSeen.has(k)) continue; esSeen.add(k); lib.essentialsound.push(es); } catch (e) { err(f.p, e); } }
  i = 0;
  for (const f of files.rgx || []) { if (++i % 200 === 0) { progress({ phase: 'rgx', i, n: files.rgx.length }); await new Promise(r => setImmediate(r)); } try { const r = AI.parseRGX(fs.readFileSync(f.p, 'utf8'), f.p); r.hasPreview = fs.existsSync(r.preview); r.hasThumb = fs.existsSync(r.thumb); delete r.params; lib.rgx.push(r); } catch (e) { err(f.p, e); } }
  for (const f of files.lut || []) lib.luts.push({ p: f.p, name: path.basename(f.p).replace(/\.(cube|3dl)$/i, ''), fmt: path.extname(f.p).slice(1).toLowerCase(), slot: /technical|log|rec709|camera|input/i.test(f.p) ? 'in' : 'cr', root: f.root });
  for (const f of files.look || []) lib.looks.push({ p: f.p, name: path.basename(f.p, path.extname(f.p)) });
  for (const f of files.model || []) { const mtl = f.p.replace(/\.obj$/i, '.mtl'); lib.models.push({ p: f.p, name: path.basename(f.p, path.extname(f.p)), fmt: path.extname(f.p).slice(1).toLowerCase(), mtl: /\.obj$/i.test(f.p) && fs.existsSync(mtl) ? mtl : null, size: (() => { try { return fs.statSync(f.p).size; } catch (e) { return 0; } })() }); }
  for (const f of files.e3d || []) lib.e3d.push({ p: f.p, name: path.basename(f.p, '.e3d') });
  for (const f of files.font || []) { const n = path.basename(f.p).replace(/\.(ttf|otf)$/i, ''); const fam = n.replace(/[-_ ]?(VariableFont.*|Variable|Regular|Bold|Light|Medium|Black|Italic|Thin|Semi ?Bold|Extra ?Bold|Heavy|Book|\(\d+\))+$/ig, '').replace(/[-_]+/g, ' ').trim() || n; lib.fonts.push({ p: f.p, name: n, family: fam, weight: /black|heavy/i.test(n) ? 900 : /extra ?bold/i.test(n) ? 800 : /bold/i.test(n) ? 700 : /semi ?bold/i.test(n) ? 600 : /medium/i.test(n) ? 500 : /light/i.test(n) ? 300 : /thin/i.test(n) ? 100 : 400, italic: /italic/i.test(n), src: f.root, oss: /open_source_fonts|ofl_fonts|apache_fonts|ubuntu_fonts/i.test(f.p), app: (/^adobe-(app|common)$/.test(f.root) || /Program Files|Applications/i.test(f.p)) && !/open_source_fonts/i.test(f.p) && !/Fonts$/i.test(path.dirname(f.p).split(/[\\/]/).slice(-2).join('/')) || /[\\/](CEP|AdobeCleanUX|pdfl|otf|ttf)[\\/]/i.test(f.p) }); }
  lib.media = (files.media || []).slice(0, 20000).map(m => ({ p: m.p, k: m.k, name: path.basename(m.p), dir: path.basename(path.dirname(m.p)) }));
  for (const f of files.script || []) { const s = { p: f.p, name: path.basename(f.p), panel: /ScriptUI Panels/i.test(f.p), bin: /\.jsxbin$/i.test(f.p) }; if (!s.bin) { try { const t = fs.readFileSync(f.p, 'utf8').slice(0, 4000); s.ui = /ScriptUI|new Window|\bPanel\b/.test(t); const c = /\/\*([\s\S]{10,400}?)\*\/|\/\/\s*(.{10,200})/.exec(t); if (c) s.desc = (c[1] || c[2]).replace(/\s+/g, ' ').trim().slice(0, 200); } catch (e) {} } lib.scripts.push(s); }
  if (o.plugins) {
    i = 0; const list = files.plugin || [];
    for (const f of list) { if (++i % 40 === 0) { progress({ phase: 'plugins', i, n: list.length }); await new Promise(r => setImmediate(r)); } const r = pipl(f.p) || {}; lib.plugins.push({ p: f.p, name: (r.name && r.name[0]) || path.basename(f.p).replace(/\.(aex|prm|ofx)$/i, ''), cat: r.catg ? r.catg[0] : '', match: r.eMNA || [], company: r.CompanyName || '', desc: r.FileDescription || '', product: r.ProductName || '', ver: r.FileVersion || '', vendor: AI.vendorOf((r.eMNA && r.eMNA[0]) || path.basename(f.p)) }); }
  } else lib.plugins = (files.plugin || []).map(f => ({ p: f.p, name: path.basename(f.p).replace(/\.(aex|prm|ofx)$/i, '') }));
  lib.ms = Date.now() - t0;
  progress({ phase: 'done', ms: lib.ms });
  return lib;
}

module.exports = { index, defaults, pipl };

// worker-thread entry: main.js starts this file with workerData = options
try {
  const wt = require('worker_threads');
  if (!wt.isMainThread && wt.workerData && wt.workerData.__adobeScan) {
    index(wt.workerData.opts || {}, (p) => wt.parentPort.postMessage({ progress: p })).then(lib => wt.parentPort.postMessage({ lib }), e => wt.parentPort.postMessage({ error: String(e && e.stack || e) }));
  }
} catch (e) {}
