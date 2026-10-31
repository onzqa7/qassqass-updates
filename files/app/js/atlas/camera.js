'use strict';
/* GeoWar Atlas — camera model shared by the WebGL globe (raster) and d3 (vectors).
   Camera = {lon, lat, zoom, tilt, heading}. zoom follows web-map semantics (tile zoom at a 1080-px-tall frame).
   Globe: true perspective camera orbiting a target on the unit sphere. Flat: Web-Mercator, top-down, rotatable. */
(function (root) {
  const GW = root.GW = root.GW || {}; const A = GW.Atlas = GW.Atlas || {};
  const d3 = root.d3;
  const RAD = Math.PI / 180, DEG = 180 / Math.PI, REF_H = 1080, FOV = 35 * RAD, TILE = 256;
  const C = A.Cam = { REF_H, FOV, FOV_DEG: 35 };
  // GeoLayers-style extras: fov (deg), roll (deg), offX/offY (target offset as a fraction of the frame, -0.5..0.5)
  const fovOf = (cam) => Math.max(5, Math.min(120, +(cam && cam.fov) || 35)) * RAD;
  C.fovOf = fovOf;

  const v3 = {
    fromLL: (lon, lat) => { const l = lon * RAD, p = lat * RAD, cp = Math.cos(p); return [cp * Math.cos(l), cp * Math.sin(l), Math.sin(p)]; },
    toLL: (v) => { const r = Math.hypot(v[0], v[1], v[2]); return [Math.atan2(v[1], v[0]) * DEG, Math.asin(Math.max(-1, Math.min(1, v[2] / r))) * DEG]; },
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]), norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };
  C.v3 = v3;

  // radians of arc per reference pixel at the target
  C.upp = (zoom, lat) => Math.max(.05, Math.cos((lat || 0) * RAD)) * 2 * Math.PI / (TILE * Math.pow(2, zoom));
  C.zoomForSpan = (spanRad, lat, frac = .8) => Math.log2(Math.max(.05, Math.cos((lat || 0) * RAD)) * 2 * Math.PI * REF_H * frac / (TILE * Math.max(1e-9, spanRad)));
  C.altitudeKm = (zoom, lat, fovDeg) => C.upp(zoom, lat) * REF_H / (2 * Math.tan((fovDeg ? fovDeg * RAD : FOV) / 2)) * 6371;
  // inverse of altitudeKm: zoom that puts the camera at `km` above the target
  C.zoomForAlt = (km, lat, fovDeg) => { const upp = Math.max(1e-12, km / 6371) * 2 * Math.tan((fovDeg ? fovDeg * RAD : FOV) / 2) / REF_H; return Math.max(0, Math.min(21, Math.log2(Math.max(.05, Math.cos((lat || 0) * RAD)) * 2 * Math.PI / (TILE * upp)))); };
  C.mercY = (latDeg) => { const p = Math.max(-85.0511, Math.min(85.0511, latDeg)) * RAD; return Math.log(Math.tan(Math.PI / 4 + p / 2)); };
  C.mercLat = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * DEG;
  const wrap = (x) => ((x + 540) % 360 + 360) % 360 - 180;
  C.wrap = wrap;

  // geoClipCircle around an arbitrary centre, as a d3 stream transform working in radians
  function rotStream(rot, inv) {
    return (s) => ({
      point(x, y) { const r = inv ? rot.invert([x * DEG, y * DEG]) : rot([x * DEG, y * DEG]); s.point(r[0] * RAD, r[1] * RAD); },
      sphere() { s.sphere(); }, lineStart() { s.lineStart(); }, lineEnd() { s.lineEnd(); }, polygonStart() { s.polygonStart(); }, polygonEnd() { s.polygonEnd(); }
    });
  }

  /* Build a view for output size W×H.
     returns { mode, W, H, proj (d3 projection), k (px per radian at target), C, a, u, r, view (GL matrices), visible(p3), project(lon,lat)->[x,y,z] , pick(x,y)->[lon,lat]|null } */
  C.build = (cam, W, H, mode) => {
    const lon = +cam.lon || 0, lat = Math.max(-89.9, Math.min(89.9, +cam.lat || 0)), zoom = Math.max(0, Math.min(21, +cam.zoom || 0));
    const heading = (+cam.heading || 0) * RAD; const pxScale = H / REF_H;
    const offX = Math.max(-.5, Math.min(.5, +cam.offX || 0)) * W, offY = Math.max(-.5, Math.min(.5, +cam.offY || 0)) * H; // screen px offset of the target from the frame centre
    if (mode === 'flat') return buildFlat(lon, lat, zoom, heading, W, H, pxScale, cam, offX, offY);
    let tilt = Math.max(0, Math.min(80, +cam.tilt || 0)) * RAD;
    const fov = fovOf(cam), roll = (+cam.roll || 0) * RAD;
    const upp = C.upp(zoom, lat);
    const d = REF_H * upp / (2 * Math.tan(fov / 2));
    const T = v3.fromLL(lon, lat), U = T;
    const l = lon * RAD, p = lat * RAD;
    const E = [-Math.sin(l), Math.cos(l), 0], N = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
    const F = v3.add(v3.mul(N, Math.cos(heading)), v3.mul(E, Math.sin(heading)));
    // keep the camera above the ground when tilting close-up
    const Cp = v3.add(T, v3.mul(v3.sub(v3.mul(U, Math.cos(tilt)), v3.mul(F, Math.sin(tilt))), d));
    const Pd = v3.len(Cp); const n = v3.mul(Cp, 1 / Pd);
    const a = v3.mul(v3.sub(T, Cp), 1 / d); // view axis
    const u0 = v3.add(v3.mul(F, Math.cos(tilt)), v3.mul(U, Math.sin(tilt))); // screen up (no roll)
    const r0v = v3.cross(a, u0);
    const u = roll ? v3.norm(v3.add(v3.mul(u0, Math.cos(roll)), v3.mul(r0v, Math.sin(roll)))) : u0; // roll about the view axis
    const r = v3.cross(a, u); // screen right (a×u)
    const f = H / (2 * Math.tan(fov / 2)); // focal length in px
    const kpx = f / d; // px per radian at target
    // ---- d3 satellite projection matched to this camera ----
    const nLL = v3.toLL(n);
    const omega = Math.acos(Math.max(-1, Math.min(1, v3.dot(v3.mul(n, -1), a))));
    // roll: direction (at nadir) towards the target must point to +y in the rotated frame
    const D = v3.norm(v3.sub(F, v3.mul(n, v3.dot(F, n))));
    const rot0 = d3.geoRotation([-nLL[0], -nLL[1], 0]);
    const q = rot0(v3.toLL(v3.add(n, v3.mul(D, 1e-4))));
    const gamma = Math.atan2(q[0], q[1]) * DEG + roll * DEG; // angle of D from +y towards +x (+ camera roll)
    const rot = d3.geoRotation([-nLL[0], -nLL[1], gamma]);
    const proj = d3.geoSatellite().distance(Pd).tilt(omega * DEG).rotate([-nLL[0], -nLL[1], gamma]).scale(1).translate([0, 0]).precision(.4);
    // fit scale/translate: target → centre, unit right step → kpx
    const pT = proj([lon, lat]);
    const eps = 1e-5 * (d + 1e-3); const Rpt = v3.toLL(v3.add(T, v3.mul(r, eps)));
    const pR = proj(Rpt); let sc = kpx * eps / Math.hypot(pR[0] - pT[0], pR[1] - pT[1]);
    proj.scale(sc); const pT2 = proj([lon, lat]); proj.translate([W / 2 + offX - pT2[0], H / 2 + offY - pT2[1]]);
    // clipping: horizon cap around nadir + near-plane cap around view axis
    const horizon = Math.acos(Math.min(1, 1 / Pd)) - 1e-6;
    const nearDist = d * .02; const m = v3.dot(Cp, a) + nearDist; // p·a >= m
    const clipH = d3.geoClipCircle(horizon);
    let pre = clipH;
    if (m > -1 && m < 1) {
      const beta = Math.acos(m) - 1e-6;
      const aLL = rot(v3.toLL(a)); // in rotated frame (degrees)
      const rq = d3.geoRotation([-aLL[0], -aLL[1]]);
      const clipN = d3.geoClipCircle(beta);
      const toQ = rotStream(rq, false), fromQ = rotStream(rq, true);
      pre = (s) => clipH(toQ(clipN(fromQ(s))));
    }
    proj.preclip(pre);
    // ---- GL matrices (camera-relative; caller adds model offset) ----
    const near = Math.max(1e-7, d * .01), far = Pd + 1.5;
    const view = [r[0], u[0], -a[0], 0, r[1], u[1], -a[1], 0, r[2], u[2], -a[2], 0, 0, 0, 0, 1]; // column-major rotation (world→camera)
    const tf = 1 / Math.tan(fov / 2), asp = W / H;
    // off-centre perspective: the target lands at (W/2+offX, H/2+offY)
    const projM = [tf / asp, 0, 0, 0, 0, tf, 0, 0, -2 * offX / W, 2 * offY / H, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
    const vw = {
      mode: 'globe', W, H, lon, lat, zoom, tilt: tilt * DEG, heading: heading * DEG, fov: fov * DEG, roll: roll * DEG, offX, offY, proj, kpx, pxScale, d, P: Pd, C: Cp, a, u, r, T, f, view, projM, near, far,
      upp: 1 / kpx, horizon,
      // point → screen [x, y, depth]; null if hidden
      project(lo, la) { const pp = v3.fromLL(lo, la); if (v3.dot(pp, Cp) < 1) return null; const rel = v3.sub(pp, Cp); const z = v3.dot(rel, a); if (z <= nearDist) return null; return [W / 2 + offX + f * v3.dot(rel, r) / z, H / 2 + offY - f * v3.dot(rel, u) / z, z]; },
      visible(lo, la) { const pp = v3.fromLL(lo, la); return v3.dot(pp, Cp) >= 1; },
      // screen → lon/lat on the sphere (ray cast)
      pick(x, y) {
        const dir = v3.norm(v3.add(a, v3.add(v3.mul(r, (x - W / 2 - offX) / f), v3.mul(u, -(y - H / 2 - offY) / f))));
        const b = v3.dot(Cp, dir), c = v3.dot(Cp, Cp) - 1, disc = b * b - c; if (disc < 0) return null;
        const tt = -b - Math.sqrt(disc); if (tt < 0) return null; return v3.toLL(v3.add(Cp, v3.mul(dir, tt)));
      },
      // angular radius (rad) of the visible ground around the target (for culling)
      reach: Math.min(Math.PI, horizon + 0.02)
    };
    return vw;
  };

  function buildFlat(lon, lat, zoom, heading, W, H, pxScale, cam, offX = 0, offY = 0) {
    // flat (Mercator) view: tilt, roll and fov do not apply; only the target offset is honoured
    const kpx = TILE * Math.pow(2, zoom) / (2 * Math.PI) * pxScale; // px per mercator radian
    const proj = d3.geoMercator().rotate([-lon, 0]).center([0, Math.max(-85, Math.min(85, lat))]).scale(kpx).translate([W / 2 + offX, H / 2 + offY]).angle(-(heading * DEG)).precision(.4).clipExtent([[-W * .05, -H * .05], [W * 1.05, H * 1.05]]);
    const y0 = C.mercY(lat); const ch = Math.cos(heading), sh = Math.sin(heading);
    const vw = {
      mode: 'flat', W, H, lon, lat, zoom, tilt: 0, heading: heading * DEG, fov: 0, roll: 0, offX, offY, proj, kpx, pxScale, y0, ch, sh, upp: 1 / kpx,
      // mercator (x=λ-λ0 rad wrapped, y) → screen
      mx(lo, la) { const x = wrap(lo - lon) * RAD, y = C.mercY(la) - y0; return [W / 2 + offX + kpx * (x * ch + y * sh), H / 2 + offY - kpx * (-x * sh + y * ch)]; },
      project(lo, la) { const p = vw.mx(lo, la); return [p[0], p[1], 1]; },
      visible() { return true; },
      pick(x, y) { const dx = (x - W / 2 - offX) / kpx, dy = -(y - H / 2 - offY) / kpx; const mx = dx * ch - dy * sh, my = dx * sh + dy * ch; const la = C.mercLat(my + y0); if (Math.abs(la) > 85.05) return null; return [wrap(lon + mx * DEG), la]; },
      reach: Math.PI
    };
    // visible lon/lat box (approx) for tile selection & culling
    const corners = [[0, 0], [W, 0], [0, H], [W, H], [W / 2, 0], [W / 2, H], [0, H / 2], [W, H / 2]].map(([x, y]) => { const dx = (x - W / 2 - offX) / kpx, dy = -(y - H / 2 - offY) / kpx; return [dx * ch - dy * sh, dx * sh + dy * ch]; });
    vw.mxRange = [Math.min(...corners.map(c => c[0])), Math.max(...corners.map(c => c[0]))];
    vw.myRange = [Math.min(...corners.map(c => c[1])) + y0, Math.max(...corners.map(c => c[1])) + y0];
    return vw;
  }

  /* ---------- camera animation ---------- */
  const EASE = {
    linear: t => t, ease: t => t * t * (3 - 2 * t), in: t => t * t * t, out: t => 1 - Math.pow(1 - t, 3),
    inout: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, hold: t => 0,
  };
  C.EASE = EASE;
  const shortAng = (a, b) => { let d = ((b - a) % 360 + 540) % 360 - 180; return d; };
  function gcDist(a, b) { return d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]); }
  // van Wijk & Nuij smooth zoom-pan between two keys (fraction k in 0..1)
  function fly(A0, B0, k, mode) {
    const rho = 1.42, rho2 = rho * rho;
    const span0 = REF_H * C.upp(A0.zoom, A0.lat);
    const dist = mode === 'flat' ? Math.hypot(shortAng(A0.lon, B0.lon) * RAD, C.mercY(B0.lat) - C.mercY(A0.lat)) * Math.max(.05, Math.cos(A0.lat * RAD)) : gcDist(A0, B0);
    const w0 = 1, w1 = Math.pow(2, A0.zoom - B0.zoom), u1 = dist / span0;
    let zoom, frac;
    if (u1 < 1e-6) { zoom = A0.zoom + (B0.zoom - A0.zoom) * k; frac = k; }
    else {
      const r = (i) => { const b = (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (i ? w1 : w0) * rho2 * u1); return Math.log(Math.sqrt(b * b + 1) - b); };
      const r0 = r(0), r1 = r(1); const S = (r1 - r0) / rho;
      if (!isFinite(S)) { zoom = A0.zoom + (B0.zoom - A0.zoom) * k; frac = k; }
      else {
        const s = k * S; const w = Math.cosh(r0) / Math.cosh(r0 + rho * s); const u = w0 * (Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0)) / rho2;
        zoom = A0.zoom - Math.log2(w); frac = Math.max(0, Math.min(1, u / u1));
      }
    }
    let lon, lat;
    if (mode === 'flat') { lon = A0.lon + shortAng(A0.lon, B0.lon) * frac; lat = C.mercLat(C.mercY(A0.lat) + (C.mercY(B0.lat) - C.mercY(A0.lat)) * frac); }
    else { const ip = d3.geoInterpolate([A0.lon, A0.lat], [B0.lon, B0.lat])(frac); lon = ip[0]; lat = ip[1]; }
    return { lon, lat, zoom };
  }
  // extra (GeoLayers-like) camera properties, all keyframable: fov (deg), roll (deg), offX/offY (fraction of frame)
  C.EXTRA = ['fov', 'roll', 'offX', 'offY'];
  const DEF = { fov: 35, roll: 0, offX: 0, offY: 0 };
  C.DEF = DEF;
  const ex = (k, key, cam) => key[k] != null ? +key[k] : (cam && cam[k] != null ? +cam[k] : DEF[k]);
  // legacy evaluator (v1 keys: every key carries every property, `ease` string + `path`) — kept for regression tests
  C.atLegacy = (cam, t, mode) => {
    const ks = cam.keys || [];
    let out;
    if (!ks.length) out = { lon: cam.lon, lat: cam.lat, zoom: cam.zoom, tilt: cam.tilt || 0, heading: cam.heading || 0, fov: ex('fov', {}, cam), roll: ex('roll', {}, cam), offX: ex('offX', {}, cam), offY: ex('offY', {}, cam) };
    else if (t <= ks[0].t) out = { ...ks[0] };
    else if (t >= ks[ks.length - 1].t) out = { ...ks[ks.length - 1] };
    else {
      let i = 0; while (i < ks.length - 1 && ks[i + 1].t <= t) i++;
      const A0 = ks[i], B0 = ks[i + 1]; const e = EASE[A0.ease || 'inout'] || EASE.inout;
      const k = e((t - A0.t) / Math.max(1e-6, B0.t - A0.t));
      const base = (A0.path === 'linear') ? { lon: A0.lon + shortAng(A0.lon, B0.lon) * k, lat: A0.lat + (B0.lat - A0.lat) * k, zoom: A0.zoom + (B0.zoom - A0.zoom) * k } : fly(A0, B0, k, mode);
      out = { ...base, tilt: (A0.tilt || 0) + ((B0.tilt || 0) - (A0.tilt || 0)) * k, heading: (A0.heading || 0) + shortAng(A0.heading || 0, B0.heading || 0) * k };
      for (const q of C.EXTRA) { const a0 = ex(q, A0, cam), b0 = ex(q, B0, cam); out[q] = q === 'roll' ? a0 + shortAng(a0, b0) * k : a0 + (b0 - a0) * k; }
    }
    if (ks.length) for (const q of C.EXTRA) if (out[q] == null) out[q] = ex(q, {}, cam);
    delete out.t; delete out.ease; delete out.path;
    // procedural motion
    if (cam.orbit) out.heading = (out.heading || 0) + cam.orbit * t;
    if (cam.drift) out.zoom += cam.drift * t;
    if (cam.shake) { const s = cam.shake, n = (x, sd) => Math.sin(x * 1.7 + sd) * .6 + Math.sin(x * 3.1 + sd * 2.3) * .3 + Math.sin(x * 7.3 + sd * 5.1) * .1; const sp = C.upp(out.zoom, out.lat) * DEG * 6 * s; out.lon += n(t * 2, 1) * sp; out.lat += n(t * 2, 7) * sp; out.heading += n(t * 1.5, 3) * .3 * s; }
    out.lon = wrap(out.lon);
    return out;
  };

  /* ---------- camera keyframes v2 (After Effects / GEOlayers-like) ----------
     cam.keys = [{t, lon?, lat?, zoom?, tilt?, heading?, roll?, fov?, offX?, offY?, interp, ease:{in:[x,y], out:[x,y]}, roving?}]
     • Keys are sparse per property group: a key only animates the groups whose fields it carries; each group is evaluated
       from the keys that define it (no keys → the static cam value).
     • interp (outgoing segment): 'fly' (van Wijk zoom-pan arc for position + zoom), 'bezier' (smooth centripetal
       Catmull-Rom path through the position keys, constant spatial speed), 'linear', 'hold'.
     • ease: AE-like temporal bezier handles normalised to the segment (x = influence, y = progress): Easy Ease = [1/3, 0],
       linear = [1/3, 1/3]. The segment A→B uses A.ease.out and B.ease.in (same maths as GW.keyHandles / GW.bezierAt).
     • roving: the key's time is derived so the position moves at constant speed between its non-roving neighbours.
     • Legacy keys (no `interp`): every group defined, missing tilt/heading = 0, extras = cam/DEF, the outgoing curve is
       EASE[ease || 'inout'] and the path is fly unless path === 'linear' — they evaluate exactly like before. */
  const GROUPS = { pos: ['lon', 'lat'], zoom: ['zoom'], tilt: ['tilt'], heading: ['heading'], roll: ['roll'], fov: ['fov'], off: ['offX', 'offY'] };
  C.GROUPS = GROUPS; C.GLIST = Object.keys(GROUPS); C.FIELDS = [].concat(...Object.values(GROUPS));
  C.groupOf = (f) => C.GLIST.find(g => GROUPS[g].includes(f)) || null;
  const EASY = [1 / 3, 0], LIN = [1 / 3, 1 / 3];
  C.EASY = EASY; C.LIN = LIN; C.easyEase = () => ({ in: EASY.slice(), out: EASY.slice() });
  const isLeg = (k) => k.interp == null;
  C.isLegacy = isLeg;
  C.defines = (k, g) => isLeg(k) || GROUPS[g].some(f => k[f] != null);
  const ANG = { heading: 1, roll: 1 };
  // static (un-keyed) value of a field
  C.staticVal = (cam, f) => f in DEF ? ex(f, {}, cam) : (f === 'tilt' || f === 'heading') ? (+cam[f] || 0) : +cam[f] || 0;
  // value a key holds for a field (legacy fall-backs reproduce the v1 evaluator)
  const kv = (k, f, cam) => k[f] != null ? +k[f] : isLeg(k) ? ((f === 'tilt' || f === 'heading') ? 0 : f in DEF ? ex(f, {}, cam) : C.staticVal(cam, f)) : C.staticVal(cam, f);
  C.keyVal = kv;
  // cubic-bezier timing (identical to GW.bezierAt in util.js so the graph editor and the camera agree)
  const bez = (h, u) => {
    const [x1, y1, x2, y2] = h; if (u <= 0) return 0; if (u >= 1) return 1;
    const bx = s => ((1 - 3 * x2 + 3 * x1) * s + (3 * x2 - 6 * x1)) * s * s + 3 * x1 * s;
    const dx = s => 3 * (1 - 3 * x2 + 3 * x1) * s * s + 2 * (3 * x2 - 6 * x1) * s + 3 * x1;
    let s = u;
    for (let n = 0; n < 8; n++) { const e = bx(s) - u; if (Math.abs(e) < 1e-7) break; const d = dx(s); if (Math.abs(d) < 1e-6) break; s -= e / d; }
    if (!(s >= 0 && s <= 1) || Math.abs(bx(s) - u) > 1e-6) { let a = 0, b = 1; s = u; for (let n = 0; n < 50; n++) { const v = bx(s); if (Math.abs(v - u) < 1e-8) break; if (v < u) a = s; else b = s; s = (a + b) / 2; } }
    return ((1 - 3 * y2 + 3 * y1) * s + (3 * y2 - 6 * y1)) * s * s + 3 * y1 * s;
  };
  C.bez = bez;
  // [x, y] handle of a key side ('in' | 'out')
  C.handle = (k, side) => { const e = k && k.ease; if (e && typeof e === 'object' && Array.isArray(e[side])) return [Math.max(0, Math.min(1, +e[side][0])), +e[side][1]]; if (e === 'linear') return LIN; return EASY; };
  // the cubic-bezier [x1,y1,x2,y2] of segment A→B (approximation for legacy string curves, used for drawing only)
  C.segHandles = (A, B) => { const o = C.handle(A, 'out'), i = C.handle(B, 'in'); return [o[0], o[1], 1 - i[0], 1 - i[1]]; };
  // temporal progress 0..1 of segment A→B at time fraction u
  C.timing = (A, B, u) => {
    if (u <= 0) return 0; if (u >= 1) return 1;
    if (A.interp === 'hold') return 0;
    if (isLeg(A) || typeof A.ease === 'string' || A.ease == null && isLeg(A)) return (EASE[A.ease || 'inout'] || EASE.inout)(u);
    return bez(C.segHandles(A, B), u);
  };
  const interpOf = (k) => isLeg(k) ? (k.path === 'linear' ? 'linear' : 'fly') : (k.interp || 'fly');
  C.interpOf = interpOf;
  const track = (ks, g) => ks.filter(k => C.defines(k, g)).sort((a, b) => a.t - b.t);
  C.track = (cam, g) => track(cam.keys || [], g);
  const seg = (tr, t) => { let i = 0; while (i < tr.length - 1 && tr[i + 1].t <= t) i++; return i; };
  function scalarAt(tr, f, t, cam) {
    if (t <= tr[0].t) return kv(tr[0], f, cam);
    const L = tr[tr.length - 1]; if (t >= L.t) return kv(L, f, cam);
    const i = seg(tr, t); const A = tr[i], B = tr[i + 1];
    const k = C.timing(A, B, (t - A.t) / Math.max(1e-6, B.t - A.t));
    const a = kv(A, f, cam), b = kv(B, f, cam);
    return ANG[f] ? a + shortAng(a, b) * k : a + (b - a) * k;
  }
  // ---- spatial path helpers (globe: unit vectors, flat: [unwrapped lon rad, mercator y]) ----
  const toP = (lon, lat, mode) => mode === 'flat' ? [lon * RAD, C.mercY(lat)] : v3.fromLL(lon, lat);
  const fromP = (p, mode) => mode === 'flat' ? [p[0] * DEG, C.mercLat(p[1])] : v3.toLL(p);
  const dist = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
  function catmull(P0, P1, P2, P3, s) { // centripetal Catmull-Rom (Barry–Goldman), s ∈ [0,1] between P1 and P2
    const d = (a, b) => Math.sqrt(Math.max(1e-9, dist(a, b)));
    const t0 = 0, t1 = t0 + d(P0, P1), t2 = t1 + d(P1, P2), t3 = t2 + d(P2, P3); const t = t1 + (t2 - t1) * s;
    const L = (A, B, ta, tb) => A.map((x, i) => x * (tb - t) / (tb - ta) + B[i] * (t - ta) / (tb - ta));
    const A1 = L(P0, P1, t0, t1), A2 = L(P1, P2, t1, t2), A3 = L(P2, P3, t2, t3);
    return L(L(A1, A2, t0, t2), L(A2, A3, t1, t3), t1, t2);
  }
  // unwrapped control points of a position track
  function ctrl(tr, cam, mode) {
    let lon0 = null; return tr.map(k => { let lo = kv(k, 'lon', cam); if (lon0 != null) lo = lon0 + shortAng(lon0, lo); lon0 = lo; return toP(lo, kv(k, 'lat', cam), mode); });
  }
  const norm = (p, mode) => mode === 'flat' ? p : v3.norm(p);
  // sampled curve of segment i (N+1 points, normalised) with cumulative lengths
  function segSamples(P, i, mode, N = 24) {
    const P1 = P[i], P2 = P[i + 1]; const P0 = P[i - 1] || P1.map((x, j) => 2 * x - P2[j]); const P3 = P[i + 2] || P2.map((x, j) => 2 * x - P1[j]);
    const pts = [], cum = [0];
    for (let j = 0; j <= N; j++) { const q = norm(catmull(P0, P1, P2, P3, j / N), mode); if (j) cum.push(cum[j - 1] + dist(q, pts[j - 1])); pts.push(q); }
    return { pts, cum, len: cum[N] };
  }
  const atLen = (S, l) => { const { pts, cum } = S; if (l <= 0) return pts[0]; const N = pts.length - 1; if (l >= cum[N]) return pts[N]; let j = 1; while (cum[j] < l) j++; const f = (l - cum[j - 1]) / Math.max(1e-15, cum[j] - cum[j - 1]); return pts[j - 1].map((x, q) => x + (pts[j][q] - x) * f); };
  const llOf = (p, mode) => { const r = fromP(p, mode); return { lon: r[0], lat: r[1] }; };
  // roving span [a, b] of the position track around segment i (a, b non-roving; ends of the track count as anchors)
  function span(tr, i) { let a = i, b = i + 1; while (a > 0 && tr[a].roving) a--; while (b < tr.length - 1 && tr[b].roving) b++; return [a, b]; }
  function posAt(cam, tr, t, mode, zoomAt) {
    if (t <= tr[0].t) return { lon: kv(tr[0], 'lon', cam), lat: kv(tr[0], 'lat', cam) };
    const Lk = tr[tr.length - 1]; if (t >= Lk.t) return { lon: kv(Lk, 'lon', cam), lat: kv(Lk, 'lat', cam) };
    const i = seg(tr, t); const A = tr[i], B = tr[i + 1];
    const [a, b] = span(tr, i);
    if (b - a > 1 && !isLeg(tr[a])) { // roving: constant spatial speed along the smooth path from tr[a] to tr[b]
      if (tr[a].interp === 'hold') return { lon: kv(tr[a], 'lon', cam), lat: kv(tr[a], 'lat', cam) };
      const P = ctrl(tr, cam, mode); const Ss = []; let L = 0; for (let j = a; j < b; j++) { const S = segSamples(P, j, mode); Ss.push(S); L += S.len; }
      let l = C.timing(tr[a], tr[b], (t - tr[a].t) / Math.max(1e-6, tr[b].t - tr[a].t)) * L;
      for (const S of Ss) { if (l <= S.len || S === Ss[Ss.length - 1]) return llOf(atLen(S, l), mode); l -= S.len; }
    }
    const k = C.timing(A, B, (t - A.t) / Math.max(1e-6, B.t - A.t)); const ip = interpOf(A);
    const la = kv(A, 'lat', cam), lb = kv(B, 'lat', cam), oa = kv(A, 'lon', cam), ob = kv(B, 'lon', cam);
    if (ip === 'hold') return { lon: oa, lat: la };
    if (ip === 'linear') return { lon: oa + shortAng(oa, ob) * k, lat: la + (lb - la) * k };
    if (ip === 'fly') { const r = fly({ lon: oa, lat: la, zoom: zoomAt(A.t) }, { lon: ob, lat: lb, zoom: zoomAt(B.t) }, k, mode); r.seg = [A.t, B.t]; return r; }
    const P = ctrl(tr, cam, mode); const S = segSamples(P, i, mode); return llOf(atLen(S, k * S.len), mode);
  }
  // the camera at time t without the procedural extras (orbit / drift / shake)
  C.atRaw = (cam, t, mode) => {
    const ks = cam.keys || [];
    if (!ks.length) return { lon: cam.lon, lat: cam.lat, zoom: cam.zoom, tilt: cam.tilt || 0, heading: cam.heading || 0, fov: ex('fov', {}, cam), roll: ex('roll', {}, cam), offX: ex('offX', {}, cam), offY: ex('offY', {}, cam) };
    const out = {}; const T = {}; for (const g of C.GLIST) T[g] = track(ks, g);
    for (const g of C.GLIST) { if (g === 'pos') continue; for (const f of GROUPS[g]) out[f] = T[g].length ? scalarAt(T[g], f, t, cam) : C.staticVal(cam, f); }
    if (T.pos.length) {
      const zoomAt = (tt) => T.zoom.length ? scalarAt(T.zoom, 'zoom', tt, cam) : C.staticVal(cam, 'zoom');
      const r = posAt(cam, T.pos, t, mode, zoomAt); out.lon = r.lon; out.lat = r.lat;
      // the van Wijk arc owns the zoom when the zoom keys bracket the same segment (an un-keyed zoom stays static, like AE)
      if (r.zoom != null) { const z = T.zoom; let own = false; if (z.length > 1 && t > z[0].t && t < z[z.length - 1].t) { const j = seg(z, t); own = Math.abs(z[j].t - r.seg[0]) < 1e-6 && Math.abs(z[j + 1].t - r.seg[1]) < 1e-6; } if (own) out.zoom = r.zoom; }
    } else { out.lon = C.staticVal(cam, 'lon'); out.lat = C.staticVal(cam, 'lat'); }
    return out;
  };
  // cam = {lon,lat,zoom,tilt,heading,fov,roll,offX,offY, orbit, drift, shake, keys:[…]}
  C.at = (cam, t, mode) => {
    const out = C.atRaw(cam, t, mode);
    if (cam.orbit) out.heading = (out.heading || 0) + cam.orbit * t;
    if (cam.drift) out.zoom += cam.drift * t;
    if (cam.shake) { const s = cam.shake, n = (x, sd) => Math.sin(x * 1.7 + sd) * .6 + Math.sin(x * 3.1 + sd * 2.3) * .3 + Math.sin(x * 7.3 + sd * 5.1) * .1; const sp = C.upp(out.zoom, out.lat) * DEG * 6 * s; out.lon += n(t * 2, 1) * sp; out.lat += n(t * 2, 7) * sp; out.heading += n(t * 1.5, 3) * .3 * s; }
    out.lon = wrap(out.lon);
    return out;
  };

  /* ---------- key editing (pure; shared by the Effect Controls, Maps panel, monitor auto-key and the API) ---------- */
  C.animated = (cam, g) => (cam.keys || []).some(k => g ? C.defines(k, g) : true);
  // v1 → v2: make every legacy key explicit (evaluates identically: legacy `ease` strings stay as segment curves)
  C.modernize = (cam) => {
    for (const k of cam.keys || []) if (isLeg(k)) { for (const f of C.FIELDS) k[f] = kv(k, f, cam); k.interp = k.path === 'linear' ? 'linear' : 'fly'; delete k.path; if (k.ease == null) k.ease = 'inout'; }
    return cam;
  };
  const near = (a, b, eps) => Math.abs(a - b) < eps;
  C.keysAt = (cam, t, eps = 1 / 240) => (cam.keys || []).filter(k => near(k.t, t, eps));
  C.keyAt = (cam, t, g, eps = 1 / 240) => (cam.keys || []).find(k => near(k.t, t, eps) && (!g || C.defines(k, g))) || null;
  const sortK = (cam) => cam.keys.sort((a, b) => a.t - b.t);
  const newKey = (t, o = {}) => ({ t, interp: o.interp || 'fly', ease: o.ease ? JSON.parse(JSON.stringify(o.ease)) : C.easyEase(), ...(o.roving ? { roving: 1 } : {}) });
  // write field values as keys at time t (merging into the key of each group at t, else any key at t, else a new key)
  C.setKey = (cam, t, vals, o = {}) => {
    C.modernize(cam); cam.keys = cam.keys || []; const eps = o.eps || 1 / 240; const touched = [];
    const byG = {}; for (const f in vals) { const g = C.groupOf(f); if (g && vals[f] != null && isFinite(+vals[f])) (byG[g] = byG[g] || {})[f] = +vals[f]; }
    for (const g in byG) {
      let k = cam.keys.find(x => near(x.t, t, eps) && C.defines(x, g)) || cam.keys.find(x => near(x.t, t, eps));
      if (!k) { k = newKey(t, o); cam.keys.push(k); }
      // a group is always written whole (lon+lat, offX+offY)
      const cur = C.atRaw({ ...cam, keys: cam.keys.filter(x => x !== k || C.defines(x, g)) }, t, o.mode); for (const f of GROUPS[g]) if (k[f] == null) k[f] = cur[f];
      Object.assign(k, byG[g]); if (o.interp) k.interp = o.interp; if (!touched.includes(k)) touched.push(k);
    }
    sortK(cam); if (o.mode !== undefined) C.rove(cam, o.mode); return touched;
  };
  // remove one group from a key (or the whole key when g is omitted); empty keys are dropped
  C.delKey = (cam, k, g) => {
    C.modernize(cam); if (g) for (const f of GROUPS[g]) delete k[f];
    if (!g || !C.GLIST.some(q => GROUPS[q].some(f => k[f] != null))) cam.keys = cam.keys.filter(x => x !== k);
  };
  // give group g its own key at k.t (so it can be retimed / eased independently, like a property keyframe in AE)
  C.split = (cam, k, g) => {
    C.modernize(cam); const own = C.GLIST.filter(q => q !== g && GROUPS[q].some(f => k[f] != null));
    if (!own.length) return k;
    const n = newKey(k.t, { interp: k.interp, ease: typeof k.ease === 'object' ? k.ease : null, roving: k.roving }); if (typeof k.ease === 'string') n.ease = k.ease;
    for (const f of GROUPS[g]) { if (k[f] != null) n[f] = k[f]; delete k[f]; }
    cam.keys.push(n); sortK(cam); return n;
  };
  // stopwatch: on → key the current value at t; off → keep the value at t as the static value and drop the group's keys
  C.setAnimated = (cam, g, on, t, mode) => {
    if (on) { const v = C.atRaw(cam, t, mode); const vals = {}; for (const f of GROUPS[g]) vals[f] = v[f]; return C.setKey(cam, t, vals, { mode }); }
    const v = C.atRaw(cam, t, mode); C.modernize(cam);
    for (const f of GROUPS[g]) cam[f] = v[f];
    for (const k of (cam.keys || []).slice()) if (C.defines(k, g)) C.delKey(cam, k, g);
    return [];
  };
  // temporal ease presets for one key ('ease' | 'easeIn' | 'easeOut' | 'linear' | 'hold' | 'fly' | 'bezier' | 'roving' | 'still')
  C.setInterp = (k, kind) => {
    if (isLeg(k)) { k.interp = k.path === 'linear' ? 'linear' : 'fly'; delete k.path; }
    const e = typeof k.ease === 'object' && k.ease ? k.ease : (k.ease = C.easyEase());
    if (kind === 'ease') { e.in = EASY.slice(); e.out = EASY.slice(); if (k.interp === 'linear' || k.interp === 'hold') k.interp = 'bezier'; }
    else if (kind === 'easeIn') { e.in = EASY.slice(); e.out = LIN.slice(); if (k.interp === 'linear' || k.interp === 'hold') k.interp = 'bezier'; }
    else if (kind === 'easeOut') { e.out = EASY.slice(); e.in = LIN.slice(); if (k.interp === 'linear' || k.interp === 'hold') k.interp = 'bezier'; }
    else if (kind === 'linear') { k.interp = 'linear'; e.in = LIN.slice(); e.out = LIN.slice(); }
    else if (kind === 'hold') k.interp = 'hold';
    else if (kind === 'fly' || kind === 'bezier') { k.interp = kind; }
    else if (kind === 'roving') { if (k.roving) delete k.roving; else k.roving = 1; }
    k.ease = e; return k;
  };
  // display kind of a key's temporal ease (for diamond shapes / menus)
  C.easeKind = (k) => {
    if (k.interp === 'hold') return 'hold';
    if (typeof k.ease === 'string' || k.ease == null) return k.ease === 'linear' ? 'linear' : 'ease';
    const fi = C.handle(k, 'in')[1] < .05, fo = C.handle(k, 'out')[1] < .05;
    return fi && fo ? 'ease' : fi ? 'easeIn' : fo ? 'easeOut' : 'linear';
  };
  // roving keys: derive their times so the position moves at constant speed between non-roving keys
  C.rove = (cam, mode) => {
    const tr = track(cam.keys || [], 'pos'); if (tr.length < 3 || !tr.some(k => k.roving)) return;
    const P = ctrl(tr, cam, mode);
    for (let a = 0; a < tr.length - 1;) {
      let b = a + 1; while (b < tr.length - 1 && tr[b].roving) b++;
      if (b - a > 1) {
        const lens = []; for (let j = a; j < b; j++) lens.push(segSamples(P, j, mode).len); const L = lens.reduce((x, y) => x + y, 0) || 1;
        let acc = 0; const T0 = tr[a].t, T1 = tr[b].t;
        for (let j = a + 1; j < b; j++) { acc += lens[j - a - 1]; const g = acc / L; let lo = 0, hi = 1; for (let n = 0; n < 40; n++) { const m = (lo + hi) / 2; if (C.timing(tr[a], tr[b], m) < g) lo = m; else hi = m; } tr[j].t = T0 + (T1 - T0) * (lo + hi) / 2; }
      }
      a = b;
    }
    sortK(cam);
  };
  // retime all keys between the first and the last so the camera travels at a constant perceived speed
  // (distance in frame heights at the current altitude + zoom levels + rotations)
  C.equalize = (cam, mode) => {
    C.modernize(cam); const ks = sortK(cam); if (ks.length < 3) return false;
    const v = ks.map(k => C.atRaw(cam, k.t, mode)); const cost = [0];
    for (let i = 1; i < ks.length; i++) {
      const a = v[i - 1], b = v[i]; const z = Math.min(a.zoom, b.zoom); const fh = REF_H * C.upp(z, (a.lat + b.lat) / 2);
      const d = Math.hypot(d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]) / Math.max(1e-9, fh), (b.zoom - a.zoom) * .8, shortAng(a.heading, b.heading) / 60, (b.tilt - a.tilt) / 40, shortAng(a.roll, b.roll) / 40, (b.fov - a.fov) / 30, Math.hypot(b.offX - a.offX, b.offY - a.offY) * 2);
      cost.push(cost[i - 1] + Math.max(1e-3, d));
    }
    const T0 = ks[0].t, T1 = ks[ks.length - 1].t, L = cost[cost.length - 1];
    ks.forEach((k, i) => { k.t = T0 + (T1 - T0) * cost[i] / L; }); return true;
  };
  // time-reverse the keys (the outgoing interpolation of every segment moves with it; ease in/out swap)
  C.reverse = (cam) => {
    C.modernize(cam); const ks = sortK(cam); if (ks.length < 2) return false;
    const T0 = ks[0].t, T1 = ks[ks.length - 1].t; const es = ks.map(k => k.ease);
    const flipS = (s) => s === 'in' ? 'out' : s === 'out' ? 'in' : s;
    // the spatial interpolation of a segment belongs to its first key: shift it along the position track
    const tp = track(ks, 'pos'); const ip = tp.map(k => k.interp); tp.forEach((k, i) => { if (i > 0) k.interp = ip[i - 1]; });
    ks.forEach((k, i) => {
      k.t = T0 + T1 - k.t; const e = es[i];
      if (e && typeof e === 'object') k.ease = { in: (e.out || EASY).slice(), out: (e.in || EASY).slice() }; // per-key handles: in ↔ out
      else { const ep = es[i > 0 ? i - 1 : i]; k.ease = typeof ep === 'string' ? flipS(ep) : C.easyEase(); } // legacy segment curves move with their segment
    });
    sortK(cam); return true;
  };
  // convert legacy-style keys (ease strings / path) into v2 bezier keys (used by the ready-made moves)
  C.properize = (cam) => {
    const ks = sortK(cam); const OUT = { inout: EASY, ease: EASY, in: EASY, out: LIN, linear: LIN }, IN = { inout: EASY, ease: EASY, in: LIN, out: EASY, linear: LIN };
    const es = ks.map(k => typeof k.ease === 'string' ? k.ease : (k.ease == null && isLeg(k) ? 'inout' : null));
    ks.forEach((k, i) => {
      const e = es[i], ep = i ? es[i - 1] : null; const leg = isLeg(k);
      if (leg) { for (const f of C.FIELDS) k[f] = kv(k, f, cam); k.interp = e === 'linear' ? 'linear' : k.path === 'linear' ? 'bezier' : 'fly'; delete k.path; }
      if (e === 'hold') k.interp = 'hold';
      if (e != null || ep != null) k.ease = { in: (ep ? IN[ep] || EASY : (typeof k.ease === 'object' && k.ease && k.ease.in) || EASY).slice(), out: (e ? OUT[e] || EASY : (typeof k.ease === 'object' && k.ease && k.ease.out) || EASY).slice() };
    });
    return cam;
  };
  // a key (or several keys at one time) → clipboard record and back
  C.copyKeys = (keys, t0) => keys.map(k => { const o = JSON.parse(JSON.stringify(k)); o.t = k.t - t0; return o; });
  C.pasteKeys = (cam, recs, t, o = {}) => {
    C.modernize(cam); cam.keys = cam.keys || []; const out = [];
    for (const r of recs) { const tt = t + r.t; const k = JSON.parse(JSON.stringify(r)); k.t = tt; if (isLeg(k)) { for (const f of C.FIELDS) k[f] = kv(r, f, cam); k.interp = k.path === 'linear' ? 'linear' : 'fly'; delete k.path; }
      // replace the groups this record carries at that time
      for (const g of C.GLIST) if (C.defines(k, g)) for (const x of cam.keys.filter(x => near(x.t, tt, 1 / 240) && C.defines(x, g))) C.delKey(cam, x, g);
      cam.keys.push(k); out.push(k); }
    sortK(cam); if (o.mode !== undefined) C.rove(cam, o.mode); return out;
  };
  // camera that fits a lon/lat bounds [[w,s],[e,n]] (from d3.geoBounds)
  // (frac = fraction of the frame height the bounds should fill; e.g. .6 leaves room for text beside the country)
  C.fit = (b, tilt = 0, heading = 0, frac = .7) => {
    let w = b[0][0], e = b[1][0]; if (e < w) e += 360;
    const lon = wrap((w + e) / 2), lat = (b[0][1] + b[1][1]) / 2;
    const span = Math.max((e - w) * Math.cos(lat * RAD) * 9 / 16, b[1][1] - b[0][1]) * RAD;
    return { lon, lat, zoom: Math.max(1, Math.min(16, C.zoomForSpan(span, lat, frac))), tilt, heading };
  };
  // a complete key/camera record (used by the UI when writing keys so every property is explicit)
  C.full = (v) => { const o = { lon: +v.lon || 0, lat: +v.lat || 0, zoom: +v.zoom || 0, tilt: +v.tilt || 0, heading: +v.heading || 0 }; for (const q of C.EXTRA) o[q] = v[q] != null ? +v[q] : DEF[q]; return o; };
})(typeof window !== 'undefined' ? window : globalThis);
