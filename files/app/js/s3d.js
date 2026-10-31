'use strict';
/* «مشهد ثلاثي الأبعاد» — clip kind 'scene3d'. The clip holds a JSON scene description (c.s3d); a shared offscreen
   three.js renderer (js/three_boot.js → window.THREE) draws it at the layer size for a given clip-local time and the
   compositor uploads the canvas like text/shape layers (render.js). Everything is a pure function of time:
   keyframes are GW.P params (Effect Controls / graph editor work), screens show project media / sequences synced to
   clip time, imported characters are posed by an AnimationMixer that is *set* to a time (never ticked by a clock).

   Scene description (all numeric props are GW.P params, keyframes on clip-local time):
   { ver:1, bg:{mode:'color'|'transparent'|'env', color}, env:{on, int}, fog:{on, color, density}, exposure,
     bloom:{on, strength, radius, threshold}, dof:{on, focus, aperture}, shadows,
     cam:{pos:[x,y,z], target:[x,y,z], fov, roll}, objs:[obj…] }
   obj: { id, t:'<library id>'|'prim:cube'|'light:spot'|'model'|'text', name, hide, lock, pos, rot (deg), scl,
          mat:{color, rough, metal, tex:mediaId}, screen:{media|seq, in, speed, loop, fit, bright},
          light:{color, int, dist, angle, pen, shadow, w, h, target}, model:{ref}, anim:{strips:[…], inPlace},
          walk:{on, pts:[[x,z]…], start, speed, ease, clip, idle, stride}, look:{on, target, amount}, pose:{bone:[rx,ry,rz]},
          text:{str, font, weight, color, side, depth, size} } */
