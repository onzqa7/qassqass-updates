'use strict';
/* GeoWar Atlas — documentary map FX pack (original implementations, GeoLayers-style workflows):
   top-view clouds with parallax / fly-through, movement visualisation (trim, dash patterns, comet, travelling
   symbols, arrowheads, multi-arrow army moves, 3D arcs), callout label templates, stylised borders
   (NatGeo dotted, hand-drawn ink, neon, ribbon), GPX/GeoJSON/KML route import with camera follow,
   «مهمة سرية» HUD look, «ورق وقص» paper cut-out look and 3D district extrusion.
   Everything is a pure function of (scene, time, view) → export == preview. */
(function () {
  const A = GW.Atlas; const S = A.Scene, V = A.Vec, G = A.Geo, Cm = A.Cam; const v3 = Cm.v3;
  const FX = A.FX = {};
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rgba = V.rgba, shade = V.shade;
  const lighten = (h, kk, a) => { const c = S.rgb(h).map(x => x + (1 - x) * kk); return `rgba(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0},${a})`; };
  const shadeHex = (h, kk) => '#' + S.rgb(h).map(x => clamp(kk > 0 ? x + (1 - x) * kk : x * (1 + kk), 0, 1)).map(x => (x * 255 | 0).toString(16).padStart(2, '0')).join('');
  const isAr = (s) => /[؀-ۿ]/.test(s || '');

  /* ---------------- deterministic noise ---------------- */
  const hash2 = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  // value noise; P = period (tileable) or 0
  function vn(x, y, s, P) {
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const w = (q) => P ? ((q % P) + P) % P : q; const x0 = w(xi), x1 = w(xi + 1), y0 = w(yi), y1 = w(yi + 1);
    const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  FX.vn = vn;

  /* ---------------- layer registry ---------------- */
  Object.assign(S.LAYERS, {
    clouds: { ar: 'غيوم من الأعلى', icon: 'cloud' },
    move: { ar: 'حركة متقدمة (مسار / جيش)', icon: 'path' },
    callout: { ar: 'تعليق بخط إشارة', icon: 'text' },
    district: { ar: 'مناطق إدارية مرفوعة', icon: 'layers' },
  });
  FX.DEFAULTS = {
    clouds: { cover: .5, scale: 1, opacity: .92, color: '#ffffff', shadow: .45, wind: 30, speed: 1, seed: 1, pass: 9.5, detail: 1, above: 0, lat0: 30, in: 'fade', inDur: 1 },
    move: { pts: [], color: '#e5243b', width: 1, curve: .15, arc: 0, dash: 'solid', march: 0, glow: 1, outline: 1, comet: 0, head: 'classic', taper: .6, tail: 0, sym: '', symN: 1, symSize: 1, loop: 0, multi: 1, spread: 1, stagger: .25, pulses: 0, eles: null, eleLift: 0, profile: 0, in: 'draw', inDur: 3 },
    callout: { lon: 0, lat: 0, text: 'نص التعليق', sub: '', style: 'boxed', dot: 'ring', dir: 'auto', len: 1, elbow: 1, color: '#ffffff', accent: '#e5243b', size: 1, in: 'draw', inDur: 1.6 },
    district: { keys: [], country: '', regions: '', data: '', color: '#d9a441', palette: 'single', c0: '#f3d27a', c1: '#b3261e', lift: 1, fill: .92, labels: 1, stagger: .12, in: 'grow', inDur: 1.6 },
  };
  const newLayer0 = S.newLayer;
  S.newLayer = (type, o = {}) => {
    const L = newLayer0(type, {}); const D = FX.DEFAULTS[type];
    if (D) Object.assign(L, GW.clone(D));
    if (type === 'move' && o.preset === 'route') Object.assign(L, { color: '#ffffff', dash: 'dash', head: 'none', comet: 1, taper: 0, sym: 'plane', glow: 0 });
    if (type === 'move' && o.preset === 'army') Object.assign(L, { multi: 3, head: 'classic', taper: .45, dash: 'solid', comet: 0, width: 1.1 });
    delete o.preset; return Object.assign(L, o);
  };
  FX.TYPES = Object.keys(FX.DEFAULTS);

  /* ---------------- border styles ---------------- */
  FX.BSTYLES = { natgeo: 'ناشيونال جيوغرافيك (نقاط صفراء)', historic: 'تاريخي (حبر مرسوم باليد)', neon: 'نيون متوهج', ribbon: 'شريط مزدوج' };
  FX.BCOL = { natgeo: '#ffcf33', historic: '#3b2412', neon: '#3ef2ff', ribbon: '#f3e6c0' };
  // global border style: an extra look option (sc.look.borderStyle); vtiles.js draws it per tile through FX.tileBorders
  const eff0 = S.eff;
  S.eff = (sc) => { const E = eff0(sc); const bs = sc.look && sc.look.borderStyle; if (FX.BSTYLES[bs]) { E.st.bstyle = bs; if (sc.look.borderC) E.st.bcol = sc.look.borderC; } return E; };

  /* ---------------- styles: «مهمة سرية» and «ورق وقص» ---------------- */
  S.STYLES.mission = { ar: 'مهمة سرية (HUD)', base: 'esri_img', baseTex: 'sat', fx: 'mission', grade: { sat: .05, bri: .5, con: 1.45, gamma: 1.12, tint: [.24, .52, .64], tintAmt: .42, gain: [.82, .97, 1.04] }, oceanTint: '#00141c', tintA: .7, border: 'rgba(80,225,255,.55)', bw: .8, glow: 1, ink: '#c9f6ff', halo: 'rgba(0,12,18,.85)', font: 'Cairo', labelW: 700, atmo: [.1, .55, .75], stars: .25, space: [.0, .015, .02], post: { vig: .6 } };
  S.STYLES.papercut = { ar: 'ورق وقص (مونتاج)', base: 'esri_img', baseTex: 'sat', fx: 'papercut', grade: { sat: .62, bri: .9, con: 1.06, gamma: 1.02, tint: [1, .9, .74], tintAmt: .22 }, oceanTint: '#2a3a44', tintA: .45, border: 'rgba(250,244,228,.38)', bw: .8, ink: '#fbf6ea', halo: 'soft', font: 'thmanyah serif display', labelW: 800, atmo: [.75, .68, .55], stars: 0, space: [.8, .75, .66], space2: [.62, .57, .49], post: { paper: .85, vig: .48, sepia: .12 } };
  for (const k of ['mission', 'papercut']) if (!S.STYLE_ORDER.includes(k)) S.STYLE_ORDER.splice(4, 0, k);

  /* ============================== clouds ============================== */
  const texCache = new Map();
  function cloudTex(seed, cover, color) {
    const key = seed + '|' + cover.toFixed(2) + '|' + color; let e = texCache.get(key); if (e) return e;
    const N = 512, P0 = 4; const d = new Float32Array(N * N); const oct = [[P0, .5], [P0 * 2, .27], [P0 * 4, .14], [P0 * 8, .07], [P0 * 16, .035], [P0 * 32, .018]];
    const sum = oct.reduce((a, o) => a + o[1], 0); const th = .63 - .32 * clamp(cover, 0, 1);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const wx = (vn(u * 8, v * 8, seed + 91, 8) - .5) * .9, wy = (vn(u * 8 + 3.1, v * 8 + 7.7, seed + 92, 8) - .5) * .9; // domain warp → billowy cells
      let n = 0; for (let i = 0; i < oct.length; i++) { const [P, a] = oct[i]; n += a * vn(u * P + wx * (i < 3 ? 1 : .3), v * P + wy * (i < 3 ? 1 : .3), seed * 13 + i, P); }
      n /= sum; n += (vn(u * 2 + wx * .3, v * 2 + wy * .3, seed + 50, 2) - .5) * .26 + (vn(u * 3, v * 3, seed + 51, 3) - .5) * .1; // cloud systems: clustered cover with clear gaps
      d[y * N + x] = sm(th, th + .2, n) * (.75 + .25 * sm(th + .05, th + .32, n));
    }
    const c = S.rgb(color); const cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d'); const im = g.createImageData(N, N); const px = im.data;
    const sh = document.createElement('canvas'); sh.width = sh.height = N; const gs = sh.getContext('2d'); const ims = gs.createImageData(N, N); const ps = ims.data;
    const at = (x, y) => d[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const q = d[y * N + x]; const i = (y * N + x) * 4;
      const lit = clamp((at(x + 3, y + 3) - at(x - 3, y - 3)) * 1.6, -1, 1); // light from the top-left
      const core = sm(.55, 1, q); let b = .9 + .22 * lit - .14 * core * (lit < 0 ? 1 : .4);
      b = clamp(b, .55, 1.08);
      px[i] = clamp(c[0] * 255 * b, 0, 255); px[i + 1] = clamp(c[1] * 255 * b, 0, 255); px[i + 2] = clamp(c[2] * 255 * (b + .02), 0, 255); px[i + 3] = 255 * Math.pow(q, .85);
      ps[i] = 8; ps[i + 1] = 12; ps[i + 2] = 20; ps[i + 3] = 255 * Math.pow(q, .7);
    }
    g.putImageData(im, 0, 0); gs.putImageData(ims, 0, 0);
    const mip = (src) => { const out = [src]; let s = src; for (let n = N / 2; n >= 64; n /= 2) { const m = document.createElement('canvas'); m.width = m.height = n; const mg = m.getContext('2d'); mg.imageSmoothingQuality = 'high'; mg.drawImage(s, 0, 0, n, n); out.push(m); s = m; } return out; };
    // soft blurred shadow (wrap-safe: blur a 3×3 tiling and crop the centre)
    const big = document.createElement('canvas'); big.width = big.height = N; const bg = big.getContext('2d'); bg.filter = 'blur(7px)'; for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) bg.drawImage(sh, a * N, b2 * N); bg.filter = 'none';
    e = { N, cloud: mip(cv), shadow: mip(big) }; texCache.set(key, e); if (texCache.size > 8) texCache.delete(texCache.keys().next().value); return e;
  }
  FX.cloudTex = cloudTex;
  // local affine frame of the map at the camera target: screen px per km east / north
  function localFrame(vw) {
    const lon = vw.lon, lat = vw.lat; const c = vw.project(lon, lat) || [vw.W / 2 + (vw.offX || 0), vw.H / 2 + (vw.offY || 0)]; const dd = Math.max(1e-4, Math.min(.5, 40 / Math.max(1, vw.kpx) * DEG));
    const pe = vw.project(lon + dd / Math.max(.05, Math.cos(lat * RAD)), lat), pn = vw.project(lon, clamp(lat + dd, -89.9, 89.9));
    const km = dd * RAD * 6371; if (!pe || !pn) return null;
    return { c, e: [(pe[0] - c[0]) / km, (pe[1] - c[1]) / km], n: [(pn[0] - c[0]) / km, (pn[1] - c[1]) / km] };
  }
  FX.localFrame = localFrame;
  function drawCloudLayer(ctx, vw, Ly, a, t, kind, fr, clipSphere, fast) {
    const zoom = vw.zoom; const pass = Ly.pass == null ? 9.5 : +Ly.pass; const sc0 = Math.max(.2, +Ly.scale || 1);
    const tex = cloudTex(Ly.seed | 0 || 1, clamp(+Ly.cover, 0, 1), Ly.color || '#ffffff');
    const layers = [{ per: 1400 * sc0, alt: 1, al: 1, sp: 1, ox: 0 }]; if (Ly.detail && !fast) layers.push({ per: 520 * sc0, alt: .72, al: .5, sp: 1.35, ox: 333 });
    const wind = (+Ly.wind || 0) * RAD; const spd = 8 * (Ly.speed == null ? 1 : +Ly.speed);
    const X = vw.lon * RAD * 6371 * Math.cos((Ly.lat0 == null ? 30 : +Ly.lat0) * RAD), Y = vw.lat * RAD * 6371;
    const far = vw.mode === 'globe' ? sm(2.9, 4.1, zoom) : sm(1.2, 2.8, zoom);
    ctx.save(); if (clipSphere) clipSphere(ctx);
    for (const q of layers) {
      const rel = Math.pow(2, zoom - pass) * q.alt; if (rel >= .97) continue;
      const par = kind === 'shadow' ? 1 : 1 / (1 - rel); const near = kind === 'shadow' ? 1 - sm(.4, .95, rel) : 1 - sm(.5, .93, rel);
      const alpha = a * q.al * near * far * (kind === 'shadow' ? clamp(+Ly.shadow, 0, 1) * 1.1 : clamp(Ly.opacity == null ? .92 : +Ly.opacity, 0, 1)); if (alpha < .004) continue;
      const kpt = q.per / tex.N; const ex = fr.e[0] * par, ey = fr.e[1] * par, nx = fr.n[0] * par, ny = fr.n[1] * par;
      const texPx = kpt * Math.hypot(ex, ey); let lvl = 0; while (lvl < tex.cloud.length - 1 && texPx * Math.pow(2, lvl) < .55) lvl++;
      const src = (kind === 'shadow' ? tex.shadow : tex.cloud)[lvl]; const kk = kpt * Math.pow(2, lvl);
      let dx = (spd * q.sp * t * Math.cos(wind)) + q.ox - X, dy = (spd * q.sp * t * Math.sin(wind)) + q.ox * .6 - Y;
      if (kind === 'shadow') { dx += 55 * (Ly.shadowOff == null ? 1 : +Ly.shadowOff) * sc0; dy -= 40 * (Ly.shadowOff == null ? 1 : +Ly.shadowOff) * sc0; }
      dx = ((dx % q.per) + q.per) % q.per; dy = ((dy % q.per) + q.per) % q.per;
      const pat = ctx.createPattern(src, 'repeat'); if (!pat) continue;
      pat.setTransform(new DOMMatrix([ex * kk, ey * kk, -nx * kk, -ny * kk, fr.c[0] + dx * ex + dy * nx, fr.c[1] + dx * ey + dy * ny]));
      ctx.globalAlpha = alpha; ctx.fillStyle = pat;
      const blur = kind === 'cloud' ? clamp((par - 1.6) * 2.2, 0, 14) : 0; ctx.filter = blur > .3 && !fast ? `blur(${(blur * vw.pxScale).toFixed(1)}px)` : 'none';
      ctx.fillRect(0, 0, vw.W, vw.H); ctx.filter = 'none';
    }
    ctx.restore();
  }

  /* ============================== movement ============================== */
  const projH = (vw, P, h) => { // unit vector P lifted by h (earth radii) → screen [x,y] | null
    if (vw.mode !== 'globe') { const ll = v3.toLL(P); const sp = vw.project(ll[0], ll[1]); return sp ? [sp[0], sp[1] - h * vw.kpx] : null; }
    if (!h) { const ll = v3.toLL(P); return vw.project(ll[0], ll[1]); }
    const pp = v3.mul(P, 1 + h); const Cp = vw.C; const d = v3.sub(pp, Cp); const aa = v3.dot(d, d), bb = 2 * v3.dot(Cp, d), cc = v3.dot(Cp, Cp) - 1; const disc = bb * bb - 4 * aa * cc;
    if (disc > 0) { const s1 = (-bb - Math.sqrt(disc)) / (2 * aa); if (s1 > 1e-6 && s1 < 1 - 1e-6) return null; }
    const z = v3.dot(d, vw.a); if (z <= 1e-5) return null; return [vw.W / 2 + (vw.offX || 0) + vw.f * v3.dot(d, vw.r) / z, vw.H / 2 + (vw.offY || 0) - vw.f * v3.dot(d, vw.u) / z];
  };
  FX.projH = projH;
  // dense screen polyline (+ ground twin) for a lon/lat path with curve, 3D arc height and optional elevation lift
  function path3(vw, pts, curve, arc, eles, eleLift) {
    const P = pts.map(p => v3.fromLL(p[0], p[1])); const n0 = P.length; if (n0 < 2) return null;
    let total = 0; const segA = []; for (let i = 1; i < n0; i++) { const a = Math.acos(clamp(v3.dot(P[i - 1], P[i]), -1, 1)); segA.push(a); total += a; }
    const nrm = n0 === 2 ? v3.norm(v3.cross(P[0], P[1])) : null; const dense = n0 > 60 ? 1.2 : 3;
    let eMin = 0, eMax = 1; if (eles && eleLift) { const es = eles.filter(x => x != null); if (es.length) { eMin = Math.min(...es); eMax = Math.max(eMin + 1, ...es); } }
    const up = [], gr = [], fs = []; let acc = 0;
    for (let i = 1; i < n0; i++) {
      const a = P[i - 1], b = P[i]; const ang = segA[i - 1]; const n = Math.max(n0 > 200 ? 1 : 4, Math.ceil(ang * DEG * dense));
      for (let j = (i === 1 ? 0 : 1); j <= n; j++) {
        const f = j / n; const s0 = Math.sin(ang) || 1e-9; let p = ang < 1e-9 ? a : v3.add(v3.mul(a, Math.sin((1 - f) * ang) / s0), v3.mul(b, Math.sin(f * ang) / s0));
        const gfr = (acc + f * ang) / (total || 1);
        if (nrm && curve) p = v3.norm(v3.add(p, v3.mul(nrm, Math.sin(Math.PI * gfr) * curve * total * .5)));
        let h = arc ? Math.sin(Math.PI * gfr) * arc * total * .35 : 0;
        if (eles && eleLift) { const ea = eles[i - 1], eb = eles[i]; if (ea != null && eb != null) h += ((ea + (eb - ea) * f) - eMin) / (eMax - eMin) * .004 * eleLift; }
        up.push(projH(vw, p, h)); gr.push(arc || eleLift ? projH(vw, p, 0) : null); fs.push(gfr);
      }
      acc += ang;
    }
    // longest visible run
    let best = [0, 0], cur = -1; for (let i = 0; i <= up.length; i++) { const ok = i < up.length && up[i]; if (ok && cur < 0) cur = i; if (!ok && cur >= 0) { if (i - cur > best[1] - best[0]) best = [cur, i]; cur = -1; } }
    if (best[1] - best[0] < 2) return null;
    const out = { pts: up.slice(best[0], best[1]), ground: gr.slice(best[0], best[1]), f: fs.slice(best[0], best[1]), lifted: !!(arc || (eles && eleLift)) };
    return out;
  }
  FX.path3 = path3;
  const cumLen = (p) => { const L = [0]; for (let i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return L; };
  // point + unit tangent at arc length s
  function at(P, L, s) {
    const tot = L[L.length - 1]; s = clamp(s, 0, tot); let lo = 0, hi = L.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi]; const seg = Math.max(1e-9, L[hi] - L[lo]); const f = (s - L[lo]) / seg; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return { x: a[0] + dx * f, y: a[1] + dy * f, tx: dx / l, ty: dy / l, i: lo, f };
  }
  FX.at = at;
  // sub-polyline between arc lengths s0..s1
  function subPts(P, L, s0, s1) { const out = []; const a = at(P, L, s0); out.push([a.x, a.y]); for (let i = a.i + 1; i < P.length && L[i] < s1; i++) out.push(P[i]); const b = at(P, L, s1); out.push([b.x, b.y]); return out; }
  function smoothPts(p, it) { for (let k = 0; k < (it || 1); k++) { if (p.length < 3) return p; const q = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } q.push(p[p.length - 1]); p = q; } return p; }
  function offsetPts(p, d) { if (!d) return p; const n = p.length; return p.map((q, i) => { const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [q[0] - dy / l * d, q[1] + dx / l * d]; }); }
  // filled ribbon along P between s0..s1 with width function w(s)
  function ribbon(ctx, P, L, s0, s1, wf) {
    const q = subPts(P, L, s0, s1); if (q.length < 2) return; const Lq = cumLen(q); const n = q.length; const lf = [], rt = [];
    for (let i = 0; i < n; i++) { const a = q[Math.max(0, i - 1)], b = q[Math.min(n - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; const w = wf(s0 + Lq[i]) / 2; lf.push([q[i][0] - dy / l * w, q[i][1] + dx / l * w]); rt.push([q[i][0] + dy / l * w, q[i][1] - dx / l * w]); }
    ctx.beginPath(); ctx.moveTo(lf[0][0], lf[0][1]); for (const p of lf) ctx.lineTo(p[0], p[1]); for (let i = n - 1; i >= 0; i--) ctx.lineTo(rt[i][0], rt[i][1]); ctx.closePath(); ctx.fill();
  }
  const strokePts = (ctx, q) => { ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.stroke(); };
  FX.DASHES = { solid: 'متصل', dash: 'متقطع', dot: 'نقاط', dashdot: 'شرطة ونقطة', rail: 'سكة حديد', feet: 'آثار أقدام', ants: 'نمل زاحف' };
  FX.HEADS = { classic: 'كلاسيكي', chevron: 'شيفرون', notched: 'ذيل السنونو', open: 'مفتوح', none: 'بدون' };
  FX.SYMS = [['', 'بدون'], ['plane', 'طائرة'], ['jet', 'مقاتلة'], ['heli', 'مروحية'], ['missile', 'صاروخ'], ['ship', 'سفينة (من الأعلى)'], ['tank', 'دبابة (من الأعلى)'], ['car', 'سيارة'], ['soldier', 'جندي'], ['lib:tank', 'دبابة (جانبية)'], ['lib:ship', 'سفينة (جانبية)'], ['lib:soldier', 'جندي (جانبي)'], ['dot', 'نقطة مضيئة']];
  const SIDE = { 'lib:tank': 1, 'lib:ship': 1, 'lib:soldier': 1, soldier: 2 };
  const CAR = typeof Path2D !== 'undefined' ? new Path2D('M8.2 3.2c.9-1.2 6.7-1.2 7.6 0 .8 1 1.2 3 1.2 5.3v9.8c0 2.4-.5 3.9-1.4 4.4-1.4.7-5.8.7-7.2 0-.9-.5-1.4-2-1.4-4.4V8.5c0-2.3.4-4.3 1.2-5.3z') : null;
  const CARW = typeof Path2D !== 'undefined' ? new Path2D('M8.6 8.2c1.6-.9 5.2-.9 6.8 0l-.7 3.2c-1.6-.4-3.8-.4-5.4 0zM9 17.6c1.6.5 4.4.5 6 0l.5 2.3c-2 .6-5 .6-7 0z') : null;
  function symbol(ctx, kind, x, y, s, color, tx, ty, t, a) {
    if (kind === 'dot') { const g = ctx.createRadialGradient(x, y, 0, x, y, s * .5); g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(.35, rgba(color, .9 * a)); g.addColorStop(1, rgba(color, 0)); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * .5, 0, 7); ctx.fill(); ctx.restore(); return; }
    if (kind === 'car') { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(ty, tx) + Math.PI / 2); ctx.globalAlpha *= a; const k = s / 24; ctx.scale(k, k); ctx.translate(-12, -12); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6; ctx.fillStyle = color; ctx.fill(CAR); ctx.shadowBlur = 0; ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke(CAR); ctx.fillStyle = 'rgba(20,28,38,.85)'; ctx.fill(CARW); ctx.restore(); return; }
    const side = SIDE[kind];
    if (side) { ctx.save(); ctx.translate(x, y - (side === 1 ? s * .1 : 0) + Math.sin(t * 9) * s * .03); if (tx < 0) ctx.scale(-1, 1); V.icon(ctx, kind.startsWith('lib:') && !GW.ShapeLib ? kind.slice(4) : kind, 0, 0, s, color, 0, t, a); ctx.restore(); return; }
    V.icon(ctx, kind, x, y, s, color, Math.atan2(ty, tx) + Math.PI / 2, t, a);
  }
  FX.symbol = symbol;
  function arrowHead(ctx, kind, x, y, tx, ty, w, color, k, outline, glow) {
    const nx = -ty, ny = tx; const Lh = w * 2.6, Wh = w * 2.3; const bx = x - tx * Lh, by = y - ty * Lh;
    ctx.save(); ctx.lineJoin = 'miter'; ctx.miterLimit = 6;
    const P = new Path2D();
    if (kind === 'notched') { P.moveTo(x + tx * w * .3, y + ty * w * .3); P.lineTo(bx + nx * Wh - tx * w * .5, by + ny * Wh - ty * w * .5); P.lineTo(bx + tx * Lh * .32, by + ty * Lh * .32); P.lineTo(bx - nx * Wh - tx * w * .5, by - ny * Wh - ty * w * .5); P.closePath(); }
    else if (kind === 'chevron' || kind === 'open') { P.moveTo(bx + nx * Wh * .95, by + ny * Wh * .95); P.lineTo(x + tx * w * .2, y + ty * w * .2); P.lineTo(bx - nx * Wh * .95, by - ny * Wh * .95); if (kind === 'open') P.closePath(); }
    else { P.moveTo(x + tx * w * .3, y + ty * w * .3); P.lineTo(bx + nx * Wh, by + ny * Wh); P.lineTo(bx + tx * w * .25, by + ty * w * .25); P.lineTo(bx - nx * Wh, by - ny * Wh); P.closePath(); }
    if (kind === 'chevron' || kind === 'open') {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (outline) { ctx.lineWidth = w * .95 + 3 * k; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke(P); }
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 14 * k; } ctx.lineWidth = w * .95; ctx.strokeStyle = color; ctx.stroke(P);
    } else {
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 16 * k; } ctx.fillStyle = color; ctx.fill(P); ctx.shadowBlur = 0;
      if (outline) { ctx.lineWidth = 1.4 * k; ctx.strokeStyle = shade(color, -.55); ctx.stroke(P); }
    }
    ctx.restore(); return Lh * (kind === 'chevron' || kind === 'open' ? .25 : kind === 'notched' ? .62 : .8);
  }
  FX.arrowHead = arrowHead;
  // one movement line (screen polyline P), progress head (0..1) and tail (0..1)
  function drawMove(g, b, Ly, P, G0, k, lt, s, headF, tailF, a, mission) {
    const L = cumLen(P); const tot = L[L.length - 1]; if (tot < 2) return null;
    const s1 = tot * clamp(headF, 0, 1), s0 = tot * clamp(tailF, 0, s1 / tot); if (s1 - s0 < .5) return null;
    const col = Ly.color || '#e5243b'; const w = 8 * k * (Ly.width || 1); const dash = Ly.dash || 'solid'; const head = Ly.head || 'none';
    const taper = clamp(+Ly.taper || 0, 0, 1); const wf = (x) => w * (1 - taper * (1 - clamp((x - s0) / Math.max(1, s1 - s0), 0, 1)) * .85);
    const hp = at(P, L, s1);
    // ground shadow of a lifted (arc) path
    if (G0 && G0.some(Boolean) && b) { const gq = []; for (let i = 0; i < P.length; i++) { if (L[i] > s1) break; if (L[i] >= s0 && G0[i]) gq.push(G0[i]); } if (gq.length > 1) { b.save(); b.globalAlpha = a * .4; b.lineCap = 'round'; b.lineJoin = 'round'; b.filter = `blur(${(2.5 * k).toFixed(1)}px)`; b.lineWidth = w * .7; b.strokeStyle = 'rgba(0,0,0,.85)'; strokePts(b, gq); b.restore(); } }
    let headCut = 0; if (head !== 'none' && dash !== 'feet') headCut = Math.min((s1 - s0) * .5, w * (head === 'chevron' || head === 'open' ? .5 : 1.9));
    const e1 = s1 - headCut;
    g.save(); g.globalAlpha = a; g.lineCap = 'round'; g.lineJoin = 'round';
    const march = (Ly.march ? +Ly.march : dash === 'ants' ? 1 : 0) * lt * w * 4;
    const pat = { dash: [w * 2.6, w * 1.7], dot: [.01, w * 2.1], dashdot: [w * 2.4, w * 1.2, .01, w * 1.2], ants: [w * 1.8, w * 1.3] }[dash];
    if (dash === 'solid') {
      if (taper > .01) {
        if (Ly.outline) { g.fillStyle = 'rgba(0,0,0,.42)'; ribbon(g, P, L, s0, e1, x => wf(x) + 3 * k); }
        if (Ly.glow) { g.shadowColor = col; g.shadowBlur = 16 * k; }
        const gr = g.createLinearGradient(at(P, L, s0).x, at(P, L, s0).y, hp.x, hp.y); gr.addColorStop(0, rgba(col, taper > .3 ? .35 : .9)); gr.addColorStop(.45, rgba(col, .92)); gr.addColorStop(1, col); g.fillStyle = gr; ribbon(g, P, L, s0, e1, wf); g.shadowBlur = 0;
      } else {
        const q = subPts(P, L, s0, e1); if (Ly.outline) { g.lineWidth = w + 3 * k; g.strokeStyle = 'rgba(0,0,0,.42)'; strokePts(g, q); }
        if (Ly.glow) { g.shadowColor = col; g.shadowBlur = 14 * k; } g.lineWidth = w; g.strokeStyle = col; strokePts(g, q); g.shadowBlur = 0;
      }
    } else if (pat) {
      const chunks = taper > .01 ? 14 : 1; const q0 = subPts(P, L, s0, e1);
      if (dash === 'ants') { g.lineWidth = w * 1.15 + (Ly.outline ? 2 * k : 0); g.strokeStyle = 'rgba(0,0,0,.5)'; strokePts(g, q0); g.lineWidth = w * .55; g.strokeStyle = rgba(col, .35); strokePts(g, q0); }
      g.lineCap = dash === 'dash' || dash === 'ants' ? 'butt' : 'round';
      for (let pass = Ly.outline && dash !== 'ants' ? 0 : 1; pass < 2; pass++) {
        for (let c = 0; c < chunks; c++) {
          const a0 = s0 + (e1 - s0) * c / chunks, a1 = s0 + (e1 - s0) * (c + 1) / chunks; const q = chunks === 1 ? q0 : subPts(P, L, a0, a1); const ww = wf((a0 + a1) / 2) * (dash === 'ants' ? .75 : 1);
          g.setLineDash(pat.map(x => x)); g.lineDashOffset = -(a0 - s0) + march;
          if (pass === 0) { g.lineWidth = ww + 2.6 * k; g.strokeStyle = 'rgba(0,0,0,.45)'; }
          else { g.lineWidth = ww; g.strokeStyle = dash === 'ants' ? '#ffffff' : col; if (Ly.glow) { g.shadowColor = col; g.shadowBlur = 10 * k; } }
          strokePts(g, q); g.shadowBlur = 0;
        }
      }
      g.setLineDash([]);
    } else if (dash === 'rail') {
      const q = subPts(P, L, s0, e1); if (Ly.outline) { g.lineWidth = w * .55 + 3 * k; g.strokeStyle = 'rgba(0,0,0,.45)'; strokePts(g, q); }
      g.lineWidth = w * .5; g.strokeStyle = col; strokePts(g, q);
      const step = w * 1.9; const off = ((march % step) + step) % step; g.lineCap = 'butt';
      for (let x = s0 + off + step * .5; x < e1; x += step) { const p = at(P, L, x); const ww = wf(x) * 1.25; g.beginPath(); g.moveTo(p.x - p.ty * ww, p.y + p.tx * ww); g.lineTo(p.x + p.ty * ww, p.y - p.tx * ww); if (Ly.outline) { g.lineWidth = w * .5 + 2 * k; g.strokeStyle = 'rgba(0,0,0,.4)'; g.stroke(); } g.lineWidth = w * .42; g.strokeStyle = col; g.stroke(); }
    } else if (dash === 'feet') {
      const step = w * 2.1; let i = 0;
      for (let x = s0 + step * .5; x < s1; x += step, i++) {
        const p = at(P, L, x); const sd = i % 2 ? 1 : -1; const age = clamp((s1 - x) / (step * 3), 0, 1); const fa = (.35 + .65 * Math.min(1, age * 2)) * (1 - .55 * clamp((x - s0) / Math.max(1, s1 - s0) < .15 ? 1 - (x - s0) / Math.max(1, (s1 - s0) * .15) : 0, 0, 1));
        const ww = Math.max(wf(x), w * .6) * 1.15; const cx = p.x - p.ty * ww * .55 * sd, cy = p.y + p.tx * ww * .75 * sd; const ang = Math.atan2(p.ty, p.tx);
        g.save(); g.translate(cx, cy); g.rotate(ang); g.globalAlpha = a * fa; g.fillStyle = col; if (Ly.outline) { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 3 * k; }
        g.beginPath(); g.ellipse(ww * .25, 0, ww * .55, ww * .3, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(-ww * .55, 0, ww * .25, ww * .24, 0, 0, 7); g.fill(); g.restore();
      }
    }
    // travelling light pulses (mission / energy look)
    if (Ly.pulses || mission) { const n = Math.max(1, (Ly.pulses | 0) || 3); g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < n; i++) { const u = ((lt * .35 + i / n) % 1); const x = s0 + (e1 - s0) * u; const p = at(P, L, x); const r = w * 2.2; const gg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); gg.addColorStop(0, 'rgba(255,255,255,.95)'); gg.addColorStop(.3, rgba(col, .8)); gg.addColorStop(1, rgba(col, 0)); g.fillStyle = gg; g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill(); } g.restore(); }
    // comet: hot gradient trail + glowing head
    if (Ly.comet) {
      const cl = Math.min((s1 - s0) * .45, 220 * k); g.save(); g.globalCompositeOperation = 'lighter'; const n = 10;
      for (let i = 0; i < n; i++) { const a0 = s1 - cl * (1 - i / n), a1 = s1 - cl * (1 - (i + 1) / n); if (a1 <= s0) continue; g.globalAlpha = a * Math.pow((i + 1) / n, 1.6) * .55; g.fillStyle = col; ribbon(g, P, L, Math.max(s0, a0), a1, () => w * (.6 + 1.4 * (i + 1) / n)); }
      const r = w * 3.2 * (1 + .08 * Math.sin(lt * 13)); const gg = g.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, r); gg.addColorStop(0, 'rgba(255,255,255,1)'); gg.addColorStop(.25, lighten(col, .55, 1)); gg.addColorStop(.5, rgba(col, .55)); gg.addColorStop(1, rgba(col, 0));
      g.globalAlpha = a; g.fillStyle = gg; g.beginPath(); g.arc(hp.x, hp.y, r, 0, 7); g.fill(); g.restore();
    }
    if (head !== 'none' && dash !== 'feet') arrowHead(g, head, hp.x, hp.y, hp.tx, hp.ty, w * (taper > .01 ? 1 : 1) , col, k, Ly.outline, Ly.glow);
    g.restore();
    return { P, L, s0, s1, hp, tot };
  }

  /* ============================== borders ============================== */
  // multi-octave wobble anchored to geography: each octave fades in when its wavelength is ~40 px on screen
  function wobbleGeom(geom, pxPerDeg, seed, ampPx) {
    const amp = ampPx / pxPerDeg; const oct = [.5, 2, 8, 32, 128].map(fq => { const wl = pxPerDeg / fq; const x = Math.log2(Math.max(1e-6, wl) / 40); return [fq, Math.exp(-x * x / 1.4)]; }).filter(o => o[1] > .03);
    const wsum = oct.reduce((s, o) => s + o[1], 0) || 1; const step = 5 / pxPerDeg;
    const mv = (p) => { let dx = 0, dy = 0; for (const [fq, w] of oct) { dx += w * (vn(p[0] * fq, p[1] * fq, seed) - .5); dy += w * (vn(p[0] * fq + 17.3, p[1] * fq - 9.1, seed + 7) - .5); } return [p[0] + dx / wsum * 2 * amp, p[1] + dy / wsum * 2 * amp]; };
    const ring = (r) => { const out = []; for (let i = 0; i < r.length; i++) { const a = r[i]; out.push(mv(a)); if (i < r.length - 1) { const b = r[i + 1]; const n = Math.min(40, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let j = 1; j < n; j++) out.push(mv([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n])); } } return out; };
    const g = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    return { type: 'MultiPolygon', coordinates: g.map(pc => pc.map(ring)) };
  }
  // stroke styles on an arbitrary path builder (fn(ctx) builds the path); k = px scale
  function styledStroke(ctx, style, build, col, lw, k, W, H, scratch) {
    ctx.save(); ctx.lineJoin = 'round';
    if (style === 'natgeo') {
      ctx.beginPath(); build(ctx); ctx.lineCap = 'round';
      ctx.lineWidth = lw * 4.2; ctx.strokeStyle = rgba(col, .1); ctx.stroke(); ctx.lineWidth = lw * 2.6; ctx.strokeStyle = rgba(col, .16); ctx.stroke(); // soft glow (no blur filter: cheap per tile)
      ctx.lineWidth = lw * .4; ctx.strokeStyle = rgba(col, .3); ctx.stroke();
      ctx.setLineDash([.01, lw * 3.4]); ctx.lineWidth = lw * 1.6; ctx.strokeStyle = col; ctx.stroke(); ctx.setLineDash([]);
    } else if (style === 'neon') {
      ctx.beginPath(); build(ctx); ctx.shadowColor = col; ctx.shadowBlur = 18 * k; ctx.lineWidth = lw * 2.2; ctx.strokeStyle = rgba(col, .55); ctx.stroke(); ctx.shadowBlur = 8 * k; ctx.lineWidth = lw * 1.2; ctx.strokeStyle = col; ctx.stroke(); ctx.shadowBlur = 0; ctx.lineWidth = lw * .45; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
    } else if (style === 'ribbon') { // double line: light rails around a dark core (no offscreen compositing → deterministic)
      ctx.beginPath(); build(ctx); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 3 * k; ctx.lineWidth = lw * 5.4; ctx.strokeStyle = col; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.lineWidth = lw * 3.1; ctx.strokeStyle = 'rgba(12,14,18,.82)'; ctx.stroke(); ctx.lineWidth = lw * 1.1; ctx.strokeStyle = rgba(col, .4); ctx.stroke();
    } else if (style === 'historic') { // ink: build() is called twice with different wobble seeds (sketchy double stroke)
      ctx.lineCap = 'round'; ctx.beginPath(); build(ctx, 0); ctx.lineWidth = lw * 1.25; ctx.strokeStyle = rgba(col, .88); ctx.stroke();
      ctx.beginPath(); build(ctx, 1); ctx.lineWidth = lw * .55; ctx.strokeStyle = rgba(col, .5); ctx.stroke();
    }
    ctx.restore();
  }
  FX.styledStroke = styledStroke;
  let scr = null; const scratch = (W, H) => { if (!scr) { scr = document.createElement('canvas'); scr.getContext('2d', { willReadFrequently: true }); } if (scr.width !== W || scr.height !== H) { scr.width = W; scr.height = H; } return scr; };
  // context wrapper: subdivides and displaces in global texel space (seamless between tiles)
  function wobbleCtx(g, ox, oy, amp, seed) {
    let lx = 0, ly = 0, first = null; const d = (x, y) => { const gx = x + ox, gy = y + oy; return [x + (vn(gx / 38, gy / 38, seed) - .5) * 2 * amp + (vn(gx / 9, gy / 9, seed + 3) - .5) * .5 * amp, y + (vn(gx / 38 + 11, gy / 38 - 5, seed + 1) - .5) * 2 * amp + (vn(gx / 9 - 3, gy / 9 + 8, seed + 4) - .5) * .5 * amp]; };
    const seg = (x, y) => { const n = Math.min(60, Math.ceil(Math.hypot(x - lx, y - ly) / 5)); for (let j = 1; j <= n; j++) { const p = d(lx + (x - lx) * j / n, ly + (y - ly) * j / n); g.lineTo(p[0], p[1]); } lx = x; ly = y; };
    return { moveTo(x, y) { const p = d(x, y); g.moveTo(p[0], p[1]); lx = x; ly = y; first = [x, y]; }, lineTo(x, y) { seg(x, y); }, closePath() { if (first) seg(first[0], first[1]); g.closePath(); }, arc(x, y, r) { g.moveTo(x + r, y); g.arc(x, y, r, 0, 7); }, rect(x, y, w, h) { g.rect(x, y, w, h); } };
  }
  // vtiles.js: global border styles drawn once per tile
  FX.tileBorders = (g, proj, feats, L, k, info) => {
    const st = L.bstyle; const col = L.bcol || FX.BCOL[st] || '#ffffff'; const lw = L.bw * k * (st === 'historic' ? 1.1 : 1); const SZ = info.SZ;
    g.save(); if (info.era && info.era.src !== 'modern' && info.land) { g.beginPath(); d3.geoPath(proj, g)(info.land); g.clip(); }
    const build = (ctx, alt) => { const c = st === 'historic' ? wobbleCtx(ctx, info.x * SZ, info.y * SZ, 1.6 * k, 5 + (alt || 0) * 31) : ctx; const p = d3.geoPath(proj, c); for (const f of feats) p(f); };
    styledStroke(g, st, build, col, lw, k, SZ, SZ, (w, h) => { let c = FX._tileScr; if (!c) { c = FX._tileScr = document.createElement('canvas'); c.getContext('2d', { willReadFrequently: true }); } if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return c; });
    g.restore();
  };

  /* ============================== labels / callouts ============================== */
  const measure = (ctx, s, px, fam, w) => { ctx.font = V.font(px, w, fam); return ctx.measureText(s).width; };
  const fmtLL = (lon, lat) => { const f = (v, p, n) => { const ts = Math.round(Math.abs(v) * 36000); const d = Math.floor(ts / 36000), m = Math.floor(ts % 36000 / 600), s2 = (ts % 600) / 10; return `${d}°${String(m).padStart(2, '0')}'${s2.toFixed(1).padStart(4, '0')}"${v >= 0 ? p : n}`; }; return f(lat, 'N', 'S') + '  ' + f(lon, 'E', 'W'); };
  FX.fmtLL = fmtLL;
  FX.CSTYLES = { minimal: 'بسيط (خط رفيع)', boxed: 'صندوق', pill: 'كبسولة', doc: 'وثائقي (خط نسخي)', mission: 'مهمة (HUD)' };
  FX.DOTS = { ring: 'نقطة بحلقات نابضة', square: 'مربع', star: 'نجمة (عاصمة)', dot: 'نقطة', target: 'هدف', none: 'بدون' };
  function cityDot(g, kind, x, y, k, col, acc, lt, a, sz) {
    const r = 5 * k * sz; g.save(); g.globalAlpha *= a;
    if (kind === 'ring') { for (let i = 0; i < 2; i++) { const ph = (lt * .7 + i * .5) % 1; g.globalAlpha = a * (1 - ph) * .85; g.strokeStyle = acc; g.lineWidth = 1.8 * k; g.beginPath(); g.arc(x, y, r * (1.2 + ph * 3.2), 0, 7); g.stroke(); } g.globalAlpha = a; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4 * k; g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.shadowBlur = 0; g.fillStyle = acc; g.beginPath(); g.arc(x, y, r * .5, 0, 7); g.fill(); }
    else if (kind === 'square') { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4 * k; g.fillStyle = '#fff'; g.fillRect(x - r, y - r, r * 2, r * 2); g.shadowBlur = 0; g.lineWidth = 1.6 * k; g.strokeStyle = '#111'; g.strokeRect(x - r, y - r, r * 2, r * 2); g.fillStyle = acc; g.fillRect(x - r * .45, y - r * .45, r * .9, r * .9); }
    else if (kind === 'star') { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 5 * k; g.beginPath(); for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + i * Math.PI / 5; const rr = (i % 2 ? .45 : 1) * r * 1.7; g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); } g.closePath(); g.fillStyle = acc; g.fill(); g.shadowBlur = 0; g.lineWidth = 1.4 * k; g.strokeStyle = '#fff'; g.stroke(); g.beginPath(); g.arc(x, y, r * 2.5, 0, 7); g.lineWidth = 1.2 * k; g.strokeStyle = rgba('#ffffff', .7); g.stroke(); }
    else if (kind === 'target') { const rot = lt * .8; g.strokeStyle = acc; g.lineWidth = 1.6 * k; g.beginPath(); g.arc(x, y, r * 2.2, 0, 7); g.stroke(); for (let i = 0; i < 4; i++) { const an = rot + i * Math.PI / 2; g.beginPath(); g.moveTo(x + Math.cos(an) * r * 1.2, y + Math.sin(an) * r * 1.2); g.lineTo(x + Math.cos(an) * r * 3.2, y + Math.sin(an) * r * 3.2); g.stroke(); } g.fillStyle = acc; g.beginPath(); g.arc(x, y, r * .45, 0, 7); g.fill(); }
    else if (kind === 'dot') { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4 * k; g.fillStyle = col; g.beginPath(); g.arc(x, y, r * .8, 0, 7); g.fill(); g.shadowBlur = 0; g.lineWidth = 1.5 * k; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke(); }
    g.restore();
  }
  FX.cityDot = cityDot;
  const DIRS = { ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1], e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] };
  const hits = (r, list) => list.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
  function drawCallout(g, Ly, sp, s, k, W, H, fam0, taken, mission) {
    const style = Ly.style || 'boxed'; const sz = Ly.size || 1; const lt = s.lt; const pin = s.pin; const a = s.a;
    const fam = style === 'doc' ? 'Amiri' : style === 'mission' ? (isAr(Ly.text) ? 'Cairo' : 'Barlow Condensed') : fam0;
    const px = (style === 'doc' ? 30 : style === 'mission' ? 22 : 23) * k * sz, px2 = (style === 'mission' ? 13 : 15) * k * sz;
    const sub = Ly.sub || (style === 'mission' ? fmtLL(Ly.lon, Ly.lat) : '');
    const wt = style === 'doc' ? 700 : style === 'minimal' ? 800 : 800;
    const sp0 = isAr(Ly.text) ? 0 : (style === 'mission' ? .08 : .02); const tw = measure(g, Ly.text || '', px, fam, wt) + sp0 * px * Array.from(Ly.text || '').length + (style === 'mission' ? px * .7 : 0), sw = sub ? measure(g, sub, px2, style === 'mission' ? 'Barlow Condensed' : fam, 600) : 0;
    const padX = style === 'minimal' || style === 'doc' ? 4 * k : style === 'pill' ? px * .8 : px * .6; const bw = Math.max(tw, sw) + padX * 2; const bh = px * (style === 'pill' ? 1.6 : 1.45) + (sub ? px2 * 1.45 : 0) + (style === 'boxed' || style === 'mission' ? 6 * k : 0);
    const len = 70 * k * (Ly.len || 1), el = 30 * k * (Ly.elbow == null ? 1 : Ly.elbow);
    const geom = (d) => { const [dx, dy] = DIRS[d]; const diag = dx && dy ? .72 : 1; const p1 = [sp[0] + dx * len * diag, sp[1] + dy * len * diag]; let p2, box;
      if (dx) { p2 = [p1[0] + dx * el, p1[1]]; box = [dx > 0 ? p2[0] : p2[0] - bw, p2[1] - bh / 2, dx > 0 ? p2[0] + bw : p2[0], p2[1] + bh / 2]; }
      else { p2 = p1; box = [p1[0] - bw / 2, dy < 0 ? p1[1] - bh : p1[1], p1[0] + bw / 2, dy < 0 ? p1[1] : p1[1] + bh]; }
      return { d, dx, dy, p1, p2, box }; };
    const order = Ly.dir && Ly.dir !== 'auto' ? [Ly.dir] : ['ne', 'nw', 'se', 'sw', 'e', 'w', 'n', 's'];
    let G0 = null; for (const d of order) { const q = geom(d); const r = q.box; const m = 8 * k; if (r[0] < m || r[1] < m || r[2] > W - m || r[3] > H - m) continue; if (hits(r, taken)) continue; G0 = q; break; }
    if (!G0) G0 = geom(order[0]); taken.push(G0.box.slice());
    const acc = Ly.accent || '#e5243b'; const ink = Ly.color || '#ffffff';
    const lineCol = style === 'pill' ? acc : style === 'mission' ? '#5ff2ff' : style === 'doc' ? '#f3ead2' : ink;
    const dotP = sm(0, .22, pin), lineP = clamp((pin - .1) / .38, 0, 1), boxP = S.easeOut(clamp((pin - .42) / .22, 0, 1)), typeP = clamp((pin - .5) / .45, 0, 1);
    g.save(); g.globalAlpha = a;
    // leader line (draws on)
    const pts = [sp, G0.p1, G0.p2]; const Lp = cumLen(pts); const sEnd = Lp[2] * S.ease(lineP);
    if (sEnd > .5) { const q = subPts(pts, Lp, style === 'doc' ? 7 * k : 0, sEnd); g.lineCap = 'round'; g.lineJoin = 'round'; g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 4 * k; g.lineWidth = (style === 'doc' ? 1.1 : style === 'minimal' ? 1.6 : 2) * k * Math.sqrt(sz); g.strokeStyle = lineCol; if (style === 'mission') g.setLineDash([6 * k, 3 * k]); strokePts(g, q); g.setLineDash([]); g.shadowBlur = 0;
      if (style === 'mission' && lineP >= 1) { g.fillStyle = lineCol; g.fillRect(G0.p2[0] - 2.5 * k, G0.p2[1] - 2.5 * k, 5 * k, 5 * k); } }
    // point marker
    const dotKind = Ly.dot || 'ring'; if (dotP > 0) cityDot(g, dotKind, sp[0], sp[1], k, ink, style === 'mission' ? '#ff3b30' : acc, lt, 1, (style === 'doc' ? .85 : 1) * Math.max(.01, S.back(dotP)));
    // box + text
    if (boxP > 0) {
      const [x0, y0, x1, y1] = G0.box; const wv = (x1 - x0) * boxP; const bx0 = G0.dx < 0 ? x1 - wv : G0.dx > 0 ? x0 : (x0 + x1) / 2 - wv / 2;
      g.save(); g.beginPath(); g.rect(bx0 - 4 * k, y0 - 6 * k, wv + 8 * k, y1 - y0 + 12 * k); g.clip();
      if (style === 'boxed') { g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 14 * k; g.fillStyle = 'rgba(9,12,18,.84)'; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.shadowBlur = 0; g.fillStyle = acc; if (G0.dx < 0) g.fillRect(x1 - 4 * k, y0, 4 * k, y1 - y0); else g.fillRect(x0, y0, 4 * k, y1 - y0); }
      else if (style === 'pill') { g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 12 * k; g.beginPath(); if (g.roundRect) g.roundRect(x0, y0, x1 - x0, y1 - y0, (y1 - y0) / 2); else g.rect(x0, y0, x1 - x0, y1 - y0); g.fillStyle = acc; g.fill(); g.shadowBlur = 0; }
      else if (style === 'mission') { g.fillStyle = 'rgba(0,18,24,.62)'; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.strokeStyle = '#5ff2ff'; g.lineWidth = 1.5 * k; const c = 9 * k; g.beginPath(); for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) { g.moveTo(cx + sx * c, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + sy * c); } g.stroke(); }
      else if (style === 'doc') { g.strokeStyle = rgba('#f3ead2', .7); g.lineWidth = 1 * k; g.beginPath(); const yy = y0 + px * 1.42; g.moveTo(G0.dx < 0 ? x1 : x0, yy); g.lineTo(G0.dx < 0 ? x1 - (x1 - x0) * .6 : x0 + (x1 - x0) * .6, yy); if (sub) g.stroke(); }
      const ar = isAr(Ly.text); const chars = Array.from(Ly.text || ''); const nShow = Math.ceil(chars.length * typeP); const shown = chars.slice(0, nShow).join('');
      const align = G0.dx < 0 ? 'right' : G0.dx > 0 ? 'left' : 'center'; const tx = align === 'right' ? x1 - padX : align === 'left' ? x0 + padX : (x0 + x1) / 2;
      const ty = y0 + (style === 'pill' ? (y1 - y0) / 2 - (sub ? px2 * .7 : 0) : px * .78 + (style === 'boxed' || style === 'mission' ? 3 * k : 0));
      const tcol = style === 'pill' ? '#ffffff' : style === 'mission' ? '#bff8ff' : style === 'doc' ? '#f6eedb' : ink;
      const halo = style === 'minimal' || style === 'doc' ? 'soft' : null;
      if (shown) V.haloText(g, shown, tx, ty, px, tcol, halo, fam, wt, align, sp0);
      if (style === 'mission' && (typeP < 1 || Math.floor(lt * 2.5) % 2 === 0)) { const cw = measure(g, shown, px, fam, wt) + sp0 * px * Array.from(shown).length; const cx = align === 'right' ? (ar ? tx - cw - 6 * k : tx + 4 * k) : align === 'left' ? (ar ? tx - 4 * k - px * .5 : tx + cw + 4 * k) : tx + cw / 2 + 3 * k; g.fillStyle = '#5ff2ff'; g.fillRect(cx, ty - px * .45, px * .45, px * .9); }
      if (sub && typeP > .4) { g.globalAlpha = a * sm(.4, .8, typeP); V.haloText(g, sub, tx, ty + px * .62 + px2 * .78, px2, style === 'pill' ? 'rgba(255,255,255,.88)' : style === 'mission' ? '#7fe9f5' : style === 'doc' ? '#e3d7bb' : '#cfd8e3', halo, style === 'mission' ? 'Barlow Condensed' : fam, 600, align, isAr(sub) ? 0 : .04); }
      g.restore();
    }
    g.restore();
  }
  FX.drawCallout = drawCallout;

  /* ============================== districts (admin-1 extrusion) ============================== */
  function districtFeats(Ly, feats, era) {
    const sig = (Ly.keys || []).join(',') + '|' + (Ly.country || '') + '|' + (Ly.regions || '') + '|' + (G.admin1 ? G.admin1.length : 0);
    if (Ly._dfSig === sig && Ly._df) return Ly._df; const out = []; const seen = new Set(); const add = (f) => { if (f && !seen.has(f.key)) { seen.add(f.key); out.push(f); } };
    const byK = new Map((feats || []).map(f => [f.key, f])); const a1 = G.admin1 || [];
    if (Ly.country) { for (const nm of String(Ly.country).split(/[,،]/).map(x => x.trim()).filter(Boolean)) { const r = G.search(nm, feats || [], 'ar', era, 5).find(x => x.kind === 'country'); const cc = r ? r.key : nm.toUpperCase(); for (const f of a1) if (f.properties.cc === cc) add(f); } }
    for (const k of Ly.keys || []) { if (String(k).startsWith('P:')) add(a1.find(f => f.key === k)); else if (byK.has(k)) add(byK.get(k)); }
    if (Ly.regions) for (const nm of String(Ly.regions).split(/[,،\n]/).map(x => x.trim()).filter(Boolean)) { const n = G.norm ? G.norm(nm) : nm; const f = a1.find(f => (G.norm ? G.norm(f.ar) : f.ar) === n || (G.norm ? G.norm(f.en) : f.en.toLowerCase()) === n) || (G.search(nm, [], 'ar', era, 3).find(x => x.kind === 'province') || {}).f; add(f); }
    Object.defineProperty(Ly, '_df', { value: out, writable: true, configurable: true, enumerable: false }); Object.defineProperty(Ly, '_dfSig', { value: sig, writable: true, configurable: true, enumerable: false });
    return out;
  }
  FX.districtFeats = districtFeats;
  function drawDistricts(b, g, Ly, s, vw, k, late, fam, st, opts, feats, era) {
    const fs = districtFeats(Ly, feats, era); if (!fs.length) return;
    const nad = vw.mode === 'globe' ? v3.toLL(vw.C) : null; const vis = fs.filter(f => !nad || d3.geoDistance(f.lab, nad) < vw.horizon + f.rad);
    const data = new Map(); if (Ly.data) for (const [nm, val] of V.parseData(Ly.data)) { const n = G.norm ? G.norm(nm) : nm; const f = fs.find(f => (G.norm ? G.norm(f.ar) : f.ar) === n || (G.norm ? G.norm(f.en) : f.en) === n); if (f) data.set(f.key, val); }
    const vals = [...data.values()]; const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
    const pal = S.PAL.doc;
    const items = vis.map(f => { const sp = vw.project(f.lab[0], f.lab[1]); return sp ? { f, sp, i: fs.indexOf(f) } : null; }).filter(Boolean).sort((p, q) => p.sp[1] - q.sp[1]);
    const tiltW = sm(10, 35, vw.tilt || 0);
    for (const it of items) {
      const { f, sp } = it; const rise = S.easeOut(clamp((s.lt - it.i * (Ly.stagger || 0)) / Math.max(.05, Ly.inDur || 1.4), 0, 1)) ; if (rise <= 0 && Ly.in !== 'none') continue;
      const v = data.has(f.key) ? (data.get(f.key) - lo) / Math.max(1e-9, hi - lo) : null;
      const hpx = 16 * k * (Ly.lift == null ? 1 : +Ly.lift) * (v != null ? .25 + 1.75 * v : 1) * (Ly.in === 'none' ? 1 : rise);
      let dir = [0, -1]; if (vw.mode === 'globe' && tiltW > 0) { const P = v3.fromLL(f.lab[0], f.lab[1]); const q = projH(vw, P, .01); if (q) { const dx = q[0] - sp[0], dy = q[1] - sp[1], l = Math.hypot(dx, dy); if (l > 1e-3) dir = [dir[0] * (1 - tiltW) + dx / l * tiltW, dir[1] * (1 - tiltW) + dy / l * tiltW]; } }
      const col = v != null ? V.lerpCol(Ly.c0 || '#f3d27a', Ly.c1 || '#b3261e', v) : Ly.palette === 'multi' ? pal[it.i % pal.length] : (it.i % 2 ? shade(Ly.color, .08) : Ly.color);
      const path = new Path2D(); d3.geoPath(vw.proj, path)(f);
      b.save(); b.globalAlpha = s.a;
      for (let q = 1; q <= 3; q++) { b.save(); b.translate(hpx * .2 * q, hpx * .16 * q); b.fillStyle = 'rgba(0,0,0,.13)'; b.fill(path); b.restore(); } // soft stepped ground shadow
      const n = Math.max(1, Math.min(opts.fast ? 6 : 26, Math.ceil(hpx / 1.3)));
      for (let i = 0; i < n; i++) { const f2 = i / n; b.save(); b.translate(dir[0] * hpx * f2, dir[1] * hpx * f2); b.fillStyle = shade(col, -.42 + .2 * f2); b.fill(path); b.restore(); }
      b.save(); b.translate(dir[0] * hpx, dir[1] * hpx); b.globalAlpha = s.a * (Ly.fill == null ? .92 : Ly.fill); b.fillStyle = col; b.fill(path); b.globalAlpha = s.a;
      const gr = b.createLinearGradient(sp[0], sp[1] - 60 * k, sp[0], sp[1] + 60 * k); gr.addColorStop(0, 'rgba(255,255,255,.16)'); gr.addColorStop(1, 'rgba(0,0,0,.12)'); b.fillStyle = gr; b.fill(path);
      b.lineJoin = 'round'; b.lineWidth = 1.1 * k; b.strokeStyle = shade(col, .45); b.stroke(path); b.restore();
      b.restore();
      if (Ly.labels && rise > .6) { const rpx = f.rad * vw.kpx; const px = clamp(Math.sqrt(rpx) * 1.5, 10, 24) * k; if (rpx > 28 * k) late.push(() => { g.save(); g.globalAlpha = s.a * sm(.6, 1, rise); const nm = sc_lang() === 'en' ? f.en : (f.ar || f.en); V.haloText(g, nm.replace(/^(منطقة|محافظة|ولاية)\s+/, ''), sp[0] + dir[0] * hpx, sp[1] + dir[1] * hpx - (v != null && Ly.values !== 0 ? px * .55 : 0), px, '#ffffff', 'rgba(0,0,0,.72)', fam, 800); if (v != null && Ly.values !== 0) V.haloText(g, data.get(f.key).toLocaleString('en'), sp[0] + dir[0] * hpx, sp[1] + dir[1] * hpx + px * .62, px * .8, '#fff5d6', 'rgba(0,0,0,.72)', 'Barlow Condensed', 700); g.restore(); }); }
    }
  }
  let curLang = 'ar'; const sc_lang = () => curLang;

  /* ============================== HUD ============================== */
  let scanPat = null;
  function drawHud(g, vw, t, k, W, H, sc) {
    const cy = '#5ff2ff', red = '#ff3b30'; g.save();
    // grid
    g.strokeStyle = 'rgba(95,242,255,.07)'; g.lineWidth = 1; const step = 90 * k; const ox = (W / 2) % step, oy = (H / 2) % step;
    g.beginPath(); for (let x = ox; x < W; x += step) { g.moveTo(x, 0); g.lineTo(x, H); } for (let y = oy; y < H; y += step) { g.moveTo(0, y); g.lineTo(W, y); } g.stroke();
    g.strokeStyle = 'rgba(95,242,255,.35)'; g.beginPath(); for (let x = ox; x < W; x += step / 5) { const L = (Math.round((x - ox) / (step / 5)) % 5 === 0 ? 10 : 4) * k; g.moveTo(x, 0); g.lineTo(x, L); g.moveTo(x, H); g.lineTo(x, H - L); } for (let y = oy; y < H; y += step / 5) { const L = (Math.round((y - oy) / (step / 5)) % 5 === 0 ? 10 : 4) * k; g.moveTo(0, y); g.lineTo(L, y); g.moveTo(W, y); g.lineTo(W - L, y); } g.stroke();
    // scanlines + slow sweep band
    if (!scanPat) { const c = document.createElement('canvas'); c.width = 1; c.height = 3; const q = c.getContext('2d'); q.fillStyle = 'rgba(0,0,0,.55)'; q.fillRect(0, 0, 1, 1); scanPat = c; }
    g.globalAlpha = .16; g.fillStyle = g.createPattern(scanPat, 'repeat'); g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    const by = ((t * .18) % 1.2 - .1) * H; const bg = g.createLinearGradient(0, by - 60 * k, 0, by + 60 * k); bg.addColorStop(0, 'rgba(95,242,255,0)'); bg.addColorStop(.5, 'rgba(95,242,255,.07)'); bg.addColorStop(1, 'rgba(95,242,255,0)'); g.fillStyle = bg; g.fillRect(0, by - 60 * k, W, 120 * k);
    // frame brackets
    const m = 26 * k, c = 46 * k; g.strokeStyle = cy; g.lineWidth = 2 * k; g.beginPath(); for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { g.moveTo(x + sx * c, y); g.lineTo(x, y); g.lineTo(x, y + sy * c); } g.stroke();
    // reticle at the camera target
    const cx = W / 2 + (vw.offX || 0), cyy = H / 2 + (vw.offY || 0); const blink = Math.floor(t * 2) % 2 === 0; const r = 30 * k;
    g.strokeStyle = blink ? red : rgba(red, .45); g.lineWidth = 1.6 * k; g.beginPath(); g.arc(cx, cyy, r, 0, 7); g.stroke();
    g.save(); g.translate(cx, cyy); g.rotate(t * .5); g.beginPath(); for (let i = 0; i < 4; i++) { const a0 = i * Math.PI / 2 + .25; g.moveTo(Math.cos(a0) * r * 1.45, Math.sin(a0) * r * 1.45); g.arc(0, 0, r * 1.45, a0, a0 + .9); } g.strokeStyle = rgba(cy, .8); g.stroke(); g.restore();
    g.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(cx + dx * r * .45, cyy + dy * r * .45); g.lineTo(cx + dx * r * 1.15, cyy + dy * r * 1.15); } g.strokeStyle = blink ? red : rgba(red, .6); g.stroke();
    g.fillStyle = red; g.beginPath(); g.arc(cx, cyy, 2.5 * k, 0, 7); g.fill();
    // readouts
    const alt = Cm.altitudeKm ? Cm.altitudeKm(vw.zoom, vw.lat, vw.fov || undefined) : 0; const f1 = 21 * k;
    g.font = V.font(f1, 700, 'Barlow Condensed'); g.direction = 'ltr'; g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = cy; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 4 * k;
    g.fillText('TARGET  ' + fmtLL(vw.lon, vw.lat), m + 14 * k, H - m - 42 * k); g.fillText('ALT ' + Math.round(alt).toLocaleString('en') + ' KM   HDG ' + String(Math.round(((vw.heading || 0) % 360 + 360) % 360)).padStart(3, '0') + '°   TILT ' + Math.round(vw.tilt || 0) + '°', m + 14 * k, H - m - 14 * k);
    const tc = (x) => String(Math.floor(x)).padStart(2, '0'); const fr = Math.floor((t % 1) * 30);
    g.textAlign = 'right'; g.fillText('T+ ' + tc(t / 3600) + ':' + tc(t / 60 % 60) + ':' + tc(t % 60) + ':' + tc(fr), W - m - 14 * k, H - m - 14 * k);
    if (blink) { g.fillStyle = red; g.beginPath(); g.arc(W - m - 70 * k, m + 22 * k, 5 * k, 0, 7); g.fill(); } g.fillStyle = red; g.fillText('REC', W - m - 14 * k, m + 28 * k);
    g.textAlign = 'left'; g.fillStyle = cy; g.fillText((sc.look.lang === 'en' ? 'CLASSIFIED // EYES ONLY' : 'سري للغاية'), m + 14 * k, m + 28 * k);
    g.restore();
  }
  FX.drawHud = drawHud;

  /* ============================== frame hook ============================== */
  const needsProxy = (L) => L && L.type === 'country' && (FX.BSTYLES[L.outline] || L.cut);
  const draw0 = V.draw;
  V.draw = function (cvB, cvT, vw, sc, t, cd, E, era, feats, lod, opts) {
    const ls = (sc && sc.layers) || []; let sc2 = sc;
    if (ls.some(needsProxy)) sc2 = Object.assign({}, sc, { layers: ls.map(L => needsProxy(L) ? Object.create(L, { outline: { value: FX.BSTYLES[L.outline] ? 'none' : L.outline, enumerable: true }, inner: { value: L.cut ? 0 : L.inner, enumerable: true } }) : L) });
    FX._cur = { sc }; try { return draw0.call(this, cvB, cvT, vw, sc2, t, cd, E, era, feats, lod, opts); } finally { FX._cur = null; }
  };
  // called once per frame (vector.js 'mid' hook)
  FX.hook = (o) => {
    const { b, g, vw, t, cd, E, feats, byKey, late, out, k, fam, W, H } = o; const opts = o.opts || {}; const sc = (FX._cur && FX._cur.sc) || o.sc; const st = E.st; curLang = sc.look.lang || 'ar';
    const fxs = st.fx || ''; const mission = fxs === 'mission' || sc.look.hud === 1;
    const sphereClip = vw.mode === 'globe' ? (ctx) => { ctx.beginPath(); d3.geoPath(vw.proj, ctx)({ type: 'Sphere' }); ctx.clip(); } : null;
    const layers = (sc.layers || []).map(L0 => { const s = S.state(L0, t, cd); if (!s) return null; const L = S.resolve(L0, s.lt); if (L.opacity != null && FX.TYPES.includes(L.type) && L.type !== 'clouds') s.a *= clamp(+L.opacity, 0, 1); return { L, s }; }).filter(Boolean);
    let fr = null; const frame = () => fr || (fr = localFrame(vw));
    const taken = []; const takenInit = () => { if (!taken.init) { taken.init = 1; for (const r of (out && out.labels) || []) taken.push(r.slice()); } return taken; };
    for (const { L, s } of layers) {
      const pin = S.easeOut(s.pin);
      if (L.type === 'country' && (FX.BSTYLES[L.outline] || L.cut || fxs === 'papercut')) {
        const fs = (L.keys || []).map(kk => byKey.get(kk)).filter(Boolean); if (!fs.length) continue;
        const pa = new Path2D(); const pp = d3.geoPath(vw.proj, pa); for (const f of fs) pp(f);
        if (L.cut || fxs === 'papercut') { // paper cut-out lifted above the map
          const lift = pin * (L.liftK == null ? 1 : L.liftK);
          b.save(); b.globalAlpha = s.a; const outer = new Path2D(); outer.rect(-10, -10, W + 20, H + 20); outer.addPath(pa); b.clip(outer, 'evenodd');
          b.fillStyle = `rgba(28,18,8,${.24 * lift})`; b.fillRect(0, 0, W, H);
          b.shadowColor = `rgba(18,10,2,${.62 * lift})`; b.shadowBlur = 30 * k; b.shadowOffsetX = 14 * k * lift; b.shadowOffsetY = 22 * k * lift; b.fillStyle = '#000'; b.fill(pa); b.restore();
          b.save(); b.globalAlpha = s.a * lift; b.clip(pa); b.fillStyle = 'rgba(255,246,226,.08)'; b.fillRect(0, 0, W, H); b.lineJoin = 'round'; b.filter = `blur(${(3 * k).toFixed(1)}px)`; b.lineWidth = 7 * k; b.strokeStyle = 'rgba(255,248,230,.35)'; b.translate(-2 * k, -2 * k); b.stroke(pa); b.restore();
          g.save(); g.globalAlpha = s.a * lift; g.lineJoin = 'round'; g.lineWidth = 2.6 * k; g.strokeStyle = 'rgba(252,248,238,.96)'; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 2 * k; g.stroke(pa); g.restore();
        }
        if (FX.BSTYLES[L.outline]) {
          const bst = L.outline; const col = L.bcol || (bst === 'neon' ? shadeHex(L.color, .2) : bst === 'ribbon' ? shadeHex(L.color, .45) : FX.BCOL[bst]); const lw = (L.stroke || 1) * 1.6 * k;
          let build;
          if (bst === 'historic') { const ppd = vw.kpx * RAD * (vw.mode === 'flat' ? 1 / Math.max(.2, Math.cos(vw.lat * RAD)) : 1); const geos = [0, 1].map(alt => fs.map(f => wobbleGeom(f.geometry, ppd, 11 + alt * 29, (alt ? 1.3 : 1.7) * k))); build = (ctx, alt) => { const p = d3.geoPath(vw.proj, ctx); for (const gg of geos[alt || 0]) p(gg); }; }
          else build = (ctx) => { const p = d3.geoPath(vw.proj, ctx); for (const f of fs) p(f); };
          g.save(); g.globalAlpha = s.a * (L.in === 'fade' ? pin : 1); styledStroke(g, bst, build, col, lw, k, W, H, scratch); g.restore();
        }
      } else if (L.type === 'clouds') {
        const f0 = frame(); if (!f0) continue; const a = s.a * (L.in === 'fade' ? pin : 1);
        if (L.shadow > 0) drawCloudLayer(b, vw, L, a, s.lt + (L.start || 0), 'shadow', f0, sphereClip, opts.fast);
        const draw = () => drawCloudLayer(g, vw, L, a, s.lt + (L.start || 0), 'cloud', f0, sphereClip, opts.fast);
        if (L.above) late.push(draw); else draw();
      } else if (L.type === 'move' && L.pts && L.pts.length >= 2) {
        const ctrl = L.pts.length >= 3 && L.pts.length < 80 && L.round !== 0 ? smoothPts(L.pts.map(q => [q[0], q[1]]), 4) : L.pts; const eles = ctrl === L.pts ? L.eles : null;
        const p3 = path3(vw, ctrl, L.curve || 0, vw.mode === 'globe' || vw.mode === 'flat' ? (+L.arc || 0) : 0, eles, +L.eleLift || 0); if (!p3) continue;
        const base = p3.lifted || p3.pts.length > 400 ? p3.pts : smoothPts(p3.pts, 3); const ground = p3.lifted ? p3.ground : null;
        const n = clamp(L.multi | 0 || 1, 1, 7); const mid = (n - 1) / 2; const res = [];
        const dur = Math.max(.05, L.inDur || 3); const drawn = L.in === 'draw' || L.in === 'grow';
        for (let i = 0; i < n; i++) {
          const lag = n > 1 ? Math.abs(i - mid) * (L.stagger == null ? .25 : +L.stagger) * dur * .4 : 0; const pr = drawn ? S.ease(clamp((s.lt - lag) / dur, 0, 1)) : 1; if (pr <= 0) continue;
          const lenF = n > 1 ? 1 - .14 * Math.abs(i - mid) / Math.max(1, mid) : 1;
          const P = n > 1 ? offsetPts(base, (i - mid) * 30 * k * (L.spread || 1) * (L.width || 1)) : base;
          const tailF = L.tail > 0 ? Math.max(0, pr * lenF - clamp(+L.tail, 0, 1)) : 0;
          const a = s.a * (L.in === 'fade' ? pin : 1);
          const r = drawMove(g, b, L, P, i === Math.round(mid) && ground ? ground : null, k, s.lt, s, pr * lenF, tailF, a, mission && !L.pulses ? 1 : 0); if (r) res.push(r);
        }
        // travelling symbols
        if (L.sym && res.length) late.push(() => {
          const sz = 40 * k * (L.symSize || 1); const a = s.a * (L.in === 'fade' ? pin : 1);
          for (const r of res) { const N = clamp(L.symN | 0 || 1, 1, 12); const span = r.s1 - r.s0; const gap = N > 1 ? Math.min(sz * 1.6, span / N) : 0;
            for (let j = 0; j < N; j++) { let x; if (L.loop && drawnDone(s, L)) { const per = Math.max(.5, +L.loop || 1) ; x = r.s0 + (((s.lt / (dur * per)) + j / N) % 1) * span; } else x = r.s1 - j * gap; if (x < r.s0 - .5) continue;
              const p = at(r.P, r.L, x); if (p3.lifted && L.arc > 0) { g.save(); g.globalAlpha = a * .35; g.fillStyle = '#000'; g.filter = `blur(${(3 * k).toFixed(1)}px)`; const gi = Math.min(p3.ground.length - 1, p.i); const gp = p3.ground[gi]; if (gp) { g.beginPath(); g.ellipse(gp[0], gp[1], sz * .35, sz * .2, 0, 0, 7); g.fill(); } g.restore(); }
              symbol(g, L.sym, p.x, p.y, sz * (j ? .85 : 1), L.symColor || (L.sym === 'dot' ? L.color : '#ffffff'), p.tx, p.ty, s.lt + j * .37, a); } }
        });
        if (L.profile && L.eles && L.eles.some(x => x != null) && res.length) late.push(() => drawProfile(g, L, s, res[0], W, H, k, fam));
      } else if (L.type === 'callout') {
        const sp = vw.project(L.lon, L.lat); if (!sp) continue; late.push(() => drawCallout(g, L, sp, s, k, W, H, fam, takenInit(), mission));
      } else if (L.type === 'district') {
        drawDistricts(b, g, L, s, vw, k, late, fam, st, opts, feats, o.era);
      }
    }
    if (mission && sc.look.hud !== 0) late.push(() => drawHud(g, vw, t, k, W, H, sc));
  };
  // registered on vector.js's frame hooks: 'mid' = after war layers, before map labels; 'top' = after labels
  let topQ = [];
  if (V.hooks) {
    V.hooks.mid.push((HK) => { topQ = []; FX.hook(Object.assign({}, HK, { late: topQ })); });
    V.hooks.top.push(() => { const q = topQ; topQ = []; for (const fn of q) { try { fn(); } catch (e) { console.error('fxpack top', e); } } });
  }
  const drawnDone = (s, L) => s.lt >= (L.inDur || 3);
  function drawProfile(g, L, s, r, W, H, k, fam) {
    const es = L.eles; const n = es.length; const w = 360 * k, h = 96 * k, x0 = 40 * k, y0 = H - 40 * k - h; const lo = Math.min(...es.filter(x => x != null)), hi = Math.max(lo + 1, ...es.filter(x => x != null));
    const p = r.s1 / Math.max(1, r.tot); g.save(); g.globalAlpha = s.a * S.easeOut(s.pin);
    g.fillStyle = 'rgba(8,11,16,.72)'; g.beginPath(); if (g.roundRect) g.roundRect(x0 - 12 * k, y0 - 30 * k, w + 24 * k, h + 44 * k, 8 * k); else g.rect(x0 - 12 * k, y0 - 30 * k, w + 24 * k, h + 44 * k); g.fill();
    const X = (i) => x0 + w * i / (n - 1), Y = (e) => y0 + h - (e - lo) / (hi - lo) * h * .9;
    const line = () => { g.beginPath(); let st0 = false; for (let i = 0; i < n; i++) { if (es[i] == null) continue; if (!st0) { g.moveTo(X(i), Y(es[i])); st0 = true; } else g.lineTo(X(i), Y(es[i])); } };
    line(); g.lineTo(x0 + w, y0 + h); g.lineTo(x0, y0 + h); g.closePath(); g.fillStyle = 'rgba(255,255,255,.08)'; g.fill();
    g.save(); g.beginPath(); g.rect(x0, y0 - 4 * k, w * p, h + 8 * k); g.clip(); line(); g.lineTo(x0 + w, y0 + h); g.lineTo(x0, y0 + h); g.closePath(); g.fillStyle = rgba(L.color, .35); g.fill(); line(); g.lineWidth = 2 * k; g.strokeStyle = L.color; g.stroke(); g.restore();
    const i = Math.min(n - 1, Math.round(p * (n - 1))); let e = es[i]; for (let j = i; e == null && j >= 0; j--) e = es[j];
    if (e != null) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(i), Y(e), 4 * k, 0, 7); g.fill(); }
    const en = curLang === 'en'; V.haloText(g, (en ? 'Elevation ' : 'الارتفاع ') + (e != null ? Math.round(e).toLocaleString('en') : '—') + (en ? ' m' : ' م'), en ? x0 : x0 + w, y0 - 15 * k, 15 * k, '#ffffff', null, fam, 800, en ? 'left' : 'right');
    if (L.km) V.haloText(g, (L.km * p).toFixed(1) + (en ? ' km' : ' كم'), en ? x0 + w : x0, y0 - 15 * k, 14 * k, '#cfd8e3', null, 'Barlow Condensed', 700, en ? 'right' : 'left');
    g.restore();
  }

  /* ============================== ensure (fonts, admin-1) ============================== */
  const ens0 = A.ensure;
  if (ens0) A.ensure = async (scene, t, W, H, opts = {}) => {
    const ls = scene.layers || []; const sty = (S.STYLES[scene.style] || {}).fx;
    if (ls.some(L => L.type === 'district') && G.loadAdmin1) await G.loadAdmin1().catch(() => {});
    if (document.fonts && document.fonts.load && (ls.some(L => L.type === 'callout' || L.type === 'move') || sty)) await Promise.all(['700 30px "Amiri"', '700 20px "Barlow Condensed"', '600 20px "Barlow Condensed"', '800 20px "Cairo"'].map(f => document.fonts.load(f, 'عربي AZ').catch(() => {})));
    for (const L of ls) if (L.type === 'clouds') cloudTex(L.seed | 0 || 1, clamp(+L.cover, 0, 1), L.color || '#ffffff');
    return ens0(scene, t, W, H, opts);
  };

  /* ============================== GPX / GeoJSON / KML import ============================== */
  FX.parseTrack = (text, name) => {
    const s = String(text || ''); let lines = []; let title = name || '';
    if (/^\s*[{[]/.test(s)) {
      const j = JSON.parse(s); const walk = (o) => { if (!o) return; if (o.type === 'FeatureCollection') o.features.forEach(walk); else if (o.type === 'Feature') { if (!title && o.properties && o.properties.name) title = o.properties.name; walk(o.geometry); } else if (o.type === 'GeometryCollection') o.geometries.forEach(walk); else if (o.type === 'LineString') lines.push(o.coordinates); else if (o.type === 'MultiLineString') lines.push(...o.coordinates); else if (o.type === 'Polygon') lines.push(o.coordinates[0]); };
      walk(j);
    } else if (/<gpx[\s>]/i.test(s)) {
      const nm = /<name>([^<]*)<\/name>/i.exec(s); if (nm && !title) title = nm[1].trim();
      for (const seg of s.split(/<\/trkseg>|<\/rte>/i)) { const pts = []; const re = /<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>|<(?:trkpt|rtept)\b([^>]*)\/>/gi; let m; while ((m = re.exec(seg))) { const at0 = m[1] || m[3] || ''; const la = /lat\s*=\s*["']([-\d.eE+]+)/.exec(at0), lo = /lon\s*=\s*["']([-\d.eE+]+)/.exec(at0); if (!la || !lo) continue; const el = m[2] ? /<ele>\s*([-\d.eE+]+)/.exec(m[2]) : null; pts.push([+lo[1], +la[1], el ? +el[1] : null]); } if (pts.length > 1) lines.push(pts); }
    } else if (/<kml[\s>]/i.test(s)) {
      const nm = /<name>([^<]*)<\/name>/i.exec(s); if (nm && !title) title = nm[1].trim();
      const re = /<LineString[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi; let m; while ((m = re.exec(s))) lines.push(m[1].trim().split(/\s+/).map(q => q.split(',').map(Number)).filter(q => q.length >= 2 && isFinite(q[0]) && isFinite(q[1])));
      if (!lines.length) { const r2 = /<gx:coord>([^<]+)<\/gx:coord>/gi; const pts = []; while ((m = r2.exec(s))) { const q = m[1].trim().split(/\s+/).map(Number); pts.push(q); } if (pts.length > 1) lines.push(pts); }
    } else throw new Error('صيغة غير معروفة (GPX / GeoJSON / KML)');
    if (!lines.length) throw new Error('لا يوجد مسار خطي في الملف');
    // join segments into the longest continuous path
    lines.sort((a, b) => b.length - a.length); let pts = lines[0].map(p => [+p[0], +p[1], p[2] != null && isFinite(p[2]) ? +p[2] : null]);
    let km = 0; for (let i = 1; i < pts.length; i++) km += d3.geoDistance(pts[i - 1], pts[i]) * 6371;
    // simplify to ≤ 600 points (Douglas–Peucker in degrees)
    const dp = (P, eps) => { const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1; const st = [[0, P.length - 1]]; while (st.length) { const [i0, i1] = st.pop(); let best = -1, bd = eps; const ax = P[i0][0], ay = P[i0][1], bx = P[i1][0], by = P[i1][1]; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12; for (let i = i0 + 1; i < i1; i++) { const u = clamp(((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / l2, 0, 1); const d = Math.hypot(P[i][0] - ax - u * dx, P[i][1] - ay - u * dy); if (d > bd) { bd = d; best = i; } } if (best > 0) { keep[best] = 1; st.push([i0, best], [best, i1]); } } return P.filter((_, i) => keep[i]); };
    if (pts.length > 600) { let eps = 1e-5; let q = dp(pts, eps); while (q.length > 600) { eps *= 1.6; q = dp(pts, eps); } pts = q; }
    const hasEle = pts.some(p => p[2] != null);
    return { name: title, pts: pts.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]), eles: hasEle ? pts.map(p => p[2] == null ? null : +p[2].toFixed(1)) : null, km: +km.toFixed(2) };
  };
  // build an animated route layer from a parsed track; optional camera follow keys
  FX.routeLayer = (tr, o = {}) => {
    const L = S.newLayer('move', Object.assign({ name: tr.name || 'مسار مستورد', pts: tr.pts, eles: tr.eles, km: tr.km, color: '#ff5a1f', dash: 'solid', head: 'none', taper: 0, comet: 1, glow: 1, curve: 0, width: .8, sym: 'dot', profile: tr.eles ? 1 : 0, inDur: o.inDur || 8, in: 'draw' }, o.props || {}));
    return L;
  };
  // camera keys that follow the route head (scene time = layer.start + local time)
  FX.followKeys = (scene, L, o = {}) => {
    const n = clamp(o.keys || 7, 2, 24); const dur = Math.max(.1, L.inDur || 3); const keys = [];
    const bb = d3.geoBounds({ type: 'LineString', coordinates: L.pts }); const spanDeg = Math.max(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1]);
    const fitZ = Cm.zoomForSpan ? Cm.zoomForSpan(Math.max(.002, spanDeg * RAD), (bb[0][1] + bb[1][1]) / 2, .7) : 6; const zf = clamp(fitZ + (o.zoomIn == null ? 1.6 : o.zoomIn), 1, 17);
    const ln = { type: 'LineString', coordinates: L.pts }; const tot = d3.geoLength(ln); const cum = [0]; for (let i = 1; i < L.pts.length; i++) cum.push(cum[i - 1] + d3.geoDistance(L.pts[i - 1], L.pts[i]));
    const posAt = (f) => { const d = f * tot; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const g0 = (d - cum[i - 1]) / Math.max(1e-12, cum[i] - cum[i - 1]); return d3.geoInterpolate(L.pts[i - 1], L.pts[i])(clamp(g0, 0, 1)); };
    const ct = [(bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2];
    keys.push({ t: (L.start || 0), lon: ct[0], lat: ct[1], zoom: fitZ });
    for (let i = 0; i < n; i++) { const lt = dur * (i + .5) / n; const f = S.ease(clamp(lt / dur, 0, 1)); const p = posAt(f); keys.push({ t: (L.start || 0) + lt + .4, lon: p[0], lat: p[1], zoom: zf }); }
    keys.push({ t: (L.start || 0) + dur + 1.2, lon: ct[0], lat: ct[1], zoom: fitZ });
    return keys;
  };
  // write follow keys into a map clip's camera (camera engineer's API when present, else camera.js keys directly)
  FX.applyFollow = (clip, L, o = {}) => {
    const scn = clip.map.scene; const keys = FX.followKeys(scn, L, o); const api = GW.API && GW.API.methods && GW.API.methods.setCameraKey; const c0 = clip.in || 0; let n = 0;
    for (const k of keys) {
      const lt = k.t - c0; if (lt < 0 || lt > clip.dur) continue; const vals = { lon: k.lon, lat: k.lat, zoom: k.zoom };
      if (api) { try { api(Object.assign({ id: clip.id, time: clip.start + lt, interp: 'bezier' }, vals)); n++; continue; } catch (e) { /* fall back */ } }
      if (Cm.setKey) Cm.setKey(scn.cam, k.t, vals, { mode: scn.mode }); else { scn.cam.keys = scn.cam.keys || []; scn.cam.keys.push(Object.assign({ t: k.t, ease: 'inout' }, vals)); scn.cam.keys.sort((a, b) => a.t - b.t); }
      n++;
    }
    return n;
  };
})();
