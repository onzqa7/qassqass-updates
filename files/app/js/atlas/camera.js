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
  // cam = {lon,lat,zoom,tilt,heading,fov,roll,offX,offY, keys:[{t,lon,lat,zoom,tilt,heading,fov,roll,offX,offY,ease,path}]}
  C.at = (cam, t, mode) => {
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
