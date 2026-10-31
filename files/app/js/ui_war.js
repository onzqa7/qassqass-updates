'use strict';
/* Maps panel: war campaigns («حملة عسكرية»), combat animations and leader banners / moves (engine: atlas/war.js).
   Called from ui_map.js (renderPanel → section, welcome → welcomeSec, fillProps → props, addLayer → preAdd/modeFor, M.down → pickHook). */
(function () {
  const A = GW.Atlas; const WR = A && A.War; if (!WR) return; const S = A.Scene, G = A.Geo, Cm = A.Cam;
  const WU = GW.WarUI = {};
  const M = () => GW.MapUI;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const row = (label, ...ctl) => { const r = h('div', 'frow'); const l = h('label'); l.textContent = label; const c = h('div', 'ctl'); c.append(...ctl); r.append(l, c); return r; };
  const num = (v, step, on) => { const i = h('input', 'inp num'); i.type = 'number'; i.step = step; i.value = v; i.onkeydown = e => e.stopPropagation(); i.onchange = () => on(+i.value); return i; };
  const txt = (v, on, ph) => { const i = h('input', 'inp'); i.value = v || ''; if (ph) i.placeholder = ph; i.onkeydown = e => e.stopPropagation(); i.oninput = () => on(i.value); return i; };
  const sel = (opts, v, on) => { const s = h('select', 'sel'); for (const [k, n] of opts) { const o = h('option'); o.value = k; o.textContent = n; s.append(o); } s.value = v == null ? '' : v; s.onchange = () => on(s.value); return s; };
  const chk = (v, on) => { const i = h('input'); i.type = 'checkbox'; i.checked = !!v; i.onchange = () => on(i.checked ? 1 : 0); return i; };
  const col = (v, on) => { const i = h('input'); i.type = 'color'; i.value = v || '#ffffff'; i.oninput = () => on(i.value); i.onchange = () => GW.commit('لون'); return i; };
  const rng = (v, min, max, step, on) => { const w = h('span', 'rngw'); const i = h('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = v; const o = h('span', 'val'); o.textContent = +(+v).toFixed(2); i.oninput = () => { o.textContent = +(+i.value).toFixed(2); on(+i.value); }; i.onchange = () => GW.commit('تعديل'); w.append(i, o); return w; };
  const btn = (label, on, cls) => { const b = h('button', 'btn sm' + (cls ? ' ' + cls : '')); b.innerHTML = label; b.onclick = on; return b; };
  const sec = (title, open, id) => { const d = h('details', 'mp-sec'); d.open = !!open; const s = h('summary'); s.textContent = title; d.append(s); if (id) { d.dataset.id = id; const st = M().secOpen && M().secOpen[id]; if (st != null) d.open = st; d.ontoggle = () => { (M().secOpen = M().secOpen || {})[id] = d.open; }; } const b = h('div', 'mp-body'); d.append(b); d.body = b; return d; };
  const changed = (label, soon) => { GW.invalidate(); if (label) (soon ? GW.commitSoon : GW.commit)(label); };
  const rerender = () => { if (M().render) M().render(); };
  const lt = (c) => Math.max(0, Math.min(c.dur, GW.seq().t - c.start)) + (c.in || 0);
  const camNow = (c) => Cm.at(c.map.scene.cam, lt(c), c.map.scene.mode);
  const eraOf = (c) => G.era(GW.pv(c.map.scene.year, lt(c)), c.map.scene.eraMode);
  const byKeyOf = (c) => new Map((G.features(eraOf(c), 0) || []).map(f => [f.key, f]));
  const ST = WU.st = { q: {}, ev: null, srcCC: '', provQ: '', cityQ: '', pend: null, moveQ: '', move: { dur: 3, style: 'curve' } };

  /* ---------------- hooks used by ui_map.js ---------------- */
  WU.modeFor = (type) => ({ clash: 'place', encircle: 'place', siege: 'place', strike: 'draw', troops: 'draw', air: 'draw' })[type] || null;
  WU.preAdd = (c, type, o) => { if (WR.DEF[type] && 'lon' in WR.DEF[type] && o.lon == null) { const v = camNow(c); o = Object.assign({ lon: +v.lon.toFixed(4), lat: +v.lat.toFixed(4) }, o); } return o; };
  // clicks in the map viewer while a war pick is pending: provinces / cities for an event, or a leader destination
  WU.pickHook = (k, L, ll, X, Y) => {
    const p = ST.pend; if (!p || !ll || p.layer !== L.id) return false;
    if (p.kind === 'moveTo') { const near = nearestPlace(ll, 30); WR.addMove(L, { to: near ? [near[0], near[1]] : [+ll[0].toFixed(4), +ll[1].toFixed(4)], name: near ? (near[3] || near[2]) : '', dur: ST.move.dur, style: ST.move.style, t: ST.move.t }); ST.pend = null; M().mode = 'nav'; changed('تحرك إلى مدينة'); rerender(); return true; }
    if (p.kind === 'event') {
      const ev = (L.events || []).find(e => e.id === p.ev); if (!ev) return false;
      // a city within ~14 px of the click wins over the province under it
      let best = null, bd = 14; for (const pl of G.places || []) { if (Math.abs(pl[0] - ll[0]) > 3 || Math.abs(pl[1] - ll[1]) > 3) continue; const sp = k.vw.project(pl[0], pl[1]); if (!sp) continue; const q = k.toScreen(sp[0], sp[1]); const d = Math.hypot(q[0] - X, q[1] - Y); if (d < bd) { bd = d; best = pl; } }
      if (best) toggleCity(ev, WR.cityRec(best));
      else { G.loadAdmin1(); const f = G.admin1 && G.hit(G.admin1, ll); if (f) toggleUnit(ev, f.key); else { const cu = (L.units || []).find(u => u.pts && u.pts.length >= 3 && d3.geoContains(A.Vec.ringGeo(u.pts), ll)); if (cu) toggleUnit(ev, 'U:' + cu.id); else { const cf = G.hit(G.features(k.era, 0), ll); if (cf) toggleUnit(ev, cf.key); } } }
      changed('اختيار هدف الحدث'); rerender(); return true;
    }
    return false;
  };
  const toggleUnit = (ev, key) => { ev.units = ev.units || []; const i = ev.units.indexOf(key); i >= 0 ? ev.units.splice(i, 1) : ev.units.push(key); };
  const toggleCity = (ev, c) => { ev.cities = ev.cities || []; const i = ev.cities.findIndex(x => x.key === c.key); i >= 0 ? ev.cities.splice(i, 1) : ev.cities.push(c); };
  function nearestPlace(ll, km) { let best = null, bd = km / 6371; for (const p of G.places || []) { if (Math.abs(p[1] - ll[1]) > 2) continue; const d = d3.geoDistance([p[0], p[1]], ll); if (d < bd) { bd = d; best = p; } } return best; }
  function placeSearch(q, limit = 8) { const n = G.norm(q); if (!n) return []; const out = []; for (const p of G.places || []) { const a = G.norm(p[3]), e = G.norm(p[2]); const s = a === n || e === n ? 100 : a.startsWith(n) || e.startsWith(n) ? 70 : a.includes(n) || e.includes(n) ? 40 : 0; if (s) out.push([s - p[4] * 2 + (p[6] & 1 ? 8 : 0), p]); } return out.sort((x, y) => y[0] - x[0]).slice(0, limit).map(x => x[1]); }
  WU.placeSearch = placeSearch;

  /* ---------------- quick builder «حرب بين دولتين» ---------------- */
  // into = an existing map clip (adds the campaign there) or null (new clip)
  WU.quickWar = async (o, into) => {
    let r; try { r = await WR.buildWar(o); } catch (e) { GW.toast(e.message, 'err'); return null; }
    if (into) {
      const scn = into.map.scene; r.layer.start = Math.max(0, lt(into) - (into.in || 0)); r.layer.events.forEach(e => { e.t = +(e.t).toFixed(2); });
      scn.layers.push(r.layer); if (o.camera !== 0) { const keys = WR.cameraKeys(r.layer, scn, { frac: .4, zMax: r.wide.zoom + 1.1, tilt: 18 }); WR.applyCameraKeys(scn, keys); }
      if (into.dur < r.layer.start + r.dur) into.dur = Math.ceil(r.layer.start + r.dur);
      M().layerId = r.layer.id; changed('حرب بين دولتين'); rerender(); GW.bus.emit('camkeys'); return r.layer;
    }
    const scn = A.newScene({ style: o.style || 'doc_dark', mode: o.mode || 'globe', year: GW.P(r.year) }); if ((o.style || 'doc_dark').startsWith('doc')) S.applyDocLook(scn, o.style || 'doc_dark');
    scn.layers.push(r.layer); if (o.camera !== 0) WR.cameraForWar(scn, r.layer, r.wide, r.dur, { focus: r.focus });
    if (o.date) scn.layers.push(S.newLayer('date', { start: .3 }));
    if (o.title) scn.layers.push(S.newLayer('title', { text: o.title, sub: '', template: 'lower', color: r.layer.sides[0].color, start: .6, dur: 3.2, out: 'fade' }));
    GW.UI.addMapClip(scn, { dur: Math.ceil(r.dur), name: 'حرب: ' + r.nA + ' – ' + r.nB, open: o.open });
    M().layerId = r.layer.id; rerender(); return r.layer;
  };
  function warForm(into) {
    const q = ST.q; Object.assign(q, Object.assign({ a: 'تركيا', b: 'سوريا', year: 2024, n: 5, fx: 'mix', camera: 1, style: 'doc_dark', date: 1, title: '' }, q));
    const w = h('div');
    w.append(row('الدولة أ (المهاجم)', txt(q.a, v => q.a = v, 'ابحث عن دولة')), row('الدولة ب', txt(q.b, v => q.b = v, 'ابحث عن دولة')), row('السنة', num(q.year, 1, v => q.year = v)), row('عدد الأحداث', num(q.n, 1, v => q.n = Math.max(1, Math.min(24, v)))),
      row('مؤثرات المعارك', sel([['mix', 'اشتباك وقصف بالتناوب'], ['clash', 'اشتباكات'], ['strike', 'قصف'], ['none', 'بدون']], q.fx, v => q.fx = v)), row('حركات كاميرا تتبع الأحداث', chk(q.camera, v => q.camera = v)));
    if (!into) w.append(row('النمط', sel(S.STYLE_ORDER.map(k => [k, S.STYLES[k].ar]), q.style, v => q.style = v)), row('العنوان', txt(q.title, v => q.title = v, 'اختياري')), row('عداد التاريخ', chk(q.date, v => q.date = v)));
    w.append(h('div', 'mp-note', 'تُختار محافظات الدولة ب الأقرب إلى حدود الدولة أ وتُوزع أحداث السيطرة على مدة المقطع، مع مؤثرات معارك عند كل مدينة. عدّل الأحداث بعد الإنشاء.'),
      btn(GW.ico('swords', 13) + ' إنشاء الحرب', () => WU.quickWar({ a: q.a, b: q.b, year: q.year, events: q.n, fx: q.fx, camera: q.camera, style: q.style, date: q.date, title: q.title }, into), 'pri'));
    return w;
  }
  WU.welcomeSec = () => { const s = sec('حرب بين دولتين (حملة كاملة تلقائية)', false, 'qwar'); s.body.append(warForm(null)); return s; };
  WU.section = (c) => {
    const s = sec('حرب وحملات عسكرية', false, 'war');
    const add = h('div', 'mp-add');
    for (const [type, label, o] of [['campaign', 'حملة عسكرية فارغة', {}], ['clash', 'اشتباك'], ['strike', 'قصف مدفعي / صاروخي'], ['troops', 'تحرك قوات'], ['air', 'غارة جوية'], ['encircle', 'تطويق مدينة'], ['siege', 'حصار'], ['front', 'جبهة هجوم', { mode: 'attack', pts: [], dir: 90, km: 120, fill: .35 }]]) {
      const b = h('button', 'mp-addb'); b.innerHTML = `<span>${esc(label)}</span>`; b.onclick = () => { const L = M().addLayer(c, type, Object.assign(type === 'campaign' ? defaultSides(c) : {}, o || {})); if (type === 'front') { M().mode = 'draw'; } rerender(); void L; }; add.append(b);
    }
    s.body.append(h('div', 'mp-sub', 'إضافة مؤثر قتالي أو حملة'), add, h('div', 'mp-sub', 'حرب بين دولتين في هذا المقطع'), warForm(c));
    return s;
  };
  function defaultSides(c) { return { sides: [{ id: 'a', name: 'الطرف الأول', color: '#a8322a', countries: [], fill: .5, border: 'solid' }, { id: 'b', name: 'الطرف الثاني', color: '#3c6e8f', countries: [], fill: .45, border: 'solid' }], events: [] }; }

  /* ---------------- layer properties ---------------- */
  WU.props = (c, L, box) => {
    const set = (k, now) => (v) => { L[k] = v; changed('خصائص ' + L.name, !now); };
    const place = () => { const w = h('div', 'mp-row'); w.append(btn(M().mode === 'place' ? 'انقر على الخريطة للتحديد' : 'تحديد الموقع من الشاشة', () => { M().mode = 'place'; rerender(); }), h('span', 'kv', `${(+GW.pv(L.lon, 0)).toFixed(2)}°, ${(+GW.pv(L.lat, 0)).toFixed(2)}°`)); return w; };
    const draw = (label) => { const w = h('div', 'mp-row'); w.append(btn(M().mode === 'draw' ? 'وضع الرسم فعّال' : label, () => { M().mode = 'draw'; rerender(); }), btn('مسح النقاط', () => { L.pts = []; changed('مسح'); rerender(); }), h('span', 'kv', (L.pts || []).length + ' نقاط')); return w; };
    const cityPick = (on) => { const w = h('div'); const i = txt('', () => go(), 'ابحث عن مدينة…'); const res = h('div', 'mp-results'); const go = () => { res.innerHTML = ''; for (const p of placeSearch(i.value, 6)) { const it = h('div', 'mp-res', `<b>${esc(p[3] || p[2])}</b><span>${esc(p[2])} · ${esc(p[7])}</span>`); it.onclick = () => on(p); res.append(it); } }; w.append(i, res); return w; };
    switch (L.type) {
      case 'campaign': return campaignProps(c, L, box, set);
      case 'clash':
        box.append(place(), cityPick(p => { L.lon = p[0]; L.lat = p[1]; if (!L.text) L.text = 'معركة ' + (p[3] || p[2]); changed('موقع الاشتباك'); rerender(); }), row('النص', txt(L.text, set('text'))), row('اللون', col(L.color, set('color'))), row('الحجم', rng(L.size, .3, 3, .05, set('size'))), row('الشدة', rng(L.intensity, .2, 3, .05, set('intensity'))),
          row('سيفان', chk(L.swords, set('swords', 1))), row('دخان', chk(L.smoke, set('smoke', 1))), row('شرر', chk(L.sparks, set('sparks', 1))), row('موجات صدمية', chk(L.rings, set('rings', 1))));
        break;
      case 'strike':
        box.append(h('div', 'mp-note', 'النقطة الأولى = موقع الإطلاق، وبقية النقاط = الأهداف.'), draw('رسم الإطلاق والأهداف'), row('النوع', sel([['missile', 'صواريخ'], ['artillery', 'مدفعية']], L.kind, set('kind', 1))), row('عدد المقذوفات', num(L.count, 1, set('count', 1))), row('الفاصل (ث)', num(L.interval, .05, set('interval', 1))), row('زمن الطيران (ث)', num(L.flight, .1, set('flight', 1))),
          row('ارتفاع القوس', rng(L.arc, 0, 1, .02, set('arc'))), row('تشتت الإصابات (px)', num(L.spread, 1, set('spread', 1))), row('ذيل', chk(L.trail, set('trail', 1))), row('حفرة', chk(L.crater, set('crater', 1))), row('اهتزاز الشاشة', rng(L.shake || 0, 0, 2, .05, set('shake'))));
        break;
      case 'troops': {
        const icons = [['armor', 'مدرعات (ناتو)'], ['inf', 'مشاة (ناتو)'], ['art', 'مدفعية (ناتو)'], ['hq', 'قيادة (ناتو)'], ['tank', 'دبابة'], ['soldier', 'جندي'], ...(GW.ShapeLib && GW.ShapeLib.mapIcons ? GW.ShapeLib.mapIcons() : [])];
        box.append(draw('رسم مسار القوات'), row('الرمز', sel(icons, L.icon, set('icon', 1))), row('اللون', col(L.color, set('color'))), row('عدد الوحدات', num(L.count, 1, set('count', 1))), row('الفاصل بين الوحدات (ث)', num(L.spacing, .05, set('spacing', 1))), row('مدة المسير (ث)', num(L.travel, .1, set('travel', 1))), row('الحجم', rng(L.size, .4, 3, .05, set('size'))), row('غبار', chk(L.dust, set('dust', 1))), row('إظهار المسار', chk(L.route, set('route', 1))));
        break; }
      case 'air':
        box.append(draw('رسم مسار الطائرات'), row('الطائرة', sel([['jet', 'مقاتلة'], ['plane', 'طائرة'], ['heli', 'مروحية']], L.icon, set('icon', 1))), row('عدد الطائرات', num(L.count, 1, set('count', 1))), row('الفاصل (ث)', num(L.spacing, .05, set('spacing', 1))), row('مدة العبور (ث)', num(L.travel, .1, set('travel', 1))), row('عدد القنابل', num(L.bombs, 1, set('bombs', 1))), row('الحجم', rng(L.size, .4, 3, .05, set('size'))), row('اللون', col(L.color, set('color'))));
        break;
      case 'encircle':
        box.append(place(), cityPick(p => { L.lon = p[0]; L.lat = p[1]; if (!L.text) L.text = p[3] || p[2]; changed('المدينة المطوقة'); rerender(); }), row('النص', txt(L.text, set('text'))), row('نصف القطر (كم)', num(L.km, 5, set('km', 1))), row('اتجاه الهجوم (درجة)', num(L.dir, 5, set('dir', 1))), row('زمن الإغلاق (ث)', num(L.close, .1, set('close', 1))), row('اللون', col(L.color, set('color'))));
        break;
      case 'siege':
        box.append(place(), cityPick(p => { L.lon = p[0]; L.lat = p[1]; if (!L.text) L.text = p[3] || p[2]; changed('المدينة المحاصرة'); rerender(); }), row('النص', txt(L.text, set('text'))), row('نصف القطر (كم)', num(L.km, 5, set('km', 1))), row('من اليوم', num(L.d0, 1, set('d0', 1))), row('إلى اليوم', num(L.days, 1, set('days', 1))), row('عد تنازلي', chk(L.countdown, set('countdown', 1))), row('صيغة العداد', txt(L.label, set('label'), 'اليوم {n} من الحصار')), row('اللون', col(L.color, set('color'))));
        break;
      case 'front':
        box.append(h('div', 'mp-sub', 'نمط الجبهة'), row('النمط', sel([['', 'منطقة / خط ثابت'], ['attack', 'هجوم (تتقدم الجبهة)']], L.mode || '', v => { L.mode = v || undefined; changed('نمط الجبهة'); rerender(); })));
        if (L.mode === 'attack') box.append(h('div', 'mp-note', 'ارسم خط الجبهة (نقطتان أو أكثر)، ثم حدد اتجاه التقدم ومسافته. تظهر أسهم تخترق الخط أثناء التقدم.'), row('اتجاه التقدم (درجة)', num(L.dir == null ? 90 : L.dir, 5, set('dir', 1))), row('مسافة التقدم (كم)', num(L.km == null ? 120 : L.km, 10, set('km', 1))), row('مدة التقدم (ث)', num(L.advDur || '', .1, v => { L.advDur = v > 0 ? v : undefined; changed('مدة التقدم'); })));
        break;
      case 'image': return imageProps(c, L, box, set);
    }
  };

  /* ---------- leader: display style + moves ---------- */
  function imageProps(c, L, box, set) {
    const disp = L.disp === 'banner' ? 'banner' : (L.shape === 'circle' || !L.shape) ? 'circle' : 'frame';
    box.append(h('div', 'mp-sub', 'نمط العرض'), row('نمط العرض', sel([['circle', 'دائرة'], ['frame', 'إطار'], ['banner', 'راية']], disp, v => { if (v === 'banner') L.disp = 'banner'; else { delete L.disp; L.shape = v === 'circle' ? 'circle' : 'rounded'; } changed('نمط عرض القائد'); rerender(); })));
    if (L.disp === 'banner') {
      const camps = c.map.scene.layers.filter(x => x.type === 'campaign'); const opts = [['', 'لون مخصص']]; for (const cp of camps) for (const sd of cp.sides || []) opts.push([cp.id + ':' + sd.id, 'لون ' + sd.name]);
      box.append(row('لون الطرف', sel(opts, L.faction || '', v => { L.faction = v || undefined; changed('لون الراية'); rerender(); })));
      if (!L.faction) box.append(row('لون الراية', col(L.bannerC || '#5b6b3a', set('bannerC'))));
    }
    // «تحرك إلى مدينة»: chained segments
    box.append(h('div', 'mp-sub', 'تحرك إلى مدينة'));
    const mv = ST.move; const list = h('div', 'mp-chips');
    (L.moves || []).forEach((m, i) => { const b = h('button', 'chip on'); b.innerHTML = esc(`${i + 1}. ${m.name || 'نقطة'} · ${(+m.t).toFixed(1)}ث → ${(+m.t + m.dur).toFixed(1)}ث`) + ' ' + GW.ico('close', 11); b.onclick = () => { L.moves.splice(i, 1); changed('حذف حركة'); rerender(); }; list.append(b); });
    if (!(L.moves || []).length) list.append(h('span', 'mp-note', 'لا توجد حركات بعد'));
    const last = (L.moves || [])[L.moves ? L.moves.length - 1 : 0]; const tDef = last ? +(last.t + last.dur + .5).toFixed(2) : +Math.max(.8, lt(c) - (c.in || 0) - (L.start || 0)).toFixed(2); if (mv.t == null || mv.layer !== L.id) { mv.t = tDef; mv.layer = L.id; }
    const q = txt(ST.moveQ, v => { ST.moveQ = v; go(); }, 'ابحث عن المدينة الهدف…'); q.dataset.k = 'wmoveq'; const res = h('div', 'mp-results');
    const go = () => { res.innerHTML = ''; for (const p of placeSearch(ST.moveQ, 6)) { const it = h('div', 'mp-res', `<b>${esc(p[3] || p[2])}</b><span>${esc(p[2])} · ${esc(p[7])}</span>`); it.onclick = () => { WR.addMove(L, { to: [p[0], p[1]], name: p[3] || p[2], t: mv.t, dur: mv.dur, style: mv.style }); mv.t = null; ST.moveQ = ''; changed('تحرك إلى ' + (p[3] || p[2])); rerender(); }; res.append(it); } };
    box.append(list, row('يبدأ عند (ث)', num(mv.t, .1, v => mv.t = v)), row('المدة (ث)', num(mv.dur, .1, v => mv.dur = Math.max(.2, v))), row('شكل المسار', sel([['direct', 'مباشر'], ['curve', 'منحنٍ'], ['route', 'عبر المسار المرسوم'], ['via', 'عبر نقاط وسيطة']], mv.style, v => mv.style = v)), q, res);
    box.append(h('div', 'mp-row')); box.lastChild.append(btn(ST.pend && ST.pend.kind === 'moveTo' ? 'انقر الهدف في الخريطة…' : 'من الخريطة', () => { ST.pend = { kind: 'moveTo', layer: L.id }; M().mode = 'pick'; rerender(); }));
    box.append(row('أثر', chk(L.trail == null ? 1 : L.trail, set('trail', 1))), row('غبار', chk(L.dust == null ? 1 : L.dust, set('dust', 1))), row('نبضة الوصول', chk(L.pulse == null ? 1 : L.pulse, set('pulse', 1))), row('«يتجه إلى …»', chk(L.heading == null ? 1 : L.heading, set('heading', 1))));
    if (mv.style === 'via') box.append(h('div', 'mp-note', 'النقاط الوسيطة = نقاط المسار المرسومة لهذا القائد (رسم المسار في الشاشة).'));
  }

  /* ---------- campaign editor ---------- */
  function campaignProps(c, L, box, set) {
    const scn = c.map.scene; const era = eraOf(c); const byKey = byKeyOf(c); if (era.src !== 'hist') WR.loadA1().then(() => { if (!WU._a1r) { WU._a1r = 1; rerender(); } });
    // sides
    box.append(h('div', 'mp-sub', 'الأطراف'));
    (L.sides || []).forEach((sd, i) => {
      const d = h('div', 'mp-war-side'); d.style.borderInlineStartColor = sd.color;
      d.append(row('الاسم', txt(sd.name, v => { sd.name = v; changed('اسم الطرف', 1); })), row('اللون', col(sd.color, v => { sd.color = v; GW.invalidate(); })), row('شفافية التعبئة', rng(sd.fill == null ? .5 : sd.fill, 0, 1, .02, v => { sd.fill = v; GW.invalidate(); })),
        row('نمط الحدود', sel([['solid', 'متصل'], ['dashed', 'متقطع'], ['glow', 'متوهج'], ['none', 'بدون']], sd.border || 'solid', v => { sd.border = v; changed('نمط الحدود'); })));
      const chips = h('div', 'mp-chips'); for (const k of sd.countries || []) { const f = byKey.get(k); const b = h('button', 'chip on'); b.innerHTML = esc(f ? G.name(f, 'ar', era) : k) + ' ' + GW.ico('close', 11); b.onclick = () => { sd.countries.splice(sd.countries.indexOf(k), 1); changed('إزالة دولة'); rerender(); }; chips.append(b); }
      const add = txt('', () => {}, 'أضف دولة واضغط Enter'); add.onkeydown = (e) => { e.stopPropagation(); if (e.key !== 'Enter') return; const f = WR.findCountry(add.value, era); if (!f) { GW.toast('لم أتعرف على: ' + add.value, 'err'); return; } sd.countries = sd.countries || []; if (!sd.countries.includes(f.key)) sd.countries.push(f.key); if (/^الطرف/.test(sd.name)) sd.name = G.name(f, 'ar', era); changed('إضافة دولة'); rerender(); };
      d.append(chips, add);
      const acts = h('div', 'mp-row'); acts.append(btn(GW.ico('marker', 12) + ' راية قائد', () => addBanner(c, L, sd)), btn(GW.ico('close', 12) + ' حذف الطرف', () => { L.sides.splice(i, 1); changed('حذف طرف'); rerender(); }));
      if (era.src !== 'hist') acts.append(h('label', 'mp-note', ''), (() => { const w = h('span', 'kv'); w.append(chk(sd.split !== 0, v => { sd.split = v ? undefined : 0; changed('تقسيم المحافظات'); }), document.createTextNode(' تقسيم إلى محافظات')); return w; })());
      d.append(acts); box.append(d);
    });
    box.append(btn(GW.ico('plus', 13) + ' طرف', () => { const n = (L.sides || []).length; L.sides.push({ id: 's' + GW.uid().slice(0, 4), name: 'طرف ' + (n + 1), color: WR.mix('#888888', ['#b0893a', '#4a7a3c', '#7a4a6a'][n % 3], .9), countries: [], fill: .45 }); changed('إضافة طرف'); rerender(); }));
    // events
    box.append(h('div', 'mp-sub', 'أحداث السيطرة'));
    const evs = (L.events || []).slice().sort((a, b) => a.t - b.t); const m = WR.model(L, era, byKey);
    const sideOpts = (L.sides || []).map(sd => [sd.id, sd.name]);
    for (const ev of evs) {
      const on = ST.ev === ev.id; const sd = (L.sides || []).find(x => x.id === ev.to);
      const names = [...(ev.cities || []).map(x => x.a || x.n), ...(ev.units || []).map(k => (m.units.get(k) || {}).name || k)].slice(0, 3).join('، ') || 'لم يُحدد هدف';
      const r = h('div', 'mp-layer' + (on ? ' on' : '')); r.innerHTML = `<i class="mp-war-dot" style="background:${esc(sd ? sd.color : '#888')}"></i><span class="nm">${esc(names)}</span><span class="kv">${(+ev.t).toFixed(1)}ث</span>`;
      const goB = h('button', 'ib', GW.ico('play', 13)); goB.title = 'انتقل إلى الحدث'; goB.onclick = (e) => { e.stopPropagation(); GW.seek(c.start + (L.start || 0) + ev.t - (c.in || 0) + .01); };
      const del = h('button', 'ib', GW.ico('close', 13)); del.onclick = (e) => { e.stopPropagation(); L.events.splice(L.events.indexOf(ev), 1); if (ST.ev === ev.id) ST.ev = null; changed('حذف حدث'); rerender(); };
      r.append(goB, del); r.onclick = () => { ST.ev = on ? null : ev.id; ST.srcCC = ''; rerender(); }; box.append(r);
      if (on) box.append(eventEditor(c, L, ev, m, era, byKey, sideOpts));
    }
    const ab = h('div', 'mp-row'); ab.append(btn(GW.ico('plus', 13) + ' حدث سيطرة عند المؤشر', () => { const t = +Math.max(0, lt(c) - (c.in || 0) - (L.start || 0)).toFixed(2); const sd = L.sides || []; const ev = { id: GW.uid(), t, dur: 2.5, from: sd[1] ? sd[1].id : null, to: sd[0] ? sd[0].id : null, units: [], cities: [], origin: 'border', fx: 'clash', caption: 1 }; (L.events = L.events || []).push(ev); ST.ev = ev.id; changed('حدث سيطرة'); rerender(); }, 'pri'),
      btn(GW.ico('camera', 13) + ' أضف حركة كاميرا لكل حدث', () => { const keys = WR.cameraKeys(L, scn, { frac: .42, tilt: 18 }); if (!keys.length) { GW.toast('حدد أهدافاً للأحداث أولاً'); return; } WR.applyCameraKeys(scn, keys); changed('حركات كاميرا للأحداث'); rerender(); GW.bus.emit('camkeys'); GW.toast('أضيفت ' + keys.length + ' مفاتيح كاميرا'); }));
    box.append(ab);
    // drawn regions (historical eras)
    box.append(h('div', 'mp-sub', 'مناطق مرسومة (للعصور التاريخية)'), h('div', 'mp-note', 'ارسم مضلعاً في الشاشة ثم احفظه منطقةً قابلة للسيطرة.'));
    const dr = h('div', 'mp-row'); dr.append(btn(M().mode === 'draw' ? 'وضع الرسم فعّال' : 'ارسم منطقة', () => { M().mode = 'draw'; L.pts = L.pts || []; rerender(); }), btn('حفظ المنطقة', () => { if (!L.pts || L.pts.length < 3) { GW.toast('ارسم ثلاث نقاط على الأقل'); return; } (L.units = L.units || []).push({ id: GW.uid(), name: 'منطقة ' + ((L.units || []).length + 1), pts: L.pts.slice() }); L.pts = []; M().mode = 'nav'; changed('منطقة مرسومة'); rerender(); }), h('span', 'kv', (L.pts || []).length + ' نقاط'));
    box.append(dr); const uc = h('div', 'mp-chips'); for (const u of L.units || []) { const b = h('button', 'chip on'); b.innerHTML = esc(u.name) + ' ' + GW.ico('close', 11); b.onclick = () => { L.units.splice(L.units.indexOf(u), 1); changed('حذف منطقة'); rerender(); }; uc.append(b); } box.append(uc);
    // display options
    box.append(h('div', 'mp-sub', 'العرض'), row('لوحة السيطرة', chk(L.legend, set('legend', 1)), sel([['tl', 'أعلى يسار'], ['tr', 'أعلى يمين'], ['bl', 'أسفل يسار'], ['br', 'أسفل يمين']], L.legendPos || 'tl', set('legendPos', 1))), row('عنوان اللوحة', txt(L.legendTitle, set('legendTitle'), 'تلقائي')),
      row('عناوين «سقوط مدينة»', chk(L.captions, set('captions', 1))), row('علامات المدن', chk(L.showCities, set('showCities', 1))), row('قلب لون المدينة ورفع العلم', chk(L.flip, set('flip', 1))), row('حدود الأطراف', chk(L.borders, set('borders', 1))), row('حدود المحافظات', chk(L.provLines == null ? 1 : L.provLines, set('provLines', 1))), row('نصف قطر منطقة المدينة (كم)', num(L.cityR, 1, set('cityR', 1))), row('أسماء الدول', chk(L.labels, set('labels', 1))));
  }
  function eventEditor(c, L, ev, m, era, byKey, sideOpts) {
    const w = h('div', 'mp-props mp-war-ev'); const set = (k, now) => (v) => { ev[k] = v; changed('حدث سيطرة', !now); };
    w.append(row('الوقت (ث)', num(ev.t, .1, v => { ev.t = Math.max(0, v); changed('وقت الحدث'); rerender(); }), btn('عند المؤشر', () => { ev.t = +Math.max(0, lt(c) - (c.in || 0) - (L.start || 0)).toFixed(2); changed('وقت الحدث'); rerender(); })), row('المدة (ث)', num(ev.dur || 2.5, .1, set('dur', 1))),
      row('من', sel(sideOpts, ev.from, set('from', 1))), row('إلى', sel(sideOpts, ev.to, set('to', 1))), row('بداية الاجتياح', sel([['border', 'من أقرب حدود للمهاجم'], ['city', 'من المدينة']], ev.origin || 'border', set('origin', 1))),
      row('مؤثر المعركة', sel([['clash', 'اشتباك'], ['strike', 'قصف'], ['none', 'بدون']], ev.fx || 'none', set('fx', 1))), row('اهتزاز مع القصف', chk(ev.shake, set('shake', 1))), row('عنوان الحدث', chk(ev.caption !== 0, v => { ev.caption = v ? 1 : 0; changed('عنوان الحدث'); })), row('نص مخصص', txt(ev.text, set('text'), 'سقوط مدينة …')));
    // chosen targets
    const chips = h('div', 'mp-chips');
    for (const k of ev.units || []) { const b = h('button', 'chip on'); b.innerHTML = esc((m.units.get(k) || {}).name || k) + ' ' + GW.ico('close', 11); b.onclick = () => { toggleUnit(ev, k); changed('إزالة'); rerender(); }; chips.append(b); }
    for (const cc of ev.cities || []) { const b = h('button', 'chip on'); b.innerHTML = GW.ico('pin', 11) + ' ' + esc(cc.a || cc.n) + ' ' + GW.ico('close', 11); b.onclick = () => { toggleCity(ev, cc); changed('إزالة'); rerender(); }; chips.append(b); }
    w.append(h('div', 'mp-sub', 'ما ينتقل في هذا الحدث'), chips);
    const pickOn = ST.pend && ST.pend.kind === 'event' && ST.pend.ev === ev.id && M().mode === 'pick';
    w.append(btn(GW.ico('pen', 13) + (pickOn ? ' انقر المحافظات والمدن في الخريطة…' : ' اختر من الخريطة'), () => { ST.pend = pickOn ? null : { kind: 'event', layer: L.id, ev: ev.id }; M().mode = pickOn ? 'nav' : 'pick'; rerender(); }, pickOn ? 'pri' : ''));
    // source country → provinces and cities (searchable checklists)
    const from = (L.sides || []).find(x => x.id === ev.from); const ccs = []; for (const sd of L.sides || []) for (const k of sd.countries || []) { const f = byKey.get(k); if (f) ccs.push([WR.ccOf(f), G.name(f, 'ar', era)]); }
    if (!ST.srcCC) { const f0 = from && from.countries && byKey.get(from.countries[0]); ST.srcCC = f0 ? WR.ccOf(f0) : (ccs[0] || [''])[0]; }
    const other = txt('', () => {}, 'دولة أخرى + Enter'); other.onkeydown = (e) => { e.stopPropagation(); if (e.key !== 'Enter') return; const f = WR.findCountry(other.value, era); if (f) { ST.srcCC = WR.ccOf(f); rerender(); } };
    w.append(row('الدولة المصدر', sel(ccs.concat(ccs.some(x => x[0] === ST.srcCC) ? [] : [[ST.srcCC, ST.srcCC]]), ST.srcCC, v => { ST.srcCC = v; rerender(); }), other));
    const provs = G.admin1 ? WR.provinces(ST.srcCC) : []; const nq = G.norm(ST.provQ);
    if (era.src !== 'hist' && provs.length) {
      const pq = txt(ST.provQ, v => { ST.provQ = v; fillP(); }, 'تصفية المحافظات…'); pq.dataset.k = 'wprovq'; const pl = h('div', 'mp-war-list');
      const fillP = () => { pl.innerHTML = ''; const n = G.norm(ST.provQ); for (const f of provs.slice().sort((a, b) => (a.ar || '').localeCompare(b.ar || '', 'ar'))) { if (n && !G.norm(f.ar).includes(n) && !G.norm(f.en).includes(n)) continue; const lab = h('label', 'mp-war-item'); const cb = chk((ev.units || []).includes(f.key), () => { toggleUnit(ev, f.key); changed('محافظة'); }); lab.append(cb, document.createTextNode(' ' + (f.ar || f.en)), h('span', 'kv', esc(f.en))); pl.append(lab); } };
      fillP(); w.append(h('div', 'mp-sub', 'المحافظات (' + provs.length + ')'), pq, pl); void nq;
    } else if (era.src === 'hist') w.append(h('div', 'mp-note', 'لا توجد محافظات للعصور التاريخية: استخدم المدن أو المناطق المرسومة أو دولة كاملة (من الخريطة).'));
    const cities = WR.cities(ST.srcCC).slice(0, 400);
    if (cities.length) {
      const cq = txt(ST.cityQ, v => { ST.cityQ = v; fillC(); }, 'تصفية المدن…'); cq.dataset.k = 'wcityq'; const cl = h('div', 'mp-war-list');
      const fillC = () => { cl.innerHTML = ''; const n = G.norm(ST.cityQ); let shown = 0; for (const p of cities) { if (n && !G.norm(p[3]).includes(n) && !G.norm(p[2]).includes(n)) continue; if (++shown > 80) break; const rec = WR.cityRec(p); const lab = h('label', 'mp-war-item'); lab.append(chk((ev.cities || []).some(x => x.key === rec.key), () => { toggleCity(ev, rec); changed('مدينة'); }), document.createTextNode(' ' + rec.a + (rec.cap ? ' ★' : '')), h('span', 'kv', esc(p[2]))); cl.append(lab); } };
      fillC(); w.append(h('div', 'mp-sub', 'المدن'), cq, cl);
    }
    // units of other kinds (whole countries / drawn regions)
    const others = [...m.units.values()].filter(u => u.kind !== 'prov'); if (others.length) { const oc = h('div', 'mp-chips'); for (const u of others) { const b = h('button', 'chip' + ((ev.units || []).includes(u.key) ? ' on' : '')); b.textContent = u.name; b.onclick = () => { toggleUnit(ev, u.key); changed('منطقة'); rerender(); }; oc.append(b); } w.append(h('div', 'mp-sub', 'دول ومناطق مرسومة'), oc); }
    return w;
  }
  function addBanner(c, L, sd) {
    const era = eraOf(c); const byKey = byKeyOf(c); const f = byKey.get((sd.countries || [])[0]); const cc = f && WR.ccOf(f); const cap = cc && WR.cities(cc).find(p => p[6] & 1); const v = camNow(c);
    const lon = cap ? cap[0] : f ? f.lab[0] : v.lon, lat = cap ? cap[1] : f ? f.lab[1] : v.lat; void era;
    M().addLeader(c, { lon: +lon.toFixed(4), lat: +lat.toFixed(4), disp: 'banner', faction: L.id + ':' + sd.id, name: 'اسم القائد', sub: sd.name, in: 'pop', inDur: 1.2 });
  }
})();
