'use strict';
/* GeoWar Atlas — geographic data: modern countries, provinces, cities, historical borders by date */
(function () {
  const A = GW.Atlas; const G = A.Geo = { files: {}, csCache: new Map(), ready: false };
  const RAD = Math.PI / 180;
  const fetchJ = (n) => G.files[n] || (G.files[n] = fetch('geo/' + n).then(r => { if (!r.ok) throw new Error('geo ' + n); return r.json(); }));
  G.PAL_N = 9;

  /* ---------- Arabic-aware text normalisation for search ---------- */
  G.norm = (s) => String(s || '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/^ال/, '').replace(/ ال/g, ' ').replace(/\s+/g, ' ').trim();

  function enrich(f, src) {
    const p = f.properties; f.src = src;
    f.key = src === 'modern' ? p.id : (p.k || p.n);
    f.en = p.n || ''; f.ar = p.a || p.n || '';
    let lab = (p.lx != null && p.ly != null && (p.lx || p.ly)) ? [p.lx, p.ly] : null;
    if (!lab) { const c = d3.geoCentroid(f); lab = isFinite(c[0]) ? c : [0, 0]; }
    f.lab = lab; f.area = p.ar2 || 0;
    const b = d3.geoBounds(f); f.bounds = b;
    let r = 0; const cx = (b[0][0] + b[1][0]) / 2; for (const q of [[b[0][0], b[0][1]], [b[0][0], b[1][1]], [b[1][0], b[0][1]], [b[1][0], b[1][1]], [cx, b[0][1]], [cx, b[1][1]], [b[0][0], lab[1]], [b[1][0], lab[1]]]) r = Math.max(r, d3.geoDistance(lab, q));
    f.rad = Math.min(Math.PI, r + .02);
    return f;
  }
  function feats(topo, obj, src) { const fc = topojson.feature(topo, topo.objects[obj]); return fc.features.map(f => enrich(f, src)); }
  function colorize(list, keyOf, nb) {
    // greedy graph colouring over keys (stable: order by area desc)
    const adj = new Map(); const add = (a, b) => { if (a === b) return; (adj.get(a) || adj.set(a, new Set()).get(a)).add(b); };
    if (nb) nb.forEach((ns, i) => { for (const j of ns) add(keyOf(list[i]), keyOf(list[j])); });
    const keys = [...new Set(list.map(keyOf))]; const area = new Map(); for (const f of list) area.set(keyOf(f), (area.get(keyOf(f)) || 0) + f.area);
    keys.sort((a, b) => area.get(b) - area.get(a)); const col = new Map();
    for (const k of keys) { const used = new Set([...(adj.get(k) || [])].map(x => col.get(x))); let h = 0; for (const ch of String(k)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; let c = h % G.PAL_N; for (let i = 0; i < G.PAL_N && used.has(c); i++) c = (c + 1) % G.PAL_N; col.set(k, c); }
    return col;
  }

  G.load = () => G._load || (G._load = (async () => {
    const [lo, land, places, regions, hy, capAr] = await Promise.all([fetchJ('modern_lo.json'), fetchJ('land.json'), fetchJ('places.json'), fetchJ('regions.json'), fetchJ('hist/index.json'), fetchJ('cap_ar.json').catch(() => ({}))]); G.capArExtra = capAr;
    G.modernLo = feats(lo, 'c', 'modern'); for (const f of G.modernLo) f.ci = ((f.properties.c || 1) - 1) % G.PAL_N;
    G.byKey = new Map(G.modernLo.map(f => [f.key, f]));
    G.land = topojson.feature(land, land.objects.l);
    G.places = places; G.regions = regions; G.histYears = hy;
    G.ready = true; if (A.onAsset) A.onAsset();
    G.loadHi(); G.loadCS();
  })());
  G.loadHi = () => G._hi || (G._hi = fetchJ('modern_hi.json').then(t => { G.modernHi = feats(t, 'c', 'modern'); for (const f of G.modernHi) f.ci = ((f.properties.c || 1) - 1) % G.PAL_N; if (A.onAsset) A.onAsset(); }));
  G.loadFull = () => G._full || (G._full = fetchJ('modern_full.json').then(t => { G.modernFull = feats(t, 'c', 'modern'); for (const f of G.modernFull) f.ci = ((f.properties.c || 1) - 1) % G.PAL_N; if (A.onAsset) A.onAsset(); }));
  G.loadLandHi = () => G._lh || (G._lh = fetchJ('land_hi.json').then(t => { G.landHi = topojson.feature(t, t.objects.l); if (A.onAsset) A.onAsset(); }));
  G.loadCS = () => G._cs || (G._cs = fetchJ('cshapes.json').then(t => {
    const list = feats(t, 'c', 'cs'); const nb = topojson.neighbors(t.objects.c.geometries);
    const col = colorize(list, f => f.key, nb); for (const f of list) f.ci = col.get(f.key);
    G.cs = list; G.csDated = t.dated || {}; G.csByGw = new Map(); for (const f of list) G.csByGw.set(f.properties.g, f.key);
    if (A.onAsset) A.onAsset();
  }));
  G.loadCSFull = () => G._csf || (G._csf = G.loadCS().then(() => fetchJ('cshapes_full.json')).then(t => {
    const list = feats(t, 'c', 'cs'); list.forEach((f, i) => { f.ci = G.cs[i].ci; f.lab = G.cs[i].lab; }); G.csFull = list; G.csCache.clear(); if (A.onAsset) A.onAsset();
  }));
  // level of detail by zoom: 0 = world, 1 = region, 2 = close-up (full precision)
  G.lodFor = (zoom) => zoom < 3.6 ? 0 : zoom < 5.6 ? 1 : 2;
  G.landFor = (lod) => { if (lod >= 2) { G.loadLandHi(); if (G.landHi) return G.landHi; } return G.land; };
  G.hist = {};
  G.loadHist = (y) => G.hist[y] ? Promise.resolve(G.hist[y]) : (G['_h' + y] || (G['_h' + y] = fetchJ('hist/' + y + '.json').then(t => {
    const list = feats(t, 'h', 'hist'); const nb = topojson.neighbors(t.objects.h.geometries);
    const col = colorize(list, f => f.key, nb); for (const f of list) f.ci = col.get(f.key);
    const colS = colorize(list, f => f.properties.sk || f.key, nb); for (const f of list) f.cs = colS.get(f.properties.sk || f.key);
    G.hist[y] = list; if (A.onAsset) A.onAsset(); return list;
  })));
  G.loadAdmin1 = () => G._a1 || (G._a1 = fetchJ('admin1.json').then(t => { G.admin1 = feats(t, 'p', 'admin1'); for (const f of G.admin1) { f.key = 'P:' + f.properties.cc + ':' + f.en; f.ci = 0; } if (A.onAsset) A.onAsset(); }));
  G.loadWater = () => G._w || (G._w = Promise.all([fetchJ('rivers.json'), fetchJ('lakes.json')]).then(([r, l]) => { G.rivers = topojson.feature(r, r.objects.r); G.lakes = topojson.feature(l, l.objects.l); if (A.onAsset) A.onAsset(); }));

  /* ---------- dates ---------- */
  // decimal year (e.g. 1914.58) ⇄ yyyymmdd integer
  G.decToInt = (dy) => { const y = Math.floor(dy); let f = dy - y; const mdays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; if ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) mdays[1] = 29; let d = Math.floor(f * mdays.reduce((a, b) => a + b, 0)); let m = 0; while (m < 11 && d >= mdays[m]) { d -= mdays[m]; m++; } return y * 10000 + (m + 1) * 100 + (d + 1); };
  G.intToDec = (n) => { const y = Math.floor(n / 10000), m = Math.floor(n / 100) % 100, d = n % 100; const mdays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; if ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) mdays[1] = 29; let doy = d - 1; for (let i = 0; i < m - 1; i++) doy += mdays[i]; return y + (doy + .5) / mdays.reduce((a, b) => a + b, 0); };
  G.MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  G.MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  G.fmtYear = (y, lang) => { y = Math.floor(y); if (lang === 'en') return y < 0 ? (-y) + ' BC' : String(y); return y < 0 ? (-y) + ' ق.م' : String(y); };

  /* ---------- era resolution ---------- */
  // returns {src, id, label} for a decimal year and source mode
  G.era = (year, mode) => {
    mode = mode || 'auto';
    if (mode === 'modern' || (mode === 'auto' && year >= 2020)) return { src: 'modern', id: 'modern' };
    if (mode === 'cs' || (mode === 'auto' && year >= 1886)) { const d = Math.max(18860101, Math.min(20191231, G.decToInt(year))); return { src: 'cs', id: 'cs' + d, d }; }
    const ys = G.histYears || []; let y = ys[0]; for (const v of ys) if (v <= Math.floor(year) + (Math.floor(year) < 0 ? 0 : 0)) y = v;
    return { src: 'hist', id: 'h' + y, y };
  };
  // features for an era (sync; kicks off loading). lod: 'lo'|'hi'
  G.features = (era, lod) => {
    if (!G.ready) { G.load(); return null; }
    lod = lod === 'hi' ? 1 : (typeof lod === 'number' ? lod : 0);
    if (era.src === 'modern') {
      if (lod >= 2) { G.loadFull(); if (G.modernFull) return G.modernFull; }
      if (lod >= 1) { G.loadHi(); if (G.modernHi) return G.modernHi; }
      return G.modernLo;
    }
    if (era.src === 'cs') {
      if (!G.cs) { G.loadCS(); return null; }
      let src = G.cs; if (lod >= 2) { G.loadCSFull(); if (G.csFull) src = G.csFull; }
      const ck = era.d + (src === G.cs ? 'l' : 'f'); let r = G.csCache.get(ck); if (r) return r;
      r = src.filter(f => f.properties.s <= era.d && f.properties.e >= era.d);
      G.csCache.set(ck, r); if (G.csCache.size > 80) G.csCache.delete(G.csCache.keys().next().value);
      return r;
    }
    if (!G.hist[era.y]) { G.loadHist(era.y); return null; }
    return G.hist[era.y];
  };
  G.ensureEra = async (era, lod) => { await G.load(); if (lod >= 2) await G.loadLandHi(); if (era.src === 'modern') { await G.loadHi(); if (lod >= 2) await G.loadFull(); } else if (era.src === 'cs') { await G.loadCS(); if (lod >= 2) await G.loadCSFull(); } else await G.loadHist(era.y); };
  // how precise are borders at this era (for the UI)
  G.precision = (era) => era.src === 'modern' ? { lvl: 3, ar: 'دقيقة جداً — حدود حالية (Natural Earth 1:10m)' } : era.src === 'cs' ? { lvl: 3, ar: 'دقيقة جداً — حدود باليوم (CShapes 2.0)' } : { lvl: 1, ar: 'تقريبية — خريطة تاريخية لسنة ' + G.fmtYear(era.y) + ' (السواحل دقيقة)' };
  // display name of a feature at an era
  G.name = (f, lang, era) => {
    if (lang === 'en') return f.en;
    if (f.src === 'cs' && era && G.csDated[f.en]) { for (const [until, a] of G.csDated[f.en]) if (era.d <= until) return a; }
    return f.ar || f.en;
  };
  // colour index for "empire" mode (owner / ruling power)
  G.ownerCi = (f, featsByKey) => {
    if (f.src === 'cs') { const o = f.properties.o; if (o && o !== f.properties.g && f.properties.st !== 'independent') { const ok = G.csByGw && G.csByGw.get(o); const of = ok && featsByKey && featsByKey.get(ok); if (of) return of.ci; } return f.ci; }
    if (f.src === 'hist') return f.cs != null ? f.cs : f.ci;
    return f.ci;
  };
  G.ownerKey = (f) => { if (f.src === 'cs') { const o = f.properties.o; if (o && o !== f.properties.g && f.properties.st !== 'independent') return (G.csByGw && G.csByGw.get(o)) || f.key; } if (f.src === 'hist') return f.properties.sk || f.key; return f.key; };

  /* ---------- search ---------- */
  // q: text; feats: current era features. returns [{kind, key, name, sub, lon, lat, f, bounds}]
  G.search = (q, feats, lang, era, limit = 30) => {
    const n = G.norm(q); if (!n) return [];
    const out = []; const score = (s) => { const t = G.norm(s); if (!t) return 0; if (t === n) return 100; if (t.startsWith(n)) return 70; if (t.includes(' ' + n)) return 55; if (t.includes(n)) return 40; return 0; };
    const seen = new Set();
    for (const f of feats || []) { if (seen.has(f.key)) continue; const s = Math.max(score(f.ar), score(f.en), score(G.name(f, 'ar', era))); if (s) { seen.add(f.key); out.push({ kind: 'country', key: f.key, name: G.name(f, lang, era), sub: lang === 'en' ? f.ar : f.en, f, s: s + 20, lon: f.lab[0], lat: f.lab[1], bounds: f.bounds }); } }
    if (G.admin1) for (const f of G.admin1) { const s = Math.max(score(f.ar), score(f.en)); if (s >= 55) out.push({ kind: 'province', key: f.key, name: lang === 'en' ? f.en : f.ar, sub: f.properties.cc, f, s: s - 5, lon: f.lab[0], lat: f.lab[1], bounds: f.bounds }); }
    for (const p of G.places || []) { const s = Math.max(score(p[2]), score(p[3])); if (s >= 40) out.push({ kind: 'city', key: 'C:' + p[2] + ':' + p[7], name: lang === 'en' ? p[2] : (p[3] || p[2]), sub: p[7], s: s + (p[6] & 1 ? 10 : 0) - p[4] * .5, lon: p[0], lat: p[1], rank: p[4], cap: p[6] }); }
    for (const p of G.regions || []) { const s = Math.max(score(p[2]), score(p[3])); if (s >= 55) out.push({ kind: 'region', key: 'R:' + p[2], name: lang === 'en' ? p[2] : (p[3] || p[2]), sub: p[5], s: s - 10, lon: p[0], lat: p[1] }); }
    out.sort((a, b) => b.s - a.s); return out.slice(0, limit);
  };
  // feature at lon/lat among feats (bbox prefilter + geoContains)
  G.hit = (feats, ll) => {
    if (!feats || !ll) return null; let best = null;
    for (const f of feats) { if (d3.geoDistance(f.lab, ll) > f.rad + .05) continue; if (d3.geoContains(f, ll)) { if (!best || f.area < best.area) best = f; } }
    return best;
  };
})();
