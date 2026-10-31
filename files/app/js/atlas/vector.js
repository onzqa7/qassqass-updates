'use strict';
/* GeoWar Atlas — vector layers drawn with Canvas2D on top of the GL globe:
   countries (any era), borders, coasts, rivers, labels, and animated war layers. */
(function () {
  const A = GW.Atlas; const G = A.Geo; const S = A.Scene; const Cm = A.Cam; const v3 = Cm.v3;
  const V = A.Vec = {};
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgba = (h, a) => { const c = S.rgb(h); return `rgba(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0},${a})`; };
  const shade = (h, k) => { const c = S.rgb(h).map(x => clamp(k > 0 ? x + (1 - x) * k : x * (1 + k), 0, 1)); return `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`; };
  V.rgba = rgba; V.shade = shade;
  // extension hooks (war.js): fill = under the base borders, mid = before map labels, top = after markers, before screen overlays
  V.hooks = { fill: [], mid: [], top: [] };
  V.runHooks = (kind, HK) => { for (const fn of V.hooks[kind]) { try { fn(HK); } catch (e) { console.error('atlas hook ' + kind, e); } } };
  const isAr = (s) => /[؀-ۿ]/.test(s || '');
  const noise1 = (x, s) => Math.sin(x * 1.7 + s) * .5 + Math.sin(x * 3.3 + s * 1.9) * .3 + Math.sin(x * 7.1 + s * 3.7) * .2;

  /* ---------------- patterns ---------------- */
  const patCache = new Map();
  function pattern(ctx, kind, color, k) {
    const key = kind + color + Math.round(k * 4); let p = patCache.get(key);
    if (p) return ctx.createPattern(p, 'repeat');
    const s = Math.max(6, Math.round(12 * k)); const c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(1, 2.2 * k);
    if (kind === 'hatch') { g.beginPath(); g.moveTo(-s, s); g.lineTo(s, -s); g.moveTo(0, 2 * s); g.lineTo(2 * s, 0); g.moveTo(-s / 2, s * 1.5); g.lineTo(s * 1.5, -s / 2); g.stroke(); }
    else if (kind === 'cross') { g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke(); }
    else if (kind === 'dots') { g.beginPath(); g.arc(s / 2, s / 2, Math.max(1, s * .16), 0, 7); g.fill(); }
    else if (kind === 'grid') { g.strokeRect(0, 0, s, s); }
    patCache.set(key, c); return ctx.createPattern(c, 'repeat');
  }

  /* ---------------- icons ---------------- */
  const P2 = {};
  const PATHS = {
    plane: 'M12 1.5c.8 0 1.4.9 1.4 2v5.6l8.1 4.9v2l-8.1-2.5v5l2.2 1.6V22L12 21l-3.6 1v-1.9l2.2-1.6v-5L2.5 16v-2l8.1-4.9V3.5c0-1.1.6-2 1.4-2z',
    jet: 'M12 1l1.6 5.5 1 5.2 7.4 4.3v1.8l-7.3-1.6-.6 3.8 2.6 1.8V23L12 21.8 7.3 23v-1.2l2.6-1.8-.6-3.8-7.3 1.6V16l7.4-4.3 1-5.2z',
    ship: 'M12 1.5l4.2 6.5v12.2c0 1.6-1.9 2.3-4.2 2.3s-4.2-.7-4.2-2.3V8z M12 9.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z',
    tank: 'M6.5 7.5h11v14h-11z M9 10h6v6.5H9z M11.2 1h1.6v10.5h-1.6z',
    missile: 'M12 .8c1.7 2.4 2.2 4.6 2.2 6.6v8.4l3.2 3.9-3.2-.9-1 3.6h-2.4l-1-3.6-3.2.9 3.2-3.9V7.4c0-2 .5-4.2 2.2-6.6z',
    heli: 'M11 4h2v3.2c2.6.5 4.2 2.8 4.2 5.8 0 3-1.7 5.2-4.2 5.6v4.4h-2v-4.4c-2.5-.4-4.2-2.6-4.2-5.6 0-3 1.6-5.3 4.2-5.8z M2 5.5h20v1.4H2z',
    soldier: 'M12 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z M8 9h8l1.5 7h-2.5l-.7 7h-4.6l-.7-7H6.5z',
    pin: 'M12 1.5C8 1.5 5 4.6 5 8.5c0 5.3 7 14 7 14s7-8.7 7-14c0-3.9-3-7-7-7zm0 9.7a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4z',
    flag: 'M5 2h1.8v20H5z M7.5 3h12l-3 4.5 3 4.5h-12z',
    star: 'M12 1.8l3.1 6.6 7.1.8-5.3 4.9 1.5 7.1L12 17.6l-6.4 3.6 1.5-7.1-5.3-4.9 7.1-.8z',
    anchor: 'M11 2h2v3.1a2.6 2.6 0 1 1-2 0z M11 8h2v11.8c3-.4 5.4-2.6 5.9-5.5l-2-.1 3.3-3.6 2.6 4-1.9-.1C20.3 18.8 16.5 22 12 22s-8.3-3.2-8.9-7.5l-1.9.1 2.6-4 3.3 3.6-2 .1c.5 2.9 2.9 5.1 5.9 5.5z',
    fire: 'M12 1c1 4 6 6.5 6 12.5A6 6 0 0 1 6 13.5c0-2.6 1.3-4.3 2.5-5.4.2 2 1 3.3 2.2 3.8C10.3 8 10.7 4.4 12 1z',
  };
  V.ICONS = [['explosion', 'انفجار'], ['battle', 'معركة'], ['fire', 'حريق'], ['target', 'هدف'], ['nuke', 'نووي'], ['capital', 'عاصمة'], ['city', 'مدينة'], ['star', 'نجمة'], ['pin', 'دبوس'], ['flag', 'علم'], ['plane', 'طائرة'], ['jet', 'مقاتلة'], ['heli', 'مروحية'], ['missile', 'صاروخ'], ['ship', 'سفينة'], ['anchor', 'ميناء'], ['tank', 'دبابة'], ['soldier', 'جندي'], ['inf', 'مشاة (ناتو)'], ['armor', 'مدرعات (ناتو)'], ['art', 'مدفعية (ناتو)'], ['hq', 'قيادة'], ['dot', 'نقطة']];
  const path2 = (k) => P2[k] || (P2[k] = new Path2D(PATHS[k]));
  // draw icon centred at x,y with size s px (≈ height), rotation rot (rad), time t (for animated ones)
  V.icon = (ctx, kind, x, y, s, color, rot, t, alpha) => {
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.globalAlpha *= alpha == null ? 1 : alpha;
    const k = s / 24;
    if (typeof kind === 'string' && kind.startsWith('lib:') && GW.ShapeLib) { ctx.scale(k, k); if (!GW.ShapeLib.icon(ctx, kind.slice(4), color)) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill(); } ctx.restore(); return; } // library pictogram (shape_lib.js)
    if (PATHS[kind]) {
      ctx.scale(k, k); ctx.translate(-12, -12);
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6; ctx.fillStyle = color; ctx.fill(path2(kind));
      ctx.shadowBlur = 0; ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke(path2(kind));
    } else if (kind === 'explosion') {
      const n = 14; ctx.beginPath(); for (let i = 0; i <= n * 2; i++) { const a = i / (n * 2) * Math.PI * 2; const r = (i % 2 ? .45 : 1) * s * .55 * (1 + .18 * Math.sin(i * 2.7 + (t || 0) * 9)); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * .6); g.addColorStop(0, '#fff7c2'); g.addColorStop(.35, '#ffcc33'); g.addColorStop(.7, color || '#ff5a1f'); g.addColorStop(1, '#a3120a');
      ctx.shadowColor = color || '#ff5a1f'; ctx.shadowBlur = s * .5; ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0;
    } else if (kind === 'battle') {
      ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = s * .16;
      const sw = (sg) => { ctx.save(); ctx.rotate(sg * Math.PI / 4); ctx.beginPath(); ctx.moveTo(0, -s * .5); ctx.lineTo(0, s * .38); ctx.stroke(); ctx.restore(); };
      sw(1); sw(-1); ctx.strokeStyle = color; ctx.lineWidth = s * .09; sw(1); sw(-1);
      ctx.fillStyle = color; for (const sg of [1, -1]) { ctx.save(); ctx.rotate(sg * Math.PI / 4); ctx.fillRect(-s * .16, s * .22, s * .32, s * .07); ctx.restore(); }
    } else if (kind === 'target') {
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, s * .08); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(0, 0, s * .4, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, s * .16, 0, 7); ctx.stroke();
      ctx.beginPath(); for (const [a, b] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { ctx.moveTo(a * s * .25, b * s * .25); ctx.lineTo(a * s * .58, b * s * .58); } ctx.stroke();
    } else if (kind === 'nuke') {
      ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(0, 0, s * .5, 0, 7); ctx.fill(); ctx.fillStyle = '#111';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, s * .44, (i * 120 - 120) * RAD, (i * 120 - 60) * RAD); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(0, 0, s * .13, 0, 7); ctx.fill(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 0, s * .08, 0, 7); ctx.fill();
    } else if (kind === 'capital' || kind === 'city' || kind === 'dot') {
      const r = kind === 'capital' ? s * .32 : kind === 'city' ? s * .2 : s * .26;
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4; ctx.fillStyle = kind === 'dot' ? color : '#fff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1.2, r * .35); ctx.strokeStyle = kind === 'dot' ? '#fff' : (color || '#111'); ctx.stroke();
      if (kind === 'capital') { ctx.fillStyle = color || '#111'; ctx.beginPath(); ctx.arc(0, 0, r * .42, 0, 7); ctx.fill(); }
    } else if (kind === 'inf' || kind === 'armor' || kind === 'art' || kind === 'hq') {
      const w = s * .95, h = s * .62; ctx.fillStyle = color; ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.2, s * .05);
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 5; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.shadowBlur = 0; ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.beginPath();
      if (kind === 'inf') { ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.moveTo(w / 2, -h / 2); ctx.lineTo(-w / 2, h / 2); }
      else if (kind === 'armor') ctx.ellipse(0, 0, w * .32, h * .26, 0, 0, 7);
      else if (kind === 'art') { ctx.arc(0, 0, h * .14, 0, 7); ctx.fillStyle = '#111'; ctx.fill(); }
      else { ctx.moveTo(-w / 2, -h / 2 - h * .1); ctx.lineTo(-w / 2, h / 2 + h * .9); }
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ---------------- text ---------------- */
  // fam = installed or bundled family; Thmanyah families (installed by the user, never bundled) fall back to "thmanyah sans" then Cairo
  function font(px, weight, fam, italic) { const f = String(fam || 'Cairo'); return `${italic ? 'italic ' : ''}${weight || 700} ${Math.max(1, px).toFixed(1)}px "${f}", ${f.startsWith('thmanyah') && f !== 'thmanyah sans' ? '"thmanyah sans", ' : ''}"Cairo", "Segoe UI", sans-serif`; }
  V.font = font;
  function haloText(ctx, s, x, y, px, ink, halo, fam, weight, align, spacing) {
    ctx.font = font(px, weight, fam); ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.direction = isAr(s) ? 'rtl' : 'ltr';
    if ('letterSpacing' in ctx) ctx.letterSpacing = isAr(s) ? '0px' : ((spacing || 0) * px).toFixed(1) + 'px';
    if (halo === 'soft' || (halo && halo.startsWith && halo.startsWith('soft'))) { // documentary 'soft shadow': blurred drop shadow, no hard stroke
      const sc = halo.length > 5 ? halo.slice(5) : 'rgba(0,0,0,.78)'; // 'soft:<colour>' = coloured soft shadow
      ctx.save(); ctx.fillStyle = ink; ctx.shadowColor = sc; ctx.shadowBlur = Math.max(4, px * .45); ctx.shadowOffsetY = Math.max(1, px * .07); ctx.fillText(s, x, y);
      ctx.shadowColor = halo.length > 5 ? sc : 'rgba(0,0,0,.45)'; ctx.shadowBlur = Math.max(2, px * .14); ctx.shadowOffsetY = Math.max(1, px * .03); ctx.fillText(s, x, y); ctx.restore();
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; return;
    }
    if (halo) { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, px * .22); ctx.strokeStyle = halo; ctx.strokeText(s, x, y); }
    ctx.fillStyle = ink; ctx.fillText(s, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  V.haloText = haloText;
  function measure(ctx, s, px, fam, weight, spacing) { ctx.font = font(px, weight, fam); if ('letterSpacing' in ctx) ctx.letterSpacing = isAr(s) ? '0px' : ((spacing || 0) * px).toFixed(1) + 'px'; const w = ctx.measureText(s).width; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; return w; }
  function plate(ctx, x, y, w, h, fill, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r || h * .2); else ctx.rect(x, y, w, h); ctx.fillStyle = fill; ctx.fill(); }

  /* ---------------- geometry helpers ---------------- */
  // dense screen polyline for a lon/lat path (great-circle segments, optional bulge)
  function geoLine(vw, pts, curve, nPer) {
    const P = pts.map(p => v3.fromLL(p[0], p[1])); const out = [];
    let total = 0; for (let i = 1; i < P.length; i++) total += Math.acos(clamp(v3.dot(P[i - 1], P[i]), -1, 1));
    const nrm = P.length === 2 ? v3.norm(v3.cross(P[0], P[1])) : null; let acc = 0;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i]; const ang = Math.acos(clamp(v3.dot(a, b), -1, 1)); const n = Math.max(6, Math.ceil(ang * DEG * (nPer || 2.5)));
      for (let j = (i === 1 ? 0 : 1); j <= n; j++) {
        const f = j / n; const s0 = Math.sin(ang) || 1e-9; let p = ang < 1e-9 ? a : v3.add(v3.mul(a, Math.sin((1 - f) * ang) / s0), v3.mul(b, Math.sin(f * ang) / s0));
        const g = (acc + f * ang) / (total || 1);
        if (nrm && curve) p = v3.norm(v3.add(p, v3.mul(nrm, Math.sin(Math.PI * g) * curve * total * .5)));
        const ll = v3.toLL(p); const sp = vw.project(ll[0], ll[1]); out.push(sp ? [sp[0], sp[1]] : null);
      }
      acc += ang;
    }
    // keep the longest visible run
    let best = [], cur = []; for (const p of out) { if (p) cur.push(p); else { if (cur.length > best.length) best = cur; cur = []; } } if (cur.length > best.length) best = cur;
    return best;
  }
  V.geoLine = geoLine;
  function cut(pts, p) { // polyline cut at fraction p of its length
    if (pts.length < 2) return pts; const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const tot = L[L.length - 1]; const target = tot * clamp(p, 0, 1); const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) { if (L[i] <= target) out.push(pts[i]); else { const f = (target - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]); out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]); break; } }
    out.tot = tot; return out;
  }
  function smooth(pts, it) { let p = pts; for (let k = 0; k < (it || 1); k++) { if (p.length < 3) return p; const q = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } q.push(p[p.length - 1]); p = q; } return p; }
  // military arrow: tapered body + head
  V.arrow = (ctx, pts, o) => {
    if (pts.length < 2) return; const k = o.k; const w = (o.width || 1) * 13 * k; const style = o.style || 'military';
    const n = pts.length; const tan = []; for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; tan.push([dx / l, dy / l]); }
    const L = [0]; for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); const tot = L[n - 1] || 1;
    const headL = Math.min(tot * .45, w * 2.3), headW = w * 2.3;
    // body ends where the head starts
    let hb = n - 1; while (hb > 0 && tot - L[hb] < headL) hb--;
    const end = pts[n - 1], dirE = tan[n - 1];
    const base = [end[0] - dirE[0] * headL, end[1] - dirE[1] * headL];
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (style === 'line' || style === 'dashed') {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i <= hb; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.lineTo(base[0], base[1]);
      if (style === 'dashed') { ctx.setLineDash([w * .9, w * .7]); ctx.lineDashOffset = -(o.t || 0) * w * 3; }
      ctx.lineWidth = w * .42 + 3 * k; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke(); ctx.lineWidth = w * .42; ctx.strokeStyle = o.color; if (o.glow) { ctx.shadowColor = o.color; ctx.shadowBlur = 12 * k; } ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0;
    } else {
      const left = [], right = [];
      for (let i = 0; i <= hb; i++) { const f = L[i] / tot; const ww = w * (.28 + .5 * Math.pow(f, .7)) / 2; const nx = -tan[i][1], ny = tan[i][0]; left.push([pts[i][0] + nx * ww, pts[i][1] + ny * ww]); right.push([pts[i][0] - nx * ww, pts[i][1] - ny * ww]); }
      const nb = [-dirE[1], dirE[0]]; const ww = w * .78 / 2;
      left.push([base[0] + nb[0] * ww, base[1] + nb[1] * ww]); right.push([base[0] - nb[0] * ww, base[1] - nb[1] * ww]);
      const body = new Path2D(); body.moveTo(left[0][0], left[0][1]); for (const p of left) body.lineTo(p[0], p[1]);
      body.lineTo(base[0] + nb[0] * headW / 2, base[1] + nb[1] * headW / 2); body.lineTo(end[0], end[1]); body.lineTo(base[0] - nb[0] * headW / 2, base[1] - nb[1] * headW / 2);
      for (let i = right.length - 1; i >= 0; i--) body.lineTo(right[i][0], right[i][1]); body.closePath();
      if (o.glow) { ctx.shadowColor = o.color; ctx.shadowBlur = 18 * k; }
      const g = ctx.createLinearGradient(pts[0][0], pts[0][1], end[0], end[1]); g.addColorStop(0, rgba(o.color, .15)); g.addColorStop(.35, rgba(o.color, .85)); g.addColorStop(1, o.color);
      ctx.fillStyle = g; ctx.fill(body); ctx.shadowBlur = 0;
      if (o.outline !== 0) { ctx.lineWidth = 1.6 * k; ctx.strokeStyle = shade(o.color, -.55); ctx.stroke(body); }
      if (style === 'double') { ctx.lineWidth = 1.2 * k; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i <= hb; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); }
      return ctx.restore();
    }
    // head for line styles
    const nb = [-dirE[1], dirE[0]]; ctx.beginPath(); ctx.moveTo(end[0], end[1]); ctx.lineTo(base[0] + nb[0] * headW * .4, base[1] + nb[1] * headW * .4); ctx.lineTo(base[0] - nb[0] * headW * .4, base[1] - nb[1] * headW * .4); ctx.closePath();
    ctx.fillStyle = o.color; ctx.fill(); ctx.lineWidth = 1.4 * k; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke(); ctx.restore();
  };

  // noisy geo circle polygon (spreading territory) around c (lon/lat), radius r (rad)
  function blob(c, r, seed, t, rough) {
    const n = 96; const ring = []; const C = v3.fromLL(c[0], c[1]);
    const up = Math.abs(C[2]) < .99 ? [0, 0, 1] : [1, 0, 0]; const e = v3.norm(v3.cross(up, C)), nn = v3.cross(C, e);
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2; const rr = Math.min(Math.PI * .98, r * (1 + (rough == null ? .12 : rough) * noise1(a * 3, seed + (t || 0) * .6)));
      const dir = v3.add(v3.mul(e, Math.cos(a)), v3.mul(nn, Math.sin(a)));
      ring.push(v3.toLL(v3.add(v3.mul(C, Math.cos(rr)), v3.mul(dir, Math.sin(rr)))));
    }
    ring.reverse(); // d3 expects clockwise exterior for small polygons
    return { type: 'Polygon', coordinates: [ring] };
  }
  V.blob = blob;
  // closest vertex of feature f to a point (entry of an invasion)
  const entryCache = new Map();
  function entry(f, from) {
    const k = f.key + '|' + from[0].toFixed(2) + ',' + from[1].toFixed(2) + '|' + f.src; let e = entryCache.get(k); if (e) return e;
    let best = null, bd = 1e9, far = 0; const cs = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const all = []; for (const poly of cs) for (const ring of poly) for (let i = 0; i < ring.length; i += Math.max(1, ring.length / 400 | 0)) all.push(ring[i]);
    for (const p of all) { const d = d3.geoDistance(p, from); if (d < bd) { bd = d; best = p; } }
    for (const p of all) far = Math.max(far, d3.geoDistance(p, best));
    e = { p: best, far: far || .05 }; entryCache.set(k, e); if (entryCache.size > 400) entryCache.delete(entryCache.keys().next().value); return e;
  }
  // morphable polygon: resample a lon/lat ring to n points
  function resample(ring, n) {
    if (ring.length < 3) return ring; const r = ring.concat([ring[0]]); const L = [0]; for (let i = 1; i < r.length; i++) L.push(L[i - 1] + Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]));
    const tot = L[L.length - 1]; const out = []; let j = 1;
    for (let i = 0; i < n; i++) { const d = tot * i / n; while (j < L.length - 1 && L[j] < d) j++; const f = (d - L[j - 1]) / Math.max(1e-9, L[j] - L[j - 1]); out.push([r[j - 1][0] + (r[j][0] - r[j - 1][0]) * f, r[j - 1][1] + (r[j][1] - r[j - 1][1]) * f]); }
    return out;
  }
  V.frontRing = (L, lt) => {
    const ks = (L.shapes || []).filter(s => s.pts && s.pts.length >= 3);
    if (!ks.length) return L.pts && L.pts.length >= 3 ? L.pts : null;
    if (ks.length === 1 || lt <= ks[0].t) return ks[0].pts; if (lt >= ks[ks.length - 1].t) return ks[ks.length - 1].pts;
    let i = 0; while (i < ks.length - 1 && ks[i + 1].t <= lt) i++; const a = ks[i], b = ks[i + 1]; const f = S.ease((lt - a.t) / Math.max(1e-6, b.t - a.t));
    const n = 160; const ra = resample(a.pts, n), rb0 = resample(b.pts, n);
    // align start points to minimise twisting
    let best = 0, bd = 1e18; for (let s = 0; s < n; s += 2) { let d = 0; for (let q = 0; q < n; q += 8) { const p = ra[q], r = rb0[(q + s) % n]; d += (p[0] - r[0]) ** 2 + (p[1] - r[1]) ** 2; } if (d < bd) { bd = d; best = s; } }
    return ra.map((p, q) => { const r = rb0[(q + best) % n]; return [p[0] + (r[0] - p[0]) * f, p[1] + (r[1] - p[1]) * f]; });
  };
  const ringGeo = (ring) => { const r = ring.concat([ring[0]]); let s = 0; for (let i = 1; i < r.length; i++) s += (r[i][0] - r[i - 1][0]) * (r[i][1] + r[i - 1][1]); return { type: 'Polygon', coordinates: [s < 0 ? r.slice().reverse() : r] }; };
  V.ringGeo = ringGeo;

  /* ---------------- images (portraits) ---------------- */
  const imgCache = new Map();
  V.img = (sc, id) => { const src = sc.images && sc.images[id]; if (!src) return null; let im = imgCache.get(id); if (!im || im._src !== src) { im = new Image(); im._src = src; im.onload = () => A.onAsset && A.onAsset(); im.src = src; imgCache.set(id, im); } return im.complete && im.naturalWidth ? im : null; };
  V.imgsReady = (sc) => Promise.all(Object.keys(sc.images || {}).map(id => new Promise(r => { V.img(sc, id); const im = imgCache.get(id); if (!im || im.complete) r(); else { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }); } })));

  // Arabic name for a (historical) capital via the Natural Earth places table
  let capMap = null;
  function capAr(n) {
    if (!capMap && G.places) { capMap = new Map(); for (const p of G.places) { if (p[3]) { capMap.set(p[2].toLowerCase(), p[3]); } } for (const k in (G.capArExtra || {})) capMap.set(k.toLowerCase(), G.capArExtra[k]); }
    if (!capMap) return n;
    const tries = [n, n.replace(/\s*\(.*?\)\s*/g, ' ').trim(), (n.match(/\(([^)]+)\)/) || [])[1], n.split(/[\/,]/)[0].trim()];
    for (const t of tries) { if (t && capMap.has(t.toLowerCase())) return capMap.get(t.toLowerCase()); }
    return n;
  }
  V.capAr = capAr;
  // radius (rad) of a feature's largest polygon (islands far away must not inflate the label)
  const mainRC = new WeakMap();
  function mainR(f) {
    let r = mainRC.get(f); if (r != null) return r; const g0 = f.geometry; r = f.rad;
    if (g0 && g0.type === 'MultiPolygon' && g0.coordinates.length > 1) { let best = null, ba = -1; for (const pc of g0.coordinates) { const a = d3.geoArea({ type: 'Polygon', coordinates: pc }); if (a < 2 * Math.PI && a > ba) { ba = a; best = pc; } } if (best) { const bb = d3.geoBounds({ type: 'Polygon', coordinates: best }); r = Math.min(f.rad, d3.geoDistance(bb[0], bb[1]) / 2); } }
    mainRC.set(f, r); return r;
  }
  // choropleth helpers
  V.parseData = (txt) => String(txt || '').split(/\n+/).map(l => l.split(/[,،\t;]+/).map(x => x.trim())).filter(r => r.length >= 2 && r[0] && !isNaN(parseFloat(r[1]))).map(r => [r[0], parseFloat(r[1])]);
  const lerpCol = (a, b, t) => { const A = S.rgb(a), B = S.rgb(b); return `rgb(${(A[0] + (B[0] - A[0]) * t) * 255 | 0},${(A[1] + (B[1] - A[1]) * t) * 255 | 0},${(A[2] + (B[2] - A[2]) * t) * 255 | 0})`; };
  V.lerpCol = lerpCol;

  /* ======================= main draw ======================= */
  V.draw = (cvB, cvT, vw, sc, t, cd, E, era, feats, lod, opts) => {
    const W = vw.W, H = vw.H; const k = vw.pxScale; const L = sc.look; const st = E.st; const lang = L.lang || 'ar'; const fam = E.font;
    for (const cv of [cvB, cvT]) { cv.width = W; cv.height = H; } // full reset (state + pixels)
    const b = cvB.getContext('2d'), g = cvT.getContext('2d');
    const pb = d3.geoPath(vw.proj, b), pg = d3.geoPath(vw.proj, g);
    const nad = vw.mode === 'globe' ? v3.toLL(vw.C) : [vw.lon, vw.lat];
    const capR = vw.mode === 'globe' ? vw.horizon : Math.PI;
    const visible = (f) => vw.mode !== 'globe' || d3.geoDistance(f.lab, nad) < capR + f.rad;
    const fv = (feats || []).filter(visible);
    const byKey = new Map(); for (const f of feats || []) if (!byKey.has(f.key)) byKey.set(f.key, f);
    const inv = new Set(); // involved keys (emphasised labels)
    const invLab = new Map(); // key -> label look from the country layer
    const sphere = { type: 'Sphere' };
    const pal = E.palette;
    const land = G.landFor(lod);
    const out = { labels: [], hits: [] };

    if (!opts.vt) {
    /* ---- base: ocean / land / political fills ---- */
    if (E.vector) {
      if (vw.mode === 'globe') { b.beginPath(); pb(sphere); const sc0 = vw.project(vw.lon, vw.lat) || [W / 2, H / 2]; const gr = b.createRadialGradient(sc0[0], sc0[1], 0, sc0[0], sc0[1], Math.max(W, H) * .8); gr.addColorStop(0, st.ocean); gr.addColorStop(1, st.ocean2 || st.ocean); b.fillStyle = gr; b.fill(); }
      else { b.fillStyle = st.ocean; b.fillRect(0, 0, W, H); }
      if (land) { b.beginPath(); pb(land); b.fillStyle = st.land; b.fill(); }
    }
    // land tint over imagery (raster styles): translucent colour on the land polygons
    if (!E.vector && E.landTint && E.landA > 0 && land) { b.save(); b.globalAlpha = E.landA; b.beginPath(); pb(land); b.fillStyle = E.landTint; b.fill(); b.restore(); }
    const fillMode = E.fill;
    if (fillMode !== 'none' && fv.length) {
      b.save();
      if (era.src !== 'modern' && land) { b.beginPath(); pb(land); b.clip(); }
      b.globalAlpha = E.fillA;
      for (const f of fv) { const ci = fillMode === 'empire' ? G.ownerCi(f, byKey) : f.ci; b.beginPath(); pb(f); b.fillStyle = pal[ci % pal.length]; b.fill(); }
      // colonies / protectorates / occupied: hatch in owner colour
      if (era.src === 'cs') { for (const f of fv) { const s0 = f.properties.st; if (s0 === 'independent') continue; b.beginPath(); pb(f); b.globalAlpha = E.fillA * .55; b.fillStyle = pattern(b, s0 === 'occupied' ? 'cross' : 'hatch', 'rgba(0,0,0,.35)', k); b.fill(); } }
      b.restore();
    }
    if (st.grid || L.graticule) { b.beginPath(); pb(E.gridStep && E.gridStep !== 10 ? d3.geoGraticule().step([E.gridStep, E.gridStep]) : d3.geoGraticule10()); b.lineWidth = .8 * k; b.strokeStyle = st.gridC || (E.vector ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.22)'); b.stroke(); }

    }
    /* ---- war layers: fills (under borders) ---- */
    const layers = (sc.layers || []).map(Ly0 => { const s = S.state(Ly0, t, cd); if (!s) return null; const Ly = S.resolve(Ly0, s.lt); if (Ly.opacity != null) s.a *= clamp(+Ly.opacity, 0, 1); return { Ly, s }; }).filter(Boolean);
    const HK = { b, g, pb, pg, vw, sc, t, cd, E, era, feats, byKey, lod, k, W, H, fam, layers, inv, invLab, out, opts, nad, capR };
    for (const { Ly, s } of layers) {
      if (Ly.type === 'country') {
        const fs = Ly.keys.map(kk => byKey.get(kk)).filter(Boolean); fs.forEach(f => { inv.add(f.key); if (!invLab.has(f.key)) invLab.set(f.key, { show: Ly.label !== 0, style: Ly.labelStyle || (st.halo && String(st.halo).startsWith('soft') ? 'soft' : 'plate'), size: Ly.labelSize || 1, text: fs.length === 1 ? Ly.labelText : '', a: s.a * S.easeOut(s.pin) }); }); if (!fs.length) continue;
        const pin = S.easeOut(s.pin); const a = s.a * (Ly.pulse ? .75 + .25 * Math.sin(s.lt * 4) : 1);
        if (Ly.dim) { b.save(); b.beginPath(); vw.mode === 'globe' ? pb(sphere) : b.rect(0, 0, W, H); for (const f of fs) pb(f); b.fillStyle = `rgba(0,0,0,${.55 * pin * s.a})`; b.fill('evenodd'); b.restore(); }
        b.save();
        if (Ly.in === 'spread' && pin < 1) { const f0 = fs[0]; b.beginPath(); pb(blob(f0.lab, Math.max(...fs.map(f => d3.geoDistance(f0.lab, f.lab) + f.rad)) * pin, 3, t, .08)); b.clip(); }
        else if (Ly.in === 'wipe' && pin < 1) { b.beginPath(); b.rect(0, 0, W * pin, H); b.clip(); }
        const fa = Ly.in === 'fade' ? pin : 1;
        for (const f of fs) { const fc = (Ly.colors && Ly.colors[f.key]) || Ly.color; b.beginPath(); pb(f); b.globalAlpha = Ly.fill * fa * a; b.fillStyle = Ly.pattern === 'solid' ? fc : pattern(b, Ly.pattern, Ly.pattern === 'hatch' && Ly.outline === 'dashed' ? shade(fc, .35) : fc, k); b.fill(); if (Ly.pattern !== 'solid') { b.globalAlpha = Ly.fill * fa * a * .35; b.fillStyle = fc; b.fill(); } }
        if (Ly.inner) { // inner edge shading: gives the translucent fill depth (documentary look)
          const pa = new Path2D(); const pp = d3.geoPath(vw.proj, pa); for (const f of fs) pp(f);
          b.save(); b.clip(pa, 'evenodd'); b.globalAlpha = .55 * fa * a; b.lineJoin = 'round'; b.lineWidth = 9 * k; b.strokeStyle = shade(Ly.color, -.55); b.filter = `blur(${(4 * k).toFixed(1)}px)`; b.stroke(pa); b.restore();
        }
        b.restore();
      } else if (Ly.type === 'invasion') {
        const F = byKey.get(Ly.from); const Ts = (Ly.to || []).map(kk => byKey.get(kk)).filter(Boolean); if (!F || !Ts.length) continue; inv.add(F.key); Ts.forEach(f => inv.add(f.key));
        const travel = Ly.inDur || 4; const stagger = Ly.stagger != null ? Ly.stagger : travel * .35; const spreadDur = Ly.spreadDur || travel * 1.2;
        b.save(); b.globalAlpha = .35 * Math.min(1, s.lt / .6) * s.a; b.beginPath(); pb(F); b.fillStyle = Ly.color; b.fill(); b.restore();
        Ts.forEach((T, i) => {
          if (!Ly.spread) return; const t0 = i * stagger + travel * .75; const p = clamp((s.lt - t0) / spreadDur, 0, 1); if (p <= 0) return;
          const en = entry(T, F.lab); const r = S.ease(p) * en.far * 1.05 * (Ly.occupy == null ? 1 : Ly.occupy);
          const geo = blob(en.p, Math.max(1e-4, r), i * 7 + 1, t, .1);
          b.save(); b.beginPath(); pb(T); b.clip(); b.beginPath(); pb(geo); b.globalAlpha = .62 * s.a; b.fillStyle = Ly.color; b.fill();
          b.globalAlpha = .35 * s.a; b.fillStyle = pattern(b, 'hatch', shade(Ly.color, -.5), k); b.fill(); b.restore();
          (V._fronts = V._fronts || []).push({ T, geo, color: Ly.color, a: s.a * (p < 1 ? 1 : .35) });
        });
      } else if (Ly.type === 'front' && Ly.mode !== 'attack') {
        let geo = null; const ring = V.frontRing(Ly, s.lt);
        if (ring) geo = ringGeo(ring); else { const fs = (Ly.keys || []).map(kk => byKey.get(kk)).filter(Boolean); if (fs.length) geo = { type: 'GeometryCollection', geometries: fs.map(f => f.geometry) }; }
        if (!geo) continue; const pin = S.easeOut(s.pin);
        b.save(); b.globalAlpha = Ly.fill * pin * s.a; b.beginPath(); pb(geo); b.fillStyle = Ly.color; b.fill();
        if (Ly.pattern && Ly.pattern !== 'solid') { b.globalAlpha = Math.min(1, Ly.fill * 1.4) * pin * s.a; b.fillStyle = pattern(b, Ly.pattern, shade(Ly.color, -.45), k); b.fill(); }
        b.restore(); Ly._geo = geo;
      } else if (Ly.type === 'data') {
        const rows = Ly._rows && Ly._rowsSrc === Ly.data + '|' + era.id ? Ly._rows : null; let rr = rows;
        if (!rr) { rr = []; for (const [name, val] of V.parseData(Ly.data)) { const hit = G.search(name, feats, 'ar', era, 3).find(x => x.kind === 'country'); if (hit) rr.push([hit.key, val]); } Object.defineProperty(Ly, '_rows', { value: rr, writable: true, configurable: true, enumerable: false }); Object.defineProperty(Ly, '_rowsSrc', { value: Ly.data + '|' + era.id, writable: true, configurable: true, enumerable: false }); }
        if (!rr.length) continue; const vals = rr.map(r => r[1]); const lo = Math.min(...vals), hi = Math.max(...vals); const pin = S.easeOut(s.pin);
        b.save(); b.globalAlpha = (Ly.fill == null ? .85 : Ly.fill) * s.a;
        rr.forEach(([key, val], i) => { const f = byKey.get(key); if (!f) return; inv.add(f.key); const tt = hi > lo ? (val - lo) / (hi - lo) : 1; const grow = Ly.in === 'grow' ? clamp(pin * rr.length - i * .5, 0, 1) : pin; if (grow <= 0) return; b.globalAlpha = (Ly.fill == null ? .85 : Ly.fill) * s.a * grow; b.beginPath(); pb(f); b.fillStyle = lerpCol(Ly.c0 || '#fde68a', Ly.c1 || '#b91c1c', tt); b.fill(); });
        b.restore(); Ly._dr = { rr, lo, hi };
      } else if (Ly.type === 'range') {
        const pin = S.easeOut(s.pin); const r = Ly.km / 6371 * pin; const c = d3.geoCircle().center([Ly.lon, Ly.lat]).radius(r * DEG).precision(1)();
        b.save(); b.globalAlpha = Ly.fill * s.a; b.beginPath(); pb(c); b.fillStyle = Ly.color; b.fill(); b.restore(); Ly._c = c;
      }
    }

    V.runHooks('fill', HK);
    if (!opts.vt) {
    /* ---- top: water, borders, coasts ---- */
    if ((L.lakes || L.rivers) && lod >= 0) { G.loadWater(); }
    if (L.rivers && G.rivers) { g.save(); g.beginPath(); pg(G.rivers); g.lineWidth = .9 * k; g.strokeStyle = E.vector ? shade(st.ocean, -.1) : 'rgba(120,180,255,.6)'; g.stroke(); g.restore(); }
    if (L.lakes && G.lakes && E.vector) { g.beginPath(); pg(G.lakes); g.fillStyle = st.ocean; g.fill(); }
    if (L.provinces && era.src === 'modern') { G.loadAdmin1(); if (G.admin1) { g.save(); g.beginPath(); for (const f of G.admin1) if (vw.mode !== 'globe' || d3.geoDistance(f.lab, nad) < capR + f.rad) pg(f); g.setLineDash([3 * k, 3 * k]); g.lineWidth = .7 * k; g.strokeStyle = E.vector ? rgba('#888888', .5) : 'rgba(255,255,255,.35)'; g.stroke(); g.restore(); } }
    if (L.borders && fv.length) {
      g.save(); if (era.src !== 'modern' && land) { g.beginPath(); pg(land); g.clip(); }
      g.beginPath(); for (const f of fv) pg(f); g.lineJoin = 'round';
      const bw = (st.bw || 1) * (L.borderW || 1) * k * (vw.zoom > 5 ? 1.3 : 1);
      if (st.glow) { g.shadowColor = st.border; g.shadowBlur = 8 * k; }
      if (!E.vector) { g.lineWidth = bw * 2.6; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke(); }
      if (st.dash) g.setLineDash([5 * bw, 4 * bw]);
      g.lineWidth = bw; g.strokeStyle = st.border; g.stroke(); g.restore();
    }
    if (L.coast && E.vector && land) { g.beginPath(); pg(land); g.lineWidth = 1.1 * k; g.strokeStyle = st.coast || st.border; g.stroke(); }
    // disputed / dependent territories (CShapes: colonies, occupied) — border style override
    if (L.borders && era.src === 'cs' && E.disputed !== 'dashed') { for (const f of fv) { if (f.properties.st === 'independent') continue; g.save(); g.beginPath(); pg(f); if (E.disputed === 'hidden') { g.globalCompositeOperation = 'destination-out'; g.lineWidth = 3 * k; g.strokeStyle = '#000'; g.stroke(); } else { g.lineWidth = (st.bw || 1) * (L.borderW || 1) * k; g.strokeStyle = st.border; g.stroke(); } g.restore(); } }

    }
    /* ---- war layers: strokes, arrows, markers ---- */
    const fronts = V._fronts || []; V._fronts = null;
    for (const fr of fronts) { g.save(); g.beginPath(); pg(fr.T); g.clip(); g.beginPath(); pg(fr.geo); g.globalAlpha = fr.a; g.lineWidth = 2.6 * k; g.strokeStyle = shade(fr.color, .35); g.shadowColor = fr.color; g.shadowBlur = 14 * k; g.stroke(); g.restore(); }
    const late = []; // markers/labels drawn after map labels
    for (const { Ly, s } of layers) {
      const pin = S.easeOut(s.pin);
      if (Ly.type === 'country') {
        const fs = Ly.keys.map(kk => byKey.get(kk)).filter(Boolean); if (!fs.length || !Ly.stroke || Ly.outline === 'none') continue;
        g.save(); g.beginPath(); for (const f of fs) pg(f); g.lineJoin = 'round'; g.globalAlpha = s.a * (Ly.in === 'fade' ? pin : 1);
        if (Ly.glow) { g.shadowColor = Ly.color; g.shadowBlur = 16 * k; } else if (Ly.line) { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 3 * k; }
        if (Ly.outline === 'dashed') { g.setLineDash([6 * k * Ly.stroke, 4.5 * k * Ly.stroke]); g.lineCap = 'butt'; }
        g.lineWidth = Ly.stroke * 1.2 * k; g.strokeStyle = Ly.line || shade(Ly.color, .25); g.stroke(); g.restore();
      } else if (Ly.type === 'invasion') {
        const F = byKey.get(Ly.from); const Ts = (Ly.to || []).map(kk => byKey.get(kk)).filter(Boolean); if (!F || !Ts.length) continue;
        const travel = Ly.inDur || 4; const stagger = Ly.stagger != null ? Ly.stagger : travel * .35;
        Ts.forEach((T, i) => {
          const p = clamp((s.lt - i * stagger) / travel, 0, 1); if (p <= 0) return;
          if (Ly.arrows) { const ef = entry(F, T.lab).p; const st0 = d3.geoInterpolate(ef, F.lab)(Math.min(.35, .9 / Math.max(1, d3.geoDistance(ef, F.lab) * 30))); const en = entry(T, F.lab).p; const tip = d3.geoInterpolate(en, T.lab)(.55); const line = geoLine(vw, [st0, tip], Ly.curve == null ? .25 : Ly.curve); const c = cut(smooth(line, 1), S.ease(p)); g.save(); g.globalAlpha = s.a; V.arrow(g, c, { k, width: Ly.width || 1, color: Ly.color, style: Ly.arrowStyle || 'military', glow: 1, t }); g.restore(); }
          const tImp = s.lt - i * stagger - travel; if (Ly.impacts && tImp > 0 && tImp < 1.6) { const ip = d3.geoInterpolate(entry(T, F.lab).p, T.lab)(.55); const sp = vw.project(ip[0], ip[1]); if (sp) { const q = tImp / 1.6; late.push(() => { g.save(); g.globalAlpha = s.a * (1 - Math.pow(q, 3)); V.icon(g, 'explosion', sp[0], sp[1], (28 + 46 * S.easeOut(Math.min(1, q * 3))) * k, Ly.color, 0, t); g.restore(); }); } }
        });
      } else if (Ly.type === 'arrow' && Ly.pts && Ly.pts.length >= 2) {
        const line = geoLine(vw, Ly.pts, Ly.curve || 0); const p = Ly.in === 'draw' ? S.ease(s.pin) : 1; const c = cut(smooth(line, 2), p);
        g.save(); g.globalAlpha = s.a * (Ly.in === 'fade' ? pin : 1); V.arrow(g, c, { k, width: Ly.width, color: Ly.color, style: Ly.style, glow: Ly.glow, outline: Ly.outline, t }); g.restore();
      } else if (Ly.type === 'front' && Ly._geo) {
        g.save(); g.globalAlpha = s.a * pin; g.beginPath(); pg(Ly._geo); g.lineJoin = 'round'; g.lineWidth = Ly.stroke * 1.3 * k; g.strokeStyle = shade(Ly.color, -.2); g.shadowColor = Ly.color; g.shadowBlur = 8 * k; g.stroke();
        if (Ly.teeth) { g.setLineDash([2 * k, 7 * k]); g.lineWidth = Ly.stroke * 4 * k; g.strokeStyle = Ly.color; g.shadowBlur = 0; g.stroke(); }
        g.restore(); delete Ly._geo;
      } else if (Ly.type === 'range' && Ly._c) {
        g.save(); g.globalAlpha = s.a; g.beginPath(); pg(Ly._c); g.lineWidth = 2 * k; g.strokeStyle = Ly.color; g.shadowColor = Ly.color; g.shadowBlur = 10 * k; g.stroke();
        if (Ly.pulse) for (let i = 0; i < (Ly.rings || 3); i++) { const ph = ((s.lt * .6 + i / (Ly.rings || 3)) % 1); const c2 = d3.geoCircle().center([Ly.lon, Ly.lat]).radius(Ly.km / 6371 * DEG * ph).precision(2)(); g.beginPath(); pg(c2); g.globalAlpha = s.a * (1 - ph) * .8; g.lineWidth = 1.5 * k; g.stroke(); }
        g.restore(); delete Ly._c;
        if (Ly.text) { const sp = vw.project(Ly.lon, Ly.lat); if (sp) late.push(() => haloText(g, Ly.text, sp[0], sp[1] - 18 * k, 17 * k, '#fff', 'rgba(0,0,0,.8)', fam, 800)); }
        const sp0 = vw.project(Ly.lon, Ly.lat); if (sp0) late.push(() => V.icon(g, 'dot', sp0[0], sp0[1], 12 * k, Ly.color, 0, t, s.a));
      } else if (Ly.type === 'data' && Ly._dr) {
        const { rr, lo, hi } = Ly._dr; delete Ly._dr;
        if (Ly.values) for (const [key, val] of rr) { const f = byKey.get(key); if (!f) continue; const sp = vw.project(f.lab[0], f.lab[1]); if (!sp) continue; late.push(() => { g.save(); g.globalAlpha = s.a * pin; haloText(g, (Ly.prefix || '') + val.toLocaleString('en') + (Ly.suffix || ''), sp[0], sp[1] + 18 * k, 15 * k, '#fff', 'rgba(0,0,0,.85)', fam, 800); g.restore(); }); }
        if (Ly.legend !== 0) late.push(() => { g.save(); g.globalAlpha = s.a * pin; const w = 260 * k, h = 14 * k; const x0 = (W - w) / 2, y0 = H - 70 * k; const gr = g.createLinearGradient(x0, 0, x0 + w, 0); gr.addColorStop(0, Ly.c0 || '#fde68a'); gr.addColorStop(1, Ly.c1 || '#b91c1c'); plate(g, x0 - 12 * k, y0 - 34 * k, w + 24 * k, h + 62 * k, 'rgba(6,9,14,.72)', 8 * k); if (Ly.title) haloText(g, Ly.title, x0 + w / 2, y0 - 18 * k, 15 * k, '#fff', null, fam, 800); g.fillStyle = gr; g.fillRect(x0, y0, w, h); haloText(g, lo.toLocaleString('en'), x0, y0 + h + 13 * k, 12 * k, '#cfd8e3', null, fam, 700, 'left'); haloText(g, hi.toLocaleString('en'), x0 + w, y0 + h + 13 * k, 12 * k, '#cfd8e3', null, fam, 700, 'right'); g.restore(); });
      } else if (Ly.type === 'route' && Ly.pts && Ly.pts.length >= 2) {
        const line = smooth(geoLine(vw, Ly.pts, Ly.curve || .15), 2); const p = S.ease(s.pin); const c = cut(line, p); if (c.length < 2) continue;
        g.save(); g.globalAlpha = s.a; g.lineCap = 'round'; g.beginPath(); g.moveTo(c[0][0], c[0][1]); for (const q of c) g.lineTo(q[0], q[1]);
        if (Ly.dashed) g.setLineDash([7 * k, 7 * k]); g.lineWidth = 2.4 * k * (Ly.width || 1); g.strokeStyle = 'rgba(0,0,0,.5)'; g.stroke(); g.lineWidth = 1.6 * k * (Ly.width || 1); g.strokeStyle = Ly.color; g.stroke(); g.restore();
        const e = c[c.length - 1], e0 = c[Math.max(0, c.length - 3)]; const ang = Math.atan2(e[1] - e0[1], e[0] - e0[0]) + Math.PI / 2;
        late.push(() => V.icon(g, Ly.icon || 'plane', e[0], e[1], 30 * k * (Ly.size || 1), Ly.color, ang, t, s.a));
      } else if (Ly.type === 'marker') {
        const sp = vw.project(Ly.lon, Ly.lat); if (!sp) continue;
        late.push(() => {
          const sc2 = Ly.in === 'pop' ? Math.max(0, S.back(s.pin)) : 1; const a = s.a * (Ly.in === 'fade' ? pin : 1); const sz = 30 * k * (Ly.size || 1) * (Ly.scale == null ? 1 : Ly.scale);
          if (Ly.pulse) { for (let i = 0; i < 2; i++) { const ph = (s.lt * .8 + i * .5) % 1; g.save(); g.globalAlpha = a * (1 - ph) * .7; g.strokeStyle = Ly.color; g.lineWidth = 2 * k; g.beginPath(); g.arc(sp[0], sp[1], sz * (.4 + ph * 1.4), 0, 7); g.stroke(); g.restore(); } }
          V.icon(g, Ly.icon, sp[0], sp[1], sz * sc2, Ly.color, 0, s.lt, a);
          if (Ly.text) { const px = 18 * k * (Ly.size || 1); const off = sz * .65 + 6 * k; const pos = Ly.textPos || 'right'; const tx = pos === 'right' ? sp[0] + off : pos === 'left' ? sp[0] - off : sp[0]; const ty = pos === 'top' ? sp[1] - off : pos === 'bottom' ? sp[1] + off : sp[1]; g.save(); g.globalAlpha = a; haloText(g, Ly.text, tx, ty, px, '#ffffff', 'rgba(0,0,0,.85)', fam, 800, pos === 'right' ? 'left' : pos === 'left' ? 'right' : 'center'); g.restore(); }
          out.labels.push([sp[0] - sz, sp[1] - sz, sp[0] + sz, sp[1] + sz]);
        });
      } else if (Ly.type === 'image') {
        let sp = vw.project(Ly.lon, Ly.lat);
        if (Ly.pts && Ly.pts.length >= 2) { // the leader travels along pts (route-like) between moveStart and moveStart+moveDur
          const line = smooth(geoLine(vw, Ly.pts, Ly.curve || 0), 2);
          if (line.length >= 2) {
            const p = S.ease(clamp((s.lt - (Ly.moveStart || 0)) / Math.max(.05, Ly.moveDur || 4), 0, 1)); const c = cut(line, p); const col = Ly.trailColor || Ly.ring;
            if (Ly.arrow) { g.save(); g.globalAlpha = s.a * .8 * pin; V.arrow(g, line, { k, width: .42, color: col, style: 'dashed', glow: 0, t: 0 }); g.restore(); }
            if (Ly.trail && c.length >= 2) { // fading trail: transparent at the origin, solid near the leader
              g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; const n = c.length;
              for (let i = 1; i < n; i++) { const f = i / (n - 1); g.globalAlpha = s.a * (.22 + .78 * f * f); g.beginPath(); g.moveTo(c[i - 1][0], c[i - 1][1]); g.lineTo(c[i][0], c[i][1]); g.lineWidth = 8.5 * k; g.strokeStyle = 'rgba(0,0,0,.3)'; g.stroke(); g.lineWidth = 4.6 * k; g.strokeStyle = col; g.stroke(); }
              g.restore();
            }
            sp = c[c.length - 1];
          }
        }
        let LyP = Ly; if (V.leaderMove && Ly.moves && Ly.moves.length) { const mv = V.leaderMove(g, vw, Ly, s, k); if (mv) { sp = mv.sp; if (mv.sub) LyP = Object.assign(Object.create(Ly), { sub: mv.sub }); } } // «تحرك إلى مدينة» segments (war.js)
        if (!sp) continue;
        late.push(() => drawPortrait(g, sc, LyP, sp, s, k, fam));
      } else if (Ly.type === 'label') {
        const sp = vw.project(Ly.lon, Ly.lat); if (!sp) continue;
        late.push(() => { g.save(); g.globalAlpha = s.a * pin; const px = 22 * k * (Ly.size || 1) * (Ly.scale == null ? 1 : Ly.scale) * (Ly.style === 'soft' ? 1.6 : 1); if (Ly.style === 'plate') { const w = measure(g, Ly.text, px, fam, 800) + px; plate(g, sp[0] - w / 2, sp[1] - px * .8, w, px * 1.6, 'rgba(0,0,0,.65)'); haloText(g, Ly.text, sp[0], sp[1], px, Ly.color, null, fam, 800); } else haloText(g, Ly.text, sp[0], sp[1], px, Ly.color, Ly.style === 'plain' ? null : (Ly.style === 'soft' || st.halo === 'soft') ? 'soft' : 'rgba(0,0,0,.8)', fam, Ly.style === 'soft' ? 900 : 800, 'center', Ly.spacing || 0); g.restore(); out.labels.push([sp[0] - px * 3, sp[1] - px, sp[0] + px * 3, sp[1] + px]); });
      }
    }

    V.runHooks('mid', HK);
    /* ---- map labels with collision ---- */
    const boxes = [];
    const hitBox = (r) => boxes.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const place = (r) => { if (r[0] < 2 || r[1] < 2 || r[2] > W - 2 || r[3] > H - 2 || hitBox(r)) return false; boxes.push(r); return true; };
    const ink = st.ink || '#fff', halo = st.halo || 'rgba(0,0,0,.75)'; const ls = L.labelSize || 1;
    if (L.labels) {
      const cand = [];
      if (L.countryLabels || inv.size) for (const f of fv) {
        const sp = vw.project(f.lab[0], f.lab[1]); if (!sp) continue; const rpx = f.rad * vw.kpx * (vw.mode === 'flat' ? 1 / Math.max(.2, Math.cos(f.lab[1] * RAD)) : 1);
        const isInv = inv.has(f.key); if (rpx < 20 && !isInv) continue; if (!isInv && !L.countryLabels) continue;
        const il = isInv ? invLab.get(f.key) : null; if (il && !il.show) continue;
        const name = (il && il.text) || G.name(f, lang, era); if (!name) continue;
        const px = il && il.style === 'soft' ? clamp(Math.sqrt(2 * mainR(f) * vw.kpx) * 3.1, 24, 104) * k * ls * il.size : clamp(Math.sqrt(rpx) * 1.55 * E.labelK, 11, 34) * k * ls * (isInv ? 1.15 * (il ? il.size : 1) : 1);
        cand.push({ pr: (isInv ? 1e7 : 0) + rpx, sp, name, px, kind: 'country', inv: isInv, il });
      }
      if (L.oceans && vw.zoom < 6.5) for (const p of G.regions || []) { if (p[5] !== 'sea' && !(L.regions && p[4] <= 3)) continue; if (p[4] > vw.zoom * 1.3 + .5) continue; const sp = vw.project(p[0], p[1]); if (!sp) continue; cand.push({ pr: 500 - p[4] * 50, sp, name: lang === 'en' ? p[2] : (p[3] || p[2]), px: (p[5] === 'sea' ? clamp(17 - p[4] * 1.3, 10, 17) : 13) * k * ls, kind: p[5] === 'sea' ? 'sea' : 'region' }); }
      if (L.cities) {
        const lvl = L.cities; const maxRank = clamp(Math.floor(vw.zoom * 1.45 - 5 + (lvl - 1) * 1.6), -1, 10); // fewer, calmer city labels by default
        const histOK = era.src === 'modern' || lvl >= 2;
        if (histOK) for (const p of G.places || []) { if (p[4] > maxRank) continue; if (era.src !== 'modern' && p[4] > 3) continue; const sp = vw.project(p[0], p[1]); if (!sp || sp[0] < 0 || sp[1] < 0 || sp[0] > W || sp[1] > H) continue; const cap = (p[6] & 1) && era.src === 'modern'; if (E.capOnly && !cap) continue; cand.push({ pr: 3000 - p[4] * 200 + (cap ? 400 : 0) + Math.min(400, p[5] / 30), sp, name: lang === 'en' ? p[2] : (p[3] || p[2]), px: (cap ? 15 : 13 - Math.min(3, p[4] * .3)) * k * ls * E.cityLabel, kind: 'city', cap }); }
        if (era.src === 'cs') for (const f of fv) { const pr = f.properties; if (!pr.cap || f.properties.st !== 'independent') continue; const sp = vw.project(pr.cx, pr.cy); if (!sp) continue; cand.push({ pr: 3500, sp, name: lang === 'en' ? pr.cap : capAr(pr.cap), px: 14 * k * ls * E.cityLabel, kind: 'city', cap: 1 }); }
      }
      cand.sort((a, b2) => b2.pr - a.pr);
      for (const c of cand) {
        if (c.kind === 'city') {
          const w = measure(g, c.name, c.px, fam, 700); const r0 = c.px * .32 * E.citySize; const bx = [c.sp[0] - r0, c.sp[1] - c.px * .6, c.sp[0] + r0 + 5 * k + w, c.sp[1] + c.px * .6];
          if (!place(bx)) continue; out.labels.push(bx);
          if (E.cityDot !== 'none') V.icon(g, E.cityDot === 'dot' ? 'dot' : E.cityDot === 'star' ? 'star' : c.cap ? 'capital' : 'city', c.sp[0], c.sp[1], c.px * E.citySize * (E.cityDot === 'star' ? 1.2 : c.cap ? 1.05 : .9), E.cityC || (E.cityDot === 'dot' || E.cityDot === 'star' ? '#ffffff' : E.vector ? '#222' : '#111'), 0, 0);
          haloText(g, c.name, c.sp[0] + r0 + 5 * k, c.sp[1], c.px, ink, halo, fam, E.labelW || 700, 'left');
        } else {
          const sp = c.kind === 'sea' || c.kind === 'region' ? 0 : .08; const nm = (lang === 'en' && c.kind === 'country' && E.labelUp) ? c.name.toUpperCase() : c.name;
          const w = measure(g, nm, c.px, fam, c.kind === 'country' ? (c.il && c.il.style === 'soft' ? 900 : 800) : 600, lang === 'en' ? .12 : 0); const bx = [c.sp[0] - w / 2 - 3, c.sp[1] - c.px * .62, c.sp[0] + w / 2 + 3, c.sp[1] + c.px * .62];
          if (!place(bx)) { if (!(c.il && c.il.style !== 'plate' && (c.tries = (c.tries || 0) + 1) < 4)) continue; c.px *= .8; cand.splice(cand.indexOf(c) + 1, 0, c); continue; } // big soft labels shrink instead of disappearing
          out.labels.push(bx);
          if (c.kind === 'sea') { g.save(); g.globalAlpha = E.vector ? .85 : .62; haloText(g, nm, c.sp[0], c.sp[1], c.px, E.vector ? shade(st.ocean, st.ink && st.ink.startsWith('#1') ? -.45 : .45) : '#b4c6d8', null, fam, E.vector ? 600 : 500, 'center', .05); g.restore(); }
          else if (c.inv && c.il && c.il.style !== 'plate') { g.save(); g.globalAlpha = c.il.a; haloText(g, nm, c.sp[0], c.sp[1], c.px, c.il.style === 'soft' ? ink : '#ffffff', c.il.style === 'soft' ? 'soft' : 'rgba(0,0,0,.8)', fam, c.il.style === 'soft' ? 900 : 800, 'center', lang === 'en' ? .12 : 0); g.restore(); }
          else if (c.inv) { const w2 = w + c.px * .8; plate(g, c.sp[0] - w2 / 2, c.sp[1] - c.px * .72, w2, c.px * 1.44, 'rgba(0,0,0,.6)', c.px * .25); haloText(g, nm, c.sp[0], c.sp[1], c.px, '#ffffff', null, fam, 800, 'center', lang === 'en' ? .12 : 0); }
          else haloText(g, nm, c.sp[0], c.sp[1], c.px, ink, halo, fam, E.labelW || (c.kind === 'country' ? 800 : 600), 'center', (lang === 'en' ? .12 : 0) + E.labelSp);
        }
      }
    }
    for (const fn of late) fn();
    V.runHooks('top', HK);

    /* ---- screen-space overlays ---- */
    for (const { Ly, s } of layers) {
      if (Ly.type === 'date') drawDate(g, sc, Ly, s, t, W, H, k, fam, era, opts);
      else if (Ly.type === 'legend') drawLegend(g, Ly, s, W, H, k, fam);
      else if (Ly.type === 'title') drawTitle(g, Ly, s, W, H, k, fam);
      else if (Ly.type === 'inset') drawInset(g, Ly, s, vw, inv, byKey, W, H, k, fam, era, lang);
    }
    if (L.attrib && E.base && A.Providers.P[E.base]) { g.save(); g.globalAlpha = .55; g.font = font(9.5 * k, 500, 'Barlow'); g.textAlign = 'left'; g.textBaseline = 'bottom'; g.direction = 'ltr'; g.fillStyle = E.vector || (st.ink && st.ink.startsWith('#1')) ? '#333' : '#fff'; g.fillText(A.Providers.P[E.base].attrib, 8 * k, H - 6 * k); g.restore(); }
    return out;
  };

  function drawPortrait(g, sc, Ly, sp, s, k, fam) {
    if (Ly.disp === 'banner' && V.banner) return V.banner(g, sc, Ly, sp, s, k, fam); // «راية» style (war.js)
    const sz = 120 * k * (Ly.size || 1) * (Ly.scale == null ? 1 : Ly.scale); const pop = Ly.in === 'pop' ? Math.max(0, S.back(s.pin)) : Ly.in === 'grow' ? S.easeOut(s.pin) : Ly.in === 'zoom' ? 1.6 - .6 * S.easeOut(s.pin) : 1;
    const a = s.a * (Ly.in === 'fade' || Ly.in === 'zoom' ? S.easeOut(s.pin) : Ly.in === 'pop' ? Math.min(1, s.pin * 3) : 1);
    const plH = Ly.plate && (Ly.name || Ly.sub) ? (Ly.sub ? 20 * k * 1.3 + 13 * k * 1.4 : 20 * k * 1.5) + 10 * k : 0; const dyk = Ly.dy == null ? -1 : Ly.dy;
    const dy = dyk < 0 ? dyk * (sz * .5 + plH + 18 * k) : dyk * sz * .85; const cx = sp[0], cy = sp[1] + dy; // above the point: the name plate ends just above the pin
    g.save(); g.globalAlpha = a;
    if (dy) { g.strokeStyle = Ly.ring; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(sp[0], sp[1]); g.lineTo(cx, cy + Math.sign(-dy) * (sz * .5 + (dy < 0 ? plH : 0)) * pop); g.stroke(); V.icon(g, 'dot', sp[0], sp[1], 12 * k, Ly.ring, 0, 0, 1); }
    g.translate(cx, cy); g.scale(pop, pop);
    const shp = () => { g.beginPath(); const r = sz / 2; if (Ly.shape === 'square') g.rect(-r, -r, sz, sz); else if (Ly.shape === 'rounded') { if (g.roundRect) g.roundRect(-r, -r, sz, sz, sz * .18); else g.rect(-r, -r, sz, sz); } else if (Ly.shape === 'hex') { for (let i = 0; i < 6; i++) { const an = Math.PI / 6 + i * Math.PI / 3; g.lineTo(Math.cos(an) * r, Math.sin(an) * r); } g.closePath(); } else if (Ly.shape === 'shield') { g.moveTo(-r, -r); g.lineTo(r, -r); g.lineTo(r, r * .2); g.quadraticCurveTo(r * .8, r * .85, 0, r * 1.1); g.quadraticCurveTo(-r * .8, r * .85, -r, r * .2); g.closePath(); } else g.arc(0, 0, r, 0, 7); };
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 18 * k; shp(); g.fillStyle = '#1b2230'; g.fill(); g.shadowBlur = 0;
    const im = V.img(sc, Ly.img);
    if (im) { g.save(); shp(); g.clip(); const ar = im.naturalWidth / im.naturalHeight; const w = ar > 1 ? sz * ar : sz, h = ar > 1 ? sz : sz / ar; g.drawImage(im, -w / 2, -h / 2, w, h); g.restore(); }
    else { g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(0, -sz * .1, sz * .17, 0, 7); g.fill(); g.beginPath(); g.ellipse(0, sz * .28, sz * .3, sz * .2, 0, Math.PI, 0); g.fill(); }
    shp(); g.lineWidth = 5 * k; g.strokeStyle = Ly.ring; g.stroke();
    if (Ly.plate && (Ly.name || Ly.sub)) {
      const px = 20 * k, px2 = 13 * k; const w = Math.max(measure(g, Ly.name || '', px, fam, 800), measure(g, Ly.sub || '', px2, fam, 600)) + 26 * k; const h = (Ly.sub ? px * 1.3 + px2 * 1.4 : px * 1.5) + 4 * k; const y0 = sz * .5 + 6 * k;
      plate(g, -w / 2, y0, w, h, 'rgba(8,11,16,.88)', 5 * k); g.fillStyle = Ly.ring; g.fillRect(-w / 2, y0, w, 3 * k);
      haloText(g, Ly.name || '', 0, y0 + 4 * k + px * .7, px, '#fff', null, fam, 800);
      if (Ly.sub) haloText(g, Ly.sub, 0, y0 + 4 * k + px * 1.35 + px2 * .6, px2, '#c9d3df', null, fam, 600);
    }
    g.restore();
  }
  // map-in-map: small locator globe showing where the main camera is looking
  function drawInset(g, Ly, s, vw, inv, byKey, W, H, k, fam, era, lang) {
    const sz = 230 * k * (Ly.size || 1); const [x0, y0] = corner(Ly.pos || 'bl', W, H, sz, sz, k); const cx = x0 + sz / 2, cy = y0 + sz / 2, R = sz / 2 - 6 * k;
    const p = S.easeOut(s.pin); g.save(); g.globalAlpha = s.a * p;
    const pr = d3.geoOrthographic().rotate([-vw.lon, -Math.max(-60, Math.min(60, vw.lat))]).scale(R).translate([cx, cy]).clipAngle(90).precision(1);
    const path = d3.geoPath(pr, g);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 18 * k; g.beginPath(); g.arc(cx, cy, R + 4 * k, 0, 7); g.fillStyle = Ly.frame || '#0b0f16'; g.fill(); g.shadowBlur = 0;
    g.beginPath(); path({ type: 'Sphere' }); const gr = g.createRadialGradient(cx - R * .3, cy - R * .3, R * .1, cx, cy, R); gr.addColorStop(0, '#1b3553'); gr.addColorStop(1, '#09172a'); g.fillStyle = gr; g.fill();
    g.beginPath(); path(d3.geoGraticule10()); g.lineWidth = .6 * k; g.strokeStyle = 'rgba(255,255,255,.12)'; g.stroke();
    if (G.land) { g.beginPath(); path(G.land); g.fillStyle = Ly.land || '#7d7a66'; g.fill(); }
    for (const key of inv) { const f = byKey.get(key); if (!f) continue; g.beginPath(); path(f); g.fillStyle = Ly.color || '#e5243b'; g.fill(); }
    // current view footprint
    const span = Math.min(80, vw.upp * H * .55 * 180 / Math.PI); const pulse = .5 + .5 * Math.sin(s.lt * 3);
    g.beginPath(); path(d3.geoCircle().center([vw.lon, vw.lat]).radius(Math.max(.6, span))()); g.lineWidth = 1.6 * k; g.strokeStyle = Ly.mark || '#ffd34d'; g.stroke(); g.globalAlpha *= .14 + .1 * pulse; g.fillStyle = Ly.mark || '#ffd34d'; g.fill(); g.globalAlpha = s.a * p;
    g.beginPath(); g.arc(cx, cy, R, 0, 7); g.lineWidth = 1.4 * k; g.strokeStyle = Ly.ring || 'rgba(255,255,255,.6)'; g.stroke();
    if (Ly.text) haloText(g, Ly.text, cx, y0 + sz + 14 * k, 15 * k, '#fff', 'rgba(0,0,0,.85)', fam, 800);
    g.restore();
  }
  function corner(pos, W, H, w, h, k) { const m = 40 * k; const x = pos.includes('l') ? m : pos.includes('r') ? W - m - w : (W - w) / 2; const y = pos.includes('t') || pos === 'top' ? m : H - m - h; return [x, y]; }
  function drawDate(g, sc, Ly, s, t, W, H, k, fam, era, opts) {
    const y = opts.year; if (y == null) return; const lang = sc.look.lang || 'ar';
    const animated = GW.isAnim && GW.isAnim(sc.year);
    let txt = G.fmtYear(y, lang); let sub = '';
    if ((Ly.format === 'full' || (Ly.format === 'auto' && era.src === 'cs' && animated)) && y >= 1) { const d = G.decToInt(y); const m = Math.floor(d / 100) % 100, dd = d % 100; sub = lang === 'en' ? `${G.MONTHS_EN[m - 1]} ${dd}` : `${dd} ${G.MONTHS_AR[m - 1]}`; }
    const px = 56 * k * (Ly.size || 1), px2 = 20 * k * (Ly.size || 1);
    g.save(); g.globalAlpha = s.a * S.easeOut(s.pin);
    const w = Math.max(measure(g, txt, px, 'Barlow Condensed', 800), sub ? measure(g, sub, px2, fam, 700) : 0) + 36 * k, h = px * 1.15 + (sub ? px2 * 1.4 : 0) + 18 * k;
    const [x0, y0] = corner(Ly.pos || 'tr', W, H, w, h, k);
    if (Ly.plate) { g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 18 * k; plate(g, x0, y0, w, h, 'rgba(12,16,22,.42)', 4 * k); g.restore(); g.fillStyle = Ly.color === '#ffffff' ? (Ly.accent || '#d9b45a') : Ly.color; g.fillRect(x0 + w * .18, y0 + h - 2 * k, w * .64, 1.6 * k); }
    if (sub) haloText(g, sub, x0 + w / 2, y0 + 9 * k + px2 * .7, px2, '#e4e8ee', Ly.plate ? null : 'soft', fam, 600);
    haloText(g, txt, x0 + w / 2, y0 + h - 9 * k - px * .58, px, Ly.plate ? '#f4f0e8' : Ly.color, Ly.plate ? 'soft' : 'rgba(0,0,0,.8)', 'Barlow Condensed', 700);
    g.restore();
  }
  function drawLegend(g, Ly, s, W, H, k, fam) {
    const items = Ly.items || []; if (!items.length) return; const px = 17 * k; const rowH = px * 1.7;
    g.save(); g.globalAlpha = s.a * S.easeOut(s.pin);
    const w = Math.max(...items.map(it => measure(g, it.text, px, fam, 700))) + px * 3.4, h = rowH * items.length + px;
    const [x0, y0] = corner(Ly.pos || 'bl', W, H, w, h, k); plate(g, x0, y0, w, h, 'rgba(6,9,14,.72)', 8 * k);
    items.forEach((it, i) => { const yy = y0 + px * .5 + rowH * (i + .5); const rtl = isAr(it.text); const sx = rtl ? x0 + w - px * 1.9 : x0 + px * .7; plate(g, sx, yy - px * .45, px * 1.2, px * .9, it.color, 3 * k); haloText(g, it.text, rtl ? sx - px * .5 : sx + px * 1.7, yy, px, '#fff', null, fam, 700, rtl ? 'right' : 'left'); });
    g.restore();
  }
  function drawTitle(g, Ly, s, W, H, k, fam) {
    const p = S.easeOut(s.pin); g.save(); g.globalAlpha = s.a;
    const px = (Ly.template === 'center' ? 64 : 40) * k, px2 = 22 * k; const tw = measure(g, Ly.text, px, fam, 900), sw = Ly.sub ? measure(g, Ly.sub, px2, fam, 700) : 0;
    if (Ly.template === 'breaking') {
      const w = Math.max(tw, sw) + 70 * k, h = px * 1.6; const x0 = W - 60 * k - w, y0 = H - 110 * k - h;
      g.beginPath(); g.rect(x0 + w * (1 - p), y0 - (Ly.sub ? px2 * 1.7 : 0), w * p, h + (Ly.sub ? px2 * 1.7 : 0)); g.clip();
      if (Ly.sub) { plate(g, x0, y0 - px2 * 1.7, w, px2 * 1.7, 'rgba(10,12,16,.9)', 0); haloText(g, Ly.sub, x0 + w - 18 * k, y0 - px2 * .85, px2, '#fff', null, fam, 700, 'right'); }
      plate(g, x0, y0, w, h, Ly.color, 0); haloText(g, Ly.text, x0 + w - 24 * k, y0 + h / 2, px, '#fff', null, fam, 900, 'right');
    } else if (Ly.template === 'corner') {
      const w = Math.max(tw, sw) + 50 * k; const x0 = W - 50 * k - w, y0 = 50 * k; g.globalAlpha *= p;
      plate(g, x0, y0, w, px * 1.5 + (Ly.sub ? px2 * 1.5 : 0) + 10 * k, 'rgba(6,9,14,.8)', 6 * k); g.fillStyle = Ly.color; g.fillRect(x0 + w - 6 * k, y0, 6 * k, px * 1.5 + (Ly.sub ? px2 * 1.5 : 0) + 10 * k);
      haloText(g, Ly.text, x0 + w - 22 * k, y0 + px * .85, px, '#fff', null, fam, 900, 'right'); if (Ly.sub) haloText(g, Ly.sub, x0 + w - 22 * k, y0 + px * 1.5 + px2 * .8, px2, '#cfd8e3', null, fam, 700, 'right');
    } else if (Ly.template === 'lower') {
      const w = Math.max(tw, sw) + 60 * k; const x0 = (W - w) / 2, y0 = H - 150 * k; g.globalAlpha *= p;
      plate(g, x0, y0, w, px * 1.5, 'rgba(6,9,14,.82)', 6 * k); g.fillStyle = Ly.color; g.fillRect(x0, y0 + px * 1.5, w * p, 5 * k); haloText(g, Ly.text, W / 2, y0 + px * .75, px, '#fff', null, fam, 900);
      if (Ly.sub) haloText(g, Ly.sub, W / 2, y0 + px * 1.5 + px2 * 1.1, px2, '#fff', 'rgba(0,0,0,.8)', fam, 700);
    } else {
      g.globalAlpha *= p; haloText(g, Ly.text, W / 2, H / 2 - (Ly.sub ? px2 : 0), px * (.9 + .1 * p), '#fff', 'rgba(0,0,0,.75)', fam, 900);
      if (Ly.sub) haloText(g, Ly.sub, W / 2, H / 2 + px * .7, px2, Ly.color, 'rgba(0,0,0,.75)', fam, 700);
    }
    g.restore();
  }
})();
