'use strict';
/* Effects browser, Essential Graphics, Lumetri, Audio mixer, Markers, History, War maps + dialogs */
(function () {
  const { $, clamp, esc } = GW;
  const UI = GW.UI;

  /* ================= effects browser ================= */
  const PRESETS = {
    kenburns: { n: 'تكبير بطيء (Ken Burns)' }, kenburnsOut: { n: 'تصغير بطيء' }, fadeInOut: { n: 'ظهور واختفاء تدريجي' },
    cinematic: { n: 'مظهر سينمائي كامل' }, warDoc: { n: 'مظهر وثائقي حربي' }, explosionShake: { n: 'اهتزاز انفجار' },
    greenScreen: { n: 'إزالة شاشة خضراء' }, oldFilm: { n: 'فيلم قديم' }, nightVision: { n: 'رؤية ليلية' }, thermal: { n: 'كاميرا حرارية' },
    quake: { n: 'زلزال' }, dream: { n: 'حلم / ذكرى' }, cctv: { n: 'كاميرا مراقبة' }, storm: { n: 'عاصفة وبرق' }, newsMap: { n: 'خلفية أخبار متحركة' }, comic: { n: 'رسم كوميكس' }, oldTV: { n: 'تلفاز قديم' }, sunset: { n: 'غروب دافئ' }, coldWar: { n: 'حرب باردة (أزرق بارد)' }, flashback: { n: 'استرجاع (فلاش باك)' }
  };
  const FX_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 15l3-6 2 4 1-2 2 4"/></svg>';
  const TR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="11" height="12" rx="1.5"/><rect x="11" y="6" width="11" height="12" rx="1.5" fill="currentColor" fill-opacity=".25"/></svg>';
  const AU_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>';
  let fxQuery = '', closedCats = {};
  GW.registerPanel('effects', 'التأثيرات', (el) => {
    el.innerHTML = `<div class="search" dir="rtl"><input class="inp" placeholder="ابحث عن تأثير أو انتقال…" data-a="q"></div><div class="pscroll tree" data-a="tree"></div><div class="ptool" dir="rtl" style="border-top:1px solid var(--line);border-bottom:0;color:var(--mute)">اسحب التأثير إلى مقطع في الخط الزمني، أو انقر مرتين لتطبيقه على المحدد.</div>`;
    el.querySelector('[data-a=q]').oninput = e => { fxQuery = e.target.value.trim(); renderTree(el.querySelector('[data-a=tree]')); };
    renderTree(el.querySelector('[data-a=tree]'));
  });
  function renderTree(box) {
    box.innerHTML = '';
    const groups = [
      ['قوالب جاهزة', 'preset', Object.entries(PRESETS).map(([k, v]) => [k, v.n, null])],
      ['تأثيرات الفيديو', 'v', Object.entries(GW.FX).map(([k, v]) => [k, v.n, v.cat])],
      ['انتقالات الفيديو', 'tr', Object.entries(GW.TRANS).map(([k, v]) => [k, v.n, v.cat])],
      ['تأثيرات الصوت', 'a', Object.entries(GW.AFX).map(([k, v]) => [k, v.n, null])],
      ['انتقالات الصوت', 'atr', Object.entries(GW.ATRANS).map(([k, v]) => [k, v.n, null])]
    ];
    const q = fxQuery.toLowerCase();
    for (const [title, grp, items] of groups) {
      const list = items.filter(([k, n]) => !q || n.toLowerCase().includes(q) || k.toLowerCase().includes(q)); if (!list.length) continue;
      const cat = document.createElement('div'); cat.className = 'cat' + (closedCats[grp] && !q ? ' closed' : ''); cat.textContent = title; box.append(cat);
      const wrap = document.createElement('div'); wrap.hidden = !!closedCats[grp] && !q; box.append(wrap);
      cat.onclick = () => { closedCats[grp] = !closedCats[grp]; renderTree(box); };
      let lastSub = null;
      for (const [k, n, sub] of list) {
        if (sub && sub !== lastSub) { const sc = document.createElement('div'); sc.style.cssText = 'color:var(--mute);font-size:11px;padding:4px 18px 2px'; sc.textContent = sub; wrap.append(sc); lastSub = sub; }
        const leaf = document.createElement('div'); leaf.className = 'leaf'; leaf.draggable = true; leaf.innerHTML = (grp === 'tr' || grp === 'atr' ? TR_ICON : grp === 'a' ? AU_ICON : FX_ICON) + `<span>${esc(n)}</span>`;
        leaf.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-gws-fx', JSON.stringify({ group: grp, type: k })); e.dataTransfer.effectAllowed = 'copy'; });
        leaf.ondblclick = () => UI.applyFxTo({ group: grp, type: k }, null, {});
        wrap.append(leaf);
      }
    }
  }
  UI.applyFxTo = (f, clip, hit) => {
    const s = GW.seq(); let clips = clip ? [clip] : [...GW.sel.clips].map(id => GW.clipById(id)).filter(Boolean);
    if (!clips.length) { GW.toast('حدد مقطعًا أولًا أو اسحب التأثير إلى مقطع'); return; }
    if (f.group === 'tr' || f.group === 'atr') {
      const tt = f.group === 'tr' ? 'v' : 'a';
      for (const c of clips.filter(c => c.tt === tt)) { let side = hit && hit.edge; if (!side && hit && hit.t != null) side = hit.t > c.start + c.dur / 2 ? 'R' : 'L'; GW.TL.addTransitionAt(f.type, c, side || 'R'); }
      return;
    }
    if (f.group === 'preset') { clips.filter(c => c.tt === 'v').forEach(c => applyPreset(c, f.type)); GW.commit('قالب: ' + PRESETS[f.type].n); GW.FXC.render(); return; }
    let n = 0;
    for (let c of clips) {
      if (f.group === 'a') { if (c.tt !== 'a') c = GW.linked(s, c).find(x => x.tt === 'a'); if (!c) continue; c.afx = c.afx || []; c.afx.push(GW.newFx(f.type, 'a')); n++; }
      else { if (c.tt !== 'v') continue; c.fx = c.fx || []; c.fx.push(GW.newFx(f.type, 'v')); n++; }
    }
    if (!n) { GW.toast(f.group === 'a' ? 'هذا تأثير صوتي: طبّقه على مقطع صوت' : 'هذا تأثير فيديو: طبّقه على مقطع فيديو'); return; }
    if (clip) { GW.sel.clips.clear(); GW.sel.clips.add(clip.id); GW.bus.emit('selection'); }
    GW.commit('تطبيق تأثير'); GW.FXC.render();
    if (!GW.isShown('fxc')) GW.showPanel('fxc');
  };
  function fxWith(c, type, vals) { const f = GW.newFx(type, 'v'); for (const k in vals) f.params[k] = GW.P(vals[k]); c.fx = c.fx || []; c.fx.push(f); return f; }
  function applyPreset(c, k) {
    const m = c.motion;
    if (k === 'kenburns' || k === 'kenburnsOut') { const s0 = GW.pv(m.scale, 0); const a = k === 'kenburns' ? s0 : s0 * 1.18, b = k === 'kenburns' ? s0 * 1.18 : s0; m.scale = { v: a, k: [{ t: 0, v: a, e: 'ease' }, { t: c.dur, v: b, e: 'ease' }] }; }
    if (k === 'fadeInOut') { const d = Math.min(.8, c.dur / 4); c.opacity = { v: 100, k: [{ t: 0, v: 0, e: 'linear' }, { t: d, v: 100, e: 'linear' }, { t: c.dur - d, v: 100, e: 'linear' }, { t: c.dur, v: 0, e: 'linear' }] }; }
    if (k === 'cinematic') { fxWith(c, 'lumetri', { contrast: 18, sat: 88, temp: -6, shadowTint: '#5f8796', highTint: '#cfa070', fade: 8 }); fxWith(c, 'vignette', { amount: 45 }); fxWith(c, 'grain', { amount: 14 }); fxWith(c, 'bars', { ratio: 2.39 }); }
    if (k === 'warDoc') { fxWith(c, 'lumetri', { contrast: 28, sat: 55, temp: 10, fade: 12, exposure: -.1 }); fxWith(c, 'vignette', { amount: 55 }); fxWith(c, 'grain', { amount: 22 }); }
    if (k === 'explosionShake') { fxWith(c, 'shake', { amount: 26, rot: 2, freq: 14, zoom: 6 }); }
    if (k === 'greenScreen') { fxWith(c, 'ckey', {}); }
    if (k === 'oldFilm') { fxWith(c, 'sepia', { amount: 70 }); fxWith(c, 'grain', { amount: 40, size: 2 }); fxWith(c, 'vignette', { amount: 70 }); fxWith(c, 'vhs', { amount: 20, lines: 10 }); }
    if (k === 'nightVision') { fxWith(c, 'tint', { black: '#001a05', white: '#7dff8a' }); fxWith(c, 'grain', { amount: 45 }); fxWith(c, 'vignette', { amount: 80, round: 100 }); fxWith(c, 'scanlines', { amount: 25 }); }
    if (k === 'thermal') { fxWith(c, 'thermal', { amount: 100 }); fxWith(c, 'grain', { amount: 15 }); }
    if (k === 'quake') { fxWith(c, 'shake', { amount: 40, rot: 3, freq: 18, zoom: 8 }); fxWith(c, 'dblur', { angle: 90, len: 6 }); fxWith(c, 'chroma', { amount: 4 }); }
    if (k === 'dream') { fxWith(c, 'glow', { thr: 40, radius: 40, int: 1.1 }); fxWith(c, 'lensblur', { radius: 3 }); fxWith(c, 'vignette', { amount: -40 }); fxWith(c, 'photofilter', { color: '#ffd9a0', density: 30 }); }
    if (k === 'cctv') { fxWith(c, 'bw', { amount: 90 }); fxWith(c, 'scanlines', { amount: 35, size: 2 }); fxWith(c, 'grain', { amount: 35 }); fxWith(c, 'lens', { amount: 20 }); fxWith(c, 'vignette', { amount: 60 }); }
    if (k === 'storm') { fxWith(c, 'lumetri', { exposure: -.4, sat: 60, contrast: 20, temp: -20 }); fxWith(c, 'lightning', {}); fxWith(c, 'strobe', { freq: .7, duty: 4, color: '#dfe9ff' }); }
    if (k === 'newsMap') { fxWith(c, 'fractal', { scale: 200, contrast: 140, c1: '#020b1c', c2: '#123a7a', speed: .6 }); fxWith(c, 'gridfx', { size: 90, width: 1, color: '#4c8dff', amount: 25 }); fxWith(c, 'flare', { center: [.8, .2], bright: 60, color: '#6fb0ff' }); }
    if (k === 'comic') { fxWith(c, 'toon', { levels: 5, edge: 90 }); fxWith(c, 'halftone', { size: 5, amount: 25 }); }
    if (k === 'oldTV') { fxWith(c, 'vhs', { amount: 70, lines: 60, wobble: 50 }); fxWith(c, 'lens', { amount: 30 }); fxWith(c, 'vignette', { amount: 70 }); fxWith(c, 'chroma', { amount: 5 }); }
    if (k === 'sunset') { fxWith(c, 'photofilter', { color: '#ff8a3d', density: 35 }); fxWith(c, 'ramp', { c1: '#ff7a3d', c2: '#000000', amount: 25 }); fxWith(c, 'flare', { center: [.75, .25], bright: 80 }); }
    if (k === 'coldWar') { fxWith(c, 'tritone', { hi: '#e8f1ff', mid: '#4a6a8a', sh: '#05101e', amount: 85 }); fxWith(c, 'grain', { amount: 20 }); fxWith(c, 'vignette', { amount: 50 }); }
    if (k === 'flashback') { fxWith(c, 'bw', { amount: 70 }); fxWith(c, 'glow', { thr: 50, radius: 30, int: .8 }); fxWith(c, 'vignette', { amount: 70, feather: 80 }); fxWith(c, 'grain', { amount: 25 }); }
  }

  /* ================= essential graphics ================= */
  let egTab = 'browse', localFonts = null;
  GW.registerPanel('graphics', 'الرسومات الأساسية', (el) => {
    el.innerHTML = `<div class="ptool" dir="rtl"><div class="seg" data-a="tabs" style="flex:1"><button data-t="browse">استعراض</button><button data-t="mg">قوالب متحركة</button><button data-t="edit">تحرير</button></div></div><div class="pscroll" data-a="body"></div>`;
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { egTab = b.dataset.t; renderEG(); });
    UI.egEl = el; renderEG();
  });
  function selText() { const c = [...GW.sel.clips].map(id => GW.clipById(id)).find(c => c && (c.kind === 'text' || c.kind === 'shape' || (c.kind === 'color' && c.masks && c.masks.length))); return c || null; }
  function renderEG() {
    const el = UI.egEl; if (!el) return; const c = selText(); if (c && egTab === 'browse' && UI._egAuto !== c.id) { egTab = 'edit'; UI._egAuto = c.id; }
    el.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === egTab));
    const body = el.querySelector('[data-a=body]');
    const mgF = body.querySelector('.mg-form'); if (egTab === 'edit' && mgF && mgF._clip === c && mgF.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'range') return; // keep focus while typing in a template field
    body.innerHTML = '';
    if (egTab === 'mg' && GW.MG) { GW.MG.renderBrowser(body); return; }
    if (egTab === 'edit' && c && c.text && c.text.mg && GW.MG && GW.MG.get(c.text.mg.id)) { GW.MG.renderEdit(body, c, UI.form); const mf = body.querySelector('.mg-form'); if (mf) mf._clip = c; return; }
    if (egTab === 'browse') {
      const g = document.createElement('div'); g.className = 'eg-grid';
      GW.TITLE_PRESETS.forEach((p, i) => {
        const card = document.createElement('div'); card.className = 'eg-card'; card.title = 'انقر للإضافة عند مؤشر التشغيل';
        const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; card.append(cv); const cap = document.createElement('div'); cap.textContent = p.n; card.append(cap);
        const fake = { id: 'prev' + i, dur: 5, text: Object.assign(GW.defaultText(), p.t, { animIn: 'none', animOut: 'none' }) };
        if (GW.MG && GW.MG.presetCard) GW.MG.presetCard(card, cv, p, i); else requestAnimationFrame(() => { const e = GW.TextR.draw(fake, 2, 320, 180, 320 / 1920); const g2 = cv.getContext('2d'); g2.fillStyle = '#0b0b0b'; g2.fillRect(0, 0, 320, 180); if (p.pos) g2.drawImage(e.canvas, (p.pos[0] - .5) * 320, (p.pos[1] - .5) * 180); else g2.drawImage(e.canvas, 0, 0); GW.TextR.drop(fake.id); });
        card.onclick = () => UI.addTextClip(i); g.append(card);
      });
      body.append(g);
      if (GW.MG) { const h = document.createElement('div'); h.className = 'sec-t mg-sec'; h.textContent = 'قوالب الرسوم المتحركة'; body.append(h); GW.MG.renderBrowser(body); } // animated templates live in the same Browse list
      const s2 = document.createElement('div'); s2.className = 'form'; s2.innerHTML = '<div class="sec-t">أشكال</div>';
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      for (const [k, n] of [['rect', 'مستطيل'], ['ellipse', 'دائرة'], ['bar', 'شريط سفلي']]) { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = n; b.onclick = () => UI.addShape(k); row.append(b); }
      s2.append(row);
      if (GW.Shape) { // vector shape layers (shape.js): fill / stroke / gradient / trim paths / pen tool
        const h2 = document.createElement('div'); h2.className = 'sec-t'; h2.textContent = 'شكل جديد (طبقة متجهات)'; s2.append(h2);
        const row2 = document.createElement('div'); row2.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        for (const [k, n] of GW.Shape.TYPES) { const b = document.createElement('button'); b.className = 'btn sm'; b.innerHTML = GW.ico('shape_' + k, 13) + ' ' + esc(n); b.onclick = () => UI.addShapeLayer(k); row2.append(b); }
        s2.append(row2);
      }
      body.append(s2);
      return;
    }
    if (!c) { body.innerHTML = '<div class="empty">حدد مقطع نص في الخط الزمني لتحريره،<br>أو أضف عنوانًا من «استعراض».</div>'; return; }
    if (c.kind === 'color') { const f = document.createElement('div'); f.className = 'form'; f.append(frow('لون الشكل', colorIn(c.color, v => { c.color = v; ch(); }))); body.append(f); return; }
    if (c.kind === 'shape' && c.shape) { shapeForm(body, c); return; }
    const x = c.text; const f = document.createElement('div'); f.className = 'form';
    const ch = () => { c.name = (x.str.split('\n')[0] || 'نص').slice(0, 40); GW.invalidate(); GW.commitSoon('تعديل النص'); GW.TL.invalidate(); };
    const ta = document.createElement('textarea'); ta.className = 'inp'; ta.rows = 3; ta.dir = 'auto'; ta.value = x.str; ta.oninput = () => { x.str = ta.value; ch(); }; ta.onkeydown = e => e.stopPropagation();
    f.append(sec('النص'), ta);
    const fonts = [...GW.FONTS, ...(localFonts || [])];
    const fs = selectIn(fonts.map(n => [n, n]), x.font, v => { x.font = v; ch(); }); fs.style.fontFamily = x.font;
    const lf = document.createElement('button'); lf.className = 'btn sm'; lf.textContent = 'خطوط الجهاز'; lf.title = 'إضافة الخطوط المثبتة على جهازك'; lf.onclick = loadLocalFonts;
    const fctl = document.createElement('div'); fctl.className = 'ctl'; fctl.append(fs, lf);
    f.append(sec('الخط'), frowEl('العائلة', fctl), frow('الوزن', selectIn([[300, 'خفيف'], [400, 'عادي'], [500, 'متوسط'], [600, 'شبه عريض'], [700, 'عريض'], [800, 'عريض جدًا'], [900, 'أسود']], x.weight, v => { x.weight = +v; ch(); })),
      frow('الحجم', rangeIn(x.size, 8, 400, 1, v => { x.size = v; ch(); })), frow('اللون', colorIn(x.color, v => { x.color = v; ch(); })),
      frow('المحاذاة', segIn([['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']], x.align, v => { x.align = v; ch(); })),
      frow('تباعد الأحرف', rangeIn(x.tracking, -20, 100, 1, v => { x.tracking = v; ch(); })), frow('تباعد الأسطر', rangeIn(x.leading, .6, 3, .05, v => { x.leading = v; ch(); })),
      frow('عرض الصندوق', rangeIn(x.boxW || 0, 0, 1920, 10, v => { x.boxW = v; ch(); })), frow('أحرف كبيرة', checkIn(x.caps, v => { x.caps = v; ch(); })), frow('مائل', checkIn(x.italic, v => { x.italic = v; ch(); })));
    f.append(sec('الحد الخارجي'), frow('السماكة', rangeIn(x.stroke, 0, 30, .5, v => { x.stroke = v; ch(); })), frow('اللون', colorIn(x.strokeColor, v => { x.strokeColor = v; ch(); })));
    f.append(sec('الظل'), frow('تفعيل', checkIn(x.shadow, v => { x.shadow = v; ch(); })), frow('اللون', colorIn(x.shadowColor, v => { x.shadowColor = v; ch(); })), frow('الشفافية', rangeIn(x.shadowOp, 0, 100, 1, v => { x.shadowOp = v; ch(); })), frow('النعومة', rangeIn(x.shadowBlur, 0, 80, 1, v => { x.shadowBlur = v; ch(); })), frow('المسافة', rangeIn(x.shadowDist, 0, 60, 1, v => { x.shadowDist = v; ch(); })), frow('الزاوية', rangeIn(x.shadowAng, 0, 360, 1, v => { x.shadowAng = v; ch(); })));
    f.append(sec('الخلفية'), frow('تفعيل', checkIn(x.bg, v => { x.bg = v; ch(); })), frow('اللون', colorIn(x.bgColor, v => { x.bgColor = v; ch(); })), frow('الشفافية', rangeIn(x.bgOp, 0, 100, 1, v => { x.bgOp = v; ch(); })), frow('الحشو', rangeIn(x.bgPad, 0, 120, 1, v => { x.bgPad = v; ch(); })), frow('الاستدارة', rangeIn(x.bgRad, 0, 80, 1, v => { x.bgRad = v; ch(); })));
    f.append(sec('الحركة'), frow('الدخول', selectIn(GW.TEXT_ANIMS, x.animIn, v => { x.animIn = v; ch(); })), frow('الخروج', selectIn(GW.TEXT_ANIMS, x.animOut, v => { x.animOut = v; ch(); })), frow('مدة الحركة', rangeIn(x.animDur, .1, 3, .05, v => { x.animDur = v; ch(); })));
    if (UI.textAnimForm) UI.textAnimForm(f, c, ch); // AE-style text animators (ui_textanim.js)
    body.append(f);
  }
  function shapeForm(body, c) { // quick shape editing; the full keyframable set lives in Effect Controls
    const sh = c.shape, lt = () => GW.clamp(GW.seq().t - c.start, 0, c.dur); const f = document.createElement('div'); f.className = 'form';
    const ch = () => { GW.invalidate(); GW.commitSoon('تعديل الشكل'); GW.TL.invalidate(); }; const set = (p) => (v) => { GW.setPv(p, lt(), v); ch(); };
    f.append(sec('الشكل'), frow('النوع', selectIn(GW.Shape.TYPES, sh.type, v => { sh.type = v; ch(); renderEG(); })));
    f.append(sec('التعبئة'), frow('تفعيل', checkIn(sh.fill.on, v => { sh.fill.on = v; ch(); })), frow('اللون', colorIn(GW.pv(sh.fill.color, lt()), set(sh.fill.color))), frow('الشفافية', rangeIn(GW.pv(sh.fill.opacity, lt()), 0, 100, 1, set(sh.fill.opacity))));
    f.append(sec('الحد'), frow('تفعيل', checkIn(sh.stroke.on, v => { sh.stroke.on = v; ch(); })), frow('اللون', colorIn(GW.pv(sh.stroke.color, lt()), set(sh.stroke.color))), frow('السماكة', rangeIn(GW.pv(sh.stroke.width, lt()), 0, 200, .5, set(sh.stroke.width))), frow('طول الشرطة', rangeIn(GW.pv(sh.stroke.dash, lt()), 0, 400, 1, set(sh.stroke.dash))), frow('الفجوة', rangeIn(GW.pv(sh.stroke.gap, lt()), 0, 400, 1, set(sh.stroke.gap))));
    if (sh.type !== 'ellipse' && sh.type !== 'line') f.append(frow('استدارة الزوايا', rangeIn(GW.pv(sh.round, lt()), 0, 400, 1, set(sh.round))));
    f.append(sec('قص المسار'), frow('البداية', rangeIn(GW.pv(sh.trim.start, lt()), 0, 100, .5, set(sh.trim.start))), frow('النهاية', rangeIn(GW.pv(sh.trim.end, lt()), 0, 100, .5, set(sh.trim.end))), frow('الإزاحة', rangeIn(GW.pv(sh.trim.offset, lt()), -100, 100, .5, set(sh.trim.offset))));
    const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = 'كل الخصائص والمفاتيح في عناصر التحكم'; b.onclick = () => GW.showPanel('fxc'); f.append(b);
    body.append(f);
  }
  async function loadLocalFonts() {
    try { if (!window.queryLocalFonts) throw new Error('غير مدعوم'); const fl = await window.queryLocalFonts(); localFonts = [...new Set(fl.map(f => f.family))].sort(); GW.toast('تمت إضافة ' + localFonts.length + ' خط من جهازك'); renderEG(); }
    catch (e) { GW.toast('تعذر قراءة خطوط الجهاز: ' + e.message, 'err'); }
  }
  // tiny form helpers
  function sec(t) { const d = document.createElement('div'); d.className = 'sec-t'; d.textContent = t; return d; }
  function frowEl(label, ctl) { const r = document.createElement('div'); r.className = 'frow'; const l = document.createElement('label'); l.textContent = label; r.append(l, ctl); return r; }
  function frow(label, ctlInner) { const ctl = document.createElement('div'); ctl.className = 'ctl'; ctl.append(...[].concat(ctlInner)); return frowEl(label, ctl); }
  function rangeIn(v, min, max, step, on) { const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = v; const val = document.createElement('span'); val.className = 'val'; val.textContent = +(+v).toFixed(2); i.oninput = () => { val.textContent = +(+i.value).toFixed(2); on(+i.value); }; return [i, val]; }
  function colorIn(v, on) { const i = document.createElement('input'); i.type = 'color'; i.value = v; i.oninput = () => on(i.value); return i; }
  function checkIn(v, on) { const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!v; i.onchange = () => on(i.checked ? 1 : 0); return i; }
  function selectIn(opts, v, on) { const s = document.createElement('select'); s.className = 'sel'; for (const [k, n] of opts) { const o = document.createElement('option'); o.value = k; o.textContent = n; s.append(o); } s.value = v; s.onchange = () => on(s.value); return s; }
  function segIn(opts, v, on) { const w = document.createElement('div'); w.className = 'seg'; w.style.flex = '1'; for (const [k, n] of opts) { const b = document.createElement('button'); b.textContent = n; b.classList.toggle('on', k === v); b.onclick = () => { w.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); on(k); }; w.append(b); } return w; }
  UI.form = { sec, frow, frowEl, rangeIn, colorIn, checkIn, selectIn, segIn };
  UI.egRefresh = () => renderEG();
  UI.egEdit = () => { egTab = 'edit'; if (GW.isShown && !GW.isShown('graphics')) GW.showPanel('graphics'); renderEG(); };
  UI.egTab = (t) => { egTab = t; if (GW.isShown && !GW.isShown('graphics')) GW.showPanel('graphics'); renderEG(); };
  GW.bus.on('selection', () => renderEG()); GW.bus.on('hist', () => renderEG());

  /* ================= new items ================= */
  function freeVTrack(s, t, dur) { for (let i = 0; i < s.vt.length; i++) { if (s.vt[i].lock) continue; if (!s.clips.some(c => c.tt === 'v' && c.ti === i && c.start < t + dur && c.start + c.dur > t)) { if (i >= GW.TL.target.v) return i; } } GW.ops.ensureTrack(s, 'v', s.vt.length); return s.vt.length - 1; }
  UI.addTextClip = (presetIdx, posPx) => {
    const s = GW.seq(); const t = s.t; const dur = 5; const ti = freeVTrack(s, t, dur);
    const p = presetIdx != null ? GW.TITLE_PRESETS[presetIdx] : null;
    const c = GW.newClip('text', { ti, start: t, dur, name: p ? p.n : 'نص' });
    if (p) Object.assign(c.text, GW.clone(p.t));
    if (posPx) c.motion.pos = GW.P([Math.round(posPx[0]), Math.round(posPx[1])]); else if (p && p.pos) c.motion.pos = GW.P([Math.round(p.pos[0] * s.w), Math.round(p.pos[1] * s.h)]);
    c.name = (c.text.str.split('\n')[0] || 'نص').slice(0, 40);
    s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.commit('إضافة نص'); GW.bus.emit('selection');
    egTab = 'edit'; if (!GW.isShown('graphics')) GW.showPanel('graphics'); renderEG();
  };
  UI.addGenerator = (kind) => { const s = GW.seq(); const ti = freeVTrack(s, s.t, 5); const c = GW.newClip(kind, { ti, start: s.t, dur: 5 }); if (kind === 'adjust') c.fx.push(GW.newFx('lumetri')); s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.commit(kind === 'color' ? 'لون ثابت' : kind === 'null' ? 'طبقة فارغة' : kind === 'camera' ? 'كاميرا' : 'طبقة ضبط'); GW.bus.emit('selection'); };
  UI.addShapeLayer = (type) => { if (!GW.Shape) return null; const c = GW.Shape.add(type); egTab = 'edit'; renderEG(); return c; }; // «شكل جديد»: vector shape layer (shape.js)
  UI.addShape = (kind) => {
    const s = GW.seq(); const ti = freeVTrack(s, s.t, 5); const c = GW.newClip('color', { ti, start: s.t, dur: 5, color: kind === 'bar' ? '#d6202f' : '#2f8ef0', name: kind === 'ellipse' ? 'دائرة' : kind === 'bar' ? 'شريط' : 'مستطيل' });
    const mk = { id: GW.uid(), type: kind === 'ellipse' ? 'ellipse' : 'rect', on: 1, mode: 'add', inv: 0, feather: GW.P(0), opacity: GW.P(100), expansion: GW.P(0), center: GW.P(kind === 'bar' ? [s.w / 2, s.h * .86] : [s.w / 2, s.h / 2]), size: GW.P(kind === 'bar' ? [s.w * .9, s.h * .1] : kind === 'ellipse' ? [s.h * .4, s.h * .4] : [s.w * .4, s.h * .3]), rot: GW.P(0) };
    c.masks.push(mk); s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.commit('شكل'); GW.bus.emit('selection');
  };

  /* ================= lumetri ================= */
  const LOOKS = [
    ['بدون', {}, 'linear-gradient(90deg,#666,#999)'], ['سينمائي', { contrast: 18, sat: 88, temp: -6, shadowTint: '#5f8796', highTint: '#cfa070', fade: 6 }, 'linear-gradient(90deg,#1f4a55,#c9874a)'],
    ['دافئ', { temp: 30, tint: 4, sat: 108, contrast: 8 }, 'linear-gradient(90deg,#6a3a1a,#f0b060)'], ['بارد', { temp: -35, sat: 92, contrast: 10 }, 'linear-gradient(90deg,#173250,#8fb9e0)'],
    ['أبيض وأسود', { sat: 0, contrast: 30 }, 'linear-gradient(90deg,#111,#ddd)'], ['فيلم باهت', { fade: 35, contrast: -12, sat: 82 }, 'linear-gradient(90deg,#4a4a52,#b9b4a8)'],
    ['ليلي', { temp: -45, exposure: -.6, sat: 70, contrast: 15 }, 'linear-gradient(90deg,#060f22,#3c5a8a)'], ['وثائقي حربي', { sat: 55, contrast: 28, fade: 12, temp: 10, exposure: -.1 }, 'linear-gradient(90deg,#2d2a20,#a59a78)'],
    ['صحراوي', { temp: 32, tint: 6, sat: 112, contrast: 14 }, 'linear-gradient(90deg,#5a3a14,#e8c070)']
  ];
  GW.registerPanel('lumetri', 'ألوان Lumetri', (el) => { el.innerHTML = '<div class="pscroll" data-a="b"></div>'; UI.lumEl = el; renderLum(); });
  function renderLum() {
    const el = UI.lumEl; if (!el) return; const b = el.querySelector('[data-a=b]'); b.innerHTML = '';
    const c = [...GW.sel.clips].map(id => GW.clipById(id)).find(x => x && x.tt === 'v');
    if (!c) { b.innerHTML = '<div class="empty">حدد مقطع فيديو أو طبقة ضبط لتصحيح ألوانه.</div>'; return; }
    let fx = (c.fx || []).find(f => f.type === 'lumetri');
    const f = document.createElement('div'); f.className = 'form'; b.append(f);
    f.append(sec('مظاهر جاهزة'));
    const looks = document.createElement('div'); looks.className = 'looks';
    for (const [n, vals, grad] of LOOKS) { const d = document.createElement('div'); d.className = 'look'; d.innerHTML = `<div style="background:${grad}"></div>${esc(n)}`; d.onclick = () => { if (!fx) { fx = GW.newFx('lumetri'); c.fx.unshift(fx); } const base = GW.newFx('lumetri'); for (const k in base.params) fx.params[k] = base.params[k]; for (const k in vals) fx.params[k] = GW.P(vals[k]); GW.commit('مظهر: ' + n); renderLum(); }; looks.append(d); }
    f.append(looks);
    if (!fx) { const add = document.createElement('button'); add.className = 'btn pri'; add.textContent = 'إضافة تصحيح الألوان'; add.onclick = () => { c.fx.unshift(GW.newFx('lumetri')); GW.commit('تصحيح الألوان'); renderLum(); }; f.append(add); return; }
    const lt = GW.seq().t - c.start;
    const groups = [['تصحيح أساسي', ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']], ['توازن الأبيض', ['temp', 'tint']], ['الألوان', ['sat', 'vib', 'fade', 'shadowTint', 'highTint']]];
    for (const [title, keys] of groups) {
      f.append(sec(title));
      for (const k of keys) {
        const d = GW.FX.lumetri.p.find(p => p.k === k); const P = fx.params[k];
        if (d.t === 'color') f.append(frow(d.n, colorIn(GW.pv(P, lt), v => { GW.setPv(P, lt, v); GW.invalidate(); GW.commitSoon('ألوان'); })));
        else f.append(frow(d.n, rangeIn(GW.pv(P, lt), d.min, d.max, d.step, v => { GW.setPv(P, lt, v); GW.invalidate(); GW.commitSoon('ألوان'); GW.bus.emit('param'); })));
      }
    }
    if (GW.LUT) { f.append(sec('LUT')); GW.LUT.panelRows(f, c, fx, UI.form, renderLum); }
    if (GW.Color) GW.Color.panelRows(f, c, fx, UI.form, renderLum); // curves, HSL secondary, colour match (color.js)
    const rs = document.createElement('button'); rs.className = 'btn'; rs.textContent = 'إعادة الضبط'; rs.onclick = () => { const base = GW.newFx('lumetri'); fx.params = base.params; GW.commit('إعادة ضبط الألوان'); renderLum(); }; f.append(rs);
  }
  GW.bus.on('selection', () => renderLum()); GW.bus.on('hist', () => renderLum());

  /* ================= audio mixer ================= */
  GW.registerPanel('mixer', 'خلاط الصوت', (el) => { el.innerHTML = '<div class="mixer" data-a="m"></div>'; UI.mixEl = el; renderMixer(); });
  function strip(name, getDb, setDb, extra, master) {
    const d = document.createElement('div'); d.className = 'strip' + (master ? ' master' : '');
    d.innerHTML = `<span class="nm">${esc(name)}</span>`;
    if (extra && extra.pan) { const p = document.createElement('input'); p.type = 'range'; p.min = -100; p.max = 100; p.value = extra.pan.get(); p.title = 'التوازن'; p.style.width = '60px'; p.oninput = () => extra.pan.set(+p.value); d.append(p); }
    const fd = document.createElement('div'); fd.className = 'fader';
    const r = document.createElement('input'); r.type = 'range'; r.setAttribute('orient', 'vertical'); r.min = -60; r.max = 12; r.step = .1; r.value = getDb();
    const m = document.createElement('canvas'); m.width = 12; m.height = 200; if (master) UI.masterMeter = m;
    fd.append(r, m); d.append(fd);
    const db = document.createElement('span'); db.className = 'db'; db.textContent = (+getDb()).toFixed(1) + ' dB'; d.append(db);
    r.oninput = () => { setDb(+r.value); db.textContent = (+r.value).toFixed(1) + ' dB'; };
    r.onchange = () => { GW.commit('مستوى المسار'); if (GW.pb.playing) { const t = GW.seq().t; GW.stop(); GW.seq().t = t; GW.play(1); } };
    r.ondblclick = () => { r.value = 0; r.oninput(); r.onchange(); };
    if (extra && extra.ms) { const ms = document.createElement('div'); ms.className = 'ms'; for (const [k, n] of [['mute', 'M'], ['solo', 'S']]) { const b = document.createElement('button'); b.className = 'btn sm' + (extra.ms[k] ? ' on' : ''); b.textContent = n; b.onclick = () => { extra.ms[k] = extra.ms[k] ? 0 : 1; GW.commit(n === 'M' ? 'كتم' : 'منفرد'); renderMixer(); GW.TL.renderHeads(); }; ms.append(b); } d.append(ms); }
    return d;
  }
  function renderMixer() {
    const el = UI.mixEl; if (!el) return; const m = el.querySelector('[data-a=m]'); m.innerHTML = ''; const s = GW.seq();
    s.at.forEach(tr => m.append(strip(tr.name, () => tr.vol || 0, v => { tr.vol = v; }, { ms: tr })));
    m.append(strip('الرئيسي', () => s.master || 0, v => { s.master = v; }, null, true));
  }
  GW.bus.on('project', renderMixer); GW.bus.on('hist', renderMixer);
  GW.bus.on('tick', () => { const c = UI.masterMeter; if (!c || !c.isConnected) return; const g = c.getContext('2d'); const [l, r] = GW.Audio.playing ? GW.Audio.levels() : [0, 0]; const v = Math.max(l, r); const db = 20 * Math.log10(Math.max(v, 1e-5)); const h = clamp((db + 48) / 48, 0, 1) * c.height; g.clearRect(0, 0, c.width, c.height); g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = db > -3 ? '#e5484d' : db > -12 ? '#d8c94a' : '#2fae5a'; g.fillRect(0, c.height - h, c.width, h); });

  /* ================= markers & history ================= */
  GW.registerPanel('markers', 'العلامات', (el) => { el.innerHTML = '<div class="pscroll" data-a="b"></div>'; UI.mkEl = el; renderMarkers(); });
  function renderMarkers() {
    const el = UI.mkEl; if (!el) return; const b = el.querySelector('[data-a=b]'); const s = GW.seq(); b.innerHTML = '';
    if (!s.markers.length) { b.innerHTML = '<div class="empty">لا توجد علامات. اضغط M لإضافة علامة عند مؤشر التشغيل.</div>'; return; }
    for (const m of [...s.markers].sort((a, c) => a.t - c.t)) { const r = document.createElement('div'); r.className = 'mk-i'; r.innerHTML = `<i style="background:${esc(m.color || '#4e9a52')}"></i><span style="flex:1">${esc(m.name || 'علامة')}${m.note ? ` <span style="color:var(--mute)">— ${esc(m.note)}</span>` : ''}</span><span class="kv">${GW.fmtTC(m.t, s.fps)}</span>`; r.onclick = () => GW.seek(m.t); r.oncontextmenu = e => { e.preventDefault(); GW.menu(e.clientX, e.clientY, [{ label: 'حذف', action: () => { s.markers = s.markers.filter(x => x !== m); GW.commit('حذف علامة'); } }]); }; b.append(r); }
  }
  GW.bus.on('changed', renderMarkers); GW.bus.on('hist', renderMarkers); GW.bus.on('project', renderMarkers);
  GW.registerPanel('history', 'السجل', (el) => { el.innerHTML = '<div class="pscroll" data-a="b"></div>'; UI.hiEl = el; renderHist(); });
  function renderHist() {
    const el = UI.hiEl; if (!el) return; const b = el.querySelector('[data-a=b]'); b.innerHTML = '';
    GW.hist.labels.forEach((l, i) => { const r = document.createElement('div'); r.className = 'hist-i' + (i === GW.hist.idx ? ' cur' : i > GW.hist.idx ? ' fut' : ''); r.textContent = l; r.onclick = () => GW.hist.go(i); b.append(r); });
    b.scrollTop = b.scrollHeight;
  }
  GW.bus.on('hist', renderHist);

  /* ================= dialogs ================= */
  UI.seqSettings = () => {
    const s = GW.seq(); const body = document.createElement('div');
    const presets = [['1920x1080', 'HD 1080p (1920×1080)'], ['3840x2160', '4K UHD (3840×2160)'], ['2560x1440', '2K (2560×1440)'], ['1280x720', 'HD 720p (1280×720)'], ['1080x1920', 'عمودي 9:16 (1080×1920)'], ['1080x1350', 'بورتريه 4:5 (1080×1350)'], ['1080x1080', 'مربع (1080×1080)'], ['custom', 'مخصص']];
    const cur = presets.find(p => p[0] === s.w + 'x' + s.h) ? s.w + 'x' + s.h : 'custom';
    body.innerHTML = `<label class="fld"><span>الاسم</span><input class="inp" data-k="name" value="${esc(s.name)}"></label>
      <label class="fld"><span>الإعداد المسبق</span><select class="sel" data-k="preset">${presets.map(([v, n]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="grid2"><label class="fld"><span>العرض</span><input class="inp" type="number" data-k="w" value="${s.w}"></label><label class="fld"><span>الارتفاع</span><input class="inp" type="number" data-k="h" value="${s.h}"></label></div>
      <label class="fld"><span>معدل الإطارات</span><select class="sel" data-k="fps">${[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map(f => `<option ${f == s.fps ? 'selected' : ''}>${f}</option>`).join('')}</select></label>`;
    const q = k => body.querySelector(`[data-k=${k}]`);
    q('preset').onchange = () => { const v = q('preset').value; if (v !== 'custom') { const [w, h] = v.split('x'); q('w').value = w; q('h').value = h; } };
    GW.modal({ title: 'إعدادات التسلسل', body, buttons: [{ label: 'إلغاء' }, { label: 'موافق', primary: true, action: () => {
      const w = Math.max(16, Math.round((+q('w').value || 1920) / 2) * 2), h = Math.max(16, Math.round((+q('h').value || 1080) / 2) * 2);
      const kx = w / s.w, ky = h / s.h; if (kx !== 1 || ky !== 1) for (const c of s.clips) if (c.motion) { const sc = (p) => { if (p.k) p.k.forEach(k => k.v = [k.v[0] * kx, k.v[1] * ky]); p.v = [p.v[0] * kx, p.v[1] * ky]; }; sc(c.motion.pos); if (c.cam && c.cam.poi) sc(c.cam.poi); if (c.kind === 'text' || c.kind === 'map' || c.kind === 'color' || c.kind === 'adjust' || c.kind === 'shape') { c.sw = w; c.sh = h; c.motion.anchor = GW.P([w / 2, h / 2]); } }
      s.name = q('name').value || s.name; s.w = w; s.h = h; s.fps = +q('fps').value; GW.commit('إعدادات التسلسل'); GW.bus.emit('project');
    } }] });
  };
  UI.speedDialog = (clips) => {
    if (!clips.length) { GW.toast('حدد مقطعًا'); return; } const c = clips[0]; const s = GW.seq();
    const body = document.createElement('div');
    body.innerHTML = `<div class="grid2"><label class="fld"><span>السرعة %</span><input class="inp" type="number" data-k="sp" value="${Math.round((c.speed || 1) * 1000) / 10}"></label><label class="fld"><span>المدة</span><input class="inp" data-k="dur" value="${GW.fmtTC(c.dur, s.fps)}" dir="ltr"></label></div><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-k="ripple" checked> إزاحة المقاطع التالية</label>`;
    const q = k => body.querySelector(`[data-k=${k}]`);
    q('sp').oninput = () => { const sp = (+q('sp').value || 100) / 100; q('dur').value = GW.fmtTC(c.dur * (c.speed || 1) / sp, s.fps); };
    q('dur').oninput = () => { const d = GW.parseTC(q('dur').value, s.fps); if (d > 0) q('sp').value = Math.round(c.dur * (c.speed || 1) / d * 1000) / 10; };
    GW.modal({ title: 'السرعة / المدة', body, buttons: [{ label: 'إلغاء' }, { label: 'موافق', primary: true, action: () => {
      const sp = clamp((+q('sp').value || 100) / 100, .05, 20); const ripple = q('ripple').checked; const all = new Set(clips); clips.forEach(x => GW.linked(s, x).forEach(l => all.add(l)));
      for (const x of all) { const old = x.dur; const nd = x.dur * (x.speed || 1) / sp; x.speed = sp; x.dur = nd; if (ripple) for (const o of s.clips) if (!all.has(o) && o.tt === x.tt && o.ti === x.ti && o.start >= x.start + old - 1e-6) o.start += nd - old; }
      GW.commit('السرعة / المدة');
    } }] });
  };
  UI.shortcuts = () => {
    const list = [['تشغيل / إيقاف', 'Space'], ['تشغيل للأمام / للخلف / إيقاف', 'L / J / K'], ['إطار للأمام / للخلف', '→ / ←'], ['نقطة التعديل التالية / السابقة', '↓ / ↑'], ['تحديد دخول / خروج', 'I / O'], ['إضافة علامة', 'M'],
      ['أداة التحديد', 'V'], ['أداة الشفرة', 'C'], ['تعديل مع إزاحة', 'B'], ['تعديل متدحرج', 'N'], ['تمديد السرعة', 'R'], ['انزلاق', 'Y'], ['القلم', 'P'], ['اليد', 'H'], ['التكبير', 'Z'], ['النص', 'T'],
      ['إضافة تعديل', 'Ctrl+K'], ['حذف مع إزاحة', 'Shift+Delete'], ['تشذيب مع إزاحة إلى المؤشر', 'Q / W'], ['رفع / استخراج', "; / '"], ['إدراج / استبدال من المصدر', ', / .'],
      ['انتقال فيديو افتراضي', 'Ctrl+D'], ['انتقال صوت افتراضي', 'Ctrl+Shift+D'], ['نسخ / قص / لصق', 'Ctrl+C / X / V'], ['لصق السمات', 'Ctrl+Alt+V'], ['ربط / فك ربط', 'Ctrl+L'], ['السرعة / المدة', 'Ctrl+R'],
      ['تكبير / تصغير الخط الزمني', '= / -'], ['عرض التسلسل كاملًا', '\\'], ['نص جديد', 'Ctrl+T'], ['خريطة حربية جديدة', 'Ctrl+G'], ['استيراد', 'Ctrl+I'], ['تصدير', 'Ctrl+M'], ['حفظ', 'Ctrl+S'], ['تراجع / إعادة', 'Ctrl+Z / Ctrl+Shift+Z'], ['تكبير اللوحة', '`'], ['المحاذاة المغناطيسية (في الخط الزمني)', 'S']];
    GW.modal({ title: 'اختصارات لوحة المفاتيح', width: 560, body: `<div class="kbd-list">${list.map(([a, k]) => `<span>${esc(a)}</span><kbd>${esc(k)}</kbd>`).join('')}</div>` });
  };
})();
