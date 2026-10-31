'use strict';
// Main-process side of the experimental OpenFX bridge («إضافات OFX (تجريبي)»). Node only — required by main.js (ofx block) and by
// test/scenario_ofx.js with stub deps. Spawns tools/ofxhost (qq-ofxhost) to list plugins installed on this machine (in place, never
// copied) and bakes an effect: ffmpeg decode → raw rgba64le → qq-ofxhost → raw rgba64le → ffmpeg encode.
const path = require('path'), fs = require('fs'), os = require('os'); const { spawn } = require('child_process');
function create(deps) {
  const { ffmpegPath } = deps; const W32 = (deps.platform || process.platform) === 'win32';
  const hostPath = () => {
    if (process.env.QQ_OFXHOST) return process.env.QQ_OFXHOST;
    const c = deps.hostCandidates(); return c.find(p => fs.existsSync(p)) || c[c.length - 1];
  };
  const dir = () => path.join(deps.userData(), 'ofx');
  const cacheFile = () => path.join(dir(), 'scan-cache.json');
  const defaultFolder = () => W32 ? 'C:\\Program Files\\Red Giant\\Universe\\OFX' : path.join(os.homedir(), 'OFX');
  const binaryOf = (b) => { if (!b.endsWith('.bundle')) return b; const stem = path.basename(b).replace(/\.bundle$/, ''); return path.join(b, 'Contents', W32 ? 'Win64' : 'Linux-x86-64', stem); };
  const send = (ch, d) => { try { deps.send(ch, d); } catch (e) {} };
  const procs = new Map(); // job id → [child processes]
  const killed = new Set();
  // run qq-ofxhost to completion → {code, stdout, stderr}
  function runHost(args, { timeout = 120000, id } = {}) {
    return new Promise((resolve) => {
      let p, out = [], err = ''; const t0 = Date.now();
      try { p = spawn(hostPath(), args, { windowsHide: true }); } catch (e) { resolve({ code: -1, stdout: '', stderr: 'QQERR HOST_MISSING ' + e.message }); return; }
      if (id) procs.set(id, [p]);
      const to = setTimeout(() => { err += '\nQQERR TIMEOUT host did not answer within ' + Math.round(timeout / 1000) + 's'; try { p.kill(); } catch (e) {} }, timeout);
      p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => { err = (err + d.toString()).slice(-60000); });
      p.on('error', e => { err += '\nQQERR HOST_MISSING ' + e.message; });
      p.on('close', code => { clearTimeout(to); if (id) procs.delete(id); resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: err, ms: Date.now() - t0 }); });
    });
  }
  const lastErr = (s) => { const m = String(s || '').match(/QQERR (\S+) ?(.*)/g); if (!m) return null; const x = /QQERR (\S+) ?(.*)/.exec(m[m.length - 1]); return { code: x[1], detail: x[2] }; };
  const msgs = (s) => (String(s || '').match(/^QQMSG .*$/gm) || []).map(x => x.slice(6));
  async function findBundles(folder) {
    const out = [];
    const walk = async (d, depth) => {
      let names = []; try { names = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { return; }
      for (const n of names) {
        const p = path.join(d, n.name); let isDir = n.isDirectory(), isFile = n.isFile();
        if (n.isSymbolicLink()) { const st = await fs.promises.stat(p).catch(() => null); if (st) { isDir = st.isDirectory(); isFile = st.isFile(); } }
        if (isDir && /\.ofx\.bundle$/i.test(n.name)) out.push(p);
        else if (isFile && /\.ofx$/i.test(n.name) && depth === 0) out.push(p);
        else if (isDir && depth < 2) await walk(p, depth + 1);
      }
    };
    await walk(folder, 0); return out.sort();
  }
  async function scan({ folder, hostName, force, id = 'ofxscan' } = {}) {
    folder = folder || defaultFolder();
    const host = hostPath(); if (!fs.existsSync(host)) return { ok: false, error: 'HOST_MISSING', detail: host };
    let st; try { st = await fs.promises.stat(folder); } catch (e) { return { ok: false, error: 'FOLDER_MISSING', detail: folder }; }
    if (!st.isDirectory()) return { ok: false, error: 'FOLDER_MISSING', detail: folder };
    const bundles = await findBundles(folder);
    let cache = {}; try { cache = JSON.parse(await fs.promises.readFile(cacheFile(), 'utf8')); } catch (e) {}
    const hst = await fs.promises.stat(host).catch(() => null); const hkey = (hostName || '') + '|' + (hst ? hst.size + ':' + Math.round(hst.mtimeMs) : '');
    const res = new Array(bundles.length); let done = 0; let cancelled = false; procs.set(id, []); const job = { cancel: () => { cancelled = true; } }; scanJobs.set(id, job);
    const one = async (i) => {
      const b = bundles[i]; const bin = binaryOf(b); const bs = await fs.promises.stat(bin).catch(() => null);
      const key = bs ? bin + '|' + bs.size + '|' + Math.round(bs.mtimeMs) + '|' + hkey : null;
      if (!force && key && cache[key]) res[i] = cache[key];
      else if (!bs) res[i] = { bundle: b, binary: bin, error: 'BINARY_MISSING', detail: bin };
      else {
        const r = await runHost(['list', b, ...(hostName ? ['--host-name', hostName] : []), '--log', path.join(dir(), 'scan.log')], { timeout: 90000, id: id + ':' + i });
        let j = null; try { j = JSON.parse(r.stdout); } catch (e) {}
        if (j && j.bundles && j.bundles[0]) { res[i] = j.bundles[0]; res[i].ms = r.ms; if (key && !res[i].error) cache[key] = res[i]; }
        else { const le = lastErr(r.stderr) || { code: r.code === 9 ? 'CRASH' : 'HOST_FAILED', detail: String(r.stderr || '').slice(-400) }; res[i] = { bundle: b, binary: bin, error: le.code, detail: le.detail, exit: r.code }; }
      }
      done++; send('ofx:progress', { id, done, total: bundles.length, name: path.basename(b) });
    };
    await fs.promises.mkdir(dir(), { recursive: true });
    let next = 0; const N = Math.min(3, bundles.length);
    await Promise.all(Array.from({ length: N }, async () => { while (!cancelled && next < bundles.length) await one(next++); }));
    scanJobs.delete(id); procs.delete(id);
    try { await fs.promises.writeFile(cacheFile(), JSON.stringify(cache)); } catch (e) {}
    return { ok: true, folder, host, cancelled, bundles: res.filter(Boolean) };
  }
  const scanJobs = new Map();
  // bake: o = {id, bundle, index, params:{}, src, ss, dur, w, h, fps, frames, out, encArgs:[], audio, hostName, context}
  async function render(o) {
    const host = hostPath(); if (!fs.existsSync(host)) return { ok: false, error: 'HOST_MISSING', detail: host };
    await fs.promises.mkdir(dir(), { recursive: true }); await fs.promises.mkdir(path.dirname(o.out), { recursive: true });
    const pj = path.join(dir(), 'params_' + o.id + '.json'); await fs.promises.writeFile(pj, JSON.stringify(o.params || {}));
    const logf = path.join(dir(), 'render.log'); try { const st = await fs.promises.stat(logf); if (st.size > 4e6) await fs.promises.rm(logf); } catch (e) {}
    const N = Math.max(1, o.frames | 0), W = o.w | 0, H = o.h | 0, fps = +o.fps || 25;
    const inA = ['-ss', (+o.ss || 0).toFixed(3), '-t', (+o.dur).toFixed(3), '-i', o.src];
    const dec = ['-hide_banner', '-loglevel', 'error', ...inA, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `fps=${fps},scale=${W}:${H}:flags=bicubic,tpad=stop_mode=clone:stop_duration=2,format=rgba64le`, '-frames:v', String(N), '-f', 'rawvideo', '-pix_fmt', 'rgba64le', '-'];
    const hostA = ['render', o.bundle, String(o.index | 0), pj, '-', '-', String(W), String(H), String(N), '--fps', String(fps), '--log', logf, ...(o.hostName ? ['--host-name', o.hostName] : []), ...(o.context ? ['--context', o.context] : [])];
    const enc = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba64le', '-s', W + 'x' + H, '-r', String(fps), '-i', '-',
      ...(o.audio ? [...inA, '-map', '0:v:0', '-map', '1:a:0?'] : ['-map', '0:v:0']), ...(o.encArgs || []), '-t', (N / fps).toFixed(3), o.out];
    const S = { hostErr: '', decErr: '', encErr: '', done: 0 };
    let pd, ph, pe;
    try { ph = spawn(host, hostA, { windowsHide: true }); pd = spawn(ffmpegPath(), dec, { windowsHide: true }); pe = spawn(ffmpegPath(), enc, { windowsHide: true }); }
    catch (e) { for (const p of [pd, ph, pe]) try { p && p.kill(); } catch (er) {} return { ok: false, error: 'SPAWN_FAILED', detail: e.message }; }
    procs.set(o.id, [pd, ph, pe]);
    const ended = (p) => new Promise(r => { p.on('close', code => r(code)); p.on('error', e => r(-1)); });
    const [cd, ch, ce] = [ended(pd), ended(ph), ended(pe)];
    for (const s of [pd.stdin, pd.stdout, ph.stdin, ph.stdout, pe.stdin]) s.on('error', () => {});
    pd.stdout.pipe(ph.stdin); ph.stdout.pipe(pe.stdin);
    pd.stderr.on('data', d => { S.decErr = (S.decErr + d).slice(-8000); });
    pe.stderr.on('data', d => { S.encErr = (S.encErr + d).slice(-8000); });
    let lineBuf = '';
    ph.stderr.on('data', d => {
      S.hostErr = (S.hostErr + d).slice(-60000); lineBuf += d.toString(); const lines = lineBuf.split(/\r?\n/); lineBuf = lines.pop();
      for (const l of lines) { const m = /^QQPROGRESS (\d+) (\d+)/.exec(l); if (m) { S.done = +m[1]; send('ofx:progress', { id: o.id, done: +m[1], total: +m[2] }); } else if (/^QQMSG /.test(l)) send('ofx:progress', { id: o.id, msg: l.slice(6) }); }
    });
    // if the host dies, stop the decoder (it would block on a full pipe) and let the encoder finish/fail
    ch.then(() => { try { pd.kill(); } catch (e) {} });
    const [xd, xh, xe] = await Promise.all([cd, ch, ce]);
    procs.delete(o.id); fs.promises.rm(pj, { force: true }).catch(() => {});
    const res = { exit: { dec: xd, host: xh, enc: xe }, frames: S.done, messages: msgs(S.hostErr), log: logf, hostTail: S.hostErr.split(/\n/).filter(l => !/^QQPROGRESS/.test(l)).slice(-25).join('\n') };
    if (killed.has(o.id)) { killed.delete(o.id); fs.promises.rm(o.out, { force: true }).catch(() => {}); return { ...res, ok: false, cancelled: true }; }
    if (xh !== 0) { const le = lastErr(S.hostErr) || { code: xh === 9 ? 'CRASH' : 'HOST_FAILED', detail: 'exit ' + xh }; return { ...res, ok: false, error: le.code, detail: le.detail }; }
    if (xd !== 0 && xd !== null && S.done < N) return { ...res, ok: false, error: 'DECODE_FAILED', detail: S.decErr.slice(-400) };
    if (xe !== 0) return { ...res, ok: false, error: 'ENCODE_FAILED', detail: S.encErr.slice(-400) };
    return { ...res, ok: true, out: o.out };
  }
  function cancel(id) {
    const j = scanJobs.get(id); if (j) j.cancel(); if (procs.has(id)) killed.add(id);
    for (const [k, ps] of procs) if (k === id || k.startsWith(id + ':')) for (const p of ps) { try { p.kill(); } catch (e) {} }
    return true;
  }
  async function presets(o = {}) { // Universe-style presets (*.rgx JSON) next to the plugin folder: <root>/Presets/Plugins/<matchname>/*.rgx
    const out = []; const cands = [];
    if (o.dir) cands.push(o.dir);
    if (o.folder && o.match) { cands.push(path.join(path.dirname(o.folder), 'Presets', 'Plugins', o.match)); cands.push(path.join(o.folder, 'Presets', 'Plugins', o.match)); }
    for (const d of cands) {
      let names = []; try { names = await fs.promises.readdir(d); } catch (e) { continue; }
      for (const n of names.filter(n => /\.rgx$/i.test(n)).sort()) {
        try { const j = JSON.parse(await fs.promises.readFile(path.join(d, n), 'utf8')); const blocks = (j.content && j.content.blocks) || [];
          const streams = []; for (const b of blocks) for (const s of ((b.values && b.values.param_streams) || [])) streams.push({ name: s.name, id: s.id, type: s.type, value: s.value, choiceString: s.choiceString });
          out.push({ name: (j.naming && j.naming.name) || n.replace(/\.rgx$/i, ''), file: path.join(d, n), streams });
        } catch (e) {}
      }
      if (out.length) break;
    }
    return out;
  }
  /* ---- persistent server (qq-ofxhost serve): live preview + export of OFX effects in the effect chain ---- */
  const SV = { p: null, buf: Buffer.alloc(0), pending: [], err: '', hostName: '' };
  function serveStop(reason) {
    const p = SV.p; SV.p = null; if (p) { try { p.stdin.end(); p.kill(); } catch (e) {} }
    const pend = SV.pending.splice(0); for (const q of pend) { clearTimeout(q.to); q.resolve({ ok: false, json: { ok: false, code: reason || 'HOST_EXITED', detail: (SV.err.match(/QQERR .*/g) || []).slice(-1)[0] || SV.err.slice(-300) } }); }
  }
  function serveStart(hostName) {
    const host = hostPath(); if (!fs.existsSync(host)) return 'HOST_MISSING';
    fs.mkdirSync(dir(), { recursive: true });
    let p; try { p = spawn(host, ['serve', '--log', path.join(dir(), 'serve.log'), ...(hostName ? ['--host-name', hostName] : [])], { windowsHide: true }); } catch (e) { return 'SPAWN_FAILED'; }
    SV.p = p; SV.buf = Buffer.alloc(0); SV.err = ''; SV.hostName = hostName || '';
    p.stdin.on('error', () => {});
    p.stderr.on('data', d => { SV.err = (SV.err + d).slice(-20000); const m = String(d).match(/^QQMSG .*$/gm); if (m) for (const x of m) send('ofx:fxmsg', x.slice(6)); });
    p.stdout.on('data', d => {
      SV.buf = SV.buf.length ? Buffer.concat([SV.buf, d]) : d;
      for (;;) {
        if (SV.buf.length < 16) break;
        const magic = SV.buf.readUInt32LE(0), st = SV.buf.readUInt32LE(4), jl = SV.buf.readUInt32LE(8), pl = SV.buf.readUInt32LE(12);
        if (magic !== 0x50525151) { SV.err += '\nQQERR PROTOCOL bad reply'; serveStop('PROTOCOL'); return; }
        if (SV.buf.length < 16 + jl + pl) break;
        let json = {}; try { json = JSON.parse(SV.buf.subarray(16, 16 + jl).toString('utf8')); } catch (e) {}
        const payload = Buffer.from(SV.buf.subarray(16 + jl, 16 + jl + pl)); SV.buf = SV.buf.subarray(16 + jl + pl);
        const q = SV.pending.shift(); if (q) { clearTimeout(q.to); q.resolve({ ok: st === 0, json, payload }); }
      }
    });
    p.on('close', code => { if (SV.p === p) serveStop(code === 9 ? 'CRASH' : 'HOST_EXITED'); });
    p.on('error', () => { if (SV.p === p) serveStop('HOST_MISSING'); });
    return null;
  }
  // one request → {ok, json, payload}; requests are answered in order (the server is single-threaded)
  function serveRequest(json, payload, { timeout = 120000, hostName } = {}) {
    if (SV.p && hostName != null && hostName !== SV.hostName) serveStop('RESTART');
    if (!SV.p) { const e = serveStart(hostName); if (e) return Promise.resolve({ ok: false, json: { ok: false, code: e, detail: hostPath() } }); }
    const js = Buffer.from(JSON.stringify(json)); const pl = payload ? Buffer.from(payload.buffer || payload, payload.byteOffset || 0, payload.byteLength) : Buffer.alloc(0);
    const h = Buffer.alloc(12); h.writeUInt32LE(0x51525151, 0); h.writeUInt32LE(js.length, 4); h.writeUInt32LE(pl.length, 8);
    return new Promise((resolve) => {
      const q = { resolve }; q.to = setTimeout(() => { SV.err += '\nQQERR TIMEOUT the plugin did not answer within ' + Math.round(timeout / 1000) + 's'; serveStop('TIMEOUT'); }, timeout);
      SV.pending.push(q); const p = SV.p; p.stdin.write(h); p.stdin.write(js); if (pl.length) p.stdin.write(pl);
    });
  }
  return { hostPath, defaultFolder, scan, render, cancel, presets, dir, serveRequest, serveStop };
}
module.exports = { create };
