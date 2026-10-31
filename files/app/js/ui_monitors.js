'use strict';
/* Source monitor and Program monitor (with on-canvas transform & mask handles) */
(function () {
  const { $, clamp, esc } = GW;
  const SVG = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>', pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 5v14L6 12z"/></svg>', fwd: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 5v14l9-7z"/></svg>',
    in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M8 4v16M8 4h5M8 20h5"/></svg>', out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 4v16M16 4h-5M16 20h-5"/></svg>',
    goin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4h2v16H5zM19 5v14L9 12z"/></svg>', goout: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 4h2v16h-2zM5 5v14l10-7z"/></svg>',
    insert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="1"/><path d="M12 2v10M9 6l3 3 3-3" stroke="#5aa9ff"/></svg>',
    overwrite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="1" fill="#5aa9ff33"/><path d="M12 2v6M9 5l3 3 3-3" stroke="#5aa9ff"/></svg>',
    lift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="12" width="18" height="7" rx="1"/><path d="M12 10V3M9 6l3-3 3 3"/></svg>', extract: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="12" width="7" height="7" rx="1"/><rect x="14" y="12" width="7" height="7" rx="1"/><path d="M12 10V3M9 6l3-3 3 3"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h4l2-3h4l2 3h4v12H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    safe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="1"/><rect x="6" y="8" width="12" height="8" stroke-dasharray="2 2"/></svg>',
    loop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12a6 6 0 016-6h8M15 3l3 3-3 3M20 12a6 6 0 01-6 6H6M9 21l-3-3 3-3"/></svg>'
  };
  SVG.proxy = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 15V9h3a2 2 0 010 4H8M15 9l3 6M18 9l-3 6" stroke-width="1.6"/></svg>';
  GW.SVG = SVG;
  function fitBox(boxW, boxH, w, h, zoom) { let s = zoom && zoom !== 'fit' ? zoom : Math.min(boxW / w, boxH / h) * .96; return { w: w * s, h: h * s, x: (boxW - w * s) / 2, y: (boxH - h * s) / 2, s }; }

  /* ================= Source monitor ================= */
  const S = GW.Source = { m: null };
  GW.registerPanel('source', 'المصدر', (el) => {
    el.innerHTML = `<div class="mon"><div class="mon-view" data-a="view"><div class="mon-empty">انقر مرتين على عنصر في لوحة المشروع لعرضه هنا،<br>ثم حدّد الدخول (I) والخروج (O) واضغط إدراج أو استبدال.</div></div>
      <div class="mon-bar"><span class="mon-tc" data-a="tc">00:00:00:00</span><span class="grow"></span><span data-a="name" style="color:var(--text2);direction:rtl"></span><span class="grow"></span><span class="mon-tc dur" data-a="dur"></span></div>
      <div class="mon-scrub" data-a="scrub"><div class="io" data-a="io"></div><div class="ph" data-a="ph"></div></div>
      <div class="mon-ctrls">
        <button class="tb" data-a="in" title="تحديد الدخول (I)">${SVG.in}</button><button class="tb" data-a="out" title="تحديد الخروج (O)">${SVG.out}</button><span class="sep"></span>
        <button class="tb" data-a="goin" title="انتقال للدخول">${SVG.goin}</button><button class="tb" data-a="back" title="إطار للخلف">${SVG.back}</button><button class="tb" data-a="play" title="تشغيل">${SVG.play}</button><button class="tb" data-a="fwd" title="إطار للأمام">${SVG.fwd}</button><button class="tb" data-a="goout" title="انتقال للخروج">${SVG.goout}</button><span class="sep"></span>
        <button class="tb" data-a="insert" title="إدراج (,)">${SVG.insert}</button><button class="tb" data-a="overwrite" title="استبدال (.)">${SVG.overwrite}</button>
      </div></div>`;
    S.el = el; const q = a => el.querySelector(`[data-a=${a}]`);
    q('in').onclick = () => S.mark('in'); q('out').onclick = () => S.mark('out');
    q('goin').onclick = () => S.seek(S.m && S.m.inP || 0); q('goout').onclick = () => S.seek(S.m && S.m.outP != null ? S.m.outP : (S.m ? S.m.dur : 0));
    q('back').onclick = () => S.seek(S.t() - 1 / 30); q('fwd').onclick = () => S.seek(S.t() + 1 / 30);
    q('play').onclick = () => S.toggle(); q('insert').onclick = () => S.edit('insert'); q('overwrite').onclick = () => S.edit('overwrite');
    const sc = q('scrub');
    sc.addEventListener('pointerdown', e => { sc.setPointerCapture(e.pointerId); const f = ev => { const r = sc.getBoundingClientRect(); S.seek(clamp((ev.clientX - r.left) / r.width, 0, 1) * (S.m ? S.m.dur : 0)); }; f(e); sc.onpointermove = f; sc.onpointerup = () => { sc.onpointermove = null; }; });
    el.addEventListener('keydown', e => { if (e.key === 'i') { S.mark('in'); e.stopPropagation(); } if (e.key === 'o') { S.mark('out'); e.stopPropagation(); } });
    if (S.m) S.load(S.m);
  });
  S.t = () => S.media ? (S.media.currentTime || 0) : (S.still || 0);
  S.load = (m) => {
    S.m = m; if (!S.el) { GW.showPanel('source'); }
    const view = S.el.querySelector('[data-a=view]'); view.innerHTML = '';
    if (S.media) { S.media.pause(); S.media.removeAttribute('src'); S.media.load(); }
    S.media = null; S.still = 0;
    const url = GW.Media.url(m);
    if (m.kind === 'image') { const img = new Image(); img.src = url; img.className = 'src-media'; view.append(img); }
    else if (m.kind === 'video') { const v = document.createElement('video'); v.src = url; v.className = 'src-media'; v.preload = 'auto'; v.crossOrigin = 'anonymous'; view.append(v); S.media = v; }
    else { const a = document.createElement('audio'); a.src = url; a.preload = 'auto'; S.media = a; const c = document.createElement('canvas'); c.className = 'src-media'; c.style.cssText = 'width:96%;height:70%'; view.append(c); requestAnimationFrame(() => drawWave(c, m)); }
    if (S.media) { S.media.ontimeupdate = upd; S.media.onplay = upd; S.media.onpause = upd; S.media.onseeked = upd; }
    S.el.querySelector('[data-a=name]').textContent = m.name;
    if (!GW.isShown('source')) GW.showPanel('source');
    upd();
  };
  function drawWave(c, m) {
    const r = GW.rt.m[m.id]; const w = c.width = c.clientWidth * devicePixelRatio, h = c.height = c.clientHeight * devicePixelRatio; const g = c.getContext('2d');
    g.fillStyle = '#0d0f12'; g.fillRect(0, 0, w, h); if (!r || !r.peaks) return; const p = r.peaks; g.fillStyle = '#3fb8a8';
    for (let x = 0; x < w; x++) { const i0 = Math.floor(x / w * p.length), i1 = Math.max(i0 + 1, Math.floor((x + 1) / w * p.length)); let mx = 0; for (let i = i0; i < i1; i++) mx = Math.max(mx, p[i]); const hh = mx * h * .48; g.fillRect(x, h / 2 - hh, 1, hh * 2); }
  }
  S.seek = (t) => { if (!S.m) return; t = clamp(t, 0, S.m.dur || 0); if (S.media) S.media.currentTime = t; else S.still = t; upd(); };
  S.toggle = () => { if (!S.media) return; if (S.media.paused) { if (S.m.outP != null && S.media.currentTime >= S.m.outP - .05) S.media.currentTime = S.m.inP || 0; S.media.play(); } else S.media.pause(); };
  S.mark = (w) => { if (!S.m) return; const t = S.t(); if (w === 'in') { S.m.inP = t; if (S.m.outP != null && S.m.outP <= t) S.m.outP = null; } else { S.m.outP = t; if (S.m.inP != null && S.m.inP >= t) S.m.inP = null; } upd(); };
  S.range = () => { const m = S.m; const a = m.inP || 0, b = m.outP != null ? m.outP : (m.kind === 'image' ? 5 : m.dur); return [a, Math.max(a + .04, b)]; };
  S.edit = (mode) => { if (!S.m) { GW.toast('افتح عنصرًا في شاشة المصدر أولًا'); return; } const [a, b] = S.range(); GW.TL.insertMedia([S.m], GW.seq().t, mode, { in: a, dur: b - a }); };
  function upd() {
    if (!S.el || !S.m) return; const t = S.t(), d = S.m.dur || 0;
    S.el.querySelector('[data-a=tc]').textContent = GW.fmtTC(t, S.m.fps || 30);
    const [a, b] = S.range(); S.el.querySelector('[data-a=dur]').textContent = GW.fmtTC(b - a, S.m.fps || 30);
    S.el.querySelector('[data-a=ph]').style.left = (d ? t / d * 100 : 0) + '%';
    const io = S.el.querySelector('[data-a=io]'); io.style.left = (d ? a / d * 100 : 0) + '%'; io.style.width = (d ? (b - a) / d * 100 : 0) + '%';
    S.el.querySelector('[data-a=play]').innerHTML = S.media && !S.media.paused ? SVG.pause : SVG.play;
    if (S.media && !S.media.paused && S.m.outP != null && t >= S.m.outP) S.media.pause();
  }
  setInterval(() => { if (S.media && !S.media.paused) upd(); }, 50);

  /* ================= Program monitor ================= */
  const PG = GW.Program = { res: 'auto', zoom: 'fit', safe: false, box: null };
  GW.registerPanel('program', 'البرنامج', (el) => {
    el.innerHTML = `<div class="mon"><div class="mon-view" data-a="view"><canvas class="mon-canvas" data-a="cv"></canvas><canvas class="mon-overlay" data-a="ov"></canvas></div>
      <div class="mon-bar"><span class="mon-tc" data-a="tc">00:00:00:00</span>
        <select class="sel" data-a="zoom" title="تكبير العرض" style="height:20px"><option value="fit">ملاءمة</option><option value="0.25">25%</option><option value="0.5">50%</option><option value="1">100%</option></select>
        <span class="grow"></span><span data-a="seqname" style="color:var(--text2);direction:rtl"></span><span class="grow"></span>
        <select class="sel" data-a="res" title="دقة التشغيل" style="height:20px"><option value="auto">تلقائي</option><option value="1">كاملة</option><option value="0.5">1/2</option><option value="0.25">1/4</option></select>
        <span class="mon-tc dur" data-a="dur">00:00:00:00</span></div>
      <div class="mon-scrub" data-a="scrub"><div class="io" data-a="io"></div><div class="ph" data-a="ph"></div></div>
      <div class="mon-ctrls">
        <button class="tb" data-a="in" title="تحديد الدخول (I)">${SVG.in}</button><button class="tb" data-a="out" title="تحديد الخروج (O)">${SVG.out}</button><span class="sep"></span>
        <button class="tb" data-a="goin" title="انتقال للدخول">${SVG.goin}</button><button class="tb" data-a="back" title="إطار للخلف (←)">${SVG.back}</button><button class="tb" data-a="play" title="تشغيل / إيقاف (مسافة)">${SVG.play}</button><button class="tb" data-a="fwd" title="إطار للأمام (→)">${SVG.fwd}</button><button class="tb" data-a="goout" title="انتقال للخروج">${SVG.goout}</button><span class="sep"></span>
        <button class="tb" data-a="lift" title="رفع (;)">${SVG.lift}</button><button class="tb" data-a="extract" title="استخراج (')">${SVG.extract}</button><span class="sep"></span>
        <button class="tb" data-a="loop" title="تكرار التشغيل">${SVG.loop}</button><button class="tb" data-a="safe" title="هوامش الأمان">${SVG.safe}</button><button class="tb" data-a="full" title="ملء الشاشة للمعاينة (Ctrl+\`)">${SVG.full}</button><button class="tb" data-a="proxy" title="تبديل البروكسي (زر أيمن: إعدادات البروكسي)">${SVG.proxy}</button><button class="tb" data-a="snap" title="تصدير الإطار (Ctrl+Shift+E)">${SVG.camera}</button>
      </div></div>`;
    PG.el = el; const q = a => el.querySelector(`[data-a=${a}]`);
    PG.view = q('view'); PG.cv = q('cv'); PG.ov = q('ov');
    if (!GW.R.gl) { try { GW.R.init(PG.cv); $('#stGpu').textContent = 'GPU: WebGL2' + (GW.R.half ? ' · 16-bit' : ''); } catch (e) { console.error(e); GW.toast('تعذر تشغيل كرت الشاشة (WebGL2): ' + e.message, 'err'); } }
    else { PG.view.replaceChild(GW.R.canvas, PG.cv); PG.cv = GW.R.canvas; }
    q('in').onclick = GW.cmd.markIn; q('out').onclick = GW.cmd.markOut; q('goin').onclick = () => GW.seek(GW.seq().inP || 0); q('goout').onclick = () => GW.seek(GW.seq().outP != null ? GW.seq().outP : GW.seqDur(GW.seq()));
    q('back').onclick = () => GW.cmd.step(-1); q('fwd').onclick = () => GW.cmd.step(1); q('play').onclick = () => GW.play(1);
    q('lift').onclick = () => GW.cmd.lift(false); q('extract').onclick = () => GW.cmd.lift(true);
    q('loop').onclick = (e) => { GW.pb.loop = !GW.pb.loop; e.currentTarget.classList.toggle('on', GW.pb.loop); };
    q('safe').onclick = (e) => { PG.toggleSafe(); e.currentTarget.classList.toggle('on', PG.safe); };
    q('snap').onclick = GW.cmd.exportFrame;
    q('full').onclick = () => PG.toggleFull();
    { const b = q('proxy'); const sync = () => b.classList.toggle('on', !!GW.Media.cfg.proxies); sync(); b.onclick = () => GW.Media.toggleProxies(); b.oncontextmenu = (e) => { e.preventDefault(); GW.Media.proxyMenu(e.clientX, e.clientY); }; GW.bus.on('proxies', sync); }
    q('res').onchange = (e) => PG.setRes(e.target.value === 'auto' ? 'auto' : +e.target.value);
    q('zoom').onchange = (e) => { PG.zoom = e.target.value === 'fit' ? 'fit' : +e.target.value; GW.invalidate(); };
    const sc = q('scrub');
    sc.addEventListener('pointerdown', e => { sc.setPointerCapture(e.pointerId); const f = ev => { const r = sc.getBoundingClientRect(); GW.seek(clamp((ev.clientX - r.left) / r.width, 0, 1) * Math.max(1, GW.seqDur(GW.seq()))); }; f(e); sc.onpointermove = f; sc.onpointerup = () => { sc.onpointermove = null; }; });
    initOverlay();
    new ResizeObserver(() => GW.invalidate()).observe(PG.view);
  });
  PG.setRes = (r) => { PG.res = r; const s = PG.el && PG.el.querySelector('[data-a=res]'); if (s) s.value = String(r); GW.invalidate(); };
  // Premiere-style full-screen preview: only the picture on black; Esc / the same shortcut exits; playback keys keep working
  PG.toggleFull = () => { if (!PG.view) return; if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; } PG.view.requestFullscreen().then(() => { try { PG.view.focus(); } catch (e) {} if (!PG._fsHint) { PG._fsHint = 1; GW.toast('ملء الشاشة: مسافة للتشغيل، Esc للخروج'); } }).catch(() => {}); };
  document.addEventListener('fullscreenchange', () => { if (PG.view) PG.view.classList.toggle('mon-fs', document.fullscreenElement === PG.view); GW.invalidate(); });
  PG.toggleSafe = () => { PG.safe = !PG.safe; GW.invalidate(); };

  let adapt = 1, lastDraw = 0, late = 0; PG.playCap = .5;
  PG.draw = () => {
    if (!PG.el || !GW.R.gl || !PG.el.isConnected) return;
    const s = GW.seq(); const vw = PG.view.clientWidth, vh = PG.view.clientHeight; if (vw < 4 || vh < 4) return;
    const box = fitBox(vw, vh, s.w, s.h, PG.zoom); PG.box = box;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // Auto (Premiere-like): paused → full display quality; playing → at most 1/2 of the sequence, lowered further if frames are late
    const fit = Math.min(1, box.w * dpr / s.w);
    let r = PG.res === 'auto' ? (GW.pb.playing ? Math.min(fit, PG.playCap) * adapt : fit) : Math.min(PG.res, 1);
    r = Math.max(.1, r);
    const t0 = performance.now();
    const acc = GW.Render.frame(s, s.t, { scale: r });
    const cv = GW.R.canvas;
    if (cv.width !== acc.w || cv.height !== acc.h) { cv.width = acc.w; cv.height = acc.h; }
    cv.style.width = box.w + 'px'; cv.style.height = box.h + 'px'; cv.style.left = box.x + 'px'; cv.style.top = box.y + 'px';
    if (GW.Scopes) GW.Scopes.capture(acc); // scopes panel readback (only on frame changes; never while exporting)
    GW.R.present(acc, [0, 0, 0]); GW.R.free(acc);
    const ms = performance.now() - t0;
    if (PG.res === 'auto' && GW.pb.playing) {
      const budget = 1000 / (s.fps || 30), gap = lastDraw ? t0 - lastDraw : budget; lastDraw = t0;
      late = late * .8 + (gap > budget * 1.7 || ms > budget * .6 ? 1 : 0) * .2;
      if (late > .5 && adapt > .3) { adapt *= .8; late = 0; } else if (late < .05 && ms < budget * .25 && adapt < 1) adapt = Math.min(1, adapt * 1.05);
    }
    if (!GW.pb.playing) { adapt = 1; lastDraw = 0; late = 0; }
    PG.effRes = r;
    drawOverlay(); updTime();
  };
  function updTime() {
    const s = GW.seq(), d = GW.seqDur(s); if (!PG.el) return;
    PG.el.querySelector('[data-a=tc]').textContent = GW.fmtTC(s.t, s.fps);
    PG.el.querySelector('[data-a=dur]').textContent = GW.fmtTC(s.inP != null || s.outP != null ? (s.outP ?? d) - (s.inP || 0) : d, s.fps);
    PG.el.querySelector('[data-a=seqname]').textContent = s.name;
    const D = Math.max(1, d); PG.el.querySelector('[data-a=ph]').style.left = clamp(s.t / D * 100, 0, 100) + '%';
    const io = PG.el.querySelector('[data-a=io]'); if (s.inP != null || s.outP != null) { const a = s.inP || 0, b = s.outP ?? d; io.style.left = a / D * 100 + '%'; io.style.width = Math.max(0, b - a) / D * 100 + '%'; io.hidden = false; } else io.hidden = true;
    PG.el.querySelector('[data-a=play]').innerHTML = GW.pb.playing ? SVG.pause : SVG.play;
  }
  GW.bus.on('time', () => { if (PG.el && !GW.pb.playing) updTime(); });
  GW.bus.on('changed', () => GW.invalidate()); GW.bus.on('project', () => GW.invalidate()); GW.bus.on('selection', () => GW.invalidate());

  /* ---------- overlay: transform box, masks, safe margins ---------- */
  function activeSel() {
    const s = GW.seq(); if (GW.sel.clips.size !== 1) return null;
    const c = GW.clipById([...GW.sel.clips][0]); if (!c || c.tt !== 'v' || c.kind === 'adjust') return null;
    if (s.t < c.start || s.t >= c.start + c.dur) return null; return c;
  }
  function contentRect(c, lt) {
    if (c.kind === 'text' && c.text.mg) return [0, 0, c.sw || GW.seq().w, c.sh || GW.seq().h]; // motion graphics template: full-frame layer
    if (c.kind === 'shape' && GW.Shape) return GW.Shape.bounds(c, lt); // vector shape layer (shape.js)
    if (c.kind === 'text') { const s = GW.seq(); const m = GW.TextR.measure(c.text, 1); const pad = c.text.bg ? c.text.bgPad : 10; const bw = c.text.boxW || m.w; const h = m.lh * m.lines.length; return [s.w / 2 - bw / 2 - pad, s.h / 2 - h / 2 - pad * .6, bw + pad * 2, h + pad * 1.2]; }
    return [0, 0, c.sw, c.sh];
  }
  // parented or 3D layers go through GW.X (world matrix / perspective homography); plain 2D layers keep the affine path
  const xformed = (c) => !!(GW.X && c.motion && (GW.X.is3D(c) || (c.parent && GW.X.parentOf(GW.seq(), c))));
  // source px → screen px (overlay canvas coordinates)
  function mapper(c, lt) {
    if (xformed(c)) { const b = PG.box, s = GW.seq(), sx = b.w / s.w, L = GW.X.layerMap(s, c, c.start + lt); return (x, y) => { const p = L.fw(x, y); return [b.x + p[0] * sx, b.y + p[1] * sx]; }; }
    const M = GW.R.placeMatrix(c, lt, 1, 1, null); const b = PG.box;
    const sx = b.w / GW.seq().w;
    return (x, y) => [b.x + (M[0] * x + M[3] * y + M[6]) * sx, b.y + (M[1] * x + M[4] * y + M[7]) * sx];
  }
  function drawOverlay() {
    const ov = PG.ov, b = PG.box; const dpr = devicePixelRatio || 1;
    const W = PG.view.clientWidth, H = PG.view.clientHeight;
    if (ov.width !== Math.round(W * dpr) || ov.height !== Math.round(H * dpr)) { ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr); }
    const g = ov.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (PG.safe) { g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = .75; for (const f of [.9, .8]) { g.strokeRect(b.x + b.w * (1 - f) / 2, b.y + b.h * (1 - f) / 2, b.w * f, b.h * f); } g.beginPath(); g.moveTo(b.x + b.w / 2 - 8, b.y + b.h / 2); g.lineTo(b.x + b.w / 2 + 8, b.y + b.h / 2); g.moveTo(b.x + b.w / 2, b.y + b.h / 2 - 8); g.lineTo(b.x + b.w / 2, b.y + b.h / 2 + 8); g.stroke(); }
    if (GW.MapUI && !GW.pb.playing && GW.MapUI.active()) { PG.hot = null; GW.MapUI.overlay(g); return; }
    if (GW.Track && !GW.pb.playing && GW.Track.active()) { PG.hot = null; GW.Track.overlay(g); return; } // motion tracker (track.js)
    if (GW.Shape && !GW.pb.playing && GW.Shape.active()) { PG.hot = null; GW.Shape.overlay(g, PG); return; } // shape pen tool (shape.js)
    const c = activeSel(); PG.hot = null; if (!c || GW.pb.playing) return;
    const lt = GW.seq().t - c.start;
    if (c.kind === 'camera') { drawCamera(g, c, lt); return; }
    const mp = mapper(c, lt);
    const mk = GW.sel.mask && GW.sel.mask.clip === c.id && (c.masks || []).find(m => m.id === GW.sel.mask.id);
    if (mk) { drawMask(g, c, mk, lt, mp); return; }
    const [x0, y0, w0, h0] = contentRect(c, lt);
    const corners = [[x0, y0], [x0 + w0, y0], [x0 + w0, y0 + h0], [x0, y0 + h0]];
    if (GW.X && GW.X.is3D(c)) { // 3D layer: projected quad + anchor, drag = move in its XY plane
      const s = GW.seq(), L = GW.X.layerMap(s, c, s.t); const vis = corners.every(p => GW.X.apply(L.A, p[0], p[1], 0)[2] > GW.X.NEAR);
      if (vis) {
        const q = corners.map(p => mp(p[0], p[1])); g.strokeStyle = '#4cc2ff'; g.lineWidth = 1.2; g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
        const an = GW.pv(c.motion.anchor, lt); const ap = mp(an[0], an[1]); const L3 = (dx, dy, col) => { const e = mp(an[0] + dx, an[1] + dy); g.strokeStyle = col; g.beginPath(); g.moveTo(ap[0], ap[1]); g.lineTo(e[0], e[1]); g.stroke(); };
        const ax = Math.max(20, Math.min(c.sw, c.sh) * .12); L3(ax, 0, '#ff5a5a'); L3(0, ax, '#5aff7a');
        g.strokeStyle = '#fff'; g.beginPath(); g.arc(ap[0], ap[1], 5, 0, 7); g.stroke();
      }
      PG.hot = { c, pts: [], mids: [], ap: [-1e9, -1e9], mp, lt, td: 1 }; return;
    }
    const pts = corners.map(p => mp(p[0], p[1]));
    // v5 overlay: thin cyan outline (dark halo for legibility over any picture), small round handles with an ember ring
    const halo = (fn) => { g.save(); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 3; fn(); g.restore(); fn(); };
    g.strokeStyle = c.kind === 'null' ? '#ef5350' : '#4cc2ff'; g.lineWidth = c.kind === 'null' ? 1.5 : 1;
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); halo(() => g.stroke());
    const mids = pts.map((p, i) => { const q = pts[(i + 1) % 4]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; });
    g.lineWidth = 1.25;
    for (const p of [...pts, ...mids]) { g.beginPath(); g.arc(p[0], p[1], 4, 0, 7); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#ff6a2b'; g.stroke(); }
    const an = GW.pv(c.motion.anchor, lt); const ap = mp(an[0], an[1]);
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.arc(ap[0], ap[1], 6, 0, 7); g.moveTo(ap[0] - 10, ap[1]); g.lineTo(ap[0] + 10, ap[1]); g.moveTo(ap[0], ap[1] - 10); g.lineTo(ap[0], ap[1] + 10); halo(() => g.stroke());
    PG.hot = { c, pts, mids, ap, mp, lt };
  }
  // camera: active → point-of-interest target + badge; inactive → glyph at its projected position
  function drawCamera(g, c, lt) {
    const s = GW.seq(), b = PG.box, sx = b.w / s.w, X = GW.X, cam = X.camera(s, s.t);
    const glyph = (x, y, col) => { g.save(); g.translate(x, y); g.strokeStyle = col; g.fillStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.beginPath(); g.rect(-13, -8, 18, 16); g.fill(); g.stroke(); g.beginPath(); g.moveTo(5, -3); g.lineTo(13, -8); g.lineTo(13, 8); g.lineTo(5, 3); g.closePath(); g.fill(); g.stroke(); g.restore(); };
    const toScr = (w) => { const p = X.apply(cam.view, w[0], w[1], w[2]); if (p[2] <= X.NEAR) return null; const q = X.proj(cam, s, p); return [b.x + q[0] * sx, b.y + q[1] * sx]; };
    if (cam.clip === c) {
      if (c.cam && c.cam.type !== 'one') { const q = GW.pv(c.cam.poi, lt); const PW = X.parentWorld(s, c, s.t); const p = toScr(X.apply(PW, q[0], q[1], GW.pv(c.cam.poiZ, lt) || 0)); if (p) { g.strokeStyle = '#ffd34d'; g.lineWidth = 1.5; g.beginPath(); g.arc(p[0], p[1], 7, 0, 7); g.moveTo(p[0] - 12, p[1]); g.lineTo(p[0] + 12, p[1]); g.moveTo(p[0], p[1] - 12); g.lineTo(p[0], p[1] + 12); g.stroke(); } }
      glyph(b.x + 24, b.y + 20, '#ffd34d'); g.font = '600 11px Cairo, sans-serif'; g.fillStyle = '#ffd34d'; g.textAlign = 'left'; g.fillText((c.name || 'كاميرا') + ' · ' + Math.round(cam.zoom) + ' px', b.x + 42, b.y + 24); g.textAlign = 'start';
    } else { const p = toScr(X.apply(X.world(s, c, s.t), 0, 0, 0)); if (p) glyph(p[0], p[1], '#9fb3c8'); else { glyph(b.x + 24, b.y + 20, '#9fb3c8'); } }
    PG.hot = null;
  }
  function maskPts(mk, lt) {
    if (mk.type === 'path') return GW.pv(mk.pts, lt) || [];
    const ctr = GW.pv(mk.center, lt), sz = GW.pv(mk.size, lt), rot = GW.pv(mk.rot, lt) * Math.PI / 180; const w = sz[0] / 2, h = sz[1] / 2, cs = Math.cos(rot), sn = Math.sin(rot);
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [ctr[0] + x * cs - y * sn, ctr[1] + x * sn + y * cs]);
  }
  function drawMask(g, c, mk, lt, mp) {
    g.strokeStyle = '#ffd34d'; g.lineWidth = 1.5; g.fillStyle = '#ffd34d';
    if (mk.type === 'ellipse') {
      const ctr = GW.pv(mk.center, lt), sz = GW.pv(mk.size, lt), rot = GW.pv(mk.rot, lt) * Math.PI / 180; g.beginPath();
      for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; const x = Math.cos(a) * sz[0] / 2, y = Math.sin(a) * sz[1] / 2; const p = mp(ctr[0] + x * Math.cos(rot) - y * Math.sin(rot), ctr[1] + x * Math.sin(rot) + y * Math.cos(rot)); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.stroke();
    }
    const P = maskPts(mk, lt).map(p => mp(p[0], p[1]));
    if (mk.type !== 'ellipse') { g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (mk.type !== 'path' || P.length > 2) g.closePath(); g.stroke(); }
    for (const p of P) { g.fillRect(p[0] - 4, p[1] - 4, 8, 8); }
    const ctr = mk.type === 'path' ? null : mp(...GW.pv(mk.center, lt));
    if (ctr) { g.beginPath(); g.arc(ctr[0], ctr[1], 5, 0, 7); g.stroke(); }
    PG.hot = { c, mask: mk, P, ctr, mp, lt };
  }
  function invMap(c, lt) { // screen → source px
    if (xformed(c)) { const b = PG.box, s = GW.seq(), sx = b.w / s.w, L = GW.X.layerMap(s, c, c.start + lt); return (X, Y) => L.inv((X - b.x) / sx, (Y - b.y) / sx); }
    const M = GW.R.placeMatrix(c, lt, 1, 1, null); const b = PG.box; const sx = b.w / GW.seq().w;
    const a = M[0], bb = M[1], cc = M[3], d = M[4], tx = M[6], ty = M[7]; const det = a * d - bb * cc;
    return (X, Y) => { const x = (X - b.x) / sx - tx, y = (Y - b.y) / sx - ty; return [(d * x - cc * y) / det, (-bb * x + a * y) / det]; };
  }
  function hitClip(X, Y) {
    const s = GW.seq(); const b = PG.box; if (!b) return null;
    for (let ti = s.vt.length - 1; ti >= 0; ti--) {
      if (s.vt[ti].hide || s.vt[ti].lock) continue; const c = GW.clipAt(s, 'v', ti, s.t); if (!c || c.kind === 'adjust' || c.kind === 'camera' || !c.motion) continue;
      if (GW.X && GW.X.is3D(c)) { const L = GW.X.layerMap(s, c, s.t); const [x0, y0, w0, h0] = contentRect(c, s.t - c.start); if (![[x0, y0], [x0 + w0, y0], [x0 + w0, y0 + h0], [x0, y0 + h0]].every(p => GW.X.apply(L.A, p[0], p[1], 0)[2] > GW.X.NEAR)) continue; }
      const lt = s.t - c.start; const p = invMap(c, lt)(X, Y); const [x0, y0, w0, h0] = contentRect(c, lt);
      if (p[0] >= x0 && p[0] <= x0 + w0 && p[1] >= y0 && p[1] <= y0 + h0) return c;
    }
    return null;
  }
  GW.Mon = { invMap: (c, lt) => invMap(c, lt), mapper: (c, lt) => mapper(c, lt), box: () => PG.box, redraw: () => drawOverlay() };
  function setParam(c, p, lt, v) { GW.setPv(p, lt, v); GW.invalidate(); GW.bus.emit('param'); }
  function initOverlay() {
    const ov = PG.ov;
    ov.addEventListener('pointerdown', e => {
      const r = ov.getBoundingClientRect(); const X = e.clientX - r.left, Y = e.clientY - r.top;
      if (GW.TL && GW.TL.tool === 'text') { const b = PG.box; const s = GW.seq(); GW.UI.addTextClip(null, [(X - b.x) / b.w * s.w, (Y - b.y) / b.h * s.h]); GW.cmd.tool('select'); return; }
      if (GW.MapUI && !GW.pb.playing && GW.MapUI.active() && GW.MapUI.down(e, X, Y)) { e.preventDefault(); return; }
      if (GW.Track && !GW.pb.playing && GW.Track.active() && GW.Track.down(e, X, Y, ov)) { e.preventDefault(); return; }
      if (GW.Color && GW.Color.picking && GW.Color.pickAt(X, Y)) { e.preventDefault(); return; } // HSL secondary eyedropper
      if (GW.Shape && !GW.pb.playing && GW.Shape.active() && GW.Shape.down(e, X, Y, ov)) { e.preventDefault(); return; }
      const h = PG.hot; let mode = null, idx = -1;
      if (h && h.mask) {
        const d = (p) => Math.hypot(p[0] - X, p[1] - Y);
        idx = h.P.findIndex(p => d(p) < 8);
        if (idx >= 0) mode = 'mpt'; else if (h.ctr && d(h.ctr) < 10) mode = 'mctr';
        else if (h.mask.type === 'path' && GW.TL && GW.TL.tool === 'pen') { const sp = invMap(h.c, h.lt)(X, Y); const pts = GW.clone(GW.pv(h.mask.pts, h.lt) || []); pts.push(sp.map(v => Math.round(v))); setParam(h.c, h.mask.pts, h.lt, pts); GW.commitSoon('رسم القناع'); return; }
        else mode = 'mmove';
      } else if (h) {
        const d = (p) => Math.hypot(p[0] - X, p[1] - Y);
        idx = h.pts.findIndex(p => d(p) < 8); if (idx >= 0) mode = 'corner';
        else { const mi = h.mids.findIndex(p => d(p) < 8); if (mi >= 0) { mode = 'edge'; idx = mi; } else if (d(h.ap) < 10) mode = 'anchor'; else { const inside = hitClip(X, Y) === h.c; if (inside) mode = 'move'; else { const near = h.pts.some(p => d(p) < 28); if (near) mode = 'rotate'; } } }
      }
      if (!mode) { const c = hitClip(X, Y); if (c) { GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.sel.mask = null; GW.bus.emit('selection'); drawOverlay(); mode = 'move'; } else { if (!e.shiftKey) { GW.sel.clips.clear(); GW.sel.mask = null; GW.bus.emit('selection'); } return; } }
      const hh = PG.hot; if (!hh) return; const c = hh.c, lt = hh.lt; const s = GW.seq(); const sx = PG.box.w / s.w;
      const pos0 = GW.clone(GW.pv(c.motion.pos, lt)), sc0 = GW.pv(c.motion.scale, lt), rot0 = GW.pv(c.motion.rot, lt), an0 = GW.clone(GW.pv(c.motion.anchor, lt));
      const mk = hh.mask; const mpts0 = mk ? GW.clone(maskPts(mk, lt)) : null; const mc0 = mk && mk.center ? GW.clone(GW.pv(mk.center, lt)) : null; const msz0 = mk && mk.size ? GW.clone(GW.pv(mk.size, lt)) : null;
      const cen = hh.mp ? hh.mp(...an0) : [X, Y]; const a0 = Math.atan2(Y - cen[1], X - cen[0]), d0 = Math.hypot(X - cen[0], Y - cen[1]);
      const inv = invMap(c, lt); const sp0 = inv(X, Y);
      const dragJ = mode === 'move' && xformed(c) ? GW.X.posDragInv(s, c, s.t) : null; // parent space / perspective aware move
      ov.setPointerCapture(e.pointerId);
      const mv = ev => {
        const x = ev.clientX - r.left, y = ev.clientY - r.top; const dx = (x - X) / sx, dy = (y - Y) / sx;
        if (mode === 'move') { let d = dragJ ? dragJ(dx, dy) : [dx, dy]; if (ev.shiftKey) d = Math.abs(d[0]) >= Math.abs(d[1]) ? [d[0], 0] : [0, d[1]]; /* Shift: one axis */ setParam(c, c.motion.pos, lt, [Math.round((pos0[0] + d[0]) * 10) / 10, Math.round((pos0[1] + d[1]) * 10) / 10]); }
        else if (mode === 'corner' || mode === 'edge') { const d = Math.hypot(x - cen[0], y - cen[1]); setParam(c, c.motion.scale, lt, Math.max(1, Math.round(sc0 * d / Math.max(1, d0) * 10) / 10)); }
        else if (mode === 'rotate') { const a = Math.atan2(y - cen[1], x - cen[0]); let v = rot0 + (a - a0) * 180 / Math.PI; if (ev.shiftKey) v = Math.round(v / 15) * 15; setParam(c, c.motion.rot, lt, Math.round(v * 10) / 10); }
        else if (mode === 'anchor') { const sp = inv(x, y); const dA = [sp[0] - sp0[0], sp[1] - sp0[1]]; const sc = sc0 / 100; const rr = rot0 * Math.PI / 180; setParam(c, c.motion.anchor, lt, [an0[0] + dA[0], an0[1] + dA[1]]); GW.setPv(c.motion.pos, lt, [pos0[0] + (Math.cos(rr) * dA[0] - Math.sin(rr) * dA[1]) * sc, pos0[1] + (Math.sin(rr) * dA[0] + Math.cos(rr) * dA[1]) * sc]); }
        else if (mk) {
          const sp = inv(x, y); const ddx = sp[0] - sp0[0], ddy = sp[1] - sp0[1];
          if (mode === 'mmove' || mode === 'mctr') { if (mk.type === 'path') setParam(c, mk.pts, lt, mpts0.map(p => [p[0] + ddx, p[1] + ddy])); else setParam(c, mk.center, lt, [mc0[0] + ddx, mc0[1] + ddy]); }
          else if (mode === 'mpt') { if (mk.type === 'path') { const pts = GW.clone(mpts0); pts[idx] = [mpts0[idx][0] + ddx, mpts0[idx][1] + ddy]; setParam(c, mk.pts, lt, pts); } else { const rot = GW.pv(mk.rot, lt) * Math.PI / 180; const lx = (sp[0] - mc0[0]) * Math.cos(-rot) - (sp[1] - mc0[1]) * Math.sin(-rot), ly = (sp[0] - mc0[0]) * Math.sin(-rot) + (sp[1] - mc0[1]) * Math.cos(-rot); setParam(c, mk.size, lt, [Math.max(2, Math.abs(lx) * 2), Math.max(2, Math.abs(ly) * 2)]); } }
        }
        drawOverlay();
      };
      const up = () => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); GW.commit(mk ? 'تعديل القناع' : 'تحويل'); };
      ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up);
    });
    ov.addEventListener('contextmenu', e => { if (GW.MapUI && GW.MapUI.active()) e.preventDefault(); });
    ov.addEventListener('pointermove', e => {
      if (GW.Track && !e.buttons && GW.Track.active()) { const r = ov.getBoundingClientRect(); ov.style.cursor = GW.Track.cursor(e.clientX - r.left, e.clientY - r.top); return; }
      if (GW.MapUI && !e.buttons && GW.MapUI.active()) { const r = ov.getBoundingClientRect(); GW.MapUI.move(e.clientX - r.left, e.clientY - r.top); ov.style.cursor = GW.MapUI.mode === 'nav' ? 'grab' : 'crosshair'; return; }
      const h = PG.hot; if (!h || h.mask || e.buttons) { ov.style.cursor = GW.TL && GW.TL.tool === 'text' ? 'text' : GW.TL && GW.TL.tool === 'pen' ? 'crosshair' : 'default'; return; }
      const r = ov.getBoundingClientRect(); const X = e.clientX - r.left, Y = e.clientY - r.top; const d = p => Math.hypot(p[0] - X, p[1] - Y);
      ov.style.cursor = h.pts.some(p => d(p) < 8) ? 'nwse-resize' : h.mids.some(p => d(p) < 8) ? 'ew-resize' : d(h.ap) < 10 ? 'crosshair' : hitClip(X, Y) === h.c ? 'move' : h.pts.some(p => d(p) < 28) ? 'alias' : 'default';
    });
    ov.addEventListener('dblclick', e => { const r = ov.getBoundingClientRect(); if (GW.Shape && GW.Shape.active() && GW.Shape.dbl()) return; if (GW.MapUI && GW.MapUI.active() && GW.MapUI.dbl(e.clientX - r.left, e.clientY - r.top)) return; const c = hitClip(e.clientX - r.left, e.clientY - r.top); if (c && c.kind === 'text') { GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.bus.emit('selection'); GW.showPanel('graphics'); setTimeout(() => { const ta = document.querySelector('[data-panel=graphics] textarea'); if (ta) { ta.focus(); ta.select(); } }, 50); } else if (c && c.kind === 'map') GW.UI.openMapEditor(c); });
    ov.addEventListener('wheel', e => { if (GW.MapUI && !e.ctrlKey && GW.MapUI.active()) { const r = ov.getBoundingClientRect(); if (GW.MapUI.wheel(e, e.clientX - r.left, e.clientY - r.top)) { e.preventDefault(); return; } } if (!e.ctrlKey) return; e.preventDefault(); const z = PG.zoom === 'fit' ? PG.box.s : PG.zoom; PG.zoom = clamp(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), .05, 4); GW.invalidate(); }, { passive: false });
  }
})();
