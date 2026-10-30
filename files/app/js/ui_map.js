'use strict';
/* Integrated war-map editing: Maps panel + direct camera/selection control inside the Program monitor */
(function () {
  const A = GW.Atlas, S = A.Scene, G = A.Geo, Cm = A.Cam, V = A.Vec;
  const UI = GW.UI; const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const M = GW.MapUI = { mode: 'nav', layerId: null, hover: null, picked: null, drawing: null };

  /* ---------------- helpers ---------------- */
  const selMap = () => { const c = [...GW.sel.clips].map(id => GW.clipById(id)).find(x => x && x.kind === 'map'); return c && c.map && c.map.scene && c.map.scene.v === 3 ? c : null; };
  M.clip = selMap;
  const lt = (c) => clamp(GW.seq().t - c.start, 0, c.dur) + (c.in || 0);
  const sc = (c) => c.map.scene;
  const layer = (c) => c && sc(c).layers.find(l => l.id === M.layerId) || null;
  const changed = (label, soon) => { GW.invalidate(); if (label) (soon ? GW.commitSoon : GW.commit)(label); };
  const view = (c) => { const s = GW.seq(); return A.evalAt(sc(c), lt(c), c.sw || s.w, c.sh || s.h); };
  // camera currently in effect (for editing)
  const camNow = (c) => Cm.at(sc(c).cam, lt(c), sc(c).mode);
  // write camera values at the playhead (auto-key when keys exist)
  M.setCam = (c, v, label) => {
    GW.mapFast = performance.now(); clearTimeout(M._fastT); M._fastT = setTimeout(() => GW.invalidate(), 400);
    const cam = sc(c).cam; const t = lt(c);
    if (cam.keys && cam.keys.length) {
      const fps = GW.seq().fps; let k = cam.keys.find(k => Math.abs(k.t - t) < .5 / fps);
      if (!k) { const cur = Cm.at({ ...cam, orbit: 0, drift: 0, shake: 0 }, t, sc(c).mode); k = { t, lon: cur.lon, lat: cur.lat, zoom: cur.zoom, tilt: cur.tilt, heading: cur.heading, ease: 'inout' }; cam.keys.push(k); cam.keys.sort((a, b) => a.t - b.t); }
      Object.assign(k, v);
    } else Object.assign(cam, v);
    changed(label || 'تحريك كاميرا الخريطة', true); M.refreshCam();
  };
  M.addKey = (c) => { const cam = sc(c).cam; const t = lt(c); const cur = Cm.at({ ...cam, orbit: 0, drift: 0, shake: 0 }, t, sc(c).mode); cam.keys = cam.keys || []; const fps = GW.seq().fps; const ex = cam.keys.find(k => Math.abs(k.t - t) < .5 / fps); if (ex) Object.assign(ex, cur, { t }); else { cam.keys.push({ t, lon: cur.lon, lat: cur.lat, zoom: cur.zoom, tilt: cur.tilt || 0, heading: cur.heading || 0, ease: 'inout' }); cam.keys.sort((a, b) => a.t - b.t); } changed('مفتاح كاميرا'); renderPanel(); };
  M.flyTo = (c, target, label) => { // target {lon,lat,zoom?,bounds?}
    let v = target.bounds ? Cm.fit(target.bounds, camNow(c).tilt, camNow(c).heading) : { lon: target.lon, lat: target.lat, zoom: target.zoom || Math.max(camNow(c).zoom, 5) };
    M.flyAnim(c, { lon: v.lon, lat: v.lat, zoom: v.zoom });
  };

  /* ---------------- clip creation ---------------- */
  function freeVTrack(s, t, dur) { for (let i = 0; i < s.vt.length; i++) { if (s.vt[i].lock) continue; if (!s.clips.some(c => c.tt === 'v' && c.ti === i && c.start < t + dur && c.start + c.dur > t)) return i; } GW.ops.ensureTrack(s, 'v', s.vt.length); return s.vt.length - 1; }
  UI.addMapClip = (scene, opts = {}) => {
    const s = GW.seq(); const scn = scene && scene.v === 3 ? scene : A.newScene(); const dur = opts.dur || 10;
    const ti = opts.ti != null ? opts.ti : freeVTrack(s, s.t, dur);
    const c = GW.newClip('map', { ti, start: opts.start != null ? opts.start : s.t, dur, name: opts.name || 'خريطة', scene: scn });
    c.map.bg = opts.bg || 'full'; s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.commit('إضافة خريطة'); GW.bus.emit('selection');
    if (opts.open !== false) UI.openMapEditor(c); return c;
  };
  UI.openMapEditor = (c) => {
    c = c || selMap(); if (!c) { GW.toast('حدد مقطع خريطة أولاً'); return; }
    if (!c.map.scene || c.map.scene.v !== 3) { c.map.scene = A.newScene(); GW.toast('تم تحويل الخريطة القديمة إلى المحرك الجديد'); }
    { const s0 = GW.seq(); if (c.sw && c.sh && Math.abs(c.sw / c.sh - s0.w / s0.h) > .01 && c.motion) { c.sw = s0.w; c.sh = s0.h; c.motion.anchor = GW.P([s0.w / 2, s0.h / 2]); if (!GW.isAnim(c.motion.pos)) c.motion.pos = GW.P([s0.w / 2, s0.h / 2]); if (!GW.isAnim(c.motion.scale)) c.motion.scale = GW.P(100); GW.commit('ملاءمة الخريطة للإطار'); GW.toast('تم ضبط مقطع الخريطة ليملأ إطار التسلسل'); } } // map clips made for another aspect (e.g. 16:9 pasted into 9:16) must always fill the frame
    GW.sel.clips.clear(); GW.sel.clips.add(c.id); const s = GW.seq(); if (s.t < c.start || s.t >= c.start + c.dur) GW.seek(c.start + .01);
    GW.bus.emit('selection'); if (GW.setWorkspace && GW.active.ws !== 'maps') GW.setWorkspace('maps'); GW.showPanel('maps'); M.mode = 'nav'; renderPanel();
  };

  /* ---------------- quick builders ---------------- */
  const keyOf = (name, era) => { const fs = G.features(era, 0) || []; const r = G.search(name, fs, 'ar', era, 5).find(x => x.kind === 'country'); return r ? r.f : null; };
  const unionBounds = (fs) => { let w = 180, s0 = 90, e = -180, n = -90; for (const f of fs) { const b = f.bounds; let bw = b[0][0], be = b[1][0]; if (be < bw) { bw = -180; be = 180; } w = Math.min(w, bw); e = Math.max(e, be); s0 = Math.min(s0, b[0][1]); n = Math.max(n, b[1][1]); } return [[w, s0], [e, n]]; };
  // camera framing the targets (and the attacker's border facing them) — robust to huge / antimeridian countries
  function fitFeats(F, Ts, frac) {
    const pts = Ts.map(f => f.lab); if (F) { for (const T of Ts) { let best = null, bd = 9; const cs = F.geometry.type === 'Polygon' ? [F.geometry.coordinates] : F.geometry.coordinates; for (const poly of cs) for (const p of poly[0]) { const d = d3.geoDistance(p, T.lab); if (d < bd) { bd = d; best = p; } } if (best) pts.push(best); } }
    const cen = d3.geoCentroid({ type: 'MultiPoint', coordinates: pts });
    let r = 0; for (const T of Ts) r = Math.max(r, d3.geoDistance(cen, T.lab) + Math.min(T.rad, .35) * .9); for (const p of pts) r = Math.max(r, d3.geoDistance(cen, p) * 1.15);
    return { lon: cen[0], lat: cen[1], zoom: Math.max(1.5, Math.min(14, Cm.zoomForSpan(Math.max(.01, 2 * r), cen[1], frac))), tilt: 0, heading: 0 };
  }
  M.quickInvasion = async (o) => {
    await G.load(); const year = +o.year || 2025; const era = G.era(year, 'auto'); await G.ensureEra(era, 0);
    const F = keyOf(o.from, era); const Ts = o.targets.map(n => keyOf(n, era));
    if (!F) { GW.toast('لم أتعرف على الدولة المهاجمة: ' + o.from, 'err'); return; }
    if (!Ts.length || Ts.some(x => !x)) { GW.toast('تحقق من أسماء الدول المستهدفة', 'err'); return; }
    const scn = A.newScene({ style: o.style || 'doc_dark', mode: o.mode || 'globe', year: GW.P(year) });
    const dur = 4 + Ts.length * 1.6 + 5;
    const wide = fitFeats(F, Ts, .62), tight = fitFeats(null, Ts, .8); tight.tilt = 35;
    scn.cam.keys = [{ t: 0, ...wide, zoom: wide.zoom - .6, ease: 'inout' }, { t: 1.6, ...wide, ease: 'inout' }, { t: 1.6 + 2.4 + Ts.length * .8, ...tight, ease: 'inout' }, { t: dur, ...tight, zoom: tight.zoom + .25, heading: 6, ease: 'linear' }];
    scn.layers.push(S.newLayer('invasion', { from: F.key, to: Ts.map(f => f.key), color: o.color || '#e5243b', start: 1.2, inDur: 2.6, arrowStyle: o.arrow || 'military' }));
    if (o.date) scn.layers.push(S.newLayer('date', { start: .3 }));
    if (o.headline) scn.layers.push(S.newLayer('title', { text: o.headline, sub: o.sub || '', start: 2.2, template: 'breaking', color: o.color || '#e5243b' }));
    UI.addMapClip(scn, { dur: Math.ceil(dur), name: 'غزو: ' + G.name(F, 'ar', era) });
  };
  M.quickTimeline = async (o) => {
    await G.load(); const y0 = +o.y0, y1 = +o.y1; const scn = A.newScene({ style: o.style || 'political', mode: o.mode || 'globe' });
    const dur = Math.max(4, +o.dur || 12); scn.year = GW.P(y0); GW.setPv && (scn.year = { v: y0, k: [{ t: .5, v: y0, e: 'linear' }, { t: dur - .5, v: y1, e: 'linear' }] });
    if (o.region) { const era = G.era(y1, 'auto'); await G.ensureEra(era, 0); const f = keyOf(o.region, era); if (f) { const v = Cm.fit(f.bounds, 0, 0, .55); Object.assign(scn.cam, v); } }
    scn.layers.push(S.newLayer('date', { pos: 'tr', format: 'auto' }));
    UI.addMapClip(scn, { dur, name: 'الحدود ' + G.fmtYear(y0) + ' → ' + G.fmtYear(y1) });
  };

  /* ================= Program monitor integration ================= */
  // returns {c, toMap(X,Y)->[mx,my], toScreen(mx,my)->[X,Y], vw} for the selected map clip under the playhead
  function ctx() {
    const c = selMap(); if (!c || !GW.Mon) return null; const s = GW.seq(); if (s.t < c.start || s.t >= c.start + c.dur) return null;
    const t = s.t - c.start; const inv = GW.Mon.invMap(c, t), fw = GW.Mon.mapper(c, t);
    const { vw, era } = view(c); return { c, t, toMap: inv, toScreen: fw, vw, era };
  }
  M.active = () => M.mode !== 'off' && !!ctx();
  const pickAt = (k, X, Y) => { const [mx, my] = k.toMap(X, Y); return k.vw.pick(mx, my); };
  // keep geographic point ll under screen point (X,Y) by moving the camera
  function anchorPan(k, ll, X, Y, base) {
    const c = k.c; const s = GW.seq(); let cam = { ...base };
    for (let i = 0; i < 4; i++) {
      const vw = Cm.build(cam, c.sw || s.w, c.sh || s.h, sc(c).mode); const [mx, my] = k.toMap(X, Y); const q = vw.pick(mx, my); if (!q) break;
      cam.lon = Cm.wrap(cam.lon + Cm.wrap(ll[0] - q[0])); cam.lat = clamp(cam.lat + (ll[1] - q[1]), -85, 85);
    }
    return cam;
  }
  M.down = (e, X, Y) => {
    const k = ctx(); if (!k || M.mode === 'off') return false;
    const c = k.c; const L = layer(c); const s = GW.seq(); const ll = pickAt(k, X, Y);
    // drawing / placing on the active layer
    if (M.mode === 'draw' && L) {
      const pts = drawPts(L, k); const hitI = pts ? pts.findIndex(p => { const sp = k.vw.project(p[0], p[1]); if (!sp) return false; const q = k.toScreen(sp[0], sp[1]); return Math.hypot(q[0] - X, q[1] - Y) < 9; }) : -1;
      if (hitI >= 0) { dragPoint(e, k, L, hitI); return true; }
      if (!ll) return true; addPoint(k, L, ll); return true;
    }
    if (M.mode === 'place' && L) { if (ll) { const tt = +(k.t + (c.in || 0) - (L.start || 0)).toFixed(3); for (const [q, v] of [['lon', +ll[0].toFixed(4)], ['lat', +ll[1].toFixed(4)]]) { if (L[q] && typeof L[q] === 'object') GW.setPv(L[q], tt, v); else L[q] = v; } changed('تحديد الموقع'); renderLayerProps(); } return true; }
    if (M.mode === 'pick' && L) { const f = ll && G.hit(A.last && A.last.era && A.last.era.id === k.era.id ? A.last.feats : G.features(k.era, 0), ll); if (f) togglePick(c, L, f); return true; }
    // navigation
    const base = camNow(c); const right = e.button === 2 || e.altKey; const x0 = e.clientX, y0 = e.clientY; let moved = false;
    const ov = e.target; ov.setPointerCapture(e.pointerId);
    M.stopAnim(); const hist = []; const r0 = ov.getBoundingClientRect();
    const mv = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0; if (Math.hypot(dx, dy) > 3) moved = true; if (!moved) return;
      hist.push([performance.now(), ev.clientX, ev.clientY]); if (hist.length > 6) hist.shift();
      if (right) M.setCam(c, { heading: (base.heading || 0) - dx * .3, tilt: sc(c).mode === 'flat' ? 0 : clamp((base.tilt || 0) - dy * .25, 0, 78) });
      else if (ll) { const cam = anchorPan(k, ll, ev.clientX - r0.left, ev.clientY - r0.top, base); M.setCam(c, { lon: cam.lon, lat: cam.lat }); }
    };
    const up = (ev) => {
      ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up);
      if (!moved && !right && ll) { const f = G.hit(G.features(k.era, G.lodFor(k.vw.zoom)) || G.features(k.era, 0), ll); M.picked = f ? { key: f.key, name: G.name(f, 'ar', k.era), ll } : { ll }; renderPicked(); GW.invalidate(); return; }
      // inertia (Google-Earth-like fling)
      const now = performance.now(); const h0 = hist.find(q => now - q[0] < 120); const h1 = hist[hist.length - 1];
      if (!right && h0 && h1 && h1[0] > h0[0] && now - h1[0] < 60) {
        let vx = (h1[1] - h0[1]) / (h1[0] - h0[0]), vy = (h1[2] - h0[2]) / (h1[0] - h0[0]);
        if (Math.hypot(vx, vy) > .25) { let lx = ev.clientX - r0.left, ly = ev.clientY - r0.top; let last = now;
          M.anim(() => { const k2 = ctx(); if (!k2) return false; const t = performance.now(); const dt = Math.min(40, t - last); last = t; const gll = pickAt(k2, lx, ly); if (!gll) return false; lx += vx * dt; ly += vy * dt; vx *= Math.pow(.9, dt / 16); vy *= Math.pow(.9, dt / 16); const cam = anchorPan(k2, gll, lx, ly, camNow(c)); M.setCam(c, { lon: cam.lon, lat: cam.lat }); return Math.hypot(vx, vy) > .02; }, () => GW.commit('تحريك كاميرا الخريطة'));
          return; }
      }
      GW.commit('تحريك كاميرا الخريطة');
    };
    ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up);
    return true;
  };
  // small animation runner (one at a time): step() returns false to finish
  M.anim = (step, done) => { M.stopAnim(); const id = M._animId = {}; const tick = () => { if (M._animId !== id) return; let go = false; try { go = step(); } catch (err) { go = false; } if (go) requestAnimationFrame(tick); else { M._animId = null; if (done) done(); } }; requestAnimationFrame(tick); };
  M.stopAnim = () => { M._animId = null; };
  // smooth, cursor-anchored zoom: wheel ticks accumulate into a target that the camera eases to
  M.wheel = (e, X, Y) => {
    const k = ctx(); if (!k || M.mode === 'off' || e.ctrlKey) return false;
    const c = k.c; const dz = -e.deltaY * (e.deltaMode === 1 ? .06 : .0028) * (e.shiftKey ? .25 : 1);
    const cur = camNow(c); if (!M._z || M._z.c !== c.id || !M._animId) M._z = { c: c.id, target: cur.zoom };
    M._z.target = clamp(M._z.target + dz, 0, 20); M._z.X = X; M._z.Y = Y;
    if (!M._animId || !M._zooming) { M._zooming = true;
      M.anim(() => { const k2 = ctx(); if (!k2) return false; const b = camNow(c); const diff = M._z.target - b.zoom; if (Math.abs(diff) < .003) return false;
        const ll = pickAt(k2, M._z.X, M._z.Y); let cam = { ...b, zoom: b.zoom + diff * .28 }; if (ll) cam = anchorPan(k2, ll, M._z.X, M._z.Y, cam);
        M.setCam(c, { lon: cam.lon, lat: cam.lat, zoom: +cam.zoom.toFixed(4) }, 'تقريب الخريطة'); return true; }, () => { M._zooming = false; GW.commitSoon('تقريب الخريطة'); });
    }
    return true;
  };
  M.dbl = (X, Y) => { const k = ctx(); if (!k || M.mode !== 'nav') return false; const ll = pickAt(k, X, Y); if (!ll) return true; const f = G.hit(G.features(k.era, 0), ll); const to = f ? Cm.fit(f.bounds, camNow(k.c).tilt, camNow(k.c).heading) : { ...camNow(k.c), lon: ll[0], lat: ll[1], zoom: camNow(k.c).zoom + 1.5 }; M.flyAnim(k.c, to); return true; };
  // animated fly (van Wijk) between the current camera and a target, ~1.2 s
  M.flyAnim = (c, to, dur = 1.2) => { const from = camNow(c); const t0 = performance.now(); const path = { keys: [{ t: 0, ...from, ease: 'inout' }, { t: 1, lon: to.lon, lat: to.lat, zoom: to.zoom, tilt: to.tilt != null ? to.tilt : from.tilt, heading: to.heading != null ? to.heading : from.heading }] };
    M.anim(() => { const p = Math.min(1, (performance.now() - t0) / (dur * 1000)); const v = Cm.at(path, p, sc(c).mode); M.setCam(c, { lon: v.lon, lat: v.lat, zoom: v.zoom, tilt: v.tilt, heading: v.heading }); return p < 1; }, () => { GW.commit('انتقال الكاميرا'); renderPanel(); }); };
  M.move = (X, Y) => { const k = ctx(); if (!k) return; const ll = pickAt(k, X, Y); const f = ll && (M.mode === 'pick' || M.mode === 'nav') ? G.hit(G.features(k.era, 0), ll) : null; const h = f ? G.name(f, 'ar', k.era) : null; const ch = (M.hover && M.hover.n) !== h || M.mode === 'draw'; M.hover = { n: h, X, Y, ll, f }; if (ch) GW.Mon && GW.Mon.redraw(); };
  M.overlay = (g) => {
    const k = ctx(); if (!k || M.mode === 'off') return false; const c = k.c; const L = layer(c);
    const sp = (p) => { const q = k.vw.project(p[0], p[1]); return q ? k.toScreen(q[0], q[1]) : null; };
    // selection outline of picked/hovered countries
    const outline = (f, col, w) => { if (!f) return; const path = d3.geoPath(k.vw.proj); const mk = []; g.save(); g.beginPath(); const dpath = d3.geoPath(d3.geoTransform({ point(x, y) { const q = k.vw.proj([x, y]); if (!q) return; const s2 = k.toScreen(q[0], q[1]); this.stream.point(s2[0], s2[1]); } }), g); void path; void mk; g.restore(); };
    void outline;
    if (M.hover && M.hover.n && (M.mode === 'pick' || M.mode === 'nav')) { g.font = '600 12px Cairo, sans-serif'; const w = g.measureText(M.hover.n).width + 14; g.fillStyle = 'rgba(10,14,20,.85)'; g.fillRect(M.hover.X + 12, M.hover.Y + 10, w, 22); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl'; g.fillText(M.hover.n, M.hover.X + 12 + w / 2, M.hover.Y + 21); g.direction = 'ltr'; }
    if (L && (M.mode === 'draw' || M.mode === 'place')) {
      const pts = M.mode === 'draw' ? drawPts(L, k) : [[GW.pv(L.lon, k.t + (c.in || 0) - (L.start || 0)), GW.pv(L.lat, k.t + (c.in || 0) - (L.start || 0))]];
      g.strokeStyle = '#ffd34d'; g.fillStyle = '#ffd34d'; g.lineWidth = 1.5; g.beginPath(); let first = true;
      for (const p of pts || []) { const q = sp(p); if (!q) { first = true; continue; } first ? g.moveTo(q[0], q[1]) : g.lineTo(q[0], q[1]); first = false; }
      if (L.type === 'front' && pts && pts.length > 2) g.closePath(); g.stroke();
      for (const p of pts || []) { const q = sp(p); if (q) { g.fillRect(q[0] - 4, q[1] - 4, 8, 8); } }
    }
    // mode badge
    const badge = { nav: 'تحريك الكاميرا: اسحب • عجلة للتقريب • زر أيمن للإمالة والدوران • نقرتان على دولة للتقريب', pick: 'اختيار الدول: انقر على الدول لإضافتها أو إزالتها', draw: 'رسم: انقر لإضافة نقاط • اسحب نقطة لتحريكها', place: 'انقر على الخريطة لتحديد الموقع' }[M.mode];
    if (badge) { const box = GW.Mon.box(); g.font = '600 11px Cairo, sans-serif'; const w = g.measureText(badge).width + 16; g.fillStyle = 'rgba(10,14,20,.72)'; g.fillRect(box.x + box.w - w - 8, box.y + 8, w, 22); g.fillStyle = '#9fd0ff'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.direction = 'rtl'; g.fillText(badge, box.x + box.w - 16, box.y + 19); g.direction = 'ltr'; }
    return true;
  };
  function drawPts(L, k) { if (L.type === 'front') { if (L.shapes && L.shapes.length) { const t = k.t - (L.start || 0); return V.frontRing(L, t) || []; } return L.pts || []; } return L.pts || []; }
  function addPoint(k, L, ll) {
    const p = [+ll[0].toFixed(4), +ll[1].toFixed(4)];
    if (L.type === 'front' && L.shapes && L.shapes.length) { const t = k.t - (L.start || 0); let sh = L.shapes.find(s => Math.abs(s.t - t) < .05); if (!sh) { sh = { t, pts: GW.clone(V.frontRing(L, t) || []) }; L.shapes.push(sh); L.shapes.sort((a, b) => a.t - b.t); } sh.pts.push(p); }
    else { L.pts = L.pts || []; L.pts.push(p); }
    changed('إضافة نقطة', true); renderLayerProps();
  }
  function dragPoint(e, k, L, i) {
    const ov = e.target; ov.setPointerCapture(e.pointerId); const r = ov.getBoundingClientRect();
    let arr = L.pts; if (L.type === 'front' && L.shapes && L.shapes.length) { const t = k.t - (L.start || 0); let sh = L.shapes.find(s => Math.abs(s.t - t) < .05); if (!sh) { sh = { t, pts: GW.clone(V.frontRing(L, t) || []) }; L.shapes.push(sh); L.shapes.sort((a, b) => a.t - b.t); } arr = sh.pts; }
    const mv = (ev) => { const ll = pickAt(k, ev.clientX - r.left, ev.clientY - r.top); if (ll) { arr[i] = [+ll[0].toFixed(4), +ll[1].toFixed(4)]; GW.invalidate(); } };
    const up = () => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); GW.commit('تحريك نقطة'); };
    ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up);
  }
  function togglePick(c, L, f) {
    if (L.type === 'invasion') { if (M.pickRole === 'from') L.from = f.key; else { L.to = L.to || []; const i = L.to.indexOf(f.key); i >= 0 ? L.to.splice(i, 1) : L.to.push(f.key); } }
    else { L.keys = L.keys || []; const i = L.keys.indexOf(f.key); i >= 0 ? L.keys.splice(i, 1) : L.keys.push(f.key); }
    changed('اختيار دولة'); renderLayerProps();
  }

  /* ================= pin timeline layers to the map (GeoLayers-style "map-to-comp") ================= */
  // The pinned clip's position (and optionally scale/opacity) is baked to per-frame keyframes from the map camera,
  // so it renders identically in preview and export and works with every other feature.
  M.pinClip = (clip, mapClip, lon, lat, opts = {}) => {
    clip.geo = Object.assign({ map: mapClip.id, lon, lat, scale: 0, dx: 0, dy: 0, hide: 1 }, clip.geo && clip.geo.map === mapClip.id ? clip.geo : {}, opts, { lon, lat, map: mapClip.id });
    if (clip.geo.s0 == null) clip.geo.s0 = GW.pv(clip.motion.scale, 0);
    M.bakePin(clip); GW.commit('تثبيت طبقة على الخريطة'); GW.invalidate();
  };
  M.unpinClip = (clip) => { if (!clip.geo) return; const t = GW.seq().t - clip.start; const p = GW.pv(clip.motion.pos, Math.max(0, t)); clip.motion.pos = GW.P(p); if (clip.geo.s0 != null) clip.motion.scale = GW.P(clip.geo.s0); if (clip.geo.hide) clip.opacity = GW.P(100); delete clip.geo; GW.commit('إلغاء التثبيت'); GW.invalidate(); };
  M.bakePin = (clip) => {
    const s = GW.seq(); const g = clip.geo; if (!g) return; const mc = s.clips.find(x => x.id === g.map); if (!mc || !mc.map || !mc.map.scene) return;
    const fps = s.fps || 30; const n = Math.max(1, Math.ceil(clip.dur * fps)); const W = mc.sw || s.w, H = mc.sh || s.h;
    const pk = [], sk = [], ok = []; let lastP = null, lastVis = null; const z0 = (() => { const t0 = Math.max(0, clip.start - mc.start); return A.evalAt(mc.map.scene, t0 + (mc.in || 0), W, H).cam.zoom; })();
    const mpos = GW.pv(mc.motion.pos, 0), msc = GW.pv(mc.motion.scale, 0) / 100;
    for (let f = 0; f <= n; f++) {
      const lt = Math.min(clip.dur, f / fps); const ts = clip.start + lt; const ml = Math.max(0, Math.min(mc.dur, ts - mc.start)) + (mc.in || 0);
      const ev = A.evalAt(mc.map.scene, ml, W, H); const pr = ev.vw.project(g.lon, g.lat); const vis = !!pr;
      const p = pr ? [mpos[0] + (pr[0] - W / 2) * msc + g.dx, mpos[1] + (pr[1] - H / 2) * msc + g.dy] : lastP || [s.w / 2, s.h / 2];
      pk.push({ t: lt, v: [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10], e: 'linear' }); lastP = p;
      if (g.scale) sk.push({ t: lt, v: Math.max(1, Math.min(2000, g.s0 * Math.pow(2, (ev.cam.zoom - z0) * .5))), e: 'linear' });
      if (g.hide && vis !== lastVis) { ok.push({ t: lt, v: vis ? 100 : 0, e: 'hold' }); lastVis = vis; }
    }
    clip.motion.pos = { v: pk[0].v, k: pk };
    clip.motion.scale = g.scale ? { v: sk[0].v, k: sk } : GW.P(g.s0);
    if (g.hide) clip.opacity = ok.length > 1 ? { v: ok[0].v, k: ok } : GW.P(ok.length ? ok[0].v : 100);
  };
  let pinT = 0; GW.bus.on('changed', () => { clearTimeout(pinT); pinT = setTimeout(() => { let any = false; for (const c of GW.seq().clips) if (c.geo) { M.bakePin(c); any = true; } if (any) GW.invalidate(); }, 250); });
  function pinSec(c) {
    const s = GW.seq(); const s0 = sec('دمج الطبقات مع الخريطة', false, 'pins');
    const cands = s.clips.filter(x => x.tt === 'v' && x !== c && x.ti > c.ti && x.start < c.start + c.dur && x.start + x.dur > c.start && x.kind !== 'adjust');
    s0.body.append(h('div', 'mp-note', 'ثبّت أي نص أو صورة أو فيديو فوق الخريطة على نقطة جغرافية ليتحرك مع الكاميرا تماماً. اختر النقطة بالنقر على الخريطة في وضع «كاميرا» ثم اضغط «تثبيت هنا».'));
    const where = M.picked && M.picked.ll ? M.picked.ll : [camNow(c).lon, camNow(c).lat];
    s0.body.append(h('div', 'mp-note', `النقطة الحالية: ${where[0].toFixed(3)}°, ${where[1].toFixed(3)}°`));
    if (!cands.length) s0.body.append(h('div', 'mp-note', 'لا توجد طبقات فوق مقطع الخريطة. أضف نصاً أو صورة على مسار أعلى من الخريطة.'));
    for (const x of cands) {
      const r = h('div', 'mp-layer'); const nm = h('span', 'nm'); nm.textContent = x.name + (x.geo ? '  • مثبّت' : ''); r.append(nm);
      if (x.geo) { r.append(btn('نقل إلى النقطة', () => { M.pinClip(x, c, where[0], where[1]); renderPanel(); }), btn(x.geo.scale ? 'حجم ثابت' : 'يتغير مع التقريب', () => { x.geo.scale = x.geo.scale ? 0 : 1; M.bakePin(x); GW.commit('تثبيت'); renderPanel(); }), btn('إلغاء', () => { M.unpinClip(x); renderPanel(); })); }
      else r.append(btn('تثبيت هنا', () => { M.pinClip(x, c, where[0], where[1]); renderPanel(); }, 'pri'));
      s0.body.append(r);
    }
    s0.body.append(btn(GW.ico('plus', 13) + ' نص مثبّت على هذه النقطة', () => { const ti = (() => { let t = c.ti + 1; GW.ops.ensureTrack(s, 'v', t); return t; })(); const tc = GW.newClip('text', { ti, start: Math.max(c.start, s.t), dur: Math.min(5, c.start + c.dur - Math.max(c.start, s.t)) || 3, name: 'نص مثبّت' }); tc.text.str = M.picked && M.picked.name ? M.picked.name : 'نص'; tc.text.size = 54; s.clips.push(tc); M.pinClip(tc, c, where[0], where[1], { dy: -40 }); GW.sel.clips.clear(); GW.sel.clips.add(c.id); renderPanel(); }));
    return s0;
  }

  /* ================= Maps panel ================= */
  let P = null; // panel root
  GW.registerPanel('maps', 'الخرائط', (el) => { P = el; el.classList.add('mp-root'); renderPanel(); });
  GW.bus.on('selection', () => { const c = selMap(); if (c && M.lastClip !== c.id) { M.layerId = null; M.lastClip = c.id; if (M.mode !== 'off') M.mode = 'nav'; } renderPanel(); });
  GW.bus.on('project', () => renderPanel());
  GW.bus.on('time', () => { if (!GW.pb.playing) M.refreshCam(); });
  GW.bus.on('history', () => renderPanel());

  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const row = (label, ...ctl) => { const r = h('div', 'frow'); const l = h('label'); l.textContent = label; const c = h('div', 'ctl'); c.append(...ctl); r.append(l, c); return r; };
  const num = (v, step, on, opts = {}) => { const i = h('input', 'inp num'); i.type = 'number'; i.step = step; if (opts.min != null) i.min = opts.min; if (opts.max != null) i.max = opts.max; i.value = v; i.onkeydown = e => e.stopPropagation(); i.onchange = () => on(+i.value); return i; };
  const txt = (v, on, ph) => { const i = h('input', 'inp'); i.value = v || ''; if (ph) i.placeholder = ph; i.onkeydown = e => e.stopPropagation(); i.oninput = () => on(i.value); return i; };
  const sel = (opts, v, on) => { const s = h('select', 'sel'); for (const [k, n] of opts) { const o = h('option'); o.value = k; o.textContent = n; s.append(o); } s.value = v; s.onchange = () => on(s.value); return s; };
  const chk = (v, on) => { const i = h('input'); i.type = 'checkbox'; i.checked = !!v; i.onchange = () => on(i.checked ? 1 : 0); return i; };
  const col = (v, on) => { const i = h('input'); i.type = 'color'; i.value = v; i.oninput = () => on(i.value); i.onchange = () => GW.commit('لون'); return i; };
  const rng = (v, min, max, step, on) => { const w = h('span', 'rngw'); const i = h('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = v; const o = h('span', 'val'); o.textContent = +(+v).toFixed(2); i.oninput = () => { o.textContent = +(+i.value).toFixed(2); on(+i.value); }; i.onchange = () => GW.commit('تعديل'); w.append(i, o); return w; };
  const btn = (label, on, cls) => { const b = h('button', 'btn sm' + (cls ? ' ' + cls : '')); b.innerHTML = label; b.onclick = on; return b; };
  const sec = (title, open = true, id) => { const d = h('details', 'mp-sec'); if (open) d.open = true; const s = h('summary'); s.textContent = title; d.append(s); if (id) { d.dataset.id = id; const st = M.secOpen && M.secOpen[id]; if (st != null) d.open = st; d.ontoggle = () => { (M.secOpen = M.secOpen || {})[id] = d.open; }; } const b = h('div', 'mp-body'); d.append(b); d.body = b; return d; };

  function renderPanel() {
    if (!P) return; const c = selMap(); const old = P.querySelector('.pscroll.mp'); const keepTop = old ? old.scrollTop : 0; const fe = document.activeElement; const feKey = fe && P.contains(fe) && fe.dataset ? fe.dataset.k || null : null; P.innerHTML = '';
    const scroll = h('div', 'pscroll mp'); P.append(scroll);
    // keep the scroll position after every change (the panel is rebuilt on each edit)
    requestAnimationFrame(() => { scroll.scrollTop = keepTop; if (feKey) { const n = scroll.querySelector(`[data-k="${feKey}"]`); if (n && n.focus) n.focus({ preventScroll: true }); } }); scroll.scrollTop = keepTop;
    if (!c) { scroll.append(...welcome()); return; }
    const scn = sc(c);
    // header + mode switch
    const head = h('div', 'mp-head'); head.innerHTML = `<div class="mp-title"><b>${esc(c.name)}</b><span>${esc(G.precision(G.era(GW.pv(scn.year, lt(c)), scn.eraMode)).ar)}</span></div>`;
    const modes = h('div', 'seg mp-modes'); for (const [k, n] of [['nav', 'كاميرا'], ['pick', 'اختيار'], ['draw', 'رسم'], ['place', 'موضع'], ['off', 'تحويل']]) { const b = h('button'); b.textContent = n; b.classList.toggle('on', M.mode === k); b.onclick = () => { M.mode = k; renderPanel(); GW.invalidate(); }; modes.append(b); }
    head.append(modes); scroll.append(head);
    scroll.append(searchBox(c));
    if (M.picked && M.picked.key) scroll.append(pickedBox(c));
    scroll.append(eraSec(c), camSec(c), styleSec(c), lookSec(c), layersSec(c), pinSec(c));
  }
  M.render = renderPanel;
  function renderPicked() { renderPanel(); }

  function welcome() {
    const out = [];
    const hero = h('div', 'mp-hero', `<h3>خرائط حربية وتاريخية</h3><p>كرة أرضية ثلاثية الأبعاد بصور فضائية عالية الدقة، وحدود دقيقة لأي تاريخ من 123 ألف سنة قبل الميلاد حتى اليوم. أنشئ مقطع خريطة ثم عدّل عليه مباشرة في شاشة البرنامج.</p>`);
    const b1 = btn(GW.ico('globe') + ' كرة أرضية جديدة', () => UI.addMapClip(A.newScene({ mode: 'globe' })), 'pri'); const b2 = btn(GW.ico('map') + ' خريطة مسطحة جديدة', () => UI.addMapClip(A.newScene({ mode: 'flat', style: 'political', cam: { lon: 30, lat: 30, zoom: 3, tilt: 0, heading: 0, keys: [] } })));
    hero.append(h('div', 'mp-row')); hero.lastChild.append(b1, b2); out.push(hero);
    // quick invasion
    const s1 = sec('غزو سريع (مشهد كامل تلقائي)', true, 'qi'); const q = M.qi || (M.qi = { from: 'روسيا', targets: 'أوكرانيا', year: 2022, style: 'satellite', mode: 'globe', color: '#e5243b', headline: 'عاجل | بدء الهجوم', date: 1, arrow: 'military' });
    s1.body.append(row('المهاجم', txt(q.from, v => q.from = v, 'اسم الدولة')), row('الأهداف', txt(q.targets, v => q.targets = v, 'مفصولة بفاصلة')), row('السنة', num(q.year, 1, v => q.year = v)),
      row('النمط', sel(S.STYLE_ORDER.map(k => [k, S.STYLES[k].ar]), q.style, v => q.style = v)), row('العرض', sel([['globe', 'كرة أرضية'], ['flat', 'مسطحة']], q.mode, v => q.mode = v)),
      row('السهم', sel([['military', 'سهم عسكري'], ['line', 'خط'], ['dashed', 'متقطع'], ['double', 'مزدوج']], q.arrow, v => q.arrow = v)), row('اللون', col(q.color, v => q.color = v)), row('العنوان', txt(q.headline, v => q.headline = v)), row('عداد التاريخ', chk(q.date, v => q.date = v)),
      btn('إنشاء مشهد الغزو', () => M.quickInvasion({ ...q, targets: q.targets.split(/[,،]+/).map(x => x.trim()).filter(Boolean) }), 'pri'));
    out.push(s1);
    const s2 = sec('الحدود عبر الزمن', false, 'qt'); const qt = M.qt || (M.qt = { y0: 1914, y1: 1945, region: 'ألمانيا', dur: 15, style: 'political' });
    s2.body.append(row('من سنة', num(qt.y0, 1, v => qt.y0 = v)), row('إلى سنة', num(qt.y1, 1, v => qt.y1 = v)), row('المنطقة', txt(qt.region, v => qt.region = v, 'دولة للتركيز (اختياري)')), row('المدة (ث)', num(qt.dur, 1, v => qt.dur = v)), row('النمط', sel(S.STYLE_ORDER.map(k => [k, S.STYLES[k].ar]), qt.style, v => qt.style = v)), btn('إنشاء المشهد', () => M.quickTimeline(qt), 'pri'));
    out.push(s2);
    const s = GW.seq(); const cs = s.clips.filter(c => c.kind === 'map');
    const s3 = sec('مقاطع الخرائط في التسلسل', true, 'ql'); if (!cs.length) s3.body.append(h('div', 'mp-empty', 'لا توجد مقاطع خرائط بعد.'));
    for (const c of cs) { const r = h('div', 'mk-i', `<i style="background:${esc(c.label)}"></i><span style="flex:1">${esc(c.name)}</span><span class="kv">${GW.fmtTC(c.start, s.fps)}</span>`); r.onclick = () => UI.openMapEditor(c); s3.body.append(r); }
    out.push(s3); return out;
  }
  function searchBox(c) {
    const w = h('div', 'mp-search'); const i = txt('', () => go(), 'ابحث عن دولة، مدينة، محافظة، بحر…'); const res = h('div', 'mp-results'); w.append(i, res);
    const go = () => {
      const scn = sc(c); const era = G.era(GW.pv(scn.year, lt(c)), scn.eraMode); G.loadAdmin1();
      const r = G.search(i.value, G.features(era, 0), scn.look.lang, era, 12); res.innerHTML = '';
      for (const x of r) {
        const it = h('div', 'mp-res', `<b>${esc(x.name)}</b><span>${esc({ country: 'دولة', province: 'محافظة / إقليم', city: 'مدينة', region: 'منطقة' }[x.kind] || '')} ${x.sub ? '· ' + esc(x.sub) : ''}</span>`);
        const acts = h('span', 'mp-acts');
        acts.append(btn('انتقال', (e) => { e.stopPropagation(); M.flyTo(c, x.bounds ? { bounds: x.bounds } : { lon: x.lon, lat: x.lat, zoom: x.kind === 'city' ? 9 : 6 }); }));
        if (x.kind === 'country' || x.kind === 'province') acts.append(btn('تمييز', (e) => { e.stopPropagation(); addLayer(c, 'country', { keys: [x.key], name: 'تمييز ' + x.name }); }));
        acts.append(btn('علامة', (e) => { e.stopPropagation(); addLayer(c, 'marker', { lon: x.lon, lat: x.lat, text: x.name, icon: x.kind === 'city' ? 'capital' : 'pin', start: lt(c) - (c.in || 0) }); }));
        it.append(acts); it.onclick = () => M.flyTo(c, x.bounds ? { bounds: x.bounds } : { lon: x.lon, lat: x.lat, zoom: x.kind === 'city' ? 9 : 6 }); res.append(it);
      }
    };
    return w;
  }
  function pickedBox(c) {
    const p = M.picked; const w = h('div', 'mp-picked', `<span>المحدد: <b>${esc(p.name)}</b></span>`); const acts = h('span', 'mp-acts');
    const t0 = lt(c) - (c.in || 0);
    acts.append(btn('تمييز', () => addLayer(c, 'country', { keys: [p.key], name: 'تمييز ' + p.name, start: t0 })), btn('يهاجِم…', () => { const L = addLayer(c, 'invasion', { from: p.key, to: [], start: t0, name: 'هجوم ' + p.name }); M.mode = 'pick'; M.pickRole = 'to'; GW.toast('انقر الآن على الدول المستهدفة في الشاشة'); renderPanel(); void L; }),
      btn('تقريب', () => { const f = (G.features(G.era(GW.pv(sc(c).year, lt(c)), sc(c).eraMode), 0) || []).find(f => f.key === p.key); if (f) M.flyTo(c, { bounds: f.bounds }); }), btn(GW.ico('close', 13), () => { M.picked = null; renderPanel(); }));
    w.append(acts); return w;
  }
  function eraSec(c) {
    const scn = sc(c); const s0 = sec('الزمن والحدود', true, 'era'); const t = lt(c); const y = GW.pv(scn.year, t); const era = G.era(y, scn.eraMode);
    const animated = GW.isAnim(scn.year);
    const yi = num(Math.floor(y), 1, v => setYear(c, v + (y - Math.floor(y)))); yi.title = 'سنة سالبة = قبل الميلاد';
    const d = G.decToInt(Math.max(1, y)); const mo = sel(G.MONTHS_AR.map((n, i) => [i + 1, n]), Math.floor(d / 100) % 100, v => setYear(c, G.intToDec(Math.floor(y) * 10000 + (+v) * 100 + 1)));
    const dd = num(d % 100, 1, v => setYear(c, G.intToDec(Math.floor(y) * 10000 + (Math.floor(d / 100) % 100) * 100 + clamp(v, 1, 31))), { min: 1, max: 31 });
    const dayOK = era.src === 'cs'; mo.disabled = dd.disabled = !dayOK;
    const kb = btn(GW.ico(animated ? 'keyon' : 'key', 13), () => { const v = GW.pv(scn.year, t); if (!animated) scn.year = { v, k: [{ t, v, e: 'linear' }] }; else { const ks = scn.year.k; const ex = ks.find(k => Math.abs(k.t - t) < .02); if (ex) { ks.splice(ks.indexOf(ex), 1); if (!ks.length) scn.year = GW.P(v); } else { ks.push({ t, v, e: 'linear' }); ks.sort((a, b) => a.t - b.t); } } changed('مفتاح الزمن'); renderPanel(); }, animated ? 'key on' : 'key');
    kb.title = 'مفتاح زمني: حرّك رأس التشغيل وغيّر السنة لتتحرك الحدود عبر الزمن';
    const slider = h('input', 'mp-yr'); slider.type = 'range'; slider.min = 0; slider.max = 1000; const toS = (yy) => { const lo = -3000, hi = 2026; const k = Math.sign(yy - 1700) * Math.pow(Math.abs(yy - 1700) / (yy < 1700 ? 1700 - lo : hi - 1700), .55); return Math.round((k + 1) / 2 * 1000); }; const fromS = (s2) => { const k = s2 / 500 - 1; return Math.round(1700 + Math.sign(k) * Math.pow(Math.abs(k), 1 / .55) * (k < 0 ? 1700 + 3000 : 2026 - 1700)); };
    slider.value = toS(y); slider.oninput = () => { setYear(c, fromS(+slider.value) + .5, true); yi.value = fromS(+slider.value); };
    slider.onchange = () => GW.commit('تغيير السنة');
    const quick = h('div', 'mp-chips'); for (const [label, yy] of [['اليوم', 2025.5], ['2003', 2003.2], ['1990', 1990.5], ['1967', 1967.4], ['1945', 1945.3], ['1939', 1939.7], ['1914', 1914.6], ['1900', 1900.5], ['1800', 1800], ['1600', 1600], ['1453', 1453], ['1200', 1200], ['800', 800], ['1 م', 1], ['323 ق.م', -323]]) { const b2 = h('button', 'chip'); b2.textContent = label; b2.onclick = () => { setYear(c, yy); renderPanel(); }; quick.append(b2); }
    const prec = G.precision(era); const pr = h('div', 'mp-prec lvl' + prec.lvl, '<i class="dot"></i>' + esc(prec.ar));
    s0.body.append(row('السنة', yi, kb), row('الشهر / اليوم', mo, dd), slider, quick, pr,
      row('مصدر الحدود', sel([['auto', 'تلقائي حسب السنة'], ['modern', 'الحدود الحالية'], ['cs', 'CShapes 1886–2019 (باليوم)'], ['hist', 'خرائط تاريخية']], scn.eraMode || 'auto', v => { scn.eraMode = v; changed('مصدر الحدود'); renderPanel(); })));
    if (animated) s0.body.append(h('div', 'mp-note', `الحدود متحركة عبر ${scn.year.k.length} مفاتيح زمنية — سيتغير شكل الدول تلقائياً أثناء التشغيل.`));
    return s0;
  }
  function setYear(c, v, soon) { const scn = sc(c); const t = lt(c); if (GW.isAnim(scn.year)) GW.setPv(scn.year, t, v); else scn.year = GW.P(v); changed('تغيير السنة', soon); if (!soon) renderPanel(); }
  M.refreshCam = () => { if (!P) return; const c = selMap(); if (!c) return; const v = camNow(c); for (const k of ['lon', 'lat', 'zoom', 'tilt', 'heading']) { const i = P.querySelector(`[data-cam=${k}]`); if (i && document.activeElement !== i) i.value = (+v[k] || 0).toFixed(k === 'zoom' ? 2 : 3); } const al = P.querySelector('[data-a=alt]'); if (al) al.textContent = fmtAlt(Cm.altitudeKm(v.zoom, v.lat)); };
  const fmtAlt = (km) => km > 1000 ? (km / 1000).toFixed(1) + ' ألف كم' : km > 2 ? km.toFixed(0) + ' كم' : (km * 1000).toFixed(0) + ' م';
  function camSec(c) {
    const scn = sc(c); const cam = scn.cam; const s0 = sec('الكاميرا', true, 'cam'); const v = camNow(c);
    s0.body.append(row('العرض', sel([['globe', 'كرة أرضية ثلاثية الأبعاد'], ['flat', 'خريطة مسطحة (مركاتور)']], scn.mode, val => { scn.mode = val; changed('نوع العرض'); renderPanel(); })));
    const f = (k, step) => { const i = num((+v[k] || 0).toFixed(3), step, val => M.setCam(c, { [k]: val })); i.dataset.cam = k; return i; };
    s0.body.append(row('خط الطول / العرض', f('lon', .1), f('lat', .1)), row('التقريب', f('zoom', .1), h('span', 'kv', `<span data-a="alt">${fmtAlt(Cm.altitudeKm(v.zoom, v.lat))}</span>`)), row('الإمالة / الاتجاه', f('tilt', 1), f('heading', 1)));
    const kr = h('div', 'mp-row'); kr.append(btn(GW.ico('key', 13) + ' مفتاح كاميرا عند المؤشر', () => M.addKey(c), 'pri'), btn('شمال للأعلى', () => M.setCam(c, { heading: 0 })), btn('بدون إمالة', () => M.setCam(c, { tilt: 0 }))); s0.body.append(kr);
    // 3D: tilt + terrain in one click (globe mode; terrain needs zoom ≥ 5)
    const is3D = (v.tilt || 0) > 5 && scn.mode === 'globe' && (scn.look.terrain > 0);
    const b3 = btn(GW.ico('globe', 13) + (is3D ? ' ثلاثي الأبعاد مفعّل' : ' تفعيل ثلاثي الأبعاد (3D)'), () => {
      if (is3D) { M.setCam(c, { tilt: 0 }); renderPanel(); return; }
      scn.mode = 'globe'; if (scn.look.terrain == null || scn.look.terrain < 2.5) scn.look.terrain = 3; const z = Math.max(v.zoom, 6.5);
      M.flyAnim(c, { lon: v.lon, lat: v.lat, zoom: z, tilt: 55, heading: v.heading || 0 }); if (v.zoom < 5) GW.toast('التضاريس ثلاثية الأبعاد تظهر عند التقريب (مستوى 5 فأكثر)');
    }, is3D ? 'pri on' : 'pri'); b3.dataset.a = 'btn3d';
    s0.body.append(h('div', 'mp-row'), row('تضخيم التضاريس', rng(scn.look.terrain || 0, 0, 8, .1, val => { scn.look.terrain = val; GW.invalidate(); })));
    s0.body.children[s0.body.children.length - 2].append(b3);
    if (scn.mode === 'flat') s0.body.append(h('div', 'mp-note', 'الخريطة المسطحة لا تدعم الإمالة والتضاريس — اختر «كرة أرضية» للعرض ثلاثي الأبعاد.'));
    s0.body.append(keyRuler(c, cam.keys || [], (k) => k.t, (k, t) => { k.t = t; }, () => { (cam.keys || []).sort((a, b) => a.t - b.t); }, (k) => { cam.keys.splice(cam.keys.indexOf(k), 1); }, 'مفاتيح الكاميرا'));
    const ks = cam.keys || []; const list = h('div', 'mp-keys');
    ks.forEach((k, i) => {
      const r = h('div', 'mp-key' + (Math.abs(k.t - lt(c)) < .5 / GW.seq().fps ? ' on' : ''), `<span class="kv">${GW.fmtTC(k.t, GW.seq().fps)}</span><span>${k.zoom.toFixed(1)}×</span>`);
      r.append(sel([['inout', 'ناعم'], ['ease', 'سلس'], ['in', 'تسارع'], ['out', 'تباطؤ'], ['linear', 'ثابت'], ['hold', 'ثبات']], k.ease || 'inout', val => { k.ease = val; changed('نوع الحركة'); }), sel([['fly', 'طيران'], ['linear', 'مباشر']], k.path || 'fly', val => { k.path = val; changed('مسار الكاميرا'); }),
        btn(GW.ico('goto', 13), () => GW.seek(c.start + k.t - (c.in || 0))), btn(GW.ico('close', 13), () => { ks.splice(i, 1); changed('حذف مفتاح'); renderPanel(); }));
      list.append(r);
    });
    if (!ks.length) list.append(h('div', 'mp-note', 'الكاميرا ثابتة. حرّك الخريطة في الشاشة ثم أضف مفاتيح عند أوقات مختلفة لتصنع حركة طيران سينمائية (مثل Google Earth).'));
    s0.body.append(list);
    s0.body.append(row('دوران مداري', rng(cam.orbit || 0, -20, 20, .5, val => { cam.orbit = val; GW.invalidate(); })), row('اقتراب تدريجي', rng(cam.drift || 0, -.5, .5, .01, val => { cam.drift = val; GW.invalidate(); })), row('اهتزاز', rng(cam.shake || 0, 0, 3, .05, val => { cam.shake = val; GW.invalidate(); })));
    const pres = h('div', 'mp-chips'); for (const [n, fn] of [['جولة ثلاثية الأبعاد', () => camPreset(c, 'tour3d')], ['دخول من الفضاء', () => camPreset(c, 'space')], ['طيران للهدف', () => camPreset(c, 'push')], ['دوران حول الهدف', () => camPreset(c, 'orbit')], ['إمالة سينمائية', () => camPreset(c, 'tilt')]]) { const b = h('button', 'chip'); b.textContent = n; b.onclick = fn; pres.append(b); }
    s0.body.append(h('div', 'mp-sub', 'حركات جاهزة'), pres);
    return s0;
  }
  function camPreset(c, kind) {
    const cam = sc(c).cam; const v = camNow(c); const d = c.dur; const base = { lon: v.lon, lat: v.lat, zoom: v.zoom, tilt: v.tilt || 0, heading: v.heading || 0 };
    if (kind === 'space') cam.keys = [{ t: 0, ...base, zoom: 1.6, tilt: 0, heading: 0, ease: 'inout' }, { t: Math.min(d * .6, 4), ...base, ease: 'inout' }];
    else if (kind === 'push') cam.keys = [{ t: 0, ...base, ease: 'inout' }, { t: d * .8, ...base, zoom: base.zoom + 2.2, tilt: Math.max(base.tilt, 40), ease: 'inout' }];
    else if (kind === 'orbit') { cam.keys = [{ t: 0, ...base, tilt: Math.max(45, base.tilt), ease: 'linear' }, { t: d, ...base, tilt: Math.max(45, base.tilt), heading: base.heading + 90, ease: 'linear' }]; }
    else if (kind === 'tour3d') { sc(c).mode = 'globe'; if (sc(c).look.terrain == null || sc(c).look.terrain < 2.5) sc(c).look.terrain = 3; const z = Math.max(base.zoom, 6.5); const n = 4; cam.keys = []; for (let i = 0; i <= n; i++) cam.keys.push({ t: d * i / n, ...base, zoom: z + (i === 0 ? -.6 : 0), tilt: i === 0 ? 20 : 58, heading: base.heading + i * 30, ease: i === 0 ? 'inout' : 'linear' }); }
    else if (kind === 'tilt') cam.keys = [{ t: 0, ...base, tilt: 0, ease: 'inout' }, { t: d * .7, ...base, tilt: 60, zoom: base.zoom + .8, heading: base.heading + 15, ease: 'inout' }];
    changed('حركة كاميرا جاهزة'); renderPanel();
  }
  // Premiere/AE-like key ruler: diamonds on the clip's time range; click = seek, drag = retime, right-click = delete
  function keyRuler(c, keys, getT, setT, done, del, title, off = 0) {
    const w = h('div', 'mp-ruler'); w.style.cssText = 'position:relative;height:26px;margin:6px 0 4px;border-radius:4px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);cursor:pointer';
    if (title) w.title = title + ' — انقر للانتقال • اسحب لتغيير الوقت • زر أيمن للحذف';
    const t0 = c.in || 0, span = Math.max(.01, c.dur); const X = (t) => clamp((t - t0 - off) / span, 0, 1) * 100;
    const ph = h('i'); ph.style.cssText = `position:absolute;top:0;bottom:0;width:1px;background:var(--accent);left:${X(lt(c))}%`; w.append(ph);
    w.onclick = (e) => { if (e.target !== w) return; const r = w.getBoundingClientRect(); GW.seek(c.start + clamp((e.clientX - r.left) / r.width, 0, 1) * span); };
    for (const k of keys) {
      const d = h('i'); const on = Math.abs(getT(k) + off - lt(c)) < .5 / GW.seq().fps;
      d.style.cssText = `position:absolute;top:50%;left:${X(getT(k) + off)}%;width:10px;height:10px;margin:-5px 0 0 -5px;transform:rotate(45deg);border:1px solid var(--accent);background:${on ? 'var(--accent)' : 'rgba(20,24,30,.9)'};cursor:ew-resize`;
      d.onpointerdown = (e) => {
        if (e.button === 2) return; e.stopPropagation(); d.setPointerCapture(e.pointerId); const r = w.getBoundingClientRect(); let moved = false; const x0 = e.clientX;
        d.onpointermove = (ev) => { if (Math.abs(ev.clientX - x0) > 2) moved = true; if (!moved) return; const tt = +(clamp((ev.clientX - r.left) / r.width, 0, 1) * span + t0 - off).toFixed(3); setT(k, Math.max(0, tt)); d.style.left = X(tt + off) + '%'; GW.invalidate(); };
        d.onpointerup = () => { d.onpointermove = null; d.onpointerup = null; if (moved) { done(); changed('تحريك مفتاح'); renderPanel(); } else GW.seek(c.start + getT(k) + off - t0); };
      };
      d.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); del(k); done(); changed('حذف مفتاح'); renderPanel(); };
      w.append(d);
    }
    return w;
  }
  M.keyRuler = keyRuler;
  // real preview thumbnails: each style rendered once by the atlas engine (bundled low-zoom tiles), cached per version
  const TH = M._thumbs = M._thumbs || {}; let thQ = Promise.resolve();
  const THV = 'qq.sthumb.v3.';
  function styleThumb(k) {
    if (TH[k]) return Promise.resolve(TH[k]);
    try { const u = localStorage.getItem(THV + k); if (u) return Promise.resolve(TH[k] = u); } catch (e) {}
    return (thQ = thQ.then(async () => {
      if (TH[k]) return TH[k];
      // never steal the GL context while the user is looking at / moving a map: wait for 2.5 s of idle
      for (let i = 0; i < 40; i++) { if (!(GW.mapFast && performance.now() - GW.mapFast < 2500) && !(GW.pb && GW.pb.playing)) break; await new Promise(r => setTimeout(r, 500)); }
      try {
        const scn = A.newScene({ style: k, cam: { lon: 30, lat: 28, zoom: 2.2, tilt: 0, heading: 0, keys: [] } });
        scn.look.labels = 0; scn.look.countryLabels = 0; scn.look.cities = 0; scn.look.oceans = 0; scn.look.attrib = 0; scn.look.grain = 0;
        await A.ensure(scn, 0, 192, 108, { dur: 1, timeout: 2500 });
        const cv = A.render(scn, 0, 192, 108, { dur: 1 }); { const g2 = document.createElement('canvas'); g2.width = 24; g2.height = 14; const c2 = g2.getContext('2d'); c2.drawImage(cv, 0, 0, 24, 14); const d = c2.getImageData(0, 0, 24, 14).data; let sm = 0; for (let i = 0; i < d.length; i += 4) sm += d[i] + d[i + 1] + d[i + 2]; if (sm / (d.length / 4 * 3) < 10) return null; } const u = cv.toDataURL('image/jpeg', .82);
        TH[k] = u; try { localStorage.setItem(THV + k, u); } catch (e) {}
        await new Promise(r => setTimeout(r, 30)); return u;
      } catch (e) { return null; }
    }));
  }
  M.userStyles = (v) => { const K = 'qq.mapUserStyles'; if (v) { try { localStorage.setItem(K, JSON.stringify(v)); } catch (e) {} return v; } try { return JSON.parse(localStorage.getItem(K) || '[]') || []; } catch (e) { return []; } };
  // one-click documentary look: dark desaturated imagery, translucent fills with a light outline, big soft-shadow labels
  M.docLook = (c, style = 'doc_dark') => { S.applyDocLook(sc(c), style); changed('مظهر وثائقي'); renderPanel(); };
  function styleSec(c) {
    const scn = sc(c); const s0 = sec('نمط الخريطة', true, 'style'); const grid = h('div', 'mp-styles');
    for (const k of S.STYLE_ORDER) { const st = S.STYLES[k]; const b = h('button', 'mp-st' + (scn.style === k ? ' on' : '')); const sw = st.vector ? `linear-gradient(135deg, ${st.ocean} 0 45%, ${st.land} 45% 100%)` : ''; b.innerHTML = `<i style="${sw ? 'background:' + sw : ''}" class="${st.vector ? '' : 'img-' + (st.base || '')}"></i><span>${esc(st.ar)}</span>`; b.onclick = () => { scn.style = k; changed('نمط الخريطة'); renderPanel(); }; grid.append(b); const ii = b.querySelector('i'); styleThumb(k).then(u => { if (u && ii.isConnected) { ii.className = ''; ii.style.background = `url(${u}) center/cover`; } }); }
    // user styles (saved looks) — stored in localStorage, applied as base style + look overrides (the scene keeps them, so projects stay portable)
    for (const u of M.userStyles()) { const b = h('button', 'mp-st'); const bs = S.STYLES[u.base] || S.STYLES.satellite; b.innerHTML = `<i style="background:linear-gradient(135deg, ${esc(u.look.oceanTint || u.look.ocean || bs.oceanTint || bs.ocean || '#0b1c36')} 0 50%, ${esc(u.look.ink || bs.ink || '#fff')} 50% 100%)"></i><span>${esc(u.name)}</span>`; b.title = 'نمط محفوظ — زر أيمن للحذف'; b.onclick = () => { scn.style = u.base; Object.assign(scn.look, GW.clone(u.look)); changed('نمط الخريطة'); renderPanel(); }; b.oncontextmenu = (e) => { e.preventDefault(); M.userStyles(M.userStyles().filter(x => x.id !== u.id)); renderPanel(); }; grid.append(b); }
    const qa = h('div', 'mp-row');
    qa.append(btn(GW.ico('wand', 13) + ' مظهر وثائقي بنقرة واحدة', () => { M.docLook(c, 'doc_dark'); }, 'pri'), btn('وثائقي فاتح', () => M.docLook(c, 'doc_light')),
      btn(GW.ico('plus', 13) + ' حفظ كنمط', async () => { const name = await GW.prompt('حفظ كنمط', 'اسم النمط', 'نمطي ' + (M.userStyles().length + 1)); if (!name) return; const keep = ['font', 'labelSize', 'labelW', 'ink', 'haloT', 'labelSp', 'countryLabels', 'cities', 'cityDot', 'cityC', 'oceans', 'regions', 'borders', 'borderC', 'borderW', 'borderA', 'borderStyle', 'coast', 'rivers', 'lakes', 'provinces', 'ocean', 'land', 'bgCol', 'oceanTint', 'tintA', 'fill', 'fillA', 'hill', 'bri', 'con', 'sat', 'warm', 'vig', 'ge', 'grain', 'paper', 'letter', 'graticule', 'gridC', 'atmo', 'stars', 'terrain']; const look = {}; for (const k of keep) if (scn.look[k] != null) look[k] = scn.look[k]; M.userStyles([...M.userStyles(), { id: GW.uid(), name, base: scn.style, look }]); GW.toast('تم حفظ النمط: ' + name); renderPanel(); }));
    s0.body.append(grid, qa, h('div', 'mp-note', 'الأنماط الفضائية والطبوغرافية تُحمّل صوراً عالية الدقة من الإنترنت حسب التقريب وتُحفظ للعمل بدون إنترنت لاحقاً.'));
    return s0;
  }
  function lookSec(c) {
    const scn = sc(c); const L = scn.look; const s0 = sec('الطبقات والمظهر', false, 'look'); const E = S.eff(scn); const st = E.st;
    const set = (k) => (v) => { L[k] = v; changed('مظهر الخريطة', true); };
    const grp = (title, id, ...rows) => { const d = sec(title, false, 'look_' + id); d.classList.add('mp-sub-sec'); d.body.append(...rows); return d; };
    const ccol = (k, d) => { const w = h('span', 'mp-row'); w.append(col(L[k] || d, v => { L[k] = v; GW.invalidate(); }), btn(GW.ico('close', 11), () => { L[k] = null; changed('إعادة اللون'); renderPanel(); })); return w; };
    const fontOpts = [['', 'حسب النمط (' + E.font + ')'], ...GW.FONTS.map(f => [f, f])];
    s0.body.append(
      row('لغة الأسماء', sel([['ar', 'العربية'], ['en', 'English']], L.lang, v => { L.lang = v; changed('لغة الخريطة'); })),
      grp('الأسماء والخطوط', 'labels',
        row('الخط', sel(fontOpts, L.font || '', set('font'))),
        row('حجم الأسماء', rng(L.labelSize || 1, .5, 2.5, .05, set('labelSize'))),
        row('سماكة الخط', sel([[0, 'حسب النمط'], [500, 'عادي'], [600, 'متوسط'], [700, 'عريض'], [800, 'عريض جداً'], [900, 'أسود']], L.labelW || 0, v => set('labelW')(+v))),
        row('لون الأسماء', ccol('ink', st.ink && st.ink[0] === '#' ? st.ink : '#ffffff')),
        row('نوع الظل', sel([['', 'حسب النمط'], ['soft', 'ظل ناعم'], ['outline', 'حد واضح'], ['none', 'بدون']], L.haloT || '', set('haloT'))),
        row('تباعد الحروف (لاتيني)', rng(L.labelSp || 0, 0, .5, .01, set('labelSp'))),
        row('أسماء الدول', chk(L.countryLabels, set('countryLabels'))), row('المدن', sel([[0, 'بدون'], [1, 'الرئيسية'], [2, 'أكثر'], [3, 'كثيرة']], L.cities, v => set('cities')(+v))),
        row('علامة المدن', sel([['auto', 'دائرة (افتراضي)'], ['dot', 'نقطة'], ['star', 'نجمة'], ['none', 'بدون']], L.cityDot || 'auto', set('cityDot'))), row('لون علامة المدن', ccol('cityC', '#ffffff')),
        row('البحار والمحيطات', chk(L.oceans, set('oceans'))), row('مناطق طبيعية', chk(L.regions, set('regions'))), row('أسماء مرجعية (Esri)', chk(L.refLabels, set('refLabels')))),
      grp('الحدود والسواحل', 'borders',
        row('الحدود', chk(L.borders, set('borders'))), row('لون الحدود', ccol('borderC', '#e4e7ec')),
        row('سماكة الحدود', rng(L.borderW || 1, .3, 4, .1, set('borderW'))), row('شفافية الحدود', rng(L.borderA == null ? .62 : L.borderA, 0, 1, .02, set('borderA'))),
        row('نوع الخط', sel([['', 'حسب النمط'], ['solid', 'متصل'], ['dashed', 'متقطع'], ['glow', 'متوهج']], L.borderStyle || '', set('borderStyle'))),
        row('المحافظات / الولايات', chk(L.provinces, set('provinces'))), row('السواحل', chk(L.coast, set('coast'))), row('الأنهار', chk(L.rivers, set('rivers'))), row('البحيرات', chk(L.lakes, set('lakes')))),
      grp('الألوان والتلوين', 'colors',
        ...(E.vector ? [row('لون المحيط', ccol('ocean', st.ocean)), row('لون اليابسة', ccol('land', st.land && st.land[0] === '#' ? st.land : '#888888')), row('لون الخلفية', ccol('bgCol', '#05070b'))]
          : [row('لون المحيط', ccol('oceanTint', st.oceanTint || '#0b1c36')), row('تعتيم المحيط', rng(L.tintA == null ? (st.tintA || 0) : L.tintA, 0, 1, .02, set('tintA'))), row('لون الفضاء', ccol('bgCol', '#05070b'))]),
        row('تلوين الدول', sel([['', 'حسب النمط'], ['none', 'بدون'], ['political', 'سياسي (لكل دولة لون)'], ['empire', 'الإمبراطوريات والمستعمرات']], L.fill == null ? '' : L.fill, v => { L.fill = v || null; changed('تلوين الدول'); })),
        row('شفافية التلوين', rng(L.fillA == null ? E.fillA : L.fillA, 0, 1, .02, set('fillA'))), row('ظل التضاريس', rng(L.hill == null ? E.hill : L.hill, 0, 1, .02, set('hill')))),
      grp('تدرج الصورة', 'grade',
        row('السطوع', rng(L.bri == null ? 1 : L.bri, .3, 1.8, .02, set('bri'))), row('التباين', rng(L.con == null ? 1 : L.con, .5, 1.8, .02, set('con'))), row('التشبع', rng(L.sat == null ? 1 : L.sat, 0, 2, .02, set('sat'))),
        row('الدفء', rng(L.warm || 0, -1, 1, .02, set('warm'))), row('تعتيم الأطراف', rng(L.vig == null ? E.post.vig : L.vig, 0, 1, .02, set('vig'))), row('قوة «Google Earth»', rng(L.ge == null ? (E.grade.ge || 0) : L.ge, 0, 1, .02, set('ge'))),
        row('حبيبات', rng(L.grain || 0, 0, 1, .02, set('grain'))), row('ورق قديم', rng(L.paper == null ? E.post.paper : L.paper, 0, 1, .02, set('paper'))), row('أشرطة سينمائية', rng(L.letter || 0, 0, .3, .01, set('letter'))),
        btn('إعادة التدرج', () => { for (const k of ['bri', 'con', 'sat', 'warm', 'vig', 'ge', 'grain', 'paper', 'letter']) L[k] = k === 'grain' ? .04 : null; L.bri = 1; L.sat = 1; changed('إعادة التدرج'); renderPanel(); })),
      grp('الشبكة والغلاف الجوي', 'grid',
        row('خطوط الطول والعرض', chk(L.graticule, set('graticule'))), row('لون الشبكة', ccol('gridC', '#ffffff')),
        row('الغلاف الجوي', rng(L.atmo == null ? 1 : L.atmo, 0, 2, .05, set('atmo'))), row('النجوم', rng(L.stars == null ? E.stars : L.stars, 0, 2, .05, set('stars'))),
        row('ليل / نهار', chk(L.light, set('light'))), row('موقع الشمس', rng(L.sunLon || 0, -180, 180, 1, set('sunLon')))),
      row('جودة المعاينة', sel([[.6, 'سريعة'], [.85, 'متوازنة'], [1, 'عالية']], GW.mapPreviewQ || .85, v => { GW.mapPreviewQ = +v; GW.invalidate(); })),
      row('مصدر الصور', h('span', 'kv', esc(E.base ? A.Providers.P[E.base].attrib : 'رسم متجهي'))),
      row('خلفية شفافة', chk(c.map.bg === 'alpha', v => { c.map.bg = v ? 'alpha' : 'full'; changed('خلفية الخريطة'); })),
    );
    return s0;
  }
  /* ---------------- layers ---------------- */
  function addLayer(c, type, o = {}) { const L = S.newLayer(type, Object.assign({ start: Math.max(0, lt(c) - (c.in || 0)) }, o)); sc(c).layers.push(L); M.layerId = L.id; changed('إضافة طبقة: ' + S.LAYERS[type].ar); M.mode = { country: 'pick', invasion: 'pick', arrow: 'draw', front: 'draw', route: 'draw', marker: 'place', label: 'place', image: 'place', range: 'place' }[type] || 'nav'; if (type === 'invasion' && !o.from) M.pickRole = 'from'; renderPanel(); return L; }
  M.addLayer = addLayer;
  // leader portrait: image layer with a framed photo + name plate, pinned to a place; optional travel path
  M.addLeader = async (c, o = {}) => {
    const v = camNow(c); const L = addLayer(c, 'image', Object.assign({ name: 'اسم القائد', sub: 'اللقب', ring: '#e8d9a8', lon: +v.lon.toFixed(4), lat: +v.lat.toFixed(4), in: 'pop', inDur: .7, size: 1 }, o));
    if (!o.img) await M.pickPhoto(c, L); M.mode = 'place'; renderPanel(); return L;
  };
  // photo from disk (native dialog in the app, file input in the browser), downscaled to ≤640px and embedded in the scene
  M.pickPhoto = async (c, L) => {
    const embed = (src) => new Promise(res => { const im = new Image(); im.onload = () => { const k = Math.min(1, 640 / Math.max(im.naturalWidth, im.naturalHeight)); const cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); const id = GW.uid(); sc(c).images[id] = cv.toDataURL('image/jpeg', .9); L.img = id; changed('صورة القائد'); renderLayerProps(); res(true); }; im.onerror = () => { GW.toast('تعذر فتح الصورة', 'err'); res(false); }; im.src = src; });
    if (window.gws && gws.open && !gws.test) { const f = await gws.open({ filter: 'image', title: 'اختيار صورة القائد' }); if (!f || !f.length) return false; return embed(gws.mediaUrl(f[0].path)); }
    return new Promise(res => { const i = h('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => { const f = i.files[0]; if (!f) return res(false); const rd = new FileReader(); rd.onload = () => embed(rd.result).then(res); rd.readAsDataURL(f); }; i.click(); });
  };
  function layersSec(c) {
    const scn = sc(c); const s0 = sec('عناصر الخريطة (طبقات)', true, 'layers');
    const add = h('div', 'mp-add'); for (const [k, v] of Object.entries(S.LAYERS)) { const b = h('button', 'mp-addb'); b.innerHTML = `<span>${esc(v.ar)}</span>`; b.onclick = () => addLayer(c, k); add.append(b); }
    const quick = h('div', 'mp-row'); quick.append(btn(GW.ico('camera', 13) + ' صورة قائد', () => M.addLeader(c), 'pri'), btn(GW.ico('wand', 13) + ' مظهر وثائقي', () => M.docLook(c, 'doc_dark')));
    s0.body.append(add, quick);
    const list = h('div', 'mp-layers');
    [...scn.layers].reverse().forEach(L => {
      const r = h('div', 'mp-layer' + (L.id === M.layerId ? ' on' : '') + (L.on ? '' : ' off'));
      const eye = h('button', 'ib', GW.ico(L.on ? 'eye' : 'eyeoff', 14)); eye.onclick = (e) => { e.stopPropagation(); L.on = L.on ? 0 : 1; changed('إظهار/إخفاء'); renderPanel(); };
      const nm = h('span', 'nm'); nm.textContent = L.name;
      const tm = h('span', 'kv'); tm.textContent = `${(L.start || 0).toFixed(1)}ث${L.dur != null ? ' · ' + L.dur.toFixed(1) + 'ث' : ''}`;
      const up = h('button', 'ib', GW.ico('up', 14)); up.onclick = (e) => { e.stopPropagation(); const a = scn.layers; const i = a.indexOf(L); if (i < a.length - 1) { a.splice(i, 1); a.splice(i + 1, 0, L); changed('ترتيب'); renderPanel(); } };
      const dn = h('button', 'ib', GW.ico('down', 14)); dn.onclick = (e) => { e.stopPropagation(); const a = scn.layers; const i = a.indexOf(L); if (i > 0) { a.splice(i, 1); a.splice(i - 1, 0, L); changed('ترتيب'); renderPanel(); } };
      const dup = h('button', 'ib', GW.ico('copy', 14)); dup.onclick = (e) => { e.stopPropagation(); const n = GW.clone(L); n.id = GW.uid(); n.name += ' (نسخة)'; scn.layers.push(n); M.layerId = n.id; changed('تكرار'); renderPanel(); };
      const del = h('button', 'ib', GW.ico('close', 14)); del.onclick = (e) => { e.stopPropagation(); scn.layers.splice(scn.layers.indexOf(L), 1); if (M.layerId === L.id) M.layerId = null; changed('حذف طبقة'); renderPanel(); };
      r.append(eye, nm, tm, up, dn, dup, del); r.onclick = () => { M.layerId = L.id; M.mode = { country: 'pick', invasion: 'pick', arrow: 'draw', front: 'draw', route: 'draw', marker: 'place', label: 'place', image: 'place', range: 'place' }[L.type] || M.mode; renderPanel(); GW.invalidate(); };
      list.append(r);
    });
    if (!scn.layers.length) list.append(h('div', 'mp-note', 'أضف عناصر مثل تمييز الدول، الغزو، الأسهم، خطوط الجبهة، العلامات والصور. كل عنصر له وقت ظهور ومدة.'));
    s0.body.append(list);
    const L = layer(c); if (L) { const box = h('div', 'mp-props'); box.dataset.a = 'props'; s0.body.append(box); fillProps(c, L, box); }
    return s0;
  }
  function renderLayerProps() { const c = selMap(); if (!c || !P) return; const box = P.querySelector('[data-a=props]'); const L = layer(c); if (box && L) { box.innerHTML = ''; fillProps(c, L, box); } else renderPanel(); }
  function keyChips(c, keys, onRemove) {
    const scn = sc(c); const era = G.era(GW.pv(scn.year, lt(c)), scn.eraMode); const fs = G.features(era, 0) || []; const by = new Map(fs.map(f => [f.key, f]));
    const w = h('div', 'mp-chips'); for (const k of keys) { const f = by.get(k); const b = h('button', 'chip on'); b.innerHTML = esc(f ? G.name(f, 'ar', era) : k) + ' ' + GW.ico('close', 11); b.onclick = () => onRemove(k); w.append(b); }
    if (!keys.length) w.append(h('span', 'mp-note', 'انقر على الدول في الشاشة لإضافتها'));
    return w;
  }
  function fillProps(c, L, box) {
    const set = (k, now) => (v) => { L[k] = v; changed('خصائص ' + L.name, !now); };
    const t0 = () => Math.max(0, lt(c) - (c.in || 0));
    box.append(h('div', 'mp-sub', esc(S.LAYERS[L.type].ar)));
    box.append(row('الاسم', txt(L.name, set('name'))));
    box.append(row('يبدأ عند (ث)', num((L.start || 0).toFixed(2), .1, v => { L.start = Math.max(0, v); changed('توقيت'); renderPanel(); }), btn('عند المؤشر', () => { L.start = +t0().toFixed(2); changed('توقيت'); renderPanel(); })));
    box.append(row('المدة (ث)', num(L.dur != null ? L.dur.toFixed(2) : '', .1, v => { L.dur = v > 0 ? v : null; changed('توقيت'); renderPanel(); }), btn('حتى النهاية', () => { L.dur = null; changed('توقيت'); renderPanel(); }), btn('ينتهي عند المؤشر', () => { L.dur = Math.max(.1, +(t0() - (L.start || 0)).toFixed(2)); changed('توقيت'); renderPanel(); })));
    const anims = { fade: 'تلاشي', grow: 'نمو', draw: 'رسم تدريجي', pop: 'ظهور مرن', wipe: 'مسح', spread: 'انتشار', none: 'بدون' };
    box.append(row('حركة الدخول', sel(Object.entries(anims), L.in || 'fade', set('in', 1)), num(L.inDur || .8, .1, set('inDur', 1))), row('حركة الخروج', sel([['none', 'بدون'], ['fade', 'تلاشي']], L.out || 'none', set('out', 1)), num(L.outDur || .5, .1, set('outDur', 1))));
    const pats = [['solid', 'مصمت'], ['hatch', 'خطوط مائلة'], ['cross', 'شبكة'], ['dots', 'نقاط']];
    // keyframes on layer props (stopwatch like AE): {v, k:[{t,v,e}]} in layer-local time
    const tl = () => +(lt(c) - (L.start || 0)).toFixed(3);
    const isA = (k) => L[k] && typeof L[k] === 'object' && !Array.isArray(L[k]);
    const pv = (k, d) => { const v = GW.pv(L[k], tl()); return v == null ? d : v; };
    const setA = (k) => (v) => { if (isA(k)) GW.setPv(L[k], tl(), v); else L[k] = v; changed('خصائص ' + L.name, true); };
    const sw = (k, d, also) => { const ks = [k, ...(also || [])]; const on = ks.some(isA); const b = btn(GW.ico(on ? 'keyon' : 'key', 13), () => {
      for (const q of ks) { if (isA(q)) L[q] = GW.pv(L[q], tl()); else { const v0 = L[q] == null ? d : L[q]; L[q] = { v: v0, k: [{ t: tl(), v: v0, e: 'linear' }] }; } }
      changed(on ? 'إيقاف التحريك' : 'تفعيل مفاتيح'); renderLayerProps(); }, on ? 'key on' : 'key'); b.title = 'ساعة الإيقاف: مفاتيح لهذه الخاصية (غيّر القيمة عند أوقات مختلفة)'; return b; };
    const animRows = (only) => {
      const w = h('div'); const want = only || ['opacity', 'scale'];
      if (want.includes('opacity')) w.append(row('الشفافية', rng(pv('opacity', 1), 0, 1, .02, setA('opacity')), sw('opacity', 1)));
      if (want.includes('scale')) w.append(row('التكبير', rng(pv('scale', 1), .1, 4, .02, setA('scale')), sw('scale', 1)));
      if ('lon' in L && !only) w.append(row('مفاتيح الموضع', sw('lon', 0, ['lat']), h('span', 'mp-note', isA('lon') ? 'حرّك المؤشر ثم حدّد الموضع من الشاشة لإضافة مفتاح' : 'فعّل لتحريك العنصر بين مواقع')));
      const all = []; for (const k of S.ANIM_PROPS) if (isA(k)) for (const kk of L[k].k) all.push({ p: k, kk });
      if (all.length) w.append(keyRuler(c, all, (x) => x.kk.t, (x, t) => { x.kk.t = t; }, () => { for (const k of S.ANIM_PROPS) if (isA(k)) L[k].k.sort((a, b) => a.t - b.t); }, (x) => { const arr = L[x.p].k; arr.splice(arr.indexOf(x.kk), 1); if (!arr.length) L[x.p] = L[x.p].v; }, 'مفاتيح الطبقة', L.start || 0));
      return w;
    };
    switch (L.type) {
      case 'country':
        box.append(btn(M.mode === 'pick' ? 'وضع اختيار الدول فعّال' : 'اختيار الدول من الشاشة', () => { M.mode = 'pick'; renderPanel(); }), keyChips(c, L.keys, k => { L.keys.splice(L.keys.indexOf(k), 1); changed('إزالة دولة'); renderLayerProps(); }),
          row('اللون', col(L.color, set('color'))), countryColors(c, L), row('شفافية التعبئة', rng(pv('fill', .5), 0, 1, .02, setA('fill')), sw('fill', .5)), row('النقش', sel(pats, L.pattern, set('pattern', 1))),
          row('الإطار', sel([['solid', 'متصل'], ['dashed', 'متقطع (منطقة ناشئة / متنازع عليها)'], ['none', 'بدون']], L.outline || 'solid', set('outline', 1))), row('لون الإطار', col(L.line || '#f3e6c0', set('line'))), row('سماكة الإطار', rng(L.stroke, 0, 6, .1, set('stroke'))),
          row('ظل داخلي (عمق)', chk(L.inner, set('inner', 1))), row('توهج', chk(L.glow, set('glow', 1))), row('تعتيم باقي العالم', chk(L.dim, set('dim', 1))), row('نبض', chk(L.pulse, set('pulse', 1))),
          row('اسم الدولة', sel([['', 'حسب النمط'], ['soft', 'كبير بظل ناعم'], ['plate', 'بخلفية'], ['outline', 'بحد']], L.labelStyle || '', set('labelStyle', 1)), chk(L.label !== 0, set('label', 1))), row('حجم الاسم', rng(L.labelSize || 1, .4, 3, .05, set('labelSize'))), row('نص بديل للاسم', txt(L.labelText, set('labelText'), 'مثال: الأندلس')), animRows(['opacity']));
        break;
      case 'invasion':
        box.append(h('div', 'mp-row')); box.lastChild.append(btn((M.pickRole === 'from' && M.mode === 'pick' ? '' : '') + 'اختر المهاجم', () => { M.mode = 'pick'; M.pickRole = 'from'; renderPanel(); }), btn((M.pickRole !== 'from' && M.mode === 'pick' ? '' : '') + 'اختر الأهداف', () => { M.mode = 'pick'; M.pickRole = 'to'; renderPanel(); }));
        box.append(row('المهاجم', keyChips(c, L.from ? [L.from] : [], () => { L.from = null; changed('مهاجم'); renderLayerProps(); })), row('الأهداف', keyChips(c, L.to || [], k => { L.to.splice(L.to.indexOf(k), 1); changed('هدف'); renderLayerProps(); })),
          row('اللون', col(L.color, set('color'))), row('شكل السهم', sel([['military', 'سهم عسكري'], ['line', 'خط'], ['dashed', 'متقطع متحرك'], ['double', 'مزدوج']], L.arrowStyle, set('arrowStyle', 1))), row('عرض السهم', rng(L.width || 1, .3, 3, .05, set('width'))), row('انحناء', rng(L.curve == null ? .25 : L.curve, -1, 1, .02, set('curve'))),
          row('زمن وصول السهم (ث)', num(L.inDur || 4, .1, set('inDur', 1))), row('فارق بين الأهداف (ث)', num(L.stagger != null ? L.stagger : (L.inDur || 4) * .35, .1, set('stagger', 1))), row('مدة الانتشار (ث)', num(L.spreadDur || (L.inDur || 4) * 1.2, .1, set('spreadDur', 1))),
          row('الأسهم', chk(L.arrows, set('arrows', 1))), row('احتلال الأرض', chk(L.spread, set('spread', 1))), row('نسبة الاحتلال', rng(L.occupy == null ? 1 : L.occupy, .05, 1, .01, set('occupy'))), row('انفجارات عند الوصول', chk(L.impacts, set('impacts', 1))));
        break;
      case 'arrow': case 'route':
        box.append(h('div', 'mp-row')); box.lastChild.append(btn(M.mode === 'draw' ? 'وضع الرسم فعّال' : 'رسم المسار في الشاشة', () => { M.mode = 'draw'; renderPanel(); }), btn('مسح النقاط', () => { L.pts = []; changed('مسح'); renderLayerProps(); }), btn('حذف آخر نقطة', () => { L.pts.pop(); changed('حذف نقطة'); renderLayerProps(); }));
        box.append(h('div', 'mp-note', `${(L.pts || []).length} نقاط`), row('اللون', col(L.color, set('color'))), row('العرض', rng(L.width || 1, .2, 4, .05, set('width'))), row('انحناء', rng(L.curve || 0, -1, 1, .02, set('curve'))));
        if (L.type === 'arrow') box.append(row('الشكل', sel([['military', 'سهم عسكري'], ['line', 'خط'], ['dashed', 'متقطع متحرك'], ['double', 'مزدوج']], L.style, set('style', 1))), row('توهج', chk(L.glow, set('glow', 1))), row('حد خارجي', chk(L.outline, set('outline', 1))));
        else box.append(row('الأيقونة', sel(V.ICONS.filter(x => ['plane', 'jet', 'heli', 'missile', 'ship', 'tank', 'soldier', 'dot'].includes(x[0])), L.icon, set('icon', 1))), row('حجم الأيقونة', rng(L.size || 1, .3, 4, .05, set('size'))), row('خط متقطع', chk(L.dashed, set('dashed', 1))));
        break;
      case 'front': {
        box.append(h('div', 'mp-row')); box.lastChild.append(btn(M.mode === 'draw' ? 'وضع الرسم فعّال' : 'رسم المنطقة في الشاشة', () => { M.mode = 'draw'; renderPanel(); }), btn('مسح', () => { L.pts = []; L.shapes = []; changed('مسح'); renderLayerProps(); }));
        const ns = (L.shapes || []).length;
        box.append(btn(GW.ico('key', 13) + (ns ? ` شكل عند المؤشر (${ns} مفاتيح)` : ' تحريك الجبهة عبر الزمن'), () => { const t = lt(c) - (c.in || 0) - (L.start || 0); L.shapes = L.shapes || []; if (!L.shapes.length && L.pts && L.pts.length > 2) L.shapes.push({ t: 0, pts: GW.clone(L.pts) }); const cur = V.frontRing(L, t) || L.pts || []; if (!L.shapes.find(s => Math.abs(s.t - t) < .05)) { L.shapes.push({ t, pts: GW.clone(cur) }); L.shapes.sort((a, b) => a.t - b.t); } changed('مفتاح جبهة'); renderLayerProps(); GW.toast('حرّك نقاط الجبهة الآن — سيتحرك الخط تدريجياً بين المفاتيح'); }));
        box.append(h('div', 'mp-note', 'أو اختر دولاً كاملة لتكون منطقة السيطرة:'), btn('اختيار دول', () => { M.mode = 'pick'; renderPanel(); }), keyChips(c, L.keys || [], k => { L.keys.splice(L.keys.indexOf(k), 1); changed('إزالة'); renderLayerProps(); }),
          row('اللون', col(L.color, set('color'))), row('شفافية', rng(L.fill, 0, 1, .02, set('fill'))), row('النقش', sel(pats, L.pattern, set('pattern', 1))), row('خط الجبهة', rng(L.stroke, 0, 6, .1, set('stroke'))), row('أسنان الجبهة', chk(L.teeth, set('teeth', 1))));
        break; }
      case 'marker':
        box.append(row('الأيقونة', sel(V.ICONS, L.icon, set('icon', 1))), row('النص', txt(L.text, set('text'))), row('موضع النص', sel([['right', 'يمين'], ['left', 'يسار'], ['top', 'أعلى'], ['bottom', 'أسفل']], L.textPos || 'right', set('textPos', 1))), row('اللون', col(L.color, set('color'))), row('الحجم', rng(pv('size', 1), .3, 4, .05, setA('size')), sw('size', 1)), row('نبض', chk(L.pulse, set('pulse', 1))), lonlat(L), animRows());
        break;
      case 'label':
        box.append(row('النص', txt(L.text, set('text'))), row('الشكل', sel([['soft', 'ظل ناعم'], ['outline', 'بحد'], ['plate', 'بخلفية'], ['plain', 'بسيط']], L.style, set('style', 1))), row('اللون', col(L.color, set('color'))), row('الحجم', rng(pv('size', 1), .3, 5, .05, setA('size')), sw('size', 1)), row('تباعد الحروف', rng(L.spacing || 0, 0, 1, .02, set('spacing'))), lonlat(L), animRows());
        break;
      case 'image': {
        const imgs = (GW.prj && GW.prj.media || []).filter(m => m.kind === 'image' && m.path);
        box.append(h('div', 'mp-row')); box.lastChild.append(btn(GW.ico('folder', 13) + ' اختيار صورة من الجهاز…', () => M.pickPhoto(c, L), 'pri'));
        if (imgs.length) box.append(row('من صور المشروع', sel([['', '—'], ...imgs.map(m => [m.id, m.name])], '', id => { const m = imgs.find(x => x.id === id); if (!m) return; const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { const k = Math.min(1, 640 / Math.max(im.naturalWidth, im.naturalHeight)); const cv = document.createElement('canvas'); cv.width = im.naturalWidth * k | 0; cv.height = im.naturalHeight * k | 0; cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); const iid = GW.uid(); sc(c).images[iid] = cv.toDataURL('image/jpeg', .9); L.img = iid; changed('صورة'); renderLayerProps(); }; im.src = GW.Media && GW.Media.url ? GW.Media.url(m) : (window.gws ? gws.mediaUrl(m.path) : m.path); })));
        box.append(row('الشكل', sel([['circle', 'دائرة'], ['square', 'مربع'], ['rounded', 'مربع مستدير'], ['hex', 'سداسي'], ['shield', 'درع']], L.shape, set('shape', 1))), row('الاسم', txt(L.name, set('name'))), row('اللقب / الوصف', txt(L.sub, set('sub'))), row('لون الإطار', col(L.ring, set('ring'))), row('الحجم', rng(pv('size', 1), .3, 3, .05, setA('size')), sw('size', 1)), row('ارتفاع عن النقطة', rng(L.dy == null ? -1 : L.dy, -2, 2, .05, set('dy'))), row('لوحة الاسم', chk(L.plate, set('plate', 1))), lonlat(L), animRows());
        box.append(h('div', 'mp-sub', 'تحرك القائد على مسار'), h('div', 'mp-row')); box.lastChild.append(btn(M.mode === 'draw' ? 'وضع رسم المسار فعّال' : 'رسم المسار في الشاشة', () => { M.mode = 'draw'; renderPanel(); }), btn('من الموقع الحالي', () => { L.pts = [[+pv('lon', 0), +pv('lat', 0)]]; M.mode = 'draw'; changed('بداية المسار'); renderPanel(); }), btn('مسح المسار', () => { L.pts = []; changed('مسح'); renderLayerProps(); }));
        box.append(h('div', 'mp-note', (L.pts || []).length >= 2 ? `${L.pts.length} نقاط — يتحرك القائد من أول نقطة إلى آخر نقطة` : 'ارسم نقطتين أو أكثر ليتحرك القائد بينها (مثل طبقة المسار).'),
          row('يبدأ الحركة بعد (ث)', num(L.moveStart == null ? 1 : L.moveStart, .1, set('moveStart', 1))), row('مدة الحركة (ث)', num(L.moveDur || 4, .1, set('moveDur', 1))), row('انحناء', rng(L.curve || 0, -1, 1, .02, set('curve'))),
          row('أثر متلاشٍ', chk(L.trail, set('trail', 1))), row('سهم المسار', chk(L.arrow, set('arrow', 1))), row('لون الأثر', col(L.trailColor || L.ring, set('trailColor'))));
        break; }
      case 'range':
        box.append(row('نصف القطر (كم)', num(L.km, 10, set('km', 1))), row('النص', txt(L.text, set('text'))), row('اللون', col(L.color, set('color'))), row('شفافية', rng(L.fill, 0, 1, .02, set('fill'))), row('نبضات', chk(L.pulse, set('pulse', 1))), lonlat(L));
        break;
      case 'data': {
        const ta = h('textarea', 'inp'); ta.rows = 7; ta.value = L.data || ''; ta.onkeydown = e => e.stopPropagation(); ta.oninput = () => { L.data = ta.value; GW.invalidate(); GW.commitSoon('بيانات'); };
        box.append(h('div', 'mp-note', 'سطر لكل دولة: الاسم ثم القيمة (مثال: مصر, 105). يمكن اللصق من إكسل.'), ta, row('عنوان المفتاح', txt(L.title, set('title'))), row('لون أقل قيمة', col(L.c0, set('c0'))), row('لون أعلى قيمة', col(L.c1, set('c1'))), row('شفافية', rng(L.fill == null ? .85 : L.fill, 0, 1, .02, set('fill'))), row('إظهار القيم', chk(L.values, set('values', 1))), row('قبل القيمة / بعدها', txt(L.prefix, set('prefix')), txt(L.suffix, set('suffix'))), row('مفتاح الألوان', chk(L.legend !== 0, set('legend', 1))));
        break; }
      case 'inset':
        box.append(h('div', 'mp-note', 'كرة صغيرة في الزاوية توضح موقع المشهد من العالم، وتلوّن الدول المشاركة في الطبقات الأخرى.'), row('الموضع', sel([['tl', 'أعلى يسار'], ['tr', 'أعلى يمين'], ['bl', 'أسفل يسار'], ['br', 'أسفل يمين']], L.pos, set('pos', 1))), row('الحجم', rng(L.size || 1, .4, 2.5, .05, set('size'))), row('لون الدول', col(L.color, set('color'))), row('لون الموقع', col(L.mark, set('mark'))), row('تعليق', txt(L.text, set('text'))));
        break;
      case 'date':
        box.append(row('الموضع', sel([['tr', 'أعلى يمين'], ['tl', 'أعلى يسار'], ['br', 'أسفل يمين'], ['bl', 'أسفل يسار'], ['top', 'أعلى الوسط']], L.pos, set('pos', 1))), row('الصيغة', sel([['auto', 'تلقائي'], ['year', 'السنة فقط'], ['full', 'اليوم والشهر والسنة']], L.format, set('format', 1))), row('الحجم', rng(L.size || 1, .4, 3, .05, set('size'))), row('خلفية', chk(L.plate, set('plate', 1))), row('اللون', col(L.color, set('color'))));
        break;
      case 'legend': {
        (L.items || []).forEach((it, i) => box.append(row('عنصر ' + (i + 1), col(it.color, v => { it.color = v; GW.invalidate(); }), txt(it.text, v => { it.text = v; GW.invalidate(); }), btn(GW.ico('close', 13), () => { L.items.splice(i, 1); changed('مفتاح'); renderLayerProps(); }))));
        box.append(btn(GW.ico('plus', 13) + ' عنصر', () => { L.items.push({ color: '#2ec27e', text: 'عنصر' }); changed('مفتاح'); renderLayerProps(); }), row('الموضع', sel([['bl', 'أسفل يسار'], ['br', 'أسفل يمين'], ['tl', 'أعلى يسار'], ['tr', 'أعلى يمين']], L.pos, set('pos', 1))));
        break; }
      case 'title':
        box.append(row('العنوان', txt(L.text, set('text'))), row('العنوان الفرعي', txt(L.sub, set('sub'))), row('القالب', sel([['breaking', 'عاجل'], ['corner', 'زاوية'], ['lower', 'شريط سفلي'], ['center', 'وسط الشاشة']], L.template, set('template', 1))), row('اللون', col(L.color, set('color'))));
        break;
    }
  }
  function lonlat(L) { const c = selMap(); const tt = c ? lt(c) - (L.start || 0) : 0; const w = h('div', 'mp-row'); w.append(btn(M.mode === 'place' ? 'انقر على الخريطة للتحديد' : 'تحديد الموقع من الشاشة', () => { M.mode = 'place'; renderPanel(); }), h('span', 'kv', `${(+GW.pv(L.lon, tt)).toFixed(2)}°, ${(+GW.pv(L.lat, tt)).toFixed(2)}°`)); return w; }
  // a colour picker per selected country (overrides the layer colour)
  function countryColors(c, L) {
    const w = h('div'); if ((L.keys || []).length < 2) return w; const scn = sc(c); const era = G.era(GW.pv(scn.year, lt(c)), scn.eraMode); const by = new Map((G.features(era, 0) || []).map(f => [f.key, f]));
    for (const k of L.keys) { const f = by.get(k); L.colors = L.colors || {}; w.append(row('لون ' + (f ? G.name(f, 'ar', era) : k), col(L.colors[k] || L.color, v => { L.colors[k] = v; GW.invalidate(); }), btn(GW.ico('close', 11), () => { delete L.colors[k]; changed('لون الدولة'); renderLayerProps(); }))); }
    return w;
  }

  // project load: convert legacy map clips
  GW.bus.on('project', () => { for (const s of GW.prj.seqs || []) for (const c of s.clips) if (c.kind === 'map' && c.map && c.map.scene && c.map.scene.v !== 3) c.map.scene = A.newScene(); });
})();
