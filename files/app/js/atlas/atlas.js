'use strict';
/* GeoWar Atlas — render orchestration (used by the compositor, the Program monitor and export) */
(function () {
  const A = GW.Atlas; const G = A.Geo, S = A.Scene, Cm = A.Cam, V = A.Vec;
  const cvB = document.createElement('canvas'), cvT = document.createElement('canvas');
  A.onAsset = null;
  A.Tiles.onLoad = () => { if (A.onAsset) A.onAsset(); };
  G.load().catch(e => console.error('geo load', e));

  // evaluate the scene at clip time t
  A.evalAt = (sc, t, W, H) => {
    const year = GW.pv(sc.year, t); const era = G.era(year, sc.eraMode);
    const cam = Cm.at(sc.cam, t, sc.mode); const vw = Cm.build(cam, W, H, sc.mode);
    const lod = G.lodFor(cam.zoom + Math.log2(H / Cm.REF_H) * .5);
    return { year, era, cam, vw, lod };
  };
  A.glStyle = (sc, E) => {
    const st = E.st, L = sc.look, gr = E.grade; const hex = (h, d) => h ? S.rgb(h) : d;
    return {
      sat: gr.sat * (L.sat == null ? 1 : L.sat), bri: gr.bri * (L.bri == null ? 1 : L.bri), con: gr.con * (L.con == null ? 1 : L.con), warm: L.warm || 0, tint: gr.tint, tintAmt: gr.tintAmt || 0, gamma: (gr.gamma || 1) * (L.gamma == null ? 1 : L.gamma), ge: gr.ge || 0, gain: gr.gain, lvl: gr.lvl, wGain: gr.wGain, wAmt: gr.wAmt == null ? 0 : gr.wAmt * (L.wAmt == null ? 1 : L.wAmt), geW: gr.geW, geT: gr.geT, geS: gr.geS, geL: gr.geL,
      light: L.light || st.light || 0, sunLon: L.sunLon, sunLat: L.sunLat, nightAmt: 1,
      space: st.space, space2: st.space2, atmoCol: st.atmo, atmo: L.atmo == null ? 1 : L.atmo, stars: E.stars,
      bgFlat: hex(st.bgFlat || st.ocean, [0.02, 0.03, 0.05]),
    };
  };
  // imagery LOD bias (Google-Earth-like sharpness): finer tiles at export (and 'high' preview); export ensure() and render agree
  A.imgBias = (opts) => { if (opts.zBias != null) return opts.zBias; if (opts.fast) return 0; const q = opts.quality == null ? 1 : opts.quality; return q >= 1 ? .6 : q >= .8 ? .25 : 0; };
  const imgBias = A.imgBias;
  A.render = (scene, t, W, H, opts = {}) => {
    // paused / not interacting: finish all vector tiles in this frame so the picture does not keep changing after it is shown
    A.Tiles.vecBudget = opts.fast ? 14 : (opts.exporting ? 100000 : 120);
    let sc = scene; const E = S.eff(sc);
    let { year, era, vw, lod } = A.evalAt(sc, t, W, H);
    if (opts.fast) { lod = Math.min(lod, 1); sc = Object.assign({}, sc, { look: Object.assign({}, sc.look, { cities: 0, provinces: 0, rivers: 0, oceans: 0, regions: 0 }) }); }
    vw.proj.precision((opts.quality || 1) < 1 ? 1.1 : .5);
    const feats = G.features(era, lod) || G.features(era, 0);
    if (sc.look.rivers || sc.look.lakes) G.loadWater(); if (sc.look.provinces) G.loadAdmin1(); if (lod >= 1) G.loadLandHi();
    const vec = A.VT.provider(sc, E, era);
    let res; const tv0 = performance.now();
    try { res = V.draw(cvB, cvT, vw, sc, t, opts.dur || 1e9, E, era, feats, lod, { year, vt: !!vec }); }
    catch (e) { console.error('atlas vector', e); }
    const overlays = [];
    if (E.hill > 0) overlays.push({ prov: 'hillshade', mode: 1, alpha: E.hill });
    if (sc.look.refLabels) overlays.push({ prov: 'labels', mode: 2, alpha: 1 });
    const L = { st: A.glStyle(sc, E), base: E.vector ? null : E.base, baseTex: E.vector ? null : E.baseTex, baseColor: E.vector ? S.rgb(E.st.ocean2 || E.st.ocean) : null, vec, overlays, terrain: sc.look.terrain == null ? 0 : +sc.look.terrain, cvBase: cvB, cvTop: cvT, bg: opts.bg || 'full', quality: (sc.look.quality || 1) * (opts.quality || 1), zBias: imgBias(opts), vecBias: imgBias(opts) * .5, post: Object.assign({ seed: t * 7.13 % 100 }, E.post) };
    const tg0 = performance.now(); const r = A.GL.frame(vw, L); A.stats = { vec: tg0 - tv0, gl: performance.now() - tg0 };
    A.last = { vw, era, feats, res, want: r.want, year };
    return r.canvas;
  };
  // wait for everything a frame needs (data, tiles, images, fonts)
  A.ensure = async (scene, t, W, H, opts = {}) => {
    const { era, lod } = A.evalAt(scene, t, W, H);
    await G.ensureEra(era, lod).catch(() => {});
    if (scene.look.rivers || scene.look.lakes) await G.loadWater().catch(() => {});
    if (scene.look.provinces) await G.loadAdmin1().catch(() => {});
    await V.imgsReady(scene);
    if (document.fonts && document.fonts.load) { const fam = S.eff(scene).font; await Promise.all(['900', '800', '700'].map(w => document.fonts.load(`${w} 40px "${fam}"`, 'عربي').catch(() => {}))); }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const vb = A.Tiles.vecBudget; A.Tiles.vecBudget = 100000;
    try {
      for (let i = 0; i < 5; i++) {
        A.render(scene, t, W, H, opts); A.Tiles.pump(); const want = (A.last.want || []).filter(e => e.st < 2);
        if (!want.length) break; await A.Tiles.wait(want, opts.timeout || 15000);
      }
    } finally { A.Tiles.vecBudget = vb; }
  };
  // what is under screen point (x,y)?
  A.pick = (scene, t, W, H, x, y) => {
    const { era, vw, lod } = A.evalAt(scene, t, W, H); const ll = vw.pick(x, y); if (!ll) return null;
    const feats = G.features(era, lod) || G.features(era, 0); const f = G.hit(feats, ll);
    return { ll, f, era, vw };
  };
  A.newScene = (o = {}) => { const sc = S.blank(); Object.assign(sc, o); return sc; };
})();
