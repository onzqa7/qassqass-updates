'use strict';
/* Shapes & graphics library (مكتبة الأشكال): original vector designs built in code (anchor lists [[x,y,inX,inY,outX,outY]…] in a
   design box, default 100×100). An item becomes a shape clip of type 'lib' (shape.js): clip.shape.lib = { id }, geometry fitted into
   center / size / rot, so fill / gradient / stroke / dash / trim paths / keyframes all work unchanged. Also used for: Essential Graphics
   tab «أشكال» (browser with search, categories, hover preview, fill styles, auto animation), frame masks on a selected clip, map marker
   pictograms (atlas/vector.js draws icon ids 'lib:<id>' through ShapeLib.icon) and the API (listShapes / addLibraryShape). */
(function () {
  const L = GW.ShapeLib = { items: [], by: {} };
  const P = GW.P, clamp = GW.clamp;
  const K = 0.5523; // bezier circle constant
  L.CATS = [['all', 'الكل'], ['basic', 'أساسية'], ['arrow', 'أسهم'], ['callout', 'فقاعات وشارات'], ['map', 'رموز وثائقية وخرائط'], ['ui', 'واجهة وبيانات'], ['frame', 'إطارات وأقنعة'], ['shorts', 'ملصقات شورتس']];
  L.ANIMS = [['none', 'بدون'], ['draw', 'رسم تدريجي'], ['pop', 'ظهور نابض'], ['slide', 'انزلاق'], ['pulse', 'نبض']];
  L.STYLES = [['accent', 'لون التمييز', null], ['white', 'أبيض', '#ffffff'], ['black', 'أسود', '#111111'], ['red', 'أحمر وثائقي', '#b3261e'], ['green', 'أخضر', '#2f7a4a'], ['gold', 'ذهبي', '#d2a53c'], ['outline', 'حد فقط', null]];
  const accent = () => { try { return (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || '#ff6a2b'; } catch (e) { return '#ff6a2b'; } };
  L.styleColor = (k) => { const st = L.STYLES.find(x => x[0] === k); return st && st[2] ? st[2] : accent(); };

  /* ================= geometry builders (design units) ================= */
  const A = (x, y, ix = 0, iy = 0, ox = 0, oy = 0) => [x, y, ix, iy, ox, oy];
  const poly = (pts, closed = true) => ({ pts: pts.map(p => A(p[0], p[1])), closed });
  const line = (x1, y1, x2, y2) => poly([[x1, y1], [x2, y2]], false);
  const ell = (cx, cy, rx, ry) => ({ closed: true, pts: [A(cx + rx, cy, 0, -ry * K, 0, ry * K), A(cx, cy + ry, rx * K, 0, -rx * K, 0), A(cx - rx, cy, 0, ry * K, 0, -ry * K), A(cx, cy - ry, -rx * K, 0, rx * K, 0)] });
  const circ = (cx, cy, r) => ell(cx, cy, r, r);
  const rect = (x, y, w, h, r = 0) => {
    r = Math.min(r, w / 2, h / 2); if (r <= 0) return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    const k = r * K; return { closed: true, pts: [A(x + r, y, -k, 0), A(x + w - r, y, 0, 0, k, 0), A(x + w, y + r, 0, -k), A(x + w, y + h - r, 0, 0, 0, k), A(x + w - r, y + h, k, 0), A(x + r, y + h, 0, 0, -k, 0), A(x, y + h - r, 0, k), A(x, y + r, 0, 0, 0, -k)] };
  };
  const regular = (cx, cy, r, n, rot = -Math.PI / 2) => poly(Array.from({ length: n }, (_, i) => { const t = rot + i / n * Math.PI * 2; return [cx + Math.cos(t) * r, cy + Math.sin(t) * r]; }));
  const star = (cx, cy, r, ri, n, rot = -Math.PI / 2) => poly(Array.from({ length: n * 2 }, (_, i) => { const t = rot + i / (n * 2) * Math.PI * 2; const rr = i % 2 ? ri : r; return [cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]; }));
  // arc as bezier anchors (open), angles in radians
  const arc = (cx, cy, r, a0, a1) => {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2 + 1e-6))); const d = (a1 - a0) / n; const k = 4 / 3 * Math.tan(d / 4) * r; const pts = [];
    for (let i = 0; i <= n; i++) { const t = a0 + i * d; const c = Math.cos(t), s = Math.sin(t); pts.push(A(cx + c * r, cy + s * r, i ? s * k : 0, i ? -c * k : 0, i < n ? -s * k : 0, i < n ? c * k : 0)); }
    return { pts, closed: false };
  };
  // mini SVG path parser (M L H V C S Q Z, absolute + relative) → sub-paths of anchors
  function svg(d) {
    const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || []; const subs = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', pc = null, i = 0;
    const num = () => parseFloat(tok[i++]); const start = () => { cur = { pts: [], closed: false }; subs.push(cur); };
    const lineTo = (nx, ny) => { cur.pts.push(A(nx, ny)); x = nx; y = ny; pc = null; };
    const cubic = (x1, y1, x2, y2, nx, ny) => { const a = cur.pts[cur.pts.length - 1]; a[4] = x1 - a[0]; a[5] = y1 - a[1]; cur.pts.push(A(nx, ny, x2 - nx, y2 - ny)); x = nx; y = ny; pc = [x2, y2]; };
    while (i < tok.length) {
      if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++]; const rel = cmd === cmd.toLowerCase(); const C = cmd.toUpperCase();
      if (C === 'M') { const nx = num(), ny = num(); start(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; sx = x; sy = y; cur.pts.push(A(x, y)); pc = null; cmd = rel ? 'l' : 'L'; }
      else if (C === 'L') { const nx = num(), ny = num(); lineTo(rel ? x + nx : nx, rel ? y + ny : ny); }
      else if (C === 'H') { const nx = num(); lineTo(rel ? x + nx : nx, y); }
      else if (C === 'V') { const ny = num(); lineTo(x, rel ? y + ny : ny); }
      else if (C === 'C') { let a = [num(), num(), num(), num(), num(), num()]; if (rel) a = a.map((v, j) => v + (j % 2 ? y : x)); cubic(...a); }
      else if (C === 'S') { let a = [num(), num(), num(), num()]; if (rel) a = a.map((v, j) => v + (j % 2 ? y : x)); const r = pc ? [2 * x - pc[0], 2 * y - pc[1]] : [x, y]; cubic(r[0], r[1], ...a); }
      else if (C === 'Q') { let a = [num(), num(), num(), num()]; if (rel) a = a.map((v, j) => v + (j % 2 ? y : x)); cubic(x + 2 / 3 * (a[0] - x), y + 2 / 3 * (a[1] - y), a[2] + 2 / 3 * (a[0] - a[2]), a[3] + 2 / 3 * (a[1] - a[3]), a[2], a[3]); }
      else if (C === 'Z') { if (cur) { cur.closed = true; const f = cur.pts[0], l = cur.pts[cur.pts.length - 1]; if (cur.pts.length > 1 && Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) { f[2] = l[2]; f[3] = l[3]; cur.pts.pop(); } } x = sx; y = sy; pc = null; }
      else i++;
    }
    return subs.filter(s => s.pts.length > 1);
  }
  const tf = (subs, fn) => subs.map(s => ({ closed: s.closed, pts: s.pts.map(p => { const a = fn(p[0], p[1]), i = fn(p[0] + p[2], p[1] + p[3]), o = fn(p[0] + p[4], p[1] + p[5]); return A(a[0], a[1], i[0] - a[0], i[1] - a[1], o[0] - a[0], o[1] - a[1]); }) }));
  const mirrorX = (subs, cx = 50) => tf(subs, (x, y) => [2 * cx - x, y]).map(s => ({ closed: s.closed, pts: s.pts.slice().reverse().map(p => A(p[0], p[1], p[4], p[5], p[2], p[3])) }));
  const rotate = (subs, deg, cx = 50, cy = 50) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return tf(subs, (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); };
  const move = (subs, dx, dy) => tf(subs, (x, y) => [x + dx, y + dy]);
  const scale = (subs, k, cx = 50, cy = 50) => tf(subs, (x, y) => [cx + (x - cx) * k, cy + (y - cy) * k]);
  // seeded wobble for hand-drawn looks
  const wobble = (sub, amp, seed) => { const r = GW.rng(seed || 3); return { closed: sub.closed, pts: sub.pts.map(p => A(p[0] + (r() - .5) * amp, p[1] + (r() - .5) * amp, p[2], p[3], p[4], p[5])) }; };
  // smooth closed blob through n points (Catmull-Rom → bezier)
  const blob = (cx, cy, r, n, seed, amp = .25) => {
    const rnd = GW.rng(seed); const pts = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; const rr = r * (1 - amp + rnd() * amp * 2); pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]); }
    return smooth(pts, true);
  };
  const smooth = (pts, closed, tension = 1) => { // Catmull-Rom → cubic anchors
    const n = pts.length; const out = [];
    for (let i = 0; i < n; i++) { const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n]; const open0 = !closed && i === 0, openN = !closed && i === n - 1; const tx = (open0 ? p2[0] - p1[0] : openN ? p1[0] - p0[0] : (p2[0] - p0[0]) / 2) * tension / 3, ty = (open0 ? p2[1] - p1[1] : openN ? p1[1] - p0[1] : (p2[1] - p0[1]) / 2) * tension / 3; out.push(A(p1[0], p1[1], open0 ? 0 : -tx, open0 ? 0 : -ty, openN ? 0 : tx, openN ? 0 : ty)); }
    return { pts: out, closed };
  };
  // arrows: chunky straight arrow in a 100×(2*hw) box pointing right; tail width tw, head length hl, head width hw
  const arrowR = (tw = 14, hl = 34, hw = 30, len = 100, cy = 50) => poly([[0, cy - tw], [len - hl, cy - tw], [len - hl, cy - hw], [len, cy], [len - hl, cy + hw], [len - hl, cy + tw], [0, cy + tw]]);
  const head = (x, y, ang, len, w) => { const c = Math.cos(ang), s = Math.sin(ang); return poly([[x - c * len - s * w, y - s * len + c * w], [x, y], [x - c * len + s * w, y - s * len - c * w]], false); };
  // map-style movement arrow: tapered tail along a polyline of centre points (last point = tip) with a filled head
  function taper(path, w0, w1, hl, hw) {
    const n = path.length; const seg = (i) => { const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    const tip = path[n - 1]; const d = seg(n - 1); const base = [tip[0] - d[0] * hl, tip[1] - d[1] * hl];
    const left = [], right = []; const total = path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0); let acc = 0;
    for (let i = 0; i < n - 1; i++) { if (i) acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); const f = acc / total; const w = w0 + (w1 - w0) * f; const dd = seg(i); left.push([path[i][0] - dd[1] * w, path[i][1] + dd[0] * w]); right.push([path[i][0] + dd[1] * w, path[i][1] - dd[0] * w]); }
    left.push([base[0] - d[1] * w1, base[1] + d[0] * w1]); right.push([base[0] + d[1] * w1, base[1] - d[0] * w1]);
    const pts = [...left, [base[0] - d[1] * hw, base[1] + d[0] * hw], tip, [base[0] + d[1] * hw, base[1] - d[0] * hw], ...right.reverse()];
    const sm = smooth(pts, true, .6); // soften the tail edges, keep the head crisp
    const nL = left.length; sm.pts.forEach((p, i) => { if (i >= nL && i <= nL + 2) { p[2] = p[3] = p[4] = p[5] = 0; } }); sm.pts[0][2] = sm.pts[0][3] = sm.pts[0][4] = sm.pts[0][5] = 0; sm.pts[sm.pts.length - 1][2] = sm.pts[sm.pts.length - 1][3] = sm.pts[sm.pts.length - 1][4] = sm.pts[sm.pts.length - 1][5] = 0;
    return sm;
  }
  const curvePts = (x0, y0, x1, y1, bulge, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; const mx = (x0 + x1) / 2, my = (y0 + y1) / 2; const dx = x1 - x0, dy = y1 - y0; const l = Math.hypot(dx, dy) || 1; const cx = mx - dy / l * bulge, cy = my + dx / l * bulge; const u = 1 - t; return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]; });

  /* ================= catalogue ================= */
  // def(id, cat, name, build, o): o = { box:[w,h], anim, stroke:1 (stroke-only item), sw (stroke px at 100 px size), rule:'evenodd', size (fraction of the short frame side),
  //   at:[fx,fy] default placement, mask: sub-path index used as a mask (frames), cover:1 (frames fill the whole frame), text:{str,color} (stamps), dir:'l|r|u|d' (slide direction) }
  const def = (id, cat, n, build, o = {}) => { const it = Object.assign({ id, cat, n, box: [100, 100], anim: 'pop', size: .3, sw: 6 }, o); it.build = build; L.items.push(it); L.by[id] = it; };
  L.get = (id) => L.by[id] || null;
  L.geom = (it) => it._g || (it._g = [it.build()].flat(3).filter(x => x && x.pts));

  /* ---- basic ---- */
  def('rect', 'basic', 'مستطيل', () => [rect(0, 15, 100, 70)], { box: [100, 100] });
  def('rrect', 'basic', 'مستطيل مستدير', () => [rect(0, 15, 100, 70, 14)]);
  def('square', 'basic', 'مربع مستدير', () => [rect(5, 5, 90, 90, 18)]);
  def('pill', 'basic', 'كبسولة', () => [rect(0, 28, 100, 44, 22)]);
  def('circle', 'basic', 'دائرة', () => [circ(50, 50, 48)]);
  def('ring', 'basic', 'حلقة', () => [circ(50, 50, 48), circ(50, 50, 30)], { rule: 'evenodd' });
  def('thinring', 'basic', 'حلقة رفيعة', () => [circ(50, 50, 48), circ(50, 50, 42)], { rule: 'evenodd', anim: 'draw' });
  def('semi', 'basic', 'نصف دائرة', () => [{ closed: true, pts: [A(2, 70, 0, 0, 0, -26.5), A(50, 22, -26.5, 0, 26.5, 0), A(98, 70, 0, -26.5)] }]);
  def('tri', 'basic', 'مثلث', () => [poly([[50, 6], [96, 88], [4, 88]])]);
  def('rtri', 'basic', 'مثلث قائم', () => [poly([[8, 8], [92, 92], [8, 92]])]);
  def('diamond', 'basic', 'معيّن', () => [poly([[50, 2], [98, 50], [50, 98], [2, 50]])]);
  def('pent', 'basic', 'خماسي', () => [regular(50, 52, 48, 5)]);
  def('hex', 'basic', 'سداسي', () => [regular(50, 50, 48, 6, 0)]);
  def('hexv', 'basic', 'سداسي قائم', () => [regular(50, 50, 48, 6)]);
  def('oct', 'basic', 'ثماني', () => [regular(50, 50, 48, 8, Math.PI / 8)]);
  def('star5', 'basic', 'نجمة خماسية', () => [star(50, 52, 48, 20, 5)]);
  def('star4', 'basic', 'نجمة رباعية', () => [star(50, 50, 48, 12, 4)]);
  def('star8', 'basic', 'نجمة ثمانية', () => [star(50, 50, 48, 32, 8)]);
  def('seal', 'basic', 'ختم مسنن', () => [star(50, 50, 48, 41, 16)]);
  def('blob1', 'basic', 'كتلة ناعمة ١', () => [blob(50, 50, 44, 7, 11)]);
  def('blob2', 'basic', 'كتلة ناعمة ٢', () => [blob(50, 50, 44, 6, 23, .3)]);
  def('blob3', 'basic', 'كتلة ناعمة ٣', () => [blob(50, 50, 44, 9, 5, .18)]);
  def('cross', 'basic', 'صليب / زائد', () => [poly([[36, 4], [64, 4], [64, 36], [96, 36], [96, 64], [64, 64], [64, 96], [36, 96], [36, 64], [4, 64], [4, 36], [36, 36]])]);
  def('heart', 'basic', 'قلب', () => svg('M50 90 C20 68 6 54 6 34 C6 18 18 8 30 8 C40 8 47 14 50 22 C53 14 60 8 70 8 C82 8 94 18 94 34 C94 54 80 68 50 90 Z'));
  def('drop', 'basic', 'قطرة', () => svg('M50 4 C50 4 88 48 88 66 C88 86 71 97 50 97 C29 97 12 86 12 66 C12 48 50 4 50 4 Z'));
  def('parallel', 'basic', 'متوازي أضلاع', () => [poly([[22, 20], [100, 20], [78, 80], [0, 80]])]);
  def('trapez', 'basic', 'شبه منحرف', () => [poly([[20, 20], [80, 20], [100, 80], [0, 80]])]);

  /* ---- arrows ---- */
  def('arrow', 'arrow', 'سهم عريض', () => [arrowR(14, 34, 32)], { box: [100, 100], anim: 'slide', dir: 'l', size: .32 });
  def('arrowFat', 'arrow', 'سهم ممتلئ', () => [arrowR(22, 40, 48)], { anim: 'slide', dir: 'l' });
  def('arrowThin', 'arrow', 'سهم رفيع', () => [line(4, 50, 94, 50), head(96, 50, 0, 22, 18)], { stroke: 1, sw: 5, anim: 'draw', box: [100, 60] });
  def('arrowDash', 'arrow', 'سهم متقطع', () => [line(4, 50, 86, 50), head(96, 50, 0, 22, 18)], { stroke: 1, sw: 5, dash: [10, 8], anim: 'draw', box: [100, 60] });
  def('arrowDbl', 'arrow', 'سهم مزدوج', () => [poly([[0, 50], [28, 22], [28, 38], [72, 38], [72, 22], [100, 50], [72, 78], [72, 62], [28, 62], [28, 78]])], { anim: 'pop' });
  def('arrowUp', 'arrow', 'سهم لأعلى', () => rotate([arrowR(14, 34, 32)], -90), { anim: 'slide', dir: 'd' });
  def('arrowDown', 'arrow', 'سهم لأسفل', () => rotate([arrowR(14, 34, 32)], 90), { anim: 'slide', dir: 'u' });
  def('arrowLeft', 'arrow', 'سهم لليسار', () => mirrorX([arrowR(14, 34, 32)]), { anim: 'slide', dir: 'r' });
  def('arrowCurve', 'arrow', 'سهم منحنٍ', () => [arc(50, 60, 42, Math.PI, Math.PI * 1.85), head(50 + Math.cos(Math.PI * 1.85) * 42, 60 + Math.sin(Math.PI * 1.85) * 42, Math.PI * 1.85 + Math.PI / 2, 20, 15)], { stroke: 1, sw: 6, anim: 'draw' });
  def('arrowCurve2', 'arrow', 'سهم منحنٍ معاكس', () => mirrorX([arc(50, 60, 42, Math.PI, Math.PI * 1.85), head(50 + Math.cos(Math.PI * 1.85) * 42, 60 + Math.sin(Math.PI * 1.85) * 42, Math.PI * 1.85 + Math.PI / 2, 20, 15)]), { stroke: 1, sw: 6, anim: 'draw' });
  def('arrowBent', 'arrow', 'سهم منكسر', () => [poly([[8, 10], [8, 70], [70, 70]], false), head(84, 70, 0, 20, 15)], { stroke: 1, sw: 6, anim: 'draw' });
  def('arrowUturn', 'arrow', 'سهم عودة', () => [{ pts: [A(10, 90), A(10, 40, 0, 22, 0, -22), A(50, 10, -22, 0, 22, 0), A(90, 40, 0, -22, 0, 22), A(90, 60)], closed: false }, head(90, 76, Math.PI / 2, 20, 15)], { stroke: 1, sw: 6, anim: 'draw' });
  def('arrowLoop', 'arrow', 'سهم دائري', () => [arc(50, 50, 38, -Math.PI * .4, Math.PI * 1.25), head(50 + Math.cos(Math.PI * 1.25) * 38, 50 + Math.sin(Math.PI * 1.25) * 38, Math.PI * 1.25 + Math.PI / 2, 20, 15)], { stroke: 1, sw: 6, anim: 'draw' });
  def('chevron', 'arrow', 'شيفرون', () => [poly([[20, 6], [56, 6], [86, 50], [56, 94], [20, 94], [50, 50]])], { anim: 'slide', dir: 'l', box: [100, 100] });
  def('chevron2', 'arrow', 'شيفرون مزدوج', () => [poly([[4, 10], [30, 10], [58, 50], [30, 90], [4, 90], [32, 50]]), poly([[46, 10], [72, 10], [100, 50], [72, 90], [46, 90], [74, 50]])], { anim: 'slide', dir: 'l' });
  def('arrowHand', 'arrow', 'سهم مرسوم باليد', () => { const s = smooth([[6, 70], [30, 40], [56, 56], [88, 30]], false); return [wobble(s, 2, 9), poly([[70, 24], [90, 29], [86, 48]], false)]; }, { stroke: 1, sw: 5, anim: 'draw', box: [100, 80] });
  def('arrowHand2', 'arrow', 'سهم مرسوم مقوّس', () => { const s = smooth([[8, 82], [26, 40], [58, 24], [90, 30]], false); return [wobble(s, 2, 4), poly([[74, 16], [92, 30], [78, 46]], false)]; }, { stroke: 1, sw: 5, anim: 'draw' });
  def('moveArrow', 'arrow', 'سهم تحرك (خريطة)', () => [taper([[4, 50], [50, 50], [72, 50]], 3, 11, 26, 24)], { anim: 'draw', dir: 'l', box: [100, 60], size: .3 });
  def('moveArrowC', 'arrow', 'سهم تحرك منحنٍ', () => [taper(curvePts(6, 80, 76, 30, 26), 3, 11, 24, 22)], { anim: 'draw' });
  def('moveArrowS', 'arrow', 'سهم تحرك متعرج', () => [taper([...curvePts(6, 76, 50, 50, 16, 8), ...curvePts(50, 50, 78, 20, -14, 8).slice(1)], 3, 10, 22, 20)], { anim: 'draw' });
  def('moveArrowC2', 'arrow', 'سهم تحرك منحنٍ معاكس', () => mirrorX([taper(curvePts(6, 80, 76, 30, 26), 3, 11, 24, 22)]), { anim: 'draw' });
  def('arrowHead', 'arrow', 'رأس سهم', () => [poly([[10, 10], [90, 50], [10, 90], [34, 50]])], { anim: 'slide', dir: 'l' });
  def('arrowSwipe', 'arrow', 'اسحب لأعلى', () => [poly([[20, 48], [50, 20], [80, 48]], false), poly([[20, 80], [50, 52], [80, 80]], false)], { stroke: 1, sw: 8, anim: 'slide', dir: 'd' });
  def('arrowRetreat', 'arrow', 'سهم انسحاب (متقطع)', () => [line(96, 50, 30, 50), head(6, 50, Math.PI, 24, 20)], { stroke: 1, sw: 7, dash: [10, 8], anim: 'draw', box: [100, 60] });

  /* ---- callouts & badges ---- */
  def('bubble', 'callout', 'فقاعة كلام', () => svg('M20 10 H80 C90 10 96 16 96 26 V58 C96 68 90 74 80 74 H44 L26 92 L30 74 H20 C10 74 4 68 4 58 V26 C4 16 10 10 20 10 Z'), { box: [100, 100], anim: 'pop', dir: 'd' });
  def('bubbleR', 'callout', 'فقاعة بيضوية', () => svg('M50 8 C76 8 96 22 96 42 C96 62 76 76 50 76 C44 76 38 75 33 74 L16 90 L22 70 C11 63 4 53 4 42 C4 22 24 8 50 8 Z'), { anim: 'pop' });
  def('bubbleRect', 'callout', 'فقاعة مستطيلة', () => [poly([[4, 8], [96, 8], [96, 70], [60, 70], [50, 92], [40, 70], [4, 70]])], { anim: 'pop' });
  def('thought', 'callout', 'فقاعة تفكير', () => [blob(50, 40, 34, 9, 17, .12), circ(26, 80, 7), circ(14, 92, 4)], { anim: 'pop' });
  def('calloutL', 'callout', 'تعليق بمؤشر جانبي', () => [poly([[20, 10], [96, 10], [96, 90], [20, 90], [20, 60], [4, 50], [20, 40]])], { anim: 'slide', dir: 'r' });
  def('shout', 'callout', 'انفجار صوتي', () => [star(50, 50, 48, 36, 12, -Math.PI / 2 + .2)], { anim: 'pop' });
  def('shout2', 'callout', 'انفجار صوتي حاد', () => [wobble(star(50, 50, 48, 30, 14), 5, 2)], { anim: 'pop' });
  def('ribbon', 'callout', 'شريط شارة', () => [poly([[10, 30], [90, 30], [90, 70], [10, 70]]), poly([[0, 22], [16, 22], [16, 78], [0, 78], [6, 50]]), poly([[84, 22], [100, 22], [94, 50], [100, 78], [84, 78]])], { box: [100, 60], anim: 'slide', dir: 'd', size: .32 });
  def('banner', 'callout', 'لافتة', () => [poly([[0, 20], [100, 20], [92, 50], [100, 80], [0, 80], [8, 50]])], { box: [100, 50], anim: 'slide', dir: 'd' });
  def('tag', 'callout', 'بطاقة', () => [poly([[4, 50], [34, 18], [96, 18], [96, 82], [34, 82]]), circ(38, 50, 6)], { rule: 'evenodd', box: [100, 60], anim: 'pop' });
  def('priceTag', 'callout', 'علامة سعر', () => [rect(28, 4, 44, 92, 8), circ(50, 20, 6)], { rule: 'evenodd', anim: 'pop' });
  def('plate', 'callout', 'لوح مستدير (ثلث سفلي)', () => [rect(0, 20, 100, 60, 10)], { box: [100, 40], at: [.5, .82], size: .55, anim: 'slide', dir: 'd' });
  def('plateWedge', 'callout', 'لوح مشطوف', () => [poly([[0, 20], [100, 20], [90, 80], [0, 80]])], { box: [100, 40], at: [.5, .82], size: .55, anim: 'slide', dir: 'l' });
  def('plateNotch', 'callout', 'لوح بعلامة', () => [poly([[0, 20], [100, 20], [100, 80], [16, 80], [16, 86], [8, 80], [0, 80]])], { box: [100, 40], at: [.5, .82], size: .55, anim: 'slide', dir: 'd' });
  def('plateSide', 'callout', 'لوح بحافة', () => [rect(10, 20, 90, 60, 4), rect(0, 20, 6, 60, 2)], { box: [100, 40], at: [.5, .82], size: .55, anim: 'slide', dir: 'l' });
  def('stampRound', 'callout', 'ختم دائري', () => [circ(50, 50, 48), circ(50, 50, 42), circ(50, 50, 32), circ(50, 50, 28)], { rule: 'evenodd', anim: 'pop', dash: [6, 4] });
  def('stampSecret', 'callout', 'ختم: سري', () => [rect(2, 22, 96, 56, 6), rect(7, 27, 86, 46, 4)], { box: [100, 60], rule: 'evenodd', anim: 'pop', rot: -12, text: { str: 'سري', size: .55 }, size: .38 });
  def('stampUrgent', 'callout', 'ختم: عاجل', () => [rect(2, 22, 96, 56, 6), rect(7, 27, 86, 46, 4)], { box: [100, 60], rule: 'evenodd', anim: 'pop', rot: -8, text: { str: 'عاجل', size: .55 }, size: .38 });
  def('stampApproved', 'callout', 'ختم: مُوثَّق', () => [circ(50, 50, 48), circ(50, 50, 43)], { rule: 'evenodd', anim: 'pop', rot: -14, text: { str: 'مُوثَّق', size: .3 }, size: .3 });
  def('badgeShield', 'callout', 'شارة درع', () => svg('M50 4 L92 18 C92 54 76 82 50 96 C24 82 8 54 8 18 Z'), { anim: 'pop' });
  def('badgeScallop', 'callout', 'شارة مموجة', () => { const n = 14, pts = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; pts.push([50 + Math.cos(t) * 46, 50 + Math.sin(t) * 46]); } const s = { closed: true, pts: pts.map((p, i) => { const t = i / n * Math.PI * 2, d = Math.PI / n; const kk = 20; return A(p[0], p[1], Math.cos(t - d) * -kk * .5 + Math.sin(t) * -kk * .35, Math.sin(t - d) * -kk * .5 - Math.cos(t) * -kk * .35, Math.cos(t + d) * -kk * .5 - Math.sin(t) * -kk * .35, Math.sin(t + d) * -kk * .5 + Math.cos(t) * -kk * .35); }) }; return [s]; }, { anim: 'pop' });
  def('ribbonCurl', 'callout', 'شريط مطوي', () => [poly([[12, 24], [100, 24], [100, 64], [12, 64]]), poly([[0, 34], [12, 24], [12, 64], [0, 74]])], { box: [100, 50], anim: 'slide', dir: 'r' });

  /* ---- documentary / map symbols ---- */
  def('crosshair', 'map', 'شعيرات تصويب', () => [circ(50, 50, 36), line(50, 2, 50, 26), line(50, 74, 50, 98), line(2, 50, 26, 50), line(74, 50, 98, 50)], { stroke: 1, sw: 5, anim: 'draw' });
  def('target', 'map', 'هدف', () => [circ(50, 50, 46), circ(50, 50, 38), circ(50, 50, 24), circ(50, 50, 16), circ(50, 50, 6)], { rule: 'evenodd', anim: 'pop' });
  def('burst', 'map', 'انفجار', () => [wobble(star(50, 50, 48, 24, 11, -1.2), 4, 7), star(50, 50, 24, 12, 7, .4)], { rule: 'evenodd', anim: 'pop' });
  def('burst2', 'map', 'انفجار حاد', () => [star(50, 50, 48, 18, 16, .3)], { anim: 'pop' });
  def('radar', 'map', 'حلقات رادار', () => [circ(50, 50, 46), circ(50, 50, 32), circ(50, 50, 18), circ(50, 50, 5)], { stroke: 1, sw: 3, anim: 'pulse' });
  def('radarSweep', 'map', 'رادار بمسح', () => [circ(50, 50, 46), circ(50, 50, 30), circ(50, 50, 14), { closed: true, pts: [A(50, 50), A(50, 4, 0, 0, 24, 0), A(96, 50, 0, -24)] }], { stroke: 1, sw: 3, anim: 'pulse' });
  def('pin', 'map', 'دبوس', () => svg('M50 4 C30 4 16 18 16 38 C16 62 50 96 50 96 C50 96 84 62 84 38 C84 18 70 4 50 4 Z M50 26 C56.6 26 62 31.4 62 38 C62 44.6 56.6 50 50 50 C43.4 50 38 44.6 38 38 C38 31.4 43.4 26 50 26 Z'), { rule: 'evenodd', anim: 'slide', dir: 'u' });
  def('pinFlat', 'map', 'دبوس مصمت', () => svg('M50 4 C30 4 16 18 16 38 C16 62 50 96 50 96 C50 96 84 62 84 38 C84 18 70 4 50 4 Z'), { anim: 'slide', dir: 'u' });
  def('pinRing', 'map', 'موقع (حلقة ونقطة)', () => [circ(50, 50, 44), circ(50, 50, 34), circ(50, 50, 12)], { rule: 'evenodd', anim: 'pulse' });
  def('flagTri', 'map', 'علم مثلث', () => [rect(10, 4, 7, 92, 2), poly([[17, 8], [94, 30], [17, 52]])], { anim: 'slide', dir: 'u' });
  def('flagRect', 'map', 'علم', () => [rect(10, 4, 7, 92, 2), poly([[17, 8], [90, 8], [78, 30], [90, 52], [17, 52]])], { anim: 'slide', dir: 'u' });
  def('flagWave', 'map', 'علم متموج', () => [rect(8, 4, 6, 92, 2), svg('M14 8 C40 -2 60 18 92 8 L92 52 C60 62 40 42 14 52 Z')], { anim: 'slide', dir: 'u' });
  def('battleX', 'map', 'موقع معركة (X)', () => [poly([[14, 4], [50, 40], [86, 4], [96, 14], [60, 50], [96, 86], [86, 96], [50, 60], [14, 96], [4, 86], [40, 50], [4, 14]])], { anim: 'pop' });
  def('swords', 'map', 'سيفان متقاطعان', () => { const sw = svg('M6 6 L20 8 L66 54 L74 47 L81 54 L74 61 L92 79 L84 87 L66 69 L59 76 L52 69 L59 62 L13 16 Z'); return [...sw, ...mirrorX(sw)]; }, { anim: 'pop' });
  def('tank', 'map', 'دبابة', () => [rect(4, 60, 92, 26, 13), rect(26, 40, 44, 22, 5), rect(60, 46, 38, 7, 3), circ(20, 73, 7), circ(50, 73, 7), circ(80, 73, 7)], { rule: 'evenodd', box: [100, 70], anim: 'slide', dir: 'l' });
  def('plane', 'map', 'طائرة', () => svg('M50 4 C54 4 56 9 56 15 V34 L96 58 V66 L56 54 V76 L68 84 V90 L50 86 L32 90 V84 L44 76 V54 L4 66 V58 L44 34 V15 C44 9 46 4 50 4 Z'), { anim: 'slide', dir: 'd' });
  def('jet', 'map', 'مقاتلة', () => svg('M50 2 L56 24 L60 46 L94 66 V74 L60 66 L58 82 L68 90 V96 L50 92 L32 96 V90 L42 82 L40 66 L6 74 V66 L40 46 L44 24 Z'), { anim: 'slide', dir: 'd' });
  def('heli', 'map', 'مروحية', () => [rect(4, 10, 92, 6, 3), rect(47, 14, 6, 14), ell(50, 52, 22, 24), rect(20, 60, 60, 10, 5), rect(24, 70, 10, 20, 3), rect(66, 70, 10, 20, 3)], { anim: 'slide', dir: 'd' });
  def('ship', 'map', 'سفينة', () => [poly([[4, 64], [96, 64], [84, 90], [16, 90]]), rect(28, 44, 44, 20, 3), rect(40, 30, 20, 14, 2), rect(47, 10, 6, 20, 2)], { box: [100, 90], anim: 'slide', dir: 'l' });
  def('sub', 'map', 'غواصة', () => [rect(4, 50, 92, 30, 15), rect(38, 32, 24, 20, 4), rect(48, 18, 4, 16, 2), poly([[4, 58], [-6, 48], [-6, 82], [4, 72]])], { box: [100, 70], anim: 'slide', dir: 'l' });
  def('soldier', 'map', 'جندي', () => [circ(50, 16, 12), poly([[32, 32], [68, 32], [76, 62], [66, 62], [62, 96], [38, 96], [34, 62], [24, 62]])], { anim: 'slide', dir: 'u' });
  def('missile', 'map', 'صاروخ', () => svg('M50 2 C58 12 62 22 62 34 V70 L76 84 L62 80 L58 96 H42 L38 80 L24 84 L38 70 V34 C38 22 42 12 50 2 Z'), { anim: 'slide', dir: 'd' });
  def('cannon', 'map', 'مدفع', () => [...rotate([rect(26, 44, 72, 20, 9)], -22, 30, 54), circ(30, 66, 22), circ(30, 66, 9), poly([[30, 86], [86, 86], [86, 92], [30, 92]])], { rule: 'evenodd', anim: 'pop' });
  def('crown', 'map', 'تاج', () => [poly([[8, 84], [92, 84], [92, 72], [8, 72]]), poly([[10, 68], [6, 24], [30, 46], [50, 12], [70, 46], [94, 24], [90, 68]]), circ(6, 20, 5), circ(50, 8, 5), circ(94, 20, 5)], { box: [100, 90], anim: 'pop' });
  def('castle', 'map', 'قلعة', () => [poly([[6, 96], [6, 40], [16, 40], [16, 28], [26, 28], [26, 40], [36, 40], [36, 28], [46, 28], [46, 40], [54, 40], [54, 28], [64, 28], [64, 40], [74, 40], [74, 28], [84, 28], [84, 40], [94, 40], [94, 96]]), rect(42, 66, 16, 30, 8)], { rule: 'evenodd', anim: 'slide', dir: 'u' });
  def('tower', 'map', 'برج', () => [poly([[30, 96], [30, 20], [38, 20], [38, 10], [46, 10], [46, 20], [54, 20], [54, 10], [62, 10], [62, 20], [70, 20], [70, 96]]), rect(44, 70, 12, 26, 6)], { rule: 'evenodd', anim: 'slide', dir: 'u' });
  def('mosque', 'map', 'مسجد', () => [svg('M22 96 V60 C22 42 34 32 50 24 C66 32 78 42 78 60 V96 Z'), rect(6, 50, 10, 46, 3), circ(11, 46, 6), rect(84, 50, 10, 46, 3), circ(89, 46, 6), rect(48, 10, 4, 14, 1), { closed: false, pts: arc(50, 10, 6, Math.PI * .1, Math.PI * 1.9).pts }, svg('M42 96 V76 C42 68 46 64 50 62 C54 64 58 68 58 76 V96 Z')], { rule: 'evenodd', anim: 'slide', dir: 'u' });
  def('church', 'map', 'كنيسة', () => [poly([[14, 96], [14, 56], [50, 36], [86, 56], [86, 96]]), poly([[40, 36], [50, 2], [60, 36]]), rect(47, 8, 6, 16, 1), rect(41, 13, 18, 5, 1), svg('M42 96 V74 C42 68 46 64 50 64 C54 64 58 68 58 74 V96 Z')], { rule: 'evenodd', anim: 'slide', dir: 'u' });
  def('scroll', 'map', 'لفافة', () => [rect(14, 14, 72, 72, 2), ell(14, 20, 10, 8), ell(86, 80, 10, 8)], { anim: 'draw', stroke: 1, sw: 4 });
  def('scrollFill', 'map', 'لفافة مصمتة', () => [rect(16, 16, 68, 70, 2), ell(16, 22, 10, 8), ell(84, 80, 10, 8), rect(28, 34, 44, 4, 2), rect(28, 46, 44, 4, 2), rect(28, 58, 30, 4, 2)], { rule: 'evenodd', anim: 'pop' });
  def('hourglass', 'map', 'ساعة رملية', () => [rect(16, 4, 68, 8, 3), rect(16, 88, 68, 8, 3), svg('M24 12 H76 C76 32 60 40 56 50 C60 60 76 68 76 88 H24 C24 68 40 60 44 50 C40 40 24 32 24 12 Z'), svg('M34 18 H66 C64 32 56 38 50 46 C44 38 36 32 34 18 Z')], { rule: 'evenodd', anim: 'pop' });
  def('skull', 'map', 'جمجمة', () => [svg('M50 6 C26 6 12 22 12 44 C12 56 18 64 26 70 V84 H36 V76 H44 V84 H56 V76 H64 V84 H74 V70 C82 64 88 56 88 44 C88 22 74 6 50 6 Z'), ell(34, 46, 10, 11), ell(66, 46, 10, 11), poly([[50, 56], [56, 68], [44, 68]])], { rule: 'evenodd', anim: 'pop' });
  def('shield', 'map', 'درع', () => [svg('M50 4 L92 18 C92 54 76 82 50 96 C24 82 8 54 8 18 Z'), svg('M50 18 L80 28 C80 54 68 74 50 84 C32 74 20 54 20 28 Z')], { rule: 'evenodd', anim: 'pop' });
  def('compass', 'map', 'وردة اتجاهات', () => [star(50, 50, 48, 10, 4), star(50, 50, 30, 8, 4, -Math.PI / 4), circ(50, 50, 6)], { rule: 'evenodd', anim: 'pop' });
  def('bomb', 'map', 'قذيفة', () => [circ(50, 60, 34), rect(42, 14, 16, 14, 3), { closed: false, pts: arc(72, 14, 14, Math.PI, Math.PI * 1.6).pts }], { anim: 'slide', dir: 'u' });
  def('helmet', 'map', 'خوذة', () => [svg('M12 62 C12 32 28 14 50 14 C72 14 88 32 88 62 Z'), rect(6, 62, 88, 10, 5)], { anim: 'pop' });
  def('medal', 'map', 'وسام', () => [poly([[32, 2], [68, 2], [58, 42], [42, 42]]), circ(50, 66, 28), circ(50, 66, 20), star(50, 66, 14, 6, 5)], { rule: 'evenodd', anim: 'slide', dir: 'u' });
  def('frontLine', 'map', 'خط جبهة (مسنن)', () => [poly([[0, 60], [10, 40], [20, 60], [30, 40], [40, 60], [50, 40], [60, 60], [70, 40], [80, 60], [90, 40], [100, 60]], false)], { stroke: 1, sw: 5, box: [100, 30], size: .5, anim: 'draw' });
  def('frontDash', 'map', 'خط جبهة متقطع', () => [line(0, 50, 100, 50)], { stroke: 1, sw: 6, dash: [14, 8], box: [100, 20], size: .5, anim: 'draw' });

  /* ---- UI / data ---- */
  def('progRing', 'ui', 'حلقة تقدم', () => [arc(50, 50, 42, -Math.PI / 2, Math.PI)], { stroke: 1, sw: 10, anim: 'draw' });
  def('progTrack', 'ui', 'مسار حلقة', () => [circ(50, 50, 42)], { stroke: 1, sw: 10, anim: 'none' });
  def('progBar', 'ui', 'شريط تقدم', () => [rect(0, 38, 100, 24, 12)], { box: [100, 30], size: .5, anim: 'draw', stroke: 0 });
  def('barTrack', 'ui', 'مسار شريط', () => [rect(1, 39, 98, 22, 11)], { box: [100, 30], size: .5, stroke: 1, sw: 2, anim: 'none' });
  def('checkbox', 'ui', 'مربع اختيار', () => [rect(4, 4, 92, 92, 16), rect(14, 14, 72, 72, 10), poly([[26, 50], [36, 40], [46, 52], [66, 28], [76, 38], [46, 72]])], { rule: 'evenodd', anim: 'pop' });
  def('check', 'ui', 'علامة صح', () => [poly([[6, 54], [20, 40], [40, 60], [80, 18], [94, 32], [40, 88]])], { anim: 'draw' });
  def('checkStroke', 'ui', 'صح (خط)', () => [poly([[10, 52], [40, 80], [92, 22]], false)], { stroke: 1, sw: 10, anim: 'draw' });
  def('xmark', 'ui', 'علامة خطأ', () => [poly([[10, 10], [90, 90]], false), poly([[90, 10], [10, 90]], false)], { stroke: 1, sw: 10, anim: 'draw' });
  def('play', 'ui', 'زر تشغيل', () => [circ(50, 50, 48), poly([[38, 28], [74, 50], [38, 72]])], { rule: 'evenodd', anim: 'pop' });
  def('playTri', 'ui', 'مثلث تشغيل', () => [...svg('M22 10 C22 6 26 4 30 6 L86 46 C90 48 90 52 86 54 L30 94 C26 96 22 94 22 90 Z')], { anim: 'pop' });
  def('pause', 'ui', 'إيقاف مؤقت', () => [rect(14, 8, 26, 84, 8), rect(60, 8, 26, 84, 8)], { anim: 'pop' });
  def('divider', 'ui', 'خط فاصل', () => [line(0, 50, 100, 50)], { stroke: 1, sw: 4, box: [100, 10], size: .6, anim: 'draw' });
  def('dividerDot', 'ui', 'فاصل منقط', () => [line(0, 50, 100, 50)], { stroke: 1, sw: 5, dash: [0.1, 7], cap: 'round', box: [100, 10], size: .6, anim: 'draw' });
  def('dividerDiamond', 'ui', 'فاصل بمعيّن', () => [line(0, 50, 40, 50), poly([[50, 30], [60, 50], [50, 70], [40, 50]]), line(60, 50, 100, 50)], { stroke: 1, sw: 2, box: [100, 16], size: .6, anim: 'draw' });
  def('bracketL', 'ui', 'قوس يسار [', () => [poly([[70, 4], [30, 4], [30, 96], [70, 96]], false)], { stroke: 1, sw: 6, box: [60, 100], anim: 'draw' });
  def('bracketR', 'ui', 'قوس يمين ]', () => [poly([[30, 4], [70, 4], [70, 96], [30, 96]], false)], { stroke: 1, sw: 6, box: [60, 100], anim: 'draw' });
  def('corners', 'ui', 'زوايا تركيز', () => [poly([[4, 30], [4, 4], [30, 4]], false), poly([[70, 4], [96, 4], [96, 30]], false), poly([[96, 70], [96, 96], [70, 96]], false), poly([[30, 96], [4, 96], [4, 70]], false)], { stroke: 1, sw: 5, anim: 'pop' });
  def('swoosh', 'ui', 'تسطير منحنٍ', () => [{ closed: false, pts: [A(2, 60, 0, 0, 30, -16), A(98, 44, -30, 8)] }], { stroke: 1, sw: 6, box: [100, 30], size: .45, anim: 'draw' });
  def('swoosh2', 'ui', 'تسطير مزدوج', () => [{ closed: false, pts: [A(2, 40, 0, 0, 30, -14), A(98, 32, -30, 6)] }, { closed: false, pts: [A(14, 66, 0, 0, 30, -12), A(90, 58, -30, 6)] }], { stroke: 1, sw: 5, box: [100, 30], size: .45, anim: 'draw' });
  def('underline', 'ui', 'تسطير يدوي', () => [wobble(smooth([[2, 50], [30, 44], [60, 54], [98, 46]], false), 3, 12)], { stroke: 1, sw: 6, box: [100, 24], size: .45, anim: 'draw' });
  def('highlighter', 'ui', 'قلم تظليل', () => [wobble({ closed: true, pts: [A(2, 30, 0, 0, 20, -6), A(98, 24, -20, 0, 0, 8), A(96, 72, 0, -8, -20, 4), A(4, 78, 20, 0, 0, -10)] }, 2, 8)], { box: [100, 36], size: .5, anim: 'draw' });
  def('scribble', 'ui', 'دائرة مرسومة باليد', () => { const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 15 * Math.PI * 2.15; pts.push([50 + Math.cos(t) * (46 - i * .6), 50 + Math.sin(t) * (34 + i * .4)]); } return [wobble(smooth(pts, false), 2, 6)]; }, { stroke: 1, sw: 5, box: [100, 80], anim: 'draw' });
  def('plus', 'ui', 'زائد', () => [poly([[40, 6], [60, 6], [60, 40], [94, 40], [94, 60], [60, 60], [60, 94], [40, 94], [40, 60], [6, 60], [6, 40], [40, 40]])], { anim: 'pop' });
  def('minus', 'ui', 'ناقص', () => [rect(6, 40, 88, 20, 10)], { anim: 'pop' });
  def('dots3', 'ui', 'ثلاث نقاط', () => [circ(16, 50, 12), circ(50, 50, 12), circ(84, 50, 12)], { box: [100, 30], anim: 'pulse' });
  def('slider', 'ui', 'منزلق', () => [rect(0, 44, 100, 12, 6), circ(62, 50, 14)], { box: [100, 30], size: .5, anim: 'slide', dir: 'l' });
  def('toggle', 'ui', 'مفتاح تبديل', () => [rect(2, 20, 96, 60, 30), circ(68, 50, 22)], { rule: 'evenodd', box: [100, 60], anim: 'pop' });
  def('quote', 'ui', 'علامة اقتباس', () => { const q = [circ(28, 60, 18), ...svg('M46 60 C46 34 36 22 20 14 L24 6 C50 16 60 36 60 60 Z')]; return [...q, ...move(q, 44, 0)]; }, { box: [100, 70], anim: 'pop' });

  /* ---- frames & masks (box 160×90, cover the frame; sub-path `mask` is the window) ---- */
  const FR = { box: [160, 90], cover: 1, rule: 'evenodd', anim: 'none', size: 1, mask: 1, color: '#0a0a0a' };
  def('frameCircle', 'frame', 'إطار دائري', () => [rect(0, 0, 160, 90), circ(80, 45, 40)], FR);
  def('frameOval', 'frame', 'إطار بيضوي (فينييت)', () => [rect(0, 0, 160, 90), ell(80, 45, 68, 38)], FR);
  def('frameRound', 'frame', 'إطار مستدير', () => [rect(0, 0, 160, 90), rect(10, 6, 140, 78, 8)], FR);
  def('frameSquare', 'frame', 'إطار مربع', () => [rect(0, 0, 160, 90), rect(42, 7, 76, 76)], FR);
  def('frameLetterbox', 'frame', 'شرائط سينمائية', () => [rect(0, 0, 160, 90), rect(0, 11, 160, 68)], FR);
  def('frameTorn', 'frame', 'ورقة ممزقة', () => { const r = GW.rng(21); const pts = []; for (let x = 14; x <= 146; x += 6) pts.push([x, 10 + (r() - .5) * 5]); for (let y = 14; y <= 76; y += 6) pts.push([146 + (r() - .5) * 5, y]); for (let x = 146; x >= 14; x -= 6) pts.push([x, 80 + (r() - .5) * 5]); for (let y = 76; y >= 14; y -= 6) pts.push([14 + (r() - .5) * 5, y]); return [rect(0, 0, 160, 90), poly(pts)]; }, FR);
  def('frameFilm', 'frame', 'شريط فيلم', () => { const g = [rect(0, 0, 160, 90), rect(14, 14, 132, 62, 2)]; for (let x = 6; x < 160; x += 12) { g.push(rect(x, 4, 7, 6, 1.5)); g.push(rect(x, 80, 7, 6, 1.5)); } return g; }, FR);
  def('frameHex', 'frame', 'إطار سداسي', () => [rect(0, 0, 160, 90), regular(80, 45, 44, 6)], FR);
  def('frameArch', 'frame', 'إطار قوس', () => [rect(0, 0, 160, 90), svg('M44 84 V44 C44 24 60 10 80 10 C100 10 116 24 116 44 V84 Z')], FR);
  def('frameDiamond', 'frame', 'إطار معيّن', () => [rect(0, 0, 160, 90), poly([[80, 2], [124, 45], [80, 88], [36, 45]])], FR);
  def('frameScallop', 'frame', 'إطار مسنن', () => [rect(0, 0, 160, 90), star(80, 45, 42, 38, 18)], FR);
  def('frameSplit', 'frame', 'شاشة مقسومة', () => [rect(0, 0, 160, 90), rect(4, 4, 74, 82, 4), rect(82, 4, 74, 82, 4)], Object.assign({}, FR, { mask: 1 }));
  def('framePolaroid', 'frame', 'إطار صورة فورية', () => [rect(0, 0, 160, 90), rect(50, 6, 60, 60, 1)], FR);
  def('frameCorner', 'frame', 'إطار بزوايا', () => [rect(0, 0, 160, 90), poly([[20, 6], [140, 6], [152, 18], [152, 72], [140, 84], [20, 84], [8, 72], [8, 18]])], FR);

  /* ---- Shorts stickers ---- */
  def('subscribe', 'shorts', 'زر اشتراك', () => [rect(0, 20, 100, 60, 30)], { box: [100, 50], size: .5, at: [.5, .78], anim: 'pop', text: { str: 'اشترك', size: .5, color: '#ffffff' }, color: '#d6202f' });
  def('bell', 'shorts', 'جرس التنبيه', () => [svg('M50 6 C54 6 57 9 57 13 V16 C70 20 78 32 78 48 V66 L88 78 H12 L22 66 V48 C22 32 30 20 43 16 V13 C43 9 46 6 50 6 Z'), circ(50, 88, 9)], { anim: 'pop' });
  def('like', 'shorts', 'إعجاب (إبهام)', () => [svg('M30 44 H44 L50 20 C52 12 60 10 64 16 C66 20 65 26 64 30 L61 44 H84 C90 44 94 50 92 56 L84 86 C83 90 79 94 74 94 H30 Z'), rect(8, 44, 18, 50, 4)], { anim: 'pop' });
  def('heartSt', 'shorts', 'قلب إعجاب', () => svg('M50 90 C20 68 6 54 6 34 C6 18 18 8 30 8 C40 8 47 14 50 22 C53 14 60 8 70 8 C82 8 94 18 94 34 C94 54 80 68 50 90 Z'), { anim: 'pulse', color: '#e0245e' });
  def('comment', 'shorts', 'تعليق', () => [svg('M20 8 H80 C90 8 96 14 96 24 V56 C96 66 90 72 80 72 H42 L22 90 V72 H20 C10 72 4 66 4 56 V24 C4 14 10 8 20 8 Z'), circ(32, 40, 6), circ(50, 40, 6), circ(68, 40, 6)], { rule: 'evenodd', anim: 'pop' });
  def('share', 'shorts', 'مشاركة', () => [svg('M56 10 L94 44 L56 78 V58 C36 58 20 64 6 84 C10 54 28 32 56 30 Z')], { anim: 'slide', dir: 'l' });
  def('follow', 'shorts', 'متابعة (+)', () => [circ(50, 50, 48), poly([[42, 22], [58, 22], [58, 42], [78, 42], [78, 58], [58, 58], [58, 78], [42, 78], [42, 58], [22, 58], [22, 42], [42, 42]])], { rule: 'evenodd', anim: 'pop' });
  def('swipeUp', 'shorts', 'اسحب لأعلى (ملصق)', () => [poly([[26, 44], [50, 20], [74, 44]], false), poly([[26, 70], [50, 46], [74, 70]], false), rect(44, 74, 12, 20, 6)], { stroke: 1, sw: 8, anim: 'slide', dir: 'd' });
  def('countdown', 'shorts', 'حلقة عد تنازلي', () => [circ(50, 50, 46), circ(50, 50, 36), arc(50, 50, 41, -Math.PI / 2, Math.PI * 1.1)], { stroke: 1, sw: 4, anim: 'draw' });
  def('tap', 'shorts', 'إصبع نقر', () => [svg('M40 94 C30 94 22 86 20 74 L14 54 C13 50 16 46 20 46 C24 46 26 48 28 52 L32 60 V22 C32 17 36 14 40 14 C44 14 48 17 48 22 V46 C48 43 52 41 56 42 C59 43 61 46 61 49 C61 46 65 44 69 45 C72 46 74 49 74 52 C74 50 78 48 82 50 C85 52 86 55 86 58 V74 C86 86 78 94 68 94 Z')], { anim: 'pop' });
  def('record', 'shorts', 'تسجيل (نقطة)', () => [circ(50, 50, 48), circ(50, 50, 40), circ(50, 50, 26)], { rule: 'evenodd', anim: 'pulse', color: '#e5484d' });
  def('newBurst', 'shorts', 'ملصق جديد', () => [star(50, 50, 48, 38, 12, .2)], { anim: 'pop', color: '#ffd400', text: { str: 'جديد', size: .32, color: '#111111' } });
  def('sparkle', 'shorts', 'لمعة', () => [{ closed: true, pts: [A(50, 2, 0, 0, 4, 30), A(98, 50, -30, -4, -30, 4), A(50, 98, 4, -30, -4, -30), A(2, 50, 30, 4, 30, -4)] }, scale([{ closed: true, pts: [A(50, 2, 0, 0, 4, 30), A(98, 50, -30, -4, -30, 4), A(50, 98, 4, -30, -4, -30), A(2, 50, 30, 4, 30, -4)] }], .4, 50, 50)[0]], { anim: 'pulse', color: '#ffd400' });
  def('sparkles', 'shorts', 'لمعات', () => { const sp = (cx, cy, r) => ({ closed: true, pts: [A(cx, cy - r, 0, 0, r * .08, r * .6), A(cx + r, cy, -r * .6, -r * .08, -r * .6, r * .08), A(cx, cy + r, r * .08, -r * .6, -r * .08, -r * .6), A(cx - r, cy, r * .6, r * .08, r * .6, -r * .08)] }); return [sp(36, 42, 36), sp(80, 22, 16), sp(82, 76, 12)]; }, { anim: 'pulse', color: '#ffd400' });
  def('speechNew', 'shorts', 'فقاعة ملصق', () => [rect(4, 6, 92, 62, 31), poly([[30, 66], [22, 94], [50, 68]])], { anim: 'pop', color: '#ffffff' });
  def('eye', 'shorts', 'عين (مشاهدات)', () => [{ closed: true, pts: [A(2, 50, 0, 0, 26, -34), A(98, 50, -26, -34, -26, 34), A(2, 50, 26, 34)] }, circ(50, 50, 18), circ(50, 50, 8)], { rule: 'evenodd', anim: 'pop' });

  /* ================= geometry → polylines for shape.js ================= */
  // map design units into center/size (px), rotate; returns [{pts, closed}] sampled
  L.anchorsPx = (it, c, sz, a) => {
    const [W, H] = it.box; const kx = sz[0] / W, ky = sz[1] / H; const cs = Math.cos(a || 0), sn = Math.sin(a || 0);
    const m = (x, y) => { const dx = (x - W / 2) * kx, dy = (y - H / 2) * ky; return a ? [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs] : [c[0] + dx, c[1] + dy]; };
    return L.geom(it).map(s => ({ closed: s.closed, pts: s.pts.map(p => { const q = m(p[0], p[1]), i = m(p[0] + p[2], p[1] + p[3]), o = m(p[0] + p[4], p[1] + p[5]); return [q[0], q[1], i[0] - q[0], i[1] - q[1], o[0] - q[0], o[1] - q[1]]; }) }));
  };
  L.polylines = (sh, c, sz, a, rd) => { const it = L.get(sh.lib && sh.lib.id); if (!it) return []; return L.anchorsPx(it, c, sz, a).map(s => GW.Shape.sample(s.pts, s.closed, rd)).filter(Boolean); };
  L.anchors = (sh, lt) => { const it = L.get(sh.lib && sh.lib.id); if (!it) return null; return L.anchorsPx(it, GW.pv(sh.center, lt), GW.pv(sh.size, lt), (GW.pv(sh.rot, lt) || 0) * Math.PI / 180); };

  /* ================= building a shape object for an item ================= */
  // default pixel size of an item for a w×h frame
  L.sizeFor = (it, w, h, frac) => { if (it.cover) return [w, h]; const f = frac || it.size || .3; const L0 = f * Math.min(w, h); const [bw, bh] = it.box; const m = Math.max(bw, bh); return [Math.round(L0 * bw / m), Math.round(L0 * bh / m)]; };
  // apply a fill style ('accent' | 'white' | … | 'outline') to a shape object; strokeOnly items always draw as strokes
  L.applyStyle = (sh, style, it) => {
    const col = L.styleColor(style); const strokeOnly = !!(it && it.stroke && !it.fill);
    if (style === 'outline' || strokeOnly) { sh.fill.on = 0; sh.stroke.on = 1; sh.stroke.color = P(col); }
    else { sh.fill.on = 1; sh.fill.color = P(it && it.color && style === 'accent' ? it.color : col); sh.stroke.on = 0; }
    if (it && it.dash) { sh.stroke.dash = P(it.dash[0] * sh._k); sh.stroke.gap = P(it.dash[1] * sh._k); } if (it && it.cap) sh.stroke.cap = it.cap;
  };
  // per-item default animation on a shape object (dur = clip duration)
  L.animate = (sh, kind, dur, it, dir) => {
    const d = Math.min(1.1, Math.max(.3, dur * .3)); const sz = sh.size.v.slice(), ctr = sh.center.v.slice();
    if (kind === 'draw') {
      if (!sh.stroke.on) { sh.stroke.on = 1; sh.stroke.color = P(GW.pv(sh.fill.color, 0)); sh.stroke.width = P(Math.max(2, Math.round((it ? it.sw || 4 : 4) * sh._k * .8))); }
      sh.trim.end = { v: 100, k: [{ t: 0, v: 0, e: 'ease' }, { t: d, v: 100, e: 'ease' }] };
      if (sh.fill.on) sh.fill.opacity = { v: 100, k: [{ t: 0, v: 0, e: 'linear' }, { t: d * .75, v: 0, e: 'linear' }, { t: Math.min(dur, d * 1.4), v: 100, e: 'linear' }] };
    } else if (kind === 'pop') {
      sh.size = { v: sz, k: [{ t: 0, v: [0, 0], e: 'ease' }, { t: d * .6, v: [sz[0] * 1.14, sz[1] * 1.14], e: 'ease' }, { t: d, v: sz, e: 'ease' }] };
    } else if (kind === 'slide') {
      const off = Math.max(sz[0], sz[1]) * .6; const dd = dir || (it && it.dir) || 'd'; const from = [ctr[0] + (dd === 'l' ? -off : dd === 'r' ? off : 0), ctr[1] + (dd === 'u' ? -off : dd === 'd' ? off : 0)];
      sh.center = { v: ctr, k: [{ t: 0, v: from, e: 'ease' }, { t: d, v: ctr, e: 'ease' }] };
      sh.fill.opacity = { v: 100, k: [{ t: 0, v: 0, e: 'linear' }, { t: d * .6, v: 100, e: 'linear' }] }; sh.stroke.opacity = { v: 100, k: [{ t: 0, v: 0, e: 'linear' }, { t: d * .6, v: 100, e: 'linear' }] };
    } else if (kind === 'pulse') {
      const k = []; for (let t = 0; t < dur - .05; t += .9) { k.push({ t, v: sz, e: 'ease' }); k.push({ t: Math.min(dur, t + .45), v: [sz[0] * 1.08, sz[1] * 1.08], e: 'ease' }); } k.push({ t: dur, v: sz, e: 'ease' });
      sh.size = { v: sz, k };
    }
  };
  // build a shape object (shape.js model) for item `it` in a w×h frame
  L.makeShape = (it, w, h, o = {}) => {
    const sh = GW.Shape.defaults('lib', { w, h }, {}); sh.lib = { id: it.id }; if (it.rule) sh.rule = it.rule;
    const size = o.size || L.sizeFor(it, w, h, o.frac); sh.size = P(size); sh._k = Math.max(size[0], size[1]) / 100;
    sh.center = P(o.center || (it.cover ? [w / 2, h / 2] : [Math.round(w * (it.at ? it.at[0] : .5)), Math.round(h * (it.at ? it.at[1] : .5))])); sh.rot = P(o.rot != null ? o.rot : it.rot || 0);
    sh.stroke.width = P(Math.max(1.5, Math.round((it.sw || 6) * sh._k * .8)));
    L.applyStyle(sh, o.style || L.state.style, it); if (o.color) { sh.fill.color = P(o.color); sh.stroke.color = P(o.color); }
    const anim = o.anim === undefined ? (L.state.anim ? it.anim : 'none') : o.anim; if (anim && anim !== 'none') L.animate(sh, anim, o.dur || 5, it, o.dir);
    delete sh._k; return sh;
  };
  L.state = { style: 'accent', anim: true, cat: 'all', q: '' };

  /* ================= insert into the sequence ================= */
  const freeTrack = (s, t, dur, from) => { for (let i = from || 0; i < s.vt.length; i++) { if (s.vt[i].lock) continue; if (!s.clips.some(c => c.tt === 'v' && c.ti === i && c.start < t + dur && c.start + c.dur > t)) return i; } GW.ops.ensureTrack(s, 'v', s.vt.length); return s.vt.length - 1; };
  L.add = (id, o = {}) => {
    const it = L.get(id); if (!it) return null; const s = GW.seq(); const dur = o.dur || 5;
    const sh = L.makeShape(it, s.w, s.h, Object.assign({ dur }, o));
    const c = GW.Shape.add('lib', { lib: id, start: o.start, dur, ti: o.ti, name: o.name || it.n, insert: o.insert, rule: it.rule }); if (!c) return null;
    c.shape = sh; c.name = o.name || it.n;
    if (it.text && o.text !== false) { // stamps / stickers: a text clip rides on a free track above the shape
      const ti = freeTrack(s, c.start, dur, c.ti + 1); GW.ops.ensureTrack(s, 'v', ti); const sz = GW.pv(sh.size, 0), ctr = GW.pv(sh.center, 0);
      const stamp = it.id.startsWith('stamp'); const ink = stamp ? (sh.fill.on ? GW.pv(sh.fill.color, 0) : GW.pv(sh.stroke.color, 0)) : (it.text.color || '#ffffff');
      if (stamp) { sh.fill.on = 0; sh.stroke.on = 1; sh.stroke.color = P(ink); sh.stroke.width = P(Math.max(2, Math.round(sz[1] * .035))); }
      const t = GW.newClip('text', { ti, start: c.start, dur, name: it.text.str });
      Object.assign(t.text, { str: it.text.str, size: Math.round(sz[1] * (it.text.size || .5)), color: ink, weight: 900, align: 'center', bg: 0, stroke: 0, shadow: 0, animIn: 'none', animOut: 'none' });
      t.motion.pos = P([Math.round(ctr[0]), Math.round(ctr[1])]); t.motion.rot = P(GW.pv(sh.rot, 0));
      GW.ops.clear(s, 'v', ti, c.start, c.start + dur); s.clips.push(t);
      GW.hist.labels[GW.hist.idx] = 'إدراج شكل: ' + it.n; GW.bus.emit('hist');
    }
    GW.invalidate(); GW.bus.emit('selection'); return c;
  };
  // frames: the item's window sub-path becomes a 'path' mask on the selected (or given) clip
  L.addMask = (id, clip) => {
    const it = L.get(id); if (!it) return null; const s = GW.seq();
    const c = clip || [...GW.sel.clips].map(x => GW.clipById(x)).find(x => x && x.tt === 'v' && x.kind !== 'shape'); if (!c) { GW.toast('حدد مقطع فيديو أو صورة أولًا لإدراج القناع عليه'); return null; }
    const W = c.sw || s.w, H = c.sh || s.h; const geom = L.geom(it); const idx = it.mask != null ? it.mask : geom.length - 1; const sub = geom[idx] || geom[0];
    const [bw, bh] = it.box; const kx = W / bw, ky = H / bh; const pl = GW.Shape.sample(sub.pts.map(p => [p[0] * kx, p[1] * ky, p[2] * kx, p[3] * ky, p[4] * kx, p[5] * ky]), true, 0);
    const pts = pl.pts.filter((p, i) => i % 2 === 0 || pl.pts.length < 40).map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    const mk = { id: GW.uid(), type: 'path', on: 1, mode: 'add', inv: 0, feather: P(0), opacity: P(100), expansion: P(0), pts: P(pts), center: P([W / 2, H / 2]), size: P([W, H]), rot: P(0), name: it.n };
    c.masks = c.masks || []; c.masks.push(mk); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.sel.mask = mk.id; GW.commit('قناع من المكتبة: ' + it.n); GW.bus.emit('selection'); GW.invalidate(); return mk;
  };
  L.applyStyleTo = (c, style) => { if (!c || c.kind !== 'shape') return; const it = c.shape.lib && L.get(c.shape.lib.id); const sz = GW.pv(c.shape.size, 0); c.shape._k = Math.max(sz[0], sz[1]) / 100; L.applyStyle(c.shape, style, it); delete c.shape._k; GW.commit('نمط التعبئة'); GW.invalidate(); };

  /* ================= thumbnails / previews ================= */
  // draw item into a canvas (w×h) at local time lt of a dur-second preview; animated according to the item's default
  L.thumb = (cv, it, lt, o = {}) => {
    const g = cv.getContext('2d'); const w = cv.width, h = cv.height; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#1d2026'); bg.addColorStop(1, '#101114'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const key = (o.style || L.state.style) + '|' + (o.anim == null ? L.state.anim : o.anim) + '|' + w + 'x' + h; let sh = it._th && it._thKey === key ? it._th : null;
    if (!sh) { const fit = it.cover ? [w, h] : (() => { const [bw, bh] = it.box; const k = Math.min(w * .72 / bw, h * .72 / bh); return [bw * k, bh * k]; })(); sh = L.makeShape(it, w, h, { size: fit, center: [w / 2, h / 2], dur: 2.4, anim: (o.anim == null ? L.state.anim : o.anim) ? undefined : 'none', style: o.style, rot: 0 }); if (it.cover) { sh.fill.color = P('#0c0c0c'); sh.fill.on = 1; } it._th = sh; it._thKey = key; }
    if (it.cover) { g.save(); g.fillStyle = '#3b4654'; const r = GW.rng(13); for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${200 + r() * 40},30%,${30 + r() * 30}%)`; g.fillRect(r() * w, r() * h, w * .12, h * .12); } g.restore(); }
    g.save(); try { GW.Shape.paint(g, sh, lt == null ? 2 : lt); } catch (e) { console.error('shape thumb', it.id, e); } g.restore();
  };
  let hoverStop = null;
  L.renderBrowser = (outer) => {
    const S = L.state; const root = document.createElement('div'); root.className = 'shl'; outer.append(root);
    const top = document.createElement('div'); top.className = 'shl-top';
    const q = document.createElement('input'); q.className = 'inp'; q.placeholder = 'ابحث في الأشكال…'; q.value = S.q; q.oninput = () => { S.q = q.value.trim(); grid(); }; q.onkeydown = e => e.stopPropagation(); top.append(q);
    const anim = document.createElement('label'); anim.className = 'shl-anim'; anim.title = 'حركة دخول تلقائية حسب نوع الشكل (رسم تدريجي / نبض / انزلاق)'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!S.anim; cb.onchange = () => { S.anim = cb.checked; grid(); }; anim.append(cb, document.createTextNode(' حركة تلقائية')); top.append(anim);
    root.append(top);
    const sw = document.createElement('div'); sw.className = 'shl-styles'; const swT = document.createElement('span'); swT.textContent = 'أنماط التعبئة'; sw.append(swT);
    for (const [k, n, col] of L.STYLES) { const b = document.createElement('button'); b.className = 'shl-sw' + (S.style === k ? ' on' : ''); b.title = n; b.dataset.style = k; if (k === 'outline') b.classList.add('outline'); else b.style.background = col || 'var(--accent)'; b.onclick = () => { S.style = k; sw.querySelectorAll('.shl-sw').forEach(x => x.classList.toggle('on', x === b)); grid(); const sel = [...GW.sel.clips].map(x => GW.clipById(x)).filter(x => x && x.kind === 'shape'); if (sel.length) { sel.forEach(c => L.applyStyleTo(c, k)); GW.toast('طُبّق النمط على ' + sel.length + ' شكل'); } }; sw.append(b); }
    root.append(sw);
    const cats = document.createElement('div'); cats.className = 'mg-cats';
    for (const [k, n] of L.CATS) { const b = document.createElement('button'); b.className = 'chip' + (S.cat === k ? ' on' : ''); b.textContent = n; b.dataset.cat = k; b.onclick = () => { S.cat = k; cats.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); grid(); }; cats.append(b); }
    root.append(cats);
    const g = document.createElement('div'); g.className = 'eg-grid shl-grid'; root.append(g);
    const hint = document.createElement('div'); hint.className = 'shl-hint'; hint.textContent = 'انقر للإدراج عند مؤشر التشغيل · زر الفأرة الأيمن: إدراج كقناع على المقطع المحدد'; root.append(hint);
    const grid = () => {
      g.innerHTML = ''; const qq = S.q.toLowerCase(); const list = L.items.filter(it => (S.cat === 'all' || it.cat === S.cat) && (!qq || it.n.toLowerCase().includes(qq) || it.id.toLowerCase().includes(qq) || (L.CATS.find(c => c[0] === it.cat) || [])[1].includes(qq)));
      if (!list.length) { g.innerHTML = '<div class="empty">لا توجد أشكال مطابقة</div>'; return; }
      for (const it of list) g.append(card(it));
    };
    const card = (it) => {
      const card = document.createElement('div'); card.className = 'eg-card shl-card'; card.dataset.sid = it.id; card.title = it.n + ' — انقر للإدراج عند مؤشر التشغيل';
      const cv = document.createElement('canvas'); cv.width = 240; cv.height = 135; const cap = document.createElement('div'); cap.textContent = it.n; card.append(cv, cap);
      const still = () => L.thumb(cv, it, 2); still();
      card.onmouseenter = () => { if (hoverStop) hoverStop(); let run = true; const t0 = performance.now(); const loop = () => { if (!run || !cv.isConnected) return; L.thumb(cv, it, ((performance.now() - t0) / 1000) % 2.2); requestAnimationFrame(loop); }; hoverStop = () => { run = false; still(); hoverStop = null; }; loop(); };
      card.onmouseleave = () => { if (hoverStop) hoverStop(); };
      card.onclick = () => { const c = L.add(it.id); if (c) GW.toast('أُدرج «' + it.n + '» عند مؤشر التشغيل'); };
      card.oncontextmenu = (e) => { e.preventDefault(); const items = [{ label: 'إدراج عند مؤشر التشغيل', action: () => L.add(it.id) }];
        if (L.geom(it).some(s => s.closed)) items.push({ label: 'إدراج كقناع على المقطع المحدد', action: () => L.addMask(it.id) });
        items.push({ label: 'إدراج بدون حركة', action: () => L.add(it.id, { anim: 'none' }) }); GW.menu(e.clientX, e.clientY, items); };
      card.draggable = true; card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'shape:' + it.id); e.dataTransfer.effectAllowed = 'copy'; });
      return card;
    };
    grid();
  };

  /* ================= map marker pictograms (atlas/vector.js) ================= */
  const iconCache = {};
  L.mapIcons = () => L.items.filter(it => it.cat === 'map' || it.cat === 'basic' || it.cat === 'shorts').filter(it => !it.text && !it.cover).map(it => ['lib:' + it.id, 'مكتبة: ' + it.n]);
  // draw at origin in a 24-unit space (same contract as the built-in vector icons): fill + dark outline
  L.icon = (ctx, id, color) => {
    const it = L.get(id); if (!it) return false;
    let e = iconCache[id]; if (!e) { const [bw, bh] = it.box; const k = 22 / Math.max(bw, bh); const path = new Path2D(); for (const s of L.anchorsPx(it, [0, 0], [bw * k, bh * k], 0)) { const pl = GW.Shape.sample(s.pts, s.closed, 0); if (!pl) continue; pl.pts.forEach((p, i) => i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])); if (pl.closed) path.closePath(); } e = iconCache[id] = { path, stroke: !!(it.stroke && !it.fill), rule: it.rule === 'evenodd' ? 'evenodd' : 'nonzero', sw: Math.max(1.2, (it.sw || 6) * k * .5) }; }
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (e.stroke) { ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = e.sw + 2; ctx.stroke(e.path); ctx.shadowBlur = 0; ctx.strokeStyle = color; ctx.lineWidth = e.sw; ctx.stroke(e.path); }
    else { ctx.fillStyle = color; ctx.fill(e.path, e.rule); ctx.shadowBlur = 0; ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke(e.path); }
    return true;
  };

  /* ================= API helpers ================= */
  L.list = () => L.items.map(it => ({ id: it.id, name: it.n, category: it.cat, anim: it.anim, strokeOnly: !!(it.stroke && !it.fill), frame: !!it.cover, box: it.box }));

  // Graphics menu entry
  GW.bus.on('ready', () => {
    const e = GW.MENUS && GW.MENUS.find(m => m[0] === 'رسومات'); if (!e || e._shl) return; const f = e[1]; e._shl = 1;
    e[1] = () => { const items = f(); items.push({ label: 'مكتبة الأشكال…', action: () => GW.UI.egTab && GW.UI.egTab('shapes') }); return items; };
  });
  const css = document.createElement('style'); css.textContent = `
.shl{direction:rtl}
.shl-top{display:flex;gap:8px;align-items:center;padding:8px 8px 0}
.shl-top .inp{flex:1;min-width:0}
.shl-anim{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2,#bbb);white-space:nowrap;cursor:pointer}
.shl-styles{display:flex;gap:6px;align-items:center;padding:8px 8px 0;flex-wrap:wrap}
.shl-styles span{font-size:11px;color:var(--mute);margin-inline-end:2px}
.shl-sw{width:20px;height:20px;border-radius:10px;border:2px solid var(--line3,#3a3a3a);cursor:pointer;padding:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35)}
.shl-sw.outline{background:transparent;border:2px dashed var(--text2,#bbb)}
.shl-sw.on{border-color:var(--accent);outline:2px solid var(--accent);outline-offset:1px}
.shl-grid{grid-template-columns:repeat(3,1fr);gap:6px}
.shl-card{position:relative;transition:border-color .12s}
.shl-card:hover{border-color:var(--accent)}
.shl-card div{font-size:10.5px;padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
.shl-hint{color:var(--mute);font-size:10.5px;padding:4px 10px 10px}`;
  document.head.append(css);
})();
