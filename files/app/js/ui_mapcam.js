'use strict';
/* Map camera keyframing (After Effects + GEOlayers-like):
   • GW.CamKeys — camera key selection / clipboard / commands shared by Effect Controls, the timeline and the viewer
   • Effect Controls «الكاميرا» section: per-property rows (stopwatch, ◇, prev/next, scrubbable values) whose keyframe lane,
     right-click menu and graph editor run on the shared ui_fxc.js machinery through live "view params" (Proxy keys)
   • «كاميرا الخريطة» viewer panel: the only place where the map camera is navigated (drag / wheel / right-drag /
     double-click), with auto-key, safe frame, motion path and a mini key strip.
   Key maths lives in atlas/camera.js (Cam.setKey / split / setInterp / rove / equalize / reverse). */
(function () {
  const A = GW.Atlas, Cm = A.Cam, M = GW.MapUI, F = GW.FXC;
  const { clamp, esc } = GW;
  const CK = GW.CamKeys = { sel: [] };
  const scn = (c) => c.map.scene;
  const isMap = (c) => !!(c && c.kind === 'map' && c.map && c.map.scene && c.map.scene.v === 3);
  const clipLT = (c) => GW.seq().t - c.start; // clip-local
  const fps = () => GW.seq().fps || 30;
  CK.clip = () => M.clip();

  /* ---------------- selection (pairs {rec, g}; g = null → the whole key) ---------------- */
  CK.isSel = (rec, g) => CK.sel.some(p => p.rec === rec && (p.g == null || g == null || p.g === g));
  CK.clearSel = () => { CK.sel = []; };
  CK.selected = (c) => { if (!c || !isMap(c)) return []; const ks = scn(c).cam.keys || []; return [...new Set(CK.sel.map(p => p.rec))].filter(r => ks.includes(r)); };
  const pruneSel = (c) => { const ks = c && isMap(c) ? scn(c).cam.keys || [] : []; CK.sel = CK.sel.filter(p => ks.includes(p.rec) && (p.g == null || Cm.defines(p.rec, p.g))); };
  GW.bus.on('project', () => { CK.sel = []; }); // undo/redo swap the key objects: stale pairs are pruned on use (pruneSel)
  GW.bus.on('selection', () => { CK.sel = []; }); // clicking clips takes the selection away from keys (Delete then removes clips)
  // the selected pairs, each made to own its key (AE: a property keyframe moves / eases alone)
  function ownPairs(c, pairs) {
    const cam = scn(c).cam; Cm.modernize(cam); const out = [];
    const byRec = new Map(); for (const p of pairs) { if (!byRec.has(p.rec)) byRec.set(p.rec, new Set()); if (p.g == null) Cm.GLIST.forEach(g => Cm.defines(p.rec, g) && byRec.get(p.rec).add(g)); else byRec.get(p.rec).add(p.g); }
    for (const [rec, gs] of byRec) {
      const all = Cm.GLIST.filter(g => Cm.defines(rec, g));
      if (all.every(g => gs.has(g))) { out.push(...[...gs].map(g => ({ rec, g }))); continue; }
      for (const g of gs) out.push({ rec: Cm.split(cam, rec, g), g });
    }
    return out;
  }
  const done = (c, label, soon) => { const cam = scn(c).cam; cam.keys && cam.keys.sort((a, b) => a.t - b.t); Cm.rove(cam, scn(c).mode); GW.invalidate(); if (label) (soon ? GW.commitSoon : GW.commit)(label); GW.bus.emit('camkeys'); if (M.render) M.render(); };
  CK.done = done;

  /* ---------------- commands ---------------- */
  CK.applyInterp = (c, pairs, kind) => {
    if (!pairs.length) return 0; const own = ownPairs(c, pairs); const recs = [...new Set(own.map(p => p.rec))];
    if (kind === 'roving') { const on = !recs.every(r => r.roving); for (const r of recs) { if (on) r.roving = 1; else delete r.roving; } }
    else for (const r of recs) Cm.setInterp(r, kind);
    CK.sel = own; done(c, 'نوع الاستيفاء'); return recs.length;
  };
  // F9 / Shift+F9 / Ctrl+Shift+F9 / hold / linear on the selected camera keys (else the keys at the playhead)
  CK.ease = (mode) => {
    const c = CK.clip(); if (!c) return 0; pruneSel(c);
    let pairs = CK.sel.slice(); if (!pairs.length) pairs = Cm.keysAt(scn(c).cam, M.keyT(c), .5 / fps()).map(rec => ({ rec, g: null }));
    if (!pairs.length) return 0;
    if (mode === 'hold') { const tog = pairs.every(p => p.rec.interp === 'hold'); return CK.applyInterp(c, pairs, tog ? 'fly' : 'hold'); }
    return CK.applyInterp(c, pairs, mode);
  };
  CK.del = () => { const c = CK.clip(); if (!c) return false; pruneSel(c); if (!CK.sel.length) return false; const cam = scn(c).cam; for (const p of CK.sel) Cm.delKey(cam, p.rec, p.g || undefined); CK.sel = []; done(c, 'حذف مفتاح كاميرا'); return true; };
  // Ctrl+C / Ctrl+V: copy the selected camera keys, paste them at the playhead (relative timing kept)
  CK.copy = () => {
    const c = CK.clip(); if (!c) return false; pruneSel(c); if (!CK.sel.length) return false;
    const by = new Map(); for (const p of CK.sel) { const o = by.get(p.rec) || { t: p.rec.t, interp: p.rec.interp, ease: p.rec.ease, roving: p.rec.roving, gs: new Set() }; if (p.g == null) Cm.GLIST.forEach(g => Cm.defines(p.rec, g) && o.gs.add(g)); else o.gs.add(p.g); by.set(p.rec, o); }
    const t0 = Math.min(...[...by.values()].map(o => o.t)); const recs = [];
    for (const [rec, o] of by) { const r = { t: o.t - t0, interp: Cm.interpOf(rec), ease: JSON.parse(JSON.stringify(rec.ease == null ? 'inout' : rec.ease)) }; if (o.roving) r.roving = 1; for (const g of o.gs) for (const f of Cm.GROUPS[g]) r[f] = Cm.keyVal(rec, f, scn(c).cam); recs.push(r); }
    CK.clipboard = recs; GW.lastCopy = 'cam'; GW.toast('تم نسخ ' + recs.length + ' مفتاح كاميرا'); return true;
  };
  CK.paste = () => {
    const c = CK.clip(); if (!c || !CK.clipboard || GW.lastCopy !== 'cam') return false; const s = GW.seq(); if (s.t < c.start || s.t > c.start + c.dur) { GW.toast('ضع مؤشر التشغيل داخل مقطع الخريطة'); return true; }
    const added = Cm.pasteKeys(scn(c).cam, CK.clipboard, M.keyT(c), { mode: scn(c).mode }); CK.sel = added.map(rec => ({ rec, g: null })); done(c, 'لصق مفاتيح الكاميرا'); return true;
  };
  // K: camera key at the playhead (map clip selected, transport stopped)
  CK.kKey = () => { const c = CK.clip(); const s = GW.seq(); if (!c || s.t < c.start || s.t > c.start + c.dur) return false; M.addKey(c); GW.toast('مفتاح كاميرا عند ' + GW.fmtTC(s.t, s.fps)); return true; };
  // key times (sequence seconds) for [ / ]
  CK.times = (c) => isMap(c) ? (scn(c).cam.keys || []).map(k => c.start + k.t - (c.in || 0)) : [];

  /* ---------------- live view params for Effect Controls rows ---------------- */
  const DEFV = { tilt: 0, heading: 0, roll: 0, fov: 35, off: [0, 0] };
  const gval = (rec, g, cam) => g === 'pos' ? [Cm.keyVal(rec, 'lon', cam), Cm.keyVal(rec, 'lat', cam)] : g === 'off' ? [Cm.keyVal(rec, 'offX', cam) * 100, Cm.keyVal(rec, 'offY', cam) * 100] : Cm.keyVal(rec, Cm.GROUPS[g][0], cam);
  const vnow = (v, g) => g === 'pos' ? [v.lon, v.lat] : g === 'off' ? [v.offX * 100, v.offY * 100] : v[Cm.GROUPS[g][0]];
  function keyProxy(c, rec, g) {
    const T = { rec, g, c }; const cam = () => scn(c).cam;
    const own = () => { if (Cm.GLIST.some(q => q !== T.g && Cm.defines(T.rec, q)) || Cm.isLegacy(T.rec)) { const was = CK.isSel(T.rec, T.g); T.rec = Cm.split(cam(), T.rec, T.g); if (was) CK.sel.push({ rec: T.rec, g: T.g }); } return T.rec; };
    const easeObj = (r) => { if (!r.ease || typeof r.ease !== 'object') r.ease = { in: Cm.handle(r, 'in').slice(), out: Cm.handle(r, 'out').slice() }; return r.ease; };
    return new Proxy(T, {
      get(_, p) {
        const r = T.rec;
        if (p === 't') return r.t - (c.in || 0);
        if (p === 'v') return gval(r, T.g, cam());
        if (p === 'e') return Cm.easeKind(r);
        if (p === 'bo') return r.ease && typeof r.ease === 'object' ? Cm.handle(r, 'out') : undefined;
        if (p === 'bi') return r.ease && typeof r.ease === 'object' ? Cm.handle(r, 'in') : undefined;
        if (p === '_sel') return CK.isSel(r, T.g);
        if (p === '_rec') return r; if (p === '_g') return T.g; if (p === '_cam') return true;
        return undefined;
      },
      set(_, p, v) {
        if (p === 't') { const r = own(); r.t = clamp(v, 0, c.dur) + (c.in || 0); cam().keys.sort((a, b) => a.t - b.t); }
        else if (p === 'e') Cm.setInterp(own(), v === 'hold' ? 'hold' : v);
        else if (p === 'bo') { const r = own(); easeObj(r).out = [+v[0], +v[1]]; if (r.interp === 'hold') r.interp = 'bezier'; }
        else if (p === 'bi') { const r = own(); easeObj(r).in = [+v[0], +v[1]]; }
        return true;
      },
      deleteProperty() { return true; }, has(_, p) { return ['t', 'v', 'e'].includes(p); }
    });
  }
  // a GW.P-shaped object whose keys are the group's camera keys (for the shared lane / graph code)
  CK.vparam = (c, g) => {
    const cam = scn(c).cam; const tr = Cm.track(cam, g);
    return { _cam: true, g, c, v: vnow(Cm.atRaw(cam, clipLT(c) + (c.in || 0), scn(c).mode), g), k: tr.length ? tr.map(r => keyProxy(c, r, g)) : undefined,
      _val: (t) => vnow(Cm.atRaw(scn(c).cam, t + (c.in || 0), scn(c).mode), g) };
  };

  /* ---------------- Effect Controls «الكاميرا» section ---------------- */
  const SW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 13V9M10 2h4M12 2v3"/></svg>';
  // set values from a row: AE semantics — keyed when that property is animated, otherwise the static value
  CK.setVals = (c, vals, fin, label) => {
    const cam = scn(c).cam; const t = M.keyT(c); const byG = {};
    for (const f in vals) { const g = Cm.groupOf(f); (byG[g] = byG[g] || {})[f] = vals[f]; }
    for (const g in byG) { if (Cm.animated(cam, g)) Cm.setKey(cam, t, byG[g], { eps: .5 / fps(), mode: scn(c).mode }); else for (const f in byG[g]) cam[f] = +byG[g][f]; }
    GW.mapFast = fin ? 0 : performance.now(); GW.invalidate(); GW.bus.emit('camkeys');
    if (fin) { GW.commit(label || 'تعديل الكاميرا'); if (M.render) M.render(); } else { F.drawKeys(); if (M.refreshCam) M.refreshCam(); }
  };
  const ROWS = [
    ['pos', 'الموقع', 'خط الطول / العرض للهدف'],
    ['zoom', 'الارتفاع / التقريب', 'مستوى التقريب، والارتفاع بالكيلومتر فوق الهدف'],
    ['tilt', 'الإمالة', 'إمالة الكاميرا عن العمودي (كرة أرضية فقط)'],
    ['heading', 'الاتجاه', 'اتجاه الكاميرا (0 = الشمال للأعلى)'],
    ['roll', 'الدوران', 'دوران الأفق حول محور العدسة (كرة أرضية فقط)'],
    ['fov', 'زاوية العدسة', 'زاوية الرؤية بالدرجات (كرة أرضية فقط)'],
    ['off', 'إزاحة الهدف', 'إزاحة الهدف عن مركز الإطار بالنسبة المئوية']];
  function camRow(c, g, name, tip) {
    const B = F.builders; const cam = scn(c).cam; const p = CK.vparam(c, g); const flat = scn(c).mode === 'flat';
    const r = document.createElement('div'); r.className = 'prow camrow'; r.dataset.cam = g; if (flat && (g === 'tilt' || g === 'roll' || g === 'fov')) { r.classList.add('dim'); r.title = 'الخريطة المسطحة تتجاهل هذه الخاصية'; } else r.title = tip;
    const sw = document.createElement('button'); sw.className = 'sw' + (p.k ? ' on' : ''); sw.innerHTML = SW; sw.title = 'تفعيل/تعطيل الحركة بالمفاتيح لهذه الخاصية'; sw.dataset.a = 'sw';
    sw.onclick = () => { Cm.setAnimated(cam, g, !Cm.animated(cam, g), M.keyT(c), scn(c).mode); done(c, Cm.animated(cam, g) ? 'تفعيل حركة الكاميرا' : 'إلغاء حركة الكاميرا'); F.render(); };
    const nm = document.createElement('span'); nm.className = 'pn'; nm.textContent = name;
    const pv = document.createElement('span'); pv.className = 'pv';
    const get = () => Cm.atRaw(scn(c).cam, M.keyT(c), scn(c).mode);
    const sc = (f, o) => GW.scrub({ get: () => o.get ? o.get(get()) : get()[f], set: (v, fin) => CK.setVals(c, o.set ? o.set(v) : { [f]: v }, fin), step: o.step, dec: o.dec, unit: o.unit, min: o.min, max: o.max });
    const pair = (...els) => { const w = document.createElement('span'); w.style.cssText = 'display:inline-flex;gap:8px;align-items:center'; w.append(...els); return w; };
    if (g === 'pos') pv.append(pair(sc('lon', { step: .01, dec: 3, unit: '°' }), sc('lat', { step: .01, dec: 3, unit: '°', min: -85, max: 85 })));
    else if (g === 'zoom') { const km = GW.scrub({ get: () => { const v = get(); return Cm.altitudeKm(v.zoom, v.lat, v.fov); }, set: (v, fin) => { const cur = get(); CK.setVals(c, { zoom: Cm.zoomForAlt(Math.max(.01, v), cur.lat, cur.fov) }, fin); }, step: 5, dec: 2, fmt: (v) => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + 'km', min: .01 }); km.title = 'الارتفاع فوق الهدف'; pv.append(pair(sc('zoom', { step: .01, dec: 3, min: 0, max: 21 }), km)); }
    else if (g === 'tilt') pv.append(sc('tilt', { step: .2, dec: 1, unit: '°', min: 0, max: 80 }));
    else if (g === 'heading') pv.append(sc('heading', { step: .5, dec: 1, unit: '°' }));
    else if (g === 'roll') pv.append(sc('roll', { step: .2, dec: 1, unit: '°' }));
    else if (g === 'fov') pv.append(sc('fov', { step: .2, dec: 1, unit: '°', min: 5, max: 120 }));
    else if (g === 'off') pv.append(pair(sc('offX', { get: v => v.offX * 100, set: v => ({ offX: clamp(v, -50, 50) / 100 }), step: .2, dec: 1, unit: '%' }), sc('offY', { get: v => v.offY * 100, set: v => ({ offY: clamp(v, -50, 50) / 100 }), step: .2, dec: 1, unit: '%' })));
    const kn = document.createElement('span'); kn.className = 'kn';
    const tr = () => Cm.track(scn(c).cam, g);
    const prev = document.createElement('button'); prev.className = 'kprev'; prev.innerHTML = GW.ico('keyprev', 12); prev.title = 'المفتاح السابق';
    const at = !!Cm.keyAt(cam, M.keyT(c), g, .5 / fps());
    const dia = document.createElement('button'); dia.className = 'kd' + (at ? ' on' : ''); dia.innerHTML = GW.ico(at ? 'keydiaon' : 'keydia', 12); dia.title = 'إضافة/حذف مفتاح'; dia.dataset.a = 'kd';
    const next = document.createElement('button'); next.className = 'knext'; next.innerHTML = GW.ico('keynext', 12); next.title = 'المفتاح التالي';
    prev.onclick = () => { const t = M.keyT(c); const k = tr().filter(k => k.t < t - 1e-4).pop(); if (k) GW.seek(c.start + k.t - (c.in || 0)); };
    next.onclick = () => { const t = M.keyT(c); const k = tr().find(k => k.t > t + 1e-4); if (k) GW.seek(c.start + k.t - (c.in || 0)); };
    dia.onclick = () => { const camN = scn(c).cam; const t = M.keyT(c); const k = Cm.keyAt(camN, t, g, .5 / fps()); if (k) Cm.delKey(camN, k, g); else { const v = Cm.atRaw(camN, t, scn(c).mode); const vals = {}; for (const f of Cm.GROUPS[g]) vals[f] = v[f]; Cm.setKey(camN, t, vals, { eps: .5 / fps(), mode: scn(c).mode }); } done(c, 'مفتاح كاميرا'); F.render(); };
    kn.append(prev, dia, next);
    const rs = document.createElement('button'); rs.className = 'reset btn sm ico ghost'; rs.innerHTML = GW.ico('reset', 13); rs.title = 'إعادة الضبط';
    if (DEFV[g] !== undefined) rs.onclick = () => { const d = DEFV[g]; CK.setVals(c, g === 'off' ? { offX: d[0], offY: d[1] } : { [g]: d }, true, 'إعادة الضبط'); F.render(); }; else rs.style.visibility = 'hidden';
    kn.append(rs);
    r.append(sw, nm, pv, kn); r._p = p; r._c = c; F.rows.push(r);
    if (B.graphTwirl) B.graphTwirl(r, c, p, nm, {});
    r._refresh = () => { const on = !!Cm.keyAt(scn(c).cam, M.keyT(c), g, .5 / fps()); dia.classList.toggle('on', on); if (dia.dataset.on !== String(on)) { dia.dataset.on = String(on); dia.innerHTML = GW.ico(on ? 'keydiaon' : 'keydia', 12); } };
    return r;
  }
  F.extra = F.extra || [];
  F.extra.push((L, c) => {
    if (!isMap(c)) return; const B = F.builders; const cam = scn(c).cam;
    const any = Cm.animated(cam);
    const sec = B.section('الكاميرا', { key: 'mapcam', tools: [
      { icon: GW.ico('camera', 13), title: 'فتح لوحة كاميرا الخريطة', action: () => { if (GW.setWorkspace && GW.active.ws !== 'maps') GW.setWorkspace('maps'); GW.showPanel('mapcam'); } }] });
    sec.firstChild.classList.add('camsec'); if (any) sec.firstChild.classList.add('rec');
    for (const [g, n, tip] of ROWS) sec.body.append(camRow(c, g, n, tip));
    const tools = document.createElement('div'); tools.className = 'mask-row camtools';
    const mk = (label, fn, title) => { const b = document.createElement('button'); b.className = 'btn sm'; b.innerHTML = label; b.onclick = fn; if (title) b.title = title; return b; };
    tools.append(mk(GW.ico('keydia', 12) + ' مفتاح للكل', () => M.addKey(c), 'مفتاح لكل الخصائص المتحركة عند المؤشر (K)'), mk('تسوية السرعة', () => M.equalize(c), 'إعادة توزيع أوقات المفاتيح لسرعة ثابتة'), mk('عكس', () => M.reverseKeys(c), 'عكس المفاتيح زمنياً'));
    sec.body.append(tools); L.append(sec);
  });
  GW.bus.on('camkeys', () => { if (GW.TL && GW.TL.invalidate) GW.TL.invalidate(); });
  GW.bus.on('camkeys', () => { if (!F.left) return; F.rows.forEach(r => r._refresh && r._refresh()); F.drawKeys(); });
  GW.bus.on('time', () => { if (!F.left || GW.pb.playing) return; F.rows.forEach(r => r._refresh && r._refresh()); });

  /* ---- keyframe-lane interaction for camera keys (called by ui_fxc.js) ---- */
  F.camMenu = (e, hk) => {
    const c = hk.c; const rec = hk.k._rec, g = hk.k._g; if (!CK.isSel(rec, g)) CK.sel = [{ rec, g }];
    const pairs = CK.sel.slice(); const r0 = rec; const kind = Cm.easeKind(r0), ip = Cm.interpOf(r0);
    const it = (label, k, check, cmd) => ({ label, check, key: cmd && GW.Keys ? GW.Keys.first(cmd) : undefined, action: () => { CK.applyInterp(c, pairs, k); F.render(); } });
    GW.menu(e.clientX, e.clientY, [
      it('طيران (قوس van Wijk)', 'fly', ip === 'fly'), it('منحنى ناعم عبر المفاتيح', 'bezier', ip === 'bezier'), '-',
      it('تسهيل (Easy Ease)', 'ease', kind === 'ease' && ip !== 'hold', 'gfx.easyEase'), it('تسهيل الدخول', 'easeIn', kind === 'easeIn', 'gfx.easeIn'), it('تسهيل الخروج', 'easeOut', kind === 'easeOut', 'gfx.easeOut'),
      it('خطي', 'linear', ip === 'linear'), it('ثبات (Hold)', 'hold', ip === 'hold', 'gfx.keyHold'), it('سرعة ثابتة (Roving)', 'roving', !!r0.roving), '-',
      { label: 'نسخ', key: 'Ctrl+C', action: () => CK.copy() }, { label: 'حذف المفتاح', key: 'Delete', action: () => { CK.del(); F.render(); } }]);
  };
  F.camDown = (e, hk, x, y, el) => {
    const c = hk.c; const rec = hk.k._rec, g = hk.k._g;
    if (e.shiftKey || e.ctrlKey || e.metaKey) { if (CK.isSel(rec, g)) CK.sel = CK.sel.filter(p => !(p.rec === rec && (p.g === g || p.g == null))); else CK.sel.push({ rec, g }); F.drawKeys(); GW.bus.emit('camkeys'); return; }
    if (!CK.isSel(rec, g)) CK.sel = [{ rec, g }]; F.selKey = null; F.drawKeys();
    const r = el.getBoundingClientRect(); el.setPointerCapture(e.pointerId); let moved = false, items = null;
    el.onpointermove = ev => {
      const dx = ev.clientX - r.left - x; if (!moved && Math.abs(dx) < 3) return;
      if (!moved) { moved = true; CK.sel = ownPairs(c, CK.sel); items = [...new Set(CK.sel.map(p => p.rec))].map(k => ({ k, t0: k.t })); }
      const dt = dx / (r.width - 16) * c.dur; const lo = c.in || 0, hi = lo + c.dur;
      const sh = clamp(dt, lo - Math.min(...items.map(i => i.t0)), hi - Math.max(...items.map(i => i.t0)));
      for (const i of items) i.k.t = lo + clamp(GW.snapFrame(i.t0 + sh - lo, fps()), 0, c.dur);
      scn(c).cam.keys.sort((a, b) => a.t - b.t); GW.invalidate(); F.drawKeys(); GW.bus.emit('camkeys');
    };
    el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; if (moved) { done(c, 'تحريك مفتاح كاميرا'); F.render(); } else GW.bus.emit('camkeys'); };
  };
  // marquee selection in the camera rows of the lane (click without dragging = seek)
  F.camBox = (e, x, y, el) => {
    const c = CK.clip(); if (!c || y < 24) return false; const row = F.rows.find(r => r._p && r._p._cam && r.isConnected && (() => { const b = r.getBoundingClientRect(), t = el.getBoundingClientRect().top; return y >= b.top - t && y <= b.bottom - t; })());
    if (!row) return false;
    const r = el.getBoundingClientRect(); el.setPointerCapture(e.pointerId); let moved = false; const add = e.shiftKey;
    el.onpointermove = ev => { const xx = ev.clientX - r.left, yy = ev.clientY - r.top; if (!moved && Math.hypot(xx - x, yy - y) < 4) return; moved = true; F.box = [Math.min(x, xx), Math.min(y, yy), Math.max(x, xx), Math.max(y, yy)];
      const hits = (F.keyHits || []).filter(h => h.k && h.k._cam && h.x >= F.box[0] - 4 && h.x <= F.box[2] + 4 && h.y >= F.box[1] - 5 && h.y <= F.box[3] + 5);
      CK.sel = (add ? CK.sel : []).concat(hits.map(h => ({ rec: h.k._rec, g: h.k._g }))); F.drawKeys(); };
    el.onpointerup = ev => { el.onpointermove = null; el.onpointerup = null; F.box = null; if (!moved) { CK.sel = []; GW.seek(c.start + clamp(F.T ? F.T(ev.clientX - r.left) : 0, 0, c.dur)); } F.drawKeys(); GW.bus.emit('camkeys'); };
    return true;
  };

  /* ---------------- timeline: camera key diamonds at the bottom of map clips ---------------- */
  CK.tlDraw = (g, c, TL, xa, xb, y, h) => {
    if (!isMap(c) || h < 18) return; const ks = scn(c).cam.keys || []; if (!ks.length) return;
    const yy = y + h - 5.5; const seen = new Set(); const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff6a2b';
    for (const k of ks) {
      const x = Math.round(TL.x(c.start + k.t - (c.in || 0))); if (x < xa - 4 || x > xb + 4 || seen.has(x)) continue; seen.add(x);
      const sel = CK.isSel(k, null); g.fillStyle = sel ? '#5aa9ff' : acc; g.beginPath(); g.moveTo(x, yy - 3.5); g.lineTo(x + 3.5, yy); g.lineTo(x, yy + 3.5); g.lineTo(x - 3.5, yy); g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 1; g.stroke();
    }
  };

  /* ================= «كاميرا الخريطة» viewer panel ================= */
  const V = CK.view = { path: true, safe: true, ver: 0, memo: null };
  { const inv0 = GW.invalidate; GW.invalidate = () => { V.ver++; inv0(); }; }
  const viewClip = () => { const c = CK.clip(); if (c) return c; const s = GW.seq(); return s.clips.filter(x => isMap(x) && s.t >= x.start && s.t < x.start + x.dur).sort((a, b) => b.ti - a.ti)[0] || null; };
  GW.registerPanel('mapcam', 'كاميرا الخريطة', (el) => {
    el.classList.add('mcv-root');
    el.innerHTML = `<div class="mcv" dir="rtl"><div class="mcv-bar" data-a="bar"></div><div class="mcv-stage" data-a="stage" dir="ltr"><canvas data-a="cv"></canvas><canvas data-a="ov" tabindex="0"></canvas><div class="mcv-empty" data-a="empty" dir="rtl"></div></div><div class="mcv-strip" data-a="strip" dir="ltr"><canvas data-a="sc"></canvas></div></div>`;
    V.el = el; V.stage = el.querySelector('[data-a=stage]'); V.cv = el.querySelector('[data-a=cv]'); V.ov = el.querySelector('[data-a=ov]'); V.sc = el.querySelector('[data-a=sc]'); V.bar = el.querySelector('[data-a=bar]'); V.empty = el.querySelector('[data-a=empty]');
    initViewer(); buildBar(); V.ver++; tick();
  });
  const fit = () => {
    const c = viewClip(); if (!c || !V.stage) return null; const s = GW.seq(); const W = c.sw || s.w, H = c.sh || s.h;
    const cw = V.stage.clientWidth, ch = V.stage.clientHeight; if (!cw || !ch) return null;
    const pad = 14; const k = Math.min((cw - pad * 2) / W, (ch - pad * 2) / H); const w = W * k, h = H * k;
    return { c, W, H, x: (cw - w) / 2, y: (ch - h) / 2, w, h, cw, ch };
  };
  // M.surf: viewer px ↔ map-frame px
  M.surf = {
    toMap: (X, Y) => { const f = V.fit || fit(); return f ? [(X - f.x) * f.W / f.w, (Y - f.y) * f.H / f.h] : [X, Y]; },
    toScreen: (x, y) => { const f = V.fit || fit(); return f ? [f.x + x * f.w / f.W, f.y + y * f.h / f.H] : [x, y]; },
    box: () => { const f = V.fit || fit(); return f ? { x: f.x, y: f.y, w: f.w, h: f.h } : { x: 0, y: 0, w: 0, h: 0 }; },
    redraw: () => { V.ovDirty = true; }
  };
  const interacting = () => V.drag || !!M._animId || (GW.mapFast && performance.now() - GW.mapFast < 300);
  function tick() {
    requestAnimationFrame(tick);
    if (!V.el || !V.el.isConnected || V.el.closest('#store')) return;
    const f = V.fit = fit(); const dpr = devicePixelRatio || 1;
    for (const cv of [V.cv, V.ov]) { const w = Math.round(V.stage.clientWidth * dpr), h = Math.round(V.stage.clientHeight * dpr); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; V.memo = null; } }
    const sw = Math.round(V.sc.clientWidth * dpr), sh = Math.round(V.sc.clientHeight * dpr); if (V.sc.width !== sw || V.sc.height !== sh) { V.sc.width = sw; V.sc.height = sh; }
    const s = GW.seq(); const c = f && f.c; const inside = c && s.t >= c.start && s.t < c.start + c.dur;
    V.empty.hidden = !!inside; if (!inside) { const ek = c ? 'out:' + c.id : 'none'; if (V.emptyK !== ek) { V.emptyK = ek; emptyState(c); } } else V.emptyK = null;
    { const sk = f && f.c ? f.c.id + ':' + scn(f.c).layers.length : ''; if (sk !== V.stripK) { V.stripK = sk; const want = stripH(f && f.c); if (V.stripPx !== want) { V.stripPx = want; V.sc.parentElement.style.height = want + 'px'; } } }
    const busy = interacting(); const playing = GW.pb.playing;
    const lt = inside ? s.t - c.start : 0;
    const q = busy || playing ? .5 : 1;
    const key = inside ? [c.id, lt.toFixed(5), Math.round(f.w * dpr * q), Math.round(f.h * dpr * q), V.ver, A.Tiles ? A.Tiles.loaded : 0, busy ? 1 : 0, c.map.bg || ''].join('|') : 'none';
    // throttle: while idle (tiles streaming in, background invalidations) leave the main thread room between slow frames
    const now = performance.now(); const k0 = inside ? [c.id, lt.toFixed(5), Math.round(f.w * dpr * q), Math.round(f.h * dpr * q)].join('|') : 'none'; const urgent = V.urgent || k0 !== V.k0; // user edits / time / size: prompt; tile streaming: relaxed
    const gap = busy ? 0 : playing ? 60 : urgent ? 60 : Math.max(1000, (V.lastDur || 0) * 4); const thr = now - (V.lastR || 0) < gap;
    if (key !== V.pendKey) { V.pendKey = key; V.pendT = now; } const settle = !busy && !playing && now - V.pendT < 120; // idle: let the Program monitor draw first (its frame is reused)
    if (key !== V.key && !thr && !settle) { V.key = key; V.k0 = k0; V.urgent = false; renderMap(f, inside ? c : null, lt, q, busy || playing); V.lastR = performance.now(); V.lastDur = V.lastR - now; V.ovDirty = true; }
    if (V.ovDirty || busy || playing || V.stripDirty !== V.ver + '|' + s.t) { V.ovDirty = false; drawOverlay(f, inside ? c : null); drawStrip(f ? f.c : null); V.stripDirty = V.ver + '|' + s.t; }
  }
  function renderMap(f, c, lt, q, fast) {
    const g = V.cv.getContext('2d'); const dpr = devicePixelRatio || 1; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, V.cv.width, V.cv.height);
    if (!f || !c) return;
    const lw = Math.max(2, Math.round(f.w * dpr * q)), lh = Math.max(2, Math.round(f.h * dpr * q));
    // idle: reuse the Program monitor's stable frame (render.js RN._mapMemo) when it shows the same clip / time / scene / tiles,
    // so the map is not drawn twice per change; otherwise (interaction, Program hidden or smaller) render here
    let cv = null; const memo = !fast && GW.Render && GW.Render._mapMemo && GW.Render._mapMemo.get(c.id);
    if (memo && memo.cv.width >= lw * .9) { const parts = memo.k.split('|'); if (+parts[0] === lt && (parts[5] || '') === (c.map.bg || '') && Math.abs(memo.cv.width / memo.cv.height - lw / lh) < .02 && memo.k.endsWith('|' + JSON.stringify(scn(c)))) cv = memo.cv; }
    if (!cv) try { cv = A.render(scn(c), lt + (c.in || 0), lw, lh, { bg: c.map.bg || 'full', dur: c.dur, quality: fast ? .8 : 1, fast }); } catch (e) { console.error('mapcam render', e); }
    g.fillStyle = '#05070a'; g.fillRect(f.x * dpr, f.y * dpr, f.w * dpr, f.h * dpr);
    if (cv) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, cv.width, cv.height, f.x * dpr, f.y * dpr, f.w * dpr, f.h * dpr); }
    if (cv && fast) GW.MapCamFrame = { id: c.id, lt, at: performance.now(), cv: V.cv, sx: f.x * dpr, sy: f.y * dpr, sw: f.w * dpr, sh: f.h * dpr };
  }
  // camera target path across the keys (dots per key, the current position ring)
  function drawPath(g, f, c) {
    const cam = scn(c).cam; const tr = Cm.track(cam, 'pos'); if (tr.length < 2) return;
    const vw = M.ctx() && M.ctx().vw; if (!vw) return; const mode = scn(c).mode;
    const sp = (lo, la) => { const q = vw.project(lo, la); return q ? M.surf.toScreen(q[0], q[1]) : null; };
    const t0 = tr[0].t, t1 = tr[tr.length - 1].t; const N = 160; const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff6a2b';
    g.save(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.85)'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 3; g.setLineDash([]); g.beginPath(); let pen = false;
    for (let i = 0; i <= N; i++) { const t = t0 + (t1 - t0) * i / N; const v = Cm.atRaw(cam, t, mode); const p = sp(v.lon, v.lat); if (!p) { pen = false; continue; } pen ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); pen = true; }
    g.stroke(); g.shadowBlur = 0;
    // speed ticks: one dot per 0.5 s (spacing shows the speed like AE's motion path)
    g.fillStyle = 'rgba(255,255,255,.75)'; for (let t = t0; t <= t1 + 1e-6; t += .5) { const v = Cm.atRaw(cam, t, mode); const p = sp(v.lon, v.lat); if (p) { g.beginPath(); g.arc(p[0], p[1], 1.6, 0, 7); g.fill(); } }
    V.pathHits = [];
    for (const k of tr) { const p = sp(Cm.keyVal(k, 'lon', cam), Cm.keyVal(k, 'lat', cam)); if (!p) continue; V.pathHits.push({ k, x: p[0], y: p[1] }); const sel = CK.isSel(k, 'pos'); g.fillStyle = sel ? '#5aa9ff' : acc; g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); if (k.roving) g.arc(p[0], p[1], 4, 0, 7); else { g.moveTo(p[0], p[1] - 6); g.lineTo(p[0] + 6, p[1]); g.lineTo(p[0], p[1] + 6); g.lineTo(p[0] - 6, p[1]); g.closePath(); } g.fill(); g.stroke(); }
    const v = Cm.atRaw(cam, M.keyT(c), mode); const p = sp(v.lon, v.lat); V.curPt = p; if (p) { g.strokeStyle = acc; g.lineWidth = 2; g.beginPath(); g.arc(p[0], p[1], 7, 0, 7); g.stroke(); }
    g.restore();
  }
  function drawOverlay(f, c) {
    const g = V.ov.getContext('2d'); const dpr = devicePixelRatio || 1; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, V.ov.width, V.ov.height);
    if (!f) return;
    // frame border + safe areas (exactly what the export shows)
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.strokeRect(Math.round(f.x) + .5, Math.round(f.y) + .5, Math.round(f.w) - 1, Math.round(f.h) - 1);
    if (V.safe && c) { g.strokeStyle = 'rgba(255,255,255,.22)'; g.setLineDash([4, 4]); for (const m of [.05, .1]) g.strokeRect(f.x + f.w * m + .5, f.y + f.h * m + .5, f.w * (1 - 2 * m), f.h * (1 - 2 * m)); g.setLineDash([]); const cx = f.x + f.w / 2, cy = f.y + f.h / 2; g.beginPath(); g.moveTo(cx - 7, cy); g.lineTo(cx + 7, cy); g.moveTo(cx, cy - 7); g.lineTo(cx, cy + 7); g.stroke(); }
    if (!c) return;
    if (V.path && !GW.pb.playing) { try { drawPath(g, f, c); } catch (e) { console.error(e); } }
    try { M.showHint = M.mode !== 'nav'; M.overlay(g); } catch (e) { console.error(e); }
    // badges: auto-key, aspect / time
    const s = GW.seq(); g.font = '600 11px Cairo, "IBM Plex Sans Arabic", sans-serif'; g.textBaseline = 'middle';
    const tag = (txt, x, y, col, bg) => { const w = g.measureText(txt).width + 16; g.fillStyle = bg; g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, 20, 4); else g.rect(x, y, w, 20); g.fill(); g.fillStyle = col; g.textAlign = 'left'; g.fillText(txt, x + 8, y + 10.5); return w; };
    const ratio = (() => { const a = f.W / f.H; return Math.abs(a - 16 / 9) < .01 ? '16:9' : Math.abs(a - 9 / 16) < .01 ? '9:16' : Math.abs(a - 1) < .01 ? '1:1' : f.W + '×' + f.H; })();
    let x = f.x + 8; const y = f.y + 8;
    if (Cm.animated(scn(c).cam)) { g.direction = 'rtl'; const txt = 'تسجيل مفاتيح'; const w = g.measureText(txt).width + 30; g.fillStyle = 'rgba(200,24,40,.88)'; g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, 20, 4); else g.rect(x, y, w, 20); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x + w - 11, y + 10, 4, 0, 7); g.fill(); g.textAlign = 'right'; g.fillText(txt, x + w - 20, y + 10.5); g.direction = 'ltr'; x += w + 6; }
    g.direction = 'ltr'; tag(ratio + '  ' + GW.fmtTC(s.t - c.start, s.fps), x, y, '#cfd6df', 'rgba(10,14,20,.7)');
  }
  // mini strip: clip range, playhead (scrub), key diamonds (drag to retime the key time, right-click = interpolation)
  function stripGeo(c) { const w = V.sc.clientWidth; const pad = 10; return { w, pad, X: (t) => pad + (t / Math.max(.001, c.dur)) * (w - pad * 2), T: (x) => (x - pad) / Math.max(1, w - pad * 2) * c.dur }; }
  // map timeline: camera-key row + one bar per layer (top of the list first), drag to retime
  const KEYROW = 26, ROWH = 18, MAXROWS = 8;
  const stripRows = (c) => c ? [...scn(c).layers].reverse().slice(0, MAXROWS) : [];
  function stripH(c) { return c ? KEYROW + 6 + Math.max(1, stripRows(c).length) * ROWH : 30; }
  function emptyState(c) {
    V.empty.innerHTML = ''; const p = document.createElement('div'); p.className = 'mcv-emptyc';
    p.innerHTML = c ? '<b>ضع مؤشر التشغيل داخل مقطع الخريطة</b><span>لتظهر الخريطة هنا وتتحكم بكاميرتها.</span>' : '<b>استوديو الخرائط</b><span>حدد مقطع خريطة في الخط الزمني لتعديله هنا، أو ابدأ خريطة جديدة. اسحب للتحريك، العجلة للتقريب، الزر الأيمن للإمالة، ونقرتان على دولة للتركيز عليها.</span>';
    const row = document.createElement('div'); row.className = 'mcv-erow';
    const mk = (html, fn, cls) => { const b = document.createElement('button'); b.className = 'btn ' + (cls || ''); b.innerHTML = html; b.onclick = fn; row.append(b); };
    if (c) mk(GW.ico('goto', 14) + ' انتقل إلى المقطع', () => GW.seek(c.start + .01), 'pri');
    else { mk(GW.ico('globe', 14) + ' خريطة جديدة', () => GW.UI.addMapClip(A.Scene.applyDocLook(A.newScene({ mode: 'globe' }), 'doc_dark')), 'pri'); if (GW.MapUX) mk(GW.ico('swords', 14) + ' حرب بين دولتين', () => GW.MapUX.openWizard({ target: 'new' })); }
    p.append(row); V.empty.append(p);
  }
  function stripKeys(c) { const by = new Map(); for (const k of scn(c).cam.keys || []) { const t = k.t - (c.in || 0); const key = Math.round(t * fps()); if (!by.has(key)) by.set(key, { t, recs: [] }); by.get(key).recs.push(k); } return [...by.values()]; }
  function drawStrip(c) {
    const g = V.sc.getContext('2d'); const dpr = devicePixelRatio || 1; g.setTransform(dpr, 0, 0, dpr, 0, 0); const w = V.sc.clientWidth, h = V.sc.clientHeight; g.clearRect(0, 0, w, h);
    if (!c) return; const G = stripGeo(c); const s = GW.seq(); const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff6a2b';
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(G.X(0), 6, G.X(c.dur) - G.X(0), h - 12);
    g.fillStyle = 'rgba(255,255,255,.18)'; for (let t = 0; t <= c.dur + 1e-6; t += 1) { const x = Math.round(G.X(t)) + .5; g.fillRect(x, h - 9, 1, t % 5 === 0 ? 6 : 3); }
    const yy = KEYROW / 2; g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(G.X(0), yy); g.lineTo(G.X(c.dur), yy); g.stroke();
    g.font = '600 10px Cairo, "IBM Plex Sans Arabic", sans-serif'; g.textBaseline = 'middle';
    stripRows(c).forEach((L, i) => {
      const y0 = KEYROW + 4 + i * ROWH; const s0 = L.start || 0, e0 = L.dur != null ? s0 + L.dur : c.dur; const x0 = G.X(Math.max(0, s0)), x1 = G.X(Math.min(c.dur, e0)); const on = M.layerId === L.id;
      g.fillStyle = on ? 'rgba(255,106,43,.85)' : L.on ? 'rgba(120,140,170,.55)' : 'rgba(120,120,120,.25)'; g.beginPath(); if (g.roundRect) g.roundRect(x0, y0 + 2, Math.max(3, x1 - x0), ROWH - 4, 3); else g.rect(x0, y0 + 2, Math.max(3, x1 - x0), ROWH - 4); g.fill();
      g.save(); g.beginPath(); g.rect(x0, y0, Math.max(0, x1 - x0), ROWH); g.clip(); g.fillStyle = '#fff'; g.textAlign = 'right'; g.direction = 'rtl'; g.fillText(L.name || '', Math.min(x1 - 6, x0 + 6 + g.measureText(L.name || '').width), y0 + ROWH / 2); g.direction = 'ltr'; g.restore();
      if (L.type === 'campaign') for (const ev of L.events || []) { const x = G.X(s0 + ev.t); g.fillStyle = ev.kind === 'victory' ? '#ffd34d' : '#fff'; g.fillRect(Math.round(x) - 1, y0 + 3, 2, ROWH - 6); }
    });
    for (const it of stripKeys(c)) { const x = G.X(it.t); const sel = it.recs.some(r => CK.isSel(r, null)); const k0 = it.recs[0]; g.fillStyle = sel ? '#5aa9ff' : acc; g.beginPath(); if (k0.interp === 'hold') g.rect(x - 4.5, yy - 4.5, 9, 9); else if (k0.roving) g.arc(x, yy, 4.5, 0, 7); else { g.moveTo(x, yy - 6); g.lineTo(x + 6, yy); g.lineTo(x, yy + 6); g.lineTo(x - 6, yy); g.closePath(); } g.fill(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.stroke(); }
    const px = G.X(clamp(s.t - c.start, 0, c.dur)); g.fillStyle = '#2f8ef0'; g.fillRect(Math.round(px) - 1, 0, 2, h);
  }
  function initViewer() {
    const ov = V.ov; const loc = (e) => { const r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const ensureSel = () => { const c = viewClip(); if (c && !CK.clip()) { GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.bus.emit('selection'); } return CK.clip(); };
    // drag a position key on the motion path to move it (AE-like spatial editing)
    const pathDrag = (e, X, Y) => {
      const c = CK.clip(); const tNow = c && M.keyT(c); const h = c && V.path && e.button === 0 && !e.altKey && (V.pathHits || []).find(q => Math.hypot(q.x - X, q.y - Y) < 8 && Math.abs(q.k.t - tNow) > .5 / fps() && !(V.curPt && Math.hypot(q.x - V.curPt[0], q.y - V.curPt[1]) < 10)); if (!c || !h || !M.ctx()) return false; // the key under the playhead is the camera itself: dragging there pans
      CK.sel = [{ rec: h.k, g: 'pos' }]; ov.setPointerCapture(e.pointerId); let moved = false; V.drag = true;
      const mv = (ev) => { const [x, y] = loc(ev); if (!moved && Math.hypot(x - X, y - Y) < 3) return; if (!moved) { moved = true; CK.sel = ownPairs(c, CK.sel); } const k = M.ctx(); const ll = k && k.vw.pick(...M.surf.toMap(x, y)); if (!ll) return; const r = CK.sel[0].rec; r.lon = ll[0]; r.lat = ll[1]; V.ver++; GW.invalidate(); };
      const up = () => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); V.drag = false; if (moved) done(c, 'تحريك مفتاح على المسار'); else GW.seek(c.start + h.k.t - (c.in || 0)); };
      ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); return true;
    };
    ov.addEventListener('pointerdown', (e) => { ov.focus({ preventScroll: true }); if (!ensureSel()) return; const [X, Y] = loc(e); if (pathDrag(e, X, Y)) { e.preventDefault(); return; } V.drag = true; const end = () => { V.drag = false; V.ver++; ov.removeEventListener('pointerup', end); }; ov.addEventListener('pointerup', end); if (M.down(e, X, Y)) e.preventDefault(); else end(); });
    ov.addEventListener('pointermove', (e) => { if (e.buttons) return; const [X, Y] = loc(e); M.move(X, Y); ov.style.cursor = M.mode === 'nav' ? 'grab' : 'crosshair'; });
    ov.addEventListener('wheel', (e) => { if (!ensureSel()) return; const [X, Y] = loc(e); if (M.wheel(e, X, Y)) e.preventDefault(); }, { passive: false });
    ov.addEventListener('dblclick', (e) => { if (!ensureSel()) return; const [X, Y] = loc(e); M.dbl(X, Y); });
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    // strip
    const sc = V.sc;
    const hitStrip = (x, y) => { const c = viewClip(); if (!c) return null; const G = stripGeo(c); return stripKeys(c).find(it => Math.abs(G.X(it.t) - x) < 7 && Math.abs(y - KEYROW / 2) < 9) || null; };
    sc.addEventListener('pointerdown', (e) => {
      const c = viewClip(); if (!c) return; const r = sc.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const G = stripGeo(c); sc.setPointerCapture(e.pointerId);
      // layer bars: move / resize / retime campaign events; click selects the layer
      if (e.button === 0 && y > KEYROW) { const rows = stripRows(c); const L = rows[Math.floor((y - KEYROW - 4) / ROWH)];
        if (L) { const s0 = L.start || 0, e0 = L.dur != null ? s0 + L.dur : c.dur; const x0 = G.X(s0), x1 = G.X(Math.min(c.dur, e0)); const ev = L.type === 'campaign' ? (L.events || []).find(q => Math.abs(G.X(s0 + q.t) - x) < 5) : null;
          const mode = ev ? 'ev' : Math.abs(x - x1) < 6 && L.dur != null ? 'end' : Math.abs(x - x0) < 6 ? 'start' : x > x0 && x < x1 ? 'move' : null;
          if (mode) { M.layerId = L.id; const t0 = ev ? ev.t : s0; const d0 = L.dur; let moved = false;
            sc.onpointermove = (ev2) => { const dx = ev2.clientX - r.left - x; if (!moved && Math.abs(dx) < 3) return; moved = true; const dt = dx / Math.max(1, G.w - 2 * G.pad) * c.dur; const sn = (v) => GW.snapFrame(v, fps());
              if (mode === 'ev') ev.t = Math.max(0, sn(t0 + dt)); else if (mode === 'move') L.start = clamp(sn(t0 + dt), 0, c.dur - .1); else if (mode === 'start') { const nS = clamp(sn(t0 + dt), 0, (d0 != null ? s0 + d0 : c.dur) - .1); if (d0 != null) L.dur = s0 + d0 - nS; L.start = nS; } else L.dur = Math.max(.1, sn(d0 + dt));
              V.ver++; GW.invalidate(); };
            sc.onpointerup = () => { sc.onpointermove = sc.onpointerup = null; if (moved) { GW.commit(mode === 'ev' ? 'تحريك حدث' : 'توقيت الطبقة'); } if (M.render) M.render(); V.ver++; };
            return; } } }
      const it = e.button === 0 ? hitStrip(x, y) : null;
      if (it) {
        CK.sel = it.recs.map(rec => ({ rec, g: null })); let moved = false; const t0s = it.recs.map(k => k.t);
        sc.onpointermove = (ev) => { const dx = ev.clientX - r.left - x; if (!moved && Math.abs(dx) < 3) return; moved = true; const dt = dx / Math.max(1, G.w - 2 * G.pad) * c.dur; it.recs.forEach((k, i) => { k.t = (c.in || 0) + clamp(GW.snapFrame(t0s[i] - (c.in || 0) + dt, fps()), 0, c.dur); }); scn(c).cam.keys.sort((a, b) => a.t - b.t); V.ver++; GW.invalidate(); GW.bus.emit('camkeys'); };
        sc.onpointerup = () => { sc.onpointermove = sc.onpointerup = null; if (moved) done(c, 'تحريك مفتاح كاميرا'); else { GW.seek(c.start + it.t); } };
        return;
      }
      const f = (ev) => GW.seek(c.start + clamp(G.T(ev.clientX - r.left), 0, c.dur - 1e-4));
      f(e); sc.onpointermove = f; sc.onpointerup = () => { sc.onpointermove = sc.onpointerup = null; };
    });
    sc.addEventListener('contextmenu', (e) => { e.preventDefault(); const r = sc.getBoundingClientRect(); const it = hitStrip(e.clientX - r.left, e.clientY - r.top); const c = viewClip(); if (!it || !c) return; CK.sel = it.recs.map(rec => ({ rec, g: null })); F.camMenu(e, { c, k: { _rec: it.recs[0], _g: null } }); });
    new ResizeObserver(() => { V.memo = null; V.key = null; }).observe(V.stage);
    for (const ev of ['selection', 'changed', 'hist', 'project', 'camkeys', 'history']) GW.bus.on(ev, () => { V.ver++; V.urgent = true; if (ev !== 'camkeys') buildBar(); else refreshBar(); });
    GW.bus.on('time', () => { if (!GW.pb.playing) refreshBar(); });
    GW.bus.on('panel-shown', (id) => { if (id === 'mapcam') { V.key = null; buildBar(); } });
  }
  function refreshBar() {
    if (!V.bar) return; const c = CK.clip(); const kb = V.bar.querySelector('[data-a=k]'); if (!kb || !c) return;
    const cur = M.curKeys(c); const on = cur.length > 0; kb.classList.toggle('on', on); kb.innerHTML = GW.ico(on ? 'keydiaon' : 'keydia', 14);
    const ps = V.bar.querySelector('[data-a=interp]'); if (ps) { ps.disabled = !on; ps.value = on ? (cur[0].interp === 'hold' ? 'hold' : Cm.interpOf(cur[0])) : ''; }
  }
  function buildBar() {
    if (!V.bar) return; const c = CK.clip(); const b = V.bar; b.innerHTML = '';
    const btn = (html, title, fn, a) => { const x = document.createElement('button'); x.className = 'btn sm ico ghost'; x.innerHTML = html; x.title = title; x.onclick = fn; if (a) x.dataset.a = a; return x; };
    const sep = () => { const s = document.createElement('i'); s.className = 'mcv-sep'; return s; };
    // studio toolbar «استوديو الخرائط»: add, undo/redo, play, quality, back to editing
    const st = document.createElement('div'); st.className = 'mcv-studio';
    if (GW.MapUX) { const ad = btn(GW.ico('plus', 14) + '<span>إضافة</span>', 'إضافة طبقة إلى الخريطة', () => GW.MapUX.openGallery(), 'add'); ad.className = 'btn sm pri mcv-add'; ad.disabled = !c; st.append(ad); }
    st.append(btn(GW.ico('undo', 14), 'تراجع (Ctrl+Z)', () => GW.hist && GW.hist.undo()), btn(GW.ico('redo', 14), 'إعادة (Ctrl+Shift+Z)', () => GW.hist && GW.hist.redo()));
    const pl = btn(GW.ico(GW.pb.playing ? 'stop' : 'play', 14), 'تشغيل / إيقاف (مسافة)', () => { if (GW.pb.playing) GW.stop(); else GW.play(1); setTimeout(buildBar, 30); }, 'play'); st.append(pl);
    const qs = document.createElement('select'); qs.className = 'sel'; qs.title = 'جودة المعاينة'; for (const [v, n] of [[.6, 'سريعة'], [.85, 'متوازنة'], [1, 'عالية']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; qs.append(o); } qs.value = String(GW.mapPreviewQ || 1); qs.onchange = () => { GW.mapPreviewQ = +qs.value; V.key = null; GW.invalidate(); }; st.append(qs);
    if (GW.active && GW.active.ws === 'maps') { const bk = btn(GW.ico('scissors', 14) + '<span>عودة للمونتاج</span>', 'العودة إلى مساحة التحرير', () => GW.setWorkspace('edit')); bk.className = 'btn sm ghost mcv-back'; st.append(bk); }
    b.append(st, sep());
    const ttl = document.createElement('b'); ttl.className = 'mcv-ttl'; ttl.textContent = c ? c.name : 'كاميرا الخريطة'; b.append(ttl);
    if (!c) return;
    const seg = document.createElement('div'); seg.className = 'seg mcv-mode';
    for (const [k, n] of [['globe', 'كرة'], ['flat', 'مسطحة']]) { const x = document.createElement('button'); x.textContent = n; x.classList.toggle('on', scn(c).mode === k); x.onclick = () => { scn(c).mode = k; GW.commit('نوع العرض'); GW.invalidate(); buildBar(); }; seg.append(x); }
    b.append(seg, sep());
    b.append(btn(GW.ico('keyprev', 13), 'المفتاح السابق ([)', () => M.gotoKey(c, -1)), btn(GW.ico('keydia', 14), 'مفتاح عند المؤشر (K)', () => M.addKey(c), 'k'), btn(GW.ico('keynext', 13), 'المفتاح التالي (])', () => M.gotoKey(c, 1)));
    const ps = document.createElement('select'); ps.className = 'sel'; ps.dataset.a = 'interp'; ps.title = 'استيفاء المفتاح عند المؤشر';
    for (const [v, n] of [['', '—'], ...M.PATHS]) { const o = document.createElement('option'); o.value = v; o.textContent = n; ps.append(o); }
    ps.onchange = () => { if (ps.value) M.setInterp(c, null, ps.value); }; b.append(ps, sep());
    b.append(btn('<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l4 8h-8z" fill="currentColor"/><path d="M12 11v10"/></svg>', 'الشمال للأعلى', () => M.setCam(c, { heading: 0 })),
      btn('<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18h16M7 14h10M10 10h4"/></svg>', 'بدون إمالة ولا دوران', () => M.setCam(c, { tilt: 0, roll: 0 })));
    const q = document.createElement('input'); q.className = 'inp mcv-q'; q.placeholder = 'ملاءمة دولة…'; q.dir = 'rtl'; q.value = M.focusQ || ''; q.oninput = () => { M.focusQ = q.value; };
    q.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && q.value.trim()) M.focusCountry(c, q.value.trim(), M.focusPad || .6); };
    b.append(sep(), q);
    const tg = (label, k, title) => { const x = document.createElement('button'); x.className = 'btn sm ghost mcv-tg' + (V[k] ? ' on' : ''); x.textContent = label; x.title = title; x.onclick = () => { V[k] = !V[k]; x.classList.toggle('on', V[k]); V.ovDirty = true; }; return x; };
    b.append(sep(), tg('المسار', 'path', 'إظهار مسار حركة الكاميرا'), tg('الإطار الآمن', 'safe', 'إظهار حدود الإطار الآمن'));
    refreshBar();
  }

  /* ---------------- styles ---------------- */
  const css = document.createElement('style'); css.textContent = `
.mcv-root{display:flex;flex-direction:column;min-height:0;height:100%}
.mcv{display:flex;flex-direction:column;flex:1;min-height:0;background:#0b0d10}
.mcv-bar{display:flex;align-items:center;gap:4px;padding:4px 6px;border-bottom:1px solid var(--line,#262626);flex-wrap:wrap;min-height:32px}
.mcv-bar .mcv-ttl{font-size:12px;color:var(--text,#ddd);margin-inline-end:6px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mcv-bar .seg button{height:22px;font-size:11px;padding:0 8px}.mcv-bar .sel{height:24px;font-size:11px;max-width:120px}
.mcv-bar .btn.on{color:var(--accent)}.mcv-sep{width:1px;height:16px;background:var(--line,#333);margin:0 3px}
.mcv-q{height:24px;width:130px;font-size:11.5px}.mcv-tg{height:22px;font-size:11px;padding:0 7px}.mcv-tg.on{color:var(--accent);border-color:var(--accent)}
.mcv-stage{position:relative;flex:1;min-height:0;overflow:hidden}
.mcv-stage canvas{position:absolute;inset:0;width:100%;height:100%}
.mcv-stage canvas[data-a=ov]{outline:none;touch-action:none}
.mcv-empty{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:var(--mute,#888);font-size:12.5px;line-height:1.8;pointer-events:none}
.mcv-studio{display:flex;align-items:center;gap:3px}.mcv-add{gap:4px}.mcv-back{gap:5px}.mcv-studio .sel{width:86px}
.mcv-emptyc{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:440px}.mcv-emptyc b{color:#fff;font-size:15px}.mcv-erow{display:flex;gap:8px;margin-top:6px;pointer-events:auto}
.mcv-strip{height:30px;border-top:1px solid var(--line,#262626);position:relative;cursor:pointer}
.mcv-strip canvas{position:absolute;inset:0;width:100%;height:100%}
.fx-h.camsec.rec .fxn::after{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#d42a3a;margin-inline-start:7px;vertical-align:1px}
.prow.camrow.dim .pn,.prow.camrow.dim .pv{opacity:.45}
.prow.camrow{grid-template-columns:18px minmax(54px,.7fr) minmax(0,1.9fr) 54px}.prow.camrow .pv>span{flex-wrap:nowrap;gap:2px!important}.prow.camrow .pv .scrub{min-width:0}
.camtools{gap:6px;padding:5px 8px}
.mp-camkeys{display:flex;flex-direction:column;gap:6px}.mp-chk{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--mute)}
.mp-kg{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
  document.head.append(css);
})();
