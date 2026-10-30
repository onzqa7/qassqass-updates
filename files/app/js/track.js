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
      W, H, k, sw, sh, fps,
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
    T.st = { cid: c.id, target: o.target || 'self', ctl: null, msg: '' };
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
      <button class="tb" data-a="bk" title="تتبع للخلف">${I('trackb')}</button><button class="tb" data-a="b1" title="إطار واحد للخلف">${I('step1b')}</button>
      <button class="tb" data-a="f1" title="إطار واحد للأمام">${I('step1f')}</button><button class="tb" data-a="fw" title="تتبع للأمام">${I('trackf')}</button>
      <button class="tb" data-a="stop" title="إيقاف التتبع" disabled>${I('stop')}</button>
      <span class="trk-st" data-a="st"></span><canvas data-a="conf" title="الثقة لكل إطار (انقر للانتقال)"></canvas><span class="grow"></span>
      <select class="sel" data-a="target" title="تطبيق التتبع على"></select>
      <button class="btn sm pri" data-a="apply">${I('check', 13)}تطبيق</button><button class="btn sm" data-a="clear" title="مسح بيانات التتبع">مسح التتبع</button><button class="tb" data-a="close" title="إغلاق المتتبع">${I('close')}</button>`;
    view.append(b);
    const q = a => b.querySelector(`[data-a=${a}]`);
    const sel = q('target'); for (const [v, n] of T.targets(c)) { const op = document.createElement('option'); op.value = v; op.textContent = n; sel.append(op); }
    sel.value = T.targets(c).some(x => x[0] === T.st.target) ? T.st.target : 'self'; sel.onchange = () => { T.st.target = sel.value; };
    q('fw').onclick = () => go(1); q('bk').onclick = () => go(-1); q('f1').onclick = () => go(1, 1); q('b1').onclick = () => go(-1, 1);
    q('stop').onclick = () => { if (T.st && T.st.ctl) T.st.ctl.cancel = true; };
    q('close').onclick = () => T.close();
    q('clear').onclick = () => { const c2 = clipOf(); if (c2 && c2.track) { c2.track.pts = []; GW.commit('مسح بيانات التتبع'); } T.st.msg = ''; upd(); GW.invalidate(); };
    q('apply').onclick = () => { const c2 = clipOf(); try { const r = T.apply(c2, T.st.target); GW.toast('تم تطبيق التتبع · المفاتيح: ' + r.keys); if (/^(mosaic|blur)$/.test(T.st.target)) T.close(); else bar(); } catch (e) { GW.toast(e.message, 'err'); } };
    const cv = q('conf'); cv.onpointerdown = (e) => { const r = cv.getBoundingClientRect(); const c2 = clipOf(); if (c2) GW.seek(c2.start + clamp((e.clientX - r.left) / r.width, 0, 1) * c2.dur); };
    upd();
  }
  function upd() {
    const b = document.querySelector('.trk-bar'); const c = clipOf(); if (!b || !c) return;
    const busy = !!(T.st.ctl && !T.st.ctl.done);
    for (const a of ['fw', 'bk', 'f1', 'b1', 'apply', 'clear', 'target']) b.querySelector(`[data-a=${a}]`).disabled = busy;
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
      const r = await T.run(c, { dir, max, ctl, onP: (n, tot, cf, t) => { T.st.msg = 'تتبع: ' + n + '/' + tot + ' · الثقة: ' + cf.toFixed(2); if (n % 8 === 0 || n === tot) GW.seek(t); else { GW.Mon.redraw(); } upd(); } });
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
    const quad = (w, h) => [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]].map(p => mp(p[0], p[1]));
    const poly = (P) => { g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke(); };
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff6a2b';
    // track path (source px through the current transform)
    if (tr.pts.length > 1) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); tr.pts.forEach((p, i) => { const q = mp(p[1], p[2]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
      for (const p of tr.pts) { const q = mp(p[1], p[2]); g.fillStyle = p[3] > .8 ? '#3fae8f' : p[3] > .5 ? '#d6c04a' : '#e5484d'; g.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3); } }
    g.setLineDash([5, 4]); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1; const SQ = quad(tr.search[0], tr.search[1]); poly(SQ); g.setLineDash([]);
    g.strokeStyle = acc; g.lineWidth = 2; const FQ = quad(tr.feat[0], tr.feat[1]); poly(FQ);
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
        if (mode === 'feat') { tr.feat = [Math.round(w), Math.round(hh)]; tr.search = [Math.max(tr.search[0], tr.feat[0] + 8), Math.max(tr.search[1], tr.feat[1] + 8)]; } else tr.search = [Math.round(Math.max(w, tr.feat[0] + 8)), Math.round(Math.max(hh, tr.feat[1] + 8))]; }
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
