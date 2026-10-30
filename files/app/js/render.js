'use strict';
/* Frame evaluation: which clips/transitions are active, source acquisition, full composite */
(function () {
  const R = GW.R;
  const RN = GW.Render = { playing: false, exporting: false };

  RN.transRange = (s, tr) => {
    const A = tr.a && GW.clipById(tr.a, s), B = tr.b && GW.clipById(tr.b, s);
    let at = A && B ? A.start + A.dur : A ? A.start + A.dur : B ? B.start : 0;
    const d = tr.dur;
    if (A && B) { const al = tr.align || 'center'; if (al === 'start') return [at, at + d, A, B]; if (al === 'end') return [at - d, at, A, B]; return [at - d / 2, at + d / 2, A, B]; }
    if (A) return [at - d, at, A, null];
    return [at, at + d, null, B];
  };
  // active items on a track at time t
  RN.trackItems = (s, tt, ti, t) => {
    for (const tr of s.trans) {
      if (tr.tt !== tt || tr.ti !== ti) continue;
      const [t0, t1, A, B] = RN.transRange(s, tr);
      if (t >= t0 && t < t1) return { tr, A, B, p: (t - t0) / Math.max(1e-6, t1 - t0) };
    }
    const c = GW.clipAt(s, tt, ti, t);
    return c && c.on !== 0 ? { c } : null;
  };

  function shakeFx(c, lt) {
    const f = (c.fx || []).find(x => x.type === 'shake' && x.on); if (!f) return null;
    const p = {}; for (const k in f.params) p[k] = GW.pv(f.params[k], lt);
    const n = (x, s) => { const i = Math.floor(x), fr = x - i; const h = q => (Math.sin(q * 127.1 + s * 311.7) * 43758.5453) % 1; const a = h(i), b = h(i + 1); return (a + (b - a) * fr * fr * (3 - 2 * fr)) * 2; };
    const t = lt * p.freq;
    return { x: (n(t, p.seed) + n(t * 2.1, p.seed + 3) * .5) * p.amount * .7, y: (n(t, p.seed + 7) + n(t * 1.9, p.seed + 11) * .5) * p.amount * .7, rot: n(t * .8, p.seed + 19) * p.rot, zoom: 1 + p.zoom / 100 };
  }
  RN.layerScale = (c, lt, r, esWorld) => {
    let es = 1;
    if (esWorld != null) es = esWorld; // parented layers: scale from the composed world matrix (shake included)
    else if (c.motion) { const s = GW.pv(c.motion.scale, lt) / 100, sw = c.motion.uni ? s : GW.pv(c.motion.scaleW, lt) / 100; es = Math.max(Math.abs(s), Math.abs(sw)); }
    const sh = esWorld == null && (c.fx || []).find(x => x.type === 'shake' && x.on); if (sh) es *= 1 + GW.pv(sh.params.zoom, lt) / 100;
    const cap = (c.kind === 'text' || c.kind === 'color' || c.kind === 'shape') ? 2 : c.kind === 'map' ? 1.5 : 1;
    let ls = GW.clamp(r * es * 1.02, .05, cap);
    return Math.ceil(ls * 16) / 16;
  };

  // returns a layer FBO (lw×lh) holding the clip's source, or null
  function sourceLayer(s, c, t, lt, ls, r, acc, opts) {
    const sw = c.sw || s.w, sh = c.sh || s.h;
    const lw = Math.max(2, Math.round(sw * ls)), lh = Math.max(2, Math.round(sh * ls));
    if (c.kind === 'color') { const f = R.fbo(lw, lh); const rgb = GW.hexf(c.color); R.pass('fill', f, [], { col: [...rgb, 1] }); return f; }
    if (c.kind === 'adjust') { if (!acc) return null; const f = R.fbo(acc.w, acc.h); R.pass('copy', f, [acc.tex]); return f; }
    if (c.kind === 'text') {
      const e = GW.TextR.draw(c, lt, lw, lh, lw / s.w);
      const tx = R.upload('t:' + c.id, e.canvas, lw, lh, e.ver);
      const f = R.fbo(lw, lh); R.pass('copy', f, [tx.tex]); return f;
    }
    if (c.kind === 'shape' && GW.Shape) { // vector shape layer (js/shape.js), rasterized like text
      const e = GW.Shape.draw(c, lt, lw, lh, lw / s.w);
      const tx = R.upload('sh:' + c.id, e.canvas, lw, lh, e.ver);
      const f = R.fbo(lw, lh); R.pass('copy', f, [tx.tex]); return f;
    }
    if (c.kind === 'map') {
      if (!GW.Atlas || !c.map || !c.map.scene || c.map.scene.v !== 3) return null;
      const fastM = !opts.exporting && GW.mapFast && performance.now() - GW.mapFast < 350;
      // stable preview: while paused, the same clip/time/size/scene gives back the same picture (re-renders only when the
      // scene changes or more tiles have arrived), so background work (proxies, thumbnails, GC) can never alter the frame
      const mk = opts.exporting || fastM ? null : [lt, lw, lh, GW.Atlas.Tiles ? GW.Atlas.Tiles.loaded : 0, GW.mapPreviewQ || .85, c.map.bg || '', JSON.stringify(c.map.scene)].join('|');
      const mc = RN._mapMemo || (RN._mapMemo = new Map()); const hit = mk && mc.get(c.id);
      let cv; if (hit && hit.k === mk) cv = hit.cv; else { try { cv = GW.Atlas.render(c.map.scene, lt + (c.in || 0), lw, lh, { bg: c.map.bg || 'full', dur: c.dur, quality: opts.exporting ? 1 : (GW.mapPreviewQ || 1), fast: fastM }); } catch (e) { console.error('map render', e); return null; }
        if (mk) { const keep = document.createElement('canvas'); keep.width = cv.width; keep.height = cv.height; keep.getContext('2d').drawImage(cv, 0, 0); mc.set(c.id, { k: mk, cv: keep }); if (mc.size > 6) mc.delete(mc.keys().next().value); } }
      const tx = R.upload('mp:' + c.id, cv, lw, lh, null);
      const f = R.fbo(lw, lh); R.pass('copy', f, [tx.tex]); return f;
    }
    if (c.kind === 'nest') {
      const sub = GW.prj.seqs.find(x => x.id === c.ref); if (!sub || sub === s || (opts.depth || 0) > 4) return null;
      const acc2 = RN.frame(sub, GW.srcTime(c, t), { ...opts, scale: lw / sub.w, depth: (opts.depth || 0) + 1 });
      const f = R.fbo(lw, lh); R.pass('copy', f, [acc2.tex]); R.free(acc2); return f;
    }
    const m = GW.media(c.media); if (!m || m.offline) return null;
    if (c.kind === 'image') {
      const r0 = GW.rt.m[m.id]; if (!r0 || !r0.img) return null;
      const tx = R.upload('i:' + m.id, r0.img, m.w, m.h, 1);
      const f = R.fbo(lw, lh); R.pass('copy', f, [tx.tex]); return f;
    }
    if (c.kind === 'video') {
      if (opts.exporting && GW.Media.ExportDec && GW.Media.ExportDec.on) { // frame already decoded by the export decoder (ffmpeg, sequential)
        const fr = GW.Media.ExportDec.ready.get(c.id + '@' + t);
        if (fr) { const f = R.fbo(lw, lh); R.yuvLayer('v:' + c.id, fr, f); return f; }
      }
      const el = GW.Media.vid(c); if (!el) return null;
      const fd = 1 / (m.fps || s.fps || 30);
      const st = GW.clamp(GW.srcTime(c, t), 0, Math.max(0, (m.dur || el.duration || 0) - fd * .5));
      if (!opts.exporting) {
        if (RN.playing && t >= c.start && t < c.start + c.dur) {
          el.playbackRate = GW.clamp(c.speed || 1, .0625, 16);
          if (el.paused) { if (Math.abs(el.currentTime - st) > .05) el.currentTime = st; el.play().catch(() => {}); }
          else if (Math.abs(el.currentTime - st) > .25) el.currentTime = st;
        } else {
          if (!el.paused) el.pause();
          if (!el.seeking && Math.abs(el.currentTime - st) > fd * .5) el.currentTime = st;
        }
      }
      if (el.readyState < 2) {
        if (!opts.exporting) { el._stuck = el._stuck || performance.now(); if (performance.now() - el._stuck > 4000) { GW.Media.dropVid(c.id); setTimeout(() => GW.invalidate(), 50); } else setTimeout(() => GW.invalidate(), 200); }
        return null;
      }
      el._stuck = 0;
      const tx = R.upload('v:' + c.id, el, m.w, m.h, RN.playing || opts.exporting ? null : el.currentTime + el.readyState * 1e7); // numeric version: no per-frame string
      const f = R.fbo(lw, lh); R.pass('copy', f, [tx.tex]); return f;
    }
    return null;
  }

  // full processing of one clip at time t → placed FBO (W×H) or null
  // source → effects → masks (layer px)
  function processLayer(s, c, t, lt, ls, r, acc, opts) {
    let layer = sourceLayer(s, c, t, lt, ls, r, acc, opts);
    if (!layer) return null;
    if (c.fx && c.fx.length) layer = R.applyEffects(layer, c.fx, lt, ls, c.id);
    if (c.masks && c.masks.some(m => m.on !== 0)) {
      const mt = R.maskTex(c.masks, lt, layer.w, layer.h, ls, c.id);
      const out = R.fbo(layer.w, layer.h); R.pass('mask', out, [layer.tex, mt]); R.free(layer); layer = out;
    }
    return layer;
  }
  /* ---- 3D layers / camera (see xform.js). FC = per-frame camera cache (frames nest for nested sequences) ---- */
  let FC = null;
  const frameCam = (s, t) => FC && FC.s === s && FC.t === t ? (FC.cam || (FC.cam = GW.X.camera(s, t))) : GW.X.camera(s, t);
  const layerCap = c => (c.kind === 'text' || c.kind === 'color' || c.kind === 'shape') ? 2 : c.kind === 'map' ? 1.5 : 1;
  function placed3D(s, c, t, r, W, H, acc, opts) {
    const X = GW.X, lt = t - c.start, cam = frameCam(s, t);
    const A = X.mul(cam.view, X.world(s, c, t, shakeFx(c, lt)));
    const sw = c.sw || s.w, sh = c.sh || s.h;
    const q = X.screenQuad(cam, s, A, sw, sh);
    if (q.behind === 4) return null; // entirely behind the camera
    const cap = layerCap(c);
    const ls = q.behind ? cap : Math.ceil(GW.clamp(r * q.es * 1.02, .05, cap) * 16) / 16;
    let layer = processLayer(s, c, t, lt, ls, r, acc, opts);
    if (!layer) return null;
    const op = GW.clamp(GW.pv(c.opacity, lt) / 100, 0, 1);
    let pad = 0;
    if (cam.dof && cam.blur > 0 && cam.aperture > 0) { // depth of field: per-layer gaussian from |depth − focus|
      const an = GW.pv(c.motion.anchor, lt); const p = X.apply(A, an[0], an[1], 0);
      if (p[2] > X.NEAR) {
        const coc = cam.aperture * cam.zoom * Math.abs(p[2] - cam.focus) / (p[2] * Math.max(1, cam.focus)) * cam.blur / 100; // blur circle, seq px
        const esOut = r * (q.es || cam.zoom / p[2]);
        const sig = coc * .5 * r * ls / Math.max(1e-3, esOut);
        if (sig > .3) {
          pad = Math.min(512, Math.ceil(sig * 3) + 2);
          const big = R.placeLayer(layer, [1, 0, 0, 0, 1, 0, pad, pad, 1], layer.w + 2 * pad, layer.h + 2 * pad, 1); R.free(layer);
          const bl = R.blurTex(big, sig, 'both', 0); if (bl !== big) R.free(big); layer = bl;
        }
      }
    }
    const M4 = X.clipMatrix(cam, s, X.mul(A, X.mul(X.S(1 / ls, 1 / ls, 1), X.T(-pad, -pad, 0))), r, W, H);
    const pl = R.placeLayer3(layer, M4, W, H, op); R.free(layer);
    return pl;
  }
  // order of video tracks when 3D layers exist: runs of consecutive 3D layers are depth-sorted far → near (AE)
  function order3D(s, t) {
    const X = GW.X, list = []; let cam = null;
    for (let ti = 0; ti < s.vt.length; ti++) {
      if (s.vt[ti].hide) continue; const it = RN.trackItems(s, 'v', ti, t); if (!it) continue;
      if (it.c && (it.c.kind === 'null' || it.c.kind === 'camera')) continue;
      const e = { ti, it, z: null };
      if (it.c && X.is3D(it.c)) { cam = cam || frameCam(s, t); const c = it.c; e.z = X.apply(X.mul(cam.view, X.world(s, c, t)), (c.sw || s.w) / 2, (c.sh || s.h) / 2, 0)[2]; }
      list.push(e);
    }
    for (let i = 0; i < list.length;) {
      if (list[i].z == null) { i++; continue; }
      let j = i; while (j < list.length && list[j].z != null) j++;
      const run = list.slice(i, j).map((e, k) => [e, k]).sort((a, b) => (Math.abs(b[0].z - a[0].z) > 1e-3 ? b[0].z - a[0].z : a[1] - b[1])).map(x => x[0]);
      list.splice(i, j - i, ...run); i = j;
    }
    return list;
  }

  RN.placedClip = (s, c, t, r, W, H, acc, opts) => {
    if (c.kind === 'null' || c.kind === 'camera') return null; // controllers render nothing
    if (GW.X && GW.X.is3D(c)) return placed3D(s, c, t, r, W, H, acc, opts);
    const lt = t - c.start;
    const par = c.parent && c.kind !== 'adjust' && GW.X ? GW.X.parentOf(s, c) : null;
    const Wm = par ? GW.X.world(s, c, t, shakeFx(c, lt)) : null;
    const ls = c.kind === 'adjust' ? r : RN.layerScale(c, lt, r, Wm ? Math.max(Math.hypot(Wm[0], Wm[1]), Math.hypot(Wm[4], Wm[5])) : undefined);
    const layer = processLayer(s, c, t, lt, ls, r, acc, opts);
    if (!layer) return null;
    const op = GW.clamp(GW.pv(c.opacity, lt) / 100, 0, 1);
    if (c.kind === 'adjust') {
      // adjustment layers keep frame geometry; motion still applies for masks/opacity feel
      const M = R.placeMatrix({ motion: { pos: { v: [s.w / 2, s.h / 2] }, anchor: { v: [s.w / 2, s.h / 2] }, scale: { v: 100 }, scaleW: { v: 100 }, uni: 1, rot: { v: 0 } } }, lt, r, r, null);
      const pl = R.placeLayer(layer, M, W, H, op); R.free(layer); return pl;
    }
    const M = Wm ? [r * Wm[0] / ls, r * Wm[1] / ls, 0, r * Wm[4] / ls, r * Wm[5] / ls, 0, r * Wm[12], r * Wm[13], 1] : R.placeMatrix(c, lt, ls, r, shakeFx(c, lt));
    const pl = R.placeLayer(layer, M, W, H, op); R.free(layer);
    return pl;
  };

  // render the sequence at time t → accumulated FBO (caller frees)
  RN.frame = (s, t, o = {}) => {
    const r = o.scale || 1, W = Math.max(2, Math.round(s.w * r / 2) * 2), H = Math.max(2, Math.round(s.h * r / 2) * 2);
    let acc = R.fbo(W, H); R.clear(acc);
    const prevFC = FC; FC = { s, t, cam: null };
    try {
    const ord = GW.X && GW.X.uses3D(s) ? order3D(s, t) : null;
    const nT = ord ? ord.length : s.vt.length;
    for (let k = 0; k < nT; k++) {
      let ti = k, it;
      if (ord) { ti = ord[k].ti; it = ord[k].it; }
      else { if (s.vt[ti].hide) continue; it = RN.trackItems(s, 'v', ti, t); if (!it) continue; }
      let placed = null, blend = 'normal';
      if (it.c) { placed = RN.placedClip(s, it.c, t, r, W, H, acc, o); blend = it.c.blend || 'normal'; }
      else {
        const a = it.A && it.A.on !== 0 ? RN.placedClip(s, it.A, t, r, W, H, acc, o) : null;
        const b = it.B && it.B.on !== 0 ? RN.placedClip(s, it.B, t, r, W, H, acc, o) : null;
        const ea = a || (() => { const f = R.fbo(W, H); R.clear(f); return f; })();
        const eb = b || (() => { const f = R.fbo(W, H); R.clear(f); return f; })();
        placed = R.transition(ea, eb, it.tr.kind, it.p); R.free(ea); R.free(eb);
        blend = (it.B || it.A).blend || 'normal';
      }
      if (!placed) continue;
      const out = R.blend(placed, acc, blend, 1); R.free(placed); R.free(acc); acc = out;
    }
    } finally { FC = prevFC; }
    return acc;
  };

  // which video elements are needed at t (for export pre-seeking)
  RN.neededVideos = (s, t, depth = 0, maps = null) => {
    const out = [];
    for (let ti = 0; ti < s.vt.length; ti++) {
      if (s.vt[ti].hide) continue;
      const it = RN.trackItems(s, 'v', ti, t); if (!it) continue;
      for (const c of [it.c, it.A, it.B]) {
        if (!c || c.on === 0) continue;
        if (c.kind === 'video') out.push({ c, t, s });
        else if (c.kind === 'map' && maps) maps.push({ c, t, s });
        else if (c.kind === 'nest' && depth < 4) { const sub = GW.prj.seqs.find(x => x.id === c.ref); if (sub && sub !== s) out.push(...RN.neededVideos(sub, GW.srcTime(c, t), depth + 1, maps)); }
      }
    }
    return out;
  };
  RN.prepareExportFrame = async (s, t, r = 1) => {
    if (GW.LUT) await GW.LUT.ready(); // .cube data parsed before the frame renders (export = preview)
    const maps = []; const cs = RN.neededVideos(s, t, 0, maps);
    for (const { c, t: tt, s: ss } of maps) {
      if (!GW.Atlas || !c.map || !c.map.scene || c.map.scene.v !== 3) continue;
      const lt = tt - c.start; const ls = RN.layerScale(c, lt, r * (ss === s ? 1 : 1)); const lw = Math.max(2, Math.round((c.sw || ss.w) * ls)), lh = Math.max(2, Math.round((c.sh || ss.h) * ls));
      try { await GW.Atlas.ensure(c.map.scene, lt + (c.in || 0), lw, lh, { bg: c.map.bg || 'full', dur: c.dur, timeout: 20000 }); } catch (e) { console.warn('map ensure', e); }
    }
    const ED = GW.Media.ExportDec;
    if (ED && ED.on) { ED.ready.clear(); const ids = new Set(); for (const x of cs) ids.add(x.c.id); ED.retain(ids); }
    await Promise.all(cs.map(async ({ c, t, s }) => {
      const m = GW.media(c.media); if (!m) return;
      if (ED && ED.eligible(c, m)) {
        const fd = 1 / (m.fps || s.fps || 30);
        const st = GW.clamp(GW.srcTime(c, t), 0, Math.max(0, (m.dur || 0) - fd * .5));
        try { const fr = await ED.frame(c, m, st); if (fr) { ED.ready.set(c.id + '@' + t, fr); ED.stats.ff++; return; } } catch (e) { console.warn('export decoder', e); }
        ED.stats.el++;
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const el = GW.Media.vid(c); if (!el) return;
        await GW.Media.waitReady(el);
        const fd = 1 / (m.fps || s.fps || 30);
        const st = GW.clamp(GW.srcTime(c, t), 0, Math.max(0, (m.dur || el.duration) - fd * .5));
        if (!el.paused) el.pause();
        await GW.Media.seekExact(el, st + 1e-4);
        if (el.readyState >= 2 && Math.abs(el.currentTime - st) < fd) return;
        GW.Media.dropVid(c.id); // decoder got stuck: start a fresh element
      }
    }));
  };
})();