(function () {
  const P = GW.P, pv = GW.pv, clamp = GW.clamp;
  const S = GW.S3D = { T: null, rts: new Map(), models: new Map(), sel: { clip: null, obj: null }, ver: 0 };
  let readyRes; S.ready = new Promise(r => { readyRes = r; });
  S._threeLoaded = (T) => { if (S.T) return; S.T = T; readyRes(T); GW.invalidate && GW.invalidate(); GW.bus && GW.bus.emit('s3d-ready'); };
  if (window.__threeReady) S._threeLoaded(window.__threeReady);
  GW.KIND_NAME.scene3d = 'مشهد ثلاثي الأبعاد'; GW.LABELS.scene3d = '#4f9fd8';
  const D2R = Math.PI / 180;
  const v3 = (p, t, d) => { const v = pv(p, t); return Array.isArray(v) ? v : (d || [0, 0, 0]); };
  const num = (p, t, d) => { const v = pv(p, t); return typeof v === 'number' && isFinite(v) ? v : d; };

  /* ---------------- description factories ---------------- */
  S.newScene = (o = {}) => ({
    ver: 1, bg: { mode: o.transparent ? 'transparent' : 'color', color: o.bg || '#0c0e13' }, env: { on: 1, int: P(o.envInt ?? .35) },
    fog: { on: 0, color: '#0c0e13', density: P(.03) }, exposure: P(1), bloom: { on: 0, strength: P(.5), radius: .4, threshold: .85 },
    dof: { on: 0, focus: P(5), aperture: P(1.5) }, shadows: 1,
    cam: { pos: P([0, 1.6, 6.2]), target: P([0, 1.1, 0]), fov: P(40), roll: P(0) }, objs: []
  });
  S.newObj = (t, o = {}) => {
    const L = S.LIB && S.LIB[t]; const d = (L && L.def) || {};
    const ob = { id: GW.uid(), t, name: o.name || (L ? L.n : t), pos: P(o.pos || d.pos || [0, 0, 0]), rot: P(o.rot || d.rot || [0, 0, 0]), scl: P(o.scl || d.scl || [1, 1, 1]) };
    if (L && L.screens) ob.screen = { media: null, seq: null, in: 0, speed: 1, loop: 1, fit: 'cover', bright: 1 };
    if (L && L.light) ob.light = Object.assign({ color: '#ffffff', shadow: 1 }, GW.clone(L.light), { int: P(L.light.int != null ? L.light.int : 1) }, L.light.target ? { target: P(L.light.target) } : {});
    if (L && L.mat) ob.mat = GW.clone(L.mat);
    if (t === 'text') ob.text = Object.assign({ str: 'نص ثلاثي الأبعاد', font: 'Cairo', weight: 800, color: '#ffffff', side: '#9a6a2a', depth: .08, size: .5 }, o.text || {});
    if (t === 'model') ob.model = { ref: o.ref };
    if (o.light) Object.assign(ob.light, o.light);
    return ob;
  };

  /* ---------------- renderer ---------------- */
  let REN = null;
  S.renderer = () => {
    if (REN) return REN; const T = S.T; if (!T) return null;
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
    const r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1); r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); console.warn('s3d context lost'); });
    cv.addEventListener('webglcontextrestored', () => { ENV = null; for (const rt of S.rts.values()) rt.envTex = null; GW.invalidate(); });
    REN = r; return r;
  };
  let ENV = null;
  S.envTex = () => {
    if (ENV) return ENV; const T = S.T, r = S.renderer(); const pm = new T.PMREMGenerator(r);
    const room = new T.X.RoomEnvironment(); ENV = pm.fromScene(room, .04).texture; pm.dispose();
    room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return ENV;
  };

  /* ---------------- media textures (screens / material maps) ---------------- */
  const imgCache = new Map(); // media id → {img, tex, status}
  function imageTex(mid) {
    const m = GW.media(mid); if (!m) return null; let e = imgCache.get(mid);
    if (e && e.url !== GW.Media.url(m, true)) { if (e.tex) e.tex.dispose(); e = null; }
    if (!e) {
      const T = S.T; const img = new Image(); img.crossOrigin = 'anonymous'; const url = GW.Media.url(m, true);
      e = { img, url, tex: new T.Texture(img), status: 'load' }; e.tex.colorSpace = T.SRGBColorSpace; e.tex.anisotropy = 4;
      e.p = new Promise(res => { img.onload = () => { e.status = 'ok'; e.tex.needsUpdate = true; GW.invalidate(); S.viewDirty(); res(); }; img.onerror = () => { e.status = 'err'; res(); }; });
      img.src = url; imgCache.set(mid, e);
    }
    return e;
  }
  S.imageTex = imageTex;
  const pseudo = (c, o, k) => ({ id: 's3d:' + c.id + ':' + o.id + (k || ''), media: o.screen.media, in: 0, start: 0, speed: 1 });
  function screenSrcTime(o, m, lt) {
    const sc = o.screen; let st = (sc.in || 0) + Math.max(0, lt) * (sc.speed || 1);
    const d = m.dur || 0; if (d > 0) { const fd = 1 / (m.fps || 30); st = sc.loop !== 0 ? st % Math.max(fd, d - fd * .5) : clamp(st, 0, d - fd * .5); }
    return st;
  }
  const seqCv = new Map();
  function seqFrame(c, o, lt, w) { // another sequence rendered on the main compositor → canvas texture
    const sub = GW.prj.seqs.find(x => x.id === o.screen.seq); if (!sub || sub === GW.seq() && GW.seq().clips.includes(c)) return null;
    const RN = GW.Render, R = GW.R; if (!RN || !R || !R.gl) return null;
    const k = Math.min(1, Math.max(64, w) / sub.w); const st = (o.screen.in || 0) + Math.max(0, lt) * (o.screen.speed || 1);
    let acc; try { acc = RN.frame(sub, st, { scale: k, exporting: RN.exporting, depth: 2 }); } catch (e) { console.warn('s3d seq', e); return null; }
    const buf = R.readRGBA(acc.w, acc.h, acc, null, false); const W = acc.w, H = acc.h; R.free(acc);
    const key = c.id + ':' + o.id; let e = seqCv.get(key); const T = S.T;
    if (!e || e.cv.width !== W || e.cv.height !== H) { if (e) e.tex.dispose(); const cv = document.createElement('canvas'); cv.width = W; cv.height = H; e = { cv, tex: new T.CanvasTexture(cv) }; e.tex.colorSpace = T.SRGBColorSpace; seqCv.set(key, e); }
    e.cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), W, H), 0, 0); e.tex.needsUpdate = true;
    return { tex: e.tex, w: W, h: H };
  }
  const vidTex = new Map();
  // texture for a screen object at clip-local time lt (video kept in sync like render.js does for timeline clips)
  function screenSource(c, o, lt, ctx) {
    const sc = o.screen; if (!sc) return null;
    if (sc.seq) return seqFrame(c, o, lt, ctx.w);
    const m = sc.media && GW.media(sc.media); if (!m || m.offline) return null;
    if (m.kind === 'image') { const e = imageTex(m.id); return e && e.status === 'ok' ? { tex: e.tex, w: e.img.naturalWidth, h: e.img.naturalHeight } : null; }
    if (m.kind !== 'video') return null;
    const pc = pseudo(c, o); const el = GW.Media.vid(pc); if (!el) return null;
    const st = screenSrcTime(o, m, lt); const fd = 1 / (m.fps || 30);
    if (!ctx.exporting) {
      const RN = GW.Render;
      if (RN && RN.playing && !ctx.live) { /* viewport during playback: show whatever the program monitor keeps playing */ }
      else if (RN && RN.playing && ctx.live) { el.playbackRate = clamp(sc.speed || 1, .0625, 16); if (el.paused) { if (Math.abs(el.currentTime - st) > .05) el.currentTime = st; el.play().catch(() => {}); } else if (Math.abs(el.currentTime - st) > .3) el.currentTime = st; }
      else { if (!el.paused) el.pause(); if (!el.seeking && Math.abs(el.currentTime - st) > fd * .5) el.currentTime = st; }
    }
    if (el.readyState < 2) { if (!ctx.exporting) setTimeout(() => { GW.invalidate(); S.viewDirty(); }, 150); return null; }
    if (el.width !== el.videoWidth) { el.width = el.videoWidth; el.height = el.videoHeight; } // three sizes uploads by the element's width/height attributes
    let e = vidTex.get(pc.id); const T = S.T;
    if (!e || e.el !== el) { if (e) e.tex.dispose(); e = { el, tex: new T.Texture(el) }; e.tex.colorSpace = T.SRGBColorSpace; e.tex.minFilter = T.LinearFilter; e.tex.generateMipmaps = false; vidTex.set(pc.id, e); }
    e.tex.needsUpdate = true; ctx.vt.push(el.currentTime);
    return { tex: e.tex, w: m.w || el.videoWidth, h: m.h || el.videoHeight };
  }

  /* ---------------- imported models ---------------- */
  const sep = () => (GW.Media.cachePaths && S._sep) || (navigator.platform && /win/i.test(navigator.platform) ? '\\' : '/');
  const urlFor = (p) => window.gws && gws.mediaUrl ? gws.mediaUrl(p) : p;
  S.modelRec = (ref) => (GW.prj.models3d || []).find(m => m.id === ref) || null;
  function manager(rec) {
    const T = S.T; const mg = new T.LoadingManager(); const dir = rec.path.replace(/[\\/][^\\/]*$/, ''); const sp = rec.path.includes('\\') ? '\\' : '/';
    mg.setURLModifier(u => {
      if (/^(blob:|data:|https?:|app:|file:)/i.test(u)) return u;
      let n = decodeURIComponent(u).replace(/^\.\//, '').replace(/\\/g, '/');
      if (/^([a-z]:)?\//i.test(n)) n = n.split('/').pop(); // absolute path from the author's machine → same folder
      return urlFor(dir + sp + n.split('/').join(sp));
    });
    return mg;
  }
  S.loadModel = (ref) => {
    let e = S.models.get(ref); if (e) return e;
    const rec = S.modelRec(ref); e = { status: 'load', obj: null, clips: [], err: null }; S.models.set(ref, e);
    if (!rec) { e.status = 'err'; e.err = 'missing'; e.p = Promise.resolve(e); return e; }
    e.p = (async () => {
      await S.ready; if (S.resolveModelPath) await S.resolveModelPath(rec); const T = S.T, X = T.X; const ext = (rec.ext || rec.path.split('.').pop()).toLowerCase(); const mg = manager(rec);
      const url = rec.blob || urlFor(rec.path);
      const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status);
      let root, clips = [];
      if (ext === 'glb' || ext === 'gltf') { const L = new X.GLTFLoader(mg); const data = ext === 'glb' ? await res.arrayBuffer() : await res.text(); const g = await new Promise((ok, no) => L.parse(data, '', ok, no)); root = g.scene || g.scenes[0]; clips = g.animations || []; }
      else if (ext === 'fbx') { const L = new X.FBXLoader(mg); root = L.parse(await res.arrayBuffer(), ''); clips = root.animations || []; }
      else if (ext === 'obj') {
        const txt = await res.text(); const L = new X.OBJLoader(mg); const mm = /^\s*mtllib\s+(.+)$/m.exec(txt);
        if (mm) { try { const ml = new X.MTLLoader(mg); const mres = await fetch(mg.resolveURL(mm[1].trim())); if (mres.ok) { const mats = ml.parse(await mres.text(), ''); mats.preload(); L.setMaterials(mats); } } catch (er) { console.warn('mtl', er); } }
        root = L.parse(txt);
      } else if (ext === 'stl' || ext === 'ply') {
        const geo = (ext === 'stl' ? new X.STLLoader(mg) : new X.PLYLoader(mg)).parse(await res.arrayBuffer()); geo.computeVertexNormals();
        root = new T.Mesh(geo, new T.MeshStandardMaterial({ color: geo.hasAttribute('color') ? 0xffffff : 0xb9bec7, vertexColors: geo.hasAttribute('color'), roughness: .55, metalness: .1 }));
        if (ext === 'stl') root.rotation.x = -Math.PI / 2; // STL is Z-up
      } else throw new Error('unsupported ' + ext);
      // fit: centre on the floor at a sensible size (characters ≈ 1.75 m, odd unit scales → 1 m)
      root.updateMatrixWorld(true); const box = new T.Box3().setFromObject(root); const sz = box.getSize(new T.Vector3());
      let skinned = false; root.traverse(o => { if (o.isSkinnedMesh) skinned = true; if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m && m.map) m.map.anisotropy = 4; if (m && m.isMeshPhongMaterial && m.shininess > 60) m.shininess = 60; } } });
      const mx = Math.max(sz.x, sz.y, sz.z) || 1; let s = 1;
      if (skinned && (sz.y < 1 || sz.y > 2.5)) s = 1.75 / (sz.y || 1); else if (mx > 12 || mx < .08) s = 1 / mx;
      const holder = new T.Group(); holder.name = rec.name; const inner = new T.Group(); inner.add(root);
      inner.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s); inner.scale.setScalar(s);
      holder.add(inner);
      e.obj = holder; e.clips = clips; e.skinned = skinned; e.size = [sz.x * s, sz.y * s, sz.z * s]; e.status = 'ok';
      rec.clips = clips.map(c => ({ name: c.name, dur: Math.round(c.duration * 1000) / 1000 })); rec.skinned = skinned ? 1 : 0;
      GW.invalidate(); S.viewDirty(); GW.bus.emit('s3d-models');
      return e;
    })().catch(err => { console.warn('model load', rec && rec.path, err); e.status = 'err'; e.err = String(err && err.message || err); GW.bus.emit('s3d-models'); return e; });
    return e;
  };
  // clip by name from a model (retarget-lite: from another model when bone names match); inPlace strips root XZ motion
  const clipCache = new Map();
  S.clipFor = (ref, name, inPlace) => {
    const me = S.models.get(ref); if (!me || me.status !== 'ok') return null;
    const k = ref + '|' + name + '|' + (inPlace ? 1 : 0); if (clipCache.has(k)) return clipCache.get(k);
    let c = me.clips.find(x => x.name === name) || null;
    if (c && inPlace) {
      c = c.clone();
      for (const tr of c.tracks) if (/hips\.position$/i.test(tr.name) || /root\.position$/i.test(tr.name)) { const v = tr.values; const x0 = v[0], z0 = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; } }
    }
    clipCache.set(k, c); return c;
  };
  S.retargetInfo = (targetRef, srcRef, name) => {
    const a = S.models.get(targetRef), b = S.models.get(srcRef); if (!a || !b || a.status !== 'ok' || b.status !== 'ok') return null;
    const c = b.clips.find(x => x.name === name); if (!c) return null; const names = new Set(); a.obj.traverse(o => names.add(o.name));
    const nodes = [...new Set(c.tracks.map(t => t.name.split('.')[0]))]; const hit = nodes.filter(n => names.has(n)).length;
    return { matched: hit, total: nodes.length, ok: hit >= nodes.length * .6 };
  };

  /* ---------------- per-clip runtime scene ---------------- */
  const structKey = (o) => JSON.stringify([o.t, o.text || 0, o.model || 0, o.p || 0]);
  function disposeNode(n) {
    n.traverse(o => {
      if (o.userData && o.userData.keepRes) return;
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) if (m && !m.userData.shared) { for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) if (m[k] && m[k].userData && m[k].userData.own) m[k].dispose(); m.dispose(); }
      if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
    });
  }
  function getRT(c) {
    let rt = S.rts.get(c.id); const T = S.T;
    if (!rt) {
      const scene = new T.Scene(); const root = new T.Group(); scene.add(root);
      rt = { id: c.id, scene, root, cam: new T.PerspectiveCamera(40, 16 / 9, .05, 500), nodes: new Map(), used: 0 };
      S.rts.set(c.id, rt);
    }
    rt.used = performance.now(); return rt;
  }
  S.rtOf = (c) => S.T && c && c.s3d ? sync(c) : null;
  function buildNode(o, rt, c) {
    const T = S.T; let n;
    if (o.t === 'model') {
      const me = S.loadModel(o.model && o.model.ref);
      if (me.status !== 'ok') { n = new T.Group(); n.userData.pending = me.status === 'load'; if (me.status === 'load') me.p.then(() => { const r2 = S.rts.get(c.id); if (r2) { const x = r2.nodes.get(o.id); if (x) x.key = null; } GW.invalidate(); S.viewDirty(); }); }
      else {
        n = new T.Group(); const inst = me.skinned ? T.X.SkeletonUtils.clone(me.obj) : me.obj.clone(true); n.add(inst);
        inst.traverse(x => { x.userData.keepRes = true; if (x.isMesh) { x.castShadow = x.receiveShadow = true; } });
        n.userData.inst = inst; if (me.clips.length || me.skinned) n.userData.mixer = new T.AnimationMixer(inst);
        n.userData.bones = []; inst.traverse(x => { if (x.isBone) { n.userData.bones.push(x); x.userData.q0 = x.quaternion.clone(); x.userData.p0 = x.position.clone(); x.userData.s0 = x.scale.clone(); } });
        n.userData.size = me.size;
      }
    } else {
      const L = S.LIB[o.t]; if (!L) { n = new T.Group(); }
      else { try { n = L.build(S.K, o) || new T.Group(); } catch (er) { console.error('s3d build', o.t, er); n = new T.Group(); } }
    }
    n.userData.oid = o.id; n.name = o.name || o.t;
    // screens: remember meshes tagged by the library
    const scr = []; n.traverse(x => { if (x.userData.screen) scr.push(x); }); n.userData.screens = scr;
    const lights = []; n.traverse(x => { if (x.isLight) lights.push(x); }); n.userData.lights = lights;
    const mains = new Set(), vh = [], co = []; n.traverse(x => { if (x.userData.vhelper) vh.push(x); if (x.userData.camOnly) co.push(x); if (x.isMesh && x.userData.main && x.material && x.material.isMeshStandardMaterial) { const m = x.material; if (!m.userData.base) m.userData.base = { color: m.color.getHex(), rough: m.roughness, metal: m.metalness, map: m.map || null }; mains.add(m); } });
    n.userData.mains = [...mains]; n.userData.vh = vh; n.userData.co = co;
    for (const l of lights) if (l.target && !l.target.parent) rt.root.add(l.target);
    return n;
  }
  function sync(c) {
    const rt = getRT(c), d = c.s3d, seen = new Set();
    for (const o of d.objs) {
      seen.add(o.id); const k = structKey(o); let e = rt.nodes.get(o.id);
      if (!e || e.key !== k) {
        if (e) { rt.root.remove(e.node); for (const l of e.node.userData.lights || []) if (l.target && l.target.parent === rt.root) rt.root.remove(l.target); disposeNode(e.node); }
        const node = buildNode(o, rt, c); e = { key: k, node }; rt.nodes.set(o.id, e); rt.root.add(node);
      }
    }
    for (const [id, e] of rt.nodes) if (!seen.has(id)) { rt.root.remove(e.node); for (const l of e.node.userData.lights || []) if (l.target && l.target.parent === rt.root) rt.root.remove(l.target); disposeNode(e.node); rt.nodes.delete(id); }
    return rt;
  }
  S.dropRT = (id) => { const rt = S.rts.get(id); if (!rt) return; for (const e of rt.nodes.values()) disposeNode(e.node); S.rts.delete(id); };
  setInterval(() => { // release scenes of clips that left the project
    const live = new Set(); for (const s of GW.prj.seqs) for (const c of s.clips) if (c.kind === 'scene3d') live.add(c.id);
    for (const id of [...S.rts.keys()]) if (!live.has(id) && performance.now() - S.rts.get(id).used > 20000) S.dropRT(id);
  }, 10000);

  /* ---------------- time evaluation ---------------- */
  const tmpQ = () => new S.T.Quaternion();
  function applyMat(o, node) {
    const mm = o.mat || {}; const ms = node.userData.mains || [];
    for (const m of ms) {
      const b = m.userData.base; if (!b) continue;
      if (mm.color) m.color.set(mm.color); else m.color.setHex(b.color);
      m.roughness = mm.rough != null ? +mm.rough : b.rough; m.metalness = mm.metal != null ? +mm.metal : b.metal;
      const e = mm.tex ? imageTex(mm.tex) : null; const tx = e && e.status === 'ok' ? e.tex : b.map;
      if (m.map !== tx) { m.map = tx; m.needsUpdate = true; }
      if (mm.tex && tx !== b.map && !mm.color) m.color.setHex(0xffffff);
    }
  }
  // walking along a floor path: trapezoid speed profile → distance d(τ), speed factor
  S.walkEval = (w, lt) => {
    const T = S.T; if (!w || !w.on || !w.pts || w.pts.length < 2) return null;
    const key = JSON.stringify(w.pts); if (!w._c || w._k !== key) { Object.defineProperty(w, '_c', { value: new T.CatmullRomCurve3(w.pts.map(p => new T.Vector3(p[0], 0, p[1])), false, 'centripetal'), writable: true, configurable: true, enumerable: false }); Object.defineProperty(w, '_k', { value: key, writable: true, configurable: true, enumerable: false }); }
    const cu = w._c, L = cu.getLength(); let v = Math.max(.05, +w.speed || 1.4), e = Math.max(0, w.ease != null ? +w.ease : .6);
    if (L < v * e) v = Math.sqrt(L * v / Math.max(e, 1e-3)) || v; // short path: lower top speed
    const a = e > 0 ? v / e : Infinity, Tt = L / v + e; const tau = lt - (w.start || 0);
    let d, sp;
    if (tau <= 0) { d = 0; sp = 0; } else if (tau >= Tt) { d = L; sp = 0; }
    else if (tau < e) { d = .5 * a * tau * tau; sp = a * tau / v; }
    else if (tau < Tt - e) { d = .5 * v * e + v * (tau - e); sp = 1; }
    else { const r = Tt - tau; d = L - .5 * a * r * r; sp = a * r / v; }
    const u = clamp(d / (L || 1), 0, 1); const p = cu.getPointAt(u); const tg = cu.getTangentAt(Math.min(u, .999));
    return { x: p.x, z: p.z, yaw: Math.atan2(tg.x, tg.z), d, sp: clamp(sp, 0, 1), L, T: Tt };
  };
  function applyAnim(c, o, node, lt) {
    for (const b of node.userData.bones || []) { b.quaternion.copy(b.userData.q0); b.position.copy(b.userData.p0); b.scale.copy(b.userData.s0); } // un-animated bones: no pose/look-at accumulation
    const mx = node.userData.mixer; const ref = o.model && o.model.ref; if (!mx) return;
    const inPlace = !o.anim || o.anim.inPlace !== 0;
    const acts = node.userData.acts || (node.userData.acts = new Map());
    const want = new Map(); // action key → {clip, time, weight}
    const add = (src, name, time, w) => { if (w <= 1e-4 || !name) return; const clip = S.clipFor(src || ref, name, inPlace || (o.walk && o.walk.on)); if (!clip) return; const k = (src || ref) + '|' + name; const cur = want.get(k); const tt = clip.duration > 0 ? ((time % clip.duration) + clip.duration) % clip.duration : 0; if (!cur || cur.w < w) want.set(k, { clip, time: tt, w: (cur ? cur.w : 0) + w }); else cur.w += w; };
    const strips = (o.anim && o.anim.strips) || [];
    let wsum = 0; const parts = [];
    for (const s of strips) {
      if (s.on === 0) continue; const st = +s.start || 0, du = Math.max(.01, +s.dur || 1), f = Math.max(0, +s.fade || 0);
      if (lt < st - f * .5 || lt > st + du + f * .5) continue;
      let w = 1; if (f > 0) w = Math.min(clamp((lt - (st - f * .5)) / f, 0, 1), clamp((st + du + f * .5 - lt) / f, 0, 1));
      const clip = S.clipFor(s.src || ref, s.clip, inPlace); if (!clip) continue;
      let tl = (lt - st) * (s.speed || 1) + (+s.off || 0); if (s.loop === 0) tl = clamp(tl, 0, clip.duration - 1e-3);
      parts.push([s.src, s.clip, tl, w]); wsum += w;
    }
    const wk = o.walk && o.walk.on ? S.walkEval(o.walk, lt) : null;
    if (wk) {
      const walkClip = S.clipFor(ref, o.walk.clip, true); const stride = Math.max(.1, +o.walk.stride || 1.4);
      const m = wk.sp; const sc = wsum > 0 ? Math.max(0, 1 - m) : 1; for (const p of parts) p[3] *= sc;
      if (walkClip && m > 0) parts.push([null, o.walk.clip, wk.d / stride * walkClip.duration, m]);
      if (o.walk.idle && m < 1 && wsum === 0) parts.push([null, o.walk.idle, lt, 1 - m]);
    }
    for (const [src, name, tl, w] of parts) add(src, name, tl, w);
    let tot = 0; for (const x of want.values()) tot += x.w;
    for (const [k, a] of acts) if (!want.has(k)) { a.enabled = false; a.setEffectiveWeight(0); }
    for (const [k, x] of want) {
      let a = acts.get(k); if (!a) { a = mx.clipAction(x.clip); a.play(); acts.set(k, a); }
      a.enabled = true; a.setEffectiveTimeScale(1); a.setEffectiveWeight(tot > 1 ? x.w / tot : x.w); a.time = x.time; a.paused = true;
    }
    if (!want.size) { mx.stopAllAction(); acts.clear(); node.userData.inst && restPose(node); }
    else mx.update(0);
  }
  function restPose(node) { const sk = new Set(); node.userData.inst.traverse(x => { if (x.isSkinnedMesh && x.skeleton) sk.add(x.skeleton); }); for (const s of sk) s.pose(); }
  S.findBone = (node, re) => (node.userData.bones || []).find(b => re.test(b.name));
  function applyPose(o, node, lt) {
    const T = S.T; if (o.pose) for (const bn in o.pose) { const b = (node.userData.bones || []).find(x => x.name === bn); if (!b) continue; const r = v3(o.pose[bn], lt); const q = new T.Quaternion().setFromEuler(new T.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'XYZ')); b.quaternion.multiply(q); }
    if (o.look && o.look.on) {
      const amt = clamp(num(o.look.amount, lt, 1), 0, 1); if (amt <= 0) return;
      const head = S.findBone(node, /(^|:|_)head$/i) || S.findBone(node, /head/i), neck = S.findBone(node, /neck/i); if (!head) return;
      node.updateMatrixWorld(true); const sm = o.look.smooth != null ? +o.look.smooth : .3, N = 8; const acc = [0, 0, 0]; for (let i = 0; i < N; i++) { const v = v3(o.look.target, lt - sm * i / (N - 1), [0, 1.6, 5]); acc[0] += v[0] / N; acc[1] += v[1] / N; acc[2] += v[2] / N; } const tgt = new T.Vector3(acc[0], acc[1], acc[2]); // deterministic smoothing: mean over the last «smooth» seconds
      const fwd = new T.Vector3(0, 0, 1).applyQuaternion(node.getWorldQuaternion(tmpQ())).normalize();
      for (const [b, share] of neck ? [[neck, .4], [head, .6]] : [[head, 1]]) {
        b.updateMatrixWorld(true); const hp = b.getWorldPosition(new T.Vector3()); const dir = tgt.clone().sub(hp).normalize();
        let dq = new T.Quaternion().setFromUnitVectors(fwd, dir); const ang = 2 * Math.acos(clamp(Math.abs(dq.w), 0, 1)); const lim = 75 * D2R;
        if (ang > lim) dq = new T.Quaternion().slerp(dq, lim / ang);
        dq = new T.Quaternion().slerp(dq, amt * share);
        const wq = b.getWorldQuaternion(tmpQ()); const nw = dq.multiply(wq); const pq = b.parent.getWorldQuaternion(tmpQ()).invert(); b.quaternion.copy(pq.multiply(nw)); b.updateMatrixWorld(true);
      }
    }
  }
  S.objMatrix = null;
  // set the whole runtime scene to clip-local time lt
  S.apply = (c, lt, ctx = {}) => {
    const T = S.T; const rt = sync(c); const d = c.s3d; ctx.vt = ctx.vt || [];
    for (const o of d.objs) {
      const e = rt.nodes.get(o.id); if (!e) continue; const n = e.node;
      n.visible = !o.hide; if (o.hide) continue;
      const p = v3(o.pos, lt), r = v3(o.rot, lt), s = v3(o.scl, lt, [1, 1, 1]);
      n.position.set(p[0], p[1], p[2]); n.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ'); n.scale.set(s[0] || 1e-4, s[1] || 1e-4, s[2] || 1e-4);
      if (o.walk && o.walk.on) { const w = S.walkEval(o.walk, lt); if (w) { n.position.x = w.x; n.position.z = w.z; n.rotation.y = w.yaw + r[1] * D2R; } }
      applyMat(o, n);
      if (o.light) for (const l of n.userData.lights) {
        const L = o.light; const base = l.userData.mult != null ? l.userData.mult : 1; l.intensity = num(L.int, lt, 1) * base; if (L.color) l.color.set(L.color);
        if (l.isSpotLight) { l.angle = clamp((+L.angle || 30) * D2R, .01, 1.5); l.penumbra = clamp(L.pen != null ? +L.pen : .4, 0, 1); l.distance = +L.dist || 0; }
        if (l.isPointLight) l.distance = +L.dist || 0;
        if (l.target && L.target) { l.target.position.set(...v3(L.target, lt)); l.target.updateMatrixWorld(); }
        if (l.isRectAreaLight) { l.width = +L.w || 1.2; l.height = +L.h || .8; }
        if (l.isRectAreaLight && L.target) { n.updateMatrixWorld(true); const tg = v3(L.target, lt); l.lookAt(tg[0], tg[1], tg[2]); }
        if (l.castShadow !== undefined && l.shadow) l.castShadow = !!(L.shadow && d.shadows !== 0) && !l.isPointLight || (!!L.shadow && l.isPointLight && d.shadows !== 0);
        if (l.isRectAreaLight) { const panel = n.getObjectByName('softbox-face'); if (panel) panel.material.color.set(L.color || '#fff'); }
      }
      if (o.t === 'model') { applyAnim(c, o, n, lt); applyPose(o, n, lt); }
      if (n.userData.tick) n.userData.tick(lt, o);
      const scr = n.userData.screens; if (scr && scr.length) {
        const src = o.screen && (o.screen.media || o.screen.seq) ? screenSource(c, o, lt, ctx) : null;
        for (const m of scr) S.K.setScreen(m, src, o.screen || {});
      }
    }
    // scene-level
    const sc = rt.scene; const bg = d.bg || {};
    if (bg.mode === 'transparent') sc.background = null; else if (bg.mode === 'env') { sc.background = S.envTex(); sc.backgroundBlurriness = .5; sc.backgroundIntensity = .6; } else { if (!sc.background || !sc.background.isColor) sc.background = new T.Color(); sc.background.set(bg.color || '#0c0e13'); }
    if (d.env && d.env.on) { sc.environment = S.envTex(); sc.environmentIntensity = num(d.env.int, lt, .35); } else sc.environment = null;
    if (d.fog && d.fog.on) { if (!sc.fog) sc.fog = new T.FogExp2('#000', .03); sc.fog.color.set(d.fog.color || '#0c0e13'); sc.fog.density = num(d.fog.density, lt, .03); } else sc.fog = null;
    // camera
    const cam = rt.cam; const cp = v3(d.cam.pos, lt, [0, 1.6, 6]), ct = v3(d.cam.target, lt, [0, 1, 0]);
    cam.position.set(cp[0], cp[1], cp[2]); cam.up.set(0, 1, 0); cam.lookAt(ct[0], ct[1], ct[2]); const roll = num(d.cam.roll, lt, 0); if (roll) cam.rotateZ(roll * D2R);
    cam.fov = clamp(num(d.cam.fov, lt, 40), 5, 120); if (ctx.aspect) cam.aspect = ctx.aspect; cam.near = .05; cam.far = 500; cam.updateProjectionMatrix();
    rt.root.updateMatrixWorld(true);
    return rt;
  };

  /* ---------------- render ---------------- */
  let COMP = null;
  function post(rt, d, lt, w, h, ren) {
    const T = S.T, X = T.X; const bl = d.bloom && d.bloom.on, df = d.dof && d.dof.on;
    if (!bl && !df) return false;
    if (!COMP) { COMP = { c: new X.EffectComposer(ren), rp: new X.RenderPass(rt.scene, rt.cam), bloom: new X.UnrealBloomPass(new T.Vector2(w, h), .5, .4, .85), bokeh: new X.BokehPass(rt.scene, rt.cam, { focus: 5, aperture: .002, maxblur: .01 }), out: new X.OutputPass() }; COMP.c.addPass(COMP.rp); COMP.c.addPass(COMP.bokeh); COMP.c.addPass(COMP.bloom); COMP.c.addPass(COMP.out); }
    const C = COMP; C.c.setPixelRatio(1); C.c.setSize(w, h); C.rp.scene = rt.scene; C.rp.camera = rt.cam; C.bokeh.scene = rt.scene; C.bokeh.camera = rt.cam;
    C.bloom.enabled = !!bl; C.bokeh.enabled = !!df;
    if (bl) { C.bloom.strength = num(d.bloom.strength, lt, .5); C.bloom.radius = +d.bloom.radius || .4; C.bloom.threshold = +d.bloom.threshold || .85; C.bloom.resolution.set(w, h); }
    if (df) { const u = C.bokeh.uniforms; u.focus.value = num(d.dof.focus, lt, 5); u.aperture.value = num(d.dof.aperture, lt, 1.5) * 1e-3; u.maxblur.value = .012; u.aspect.value = w / h; }
    C.c.render(); return true;
  }
  S.render = (c, lt, w, h, o = {}) => {
    const ren = S.renderer(); if (!ren || !c.s3d) return null;
    const ctx = { exporting: !!o.exporting, live: !!o.live, w, h, aspect: w / h, vt: [] };
    const rt = S.apply(c, lt, ctx); const d = c.s3d;
    for (const e of rt.nodes.values()) { for (const x of e.node.userData.vh || []) x.visible = !!o.helpers; for (const x of e.node.userData.co || []) x.visible = !o.camera; } // free view: dollhouse (no ceiling / sky card)
    const big = Math.max(w, h) > 1300; for (const e of rt.nodes.values()) for (const l of e.node.userData.lights || []) if (l.shadow && l.castShadow) { const want = l.isDirectionalLight ? (big ? 2048 : 1024) : (big ? 1024 : 512); if (l.shadow.mapSize.x !== want) { l.shadow.mapSize.set(want, want); if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } } }
    if (ren.domElement.width !== w || ren.domElement.height !== h) ren.setSize(w, h, false);
    ren.toneMappingExposure = Math.pow(2, num(d.exposure, lt, 1) - 1) * 1; ren.shadowMap.enabled = d.shadows !== 0; ren.setClearColor(0x000000, 0);
    if (o.extra) rt.scene.add(o.extra);
    const cam = o.camera || rt.cam; if (o.camera) { o.camera.aspect = w / h; o.camera.updateProjectionMatrix(); }
    try { if (o.camera || !post(rt, d, lt, w, h, ren)) { ren.setRenderTarget(null); ren.render(rt.scene, cam); } }
    finally { if (o.extra) rt.scene.remove(o.extra); }
    S.lastVT = ctx.vt;
    return ren.domElement;
  };
  // pending work for a frame (export / captureFrame): three.js, models, image maps, fonts, video seeks
  S.ensure = async (c, lt, opts = {}) => {
    await S.ready; if (!c.s3d) return; sync(c);
    const ps = [];
    for (const o of c.s3d.objs) {
      if (o.t === 'model' && o.model) { const me = S.loadModel(o.model.ref); if (me.p) ps.push(me.p); for (const s of (o.anim && o.anim.strips) || []) if (s.src) { const m2 = S.loadModel(s.src); if (m2.p) ps.push(m2.p); } }
      if (o.mat && o.mat.tex) { const e = imageTex(o.mat.tex); if (e && e.p) ps.push(e.p); }
      if (o.t === 'text' && o.text && document.fonts) ps.push(document.fonts.load(`${o.text.weight || 800} 64px "${o.text.font || 'Cairo'}"`).catch(() => {}));
      const sc = o.screen; const m = sc && sc.media && GW.media(sc.media);
      if (m && m.kind === 'image') { const e = imageTex(m.id); if (e && e.p) ps.push(e.p); }
      if (m && m.kind === 'video') ps.push((async () => {
        const fd = 1 / (m.fps || 30); const st = screenSrcTime(o, m, lt);
        for (let a = 0; a < 3; a++) { const el = GW.Media.vid(pseudo(c, o)); if (!el) return; await GW.Media.waitReady(el); if (!el.paused) el.pause(); await GW.Media.seekExact(el, st + 1e-4); if (el.readyState >= 2 && Math.abs(el.currentTime - st) < fd) return; GW.Media.dropVid(pseudo(c, o).id); }
      })());
    }
    await Promise.all(ps); sync(c);
  };
  S.viewDirty = () => { if (S.View) S.View.dirty(); };
  S.clipsIn = (s) => (s || GW.seq()).clips.filter(c => c.kind === 'scene3d');
})();
