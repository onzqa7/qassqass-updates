'use strict';
/* 3D object library for «مشهد ثلاثي الأبعاد» (js/s3d.js): rooms, furniture, screens, primitives, lights.
   Everything is built procedurally from three.js geometry + PBR materials + canvas textures (original work, no
   third-party models). Builders get the kit K and the object description; screen meshes are tagged
   userData.screen (the runtime maps project media / sequences onto them), parts recoloured by the inspector are
   tagged userData.main, viewport-only gizmos userData.vhelper. Units: metres, Y up, origin on the floor. */
(function () {
  const S = GW.S3D; const K = S.K = {};
  const T = () => S.T;
  const rng = (seed) => GW.rng(seed);

  /* ---------- canvas textures (deterministic, cached, shared) ---------- */
  const TX = new Map();
  function canvasTex(key, w, h, draw, o = {}) {
    let t = TX.get(key); if (t) return t;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); draw(g, w, h);
    t = new (T().CanvasTexture)(cv); t.colorSpace = o.data ? T().NoColorSpace : T().SRGBColorSpace; t.anisotropy = 8;
    if (o.repeat) { t.wrapS = t.wrapT = T().RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
    t.userData.shared = true; TX.set(key, t); return t;
  }
  function noise(g, w, h, seed, amt, size = 1) { const r = rng(seed); const id = g.getImageData(0, 0, w, h); const d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - .5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, 0, 0); void size; }
  function blotches(g, w, h, seed, n, col, a, rmin, rmax) { const r = rng(seed); for (let i = 0; i < n; i++) { const x = r() * w, y = r() * h, rad = rmin + r() * (rmax - rmin); const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, GW.rgba(col, a * r())); gr.addColorStop(1, GW.rgba(col, 0)); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); } }
  K.tex = {
    wood: (base = '#8a5a34', dark = '#5b371d', key = 'wood') => canvasTex(key + base, 512, 512, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h); const r = rng(7);
      for (let i = 0; i < 140; i++) { const y = r() * h; g.strokeStyle = GW.rgba(dark, .08 + r() * .22); g.lineWidth = .6 + r() * 2.4; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * .013 + i) * 4 + Math.sin(x * .05 + i * 3) * 1.2); g.stroke(); }
      blotches(g, w, h, 3, 10, dark, .18, 20, 70); noise(g, w, h, 11, 14);
    }),
    parquet: (base = '#9a6b3f', key = 'parq') => canvasTex(key + base, 1024, 1024, (g, w, h) => {
      const r = rng(21); const pw = w / 4, ph = h / 16; const [br, bg, bb] = GW.hex2rgb(base);
      for (let row = 0; row < 16; row++) { const off = (row % 2) * pw * .5; for (let k = -1; k < 5; k++) { const x = k * pw + off, y = row * ph; const f = .9 + r() * .16; g.fillStyle = `rgb(${br * f | 0},${bg * f | 0},${bb * f | 0})`; g.fillRect(x, y, pw, ph);
        for (let j = 0; j < 7; j++) { g.strokeStyle = `rgba(40,22,10,${.03 + r() * .08})`; g.lineWidth = .5 + r() * 1.2; const yy = y + r() * ph; g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + pw * .3, yy + (r() - .5) * 6, x + pw * .6, yy + (r() - .5) * 6, x + pw, yy + (r() - .5) * 4); g.stroke(); }
        g.strokeStyle = 'rgba(25,14,6,.35)'; g.lineWidth = 1.5; g.strokeRect(x + .75, y + .75, pw - 1.5, ph - 1.5); } }
      noise(g, w, h, 5, 10);
    }, { repeat: [1, 1] }),
    plaster: (base = '#d8d2c8', key = 'pl') => canvasTex(key + base, 512, 512, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); blotches(g, w, h, 9, 40, '#000000', .05, 30, 120); blotches(g, w, h, 19, 30, '#ffffff', .06, 30, 120); noise(g, w, h, 4, 9); }, { repeat: [1, 1] }),
    concrete: (base = '#55585c', key = 'co') => canvasTex(key + base, 512, 512, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); blotches(g, w, h, 31, 60, '#000000', .12, 20, 110); blotches(g, w, h, 37, 40, '#ffffff', .07, 10, 60); noise(g, w, h, 8, 22); const r = rng(2); g.strokeStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 3; i++) { g.lineWidth = 1; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.lineTo(w, y + (r() - .5) * 8); g.stroke(); } }, { repeat: [1, 1] }),
    brick: (key = 'brick') => canvasTex(key, 1024, 1024, (g, w, h) => { const r = rng(41); g.fillStyle = '#2b2725'; g.fillRect(0, 0, w, h); const bw = 128, bh = 48; for (let y = 0, row = 0; y < h; y += bh, row++) for (let x = -(row % 2) * bw / 2; x < w; x += bw) { const f = .6 + r() * .4; g.fillStyle = `rgb(${(110 * f) | 0},${(58 * f) | 0},${(44 * f) | 0})`; g.fillRect(x + 3, y + 3, bw - 6, bh - 6); } blotches(g, w, h, 43, 50, '#000000', .2, 20, 80); noise(g, w, h, 6, 26); }, { repeat: [1, 1] }),
    fabric: (base = '#5d6470', key = 'fab') => canvasTex(key + base, 256, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(0,0,0,${y % 4 ? .06 : .12})`; g.fillRect(0, y, w, 1); } for (let x = 0; x < w; x += 2) { g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(x, 0, 1, h); } noise(g, w, h, 3, 18); }, { repeat: [3, 3] }),
    carpetTile: (key = 'ct') => canvasTex(key, 512, 512, (g, w, h) => { const r = rng(5); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const f = .85 + r() * .2; g.fillStyle = `rgb(${62 * f | 0},${68 * f | 0},${78 * f | 0})`; g.fillRect(i * 128, j * 128, 128, 128); g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeRect(i * 128, j * 128, 128, 128); } noise(g, w, h, 9, 30); }, { repeat: [1, 1] }),
    rug: (key = 'rug') => canvasTex(key, 1024, 640, (g, w, h) => {
      g.fillStyle = '#7a1f22'; g.fillRect(0, 0, w, h); const bd = 54; g.fillStyle = '#1d2a4a'; g.fillRect(bd, bd, w - 2 * bd, h - 2 * bd); g.strokeStyle = '#d8b46a'; g.lineWidth = 8; g.strokeRect(bd * .5, bd * .5, w - bd, h - bd); g.strokeRect(bd + 14, bd + 14, w - 2 * bd - 28, h - 2 * bd - 28);
      g.fillStyle = '#a3342c'; const cx = w / 2, cy = h / 2; g.beginPath(); g.moveTo(cx, cy - 170); g.lineTo(cx + 260, cy); g.lineTo(cx, cy + 170); g.lineTo(cx - 260, cy); g.closePath(); g.fill(); g.strokeStyle = '#d8b46a'; g.lineWidth = 5; g.stroke();
      g.fillStyle = '#e3c98a'; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; g.beginPath(); g.ellipse(cx + Math.cos(a) * 70, cy + Math.sin(a) * 50, 26, 12, a, 0, Math.PI * 2); g.fill(); }
      for (let x = bd + 40; x < w - bd - 20; x += 60) { g.fillStyle = '#d8b46a'; g.beginPath(); g.arc(x, bd + 40, 6, 0, 7); g.arc(x, h - bd - 40, 6, 0, 7); g.fill(); }
      noise(g, w, h, 12, 34);
    }),
    standby: () => canvasTex('standby', 512, 288, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0d1626'); gr.addColorStop(1, '#03060b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(120,170,255,.12)'; g.font = '700 30px Cairo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl'; g.fillText('قص قص', w / 2, h / 2); }),
    clockFace: () => canvasTex('clockface', 512, 512, (g, w) => {
      const c = w / 2; g.fillStyle = '#f4efe4'; g.beginPath(); g.arc(c, c, c, 0, 7); g.fill(); g.strokeStyle = '#1b1b1b'; g.lineWidth = 6; g.beginPath(); g.arc(c, c, c - 12, 0, 7); g.stroke();
      const nums = ['١٢', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠', '١١']; g.fillStyle = '#1b1b1b'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 52px Cairo, sans-serif';
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 - Math.PI / 2; g.fillText(nums[i], c + Math.cos(a) * (c - 70), c + Math.sin(a) * (c - 70)); }
      for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; g.lineWidth = i % 5 ? 2 : 5; g.beginPath(); g.moveTo(c + Math.cos(a) * (c - 22), c + Math.sin(a) * (c - 22)); g.lineTo(c + Math.cos(a) * (c - (i % 5 ? 32 : 40)), c + Math.sin(a) * (c - (i % 5 ? 32 : 40))); g.stroke(); }
    }),
    sky: () => canvasTex('sky', 256, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#7fb2e8'); gr.addColorStop(.62, '#cfe3f3'); gr.addColorStop(.63, '#9fb39a'); gr.addColorStop(1, '#6f8a6a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); blotches(g, w, h * .6, 3, 12, '#ffffff', .5, 20, 50); }),
    led: (c1 = '#1f6feb', c2 = '#7c3aed') => canvasTex('led' + c1 + c2, 1024, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, c1); gr.addColorStop(.5, c2); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalAlpha = .18; g.strokeStyle = '#fff'; for (let x = 0; x < w; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 120, h); g.stroke(); } g.globalAlpha = 1; for (let y = 0; y < h; y += 4) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y, w, 1); } }),
    world: (name = 'relief') => { const key = 'world:' + name; let t = TX.get(key); if (t) return t; t = new (T().TextureLoader)().load('assets/' + name + '.webp', () => { GW.invalidate(); S.viewDirty(); }); t.colorSpace = T().SRGBColorSpace; t.anisotropy = 8; t.userData.shared = true; TX.set(key, t); return t; }
  };

  /* ---------- materials ---------- */
  const MC = new Map();
  K.mat = (key, o) => { let m = MC.get(key); if (m) return m; m = new (T().MeshStandardMaterial)(o); m.userData.shared = true; MC.set(key, m); return m; };
  K.own = (o) => new (T().MeshStandardMaterial)(o);
  K.phys = (key, o) => { let m = MC.get(key); if (m) return m; m = new (T().MeshPhysicalMaterial)(o); m.userData.shared = true; MC.set(key, m); return m; };
  const M = K.M = {
    wood: () => K.mat('wood', { map: K.tex.wood(), roughness: .55, metalness: 0 }),
    darkWood: () => K.mat('dwood', { map: K.tex.wood('#4a2c18', '#24140a', 'dw'), roughness: .45 }),
    lightWood: () => K.mat('lwood', { map: K.tex.wood('#c49a6c', '#8f6a43', 'lw'), roughness: .6 }),
    metal: () => K.mat('metal', { color: 0x9aa0a8, roughness: .32, metalness: .9 }),
    black: () => K.mat('black', { color: 0x16181c, roughness: .4, metalness: .2 }),
    blackGloss: () => K.mat('blackg', { color: 0x0a0b0d, roughness: .18, metalness: .3 }),
    brass: () => K.mat('brass', { color: 0xc8a050, roughness: .3, metalness: 1 }),
    white: () => K.mat('white', { color: 0xe9e7e2, roughness: .6 }),
    fabric: (c = '#5d6470') => K.mat('fab' + c, { map: K.tex.fabric(c), roughness: .95 }),
    glass: () => K.phys('glass', { color: 0xffffff, roughness: .05, metalness: 0, transmission: .9, transparent: true, opacity: .25, thickness: .01 }),
    leaf: () => K.mat('leaf', { color: 0x2f6b34, roughness: .7, side: T().DoubleSide }),
    soil: () => K.mat('soil', { color: 0x2a1e16, roughness: 1 }),
    ceramic: () => K.mat('cer', { color: 0xd9d2c6, roughness: .35 }),
    screenOff: () => K.mat('scroff', { map: null, emissiveMap: K.tex.standby(), emissive: 0xffffff, emissiveIntensity: .9, color: 0x050608, roughness: .2, metalness: 0, toneMapped: false })
  };

  /* ---------- mesh helpers ---------- */
  const shade = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };
  K.mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = shade(new (T().Mesh)(geo, mat)); m.position.set(x, y, z); return m; };
  K.box = (w, h, d, mat, x = 0, y = 0, z = 0) => K.mesh(new (T().BoxGeometry)(w, h, d), mat, x, y, z);
  K.rbox = (w, h, d, r, mat, x = 0, y = 0, z = 0, seg = 3) => K.mesh(new (T().X.RoundedBoxGeometry)(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * .999), mat, x, y, z);
  K.cyl = (rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 32, open = false) => K.mesh(new (T().CylinderGeometry)(rt, rb, h, seg, 1, open), mat, x, y, z);
  K.sph = (r, mat, x = 0, y = 0, z = 0, ws = 32, hs = 20) => K.mesh(new (T().SphereGeometry)(r, ws, hs), mat, x, y, z);
  K.group = (...ch) => { const g = new (T().Group)(); ch.forEach(c => c && g.add(c)); return g; };
  K.main = (m) => { m.userData.main = true; return m; };
  const uvRepeat = (geo, sx, sy) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy); uv.needsUpdate = true; return geo; };
  // screen plane (faces +Z). uv: sub-rect of the source for video walls; aspect: of the whole picture
  K.screen = (w, h, o = {}) => {
    const geo = new (T().PlaneGeometry)(w, h); const m = new (T().Mesh)(geo, M.screenOff()); m.receiveShadow = false; m.castShadow = false;
    m.userData.screen = true; m.userData.uv = o.uv || [0, 0, 1, 1]; m.userData.aspect = o.aspect || w / h; m.userData.uv0 = geo.attributes.uv.array.slice(); return m;
  };
  K.setScreen = (mesh, src, sc) => {
    const ud = mesh.userData;
    if (!src) { const off = ud.offMat || M.screenOff(); if (mesh.material !== off) mesh.material = off; setUV(mesh, 1, 'stretch'); return; }
    let m = ud.smat; if (!m) { m = ud.smat = new (T().MeshStandardMaterial)({ color: 0x000000, emissive: 0xffffff, roughness: .22, metalness: 0, envMapIntensity: .35, toneMapped: false }); }
    if (m.emissiveMap !== src.tex) { m.emissiveMap = src.tex; m.needsUpdate = true; }
    m.emissiveIntensity = sc.bright != null ? +sc.bright : 1; if (mesh.material !== m) mesh.material = m;
    setUV(mesh, (src.w || 16) / (src.h || 9), sc.fit || 'cover');
  };
  function setUV(mesh, sa, fit) {
    const ud = mesh.userData; const key = sa.toFixed(4) + fit; if (ud.uvKey === key) return; ud.uvKey = key;
    const a = ud.aspect; let u0 = 0, u1 = 1, v0 = 0, v1 = 1;
    if (fit === 'cover') { if (sa > a) { const f = a / sa; u0 = .5 - f / 2; u1 = .5 + f / 2; } else { const f = sa / a; v0 = .5 - f / 2; v1 = .5 + f / 2; } }
    const [r0, s0, r1, s1] = ud.uv; const uv = mesh.geometry.attributes.uv; const b = ud.uv0;
    for (let i = 0; i < uv.count; i++) { const x = r0 + b[i * 2] * (r1 - r0), y = s0 + b[i * 2 + 1] * (s1 - s0); uv.setXY(i, u0 + x * (u1 - u0), v0 + y * (v1 - v0)); }
    uv.needsUpdate = true;
  }
  // a small glowing marker visible only in the 3D viewport (lights)
  K.helperBulb = (color = 0xffd27a, r = .07) => { const m = new (T().Mesh)(new (T().SphereGeometry)(r, 12, 8), new (T().MeshBasicMaterial)({ color, toneMapped: false })); m.userData.vhelper = true; m.castShadow = m.receiveShadow = false; return m; };
  function addShadow(l, size = 1024, range = 8) {
    l.castShadow = true; l.shadow.mapSize.set(size, size); l.shadow.bias = -.0004; l.shadow.normalBias = .02;
    if (l.isDirectionalLight) { const c = l.shadow.camera; c.left = c.bottom = -range; c.right = c.top = range; c.near = .5; c.far = 60; l.shadow.radius = 4; }
    if (l.isSpotLight) { l.shadow.camera.near = .2; l.shadow.camera.far = 40; l.shadow.radius = 3; l.shadow.focus = 1; }
    if (l.isPointLight) { l.shadow.camera.near = .1; l.shadow.camera.far = 25; l.shadow.mapSize.set(512, 512); }
  }

  /* ---------- the library ---------- */
  const LIB = S.LIB = {};
  const CAT = S.CATS = [['rooms', 'الغرف والاستوديوهات'], ['furniture', 'الأثاث'], ['screens', 'الشاشات'], ['prims', 'أشكال أساسية'], ['lights', 'الإضاءة'], ['models', 'نماذجي']];
  const def = (id, cat, n, build, o = {}) => { LIB[id] = Object.assign({ id, cat, n, build }, o); };
  const P2 = (o, k, d) => (o.p && o.p[k] != null ? +o.p[k] : d);

  /* rooms */
  function walls(g, o, cfg) {
    const W = P2(o, 'w', cfg.w), D = P2(o, 'd', cfg.d), H = P2(o, 'h', cfg.h), th = .12;
    const floorMat = cfg.floor; const wallMat = cfg.wall;
    const fl = K.box(W, .04, D, floorMat, 0, -.02, 0); fl.castShadow = false; uvRepeat(fl.geometry, W / (cfg.floorTile || 4), D / (cfg.floorTile || 4)); K.main(fl); g.add(fl);
    const mk = (w, h, x, y, z, ry, tile) => { const m = K.box(w, h, th, wallMat, x, y, z); m.rotation.y = ry || 0; uvRepeat(m.geometry, w / (tile || 3), h / (tile || 3)); return m; };
    g.add(mk(W + th * 2, H, 0, H / 2, -D / 2 - th / 2, 0, cfg.wallTile));
    const side = (sgn) => {
      const x = sgn * (W / 2 + th / 2);
      if (cfg.window && sgn < 0) { // window opening in the left wall (sun comes through it)
        const ww = Math.min(2.4, D * .45), wh = Math.min(1.5, H * .5), wy = Math.min(1.05, H * .3), zc = -D * .1;
        const zA = -D / 2, zB = zc - ww / 2, zC = zc + ww / 2, zD = D / 2;
        g.add(mk(zB - zA, H, x, H / 2, (zA + zB) / 2, Math.PI / 2, cfg.wallTile)); g.add(mk(zD - zC, H, x, H / 2, (zC + zD) / 2, Math.PI / 2, cfg.wallTile));
        g.add(mk(ww, wy, x, wy / 2, zc, Math.PI / 2, cfg.wallTile)); g.add(mk(ww, H - wy - wh, x, wy + wh + (H - wy - wh) / 2, zc, Math.PI / 2, cfg.wallTile));
        const fm = M.white(); const fr = .06;
        g.add(K.box(fr, wh + fr, fr * 1.2, fm, x, wy + wh / 2, zc - ww / 2).rotateY(Math.PI / 2));
        const f1 = K.box(.08, wh, .06, fm, x, wy + wh / 2, zc); g.add(f1);
        const f2 = K.box(.18, .05, ww, fm, x + .05, wy, zc); g.add(f2); const f3 = K.box(.14, .05, ww, fm, x, wy + wh, zc); g.add(f3);
        const sky = new (T().Mesh)(new (T().PlaneGeometry)(ww * 4, wh * 4), new (T().MeshBasicMaterial)({ map: K.tex.sky(), toneMapped: false })); sky.position.set(x - 2.5, wy + wh / 2 + .3, zc); sky.rotation.y = Math.PI / 2; sky.userData.camOnly = true; g.add(sky);
      } else g.add(mk(D, H, x, H / 2, 0, Math.PI / 2, cfg.wallTile));
    };
    side(-1); side(1);
    if (cfg.base) { const bm = cfg.base; for (const [w, x, z, ry] of [[W, 0, -D / 2 + .01, 0], [D, -W / 2 + .01, 0, Math.PI / 2], [D, W / 2 - .01, 0, Math.PI / 2]]) { const b = K.box(w, .1, .02, bm, x, .05, z); b.rotation.y = ry; g.add(b); } }
    if (cfg.ceil) { const c = K.box(W + th * 2, .06, D, cfg.ceilMat || M.white(), 0, H + .03, 0); c.castShadow = true; c.userData.camOnly = true; g.add(c); }
    return { W, D, H };
  }
  def('room_basic', 'rooms', 'غرفة بسيطة بنافذة', (K2, o) => {
    const g = K.group(); const { W, D, H } = walls(g, o, { w: 8, d: 6, h: 3, floor: K.own({ map: K.tex.parquet(), roughness: .42 }), wall: K.mat('wallp', { map: K.tex.plaster('#e6dfd3', 'plw'), roughness: .9 }), base: M.white(), window: 1, ceil: 1, floorTile: 3 });
    void W; void D; void H; return g;
  }, { p: { w: 8, d: 6, h: 3 }, room: 1 });
  def('studio_cyc', 'rooms', 'استوديو سايكلوراما', (K2, o) => {
    const g = K.group(); const W = P2(o, 'w', 12), D = P2(o, 'd', 9), H = P2(o, 'h', 5), R = 1.4;
    const m = K.own({ color: 0xd6d8dc, roughness: .85 });
    const fl = K.box(W, .04, D - R, m, 0, -.02, R / 2); K.main(fl); fl.castShadow = false; g.add(fl);
    const cove = new (T().Mesh)(new (T().CylinderGeometry)(R, R, W, 32, 1, true, Math.PI, Math.PI / 2), m); cove.rotation.z = Math.PI / 2; cove.position.set(0, R, -D / 2 + R); cove.material.side = T().DoubleSide; shade(cove, false, true); K.main(cove); g.add(cove);
    const bw = K.box(W, H - R, .05, m, 0, R + (H - R) / 2, -D / 2); K.main(bw); g.add(bw);
    return g;
  }, { p: { w: 12, d: 9, h: 5 }, room: 1 });
  def('news_set', 'rooms', 'استوديو أخبار', (K2, o) => {
    const g = K.group(); const W = P2(o, 'w', 12), D = P2(o, 'd', 9), H = P2(o, 'h', 4.5);
    const fl = K.box(W, .04, D, K.own({ color: 0x0d1220, roughness: .16, metalness: .4 }), 0, -.02, 0); fl.castShadow = false; K.main(fl); g.add(fl);
    for (let i = 0; i < 3; i++) { const ring = new (T().Mesh)(new (T().TorusGeometry)(1.6 + i * 1.1, .015, 6, 96), K.mat('ledring', { color: 0x000000, emissive: 0x2f7dff, emissiveIntensity: 2.2 })); ring.rotation.x = -Math.PI / 2; ring.position.set(0, .003, .6); g.add(ring); }
    // curved backdrop with LED band
    const bd = new (T().Mesh)(new (T().CylinderGeometry)(7, 7, H, 64, 1, true, Math.PI - .75, 1.5), K.own({ color: 0x141b2c, roughness: .5, metalness: .2, side: T().DoubleSide })); bd.position.set(0, H / 2, 3.2); shade(bd, false, true); g.add(bd);
    const band = new (T().Mesh)(new (T().CylinderGeometry)(6.95, 6.95, .22, 64, 1, true, Math.PI - .75, 1.5), K.mat('led1', { color: 0x000000, emissiveMap: K.tex.led(), emissive: 0xffffff, emissiveIntensity: 1.6, side: T().DoubleSide })); band.position.set(0, .55, 3.2); g.add(band);
    const band2 = band.clone(); band2.position.y = H - .4; g.add(band2);
    // video wall behind the anchor (screen)
    const vw = K.group(); const sw = 4.2, sh = sw * 9 / 16; const fr = K.box(sw + .12, sh + .12, .1, M.black(), 0, 0, -.06); vw.add(fr);
    const scr = K.screen(sw, sh); scr.position.z = .001; scr.userData.offMat = K.mat('newswall', { color: 0x000000, emissiveMap: K.tex.world('night'), emissive: 0xffffff, emissiveIntensity: 1.1, toneMapped: false }); vw.add(scr); vw.position.set(0, 2.15, -3.75); g.add(vw);
    // anchor desk: ring-sector top convex toward the camera, curved front panel with an LED strip
    const desk = K.group(); const a0 = -.62, a1 = .62, R1 = 1.55, R2 = 2.28; const pts = [];
    for (let k = 0; k <= 32; k++) { const a = a0 + (a1 - a0) * k / 32; pts.push(new (T().Vector2)(R2 * Math.sin(a), R2 * Math.cos(a))); }
    for (let k = 32; k >= 0; k--) { const a = a0 + (a1 - a0) * k / 32; pts.push(new (T().Vector2)(R1 * Math.sin(a), R1 * Math.cos(a))); }
    const tg = new (T().ExtrudeGeometry)(new (T().Shape)(pts), { depth: .06, bevelEnabled: true, bevelThickness: .01, bevelSize: .01, bevelSegments: 2, curveSegments: 4 }); tg.rotateX(Math.PI / 2);
    const top = new (T().Mesh)(tg, K.own({ color: 0xeef1f5, roughness: .22, metalness: .05 })); top.position.y = .82; shade(top); K.main(top); desk.add(top);
    const front = new (T().Mesh)(new (T().CylinderGeometry)(2.18, 2.18, .76, 64, 1, true, a0 + .03, a1 - a0 - .06), K.own({ color: 0x1a2236, roughness: .3, metalness: .35, side: T().DoubleSide })); front.position.y = .38; shade(front); desk.add(front);
    const back = new (T().Mesh)(new (T().CylinderGeometry)(1.62, 1.62, .76, 48, 1, true, a0 + .05, a1 - a0 - .1), K.own({ color: 0x10151f, roughness: .6, side: T().DoubleSide })); back.position.y = .38; shade(back); desk.add(back);
    const strip = new (T().Mesh)(new (T().CylinderGeometry)(2.195, 2.195, .045, 64, 1, true, a0 + .03, a1 - a0 - .06), K.mat('ledstrip', { color: 0x000000, emissive: 0x3b8cff, emissiveIntensity: 2.5, side: T().DoubleSide })); strip.position.y = .6; desk.add(strip);
    const logo = new (T().Mesh)(new (T().CylinderGeometry)(2.19, 2.19, .2, 32, 1, true, -.16, .32), K.mat('desklogo', { color: 0x000000, emissiveMap: K.tex.led('#ff6a2b', '#ffb347'), emissive: 0xffffff, emissiveIntensity: 1.2, side: T().DoubleSide })); logo.position.y = .34; desk.add(logo);
    desk.position.set(0, 0, -1.25); g.add(desk);
    return g;
  }, { p: { w: 12, d: 9, h: 4.5 }, room: 1, screens: 1 });
  def('doc_dark', 'rooms', 'استوديو وثائقي مظلم', (K2, o) => {
    const g = K.group(); const { W, D } = walls(g, o, { w: 9, d: 7, h: 3.4, floor: K.own({ map: K.tex.parquet('#4a3524', 'pd'), roughness: .5 }), wall: K.mat('brickw', { map: K.tex.brick(), roughness: .92 }), wallTile: 2.4, floorTile: 3 });
    void W; void D;
    const pend = K.group(); const shadeM = K.mat('lampshade', { color: 0x1a1a1a, roughness: .5, metalness: .6, side: T().DoubleSide });
    const cone = new (T().Mesh)(new (T().CylinderGeometry)(.08, .32, .28, 32, 1, true), shadeM); shade(cone); pend.add(cone);
    const cord = K.cyl(.006, .006, 1.1, M.black(), 0, .69, 0, 6); pend.add(cord);
    const bulb = K.sph(.05, K.mat('bulb', { color: 0xffffff, emissive: 0xffc27a, emissiveIntensity: 6 }), 0, -.08, 0); bulb.castShadow = false; pend.add(bulb);
    const pl = new (T().PointLight)(0xffb36b, 6, 9, 2); pl.position.y = -.12; addShadow(pl); pl.userData.mult = 1; pend.add(pl);
    pend.position.set(0, 2.25, -.5); g.add(pend);
    return g;
  }, { p: { w: 9, d: 7, h: 3.4 }, room: 1 });
  def('office', 'rooms', 'مكتب', (K2, o) => {
    const g = K.group(); const { W, D, H } = walls(g, o, { w: 9, d: 7, h: 3, floor: K.own({ map: K.tex.carpetTile(), roughness: .95 }), wall: K.mat('wallo', { map: K.tex.plaster('#e4e6e8', 'plo'), roughness: .85 }), base: M.black(), window: 1, ceil: 1, floorTile: 2 });
    const pm = K.mat('ceilpanel', { color: 0xffffff, emissive: 0xf4f7ff, emissiveIntensity: 2.2 });
    for (const x of [-W / 4, W / 4]) for (const z of [-D / 4, D / 4]) { const p = K.box(1.2, .02, .6, pm, x, H - .01, z); p.castShadow = false; p.userData.camOnly = true; g.add(p); }
    const glass = K.box(.03, H * .9, D * .5, M.glass(), W / 2 - 1.6, H * .45, D * .15); glass.castShadow = false; g.add(glass);
    const frame = K.box(.06, .06, D * .5, M.metal(), W / 2 - 1.6, H * .9, D * .15); g.add(frame);
    return g;
  }, { p: { w: 9, d: 7, h: 3 }, room: 1 });
  function bookRow(w, h, seed, x0, y0, z0, depth = .22) {
    const r = rng(seed); const g = K.group(); let x = -w / 2; const cols = ['#7a1f22', '#1d3a5a', '#2c4a2a', '#5b3a1e', '#a8873e', '#3a2a4a', '#1e1e1e', '#8a5a34', '#4e5d6c'];
    while (x < w / 2 - .03) { const bw = .025 + r() * .035, bh = h * (.7 + r() * .28); if (x + bw > w / 2) break; const b = K.box(bw * .96, bh, depth * (.8 + r() * .2), K.mat('book' + cols[(r() * cols.length) | 0], { color: cols[(r() * cols.length) | 0], roughness: .8 }), x + bw / 2, bh / 2, 0); if (r() < .06) { b.rotation.z = .25; b.position.x += .02; } g.add(b); x += bw; }
    g.position.set(x0, y0, z0); return g;
  }
  function bookshelf(w, h, d, seed) {
    const g = K.group(); const wm = M.darkWood(); const th = .03;
    g.add(K.box(th, h, d, wm, -w / 2 + th / 2, h / 2, 0)); g.add(K.box(th, h, d, wm, w / 2 - th / 2, h / 2, 0)); g.add(K.box(w, th, d, wm, 0, h - th / 2, 0)); g.add(K.box(w, .02, d, wm, 0, h / 2, -d / 2 + .01));
    const n = Math.max(2, Math.round(h / .36)); for (let i = 0; i <= n - 1; i++) { const y = .06 + i * (h - .1) / n; g.add(K.box(w - th * 2, th, d, wm, 0, y, 0)); if (i < n) g.add(bookRow(w - th * 2 - .02, (h - .1) / n - .06, seed + i * 13, 0, y + th / 2, .01, d * .85)); }
    return g;
  }
  def('war_room', 'rooms', 'غرفة عمليات / مكتبة مع طاولة خرائط', (K2, o) => {
    const g = K.group(); const { W, D, H } = walls(g, o, { w: 10, d: 8, h: 3.4, floor: K.own({ map: K.tex.parquet('#5a3b22', 'pw'), roughness: .45 }), wall: K.mat('wallwr', { map: K.tex.plaster('#3a3f3a', 'plwr'), roughness: .9 }), base: M.darkWood(), floorTile: 3 });
    for (let i = 0; i < 4; i++) { const s = bookshelf(1.9, 2.6, .34, 100 + i * 7); s.position.set(-W / 2 + 1.2 + i * 2.05 + (i > 1 ? 1.6 : 0), 0, -D / 2 + .2); g.add(s); }
    for (let i = 0; i < 3; i++) { const s = bookshelf(1.9, 2.6, .34, 300 + i * 7); s.rotation.y = Math.PI / 2; s.position.set(-W / 2 + .2, 0, -D / 2 + 1.4 + i * 2.05); g.add(s); }
    // map table: top is a screen (default shows a relief world map)
    const tbl = K.group(); const tw = 3.2, td = 1.9, th = .9;
    tbl.add(K.box(tw + .16, .08, td + .16, M.darkWood(), 0, th - .04, 0)); tbl.add(K.box(tw - .4, th - .1, td - .4, M.darkWood(), 0, (th - .1) / 2, 0));
    const top = K.screen(tw, td); top.rotation.x = -Math.PI / 2; top.position.y = th + .002; top.material = K.mat('maptop', { map: K.tex.world('relief'), roughness: .55 }); top.userData.offMat = top.material; tbl.add(top);
    tbl.position.set(0, 0, .3); g.add(tbl);
    for (const x of [-.8, .8]) { const p = K.group(); const sh = new (T().Mesh)(new (T().CylinderGeometry)(.05, .22, .2, 24, 1, true), K.mat('wrshade', { color: 0x1f3d2a, roughness: .4, metalness: .5, side: T().DoubleSide })); shade(sh); p.add(sh); p.add(K.cyl(.005, .005, H - 1.7, M.black(), 0, (H - 1.7) / 2 + .1, 0, 6)); const pl = new (T().SpotLight)(0xffcf8a, 25, 8, .9, .6, 2); pl.position.y = -.05; pl.target.position.set(x, 0, .3); addShadow(pl, 1024); p.add(pl); g.userData.targets = (g.userData.targets || []).concat([pl.target]); const b = K.sph(.04, K.mat('bulb', { color: 0xffffff, emissive: 0xffc27a, emissiveIntensity: 6 }), 0, -.06, 0); b.castShadow = false; p.add(b); p.position.set(x, 1.65, .3); g.add(p); }
    return g;
  }, { p: { w: 10, d: 8, h: 3.4 }, room: 1, screens: 1 });

  /* furniture */
  def('table', 'furniture', 'طاولة', (K2, o) => { const g = K.group(); const w = P2(o, 'w', 1.6), d = P2(o, 'd', .9), h = .75; g.add(K.main(K.rbox(w, .05, d, .01, K.own({ map: K.tex.wood(), roughness: .5 }), 0, h - .025, 0))); for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(K.box(.06, h - .05, .06, M.darkWood(), sx * (w / 2 - .08), (h - .05) / 2, sz * (d / 2 - .08))); g.add(K.box(w - .2, .08, .03, M.darkWood(), 0, h - .09, d / 2 - .08)); g.add(K.box(w - .2, .08, .03, M.darkWood(), 0, h - .09, -d / 2 + .08)); return g; }, { p: { w: 1.6, d: .9 } });
  def('desk', 'furniture', 'مكتب عمل', (K2) => { const g = K.group(); const w = 1.5, d = .72, h = .75; g.add(K.main(K.rbox(w, .04, d, .008, K.own({ map: K.tex.wood('#c9a77c', '#9b7a52', 'dk'), roughness: .45 }), 0, h - .02, 0))); g.add(K.box(.03, h - .04, d - .04, M.white(), -w / 2 + .03, (h - .04) / 2, 0)); const dr = K.box(.42, h - .04, d - .04, M.white(), w / 2 - .23, (h - .04) / 2, 0); g.add(dr); for (let i = 0; i < 3; i++) g.add(K.box(.12, .015, .02, M.metal(), w / 2 - .23, .15 + i * .22, d / 2 - .01)); g.add(K.box(w - .5, .3, .02, M.white(), -.2, h - .2, -d / 2 + .04)); return g; });
  def('chair', 'furniture', 'كرسي', (K2) => { const g = K.group(); const fm = K.own({ map: K.tex.fabric('#38404c'), roughness: .95 }); g.add(K.main(K.rbox(.46, .08, .46, .03, fm, 0, .46, 0))); const back = K.main(K.rbox(.44, .46, .07, .03, fm, 0, .76, -.2)); back.rotation.x = -.12; g.add(back); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = K.cyl(.014, .012, .44, M.metal(), sx * .19, .22, sz * .19, 10); l.rotation.z = sx * .06; l.rotation.x = -sz * .06; g.add(l); } return g; });
  def('sofa', 'furniture', 'كنبة', (K2) => { const g = K.group(); const fm = K.own({ map: K.tex.fabric('#7c6a58'), roughness: .95 }); const W = 2.1, D = .9; g.add(K.main(K.rbox(W, .26, D, .05, fm, 0, .25, 0))); for (const x of [-.5, .5]) g.add(K.main(K.rbox(1, .16, D - .25, .06, fm, x * 1.0 * .98, .46, .1))); g.add(K.main(K.rbox(W, .5, .22, .07, fm, 0, .6, -D / 2 + .11))); for (const x of [-1, 1]) g.add(K.main(K.rbox(.2, .56, D, .07, fm, x * (W / 2 - .1), .4, 0))); for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(K.cyl(.025, .018, .12, M.darkWood(), x * (W / 2 - .12), .06, z * (D / 2 - .1), 10)); for (const x of [-.55, .55]) { const p = K.main(K.rbox(.42, .38, .12, .06, K.mat('pillow', { map: K.tex.fabric('#c9a96e', 'fp'), roughness: .95 }), x, .7, -.22)); p.rotation.x = -.25; g.add(p); } return g; });
  def('shelf', 'furniture', 'رف كتب', () => bookshelf(1.2, 1.9, .32, 55));
  def('cabinet', 'furniture', 'خزانة', (K2) => { const g = K.group(); const w = 1.2, h = .9, d = .45; g.add(K.main(K.rbox(w, h, d, .01, K.own({ map: K.tex.wood('#d7d2c8', '#b9b2a6', 'cab'), roughness: .5 }), 0, h / 2 + .08, 0))); for (const x of [-1, 1]) { g.add(K.box(.004, h - .06, .002, M.black(), 0, h / 2 + .08, d / 2 + .001)); g.add(K.box(.015, .14, .02, M.brass(), x * .06, h / 2 + .12, d / 2 + .01)); } for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(K.cyl(.015, .01, .08, M.brass(), x * (w / 2 - .06), .04, z * (d / 2 - .06), 8)); return g; });
  def('carpet', 'furniture', 'سجادة', (K2, o) => { const w = P2(o, 'w', 3), d = P2(o, 'd', 2); const m = K.main(K.box(w, .012, d, K.own({ map: K.tex.rug(), roughness: 1 }), 0, .006, 0)); m.castShadow = false; return K.group(m); }, { p: { w: 3, d: 2 } });
  def('lamp', 'furniture', 'مصباح أرضي', (K2) => {
    const g = K.group(); g.add(K.cyl(.16, .18, .03, M.black(), 0, .015, 0)); g.add(K.cyl(.012, .012, 1.5, M.brass(), 0, .76, 0, 10));
    const sh = new (T().Mesh)(new (T().CylinderGeometry)(.17, .24, .3, 40, 1, true), K.own({ color: 0xf2e6d0, roughness: .9, side: T().DoubleSide, emissive: 0xffb866, emissiveIntensity: .35 })); sh.position.y = 1.55; shade(sh, false, true); K.main(sh); g.add(sh);
    const pl = new (T().PointLight)(0xffc27f, 1, 7, 2); pl.position.y = 1.5; addShadow(pl); pl.userData.mult = 1; g.add(pl); g.add(K.sph(.04, K.mat('bulb', { color: 0xffffff, emissive: 0xffc27a, emissiveIntensity: 6 }), 0, 1.5, 0)); return g;
  }, { light: { kind: 'point', int: 4, color: '#ffc27f', dist: 7, shadow: 0 } });
  def('plant', 'furniture', 'نبتة في أصيص', () => {
    const g = K.group(); const pot = new (T().Mesh)(new (T().LatheGeometry)([[.0, 0], [.15, 0], [.19, .36], [.2, .38], [.0, .38]].map(p => new (T().Vector2)(p[0], p[1])), 40), M.ceramic()); shade(pot); g.add(pot);
    g.add(K.cyl(.185, .185, .02, M.soil(), 0, .35, 0)); const r = rng(77);
    const lg = new (T().SphereGeometry)(1, 10, 6); lg.scale(.05, .012, .16); lg.translate(0, 0, .15);
    for (let i = 0; i < 26; i++) { const st = K.cyl(.006, .008, .3 + r() * .5, M.leaf(), 0, 0, 0, 5); const h = .35 + r() * .55; const a = r() * Math.PI * 2, tilt = .2 + r() * .6; const stem = K.group(); st.position.y = h / 2; st.scale.y = h / (.3 + .25); stem.add(st); const lf = K.mesh(lg, M.leaf(), 0, h, 0); lf.rotation.x = -.3 - r() * .6; lf.scale.setScalar(1 + r() * .6); stem.add(lf); stem.rotation.set(Math.cos(a) * tilt, 0, Math.sin(a) * tilt); stem.rotation.y = a; stem.position.y = .36; g.add(stem); }
    return g;
  });
  def('frame', 'furniture', 'إطار صورة', () => { const g = K.group(); const w = .8, h = .6; g.add(K.box(w + .08, h + .08, .03, M.darkWood(), 0, 0, 0)); g.add(K.box(w, h, .01, M.white(), 0, 0, .012)); const s = K.screen(w - .1, h - .1); s.position.z = .019; g.add(s); return g; }, { def: { pos: [0, 1.6, 0] }, screens: 1 });
  def('globe', 'furniture', 'كرة أرضية على حامل', (K2) => {
    const g = K.group(); g.add(K.cyl(.12, .15, .03, M.darkWood(), 0, .015, 0)); g.add(K.cyl(.015, .02, .5, M.darkWood(), 0, .27, 0, 12));
    const tilt = K.group(); tilt.position.y = .78; tilt.rotation.z = 23.4 * Math.PI / 180; const sp = K.sph(.24, K.own({ map: K.tex.world('sat'), roughness: .5 }), 0, 0, 0, 64, 40); K.main(sp); tilt.add(sp);
    const ring = new (T().Mesh)(new (T().TorusGeometry)(.265, .008, 8, 64, Math.PI * 1.15), M.brass()); ring.rotation.y = Math.PI / 2; ring.rotation.x = -Math.PI * .075 + Math.PI / 2; tilt.add(ring); g.add(tilt);
    g.userData.tick = (lt) => { sp.rotation.y = lt * .25; }; return g;
  });
  def('books', 'furniture', 'كومة كتب', () => { const g = K.group(); const r = rng(9); const cols = ['#7a1f22', '#1d3a5a', '#2c4a2a', '#a8873e', '#3a2a4a']; let y = 0; for (let i = 0; i < 5; i++) { const h = .03 + r() * .03, w = .2 + r() * .08, d = .14 + r() * .06; const b = K.box(w, h, d, K.mat('bk' + i, { color: cols[i], roughness: .7 }), (r() - .5) * .03, y + h / 2, (r() - .5) * .03); b.rotation.y = (r() - .5) * .4; g.add(b); const pg = K.box(w - .01, h * .8, d - .008, K.mat('pages', { color: 0xf0e8d6, roughness: .9 }), 0, 0, .004); b.add(pg); y += h; } return g; }, { def: { pos: [0, .75, 0] } });
  def('clock', 'furniture', 'ساعة حائط', () => {
    const g = K.group(); const body = K.cyl(.2, .2, .05, M.black(), 0, 0, 0, 48); body.rotation.x = Math.PI / 2; g.add(body);
    const face = new (T().Mesh)(new (T().CircleGeometry)(.185, 48), K.mat('cface', { map: K.tex.clockFace(), roughness: .5 })); face.position.z = .026; g.add(face);
    const hand = (len, w, m) => { const p = K.group(); const b = K.box(w, len, .004, m, 0, len / 2 - .02, 0); b.castShadow = false; p.add(b); p.position.z = .03; return p; };
    const hh = hand(.1, .012, M.black()), mh = hand(.15, .008, M.black()), sh = hand(.16, .003, K.mat('red', { color: 0xc0392b, roughness: .5 })); sh.position.z = .034; g.add(hh, mh, sh);
    g.userData.tick = (lt) => { const s0 = 10 * 3600 + 10 * 60 + lt; sh.rotation.z = -Math.floor(s0 % 60) / 60 * Math.PI * 2; mh.rotation.z = -(s0 / 3600 % 1) * Math.PI * 2; hh.rotation.z = -(s0 / 43200 % 1) * Math.PI * 2; };
    return g;
  }, { def: { pos: [0, 2.1, 0] } });

  /* screens */
  function tv(w, h, o = {}) { const g = K.group(); g.add(K.rbox(w + .03, h + .03, .045, .008, M.blackGloss(), 0, 0, -.022)); const s = K.screen(w, h, o); s.position.z = .0015; g.add(s); g.add(K.box(w * .5, h * .5, .04, M.black(), 0, 0, -.06)); return g; }
  def('tv_stand', 'screens', 'تلفاز على طاولة', () => { const g = K.group(); const con = K.rbox(1.7, .45, .42, .01, K.own({ map: K.tex.wood('#3d3a36', '#24221f', 'tvc'), roughness: .5 }), 0, .225 + .06, 0); K.main(con); g.add(con); for (const x of [-1, 1]) g.add(K.box(.04, .06, .3, M.black(), x * .75, .03, 0)); g.add(K.box(1.66, .003, .01, M.metal(), 0, .3, .211)); const t = tv(1.22, .69); t.position.set(0, .51 + .345 + .06, 0); g.add(t); for (const x of [-1, 1]) { const f = K.box(.03, .07, .2, M.metal(), x * .45, .55, 0); g.add(f); } return g; }, { screens: 1 });
  def('tv_wall', 'screens', 'تلفاز معلق', () => { const g = tv(1.43, .805); g.children[2].scale.set(.4, .4, 1); return g; }, { screens: 1, def: { pos: [0, 1.5, 0] } });
  def('monitor', 'screens', 'شاشة حاسوب', () => { const g = K.group(); g.add(K.rbox(.22, .012, .16, .005, M.metal(), 0, .006, 0)); g.add(K.box(.04, .3, .02, M.metal(), 0, .16, -.04)); const t = tv(.6, .3375); t.position.set(0, .32, -.02); g.add(t); return g; }, { screens: 1, def: { pos: [0, .75, 0] } });
  def('laptop', 'screens', 'حاسوب محمول', () => { const g = K.group(); const am = K.mat('alu', { color: 0xb8bcc2, roughness: .3, metalness: .85 }); g.add(K.rbox(.32, .015, .22, .006, am, 0, .0075, 0)); g.add(K.box(.28, .002, .1, K.mat('keys', { color: 0x1d1f22, roughness: .7 }), 0, .016, -.01)); const lid = K.group(); lid.add(K.rbox(.32, .21, .008, .006, am, 0, .105, -.004)); const s = K.screen(.29, .18); s.position.set(0, .105, .0005); lid.add(s); lid.position.set(0, .015, -.11); lid.rotation.x = -.28; g.add(lid); return g; }, { screens: 1, def: { pos: [0, .75, 0] } });
  def('phone', 'screens', 'هاتف', () => { const g = K.group(); const p = K.group(); p.add(K.rbox(.075, .155, .008, .008, M.blackGloss(), 0, 0, -.004)); const s = K.screen(.068, .146); s.position.z = .0005; p.add(s); p.position.set(0, .085, 0); p.rotation.x = -.15; g.add(p); g.add(K.box(.06, .01, .06, M.metal(), 0, .005, -.01)); return g; }, { screens: 1, def: { pos: [0, .75, 0] } });
  def('cinema', 'screens', 'شاشة سينما', () => { const g = K.group(); const w = 6, h = w / 2.39; g.add(K.box(w + .5, h + .4, .06, K.mat('masking', { color: 0x050505, roughness: 1 }), 0, 1 + h / 2, -.04)); const s = K.screen(w, h); s.position.set(0, 1 + h / 2, 0); g.add(s); for (const x of [-1, 1]) g.add(K.box(.08, 1 + h + .2, .08, M.black(), x * (w / 2 + .3), (1 + h + .2) / 2, -.1)); return g; }, { screens: 1 });
  def('videowall', 'screens', 'جدار فيديو 2×2', () => { const g = K.group(); const w = 1.2, h = w * 9 / 16, gap = .012; const A = (2 * w + gap) / (2 * h + gap); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const t = tv(w, h, { uv: [i / 2, j / 2, (i + 1) / 2, (j + 1) / 2], aspect: A }); t.position.set((i - .5) * (w + gap), 1.25 + (j - .5) * (h + gap), 0); g.add(t); } g.add(K.box(.08, 1.9, .08, M.black(), 0, .95, -.12)); g.add(K.box(1, .04, .5, M.black(), 0, .02, -.12)); return g; }, { screens: 1 });

  /* primitives */
  const primMat = () => K.own({ color: 0xc9ced6, roughness: .45, metalness: .05 });
  def('prim:cube', 'prims', 'مكعب', () => K.group(K.main(K.rbox(1, 1, 1, .02, primMat(), 0, .5, 0))));
  def('prim:sphere', 'prims', 'كرة', () => K.group(K.main(K.sph(.5, primMat(), 0, .5, 0, 64, 40))));
  def('prim:cylinder', 'prims', 'أسطوانة', () => K.group(K.main(K.cyl(.4, .4, 1, primMat(), 0, .5, 0, 48))));
  def('prim:cone', 'prims', 'مخروط', () => K.group(K.main(K.cyl(0, .45, 1, primMat(), 0, .5, 0, 48))));
  def('prim:plane', 'prims', 'مستوى', () => { const m = K.main(K.mesh(new (T().PlaneGeometry)(2, 2), primMat())); m.rotation.x = -Math.PI / 2; m.position.y = .002; m.material.side = T().DoubleSide; return K.group(m); });
  def('prim:torus', 'prims', 'حلقة', () => K.group(K.main(K.mesh(new (T().TorusGeometry)(.4, .14, 32, 96), primMat(), 0, .55, 0))));
  // 3D text: canvas glyphs (full Arabic shaping by the browser) on a stack of planes → solid extruded look
  def('text', 'prims', 'نص ثلاثي الأبعاد', (K2, o) => {
    const t = o.text || {}; const g = K.group(); const px = 160; const font = `${t.weight || 800} ${px}px "${t.font || 'Cairo'}", sans-serif`;
    const cv = document.createElement('canvas'); const g2 = cv.getContext('2d'); g2.font = font; const str = String(t.str || ' '); const lines = str.split('\n');
    const wpx = Math.max(...lines.map(l => g2.measureText(l).width)) + px * .4, hpx = px * 1.35 * lines.length + px * .2; cv.width = Math.ceil(wpx); cv.height = Math.ceil(hpx);
    const draw = (col) => { g2.clearRect(0, 0, cv.width, cv.height); g2.font = font; g2.fillStyle = col; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.direction = GW.isAr(str) ? 'rtl' : 'ltr'; lines.forEach((l, i) => g2.fillText(l, cv.width / 2, px * .1 + px * 1.35 * (i + .5))); };
    const mk = (col) => { draw(col); const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; c2.getContext('2d').drawImage(cv, 0, 0); const tx = new (T().CanvasTexture)(c2); tx.colorSpace = T().SRGBColorSpace; tx.anisotropy = 8; tx.userData.own = true; return tx; };
    const size = +t.size || .5; const W = cv.width / px * size, H = cv.height / px * size; const geo = new (T().PlaneGeometry)(W, H);
    const front = new (T().Mesh)(geo, new (T().MeshStandardMaterial)({ map: mk(t.color || '#fff'), transparent: true, alphaTest: .35, roughness: .35, metalness: .2, side: T().DoubleSide })); front.castShadow = true; front.receiveShadow = true;
    const depth = Math.max(0, +t.depth || 0); const n = depth > 0 ? Math.min(40, Math.max(4, Math.round(depth / .004))) : 0;
    if (n) { const sm = new (T().MeshStandardMaterial)({ map: mk(t.side || '#888'), transparent: true, alphaTest: .35, roughness: .5, metalness: .3, side: T().DoubleSide }); for (let i = 1; i <= n; i++) { const l = new (T().Mesh)(geo, sm); l.position.z = -i * depth / n; l.castShadow = i === n; g.add(l); } }
    front.position.z = 0; g.add(front); g.children.forEach(c => { c.position.y = H / 2; }); g.userData.geoShared = geo; return g;
  }, { def: { pos: [0, 1, 0] } });

  /* lights */
  def('light:ambient', 'lights', 'إضاءة محيطة', () => { const l = new (T().HemisphereLight)(0xdfe8ff, 0x3a3128, 1); const g = K.group(l); g.add(K.helperBulb(0x9fc0ff, .09)); return g; }, { light: { kind: 'ambient', int: .6, color: '#dfe8ff' }, def: { pos: [0, 3, 0] } });
  def('light:sun', 'lights', 'شمس (اتجاهية)', () => { const l = new (T().DirectionalLight)(0xfff1dc, 3); addShadow(l, 2048, 9); const g = K.group(l); g.add(K.helperBulb(0xffd27a, .14)); return g; }, { light: { kind: 'sun', int: 3, color: '#fff1dc', shadow: 1, target: [0, 0, 0] }, def: { pos: [-6, 7, 3] } });
  def('light:point', 'lights', 'ضوء نقطي', () => { const l = new (T().PointLight)(0xffe0b0, 10, 0, 2); addShadow(l); const g = K.group(l); g.add(K.helperBulb(0xffe0b0)); return g; }, { light: { kind: 'point', int: 10, color: '#ffe0b0', dist: 0, shadow: 0 }, def: { pos: [0, 2.4, 1] } });
  def('light:spot', 'lights', 'كشاف (سبوت)', () => { const l = new (T().SpotLight)(0xffffff, 60, 0, .5, .4, 2); addShadow(l); const g = K.group(l); const c = new (T().Mesh)(new (T().ConeGeometry)(.1, .2, 16, 1, true), new (T().MeshBasicMaterial)({ color: 0xffe9a8, wireframe: true })); c.rotation.x = Math.PI; c.userData.vhelper = true; g.add(c); g.add(K.helperBulb(0xffffff, .06)); return g; }, { light: { kind: 'spot', int: 60, color: '#ffffff', angle: 28, pen: .45, dist: 0, shadow: 1, target: [0, 0, 0] }, def: { pos: [2.5, 3.5, 3] } });
  def('light:area', 'lights', 'صندوق إضاءة ناعم', () => { const l = new (T().RectAreaLight)(0xffffff, 6, 1.2, .8); const g = K.group(l); const face = new (T().Mesh)(new (T().PlaneGeometry)(1, 1), new (T().MeshBasicMaterial)({ color: 0xffffff, side: T().DoubleSide, toneMapped: false })); face.name = 'softbox-face'; face.userData.vhelper = true; l.add(face); g.userData.tick = (lt, o) => { face.scale.set(+o.light.w || 1.2, +o.light.h || .8, 1); }; return g; }, { light: { kind: 'area', int: 6, color: '#ffffff', w: 1.2, h: .8, target: [0, 1, 0] }, def: { pos: [-2, 2.2, 2.5] } });
  // softbox / sun / area aim at their target; spot target handled by the runtime
  const aim = S.aimLights = (n, o, lt) => { if (!o.light || !o.light.target) return; for (const l of n.userData.lights || []) if (l.isRectAreaLight) { const tg = GW.pv(o.light.target, lt); l.lookAt(tg[0], tg[1], tg[2]); } };
  void aim;
})();
