'use strict';
/* Maps panel v6 — task-oriented layout: 4 tabs (المشهد / الطبقات / الكاميرا / متقدم), layer list + visual «إضافة» gallery,
   inspector with essential fields first, contextual map-interaction banner, onboarding (empty state + quick tour) and the
   step-by-step war wizard «حرب بين دولتين» that works in every era (engine: atlas/war.js buildCampaign).
   ui_map.js renderPanel delegates here (GW.MapUX.render); section builders come from GW.MapUI.B. */
(function () {
  const A = GW.Atlas; if (!A) return; const S = A.Scene, G = A.Geo, Cm = A.Cam, WR = A.War, FX = A.FX;
  const X = GW.MapUX = {};
  const M = () => GW.MapUI; const B = () => GW.MapUI.B;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const btn = (label, on, cls) => { const b = h('button', 'btn sm' + (cls ? ' ' + cls : '')); b.innerHTML = label; b.onclick = on; return b; };
  const changed = (label, soon) => { GW.invalidate(); if (label) (soon ? GW.commitSoon : GW.commit)(label); };
  const lt = (c) => Math.max(0, Math.min(c.dur, GW.seq().t - c.start)) + (c.in || 0);
  const rerender = () => M().render();

  /* «استوديو الخرائط» page: the map viewer is the main canvas, the panel on the side, the main timeline below; unrelated editing panels hidden */
  if (GW.WS && GW.WS.maps) {
    Object.assign(GW.WS.maps, { n: 'استوديو الخرائط', tl: ['mapcam'], tr: ['program'], bl: [], br: ['timeline'], side: ['maps'], v: { '--c1': '74%', '--c4': '0%', '--r1': '78%', '--c3': '460px' } });
    try { if (localStorage.getItem('gws.mapsv6') !== '1') { localStorage.removeItem('gws.wsl.maps'); localStorage.removeItem('gws.layout.maps'); localStorage.setItem('gws.mapsv6', '1'); } } catch (e) {}
  }

  /* ---------------- tabs ---------------- */
  const TABS = [['scene', 'المشهد', 'globe', 'السنة والحدود، نمط الخريطة ومظهرها'], ['layers', 'الطبقات', 'layers', 'كل ما تضيفه فوق الخريطة: حروب، أسهم، قادة، سحب، نصوص'], ['camera', 'الكاميرا', 'camera', 'حركة الكاميرا ومفاتيحها والحركات الجاهزة'], ['adv', 'متقدم', 'settings', 'تصدير، تثبيت طبقات المونتاج على الخريطة، إعدادات افتراضية']];
  X.tabs = {};
  X.tabOf = (c) => X.tabs[c.id] || (c.map && c.map.uiTab) || 'layers';
  X.setTab = (c, t) => { X.tabs[c.id] = t; if (c.map) c.map.uiTab = t; rerender(); };

  X.render = (scroll, c) => {
    scroll.classList.add('mx'); scroll.dir = document.documentElement.lang === 'en' ? 'ltr' : 'rtl';
    if (!c) { scroll.append(welcome()); return; }
    const scn = c.map.scene; const tab = X.tabOf(c);
    const era = G.era(GW.pv(scn.year, lt(c)), scn.eraMode);
    const head = h('div', 'mx-head');
    head.innerHTML = `<div class="mx-title"><b>${esc(c.name)}</b><span>${esc(G.fmtYear(GW.pv(scn.year, lt(c))))} · ${esc(era.src === 'hist' ? 'حدود تاريخية تقريبية' : era.src === 'cs' ? 'حدود دقيقة باليوم' : 'حدود حالية')}</span></div>`;
    const hb = h('div', 'mx-hbtns'); const tb = btn(GW.ico('help', 14) + ' جولة سريعة', () => X.tour()); tb.dataset.a = 'tour'; tb.classList.add('ghost'); hb.append(tb); head.append(hb);
    scroll.append(head);
    const tabs = h('div', 'mx-tabs'); tabs.setAttribute('role', 'tablist');
    for (const [k, n, ico, tip] of TABS) { const b = h('button', tab === k ? 'on' : '', GW.ico(ico, 16) + `<span>${esc(n)}</span>`); b.title = tip; b.dataset.tab = k; b.onclick = () => X.setTab(c, k); if (k === 'layers' && scn.layers.length) b.append(h('i', 'mx-badge', String(scn.layers.length))); tabs.append(b); }
    scroll.append(tabs);
    if (M().mode && M().mode !== 'nav' && M().mode !== 'off') scroll.append(banner(c));
    const body = h('div', 'mx-body'); scroll.append(body);
    if (tab === 'scene') sceneTab(c, body); else if (tab === 'camera') cameraTab(c, body); else if (tab === 'adv') advTab(c, body); else layersTab(c, body);
  };
  function banner(c) {
    const md = M().mode; const verb = { pick: 'انقر على الخريطة', draw: 'انقر على الخريطة', place: 'انقر على الخريطة' }[md] || 'انقر على الخريطة';
    const w = h('div', 'mx-banner'); const txt = `${verb} في لوحة «كاميرا الخريطة» ${M().modeHint || { pick: 'لاختيار الدول', draw: 'لإضافة النقاط', place: 'لتحديد الموقع' }[md] || ''}`;
    w.innerHTML = `${GW.ico(md === 'draw' ? 'pen' : 'pin', 18)}<span>${esc(txt)}</span>`;
    const acts = h('div', 'mx-bacts'); const d = btn(GW.ico('check', 13) + ' تم', () => M().done(), 'pri'); d.dataset.a = 'done'; d.title = 'إنهاء التحديد والعودة لتحريك الخريطة (Esc)'; acts.append(d);
    if (md === 'draw') { const L = M().B.layer(c); if (L && L.pts && L.pts.length) acts.append(btn(GW.ico('undo', 13) + ' آخر نقطة', () => { L.pts.pop(); changed('حذف نقطة'); rerender(); })); }
    w.append(acts); return w;
  }

  /* ---------------- «المشهد» ---------------- */
  function card(title, ico, sub) { const d = h('section', 'mx-card'); const t = h('div', 'mx-ct', GW.ico(ico, 15) + `<b>${esc(title)}</b>` + (sub ? `<span>${esc(sub)}</span>` : '')); d.append(t); const b = h('div', 'mx-cb'); d.append(b); d.body = b; return d; }
  const unwrap = (sec) => { const b = sec.querySelector(':scope > .mp-body'); return b ? [...b.childNodes] : [sec]; };
  function sceneTab(c, body) {
    const b = B();
    body.append(b.searchBox(c)); if (M().picked && M().picked.key) body.append(b.pickedBox(c));
    const era = card('الزمن والحدود', 'calendar', 'اختر السنة: تتغير الحدود وأسماء الدول تلقائياً'); era.body.append(...unwrap(b.eraSec(c))); body.append(era);
    const st = card('نمط الخريطة', 'map', 'شكل الخريطة الأساسي'); st.body.append(...unwrap(b.styleSec(c))); const dq = st.body.querySelector('.mp-qa'); if (dq) dq.remove(); body.append(st);
    const lk = card('مظهر جاهز', 'wand', 'مظاهر بنقرة واحدة وأنماط الحدود'); if (GW.FXUI && GW.FXUI.sceneOpts) lk.body.append(GW.FXUI.sceneOpts(c)); body.append(lk);
    const opt = b.lookSec(c); opt.querySelector('summary').textContent = 'خيارات الخريطة التفصيلية (الأسماء، المدن، الحدود، الألوان…)'; opt.classList.add('mx-more'); body.append(opt);
  }

  /* ---------------- «الكاميرا» (compact; the full camera lives in the viewer) ---------------- */
  function cameraTab(c, body) {
    const b = B(); const scn = c.map.scene;
    const hero = h('div', 'mx-camhero'); hero.innerHTML = `<div>${GW.ico('camera', 22)}</div><p><b>حرّك الخريطة في لوحة «كاميرا الخريطة»</b><span>اسحب للتحريك، العجلة للتقريب، الزر الأيمن للإمالة. غيّر وقت المؤشر واضغط «مفتاح» لتسجيل حركة.</span></p>`;
    const ob = btn(GW.ico('camera', 15) + ' افتح كاميرا الخريطة', () => GW.showPanel('mapcam'), 'pri big'); ob.dataset.a = 'opencam'; hero.append(ob); body.append(hero);
    const fc = card('ركّز على دولة أو مدينة', 'zoom', 'يضيف مفتاح كاميرا عند المؤشر'); const fq = b.txt(M().focusQ || '', v => { M().focusQ = v; }, 'اكتب اسماً ثم Enter…'); fq.dataset.k = 'mxfocus'; fq.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') M().focusCountry(c, fq.value, M().focusPad || .6); };
    const fp = b.sel([[.85, 'ملء الإطار'], [.6, 'مع هامش'], [.42, 'مكان للنص'], [.3, 'بعيد']], String(M().focusPad || .6), v => { M().focusPad = +v; });
    const fr = h('div', 'mp-row mx-grow'); fr.append(fq, fp, btn(GW.ico('key', 13) + ' تركيز', () => M().focusCountry(c, fq.value, M().focusPad || .6), 'pri')); fc.body.append(fr); body.append(fc);
    const pc = card('حركات جاهزة', 'anim', 'تستبدل مفاتيح الكاميرا الحالية'); const pres = h('div', 'mx-presets');
    for (const [k, n, ico] of [['flight', 'رحلة طيران للهدف', 'plane'], ['orbit', 'دوران حول الهدف', 'reset'], ['reveal', 'كشف بالإمالة', 'up'], ['dolly', 'اقتراب العدسة', 'zoom'], ['tour3d', 'جولة ثلاثية الأبعاد', 'globe'], ['space', 'دخول من الفضاء', 'sparkle'], ['push', 'اندفاع نحو الهدف', 'arrow'], ['tilt', 'إمالة سينمائية', 'film']]) { const x = h('button', 'mx-preset', GW.ico(ico, 15) + `<span>${esc(n)}</span>`); x.onclick = () => b.camPreset(c, k); pres.append(x); }
    pc.body.append(pres); body.append(pc);
    const kc = card('مفاتيح الكاميرا', 'keydia', (scn.cam.keys || []).length ? (scn.cam.keys.length + ' مفاتيح') : 'الكاميرا ثابتة'); kc.body.append(b.camKeysBox(c)); body.append(kc);
    const more = b.sec('القيم الدقيقة والعرض ثلاثي الأبعاد', false, 'mxcamf'); more.classList.add('mx-more'); more.body.append(...unwrap(b.camSec(c, true))); body.append(more);
  }

  /* ---------------- «متقدم» ---------------- */
  function advTab(c, body) {
    const b = B(); const scn = c.map.scene;
    const ex = card('التصدير والمعاينة', 'export');
    ex.body.append(b.row('خلفية شفافة', b.chk(c.map.bg === 'alpha', v => { c.map.bg = v ? 'alpha' : 'full'; changed('خلفية الخريطة'); })), b.row('مدة الخريطة', GW.durCounter(c.dur, v => { const s = GW.seq(), old = c.dur; c.dur = v; for (const o of s.clips) if (o !== c && o.tt === c.tt && o.ti === c.ti && o.start >= c.start + old - 1e-6) o.start += v - old; GW.invalidate(); if (GW.TL) GW.TL.invalidate(); clearTimeout(GW._mdT); GW._mdT = setTimeout(() => GW.commit('مدة الخريطة'), 500); })), b.row('دقة الخريطة', b.sel([[0, 'تلقائي (حسب المشروع)'], [720, 'HD 720p'], [1080, 'Full HD 1080p'], [1440, '2K 1440p'], [2160, '4K 2160p']], c.map.res || 0, v => { c.map.res = +v || undefined; changed('دقة الخريطة'); })), b.row('جودة المعاينة', b.sel([[.6, 'سريعة'], [.85, 'متوازنة'], [1, 'عالية']], GW.mapPreviewQ || 1, v => { GW.mapPreviewQ = +v; GW.invalidate(); })), b.row('نص حقوق المصدر', b.chk(scn.look.attrib == null ? 1 : scn.look.attrib, v => { scn.look.attrib = v; changed('حقوق المصدر'); })),
      b.row('قفل التفاعل مع الخريطة', b.chk(M().mode === 'off', v => { M().mode = v ? 'off' : 'nav'; rerender(); GW.invalidate(); })));
    body.append(ex);
    { const d = card('الإعدادات الافتراضية', 'check', 'لكل خريطة جديدة'); const dq = unwrap(b.styleSec(c)).find(n => n.classList && n.classList.contains('mp-qa')); if (dq) d.body.append(dq); body.append(d); }
    const pin = b.pinSec(c); pin.open = true; pin.classList.add('mx-more'); body.append(pin);
    if (GW.FXUI) { const tr = card('مسار مستورد', 'route'); tr.body.append(b.row('الكاميرا تتبع المسار المستورد', b.chk(M().fxFollow, v => { M().fxFollow = v; })), btn(GW.ico('import', 13) + ' استيراد GPX / KML / GeoJSON…', () => GW.FXUI.importTrack(c))); body.append(tr); }
    const q = b.sec('مشاهد جاهزة في مقطع جديد (غزو سريع، الحدود عبر الزمن)', false, 'mxquick'); q.classList.add('mx-more'); for (const n of b.welcome().slice(1, 3)) q.body.append(n); body.append(q);
    if (GW.WarUI && GW.WarUI.section) { const w = GW.WarUI.section(c); w.classList.add('mx-more'); w.querySelector('summary').textContent = 'حرب تلقائية سريعة (الطريقة القديمة)'; body.append(w); }
  }

  /* ---------------- «الطبقات» ---------------- */
  const ICO = { country: 'flag', invasion: 'swords', arrow: 'arrow', front: 'area', route: 'route', marker: 'pin', label: 'text', image: 'user', range: 'circle', data: 'chart', inset: 'frame', date: 'calendar', legend: 'legend', title: 'caption', campaign: 'swords', clash: 'swords', strike: 'target', troops: 'arrow', air: 'plane', encircle: 'circle', siege: 'clock', clouds: 'cloud', move: 'route', callout: 'text', district: 'layers' };
  X.ICO = ICO;
  function layersTab(c, body) {
    const scn = c.map.scene;
    const top = h('div', 'mx-ltop'); const add = btn(GW.ico('plus', 16) + ' إضافة', () => X.openGallery(), 'pri big mx-addbtn'); add.dataset.a = 'add'; add.title = 'أضف حرباً، سهماً، قائداً، سحباً، نصاً…';
    const wz = btn(GW.ico('swords', 15) + ' حرب بين دولتين', () => X.openWizard(), 'big'); wz.dataset.a = 'wizard'; top.append(add, wz); body.append(top);
    if (!scn.layers.length) { body.append(emptyState(c)); return; }
    const list = h('div', 'mx-list'); list.dataset.a = 'list'; const dur = Math.max(.1, c.dur); const t0 = c.in || 0;
    const layers = [...scn.layers].reverse();
    layers.forEach((L) => {
      const r = h('div', 'mx-row' + (L.id === M().layerId ? ' on' : '') + (L.on ? '' : ' off') + (L.lock ? ' locked' : '')); r.dataset.id = L.id; r.draggable = true;
      const grip = h('span', 'mx-grip', GW.ico('grip', 14)); grip.title = 'اسحب لتغيير الترتيب';
      const ic = h('span', 'mx-ic', GW.ico(ICO[L.type] || 'layers', 15)); const info = h('div', 'mx-info');
      const s0 = (L.start || 0), e0 = L.dur != null ? s0 + L.dur : c.dur; const nm = h('span', 'nm'); nm.textContent = L.name; nm.title = (S.LAYERS[L.type] || {}).ar || L.type;
      const bar = h('div', 'mx-tbar'); const fill = h('i'); fill.style.insetInlineStart = (Math.max(0, s0 - 0) / dur * 100) + '%'; fill.style.width = (Math.max(0, Math.min(dur, e0) - s0) / dur * 100) + '%'; bar.append(fill); bar.title = `${s0.toFixed(1)}ث → ${L.dur != null ? e0.toFixed(1) + 'ث' : 'نهاية المقطع'}`;
      const ph = h('b'); ph.style.insetInlineStart = (Math.max(0, Math.min(1, (lt(c) - t0) / dur)) * 100) + '%'; bar.append(ph);
      info.append(nm, bar);
      const ib = (ico, tip, fn, cls) => { const x = h('button', 'ib' + (cls ? ' ' + cls : ''), GW.ico(ico, 14)); x.title = tip; x.onclick = (e) => { e.stopPropagation(); fn(); }; return x; };
      const acts = h('div', 'mx-racts');
      acts.append(ib(L.on ? 'eye' : 'eyeoff', L.on ? 'إخفاء' : 'إظهار', () => { L.on = L.on ? 0 : 1; changed('إظهار/إخفاء'); rerender(); }),
        ib(L.lock ? 'lock' : 'unlock', L.lock ? 'فك القفل' : 'قفل (منع التعديل بالخطأ)', () => { L.lock = L.lock ? 0 : 1; changed(L.lock ? 'قفل طبقة' : 'فك قفل'); rerender(); }, L.lock ? 'on' : 'dim'),
        ib('copy', 'تكرار', () => { const n = GW.clone(L); n.id = GW.uid(); n.name += ' (نسخة)'; scn.layers.splice(scn.layers.indexOf(L) + 1, 0, n); M().layerId = n.id; changed('تكرار'); rerender(); }),
        ib('trash', 'حذف', () => { scn.layers.splice(scn.layers.indexOf(L), 1); if (M().layerId === L.id) M().layerId = null; changed('حذف طبقة'); rerender(); }));
      r.append(grip, ic, info, acts);
      r.onclick = () => { M().layerId = M().layerId === L.id ? null : L.id; if (M().mode !== 'off') { M().mode = 'nav'; M().modeHint = ''; } rerender(); GW.invalidate(); };
      r.ondragstart = (e) => { X._drag = L.id; e.dataTransfer.effectAllowed = 'move'; r.classList.add('drag'); };
      r.ondragend = () => { X._drag = null; r.classList.remove('drag'); };
      r.ondragover = (e) => { if (!X._drag || X._drag === L.id) return; e.preventDefault(); const bb = r.getBoundingClientRect(); r.classList.toggle('dropa', e.clientY < bb.top + bb.height / 2); r.classList.toggle('dropb', e.clientY >= bb.top + bb.height / 2); };
      r.ondragleave = () => r.classList.remove('dropa', 'dropb');
      r.ondrop = (e) => { e.preventDefault(); const above = r.classList.contains('dropa'); r.classList.remove('dropa', 'dropb'); const a = scn.layers; const S0 = a.find(x => x.id === X._drag); if (!S0) return; a.splice(a.indexOf(S0), 1); const i = a.indexOf(L); a.splice(above ? i + 1 : i, 0, S0); changed('ترتيب الطبقات'); rerender(); };
      list.append(r);
      if (L.id === M().layerId) list.append(inspector(c, L));
    });
    body.append(list);
    body.append(h('div', 'mx-hint', GW.ico('help', 13) + '<span>الطبقة الأعلى في القائمة تُرسم فوق غيرها. اسحب المقبض لتغيير الترتيب، وانقر طبقة لتعديلها.</span>'));
  }
  function emptyState(c) {
    const w = h('div', 'mx-empty');
    w.append(h('h3', null, 'ابدأ بإضافة شيء إلى الخريطة'), h('p', null, 'كل ما تضيفه يظهر كطبقة لها وقت ظهور ومدة. اختر واحداً للبدء:'));
    const g = h('div', 'mx-cards');
    const cardB = (ico, t, d, fn, a) => { const x = h('button', 'mx-bigcard', `<i>${GW.ico(ico, 26)}</i><b>${esc(t)}</b><span>${esc(d)}</span>`); x.onclick = fn; x.dataset.a = a; g.append(x); };
    cardB('swords', 'أضف حرباً', 'دولة تهاجم أخرى وتسيطر على مدنها حتى النصر — لأي عصر', () => X.openWizard(), 'e-war');
    cardB('user', 'أضف قائداً', 'صورة شخصية في دائرة أو إطار أو راية', () => M().addLeader(c), 'e-leader');
    cardB('cloud', 'أضف سحباً', 'غيوم واقعية تتحرك فوق الخريطة', () => X.addItem(c, 'clouds'), 'e-clouds');
    cardB('arrow', 'أضف سهماً', 'سهم هجوم أو تحرك ترسمه بالنقر على الخريطة', () => X.addItem(c, 'arrow'), 'e-arrow');
    w.append(g);
    const steps = h('ol', 'mx-steps'); steps.innerHTML = `<li><b>اختر الزمن والنمط</b><span>من تبويب «المشهد»: السنة تحدد حدود الدول.</span></li><li><b>أضف طبقة</b><span>من زر «+ إضافة» أو البطاقات أعلاه، ثم عدّلها من محررها.</span></li><li><b>حرّك الكاميرا</b><span>في لوحة «كاميرا الخريطة»، واضغط «مفتاح» عند كل لقطة.</span></li>`;
    w.append(h('div', 'mx-sub', 'كيف تعمل؟ ثلاث خطوات'), steps, btn(GW.ico('help', 14) + ' جولة سريعة في اللوحة', () => X.tour(), 'ghost'));
    return w;
  }

  /* ---------------- inspector: essentials first, the rest in «خيارات متقدمة» ---------------- */
  const ESS = {
    country: ['اللون', 'شفافية التعبئة', 'الإطار', 'اسم الدولة'], invasion: ['المهاجم', 'الأهداف', 'اللون', 'شكل السهم'], arrow: ['اللون', 'العرض', 'الشكل'], route: ['اللون', 'الأيقونة', 'العرض'], front: ['اللون', 'شفافية', 'النمط'],
    marker: ['الأيقونة', 'النص', 'اللون', 'الحجم'], label: ['النص', 'الشكل', 'اللون', 'الحجم'], image: ['نمط العرض', 'الاسم', 'اللقب / الوصف', 'الشكل', 'الحجم', 'لون الطرف', 'لون الراية'], range: ['نصف القطر (كم)', 'النص', 'اللون'],
    data: ['عنوان المفتاح', 'لون أقل قيمة', 'لون أعلى قيمة'], inset: ['الموضع', 'الحجم', 'لون الدول'], date: ['الموضع', 'الصيغة', 'الحجم'], title: ['العنوان', 'العنوان الفرعي', 'القالب', 'اللون'],
    clouds: ['الكثافة', 'حجم الغيوم', 'الشفافية', 'سرعة الريح'], move: ['اللون', 'العرض', 'نمط الخط', 'رأس السهم', 'الرمز'], callout: ['النص', 'سطر فرعي', 'القالب'], district: ['كل مناطق الدولة', 'مناطق محددة', 'اللون', 'ارتفاع الرفع'],
    clash: ['النص', 'اللون', 'الحجم', 'الشدة'], strike: ['النوع', 'عدد المقذوفات'], troops: ['الرمز', 'اللون', 'عدد الوحدات', 'مدة المسير (ث)'], air: ['الطائرة', 'عدد الطائرات', 'عدد القنابل'],
    encircle: ['النص', 'نصف القطر (كم)', 'زمن الإغلاق (ث)', 'اللون'], siege: ['النص', 'نصف القطر (كم)', 'من اليوم', 'إلى اليوم'],
  };
  const TIMING = ['يبدأ عند (ث)', 'المدة (ث)', 'حركة الدخول', 'حركة الخروج', 'التوقيت', 'تظهر عند (ث)', 'تختفي عند (ث)', 'طريقة الظهور', 'طريقة الاختفاء', ''];
  const ADV_HEAD = ['رموز متحركة على المسار', 'حركة جيش (أسهم متوازية)', 'حدود منمّقة وقص ورقي', 'تحرك القائد على مسار', 'إظهار الأسماء حسب المستوى'];
  const HINTS = {
    'الاسم': 'اسم الطبقة في القائمة (لا يظهر على الخريطة إلا في القائد)', 'اللون': 'اللون الرئيسي للطبقة', 'الحجم': 'تكبير أو تصغير العنصر', 'النص': 'الكلام الذي يظهر على الخريطة', 'الشكل': 'شكل العنصر أو أسلوب كتابته',
    'شفافية التعبئة': '0 = شفاف تماماً، 1 = لون مصمت', 'الإطار': 'خط حدود الدولة المميزة', 'اسم الدولة': 'إظهار اسم الدولة فوقها وأسلوبه', 'المهاجم': 'الدولة التي تبدأ منها الأسهم', 'الأهداف': 'الدول التي تتجه إليها الأسهم',
    'شكل السهم': 'شكل خط الهجوم', 'العرض': 'سماكة الخط أو السهم', 'الأيقونة': 'الرمز المرسوم على الخريطة', 'نصف القطر (كم)': 'حجم الدائرة بالكيلومتر الحقيقي', 'الكثافة': 'كمية الغيوم في السماء',
    'حجم الغيوم': 'أكبر = غيوم أعرض', 'الشفافية': 'وضوح العنصر', 'سرعة الريح': 'سرعة تحرك الغيوم', 'نمط الخط': 'متصل، متقطع، نقاط…', 'رأس السهم': 'شكل نهاية السهم', 'الرمز': 'رمز يتحرك على المسار (طائرة، دبابة…)',
    'القالب': 'تصميم جاهز للنص', 'سطر فرعي': 'سطر صغير أسفل النص', 'نمط العرض': 'دائرة أو إطار أو راية قماشية للقائد', 'اللقب / الوصف': 'يظهر تحت اسم القائد', 'الموضع': 'مكان العنصر في الإطار',
    'الصيغة': 'كيف يُكتب التاريخ', 'العنوان': 'النص الكبير', 'العنوان الفرعي': 'سطر أصغر تحت العنوان', 'الشدة': 'كثافة الانفجارات والدخان', 'النوع': 'صواريخ أو مدفعية', 'عدد المقذوفات': 'كم صاروخاً أو قذيفة',
    'عدد الوحدات': 'عدد رموز القوات المتحركة', 'مدة المسير (ث)': 'الوقت الذي تستغرقه القوات للوصول', 'الطائرة': 'نوع الطائرة', 'عدد الطائرات': 'كم طائرة في السرب', 'عدد القنابل': 'انفجارات على طول المسار',
    'زمن الإغلاق (ث)': 'متى يكتمل الطوق حول المدينة', 'من اليوم': 'رقم أول يوم في العداد', 'إلى اليوم': 'رقم آخر يوم في العداد', 'يبدأ عند (ث)': 'متى تظهر الطبقة (من بداية مقطع الخريطة)', 'المدة (ث)': 'كم ثانية تبقى ظاهرة (فارغ = حتى النهاية)',
    'حركة الدخول': 'كيف تظهر الطبقة', 'حركة الخروج': 'كيف تختفي الطبقة', 'كل مناطق الدولة': 'ارفع كل محافظات هذه الدولة', 'مناطق محددة': 'أسماء محافظات مفصولة بفاصلة', 'ارتفاع الرفع': 'ارتفاع المناطق المرفوعة',
    'عنوان المفتاح': 'عنوان مفتاح الألوان', 'لون أقل قيمة': 'لون الدول ذات القيمة الأصغر', 'لون أعلى قيمة': 'لون الدول ذات القيمة الأكبر', 'لون الدول': 'لون الدول المشاركة في الكرة الصغيرة', 'النمط': 'منطقة ثابتة أو جبهة تتقدم',
    'شفافية': 'وضوح التعبئة', 'لون الطرف': 'خذ لون الراية من أحد أطراف الحرب', 'لون الراية': 'لون قماش الراية', 'الوقت (ث)': 'متى يبدأ الحدث', 'المنتصر': 'الطرف الذي يأخذ الأرض', 'الخاسر': 'الطرف الذي يفقد الأرض',
  };
  X.HINTS = HINTS;
  const addHints = (root) => { for (const lab of root.querySelectorAll('.frow > label')) { const t = lab.textContent.trim(); const tip = HINTS[t]; if (tip && !lab.querySelector('.mx-q')) { lab.title = tip; const q = h('span', 'mx-q', '؟'); q.title = tip; lab.append(q); } } };
  X.addHints = addHints;
  function inspector(c, L) {
    const w = h('div', 'mx-insp'); w.dataset.a = 'props'; w.onclick = (e) => e.stopPropagation();
    const K = S.LAYERS[L.type] || { ar: L.type };
    w.append(h('div', 'mx-ih', GW.ico(ICO[L.type] || 'layers', 16) + `<b>${esc(K.ar)}</b>`));
    if (L.lock) { w.append(h('div', 'mx-locked', GW.ico('lock', 14) + '<span>الطبقة مقفلة — افتح القفل لتعديلها.</span>'), btn(GW.ico('unlock', 13) + ' فك القفل', () => { L.lock = 0; changed('فك قفل'); rerender(); })); return w; }
    const box = h('div'); B().fillProps(c, L, box); if (GW.FXUI && GW.FXUI.props) { const fx = GW.FXUI.props(c, L); if (fx && fx.childNodes.length) box.append(...fx.childNodes); }
    const ess = ESS[L.type]; const main = h('div', 'mx-main'); const adv = B().sec('خيارات متقدمة', false, 'mxadv_' + L.type); adv.classList.add('mx-more'); const tim = B().sec('التوقيت والحركة', true, 'mxtime'); tim.classList.add('mx-more');
    const kids = [...box.childNodes].filter(n => !(n.classList && n.classList.contains('mp-sub') && (K.ar || '').startsWith(n.textContent.trim()))); // type headings (shown above)
    let inAdv = false;
    if (L.type === 'campaign') { // events first; sides and display options folded
      const sides = B().sec('الأطراف وألوانها', false, 'mxsides'); sides.classList.add('mx-more'); let grp = 'main';
      for (const n of kids) {
        if (n.classList && n.classList.contains('mp-sub')) { const t = n.textContent.trim(); if (t === 'الأطراف') { grp = 'sides'; continue; } if (t === 'أحداث السيطرة') { grp = 'main'; n.textContent = 'مجرى الحرب (الأحداث بالترتيب)'; } else if (t.startsWith('مناطق مرسومة') || t === 'العرض') grp = 'adv'; }
        const lab = n.classList && n.classList.contains('frow') ? (n.querySelector(':scope > label') || {}).textContent : null; if ((lab != null && TIMING.includes(lab.trim())) || (n.classList && n.classList.contains('mxt-note'))) { tim.body.append(n); continue; }
        (grp === 'sides' ? sides.body : grp === 'adv' ? adv.body : main).append(n);
      }
      w.append(main, sides, adv, tim); addHints(w); return w;
    }
    for (const n of kids) {
      const lab = n.classList && n.classList.contains('frow') ? (n.querySelector(':scope > label') || {}).textContent : null;
      if (n.classList && n.classList.contains('mp-sub')) inAdv = !!ess && ADV_HEAD.includes(n.textContent.trim());
      if ((lab != null && TIMING.includes(lab.trim())) || (n.classList && n.classList.contains('mxt-note'))) { tim.body.append(n); continue; }
      if (!ess || L.type === 'campaign') { main.append(n); continue; }
      if (inAdv) { adv.body.append(n); continue; }
      if (lab != null) { (lab.trim() === 'الاسم' || ess.includes(lab.trim()) ? main : adv.body).append(n); continue; }
      if (n.tagName === 'DIV' && !n.className) { adv.body.append(n); continue; }
      main.append(n);
    }
    w.append(main); if (adv.body.childNodes.length) w.append(adv); w.append(tim); addHints(w);
    return w;
  }

  /* ---------------- gallery «+ إضافة» ---------------- */
  const GAL = [
    ['حرب ومعارك', 'war', [
      ['war', 'swords', 'حرب بين دولتين — معالج', 'خطوة بخطوة: الطرفان، السيطرة على المدن، ثم النصر. لأي عصر', (c) => X.openWizard()],
      ['arrow', 'arrow', 'سهم هجوم', 'سهم متحرك ترسم مساره بالنقر على الخريطة', (c) => X.addItem(c, 'arrow')],
      ['front', 'area', 'خط جبهة يتقدم', 'خط جبهة بأسنان يتقدم في اتجاه الهجوم', (c) => M().addLayer(c, 'front', { mode: 'attack', pts: [], dir: 90, km: 120, fill: .35 })],
      ['clash', 'swords', 'اشتباك', 'علامة ودخان وانفجارات في مكان المعركة', (c) => M().addLayer(c, 'clash')],
      ['strike', 'target', 'قصف', 'صواريخ أو مدفعية من نقطة إطلاق إلى أهداف', (c) => M().addLayer(c, 'strike')],
      ['air', 'plane', 'غارة جوية', 'طائرات تعبر وتلقي القنابل', (c) => M().addLayer(c, 'air')],
      ['troops', 'arrow', 'تحرك قوات', 'رموز عسكرية تسير على مسار مع غبار', (c) => M().addLayer(c, 'troops')],
      ['encircle', 'circle', 'تطويق مدينة', 'كماشتان تلتفان حول مدينة', (c) => M().addLayer(c, 'encircle')],
      ['siege', 'clock', 'حصار', 'حلقة نابضة حول مدينة مع عداد الأيام', (c) => M().addLayer(c, 'siege')],
      ['invasion', 'swords', 'غزو دول', 'أسهم من دولة إلى دول أخرى واحتلال أرضها', (c) => M().addLayer(c, 'invasion')],
      ['campaign', 'layers', 'حملة فارغة (متقدم)', 'أطراف وأحداث سيطرة تبنيها يدوياً', (c) => M().addLayer(c, 'campaign', { sides: [{ id: 'a', name: 'الطرف الأول', color: '#a8322a', countries: [], fill: .5, border: 'solid' }, { id: 'b', name: 'الطرف الثاني', color: '#3c6e8f', countries: [], fill: .45, border: 'solid' }], events: [] })],
    ]],
    ['دول ومناطق', 'land', [
      ['country', 'flag', 'تمييز دولة', 'لوّن دولة أو أكثر وأبرز اسمها', (c) => M().addLayer(c, 'country')],
      ['district', 'layers', 'محافظات مرفوعة', 'مناطق إدارية بارزة ثلاثية الأبعاد', (c) => GW.FXUI ? GW.FXUI.add(c, 'district', { country: 'السعودية' }) : null],
      ['data', 'chart', 'بيانات / تلوين', 'لوّن الدول حسب أرقام (سكان، اقتصاد…)', (c) => M().addLayer(c, 'data')],
    ]],
    ['أشخاص', 'people', [
      ['leader', 'user', 'قائد في دائرة', 'صورة شخصية دائرية مع الاسم', (c) => M().addLeader(c)],
      ['leaderf', 'frame', 'قائد في إطار', 'صورة بإطار مستطيل ولوحة اسم', (c) => M().addLeader(c, { shape: 'rounded' })],
      ['banner', 'flag', 'قائد على راية', 'راية قماشية تتمايل مع صورة واسم', (c) => M().addLeader(c, { disp: 'banner', inDur: 1.2 })],
    ]],
    ['نصوص وعلامات', 'text', [
      ['label', 'text', 'اسم / نص على الخريطة', 'نص مثبت على مكان', (c) => M().addLayer(c, 'label')],
      ['callout', 'caption', 'بطاقة بخط إشارة', 'بطاقة نص مع خط يشير إلى مكان', (c) => GW.FXUI ? GW.FXUI.add(c, 'callout', {}, 'place') : null],
      ['marker', 'pin', 'علامة', 'أيقونة على مكان (انفجار، عاصمة، دبوس…)', (c) => M().addLayer(c, 'marker')],
      ['date', 'calendar', 'تاريخ', 'عداد السنة / التاريخ في الزاوية', (c) => M().addLayer(c, 'date')],
      ['title', 'caption', 'عنوان', 'عنوان كبير بقوالب (عاجل، شريط سفلي…)', (c) => M().addLayer(c, 'title')],
      ['legend', 'legend', 'وسيلة إيضاح', 'مفتاح الألوان في الزاوية', (c) => M().addLayer(c, 'legend')],
    ]],
    ['أجواء', 'sky', [
      ['clouds', 'cloud', 'سحب', 'غيوم واقعية تتحرك وتخترقها الكاميرا عند التقريب', (c) => X.addItem(c, 'clouds')],
      ['daynight', 'sun', 'ليل / نهار', 'ظل الليل وأضواء المدن على الكرة الأرضية', (c) => { c.map.scene.look.light = c.map.scene.look.light ? 0 : 1; changed('ليل / نهار'); GW.toast(c.map.scene.look.light ? 'تم تفعيل الليل والنهار — عدّل موقع الشمس من «المشهد ← خيارات الخريطة»' : 'تم إيقاف الليل والنهار'); rerender(); }],
      ['range', 'circle', 'مدى / دائرة', 'دائرة بنصف قطر حقيقي بالكيلومتر (مدى صاروخ…)', (c) => M().addLayer(c, 'range')],
    ]],
    ['مسارات', 'path', [
      ['move', 'route', 'طريق / مسار متحرك', 'خط يُرسم تدريجياً مع رمز يتحرك عليه', (c) => GW.FXUI ? GW.FXUI.add(c, 'move', { preset: 'route', name: 'مسار متحرك' }, 'draw') : M().addLayer(c, 'route')],
      ['army', 'swords', 'حركة جيش', 'أسهم متوازية تتقدم معاً', (c) => GW.FXUI ? GW.FXUI.add(c, 'move', { preset: 'army', name: 'حركة جيش' }, 'draw') : null],
      ['gpx', 'import', 'استيراد GPX / KML', 'مسار حقيقي من ملف رحلة', (c) => GW.FXUI ? GW.FXUI.importTrack(c) : null],
    ]],
    ['إطارات', 'frame', [
      ['inset', 'frame', 'خريطة داخل خريطة', 'كرة صغيرة في الزاوية توضح الموقع', (c) => M().addLayer(c, 'inset')],
    ]],
  ];
  X.GAL = GAL;
  X.addItem = (c, kind) => {
    if (kind === 'clouds') { const L = GW.FXUI ? GW.FXUI.add(c, 'clouds') : null; const v = B().camNow(c); // clouds are seen from above: bring a whole-globe camera close enough
      if (L && v.zoom < 4.2) { M().setCam(c, { zoom: 5 }); GW.commit('تقريب لرؤية السحب'); GW.toast('السحب تظهر عند التقريب — قرّبنا الكاميرا لتراها'); } return L; }
    if (kind === 'arrow') return GW.FXUI ? GW.FXUI.add(c, 'move', { name: 'سهم هجوم', head: 'classic' }, 'draw') : M().addLayer(c, 'arrow');
  };
  X.openGallery = () => {
    const c = M().clip(); if (!c) { GW.toast('حدد مقطع خريطة أولاً'); return; }
    const w = h('div', 'mx-gal'); const q = h('input', 'inp mx-gq'); q.placeholder = 'ابحث: سحب، سهم، قائد، حصار…'; q.onkeydown = e => e.stopPropagation(); w.append(q);
    const secs = h('div', 'mx-gsecs'); w.append(secs); let dlg = null;
    const fill = () => { secs.innerHTML = ''; const n = G.norm(q.value);
      for (const [title, tone, items] of GAL) {
        const its = items.filter(it => !n || G.norm(it[2]).includes(n) || G.norm(it[3]).includes(n)); if (!its.length) continue;
        const s = h('section', 'mx-gsec'); s.append(h('h4', null, esc(title))); const grid = h('div', 'mx-ggrid');
        for (const [id, ico, nm, desc, fn] of its) { const b = h('button', 'mx-gi tone-' + tone, `<i>${GW.ico(ico, 24)}</i><b>${esc(nm)}</b><span>${esc(desc)}</span>`); b.dataset.g = id; b.onclick = () => { if (dlg) dlg.close(); X.setTab(c, 'layers'); fn(c); rerender(); }; grid.append(b); }
        s.append(grid); secs.append(s);
      } };
    q.oninput = fill; fill();
    dlg = GW.modal({ title: 'إضافة إلى الخريطة', body: w, width: 860, buttons: [{ label: 'إغلاق', value: null }] }); dlg.el.classList.add('mx-galdlg');
    setTimeout(() => q.focus(), 40); return dlg;
  };

  /* ---------------- welcome (no map clip selected) ---------------- */
  function welcome() {
    const w = h('div', 'mx-welcome');
    w.append(h('div', 'mx-whero', `<i>${GW.ico('globe', 34)}</i><h3>استوديو الخرائط</h3><p>خرائط حربية وتاريخية لأي عصر: حدود دقيقة من 123 ألف سنة قبل الميلاد حتى اليوم، حروب بين الدول، قادة، سحب وكاميرا سينمائية.</p>`));
    const g = h('div', 'mx-cards');
    const cardB = (ico, t, d, fn, a) => { const x = h('button', 'mx-bigcard', `<i>${GW.ico(ico, 26)}</i><b>${esc(t)}</b><span>${esc(d)}</span>`); x.onclick = fn; x.dataset.a = a; g.append(x); };
    cardB('globe', 'خريطة جديدة (كرة أرضية)', 'كرة ثلاثية الأبعاد بمظهر وثائقي', () => GW.UI.addMapClip(S.applyDocLook(A.newScene({ mode: 'globe' }), 'doc_dark')), 'w-globe');
    cardB('map', 'خريطة مسطحة', 'خريطة سياسية مسطحة', () => GW.UI.addMapClip(A.newScene({ mode: 'flat', style: 'political', cam: { lon: 30, lat: 30, zoom: 3, tilt: 0, heading: 0, keys: [] } })), 'w-flat');
    cardB('swords', 'حرب بين دولتين', 'معالج خطوة بخطوة ينشئ المشهد كاملاً', () => X.openWizard({ target: 'new' }), 'w-war');
    w.append(g);
    const s = GW.seq(); const cs = s.clips.filter(c => c.kind === 'map');
    if (cs.length) { const l = h('div', 'mx-clips'); l.append(h('div', 'mx-sub', 'مقاطع الخرائط في التسلسل')); for (const c of cs) { const r = h('button', 'mx-clip', GW.ico('map', 14) + `<span>${esc(c.name)}</span><em>${GW.fmtTC(c.start, s.fps)}</em>`); r.onclick = () => GW.UI.openMapEditor(c); l.append(r); } w.append(l); }
    const more = B().sec('مشاهد تلقائية سريعة', false, 'mxwq'); more.classList.add('mx-more'); for (const n of B().welcome().slice(1)) more.body.append(n); w.append(more);
    return w;
  }

  /* ================= war wizard ================= */
  const SUGG = [[2020, 'روسيا', 'أوكرانيا'], [1980, 'العراق', 'إيران'], [1939, 'ألمانيا', 'بولندا'], [1914, 'ألمانيا', 'فرنسا'], [1700, 'العثمانية', 'النمسا'], [1600, 'العثمانية', 'الصفوية'], [1500, 'العثمانية', 'المماليك'], [1400, 'العثمانية', 'البيزنطية'], [1200, 'المغول', 'الخوارزمية'], [1000, 'الفاطمية', 'البيزنطية'], [700, 'الأموية', 'البيزنطية'], [600, 'البيزنطية', 'الساسانية'], [-400, 'الفارسية', 'أثينا'], [-3000, '', '']];
  const YEARS = [['2022', 2022], ['2003', 2003], ['1980', 1980], ['1939', 1939], ['1914', 1914], ['1683', 1683], ['1600', 1600], ['1517', 1517], ['1453', 1453], ['1258', 1258], ['1187', 1187], ['1071', 1071], ['800', 800], ['636', 636], ['331 ق.م', -331]];
  const STEPS = ['العصر', 'الطرفان', 'مجرى الحرب', 'الكاميرا والإنشاء'];
  const KIND_HELP = { capture: 'المهاجم يأخذ مدينة (وما حولها)', region: 'المهاجم يأخذ محافظة أو منطقة كاملة', battle: 'معركة في مكان دون تغيّر الحدود', advance: 'الجبهة تتقدم نحو مدينة', strike: 'قصف مدينة', retreat: 'المهاجم ينسحب من مدينة أخذها', victory: 'المنتصر يأخذ كل ما تبقى + بطاقة «انتصار»', truce: 'هدنة: خط تقسيم ترسمه بعد الإنشاء' };
  const W = X.wz = { s: null, dlg: null };
  // states first (cultures / peoples last); with the other side chosen and no query: neighbours first
  const NONSTATE = /peoples|hunter|gatherers|farmers|culture|tribes|nomads|aborig|siberians|herders|pastoral|foragers/i;
  function rankEnts(era, q, other, cur) {
    let r = WR.entitySearch(era, q, q ? 60 : 400); const of = other && WR.groups(G.features(era, 0)).get(other.key);
    const sc = (e) => (NONSTATE.test(e.en) ? 1e6 : 0) + (of && !q ? Math.max(0, d3.geoDistance(e.f.lab, of.lab) - e.f.rad - of.rad) * 1e3 - Math.log(1 + e.area) : -Math.log(1 + e.area) * 10);
    r = r.filter(e => !other || e.key !== other.key).map(e => [sc(e), e]).sort((a, b) => a[0] - b[0]).map(x => x[1]).slice(0, 60);
    if (cur && !r.some(e => e.key === cur.key)) { const e = WR.entities(era).find(x => x.key === cur.key); if (e) r.unshift(e); }
    return r;
  }
  X.openWizard = (o = {}) => {
    const c = M().clip(); const y0 = o.year || (c ? Math.round(GW.pv(c.map.scene.year, lt(c))) : 2022);
    W.s = Object.assign({ step: 0, year: y0, a: null, b: null, qa: '', qb: '', events: [], camera: 1, target: c ? 'cur' : 'new', style: 'doc_dark', date: 1, title: '', cityR: 0, withProv: 1 }, o);
    const body = h('div', 'mx-wz'); W.body = body;
    W.dlg = GW.modal({ title: 'حرب بين دولتين', body, width: 820, buttons: [{ label: 'إلغاء', value: null }] }); W.dlg.el.classList.add('mx-wzdlg');
    G.load().then(() => W.render()); W.render(); return W;
  };
  W.era = () => G.era(W.s.year, 'auto');
  W.next = () => { const s = W.s; if (s.step === 1 && (!s.a || !s.b)) { GW.toast('اختر المهاجم والمدافع', 'err'); return false; } if (s.step === 1 && !s.events.length) W.suggest(); s.step = Math.min(3, s.step + 1); W.render(); return true; };
  W.prev = () => { W.s.step = Math.max(0, W.s.step - 1); W.render(); };
  W.setSide = (role, q) => { const r = WR.entitySearch(W.era(), q, 1)[0]; if (!r) return null; const col = role === 'a' ? '#b0322a' : '#2f6aa8'; W.s[role] = { key: r.key, name: r.ar || r.en, color: (W.s[role] && W.s[role].color) || col }; W.s.events = []; return r; };
  W.defF = () => W.s.b && WR.groups(G.features(W.era(), 0)).get(W.s.b.key);
  W.addEvent = (kind, cityQ) => { const e = { kind }; if (cityQ) { const r = WR.citySearch(cityQ, W.era(), W.s.year, W.defF(), 1)[0]; if (r) e.city = r; } W.s.events.push(e); return e; };
  W.suggest = () => { const s = W.s; if (!s.a || !s.b) return; s.events = WR.suggestEvents(W.era(), s.year, s.a.key, s.b.key, 3); };
  W.create = async () => {
    const s = W.s; if (!s.a || !s.b) { GW.toast('اختر الطرفين', 'err'); return null; }
    const evs = s.events.filter(e => e.kind === 'victory' || e.kind === 'truce' || e.city || (e.units && e.units.length));
    let r; try { r = await WR.buildCampaign({ year: s.year, a: s.a, b: s.b, events: evs, withProv: s.withProv, cityR: s.cityR || undefined }); } catch (e) { GW.toast(e.message, 'err'); return null; }
    const c = s.target === 'cur' ? M().clip() : null; let L = r.layer;
    if (c) {
      const scn = c.map.scene; L.start = +Math.max(0, lt(c) - (c.in || 0)).toFixed(2); scn.layers.push(L); if (scn.style === 'woven') (L.sides || []).forEach((sd, i) => Object.assign(sd, { pattern: 'weave', fill: .6, patA: .5 }));
      if (!GW.isAnim(scn.year)) scn.year = GW.P(s.year);
      if (s.camera) { const keys = WR.cameraKeys(L, scn, { frac: .4, zMax: r.wide.zoom + 1.1, tilt: 18 }); WR.applyCameraKeys(scn, [{ t: L.start, lon: r.wide.lon, lat: r.wide.lat, zoom: r.wide.zoom, tilt: 0 }, ...keys]); }
      if (c.dur < L.start + r.dur) c.dur = Math.ceil(L.start + r.dur);
      M().layerId = L.id; X.tabs[c.id] = 'layers'; changed('حرب بين دولتين'); GW.bus.emit('camkeys');
    } else {
      const scn = A.newScene({ style: s.style, mode: 'globe', year: GW.P(r.year) }); if (String(s.style).startsWith('doc')) S.applyDocLook(scn, s.style);
      if (s.style === 'woven') { scn.layers.push(L); S.applyWovenLook(scn); scn.layers.splice(scn.layers.indexOf(L), 1); }
      scn.layers.push(L); if (s.camera) WR.cameraForWar(scn, L, r.wide, r.dur, { focus: r.focus }); else Object.assign(scn.cam, { lon: r.wide.lon, lat: r.wide.lat, zoom: r.wide.zoom });
      if (s.date) scn.layers.push(S.newLayer('date', { start: .3 }));
      if (s.title) scn.layers.push(S.newLayer('title', { text: s.title, sub: '', template: 'lower', color: s.a.color, start: .6, dur: 3.2, out: 'fade' }));
      const nc = GW.UI.addMapClip(scn, { dur: Math.ceil(r.dur), name: 'حرب: ' + r.nA + ' – ' + r.nB }); M().layerId = L.id; X.tabs[nc.id] = 'layers';
    }
    if (W.dlg) W.dlg.close(); W.dlg = null; rerender(); GW.toast('تم إنشاء الحرب — عدّل الأحداث من محرر الطبقة'); return L;
  };
  W.render = () => {
    const s = W.s; const b = W.body; if (!b || !s) return; b.innerHTML = ''; const era = W.era();
    const st = h('ol', 'mx-stepper'); STEPS.forEach((n, i) => { const li = h('li', i === s.step ? 'on' : i < s.step ? 'done' : '', `<i>${i < s.step ? GW.ico('check', 13) : i + 1}</i><span>${esc(n)}</span>`); li.onclick = () => { if (i < s.step || (i === s.step + 1)) { if (i > s.step) W.next(); else { s.step = i; W.render(); } } }; st.append(li); }); b.append(st);
    const pane = h('div', 'mx-wpane'); b.append(pane);
    if (s.step === 0) {
      pane.append(h('h3', null, 'في أي عصر تدور الحرب؟'), h('p', 'mx-wp', 'اكتب السنة (سالبة = قبل الميلاد) أو اختر واحدة. الدول المتاحة في الخطوة التالية هي دول تلك السنة.'));
      const yi = h('input', 'inp mx-yr'); yi.type = 'number'; yi.value = s.year; yi.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') W.next(); }; yi.onchange = () => { s.year = +yi.value || s.year; s.a = s.b = null; s.events = []; W.render(); }; yi.dataset.k = 'wzyear';
      const chips = h('div', 'mx-ychips'); for (const [l, y] of YEARS) { const x = h('button', 'chip' + (s.year === y ? ' on' : '')); x.textContent = l; x.onclick = () => { s.year = y; s.a = s.b = null; s.events = []; W.render(); }; chips.append(x); }
      const pr = G.precision(era); const n = G.ready ? WR.entities(era).length : 0;
      pane.append(yi, chips, h('div', 'mp-prec lvl' + pr.lvl, '<i class="dot"></i>' + esc(pr.ar)), h('div', 'mx-wp', n ? `${n} دولة وكياناً سياسياً في هذه السنة.` + (era.src === 'hist' ? ' في العصور القديمة لا توجد محافظات: تُحسب السيطرة بمناطق حول المدن أو مناطق ترسمها.' : ' يمكن السيطرة على المحافظات والمدن.') : 'جارٍ تحميل حدود هذه السنة…'));
      if (!n) G.ensureEra(era, 0).then(() => { if (W.s === s && s.step === 0) W.render(); });
    }
    if (s.step === 1) {
      pane.append(h('h3', null, 'من يهاجم من؟'), h('p', 'mx-wp', `دول سنة ${G.fmtYear(s.year)}. ابحث بالاسم العربي أو الإنجليزي.`));
      const sg = SUGG.find(x => s.year >= x[0]); if (sg && sg[1]) { const ex = h('button', 'chip', `${GW.ico('sparkle', 12)} مثال: ${esc(sg[1])} ضد ${esc(sg[2])}`); ex.onclick = () => { W.setSide('a', sg[1]); W.setSide('b', sg[2]); W.render(); }; pane.append(ex); }
      const cols = h('div', 'mx-sides');
      for (const [role, title] of [['a', 'المهاجم'], ['b', 'المدافع']]) {
        const col = h('div', 'mx-side'); const cur = s[role]; col.append(h('h4', null, esc(title)));
        const chosen = h('div', 'mx-chosen' + (cur ? ' set' : '')); if (cur) { const cp = h('input'); cp.type = 'color'; cp.value = cur.color; cp.oninput = () => { cur.color = cp.value; }; chosen.append(cp, h('b', null, esc(cur.name))); } else chosen.append(h('span', null, 'لم يُختر بعد')); col.append(chosen);
        const q = h('input', 'inp'); q.placeholder = 'ابحث عن دولة…'; q.value = s['q' + role]; q.onkeydown = e => e.stopPropagation(); q.dataset.k = 'wzq' + role;
        const list = h('div', 'mx-elist'); const other = s[role === 'a' ? 'b' : 'a']; const fillL = () => { list.innerHTML = ''; for (const e of rankEnts(era, q.value, other, cur)) { const it = h('button', 'mx-ent' + (cur && cur.key === e.key ? ' on' : ''), `<b>${esc(e.ar || e.en)}</b><span>${esc(e.en)}</span>`); it.onclick = () => { s['q' + role] = q.value; s[role] = { key: e.key, name: e.ar || e.en, color: (cur && cur.color) || (role === 'a' ? '#b0322a' : '#2f6aa8') }; s.events = []; W.render(); }; list.append(it); } if (!list.childNodes.length) list.append(h('div', 'mp-note', 'لا نتائج في هذه السنة')); };
        q.oninput = () => { s['q' + role] = q.value; fillL(); }; fillL(); col.append(q, list); cols.append(col);
      }
      pane.append(cols);
    }
    if (s.step === 2) {
      pane.append(h('h3', null, 'مجرى الحرب'), h('p', 'mx-wp', `الأحداث بالترتيب: ${esc(s.a.name)} يهاجم ${esc(s.b.name)}. كل حدث يأخذ بضع ثوانٍ، ويمكن تعديل التوقيت لاحقاً بالسحب.`));
      const add = h('div', 'mx-evadd big'); for (const k of ['capture', 'region', 'battle', 'advance', 'strike', 'retreat', 'victory', 'truce']) { const x = h('button', 'chip', GW.ico((GW.WarUI && GW.WarUI.EV_ICO[k]) || 'swords', 13) + ' ' + esc(WR.EV_KINDS[k].ar)); x.title = KIND_HELP[k]; x.dataset.ev = k; x.onclick = () => { W.s.events.push({ kind: k }); W.render(); }; add.append(x); }
      const sug = btn(GW.ico('wand', 13) + ' اقتراح تلقائي', () => { W.suggest(); W.render(); }); sug.title = 'أقرب مدن المدافع إلى حدود المهاجم ثم النصر';
      pane.append(h('div', 'mx-sub', 'أضف حدثاً (يُضاف في آخر القائمة):'), add, h('div', 'mp-row'), h('div', 'mx-evlist'));
      pane.children[pane.children.length - 2].append(sug, btn(GW.ico('trash', 13) + ' مسح الكل', () => { s.events = []; W.render(); }));
      const evl = pane.lastChild; const F = W.defF(); const cityPool = F ? WR.citiesOf(F, era, s.year, 300) : [];
      const provs = era.src !== 'hist' && G.admin1 && F ? WR.provinces(WR.ccOf(F)) : []; if (era.src !== 'hist' && !G.admin1) WR.loadA1().then(() => { if (W.s === s && s.step === 2) W.render(); });
      s.events.forEach((e, i) => {
        const r = h('div', 'mx-evrow'); const K = WR.EV_KINDS[e.kind] || WR.EV_KINDS.capture;
        r.append(h('span', 'mx-evn', String(i + 1)), h('span', 'mx-evk', GW.ico((GW.WarUI && GW.WarUI.EV_ICO[e.kind]) || 'swords', 14) + esc(K.ar)));
        const mid = h('div', 'mx-evmid');
        if (['capture', 'battle', 'advance', 'strike', 'retreat'].includes(e.kind) || (e.kind === 'region' && !provs.length)) {
          const sl = h('select', 'sel'); sl.append(new Option(e.kind === 'region' ? '— منطقة حول مدينة —' : '— اختر مدينة —', '')); for (const cty of cityPool) sl.append(new Option(cty.a + (cty.cap ? ' (عاصمة)' : ''), cty.key));
          if (e.city && !cityPool.some(x => x.key === e.city.key)) sl.append(new Option(e.city.a, e.city.key)); sl.value = e.city ? e.city.key : ''; sl.onchange = () => { e.city = cityPool.find(x => x.key === sl.value) || e.city; };
          mid.append(sl);
          if (era.src === 'hist' && (e.kind === 'capture' || e.kind === 'region' || e.kind === 'advance')) { const ri = h('input', 'inp num'); ri.type = 'number'; ri.min = 5; ri.step = 5; ri.value = e.r || (e.kind === 'region' ? 100 : 45); ri.title = 'نصف قطر منطقة السيطرة حول المدينة (كم)'; ri.onkeydown = ev => ev.stopPropagation(); ri.onchange = () => { e.r = +ri.value; }; mid.append(ri, h('span', 'mx-u', 'كم')); }
        } else if (e.kind === 'region') {
          const sl = h('select', 'sel'); sl.append(new Option('— اختر محافظة —', '')); for (const p of provs.slice().sort((a, b) => (a.ar || '').localeCompare(b.ar || '', 'ar'))) sl.append(new Option(p.ar || p.en, p.key)); sl.value = (e.units || [])[0] || ''; sl.onchange = () => { e.units = sl.value ? [sl.value] : []; const p = provs.find(x => x.key === sl.value); e.place = p ? (p.ar || p.en) : ''; }; mid.append(sl);
        } else mid.append(h('span', 'mx-u', e.kind === 'victory' ? `${s.a.name} يأخذ كل ما تبقى من ${s.b.name}` : 'ترسم خط التقسيم بعد الإنشاء'));
        r.append(mid);
        const ib = (ico, tip, fn) => { const x = h('button', 'ib', GW.ico(ico, 14)); x.title = tip; x.onclick = fn; return x; };
        r.append(ib('up', 'أبكر', () => { if (i > 0) { s.events.splice(i, 1); s.events.splice(i - 1, 0, e); W.render(); } }), ib('down', 'أبعد', () => { if (i < s.events.length - 1) { s.events.splice(i, 1); s.events.splice(i + 1, 0, e); W.render(); } }), ib('trash', 'حذف', () => { s.events.splice(i, 1); W.render(); }));
        evl.append(r);
      });
      if (!s.events.length) evl.append(h('div', 'mx-wp', 'لا أحداث بعد. اضغط «اقتراح تلقائي» أو أضف حدثاً من الأزرار أعلاه.'));
      if (era.src !== 'hist' && provs.length) pane.append(h('label', 'mx-chk', ''), (() => { const l = h('label', 'mx-chk'); const cb = h('input'); cb.type = 'checkbox'; cb.checked = s.withProv !== 0; cb.onchange = () => { s.withProv = cb.checked ? 1 : 0; }; l.append(cb, document.createTextNode(' عند السيطرة على مدينة تنتقل محافظتها كاملة')); return l; })());
    }
    if (s.step === 3) {
      pane.append(h('h3', null, 'الكاميرا والإنشاء'));
      const tot = (s.events || []).reduce((a, e) => a + (WR.EV_KINDS[e.kind] || WR.EV_KINDS.capture).dur + (e.kind === 'victory' || e.kind === 'truce' ? 4.6 : 1.1), 3.4);
      const opts = h('div', 'mx-wopts');
      const sw = (label, key, help) => { const l = h('label', 'mx-chk'); const cb = h('input'); cb.type = 'checkbox'; cb.checked = !!s[key]; cb.onchange = () => { s[key] = cb.checked ? 1 : 0; }; l.append(cb, h('span', null, `<b>${esc(label)}</b><em>${esc(help)}</em>`)); return l; };
      opts.append(sw('الكاميرا تتبع الأحداث', 'camera', 'تتحرك الكاميرا تلقائياً إلى كل مدينة قبل سقوطها'));
      const tg = h('div', 'seg mx-target'); for (const [k, n] of [['cur', 'في مقطع الخريطة الحالي'], ['new', 'مقطع خريطة جديد']]) { const x = h('button', s.target === k ? 'on' : ''); x.textContent = n; x.disabled = k === 'cur' && !M().clip(); x.onclick = () => { s.target = k; W.render(); }; tg.append(x); }
      opts.append(h('div', 'mx-sub', 'أين تُنشأ الحرب؟'), tg);
      if (s.target === 'new') { const sl = h('select', 'sel'); for (const k of S.STYLE_ORDER) sl.append(new Option(S.STYLES[k].ar, k)); sl.value = s.style; sl.onchange = () => { s.style = sl.value; }; const ti = h('input', 'inp'); ti.placeholder = 'عنوان المشهد (اختياري)'; ti.value = s.title; ti.onkeydown = e => e.stopPropagation(); ti.oninput = () => { s.title = ti.value; }; opts.append(B().row('نمط الخريطة', sl), B().row('العنوان', ti), sw('عداد التاريخ', 'date', 'يظهر السنة في الزاوية')); }
      pane.append(opts, h('div', 'mx-sum', `${GW.ico('swords', 16)}<span><b>${esc(s.a.name)}</b> ضد <b>${esc(s.b.name)}</b> · سنة ${esc(G.fmtYear(s.year))} · ${s.events.length} أحداث · نحو ${Math.ceil(tot)} ثانية</span>`));
    }
    const nav = h('div', 'mx-wnav'); if (s.step > 0) nav.append(btn(GW.ico('right', 14) + ' السابق', () => W.prev()));
    nav.append(h('span', 'mx-sp'));
    if (s.step < 3) { const nx = btn('التالي ' + GW.ico('left', 14), () => W.next(), 'pri big'); nx.dataset.a = 'wznext'; nav.append(nx); } else { const cr = btn(GW.ico('check', 15) + ' إنشاء الحرب', () => W.create(), 'pri big'); cr.dataset.a = 'wzcreate'; nav.append(cr); }
    b.append(nav);
  };

  /* ================= quick tour (coach marks) ================= */
  const TOUR = [
    ['.mx-tabs', 'التبويبات الأربعة', '«المشهد» للسنة والنمط، «الطبقات» لكل ما تضيفه، «الكاميرا» للحركة، «متقدم» للتصدير والإعدادات.'],
    ['.mx-addbtn', 'زر الإضافة', 'من هنا تضيف حرباً أو سهماً أو قائداً أو سحباً أو نصاً — كلها في معرض واحد مقسّم.'],
    ['.mx-list, .mx-empty', 'قائمة الطبقات', 'انقر طبقة لتعديلها: الخيارات الأساسية أولاً و«خيارات متقدمة» للباقي. اسحب المقبض لتغيير الترتيب.'],
    ['[data-panel=mapcam] .mcv-stage', 'كاميرا الخريطة', 'هنا تتحرك الخريطة: اسحب، العجلة للتقريب، الزر الأيمن للإمالة. وعندما تطلب طبقة تحديد مكان انقر هنا.'],
    ['[data-panel=mapcam] .mcv-strip', 'شريط الزمن', 'مفاتيح الكاميرا وأشرطة الطبقات: اسحب الشريط لتغيير وقت ظهور الطبقة.'],
  ];
  X.tour = (i = 0) => {
    X.tourEnd(); const st = TOUR.slice(i).findIndex(t => { const e = document.querySelector(t[0]); return e && e.getBoundingClientRect().width > 4; }); if (st < 0) return; const k = i + st; const [sel, title, txt] = TOUR[k];
    const el = document.querySelector(sel); const r = el.getBoundingClientRect(); const o = h('div', 'mx-tour'); const hole = h('div', 'mx-hole'); Object.assign(hole.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
    const tip = h('div', 'mx-tip', `<small>${k + 1} / ${TOUR.length}</small><b>${esc(title)}</b><p>${esc(txt)}</p>`); const nav = h('div', 'mp-row');
    nav.append(btn('إنهاء', () => X.tourEnd(), 'ghost')); const more = TOUR.slice(k + 1).some(t => document.querySelector(t[0])); nav.append(btn(more ? 'التالي' : 'تم', () => more ? X.tour(k + 1) : X.tourEnd(), 'pri')); tip.append(nav);
    const below = r.bottom + 180 < innerHeight; tip.style.top = (below ? r.bottom + 14 : Math.max(10, r.top - 170)) + 'px'; tip.style.left = Math.max(10, Math.min(innerWidth - 330, r.left + r.width / 2 - 160)) + 'px';
    o.append(hole, tip); o.onclick = (e) => { if (e.target === o) X.tourEnd(); }; document.body.append(o); X._tour = o;
  };
  X.tourEnd = () => { if (X._tour) X._tour.remove(); X._tour = null; };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return; if (X._tour) { X.tourEnd(); return; }
    const md = M() && M().mode; if ((md === 'pick' || md === 'draw' || md === 'place') && !document.querySelector('.modal') && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); M().done(); }
  });
})();
