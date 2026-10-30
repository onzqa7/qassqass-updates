'use strict';
/* Speech-to-text helpers for the MAIN process (Node only; not loaded by the renderer).
   whisper.cpp (MIT) engine management: model/engine catalogue, resumable verified downloads,
   a small zip extractor, whisper-cli argument building, progress parsing and JSON normalisation.
   Used by the "===== whisper =====" block at the end of main.js; unit-tested by test/unit/asr_core.js. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
// sizes are the published sizes (MiB) — checked with a tolerance; sha1 values from whisper.cpp/models/README.md
const MODELS = [
  { id: 'large-v3-turbo', file: 'ggml-large-v3-turbo.bin', n: 'Large v3 Turbo — الأدق للعربية (موصى به)', mb: 1549, sha1: '4af2b29d7ec73d781377bfd1758ca957a807e941', dtw: 'large.v3.turbo', rec: 1 },
  { id: 'large-v3-turbo-q5_0', file: 'ggml-large-v3-turbo-q5_0.bin', n: 'Large v3 Turbo (مضغوط q5_0) — دقة قريبة وحجم أصغر', mb: 547, sha1: 'e050f7970618a659205450ad97eb95a18d69c9ee', dtw: 'large.v3.turbo' },
  { id: 'small', file: 'ggml-small.bin', n: 'Small — متوسط', mb: 466, sha1: '55356645c2b361a969dfd0ef2c5a50d530afd8d5', dtw: 'small' },
  { id: 'base', file: 'ggml-base.bin', n: 'Base — سريع وأقل دقة', mb: 142, sha1: '465707469ff3a37a2b9b8d8f89f2f99de7299dac', dtw: 'base' }
];
MODELS.forEach(m => { m.url = HF + m.file; m.size = m.mb * 1048576; });

// whisper.cpp official Windows x64 release builds (same tag for both so the DLLs are interchangeable)
const WVER = 'v1.9.2';
const GH = 'https://github.com/ggml-org/whisper.cpp/releases/download/' + WVER + '/';
const ENGINES = {
  cpu: { url: GH + 'whisper-bin-x64.zip', size: 8194445, sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a', n: 'المعالج (CPU)' },
  cuda: { url: GH + 'whisper-cublas-12.4.0-bin-x64.zip', size: 670611449, sha256: '443110ddaad70d4290ab2e77179e31cf712035bbc4fad56bb4519a90c917b39c', n: 'كرت NVIDIA (CUDA 12.4)' }
};
// files to keep from a release zip (everything else — tests, servers, SDL — is skipped)
const ENGINE_KEEP = /^(whisper-cli\.exe|whisper\.dll|ggml[\w.-]*\.dll|cudart64_\d+\.dll|cublas64_\d+\.dll|cublasLt64_\d+\.dll|msvcp140[\w]*\.dll|vcruntime140[\w]*\.dll|vcomp140\.dll)$/i;

/* ---------------- downloads ---------------- */
class Cancelled extends Error { constructor() { super('cancelled'); this.cancelled = true; } }
// Resumable streaming download with size + hash verification. fetchImpl: WHATWG fetch (Electron net.fetch in the app).
async function download(url, dest, o = {}) {
  const fetchImpl = o.fetch || globalThis.fetch;
  const part = dest + '.part';
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  let have = 0; try { have = (await fs.promises.stat(part)).size; } catch (e) {}
  const algo = o.sha256 ? 'sha256' : o.sha1 ? 'sha1' : null; const want = (o.sha256 || o.sha1 || '').toLowerCase();
  const hash = algo ? crypto.createHash(algo) : null;
  const headers = Object.assign({ 'User-Agent': 'QassQass/2 (whisper model download)' }, o.headers || {});
  if (have > 0) headers.Range = 'bytes=' + have + '-';
  const res = await fetchImpl(url, { headers, signal: o.signal, redirect: 'follow' });
  if (res.status === 416 && have > 0) { // .part already complete (or stale): restart cleanly
    await fs.promises.rm(part, { force: true }); return download(url, dest, o);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let total = 0;
  if (res.status === 206 && have > 0) {
    const cr = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || ''); total = cr ? +cr[1] : have + (+res.headers.get('content-length') || 0);
    if (hash) await new Promise((ok, bad) => fs.createReadStream(part).on('data', d => hash.update(d)).on('end', ok).on('error', bad));
  } else { have = 0; total = +res.headers.get('content-length') || 0; }
  const tol = o.sizeTolerance != null ? o.sizeTolerance : 0;
  if (o.expectedSize && total && Math.abs(total - o.expectedSize) > o.expectedSize * tol) throw new Error('حجم الملف على الخادم غير متوقع (' + total + ' بايت)');
  const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
  const outDone = new Promise((ok, bad) => { out.on('finish', ok); out.on('error', bad); });
  let got = have, last = 0;
  const report = (force) => { const now = Date.now(); if (o.onProgress && (force || now - last > 200)) { last = now; o.onProgress({ got, total: total || o.expectedSize || 0 }); } };
  try {
    const reader = res.body.getReader();
    for (;;) {
      if (o.signal && o.signal.aborted) throw new Cancelled();
      const { done, value } = await reader.read();
      if (done) break;
      const b = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (hash) hash.update(b);
      got += b.length;
      if (!out.write(b)) await new Promise(r => out.once('drain', r));
      report(false);
    }
  } catch (e) {
    out.end(); await outDone.catch(() => {});
    if (e.name === 'AbortError' || (o.signal && o.signal.aborted)) throw new Cancelled();
    throw e; // keep .part for resume
  }
  out.end(); await outDone; report(true);
  if (total && got !== total) throw new Error('انقطع التنزيل (' + got + ' / ' + total + ')');
  if (o.expectedSize && Math.abs(got - o.expectedSize) > o.expectedSize * tol) { await fs.promises.rm(part, { force: true }); throw new Error('حجم الملف غير صحيح'); }
  if (hash) { const h = hash.digest('hex'); if (h !== want) { await fs.promises.rm(part, { force: true }); throw new Error('فشل التحقق من سلامة الملف (' + algo + ')'); } }
  await fs.promises.rm(dest, { force: true }); await fs.promises.rename(part, dest);
  return { ok: true, size: got, path: dest };
}

