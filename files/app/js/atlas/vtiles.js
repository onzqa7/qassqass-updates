'use strict';
/* GeoWar Atlas — vector tiles: countries / borders / coasts / rivers / provinces rasterised once per
   Web-Mercator tile (like a real map renderer), cached on the GPU and draped on the globe with the imagery.
   The per-frame Canvas2D work is then limited to animated layers and labels. */
(function () {
  const A = GW.Atlas; const G = A.Geo, S = A.Scene, PR = A.Providers;
  const VT = A.VT = { specs: new Map(), size: 512 };
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const setIds = new WeakMap(); let setSeq = 0;
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  // stable signature of a feature set (so animated dates reuse tiles while borders don't change)
  function setSig(list) { if (!list) return 'none'; let s = setIds.get(list); if (!s) { s = list.length + '_' + hashStr(list.map(f => f.key + ':' + (f.properties.s || '')).join('|')); setIds.set(list, s); } return s; }
  const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / Math.pow(2, z)))) * DEG;

  // register the vector look of a scene for this frame; returns provider id (or null if nothing to draw)
  VT.provider = (sc, E, era) => {
    const L = sc.look; const st = E.st;
    const fs0 = G.features(era, 0);
    const drawsAnything = E.vector || E.fill !== 'none' || L.borders || L.graticule || L.rivers || L.provinces || st.grid;
    if (!drawsAnything) return null;
    const look = { vector: E.vector ? 1 : 0, ocean: st.ocean, ocean2: st.ocean2, land: st.land, fill: E.fill, fillA: E.fillA, pal: (st.palette || 'vivid'), border: st.border, bw: (st.bw || 1) * (L.borderW || 1), coast: L.coast ? (st.coast || st.border) : null, borders: L.borders ? 1 : 0, glow: st.glow ? 1 : 0,
      grid: (st.grid || L.graticule) ? (st.gridC || (E.vector ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.22)')) : null, rivers: L.rivers && G.rivers ? 1 : 0, lakes: L.lakes && G.lakes && E.vector ? 1 : 0, prov: L.provinces && era.src === 'modern' && G.admin1 ? 1 : 0, era: era.src === 'cs' ? 'cs' + setSig(fs0) : era.id, land: G.landHi ? 'h' : 'l' };
    const id = 'vec:' + hashStr(JSON.stringify(look));
    if (!VT.specs.has(id)) VT.specs.set(id, { look, era: { ...era } });
    else VT.specs.get(id).era = { ...era }; // same border set: any date inside it renders identically
    if (!PR.P[id]) PR.P[id] = { max: 16, size: 512, kind: 'vec' };
    if (VT.specs.size > 40) { const k0 = VT.specs.keys().next().value; VT.specs.delete(k0); }
    return id;
  };

  const patC = new Map();
  function hatch(ctx, color) { let c = patC.get(color); if (!c) { c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.strokeStyle = color; g.lineWidth = 3; g.beginPath(); g.moveTo(-4, 20); g.lineTo(20, -4); g.moveTo(-4, 4); g.lineTo(4, -4); g.moveTo(12, 20); g.lineTo(20, 12); g.stroke(); patC.set(color, c); } return ctx.createPattern(c, 'repeat'); }
  function boundsHit(b, lo0, lo1, la0, la1) {
    if (b[1][1] < la0 || b[0][1] > la1) return false;
    const w = b[0][0], e = b[1][0];
    if (w <= e) return !(e < lo0 || w > lo1);
    return !(180 < lo0 || w > lo1) || !(e < lo0 || -180 > lo1);
  }
  // render tile entry e = {p, z, x, y} → canvas
  VT.render = (e) => {
    const spec = VT.specs.get(e.p); if (!spec) throw new Error('vt spec missing');
    const L = spec.look; const z = e.z, x = e.x, y = e.y; const SZ = VT.size, n2 = Math.pow(2, z);
    const cv = document.createElement('canvas'); cv.width = cv.height = SZ; const g = cv.getContext('2d');
    const proj = d3.geoMercator().scale(SZ * n2 / (2 * Math.PI)).translate([SZ * n2 / 2 - x * SZ, SZ * n2 / 2 - y * SZ]).clipExtent([[-6, -6], [SZ + 6, SZ + 6]]).precision(.35);
    const path = d3.geoPath(proj, g);
    const lo0 = x / n2 * 360 - 180, lo1 = (x + 1) / n2 * 360 - 180, la0 = tileLat(y + 1, z), la1 = tileLat(y, z); const pad = (lo1 - lo0) * .03;
    const lod = z < 4 ? 0 : z < 6 ? 1 : 2;
    const feats = (G.features(spec.era, lod) || G.features(spec.era, 0) || []).filter(f => boundsHit(f.bounds, lo0 - pad, lo1 + pad, la0 - pad, la1 + pad));
    const land = G.landFor(lod);
    const k = 2 * Math.max(.8, Math.min(2.2, .75 + z * .12)); // line scale (texels)
    const pal = S.PAL[L.pal] || S.PAL.vivid;
    if (L.vector) { g.fillStyle = L.ocean; g.fillRect(0, 0, SZ, SZ); if (land) { g.beginPath(); path(land); g.fillStyle = L.land; g.fill(); } }
    if (L.fill !== 'none' && feats.length) {
      g.save(); if (spec.era.src !== 'modern' && land) { g.beginPath(); path(land); g.clip(); }
      g.globalAlpha = L.fillA; const byKey = new Map((G.features(spec.era, 0) || []).map(f => [f.key, f]));
      for (const f of feats) { const ci = L.fill === 'empire' ? G.ownerCi(f, byKey) : f.ci; g.beginPath(); path(f); g.fillStyle = pal[(ci || 0) % pal.length]; g.fill(); }
      if (spec.era.src === 'cs') { g.globalAlpha = L.fillA * .5; for (const f of feats) { if (f.properties.st === 'independent') continue; g.beginPath(); path(f); g.fillStyle = hatch(g, 'rgba(0,0,0,.35)'); g.fill(); } }
      g.restore();
    }
    if (L.grid) { g.beginPath(); path(d3.geoGraticule10()); g.lineWidth = .8 * k; g.strokeStyle = L.grid; g.stroke(); }
    if (L.lakes && G.lakes) { g.beginPath(); path(G.lakes); g.fillStyle = L.ocean; g.fill(); }
    if (L.rivers && G.rivers) { g.beginPath(); path(G.rivers); g.lineWidth = .9 * k; g.strokeStyle = L.vector ? shade(L.ocean, -.05) : 'rgba(140,195,255,.7)'; g.stroke(); }
    if (L.prov && G.admin1 && z >= 3) { const ps = G.admin1.filter(f => boundsHit(f.bounds, lo0 - pad, lo1 + pad, la0 - pad, la1 + pad)); g.beginPath(); for (const f of ps) path(f); g.setLineDash([3 * k, 3 * k]); g.lineWidth = .6 * k; g.strokeStyle = L.vector ? 'rgba(120,120,120,.55)' : 'rgba(255,255,255,.4)'; g.stroke(); g.setLineDash([]); }
    if (L.borders && feats.length) {
      g.save(); if (spec.era.src !== 'modern' && land) { g.beginPath(); path(land); g.clip(); }
      g.beginPath(); for (const f of feats) path(f); g.lineJoin = 'round';
      if (L.glow) { g.shadowColor = L.border; g.shadowBlur = 6 * k; }
      if (!L.vector) { g.lineWidth = L.bw * 2.4 * k; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke(); }
      g.lineWidth = L.bw * k; g.strokeStyle = L.border; g.stroke(); g.restore();
    }
    if (L.coast && L.vector && land) { g.beginPath(); path(land); g.lineWidth = 1 * k; g.strokeStyle = L.coast; g.stroke(); }
    return cv;
  };
  function shade(h, kk) { const c = S.rgb(h).map(v => Math.max(0, Math.min(1, kk > 0 ? v + (1 - v) * kk : v * (1 + kk)))); return `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`; }
})();
