'use strict';
/* Shape layers (طبقات الأشكال): vector clips (kind 'shape') rasterized with Canvas 2D to a texture, like text.
   clip.shape = { type: rect|ellipse|polygon|star|line|path, center, size, rot, round, points, inner (P),
     fill:{on, color, opacity, grad:{on, type, c1, c2, angle}}, stroke:{on, color, width, opacity, cap, join, dash, gap, dashOffset},
     trim:{start, end, offset}, path:{pts:P([[x,y, inX,inY, outX,outY]…]), closed} }   (coordinates in sequence px) */
(function () {
  const S = GW.Shape = {};
  const P = GW.P, clamp = GW.clamp;
  const cache = new Map();
  S.TYPES = [['rect', 'مستطيل'], ['ellipse', 'قطع ناقص'], ['polygon', 'مضلع'], ['star', 'نجمة'], ['line', 'خط'], ['path', 'مسار (قلم)']];
  S.defaults = (type, s, o = {}) => {
    const w = s.w, h = s.h; const sz = type === 'line' ? [w * .5, 0] : type === 'ellipse' || type === 'polygon' || type === 'star' ? [h * .4, h * .4] : [w * .4, h * .3];
    return {
      type, center: P(o.center || [w / 2, h / 2]), size: P(o.size || sz), rot: P(0), round: P(0), points: P(5), inner: P(50),
      fill: { on: type === 'line' || type === 'path' ? 0 : 1, color: P(o.color || '#2f8ef0'), opacity: P(100), grad: { on: 0, type: 'linear', c1: P('#2f8ef0'), c2: P('#8b5cff'), angle: P(90) } },
      stroke: { on: type === 'line' || type === 'path' ? 1 : 0, color: P('#ffffff'), width: P(6), opacity: P(100), cap: 'round', join: 'round', dash: P(0), gap: P(0), dashOffset: P(0) },
      trim: { start: P(0), end: P(100), offset: P(0) },
      path: { pts: P(o.pts || []), closed: o.closed ? 1 : 0 }
    };
  };
  S.key = (sh, lt) => { const out = []; GW.eachParam({ shape: sh }, p => out.push(GW.pv(p, lt))); return JSON.stringify(out) + sh.type + (sh.fill.on | 0) + (sh.fill.grad.on | 0) + sh.fill.grad.type + (sh.stroke.on | 0) + sh.stroke.cap + sh.stroke.join + (sh.path.closed | 0); };

  /* ---- geometry: polyline(s) in sequence px. Returns [{pts:[[x,y]…], closed}] ---- */
  const bez = (a, b, t) => { // cubic between anchor a and b using a.out / b.in handles (absolute)
    const x0 = a[0], y0 = a[1], x1 = a[0] + (a[4] || 0), y1 = a[1] + (a[5] || 0), x2 = b[0] + (b[2] || 0), y2 = b[1] + (b[3] || 0), x3 = b[0], y3 = b[1];
    const u = 1 - t; return [u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3];
  };
  const rot = (pts, c, a) => { if (!a) return pts; const cs = Math.cos(a), sn = Math.sin(a); return pts.map(([x, y]) => [c[0] + (x - c[0]) * cs - (y - c[1]) * sn, c[1] + (x - c[0]) * sn + (y - c[1]) * cs]); };
  // rounded corners: replace every vertex of a straight polygon with a quadratic shoulder (sampled)
  function roundPoly(pts, r, closed) {
    if (r <= 0 || pts.length < 3) return pts; const out = []; const n = pts.length;
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) { out.push(pts[i]); continue; }
      const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]); const rr = Math.min(r, la / 2, lb / 2); if (rr <= 0) { out.push(p); continue; }
      const pa = [p[0] + (a[0] - p[0]) / la * rr, p[1] + (a[1] - p[1]) / la * rr], pb = [p[0] + (b[0] - p[0]) / lb * rr, p[1] + (b[1] - p[1]) / lb * rr];
      for (let j = 0; j <= 6; j++) { const t = j / 6, u = 1 - t; out.push([u * u * pa[0] + 2 * u * t * p[0] + t * t * pb[0], u * u * pa[1] + 2 * u * t * p[1] + t * t * pb[1]]); }
    }
    return out;
  }
  S.polylines = (sh, lt) => {
    const c = GW.pv(sh.center, lt), sz = GW.pv(sh.size, lt), a = (GW.pv(sh.rot, lt) || 0) * Math.PI / 180, rd = Math.max(0, GW.pv(sh.round, lt) || 0);
    const w = sz[0] / 2, h = sz[1] / 2;
    switch (sh.type) {
      case 'rect': { let pts = [[c[0] - w, c[1] - h], [c[0] + w, c[1] - h], [c[0] + w, c[1] + h], [c[0] - w, c[1] + h]]; pts = roundPoly(pts, rd, true); return [{ pts: rot(pts, c, a), closed: true }]; }
      case 'ellipse': { const pts = []; const n = 96; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; pts.push([c[0] + Math.cos(t) * w, c[1] + Math.sin(t) * h]); } return [{ pts: rot(pts, c, a), closed: true }]; }
      case 'polygon': case 'star': {
        const n = Math.max(3, Math.round(GW.pv(sh.points, lt) || 5)); const inner = clamp(GW.pv(sh.inner, lt) / 100, .05, 1); const pts = [];
        const m = sh.type === 'star' ? n * 2 : n;
        for (let i = 0; i < m; i++) { const t = -Math.PI / 2 + i / m * Math.PI * 2; const f = sh.type === 'star' && i % 2 ? inner : 1; pts.push([c[0] + Math.cos(t) * w * f, c[1] + Math.sin(t) * h * f]); }
        return [{ pts: rot(roundPoly(pts, rd, true), c, a), closed: true }];
      }
      case 'line': return [{ pts: rot([[c[0] - w, c[1] - h], [c[0] + w, c[1] + h]], c, a), closed: false }];
      case 'path': {
        const P0 = GW.pv(sh.path.pts, lt) || []; if (P0.length < 2) return P0.length ? [{ pts: P0.map(p => [p[0], p[1]]), closed: false }] : [];
        const out = []; const n = P0.length; const segs = sh.path.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) { const A = P0[i], B = P0[(i + 1) % n]; const straight = !(A[4] || A[5] || B[2] || B[3]); if (straight) { out.push([A[0], A[1]]); continue; } for (let j = 0; j < 24; j++) out.push(bez(A, B, j / 24)); }
        if (!sh.path.closed) out.push([P0[n - 1][0], P0[n - 1][1]]);
        return [{ pts: rd > 0 ? roundPoly(out, rd, !!sh.path.closed) : out, closed: !!sh.path.closed }];
      }
    }
    return [];
  };
  S.length = (pl) => { let L = 0; const p = pl.pts; const n = pl.closed ? p.length : p.length - 1; for (let i = 0; i < n; i++) { const b = p[(i + 1) % p.length]; L += Math.hypot(b[0] - p[i][0], b[1] - p[i][1]); } return L; };
  // trim paths: keep the part of the polyline between start% and end% (+offset%), wrapping on closed shapes
  S.trim = (pl, start, end, offset) => {
    let a = Math.min(start, end) / 100 + offset / 100, b = Math.max(start, end) / 100 + offset / 100;
    if (b - a >= 1 - 1e-6) return [pl]; if (b - a <= 1e-6) return [];
    const L = S.length(pl); if (L <= 0) return [];
    const p = pl.pts; const n = pl.closed ? p.length : p.length - 1;
    const sub = (f0, f1) => { // f in [0,1], f0<f1
      const d0 = f0 * L, d1 = f1 * L; const out = []; let acc = 0;
      for (let i = 0; i < n; i++) { const A = p[i], B = p[(i + 1) % p.length]; const l = Math.hypot(B[0] - A[0], B[1] - A[1]); const s0 = acc, s1 = acc + l; acc = s1; if (s1 < d0 || s0 > d1 || l === 0) continue;
        const t0 = clamp((d0 - s0) / l, 0, 1), t1 = clamp((d1 - s0) / l, 0, 1); if (!out.length) out.push([A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0]); out.push([A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1]); }
      return out.length > 1 ? { pts: out, closed: false } : null;
    };
    const w = (f) => ((f % 1) + 1) % 1;
    if (pl.closed) { const fa = w(a), fb = fa + (b - a); if (fb <= 1) return [sub(fa, fb)].filter(Boolean); const s1 = sub(fa, 1), s2 = sub(0, fb - 1); if (s1 && s2) return [{ pts: s1.pts.concat(s2.pts.slice(1)), closed: false }]; return [s1, s2].filter(Boolean); }
    return [sub(clamp(a, 0, 1), clamp(b, 0, 1))].filter(Boolean);
  };
  S.bounds = (c, lt) => {
    const sh = c.shape; const pls = S.polylines(sh, lt); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pl of pls) for (const p of pl.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    if (!isFinite(x0)) { const ct = GW.pv(sh.center, lt); return [ct[0] - 40, ct[1] - 40, 80, 80]; }
    const sw = sh.stroke.on ? (GW.pv(sh.stroke.width, lt) || 0) / 2 : 0; return [x0 - sw, y0 - sw, x1 - x0 + sw * 2, y1 - y0 + sw * 2];
  };

  /* ---- rasterize: canvas w×h for a seqW×seqH frame scaled by k ---- */
  S.draw = (clip, lt, w, h, k) => {
    const sh = clip.shape; const key = S.key(sh, lt) + '|' + w + 'x' + h + '|' + k;
    let e = cache.get(clip.id); if (e && e.key === key) return e;
    if (!e) { e = { canvas: document.createElement('canvas') }; cache.set(clip.id, e); }
    const cv = e.canvas; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); if (g.reset) g.reset(); else { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none'; } g.clearRect(0, 0, w, h);
    g.save(); g.scale(k, k);
    try { S.paint(g, sh, lt); } catch (er) { console.error('shape draw', er); }
    g.restore(); e.key = key; e.ver = key; return e;
  };
  S.paint = (g, sh, lt) => {
    let pls = S.polylines(sh, lt); if (!pls.length) return;
    const tr = sh.trim; const ts = GW.pv(tr.start, lt), te = GW.pv(tr.end, lt), to = GW.pv(tr.offset, lt) || 0;
    if (ts !== 0 || te !== 100 || to !== 0) pls = pls.flatMap(pl => S.trim(pl, ts, te, to));
    if (!pls.length) return;
    const path = new Path2D(); for (const pl of pls) { pl.pts.forEach((p, i) => i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])); if (pl.closed) path.closePath(); }
    if (sh.fill.on && sh.type !== 'line') {
      g.globalAlpha = clamp(GW.pv(sh.fill.opacity, lt) / 100, 0, 1);
      const gr = sh.fill.grad;
      if (gr.on) { const c = GW.pv(sh.center, lt), sz = GW.pv(sh.size, lt); const ang = (GW.pv(gr.angle, lt) || 0) * Math.PI / 180; const r = Math.hypot(sz[0], sz[1]) / 2 || 100; let G; if (gr.type === 'radial') G = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], r); else G = g.createLinearGradient(c[0] - Math.cos(ang) * r, c[1] - Math.sin(ang) * r, c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r); G.addColorStop(0, GW.pv(gr.c1, lt)); G.addColorStop(1, GW.pv(gr.c2, lt)); g.fillStyle = G; }
      else g.fillStyle = GW.pv(sh.fill.color, lt);
      g.fill(path, 'nonzero');
    }
    if (sh.stroke.on) {
      const st = sh.stroke; g.globalAlpha = clamp(GW.pv(st.opacity, lt) / 100, 0, 1); g.strokeStyle = GW.pv(st.color, lt); g.lineWidth = Math.max(0, GW.pv(st.width, lt) || 0); g.lineCap = st.cap || 'round'; g.lineJoin = st.join || 'round';
      const dash = Math.max(0, GW.pv(st.dash, lt) || 0), gap = Math.max(0, GW.pv(st.gap, lt) || 0); if (dash > 0) { g.setLineDash([dash, gap || dash]); g.lineDashOffset = -(GW.pv(st.dashOffset, lt) || 0); } else g.setLineDash([]);
      if (g.lineWidth > 0) g.stroke(path);
    }
    g.globalAlpha = 1;
  };
  S.drop = id => cache.delete(id);

  /* ---- new shape clip ---- */
  S.add = (type, o = {}) => {
    const s = GW.seq(); const t = o.start != null ? o.start : s.t; const dur = o.dur || 5;
    let ti = o.ti; if (ti == null) { ti = 0; const tv = GW.TL ? GW.TL.target.v : 0; for (let i = 0; i < s.vt.length; i++) { if (s.vt[i].lock || i < tv) continue; if (!s.clips.some(c => c.tt === 'v' && c.ti === i && c.start < t + dur && c.start + c.dur > t)) { ti = i; break; } ti = -1; } if (ti < 0) { GW.ops.ensureTrack(s, 'v', s.vt.length); ti = s.vt.length - 1; } }
    GW.ops.ensureTrack(s, 'v', ti);
    const name = o.name || (S.TYPES.find(x => x[0] === type) || ['', 'شكل'])[1];
    const c = GW.newClip('shape', { ti, start: t, dur, name, shapeType: type, center: o.center, size: o.size, color: o.color, pts: o.pts, closed: o.closed });
    if (!c.shape) c.shape = S.defaults(type, s, o);
    if (o.insert) GW.ops.rippleInsert(s, t, dur, GW.ops.allTracks(s)); else GW.ops.clear(s, 'v', ti, t, t + dur);
    s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.sel.mask = null; GW.commit('شكل جديد: ' + name); GW.bus.emit('selection'); GW.invalidate();
    if (type === 'path' && !o.pts && GW.TL && GW.TL.setTool) { GW.TL.setTool('pen'); GW.toast('انقر على شاشة البرنامج لإضافة نقاط المسار (اسحب لمقابض بيزييه)، انقر مرتين للإغلاق'); }
    return c;
  };

  /* ---- pen tool on the Program monitor (hooks called from ui_monitors.js) ---- */
  const selShape = () => { if (GW.sel.clips.size !== 1) return null; const c = GW.clipById([...GW.sel.clips][0]); const s = GW.seq(); if (!c || c.kind !== 'shape' || s.t < c.start || s.t >= c.start + c.dur) return null; return c; };
  S.active = () => { const c = selShape(); if (!c) return false; return (GW.TL && GW.TL.tool === 'pen') || (c.shape.type === 'path' && !!S.editing); };
  S.editing = false; let hot = null; // hot: { c, lt, anchors:[{p, in, out}] screen pts }
  S.overlay = (g, PG) => {
    const c = selShape(); if (!c) { hot = null; return; } const lt = GW.seq().t - c.start; const sh = c.shape; const mp = GW.Mon.mapper(c, lt);
    g.save(); g.strokeStyle = 'var(--accent)'; g.strokeStyle = accent(); g.lineWidth = 1.2;
    for (const pl of S.polylines(sh, lt)) { g.beginPath(); pl.pts.forEach((p, i) => { const q = mp(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (pl.closed) g.closePath(); g.stroke(); }
    hot = { c, lt, anchors: [] };
    if (sh.type === 'path') {
      const pts = GW.pv(sh.path.pts, lt) || [];
      pts.forEach((p, i) => { const a = mp(p[0], p[1]); const I = (p[2] || p[3]) ? mp(p[0] + p[2], p[1] + p[3]) : null; const O = (p[4] || p[5]) ? mp(p[0] + p[4], p[1] + p[5]) : null;
        g.strokeStyle = '#bdbdbd'; g.lineWidth = 1; for (const H of [I, O]) if (H) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(H[0], H[1]); g.stroke(); g.fillStyle = accent(); g.beginPath(); g.arc(H[0], H[1], 3.5, 0, 7); g.fill(); }
        g.fillStyle = '#fff'; g.strokeStyle = accent(); g.fillRect(a[0] - 4, a[1] - 4, 8, 8); g.strokeRect(a[0] - 4, a[1] - 4, 8, 8); hot.anchors.push({ i, a, I, O }); });
    } else { const ct = mp(...GW.pv(sh.center, lt)); g.fillStyle = '#fff'; g.beginPath(); g.arc(ct[0], ct[1], 5, 0, 7); g.fill(); }
    g.restore();
  };
  function accent() { return (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#ff6a2b').trim() || '#ff6a2b'; }
  const set = (c, p, lt, v) => { GW.setPv(p, clamp(lt, 0, c.dur), v); GW.invalidate(); GW.bus.emit('param'); };
  S.down = (e, X, Y, ov) => {
    const c = selShape(); if (!c) return false; const lt = GW.seq().t - c.start; const sh = c.shape; const inv = GW.Mon.invMap(c, lt);
    const d = (p) => p ? Math.hypot(p[0] - X, p[1] - Y) : 1e9;
    if (sh.type !== 'path') return false;
    const pts = GW.clone(GW.pv(sh.path.pts, lt) || []);
    let mode = null, idx = -1;
    if (hot && hot.c === c) for (const h of hot.anchors) { if (d(h.O) < 7) { mode = 'out'; idx = h.i; break; } if (d(h.I) < 7) { mode = 'in'; idx = h.i; break; } if (d(h.a) < 8) { mode = 'anchor'; idx = h.i; break; } }
    const pen = GW.TL && GW.TL.tool === 'pen';
    if (!mode) {
      if (!pen) return false;
      if (pts.length > 2 && hot && d(hot.anchors[0].a) < 9) { sh.path.closed = 1; GW.commit('إغلاق المسار'); GW.cmd.tool('select'); return true; } // click on first point closes
      const sp = inv(X, Y).map(v => Math.round(v)); pts.push([sp[0], sp[1], 0, 0, 0, 0]); set(c, sh.path.pts, lt, pts); idx = pts.length - 1; mode = 'new';
    }
    if (e.altKey && mode === 'anchor') { pts.splice(idx, 1); set(c, sh.path.pts, lt, pts); GW.commit('حذف نقطة'); return true; }
    try { ov.setPointerCapture(e.pointerId); } catch (er) {}
    let moved = false; const start = inv(X, Y); const orig = GW.clone(pts[idx]);
    const mv = ev => {
      const r = ov.getBoundingClientRect(); const q = inv(ev.clientX - r.left, ev.clientY - r.top); const dx = q[0] - start[0], dy = q[1] - start[1]; if (Math.abs(dx) + Math.abs(dy) > .5) moved = true; if (!moved) return;
      const p = pts[idx];
      if (mode === 'new') { p[4] = Math.round(dx); p[5] = Math.round(dy); p[2] = -p[4]; p[3] = -p[5]; } // drag while adding: symmetric bezier handles
      else if (mode === 'anchor') { p[0] = Math.round(orig[0] + dx); p[1] = Math.round(orig[1] + dy); }
      else if (mode === 'out') { p[4] = Math.round(orig[4] + dx); p[5] = Math.round(orig[5] + dy); if (!ev.altKey) { p[2] = -p[4]; p[3] = -p[5]; } }
      else if (mode === 'in') { p[2] = Math.round(orig[2] + dx); p[3] = Math.round(orig[3] + dy); if (!ev.altKey) { p[4] = -p[2]; p[5] = -p[3]; } }
      set(c, sh.path.pts, lt, GW.clone(pts)); GW.Mon.redraw();
    };
    const up = () => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); GW.commit(mode === 'new' ? 'إضافة نقطة' : 'تعديل المسار'); if (GW.FXC) GW.FXC.render(); };
    ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up);
    return true;
  };
  S.dbl = () => { const c = selShape(); if (!c || c.shape.type !== 'path') return false; if (GW.TL && GW.TL.tool === 'pen') { GW.cmd.tool('select'); return true; } return false; };

  /* ---- Effect Controls section (uses the row builders exported by ui_fxc.js) ---- */
  S.fxc = (L, c, s, F) => {
    if (c.kind !== 'shape' || !c.shape) return; const sh = c.shape; const { section, row, numCtl, pointCtl, colorCtl, lt } = F.builders;
    const sel = (v, opts, on) => { const el = document.createElement('select'); el.className = 'sel'; for (const [k, n] of opts) { const o = document.createElement('option'); o.value = k; o.textContent = n; el.append(o); } el.value = v; el.onchange = () => { on(el.value); GW.commit('شكل'); GW.invalidate(); F.render(); }; return el; };
    const chk = (v, on) => { const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!v; i.onchange = () => { on(i.checked ? 1 : 0); GW.commit('شكل'); GW.invalidate(); F.render(); }; return i; };
    const sec = section('الشكل', { key: 'shape' });
    sec.body.append(row(c, null, 'النوع', sel(sh.type, S.TYPES, v => { sh.type = v; if (v === 'path' && !(GW.pv(sh.path.pts, 0) || []).length && GW.TL) GW.TL.setTool('pen'); }), { noAnim: true }));
    if (sh.type === 'path') { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = (GW.TL && GW.TL.tool === 'pen') ? 'إنهاء الرسم' : 'رسم بالقلم'; b.onclick = () => { if (GW.TL.tool === 'pen') GW.cmd.tool('select'); else GW.TL.setTool('pen'); F.render(); GW.invalidate(); }; const n = document.createElement('span'); n.style.color = 'var(--mute)'; n.textContent = (GW.pv(sh.path.pts, lt(c)) || []).length + ' نقطة '; const wrap = document.createElement('span'); wrap.style.cssText = 'display:inline-flex;gap:6px;align-items:center'; wrap.append(n, b); sec.body.append(row(c, sh.path.pts, 'المسار', wrap, {})); sec.body.append(row(c, null, 'مغلق', chk(sh.path.closed, v => { sh.path.closed = v; }), { noAnim: true })); }
    sec.body.append(row(c, sh.center, 'المركز', pointCtl(c, sh.center), { def: [s.w / 2, s.h / 2] }));
    if (sh.type !== 'path') sec.body.append(row(c, sh.size, 'الحجم', pointCtl(c, sh.size), { def: [s.w * .4, s.h * .3] }));
    sec.body.append(row(c, sh.rot, 'الدوران', numCtl(c, sh.rot, { step: .5, unit: '°' }), { def: 0 }));
    if (sh.type !== 'ellipse' && sh.type !== 'line') sec.body.append(row(c, sh.round, 'استدارة الزوايا', numCtl(c, sh.round, { min: 0, max: 1000, step: 1 }), { def: 0 }));
    if (sh.type === 'polygon' || sh.type === 'star') sec.body.append(row(c, sh.points, 'عدد النقاط', numCtl(c, sh.points, { min: 3, max: 64, step: 1, dec: 0 }), { def: 5 }));
    if (sh.type === 'star') sec.body.append(row(c, sh.inner, 'نصف القطر الداخلي', numCtl(c, sh.inner, { min: 5, max: 100, step: .5, unit: '%' }), { def: 50 }));
    L.append(sec);
    const fs = section('التعبئة', { key: 'shfill', off: !sh.fill.on, toggle: () => { sh.fill.on = sh.fill.on ? 0 : 1; GW.commit('تعبئة'); GW.invalidate(); F.render(); } });
    fs.body.append(row(c, sh.fill.color, 'اللون', colorCtl(c, sh.fill.color), { def: '#2f8ef0' }));
    fs.body.append(row(c, sh.fill.opacity, 'الشفافية', numCtl(c, sh.fill.opacity, { min: 0, max: 100, step: .5, unit: '%' }), { def: 100 }));
    const gr = sh.fill.grad; fs.body.append(row(c, null, 'تدرج لوني', chk(gr.on, v => { gr.on = v; }), { noAnim: true }));
    if (gr.on) { fs.body.append(row(c, null, 'نوع التدرج', sel(gr.type, [['linear', 'خطي'], ['radial', 'شعاعي']], v => { gr.type = v; }), { noAnim: true })); fs.body.append(row(c, gr.c1, 'لون البداية', colorCtl(c, gr.c1), { def: '#2f8ef0' })); fs.body.append(row(c, gr.c2, 'لون النهاية', colorCtl(c, gr.c2), { def: '#8b5cff' })); fs.body.append(row(c, gr.angle, 'زاوية التدرج', numCtl(c, gr.angle, { step: 1, unit: '°' }), { def: 90 })); }
    L.append(fs);
    const st = sh.stroke; const ss = section('الحد', { key: 'shstroke', off: !st.on, toggle: () => { st.on = st.on ? 0 : 1; GW.commit('حد'); GW.invalidate(); F.render(); } });
    ss.body.append(row(c, st.color, 'اللون', colorCtl(c, st.color), { def: '#ffffff' }));
    ss.body.append(row(c, st.width, 'السماكة', numCtl(c, st.width, { min: 0, max: 500, step: .5 }), { def: 6 }));
    ss.body.append(row(c, st.opacity, 'الشفافية', numCtl(c, st.opacity, { min: 0, max: 100, step: .5, unit: '%' }), { def: 100 }));
    ss.body.append(row(c, null, 'نهاية الخط', sel(st.cap, [['butt', 'مسطحة'], ['round', 'دائرية'], ['square', 'مربعة']], v => { st.cap = v; }), { noAnim: true }));
    ss.body.append(row(c, null, 'الزوايا', sel(st.join, [['miter', 'حادة'], ['round', 'دائرية'], ['bevel', 'مشطوفة']], v => { st.join = v; }), { noAnim: true }));
    ss.body.append(row(c, st.dash, 'طول الشرطة', numCtl(c, st.dash, { min: 0, max: 5000, step: 1 }), { def: 0 }));
    ss.body.append(row(c, st.gap, 'الفجوة', numCtl(c, st.gap, { min: 0, max: 5000, step: 1 }), { def: 0 }));
    ss.body.append(row(c, st.dashOffset, 'إزاحة الشرطات', numCtl(c, st.dashOffset, { step: 1 }), { def: 0 }));
    L.append(ss);
    const tr = sh.trim; const tsec = section('قص المسار (Trim Paths)', { key: 'shtrim' });
    tsec.body.append(row(c, tr.start, 'البداية', numCtl(c, tr.start, { min: 0, max: 100, step: .5, unit: '%' }), { def: 0 }));
    tsec.body.append(row(c, tr.end, 'النهاية', numCtl(c, tr.end, { min: 0, max: 100, step: .5, unit: '%' }), { def: 100 }));
    tsec.body.append(row(c, tr.offset, 'الإزاحة', numCtl(c, tr.offset, { min: -1000, max: 1000, step: .5, unit: '%' }), { def: 0 }));
    const draw = document.createElement('button'); draw.className = 'btn sm'; draw.textContent = 'رسم تلقائي (Draw-on)'; draw.title = 'مفاتيح على النهاية من 0 إلى 100 عبر المقطع'; draw.onclick = () => { const d = Math.min(c.dur, Math.max(.3, c.dur * .6)); tr.end.v = 100; tr.end.k = [{ t: 0, v: 0, e: 'ease' }, { t: d, v: 100, e: 'ease' }]; GW.commit('رسم تلقائي'); GW.invalidate(); F.render(); };
    tsec.body.append(row(c, null, 'حركة', draw, { noAnim: true }));
    L.append(tsec);
  };
})();