/* ---------------- minimal zip reader (deflate/store, zip64) ---------------- */
async function zipEntries(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const st = await fh.stat(); const tailLen = Math.min(st.size, 65557 + 20);
    const tail = Buffer.alloc(tailLen); await fh.read(tail, 0, tailLen, st.size - tailLen);
    let e = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('ليس ملف zip صالحًا');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (e >= 20 && tail.readUInt32LE(e - 20) === 0x07064b50) { // zip64 locator
      const z64 = Number(tail.readBigUInt64LE(e - 12)); const rec = Buffer.alloc(56); await fh.read(rec, 0, 56, z64);
      if (rec.readUInt32LE(0) === 0x06064b50) { count = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdOff = Number(rec.readBigUInt64LE(48)); }
    }
    const cd = Buffer.alloc(cdSize); await fh.read(cd, 0, cdSize, cdOff);
    const out = []; let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: central directory');
      const method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16); let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32); let lho = cd.readUInt32LE(p + 42);
      const flags = cd.readUInt16LE(p + 8);
      const name = cd.slice(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
      let x = p + 46 + nl; const xe = x + xl;
      while (x + 4 <= xe) { const id = cd.readUInt16LE(x), sz = cd.readUInt16LE(x + 2); if (id === 1) { let q = x + 4; if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; } if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; } if (lho === 0xffffffff) { lho = Number(cd.readBigUInt64LE(q)); } } x += 4 + sz; }
      out.push({ name, method, crc, csize, usize, lho });
      p = xe + cl;
    }
    return out;
  } finally { await fh.close(); }
}
// extract entries whose basename matches keep (RegExp|fn) flat into destDir. onProgress({done,total})
async function unzip(file, destDir, keep, onProgress) {
  const ents = (await zipEntries(file)).filter(e => !e.name.endsWith('/') && (!keep || (keep.test ? keep.test(path.posix.basename(e.name)) : keep(e.name))));
  await fs.promises.mkdir(destDir, { recursive: true });
  const total = ents.reduce((a, e) => a + e.usize, 0); let done = 0;
  const fh = await fs.promises.open(file, 'r');
  try {
    for (const e of ents) {
      const lh = Buffer.alloc(30); await fh.read(lh, 0, 30, e.lho);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('zip: local header');
      const start = e.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const dst = path.join(destDir, path.posix.basename(e.name));
      const src = e.csize ? fs.createReadStream(file, { start, end: start + e.csize - 1 }) : require('stream').Readable.from([]);
      const out = fs.createWriteStream(dst + '.tmp');
      let crc = 0; const useCrc = typeof zlib.crc32 === 'function';
      await new Promise((ok, bad) => {
        const s = e.method === 8 ? src.pipe(zlib.createInflateRaw()) : e.method === 0 ? src : null;
        if (!s) return bad(new Error('zip: unsupported method ' + e.method));
        src.on('error', bad); s.on('error', bad); out.on('error', bad); out.on('finish', ok);
        s.on('data', d => { if (useCrc) crc = zlib.crc32(d, crc); done += d.length; if (onProgress) onProgress({ done, total }); });
        s.pipe(out);
      });
      if (useCrc && (crc >>> 0) !== (e.crc >>> 0)) throw new Error('zip: CRC mismatch in ' + e.name);
      await fs.promises.rm(dst, { force: true }); await fs.promises.rename(dst + '.tmp', dst);
    }
  } finally { await fh.close(); }
  return ents.map(e => path.posix.basename(e.name));
}

