'use strict';
/* GeoWar Atlas — war campaigns and combat animations (loaded after vector.js).
   Layer types: campaign (factions + timed captures of provinces / cities / drawn regions), clash, strike, troops, air,
   encircle, siege; front «هجوم» mode; leader banner style «راية» and leader moves to cities.
   Everything is a pure function of the clip time t (particles are seeded by index), so preview == export. */
(function () {
  const A = GW.Atlas, G = A.Geo, S = A.Scene, V = A.Vec, Cm = A.Cam;
  const WR = A.War = { fast: false };
  const RAD = Math.PI / 180, DEG = 180 / Math.PI, TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgba = V.rgba, shade = V.shade;
  const isAr = (s) => /[؀-ۿ]/.test(s || '');
  const hex2 = (n) => ('0' + clamp(Math.round(n * 255), 0, 255).toString(16)).slice(-2);
  const mix = (a, b, t) => { const x = S.rgb(a), y = S.rgb(b); return '#' + [0, 1, 2].map(i => hex2(x[i] + (y[i] - x[i]) * t)).join(''); };
  WR.mix = mix;
  // deterministic hash → [0,1)
  const rnd = (a, b, c) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const strSeed = (s) => { let h = 2166136261; for (const ch of String(s || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  WR.rnd = rnd;
  const smooth = (x) => x * x * (3 - 2 * x);

  /* ================= layer types ================= */
  Object.assign(S.LAYERS, {
    campaign: { ar: 'حملة عسكرية / حرب بين دولتين', icon: 'swords' },
    clash: { ar: 'اشتباك', icon: 'swords' },
    strike: { ar: 'قصف مدفعي / صاروخي', icon: 'target' },
    troops: { ar: 'تحرك قوات', icon: 'arrow' },
    air: { ar: 'غارة جوية', icon: 'plane' },
    encircle: { ar: 'تطويق مدينة', icon: 'range' },
    siege: { ar: 'حصار', icon: 'clock' },
  });
  WR.TYPES = ['campaign', 'clash', 'strike', 'troops', 'air', 'encircle', 'siege'];
  const DEF = {
    campaign: { sides: [], units: [], events: [], cities: [], cityR: 18, legend: 1, legendPos: 'tl', legendTitle: '', captions: 1, showCities: 1, flip: 1, borders: 1, labels: 1, in: 'fade', inDur: 1 },
    clash: { lon: 0, lat: 0, color: '#ffb347', size: 1, intensity: 1, swords: 1, smoke: 1, sparks: 1, rings: 1, text: '', in: 'pop', inDur: .5 },
    strike: { pts: [], color: '#ffcf6b', kind: 'missile', count: 4, interval: .55, flight: 1.5, arc: .3, spread: 6, trail: 1, crater: 1, shake: 0, in: 'none' },
    troops: { pts: [], color: '#b3261e', icon: 'armor', count: 3, spacing: .7, travel: 5, size: 1, dust: 1, route: 1, in: 'none' },
    air: { pts: [], color: '#e8eef5', icon: 'jet', count: 2, spacing: .45, travel: 4, bombs: 5, size: 1, in: 'none' },
    encircle: { lon: 0, lat: 0, km: 60, dir: 270, color: '#b3261e', close: 3, text: '', in: 'none' },
    siege: { lon: 0, lat: 0, km: 30, color: '#b3261e', days: 30, d0: 1, countdown: 0, label: 'اليوم {n} من الحصار', text: '', in: 'fade' },
  };
  WR.DEF = DEF;
  const nl0 = S.newLayer;
  S.newLayer = (type, o = {}) => DEF[type] ? nl0(type, Object.assign(GW.clone(DEF[type]), o)) : nl0(type, o);

  /* ================= render plumbing ================= */
  // fast flag (interactive preview) and screen-shake via the camera
  const render0 = A.render;
  A.render = (scene, t, W, H, opts = {}) => { WR.fast = !!opts.fast; WR.exporting = !!opts.exporting; return render0(scene, t, W, H, opts); };
  const ensure0 = A.ensure;
  A.ensure = async (scene, t, W, H, opts = {}) => { if (WR.needsA1(scene)) await WR.loadA1().catch(() => {}); return ensure0(scene, t, W, H, opts); };
  const evalAt0 = A.evalAt;
  A.evalAt = (sc, t, W, H) => {
    const r = evalAt0(sc, t, W, H); const sh = WR.shakeAt(sc, t);
    if (sh && (sh[0] || sh[1])) {
      const cam = Object.assign({}, r.cam); const k = Cm.upp(cam.zoom, cam.lat) * Cm.REF_H / H * DEG; // degrees per screen px
      const hd = (+cam.heading || 0) * RAD; const dx = sh[0] * Math.cos(hd) - sh[1] * Math.sin(hd), dy = sh[0] * Math.sin(hd) + sh[1] * Math.cos(hd);
      cam.lon += dx * k / Math.max(.2, Math.cos(cam.lat * RAD)); cam.lat = clamp(cam.lat - dy * k, -85, 85);
      r.cam = cam; r.vw = Cm.build(cam, W, H, sc.mode);
    }
    return r;
  };
  // sum of decaying jolts from every impact with shake enabled (screen px at 1080p)
  WR.shakeAt = (sc, t) => {
    let x = 0, y = 0;
    for (const L of sc.layers || []) {
      if (!L.on) continue; const lt = t - (L.start || 0); if (lt < 0) continue;
      const add = (ti, amp, seed) => { const a = lt - ti; if (a < 0 || a > .7) return; const e = Math.pow(1 - a / .7, 2) * amp; x += e * Math.sin(a * 63 + seed); y += e * Math.cos(a * 51 + seed * 1.7); };
      if (L.type === 'strike' && L.shake > 0) { const n = L.count || 1; for (let i = 0; i < n; i++) add(i * (L.interval || .5) + (L.flight || 1.5), 9 * L.shake, i * 3.1); }
      if (L.type === 'campaign') for (const ev of L.events || []) if (ev.fx === 'strike' && ev.shake) for (let i = 0; i < 3; i++) add(ev.t - .9 + i * .45 + 1.1, 7 * ev.shake, i * 2.3);
    }
    return x || y ? [x, y] : null;
  };
  // per-frame registry (banners stacking)
  V.hooks.fill.push((HK) => { WR.banners = []; WR.HK = HK; });

  /* ================= admin-1 topology (faction borders) ================= */
  WR.loadA1 = () => WR._a1 || (WR._a1 = G.loadAdmin1().then(() => G.files['admin1.json']).then(t => {
    WR.a1topo = t; const geoms = t.objects.p.geometries; WR.a1idx = new Map(geoms.map((g, i) => [g, i]));
    WR.a1byKey = new Map(G.admin1.map((f, i) => [f.key, i])); if (A.onAsset) A.onAsset();
  }));
  WR.needsA1 = (sc) => (sc.layers || []).some(L => L.type === 'campaign' && L.on);
  WR.provinces = (cc) => (G.admin1 || []).filter(f => f.properties.cc === cc && f.en !== 'UNDOF');
  WR.cities = (cc) => (G.places || []).filter(p => p[7] === cc).sort((a, b) => a[4] - b[4] || b[5] - a[5]);
  WR.cityRec = (p) => ({ key: 'C:' + p[2] + ':' + p[7], n: p[2], a: p[3] || p[2], lon: p[0], lat: p[1], cc: p[7], cap: p[6] & 1 ? 1 : 0, rank: p[4] });
  const ccOf = (f) => f ? (f.src === 'modern' ? f.key : (f.properties.k || f.key)) : null;
  WR.ccOf = ccOf;

  /* ================= every era: entities (merged pieces) + cities of an entity ================= */
  // historical-basemaps snapshots split an empire into several features sharing one key: merge them into one MultiPolygon
  const grpCache = new WeakMap();
  WR.groups = (feats) => {
    if (!feats) return new Map(); let g = grpCache.get(feats); if (g) return g; g = new Map(); const by = new Map();
    for (const f of feats) { const a = by.get(f.key); a ? a.push(f) : by.set(f.key, [f]); }
    for (const [k, fs] of by) {
      if (fs.length === 1) { g.set(k, fs[0]); continue; }
      const coords = []; for (const f of fs) { const gm = f.geometry; if (!gm) continue; if (gm.type === 'Polygon') coords.push(gm.coordinates); else if (gm.type === 'MultiPolygon') coords.push(...gm.coordinates); }
      const big = fs.slice().sort((a, b) => (b.area || 0) - (a.area || 0))[0];
      const m = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: coords }, properties: big.properties, key: k, src: big.src, en: big.en, ar: big.ar, lab: big.lab, area: fs.reduce((s, f) => s + (f.area || 0), 0), ci: big.ci, cs: big.cs, merged: fs.length };
      m.bounds = d3.geoBounds(m); let r = 0; for (const f of fs) r = Math.max(r, d3.geoDistance(m.lab, f.lab) + f.rad); m.rad = Math.min(Math.PI, r); g.set(k, m);
    }
    grpCache.set(feats, g); return g;
  };
  // sorted list of the political entities that exist at an era: [{key, name, en, f, area}]
  WR.entities = (era, lang = 'ar') => {
    const fs = G.features(era, 0); if (!fs) return []; const g = WR.groups(fs); const out = [];
    for (const [k, f] of g) { const ar = G.name(f, 'ar', era); if (!ar && !f.en) continue; out.push({ key: k, name: lang === 'en' ? f.en : ar, ar, en: f.en, f, area: f.area || d3.geoArea(f) * 1e4 }); }
    return out.sort((a, b) => b.area - a.area);
  };
  WR.entitySearch = (era, q, limit = 80) => { const n = G.norm(q); const all = WR.entities(era); if (!n) return all.slice(0, limit); const sc = (s) => { const t = G.norm(s); return !t ? 0 : t === n ? 100 : t.startsWith(n) ? 70 : t.includes(n) ? 40 : 0; }; return all.map(e => [Math.max(sc(e.ar), sc(e.en)), e]).filter(x => x[0]).sort((a, b) => b[0] - a[0] || b[1].area - a[1].area).slice(0, limit).map(x => x[1]); };
  // historical / renamed cities (modern places.json has today's names): [lon, lat, ar, en, from, to, capital]
  WR.HIST_CITIES = [
    [28.974, 41.018, 'القسطنطينية', 'Constantinople', 330, 1922, 1, [[1204, 'Byzantine Empire'], [1261, 'Latin Empire'], [1453, 'Byzantine Empire'], [1922, 'Ottoman Empire']]], [28.974, 41.018, 'بيزنطة', 'Byzantium', -660, 329, 0], [44.58, 33.09, 'المدائن (طيسفون)', 'Ctesiphon', -120, 637, 1],
    [44.42, 32.54, 'بابل', 'Babylon', -1900, -100, 1], [43.15, 36.36, 'نينوى', 'Nineveh', -1800, -612, 1], [52.89, 29.93, 'برسبوليس', 'Persepolis', -515, -330, 1], [10.32, 36.85, 'قرطاج', 'Carthage', -800, 698, 1],
    [36.16, 36.2, 'أنطاكية', 'Antioch', -300, 1268, 0], [31.23, 30.0, 'الفسطاط', 'Fustat', 641, 1168, 1], [44.4, 32.03, 'الكوفة', 'Kufa', 638, 1300, 0], [38.79, 37.16, 'الرها', 'Edessa', -300, 1637, 0],
    [29.72, 40.43, 'نيقية', 'Nicaea', -300, 1331, 0], [38.27, 34.55, 'تدمر', 'Palmyra', -100, 273, 1], [44.4, 31.88, 'الحيرة', 'Al-Hira', 200, 640, 1], [61.84, 37.66, 'مرو', 'Merv', -300, 1221, 0],
    [19.04, 47.5, 'بودا', 'Buda', 1200, 1873, 1], [30.31, 59.94, 'لينينغراد', 'Leningrad', 1924, 1991, 0], [44.5, 48.7, 'ستالينغراد', 'Stalingrad', 1925, 1961, 0], [106.8, -6.13, 'باتافيا', 'Batavia', 1619, 1942, 1],
    [-99.13, 19.43, 'تينوتشتيتلان', 'Tenochtitlan', 1325, 1521, 1], [31.25, 29.85, 'منف', 'Memphis', -3000, -300, 1], [32.64, 25.7, 'طيبة', 'Thebes', -2000, -300, 1], [46.1, 30.96, 'أور', 'Ur', -3000, -500, 1],
    [43.26, 35.46, 'آشور', 'Assur', -2500, -612, 1], [48.25, 32.19, 'سوسة (شوش)', 'Susa', -4000, -300, 1], [39.61, 24.47, 'يثرب', 'Yathrib', -600, 621, 0], [43.87, 34.2, 'سامراء', 'Samarra', 836, 892, 1],
    [-4.78, 37.88, 'قرطبة', 'Cordoba', 711, 1236, 1], [-3.6, 37.18, 'غرناطة', 'Granada', 1013, 1492, 1], [-4.02, 39.86, 'طليطلة', 'Toledo', 711, 1085, 0], [12.5, 41.9, 'روما', 'Rome', -750, 3000, 1],
    [35.23, 31.78, 'القدس', 'Jerusalem', -1000, 3000, 0], [35.08, 32.93, 'عكا', 'Acre', -1000, 3000, 0], [36.29, 33.51, 'دمشق', 'Damascus', -1000, 3000, 1], [37.16, 36.2, 'حلب', 'Aleppo', -1000, 3000, 0],
    [44.39, 33.34, 'بغداد', 'Baghdad', 762, 3000, 1], [31.24, 30.04, 'القاهرة', 'Cairo', 969, 3000, 1], [29.92, 31.2, 'الإسكندرية', 'Alexandria', -331, 3000, 0], [26.55, 41.68, 'أدرنة', 'Edirne', 1365, 3000, 0],
    [29.06, 40.19, 'بورصة', 'Bursa', 1326, 3000, 0], [39.72, 41.0, 'طرابزون', 'Trebizond', 1204, 3000, 0], [46.29, 38.08, 'تبريز', 'Tabriz', 1250, 3000, 0], [51.67, 32.65, 'أصفهان', 'Isfahan', 1000, 3000, 0],
    [66.97, 39.65, 'سمرقند', 'Samarkand', -500, 3000, 0], [62.2, 34.35, 'هرات', 'Herat', -500, 3000, 0], [16.37, 48.21, 'فيينا', 'Vienna', 1100, 3000, 0], [20.46, 44.82, 'بلغراد', 'Belgrade', 800, 3000, 0], [23.73, 37.98, 'أثينا', 'Athens', -1400, 3000, 0],
  ];
  // cities inside an entity at a year (modern ISO lists when available, else geographic containment + historical names)
  WR.citiesOf = (f, era, year, limit = 400) => {
    if (!f) return []; const y = year != null ? year : era.y != null ? era.y : era.d ? Math.floor(era.d / 10000) : 2025;
    const cc = ccOf(f); if (era.src !== 'hist' && cc && /^[A-Z]{3}$/.test(cc)) { const l = WR.cities(cc); if (l.length) return l.slice(0, limit).map(WR.cityRec); }
    const b = f.bounds; const inB = (lon, lat) => { const [w, s] = b[0], [e, n] = b[1]; if (lat < s - .3 || lat > n + .3) return false; return w <= e ? lon >= w - .3 && lon <= e + .3 : lon >= w - .3 || lon <= e + .3; };
    const inF = (lon, lat) => inB(lon, lat) && (d3.geoContains(f, [lon, lat]) || G.hit([f], [lon, lat]));
    const verts = []; { const gm = f.geometry; const cs = gm.type === 'Polygon' ? [gm.coordinates] : gm.coordinates; for (const poly of cs) { const r = poly[0]; const st = Math.max(1, Math.floor(r.length / 400)); for (let i = 0; i < r.length; i += st) verts.push(r[i]); } }
    // simplified snapshots can miss a coastal city by a few km: accept it when it lies in no entity and the nearest one is this
    const nearF = (lon, lat) => { let bd = 9; for (const v of verts) { const d = d3.geoDistance(v, [lon, lat]); if (d < bd) bd = d; } if (bd > 90 / 6371) return false; const all = G.features(era, 0) || []; return !G.hit(all, [lon, lat]); };
    const out = []; for (const h of WR.HIST_CITIES) if (y >= h[4] && y <= h[5] && (inF(h[0], h[1]) || (h[7] ? (h[7].find(o => y <= o[0]) || [])[1] === f.en : nearF(h[0], h[1])))) out.push({ key: 'H:' + h[3], n: h[3], a: h[2], lon: h[0], lat: h[1], cc: f.key, cap: h[6], rank: 0, hist: 1 });
    const near = (p) => out.some(c => Math.abs(c.lon - p[0]) < .3 && Math.abs(c.lat - p[1]) < .3);
    const maxRank = era.src === 'hist' ? (y < 1500 ? 3 : 5) : 8;
    for (const p of G.places || []) { if (p[4] > maxRank || !inF(p[0], p[1]) || near(p)) continue; out.push(WR.cityRec(p)); if (out.length > limit) break; }
    return out.sort((a, b) => (b.hist || 0) - (a.hist || 0) || b.cap - a.cap || a.rank - b.rank);
  };
  WR.citySearch = (q, era, year, f, limit = 8) => { const n = G.norm(q); const pool = f ? WR.citiesOf(f, era, year) : []; const sc = (s) => { const t = G.norm(s); return !t ? 0 : t === n ? 100 : t.startsWith(n) ? 70 : t.includes(n) ? 40 : 0; }; const r = pool.map(c => [Math.max(sc(c.a), sc(c.n)), c]).filter(x => x[0] || !n); if (r.length || !n) return r.sort((a, b) => b[0] - a[0]).slice(0, limit).map(x => x[1]); const y = year != null ? year : 2025; const hs = WR.HIST_CITIES.filter(h => y >= h[4] && y <= h[5] && (sc(h[2]) || sc(h[3]))).map(h => ({ key: 'H:' + h[3], n: h[3], a: h[2], lon: h[0], lat: h[1], cap: h[6], rank: 0, hist: 1 })); const ps = (G.places || []).filter(p => sc(p[2]) || sc(p[3])).sort((a, b) => a[4] - b[4]).slice(0, limit).map(WR.cityRec); return hs.concat(ps).slice(0, limit); };

  /* ================= campaign model ================= */
  // unit = a piece of territory: an admin-1 province (modern/cs eras), a whole country (historical eras) or a drawn region
  const models = new Map();
  function sideOf(L, id) { return (L.sides || []).find(s => s.id === id) || null; }
  WR.model = (L, era, byKey, feats) => {
    const grp = WR.groups(feats || G.features(era, 0)); const fOf = (k) => grp.get(k) || byKey.get(k);
    const sig = era.id + '|' + JSON.stringify([L.sides, L.units, (L.events || []).map(e => [e.units, e.cities && e.cities.map(c => c.key + (c.r || '')), e.from, e.to, e.kind, e.line]), L.cities, !!G.admin1, !!WR.a1topo, byKey.size, grp.size]);
    let m = models.get(L.id); if (m && m.sig === sig) return m;
    m = { sig, units: new Map(), cities: new Map(), split: new Set(), customs: [] };
    const canSplit = era.src !== 'hist' && G.admin1 && WR.a1topo;
    const addU = (key, f, side, kind, name) => { if (m.units.has(key)) return m.units.get(key); const u = { key, f, side0: side, kind, name: name || (f && (f.ar || f.en)) || key, area: f ? d3.geoArea(f) : 0, lab: f ? f.lab : [0, 0], rad: f ? f.rad : 0 }; if (u.area > 2 * Math.PI) u.area = 4 * Math.PI - u.area; m.units.set(key, u); return u; };
    for (const sd of L.sides || []) for (const ck of sd.countries || []) {
      const f = fOf(ck); const cc = ccOf(f) || ck; const provs = canSplit && sd.split !== 0 ? WR.provinces(cc) : [];
      if (provs.length) { m.split.add(cc); for (const p of provs) addU(p.key, p, sd.id, 'prov'); }
      else if (f) addU(f.key, f, sd.id, 'country');
    }
    for (const cu of L.units || []) if (cu.pts && cu.pts.length >= 3) {
      const geo = V.ringGeo(cu.pts); const f = { type: 'Feature', geometry: geo, properties: {} }; f.lab = d3.geoCentroid(f); f.rad = 0; for (const p of cu.pts) f.rad = Math.max(f.rad, d3.geoDistance(f.lab, p)); f.ar = cu.name || 'منطقة'; f.en = cu.name || 'region';
      let side = cu.side || null; if (!side) for (const u of m.units.values()) if (u.kind !== 'custom' && d3.geoDistance(u.lab, f.lab) < u.rad + .05 && d3.geoContains(u.f, f.lab)) { side = u.side0; break; }
      const u = addU('U:' + cu.id, f, side, 'custom', cu.name); m.customs.push(u);
    }
    // units referenced by events but not in any side (neutral territory)
    for (const ev of L.events || []) for (const k of ev.units || []) if (!m.units.has(k)) {
      let f = null; if (k.startsWith('P:') && G.admin1) { const i = WR.a1byKey && WR.a1byKey.get(k); f = i != null ? G.admin1[i] : G.admin1.find(x => x.key === k); }
      else f = fOf(k); if (f) addU(k, f, null, k.startsWith('P:') ? 'prov' : 'country');
    }
    // cities: from events and the layer's extra list; initial owner = owner of the unit that contains it
    const unitAt = (ll) => { let best = null; for (const u of m.units.values()) { if (!u.f || d3.geoDistance(u.lab, ll) > u.rad + .05) continue; if (d3.geoContains(u.f, ll) && (!best || u.kind === 'custom' || u.area < best.area)) best = u; } return best; };
    m.unitAt = unitAt;
    const addC = (c, ev) => { if (!c || m.cities.has(c.key)) return; const u = unitAt([c.lon, c.lat]); m.cities.set(c.key, Object.assign({}, c, { side0: u ? u.side0 : ev ? ev.from : null, unit: u ? u.key : null })); };
    for (const c of L.cities || []) addC(c);
    for (const ev of L.events || []) for (const c of ev.cities || []) addC(c, ev);
    let tot = 0; for (const u of m.units.values()) if (u.kind !== 'custom') tot += u.area; m.total = tot || 1;
    models.set(L.id, m); if (models.size > 40) models.delete(models.keys().next().value);
    return m;
  };
  // ownership at layer-local time lt: {own: Map unit→side, prog:[{u, ev, p, from, to}], cityOwn: Map, cityFlip: Map key→{ev,q}}
  WR.state = (L, m, lt) => {
    const own = new Map(); for (const u of m.units.values()) own.set(u.key, u.side0);
    const cityOwn = new Map(); for (const c of m.cities.values()) cityOwn.set(c.key, c.side0);
    const prog = [], flips = new Map(); const evs = (L.events || []).slice().sort((a, b) => a.t - b.t);
    for (const ev of evs) {
      if (lt < ev.t) break; const kind = ev.kind || 'capture'; if (kind === 'battle' || kind === 'strike') continue;
      const dur = Math.max(.1, ev.dur || 2.5); const p = clamp((lt - ev.t) / dur, 0, 1);
      let units = ev.units || [], cities = ev.cities || [];
      // «النصر»: the winner takes every unit and city the loser still holds when the event starts
      if (kind === 'victory') { units = [...m.units.values()].filter(u => own.get(u.key) === ev.from).map(u => u.key); cities = [...m.cities.values()].filter(c => cityOwn.get(c.key) === ev.from); }
      // «هدنة / تقسيم»: the loser's units on the winner's side of the drawn line change hands
      else if (kind === 'truce') { units = ev.line && ev.line.length >= 2 ? WR.truceUnits(L, m, ev, own) : []; cities = cities.length ? cities : (ev.line && ev.line.length >= 2 ? [...m.cities.values()].filter(c => cityOwn.get(c.key) === ev.from && WR.lineSide(ev.line, [c.lon, c.lat]) === WR.lineSide(ev.line, WR.sideCentre(m, own, ev.to))) : []); }
      for (const k of units) { if (!m.units.has(k)) continue; if (kind === 'victory' && own.get(k) !== ev.from) continue; if (p >= 1) own.set(k, ev.to); else prog.push({ u: m.units.get(k), ev, p, from: own.get(k), to: ev.to }); }
      const tf = ev.t + dur * .55; for (const c of cities) { if (lt >= tf) cityOwn.set(c.key, ev.to); const q = (lt - tf) / .5 + .5; if (q > 0 && q < 4) flips.set(c.key, { ev, q }); }
    }
    return { own, prog, cityOwn, flips, evs };
  };
  // truce line helpers: side of a point relative to a polyline (sign of the cross product with the nearest segment)
  WR.lineSide = (line, p) => { let best = 0, bd = 1e9; for (let i = 0; i < line.length - 1; i++) { const a = line[i], b = line[i + 1]; const dx = b[0] - a[0], dy = b[1] - a[1]; const L2 = dx * dx + dy * dy || 1e-9; const u = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2, 0, 1); const qx = a[0] + dx * u, qy = a[1] + dy * u; const d = (p[0] - qx) ** 2 + (p[1] - qy) ** 2; if (d < bd) { bd = d; best = Math.sign(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) || 1; } } return best; };
  WR.sideCentre = (m, own, side) => { let x = 0, y = 0, n = 0; for (const u of m.units.values()) if (own.get(u.key) === side && u.kind !== 'custom') { x += u.lab[0] * u.area; y += u.lab[1] * u.area; n += u.area; } return n ? [x / n, y / n] : [0, 0]; };
  WR.truceUnits = (L, m, ev, own) => { const s0 = WR.lineSide(ev.line, WR.sideCentre(m, own, ev.to)); return [...m.units.values()].filter(u => own.get(u.key) === ev.from && WR.lineSide(ev.line, u.lab) === s0).map(u => u.key); };
  // where a capture wipe starts: the city, or the point of the unit nearest to the attacker's territory at that moment
  const originCache = new Map();
  function originOf(L, m, ev, u, own) {
    if (ev.origin === 'city' && ev.cities && ev.cities.length) return [ev.cities[0].lon, ev.cities[0].lat];
    const key = L.id + '|' + ev.id + '|' + u.key + '|' + m.sig.length; let o = originCache.get(key); if (o) return o;
    const verts = (f, step) => { const out = []; const g = f.geometry; const cs = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; for (const poly of cs) { const r = poly[0]; const st = Math.max(1, Math.floor(r.length / step)); for (let i = 0; i < r.length; i += st) out.push(r[i]); } return out; };
    const uv = verts(u.f, 220); const att = [];
    for (const v of m.units.values()) if (v !== u && own.get(v.key) === ev.to && v.kind !== 'custom' && d3.geoDistance(v.lab, u.lab) < v.rad + u.rad + .08) att.push(...verts(v.f, 160));
    let best = null, bd = 9;
    if (att.length) for (const p of uv) for (const q of att) { const d = d3.geoDistance(p, q); if (d < bd) { bd = d; best = p; } }
    if (!best) { // not adjacent: the side of the unit facing the attacker's centre of mass
      let cx = 0, cy = 0, n = 0; for (const v of m.units.values()) if (own.get(v.key) === ev.to) { cx += v.lab[0]; cy += v.lab[1]; n++; }
      const tgt = n ? [cx / n, cy / n] : u.lab; for (const p of uv) { const d = d3.geoDistance(p, tgt); if (d < bd) { bd = d; best = p; } }
    }
    let far = 0; for (const p of uv) far = Math.max(far, d3.geoDistance(p, best));
    o = [best[0], best[1], far || .02]; originCache.set(key, o); if (originCache.size > 600) originCache.delete(originCache.keys().next().value); return o;
  }
  // km → screen px around a point (approx)
  const kmPx = (vw, lon, lat, km) => { const a = vw.project(lon, lat), b = vw.project(lon + km / 111.32 / Math.max(.15, Math.cos(lat * RAD)), lat); return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0; };
  WR.kmPx = kmPx;
  const geoDest = (lon, lat, brg, km) => { const d = km / 6371, b = brg * RAD, p1 = lat * RAD, l1 = lon * RAD; const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b)); const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)); return [l2 * DEG, p2 * DEG]; };
  WR.geoDest = geoDest;

  let offC = null;
  const offCanvas = (W, H) => { if (!offC) offC = document.createElement('canvas'); if (offC.width !== W || offC.height !== H) { offC.width = W; offC.height = H; } const c = offC.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none'; c.clearRect(0, 0, W, H); return c; };

  /* ---------- campaign: territory fills (under the base borders) ---------- */
  V.hooks.fill.push((HK) => {
    const camps = HK.layers.filter(x => x.Ly.type === 'campaign'); if (!camps.length) return;
    if (HK.era.src !== 'hist') WR.loadA1();
    for (const { Ly: L, s } of camps) {
      const m = WR.model(L, HK.era, HK.byKey, HK.feats); const st = WR.state(L, m, s.lt); // transient, non-enumerable (scene JSON stays clean)
      Object.defineProperty(L, '__m', { value: m, configurable: true, writable: true, enumerable: false }); Object.defineProperty(L, '__st', { value: st, configurable: true, writable: true, enumerable: false });
      const { vw, W, H, k } = HK; const oc = offCanvas(W, H); const pin = S.easeOut(s.pin); const A0 = s.a * (L.in === 'fade' ? pin : 1);
      const vis = (u) => vw.mode !== 'globe' || d3.geoDistance(u.lab, HK.nad) < HK.capR + u.rad;
      const inProg = new Set(st.prog.map(x => x.u.key));
      // 1) one path per side (no seams between provinces of the same side)
      for (const sd of L.sides || []) {
        const P = new Path2D(); const gp = d3.geoPath(vw.proj, P); let any = false;
        for (const u of m.units.values()) { if (u.kind === 'custom' || !vis(u)) continue; const o = inProg.has(u.key) ? st.prog.find(x => x.u === u).from : st.own.get(u.key); if (o === sd.id) { gp(u.f); any = true; } }
        if (!any) continue; const fa = sd.fill == null ? .5 : sd.fill;
        const wv = sd.pattern === 'weave' ? { scale: sd.patS, angle: sd.patR, opacity: sd.patA } : null;
        if (wv) V.weaveFill(oc, () => oc.fill(P), sd.color, fa, k, wv); else { oc.globalAlpha = fa; oc.fillStyle = sd.color; oc.fill(P); }
        if (!WR.fast) { const ms = meshes(L, m, st); oc.save(); oc.clip(P); oc.globalAlpha = Math.min(1, fa * .9); oc.lineJoin = 'round'; oc.lineWidth = 10 * k; oc.strokeStyle = shade(sd.color, -.6); oc.filter = `blur(${(5 * k).toFixed(1)}px)`; if (ms) { oc.beginPath(); d3.geoPath(vw.proj, oc)(ms.bound[sd.id]); oc.stroke(); } else oc.stroke(P); oc.restore(); }
      }
      // 2) drawn regions (overlap their country): painter's order
      for (const u of m.customs) { const o = inProg.has(u.key) ? st.prog.find(x => x.u === u).from : st.own.get(u.key); const sd = sideOf(L, o); if (!sd || !vis(u)) continue; const P = new Path2D(); d3.geoPath(vw.proj, P)(u.f); oc.globalCompositeOperation = 'destination-out'; oc.globalAlpha = 1; oc.fill(P); oc.globalCompositeOperation = 'source-over'; if (sd.pattern === 'weave') V.weaveFill(oc, () => oc.fill(P), sd.color, sd.fill == null ? .5 : sd.fill, HK.k, { scale: sd.patS, angle: sd.patR, opacity: sd.patA }); else { oc.globalAlpha = sd.fill == null ? .5 : sd.fill; oc.fillStyle = sd.color; oc.fill(P); } }
      // 3) captures in progress: radial wipe from the attacker's border (or the city)
      const edges = [];
      for (const pr of st.prog) {
        const sd = sideOf(L, pr.to); if (!sd || !vis(pr.u)) continue; const o = originOf(L, m, pr.ev, pr.u, st.own);
        const far = o[2] != null ? o[2] : Math.max(.02, pr.u.rad * 1.6); const r = Math.max(1e-4, S.ease(pr.p) * far * 1.1);
        const blob = V.blob([o[0], o[1]], r, strSeed(pr.ev.id) % 97, 0, .1);
        const PU = new Path2D(); d3.geoPath(vw.proj, PU)(pr.u.f); const PB = new Path2D(); d3.geoPath(vw.proj, PB)(blob);
        oc.save(); oc.clip(PU); oc.clip(PB); oc.globalCompositeOperation = 'destination-out'; oc.globalAlpha = 1; oc.fillRect(0, 0, W, H);
        oc.globalCompositeOperation = 'source-over'; if (sd.pattern === 'weave') V.weaveFill(oc, () => oc.fillRect(0, 0, W, H), sd.color, sd.fill == null ? .5 : sd.fill, k, { scale: sd.patS, angle: sd.patR, opacity: sd.patA }); else { oc.globalAlpha = sd.fill == null ? .5 : sd.fill; oc.fillStyle = sd.color; oc.fillRect(0, 0, W, H); }
        // freshly taken ground glows briefly
        oc.globalAlpha = .22 * (1 - pr.p); oc.fillStyle = shade(sd.color, .55); oc.fillRect(0, 0, W, H); oc.restore();
        edges.push({ PU, PB, color: sd.color, p: pr.p });
      }
      // 4) zones of control around captured cities whose province is not (yet) taken
      for (const c of m.cities.values()) {
        const o = st.cityOwn.get(c.key); const sd = sideOf(L, o); if (!sd) continue; const under = c.unit ? (inProg.has(c.unit) ? st.prog.find(x => x.u.key === c.unit).to : st.own.get(c.unit)) : null; if (under === o) continue;
        const fl = st.flips.get(c.key); const g0 = fl ? clamp(fl.q / 1.6, 0, 1) : 1; const sp = vw.project(c.lon, c.lat); if (!sp) continue;
        const R = kmPx(vw, c.lon, c.lat, (c.r || L.cityR || 18) * S.easeOut(g0)); if (R < 1) continue;
        const gr = oc.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], R); const fa = Math.min(1, (sd.fill == null ? .5 : sd.fill) + .2);
        gr.addColorStop(0, rgba(sd.color, fa)); gr.addColorStop(.62, rgba(sd.color, fa * .85)); gr.addColorStop(1, rgba(sd.color, 0));
        oc.globalAlpha = 1; oc.fillStyle = gr; oc.beginPath(); oc.arc(sp[0], sp[1], R, 0, TAU); oc.fill();
      }
      Object.defineProperty(L, '__edges', { value: edges, configurable: true, writable: true, enumerable: false });
      HK.b.save(); HK.b.globalAlpha = A0; HK.b.drawImage(offC, 0, 0); HK.b.restore();
      // emphasise the belligerents' names (map labels)
      if (L.labels !== 0) for (const sd of L.sides || []) for (const ck of sd.countries || []) { HK.inv.add(ck); if (!HK.invLab.has(ck)) HK.invLab.set(ck, { show: true, style: 'soft', size: .9, text: '', a: A0 }); }
    }
  });

  /* ---------- campaign: faction borders + capture edges (over the base borders, under the labels) ---------- */
  const meshCache = new Map();
  // borders from the admin-1 topology for the current ownership: front (between factions), bound[side] (outline of a faction), inner (same owner)
  function meshes(L, m, st) {
    if (!m.split.size || !WR.a1topo) return null;
    const own = (gm) => { const i = WR.a1idx.get(gm); if (i == null) return null; const o = st.own.get(G.admin1[i].key); return o === undefined ? null : o; };
    const sig = L.id + '|' + (L.sides || []).map(x => x.id).join(',') + '|' + [...m.units.keys()].filter(q => q.startsWith('P:')).map(q => st.own.get(q)).join(',');
    let ms = meshCache.get(sig); if (ms) return ms;
    const T = WR.a1topo, O = T.objects.p;
    const front = topojson.mesh(T, O, (a, b) => { if (a === b) return false; const oa = own(a), ob = own(b); return oa != null && ob != null && oa !== ob; });
    const bound = {}, outer = {}; for (const sd of L.sides || []) {
      bound[sd.id] = topojson.mesh(T, O, (a, b) => { const oa = own(a), ob = own(b); if (a === b) return oa === sd.id; return oa !== ob && (oa === sd.id || ob === sd.id); });
      outer[sd.id] = topojson.mesh(T, O, (a, b) => { const oa = own(a), ob = own(b); if (a === b) return oa === sd.id; return (oa === sd.id && ob == null) || (ob === sd.id && oa == null); });
    }
    const inner = topojson.mesh(T, O, (a, b) => a !== b && own(a) != null && own(a) === own(b));
    ms = { front, bound, outer, inner }; meshCache.set(sig, ms); if (meshCache.size > 60) meshCache.delete(meshCache.keys().next().value); return ms;
  }
  V.hooks.mid.push((HK) => {
    for (const { Ly: L, s } of HK.layers) {
      if (L.type !== 'campaign' || !L.__m) continue; const m = L.__m, st = L.__st; const { g, pg, vw, k } = HK; const A0 = s.a * (L.in === 'fade' ? S.easeOut(s.pin) : 1);
      if (L.borders !== 0) {
        // province-split countries: exact borders between owners from the admin-1 topology
        const ms = meshes(L, m, st);
        if (ms) {
          g.save(); g.globalAlpha = A0; g.lineJoin = 'round'; g.lineCap = 'round';
          if (L.provLines !== 0) { g.beginPath(); pg(ms.inner); g.lineWidth = .6 * k; g.strokeStyle = 'rgba(255,248,230,.13)'; g.setLineDash([2.5 * k, 3 * k]); g.stroke(); g.setLineDash([]); }
          for (const sd of L.sides || []) { if (sd.border === 'none') continue; g.beginPath(); pg(ms.outer[sd.id]); sideStroke(g, sd, k); }
          g.beginPath(); pg(ms.front); g.lineWidth = 4.2 * k; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke(); g.lineWidth = 1.8 * k; g.strokeStyle = '#f4ead0'; g.shadowColor = 'rgba(255,240,200,.6)'; g.shadowBlur = 6 * k; g.stroke();
          g.restore();
        }
        // whole countries (historical eras) and drawn regions: outline per owner
        for (const sd of L.sides || []) {
          if (sd.border === 'none') continue; const P = new Path2D(); const gp = d3.geoPath(vw.proj, P); let any = false;
          for (const u of m.units.values()) if (u.kind !== 'prov' && st.own.get(u.key) === sd.id && (u.kind === 'custom' || u.side0 === sd.id || true)) { gp(u.f); any = true; }
          if (!any) continue; g.save(); g.globalAlpha = A0; g.lineJoin = 'round'; sideStroke(g, sd, k, P); g.restore();
        }
      }
      // bright leading edge of every capture in progress
      for (const e of L.__edges || []) {
        const a = A0 * (1 - Math.pow(e.p, 4));
        g.save(); g.clip(e.PU); g.globalAlpha = a; g.lineJoin = 'round';
        g.lineWidth = 7 * k; g.strokeStyle = rgba(shade(e.color, .3), .35); if (!WR.fast) { g.shadowColor = shade(e.color, .4); g.shadowBlur = 16 * k; } g.stroke(e.PB);
        g.shadowBlur = 0; g.lineWidth = 3.2 * k; g.strokeStyle = shade(e.color, .55); g.stroke(e.PB);
        g.lineWidth = 1.5 * k; g.strokeStyle = 'rgba(255,248,228,.98)'; g.stroke(e.PB); g.restore();
      }
    }
  });
  function sideStroke(g, sd, k, P) {
    const go = () => P ? g.stroke(P) : g.stroke();
    g.lineWidth = 3.4 * k; g.strokeStyle = 'rgba(0,0,0,.35)'; go();
    if (sd.border === 'dashed') g.setLineDash([6 * k, 4 * k]);
    if (sd.border === 'glow') { g.shadowColor = sd.color; g.shadowBlur = 12 * k; }
    g.lineWidth = 1.5 * k; g.strokeStyle = shade(sd.color, .35); go(); g.setLineDash([]); g.shadowBlur = 0;
  }

  /* ================= particles & effects (screen space) ================= */
  function puff(g, x, y, r, a, col) { if (a <= .003 || r <= .5) return; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(.55, `rgba(${col},${a * .55})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  function glow(g, x, y, r, a, inner, outer) { if (a <= .003 || r <= .5) return; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,252,235,${a})`); gr.addColorStop(.25, `rgba(${inner},${a * .85})`); gr.addColorStop(.6, `rgba(${outer},${a * .35})`); gr.addColorStop(1, `rgba(${outer},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  // one explosion `age` seconds after impact. s = size px. o: {crater, smoke, sparks, ring, seed, col}
  function blast(g, x, y, s, age, o = {}) {
    if (age < 0) return; const sd = o.seed || 1; const fast = WR.fast; const life = o.life || 3.2; if (age > life) return;
    g.save();
    // ground scorch / crater
    if (o.crater !== 0 && age > .08) { const ca = Math.min(1, (age - .08) * 6) * (1 - smooth(clamp((age - life * .6) / (life * .4), 0, 1))); puff(g, x, y, s * .62, .5 * ca, '24,18,12'); puff(g, x + s * .08, y + s * .04, s * .3, .35 * ca, '10,8,6'); }
    // smoke: grey-brown puffs drifting up and growing
    if (o.smoke !== 0) { const n = fast ? 6 : 12; for (let i = 0; i < n; i++) { const t0 = .04 + rnd(sd, i, 1) * .3; const a = age - t0; if (a < 0) continue; const L = 1.8 + rnd(sd, i, 2) * 1.6; if (a > L) continue; const q = a / L; const ang = rnd(sd, i, 3) * TAU; const d = s * (.1 + .45 * rnd(sd, i, 4)) * (.4 + .6 * Math.sqrt(q)); const px = x + Math.cos(ang) * d + q * s * .45 * (o.wind == null ? 1 : o.wind), py = y + Math.sin(ang) * d * .55 - q * s * (.55 + .6 * rnd(sd, i, 5)); const sh = 58 + rnd(sd, i, 6) * 46 | 0; const fade = Math.min(1, a / .18) * Math.pow(1 - q, 1.4); const r = s * (.38 + .85 * Math.sqrt(q)) * (.7 + .6 * rnd(sd, i, 8)); puff(g, px, py, r, .3 * fade * (.6 + .4 * rnd(sd, i, 7)), `${sh},${sh - 5},${sh - 12}`); puff(g, px + r * .25, py - r * .15, r * .7, .18 * fade, `${sh + 18},${sh + 12},${sh + 2}`); } }
    g.globalCompositeOperation = 'lighter';
    // flash + fireball
    if (age < .6) { const q = age / .6; glow(g, x, y, s * (.55 + 1.0 * Math.sqrt(q)), (1 - q) * (1 - q), '255,214,120', '255,110,30'); glow(g, x, y - s * .2 * q, s * .5 * (1 - q * .5), (1 - q) * .8, '255,240,190', '255,170,70'); }
    if (age < .12) glow(g, x, y, s * 1.8, (1 - age / .12) * .55, '255,240,200', '255,200,120');
    // shockwave ring
    if (o.ring !== 0 && age < .7) { const q = age / .7; g.globalAlpha = (1 - q) * .7; g.strokeStyle = 'rgba(255,236,200,1)'; g.lineWidth = Math.max(1, s * .06 * (1 - q)); g.beginPath(); g.ellipse(x, y, s * (.3 + 1.4 * S.easeOut(q)), s * (.22 + 1.05 * S.easeOut(q)), 0, 0, TAU); g.stroke(); g.globalAlpha = 1; }
    // sparks / debris: ballistic streaks
    if (o.sparks !== 0 && age < .9) { const n = fast ? 6 : 12; g.lineCap = 'round'; for (let i = 0; i < n; i++) { const ang = -Math.PI / 2 + (rnd(sd, i, 11) - .5) * Math.PI * 1.5; const v = s * (1.2 + 1.6 * rnd(sd, i, 12)); const a = age * (.8 + .4 * rnd(sd, i, 13)); if (a > .85) continue; const px = x + Math.cos(ang) * v * a, py = y + Math.sin(ang) * v * a + s * 2.2 * a * a; const tx = Math.cos(ang) * v, ty = Math.sin(ang) * v + s * 4.4 * a; const l = Math.hypot(tx, ty) || 1; const len = s * .12; g.globalAlpha = 1 - a / .85; g.strokeStyle = 'rgba(255,200,120,1)'; g.lineWidth = Math.max(.8, s * .025); g.beginPath(); g.moveTo(px, py); g.lineTo(px - tx / l * len, py - ty / l * len); g.stroke(); } g.globalAlpha = 1; }
    g.restore();
  }
  WR.blast = blast;

  /* ---------- clash «اشتباك» ---------- */
  function clashAt(g, x, y, lt, k, o) {
    const sz = 52 * k * (o.size || 1); const inten = clamp(o.intensity || 1, .2, 3); const seed = o.seed || 7; const pop = o.pop == null ? 1 : o.pop; const a0 = o.a == null ? 1 : o.a;
    g.save(); g.globalAlpha = a0;
    // bursts around the centre (seeded per burst index)
    const per = .42 / inten; const life = 1.6; const j0 = Math.max(0, Math.floor((lt - life) / per)), j1 = Math.floor(lt / per);
    for (let j = j0; j <= j1; j++) { const tj = j * per + rnd(seed, j, 1) * per * .8; const age = lt - tj; if (age < 0 || age > life) continue; const ang = rnd(seed, j, 2) * TAU, d = sz * (.4 + 1.5 * rnd(seed, j, 3)); blast(g, x + Math.cos(ang) * d, y + Math.sin(ang) * d * .6, sz * (.35 + .35 * rnd(seed, j, 4)), age, { seed: seed * 31 + j, life, crater: 0, sparks: o.sparks, smoke: o.smoke, ring: 0 }); }
    // lingering battle smoke
    if (o.smoke !== 0) { const n = WR.fast ? 3 : 6; for (let i = 0; i < n; i++) { const L = 3 + rnd(seed, i, 20) * 2; const ph = ((lt + rnd(seed, i, 21) * L) % L) / L; const ang = rnd(seed, i, 22) * TAU; puff(g, x + Math.cos(ang) * sz * .9 + ph * sz * .8, y + Math.sin(ang) * sz * .4 - ph * sz * 1.2, sz * (.6 + ph * 1.1), .28 * Math.sin(Math.PI * ph) * Math.min(1, lt / .6), '92,88,80'); } }
    // shockwave rings from the centre
    if (o.rings !== 0) { for (let i = 0; i < 2; i++) { const ph = ((lt * .7 + i * .5) % 1); g.globalAlpha = a0 * (1 - ph) * .55; g.strokeStyle = o.color || '#ffb347'; g.lineWidth = 1.6 * k; g.beginPath(); g.ellipse(x, y, sz * (.8 + ph * 2.4), sz * (.6 + ph * 1.8), 0, 0, TAU); g.stroke(); } g.globalAlpha = a0; }
    // emblem: dark disc + crossed swords
    if (o.swords !== 0) {
      const r = sz * .62 * pop; const bob = 1 + .04 * Math.sin(lt * 5);
      g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 10 * k; g.fillStyle = 'rgba(14,12,10,.82)'; g.beginPath(); g.arc(x, y, r * bob, 0, TAU); g.fill(); g.shadowBlur = 0;
      g.lineWidth = 1.8 * k; g.strokeStyle = o.color || '#ffb347'; g.stroke();
      if (r > 2) V.icon(g, 'battle', x, y, r * 1.35, '#f4ead0', 0, lt, 1);
    }
    if (o.text) V.haloText(g, o.text, x, y + sz * 1.25, 16 * k, '#ffffff', 'soft', o.fam, 800);
    g.restore();
  }
  WR.clashAt = clashAt;

  /* ---------- strike: arcing projectiles ---------- */
  function strikeDraw(g, P0, targets, lt, k, o) {
    const n = Math.max(1, o.count || 1); const seed = o.seed || 3; const F = Math.max(.2, o.flight || 1.5); const iv = o.interval == null ? .5 : o.interval;
    for (let i = 0; i < n; i++) {
      const T = targets[i % targets.length]; if (!T || !P0) continue; const ti = i * iv; const u = (lt - ti) / F;
      const jx = (rnd(seed, i, 1) - .5) * 2 * (o.spread || 0) * k, jy = (rnd(seed, i, 2) - .5) * 1.4 * (o.spread || 0) * k;
      const B = [T[0] + jx, T[1] + jy]; const dx = B[0] - P0[0], dy = B[1] - P0[1]; const D = Math.hypot(dx, dy) || 1;
      const h = D * (o.arc == null ? .3 : o.arc) * (o.kind === 'artillery' ? 1.35 : 1); const nx = -dy / D, ny = dx / D; const sgn = ny > 0 ? -1 : 1; // bulge upwards on screen
      const C = [(P0[0] + B[0]) / 2 + nx * h * sgn, (P0[1] + B[1]) / 2 + ny * h * sgn];
      const at = (q) => { const a = 1 - q; return [a * a * P0[0] + 2 * a * q * C[0] + q * q * B[0], a * a * P0[1] + 2 * a * q * C[1] + q * q * B[1]]; };
      if (u >= 0 && u < 1) {
        // launch flash
        if (lt - ti < .35) { g.save(); g.globalCompositeOperation = 'lighter'; glow(g, P0[0], P0[1], 14 * k, 1 - (lt - ti) / .35, '255,220,150', '255,140,60'); g.restore(); }
        const q = o.kind === 'artillery' ? u : u * u * (3 - 2 * u) * .3 + u * .7; const hd = at(q);
        if (o.trail !== 0) { const q0 = Math.max(0, q - (o.kind === 'artillery' ? .12 : .32)); const N = 14; g.save(); g.lineCap = 'round'; for (let j = 0; j < N; j++) { const a = q0 + (q - q0) * j / N, b = q0 + (q - q0) * (j + 1) / N; const p1 = at(a), p2 = at(b); const f = (j + 1) / N; g.globalAlpha = f * f * .9; g.strokeStyle = o.kind === 'artillery' ? 'rgba(255,190,110,1)' : 'rgba(235,232,225,1)'; g.lineWidth = (o.kind === 'artillery' ? 1.6 : 2.6) * k * (.4 + .6 * f); g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke(); } g.restore(); }
        g.save(); g.globalCompositeOperation = 'lighter'; glow(g, hd[0], hd[1], (o.kind === 'artillery' ? 6 : 10) * k, 1, '255,236,190', o.kind === 'artillery' ? '255,150,60' : '255,190,120'); g.restore();
      }
      const age = lt - ti - F; if (age >= 0) blast(g, B[0], B[1], (o.kind === 'artillery' ? 30 : 42) * k * (o.size || 1), age, { seed: seed * 17 + i, crater: o.crater, life: o.life || 3.4 });
    }
  }
  WR.strikeDraw = strikeDraw;

  /* ---------- polyline helpers ---------- */
  function lens(pts) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return L; }
  function along(pts, L, d) { const tot = L[L.length - 1]; d = clamp(d, 0, tot); let i = 1; while (i < L.length - 1 && L[i] < d) i++; const f = (d - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]); const a = pts[i - 1], b = pts[i]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])]; }
  function smoothPts(p, it) { for (let k = 0; k < (it || 1); k++) { if (p.length < 3) return p; const q = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } q.push(p[p.length - 1]); p = q; } return p; }
  WR.along = along; WR.lens = lens;

  /* ---------- troops on the move ---------- */
  function troopsDraw(g, line, lt, k, o) {
    if (line.length < 2) return; const Ls = lens(line); const tot = Ls[Ls.length - 1]; const n = Math.max(1, o.count || 1); const seed = o.seed || 5; const tr = Math.max(.3, o.travel || 5);
    const mv = (i, tt) => { const u = clamp((tt - i * (o.spacing || .7)) / tr, 0, 1); return S.ease(u) * (tot - i * 0); };
    if (o.route !== 0) { g.save(); g.globalAlpha = .55; g.setLineDash([5 * k, 6 * k]); g.lineCap = 'round'; g.beginPath(); line.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.lineWidth = 3 * k; g.strokeStyle = 'rgba(0,0,0,.4)'; g.stroke(); g.lineWidth = 1.5 * k; g.strokeStyle = rgba(o.color, 1); g.stroke(); g.restore(); }
    const sz = 32 * k * (o.size || 1);
    for (let i = n - 1; i >= 0; i--) {
      const d = mv(i, lt); if (lt < i * (o.spacing || .7)) continue; const back = i * sz * .0; const p = along(line, Ls, d - back);
      // dust: puffs emitted every 0.1 s at the unit's past positions
      if (o.dust !== 0) { const dt = .1, life = 1.3; const e1 = Math.floor(lt / dt); for (let e = e1; e > e1 - life / dt; e--) { const te = e * dt; const age = lt - te; if (age < 0) continue; const u0 = (te - i * (o.spacing || .7)) / tr; if (u0 <= 0 || u0 >= 1) continue; const q = along(line, Ls, mv(i, te)); const r1 = rnd(seed + i, e, 1), r2 = rnd(seed + i, e, 2); const qa = age / life; puff(g, q[0] + (r1 - .5) * sz * .7 - Math.cos(q[2]) * sz * .4, q[1] + (r2 - .5) * sz * .5 - Math.sin(q[2]) * sz * .4 - qa * sz * .3, sz * (.25 + .6 * qa), .32 * (1 - qa) * (1 - qa), '150,128,98'); } }
      const ico = o.icon || 'armor'; const nato = ['inf', 'armor', 'art', 'hq'].includes(ico);
      g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 6 * k; V.icon(g, ico, p[0], p[1], nato ? sz : sz * 1.2, o.color, nato || ico.startsWith('lib:') ? 0 : p[2] + Math.PI / 2, lt, o.a == null ? 1 : o.a); g.restore();
    }
  }
  WR.troopsDraw = troopsDraw;

  /* ---------- air strike ---------- */
  function airDraw(g, line, lt, k, o) {
    if (line.length < 2) return; const Ls = lens(line); const tot = Ls[Ls.length - 1]; const n = Math.max(1, o.count || 1); const tr = Math.max(.3, o.travel || 4); const seed = o.seed || 9; const sz = 42 * k * (o.size || 1); const nb = Math.max(0, o.bombs == null ? 5 : o.bombs);
    for (let i = 0; i < n; i++) {
      const t0 = i * (o.spacing || .45); const u = (lt - t0) / tr; const off = (i - (n - 1) / 2) * sz * .9;
      const posAt = (uu) => { const p = along(line, Ls, uu * tot); return [p[0] - Math.sin(p[2]) * off, p[1] + Math.cos(p[2]) * off, p[2]]; };
      // bombs: released between 35% and 85% of the path, burst 0.35 s later
      for (let j = 0; j < nb; j++) { const fu = .35 + .5 * (nb > 1 ? j / (nb - 1) : .5) + (rnd(seed, i * 50 + j, 1) - .5) * .05; const tb = t0 + fu * tr + .35; const age = lt - tb; if (age < 0) continue; const p = posAt(fu); blast(g, p[0] + (rnd(seed, i * 50 + j, 2) - .5) * sz * .8, p[1] + (rnd(seed, i * 50 + j, 3) - .5) * sz * .6, sz * .75, age, { seed: seed * 7 + i * 50 + j, life: 3 }); }
      if (u <= 0 || u >= 1.08) continue; const uc = Math.min(1, u);
      // contrail
      g.save(); g.lineCap = 'round'; const N = 18, u0 = Math.max(0, uc - .22); for (let j = 0; j < N; j++) { const a = posAt(u0 + (uc - u0) * j / N), b = posAt(u0 + (uc - u0) * (j + 1) / N); g.globalAlpha = .5 * Math.pow((j + 1) / N, 1.5) * (u > 1 ? 1 - (u - 1) / .08 : 1); g.strokeStyle = 'rgba(240,244,248,1)'; g.lineWidth = 2.2 * k; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } g.restore();
      if (u > 1) continue; const p = posAt(uc); const rot = p[2] + Math.PI / 2;
      V.icon(g, o.icon || 'jet', p[0] + sz * .35, p[1] + sz * .5, sz, 'rgba(0,0,0,.35)', rot, lt, .5); // ground shadow
      V.icon(g, o.icon || 'jet', p[0], p[1], sz, o.color || '#e8eef5', rot, lt, o.a == null ? 1 : o.a);
    }
  }
  WR.airDraw = airDraw;

  /* ---------- encirclement: two pincers closing around a city ---------- */
  function encircleDraw(g, vw, L, lt, k, fam, a0) {
    const c = [L.lon, L.lat]; const cp = vw.project(c[0], c[1]); if (!cp) return; const pc = S.ease(clamp(lt / Math.max(.2, L.close || 3), 0, 1)); const km = (L.km || 60) * (1.35 - .35 * pc);
    const ring = (a0d, a1d) => { const out = []; const n = Math.max(2, Math.ceil(Math.abs(a1d - a0d) / 4)); for (let i = 0; i <= n; i++) { const b = a0d + (a1d - a0d) * i / n; const ll = geoDest(c[0], c[1], b, km); const sp = vw.project(ll[0], ll[1]); if (sp) out.push(sp); } return out; };
    g.save(); g.globalAlpha = a0;
    if (pc < 1) { const sw = 180 * pc; for (const sg of [1, -1]) { const pts = ring(L.dir || 270, (L.dir || 270) + sg * sw); if (pts.length >= 2) V.arrow(g, pts, { k, width: .95, color: L.color, style: 'military', glow: 0, outline: 1, t: lt }); } }
    else {
      const pts = ring(0, 360); const P = new Path2D(); pts.forEach((p, i) => i ? P.lineTo(p[0], p[1]) : P.moveTo(p[0], p[1])); P.closePath();
      const q = clamp((lt - (L.close || 3)) / .6, 0, 1); const pulse = .5 + .5 * Math.sin(lt * 3);
      g.globalAlpha = a0 * (.12 + .06 * pulse) * q; g.fillStyle = L.color; g.fill(P);
      g.globalAlpha = a0; g.lineJoin = 'round'; g.lineWidth = 5 * k; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke(P); g.lineWidth = 2.6 * k; g.strokeStyle = L.color; g.stroke(P);
      // inward teeth
      g.fillStyle = L.color; const Ls = lens(pts.concat([pts[0]])); const tot = Ls[Ls.length - 1]; const step = 16 * k; const all = pts.concat([pts[0]]);
      for (let d = 0; d < tot; d += step) { const p = along(all, Ls, d); const ix = cp[0] - p[0], iy = cp[1] - p[1]; const il = Math.hypot(ix, iy) || 1; const tx = Math.cos(p[2]), ty = Math.sin(p[2]); const h = 9 * k * q; g.beginPath(); g.moveTo(p[0] - tx * 3.5 * k, p[1] - ty * 3.5 * k); g.lineTo(p[0] + tx * 3.5 * k, p[1] + ty * 3.5 * k); g.lineTo(p[0] + ix / il * h, p[1] + iy / il * h); g.closePath(); g.fill(); }
      if (q < 1) { g.globalAlpha = a0 * (1 - q); g.lineWidth = 3 * k; g.strokeStyle = '#fff6dc'; g.stroke(P); }
    }
    V.icon(g, 'capital', cp[0], cp[1], 18 * k, L.color, 0, 0, 1);
    if (L.text) V.haloText(g, L.text, cp[0], cp[1] + 20 * k, 17 * k, '#ffffff', 'soft', fam, 800);
    g.restore();
  }
  /* ---------- siege: pulsing ring + day counter ---------- */
  function siegeDraw(g, vw, L, s, k, fam, a0) {
    const cp = vw.project(L.lon, L.lat); if (!cp) return; const R = Math.max(14 * k, kmPx(vw, L.lon, L.lat, L.km || 30)); const lt = s.lt; const pin = S.easeOut(s.pin);
    g.save(); g.globalAlpha = a0 * pin;
    const pulse = .5 + .5 * Math.sin(lt * 2.6);
    const gr = g.createRadialGradient(cp[0], cp[1], R * .2, cp[0], cp[1], R * 1.15); gr.addColorStop(0, rgba(L.color, 0)); gr.addColorStop(.75, rgba(L.color, .1 + .08 * pulse)); gr.addColorStop(1, rgba(L.color, 0)); g.fillStyle = gr; g.beginPath(); g.arc(cp[0], cp[1], R * 1.15, 0, TAU); g.fill();
    g.lineWidth = 5 * k; g.strokeStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(cp[0], cp[1], R, 0, TAU); g.stroke();
    g.setLineDash([10 * k, 6 * k]); g.lineDashOffset = -lt * 14 * k; g.lineWidth = 2.6 * k; g.strokeStyle = L.color; if (!WR.fast) { g.shadowColor = L.color; g.shadowBlur = (6 + 8 * pulse) * k; } g.stroke(); g.setLineDash([]); g.shadowBlur = 0;
    for (let i = 0; i < 2; i++) { const ph = (lt * .5 + i * .5) % 1; g.globalAlpha = a0 * pin * (1 - ph) * .5; g.lineWidth = 1.4 * k; g.beginPath(); g.arc(cp[0], cp[1], R * (1 + ph * .5), 0, TAU); g.stroke(); }
    g.globalAlpha = a0 * pin; V.icon(g, 'capital', cp[0], cp[1], 18 * k, L.color, 0, 0, 1);
    const dur = s.dur > 0 && s.dur < 1e8 ? s.dur : 8; const f = clamp(lt / Math.max(.5, dur - .5), 0, 1); const d0 = +L.d0 || 1, d1 = Math.max(d0, +L.days || 30);
    const n = L.countdown ? Math.round(d1 - (d1 - d0) * f) : Math.round(d0 + (d1 - d0) * f); const lbl = String(L.label || (L.countdown ? 'متبقٍ {n} يوم' : 'اليوم {n} من الحصار')).replace('{n}', n);
    chip(g, cp[0], cp[1] + R + 22 * k, lbl, L.color, k, fam, 1);
    if (L.text) V.haloText(g, L.text, cp[0], cp[1] - R - 16 * k, 18 * k, '#ffffff', 'soft', fam, 800);
    g.restore();
  }
  // caption chip: dark plate + coloured accent bar
  function chip(g, x, y, text, color, k, fam, a) {
    const px = 19 * k; g.save(); g.globalAlpha *= a; g.font = V.font(px, 800, fam); const w = g.measureText(text).width + px * 1.6, h = px * 1.85; const x0 = x - w / 2, y0 = y - h / 2;
    g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 12 * k; g.fillStyle = 'rgba(12,13,16,.86)'; g.beginPath(); if (g.roundRect) g.roundRect(x0, y0, w, h, 4 * k); else g.rect(x0, y0, w, h); g.fill(); g.shadowBlur = 0;
    g.fillStyle = color; const rtl = isAr(text); g.fillRect(rtl ? x0 + w - 3.5 * k : x0, y0, 3.5 * k, h);
    V.haloText(g, text, x + (rtl ? -1 : 1) * 1.5 * k, y, px, '#f6f1e6', null, fam, 800); g.restore();
  }
  WR.chip = chip;

  /* ---------- front «هجوم»: the line advances along an axis, arrows spawn behind it ---------- */
  function frontAttack(HK, L, s) {
    const { g, pg, vw, k } = HK; const line0 = L.pts || []; if (line0.length < 2) return; const path = L.path && L.path.length >= 2 ? L.path : null;
    const advDur = Math.max(.3, L.advDur || (s.dur < 1e8 ? Math.max(1, s.dur - 1) : 6)); const u = S.ease(clamp((s.lt - (L.advDelay || .3)) / advDur, 0, 1));
    let d = [0, 0]; if (path) { const Ls = lens(path); const p = along(path, Ls, u * Ls[Ls.length - 1]); d = [p[0] - path[0][0], p[1] - path[0][1]]; } else { d = geoDest(0, 0, L.dir == null ? 90 : L.dir, (L.km || 120) * u); }
    const cur = line0.map(p => [p[0] + d[0], p[1] + d[1]]); const pin = S.easeOut(s.pin); const a0 = s.a * pin;
    // swept (taken) ground
    if (u > 0) { const poly = line0.concat(cur.slice().reverse()); const geo = V.ringGeo(poly); g.save(); g.globalAlpha = a0 * (L.fill == null ? .4 : L.fill); g.beginPath(); pg(geo); g.fillStyle = L.color; g.fill(); g.restore(); }
    const sl = cur.map(p => vw.project(p[0], p[1])).filter(Boolean); if (sl.length < 2) return; const sm = smoothPts(sl, 2);
    // screen direction of the advance (for teeth and arrows)
    const full = path ? [path[path.length - 1][0] - path[0][0], path[path.length - 1][1] - path[0][1]] : geoDest(0, 0, L.dir == null ? 90 : L.dir, Math.max(10, L.km || 120));
    let mx = 0, my = 0; { const c0 = line0[Math.floor(line0.length / 2)]; const a = vw.project(c0[0], c0[1]), b = vw.project(c0[0] + full[0], c0[1] + full[1]); if (a && b) { mx = b[0] - a[0]; my = b[1] - a[1]; const l = Math.hypot(mx, my) || 1; mx /= l; my /= l; } }
    g.save(); g.globalAlpha = a0; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); sm.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.lineWidth = 6 * k * (L.stroke || 2) / 2; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke(); g.lineWidth = 3 * k * (L.stroke || 2) / 2; g.strokeStyle = L.color; g.stroke();
    // teeth on the leading side
    const Ls = lens(sm); const tot = Ls[Ls.length - 1]; g.fillStyle = L.color;
    for (let dd = 8 * k; dd < tot; dd += 15 * k) { const p = along(sm, Ls, dd); let nx = -Math.sin(p[2]), ny = Math.cos(p[2]); if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; } const tx = Math.cos(p[2]), ty = Math.sin(p[2]); g.beginPath(); g.moveTo(p[0] - tx * 4 * k, p[1] - ty * 4 * k); g.lineTo(p[0] + tx * 4 * k, p[1] + ty * 4 * k); g.lineTo(p[0] + nx * 7 * k, p[1] + ny * 7 * k); g.closePath(); g.fill(); }
    // arrows spawning behind the line and pushing through it
    if (mx || my) { const per = .45, life = 1.5; const j1 = Math.floor(s.lt / per); for (let j = Math.max(0, j1 - Math.ceil(life / per)); j <= j1; j++) { const age = s.lt - j * per; if (age < 0 || age > life || u >= 1 && age > .2 && j * per > (L.advDelay || .3) + advDur) continue; const f = .12 + .76 * rnd(strSeed(L.id), j, 1); const p = along(sm, Ls, f * tot); const q = age / life; const back = 46 * k, fw = 30 * k; const st = -back + (back + fw) * S.easeOut(q); const a = [p[0] + mx * (st - 34 * k), p[1] + my * (st - 34 * k)], b = [p[0] + mx * st, p[1] + my * st]; g.save(); g.globalAlpha = a0 * Math.sin(Math.PI * q); V.arrow(g, [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b], { k, width: .5, color: L.color, style: 'military', glow: 0, outline: 1, t: s.lt }); g.restore(); } }
    g.restore();
  }

  /* ================= top hook: effects, cities, captions, scoreboard ================= */
  V.hooks.top.push((HK) => {
    const { g, vw, k, fam, t } = HK;
    for (const { Ly: L, s } of HK.layers) {
      const a0 = s.a; const pin = S.easeOut(s.pin); const lt = s.lt; const seed = strSeed(L.id);
      if (L.type === 'clash') { const sp = vw.project(+L.lon, +L.lat); if (!sp) continue; clashAt(g, sp[0], sp[1], lt, k, { size: L.size, intensity: L.intensity, swords: L.swords, smoke: L.smoke, sparks: L.sparks, rings: L.rings, color: L.color, text: L.text, fam, seed, a: a0 * (L.in === 'fade' ? pin : 1), pop: L.in === 'pop' ? Math.max(0, S.back(s.pin)) : 1 }); }
      else if (L.type === 'strike' && L.pts && L.pts.length >= 2) { const P = L.pts.map(p => vw.project(p[0], p[1])); g.save(); g.globalAlpha = a0; strikeDraw(g, P[0], P.slice(1), lt, k, { count: L.count, interval: L.interval, flight: L.flight, arc: L.arc, spread: L.spread, trail: L.trail, crater: L.crater, kind: L.kind, seed, size: L.size }); g.restore(); }
      else if (L.type === 'troops' && L.pts && L.pts.length >= 2) { const line = smoothPts(V.geoLine(vw, L.pts, L.curve || 0), 2); g.save(); g.globalAlpha = a0; troopsDraw(g, line, lt, k, { count: L.count, spacing: L.spacing, travel: L.travel, icon: L.icon, color: L.color, size: L.size, dust: L.dust, route: L.route, seed }); g.restore(); }
      else if (L.type === 'air' && L.pts && L.pts.length >= 2) { const line = smoothPts(V.geoLine(vw, L.pts, L.curve || .08), 2); g.save(); g.globalAlpha = a0; airDraw(g, line, lt, k, { count: L.count, spacing: L.spacing, travel: L.travel, icon: L.icon, color: L.color, size: L.size, bombs: L.bombs, seed }); g.restore(); }
      else if (L.type === 'encircle') encircleDraw(g, vw, L, lt, k, fam, a0);
      else if (L.type === 'siege') siegeDraw(g, vw, L, s, k, fam, a0);
      else if (L.type === 'front' && L.mode === 'attack') frontAttack(HK, L, s);
      else if (L.type === 'campaign' && L.__m) campaignTop(HK, L, s);
    }
  });

  function evPoint(m, ev) { if (ev.at) return ev.at; if (ev.cities && ev.cities.length) return [ev.cities[0].lon, ev.cities[0].lat]; const u = (ev.units || []).map(q => m.units.get(q)).find(Boolean); if (u) return u.lab; if ((ev.kind === 'victory' || ev.kind === 'truce') && ev.from) { let best = null; for (const v of m.units.values()) if (v.side0 === ev.from && (!best || v.area > best.area)) best = v; return best ? best.lab : null; } return null; }
  // caption text of an event (chips «سقوط مدينة …»)
  WR.evCaption = (L, m, ev) => { if (ev.text) return ev.text; const place = ev.place || (ev.cities && ev.cities.length ? ev.cities.map(c => c.a || c.n).join(' و') : (ev.units || []).map(q => m.units.get(q)).filter(Boolean).map(u => u.name).join(' و')); const k = ev.kind || 'capture';
    if (k === 'battle') return 'معركة ' + place; if (k === 'strike') return 'قصف ' + place; if (k === 'retreat') return 'انسحاب من ' + place; if (k === 'advance') return 'تقدم نحو ' + place;
    return ev.cities && ev.cities.length ? 'سقوط مدينة ' + place : 'السيطرة على ' + place; };
  WR.evPoint = evPoint;
  function campaignTop(HK, L, s) {
    const { g, vw, k, fam, W, H } = HK; const m = L.__m, st = L.__st; const lt = s.lt; const A0 = s.a * (L.in === 'fade' ? S.easeOut(s.pin) : 1);
    g.save(); g.globalAlpha = A0;
    // event effects (clash / strike) around the capture
    for (const ev of st.evs) {
      const fx = ev.fx || 'none'; if (fx === 'none') continue; const dur = Math.max(.1, ev.dur || 2.5); const a = lt - (ev.t - 1); if (a < 0 || a > dur + 3.5) continue;
      const P = evPoint(m, ev); if (!P) continue; const sp = vw.project(P[0], P[1]); if (!sp) continue; const seed = strSeed(ev.id);
      const fade = clamp((dur + 3.5 - a) / 1.2, 0, 1);
      if (fx === 'clash') clashAt(g, sp[0], sp[1], a, k, { size: 1, intensity: 1.2, color: (sideOf(L, ev.to) || {}).color || '#ffb347', fam, seed, a: A0 * fade, pop: Math.max(0, S.back(clamp(a / .5, 0, 1))) });
      else if (fx === 'strike') { const pr = st.prog.find(x => x.ev === ev); const u = (ev.units || []).map(q => m.units.get(q)).find(Boolean); let O = null; if (u) { const o = originOf(L, m, ev, u, st.own); const back = d3.geoInterpolate([o[0], o[1]], u.lab)(-.6); O = vw.project(back[0], back[1]); } if (!O) { let best = null, bd = 9; for (const v of m.units.values()) if (st.own.get(v.key) === ev.to) { const d = d3.geoDistance(v.lab, P); if (d < bd) { bd = d; best = v; } } if (best) { const q = d3.geoInterpolate(P, best.lab)(Math.min(.8, .9 / Math.max(.01, bd * 40))); O = vw.project(q[0], q[1]); } } if (!O) O = [sp[0] - 220 * k, sp[1] + 60 * k]; void pr; g.save(); g.globalAlpha = A0 * fade; strikeDraw(g, O, [sp], a, k, { count: 3, interval: .45, flight: 1.1, arc: .32, spread: 14, kind: 'missile', seed, crater: 1 }); g.restore(); }
    }
    // city markers with ownership flip + flag
    if (L.showCities !== 0) for (const c of m.cities.values()) {
      const sp = vw.project(c.lon, c.lat); if (!sp || sp[0] < -40 || sp[1] < -40 || sp[0] > W + 40 || sp[1] > H + 40) continue;
      const o = st.cityOwn.get(c.key); const sd = sideOf(L, o); const fl = st.flips.get(c.key); const col = sd ? sd.color : '#cfcfcf';
      let sx = 1, colNow = col; if (fl && fl.q < 1 && L.flip !== 0) { sx = Math.abs(Math.cos(Math.PI * fl.q)); if (fl.q < .5) { const s0 = sideOf(L, fl.ev.from); colNow = s0 ? s0.color : col; } }
      const r = (c.cap ? 8.5 : 6.8) * k;
      if (fl && fl.q > .5 && fl.q < 2.6) for (let i = 0; i < 2; i++) { const ph = clamp((fl.q - .5 - i * .35) / 1.6, 0, 1); if (ph <= 0 || ph >= 1) continue; g.save(); g.globalAlpha = A0 * (1 - ph) * .8; g.strokeStyle = shade(col, .4); g.lineWidth = 2 * k * (1 - ph) + .6 * k; g.beginPath(); g.arc(sp[0], sp[1], r + ph * 34 * k, 0, TAU); g.stroke(); g.restore(); }
      g.save(); g.translate(sp[0], sp[1]); g.scale(Math.max(.06, sx), 1); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 5 * k; g.fillStyle = colNow; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.shadowBlur = 0; g.lineWidth = 1.7 * k; g.strokeStyle = '#f7f2e6'; g.stroke(); if (c.cap) { g.fillStyle = '#f7f2e6'; g.beginPath(); g.arc(0, 0, r * .38, 0, TAU); g.fill(); } g.restore();
      // a small flag rises over a captured city
      const captured = o != null && o !== c.side0;
      if (captured && L.flip !== 0) { const rise = fl ? clamp((fl.q - .5) / .8, 0, 1) : 1; if (rise > 0) drawFlag(g, sp[0], sp[1] - r * .6, 28 * k * S.easeOut(rise), col, lt + c.lon, k); }
      const nm = (HK.sc.look.lang === 'en' ? c.n : c.a) || c.n; V.haloText(g, nm, sp[0] + (captured ? 20 : 12) * k, sp[1] + 1 * k, (c.cap ? 19 : 17) * k, '#f7f2e6', 'soft', fam, 800, 'left');
    }
    // caption chips «سقوط مدينة X»
    if (L.captions !== 0) for (const ev of st.evs) {
      if (ev.caption === 0) continue; const dur = Math.max(.1, ev.dur || 2.5); const a = lt - (ev.t + dur * .5); const life = 2.8; if (a < 0 || a > life) continue;
      const P = evPoint(m, ev); if (!P) continue; const sp = vw.project(P[0], P[1]); if (!sp) continue; const sd = sideOf(L, ev.to);
      if (ev.kind === 'victory' || ev.kind === 'truce') continue; const txt = WR.evCaption(L, m, ev);
      const q = Math.min(1, a / .35) * Math.min(1, (life - a) / .5); const sbr = L.__sb; let cy = sp[1] - 44 * k; if (sbr && sp[0] > sbr[0] - 160 * k && sp[0] < sbr[2] + 160 * k && cy < sbr[3] + 20 * k && cy > sbr[1] - 20 * k) cy = sp[1] + 40 * k; chip(g, sp[0], cy - 8 * k * (1 - q), txt, sd ? sd.color : '#e5243b', k, fam, A0 * q);
    }
    // truce lines (dashed, from the event on)
    for (const ev of st.evs) { if (ev.kind !== 'truce' || !ev.line || ev.line.length < 2) continue; const a = clamp((lt - ev.t) / .8, 0, 1); if (a <= 0) continue; const pts = V.geoLine(vw, ev.line, 0); if (pts.length < 2) continue; g.save(); g.globalAlpha = A0 * a; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.lineWidth = 6 * k; g.strokeStyle = 'rgba(0,0,0,.5)'; g.stroke(); g.setLineDash([12 * k, 8 * k]); g.lineWidth = 3 * k; g.strokeStyle = '#f4ead0'; g.stroke(); g.setLineDash([]); const mid = pts[Math.floor(pts.length / 2)]; chip(g, mid[0], mid[1] - 26 * k, ev.lineText || 'خط الهدنة', '#f4ead0', k, fam, A0 * a); g.restore(); }
    g.restore();
    if (L.legend !== 0) scoreboard(g, L, m, st, s, W, H, k, fam);
    // victory / truce title card «انتصار X» · «سقوط Y»
    for (const ev of st.evs) {
      if (ev.kind !== 'victory' && ev.kind !== 'truce') continue; if (ev.card === 0) continue; const dur = Math.max(.1, ev.dur || 3.5); const a = lt - (ev.t + dur * .55); const life = ev.cardDur || 4; if (a < 0 || (a > life && !ev.hold)) continue;
      const win = sideOf(L, ev.to), lose = sideOf(L, ev.from); const q = Math.min(1, a / .45) * (ev.hold ? 1 : Math.min(1, (life - a) / .6));
      const title = ev.title || (ev.kind === 'victory' ? 'انتصار ' + (win ? win.name : '') : 'هدنة'); const sub = ev.sub != null ? ev.sub : ev.kind === 'victory' ? 'سقوط ' + (lose ? lose.name : '') : (win && lose ? 'تقسيم بين ' + win.name + ' و' + lose.name : '');
      titleCard(g, W, H, k, fam, title, sub, win ? win.color : '#e5243b', q * A0, a);
    }
  }
  // full-width band with a big title (scales in), accent bars in the winner's colour
  function titleCard(g, W, H, k, fam, title, sub, color, a, age) {
    if (a <= 0) return; const px = 64 * k, spx = 28 * k; const e = S.easeOut(clamp(age / .5, 0, 1)); const bh = (sub ? 170 : 120) * k; const y0 = H * .5 - bh / 2;
    g.save(); g.globalAlpha = a; const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(8,9,12,0)'); gr.addColorStop(.18, 'rgba(8,9,12,.82)'); gr.addColorStop(.82, 'rgba(8,9,12,.82)'); gr.addColorStop(1, 'rgba(8,9,12,0)');
    g.fillStyle = gr; g.fillRect(0, y0, W, bh); const bw = W * .56 * e; g.fillStyle = color; g.fillRect(W / 2 - bw / 2, y0, bw, 4 * k); g.fillRect(W / 2 - bw / 2, y0 + bh - 4 * k, bw, 4 * k);
    g.translate(W / 2, y0 + (sub ? bh * .42 : bh / 2)); const sc = .86 + .14 * e; g.scale(sc, sc);
    V.haloText(g, title, 0, 0, px, '#ffffff', 'soft', fam, 800); if (sub) V.haloText(g, sub, 0, 64 * k, spx, shade(color, .55), 'soft', fam, 700);
    g.restore();
  }
  WR.titleCard = titleCard;
  function drawFlag(g, x, y, h, col, ph, k) {
    g.save(); g.lineCap = 'round'; g.strokeStyle = 'rgba(20,16,12,.9)'; g.lineWidth = 1.6 * k; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h); g.stroke();
    const w = h * .7, fh = h * .42; g.beginPath(); const n = 6; for (let i = 0; i <= n; i++) { const f = i / n; g.lineTo(x + w * f, y - h + Math.sin(ph * 6 + f * 4) * 1.4 * k * f); } for (let i = n; i >= 0; i--) { const f = i / n; g.lineTo(x + w * f, y - h + fh + Math.sin(ph * 6 + f * 4) * 1.4 * k * f); } g.closePath();
    g.fillStyle = col; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 4 * k; g.fill(); g.shadowBlur = 0; g.lineWidth = .8 * k; g.strokeStyle = 'rgba(255,255,255,.7)'; g.stroke(); g.restore();
  }
  // live control panel: contested territory share and cities held, per faction
  WR.score = (L, m, st) => {
    const lost = new Set(); for (const ev of L.events || []) { for (const q of ev.units || []) { const u = m.units.get(q); if (u && u.side0 != null) lost.add(u.side0); } if ((ev.kind === 'victory' || ev.kind === 'truce') && ev.from) lost.add(ev.from); }
    const base = [...m.units.values()].filter(u => u.kind !== 'custom' && (lost.size ? lost.has(u.side0) : true)); let tot = 0; for (const u of base) tot += u.area; tot = tot || 1;
    const out = {}; for (const sd of L.sides || []) out[sd.id] = { pct: 0, cities: 0 };
    for (const u of base) { const pr = st.prog.find(x => x.u === u); if (pr) { const f = S.ease(pr.p); if (out[pr.from]) out[pr.from].pct += u.area * (1 - f); if (out[pr.to]) out[pr.to].pct += u.area * f; } else { const o = st.own.get(u.key); if (out[o]) out[o].pct += u.area; } }
    for (const u of m.customs) { const o = st.own.get(u.key); if (o !== u.side0 && out[o] && lost.has(u.side0)) { out[o].pct += u.area; if (out[u.side0]) out[u.side0].pct -= u.area; } }
    for (const id in out) out[id].pct = clamp(out[id].pct / tot * 100, 0, 100);
    for (const c of m.cities.values()) { const o = st.cityOwn.get(c.key); if (out[o]) out[o].cities++; }
    const baseSides = [...lost]; return { out, baseSides };
  };
  function scoreboard(g, L, m, st, s, W, H, k, fam) {
    const sides = L.sides || []; if (!sides.length) return; const sc = WR.score(L, m, st); const pin = S.easeOut(s.pin);
    const px = 21 * k, rowH = 44 * k, pad = 18 * k; const w = 390 * k; const titleH = 38 * k; const h = pad + titleH + rowH * sides.length + 22 * k + pad;
    const pos = L.legendPos || 'tl'; const m0 = 40 * k; const x0 = pos.includes('l') ? m0 : W - m0 - w, y0 = pos.includes('t') ? m0 : H - m0 - h; Object.defineProperty(L, '__sb', { value: [x0, y0, x0 + w, y0 + h], configurable: true, writable: true, enumerable: false });
    let title = L.legendTitle; if (!title) { const bs = sc.baseSides.map(id => sideOf(L, id)).filter(Boolean); title = bs.length === 1 ? 'السيطرة على أراضي ' + bs[0].name : 'السيطرة الميدانية'; }
    g.save(); g.globalAlpha = s.a * pin; g.translate(0, (1 - pin) * -12 * k);
    g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 18 * k; g.fillStyle = 'rgba(10,12,16,.78)'; g.beginPath(); if (g.roundRect) g.roundRect(x0, y0, w, h, 6 * k); else g.rect(x0, y0, w, h); g.fill(); g.shadowBlur = 0;
    const rtl = isAr(title); V.haloText(g, title, rtl ? x0 + w - pad : x0 + pad, y0 + pad + titleH * .4, px * .95, '#efe7d4', null, fam, 800, rtl ? 'right' : 'left');
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x0 + pad, y0 + pad + titleH * .9, w - pad * 2, 1 * k);
    // stacked share bar
    const by = y0 + pad + titleH + rowH * sides.length + 6 * k; let bx = x0 + pad; const bw = w - pad * 2; let sum = 0; for (const sd of sides) sum += sc.out[sd.id].pct; sum = Math.max(sum, 100);
    for (const sd of (rtl ? sides.slice().reverse() : sides)) { const ww = bw * sc.out[sd.id].pct / sum; g.fillStyle = sd.color; g.fillRect(bx, by, ww, 7 * k); bx += ww; }
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = .8 * k; g.strokeRect(x0 + pad, by, bw, 7 * k);
    sides.forEach((sd, i) => {
      const yy = y0 + pad + titleH + rowH * (i + .5); const r = sc.out[sd.id]; const nameX = rtl ? x0 + w - pad - 16 * k : x0 + pad + 16 * k;
      g.fillStyle = sd.color; g.fillRect(rtl ? x0 + w - pad - 6 * k : x0 + pad, yy - 10 * k, 6 * k, 20 * k);
      V.haloText(g, sd.name || '', nameX, yy, px, '#ffffff', null, fam, 800, rtl ? 'right' : 'left');
      const pct = r.pct.toFixed(r.pct < 10 ? 1 : 0) + '%'; const numX = rtl ? x0 + pad : x0 + w - pad;
      V.haloText(g, pct, numX + (rtl ? 0 : 0), yy - 1 * k, px * 1.35, '#ffffff', null, 'Barlow Condensed', 700, rtl ? 'left' : 'right');
      if (m.cities.size) { g.save(); g.font = V.font(px * 1.35, 700, 'Barlow Condensed'); const pw = g.measureText(pct).width; g.restore(); V.haloText(g, r.cities + ' ' + (r.cities === 1 ? 'مدينة' : r.cities === 2 ? 'مدينتان' : r.cities >= 3 && r.cities <= 10 ? 'مدن' : 'مدينة'), rtl ? numX + pw + 10 * k : numX - pw - 10 * k, yy, px * .78, '#b9b3a6', null, fam, 700, rtl ? 'left' : 'right'); }
    });
    g.restore();
  }

  /* ================= camera hints ================= */
  // one camera move per event: frame the captured ground shortly before it falls, then hold
  WR.cameraKeys = (L, scn, o = {}) => {
    const era = G.era(GW.pv(scn.year, 0), scn.eraMode); const fs = G.features(era, 0) || []; const byKey = new Map(fs.map(f => [f.key, f]));
    const m = WR.model(L, era, byKey, fs); const keys = []; const st0 = L.start || 0; const tilt = o.tilt == null ? 18 : o.tilt;
    const zMax = o.zMax || 7.2;
    for (const ev of (L.events || []).slice().sort((a, b) => a.t - b.t)) {
      const us = (ev.units || []).map(q => m.units.get(q)).filter(Boolean); let b = null;
      const pts = []; for (const u of us) { const bb = d3.geoBounds(u.f); pts.push(bb[0], bb[1]); } for (const c of ev.cities || []) { const dd = Math.max(.6, (c.r || 0) / 60); pts.push([c.lon - dd, c.lat - dd * .7], [c.lon + dd, c.lat + dd * .7]); } if (ev.at) pts.push([ev.at[0] - .8, ev.at[1] - .5], [ev.at[0] + .8, ev.at[1] + .5]);
      if (ev.kind === 'victory' || ev.kind === 'truce') for (const u of m.units.values()) if (u.kind !== 'custom' && (u.side0 === ev.from || u.side0 === ev.to)) { const bb = d3.geoBounds(u.f); pts.push(bb[0], bb[1]); }
      if (ev.line) for (const p of ev.line) pts.push(p);
      if (!pts.length) continue; b = d3.geoBounds({ type: 'MultiPoint', coordinates: pts });
      const f = Cm.fit(b, tilt, 0, o.frac || .42); f.zoom = Math.min(zMax, f.zoom);
      keys.push({ t: st0 + Math.max(0, ev.t - (o.lead == null ? .9 : o.lead)), lon: f.lon, lat: f.lat, zoom: f.zoom, tilt });
      keys.push({ t: st0 + ev.t + Math.max(.1, ev.dur || 2.5) + .6, lon: f.lon, lat: f.lat, zoom: f.zoom + .12, tilt });
    }
    keys.sort((a, b) => a.t - b.t); const out = []; for (const kk of keys) { const prev = out[out.length - 1]; if (prev && kk.t - prev.t < .35) { if (kk.t > prev.t) Object.assign(prev, kk); continue; } out.push(kk); }
    return out;
  };
  WR.applyCameraKeys = (scn, keys) => { for (const kk of keys) Cm.setKey(scn.cam, kk.t, { lon: kk.lon, lat: kk.lat, zoom: kk.zoom, tilt: kk.tilt, heading: kk.heading || 0 }, { mode: scn.mode }); };

  /* ================= quick builder «حرب بين دولتين» ================= */
  const PALS = [['#a8322a', '#3c6e8f'], ['#9c3b2f', '#4a7a3c'], ['#b0893a', '#3d5a80']];
  WR.findCountry = (name, era) => { const fs = G.features(era, 0) || []; const r = G.search(String(name), fs, 'ar', era, 6).find(x => x.kind === 'country'); return r ? r.f : null; };
  // o: {a, b, year, events:N, dur, colors:[ca, cb], fx:'mix'|'clash'|'strike'|'none', cities:1}
  WR.buildWar = async (o) => {
    await G.load(); const year = +o.year || 2024; const era = G.era(year, 'auto'); await G.ensureEra(era, 0); if (era.src !== 'hist') await WR.loadA1();
    const FA = WR.findCountry(o.a, era), FB = WR.findCountry(o.b, era); if (!FA) throw new Error('لم أتعرف على الدولة: ' + o.a); if (!FB) throw new Error('لم أتعرف على الدولة: ' + o.b);
    const pal = o.colors || PALS[0]; const nA = G.name(FA, 'ar', era), nB = G.name(FB, 'ar', era);
    const sides = [{ id: 'a', name: nA, color: pal[0], countries: [FA.key], fill: .5, border: 'solid' }, { id: 'b', name: nB, color: pal[1], countries: [FB.key], fill: .45, border: 'solid' }];
    const N = Math.max(1, Math.min(24, +o.events || 5)); const ccB = ccOf(FB); const ccA = ccOf(FA);
    const provs = era.src !== 'hist' ? WR.provinces(ccB) : []; const events = [];
    const vertsOf = (f, n) => { const out = []; const gg = f.geometry; const cs = gg.type === 'Polygon' ? [gg.coordinates] : gg.coordinates; for (const poly of cs) { const r = poly[0]; const st = Math.max(1, Math.floor(r.length / n)); for (let i = 0; i < r.length; i += st) out.push(r[i]); } return out; };
    const near = (pa, pb) => { let bd = 9; for (const p of pa) for (const q of pb) { const d = d3.geoDistance(p, q); if (d < bd) bd = d; } return bd; };
    const dur = +o.dur || Math.round(6 + N * 3.1); const t0 = 2.2, t1 = dur - 3; const step = (t1 - t0) / N; const evDur = Math.min(2.6, step * .85);
    const placesB = WR.cities(ccB);
    if (provs.length) {
      // greedy frontier: always take the province of B nearest to A's current territory
      const front = vertsOf(FA, 900).filter(p => d3.geoDistance(p, FB.lab) < FA.rad + FB.rad + .1); const pv = new Map(provs.map(p => [p.key, vertsOf(p, 120)]));
      const order = provs.filter(p => d3.geoArea(p) > 1e-6).map(p => ({ p, d: near(pv.get(p.key), front) * 3 + near([p.lab], front) })).sort((x, y) => x.d - y.d);
      for (let i = 0; i < N && i < order.length; i++) {
        const best = order[i].p;
        const inP = placesB.filter(c => d3.geoContains(best, [c[0], c[1]])); const city = inP[0];
        events.push({ units: [best.key], cities: city && o.cities !== 0 ? [WR.cityRec(city)] : [] });
      }
    } else {
      // historical era: capture B's cities nearest to A one by one (zones of control)
      const fa = vertsOf(FA, 600); const cs = placesB.filter(c => c[4] <= 8 && d3.geoContains(FB, [c[0], c[1]])).map(c => ({ c, d: near([[c[0], c[1]]], fa) })).sort((x, y) => x.d - y.d).slice(0, N);
      for (const x of cs) events.push({ units: [], cities: [WR.cityRec(x.c)] });
      if (!events.length) events.push({ units: [FB.key], cities: [] });
    }
    const fxs = o.fx === 'clash' ? ['clash'] : o.fx === 'strike' ? ['strike'] : o.fx === 'none' ? ['none'] : ['clash', 'strike'];
    events.forEach((e, i) => Object.assign(e, { id: GW.uid(), t: +(t0 + i * step).toFixed(2), dur: +evDur.toFixed(2), from: 'b', to: 'a', origin: 'border', fx: fxs[i % fxs.length], caption: 1 }));
    // capitals take part (they flip only if captured)
    const capB = placesB.find(c => c[6] & 1), capA = WR.cities(ccA).find(c => c[6] & 1); const cities = []; if (capA) cities.push(WR.cityRec(capA)); if (capB) cities.push(WR.cityRec(capB));
    const L = S.newLayer('campaign', { name: 'حرب: ' + nA + ' – ' + nB, sides, events, cities, start: 0, legendPos: o.legendPos || 'tl' });
    // camera: wide on both, then follow the action, then pull back
    const bb = d3.geoBounds({ type: 'MultiPoint', coordinates: [FA.bounds[0], FA.bounds[1], FB.bounds[0], FB.bounds[1]].map(p => p) });
    const focusB = []; for (const e of events) { const u = e.units[0] && provs.find(p => p.key === e.units[0]); if (u) { const b2 = d3.geoBounds(u); focusB.push(b2[0], b2[1]); } for (const c of e.cities) focusB.push([c.lon, c.lat]); }
    const wideB = FA.rad > .35 && focusB.length ? d3.geoBounds({ type: 'MultiPoint', coordinates: focusB.concat([FB.bounds[0], FB.bounds[1]]) }) : bb; // huge attackers (Russia): frame the theatre, not the whole country
    const wide = Cm.fit(wideB, 0, 0, .78);
    return { layer: L, year, era, dur, wide, nA, nB, FA, FB, focus: FB.lab };
  };
  /* ================= war wizard «حرب بين دولتين» (any era) ================= */
  // o: {year, eraMode, a:{key, name, color}, b:{...}, events:[{kind, city:{…rec}, units:[], r, text}], withProv, cityR, legendPos}
  WR.EV_KINDS = { capture: { ar: 'سيطرة على مدينة', dur: 2.6, fx: 'clash' }, region: { ar: 'سيطرة على منطقة', dur: 2.8, fx: 'none' }, battle: { ar: 'معركة', dur: 3, fx: 'clash' }, advance: { ar: 'تقدم الجبهة', dur: 3, fx: 'none' },
    strike: { ar: 'قصف', dur: 3, fx: 'strike' }, retreat: { ar: 'انسحاب', dur: 2.6, fx: 'none' }, victory: { ar: 'النصر', dur: 3.8, fx: 'none' }, truce: { ar: 'هدنة / تقسيم', dur: 3, fx: 'none' } };
  WR.buildCampaign = async (o) => {
    await G.load(); const year = +o.year || 2024; const era = G.era(year, o.eraMode || 'auto'); await G.ensureEra(era, 0); if (era.src !== 'hist') await WR.loadA1();
    const grp = WR.groups(G.features(era, 0)); const FA = grp.get(o.a && o.a.key), FB = grp.get(o.b && o.b.key);
    if (!FA || !FB) throw new Error('اختر الطرفين من دول هذا العصر'); const nA = (o.a.name || G.name(FA, 'ar', era)), nB = (o.b.name || G.name(FB, 'ar', era));
    const sides = [{ id: 'a', name: nA, color: o.a.color || PALS[0][0], countries: [FA.key], fill: .5, border: 'solid' }, { id: 'b', name: nB, color: o.b.color || PALS[0][1], countries: [FB.key], fill: .45, border: 'solid' }];
    const canProv = era.src !== 'hist' && G.admin1; const provOf = (c) => { if (!canProv) return null; const cc = ccOf(FB); const p = WR.provinces(cc).find(f => d3.geoContains(f, [c.lon, c.lat])); return p ? p.key : null; };
    const evs = []; let t = 2.2; const units = [];
    for (const e0 of o.events || []) {
      const K = WR.EV_KINDS[e0.kind] || WR.EV_KINDS.capture; const ev = { id: GW.uid(), t: +t.toFixed(2), dur: e0.dur || K.dur, from: 'b', to: 'a', origin: 'border', fx: e0.fx || K.fx, caption: 1, units: [], cities: [] };
      const city = e0.city ? Object.assign({}, e0.city) : null; if (city && e0.r) city.r = +e0.r;
      if (e0.kind === 'capture' || e0.kind === 'advance' || e0.kind === 'retreat' || !e0.kind) { if (city) { if (!city.r && era.src === 'hist') city.r = o.cityR || 45; ev.cities = [city]; const pk = o.withProv !== 0 && e0.kind !== 'retreat' ? provOf(city) : null; if (pk) ev.units = [pk]; } if (e0.units) ev.units = ev.units.concat(e0.units); if (e0.kind === 'advance') ev.kind = 'advance'; }
      if (e0.kind === 'region') { ev.units = (e0.units || []).slice(); if (e0.pts && e0.pts.length >= 3) { const id = GW.uid(); units.push({ id, name: e0.place || 'منطقة', pts: e0.pts, side: 'b' }); ev.units.push('U:' + id); } if (!ev.units.length && city) { city.r = e0.r || (o.cityR || 45) * 2.2; ev.cities = [city]; } ev.place = e0.place || (city && city.a); }
      if (e0.kind === 'retreat') { ev.from = 'a'; ev.to = 'b'; ev.kind = 'retreat'; }
      if (e0.kind === 'battle' || e0.kind === 'strike') { ev.kind = e0.kind; if (city) { ev.at = [city.lon, city.lat]; ev.place = city.a || city.n; } }
      if (e0.kind === 'victory') { ev.kind = 'victory'; if (e0.title) ev.title = e0.title; if (e0.sub != null) ev.sub = e0.sub; ev.caption = 0; }
      if (e0.kind === 'truce') { ev.kind = 'truce'; ev.line = e0.line || []; ev.caption = 0; }
      if (e0.text) ev.text = e0.text; if (e0.shake) ev.shake = 1;
      evs.push(ev); t += ev.dur + (ev.kind === 'victory' || ev.kind === 'truce' ? 4.6 : 1.1);
    }
    const dur = Math.max(8, Math.ceil(t + 1.2));
    const cities = []; const capOf = (F) => (WR.citiesOf(F, era, year, 60).find(c => c.cap) || null); const cB = capOf(FB), cA = capOf(FA); if (cA) cities.push(cA); if (cB && (!cA || cB.key !== cA.key)) cities.push(cB);
    const L = S.newLayer('campaign', { name: 'حرب: ' + nA + ' – ' + nB, sides, events: evs, cities, units, start: 0, cityR: o.cityR || (era.src === 'hist' ? 45 : 18), legendPos: o.legendPos || 'tl' });
    const focusB = []; for (const e of evs) { for (const c of e.cities) focusB.push([c.lon, c.lat]); if (e.at) focusB.push(e.at); }
    const big = FA.rad > .35 || FB.rad > .35; const pts = big && focusB.length ? focusB.concat([FB.lab]) : [FA.bounds[0], FA.bounds[1], FB.bounds[0], FB.bounds[1]];
    const wide = Cm.fit(d3.geoBounds({ type: 'MultiPoint', coordinates: pts }), 0, 0, big ? .55 : .78); if (big) wide.zoom = Math.min(wide.zoom, 6.2);
    return { layer: L, year, era, dur, wide, nA, nB, FA, FB, focus: FB.lab };
  };
  // suggested course of a war: the defender's cities nearest the attacker, then victory
  WR.suggestEvents = (era, year, aKey, bKey, n = 3) => {
    const grp = WR.groups(G.features(era, 0)); const FA = grp.get(aKey), FB = grp.get(bKey); if (!FA || !FB) return [];
    const va = []; { const gg = FA.geometry; const cs = gg.type === 'Polygon' ? [gg.coordinates] : gg.coordinates; for (const poly of cs) { const r = poly[0]; const st = Math.max(1, Math.floor(r.length / 300)); for (let i = 0; i < r.length; i += st) va.push(r[i]); } }
    const d = (c) => { let bd = 9; for (const p of va) { const x = d3.geoDistance(p, [c.lon, c.lat]); if (x < bd) bd = x; } return bd; };
    const cs = WR.citiesOf(FB, era, year, 120).map(c => ({ c, d: d(c) - (c.cap ? .05 : 0) })).sort((x, y) => x.d - y.d);
    const out = []; for (const x of cs) { if (out.length >= n) break; if (out.some(e => d3.geoDistance([e.city.lon, e.city.lat], [x.c.lon, x.c.lat]) < .02)) continue; out.push({ kind: 'capture', city: x.c }); }
    const cap = cs.find(x => x.c.cap); if (cap && !out.some(e => e.city.key === cap.c.key)) out.push({ kind: 'capture', city: cap.c });
    out.push({ kind: 'victory' }); return out;
  };
  WR.cameraForWar = (scn, L, wide, dur, o2) => {
    const keys = [{ t: 0, lon: wide.lon, lat: wide.lat, zoom: wide.zoom - .35, tilt: 0 }, { t: 1.6, lon: wide.lon, lat: wide.lat, zoom: wide.zoom, tilt: 8 }];
    const cB = o2 && o2.focus || [wide.lon, wide.lat]; for (const kk of WR.cameraKeys(L, scn, { frac: .4, zMax: wide.zoom + 1.1, tilt: 18 })) if (kk.t > 1.8 && kk.t < dur - 1.6) { kk.lon = kk.lon * .72 + cB[0] * .28; kk.lat = kk.lat * .72 + cB[1] * .28; keys.push(kk); }
    keys.push({ t: dur, lon: wide.lon, lat: wide.lat, zoom: wide.zoom - .1, tilt: 6 });
    scn.cam.keys = []; WR.applyCameraKeys(scn, keys);
  };

  /* ================= leader banner «راية» ================= */
  function bannerColor(sc, Ly) {
    if (Ly.faction) { const [lid, sid] = String(Ly.faction).split(':'); const C = (sc.layers || []).find(x => x.id === lid); const sd = C && sideOf(C, sid); if (sd) return sd.color; }
    return Ly.bannerC || Ly.ring || '#5b6b3a';
  }
  WR.bannerColor = bannerColor;
  // woven fabric texture (threads + slubs), cached tile used as an overlay on the cloth
  let weave = null;
  const weaveTile = () => {
    if (weave) return weave; const c = document.createElement('canvas'); c.width = c.height = 48; const q = c.getContext('2d');
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const warp = (x % 3 === 0) ? 1 : 0, weft = (y % 3 === 0) ? 1 : 0; const v = 128 + (warp ? 34 : -6) + (weft ? -28 : 6) + (rnd(x, y, 7) - .5) * 36 + (rnd(x >> 3, y, 9) > .93 ? 26 : 0); q.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; q.fillRect(x, y, 1, 1); }
    weave = c; return c;
  };
  const brassG = (g, x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, '#f6e1a0'); gr.addColorStop(.35, '#d7ad5a'); gr.addColorStop(.6, '#a87a32'); gr.addColorStop(.82, '#e4c47c'); gr.addColorStop(1, '#6e4e1d'); return gr; };
  WR.brassG = brassG;
  // parchment ribbon with the name (folded ends, gold edges) — shared by the banner and the portrait frames
  WR.ribbon = (g, Ly, y, minW, sz, fam, q) => {
    const nm = String(Ly.name || ''); if (!nm && !Ly.sub) return 0; const ar = isAr(nm); const fpx = (ar ? 15 : 11.5) * sz; const ffam = ar ? (/thmanyah/.test(fam) ? fam : 'Amiri') : 'Amiri';
    g.save(); g.font = V.font(fpx, 700, ffam); if ('letterSpacing' in g) g.letterSpacing = ar ? '0px' : (fpx * .14).toFixed(1) + 'px'; const tw = g.measureText(ar ? nm : nm.toUpperCase()).width; if ('letterSpacing' in g) g.letterSpacing = '0px'; g.restore();
    const rw = Math.max(minW, tw + 30 * sz) / 2, rh = 11.5 * sz; g.save(); g.globalAlpha *= q == null ? 1 : q;
    if (nm) {
      for (const sg of [-1, 1]) { // folded tails: back fold (dark) then the tail
        g.fillStyle = '#6f5a35'; g.beginPath(); g.moveTo(sg * rw * .9, ry(y, rh, -.62)); g.lineTo(sg * (rw + 3 * sz), y - rh * .2); g.lineTo(sg * rw * .9, y + rh * .9); g.closePath(); g.fill();
        const tg = g.createLinearGradient(0, y - rh, 0, y + rh); tg.addColorStop(0, '#cdb688'); tg.addColorStop(1, '#8f7748'); g.fillStyle = tg;
        g.beginPath(); g.moveTo(sg * (rw + 2 * sz), y - rh * .5); g.lineTo(sg * (rw + 13 * sz), y - rh * .25); g.lineTo(sg * (rw + 7 * sz), y + rh * .35); g.lineTo(sg * (rw + 13 * sz), y + rh * 1.05); g.lineTo(sg * (rw + 2 * sz), y + rh * .9); g.closePath(); g.fill();
      }
      const pr = g.createLinearGradient(0, y - rh, 0, y + rh); pr.addColorStop(0, '#f4ead0'); pr.addColorStop(.5, '#e2cfa2'); pr.addColorStop(1, '#bba070');
      g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 7 * sz; g.shadowOffsetY = 2 * sz; g.fillStyle = pr;
      g.beginPath(); g.moveTo(-rw, y - rh); g.quadraticCurveTo(0, y - rh - 3.5 * sz, rw, y - rh); g.lineTo(rw, y + rh); g.quadraticCurveTo(0, y + rh - 3.5 * sz, -rw, y + rh); g.closePath(); g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.save(); g.clip(); g.globalAlpha *= .1; g.fillStyle = g.createPattern(weaveTile(), 'repeat'); g.fillRect(-rw, y - rh - 4 * sz, rw * 2, rh * 2 + 8 * sz); g.restore();
      g.lineWidth = .9 * sz; g.strokeStyle = 'rgba(176,132,58,.95)'; for (const e of [-1, 1]) { g.beginPath(); g.moveTo(-rw + 3 * sz, y + e * (rh - 2.6 * sz) - 1.6 * sz); g.quadraticCurveTo(0, y + e * (rh - 2.6 * sz) - 5 * sz, rw - 3 * sz, y + e * (rh - 2.6 * sz) - 1.6 * sz); g.stroke(); }
      g.fillStyle = '#2c2114'; g.font = V.font(fpx, 700, ffam); g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = ar ? 'rtl' : 'ltr'; if ('letterSpacing' in g) g.letterSpacing = ar ? '0px' : (fpx * .14).toFixed(1) + 'px';
      g.fillStyle = 'rgba(255,248,226,.55)'; g.fillText(ar ? nm : nm.toUpperCase(), 0, y - 1.2 * sz + .8 * sz); g.fillStyle = '#2c2114'; g.fillText(ar ? nm : nm.toUpperCase(), 0, y - 1.2 * sz); if ('letterSpacing' in g) g.letterSpacing = '0px';
    }
    if (Ly.sub) V.haloText(g, Ly.sub, 0, y + rh + 11 * sz, 10.5 * sz, '#efe6d0', 'soft', ar ? fam : 'Amiri', 700);
    g.restore(); return rh * 2 + (Ly.sub ? 20 * sz : 0);
  };
  const ry = (y, rh, f) => y + rh * f;
  V.banner = (g, sc, Ly, sp, s, k, fam) => {
    const sz = (Ly.size || 1) * (Ly.scale == null ? 1 : Ly.scale) * k; const lt = s.lt; const seed = strSeed(Ly.id) % 100;
    const bw = 112 * sz, bh = 150 * sz, poleH0 = 220 * sz; const a = s.a * Math.min(1, s.pin * 3);
    // stacking: a banner whose cloth would cover an earlier one hangs lower and leans away
    let poleH = poleH0, lean = 0; const box = () => [sp[0] + lean - bw * .6, sp[1] - poleH - 10 * sz, sp[0] + lean + bw * .6, sp[1] - poleH + bh + 34 * sz];
    for (let it = 0; it < 4; it++) { const bx = box(); const hit = (WR.banners || []).find(q => bx[0] < q[2] - bw * .3 && bx[2] > q[0] + bw * .3 && bx[1] < q[3] && bx[3] > q[1]); if (!hit) break; poleH = poleH0 - bh * .3; const dir = sp[0] + lean >= (hit[0] + hit[2]) / 2 ? 1 : -1; const need = dir > 0 ? hit[2] - bx[0] : bx[2] - hit[0]; lean += dir * Math.max(4 * sz, need - bw * .3 + 2 * sz); }
    (WR.banners = WR.banners || []).push(box());
    const raise = S.easeOut(clamp(s.pin * 1.8, 0, 1)), unroll = S.ease(clamp((s.pin - .35) / .65, 0, 1));
    const col = bannerColor(sc, Ly); const cloth = mix(mix(col, '#2f3324', .28), '#1b1a17', .08); const dark = shade(cloth, -.5), light = shade(cloth, .26);
    const top = [sp[0] + lean, sp[1] - poleH * raise];
    g.save(); g.globalAlpha = a;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(sp[0], sp[1], 9 * sz, 3.6 * sz, 0, 0, TAU); g.fill();
    g.strokeStyle = rgba(col, .9); g.lineWidth = 1.6 * sz; g.beginPath(); g.ellipse(sp[0], sp[1], 6.5 * sz, 2.6 * sz, 0, 0, TAU); g.stroke();
    const pg0 = g.createLinearGradient(sp[0] - 3 * sz, 0, sp[0] + 3 * sz, 0); pg0.addColorStop(0, '#7a5e40'); pg0.addColorStop(.45, '#4a3624'); pg0.addColorStop(1, '#22180f');
    g.strokeStyle = pg0; g.lineWidth = 3.4 * sz; g.lineCap = 'round'; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 6 * sz; g.beginPath(); g.moveTo(sp[0], sp[1]); g.lineTo(top[0], top[1]); g.stroke(); g.shadowBlur = 0;
    if (raise < .98) { g.restore(); return; }
    // wind: a slow gust envelope drives the sway, the hem lift and the ripples travelling down the cloth
    const gust = .55 + .45 * Math.sin(lt * .37 + seed) * Math.sin(lt * .23 + seed * .7);
    const sway = (Math.sin(lt * 1.15 + seed) * .018 + Math.sin(lt * 2.3 + seed * 2) * .006) * (.7 + .6 * gust);
    g.translate(top[0], top[1] + 6 * sz); g.rotate(sway);
    // finial: brass crescent-blade + collar
    g.fillStyle = brassG(g, -5 * sz, -22 * sz, 5 * sz, -4 * sz); g.beginPath(); g.moveTo(0, -23 * sz); g.quadraticCurveTo(6 * sz, -13 * sz, 0, -6 * sz); g.quadraticCurveTo(-6 * sz, -13 * sz, 0, -23 * sz); g.fill();
    g.beginPath(); g.arc(0, -5 * sz, 2.8 * sz, 0, TAU); g.fill(); g.fillRect(-2.2 * sz, -3.4 * sz, 4.4 * sz, 3 * sz);
    const cbw = bw * .62 + 10 * sz; g.fillStyle = brassG(g, 0, -3 * sz, 0, 3 * sz); g.beginPath(); if (g.roundRect) g.roundRect(-cbw, -2.3 * sz, cbw * 2, 4.6 * sz, 2.2 * sz); else g.rect(-cbw, -2.3 * sz, cbw * 2, 4.6 * sz); g.fill();
    for (const sg of [-1, 1]) { g.beginPath(); g.arc(sg * (cbw + 3 * sz), 0, 3.6 * sz, 0, TAU); g.fillStyle = brassG(g, sg * cbw, -4 * sz, sg * cbw, 4 * sz); g.fill(); g.beginPath(); g.arc(sg * (cbw + 3 * sz), 0, 1.4 * sz, 0, TAU); g.fillStyle = '#4b3514'; g.fill(); }
    // cloth geometry
    const H = bh * unroll; const ww = bw / 2;
    const wave = (y, side) => { const f = y / bh; return (Math.sin(lt * 2.4 - y / (15 * sz) + side * .7 + seed) * 2.3 * sz + Math.sin(lt * 4.1 - y / (7 * sz) + seed * 1.3) * .7 * sz) * f * (.6 + .6 * gust); };
    const drift = (y) => Math.sin(lt * 1.3 + seed) * 4.5 * sz * Math.pow(y / bh, 1.6) * gust; // the free hem drifts with the wind
    if (H > 2) {
      const P = new Path2D(); const n = 16; P.moveTo(-ww, 3 * sz);
      for (let i = 0; i <= n; i++) { const y = 3 * sz + H * i / n; P.lineTo(-ww + wave(y, -1) + drift(y), y); }
      const notch = Math.min(H * .2, 26 * sz) * unroll; P.lineTo(-ww * .02 + wave(H, 0) + drift(H), H + 3 * sz - notch);
      for (let i = n; i >= 0; i--) { const y = 3 * sz + H * i / n; P.lineTo(ww + wave(y, 1) + drift(y), y); }
      P.closePath();
      g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 14 * sz; g.shadowOffsetY = 4 * sz; g.fillStyle = cloth; g.fill(P); g.restore();
      g.save(); g.clip(P);
      // folds: vertical light/dark bands drifting with the wave (cloth lit from the upper left)
      const fg = g.createLinearGradient(-ww, 0, ww, 0); for (let i = 0; i <= 10; i++) { const f = i / 10; const v = Math.sin(f * 10 + lt * 1.7 + seed) * .5 + .5; const lit = .25 * (1 - f); fg.addColorStop(f, v > .5 ? rgba(light, (v - .5) * .55 + lit * .4) : rgba(dark, (.5 - v) * .7)); } g.fillStyle = fg; g.fillRect(-ww - 8 * sz, 0, bw + 16 * sz, H + 12 * sz);
      // diagonal ripples travelling down (wind)
      for (let r = 0; r < 3; r++) { const yy = ((lt * 22 * sz + r * bh / 3 + seed * 3) % (bh * 1.2)) - bh * .1; const rg = g.createLinearGradient(0, yy - 14 * sz, 0, yy + 14 * sz); rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(.5, rgba(light, .16 * gust)); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.save(); g.transform(1, 0, -.35, 1, 0, 0); g.fillStyle = rg; g.fillRect(-ww - 30 * sz, yy - 14 * sz, bw + 60 * sz, 28 * sz); g.restore(); }
      // fabric weave + sheen + top/bottom shading
      if (!WR.fast) { g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = .38; g.fillStyle = g.createPattern(weaveTile(), 'repeat'); g.scale(sz * .9, sz * .9); g.fillRect(-ww / (sz * .9) - 10, 0, bw / (sz * .9) + 20, H / (sz * .9) + 10); g.restore(); }
      const sh = g.createLinearGradient(-ww, 0, ww * .4, H); sh.addColorStop(0, 'rgba(255,240,210,.14)'); sh.addColorStop(.45, 'rgba(255,240,210,0)'); g.fillStyle = sh; g.fillRect(-ww - 5 * sz, 0, bw + 10 * sz, H + 10 * sz);
      const vg = g.createLinearGradient(0, 0, 0, H); vg.addColorStop(0, 'rgba(0,0,0,.42)'); vg.addColorStop(.1, 'rgba(0,0,0,0)'); vg.addColorStop(.78, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.34)'); g.fillStyle = vg; g.fillRect(-ww - 5 * sz, 0, bw + 10 * sz, H + 10 * sz);
      g.lineJoin = 'round'; g.lineWidth = 6 * sz; g.strokeStyle = rgba(dark, .8); g.stroke(P);
      g.restore();
      // gold trim: double piping inside the edge
      g.save(); g.lineJoin = 'round'; g.translate(0, 4 * sz); g.scale(.87, .9); g.lineWidth = 1.6 * sz; g.strokeStyle = 'rgba(120,84,30,.75)'; g.stroke(P); g.lineWidth = 1.1 * sz; g.strokeStyle = brassG(g, -ww, 0, ww, H); g.stroke(P); g.restore();
      g.save(); g.translate(0, 6 * sz); g.scale(.8, .86); g.lineWidth = .6 * sz; g.strokeStyle = 'rgba(232,200,120,.55)'; g.stroke(P); g.restore();
      // fringe on the swallow-tail hem (tassels swing with the wind)
      if (unroll > .9) { g.save(); g.globalAlpha *= clamp((unroll - .9) / .1, 0, 1); g.lineCap = 'round';
        const hem = (f) => { const x = -ww + f * bw; const yb = H + 3 * sz - notch * (1 - Math.abs(f - .5) * 2); return [x + wave(H, f * 2 - 1) + drift(H), yb]; };
        for (let i = 0; i <= 22; i++) { const f = i / 22; const [x, y] = hem(f); const sw = Math.sin(lt * 3 + i * .7 + seed) * 1.6 * sz * gust; g.strokeStyle = i % 2 ? '#c99a4a' : '#e8c87a'; g.lineWidth = 1.1 * sz; g.beginPath(); g.moveTo(x, y - 1 * sz); g.lineTo(x + sw, y + 7 * sz); g.stroke(); }
        g.restore(); }
      // portrait window: arch-topped, crop-aware, desaturated, vignette, double gold frame with a keystone
      const pw = bw * .66, ph = pw * 1.12, px0 = -pw / 2, py0 = 12 * sz;
      if (H > py0 + 8 * sz) {
        const win = new Path2D(); win.moveTo(px0, py0 + ph); win.lineTo(px0, py0 + pw / 2); win.arc(0, py0 + pw / 2, pw / 2, Math.PI, 0); win.lineTo(px0 + pw, py0 + ph); win.closePath();
        g.save(); g.beginPath(); g.rect(-ww - 10 * sz, 0, bw + 20 * sz, H); g.clip(); g.save(); g.clip(win); g.fillStyle = '#1d1c19'; g.fillRect(px0, py0, pw, ph);
        const im = V.img(sc, Ly.img);
        if (im) { if (!WR.fast) g.filter = 'saturate(.72) contrast(1.06) sepia(.12)'; V.drawCrop(g, im, Ly.crop, px0, py0, pw, ph, .3); g.filter = 'none'; }
        else { g.fillStyle = 'rgba(240,230,210,.28)'; g.beginPath(); g.arc(0, py0 + ph * .42, pw * .2, 0, TAU); g.fill(); g.beginPath(); g.ellipse(0, py0 + ph * .95, pw * .36, ph * .26, 0, Math.PI, 0); g.fill(); }
        const vgn = g.createRadialGradient(0, py0 + ph * .45, pw * .2, 0, py0 + ph * .5, pw * .85); vgn.addColorStop(0, 'rgba(0,0,0,0)'); vgn.addColorStop(1, 'rgba(10,8,4,.62)'); g.fillStyle = vgn; g.fillRect(px0, py0, pw, ph); g.restore();
        g.lineWidth = 2.6 * sz; g.strokeStyle = 'rgba(40,26,8,.7)'; g.stroke(win); g.lineWidth = 1.8 * sz; g.strokeStyle = brassG(g, px0, py0, px0 + pw, py0 + ph); g.stroke(win);
        g.save(); g.translate(0, 0); const w2 = new Path2D(); w2.addPath(win, new DOMMatrix().translate(0, py0 + ph / 2).scale(1.09, 1.06).translate(0, -(py0 + ph / 2))); g.lineWidth = .7 * sz; g.strokeStyle = 'rgba(226,190,110,.7)'; g.stroke(w2); g.restore();
        g.fillStyle = brassG(g, -4 * sz, py0 - 6 * sz, 4 * sz, py0 + 2 * sz); g.beginPath(); g.moveTo(0, py0 - 6.5 * sz); g.lineTo(4 * sz, py0 - 1.5 * sz); g.lineTo(0, py0 + 2.5 * sz); g.lineTo(-4 * sz, py0 - 1.5 * sz); g.closePath(); g.fill();
        g.restore();
      }
      const ryy = Math.min(H - 6 * sz, py0 + ph + 13 * sz);
      if (unroll > .85 && (Ly.name || Ly.sub)) WR.ribbon(g, Ly, ryy, bw * .95, sz, fam, clamp((unroll - .85) / .15, 0, 1));
    }
    g.restore();
  };

  /* ================= portrait frames: oval medallion «ميدالية» · heraldic shield «درع» · coin / seal «عملة» ================= */
  V.leaderFrame = (g, sc, Ly, sp, s, k, fam) => {
    const sz = 120 * k * (Ly.size || 1) * (Ly.scale == null ? 1 : Ly.scale); const u = sz / 120;
    const pop = Ly.in === 'pop' ? Math.max(0, S.back(s.pin)) : Ly.in === 'grow' ? S.easeOut(s.pin) : Ly.in === 'zoom' ? 1.6 - .6 * S.easeOut(s.pin) : 1;
    const a = s.a * (Ly.in === 'fade' || Ly.in === 'zoom' ? S.easeOut(s.pin) : Ly.in === 'pop' ? Math.min(1, s.pin * 3) : 1);
    const st = V.leaderFrame.styles[Ly.disp]; const hh = st.h * sz; const nameH = Ly.plate !== 0 && (Ly.name || Ly.sub) ? 40 * u : 0;
    const dyk = Ly.dy == null ? -1 : Ly.dy; const dy = dyk < 0 ? dyk * (hh * .5 + nameH + 18 * k) : dyk * sz * .85; const cx = sp[0], cy = sp[1] + dy;
    g.save(); g.globalAlpha = a; const ring = bannerColor(sc, Ly);
    if (dy) { g.strokeStyle = '#c99a4a'; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(sp[0], sp[1]); g.lineTo(cx, cy + Math.sign(-dy) * (hh * .5 + (dy < 0 ? nameH : 0)) * pop); g.stroke(); V.icon(g, 'dot', sp[0], sp[1], 12 * k, ring, 0, 0, 1); }
    g.translate(cx, cy); g.scale(pop, pop);
    st.draw(g, sc, Ly, sz, u, k, ring, s);
    if (Ly.plate !== 0 && (Ly.name || Ly.sub)) WR.ribbon(g, Ly, hh * .5 + 14 * u, Math.max(sz * .9, 90 * u), u, fam, 1);
    g.restore();
  };
  const photo = (g, sc, Ly, x, y, w, h, fy, filt) => { const im = V.img(sc, Ly.img); if (im) { if (!WR.fast && filt) g.filter = filt; V.drawCrop(g, im, Ly.crop, x, y, w, h, fy); g.filter = 'none'; } else { g.fillStyle = '#3a3a36'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(240,230,210,.3)'; g.beginPath(); g.arc(x + w / 2, y + h * .4, w * .2, 0, TAU); g.fill(); g.beginPath(); g.ellipse(x + w / 2, y + h * .98, w * .36, h * .3, 0, Math.PI, 0); g.fill(); } };
  // frame shapes (local coords, centred) — also used by the crop dialog mask
  WR.frameShape = {
    medallion: (g, sz) => { g.beginPath(); g.ellipse(0, 0, sz * .36, sz * .47, 0, 0, TAU); },
    heraldic: (g, sz) => { const w = sz * .4, t = -sz * .44; g.beginPath(); g.moveTo(-w, t); g.lineTo(w, t); g.lineTo(w, sz * .04); g.bezierCurveTo(w, sz * .3, sz * .2, sz * .42, 0, sz * .52); g.bezierCurveTo(-sz * .2, sz * .42, -w, sz * .3, -w, sz * .04); g.closePath(); },
    coin: (g, sz) => { g.beginPath(); g.arc(0, 0, sz * .31, 0, TAU); }
  };
  V.leaderFrame.styles = {
    medallion: { n: 'ميدالية بيضاوية', h: 1.12, draw(g, sc, Ly, sz, u, k, ring) {
      const rx = sz * .44, ry = sz * .56;
      g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 16 * u; g.shadowOffsetY = 5 * u; g.fillStyle = brassG(g, -rx, -ry, rx, ry); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.fill(); g.restore();
      g.fillStyle = '#6e4e1d'; g.beginPath(); g.ellipse(0, 0, rx * .9, ry * .9, 0, 0, TAU); g.fill(); g.fillStyle = brassG(g, rx, ry, -rx, -ry); g.beginPath(); g.ellipse(0, 0, rx * .875, ry * .88, 0, 0, TAU); g.fill();
      for (let i = 0; i < 36; i++) { const an = i / 36 * TAU; g.fillStyle = i % 2 ? '#f3dc9c' : '#b6873c'; g.beginPath(); g.arc(Math.cos(an) * rx * .95, Math.sin(an) * ry * .955, 1.7 * u, 0, TAU); g.fill(); }
      g.save(); WR.frameShape.medallion(g, sz); g.clip(); photo(g, sc, Ly, -sz * .36, -sz * .47, sz * .72, sz * .94, .35, 'sepia(.22) saturate(.8) contrast(1.05)');
      const vg = g.createRadialGradient(0, -sz * .05, sz * .2, 0, 0, sz * .55); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,12,0,.55)'); g.fillStyle = vg; g.fillRect(-sz / 2, -sz / 2, sz, sz); g.restore();
      WR.frameShape.medallion(g, sz); g.lineWidth = 1.4 * u; g.strokeStyle = '#4b3514'; g.stroke();
      // crest: bow on top with ribbon tails in the side colour
      g.save(); g.translate(0, -ry - 2 * u); g.fillStyle = ring; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(sg * 16 * u, -12 * u, sg * 18 * u, 2 * u); g.quadraticCurveTo(sg * 10 * u, 4 * u, 0, 0); g.fill(); g.beginPath(); g.moveTo(sg * 2 * u, 2 * u); g.lineTo(sg * 9 * u, 16 * u); g.lineTo(sg * 5 * u, 15 * u); g.lineTo(sg * 6 * u, 20 * u); g.lineTo(0, 4 * u); g.fill(); }
      g.fillStyle = brassG(g, -4 * u, -4 * u, 4 * u, 4 * u); g.beginPath(); g.arc(0, 0, 4.5 * u, 0, TAU); g.fill(); g.restore();
    } },
    heraldic: { n: 'درع شعار', h: 1.16, draw(g, sc, Ly, sz, u, k, ring) {
      const big = (f) => { g.save(); g.scale(f, f); WR.frameShape.heraldic(g, sz); g.restore(); };
      g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 16 * u; g.shadowOffsetY = 5 * u; big(1.16); g.fillStyle = brassG(g, -sz * .5, -sz * .5, sz * .5, sz * .6); g.fill(); g.restore();
      big(1.09); g.fillStyle = mix(ring, '#101010', .25); g.fill();
      g.save(); big(1.09); g.clip(); g.strokeStyle = rgba(shade(ring, .3), .5); g.lineWidth = 5 * u; for (let i = -6; i < 6; i++) { g.beginPath(); g.moveTo(i * 16 * u - sz, -sz); g.lineTo(i * 16 * u + sz, sz); g.stroke(); } g.restore();
      g.save(); WR.frameShape.heraldic(g, sz); g.clip(); photo(g, sc, Ly, -sz * .4, -sz * .44, sz * .8, sz * .96, .25, 'saturate(.75) contrast(1.08) sepia(.1)');
      const vg = g.createLinearGradient(0, -sz * .5, 0, sz * .55); vg.addColorStop(0, 'rgba(255,240,200,.12)'); vg.addColorStop(.5, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = vg; g.fillRect(-sz / 2, -sz / 2, sz, sz * 1.1); g.restore();
      WR.frameShape.heraldic(g, sz); g.lineWidth = 2.2 * u; g.strokeStyle = brassG(g, -sz * .4, -sz * .4, sz * .4, sz * .5); g.stroke();
      // crown on top
      g.save(); g.translate(0, -sz * .5 - 4 * u); g.fillStyle = brassG(g, -20 * u, -16 * u, 20 * u, 4 * u); g.beginPath(); g.moveTo(-20 * u, 2 * u); g.lineTo(-22 * u, -12 * u); g.lineTo(-11 * u, -4 * u); g.lineTo(0, -17 * u); g.lineTo(11 * u, -4 * u); g.lineTo(22 * u, -12 * u); g.lineTo(20 * u, 2 * u); g.closePath(); g.fill(); g.lineWidth = .8 * u; g.strokeStyle = '#5a3f14'; g.stroke();
      for (const [x, y] of [[-22, -12], [0, -17], [22, -12]]) { g.beginPath(); g.arc(x * u, y * u, 2.4 * u, 0, TAU); g.fillStyle = '#f3dc9c'; g.fill(); } g.fillStyle = ring; g.beginPath(); g.arc(0, -3 * u, 2.6 * u, 0, TAU); g.fill(); g.restore();
    } },
    coin: { n: 'عملة / ختم', h: 1, draw(g, sc, Ly, sz, u, k, ring, s) {
      const R = sz * .5; const metal = Ly.metal === 'silver' ? ['#f4f4f2', '#b9bcc0', '#7b7f86', '#3f4248'] : Ly.metal === 'bronze' ? ['#f0c49a', '#b77a46', '#7c4b26', '#3b2210'] : ['#fbe7a8', '#d8ad55', '#9c7128', '#4d3510'];
      const mg = (r) => { const gr = g.createLinearGradient(-r, -r, r, r); gr.addColorStop(0, metal[0]); gr.addColorStop(.45, metal[1]); gr.addColorStop(.75, metal[2]); gr.addColorStop(1, metal[3]); return gr; };
      g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 16 * u; g.shadowOffsetY = 5 * u; g.fillStyle = mg(R); g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.restore();
      g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = .8 * u; for (let i = 0; i < 120; i++) { const an = i / 120 * TAU; g.beginPath(); g.moveTo(Math.cos(an) * R * .955, Math.sin(an) * R * .955); g.lineTo(Math.cos(an) * R, Math.sin(an) * R); g.stroke(); } // reeded edge
      g.fillStyle = mg(-R); g.beginPath(); g.arc(0, 0, R * .9, 0, TAU); g.fill(); g.fillStyle = mg(R * .86); g.beginPath(); g.arc(0, 0, R * .86, 0, TAU); g.fill();
      g.lineWidth = 1 * u; g.strokeStyle = 'rgba(60,40,10,.45)'; g.beginPath(); g.arc(0, 0, R * .66, 0, TAU); g.stroke(); g.strokeStyle = 'rgba(255,250,220,.5)'; g.beginPath(); g.arc(.8 * u, .8 * u, R * .66, 0, TAU); g.stroke();
      // legend around the rim: Latin names follow the circle; Arabic names sit on a straight band (letters must stay joined)
      const nm = String(Ly.name || ''); const ar = isAr(nm);
      if (nm && !ar) { const txt = nm.toUpperCase(); g.save(); g.font = V.font(10.5 * u, 700, 'Amiri'); g.fillStyle = metal[3]; g.textAlign = 'center'; g.textBaseline = 'middle'; const span = Math.min(Math.PI * 1.25, g.measureText(txt).width / (R * .76) * 1.15); const n = txt.length; for (let i = 0; i < n; i++) { const an = -Math.PI / 2 - span / 2 + span * (i + .5) / n; g.save(); g.rotate(an + Math.PI / 2); g.fillText(txt[i], 0, -R * .76); g.restore(); } g.restore(); }
      for (let i = 0; i < 2; i++) { const an = Math.PI * (.78 + i * .44); g.fillStyle = metal[3]; star(g, Math.cos(an) * R * .76, Math.sin(an) * R * .76, 3.2 * u); }
      g.save(); WR.frameShape.coin(g, sz); g.clip(); photo(g, sc, Ly, -R * .62, -R * .62, R * 1.24, R * 1.24, .3, 'grayscale(1) contrast(1.25) brightness(1.05)');
      if (!WR.fast) { g.globalCompositeOperation = 'color'; g.fillStyle = metal[1]; g.fillRect(-R, -R, R * 2, R * 2); g.globalCompositeOperation = 'source-over'; }
      const hl = g.createLinearGradient(-R * .6, -R * .6, R * .6, R * .6); hl.addColorStop(0, 'rgba(255,255,240,.28)'); hl.addColorStop(.5, 'rgba(255,255,255,0)'); hl.addColorStop(1, 'rgba(40,25,0,.35)'); g.fillStyle = hl; g.fillRect(-R, -R, R * 2, R * 2); g.restore();
      // a slow glint sweeping over the coin
      const gl = ((s.lt * .35) % 2.2) - .6; if (gl > -.4 && gl < 1.4) { g.save(); g.beginPath(); g.arc(0, 0, R, 0, TAU); g.clip(); const sg = g.createLinearGradient(-R + gl * R * 2 - R * .3, -R, -R + gl * R * 2 + R * .3, R); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.5, 'rgba(255,255,240,.25)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sg; g.fillRect(-R, -R, R * 2, R * 2); g.restore(); }
      if (nm && ar && Ly.plate === 0) V.haloText(g, nm, 0, R * .78, 11 * u, metal[3], null, 'Amiri', 700);
    } }
  };
  const star = (g, x, y, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + i * Math.PI / 5; const rr = i % 2 ? r * .45 : r; g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); } g.closePath(); g.fill(); };
  WR.FRAMES = [['banner', 'راية'], ...Object.entries(V.leaderFrame.styles).map(([k, v]) => [k, v.n])];

  /* ================= leader moves «تحرك إلى مدينة» ================= */
  // Ly.moves = [{t, dur, to:[lon,lat], name, style:'direct'|'curve'|'route'|'via', via:[[lon,lat]]}] (layer-local seconds); segments chain
  WR.leaderStart = (Ly) => (Ly.pts && Ly.pts.length >= 2 && !Ly.moves?.length ? Ly.pts[Ly.pts.length - 1] : [+GW.pv(Ly.lon, 0), +GW.pv(Ly.lat, 0)]);
  WR.segPath = (Ly, i) => {
    const mv = Ly.moves[i]; const from = i ? Ly.moves[i - 1].to : [+GW.pv(Ly.lon, 0), +GW.pv(Ly.lat, 0)];
    if (mv.style === 'via' && mv.via && mv.via.length) return { pts: [from, ...mv.via, mv.to], curve: 0 };
    if (mv.style === 'route' && Ly.pts && Ly.pts.length >= 2) return { pts: [from, ...Ly.pts.filter(p => d3.geoDistance(p, from) > .002 && d3.geoDistance(p, mv.to) > .002), mv.to], curve: 0 };
    return { pts: [from, mv.to], curve: mv.style === 'curve' ? .22 : 0 };
  };
  V.leaderMove = (g, vw, Ly, s, k) => {
    const mvs = Ly.moves; const lt = s.lt; let pos = null, sub = null; const col = Ly.trailColor || Ly.ring || '#e8d9a8';
    for (let i = 0; i < mvs.length; i++) {
      const mv = mvs[i]; const sp0 = WR.segPath(Ly, i); const line = smoothPts(V.geoLine(vw, sp0.pts, sp0.curve), 2); if (line.length < 2) continue;
      const u = clamp((lt - mv.t) / Math.max(.1, mv.dur || 3), 0, 1); const Ls = lens(line); const tot = Ls[Ls.length - 1]; const d = S.ease(u) * tot;
      if (lt >= mv.t) {
        // route ahead (faint) + travelled trail
        if (Ly.arrow !== 0 && u < 1) { g.save(); g.globalAlpha = s.a * .55; V.arrow(g, line, { k, width: .38, color: col, style: 'dashed', glow: 0, t: 0 }); g.restore(); }
        if (Ly.trail !== 0) { const n = Math.max(2, Math.ceil(d / (6 * k))); g.save(); g.lineCap = 'round'; for (let j = 1; j <= n; j++) { const a = along(line, Ls, d * (j - 1) / n), b = along(line, Ls, d * j / n); const f = j / n; g.globalAlpha = s.a * (.25 + .75 * f * f) * (u >= 1 ? .55 : 1); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineWidth = 7.5 * k; g.strokeStyle = 'rgba(0,0,0,.28)'; g.stroke(); g.lineWidth = 3.8 * k; g.strokeStyle = col; g.stroke(); } g.restore(); }
        if (Ly.dust !== 0 && u > 0 && u < 1) { const dt = .1, life = 1.1; const e1 = Math.floor(lt / dt); for (let e = e1; e > e1 - life / dt; e--) { const te = e * dt; const uu = (te - mv.t) / Math.max(.1, mv.dur || 3); if (uu <= 0 || uu >= 1) continue; const q = along(line, Ls, S.ease(uu) * tot); const age = lt - te, qa = age / life; puff(g, q[0] + (rnd(i, e, 1) - .5) * 14 * k, q[1] + (rnd(i, e, 2) - .5) * 9 * k - qa * 8 * k, (5 + 12 * qa) * k, .3 * (1 - qa) * (1 - qa), '150,128,98'); } }
        const ap = lt - mv.t - (mv.dur || 3); const end = line[line.length - 1];
        if (ap >= 0 && ap < 1.6 && Ly.pulse !== 0) for (let r = 0; r < 2; r++) { const ph = clamp((ap - r * .3) / 1.2, 0, 1); if (ph <= 0 || ph >= 1) continue; g.save(); g.globalAlpha = s.a * (1 - ph) * .85; g.strokeStyle = col; g.lineWidth = 2.2 * k * (1 - ph) + .6 * k; g.beginPath(); g.arc(end[0], end[1], 8 * k + ph * 46 * k, 0, TAU); g.stroke(); g.restore(); }
        pos = u >= 1 ? end : along(line, Ls, d); if (u < 1 && mv.name && Ly.heading !== 0) sub = (mv.label || 'يتجه إلى {x}').replace('{x}', mv.name);
      }
    }
    if (!pos) return null; return { sp: [pos[0], pos[1]], sub };
  };
  WR.addMove = (Ly, o) => { Ly.moves = Ly.moves || []; const last = Ly.moves[Ly.moves.length - 1]; const t = o.t != null ? +o.t : last ? last.t + (last.dur || 3) + .5 : (Ly.inDur || .6) + .4; const mv = { id: GW.uid(), t: +(+t).toFixed(2), dur: +(o.dur || 3), to: [+o.to[0], +o.to[1]], name: o.name || '', style: o.style || 'curve' }; if (o.via) mv.via = o.via; Ly.moves.push(mv); Ly.moves.sort((a, b) => a.t - b.t); return mv; };
})();
