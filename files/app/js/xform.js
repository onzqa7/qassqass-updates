'use strict';
/* After Effects–style 3D layers, cameras, null objects and parenting.
   Shared transform math for the renderer (render.js) and the Program monitor overlay (ui_monitors.js).
   Coordinate system = AE: x right, y down, z away from the viewer (sequence pixels). Matrices are column-major 4×4. */
(function () {
  const X = GW.X = {};
  const D2R = Math.PI / 180;
  const I = () => { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
  const mul = (a, b) => { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; } return o; };
  const T = (x, y, z) => { const m = I(); m[12] = x; m[13] = y; m[14] = z || 0; return m; };
  const S = (x, y, z) => { const m = I(); m[0] = x; m[5] = y; m[10] = z; return m; };
  const Rx = a => { const m = I(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; };
  const Ry = a => { const m = I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; };
  const Rz = a => { const m = I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; };
  const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
  function inv(m) {
    const o = new Float64Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!det) return I(); det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det; o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  }
  // drop the z part of a world matrix (2D child of a 3D parent)
  const flat = m => { const o = Float64Array.from(m); o[2] = o[6] = o[8] = o[9] = o[14] = 0; o[10] = 1; o[3] = o[7] = o[11] = 0; o[15] = 1; return o; };
  Object.assign(X, { I, mul, T, S, Rx, Ry, Rz, apply, inv, flat });

  const pv = (p, lt, d) => p == null ? d : GW.pv(p, lt);
  X.KEYS3D = ['posZ', 'anchorZ', 'oriX', 'oriY', 'oriZ', 'rotX', 'rotY'];
  X.isCam = c => c && c.kind === 'camera';
  X.is3D = c => !!(c && c.motion && (c.td || c.kind === 'camera') && c.kind !== 'adjust');
  X.ensure3D = (c) => { if (!c.motion) return; for (const k of X.KEYS3D) if (!c.motion[k]) c.motion[k] = GW.P(0); };
  X.defaultZoom = (s) => s.w * 50 / 54; // AE 50 mm preset: 1777.8 px on a 1920-wide comp
  X.parentOf = (s, c) => { if (!c || !c.parent) return null; const p = s.clips.find(x => x.id === c.parent); return p && p !== c && p.tt === 'v' && p.motion ? p : null; };

  function rot3(m, lt) {
    return mul(mul(mul(Rx(pv(m.oriX, lt, 0) * D2R), Ry(pv(m.oriY, lt, 0) * D2R)), Rz(pv(m.oriZ, lt, 0) * D2R)),
      mul(mul(Rx(pv(m.rotX, lt, 0) * D2R), Ry(pv(m.rotY, lt, 0) * D2R)), Rz(pv(m.rot, lt, 0) * D2R)));
  }
  // camera "look-at" rotation: z axis towards the point of interest, y axis down
  function lookAt(p, q) {
    let f = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]; const fl = Math.hypot(...f); if (fl < 1e-6) return I(); f = f.map(v => v / fl);
    let x = [f[2], 0, -f[0]]; // cross((0,1,0), f)
    let xl = Math.hypot(...x); if (xl < 1e-6) { x = [1, 0, 0]; xl = 1; } x = x.map(v => v / xl);
    const y = [f[1] * x[2] - f[2] * x[1], f[2] * x[0] - f[0] * x[2], f[0] * x[1] - f[1] * x[0]];
    const m = I(); m[0] = x[0]; m[1] = x[1]; m[2] = x[2]; m[4] = y[0]; m[5] = y[1]; m[6] = y[2]; m[8] = f[0]; m[9] = f[1]; m[10] = f[2]; return m;
  }
  // layer space (source px) → parent space; `extra` = camera-shake offsets for the layer itself
  X.local = (c, lt, extra) => {
    const m = c.motion; if (!m) return I();
    const pos = GW.pv(m.pos, lt);
    if (c.kind === 'camera') {
      const p3 = [pos[0], pos[1], pv(m.posZ, lt, 0)]; let R = rot3(m, lt);
      const cm = c.cam || {};
      if (cm.type !== 'one') { const q = GW.pv(cm.poi, lt) || [p3[0], p3[1]]; R = mul(lookAt(p3, [q[0], q[1], pv(cm.poiZ, lt, 0)]), R); }
      return mul(T(p3[0], p3[1], p3[2]), R);
    }
    const an = GW.pv(m.anchor, lt);
    const s = GW.pv(m.scale, lt) / 100, sw = m.uni ? s : GW.pv(m.scaleW, lt) / 100;
    let ox = 0, oy = 0, zs = 1, er = 0;
    if (extra) { ox = extra.x || 0; oy = extra.y || 0; er = extra.rot || 0; zs = extra.zoom || 1; }
    if (!X.is3D(c)) return mul(mul(T(pos[0] + ox, pos[1] + oy, 0), Rz((GW.pv(m.rot, lt) + er) * D2R)), mul(S(sw * zs, s * zs, 1), T(-an[0], -an[1], 0)));
    let R = rot3(m, lt); if (er) R = mul(R, Rz(er * D2R));
    return mul(mul(T(pos[0] + ox, pos[1] + oy, pv(m.posZ, lt, 0)), R), mul(S(sw * zs, s * zs, s * zs), T(-an[0], -an[1], -pv(m.anchorZ, lt, 0))));
  };
  // parent chain (cycle-safe); t = sequence time
  X.world = (s, c, t, extra, seen) => {
    let M = X.local(c, t - c.start, extra);
    const p = X.parentOf(s, c);
    if (p && !(seen && seen.has(p.id)) && (!seen || seen.size < 64)) {
      const sn = seen || new Set(); sn.add(c.id);
      let PW = X.world(s, p, t, null, sn); if (!X.is3D(c)) PW = flat(PW);
      M = mul(PW, M);
    }
    return M;
  };
  X.parentWorld = (s, c, t) => { const p = X.parentOf(s, c); if (!p) return I(); const PW = X.world(s, p, t, null, new Set([c.id])); return X.is3D(c) ? PW : flat(PW); };
  X.isDescendant = (s, c, ofId) => { let p = c, n = 0; while (p && n++ < 64) { if (p.id === ofId) return true; p = X.parentOf(s, p); } return false; };
  X.uses3D = (s) => s.clips.some(c => c.tt === 'v' && (c.kind === 'camera' || (c.td && c.kind !== 'adjust')));

  /* ---- camera ---- */
  X.camera = (s, t) => {
    let c = null;
    for (let ti = s.vt.length - 1; ti >= 0 && !c; ti--) { if (s.vt[ti].hide) continue; const x = GW.clipAt(s, 'v', ti, t); if (x && x.kind === 'camera' && x.on !== 0) c = x; }
    if (!c) { const z = X.defaultZoom(s); const world = T(s.w / 2, s.h / 2, -z); return { clip: null, world, view: inv(world), zoom: z, dof: 0 }; }
    const lt = t - c.start, cm = c.cam || {};
    const world = X.world(s, c, t); const zoom = Math.max(1, pv(cm.zoom, lt, X.defaultZoom(s)));
    return { clip: c, world, view: inv(world), zoom, dof: cm.dof ? 1 : 0, focus: pv(cm.focus, lt, zoom), aperture: pv(cm.aperture, lt, 25.3), blur: pv(cm.blurLvl, lt, 100) };
  };
  X.NEAR = 2;
  // camera-space point → sequence px (+ depth)
  X.proj = (cam, s, p) => [s.w / 2 + cam.zoom * p[0] / p[2], s.h / 2 + cam.zoom * p[1] / p[2], p[2]];
  // A = view·world·(layer px→source px); returns clip-space matrix for the 'place3' vertex shader
  X.clipMatrix = (cam, s, A, r, outW, outH) => {
    const z = cam.zoom, P = new Float64Array(16);
    P[0] = 2 * r * z / outW; P[5] = -2 * r * z / outH;
    P[8] = r * s.w / outW - 1; P[9] = 1 - r * s.h / outH; P[10] = 1; P[11] = 1; P[14] = -2 * X.NEAR;
    return Float32Array.from(mul(P, A));
  };
  // projected quad of a layer rect; es = max screen px per source px along its edges
  X.screenQuad = (cam, s, A, w, h) => {
    const cs = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => apply(A, x, y, 0));
    const behind = cs.filter(p => p[2] <= X.NEAR).length;
    if (behind) return { behind, pts: null, es: 0 };
    const sp = cs.map(p => X.proj(cam, s, p)); const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    return { behind: 0, pts: sp, es: Math.max(d(sp[0], sp[1]) / w, d(sp[3], sp[2]) / w, d(sp[0], sp[3]) / h, d(sp[1], sp[2]) / h) };
  };
  // homography layer px → sequence px for a 3D layer (z = 0 plane)
  X.homography = (cam, s, A) => {
    const z = cam.zoom, cx = s.w / 2, cy = s.h / 2;
    return [z * A[0] + cx * A[2], z * A[1] + cy * A[2], A[2], z * A[4] + cx * A[6], z * A[5] + cy * A[6], A[6], z * A[12] + cx * A[14], z * A[13] + cy * A[14], A[14]]; // column-major mat3
  };
  X.inv3 = (m) => {
    const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C || 1e-12;
    return [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det];
  };
  // seq-px mapping of a layer (2D, parented or 3D): returns {fw(x,y)->[X,Y], inv(X,Y)->[x,y], td}
  X.layerMap = (s, c, t) => {
    if (X.is3D(c)) {
      const cam = X.camera(s, t); const A = mul(cam.view, X.world(s, c, t)); const H = X.homography(cam, s, A), Hi = X.inv3(H);
      const ap = (M, x, y) => { const w = M[2] * x + M[5] * y + M[8]; return [(M[0] * x + M[3] * y + M[6]) / w, (M[1] * x + M[4] * y + M[7]) / w]; };
      return { td: 1, cam, A, fw: (x, y) => ap(H, x, y), inv: (x, y) => ap(Hi, x, y) };
    }
    const M = X.world(s, c, t); const a = M[0], b = M[1], cc = M[4], d = M[5], tx = M[12], ty = M[13], det = a * d - b * cc || 1e-12;
    return { td: 0, fw: (x, y) => [a * x + cc * y + tx, b * x + d * y + ty], inv: (X0, Y0) => { const x = X0 - tx, y = Y0 - ty; return [(d * x - cc * y) / det, (-b * x + a * y) / det]; } };
  };
  // inverse jacobian of (layer position → screen position of its anchor) for dragging parented / 3D layers
  X.posDragInv = (s, c, t) => {
    const m = c.motion, lt = t - c.start, p0 = GW.clone(GW.pv(m.pos, lt));
    const at = (p) => { const keep = m.pos; m.pos = { v: p }; const L = X.layerMap(s, c, t); m.pos = keep; const an = GW.pv(m.anchor, lt); return L.fw(an[0], an[1]); };
    const o = at(p0), ex = at([p0[0] + 1, p0[1]]), ey = at([p0[0], p0[1] + 1]);
    const a = ex[0] - o[0], b = ex[1] - o[1], cc = ey[0] - o[0], d = ey[1] - o[1], det = a * d - b * cc;
    if (!isFinite(det) || Math.abs(det) < 1e-9) return (dx, dy) => [dx, dy];
    return (dx, dy) => [(d * dx - cc * dy) / det, (-b * dx + a * dy) / det];
  };

  /* ---- parenting (pick-whip): keeps the child's current look by rewriting its static transform values ---- */
  X.setParent = (c, pid, s) => {
    s = s || GW.seq(); const t = s.t;
    if (!c || !c.motion) return false;
    const p = pid ? s.clips.find(x => x.id === pid) : null;
    if (pid && (!p || p === c || !p.motion || X.isDescendant(s, p, c.id))) return false;
    const lt = t - c.start, m = c.motion;
    const W0 = X.world(s, c, t), PW0 = X.parentWorld(s, c, t);
    c.parent = pid || undefined; if (!pid) delete c.parent;
    const PW = X.parentWorld(s, c, t); const L = mul(inv(PW), W0);
    const an = c.kind === 'camera' ? [0, 0] : GW.pv(m.anchor, lt);
    const set = (k, v) => { if (m[k] && !GW.isAnim(m[k])) m[k].v = v; };
    const r2 = v => Math.round(v * 100) / 100;
    const p3 = apply(L, an[0], an[1], c.kind === 'camera' ? 0 : pv(m.anchorZ, lt, 0));
    set('pos', [r2(p3[0]), r2(p3[1])]);
    if (c.kind === 'camera' && c.cam && c.cam.poi && !GW.isAnim(c.cam.poi) && !GW.isAnim(c.cam.poiZ)) {
      const q = GW.pv(c.cam.poi, lt), qw = apply(PW0, q[0], q[1], pv(c.cam.poiZ, lt, 0)), ql = apply(inv(PW), qw[0], qw[1], qw[2]);
      c.cam.poi.v = [r2(ql[0]), r2(ql[1])]; if (c.cam.poiZ) c.cam.poiZ.v = r2(ql[2]);
    }
    if (X.is3D(c)) { set('posZ', r2(p3[2])); return true; }
    if (!GW.isAnim(m.rot) && !GW.isAnim(m.scale) && !GW.isAnim(m.scaleW)) {
      const sx = Math.hypot(L[0], L[1]), det = L[0] * L[5] - L[1] * L[4], sy = det / (sx || 1);
      if (sx > 1e-6) {
        m.rot.v = Math.round(Math.atan2(L[1], L[0]) / D2R * 100) / 100;
        const S1 = Math.round(sy * 10000) / 100, S2 = Math.round(sx * 10000) / 100;
        if (Math.abs(S1 - S2) < .01) m.scale.v = S1; else { m.uni = 0; m.scale.v = S1; m.scaleW = GW.P(S2); }
      }
    }
    return true;
  };
  GW.setParent = (c, pid) => X.setParent(c, pid);
})();
