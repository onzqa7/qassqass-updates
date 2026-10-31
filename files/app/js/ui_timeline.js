'use strict';
/* Timeline panel v3: multi-track editing with Premiere-style tools.
   Rendering: three layers redrawn only when invalidated, on the app rAF ('tick'):
     clips layer (tracks, clips, transitions)  ← content / view changes
     overlay     (playhead, ghost, hover, snap, marquee, razor line) ← time / pointer changes
     ruler + ruler overlay (playhead head)
   Clips are virtualized through a per-track index sorted by start with a prefix max of clip ends,
   so drawing, hit testing, snapping and marquee only touch clips intersecting the visible range.
   Thumbnails / waveforms are rendered into 256px offscreen tiles per (media, zoom bucket, height) in an LRU. */
(function () {
  const { clamp, esc } = GW;
  const TL = GW.TL = { tool: 'select', snap: true, linked: true, thumbs: true, waves: true, target: { v: 0, a: 0 }, vs: 0, dirty: true, ghost: null, snapX: null, hover: null, marq: null };
  const DEF_H = 44, SEP = 6, MIN_H = 22, MAX_H = 260, NB = 15, TILE = 256, TILE_MAX = 420;
  const PRESET = { s: 28, m: DEF_H, l: 84 };
  const TOOLS = [
    ['select', 'أداة التحديد (V)', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3.5l12 8.2-5.6 1.2 3.1 6.4-2.3 1.1-3.1-6.5L6 17.6z"/></svg>'],
    ['track', 'تحديد المسار للأمام (A)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 5v14M9 12h11M16 8l4 4-4 4"/></svg>'],
    ['ripple', 'تعديل مع إزاحة (B)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 4v16M9 12h11M16 8l4 4-4 4M4 8v8"/></svg>'],
    ['roll', 'تعديل متدحرج (N)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 4v16M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h7M15 12h7"/></svg>'],
    ['rate', 'تمديد السرعة (R)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/><circle cx="12" cy="12" r="2.5"/></svg>'],
    ['razor', 'أداة القص (C)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5L20 18M8.5 16.5L20 6"/></svg>'],
    ['slip', 'أداة الانزلاق (Y)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="7" y="7" width="10" height="10"/><path d="M2 12h4M18 12h4M4 10l-2 2 2 2M20 10l2 2-2 2"/></svg>'],
    ['slide', 'أداة الانزلاق مع تحريك (U)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="8" y="7" width="8" height="10"/><path d="M2 12h4M18 12h4M4 9l-2 3 2 3M20 9l2 3-2 3M3 7v10M21 7v10"/></svg>'],
    ['pen', 'أداة القلم / المفاتيح (P)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 19l7-7-3-3-7 7-2 5zM15 6l3 3"/></svg>'],
    ['hand', 'أداة اليد (H)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 11V5a1.5 1.5 0 013 0v5M11 10V4a1.5 1.5 0 013 0v6M14 10V5a1.5 1.5 0 013 0v7M8 11a1.5 1.5 0 00-3 0v2c0 4 3 8 7 8s6-3 6-7v-2"/></svg>'],
    ['zoom', 'أداة التكبير (Z)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6M10 7v6M7 10h6"/></svg>'],
    ['text', 'أداة النص (T)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 5h14M12 5v15M9 20h6"/></svg>']
  ];
  const IC = {
    lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3.5" y="7.5" width="9" height="6" rx="1"/><path d="M5.5 7.5V5.2a2.5 2.5 0 015 0v2.3"/></svg>',
    unlock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3.5" y="7.5" width="9" height="6" rx="1"/><path d="M5.5 7.5V5.2a2.5 2.5 0 014.8-1"/></svg>',
    eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
    eyeoff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 2.5l11 11M6.6 4A6.6 6.6 0 018 3.8c4 0 6.5 4.2 6.5 4.2a11 11 0 01-1.9 2.3M4.3 5.1C2.6 6.3 1.5 8 1.5 8S4 12.2 8 12.2a6 6 0 002.7-.6"/></svg>',
    mute: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 6v4h2.5l3.5 3V3L5 6z" fill="currentColor" stroke-linejoin="round"/><path d="M11 6l3 4M14 6l-3 4"/></svg>',
    solo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 10V8.5a5 5 0 0110 0V10"/><rect x="2.5" y="9.5" width="2.5" height="4" rx=".8" fill="currentColor"/><rect x="11" y="9.5" width="2.5" height="4" rx=".8" fill="currentColor"/></svg>',
    hS: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="4" width="12" height="2"/><rect x="2" y="7" width="12" height="2"/><rect x="2" y="10" width="12" height="2"/></svg>',
    hM: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="12" height="4"/><rect x="2" y="9" width="12" height="4"/></svg>',
    hL: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2.5" width="12" height="11"/></svg>',
    fit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.5 8h13M4 5.5L1.5 8 4 10.5M12 5.5L14.5 8 12 10.5M1.5 3v10M14.5 3v10"/></svg>'
  };

  /* ---------- panel ---------- */
  GW.registerPanel('timeline', 'الخط الزمني', (el) => {
    el.style.display = 'grid'; el.style.gridTemplateColumns = '34px minmax(0,1fr) 46px'; el.style.gridTemplateRows = 'minmax(0,1fr)';
    el.classList.add('tl3');
    el.innerHTML = `<div class="tools" data-a="tools"></div>
      <div class="tl" data-a="tl">
        <div class="tl-seqtabs" data-a="seqtabs"></div>
        <div class="tl-top"><div class="tl-tcbox"><span class="tl-tc" data-a="tc" title="انقر للانتقال إلى توقيت">00:00:00:00</span><span class="tl-opts">
          <button class="tb" data-a="snap" title="المحاذاة المغناطيسية (S)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3v8a6 6 0 0012 0V3M6 7h4M14 7h4"/></svg></button>
          <button class="tb" data-a="linked" title="التحديد المرتبط"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 14a4 4 0 005.6 0l3-3a4 4 0 00-5.6-5.6l-1 1M14 10a4 4 0 00-5.6 0l-3 3a4 4 0 005.6 5.6l1-1"/></svg></button>
          <button class="tb" data-a="marker" title="إضافة علامة (M)"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h10v10l-5 5-5-5z"/></svg></button>
          <button class="tb" data-a="opts" title="خيارات العرض"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
        </span></div><div class="tl-ruler" data-a="ruler"><canvas data-a="rc"></canvas><canvas data-a="ro"></canvas></div></div>
        <div class="tl-body" data-a="body"><div class="tl-heads" data-a="heads"><div class="tl-heads-in" data-a="headsIn"></div></div><div class="tl-tracks" data-a="tracks" tabindex="0"><canvas data-a="cv"></canvas><canvas data-a="ov"></canvas><div class="tl-vscroll" data-a="vbar" hidden><i data-a="vthumb"></i></div></div></div>
        <div class="tl-hscroll"><div class="tl-hs-l">
          <button class="tb" data-h="s" title="ارتفاع المسارات: صغير">${IC.hS}</button><button class="tb" data-h="m" title="ارتفاع المسارات: متوسط">${IC.hM}</button><button class="tb" data-h="l" title="ارتفاع المسارات: كبير">${IC.hL}</button><span class="sp"></span><button class="tb" data-a="fit" title="ملاءمة التسلسل (\\)">${IC.fit}</button><span class="sp tl-wz-sp"></span><button class="tb tl-wz" data-a="wzOut" title="تصغير الموجة الصوتية">−</button><span class="tl-wz tl-wzv" data-a="wz" title="تكبير الموجة الصوتية (عمودي)">×1</span><button class="tb tl-wz" data-a="wzIn" title="تكبير الموجة الصوتية">+</button>
        </div><div class="tl-hbar" data-a="hbar"><i data-a="hthumb"><b class="l" data-z="l"></b><b class="r" data-z="r"></b></i></div></div>
      </div>
      <div class="meters"><canvas data-a="meter"></canvas><span class="lbl">dB</span></div>`;
    TL.el = el; const q = a => el.querySelector(`[data-a=${a}]`);
    TL.cv = q('cv'); TL.ov = q('ov'); TL.rc = q('rc'); TL.ro = q('ro'); TL.tracksEl = q('tracks'); TL.headsIn = q('headsIn'); TL.meter = q('meter'); TL.tcEl = q('tc');
    for (const c of [TL.cv, TL.ov, TL.rc, TL.ro]) { c.style.position = 'absolute'; c.style.left = c.style.top = '0'; c.style.width = c.style.height = '100%'; c.style.display = 'block'; }
    TL.hbar = q('hbar'); TL.hthumb = q('hthumb'); TL.vbar = q('vbar'); TL.vthumb = q('vthumb');
    const tools = q('tools');
    for (const [id, tip, svg] of TOOLS) { const b = document.createElement('button'); b.className = 'tb' + (TL.tool === id ? ' on' : ''); b.dataset.tool = id; b.title = tip; b.innerHTML = svg; b.onclick = () => TL.setTool(id); tools.append(b); }
    q('snap').classList.toggle('on', TL.snap); q('linked').classList.toggle('on', TL.linked);
    q('snap').onclick = (e) => { TL.snap = !TL.snap; e.currentTarget.classList.toggle('on', TL.snap); };
    q('linked').onclick = (e) => { TL.linked = !TL.linked; e.currentTarget.classList.toggle('on', TL.linked); };
    q('marker').onclick = GW.cmd.marker;
    q('fit').onclick = () => TL.fit();
    q('wzIn').onclick = () => TL.setWaveZoom(TL.waveZoom * 2); q('wzOut').onclick = () => TL.setWaveZoom(TL.waveZoom / 2); q('wz').onclick = () => TL.setWaveZoom(1);
    el.querySelectorAll('[data-h]').forEach(b => b.onclick = () => TL.setTrackHeights(PRESET[b.dataset.h]));
    q('opts').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); GW.menu(r.right, r.bottom, [{ label: 'إظهار الصور المصغرة', check: TL.thumbs, action: () => { TL.thumbs = !TL.thumbs; TL.invalidate(); } }, { label: 'إظهار موجات الصوت', check: TL.waves, action: () => { TL.waves = !TL.waves; TL.invalidate(); } }, '-', { label: 'ارتفاع المسارات', sub: [['s', 'صغير'], ['m', 'متوسط'], ['l', 'كبير']].map(([k, n]) => ({ label: n, action: () => TL.setTrackHeights(PRESET[k]) })) }, { label: 'ملاءمة التسلسل', key: '\\', action: () => TL.fit() }, '-', { label: 'إضافة مسار فيديو', action: () => GW.cmd.addTrack('v') }, { label: 'إضافة مسار صوت', action: () => GW.cmd.addTrack('a') }, { label: 'حذف المسارات الفارغة', action: GW.cmd.delEmptyTracks }]); };
    q('tc').onclick = async () => { const s = GW.seq(); const v = await GW.prompt('انتقال إلى', 'التوقيت (سا:د:ث:إطار)', GW.fmtTC(s.t, s.fps)); if (v) { const t = GW.parseTC(v, s.fps); if (t != null) GW.seek(t); } };
    initRuler(q('ruler')); initTracks(); initHScroll(); initVScroll();
    q('body').addEventListener('wheel', onWheel, { passive: false });
    q('ruler').addEventListener('wheel', onWheel, { passive: false });
    // middle mouse never triggers the browser autoscroll inside the timeline
    q('tl').addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    const ro = new ResizeObserver(() => { measure(); TL.invalidate(); });
    ro.observe(q('tracks')); ro.observe(q('ruler')); ro.observe(q('hbar'));
    measure(); TL.renderSeqTabs(); TL.renderHeads(); TL.invalidate();
  });

  /* ---------- invalidation ---------- */
  const D = { clips: true, over: true, ruler: true, rover: true, bars: true };
  TL.invalidate = () => { D.clips = D.over = D.ruler = D.rover = D.bars = true; TL.dirty = true; if (IX) IX.dirty = true; };
  const invView = () => { D.clips = D.over = D.ruler = D.rover = D.bars = true; TL.dirty = true; }; // scroll / zoom only: index stays valid
  const invOver = () => { D.over = true; TL.dirty = true; };
  TL.invalidateView = invView;
  TL.setTool = (t) => { TL.tool = t; if (TL.el) TL.el.querySelectorAll('.tools .tb').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); TL.updateCursor(); TL.hover = null; invOver(); GW.invalidate(); };
  let curCursor = '';
  const setCursor = (c) => { if (c !== curCursor && TL.tracksEl) { curCursor = c; TL.tracksEl.style.cursor = c; } };
  TL.updateCursor = () => setCursor({ razor: 'crosshair', hand: 'grab', zoom: 'zoom-in', pen: 'crosshair', text: 'text' }[TL.tool] || 'default');

  /* ---------- geometry ---------- */
  const S = () => GW.seq();
  let W = 800, H = 200, RW = 800, RH = 28, HBW = 600, DPR = 1;
  function measure() { if (!TL.tracksEl) return; W = TL.tracksEl.clientWidth || W; H = TL.tracksEl.clientHeight || H; const r = TL.rc.parentNode; RW = r.clientWidth || RW; RH = r.clientHeight || RH; HBW = TL.hbar.clientWidth || HBW; }
  TL.pps = () => S().zoom || 60;
  TL.x = (t) => (t - (S().scroll || 0)) * TL.pps();
  TL.t = (x) => x / TL.pps() + (S().scroll || 0);
  // workspace view override (GW.WS[ws].tlView, e.g. the Audio page): video tracks collapsed to vH, audio tracks at least aH — view only, never saved
  const trackH = (tr, tt) => { const V = TL.view; if (V && tt === 'v') return V.vH; if (V && tt === 'a') return Math.max(tr.h || DEF_H, V.aH); return tr.h || DEF_H; };
  TL.waveZoom = 1;
  TL.setView = (v) => { const same = JSON.stringify(TL.view || null) === JSON.stringify(v || null); TL.view = v || null; if (TL.el) TL.el.classList.toggle('tl-aview', !!(v && v.aH)); if (same) return; rowsCache = null; if (TL.el) { TL.renderHeads(); TL.invalidate(); } };
  TL.setWaveZoom = (z) => { TL.waveZoom = clamp(+z || 1, 1, 16); if (TL.el) { const b = TL.el.querySelector('[data-a=wz]'); if (b) b.textContent = '×' + TL.waveZoom; } TL.invalidate(); GW.bus.emit('wavezoom', TL.waveZoom); };
  let rowsCache = null;
  TL.rows = () => {
    const s = S(); const c = rowsCache;
    if (c && c.s === s && c.nv === s.vt.length && c.na === s.at.length) {
      let ok = true; for (const r of c) if ((r.tt === 'v' ? s.vt : s.at)[r.ti] !== r.tr || trackH(r.tr, r.tt) !== r.h) { ok = false; break; }
      if (ok) return c;
    }
    const rows = []; let y = 0;
    for (let i = s.vt.length - 1; i >= 0; i--) { const h = trackH(s.vt[i], 'v'); rows.push({ tt: 'v', ti: i, y, h, tr: s.vt[i] }); y += h; }
    rows.sep = y; y += SEP;
    for (let i = 0; i < s.at.length; i++) { const h = trackH(s.at[i], 'a'); rows.push({ tt: 'a', ti: i, y, h, tr: s.at[i] }); y += h; }
    rows.total = y; rows.s = s; rows.nv = s.vt.length; rows.na = s.at.length; rowsCache = rows; return rows;
  };
  TL.rowAt = (y) => { const rows = TL.rows(); const yy = y + TL.vs; for (const r of rows) if (yy >= r.y && yy < r.y + r.h) return r; return null; };
  TL.rowOf = (tt, ti) => TL.rows().find(r => r.tt === tt && r.ti === ti);
  TL.isTargeted = (c) => TL.target[c.tt] === c.ti;
  const maxVS = () => Math.max(0, TL.rows().total - H + 24);
  const setVS = (v) => { const n = clamp(v, 0, maxVS()); if (n !== TL.vs) { TL.vs = n; invView(); } };

  /* ---------- clip index (virtualization) ---------- */
  let IX = null;
  function index() {
    const s = S();
    if (IX && !IX.dirty && IX.s === s && IX.n === s.clips.length && IX.nt === s.trans.length) return IX;
    const tracks = new Map(), byId = new Map(); let end = 0;
    for (const c of s.clips) { byId.set(c.id, c); const k = c.tt + c.ti; let a = tracks.get(k); if (!a) tracks.set(k, a = []); a.push(c); const e = c.start + c.dur; if (e > end) end = e; }
    for (const a of tracks.values()) { a.sort((x, y) => x.start - y.start); const me = new Float64Array(a.length); let m = -Infinity; for (let i = 0; i < a.length; i++) { const e = a[i].start + a[i].dur; if (e > m) m = e; me[i] = m; } a.me = me; }
    // transitions per track, resolved through the id map (avoids O(clips) lookups per transition)
    const trs = new Map();
    for (const tr of s.trans) {
      const A = tr.a && byId.get(tr.a), B = tr.b && byId.get(tr.b); const d = tr.dur; let t0, t1;
      if (A && B) { const at = A.start + A.dur, al = tr.align || 'center'; if (al === 'start') { t0 = at; t1 = at + d; } else if (al === 'end') { t0 = at - d; t1 = at; } else { t0 = at - d / 2; t1 = at + d / 2; } }
      else if (A) { t1 = A.start + A.dur; t0 = t1 - d; } else if (B) { t0 = B.start; t1 = t0 + d; } else { t0 = 0; t1 = d; }
      const k = tr.tt + tr.ti; let a = trs.get(k); if (!a) trs.set(k, a = []); a.push({ tr, t0, t1 });
    }
    for (const a of trs.values()) { a.sort((x, y) => x.t0 - y.t0); const me = new Float64Array(a.length); let m = -Infinity; for (let i = 0; i < a.length; i++) { if (a[i].t1 > m) m = a[i].t1; me[i] = m; } a.me = me; }
    IX = { s, n: s.clips.length, nt: s.trans.length, tracks, trs, byId, end, dirty: false };
    return IX;
  }
  // first index whose prefix-max end exceeds t (monotonic) → iterate while start < t1
  function lowerEnd(me, t) { let lo = 0, hi = me.length; while (lo < hi) { const m = (lo + hi) >> 1; if (me[m] > t) hi = m; else lo = m + 1; } return lo; }
  function eachClip(tt, ti, t0, t1, fn) { const a = index().tracks.get(tt + ti); if (!a) return; for (let i = lowerEnd(a.me, t0); i < a.length; i++) { const c = a[i]; if (c.start >= t1) break; if (c.start + c.dur > t0) if (fn(c) === false) return; } }
  function eachTrans(tt, ti, t0, t1, fn) { const a = index().trs.get(tt + ti); if (!a) return; for (let i = lowerEnd(a.me, t0); i < a.length; i++) { const o = a[i]; if (o.t0 >= t1) break; if (o.t1 > t0) fn(o); } }
  const seqEnd = () => index().end;
  TL.visibleClips = (tt, ti) => { const out = []; eachClip(tt, ti, TL.t(0), TL.t(W), c => { out.push(c); }); return out; };

  /* ---------- zoom / scroll ---------- */
  const zoomMin = () => Math.max(0.0005, Math.min(2, (W - 30) / Math.max(5, seqEnd()) * 0.5));
  const ZOOM_MAX = 4000;
  TL.zoomBy = (f, atX) => {
    const s = S(); const x = atX ?? clamp(TL.x(s.t), 0, W); const t = TL.t(clamp(x, 0, W));
    const z = clamp(s.zoom * f, zoomMin(), ZOOM_MAX); if (z === s.zoom) return;
    s.zoom = z; s.scroll = Math.max(0, t - x / z); anim = null; invView();
  };
  TL.zoom = (dir, atX) => TL.zoomBy(dir > 0 ? 1.4 : 1 / 1.4, atX);
  TL.fit = () => { const s = S(); measure(); const w = W - 30; const d = Math.max(5, seqEnd()); s.zoom = clamp(w / d, 0.0005, ZOOM_MAX); s.scroll = 0; anim = null; TL.invalidate(); };
  TL.zoomTo = (a, b) => { const s = S(); measure(); const d = Math.max(1 / s.fps, b - a); const pad = d * .08; s.zoom = clamp((W - 30) / (d + pad * 2), 0.0005, ZOOM_MAX); s.scroll = Math.max(0, a - pad); anim = null; TL.invalidate(); };
  TL.ensureVisible = (t) => { if (!TL.tracksEl) return; const s = S(); const x = TL.x(t); if (x > W - 20) s.scroll = t - (W * .15) / s.zoom; else if (x < 0) s.scroll = Math.max(0, t - (W * .1) / s.zoom); else return; invView(); };
  const visDur = () => W / TL.pps();
  const extent = () => { const s = S(); const v = visDur(); return Math.max(v, seqEnd() + Math.min(v * .5, Math.max(2, seqEnd() * .1)), s.scroll + v); };
  const maxScroll = () => Math.max(0, extent() - visDur());
  // smooth scroll target for wheel notches (trackpads are applied directly)
  let anim = null;
  function scrollTo(t, smooth) {
    const s = S(); t = clamp(t, 0, Math.max(maxScroll(), s.scroll));
    if (!smooth) { anim = null; if (t !== s.scroll) { s.scroll = t; invView(); } return; }
    anim = { to: t, last: s.scroll };
  }
  function stepAnim() {
    if (!anim) return; const s = S();
    if (Math.abs(s.scroll - anim.last) > 1e-9) { anim = null; return; } // somebody else moved the view
    const d = anim.to - s.scroll; if (Math.abs(d) * TL.pps() < .5) { s.scroll = anim.to; anim = null; } else { s.scroll += d * .38; anim.last = s.scroll; }
    invView();
  }
  TL.setTrackHeights = (h) => { const s = S(); for (const tr of [...s.vt, ...s.at]) { if (h === DEF_H) delete tr.h; else tr.h = h; } TL.renderHeads(); TL.invalidate(); };

  /* ---------- seq tabs & track headers ---------- */
  TL.renderSeqTabs = () => {
    if (!TL.el) return; const box = TL.el.querySelector('[data-a=seqtabs]'); box.innerHTML = '';
    for (const s of GW.prj.seqs) { const b = document.createElement('button'); b.className = 'tl-seqtab' + (s.id === GW.prj.active ? ' on' : ''); b.textContent = s.name; b.onclick = () => { GW.stop(); GW.prj.active = s.id; GW.bus.emit('project'); }; box.append(b); }
  };
  const headEls = new Map();
  TL.renderHeads = () => {
    if (!TL.headsIn) return; const box = TL.headsIn; box.innerHTML = ''; headEls.clear();
    const rows = TL.rows();
    for (const r of rows) {
      const d = document.createElement('div'); d.className = 'th-row ' + r.tt + (r.tt === 'v' && r.ti === 0 ? ' vsep' : '') + (r.tr.lock ? ' locked' : '');
      const tg = TL.target[r.tt] === r.ti; const short = (r.tt === 'v' ? 'V' : 'A') + (r.ti + 1);
      const nm = r.tr.name && r.tr.name !== short ? `<span class="tlabel" title="${esc(r.tr.name)}">${esc(r.tr.name)}</span>` : '<span class="tlabel"></span>';
      d.innerHTML = `<button class="ib lk ${r.tr.lock ? 'on' : ''}" data-k="lock" title="قفل المسار">${r.tr.lock ? IC.lock : IC.unlock}</button><span class="tname ${tg ? 'target' : ''}" title="تحديد كمسار مستهدف">${short}</span>`
        + (r.tt === 'v' ? `<button class="ib out ${r.tr.hide ? '' : 'on'}" data-k="hide" title="تبديل مخرج المسار">${r.tr.hide ? IC.eyeoff : IC.eye}</button>`
          : `<button class="ib m ${r.tr.mute ? 'on' : ''}" data-k="mute" title="كتم المسار">${IC.mute}</button><button class="ib s ${r.tr.solo ? 'on' : ''}" data-k="solo" title="عزف منفرد">${IC.solo}</button>` + (GW.VO ? `<button class="ib vo ${GW.VO.rec && GW.VO.rec.ti === r.ti ? 'on' : ''}" data-vo="1" title="تسجيل تعليق صوتي (انقر بزر الفأرة الأيمن للإعدادات)">${GW.VO.icon}</button>` : ''))
        + nm + '<div class="th-rs" title="اسحب لتغيير ارتفاع المسار"></div>';
      d.querySelector('.tname').onclick = () => { TL.target[r.tt] = r.ti; TL.renderHeads(); TL.invalidate(); };
      const vo = d.querySelector('[data-vo]'); if (vo) { vo.onclick = (e) => { e.stopPropagation(); GW.VO.toggle(r.ti); }; vo.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); GW.VO.settings(); }; } // voice-over record (ui_voiceover.js)
      d.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { const k = b.dataset.k; r.tr[k] = r.tr[k] ? 0 : 1; GW.commit('خصائص المسار'); if (k === 'mute' || k === 'solo') { if (GW.pb.playing) { const t = S().t; GW.stop(); S().t = t; GW.play(1); } } });
      d.ondblclick = (e) => { if (e.target.closest('button,.tname,.th-rs')) return; r.tr.h = trackH(r.tr, r.tt) > DEF_H ? DEF_H : 84; if (r.tr.h === DEF_H) delete r.tr.h; TL.renderHeads(); TL.invalidate(); };
      d.oncontextmenu = (e) => { e.preventDefault(); GW.menu(e.clientX, e.clientY, [{ label: 'إعادة تسمية المسار…', action: async () => { const n = await GW.prompt('إعادة تسمية المسار', 'الاسم', r.tr.name); if (n) { r.tr.name = n; GW.commit('إعادة تسمية مسار'); } } }, { label: 'ارتفاع المسار', sub: [['s', 'صغير'], ['m', 'متوسط'], ['l', 'كبير']].map(([k, n]) => ({ label: n, check: trackH(r.tr, r.tt) === PRESET[k], action: () => { if (PRESET[k] === DEF_H) delete r.tr.h; else r.tr.h = PRESET[k]; TL.renderHeads(); TL.invalidate(); } })) }, { label: 'ارتفاع كل المسارات', sub: [['s', 'صغير'], ['m', 'متوسط'], ['l', 'كبير']].map(([k, n]) => ({ label: n, action: () => TL.setTrackHeights(PRESET[k]) })) }, '-', { label: 'إضافة مسار فيديو', action: () => GW.cmd.addTrack('v') }, { label: 'إضافة مسار صوت', action: () => GW.cmd.addTrack('a') }, { label: 'حذف المسارات الفارغة', action: GW.cmd.delEmptyTracks }]); };
      const rs = d.querySelector('.th-rs');
      rs.addEventListener('pointerdown', e => {
        if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); rs.setPointerCapture(e.pointerId); const y0 = e.clientY, h0 = trackH(r.tr, r.tt);
        rs.onpointermove = ev => { r.tr.h = Math.round(clamp(h0 + ev.clientY - y0, MIN_H, MAX_H)); layoutHeads(); TL.invalidate(); };
        rs.onpointerup = rs.onpointercancel = () => { rs.onpointermove = null; if (r.tr.h === DEF_H) delete r.tr.h; };
      });
      headEls.set(r.tt + r.ti, d); box.append(d);
    }
    layoutHeads();
  };
  function layoutHeads() {
    const rows = TL.rows();
    for (const r of rows) { const d = headEls.get(r.tt + r.ti); if (!d) continue; d.style.top = r.y + 'px'; d.style.height = r.h + 'px'; d.classList.toggle('short', r.h < 30); }
    TL.headsIn.style.height = rows.total + 'px'; lastHeadVS = null;
  }
  let lastHeadVS = null;

  /* ---------- colours ---------- */
  const PAL = new Map();
  const hex = (h) => { h = String(h || '#888').replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h.slice(0, 6), 16) || 0x888888; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mix = (a, b, k) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * k));
  const css = (c, a) => a == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  function pal(label, sel) {
    const k = label + (sel ? '*' : ''); let p = PAL.get(k); if (p) return p;
    /* design v5: desaturated, slightly lifted label colour; body = dark tint of it, head = lighter tint, 1px top highlight */
    const grey = [120, 124, 132], base0 = mix(hex(label), grey, .3), base = sel ? mix(base0, [255, 255, 255], .12) : base0;
    const head = mix(base, [18, 20, 24], .18), head2 = mix(base, [18, 20, 24], .34), body = mix(base, [16, 18, 22], .64), body2 = mix(base, [16, 18, 22], .74);
    const lum = (head[0] * .299 + head[1] * .587 + head[2] * .114) / 255;
    p = { head: css(head), head2: css(head2), body: css(body), body2: css(body2), border: css(mix(base, [0, 0, 0], .55)), edge: 'rgba(255,255,255,.14)', wave: css(mix(base, [63, 184, 168], .6), .62),
      text: lum > .62 ? '#161616' : '#f4f5f7', sub: lum > .62 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)', chip: lum > .62 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.38)' };
    PAL.set(k, p); return p;
  }
  const C = {
    bg: '#121418', trackV: '#15181d', trackA: '#141719', trackT: '#1a1e24', rowLine: '#0d0f12', sep: '#0a0b0d', io: 'rgba(0,0,0,.42)', ioLine: 'rgba(76,194,255,.55)',
    ruler: '#15181d', tick: '#2f353e', tickH: '#3d444e', tickM: '#4e5562', label: '#8b919b', play: '#ff6a2b', playGlow: 'rgba(255,106,43,.35)', snap: '#4cc2ff', snapGlow: 'rgba(76,194,255,.35)', razor: '#ef5350',
    ghost: 'rgba(76,194,255,.18)', ghostL: '#4cc2ff', marq: 'rgba(76,194,255,.08)', marqL: 'rgba(76,194,255,.7)', band: '#e9c35a', trans: '#3a4150', transSel: '#4cc2ff',
    sel: '#4cc2ff', selGlow: 'rgba(76,194,255,.35)', marker: '#4cc38a'
  };
  const R = 4; // clip corner radius
  function rrect(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); if (r <= 0 || !g.roundRect) { g.rect(x, y, w, h); return; } g.roundRect(x, y, w, h, r); }

  /* ---------- canvas helpers ---------- */
  function fitCanvas(c, w, h) { const bw = Math.max(1, Math.round(w * DPR)), bh = Math.max(1, Math.round(h * DPR)); if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; } const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0); return g; }
  const px = (x) => Math.round(x * DPR) / DPR; // snap to device pixel
  const drawable = (im) => !!im && (im instanceof HTMLCanvasElement ? im.width > 0 && im.height > 0 : im instanceof HTMLImageElement ? im.complete && im.naturalWidth > 0 : im instanceof HTMLVideoElement ? im.readyState >= 2 : true);
  const MW = new Map(), FIT = new Map();
  function mw(g, s) { const k = g.font + '\u0001' + s; let w = MW.get(k); if (w === undefined) { w = g.measureText(s).width; if (MW.size > 20000) MW.clear(); MW.set(k, w); } return w; }
  function fitText(g, s, max) {
    if (max < 10 || !s) return ''; if (mw(g, s) <= max) return s;
    const mb = Math.floor(max / 3) * 3; const k = g.font + '\u0001' + s + '\u0001' + mb; let r = FIT.get(k); if (r !== undefined) return r;
    let lo = 0, hi = s.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (mw(g, s.slice(0, m) + '…') <= mb) lo = m; else hi = m - 1; }
    r = lo ? s.slice(0, lo).trimEnd() + '…' : ''; if (FIT.size > 20000) FIT.clear(); FIT.set(k, r); return r;
  }
  const FONT = '500 11px "IBM Plex Sans Arabic", "Segoe UI", sans-serif', FONT_S = '10px "IBM Plex Sans Arabic", "Segoe UI", sans-serif', MONO = '10px "JetBrains Mono", Consolas, monospace';

  /* ---------- offscreen tile cache (thumbnail strips & waveforms) ---------- */
  const tiles = new Map(); let tileBytes = 0; const TILE_BYTES = 96e6;
  function tileGet(key, w, h, paint) {
    let c = tiles.get(key); if (c) { tiles.delete(key); tiles.set(key, c); return c; }
    c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w * DPR)); c.height = Math.max(1, Math.ceil(h * DPR));
    const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
    try { paint(g); } catch (e) { /* keep an empty tile rather than failing the frame */ }
    tiles.set(key, c); tileBytes += c.width * c.height * 4;
    while ((tiles.size > TILE_MAX || tileBytes > TILE_BYTES) && tiles.size) { const k0 = tiles.keys().next().value; const o = tiles.get(k0); tileBytes -= o.width * o.height * 4; o.width = o.height = 0; tiles.delete(k0); }
    return c;
  }
  TL.tileStats = () => ({ n: tiles.size, mb: +(tileBytes / 1e6).toFixed(1) });
  const bucket = (p) => Math.pow(2, Math.round(Math.log2(p) * 4) / 4);
  // tile generation is time-boxed per frame so a big zoom jump never blocks a frame; the rest fills in on the next frames
  let tileT0 = 0; const TILE_BUDGET = 6;
  const tileBudget = () => performance.now() - tileT0 < TILE_BUDGET;

  function drawThumbs(g, c, m, r0, x0, xa, xb, y, th) {
    const sp = c.speed || 1, pps = TL.pps(), bp = bucket(pps), sc = pps / bp;
    const tw = Math.max(12, Math.round(th * (m.w || 16) / (m.h || 9)));
    const st = c.kind === 'image' ? 'I' : r0.thumbs ? 'T' + r0.thumbs.length : 'P';
    const kA = Math.max(0, Math.floor((xa - x0) / sc / TILE)), kB = Math.floor((xb - x0) / sc / TILE);
    for (let k = kA; k <= kB; k++) {
      const key = 't|' + m.id + '|' + st + '|' + Math.round(c.in * 1000) + '|' + sp + '|' + bp.toFixed(5) + '|' + th + '|' + DPR + '|' + k;
      if (!tiles.has(key) && !tileBudget()) { TL.dirty = D.clips = true; continue; } // finish next frame
      const tile = tileGet(key, TILE, th, (tg) => {
        const u0 = k * TILE;
        for (let j = Math.floor(u0 / tw); j * tw < u0 + TILE; j++) {
          const lx = j * tw - u0; const srcT = c.in + ((j * tw + tw * .5) / bp) * sp;
          const im = c.kind === 'image' ? (r0.poster || r0.img) : GW.Media.thumbAt(m, srcT);
          if (!drawable(im)) continue;
          tg.drawImage(im, lx, 0, tw, th); tg.fillStyle = 'rgba(0,0,0,.45)'; tg.fillRect(lx + tw - 1, 0, 1, th);
        }
      });
      g.drawImage(tile, x0 + k * TILE * sc, y, TILE * sc + 1, th); // +1px overlap hides sub-pixel seams between tiles
    }
  }
  function drawWave(g, c, m, pk, x0, xa, xb, y, hh, col) {
    const sp = c.speed || 1, q = TL.pps() / sp, bq = bucket(q), sc = q / bq;
    const gq = (c.vol && !GW.isAnim(c.vol) ? Math.round((c.vol.v || 0) * 2) : 0) + Math.round(40 * Math.log10(TL.waveZoom || 1)); const gain = Math.pow(10, gq / 40);
    const sA = c.in + (TL.t(xa) - c.start) * sp, sB = c.in + (TL.t(xb) - c.start) * sp;
    const kA = Math.max(0, Math.floor(sA * bq / TILE)), kB = Math.min(Math.floor(sB * bq / TILE), Math.ceil(pk.length / 100 * bq / TILE));
    for (let k = kA; k <= kB; k++) {
      const key = 'wL|' + m.id + '|' + pk.length + '|' + bq.toFixed(5) + '|' + hh + '|' + gq + '|' + col + '|' + DPR + '|' + k;
      if (!tiles.has(key) && !tileBudget()) { TL.dirty = D.clips = true; continue; }
      const tile = tileGet(key, TILE, hh, (tg) => {
        const N = Math.ceil(TILE * DPR), v = new Float32Array(N + 1), mid = hh / 2, amp = hh / 2 - .5;
        for (let i = 0; i <= N; i++) {
          const s0 = (k * TILE + i / DPR) / bq, s1 = (k * TILE + (i + 1) / DPR) / bq;
          let i0 = Math.max(0, Math.floor(s0 * 100)), i1 = Math.min(pk.length, Math.max(i0 + 1, Math.ceil(s1 * 100))); let mx = 0;
          for (let j = i0; j < i1; j++) if (pk[j] > mx) mx = pk[j];
          const a = mx * gain; v[i] = a > 0.004 ? clamp(1 + 20 * Math.log10(a) / 48, 0, 1) * amp : 0; // logarithmic display (dBFS, 48 dB range)
        }
        tg.fillStyle = col; tg.beginPath(); tg.moveTo(0, mid);
        for (let i = 0; i <= N; i++) tg.lineTo(i / DPR, mid - Math.max(.5, v[i]));
        for (let i = N; i >= 0; i--) tg.lineTo(i / DPR, mid + Math.max(.5, v[i]));
        tg.closePath(); tg.fill();
      });
      g.drawImage(tile, x0 + (k * TILE - c.in * bq) * sc, y, TILE * sc + 1, hh);
    }
  }

  /* ---------- drawing: ruler ---------- */
  const STEPS = (fps) => [1 / fps, 2 / fps, 5 / fps, 10 / fps, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 5 * 86400, 10 * 86400];
  function drawRuler() {
    const g = fitCanvas(TL.rc, RW, RH), w = RW, h = RH; g.fillStyle = C.ruler; g.fillRect(0, 0, w, h);
    const s = S(), pps = TL.pps(), fps = s.fps || 30, steps = STEPS(fps);
    const major = steps.find(x => x * pps >= 96) || steps[steps.length - 1];
    let minor = major; for (const x of steps) { if (x >= major) break; const r = major / x; if (x * pps >= 7 && Math.abs(r - Math.round(r)) < 1e-6 && r <= 10) { minor = x; break; } }
    const ratio = Math.round(major / minor), half = ratio % 2 === 0 ? ratio / 2 : 0;
    const i0 = Math.floor(TL.t(0) / minor), i1 = Math.ceil(TL.t(w) / minor);
    const lw = 1 / DPR * Math.max(1, Math.round(DPR));
    // v5 ruler: hairline baseline, minor ticks short + dim, half ticks medium, major ticks tall with mono labels
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, h - 1, w, 1);
    for (let i = Math.max(0, i0); i <= i1; i++) { const x = px(TL.x(i * minor)); const M = i % ratio === 0, Hf = half && i % half === 0; if (M) continue; g.fillStyle = Hf ? C.tickH : C.tick; g.fillRect(x, Hf ? h - 8 : h - 4, lw, Hf ? 8 : 4); }
    g.fillStyle = C.tickM; g.font = MONO; g.textBaseline = 'alphabetic';
    for (let i = Math.max(0, Math.floor(i0 / ratio) * ratio); i <= i1; i += ratio) { const t = i * minor; const x = px(TL.x(t)); g.fillRect(x, h - 13, lw, 13); }
    g.fillStyle = C.label;
    for (let i = Math.max(0, Math.floor(i0 / ratio) * ratio); i <= i1; i += ratio) { const t = i * minor; const x = px(TL.x(t)); g.fillText(GW.fmtTC(t, fps), x + 5, 11); }
    if (s.inP != null || s.outP != null) { const a = TL.x(s.inP || 0), b = TL.x(s.outP ?? seqEnd()); g.fillStyle = 'rgba(76,194,255,.22)'; g.fillRect(a, 0, b - a, 3); g.fillStyle = C.snap; if (s.inP != null) { g.beginPath(); g.moveTo(px(a), 0); g.lineTo(px(a) + 6, 0); g.lineTo(px(a), 7); g.closePath(); g.fill(); } if (s.outP != null) { g.beginPath(); g.moveTo(px(b), 0); g.lineTo(px(b) - 6, 0); g.lineTo(px(b), 7); g.closePath(); g.fill(); } }
    for (const m of s.markers) { const x = TL.x(m.t); if (x < -10 || x > w + 10) continue; g.fillStyle = m.color || C.marker; g.beginPath(); g.moveTo(x - 4, h - 12); g.lineTo(x + 4, h - 12); g.lineTo(x + 4, h - 6); g.lineTo(x, h - 2); g.lineTo(x - 4, h - 6); g.closePath(); g.fill(); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x - 4, h - 12, 8, 1); }
  }
  function drawRulerOverlay() {
    const g = fitCanvas(TL.ro, RW, RH); g.clearRect(0, 0, RW, RH);
    const x = px(TL.x(S().t)); if (x < -8 || x > RW + 8) return;
    // v5 playhead head: ember triangle with a soft glow and a 1px stem (hit-testing elsewhere is unchanged)
    g.shadowColor = C.playGlow; g.shadowBlur = 8;
    g.fillStyle = C.play; g.beginPath(); g.moveTo(x - 6, 3); g.lineTo(x + 6, 3); g.lineTo(x + 6, 9); g.lineTo(x, RH - 8); g.lineTo(x - 6, 9); g.closePath(); g.fill();
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x - 6, 3, 12, 1);
    g.fillStyle = C.play; g.fillRect(x - .5, RH - 9, 1, 9);
  }

  /* ---------- drawing: clips layer ---------- */
  let mediaMap = new Map();
  const hasFx = (c) => (c.fx && c.fx.length) || (c.afx && c.afx.length) || GW.isAnim(c.opacity) || (c.motion && Object.values(c.motion).some(p => GW.isAnim(p)));
  function drawClip(g, c, row) {
    const x0 = TL.x(c.start), x1 = TL.x(c.start + c.dur);
    const y = row.y - TL.vs + 1, h = row.h - 2;
    const X0 = px(x0), X1 = px(x1) - 1; const xa = Math.max(X0, -2), xb = Math.min(X1, W + 2); const w = xb - xa; if (w <= 0) return;
    const sel = GW.sel.clips.has(c.id), off = c.on === 0;
    const m = c.media ? mediaMap.get(c.media) : null; const offline = m && m.offline;
    const P = pal(offline ? '#a04040' : c.label || '#888888', sel);
    if (off) g.globalAlpha = .45;
    const tall = h >= 30, band = tall ? NB : h;
    // v5 body: rounded corners (only on edges that are on screen), vertical gradient, lighter name band
    const rl = X0 >= -2 ? R : 0, rr = X1 <= W + 2 ? R : 0;
    const shape = () => { g.beginPath(); if (g.roundRect) g.roundRect(xa, y, w, h, [rl, rr, rr, rl]); else g.rect(xa, y, w, h); };
    const gb = g.createLinearGradient(0, y, 0, y + h); gb.addColorStop(0, P.body); gb.addColorStop(1, P.body2);
    shape(); g.fillStyle = gb; g.fill();
    if (tall) { const gh = g.createLinearGradient(0, y, 0, y + band); gh.addColorStop(0, P.head); gh.addColorStop(1, P.head2); g.save(); shape(); g.clip(); g.fillStyle = gh; g.fillRect(xa, y, w, band); g.restore(); }
    else { g.save(); shape(); g.clip(); g.fillStyle = P.head2; g.fillRect(xa, y, w, h); g.restore(); }
    if (w >= 3) {
      g.save(); shape(); g.clip();
      const r0 = m && GW.rt.m[m.id];
      if (tall && w > 6 && r0 && TL.thumbs && c.tt === 'v' && (r0.thumbs || r0.poster)) { drawThumbs(g, c, m, r0, x0, xa, xb, y + band, h - band); const ov = g.createLinearGradient(0, y + band, 0, y + h); ov.addColorStop(0, 'rgba(0,0,0,.22)'); ov.addColorStop(.5, 'rgba(0,0,0,.05)'); ov.addColorStop(1, 'rgba(0,0,0,.3)'); g.fillStyle = ov; g.fillRect(xa, y + band, w, h - band); }
      if (tall && w > 6 && r0 && TL.waves && c.tt === 'a' && r0.peaks && r0.peaks.length) { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(xa, y + band, w, h - band); drawWave(g, c, m, r0.peaks, x0, xa, xb, y + band + 1, h - band - 2, P.wave); }
      // rubber band (opacity / volume)
      const Pp = c.tt === 'a' ? c.vol : c.opacity;
      if (h > 34 && w > 8 && Pp) {
        const top = y + band + 2, bh = h - band - 4;
        const toY = v => c.tt === 'a' ? top + bh * (1 - clamp((v + 40) / 46, 0, 1)) : top + bh * (1 - clamp(v / 100, 0, 1));
        g.strokeStyle = C.band; g.lineWidth = 1; g.beginPath();
        if (!GW.isAnim(Pp)) { const yy = Math.round(toY(Pp.v ?? 0)) + .5; g.moveTo(xa, yy); g.lineTo(xb, yy); }
        else { for (let xx = xa; xx <= xb + 2; xx += 3) { const v = GW.pv(Pp, TL.t(Math.min(xx, xb)) - c.start); const yy = toY(v); xx === xa ? g.moveTo(xx, yy) : g.lineTo(xx, yy); } }
        g.stroke();
        if (Pp.k) for (const k of Pp.k) { const kx = TL.x(c.start + k.t), ky = toY(k.v); if (kx < xa - 5 || kx > xb + 5) continue; g.fillStyle = C.band; g.beginPath(); g.moveTo(kx, ky - 3.5); g.lineTo(kx + 3.5, ky); g.lineTo(kx, ky + 3.5); g.lineTo(kx - 3.5, ky); g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke(); }
      }
      if (c.kind === 'map' && GW.CamKeys) GW.CamKeys.tlDraw(g, c, TL, xa, xb, y, h); // camera keyframes (ui_mapcam.js)
      // name chip + fx badge (label sticks to the visible left edge)
      if (w > 14) {
        let tx = Math.max(X0, 0) + 5; const ty = tall ? y + 11.5 : y + h / 2 + 4;
        if (w > 44 && band >= 12) { const fx = hasFx(c); g.fillStyle = fx ? '#e9c35a' : 'rgba(0,0,0,.22)'; g.beginPath(); rrect(g, tx, ty - 9.5, 15, 12, 3); g.fill(); g.font = 'italic 600 9px Georgia, serif'; g.fillStyle = fx ? '#1a1a1a' : P.sub; g.fillText('fx', tx + 3, ty - .5); tx += 19; }
        if (band >= 11) {
          g.font = FONT; g.fillStyle = off ? P.sub : P.text;
          let label = c.name || ''; if ((c.speed || 1) !== 1) label += ` [${Math.round(c.speed * 100)}%]`;
          const t = fitText(g, label, xb - tx - 6);
          if (t) { if (tall && c.tt === 'v' && !TL.thumbs) { /* no chip needed on flat bodies */ } const tw = mw(g, t); g.fillStyle = P.chip; g.beginPath(); rrect(g, tx - 3, ty - 9.5, tw + 6, 12, 3); g.fill(); g.fillStyle = off ? P.sub : P.text; g.fillText(t, tx, ty); }
        }
      }
      // 1px inner top highlight
      g.fillStyle = P.edge; g.fillRect(xa + rl, y, w - rl - rr, 1);
      g.restore();
    }
    // outline: hairline for normal clips; cyan outline + outer glow for selected
    const lw = 1 / DPR * Math.max(1, Math.round(DPR));
    if (w >= 3) {
      if (sel) { g.save(); g.shadowColor = C.selGlow; g.shadowBlur = 10; g.strokeStyle = C.sel; g.lineWidth = 1.5; shape(); g.stroke(); g.restore(); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; g.beginPath(); if (g.roundRect) g.roundRect(xa + 1.5, y + 1.5, w - 3, h - 3, [rl, rr, rr, rl]); else g.rect(xa + 1.5, y + 1.5, w - 3, h - 3); g.stroke(); }
      else { g.strokeStyle = P.border; g.lineWidth = lw; g.beginPath(); if (g.roundRect) g.roundRect(xa + lw / 2, y + lw / 2, w - lw, h - lw, [rl, rr, rr, rl]); else g.rect(xa + lw / 2, y + lw / 2, w - lw, h - lw); g.stroke(); }
    }
    if (off) g.globalAlpha = 1;
  }
  function drawTransition(g, o, row) {
    const tr = o.tr; const x0 = px(TL.x(o.t0)), x1 = px(TL.x(o.t1)); if (x1 < 0 || x0 > W) return;
    const y = row.y - TL.vs + 2, h = Math.min(row.h - 4, 18); const sel = GW.sel.trans === tr.id; const w = Math.max(4, x1 - x0);
    g.fillStyle = sel ? 'rgba(76,194,255,.28)' : 'rgba(10,12,16,.72)'; g.beginPath(); rrect(g, x0, y, w, h, 3); g.fill();
    g.strokeStyle = sel ? C.transSel : 'rgba(255,255,255,.22)'; g.lineWidth = 1; g.beginPath(); rrect(g, x0 + .5, y + .5, w - 1, h - 1, 3); g.stroke();
    g.beginPath(); g.moveTo(x0 + 2, y + h - 2); g.lineTo(x0 + w - 2, y + 2); g.strokeStyle = sel ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.3)'; g.stroke();
    if (w > 40) { g.fillStyle = '#f1f3f5'; g.font = FONT_S; const n = (GW.TRANS[tr.kind] || GW.ATRANS[tr.kind] || { n: '' }).n; const t = fitText(g, n, w - 8); if (t) g.fillText(t, x0 + 4, y + h / 2 + 3.5); }
  }
  let hatch = null;
  function drawClips() {
    const g = fitCanvas(TL.cv, W, H); const s = S(); const rows = TL.rows();
    TL.vs = clamp(TL.vs, 0, maxVS());
    mediaMap = new Map(GW.prj.media.map(m => [m.id, m])); tileT0 = performance.now();
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    const t0 = TL.t(-4), t1 = TL.t(W + 4), sc = s.scroll || 0, z = TL.pps();
    for (const r of rows) {
      const y = r.y - TL.vs; if (y > H || y + r.h < 0) continue;
      g.fillStyle = TL.target[r.tt] === r.ti ? C.trackT : r.tt === 'v' ? C.trackV : C.trackA; g.fillRect(0, y, W, r.h);
      g.fillStyle = C.rowLine; g.fillRect(0, y + r.h - 1, W, 1);
      if (r.tr.lock) { if (!hatch) { const p = document.createElement('canvas'); p.width = p.height = 8; const pg = p.getContext('2d'); pg.strokeStyle = 'rgba(0,0,0,.28)'; pg.beginPath(); pg.moveTo(0, 8); pg.lineTo(8, 0); pg.stroke(); hatch = g.createPattern(p, 'repeat'); } g.fillStyle = hatch; g.fillRect(0, y, W, r.h - 1); }
    }
    g.fillStyle = C.sep; g.fillRect(0, rows.sep - TL.vs, W, SEP);
    if (s.inP != null || s.outP != null) { const a = TL.x(s.inP || 0), b = TL.x(s.outP ?? seqEnd()); g.fillStyle = C.io; if (a > 0) g.fillRect(0, 0, a, H); if (b < W) g.fillRect(b, 0, W - b, H); g.fillStyle = C.ioLine; if (s.inP != null) g.fillRect(px(a), 0, 1, H); if (s.outP != null) g.fillRect(px(b) - 1, 0, 1, H); }
    for (const r of rows) {
      const y = r.y - TL.vs; if (y > H || y + r.h < 0) continue;
      // tiny clips (zoomed far out on huge sequences) are merged into runs: one rect per covered span
      let run = null;
      const flush = () => { if (run) { g.fillStyle = run.col; g.fillRect(run.a, y + 1, Math.max(1, run.b - run.a), r.h - 2); run = null; } };
      eachClip(r.tt, r.ti, t0, t1, c => {
        const xa = (c.start - sc) * z, xb = (c.start + c.dur - sc) * z;
        if (xb - xa < 4) { if (run && xa <= run.b + 1.5) run.b = Math.max(run.b, xb); else { flush(); run = { a: xa, b: xb, col: pal(c.label || '#888888', false).head }; } return; }
        flush(); drawClip(g, c, r);
      });
      flush();
      eachTrans(r.tt, r.ti, t0, t1, o => drawTransition(g, o, r));
    }
    for (const mk of s.markers) { const x = TL.x(mk.t); if (x < 0 || x > W) continue; g.fillStyle = mk.color || C.marker; g.globalAlpha = .45; g.fillRect(px(x), 0, 1, H); g.globalAlpha = 1; }
  }

  /* ---------- drawing: overlay ---------- */
  function drawOverlay() {
    const g = fitCanvas(TL.ov, W, H); g.clearRect(0, 0, W, H); const s = S();
    if (TL.ghost) { for (const gh of TL.ghost) { const row = TL.rowOf(gh.tt, gh.ti); if (!row) continue; const x0 = px(TL.x(gh.start)), x1 = px(TL.x(gh.start + gh.dur)); const y = row.y - TL.vs + 1; g.fillStyle = C.ghost; g.fillRect(x0, y, x1 - x0, row.h - 2); g.strokeStyle = C.ghostL; g.lineWidth = 1; g.strokeRect(x0 + .5, y + .5, x1 - x0 - 1, row.h - 3); } }
    if (TL.gap) { const gp = TL.gap; const row = TL.rows().find(r => r.tt === gp.tt && r.ti === gp.ti); if (row) { const x0 = TL.x(gp.t0), x1 = TL.x(gp.t1); if (x1 > 0 && x0 < W) { g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x0, row.y - TL.vs + 1, x1 - x0, row.h - 2); g.strokeStyle = '#d8d8d8'; g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeRect(Math.round(x0) + .5, row.y - TL.vs + 1.5, Math.round(x1 - x0) - 1, row.h - 3); g.setLineDash([]); } } }
    if (TL.marq) { const m = TL.marq; g.fillStyle = C.marq; g.fillRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0); g.strokeStyle = C.marqL; g.lineWidth = 1; g.strokeRect(Math.round(m.x0) + .5, Math.round(m.y0) + .5, Math.round(m.x1 - m.x0), Math.round(m.y1 - m.y0)); }
    const hv = TL.hover;
    if (hv && hv.c && hv.edge) { const row = TL.rowOf(hv.c.tt, hv.c.ti); if (row) { const x0 = px(TL.x(hv.c.start)), x1 = px(TL.x(hv.c.start + hv.c.dur)); const y = row.y - TL.vs + 1; g.fillStyle = TL.tool === 'ripple' ? '#e9c35a' : TL.tool === 'roll' ? '#ff8d5c' : '#4cc2ff'; const x = hv.edge === 'L' ? x0 : x1 - 3; g.fillRect(x, y, 2, row.h - 2); g.fillRect(hv.edge === 'L' ? x : x - 4, y, 6, 2); g.fillRect(hv.edge === 'L' ? x : x - 4, y + row.h - 4, 6, 2); } }
    if (hv && hv.c && !hv.edge && hv.fx) { const row = TL.rowOf(hv.c.tt, hv.c.ti); if (row) { const x0 = TL.x(hv.c.start), x1 = TL.x(hv.c.start + hv.c.dur); g.strokeStyle = 'rgba(76,194,255,.6)'; g.lineWidth = 1.5; g.beginPath(); rrect(g, x0 + 1.5, row.y - TL.vs + 2.5, x1 - x0 - 3, row.h - 5, R); g.stroke(); } }
    if (TL.snapX != null) { const x = px(TL.snapX); g.save(); g.shadowColor = C.snapGlow; g.shadowBlur = 6; g.fillStyle = C.snap; g.fillRect(x - .5, 0, 1, H); g.restore(); g.fillStyle = C.snap; g.beginPath(); g.moveTo(x - 4, 0); g.lineTo(x + 5, 0); g.lineTo(x + .5, 5); g.closePath(); g.fill(); g.beginPath(); g.moveTo(x - 4, H); g.lineTo(x + 5, H); g.lineTo(x + .5, H - 5); g.closePath(); g.fill(); }
    if (TL.tool === 'razor' && hv && hv.x != null) { g.fillStyle = C.razor; g.fillRect(px(hv.x), 0, 1, H); }
    if (GW.VO && GW.VO.rec) { try { GW.VO.drawOverlay(g, W, H); } catch (e) { console.error(e); } } // voice-over take growing on its track
    const x = px(TL.x(s.t)); if (x >= -2 && x <= W + 2) { g.fillStyle = C.playGlow; g.fillRect(x - 1.5, 0, 3, H); g.fillStyle = C.play; g.fillRect(x - .5, 0, 1, H); }
  }

  /* ---------- scrollbars ---------- */
  let hbS = '', vbS = '';
  function updateBars() {
    const s = S(); const tot = extent(), vis = visDur(); const L = s.scroll / tot * HBW, Wd = Math.max(28, vis / tot * HBW);
    const k = Math.round(Math.min(L, HBW - Wd)) + '|' + Math.round(Wd); if (k !== hbS) { hbS = k; TL.hthumb.style.transform = `translateX(${Math.round(Math.min(L, HBW - Wd))}px)`; TL.hthumb.style.width = Math.round(Wd) + 'px'; }
    const total = TL.rows().total + 24; const need = total > H + 1;
    const vk = need ? Math.round(TL.vs / total * H) + '|' + Math.round(Math.max(20, H / total * H)) : '-';
    if (vk !== vbS) { vbS = vk; TL.vbar.hidden = !need; if (need) { TL.vthumb.style.transform = `translateY(${Math.round(TL.vs / total * H)}px)`; TL.vthumb.style.height = Math.round(Math.max(20, H / total * H)) + 'px'; } }
    if (lastHeadVS !== TL.vs) { lastHeadVS = TL.vs; TL.headsIn.style.transform = `translateY(${-TL.vs}px)`; }
  }
  function initHScroll() {
    const bar = TL.hbar, th = TL.hthumb;
    bar.addEventListener('pointerdown', e => {
      if (e.button !== 0) return; e.preventDefault(); const s = S(); const tot = extent(); const vis = visDur(); const z = e.target.dataset.z;
      if (e.target === bar) { // page towards the click
        const r = bar.getBoundingClientRect(); const t = (e.clientX - r.left) / HBW * tot; scrollTo(t < s.scroll ? s.scroll - vis * .9 : s.scroll + vis * .9, true); return;
      }
      const cap = e.target; cap.setPointerCapture(e.pointerId); const x0 = e.clientX, s0 = s.scroll, e0 = s.scroll + vis;
      cap.onpointermove = ev => {
        const dt = (ev.clientX - x0) / HBW * tot;
        if (z === 'l') { const ns = clamp(s0 + dt, 0, e0 - 0.05); const z2 = clamp(W / (e0 - ns), zoomMin(), ZOOM_MAX); s.zoom = z2; s.scroll = Math.max(0, e0 - W / z2); }
        else if (z === 'r') { const ne = Math.max(s0 + 0.05, e0 + dt); s.zoom = clamp(W / (ne - s0), zoomMin(), ZOOM_MAX); s.scroll = s0; }
        else s.scroll = clamp(s0 + dt, 0, Math.max(0, tot - vis));
        anim = null; invView();
      };
      cap.onpointerup = cap.onpointercancel = () => { cap.onpointermove = null; };
    });
    th.addEventListener('dblclick', () => TL.fit());
  }
  function initVScroll() {
    const th = TL.vthumb;
    th.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); th.setPointerCapture(e.pointerId); const y0 = e.clientY, v0 = TL.vs, total = TL.rows().total + 24;
      th.onpointermove = ev => setVS(v0 + (ev.clientY - y0) / H * total); th.onpointerup = th.onpointercancel = () => { th.onpointermove = null; }; });
    TL.vbar.addEventListener('pointerdown', e => { if (e.target !== TL.vbar) return; e.stopPropagation(); const r = TL.vbar.getBoundingClientRect(); setVS(TL.vs + ((e.clientY - r.top) / H * (TL.rows().total + 24) < TL.vs ? -H * .9 : H * .9)); });
  }

  /* ---------- frame loop ---------- */
  let lastT = null, lastFrame = null, lastDur = null, drag = null, tracksRect = null; // rect cached for one frame (hover)
  TL.stats = { clips: 0, over: 0 };
  TL.draw = () => {
    if (!TL.cv || !TL.el.isConnected) return;
    const dpr = window.devicePixelRatio || 1; if (dpr !== DPR) { DPR = dpr; D.clips = D.over = D.ruler = D.rover = D.bars = true; }
    if (!W || !H) return;
    const s = S();
    if (D.clips) { D.clips = false; drawClips(); TL.stats.clips++; }
    if (D.ruler) { D.ruler = false; drawRuler(); }
    if (D.over) { D.over = false; drawOverlay(); TL.stats.over++; }
    if (D.rover) { D.rover = false; drawRulerOverlay(); }
    if (D.bars) { D.bars = false; updateBars(); }
    const fr = Math.round(s.t * s.fps); if (fr !== lastFrame && TL.tcEl) { lastFrame = fr; TL.tcEl.textContent = GW.fmtTC(s.t, s.fps); }
  };
  GW.bus.on('tick', () => {
    if (!TL.el || !TL.el.isConnected) return;
    const s = S(); tracksRect = null;
    if (pendingSeek != null) { const t = pendingSeek; pendingSeek = null; GW.seek(t); }
    stepAnim();
    if (drag) edgeScroll();
    if (GW.pb.playing) { // page scroll: when the playhead leaves the view, jump a page so it sits near the left edge
      const x = TL.x(s.t); if (x > W - 2 || x < 0) { s.scroll = Math.max(0, s.t - (W * .04) / TL.pps()); anim = null; invView(); }
    }
    if (s.t !== lastT) { lastT = s.t; D.over = D.rover = true; TL.dirty = true; }
    const de = IX && !IX.dirty ? IX.end : null; if (de !== lastDur && de != null) { lastDur = de; D.bars = true; TL.dirty = true; }
    if (TL.dirty) { TL.dirty = false; TL.draw(); }
    drawMeter();
  });

  /* ---------- meters ---------- */
  let peakL = 0, peakR = 0, meterIdle = false, mW = 0, mH = 0;
  function drawMeter() {
    const c = TL.meter; if (!c || !c.isConnected) return;
    const playing = GW.Audio.playing; const [l, r] = playing ? GW.Audio.levels() : [0, 0];
    peakL = Math.max(l, peakL * .95); peakR = Math.max(r, peakR * .95);
    const idle = !playing && peakL < 1e-4 && peakR < 1e-4;
    const w = c.clientWidth, h = c.clientHeight; if (!h) return;
    if (idle && meterIdle && w === mW && h === mH) return; meterIdle = idle; mW = w; mH = h;
    const g = fitCanvas(c, w, h); g.clearRect(0, 0, w, h);
    const toY = v => { const db = 20 * Math.log10(Math.max(v, 1e-5)); return h - clamp((db + 48) / 48, 0, 1) * h; };
    const bw = (w - 18) / 2, y6 = toY(Math.pow(10, -6 / 20)), y12 = toY(Math.pow(10, -12 / 20));
    [[l, peakL, 0], [r, peakR, 1]].forEach(([v, pk, i]) => {
      const x = 16 + i * (bw + 2); g.fillStyle = '#0d0f12'; g.fillRect(x, 0, bw, h); const y = toY(v);
      g.fillStyle = '#3fb8a8'; g.fillRect(x, Math.max(y, y12), bw, h - Math.max(y, y12));
      if (y < y12) { g.fillStyle = '#e9c35a'; g.fillRect(x, Math.max(y, y6), bw, y12 - Math.max(y, y6)); }
      if (y < y6) { g.fillStyle = '#ef5350'; g.fillRect(x, y, bw, y6 - y); }
      if (pk > 1e-4) { g.fillStyle = '#d0d0d0'; g.fillRect(x, Math.round(toY(pk)), bw, 1); }
    });
    g.fillStyle = '#6f6f6f'; g.font = '8px "JetBrains Mono", monospace'; for (const db of [0, -6, -12, -24, -36]) { const y = h - (db + 48) / 48 * h; g.fillText(String(db), 0, Math.max(7, y + 3)); }
  }

  /* ---------- wheel: scroll / zoom ---------- */
  function onWheel(e) {
    e.preventDefault(); const s = S();
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? W : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const notch = Math.abs(dy) >= 50 && Number.isInteger(e.deltaY) && !dx; // classic mouse wheel → animate; trackpad → direct
    if (e.altKey || e.ctrlKey) { // zoom around the cursor (also trackpad pinch, which arrives as ctrl+wheel)
      const r = TL.tracksEl.getBoundingClientRect(); const d = dy || dx; const k = Math.abs(d) >= 50 ? .0025 : .012;
      TL.zoomBy(Math.exp(-clamp(d, -240, 240) * k), clamp(e.clientX - r.left, 0, W)); return;
    }
    const overHeads = e.target.closest && e.target.closest('.tl-heads');
    if (e.shiftKey || overHeads) { setVS(TL.vs + (dy || dx)); return; }
    const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    const base = anim ? anim.to : s.scroll;
    scrollTo(base + d * 1.25 / TL.pps(), notch);
    if (!notch) invView();
  }

  /* ---------- snapping (only points near the visible range) ---------- */
  function snapPoints(excl) {
    const s = S(); const pts = [0, s.t]; if (s.inP != null) pts.push(s.inP); if (s.outP != null) pts.push(s.outP);
    const t0 = TL.t(-20), t1 = TL.t(W + 20);
    for (const r of TL.rows()) eachClip(r.tt, r.ti, t0, t1, c => { if (!excl || !excl.has(c.id)) pts.push(c.start, c.start + c.dur); });
    for (const m of s.markers) pts.push(m.t); return pts;
  }
  function snapT(t, excl, extra) {
    TL.snapX = null; if (!TL.snap) return t; const thr = 8 / TL.pps(); let best = null, bd = thr, bp = null;
    for (const p of snapPoints(excl)) for (const off of (extra || [0])) { const d = Math.abs(t + off - p); if (d < bd) { bd = d; best = p - off; bp = p; } }
    if (best != null) { TL.snapX = TL.x(bp); return best; }
    return t;
  }

  /* ---------- drags: capture + auto-scroll at the edges ---------- */
  function capture(el, e, move, up, auto) {
    el.setPointerCapture(e.pointerId);
    drag = { el, last: e, move, auto: !!auto, rect: el.getBoundingClientRect() };
    el.onpointermove = ev => { if (drag) drag.last = ev; move(ev); };
    el.onpointerup = el.onpointercancel = ev => { el.onpointermove = el.onpointerup = el.onpointercancel = null; drag = null; up && up(ev); };
  }
  function edgeScroll() {
    if (!drag.auto || !drag.last) return; const s = S(); const x = drag.last.clientX - drag.rect.left; let v = 0;
    if (x > W - 24) v = Math.min(60, x - (W - 24)); else if (x < 24 && s.scroll > 0) v = Math.max(-60, x - 24);
    if (!v) return; s.scroll = Math.max(0, s.scroll + v * .6 / TL.pps()); anim = null; invView(); drag.move(drag.last);
  }

  /* ---------- ruler interaction ---------- */
  let pendingSeek = null;
  function initRuler(el) {
    el.addEventListener('pointerdown', e => {
      if (e.button === 1) { e.preventDefault(); return dragHand(e, el); }
      if (e.button !== 0) return;
      const r = el.getBoundingClientRect();
      const f = ev => { let t = Math.max(0, TL.t(ev.clientX - r.left)); if (ev.shiftKey) { t = snapT(t); invOver(); } pendingSeek = t; };
      f(e); capture(el, e, f, () => { if (pendingSeek != null) { GW.seek(pendingSeek); pendingSeek = null; } TL.snapX = null; invOver(); }, true);
    });
    el.addEventListener('dblclick', e => { const r = el.getBoundingClientRect(); const mk = S().markers.find(m => Math.abs(TL.x(m.t) - (e.clientX - r.left)) < 7); if (mk) editMarker(mk); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); GW.menu(e.clientX, e.clientY, [{ label: 'إضافة علامة', action: GW.cmd.marker }, { label: 'مسح كل العلامات', action: GW.cmd.clearMarkers }, '-', { label: 'تحديد الدخول', action: GW.cmd.markIn }, { label: 'تحديد الخروج', action: GW.cmd.markOut }, { label: 'مسح الدخول والخروج', action: GW.cmd.clearIO }]); });
  }
  async function editMarker(m) {
    const body = document.createElement('div'); body.innerHTML = `<label class="fld"><span>الاسم</span><input class="inp" data-k="name" value="${esc(m.name || '')}"></label><label class="fld"><span>ملاحظة</span><textarea class="inp" data-k="note" rows="3">${esc(m.note || '')}</textarea></label><div class="fld"><span>اللون</span><div style="display:flex;gap:6px">${GW.LABEL_SET.map(([n, c]) => `<button class="btn sm" data-c="${c}" style="background:${c};width:22px;padding:0" title="${n}"></button>`).join('')}</div></div>`;
    body.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { m.color = b.dataset.c; body.querySelectorAll('[data-c]').forEach(x => x.style.outline = x === b ? '2px solid #fff' : ''); });
    GW.modal({ title: 'علامة', body, buttons: [{ label: 'حذف العلامة', action: () => { const s = S(); s.markers = s.markers.filter(x => x !== m); GW.commit('حذف علامة'); } }, { label: 'موافق', primary: true, action: () => { m.name = body.querySelector('[data-k=name]').value; m.note = body.querySelector('[data-k=note]').value; GW.commit('تعديل علامة'); } }] });
  }

  /* ---------- hit testing (row-local, index based) ---------- */
  function hit(x, y) {
    const row = TL.rowAt(y); if (!row) return { row: null };
    const t = TL.t(x), pad = 8 / TL.pps();
    let res = null;
    eachTrans(row.tt, row.ti, t - pad, t + pad, o => { if (res) return; const ry = row.y - TL.vs; const a = TL.x(o.t0), b = TL.x(o.t1); if (x >= a - 2 && x <= b + 2 && y - ry <= Math.min(row.h - 4, 18) + 2) { const edge = Math.abs(x - a) < 5 ? 'L' : Math.abs(x - b) < 5 ? 'R' : null; res = { row, tr: o.tr, edge, t }; } });
    if (res) return res;
    const cs = []; eachClip(row.tt, row.ti, t - pad, t + pad, c => { cs.push(c); });
    for (const c of cs) {
      const x0 = TL.x(c.start), x1 = TL.x(c.start + c.dur);
      if (x >= x0 - 5 && x <= x1 + 5) {
        let edge = null; const ew = Math.min(8, (x1 - x0) / 3);
        if (Math.abs(x - x0) <= ew) edge = 'L'; else if (Math.abs(x - x1) <= ew) edge = 'R';
        if (x < x0 && edge !== 'L') continue; if (x > x1 && edge !== 'R') continue;
        const other = edge && cs.find(o => o !== c && (edge === 'R' ? Math.abs(TL.x(o.start) - x1) < 1 : Math.abs(TL.x(o.start + o.dur) - x0) < 1));
        return { row, c, edge, t, other };
      }
    }
    return { row, t };
  }
  const withLinked = (cs) => { const s = S(); const set = new Set(cs); if (TL.linked) cs.forEach(c => GW.linked(s, c).forEach(l => set.add(l))); return [...set]; };

  /* ---------- pointer interaction ---------- */
  function initTracks() {
    const el = TL.tracksEl;
    el.addEventListener('pointermove', e => {
      if (e.buttons) return; const r = tracksRect || (tracksRect = el.getBoundingClientRect()); const x = e.clientX - r.left, y = e.clientY - r.top; const h = hit(x, y);
      const nh = { c: h.c, edge: h.edge, x: TL.tool === 'razor' && h.row ? TL.x(snapT(TL.t(x))) : null };
      const o = TL.hover; if (!o || o.c !== nh.c || o.edge !== nh.edge || o.x !== nh.x || TL.snapX != null) { TL.hover = nh; invOver(); }
      if (TL.tool !== 'razor') TL.snapX = null;
      let cur = { razor: 'crosshair', hand: 'grab', zoom: e.altKey ? 'zoom-out' : 'zoom-in', pen: 'crosshair', text: 'text' }[TL.tool] || 'default';
      if ((TL.tool === 'select' || TL.tool === 'ripple' || TL.tool === 'roll' || TL.tool === 'rate') && (h.edge)) cur = TL.tool === 'roll' ? 'col-resize' : 'ew-resize';
      if ((TL.tool === 'slip' || TL.tool === 'slide') && h.c) cur = 'ew-resize'; if (TL.tool === 'track') cur = 'e-resize';
      setCursor(cur);
    });
    el.addEventListener('pointerleave', () => { if (TL.hover || TL.snapX != null) { TL.hover = null; if (!drag) TL.snapX = null; invOver(); } });
    el.addEventListener('dblclick', e => { const r = el.getBoundingClientRect(); const h = hit(e.clientX - r.left, e.clientY - r.top); if (!h.c) return; if (h.c.kind === 'nest') { GW.stop(); GW.prj.active = h.c.ref; GW.bus.emit('project'); return; } if (h.c.kind === 'map') GW.UI.openMapEditor(h.c); else if (h.c.kind === 'text') { GW.showPanel('graphics'); } else if (h.c.kind === 'shape') { GW.showPanel('fxc'); } else if (h.c.media) { GW.Source.load(GW.media(h.c.media)); } });
    el.addEventListener('contextmenu', e => { e.preventDefault(); const r = el.getBoundingClientRect(); const h = hit(e.clientX - r.left, e.clientY - r.top); clipMenu(e, h); });
    el.addEventListener('pointerdown', e => {
      if (e.button === 1) { e.preventDefault(); return dragHand(e, el); } // middle mouse pans
      if (e.button !== 0) return; el.focus({ preventScroll: true });
      const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const h = hit(x, y); const s = S();
      const tool = e.ctrlKey && TL.tool === 'select' && h.edge ? 'ripple' : TL.tool;
      if (tool === 'hand') return dragHand(e, el);
      if (tool === 'zoom') { TL.zoom(e.altKey ? -1 : 1, x); return; }
      if (h.row && h.row.tr.lock && (h.c || h.tr)) { GW.toast('المسار مقفل'); return; }
      if (tool === 'razor') { if (!h.row) return; const t = snapT(TL.t(x)); const cs = e.shiftKey ? s.clips.filter(c => t > c.start && t < c.start + c.dur && !(s[c.tt + 't'][c.ti] || {}).lock) : (h.c ? withLinked([h.c]) : []); const n = GW.ops.splitGroup(s, cs.filter(c => t > c.start && t < c.start + c.dur), t).length; if (n) GW.commit('قص بأداة الشفرة'); TL.snapX = null; invOver(); return; }
      if (tool === 'track') { const t = TL.t(x); const cs = s.clips.filter(c => (e.shiftKey || (h.row && c.tt === h.row.tt && c.ti === h.row.ti)) && c.start + c.dur > t); if (!e.ctrlKey) GW.sel.clips.clear(); withLinked(cs).forEach(c => GW.sel.clips.add(c.id)); GW.bus.emit('selection'); return dragMove(e, el, x, y, null); }
      if (tool === 'pen' && h.c) return penKey(e, el, h, x, y);
      if (h.tr) { GW.sel.trans = h.tr.id; GW.sel.clips.clear(); GW.bus.emit('selection'); if (h.edge) return dragTransEdge(e, el, h); return; }
      GW.sel.trans = null;
      TL.gap = null;
      if (!h.c) { // empty area → marquee (a plain click selects the gap under the pointer)
        if (!e.shiftKey && !e.ctrlKey) { GW.sel.clips.clear(); GW.bus.emit('selection'); }
        return marquee(e, el, x, y);
      }
      if (h.edge && (tool === 'select' || tool === 'ripple' || tool === 'roll' || tool === 'rate')) return dragEdge(e, el, h, tool);
      if (tool === 'slip') return dragSlip(e, el, h);
      if (tool === 'slide') return dragSlide(e, el, h);
      const group = e.altKey ? [h.c] : withLinked([h.c]);
      if (e.shiftKey || e.ctrlKey) { const on = GW.sel.clips.has(h.c.id); group.forEach(c => on ? GW.sel.clips.delete(c.id) : GW.sel.clips.add(c.id)); }
      else if (!GW.sel.clips.has(h.c.id)) { GW.sel.clips.clear(); group.forEach(c => GW.sel.clips.add(c.id)); }
      GW.sel.mask = null; GW.bus.emit('selection'); TL.invalidate();
      dragMove(e, el, x, y, h);
    });
    el.addEventListener('keydown', e => { if (e.key === 's' && !e.ctrlKey && !e.altKey && !e.metaKey) { TL.snap = !TL.snap; TL.el.querySelector('[data-a=snap]').classList.toggle('on', TL.snap); e.stopPropagation(); GW.toast(TL.snap ? 'المحاذاة: تشغيل' : 'المحاذاة: إيقاف'); } });
    // drop media / effects / sfx
    el.addEventListener('dragover', e => {
      const types = [...e.dataTransfer.types]; const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      if (types.includes('application/x-gws-media')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; const row = TL.rowAt(y); const ids = GW.dragMedia || []; const t = Math.max(0, snapT(TL.t(x))); TL.ghost = ghostFor(ids.map(GW.media).filter(Boolean), t, row); invOver(); }
      else if (types.includes('application/x-gws-fx')) { e.preventDefault(); const h = hit(x, y); if (!TL.hover || TL.hover.c !== h.c) { TL.hover = { c: h.c, fx: true }; invOver(); } }
      else if (types.includes('application/x-gws-sfx')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
      else if (types.includes('application/x-gws-files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } // media browser (ui_browser.js)
    });
    el.addEventListener('dragleave', () => { TL.ghost = null; TL.snapX = null; TL.hover = null; invOver(); });
    el.addEventListener('drop', e => {
      const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      const md = e.dataTransfer.getData('application/x-gws-media'); const fx = e.dataTransfer.getData('application/x-gws-fx');
      TL.ghost = null; TL.snapX = null; TL.hover = null;
      if (md) { e.preventDefault(); const ids = JSON.parse(md); const row = TL.rowAt(y); const t = Math.max(0, snapT(TL.t(x))); TL.snapX = null; const seqs = ids.map(id => GW.prj.seqs.find(q => q.id === id)).filter(Boolean); if (seqs.length) { TL.insertNest(seqs[0], t, row, e.ctrlKey ? 'insert' : 'overwrite'); return; } TL.insertMedia(ids.map(GW.media).filter(Boolean), t, e.ctrlKey ? 'insert' : 'overwrite', { row }); return; }
      if (fx) { e.preventDefault(); const f = JSON.parse(fx); const h = hit(x, y); GW.UI.applyFxTo(f, h.c, h); }
      const bf = e.dataTransfer.getData('application/x-gws-files'); if (bf && GW.Browser) { e.preventDefault(); GW.Browser.dropToTimeline(JSON.parse(bf), Math.max(0, snapT(TL.t(x))), TL.rowAt(y), e.ctrlKey ? 'insert' : 'overwrite'); TL.invalidate(); return; }
      const sfx = e.dataTransfer.getData('application/x-gws-sfx'); if (sfx && GW.SFX) { e.preventDefault(); const it = (GW.SFX.list || []).find(q => q.id === sfx); if (it) GW.SFX.insert(it, Math.max(0, snapT(TL.t(x))), TL.rowAt(y)); }
      TL.invalidate();
    });
  }
  function ghostFor(list, t, row) {
    const out = []; let at = t;
    const vti = row && row.tt === 'v' ? row.ti : TL.target.v, ati = row && row.tt === 'a' ? row.ti : TL.target.a;
    for (const m of list) { const d = m.kind === 'image' ? 5 : (m.dur || 5); if (m.kind !== 'audio') out.push({ tt: 'v', ti: vti, start: at, dur: d }); if (m.hasAudio || m.kind === 'audio') out.push({ tt: 'a', ti: m.kind === 'audio' && row && row.tt === 'a' ? row.ti : ati, start: at, dur: d }); at += d; }
    return out;
  }
  function dragHand(e, el) {
    const x0 = e.clientX, y0 = e.clientY, s0 = S().scroll, v0 = TL.vs; const prev = curCursor; setCursor('grabbing'); anim = null;
    capture(el, e, ev => { const s = S(); s.scroll = Math.max(0, s0 - (ev.clientX - x0) / TL.pps()); setVS(v0 - (ev.clientY - y0)); invView(); }, () => setCursor(TL.tool === 'hand' ? 'grab' : prev));
  }
  function marquee(e, el, x, y) {
    const base = new Set(GW.sel.clips); const tA = TL.t(x), yA = y + TL.vs; let moved = false;
    capture(el, e, ev => {
      const r = el.getBoundingClientRect(); const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top; const xa = TL.x(tA), ya = yA - TL.vs;
      if (!moved && Math.abs(x1 - xa) < 3 && Math.abs(y1 - ya) < 3) return; moved = true;
      TL.marq = { x0: Math.min(xa, x1), x1: Math.max(xa, x1), y0: Math.min(ya, y1), y1: Math.max(ya, y1) };
      const t0 = TL.t(TL.marq.x0), t1 = TL.t(TL.marq.x1);
      GW.sel.clips = new Set(base);
      for (const row of TL.rows()) { const ry = row.y - TL.vs; if (!(ry < TL.marq.y1 && ry + row.h > TL.marq.y0)) continue; eachClip(row.tt, row.ti, t0, t1, c => { GW.sel.clips.add(c.id); }); }
      TL.invalidate();
    }, () => { const was = !!TL.marq; TL.marq = null; if (!was) { GW.seek(Math.max(0, tA)); TL.gap = gapAt(TL.rowAt(yA - TL.vs), tA); } GW.bus.emit('selection'); TL.invalidate(); }, true);
  }
  // the gap between two clips on a track (Premiere: click a gap to select it, Delete ripples it closed)
  function gapAt(row, t) {
    if (!row || t < 0) return null; const s = S(); if (GW.clipAt(s, row.tt, row.ti, t)) return null; const cs = GW.trackClips(s, row.tt, row.ti);
    const prev = cs.filter(c => c.start + c.dur <= t + 1e-6).pop(); const next = cs.find(c => c.start >= t - 1e-6); if (!next) return null;
    return { tt: row.tt, ti: row.ti, t0: prev ? prev.start + prev.dur : 0, t1: next.start };
  }
  TL.gapAt = gapAt;
  // slide: move a clip in time while keeping its length and content; the neighbours absorb the change (their edges trim)
  function dragSlide(e, el, h) {
    const s = S(); const c = h.c; const group = withLinked([c]); const fps = s.fps;
    const st = group.map(x => { const cs = GW.trackClips(s, x.tt, x.ti).filter(o => o !== x && !group.includes(o)); const L = cs.filter(o => o.start + o.dur <= x.start + 1e-6).sort((a, b) => b.start - a.start)[0]; const R = cs.filter(o => o.start >= x.start + x.dur - 1e-6).sort((a, b) => a.start - b.start)[0]; return { x, start: x.start, L, R, L0: L && { dur: L.dur }, R0: R && { start: R.start, dur: R.dur, in: R.in } }; });
    const x0 = e.clientX;
    capture(el, e, ev => {
      let d = (ev.clientX - x0) / TL.pps(); d = Math.round(d * fps) / fps;
      for (const o of st) { // clamp so neither neighbour collapses below one frame or runs out of source media
        if (o.L) d = Math.max(d, -(o.L0.dur - 1 / fps)); else d = Math.max(d, -o.start);
        if (o.R) { d = Math.min(d, o.R0.dur - 1 / fps); const maxIn = GW.maxLen(o.R) - 1 / fps; d = Math.min(d, (maxIn - o.R0.in) / (o.R.speed || 1)); d = Math.max(d, -o.R0.in / (o.R.speed || 1)); }
      }
      for (const o of st) { o.x.start = o.start + d; if (o.L) o.L.dur = o.L0.dur + d; if (o.R) { o.R.start = o.R0.start + d; o.R.dur = o.R0.dur - d; o.R.in = o.R0.in + d * (o.R.speed || 1); } }
      s.t = c.start; TL.invalidate(); GW.invalidate();
    }, () => { TL.snapX = null; GW.commit('انزلاق مع تحريك (Slide)'); }, true);
  }
  function dragMove(e, el, x, y, h) {
    const s = S(); const moving = [...GW.sel.clips].map(id => GW.clipById(id)).filter(c => c && !(s[c.tt + 't'][c.ti] || {}).lock);
    if (!moving.length) return;
    const orig = moving.map(c => ({ c, start: c.start, ti: c.ti }));
    const excl = new Set(moving.map(c => c.id));
    const row0 = TL.rowAt(y); const minStart = Math.min(...orig.map(o => o.start)); const span = Math.max(...orig.map(o => o.start + o.c.dur)) - minStart;
    const tx0 = TL.t(x); let moved = false; const dup = e.altKey;
    capture(el, e, ev => {
      const r = el.getBoundingClientRect(); const xx = ev.clientX - r.left, yy = ev.clientY - r.top;
      if (!moved && Math.abs(xx - x) < 4 && Math.abs(yy - y) < 4) return; moved = true;
      let dt = TL.t(xx) - tx0; let ns = Math.max(0, minStart + dt);
      ns = GW.snapFrame(snapT(ns, excl, [0, span]), s.fps); dt = ns - minStart;
      const row1 = TL.rowAt(yy); let dTrack = 0;
      if (row0 && row1 && row1.tt === row0.tt) dTrack = row1.ti - row0.ti;
      for (const o of orig) { o.c.start = o.start + dt; const nt = o.ti + (o.c.tt === (row0 && row0.tt) ? dTrack : 0); o.c.ti = clamp(nt, 0, (o.c.tt === 'v' ? s.vt : s.at).length - 1); }
      TL.invalidate(); GW.invalidate();
    }, ev => {
      TL.snapX = null;
      if (!moved) { if (h && !ev.shiftKey && !ev.ctrlKey) { GW.sel.clips.clear(); (ev.altKey ? [h.c] : withLinked([h.c])).forEach(c => GW.sel.clips.add(c.id)); GW.bus.emit('selection'); } GW.seek(Math.max(0, tx0)); TL.invalidate(); return; }
      if (dup) { for (const o of orig) { const copy = GW.clone(o.c); copy.id = GW.uid(); s.clips.push(copy); o.c.start = o.start; o.c.ti = o.ti; } }
      const insert = ev.ctrlKey;
      const placed = dup ? s.clips.slice(-orig.length) : orig.map(o => o.c);
      if (dup) { const lm = {}; placed.forEach(c => { if (c.link) c.link = lm[c.link] || (lm[c.link] = GW.uid()); }); GW.sel.clips = new Set(placed.map(c => c.id)); }
      const ex = new Set(placed.map(c => c.id));
      if (insert) { const t0 = Math.min(...placed.map(c => c.start)); const d = Math.max(...placed.map(c => c.start + c.dur)) - t0; const tracks = GW.ops.allTracks(s).filter(([tt, ti]) => !(s[tt + 't'][ti] || {}).lock); for (const [tt, ti] of tracks) { const cr = GW.clipAt(s, tt, ti, t0); if (cr && !ex.has(cr.id) && cr.start < t0) GW.ops.split(s, cr, t0); for (const c of GW.trackClips(s, tt, ti)) if (!ex.has(c.id) && c.start >= t0 - 1e-6) c.start += d; } }
      else for (const c of placed) GW.ops.clear(s, c.tt, c.ti, c.start, c.start + c.dur, ex);
      // drop transitions whose clips are no longer adjacent
      const byId = new Map(s.clips.map(c => [c.id, c]));
      s.trans = s.trans.filter(tr => { const A = tr.a && byId.get(tr.a), B = tr.b && byId.get(tr.b); if (tr.a && !A || tr.b && !B) return false; if (A && B) return Math.abs(A.start + A.dur - B.start) < 1e-3 && A.ti === B.ti && A.ti === tr.ti; const C2 = A || B; return C2.ti === tr.ti; });
      GW.commit(dup ? 'تكرار بالسحب' : insert ? 'تحريك مع إدراج' : 'تحريك'); TL.invalidate();
    }, true);
  }
  function dragEdge(e, el, h, tool) {
    const s = S(); const c = h.c; const edge = h.edge;
    const group = (TL.linked && !e.altKey) ? withLinked([c]) : [c];
    const st = group.map(x => ({ x, start: x.start, dur: x.dur, in: x.in, speed: x.speed || 1 }));
    const neighbor = (x, side) => { const cs = GW.trackClips(s, x.tt, x.ti).filter(o => o !== x && !group.includes(o)); return side === 'R' ? cs.filter(o => o.start >= x.start + x.dur - 1e-6).sort((a, b) => a.start - b.start)[0] : cs.filter(o => o.start + o.dur <= x.start + 1e-6).sort((a, b) => b.start - a.start)[0]; };
    // neighbours never change during the drag: resolve them once
    const nbs = new Map(group.map(x => [x, { L: neighbor(x, 'L'), R: neighbor(x, 'R') }]));
    const rollOther = tool === 'roll' ? h.other || neighbor(c, edge) : null; const ro = rollOther && { start: rollOther.start, dur: rollOther.dur, in: rollOther.in };
    const ripples = [];
    const editT = edge === 'R' ? c.start + c.dur : c.start;
    if (tool === 'ripple') for (const o of s.clips) if (!group.includes(o) && o.start >= editT - 1e-6 && !(s[o.tt + 't'][o.ti] || {}).lock) ripples.push({ o, start: o.start });
    const fps = s.fps; const gids = new Set(group.map(g => g.id));
    capture(el, e, ev => {
      const r = el.getBoundingClientRect(); let t = TL.t(ev.clientX - r.left); t = snapT(t, gids); let d = t - editT;
      d = Math.round(d * fps) / fps;
      for (const o of st) {
        const x = o.x; const maxL = GW.maxLen(x);
        if (tool === 'rate') {
          if (edge === 'R') { const nd = Math.max(1 / fps, o.dur + d); x.dur = nd; x.speed = clamp(o.speed * o.dur / nd, .05, 20); }
          else { const nd = Math.max(1 / fps, o.dur - d); x.start = o.start + o.dur - nd; x.dur = nd; x.speed = clamp(o.speed * o.dur / nd, .05, 20); }
          continue;
        }
        if (edge === 'R') {
          let nd = o.dur + d; const srcEnd = o.in + nd * o.speed; if (srcEnd > maxL) nd = (maxL - o.in) / o.speed;
          if (tool !== 'ripple' && tool !== 'roll') { const nb = nbs.get(x).R; if (nb && o.start + nd > nb.start) nd = nb.start - o.start; }
          if (tool === 'roll' && rollOther) { const lim = ro.start + ro.dur - 1 / fps - o.start; nd = Math.min(nd, lim); const dd = (o.start + nd) - ro.start; if (ro.in + dd * (rollOther.speed || 1) < 0) nd = ro.start - o.start - ro.in / (rollOther.speed || 1); }
          x.dur = Math.max(1 / fps, nd);
        } else {
          let ns = o.start + d; if (ns < 0) ns = 0;
          let nin = o.in + (ns - o.start) * o.speed; if (nin < 0) { ns = o.start - o.in / o.speed; nin = 0; }
          if (tool !== 'ripple' && tool !== 'roll') { const nb = nbs.get(x).L; if (nb && ns < nb.start + nb.dur) { ns = nb.start + nb.dur; nin = o.in + (ns - o.start) * o.speed; } }
          if (ns > o.start + o.dur - 1 / fps) { ns = o.start + o.dur - 1 / fps; nin = o.in + (ns - o.start) * o.speed; }
          const shift = ns - x.start;
          if (tool === 'ripple') { x.in = nin; x.dur = o.dur - (ns - o.start); x.start = o.start; }
          else { x.in = nin; x.dur = o.start + o.dur - ns; x.start = ns; }
          GW.shiftKeys(x, shift);
        }
      }
      if (tool === 'roll' && rollOther) { if (edge === 'R') { const nt = c.start + c.dur; const dd = nt - ro.start; rollOther.start = nt; rollOther.dur = ro.dur - dd; rollOther.in = ro.in + dd * (rollOther.speed || 1); } else { const nt = c.start; rollOther.dur = nt - rollOther.start; } }
      if (tool === 'ripple') { const delta = edge === 'R' ? (c.dur - st[0].dur) : -(c.in - st[0].in) / (st[0].speed); for (const rp of ripples) rp.o.start = Math.max(0, rp.start + delta); if (edge === 'L') { for (const o of st) o.x.start = o.start; } }
      TL.invalidate(); GW.invalidate();
      if (edge === 'L' && tool !== 'ripple') GW.seq().t = c.start; else if (edge === 'R') GW.seq().t = c.start + c.dur - 1 / fps;
    }, () => { TL.snapX = null; GW.commit({ ripple: 'تعديل مع إزاحة', roll: 'تعديل متدحرج', rate: 'تمديد السرعة' }[tool] || 'تشذيب'); }, true);
  }
  function dragSlip(e, el, h) {
    const c = h.c; const s = S(); const x0 = e.clientX, in0 = c.in; const maxL = GW.maxLen(c);
    capture(el, e, ev => { const d = (ev.clientX - x0) / TL.pps() * (c.speed || 1); c.in = clamp(in0 - d, 0, Math.max(0, maxL - c.dur * (c.speed || 1))); s.t = c.start; GW.invalidate(); TL.invalidate(); }, () => GW.commit('انزلاق'));
  }
  function dragTransEdge(e, el, h) {
    const s = S(); const tr = h.tr; const d0 = tr.dur; const x0 = e.clientX;
    capture(el, e, ev => { const d = (ev.clientX - x0) / TL.pps() * (h.edge === 'R' ? 1 : -1) * ((tr.a && tr.b && (tr.align || 'center') === 'center') ? 2 : 1); tr.dur = clamp(d0 + d, 2 / s.fps, 30); TL.invalidate(); GW.invalidate(); }, () => GW.commit('مدة الانتقال'));
  }
  function penKey(e, el, h, x, y) {
    const c = h.c; const row = h.row; const P = c.tt === 'a' ? c.vol : c.opacity; if (!P) return;
    const band = row.h - 2 >= 30 ? NB : row.h - 2;
    const top = () => row.y - TL.vs + 1 + band + 2, bh = row.h - 2 - band - 4;
    const fromY = (yy) => { const f = 1 - (yy - top()) / Math.max(1, bh); return c.tt === 'a' ? clamp(f * 46 - 40, -60, 6) : clamp(f * 100, 0, 100); };
    const lt = TL.t(x) - c.start; let k = P.k && P.k.find(k => Math.abs(TL.x(c.start + k.t) - x) < 6);
    if (!k) { if (!P.k) P.k = []; k = { t: Math.round(lt * S().fps) / S().fps, v: Math.round(fromY(y) * 10) / 10, e: 'linear' }; P.k.push(k); P.k.sort((a, b) => a.t - b.t); }
    TL.invalidate();
    capture(el, e, ev => { const r = el.getBoundingClientRect(); const xx = ev.clientX - r.left, yy = ev.clientY - r.top; k.v = Math.round(fromY(yy) * 10) / 10; if (!ev.shiftKey) k.t = clamp(Math.round((TL.t(xx) - c.start) * S().fps) / S().fps, 0, c.dur); P.k.sort((a, b) => a.t - b.t); TL.invalidate(); GW.invalidate(); GW.bus.emit('param'); }, () => GW.commit('مفتاح حركة'));
  }
  function clipMenu(e, h) {
    const s = S();
    if (h.tr) { GW.sel.trans = h.tr.id; TL.invalidate(); GW.menu(e.clientX, e.clientY, [{ label: 'مدة الانتقال…', action: async () => { const v = await GW.prompt('مدة الانتقال', 'بالثواني', String(h.tr.dur)); if (v) { h.tr.dur = clamp(parseFloat(v) || 1, .04, 30); GW.commit('مدة الانتقال'); } } }, { label: 'المحاذاة', sub: [['center', 'في المنتصف'], ['start', 'تبدأ عند القطع'], ['end', 'تنتهي عند القطع']].map(([v, n]) => ({ label: n, check: (h.tr.align || 'center') === v, action: () => { h.tr.align = v; GW.commit('محاذاة الانتقال'); } })) }, { label: 'نوع الانتقال', sub: Object.entries(h.tr.tt === 'a' ? GW.ATRANS : GW.TRANS).map(([k, v]) => ({ label: v.n, check: h.tr.kind === k, action: () => { h.tr.kind = k; GW.commit('نوع الانتقال'); } })) }, '-', { label: 'حذف', action: () => { s.trans = s.trans.filter(x => x !== h.tr); GW.commit('حذف انتقال'); } }]); return; }
    if (!h.c) { const t = h.t; TL.gap = gapAt(h.row, t); TL.invalidate(); GW.menu(e.clientX, e.clientY, [{ label: 'حذف الفراغ مع إزاحة', key: 'Delete', disabled: !TL.gap, action: () => TL.rippleDeleteGapAtPlayhead(h.row, t) }, '-', { label: 'لصق', action: () => GW.cmd.paste(false) }, { label: 'إضافة علامة', action: GW.cmd.marker }]); return; }
    if (!GW.sel.clips.has(h.c.id)) { GW.sel.clips.clear(); withLinked([h.c]).forEach(c => GW.sel.clips.add(c.id)); GW.bus.emit('selection'); }
    const c = h.c; const Cm = GW.cmd;
    const items = [
      { label: 'قص', key: 'Ctrl+X', action: () => Cm.copy(true) }, { label: 'نسخ', key: 'Ctrl+C', action: () => Cm.copy() }, { label: 'لصق السمات', action: Cm.pasteAttrs }, '-',
      { label: c.on === 0 ? 'تفعيل' : 'تعطيل', key: 'Shift+E', action: Cm.toggleEnable }, { label: c.link ? 'فك الربط' : 'ربط', key: 'Ctrl+L', action: Cm.link }, '-',
      { label: 'السرعة / المدة…', key: 'Ctrl+R', action: Cm.speed }, { label: 'تجميد الإطار عند المؤشر', action: Cm.freeze }, { label: 'إضافة تعديل عند المؤشر', key: 'Ctrl+K', action: () => Cm.addEdit(false) }, '-',
      { label: 'مسح', key: 'Delete', action: () => Cm.del(false) }, { label: 'مسح مع إزاحة', key: 'Shift+Delete', action: () => Cm.del(true) }, '-',
      { label: 'إعادة تسمية…', cmd: 'clip.rename', action: Cm.rename }, { label: 'لون التسمية', sub: GW.LABEL_SET.map(([n, col]) => ({ label: n, action: () => Cm.label(col) })) },
      '-', { label: 'تداخل (Nest)…', cmd: 'seq.nest', action: () => Cm.nest(false) }, { label: 'إنشاء تسلسل فرعي', cmd: 'seq.subseq', action: () => Cm.nest(true) }
    ];
    if (c.motion) items.push('-', { label: 'ملاءمة حجم الإطار', action: () => Cm.fitFrame(false) }, { label: 'ملء الإطار', action: () => Cm.fitFrame(true) });
    if (c.kind === 'map') items.unshift({ label: 'تحرير الخريطة', action: () => GW.UI.openMapEditor(c) }, '-');
    if (c.media) items.push('-', { label: 'عرض في شاشة المصدر', action: () => GW.Source.load(GW.media(c.media)) }, { label: 'إظهار في لوحة المشروع', cmd: 'clip.reveal', action: Cm.reveal });
    for (const f of GW.clipMenuHooks || []) { try { f(items, c, s); } catch (er) { console.error(er); } } // extra entries from tool modules (audio_tools.js …)
    GW.menu(e.clientX, e.clientY, items);
  }

  /* ---------- editing helpers used by commands ---------- */
  TL.insertMedia = (list, t, mode, o = {}) => {
    const s = GW.seq(); if (!list.length) return;
    const ready = list.filter(m => !m.offline && (m.dur || m.kind === 'image'));
    if (!ready.length) { GW.toast('الملف ما زال قيد التجهيز، حاول بعد لحظات'); return; }
    if (!s.clips.length && ready[0].kind === 'video' && ready[0].w && (ready[0].w !== s.w || ready[0].h !== s.h) && (s.h > s.w) === (ready[0].h > ready[0].w)) { s.w = ready[0].w; s.h = ready[0].h; if (ready[0].fps) s.fps = Math.round(ready[0].fps * 100) / 100 > 29 && ready[0].fps < 30 ? 29.97 : Math.round(ready[0].fps); GW.toast(`تم ضبط التسلسل ليطابق المقطع: ${s.w}×${s.h} · ${s.fps} إطار/ث`); }
    const row = o.row; const vti = row && row.tt === 'v' ? row.ti : TL.target.v; const ati = row && row.tt === 'a' ? row.ti : TL.target.a;
    let at = GW.snapFrame(t, s.fps); const added = [];
    for (const m of ready) {
      const inP = o.in ?? 0; const dur = o.dur ?? (m.kind === 'image' ? 5 : Math.max(1 / s.fps, (m.dur || 5) - inP));
      const link = (m.kind === 'video' && m.hasAudio) ? GW.uid() : null;
      const cs = [];
      if (m.kind !== 'audio') { GW.ops.ensureTrack(s, 'v', vti); const c = GW.newClip(m.kind === 'image' ? 'image' : 'video', { media: m.id, name: m.name, ti: vti, start: at, dur, in: inP, sw: m.w || s.w, sh: m.h || s.h, link, label: m.label }); cs.push(c); }
      if (m.hasAudio || m.kind === 'audio') { const ti = m.kind === 'audio' && row && row.tt === 'a' ? row.ti : ati; GW.ops.ensureTrack(s, 'a', ti); const a = GW.newClip('audio', { media: m.id, name: m.name, ti, start: at, dur, in: inP, link, label: m.kind === 'audio' ? m.label : GW.LABELS.audio }); cs.push(a); }
      if (mode === 'insert') GW.ops.rippleInsert(s, at, dur, GW.ops.allTracks(s).filter(([tt, ti]) => !(s[tt + 't'][ti] || {}).lock));
      else for (const c of cs) GW.ops.clear(s, c.tt, c.ti, c.start, c.start + c.dur);
      s.clips.push(...cs); added.push(...cs); at += dur;
    }
    GW.sel.clips = new Set(added.map(c => c.id)); GW.seek(at); TL.invalidate(); TL.ensureVisible(at);
    GW.commit(mode === 'insert' ? 'إدراج' : 'استبدال'); GW.bus.emit('selection');
  };
  TL.insertNest = (sub, t, row, mode) => {
    const s = GW.seq(); if (sub === s) { GW.toast('لا يمكن وضع التسلسل داخل نفسه'); return; }
    const uses = (q, id, d) => d < 6 && q.clips.some(c => c.kind === 'nest' && (c.ref === id || uses(GW.prj.seqs.find(x => x.id === c.ref) || { clips: [] }, id, d + 1)));
    if (uses(sub, s.id, 0)) { GW.toast('لا يمكن: هذا يسبب تداخلًا دائريًا بين التسلسلات'); return; }
    const dur = GW.seqDur(sub); if (dur <= 0) { GW.toast('التسلسل فارغ'); return; }
    const ti = row && row.tt === 'v' ? row.ti : TL.target.v; GW.ops.ensureTrack(s, 'v', ti);
    const c = GW.newClip('nest', { ti, start: GW.snapFrame(t, s.fps), dur, name: sub.name, sw: sub.w, sh: sub.h, label: GW.LABELS.nest });
    c.ref = sub.id; c.vol = GW.P(0); c.motion.scale = GW.P(Math.round(Math.min(s.w / sub.w, s.h / sub.h) * 10000) / 100);
    if (mode === 'insert') GW.ops.rippleInsert(s, c.start, dur, GW.ops.allTracks(s)); else GW.ops.clear(s, 'v', ti, c.start, c.start + dur);
    s.clips.push(c); GW.sel.clips = new Set([c.id]); GW.commit('تسلسل متداخل'); GW.bus.emit('selection');
  };
  TL.dropMediaAt = (list, e) => { const r = TL.tracksEl.getBoundingClientRect(); const row = TL.rowAt(e.clientY - r.top); TL.insertMedia(list, Math.max(0, TL.t(e.clientX - r.left)), 'overwrite', { row }); };
  TL.applyTransitionAtPlayhead = (kind, tt) => {
    const s = GW.seq(); const t = s.t;
    const selC = [...GW.sel.clips].map(id => GW.clipById(id)).filter(c => c && c.tt === tt);
    if (selC.length) { for (const c of selC) addTrans(s, c, kind, t); GW.commit('تطبيق انتقال'); return; }
    const ti = TL.target[tt]; const cs = GW.trackClips(s, tt, ti);
    let best = null, bd = 1e9; for (const c of cs) for (const edge of [c.start, c.start + c.dur]) { const d = Math.abs(edge - t); if (d < bd) { bd = d; best = { c, edge }; } }
    if (!best) { GW.toast('لا يوجد مقطع على المسار المستهدف'); return; }
    addTrans(s, best.c, kind, best.edge, true); GW.commit('تطبيق انتقال');
  };
  function addTrans(s, c, kind, t, atEdge) {
    const end = c.start + c.dur; const useEnd = atEdge ? Math.abs(t - end) < Math.abs(t - c.start) : t > c.start + c.dur / 2;
    const cs = GW.trackClips(s, c.tt, c.ti);
    let a = null, b = null;
    if (useEnd) { a = c; b = cs.find(o => Math.abs(o.start - end) < 1e-3) || null; } else { b = c; a = cs.find(o => Math.abs(o.start + o.dur - c.start) < 1e-3) || null; }
    s.trans = s.trans.filter(x => !(x.tt === c.tt && x.ti === c.ti && ((a && x.a === a.id) || (b && x.b === b.id))));
    const d = Math.min(1, (a ? a.dur : 9) * .9, (b ? b.dur : 9) * .9);
    s.trans.push({ id: GW.uid(), tt: c.tt, ti: c.ti, a: a ? a.id : null, b: b ? b.id : null, kind, dur: Math.max(2 / s.fps, d), align: 'center' });
    TL.invalidate();
  }
  TL.addTransitionAt = (kind, c, side) => { const s = GW.seq(); addTrans(s, c, kind, side === 'R' ? c.start + c.dur : c.start, true); GW.commit('إضافة انتقال'); };
  TL.rippleTrimToPlayhead = (side) => {
    const s = GW.seq(); const t = s.t; const cs = s.clips.filter(c => t > c.start && t < c.start + c.dur && (TL.isTargeted(c) || GW.sel.clips.has(c.id)) && !(s[c.tt + 't'][c.ti] || {}).lock);
    if (!cs.length) return; const group = withLinked(cs);
    if (side === 'start') { const d = t - Math.min(...group.map(c => c.start)); for (const c of group) { const cut = t - c.start; c.in += cut * (c.speed || 1); c.dur -= cut; GW.shiftKeys(c, cut); } const t0 = Math.min(...group.map(c => c.start)); for (const o of s.clips) if (!group.includes(o) && o.start >= t0 + d - 1e-6) o.start -= d; for (const c of group) c.start = t0; s.t = t0; }
    else { const end = Math.max(...group.map(c => c.start + c.dur)); const d = end - t; for (const c of group) c.dur = t - c.start; for (const o of s.clips) if (!group.includes(o) && o.start >= end - 1e-6) o.start -= d; }
    TL.invalidate(); GW.commit('تشذيب مع إزاحة');
  };
  TL.rippleDeleteGapAtPlayhead = (row, tAt) => {
    const s = GW.seq(); const t = tAt ?? s.t; const tt = row ? row.tt : 'v', ti = row ? row.ti : TL.target.v;
    if (GW.clipAt(s, tt, ti, t)) return; const cs = GW.trackClips(s, tt, ti);
    const prev = cs.filter(c => c.start + c.dur <= t + 1e-6).pop(); const next = cs.find(c => c.start >= t - 1e-6);
    if (!next) return; const g0 = prev ? prev.start + prev.dur : 0, g1 = next.start; const d = g1 - g0; if (d <= 0) return;
    for (const c of s.clips) if (c.start < g1 && c.start + c.dur > g0) { GW.toast('لا يمكن حذف الفراغ: توجد مقاطع على مسارات أخرى'); return; }
    for (const c of s.clips) if (c.start >= g1 - 1e-6) c.start -= d; TL.invalidate(); GW.commit('حذف فراغ');
  };

  GW.bus.on('project', () => { TL.gap = null; TL.renderSeqTabs(); TL.renderHeads(); TL.invalidate(); });
  GW.bus.on('changed', () => { TL.renderHeads(); TL.renderSeqTabs(); TL.invalidate(); });
  GW.bus.on('hist', () => { TL.renderHeads(); TL.invalidate(); });
  GW.bus.on('time', () => { D.over = D.rover = true; TL.dirty = true; });
  GW.bus.on('selection', () => { if (GW.sel.clips.size) TL.gap = null; TL.invalidate(); }); GW.bus.on('param', () => TL.invalidate());
  GW.bus.on('peaks', () => TL.invalidate()); GW.bus.on('thumbs', () => TL.invalidate()); GW.bus.on('media-status', () => TL.invalidate());
})();
