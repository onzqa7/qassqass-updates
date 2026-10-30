'use strict';
/* Audio effects UI + engine extensions (تأثيرات الصوت):
   - new clip effects in GW.AFX: parametric EQ «peq» (HP/LP + 5 bands, draggable curve + live spectrum), de-esser «deesser»,
     true-peak limiter «limiter»; richer compressor (attack/release/knee/make-up, gain-reduction meter) and reverb
     (generated room / hall / plate impulse responses). Builders live in GW.AFXX and are used by audio.js fxChain for BOTH
     live playback and the offline mixdown (preview == export). Live nodes are kept in GW.Audio.taps[fx.id] for meters.
   - «Essential Sound» presets (الصوت الأساسي): dialogue clean / podcast / broadcast, music ducked under dialogue, SFX.
   - GW.Loudness: ITU-R BS.1770 K-weighted loudness (momentary / short-term / integrated with gating) + 4× true peak;
     real-time on the master bus while playing (shown in the Mixer panel), offline measure() for buffers.
   - API: setAudioFx. */
(function () {
  const AF = GW.AudioFX = {};
  const A = GW.Audio;
  const tr = (s) => (GW.lang === 'en' && window.__EN_UI && window.__EN_UI[s]) || s;
  const dbToGain = db => db <= -60 ? 0 : Math.pow(10, db / 20);
  const gainToDb = g => g > 0 ? 20 * Math.log10(g) : -100;
  const n = (k, name, def, min, max, step, unit) => ({ k, n: name, t: 'num', def, min, max, step: step || 1, unit: unit || '' });
  const bool = (k, name, def) => ({ k, n: name, t: 'bool', def: def ? 1 : 0 });
  const sel = (k, name, def, opts) => ({ k, n: name, t: 'select', def, opts });
  const isLive = (ctx) => !(typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext);
  A.taps = A.taps || {};

  /* ---------------- effect definitions (additive) ---------------- */
  const BANDS = [[80, 'lowshelf'], [250, 'peaking'], [1000, 'peaking'], [3500, 'peaking'], [10000, 'highshelf']];
  AF.BANDS = BANDS;
  const peqP = [n('hp', 'قطع منخفض (HP)', 20, 20, 1000, 1, ' Hz'), n('lp', 'قطع عالي (LP)', 20000, 1000, 20000, 10, ' Hz')];
  BANDS.forEach(([f], i) => { peqP.push(n('f' + (i + 1), `تردد ${i + 1}`, f, 20, 20000, 1, ' Hz'), n('g' + (i + 1), `كسب ${i + 1}`, 0, -24, 24, .1, ' dB'), n('q' + (i + 1), `عرض ${i + 1} (Q)`, 1, .1, 10, .05)); });
  GW.AFX.peq = { n: 'معادل بارامتري (EQ)', p: peqP };
  GW.AFX.deesser = { n: 'مزيل الصفير (De-esser)', p: [n('freq', 'التردد', 6000, 2000, 12000, 50, ' Hz'), n('thr', 'العتبة', -30, -60, 0, .5, ' dB'), n('ratio', 'النسبة', 6, 1, 20, .5)] };
  GW.AFX.limiter = { n: 'محدِّد (Limiter)', p: [n('ceil', 'السقف', -1, -20, 0, .1, ' dB'), n('rel', 'الإطلاق', 60, 5, 500, 1, ' ms')] };
  // compressor: keep the old thr/ratio, add attack / release / knee / make-up (auto = Chrome's built-in make-up, as before)
  const cp = GW.AFX.comp.p; const addP = (def, p) => { if (!def.p.some(x => x.k === p.k)) def.p.push(p); };
  if (cp) { addP(GW.AFX.comp, n('att', 'الهجوم', 10, .1, 200, .1, ' ms')); addP(GW.AFX.comp, n('rel', 'الإطلاق', 150, 10, 1000, 1, ' ms')); addP(GW.AFX.comp, n('knee', 'الركبة', 6, 0, 40, .5, ' dB')); addP(GW.AFX.comp, bool('auto', 'تعويض تلقائي', 1)); addP(GW.AFX.comp, n('makeup', 'كسب تعويضي', 0, 0, 24, .1, ' dB')); }
  if (GW.AFX.reverb) { addP(GW.AFX.reverb, sel('kind', 'النوع', 'room', [['room', 'غرفة'], ['hall', 'قاعة'], ['plate', 'لوح (Plate)']])); addP(GW.AFX.reverb, n('pre', 'التأخير المسبق', 10, 0, 200, 1, ' ms')); addP(GW.AFX.reverb, n('damp', 'الإخماد', 50, 0, 100)); }

  /* ---------------- impulse responses ---------------- */
  const irCache = new Map();
  // generated IRs: room = short dense decay with early reflections; hall = long smooth decay, slow build-up; plate = bright, flat density, fast onset
  AF.makeIR = (ctx, kind, secs, damp) => {
    const key = [kind, ctx.sampleRate, secs.toFixed(2), Math.round(damp)].join('|'); if (irCache.has(key)) return irCache.get(key);
    const sr = ctx.sampleRate, len = Math.max(64, Math.floor(sr * secs)), ir = ctx.createBuffer(2, len, sr); const rnd = GW.rng(kind === 'hall' ? 11 : kind === 'plate' ? 13 : 7);
    const d = Math.max(0, Math.min(1, damp / 100));
    for (let ch = 0; ch < 2; ch++) {
      const o = ir.getChannelData(ch); let lp = 0; const k = kind === 'plate' ? .05 + .25 * d : kind === 'hall' ? .25 + .6 * d : .15 + .5 * d; // one-pole low-pass darkens the tail
      for (let i = 0; i < len; i++) {
        const t = i / len; let env;
        if (kind === 'hall') env = Math.pow(1 - t, 3) * Math.min(1, i / (sr * .04)); // slow build-up
        else if (kind === 'plate') env = Math.pow(1 - t, 1.6);
        else env = Math.pow(1 - t, 4);
        let s = (rnd() * 2 - 1) * env;
        lp += (s - lp) * (1 - k * t); s = lp;
        o[i] = s;
      }
      if (kind === 'room') for (let r = 0; r < 6; r++) { const at = Math.floor(sr * (.008 + r * .011) * (1 + .1 * ch)); if (at < len) o[at] += (r % 2 ? -.4 : .4) * (1 - r / 8); }
      let mx = 0; for (let i = 0; i < len; i++) mx = Math.max(mx, Math.abs(o[i])); const g = mx > 0 ? .5 / mx : 1; for (let i = 0; i < len; i++) o[i] *= g;
    }
    irCache.set(key, ir); return ir;
  };

  /* ---------------- node builders: (ctx, params, fx, localTime) → [input, output] ---------------- */
  // Chrome's DynamicsCompressor applies an automatic make-up gain ≈ 0.6 × (gain reduction of a 0 dBFS input); undo it when auto = 0
  const chromeMakeupDb = (thr, ratio, knee) => Math.max(0, -0.6 * (thr + knee / 2) * (1 - 1 / Math.max(1, ratio)));
  const X = GW.AFXX = GW.AFXX || {};
  AF.sr = () => { try { return (A.master && A.ctx().sampleRate) || 48000; } catch (e) { return 48000; } };
  const tap = (ctx, f, o) => { if (isLive(ctx) && f && f.id) A.taps[f.id] = Object.assign({ t: performance.now() }, o); };
  X.peq = (ctx, p, f) => {
    const inp = ctx.createGain(); let cur = inp; const nodes = { bands: [] };
    if (p.hp > 20) { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.Q.value = .707; h.frequency.value = p.hp; cur.connect(h); cur = h; nodes.hp = h; }
    BANDS.forEach(([, type], i) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = p['f' + (i + 1)]; b.gain.value = p['g' + (i + 1)]; b.Q.value = p['q' + (i + 1)]; cur.connect(b); cur = b; nodes.bands.push(b); });
    if (p.lp < 20000) { const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.Q.value = .707; l.frequency.value = p.lp; cur.connect(l); cur = l; nodes.lp = l; }
    if (isLive(ctx)) { const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = .7; cur.connect(an); nodes.an = an; tap(ctx, f, nodes); }
    return [inp, cur];
  };
  X.comp = (ctx, p, f) => {
    const c = ctx.createDynamicsCompressor(); c.threshold.value = p.thr; c.ratio.value = p.ratio; c.knee.value = p.knee != null ? p.knee : 6;
    c.attack.value = (p.att != null ? p.att : 10) / 1000; c.release.value = (p.rel != null ? p.rel : 150) / 1000;
    let out = c;
    if (p.auto === 0) { const g = ctx.createGain(); g.gain.value = dbToGain((p.makeup || 0) - chromeMakeupDb(p.thr, p.ratio, c.knee.value)); c.connect(g); out = g; }
    tap(ctx, f, { comp: c }); return [c, out];
  };
  X.deesser = (ctx, p, f) => {
    // 4th-order split at freq: lows pass, highs go through a fast compressor, then summed (Linkwitz-Riley-style LP²/HP² pair)
    const inp = ctx.createGain(), out = ctx.createGain(); const mk = (type) => { const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(); a.type = b.type = type; a.frequency.value = b.frequency.value = p.freq; a.Q.value = b.Q.value = .707; a.connect(b); return [a, b]; };
    const [l1, l2] = mk('lowpass'), [h1, h2] = mk('highpass'); const c = ctx.createDynamicsCompressor(); c.threshold.value = p.thr; c.ratio.value = p.ratio; c.knee.value = 3; c.attack.value = .002; c.release.value = .08;
    const g = ctx.createGain(); g.gain.value = dbToGain(-chromeMakeupDb(p.thr, p.ratio, 3));
    inp.connect(l1); l2.connect(out); inp.connect(h1); h2.connect(c); c.connect(g); g.connect(out);
    tap(ctx, f, { comp: c }); return [inp, out];
  };
  X.limiter = (ctx, p, f) => {
    // fast compressor (unity make-up) → 4× oversampled hard ceiling, so the true peak never passes `ceil`
    const ceil = Math.min(0, p.ceil); const lin = dbToGain(ceil);
    const c = ctx.createDynamicsCompressor(); c.threshold.value = ceil - 3; c.knee.value = 0; c.ratio.value = 20; c.attack.value = .001; c.release.value = Math.max(.005, (p.rel || 60) / 1000);
    const g = ctx.createGain(); g.gain.value = dbToGain(-chromeMakeupDb(ceil - 3, 20, 0));
    const ws = ctx.createWaveShaper(); const N = 4097, cv = new Float32Array(N); for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; cv[i] = Math.max(-lin, Math.min(lin, x)); } ws.curve = cv; ws.oversample = '4x';
    c.connect(g); g.connect(ws); tap(ctx, f, { comp: c, ceil }); return [c, ws];
  };
  X.reverb = (ctx, p, f) => {
    const conv = ctx.createConvolver(); conv.buffer = AF.makeIR(ctx, p.kind || 'room', Math.max(.1, p.size || 2), p.damp != null ? p.damp : 50);
    const inp = ctx.createGain(), wet = ctx.createGain(), dry = ctx.createGain(), out = ctx.createGain(); wet.gain.value = p.mix / 100; dry.gain.value = 1 - p.mix / 200;
    let w = inp; if (p.pre > 0) { const d = ctx.createDelay(1); d.delayTime.value = p.pre / 1000; inp.connect(d); w = d; }
    inp.connect(dry); w.connect(conv); conv.connect(wet); dry.connect(out); wet.connect(out); return [inp, out];
  };

  // frequency response of a peq param set (dB at each f in Hz) — biquad magnitude via the same formulas WebAudio uses
  AF.peqResponse = (p, freqs, sr = 48000) => {
    const out = new Float32Array(freqs.length);
    const bq = (type, f0, gdb, Q) => {
      const A0 = Math.pow(10, gdb / 40), w0 = 2 * Math.PI * Math.min(f0, sr / 2 - 1) / sr, cw = Math.cos(w0), sw = Math.sin(w0); let b0, b1, b2, a0, a1, a2;
      if (type === 'peaking') { const al = sw / (2 * Q); b0 = 1 + al * A0; b1 = -2 * cw; b2 = 1 - al * A0; a0 = 1 + al / A0; a1 = -2 * cw; a2 = 1 - al / A0; }
      else if (type === 'lowshelf' || type === 'highshelf') { const al = sw / 2 * Math.sqrt((A0 + 1 / A0) * (1 / Q - 1) + 2), s2 = 2 * Math.sqrt(A0) * al, sg = type === 'lowshelf' ? 1 : -1;
        b0 = A0 * ((A0 + 1) - sg * (A0 - 1) * cw + s2); b1 = sg * 2 * A0 * ((A0 - 1) - sg * (A0 + 1) * cw); b2 = A0 * ((A0 + 1) - sg * (A0 - 1) * cw - s2); a0 = (A0 + 1) + sg * (A0 - 1) * cw + s2; a1 = sg * -2 * ((A0 - 1) + sg * (A0 + 1) * cw); a2 = (A0 + 1) + sg * (A0 - 1) * cw - s2; }
      else { const al = sw / (2 * Q); if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; } else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; } a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
      return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    };
    const stages = [];
    if (p.hp > 20) stages.push(bq('highpass', p.hp, 0, .707));
    BANDS.forEach(([, type], i) => { if (Math.abs(p['g' + (i + 1)]) > 1e-3) stages.push(bq(type, p['f' + (i + 1)], p['g' + (i + 1)], p['q' + (i + 1)])); });
    if (p.lp < 20000) stages.push(bq('lowpass', p.lp, 0, .707));
    for (let k = 0; k < freqs.length; k++) {
      const w = 2 * Math.PI * freqs[k] / sr; let mag = 1;
      for (const [b0, b1, b2, a1, a2] of stages) { const c1 = Math.cos(w), c2 = Math.cos(2 * w), s1 = Math.sin(w), s2 = Math.sin(2 * w); const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2); mag *= Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di)); }
      out[k] = gainToDb(mag);
    }
    return out;
  };

  /* ---------------- Essential Sound presets ---------------- */
  const fx = (type, params) => ({ type, params });
  AF.PRESETS = {
    dlg_clean: { n: 'حوار — نقي', cat: 'حوار', fx: [fx('highpass', { freq: 80 }), fx('peq', { g2: -2, f2: 250, g4: 2, f4: 3500 }), fx('comp', { thr: -20, ratio: 3, att: 8, rel: 150, knee: 6, auto: 0, makeup: 4 }), fx('limiter', { ceil: -1 })] },
    dlg_podcast: { n: 'حوار — بودكاست', cat: 'حوار', fx: [fx('highpass', { freq: 90 }), fx('deesser', { freq: 6500, thr: -30, ratio: 6 }), fx('comp', { thr: -24, ratio: 4, att: 5, rel: 120, knee: 6, auto: 0, makeup: 8 }), fx('limiter', { ceil: -1 })] },
    dlg_broadcast: { n: 'حوار — إذاعي', cat: 'حوار', fx: [fx('highpass', { freq: 100 }), fx('peq', { g1: 2, f1: 120, g3: -1.5, f3: 800, g4: 3, f4: 4000, g5: 1.5 }), fx('deesser', { freq: 7000, thr: -28, ratio: 8 }), fx('comp', { thr: -18, ratio: 6, att: 3, rel: 100, knee: 4, auto: 0, makeup: 10 }), fx('limiter', { ceil: -1 })] },
    music_duck: { n: 'موسيقى — خفض تحت الحوار', cat: 'موسيقى', fx: [fx('comp', { thr: -16, ratio: 2, att: 20, rel: 300, knee: 10, auto: 0, makeup: 0 })], duck: true },
    sfx: { n: 'مؤثرات صوتية', cat: 'مؤثرات', fx: [fx('highpass', { freq: 40 }), fx('limiter', { ceil: -3 })] }
  };
  const audioOf = (s, c) => (c.tt === 'a' ? [c] : GW.linked(s, c).filter(x => x.tt === 'a'));
  const targets = (s, clips) => { const set = new Set(); for (const c of clips) audioOf(s, c).forEach(a => set.add(a)); return [...set]; };
  // replace / append effects on clips (plain params → GW.P) — no commit
  AF.setFx = (clips, list, mode) => {
    for (const c of clips) {
      const made = list.map(d => { if (!GW.AFX[d.type]) throw new Error('unknown audio effect: ' + d.type); const f = GW.newFx(d.type, 'a'); for (const k in d.params || {}) { if (!GW.AFX[d.type].p.some(x => x.k === k)) throw new Error('effect "' + d.type + '" has no param "' + k + '"'); f.params[k] = GW.P(d.params[k]); } return f; });
      c.afx = mode === 'append' ? [...(c.afx || []), ...made] : made;
    }
  };
  AF.applyPreset = async (id, clips, o = {}) => {
    const P = AF.PRESETS[id]; if (!P) throw new Error('unknown preset: ' + id);
    const s = o.seq || GW.seq(); const cs = targets(s, clips); if (!cs.length) throw new Error(tr('لا توجد مقاطع صوتية محددة'));
    AF.setFx(cs, P.fx, o.mode || 'replace');
    let duck = null;
    if (P.duck && GW.AudioTools) {
      const tis = new Set(cs.map(c => c.ti)); const voice = s.clips.filter(c => c.tt === 'a' && !tis.has(c.ti) && c.media && !cs.includes(c));
      if (voice.length) { try { duck = await GW.AudioTools.autoDuck({ seq: s, music: cs, voice, duck: o.duck != null ? o.duck : 12, label: 'الصوت الأساسي: ' + P.n }); } catch (e) { duck = { error: String(e.message || e) }; } }
    }
    if (!(duck && !duck.error)) GW.commit(o.label || ('الصوت الأساسي: ' + P.n)); else { GW.hist.labels[GW.hist.idx] = o.label || ('الصوت الأساسي: ' + P.n); GW.bus.emit('hist'); }
    GW.invalidate(); if (GW.FXC && GW.FXC.render) try { GW.FXC.render(); } catch (e) {}
    if (GW.pb && GW.pb.playing) { const t = s.t; GW.stop(); s.t = t; GW.play(1); }
    return { clips: cs.map(c => ({ id: c.id, fx: c.afx.map(f => f.type) })), duck };
  };
  const selClips = (s) => [...GW.sel.clips].map(id => GW.clipById(id, s)).filter(Boolean);
  AF.items = () => Object.entries(AF.PRESETS).map(([k, v]) => ({ label: v.n, action: () => AF.applyPreset(k, selClips(GW.seq())).then(() => GW.toast(tr('طُبّق: ') + v.n)).catch(e => GW.toast(String(e.message || e), 'err')) }));
  const addMenu = (name, items) => { const e = GW.MENUS && GW.MENUS.find(m => m[0] === name); if (!e) return; const f = e[1]; e[1] = () => [...f(), '-', ...items()]; };
  addMenu('مقطع', () => [{ label: 'الصوت الأساسي (Essential Sound)', sub: AF.items() }]);
  (GW.clipMenuHooks = GW.clipMenuHooks || []).push((items, c, s) => { if (!audioOf(s, c).length) return; items.push('-', { label: 'الصوت الأساسي (Essential Sound)', sub: AF.items() }); });

  /* ---------------- loudness (ITU-R BS.1770-4) ---------------- */
  const Loud = GW.Loudness = function (sr, channels) {
    this.sr = sr || 48000; this.ch = channels || 2; this.reset();
  };
  Loud.coeffs = (sr) => { // K-weighting: stage 1 high shelf, stage 2 RLB high-pass (generic-rate design)
    const K1 = Math.tan(Math.PI * 1681.974450955533 / sr), Q1 = 0.7071752369554196, Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a01 = 1 + K1 / Q1 + K1 * K1;
    const s1 = [(Vh + Vb * K1 / Q1 + K1 * K1) / a01, 2 * (K1 * K1 - Vh) / a01, (Vh - Vb * K1 / Q1 + K1 * K1) / a01, 2 * (K1 * K1 - 1) / a01, (1 - K1 / Q1 + K1 * K1) / a01];
    const K2 = Math.tan(Math.PI * 38.13547087602444 / sr), Q2 = 0.5003270373238773, a02 = 1 + K2 / Q2 + K2 * K2;
    const s2 = [1, -2, 1, 2 * (K2 * K2 - 1) / a02, (1 - K2 / Q2 + K2 * K2) / a02];
    return [s1, s2];
  };
  Loud.prototype.reset = function () {
    this.co = Loud.coeffs(this.sr); this.hop = Math.round(this.sr * 0.1); this.pos = 0;
    this.z = []; for (let c = 0; c < this.ch; c++) this.z.push([[0, 0, 0, 0], [0, 0, 0, 0]]);
    this.acc = new Float64Array(this.ch); this.hops = []; this.blocks = []; this.tp = 0; this.tpHold = 0; this.up = []; for (let c = 0; c < this.ch; c++) this.up.push(new Float32Array(8));
    this.momentary = -Infinity; this.shortTerm = -Infinity; this.integrated = -Infinity; this.range = 0; this.samples = 0;
  };
  // 4× oversampled peak of a chunk (8-tap windowed-sinc interpolation, state carried between chunks)
  Loud.prototype.truePeak = function (x, c) {
    const h = this.up[c]; let pk = 0; const W = Loud.TPW;
    for (let i = 0; i < x.length; i++) {
      for (let k = 0; k < 7; k++) h[k] = h[k + 1]; h[7] = x[i];
      const a = Math.abs(x[i]); if (a > pk) pk = a;
      for (let ph = 1; ph < 4; ph++) { let v = 0; const w = W[ph]; for (let k = 0; k < 8; k++) v += h[k] * w[k]; const av = Math.abs(v); if (av > pk) pk = av; }
    }
    return pk;
  };
  Loud.TPW = (() => { const W = [null]; for (let ph = 1; ph < 4; ph++) { const w = new Float32Array(8); let sum = 0; for (let k = 0; k < 8; k++) { const d = (k - 3) - ph / 4; const sinc = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d); const win = .5 + .5 * Math.cos(Math.PI * d / 4.5); w[k] = sinc * win; sum += w[k]; } for (let k = 0; k < 8; k++) w[k] /= sum; W.push(w); } return W; })();
  // feed one chunk per channel (Float32Array[]) — any length
  Loud.prototype.push = function (chans) {
    const N = chans[0].length; const [s1, s2] = this.co;
    for (let c = 0; c < this.ch; c++) {
      const x = chans[Math.min(c, chans.length - 1)]; const z1 = this.z[c][0], z2 = this.z[c][1];
      const tp = this.truePeak(x, c); if (tp > this.tp) this.tp = tp; if (tp > this.tpHold) this.tpHold = tp;
      let acc = 0, i = 0, pos = this.pos;
      while (i < N) {
        const take = Math.min(N - i, this.hop - pos);
        for (let k = i; k < i + take; k++) {
          const x0 = x[k];
          let y = s1[0] * x0 + s1[1] * z1[0] + s1[2] * z1[1] - s1[3] * z1[2] - s1[4] * z1[3]; z1[1] = z1[0]; z1[0] = x0; z1[3] = z1[2]; z1[2] = y;
          const y2 = s2[0] * y + s2[1] * z2[0] + s2[2] * z2[1] - s2[3] * z2[2] - s2[4] * z2[3]; z2[1] = z2[0]; z2[0] = y; z2[3] = z2[2]; z2[2] = y2;
          acc += y2 * y2;
        }
        this.acc[c] += acc; acc = 0; i += take; pos += take;
        if (pos >= this.hop) { if (c === this.ch - 1) { this.hops.push(Float64Array.from(this.acc)); this.acc.fill(0); this.endHop(); } pos = 0; }
      }
      if (c === this.ch - 1) this.pos = pos;
    }
    this.samples += N;
  };
  const lufsOf = (ms) => ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity;
  Loud.prototype.meanSq = function (nHops) { // summed over channels (BS.1770 weights: 1 for L/R/C)
    const H = this.hops; const k0 = Math.max(0, H.length - nHops); let s = 0; for (let k = k0; k < H.length; k++) for (let c = 0; c < this.ch; c++) s += H[k][c]; return s / ((H.length - k0) * this.hop);
  };
  Loud.prototype.endHop = function () {
    if (this.hops.length >= 4) { const m = lufsOf(this.meanSq(4)); this.momentary = m; if (m > -70) this.blocks.push(m); }
    if (this.hops.length >= 30) this.shortTerm = lufsOf(this.meanSq(30));
    if (this.hops.length > 40) this.hops.splice(0, this.hops.length - 40);
    if (this.blocks.length && (this.blocks.length % 5 === 0)) this.integrate();
  };
  Loud.prototype.integrate = function () {
    const B = this.blocks; if (!B.length) { this.integrated = -Infinity; return this.integrated; }
    const pw = (l) => Math.pow(10, (l + 0.691) / 10); let s = 0; for (const l of B) s += pw(l); const rel = lufsOf(s / B.length) - 10;
    let s2 = 0, n2 = 0; for (const l of B) if (l > rel) { s2 += pw(l); n2++; }
    this.integrated = n2 ? lufsOf(s2 / n2) : -Infinity;
    // loudness range (EBU 3342-style, on the gated blocks; approximate with momentary blocks)
    if (n2 > 4) { const g = B.filter(l => l > rel).sort((a, b) => a - b); this.range = g[Math.floor(g.length * .95)] - g[Math.floor(g.length * .1)]; }
    return this.integrated;
  };
  Loud.prototype.result = function () { this.integrate(); return { integrated: this.integrated, shortTerm: this.shortTerm, momentary: this.momentary, truePeak: gainToDb(this.tp), truePeakLin: this.tp, range: this.range, seconds: this.samples / this.sr }; };
  // offline: AudioBuffer → result
  Loud.measure = (ab) => { const L = new Loud(ab.sampleRate, Math.min(2, ab.numberOfChannels)); const chs = []; for (let c = 0; c < L.ch; c++) chs.push(ab.getChannelData(c)); const CH = 4096; for (let i = 0; i < ab.length; i += CH) L.push(chs.map(x => x.subarray(i, Math.min(ab.length, i + CH)))); return L.result(); };
  AF.measure = Loud.measure;

  /* ---------------- real-time master meter ---------------- */
  AF.meter = null;
  // tap the master bus through an AudioWorklet (off the main thread; a ScriptProcessor made headless rendering crawl) and
  // feed 4096-sample stereo chunks to the Loudness meter on the main thread
  const WORKLET = `class T extends AudioWorkletProcessor{constructor(){super();this.n=0;this.L=new Float32Array(4096);this.R=new Float32Array(4096);}
process(inputs){const i=inputs[0];if(!i||!i.length)return true;const l=i[0],r=i[1]||i[0];for(let k=0;k<l.length;k++){this.L[this.n]=l[k];this.R[this.n]=r[k];if(++this.n>=4096){this.port.postMessage({L:this.L,R:this.R},[this.L.buffer,this.R.buffer]);this.L=new Float32Array(4096);this.R=new Float32Array(4096);this.n=0;}}return true;}}
registerProcessor('qq-tap',T);`;
  let hooking = null;
  function hookMaster() {
    if (AF.meterNode || hooking || !A.master) return; const ctx = A.ctx();
    AF.meter = AF.meter || new Loud(ctx.sampleRate, 2);
    if (!ctx.audioWorklet) { // insecure context (dev server / tests): main-thread fallback
      const sp = ctx.createScriptProcessor(4096, 2, 2); const sink = ctx.createGain(); sink.gain.value = 0;
      sp.onaudioprocess = (e) => { if (!A.playing) return; const b = e.inputBuffer; AF.meter.push([b.getChannelData(0), b.getChannelData(b.numberOfChannels > 1 ? 1 : 0)]); };
      A.master.connect(sp); sp.connect(sink); sink.connect(ctx.destination); AF.meterNode = sp; return;
    }
    hooking = (async () => {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
        await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(ctx, 'qq-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
        node.port.onmessage = (e) => { if (A.playing && AF.meter) AF.meter.push([e.data.L, e.data.R]); };
        A.master.connect(node); AF.meterNode = node;
      } catch (e) { console.warn('loudness tap unavailable', e); AF.meterNode = null; }
      hooking = null;
    })();
  }
  const play0 = A.play; A.__play0 = play0; A.play = (s, t) => { const r = play0(s, t); try { hookMaster(); if (AF.meter && (AF.meterSeq !== s || Math.abs((AF.meterT || 0) - t) > .5)) AF.meter.reset(); AF.meterSeq = s; } catch (e) {} return r; };
  const stop0 = A.stop; A.stop = () => { const r = stop0(); if (AF.meter) { AF.meterT = A.t0 + 0; } return r; };
  AF.resetMeter = () => { if (AF.meter) AF.meter.reset(); if (AF.meter) AF.meter.tpHold = 0; };
  // mixer panel: a LUFS read-out under the master strip (built by ui_panels.js; we only append to it)
  const css = document.createElement('style');
  css.textContent = `
.strip.master .lufs{display:grid;grid-template-columns:auto auto;gap:1px 6px;font:10px var(--f-mono,monospace);direction:ltr;color:var(--text2);margin-top:4px;cursor:pointer}
.strip.master .lufs b{color:var(--text);font-weight:600;text-align:right}.strip.master .lufs b.hot{color:var(--red,#e5534b)}.strip.master .lufs b.ok{color:var(--green,#3fb950)}
.peq-wrap{position:relative;margin:4px 0 6px;direction:ltr}.peq-wrap canvas{width:100%;height:150px;display:block;border-radius:6px;background:#111;cursor:crosshair}
.peq-wrap .hint{position:absolute;right:6px;top:4px;font-size:10px;color:var(--text2);pointer-events:none}
.gr-wrap{display:flex;align-items:center;gap:8px;margin:4px 0;direction:ltr;font:10px var(--f-mono,monospace);color:var(--text2)}.gr-wrap .gr{flex:1;height:8px;background:#111;border-radius:3px;overflow:hidden;position:relative}.gr-wrap .gr i{position:absolute;right:0;top:0;bottom:0;background:var(--accent);width:0}`;
  document.head.append(css);
  const fmtL = (v) => (v == null || !isFinite(v) || v < -99) ? '—' : v.toFixed(1);
  GW.bus.on('tick', () => {
    const strip = document.querySelector('.strip.master'); if (!strip) return;
    let box = strip.querySelector('.lufs');
    if (!box) { box = document.createElement('div'); box.className = 'lufs'; box.title = tr('مقياس الصوت LUFS (انقر لإعادة الضبط)'); box.innerHTML = '<span>M</span><b data-k="m">—</b><span>S</span><b data-k="s">—</b><span>I</span><b data-k="i">—</b><span>TP</span><b data-k="tp">—</b>'; box.onclick = AF.resetMeter; strip.append(box); }
    const M = AF.meter; if (!M) return;
    const q = k => box.querySelector(`[data-k=${k}]`); const r = { m: M.momentary, s: M.shortTerm, i: M.integrated, tp: gainToDb(M.tpHold) };
    const put = (e, txt, cls) => { if (e.textContent !== txt) e.textContent = txt; if (e.className !== cls) e.className = cls; }; // idle = no DOM writes (no repaint)
    for (const k of ['m', 's', 'i']) put(q(k), fmtL(r[k]), k === 'i' && isFinite(r.i) ? (Math.abs(r.i + 14) <= 1 ? 'ok' : r.i > -13 ? 'hot' : '') : '');
    put(q('tp'), fmtL(r.tp), r.tp > -1 ? 'hot' : '');
  });
  GW.bus.on('project', () => AF.resetMeter());

  /* ---------------- effect-control rows (ui_fxc.js → GW.AudioFX.fxcRows) ---------------- */
  const liveRestart = () => { if (GW.pb && GW.pb.playing) { const s = GW.seq(); const t = s.t; GW.stop(); s.t = t; GW.play(1); } };
  AF.fxcRows = (sec, c, fxo, row) => {
    const lt = () => Math.max(0, Math.min(c.dur, GW.seq().t - c.start));
    const live = () => A.taps[fxo.id];
    if (fxo.type === 'peq') {
      const wrap = document.createElement('div'); wrap.className = 'peq-wrap'; const cv = document.createElement('canvas'); wrap.append(cv); const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = tr('اسحب النقاط · العجلة: Q'); wrap.append(hint);
      sec.body.prepend(wrap);
      const FMIN = 20, FMAX = 20000, GR = 24; const fx = (f, w) => Math.log(f / FMIN) / Math.log(FMAX / FMIN) * w, xf = (x, w) => FMIN * Math.pow(FMAX / FMIN, x / w), gy = (g, h) => h / 2 - g / GR * (h / 2), yg = (y, h) => (h / 2 - y) / (h / 2) * GR;
      const pv = () => { const p = {}; for (const k in fxo.params) p[k] = GW.pv(fxo.params[k], lt()); return p; };
      let drag = null, raf = 0, spec = null, tries = 0;
      const req = () => { if (!raf) raf = requestAnimationFrame(draw); };
      const draw = () => {
        raf = 0; if (!cv.isConnected) return;
        const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1; if (!w || !h) { if (tries++ < 120) setTimeout(req, 100); return; }
        if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
        // grid
        g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; g.font = '9px sans-serif'; g.fillStyle = 'rgba(255,255,255,.35)';
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(fx(f, w)) + .5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.fillText(f >= 1000 ? (f / 1000) + 'k' : f, x + 2, h - 3); }
        for (const d of [-18, -12, -6, 0, 6, 12, 18]) { const y = Math.round(gy(d, h)) + .5; g.strokeStyle = d === 0 ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.06)'; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); if (d) g.fillText((d > 0 ? '+' : '') + d, 2, y - 2); }
        // spectrum (live)
        const L = live(); if (L && L.an && A.playing) {
          if (!spec || spec.length !== L.an.frequencyBinCount) spec = new Float32Array(L.an.frequencyBinCount); L.an.getFloatFrequencyData(spec); const sr = A.ctx().sampleRate;
          g.beginPath(); g.moveTo(0, h);
          for (let x = 0; x < w; x += 2) { const f = xf(x, w); const bin = Math.min(spec.length - 1, Math.round(f / (sr / 2) * spec.length)); const db = Math.max(-100, spec[bin]); const y = h - Math.max(0, (db + 100) / 100) * h; g.lineTo(x, y); }
          g.lineTo(w, h); g.closePath(); g.fillStyle = 'rgba(47,142,240,.18)'; g.fill();
        }
        // curve
        const p = pv(); const N = Math.max(64, Math.floor(w / 2)); const freqs = new Float32Array(N); for (let i = 0; i < N; i++) freqs[i] = xf(i * w / (N - 1), w);
        const resp = AF.peqResponse(p, freqs, AF.sr());
        g.beginPath(); for (let i = 0; i < N; i++) { const x = i * w / (N - 1), y = gy(Math.max(-GR, Math.min(GR, resp[i])), h); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
        g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#2f8ef0'; g.lineWidth = 2; g.stroke();
        // handles
        BANDS.forEach((_, i) => { const x = fx(p['f' + (i + 1)], w), y = gy(p['g' + (i + 1)], h); g.beginPath(); g.arc(x, y, drag && drag.i === i ? 7 : 5, 0, Math.PI * 2); g.fillStyle = drag && drag.i === i ? '#fff' : g.strokeStyle; g.fill(); g.fillStyle = '#fff'; g.font = '9px sans-serif'; g.fillText(String(i + 1), x - 2.5, y + 3); });
        for (const [k, col] of [['hp', '#e5534b'], ['lp', '#e5534b']]) { const on = k === 'hp' ? p.hp > 20 : p.lp < 20000; const x = fx(p[k], w); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.strokeStyle = on ? col : 'rgba(229,83,75,.3)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]); g.fillStyle = on ? col : 'rgba(229,83,75,.5)'; g.beginPath(); g.rect(x - 4, h / 2 - 4, 8, 8); g.fill(); }
        if (A.playing || drag) req(); // live spectrum / drag → animate; idle → static
      };
      req(); GW.bus.on('tick', () => { if (cv.isConnected && A.playing) req(); }); GW.bus.on('param', () => { if (cv.isConnected) req(); });
      const setP = (k, v) => { GW.setPv(fxo.params[k], lt(), v); req(); const L = live(); if (L) { const i = /^[fgq](\d)$/.exec(k); if (i && L.bands[i[1] - 1]) { const b = L.bands[i[1] - 1]; if (k[0] === 'f') b.frequency.value = v; else if (k[0] === 'g') b.gain.value = v; else b.Q.value = v; } else if (k === 'hp' && L.hp) L.hp.frequency.value = v; else if (k === 'lp' && L.lp) L.lp.frequency.value = v; } GW.invalidate(); };
      const pick = (e) => { const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top, w = r.width, h = r.height; const p = pv(); let best = null, bd = 14;
        BANDS.forEach((_, i) => { const d = Math.hypot(fx(p['f' + (i + 1)], w) - x, gy(p['g' + (i + 1)], h) - y); if (d < bd) { bd = d; best = { i, k: 'band' }; } });
        if (!best) for (const k of ['hp', 'lp']) { const d = Math.abs(fx(p[k], w) - x); if (d < 8) best = { k }; }
        return { best, x, y, w, h }; };
      cv.onpointerdown = (e) => { const { best, w, h } = pick(e); if (!best) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); drag = Object.assign({ w, h, hp: pv().hp, lp: pv().lp }, best); };
      cv.onpointermove = (e) => { if (!drag) return; const r = cv.getBoundingClientRect(); const x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
        if (drag.k === 'band') { setP('f' + (drag.i + 1), Math.round(xf(x, r.width))); setP('g' + (drag.i + 1), Math.round(yg(y, r.height) * 10) / 10); }
        else { const f = Math.round(xf(x, r.width)); if (drag.k === 'hp') setP('hp', Math.min(1000, Math.max(20, x < 3 ? 20 : f))); else setP('lp', Math.max(1000, Math.min(20000, x > r.width - 3 ? 20000 : f))); }
        drag.moved = true; };
      cv.onpointerup = cv.onpointercancel = (e) => { if (!drag) return; const moved = drag.moved; drag = null; if (moved) { GW.commit('معادل بارامتري'); if (!live()) liveRestart(); if (GW.FXC && GW.FXC.render) GW.FXC.render(); } };
      cv.ondblclick = (e) => { const { best } = pick(e); if (best && best.k === 'band') { setP('g' + (best.i + 1), 0); GW.commit('معادل بارامتري'); GW.FXC.render(); } else if (best) { setP(best.k, best.k === 'hp' ? 20 : 20000); GW.commit('معادل بارامتري'); GW.FXC.render(); } };
      cv.onwheel = (e) => { const { best } = pick(e); if (!best || best.k !== 'band') return; e.preventDefault(); const k = 'q' + (best.i + 1); const q = GW.pv(fxo.params[k], lt()); setP(k, Math.max(.1, Math.min(10, Math.round((q * (e.deltaY < 0 ? 1.15 : 1 / 1.15)) * 100) / 100))); clearTimeout(cv._qt); cv._qt = setTimeout(() => { GW.commit('معادل بارامتري'); GW.FXC.render(); }, 500); };
    }
    if (fxo.type === 'comp' || fxo.type === 'limiter' || fxo.type === 'deesser') {
      const wrap = document.createElement('div'); wrap.className = 'gr-wrap'; wrap.innerHTML = `<span>GR</span><span class="gr"><i></i></span><b style="min-width:52px;text-align:right;color:var(--text)">0.0 dB</b>`; sec.body.prepend(wrap);
      const bar = wrap.querySelector('i'), txt = wrap.querySelector('b'); let hold = 0;
      const tickGr = () => { if (!wrap.isConnected) return; const L = live(); let gr = 0; if (L && L.comp && A.playing) gr = Math.max(0, -L.comp.reduction); const h2 = Math.max(gr, hold * .9); if (Math.abs(h2 - hold) < .01 && h2 < .01) return; hold = h2; bar.style.width = Math.min(100, hold / 24 * 100) + '%'; txt.textContent = '-' + hold.toFixed(1) + ' dB'; };
      GW.bus.on('tick', tickGr);
    }
  };

  /* ---------------- real-time sidechain ducking per track ---------------- */
  // Track setting s.at[ti].duck = { on, amount (dB), thr (dB), att, rel, hold (s) }: while the sequence is scheduled, the gain of a
  // ducked track follows the envelope of the OTHER (non-ducked) audio tracks — no keyframes are written, edits are followed
  // automatically, and the same curve drives the live graph and the offline mixdown. Envelope: media peaks (100/s) when
  // loaded, else the decoded buffer.
  AF.DUCK_DEF = { on: 0, amount: 12, thr: -35, att: .15, rel: .5, hold: .25 };
  AF.duckOf = (tr) => Object.assign({}, AF.DUCK_DEF, tr.duck || {});
  const RATE = 100;
  // max |x| per 10 ms of media m (0..1), from the decoded buffer when the peaks file is not ready
  function envOf(m) {
    const r = GW.rt.m[m.id]; if (!r) return null; if (r._peaks && r._peaks.length) return r._peaks;
    if (!r._audio) return null; if (r._envTmp) return r._envTmp;
    const ab = r._audio, n = Math.ceil(ab.duration * RATE), out = new Float32Array(n), step = ab.sampleRate / RATE, chs = [];
    for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) chs.push(ab.getChannelData(c));
    for (let i = 0; i < n; i++) { let mx = 0; const s0 = Math.floor(i * step), s1 = Math.min(chs[0].length, Math.floor((i + 1) * step)); for (const d of chs) for (let k = s0; k < s1; k += 4) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > mx) mx = v; } out[i] = mx; }
    return (r._envTmp = out);
  }
  // voice level (dB) sampled at RATE over [t0, t1] from clips on tracks not ducked (mute/solo respected)
  AF.voiceEnvelope = (s, t0, t1, exclude) => {
    const n = Math.max(1, Math.ceil((t1 - t0) * RATE)); const env = new Float32Array(n).fill(0); const solo = s.at.some(x => x.solo);
    for (const c of s.clips) {
      if (c.tt !== 'a' || c.on === 0 || exclude.has(c.ti)) continue; const tr = s.at[c.ti]; if (!tr || tr.mute || (solo && !tr.solo)) continue;
      const m = GW.media(c.media); if (!m) continue; const pk = envOf(m); if (!pk) continue;
      const a = Math.max(t0, c.start), b = Math.min(t1, c.start + c.dur); if (b <= a) continue;
      for (let i = Math.floor((a - t0) * RATE); i < Math.min(n, Math.ceil((b - t0) * RATE)); i++) { const t = t0 + i / RATE; const src = GW.srcTime(c, t); const k = Math.floor(src * RATE); if (k >= 0 && k < pk.length) { const g = dbToGain(GW.pv(c.vol, t - c.start)); const v = pk[k] * g; if (v > env[i]) env[i] = v; } }
    }
    return env;
  };
  // gain multiplier curve (RATE/s) for one ducked track
  AF.duckCurve = (s, ti, t0, t1) => {
    const D = AF.duckOf(s.at[ti]); const exclude = new Set(s.at.map((t, i) => (t.duck && t.duck.on) ? i : -1).filter(i => i >= 0));
    const env = AF.voiceEnvelope(s, t0 - D.rel - D.hold - 1, t1 + D.att + 1, exclude); const off = Math.round((D.rel + D.hold + 1) * RATE); const n = Math.ceil((t1 - t0) * RATE) + 1;
    const thr = dbToGain(D.thr); const target = dbToGain(-Math.abs(D.amount)); const out = new Float32Array(n);
    // speech gate with hold → look-ahead attack ramp / release ramp
    const gate = new Uint8Array(env.length); let last = -1e9; for (let i = 0; i < env.length; i++) { if (env[i] >= thr) last = i; gate[i] = (i - last) <= D.hold * RATE ? 1 : 0; }
    const aN = Math.max(1, Math.round(D.att * RATE)), rN = Math.max(1, Math.round(D.rel * RATE));
    let g = 1; const want = new Float32Array(env.length);
    for (let i = 0; i < env.length; i++) { let w = 1; for (let k = -aN; k <= 0; k++) { const j = i - k; if (j < env.length && gate[j]) { w = 1 - (1 - target) * (1 - (-k) / aN); break; } } if (gate[i]) w = target; want[i] = w; }
    for (let i = 0; i < env.length; i++) { const w = want[i]; if (w < g) g = Math.max(w, g - (1 - target) / aN); else g = Math.min(w, g + (1 - target) / rN); if (i >= off && i - off < n) out[i - off] = g; }
    return out;
  };
  AF.duckTracks = (ctx, s, t0, when, tGain, tEnd) => {
    const t1 = tEnd != null ? tEnd : Math.max(t0 + 1, GW.seqDur(s));
    s.at.forEach((tr, ti) => {
      if (!tr.duck || !tr.duck.on || !tGain[ti]) return;
      const curve = AF.duckCurve(s, ti, t0, t1); const base = dbToGain(tr.vol || 0); for (let i = 0; i < curve.length; i++) curve[i] *= base;
      if (curve.length >= 2) tGain[ti].gain.setValueCurveAtTime(curve, Math.max(ctx.currentTime, when), Math.max(.02, t1 - t0));
    });
  };
  AF.setDuck = (s, ti, patch) => { const tr = s.at[ti]; if (!tr) throw new Error('no audio track ' + ti); tr.duck = Object.assign(AF.duckOf(tr), patch || {}); if (!tr.duck.on) tr.duck = { on: 0, amount: tr.duck.amount, thr: tr.duck.thr, att: tr.duck.att, rel: tr.duck.rel, hold: tr.duck.hold }; GW.commit(tr.duck.on ? 'خفض تلقائي للمسار' : 'إيقاف الخفض التلقائي'); liveRestart(); return tr.duck; };
  AF.duckDialog = (ti) => {
    const s = GW.seq(); const tr = s.at[ti]; if (!tr) return; const D = AF.duckOf(tr);
    const body = document.createElement('div'); body.className = 'form'; body.style.padding = '0';
    body.innerHTML = `<p style="color:var(--text2);font-size:11px;margin:0 0 8px">يُخفَّض هذا المسار تلقائياً أثناء الكلام على المسارات الأخرى (في المعاينة والتصدير) دون كتابة مفاتيح حركة.</p>
      <div class="frow"><label>التفعيل</label><div class="ctl"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="on"> خفض تلقائي لهذا المسار</label></div></div>
      <div class="frow"><label>مقدار الخفض</label><div class="ctl"><input class="inp" type="number" data-k="amount" min="1" max="40" step="1" style="width:70px"> dB</div></div>
      <div class="frow"><label>عتبة الكلام</label><div class="ctl"><input class="inp" type="number" data-k="thr" min="-60" max="0" step="1" style="width:70px"> dB</div></div>
      <div class="frow"><label>الهجوم / الإطلاق</label><div class="ctl"><input class="inp" type="number" data-k="att" min="0.01" max="2" step="0.05" style="width:64px"> <input class="inp" type="number" data-k="rel" min="0.05" max="5" step="0.05" style="width:64px"> ث</div></div>
      <div class="frow"><label>التثبيت بين الجمل</label><div class="ctl"><input class="inp" type="number" data-k="hold" min="0" max="3" step="0.05" style="width:64px"> ث</div></div>`;
    const q = k => body.querySelector(`[data-k=${k}]`); q('on').checked = !!D.on; for (const k of ['amount', 'thr', 'att', 'rel', 'hold']) q(k).value = D[k];
    GW.modal({ title: 'خفض تلقائي (Sidechain) — ' + tr.name, width: 460, body, buttons: [{ label: 'إلغاء', value: false }, { label: 'حفظ', primary: true, value: true, action: () => { AF.setDuck(s, ti, { on: q('on').checked ? 1 : 0, amount: +q('amount').value || 12, thr: +q('thr').value || -35, att: +q('att').value || .15, rel: +q('rel').value || .5, hold: +q('hold').value || 0 }); } }] });
  };
  // mixer strips: a «Duck» toggle per track (strips are rebuilt by ui_panels.js; we only add to them)
  GW.bus.on('tick', () => {
    const strips = document.querySelectorAll('.mixer .strip:not(.master)'); if (!strips.length) return; const s = GW.seq();
    strips.forEach((st, ti) => {
      const trk = s.at[ti]; if (!trk) return; let b = st.querySelector('.duckb'); const on = !!(trk.duck && trk.duck.on);
      if (!b) { b = document.createElement('button'); b.className = 'btn sm duckb'; b.textContent = 'Duck'; b.title = tr('خفض تلقائي أثناء الكلام (Sidechain) · Shift+نقر: الإعدادات'); b.onclick = (e) => { const S = GW.seq(), T = S.at[ti]; const cur = !!(T && T.duck && T.duck.on); if (e.shiftKey || !cur) AF.duckDialog(ti); else AF.setDuck(S, ti, { on: 0 }); }; const ms = st.querySelector('.ms'); if (ms) ms.append(b); else st.append(b); }
      if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
    });
  });

  /* ---------------- automation (GW.API) ---------------- */
  const M = GW.API && GW.API.methods;
  if (M) {
    // setAudioFx({id|ids|track, fx:[{type, params}], mode:'replace'|'append', preset:'dlg_clean'|…}) → {clips, duck}
    M.setAudioFx = async (p = {}) => {
      const s = GW.seq(); let cs = [];
      if (p.track != null) { const t = GW.API.parseTrack(p.track, 'a'); cs = s.clips.filter(c => c.tt === 'a' && c.ti === t.ti); }
      else cs = (p.ids || [p.id]).filter(Boolean).map(id => { const c = GW.clipById(id, s); if (!c) throw new Error('clip not found: ' + id); return c; });
      cs = targets(s, cs); if (!cs.length) throw new Error('no audio clips (give id, ids or track)');
      if (p.preset) return AF.applyPreset(p.preset, cs, { mode: p.mode, duck: p.duck, label: 'المساعد: الصوت الأساسي' });
      if (!Array.isArray(p.fx)) throw new Error('fx: array of {type, params} (types: ' + Object.keys(GW.AFX).join(', ') + ') or preset: ' + Object.keys(AF.PRESETS).join(', '));
      AF.setFx(cs, p.fx, p.mode || 'replace'); GW.commit('المساعد: تأثيرات الصوت'); GW.invalidate(); if (GW.FXC && GW.FXC.render) try { GW.FXC.render(); } catch (e) {}
      return { clips: cs.map(c => ({ id: c.id, fx: c.afx.map(f => ({ id: f.id, type: f.type })) })) };
    };
    // setDuck({track:'A2', on:true, amount=12, thr=-35, attack=0.15, release=0.5, hold=0.25}) → track duck settings
    M.setDuck = ({ track, on = true, amount, thr, attack, release, hold } = {}) => { const t = GW.API.parseTrack(track, 'a'); if (!t) throw new Error('track required (A1, A2…)'); const patch = { on: on ? 1 : 0 }; if (amount != null) patch.amount = +amount; if (thr != null) patch.thr = +thr; if (attack != null) patch.att = +attack; if (release != null) patch.rel = +release; if (hold != null) patch.hold = +hold; const d = AF.setDuck(GW.seq(), t.ti, patch); GW.hist.labels[GW.hist.idx] = 'المساعد: ' + GW.hist.labels[GW.hist.idx]; GW.bus.emit('hist'); return { track: 'A' + (t.ti + 1), duck: d }; };
    M.listAudioPresets = () => Object.entries(AF.PRESETS).map(([k, v]) => ({ id: k, name: v.n, cat: v.cat, fx: v.fx.map(f => f.type), duck: !!v.duck }));
  }
})();
