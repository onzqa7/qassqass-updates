'use strict';
/* Text-to-speech helpers for the MAIN process (Node only; not loaded by the renderer).
   Piper TTS (MIT, github.com/rhasspy/piper) engine + voice catalogue (huggingface.co/rhasspy/piper-voices),
   tree-preserving zip extraction (piper ships espeak-ng-data/ as a directory tree), argument building and text
   splitting. Downloads reuse asr_core.download (resume + size/sha verification).
   Used by the "===== tts =====" block at the end of main.js; unit-tested by test/unit/tts_core.js. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const asr = require('./asr_core.js');

// piper release 2023.11.14-2 — size + sha256 verified against the published asset (22 477 236 bytes)
const PVER = '2023.11.14-2';
const ENGINE = {
  url: 'https://github.com/rhasspy/piper/releases/download/' + PVER + '/piper_windows_amd64.zip',
  size: 22477236, sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea', n: 'Piper TTS ' + PVER
};
// files we keep from the zip (strip the leading "piper/" folder; espeak-ng-data/** keeps its tree)
const ENGINE_KEEP = (name) => /^piper\/(piper\.exe|[\w.-]+\.dll|libtashkeel_model\.ort|espeak-ng-data\/.+)$/i.test(name);

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/';
// mb = approximate published size for the UI (the download verifies Content-Length and the voice's JSON);
// sha256 values are not published by the repository as a manifest → left out (see download verification below)
const VOICES = [
  { id: 'ar_JO-kareem-medium', lang: 'ar', n: 'كريم — عربي (متوسط، موصى به)', p: 'ar/ar_JO/kareem/medium/', mb: 63, rec: 1 },
  { id: 'ar_JO-kareem-low', lang: 'ar', n: 'كريم — عربي (خفيف وسريع)', p: 'ar/ar_JO/kareem/low/', mb: 28 },
  { id: 'en_US-lessac-medium', lang: 'en', n: 'Lessac — English (US, medium)', p: 'en/en_US/lessac/medium/', mb: 63 },
  { id: 'en_US-amy-medium', lang: 'en', n: 'Amy — English (US, medium)', p: 'en/en_US/amy/medium/', mb: 63 },
  { id: 'en_GB-alan-medium', lang: 'en', n: 'Alan — English (UK, medium)', p: 'en/en_GB/alan/medium/', mb: 63 }
];
VOICES.forEach(v => { v.onnx = v.id + '.onnx'; v.json = v.id + '.onnx.json'; v.url = HF + v.p + v.onnx; v.jsonUrl = HF + v.p + v.json; });

/* ---------------- tree-preserving zip extraction ---------------- */
// extract entries accepted by keep(name) under destDir, dropping the first path component when strip=1
async function unzipTree(file, destDir, keep, strip, onProgress) {
  const ents = (await asr.zipEntries(file)).filter(e => !e.name.endsWith('/') && (!keep || keep(e.name)));
  const total = ents.reduce((a, e) => a + e.usize, 0); let done = 0;
  const fh = await fs.promises.open(file, 'r'); const out = [];
  try {
    for (const e of ents) {
      const parts = e.name.split('/').filter(Boolean).slice(strip || 0); if (!parts.length || parts.some(p => p === '..')) continue;
      const rel = parts.join('/'); const dst = path.join(destDir, ...parts);
      await fs.promises.mkdir(path.dirname(dst), { recursive: true });
      const lh = Buffer.alloc(30); await fh.read(lh, 0, 30, e.lho);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('zip: local header');
      const start = e.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const src = e.csize ? fs.createReadStream(file, { start, end: start + e.csize - 1 }) : require('stream').Readable.from([]);
      const w = fs.createWriteStream(dst + '.tmp'); let crc = 0; const useCrc = typeof zlib.crc32 === 'function';
      await new Promise((ok, bad) => {
        const s = e.method === 8 ? src.pipe(zlib.createInflateRaw()) : e.method === 0 ? src : null;
        if (!s) return bad(new Error('zip: unsupported method ' + e.method));
        src.on('error', bad); s.on('error', bad); w.on('error', bad); w.on('finish', ok);
        s.on('data', d => { if (useCrc) crc = zlib.crc32(d, crc); done += d.length; if (onProgress) onProgress({ done, total }); });
        s.pipe(w);
      });
      if (useCrc && (crc >>> 0) !== (e.crc >>> 0)) throw new Error('zip: CRC mismatch in ' + e.name);
      await fs.promises.rm(dst, { force: true }); await fs.promises.rename(dst + '.tmp', dst); out.push(rel);
    }
  } finally { await fh.close(); }
  return out;
}

/* ---------------- piper ---------------- */
// piper reads the text from stdin (UTF-8) → no Arabic on argv; model/config/output are RELATIVE to cwd (voices dir)
function buildArgs(o) {
  const a = ['--model', o.model, '--config', o.config, '--output_file', o.out];
  const speed = Math.min(3, Math.max(0.25, +o.speed || 1));
  a.push('--length_scale', String(Math.round(1000 / speed) / 1000));
  if (o.pause != null) a.push('--sentence_silence', String(Math.max(0, Math.min(5, +o.pause))));
  if (o.speaker != null) a.push('--speaker', String(o.speaker | 0));
  if (o.noiseScale != null) a.push('--noise_scale', String(+o.noiseScale));
  if (o.noiseW != null) a.push('--noise_w', String(+o.noiseW));
  return a;
}
// split a text into paragraphs (blank lines; or single newlines when there are no blank lines)
function paragraphs(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim(); if (!t) return [];
  let parts = t.split(/\n\s*\n+/).map(s => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  if (parts.length === 1 && /\n/.test(t)) parts = t.split('\n').map(s => s.trim()).filter(Boolean);
  return parts;
}
// piper needs the text on ONE line per utterance; keep sentence punctuation (it drives --sentence_silence)
const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
function validVoiceJson(txt) {
  try { const j = JSON.parse(txt); return !!(j && j.audio && +j.audio.sample_rate > 0); } catch (e) { return false; }
}
// 16-bit mono PCM WAV header parse → { rate, channels, bits, samples, seconds }
function wavInfo(buf) {
  if (!buf || buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('latin1', o, o + 4), sz = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    if (id === 'data') { data = Math.min(sz, buf.length - o - 8); break; }
    o += 8 + sz + (sz & 1);
  }
  if (!fmt || data == null) return null;
  const samples = data / (fmt.channels * fmt.bits / 8);
  return { ...fmt, samples, seconds: samples / fmt.rate };
}

const api = { PVER, ENGINE, ENGINE_KEEP, VOICES, unzipTree, buildArgs, paragraphs, oneLine, validVoiceJson, wavInfo, download: asr.download };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
