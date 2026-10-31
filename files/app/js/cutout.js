'use strict';
/* قص الخلفية (background removal) + لقطة من الخط الزمني (frame grab).
   GW.Cutout: offline person/object segmentation with U²-Net-p (ONNX, Apache-2.0) run by onnxruntime-web (app/lib/ort, wasm,
   single thread). The model (4.6 MB) is downloaded on demand into userData/seg by main.js (resumable, size + sha256 checked).
   Without the desktop bridge / model a colour-distance fallback («تقريبي») is used. A refine dialog lets the user paint the
   mask (إضافة / مسح) and the result is saved as a PNG with alpha next to the project («cutouts») and imported as media.
   GW.FrameGrab: current frame of a clip (source resolution) or of the whole sequence → canvas / PNG media. */
(function () {
  const api = () => window.gws || null;
  const tr = (s) => (GW.tr ? GW.tr(s) : s);
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const CO = GW.Cutout = { cfg: { model: 'u2netp', modelUrl: null, stub: false, size: 320 }, last: null };

  /* ---------------- runtime + model ---------------- */
  let ortP = null, sessP = null;
  CO.loadOrt = () => ortP || (ortP = new Promise((res, rej) => {
    const done = () => { const o = window.ort; o.env.wasm.wasmPaths = new URL('lib/ort/', location.href).href; o.env.wasm.numThreads = 1; o.env.wasm.proxy = false; res(o); };
    if (window.ort) return done();
    const s = document.createElement('script'); s.src = 'lib/ort/ort.wasm.min.js'; s.onload = done; s.onerror = () => { ortP = null; rej(new Error(tr('تعذر تحميل محرك الذكاء الاصطناعي'))); }; document.head.append(s);
  }));
  CO.modelStatus = async () => {
    if (CO.cfg.modelUrl) return { installed: true, url: CO.cfg.modelUrl };
    const A = api(); if (!A || !A.segStatus) return { installed: false, unavailable: true };
    const st = await A.segStatus(); const m = st.models.find(x => x.id === CO.cfg.model) || st.models[0];
    return { installed: m.installed, path: m.path, size: m.size, partial: m.partial, license: m.license, url: m.installed ? A.mediaUrl(m.path) : null };
  };
  CO.download = async (onProg) => {
    const A = api(); if (!A || !A.segDownload) throw new Error(tr('تنزيل النموذج متاح في نسخة سطح المكتب'));
    const off = A.onSegProgress ? A.onSegProgress(p => { if (p.phase === 'download') { const pct = p.total ? Math.round(p.got / p.total * 100) : 0; GW.status && GW.status(tr('تنزيل نموذج قص الخلفية') + ' ' + pct + '%'); onProg && onProg(pct); } }) : null;
    try { const r = await A.segDownload(CO.cfg.model); if (!r.ok) throw new Error(tr('تعذر تنزيل النموذج') + ': ' + (r.error || '')); return r; }
    finally { off && off(); GW.status && GW.status(''); }
  };
  const askDownload = (st) => new Promise(res => GW.modal({ title: tr('قص الخلفية'), width: 460,
    body: `<p style="margin:0 0 8px">${GW.esc(tr('يحتاج قص الخلفية إلى نموذج ذكاء اصطناعي صغير يعمل دون اتصال (4.6 ميغابايت). سيتم تنزيله مرة واحدة.'))}</p><p class="faint" style="margin:0;font-size:11px;direction:ltr;text-align:left">U²-Net-p — Apache-2.0</p>`,
    buttons: [{ label: tr('إلغاء'), value: false }, { label: tr('تنزيل'), primary: true, value: true }], onClose: v => res(!!v) }));
  CO.session = (o = {}) => {
    if (sessP) return sessP;
    sessP = (async () => {
      if (CO.cfg.stub) return { stub: true };
      let st = await CO.modelStatus();
      if (!st.installed) {
        if (st.unavailable) return { stub: true, reason: 'no-model' };
        if (o.ask !== false && !(await askDownload(st))) throw Object.assign(new Error(tr('تم الإلغاء')), { cancelled: true });
        await CO.download(); st = await CO.modelStatus(); if (!st.installed) throw new Error(tr('تعذر تنزيل النموذج'));
      }
      const ort = await CO.loadOrt(); const buf = await (await fetch(st.url)).arrayBuffer();
      const s = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, s };
    })();
    sessP.catch(() => { sessP = null; });
    return sessP;
  };
  CO.reset = () => { sessP = null; };

  /* ---------------- segmentation ---------------- */
  const srcSize = (src) => [src.naturalWidth || src.videoWidth || src.width, src.naturalHeight || src.videoHeight || src.height];
  // approximate fallback: distance from the colour of the border (works for studio / plain backgrounds)
  function stubMask(src, S) {
    const c = canvas(S, S), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, S, S); const d = g.getImageData(0, 0, S, S).data;
    const edge = []; for (let i = 0; i < S; i++) for (const [x, y] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]]) { const k = (y * S + x) * 4; edge.push([d[k], d[k + 1], d[k + 2]]); }
    const med = [0, 1, 2].map(j => edge.map(e => e[j]).sort((a, b) => a - b)[edge.length >> 1]);
    const out = new Float32Array(S * S); for (let i = 0; i < S * S; i++) { const k = i * 4; const dd = Math.hypot(d[k] - med[0], d[k + 1] - med[1], d[k + 2] - med[2]); out[i] = Math.min(1, Math.max(0, (dd - 28) / 60)); }
    return out;
  }
  // → Float32Array S×S (0..1), S = cfg.size
  CO.predict = async (src, o = {}) => {
    const S = CO.cfg.size; const ses = await CO.session(o);
    if (ses.stub) return { S, m: stubMask(src, S), engine: 'stub' };
    const c = canvas(S, S), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, S, S); const d = g.getImageData(0, 0, S, S).data;
    let mx = 1e-6; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]);
    const mean = [.485, .456, .406], sd = [.229, .224, .225], N = S * S, t = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) for (let ch = 0; ch < 3; ch++) t[ch * N + i] = (d[i * 4 + ch] / mx - mean[ch]) / sd[ch];
    const feeds = {}; feeds[ses.s.inputNames[0]] = new ses.ort.Tensor('float32', t, [1, 3, S, S]);
    const out = await ses.s.run(feeds); const pr = out[ses.s.outputNames[0]].data;
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < N; i++) { lo = Math.min(lo, pr[i]); hi = Math.max(hi, pr[i]); }
    const m = new Float32Array(N); const k = 1 / Math.max(1e-6, hi - lo); for (let i = 0; i < N; i++) m[i] = (pr[i] - lo) * k;
    return { S, m, engine: 'u2netp' };
  };
  // full-resolution mask canvas (white, alpha = matte) for a source
  CO.maskCanvas = async (src, o = {}) => {
    const [w, h] = srcSize(src); const p = await CO.predict(src, o); const S = p.S;
    const sm = canvas(S, S), g = sm.getContext('2d'); const im = g.createImageData(S, S);
    const lo = o.lo != null ? o.lo : .12, hi = o.hi != null ? o.hi : .78;
    for (let i = 0; i < S * S; i++) { let a = (p.m[i] - lo) / (hi - lo); a = a < 0 ? 0 : a > 1 ? 1 : a; a = a * a * (3 - 2 * a); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = a * 255 + .5 | 0; }
    g.putImageData(im, 0, 0);
    const mk = canvas(w, h), g2 = mk.getContext('2d'); g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
    if (o.feather) g2.filter = `blur(${o.feather}px)`; g2.drawImage(sm, 0, 0, w, h); g2.filter = 'none';
    mk._engine = p.engine; return mk;
  };
  CO.compose = (src, mask) => { const [w, h] = srcSize(src); const c = canvas(w, h), g = c.getContext('2d'); g.drawImage(src, 0, 0, w, h); g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0); g.globalCompositeOperation = 'source-over'; return c; };
  // crop to the alpha bounding box + margin (room for sticker borders / torn edges / shadows)
  CO.trim = (cv, marginFrac = .06) => {
    const w = cv.width, h = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return { canvas: cv, coverage: 0, box: [0, 0, w, h] };
    const m = Math.round(Math.max(16, marginFrac * Math.max(x1 - x0, y1 - y0))); const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const out = canvas(bw + 2 * m, bh + 2 * m); out.getContext('2d').drawImage(cv, x0, y0, bw, bh, m, m, bw, bh);
    return { canvas: out, coverage: n / (w * h), box: [x0, y0, bw, bh] };
  };

  /* ---------------- saving PNGs into the project ---------------- */
  const stamp = () => { const d = new Date(); const p2 = v => String(v).padStart(2, '0'); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`; };
  const slug = (t) => String(t || '').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'image';
  CO.assetDir = async (sub) => {
    const A = api(); if (!A) return null; const P = await A.paths(); const sep = P.sep || '/';
    const base = GW.prj && GW.prj.path ? GW.prj.path.replace(/[\\/][^\\/]*$/, '') + sep + (GW.prj.name ? slug(GW.prj.name) + '_' : '') + 'assets' : P.renders;
    return { dir: base + sep + sub, sep };
  };
  CO.savePng = async (cv, name, sub = 'cutouts', o = {}) => {
    const blob = await new Promise(r => cv.toBlob(r, 'image/png')); const fname = slug(name) + '_' + (o.tag || 'cutout') + '_' + stamp() + (CO._n = (CO._n || 0) + 1) + '.png';
    const A = api(); let m;
    if (A && A.writeBin) {
      const { dir, sep } = await CO.assetDir(sub); const path = dir + sep + fname; await A.writeBin(path, await blob.arrayBuffer());
      const added = await GW.Media.importFiles([{ path, name: fname, size: blob.size }]); m = added && added[0] || GW.prj.media.find(x => x.path === path);
      if (m) m.derived = Object.assign({ kind: o.tag || 'cutout' }, o.derived || {});
      return { media: m, path };
    }
    const file = new File([blob], fname, { type: 'image/png' }); const added = await GW.Media.importFiles([{ file, name: fname, size: blob.size }]); m = added && added[0];
    return { media: m, path: null };
  };
  CO.loadImage = (url) => new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error(tr('تعذر فتح الصورة'))); im.src = url; });
  CO.mediaImage = async (m) => { const r = GW.Media.ensureRt(m); if (r.img && r.img.naturalWidth) return r.img; return CO.loadImage(GW.Media.url(m, true)); };

  /* ---------------- refine dialog: paint the matte ---------------- */
  CO.refine = (src, mask, o = {}) => new Promise((resolve) => {
    const [w, h] = srcSize(src); const box = document.createElement('div'); box.className = 'co-refine';
    const bar = document.createElement('div'); bar.className = 'co-bar';
    const view = canvas(10, 10); view.className = 'co-view'; const wrap = document.createElement('div'); wrap.className = 'co-wrap'; wrap.append(view);
    let mode = 'erase', size = Math.round(Math.max(w, h) / 30), show = 1; const undo = [];
    const mb = (ico, label, m) => { const b = document.createElement('button'); b.className = 'btn sm co-mode'; b.dataset.mode = m; b.innerHTML = GW.ico(ico, 14) + ' ' + GW.esc(label); b.onclick = () => { mode = m; bar.querySelectorAll('.co-mode').forEach(x => x.classList.toggle('on', x.dataset.mode === mode)); }; return b; };
    const bAdd = mb('plus', tr('إضافة'), 'add'), bErase = mb('scissors', tr('مسح'), 'erase'); bErase.classList.add('on');
    const sz = document.createElement('input'); sz.type = 'range'; sz.min = 2; sz.max = Math.round(Math.max(w, h) / 5); sz.value = size; sz.oninput = () => size = +sz.value; sz.title = tr('حجم الفرشاة');
    const shw = document.createElement('label'); shw.className = 'co-chk'; shw.innerHTML = `<input type="checkbox" checked> ${GW.esc(tr('إظهار القناع'))}`; shw.querySelector('input').onchange = (e) => { show = e.target.checked ? 1 : 0; draw(); };
    const un = document.createElement('button'); un.className = 'btn sm'; un.innerHTML = GW.ico('undo', 14); un.title = tr('تراجع'); un.onclick = () => { const s = undo.pop(); if (s) { mask.getContext('2d').putImageData(s, 0, 0); draw(); } };
    const lab = document.createElement('span'); lab.className = 'faint'; lab.textContent = tr('حجم الفرشاة');
    bar.append(bAdd, bErase, lab, sz, un, shw);
    const opts = document.createElement('div'); opts.className = 'co-opts';
    const chk = (k, label, on) => { const l = document.createElement('label'); l.className = 'co-chk'; l.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''} data-k="${k}"> ${GW.esc(label)}`; opts.append(l); return l.querySelector('input'); };
    const cAdd = chk('add', tr('إضافة إلى الخط الزمني عند المؤشر'), o.addToTimeline !== false), cLook = chk('look', tr('تطبيق مظهر قصاصة (حد أبيض وظل)'), o.look !== false);
    if (mask._engine === 'stub') { const n = document.createElement('div'); n.className = 'co-note'; n.textContent = tr('تم استخدام القص التقريبي (بدون نموذج الذكاء الاصطناعي) — صحّح الحواف بالفرشاة.'); box.append(n); }
    box.append(bar, wrap, opts);
    const VW = Math.min(820, window.innerWidth - 120), VH = Math.min(520, window.innerHeight - 260); const k = Math.min(VW / w, VH / h, 1);
    view.width = Math.round(w * k); view.height = Math.round(h * k);
    const chkTile = (() => { const c = canvas(16, 16), g = c.getContext('2d'); g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8); return c; })();
    const tmp = canvas(view.width, view.height);
    function draw() {
      const g = view.getContext('2d'); g.fillStyle = g.createPattern(chkTile, 'repeat'); g.fillRect(0, 0, view.width, view.height);
      if (show) { g.globalAlpha = .35; g.drawImage(src, 0, 0, view.width, view.height); g.globalAlpha = 1; }
      const t = tmp.getContext('2d'); t.clearRect(0, 0, tmp.width, tmp.height); t.globalCompositeOperation = 'source-over'; t.drawImage(src, 0, 0, tmp.width, tmp.height); t.globalCompositeOperation = 'destination-in'; t.drawImage(mask, 0, 0, tmp.width, tmp.height); t.globalCompositeOperation = 'source-over';
      g.drawImage(tmp, 0, 0);
      if (show) { t.clearRect(0, 0, tmp.width, tmp.height); t.fillStyle = 'rgba(230,40,60,.38)'; t.fillRect(0, 0, tmp.width, tmp.height); t.globalCompositeOperation = 'destination-out'; t.drawImage(mask, 0, 0, tmp.width, tmp.height); t.globalCompositeOperation = 'source-over'; g.drawImage(tmp, 0, 0); }
    }
    const paint = (x, y) => { const g = mask.getContext('2d'); const r = size / 2; const gr = g.createRadialGradient(x, y, r * .55, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.globalCompositeOperation = mode === 'add' ? 'source-over' : 'destination-out'; g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over'; };
    let down = false, last = null;
    const pos = (e) => { const rc = view.getBoundingClientRect(); return [(e.clientX - rc.left) / rc.width * w, (e.clientY - rc.top) / rc.height * h]; };
    view.onpointerdown = (e) => { down = true; view.setPointerCapture(e.pointerId); undo.push(mask.getContext('2d').getImageData(0, 0, w, h)); if (undo.length > 12) undo.shift(); last = pos(e); paint(...last); draw(); };
    view.onpointermove = (e) => { if (!down) return; const p = pos(e); const dd = Math.hypot(p[0] - last[0], p[1] - last[1]); const st = Math.max(1, size / 5); for (let s = st; s <= dd; s += st) paint(last[0] + (p[0] - last[0]) * s / dd, last[1] + (p[1] - last[1]) * s / dd); last = p; draw(); };
    view.onpointerup = () => { down = false; };
    draw();
    CO._dlg = { view, mask, paint: (x, y, m) => { const pm = mode; mode = m || mode; paint(x, y); mode = pm; draw(); } };
    GW.modal({ title: tr('تحسين القصاصة'), width: Math.max(560, view.width + 40), body: box,
      buttons: [{ label: tr('إلغاء'), value: null }, { label: tr('حفظ القصاصة'), primary: true, value: 'ok' }],
      onClose: (v) => { CO._dlg = null; resolve(v ? { mask, addToTimeline: cAdd.checked, look: cLook.checked } : null); } });
  });

  /* ---------------- main entry ---------------- */
  // src: {media} | {clip, time} | {canvas|image}; o.refine opens the paint dialog; returns {media, path, coverage, engine, canvas}
  CO.run = async (o = {}) => {
    let src = o.canvas || o.image || null, name = o.name || 'image';
    if (!src && o.clip) { const fr = await GW.FrameGrab.clipFrame(o.clip, o.time); src = fr.canvas; name = fr.name; }
    if (!src && o.media) { const m = typeof o.media === 'string' ? GW.media(o.media) : o.media; if (!m) throw new Error('media?'); if (m.kind === 'image') src = await CO.mediaImage(m); else { const fr = await GW.FrameGrab.mediaFrame(m, o.time || 0); src = fr.canvas; } name = m.name; }
    if (!src) { const fr = await GW.FrameGrab.atPlayhead(); src = fr.canvas; name = fr.name; }
    GW.status && GW.status(tr('جارٍ قص الخلفية…'));
    let mask; try { mask = await CO.maskCanvas(src, { ask: o.ask, feather: o.feather }); } finally { GW.status && GW.status(''); }
    let addTL = o.addToTimeline, look = o.look;
    if (o.refine) { const r = await CO.refine(src, mask, o); if (!r) return null; addTL = r.addToTimeline; look = r.look; }
    const cut = CO.trim(CO.compose(src, mask), o.margin != null ? o.margin : .06);
    const res = { canvas: cut.canvas, coverage: +cut.coverage.toFixed(4), engine: mask._engine, width: cut.canvas.width, height: cut.canvas.height };
    if (o.save === false) return res;
    const sv = await CO.savePng(cut.canvas, name, 'cutouts', { tag: 'cutout', derived: { engine: mask._engine } }); Object.assign(res, sv);
    if (addTL && sv.media) {
      const s = GW.seq(); const c = await CO.placeMedia(sv.media, { start: s.t });
      if (c && look && GW.Collage) GW.Collage.applyLook([c], look === true ? 'sticker' : look, { commit: false });
      GW.commit(tr('قص الخلفية')); GW.invalidate(); res.clip = c && c.id;
    }
    CO.last = res; return res;
  };
  // put a media item on a free video track at t
  CO.placeMedia = async (m, o = {}) => {
    const s = GW.seq(); const t = o.start != null ? o.start : s.t; const dur = o.dur || 5;
    let ti = -1; for (let i = 0; i < s.vt.length; i++) { if (s.vt[i].lock) continue; if (!s.clips.some(c => c.tt === 'v' && c.ti === i && c.start < t + dur && c.start + c.dur > t)) { ti = i; break; } }
    if (ti < 0) { GW.ops.ensureTrack(s, 'v', s.vt.length); ti = s.vt.length - 1; }
    const c = GW.newClip('image', { media: m.id, ti, start: t, dur, name: m.name, sw: m.w || 1920, sh: m.h || 1080 });
    if (o.scale) c.motion.scale = GW.P(o.scale);
    s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.bus.emit('selection'); return c;
  };

  /* ---------------- frame grab ---------------- */
  const FG = GW.FrameGrab = {};
  const seekVideo = (url, t) => new Promise((res, rej) => {
    const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; let done = false;
    const fin = (ok, e) => { if (done) return; done = true; clearTimeout(to); if (ok) res(v); else { v.removeAttribute('src'); try { v.load(); } catch (er) {} rej(e || new Error('video')); } };
    const to = setTimeout(() => fin(false, new Error(tr('تعذر قراءة الإطار'))), 15000);
    v.onloadeddata = () => { const tt = Math.max(0, Math.min(t, (v.duration || t + 1) - .04)); if (Math.abs(v.currentTime - tt) < .001 && v.readyState >= 2) return fin(true); v.onseeked = () => fin(true); v.currentTime = tt; };
    v.onerror = () => fin(false, new Error(tr('تعذر قراءة الإطار'))); v.src = url;
  });
  FG.mediaFrame = async (m, t) => {
    if (m.kind === 'image') { const im = await CO.mediaImage(m); const c = canvas(im.naturalWidth, im.naturalHeight); c.getContext('2d').drawImage(im, 0, 0); return { canvas: c, name: m.name, media: m.id, t: 0 }; }
    const v = await seekVideo(GW.Media.url(m, true), t); const c = canvas(v.videoWidth, v.videoHeight); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); v.removeAttribute('src'); try { v.load(); } catch (e) {}
    return { canvas: c, name: m.name, media: m.id, t };
  };
  // the whole sequence composite at time t (full sequence resolution)
  FG.sequenceFrame = async (t, scale) => {
    const s = GW.seq(); t = t == null ? s.t : t; const k = scale || 1; GW.stop && GW.stop(); const was = GW.Render.exporting; GW.Render.exporting = true;
    try {
      await GW.Render.prepareExportFrame(s, t, k); const acc = GW.Render.frame(s, t, { scale: k, exporting: true }); const w = acc.w, h = acc.h;
      const buf = GW.R.readRGBA(w, h, acc, null, false); GW.R.free(acc); const c = canvas(w, h);
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), w, h), 0, 0);
      return { canvas: c, name: s.name || 'frame', t };
    } finally { GW.Render.exporting = was; GW.invalidate(); }
  };
  FG.clipFrame = async (c, t) => {
    const s = GW.seq(); t = t == null ? s.t : t; if (typeof c === 'string') c = GW.clipById(c, s);
    if (c && (c.kind === 'video' || c.kind === 'image') && c.media) { const m = GW.media(c.media); if (m) { const tt = GW.clamp(t, c.start, c.start + c.dur - 1e-3); const fr = await FG.mediaFrame(m, c.kind === 'video' ? GW.srcTime(c, tt) : 0); fr.clip = c.id; return fr; } }
    return FG.sequenceFrame(c ? GW.clamp(t, c.start, c.start + c.dur - 1e-3) : t);
  };
  // selected video/image clip, else the top-most visible video/image clip under the playhead, else the composite
  FG.pick = () => {
    const s = GW.seq(); const t = s.t; const selv = s.clips.filter(c => GW.sel && GW.sel.clips.has(c.id) && (c.kind === 'video' || c.kind === 'image'));
    if (selv.length) return selv.find(c => c.start <= t && c.start + c.dur > t) || selv[0];
    const under = s.clips.filter(c => (c.kind === 'video' || c.kind === 'image') && c.on !== 0 && c.start <= t && c.start + c.dur > t && !(s.vt[c.ti] || {}).hide).sort((a, b) => b.ti - a.ti);
    return under[0] || null;
  };
  FG.atPlayhead = async () => { const c = FG.pick(); return c ? FG.clipFrame(c) : FG.sequenceFrame(); };
  FG.savePng = async (fr) => CO.savePng(fr.canvas, fr.name, 'frames', { tag: 'frame', derived: { clip: fr.clip || null, t: fr.t } });

  const css = document.createElement('style'); css.textContent = `
.co-refine{display:flex;flex-direction:column;gap:8px}
.co-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.co-bar .co-mode.on{background:var(--accentBg);border-color:var(--accentLine);color:#fff}
.co-bar input[type=range]{width:120px}
.co-wrap{display:flex;justify-content:center;background:#111;border:1px solid var(--line,#333);border-radius:6px;padding:6px}
.co-view{cursor:crosshair;max-width:100%;touch-action:none}
.co-opts{display:flex;gap:14px;flex-wrap:wrap}
.co-chk{display:inline-flex;gap:5px;align-items:center;font-size:12px}
.co-note{font-size:11.5px;color:var(--warn,#e0b050)}`;
  document.head.append(css);
})();