/* ---------------- whisper-cli ---------------- */
// all file arguments are RELATIVE to cwd (whisper-cli reads argv in the ANSI code page on Windows,
// so absolute paths with Arabic user names would break — Node spawns with a Unicode cwd instead)
function buildArgs(o) {
  const a = ['-m', o.model, '-f', o.wav, '-of', o.outBase, '-ojf', '-pp', '-l', o.lang || 'auto', '-t', String(o.threads || 4)];
  if (o.translate) a.push('-tr');
  if (o.dtw) a.push('-dtw', o.dtw);
  if (o.noGpu) a.push('-ng');
  if (o.prompt) a.push('--prompt', o.prompt);
  if (o.beam) a.push('-bs', String(o.beam));
  if (o.maxLen) a.push('-ml', String(o.maxLen), '-sow');
  if (o.vadModel) a.push('--vad', '-vm', o.vadModel);
  return a;
}
function parseProgress(s) { let pct = null; const re = /progress\s*=\s*(\d+)%/g; let m; while ((m = re.exec(s))) pct = Math.min(100, +m[1]); return pct; }
const tsSec = (h, m, s) => (+h) * 3600 + (+m) * 60 + parseFloat(s);
// live segments printed on stdout: "[00:00:01.000 --> 00:00:03.500]   text"
function parseLiveSegments(s) {
  const out = []; const re = /\[(\d+):(\d+):([\d.]+)\s*-->\s*(\d+):(\d+):([\d.]+)\]\s*(.*)/g; let m;
  while ((m = re.exec(s))) out.push({ t0: tsSec(m[1], m[2], m[3]), t1: tsSec(m[4], m[5], m[6]), text: m[7].trim() });
  return out;
}
function backendFromLog(log) {
  if (/using CUDA\d* backend|ggml_cuda_init: found [1-9]/i.test(log) && !/no CUDA devices|CUDA error/i.test(log)) return 'cuda';
  return 'cpu';
}
const isSpecial = t => /^\s*(\[_[A-Z]+[_\d]*\]|<\|[^|]*\|>)\s*$/.test(t) || /^\[_/.test(t.trim());
const PUNCT = /^[\s.,!?;:،؛؟…"'»«)\]}\-–—]+$/u;
// whisper -ojf JSON text → { lang, segments:[{t0,t1,text,words:[{w,t0,t1,p}]}] } (seconds)
function parseWhisperJSON(text) {
  // whisper's writer doesn't escape control characters and may print nan/inf
  const clean = String(text).replace(/[\u0000-\u001f]/g, ' ').replace(/:\s*-?(nan|inf)\b/gi, ': 0');
  const j = JSON.parse(clean);
  const segs = [];
  for (const s of j.transcription || []) {
    const off = s.offsets || {}; const t0 = (off.from || 0) / 1000, t1 = (off.to || 0) / 1000;
    const words = []; let cur = null;
    const toks = (s.tokens || []).filter(t => t && typeof t.text === 'string' && !isSpecial(t.text));
    const dtwOk = toks.length && toks.every(t => typeof t.t_dtw === 'number' && t.t_dtw >= 0);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]; const tx = t.text.replace(/�/g, '');
      let a = t.offsets ? t.offsets.from / 1000 : t0, b = t.offsets ? t.offsets.to / 1000 : t1;
      if (dtwOk) { a = t.t_dtw / 100; b = i + 1 < toks.length ? toks[i + 1].t_dtw / 100 : t1; }
      const startsWord = /^\s/.test(tx) || !cur;
      if (!tx.trim()) continue;
      if (startsWord && !(cur && PUNCT.test(tx))) { cur = { w: tx.trim(), t0: a, t1: b, p: t.p != null ? +t.p : 1, n: 1 }; words.push(cur); }
      else { cur.w += tx.trim() === tx ? tx : tx.trim(); cur.t1 = Math.max(cur.t1, b); cur.p += t.p != null ? +t.p : 1; cur.n++; }
    }
    for (const w of words) { w.p = Math.round(w.p / w.n * 1000) / 1000; delete w.n; }
    // clamp & make monotonic inside the segment
    let prev = t0;
    for (const w of words) { w.t0 = Math.min(Math.max(w.t0, prev, t0), t1); w.t1 = Math.min(Math.max(w.t1, w.t0 + .01), t1 || w.t0 + .3); prev = w.t0; }
    const txt = String(s.text || '').replace(/�/g, '').trim();
    if (!txt && !words.length) continue;
    segs.push({ t0, t1, text: txt || words.map(w => w.w).join(' '), words });
  }
  return { lang: (j.result && j.result.language) || (j.params && j.params.language) || '', segments: segs };
}
function defaultThreads(cpus, gpu) { if (gpu) return 4; return Math.max(2, Math.min(12, (cpus || 4) - 2)); }

const api = { MODELS, ENGINES, ENGINE_KEEP, WVER, download, zipEntries, unzip, buildArgs, parseProgress, parseLiveSegments, backendFromLog, parseWhisperJSON, defaultThreads, Cancelled };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
