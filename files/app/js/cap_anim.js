'use strict';
/* Animated captions engine (GW.CapAnim) — used by GW.TextR.draw for text clips that carry x.ca (caption animation).
   Everything is laid out and drawn by WORD CELLS: each word is one fillText call, so Arabic letters keep their joined
   forms (never split); typewriter / wipe reveal a word by clipping its cell in reading direction. The same function draws
   preview, preset cards and export frames (export == preview).
   x.ca = { in, out, inDur, outDur, ease, unit:'block'|'word', stagger, emMotion:'scale'|'bounce'|'shake'|'none', box:'block'|'line'|'word',
            kw:1, kwColor }  ·  emphasis mode = x.kara (color|fill|reveal|box|underline|glow|none), hiColor / hiScale / hiBg / hiText.
   Word timings: x.words [{w, s, e, k?}] clip-local seconds (k = keyword). */
(function () {
  const C = GW.CapAnim = {};
  C.IN = [['none', 'بدون'], ['fade', 'تلاشي'], ['pop', 'ظهور مرن'], ['bounce', 'قفزة (تكبير مرتد)'], ['slideUp', 'انزلاق للأعلى'], ['slideDown', 'انزلاق للأسفل'], ['slideSide', 'انزلاق جانبي'], ['fadeBlur', 'تلاشي مع ضبابية'], ['typewriter', 'آلة كاتبة'], ['words', 'كلمة بكلمة (مع الكلام)'], ['wipe', 'مسح'], ['drop', 'سقوط'], ['elastic', 'مطاطي'], ['glitch', 'جلتش']];
  C.OUT = [['none', 'بدون'], ['fade', 'تلاشي'], ['pop', 'تصغير'], ['slideUp', 'انزلاق للأعلى'], ['slideDown', 'انزلاق للأسفل'], ['fadeBlur', 'تلاشي مع ضبابية'], ['wipe', 'مسح'], ['glitch', 'جلتش']];
  C.EMPH = [['none', 'بدون'], ['color', 'تلوين الكلمة'], ['fill', 'تعبئة تدريجية'], ['box', 'صندوق ملوّن'], ['underline', 'خط تحت الكلمة'], ['glow', 'توهج'], ['reveal', 'إظهار مع الكلام']];
  C.MOTION = [['none', 'بدون'], ['scale', 'تكبير'], ['bounce', 'قفزة'], ['shake', 'اهتزاز']];
  C.EASE = [['out', 'انسيابي'], ['back', 'مرتد'], ['elastic', 'مطاطي'], ['inout', 'دخول وخروج ناعم'], ['linear', 'خطي']];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const E = {
    linear: t => t, out: t => 1 - Math.pow(1 - t, 3), inout: GW.ease.inout, back: GW.ease.back,
    elastic: t => t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI / 3)) + 1,
    bounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; }
  };
  C.E = E;
  const hash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  const q = (v, n = 50) => Math.round(v * n) / n;
  const fontStr = (x, k, scale = 1) => `${x.italic ? 'italic ' : ''}${x.weight || 700} ${x.size * k * scale}px "${x.font}", "Cairo", "Segoe UI", sans-serif`;
  const words = (x) => String(x.caps ? x.str.toUpperCase() : x.str).split('\n').map(l => l.split(/\s+/).filter(Boolean));
  C.hasArabic = (s) => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(s);

  /* ---- 1. state for time lt: per-word transforms + a signature (cache key) ---- */
  function state(x, lt, dur) {
    const ca = x.ca || {}; const L = words(x); const flat = L.flat(); const n = flat.length;
    const tm = GW.TextR.wordTimes(x, dur); const ez = E[ca.ease] || E.out;
    const inA = ca.in || 'none', outA = ca.out || 'none'; const inD = Math.max(.04, +ca.inDur || .25), outD = Math.max(.04, +ca.outDur || .18);
    const perWord = ca.unit === 'word' || inA === 'words' || inA === 'typewriter'; const stag = ca.stagger != null ? +ca.stagger : .06;
    const mode = x.kara || 'none'; let ai = -1; for (let i = 0; i < n; i++) if (tm[i] && tm[i][0] <= lt + 1e-4) ai = i;
    const emD = .14; const eph = ai >= 0 ? clamp((lt - tm[ai][0]) / emD, 0, 1) : 1;
    const motion = ca.emMotion || ((x.hiScale || 1) > 1 ? 'scale' : 'none'); const hs = x.hiScale || 1.12;
    const pout = outA !== 'none' ? clamp((dur - lt) / outD, 0, 1) : 1;
    const fr = Math.floor(lt * 30); let anim = false; const W = [];
    // block-level entrance/exit (scale about the block centre, one wipe across the whole caption)
    let bsc = 1, brev = 1; const BLK = { pop: 1, bounce: 1, elastic: 1, wipe: 1 };
    if (!perWord && BLK[inA]) { const p = clamp(lt / inD, 0, 1); if (p < 1) anim = true; if (inA === 'pop') bsc = Math.max(0, E.back(p)); else if (inA === 'bounce') bsc = p <= 0 ? 0 : .3 + .7 * E.bounce(p); else if (inA === 'elastic') bsc = p <= 0 ? 0 : Math.max(0, E.elastic(p)); else brev = ez(p); }
    if (pout < 1 && outA === 'pop') bsc *= E.out(pout); if (pout < 1 && outA === 'wipe') brev = Math.min(brev, E.out(pout));
    for (let i = 0; i < n; i++) {
      const s = { a: 1, dx: 0, dy: 0, sc: 1, blur: 0, rev: 1, gl: 0, hide: false };
      // entrance
      if (inA !== 'none' && !(BLK[inA] && !perWord)) {
        const t0 = inA === 'words' || inA === 'typewriter' ? (tm[i] ? tm[i][0] : 0) : perWord ? i * stag : 0;
        const dd = inA === 'typewriter' ? clamp(tm[i] ? (tm[i][1] - tm[i][0]) * .8 : inD, .06, .45) : inD;
        const p = clamp((lt - t0) / dd, 0, 1); if (p < 1) anim = true; const e = ez(p);
        switch (inA) {
          case 'fade': s.a *= e; break;
          case 'pop': s.sc *= Math.max(0, E.back(p)); s.a *= Math.min(1, p * 3); break;
          case 'bounce': s.sc *= p <= 0 ? 0 : .3 + .7 * E.bounce(p); s.a *= Math.min(1, p * 4); break;
          case 'slideUp': s.dy += (1 - e) * .55; s.a *= Math.min(1, p * 2); break;
          case 'slideDown': s.dy -= (1 - e) * .55; s.a *= Math.min(1, p * 2); break;
          case 'slideSide': s.dx += (1 - e) * 1.2; s.a *= Math.min(1, p * 2); break;
          case 'fadeBlur': s.blur = Math.max(s.blur, (1 - e) * .35); s.a *= e; s.sc *= 1 + (1 - e) * .06; break;
          case 'typewriter': s.rev = p; break;
          case 'words': s.sc *= p <= 0 ? 0 : Math.max(0, E.back(p)); s.a *= p > 0 ? 1 : 0; break;
          case 'wipe': s.rev = Math.min(s.rev, e); break;
          case 'drop': s.dy -= (1 - E.bounce(p)) * 1.1; s.a *= Math.min(1, p * 3); break;
          case 'elastic': s.sc *= p <= 0 ? 0 : Math.max(0, E.elastic(p)); s.a *= Math.min(1, p * 4); break;
          case 'glitch': if (p < 1) { s.gl = (1 - p); s.dx += (hash(i, fr) - .5) * .5 * (1 - p); s.a *= (fr % 3 === 0 && p < .7) ? .25 : Math.min(1, p * 2 + .3); } break;
        }
        if (p <= 0 && inA !== 'glitch') s.hide = true;
      }
      // exit (whole block)
      if (pout < 1) {
        anim = true; const e = E.out(pout);
        switch (outA) {
          case 'fade': s.a *= e; break;
          case 'pop': s.a *= e; break;
          case 'slideUp': s.dy -= (1 - e) * .5; s.a *= e; break;
          case 'slideDown': s.dy += (1 - e) * .5; s.a *= e; break;
          case 'fadeBlur': s.blur = Math.max(s.blur, (1 - e) * .35); s.a *= e; break;
          case 'glitch': s.gl = Math.max(s.gl, 1 - pout); s.dx += (hash(i + 7, fr) - .5) * .4 * (1 - pout); s.a *= fr % 2 ? .4 : e; break;
        }
      }
      // emphasis
      const said = i <= ai, act = i === ai;
      if (mode === 'reveal' && !said) s.hide = true;
      s.act = act && mode !== 'none'; s.said = said; s.kw = !!(ca.kw && x.words && x.words[i] && x.words[i].k);
      if (act && mode !== 'none') {
        if (eph < 1) anim = true;
        if (motion === 'scale') s.sc *= 1 + (hs - 1) * (eph < 1 ? Math.max(0, E.back(eph)) : 1);
        else if (motion === 'bounce') { s.sc *= 1 + (hs - 1) * (eph < 1 ? Math.max(0, E.back(eph)) : 1); s.dy -= Math.sin(Math.PI * eph) * .12; }
        else if (motion === 'shake') { anim = true; s.dx += (hash(i, fr) - .5) * .06; s.dy += (hash(i + 3, fr) - .5) * .06; s.rot = (hash(i + 5, fr) - .5) * .08; }
      }
      s.eph = act ? eph : 1;
      W.push(s);
    }
    if (!perWord && BLK[inA] && inA !== 'wipe') { const p = clamp(lt / inD, 0, 1); for (const s of W) s.a *= Math.min(1, p * 3); }
    const sig = W.map(s => s.hide ? 'h' : [q(s.a), q(s.dx, 100), q(s.dy, 100), q(s.sc, 100), q(s.blur, 100), q(s.rev, 60), q(s.gl, 20), s.act ? 1 : 0, s.said ? 1 : 0, q(s.eph, 20), s.rot ? q(s.rot, 200) : 0].join(',')).join(';');
    return { L, W, ai, mode, sig: q(bsc, 200) + '/' + q(brev, 100) + '|' + sig, anim, tm, bsc, brev };
  }
  C.state = state;

  /* ---- 2. drawing ---- */
  C.draw = (clip, lt, w, h, k, cache) => {
    const x = clip.text; const st = state(x, lt, clip.dur);
    const key = 'ca|' + JSON.stringify(x) + '|' + w + 'x' + h + '|' + k + '|' + st.sig + (st.W.some(s => s.gl > 0) ? '|' + Math.floor(lt * 30) : '');
    let e = cache.get(clip.id); if (e && e.key === key) return e;
    if (!e) { e = { canvas: document.createElement('canvas') }; cache.set(clip.id, e); }
    const cv = e.canvas; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); if (g.reset) g.reset(); else { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none'; } g.clearRect(0, 0, w, h);
    try { paint(g, x, st, w, h, k); } catch (er) { console.error('caption draw', er); }
    e.key = key; e.ver = key; return e;
  };
  C.layout = (g, x, L, k) => { // word cells: [{w, line, cx, y, ww}] around (0,0); RTL lines run right → left
    g.font = fontStr(x, k); const ar = C.hasArabic(L.flat().join(' '));
    const sp = Math.max(g.measureText(' ').width, x.size * k * (x.kara === 'box' ? .42 : (x.hiScale || 1) > 1 ? .32 : .26));
    const lh = x.size * k * (x.leading || 1.15); const blockH = lh * L.length; const cells = []; const lines = [];
    const lineW = L.map(ws => ws.reduce((a, w2) => a + g.measureText(w2).width, 0) + sp * Math.max(0, ws.length - 1)); const bw = x.boxW ? x.boxW * k : Math.max(1, ...lineW);
    L.forEach((ws, li) => {
      const y = -blockH / 2 + lh * (li + .5); const wd = ws.map(w2 => g.measureText(w2).width); const lw = lineW[li];
      const left = x.align === 'left' ? -bw / 2 : x.align === 'right' ? bw / 2 - lw : -lw / 2; let cur = ar ? left + lw : left;
      ws.forEach((w2, j) => { const cx = ar ? cur - wd[j] / 2 : cur + wd[j] / 2; cur += ar ? -(wd[j] + sp) : wd[j] + sp; cells.push({ w: w2, line: li, cx, y, ww: wd[j] }); });
      lines.push({ y, left, lw });
    });
    return { cells, lines, lh, blockH, bw, ar, sp };
  };
  function paint(g, x, st, w, h, k) {
    const ca = x.ca || {}; const { W, mode } = st; const size = x.size * k;
    const Lo = C.layout(g, x, st.L, k); const { cells, lines, lh, blockH, bw, ar } = Lo;
    g.translate(w / 2, h / 2); if (st.bsc <= .002 || st.brev <= .002) return; if (st.bsc !== 1) g.scale(st.bsc, st.bsc);
    if (st.brev < 1) { const pad = x.bg ? (x.bgPad || 0) * k + 4 : size * .3; const ww = bw + pad * 2; g.beginPath(); g.rect(ar ? bw / 2 + pad - ww * st.brev : -bw / 2 - pad, -blockH - pad, ww * st.brev, blockH * 2 + pad * 2); g.clip(); }
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.direction = ar ? 'rtl' : 'ltr'; if ('letterSpacing' in g) g.letterSpacing = ar ? '0px' : ((x.tracking || 0) * k) + 'px';
    const vis = cells.map((c, i) => Object.assign({}, c, W[i] || {})).filter(c => !c.hide && c.a > .002 && c.sc > .002);
    // a scaled (emphasised) word pushes its neighbours apart so it never overlaps them
    const cx0 = vis.map(c => c.cx);
    vis.forEach((c, i) => { if (c.sc > 1.001) { const ex = (c.sc - 1) * c.ww / 2; vis.forEach((d, j) => { if (j !== i && d.line === c.line) d.cx += Math.sign(cx0[j] - cx0[i]) * ex; }); } });
    const blockA = vis.length ? Math.max(...vis.map(c => c.a)) : 0;
    // background boxes
    if (x.bg && vis.length) {
      const pad = (x.bgPad || 0) * k; const rad = (x.bgRad || 0) * k; const col = GW.rgba(x.bgColor || '#000000', (x.bgOp != null ? x.bgOp : 70) / 100);
      const rr = (bx, by, bwd, bh, a, rev, rtl) => { g.save(); g.globalAlpha = a; g.fillStyle = col; if (rev < 1) { g.beginPath(); g.rect(rtl ? bx + bwd * (1 - rev) : bx, by - 2, bwd * rev, bh + 4); g.clip(); } g.beginPath(); if (g.roundRect) g.roundRect(bx, by, bwd, bh, Math.min(rad, bh / 2)); else g.rect(bx, by, bwd, bh); g.fill(); g.restore(); };
      const mode2 = ca.box || 'block';
      if (mode2 === 'block') rr(-bw / 2 - pad, -blockH / 2 - pad * .6, bw + pad * 2, blockH + pad * 1.2, blockA, 1, ar);
      else if (mode2 === 'line') lines.forEach((ln, li) => { const cs = vis.filter(c => c.line === li); if (!cs.length) return; const a = Math.max(...cs.map(c => c.a)); rr(ln.left - pad, ln.y - lh / 2 - pad * .3, ln.lw + pad * 2, lh + pad * .6, a, 1, ar); });
      else for (const c of vis) rr(c.cx - c.ww / 2 - pad * .5 + c.dx * size, c.y - size * .62 + c.dy * size, c.ww + pad, size * 1.24, c.a, c.rev, ar);
    }
    const at = (c, f) => { g.save(); g.globalAlpha = c.a; g.translate(c.cx + c.dx * size, c.y + c.dy * size); if (c.rot) g.rotate(c.rot); if (c.sc !== 1) g.scale(c.sc, c.sc); if (c.blur > 0) g.filter = `blur(${c.blur * size * .3}px)`;
      if (c.rev < 1) { g.beginPath(); const ww = c.ww + size * .2; const rtl = C.hasArabic(c.w); g.rect(rtl ? ww / 2 - ww * c.rev : -ww / 2, -size, ww * c.rev, size * 2); g.clip(); } f(); g.restore(); };
    const hiC = x.hiColor || '#ffd400'; const colorOf = (c) => {
      if (mode === 'box' && c.act) return x.hiText || '#ffffff';
      if ((mode === 'color' || mode === 'glow') && c.act) return hiC;
      if (mode === 'fill' && c.said) return hiC;
      if (c.kw) return ca.kwColor || '#4cc2ff';
      return x.color;
    };
    // emphasis backgrounds (box, underline)
    for (const c of vis) {
      if (!c.act) continue;
      if (mode === 'box') at(c, () => { const ph = size * .2, bh = size * 1.18; const gr = .7 + .3 * E.back(c.eph); g.fillStyle = GW.rgba(x.hiBg || '#7c3aed', (x.hiBgOp != null ? x.hiBgOp : 100) / 100); g.beginPath(); const bw2 = (c.ww + ph * 2) * gr; if (g.roundRect) g.roundRect(-bw2 / 2, -bh / 2, bw2, bh, size * .2); else g.rect(-bw2 / 2, -bh / 2, bw2, bh); g.fill(); });
      if (mode === 'underline') at(c, () => { const uw = c.ww * E.out(c.eph); g.fillStyle = hiC; g.beginPath(); const y0 = size * .5, th = Math.max(2, size * .09); if (g.roundRect) g.roundRect(ar ? c.ww / 2 - uw : -c.ww / 2, y0, uw, th, th / 2); else g.rect(-c.ww / 2, y0, uw, th); g.fill(); });
    }
    g.font = fontStr(x, k);
    const shadowOn = () => { if (!x.shadow) return; const a = (x.shadowAng || 90) * Math.PI / 180; g.shadowColor = GW.rgba(x.shadowColor || '#000000', (x.shadowOp != null ? x.shadowOp : 60) / 100); g.shadowBlur = (x.shadowBlur || 0) * k; g.shadowOffsetX = Math.cos(a) * (x.shadowDist || 0) * k; g.shadowOffsetY = Math.sin(a) * (x.shadowDist || 0) * k; };
    // glitch ghosts
    for (const c of vis) if (c.gl > 0) at(c, () => { g.globalAlpha *= .6 * c.gl; g.fillStyle = '#00e5ff'; g.fillText(c.w, -size * .06 * c.gl, 0); g.fillStyle = '#ff2d55'; g.fillText(c.w, size * .06 * c.gl, 0); });
    if (x.stroke > 0) for (const c of vis) at(c, () => { shadowOn(); g.lineJoin = 'round'; g.lineWidth = x.stroke * 2 * k; g.strokeStyle = x.strokeColor || '#000000'; g.strokeText(c.w, 0, 0); });
    for (const c of vis) at(c, () => {
      if (!(x.stroke > 0)) shadowOn(); else g.shadowColor = 'transparent';
      if (mode === 'glow' && c.act) { g.shadowColor = hiC; g.shadowBlur = size * .45 * (.6 + .4 * c.eph); g.shadowOffsetX = 0; g.shadowOffsetY = 0; }
      g.fillStyle = colorOf(c); g.fillText(c.w, 0, 0);
    });
  }

  /* ---- 3. keywords (emphasis automation): numbers, names, long content words; stoplist-based heuristic ---- */
  const STOP_AR = new Set('في من على إلى الى عن مع هذا هذه ذلك تلك هؤلاء التي الذي الذين اللذين اللتين هو هي هم هن نحن أنا انا أنت انت أنتم كان كانت كانوا يكون تكون لكن لكنه ثم أو او و ف لا لم لن ما ماذا لماذا كيف متى أين اين قد كل بعض بين عند حتى إذا اذا إن ان أن لقد هناك هنا أيضا ايضا أيضًا جدا جدًا فقط بعد قبل حيث لأن لان الآن الان يعني يعنى ليس ليست غير مثل كما وقد وكان وهو وهي فقد لذلك ذلك عندما بينما خلال حول ضد نحو منذ لدى عليه عليها إليه اليه منه منها فيه فيها به بها لها له هل بل كلا سوف سيتم تم يتم والتي والذي'.split(/\s+/));
  const STOP_EN = new Set('the a an and or but if then of to in on at by for with from as is are was were be been being it its this that these those he she they we you i his her their our your not no so do does did have has had will would can could should may might just very also than into over about after before when while which who whom what where why how there here up out more most such'.split(/\s+/));
  const TITLES = /^(?:[وف]?(?:ال)?(?:رئيس|ملك|قائد|جنرال|سلطان|امير|أمير|خليفة|إمبراطور|امبراطور|زعيم|وزير|مارشال|شيخ))$/;
  const norm = (w) => String(w).replace(/[ً-ْـ]/g, '').replace(/[.,!?؟،؛:;"'«»()\[\]…\-]/g, '');
  C.keywords = (ws, o = {}) => { // ws: array of word strings → Set of indices
    const out = new Set(); let best = -1, bestScore = 0;
    ws.forEach((raw, i) => {
      const w = norm(raw); if (!w) return;
      if (/[0-9٠-٩۰-۹]/.test(w) || /^%|%$/.test(raw)) { out.add(i); return; }
      if (i > 0 && TITLES.test(norm(ws[i - 1]))) { out.add(i); return; }
      if (/^[A-Z][a-z]{2,}/.test(w) && i > 0 && !/[.!?]$/.test(ws[i - 1] || '')) { out.add(i); return; }
      if (/^[A-Z]{2,}$/.test(w)) { out.add(i); return; }
      const lw = w.toLowerCase(); if (STOP_AR.has(w) || STOP_EN.has(lw)) return;
      const stem = w.replace(/^(?:و|ف|ب|ل|ك)?(?:ال)?/, ''); const len = (C.hasArabic(w) ? stem : lw).length;
      if (len >= (o.minLen || 5) && len > bestScore) { bestScore = len; best = i; }
    });
    if (best >= 0 && (out.size === 0 || ws.length >= 5)) out.add(best);
    return out;
  };
  const EMOJI = [[/حرب|معرك|قتال|war|battle/i, '⚔️'], [/نار|حريق|انفجار|fire|explo/i, '🔥'], [/مال|دولار|اقتصاد|money|dollar/i, '💰'], [/خريطة|حدود|map|border/i, '🗺️'], [/موت|قتل|قتلى|death|dead/i, '💀'], [/سؤال|لماذا|كيف|why|how/i, '❓'], [/مفاجأة|صدمة|shock|wow/i, '😱'], [/فوز|نصر|انتصار|win|victory/i, '🏆']];
  C.emojiFor = (txt) => { for (const [re, e] of EMOJI) if (re.test(txt)) return e; return null; };
})();
