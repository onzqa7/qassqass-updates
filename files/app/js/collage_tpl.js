'use strict';
/* أسلوب الكولاج — Essential Graphics templates (category «كولاج»): procedural paper backgrounds (kraft, newsprint, notebook,
   cardboard, graph, black), tape strips, torn paper scraps, stamps, hand-drawn scribbles with draw-on, polaroid frame,
   newspaper clipping, «ملف سري» folder, map scrap, and full collage scenes (person cut-out over newspaper, archival photo stack,
   «لوحة تحقيق» with strings, secret file, map scrap, ransom-note quote, torn title, scrap timeline, face-off).
   Templates are ordinary GW.MG templates (text clips with c.text.mg), so they get thumbnails, fields, duration, keyframes and export.
   Image fields (t:'img') hold a project media id; with none set a halftone silhouette placeholder is drawn.
   Everything animates on «twos» (fps field) with seeded jitter for the stop-motion look. */
(function () {
  const MG = GW.MG; if (!MG) return; const { clamp } = GW; const E = MG.E;
  const tr = (s) => (GW.tr ? GW.tr(s) : s);
  const def = (o) => { o.cat = 'collage'; MG.list.push(o); MG.by[o.id] = o; };
  if (!MG.CATS.some(c => c[0] === 'collage')) MG.CATS.push(['collage', 'كولاج']);
  const U = (W, H) => Math.min(W, H) / 1080;
  const seg = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a), 0, 1);
  const outro = (t, dur, len) => E.io(clamp((dur - t) / (len || .4), 0, 1));
  const hsh = (a, b, c) => { const x = Math.sin(a * 127.1 + b * 311.7 + (c || 0) * 74.7) * 43758.5453; return x - Math.floor(x); };
  const vn = (x, y, s) => { const i = Math.floor(x), j = Math.floor(y), f = x - i, h = y - j; const u = f * f * (3 - 2 * f), v = h * h * (3 - 2 * h); const a = hsh(i, j, s), b = hsh(i + 1, j, s), c = hsh(i, j + 1, s), d = hsh(i + 1, j + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const fbm = (x, y, s) => (vn(x, y, s) * .5 + vn(x * 2.1, y * 2.1, s + 3) * .25 + vn(x * 4.3, y * 4.3, s + 7) * .125) / .875;
  const C = GW.CollageTpl = {};
  // stop-motion time: quantised to fps («on twos») + per-hold jitter
  const hold = (t, fps) => fps > 0 ? Math.floor(t * fps + 1e-6) / fps : t;
  const jit = (t, fps, seed, amp) => { if (!(fps > 0)) return [0, 0, 0]; const k = Math.floor(t * fps + 1e-6); return [(hsh(k, seed, 1) - .5) * 2 * amp, (hsh(k, seed, 2) - .5) * 2 * amp, (hsh(k, seed, 3) - .5) * 2 * amp * .25]; };
  const FPS = { k: 'fps', n: 'إطارات الحركة (ستوب موشن)', t: 'sel', def: '12', opts: [['0', 'ناعمة'], ['8', '8 إطارات'], ['10', '10 إطارات'], ['12', '12 إطارًا']] };
  const tF = (k, n, d, o = {}) => ({ k, n, t: 'text', def: d, ...o });
  const cF = (k, n, d) => ({ k, n, t: 'color', def: d });
  const nF = (k, n, d, min, max, step, unit) => ({ k, n, t: 'num', def: d, min, max, step: step || 1, unit: unit || '' });
  const sF = (k, n, d, opts) => ({ k, n, t: 'sel', def: d, opts });
  const iF = (k, n) => ({ k, n, t: 'img', def: '' });
  const PAPERS = [['kraft', 'ورق كرافت'], ['news', 'ورق صحيفة'], ['notebook', 'دفتر مسطر'], ['cardboard', 'كرتون'], ['grid', 'ورق مربعات'], ['black', 'ورق أسود'], ['parchment', 'رق قديم']];
  const pos = (F, W, H) => [F.x / 100 * W, F.y / 100 * H];

  /* ---------------- procedural paper textures (cached 512² tiles) ---------------- */
  const TEX = {};
  C.paperTile = (kind) => {
    if (TEX[kind]) return TEX[kind]; const S = 512; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const base = { kraft: [176, 138, 96], news: [228, 222, 204], notebook: [244, 241, 232], cardboard: [168, 124, 78], grid: [240, 238, 230], black: [30, 29, 28], parchment: [222, 200, 156] }[kind] || [230, 225, 210];
    const im = g.createImageData(S, S); const sd = kind.length * 13;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // tileable: blend noise sampled on a torus-ish wrap
      const fx = x / S, fy = y / S; const nb = (sx, sy) => fbm(sx, sy, sd);
      const n0 = nb(fx * 6, fy * 6) * (1 - fx) * (1 - fy) + nb((fx - 1) * 6, fy * 6) * fx * (1 - fy) + nb(fx * 6, (fy - 1) * 6) * (1 - fx) * fy + nb((fx - 1) * 6, (fy - 1) * 6) * fx * fy;
      let v = (n0 - .5) * 26 + (hsh(x, y, sd) - .5) * 14;
      if (kind === 'kraft' || kind === 'cardboard') v += (vn(x * .9, y * .05, sd + 1) - .5) * 18 + (hsh(Math.floor(x / 2), Math.floor(y / 9), sd) > .985 ? -30 : 0);
      if (kind === 'cardboard') v += Math.sin(x / S * Math.PI * 2 * 24) * 9;
      if (kind === 'parchment') v += (fbm(fx * 2.5, fy * 2.5, sd + 9) - .5) * 40;
      if (kind === 'black') v *= .5;
      const k = (y * S + x) * 4; im.data[k] = clamp(base[0] + v, 0, 255); im.data[k + 1] = clamp(base[1] + v * .95, 0, 255); im.data[k + 2] = clamp(base[2] + v * .85, 0, 255); im.data[k + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    if (kind === 'notebook') { g.strokeStyle = 'rgba(70,120,190,.38)'; g.lineWidth = 1.4; for (let y = 24; y < S; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); } }
    if (kind === 'grid') { g.strokeStyle = 'rgba(60,130,150,.25)'; g.lineWidth = 1; for (let i = 0; i < S; i += 32) { g.beginPath(); g.moveTo(i + .5, 0); g.lineTo(i + .5, S); g.moveTo(0, i + .5); g.lineTo(S, i + .5); g.stroke(); } }
    if (kind === 'news') { // faint columns of text from the other side of the page
      const r = GW.rng(5); g.fillStyle = 'rgba(40,36,30,.07)'; for (let col = 0; col < 4; col++) for (let y = 10; y < S - 6; y += 9) { const x0 = col * 128 + 8; let x = x0; while (x < x0 + 112) { const w = 6 + r() * 22; if (x + w > x0 + 112) break; g.fillRect(x, y, w, 4); x += w + 4; } }
    }
    TEX[kind] = c; return c;
  };
  C.paperFill = (g, kind, x, y, w, h, u, ox, oy) => { const tl = C.paperTile(kind); const p = g.createPattern(tl, 'repeat'); const sc = Math.max(.6, u * 1.4); if (p.setTransform) p.setTransform(new DOMMatrix().translate(ox || 0, oy || 0).scale(sc)); g.fillStyle = p; g.fillRect(x, y, w, h); };

  /* ---------------- shapes ---------------- */
  // rectangle with torn (jagged) edges; edges = which sides are torn (t,r,b,l)
  C.tornRect = (w, h, seed, amp, edges = 'trbl') => {
    const pts = []; const step = Math.max(4, amp * .9); const r = (i, s) => hsh(i, seed, s);
    const side = (x0, y0, x1, y1, nx, ny, torn, sid) => { const L = Math.hypot(x1 - x0, y1 - y0); const n = Math.max(1, Math.round(L / step)); for (let i = 0; i < n; i++) { const f = i / n; const j = torn ? (r(i, sid) * .7 + vn(i * .21, sid, seed) * .9 - .6) * amp : 0; pts.push([x0 + (x1 - x0) * f + nx * j, y0 + (y1 - y0) * f + ny * j]); } };
    side(0, 0, w, 0, 0, -1, edges.includes('t'), 1); side(w, 0, w, h, 1, 0, edges.includes('r'), 2); side(w, h, 0, h, 0, 1, edges.includes('b'), 3); side(0, h, 0, 0, -1, 0, edges.includes('l'), 4);
    return pts;
  };
  const poly = (g, pts) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); };
  // a piece of paper: torn polygon, texture, fibrous white edge, lifted shadow
  C.paper = (g, k, w, h, o = {}) => {
    const u = o.u || 1; const pts = C.tornRect(w, h, o.seed || 1, (o.amp == null ? 7 : o.amp) * u, o.edges || 'trbl').map(p => [p[0] - w / 2, p[1] - h / 2]);
    g.save(); g.shadowColor = 'rgba(0,0,0,' + (o.sh == null ? .38 : o.sh) + ')'; g.shadowBlur = (o.lift == null ? 14 : o.lift) * u * k; g.shadowOffsetY = (o.lift == null ? 6 : o.lift * .45) * u * k; g.shadowOffsetX = 2 * u * k;
    poly(g, pts); g.fillStyle = o.edge || '#f4f1ea'; g.fill(); g.restore();
    g.save(); const inset = (o.torn == null ? 3.5 : o.torn) * u; const pin = pts.map(p => [p[0] * (1 - inset / w * 2), p[1] * (1 - inset / h * 2)]); poly(g, pin); g.clip();
    if (o.paper) C.paperFill(g, o.paper, -w / 2, -h / 2, w, h, u, (o.seed || 1) * 37, (o.seed || 1) * 53); else { g.fillStyle = o.fill || '#efe9dc'; g.fillRect(-w / 2, -h / 2, w, h); }
    if (o.inner) o.inner(g); g.restore();
    return pts;
  };
  // tape strip
  C.tape = (g, k, x, y, w, h, rot, o = {}) => {
    g.save(); g.translate(x, y); g.rotate(rot); const pts = C.tornRect(w, h, o.seed || 3, h * .14, 'rl').map(p => [p[0] - w / 2, p[1] - h / 2]);
    g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 4 * k; g.shadowOffsetY = 1.5 * k; poly(g, pts); g.fillStyle = GW.rgba(o.color || '#e9dfb8', o.alpha == null ? .78 : o.alpha); g.fill(); g.shadowColor = 'transparent';
    g.save(); poly(g, pts); g.clip(); const gr = g.createLinearGradient(0, -h / 2, 0, h / 2); gr.addColorStop(0, 'rgba(255,255,255,.28)'); gr.addColorStop(.45, 'rgba(255,255,255,.05)'); gr.addColorStop(1, 'rgba(0,0,0,.06)'); g.fillStyle = gr; g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = 'rgba(120,100,60,.08)'; g.lineWidth = 1; for (let i = -w / 2; i < w / 2; i += 5) { g.beginPath(); g.moveTo(i, -h / 2); g.lineTo(i + 3, h / 2); g.stroke(); } g.restore();
    g.restore();
  };
  // hand-drawn strokes with draw-on (p 0..1)
  C.scribblePath = (kind, w, h, seed) => {
    const P = []; const r = (i) => hsh(i, seed, 5) - .5;
    if (kind === 'circle') { const n = 70; for (let i = 0; i <= n; i++) { const a = -Math.PI * .6 + i / n * Math.PI * 2.18; const rr = 1 + r(Math.floor(i / 9)) * .09 + i / n * .06; P.push([Math.cos(a) * w / 2 * rr, Math.sin(a) * h / 2 * rr]); } return [P]; }
    if (kind === 'underline') { const n = 40; for (let i = 0; i <= n; i++) { const f = i / n; P.push([-w / 2 + f * w, Math.sin(f * 3.1 + seed) * h * .12 + r(i >> 3) * h * .08]); } const P2 = []; for (let i = 0; i <= n; i++) { const f = i / n; P2.push([w / 2 - f * w * .9, h * .22 + Math.sin(f * 2.6 + seed) * h * .1]); } return [P, P2]; }
    if (kind === 'cross') return [[[-w / 2, -h / 2], [0, r(1) * h * .1], [w / 2, h / 2]], [[w / 2, -h / 2], [r(2) * w * .1, 0], [-w / 2, h / 2]]];
    if (kind === 'check') return [[[-w / 2, 0], [-w * .15, h / 2], [w / 2, -h / 2]]];
    if (kind === 'bracket') return [[[w / 2, -h / 2], [0, -h / 2 + h * .06], [r(1) * w * .1, 0], [0, h / 2 - h * .06], [w / 2, h / 2]]];
    if (kind === 'star') { const out = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i * Math.PI * 4 / 5; out.push([Math.cos(a) * w / 2, Math.sin(a) * h / 2]); } return [out]; }
    if (kind === 'question') { const q = []; for (let i = 0; i <= 30; i++) { const a = Math.PI * 1.1 - i / 30 * Math.PI * 1.5; q.push([Math.cos(a) * w * .3, -h * .2 + Math.sin(a) * h * .25]); } q.push([0, h * .12]); return [q, [[0, h * .36], [1, h * .4]]]; }
    // arrow (default): curved shaft + two head strokes
    const n = 36; const S = []; for (let i = 0; i <= n; i++) { const f = i / n; S.push([-w / 2 + f * w, -Math.sin(f * Math.PI) * h * .45 + r(i >> 2) * h * .04]); }
    const e = S[n], pr = S[n - 3]; const an = Math.atan2(e[1] - pr[1], e[0] - pr[0]); const hl = Math.min(w, h * 2) * .22;
    return [S, [[e[0] + Math.cos(an + 2.55) * hl, e[1] + Math.sin(an + 2.55) * hl], e, [e[0] + Math.cos(an - 2.55) * hl, e[1] + Math.sin(an - 2.55) * hl]]];
  };
  C.drawStrokes = (g, strokes, p, o = {}) => {
    const lens = strokes.map(s => { let L = 0; for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return L; }); const tot = lens.reduce((a, b) => a + b, 0) || 1;
    let left = p * tot; g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = o.color || '#d42a1e';
    strokes.forEach((s, si) => { if (left <= 0) return; const L = lens[si]; const take = Math.min(L, left); left -= L;
      for (const [wm, a, dx] of [[1, o.alpha || .95, 0], [.45, .5, (o.width || 6) * .25]]) { g.globalAlpha = a; g.lineWidth = (o.width || 6) * wm; g.beginPath(); let acc = 0; g.moveTo(s[0][0] + dx, s[0][1]); for (let i = 1; i < s.length; i++) { const d = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); if (acc + d >= take) { const f = (take - acc) / Math.max(1e-6, d); g.lineTo(s[i - 1][0] + (s[i][0] - s[i - 1][0]) * f + dx, s[i - 1][1] + (s[i][1] - s[i - 1][1]) * f); break; } acc += d; g.lineTo(s[i][0] + dx, s[i][1]); } g.stroke(); } });
    g.restore();
  };
  // stamp (rubber ink with worn holes)
  C.stamp = (g, k, text, o = {}) => {
    const u = o.u || 1; const px = (o.size || 54) * u; g.save(); g.font = `900 ${px}px "Cairo", "Tajawal", sans-serif`; g.direction = GW.isAr(text) ? 'rtl' : 'ltr'; const tw = g.measureText(text).width; const w = tw + px * 1.1, h = px * 1.55; const col = o.color || '#c0262d';
    const ink = document.createElement('canvas'); const sc = Math.max(1, k * 1.0); ink.width = Math.ceil((w + 20 * u) * sc); ink.height = Math.ceil((h + 20 * u) * sc); const q = ink.getContext('2d'); q.scale(sc, sc); q.translate(ink.width / sc / 2, ink.height / sc / 2);
    q.strokeStyle = col; q.fillStyle = col; q.lineWidth = 5 * u;
    if (o.shape === 'circle') { const R = Math.max(w, h) * .55; q.beginPath(); q.arc(0, 0, R * .62, 0, 7); q.stroke(); q.lineWidth = 2 * u; q.beginPath(); q.arc(0, 0, R * .54, 0, 7); q.stroke(); }
    else { q.strokeRect(-w / 2, -h / 2, w, h); q.lineWidth = 2 * u; q.strokeRect(-w / 2 + 7 * u, -h / 2 + 7 * u, w - 14 * u, h - 14 * u); }
    q.font = g.font; q.direction = g.direction; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText(text, 0, px * .06);
    q.globalCompositeOperation = 'destination-out'; const r = GW.rng(o.seed || 9); for (let i = 0; i < 260; i++) { q.globalAlpha = .25 + r() * .75; q.beginPath(); q.arc((r() - .5) * w * 1.1, (r() - .5) * h * 1.1, (.6 + r() * 2.6) * u, 0, 7); q.fill(); }
    q.globalAlpha = 1; q.globalCompositeOperation = 'source-over';
    g.globalAlpha *= o.alpha == null ? .9 : o.alpha; g.globalCompositeOperation = o.blend || 'source-over'; g.drawImage(ink, -ink.width / sc / 2, -ink.height / sc / 2, ink.width / sc, ink.height / sc); g.restore();
    return [w, h];
  };

  /* ---------------- images ---------------- */
  C.image = (id) => { if (!id) return null; const m = GW.media && GW.media(id); if (!m) return null; const r = GW.Media.ensureRt(m); if (r.img && r.img.naturalWidth) return r.img; if (!r._clLoading && m.kind === 'image') { r._clLoading = 1; const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { r.img = im; GW.invalidate && GW.invalidate(); }; im.src = GW.Media.url(m, true); } return null; };
  const silCache = {};
  C.silhouette = (variant) => { // placeholder person (halftone print look) when no photo is chosen
    const key = 'v' + (variant || 0); if (silCache[key]) return silCache[key]; const c = document.createElement('canvas'); c.width = 400; c.height = 500; const g = c.getContext('2d');
    g.fillStyle = '#4a4744'; g.beginPath(); g.ellipse(200, 165, 78 + variant * 4, 96, 0, 0, 7); g.fill(); g.beginPath(); g.moveTo(40, 500); g.bezierCurveTo(50, 330, 120, 290, 200, 285); g.bezierCurveTo(280, 290, 350, 330, 360, 500); g.fill();
    g.globalCompositeOperation = 'source-atop'; for (let y = 0; y < 500; y += 7) for (let x = 0; x < 400; x += 7) { const l = .35 + .4 * (x / 400) * (1 - y / 600); g.fillStyle = '#bdb6aa'; g.beginPath(); g.arc(x + (y / 7 % 2) * 3.5, y, 3.4 * l, 0, 7); g.fill(); }
    silCache[key] = c; return c;
  };
  const imgOr = (id, v) => C.image(id) || C.silhouette(v || 0);
  C.cover = (g, im, x, y, w, h, fx = .5, fy = .4) => { const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height; const s = Math.max(w / iw, h / ih); const dw = iw * s, dh = ih * s; g.drawImage(im, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh); };
  C.contain = (g, im, cx, cy, w, h) => { const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height; const s = Math.min(w / iw, h / ih); g.drawImage(im, cx - iw * s / 2, cy - ih * s / 2, iw * s, ih * s); return [iw * s, ih * s]; };
  // sticker outline for an alpha image (canvas 2D dilation by stamping), cached per image + width
  const stickC = new WeakMap();
  C.sticker = (im, bw, color) => {
    let m = stickC.get(im); if (!m) stickC.set(im, m = {}); const key = bw + color; if (m[key]) return m[key];
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height; const sc = Math.min(1, 900 / Math.max(iw, ih)); const w = Math.round(iw * sc), h = Math.round(ih * sc); const b = Math.ceil(bw);
    const c = document.createElement('canvas'); c.width = w + b * 2; c.height = h + b * 2; const g = c.getContext('2d');
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; g.drawImage(im, b + Math.cos(a) * bw, b + Math.sin(a) * bw, w, h); }
    g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over'; g.drawImage(im, b, b, w, h);
    c._pad = b / sc; c._sc = sc; m[key] = c; return c;
  };
  const hasAlpha = (im) => { if (im._ha != null) return im._ha; try { const c = document.createElement('canvas'); c.width = 24; c.height = 24; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, 24, 24); const d = g.getImageData(0, 0, 24, 24).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 200) n++; im._ha = n > 20; } catch (e) { im._ha = false; } return im._ha; };
  // a person/object cut-out: sticker-bordered if the image has alpha, else a torn photo print
  C.cutout = (g, k, im, cx, cy, h, o = {}) => {
    const u = o.u || 1; const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height; const w = h * iw / ih;
    if (im === C.silhouette(0) || im === C.silhouette(1) || im === C.silhouette(2) || hasAlpha(im)) {
      const st = C.sticker(im, Math.max(4, 9 * (Math.max(iw, ih) / h) * u * (o.border || 1)), o.color || '#ffffff'); const s = h / ih; const pad = st._pad * s;
      g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 16 * u * k; g.shadowOffsetY = 8 * u * k; g.shadowOffsetX = 3 * u * k; g.drawImage(st, cx - w / 2 - pad, cy - h / 2 - pad, w + pad * 2, h + pad * 2); g.restore();
    } else { g.save(); g.translate(cx, cy); C.paper(g, k, w + 16 * u, h + 16 * u, { u, seed: o.seed || 4, amp: 6, edge: '#f6f3ec', fill: '#f6f3ec', inner: (q) => { q.save(); q.filter = 'grayscale(.35) contrast(1.05) sepia(.18)'; q.drawImage(im, -w / 2, -h / 2, w, h); q.restore(); } }); g.restore(); }
  };
  const popIn = (t, t0, d) => { const p = seg(t, t0, t0 + (d || .4)); return p <= 0 ? 0 : E.back(p); };
  // element transform helper: pop scale, settle rotation, stop-motion jitter
  const place = (g, F, t, dur, W, H, u, o = {}) => { const fps = +F.fps || 0; const th = hold(t, fps); const [jx, jy, jr] = jit(t, fps, o.seed || 1, 2.2 * u); const [x, y] = pos(F, W, H); const sc = popIn(th, o.t0 || 0, o.d || .4) * outro(t, dur, .35); g.translate(x + jx, y + jy); g.rotate(((F.rot || 0) + jr * 20) * Math.PI / 180 + (1 - seg(th, o.t0 || 0, (o.t0 || 0) + .5)) * .2); g.scale(sc, sc); return th; };
  const XY = [nF('x', 'الموضع الأفقي', 50, 0, 100, .5, '%'), nF('y', 'الموضع العمودي', 50, 0, 100, .5, '%'), nF('size', 'الحجم', 100, 10, 400, 1, '%'), nF('rot', 'الدوران', -3, -180, 180, .5, '°')];
  const at = (F, x, y, extra) => Object.assign({}, F, { x, y }, extra || {});
  C.bg = (g, kind, W, H, u, t, fps, vig) => { const th = hold(t, fps); const [jx, jy] = jit(t, fps, 7, 1.2 * u); C.paperFill(g, kind, -20, -20, W + 40, H + 40, u, jx, jy); if (vig !== 0) { const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.hypot(W, H) * .62); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(20,12,4,' + (vig == null ? .42 : vig) + ')'); g.fillStyle = gr; g.fillRect(0, 0, W, H); } return th; };
  const label = (g, text, x, y, o) => { g.save(); g.font = `${o.wt || 800} ${o.size}px "${o.font || 'Cairo'}", "Tajawal", sans-serif`; g.direction = GW.isAr(text) ? 'rtl' : 'ltr'; g.textAlign = o.align || 'center'; g.textBaseline = 'middle'; g.fillStyle = o.color || '#1b1916'; g.fillText(text, x, y); const w = g.measureText(text).width; g.restore(); return w; };
  const scrapText = (g, k, text, x, y, u, o = {}) => { // text on its own torn strip
    g.save(); g.font = `${o.wt || 800} ${o.size}px "${o.font || 'Cairo'}", sans-serif`; g.direction = GW.isAr(text) ? 'rtl' : 'ltr'; const w = g.measureText(text).width + o.size * .9, h = o.size * 1.45; g.restore();
    g.save(); g.translate(x, y); g.rotate((o.rot || 0) * Math.PI / 180); C.paper(g, k, w, h, { u, seed: o.seed || 2, amp: 4, fill: o.bg || '#f3eee2', edge: o.edge || '#fbf9f4', lift: 8, paper: o.paper, inner: (q) => label(q, text, 0, o.size * .04, { size: o.size, color: o.color || '#141210', font: o.font, wt: o.wt }) }); g.restore(); return [w, h];
  };

  /* =============== elements =============== */
  def({ id: 'cl-bg', n: 'خلفية ورق (كولاج)', dur: 8, fields: [sF('paper', 'نوع الورق', 'kraft', PAPERS), nF('vig', 'تعتيم الأطراف', 40, 0, 100), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); g.globalAlpha = seg(t, 0, .25) * outro(t, dur, .3); C.bg(g, F.paper, W, H, u, t, +F.fps, F.vig / 100); } });
  def({ id: 'cl-tape', n: 'شريط لاصق', dur: 6, fields: [...XY, sF('count', 'الشرائط', '1', [['1', 'شريط'], ['2', 'شريطان (زاويتان)'], ['x', 'متقاطع']]), cF('color', 'اللون', '#e9dfb8'), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H) * F.size / 100; g.save(); place(g, F, t, dur, W, H, u, { d: .25 }); const w = 380 * u, h = 80 * u;
      if (F.count === '2') { C.tape(g, k, -180 * u, 0, w * .8, h, -.6, { color: F.color, seed: 3 }); C.tape(g, k, 180 * u, 0, w * .8, h, .6, { color: F.color, seed: 5 }); }
      else if (F.count === 'x') { C.tape(g, k, 0, 0, w, h, -.5, { color: F.color, seed: 3 }); C.tape(g, k, 0, 0, w, h, .5, { color: F.color, seed: 8 }); } else C.tape(g, k, 0, 0, w, h, 0, { color: F.color, seed: 3 }); g.restore(); } });
  def({ id: 'cl-scrap', n: 'قصاصة ورق بنص', dur: 6, main: 'text', fields: [tF('text', 'النص', 'وثيقة مسرّبة'), ...XY, sF('paper', 'الورق', 'news', [['', 'أبيض'], ...PAPERS.slice(0, 5)]), cF('color', 'لون النص', '#141210'), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H) * F.size / 100; g.save(); place(g, F, t, dur, W, H, u); scrapText(g, k, F.text, 0, 0, u, { size: 64 * u, paper: F.paper || undefined, color: F.color, seed: 4 }); g.restore(); } });
  def({ id: 'cl-stamp', n: 'ختم', dur: 5, main: 'text', fields: [tF('text', 'النص', 'سري للغاية'), ...XY.slice(0, 3), nF('rot', 'الدوران', -12, -180, 180, .5, '°'), sF('shape', 'الشكل', 'rect', [['rect', 'مستطيل'], ['circle', 'دائري']]), cF('color', 'اللون', '#c0262d'), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H) * F.size / 100; const [x, y] = pos(F, W, H); const p = seg(t, .15, .32); if (p <= 0) return; const sc = 1 + (1 - E.o3(p)) * 1.6; const [jx, jy] = jit(t, +F.fps, 11, 1.4 * u);
      g.save(); g.translate(x + jx, y + jy); g.rotate(F.rot * Math.PI / 180); g.scale(sc, sc); g.globalAlpha = Math.min(1, p * 2) * outro(t, dur, .3); C.stamp(g, k, F.text, { u, color: F.color, shape: F.shape, seed: 5 }); g.restore(); } });
  def({ id: 'cl-scribble', n: 'خربشة يدوية (سهم / دائرة / خط)', dur: 4, fields: [sF('shape', 'الشكل', 'circle', [['circle', 'دائرة'], ['arrow', 'سهم'], ['underline', 'خط تحت'], ['cross', 'إشارة ×'], ['check', 'صح'], ['bracket', 'قوس'], ['star', 'نجمة'], ['question', 'علامة استفهام']]), ...XY.slice(0, 3), nF('rot', 'الدوران', 0, -180, 180, .5, '°'), cF('color', 'اللون', '#d42a1e'), nF('width', 'سماكة القلم', 7, 1, 30, .5), nF('draw', 'مدة الرسم', .7, .1, 4, .05, ' ث'), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H) * F.size / 100; const [x, y] = pos(F, W, H); const fps = +F.fps; const th = hold(t, fps ? Math.max(fps, 12) * 2 : 0); const p = E.o3(seg(th, .1, .1 + F.draw)); if (p <= 0) return; const [jx, jy] = jit(t, fps, 21, 1.5 * u);
      const dims = { circle: [420, 260], arrow: [380, 160], underline: [480, 40], cross: [160, 160], check: [180, 160], bracket: [70, 300], star: [220, 210], question: [160, 260] }[F.shape] || [300, 200];
      g.save(); g.translate(x + jx, y + jy); g.rotate(F.rot * Math.PI / 180); g.globalAlpha = outro(t, dur, .3); C.drawStrokes(g, C.scribblePath(F.shape, dims[0] * u, dims[1] * u, 7), p, { color: F.color, width: F.width * u }); g.restore(); } });
  def({ id: 'cl-polaroid', n: 'إطار بولارويد', dur: 6, main: 'cap', fields: [iF('img', 'الصورة'), tF('cap', 'التعليق', 'القاهرة، 1952'), ...XY, FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H) * F.size / 100; g.save(); place(g, F, t, dur, W, H, u); const w = 420 * u, h = 500 * u, ph = 380 * u; const im = imgOr(F.img);
      g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 18 * u * k; g.shadowOffsetY = 8 * u * k; g.fillStyle = '#f7f5ef'; g.fillRect(-w / 2, -h / 2, w, h); g.restore();       g.save(); g.beginPath(); g.rect(-w / 2 + 22 * u, -h / 2 + 22 * u, w - 44 * u, ph); g.clip(); g.fillStyle = '#222'; g.fillRect(-w / 2, -h / 2, w, h); g.filter = 'sepia(.25) contrast(1.05) saturate(.8)'; C.cover(g, im, -w / 2 + 22 * u, -h / 2 + 22 * u, w - 44 * u, ph); g.restore();
      label(g, F.cap, 0, -h / 2 + 22 * u + ph + 50 * u, { size: 38 * u, font: 'Amiri', wt: 700, color: '#2a2622' }); C.tape(g, k, 0, -h / 2 + 4 * u, 170 * u, 46 * u, .05, { seed: 6 }); g.restore(); } });
  def({ id: 'cl-clipping', n: 'قصاصة صحيفة', dur: 6, main: 'head', fields: [tF('head', 'العنوان', 'إعلان الحرب'), tF('date', 'التاريخ', '3 سبتمبر 1939'), iF('img', 'الصورة'), ...XY, FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H) * F.size / 100; g.save(); const th = place(g, F, t, dur, W, H, u); const w = 560 * u, h = 640 * u; const im = imgOr(F.img, 1);
      C.paper(g, k, w, h, { u, seed: 12, amp: 8, paper: 'news', edge: '#efe9d8', inner: (q) => {
        label(q, F.head, 0, -h / 2 + 72 * u, { size: 66 * u, color: '#15130f', wt: 900 }); q.fillStyle = '#15130f'; q.fillRect(-w / 2 + 30 * u, -h / 2 + 118 * u, w - 60 * u, 3 * u);
        label(q, F.date, 0, -h / 2 + 140 * u, { size: 22 * u, color: '#3b362e', font: 'Tajawal', wt: 500 });
        q.save(); q.filter = 'grayscale(1) contrast(1.15)'; q.beginPath(); q.rect(-w / 2 + 30 * u, -h / 2 + 165 * u, w - 60 * u, 270 * u); q.clip(); C.cover(q, im, -w / 2 + 30 * u, -h / 2 + 165 * u, w - 60 * u, 270 * u); q.restore();
        q.fillStyle = 'rgba(30,28,24,.55)'; const r = GW.rng(3); for (let c2 = 0; c2 < 2; c2++) for (let y = -h / 2 + 455 * u; y < h / 2 - 22 * u; y += 17 * u) { const cw = (w - 80 * u) / 2; const x0 = -w / 2 + 30 * u + c2 * (cw + 20 * u); const ww = cw * (y > h / 2 - 50 * u ? .5 : .82 + r() * .18); q.fillRect(x0 + cw - ww, y, ww, 7 * u); } } });
      g.restore(); } });
  def({ id: 'cl-folder', n: 'ملف سري', dur: 7, main: 'title', fields: [tF('title', 'عنوان الملف', 'العملية الصفراء'), tF('stamp', 'الختم', 'سري للغاية'), iF('img', 'الصورة'), ...XY, FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H) * F.size / 100; g.save(); const th = place(g, F, t, dur, W, H, u); const w = 760 * u, h = 520 * u; const im = imgOr(F.img, 2);
      g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 22 * u * k; g.shadowOffsetY = 10 * u * k; g.fillStyle = '#c9a66b'; g.beginPath(); g.moveTo(-w / 2, -h / 2 + 40 * u); g.lineTo(-w / 2 + 40 * u, -h / 2 + 40 * u); g.lineTo(-w / 2 + 70 * u, -h / 2); g.lineTo(-w / 2 + 280 * u, -h / 2); g.lineTo(-w / 2 + 310 * u, -h / 2 + 40 * u); g.lineTo(w / 2, -h / 2 + 40 * u); g.lineTo(w / 2, h / 2); g.lineTo(-w / 2, h / 2); g.closePath(); g.fill(); g.restore();
      g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = .5; C.paperFill(g, 'kraft', -w / 2, -h / 2 + 40 * u, w, h - 40 * u, u); g.restore();
      label(g, F.title, -w / 2 + 175 * u, -h / 2 + 22 * u, { size: 24 * u, color: '#3a2a12', font: 'Tajawal', wt: 700 });
      const op = E.o3(seg(th, .35, .9)); g.save(); g.translate(60 * u, 30 * u - op * 10 * u); g.rotate(.04 - op * .02); C.paper(g, k, 300 * u, 360 * u, { u, seed: 31, amp: 0, fill: '#f5f2ea', edge: '#f5f2ea', lift: 10, inner: (q) => { q.save(); q.filter = 'grayscale(1) contrast(1.1) sepia(.2)'; C.cover(q, im, -130 * u, -160 * u, 260 * u, 320 * u); q.restore(); } });
      g.fillStyle = '#9aa0a6'; g.lineWidth = 6 * u; g.strokeStyle = '#8d949b'; g.beginPath(); g.roundRect ? g.roundRect(-30 * u, -200 * u, 40 * u, 90 * u, 20 * u) : g.rect(-30 * u, -200 * u, 40 * u, 90 * u); g.stroke(); g.restore();
      for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(40,30,20,.55)'; g.fillRect(-w / 2 + 50 * u, -h / 2 + 120 * u + i * 34 * u, (200 - (i % 3) * 30) * u, 10 * u); }
      const sp = seg(th, 1.0, 1.15); if (sp > 0) { g.save(); g.translate(-w / 2 + 170 * u, h / 2 - 100 * u); g.rotate(-.18); const sc = 1 + (1 - E.o3(sp)) * 1.5; g.scale(sc, sc); g.globalAlpha *= Math.min(1, sp * 2); C.stamp(g, k, F.stamp, { u, size: 50, seed: 4 }); g.restore(); }
      g.restore(); } });
  // procedural map scrap: coast from noise, grid, dashed route, X marker
  const LAND = {};
  const landMask = (seed, ar) => { const key = seed + ':' + ar.toFixed(2); if (LAND[key]) return LAND[key]; const S = 220, Hh = Math.round(S / ar); const c = document.createElement('canvas'); c.width = S; c.height = Hh; const g = c.getContext('2d'); const im = g.createImageData(S, Hh);
    for (let j = 0; j < Hh; j++) for (let i = 0; i < S; i++) { const v = fbm(i / 55 + seed, j / 55, seed) + (i / S) * .25 + (vn(i / 9, j / 9, seed + 2) - .5) * .08; const k = (j * S + i) * 4; const a = clamp((.52 - v) * 60, 0, 1); im.data[k] = 159; im.data[k + 1] = 183; im.data[k + 2] = 180; im.data[k + 3] = a * 255; const e = Math.abs(.52 - v) < .006; if (e) { im.data[k] = 90; im.data[k + 1] = 110; im.data[k + 2] = 112; im.data[k + 3] = 200; } }
    g.putImageData(im, 0, 0); return (LAND[key] = c); };
  C.mapScrap = (q, w, h, u, p, seed) => {
    q.fillStyle = '#e8dcbc'; q.fillRect(-w / 2, -h / 2, w, h); q.drawImage(landMask(seed, w / h), -w / 2, -h / 2, w, h);
    q.strokeStyle = 'rgba(80,60,30,.25)'; q.lineWidth = 1.2 * u; for (let x = -w / 2; x < w / 2; x += 60 * u) { q.beginPath(); q.moveTo(x, -h / 2); q.lineTo(x, h / 2); q.stroke(); } for (let y = -h / 2; y < h / 2; y += 60 * u) { q.beginPath(); q.moveTo(-w / 2, y); q.lineTo(w / 2, y); q.stroke(); }
    const route = []; for (let i = 0; i <= 40; i++) { const f = i / 40; route.push([-w * .36 + f * w * .7, h * .22 - Math.sin(f * 3.2) * h * .3 + (vn(f * 5, seed, 3) - .5) * h * .1]); }
    q.save(); q.setLineDash([10 * u, 8 * u]); C.drawStrokes(q, [route], p, { color: '#b3241c', width: 5 * u }); q.restore();
    if (p > .98) { const e = route[route.length - 1]; C.drawStrokes(q, C.scribblePath('cross', 40 * u, 40 * u, 3).map(s => s.map(pt => [pt[0] + e[0], pt[1] + e[1]])), 1, { color: '#b3241c', width: 6 * u }); }
  };
  def({ id: 'cl-mapscrap', n: 'قصاصة خريطة', dur: 6, main: 'label', fields: [tF('label', 'التسمية', 'طريق الإمداد'), ...XY, nF('seed', 'شكل الساحل', 3, 1, 99), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H) * F.size / 100; g.save(); const th = place(g, F, t, dur, W, H, u); const w = 620 * u, h = 420 * u; const p = E.io(seg(th, .5, 2.2));
      C.paper(g, k, w, h, { u, seed: F.seed + 40, amp: 9, edge: '#efe6cc', inner: (q) => C.mapScrap(q, w, h, u, p, F.seed) }); C.tape(g, k, -w / 2 + 40 * u, -h / 2 + 10 * u, 150 * u, 44 * u, -.7, { seed: 9 }); C.tape(g, k, w / 2 - 40 * u, h / 2 - 10 * u, 150 * u, 44 * u, -.7, { seed: 10 });
      if (F.label) scrapText(g, k, F.label, 0, h / 2 + 20 * u, u, { size: 34 * u, rot: 2, seed: 7 }); g.restore(); } });

  /* =============== full collage scenes =============== */
  def({ id: 'cl-scene-news', n: 'مشهد: شخصية فوق صحيفة', dur: 7, main: 'head', fields: [iF('img', 'صورة الشخصية (يفضّل قصاصة)'), tF('head', 'العنوان', 'الرجل الذي غيّر التاريخ'), tF('note', 'ملاحظة بخط اليد', 'هو!'), sF('paper', 'الخلفية', 'news', PAPERS), cF('ink', 'لون القلم', '#d42a1e'), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); const fps = +F.fps; const th = C.bg(g, F.paper, W, H, u, t, fps, .35); const o = outro(t, dur, .35); const V = H > W * 1.1;
      // giant newspaper headline behind
      g.save(); g.globalAlpha = .9 * o; const hj = jit(t, fps, 3, 1.5 * u); scrapText(g, k, F.head, W * (V ? .5 : .36) + hj[0], H * (V ? .2 : .2) + hj[1], u, { size: 74 * u, rot: -2, paper: 'news', seed: 5, wt: 900 }); g.restore();
      const im = imgOr(F.img); const sc = popIn(th, .35, .45) * o; const [jx, jy, jr] = jit(t, fps, 9, 2.4 * u);
      g.save(); g.translate(W * (V ? .5 : .62) + jx, H * (V ? .62 : .58) + jy); g.rotate(-.05 + jr * .3); g.scale(sc, sc); C.cutout(g, k, im, 0, 0, H * (V ? .5 : .74), { u }); g.restore();
      if (th > .8) { g.save(); g.globalAlpha = o; const tp = popIn(th, .8, .2); g.translate(W * (V ? .5 : .62), H * (V ? .38 : .24)); g.scale(tp, tp); C.tape(g, k, 0, 0, 240 * u, 60 * u, .12, { seed: 4 }); g.restore(); }
      g.save(); g.globalAlpha = o; g.translate(W * (V ? .5 : .62), H * (V ? .5 : .4)); C.drawStrokes(g, C.scribblePath('circle', H * .34, H * .3, 4), E.o3(seg(th, 1.3, 2.0)), { color: F.ink, width: 8 * u }); g.restore();
      g.save(); g.globalAlpha = o; g.translate(W * (V ? .22 : .36), H * (V ? .52 : .5)); g.rotate(.5); C.drawStrokes(g, C.scribblePath('arrow', 220 * u, 90 * u, 2), E.o3(seg(th, 1.9, 2.4)), { color: F.ink, width: 7 * u }); g.restore();
      if (F.note && th > 2.3) { g.save(); g.globalAlpha = o * E.o3(seg(th, 2.3, 2.6)); label(g, F.note, W * (V ? .2 : .26), H * (V ? .6 : .62), { size: 110 * u, color: F.ink, font: 'Reem Kufi', wt: 400 }); g.restore(); }
    } });
  def({ id: 'cl-scene-stack', n: 'مشهد: كومة صور أرشيفية', dur: 7, main: 'cap', fields: [iF('img1', 'الصورة 1'), iF('img2', 'الصورة 2'), iF('img3', 'الصورة 3'), tF('cap', 'التعليق', 'أرشيف العائلة، 1948'), sF('paper', 'الخلفية', 'kraft', PAPERS), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); const fps = +F.fps; const th = C.bg(g, F.paper, W, H, u, t, fps, .45); const o = outro(t, dur, .35);
      [[F.img1, .36, .48, -.12, .2], [F.img2, .62, .44, .09, .75], [F.img3, .5, .58, -.03, 1.3]].forEach(([id, x, y, r, t0], i) => {
        const p = seg(th, t0, t0 + .45); if (p <= 0) return; const e = E.back(p); const [jx, jy] = jit(t, fps, 30 + i, 2 * u);
        g.save(); g.globalAlpha = o; g.translate(W * x + jx, H * y - (1 - e) * H * .25 + jy); g.rotate(r + (1 - e) * .4); const s = .9 + .1 * e; g.scale(s, s);
        const w = 520 * u, h = 400 * u; C.paper(g, k, w + 30 * u, h + 30 * u, { u, seed: 50 + i, amp: 0, fill: '#f4f0e6', edge: '#f4f0e6', lift: 16, inner: (q) => { q.save(); q.filter = 'grayscale(1) sepia(.35) contrast(1.08)'; q.beginPath(); q.rect(-w / 2, -h / 2, w, h); q.clip(); C.cover(q, imgOr(id, i), -w / 2, -h / 2, w, h); q.restore(); } });
        if (i === 2) C.tape(g, k, 0, -h / 2 - 8 * u, 180 * u, 50 * u, -.04, { seed: 2 }); g.restore(); });
      if (F.cap && th > 1.9) { g.save(); g.globalAlpha = o * E.o3(seg(th, 1.9, 2.2)); scrapText(g, k, F.cap, W * .5, H * .86, u, { size: 40 * u, rot: -1.5, font: 'Amiri', wt: 700, seed: 3 }); g.restore(); } } });
  def({ id: 'cl-scene-board', n: 'مشهد: لوحة تحقيق', dur: 8, main: 'title', fields: [tF('title', 'العنوان', 'من يقف وراء الاغتيال؟'), iF('img1', 'الصورة 1'), iF('img2', 'الصورة 2'), iF('img3', 'الصورة 3'), iF('img4', 'الصورة 4'), tF('n1', 'اسم 1', 'المتهم'), tF('n2', 'اسم 2', 'الشاهد'), tF('n3', 'اسم 3', 'الضابط'), tF('n4', 'اسم 4', 'الممول'), cF('string', 'لون الخيط', '#c4161c'), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); const fps = +F.fps; const th = C.bg(g, 'cardboard', W, H, u, t, fps, .55); const o = outro(t, dur, .35); const V = H > W * 1.1;
      const P = V ? [[.3, .3], [.72, .38], [.28, .66], [.7, .76]] : [[.2, .34], [.5, .26], [.8, .36], [.56, .7]];
      const pins = P.map(([x, y]) => [W * x, H * y - 120 * u]);
      // strings first (under the photos' pins drawn later)
      [[0, 1], [1, 2], [1, 3], [0, 3]].forEach(([a, b], i) => { const p = E.io(seg(th, 1.6 + i * .35, 2.0 + i * .35)); if (p <= 0) return; const A = pins[a], B = pins[b]; const sag = 30 * u; g.save(); g.globalAlpha = o; g.strokeStyle = F.string; g.lineWidth = 3.5 * u; g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 4 * u * k; g.shadowOffsetY = 3 * u * k; g.beginPath(); g.moveTo(A[0], A[1]); const n = 24; for (let s = 1; s <= Math.ceil(n * p); s++) { const f = Math.min(p, s / n); g.lineTo(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f + Math.sin(f * Math.PI) * sag); } g.stroke(); g.restore(); });
      P.forEach(([x, y], i) => { const t0 = .2 + i * .3; const p = popIn(th, t0, .35); if (p <= 0) return; const [jx, jy, jr] = jit(t, fps, 60 + i, 1.8 * u); const w = (V ? 300 : 280) * u, h = w * 1.2;
        g.save(); g.globalAlpha = o; g.translate(W * x + jx, H * y + jy); g.rotate((hsh(i, 3) - .5) * .18 + jr * .3); g.scale(p, p);
        C.paper(g, k, w + 24 * u, h + 70 * u, { u, seed: 70 + i, amp: 0, fill: '#f5f1e8', edge: '#f5f1e8', lift: 12, inner: (q) => { q.save(); q.filter = 'grayscale(1) contrast(1.1)'; q.beginPath(); q.rect(-w / 2, -h / 2 - 22 * u, w, h); q.clip(); C.cover(q, imgOr(F['img' + (i + 1)], i % 3), -w / 2, -h / 2 - 22 * u, w, h); q.restore(); label(q, F['n' + (i + 1)], 0, h / 2 + 12 * u, { size: 28 * u, font: 'Tajawal', wt: 700, color: '#222' }); } });
        g.restore();
        g.save(); g.globalAlpha = o * p; const pp = pins[i]; g.translate(jx, jy); const rg = g.createRadialGradient(pp[0] - 4 * u, pp[1] - 4 * u, 1, pp[0], pp[1], 13 * u); rg.addColorStop(0, '#ff8a80'); rg.addColorStop(1, '#a3120f'); g.fillStyle = rg; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 5 * u * k; g.shadowOffsetY = 3 * u * k; g.beginPath(); g.arc(pp[0], pp[1], 12 * u, 0, 7); g.fill(); g.restore(); });
      if (F.title) { g.save(); g.globalAlpha = o * E.o3(seg(th, .05, .35)); scrapText(g, k, F.title, W / 2, H * (V ? .1 : .1), u, { size: 52 * u, rot: -1, seed: 8, wt: 900 }); g.restore(); }
      const qm = E.o3(seg(th, 3.2, 3.8)); if (qm > 0) { g.save(); g.globalAlpha = o; g.translate(W * (V ? .5 : .66), H * (V ? .55 : .52)); C.drawStrokes(g, C.scribblePath('question', 110 * u, 170 * u, 2), qm, { color: F.string, width: 8 * u }); g.restore(); } } });
  def({ id: 'cl-scene-file', n: 'مشهد: ملف سري يُفتح', dur: 7, main: 'title', fields: [tF('title', 'عنوان الملف', 'ملف رقم 47'), tF('head', 'العنوان الكبير', 'وثائق لم تُنشر من قبل'), tF('stamp', 'الختم', 'سري للغاية'), iF('img', 'الصورة'), sF('paper', 'الخلفية', 'black', PAPERS), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); const fps = +F.fps; C.bg(g, F.paper, W, H, u, t, fps, .6); const V = H > W * 1.1;
      MG.by['cl-folder'].draw(g, Object.assign({}, F, { x: 50, y: V ? 48 : 54, size: V ? 105 : 120, rot: -2 }), t, dur, W, H, k);
      if (F.head) { const th = hold(t, fps); g.save(); g.globalAlpha = E.o3(seg(th, 1.6, 2.0)) * outro(t, dur, .35); scrapText(g, k, F.head, W / 2, H * (V ? .8 : .12), u, { size: 50 * u, rot: 1.5, seed: 12, wt: 900 }); g.restore(); } } });
  def({ id: 'cl-scene-map', n: 'مشهد: خريطة ممزقة ومسار', dur: 7, main: 'label', fields: [tF('label', 'التسمية', 'طريق الحملة'), tF('title', 'العنوان', 'الزحف نحو الشمال'), sF('paper', 'الخلفية', 'kraft', PAPERS), nF('seed', 'شكل الساحل', 5, 1, 99), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); const fps = +F.fps; C.bg(g, F.paper, W, H, u, t, fps, .45); const V = H > W * 1.1;
      MG.by['cl-mapscrap'].draw(g, Object.assign({}, F, { x: 50, y: 54, size: V ? 140 : 150, rot: -2 }), t, dur, W, H, k);
      if (F.title) { const th = hold(t, fps); g.save(); g.globalAlpha = E.o3(seg(th, .2, .5)) * outro(t, dur, .35); scrapText(g, k, F.title, W / 2, H * .12, u, { size: 54 * u, rot: -1.5, seed: 6, wt: 900, paper: 'news' }); g.restore(); } } });
  def({ id: 'cl-scene-ransom', n: 'مشهد: اقتباس بقصاصات', dur: 7, main: 'quote', fields: [tF('quote', 'الاقتباس', 'التاريخ يكتبه المنتصرون'), tF('by', 'القائل', '— ونستون تشرشل'), sF('paper', 'الخلفية', 'notebook', PAPERS), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); const fps = +F.fps; const th = C.bg(g, F.paper, W, H, u, t, fps, .4); const o = outro(t, dur, .35);
      const words = String(F.quote).split(/\s+/).filter(Boolean); const fonts = ['Cairo', 'Amiri', 'Reem Kufi', 'Changa', 'Tajawal']; const bgs = ['#f3eee2', '#1d1b19', '#e7d9b4', '#f6f1e6', '#c7b089']; const fgs = ['#141210', '#f1ebdd', '#3a2a12', '#a31d1d', '#141210'];
      const sizes = words.map((w, i) => 84 * u * (.85 + hsh(i, 2) * .45)); const ws = words.map((w, i) => { g.font = `900 ${sizes[i]}px "${fonts[i % 5]}"`; return g.measureText(w).width + sizes[i] * .9; });
      const maxW = W * .78; const lines = [[]]; let lw = 0; words.forEach((w, i) => { if (lw + ws[i] > maxW && lines[lines.length - 1].length) { lines.push([]); lw = 0; } lines[lines.length - 1].push(i); lw += ws[i] + 14 * u; });
      const lh = 140 * u; const y0 = H / 2 - (lines.length - 1) * lh / 2 - 30 * u;
      lines.forEach((ln, li) => { const tot = ln.reduce((a, i) => a + ws[i] + 14 * u, -14 * u); let x = W / 2 + tot / 2; // RTL: first word on the right
        ln.forEach((i) => { const cx = x - ws[i] / 2; x -= ws[i] + 14 * u; const p = popIn(th, .2 + i * .18, .25); if (p <= 0) return; const [jx, jy] = jit(t, fps, 80 + i, 2 * u);
          g.save(); g.globalAlpha = o; g.translate(cx + jx, y0 + li * lh + jy); g.scale(p, p); scrapText(g, k, words[i], 0, 0, u, { size: sizes[i], rot: (hsh(i, 5) - .5) * 9, font: fonts[i % 5], bg: bgs[(i * 3) % 5], color: fgs[(i * 3) % 5], seed: 90 + i, wt: 900 }); g.restore(); }); });
      if (F.by) { const p = E.o3(seg(th, .4 + words.length * .18, .7 + words.length * .18)); g.save(); g.globalAlpha = o * p; label(g, F.by, W / 2, y0 + lines.length * lh + 20 * u, { size: 38 * u, font: 'Amiri', wt: 700, color: '#2a2622' }); g.restore(); } } });
  def({ id: 'cl-scene-title', n: 'مشهد: عنوان على ورق ممزق', dur: 6, main: 'title', fields: [tF('title', 'العنوان', 'الفصل الأول'), tF('sub', 'العنوان الفرعي', 'سقوط الإمبراطورية'), sF('paper', 'الخلفية', 'notebook', PAPERS), cF('ink', 'لون الخط', '#d42a1e'), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); const fps = +F.fps; const th = C.bg(g, F.paper, W, H, u, t, fps, .4); const o = outro(t, dur, .35);
      // a torn strip slides in, title on it, then sub on a second scrap, underline draws
      const p = E.o5(seg(th, .1, .55)); const [jx, jy] = jit(t, fps, 3, 2 * u); g.save(); g.globalAlpha = o; g.translate(W / 2 + (1 - p) * W * .7 + jx, H * .45 + jy); g.rotate(-.03);
      g.font = `900 ${120 * u}px "Cairo"`; const tw = Math.max(500 * u, g.measureText(F.title).width + 160 * u); C.paper(g, k, tw, 210 * u, { u, seed: 14, amp: 12, edges: 'tb', fill: '#f6f2e8', paper: 'news', lift: 18, inner: (q) => label(q, F.title, 0, 4 * u, { size: 120 * u, wt: 900, color: '#15130f' }) }); g.restore();
      if (F.sub) { const p2 = popIn(th, .7, .3); if (p2 > 0) { g.save(); g.globalAlpha = o; g.translate(W / 2 + 60 * u, H * .64); g.scale(p2, p2); scrapText(g, k, F.sub, 0, 0, u, { size: 46 * u, rot: 2.5, bg: '#1d1b19', color: '#f1ebdd', seed: 15 }); g.restore(); } }
      g.save(); g.globalAlpha = o; g.translate(W / 2, H * .45 + 125 * u); C.drawStrokes(g, C.scribblePath('underline', tw * .8, 50 * u, 6), E.o3(seg(th, 1.0, 1.5)), { color: F.ink, width: 8 * u }); g.restore();
      if (th > .3) { g.save(); g.globalAlpha = o * popIn(th, .5, .2); C.tape(g, k, W / 2 - tw / 2 + 30 * u, H * .45 - 90 * u, 170 * u, 52 * u, -.6, { seed: 21 }); C.tape(g, k, W / 2 + tw / 2 - 30 * u, H * .45 + 90 * u, 170 * u, 52 * u, -.6, { seed: 22 }); g.restore(); } } });
  def({ id: 'cl-scene-timeline', n: 'مشهد: خط زمني من القصاصات', dur: 8, main: 'e1', fields: [tF('d1', 'تاريخ 1', '1914'), tF('e1', 'حدث 1', 'اغتيال ولي العهد'), tF('d2', 'تاريخ 2', '1916'), tF('e2', 'حدث 2', 'معركة فردان'), tF('d3', 'تاريخ 3', '1917'), tF('e3', 'حدث 3', 'دخول أمريكا'), tF('d4', 'تاريخ 4', '1918'), tF('e4', 'حدث 4', 'الهدنة'), sF('paper', 'الخلفية', 'kraft', PAPERS), cF('ink', 'لون الخط', '#1d1b19'), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); const fps = +F.fps; const th = C.bg(g, F.paper, W, H, u, t, fps, .45); const o = outro(t, dur, .35); const V = H > W * 1.1;
      const n = 4; const pts = []; for (let i = 0; i < n; i++) { const f = i / (n - 1); pts.push(V ? [W * (.5 + (i % 2 ? .12 : -.12)), H * (.18 + f * .64)] : [W * (.86 - f * .72), H * (.52 + (i % 2 ? .06 : -.06))]); }
      const line = []; for (let i = 0; i <= 60; i++) { const f = i / 60; const a = Math.min(n - 2, Math.floor(f * (n - 1))); const lf = f * (n - 1) - a; line.push([pts[a][0] + (pts[a + 1][0] - pts[a][0]) * lf + (vn(i * .3, 1, 2) - .5) * 8 * u, pts[a][1] + (pts[a + 1][1] - pts[a][1]) * lf + (vn(i * .3, 2, 2) - .5) * 8 * u]); }
      g.save(); g.globalAlpha = o; C.drawStrokes(g, [line], E.io(seg(th, .2, 2.6)), { color: F.ink, width: 6 * u }); g.restore();
      for (let i = 0; i < n; i++) { const t0 = .3 + i * .75; const p = popIn(th, t0, .3); if (p <= 0) continue; const [x, y] = pts[i]; const up = V ? 0 : (i % 2 ? 1 : -1); const [jx, jy] = jit(t, fps, 40 + i, 1.8 * u);
        g.save(); g.globalAlpha = o; g.translate(x + jx, y + jy); g.scale(p, p); g.fillStyle = F.ink; g.beginPath(); g.arc(0, 0, 11 * u, 0, 7); g.fill();
        scrapText(g, k, F['d' + (i + 1)], V ? (i % 2 ? 150 : -150) * u : 0, V ? -30 * u : up * 70 * u, u, { size: 46 * u, rot: (hsh(i, 1) - .5) * 8, bg: '#1d1b19', color: '#f1ebdd', seed: 30 + i, font: 'Changa', wt: 600 });
        scrapText(g, k, F['e' + (i + 1)], V ? (i % 2 ? 150 : -150) * u : 0, V ? 40 * u : up * 150 * u, u, { size: 32 * u, rot: (hsh(i, 2) - .5) * 6, paper: 'news', seed: 50 + i }); g.restore(); } } });
  def({ id: 'cl-scene-vs', n: 'مشهد: مواجهة (ضد)', dur: 6, main: 'n1', fields: [iF('img1', 'الصورة 1 (يمين)'), tF('n1', 'الاسم 1', 'صلاح الدين'), iF('img2', 'الصورة 2 (يسار)'), tF('n2', 'الاسم 2', 'ريتشارد قلب الأسد'), tF('vs', 'الختم', 'ضد'), FPS],
    draw(g, F, t, dur, W, H, k) { const u = U(W, H); const fps = +F.fps; const th = hold(t, fps); const o = outro(t, dur, .35); const V = H > W * 1.1;
      // two torn halves: kraft (right) and newsprint (left), torn seam down the middle
      const seam = []; for (let i = 0; i <= 40; i++) { const f = i / 40; seam.push([W / 2 + (vn(f * 9, 3, 1) - .5) * 70 * u + (f - .5) * 60 * u, -10 + f * (H + 20)]); }
      const sl = E.o5(seg(th, 0, .45));
      g.save(); g.translate(-(1 - sl) * W * .5, 0); g.beginPath(); g.moveTo(-10, -10); seam.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(-10, H + 10); g.closePath(); g.save(); g.clip(); C.paperFill(g, 'news', -10, -10, W, H + 20, u); g.restore(); g.restore();
      g.save(); g.translate((1 - sl) * W * .5, 0); g.beginPath(); g.moveTo(W + 10, -10); seam.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(W + 10, H + 10); g.closePath(); g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 16 * u * k; g.fillStyle = '#f2ede2'; g.fill(); g.restore(); g.save(); g.clip(); C.paperFill(g, 'kraft', 0, -10, W + 10, H + 20, u); g.restore(); g.restore();
      [[F.img1, F.n1, .74, 0], [F.img2, F.n2, .26, 1]].forEach(([id, nm, x, i]) => { const p = popIn(th, .45 + i * .25, .4); if (p <= 0) return; const [jx, jy, jr] = jit(t, fps, 100 + i, 2.4 * u);
        g.save(); g.globalAlpha = o; g.translate(W * x + jx, H * (V ? .45 : .52) + jy); g.rotate((i ? .04 : -.04) + jr * .3); g.scale(p, p); C.cutout(g, k, imgOr(id, i), 0, 0, H * (V ? .38 : .66), { u, seed: 5 + i }); g.restore();
        if (nm) { g.save(); g.globalAlpha = o * E.o3(seg(th, 1.0 + i * .2, 1.3 + i * .2)); scrapText(g, k, nm, W * x, H * (V ? .72 : .88), u, { size: 44 * u, rot: i ? 2 : -2, bg: '#1d1b19', color: '#f1ebdd', seed: 60 + i, wt: 900 }); g.restore(); } });
      const sp = seg(th, 1.5, 1.65); if (sp > 0) { g.save(); g.globalAlpha = o * Math.min(1, sp * 2); g.translate(W / 2, H * .45); g.rotate(-.12); const sc = 1 + (1 - E.o3(sp)) * 1.6; g.scale(sc, sc); C.stamp(g, k, F.vs, { u, size: 90, shape: 'circle', seed: 2, blend: 'source-over' }); g.restore(); } } });
  // thumbnails: the scenes look best near the end of their build-up
  const HERO = { 'cl-bg': 1, 'cl-tape': 1, 'cl-scrap': 1.2, 'cl-stamp': 1.2, 'cl-scribble': 1.5, 'cl-polaroid': 1.4, 'cl-clipping': 1.4, 'cl-folder': 2.2, 'cl-mapscrap': 2.6, 'cl-scene-news': 3.2, 'cl-scene-stack': 2.6, 'cl-scene-board': 4.6, 'cl-scene-file': 2.6, 'cl-scene-map': 3, 'cl-scene-ransom': 3.6, 'cl-scene-title': 2.2, 'cl-scene-timeline': 4.4, 'cl-scene-vs': 2.4 };
  const heroT0 = MG.heroT; MG.heroT = (id) => HERO[id] != null ? HERO[id] : heroT0(id);
  C.ids = () => MG.list.filter(T => T.cat === 'collage').map(T => T.id);
  // template image fields: list of image media for the editor; MG.renderEdit calls MG.imgField for t:'img'
  MG.imgField = (fd, v, on) => {
    const wrap = document.createElement('div'); wrap.className = 'cl-imgf';
    const s = document.createElement('select'); s.className = 'sel'; s.dataset.mgf = fd.k;
    const fill = () => { s.innerHTML = ''; const o0 = document.createElement('option'); o0.value = ''; o0.textContent = tr('— صورة افتراضية —'); s.append(o0); for (const m of GW.prj.media.filter(x => x.kind === 'image')) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; s.append(o); } s.value = v || ''; };
    fill(); s.onchange = () => { v = s.value; on(v, true); };
    const imp = document.createElement('button'); imp.className = 'btn sm'; imp.innerHTML = GW.ico('import', 13); imp.title = tr('استيراد صورة'); imp.onclick = async () => { const before = new Set(GW.prj.media.map(m => m.id)); await GW.Media.importDialog(); const nm = GW.prj.media.find(m => !before.has(m.id) && m.kind === 'image'); fill(); if (nm) { v = nm.id; s.value = v; on(v, true); } };
    const cut = document.createElement('button'); cut.className = 'btn sm'; cut.innerHTML = GW.ico('scissors', 13); cut.title = tr('قص خلفية الصورة المختارة'); cut.onclick = async () => { const m = v && GW.media(v); if (!m) { GW.toast(tr('اختر صورة أولًا')); return; } try { const r = await GW.Cutout.run({ media: m, refine: true, addToTimeline: false, look: false }); if (r && r.media) { fill(); v = r.media.id; s.value = v; on(v, true); } } catch (e) { if (!e.cancelled) GW.toast(e.message, 'err'); } };
    wrap.append(s, imp, cut); return wrap;
  };
  const css = document.createElement('style'); css.textContent = `.cl-imgf{display:flex;gap:4px;align-items:center}.cl-imgf .sel{flex:1;min-width:0}`; document.head.append(css);
})();
