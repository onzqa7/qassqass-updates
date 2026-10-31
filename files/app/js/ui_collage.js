'use strict';
/* «كولاج» panel + workspace page: background removal (cut-outs), one-click cut-out looks on clips, collage template grid,
   frame grab from the timeline. Panel id 'collage'; the page is an extra GW.WS entry (the switcher renders any key). */
(function () {
  const tr = (s) => (GW.tr ? GW.tr(s) : s); const esc = GW.esc;
  const CO = () => GW.Cutout, CL = () => GW.Collage, MG = GW.MG;
  const selClips = () => [...GW.sel.clips].map(id => GW.clipById(id)).filter(Boolean);
  const run = (f) => async () => { try { await f(); } catch (e) { if (e && e.cancelled) return; console.error(e); GW.toast(String(e.message || e), 'err'); } };
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const btn = (ico, label, on, tip) => { const b = h('button', 'btn sm', (ico ? GW.ico(ico, 13) : '') + '<span>' + esc(label) + '</span>'); if (tip) b.title = tip; b.onclick = run(on); return b; };
  let root = null, hoverStop = null;
  // which image to cut: selected image clip / selected project image / first image in the project
  const pickImage = () => {
    const c = selClips().find(x => x.kind === 'image' || x.kind === 'video'); if (c) return { clip: c };
    const sm = GW.sel.media && [...GW.sel.media].map(id => GW.media(id)).find(m => m && (m.kind === 'image' || m.kind === 'video')); if (sm) return { media: sm };
    return null;
  };
  async function cutSelected() {
    const p = pickImage(); if (!p) { GW.toast(tr('حدد صورة أو مقطعًا في المشروع أو الخط الزمني')); return; }
    const r = await CO().run(Object.assign(p, { refine: true, look: true })); if (r) { GW.toast(tr('تم حفظ القصاصة') + ': ' + (r.media ? r.media.name : '')); render(); }
  }
  async function modelLine(el) {
    const st = await CO().modelStatus().catch(() => ({ unavailable: true }));
    el.innerHTML = ''; const s = h('span', 'faint');
    if (st.installed) s.textContent = tr('نموذج قص الخلفية جاهز (يعمل دون اتصال)');
    else if (st.unavailable) s.textContent = tr('القص التقريبي (نموذج الذكاء الاصطناعي متاح في نسخة سطح المكتب)');
    else { s.textContent = tr('نموذج قص الخلفية غير مُنزّل (4.6 ميغابايت)'); el.append(s, btn('import', tr('تنزيل'), async () => { await CO().download(); GW.toast(tr('تم تنزيل النموذج')); modelLine(el); })); return; }
    el.append(s);
  }
  function render() {
    if (!root) return; root.innerHTML = ''; const body = h('div', 'pscroll cl-panel'); root.append(body);
    // 1. cut-outs
    body.append(h('div', 'sec-t', esc(tr('قص الخلفية'))));
    const r1 = h('div', 'cl-row'); r1.append(btn('scissors', tr('قص خلفية المحدد…'), cutSelected, tr('صورة أو إطار الفيديو الحالي من المقطع المحدد')), btn('camera', tr('قص من الإطار الحالي'), async () => { const r = await CO().run({ refine: true, look: true }); if (r) render(); }));
    body.append(r1); const ml = h('div', 'cl-row cl-model'); body.append(ml); modelLine(ml);
    // 2. looks for the selected clips
    body.append(h('div', 'sec-t', esc(tr('مظهر القصاصة على المقاطع المحددة'))));
    const r2 = h('div', 'cl-chips');
    for (const [k, L] of Object.entries(CL().LOOKS)) { const b = h('button', 'chip', esc(tr(L.n))); b.dataset.look = k; b.onclick = run(() => { const cs = selClips().filter(c => c.tt === 'v'); if (!cs.length) { GW.toast(tr('حدد مقطع فيديو أو صورة')); return; } CL().applyLook(cs, k); GW.toast(tr('طُبّق') + ': ' + tr(L.n)); }); r2.append(b); }
    body.append(r2);
    // 3. timeline frame grab
    body.append(h('div', 'sec-t', esc(tr('لقطة من الخط الزمني'))));
    const r3 = h('div', 'cl-row'); r3.append(btn('image', tr('حفظ الإطار الحالي كصورة'), async () => { const fr = await GW.FrameGrab.atPlayhead(); const r = await GW.FrameGrab.savePng(fr); GW.toast(tr('تم حفظ الإطار') + ': ' + (r.media ? r.media.name : '')); }));
    body.append(r3);
    // 4. templates
    body.append(h('div', 'sec-t', esc(tr('قوالب الكولاج'))));
    const grid = h('div', 'eg-grid mg-grid cl-grid');
    for (const T of MG.list.filter(x => x.cat === 'collage')) {
      const card = h('div', 'eg-card mg-card'); card.dataset.mg = T.id; card.title = tr('مرّر للمعاينة، انقر للإضافة عند مؤشر التشغيل');
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; const cap = h('div', null, `<span>${esc(tr(T.n))}</span><small>${(+T.dur).toFixed(1)} ث</small>`);
      card.append(cv, cap); const still = () => MG.thumb(cv, T.id, MG.heroT(T.id)); MG.ensureFonts().then(() => requestAnimationFrame(still));
      card.onmouseenter = () => { if (hoverStop) hoverStop(); let on = true; const t0 = performance.now(); const loop = () => { if (!on || !cv.isConnected) return; MG.thumb(cv, T.id, Math.min(((performance.now() - t0) / 1000) % (T.dur + .6), T.dur - .02)); requestAnimationFrame(loop); }; hoverStop = () => { on = false; still(); hoverStop = null; }; loop(); };
      card.onmouseleave = () => { if (hoverStop) hoverStop(); };
      card.onclick = () => { MG.add(T.id); GW.UI && GW.UI.egEdit && GW.UI.egEdit(); };
      grid.append(card);
    }
    body.append(grid);
  }
  GW.registerPanel('collage', 'كولاج', (el) => { root = el; render(); });
  GW.bus.on('media', () => { if (root && root.isConnected) { const ml = root.querySelector('.cl-model'); if (ml) modelLine(ml); } });
  // workspace page «كولاج»: templates + controls on the side, big program monitor
  if (GW.WS && !GW.WS.collage) GW.WS.collage = { n: 'كولاج', ico: 'layers', tip: 'كولاج: قص الخلفية، القصاصات، الورق والخربشات وقوالب مشاهد الكولاج', tl: ['fxc'], tr: ['program'], bl: ['project'], br: ['timeline'], side: ['collage', 'graphics'], v: { '--c1': '32%', '--c4': '24%', '--r1': '60%', '--c3': '400px' }, safe: true };
  // Graphics menu entries
  GW.bus.on('ready', () => {
    const e = GW.MENUS && GW.MENUS.find(m => m[0] === 'رسومات'); if (!e || e._cl) return; const f = e[1]; e._cl = 1;
    e[1] = () => { const items = f(); items.push('-', { label: tr('كولاج'), sub: [{ label: tr('قص خلفية المحدد…'), action: run(cutSelected) }, { label: tr('حفظ الإطار الحالي كصورة'), action: run(async () => { const fr = await GW.FrameGrab.atPlayhead(); await GW.FrameGrab.savePng(fr); }) }, '-', ...Object.entries(CL().LOOKS).map(([k, L]) => ({ label: tr(L.n), action: run(() => CL().applyLook(selClips().filter(c => c.tt === 'v'), k)) })), '-', { label: tr('لوحة الكولاج'), action: () => GW.showPanel && GW.showPanel('collage') }] }); return items; };
  });
  const css = document.createElement('style'); css.textContent = `
.cl-panel{padding:6px 10px 14px;direction:rtl}
.cl-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0}
.cl-row .btn span{margin-inline-start:4px}
.cl-model{font-size:11px;margin-top:0}
.cl-chips{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}
.cl-chips .chip{height:24px;padding:0 10px;border-radius:12px;border:1px solid var(--line3,#3a3a3a);background:var(--bg3,#252525);color:var(--text2,#bbb);cursor:pointer;font-size:11.5px}
.cl-chips .chip:hover{border-color:var(--accent)}
.cl-grid{padding:8px 0}`;
  document.head.append(css);
})();
