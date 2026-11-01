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
  /* pro looks built on fx_pro.js (Deep Glow, real VHS, CRT, film…); `tr` = one-click transition preset */
  if (GW.FXPro) Object.assign(PRESETS, {
    ww2Archive: { n: 'أرشيف حرب عالمية', cat: 'مظاهر احترافية' }, vhsFamily: { n: 'تسجيل VHS عائلي', cat: 'مظاهر احترافية' }, oldBroadcast: { n: 'بث تلفزيوني قديم', cat: 'مظاهر احترافية' }, opsRoom: { n: 'شاشة غرفة عمليات', cat: 'مظاهر احترافية' },
    film16: { n: 'فيلم 16مم', cat: 'مظاهر احترافية' }, dreamPro: { n: 'حلم/ذكرى (توهج عميق)', cat: 'مظاهر احترافية' }, memFlash: { n: 'فلاش ذكرى', cat: 'مظاهر احترافية' }, flashCut: { n: 'قطع مع وميض', cat: 'مظاهر احترافية' }, kodakLook: { n: 'مظهر سينما كوداك', cat: 'مظاهر احترافية' }, noirLook: { n: 'نوار كلاسيكي', cat: 'مظاهر احترافية' }, heatDesert: { n: 'حر الصحراء', cat: 'مظاهر احترافية' }, holoMsg: { n: 'رسالة هولوغرام', cat: 'مظاهر احترافية' },
    vhs90s: { n: 'فيديو منزلي 90s', cat: 'VHS' }, vhsDamaged: { n: 'شريط تالف', cat: 'VHS' }, vhsNews: { n: 'أرشيف أخبار', cat: 'VHS' },
    crtOldTV: { n: 'تلفزيون قديم', cat: 'CRT' }, crt80s: { n: 'شاشة كمبيوتر 80s', cat: 'CRT' }, crtSecurity: { n: 'مونيتر أمني', cat: 'CRT' },
    grain16: { n: 'حبيبات 16مم', cat: 'فيلم' }, grain35: { n: 'حبيبات 35مم', cat: 'فيلم' }, super8: { n: 'سوبر 8 منزلي', cat: 'فيلم' },
    glowSoft: { n: 'توهج عميق ناعم', cat: 'توهج' }, glowAnam: { n: 'توهج أنامورفي أزرق', cat: 'توهج' }, glowSun: { n: 'شمس ذهبية مع وهج', cat: 'توهج' },
    neonText: { n: 'توهج نيون للنص', cat: 'نصوص' }, neonFlicker: { n: 'نيون وامض للنص', cat: 'نصوص' }, goldText: { n: 'نص ذهبي لامع', cat: 'نصوص' }, outlineShadow: { n: 'حدود وظل طويل للنص', cat: 'نصوص' },
    trVhs: { n: 'ترجيع VHS', cat: 'انتقالات جاهزة', tr: 'vhsRewind' }, trCrt: { n: 'إطفاء شاشة CRT', cat: 'انتقالات جاهزة', tr: 'crtOff' }, trGlitch: { n: 'قطع جليتش', cat: 'انتقالات جاهزة', tr: 'glitchCut' }, trBurn: { n: 'احتراق الفيلم', cat: 'انتقالات جاهزة', tr: 'filmBurn' },
    trLeak: { n: 'مسح بتسرب ضوئي', cat: 'انتقالات جاهزة', tr: 'leakWipe' }, trWhip: { n: 'سحب سريع مع ضبابية حركة', cat: 'انتقالات جاهزة', tr: 'whipBlur' }, trZoom: { n: 'تكبير عبر المشهد', cat: 'انتقالات جاهزة', tr: 'zoomThrough' },
    trExp: { n: 'تعريض ضبابي', cat: 'انتقالات جاهزة', tr: 'expBlur' }, trFlare: { n: 'انتقال وهج عدسة', cat: 'انتقالات جاهزة', tr: 'flareT' }, trFlick: { n: 'قطع وامض', cat: 'انتقالات جاهزة', tr: 'flickerCut' }
  });
  GW.FX_PRESETS = PRESETS;
  const FX_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 15l3-6 2 4 1-2 2 4"/></svg>';
  const TR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="11" height="12" rx="1.5"/><rect x="11" y="6" width="11" height="12" rx="1.5" fill="currentColor" fill-opacity=".25"/></svg>';
  const AU_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>';
  /* v6 browser: search + category chips (all / favourites / presets / video / transitions / audio / audio transitions), sub-category
     headers, a star per item (favourites in localStorage), and a live preview while hovering: the effect is applied temporarily to the
     selected video clip and the Program redraws (never committed — removed on leave, click, drag or any commit). */
  let fxQuery = '', closedCats = {}, fxCat = 'all';
  let favs = new Set(); try { favs = new Set(JSON.parse(localStorage.getItem('qq.fxFavs') || '[]')); } catch (e) {}
  const saveFavs = () => { try { localStorage.setItem('qq.fxFavs', JSON.stringify([...favs])); } catch (e) {} };
  const FX_CATS = [['all', 'الكل', 'grid'], ['fav', 'المفضلة', 'star'], ['preset', 'قوالب', 'sparkle'], ['v', 'فيديو', 'wand'], ['tr', 'انتقالات', 'layers'], ['a', 'صوت', 'sound'], ['atr', 'انتقالات صوت', 'wave']];
  GW.registerPanel('effects', 'التأثيرات', (el) => {
    el.innerHTML = `<div class="search fx6-search" dir="rtl">${GW.ico('search', 14, 'fx6-si')}<input class="inp" placeholder="ابحث عن تأثير أو انتقال…" data-a="q"></div><div class="fx6-cats" data-a="cats" dir="rtl"></div><div class="pscroll tree fx6" data-a="tree"></div><div class="fx6-foot" dir="rtl" data-a="foot">${GW.ico('play', 12)}<span>مرّر فوق تأثير لمعاينته على المقطع المحدد · انقر مرتين للتطبيق أو اسحبه إلى مقطع</span></div>`;
    const cats = el.querySelector('[data-a=cats]');
    const paintCats = () => { cats.innerHTML = FX_CATS.concat(UI.fxExtraCats ? UI.fxExtraCats() : []).map(([k, n, ic]) => `<button class="chip ${fxCat === k ? 'on' : ''}" data-c="${k}">${GW.ico(ic, 12)}<span>${n}</span>${k === 'fav' && favs.size ? `<i>${favs.size}</i>` : ''}</button>`).join(''); cats.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { fxCat = b.dataset.c; paintCats(); renderTree(el.querySelector('[data-a=tree]')); }); };
    UI.fxPaintCats = paintCats; paintCats();
    UI.fxSetCat = (k) => { fxCat = k; paintCats(); renderTree(el.querySelector('[data-a=tree]')); }; UI.fxRefresh = () => { if (el.isConnected) { paintCats(); renderTree(el.querySelector('[data-a=tree]')); } }; // extra groups (e.g. «من أدوبي», adobe_import.js)
    el.querySelector('[data-a=q]').oninput = e => { fxQuery = e.target.value.trim(); renderTree(el.querySelector('[data-a=tree]')); };
    el.querySelector('[data-a=q]').onkeydown = e => e.stopPropagation();
    renderTree(el.querySelector('[data-a=tree]'));
  });
  // ---- hover preview (temporary, never committed) ----
  const PV = { c: null, snap: null, t: 0 };
  function endPreview() { clearTimeout(PV.t); if (!PV.c) return; const c = PV.c; if (PV.snap) { c.fx = PV.snap.fx; c.motion = PV.snap.motion; c.opacity = PV.snap.opacity; } PV.c = PV.snap = null; GW.invalidate(); const f = document.querySelector('.fx6-foot'); if (f) f.classList.remove('pv'); }
  function startPreview(grp, k) {
    endPreview(); if (grp !== 'v' && grp !== 'preset' && !(grp === 'adobe' && UI.fxPreviewExtra)) return; const c = [...GW.sel.clips].map(id => GW.clipById(id)).find(x => x && x.tt === 'v' && x.motion); if (!c) return;
    PV.t = setTimeout(() => { PV.c = c; PV.snap = { fx: c.fx, motion: c.motion, opacity: c.opacity }; c.fx = (c.fx || []).slice(); c.motion = GW.clone(c.motion); c.opacity = GW.clone(c.opacity);
      try { if (grp === 'v') c.fx.push(GW.newFx(k, 'v')); else if (grp === 'adobe') UI.fxPreviewExtra(c, grp, k); else applyPreset(c, k); } catch (e) { endPreview(); return; }
      GW.invalidate(); const f = document.querySelector('.fx6-foot'); if (f) f.classList.add('pv'); }, 220);
  }
  UI.fxEndPreview = endPreview;
  // floating animated thumbnail (transitions, or effects/looks when no clip is selected): rendered offline by fx_pro.js
  const TH = { el: null, iv: 0, t: 0 };
  function endThumb() { clearTimeout(TH.t); clearInterval(TH.iv); if (TH.el) TH.el.remove(); TH.el = null; }
  function startThumb(leaf, grp, k) {
    endThumb(); if (!GW.FXPro || !GW.FXPro.thumbs) return;
    const hasSel = [...GW.sel.clips].map(id => GW.clipById(id)).some(x => x && x.tt === 'v' && x.motion);
    if (!(grp === 'tr' || ((grp === 'v' || grp === 'preset') && !hasSel))) return;
    TH.t = setTimeout(() => {
      let spec;
      if (grp === 'tr') spec = { group: 'tr', type: k };
      else if (grp === 'preset' && PRESETS[k] && PRESETS[k].tr) spec = { group: 'tr', type: PRESETS[k].tr };
      else if (grp === 'preset') { const fake = { fx: [], motion: { pos: GW.P([0, 0]), anchor: GW.P([0, 0]), scale: GW.P(100), scaleW: GW.P(100), rot: GW.P(0), uni: 1 }, opacity: GW.P(100), dur: 5, tt: 'v' }; try { applyPreset(fake, k); } catch (e) { return; } if (!fake.fx.length) return; spec = { fx: fake.fx }; }
      else spec = { group: 'v', type: k };
      let frames; try { frames = GW.FXPro.thumbs(spec, grp === 'v' || (grp === 'preset' && !spec.group) ? 6 : 10, 224); } catch (e) { console.warn('thumb', e); return; }
      if (!frames || !frames.length) return;
      const box = document.createElement('div'); box.className = 'fx6-thumb'; box.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;background:#0c0c0e;border:1px solid var(--line,#333);border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
      const cv = document.createElement('canvas'); cv.width = frames[0].width; cv.height = frames[0].height; cv.style.cssText = 'display:block;width:224px;border-radius:5px'; box.append(cv); document.body.append(box);
      const r = leaf.getBoundingClientRect(); const bw = 234; let x = r.left - bw - 8; if (x < 4) x = r.right + 8; box.style.left = x + 'px'; box.style.top = Math.max(4, Math.min(innerHeight - 140, r.top - 40)) + 'px';
      const g = cv.getContext('2d'); let i = 0; const draw = () => { g.putImageData(frames[i % frames.length], 0, 0); i++; }; draw(); TH.iv = setInterval(draw, grp === 'tr' ? 110 : 160); TH.el = box;
    }, 260);
  }
  { const c0 = GW.commit; if (c0) GW.commit = function () { endPreview(); return c0.apply(this, arguments); }; }
  function renderTree(box) {
    endPreview(); endThumb(); box.innerHTML = '';
    const groups = [
      ['قوالب جاهزة', 'preset', Object.entries(PRESETS).map(([k, v]) => [k, v.n, v.cat || 'مظاهر سريعة'])],
      ['تأثيرات الفيديو', 'v', Object.entries(GW.FX).map(([k, v]) => [k, v.n, v.cat])],
      ['انتقالات الفيديو', 'tr', Object.entries(GW.TRANS).map(([k, v]) => [k, v.n, v.cat])],
      ['تأثيرات الصوت', 'a', Object.entries(GW.AFX).map(([k, v]) => [k, v.n, null])],
      ['انتقالات الصوت', 'atr', Object.entries(GW.ATRANS).map(([k, v]) => [k, v.n, null])]
    ];
    const q = fxQuery.toLowerCase(); let total = 0;
    if (UI.fxExtraGroups) for (const g of UI.fxExtraGroups(fxCat, q)) groups.push(g);
    for (const [title, grp, items] of groups) {
      if (fxCat !== 'all' && fxCat !== 'fav' && fxCat !== grp) continue;
      const list = items.filter(([k, n]) => (!q || n.toLowerCase().includes(q) || k.toLowerCase().includes(q)) && (fxCat !== 'fav' || favs.has(grp + ':' + k))); if (!list.length) continue; total += list.length;
      const cat = document.createElement('div'); cat.className = 'cat' + (closedCats[grp] && !q ? ' closed' : ''); cat.innerHTML = `<span>${esc(title)}</span><span class="cat-n">${list.length}</span>`; box.append(cat);
      const wrap = document.createElement('div'); wrap.hidden = !!closedCats[grp] && !q; box.append(wrap);
      cat.onclick = () => { closedCats[grp] = !closedCats[grp]; renderTree(box); };
      let lastSub = null;
      { const ord = new Map(); list.forEach(x => { if (!ord.has(x[2])) ord.set(x[2], ord.size); }); list.sort((x, y) => ord.get(x[2]) - ord.get(y[2])); } // one header per sub-category (stable within it)
      for (const [k, n, sub] of list) {
        if (sub && sub !== lastSub) { const sc = document.createElement('div'); sc.className = 'fx6-sub'; sc.textContent = sub; wrap.append(sc); lastSub = sub; }
        const id = grp + ':' + k; const leaf = document.createElement('div'); leaf.className = 'leaf'; leaf.draggable = true;
        leaf.innerHTML = (grp === 'tr' || grp === 'atr' ? TR_ICON : grp === 'a' ? AU_ICON : grp === 'preset' ? GW.ico('sparkle', 14) : FX_ICON) + `<span class="lf-n">${esc(n)}</span><button class="lf-star ${favs.has(id) ? 'on' : ''}" title="${favs.has(id) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}">${GW.ico(favs.has(id) ? 'starf' : 'star', 13)}</button>`;
        if (UI.fxDecorateLeaf) UI.fxDecorateLeaf(leaf, grp, k);
        leaf.querySelector('.lf-star').onclick = (e) => { e.stopPropagation(); if (favs.has(id)) favs.delete(id); else favs.add(id); saveFavs(); UI.fxPaintCats && UI.fxPaintCats(); renderTree(box); };
        leaf.addEventListener('dragstart', e => { endPreview(); e.dataTransfer.setData('application/x-gws-fx', JSON.stringify({ group: grp, type: k })); e.dataTransfer.effectAllowed = 'copy'; });
        leaf.onmouseenter = () => { startPreview(grp, k); startThumb(leaf, grp, k); }; leaf.onmouseleave = () => { endPreview(); endThumb(); }; leaf.onmousedown = () => { endPreview(); endThumb(); };
        leaf.ondblclick = () => { endPreview(); UI.applyFxTo({ group: grp, type: k }, null, {}); };
        wrap.append(leaf);
      }
    }
    if (!total) box.innerHTML = fxCat === 'fav' && !q ? '<div class="empty">لا توجد مفضلة بعد — انقر النجمة بجانب أي تأثير لتجده هنا بسرعة.</div>' : '<div class="empty">لا توجد نتائج — جرّب كلمة أخرى أو فئة «الكل».</div>';
  }
  UI.applyFxTo = (f, clip, hit) => {
    const s = GW.seq(); let clips = clip ? [clip] : [...GW.sel.clips].map(id => GW.clipById(id)).filter(Boolean);
    if (!clips.length) { GW.toast('حدد مقطعًا أولًا أو اسحب التأثير إلى مقطع'); return; }
    if (UI.fxApplyExtra && UI.fxApplyExtra(f, clips)) return;
    if (f.group === 'tr' || f.group === 'atr') {
      const tt = f.group === 'tr' ? 'v' : 'a';
      for (const c of clips.filter(c => c.tt === tt)) { let side = hit && hit.edge; if (!side && hit && hit.t != null) side = hit.t > c.start + c.dur / 2 ? 'R' : 'L'; GW.TL.addTransitionAt(f.type, c, side || 'R'); }
      return;
    }
    if (f.group === 'preset' && PRESETS[f.type] && PRESETS[f.type].tr) return UI.applyFxTo({ group: 'tr', type: PRESETS[f.type].tr }, clip, hit);
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
  // keyframed param in clip-local seconds: pts = [[t, v], …]
  function kfp(f, key, pts, e) { f.params[key] = { v: pts[0][1], k: pts.map(([t, v]) => ({ t, v, e: e || 'ease' })) }; return f; }
  function applyProPreset(c, k) {
    const has = (t) => !!GW.FX[t]; if (!has('deepglow')) return;
    const D = Math.max(.5, c.dur || 5);
    if (k === 'ww2Archive') { fxWith(c, 'filmemu', { stock: 'trix', contrast: 25 }); fxWith(c, 'olddoc', { tone: 12, grain: 60, vig: 65, flicker: 45, weave: 40, dust: 45, contrast: 35, soft: 35 }); fxWith(c, 'filmdamage', { dust: 55, scratch: 50, hair: 25, weave: 0, flicker: 0, blotch: 12, tone: 'mix', fps: 18 }); fxWith(c, 'letterbox', { ratio: '133' }); }
    if (k === 'vhsFamily') { fxWith(c, 'lumetri', { temp: 18, sat: 110, contrast: -6 }); fxWith(c, 'vhsreal', { gen: 40, osd: 'play', osdDate: 1, year: 1996, month: 7, day: 23, hour: 17, minute: 12, crop43: 1, track: 8 }); }
    if (k === 'oldBroadcast') { fxWith(c, 'vhsreal', { gen: 25, noiz: 30, track: 0, headSw: 0, crop43: 1, jitter: 10, wobble: 15 }); fxWith(c, 'crt', { curv: 45, mask: 'shadow', lines: 480, glare: 30, bloom: 45, border: 4 }); }
    if (k === 'opsRoom') { fxWith(c, 'lumetri', { sat: 55, temp: -30, contrast: 22, shadowTint: '#5a7c96' }); fxWith(c, 'crt', { curv: 18, corner: 15, mask: 'aperture', maskSize: 2.5, lines: 540, roll: 35, glare: 35, bloom: 50, border: 2, bright: 120 }); fxWith(c, 'hud', { style: 'target', color: '#7dd8ff', op: 55, grid: 20, scan: 40 }); }
    if (k === 'film16') { fxWith(c, 'filmemu', { stock: 'portra', fade: 15 }); fxWith(c, 'halation', { amount: 60 }); fxWith(c, 'filmgrain', { stock: '16', amount: 70 }); fxWith(c, 'filmdamage', { dust: 25, scratch: 15, hair: 10, weave: 35, flicker: 20, blotch: 0 }); fxWith(c, 'lensdist', { k1: 8, ca: 20, vig: 45 }); }
    if (k === 'dreamPro') { fxWith(c, 'deepglow', { thr: 50, radius: 420, int: .6, colorMode: 'tint', tint: '#ffd6a8' }); fxWith(c, 'bokeh', { radius: 3 }); fxWith(c, 'filmemu', { stock: 'portra', fade: 30, warmth: 20 }); fxWith(c, 'vignette', { amount: -35, feather: 80 }); }
    if (k === 'memFlash') { const g = fxWith(c, 'deepglow', { thr: 30, radius: 500, colorMode: 'tint', tint: '#fff0d8' }); kfp(g, 'int', [[0, 4], [.45, .5], [D, .5]]); const l = fxWith(c, 'lumetri', { sat: 70, temp: 12, fade: 15 }); kfp(l, 'exposure', [[0, 2.5], [.35, 0]]); fxWith(c, 'filmgrain', { amount: 35 }); fxWith(c, 'vignette', { amount: 45 }); }
    if (k === 'flashCut') { const l = fxWith(c, 'lumetri', {}); kfp(l, 'exposure', [[0, 4], [.1, 1.4], [.28, 0]], 'linear'); const g = fxWith(c, 'deepglow', { thr: 20, radius: 400 }); kfp(g, 'int', [[0, 5], [.3, 0]], 'linear'); }
    if (k === 'kodakLook') { fxWith(c, 'filmemu', { stock: 'k2383' }); fxWith(c, 'halation', { amount: 45 }); fxWith(c, 'filmgrain', { stock: '35', amount: 35 }); fxWith(c, 'letterbox', { ratio: '239' }); }
    if (k === 'noirLook') { fxWith(c, 'noir', {}); fxWith(c, 'filmgrain', { amount: 40, color: 0 }); fxWith(c, 'filmdamage', { dust: 15, scratch: 10, hair: 5, weave: 15, flicker: 25 }); }
    if (k === 'heatDesert') { fxWith(c, 'lumetri', { temp: 35, sat: 90, contrast: 12, exposure: .15 }); fxWith(c, 'heatwave', { amount: 25, bottom: 70 }); fxWith(c, 'deepglow', { thr: 78, radius: 260, int: .5, colorMode: 'tint', tint: '#ffb860' }); }
    if (k === 'holoMsg') { fxWith(c, 'holo', {}); fxWith(c, 'deepglow', { thr: 30, radius: 160, int: .8 }); }
    if (k === 'vhs90s') fxWith(c, 'vhsreal', { gen: 35, osd: 'play', osdDate: 1, year: 1995, track: 6, crop43: 1 });
    if (k === 'vhsDamaged') fxWith(c, 'vhsreal', { gen: 85, noiz: 70, drop: 70, track: 70, trackSpd: 2.5, wobble: 70, headSw: 90, jitter: 60, sat: 60, drift: 70, halo: 70 });
    if (k === 'vhsNews') { fxWith(c, 'lumetri', { sat: 80, contrast: 10 }); fxWith(c, 'vhsreal', { gen: 55, noiz: 40, drop: 25, track: 10, headSw: 70, sat: 75, drift: 40, crop43: 1 }); }
    if (k === 'crtOldTV') fxWith(c, 'crt', { curv: 70, corner: 55, vig: 60, mask: 'shadow', maskSize: 3, lines: 400, bloom: 60, conv: 40, flicker: 25, roll: 30, glare: 40, border: 5 });
    if (k === 'crt80s') fxWith(c, 'crt', { curv: 40, corner: 30, mask: 'aperture', maskSize: 2, lines: 240, beamMin: 20, beamMax: 60, phos: 'amber', bloom: 80, bloomR: 8, glare: 30, border: 6, bright: 130 });
    if (k === 'crtSecurity') { fxWith(c, 'lumetri', { sat: 0, contrast: 25 }); fxWith(c, 'crt', { curv: 25, mask: 'slot', lines: 360, phos: 'white', roll: 50, rollSpd: 1.5, noiz: 30, flicker: 30, glare: 20, border: 3 }); fxWith(c, 'vhsreal', { gen: 30, osd: 'rec', osdDate: 1, sat: 0, crop43: 0, track: 0 }); }
    if (k === 'grain16') fxWith(c, 'filmgrain', { stock: '16', amount: 70 });
    if (k === 'grain35') fxWith(c, 'filmgrain', { stock: '35', amount: 45 });
    if (k === 'super8') { fxWith(c, 'filmemu', { stock: 'kchrome', fade: 20, warmth: 25 }); fxWith(c, 'filmgrain', { stock: '8', amount: 80 }); fxWith(c, 'filmdamage', { dust: 45, scratch: 20, weave: 60, flicker: 45, fps: 18 }); fxWith(c, 'lensdist', { k1: 15, vig: 70, ca: 40 }); fxWith(c, 'letterbox', { ratio: '133' }); }
    if (k === 'glowSoft') fxWith(c, 'deepglow', { thr: 45, radius: 350, int: 1 });
    if (k === 'glowAnam') fxWith(c, 'deepglow', { thr: 70, radius: 260, int: .6, aspect: 35, streak: 70, streakLen: 80 });
    if (k === 'glowSun') { fxWith(c, 'deepglow', { thr: 50, radius: 600, int: 1.1, colorMode: 'grad', inner: '#fff4d0', outer: '#ff6a1a' }); fxWith(c, 'lensflare', { kind: 'sun' }); }
    if (k === 'neonText') fxWith(c, 'neon', { color: '#ff2bd6' });
    if (k === 'neonFlicker') fxWith(c, 'neon', { color: '#25e8ff', flicker: 45 });
    if (k === 'goldText') { fxWith(c, 'luster', {}); fxWith(c, 'deepglow', { thr: 60, radius: 120, int: .6, colorMode: 'tint', tint: '#ffcf6a' }); }
    if (k === 'outlineShadow') { fxWith(c, 'stroke', { width: 5, color: '#111111' }); fxWith(c, 'longshadow', { len: 260, op: 45 }); }
  }
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
    if (PRESETS[k] && PRESETS[k].cat) applyProPreset(c, k);
    if (k === 'flashback') { fxWith(c, 'bw', { amount: 70 }); fxWith(c, 'glow', { thr: 50, radius: 30, int: .8 }); fxWith(c, 'vignette', { amount: 70, feather: 80 }); fxWith(c, 'grain', { amount: 25 }); }
  }

  /* ================= essential graphics ================= */
  let egTab = 'browse', localFonts = null;
  GW.registerPanel('graphics', 'الرسومات الأساسية', (el) => {
    el.innerHTML = `<div class="ptool" dir="rtl"><div class="seg" data-a="tabs" style="flex:1"><button data-t="browse">استعراض</button><button data-t="mg">قوالب متحركة</button><button data-t="shapes">أشكال</button><button data-t="edit">تحرير</button></div></div><div class="pscroll" data-a="body"></div>`;
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { egTab = b.dataset.t; renderEG(); });
    UI.egEl = el; renderEG();
  });
  function selText() { const c = [...GW.sel.clips].map(id => GW.clipById(id)).find(c => c && (c.kind === 'text' || c.kind === 'shape' || (c.kind === 'color' && c.masks && c.masks.length))); return c || null; }
  function renderEG() {
    const el = UI.egEl; if (!el) return; const c = selText(); if (c && egTab === 'browse' && UI._egAuto !== c.id) { egTab = 'edit'; UI._egAuto = c.id; }
    el.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === egTab));
    const body = el.querySelector('[data-a=body]');
    if (egTab === 'shapes' && GW.ShapeLib) { if (!body.querySelector('.shl')) { body.innerHTML = ''; GW.ShapeLib.renderBrowser(body); } return; } // shapes library (shape_lib.js) keeps its search / scroll across selection changes
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
        if (GW.ShapeLib) { const b = document.createElement('button'); b.className = 'btn sm'; b.innerHTML = GW.ico('shape_star', 13) + ' مكتبة الأشكال (' + GW.ShapeLib.items.length + ')'; b.onclick = () => UI.egTab('shapes'); row2.append(b); }
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
    f.append(sec('الشكل'), frow('النوع', selectIn(GW.Shape.typeOpts ? GW.Shape.typeOpts(sh) : GW.Shape.TYPES, sh.type, v => { if (v === 'path' && sh.type !== 'path' && GW.Shape.toPath) { GW.Shape.toPath(c); renderEG(); return; } sh.type = v; ch(); renderEG(); })));
    if (sh.type === 'lib' && GW.Shape.toPath) { const cv = document.createElement('button'); cv.className = 'btn sm'; cv.textContent = 'تحويل إلى مسار قابل للتحرير'; cv.onclick = () => { GW.Shape.toPath(c); renderEG(); }; f.append(frow('مكتبة', cv)); }
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
    const s = GW.seq(); const t = s.t; const dur = GW.durDefaults.text || 5; const ti = freeVTrack(s, t, dur);
    const p = presetIdx != null ? GW.TITLE_PRESETS[presetIdx] : null;
    const c = GW.newClip('text', { ti, start: t, dur, name: p ? p.n : 'نص' });
    if (p) Object.assign(c.text, GW.clone(p.t));
    if (posPx) c.motion.pos = GW.P([Math.round(posPx[0]), Math.round(posPx[1])]); else if (p && p.pos) c.motion.pos = GW.P([Math.round(p.pos[0] * s.w), Math.round(p.pos[1] * s.h)]);
    c.name = (c.text.str.split('\n')[0] || 'نص').slice(0, 40);
    s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.commit('إضافة نص'); GW.bus.emit('selection');
    egTab = 'edit'; if (!GW.isShown('graphics')) GW.showPanel('graphics'); renderEG();
  };
  UI.addGenerator = (kind) => { const s = GW.seq(); const D = GW.durDefaults.still || 5; const ti = freeVTrack(s, s.t, D); const c = GW.newClip(kind, { ti, start: s.t, dur: D }); if (kind === 'adjust') c.fx.push(GW.newFx('lumetri')); s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.commit(kind === 'color' ? 'لون ثابت' : kind === 'null' ? 'طبقة فارغة' : kind === 'camera' ? 'كاميرا' : 'طبقة ضبط'); GW.bus.emit('selection'); };
  UI.addShapeLayer = (type) => { if (!GW.Shape) return null; const c = GW.Shape.add(type); egTab = 'edit'; renderEG(); return c; }; // «شكل جديد»: vector shape layer (shape.js)
  UI.addShape = (kind) => {
    const s = GW.seq(); const D = GW.durDefaults.still || 5; const ti = freeVTrack(s, s.t, D); const c = GW.newClip('color', { ti, start: s.t, dur: D, color: kind === 'bar' ? '#d6202f' : '#2f8ef0', name: kind === 'ellipse' ? 'دائرة' : kind === 'bar' ? 'شريط' : 'مستطيل' });
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
  GW.registerPanel('lumetri', 'ألوان Lumetri', (el) => { el.innerHTML = '<div class="pscroll lum6" data-a="b"></div>'; UI.lumEl = el; renderLum(); });
  /* v6: collapsible sections like Premiere's Lumetri — أساسي / إبداعي و LUT / المنحنيات / العجلات / HSL ثانوي / تظليل الحواف / مطابقة.
     Open state per section in localStorage. Wheels map onto the shadow / highlight tint colours (neutral #808080 = centre). */
  let lumOpen = { basic: 1, creative: 1, curves: 0, wheels: 1, hsl: 0, vig: 0, match: 0 }; try { Object.assign(lumOpen, JSON.parse(localStorage.getItem('qq.lumOpen') || '{}')); } catch (e) {}
  const LUM_SECS = [['basic', 'تصحيح أساسي', 'sparkle'], ['creative', 'إبداعي و LUT', 'color'], ['curves', 'المنحنيات', 'track'], ['wheels', 'عجلات الألوان', 'globe'], ['hsl', 'HSL ثانوي', 'wand'], ['vig', 'تظليل الحواف', 'image'], ['match', 'مطابقة اللون', 'split']];
  function lumSec(root, key, title, ico, badge) {
    const d = document.createElement('div'); d.className = 'lsec' + (lumOpen[key] ? ' open' : ''); d.dataset.sec = key;
    const h = document.createElement('button'); h.className = 'lsec-h'; h.innerHTML = `${GW.ico('down', 12, 'lsec-tw')}${GW.ico(ico, 14)}<span>${esc(title)}</span>${badge ? `<i class="lsec-b">${esc(badge)}</i>` : ''}`;
    const body = document.createElement('div'); body.className = 'lsec-body form';
    h.onclick = () => { lumOpen[key] = lumOpen[key] ? 0 : 1; d.classList.toggle('open', !!lumOpen[key]); try { localStorage.setItem('qq.lumOpen', JSON.stringify(lumOpen)); } catch (e) {} };
    d.append(h, body); root.append(d); return body;
  }
  const hex2rgb = (h) => { const n = parseInt(String(h || '#808080').slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  // wheel position (angle = hue, radius = strength) ↔ tint colour around neutral grey (HSV with V = 128/255)
  const wheelToHex = (ang, rad) => { const h = ((ang / (2 * Math.PI)) % 1 + 1) % 1, sv = clamp(rad, 0, 1), v = 128; const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - sv), q = v * (1 - f * sv), t = v * (1 - (1 - f) * sv); const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; return rgb2hex(r, g, b); };
  const hexToWheel = (hx) => { const [r, g, b] = hex2rgb(hx); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; } return { ang: h * 2 * Math.PI, rad: mx ? d / mx : 0 }; };
  function colorWheel(label, P, lt) {
    const w = document.createElement('div'); w.className = 'cwheel';
    const cv = document.createElement('canvas'); cv.width = cv.height = 220; const cap = document.createElement('div'); cap.className = 'cw-cap';
    const paint = () => {
      const g = cv.getContext('2d'), R = 100, C = 110; g.clearRect(0, 0, 220, 220);
      const img = g.createImageData(220, 220); for (let y = 0; y < 220; y++) for (let x = 0; x < 220; x++) { const dx = x - C, dy = y - C, r = Math.hypot(dx, dy); if (r > R) continue; const [cr, cg, cb] = hex2rgb(wheelToHex(Math.atan2(-dy, dx), r / R)); const k = 1.6; const o = (y * 220 + x) * 4; img.data[o] = clamp((cr - 128) * k + 118, 0, 255); img.data[o + 1] = clamp((cg - 128) * k + 118, 0, 255); img.data[o + 2] = clamp((cb - 128) * k + 118, 0, 255); img.data[o + 3] = r > R - 1 ? 120 : 255; }
      g.putImageData(img, 0, 0); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(C - R, C); g.lineTo(C + R, C); g.moveTo(C, C - R); g.lineTo(C, C + R); g.stroke();
      const { ang, rad } = hexToWheel(GW.pv(P, lt)); const px = C + Math.cos(ang) * rad * R, py = C - Math.sin(ang) * rad * R;
      g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fillStyle = GW.pv(P, lt); g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
      cap.innerHTML = `<b>${esc(label)}</b><span dir="ltr">${rad < .01 ? '—' : Math.round(ang / Math.PI * 180 + 360) % 360 + '° · ' + Math.round(rad * 100) + '%'}</span>`;
    };
    const set = (e, fin) => { const r = cv.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width * 220 - 110, dy = (e.clientY - r.top) / r.height * 220 - 110; let rad = Math.min(1, Math.hypot(dx, dy) / 100); if (rad < .04) rad = 0; GW.setPv(P, lt, wheelToHex(Math.atan2(-dy, dx), rad)); paint(); GW.invalidate(); if (fin) GW.commit('عجلة الألوان: ' + label); };
    cv.onpointerdown = (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); set(e); cv.onpointermove = (ev) => set(ev); cv.onpointerup = (ev) => { cv.onpointermove = null; set(ev, true); }; };
    cv.ondblclick = () => { GW.setPv(P, lt, '#808080'); paint(); GW.invalidate(); GW.commit('إعادة ضبط العجلة'); };
    cv.title = 'اسحب لتلوين ' + label + ' · نقر مزدوج: محايد'; w.append(cv, cap); paint(); return w;
  }
  function renderLum() {
    const el = UI.lumEl; if (!el) return; const b = el.querySelector('[data-a=b]'); const st = b.scrollTop; b.innerHTML = '';
    const c = [...GW.sel.clips].map(id => GW.clipById(id)).find(x => x && x.tt === 'v');
    if (!c) { b.innerHTML = '<div class="empty">حدد لقطة في شريط اللقطات أو الخط الزمني لتصحيح ألوانها.<br>نصيحة: طبقة ضبط فوق المسارات تلوّن كل ما تحتها.</div>'; return; }
    let fx = (c.fx || []).find(f => f.type === 'lumetri');
    const hd = document.createElement('div'); hd.className = 'lum-head'; hd.innerHTML = `${GW.ico('color', 14)}<b>${esc(c.name || 'لقطة')}</b>${fx ? `<button class="btn sm ghost" data-a="byp" title="تجاوز التصحيح للمقارنة">${fx.on === 0 ? 'معطّل' : 'مفعّل'}</button><button class="btn sm ghost ico" data-a="rst" title="إعادة ضبط كل التصحيح">${GW.ico('reset', 13)}</button>` : ''}`; b.append(hd);
    if (fx) { hd.querySelector('[data-a=byp]').onclick = () => { fx.on = fx.on === 0 ? 1 : 0; GW.commit(fx.on ? 'تفعيل الألوان' : 'تجاوز الألوان'); GW.invalidate(); }; hd.querySelector('[data-a=rst]').onclick = () => { const base = GW.newFx('lumetri'); fx.params = base.params; delete fx.curves; delete fx.hsl; GW.commit('إعادة ضبط الألوان'); renderLum(); }; }
    const lookGrid = (f) => { const looks = document.createElement('div'); looks.className = 'looks'; for (const [n, vals, grad] of LOOKS) { const d = document.createElement('div'); d.className = 'look'; d.innerHTML = `<div style="background:${grad}"></div>${esc(n)}`; d.onclick = () => { if (!fx) { fx = GW.newFx('lumetri'); c.fx.unshift(fx); } const base = GW.newFx('lumetri'); for (const k in base.params) if (!/^(lut|cv|hsl)/.test(k)) fx.params[k] = base.params[k]; for (const k in vals) fx.params[k] = GW.P(vals[k]); GW.commit('مظهر: ' + n); renderLum(); }; looks.append(d); } f.append(looks); };
    if (!fx) {
      const f = document.createElement('div'); f.className = 'form lum-start'; b.append(f); f.append(sec('ابدأ بمظهر جاهز')); lookGrid(f);
      const add = document.createElement('button'); add.className = 'btn pri'; add.innerHTML = GW.ico('plus', 13) + ' إضافة تصحيح الألوان'; add.onclick = () => { c.fx.unshift(GW.newFx('lumetri')); GW.commit('تصحيح الألوان'); renderLum(); }; f.append(add); return;
    }
    const lt = GW.seq().t - c.start;
    const rowOf = (f, k) => { const d = GW.FX.lumetri.p.find(p => p.k === k); const P = fx.params[k] || (fx.params[k] = GW.P(d.def)); if (d.t === 'color') f.append(frow(d.n, colorIn(GW.pv(P, lt), v => { GW.setPv(P, lt, v); GW.invalidate(); GW.commitSoon('ألوان'); }))); else f.append(frow(d.n, rangeIn(GW.pv(P, lt), d.min, d.max, d.step, v => { GW.setPv(P, lt, v); GW.invalidate(); GW.commitSoon('ألوان'); GW.bus.emit('param'); }))); };
    const B = {}; const changed = (keys) => keys.some(k => { const d = GW.FX.lumetri.p.find(p => p.k === k); return d && fx.params[k] && String(GW.pv(fx.params[k], lt)) !== String(d.def); });
    for (const [k, n, ic] of LUM_SECS) {
      const badge = k === 'basic' ? (changed(['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temp', 'tint', 'sat']) ? '●' : '') : k === 'curves' ? (fx.curves ? '●' : '') : k === 'hsl' ? (fx.hsl && fx.hsl.on ? '●' : '') : k === 'wheels' ? (changed(['shadowTint', 'highTint']) ? '●' : '') : k === 'vig' ? ((c.fx || []).some(f => f.type === 'vignette') ? '●' : '') : k === 'creative' ? (changed(['fade', 'vib']) || (fx.lut && (fx.lut.in || fx.lut.cr)) ? '●' : '') : '';
      B[k] = lumSec(b, k, n, ic, badge);
    }
    B.basic.append(sec('توازن الأبيض')); for (const k of ['temp', 'tint']) rowOf(B.basic, k);
    B.basic.append(sec('الدرجات')); for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']) rowOf(B.basic, k);
    B.basic.append(sec('التشبع')); rowOf(B.basic, 'sat');
    B.creative.append(sec('المظهر')); lookGrid(B.creative); for (const k of ['fade', 'vib']) rowOf(B.creative, k);
    if (GW.LUT) { B.creative.append(sec('LUT')); GW.LUT.panelRows(B.creative, c, fx, UI.form, renderLum); }
    const ww = document.createElement('div'); ww.className = 'cwheels'; ww.append(colorWheel('الظلال', fx.params.shadowTint || (fx.params.shadowTint = GW.P('#808080')), lt), colorWheel('الإضاءات', fx.params.highTint || (fx.params.highTint = GW.P('#808080')), lt)); B.wheels.append(ww);
    // curves / HSL / match from color.js, distributed by their section titles
    if (GW.Color) {
      const tmp = document.createElement('div'); GW.Color.panelRows(tmp, c, fx, UI.form, renderLum);
      let dest = B.curves; for (const n of [...tmp.childNodes]) { if (n.classList && n.classList.contains('sec-t')) { const t = n.textContent; if (t === 'المنحنيات') { dest = B.curves; continue; } if (t === 'HSL ثانوي') { dest = B.hsl; continue; } if (t === 'مطابقة اللون') { dest = B.match; continue; } } dest.append(n); }
    }
    const vg = (c.fx || []).find(f => f.type === 'vignette');
    if (!vg) { const a = document.createElement('button'); a.className = 'btn sm'; a.innerHTML = GW.ico('plus', 12) + ' إضافة تظليل الحواف'; a.onclick = () => { const f = GW.newFx('vignette', 'v'); c.fx.push(f); GW.commit('تظليل الحواف'); renderLum(); }; B.vig.append(a); }
    else { for (const d of GW.FX.vignette.p) { const P = vg.params[d.k]; B.vig.append(frow(d.n, rangeIn(GW.pv(P, lt), d.min, d.max, d.step, v => { GW.setPv(P, lt, v); GW.invalidate(); GW.commitSoon('تظليل الحواف'); }))); } const rm = document.createElement('button'); rm.className = 'btn sm ghost'; rm.innerHTML = GW.ico('trash', 12) + ' إزالة'; rm.onclick = () => { c.fx = c.fx.filter(f => f !== vg); GW.commit('إزالة تظليل الحواف'); renderLum(); }; B.vig.append(rm); }
    b.scrollTop = st;
  }
  GW.bus.on('selection', () => renderLum()); GW.bus.on('hist', () => renderLum());

  /* ================= audio mixer (v6: channel strips) =================
     Strip per audio track: inserts (effects on the track's clips — click opens the editor in Effect Controls, «+» adds to every
     clip on the track), pan, Duck send (sidechain, audio_fx.js), fader in dB with a scale, stereo peak meter (live, per track),
     mute / solo. Master: fader + meter; audio_fx.js appends the LUFS read-out (.strip.master .lufs). */
  GW.registerPanel('mixer', 'خلاط الصوت', (el) => { el.innerHTML = '<div class="mixer mx6" data-a="m"></div>'; UI.mixEl = el; renderMixer(); });
  const MX_FX = [['peq', 'معادل (EQ)'], ['comp', 'ضاغط'], ['deesser', 'مزيل الصفير'], ['limiter', 'محدِّد'], ['reverb', 'صدى'], ['highpass', 'قطع منخفض'], ['gain', 'كسب']];
  const fxShort = (t) => ({ peq: 'EQ', comp: 'Comp', deesser: 'De-ess', limiter: 'Limit', reverb: 'Reverb', highpass: 'HPF', lowpass: 'LPF', gain: 'Gain', eq3: 'EQ3', delay: 'Delay', radio: 'Radio' }[t] || (GW.AFX[t] ? GW.AFX[t].n : t));
  const trackAudio = (s, ti) => s.clips.filter(c => c.tt === 'a' && c.ti === ti);
  const clipAtPh = (s, ti) => { const cs = trackAudio(s, ti); return cs.find(c => s.t >= c.start && s.t < c.start + c.dur) || cs.find(c => GW.sel.clips.has(c.id)) || cs[0] || null; };
  const liveRestart = () => { if (GW.pb.playing) { const t = GW.seq().t; GW.stop(); GW.seq().t = t; GW.play(1); } };
  function openFx(s, ti, type) {
    const c = clipAtPh(s, ti); if (!c) { GW.toast('لا توجد مقاطع على هذا المسار'); return; }
    GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.bus.emit('selection'); GW.showPanel('fxc'); if (GW.FXC && GW.FXC.render) GW.FXC.render();
    setTimeout(() => { const n = GW.AFX[type] && GW.AFX[type].n; const sec = n && [...document.querySelectorAll('[data-panel=fxc] .fx-sec')].reverse().find(x => (x.querySelector('.fxn') || {}).textContent === n); if (sec && sec.scrollIntoView) { sec.scrollIntoView({ block: 'start' }); sec.classList.add('flash'); setTimeout(() => sec.classList.remove('flash'), 900); } }, 80);
  }
  function mxFxMenu(e, s, ti) {
    const cs = trackAudio(s, ti); if (!cs.length) { GW.toast('أضف مقطعًا صوتيًا إلى المسار أولًا'); return; }
    GW.menu(e.clientX, e.clientY, MX_FX.filter(([k]) => GW.AFX[k]).map(([k, n]) => ({ label: n, action: () => { for (const c of cs) { c.afx = c.afx || []; c.afx.push(GW.newFx(k, 'a')); } GW.commit('إدراج تأثير: ' + n); liveRestart(); renderMixer(); openFx(s, ti, k); } })));
  }
  const DB_MARKS = [12, 0, -12, -24, -36, -60];
  function strip(name, getDb, setDb, o, master) {
    o = o || {};
    const d = document.createElement('div'); d.className = 'strip' + (master ? ' master' : ''); if (o.ti != null) d.dataset.ti = o.ti;
    const hd = document.createElement('div'); hd.className = 'mxs-head'; hd.innerHTML = `<i class="mxs-dot"></i><span class="nm">${esc(name)}</span>`; d.append(hd);
    if (o.tr) hd.ondblclick = async () => { const n = await GW.prompt('إعادة تسمية المسار', 'الاسم', o.tr.name); if (n) { o.tr.name = n; GW.commit('إعادة تسمية مسار'); } };
    // inserts
    const fx = document.createElement('div'); fx.className = 'mxs-fx';
    if (o.tr) {
      const s = GW.seq(); const types = []; for (const c of trackAudio(s, o.ti)) for (const f of c.afx || []) if (!types.includes(f.type)) types.push(f.type);
      for (let i = 0; i < 3; i++) {
        const t = types[i]; const b = document.createElement('button'); b.className = 'mxs-slot' + (t ? ' on' : '');
        if (t) { b.textContent = fxShort(t); b.title = (GW.AFX[t] ? GW.AFX[t].n : t) + ' — انقر لفتح المحرر'; b.onclick = () => openFx(s, o.ti, t); }
        else { b.innerHTML = GW.ico('plus', 11); b.title = 'إدراج تأثير على كل مقاطع المسار'; b.onclick = (e) => mxFxMenu(e, s, o.ti); }
        fx.append(b);
      }
      if (types.length > 3) { const more = document.createElement('span'); more.className = 'mxs-more'; more.textContent = '+' + (types.length - 3); fx.append(more); }
    } else { fx.innerHTML = '<span class="mxs-fx-l">المخرج الرئيسي</span>'; }
    d.append(fx);
    // pan
    const pw = document.createElement('div'); pw.className = 'mxs-panw';
    if (o.tr) {
      const p = document.createElement('input'); p.type = 'range'; p.className = 'mxs-pan'; p.min = -100; p.max = 100; p.step = 1; p.value = o.tr.pan || 0; p.title = 'التوازن (نقر مزدوج: الوسط)';
      const pv = document.createElement('span'); pv.className = 'mxs-panv'; const lbl = () => { const v = +p.value; pv.textContent = v === 0 ? 'C' : (v < 0 ? 'L' : 'R') + Math.abs(v); }; lbl();
      p.oninput = () => { o.tr.pan = +p.value; lbl(); }; p.onchange = () => { if (!o.tr.pan) delete o.tr.pan; GW.commit('توازن المسار'); liveRestart(); };
      p.ondblclick = () => { p.value = 0; p.oninput(); p.onchange(); };
      pw.append(p, pv);
    } else pw.innerHTML = '<span class="mxs-panv">ستيريو</span>';
    d.append(pw);
    // send / duck
    const sd = document.createElement('div'); sd.className = 'ms mxs-send';
    if (o.tr) { const b = document.createElement('button'); b.className = 'btn sm duckb' + (o.tr.duck && o.tr.duck.on ? ' on' : ''); b.innerHTML = GW.ico('down', 11) + '<span>Duck</span>'; b.title = 'خفض تلقائي أثناء الكلام (Sidechain) · Shift+نقر: الإعدادات'; b.onclick = (e) => { const AF = GW.AudioFX; if (!AF) return; const S = GW.seq(), T = S.at[o.ti]; const cur = !!(T && T.duck && T.duck.on); if (e.shiftKey || !cur) AF.duckDialog(o.ti); else AF.setDuck(S, o.ti, { on: 0 }); }; sd.append(b); }
    d.append(sd);
    // fader + meter
    const fd = document.createElement('div'); fd.className = 'fader';
    const sc = document.createElement('div'); sc.className = 'mxs-scale'; sc.innerHTML = DB_MARKS.map(v => `<span style="top:${((12 - v) / 72 * 100).toFixed(2)}%">${v > 0 ? '+' + v : v}</span>`).join('');
    const r = document.createElement('input'); r.type = 'range'; r.setAttribute('orient', 'vertical'); r.min = -60; r.max = 12; r.step = .1; r.value = getDb(); r.className = 'mxs-fader';
    const m = document.createElement('canvas'); m.className = 'mxs-meter'; m.width = 14; m.height = 200; m.dataset.ti = master ? 'M' : o.ti; if (master) UI.masterMeter = m;
    fd.append(sc, r, m); d.append(fd);
    const db = document.createElement('span'); db.className = 'db'; db.title = 'انقر مرتين لإدخال قيمة'; const showDb = (v) => { db.textContent = (v > 0 ? '+' : '') + (+v).toFixed(1) + ' dB'; }; showDb(+getDb()); d.append(db);
    r.oninput = () => { setDb(+r.value); showDb(+r.value); };
    r.onchange = () => { GW.commit('مستوى المسار'); liveRestart(); };
    r.ondblclick = () => { r.value = 0; r.oninput(); r.onchange(); };
    db.ondblclick = async () => { const v = await GW.prompt('المستوى', 'dB (من -60 إلى +12)', (+r.value).toFixed(1)); if (v != null && v !== '' && isFinite(+v)) { r.value = GW.clamp(+v, -60, 12); r.oninput(); r.onchange(); } };
    if (o.ms) { const ms = document.createElement('div'); ms.className = 'ms'; for (const [k, n, tip] of [['mute', 'M', 'كتم'], ['solo', 'S', 'منفرد']]) { const b = document.createElement('button'); b.className = 'btn sm mx-' + k + (o.ms[k] ? ' on' : ''); b.textContent = n; b.title = tip; b.onclick = () => { o.ms[k] = o.ms[k] ? 0 : 1; GW.commit(n === 'M' ? 'كتم' : 'منفرد'); renderMixer(); GW.TL.renderHeads(); liveRestart(); }; ms.append(b); } d.append(ms); }
    return d;
  }
  function renderMixer() {
    const el = UI.mixEl; if (!el) return; const m = el.querySelector('[data-a=m]'); const sl = m.scrollLeft; m.innerHTML = ''; const s = GW.seq();
    const strips = document.createElement('div'); strips.className = 'mxs-strips';
    s.at.forEach((tr, ti) => strips.append(strip(tr.name || ('A' + (ti + 1)), () => tr.vol || 0, v => { tr.vol = v; }, { ms: tr, tr, ti })));
    const add = document.createElement('button'); add.className = 'mxs-add'; add.innerHTML = GW.ico('plus', 14) + '<span>مسار صوت</span>'; add.title = 'إضافة مسار صوت'; add.onclick = () => GW.cmd.addTrack('a'); strips.append(add);
    m.append(strips, strip('الرئيسي', () => s.master || 0, v => { s.master = v; }, null, true));
    m.scrollLeft = sl;
  }
  UI.renderMixer = renderMixer;
  GW.bus.on('project', renderMixer); GW.bus.on('hist', renderMixer);
  // meters: stereo peak bars with 1.5 s peak hold; idle → painted once at rest
  const mHold = {};
  function paintMeter(c, l, r, key) {
    const W = c.clientWidth || 14, H = c.clientHeight || 200; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d'); g.clearRect(0, 0, W, H); g.fillStyle = '#07080a'; g.fillRect(0, 0, W, H);
    const now = performance.now(); const hd = mHold[key] || (mHold[key] = [[-90, 0], [-90, 0]]); const bw = Math.max(2, Math.floor((W - 3) / 2));
    [l, r].forEach((v, i) => {
      const db = 20 * Math.log10(Math.max(v, 1e-5)); const y = (x) => GW.clamp((12 - x) / 72, 0, 1) * H; const top = y(Math.max(-60, db)); const x0 = 1 + i * (bw + 1);
      if (db > -60) { const gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, '#2fae6a'); gr.addColorStop((60 - 12) / 72, '#4cc38a'); gr.addColorStop((60 - 6) / 72, '#e9c35a'); gr.addColorStop(60 / 72, '#ef5350'); gr.addColorStop(1, '#ef5350'); g.fillStyle = gr; g.fillRect(x0, top, bw, H - top); }
      if (db > hd[i][0] || now - hd[i][1] > 1500) hd[i] = [db, now];
      if (hd[i][0] > -60) { g.fillStyle = hd[i][0] > -1 ? '#ef5350' : '#e9ebef'; g.fillRect(x0, y(hd[i][0]), bw, 2); }
    });
    g.fillStyle = 'rgba(255,255,255,.08)'; for (const v of [0, -6, -12, -24, -36]) g.fillRect(0, Math.round((12 - v) / 72 * H), W, 1);
  }
  let mIdle = 0;
  GW.bus.on('tick', () => {
    const el = UI.mixEl; if (!el || !el.isConnected) return; const A = GW.Audio; const on = A.playing;
    if (!on) { if (mIdle > 2) return; mIdle++; } else mIdle = 0;
    el.querySelectorAll('canvas.mxs-meter').forEach(c => { const k = c.dataset.ti; const [l, r] = !on ? [0, 0] : k === 'M' ? A.levels() : (A.trackLevels ? A.trackLevels(+k) : [0, 0]); paintMeter(c, l, r, k); });
  });

  /* ================= markers & history ================= */
  /* markers = review notes: add marker / comment at the playhead, colour, edit name & note in place, jump, delete */
  const MK_COLS = [['#4e9a52', 'أخضر'], ['#e9c35a', 'أصفر'], ['#ef5350', 'أحمر'], ['#4cc2ff', 'أزرق'], ['#b07cff', 'بنفسجي']];
  GW.registerPanel('markers', 'العلامات', (el) => {
    el.innerHTML = `<div class="ptool mk6-tool" dir="rtl"><button class="btn sm" data-a="add" title="إضافة علامة عند مؤشر التشغيل (M)">${GW.ico('marker', 13)}<span>علامة</span></button><button class="btn sm" data-a="note" title="ملاحظة مراجعة عند مؤشر التشغيل">${GW.ico('chat', 13)}<span>ملاحظة</span></button><span class="grow"></span><span class="kv" data-a="n"></span></div><div class="pscroll mk6" data-a="b"></div>`;
    el.querySelector('[data-a=add]').onclick = () => GW.cmd.marker();
    el.querySelector('[data-a=note]').onclick = async () => { const s = GW.seq(); const t = s.t; const n = await GW.prompt('ملاحظة مراجعة', 'الملاحظة عند ' + GW.fmtTC(t, s.fps), ''); if (!n) return; s.markers.push({ id: GW.uid(), t, name: 'ملاحظة ' + (s.markers.length + 1), note: n, color: '#e9c35a' }); GW.commit('ملاحظة مراجعة'); };
    UI.mkEl = el; renderMarkers();
  });
  function renderMarkers() {
    const el = UI.mkEl; if (!el) return; const b = el.querySelector('[data-a=b]'); const s = GW.seq(); b.innerHTML = '';
    const nEl = el.querySelector('[data-a=n]'); if (nEl) nEl.textContent = s.markers.length ? s.markers.length + ' علامة' : '';
    if (!s.markers.length) { b.innerHTML = '<div class="empty">لا توجد علامات أو ملاحظات بعد.<br>اضغط M أو «ملاحظة» أثناء المشاهدة لتدوين ما يحتاج إلى تعديل.</div>'; return; }
    const cur = [...s.markers].sort((a, c) => a.t - c.t).filter(m => m.t <= s.t + 1e-4).pop();
    for (const m of [...s.markers].sort((a, c) => a.t - c.t)) {
      const r = document.createElement('div'); r.className = 'mk-i mk6-i' + (m === cur ? ' cur' : '');
      r.innerHTML = `<button class="mk-col" style="background:${esc(m.color || '#4e9a52')}" title="لون العلامة"></button><div class="mk-t"><span class="mk-n">${esc(m.name || 'علامة')}</span>${m.note ? `<span class="mk-note">${esc(m.note)}</span>` : ''}</div><span class="kv" dir="ltr">${GW.fmtTC(m.t, s.fps)}</span><button class="ib mk-del" title="حذف">${GW.ico('close', 12)}</button>`;
      r.onclick = () => GW.seek(m.t);
      r.querySelector('.mk-col').onclick = (e) => { e.stopPropagation(); GW.menu(e.clientX, e.clientY, MK_COLS.map(([c, n]) => ({ label: n, check: m.color === c, action: () => { m.color = c; GW.commit('لون العلامة'); } }))); };
      r.querySelector('.mk-del').onclick = (e) => { e.stopPropagation(); s.markers = s.markers.filter(x => x !== m); GW.commit('حذف علامة'); };
      r.ondblclick = async (e) => { e.stopPropagation(); const n = await GW.prompt('تحرير العلامة', 'الاسم', m.name || ''); if (n == null) return; const note = await GW.prompt('تحرير العلامة', 'الملاحظة', m.note || ''); m.name = n || m.name; if (note != null) m.note = note; GW.commit('تحرير علامة'); };
      r.oncontextmenu = e => { e.preventDefault(); GW.menu(e.clientX, e.clientY, [{ label: 'حذف', action: () => { s.markers = s.markers.filter(x => x !== m); GW.commit('حذف علامة'); } }]); };
      b.append(r);
    }
  }
  { let lt = -1; GW.bus.on('time', () => { if (!UI.mkEl || !UI.mkEl.isConnected || GW.pb.playing) return; const t = GW.seq().t; if (Math.abs(t - lt) > .05) { lt = t; renderMarkers(); } }); }
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
  // «المدة…»: set the length of the selected clips directly (no speed change) — maps, text, graphics, stills, and media within their source
  UI.durationDialog = (clips) => {
    if (!clips || !clips.length) { GW.toast('حدد مقطعًا'); return; } const s = GW.seq(); const c = clips[0];
    const body = document.createElement('div');
    body.innerHTML = `<div class="fld"><span>المدة</span><div data-k="cnt"></div></div><label class="chk"><input type="checkbox" data-k="ripple" checked> إزاحة المقاطع التالية</label><div class="hint" data-k="note"></div>`;
    const q = k => body.querySelector(`[data-k=${k}]`); let val = c.dur;
    const upd = () => { q('note').textContent = '= ' + GW.fmtTC(val, s.fps); };
    const cnt = GW.durCounter(c.dur, v => { val = v; upd(); }); q('cnt').append(cnt); upd();
    GW.modal({ title: 'المدة', body, buttons: [{ label: 'إلغاء' }, { label: 'موافق', primary: true, action: () => {
      const v = val; if (!(v > 0)) { GW.toast('مدة غير صالحة', 'err'); return false; } const ripple = q('ripple').checked; let capped = 0;
      const all = new Set(clips); clips.forEach(x => GW.linked(s, x).forEach(l => all.add(l)));
      for (const x of all) { const old = x.dur; const mx = GW.maxLen ? GW.maxLen(x) : Infinity; let nd = Math.max(1 / (s.fps || 30), v); const lim = isFinite(mx) ? (mx - (x.in || 0)) / (x.speed || 1) : Infinity; if (nd > lim) { nd = lim; capped = 1; } x.dur = nd;
        if (ripple) for (const o of s.clips) if (!all.has(o) && o.tt === x.tt && o.ti === x.ti && o.start >= x.start + old - 1e-6) o.start += nd - old; }
      GW.commit('المدة'); GW.invalidate(); if (GW.TL) GW.TL.invalidate(); if (capped) GW.toast('بعض المقاطع أقصر من المدة المطلوبة فأُخذ أقصى طولها');
    } }] });
  };
  // «المدد الافتراضية…» for new maps, text and graphics / images
  UI.durDefaultsDialog = () => {
    const D = GW.durDefaults; const body = document.createElement('div');
    const vals = { map: D.map, text: D.text, still: D.still };
    for (const [k, n] of [['map', 'الخريطة الجديدة'], ['text', 'النص الجديد'], ['still', 'الصور والأشكال والألوان']]) { const f = document.createElement('div'); f.className = 'fld'; const sp = document.createElement('span'); sp.textContent = n; f.append(sp, GW.durCounter(D[k], v => { vals[k] = v; })); body.append(f); }
    const hn = document.createElement('div'); hn.className = 'hint'; hn.textContent = 'تُطبق على ما تضيفه من الآن.'; body.append(hn);
    GW.modal({ title: 'المدد الافتراضية', body, buttons: [{ label: 'إلغاء' }, { label: 'حفظ', primary: true, action: () => {
      Object.assign(D, vals); GW.saveDurDefaults(); GW.toast('حُفظت المدد الافتراضية');
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
