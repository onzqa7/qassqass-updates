'use strict';
/* Motion graphics templates (قوالب الرسوم المتحركة).
   A template clip is an ordinary text clip whose c.text.mg = { id, f: {field: value} }; text.js hands the whole layer to
   GW.MG.draw (canvas 2D, sequence-pixel space), so motion / opacity keyframes, masks, effects, blend modes, nesting, export
   and undo work unchanged. Each template animates procedurally from clip-local time (intro at the head, outro at the tail),
   adapts to the frame aspect (16:9 / 9:16) and exposes editable fields (text, colours, numbers, choices) + duration.
   API: GW.MG.list · .get(id) · .draw(g, mg, t, dur, W, H, k) · .add(id, {start, track, dur, fields}) · .fields(id) */
(function () {
  const { clamp } = GW;
  const MG = GW.MG = { list: [], by: {} };
  const def = (o) => { MG.list.push(o); MG.by[o.id] = o; };
  MG.get = (id) => MG.by[id] || null;
  MG.tkey = (mg, lt, dur) => (Math.round(lt * 60) / 60).toFixed(4) + '|' + (+dur).toFixed(3);

  /* ---------------- drawing helpers (sequence px) ---------------- */
  const E = {
    o3: t => 1 - Math.pow(1 - t, 3), o5: t => 1 - Math.pow(1 - t, 5), io: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    expo: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t), back: t => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    smooth: GW.cubicBezier ? GW.cubicBezier(.65, 0, .35, 1) : (t => t), snap: GW.cubicBezier ? GW.cubicBezier(.2, .9, .1, 1) : (t => t)
  };
  MG.E = E;
  const seg = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a), 0, 1);
  const isAr = GW.isAr;
  function font(g, fam, wt, px) { g.font = `${wt} ${px}px "${fam}", "Cairo", "Segoe UI", sans-serif`; }
  function setText(g, s, o) {
    font(g, o.font || 'Cairo', o.wt || 700, o.size || 40); const ar = isAr(s); g.direction = ar ? 'rtl' : 'ltr';
    if ('letterSpacing' in g) g.letterSpacing = (!ar && o.track) ? o.track + 'px' : '0px';
    g.textBaseline = o.base || 'middle';
  }
  function tw(g, s, o) { setText(g, s, o); return g.measureText(String(s)).width; }
  // draw text; align: 'left' | 'right' | 'center' (absolute, independent of direction)
  function txt(g, s, x, y, o) { s = String(s); setText(g, s, o); g.textAlign = o.align || 'center'; g.fillStyle = o.color || '#fff'; if (o.stroke) { g.lineJoin = 'round'; g.lineWidth = o.stroke; g.strokeStyle = o.strokeColor || '#000'; g.strokeText(s, x, y); } if (!o.noFill) g.fillText(s, x, y); return g.measureText(s).width; }
  function rr(g, x, y, w, h, r) { g.beginPath(); r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)); if (w < 0) { x += w; w = -w; } if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  function wrap(g, s, maxW, o) {
    const out = []; for (const para of String(s).split('\n')) {
      const ws = para.split(/\s+/).filter(Boolean); let cur = '';
      for (const w of ws) { const n = cur ? cur + ' ' + w : w; if (cur && tw(g, n, o) > maxW) { out.push(cur); cur = w; } else cur = n; }
      out.push(cur);
    }
    return out;
  }
  function shadow(g, k, blur, a, dy) { g.shadowColor = 'rgba(0,0,0,' + (a == null ? .45 : a) + ')'; g.shadowBlur = (blur || 18) * k; g.shadowOffsetX = 0; g.shadowOffsetY = (dy == null ? 4 : dy) * k; }
  function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0; }
  const rgba = GW.rgba;
  const ICON = {
    thumb: 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z',
    bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    cursor: 'M5 2.5v17.2l4.3-4.1 2.9 6.6 2.9-1.3-2.8-6.5h6z',
    pin: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
    doc: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    quote: 'M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z',
    play: 'M8 5v14l11-7z'
  };
  const PATHS = {}; const path = (n) => PATHS[n] || (PATHS[n] = new Path2D(ICON[n]));
  function icon(g, n, cx, cy, size, color) { g.save(); g.translate(cx - size / 2, cy - size / 2); g.scale(size / 24, size / 24); g.fillStyle = color; g.fill(path(n)); g.restore(); }
  const AR_DIG = '٠١٢٣٤٥٦٧٨٩';
  function fmtNum(v, digits, sep, dec) {
    const neg = v < 0; v = Math.abs(v); let s = dec > 0 ? v.toFixed(dec) : String(Math.round(v));
    let [a, b] = s.split('.'); if (sep) a = a.replace(/\B(?=(\d{3})+(?!\d))/g, digits === 'ar' ? '٬' : ',');
    s = (neg ? '-' : '') + a + (b ? (digits === 'ar' ? '٫' : '.') + b : '');
    return digits === 'ar' ? s.replace(/\d/g, d => AR_DIG[+d]) : s;
  }
  const toAr = (s, digits) => digits === 'ar' ? String(s).replace(/\d/g, d => AR_DIG[+d]) : String(s);
  MG.fmtNum = fmtNum;
  // seeded film grain tile
  let grain = null;
  function grainTile() {
    if (grain) return grain; const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const im = g.createImageData(256, 256); const r = GW.rng(7);
    for (let i = 0; i < im.data.length; i += 4) { const v = r() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0); grain = c; return c;
  }
  // common outro factor (1 → 0 over the last `len` seconds)
  const tl0n = (g, F, tO, W) => wrap(g, F.title, W * .82, tO).length;
  const outro = (t, dur, len) => E.io(clamp((dur - t) / (len || .5), 0, 1));
  // layout helpers: unit u = 1 at 1080 px short side; frame margin; vertical frames
  const U = (W, H) => Math.min(W, H) / 1080;
  const vert = (W, H) => H > W * 1.1;

  /* ---------------- field shortcuts ---------------- */
  const tF = (k, n, d, o = {}) => ({ k, n, t: 'text', def: d, ...o });
  const cF = (k, n, d) => ({ k, n, t: 'color', def: d });
  const nF = (k, n, d, min, max, step, unit) => ({ k, n, t: 'num', def: d, min, max, step: step || 1, unit: unit || '' });
  const sF = (k, n, d, opts) => ({ k, n, t: 'sel', def: d, opts });
  const SIDE = sF('side', 'الجانب', 'right', [['right', 'يمين'], ['left', 'يسار']]);
  const DIG = sF('digits', 'الأرقام', 'latin', [['latin', '0123'], ['ar', '٠١٢٣']]);

  /* =============== 1–3. lower thirds =============== */
  def({ id: 'lt-classic', n: 'اسم وصفة — كلاسيكي', cat: 'lower', dur: 5,
    fields: [tF('name', 'الاسم', 'محمد علي باشا'), tF('title', 'الصفة', 'والي مصر 1805 – 1848'), cF('accent', 'لون التمييز', '#e8a33d'), cF('panel', 'لون اللوحة', '#11151b'), cF('text', 'لون النص', '#ffffff'), SIDE],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), R = F.side !== 'left', o = outro(t, dur, .55);
      const nO = { font: 'Cairo', wt: 800, size: 56 * u }, tO = { font: 'Tajawal', wt: 500, size: 33 * u };
      const pad = 30 * u, nw = tw(g, F.name, nO), tw2 = tw(g, F.title, tO), bw = Math.max(nw, tw2) + pad * 2, nh = 86 * u, th = 54 * u, bar = 8 * u;
      const y0 = (vert(W, H) ? H * .70 : H * .78) - nh, x0 = R ? W - W * .055 : W * .055; const dir = R ? -1 : 1;
      const pb = E.o5(seg(t, 0, .4)) * o, pn = E.o5(seg(t, .18, .75)) * o, pt = E.o5(seg(t, .38, .95)) * o;
      // panels grow out of the accent bar
      g.save(); shadow(g, k, 30, .35, 8);
      g.fillStyle = rgba(F.panel, .94); const nwid = bw * pn; g.fillRect(R ? x0 - bar - nwid : x0 + bar, y0, nwid, nh);
      g.fillStyle = F.accent; const twid = (Math.max(tw2 + pad * 2, bw * .62)) * pt; g.fillRect(R ? x0 - bar - twid : x0 + bar, y0 + nh, twid, th);
      noShadow(g);
      g.fillStyle = F.accent; const bh = (nh + th) * pb; g.fillRect(R ? x0 - bar : x0, y0 + (nh + th - bh) / 2, bar, bh);
      g.restore();
      // texts slide away from the bar, clipped to their panel
      g.save(); g.beginPath(); g.rect(R ? x0 - bar - nwid : x0 + bar, y0, nwid, nh); g.clip();
      const a1 = E.o3(seg(t, .35, .85)); g.globalAlpha = a1 * o; txt(g, F.name, x0 + dir * (bar + pad + (1 - a1) * 40 * u), y0 + nh * .53, { ...nO, align: R ? 'right' : 'left', color: F.text }); g.restore();
      g.save(); g.beginPath(); g.rect(R ? x0 - bar - twid : x0 + bar, y0 + nh, twid, th); g.clip();
      const a2 = E.o3(seg(t, .55, 1.05)); g.globalAlpha = a2 * o; txt(g, F.title, x0 + dir * (bar + pad + (1 - a2) * 30 * u), y0 + nh + th * .54, { ...tO, align: R ? 'right' : 'left', color: '#101010' }); g.restore();
    } });
  def({ id: 'lt-line', n: 'اسم وصفة — خط رفيع', cat: 'lower', dur: 5,
    fields: [tF('name', 'الاسم', 'د. سارة الحسيني'), tF('title', 'الصفة', 'مؤرخة متخصصة في الحرب العالمية الأولى'), cF('accent', 'لون الخط', '#4fb3ff'), cF('text', 'لون النص', '#ffffff'), SIDE],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), R = F.side !== 'left', o = outro(t, dur, .5);
      const nO = { font: 'Cairo', wt: 700, size: 62 * u }, tO = { font: 'IBM Plex Sans Arabic', wt: 400, size: 32 * u };
      const nw = tw(g, F.name, nO), tw2 = tw(g, F.title, tO), lw = Math.max(nw, tw2) + 20 * u;
      const x0 = R ? W - W * .06 : W * .06, ly = vert(W, H) ? H * .70 : H * .80, al = R ? 'right' : 'left', dir = R ? -1 : 1;
      const pl = E.smooth(seg(t, .05, .75)) * (o > .001 ? (0.4 + .6 * o) : 0);
      g.save(); g.fillStyle = F.accent; shadow(g, k, 10, .35, 2); g.fillRect(R ? x0 - lw * pl : x0, ly - 2 * u, lw * pl, 4 * u);
      const dot = E.back(seg(t, 0, .35)) * o; g.beginPath(); g.arc(x0, ly, 7 * u * Math.max(0, dot), 0, 7); g.fill(); g.restore();
      // name rises from behind the line, title drops from it
      g.save(); g.beginPath(); g.rect(0, 0, W, ly - 4 * u); g.clip(); shadow(g, k, 20, .6, 3);
      const a1 = E.o5(seg(t, .3, .95)); txt(g, F.name, x0, ly - 48 * u + (1 - a1 * o) * 70 * u, { ...nO, align: al, color: F.text }); g.restore();
      g.save(); g.beginPath(); g.rect(0, ly + 4 * u, W, H); g.clip(); shadow(g, k, 14, .6, 2);
      const a2 = E.o5(seg(t, .5, 1.1)); txt(g, F.title, x0 + dir * 2 * u, ly + 36 * u - (1 - a2 * o) * 50 * u, { ...tO, align: al, color: '#dfe5ec' }); g.restore();
    } });
  def({ id: 'lt-stack', n: 'اسم وصفة — بطاقة مزدوجة', cat: 'lower', dur: 5,
    fields: [tF('tag', 'التصنيف', 'شاهد عيان'), tF('name', 'الاسم', 'أحمد يوسف'), tF('title', 'الصفة', 'جندي سابق — حرب أكتوبر 1973'), cF('accent', 'لون التمييز', '#f2c14e'), cF('panel', 'لون اللوحة', '#14181f'), SIDE],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), R = F.side !== 'left', o = outro(t, dur, .5), dir = R ? -1 : 1, al = R ? 'right' : 'left';
      const gO = { font: 'Changa', wt: 600, size: 26 * u }, nO = { font: 'Cairo', wt: 800, size: 50 * u }, tO = { font: 'Tajawal', wt: 500, size: 32 * u };
      const pad = 24 * u, x0 = R ? W - W * .06 : W * .06, yb = vert(W, H) ? H * .72 : H * .84;
      const nw = tw(g, F.name, nO) + pad * 2, tw2 = tw(g, F.title, tO) + pad * 2, nh = 74 * u, th = 54 * u;
      const yN = yb - th - nh, yT = yb - th; const off = 26 * u;
      const box = (x, y, w, h, p, col) => { const ww = w * p; g.fillStyle = col; g.fillRect(R ? x - ww : x, y, ww, h); return [R ? x - ww : x, y, ww, h]; };
      g.save(); shadow(g, k, 28, .4, 8);
      const p1 = E.snap(seg(t, .1, .7)) * o, p2 = E.snap(seg(t, .3, .9)) * o;
      const r1 = box(x0, yN, nw, nh, p1, F.accent); const r2 = box(x0 + dir * off, yT, tw2, th, p2, rgba(F.panel, .95)); noShadow(g);
      g.save(); g.beginPath(); g.rect(...r1); g.clip(); const a1 = E.o3(seg(t, .35, .85)); txt(g, F.name, x0 + dir * (pad + (1 - a1) * 40 * u), yN + nh * .54, { ...nO, align: al, color: '#111' }); g.restore();
      g.save(); g.beginPath(); g.rect(...r2); g.clip(); const a2 = E.o3(seg(t, .55, 1.05)); txt(g, F.title, x0 + dir * (off + pad + (1 - a2) * 30 * u), yT + th * .54, { ...tO, align: al, color: '#f1f1f1' }); g.restore();
      if (F.tag) { const a3 = E.o3(seg(t, .5, 1)) * o; g.globalAlpha = a3; shadow(g, k, 12, .6, 2); g.fillStyle = F.accent; const sq = 10 * u; g.fillRect(R ? x0 - sq : x0, yN - 32 * u - sq / 2, sq, sq); txt(g, F.tag, x0 + dir * (sq + 10 * u), yN - 31 * u + (1 - a3) * 10 * u, { ...gO, align: al, color: F.accent }); }
      g.restore();
    } });

  /* =============== 4. breaking news bar =============== */
  def({ id: 'breaking', n: 'شريط خبر عاجل', cat: 'news', dur: 8,
    fields: [tF('label', 'العنوان', 'عاجل'), tF('headline', 'الخبر', 'القوات تعبر نهر الدنيبر في هجوم مفاجئ'), tF('ticker', 'الشريط المتحرك', 'تغطية مستمرة لآخر التطورات الميدانية  •  خرائط تفاعلية للجبهة  •  شهادات من الميدان'), cF('accent', 'لون العاجل', '#d62839'), cF('bar', 'لون الشريط', '#ffffff'), cF('text', 'لون الخبر', '#111418'), cF('tick', 'لون الشريط السفلي', '#15181d')],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .5), V = vert(W, H);
      const bh = 96 * u, th = 46 * u, y0 = H - (V ? H * .2 : 70 * u) - bh - th, mx = V ? 0 : W * .04, x1 = W - mx, x0 = mx, fw = x1 - x0;
      const lO = { font: 'Cairo', wt: 900, size: 46 * u }, hO = { font: 'Cairo', wt: 700, size: (V ? 40 : 46) * u }, kO = { font: 'Tajawal', wt: 500, size: 28 * u };
      const lw = tw(g, F.label, lO) + 78 * u;
      const pL = E.snap(seg(t, 0, .45)) * o, pB = E.snap(seg(t, .3, .9)) * o, pT = E.o3(seg(t, .7, 1.1)) * o;
      g.save(); shadow(g, k, 30, .35, 6);
      g.fillStyle = F.bar; const bw = (fw - lw) * pB; g.fillRect(x1 - lw - bw, y0, bw, bh);
      g.fillStyle = F.accent; g.fillRect(x1 - lw * pL, y0, lw * pL, bh);
      noShadow(g); g.fillStyle = rgba(F.tick, .92); g.fillRect(x0 + (1 - pT) * fw * .5, y0 + bh, fw * pT, th);
      g.fillStyle = F.accent; g.fillRect(x0 + (1 - pT) * fw * .5, y0 + bh, fw * pT, 3 * u);
      // label + pulsing dot
      g.save(); g.beginPath(); g.rect(x1 - lw * pL, y0, lw * pL, bh); g.clip();
      const pulse = .5 + .5 * Math.sin(t * 6.5); g.fillStyle = '#fff'; g.globalAlpha = .55 + .45 * pulse; g.beginPath(); g.arc(x1 - 30 * u, y0 + bh / 2, 8 * u, 0, 7); g.fill(); g.globalAlpha = 1;
      txt(g, F.label, x1 - 48 * u, y0 + bh * .52, { ...lO, align: 'right', color: '#fff' }); g.restore();
      // headline rises inside the white bar
      g.save(); g.beginPath(); g.rect(x1 - lw - bw, y0, bw, bh); g.clip(); const a = E.o5(seg(t, .65, 1.15));
      txt(g, F.headline, x1 - lw - 28 * u, y0 + bh * .53 + (1 - a) * bh, { ...hO, align: 'right', color: F.text }); g.restore();
      // ticker: Arabic news style, text travels left → right
      if (F.ticker && pT > 0) {
        g.save(); g.beginPath(); g.rect(x0, y0 + bh + 3 * u, fw, th - 3 * u); g.clip(); g.globalAlpha = pT;
        const s = F.ticker + '   •   '; const sw = tw(g, s, kO); const sp = 90 * u; let x = ((t - .7) * sp) % sw;
        for (let xx = x1 + x - sw; xx > x0 - sw; xx -= sw) txt(g, s, xx + sw, y0 + bh + th * .55, { ...kO, align: 'right', color: '#e9ecf1' });
        g.restore();
      }
      g.restore();
    } });

  /* =============== 5. subscribe / like call to action =============== */
  def({ id: 'subscribe', n: 'اشترك وأعجبني', cat: 'social', dur: 5,
    fields: [tF('sub', 'نص الزر', 'اشترك'), tF('done', 'بعد الاشتراك', 'مشترك'), tF('like', 'نص الإعجاب', 'أعجبني'), cF('accent', 'لون الزر', '#e62e2e'), sF('cursor', 'مؤشر الفأرة', 'on', [['on', 'إظهار'], ['off', 'إخفاء']])],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H) * (vert(W, H) ? 1.15 : 1), o = outro(t, dur, .45), cy = vert(W, H) ? H * .70 : H * .80, cx = W / 2;
      const pO = { font: 'Cairo', wt: 800, size: 40 * u }, lO = { font: 'Cairo', wt: 700, size: 30 * u };
      const tLike = 1.35, tSub = 2.15, tBell = 2.9; const liked = t >= tLike, subbed = t >= tSub, rung = t >= tBell;
      const pillTxt = subbed ? F.done : F.sub; const pw = Math.max(tw(g, F.sub, pO), tw(g, F.done, pO) + 46 * u) + 84 * u, ph = 84 * u, r = ph / 2;
      const likeW = tw(g, F.like, lO) + 100 * u, gap = 22 * u; const total = likeW + gap + pw + gap + ph;
      // RTL order: like (right) · subscribe · bell (left)
      const xL = cx + total / 2 - likeW, xP = xL - gap - pw, xB = xP - gap - ph;
      const pop = (d) => Math.max(0, E.back(seg(t, d, d + .45))) * o;
      const press = (tc) => 1 - .08 * Math.max(0, 1 - Math.abs(t - tc) / .12);
      g.save(); shadow(g, k, 30, .45, 8);
      // like
      let s = pop(0) * press(tLike); if (s > 0) { g.save(); g.translate(xL + likeW / 2, cy); g.scale(s, s); g.fillStyle = liked ? '#ffffff' : 'rgba(20,22,26,.92)'; rr(g, -likeW / 2, -ph / 2, likeW, ph, r); g.fill(); noShadow(g);
        const ic = liked ? F.accent : '#ffffff'; const bump = liked ? 1 + .25 * Math.max(0, 1 - (t - tLike) / .3) : 1; g.save(); g.translate(likeW / 2 - 50 * u, 0); g.scale(bump, bump); icon(g, 'thumb', 0, 0, 40 * u, ic); g.restore();
        txt(g, F.like, likeW / 2 - 82 * u, 2 * u, { ...lO, align: 'right', color: liked ? '#111' : '#fff' }); g.restore(); }
      // subscribe pill
      shadow(g, k, 30, .45, 8); s = pop(.12) * press(tSub); if (s > 0) { g.save(); g.translate(xP + pw / 2, cy); g.scale(s, s);
        const fl = subbed ? Math.min(1, (t - tSub) / .25) : 0; g.fillStyle = subbed ? '#2c2f35' : F.accent; rr(g, -pw / 2, -ph / 2, pw, ph, r); g.fill(); noShadow(g);
        if (subbed) { g.globalAlpha = 1 - fl; g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, pw * .6 * fl, 0, 7); g.fill(); g.globalAlpha = 1; icon(g, 'check', -tw(g, pillTxt, pO) / 2 - 8 * u, 0, 34 * u, '#9fe870'); txt(g, pillTxt, 18 * u, 2 * u, { ...pO, color: '#e9e9e9' }); }
        else txt(g, pillTxt, 0, 2 * u, { ...pO, color: '#fff' }); g.restore(); }
      // bell
      shadow(g, k, 30, .45, 8); s = pop(.24) * press(tBell); if (s > 0) { g.save(); g.translate(xB + ph / 2, cy); g.scale(s, s); g.fillStyle = rung ? F.accent : 'rgba(20,22,26,.92)'; g.beginPath(); g.arc(0, 0, ph / 2, 0, 7); g.fill(); noShadow(g);
        const sh = rung ? Math.sin((t - tBell) * 40) * Math.max(0, 1 - (t - tBell) / .8) * .45 : 0; g.rotate(sh); icon(g, 'bell', 0, 0, 42 * u, '#fff'); g.restore(); }
      g.restore();
      // cursor travels and clicks
      if (F.cursor !== 'off') {
        const pts = [[cx + total / 2 + 160 * u, cy + 170 * u, .6], [xL + likeW / 2, cy + 6 * u, tLike], [xP + pw / 2, cy + 6 * u, tSub], [xB + ph / 2, cy + 6 * u, tBell], [xB - 120 * u, cy + 150 * u, tBell + .8]];
        let px = pts[0][0], py = pts[0][1];
        for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const p = E.smooth(seg(t, a[2] + (i === 1 ? 0 : .12), b[2] - .05)); if (t >= a[2]) { px = a[0] + (b[0] - a[0]) * p; py = a[1] + (b[1] - a[1]) * p; } }
        const ca = seg(t, .55, .8) * (1 - seg(t, tBell + .5, tBell + .9)) * o;
        if (ca > 0) { g.save(); g.globalAlpha = ca; g.translate(px, py); const pr = Math.min(press(tLike), press(tSub), press(tBell)); g.scale(pr, pr); shadow(g, k, 8, .5, 2); g.translate(-6 * u, -3 * u); g.scale(2.4 * u, 2.4 * u); g.fillStyle = '#fff'; g.fill(path('cursor')); noShadow(g); g.lineWidth = 1; g.strokeStyle = '#111'; g.stroke(path('cursor')); g.restore(); }
      }
    } });

  /* =============== 6. chapter title card =============== */
  def({ id: 'chapter', n: 'بطاقة عنوان فصل', cat: 'title', dur: 5,
    fields: [tF('num', 'الرقم', '01'), tF('label', 'التسمية', 'الفصل الأول'), tF('title', 'العنوان', 'سقوط القسطنطينية'), tF('sub', 'العنوان الفرعي', 'ربيع عام 1453'), cF('accent', 'لون التمييز', '#d9a441'), nF('dim', 'تعتيم الخلفية', 70, 0, 100, 1, '%')],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .7), cx = W / 2, cy = H / 2;
      if (F.dim > 0) { const gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) / 2); gr.addColorStop(0, `rgba(8,9,12,${F.dim / 100 * .75})`); gr.addColorStop(1, `rgba(0,0,0,${F.dim / 100})`); g.globalAlpha = E.o3(seg(t, 0, .6)) * o; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
      const V = vert(W, H); const tO = { font: 'Cairo', wt: 900, size: (V ? 92 : 112) * u }, lO = { font: 'Changa', wt: 600, size: 34 * u }, sO = { font: 'IBM Plex Sans Arabic', wt: 400, size: 38 * u };
      // big outlined number behind
      const pn = E.o5(seg(t, 0, 1.2)); g.save(); g.globalAlpha = .16 * pn * o; g.lineWidth = 2.5 * u; g.strokeStyle = F.accent; txt(g, F.num, cx, cy - 10 * u - (tl0n(g, F, tO, W) - 1) * 40 * u + (1 - pn) * 40 * u, { font: 'Bebas Neue', wt: 400, size: 420 * u, noFill: true, stroke: 2.5 * u, strokeColor: F.accent }); g.restore();
      // label flanked by growing rules
      const tl0 = wrap(g, F.title, W * .82, tO), lh0 = tO.size * 1.25; const pl = E.o3(seg(t, .2, .8)) * o; const lw = tw(g, F.label, lO); const ly = cy + 10 * u - (tl0.length - 1) * lh0 / 2 - lh0 * .62 - 34 * u;
      g.save(); g.globalAlpha = pl; txt(g, F.label, cx, ly, { ...lO, color: F.accent }); g.fillStyle = F.accent; const rl = 90 * u * E.smooth(seg(t, .35, 1.05)) * o;
      g.fillRect(cx + lw / 2 + 22 * u, ly, rl, 2 * u); g.fillRect(cx - lw / 2 - 22 * u - rl, ly, rl, 2 * u); g.restore();
      // title rises through a mask
      const lines = wrap(g, F.title, W * .82, tO); const lh = tO.size * 1.25; const ty = cy + 10 * u - (lines.length - 1) * lh / 2;
      lines.forEach((ln, i) => { const p = E.o5(seg(t, .35 + i * .12, 1.1 + i * .12)); g.save(); g.beginPath(); g.rect(0, ty + i * lh - lh * .62, W, lh * 1.2); g.clip(); shadow(g, k, 24, .5, 4); g.globalAlpha = o; txt(g, ln, cx, ty + i * lh + (1 - p) * lh * 1.35 - (1 - o) * 30 * u, { ...tO, color: '#ffffff' }); g.restore(); });
      const ps = E.o3(seg(t, .9, 1.5)) * o; g.save(); g.globalAlpha = ps; txt(g, F.sub, cx, ty + (lines.length - 1) * lh + 92 * u + (1 - ps) * 14 * u, { ...sO, color: '#cfd3d8' }); g.restore();
    } });

  /* =============== 7. date / location stamp (typewriter) =============== */
  def({ id: 'datestamp', n: 'ختم التاريخ والمكان', cat: 'doc', dur: 5,
    fields: [tF('line1', 'السطر الأول', '24 يونيو 1812'), tF('line2', 'السطر الثاني', 'نهر نيمن — الحدود الروسية'), cF('accent', 'لون المؤشر', '#f0b429'), nF('cps', 'سرعة الكتابة', 16, 4, 60, 1, ' حرف/ث'), sF('side', 'الموضع', 'right', [['right', 'أسفل اليمين'], ['left', 'أسفل اليسار'], ['top', 'أعلى الوسط']])],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .5), cps = Math.max(1, F.cps || 16);
      const o1 = { font: isAr(F.line1) ? 'IBM Plex Sans Arabic' : 'JetBrains Mono', wt: 600, size: 46 * u }, o2 = { font: isAr(F.line2) ? 'IBM Plex Sans Arabic' : 'JetBrains Mono', wt: 400, size: 34 * u };
      const pos = F.side || 'right'; const R = pos === 'right', C = pos === 'top';
      const x0 = C ? W / 2 : R ? W - W * .06 : W * .06, y1 = C ? H * .1 : H - (vert(W, H) ? H * .2 : H * .13), y2 = y1 + 54 * u;
      const s1 = [...String(F.line1)], s2 = [...String(F.line2)]; const t1 = .25, t2 = t1 + s1.length / cps + .25;
      const n1 = clamp(Math.floor((t - t1) * cps), 0, s1.length), n2 = clamp(Math.floor((t - t2) * cps), 0, s2.length);
      const a1 = s1.slice(0, n1).join(''), a2 = s2.slice(0, n2).join('');
      const w1 = tw(g, F.line1, o1), w2 = tw(g, F.line2, o2), bw = Math.max(w1, w2);
      g.save(); g.globalAlpha = o;
      // marker rule + pin
      const pr = E.o3(seg(t, 0, .3)); g.fillStyle = F.accent;
      if (!C) { const rx = R ? x0 + 22 * u : x0 - 26 * u; g.fillRect(rx, y1 - 26 * u, 4 * u, (y2 - y1 + 50 * u) * pr); }
      shadow(g, k, 14, .7, 2);
      const al = C ? 'center' : R ? 'right' : 'left';
      const curX = (s, w, wFull, opt) => { const ww = tw(g, s, opt); if (C) return x0 + (isAr(s || F.line1) ? (wFull / 2 - ww) - 10 * u : (-wFull / 2 + ww) + 6 * u); return R ? x0 - ww - 10 * u : x0 + ww + 6 * u; };
      // centered typing keeps the final layout: draw growing text anchored at the line's final start edge
      const drawLine = (s, full, y, opt, col) => { if (!s) return; if (C) { const wf = tw(g, full, opt); const ar = isAr(full); txt(g, s, ar ? x0 + wf / 2 : x0 - wf / 2, y, { ...opt, align: ar ? 'right' : 'left', color: col }); } else txt(g, s, x0, y, { ...opt, align: al, color: col }); };
      drawLine(a1, F.line1, y1, o1, '#ffffff'); drawLine(a2, F.line2, y2, o2, '#d9dde3');
      noShadow(g);
      // block cursor: on the line being typed, blinks when done
      const typing2 = t >= t2 - .25 && s2.length; const done = n2 >= s2.length && t > t2;
      const blink = done ? (Math.floor(t * 2.2) % 2 === 0) : true;
      if (blink && t > t1 - .1) { const line = typing2 ? a2 : a1, full = typing2 ? F.line2 : F.line1, opt = typing2 ? o2 : o1, y = typing2 ? y2 : y1;
        let cxp = curX(line, 0, tw(g, full, opt), opt); if (C) { const wf = tw(g, full, opt), ww = tw(g, line, opt); cxp = isAr(full) ? x0 + wf / 2 - ww - 16 * u : x0 - wf / 2 + ww + 4 * u; }
        g.fillStyle = F.accent; g.fillRect(cxp + (R || (C && isAr(full)) ? -6 * u : 0), y - opt.size * .42, opt.size * .5, opt.size * .84); }
      g.restore(); void bw;
    } });

  /* =============== 8. quote card =============== */
  def({ id: 'quote', n: 'بطاقة اقتباس', cat: 'title', dur: 7,
    fields: [tF('quote', 'الاقتباس', 'لن نستسلم أبدًا، سنقاتل على الشواطئ وفي الحقول والشوارع', { ml: 1 }), tF('author', 'القائل', 'ونستون تشرشل، 1940'), cF('accent', 'لون التمييز', '#e0b354'), cF('text', 'لون النص', '#ffffff'), nF('dim', 'تعتيم الخلفية', 55, 0, 100, 1, '%')],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .6), cx = W / 2;
      if (F.dim > 0) { g.globalAlpha = E.o3(seg(t, 0, .6)) * o * F.dim / 100; g.fillStyle = '#07080b'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
      const qO = { font: 'Amiri', wt: 700, size: (vert(W, H) ? 66 : 70) * u }, aO = { font: 'Tajawal', wt: 500, size: 36 * u };
      const lines = wrap(g, F.quote, W * (vert(W, H) ? .82 : .64), qO); const lh = qO.size * 1.45; const blockH = lines.length * lh; const y0 = H / 2 - blockH / 2 + lh / 2 - 20 * u;
      // quote mark
      const pq = Math.max(0, E.back(seg(t, .05, .6))) * o; g.save(); g.globalAlpha = Math.min(1, pq); g.translate(cx, y0 - lh * .55 - 60 * u); g.scale(pq, pq); icon(g, 'quote', 0, 0, 120 * u, F.accent); g.restore();
      // words appear one by one (RTL: from the right edge of each line)
      let wi = 0; const per = .09, t0 = .45; shadow(g, k, 22, .55, 3);
      lines.forEach((ln, li) => {
        const ws = ln.split(' '); const ar = isAr(ln); const lw = tw(g, ln, qO); const sp = tw(g, ' ', qO); let x = ar ? cx + lw / 2 : cx - lw / 2; const y = y0 + li * lh;
        for (const w of ws) { const ww = tw(g, w, qO); const p = E.o3(seg(t, t0 + wi * per, t0 + wi * per + .45)); wi++;
          if (p > 0) { g.globalAlpha = p * o; txt(g, w, ar ? x : x, y + (1 - p) * 16 * u, { ...qO, align: ar ? 'right' : 'left', color: F.text }); }
          x += ar ? -(ww + sp) : ww + sp; }
      });
      noShadow(g);
      const ta = t0 + wi * per + .1; const pa = E.o3(seg(t, ta, ta + .6)) * o; g.globalAlpha = pa; const ay = y0 + blockH - lh / 2 + 70 * u; const aw = tw(g, F.author, aO);
      g.fillStyle = F.accent; g.fillRect(cx - 24 * u, ay - 44 * u, 48 * u * pa, 3 * u); txt(g, F.author, cx, ay, { ...aO, color: F.accent }); g.globalAlpha = 1; void aw;
    } });

  /* =============== 9. counter / number count-up =============== */
  def({ id: 'counter', n: 'عداد أرقام تصاعدي', cat: 'data', dur: 5, main: 'label',
    fields: [nF('from', 'من', 0, -1e9, 1e9, 1), nF('to', 'إلى', 60000, -1e9, 1e9, 1), nF('count', 'مدة العد', 2.4, .2, 20, .1, ' ث'), nF('dec', 'منازل عشرية', 0, 0, 3, 1), tF('prefix', 'قبل الرقم', ''), tF('suffix', 'بعد الرقم', '+'), tF('label', 'الوصف', 'قتيل في اليوم الأول من معركة السوم'), cF('accent', 'لون الرقم', '#ffcf4a'), DIG],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .5), cx = W / 2, cy = H / 2 - 30 * u;
      const p = E.expo(seg(t, .25, .25 + (+F.count || 2.4))); const v = (+F.from) + ((+F.to) - (+F.from)) * p;
      const dig = F.digits; const s = (F.prefix || '') + fmtNum(v, dig, true, +F.dec || 0) + (F.suffix || '');
      const full = (F.prefix || '') + fmtNum(+F.to, dig, true, +F.dec || 0) + (F.suffix || '');
      const big = Math.min(210 * u, W * .8 / Math.max(3, full.length) * 1.75);
      const nO = dig === 'ar' ? { font: 'Cairo', wt: 900, size: big * .92 } : { font: 'Oswald', wt: 700, size: big };
      const pin = E.o5(seg(t, 0, .5)); g.save(); g.globalAlpha = pin * o; shadow(g, k, 30, .5, 6);
      const sc = .9 + .1 * pin; g.translate(cx, cy); g.scale(sc, sc);
      // fixed-width layout: measure the final value so digits do not jitter the centre
      const fw = tw(g, full, nO); g.save(); g.beginPath(); g.rect(-W, -big, 2 * W, big * 2); g.clip();
      txt(g, s, isAr(s) ? fw / 2 : -fw / 2, 0, { ...nO, align: isAr(s) ? 'right' : 'left', color: F.accent }); g.restore();
      g.restore();
      const pl = E.smooth(seg(t, .4, 1.2)) * o; g.fillStyle = F.accent; g.globalAlpha = .9 * o; g.fillRect(cx - fw * .45 * pl, cy + big * .62, fw * .9 * pl, 4 * u);
      const pt = E.o3(seg(t, .6, 1.2)) * o; g.globalAlpha = pt; shadow(g, k, 16, .6, 2);
      const lines = wrap(g, F.label, W * .8, { font: 'Tajawal', wt: 700, size: 46 * u }); lines.forEach((ln, i) => txt(g, ln, cx, cy + big * .62 + 62 * u + i * 58 * u + (1 - pt) * 16 * u, { font: 'Tajawal', wt: 700, size: 46 * u, color: '#eef0f3' }));
      g.globalAlpha = 1; noShadow(g);
    } });

  /* =============== 10. progress bar =============== */
  def({ id: 'progress', n: 'شريط تقدم', cat: 'data', dur: 5,
    fields: [tF('label', 'الوصف', 'نسبة الأراضي المسيطر عليها'), nF('value', 'القيمة', 72, 0, 100, 1, '%'), cF('accent', 'لون التعبئة', '#3ddc97'), cF('track', 'لون المسار', '#ffffff'), DIG],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .5), V = vert(W, H); const bw = V ? W * .8 : W * .52, bh = 18 * u, x0 = (W - bw) / 2, y = V ? H * .62 : H * .72;
      const pin = E.o3(seg(t, 0, .5)) * o; const pv = E.smooth(seg(t, .5, 2.1)) * clamp(+F.value, 0, 100) / 100;
      g.save(); g.globalAlpha = pin; shadow(g, k, 20, .4, 4);
      const lO = { font: 'Cairo', wt: 700, size: 40 * u }, vO = F.digits === 'ar' ? { font: 'Cairo', wt: 900, size: 54 * u } : { font: 'Oswald', wt: 700, size: 58 * u };
      txt(g, F.label, x0 + bw, y - 50 * u + (1 - pin) * 12 * u, { ...lO, align: 'right', color: '#ffffff' });
      const val = toAr(Math.round(pv * 100), F.digits) + (F.digits === 'ar' ? '٪' : '%'); txt(g, val, x0, y - 50 * u + (1 - pin) * 12 * u, { ...vO, align: 'left', color: F.accent });
      noShadow(g);
      g.fillStyle = rgba(F.track, .18); rr(g, x0, y - bh / 2, bw, bh, bh / 2); g.fill();
      // fill grows right → left for Arabic labels, left → right otherwise
      const R = isAr(F.label); const fw = bw * pv; if (fw > .5) { g.fillStyle = F.accent; shadow(g, k, 16, .0, 0); g.shadowColor = rgba(F.accent, .6); rr(g, R ? x0 + bw - fw : x0, y - bh / 2, fw, bh, bh / 2); g.fill(); noShadow(g);
        g.fillStyle = '#fff'; g.globalAlpha = pin * .9; g.beginPath(); g.arc(R ? x0 + bw - fw + bh / 2 : x0 + fw - bh / 2, y, bh * .28, 0, 7); g.fill(); }
      g.globalAlpha = pin * .5; g.fillStyle = '#ffffff'; for (const q of [.25, .5, .75]) g.fillRect(x0 + bw * q - u, y + bh / 2 + 8 * u, 2 * u, 10 * u);
      g.restore();
    } });

  /* =============== 11. countdown =============== */
  def({ id: 'countdown', n: 'عد تنازلي', cat: 'data', dur: 5.6,
    fields: [nF('from', 'يبدأ من', 5, 1, 99, 1, ' ث'), tF('label', 'الوصف', 'يبدأ الهجوم خلال'), cF('accent', 'لون الحلقة', '#ff5a3c'), DIG],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .45), cx = W / 2, cy = H / 2 + 10 * u, R = 150 * u; const N = Math.max(1, Math.round(+F.from || 5));
      const rem = Math.max(0, N - t); const n = Math.ceil(rem - 1e-6); const fr = rem - Math.floor(rem);
      const pin = Math.max(0, E.back(seg(t, 0, .45))) * o; if (pin <= 0) return;
      g.save(); g.translate(cx, cy); g.scale(pin, pin);
      g.fillStyle = 'rgba(10,12,16,.55)'; g.beginPath(); g.arc(0, 0, R + 24 * u, 0, 7); g.fill();
      g.lineWidth = 12 * u; g.strokeStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.stroke();
      g.strokeStyle = F.accent; g.lineCap = 'round'; const a = rem > 0 ? (fr || 1) : 0; if (a > 0) { g.beginPath(); g.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a); g.stroke(); }
      const tick = rem > 0 ? 1 - (fr || 1) : 1; const pulse = 1 + .12 * Math.max(0, 1 - tick * 5);
      g.save(); g.scale(pulse, pulse); shadow(g, k, 20, .5, 4); txt(g, toAr(n, F.digits), 0, 8 * u, F.digits === 'ar' ? { font: 'Cairo', wt: 900, size: 160 * u, color: '#fff' } : { font: 'Oswald', wt: 700, size: 170 * u, color: '#fff' }); g.restore();
      g.restore();
      g.globalAlpha = E.o3(seg(t, .2, .7)) * o; shadow(g, k, 14, .6, 2); txt(g, F.label, cx, cy - R - 70 * u, { font: 'Cairo', wt: 700, size: 44 * u, color: '#fff' }); g.globalAlpha = 1;
    } });

  /* =============== 12. callout arrow + label =============== */
  def({ id: 'callout', n: 'سهم توضيحي مع عنوان', cat: 'doc', dur: 5,
    fields: [tF('label', 'العنوان', 'موقع الإنزال'), tF('sub', 'الوصف', 'شاطئ أوماها — 6 يونيو 1944'), nF('tx', 'الهدف أفقيًا', 40, 0, 100, .5, '%'), nF('ty', 'الهدف رأسيًا', 62, 0, 100, .5, '%'),
      sF('dir', 'الاتجاه', 'ur', [['ur', 'أعلى اليمين'], ['ul', 'أعلى اليسار'], ['dr', 'أسفل اليمين'], ['dl', 'أسفل اليسار']]), cF('accent', 'اللون', '#ffd23f')],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .5); const px = W * F.tx / 100, py = H * F.ty / 100;
      const sx = (F.dir || 'ur')[1] === 'r' ? 1 : -1, sy = (F.dir || 'ur')[0] === 'u' ? -1 : 1;
      const lO = { font: 'Cairo', wt: 800, size: 46 * u }, sO = { font: 'Tajawal', wt: 500, size: 30 * u };
      const d1 = 130 * u, hl = Math.max(tw(g, F.label, lO), tw(g, F.sub, sO)) + 40 * u;
      const ex = px + sx * d1 * .75, ey = py + sy * d1, hx = ex + sx * hl;
      const p0 = E.back(seg(t, 0, .4)), p1 = E.io(seg(t, .25, .65)), p2 = E.smooth(seg(t, .6, 1.1));
      const q1 = p1 * o, q2 = p2 * o;
      g.save(); shadow(g, k, 10, .55, 2);
      // pulsing target
      g.fillStyle = F.accent; g.beginPath(); g.arc(px, py, 10 * u * Math.max(0, p0) * (o > 0 ? 1 : 0) * Math.min(1, o * 2), 0, 7); g.fill();
      const ph = ((t - .3) % 1.3) / 1.3; if (t > .3 && o > .5) { g.strokeStyle = F.accent; g.lineWidth = 3 * u; g.globalAlpha = (1 - ph) * o; g.beginPath(); g.arc(px, py, 12 * u + 34 * u * E.o3(ph), 0, 7); g.stroke(); g.globalAlpha = 1; }
      g.strokeStyle = F.accent; g.lineWidth = 4 * u; g.lineCap = 'round'; g.lineJoin = 'round';
      const st = 16 * u; const ux = (ex - px) / Math.hypot(ex - px, ey - py), uy = (ey - py) / Math.hypot(ex - px, ey - py);
      g.beginPath(); g.moveTo(px + ux * st, py + uy * st); const L1 = Math.hypot(ex - px, ey - py) - st; g.lineTo(px + ux * (st + L1 * q1), py + uy * (st + L1 * q1));
      if (q1 >= .999) g.lineTo(ex + (hx - ex) * q2, ey); g.stroke();
      noShadow(g);
      // label above the shelf, description below, revealed from the elbow
      const left = Math.min(ex, hx), wid = Math.abs(hx - ex) * q2; g.save(); g.beginPath(); g.rect(sx > 0 ? left : hx + (hx < ex ? Math.abs(hx - ex) * (1 - q2) : 0), ey - 80 * u, wid, 160 * u); g.clip();
      shadow(g, k, 16, .7, 2); const al = sx > 0 ? 'left' : 'right'; const tx0 = ex + sx * 8 * u;
      txt(g, F.label, tx0, ey - 34 * u, { ...lO, align: al, color: '#ffffff' }); txt(g, F.sub, tx0, ey + 30 * u, { ...sO, align: al, color: '#e5e7ea' }); g.restore();
      g.restore();
    } });

  /* =============== 13. highlight box =============== */
  def({ id: 'highlight', n: 'إطار تمييز', cat: 'doc', dur: 5,
    fields: [nF('x', 'يسار', 34, 0, 100, .5, '%'), nF('y', 'أعلى', 28, 0, 100, .5, '%'), nF('w', 'العرض', 32, 1, 100, .5, '%'), nF('h', 'الارتفاع', 40, 1, 100, .5, '%'), tF('label', 'التسمية', 'لاحظ هنا'),
      sF('style', 'الشكل', 'brackets', [['brackets', 'زوايا'], ['rect', 'مستطيل'], ['ellipse', 'دائرة']]), cF('accent', 'اللون', '#ffd23f'), nF('dim', 'تعتيم الخارج', 45, 0, 90, 1, '%')],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .45); const x = W * F.x / 100, y = H * F.y / 100, w = W * F.w / 100, h = H * F.h / 100; const cx = x + w / 2, cy = y + h / 2;
      const pd = E.o3(seg(t, 0, .5)) * o;
      if (F.dim > 0 && pd > 0) { g.save(); g.fillStyle = `rgba(0,0,0,${F.dim / 100 * pd})`; g.beginPath(); g.rect(0, 0, W, H); if (F.style === 'ellipse') g.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2, true); else { g.moveTo(x, y); g.lineTo(x, y + h); g.lineTo(x + w, y + h); g.lineTo(x + w, y); g.closePath(); } g.fill('evenodd'); g.restore(); }
      g.save(); g.strokeStyle = F.accent; g.lineWidth = 6 * u; g.lineCap = 'round'; g.lineJoin = 'round'; shadow(g, k, 12, .5, 0);
      const p = E.smooth(seg(t, .1, .8));
      if (F.style === 'brackets') {
        const off = (1 - E.o5(seg(t, .05, .7))) * 60 * u, L = Math.min(w, h) * .22; g.globalAlpha = Math.min(1, p * 2) * o;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const qx = cx + sx * (w / 2 + off), qy = cy + sy * (h / 2 + off); g.beginPath(); g.moveTo(qx, qy - sy * L); g.lineTo(qx, qy); g.lineTo(qx - sx * L, qy); g.stroke(); }
      } else if (F.style === 'ellipse') { g.beginPath(); g.ellipse(cx, cy, w / 2, h / 2, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p * (o > .02 ? 1 : 0)); g.globalAlpha = o; g.stroke(); }
      else { const per = 2 * (w + h); g.setLineDash([per * p, per]); g.globalAlpha = o; g.beginPath(); g.moveTo(x + w, y); g.lineTo(x, y); g.lineTo(x, y + h); g.lineTo(x + w, y + h); g.closePath(); g.stroke(); g.setLineDash([]); }
      g.restore();
      if (F.label) { const lO = { font: 'Cairo', wt: 800, size: 34 * u }; const lw = tw(g, F.label, lO) + 34 * u, lh = 54 * u; const pl = E.back(seg(t, .5, .95)) * o; if (pl > 0) {
        const tx = F.style === 'ellipse' ? cx : x + w, ty = F.style === 'ellipse' ? y - lh * .7 : y - lh * .5 - 14 * u; g.save(); g.translate(F.style === 'ellipse' ? tx : tx - lw / 2, ty); g.scale(pl, pl); shadow(g, k, 14, .45, 3); g.fillStyle = F.accent; rr(g, -lw / 2, -lh / 2, lw, lh, 6 * u); g.fill(); noShadow(g); txt(g, F.label, 0, 2 * u, { ...lO, color: '#111' }); g.restore(); } }
    } });

  /* =============== 14. split-screen labels =============== */
  def({ id: 'split', n: 'عناوين شاشة مقسومة', cat: 'doc', dur: 5,
    fields: [tF('right', 'عنوان اليمين', 'برلين 1945'), tF('rsub', 'وصف اليمين', 'بعد القصف'), cF('rcol', 'لون اليمين', '#d64545'), tF('left', 'عنوان اليسار', 'برلين اليوم'), tF('lsub', 'وصف اليسار', 'المكان نفسه'), cF('lcol', 'لون اليسار', '#2f80ed'),
      sF('div', 'الفاصل', 'on', [['on', 'إظهار'], ['off', 'إخفاء']])],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .45), V = vert(W, H);
      if (F.div !== 'off') { const pd = E.smooth(seg(t, 0, .6)) * o; g.save(); g.fillStyle = '#fff'; shadow(g, k, 14, .6, 0); if (V) g.fillRect(W / 2 - W / 2 * pd, H / 2 - 3 * u, W * pd, 6 * u); else g.fillRect(W / 2 - 3 * u, H / 2 - H / 2 * pd, 6 * u, H * pd); g.restore(); }
      const lO = { font: 'Cairo', wt: 800, size: 46 * u }, sO = { font: 'Tajawal', wt: 500, size: 30 * u };
      const tag = (s, sub, col, cx, cy, d) => {
        const p = E.snap(seg(t, .3 + d, .9 + d)) * o; if (p <= 0) return; const w = tw(g, s, lO) + 50 * u, h = 72 * u;
        g.save(); g.globalAlpha = Math.min(1, p * 1.5); g.translate(cx, cy + (1 - p) * -30 * u); shadow(g, k, 20, .45, 5); g.fillStyle = col; rr(g, -w / 2, -h / 2, w, h, 8 * u); g.fill(); noShadow(g);
        txt(g, s, 0, 3 * u, { ...lO, color: '#fff' }); if (sub) { shadow(g, k, 12, .8, 2); txt(g, sub, 0, h / 2 + 34 * u, { ...sO, color: '#f2f2f2' }); } g.restore();
      };
      if (V) { tag(F.right, F.rsub, F.rcol, W / 2, H * .08, 0); tag(F.left, F.lsub, F.lcol, W / 2, H * .58, .12); }
      else { tag(F.right, F.rsub, F.rcol, W * .75, H * .1, 0); tag(F.left, F.lsub, F.lcol, W * .25, H * .1, .12); }
    } });

  /* =============== 15. end screen layout =============== */
  def({ id: 'endscreen', n: 'شاشة النهاية', cat: 'social', dur: 12,
    fields: [tF('title', 'العنوان', 'شاهد أيضًا'), tF('v1', 'الفيديو الأول', 'الحلقة السابقة'), tF('v2', 'الفيديو الثاني', 'الأكثر مشاهدة'), tF('sub', 'زر الاشتراك', 'اشترك'), cF('accent', 'لون التمييز', '#e8a33d'), cF('bg', 'لون الخلفية', '#0d1117'), sF('guide', 'إطارات الأماكن', 'on', [['on', 'إظهار'], ['off', 'إخفاء']])],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .6), V = vert(W, H);
      const pb = E.o3(seg(t, 0, .6)) * o; g.save(); g.globalAlpha = pb;
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, F.bg); gr.addColorStop(1, GW.rgb2hex(...GW.hex2rgb(F.bg).map(v => v * .55))); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.globalAlpha = pb * .06; g.strokeStyle = '#fff'; g.lineWidth = 1.5 * u; for (let x = -H; x < W; x += 46 * u) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
      const gv = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.hypot(W, H) * .6); gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(1, 'rgba(0,0,0,.5)'); g.globalAlpha = pb; g.fillStyle = gv; g.fillRect(0, 0, W, H); g.restore();
      const tO = { font: 'Cairo', wt: 900, size: 64 * u }, lO = { font: 'Cairo', wt: 700, size: 34 * u };
      const pt = E.o5(seg(t, .2, .8)) * o; g.save(); g.globalAlpha = pt; txt(g, F.title, W / 2, (V ? H * .12 : H * .14) + (1 - pt) * 20 * u, { ...tO, color: '#fff' }); g.fillStyle = F.accent; g.fillRect(W / 2 - 40 * u * pt, (V ? H * .12 : H * .14) + 52 * u, 80 * u * pt, 5 * u); g.restore();
      // two video slots (16:9) + subscribe circle
      const vw = V ? W * .66 : W * .3, vh = vw * 9 / 16;
      const slots = V ? [[W / 2, H * .33], [W / 2, H * .6]] : [[W * .73, H * .5], [W * .27, H * .5]];
      [[F.v1, slots[0], .35], [F.v2, slots[1], .5]].forEach(([lab, [sx, sy], d]) => {
        const p = E.o5(seg(t, d, d + .7)) * o; if (p <= 0) return; g.save(); g.globalAlpha = p; g.translate(sx, sy + (1 - p) * 40 * u);
        shadow(g, k, 40, .55, 12); g.fillStyle = 'rgba(255,255,255,.06)'; rr(g, -vw / 2, -vh / 2, vw, vh, 14 * u); g.fill(); noShadow(g);
        if (F.guide !== 'off') { g.setLineDash([14 * u, 10 * u]); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2 * u; rr(g, -vw / 2, -vh / 2, vw, vh, 14 * u); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(0, 0, 44 * u, 0, 7); g.fill(); icon(g, 'play', 4 * u, 0, 56 * u, 'rgba(255,255,255,.55)'); }
        txt(g, lab, 0, vh / 2 + 46 * u, { ...lO, color: '#fff' }); g.fillStyle = F.accent; g.fillRect(-vw / 2, vh / 2 + 76 * u, vw * E.smooth(seg(t, d + .3, d + 1)) * o, 3 * u); g.restore();
      });
      const sp = Math.max(0, E.back(seg(t, .75, 1.25))) * o; if (sp > 0) { const R = 92 * u, scx = W / 2, scy = V ? H * .86 : H * .82; g.save(); g.translate(scx, scy); g.scale(sp, sp);
        g.fillStyle = F.accent; shadow(g, k, 30, .5, 8); g.beginPath(); g.arc(0, 0, R * .62, 0, 7); g.fill(); noShadow(g); g.strokeStyle = rgba(F.accent, .5); g.lineWidth = 3 * u; g.beginPath(); g.arc(0, 0, R * .78 + 6 * u * Math.sin(t * 3), 0, 7); g.stroke();
        txt(g, F.sub, 0, 2 * u, { font: 'Cairo', wt: 800, size: 30 * u, color: '#fff' }); g.restore(); }
    } });

  /* =============== 16. vertical Shorts hook title =============== */
  def({ id: 'hook', n: 'عنوان افتتاحي للشورتس', cat: 'social', dur: 4,
    fields: [tF('line1', 'السطر الأول', 'لماذا خسر نابليون'), tF('line2', 'الكلمة المميزة', 'في روسيا؟'), cF('accent', 'لون التمييز', '#ffd400'), cF('text', 'لون النص', '#ffffff'), cF('ink', 'نص التمييز', '#111111')],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .3), V = vert(W, H); const cx = W / 2, y0 = V ? H * .2 : H * .3;
      const sz = (V ? 100 : 104) * u; const O = { font: 'Cairo', wt: 900, size: sz };
      const lines = wrap(g, F.line1, W * (V ? .86 : .7), O); const lh = sz * 1.18; let wi = 0;
      g.save(); shadow(g, k, 24, .6, 6);
      lines.forEach((ln, li) => {
        const ws = ln.split(' '); const ar = isAr(ln); const lw = tw(g, ln, O); const sp = tw(g, ' ', O); let x = ar ? cx + lw / 2 : cx - lw / 2; const y = y0 + li * lh;
        for (const w of ws) { const ww = tw(g, w, O); const p = seg(t, .05 + wi * .11, .4 + wi * .11); wi++; const s = Math.max(0, E.back(p)) * (0.6 + .4 * o); if (p > 0 && o > 0) {
          g.save(); g.globalAlpha = Math.min(1, p * 3) * o; g.translate(ar ? x - ww / 2 : x + ww / 2, y); g.scale(s, s); txt(g, w, 0, 0, { ...O, color: F.text, stroke: 10 * u, strokeColor: 'rgba(0,0,0,.35)' }); g.restore(); }
          x += ar ? -(ww + sp) : ww + sp; }
      });
      noShadow(g);
      if (F.line2) { const y = y0 + lines.length * lh + 18 * u; const O2 = { ...O, size: sz * 1.08 }; const w2 = tw(g, F.line2, O2) + 60 * u, h2 = sz * 1.3; const d = .1 + wi * .11;
        const pb = E.snap(seg(t, d, d + .35)) * o, pt = Math.max(0, E.back(seg(t, d + .15, d + .5))) * o;
        g.save(); g.translate(cx, y); g.rotate(-.025); shadow(g, k, 30, .45, 8); g.fillStyle = F.accent; rr(g, -w2 / 2 * pb, -h2 / 2, w2 * pb, h2, 14 * u); g.fill(); noShadow(g);
        if (pt > 0) { g.scale(pt, pt); txt(g, F.line2, 0, 4 * u, { ...O2, color: F.ink }); } g.restore(); }
      g.restore();
    } });

  /* =============== 17. "source:" citation tag =============== */
  def({ id: 'source', n: 'وسم المصدر', cat: 'doc', dur: 5,
    fields: [tF('label', 'التسمية', 'المصدر:'), tF('text', 'المصدر', 'الأرشيف الوطني البريطاني، 1916'), cF('accent', 'لون التمييز', '#f0b429'), sF('side', 'الجانب', 'left', [['left', 'يسار'], ['right', 'يمين']])],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .4), R = F.side === 'right'; const lO = { font: 'IBM Plex Sans Arabic', wt: 700, size: 27 * u }, tO = { font: 'IBM Plex Sans Arabic', wt: 400, size: 27 * u };
      const h = 52 * u, ic = 36 * u, gap = 10 * u, lw = tw(g, F.label, lO), xw = tw(g, F.text, tO), w = h + lw + gap + xw + 26 * u;
      const y = H - (vert(W, H) ? H * .16 : H * .07) - h / 2, x0 = R ? W - W * .045 - w : W * .045;
      const pi = E.back(seg(t, 0, .35)) * o, pw = E.snap(seg(t, .15, .7)) * o; if (pi <= 0) return;
      g.save(); shadow(g, k, 18, .45, 4); g.fillStyle = 'rgba(12,14,18,.78)'; const ww = h + (w - h) * pw; rr(g, R ? x0 + w - ww : x0, y - h / 2, ww, h, h / 2); g.fill(); noShadow(g);
      const icx = R ? x0 + w - h / 2 : x0 + h / 2; g.save(); g.translate(icx, y); g.scale(Math.max(0, pi), Math.max(0, pi)); g.fillStyle = F.accent; g.beginPath(); g.arc(0, 0, h / 2 - 6 * u, 0, 7); g.fill(); icon(g, 'doc', 0, 0, ic * .62, '#111'); g.restore();
      g.save(); g.beginPath(); g.rect(R ? x0 + w - ww : x0, y - h / 2, ww, h); g.clip(); const pt = E.o3(seg(t, .35, .8)); g.globalAlpha = pt * o;
      // Arabic: label then text, right to left
      const ar = isAr(F.label + F.text); let x = R ? x0 + w - h - 4 * u : x0 + h + 4 * u;
      if (ar) { x = R ? x : x0 + w - 18 * u; txt(g, F.label, x, y + 2 * u, { ...lO, align: 'right', color: F.accent }); txt(g, F.text, x - lw - gap, y + 2 * u, { ...tO, align: 'right', color: '#eceff3' }); }
      else { txt(g, F.label, x, y + 2 * u, { ...lO, align: 'left', color: F.accent }); txt(g, F.text, x + lw + gap, y + 2 * u, { ...tO, align: 'left', color: '#eceff3' }); }
      g.restore(); g.restore();
    } });

  /* =============== 18. old-film documentary title =============== */
  def({ id: 'oldfilm', n: 'عنوان وثائقي بطابع فيلم قديم', cat: 'title', dur: 6,
    fields: [tF('title', 'العنوان', 'معركة العلمين'), tF('sub', 'العنوان الفرعي', 'الصحراء الغربية — 1942'), cF('tone', 'لون الطبعة', '#2a2117'), cF('ink', 'لون الكتابة', '#efe3c6'), sF('bg', 'الخلفية', 'full', [['full', 'كاملة'], ['overlay', 'فوق اللقطات']]), nF('grain', 'الحبيبات', 60, 0, 100, 1, '%')],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), fr = Math.floor(t * 18), rnd = GW.rng(fr * 7919 + 13); const rr0 = () => rnd(); const fin = E.o3(seg(t, 0, .9)), fo = outro(t, dur, .8); const vis = fin * fo;
      const full = F.bg !== 'overlay';
      g.save();
      if (full) { g.globalAlpha = vis; const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .1, W / 2, H / 2, Math.hypot(W, H) * .55); const [r, gg, b] = GW.hex2rgb(F.tone); gr.addColorStop(0, `rgb(${Math.min(255, r * 1.9)},${Math.min(255, gg * 1.9)},${Math.min(255, b * 1.9)})`); gr.addColorStop(1, F.tone); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
      // flicker + vignette
      g.globalAlpha = vis * (full ? 1 : .8); const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.hypot(W, H) * .58); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.75)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
      g.globalAlpha = vis * (.04 + rr0() * .08); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      // grain tile (seeded per frame)
      if (F.grain > 0) { const tile = grainTile(); g.globalAlpha = vis * F.grain / 100 * .16; g.globalCompositeOperation = full ? 'overlay' : 'soft-light'; const ox = rr0() * 256, oy = rr0() * 256, ts = 256 * Math.max(1, 2 * u);
        g.save(); g.translate(-ox, -oy); for (let y = 0; y < H + ts; y += ts) for (let x = 0; x < W + ts; x += ts) g.drawImage(tile, x, y, ts, ts); g.restore(); g.globalCompositeOperation = 'source-over'; }
      // scratches + dust
      g.globalAlpha = vis * .5; g.strokeStyle = 'rgba(235,225,200,.55)'; for (let i = 0; i < 2; i++) if (rr0() < .55) { const x = rr0() * W; g.lineWidth = (.8 + rr0() * 1.5) * u; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rr0() - .5) * 30 * u, H); g.stroke(); }
      g.fillStyle = 'rgba(20,14,8,.7)'; for (let i = 0; i < 6; i++) { if (rr0() < .5) continue; g.beginPath(); g.arc(rr0() * W, rr0() * H, (1 + rr0() * 3) * u, 0, 7); g.fill(); }
      // gate weave
      const jx = (rr0() - .5) * 3 * u, jy = (rr0() - .5) * 3 * u; const cx = W / 2 + jx, cy = H / 2 + jy;
      const tO = { font: 'Amiri', wt: 700, size: (vert(W, H) ? 110 : 132) * u }, sO = { font: 'Reem Kufi', wt: 400, size: 42 * u };
      const pt = E.o3(seg(t, .5, 1.6)) * fo; g.globalAlpha = pt * (.92 + rr0() * .08); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 18 * k;
      const lines = wrap(g, F.title, W * .85, tO); const lh = tO.size * 1.2; lines.forEach((ln, i) => txt(g, ln, cx, cy - 30 * u - (lines.length - 1 - i) * lh, { ...tO, color: F.ink }));
      noShadow(g); const pl = E.smooth(seg(t, 1, 2)) * fo; g.globalAlpha = pl; g.fillStyle = F.ink; const lw = 230 * u * pl, ly = cy + 50 * u;
      g.fillRect(cx - lw - 18 * u, ly, lw, 2 * u); g.fillRect(cx + 18 * u, ly, lw, 2 * u); g.save(); g.translate(cx, ly + u); g.rotate(Math.PI / 4); g.fillRect(-6 * u, -6 * u, 12 * u, 12 * u); g.restore();
      const ps = E.o3(seg(t, 1.3, 2.2)) * fo; g.globalAlpha = ps * (.9 + rr0() * .1); txt(g, F.sub, cx, ly + 66 * u, { ...sO, color: F.ink });
      // rounded projector gate
      if (full) { g.globalAlpha = vis; g.fillStyle = '#000'; g.beginPath(); g.rect(0, 0, W, H); if (g.roundRect) g.roundRect(W * .02, H * .03, W * .96, H * .94, 40 * u); else g.rect(W * .02, H * .03, W * .96, H * .94); g.fill('evenodd'); }
      g.restore();
      if (full && fin < 1) { g.globalAlpha = 1 - fin; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    } });

  /* =============== 19. map legend card =============== */
  const LEG = [['solid', 'مساحة'], ['arrow', 'سهم'], ['dash', 'خط متقطع'], ['dot', 'نقطة']];
  def({ id: 'legend', n: 'بطاقة دليل الخريطة', cat: 'doc', dur: 6,
    fields: [tF('title', 'العنوان', 'دليل الخريطة'), tF('i1', 'العنصر 1', 'قوات المحور'), cF('c1', 'لون 1', '#d64545'), sF('s1', 'رمز 1', 'solid', LEG), tF('i2', 'العنصر 2', 'قوات الحلفاء'), cF('c2', 'لون 2', '#2f80ed'), sF('s2', 'رمز 2', 'solid', LEG),
      tF('i3', 'العنصر 3', 'اتجاه الهجوم'), cF('c3', 'لون 3', '#f2c14e'), sF('s3', 'رمز 3', 'arrow', LEG), tF('i4', 'العنصر 4', 'خط الجبهة'), cF('c4', 'لون 4', '#ffffff'), sF('s4', 'رمز 4', 'dash', LEG), cF('panel', 'لون اللوحة', '#10141a'), SIDE],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .45), R = F.side !== 'left';
      const items = [1, 2, 3, 4].map(i => [F['i' + i], F['c' + i], F['s' + i]]).filter(x => x[0]);
      const tO = { font: 'Cairo', wt: 800, size: 32 * u }, iO = { font: 'Tajawal', wt: 500, size: 30 * u };
      const pad = 26 * u, rowH = 52 * u, sw = 54 * u; const w = Math.max(tw(g, F.title, tO), ...items.map(x => tw(g, x[0], iO) + sw + 22 * u)) + pad * 2;
      const h = pad + 44 * u + 16 * u + items.length * rowH + pad * .6; const x0 = R ? W - W * .045 - w : W * .045, y0 = H - (vert(W, H) ? H * .2 : H * .07) - h;
      const pp = E.snap(seg(t, 0, .55)) * o; if (pp <= 0) return; const hh = h * pp;
      g.save(); shadow(g, k, 30, .45, 8); g.fillStyle = rgba(F.panel, .9); rr(g, x0, y0 + h - hh, w, hh, 10 * u); g.fill(); noShadow(g);
      g.beginPath(); g.rect(x0, y0 + h - hh, w, hh); g.clip();
      const al = R ? 'right' : 'left', tx = R ? x0 + w - pad : x0 + pad, dir = R ? -1 : 1;
      const pt = E.o3(seg(t, .3, .7)) * o; g.globalAlpha = pt; txt(g, F.title, tx, y0 + pad + 20 * u, { ...tO, align: al, color: '#fff' });
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x0 + pad, y0 + pad + 48 * u, (w - pad * 2) * E.smooth(seg(t, .35, .9)), 1.5 * u);
      items.forEach(([lab, col, sym], i) => {
        const p = E.o3(seg(t, .5 + i * .12, .9 + i * .12)) * o; if (p <= 0) return; const cy = y0 + pad + 44 * u + 16 * u + rowH * (i + .5); g.globalAlpha = p;
        const sx = tx + dir * (sw / 2) + dir * (1 - p) * -20 * u; g.save(); g.translate(sx, cy); g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round';
        if (sym === 'arrow') { g.lineWidth = 6 * u; const a = -dir; g.beginPath(); g.moveTo(-a * sw / 2, 0); g.lineTo(a * (sw / 2 - 12 * u), 0); g.stroke(); g.beginPath(); g.moveTo(a * sw / 2, 0); g.lineTo(a * (sw / 2 - 16 * u), -11 * u); g.lineTo(a * (sw / 2 - 16 * u), 11 * u); g.closePath(); g.fill(); }
        else if (sym === 'dash') { g.lineWidth = 5 * u; g.setLineDash([10 * u, 8 * u]); g.beginPath(); g.moveTo(-sw / 2, 0); g.lineTo(sw / 2, 0); g.stroke(); g.setLineDash([]); }
        else if (sym === 'dot') { g.beginPath(); g.arc(0, 0, 11 * u, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2 * u; g.stroke(); }
        else { g.globalAlpha = p * .85; rr(g, -sw / 2, -15 * u, sw, 30 * u, 4 * u); g.fill(); g.globalAlpha = p; g.lineWidth = 2 * u; g.stroke(); }
        g.restore(); txt(g, lab, tx + dir * (sw + 20 * u), cy + 2 * u, { ...iO, align: al, color: '#e9edf2' });
      });
      g.restore();
    } });

  /* =============== 20. year marker (odometer digits) =============== */
  def({ id: 'year', n: 'علامة السنة', cat: 'title', dur: 4,
    fields: [tF('year', 'السنة', '1945'), tF('caption', 'الوصف', 'نهاية الحرب العالمية الثانية'), cF('accent', 'لون التمييز', '#e8a33d'), cF('text', 'لون الرقم', '#ffffff'), DIG],
    draw(g, F, t, dur, W, H, k) {
      const u = U(W, H), o = outro(t, dur, .5), cx = W / 2, cy = H / 2 - 20 * u; const ds = [...toAr(F.year, F.digits)];
      const O = F.digits === 'ar' ? { font: 'Cairo', wt: 900, size: 230 * u } : { font: 'Bebas Neue', wt: 400, size: 300 * u };
      const widths = ds.map(d => tw(g, d, O)); const tot = widths.reduce((a, b) => a + b, 0); const bandH = O.size * .82;
      g.save(); g.beginPath(); g.rect(0, cy - bandH / 2, W, bandH); g.clip(); shadow(g, k, 24, .5, 5);
      const ar = F.digits === 'ar'; let x = cx - tot / 2; // digits lay out left → right in both scripts
      ds.forEach((d, i) => { const p = E.o5(seg(t, .1 + i * .09, .75 + i * .09)); const q = 1 - E.io(seg(t, dur - .5 + i * .04, dur - .2 + i * .04)); txt(g, d, x + widths[i] / 2, cy + (ar ? 10 * u : 12 * u) + (1 - p) * bandH + (1 - q) * -bandH, { ...O, color: F.text }); x += widths[i]; });
      g.restore();
      const pl = E.smooth(seg(t, .3, 1)) * o; g.fillStyle = F.accent; g.fillRect(cx - (tot / 2 + 30 * u) * pl, cy - bandH / 2 - 14 * u, (tot + 60 * u) * pl, 5 * u); g.fillRect(cx - (tot / 2 + 30 * u) * pl, cy + bandH / 2 + 9 * u, (tot + 60 * u) * pl, 5 * u);
      const pc = E.o3(seg(t, .7, 1.3)) * o; g.globalAlpha = pc; shadow(g, k, 16, .6, 2); txt(g, F.caption, cx, cy + bandH / 2 + 70 * u + (1 - pc) * 14 * u, { font: 'Tajawal', wt: 700, size: 46 * u, color: '#f1f1f1' }); g.globalAlpha = 1; noShadow(g);
    } });

  /* ---------------- core ---------------- */
  MG.CATS = [['all', 'الكل'], ['lower', 'أسماء'], ['title', 'عناوين'], ['doc', 'وثائقي'], ['data', 'أرقام'], ['news', 'أخبار'], ['social', 'يوتيوب']];
  MG.fields = (id) => { const T = MG.by[id]; return T ? T.fields : []; };
  MG.defaults = (id) => { const o = {}; for (const f of MG.fields(id)) o[f.k] = f.def; return o; };
  MG.draw = (g, mg, t, dur, W, H, k) => {
    const T = MG.by[mg.id]; if (!T) return; const F = Object.assign(MG.defaults(mg.id), mg.f || {});
    g.scale(k, k); T.draw(g, F, Math.max(0, t), Math.max(.1, dur), W, H, k);
  };
  // first text field = clip name / x.str (keeps search, captions export and the timeline label meaningful)
  MG.mainText = (id, f) => { const T0 = MG.by[id]; if (T0 && T0.main && f[T0.main]) return String(f[T0.main]); const tf = MG.fields(id).find(x => x.t === 'text' && f[x.k]); return tf ? String(f[tf.k]) : (MG.by[id] || {}).n || ''; };
  const FAM = [['Cairo', [700, 800, 900]], ['Tajawal', [500, 700]], ['IBM Plex Sans Arabic', [400, 600, 700]], ['Changa', [600]], ['Amiri', [700]], ['Reem Kufi', [400]], ['Bebas Neue', [400]], ['Oswald', [700]], ['JetBrains Mono', [400, 600]]];
  let fontsP = null;
  MG.ensureFonts = () => fontsP || (fontsP = (async () => {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.all(FAM.flatMap(([f, ws]) => ws.map(w => document.fonts.load(`${w} 40px "${f}"`, 'عربي Abc 123').catch(() => {}))));
  })());
  MG.ensureFonts().then(() => { try { GW.invalidate && GW.invalidate(); } catch (e) {} });

  // add a template clip at the playhead (or opts.start) on a free video track
  function freeVTrack(s, t, dur) { const min = GW.TL && GW.TL.target ? GW.TL.target.v : 0; for (let i = min; i < s.vt.length; i++) { if (s.vt[i].lock) continue; if (!s.clips.some(c => c.tt === 'v' && c.ti === i && c.start < t + dur && c.start + c.dur > t)) return i; } GW.ops.ensureTrack(s, 'v', s.vt.length); return s.vt.length - 1; }
  MG.make = (id, o = {}) => {
    const T = MG.by[id]; if (!T) throw new Error('unknown template ' + id);
    const s = o.seq || GW.seq(); const start = o.start != null ? o.start : s.t; const dur = o.dur || T.dur;
    const ti = o.ti != null ? o.ti : freeVTrack(s, start, dur); GW.ops.ensureTrack(s, 'v', ti);
    const f = Object.assign(MG.defaults(id), GW.clone(o.fields || {}));
    const c = GW.newClip('text', { ti, start, dur, name: T.n, seq: s });
    Object.assign(c.text, { animIn: 'none', animOut: 'none', shadow: 0, mg: { id, f } }); c.text.str = MG.mainText(id, f);
    c.name = T.n + ' · ' + c.text.str.slice(0, 30); c.label = '#c8a14a';
    return c;
  };
  MG.add = (id, o = {}) => {
    const s = GW.seq(); const c = MG.make(id, o);
    if (o.track != null) GW.ops.clear(s, 'v', c.ti, c.start, c.start + c.dur);
    s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.commit(o.label || ('إضافة قالب: ' + MG.by[id].n)); GW.bus.emit('selection'); GW.invalidate();
    return c;
  };
  MG.setField = (c, k, v, fin) => {
    const mg = c.text && c.text.mg; if (!mg) return; mg.f[k] = v; c.text.str = MG.mainText(mg.id, mg.f); c.name = MG.by[mg.id].n + ' · ' + c.text.str.slice(0, 30);
    GW.invalidate(); if (GW.TL) GW.TL.invalidate(); if (fin) GW.commit('تعديل القالب'); else GW.commitSoon('تعديل القالب');
  };
  MG.setDur = (c, d) => {
    const s = GW.seq(); const next = s.clips.filter(x => x !== c && x.tt === c.tt && x.ti === c.ti && x.start >= c.start + 1e-6).sort((a, b) => a.start - b.start)[0];
    d = Math.max(.5, Math.min(d, next ? next.start - c.start : 1e9)); c.dur = GW.snapFrame(d, s.fps); GW.invalidate(); if (GW.TL) GW.TL.invalidate(); GW.commitSoon('مدة القالب');
    return c.dur;
  };

  /* ---------------- Essential Graphics: browser + editor ---------------- */
  let cat = 'all', hoverStop = null;
  const thumbBg = (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#3a4350'); gr.addColorStop(.55, '#1d232b'); gr.addColorStop(1, '#14181d'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.moveTo(0, h * .72); g.bezierCurveTo(w * .3, h * .6, w * .6, h * .82, w, h * .66); g.lineTo(w, h); g.lineTo(0, h); g.fill(); };
  const THUMB = { 'lt-classic': [.8, .78, 2.2], 'lt-line': [.8, .78, 2.2], 'lt-stack': [.8, .78, 2.2], source: [.18, .9, 2.6], datestamp: [.82, .84, 2.4], subscribe: [.5, .8, 2.1], callout: [.55, .55, 1.7],
    legend: [.85, .78, 2.2], progress: [.5, .68, 1.7], countdown: [.5, .5, 1.5], breaking: [.6, .86, 1.5], highlight: [.5, .45, 1.3], counter: [.5, .5, 1.3], year: [.5, .5, 1.3], split: [.5, .3, 1.3] };
  MG.thumb = (cv, id, t, f) => {
    const T = MG.by[id]; const g = cv.getContext('2d'); const w = cv.width, h = cv.height; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); thumbBg(g, w, h);
    const [fx, fy, z] = THUMB[id] || [.5, .5, 1]; const ox = clamp(fx * w * z - w / 2, 0, w * z - w), oy = clamp(fy * h * z - h / 2, 0, h * z - h); // zoom on small elements
    g.save(); g.translate(-ox, -oy); g.scale(z, z); try { MG.draw(g, { id, f: f || {} }, t, T.dur, 1920, 1080, w / 1920); } catch (e) { console.error(e); } g.restore();
  };
  MG.heroT = (id) => { const T = MG.by[id]; return Math.min(T.dur - .7, ({ subscribe: 3.4, countdown: 2.6, datestamp: 3.2, quote: 4.2, oldfilm: 3, hook: 2.4, endscreen: 2.5 })[id] || 2.2); };
  MG.renderBrowser = (outer, wrap0) => {
    const body = wrap0 || document.createElement('div'); body.className = 'mg-lib'; if (!wrap0) outer.append(body);
    const top = document.createElement('div'); top.className = 'mg-cats';
    for (const [k, n] of MG.CATS) { const b = document.createElement('button'); b.className = 'chip' + (cat === k ? ' on' : ''); b.textContent = n; b.onclick = () => { cat = k; body.innerHTML = ''; MG.renderBrowser(outer, body); }; top.append(b); }
    body.append(top);
    const grid = document.createElement('div'); grid.className = 'eg-grid mg-grid';
    for (const T of MG.list.filter(x => cat === 'all' || x.cat === cat)) {
      const card = document.createElement('div'); card.className = 'eg-card mg-card'; card.dataset.mg = T.id; card.title = 'مرّر للمعاينة، انقر للإضافة عند مؤشر التشغيل';
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; const cap = document.createElement('div'); cap.innerHTML = `<span>${GW.esc(T.n)}</span><small>${(+T.dur).toFixed(1)} ث</small>`;
      const add = document.createElement('button'); add.className = 'mg-add'; add.innerHTML = GW.ico('plus', 14); add.title = 'إضافة إلى الخط الزمني';
      card.append(cv, add, cap);
      const still = () => MG.thumb(cv, T.id, MG.heroT(T.id));
      MG.ensureFonts().then(() => requestAnimationFrame(still));
      card.onmouseenter = () => {
        if (hoverStop) hoverStop(); let run = true; const t0 = performance.now();
        const loop = () => { if (!run || !cv.isConnected) return; const t = ((performance.now() - t0) / 1000) % (T.dur + .6); MG.thumb(cv, T.id, Math.min(t, T.dur - .02)); requestAnimationFrame(loop); };
        hoverStop = () => { run = false; still(); hoverStop = null; }; loop();
      };
      card.onmouseleave = () => { if (hoverStop) hoverStop(); };
      card.onclick = () => { MG.add(T.id); GW.UI && GW.UI.egEdit && GW.UI.egEdit(); };
      grid.append(card);
    }
    body.append(grid);
  };
  // classic title presets (GW.TITLE_PRESETS): large, auto-fitted thumbnail on the same backdrop, entrance animation on hover
  MG.presetCard = (card, cv, p, i) => {
    const fake = { id: 'eg-prev' + i, dur: 3.2, text: Object.assign(GW.defaultText(), GW.clone(p.t)) };
    const draw = (lt) => {
      const g = cv.getContext('2d'); const w = cv.width, h = cv.height; g.setTransform(1, 0, 0, 1, 0, 0); thumbBg(g, w, h);
      const x = fake.text; const m = GW.TextR.measure(x, 1); const pad = x.bg ? x.bgPad : 10; const bw = (x.boxW || m.w) + pad * 2, bh = m.lh * m.lines.length + pad * 1.2;
      const kf = Math.min(w * .84 / bw, h * .62 / bh, 320 / 1920 * 2.6);
      const e = GW.TextR.draw(fake, lt, w, h, kf); g.drawImage(e.canvas, 0, 0);
    };
    const still = () => draw(1.6);
    MG.ensureFonts().then(() => requestAnimationFrame(still));
    card.classList.add('mg-card'); card.title = 'مرّر للمعاينة، انقر للإضافة عند مؤشر التشغيل';
    card.onmouseenter = () => { if (hoverStop) hoverStop(); let run = true; const t0 = performance.now(); const loop = () => { if (!run || !cv.isConnected) return; draw(((performance.now() - t0) / 1000) % (fake.dur + .5)); requestAnimationFrame(loop); }; hoverStop = () => { run = false; still(); hoverStop = null; }; loop(); };
    card.onmouseleave = () => { if (hoverStop) hoverStop(); };
  };
  MG.renderEdit = (body, c, Fm) => {
    const mg = c.text.mg; const T = MG.by[mg.id]; const f = document.createElement('div'); f.className = 'form mg-form';
    const head = document.createElement('div'); head.className = 'mg-head';
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; head.append(cv); f.append(head);
    // (the preview follows the frame aspect of the active sequence)
    const s = GW.seq(); cv.height = Math.round(320 * s.h / s.w); if (cv.height > 320) { cv.height = 320; cv.width = Math.round(320 * s.w / s.h); }
    const redraw = () => { const g = cv.getContext('2d'); const w = cv.width, h = cv.height; g.setTransform(1, 0, 0, 1, 0, 0); thumbBg(g, w, h); const lt = clamp(s.t - c.start, 0, c.dur); const t = lt > .05 && lt < c.dur - .05 ? lt : Math.min(MG.heroT(mg.id), c.dur * .6); g.save(); try { MG.draw(g, mg, t, c.dur, s.w, s.h, w / s.w); } catch (e) {} g.restore(); };
    MG._redraw = () => { if (cv.isConnected) redraw(); }; MG.ensureFonts().then(redraw);
    f.append(Fm.sec('القالب: ' + T.n));
    for (const fd of T.fields) {
      const v = mg.f[fd.k] != null ? mg.f[fd.k] : fd.def; const on = (val, fin) => { MG.setField(c, fd.k, val, fin); redraw(); };
      if (fd.t === 'text') {
        const ta = document.createElement(fd.ml ? 'textarea' : 'input'); ta.className = 'inp'; ta.dir = 'auto'; ta.value = v; ta.dataset.mgf = fd.k; if (fd.ml) ta.rows = 3;
        ta.oninput = () => on(ta.value); ta.onkeydown = e => e.stopPropagation(); f.append(Fm.frow(fd.n, ta));
      } else if (fd.t === 'color') f.append(Fm.frow(fd.n, Fm.colorIn(v, val => on(val))));
      else if (fd.t === 'num') { const lim = Math.abs(fd.max) > 1e6; if (lim) { const i = document.createElement('input'); i.type = 'number'; i.className = 'inp'; i.value = v; i.step = fd.step; i.dataset.mgf = fd.k; i.oninput = () => { const n = parseFloat(i.value); if (isFinite(n)) on(n); }; i.onkeydown = e => e.stopPropagation(); f.append(Fm.frow(fd.n, i)); } else f.append(Fm.frow(fd.n, Fm.rangeIn(v, fd.min, fd.max, fd.step, val => on(val)))); }
      else if (fd.t === 'sel') f.append(Fm.frow(fd.n, Fm.selectIn(fd.opts, v, val => on(val, true))));
      else if (fd.t === 'img' && MG.imgField) f.append(Fm.frow(fd.n, MG.imgField(fd, v, (val, fin) => on(val, fin)))); // collage_tpl.js
    }
    f.append(Fm.sec('التوقيت'));
    const dr = Fm.rangeIn(+c.dur.toFixed(2), .5, Math.max(30, Math.ceil(c.dur)), .1, val => { const d = MG.setDur(c, val); dr[1].textContent = +d.toFixed(2); redraw(); }); dr[0].dataset.mgf = 'dur';
    f.append(Fm.frow('المدة (ث)', dr));
    const bar = document.createElement('div'); bar.className = 'mg-actions';
    const rs = document.createElement('button'); rs.className = 'btn sm'; rs.textContent = 'استعادة القيم الافتراضية'; rs.onclick = () => { mg.f = MG.defaults(mg.id); MG.setField(c, Object.keys(mg.f)[0], mg.f[Object.keys(mg.f)[0]], true); GW.bus.emit('selection'); };
    const fx = document.createElement('button'); fx.className = 'btn sm'; fx.textContent = 'الحركة والشفافية'; fx.title = 'تحريك القالب بالمفاتيح في عناصر التحكم في التأثيرات'; fx.onclick = () => GW.showPanel && GW.showPanel('fxc');
    bar.append(rs, fx); f.append(bar);
    body.append(f);
  };
  // Graphics menu > motion graphics templates (added without touching app.js)
  GW.bus.on('ready', () => {
    const e = GW.MENUS && GW.MENUS.find(m => m[0] === 'رسومات'); if (!e || e._mg) return; const f = e[1]; e._mg = 1;
    e[1] = () => { const items = f(); const i = items.findIndex(x => x && x.label === 'قوالب العناوين'); const it = { label: 'قوالب الرسوم المتحركة', sub: [{ label: 'فتح مكتبة القوالب…', action: () => GW.UI.egTab && GW.UI.egTab('mg') }, '-', ...MG.list.map(T => ({ label: T.n, action: () => { MG.add(T.id); GW.UI.egEdit && GW.UI.egEdit(); } }))] }; items.splice(i >= 0 ? i + 1 : items.length, 0, it); return items; };
  });
  GW.bus.on('time', () => { if (MG._redraw && !(GW.pb && GW.pb.playing)) MG._redraw(); });
  const css = document.createElement('style'); css.textContent = `
.mg-sec{margin:12px 8px 0}
.mg-cats{display:flex;gap:4px;flex-wrap:wrap;padding:8px 8px 0;direction:rtl}
.mg-cats .chip{height:22px;padding:0 9px;border-radius:11px;border:1px solid var(--line3,#3a3a3a);background:var(--bg3,#252525);color:var(--text2,#bbb);cursor:pointer;font-size:11px}
.mg-cats .chip.on{background:var(--accentBg);border-color:var(--accentLine);color:#fff}
.mg-card{position:relative;transition:border-color .12s}
.mg-card:hover{border-color:var(--accent)}
.mg-card>div{display:flex;justify-content:space-between;gap:6px;align-items:center}
.mg-card>div small{color:var(--faint,#777);font-size:10px;direction:ltr;white-space:nowrap}
.mg-card>div span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-add{position:absolute;top:6px;inset-inline-start:6px;width:24px;height:24px;border-radius:12px;border:0;background:var(--accent);color:#fff;display:grid;place-items:center;opacity:0;cursor:pointer;transition:opacity .12s}
.mg-card:hover .mg-add{opacity:1}
.mg-head{display:flex;justify-content:center;margin-bottom:6px}
.mg-head canvas{max-width:100%;border-radius:4px;border:1px solid var(--line,#333);background:#0b0b0b}
.mg-form .inp{width:100%}
.mg-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}`;
  document.head.append(css);
})();
