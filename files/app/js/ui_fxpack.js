'use strict';
/* Maps panel section for the documentary FX pack (atlas/fxpack.js): quick add, looks, border styles, GPX import
   and the property editors of the FX layer types. Called from ui_map.js renderPanel. */
(function () {
  const A = GW.Atlas; const FX = A && A.FX; if (!FX) return; const S = A.Scene, Cm = A.Cam;
  const FU = GW.FXUI = {};
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const row = (label, ...ctl) => { const r = h('div', 'frow'); const l = h('label'); l.textContent = label; const c = h('div', 'ctl'); c.append(...ctl); r.append(l, c); return r; };
  const num = (v, step, on) => { const i = h('input', 'inp num'); i.type = 'number'; i.step = step; i.value = v; i.onkeydown = e => e.stopPropagation(); i.onchange = () => on(+i.value); return i; };
  const txt = (v, on, ph) => { const i = h('input', 'inp'); i.value = v || ''; if (ph) i.placeholder = ph; i.onkeydown = e => e.stopPropagation(); i.oninput = () => on(i.value); return i; };
  const area = (v, on, rows) => { const i = h('textarea', 'inp'); i.rows = rows || 4; i.value = v || ''; i.onkeydown = e => e.stopPropagation(); i.oninput = () => on(i.value); return i; };
  const sel = (opts, v, on) => { const s = h('select', 'sel'); for (const [k, n] of opts) { const o = h('option'); o.value = k; o.textContent = n; s.append(o); } s.value = v == null ? '' : v; s.onchange = () => on(s.value); return s; };
  const chk = (v, on) => { const i = h('input'); i.type = 'checkbox'; i.checked = !!v; i.onchange = () => on(i.checked ? 1 : 0); return i; };
  const col = (v, on) => { const i = h('input'); i.type = 'color'; i.value = v || '#ffffff'; i.oninput = () => on(i.value); i.onchange = () => GW.commit('لون'); return i; };
  const rng = (v, min, max, step, on) => { const w = h('span', 'rngw'); const i = h('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = v; const o = h('span', 'val'); o.textContent = +(+v).toFixed(2); i.oninput = () => { o.textContent = +(+i.value).toFixed(2); on(+i.value); }; i.onchange = () => GW.commit('تعديل'); w.append(i, o); return w; };
  const btn = (label, on, cls) => { const b = h('button', 'btn sm' + (cls ? ' ' + cls : '')); b.innerHTML = label; b.onclick = on; return b; };
  const sec = (title, open, id) => { const M = GW.MapUI; const d = h('details', 'mp-sec'); d.open = !!open; const s = h('summary'); s.textContent = title; d.append(s); if (id) { d.dataset.id = id; const st = M.secOpen && M.secOpen[id]; if (st != null) d.open = st; d.ontoggle = () => { (M.secOpen = M.secOpen || {})[id] = d.open; }; } const b = h('div', 'mp-body'); d.append(b); d.body = b; return d; };
  const changed = (label, soon) => { GW.invalidate(); if (label) (soon ? GW.commitSoon : GW.commit)(label); };
  const ent = (o) => Object.entries(o);

  function add(c, type, o, mode) { const M = GW.MapUI; const v = Cm.at(c.map.scene.cam, Math.max(0, GW.seq().t - c.start) + (c.in || 0), c.map.scene.mode); const extra = Object.assign({}, o || {}); if (type === 'callout' && extra.lon == null) { extra.lon = +v.lon.toFixed(4); extra.lat = +v.lat.toFixed(4); } if (type === 'clouds' && extra.lat0 == null) extra.lat0 = Math.round(v.lat); const L = M.addLayer(c, type, extra); if (mode) { M.mode = mode; M.render(); GW.invalidate(); } return L; }
  FU.add = add;
  // «مهمة سرية» / «ورق وقص» one-click looks
  FU.look = (c, kind) => {
    const scn = c.map.scene;
    if (kind === 'mission') { scn.style = 'mission'; Object.assign(scn.look, { hud: null, cities: 0, countryLabels: 1, grain: .05, labelSize: 1 }); for (const L of scn.layers) { if (L.type === 'move' || L.type === 'arrow' || L.type === 'route') L.color = '#ff3b30'; if (L.type === 'callout') { L.style = 'mission'; L.dot = 'target'; } } }
    else if (kind === 'papercut') { scn.style = 'papercut'; Object.assign(scn.look, { cities: 0, grain: .07, vig: null, labelSize: 1.05 }); for (const L of scn.layers) if (L.type === 'country') { L.cut = 1; L.fill = Math.min(L.fill == null ? .1 : L.fill, .12); L.outline = 'none'; } if (!Cm.animated(scn.cam) && !scn.cam.drift) scn.cam.drift = .035; }
    changed(kind === 'mission' ? 'مظهر مهمة سرية' : 'مظهر ورق وقص'); GW.MapUI.render();
  };
  // GPX / GeoJSON / KML route import (native dialog in the app, file input in the browser)
  FU.importTrack = async (c) => {
    const go = (text, name) => { let tr; try { tr = FX.parseTrack(text, name); } catch (e) { GW.toast(e.message, 'err'); return null; } const M = GW.MapUI; const L = FX.routeLayer(tr, { inDur: 8 }); L.start = Math.max(0, +(GW.seq().t - c.start).toFixed(2)); c.map.scene.layers.push(L); M.layerId = L.id;
      if (M.fxFollow) FX.applyFollow(c, L, {}); else { const bb = d3.geoBounds({ type: 'LineString', coordinates: L.pts }); if (!Cm.animated(c.map.scene.cam) && Cm.fit) { const f = Cm.fit(bb, 0, 0, .7); Object.assign(c.map.scene.cam, { lon: f.lon, lat: f.lat, zoom: f.zoom }); } }
      changed('استيراد مسار'); M.render(); GW.toast(`تم استيراد ${L.pts.length} نقطة · ${tr.km.toFixed(1)} كم` + (tr.eles ? ' · مع الارتفاعات' : '')); return L; };
    if (window.gws && gws.open && gws.readText && !gws.test) { const f = await gws.open({ filter: 'track', title: 'استيراد مسار (GPX / GeoJSON / KML)' }); if (!f || !f.length) return null; return go(await gws.readText(f[0].path), f[0].name.replace(/\.[^.]+$/, '')); }
    if (window.gws && gws.test && window.__openResult) { const f = window.__openResult; return go(await gws.readText(f[0].path), f[0].name.replace(/\.[^.]+$/, '')); }
    return new Promise(res => { const i = h('input'); i.type = 'file'; i.accept = '.gpx,.geojson,.json,.kml'; i.onchange = () => { const f = i.files[0]; if (!f) return res(null); const rd = new FileReader(); rd.onload = () => res(go(rd.result, f.name.replace(/\.[^.]+$/, ''))); rd.readAsText(f); }; i.click(); });
  };

  FU.section = (c) => {
    const M = GW.MapUI; const scn = c.map.scene; const s0 = sec('مؤثرات الخرائط الوثائقية', true, 'fxpack');
    const grid = h('div', 'mp-add');
    const qb = (ico, label, fn) => { const b = h('button', 'mp-addb'); b.innerHTML = GW.ico(ico, 14) + `<span>${label}</span>`; b.onclick = fn; grid.append(b); };
    qb('cloud', 'غيوم من الأعلى', () => add(c, 'clouds'));
    qb('path', 'سهم متحرك', () => add(c, 'move', {}, 'draw'));
    qb('swords', 'حركة جيش', () => add(c, 'move', { preset: 'army', name: 'حركة جيش' }, 'draw'));
    qb('map', 'مسار برمز متحرك', () => add(c, 'move', { preset: 'route', name: 'مسار متحرك' }, 'draw'));
    qb('text', 'تعليق بخط إشارة', () => add(c, 'callout', {}, 'place'));
    qb('layers', 'مناطق إدارية مرفوعة', () => add(c, 'district', { country: 'السعودية' }));
    qb('import', 'استيراد مسار GPX', () => FU.importTrack(c));
    s0.body.append(grid);
    s0.body.append(row('اتباع الكاميرا للمسار المستورد', chk(M.fxFollow, v => { M.fxFollow = v; })));
    const looks = h('div', 'mp-row'); looks.append(btn(GW.ico('eye', 13) + ' مظهر «مهمة سرية»', () => FU.look(c, 'mission'), scn.style === 'mission' ? 'pri' : ''), btn(GW.ico('scissors', 13) + ' مظهر «ورق وقص»', () => FU.look(c, 'papercut'), scn.style === 'papercut' ? 'pri' : ''));
    s0.body.append(h('div', 'mp-sub', 'مظاهر جاهزة'), looks);
    s0.body.append(row('واجهة HUD', sel([['', 'حسب النمط'], ['1', 'إظهار'], ['0', 'إخفاء']], scn.look.hud == null ? '' : String(scn.look.hud), v => { scn.look.hud = v === '' ? null : +v; changed('واجهة HUD'); })));
    s0.body.append(row('نمط حدود الدول', sel([['', 'افتراضي'], ['glow', 'متوهج'], ['dashed', 'متقطع'], ...ent(FX.BSTYLES)], scn.look.borderStyle || '', v => { scn.look.borderStyle = v || null; changed('نمط الحدود'); })));
    if (FX.BSTYLES[scn.look.borderStyle]) s0.body.append(row('لون الحدود المنمّقة', col(scn.look.borderC || FX.BCOL[scn.look.borderStyle], v => { scn.look.borderC = v; GW.invalidate(); }), btn('افتراضي', () => { delete scn.look.borderC; changed('لون الحدود'); M.render(); })));
    const L = scn.layers.find(l => l.id === M.layerId); if (L) s0.body.append(props(c, L));
    return s0;
  };

  function props(c, L) {
    const M = GW.MapUI; const box = h('div', 'mp-props'); const set = (k, now) => (v) => { L[k] = v; changed('خصائص ' + L.name, !now); }; const re = () => M.render();
    const drawBtns = () => { const r = h('div', 'mp-row'); r.append(btn(M.mode === 'draw' ? 'وضع الرسم فعّال' : 'رسم المسار في الشاشة', () => { M.mode = 'draw'; re(); }), btn('حذف آخر نقطة', () => { (L.pts || []).pop(); changed('حذف نقطة'); re(); }), btn('مسح النقاط', () => { L.pts = []; L.eles = null; changed('مسح'); re(); })); return r; };
    switch (L.type) {
      case 'country':
        box.append(h('div', 'mp-sub', 'حدود منمّقة وقص ورقي'), row('نمط الإطار', sel([['solid', 'متصل'], ['dashed', 'متقطع'], ['none', 'بدون'], ...ent(FX.BSTYLES)], L.outline || 'solid', v => { L.outline = v; changed('نمط الإطار'); re(); })));
        if (FX.BSTYLES[L.outline]) box.append(row('لون الحدود', col(L.bcol || FX.BCOL[L.outline], set('bcol'))));
        box.append(row('قص ورقي مرفوع', chk(L.cut, v => { L.cut = v; changed('قص ورقي'); })), row('ارتفاع القص', rng(L.liftK == null ? 1 : L.liftK, .2, 2.5, .05, set('liftK'))));
        break;
      case 'arrow': case 'route':
        box.append(h('div', 'mp-note', 'حوّل هذه الطبقة إلى «حركة متقدمة» للحصول على أنماط الخطوط ورؤوس الأسهم والرموز المتحركة والقوس ثلاثي الأبعاد.'), btn(GW.ico('wand', 13) + ' تحويل إلى حركة متقدمة', () => { const o = { pts: L.pts, color: L.color, width: L.width, curve: L.curve || 0, start: L.start, dur: L.dur, inDur: L.inDur }; if (L.type === 'route') Object.assign(o, { preset: 'route', sym: L.icon || 'plane' }); const N = S.newLayer('move', o); N.id = L.id; N.name = L.name; const a = c.map.scene.layers; a[a.indexOf(L)] = N; changed('تحويل إلى حركة متقدمة'); re(); }, 'pri'));
        break;
      case 'clouds':
        box.append(h('div', 'mp-sub', 'غيوم من الأعلى'), row('الكثافة', rng(L.cover, 0, 1, .01, set('cover'))), row('حجم الغيوم', rng(L.scale || 1, .3, 3, .05, set('scale'))), row('الشفافية', rng(L.opacity == null ? .92 : (typeof L.opacity === 'object' ? GW.pv(L.opacity, 0) : L.opacity), 0, 1, .01, set('opacity'))), row('اللون', col(L.color, set('color'))),
          row('ظل على الأرض', rng(L.shadow, 0, 1, .01, set('shadow'))), row('اتجاه الريح (°)', rng(L.wind || 0, 0, 360, 1, set('wind'))), row('سرعة الريح', rng(L.speed == null ? 1 : L.speed, 0, 10, .1, set('speed'))), row('اختراق الغيوم عند التقريب (مستوى)', rng(L.pass == null ? 9.5 : L.pass, 4, 16, .1, set('pass'))),
          row('طبقة تفاصيل ثانية', chk(L.detail, set('detail', 1))), row('فوق أسماء الخريطة', chk(L.above, set('above', 1))), row('بذرة الشكل', num(L.seed || 1, 1, v => { L.seed = Math.max(1, v | 0); changed('بذرة'); })));
        box.append(h('div', 'mp-note', 'تتحرك الغيوم مع الكاميرا بعمق (parallax) وتكبر ثم تتلاشى عند التقريب الشديد كأن الكاميرا تخترقها.'));
        break;
      case 'move':
        box.append(h('div', 'mp-sub', 'حركة متقدمة'), drawBtns(), h('div', 'mp-note', `${(L.pts || []).length} نقاط` + (L.eles ? ' · مع ارتفاعات' : '') + (L.km ? ` · ${(+L.km).toFixed(1)} كم` : '')),
          row('اللون', col(L.color, set('color'))), row('العرض', rng(L.width || 1, .2, 4, .05, set('width'))), row('نمط الخط', sel(ent(FX.DASHES), L.dash || 'solid', set('dash', 1))), row('رأس السهم', sel(ent(FX.HEADS), L.head || 'none', set('head', 1))),
          row('تدبيب الذيل', rng(L.taper || 0, 0, 1, .02, set('taper'))), row('طول الأثر (قص الذيل)', rng(L.tail || 0, 0, 1, .02, set('tail'))), row('زحف النمط', rng(L.march || 0, 0, 5, .1, set('march'))), row('انحناء', rng(L.curve || 0, -1, 1, .02, set('curve'))), row('قوس ثلاثي الأبعاد', rng(L.arc || 0, 0, 2, .02, set('arc'))),
          row('رأس مضيء (مذنّب)', chk(L.comet, set('comet', 1))), row('نبضات ضوئية', num(L.pulses || 0, 1, v => { L.pulses = Math.max(0, v | 0); changed('نبضات'); })), row('توهج', chk(L.glow, set('glow', 1))), row('حد داكن', chk(L.outline, set('outline', 1))),
          h('div', 'mp-sub', 'رموز متحركة على المسار'), row('الرمز', sel(FX.SYMS, L.sym || '', set('sym', 1))), row('عدد الرموز', num(L.symN || 1, 1, v => { L.symN = Math.max(1, Math.min(12, v | 0)); changed('عدد الرموز'); })), row('حجم الرمز', rng(L.symSize || 1, .3, 3, .05, set('symSize'))), row('لون الرمز', col(L.symColor || '#ffffff', set('symColor'))), row('تكرار الحركة بعد الرسم', chk(L.loop, set('loop', 1))),
          h('div', 'mp-sub', 'حركة جيش (أسهم متوازية)'), row('عدد الأسهم', num(L.multi || 1, 1, v => { L.multi = Math.max(1, Math.min(7, v | 0)); changed('عدد الأسهم'); })), row('المسافة بينها', rng(L.spread || 1, .3, 3, .05, set('spread'))), row('تأخير الأطراف', rng(L.stagger == null ? .25 : L.stagger, 0, 1, .02, set('stagger'))));
        if (L.eles) box.append(row('رفع المسار بالارتفاع', rng(L.eleLift || 0, 0, 5, .1, set('eleLift'))), row('مخطط الارتفاع', chk(L.profile, set('profile', 1))), btn(GW.ico('camera', 13) + ' كاميرا تتبع المسار', () => { FX.applyFollow(c, L, {}); changed('كاميرا تتبع المسار'); re(); }));
        else if ((L.pts || []).length >= 2) box.append(btn(GW.ico('camera', 13) + ' كاميرا تتبع المسار', () => { FX.applyFollow(c, L, {}); changed('كاميرا تتبع المسار'); re(); }));
        break;
      case 'callout': {
        const tl = () => Math.max(0, GW.seq().t - c.start + (c.in || 0) - (L.start || 0));
        box.append(h('div', 'mp-sub', 'تعليق بخط إشارة'), row('النص', txt(L.text, set('text'))), row('سطر فرعي', txt(L.sub, set('sub'), 'يُترك فارغاً لإحداثيات تلقائية في نمط المهمة')), row('القالب', sel(ent(FX.CSTYLES), L.style || 'boxed', set('style', 1))), row('علامة المكان', sel(ent(FX.DOTS), L.dot || 'ring', set('dot', 1))),
          row('الاتجاه', sel([['auto', 'تلقائي (تجنب التداخل)'], ['ne', 'أعلى يمين'], ['nw', 'أعلى يسار'], ['se', 'أسفل يمين'], ['sw', 'أسفل يسار'], ['e', 'يمين'], ['w', 'يسار'], ['n', 'أعلى'], ['s', 'أسفل']], L.dir || 'auto', set('dir', 1))),
          row('طول الخط', rng(L.len || 1, .3, 3, .05, set('len'))), row('الكوع الأفقي', rng(L.elbow == null ? 1 : L.elbow, 0, 3, .05, set('elbow'))), row('الحجم', rng(L.size || 1, .4, 3, .05, set('size'))), row('لون النص', col(L.color, set('color'))), row('لون مميز', col(L.accent, set('accent'))));
        const r = h('div', 'mp-row'); r.append(btn(M.mode === 'place' ? 'انقر على الخريطة للتحديد' : 'تحديد الموقع من الشاشة', () => { M.mode = 'place'; re(); }), h('span', 'kv', `${(+GW.pv(L.lon, tl())).toFixed(2)}°, ${(+GW.pv(L.lat, tl())).toFixed(2)}°`)); box.append(r);
        break; }
      case 'district':
        box.append(h('div', 'mp-sub', 'مناطق إدارية مرفوعة'), row('كل مناطق الدولة', txt(L.country, set('country'), 'مثال: السعودية، مصر')), row('مناطق محددة', txt(L.regions, set('regions'), 'مثال: منطقة الرياض، المنطقة الشرقية')),
          h('div', 'mp-note', 'أو اختر دولاً كاملة من الشاشة لرفعها:'), btn(M.mode === 'pick' ? 'وضع الاختيار فعّال' : 'اختيار دول من الشاشة', () => { M.mode = 'pick'; re(); }),
          row('الألوان', sel([['single', 'لون واحد'], ['multi', 'ألوان متعددة']], L.palette || 'single', set('palette', 1))), row('اللون', col(L.color, set('color'))), row('ارتفاع الرفع', rng(L.lift == null ? 1 : L.lift, 0, 4, .05, set('lift'))), row('الشفافية', rng(L.fill == null ? .92 : L.fill, 0, 1, .01, set('fill'))), row('تتابع الظهور (ث)', rng(L.stagger || 0, 0, 1, .01, set('stagger'))), row('أسماء المناطق', chk(L.labels, set('labels', 1))),
          h('div', 'mp-note', 'بيانات اختيارية (سطر لكل منطقة: الاسم ثم القيمة) — يصبح الارتفاع واللون حسب القيمة:'), area(L.data, v => { L.data = v; GW.invalidate(); GW.commitSoon('بيانات المناطق'); }, 4), row('لون أقل / أعلى قيمة', col(L.c0, set('c0')), col(L.c1, set('c1'))));
        if ((A.Geo.loadAdmin1)) A.Geo.loadAdmin1();
        break;
      default: return h('div');
    }
    return box;
  }
})();
