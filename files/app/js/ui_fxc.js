'use strict';
/* Effect Controls: fixed effects (Motion/Opacity/Volume), effect stacks, masks, keyframe lane */
(function () {
  const { $, clamp, esc } = GW;
  const F = GW.FXC = { open: {}, rows: [], selKey: null };
  const SW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 13V9M10 2h4M12 2v3"/></svg>';
  const sel1 = () => { if (GW.sel.clips.size === 0) return null; const ids = [...GW.sel.clips]; const cs = ids.map(id => GW.clipById(id)).filter(Boolean); return cs.find(c => c.tt === 'v') || cs[0] || null; };

  GW.registerPanel('fxc', 'عناصر التحكم في التأثيرات', (el) => {
    el.innerHTML = `<div class="fxc"><div class="fxc-left" data-a="left"></div><div class="fxc-right" data-a="right"><canvas data-a="kc"></canvas></div></div>`;
    F.el = el; F.left = el.querySelector('[data-a=left]'); F.kc = el.querySelector('[data-a=kc]'); F.right = el.querySelector('[data-a=right]');
    F.left.addEventListener('scroll', () => F.drawKeys());
    initKeyLane(); initGraph(); F.render();
    F.left.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-gws-fx')) e.preventDefault(); });
    F.left.addEventListener('drop', e => { const d = e.dataTransfer.getData('application/x-gws-fx'); if (!d) return; e.preventDefault(); const c = sel1(); if (c) GW.UI.applyFxTo(JSON.parse(d), c, {}); });
  });
  const lt = (c) => GW.seq().t - c.start;
  function commitSoon(label) { GW.invalidate(); GW.commitSoon(label || 'تعديل خاصية'); F.drawKeys(); GW.bus.emit('param-ui'); }

  /* ---------- row builders ---------- */
  function row(c, p, name, ctl, opts = {}) {
    const r = document.createElement('div'); r.className = 'prow';
    const sw = document.createElement('button'); sw.className = 'sw' + (GW.isAnim(p) ? ' on' : ''); sw.innerHTML = SW; sw.title = 'تفعيل/تعطيل الحركة بالمفاتيح';
    if (opts.noAnim || !p) sw.style.visibility = 'hidden';
    sw.onclick = () => { GW.toggleAnim(p, clamp(lt(c), 0, c.dur)); GW.commit(GW.isAnim(p) ? 'تفعيل الحركة' : 'إلغاء الحركة'); F.render(); };
    const nm = document.createElement('span'); nm.className = 'pn'; nm.textContent = name; nm.title = name;
    const pv = document.createElement('span'); pv.className = 'pv'; if (ctl) pv.append(ctl);
    const kn = document.createElement('span'); kn.className = 'kn';
    if (p && !opts.noAnim) {
      const prev = document.createElement('button'); prev.className = 'kprev'; prev.innerHTML = GW.ico('keyprev', 12); prev.title = 'المفتاح السابق';
      const dia = document.createElement('button'); dia.className = 'kd' + (GW.keyAt(p, lt(c)) ? ' on' : ''); dia.innerHTML = GW.ico(GW.keyAt(p, lt(c)) ? 'keydiaon' : 'keydia', 12); dia.title = 'إضافة/حذف مفتاح';
      const next = document.createElement('button'); next.className = 'knext'; next.innerHTML = GW.ico('keynext', 12); next.title = 'المفتاح التالي';
      prev.onclick = () => { if (!p.k) return; const t = lt(c); const k = p.k.filter(k => k.t < t - 1e-4).pop(); if (k) GW.seek(c.start + k.t); };
      next.onclick = () => { if (!p.k) return; const t = lt(c); const k = p.k.find(k => k.t > t + 1e-4); if (k) GW.seek(c.start + k.t); };
      dia.onclick = () => { const t = clamp(GW.snapFrame(lt(c), GW.seq().fps), 0, c.dur); const k = GW.keyAt(p, t); if (k) { p.k = p.k.filter(x => x !== k); if (!p.k.length) { p.v = k.v; delete p.k; } } else { if (!p.k) p.k = []; p.k.push({ t, v: GW.clone(GW.pv(p, t)), e: 'linear' }); p.k.sort((a, b) => a.t - b.t); } GW.commit('مفتاح'); F.render(); };
      kn.append(prev, dia, next);
    }
    const rs = document.createElement('button'); rs.className = 'reset btn sm ico ghost'; rs.innerHTML = GW.ico('reset', 13); rs.title = 'إعادة الضبط';
    if (opts.def !== undefined && p) rs.onclick = () => { GW.setPv(p, lt(c), GW.clone(opts.def)); GW.commit('إعادة الضبط'); F.render(); }; else rs.style.visibility = 'hidden';
    kn.append(rs);
    r.append(sw, nm, pv, kn); r._p = p; r._c = c;
    F.rows.push(r);
    graphTwirl(r, c, p, nm, opts);
    return r;
  }
  function numCtl(c, p, o = {}) {
    return GW.scrub({ get: () => GW.pv(p, lt(c)), set: (v, fin) => { GW.setPv(p, clamp(lt(c), 0, c.dur), o.round ? Math.round(v) : v); GW.invalidate(); if (fin) { GW.commit(o.label || 'تعديل خاصية'); F.render(); } else F.drawKeys(); }, step: o.step || 1, min: o.min, max: o.max, unit: o.unit, dec: o.dec ?? 1 });
  }
  function pointCtl(c, p, o = {}) {
    const w = document.createElement('span'); w.style.cssText = 'display:inline-flex;gap:8px';
    const mk = i => GW.scrub({ get: () => GW.pv(p, lt(c))[i], set: (v, fin) => { const cur = GW.clone(GW.pv(p, lt(c))); cur[i] = v; GW.setPv(p, clamp(lt(c), 0, c.dur), cur); GW.invalidate(); if (fin) { GW.commit('تعديل خاصية'); F.render(); } else F.drawKeys(); }, step: o.step || 1, dec: o.dec ?? 1 });
    w.append(mk(0), mk(1)); return w;
  }
  function colorCtl(c, p) { const i = document.createElement('input'); i.type = 'color'; i.value = GW.pv(p, lt(c)); i.oninput = () => { GW.setPv(p, clamp(lt(c), 0, c.dur), i.value); commitSoon('لون'); }; return i; }
  function boolCtl(c, p) { const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!GW.pv(p, lt(c)); i.onchange = () => { GW.setPv(p, lt(c), i.checked ? 1 : 0); GW.commit('تعديل'); }; return i; }
  function selectCtl(c, p, opts) { const s = document.createElement('select'); s.className = 'sel'; for (const [v, n] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = n; s.append(o); } s.value = GW.pv(p, lt(c)); s.onchange = () => { GW.setPv(p, lt(c), s.value); GW.commit('تعديل'); }; return s; }
  function section(title, opts = {}) {
    const sec = document.createElement('div'); sec.className = 'fx-sec';
    const h = document.createElement('div'); h.className = 'fx-h' + (F.open[opts.key] === false ? ' closed' : '') + (opts.selected ? ' sel' : '');
    h.innerHTML = `<button class="tw">${GW.ico('down', 12)}</button><span class="fxbadge ${opts.off ? 'off' : ''}">fx</span><span class="fxn">${esc(title)}</span>`;
    const body = document.createElement('div'); body.hidden = F.open[opts.key] === false;
    h.querySelector('.tw').onclick = () => { F.open[opts.key] = body.hidden; body.hidden = !body.hidden; h.classList.toggle('closed', body.hidden); F.drawKeys(); };
    if (opts.toggle) { const b = h.querySelector('.fxbadge'); b.style.cursor = 'pointer'; b.title = 'تفعيل/تعطيل التأثير'; b.onclick = opts.toggle; }
    if (opts.tools) { for (const t of opts.tools) { const b = document.createElement('button'); b.className = 'btn sm ico ghost'; b.innerHTML = t.icon; b.title = t.title; b.onclick = (e) => { e.stopPropagation(); t.action(e); }; h.append(b); } }
    if (opts.menu) h.addEventListener('contextmenu', e => { e.preventDefault(); GW.menu(e.clientX, e.clientY, opts.menu()); });
    sec.append(h, body); sec.body = body; return sec;
  }

  /* ---------- render ---------- */
  F.render = () => {
    if (!F.left) return; const L = F.left; const sc = L.scrollTop; L.innerHTML = ''; F.rows = [];
    const s = GW.seq();
    if (GW.sel.trans) { const tr = s.trans.find(x => x.id === GW.sel.trans); if (tr) { renderTrans(L, s, tr); F.drawKeys(); return; } }
    const c = sel1();
    if (!c) { L.innerHTML = `<div class="fxc-hdr"><b>لا يوجد مقطع محدد</b></div><div class="empty">حدد مقطعًا في الخط الزمني لعرض خصائصه وتأثيراته هنا.<br>اسحب التأثيرات من لوحة «التأثيرات» وأفلتها على المقطع.</div>`; F.drawKeys(); return; }
    const hdr = document.createElement('div'); hdr.className = 'fxc-hdr'; hdr.innerHTML = `<b>${esc(GW.seq().name)} · ${esc(c.name)}</b>`; L.append(hdr);
    if (c.tt === 'v') {
      const vh = document.createElement('div'); vh.className = 'fxc-hdr'; vh.style.cssText = 'position:static;color:var(--mute);height:22px'; vh.textContent = 'تأثيرات الفيديو'; L.append(vh);
      if (c.kind === 'camera') { cameraSections(L, c, s); L.scrollTop = sc; F.drawKeys(); return; }
      // motion
      const m = c.motion; const ms = section('الحركة', { key: 'motion' });
      const td = GW.X.is3D(c); if (td) GW.X.ensure3D(c);
      if (c.kind !== 'adjust') {
        const tb = document.createElement('input'); tb.type = 'checkbox'; tb.checked = td; tb.dataset.a = 'td'; tb.onchange = () => { if (tb.checked) { c.td = 1; GW.X.ensure3D(c); } else delete c.td; GW.commit(tb.checked ? 'تفعيل الطبقة ثلاثية الأبعاد' : 'إلغاء الطبقة ثلاثية الأبعاد'); GW.invalidate(); F.render(); };
        ms.body.append(row(c, null, 'طبقة ثلاثية الأبعاد', tb, { noAnim: true }));
        ms.body.append(row(c, null, 'الأصل (Parent)', parentCtl(c, s), { noAnim: true }));
      }
      ms.body.append(row(c, m.pos, 'الموضع', pointCtl(c, m.pos), { def: [s.w / 2, s.h / 2] }));
      if (td) ms.body.append(row(c, m.posZ, 'الموضع Z', numCtl(c, m.posZ, { step: 1 }), { def: 0 }));
      ms.body.append(row(c, m.scale, m.uni ? 'المقياس' : 'الارتفاع', numCtl(c, m.scale, { min: -2000, max: 5000, step: .5, unit: '' }), { def: c.kind === 'video' || c.kind === 'image' ? GW.pv(m.scale, 0) : 100 }));
      if (!m.uni) ms.body.append(row(c, m.scaleW, 'العرض', numCtl(c, m.scaleW, { min: -2000, max: 5000, step: .5 }), { def: 100 }));
      const uni = document.createElement('label'); uni.style.cssText = 'display:inline-flex;gap:5px;align-items:center'; const ub = document.createElement('input'); ub.type = 'checkbox'; ub.checked = !!m.uni; ub.onchange = () => { m.uni = ub.checked ? 1 : 0; if (!m.uni) m.scaleW = GW.P(GW.pv(m.scale, lt(c))); GW.commit('مقياس موحد'); F.render(); }; uni.append(ub, document.createTextNode('موحّد'));
      ms.body.append(row(c, null, 'مقياس موحد', uni, { noAnim: true }));
      if (td) rot3Rows(ms, c, m); else ms.body.append(row(c, m.rot, 'الدوران', numCtl(c, m.rot, { step: .5, unit: '°' }), { def: 0 }));
      ms.body.append(row(c, m.anchor, 'نقطة الارتكاز', pointCtl(c, m.anchor), { def: [c.sw / 2, c.sh / 2] }));
      if (GW.Track) GW.Track.fxcMotion(ms, c, row);
      if (td) ms.body.append(row(c, m.anchorZ, 'نقطة الارتكاز Z', numCtl(c, m.anchorZ, { step: 1 }), { def: 0 }));
      L.append(ms);
      if (c.kind === 'null') { L.scrollTop = sc; F.drawKeys(); return; }
      // opacity + masks
      const os = section('الشفافية', { key: 'opacity', tools: [
        { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>', title: 'قناع بيضاوي', action: () => addMask(c, 'ellipse') },
        { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12"/></svg>', title: 'قناع مستطيل', action: () => addMask(c, 'rect') },
        { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18l5-12 6 8 5-6"/><circle cx="4" cy="18" r="1.5"/><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="14" r="1.5"/></svg>', title: 'قناع بالقلم (انقر على الشاشة لإضافة نقاط)', action: () => addMask(c, 'path') }] });
      for (const mk of (c.masks || [])) os.body.append(maskBlock(c, mk));
      os.body.append(row(c, c.opacity, 'الشفافية', numCtl(c, c.opacity, { min: 0, max: 100, step: .5, unit: '%' }), { def: 100 }));
      const bm = document.createElement('select'); bm.className = 'sel'; for (const [v, n] of GW.BLENDS) { const o = document.createElement('option'); o.value = v; o.textContent = n; bm.append(o); } bm.value = c.blend || 'normal'; bm.onchange = () => { c.blend = bm.value; GW.commit('وضع المزج'); };
      os.body.append(row(c, null, 'وضع المزج', bm, { noAnim: true }));
      L.append(os);
      // speed info
      const ts = section('إعادة تعيين الزمن', { key: 'time' });
      const sp = document.createElement('span'); sp.style.cssText = 'display:inline-flex;gap:8px;align-items:center'; sp.innerHTML = `<span class="scrub" style="cursor:pointer">${Math.round((c.speed || 1) * 100)}%</span>`; sp.firstChild.onclick = () => GW.cmd.speed();
      ts.body.append(row(c, null, 'السرعة', sp, { noAnim: true })); ts.body.hidden = F.open.time !== true; ts.firstChild.classList.toggle('closed', ts.body.hidden); if (F.open.time === undefined) { F.open.time = false; }
      L.append(ts);
      // generator-specific
      if (c.kind === 'color') { const cs = section('اللون الثابت', { key: 'color' }); const ci = document.createElement('input'); ci.type = 'color'; ci.value = c.color; ci.oninput = () => { c.color = ci.value; commitSoon('لون'); }; cs.body.append(row(c, null, 'اللون', ci, { noAnim: true })); L.append(cs); }
      if (c.kind === 'text') { const ts2 = section('النص', { key: 'text' }); const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = 'تحرير في الرسومات الأساسية'; b.onclick = () => GW.showPanel('graphics'); ts2.body.append(row(c, null, 'المحتوى', b, { noAnim: true })); L.append(ts2); }
      if (c.kind === 'map') {
        const ms2 = section('الخريطة الحربية', { key: 'map' }); const b = document.createElement('button'); b.className = 'btn sm pri'; b.textContent = 'فتح لوحة الخرائط'; b.style.cssText = 'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; b.onclick = () => GW.UI.openMapEditor(c);
        ms2.body.append(row(c, null, 'المشهد', b, { noAnim: true }));
        const bg = document.createElement('select'); bg.className = 'sel'; for (const [v, n] of [['full', 'الخريطة كاملة'], ['globe', 'بدون الفضاء (شفاف)'], ['overlay', 'التأثيرات فقط (شفاف)']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; bg.append(o); }
        bg.value = (c.map && c.map.bg) || 'full'; bg.onchange = () => { c.map.bg = bg.value; GW.commit('خلفية الخريطة'); };
        ms2.body.append(row(c, null, 'الخلفية', bg, { noAnim: true })); L.append(ms2);
      }
      // effect stack
      (c.fx || []).forEach((fx, i) => L.append(fxBlock(c, fx, i, 'v')));
    }
    if (c.tt === 'a' || c.vol) {
      const target = c.tt === 'a' ? c : (GW.linked(s, c).find(x => x.tt === 'a') || null);
      if (target && target.vol) {
        const ah = document.createElement('div'); ah.className = 'fxc-hdr'; ah.style.cssText = 'position:static;color:var(--mute);height:22px'; ah.textContent = 'تأثيرات الصوت' + (target !== c ? ' (المقطع المرتبط)' : ''); L.append(ah);
        const vs = section('مستوى الصوت', { key: 'vol' }); vs.body.append(row(target, target.vol, 'المستوى', numCtl(target, target.vol, { min: -60, max: 15, step: .1, unit: ' dB' }), { def: 0 })); L.append(vs);
        const ps = section('التوازن (Pan)', { key: 'pan' }); ps.body.append(row(target, target.pan, 'التوازن', numCtl(target, target.pan, { min: -100, max: 100, step: .5 }), { def: 0 })); L.append(ps);
        (target.afx || []).forEach((fx, i) => L.append(fxBlock(target, fx, i, 'a')));
        const fb = document.createElement('div'); fb.className = 'mask-row'; const b1 = document.createElement('button'); b1.className = 'btn sm'; b1.textContent = 'تلاشي دخول'; b1.onclick = () => fade(target, 'in'); const b2 = document.createElement('button'); b2.className = 'btn sm'; b2.textContent = 'تلاشي خروج'; b2.onclick = () => fade(target, 'out'); fb.append(b1, b2); L.append(fb);
      }
    }
    L.scrollTop = sc; F.drawKeys();
  };
  /* ---------- 3D layers / camera / parenting ---------- */
  function rot3Rows(sec, c, m) {
    const a = (p, n) => sec.body.append(row(c, p, n, numCtl(c, p, { step: .5, unit: '°' }), { def: 0 }));
    a(m.oriX, 'الاتجاه X'); a(m.oriY, 'الاتجاه Y'); a(m.oriZ, 'الاتجاه Z'); a(m.rotX, 'الدوران X'); a(m.rotY, 'الدوران Y'); a(m.rot, 'الدوران Z');
  }
  // pick-whip equivalent: any visual clip on another track (descendants excluded → no cycles)
  function parentCtl(c, s) {
    const sl = document.createElement('select'); sl.className = 'sel'; sl.dataset.a = 'parent';
    const add = (v, n) => { const o = document.createElement('option'); o.value = v; o.textContent = n; sl.append(o); };
    add('', 'بلا أصل');
    const list = s.clips.filter(x => x.tt === 'v' && x.motion && x !== c && (x.ti !== c.ti || x.id === c.parent) && !GW.X.isDescendant(s, x, c.id)).sort((a, b) => b.ti - a.ti || a.start - b.start);
    for (const x of list) add(x.id, 'V' + (x.ti + 1) + ' · ' + x.name + (x.kind === 'null' ? ' (فارغة)' : x.kind === 'camera' ? ' (كاميرا)' : ''));
    sl.value = c.parent && list.some(x => x.id === c.parent) ? c.parent : '';
    sl.onchange = () => { if (GW.X.setParent(c, sl.value || null, s)) { GW.commit('تعيين الأصل'); GW.invalidate(); } else GW.toast('لا يمكن ربط الطبقة بهذا الأصل (حلقة ربط)'); F.render(); };
    return sl;
  }
  function cameraSections(L, c, s) {
    const m = c.motion, cm = c.cam || (c.cam = { type: 'two', poi: GW.P([s.w / 2, s.h / 2]), poiZ: GW.P(0), zoom: GW.P(GW.X.defaultZoom(s)), dof: 0, focus: GW.P(GW.X.defaultZoom(s)), aperture: GW.P(25.3), blurLvl: GW.P(100) });
    GW.X.ensure3D(c);
    const os = section('الكاميرا', { key: 'camtype' });
    const ty = document.createElement('select'); ty.className = 'sel'; ty.dataset.a = 'camtype';
    for (const [v, n] of [['two', 'نقطتان (نقطة اهتمام)'], ['one', 'نقطة واحدة']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; ty.append(o); }
    ty.value = cm.type === 'one' ? 'one' : 'two'; ty.onchange = () => { cm.type = ty.value; GW.commit('نوع الكاميرا'); GW.invalidate(); F.render(); };
    os.body.append(row(c, null, 'نوع الكاميرا', ty, { noAnim: true }));
    os.body.append(row(c, null, 'الأصل (Parent)', parentCtl(c, s), { noAnim: true }));
    L.append(os);
    const xs = section('التحويل', { key: 'camxf' });
    if (cm.type !== 'one') { xs.body.append(row(c, cm.poi, 'نقطة الاهتمام', pointCtl(c, cm.poi), { def: [s.w / 2, s.h / 2] })); xs.body.append(row(c, cm.poiZ, 'نقطة الاهتمام Z', numCtl(c, cm.poiZ), { def: 0 })); }
    xs.body.append(row(c, m.pos, 'الموضع', pointCtl(c, m.pos), { def: [s.w / 2, s.h / 2] }));
    xs.body.append(row(c, m.posZ, 'الموضع Z', numCtl(c, m.posZ), { def: -Math.round(GW.X.defaultZoom(s) * 10) / 10 }));
    rot3Rows(xs, c, m); L.append(xs);
    const co = section('خيارات الكاميرا', { key: 'camopt' });
    co.body.append(row(c, cm.zoom, 'التكبير (Zoom)', numCtl(c, cm.zoom, { min: 1, max: 100000, step: 1, unit: ' px' }), { def: Math.round(GW.X.defaultZoom(s) * 10) / 10 }));
    const fl = document.createElement('span'); fl.style.color = 'var(--mute)'; fl.textContent = (GW.pv(cm.zoom, lt(c)) * 54 / s.w).toFixed(1) + ' مم';
    co.body.append(row(c, null, 'البعد البؤري', fl, { noAnim: true }));
    const db = document.createElement('input'); db.type = 'checkbox'; db.checked = !!cm.dof; db.dataset.a = 'dof'; db.onchange = () => { cm.dof = db.checked ? 1 : 0; GW.commit('عمق الميدان'); GW.invalidate(); };
    co.body.append(row(c, null, 'عمق الميدان', db, { noAnim: true }));
    co.body.append(row(c, cm.focus, 'مسافة التركيز', numCtl(c, cm.focus, { min: 1, max: 100000, step: 1, unit: ' px' }), { def: Math.round(GW.X.defaultZoom(s) * 10) / 10 }));
    co.body.append(row(c, cm.aperture, 'فتحة العدسة', numCtl(c, cm.aperture, { min: 0, max: 2000, step: .5, unit: ' px' }), { def: 25.3 }));
    co.body.append(row(c, cm.blurLvl, 'مستوى الضبابية', numCtl(c, cm.blurLvl, { min: 0, max: 1000, step: 1, unit: '%' }), { def: 100 }));
    L.append(co);
  }
  function fade(c, dir) {
    const d = Math.min(1, c.dur / 3); const v0 = GW.pv(c.vol, 0);
    if (!c.vol.k) c.vol.k = [];
    if (dir === 'in') { c.vol.k = c.vol.k.filter(k => k.t > d + 1e-3); c.vol.k.push({ t: 0, v: -60, e: 'linear' }, { t: d, v: v0, e: 'linear' }); }
    else { c.vol.k = c.vol.k.filter(k => k.t < c.dur - d - 1e-3); c.vol.k.push({ t: c.dur - d, v: v0, e: 'linear' }, { t: c.dur, v: -60, e: 'linear' }); }
    c.vol.k.sort((a, b) => a.t - b.t); GW.commit('تلاشي الصوت'); F.render();
  }
  function fxBlock(c, fx, i, grp) {
    const def = (grp === 'a' ? GW.AFX : GW.FX)[fx.type]; if (!def) return document.createElement('div');
    const list = grp === 'a' ? c.afx : c.fx;
    const sec = section(def.n, { key: fx.id, off: !fx.on, toggle: () => { fx.on = fx.on ? 0 : 1; GW.commit(fx.on ? 'تفعيل تأثير' : 'تعطيل تأثير'); F.render(); },
      tools: [{ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>', title: 'حذف التأثير', action: () => { list.splice(list.indexOf(fx), 1); GW.commit('حذف تأثير'); F.render(); } }],
      menu: () => [{ label: 'تحريك للأعلى', disabled: i === 0, action: () => { list.splice(i, 1); list.splice(i - 1, 0, fx); GW.commit('ترتيب التأثيرات'); F.render(); } }, { label: 'تحريك للأسفل', disabled: i === list.length - 1, action: () => { list.splice(i, 1); list.splice(i + 1, 0, fx); GW.commit('ترتيب التأثيرات'); F.render(); } }, { label: 'تكرار', action: () => { const d = GW.clone(fx); d.id = GW.uid(); list.splice(i + 1, 0, d); GW.commit('تكرار تأثير'); F.render(); } }, { label: 'إعادة ضبط كل القيم', action: () => { const n = GW.newFx(fx.type, grp); fx.params = n.params; GW.commit('إعادة الضبط'); F.render(); } }, '-', { label: 'حذف', action: () => { list.splice(list.indexOf(fx), 1); GW.commit('حذف تأثير'); F.render(); } }] });
    for (const p of def.p) {
      if (p.lut) continue; // LUT intensities live next to their pickers (lut.js)
      const P = fx.params[p.k] || (fx.params[p.k] = GW.P(GW.clone(p.def)));
      let ctl;
      if (p.t === 'num') ctl = numCtl(c, P, { min: p.min, max: p.max, step: Math.max(p.step, (p.max - p.min) / 400), unit: p.unit, dec: p.step < 1 ? 2 : 1 });
      else if (p.t === 'color') ctl = colorCtl(c, P);
      else if (p.t === 'bool') ctl = boolCtl(c, P);
      else if (p.t === 'select') ctl = selectCtl(c, P, p.opts);
      else if (p.t === 'point') ctl = pointCtl(c, P, { step: .005, dec: 3 });
      sec.body.append(row(c, P, p.n, ctl, { def: p.def, noAnim: p.t === 'select' || p.t === 'bool' }));
    }
    if (fx.type === 'lumetri' && GW.LUT) GW.LUT.fxcRows(sec, c, fx, row, numCtl);
    return sec;
  }
  function addMask(c, type) {
    const s = GW.seq(); const w = c.sw || s.w, h = c.sh || s.h;
    const mk = { id: GW.uid(), type, on: 1, mode: 'add', inv: 0, feather: GW.P(type === 'path' ? 10 : 30), opacity: GW.P(100), expansion: GW.P(0) };
    if (type === 'path') mk.pts = GW.P([]); else { mk.center = GW.P([w / 2, h / 2]); mk.size = GW.P([w * .5, h * .5]); mk.rot = GW.P(0); }
    c.masks = c.masks || []; c.masks.push(mk); GW.sel.mask = { clip: c.id, id: mk.id };
    if (type === 'path') { GW.TL.setTool('pen'); GW.toast('انقر على شاشة البرنامج لإضافة نقاط القناع، ثم ارجع لأداة التحديد (V)'); }
    GW.commit('إضافة قناع'); F.render();
  }
  function maskBlock(c, mk) {
    const box = document.createElement('div'); const isSel = GW.sel.mask && GW.sel.mask.id === mk.id;
    const sec = section(({ ellipse: 'قناع بيضاوي', rect: 'قناع مستطيل', path: 'قناع حر' })[mk.type] + ' (' + (c.masks.indexOf(mk) + 1) + ')', { key: mk.id, selected: isSel, off: mk.on === 0, toggle: () => { mk.on = mk.on === 0 ? 1 : 0; GW.commit('تفعيل القناع'); F.render(); },
      tools: [{ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>', title: 'حذف القناع', action: () => { c.masks = c.masks.filter(x => x !== mk); GW.sel.mask = null; GW.commit('حذف قناع'); F.render(); } }] });
    sec.firstChild.addEventListener('click', e => { if (e.target.closest('button')) return; GW.sel.mask = isSel ? null : { clip: c.id, id: mk.id }; F.render(); GW.invalidate(); });
    if (mk.type === 'path') sec.body.append(row(c, mk.pts, 'مسار القناع', document.createTextNode((GW.pv(mk.pts, lt(c)) || []).length + ' نقطة'), {}));
    else { sec.body.append(row(c, mk.center, 'المركز', pointCtl(c, mk.center), {})); sec.body.append(row(c, mk.size, 'الحجم', pointCtl(c, mk.size), {})); sec.body.append(row(c, mk.rot, 'الدوران', numCtl(c, mk.rot, { unit: '°' }), { def: 0 })); }
    sec.body.append(row(c, mk.feather, 'تنعيم الحافة', numCtl(c, mk.feather, { min: 0, max: 1000 }), { def: 10 }));
    sec.body.append(row(c, mk.opacity, 'شفافية القناع', numCtl(c, mk.opacity, { min: 0, max: 100, unit: '%' }), { def: 100 }));
    sec.body.append(row(c, mk.expansion, 'التوسيع', numCtl(c, mk.expansion, { min: -1000, max: 1000 }), { def: 0 }));
    const inv = document.createElement('input'); inv.type = 'checkbox'; inv.checked = !!mk.inv; inv.onchange = () => { mk.inv = inv.checked ? 1 : 0; GW.commit('عكس القناع'); };
    sec.body.append(row(c, null, 'عكس', inv, { noAnim: true }));
    const md = document.createElement('select'); md.className = 'sel'; for (const [v, n] of [['add', 'إضافة'], ['sub', 'طرح'], ['inter', 'تقاطع']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; md.append(o); } md.value = mk.mode || 'add'; md.onchange = () => { mk.mode = md.value; GW.commit('وضع القناع'); };
    sec.body.append(row(c, null, 'الوضع', md, { noAnim: true }));
    if (GW.Track) GW.Track.fxcMask(sec, c, mk, row);
    box.append(sec); return box;
  }
  function renderTrans(L, s, tr) {
    const def = (tr.tt === 'a' ? GW.ATRANS : GW.TRANS)[tr.kind] || { n: tr.kind };
    L.innerHTML = `<div class="fxc-hdr"><b>انتقال: ${esc(def.n)}</b></div>`;
    const f = document.createElement('div'); f.className = 'form';
    const kind = document.createElement('select'); kind.className = 'sel'; for (const [k, v] of Object.entries(tr.tt === 'a' ? GW.ATRANS : GW.TRANS)) { const o = document.createElement('option'); o.value = k; o.textContent = v.n; kind.append(o); } kind.value = tr.kind; kind.onchange = () => { tr.kind = kind.value; GW.commit('نوع الانتقال'); F.render(); };
    const dur = GW.scrub({ get: () => tr.dur, set: (v, fin) => { tr.dur = clamp(v, 2 / s.fps, 30); GW.invalidate(); GW.TL.invalidate(); if (fin) GW.commit('مدة الانتقال'); }, step: .02, dec: 2, unit: ' ث' });
    const al = document.createElement('select'); al.className = 'sel'; for (const [v, n] of [['center', 'في المنتصف'], ['start', 'تبدأ عند القطع'], ['end', 'تنتهي عند القطع']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; al.append(o); } al.value = tr.align || 'center'; al.onchange = () => { tr.align = al.value; GW.commit('محاذاة الانتقال'); };
    const mk = (l, el) => { const r = document.createElement('div'); r.className = 'frow'; r.innerHTML = `<label>${l}</label>`; const ctl = document.createElement('div'); ctl.className = 'ctl'; ctl.append(el); r.append(ctl); return r; };
    f.append(mk('النوع', kind), mk('المدة', dur), mk('المحاذاة', al));
    const del = document.createElement('button'); del.className = 'btn'; del.textContent = 'حذف الانتقال'; del.onclick = () => { s.trans = s.trans.filter(x => x !== tr); GW.sel.trans = null; GW.commit('حذف انتقال'); F.render(); };
    f.append(del); L.append(f);
  }

  /* ---------- keyframe lane ---------- */
  F.drawKeys = () => {
    const cv = F.kc; if (!cv || !cv.isConnected) return; const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1; if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const c = sel1(); if (!c || !F.rows.length) return;
    const s = GW.seq(); const pad = 8; const X = t => pad + (t / Math.max(c.dur, .001)) * (w - pad * 2);
    F.X = X; F.T = x => (x - pad) / (w - pad * 2) * c.dur;
    g.fillStyle = '#262626'; g.fillRect(X(0), 0, X(c.dur) - X(0), 22);
    g.fillStyle = c.label; g.globalAlpha = .6; g.fillRect(X(0), 4, X(c.dur) - X(0), 14); g.globalAlpha = 1; g.fillStyle = '#fff'; g.font = '10px "IBM Plex Sans Arabic", sans-serif'; g.fillText(c.name, X(0) + 4, 15, X(c.dur) - X(0) - 8);
    const base = F.right.getBoundingClientRect().top; F.keyHits = [];
    for (const r of F.rows) {
      if (!r.isConnected || r.offsetParent === null) continue; const rb = r.getBoundingClientRect(); const y = rb.top - base + rb.height / 2; if (y < 22 || y > h) continue;
      g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(0, rb.top - base, w, rb.height);
      const p = r._p; const cc = r._c; if (!p || !p.k) continue;
      const Xr = t => pad + (t / Math.max(cc.dur, .001)) * (w - pad * 2);
      for (const k of p.k) { const x = Xr(k.t); const sel = F.selKey === k; g.fillStyle = sel ? '#5aa9ff' : '#d7d7d7'; g.beginPath(); if (k.e === 'hold') { g.rect(x - 4, y - 4, 8, 8); } else if (k.e === 'ease' || k.e === 'easeIn' || k.e === 'easeOut') { g.arc(x, y, 4.5, 0, 7); } else { g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.closePath(); } g.fill(); F.keyHits.push({ x, y, k, p, c: cc }); }
    }
    drawGraphs(g, w, h, base, pad);
    const px = X(s.t - c.start); if (px >= 0 && px <= w) { g.fillStyle = '#2f8ef0'; g.fillRect(px - 1, 0, 2, h); }
  };
  function initKeyLane() {
    const el = F.right;
    el.addEventListener('pointerdown', e => {
      const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const c = sel1(); if (!c) return;
      const hk = (F.keyHits || []).find(k => Math.abs(k.x - x) < 6 && Math.abs(k.y - y) < 7);
      if (hk) {
        F.selKey = hk.k; F.drawKeys(); el.setPointerCapture(e.pointerId); const t0 = hk.k.t; const x0 = x;
        el.onpointermove = ev => { const xx = ev.clientX - r.left; const dt = (xx - x0) / (r.width - 16) * hk.c.dur; hk.k.t = clamp(GW.snapFrame(t0 + dt, GW.seq().fps), 0, hk.c.dur); hk.p.k.sort((a, b) => a.t - b.t); GW.invalidate(); F.drawKeys(); };
        el.onpointerup = () => { el.onpointermove = null; GW.commit('تحريك مفتاح'); };
        return;
      }
      F.selKey = null; el.setPointerCapture(e.pointerId);
      const f = ev => { const xx = ev.clientX - r.left; GW.seek(c.start + clamp(F.T ? F.T(xx) : 0, 0, c.dur)); };
      f(e); el.onpointermove = f; el.onpointerup = () => { el.onpointermove = null; };
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      const hk = (F.keyHits || []).find(k => Math.abs(k.x - x) < 6 && Math.abs(k.y - y) < 7); if (!hk) return;
      const set = (v) => { hk.k.e = v; delete hk.k.bi; delete hk.k.bo; GW.commit('نوع الاستيفاء'); GW.invalidate(); F.drawKeys(); };
      GW.menu(e.clientX, e.clientY, [['linear', 'خطي'], ['ease', 'تسهيل (Bezier)'], ['easeIn', 'تسهيل الدخول'], ['easeOut', 'تسهيل الخروج'], ['hold', 'ثبات']].map(([v, n]) => ({ label: n, cmd: EASE_CMD[v], check: (hk.k.e || 'linear') === v && !hk.k.bi && !hk.k.bo, action: () => set(v) })).concat(['-', ...graphMenu(hk), '-', { label: 'حذف المفتاح', action: () => { hk.p.k = hk.p.k.filter(k => k !== hk.k); if (!hk.p.k.length) { hk.p.v = hk.k.v; delete hk.p.k; } GW.commit('حذف مفتاح'); F.render(); } }]));
    });
    el.addEventListener('keydown', e => { if ((e.key === 'Delete' || e.key === 'Backspace') && F.selKey) { e.stopPropagation(); } });
  }

  /* ---------- graph editor (محرر المنحنيات): value / speed graph under a keyframed property ---------- */
  // Drawn in the keyframe lane (time-aligned with the diamonds); bezier handles are stored per key (k.bo / k.bi, see util.js).
  const EASE_CMD = { ease: 'gfx.easyEase', easeIn: 'gfx.easeIn', easeOut: 'gfx.easeOut', hold: 'gfx.keyHold', linear: 'gfx.keyLinear' };
  F.gopen = {}; F.gmode = {}; F.graphHits = [];
  const GRAPH_ICO = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 19c7 0 7-14 18-14"/><circle cx="3" cy="19" r="1.6" fill="currentColor"/><circle cx="21" cy="5" r="1.6" fill="currentColor"/></svg>';
  const chans = v => typeof v === 'number' ? [v] : (Array.isArray(v) && v.length && v.every(x => typeof x === 'number')) ? v : (typeof v === 'string' && /^#[0-9a-f]{3,6}$/i.test(v)) ? GW.hex2rgb(v) : null;
  const graphable = p => !!(p && p.k && p.k.length >= 2 && chans(p.k[0].v));
  function graphTwirl(r, c, p, nm, opts) {
    if (!p || opts.noAnim || !graphable(p)) return;
    const key = c.id + '|' + (F.rows.length - 1) + '|' + nm.textContent; r._gk = key;
    const b = document.createElement('button'); b.className = 'fxg-tw' + (F.gopen[key] ? ' on' : ''); b.innerHTML = GRAPH_ICO; b.title = 'محرر المنحنيات (القيمة / السرعة)';
    b.onclick = (e) => { e.stopPropagation(); F.gopen[key] = !F.gopen[key]; F.render(); };
    nm.prepend(b);
    if (!F.gopen[key]) return;
    const gd = document.createElement('div'); gd.className = 'fxg'; const mode = F.gmode[key] || 'value';
    gd.innerHTML = `<div class="fxg-bar"><div class="seg"><button data-m="value" class="${mode === 'value' ? 'on' : ''}">القيمة</button><button data-m="speed" class="${mode === 'speed' ? 'on' : ''}">السرعة</button></div></div><div class="fxg-info">اسحب مقابض المنحنى في المسار الزمني لضبط التسارع والتباطؤ</div>`;
    gd.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { F.gmode[key] = x.dataset.m; gd.querySelectorAll('[data-m]').forEach(y => y.classList.toggle('on', y === x)); F.drawKeys(); });
    const bar = gd.querySelector('.fxg-bar');
    for (const [v, n] of [['linear', 'خطي'], ['ease', 'تسهيل'], ['easeIn', 'دخول'], ['easeOut', 'خروج'], ['hold', 'ثبات']]) { const x = document.createElement('button'); x.className = 'btn sm ghost'; x.textContent = n; x.title = 'تطبيق على كل مفاتيح الخاصية'; x.onclick = () => { for (const k of p.k) { k.e = v; delete k.bi; delete k.bo; } GW.commit('نوع الاستيفاء'); GW.invalidate(); F.drawKeys(); }; bar.append(x); }
    r._g = gd; gd._r = r;
  }
  const render0 = F.render;
  F.render = () => { render0(); let any = false; for (const r of F.rows) if (r._g && r.isConnected) { r.after(r._g); any = true; } if (any) F.drawKeys(); };
  function accent() { return (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#ff6a2b').trim() || '#ff6a2b'; }
  function drawGraphs(g, w, h, base, pad) {
    F.graphHits = [];
    for (const r of F.rows) {
      const G = r._g; if (!G || !G.isConnected || G.offsetParent === null) continue;
      const p = r._p, c = r._c; if (!graphable(p)) continue;
      const gb = G.getBoundingClientRect(); const top = gb.top - base, bot = gb.bottom - base; if (bot < 22 || top > h) continue;
      const y0 = top + 10, y1 = bot - 10, mode = F.gmode[r._gk] || 'value';
      const Xr = t => pad + (t / Math.max(c.dur, .001)) * (w - pad * 2), Tr = x => (x - pad) / (w - pad * 2) * c.dur;
      g.save(); g.beginPath(); g.rect(0, Math.max(22, top), w, bot - Math.max(22, top)); g.clip();
      g.fillStyle = '#171717'; g.fillRect(0, top, w, bot - top); g.strokeStyle = '#262626'; g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { const y = Math.round(y0 + (y1 - y0) * i / 4) + .5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      const N = Math.max(40, Math.min(600, Math.round(w))); const ts = []; for (let i = 0; i <= N; i++) ts.push(c.dur * i / N);
      const nC = chans(p.k[0].v).length; const ACC = accent(); const COLS = nC === 1 ? [ACC] : ['#e8574a', '#5ec46a', '#4f9df7', '#d6c04a'];
      const val = t => chans(GW.pv(p, t));
      const segs = []; for (let i = 0; i < p.k.length - 1; i++) segs.push([p.k[i], p.k[i + 1]]);
      if (mode === 'value') {
        const S = ts.map(val); const lo = [], hi = [];
        for (let ci = 0; ci < nC; ci++) { let a = Infinity, b = -Infinity; for (const v of S) { a = Math.min(a, v[ci]); b = Math.max(b, v[ci]); } for (const k of p.k) { const v = chans(k.v)[ci]; a = Math.min(a, v); b = Math.max(b, v); } if (b - a < 1e-9) { a -= 1; b += 1; } const m = (b - a) * .08; lo.push(a - m); hi.push(b + m); }
        const Y = (ci, v) => y1 - (v - lo[ci]) / (hi[ci] - lo[ci]) * (y1 - y0), Yi = (ci, y) => lo[ci] + (y1 - y) / (y1 - y0) * (hi[ci] - lo[ci]);
        for (let ci = 0; ci < nC; ci++) { g.strokeStyle = COLS[ci % COLS.length]; g.lineWidth = 1.6; g.beginPath(); S.forEach((v, i) => { const x = Xr(ts[i]), y = Y(ci, v[ci]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
        g.fillStyle = '#8a8a8a'; g.font = '10px "JetBrains Mono", monospace'; if (nC === 1) { g.fillText(String(+hi[0].toFixed(1)), 4, y0 + 9); g.fillText(String(+lo[0].toFixed(1)), 4, y1 - 2); }
        for (const [A, B] of segs) {
          if (A.e === 'hold') continue; const a = chans(A.v), b = chans(B.v); let ci = 0, best = -1; for (let i = 0; i < nC; i++) { const d = Math.abs(b[i] - a[i]) / (hi[i] - lo[i]); if (d > best) { best = d; ci = i; } }
          const d = b[ci] - a[ci], flat = Math.abs(d) < 1e-9, yA = Y(ci, a[ci]);
          const segY = f => flat ? yA - f * 40 : Y(ci, a[ci] + f * d), segF = y => flat ? (yA - y) / 40 : (Yi(ci, y) - a[ci]) / d;
          handles(g, A, B, ACC, Xr, segY, (hk, x, y) => F.graphHits.push({ kind: hk, x, y, A, B, c, p, mode, Tr, segF }));
        }
        for (const k of p.k) keyDot(g, Xr(k.t), Y(0, chans(k.v)[0]), k, p, c);
      } else {
        const dt = c.dur / N / 4; const sp = ts.map(t => { const a = val(Math.max(0, t - dt)), b = val(Math.min(c.dur, t + dt)); return Math.hypot(...a.map((x, i) => b[i] - x)) / (Math.min(c.dur, t + dt) - Math.max(0, t - dt)); });
        const mags = segs.map(([A, B]) => Math.hypot(...chans(A.v).map((x, i) => chans(B.v)[i] - x)) / Math.max(1e-6, B.t - A.t));
        let mx = Math.max(1e-6, ...sp); for (let i = 0; i < segs.length; i++) { const H = GW.keyHandles(...segs[i]); mx = Math.max(mx, H[1] / Math.max(H[0], 1e-3) * mags[i], (1 - H[3]) / Math.max(1 - H[2], 1e-3) * mags[i]); } mx = Math.min(mx, Math.max(...sp) * 4 + 1e-6) * 1.12;
        const Ys = v => y1 - Math.min(v, mx) / mx * (y1 - y0), Ysi = y => (y1 - y) / (y1 - y0) * mx;
        g.strokeStyle = ACC; g.lineWidth = 1.6; g.beginPath(); sp.forEach((v, i) => { const x = Xr(ts[i]), y = Ys(v); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
        g.fillStyle = '#8a8a8a'; g.font = '10px "JetBrains Mono", monospace'; g.fillText(String(+mx.toFixed(1)) + '/s', 4, y0 + 9); g.fillText('0', 4, y1 - 2);
        segs.forEach(([A, B], i) => {
          if (A.e === 'hold' || mags[i] < 1e-9) return; const H = GW.keyHandles(A, B), dtt = B.t - A.t, m = mags[i] * dtt;
          const pts = [['bo', Xr(A.t + H[0] * dtt), Ys(H[1] / Math.max(H[0], 1e-3) * mags[i]), Xr(A.t), Ys(H[1] / Math.max(H[0], 1e-3) * mags[i])], ['bi', Xr(A.t + H[2] * dtt), Ys((1 - H[3]) / Math.max(1 - H[2], 1e-3) * mags[i]), Xr(B.t), Ys((1 - H[3]) / Math.max(1 - H[2], 1e-3) * mags[i])]];
          for (const [kind, x, y, kx, ky] of pts) { g.strokeStyle = '#bdbdbd'; g.lineWidth = 1; g.beginPath(); g.moveTo(kx, ky); g.lineTo(x, y); g.stroke(); g.fillStyle = ACC; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); F.graphHits.push({ kind, x, y, A, B, c, p, mode, Tr, Ssi: Ysi, m }); }
        });
        for (const k of p.k) keyDot(g, Xr(k.t), y1 - 3, k, p, c);
      }
      g.restore();
    }
  }
  function handles(g, A, B, col, Xr, segY, hit) {
    const H = GW.keyHandles(A, B), dt = B.t - A.t;
    const P = [['bo', Xr(A.t + H[0] * dt), segY(H[1]), Xr(A.t), segY(0)], ['bi', Xr(A.t + H[2] * dt), segY(H[3]), Xr(B.t), segY(1)]];
    for (const [kind, x, y, kx, ky] of P) { g.strokeStyle = '#bdbdbd'; g.lineWidth = 1; g.beginPath(); g.moveTo(kx, ky); g.lineTo(x, y); g.stroke(); g.fillStyle = col; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); hit(kind, x, y); }
  }
  function keyDot(g, x, y, k, p, c) { g.fillStyle = F.selKey === k ? '#5aa9ff' : '#e6e6e6'; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.closePath(); g.fill(); (F.keyHits || (F.keyHits = [])).push({ x, y, k, p, c }); }
  function initGraph() {
    const el = F.right;
    el.addEventListener('pointerdown', e => {
      const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      const hh = (F.graphHits || []).find(q => Math.hypot(q.x - x, q.y - y) < 7); if (!hh) return;
      e.stopImmediatePropagation(); e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (er) {}
      const { A, B } = hh; const H0 = GW.keyHandles(A, B); if (!A.bo) A.bo = [H0[0], H0[1]]; if (!B.bi) B.bi = [1 - H0[2], 1 - H0[3]];
      const dt = B.t - A.t;
      const mv = ev => {
        const xx = ev.clientX - r.left, yy = ev.clientY - r.top; const t = hh.Tr(xx);
        const inf = hh.kind === 'bo' ? clamp((t - A.t) / dt, .01, 1) : clamp((B.t - t) / dt, .01, 1);
        const f = hh.mode === 'value' ? (hh.kind === 'bo' ? hh.segF(yy) : 1 - hh.segF(yy)) : Math.max(0, hh.Ssi(yy)) * inf * dt / Math.max(1e-9, hh.m); // speed graph: handle height = speed at the key
        const v = [Math.round(inf * 1e4) / 1e4, Math.round(f * 1e4) / 1e4]; if (hh.kind === 'bo') A.bo = v; else B.bi = v;
        GW.invalidate(); F.drawKeys(); GW.bus.emit('param');
      };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); GW.commit('تعديل منحنى الحركة'); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    }, true);
  }
  function graphMenu(hk) {
    const out = [];
    if (hk.k.bi || hk.k.bo) out.push({ label: 'إعادة ضبط مقابض المنحنى', action: () => { delete hk.k.bi; delete hk.k.bo; GW.commit('نوع الاستيفاء'); GW.invalidate(); F.drawKeys(); } });
    const r = F.rows.find(x => x._p === hk.p && x._gk);
    if (r) out.push({ label: F.gopen[r._gk] ? 'إخفاء محرر المنحنيات' : 'إظهار محرر المنحنيات', action: () => { F.gopen[r._gk] = !F.gopen[r._gk]; F.render(); } });
    return out;
  }
  // Easy Ease (F9) and friends: selected keyframe, else every keyframe of the selected clip under the playhead
  F.easeKeys = (mode) => {
    const c = sel1(); let ks = [];
    if (F.selKey) ks = [F.selKey];
    else if (c) { const t = lt(c); GW.eachParam(c, p => { const k = GW.keyAt(p, t); if (k) ks.push(k); }); }
    if (!ks.length) { GW.toast('حدد مفتاحًا، أو ضع مؤشر التشغيل على مفاتيح المقطع المحدد'); return 0; }
    const tog = mode === 'hold' && ks.every(k => k.e === 'hold');
    for (const k of ks) { k.e = tog ? 'linear' : mode; delete k.bi; delete k.bo; }
    GW.commit(({ ease: 'تسهيل سهل', easeIn: 'تسهيل الدخول', easeOut: 'تسهيل الخروج', hold: 'مفتاح ثابت', linear: 'استيفاء خطي' })[mode] || 'نوع الاستيفاء'); GW.invalidate(); F.render();
    return ks.length;
  };
  const gcss = document.createElement('style'); gcss.textContent = `
.prow .pn .fxg-tw{width:15px;height:15px;padding:0;margin-inline-end:3px;border:0;background:none;color:var(--faint,#777);cursor:pointer;vertical-align:-3px;display:inline-grid;place-items:center}
.prow .pn .fxg-tw:hover{color:#fff}.prow .pn .fxg-tw.on{color:var(--accent)}
.fxg{height:150px;border-top:1px solid #262626;border-bottom:1px solid #262626;background:#1a1a1a;padding:5px 8px;display:flex;flex-direction:column;gap:5px}
.fxg-bar{display:flex;gap:3px;flex-wrap:wrap;align-items:center}.fxg-bar .seg{flex:none}.fxg-bar .seg button{height:20px;font-size:11px}
.fxg-bar .btn.sm{height:20px;padding:0 6px;font-size:10.5px}
.fxg-info{color:var(--faint,#777);font-size:10.5px}`;
  document.head.append(gcss);

  GW.bus.on('selection', () => { F.selKey = null; F.render(); });
  GW.bus.on('changed', () => F.render()); GW.bus.on('hist', () => F.render()); GW.bus.on('project', () => F.render());
  GW.bus.on('time', () => { if (!F.left) return; if (GW.pb.playing) { F.drawKeys(); return; } F.rows.forEach(r => { const sc = r.querySelector('.scrub'); }); F._tq || (F._tq = requestAnimationFrame(() => { F._tq = null; refreshValues(); })); });
  GW.bus.on('param', () => refreshValues());
  function refreshValues() { if (!F.left || !F.left.isConnected) return; F.left.querySelectorAll('.scrub').forEach(s => s.refresh && s.refresh()); F.rows.forEach(r => { const d = r.querySelector('.kd'); if (d && r._p) { const on = !!GW.keyAt(r._p, GW.seq().t - r._c.start); d.classList.toggle('on', on); if (d.dataset.on !== String(on)) { d.dataset.on = String(on); d.innerHTML = GW.ico(on ? 'keydiaon' : 'keydia', 12); } } }); F.drawKeys(); }
  GW.bus.on('layout', () => F.drawKeys());
})();
