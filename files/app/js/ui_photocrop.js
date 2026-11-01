'use strict';
/* قص الصورة بدقة — precise photo crop for leader portraits on map layers (and any framed photo).
   GW.PhotoCrop.open({src|image, shape, crop, onChange, title}) → Promise<crop|null>; crop = {x, y, scale, rot}
     (x / y: shift as a fraction of the frame box, scale: 1 = cover fit, rot: degrees). Drag to pan, wheel / slider to zoom,
     slider to rotate; the frame mask (circle / square / rounded / hex / shield / banner arch / medallion / heraldic / coin) is
     drawn exactly as the map engine draws it (GW.Atlas.Vec.drawCrop + War.frameShape), so the preview is what you get.
   GW.PhotoCrop.forLayer(clip, layer) — crop a leader image layer with a live map preview (commit on OK, revert on cancel).
   GW.PhotoCrop.fromTimeline(clip, layer, {source, time, cutout}) — current frame of a timeline clip → leader photo (+ PNG in the project).
   The Maps panel calls these from its leader section; GW.API setLeaderCrop / leaderFromTimeline go through .api(). */
(function () {
  const tr = (s) => (GW.tr ? GW.tr(s) : s);
  const PC = GW.PhotoCrop = {};
  const V = () => GW.Atlas && GW.Atlas.Vec, WR = () => GW.Atlas && GW.Atlas.War;
  const TAU = Math.PI * 2;
  // frame geometry in units of the portrait size sz (=1): photo box [x, y, w, h], vertical anchor fy and the mask path
  PC.geom = (shape) => {
    const sq = (path) => ({ box: [-.5, -.5, 1, 1], fy: .5, path });
    switch (shape) {
      case 'banner': case 'arch': { const pw = 1, ph = 1.12; return { box: [-pw / 2, -ph / 2, pw, ph], fy: .3, path: (g) => { g.beginPath(); g.moveTo(-pw / 2, ph / 2); g.lineTo(-pw / 2, -ph / 2 + pw / 2); g.arc(0, -ph / 2 + pw / 2, pw / 2, Math.PI, 0); g.lineTo(pw / 2, ph / 2); g.closePath(); } }; }
      case 'medallion': return { box: [-.36, -.47, .72, .94], fy: .35, path: (g) => { g.beginPath(); g.ellipse(0, 0, .36, .47, 0, 0, TAU); } };
      case 'heraldic': return { box: [-.4, -.44, .8, .96], fy: .25, path: (g) => WR().frameShape.heraldic(g, 1) };
      case 'coin': return { box: [-.31, -.31, .62, .62], fy: .3, path: (g) => { g.beginPath(); g.arc(0, 0, .31, 0, TAU); } };
      case 'square': return sq((g) => { g.beginPath(); g.rect(-.5, -.5, 1, 1); });
      case 'rounded': return sq((g) => { g.beginPath(); if (g.roundRect) g.roundRect(-.5, -.5, 1, 1, .18); else g.rect(-.5, -.5, 1, 1); });
      case 'hex': return sq((g) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; g.lineTo(Math.cos(a) * .5, Math.sin(a) * .5); } g.closePath(); });
      case 'shield': return sq((g) => { const r = .5; g.beginPath(); g.moveTo(-r, -r); g.lineTo(r, -r); g.lineTo(r, r * .2); g.quadraticCurveTo(r * .8, r * .85, 0, r * 1.1); g.quadraticCurveTo(-r * .8, r * .85, -r, r * .2); g.closePath(); });
      default: return sq((g) => { g.beginPath(); g.arc(0, 0, .5, 0, TAU); });
    }
  };
  // shape of a map image layer (leader): display style first, else the portrait shape
  PC.SHAPES = [['circle', 'دائرة'], ['square', 'مربع'], ['rounded', 'مربع مستدير'], ['hex', 'سداسي'], ['shield', 'درع'], ['medallion', 'ميدالية'], ['coin', 'عملة'], ['heraldic', 'شعار نبالة'], ['banner', 'راية']];
  PC.shapeFor = (Ly) => Ly.disp === 'banner' ? 'banner' : (Ly.disp && WR() && WR().frameShape[Ly.disp]) ? Ly.disp : (Ly.shape || 'circle');
  PC.norm = (c) => ({ x: +(+(c && c.x) || 0).toFixed(4), y: +(+(c && c.y) || 0).toFixed(4), scale: +Math.max(.2, Math.min(8, +(c && c.scale) || 1)).toFixed(4), rot: +(+(c && c.rot) || 0).toFixed(2) });
  // render a frame preview (also used by tests): canvas with the cropped photo inside the mask
  PC.render = (cv, im, shape, crop, o = {}) => {
    const g = cv.getContext('2d'); const W = cv.width, H = cv.height; const G = PC.geom(shape); const k = Math.min(W / G.box[2], H / G.box[3]) * (o.fill || .78);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.fillStyle = o.bg || '#15171b'; g.fillRect(0, 0, W, H);
    g.setTransform(k, 0, 0, k, W / 2, H / 2); const [bx, by, bw, bh] = G.box;
    if (o.ghost !== false) { g.save(); g.globalAlpha = .28; V().drawCrop(g, im, crop, bx, by, bw, bh, G.fy); g.restore(); }
    g.save(); G.path(g); g.clip(); g.fillStyle = '#000'; g.fillRect(bx, by, bw, bh); V().drawCrop(g, im, crop, bx, by, bw, bh, G.fy); g.restore();
    G.path(g); g.lineWidth = 2.5 / k; g.strokeStyle = o.stroke || '#e6c06a'; g.stroke();
    if (o.grid) { g.save(); G.path(g); g.clip(); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1 / k; for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.moveTo(bx + bw * f, by); g.lineTo(bx + bw * f, by + bh); g.moveTo(bx, by + bh * f); g.lineTo(bx + bw, by + bh * f); g.stroke(); } g.restore(); }
    g.setTransform(1, 0, 0, 1, 0, 0); return { k, box: G.box };
  };
  const loadImg = (src) => new Promise((res, rej) => { if (src && src.naturalWidth) return res(src); const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error(tr('تعذر فتح الصورة'))); im.src = src; });

  PC.open = async (o = {}) => {
    const im = await loadImg(o.image || o.src); let shape = o.shape || 'circle'; let crop = PC.norm(o.crop); const crop0 = PC.norm(o.crop);
    const body = document.createElement('div'); body.className = 'pc-dlg';
    const cv = document.createElement('canvas'); cv.width = 420; cv.height = 420; cv.className = 'pc-cv'; cv.title = tr('اسحب لتحريك الصورة، استخدم العجلة للتكبير');
    const ctl = document.createElement('div'); ctl.className = 'pc-ctl';
    const slider = (label, min, max, step, get, set) => { const r = document.createElement('div'); r.className = 'frow'; const l = document.createElement('label'); l.textContent = label; const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = get(); const v = document.createElement('span'); v.className = 'val'; v.textContent = (+get()).toFixed(2); i.oninput = () => { set(+i.value); v.textContent = (+i.value).toFixed(2); upd(); }; r.append(l, i, v); r._i = i; r._v = v; return r; };
    const zr = slider(tr('التكبير'), .3, 5, .01, () => crop.scale, v => crop.scale = v);
    const rr = slider(tr('الدوران'), -180, 180, .5, () => crop.rot, v => crop.rot = v);
    const sync = () => { zr._i.value = crop.scale; zr._v.textContent = crop.scale.toFixed(2); rr._i.value = crop.rot; rr._v.textContent = crop.rot.toFixed(2); };
    const bar = document.createElement('div'); bar.className = 'pc-bar';
    const b = (ico, label, f) => { const e = document.createElement('button'); e.className = 'btn sm'; e.innerHTML = GW.ico(ico, 13) + ' ' + GW.esc(label); e.onclick = () => { f(); sync(); upd(); }; return e; };
    bar.append(b('reset', tr('إعادة الضبط'), () => { crop = PC.norm(null); }), b('zoom', tr('تقريب الوجه'), () => { crop.scale = Math.max(crop.scale, 1.6); crop.y = .12; }), b('undo', tr('كما كانت'), () => { crop = PC.norm(crop0); }));
    // shape chips «شكل الإطار» (only when the caller can change it)
    let shp = null; if (o.onShape) { shp = document.createElement('div'); shp.className = 'pc-shapes'; for (const [k, n] of PC.SHAPES) { const e = document.createElement('button'); e.className = 'chip' + (k === shape ? ' on' : ''); e.dataset.k = k; const mini = document.createElement('canvas'); mini.width = mini.height = 44; PC.render(mini, im, k, crop, { fill: .9, ghost: false, bg: 'transparent' }); e.append(mini, document.createTextNode(tr(n))); e.onclick = () => { shape = k; o.onShape(k); shp.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.dataset.k === k)); upd(); }; shp.append(e); } }
    ctl.append(zr, rr, bar); body.append(...(shp ? [shp] : []), cv, ctl);
    let grid = false;
    const upd = () => { crop = PC.norm(crop); PC.render(cv, im, shape, crop, { grid }); o.onChange && o.onChange(Object.assign({}, crop)); };
    // drag / wheel; screen px → box fraction
    let drag = null;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); grid = true; const m = PC.render(cv, im, shape, crop, { grid }); drag = { x: e.clientX, y: e.clientY, c: Object.assign({}, crop), m, sc: cv.width / cv.getBoundingClientRect().width }; };
    cv.onpointermove = (e) => { if (!drag) return; const G = drag.m; crop.x = drag.c.x + (e.clientX - drag.x) * drag.sc / G.k / G.box[2]; crop.y = drag.c.y + (e.clientY - drag.y) * drag.sc / G.k / G.box[3]; upd(); };
    cv.onpointerup = () => { drag = null; grid = false; upd(); };
    cv.onwheel = (e) => { e.preventDefault(); crop.scale = Math.max(.3, Math.min(5, crop.scale * Math.exp(-e.deltaY * .0015))); sync(); upd(); };
    upd();
    PC._open = { cv, get: () => Object.assign({}, crop), set: (c) => { crop = PC.norm(Object.assign({}, crop, c)); sync(); upd(); } };
    return new Promise((resolve) => GW.modal({ title: o.title || tr('قص الصورة بدقة'), width: 470, body, buttons: [{ label: tr('إلغاء'), value: null }, { label: tr('تطبيق'), primary: true, value: 'ok' }],
      onClose: (v) => { PC._open = null; resolve(v ? PC.norm(crop) : null); } }));
  };

  /* ---------------- map leader layers ---------------- */
  const sceneOf = (c) => c && c.map && c.map.scene;
  const layerOf = (c, id) => { const sc = sceneOf(c); if (!sc) return null; return (sc.layers || []).find(L => L.id === id) || (id == null ? (sc.layers || []).find(L => L.type === 'image') : null); };
  PC.layerOf = layerOf;
  PC.forLayer = async (c, Ly) => {
    const sc = sceneOf(c); if (!Ly || !sc) return null; const src = sc.images && sc.images[Ly.img]; if (!src) { GW.toast(tr('اختر صورة القائد أولًا')); return null; }
    const before = Ly.crop ? Object.assign({}, Ly.crop) : null;
    const shape0 = { shape: Ly.shape, disp: Ly.disp };
    const onShape = (k) => { if (k === 'banner' || k === 'medallion' || k === 'coin' || k === 'heraldic') Ly.disp = k; else { if (['banner', 'medallion', 'coin', 'heraldic'].includes(Ly.disp)) delete Ly.disp; Ly.shape = k; } GW.invalidate(); };
    const r = await PC.open({ src, shape: PC.shapeFor(Ly), crop: Ly.crop, title: tr('ضبط صورة القائد'), onShape, onChange: (cr) => { Ly.crop = cr; GW.invalidate(); } });
    if (!r) { Ly.shape = shape0.shape; if (shape0.disp == null) delete Ly.disp; else Ly.disp = shape0.disp; }
    if (r) { Ly.crop = r; GW.commit(tr('قص صورة القائد')); } else { if (before) Ly.crop = before; else delete Ly.crop; }
    GW.invalidate(); return r;
  };
  // downscale (max 640 px) and embed into the scene; PNG when the picture has transparency (cut-out), JPEG otherwise
  PC.embed = (sc, cv, alpha) => { const k = Math.min(1, 640 / Math.max(cv.width, cv.height)); const c2 = document.createElement('canvas'); c2.width = Math.round(cv.width * k); c2.height = Math.round(cv.height * k); c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height); const id = GW.uid(); sc.images = sc.images || {}; sc.images[id] = alpha ? c2.toDataURL('image/png') : c2.toDataURL('image/jpeg', .9); return id; };
  PC.fromTimeline = async (c, Ly, o = {}) => {
    const sc = sceneOf(c); if (!sc || !Ly) throw new Error(tr('حدد طبقة صورة القائد'));
    let src = o.source ? (typeof o.source === 'string' ? GW.clipById(o.source) : o.source) : GW.FrameGrab.pick(); if (src === c) src = null;
    const fr = src ? await GW.FrameGrab.clipFrame(src, o.time) : await GW.FrameGrab.sequenceFrame(o.time);
    let cv = fr.canvas, alpha = false, engine = null;
    if (o.cutout) { const r = await GW.Cutout.run({ canvas: cv, name: fr.name, save: false, ask: o.ask }); if (r) { cv = r.canvas; alpha = true; engine = r.engine; } }
    const sv = await GW.Cutout.savePng(cv, fr.name, 'leaders', { tag: 'leader', derived: { clip: fr.clip || null, t: fr.t } });
    Ly.img = PC.embed(sc, cv, alpha); delete Ly.crop; GW.commit(tr('صورة القائد من الخط الزمني')); GW.invalidate();
    return { layer: Ly.id, img: Ly.img, media: sv.media ? sv.media.id : null, path: sv.path, width: cv.width, height: cv.height, source: fr.clip || null, time: fr.t, cutout: alpha, engine };
  };

  // ready-made controls for the Maps panel leader section: one call → a row of buttons (crop / from timeline / cut-out)
  PC.panelButtons = (c, Ly, onDone) => {
    const row = document.createElement('div'); row.className = 'pc-bar';
    const b = (ico, label, f) => { const e = document.createElement('button'); e.className = 'btn sm'; e.innerHTML = GW.ico(ico, 13) + ' ' + GW.esc(tr(label)); e.onclick = async () => { try { await f(); onDone && onDone(); } catch (er) { if (!er.cancelled) GW.toast(er.message, 'err'); } }; return e; };
    row.append(b('frame', 'قص الصورة بدقة…', () => PC.forLayer(c, Ly)), b('film', 'من الخط الزمني', () => PC.fromTimeline(c, Ly)), b('scissors', 'من الخط الزمني (قصاصة)', () => PC.fromTimeline(c, Ly, { cutout: true })));
    return row;
  };
  /* ---------------- API (js/api.js) ---------------- */
  PC.api = async (kind, p, H) => {
    const c = H.clipOf(p.id); if (!sceneOf(c)) H.fail('not a map clip: ' + p.id);
    const Ly = layerOf(c, p.layer); if (!Ly || Ly.type !== 'image') H.fail('image (leader) layer not found' + (p.layer ? ': ' + p.layer : ''));
    if (kind === 'crop') {
      if (p.reset) delete Ly.crop; else Ly.crop = PC.norm(Object.assign({}, Ly.crop || {}, ...['x', 'y', 'scale', 'rot'].filter(k => p[k] != null).map(k => ({ [k]: +p[k] }))));
      GW.commit(H.label('قص صورة القائد')); GW.invalidate(); return { layer: Ly.id, crop: Ly.crop || null, shape: PC.shapeFor(Ly) };
    }
    if (kind === 'grab') return PC.fromTimeline(c, Ly, { source: p.clip || p.source, time: p.time != null ? H.num(p.time, 'time') : undefined, cutout: !!p.cutout, ask: false });
    H.fail('unknown');
  };
  const css = document.createElement('style'); css.textContent = `
.pc-dlg{display:flex;flex-direction:column;gap:10px;align-items:stretch}
.pc-cv{width:100%;max-width:420px;align-self:center;border-radius:8px;cursor:grab;touch-action:none;background:#15171b}
.pc-cv:active{cursor:grabbing}
.pc-ctl .frow{display:flex;gap:8px;align-items:center;margin:4px 0}
.pc-ctl .frow label{width:70px;font-size:12px}
.pc-ctl .frow input{flex:1}
.pc-ctl .frow .val{width:44px;font-size:11px;direction:ltr;text-align:left;color:var(--text2)}
.pc-bar{display:flex;gap:6px;flex-wrap:wrap}
.pc-shapes{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.pc-shapes .chip{display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 6px;font-size:11px;height:auto}
.pc-shapes canvas{width:36px;height:36px}
.pc-thumb{display:flex;gap:10px;align-items:center;margin:6px 0}
.pc-thumb canvas{width:84px;height:84px;border-radius:8px;cursor:pointer;background:#15171b}`;
  document.head.append(css);
})();
