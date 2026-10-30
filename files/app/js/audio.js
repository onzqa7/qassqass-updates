'use strict';
/* Audio engine: live playback through WebAudio, meters, offline mixdown for export */
(function () {
  const A = GW.Audio = { nodes: [], playing: false, t0: 0, c0: 0 };
  const dbToGain = db => db <= -60 ? 0 : Math.pow(10, db / 20);
  A.ctx = () => GW.Media.actx();

  function ensureMaster() {
    if (A.master) return;
    const ctx = A.ctx();
    A.master = ctx.createGain();
    A.split = ctx.createChannelSplitter(2);
    A.anL = ctx.createAnalyser(); A.anR = ctx.createAnalyser(); A.anL.fftSize = A.anR.fftSize = 1024;
    A.master.connect(ctx.destination); A.master.connect(A.split); A.split.connect(A.anL, 0); A.split.connect(A.anR, 1);
    A.bufL = new Float32Array(1024); A.bufR = new Float32Array(1024);
  }
  A.levels = () => {
    if (!A.anL) return [0, 0];
    A.anL.getFloatTimeDomainData(A.bufL); A.anR.getFloatTimeDomainData(A.bufR);
    let l = 0, r = 0; for (let i = 0; i < 1024; i++) { const a = Math.abs(A.bufL[i]), b = Math.abs(A.bufR[i]); if (a > l) l = a; if (b > r) r = b; }
    return [l, r];
  };

  // audio transition envelope multiplier for clip c at time t
  function transGain(s, c, t) {
    let g = 1;
    for (const tr of s.trans) {
      if (tr.tt !== 'a' || tr.ti !== c.ti) continue;
      const [t0, t1, Acl, Bcl] = GW.Render.transRange(s, tr);
      if (t < t0 || t > t1) continue;
      const p = (t - t0) / Math.max(1e-6, t1 - t0);
      const pow = tr.kind !== 'cgain';
      if (Acl === c) g *= pow ? Math.cos(p * Math.PI / 2) : 1 - p;
      if (Bcl === c) g *= pow ? Math.sin(p * Math.PI / 2) : p;
    }
    return g;
  }
  // effective audible window of a clip (transitions extend it)
  function clipWindow(s, c) {
    let a = c.start, b = c.start + c.dur;
    for (const tr of s.trans) { if (tr.tt !== 'a' || tr.ti !== c.ti) continue; const [t0, t1, Acl, Bcl] = GW.Render.transRange(s, tr); if (Acl === c) b = Math.max(b, t1); if (Bcl === c) a = Math.min(a, t0); }
    return [a, b];
  }
  function trackAudible(s, c) {
    const tr = s.at[c.ti]; if (!tr || tr.mute) return false;
    const solo = s.at.some(x => x.solo); if (solo && !tr.solo) return false;
    return c.on !== 0;
  }
  function makeIR(ctx, secs) {
    const len = Math.floor(ctx.sampleRate * secs), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    const rnd = GW.rng(7);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 2.5); }
    return ir;
  }
  // build effect chain; returns [input, output]
  function fxChain(ctx, fxs, lt) {
    const inp = ctx.createGain(); let cur = inp;
    for (const f of fxs || []) {
      if (!f.on || !GW.AFX[f.type]) continue; const p = {}; for (const k in f.params) p[k] = GW.pv(f.params[k], lt);
      let n;
      switch (f.type) {
        case 'gain': n = ctx.createGain(); n.gain.value = dbToGain(p.db); cur.connect(n); cur = n; break;
        case 'lowpass': case 'highpass': n = ctx.createBiquadFilter(); n.type = f.type; n.frequency.value = p.freq; cur.connect(n); cur = n; break;
        case 'eq3': { const lo = ctx.createBiquadFilter(), mi = ctx.createBiquadFilter(), hi = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 200; lo.gain.value = p.low; mi.type = 'peaking'; mi.frequency.value = 1200; mi.Q.value = .8; mi.gain.value = p.mid; hi.type = 'highshelf'; hi.frequency.value = 5000; hi.gain.value = p.high; cur.connect(lo); lo.connect(mi); mi.connect(hi); cur = hi; break; }
        case 'reverb': { const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx, p.size); const wet = ctx.createGain(), dry = ctx.createGain(), out = ctx.createGain(); wet.gain.value = p.mix / 100; dry.gain.value = 1 - p.mix / 200; cur.connect(dry); cur.connect(conv); conv.connect(wet); dry.connect(out); wet.connect(out); cur = out; break; }
        case 'delay': { const d = ctx.createDelay(2.5), fb = ctx.createGain(), wet = ctx.createGain(), out = ctx.createGain(); d.delayTime.value = p.time; fb.gain.value = p.fb / 100; wet.gain.value = p.mix / 100; cur.connect(out); cur.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(out); cur = out; break; }
        case 'comp': n = ctx.createDynamicsCompressor(); n.threshold.value = p.thr; n.ratio.value = p.ratio; cur.connect(n); cur = n; break;
        case 'radio': { const bp1 = ctx.createBiquadFilter(), bp2 = ctx.createBiquadFilter(), ws = ctx.createWaveShaper(), mix = ctx.createGain(), dry = ctx.createGain(), out = ctx.createGain(); bp1.type = 'highpass'; bp1.frequency.value = 400; bp2.type = 'lowpass'; bp2.frequency.value = 3200; const cv = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 3); } ws.curve = cv; mix.gain.value = p.amount / 100; dry.gain.value = 1 - p.amount / 100; cur.connect(dry); cur.connect(bp1); bp1.connect(bp2); bp2.connect(ws); ws.connect(mix); dry.connect(out); mix.connect(out); cur = out; break; }
      }
    }
    return [inp, cur];
  }
  // schedule all clips of sequence s from time t0 into ctx at ctx time `when`
  A.schedule = (ctx, s, t0, when, dest, tEnd) => {
    const nodes = [];
    const master = ctx.createGain(); master.gain.value = dbToGain(s.master || 0); master.connect(dest); nodes.push(master);
    const tGain = s.at.map(tr => { const g = ctx.createGain(); g.gain.value = dbToGain(tr.vol || 0); g.connect(master); nodes.push(g); return g; });
    for (const c of s.clips) {
      if (c.kind === 'nest' && c.on !== 0 && (A._depth || 0) < 4) {
        const sub = GW.prj.seqs.find(x => x.id === c.ref); if (!sub || sub === s) continue;
        const a0 = Math.max(t0, c.start), a1 = Math.min(tEnd != null ? tEnd : c.start + c.dur, c.start + c.dur); if (a1 <= a0) continue;
        const g = ctx.createGain(); g.gain.value = dbToGain(GW.pv(c.vol || GW.P(0), a0 - c.start)); g.connect(master); nodes.push(g);
        A._depth = (A._depth || 0) + 1;
        try { nodes.push(...A.schedule(ctx, sub, GW.srcTime(c, a0), when + (a0 - t0), g, GW.srcTime(c, a1))); } finally { A._depth--; }
        continue;
      }
      if (c.tt !== 'a' || !trackAudible(s, c)) continue;
      const m = GW.media(c.media); const r = m && GW.rt.m[m.id]; if (!r || !r.audio) continue;
      const [wa, wb] = clipWindow(s, c);
      const end = tEnd != null ? Math.min(wb, tEnd) : wb;
      if (end <= t0) continue;
      const from = Math.max(t0, wa); const sp = c.speed || 1;
      if (end <= from) continue; // clip starts after the window end (partial-range mixdown)
      let off = GW.srcTime(c, from); if (off < 0) { continue; }
      if (off >= r.audio.duration) continue;
      const src = ctx.createBufferSource(); src.buffer = r.audio; src.playbackRate.value = sp;
      const g = ctx.createGain(), pan = ctx.createStereoPanner();
      const lt0 = from - c.start;
      // automation: sample volume/pan/transitions
      const len = end - from; const step = 1 / 50; const n = Math.max(2, Math.ceil(len / step) + 1);
      const animated = GW.isAnim(c.vol) || s.trans.some(tr => tr.tt === 'a' && tr.ti === c.ti && (tr.a === c.id || tr.b === c.id));
      if (animated) { const curve = new Float32Array(n); for (let i = 0; i < n; i++) { const tt = from + i * len / (n - 1); curve[i] = dbToGain(GW.pv(c.vol, tt - c.start)) * transGain(s, c, tt); } g.gain.setValueCurveAtTime(curve, when + (from - t0), Math.max(.01, len)); }
      else g.gain.value = dbToGain(GW.pv(c.vol, lt0));
      if (GW.isAnim(c.pan)) { const curve = new Float32Array(n); for (let i = 0; i < n; i++) curve[i] = GW.clamp(GW.pv(c.pan, from + i * len / (n - 1) - c.start) / 100, -1, 1); pan.pan.setValueCurveAtTime(curve, when + (from - t0), Math.max(.01, len)); }
      else pan.pan.value = GW.clamp(GW.pv(c.pan, lt0) / 100, -1, 1);
      const [fi, fo] = fxChain(ctx, c.afx, lt0);
      src.connect(fi); fo.connect(g); g.connect(pan); pan.connect(tGain[c.ti] || master);
      src.start(when + (from - t0), off, len * sp);
      nodes.push(src, g, pan, fi);
    }
    return nodes;
  };
  // live playback is scheduled in windows so a 200-hour timeline only touches (and lazily decodes) the clips near the playhead
  const WIN = 90;
  A.play = (s, t) => {
    A.stop(); ensureMaster();
    const ctx = A.ctx(); if (ctx.state === 'suspended') ctx.resume();
    const when = ctx.currentTime + .06;
    A.playing = true; A.t0 = t; A.c0 = when; A.seqRef = s; A.nodes = []; A.winEnd = t;
    scheduleWindow();
  };
  function scheduleWindow() {
    if (!A.playing) return; const ctx = A.ctx(); const a = A.winEnd, b = a + WIN;
    const nodes = A.schedule(ctx, A.seqRef, a, A.c0 + (a - A.t0), A.master, b); for (const n of nodes) A.nodes.push(n);
    A.winEnd = b;
    const lead = (b - A.t0) - (ctx.currentTime - A.c0) - 25; // schedule the next window ~25 s ahead
    A.winTimer = setTimeout(scheduleWindow, Math.max(500, lead * 1000));
  }
  // a clip's audio finished decoding while playing → reschedule so it is heard right away
  A.onMediaDecoded = (m) => {
    if (!A.playing || !A.seqRef) return; const t = A.now(); const s = A.seqRef;
    if (s.clips.some(c => (c.media === m.id && c.tt === 'a' && c.start < A.winEnd && c.start + c.dur > t) || c.kind === 'nest')) A.play(s, t);
  };
  A.stop = () => { clearTimeout(A.winTimer); for (const n of A.nodes) { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) {} } A.nodes = []; A.playing = false; };
  A.now = () => A.playing ? A.t0 + Math.max(0, A.ctx().currentTime - A.c0) : null;

  A.mixdown = async (s, t0, t1, rate = 48000) => {
    const len = Math.max(1, Math.ceil((t1 - t0) * rate));
    const oc = new OfflineAudioContext(2, len, rate);
    A.schedule(oc, s, t0, 0, oc.destination, t1);
    return oc.startRendering();
  };
  A.wav = (ab) => {
    const ch = 2, rate = ab.sampleRate, n = ab.length; const buf = new ArrayBuffer(44 + n * ch * 2); const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const L = ab.getChannelData(0), Rr = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L; let o = 44;
    for (let i = 0; i < n; i++) { const a = Math.max(-1, Math.min(1, L[i])), b = Math.max(-1, Math.min(1, Rr[i])); v.setInt16(o, a < 0 ? a * 0x8000 : a * 0x7fff, true); v.setInt16(o + 2, b < 0 ? b * 0x8000 : b * 0x7fff, true); o += 4; }
    return buf;
  };
  A.hasAudio = (s) => s.clips.some(c => c.tt === 'a' && c.media && GW.rt.m[c.media] && GW.rt.m[c.media].audio);
})();
