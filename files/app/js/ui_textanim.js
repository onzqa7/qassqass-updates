'use strict';
/* UI for text animators (محرّكات النص): Effect Controls section under «النص» and the Essential Graphics Edit tab.
   Also registers the shape-layer Effect Controls section (shape.js). */
(function () {
  const A = GW.TextAnim, UI = GW.UI; if (!A) return;
  const F = GW.FXC; F.extra = F.extra || [];
  const ensure = (c) => { c.text.animators = c.text.animators || []; return c.text.animators; };
  const redraw = (c) => { GW.TextR.drop(c.id); GW.invalidate(); GW.TL && GW.TL.invalidate(); };
  const presetSel = (c, after) => {
    const s = document.createElement('select'); s.className = 'sel';
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'إضافة محرّك…'; s.append(o0);
    for (const [k, n] of A.PRESETS) { const o = document.createElement('option'); o.value = k; o.textContent = n; s.append(o); }
    s.onchange = () => { if (!s.value) return; ensure(c).push(A.newAnimator(s.value, c.dur)); redraw(c); GW.commit('إضافة محرّك نص'); s.value = ''; after && after(); };
    return s;
  };
  UI.addTextAnimator = (c, preset) => { const an = A.newAnimator(preset || 'custom', c.dur); ensure(c).push(an); redraw(c); GW.commit('إضافة محرّك نص'); return an; };

  /* ---- Effect Controls ---- */
  F.extra.push((L, c, s) => {
    if (c.kind !== 'text' || !c.text || c.text.mg) return; const { section, row, numCtl, pointCtl, colorCtl, lt } = F.builders;
    const list = ensure(c);
    const sec = section('محرّكات النص', { key: 'tanim', tools: [{ icon: GW.ico('plus', 13), title: 'إضافة محرّك', action: (e) => { GW.menu(e.clientX, e.clientY, A.PRESETS.map(([k, n]) => ({ label: n, action: () => { UI.addTextAnimator(c, k); F.render(); } }))); } }] });
    sec.body.append(row(c, null, 'قالب', presetSel(c, () => F.render()), { noAnim: true }));
    list.forEach((an, i) => {
      const asec = section(an.name || 'محرّك', { key: an.id, off: !an.on, toggle: () => { an.on = an.on ? 0 : 1; redraw(c); GW.commit('تفعيل محرّك'); F.render(); },
        tools: [{ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>', title: 'حذف المحرّك', action: () => { list.splice(i, 1); redraw(c); GW.commit('حذف محرّك'); F.render(); } }],
        menu: () => [{ label: 'تحريك للأعلى', disabled: i === 0, action: () => { list.splice(i, 1); list.splice(i - 1, 0, an); redraw(c); GW.commit('ترتيب المحرّكات'); F.render(); } }, { label: 'تحريك للأسفل', disabled: i === list.length - 1, action: () => { list.splice(i, 1); list.splice(i + 1, 0, an); redraw(c); GW.commit('ترتيب المحرّكات'); F.render(); } }, { label: 'تكرار', action: () => { const d = GW.clone(an); d.id = GW.uid(); list.splice(i + 1, 0, d); redraw(c); GW.commit('تكرار محرّك'); F.render(); } }, { label: 'إعادة تسمية…', action: async () => { const n = await GW.prompt('إعادة تسمية', 'الاسم', an.name); if (n) { an.name = n; GW.commit('إعادة تسمية'); F.render(); } } }, '-', { label: 'حذف', action: () => { list.splice(i, 1); redraw(c); GW.commit('حذف محرّك'); F.render(); } }] });
      const sel = (v, opts, on) => { const el = document.createElement('select'); el.className = 'sel'; for (const [k, n] of opts) { const o = document.createElement('option'); o.value = k; o.textContent = n; el.append(o); } el.value = v; el.onchange = () => { on(el.value); redraw(c); GW.commit('محرّك نص'); F.render(); }; return el; };
      asec.body.append(row(c, null, 'الوحدة', sel(an.unit, A.UNITS, v => { an.unit = v; }), { noAnim: true }));
      const rs = document.createElement('div'); rs.className = 'fx-sec'; rs.innerHTML = `<div class="fx-h" style="padding-inline-start:18px;color:var(--mute)"><span class="fxn">محدد النطاق</span></div>`; asec.body.append(rs);
      asec.body.append(row(c, an.sel.start, 'البداية', numCtl(c, an.sel.start, { min: -200, max: 300, step: .5, unit: '%' }), { def: 0 }));
      asec.body.append(row(c, an.sel.end, 'النهاية', numCtl(c, an.sel.end, { min: -200, max: 300, step: .5, unit: '%' }), { def: 100 }));
      asec.body.append(row(c, an.sel.offset, 'الإزاحة', numCtl(c, an.sel.offset, { min: -300, max: 300, step: .5, unit: '%' }), { def: 0 }));
      asec.body.append(row(c, null, 'الشكل', sel(an.sel.shape, A.SHAPES, v => { an.sel.shape = v; }), { noAnim: true }));
      asec.body.append(row(c, null, 'التسهيل', sel(an.sel.ease || 'none', A.EASES, v => { an.sel.ease = v; }), { noAnim: true }));
      const ps = document.createElement('div'); ps.className = 'fx-sec'; ps.innerHTML = `<div class="fx-h" style="padding-inline-start:18px;color:var(--mute)"><span class="fxn">الخصائص المتحركة</span></div>`; asec.body.append(ps);
      const p = an.props;
      for (const [k, n, mn, mx, st, un] of A.PROPS) { if (!p[k]) p[k] = GW.P(k === 'opacity' || k === 'scale' ? 100 : 0); asec.body.append(row(c, p[k], n, numCtl(c, p[k], { min: mn, max: mx, step: st, unit: un }), { def: k === 'opacity' || k === 'scale' ? 100 : 0 })); }
      if (!p.pos) p.pos = GW.P([0, 0]); asec.body.append(row(c, p.pos, 'الموضع', pointCtl(c, p.pos), { def: [0, 0] }));
      const fon = document.createElement('input'); fon.type = 'checkbox'; fon.checked = !!p.fillOn; fon.onchange = () => { p.fillOn = fon.checked ? 1 : 0; redraw(c); GW.commit('لون التعبئة'); F.render(); };
      asec.body.append(row(c, null, 'تغيير لون التعبئة', fon, { noAnim: true }));
      if (p.fillOn) { if (!p.fill) p.fill = GW.P('#ffd400'); asec.body.append(row(c, p.fill, 'لون التعبئة', colorCtl(c, p.fill), { def: '#ffd400' })); }
      sec.body.append(asec);
    });
    L.append(sec);
  });
  if (GW.Shape) F.extra.push((L, c, s) => GW.Shape.fxc(L, c, s, F));

  /* ---- Essential Graphics: Edit tab block ---- */
  UI.textAnimForm = (f, c, ch) => {
    const { sec, frow, frowEl, rangeIn, colorIn, checkIn, selectIn } = UI.form; const list = ensure(c);
    f.append(sec('محرّكات النص'));
    const psel = presetSel(c, () => UI.egRefresh && UI.egRefresh()); f.append(frow('قالب', psel));
    const lt = () => GW.clamp(GW.seq().t - c.start, 0, c.dur);
    list.forEach((an, i) => {
      const box = document.createElement('div'); box.className = 'tanim'; box.style.cssText = 'border:1px solid var(--line);border-radius:6px;padding:6px 8px;margin:6px 0;display:flex;flex-direction:column;gap:4px';
      const head = document.createElement('div'); head.style.cssText = 'display:flex;gap:6px;align-items:center';
      const on = checkIn(an.on, v => { an.on = v; ch(); }); const nm = document.createElement('b'); nm.style.flex = '1'; nm.textContent = an.name || 'محرّك';
      const del = document.createElement('button'); del.className = 'btn sm ico ghost'; del.innerHTML = GW.ico('close', 12); del.title = 'حذف المحرّك'; del.onclick = () => { list.splice(i, 1); redraw(c); GW.commit('حذف محرّك'); UI.egRefresh && UI.egRefresh(); };
      head.append(on, nm, del); box.append(head);
      const upd = (p) => (v) => { GW.setPv(p, lt(), v); ch(); };
      box.append(frow('الوحدة', selectIn(A.UNITS, an.unit, v => { an.unit = v; ch(); })), frow('الشكل', selectIn(A.SHAPES, an.sel.shape, v => { an.sel.shape = v; ch(); })), frow('التسهيل', selectIn(A.EASES, an.sel.ease || 'none', v => { an.sel.ease = v; ch(); })));
      const anim = (p, n) => { const r = document.createElement('div'); r.className = 'frow'; const l = document.createElement('label'); l.textContent = n; const ctl = document.createElement('div'); ctl.className = 'ctl'; const info = document.createElement('small'); info.style.color = 'var(--mute)'; info.textContent = GW.isAnim(p) ? `${p.k.length} مفاتيح` : 'ثابت'; const b = document.createElement('button'); b.className = 'btn sm' + (GW.isAnim(p) ? ' on' : ''); b.innerHTML = GW.ico(GW.isAnim(p) ? 'keyon' : 'key', 12); b.title = 'تحريك بالمفاتيح (0 → 100 عبر مدة الحركة)'; b.onclick = () => { if (GW.isAnim(p)) { p.v = GW.pv(p, lt()); delete p.k; } else { const d = Math.max(.3, Math.min(c.dur, (c.text.animDur || .5) * 3)); p.k = [{ t: 0, v: n === 'النهاية' ? 0 : -40, e: 'ease' }, { t: d, v: 100, e: 'ease' }]; } ch(); GW.commit('مفاتيح المحدد'); UI.egRefresh && UI.egRefresh(); }; ctl.append(...rangeIn(GW.pv(p, lt()), -200, 300, 1, upd(p)), b, info); r.append(l, ctl); return r; };
      box.append(anim(an.sel.start, 'البداية'), anim(an.sel.end, 'النهاية'), anim(an.sel.offset, 'الإزاحة'));
      const p = an.props;
      for (const [k, n, mn, mx, st] of A.PROPS) { if (!p[k]) p[k] = GW.P(k === 'opacity' || k === 'scale' ? 100 : 0); box.append(frow(n, rangeIn(GW.pv(p[k], lt()), mn, mx, st, upd(p[k])))); }
      if (!p.pos) p.pos = GW.P([0, 0]);
      box.append(frow('إزاحة أفقية', rangeIn(GW.pv(p.pos, lt())[0], -1000, 1000, 1, v => { const cur = GW.clone(GW.pv(p.pos, lt())); cur[0] = v; GW.setPv(p.pos, lt(), cur); ch(); })), frow('إزاحة عمودية', rangeIn(GW.pv(p.pos, lt())[1], -1000, 1000, 1, v => { const cur = GW.clone(GW.pv(p.pos, lt())); cur[1] = v; GW.setPv(p.pos, lt(), cur); ch(); })));
      box.append(frow('تغيير لون التعبئة', checkIn(p.fillOn, v => { p.fillOn = v; ch(); UI.egRefresh && UI.egRefresh(); })));
      if (p.fillOn) { if (!p.fill) p.fill = GW.P('#ffd400'); box.append(frow('لون التعبئة', colorIn(GW.pv(p.fill, lt()), upd(p.fill)))); }
      f.append(box);
    });
  };
})();
