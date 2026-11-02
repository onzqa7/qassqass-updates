'use strict';
/* تتبّع الحركة — point tracker in the Program monitor.
   Frames: the clip source is seeked frame by frame in a private <video> (same frame the preview shows at that time),
   drawn grey at reduced size. Matching: normalized cross-correlation of the feature template inside the search region
   (around a velocity prediction), sub-pixel parabola refinement, a second template from the previous frame when the
   reference match weakens; the per-frame score is the confidence. Points are stored on the clip in source px keyed by
   source time (c.track = {feat, search, pts:[[srcT, x, y, conf]…]}) so they survive trims and splits.
   Results → position keys on the clip itself (stabilize, inverted), on another layer (follow), a mask's path/centre
   offset, or a new tracked mosaic / blur adjustment layer (quick action «تمويه وجه/لوحة متتبَّع»).
   Exposed as GW.Track and GW.API.methods.trackPoint. */
(function () {
  const { esc, clamp } = GW;
  const T = GW.Track = { st: null };
  const S = () => GW.seq();
  const fail = (m) => { throw new Error(m); };

  /* ================= frames ================= */
  // grey frames of clip c at reduced size; frame(i) = clip-local sequence frame i (what the preview shows at c.start + i/fps)
  async function grabber(c) {
    const m = GW.media(c.media); if (!m || m.offline) fail('ملف المقطع غير متاح');
    const el = document.createElement('video'); el.crossOrigin = 'anonymous'; el.muted = true; el.preload = 'auto'; el.playsInline = true;
    el.src = GW.Media.url(m); const bin = GW.$('#vbin') || document.body; bin.append(el);
    await GW.Media.waitReady(el); if (el.readyState < 2) { el.remove(); fail('تعذر فك ترميز الفيديو للتتبع'); }
    const sw = c.sw || m.w || el.videoWidth, sh = c.sh || m.h || el.videoHeight;
    const k = Math.min(1, 640 / Math.max(1, sw)); const W = Math.max(16, Math.round(sw * k)), H = Math.max(16, Math.round(sh * k));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
    const fps = S().fps || 30, sp = c.speed || 1, fd = 1 / (m.fps || fps);
    return {
      W, H, k, sw, sh, fps, cv, // cv holds the last decoded frame in colour (face / object detection, track_ai.js)
      srcT: (i) => clamp(c.in + i / fps * sp, 0, Math.max(0, (m.dur || el.duration || 0) - fd * .5)),
      async frame(i) {
        const t = this.srcT(i) + 1e-4;
        if (!this._seeked) { this._seeked = 1; if (Math.abs(el.currentTime - t) < 1e-3) { el.currentTime = t + .002; await new Promise(r => { el.addEventListener('seeked', r, { once: true }); setTimeout(r, 1500); }); } } // a fresh element may not have painted its first frame
        await GW.Media.seekExact(el, t);
        g.drawImage(el, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data; const G = new Float32Array(W * H);
        for (let p = 0, q = 0; p < G.length; p++, q += 4) G[p] = d[q] * .299 + d[q + 1] * .587 + d[q + 2] * .114;
        return G;
      },
      close() { try { el.pause(); el.removeAttribute('src'); el.load(); el.remove(); } catch (e) {} }
    };
  }

  /* ================= normalized cross-correlation ================= */
  // template centred at (cx, cy) grey px; null when it does not fit in the frame
  function template(G, W, H, cx, cy, tw, th) {
    const x0 = Math.round(cx - tw / 2), y0 = Math.round(cy - th / 2);
    if (x0 < 0 || y0 < 0 || x0 + tw > W || y0 + th > H) return null;
    const n = tw * th, d = new Float32Array(n); let s = 0;
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) { const v = G[(y0 + j) * W + x0 + i]; d[j * tw + i] = v; s += v; }
    const mu = s / n; let n2 = 0; for (let i = 0; i < n; i++) { d[i] -= mu; n2 += d[i] * d[i]; }
    return { d, tw, th, n, n2, ox: cx - (x0 + tw / 2), oy: cy - (y0 + th / 2) };
  }
  // NCC of template Tp with the window whose top-left is (x0, y0); -2 outside the frame
  function nccAt(G, W, H, Tp, x0, y0) {
    const { d, tw, th, n, n2 } = Tp; if (x0 < 0 || y0 < 0 || x0 + tw > W || y0 + th > H) return -2;
    let s = 0, s2 = 0, cr = 0;
    for (let v = 0; v < th; v++) { let o = (y0 + v) * W + x0, t = v * tw; for (let u = 0; u < tw; u++, o++, t++) { const g = G[o]; s += g; s2 += g * g; cr += g * d[t]; } }
    const vg = s2 - s * s / n; return vg > 1e-3 ? cr / Math.sqrt(vg * n2) : 0;
  }
  // best match of Tp for a feature centre predicted at (px, py) grey px, searching ±rx/±ry: coarse grid (step 2) → refine the
  // three best cells at full resolution → sub-pixel parabola. Returns {x, y (centre, grey px), score}
  T.ncc = function match(G, W, H, Tp, px, py, rx, ry) {
    if (!Tp || Tp.n2 < 1e-3) return null; // flat template: nothing to lock on
    const bx = Math.round(px - Tp.ox - Tp.tw / 2), by = Math.round(py - Tp.oy - Tp.th / 2);
    const step = rx > 5 || ry > 5 ? 2 : 1; const top = [];
    for (let dy = -ry; dy <= ry; dy += step) for (let dx = -rx; dx <= rx; dx += step) {
      const r = nccAt(G, W, H, Tp, bx + dx, by + dy); if (r <= -2) continue;
      if (top.length < 3 || r > top[top.length - 1][0]) { top.push([r, dx, dy]); top.sort((a, b) => b[0] - a[0]); if (top.length > 3) top.pop(); }
    }
    if (!top.length) return null;
    let best = top[0][0], bi = top[0][1], bj = top[0][2]; const seen = new Map(); const at = (dx, dy) => { const k = dx * 4096 + dy; if (!seen.has(k)) seen.set(k, nccAt(G, W, H, Tp, bx + dx, by + dy)); return seen.get(k); };
    if (step > 1) for (const [, cx, cy] of top) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const r = at(cx + dx, cy + dy); if (r > best) { best = r; bi = cx + dx; bj = cy + dy; } }
    const para = (a, b, c) => { const den = a - 2 * b + c; return den < 0 ? clamp(.5 * (a - c) / den, -.5, .5) : 0; };
    const l = at(bi - 1, bj), r = at(bi + 1, bj), u = at(bi, bj - 1), dn = at(bi, bj + 1);
    const fx = l > -2 && r > -2 ? para(l, best, r) : 0, fy = u > -2 && dn > -2 ? para(u, best, dn) : 0;
    return { x: bx + bi + fx + Tp.tw / 2 + Tp.ox, y: by + bj + fy + Tp.th / 2 + Tp.oy, score: best };
  };

  /* ================= track data on the clip ================= */
  const fpsOf = () => S().fps || 30;
  const ltOf = (c, srcT) => (srcT - c.in) / (c.speed || 1);
  const srcOf = (c, lt) => c.in + lt * (c.speed || 1);
  T.data = (c, create) => { if (!c.track && create) c.track = { feat: [80, 80], search: [220, 220], pts: [] }; return c.track || null; };
  const near = (tr, srcT, c) => { if (!tr) return null; const tol = .5 / fpsOf() * (c.speed || 1); let b = null, bd = tol; for (const p of tr.pts) { const d = Math.abs(p[0] - srcT); if (d <= bd) { bd = d; b = p; } } return b; };
  function setPt(tr, srcT, x, y, conf, c) {
    const e = near(tr, srcT, c); const v = [Math.round(srcT * 1e5) / 1e5, Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(conf * 1000) / 1000];
    if (e) { e[0] = v[0]; e[1] = v[1]; e[2] = v[2]; e[3] = v[3]; } else { tr.pts.push(v); tr.pts.sort((a, b) => a[0] - b[0]); }
  }
  T.pointAt = (c, t) => near(c.track, srcOf(c, t - c.start), c);

  /* ================= tracker ================= */
  // track from the playhead (or o.t) forward/backward; o: {at:[x,y] source px, feat, search, dir:1|-1, max (frames), to (seq time), minConf, onP(i, n, conf), ctl:{cancel}}
  T.run = async (c, o = {}) => {
    if (!c || c.kind !== 'video') fail('التتبع يحتاج مقطع فيديو');
    const s = S(), fps = fpsOf(), tr = T.data(c, true);
    if (o.feat) tr.feat = o.feat.map(Number); if (o.search) tr.search = o.search.map(Number);
    tr.search = [Math.max(tr.search[0], tr.feat[0] + 8), Math.max(tr.search[1], tr.feat[1] + 8)];
    const nF = Math.max(1, Math.floor(c.dur * fps + 1e-6)); const dir = o.dir < 0 ? -1 : 1;
    let i = clamp(Math.round(((o.t != null ? o.t : s.t) - c.start) * fps), 0, nF - 1);
    let iEnd = dir > 0 ? nF - 1 : 0; if (o.to != null) iEnd = clamp(Math.round((o.to - c.start) * fps), 0, nF - 1);
    if (o.max) iEnd = dir > 0 ? Math.min(iEnd, i + o.max) : Math.max(iEnd, i - o.max);
    const G0 = await grabber(c); const k = G0.k; const minConf = o.minConf ?? .3;
    const out = { frames: 0, lost: false, cancelled: false, from: c.start + i / fps, to: c.start + i / fps };
    try {
      const st0 = G0.srcT(i); const p0 = near(tr, st0, c);
      let P = o.at ? [+o.at[0], +o.at[1]] : p0 ? [p0[1], p0[2]] : (tr.at || [G0.sw / 2, G0.sh / 2]);
      tr.at = P.slice(); setPt(tr, st0, P[0], P[1], p0 && !o.at ? p0[3] : 1, c);
      const tw = Math.max(5, Math.round(tr.feat[0] * k)), th = Math.max(5, Math.round(tr.feat[1] * k));
      const rx = Math.max(2, Math.round((tr.search[0] - tr.feat[0]) / 2 * k)), ry = Math.max(2, Math.round((tr.search[1] - tr.feat[1]) / 2 * k));
      let F = await G0.frame(i); const ref = template(F, G0.W, G0.H, P[0] * k, P[1] * k, tw, th);
      if (!ref || ref.n2 < 1e-3) fail('منطقة الميزة خارج الإطار أو بلا تفاصيل — اختر منطقة ذات تباين');
      let prevT = ref, vel = [0, 0]; const total = Math.abs(iEnd - i);
      while (i !== iEnd) {
        if (o.ctl && o.ctl.cancel) { out.cancelled = true; break; }
        i += dir; F = await G0.frame(i);
        const px = P[0] * k + vel[0], py = P[1] * k + vel[1];
        let m = T.ncc(F, G0.W, G0.H, ref, px, py, rx, ry);
        if ((!m || m.score < .85) && prevT !== ref) { // appearance changed: follow the previous frame's template,
          const m2 = T.ncc(F, G0.W, G0.H, prevT, px, py, rx, ry);
          if (m2 && (!m || m2.score > m.score)) { // …then pull back onto the reference template near it (no accumulated drift)
            const mr = T.ncc(F, G0.W, G0.H, ref, m2.x, m2.y, 2, 2);
            m = mr && mr.score >= .6 ? { x: mr.x, y: mr.y, score: Math.max(mr.score, Math.min(m2.score, .99)) } : m2;
          }
        }
        if (!m || m.score < minConf) { out.lost = true; if (m) setPt(tr, G0.srcT(i), m.x / k, m.y / k, Math.max(0, m.score), c); break; }
        const nP = [m.x / k, m.y / k]; vel = [(nP[0] - P[0]) * k * .7, (nP[1] - P[1]) * k * .7]; P = nP;
        setPt(tr, G0.srcT(i), P[0], P[1], m.score, c); out.frames++; out.to = c.start + i / fps;
        if (m.score >= .6) prevT = template(F, G0.W, G0.H, m.x, m.y, tw, th) || prevT;
        if (o.onP) o.onP(out.frames, total, m.score, c.start + i / fps);
        if (out.frames % 4 === 0) await new Promise(r => setTimeout(r, 0)); // keep the UI responsive
      }
      tr.at = P.slice();
    } finally { G0.close(); }
    return out;
  };

  /* ================= geometry helpers ================= */
  const xformed = (s, c) => !!(GW.X && c.motion && (GW.X.is3D(c) || (c.parent && GW.X.parentOf(s, c))));
  // clip source px → sequence px at sequence time t
  function toSeq(s, c, t, x, y) {
    if (c.kind === 'adjust') return [x, y];
    if (xformed(s, c)) return GW.X.layerMap(s, c, t).fw(x, y).slice(0, 2);
    const M = GW.R.placeMatrix(c, t - c.start, 1, 1, null); return [M[0] * x + M[3] * y + M[6], M[1] * x + M[4] * y + M[7]];
  }
  function fromSeq(s, c, t, X, Y) {
    if (c.kind === 'adjust') return [X, Y];
    if (xformed(s, c)) return GW.X.layerMap(s, c, t).inv(X, Y);
    const M = GW.R.placeMatrix(c, t - c.start, 1, 1, null); const a = M[0], b = M[1], cc = M[3], d = M[4], det = a * d - b * cc; const x = X - M[6], y = Y - M[7];
    return [(d * x - cc * y) / det, (-b * x + a * y) / det];
  }
  // tracked samples of c as [{t: seq time, lt, x, y, conf}] inside the clip
  function samples(c) {
    const tr = c.track; if (!tr || !tr.pts.length) return [];
    return tr.pts.map(p => { const lt = ltOf(c, p[0]); return { lt: Math.round(lt * fpsOf()) / fpsOf(), t: 0, x: p[1], y: p[2], conf: p[3] }; })
      .filter(p => p.lt >= -1e-6 && p.lt <= c.dur + 1e-6).map(p => (p.t = c.start + p.lt, p));
  }
  // replace the keys of p inside [a, b] (clip-local) by the given list
  function putKeys(p, keys, a, b) {
    const old = (p.k || []).filter(k => k.t < a - 1e-4 || k.t > b + 1e-4);
    p.k = old.concat(keys.map(k => ({ t: k.t, v: k.v, e: 'linear' }))).sort((x, y) => x.t - y.t);
    if (!p.k.length) delete p.k;
  }
  function refSample(c, list, tRef) {
    if (tRef != null) { const r = list.find(p => Math.abs(p.t - tRef) < .5 / fpsOf()); if (r) return r; }
    return list[0];
  }
  function freeTrack(s, t0, t1, above) {
    for (let ti = above + 1; ti < s.vt.length; ti++) if (!s.vt[ti].lock && !s.clips.some(x => x.tt === 'v' && x.ti === ti && x.start < t1 - 1e-6 && x.start + x.dur > t0 + 1e-6)) return ti;
    GW.ops.ensureTrack(s, 'v', s.vt.length); return s.vt.length - 1;
  }

  /* ================= apply ================= */
  // target: 'self' | 'layer:<clipId>' | 'mask:<clipId>:<maskId>' | 'mosaic' | 'blur'
  T.apply = (c, target, o = {}) => {
    const s = S(); const list = samples(c); if (list.length < 2) fail('لا توجد بيانات تتبع كافية — تتبّع للأمام أو للخلف أولًا');
    const R0 = refSample(c, list, o.tRef != null ? o.tRef : s.t);
    const feat0 = toSeq(s, c, R0.t, R0.x, R0.y); const seqOf = p => toSeq(s, c, p.t, p.x, p.y);
    const a = list[0].lt, b = list[list.length - 1].lt; let res = { target, keys: list.length };
    const [kind, id, mid] = String(target || 'self').split(':');
    if (kind === 'self') {
      // inverse motion: keep the feature where it is at the reference frame
      const lt0 = R0.lt, pos0 = GW.clone(GW.pv(c.motion.pos, lt0)); const M = GW.R.placeMatrix(c, lt0, 1, 1, null);
      const keys = list.map(p => { const dx = p.x - R0.x, dy = p.y - R0.y; return { t: p.lt, v: [Math.round((pos0[0] - (M[0] * dx + M[3] * dy)) * 100) / 100, Math.round((pos0[1] - (M[1] * dx + M[4] * dy)) * 100) / 100] }; });
      putKeys(c.motion.pos, keys, a, b); res.clip = c.id; GW.commit('تثبيت بالتتبع');
    } else if (kind === 'layer') {
      const L = GW.clipById(id, s); if (!L || L.tt !== 'v' || !L.motion) fail('الطبقة الهدف غير موجودة');
      if (L.kind === 'adjust') { if (!(L.masks || []).length) fail('طبقة الضبط بلا أقنعة'); for (const mk of L.masks) maskFollow(s, c, list, R0, feat0, L, mk); res.clip = L.id; GW.commit('تتبع: أقنعة طبقة الضبط'); }
      else {
        const in1 = list.filter(p => p.t >= L.start - 1e-6 && p.t <= L.start + L.dur + 1e-6); if (!in1.length) fail('الطبقة الهدف لا تتقاطع زمنيًا مع التتبع');
        const pos0 = GW.clone(GW.pv(L.motion.pos, clamp(R0.t - L.start, 0, L.dur)));
        const keys = in1.map(p => { const q = seqOf(p); return { t: Math.round((p.t - L.start) * fpsOf()) / fpsOf(), v: [Math.round((pos0[0] + q[0] - feat0[0]) * 100) / 100, Math.round((pos0[1] + q[1] - feat0[1]) * 100) / 100] }; });
        putKeys(L.motion.pos, keys, keys[0].t, keys[keys.length - 1].t); res.clip = L.id; GW.commit('تتبع: ' + L.name);
      }
    } else if (kind === 'mask') {
      const Mc = GW.clipById(id, s); const mk = Mc && (Mc.masks || []).find(x => x.id === mid); if (!mk) fail('القناع غير موجود');
      maskFollow(s, c, list, R0, feat0, Mc, mk); res.clip = Mc.id; res.mask = mk.id; GW.commit('تتبع القناع');
    } else if (kind === 'mosaic' || kind === 'blur') {
      const t0 = list[0].t, t1 = Math.min(c.start + c.dur, list[list.length - 1].t + 1 / fpsOf());
      const ti = freeTrack(s, t0, t1, c.ti);
      const A = GW.newClip('adjust', { ti, start: t0, dur: Math.max(1 / fpsOf(), t1 - t0), name: kind === 'mosaic' ? 'تمويه متتبَّع' : 'ضبابية متتبَّعة' });
      const f = GW.newFx(kind === 'mosaic' ? 'pixelate' : 'gblur'); if (kind === 'mosaic') f.params.size = GW.P(o.size || 18); else f.params.amount = GW.P(o.size || 40); A.fx.push(f);
      // mask size: the feature box in sequence px, padded; wide boxes (plates) → rectangle, others (faces) → ellipse
      const tr = c.track, M = GW.R.placeMatrix(c, R0.lt, 1, 1, null); const sx = Math.hypot(M[0], M[1]), sy = Math.hypot(M[3], M[4]);
      const w = tr.feat[0] * sx * (o.pad || 1.5), h = tr.feat[1] * sy * (o.pad || 1.5); const plate = tr.feat[0] > tr.feat[1] * 1.6;
      const mk = { id: GW.uid(), type: o.shape || (plate ? 'rect' : 'ellipse'), on: 1, mode: 'add', inv: 0, feather: GW.P(plate ? 6 : 14), opacity: GW.P(100), expansion: GW.P(0), center: GW.P(feat0.slice()), size: GW.P([Math.round(w), Math.round(h)]), rot: GW.P(0) };
      A.masks.push(mk); s.clips.push(A); maskFollow(s, c, list, R0, feat0, A, mk);
      GW.sel.clips.clear(); GW.sel.clips.add(A.id); res.clip = A.id; res.mask = mk.id; GW.commit(kind === 'mosaic' ? 'تمويه وجه/لوحة متتبَّع' : 'ضبابية متتبَّعة'); GW.bus.emit('selection');
    } else fail('هدف غير معروف: ' + target);
    GW.invalidate(); if (GW.FXC && GW.FXC.render) try { GW.FXC.render(); } catch (e) {}
    return res;
  };
  // mask on clip Mc follows the tracked feature (offset from the reference frame, in Mc's source px)
  function maskFollow(s, c, list, R0, feat0, Mc, mk) {
    const in1 = list.filter(p => p.t >= Mc.start - 1e-6 && p.t <= Mc.start + Mc.dur + 1e-6); if (!in1.length) fail('القناع لا يتقاطع زمنيًا مع التتبع');
    const tR = clamp(R0.t, Mc.start, Mc.start + Mc.dur), ltR = tR - Mc.start, q0 = fromSeq(s, Mc, tR, feat0[0], feat0[1]);
    const P = mk.type === 'path' ? mk.pts : mk.center; const base = GW.clone(GW.pv(P, ltR));
    const r2 = v => Math.round(v * 100) / 100;
    const keys = in1.map(p => { const q = toSeq(s, c, p.t, p.x, p.y); const qq = fromSeq(s, Mc, p.t, q[0], q[1]); const dx = qq[0] - q0[0], dy = qq[1] - q0[1];
      return { t: Math.round((p.t - Mc.start) * fpsOf()) / fpsOf(), v: mk.type === 'path' ? base.map(pt => [r2(pt[0] + dx), r2(pt[1] + dy)]) : [r2(base[0] + dx), r2(base[1] + dy)] }; });
    putKeys(P, keys, keys[0].t, keys[keys.length - 1].t);
  }

  /* ================= Program-monitor tracker session ================= */
  const st0 = document.createElement('style');
  st0.textContent = `.trk-bar{position:absolute;top:6px;left:6px;right:6px;z-index:5;display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;padding:5px 7px;background:rgba(20,20,22,.92);border:1px solid var(--line2,#333);border-radius:5px;font-size:11.5px;color:var(--text,#ddd)}
  .trk-bar .ttl{display:inline-flex;gap:5px;align-items:center;font-weight:600;color:var(--accent)}.trk-bar .btn.sm{display:inline-flex;align-items:center;gap:4px}
  .trk-bar .tb{width:26px;height:24px;display:inline-flex;align-items:center;justify-content:center}.trk-bar .tb.on{color:var(--accent)}
  .trk-bar .trk-st{color:var(--text2,#aaa);min-width:120px}.trk-bar canvas{direction:ltr;width:150px;height:18px;background:#111;border:1px solid var(--line2,#333);border-radius:2px;cursor:pointer}
  .trk-bar select{max-width:210px}.trk-bar .grow{flex:1}`;
  document.head.append(st0);
  T.active = () => !!(T.st && GW.Program && GW.Program.el && GW.Program.el.isConnected);
  T.sourceFor = (c) => { // the video a mask / layer should be tracked on
    const s = S(); if (c && c.kind === 'video') return c;
    return s.clips.filter(x => x.kind === 'video' && x.on !== 0 && x.start <= s.t + 1e-6 && x.start + x.dur > s.t && (!c || x.ti <= c.ti)).sort((a, b) => b.ti - a.ti)[0] || null;
  };
  T.targets = (c) => {
    const s = S(); const o = [['self', 'تثبيت المقطع (عكس الحركة)']];
    for (const x of s.clips) if (x.tt === 'v' && x !== c && x.motion && x.kind !== 'camera' && x.kind !== 'adjust' && x.start < c.start + c.dur && x.start + x.dur > c.start) o.push(['layer:' + x.id, 'طبقة: V' + (x.ti + 1) + ' · ' + x.name]);
    for (const x of s.clips) for (const mk of (x.masks || [])) if (x.start < c.start + c.dur && x.start + x.dur > c.start) o.push(['mask:' + x.id + ':' + mk.id, 'قناع: ' + x.name + ' (' + (x.masks.indexOf(mk) + 1) + ')']);
    o.push(['mosaic', 'تمويه موزاييك متتبَّع (طبقة جديدة)'], ['blur', 'ضبابية متتبَّعة (طبقة جديدة)']);
    return o;
  };
  T.open = (c, o = {}) => {
    if (!c || c.kind !== 'video') { const v = T.sourceFor(c); if (!v) { GW.toast('حدد مقطع فيديو للتتبع'); return; } c = v; }
    if (!GW.isShown('program')) GW.showPanel('program');
    T.close(true);
    const s = S(); if (s.t < c.start || s.t >= c.start + c.dur) GW.seek(c.start);
    const tr = T.data(c, true); if (!tr.at) tr.at = [c.sw / 2, c.sh / 2];
    T.st = { cid: c.id, target: o.target || 'self', ctl: null, msg: '', mode: o.mode || 'point' };
    GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.sel.mask = null; GW.bus.emit('selection');
    bar(); GW.invalidate();
    GW.toast(o.hint || 'ضع مربع التتبع على ميزة واضحة (اسحبه أو انقر عليها)، ثم اضغط «تتبع للأمام»');
  };
  T.close = (quiet) => { if (T.st && T.st.ctl) T.st.ctl.cancel = true; T.st = null; const b = document.querySelector('.trk-bar'); if (b) b.remove(); if (!quiet) GW.invalidate(); };
  const clipOf = () => T.st && GW.clipById(T.st.cid);
  function bar() {
    const view = GW.Program.view; if (!view) return; let b = view.querySelector('.trk-bar'); if (b) b.remove();
    const c = clipOf(); if (!c) return;
    b = document.createElement('div'); b.className = 'trk-bar'; b.dir = 'rtl';
    const I = (n) => GW.ico(n, 15);
    b.innerHTML = `<span class="ttl">${I('track')}تتبع الحركة</span>
      <select class="sel" data-a="mode" title="نوع التتبع"><option value="point">نقطة (دقيق)</option><option value="face">وجه تلقائي</option><option value="box">شخص / جسم</option></select>
      <button class="tb" data-a="bk" title="تتبع للخلف">${I('trackb')}</button><button class="tb" data-a="b1" title="إطار واحد للخلف">${I('step1b')}</button>
      <button class="tb" data-a="f1" title="إطار واحد للأمام">${I('step1f')}</button><button class="tb" data-a="fw" title="تتبع للأمام">${I('trackf')}</button>
      <button class="tb" data-a="stop" title="إيقاف التتبع" disabled>${I('stop')}</button>
      <span class="trk-st" data-a="st"></span><canvas data-a="conf" title="الثقة لكل إطار (انقر للانتقال)"></canvas><span class="grow"></span>
      <select class="sel" data-a="target" title="تطبيق التتبع على"></select>
      <button class="btn sm pri" data-a="apply">${I('check', 13)}تطبيق</button><button class="btn sm" data-a="clear" title="مسح بيانات التتبع">مسح التتبع</button><button class="tb" data-a="close" title="إغلاق المتتبع">${I('close')}</button>`;
    view.append(b);
    const q = a => b.querySelector(`[data-a=${a}]`);
    const sel = q('target'); for (const [v, n] of T.targets(c)) { const op = document.createElement('option'); op.value = v; op.textContent = n; sel.append(op); }
    { const tg = T.targets(c); const want = T.st.target === 'layerS' ? (tg.find(x => x[0].startsWith('layerS:')) || ['reframe'])[0] : T.st.target; sel.value = tg.some(x => x[0] === want) ? want : 'self'; T.st.target = sel.value; } sel.onchange = () => { T.st.target = sel.value; };
    const md = q('mode'); md.value = T.st.mode || 'point'; md.onchange = () => { T.st.mode = md.value; const tr = T.data(c, true); if (md.value === 'box' && tr.feat[0] < 120) { tr.feat = [Math.round((c.sw || S().w) * .22), Math.round((c.sh || S().h) * .6)]; } GW.toast(md.value === 'face' ? 'انقر على الوجه الذي تريد تتبعه، ثم اضغط «تتبع للأمام»' : md.value === 'box' ? 'اسحب زوايا المربع ليحيط بالشخص أو الجسم كاملاً، ثم «تتبع للأمام»' : 'ضع المربع على ميزة واضحة ثم «تتبع للأمام»'); GW.invalidate(); };
    q('fw').onclick = () => go(1); q('bk').onclick = () => go(-1); q('f1').onclick = () => go(1, 1); q('b1').onclick = () => go(-1, 1);
    q('stop').onclick = () => { if (T.st && T.st.ctl) T.st.ctl.cancel = true; };
    q('close').onclick = () => T.close();
    q('clear').onclick = () => { const c2 = clipOf(); if (c2 && c2.track) { c2.track.pts = []; c2.track.sz = []; GW.commit('مسح بيانات التتبع'); } T.st.msg = ''; upd(); GW.invalidate(); };
    q('apply').onclick = () => { const c2 = clipOf(); try { const r = T.apply(c2, T.st.target); GW.toast('تم تطبيق التتبع · المفاتيح: ' + r.keys); if (/^(mosaic|blur)$/.test(T.st.target)) T.close(); else bar(); } catch (e) { GW.toast(e.message, 'err'); } };
    const cv = q('conf'); cv.onpointerdown = (e) => { const r = cv.getBoundingClientRect(); const c2 = clipOf(); if (c2) GW.seek(c2.start + clamp((e.clientX - r.left) / r.width, 0, 1) * c2.dur); };
    upd();
  }
  function upd() {
    const b = document.querySelector('.trk-bar'); const c = clipOf(); if (!b || !c) return;
    const busy = !!(T.st.ctl && !T.st.ctl.done);
    for (const a of ['fw', 'bk', 'f1', 'b1', 'apply', 'clear', 'target', 'mode']) b.querySelector(`[data-a=${a}]`).disabled = busy;
    b.querySelector('[data-a=stop]').disabled = !busy;
    const p = T.pointAt(c, S().t); const n = c.track ? c.track.pts.length : 0;
    b.querySelector('[data-a=st]').textContent = T.st.msg || (n ? 'إطارات متتبَّعة: ' + n + (p ? ' · الثقة: ' + p[3].toFixed(2) : '') : 'لا توجد بيانات تتبع');
    const cv = b.querySelector('[data-a=conf]'); const w = cv.width = 150, h = cv.height = 18; const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
    if (c.track) for (const q of c.track.pts) { const lt = ltOf(c, q[0]); if (lt < 0 || lt > c.dur) continue; const x = lt / c.dur * w; const cf = clamp(q[3], 0, 1); g.fillStyle = cf > .8 ? '#3fae8f' : cf > .5 ? '#d6c04a' : '#e5484d'; g.fillRect(x - 1, h - cf * h, Math.max(1, w / Math.max(1, c.dur * fpsOf())), cf * h); }
    const ph = (S().t - c.start) / c.dur * w; g.fillStyle = '#5aa9ff'; g.fillRect(ph - 1, 0, 2, h);
  }
  async function go(dir, max) {
    const c = clipOf(); if (!c || (T.st.ctl && !T.st.ctl.done)) return;
    const ctl = T.st.ctl = { cancel: false, done: false }; upd();
    const t0 = performance.now();
    try {
      const runner = T.st.mode === 'face' ? T.runFace : T.st.mode === 'box' ? T.runBox : T.run;
      if (T.st.mode === 'face' && dir && !max) { const tr = c.track; const pp = T.pointAt(c, S().t); tr.pick = pp ? [pp[1], pp[2]] : tr.at; }
      const r = await runner(c, { dir, max, ctl, onP: (n, tot, cf, t) => { T.st.msg = 'تتبع: ' + n + '/' + tot + ' · الثقة: ' + cf.toFixed(2); if (n % 8 === 0 || n === tot) GW.seek(t); else { GW.Mon.redraw(); } upd(); } });
      GW.seek(dir > 0 ? r.to : r.to);
      T.st.msg = (r.cancelled ? 'أُوقف التتبع' : r.lost ? 'فُقد الهدف' : 'اكتمل التتبع') + ' · الإطارات: ' + r.frames; void t0;
      GW.commit('تتبع الحركة');
      if (r.lost) GW.toast('فُقدت الميزة (ثقة منخفضة) — صحّح موضع المربع وتابع التتبع');
    } catch (e) { T.st && (T.st.msg = ''); GW.toast(e.message, 'err'); }
    finally { ctl.done = true; if (T.st) upd(); GW.invalidate(); }
  }
  GW.bus.on('time', () => { if (T.st) upd(); });
  GW.bus.on('hist', () => { if (T.st && !clipOf()) T.close(); else if (T.st) upd(); });

  /* ---------- overlay: feature box (solid), search box (dashed), path, confidence ---------- */
  function boxState(c) {
    const s = S(); const tr = T.data(c, true); const p = T.pointAt(c, s.t);
    return { tr, ctr: p ? [p[1], p[2]] : tr.at, conf: p ? p[3] : null, lt: s.t - c.start };
  }
  T.overlay = (g) => {
    const c = clipOf(); if (!c) return; const s = S(); if (s.t < c.start || s.t >= c.start + c.dur) return;
    const B = boxState(c); const mp = GW.Mon.mapper(c, B.lt); const [x, y] = B.ctr, tr = B.tr;
    const ai = T.st && T.st.mode && T.st.mode !== 'point'; const zz = ai && T.sizeAt ? T.sizeAt(c, s.t) : null; const fw = zz ? zz[1] : tr.feat[0], fh = zz ? zz[2] : tr.feat[1];
    const quad = (w, h) => [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]].map(p => mp(p[0], p[1]));
    const poly = (P) => { g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke(); };
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff6a2b';
    // track path (source px through the current transform)
    if (tr.pts.length > 1) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); tr.pts.forEach((p, i) => { const q = mp(p[1], p[2]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
      for (const p of tr.pts) { const q = mp(p[1], p[2]); g.fillStyle = p[3] > .8 ? '#3fae8f' : p[3] > .5 ? '#d6c04a' : '#e5484d'; g.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3); } }
    g.setLineDash([5, 4]); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1; const SQ = ai ? [] : quad(tr.search[0], tr.search[1]); if (!ai) poly(SQ); g.setLineDash([]);
    g.strokeStyle = acc; g.lineWidth = 2; const FQ = quad(fw, fh); poly(FQ);
    const ctr = mp(x, y); g.lineWidth = 1; g.beginPath(); g.moveTo(ctr[0] - 6, ctr[1]); g.lineTo(ctr[0] + 6, ctr[1]); g.moveTo(ctr[0], ctr[1] - 6); g.lineTo(ctr[0], ctr[1] + 6); g.stroke();
    g.fillStyle = '#fff'; for (const p of [...FQ, ...SQ]) g.fillRect(p[0] - 3, p[1] - 3, 6, 6);
    if (B.conf != null) { g.font = '600 11px Cairo, sans-serif'; g.fillStyle = B.conf > .8 ? '#3fae8f' : B.conf > .5 ? '#d6c04a' : '#e5484d'; g.fillText(B.conf.toFixed(2), FQ[2][0] + 4, FQ[2][1] + 12); }
    T._hot = { c, FQ, SQ, ctr };
  };
  // pointer on the overlay: drag inside the feature box = move both boxes; corner handles resize; click elsewhere = place
  T.down = (e, X, Y, ov) => {
    const c = clipOf(); const h = T._hot; if (!c || !h || h.c !== c || (T.st.ctl && !T.st.ctl.done)) return true;
    const s = S(); const B = boxState(c); const inv = GW.Mon.invMap(c, B.lt); const tr = B.tr;
    const d = (p) => Math.hypot(p[0] - X, p[1] - Y);
    let mode = 'move', ci = h.FQ.findIndex(p => d(p) < 8);
    if (ci >= 0) mode = 'feat'; else { ci = h.SQ.findIndex(p => d(p) < 8); if (ci >= 0) mode = 'search'; }
    const p0 = inv(X, Y); const c0 = B.ctr.slice();
    const inside = Math.abs(p0[0] - c0[0]) <= tr.feat[0] / 2 && Math.abs(p0[1] - c0[1]) <= tr.feat[1] / 2;
    if (mode === 'move' && !inside) { c0[0] = p0[0]; c0[1] = p0[1]; place(c, c0); }
    const r = ov.getBoundingClientRect(); try { ov.setPointerCapture(e.pointerId); } catch (er) {}
    const mv = ev => {
      const p = inv(ev.clientX - r.left, ev.clientY - r.top);
      if (mode === 'move') place(c, [c0[0] + p[0] - p0[0], c0[1] + p[1] - p0[1]]);
      else { const w = Math.max(8, Math.abs(p[0] - c0[0]) * 2), hh = Math.max(8, Math.abs(p[1] - c0[1]) * 2);
        if (mode === 'feat') { tr.feat = [Math.round(w), Math.round(hh)]; { const z = T.sizeAt && T.sizeAt(c, S().t); if (z) { z[1] = tr.feat[0]; z[2] = tr.feat[1]; } } tr.search = [Math.max(tr.search[0], tr.feat[0] + 8), Math.max(tr.search[1], tr.feat[1] + 8)]; } else tr.search = [Math.round(Math.max(w, tr.feat[0] + 8)), Math.round(Math.max(hh, tr.feat[1] + 8))]; }
      GW.Mon.redraw();
    };
    const up = () => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); GW.commit('نقطة التتبع'); upd(); };
    ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up);
    GW.Mon.redraw(); void s; return true;
  };
  // placing the box on a tracked frame corrects that frame (manual keyframe, confidence 1)
  function place(c, P) { const tr = c.track; tr.at = [P[0], P[1]]; const e = T.pointAt(c, S().t); if (e) { e[1] = Math.round(P[0] * 100) / 100; e[2] = Math.round(P[1] * 100) / 100; e[3] = 1; } }
  T.cursor = (X, Y) => { const h = T._hot; if (!h) return 'crosshair'; const d = p => Math.hypot(p[0] - X, p[1] - Y); return h.FQ.some(p => d(p) < 8) || h.SQ.some(p => d(p) < 8) ? 'nwse-resize' : 'move'; };

  /* ---------- quick action: track + mosaic ---------- */
  T.quickBlur = (c) => {
    const v = c && c.kind === 'video' ? c : T.sourceFor(c); if (!v) { GW.toast('حدد مقطع فيديو'); return; }
    const tr = v.track; const s = S();
    if (tr && samples(v).length > 1 && T.pointAt(v, s.t)) { try { T.apply(v, 'mosaic'); GW.toast('أُنشئت طبقة تمويه تتبع الوجه/اللوحة'); } catch (e) { GW.toast(e.message, 'err'); } return; }
    if (tr && !tr.pts.length) tr.feat = [90, 90];
    T.open(v, { target: 'mosaic', hint: 'ضع المربع على الوجه أو اللوحة، اضغط «تتبع للأمام» ثم «تطبيق» لإنشاء التمويه المتتبَّع' });
  };

  /* ---------- Effect Controls rows (ui_fxc.js) ---------- */
  T.fxcMotion = (sec, c, row) => {
    if (c.kind !== 'video') return;
    const w = document.createElement('span'); w.style.cssText = 'display:inline-flex;gap:6px;flex-wrap:wrap';
    const b1 = document.createElement('button'); b1.className = 'btn sm'; b1.dataset.a = 'track'; b1.innerHTML = GW.ico('track', 13) + ' تتبع'; b1.title = 'تتبع الحركة في شاشة البرنامج'; b1.onclick = () => T.open(c, { target: 'self' });
    const b2 = document.createElement('button'); b2.className = 'btn sm'; b2.dataset.a = 'trackblur'; b2.innerHTML = GW.ico('mosaic', 13) + ' تمويه وجه/لوحة متتبَّع'; b2.onclick = () => T.quickBlur(c);
    w.append(b1, b2); sec.body.append(row(c, null, 'تتبع الحركة', w, { noAnim: true }));
  };
  T.fxcMask = (sec, c, mk, row) => {
    const b = document.createElement('button'); b.className = 'btn sm'; b.dataset.a = 'trackmask'; b.innerHTML = GW.ico('track', 13) + ' تتبع'; b.title = 'تتبع القناع';
    b.onclick = () => { const v = T.sourceFor(c); if (!v) { GW.toast('لا يوجد مقطع فيديو تحت القناع لتتبعه'); return; } const tr = T.data(v, true); const s = S(); const lt = s.t - c.start;
      if (!T.pointAt(v, s.t) && mk.type !== 'path') { const ctr = GW.pv(mk.center, lt); const q = toSeq(s, c, s.t, ctr[0], ctr[1]); tr.at = fromSeq(s, v, s.t, q[0], q[1]); }
      T.open(v, { target: 'mask:' + c.id + ':' + mk.id }); };
    sec.body.append(row(c, null, 'تتبع القناع', b, { noAnim: true }));
  };
  // timeline context menu
  (GW.clipMenuHooks = GW.clipMenuHooks || []).push((items, c) => {
    if (c.kind !== 'video') return;
    items.push('-', { label: 'تتبع الحركة…', action: () => T.open(c, { target: 'self' }) }, { label: 'تمويه وجه/لوحة متتبَّع', action: () => T.quickBlur(c) });
  });

  /* ================= AI tracking «مثل أفتر إفكت»: automatic face tracking + person / object box tracking with scale ================= */
  // face: face-api (MIT, bundled in lib/faceapi: SSD MobileNet v1 + Tiny Face Detector, offline). Per frame the face nearest to
  // the predicted position (similar size) is kept; short misses are interpolated; the path and size are smoothed.
  // box: the drawn box is matched frame to frame by normalized cross-correlation on a resampled grid, so it follows the
  // subject while it moves AND grows / shrinks (scale search). Sizes are stored in c.track.sz = [[srcT, w, h]…] (source px).
  let faP = null;
  T.loadFace = () => faP || (faP = (async () => {
    if (!window.faceapi) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'lib/faceapi/face-api.js'; sc.onload = res; sc.onerror = () => rej(new Error('تعذر تحميل نموذج الوجوه')); document.head.append(sc); });
    const fa = window.faceapi; const base = new URL('lib/faceapi/', location.href).href;
    try { await fa.tf.setBackend('webgl'); } catch (e) { try { await fa.tf.setBackend('cpu'); } catch (e2) {} } await fa.tf.ready();
    await fa.nets.ssdMobilenetv1.loadFromUri(base); await fa.nets.tinyFaceDetector.loadFromUri(base); return fa;
  })().catch(e => { faP = null; throw e; }));
  T.detectFaces = async (src, o = {}) => { const fa = await T.loadFace(); const opt = o.fast ? new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: .3 }) : new fa.SsdMobilenetv1Options({ minConfidence: .3 });
    const r = await fa.detectAllFaces(src, opt); return r.map(d => ({ x: d.box.x + d.box.width / 2, y: d.box.y + d.box.height / 2, w: d.box.width, h: d.box.height, s: d.score })); };
  const nearSz = (tr, srcT, c) => { if (!tr || !tr.sz) return null; const tol = .5 / fpsOf() * (c.speed || 1); let b = null, bd = tol; for (const p of tr.sz) { const d = Math.abs(p[0] - srcT); if (d <= bd) { bd = d; b = p; } } return b; };
  function setSz(tr, srcT, w, h, c) { tr.sz = tr.sz || []; const e = nearSz(tr, srcT, c); const v = [Math.round(srcT * 1e5) / 1e5, Math.round(w * 10) / 10, Math.round(h * 10) / 10]; if (e) { e[1] = v[1]; e[2] = v[2]; e[0] = v[0]; } else { tr.sz.push(v); tr.sz.sort((a, b) => a[0] - b[0]); } }
  T.sizeAt = (c, t) => nearSz(c.track, srcOf(c, t - c.start), c);
  // centred moving average over the points (and sizes) between source times a..b
  function smoothTrack(tr, a, b, r = 2) {
    const lo = Math.min(a, b) - 1e-6, hi = Math.max(a, b) + 1e-6;
    for (const [arr, i1, i2] of [[tr.pts, 1, 2], [tr.sz || [], 1, 2]]) { const idx = []; arr.forEach((p, i) => { if (p[0] >= lo && p[0] <= hi) idx.push(i); }); const src = idx.map(i => arr[i].slice());
      idx.forEach((ai, j) => { let sx = 0, sy = 0, n = 0; for (let q = Math.max(0, j - r); q <= Math.min(src.length - 1, j + r); q++) { sx += src[q][i1]; sy += src[q][i2]; n++; } arr[ai][i1] = Math.round(sx / n * 100) / 100; arr[ai][i2] = Math.round(sy / n * 100) / 100; }); }
  }
  function frameRange(c, o) {
    const s = S(), fps = fpsOf(); const nF = Math.max(1, Math.floor(c.dur * fps + 1e-6)); const dir = o.dir < 0 ? -1 : 1;
    const i = clamp(Math.round(((o.t != null ? o.t : s.t) - c.start) * fps), 0, nF - 1);
    let iEnd = dir > 0 ? nF - 1 : 0; if (o.to != null) iEnd = clamp(Math.round((o.to - c.start) * fps), 0, nF - 1);
    if (o.max) iEnd = dir > 0 ? Math.min(iEnd, i + o.max) : Math.max(iEnd, i - o.max);
    return { i, iEnd, dir, fps };
  }
  T.runFace = async (c, o = {}) => {
    if (!c || c.kind !== 'video') fail('التتبع يحتاج مقطع فيديو');
    const tr = T.data(c, true); let { i, iEnd, dir, fps } = frameRange(c, o);
    if (o.onP) o.onP(0, Math.abs(iEnd - i), 0, c.start + i / fps, 'تحميل نموذج الوجوه…');
    await T.loadFace(); const G0 = await grabber(c); const k = G0.k;
    const out = { frames: 0, lost: false, cancelled: false, from: c.start + i / fps, to: c.start + i / fps }; const st0 = G0.srcT(i);
    try {
      await G0.frame(i); let D = await T.detectFaces(G0.cv, o);
      if (!D.length) fail('لم يُعثر على وجه في هذا الإطار — انتقل إلى إطار يظهر فيه الوجه بوضوح');
      const want = o.at ? [o.at[0] * k, o.at[1] * k] : tr.pick ? [tr.pick[0] * k, tr.pick[1] * k] : null;
      let cur = want ? D.slice().sort((a, b) => Math.hypot(a.x - want[0], a.y - want[1]) - Math.hypot(b.x - want[0], b.y - want[1]))[0] : D.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
      const put = (fi, f, conf) => { const t = G0.srcT(fi); setPt(tr, t, f.x / k, f.y / k, conf, c); setSz(tr, t, f.w / k, f.h / k, c); };
      put(i, cur, Math.max(.5, cur.s)); tr.at = [cur.x / k, cur.y / k]; tr.feat = [Math.round(cur.w / k), Math.round(cur.h / k)];
      let vel = [0, 0], miss = 0, lastI = i; const total = Math.abs(iEnd - i); const gaps = [];
      while (i !== iEnd) {
        if (o.ctl && o.ctl.cancel) { out.cancelled = true; break; }
        i += dir; await G0.frame(i); D = await T.detectFaces(G0.cv, o);
        const px = cur.x + vel[0] * (miss + 1), py = cur.y + vel[1] * (miss + 1);
        let best = null, bd = Infinity; for (const f of D) { const d = Math.hypot(f.x - px, f.y - py) / Math.max(8, cur.w); const r = f.w / cur.w; if (d < 1.1 + miss * .15 && r > .6 && r < 1.6 && d < bd) { bd = d; best = f; } }
        if (best) {
          if (miss) gaps.push([lastI, i]); vel = [(best.x - cur.x) / (miss + 1) * .6 + vel[0] * .4, (best.y - cur.y) / (miss + 1) * .6 + vel[1] * .4];
          cur = best; miss = 0; lastI = i; put(i, cur, best.s); out.frames++; out.to = c.start + i / fps;
        } else if (++miss > Math.max(8, fps * .6)) { out.lost = true; break; }
        if (o.onP) o.onP(Math.abs(i - (out.from - c.start) * fps) | 0, total, best ? best.s : 0, c.start + i / fps);
        if (out.frames % 3 === 0) await new Promise(r => setTimeout(r, 0));
      }
      // fill short gaps (face turned away / blur) linearly
      for (const [a, b] of gaps) { const pa = near(tr, G0.srcT(a), c), pb = near(tr, G0.srcT(b), c), sa = nearSz(tr, G0.srcT(a), c), sb = nearSz(tr, G0.srcT(b), c); if (!pa || !pb) continue;
        for (let j = Math.min(a, b) + 1; j < Math.max(a, b); j++) { const f = (j - a) / (b - a); const t = G0.srcT(j); setPt(tr, t, pa[1] + (pb[1] - pa[1]) * f, pa[2] + (pb[2] - pa[2]) * f, .4, c); if (sa && sb) setSz(tr, t, sa[1] + (sb[1] - sa[1]) * f, sa[2] + (sb[2] - sa[2]) * f, c); } }
      smoothTrack(tr, st0, G0.srcT(lastI), 2); tr.at = [cur.x / k, cur.y / k];
    } finally { G0.close(); }
    return out;
  };
  // NCC of template Tp against the frame sampled on a tw×th grid of spacing sc centred at (cx, cy) (grey px)
  function nccS(G, W, H, Tp, cx, cy, sc) {
    const { d, tw, th, n, n2 } = Tp; let s1 = 0, s2 = 0, cr = 0; const x0 = cx - (tw / 2 - .5) * sc, y0 = cy - (th / 2 - .5) * sc;
    if (x0 < 0 || y0 < 0 || x0 + tw * sc > W - 1 || y0 + th * sc > H - 1) return -2;
    for (let v = 0; v < th; v++) { const row = Math.round(y0 + v * sc) * W; let t = v * tw; for (let u = 0; u < tw; u++, t++) { const g = G[row + Math.round(x0 + u * sc)]; s1 += g; s2 += g * g; cr += g * d[t]; } }
    const vg = s2 - s1 * s1 / n; return vg > 1e-3 ? cr / Math.sqrt(vg * n2) : 0;
  }
  function tmplS(G, W, H, cx, cy, sc, tw, th) {
    const x0 = cx - (tw / 2 - .5) * sc, y0 = cy - (th / 2 - .5) * sc; if (x0 < 0 || y0 < 0 || x0 + tw * sc > W - 1 || y0 + th * sc > H - 1) return null;
    const n = tw * th, d = new Float32Array(n); let s1 = 0; for (let v = 0; v < th; v++) { const row = Math.round(y0 + v * sc) * W; for (let u = 0; u < tw; u++) { const g = G[row + Math.round(x0 + u * sc)]; d[v * tw + u] = g; s1 += g; } }
    const mu = s1 / n; let n2 = 0; for (let q = 0; q < n; q++) { d[q] -= mu; n2 += d[q] * d[q]; } return { d, tw, th, n, n2 };
  }
  T.runBox = async (c, o = {}) => {
    if (!c || c.kind !== 'video') fail('التتبع يحتاج مقطع فيديو');
    const tr = T.data(c, true); let { i, iEnd, dir, fps } = frameRange(c, o); const G0 = await grabber(c); const k = G0.k;
    const out = { frames: 0, lost: false, cancelled: false, from: c.start + i / fps, to: c.start + i / fps };
    try {
      const st0 = G0.srcT(i); const p0 = near(tr, st0, c); const s0 = nearSz(tr, st0, c);
      let P = o.at ? [+o.at[0] * k, +o.at[1] * k] : p0 ? [p0[1] * k, p0[2] * k] : [tr.at[0] * k, tr.at[1] * k];
      const bw = (s0 ? s0[1] : tr.feat[0]) * k, bh = (s0 ? s0[2] : tr.feat[1]) * k;
      // template grid: at most ~48 cells on the long side (speed), cell = sc grey px
      const cell0 = Math.max(1, Math.max(bw, bh) / 48); const tw = Math.max(6, Math.round(bw / cell0)), th = Math.max(6, Math.round(bh / cell0)); let sc = cell0;
      let F = await G0.frame(i); const ref = tmplS(F, G0.W, G0.H, P[0], P[1], sc, tw, th); if (!ref || ref.n2 < 1e-3) fail('المربع خارج الإطار أو بلا تفاصيل — ارسمه حول الشخص أو الجسم بالكامل');
      setPt(tr, st0, P[0] / k, P[1] / k, 1, c); setSz(tr, st0, tw * sc / k, th * sc / k, c);
      let prevT = ref, vel = [0, 0]; const total = Math.abs(iEnd - i); const minConf = o.minConf ?? .35; const iStart = i;
      while (i !== iEnd) {
        if (o.ctl && o.ctl.cancel) { out.cancelled = true; break; }
        i += dir; F = await G0.frame(i); const W = G0.W, H = G0.H;
        const px = P[0] + vel[0], py = P[1] + vel[1]; const R = Math.max(4, Math.round(Math.max(tw, th) * sc * .3)); const step = Math.max(1, Math.round(sc / 2));
        const score = (x, y, s2) => Math.max(nccS(F, W, H, prevT, x, y, s2), nccS(F, W, H, ref, x, y, s2) - .03);
        let best = -2, bx = px, by = py;
        for (let dy = -R; dy <= R; dy += step * 2) for (let dx = -R; dx <= R; dx += step * 2) { const r = score(px + dx, py + dy, sc); if (r > best) { best = r; bx = px + dx; by = py + dy; } }
        for (let it = 0; it < 2; it++) { let cx = bx, cy = by; for (let dy = -step; dy <= step; dy += step) for (let dx = -step; dx <= step; dx += step) { const r = score(cx + dx, cy + dy, sc); if (r > best) { best = r; bx = cx + dx; by = cy + dy; } } }
        // scale: judged against the reference template only (the adaptive template would follow the growth and hide it)
        let bs = sc, rb = nccS(F, W, H, ref, bx, by, sc); for (const f of [.97, 1.03, .94, 1.06]) { const s2 = sc * f; const r = nccS(F, W, H, ref, bx, by, s2); if (r > rb + .002) { rb = r; bs = s2; } }
        if (bs !== sc) for (let dy = -step; dy <= step; dy += step) for (let dx = -step; dx <= step; dx += step) { const r = nccS(F, W, H, ref, bx + dx, by + dy, bs); if (r > rb) { rb = r; bx += dx; by += dy; } }
        best = Math.max(best, rb);
        if (best < minConf) { out.lost = true; break; }
        vel = [(bx - P[0]) * .7, (by - P[1]) * .7]; P = [bx, by]; sc = bs;
        setPt(tr, G0.srcT(i), P[0] / k, P[1] / k, best, c); setSz(tr, G0.srcT(i), tw * sc / k, th * sc / k, c); out.frames++; out.to = c.start + i / fps;
        if (best >= .6) prevT = tmplS(F, W, H, P[0], P[1], sc, tw, th) || prevT;
        if (o.onP) o.onP(out.frames, total, best, c.start + i / fps);
        if (out.frames % 4 === 0) await new Promise(r => setTimeout(r, 0));
      }
      smoothTrack(tr, G0.srcT(iStart), G0.srcT(i), 1); tr.at = [P[0] / k, P[1] / k]; tr.feat = [Math.round(tw * sc / k), Math.round(th * sc / k)];
    } finally { G0.close(); }
    return out;
  };
  // extra apply targets: layer that also scales with the subject, re-frame (zoom in and keep the subject centred), sized masks
  const apply0 = T.apply;
  const sizeList = (c) => { const tr = c.track; if (!tr || !tr.sz || !tr.sz.length) return null; return tr.sz.map(p => ({ lt: Math.round(ltOf(c, p[0]) * fpsOf()) / fpsOf(), w: p[1], h: p[2] })).filter(p => p.lt >= -1e-6 && p.lt <= c.dur + 1e-6).map(p => (p.t = c.start + p.lt, p)); };
  const szAtT = (L, t) => { let b = null, bd = 1e9; for (const p of L) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; b = p; } } return b; };
  T.apply = (c, target, o = {}) => {
    const s = S(); const [kind, id] = String(target || 'self').split(':');
    if (kind === 'layerS') {
      const r = apply0(c, 'layer:' + id, o); const L = GW.clipById(id, s); const SZ = sizeList(c); if (!L || !SZ || SZ.length < 2) return r;
      const tRef = clamp(o.tRef != null ? o.tRef : s.t, SZ[0].t, SZ[SZ.length - 1].t); const s0 = szAtT(SZ, tRef); const sc0 = GW.pv(L.motion.scale, clamp(tRef - L.start, 0, L.dur));
      const in1 = SZ.filter(p => p.t >= L.start - 1e-6 && p.t <= L.start + L.dur + 1e-6); if (!in1.length) return r;
      const keys = in1.map(p => ({ t: Math.round((p.t - L.start) * fpsOf()) / fpsOf(), v: Math.round(sc0 * p.w / s0.w * 100) / 100 })); putKeys(L.motion.scale, keys, keys[0].t, keys[keys.length - 1].t);
      GW.commit('تتبع مع الحجم: ' + L.name); GW.invalidate(); r.scaled = true; return r;
    }
    if (kind === 'reframe') {
      const list = samples(c); if (list.length < 2) fail('لا توجد بيانات تتبع كافية — تتبّع للأمام أو للخلف أولًا');
      const Z = clamp(+(o.zoom || 1.6), 1, 6); const lt0 = list[0].lt; const S0 = GW.pv(c.motion.scale, lt0) / 100; const A = GW.pv(c.motion.anchor, lt0); const sc = S0 * Z;
      const sw = c.sw || s.w, sh = c.sh || s.h; const cx = s.w / 2, cy = s.h / 2;
      const keys = list.map(p => { let x = cx - sc * (p.x - A[0]), y = cy - sc * (p.y - A[1]);
        x = clamp(x, s.w - sc * (sw - A[0]), sc * A[0]); y = clamp(y, s.h - sc * (sh - A[1]), sc * A[1]); return { t: p.lt, v: [Math.round(x * 100) / 100, Math.round(y * 100) / 100] }; });
      putKeys(c.motion.pos, keys, list[0].lt, list[list.length - 1].lt); c.motion.scale = GW.P(Math.round(sc * 10000) / 100);
      GW.commit('إعادة تأطير على الهدف'); GW.invalidate(); return { target, keys: keys.length, clip: c.id };
    }
    const r = apply0(c, target, o);
    if ((kind === 'mosaic' || kind === 'blur') && r && r.mask) { // mask grows / shrinks with the face or subject
      const SZ = sizeList(c); const A = GW.clipById(r.clip, s); const mk = A && (A.masks || []).find(x => x.id === r.mask);
      if (SZ && SZ.length > 1 && mk && mk.size) { const M = GW.R.placeMatrix(c, SZ[0].lt, 1, 1, null); const sx = Math.hypot(M[0], M[1]), sy = Math.hypot(M[3], M[4]); const pad = o.pad || 1.35;
        const keys = SZ.filter(p => p.t >= A.start - 1e-6 && p.t <= A.start + A.dur + 1e-6).map(p => ({ t: Math.round((p.t - A.start) * fpsOf()) / fpsOf(), v: [Math.round(p.w * sx * pad), Math.round(p.h * sy * pad * 1.1)] }));
        if (keys.length) putKeys(mk.size, keys, keys[0].t, keys[keys.length - 1].t); GW.invalidate(); } }
    return r;
  };
  const targets0 = T.targets;
  T.targets = (c) => { const o = targets0(c); const s = S(); const extra = [['reframe', 'تكبير ومتابعة الهدف (إعادة تأطير)']];
    for (const x of s.clips) if (x.tt === 'v' && x !== c && x.motion && x.kind !== 'camera' && x.kind !== 'adjust' && x.start < c.start + c.dur && x.start + x.dur > c.start) extra.push(['layerS:' + x.id, 'طبقة تتبع مع الحجم: V' + (x.ti + 1) + ' ' + x.name]);
    return o.concat(extra); };
  // entry points: context menu + Effect Controls
  (GW.clipMenuHooks = GW.clipMenuHooks || []).push((items, c) => {
    if (c.kind !== 'video') return;
    items.push({ label: 'تتبع الوجه تلقائياً…', action: () => T.open(c, { target: 'mosaic', mode: 'face', hint: 'انقر على الوجه الذي تريد تتبعه، ثم اضغط «تتبع للأمام»' }) }, { label: 'تتبع شخص / جسم…', action: () => T.open(c, { target: 'layerS', mode: 'box', hint: 'اسحب زوايا المربع ليحيط بالشخص أو الجسم كاملاً، ثم اضغط «تتبع للأمام»' }) });
  });

  /* ---------- automation ---------- */
  // trackPoint({id, x, y, t, feat:[w,h], search:[w,h], dir:'forward'|'backward'|'both', to, minConf, apply:'self'|'layer'|'mask'|'mosaic'|'blur', target, mask})
  T.api = async (p = {}) => {
    const s = S(); const c = p.id ? GW.clipById(p.id, s) : [...GW.sel.clips].map(x => GW.clipById(x)).find(x => x && x.kind === 'video');
    if (!c || c.kind !== 'video') fail('id: a video clip');
    const t = p.t != null ? +p.t : clamp(s.t, c.start, c.start + c.dur - 1 / fpsOf());
    const tr = T.data(c, true); if (p.reset) tr.pts = [];
    const at = p.x != null && p.y != null ? [+p.x, +p.y] : null;
    const runs = []; const dir = String(p.dir || 'forward');
    const base = { at, feat: p.feat, search: p.search, minConf: p.minConf, t, to: p.to };
    if (dir === 'forward' || dir === 'both') runs.push(await T.run(c, { ...base, dir: 1, to: dir === 'both' ? undefined : p.to }));
    if (dir === 'backward' || dir === 'both') runs.push(await T.run(c, { ...base, at: at || null, dir: -1, to: dir === 'both' ? undefined : p.to }));
    GW.commit('المساعد: تتبع الحركة');
    const pts = samples(c).map(q => ({ t: Math.round(q.t * 1e4) / 1e4, x: q.x, y: q.y, conf: q.conf }));
    const out = { clip: c.id, frames: runs.reduce((a, r) => a + r.frames, 0), lost: runs.some(r => r.lost), points: pts };
    if (p.apply) {
      const tg = p.apply === 'layer' ? 'layer:' + p.target : p.apply === 'mask' ? 'mask:' + (p.target || c.id) + ':' + p.mask : p.apply;
      out.applied = T.apply(c, tg, { tRef: t, size: p.size, shape: p.shape }); const H = GW.hist; H.labels[H.idx] = 'المساعد: ' + H.labels[H.idx]; GW.bus.emit('hist');
    }
    return out;
  };
  if (GW.API && GW.API.methods && !GW.API.methods.trackPoint) GW.API.methods.trackPoint = (p) => T.api(p);
})();
