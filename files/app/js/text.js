'use strict';
/* Text / title rasterizer (canvas 2D) with entrance & exit animations */
(function () {
  const T = GW.TextR = {};
  const cache = new Map();
  GW.TEXT_ANIMS = [['none', 'بدون'], ['fade', 'تلاشي'], ['up', 'انزلاق للأعلى'], ['down', 'انزلاق للأسفل'], ['left', 'انزلاق من اليمين'], ['right', 'انزلاق من اليسار'], ['pop', 'ظهور مرن'], ['zoom', 'تكبير'], ['blur', 'ضبابية'], ['wipe', 'مسح'], ['type', 'آلة كاتبة'], ['words', 'كلمة بكلمة']];
  GW.FONTS = ['Cairo', 'Tajawal', 'IBM Plex Sans Arabic', 'Changa', 'Lalezar', 'Amiri', 'Reem Kufi', 'Bebas Neue', 'Barlow Condensed', 'Barlow', 'Oswald', 'Montserrat', 'JetBrains Mono'];
  const easeO = t => 1 - Math.pow(1 - t, 3), back = GW.ease.back;

  function fontStr(x, size, k) { return `${x.italic ? 'italic ' : ''}${x.weight || 700} ${size * k}px "${x.font}", "Cairo", "Segoe UI", sans-serif`; }
  T.measure = (x, k) => {
    const c = T._m || (T._m = document.createElement('canvas').getContext('2d'));
    c.font = fontStr(x, x.size, k);
    const ar = GW.isAr(x.str); if ('letterSpacing' in c) c.letterSpacing = ar ? '0px' : (x.tracking * k) + 'px';
    const lines = String(x.caps ? x.str.toUpperCase() : x.str).split('\n');
    const widths = lines.map(l => c.measureText(l).width);
    return { lines, widths, w: Math.max(1, ...widths), lh: x.size * k * x.leading, ar };
  };
  // returns {canvas, ver} sized w×h, drawn as if the frame were seqW×seqH scaled by k
  T.draw = (clip, lt, w, h, k) => {
    const x = clip.text; const dur = clip.dur; const ad = Math.max(.05, x.animDur || .5);
    if (x.mg && GW.MG && GW.MG.get(x.mg.id)) { // motion graphics template (js/mg.js) draws the whole layer
      const key = 'mg|' + JSON.stringify(x.mg) + '|' + w + 'x' + h + '|' + k + '|' + GW.MG.tkey(x.mg, lt, dur);
      let e = cache.get(clip.id); if (e && e.key === key) return e;
      if (!e) { e = { canvas: document.createElement('canvas') }; cache.set(clip.id, e); }
      const cv = e.canvas; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const g = cv.getContext('2d'); if (g.reset) g.reset(); else { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none'; } g.clearRect(0, 0, w, h);
      g.save(); try { GW.MG.draw(g, x.mg, lt, dur, w / k, h / k, k); } catch (er) { console.error('mg draw', er); } g.restore();
      e.key = key; e.ver = key; return e;
    }
    let pin = x.animIn && x.animIn !== 'none' ? GW.clamp(lt / ad, 0, 1) : 1;
    let pout = x.animOut && x.animOut !== 'none' ? GW.clamp((dur - lt) / ad, 0, 1) : 1;
    const kst = x.kara && x.kara !== 'none' && T.karaState ? T.karaState(x, lt, dur) : null; // word-timed captions (karaoke)
    const key = JSON.stringify(x) + '|' + w + 'x' + h + '|' + k + '|' + pin.toFixed(3) + '|' + pout.toFixed(3) + (kst ? '|' + kst.key : '');
    let e = cache.get(clip.id);
    if (e && e.key === key) return e;
    if (!e) { e = { canvas: document.createElement('canvas') }; cache.set(clip.id, e); }
    const cv = e.canvas; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); if (g.reset) g.reset(); else { g.restore(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none'; } g.clearRect(0, 0, w, h); g.save();
    const m = T.measure(x, k); const blockH = m.lh * m.lines.length; const cx = w / 2, cy = h / 2;
    let alpha = 1, dx = 0, dy = 0, sc = 1, blur = 0, wipe = 1, chars = Infinity, words = Infinity;
    const apply = (type, p, isIn) => {
      const e2 = easeO(p);
      switch (type) {
        case 'fade': alpha *= p; break;
        case 'up': dy += (1 - e2) * 60 * k * (isIn ? 1 : -1); alpha *= p; break;
        case 'down': dy -= (1 - e2) * 60 * k * (isIn ? 1 : -1); alpha *= p; break;
        case 'left': dx += (1 - e2) * 120 * k; alpha *= p; break;
        case 'right': dx -= (1 - e2) * 120 * k; alpha *= p; break;
        case 'pop': sc *= isIn ? Math.max(0, back(p)) : e2; alpha *= Math.min(1, p * 3); break;
        case 'zoom': sc *= 1 + (1 - e2) * (isIn ? -.5 : .5); alpha *= p; break;
        case 'blur': blur = Math.max(blur, (1 - p) * 30 * k); alpha *= Math.min(1, p * 1.5); break;
        case 'wipe': wipe = Math.min(wipe, e2); break;
        case 'type': chars = Math.min(chars, p); break;
        case 'words': words = Math.min(words, p); break;
      }
    };
    if (pin < 1) apply(x.animIn, pin, true);
    if (pout < 1) apply(x.animOut, pout, false);
    if (alpha <= 0.001 || sc <= 0.001) { g.restore(); e.key = key; e.ver = key; return e; }
    g.globalAlpha = alpha; g.translate(cx + dx, cy + dy); g.scale(sc, sc);
    if (blur > 0) g.filter = `blur(${blur}px)`;
    const bw = (x.boxW ? x.boxW * k : m.w);
    if (x.bg) {
      const pad = x.bgPad * k; g.save(); g.fillStyle = GW.rgba(x.bgColor, x.bgOp / 100);
      const bx = -bw / 2 - pad, by = -blockH / 2 - pad * .6, bwid = bw + pad * 2, bh = blockH + pad * 1.2;
      g.beginPath(); if (g.roundRect) g.roundRect(bx, by, bwid * (x.animIn === 'wipe' ? wipe : 1), bh, x.bgRad * k); else g.rect(bx, by, bwid, bh); g.fill(); g.restore();
    }
    if (wipe < 1) { g.beginPath(); g.rect(-bw / 2 - 40 * k, -h, (bw + 80 * k) * wipe, h * 2); g.clip(); }
    g.font = fontStr(x, x.size, k); g.textBaseline = 'middle'; g.direction = m.ar ? 'rtl' : 'ltr';
    if ('letterSpacing' in g) g.letterSpacing = m.ar ? '0px' : (x.tracking * k) + 'px';
    const totalChars = m.lines.join('').length; let shown = chars < Infinity ? Math.floor(totalChars * chars) : Infinity;
    const allWords = m.lines.join(' ').split(/\s+/).length; let shownW = words < Infinity ? Math.ceil(allWords * words) : Infinity;
    if (kst) { T.drawKara(g, x, m, k, kst, bw, blockH); g.restore(); e.key = key; e.ver = key; return e; }
    m.lines.forEach((line, i) => {
      let s = line;
      if (shown !== Infinity) { const take = Math.max(0, Math.min(s.length, shown)); s = s.slice(0, take); shown -= line.length; }
      if (shownW !== Infinity) { const ws = s.split(/\s+/); s = ws.slice(0, Math.max(0, shownW)).join(' '); shownW -= ws.length; }
      if (!s) return;
      const y = -blockH / 2 + m.lh * (i + .5);
      const lw = g.measureText(s).width; const full = m.widths[i];
      let xx; if (x.align === 'left') xx = -bw / 2; else if (x.align === 'right') xx = bw / 2 - full; else xx = -full / 2;
      if (m.ar && (chars < Infinity || words < Infinity)) { if (x.align !== 'left') xx = xx + full - lw; } // RTL partial lines grow from the right
      g.textAlign = 'left'; const drawX = m.ar ? xx + lw : xx;
      g.textAlign = m.ar ? 'right' : 'left';
      if (x.shadow) { g.shadowColor = GW.rgba(x.shadowColor, x.shadowOp / 100); g.shadowBlur = x.shadowBlur * k; const a = x.shadowAng * Math.PI / 180; g.shadowOffsetX = Math.cos(a) * x.shadowDist * k; g.shadowOffsetY = Math.sin(a) * x.shadowDist * k; }
      if (x.stroke > 0) { g.lineJoin = 'round'; g.lineWidth = x.stroke * 2 * k; g.strokeStyle = x.strokeColor; g.strokeText(s, drawX, y); g.shadowColor = 'transparent'; }
      g.fillStyle = x.color; g.fillText(s, drawX, y);
      g.shadowColor = 'transparent';
    });
    g.restore();
    e.key = key; e.ver = key;
    return e;
  };
  T.drop = id => cache.delete(id);

  /* ---- word-timed captions: x.words = [{w, s, e}] (clip-local seconds), x.kara = color|box|fill|reveal ---- */
  const capWords = (x) => String(x.caps ? x.str.toUpperCase() : x.str).split('\n').map(l => l.split(/\s+/).filter(Boolean));
  T.wordTimes = (x, dur) => { // timings aligned to the words currently in x.str (falls back to an even spread after edits)
    const n = capWords(x).reduce((a, l) => a + l.length, 0); const ws = x.words || [];
    if (ws.length === n) return ws.map(o => [o.s, o.e]);
    const a = ws.length ? ws[0].s : 0, b = ws.length ? ws[ws.length - 1].e : dur; const d = Math.max(.01, b - a) / Math.max(1, n);
    return Array.from({ length: n }, (_, i) => [a + i * d, a + (i + 1) * d]);
  };
  T.karaState = (x, lt, dur) => {
    const tm = T.wordTimes(x, dur); let ai = -1; for (let i = 0; i < tm.length; i++) if (tm[i][0] <= lt + 1e-4) ai = i;
    const popT = .14; const ph = ai >= 0 ? GW.clamp((lt - tm[ai][0]) / popT, 0, 1) : 1;
    const q = Math.round(ph * 10) / 10; return { tm, ai, ph: q, key: ai + ':' + q };
  };
  T.drawKara = (g, x, m, k, st, bw, blockH) => {
    const lines = capWords(x); const sp = Math.max(g.measureText(' ').width, x.size * k * (x.kara === 'box' ? .42 : (x.hiScale || 1) > 1 ? .32 : .26)); const hiC = x.hiColor || '#ffd400'; const mode = x.kara;
    const hs = x.hiScale || 1; const popS = 1 + (hs - 1) * (st.ph < 1 ? Math.max(0, GW.ease.back(st.ph)) : 1);
    const items = []; let wi = 0;
    lines.forEach((ws, li) => {
      const y = -blockH / 2 + m.lh * (li + .5); const wd = ws.map(w => g.measureText(w).width);
      const lw = wd.reduce((a, b) => a + b, 0) + sp * Math.max(0, ws.length - 1);
      let left = x.align === 'left' ? -bw / 2 : x.align === 'right' ? bw / 2 - lw : -lw / 2; let cur = m.ar ? left + lw : left;
      ws.forEach((w, j) => {
        const cx = m.ar ? cur - wd[j] / 2 : cur + wd[j] / 2; cur += m.ar ? -(wd[j] + sp) : wd[j] + sp;
        const i = wi++; const said = i <= st.ai, act = i === st.ai;
        if (mode === 'reveal' && !said) return;
        const col = (mode === 'fill' ? said : act) ? hiC : x.color;
        items.push({ w, cx, y, ww: wd[j], col, act, sc: act ? (mode === 'reveal' ? Math.min(popS, 1 + (hs - 1)) * (st.ph < 1 ? .7 + .3 * st.ph : 1) : popS) : 1 });
      });
    });
    const at = (it, f) => { g.save(); g.translate(it.cx, it.y); if (it.sc !== 1) g.scale(it.sc, it.sc); f(); g.restore(); };
    g.textAlign = 'center';
    if (mode === 'box') for (const it of items) if (it.act) at(it, () => { const ph = x.size * k * .2, bh = x.size * k * 1.18; g.fillStyle = GW.rgba(x.hiBg || '#7c3aed', (x.hiBgOp != null ? x.hiBgOp : 100) / 100); g.beginPath(); if (g.roundRect) g.roundRect(-it.ww / 2 - ph, -bh / 2, it.ww + ph * 2, bh, x.size * k * .2); else g.rect(-it.ww / 2 - ph, -bh / 2, it.ww + ph * 2, bh); g.fill(); });
    const shadowOn = () => { const a = x.shadowAng * Math.PI / 180; g.shadowColor = GW.rgba(x.shadowColor, x.shadowOp / 100); g.shadowBlur = x.shadowBlur * k; g.shadowOffsetX = Math.cos(a) * x.shadowDist * k; g.shadowOffsetY = Math.sin(a) * x.shadowDist * k; };
    if (x.stroke > 0) for (const it of items) at(it, () => { if (x.shadow) shadowOn(); g.lineJoin = 'round'; g.lineWidth = x.stroke * 2 * k; g.strokeStyle = x.strokeColor; g.strokeText(it.w, 0, 0); });
    for (const it of items) at(it, () => { if (x.shadow && !(x.stroke > 0)) shadowOn(); g.fillStyle = (mode === 'box' && it.act) ? (x.hiText || '#ffffff') : it.col; g.fillText(it.w, 0, 0); });
  };

  /* presets for the Essential Graphics panel */
  GW.TITLE_PRESETS = [
    { n: 'عنوان رئيسي', t: { str: 'عنوان رئيسي', font: 'Cairo', weight: 900, size: 120, color: '#ffffff', shadow: 1, animIn: 'pop', animOut: 'fade' } },
    { n: 'عاجل (شريط أحمر)', t: { str: 'عاجل | نص الخبر هنا', font: 'Cairo', weight: 800, size: 58, color: '#ffffff', bg: 1, bgColor: '#d6202f', bgOp: 100, bgPad: 22, bgRad: 2, shadow: 0, animIn: 'wipe', animOut: 'fade' }, pos: [0.5, 0.86] },
    { n: 'اسم وصفة (Lower third)', t: { str: 'الاسم الكامل\nالمسمى الوظيفي', font: 'Tajawal', weight: 800, size: 56, color: '#ffffff', bg: 1, bgColor: '#0b0f15', bgOp: 85, bgPad: 26, bgRad: 6, align: 'right', animIn: 'left', animOut: 'fade' }, pos: [0.78, 0.82] },
    { n: 'تاريخ ومكان', t: { str: '24 يونيو 1812 — نهر نيمن', font: 'IBM Plex Sans Arabic', weight: 600, size: 44, color: '#f2f2f2', shadow: 1, animIn: 'type', animOut: 'fade' }, pos: [0.5, 0.12] },
    { n: 'عنوان سينمائي', t: { str: 'THE CAMPAIGN', font: 'Bebas Neue', weight: 400, size: 160, tracking: 24, color: '#ffffff', shadow: 1, shadowBlur: 30, animIn: 'blur', animOut: 'blur' } },
    { n: 'ترجمة (Subtitle)', t: { str: 'نص الترجمة يظهر هنا', font: 'Tajawal', weight: 700, size: 48, color: '#ffffff', stroke: 3, strokeColor: '#000000', shadow: 0, animIn: 'none', animOut: 'none' }, pos: [0.5, 0.9] },
    { n: 'رقم / إحصائية', t: { str: '600,000', font: 'Oswald', weight: 700, size: 180, color: '#ffcf4a', shadow: 1, animIn: 'zoom', animOut: 'fade' } },
    { n: 'اقتباس', t: { str: '«النص المقتبس هنا»', font: 'Amiri', weight: 700, size: 80, color: '#ffffff', shadow: 1, animIn: 'words', animOut: 'fade' } }
  ];
})();
