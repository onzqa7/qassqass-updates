'use strict';
/* After Effects-style text animators (محرّكات النص): per-character / per-word / per-line animation driven by a range selector.
   Data lives in clip.text.animators = [{ id, on, name, unit:'char'|'word'|'line', sel:{ start, end, offset (P, %), shape, ease },
   props:{ opacity, pos, scale, rot, tracking, blur (P), fillOn, fill (P colour) } }]. All P values are keyframable (clip-local seconds).
   Arabic shaping is never broken: the whole line is always drawn shaped and each unit is a clip cell measured from prefix
   widths (Intl.Segmenter graphemes), so joined letters keep their medial/final forms while they fade, move, scale or blur. */
(function () {
  const A = GW.TextAnim = {};
  const P = GW.P, clamp = GW.clamp;
  A.UNITS = [['char', 'الأحرف'], ['word', 'الكلمات'], ['line', 'الأسطر']];
  A.SHAPES = [['square', 'مربع'], ['rampUp', 'منحدر صاعد'], ['rampDown', 'منحدر هابط'], ['triangle', 'مثلث'], ['smooth', 'ناعم']];
  A.EASES = [['none', 'بدون'], ['out', 'تباطؤ'], ['back', 'ارتداد'], ['elastic', 'مطاطي']];
  A.PROPS = [['opacity', 'الشفافية', 0, 100, 1, '%'], ['scale', 'المقياس', -200, 500, 1, '%'], ['rot', 'الدوران', -720, 720, 1, '°'], ['tracking', 'تباعد الأحرف', -100, 300, 1, ''], ['blur', 'الضبابية', 0, 100, .5, '']];
  A.PRESETS = [
    ['typewriter', 'آلة كاتبة (حرف بحرف)'], ['fadeUpWord', 'ظهور متدرج بالكلمات'], ['blurIn', 'حروف من الضباب'], ['bounce', 'ارتداد بالكلمات'],
    ['slideSide', 'انزلاق من الجانب'], ['scaleIn', 'تكبير الحروف'], ['fadeOutWord', 'خروج متدرج بالكلمات'], ['custom', 'محرّك فارغ']
  ];
  const segmenter = (() => { try { return new Intl.Segmenter('ar', { granularity: 'grapheme' }); } catch (e) { return null; } })();
  A.graphemes = (s) => segmenter ? [...segmenter.segment(s)].map(x => x.segment) : Array.from(s);

  A.newAnimator = (preset, dur) => {
    const d = Math.max(.4, Math.min(2.2, (dur || 5) * .35));
    const an = { id: GW.uid(), on: 1, name: 'محرّك', unit: 'char', sel: { start: P(0), end: P(100), offset: P(0), shape: 'square', ease: 'none' }, props: { opacity: P(100), pos: P([0, 0]), scale: P(100), rot: P(0), tracking: P(0), blur: P(0), fillOn: 0, fill: P('#ffd400') } };
    const anim = (p, a, b, e) => { p.v = a; p.k = [{ t: 0, v: a, e: e || 'linear' }, { t: d, v: b, e: e || 'linear' }]; };
    const pn = A.PRESETS.find(p => p[0] === preset); an.name = pn ? pn[1] : 'محرّك';
    switch (preset) {
      case 'typewriter': an.unit = 'char'; an.props.opacity = P(0); anim(an.sel.start, 0, 100); break;
      case 'fadeUpWord': an.unit = 'word'; an.props.opacity = P(0); an.props.pos = P([0, 40]); an.sel.shape = 'rampUp'; anim(an.sel.start, -40, 100, 'ease'); break;
      case 'blurIn': an.unit = 'char'; an.props.opacity = P(0); an.props.blur = P(25); an.props.tracking = P(20); an.sel.shape = 'rampUp'; anim(an.sel.start, -50, 100, 'ease'); break;
      case 'bounce': an.unit = 'word'; an.props.opacity = P(0); an.props.pos = P([0, -140]); an.sel.shape = 'rampUp'; an.sel.ease = 'back'; anim(an.sel.start, -60, 100); break;
      case 'slideSide': an.unit = 'word'; an.props.opacity = P(0); an.props.pos = P([260, 0]); an.sel.shape = 'rampUp'; an.sel.ease = 'out'; anim(an.sel.start, -60, 100); break;
      case 'scaleIn': an.unit = 'char'; an.props.opacity = P(0); an.props.scale = P(0); an.sel.shape = 'rampUp'; an.sel.ease = 'back'; anim(an.sel.start, -40, 100); break;
      case 'fadeOutWord': { an.unit = 'word'; an.props.opacity = P(0); an.props.pos = P([0, -30]); an.sel.shape = 'rampDown'; const D = dur || 5; an.sel.end.v = 0; an.sel.end.k = [{ t: Math.max(0, D - d), v: 0, e: 'ease' }, { t: D, v: 140, e: 'ease' }]; break; }
    }
    return an;
  };
  A.key = (x, lt) => (x.animators || []).map(a => { if (!a.on) return '-'; const s = a.sel; return [GW.pv(s.start, lt), GW.pv(s.end, lt), GW.pv(s.offset, lt), ...['opacity', 'scale', 'rot', 'tracking', 'blur', 'fill'].map(k => GW.pv(a.props[k], lt)), GW.pv(a.props.pos, lt).join(',')].map(v => typeof v === 'number' ? v.toFixed(2) : v).join(','); }).join(';');

  // amount (0…1) of unit i of n for a selector at clip time lt
  function amount(an, i, n, lt) {
    const s = an.sel; const st = GW.pv(s.start, lt), en = GW.pv(s.end, lt), off = GW.pv(s.offset, lt) || 0;
    const a = Math.min(st, en) + off, b = Math.max(st, en) + off; if (b - a < 1e-6) return 0;
    const u = (i + .5) / n * 100; if (u < a || u > b) return 0;
    const f = (u - a) / (b - a); let v;
    switch (s.shape) { case 'rampUp': v = f; break; case 'rampDown': v = 1 - f; break; case 'triangle': v = 1 - Math.abs(f * 2 - 1); break; case 'smooth': { const q = 1 - Math.abs(f * 2 - 1); v = q * q * (3 - 2 * q); break; } default: v = 1; }
    const e = s.ease; if (e === 'out') v = GW.ease.out(v); else if (e === 'back') v = GW.ease.back(v); else if (e === 'elastic') v = GW.ease.elastic(v);
    return v;
  }
  // per-unit composite of all active animators → { alpha, dx, dy, sc, rot, tr, blur, fill }
  A.unitState = (x, unit, i, n, lt, k) => {
    const st = { alpha: 1, dx: 0, dy: 0, sc: 1, rot: 0, tr: 0, blur: 0, fill: null, any: false };
    for (const an of x.animators) {
      if (!an.on || an.unit !== unit) continue; const am = amount(an, i, n, lt); if (Math.abs(am) < 1e-4) continue; st.any = true; const p = an.props;
      const op = GW.pv(p.opacity, lt); if (op !== 100) st.alpha *= clamp(1 - (1 - op / 100) * am, 0, 1);
      const ps = GW.pv(p.pos, lt) || [0, 0]; st.dx += ps[0] * am * k; st.dy += ps[1] * am * k;
      const sc = GW.pv(p.scale, lt); if (sc !== 100) st.sc *= 1 + (sc / 100 - 1) * am;
      st.rot += (GW.pv(p.rot, lt) || 0) * am; st.tr += (GW.pv(p.tracking, lt) || 0) * am * k; st.blur += (GW.pv(p.blur, lt) || 0) * am * k;
      if (p.fillOn) { const fc = GW.pv(p.fill, lt); st.fill = st.fill ? GW.lerpColor(st.fill, fc, am) : GW.lerpColor(x.color, fc, am); }
    }
    return st;
  };
  GW.lerpColor = GW.lerpColor || ((a, b, t) => { const A2 = GW.hex2rgb(a), B = GW.hex2rgb(b); return GW.rgb2hex(...A2.map((v, i) => Math.round(GW.lerp(v, B[i], clamp(t, 0, 1))))); });
  const hasUnit = (x, u) => x.animators.some(a => a.on && a.unit === u);
  const combine = (a, b) => ({ alpha: a.alpha * b.alpha, dx: a.dx + b.dx, dy: a.dy + b.dy, sc: a.sc * b.sc, rot: a.rot + b.rot, tr: a.tr + b.tr, blur: a.blur + b.blur, fill: b.fill || a.fill, any: a.any || b.any });

  /* draw all lines of x with animators; g is already translated to the block centre with font/direction/letterSpacing set */
  A.drawLines = (g, x, m, k, lt, o) => {
    const { bw, blockH } = o; const lines = m.lines; const ar = m.ar; const sp = g.measureText(' ').width;
    const total = { char: 0, word: 0, line: lines.length };
    const L = lines.map(line => { const words = line.split(/(\s+)/); const gs = A.graphemes(line); const nChars = gs.filter(c => !/\s/.test(c)).length; const nWords = words.filter((w, i) => i % 2 === 0 && w).length; total.char += nChars; total.word += nWords; return { line, gs, words, nChars, nWords }; });
    let ci = 0, wi = 0; let shown = o.shown, shownW = o.shownW;
    const useChar = hasUnit(x, 'char'), useWord = hasUnit(x, 'word'), useLine = hasUnit(x, 'line');
    const drawText = (s, X, y, fill) => {
      if (x.shadow) { g.shadowColor = GW.rgba(x.shadowColor, x.shadowOp / 100); g.shadowBlur = x.shadowBlur * k; const a = x.shadowAng * Math.PI / 180; g.shadowOffsetX = Math.cos(a) * x.shadowDist * k; g.shadowOffsetY = Math.sin(a) * x.shadowDist * k; }
      if (x.stroke > 0) { g.lineJoin = 'round'; g.lineWidth = x.stroke * 2 * k; g.strokeStyle = x.strokeColor; g.strokeText(s, X, y); g.shadowColor = 'transparent'; }
      g.fillStyle = fill || x.color; g.fillText(s, X, y); g.shadowColor = 'transparent';
    };
    L.forEach((Ln, li) => {
      let s = Ln.line;
      if (shown !== Infinity) { const take = Math.max(0, Math.min(s.length, shown)); s = s.slice(0, take); shown -= Ln.line.length; }
      if (shownW !== Infinity) { const ws = s.split(/\s+/); s = ws.slice(0, Math.max(0, shownW)).join(' '); shownW -= ws.length; }
      const lineSt = A.unitState(x, 'line', li, total.line, lt, k);
      if (!s) { ci += Ln.nChars; wi += Ln.nWords; return; }
      const y = -blockH / 2 + m.lh * (li + .5); const full = m.widths[li]; const lw = g.measureText(s).width;
      let xx; if (x.align === 'left') xx = -bw / 2; else if (x.align === 'right') xx = bw / 2 - full; else xx = -full / 2;
      if (ar && (o.chars < Infinity || o.words < Infinity) && x.align !== 'left') xx = xx + full - lw;
      const left = xx, right = xx + lw; const drawX = ar ? right : left; g.textAlign = ar ? 'right' : 'left';
      // cells: prefix widths in logical order (shaped measurement keeps joined letters intact)
      const gs = A.graphemes(s); const pre = [0]; let acc = ''; for (const ch of gs) { acc += ch; pre.push(g.measureText(acc).width); }
      const cell = (a, b) => ar ? [right - pre[b], right - pre[a]] : [left + pre[a], left + pre[b]]; // [x0, x1] of graphemes a…b-1
      const units = []; // {x0, x1, st}
      const wordOf = []; { let w = -1, inW = false; for (const ch of gs) { const sp2 = /\s/.test(ch); if (!sp2 && !inW) w++; inW = !sp2; wordOf.push(sp2 ? -1 : w); } }
      const wordSt = useWord ? Array.from({ length: Ln.nWords }, (_, w) => A.unitState(x, 'word', wi + w, total.word, lt, k)) : null;
      if (useChar) { let ii = 0; gs.forEach((ch, gi) => { if (/\s/.test(ch)) return; let st = A.unitState(x, 'char', ci + ii, total.char, lt, k); if (wordSt && wordOf[gi] >= 0) st = combine(st, wordSt[wordOf[gi]]); ii++; units.push({ a: gi, b: gi + 1, st, idx: ii - 1 }); }); }
      else if (useWord) { let gi = 0, w = 0; for (const tok of s.split(/(\s+)/)) { const n = A.graphemes(tok).length; if (tok && !/^\s+$/.test(tok)) { units.push({ a: gi, b: gi + n, st: wordSt[w], idx: w }); w++; } gi += n; } }
      else units.push({ a: 0, b: gs.length, st: { alpha: 1, dx: 0, dy: 0, sc: 1, rot: 0, tr: 0, blur: 0, fill: null, any: false }, idx: 0 });
      // tracking: shift each unit by the accumulated extra spacing of the units before it (centred on the line)
      let trAcc = 0; const trs = units.map(u => { const t = u.st.tr || 0; const v = trAcc; trAcc += t; return v; }); const trCentre = trAcc / 2;
      const needCells = units.some(u => u.st.any) || lineSt.any;
      if (!needCells) { drawText(s, drawX, y); ci += Ln.nChars; wi += Ln.nWords; return; }
      const hy0 = -m.lh * .75, hy1 = m.lh * .75;
      units.forEach((u, ui) => {
        const st = u.st; const [x0, x1] = cell(u.a, u.b); const cx = (x0 + x1) / 2;
        const al = st.alpha * lineSt.alpha; if (al <= .002) return;
        const sc = st.sc * lineSt.sc; if (Math.abs(sc) < .002) return;
        const tdx = (ar ? -1 : 1) * (trs[ui] - trCentre);
        g.save(); g.globalAlpha *= al;
        const bl = st.blur + lineSt.blur; const pad = bl > 0 ? bl * 2 : 0;
        g.translate(cx + st.dx + lineSt.dx + tdx, y + st.dy + lineSt.dy); g.rotate((st.rot + lineSt.rot) * Math.PI / 180); g.scale(sc, sc); g.translate(-cx, -y);
        if (bl > 0) g.filter = `blur(${bl.toFixed(2)}px)`;
        if (units.length > 1 || u.a > 0 || u.b < gs.length) { const extL = (ar ? ui === units.length - 1 : ui === 0) ? m.lh : 0, extR = (ar ? ui === 0 : ui === units.length - 1) ? m.lh : 0; g.beginPath(); g.rect(x0 - pad - extL, y + hy0 - pad, (x1 - x0) + pad * 2 + extL + extR, hy1 - hy0 + pad * 2); g.clip(); }
        drawText(s, drawX, y, st.fill || lineSt.fill);
        g.restore();
      });
      ci += Ln.nChars; wi += Ln.nWords;
    });
  };
})();
