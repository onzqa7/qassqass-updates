'use strict';
/* 3D scene operations: scene templates, light presets, camera moves, object add/duplicate/delete, model import
   (copied next to the project so it stays portable), character animation helpers. Used by the 3D panels
   (ui_3d.js) and the automation API (add3DScene / add3DObject / set3DScreenMedia …). */
(function () {
  const S = GW.S3D, P = GW.P, pv = GW.pv, clamp = GW.clamp;
  const O = S.ops = {};

  /* ---------- the active 3D clip / object ---------- */
  O.clip = (id) => {
    const s = GW.seq();
    if (id) { const c = GW.clipById(id); return c && c.kind === 'scene3d' ? c : null; }
    const sel = [...GW.sel.clips].map(i => GW.clipById(i)).find(c => c && c.kind === 'scene3d'); if (sel) return sel;
    if (S.sel.clip) { const c = GW.clipById(S.sel.clip); if (c && c.kind === 'scene3d' && s.clips.includes(c)) return c; }
    const cs = S.clipsIn(s); return cs.find(c => s.t >= c.start && s.t < c.start + c.dur) || cs[0] || null;
  };
  O.obj = (c, id) => c && c.s3d ? c.s3d.objs.find(o => o.id === (id || S.sel.obj)) || null : null;
  O.lt = (c) => clamp(GW.seq().t - c.start, 0, Math.max(0, c.dur - 1e-3));
  O.select = (c, oid) => { S.sel.clip = c ? c.id : null; S.sel.obj = oid || null; GW.bus.emit('s3d-sel'); S.viewDirty(); };
  const freeTrack = (s, t, dur) => { for (let i = 0; i < s.vt.length; i++) { if (s.vt[i].lock) continue; if (!s.clips.some(c => c.tt === 'v' && c.ti === i && c.start < t + dur && c.start + c.dur > t)) return i; } GW.ops.ensureTrack(s, 'v', s.vt.length + 1); return s.vt.length - 1; };

  /* ---------- light presets ---------- */
  const L = (t, o) => { const ob = S.newObj(t, o); ob.preset = 1; return ob; };
  S.LIGHT_PRESETS = [['news', 'استوديو أخبار'], ['sunset', 'غروب'], ['dark', 'غرفة مظلمة سينمائية'], ['day', 'نهار']];
  O.lightPreset = (d, key) => {
    d.objs = d.objs.filter(o => !o.preset); const add = (o) => d.objs.push(o);
    if (key === 'news') {
      Object.assign(d, { exposure: P(1), shadows: 1 }); d.env = { on: 1, int: P(.45) }; d.fog.on = 0; d.bg = { mode: 'color', color: '#04060b' };
      add(L('light:ambient', { name: 'محيطة', light: { int: P(.35), color: '#cfdcff' } }));
      add(L('light:area', { name: 'إضاءة رئيسية', pos: [-2.6, 2.6, 3.6], light: { int: P(9), color: '#fff4e6', w: 1.6, h: 1, target: P([0, 1.2, 1]) } }));
      add(L('light:area', { name: 'إضاءة تعبئة', pos: [2.8, 2.3, 3.4], light: { int: P(4), color: '#e6efff', w: 1.4, h: .9, target: P([0, 1.2, 1]) } }));
      add(L('light:spot', { name: 'إضاءة خلفية', pos: [0, 4, -2.5], light: { int: P(70), color: '#bcd4ff', angle: 30, pen: .6, shadow: 1, target: P([0, 1, 1.2]) } }));
    } else if (key === 'sunset') {
      Object.assign(d, { exposure: P(1.1), shadows: 1 }); d.env = { on: 1, int: P(.18) }; d.fog = { on: 1, color: '#3a2a2a', density: P(.012) }; d.bg = { mode: 'color', color: '#2a1d1c' };
      add(L('light:ambient', { name: 'سماء المساء', light: { int: P(.45), color: '#7c8fd0' } }));
      add(L('light:sun', { name: 'شمس الغروب', pos: [-9, 2.6, -1], light: { int: P(4.2), color: '#ff9447', shadow: 1, target: P([0, .5, 0]) } }));
      add(L('light:point', { name: 'ضوء دافئ', pos: [1.5, 2.2, 1.5], light: { int: P(3), color: '#ffb070', dist: 8, shadow: 0 } }));
    } else if (key === 'dark') {
      Object.assign(d, { exposure: P(1), shadows: 1 }); d.env = { on: 1, int: P(.06) }; d.fog = { on: 1, color: '#06070a', density: P(.045) }; d.bg = { mode: 'color', color: '#030305' };
      add(L('light:ambient', { name: 'محيطة خافتة', light: { int: P(.08), color: '#9fb0d0' } }));
      add(L('light:spot', { name: 'كشاف رئيسي', pos: [1.8, 3.4, 2.2], light: { int: P(110), color: '#ffd9a8', angle: 24, pen: .55, shadow: 1, target: P([0, .8, 0]) } }));
      add(L('light:spot', { name: 'ضوء حافة', pos: [-2.6, 2.4, -2.4], light: { int: P(40), color: '#7fa7ff', angle: 26, pen: .7, shadow: 0, target: P([0, 1, 0]) } }));
    } else { // day
      Object.assign(d, { exposure: P(1), shadows: 1 }); d.env = { on: 1, int: P(.4) }; d.fog.on = 0; d.bg = { mode: 'color', color: '#c9d6e3' };
      add(L('light:ambient', { name: 'سماء', light: { int: P(.45), color: '#dbe8ff' } }));
      add(L('light:sun', { name: 'الشمس', pos: [-9, 6.5, -.8], light: { int: P(3.6), color: '#fff3e0', shadow: 1, target: P([0, 0, 0]) } }));
    }
    return d;
  };

  /* ---------- scene templates ---------- */
  S.TEMPLATES = [
    ['living', 'غرفة معيشة مع تلفاز'], ['news', 'استوديو أخبار'], ['doc', 'استوديو وثائقي مظلم'], ['office', 'مكتب'], ['warroom', 'غرفة عمليات بطاولة خرائط'], ['studio', 'استوديو سايكلوراما'], ['empty', 'مشهد فارغ']
  ];
  const ob = (t, pos, o = {}) => S.newObj(t, Object.assign({ pos }, o));
  O.template = (key) => {
    const d = S.newScene(); const add = (o) => { d.objs.push(o); return o; };
    if (key === 'living') {
      add(ob('room_basic', [0, 0, 0])); add(ob('carpet', [0, 0, .2])); add(ob('tv_stand', [0, 0, -2.6])); add(ob('sofa', [0, 0, 1.6], { rot: [0, 180, 0] }));
      add(ob('lamp', [2.6, 0, 1.9])); add(ob('plant', [-2.9, 0, -2.4])); add(ob('frame', [2.2, 1.65, -2.93])); add(ob('clock', [-1.8, 2.1, -2.93]));
      d.cam = { pos: P([0.6, 1.45, 4.1]), target: P([0, 1, -2.4]), fov: P(42), roll: P(0) }; O.lightPreset(d, 'day');
    } else if (key === 'news') {
      add(ob('news_set', [0, 0, 0])); d.cam = { pos: P([0, 1.55, 6.2]), target: P([0, 1.45, -1]), fov: P(38), roll: P(0) }; O.lightPreset(d, 'news');
    } else if (key === 'doc') {
      add(ob('doc_dark', [0, 0, 0])); add(ob('table', [0, 0, -.5])); add(ob('chair', [0, 0, .25], { rot: [0, 180, 0] })); add(ob('books', [-.5, .75, -.6])); add(ob('globe', [.55, .75, -.7], { scl: [.8, .8, .8] }));
      d.cam = { pos: P([1.6, 1.55, 3.4]), target: P([0, .9, -.5]), fov: P(38), roll: P(0) }; O.lightPreset(d, 'dark');
    } else if (key === 'office') {
      add(ob('office', [0, 0, 0])); add(ob('desk', [0, 0, -2])); add(ob('chair', [0, 0, -1.3], { rot: [0, 180, 0] })); add(ob('monitor', [0, .75, -2.15])); add(ob('plant', [-3.6, 0, -2.9])); add(ob('cabinet', [2.4, 0, -3.1]));
      d.cam = { pos: P([1.4, 1.6, 2.4]), target: P([0, 1, -2]), fov: P(42), roll: P(0) }; O.lightPreset(d, 'day');
    } else if (key === 'warroom') {
      add(ob('war_room', [0, 0, 0])); d.cam = { pos: P([0, 2.5, 4.2]), target: P([0, .8, .2]), fov: P(42), roll: P(0) }; O.lightPreset(d, 'dark'); d.fog.density = P(.02);
      d.objs.find(o => o.name === 'محيطة خافتة').light.int = P(.25);
    } else if (key === 'studio') {
      add(ob('studio_cyc', [0, 0, 0])); add(ob('prim:sphere', [-.9, 0, 0])); add(ob('prim:cube', [.8, 0, -.4], { rot: [0, 25, 0] }));
      d.cam = { pos: P([0, 1.5, 6]), target: P([0, .7, 0]), fov: P(35), roll: P(0) }; O.lightPreset(d, 'news'); d.bg = { mode: 'color', color: '#d6d8dc' };
    } else { O.lightPreset(d, 'news'); add(ob('prim:cube', [0, 0, 0])); d.cam = { pos: P([2.5, 2, 4.5]), target: P([0, .5, 0]), fov: P(40), roll: P(0) }; }
    return d;
  };
  O.addScene = (key = 'living', o = {}) => {
    const s = GW.seq(); const dur = o.dur || 8; const start = o.start != null ? o.start : s.t; const ti = o.ti != null ? o.ti : freeTrack(s, start, dur);
    const c = GW.newClip('scene3d', { ti, start, dur, name: o.name || (S.TEMPLATES.find(x => x[0] === key) || [0, 'مشهد ثلاثي الأبعاد'])[1] });
    c.s3d = O.template(key); if (o.transparent) c.s3d.bg = { mode: 'transparent', color: c.s3d.bg.color };
    s.clips.push(c); GW.sel.clips.clear(); GW.sel.clips.add(c.id); O.select(c, null);
    GW.commit('مشهد ثلاثي الأبعاد جديد'); GW.bus.emit('selection'); return c;
  };
  O.ensureClip = () => O.clip() || O.addScene('empty');

  /* ---------- objects ---------- */
  O.addObj = (c, t, o = {}) => {
    if (t === 'model' && !o.name) { const rec = S.modelRec(o.ref); if (rec) o = Object.assign({}, o, { name: rec.name }); }
    const x = S.newObj(t, o); if (o.p) x.p = o.p; c.s3d.objs.push(x);
    if (t === 'model') { const me = S.loadModel(o.ref); const fin = () => O.autoAnim(c, x); if (me.status === 'ok') fin(); else if (me.p) me.p.then(() => { if (!x.anim) { fin(); GW.commit('حركات النموذج'); GW.bus.emit('s3d-sel'); } }); }
    O.select(c, x.id); GW.commit('إضافة عنصر ثلاثي الأبعاد'); GW.invalidate(); return x;
  };
  O.autoAnim = (c, x) => { const me = S.models.get(x.model.ref); if (!me || me.status !== 'ok' || !me.clips.length || x.anim) return; const idle = me.clips.find(k => /idle|stand|breath/i.test(k.name)) || me.clips[0]; x.anim = { inPlace: 1, strips: [{ id: GW.uid(), clip: idle.name, start: 0, dur: c.dur, speed: 1, loop: 1, fade: .3, off: 0 }] }; };
  O.dupObj = (c, o) => { const x = GW.clone(o); x.id = GW.uid(); x.name = o.name + ' ٢'; const p = pv(x.pos, 0); if (!GW.isAnim(x.pos)) x.pos = P([p[0] + .5, p[1], p[2] + .5]); c.s3d.objs.push(x); O.select(c, x.id); GW.commit('تكرار عنصر'); return x; };
  O.delObj = (c, o) => { c.s3d.objs = c.s3d.objs.filter(x => x !== o); if (S.sel.obj === o.id) S.sel.obj = null; GW.commit('حذف عنصر'); GW.bus.emit('s3d-sel'); GW.invalidate(); };
  O.setVec = (c, p, v, label) => { GW.setPv(p, O.lt(c), v); GW.invalidate(); S.viewDirty(); if (label) GW.commitSoon(label); };

  /* ---------- screens ---------- */
  O.setScreen = (c, o, src = {}) => {
    if (!o.screen) o.screen = { media: null, seq: null, in: 0, speed: 1, loop: 1, fit: 'cover', bright: 1 };
    if (src.media !== undefined) { o.screen.media = src.media; if (src.media) o.screen.seq = null; }
    if (src.seq !== undefined) { o.screen.seq = src.seq; if (src.seq) o.screen.media = null; }
    for (const k of ['in', 'speed', 'loop', 'fit', 'bright']) if (src[k] !== undefined) o.screen[k] = src[k];
    GW.commit('محتوى الشاشة'); GW.invalidate(); S.viewDirty(); return o.screen;
  };
  // world rectangle of an object's (first) screen: centre, normal, width, height
  O.screenRect = (c, o) => {
    const T = S.T; const rt = S.apply(c, O.lt(c), {}); const e = rt.nodes.get(o.id); if (!e) return null;
    const scr = e.node.userData.screens; if (!scr || !scr.length) return null;
    const box = new T.Box3(); let nrm = null; const ctr = new T.Vector3();
    for (const m of scr) { m.updateMatrixWorld(true); m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld); box.union(bb); if (!nrm) nrm = new T.Vector3(0, 0, 1).transformDirection(m.matrixWorld); }
    box.getCenter(ctr); const m0 = scr[0]; const q = m0.getWorldQuaternion(new T.Quaternion()); const ex = new T.Vector3(1, 0, 0).applyQuaternion(q), ey = new T.Vector3(0, 1, 0).applyQuaternion(q);
    const sz = box.getSize(new T.Vector3()); const w = Math.abs(sz.dot(ex)) || sz.length() * .8, h = Math.abs(sz.dot(ey)) || w * 9 / 16;
    return { c: ctr.toArray(), n: nrm.toArray(), w, h };
  };

  /* ---------- camera moves (keyframes on cam.pos / cam.target / cam.fov) ---------- */
  S.CAM_PRESETS = [['dolly', 'دخول (Dolly In)'], ['dollyout', 'خروج (Dolly Out)'], ['orbit', 'دوران حول الهدف'], ['push', 'اقتراب إلى الشاشة'], ['crane', 'رافعة (Crane)'], ['truck', 'انزلاق جانبي']];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], len = a => Math.hypot(a[0], a[1], a[2]);
  O.camPreset = (c, key, o = {}) => {
    const d = c.s3d, cam = d.cam; const t0 = o.start != null ? o.start : 0, t1 = Math.min(c.dur, t0 + (o.dur || Math.max(1, c.dur - t0)));
    const p0 = pv(cam.pos, t0), g0 = pv(cam.target, t0), fov = pv(cam.fov, t0); const v = sub(p0, g0); const D = len(v) || 1;
    const set = (p, keys) => { p.k = keys.map(([t, v2, e]) => ({ t: Math.round(t * 1000) / 1000, v: v2, e: e || 'ease' })); p.v = keys[0][1]; };
    if (key === 'dolly' || key === 'dollyout') { const k = key === 'dolly' ? .62 : 1.45; set(cam.pos, [[t0, p0], [t1, addv(g0, mul(v, k))]]); set(cam.target, [[t0, g0], [t1, g0]]); }
    else if (key === 'orbit') { const ang = (o.angle || 40) * Math.PI / 180, n = 6, a0 = Math.atan2(v[0], v[2]), r = Math.hypot(v[0], v[2]); const ks = []; for (let i = 0; i <= n; i++) { const aa = a0 + ang * (i / n); ks.push([t0 + (t1 - t0) * i / n, [g0[0] + Math.sin(aa) * r, p0[1], g0[2] + Math.cos(aa) * r], i === 0 ? 'easeOut' : i === n ? 'easeIn' : 'linear']); } set(cam.pos, ks); set(cam.target, [[t0, g0], [t1, g0]]); }
    else if (key === 'crane') { set(cam.pos, [[t0, p0], [t1, addv(p0, [0, o.height || 1.6, 0])]]); set(cam.target, [[t0, g0], [t1, addv(g0, [0, -.2, 0])]]); }
    else if (key === 'truck') { const side = [v[2] / D, 0, -v[0] / D]; set(cam.pos, [[t0, p0], [t1, addv(p0, mul(side, o.dist || 1.5))]]); set(cam.target, [[t0, g0], [t1, addv(g0, mul(side, o.dist || 1.5))]]); }
    else if (key === 'push') { // zoom into a screen until it fills the frame (transition-friendly)
      const so = (o.obj && O.obj(c, o.obj)) || O.obj(c) || d.objs.find(x => x.screen); if (!so) return false; const R = O.screenRect(c, so); if (!R) return false;
      const s = GW.seq(); const asp = (c.sw || s.w) / (c.sh || s.h); const f = fov * Math.PI / 180; const fill = o.fill || 1.0;
      const dist = Math.max(R.h / 2 / Math.tan(f / 2), R.w / asp / 2 / Math.tan(f / 2)) / fill;
      const endP = addv(R.c, mul(R.n, dist)); set(cam.pos, [[t0, p0, 'easeOut'], [t1, endP, 'ease']]); set(cam.target, [[t0, g0, 'easeOut'], [t1, R.c, 'ease']]);
    } else return false;
    GW.commit('حركة كاميرا: ' + ((S.CAM_PRESETS.find(x => x[0] === key) || [0, key])[1])); GW.invalidate(); S.viewDirty(); return true;
  };

  /* ---------- smoothing helpers ---------- */
  const paramsOf = (o) => { const out = []; const visit = (x) => { if (!x || typeof x !== 'object') return; if ('v' in x && Object.keys(x).every(k => k === 'v' || k === 'k')) { out.push(x); return; } for (const k in x) if (k[0] !== '_') visit(x[k]); }; visit(o); return out; };
  O.paramsOf = paramsOf;
  O.easeAll = (target, e) => { for (const p of paramsOf(target)) if (p.k) for (const k of p.k) { k.e = e; delete k.bo; delete k.bi; } GW.commit('تخفيف المفاتيح'); GW.invalidate(); };
  O.smooth = (target) => { // «تنعيم الحركة»: 3-tap filter on inner keys + eased keys (removes jitter from hand-set keys)
    for (const p of paramsOf(target)) { if (!p.k || p.k.length < 3) { if (p.k) p.k.forEach(k => { k.e = 'ease'; }); continue; } const v = p.k.map(k => k.v);
      for (let i = 1; i < p.k.length - 1; i++) { const a = v[i - 1], b = v[i], c2 = v[i + 1]; p.k[i].v = Array.isArray(b) ? b.map((x, j) => .25 * a[j] + .5 * x + .25 * c2[j]) : (typeof b === 'number' ? .25 * a + .5 * b + .25 * c2 : b); }
      p.k.forEach((k, i) => { k.e = i === 0 || i === p.k.length - 1 ? 'ease' : 'linear'; }); }
    GW.commit('تنعيم الحركة'); GW.invalidate(); S.viewDirty();
  };

  /* ---------- model import (glb / gltf / obj+mtl / fbx / stl / ply) ---------- */
  S.MODEL_EXT = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'];
  S.isModel = (name) => S.MODEL_EXT.includes(String(name || '').split('.').pop().toLowerCase());
  const extOf = (p) => String(p).split('.').pop().toLowerCase();
  const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, ''); const baseOf = (p) => p.split(/[\\/]/).pop();
  async function sidecars(path, ext) { // files a model needs from its folder (relative references only)
    const out = new Set(); const sp = path.includes('\\') ? '\\' : '/'; const dir = dirOf(path);
    const rel = (u) => { if (!u || /^(data:|blob:|https?:)/i.test(u)) return; out.add(decodeURIComponent(u).replace(/^\.\//, '').replace(/\\/g, '/')); };
    try {
      if (ext === 'gltf') { const j = JSON.parse(await gws.readText(path)); for (const b of j.buffers || []) rel(b.uri); for (const im of j.images || []) rel(im.uri); }
      if (ext === 'obj') { const txt = await gws.readText(path); const m = /^\s*mtllib\s+(.+)$/m.exec(txt); if (m) { const mtl = m[1].trim(); rel(mtl); const mt = await gws.readText(dir + sp + mtl).catch(() => ''); for (const l of mt.split(/\r?\n/)) { const mm = /^\s*(map_\w+|bump|disp|norm)\s+(?:-\S+\s+\S+\s+)*(.+)$/i.exec(l); if (mm) rel(mm[2].trim()); } } }
    } catch (e) { console.warn('model sidecars', e); }
    return [...out].filter(f => !/^([a-z]:)?\//i.test(f));
  }
  O.modelDir = async () => {
    const p = await gws.paths(); const sp = p.sep || '/';
    return GW.prj.path ? dirOf(GW.prj.path) + sp + 'نماذج ثلاثية الأبعاد' : p.docs + sp + 'قص قص' + sp + 'نماذج ثلاثية الأبعاد';
  };
  O.importModels = async (files, o = {}) => { // files: [{path, name} | {file}] → model records
    const recs = []; GW.prj.models3d = GW.prj.models3d || [];
    for (const f of files) {
      const name = f.name || baseOf(f.path || ''); const ext = extOf(name); if (!S.MODEL_EXT.includes(ext)) continue;
      let path = f.path || null, blob = null;
      if (!path && f.file) blob = URL.createObjectURL(f.file);
      const have = GW.prj.models3d.find(m => m.src === path || m.path === path); if (have && path) { recs.push(have); continue; }
      let dst = path;
      if (path && window.gws && gws.copyFile && o.copy !== false) { // copy into the project's model folder (portable projects)
        try {
          const sp = path.includes('\\') ? '\\' : '/'; const md = await O.modelDir(); const sub = md + sp + name.replace(/\.[^.]+$/, '') + '_' + GW.hash(path).toString(36).slice(0, 5);
          const target = sub + sp + name; if (!(await gws.exists(target))) { if (!(await gws.copyFile(path, target))) throw new Error('copy failed'); for (const rel of await sidecars(path, ext)) await gws.copyFile(dirOf(path) + sp + rel.split('/').join(sp), sub + sp + rel.split('/').join(sp)).catch(() => false); }
          dst = target;
        } catch (e) { console.warn('model copy', e); dst = path; }
      }
      const rec = { id: GW.uid(), name: name.replace(/\.[^.]+$/, ''), path: dst, src: path, ext, added: Date.now() }; if (blob) Object.defineProperty(rec, 'blob', { value: blob, enumerable: false });
      GW.prj.models3d.push(rec); recs.push(rec); O.remember(rec);
    }
    if (recs.length) { GW.commit('استيراد نموذج ثلاثي الأبعاد'); GW.bus.emit('s3d-models'); await Promise.all(recs.map(r => S.loadModel(r.id).p)); GW.bus.emit('s3d-models'); }
    return recs;
  };
  O.remember = (rec) => { try { const k = 'gws.s3d.models'; const L2 = JSON.parse(localStorage.getItem(k) || '[]').filter(x => x.path !== rec.path); L2.unshift({ name: rec.name, path: rec.path, ext: rec.ext }); localStorage.setItem(k, JSON.stringify(L2.slice(0, 40))); } catch (e) {} };
  O.remembered = () => { try { return JSON.parse(localStorage.getItem('gws.s3d.models') || '[]'); } catch (e) { return []; } };
  O.modelFromRemembered = async (r) => { GW.prj.models3d = GW.prj.models3d || []; let rec = GW.prj.models3d.find(m => m.path === r.path); if (!rec) { rec = { id: GW.uid(), name: r.name, path: r.path, ext: r.ext, added: Date.now() }; GW.prj.models3d.push(rec); GW.commit('نموذج من «نماذجي»'); } await S.loadModel(rec.id).p; return rec; };
  O.importDialog = async () => {
    if (window.gws && gws.open) { const files = await gws.open({ filter: 'model3d', multi: true, title: 'استيراد نموذج ثلاثي الأبعاد' }); if (files && files.length) return O.importAndPlace(files.map(p => (typeof p === 'string' ? { path: p } : p))); return []; }
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = S.MODEL_EXT.map(e => '.' + e).join(','); inp.onchange = () => O.importAndPlace([...inp.files].map(f => ({ file: f, name: f.name }))); inp.click(); return [];
  };
  O.importAndPlace = async (files, at) => {
    const recs = await O.importModels(files); if (!recs.length) return [];
    const c = O.ensureClip(); let x = 0; for (const r of recs) { const me = S.models.get(r.id); if (me && me.status === 'err') { GW.toast('تعذر تحميل النموذج: ' + r.name + ' (' + me.err + ')', 'err'); continue; } O.addObj(c, 'model', { ref: r.id, name: r.name, pos: at ? [at[0] + x, at[1], at[2]] : [x, 0, 0] }); x += 1.2; }
    GW.toast('تم استيراد ' + recs.length + ' نموذج'); return recs;
  };
  // project panel / global drop / media import: route model files here instead of the video importer
  const imp0 = GW.Media.importFiles;
  GW.Media.importFiles = async (files) => {
    const mdl = files.filter(f => S.isModel(f.name || f.path)); const rest = files.filter(f => !S.isModel(f.name || f.path));
    if (mdl.length) O.importAndPlace(mdl.map(f => ({ path: f.path, name: f.name, file: f.file })));
    return rest.length ? imp0(rest) : [];
  };

  /* ---------- portable projects: models live in «نماذج ثلاثية الأبعاد» next to the saved project ---------- */
  O.relocateModels = async () => {
    const P0 = GW.prj.path; if (!P0 || !window.gws || !gws.copyFile) return false; const sp = P0.includes('\\') ? '\\' : '/'; const pd = dirOf(P0); let changed = false;
    for (const rec of GW.prj.models3d || []) {
      if (!rec.path) continue;
      if (rec.path.startsWith(pd + sp)) { const rel = rec.path.slice(pd.length + 1); if (rec.rel !== rel) { rec.rel = rel; changed = true; } continue; }
      try {
        const name = baseOf(rec.path); const sub = 'نماذج ثلاثية الأبعاد' + sp + name.replace(/\.[^.]+$/, '') + '_' + GW.hash(rec.src || rec.path).toString(36).slice(0, 5);
        const dst = pd + sp + sub + sp + name;
        if (!(await gws.exists(dst))) { if (!(await gws.copyFile(rec.path, dst))) continue; for (const rel of await sidecars(rec.path, rec.ext)) await gws.copyFile(dirOf(rec.path) + sp + rel.split('/').join(sp), pd + sp + sub + sp + rel.split('/').join(sp)).catch(() => false); }
        rec.path = dst; rec.rel = sub + sp + name; changed = true;
      } catch (e) { console.warn('relocate model', e); }
    }
    return changed;
  };
  // a moved project finds its models through the stored relative path
  S.resolveModelPath = async (rec) => { if (!window.gws || !gws.exists || !rec.path || rec.blob) return; try { if (await gws.exists(rec.path)) return; if (rec.rel && GW.prj.path) { const sp = GW.prj.path.includes('\\') ? '\\' : '/'; const alt = dirOf(GW.prj.path) + sp + rec.rel.split(/[\\/]/).join(sp); if (await gws.exists(alt)) rec.path = alt; } } catch (e) {} };

  /* ---------- walking path ---------- */
  O.setWalk = (c, o, w) => { o.walk = Object.assign(o.walk || { on: 1, pts: [], start: 0, speed: 1.4, ease: .6, stride: 1.4 }, w); const me = S.models.get(o.model && o.model.ref); if (me && me.clips && me.clips.length) { const walk = me.clips.find(k => /walk/i.test(k.name)) || me.clips.find(k => /run|jog/i.test(k.name)); const idle = me.clips.find(k => /idle|stand/i.test(k.name)); if (!o.walk.clip && walk) o.walk.clip = walk.name; if (!o.walk.idle && idle) o.walk.idle = idle.name; } GW.commit('مسار المشي'); GW.invalidate(); S.viewDirty(); return o.walk; };
})();
