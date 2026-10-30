'use strict';
/* GeoWar Atlas — scene model: styles, defaults, layers */
(function () {
  const A = GW.Atlas; const S = A.Scene = {};
  const rgb = (h) => { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  S.rgb = rgb;
  const PAL = {
    vivid: ['#e4572e', '#29a3d6', '#f2c14e', '#5aa469', '#9b5de5', '#f15bb5', '#00bbf9', '#ff924c', '#8ac926'],
    pastel: ['#f3b7a8', '#a8d0e6', '#f6dc9b', '#b5d9a6', '#cdb4e6', '#f2b6cf', '#9ed8db', '#f7c59f', '#c6e2a5'],
    muted: ['#b5523b', '#3f7f9e', '#c79a3a', '#4f8a57', '#7a5c9e', '#a8576f', '#3a8f8a', '#b8743d', '#6f8a3a'],
    sepia: ['#d9a87e', '#a7b78e', '#c9b07a', '#b79a8a', '#9fb3a8', '#d4b896', '#b9a27f', '#c79f8c', '#a9a679'],
    neon: ['#ff2e88', '#29f0ff', '#ffe74c', '#7cff6b', '#b26bff', '#ff8c2e', '#2effa1', '#ff5e5e', '#5e8bff'],
  };
  S.PAL = PAL;
  // style presets. base: tile provider; baseTex: bundled equirect fallback; vector: draw own ocean/land
  S.STYLES = {
    satellite: { ar: 'قمر صناعي (Google Earth)', base: 'esri_img', baseTex: 'sat', grade: { sat: 1.18, bri: 1.04, con: 1.1, gamma: .93 }, border: 'rgba(255,255,255,.72)', bw: 1.1, ink: '#ffffff', halo: 'rgba(0,0,0,.7)', atmo: [.42, .66, 1], stars: .6, space: [.004, .006, .014] },
    s2: { ar: 'قمر صناعي بلا غيوم', base: 's2', baseTex: 'sat', grade: { sat: 1.1, bri: 1.03, con: 1.08 }, border: 'rgba(255,255,255,.7)', bw: 1.1, ink: '#ffffff', halo: 'rgba(0,0,0,.75)', atmo: [.35, .6, 1], stars: .8 },
    ghost: { ar: 'قمر صناعي داكن', base: 'esri_img', baseTex: 'sat', grade: { sat: .12, bri: .58, con: 1.25, tint: [.55, .68, .85], tintAmt: .3 }, border: 'rgba(210,225,245,.5)', bw: 1, ink: '#f1f5fa', halo: 'rgba(0,0,0,.8)', atmo: [.3, .45, .7], stars: .6 },
    daynight: { ar: 'ليل ونهار', base: 'esri_img', baseTex: 'sat', light: 1, grade: { sat: 1.05 }, border: 'rgba(255,255,255,.55)', bw: 1, ink: '#ffffff', halo: 'rgba(0,0,0,.75)', atmo: [.35, .6, 1], stars: 1 },
    night: { ar: 'أضواء الليل', base: 'night', baseTex: 'night', grade: { bri: 1.2, con: 1.1 }, border: 'rgba(150,190,255,.45)', bw: 1, ink: '#e9f1ff', halo: 'rgba(0,0,0,.8)', atmo: [.25, .45, .9], stars: 1 },
    natgeo: { ar: 'ناشيونال جيوغرافيك', base: 'esri_natgeo', baseTex: 'relief', border: 'rgba(110,70,60,.75)', bw: 1, ink: '#1e2a36', halo: 'rgba(255,255,255,.85)', atmo: [.5, .7, 1], stars: .5 },
    physical: { ar: 'طبيعية', base: 'esri_physical', baseTex: 'relief', border: 'rgba(60,50,40,.6)', bw: 1, ink: '#1e2a36', halo: 'rgba(255,255,255,.85)', atmo: [.5, .7, 1], stars: .5 },
    relief: { ar: 'تضاريس مظللة', base: 'esri_relief', baseTex: 'relief', fill: 'political', palette: 'vivid', fillA: .22, border: 'rgba(40,40,40,.6)', bw: 1, ink: '#14202c', halo: 'rgba(255,255,255,.85)', atmo: [.5, .7, 1], stars: .5 },
    topo: { ar: 'طبوغرافية', base: 'esri_topo', baseTex: 'relief', border: 'rgba(120,60,120,.6)', bw: 1, ink: '#1e2a36', halo: 'rgba(255,255,255,.85)', atmo: [.5, .7, 1] },
    streets: { ar: 'شوارع', base: 'esri_street', border: 'rgba(120,60,120,.5)', bw: 1, ink: '#1e2a36', halo: 'rgba(255,255,255,.85)', atmo: [.5, .7, 1] },
    oceans: { ar: 'محيطات وأعماق', base: 'esri_ocean', baseTex: 'relief', border: 'rgba(60,70,80,.6)', bw: 1, ink: '#1e2a36', halo: 'rgba(255,255,255,.85)', atmo: [.5, .7, 1] },
    carto_dark: { ar: 'داكنة بسيطة', base: 'carto_dark', border: 'rgba(160,175,200,.55)', bw: 1, ink: '#e8edf3', halo: 'rgba(0,0,0,.8)', atmo: [.25, .35, .55], space: [.01, .012, .018], stars: .4 },
    voyager: { ar: 'فاتحة ملونة', base: 'carto_voyager', border: 'rgba(120,90,110,.6)', bw: 1, ink: '#1c2630', halo: 'rgba(255,255,255,.9)', atmo: [.55, .72, 1] },
    ops: { ar: 'غرفة العمليات', vector: 1, ocean: '#0a1119', ocean2: '#0f1a26', land: '#1c2532', border: '#4b5d75', bw: 1, coast: '#64799a', hill: .4, ink: '#eef2f7', halo: 'rgba(5,8,12,.85)', atmo: [.25, .38, .6], stars: .5, space: [.006, .008, .014] },
    news: { ar: 'نشرة أخبار فاتحة', vector: 1, ocean: '#cbd8e4', ocean2: '#b9c9d8', land: '#f8f6f1', border: '#9eaab7', bw: 1, coast: '#8798a9', hill: .22, ink: '#16202a', halo: 'rgba(255,255,255,.92)', atmo: [.6, .75, .95], bgFlat: '#cbd8e4', space: [.85, .89, .93], space2: [.75, .8, .87] },
    newsdark: { ar: 'نشرة أخبار داكنة', vector: 1, ocean: '#0e1d31', ocean2: '#132742', land: '#2b3a52', border: '#8ea2bd', bw: 1, coast: '#9db2cc', hill: .3, ink: '#f4f7fb', halo: 'rgba(5,10,20,.85)', atmo: [.3, .5, .9], stars: .3 },
    political: { ar: 'سياسية ملونة', vector: 1, ocean: '#a7c8de', ocean2: '#94b9d3', land: '#efe9da', fill: 'political', palette: 'pastel', fillA: .95, border: '#ffffff', bw: 1.2, coast: '#5e819b', hill: .28, ink: '#1b2530', halo: 'rgba(255,255,255,.85)', atmo: [.55, .72, 1], bgFlat: '#a7c8de' },
    history: { ar: 'تاريخية داكنة', vector: 1, ocean: '#17283a', ocean2: '#1d3248', land: '#3b4047', fill: 'empire', palette: 'muted', fillA: .9, border: 'rgba(15,15,15,.6)', bw: 1, coast: '#0d1620', hill: .45, ink: '#f4efe6', halo: 'rgba(10,12,16,.85)', atmo: [.35, .5, .75], stars: .4 },
    parchment: { ar: 'خريطة قديمة', vector: 1, ocean: '#c9b48a', ocean2: '#b9a074', land: '#efe0bb', fill: 'empire', palette: 'sepia', fillA: .8, border: '#7a5a35', bw: 1, coast: '#5a4225', hill: .35, ink: '#2e2110', halo: 'rgba(245,235,210,.85)', font: 'Amiri', atmo: [.8, .7, .5], post: { paper: 1, sepia: .3, vig: .55 }, bgFlat: '#c9b48a', space: [.16, .12, .07] },
    blueprint: { ar: 'مخطط أزرق', vector: 1, ocean: '#0f3a6b', ocean2: '#0a2c55', land: 'rgba(160,200,255,.07)', border: '#8db8f0', bw: 1, coast: '#d7e8ff', grid: 1, gridC: 'rgba(190,220,255,.18)', ink: '#eef5ff', halo: 'rgba(8,36,72,.9)', atmo: [.55, .75, 1], bgFlat: '#0a2c55', space: [.02, .1, .2] },
    neon: { ar: 'نيون', vector: 1, ocean: '#05040c', ocean2: '#0b0920', land: '#0c0b1e', fill: 'political', palette: 'neon', fillA: .12, border: '#7a5cff', bw: 1.1, glow: 1, coast: '#38e1ff', ink: '#eeeaff', halo: 'rgba(10,8,26,.9)', atmo: [.48, .36, 1], stars: .8, grid: 1, gridC: 'rgba(122,92,255,.12)' },
    desert: { ar: 'عمليات صحراوية', vector: 1, ocean: '#151a16', ocean2: '#1d241e', land: '#6d6047', border: '#a69169', bw: 1, coast: '#cdb98e', hill: .5, ink: '#f5ecd8', halo: 'rgba(24,22,16,.85)', atmo: [.75, .65, .45], stars: .4 },
  };
  S.STYLE_ORDER = ['satellite', 's2', 'ghost', 'daynight', 'night', 'natgeo', 'physical', 'relief', 'topo', 'oceans', 'carto_dark', 'voyager', 'political', 'history', 'parchment', 'news', 'newsdark', 'ops', 'desert', 'blueprint', 'neon', 'streets'];

  S.blank = () => ({
    v: 3, mode: 'globe', style: 'satellite', year: GW.P(2025), eraMode: 'auto',
    cam: { lon: 42, lat: 26, zoom: 3.2, tilt: 0, heading: 0, keys: [], orbit: 0, drift: 0, shake: 0 },
    look: { lang: (window.GW && GW.lang) || 'ar', font: '', labels: 1, labelSize: 1, countryLabels: 1, cities: 1, oceans: 1, regions: 0, provinces: 0, rivers: 0, lakes: 1, borders: 1, coast: 1, graticule: 0, hill: null, fill: null, fillA: null, atmo: 1, stars: null, light: 0, sunLon: 20, sunLat: 10, vig: .3, grain: .04, paper: null, letter: 0, quality: 1, refLabels: 0, sat: 1, bri: 1, attrib: 1, borderW: 1 },
    layers: [], images: {}
  });
  S.normalize = (sc) => {
    const b = S.blank(); if (!sc || sc.v !== 3) return b;
    const o = Object.assign(b, sc); o.cam = Object.assign(S.blank().cam, sc.cam || {}); o.look = Object.assign(S.blank().look, sc.look || {}); o.layers = sc.layers || []; o.images = sc.images || {};
    if (typeof o.year === 'number') o.year = GW.P(o.year);
    return o;
  };
  // effective look = style defaults overridden by non-null look fields
  S.eff = (sc) => {
    const st = S.STYLES[sc.style] || S.STYLES.satellite; const L = sc.look;
    const pick = (k, d) => L[k] != null ? L[k] : d;
    return {
      st, vector: !!st.vector, base: st.base || null, baseTex: st.baseTex || null,
      fill: pick('fill', st.fill || 'none'), fillA: pick('fillA', st.fillA != null ? st.fillA : .4), palette: PAL[st.palette || 'vivid'],
      hill: pick('hill', st.hill || 0), stars: pick('stars', st.stars || 0), font: L.font || st.font || 'Cairo',
      post: { vig: L.vig, grain: L.grain, paper: L.paper != null ? L.paper : ((st.post || {}).paper || 0), sepia: (st.post || {}).sepia || 0, letter: L.letter || 0 },
      grade: Object.assign({ sat: 1, bri: 1, con: 1 }, st.grade || {}),
    };
  };

  /* ---------- layers ---------- */
  S.LAYERS = {
    country: { ar: 'تمييز دول', icon: 'flag' },
    invasion: { ar: 'غزو / هجوم', icon: 'swords' },
    arrow: { ar: 'سهم تحرك', icon: 'arrow' },
    front: { ar: 'خط جبهة / منطقة', icon: 'area' },
    route: { ar: 'مسار متحرك', icon: 'plane' },
    marker: { ar: 'علامة / أيقونة', icon: 'pin' },
    label: { ar: 'نص على الخريطة', icon: 'text' },
    image: { ar: 'صورة شخصية', icon: 'image' },
    range: { ar: 'دائرة مدى', icon: 'range' },
    data: { ar: 'بيانات ملونة (إحصاءات)', icon: 'data' },
    inset: { ar: 'خريطة مصغرة (موقع)', icon: 'globe' },
    date: { ar: 'عداد التاريخ', icon: 'clock' },
    legend: { ar: 'مفتاح الخريطة', icon: 'legend' },
    title: { ar: 'عنوان', icon: 'title' },
  };
  S.newLayer = (type, o = {}) => {
    const base = { id: GW.uid(), type, name: S.LAYERS[type].ar, on: 1, start: 0, dur: null, in: 'fade', inDur: .8, out: 'none', outDur: .5 };
    const D = {
      country: { keys: [], color: '#e5243b', fill: .55, pattern: 'solid', stroke: 2, glow: 1, label: 1, dim: 0, pulse: 0, in: 'fade' },
      invasion: { from: null, to: [], color: '#e5243b', arrows: 1, arrowStyle: 'military', spread: 1, occupy: 1, impacts: 1, label: 1, dur: null, inDur: 4, curve: .25, width: 1, in: 'grow' },
      arrow: { pts: [], color: '#e5243b', width: 1, style: 'military', curve: 0, outline: 1, glow: 1, head: 1, in: 'draw', inDur: 2 },
      front: { keys: [], pts: [], color: '#e5243b', fill: .45, pattern: 'hatch', stroke: 2, teeth: 1, in: 'fade', inDur: 1 },
      route: { pts: [], color: '#ffffff', icon: 'plane', width: 1, dashed: 1, trail: 1, in: 'draw', inDur: 3, size: 1 },
      marker: { lon: 0, lat: 0, icon: 'explosion', color: '#ff3b30', size: 1, text: '', textPos: 'right', pulse: 1, in: 'pop', inDur: .5 },
      label: { lon: 0, lat: 0, text: 'نص', size: 1, color: '#ffffff', style: 'outline', spacing: 0, in: 'fade' },
      image: { lon: 0, lat: 0, img: null, shape: 'circle', size: 1, ring: '#e5243b', name: 'الاسم', sub: '', plate: 1, dy: -1, in: 'pop', inDur: .6 },
      data: { data: 'السعودية, 35\nمصر, 105\nتركيا, 85\nإيران, 88\nالعراق, 43', c0: '#fde68a', c1: '#b91c1c', fill: .85, values: 1, legend: 1, title: 'عدد السكان (مليون)', prefix: '', suffix: '', in: 'grow', inDur: 2 },
      inset: { pos: 'tl', size: 1, color: '#e5243b', mark: '#ffd34d', text: '', in: 'pop', inDur: .6 },
      range: { lon: 0, lat: 0, km: 500, color: '#ff3b30', fill: .12, rings: 3, pulse: 1, text: '', in: 'grow', inDur: 1.2 },
      date: { pos: 'tr', format: 'auto', size: 1, color: '#ffffff', plate: 1, in: 'fade' },
      legend: { items: [{ color: '#e5243b', text: 'المهاجم' }, { color: '#1fb6ff', text: 'المدافع' }], pos: 'bl', in: 'fade' },
      title: { text: 'عنوان الخريطة', sub: '', template: 'breaking', color: '#e5243b', in: 'wipe' },
    }[type] || {};
    return Object.assign(base, GW.clone(D), o);
  };
  // animation state of a layer at scene time t (clip-local) for clip duration cd
  S.state = (L, t, cd) => {
    if (!L.on) return null; const lt = t - (L.start || 0); if (lt < 0) return null;
    const dur = L.dur != null ? L.dur : Math.max(0, cd - (L.start || 0)); if (lt > dur + 1e-6) return null;
    const pin = L.in && L.in !== 'none' ? Math.max(0, Math.min(1, lt / Math.max(.01, L.inDur || .8))) : 1;
    const pout = L.out && L.out !== 'none' ? Math.max(0, Math.min(1, (dur - lt) / Math.max(.01, L.outDur || .5))) : 1;
    return { lt, dur, pin, pout, a: pout };
  };
  S.ease = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  S.easeOut = (t) => 1 - Math.pow(1 - t, 3);
  S.back = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
})();
