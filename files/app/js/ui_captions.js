'use strict';
/* التفريغ والترجمة — speech-to-text (whisper.cpp via the main process) + automatic captions for Shorts/Reels.
   Transcript lives on the sequence (s.transcript, sequence seconds) so it is saved/undone with the project.
   Captions are ordinary text clips (kind 'text', c.cap = 1) on their own top video track; word timings sit in
   c.text.words (clip-local) and app/js/text.js draws the karaoke highlight, so they render in exports too. */
(function () {
  const { $, esc, clamp } = GW; const UI = GW.UI;
  const api = () => window.gws;
  const hasAsr = () => !!(api() && api().asrRun);
  const CAP = GW.Captions = {};

  /* ================= caption styles ================= */
  const BASE = { weight: 900, font: 'Cairo', color: '#ffffff', stroke: 6, strokeColor: '#000000', shadow: 1, shadowColor: '#000000', shadowOp: 65, shadowBlur: 10, shadowDist: 4, shadowAng: 90, bg: 0, animIn: 'none', animOut: 'none', animDur: .12, kara: 'color', hiColor: '#ffd400', hiScale: 1.12, leading: 1.15 };
  const CA0 = { in: 'pop', out: 'none', inDur: .22, outDur: .14, ease: 'out', unit: 'block', stagger: .06, emMotion: 'scale', box: 'block', kw: 1, kwColor: '#4cc2ff' };
  // 22 presets (t = text fields, ca = animation). Cards in the panel preview them live; «تطبيق على كل الترجمات» restyles existing captions.
  CAP.STYLES = [
    { id: 'hormozi', n: 'شورت: أبيض + كلمة صفراء', t: { font: 'Cairo', weight: 900, stroke: 7, hiColor: '#ffd400', hiScale: 1.15, caps: 1 }, ca: { in: 'pop', emMotion: 'scale', kwColor: '#39ff88' } },
    { id: 'boldYellow', n: 'صندوق أصفر عريض', t: { font: 'Cairo', weight: 900, stroke: 0, shadow: 1, shadowOp: 80, kara: 'box', hiBg: '#ffd400', hiText: '#111111', hiScale: 1.06 }, ca: { in: 'bounce', emMotion: 'scale', kwColor: '#ffd400' } },
    { id: 'beast', n: 'حد سميك (أسلوب MrBeast)', t: { font: 'Lalezar', weight: 400, stroke: 11, shadow: 1, shadowDist: 7, shadowBlur: 0, shadowOp: 90, hiColor: '#7dff3a', hiScale: 1.2, caps: 1 }, ca: { in: 'bounce', inDur: .3, emMotion: 'bounce', kwColor: '#ff4d4d' }, size: 1.1 },
    { id: 'minimal', n: 'أبيض بسيط', t: { font: 'Tajawal', weight: 700, stroke: 0, shadow: 1, shadowOp: 55, shadowBlur: 14, shadowDist: 2, kara: 'none' }, ca: { in: 'fade', out: 'fade', inDur: .15, kw: 0 }, size: .85 },
    { id: 'docLower', n: 'وثائقي — ثلث سفلي', t: { font: 'IBM Plex Sans Arabic', weight: 600, stroke: 0, shadow: 0, bg: 1, bgColor: '#0b0f15', bgOp: 72, bgPad: 22, bgRad: 6, kara: 'none' }, ca: { in: 'fadeBlur', out: 'fade', inDur: .25, kw: 0, box: 'line' }, size: .62, pos: 'bottom', lines: 2 },
    { id: 'cinema', n: 'ترجمة سينمائية', t: { font: 'Tajawal', weight: 500, stroke: 0, shadow: 1, shadowOp: 85, shadowBlur: 6, shadowDist: 2, kara: 'none' }, ca: { in: 'fade', out: 'fade', inDur: .12, kw: 0 }, size: .58, pos: 'bottom', lines: 2 },
    { id: 'neon', n: 'نيون متوهج', t: { font: 'Lalezar', weight: 400, color: '#e8fff6', stroke: 0, shadow: 1, shadowColor: '#00ffc8', shadowOp: 70, shadowBlur: 18, shadowDist: 0, kara: 'glow', hiColor: '#39ff14', hiScale: 1.1 }, ca: { in: 'glitch', inDur: .3, emMotion: 'scale', kwColor: '#ff3df2' } },
    { id: 'boxKaraoke', n: 'كاريوكي بصندوق', t: { kara: 'box', hiBg: '#7c3aed', hiText: '#ffffff', stroke: 0, shadow: 1, shadowOp: 80, hiScale: 1.06 }, ca: { in: 'pop', emMotion: 'scale' } },
    { id: 'karaokeFill', n: 'كاريوكي (تعبئة)', t: { kara: 'fill', hiColor: '#22d3ee', hiScale: 1 }, ca: { in: 'fade', emMotion: 'none', kw: 0 } },
    { id: 'wordPop', n: 'كلمة بكلمة', t: { kara: 'color', hiColor: '#ffffff', hiScale: 1.18 }, ca: { in: 'words', inDur: .18, emMotion: 'scale', kwColor: '#ffd400' } },
    { id: 'typewriter', n: 'آلة كاتبة', t: { font: 'Changa', weight: 800, stroke: 5, kara: 'none' }, ca: { in: 'typewriter', kw: 1, kwColor: '#ffd400' } },
    { id: 'underline', n: 'خط تحت الكلمة', t: { font: 'Tajawal', weight: 800, stroke: 0, shadow: 1, shadowOp: 75, kara: 'underline', hiColor: '#ff6a2b', hiScale: 1 }, ca: { in: 'slideUp', unit: 'word', stagger: .05, emMotion: 'none', kwColor: '#ff8d5c' } },
    { id: 'redImpact', n: 'أحمر عريض (سقوط)', t: { font: 'Changa', weight: 800, stroke: 6, hiColor: '#ff3b3b', hiScale: 1.12 }, ca: { in: 'drop', inDur: .35, emMotion: 'scale', kwColor: '#ffb020' } },
    { id: 'elastic', n: 'مطاطي', t: { font: 'Cairo', weight: 900, stroke: 6, hiColor: '#ff8d5c', hiScale: 1.15 }, ca: { in: 'elastic', inDur: .45, emMotion: 'bounce' } },
    { id: 'glitch', n: 'جلتش', t: { font: 'Cairo', weight: 800, stroke: 0, shadow: 1, shadowOp: 90, shadowDist: 3, hiColor: '#00e5ff', hiScale: 1.08 }, ca: { in: 'glitch', out: 'glitch', inDur: .28, outDur: .16, emMotion: 'shake', kwColor: '#ff2d55' } },
    { id: 'news', n: 'صندوق أخبار', t: { font: 'Cairo', weight: 700, stroke: 0, shadow: 0, bg: 1, bgColor: '#0b2a5b', bgOp: 92, bgPad: 22, bgRad: 6, kara: 'none' }, ca: { in: 'wipe', out: 'fade', inDur: .25, kw: 1, kwColor: '#ffcf4a' }, size: .8 },
    { id: 'slideUp', n: 'انزلاق كلمة كلمة', t: { font: 'Cairo', weight: 900, stroke: 6, hiColor: '#ffd400' }, ca: { in: 'slideUp', unit: 'word', stagger: .07, inDur: .25, emMotion: 'scale' } },
    { id: 'blurIn', n: 'ضبابية ناعمة', t: { font: 'IBM Plex Sans Arabic', weight: 700, stroke: 0, shadow: 1, shadowOp: 60, shadowBlur: 16, kara: 'color', hiColor: '#ffe9a8', hiScale: 1 }, ca: { in: 'fadeBlur', out: 'fadeBlur', inDur: .3, emMotion: 'none', kw: 0 } },
    { id: 'shake', n: 'تمييز مهتز', t: { font: 'Changa', weight: 800, stroke: 6, hiColor: '#ff3b3b', hiScale: 1.1 }, ca: { in: 'pop', emMotion: 'shake', kwColor: '#ffd400' } },
    { id: 'gold', n: 'ذهبي وثائقي', t: { font: 'Amiri', weight: 700, stroke: 0, shadow: 1, shadowOp: 85, shadowBlur: 12, color: '#f6efe0', kara: 'color', hiColor: '#e9c35a', hiScale: 1 }, ca: { in: 'fade', out: 'fade', inDur: .3, emMotion: 'none', kw: 0 }, size: .8 },
    { id: 'podcast', n: 'بودكاست (صندوق لكل سطر)', t: { font: 'Tajawal', weight: 800, stroke: 0, shadow: 0, bg: 1, bgColor: '#000000', bgOp: 82, bgPad: 18, bgRad: 10, kara: 'color', hiColor: '#ffd400', hiScale: 1 }, ca: { in: 'pop', box: 'line', emMotion: 'none' }, size: .85 },
    { id: 'tiktok', n: 'تيك توك — تمييز أصفر', t: {}, ca: { in: 'pop', emMotion: 'scale' } }
  ];
  const ALIAS = { white: 'minimal', karaoke: 'karaokeFill', reveal: 'wordPop', boxhi: 'boxKaraoke', red: 'redImpact' };
  CAP.preset = (id) => CAP.STYLES.find(x => x.id === (ALIAS[id] || id)) || CAP.STYLES.find(x => x.id === 'tiktok');
  CAP.POS = [['top', 'أعلى', .18], ['center', 'الوسط', .5], ['lower', 'الثلث السفلي', .7], ['bottom', 'أسفل', .86]];
  const vertical = (s) => s.h > s.w;
  const OPT_KEY = 'gws.captions.opts';
  // layout options + optional style overrides ('' = as in the preset)
  const OVR = ['animIn', 'animOut', 'inDur', 'outDur', 'ease', 'unit', 'stagger', 'emph', 'emMotion', 'hiColor', 'hiScale', 'kw', 'kwColor', 'color', 'weight', 'stroke', 'strokeColor', 'shadow', 'box', 'bgColor', 'bgOp', 'bgRad', 'bgPad', 'leading'];
  const defOpts = (s) => Object.assign({ style: 'hormozi', maxWords: vertical(s) ? 3 : 7, lines: vertical(s) ? 1 : 2, perLine: 0, pos: vertical(s) ? 'lower' : 'bottom', size: 100, font: '', upper: 0, safe: 1, emoji: 0 }, Object.fromEntries(OVR.map(k => [k, ''])));
  let opts = null;
  function getOpts() { const s = GW.seq(); if (!opts) { opts = defOpts(s); try { Object.assign(opts, JSON.parse(localStorage.getItem(OPT_KEY) || '{}')); } catch (e) {} } return opts; }
  function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch (e) {} }
  CAP.getOpts = getOpts; CAP.saveOpts = saveOpts; CAP.OVR = OVR;
  const set = (v) => v !== '' && v != null;
  CAP.styleText = (s, o) => {
    const st = CAP.preset(o.style);
    const t = Object.assign(GW.defaultText(), BASE, GW.clone(st.t));
    t.ca = Object.assign({}, CA0, GW.clone(st.ca || {}));
    const ov = (k, f) => { if (set(o[k])) f(o[k]); };
    ov('animIn', v => t.ca.in = v); ov('animOut', v => t.ca.out = v); ov('inDur', v => t.ca.inDur = +v); ov('outDur', v => t.ca.outDur = +v); ov('ease', v => t.ca.ease = v); ov('unit', v => t.ca.unit = v); ov('stagger', v => t.ca.stagger = +v);
    ov('emph', v => t.kara = v); ov('emMotion', v => t.ca.emMotion = v); ov('hiColor', v => { t.hiColor = v; if (t.kara === 'box') t.hiBg = v; }); ov('hiScale', v => t.hiScale = +v); ov('kw', v => t.ca.kw = +v); ov('kwColor', v => t.ca.kwColor = v);
    ov('color', v => t.color = v); ov('weight', v => t.weight = +v); ov('strokeColor', v => t.strokeColor = v); ov('shadow', v => t.shadow = +v); ov('leading', v => t.leading = +v);
    ov('box', v => { if (v === 'none') t.bg = 0; else { t.bg = 1; t.ca.box = v; if (!st.t.bg) { t.bgColor = '#000000'; t.bgOp = 75; t.bgPad = 18; t.bgRad = 10; } } });
    ov('bgColor', v => t.bgColor = v); ov('bgOp', v => t.bgOp = +v); ov('bgRad', v => t.bgRad = +v); ov('bgPad', v => t.bgPad = +v);
    t.size = Math.round(Math.min(s.w, s.h) * .085 * (st.size || 1) * (o.size || 100) / 100);
    const sw = set(o.stroke) ? +o.stroke : t.stroke; t.stroke = sw ? Math.max(1, Math.round(sw * t.size / 92 * 10) / 10) : 0; t.bgPad = Math.round((t.bgPad || 0) * t.size / 92); t.bgRad = Math.round((t.bgRad || 0) * t.size / 92);
    if (o.font) t.font = o.font; if (o.upper) t.caps = 1;
    t.animIn = 'none'; t.animOut = 'none'; // legacy title anims are replaced by t.ca
    return t;
  };
  // vertical position of the caption block: preset (or chosen) slot, kept inside the safe area (Shorts UI at the bottom / top)
  CAP.posY = (s, o) => { const st = CAP.preset(o.style); const key = o.pos || st.pos || 'lower'; let y = (CAP.POS.find(p => p[0] === key) || CAP.POS[2])[2]; if (o.safe !== 0 && vertical(s)) y = clamp(y, .14, .78); return y; };

  /* ================= time / SRT helpers ================= */
  const p2 = (n, w = 2) => String(n).padStart(w, '0');
  CAP.fmtTime = (t, sep = ',') => { t = Math.max(0, t); const ms = Math.round(t * 1000); return p2(Math.floor(ms / 3600000)) + ':' + p2(Math.floor(ms / 60000) % 60) + ':' + p2(Math.floor(ms / 1000) % 60) + sep + p2(ms % 1000, 3); };
  const fmtShort = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return (m >= 60 ? Math.floor(m / 60) + ':' + p2(m % 60) : m) + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  const parseTs = (s) => { const m = /(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?/.exec(s); if (!m) return null; return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +('0.' + m[4]) : 0); };
  CAP.parseSRT = (txt) => { // also reads WebVTT
    const out = []; const blocks = String(txt || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    for (const b of blocks) {
      const lines = b.split('\n').filter(l => l.trim() !== ''); const i = lines.findIndex(l => l.includes('-->')); if (i < 0) continue;
      const [a, z] = lines[i].split('-->'); const t0 = parseTs(a), t1 = parseTs(z); if (t0 == null || t1 == null) continue;
      const text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
      if (text) out.push({ id: GW.uid(), t0, t1: Math.max(t1, t0 + .05), text, words: [] });
    }
    return out.sort((a, b) => a.t0 - b.t0);
  };
  CAP.toSRT = (segs) => segs.map((g, i) => `${i + 1}\n${CAP.fmtTime(g.t0)} --> ${CAP.fmtTime(g.t1)}\n${String(g.text).trim()}\n`).join('\n');
  CAP.toVTT = (segs) => 'WEBVTT\n\n' + segs.map((g, i) => `${i + 1}\n${CAP.fmtTime(g.t0, '.')} --> ${CAP.fmtTime(g.t1, '.')}\n${String(g.text).trim()}\n`).join('\n');

  /* ================= transcript model ================= */
  CAP.transcript = (s) => (s || GW.seq()).transcript || null;
  CAP.setTranscript = (segs, meta, s) => {
    s = s || GW.seq();
    s.transcript = Object.assign({ v: 1, lang: '', model: '', at: Date.now() }, meta || {}, { segs: segs.map(g => ({ id: g.id || GW.uid(), t0: +(+g.t0).toFixed(3), t1: +(+g.t1).toFixed(3), text: String(g.text || '').trim(), words: (g.words || []).map(w => ({ w: w.w, t0: +(+w.t0).toFixed(3), t1: +(+w.t1).toFixed(3), p: w.p != null ? +w.p : undefined })) })).filter(g => g.text) });
    return s.transcript;
  };
  // words that match the (possibly edited) segment text; keeps whisper timings when the word count still matches
  CAP.alignWords = (g) => {
    const toks = String(g.text).split(/\s+/).filter(Boolean); const ws = g.words || [];
    if (ws.length === toks.length && ws.length) return toks.map((w, i) => ({ w, t0: ws[i].t0, t1: ws[i].t1 }));
    const tot = toks.reduce((a, w) => a + w.length + 1, 0) || 1; const d = Math.max(.05, g.t1 - g.t0); let acc = 0;
    return toks.map(w => { const a = g.t0 + d * acc / tot; acc += w.length + 1; return { w, t0: a, t1: g.t0 + d * acc / tot }; });
  };
  CAP.merge = (segs, i) => { const a = segs[i], b = segs[i + 1]; if (!a || !b) return false; a.words = [...CAP.alignWords(a), ...CAP.alignWords(b)]; a.t1 = b.t1; a.text = a.words.map(w => w.w).join(' '); segs.splice(i + 1, 1); return true; };
  CAP.split = (segs, i, charPos) => {
    const g = segs[i]; if (!g) return false; const txt = g.text; let pos = charPos == null ? Math.floor(txt.length / 2) : charPos;
    const before = txt.slice(0, pos); const sp = before.lastIndexOf(' '), sp2 = txt.indexOf(' ', pos);
    pos = (pos - sp <= (sp2 < 0 ? 1e9 : sp2 - pos) && sp > 0) ? sp : sp2 > 0 ? sp2 : sp; if (pos <= 0 || pos >= txt.length) return false;
    const n1 = txt.slice(0, pos).split(/\s+/).filter(Boolean).length; const ws = CAP.alignWords(g); if (n1 <= 0 || n1 >= ws.length) return false;
    const w1 = ws.slice(0, n1), w2 = ws.slice(n1); const cut = w2[0].t0;
    segs.splice(i, 1, { id: GW.uid(), t0: g.t0, t1: Math.max(g.t0 + .05, Math.min(cut, w1[w1.length - 1].t1 + .02)), text: w1.map(w => w.w).join(' '), words: w1 }, { id: GW.uid(), t0: cut, t1: g.t1, text: w2.map(w => w.w).join(' '), words: w2 });
    return true;
  };

  /* ================= captions (phrases → text clips) ================= */
  const ENDP = /[.!?؟…]$|[،,;؛:]$/;
  // group words into caption chunks: ≤ maxWords, break at pauses / punctuation / too wide for the frame
  CAP.chunks = (segs, o, s) => {
    s = s || GW.seq(); const st = CAP.styleText(s, o); const maxW = s.w * (vertical(s) ? .86 : .8); const lines = clamp(o.lines || 1, 1, 3);
    const tooWide = (ws) => { if (ws.length < 2) return false; const txt = layout(ws.map(w => w.w), lines, o.perLine); const m = GW.TextR.measure(Object.assign({}, st, { str: txt }), 1); return m.w > maxW; };
    const out = []; let cur = [];
    const flush = () => { if (cur.length) out.push(cur); cur = []; };
    for (const g of segs) {
      const ws = CAP.alignWords(g);
      for (const w of ws) {
        const last = cur[cur.length - 1];
        if (last && (w.t0 - last.t1 > .7 || cur.length >= o.maxWords || tooWide([...cur, w]))) flush();
        cur.push(w);
        if (ENDP.test(w.w) && cur.length >= Math.min(2, o.maxWords)) flush();
      }
      flush(); // never let a caption span two segments
    }
    return out;
  };
  // split words into n balanced lines (by characters)
  function layout(words, n, perLine) {
    if (perLine > 0 && words.length > perLine) { const out = []; for (let i = 0; i < words.length; i += perLine) out.push(words.slice(i, i + perLine).join(' ')); return out.join('\n'); }
    if (n <= 1 || words.length < 2) return words.join(' ');
    n = Math.min(n, words.length); const tot = words.join(' ').length; const lines = []; let cur = [];
    for (const w of words) { cur.push(w); const left = n - lines.length - 1; if (left > 0 && cur.join(' ').length >= tot / n && words.length - (lines.flat().length + cur.length) >= left) { lines.push(cur); cur = []; } }
    if (cur.length) lines.push(cur);
    return lines.map(l => l.join(' ')).join('\n');
  }
  CAP.layout = layout;
  CAP.captionClips = (s) => (s || GW.seq()).clips.filter(c => c.cap === 1 && c.kind === 'text');
  function captionTrack(s) {
    const used = new Set(CAP.captionClips(s).map(c => c.ti));
    if (used.size === 1) { const ti = [...used][0]; if (!s.clips.some(c => c.ti === ti && c.tt === 'v' && c.cap !== 1)) return ti; }
    GW.ops.ensureTrack(s, 'v', s.vt.length); const ti = s.vt.length - 1; s.vt[ti].name = 'ترجمة'; return ti;
  }
  CAP.create = (o, s) => {
    s = s || GW.seq(); o = Object.assign({}, getOpts(), o || {}); const tr = CAP.transcript(s);
    if (!tr || !tr.segs.length) { GW.toast('لا يوجد تفريغ بعد — ابدأ التفريغ أو استورد ملف SRT'); return []; }
    const old = CAP.captionClips(s); const ti = old.length ? captionTrack(s) : null;
    old.forEach(c => GW.ops.remove(s, c));
    const track = ti != null ? ti : captionTrack(s);
    const st = CAP.styleText(s, o); const pos = CAP.posY(s, o); const kwOn = o.keywords !== false && o.keywords !== 0;
    const fps = s.fps || 30; const snap = t => Math.round(t * fps) / fps;
    const ch = CAP.chunks(tr.segs, o, s); const made = [];
    ch.forEach((ws, i) => {
      const next = ch[i + 1]; let a = snap(ws[0].t0); let b = ws[ws.length - 1].t1;
      b = next && next[0].t0 - b < .8 ? next[0].t0 : b + .25; b = snap(Math.max(b, a + Math.max(.3, 2 / fps)));
      if (made.length) { const p = made[made.length - 1]; if (p.start + p.dur > a) p.dur = Math.max(1 / fps, a - p.start); }
      let wl = ws.map(w => ({ w: w.w, s: +Math.max(0, w.t0 - a).toFixed(3), e: +Math.max(0, w.t1 - a).toFixed(3) }));
      if (kwOn && GW.CapAnim) { const K = GW.CapAnim.keywords(wl.map(w => w.w)); wl.forEach((w, j) => { if (K.has(j)) w.k = 1; }); }
      if (o.emoji && GW.CapAnim) { const em = GW.CapAnim.emojiFor(wl.map(w => w.w).join(' ')); if (em) { const l = wl[wl.length - 1]; wl.push({ w: em, s: l.s, e: l.e }); } }
      const str = layout(wl.map(w => w.w), o.lines, o.perLine);
      const c = GW.newClip('text', { ti: track, start: a, dur: b - a, name: str.replace(/\n/g, ' ').slice(0, 40), label: '#d6c04a' });
      Object.assign(c.text, GW.clone(st), { str, words: wl });
      c.motion.pos = GW.P([Math.round(s.w / 2), Math.round(s.h * pos)]); c.cap = 1;
      s.clips.push(c); made.push(c);
    });
    GW.sel.clips.clear(); GW.commit('إنشاء الترجمة'); GW.bus.emit('selection'); GW.invalidate(); if (GW.TL) GW.TL.invalidate();
    GW.toast('تم إنشاء ' + made.length + ' مقطع ترجمة على المسار ' + (s.vt[track] ? s.vt[track].name : ''));
    return made;
  };
  CAP.restyle = (o, s) => { // apply the current style / position to existing caption clips, keeping their text & timing
    s = s || GW.seq(); o = Object.assign({}, getOpts(), o || {}); const st = CAP.styleText(s, o); const pos = CAP.posY(s, o);
    const cs = CAP.captionClips(s); for (const c of cs) { const keep = { str: c.text.str, words: c.text.words };
      if (o.keywords != null && GW.CapAnim && keep.words) { const K = o.keywords ? GW.CapAnim.keywords(keep.words.map(w => w.w)) : new Set(); keep.words = keep.words.map((w, j) => { const n = Object.assign({}, w); if (K.has(j)) n.k = 1; else delete n.k; return n; }); } c.text = Object.assign(GW.clone(st), keep); c.motion.pos = GW.P([Math.round(s.w / 2), Math.round(s.h * pos)]); GW.TextR.drop(c.id); }
    if (cs.length) { GW.commit('نمط الترجمة'); GW.invalidate(); } return cs.length;
  };
  CAP.fromClips = (s) => CAP.captionClips(s).sort((a, b) => a.start - b.start).map(c => ({ t0: c.start, t1: c.start + c.dur, text: c.text.str.replace(/\n/g, ' ') }));

  /* ================= audio sources ================= */
  const DTW_OK = { 'large-v3-turbo': 1, 'large-v3-turbo-q5_0': 1, small: 1, base: 1 };
  async function paths() { return GW.rt.paths || (GW.rt.paths = await api().paths()); }
  // [{input, ss, dur, map(t)->seq t, t0, t1}] for the chosen source
  CAP.sources = async (src, s) => {
    s = s || GW.seq(); const p = await paths(); const out = [];
    if (src === 'sel') {
      const picked = new Map();
      for (const id of GW.sel.clips) {
        const c = GW.clipById(id, s); if (!c) continue;
        let a = c.tt === 'a' ? c : GW.linked(s, c).find(x => x.tt === 'a') || (c.media && GW.media(c.media) && GW.media(c.media).hasAudio ? c : null);
        if (!a || !a.media || picked.has(a.link || a.id)) continue; picked.set(a.link || a.id, a);
      }
      for (const c of [...picked.values()].sort((x, y) => x.start - y.start)) {
        const m = GW.media(c.media); if (!m || m.offline || !m.path) continue;
        const wav = p.cache + p.sep + m.id + '.wav'; const input = (await api().exists(wav)) ? wav : (m.proxy || m.path); const sp = c.speed || 1;
        out.push({ input, ss: c.in, dur: c.dur * sp, map: t => c.start + t / sp, t0: c.start, t1: c.start + c.dur, name: c.name });
      }
      return out;
    }
    const t0 = s.inP != null ? s.inP : 0, t1 = s.outP != null ? s.outP : GW.seqDur(s);
    if (!(t1 > t0) || !GW.Audio.hasAudio(s)) return out;
    const ab = await GW.Audio.mixdown(s, t0, t1, 16000);
    const file = p.cache + p.sep + 'asr_mix_' + GW.uid() + '.wav'; await api().writeBin(file, monoWav(ab));
    out.push({ input: file, ss: 0, dur: 0, map: t => t0 + t, t0, t1, temp: file, name: s.name });
    return out;
  };
  function monoWav(ab) { // 16-bit mono WAV (whisper wants 16 kHz mono)
    const rate = ab.sampleRate, n = ab.length; const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true);
    const L = ab.getChannelData(0), R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L;
    for (let i = 0, o = 44; i < n; i++, o += 2) { const a = Math.max(-1, Math.min(1, (L[i] + R[i]) / 2)); v.setInt16(o, a < 0 ? a * 0x8000 : a * 0x7fff, true); }
    return buf;
  }
  CAP.monoWav = monoWav;
  // map whisper result (source seconds) into sequence time, dropping text outside the clip window
  CAP.mapResult = (res, srcI) => {
    const segs = [];
    for (const g of (res && res.segments) || []) {
      const t0 = srcI.map(g.t0), t1 = Math.min(srcI.map(g.t1), srcI.t1); if (t0 >= srcI.t1 - .05 || t1 <= srcI.t0) continue;
      const words = (g.words || []).map(w => ({ w: w.w, t0: srcI.map(w.t0), t1: Math.min(srcI.map(w.t1), srcI.t1), p: w.p })).filter(w => w.t0 < srcI.t1);
      segs.push({ id: GW.uid(), t0: Math.max(t0, srcI.t0), t1, text: g.text, words });
    }
    return segs;
  };

  /* ================= running whisper ================= */
  const R = CAP.run = { busy: false, jobId: null, pct: 0, phase: '', live: [], status: null, dl: {} };
  let listening = false; const listen = () => { if (!listening && window.gws && gws.onAsrProgress) { listening = true; gws.onAsrProgress(onProgress); } };
  listen(); CAP._onProgress = onProgress;
  function onProgress(p) {
    if (p.kind === 'download') { R.dl[p.target + ':' + p.id] = p; if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') { delete R.dl[p.target + ':' + p.id]; refreshStatus(); if (p.phase === 'error') GW.toast('فشل التنزيل: ' + p.error, 'err'); } renderDl(); return; }
    if (p.kind !== 'run' || p.id !== R.jobId) return;
    if (p.phase) R.phase = p.phase; if (p.backend) R.backend = p.backend;
    if (p.pct != null) R.pct = p.pct;
    if (p.phase === 'fallback') GW.toast('تعذّر التشغيل على كرت الشاشة — المتابعة على المعالج', 'err');
    if (p.segs) { const cur = R.cur; for (const g of p.segs) R.live.push({ t0: cur ? cur.map(g.t0) : g.t0, text: g.text }); renderLive(); }
    renderProgress();
  }
  async function refreshStatus() { listen(); if (!hasAsr()) return null; try { R.status = await api().asrStatus(); } catch (e) { R.status = null; } renderHead(); return R.status; }
  CAP.refreshStatus = refreshStatus;
  CAP.download = async (kind, id) => { if (!hasAsr()) return { ok: false }; R.dl[kind + ':' + id] = { phase: 'download', got: 0, total: 0 }; renderDl(); const r = await api().asrDownload(kind, id); delete R.dl[kind + ':' + id]; await refreshStatus(); renderDl(); return r; };
  const errText = (e) => ({ 'model-missing': 'النموذج غير منزّل بعد.', 'engine-missing': 'محرك التفريغ غير موجود.', 'missing-dll': 'ملفات تشغيل ناقصة (Microsoft Visual C++ Runtime أو مكتبات CUDA). ثبّت «Visual C++ Redistributable x64» من موقع مايكروسوفت ثم أعد المحاولة.', 'illegal-instruction': 'المعالج لا يدعم هذه النسخة من المحرك.' }[e] || e);

  // opts: { src:'sel'|'seq', lang:'ar'|'en'|'auto', model, translate, dtw, device }
  UI.transcribe = async (o = {}) => {
    if (!GW.isShown('captions')) GW.showPanel('captions');
    if (!hasAsr()) { GW.toast('التفريغ متاح في نسخة سطح المكتب', 'err'); return null; }
    if (R.busy) { GW.toast('هناك عملية تفريغ جارية'); return null; }
    const s = GW.seq(); const O = Object.assign({}, getRunOpts(), o); Object.assign(runOpts, o); saveRun();
    const st = R.status || await refreshStatus();
    if (st && !st.engines.cpu.installed && !st.engines.cuda.installed) {
      if (!st.engines.cpu.downloadable) { GW.toast('محرك التفريغ غير موجود', 'err'); return null; }
      if (!(await GW.ask('محرك التفريغ', 'محرك whisper.cpp غير موجود في هذا التثبيت. هل تريد تنزيله الآن (حوالي 8 ميغابايت)؟', 'تنزيل'))) return null;
      const r = await CAP.download('engine', 'cpu'); if (!r.ok) return null;
    }
    const mi = st && st.models.find(m => m.id === O.model);
    if (st && (!mi || !mi.installed)) {
      const m = mi || st.models[0]; if (!m) return null;
      if (!(await GW.ask('تنزيل النموذج', `نموذج «${m.n}» غير منزّل (≈ ${fmtMB(m.mb * 1048576)}). يتم تنزيله مرة واحدة فقط من Hugging Face. هل تريد المتابعة؟`, 'تنزيل'))) return null;
      const r = await CAP.download('model', m.id); if (!r.ok) { if (!r.cancelled) GW.toast('تعذر تنزيل النموذج: ' + (r.error || ''), 'err'); return null; }
    }
    if (O.src === 'sel' && !GW.sel.clips.size) O.src = 'seq';
    R.busy = true; R.pct = 0; R.phase = 'prepare'; R.live = []; R.cancelled = false; renderProgress(); renderLive();
    const all = []; let srcs = [], info = null;
    try {
      srcs = await CAP.sources(O.src, s);
      if (!srcs.length) { GW.toast(O.src === 'sel' ? 'المقاطع المحددة لا تحتوي على صوت' : 'لا يوجد صوت في التسلسل', 'err'); return null; }
      for (let i = 0; i < srcs.length; i++) {
        if (R.cancelled) break;
        const sI = srcs[i]; R.cur = sI; R.part = [i, srcs.length]; R.jobId = 'cap' + GW.uid();
        const r = await api().asrRun({ id: R.jobId, input: sI.input, ss: sI.ss, dur: sI.dur, model: O.model, lang: O.lang, translate: !!O.translate, dtw: O.dtw !== 0 && !!DTW_OK[O.model], device: O.device });
        if (r.cancelled || R.cancelled) { R.cancelled = true; break; }
        if (!r.ok) { GW.toast('فشل التفريغ: ' + errText(r.error), 'err'); console.warn('asr', r); info = r; break; }
        info = r; all.push(...CAP.mapResult(r.result, sI));
      }
    } finally {
      for (const x of srcs) if (x.temp) api().remove(x.temp);
      R.busy = false; R.jobId = null; R.cur = null; R.phase = ''; renderProgress();
    }
    if (R.cancelled) { GW.toast('أُلغي التفريغ'); renderLive(); return null; }
    if (!info || !info.ok) { renderLive(); return null; }
    all.sort((a, b) => a.t0 - b.t0);
    // merge into an existing transcript when transcribing a selection; replace when the whole sequence was used
    let segs = all; const prev = CAP.transcript(s);
    if (prev && O.src === 'sel') { const lo = Math.min(...srcs.map(x => x.t0)), hi = Math.max(...srcs.map(x => x.t1)); segs = [...prev.segs.filter(g => g.t1 <= lo || g.t0 >= hi), ...all].sort((a, b) => a.t0 - b.t0); }
    CAP.setTranscript(segs, { lang: (info.result && info.result.lang) || O.lang, model: O.model, translate: O.translate ? 1 : 0, backend: info.backend });
    GW.commit('تفريغ الصوت'); R.live = []; renderBody();
    GW.toast(`اكتمل التفريغ: ${all.length} مقطع نصي — ${info.backend === 'cuda' ? 'كرت الشاشة' : 'المعالج'} · ${Math.round(info.secs || 0)} ث`);
    return CAP.transcript(s);
  };
  CAP.cancel = () => { if (!R.busy) return; R.cancelled = true; if (R.jobId) api().asrCancel(R.jobId); };

  /* ================= panel ================= */
  const RUN_KEY = 'gws.captions.run';
  const runOpts = (() => { const o = { src: 'sel', lang: 'ar', model: 'large-v3-turbo', translate: 0, dtw: 1, device: 'auto' }; try { Object.assign(o, JSON.parse(localStorage.getItem(RUN_KEY) || '{}')); } catch (e) {} return o; })();
  const getRunOpts = () => runOpts; const saveRun = () => { try { localStorage.setItem(RUN_KEY, JSON.stringify(runOpts)); } catch (e) {} };
  const fmtMB = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : Math.round(b / 1048576) + ' MB';
  let P = null, editing = false, styleOpen = false;
  const css = `
  .cap-p{display:flex;flex-direction:column;height:100%;min-height:0}
  .cap-p .form{display:flex;flex-direction:column;gap:6px;padding:8px}
  .cap-p .cap-run{display:flex;gap:6px;align-items:center}
  .cap-p .cap-run .prog{flex:1}
  .cap-p .cap-st{color:var(--text2);font-size:11px;min-height:15px}
  .cap-p .cap-st b{color:var(--text)}
  .cap-list{display:flex;flex-direction:column}
  .cap-seg{display:grid;grid-template-columns:74px minmax(0,1fr) auto;gap:6px;align-items:start;padding:5px 8px;border-bottom:1px solid var(--line)}
  .cap-seg.on{background:rgba(255,106,43,.10);box-shadow:inset 2px 0 0 var(--accent,#ff6a2b)}
  .cap-seg .tm{font:11px var(--f-mono);color:var(--text2);direction:ltr;text-align:left;cursor:pointer;line-height:1.5;padding-top:3px}
  .cap-seg .tm:hover{color:#fff}.cap-seg .tm i{display:block;color:var(--mute);font-style:normal}
  .cap-seg textarea{width:100%;resize:none;min-height:24px;background:transparent;border:1px solid transparent;border-radius:3px;padding:2px 4px;line-height:1.5;overflow:hidden;field-sizing:content}
  .cap-seg textarea:hover{border-color:var(--line2)}.cap-seg textarea:focus{border-color:var(--blue);background:var(--bg2);outline:0}
  .cap-seg .ops{display:flex;gap:2px;opacity:.35}.cap-seg:hover .ops{opacity:1}
  .cap-seg .ops button{min-width:22px;height:22px;font-size:10.5px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;background:none;color:var(--text2);cursor:pointer;border-radius:3px}.cap-seg .ops button:hover{background:var(--bg4);color:#fff}
  .cap-seg .low{background:linear-gradient(transparent 70%,rgba(229,72,77,.35) 70%)}
  .cap-live{padding:4px 10px;color:var(--mute);font-size:11.5px;border-bottom:1px dashed var(--line)}
  .cap-styles{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px}
  .cap-sty{border:1px solid var(--line2);border-radius:5px;overflow:hidden;cursor:pointer;background:#0b0b0b}
  .cap-sty canvas{display:block;width:100%;height:auto}
  .cap-sty div{font-size:10.5px;padding:2px 5px;color:var(--text2);background:var(--bg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cap-sty.on{border-color:var(--accent,#ff6a2b);box-shadow:0 0 0 1px var(--accent,#ff6a2b)}
  .cap-sty.on div{color:#fff;background:var(--bg4)}
  .cap-sub{border-bottom:0;border-top:1px solid var(--line)}.cap-sub>summary{padding:5px 2px;font-weight:600;font-size:var(--fs1)}
  .cap-p .hint{color:var(--mute);font-size:var(--fs0);line-height:1.7}
  .cap-tag{font-size:10px;color:var(--accent,#ff6a2b);border:1px solid currentColor;border-radius:3px;padding:0 4px;margin-inline-start:4px}
  .cap-acts{display:flex;flex-wrap:wrap;gap:4px}
  .cap-det{border-bottom:1px solid var(--line)}
  .cap-det>summary{cursor:pointer;padding:6px 8px;font-weight:700;color:var(--text);list-style-position:inside}
  .cap-det:not([open])>summary{color:var(--text2)}
  .cap-m{display:flex;flex-direction:column;gap:6px}
  .cap-m .row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 8px;border:1px solid var(--line2);border-radius:5px}
  .cap-m .row small{color:var(--mute);display:block}
  .cap-m .row .pbar{width:100%}
  `;
  GW.registerPanel('captions', 'التفريغ والترجمة', (el) => {
    P = el; el.classList.add('cap-p'); el.dir = 'rtl';
    const st = document.createElement('style'); st.textContent = css; document.head.append(st);
    el.innerHTML = '<div data-a="head"></div><div class="pscroll" data-a="body"></div>';
    renderHead(); renderBody(); refreshStatus();
  });
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function btn(label, on, cls, title) { const b = el('button', 'btn sm ' + (cls || ''), esc(label)); b.onclick = on; if (title) b.title = title; return b; }
  function renderHead() {
    if (!P) return; const h = P.querySelector('[data-a=head]'); if (!h) return; h.innerHTML = '';
    const F = UI.form; const f = el('div', 'form'); f.style.borderBottom = '1px solid var(--line)';
    const o = runOpts; const st = R.status;
    f.append(F.frow('المصدر', F.segIn([['sel', 'المقاطع المحددة'], ['seq', 'التسلسل كاملًا']], o.src, v => { o.src = v; saveRun(); })));
    f.append(F.frow('اللغة', F.selectIn([['ar', 'العربية'], ['en', 'الإنجليزية'], ['auto', 'اكتشاف تلقائي']], o.lang, v => { o.lang = v; saveRun(); })));
    const models = st ? st.models : [{ id: 'large-v3-turbo', n: 'Large v3 Turbo', mb: 1549 }, { id: 'large-v3-turbo-q5_0', n: 'Large v3 Turbo q5', mb: 547 }, { id: 'small', n: 'Small', mb: 466 }, { id: 'base', n: 'Base', mb: 142 }];
    const ms = F.selectIn(models.map(m => [m.id, m.n + (m.installed ? '' : ' — غير منزّل · ' + fmtMB((m.mb || 0) * 1048576))]), o.model, v => { o.model = v; saveRun(); });
    const mb = btn('النماذج…', () => modelsDialog(), '', 'تنزيل وإدارة نماذج التعرف على الكلام');
    f.append(F.frow('النموذج', [ms, mb]));
    const dev = [['auto', 'تلقائي'], ['cuda', 'كرت NVIDIA (CUDA)'], ['cpu', 'المعالج فقط']];
    f.append(F.frow('المعالجة', F.selectIn(dev, o.device, v => { o.device = v; saveRun(); })));
    const opt = el('div', 'ctl'); const tr = F.checkIn(o.translate, v => { o.translate = v; saveRun(); }); const l1 = el('label', '', ''); l1.append(tr, ' ترجمة إلى الإنجليزية');
    const dt = F.checkIn(o.dtw, v => { o.dtw = v; saveRun(); }); const l2 = el('label', '', ''); l2.append(dt, ' توقيت دقيق للكلمات'); l2.title = 'محاذاة زمنية دقيقة لكل كلمة (DTW) — مهمة لتمييز الكلمات في الشورتات';
    opt.append(l1, l2); opt.style.gap = '12px'; f.append(F.frowEl('خيارات', opt));
    const run = el('div', 'cap-run');
    const go = btn(R.busy ? 'إلغاء' : 'بدء التفريغ', () => R.busy ? CAP.cancel() : UI.transcribe(), R.busy ? '' : 'pri'); go.dataset.a = 'go';
    const pr = el('div', 'prog', '<i></i>'); pr.dataset.a = 'prog'; run.append(go, pr); f.append(run);
    const stl = el('div', 'cap-st'); stl.dataset.a = 'st'; f.append(stl);
    h.append(f); renderProgress();
  }
  function statusLine() {
    const st = R.status; if (!hasAsr()) return 'التفريغ يتطلب نسخة سطح المكتب.';
    if (R.busy) {
      const ph = { prepare: 'تجهيز الصوت…', transcribe: 'جارٍ التفريغ', fallback: 'إعادة المحاولة على المعالج…' }[R.phase] || '…';
      return `<b>${ph}</b> ${R.phase === 'transcribe' ? Math.round(R.pct) + '%' : ''} ${R.backend ? '· ' + (R.backend === 'cuda' ? 'كرت الشاشة' : 'المعالج') : ''} ${R.part && R.part[1] > 1 ? '· مقطع ' + (R.part[0] + 1) + '/' + R.part[1] : ''}`;
    }
    if (!st) return '';
    const g = st.gpu || {}; const cu = st.engines.cuda;
    let s = g.nvidia ? `كرت الشاشة: <b>${esc(g.name || 'NVIDIA')}</b>${g.vram ? ' · ' + Math.round(g.vram / 1024) + ' GB' : ''} — ` : 'لا يوجد كرت NVIDIA — ';
    s += cu.installed ? (st.cudaBad ? 'تعذر تشغيل CUDA، سيُستخدم المعالج' : 'تسريع CUDA مفعّل') : (g.nvidia ? 'تسريع CUDA غير منزّل (من «النماذج…»)' : 'سيُستخدم المعالج');
    if (g.nvidia && g.driver && !g.driverOk) s += ' · حدّث تعريف NVIDIA (الإصدار 551.61 أو أحدث)';
    return s;
  }
  function renderProgress() {
    if (!P) return; const pr = P.querySelector('[data-a=prog] i'); const st = P.querySelector('[data-a=st]'); const go = P.querySelector('[data-a=go]');
    if (pr) { const tot = R.part ? ((R.part[0] + (R.phase === 'transcribe' ? R.pct / 100 : 0)) / R.part[1]) * 100 : R.pct; pr.style.width = (R.busy ? Math.max(2, tot) : 0) + '%'; pr.parentElement.style.visibility = R.busy ? 'visible' : 'hidden'; }
    if (st) st.innerHTML = statusLine();
    if (go) { go.textContent = R.busy ? 'إلغاء' : 'بدء التفريغ'; go.classList.toggle('pri', !R.busy); }
  }
  function renderLive() {
    if (!P) return; const b = P.querySelector('[data-a=live]'); if (!b) { renderBody(); return; }
    b.innerHTML = R.live.slice(-6).map(g => `<div class="cap-live"><span style="font-family:var(--f-mono);direction:ltr;display:inline-block">${fmtShort(g.t0)}</span> ${esc(g.text)}</div>`).join('');
  }
  function renderBody() {
    if (!P) return; const body = P.querySelector('[data-a=body]'); if (!body) return;
    const s = GW.seq(); const tr = CAP.transcript(s); body.innerHTML = '';
    const live = el('div'); live.dataset.a = 'live'; body.append(live);
    const acts = el('div', 'ptool cap-acts');
    acts.append(btn('إنشاء الترجمة على الخط الزمني', () => CAP.create(), 'pri', 'مقطع نص لكل عبارة على مسار فيديو جديد في الأعلى'),
      btn('ترجمة إلى لغة أخرى…', () => translateDialog(), '', 'عبر المونتير الذكي (اختياري)'), btn('تصدير SRT', () => exportSub('srt')), btn('تصدير VTT', () => exportSub('vtt')), btn('استيراد SRT…', () => importSub()),
      btn('مسح', async () => { if (await GW.ask('مسح التفريغ', 'حذف نص التفريغ من هذا التسلسل؟ (مقاطع الترجمة على الخط الزمني تبقى)', 'مسح')) { delete s.transcript; GW.commit('مسح التفريغ'); renderBody(); } }));
    if (CAP.renderTextEdit) acts.append(btn(CAP.textMode ? 'عرض المقاطع' : 'التعديل بالنص', () => { CAP.textMode = !CAP.textMode; renderBody(); }, CAP.textMode ? 'pri' : '', 'حدد كلمات في النص لحذفها من الخط الزمني'));
    body.append(acts);
    const has = !!(tr && tr.segs.length);
    const det = el('details', 'cap-det'); if (!has || styleOpen) det.open = true;
    const sum = el('summary', '', 'ترجمة الشورتات — النمط'); sum.onclick = () => { styleOpen = !det.open; }; det.append(sum, styleSection()); body.append(det);
    if (!has) { body.append(el('div', 'empty', R.busy ? 'جارٍ التفريغ… يظهر النص هنا عند الانتهاء.' : 'لا يوجد تفريغ بعد.<br>حدد مقاطع في الخط الزمني (أو اختر «التسلسل كاملًا») ثم اضغط «بدء التفريغ»،<br>أو استورد ملف ترجمة SRT.')); renderLive(); return; }
    const head = el('div', 'ptool', `<span style="color:var(--text2)">${tr.segs.length} مقطع · ${esc(langName(tr.lang))}${tr.translate ? ' · مترجم إلى الإنجليزية' : ''}${tr.model ? ' · ' + esc(tr.model) : ''}</span>`); body.insertBefore(head, det);
    if (CAP.textMode && CAP.renderTextEdit) { const y = CAP._teScroll || 0; body.insertBefore(CAP.renderTextEdit(s, tr), det); renderLive(); body.scrollTop = y; body.onscroll = () => { CAP._teScroll = body.scrollTop; }; return; }
    const list = el('div', 'cap-list'); list.dataset.a = 'list';
    tr.segs.forEach((g, i) => list.append(segRow(s, tr, g, i)));
    body.insertBefore(list, det); renderLive(); markCurrent(true);
  }
  const langName = l => ({ ar: 'العربية', en: 'English', auto: 'تلقائي' }[l] || l || '');
  function segRow(s, tr, g, i) {
    const r = el('div', 'cap-seg'); r.dataset.i = i;
    const tm = el('div', 'tm', `${fmtShort(g.t0)}<i>${fmtShort(g.t1)}</i>`); tm.title = 'انقر للانتقال'; tm.onclick = () => GW.seek(g.t0 + 1e-3);
    const ta = el('textarea', 'inp'); ta.rows = 1; ta.dir = 'auto'; ta.value = g.text; ta.spellcheck = false;
    ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); } };
    ta.oninput = () => { g.text = ta.value.replace(/\n/g, ' '); editing = true; GW.commitSoon('تعديل التفريغ'); };
    ta.onfocus = () => { editing = true; }; ta.onblur = () => { editing = false; };
    const ops = el('div', 'ops');
    const op = (ico, t, f) => { const svg = ico && GW.ico ? GW.ico(ico, 14) : ''; const b = el('button', svg ? '' : 'txt', svg || esc(t.split(' ')[0])); b.title = t; b.onclick = f; ops.append(b); };
    op(null, 'تقسيم عند المؤشر', () => { if (CAP.split(tr.segs, i, ta.selectionStart)) { GW.commit('تقسيم مقطع'); renderBody(); } });
    if (i < tr.segs.length - 1) op(null, 'دمج مع التالي', () => { CAP.merge(tr.segs, i); GW.commit('دمج مقطعين'); renderBody(); });
    op('close', 'حذف', () => { tr.segs.splice(i, 1); GW.commit('حذف مقطع'); renderBody(); });
    r.append(tm, ta, ops); return r;
  }
  let lastCur = -1;
  function markCurrent(force) {
    if (!P || !GW.isShown('captions')) return; const tr = CAP.transcript(); if (!tr) return; const t = GW.T();
    let i = tr.segs.findIndex(g => t >= g.t0 && t < g.t1); if (i === lastCur && !force) return; lastCur = i;
    P.querySelectorAll('.cap-seg.on').forEach(x => x.classList.remove('on'));
    const row = i >= 0 && P.querySelector(`.cap-seg[data-i="${i}"]`); if (row) { row.classList.add('on'); if (GW.pb.playing) row.scrollIntoView({ block: 'nearest' }); }
  }
  function styleSection() {
    const F = UI.form; const o = getOpts(); const s = GW.seq(); const f = el('div', 'form');
    const grid = el('div', 'cap-styles'); grid.dataset.a = 'styles';
    for (const sty of CAP.STYLES) {
      const card = el('div', 'cap-sty' + (CAP.preset(o.style).id === sty.id ? ' on' : '')); const cv = document.createElement('canvas'); cv.width = 236; cv.height = 110; card.append(cv, el('div', '', esc(sty.n))); card.title = sty.n; card.dataset.id = sty.id;
      card.onclick = () => { o.style = sty.id; for (const k of OVR) o[k] = ''; if (sty.pos) o.pos = sty.pos; if (sty.lines) o.lines = sty.lines; saveOpts(); renderBody(); };
      grid.append(card);
    }
    f.append(grid); startPreviews(grid);
    const apply = el('div', 'cap-acts');
    apply.append(btn('تطبيق على كل الترجمات', () => { const n = CAP.restyle(); GW.toast(n ? 'تم تحديث ' + n + ' مقطع' : 'لا توجد مقاطع ترجمة بعد'); }, 'pri', 'النمط والحركة والموضع على كل مقاطع الترجمة، مع الإبقاء على النص والتوقيت'),
      btn(vertical(s) ? 'إعدادات أفقية' : 'إعدادات الشورتات', () => { const d = defOpts({ w: vertical(s) ? 2 : 1, h: vertical(s) ? 1 : 2 }); Object.assign(o, { maxWords: d.maxWords, lines: d.lines, pos: d.pos }); saveOpts(); renderBody(); }, '', 'ضبط عدد الكلمات والأسطر والموضع'));
    f.append(apply);
    const P0 = CAP.preset(o.style); const T0 = CAP.styleText(s, o); const ch = (k) => (v) => { o[k] = v; saveOpts(); repaintPreviews(); };
    const sub = (title, id, rows) => { const d = el('details', 'cap-det cap-sub'); d.open = !!subOpen[id]; d.ontoggle = () => { subOpen[id] = d.open; }; d.append(el('summary', '', esc(title))); const b = el('div', 'form'); b.append(...rows); d.append(b); return d; };
    const opt = (list) => [['', 'حسب النمط'], ...list];
    const reset = (keys) => btn('حسب النمط', () => { for (const k of keys) o[k] = ''; saveOpts(); renderBody(); }, 'ghost');
    const durIn = (k, v) => F.rangeIn(set(o[k]) ? o[k] : v, .04, 1.2, .02, ch(k));
    f.append(sub('الحركة', 'anim', [
      F.frow('الدخول', F.selectIn(opt(GW.CapAnim.IN), o.animIn, ch('animIn'))), F.frow('الخروج', F.selectIn(opt(GW.CapAnim.OUT), o.animOut, ch('animOut'))),
      F.frow('مدة الدخول', durIn('inDur', T0.ca.inDur)), F.frow('مدة الخروج', durIn('outDur', T0.ca.outDur)),
      F.frow('التسارع', F.selectIn(opt(GW.CapAnim.EASE), o.ease, ch('ease'))),
      F.frow('الوحدة', F.selectIn(opt([['block', 'الترجمة كاملة'], ['word', 'كلمة بعد كلمة']]), o.unit, ch('unit'))), F.frow('الفاصل بين الكلمات', F.rangeIn(set(o.stagger) ? o.stagger : T0.ca.stagger, 0, .3, .01, ch('stagger'))),
      reset(['animIn', 'animOut', 'inDur', 'outDur', 'ease', 'unit', 'stagger'])]));
    f.append(sub('تمييز الكلمة النشطة', 'emph', [
      F.frow('أسلوب التمييز', F.selectIn(opt(GW.CapAnim.EMPH), o.emph, ch('emph'))), F.frow('حركة التمييز', F.selectIn(opt(GW.CapAnim.MOTION), o.emMotion, ch('emMotion'))),
      F.frow('لون التمييز', F.colorIn(set(o.hiColor) ? o.hiColor : (T0.kara === 'box' ? T0.hiBg || '#7c3aed' : T0.hiColor || '#ffd400'), ch('hiColor'))), F.frow('حجم التمييز', F.rangeIn(set(o.hiScale) ? o.hiScale : (T0.hiScale || 1), 1, 1.5, .01, ch('hiScale'))),
      F.frow('الكلمات المهمة', [F.checkIn(set(o.kw) ? +o.kw : T0.ca.kw, ch('kw')), el('span', '', ' تلوين الأرقام والأسماء والكلمات المفتاحية '), F.colorIn(set(o.kwColor) ? o.kwColor : T0.ca.kwColor, ch('kwColor'))]),
      F.frow('رموز تعبيرية', [F.checkIn(o.emoji, v => { o.emoji = v; saveOpts(); }), el('span', '', ' إضافة رمز تعبيري مناسب (عند الإنشاء — مغلق افتراضيًا)')]),
      reset(['emph', 'emMotion', 'hiColor', 'hiScale', 'kw', 'kwColor'])]));
    const uf = GW.MapUI && GW.MapUI.userFonts ? GW.MapUI.userFonts().map(x => x.name) : [];
    const fonts = [['', 'حسب النمط (' + (P0.t.font || BASE.font) + ')'], ...['thmanyah sans', 'thmanyah serif display', 'thmanyah serif text'].map(n => [n, n + ' (مثبّت)']), ...GW.FONTS.map(n => [n, n]), ...uf.map(n => [n, n + ' (مستورد)'])];
    if (o.font && !fonts.some(x => x[0] === o.font)) fonts.push([o.font, o.font]);
    const imp = btn('استيراد خط…', async () => { if (!GW.MapUI || !GW.MapUI.importFont) return; const n = await GW.MapUI.importFont(null); if (n) { o.font = n; saveOpts(); renderBody(); } }, 'ghost', 'استيراد ملف خط (ttf / otf)');
    f.append(sub('الخط والمظهر', 'font', [
      F.frow('الخط', [F.selectIn(fonts, o.font, v => { o.font = v; saveOpts(); repaintPreviews(); }), imp]),
      F.frow('السماكة', F.selectIn(opt([[400, '400'], [500, '500'], [600, '600'], [700, '700'], [800, '800'], [900, '900']]), o.weight, ch('weight'))),
      F.frow('حجم الخط', F.rangeIn(o.size, 40, 220, 5, ch('size'))), F.frow('اللون', F.colorIn(set(o.color) ? o.color : T0.color, ch('color'))),
      F.frow('الحد', [F.rangeIn(set(o.stroke) ? o.stroke : (P0.t.stroke != null ? P0.t.stroke : BASE.stroke), 0, 14, .5, ch('stroke')), F.colorIn(set(o.strokeColor) ? o.strokeColor : T0.strokeColor, ch('strokeColor'))]),
      F.frow('الظل', F.checkIn(set(o.shadow) ? +o.shadow : T0.shadow, ch('shadow'))),
      F.frow('الخلفية', F.selectIn(opt([['none', 'بدون'], ['block', 'صندوق للترجمة'], ['line', 'صندوق لكل سطر'], ['word', 'صندوق لكل كلمة']]), o.box, ch('box'))),
      F.frow('لون الخلفية', [F.colorIn(set(o.bgColor) ? o.bgColor : T0.bgColor, ch('bgColor')), F.rangeIn(set(o.bgOp) ? o.bgOp : T0.bgOp, 0, 100, 1, ch('bgOp'))]),
      F.frow('استدارة / هامش', [F.rangeIn(set(o.bgRad) ? o.bgRad : (P0.t.bgRad || 8), 0, 40, 1, ch('bgRad')), F.rangeIn(set(o.bgPad) ? o.bgPad : (P0.t.bgPad || 18), 0, 50, 1, ch('bgPad'))]),
      F.frow('تباعد الأسطر', F.rangeIn(set(o.leading) ? o.leading : T0.leading, .8, 2, .05, ch('leading'))),
      F.frow('حروف لاتينية كبيرة', F.checkIn(o.upper, v => { o.upper = v; saveOpts(); repaintPreviews(); })),
      reset(['weight', 'color', 'stroke', 'strokeColor', 'shadow', 'box', 'bgColor', 'bgOp', 'bgRad', 'bgPad', 'leading'])]));
    f.append(sub('التقسيم والموضع', 'layout', [
      F.frow('كلمات لكل ترجمة', F.rangeIn(o.maxWords, 1, 12, 1, v => { o.maxWords = v; saveOpts(); })),
      F.frow('عدد الأسطر', F.segIn([[1, 'سطر'], [2, 'سطران']], o.lines, v => { o.lines = v; saveOpts(); })),
      F.frow('أقصى كلمات في السطر', F.rangeIn(o.perLine || 0, 0, 8, 1, v => { o.perLine = v; saveOpts(); })),
      F.frow('الموضع', F.segIn(CAP.POS.map(p => [p[0], p[1]]), o.pos, v => { o.pos = v; saveOpts(); })),
      F.frow('هوامش الأمان', [F.checkIn(o.safe !== 0, v => { o.safe = v; saveOpts(); }), el('span', '', ' إبقاء الترجمة بعيدًا عن واجهة الشورتات أعلى وأسفل الشاشة')])]));
    return f;
  }
  const subOpen = {};
  // live preset cards: one RAF loop redraws the visible cards (animation loops every 2.6 s)
  let prevRaf = 0, prevGrid = null;
  const SAMPLE = 'مثال حي للترجمة 2026';
  function previewText(id) {
    const o = Object.assign({}, getOpts(), { style: id, size: 100 }); if (CAP.preset(getOpts().style).id !== id) for (const k of OVR) o[k] = '';
    const st = CAP.styleText({ w: 1080, h: 1920 }, o); const ws = SAMPLE.split(' ');
    const words = ws.map((w, i) => ({ w, s: .25 + i * .32, e: .25 + (i + 1) * .32 })); if (st.ca.kw) words[3].k = 1;
    return { id: 'capprev_' + id, dur: 2.6, text: Object.assign(st, { str: ws.join(' '), words }) };
  }
  function drawPreview(cv, id, t) {
    const fake = previewText(id); const W = cv.width, H = cv.height;
    const mw = GW.TextR.measure(fake.text, 1).w * Math.max(1, fake.text.hiScale || 1) + (fake.text.bg ? fake.text.bgPad * 2 : 0); const e = GW.TextR.draw(fake, t, W, H, Math.min(W / 1150, W * .86 / mw)); const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#2b3a55'); gr.addColorStop(1, '#4a3a2a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.drawImage(e.canvas, 0, 0); GW.TextR.drop(fake.id);
  }
  CAP.drawPreview = drawPreview; CAP.previewText = previewText;
  function startPreviews(grid) {
    prevGrid = grid; if (prevRaf) return; const t0 = performance.now(); let last = 0;
    const tick = (now) => {
      prevRaf = 0; if (!prevGrid || !prevGrid.isConnected) { prevGrid = null; return; }
      if (now - last > 45) { last = now; const t = ((now - t0) / 1000) % 2.6; const vis = prevGrid.offsetParent !== null;
        if (vis) for (const card of prevGrid.querySelectorAll('.cap-sty')) { const r = card.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) continue; drawPreview(card.querySelector('canvas'), card.dataset.id, t); } }
      prevRaf = requestAnimationFrame(tick);
    };
    prevRaf = requestAnimationFrame(tick);
  }
  function repaintPreviews() { /* the RAF loop picks the new options up on its next frame */ }
  /* ---- translation of the transcript through the AI editor (optional) ---- */
  CAP.translateAI = async (lang) => {
    const s = GW.seq(); const tr = CAP.transcript(s); if (!tr || !tr.segs.length) { GW.toast('لا يوجد تفريغ للترجمة'); return null; }
    if (!GW.AI) { GW.toast('المونتير الذكي غير متاح', 'err'); return null; }
    await GW.AI.refresh(); if (!GW.AI.ready()) { GW.toast('الترجمة إلى لغات أخرى تحتاج إعداد «المونتير الذكي» بمفتاح API', 'err'); GW.AI.settings(); return null; }
    GW.toast('جارٍ الترجمة عبر المونتير الذكي…');
    const src = tr.segs.map(g => g.text); const out = [];
    for (let i = 0; i < src.length; i += 120) {
      const part = src.slice(i, i + 120);
      const txt = await GW.AI.complete(`Translate these ${part.length} subtitle lines into the language with code "${lang}". Keep the meaning, keep them short and natural for on-screen captions, keep numbers and names. Return ONLY a JSON array of ${part.length} strings in the same order.\n\n` + JSON.stringify(part));
      const m = /\[[\s\S]*\]/.exec(txt); let arr = null; try { arr = JSON.parse(m ? m[0] : txt); } catch (e) {}
      if (!Array.isArray(arr) || arr.length !== part.length) throw new Error('رد غير متوقع من المساعد (عدد الأسطر لا يطابق)');
      out.push(...arr.map(String));
    }
    return CAP.applyTranslation(out, lang, s);
  };
  CAP.applyTranslation = (texts, lang, s) => {
    s = s || GW.seq(); const tr = CAP.transcript(s); if (!tr) throw new Error('no transcript');
    if (!Array.isArray(texts) || texts.length !== tr.segs.length) throw new Error('texts must have ' + tr.segs.length + ' items (one per transcript segment)');
    tr.segs.forEach((g, i) => { g.text = String(texts[i]).trim(); g.words = []; }); // timings re-spread evenly by alignWords
    tr.lang = lang || tr.lang; tr.translated = 'ai'; GW.commit('ترجمة التفريغ'); renderBody();
    GW.toast('تمت الترجمة — توقيت الكلمات تقديري. اضغط «إنشاء الترجمة على الخط الزمني»'); return tr;
  };
  async function translateDialog() {
    const body = el('div', 'form'); const F = UI.form; let lang = 'en';
    body.append(F.frow('اللغة', F.selectIn([['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['tr', 'Türkçe'], ['ur', 'اردو'], ['fa', 'فارسی'], ['id', 'Bahasa Indonesia'], ['ru', 'Русский'], ['ar', 'العربية']], lang, v => { lang = v; })),
      el('p', 'hint', 'تتم الترجمة عبر «المونتير الذكي» (نموذج ذكاء اصطناعي عام، بمفتاحك) ويُرسل نص التفريغ فقط. راجع الترجمة قبل النشر. توقيت الكلمات بعد الترجمة تقديري (موزّع بالتساوي داخل كل مقطع). لترجمة دقيقة التوقيت إلى الإنجليزية استخدم خيار whisper «ترجمة إلى الإنجليزية» عند التفريغ.'));
    GW.modal({ title: 'ترجمة إلى لغة أخرى', body, width: 520, buttons: [{ label: 'إلغاء', value: null }, { label: 'ترجمة', primary: true, action: async () => { try { await CAP.translateAI(lang); } catch (e) { GW.toast('فشلت الترجمة: ' + e.message, 'err'); } } }] });
  }
  CAP.translateDialog = translateDialog;
  async function exportSub(kind) {
    const s = GW.seq(); const tr = CAP.transcript(s); const segs = tr && tr.segs.length ? tr.segs : CAP.fromClips(s);
    if (!segs.length) { GW.toast('لا يوجد نص لتصديره'); return; }
    const txt = kind === 'vtt' ? CAP.toVTT(segs) : CAP.toSRT(segs);
    if (!api()) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = (s.name || 'captions') + '.' + kind; a.click(); return txt; }
    const p = await paths(); const f = await api().saveDialog({ title: 'تصدير الترجمة', defaultPath: p.renders + p.sep + (s.name || 'captions') + '.' + kind, ext: kind });
    if (!f) return null; await api().writeText(f, '﻿' + txt); GW.toast('تم التصدير: ' + f.split(/[\\/]/).pop()); return f;
  }
  async function importSub(file) {
    const s = GW.seq(); let txt;
    if (api()) { if (!file) { const r = await api().open({ title: 'استيراد ترجمة (SRT / VTT)' }); if (!r.length) return; file = r[0].path; } txt = await api().readText(file); }
    else return;
    const segs = CAP.parseSRT(txt); if (!segs.length) { GW.toast('لم يتم العثور على ترجمات في الملف', 'err'); return; }
    CAP.setTranscript(segs, { lang: GW.isAr(segs.map(x => x.text).join(' ')) ? 'ar' : 'en', model: 'SRT' }, s); GW.commit('استيراد ترجمة'); renderBody();
    GW.toast('تم استيراد ' + segs.length + ' ترجمة — اضغط «إنشاء الترجمة على الخط الزمني»');
    return segs.length;
  }
  CAP.exportSub = exportSub; CAP.importSub = importSub; CAP.renderBody = () => renderBody();

  /* ---------- models & engines dialog ---------- */
  let dlgEl = null;
  async function modelsDialog() {
    if (!hasAsr()) { GW.toast('متاح في نسخة سطح المكتب'); return; }
    await refreshStatus();
    const body = el('div', 'cap-m'); dlgEl = body;
    const m = GW.modal({ title: 'نماذج التعرف على الكلام (whisper.cpp)', body, width: 620, buttons: [{ label: 'فتح مجلد النماذج', action: () => { api().asrOpenModels(); return false; } }, { label: 'استيراد نموذج من ملف…', action: async () => { const r = await api().open({ title: 'اختر ملف نموذج ggml (.bin)' }); if (r.length) { await api().asrImportModel(r[0].path); await refreshStatus(); renderDl(); } return false; } }, { label: 'إغلاق', value: null, primary: true }], onClose: () => { dlgEl = null; } });
    renderDl(); return m;
  }
  function renderDl() {
    if (!dlgEl) return; const st = R.status; if (!st) return; dlgEl.innerHTML = '';
    dlgEl.append(el('div', 'sec-t', 'النماذج'));
    for (const m of st.models) {
      const d = R.dl['model:' + m.id]; const r = el('div', 'row');
      const info = el('div', '', `<b>${esc(m.n)}</b>${m.rec ? ' <span class="cap-tag">موصى به</span>' : ''}<small>${m.installed ? 'منزّل · ' + fmtMB(m.bytes) : (m.mb ? '≈ ' + fmtMB(m.mb * 1048576) : '') + (m.partial ? ' · تنزيل غير مكتمل (' + fmtMB(m.partial) + ') — يُستأنف' : '')}</small>`);
      if (d) { const pct = d.total ? d.got / d.total * 100 : 0; info.append(el('div', 'pbar', `<i style="width:${pct.toFixed(1)}%"></i>`), el('small', '', `${fmtMB(d.got || 0)} / ${fmtMB(d.total || 0)}`)); }
      const a = el('div', 'cap-acts');
      if (d) a.append(btn('إيقاف', () => api().asrCancel('model:' + m.id)));
      else if (m.installed) { a.append(btn('حذف', async () => { if (await GW.ask('حذف النموذج', 'حذف ' + m.n + ' من الجهاز؟', 'حذف')) { await api().asrRemoveModel(m.id); await refreshStatus(); renderDl(); } })); if (!m.custom) a.append(btn('استخدام', () => { runOpts.model = m.id; saveRun(); renderHead(); })); }
      else a.append(btn(m.partial ? 'استئناف' : 'تنزيل', () => { runOpts.model = m.id; saveRun(); CAP.download('model', m.id).then(r => { if (r.ok) GW.toast('اكتمل تنزيل ' + m.n); renderHead(); }); }, 'pri'));
      r.append(info, a); dlgEl.append(r);
    }
    dlgEl.append(el('div', 'sec-t', 'محرك التشغيل'));
    for (const v of ['cpu', 'cuda']) {
      const E = st.engines[v]; const d = R.dl['engine:' + v]; const r = el('div', 'row');
      const name = v === 'cpu' ? 'المعالج (CPU) — مضمّن' : 'تسريع NVIDIA CUDA 12 (اختياري)';
      const note = v === 'cuda' ? (st.gpu && st.gpu.nvidia ? 'موصى به لكرتك ' + esc(st.gpu.name || '') + ' — أسرع بكثير' : 'لا يوجد كرت NVIDIA على هذا الجهاز') : 'يعمل على أي جهاز';
      const info = el('div', '', `<b>${name}</b><small>${E.installed ? 'مثبّت' : 'غير مثبّت · ' + fmtMB(E.size)} — ${note}</small>`);
      if (d) { const pct = d.total ? d.got / d.total * 100 : 0; info.append(el('div', 'pbar', `<i style="width:${pct.toFixed(1)}%"></i>`), el('small', '', d.phase === 'extract' ? 'فك الضغط… ' + Math.round(pct) + '%' : `${fmtMB(d.got || 0)} / ${fmtMB(d.total || 0)}`)); }
      const a = el('div', 'cap-acts');
      if (d) a.append(btn('إيقاف', () => api().asrCancel('engine:' + v)));
      else if (!E.installed && E.downloadable) a.append(btn('تنزيل', () => CAP.download('engine', v), v === 'cuda' && st.gpu && st.gpu.nvidia ? 'pri' : ''));
      r.append(info, a); dlgEl.append(r);
    }
    dlgEl.append(el('div', '', `<small style="color:var(--mute)">المحرك: whisper.cpp ${esc(st.version || '')} (رخصة MIT) · النماذج من huggingface.co/ggerganov/whisper.cpp · المجلد: <span style="direction:ltr;display:inline-block">${esc(st.modelsDir)}</span></small>`));
  }
  CAP.modelsDialog = modelsDialog;

  /* ---------- automation (GW.API) — used by the MCP bridge and «المونتير الذكي» ---------- */
  const A = GW.API && GW.API.methods;
  if (A) {
    const lbl = (x) => { const H = GW.hist; if (H.labels[H.idx] && !/^المساعد: /.test(H.labels[H.idx])) { H.labels[H.idx] = 'المساعد: ' + x; GW.bus.emit('hist'); } };
    // getTranscript({from, to, words}) → {lang, segs:[{i, t0, t1, text, words?}]}
    A.getTranscript = ({ from, to, words } = {}) => { const tr = CAP.transcript(); if (!tr) return { lang: null, segs: [] }; const r = (v) => Math.round(v * 100) / 100; return { lang: tr.lang, translated: tr.translate ? 'en' : tr.translated || null, segs: tr.segs.map((g, i) => Object.assign({ i, t0: r(g.t0), t1: r(g.t1), text: g.text }, words ? { words: (g.words || []).map(w => [w.w, r(w.t0), r(w.t1)]) } : {})).filter(g => (from == null || g.t1 >= +from) && (to == null || g.t0 <= +to)) }; };
    A.listCaptionPresets = () => CAP.STYLES.map(x => ({ id: x.id, name: x.n, in: (x.ca || {}).in, emphasis: x.t.kara || 'color', box: !!x.t.bg }));
    // transcribe({src:'sel'|'seq', lang}) → {segments}
    A.transcribe = async ({ src = 'seq', lang } = {}) => { const r = await UI.transcribe(Object.assign({ src }, lang ? { lang } : {})); if (!r) throw new Error('transcription did not run (no audio, cancelled, engine/model missing — see the captions panel)'); lbl('تفريغ الصوت'); return { lang: r.lang, segments: r.segs.length }; };
    // createCaptions({preset, maxWords, lines, pos, size, keywords}) → {count, track}
    A.createCaptions = ({ preset, style, maxWords, lines, pos, size, keywords, perLine } = {}) => {
      const o = {}; const id = preset || style; if (id) { if (!CAP.STYLES.some(x => x.id === id) && !ALIAS[id]) throw new Error('unknown preset "' + id + '" (' + CAP.STYLES.map(x => x.id).join(', ') + ')'); o.style = id; const P = CAP.preset(id); if (P.pos && !pos) o.pos = P.pos; for (const k of OVR) o[k] = ''; }
      if (maxWords != null) o.maxWords = Math.max(1, Math.min(12, +maxWords)); if (lines != null) o.lines = Math.max(1, Math.min(3, +lines)); if (pos) o.pos = pos; if (size != null) o.size = +size; if (keywords != null) o.keywords = !!keywords; if (perLine != null) o.perLine = +perLine;
      if (!CAP.transcript() || !CAP.transcript().segs.length) throw new Error('no transcript yet: call transcribe first');
      const made = CAP.create(o); lbl('إنشاء الترجمة'); return { count: made.length, track: made[0] ? 'V' + (made[0].ti + 1) : null, preset: CAP.preset(o.style || getOpts().style).id };
    };
    A.restyleCaptions = ({ preset, style, pos, size, keywords } = {}) => { const o = {}; const id = preset || style; if (id) { o.style = id; for (const k of OVR) o[k] = ''; } if (pos) o.pos = pos; if (size != null) o.size = +size; if (keywords != null) o.keywords = !!keywords; const n = CAP.restyle(o); lbl('نمط الترجمة'); return { count: n }; };
    A.translateCaptions = ({ lang, texts } = {}) => { const tr = CAP.applyTranslation(texts, lang); lbl('ترجمة التفريغ'); return { segments: tr.segs.length, lang: tr.lang }; };
  }

  /* ---------- wiring ---------- */
  GW.bus.on('time', () => markCurrent(false));
  GW.bus.on('project', () => { if (!editing) { renderBody(); } });
  GW.bus.on('hist', () => { if (!editing) renderBody(); });
  // Window menu + Graphics menu entries (menus are built in initShell, which runs after this file loads)
  const addItem = (menuName, item, after) => {
    const e = GW.MENUS && GW.MENUS.find(m => m[0] === menuName); if (!e) return; const f = e[1];
    e[1] = () => { const it = f(); const j = after ? it.findIndex(x => x && x.label === after()) : -1; if (j >= 0) it.splice(j + 1, 0, item); else it.push('-', item); return it; };
  };
  addItem('نافذة', { label: 'التفريغ والترجمة', action: () => GW.showPanel('captions') }, () => GW.panels.maps ? GW.panels.maps.title : 'maps');
  addItem('رسومات', { label: 'ترجمة تلقائية من الصوت…', action: () => GW.showPanel('captions') });
  GW.cmd.transcribe = () => UI.transcribe();
})();
