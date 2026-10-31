'use strict';
/* Pro colour tools on top of Lumetri (gl.js lumetri shader):
   GW.Curves  — RGB master/R/G/B + Hue→Sat / Hue→Hue / Luma→Sat curves (fx.curves), monotone spline baked to a 256×7 LUT texture
   GW.Color   — HSL secondary (fx.hsl range + hsl* correction params), eyedropper on the Program monitor, colour match, auto colour / WB
   GW.Scopes  — «مقاييس الألوان» panel: waveform (luma / RGB parade), vectorscope with skin-tone line, RGB histogram,
                computed from a ≤320px readback of the Program frame (PG.draw → Scopes.capture), only when the frame changes, never during export. */
(function () {
  const { clamp, esc } = GW;
  const r3 = v => Math.round(v * 1000) / 1000;

  /* ================= curves ================= */
  const C = GW.Curves = {};
  C.CH = [['m', 'الرئيسي'], ['r', 'أحمر'], ['g', 'أخضر'], ['b', 'أزرق'], ['hs', 'الدرجة ← التشبع'], ['hh', 'الدرجة ← الدرجة'], ['ls', 'الإضاءة ← التشبع']];
  const HUE = k => k === 'hs' || k === 'hh' || k === 'ls';
  const WRAP = k => k === 'hs' || k === 'hh';
  C.def = k => HUE(k) ? [[0, .5], [1, .5]] : [[0, 0], [1, 1]];
  C.DEF = () => { const o = {}; for (const [k] of C.CH) o[k] = C.def(k); return o; };
  const same = (a, b) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-6 && Math.abs(p[1] - b[i][1]) < 1e-6);
  C.isIdentity = (cv) => { if (!cv) return true; for (const [k] of C.CH) if (cv[k] && !same(cv[k], C.def(k))) return false; return true; };
  C.ensure = (fx) => { if (!fx.curves) fx.curves = C.DEF(); for (const [k] of C.CH) if (!fx.curves[k]) fx.curves[k] = C.def(k); return fx.curves; };
  // monotone cubic (Fritsch–Carlson): no overshoot, so an S-curve never folds back
  C.spline = (pts, wrap) => {
    let P = pts.slice().sort((a, b) => a[0] - b[0]);
    if (wrap) { const ext = [...P.map(p => [p[0] - 1, p[1]]), ...P, ...P.map(p => [p[0] + 1, p[1]])]; P = []; for (const p of ext.sort((a, b) => a[0] - b[0])) if (!P.length || p[0] - P[P.length - 1][0] > 1e-6) P.push(p); }
    const n = P.length; if (!n) return x => x; if (n === 1) return () => P[0][1];
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]), d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (Math.abs(d[i]) < 1e-12) { m[i] = 0; m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    return x => {
      if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0; while (i < n - 2 && xs[i + 1] < x) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  };
  // rows: m, r, g, b, hs, hh, ls → Float32Array(256*7) (hue rows keep .5 = neutral)
  C.bake = (cv) => {
    const out = new Float32Array(256 * 7);
    C.CH.forEach(([k], row) => { const f = C.spline((cv && cv[k]) || C.def(k), WRAP(k)); for (let i = 0; i < 256; i++) out[row * 256 + i] = clamp(f(i / 255), 0, 1); });
    return out;
  };
  // CPU reference of the shader's curve stage (tests / API previews): rgb 0..1 → rgb
  C.apply = (cv, rgb) => {
    const L = C.bake(cv), S = (x, row) => { const p = clamp(x, 0, 1) * 255, i = Math.floor(p), f = p - i; return L[row * 256 + i] * (1 - f) + L[row * 256 + Math.min(255, i + 1)] * f; };
    let m = rgb.map(v => S(v, 0)); m = [S(m[0], 1), S(m[1], 2), S(m[2], 3)];
    const mx = Math.max(...m), mn = Math.min(...m), d = mx - mn; let h = 0; if (d > 1e-9) { h = mx === m[0] ? ((m[1] - m[2]) / d) % 6 : mx === m[1] ? (m[2] - m[0]) / d + 2 : (m[0] - m[1]) / d + 4; h = ((h / 6) % 1 + 1) % 1; }
    let s = mx > 1e-9 ? d / mx : 0; const lum = .2126 * m[0] + .7152 * m[1] + .0722 * m[2];
    s = clamp(s * S(h, 4) * 2, 0, 1); h = ((h + S(h, 5) - .5) % 1 + 1) % 1; s = clamp(s * S(lum, 6) * 2, 0, 1);
    const f = (n) => { const k = (n + h * 6) % 6; return mx - mx * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)];
  };

  /* ---- editor widget: add (click), drag, delete (double-click / right-click) points; one canvas, channel tabs above ---- */
  let curCh = 'm';
  const css = document.createElement('style');
  css.textContent = `.cv-ed{display:flex;flex-direction:column;gap:5px}.cv-ed canvas{width:100%;aspect-ratio:1/1;max-height:240px;border:1px solid var(--line);border-radius:4px;background:#111;cursor:crosshair;touch-action:none;display:block}
  .cv-ed .seg button{font-size:10.5px;padding:0 4px}.cv-tabs{display:flex;gap:4px;flex-wrap:wrap}.cv-tabs .seg{flex:1}
  .hsl-sw{width:22px;height:22px;border-radius:4px;border:1px solid var(--line3);flex:none}.hsl-rng{display:flex;gap:4px;align-items:center;flex:1}.hsl-rng input{flex:1;min-width:0}
  .scopes{position:relative;flex:1;min-height:0}.scopes canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  .cm-ref{display:flex;gap:8px;align-items:center}.cm-ref canvas{width:64px;height:36px;border:1px solid var(--line3);border-radius:3px;background:#000}`;
  document.head.append(css);
  C.editor = (fx, onChange) => {
    const box = document.createElement('div'); box.className = 'cv-ed';
    const tabs = document.createElement('div'); tabs.className = 'cv-tabs';
    const seg1 = document.createElement('div'); seg1.className = 'seg'; const seg2 = document.createElement('div'); seg2.className = 'seg';
    for (const [k, n] of C.CH) { const b = document.createElement('button'); b.textContent = n; b.dataset.ch = k; b.classList.toggle('on', k === curCh); b.onclick = () => { curCh = k; box.querySelectorAll('[data-ch]').forEach(x => x.classList.toggle('on', x.dataset.ch === k)); draw(); }; (HUE(k) ? seg2 : seg1).append(b); }
    tabs.append(seg1); box.append(tabs, seg2);
    const cv = document.createElement('canvas'); cv.dataset.a = 'curve'; box.append(cv);
    const g = cv.getContext('2d'); let W = 0, H = 0; const pad = 6;
    const X = x => pad + x * (W - 2 * pad), Y = y => H - pad - y * (H - 2 * pad), iX = px => clamp((px - pad) / (W - 2 * pad), 0, 1), iY = py => clamp((H - pad - py) / (H - 2 * pad), 0, 1);
    const pts = () => C.ensure(fx)[curCh];
    function draw() {
      const r = cv.getBoundingClientRect(); const dpr = devicePixelRatio || 1; W = Math.max(40, r.width); H = Math.max(40, r.height);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const hue = HUE(curCh);
      if (hue) { const gr = g.createLinearGradient(X(0), 0, X(1), 0); if (curCh === 'ls') { gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff'); } else for (let i = 0; i <= 12; i++) gr.addColorStop(i / 12, `hsl(${i * 30},80%,50%)`); g.fillStyle = gr; g.globalAlpha = .35; g.fillRect(X(0), H - pad - 8, X(1) - X(0), 8); g.globalAlpha = 1; }
      g.strokeStyle = '#2a2a2a'; g.lineWidth = 1; for (let i = 1; i < 4; i++) { const x = Math.round(X(i / 4)) + .5, y = Math.round(Y(i / 4)) + .5; g.beginPath(); g.moveTo(x, pad); g.lineTo(x, H - pad); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke(); }
      g.strokeStyle = '#444'; g.beginPath(); if (hue) { g.moveTo(X(0), Y(.5)); g.lineTo(X(1), Y(.5)); } else { g.moveTo(X(0), Y(0)); g.lineTo(X(1), Y(1)); } g.stroke();
      const f = C.spline(pts(), WRAP(curCh)); const col = { r: '#e8574a', g: '#5ec46a', b: '#4f9df7' }[curCh] || (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#ff6a2b').trim();
      g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath(); for (let i = 0; i <= 128; i++) { const x = i / 128, y = clamp(f(x), 0, 1); i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); } g.stroke();
      for (const p of pts()) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(p[0]), Y(p[1]), 4, 0, 7); g.fill(); g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); }
    }
    const hit = (px, py) => pts().findIndex(p => Math.hypot(X(p[0]) - px, Y(p[1]) - py) < 8);
    const changed = (fin) => { GW.invalidate(); onChange && onChange(fin); draw(); };
    cv.addEventListener('pointerdown', e => {
      if (e.button === 2) return; const r = cv.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top; const P = pts(); let i = hit(px, py);
      if (i < 0) { P.push([r3(iX(px)), r3(iY(py))]); P.sort((a, b) => a[0] - b[0]); i = P.findIndex(p => p[0] === r3(iX(px)) && p[1] === r3(iY(py))); }
      cv.setPointerCapture(e.pointerId);
      const mv = ev => { const x = iX(ev.clientX - r.left), y = iY(ev.clientY - r.top); const lo = i > 0 ? P[i - 1][0] + .004 : 0, hi = i < P.length - 1 ? P[i + 1][0] - .004 : 1; P[i] = [r3(clamp(x, lo, hi)), r3(y)]; changed(false); };
      mv(e); cv.onpointermove = mv; cv.onpointerup = () => { cv.onpointermove = null; cv.onpointerup = null; changed(true); };
    });
    const del = (px, py) => { const P = pts(); const i = hit(px, py); if (i < 0 || P.length <= 2) return; P.splice(i, 1); changed(true); };
    cv.addEventListener('dblclick', e => { const r = cv.getBoundingClientRect(); del(e.clientX - r.left, e.clientY - r.top); });
    cv.addEventListener('contextmenu', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top; if (hit(px, py) >= 0) GW.menu(e.clientX, e.clientY, [{ label: 'حذف النقطة', action: () => del(px, py) }]); else GW.menu(e.clientX, e.clientY, [{ label: 'إعادة ضبط هذا المنحنى', action: () => { fx.curves[curCh] = C.def(curCh); changed(true); } }]); });
    new ResizeObserver(() => draw()).observe(cv); requestAnimationFrame(draw);
    box.draw = draw; return box;
  };

  /* ================= HSL secondary + colour match + auto ================= */
  const K = GW.Color = { picking: null, ref: null };
  K.HSL_DEF = () => ({ on: 1, hue: 120, hueW: 60, sat: [0, 100], lum: [0, 100], soft: 20, denoise: 0, show: 0 });
  K.ensureHsl = (fx) => fx.hsl || (fx.hsl = K.HSL_DEF());
  const lumetriOf = (c, create) => GW.LUT ? GW.LUT.lumetriOf(c, create) : (c.fx || []).find(f => f.type === 'lumetri') || null;
  const rgb2hsl = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 1e-9) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = ((h * 60) % 360 + 360) % 360; } const s = mx > 1e-9 ? d / mx : 0; return [h, s, .2126 * r + .7152 * g + .0722 * b]; };
  // range from a picked colour (like Premiere's eyedropper): hue ±20°, sat / luma ±25 %
  K.rangeFrom = (hsl, rgb) => { const [h, s, l] = rgb2hsl(rgb); hsl.hue = Math.round(h); hsl.hueW = 40; hsl.sat = [Math.round(clamp(s * 100 - 25, 0, 100)), Math.round(clamp(s * 100 + 25, 0, 100))]; hsl.lum = [Math.round(clamp(l * 100 - 25, 0, 100)), Math.round(clamp(l * 100 + 25, 0, 100))]; hsl.picked = GW.rgb2hex(...rgb.map(v => Math.round(v * 255))); return hsl; };
  // a frame of the active sequence as RGBA bytes (over black), downscaled; fxOff = effects to disable while sampling (source colours)
  K.frame = async (s, t, maxW, fxOff) => {
    const k = Math.min(1, Math.max(32, maxW || 160) / s.w); const was = GW.Render.exporting; GW.Render.exporting = true; const st = (fxOff || []).map(f => [f, f.on]); for (const f of fxOff || []) f.on = 0;
    try { await GW.Render.prepareExportFrame(s, t, k); const acc = GW.Render.frame(s, t, { scale: k, exporting: true }); const buf = GW.R.readRGBA(acc.w, acc.h, acc, null, false); const o = { buf, w: acc.w, h: acc.h }; GW.R.free(acc); return o; }
    finally { for (const [f, on] of st) f.on = on; GW.Render.exporting = was; GW.invalidate(); }
  };
  // 3×3 average at normalized (nx, ny); row 0 = top (readRGBA flips)
  K.sampleAt = (fr, nx, ny) => { const x = clamp(Math.round(nx * fr.w), 1, fr.w - 2), y = clamp(Math.round(ny * fr.h), 1, fr.h - 2); const o = [0, 0, 0]; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = ((y + dy) * fr.w + x + dx) * 4; o[0] += fr.buf[i]; o[1] += fr.buf[i + 1]; o[2] += fr.buf[i + 2]; } return o.map(v => v / 9 / 255); };
  // per-channel mean / std, luma mean / std, mean chroma (Cb/Cr magnitude) — the "Reinhard" statistics
  // black / letterbox pixels (max channel < 6/255) are ignored so bars and empty tracks do not drag the picture statistics
  K.stats = (fr) => {
    const b = fr.buf; let n = 0; const m = [0, 0, 0], q = [0, 0, 0]; let my = 0, qy = 0, ch = 0; let lit = 0;
    for (let i = 0; i < b.length; i += 4) if (b[i] > 5 || b[i + 1] > 5 || b[i + 2] > 5) lit++;
    const skip = lit > fr.w * fr.h * .02;
    for (let i = 0; i < b.length; i += 4) { if (skip && b[i] < 6 && b[i + 1] < 6 && b[i + 2] < 6) continue; n++; const r = b[i] / 255, g = b[i + 1] / 255, bl = b[i + 2] / 255; m[0] += r; m[1] += g; m[2] += bl; q[0] += r * r; q[1] += g * g; q[2] += bl * bl; const y = .2126 * r + .7152 * g + .0722 * bl; my += y; qy += y * y; const cb = -.1146 * r - .3854 * g + .5 * bl, cr = .5 * r - .4542 * g - .0458 * bl; ch += Math.hypot(cb, cr); }
    n = Math.max(1, n); const mean = m.map(v => v / n), std = q.map((v, i) => Math.sqrt(Math.max(0, v / n - mean[i] * mean[i])));
    return { mean, std, meanY: my / n, stdY: Math.sqrt(Math.max(0, qy / n - (my / n) ** 2)), chroma: ch / n };
  };
  const pvAt = (fx, k, lt) => { const d = GW.FX.lumetri.p.find(p => p.k === k); const P = fx.params[k] || (fx.params[k] = GW.P(d ? d.def : 0)); return GW.pv(P, lt); };
  const setAt = (fx, k, lt, v) => { const P = fx.params[k] || (fx.params[k] = GW.P(0)); GW.setPv(P, lt, Math.round(v * 100) / 100); };
  // one correction step: move exposure / contrast / temp / tint / saturation of fx so src statistics approach ref
  function step(fx, lt, src, ref, w) {
    const e = 1e-4;
    setAt(fx, 'exposure', lt, clamp(pvAt(fx, 'exposure', lt) + clamp(Math.log2((ref.meanY + e) / (src.meanY + e)), -2, 2) * w, -4, 4));
    const cr = clamp((ref.stdY + e) / (src.stdY + e), .4, 2.5); setAt(fx, 'contrast', lt, clamp(((1 + pvAt(fx, 'contrast', lt) / 100) * (1 + (cr - 1) * w) - 1) * 100, -80, 80));
    const q = ((ref.mean[0] + e) / (ref.mean[2] + e)) * ((src.mean[2] + e) / (src.mean[0] + e)); const x = (q - 1) / (q + 1); setAt(fx, 'temp', lt, clamp(pvAt(fx, 'temp', lt) + 250 * x * w, -100, 100));
    const gS = src.mean[1] / ((src.mean[0] + src.mean[2]) / 2 + e), gR = ref.mean[1] / ((ref.mean[0] + ref.mean[2]) / 2 + e); const q2 = (gR + e) / (gS + e); const y = (1 - q2) / (1 / 250 + q2 / 400); setAt(fx, 'tint', lt, clamp(pvAt(fx, 'tint', lt) + y * w, -100, 100));
    const sr = clamp((ref.chroma + e) / (src.chroma + e), .2, 4); setAt(fx, 'sat', lt, clamp(pvAt(fx, 'sat', lt) * (1 + (sr - 1) * w), 0, 200));
  }
  const dist = (a, b) => Math.hypot(a.mean[0] - b.mean[0], a.mean[1] - b.mean[1], a.mean[2] - b.mean[2]);
  // colour match: reference = what the Program shows at refT; target clip c gets Lumetri basic params so its frame at t matches (2 refinement passes)
  K.match = async (c, t, refT, opts = {}) => {
    const s = GW.seq(); if (t == null) t = clamp(s.t, c.start, c.start + c.dur - 1e-3); const lt = t - c.start;
    const ref = opts.ref || K.stats(await K.frame(s, refT, 160));
    const fx = lumetriOf(c, true); const before = K.stats(await K.frame(s, t, 160)); let cur = before;
    for (const w of [1, .8, .6, .5, .4]) { step(fx, lt, cur, ref, w); cur = K.stats(await K.frame(s, t, 160)); }
    const o = { clip: c.id, fx: fx.id, before: { mean: before.mean.map(r3), dist: r3(dist(before, ref)) }, after: { mean: cur.mean.map(r3), dist: r3(dist(cur, ref)) }, ref: { mean: ref.mean.map(r3) }, params: {} };
    for (const k of ['exposure', 'contrast', 'temp', 'tint', 'sat']) o.params[k] = pvAt(fx, k, lt);
    return o;
  };
  // auto: grey-world white balance (temp/tint) and/or auto levels (exposure toward mid grey, contrast toward a healthy spread)
  K.auto = async (c, t, { wb = true, levels = true } = {}) => {
    const s = GW.seq(); if (t == null) t = clamp(s.t, c.start, c.start + c.dur - 1e-3); const lt = t - c.start; const fx = lumetriOf(c, true);
    for (let i = 0; i < 2; i++) {
      const src = K.stats(await K.frame(s, t, 160)); const grey = (src.mean[0] + src.mean[1] + src.mean[2]) / 3;
      const ref = { mean: wb ? [grey, grey, grey] : src.mean, meanY: levels ? .45 : src.meanY, stdY: levels ? clamp(src.stdY, .18, .26) : src.stdY, chroma: src.chroma };
      step(fx, lt, src, ref, i ? .6 : 1);
    }
    const o = { clip: c.id, fx: fx.id, params: {} }; for (const k of ['exposure', 'contrast', 'temp', 'tint']) o.params[k] = pvAt(fx, k, lt); return o;
  };
  // eyedropper: Program monitor click (ui_monitors.js hands X,Y in overlay px) → source colour under the cursor (this Lumetri disabled)
  K.pickStart = (c, fx, cb) => { K.picking = { c, fx, cb }; if (GW.Program && GW.Program.ov) GW.Program.ov.style.cursor = 'crosshair'; GW.toast('انقر على شاشة البرنامج لاختيار اللون'); };
  K.pickAt = (X, Y) => {
    const P = K.picking; if (!P) return false; const b = GW.Program.box; if (!b) return false; K.picking = null; GW.Program.ov.style.cursor = '';
    const nx = (X - b.x) / b.w, ny = (Y - b.y) / b.h; if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return true;
    (async () => { const s = GW.seq(); const fr = await K.frame(s, s.t, 320, [P.fx]); const rgb = K.sampleAt(fr, nx, ny); const H = K.ensureHsl(P.fx); K.rangeFrom(H, rgb); H.on = 1; GW.commit('اختيار لون HSL'); GW.invalidate(); P.cb && P.cb(rgb); })();
    return true;
  };

  /* ---- Lumetri panel sections (ui_panels.js renderLum → K.panelRows) ---- */
  K.panelRows = (f, c, fx, F, rerender) => {
    const lt = GW.seq().t - c.start; const ch = (label) => { GW.invalidate(); GW.commitSoon(label); GW.bus.emit('param'); };
    const slider = (k, label) => { const d = GW.FX.lumetri.p.find(p => p.k === k); const P = fx.params[k] || (fx.params[k] = GW.P(d.def)); return F.frow(label || d.n, F.rangeIn(GW.pv(P, lt), d.min, d.max, d.step, v => { GW.setPv(P, lt, v); ch('ألوان'); })); };
    // curves
    f.append(F.sec('المنحنيات'));
    f.append(C.editor(fx, (fin) => { if (fin) GW.commitSoon('منحنيات'); }));
    f.append(slider('cvInt', 'الشدة'));
    const rc = document.createElement('button'); rc.className = 'btn sm'; rc.textContent = 'إعادة ضبط المنحنيات'; rc.onclick = () => { delete fx.curves; GW.commit('إعادة ضبط المنحنيات'); GW.invalidate(); rerender(); }; f.append(rc);
    // HSL secondary
    f.append(F.sec('HSL ثانوي'));
    const H = fx.hsl; const on = F.checkIn(H && H.on, v => { K.ensureHsl(fx).on = v; GW.commit(v ? 'تفعيل HSL ثانوي' : 'تعطيل HSL ثانوي'); GW.invalidate(); rerender(); });
    f.append(F.frow('تفعيل', on));
    if (H) {
      const pick = document.createElement('button'); pick.className = 'btn sm'; pick.innerHTML = (GW.ico ? GW.ico('wand', 13) + ' ' : '') + 'اختيار من الشاشة'; pick.title = 'انقر ثم اختر اللون من شاشة البرنامج'; pick.dataset.a = 'hsl-pick';
      const sw = document.createElement('span'); sw.className = 'hsl-sw'; sw.style.background = H.picked || `hsl(${H.hue},70%,50%)`; sw.dataset.a = 'hsl-sw';
      pick.onclick = () => K.pickStart(c, fx, () => rerender());
      f.append(F.frow('اللون', [pick, sw]));
      const hr = (label, get, set, min, max, step) => f.append(F.frow(label, F.rangeIn(get(), min, max, step || 1, v => { set(v); sw.style.background = `hsl(${H.hue},70%,50%)`; delete H.picked; ch('نطاق HSL'); })));
      hr('مركز الدرجة', () => H.hue, v => H.hue = v, 0, 360); hr('عرض الدرجة', () => H.hueW, v => H.hueW = v, 0, 180);
      const range = (label, arr) => { const w = document.createElement('div'); w.className = 'hsl-rng'; const lo = document.createElement('input'), hi = document.createElement('input'); for (const [i, x] of [[0, lo], [1, hi]]) { x.type = 'range'; x.min = 0; x.max = 100; x.step = 1; x.value = arr[i]; x.oninput = () => { arr[0] = Math.min(+lo.value, +hi.value); arr[1] = Math.max(+lo.value, +hi.value); val.textContent = arr[0] + '–' + arr[1]; ch('نطاق HSL'); }; } const val = document.createElement('span'); val.className = 'val'; val.textContent = arr[0] + '–' + arr[1]; w.append(lo, hi, val); f.append(F.frowEl(label, w)); };
      range('التشبع', H.sat); range('الإضاءة', H.lum);
      hr('النعومة', () => H.soft, v => H.soft = v, 0, 100); hr('تقليل الضجيج', () => H.denoise, v => H.denoise = v, 0, 8, .5);
      f.append(F.frow('إظهار القناع', F.checkIn(H.show, v => { H.show = v; GW.commit(v ? 'إظهار قناع HSL' : 'إخفاء قناع HSL'); GW.invalidate(); })));
      f.append(F.sec('تصحيح النطاق المحدد'));
      for (const k of ['hslTemp', 'hslTint', 'hslCon', 'hslSat', 'hslExp']) f.append(slider(k));
    }
    // colour match / auto
    f.append(F.sec('مطابقة اللون'));
    const refRow = document.createElement('div'); refRow.className = 'cm-ref';
    const th = document.createElement('canvas'); th.width = 64; th.height = 36; th.dataset.a = 'cm-thumb';
    const setRef = document.createElement('button'); setRef.className = 'btn sm'; setRef.textContent = 'تعيين الإطار المرجعي'; setRef.title = 'يحفظ إطار مؤشر التشغيل الحالي كمرجع للمطابقة';
    const lbl = document.createElement('span'); lbl.style.color = 'var(--mute)'; lbl.style.fontSize = '11px'; lbl.textContent = K.ref ? GW.fmtTC(K.ref.t, GW.seq().fps) : 'لم يُحدد';
    if (K.ref && K.ref.img) th.getContext('2d').drawImage(K.ref.img, 0, 0, 64, 36);
    setRef.onclick = async () => { const s = GW.seq(); const fr = await K.frame(s, s.t, 128); const cv = document.createElement('canvas'); cv.width = fr.w; cv.height = fr.h; cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(fr.buf.buffer, fr.buf.byteOffset, fr.buf.byteLength), fr.w, fr.h), 0, 0); K.ref = { t: s.t, seq: s.id, img: cv, stats: K.stats(fr) }; GW.toast('تم تعيين الإطار المرجعي'); rerender(); };
    refRow.append(th, setRef, lbl); f.append(refRow);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const mk = (txt, title, act) => { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = txt; b.title = title; b.onclick = async () => { b.disabled = true; try { await act(); GW.commit(txt); GW.invalidate(); rerender(); } catch (e) { GW.toast(e.message, 'err'); } b.disabled = false; }; return b; };
    const mb = mk('مطابقة اللون', 'يضبط التعريض والتباين وتوازن الأبيض والتشبع ليطابق الإطار المرجعي', async () => { if (!K.ref) throw new Error('عيّن الإطار المرجعي أولًا'); await K.match(c, null, K.ref.t, { ref: K.ref.stats }); }); mb.className = 'btn sm pri'; mb.dataset.a = 'cm-match';
    row.append(mb, mk('لون تلقائي', 'تعريض وتباين وتوازن أبيض تلقائي', () => K.auto(c, null, { wb: true, levels: true })), mk('توازن أبيض تلقائي', 'توازن أبيض فقط (العالم الرمادي)', () => K.auto(c, null, { wb: true, levels: false })));
    f.append(row);
  };
  // Effect Controls rows (ui_fxc.js fxBlock): grouped params with keyframes + curves / HSL toggles
  K.fxcRows = (sec, c, fx, row, numCtl) => {
    const hdr = (t) => { const d = document.createElement('div'); d.className = 'fxc-hdr'; d.style.cssText = 'position:static;color:var(--mute);height:20px;font-size:11px'; d.textContent = t; sec.body.append(d); };
    hdr('المنحنيات');
    const eb = document.createElement('button'); eb.className = 'btn sm'; eb.textContent = C.isIdentity(fx.curves) ? 'تحرير في لوحة Lumetri' : 'معدّلة — تحرير في Lumetri'; eb.onclick = () => GW.showPanel('lumetri');
    sec.body.append(row(c, null, 'المنحنيات', eb, { noAnim: true }));
    for (const p of GW.FX.lumetri.p) if (p.grp === 'curves') { const P = fx.params[p.k] || (fx.params[p.k] = GW.P(p.def)); sec.body.append(row(c, P, p.n, numCtl(c, P, { min: p.min, max: p.max, step: p.step, unit: '%' }), { def: p.def })); }
    hdr('HSL ثانوي');
    const on = document.createElement('input'); on.type = 'checkbox'; on.checked = !!(fx.hsl && fx.hsl.on); on.onchange = () => { K.ensureHsl(fx).on = on.checked ? 1 : 0; GW.commit(on.checked ? 'تفعيل HSL ثانوي' : 'تعطيل HSL ثانوي'); GW.invalidate(); };
    sec.body.append(row(c, null, 'تفعيل', on, { noAnim: true }));
    if (fx.hsl) for (const p of GW.FX.lumetri.p) if (p.grp === 'hsl') { const P = fx.params[p.k] || (fx.params[p.k] = GW.P(p.def)); sec.body.append(row(c, P, p.n, numCtl(c, P, { min: p.min, max: p.max, step: Math.max(p.step, (p.max - p.min) / 400), dec: p.step < 1 ? 2 : 1 }), { def: p.def })); }
  };

  /* ---- automation (api.js: setCurves / colorMatch / autoColor / setHslSecondary) ---- */
  const clipArg = (id) => { let c = id ? GW.clipById(id) : [...GW.sel.clips].map(x => GW.clipById(x)).find(x => x && x.tt === 'v'); if (!c) throw new Error('id required (a video clip or adjustment layer)'); if (c.tt !== 'v' || !c.fx) throw new Error('colour tools apply to video clips / adjustment layers'); return c; };
  const ALIAS = { master: 'm', m: 'm', r: 'r', red: 'r', g: 'g', green: 'g', b: 'b', blue: 'b', hs: 'hs', hueSat: 'hs', hh: 'hh', hueHue: 'hh', ls: 'ls', lumaSat: 'ls' };
  K.setCurvesApi = ({ id, curves, intensity, reset } = {}) => {
    const c = clipArg(id); const fx = lumetriOf(c, true);
    if (reset) delete fx.curves;
    if (curves) { const cv = C.ensure(fx); for (const k in curves) { const ch = ALIAS[k]; if (!ch) throw new Error('unknown curve "' + k + '" (master r g b hueSat hueHue lumaSat)'); const pts = curves[k]; if (!Array.isArray(pts) || pts.length < 2 || pts.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !(v >= 0 && v <= 1)))) throw new Error('curve ' + k + ': [[x,y],…] with ≥2 points in 0..1'); cv[ch] = pts.map(p => [r3(+p[0]), r3(+p[1])]).sort((a, b) => a[0] - b[0]); } }
    if (intensity != null) fx.params.cvInt = GW.P(clamp(+intensity, 0, 100));
    GW.commit('المساعد: المنحنيات'); GW.invalidate(); if (GW.FXC && GW.FXC.render) try { GW.FXC.render(); } catch (e) {}
    return { clip: c.id, fx: fx.id, curves: fx.curves ? JSON.parse(JSON.stringify(fx.curves)) : null, identity: C.isIdentity(fx.curves), intensity: GW.pv(fx.params.cvInt, 0) };
  };
  K.matchApi = async ({ id, refTime, time } = {}) => { const c = clipArg(id); if (refTime == null) throw new Error('refTime required (seconds on the timeline; the Program frame there is the reference)'); const o = await K.match(c, time != null ? +time : null, +refTime); GW.commit('المساعد: مطابقة اللون'); GW.invalidate(); return o; };
  K.autoApi = async ({ id, time, wb = true, levels = true } = {}) => { const c = clipArg(id); const o = await K.auto(c, time != null ? +time : null, { wb: !!wb, levels: !!levels }); GW.commit('المساعد: لون تلقائي'); GW.invalidate(); return o; };
  K.hslApi = ({ id, on, hue, hueW, sat, lum, soft, denoise, show, color, temp, tint, contrast, saturation, exposure } = {}) => {
    const c = clipArg(id); const fx = lumetriOf(c, true); const H = K.ensureHsl(fx);
    if (color) K.rangeFrom(H, GW.hexf(color));
    for (const [k, v] of [['hue', hue], ['hueW', hueW], ['soft', soft], ['denoise', denoise]]) if (v != null) H[k] = +v;
    if (sat) H.sat = [clamp(+sat[0], 0, 100), clamp(+sat[1], 0, 100)]; if (lum) H.lum = [clamp(+lum[0], 0, 100), clamp(+lum[1], 0, 100)];
    if (show != null) H.show = show ? 1 : 0; if (on != null) H.on = on ? 1 : 0;
    for (const [k, v] of [['hslTemp', temp], ['hslTint', tint], ['hslCon', contrast], ['hslSat', saturation], ['hslExp', exposure]]) if (v != null) fx.params[k] = GW.P(+v);
    GW.commit('المساعد: HSL ثانوي'); GW.invalidate(); return { clip: c.id, fx: fx.id, hsl: JSON.parse(JSON.stringify(H)) };
  };

  /* ================= scopes ================= */
  let mode0 = 'pv'; try { mode0 = localStorage.getItem('qq.scopeMode') || 'pv'; } catch (e) {}
  const S = GW.Scopes = { mode: mode0, buf: null, w: 0, h: 0, ver: 0, last: 0 };
  const MODES = [['pv', 'RGB + متجه'], ['all', 'الكل'], ['wave', 'موجي'], ['parade', 'RGB'], ['vector', 'متجه'], ['hist', 'مدرج']];
  GW.registerPanel('scopes', 'مقاييس الألوان', (el) => {
    el.innerHTML = `<div class="ptool" dir="rtl"><div class="seg" data-a="m" style="flex:1">${MODES.map(([k, n]) => `<button data-m="${k}" class="${k === S.mode ? 'on' : ''}">${esc(n)}</button>`).join('')}</div></div><div class="scopes" data-a="b"><canvas data-a="cv"></canvas></div>`;
    S.el = el; S.cv = el.querySelector('[data-a=cv]');
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { S.mode = b.dataset.m; try { localStorage.setItem('qq.scopeMode', S.mode); } catch (e) {} el.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); S.draw(); });
    new ResizeObserver(() => S.draw()).observe(el.querySelector('[data-a=b]'));
    GW.bus.on('panel-shown', id => { if (id === 'scopes') GW.invalidate(); });
  });
  // called by the Program monitor right after rendering a frame (before it is freed); ≤ 320 px wide readback
  S.capture = (acc) => {
    if (!S.el || GW.Render.exporting || !GW.isShown('scopes')) return;
    const now = performance.now(); if (GW.pb && GW.pb.playing && now - S.last < 80) return; S.last = now;
    const R = GW.R, w = Math.min(320, acc.w), h = Math.max(1, Math.round(acc.h * w / acc.w));
    const small = R.fbo(w, h); R.pass('copy', small, [acc.tex]);
    S.buf = R.readRGBA(w, h, small, S.buf && S.buf.length === w * h * 4 ? S.buf : null, false); R.free(small); S.w = w; S.h = h; S.ver++;
    if (!S._q) S._q = requestAnimationFrame(() => { S._q = null; S.draw(); });
  };
  // statistics from the last captured frame (tests / API)
  S.data = () => {
    const b = S.buf; if (!b) return null; const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]; let my = 0; const vec = new Uint32Array(64 * 64);
    for (let i = 0; i < b.length; i += 4) { hist[0][b[i]]++; hist[1][b[i + 1]]++; hist[2][b[i + 2]]++; const r = b[i] / 255, g = b[i + 1] / 255, bl = b[i + 2] / 255; my += .2126 * r + .7152 * g + .0722 * bl; const cb = -.1146 * r - .3854 * g + .5 * bl, cr = .5 * r - .4542 * g - .0458 * bl; vec[clamp(Math.round((cr + .5) * 63), 0, 63) * 64 + clamp(Math.round((cb + .5) * 63), 0, 63)]++; }
    return { w: S.w, h: S.h, ver: S.ver, hist, meanY: my / (S.w * S.h), vector: vec };
  };
  const Y = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
  function waveform(g, x0, y0, W, H, parade) {
    const b = S.buf, sw = S.w, sh = S.h; const cols = Math.max(8, Math.floor(W)), rows = Math.max(8, Math.floor(H));
    g.fillStyle = '#0c0c0c'; g.fillRect(x0, y0, W, H);
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 1; for (let i = 0; i <= 10; i++) { const y = Math.round(y0 + H * i / 10) + .5; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + W, y); g.stroke(); }
    const n = parade ? 3 : 1, cw = Math.floor(cols / n); const img = g.createImageData(cols, rows); const d = img.data; const acc = new Float32Array(cols * rows * n);
    const gain = 90 / Math.max(1, sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = (y * sw + x) * 4; const px = Math.min(cw - 1, Math.floor(x / sw * cw)); for (let k = 0; k < n; k++) { const v = parade ? b[i + k] / 255 : Y(b[i] / 255, b[i + 1] / 255, b[i + 2] / 255); const ry = clamp(Math.round((1 - v) * (rows - 1)), 0, rows - 1); acc[(ry * cols + px + k * cw) * n + k] += gain; } }
    for (let p = 0; p < cols * rows; p++) { let r = 0, gg = 0, bb = 0; if (parade) { const k = Math.min(2, Math.floor((p % cols) / cw)); const a = Math.min(1, acc[p * 3 + k]); const col = [[1, .45, .4], [.45, 1, .45], [.45, .6, 1]][k]; r = col[0] * a; gg = col[1] * a; bb = col[2] * a; } else { const a = Math.min(1, acc[p]); r = .55 * a; gg = .95 * a; bb = .65 * a; } if (r + gg + bb > 0) { d[p * 4] = r * 255; d[p * 4 + 1] = gg * 255; d[p * 4 + 2] = bb * 255; d[p * 4 + 3] = 255; } }
    const t = S._t || (S._t = document.createElement('canvas')); t.width = cols; t.height = rows; t.getContext('2d').putImageData(img, 0, 0);
    g.globalCompositeOperation = 'lighter'; g.drawImage(t, x0, y0, W, H); g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#777'; g.font = '9px "JetBrains Mono", monospace'; g.textAlign = 'left'; g.fillText('100', x0 + 3, y0 + 9); g.fillText('0', x0 + 3, y0 + H - 3);
    if (parade) { g.textAlign = 'center'; ['R', 'G', 'B'].forEach((c, k) => g.fillText(c, x0 + cw * (k + .5), y0 + H - 3)); }
  }
  function vectorscope(g, x0, y0, W, H) {
    const b = S.buf; const sz = Math.min(W, H), cx = x0 + W / 2, cy = y0 + H / 2, R = sz / 2 - 4; const N = 128; const acc = new Float32Array(N * N); const gain = 2400 / Math.max(1, S.w * S.h);
    g.fillStyle = '#0c0c0c'; g.fillRect(x0, y0, W, H);
    for (let i = 0; i < b.length; i += 4) { const r = b[i] / 255, gg = b[i + 1] / 255, bl = b[i + 2] / 255; const cb = -.1146 * r - .3854 * gg + .5 * bl, cr = .5 * r - .4542 * gg - .0458 * bl; const x = clamp(Math.round((cb + .5) * (N - 1)), 0, N - 1), y = clamp(Math.round((.5 - cr) * (N - 1)), 0, N - 1); acc[y * N + x] += gain; }
    const img = g.createImageData(N, N); const d = img.data; for (let p = 0; p < N * N; p++) { const a = Math.min(1, acc[p]); if (a > 0) { d[p * 4] = 120 * a + 60 * a * a; d[p * 4 + 1] = 230 * a; d[p * 4 + 2] = 150 * a; d[p * 4 + 3] = 255; } }
    const t = S._v || (S._v = document.createElement('canvas')); t.width = N; t.height = N; t.getContext('2d').putImageData(img, 0, 0);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip(); g.globalCompositeOperation = 'lighter'; g.drawImage(t, cx - R, cy - R, 2 * R, 2 * R); g.restore();
    g.strokeStyle = '#333'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke(); g.beginPath(); g.arc(cx, cy, R * .75, 0, 7); g.stroke(); g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    // 75 % colour-bar targets and the skin-tone (I) line
    g.font = '9px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [n, r, gg, bl] of [['R', 1, 0, 0], ['Mg', 1, 0, 1], ['B', 0, 0, 1], ['Cy', 0, 1, 1], ['G', 0, 1, 0], ['Yl', 1, 1, 0]]) { const k = .75; const cb = (-.1146 * r - .3854 * gg + .5 * bl) * k, cr = (.5 * r - .4542 * gg - .0458 * bl) * k; const x = cx + cb * 2 * R, y = cy - cr * 2 * R; g.strokeStyle = '#666'; g.strokeRect(x - 4, y - 4, 8, 8); g.fillStyle = '#888'; g.fillText(n, x, y - 10); }
    const sk = [-.1675, .2163]; const L = Math.hypot(sk[0], sk[1]); g.strokeStyle = 'rgba(255,190,140,.8)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + sk[0] / L * R, cy - sk[1] / L * R); g.stroke(); g.setLineDash([]);
    g.textBaseline = 'alphabetic';
  }
  function histogram(g, x0, y0, W, H) {
    const b = S.buf; const hist = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
    for (let i = 0; i < b.length; i += 4) { hist[0][b[i]]++; hist[1][b[i + 1]]++; hist[2][b[i + 2]]++; }
    let mx = 1; for (const h of hist) for (let i = 1; i < 255; i++) mx = Math.max(mx, h[i]); // clipped ends don't squash the plot
    g.fillStyle = '#0c0c0c'; g.fillRect(x0, y0, W, H); g.strokeStyle = '#2a2a2a'; for (let i = 1; i < 4; i++) { const x = Math.round(x0 + W * i / 4) + .5; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + H); g.stroke(); }
    g.globalCompositeOperation = 'lighter';
    [['rgba(220,70,60,.75)', 0], ['rgba(70,200,90,.75)', 1], ['rgba(70,120,240,.75)', 2]].forEach(([col, k]) => { g.fillStyle = col; g.beginPath(); g.moveTo(x0, y0 + H - 2); for (let i = 0; i < 256; i++) { const v = Math.min(1, hist[k][i] / mx); g.lineTo(x0 + i / 255 * W, y0 + H - 2 - v * (H - 10)); } g.lineTo(x0 + W, y0 + H - 2); g.closePath(); g.fill(); });
    g.globalCompositeOperation = 'source-over'; g.fillStyle = '#777'; g.font = '9px "JetBrains Mono", monospace'; g.textAlign = 'left'; g.fillText('0', x0 + 3, y0 + H - 3); g.textAlign = 'right'; g.fillText('255', x0 + W - 3, y0 + H - 3);
  }
  S.draw = () => {
    const cv = S.cv; if (!cv || !cv.isConnected) return; const r = cv.getBoundingClientRect(); const W = Math.floor(r.width), H = Math.floor(r.height); if (W < 20 || H < 20) return;
    const dpr = devicePixelRatio || 1; if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
    if (!S.buf) { g.fillStyle = '#777'; g.font = '12px "IBM Plex Sans Arabic", sans-serif'; g.textAlign = 'center'; g.fillText(GW.tr ? GW.tr('لا يوجد إطار') : 'لا يوجد إطار', W / 2, H / 2 - 9); g.fillStyle = '#5a5a5a'; g.font = '11px "IBM Plex Sans Arabic", sans-serif'; g.fillText(GW.tr ? GW.tr('حرّك مؤشر التشغيل فوق لقطة لعرض المقاييس') : 'حرّك مؤشر التشغيل فوق لقطة لعرض المقاييس', W / 2, H / 2 + 11); return; }
    const pad = 4, m = S.mode;
    if (m === 'pv') { const sq = Math.min(H - 2 * pad, (W - pad * 3) * .42); waveform(g, pad, pad, W - pad * 3 - sq, H - 2 * pad, true); vectorscope(g, W - pad - sq, pad + (H - 2 * pad - sq) / 2, sq, sq); }
    else if (m === 'all') { const w = (W - pad * 3) / 2, h = (H - pad * 3) / 2; waveform(g, pad, pad, w, h, false); waveform(g, pad * 2 + w, pad, w, h, true); vectorscope(g, pad, pad * 2 + h, w, h); histogram(g, pad * 2 + w, pad * 2 + h, w, h); }
    else if (m === 'wave') waveform(g, pad, pad, W - 2 * pad, H - 2 * pad, false); else if (m === 'parade') waveform(g, pad, pad, W - 2 * pad, H - 2 * pad, true);
    else if (m === 'vector') vectorscope(g, pad, pad, W - 2 * pad, H - 2 * pad); else histogram(g, pad, pad, W - 2 * pad, H - 2 * pad);
  };
})();
