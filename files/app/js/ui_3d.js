'use strict';
/* «ثلاثي الأبعاد» workspace: 3D viewport, outliner, inspector, library panels + menus + automation API.
   Engine: js/s3d.js (runtime), js/s3d_lib.js (objects), js/s3d_ops.js (operations). */
(function () {
  const S = GW.S3D, O = S.ops, P = GW.P, pv = GW.pv, esc = GW.esc, clamp = GW.clamp;

  /* ================= automation API ================= */
  const A = GW.API && GW.API.methods;
  const fail = (m) => { throw new Error(m); };
  const clipOf3 = (id) => { const c = O.clip(id); if (!c) fail(id ? 'not a 3D scene clip: ' + id : 'no 3D scene clip (call add3DScene first)'); return c; };
  const objOf = (c, id) => { if (!id) fail('obj required'); const o = c.s3d.objs.find(x => x.id === id || x.name === id); if (!o) fail('no 3D object ' + id + ' in ' + c.id); return o; };
  const mediaOf = (ref) => { if (!ref) return null; const m = GW.prj.media.find(x => x.id === ref || x.name === ref || x.path === ref || (x.path && x.path.split(/[\\/]/).pop() === ref)); if (!m) fail('no media ' + ref); return m; };
  const objInfo = (o) => ({ id: o.id, type: o.t, name: o.name, pos: pv(o.pos, 0), rot: pv(o.rot, 0), scl: pv(o.scl, 0), screen: o.screen ? { media: o.screen.media, seq: o.screen.seq } : undefined, light: o.light ? { kind: S.LIB[o.t] && S.LIB[o.t].light && S.LIB[o.t].light.kind, int: pv(o.light.int, 0), color: o.light.color } : undefined, model: o.model ? o.model.ref : undefined, anim: o.anim ? o.anim.strips.map(s => ({ clip: s.clip, start: s.start, dur: s.dur })) : undefined });
  const keyParam = (p, v, time, c, ease) => { if (time == null) { delete p.k; p.v = v; } else { const t = clamp(+time - c.start, 0, c.dur); if (!p.k) p.k = [{ t, v, e: ease || 'linear' }]; else GW.setPv(p, t, v); const k = p.k.find(x => Math.abs(x.t - t) < 1 / 240); if (k && ease) k.e = ease; } };
  if (A) {
    A.list3DLibrary = () => ({ categories: S.CATS.map(([k, n]) => ({ id: k, name: n })), objects: Object.values(S.LIB).map(L => ({ type: L.id, cat: L.cat, name: L.n, screen: !!L.screens, light: L.light ? L.light.kind : undefined })), templates: S.TEMPLATES.map(([k, n]) => ({ id: k, name: n })), lightPresets: S.LIGHT_PRESETS.map(([k, n]) => ({ id: k, name: n })), cameraPresets: S.CAM_PRESETS.map(([k, n]) => ({ id: k, name: n })), models: (GW.prj.models3d || []).map(m => ({ id: m.id, name: m.name, path: m.path, clips: m.clips })) });
    A.add3DScene = async (p = {}) => { await S.ready; const c = O.addScene(p.preset || p.template || 'living', { start: p.start, dur: p.dur, transparent: p.transparent, name: p.name, ti: p.track != null ? GW.API.parseTrack(p.track, 'v').ti : undefined }); if (p.lights) { O.lightPreset(c.s3d, p.lights); GW.commit('إضاءة'); } return { id: c.id, start: c.start, dur: c.dur, objects: c.s3d.objs.map(objInfo) }; };
    A.add3DObject = async (p = {}) => {
      await S.ready; const c = clipOf3(p.id); let t = p.type || 'prim:cube'; let ref = p.ref;
      if (p.path) { const recs = await O.importModels([{ path: p.path }]); if (!recs.length) fail('could not import ' + p.path); ref = recs[0].id; t = 'model'; }
      if (t === 'model' && !ref) fail('model needs ref or path'); if (t !== 'model' && !S.LIB[t]) fail('unknown 3D type ' + t + ' (see list3DLibrary)');
      const o = O.addObj(c, t, { pos: p.pos, rot: p.rot, scl: p.scl, name: p.name, ref, text: p.text, p: p.size });
      if (p.light) { Object.assign(o.light, p.light); if (p.light.int != null) o.light.int = P(+p.light.int); if (p.light.target) o.light.target = P(p.light.target); GW.commit('إضاءة'); }
      if (t === 'model') { const me = await S.loadModel(ref).p; if (me.status !== 'ok') fail('model failed: ' + me.err); O.autoAnim(c, o); GW.commit('حركات النموذج'); }
      return { clip: c.id, obj: objInfo(o) };
    };
    A.set3DScreenMedia = (p = {}) => { const c = clipOf3(p.id); const o = p.obj ? objOf(c, p.obj) : c.s3d.objs.find(x => x.screen); if (!o || !o.screen) fail('object has no screen'); const src = {}; if (p.media !== undefined) src.media = p.media ? mediaOf(p.media).id : null; if (p.seq !== undefined) { const sq = p.seq && GW.prj.seqs.find(x => x.id === p.seq || x.name === p.seq); if (p.seq && !sq) fail('no sequence ' + p.seq); src.seq = sq ? sq.id : null; } for (const k of ['in', 'speed', 'loop', 'fit', 'bright']) if (p[k] !== undefined) src[k] = p[k]; return { obj: o.id, screen: O.setScreen(c, o, src) }; };
    A.set3DObject = (p = {}) => { const c = clipOf3(p.id); const o = objOf(c, p.obj); for (const k of ['pos', 'rot', 'scl']) if (p[k] !== undefined) keyParam(o[k], p[k], p.time, c, p.ease); if (p.name) o.name = p.name; if (p.hide !== undefined) o.hide = p.hide ? 1 : 0; if (p.mat) o.mat = Object.assign(o.mat || {}, p.mat); if (p.light && o.light) { for (const k in p.light) { if (k === 'int') keyParam(o.light.int, +p.light.int, p.time, c, p.ease); else if (k === 'target') keyParam(o.light.target || (o.light.target = P([0, 0, 0])), p.light.target, p.time, c, p.ease); else o.light[k] = p.light[k]; } } if (p.size) o.p = Object.assign(o.p || {}, p.size); if (p.text && o.text) Object.assign(o.text, p.text); GW.commit('المساعد: عنصر ثلاثي الأبعاد'); GW.invalidate(); return objInfo(o); };
    A.delete3DObject = (p = {}) => { const c = clipOf3(p.id); O.delObj(c, objOf(c, p.obj)); return { deleted: p.obj }; };
    A.set3DCamera = (p = {}) => { const c = clipOf3(p.id); const cam = c.s3d.cam; if (p.preset) { if (!O.camPreset(c, p.preset, { start: p.start != null ? p.start - c.start : undefined, dur: p.dur, obj: p.obj, angle: p.angle, fill: p.fill })) fail('camera preset failed: ' + p.preset); } for (const k of ['pos', 'target', 'fov', 'roll']) if (p[k] !== undefined) keyParam(cam[k], p[k], p.time, c, p.ease); GW.commit('المساعد: كاميرا ثلاثية الأبعاد'); GW.invalidate(); return { pos: cam.pos, target: cam.target, fov: cam.fov }; };
    A.set3DScene = (p = {}) => { const c = clipOf3(p.id); const d = c.s3d; if (p.lights) O.lightPreset(d, p.lights); if (p.bg) d.bg = Object.assign(d.bg, typeof p.bg === 'string' ? (p.bg === 'transparent' ? { mode: 'transparent' } : { mode: 'color', color: p.bg }) : p.bg); if (p.exposure != null) d.exposure = P(+p.exposure); if (p.env != null) d.env = { on: p.env ? 1 : 0, int: P(+p.env || 0) }; if (p.fog) d.fog = { on: p.fog.on !== 0 ? 1 : 0, color: p.fog.color || d.fog.color, density: P(p.fog.density != null ? +p.fog.density : pv(d.fog.density, 0)) }; if (p.bloom) d.bloom = Object.assign(d.bloom, p.bloom, p.bloom.strength != null ? { strength: P(+p.bloom.strength) } : {}); if (p.dof) d.dof = Object.assign(d.dof, p.dof, p.dof.focus != null ? { focus: P(+p.dof.focus) } : {}, p.dof.aperture != null ? { aperture: P(+p.dof.aperture) } : {}); GW.commit('المساعد: مشهد ثلاثي الأبعاد'); GW.invalidate(); return { bg: d.bg, objects: d.objs.length }; };
    A.import3DModel = async (p = {}) => { await S.ready; const recs = await O.importModels((p.paths || [p.path]).filter(Boolean).map(x => ({ path: x })), { copy: p.copy }); return recs.map(r => { const me = S.models.get(r.id); return { id: r.id, name: r.name, path: r.path, status: me && me.status, error: me && me.err, clips: r.clips || [], skinned: !!r.skinned }; }); };
    A.set3DAnimation = (p = {}) => { // {id, obj, strips:[{clip, src, start, dur, speed, loop, fade, off}], walk:{pts, start, speed, clip, idle, stride}, look:{target, amount}, inPlace}
      const c = clipOf3(p.id); const o = objOf(c, p.obj); if (o.t !== 'model') fail('animation needs an imported model');
      if (p.strips) o.anim = { inPlace: p.inPlace === 0 ? 0 : 1, strips: p.strips.map(s => ({ id: GW.uid(), clip: s.clip, src: s.src || undefined, start: +s.start || 0, dur: +s.dur || 2, speed: s.speed != null ? +s.speed : 1, loop: s.loop === 0 ? 0 : 1, fade: s.fade != null ? +s.fade : .3, off: +s.off || 0 })) };
      if (p.walk) O.setWalk(c, o, Object.assign({ on: 1 }, p.walk));
      if (p.look) o.look = { on: p.look.on === 0 ? 0 : 1, target: P(p.look.target || [0, 1.6, 4]), amount: P(p.look.amount != null ? +p.look.amount : 1) };
      GW.commit('المساعد: حركة الشخصية'); GW.invalidate(); return { anim: o.anim, walk: o.walk, look: o.look };
    };
  }

  /* ================= UI ================= */
  const ico = GW.ico; const D2R = Math.PI / 180;
  const KIND_ICO = (o) => { const t = o.t; if (t === 'model') return 'model3d'; if (t === 'light:sun') return 'sun'; if (t === 'light:spot') return 'spot'; if (t === 'light:area') return 'softbox'; if (t.startsWith('light:')) return 'bulb'; if (t === 'text') return 'text'; const L = S.LIB[t]; if (!L) return 'cube3d'; return L.cat === 'rooms' ? 'room' : L.cat === 'screens' ? 'tv' : L.cat === 'furniture' ? 'sofa' : 'cube3d'; };
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const curClip = () => O.clip();
  const ltOf = (c) => O.lt(c);
  const refreshAll = () => { V.dirty(); renderTree(); renderInsp(); };

  /* ---------- keyframable controls ---------- */
  function keyBtn(c, p, after) {
    const b = h('button', 'v3-kb' + (GW.isAnim(p) ? ' on' : '')); const lt = ltOf(c); const at = GW.keyAt(p, lt);
    b.innerHTML = ico(at ? 'keydiaon' : 'keydia', 12); b.title = GW.isAnim(p) ? (at ? 'حذف المفتاح' : 'إضافة مفتاح') : 'تفعيل الحركة بالمفاتيح';
    b.onclick = () => { const t = GW.snapFrame(ltOf(c), GW.seq().fps); const k = GW.keyAt(p, t); if (k) { p.k = p.k.filter(x => x !== k); if (!p.k.length) { p.v = k.v; delete p.k; } } else { if (!p.k) p.k = [{ t, v: GW.clone(p.v), e: 'ease' }]; else { p.k.push({ t, v: GW.clone(pv(p, t)), e: 'ease' }); p.k.sort((a, b2) => a.t - b2.t); } } GW.commit('مفتاح'); GW.invalidate(); (after || refreshAll)(); };
    return b;
  }
  function numRow(label, c, p, o = {}) {
    const r = h('div', 'v3-row'); r.append(h('span', 'v3-l', esc(label)));
    const sc = GW.scrub({ get: () => +pv(p, ltOf(c)) || 0, set: (v, fin) => { GW.setPv(p, ltOf(c), v); GW.invalidate(); V.dirty(); if (fin) { GW.commit(o.label || label); renderInsp(); } }, step: o.step || .01, min: o.min, max: o.max, dec: o.dec ?? 2, unit: o.unit });
    const w = h('span', 'v3-v'); w.append(sc); r.append(w); if (!o.noKey) r.append(keyBtn(c, p)); return r;
  }
  function vecRow(label, c, p, o = {}) {
    const r = h('div', 'v3-row v3-rowv'); r.append(h('span', 'v3-l', esc(label))); const w = h('span', 'v3-v v3-vec');
    ['X', 'Y', 'Z'].forEach((ax, i) => { const sc = GW.scrub({ get: () => (pv(p, ltOf(c)) || [0, 0, 0])[i], set: (v, fin) => { const cur = GW.clone(pv(p, ltOf(c))); cur[i] = v; GW.setPv(p, ltOf(c), cur); GW.invalidate(); V.dirty(); if (fin) { GW.commit(label); renderInsp(); } }, step: o.step || .01, dec: o.dec ?? 2 }); const cell = h('span', 'v3-ax'); cell.append(h('i', 'ax' + i, ax), sc); w.append(cell); });
    r.append(w); if (!o.noKey) r.append(keyBtn(c, p)); return r;
  }
  function plainRow(label, ctl) { const r = h('div', 'v3-row'); r.append(h('span', 'v3-l', esc(label))); const w = h('span', 'v3-v'); w.append(ctl); r.append(w); return r; }
  function sel(opts, val, on) { const s = h('select', 'sel'); for (const [v, n] of opts) { const op = document.createElement('option'); op.value = v; op.textContent = n; s.append(op); } s.value = val == null ? '' : val; s.onchange = () => on(s.value); return s; }
  function color(val, on) { const i = h('input'); i.type = 'color'; i.value = val || '#ffffff'; i.oninput = () => on(i.value, false); i.onchange = () => on(i.value, true); return i; }
  function chk(val, on) { const i = h('input'); i.type = 'checkbox'; i.checked = !!val; i.onchange = () => on(i.checked); return i; }
  function numIn(val, on, o = {}) { return GW.scrub({ get: () => +val() || 0, set: (v, fin) => on(v, fin), step: o.step || .01, min: o.min, max: o.max, dec: o.dec ?? 2, unit: o.unit }); }
  function section(title, icon, key) { const sec = h('div', 'v3-sec' + (closed[key] ? ' closed' : '')); const hd = h('button', 'v3-sh', `${ico('down', 12)}${icon ? ico(icon, 14) : ''}<span>${esc(title)}</span>`); hd.onclick = () => { closed[key] = !closed[key]; sec.classList.toggle('closed', !!closed[key]); }; const body = h('div', 'v3-sb'); sec.append(hd, body); sec.body = body; return sec; }
  const closed = {};

  /* ================= viewport ================= */
  const V = S.View = { mode: 'translate', snap: true, grid: true, view: 'free', trail: true, pathDraw: null, scheduled: false, lastT: 0 };
  V.dirty = () => { if (V.scheduled || !V.el || !GW.isShown('3dview')) return; V.scheduled = true; const run = () => { V.scheduled = false; try { V.render(); } catch (e) { console.error('3d viewport', e); } }; if (GW.pb && GW.pb.playing) setTimeout(() => requestAnimationFrame(run), 90); else requestAnimationFrame(run); };
  GW.registerPanel('3dview', 'العرض ثلاثي الأبعاد', (el) => {
    el.innerHTML = `<div class="v3d"><div class="v3d-bar" dir="rtl">
      <span class="v3-grp" data-a="modes"><button class="v3-tb on" data-m="translate" title="تحريك (W)">${ico('move3d', 16)}</button><button class="v3-tb" data-m="rotate" title="تدوير (E)">${ico('rotate3d', 16)}</button><button class="v3-tb" data-m="scale" title="تحجيم (R)">${ico('scale3d', 16)}</button></span>
      <span class="v3-grp"><button class="v3-tb on" data-a="snap" title="الالتقاط للشبكة">${ico('magnet', 16)}</button><button class="v3-tb on" data-a="grid" title="إظهار الشبكة">${ico('grid', 16)}</button><button class="v3-tb on" data-a="trail" title="مسار الحركة">${ico('route', 16)}</button></span>
      <span class="v3-grp v3-seg"><button class="v3-sg on" data-v="free" title="عرض حر للتحرير">${ico('orbit', 14)}<span>عرض حر</span></button><button class="v3-sg" data-v="cam" title="عرض الكاميرا (ما يظهر في الفيديو)">${ico('camera', 14)}<span>عرض الكاميرا</span></button></span>
      <button class="v3-tb" data-a="focus" title="تأطير العنصر المحدد (F)">${ico('focus3d', 16)}</button>
      <span class="grow"></span>
      <button class="btn sm" data-a="add">${ico('plus', 14)} إضافة</button><button class="btn sm ghost" data-a="new" title="مشهد ثلاثي الأبعاد جديد">${ico('cube3d', 14)} مشهد جديد</button>
    </div><div class="v3d-stage"><canvas></canvas><div class="v3d-hud" dir="rtl"></div><div class="v3d-empty" hidden></div></div></div>`;
    V.el = el; V.cv = el.querySelector('canvas'); V.stage = el.querySelector('.v3d-stage'); V.hud = el.querySelector('.v3d-hud'); V.empty = el.querySelector('.v3d-empty');
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m));
    el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => setView(b.dataset.v));
    const tog = (k) => { V[k] = !V[k]; el.querySelector(`[data-a=${k}]`).classList.toggle('on', V[k]); if (V.tc) applySnap(); V.dirty(); };
    el.querySelector('[data-a=snap]').onclick = () => tog('snap'); el.querySelector('[data-a=grid]').onclick = () => tog('grid'); el.querySelector('[data-a=trail]').onclick = () => tog('trail');
    el.querySelector('[data-a=focus]').onclick = () => focusSel();
    el.querySelector('[data-a=add]').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); GW.menu(r.left, r.bottom + 4, addMenuItems()); };
    el.querySelector('[data-a=new]').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); GW.menu(r.left, r.bottom + 4, S.TEMPLATES.map(([k, n]) => ({ label: n, action: () => { O.addScene(k); refreshAll(); } }))); };
    new ResizeObserver(() => V.dirty()).observe(V.stage);
    initStage(); V.dirty();
  });
  function addMenuItems() { return S.CATS.filter(([k]) => k !== 'models').map(([k, n]) => ({ label: n, sub: Object.values(S.LIB).filter(L => L.cat === k).map(L => ({ label: L.n, action: () => addLib(L.id) })) })).concat(['-', { label: 'استيراد نموذج ثلاثي الأبعاد…', action: () => O.importDialog() }]); }
  function setMode(m) { V.mode = m; if (V.tc) V.tc.setMode(m); V.el.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === m)); V.dirty(); }
  function setView(v) { V.view = v; V.el.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === v)); V.camSynced = false; V.dirty(); }
  function applySnap() { const tc = V.tc; tc.setTranslationSnap(V.snap ? .05 : null); tc.setRotationSnap(V.snap ? 15 * D2R : null); tc.setScaleSnap(V.snap ? .05 : null); }
  function initStage() {
    const cv = V.cv;
    cv.addEventListener('pointerdown', (e) => { V.down = { x: e.clientX, y: e.clientY, b: e.button }; });
    cv.addEventListener('pointerup', (e) => { const d = V.down; V.down = null; if (!d || d.b !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || (V.tc && (V.tc.dragging || V.tc.axis)) || performance.now() - (V.tcUsed || 0) < 250) return; pick(e); });
    cv.addEventListener('dblclick', (e) => { if (V.pathDraw) { finishPath(); e.preventDefault(); } });
    cv.addEventListener('keydown', (e) => { const k = e.key.toLowerCase(); if (e.ctrlKey && k !== 'd') return; if (k === 'w') setMode('translate'); else if (k === 'e') setMode('rotate'); else if (k === 'r') setMode('scale'); else if (k === 'f') focusSel(); else if (k === 'escape' && V.pathDraw) finishPath(); else if (k === 'enter' && V.pathDraw) finishPath(); else if (k === 'd' && (e.ctrlKey || e.metaKey)) { const c = curClip(), o = O.obj(c); if (o) O.dupObj(c, o); refreshAll(); } else if (k === 'delete') { const c = curClip(), o = O.obj(c); if (o && !o.lock) O.delObj(c, o); refreshAll(); } else return; e.preventDefault(); e.stopPropagation(); });
    cv.tabIndex = 0;
    cv.addEventListener('dragover', (e) => { const ty = [...e.dataTransfer.types]; if (ty.includes('application/x-gws-3d') || ty.includes('application/x-gws-media') || ty.includes('Files') || ty.includes('application/x-gws-files')) { e.preventDefault(); e.stopPropagation(); } });
    cv.addEventListener('drop', async (e) => {
      const lib = e.dataTransfer.getData('application/x-gws-3d'), med = e.dataTransfer.getData('application/x-gws-media'), fl = e.dataTransfer.getData('application/x-gws-files'); e.preventDefault(); e.stopPropagation();
      const hit = rayAt(e); const at = hit ? hit.point : null;
      if (lib) { const j = JSON.parse(lib); if (j.model) { const rec = j.path ? await O.modelFromRemembered(j) : S.modelRec(j.model); if (rec) { const c = O.ensureClip(); O.addObj(c, 'model', { ref: rec.id, name: rec.name, pos: at ? [at.x, 0, at.z] : [0, 0, 0] }); } } else addLib(j.t, at); refreshAll(); return; }
      if (med) { const ids = JSON.parse(med); const m = GW.media(ids[0]); const c = curClip(); const o = hit && hit.oid && O.obj(c, hit.oid); if (m && o && o.screen) { O.setScreen(c, o, { media: m.id }); O.select(c, o.id); GW.toast('تم عرض «' + m.name + '» على الشاشة'); refreshAll(); } else if (m && o && m.kind === 'image' && S.LIB[o.t] && (o.t.startsWith('prim:') || o.mat)) { o.mat = Object.assign(o.mat || {}, { tex: m.id }); GW.commit('خامة من صورة'); refreshAll(); } else GW.toast('أفلت الوسائط على شاشة (تلفاز أو جدار فيديو…)'); return; }
      const files = fl ? JSON.parse(fl).map(p => ({ path: p, name: p.split(/[\\/]/).pop() })) : [...e.dataTransfer.files].map(f => ({ path: window.gws && gws.pathFor ? gws.pathFor(f) : (f.path || null), name: f.name, file: window.gws ? null : f }));
      const models = files.filter(f => S.isModel(f.name)); if (models.length) { await O.importAndPlace(models, at ? [at.x, 0, at.z] : null); refreshAll(); }
      const rest = files.filter(f => !S.isModel(f.name)); if (rest.length) GW.Media.importFiles(rest);
    });
  }
  function ensureControls() {
    if (V.orbit || !S.T) return; const T = S.T, X = T.X;
    V.freeCam = new T.PerspectiveCamera(50, 1, .05, 500); V.freeCam.position.set(5, 4, 7);
    V.proxy = new T.PerspectiveCamera(40, 1, .05, 500);
    V.orbit = new X.OrbitControls(V.freeCam, V.cv); V.orbit.enableDamping = false; V.orbit.target.set(0, 1, 0); V.orbit.screenSpacePanning = true; V.orbit.update();
    V.orbit.addEventListener('change', () => { if (V.syncing) return; if (V.view === 'cam') writeCam(); V.dirty(); });
    V.orbit.addEventListener('end', () => { if (V.view === 'cam') GW.commit('تحريك الكاميرا'); });
    V.tc = new X.TransformControls(V.freeCam, V.cv); V.tc.setSpace('world'); V.tc.setSize(.85); applySnap();
    V.tc.addEventListener('dragging-changed', (e) => { V.orbit.enabled = !e.value; if (!e.value) { V.tcUsed = performance.now(); GW.commit('تحويل عنصر ثلاثي الأبعاد'); renderInsp(); } });
    V.tc.addEventListener('objectChange', () => writeObj()); V.tc.addEventListener('change', () => V.dirty());
    V.extra = new T.Group(); V.gridH = new T.GridHelper(20, 40, 0x4a5260, 0x2a3038); V.gridH.material.transparent = true; V.gridH.material.opacity = .55; V.gridH.position.y = .001;
    V.lines = new T.Group(); V.extra.add(V.gridH, V.lines);
  }
  function writeCam() { const c = curClip(); if (!c) return; const d = c.s3d; const p = V.proxy.position, t = V.orbit.target; GW.setPv(d.cam.pos, ltOf(c), [p.x, p.y, p.z].map(r3)); GW.setPv(d.cam.target, ltOf(c), [t.x, t.y, t.z].map(r3)); GW.invalidate(); }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  function writeObj() {
    const c = curClip(); const o = O.obj(c); const n = V.tcNode; if (!c || !o || !n) return;
    if (V.tcBone) { const b = V.tcBone; const base = V.boneBase; const q = base.clone().invert().multiply(b.quaternion); const e = new S.T.Euler().setFromQuaternion(q, 'XYZ'); o.pose = o.pose || {}; if (!o.pose[b.name]) o.pose[b.name] = P([0, 0, 0]); GW.setPv(o.pose[b.name], ltOf(c), [e.x, e.y, e.z].map(v => r3(v / D2R))); GW.invalidate(); return; }
    const lt = ltOf(c); GW.setPv(o.pos, lt, [n.position.x, n.position.y, n.position.z].map(r3));
    const e = new S.T.Euler().setFromQuaternion(n.quaternion, 'YXZ'); GW.setPv(o.rot, lt, [e.x, e.y, e.z].map(v => Math.round(v / D2R * 100) / 100)); GW.setPv(o.scl, lt, [n.scale.x, n.scale.y, n.scale.z].map(r3));
    GW.invalidate();
  }
  function rayAt(e) {
    const c = curClip(); if (!c || !S.T || !V.lastCam) return null; const T = S.T; const r = V.lastRect; const b = V.cv.getBoundingClientRect();
    const x = (e.clientX - b.left - r.x) / r.w * 2 - 1, y = -((e.clientY - b.top - r.y) / r.h * 2 - 1); const rc = new T.Raycaster(); rc.setFromCamera(new T.Vector2(x, y), V.lastCam);
    const rt = S.rts.get(c.id); if (!rt) return null; const hits = rc.intersectObjects(rt.root.children, true).filter(hh => hh.object.visible && !(hh.object.material && hh.object.material.visible === false));
    for (const hh of hits) { let n = hh.object; while (n && n.userData.oid == null) n = n.parent; if (n) { return { point: hh.point, oid: n.userData.oid, obj: hh.object }; } }
    const pl = new T.Plane(new T.Vector3(0, 1, 0), 0); const pt = new T.Vector3(); if (rc.ray.intersectPlane(pl, pt)) return { point: pt, oid: null }; return null;
  }
  function pick(e) {
    const c = curClip(); if (!c) return; V.cv.focus();
    if (V.pathDraw) { const hh = rayAt(e); if (hh) { const o = O.obj(c, V.pathDraw); if (o) { const w = o.walk; const p = [r3(hh.point.x), r3(hh.point.z)]; if (V.snap) { p[0] = Math.round(p[0] * 20) / 20; p[1] = Math.round(p[1] * 20) / 20; } w.pts.push(p); GW.invalidate(); V.dirty(); renderInsp(); } } return; }
    const hh = rayAt(e); const hit = hh && hh.oid; const o = hit && O.obj(c, hit);
    O.select(c, o ? o.id : null); renderTree(); renderInsp(); V.dirty();
  }
  V.startPath = (oid) => { const c = curClip(); const o = O.obj(c, oid); if (!o) return; O.setWalk(c, o, { pts: [], on: 1 }); V.pathDraw = oid; setView('free'); GW.toast('انقر على الأرض لإضافة نقاط المسار، ثم انقر مرتين أو اضغط Enter للإنهاء'); V.dirty(); renderInsp(); };
  function finishPath() { const c = curClip(); const o = O.obj(c, V.pathDraw); V.pathDraw = null; if (o && o.walk && o.walk.pts.length >= 2) { const w = S.walkEval(o.walk, 0); GW.commit('مسار المشي'); GW.toast('المسار: ' + (w ? w.L.toFixed(1) + ' م، ' + w.T.toFixed(1) + ' ث' : '')); } else if (o && o.walk) { o.walk.on = 0; GW.toast('المسار يحتاج نقطتين على الأقل'); } V.dirty(); renderInsp(); }
  function focusSel() { const c = curClip(); if (!c || !S.T) return; const T = S.T; const rt = S.rtOf(c); const o = O.obj(c); const n = o ? rt.nodes.get(o.id) && rt.nodes.get(o.id).node : rt.root; if (!n) return; const box = new T.Box3().setFromObject(n); if (box.isEmpty()) return; const ctr = box.getCenter(new T.Vector3()); const r = box.getSize(new T.Vector3()).length() * .6 + .3; setView('free'); const dir = V.freeCam.position.clone().sub(V.orbit.target).normalize(); V.orbit.target.copy(ctr); V.freeCam.position.copy(ctr.clone().add(dir.multiplyScalar(r / Math.tan(25 * D2R)))); V.orbit.update(); V.dirty(); }
  V.render = () => {
    if (!V.el || !GW.isShown('3dview')) return;
    const c = curClip(); const st = V.stage.getBoundingClientRect(); const dpr = Math.min(1.5, devicePixelRatio || 1);
    const W = Math.max(2, Math.round(st.width * dpr)), H = Math.max(2, Math.round(st.height * dpr));
    if (V.cv.width !== W || V.cv.height !== H) { V.cv.width = W; V.cv.height = H; }
    const g = V.cv.getContext('2d'); g.fillStyle = '#0b0d10'; g.fillRect(0, 0, W, H);
    V.empty.hidden = !!(c && S.T);
    if (!S.T) { V.empty.innerHTML = `<div>${ico('cube3d', 28)}<b>جارٍ تحميل محرك ثلاثي الأبعاد…</b></div>`; return; }
    if (!c) { V.empty.innerHTML = `<div>${ico('cube3d', 32)}<b>لا يوجد مشهد ثلاثي الأبعاد</b><span>أنشئ مشهدًا من قالب، أو أضف عنصرًا من المكتبة وسيُنشأ المشهد تلقائيًا.</span><div class="v3-tpls">${S.TEMPLATES.map(([k, n]) => `<button class="chip" data-t="${k}">${esc(n)}</button>`).join('')}</div></div>`; V.empty.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { O.addScene(b.dataset.t); refreshAll(); }); V.hud.innerHTML = ''; return; }
    ensureControls(); const T = S.T; const lt = ltOf(c); const s = GW.seq(); const asp = (c.sw || s.w) / (c.sh || s.h);
    // camera view: letterboxed to the clip aspect, navigation edits the scene camera at the playhead
    let rect = { x: 0, y: 0, w: W, h: H }; let cam;
    const rt = S.apply(c, lt, { aspect: asp });
    if (V.view === 'cam') {
      if (W / H > asp) { const w = Math.round(H * asp); rect = { x: (W - w) >> 1, y: 0, w, h: H }; } else { const hh = Math.round(W / asp); rect = { x: 0, y: (H - hh) >> 1, w: W, h: hh }; }
      cam = V.proxy; if (!V.orbit.enabled || !V.dragCam) { V.syncing = true; V.proxy.position.copy(rt.cam.position); V.proxy.quaternion.copy(rt.cam.quaternion); V.proxy.fov = rt.cam.fov; const tg = pv(c.s3d.cam.target, lt); V.orbit.object = V.proxy; V.orbit.target.set(tg[0], tg[1], tg[2]); V.orbit.update(); V.proxy.position.copy(rt.cam.position); V.proxy.quaternion.copy(rt.cam.quaternion); V.syncing = false; }
    } else { cam = V.freeCam; if (V.orbit.object !== V.freeCam) { V.syncing = true; V.orbit.object = V.freeCam; V.orbit.update(); V.syncing = false; } }
    V.tc.camera = cam; V.lastCam = cam; V.lastRect = { x: rect.x / dpr, y: rect.y / dpr, w: rect.w / dpr, h: rect.h / dpr };
    // gizmo on the selection
    const o = O.obj(c); const e = o && rt.nodes.get(o.id); const node = e && e.node;
    if (V.boneEdit && node && o.t === 'model') { const b = (node.userData.bones || []).find(x => x.name === V.boneEdit); if (b) { if (V.tcBone !== b) { V.tcBone = b; } const pq = o.pose && o.pose[b.name] ? pv(o.pose[b.name], lt) : [0, 0, 0]; V.boneBase = b.quaternion.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(pq[0] * D2R, pq[1] * D2R, pq[2] * D2R, 'XYZ')).invert()); if (V.tc.object !== b) V.tc.attach(b); V.tc.setMode('rotate'); V.tc.setSpace('local'); } }
    else { V.tcBone = null; V.tc.setSpace('world'); V.tc.setMode(V.mode); if (node && !o.lock && !o.hide && !(o.walk && o.walk.on && V.mode === 'translate')) { if (V.tc.object !== node) V.tc.attach(node); V.tcNode = node; } else { if (V.tc.object) V.tc.detach(); V.tcNode = null; } }
    // helpers: grid, light aim lines, walking paths, motion trail
    V.gridH.visible = V.grid && V.view === 'free'; disposeLines(); const LG = new T.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: .7, depthTest: false });
    const line = (pts, mat) => { const gg = new T.BufferGeometry().setFromPoints(pts.map(p => new T.Vector3(p[0], p[1], p[2]))); const l = new T.Line(gg, mat || LG); l.renderOrder = 999; V.lines.add(l); return l; };
    for (const ob of c.s3d.objs) {
      if (ob.hide) continue;
      if (ob.light && ob.light.target && /spot|sun|area/.test(ob.t)) line([pv(ob.pos, lt), pv(ob.light.target, lt)]);
      if (ob.walk && ob.walk.pts && ob.walk.pts.length) { const pts = []; if (ob.walk.pts.length >= 2) { const w = S.walkEval(ob.walk, 0); if (w && ob.walk._c) for (let i = 0; i <= 64; i++) { const p = ob.walk._c.getPointAt(i / 64); pts.push([p.x, .02, p.z]); } } else pts.push([ob.walk.pts[0][0], .02, ob.walk.pts[0][1]]); if (pts.length > 1) line(pts, new T.LineDashedMaterial({ color: 0x4cc2ff, dashSize: .15, gapSize: .08, depthTest: false })).computeLineDistances(); for (const p of ob.walk.pts) { const m = new T.Mesh(new T.SphereGeometry(.05, 10, 6), new T.MeshBasicMaterial({ color: 0x4cc2ff, depthTest: false })); m.position.set(p[0], .02, p[1]); m.renderOrder = 999; V.lines.add(m); } }
    }
    if (V.trail && o && (GW.isAnim(o.pos) || (o.walk && o.walk.on))) { const pts = []; for (let i = 0; i <= 60; i++) { const tt = c.dur * i / 60; let p = pv(o.pos, tt); if (o.walk && o.walk.on) { const w = S.walkEval(o.walk, tt); if (w) p = [w.x, p[1], w.z]; } pts.push([p[0], p[1] + .03, p[2]]); } line(pts, new T.LineBasicMaterial({ color: 0xff6a2b, transparent: true, opacity: .8, depthTest: false })); }
    if (V.view === 'free') { const cp = pv(c.s3d.cam.pos, lt), ctg = pv(c.s3d.cam.target, lt); line([cp, ctg], new T.LineDashedMaterial({ color: 0x9aa4b2, dashSize: .1, gapSize: .1, depthTest: false })).computeLineDistances(); const m = new T.Mesh(new T.ConeGeometry(.12, .25, 4), new T.MeshBasicMaterial({ color: 0x9aa4b2, wireframe: true })); m.position.set(...cp); m.lookAt(...ctg); m.rotateX(Math.PI / 2); V.lines.add(m); }
    V.extra.remove(V.tcHelper || V.extra); V.tcHelper = V.tc.getHelper ? V.tc.getHelper() : V.tc; V.extra.add(V.tcHelper);
    const cv = S.render(c, lt, rect.w, rect.h, { camera: V.view === 'free' ? cam : null, extra: V.extra, helpers: true, live: false });
    if (V.view === 'cam') { V.proxy.aspect = asp; V.proxy.updateProjectionMatrix(); }
    if (cv) g.drawImage(cv, rect.x, rect.y, rect.w, rect.h);
    if (V.view === 'cam') { g.strokeStyle = 'rgba(255,106,43,.6)'; g.lineWidth = 1; g.strokeRect(rect.x + .5, rect.y + .5, rect.w - 1, rect.h - 1); }
    const tx = GW.fmtTC ? GW.fmtTC(s.t, s.fps) : s.t.toFixed(2);
    V.hud.innerHTML = `<span class="v3-pill">${ico(V.view === 'cam' ? 'camera' : 'orbit', 12)} ${V.view === 'cam' ? 'عرض الكاميرا' : 'عرض حر'}</span><span class="v3-pill mono">${esc(tx)}</span>${o ? `<span class="v3-pill">${ico(KIND_ICO(o), 12)} ${esc(o.name)}${o.lock ? ' ' + ico('lock', 11) : ''}</span>` : ''}${V.pathDraw ? '<span class="v3-pill hot">رسم مسار المشي: انقر على الأرض، Enter للإنهاء</span>' : ''}${V.boneEdit ? `<span class="v3-pill hot">${ico('bone', 12)} ${esc(V.boneEdit)}</span>` : ''}`;
  };
  function disposeLines() { for (const l of [...V.lines.children]) { V.lines.remove(l); l.geometry.dispose(); if (l.material) l.material.dispose(); } }

  /* ================= outliner ================= */
  const TR = {};
  GW.registerPanel('3dtree', 'عناصر المشهد', (el) => { TR.el = el; el.innerHTML = '<div class="v3-tree"></div>'; renderTree(); });
  function treeInto(root) {
    const c = curClip(); root.innerHTML = '';
    if (!c) { root.innerHTML = `<div class="v3-empty-s">${ico('outline3d', 20)}<span>لا يوجد مشهد ثلاثي الأبعاد</span></div>`; return; }
    const cs = S.clipsIn(); const hd = h('div', 'v3-th');
    if (cs.length > 1) hd.append(sel(cs.map(x => [x.id, x.name]), c.id, (id) => { const x = GW.clipById(id); GW.sel.clips.clear(); GW.sel.clips.add(id); O.select(x, null); GW.bus.emit('selection'); if (GW.seq().t < x.start || GW.seq().t >= x.start + x.dur) GW.seek(x.start); refreshAll(); }));
    else hd.append(h('b', '', esc(c.name)));
    const sc = h('button', 'v3-row-scene' + (!S.sel.obj ? ' on' : ''), `${ico('settings', 13)}<span>المشهد والكاميرا</span>`); sc.onclick = () => { O.select(c, null); refreshAll(); }; hd.append(sc); root.append(hd);
    const groups = [['rooms', 'الغرف'], ['furniture', 'الأثاث'], ['screens', 'الشاشات'], ['models', 'النماذج'], ['prims', 'أشكال ونصوص'], ['lights', 'الإضاءة']];
    const catOf = (o) => o.t === 'model' ? 'models' : o.t === 'text' ? 'prims' : (S.LIB[o.t] || {}).cat || 'prims';
    for (const [k, n] of groups) {
      const list = c.s3d.objs.filter(o => catOf(o) === k); if (!list.length) continue;
      root.append(h('div', 'v3-tg', `${esc(n)} <i>${list.length}</i>`));
      for (const o of list) {
        const r = h('div', 'v3-ti' + (S.sel.obj === o.id ? ' sel' : '') + (o.hide ? ' off' : '')); r.dataset.id = o.id;
        r.innerHTML = `${ico(KIND_ICO(o), 14)}<span class="nm">${esc(o.name)}</span>${o.screen && (o.screen.media || o.screen.seq) ? `<span class="v3-badge">${ico('film', 11)}</span>` : ''}${o.anim || o.walk ? `<span class="v3-badge">${ico('walk', 11)}</span>` : ''}<button class="v3-ib" data-a="eye" title="${o.hide ? 'إظهار' : 'إخفاء'}">${ico(o.hide ? 'eyeoff' : 'eye', 13)}</button><button class="v3-ib${o.lock ? ' on' : ''}" data-a="lock" title="${o.lock ? 'إلغاء القفل' : 'قفل'}">${ico('lock', 13)}</button>`;
        r.onclick = (e) => { const a = e.target.closest('[data-a]'); if (a) { if (a.dataset.a === 'eye') o.hide = o.hide ? 0 : 1; else o.lock = o.lock ? 0 : 1; GW.commit(a.dataset.a === 'eye' ? 'إظهار/إخفاء' : 'قفل'); GW.invalidate(); refreshAll(); return; } O.select(c, o.id); refreshAll(); };
        r.ondblclick = () => rename(c, o);
        r.oncontextmenu = (e) => { e.preventDefault(); O.select(c, o.id); refreshAll(); GW.menu(e.clientX, e.clientY, objMenu(c, o)); };
        root.append(r);
      }
    }
  }
  function objMenu(c, o) { return [{ label: 'إعادة تسمية…', action: () => rename(c, o) }, { label: 'تكرار', key: 'Ctrl+D', action: () => { O.dupObj(c, o); refreshAll(); } }, { label: o.hide ? 'إظهار' : 'إخفاء', action: () => { o.hide = o.hide ? 0 : 1; GW.commit('إظهار/إخفاء'); refreshAll(); } }, { label: o.lock ? 'إلغاء القفل' : 'قفل', action: () => { o.lock = o.lock ? 0 : 1; GW.commit('قفل'); refreshAll(); } }, { label: 'تأطير في العرض', action: focusSel }, ...(o.screen ? [{ label: 'اقتراب الكاميرا إلى هذه الشاشة', action: () => { O.camPreset(c, 'push', { obj: o.id }); refreshAll(); } }] : []), '-', { label: 'حذف', key: 'Delete', action: () => { O.delObj(c, o); refreshAll(); } }]; }
  async function rename(c, o) { const n = await GW.prompt('إعادة تسمية', 'الاسم', o.name); if (n) { o.name = n; GW.commit('إعادة تسمية'); refreshAll(); } }
  function renderTree() { if (TR.el && GW.isShown('3dtree')) treeInto(TR.el.firstChild); if (IN.tree && GW.isShown('3dprops')) treeInto(IN.tree); }

  /* ================= inspector ================= */
  const IN = {};
  GW.registerPanel('3dprops', 'خصائص ثلاثي الأبعاد', (el) => { IN.el = el; el.innerHTML = '<div class="v3-props"><div class="v3-tree v3-tree-mini"></div><div class="v3-insp"></div></div>'; IN.tree = el.querySelector('.v3-tree'); IN.body = el.querySelector('.v3-insp'); renderTree(); renderInsp(); });
  function renderInsp() {
    if (!IN.body || !GW.isShown('3dprops')) return; const sc = IN.body.scrollTop; const B = IN.body; B.innerHTML = '';
    const c = curClip(); if (!c) { B.innerHTML = `<div class="v3-empty-s">${ico('cube3d', 22)}<span>أضف مشهدًا ثلاثي الأبعاد من «رسومات ▸ مشهد ثلاثي الأبعاد جديد» أو من المكتبة.</span></div>`; return; }
    const o = O.obj(c); if (o) objInsp(B, c, o); else sceneInsp(B, c); B.scrollTop = sc;
  }
  function sceneInsp(B, c) {
    const d = c.s3d; B.append(h('div', 'v3-ih', `${ico('cube3d', 16)}<b>${esc(c.name)}</b><span>${d.objs.length} عنصر</span>`));
    const cs = section('الكاميرا', 'camera', 'cam'); cs.body.append(vecRow('الموضع', c, d.cam.pos), vecRow('الهدف', c, d.cam.target), numRow('مجال الرؤية', c, d.cam.fov, { step: .1, min: 5, max: 120, unit: '°', dec: 1 }), numRow('الميلان', c, d.cam.roll, { step: .1, unit: '°', dec: 1 }));
    const pr = h('div', 'v3-chips'); for (const [k, n] of S.CAM_PRESETS) { const b = h('button', 'chip', esc(n)); b.onclick = () => { if (!O.camPreset(c, k, { start: Math.min(ltOf(c), c.dur - .5) > .05 ? ltOf(c) : 0 })) GW.toast('حدد شاشة أولاً (أو أضف تلفازًا) لحركة «اقتراب إلى الشاشة»'); refreshAll(); }; pr.append(b); }
    cs.body.append(h('div', 'v3-sub', 'حركات جاهزة (من موضع المؤشر حتى نهاية المقطع)'), pr); B.append(cs);
    const ls = section('الإضاءة والجو', 'sun', 'light'); const lp = h('div', 'v3-chips'); for (const [k, n] of S.LIGHT_PRESETS) { const b = h('button', 'chip', esc(n)); b.onclick = () => { O.lightPreset(d, k); GW.commit('إضاءة: ' + n); GW.invalidate(); refreshAll(); }; lp.append(b); }
    ls.body.append(h('div', 'v3-sub', 'قوالب الإضاءة (تستبدل أضواء القالب السابق)'), lp);
    ls.body.append(numRow('التعريض', c, d.exposure, { step: .01, min: -3, max: 4 }));
    ls.body.append(plainRow('بيئة HDRI', (() => { const w = h('span', 'v3-inl'); w.append(chk(d.env.on, v => { d.env.on = v ? 1 : 0; GW.commit('بيئة'); refreshAll(); })); return w; })()), numRow('شدة البيئة', c, d.env.int, { step: .01, min: 0, max: 3 }));
    ls.body.append(plainRow('الخلفية', (() => { const w = h('span', 'v3-inl'); w.append(sel([['color', 'لون'], ['transparent', 'شفافة'], ['env', 'البيئة']], d.bg.mode, v => { d.bg.mode = v; GW.commit('خلفية'); refreshAll(); }), color(d.bg.color, (v, fin) => { d.bg.color = v; GW.invalidate(); V.dirty(); if (fin) GW.commit('لون الخلفية'); })); return w; })()));
    ls.body.append(plainRow('ضباب', (() => { const w = h('span', 'v3-inl'); w.append(chk(d.fog.on, v => { d.fog.on = v ? 1 : 0; GW.commit('ضباب'); refreshAll(); }), color(d.fog.color, (v, fin) => { d.fog.color = v; GW.invalidate(); V.dirty(); if (fin) GW.commit('لون الضباب'); })); return w; })()), numRow('كثافة الضباب', c, d.fog.density, { step: .001, min: 0, max: .5, dec: 3 }));
    ls.body.append(plainRow('الظلال', chk(d.shadows !== 0, v => { d.shadows = v ? 1 : 0; GW.commit('ظلال'); refreshAll(); }))); B.append(ls);
    const fx = section('تأثيرات العدسة', 'sparkle', 'post');
    fx.body.append(plainRow('توهج (Bloom)', chk(d.bloom.on, v => { d.bloom.on = v ? 1 : 0; GW.commit('توهج'); refreshAll(); })), numRow('قوة التوهج', c, d.bloom.strength, { step: .01, min: 0, max: 3 }));
    fx.body.append(plainRow('عمق الميدان', chk(d.dof.on, v => { d.dof.on = v ? 1 : 0; GW.commit('عمق الميدان'); refreshAll(); })), numRow('مسافة التركيز', c, d.dof.focus, { step: .01, min: .1, max: 100, unit: ' م' }), numRow('فتحة العدسة', c, d.dof.aperture, { step: .01, min: 0, max: 20 })); B.append(fx);
  }
  function objInsp(B, c, o) {
    const L = S.LIB[o.t]; const lt = ltOf(c);
    const hd = h('div', 'v3-ih'); hd.innerHTML = `${ico(KIND_ICO(o), 16)}`; const nm = h('input', 'inp'); nm.value = o.name; nm.onchange = () => { o.name = nm.value || o.name; GW.commit('إعادة تسمية'); renderTree(); }; hd.append(nm);
    const back = h('button', 'btn sm ico ghost', ico('settings', 14)); back.title = 'خصائص المشهد'; back.onclick = () => { O.select(c, null); refreshAll(); }; hd.append(back); B.append(hd);
    const ts = section('التحويل', 'move3d', 'xf'); ts.body.append(vecRow('الموضع (م)', c, o.pos), vecRow('الدوران (°)', c, o.rot, { step: .5, dec: 1 }), vecRow('المقياس', c, o.scl));
    const tb = h('div', 'v3-chips'); [['ضبط على الأرض', () => { const p = GW.clone(pv(o.pos, lt)); p[1] = 0; GW.setPv(o.pos, lt, p); }], ['تصفير الدوران', () => GW.setPv(o.rot, lt, [0, 0, 0])], ['مقياس 1', () => GW.setPv(o.scl, lt, [1, 1, 1])]].forEach(([n, f]) => { const b = h('button', 'chip', n); b.onclick = () => { f(); GW.commit(n); refreshAll(); GW.invalidate(); }; tb.append(b); }); ts.body.append(tb); B.append(ts);
    if (L && L.p) { const ss = section('الأبعاد', 'scale3d', 'size'); for (const k of Object.keys(L.p)) { const nmk = { w: 'العرض', d: 'العمق', h: 'الارتفاع' }[k] || k; ss.body.append(plainRow(nmk + ' (م)', numIn(() => (o.p && o.p[k] != null ? o.p[k] : L.p[k]), (v, fin) => { o.p = Object.assign({}, L.p, o.p || {}); o.p[k] = Math.max(.2, Math.round(v * 100) / 100); GW.invalidate(); V.dirty(); if (fin) { GW.commit('الأبعاد'); renderInsp(); } }, { step: .02, min: .2 }))); } B.append(ss); }
    if (o.screen) {
      const ss = section('الشاشة', 'tv', 'screen'); const media = GW.prj.media.filter(m => m.kind === 'video' || m.kind === 'image'); const seqs = GW.prj.seqs.filter(x => x !== GW.seq());
      const val = o.screen.media ? 'm:' + o.screen.media : o.screen.seq ? 's:' + o.screen.seq : '';
      const opts = [['', 'بدون (شاشة مطفأة)'], ...media.map(m => ['m:' + m.id, (m.kind === 'video' ? 'فيديو: ' : 'صورة: ') + m.name]), ...seqs.map(x => ['s:' + x.id, 'تسلسل: ' + x.name])];
      ss.body.append(plainRow('المحتوى', sel(opts, val, (v) => { O.setScreen(c, o, v.startsWith('m:') ? { media: v.slice(2) } : v.startsWith('s:') ? { seq: v.slice(2) } : { media: null, seq: null }); refreshAll(); })));
      ss.body.append(h('div', 'v3-sub', 'أو اسحب فيديو/صورة من لوحة المشروع وأفلته على الشاشة في العرض ثلاثي الأبعاد.'));
      const S2 = o.screen; const sset = (k, v, fin) => { S2[k] = v; GW.invalidate(); V.dirty(); if (fin) GW.commit('الشاشة'); };
      ss.body.append(plainRow('بداية المصدر (ث)', numIn(() => S2.in, (v, fin) => sset('in', Math.max(0, v), fin), { step: .04 })), plainRow('السرعة', numIn(() => S2.speed, (v, fin) => sset('speed', clamp(v, .1, 8), fin), { step: .01 })), plainRow('السطوع', numIn(() => S2.bright ?? 1, (v, fin) => sset('bright', clamp(v, 0, 4), fin), { step: .01 })));
      ss.body.append(plainRow('الملاءمة', sel([['cover', 'ملء (قص الزوائد)'], ['stretch', 'تمديد']], S2.fit || 'cover', v => sset('fit', v, true))), plainRow('تكرار', chk(S2.loop !== 0, v => sset('loop', v ? 1 : 0, true))));
      const pb = h('button', 'btn sm', `${ico('camera', 13)} اقتراب الكاميرا إلى الشاشة`); pb.onclick = () => { O.camPreset(c, 'push', { obj: o.id, start: ltOf(c) < c.dur - .5 ? ltOf(c) : 0 }); refreshAll(); }; ss.body.append(pb); B.append(ss);
    }
    if (o.light) {
      const ls = section('الضوء', 'bulb', 'lt'); const Lg = o.light; const kind = L && L.light ? L.light.kind : 'point';
      ls.body.append(plainRow('اللون', color(Lg.color, (v, fin) => { Lg.color = v; GW.invalidate(); V.dirty(); if (fin) GW.commit('لون الضوء'); })), numRow('الشدة', c, Lg.int, { step: kind === 'spot' || kind === 'point' ? .5 : .02, min: 0 }));
      if (kind === 'spot') ls.body.append(plainRow('زاوية المخروط', numIn(() => Lg.angle || 30, (v, fin) => { Lg.angle = clamp(v, 1, 85); GW.invalidate(); V.dirty(); if (fin) GW.commit('زاوية'); }, { step: .5, unit: '°', dec: 1 })), plainRow('نعومة الحافة', numIn(() => Lg.pen ?? .4, (v, fin) => { Lg.pen = clamp(v, 0, 1); GW.invalidate(); V.dirty(); if (fin) GW.commit('نعومة'); }, { step: .01 })));
      if (kind === 'point' || kind === 'spot') ls.body.append(plainRow('المدى (0 = بلا حد)', numIn(() => Lg.dist || 0, (v, fin) => { Lg.dist = Math.max(0, v); GW.invalidate(); V.dirty(); if (fin) GW.commit('مدى'); }, { step: .05 })));
      if (kind === 'area') ls.body.append(plainRow('العرض × الارتفاع', (() => { const w = h('span', 'v3-inl'); w.append(numIn(() => Lg.w || 1.2, (v, fin) => { Lg.w = Math.max(.05, v); GW.invalidate(); V.dirty(); if (fin) GW.commit('حجم'); }), numIn(() => Lg.h || .8, (v, fin) => { Lg.h = Math.max(.05, v); GW.invalidate(); V.dirty(); if (fin) GW.commit('حجم'); })); return w; })()));
      if (kind !== 'ambient' && kind !== 'area' || kind === 'area') { if (Lg.target) ls.body.append(vecRow('يتجه نحو', c, Lg.target)); }
      if (kind === 'sun' || kind === 'spot' || kind === 'point') ls.body.append(plainRow('يلقي ظلًا', chk(Lg.shadow, v => { Lg.shadow = v ? 1 : 0; GW.commit('ظل'); refreshAll(); })));
      B.append(ls);
    }
    const mains = (() => { const rt = S.rts.get(c.id); const e = rt && rt.nodes.get(o.id); return e ? e.node.userData.mains || [] : []; })();
    if (mains.length && o.t !== 'text') {
      const ms = section('الخامة', 'color', 'mat'); const mm = o.mat || {}; const base = mains[0].userData.base || {};
      const setM = (k, v, fin) => { o.mat = Object.assign(o.mat || {}, { [k]: v }); GW.invalidate(); V.dirty(); if (fin) GW.commit('الخامة'); };
      ms.body.append(plainRow('اللون', color(mm.color || '#' + (base.color || 0xffffff).toString(16).padStart(6, '0'), (v, fin) => setM('color', v, fin))));
      ms.body.append(plainRow('الخشونة', numIn(() => mm.rough ?? base.rough ?? .5, (v, fin) => setM('rough', clamp(v, 0, 1), fin), { step: .01 })), plainRow('المعدنية', numIn(() => mm.metal ?? base.metal ?? 0, (v, fin) => setM('metal', clamp(v, 0, 1), fin), { step: .01 })));
      const imgs = GW.prj.media.filter(m => m.kind === 'image'); ms.body.append(plainRow('صورة كخامة', sel([['', 'بدون'], ...imgs.map(m => [m.id, m.name])], mm.tex || '', v => setM('tex', v || null, true))));
      const rs = h('button', 'btn sm ghost', 'استعادة الخامة الأصلية'); rs.onclick = () => { delete o.mat; GW.commit('الخامة'); refreshAll(); }; ms.body.append(rs); B.append(ms);
    }
    if (o.text) {
      const xs = section('النص', 'text', 'txt'); const T2 = o.text; const ta = h('textarea', 'inp v3-ta'); ta.value = T2.str; ta.dir = 'auto'; ta.onchange = () => { T2.str = ta.value; GW.commit('نص ثلاثي الأبعاد'); refreshAll(); }; xs.body.append(ta);
      const tset = (k, v, fin) => { T2[k] = v; if (fin) { GW.commit('نص ثلاثي الأبعاد'); refreshAll(); } };
      xs.body.append(plainRow('الخط', sel(['Cairo', 'IBM Plex Sans Arabic', 'Amiri', 'Tajawal', 'Noto Kufi Arabic', 'Reem Kufi', 'Lalezar', 'Aref Ruqaa'].map(f => [f, f]), T2.font, v => tset('font', v, true))), plainRow('لون الواجهة', color(T2.color, (v, fin) => fin && tset('color', v, true))), plainRow('لون الجانب', color(T2.side, (v, fin) => fin && tset('side', v, true))));
      xs.body.append(plainRow('العمق (م)', numIn(() => T2.depth, (v, fin) => { T2.depth = clamp(v, 0, .5); if (fin) { GW.commit('عمق النص'); refreshAll(); } }, { step: .005, dec: 3 })), plainRow('الحجم', numIn(() => T2.size, (v, fin) => { T2.size = clamp(v, .05, 10); if (fin) { GW.commit('حجم النص'); refreshAll(); } }, { step: .01 })));
      B.append(xs);
    }
    if (o.t === 'model') charInsp(B, c, o);
    const an = section('الحركة والتنعيم', 'anim', 'smooth'); const ch = h('div', 'v3-chips');
    [['linear', 'خطي'], ['ease', 'تخفيف'], ['easeIn', 'تسارع'], ['easeOut', 'تباطؤ'], ['hold', 'ثبات']].forEach(([k, n]) => { const b = h('button', 'chip', n); b.title = 'تطبيق على كل مفاتيح العنصر'; b.onclick = () => { O.easeAll(o, k); refreshAll(); }; ch.append(b); });
    const sm = h('button', 'btn sm', `${ico('wand', 13)} تنعيم الحركة`); sm.title = 'يرشّح الاهتزاز من المفاتيح ويجعل الحركة انسيابية'; sm.onclick = () => { O.smooth(o); refreshAll(); };
    an.body.append(h('div', 'v3-sub', 'تخفيف المفاتيح'), ch, sm); B.append(an);
    const ac = h('div', 'v3-actions'); const du = h('button', 'btn sm', `${ico('copy', 13)} تكرار`); du.onclick = () => { O.dupObj(c, o); refreshAll(); }; const de = h('button', 'btn sm danger', `${ico('trash', 13)} حذف`); de.onclick = () => { O.delObj(c, o); refreshAll(); }; ac.append(du, de); B.append(ac);
  }
  /* ---------- characters: «حركات» strips, path walking, look-at, pose, retarget-lite ---------- */
  function charInsp(B, c, o) {
    const me = S.loadModel(o.model.ref); const rec = S.modelRec(o.model.ref);
    const cs = section('الشخصية والحركات', 'walk', 'char');
    if (me.status === 'load') { cs.body.append(h('div', 'v3-sub', 'جارٍ تحميل النموذج…')); me.p.then(() => renderInsp()); B.append(cs); return; }
    if (me.status === 'err') { cs.body.append(h('div', 'v3-warn', 'تعذر تحميل النموذج: ' + esc(me.err || '') + (rec ? '<br><span dir="ltr">' + esc(rec.path) + '</span>' : ''))); B.append(cs); return; }
    const clips = me.clips.map(k => k.name); const others = (GW.prj.models3d || []).filter(m => m.id !== o.model.ref);
    cs.body.append(h('div', 'v3-sub', clips.length ? `حركات مضمنة: ${clips.length} — ${esc(clips.slice(0, 6).join('، '))}${clips.length > 6 ? '…' : ''}` : 'لا توجد حركات مضمنة في هذا النموذج' + (me.skinned ? ' (يمكن استخدام حركات نموذج آخر بنفس أسماء العظام، أو وضعية يدوية بالأسفل).' : '.')));
    o.anim = o.anim || { inPlace: 1, strips: [] }; const A2 = o.anim;
    // mini track
    const trk = h('div', 'v3-atrack'); const cv = h('canvas'); trk.append(cv); cs.body.append(h('div', 'v3-sub', 'مسار «حركات»: اسحب المقاطع لتحريكها، والتداخل يمزج بينها'), trk);
    const drawTrk = () => { const w = trk.clientWidth || 280, hh = 24 + Math.max(1, A2.strips.length) * 0; cv.width = w * 2; cv.height = 64; cv.style.height = '32px'; const g = cv.getContext('2d'); g.scale(2, 2); g.clearRect(0, 0, w, 32); g.fillStyle = '#0f1216'; g.fillRect(0, 0, w, 32); const X = t => t / c.dur * w; A2.strips.forEach((s2, i) => { const x0 = X(s2.start), x1 = X(s2.start + s2.dur); g.fillStyle = ['#3d6ea8', '#3fae8f', '#b08bd8', '#d9823f'][i % 4]; g.globalAlpha = s2.on === 0 ? .35 : .85; g.fillRect(x0, 4 + (i % 2) * 12, Math.max(2, x1 - x0), 12); g.globalAlpha = 1; g.fillStyle = '#fff'; g.font = '10px sans-serif'; g.fillText(String(s2.clip || '').slice(0, 18), x0 + 3, 13 + (i % 2) * 12); }); if (o.walk && o.walk.on) { const w2 = S.walkEval(o.walk, 0); if (w2) { g.fillStyle = 'rgba(76,194,255,.5)'; g.fillRect(X(o.walk.start || 0), 28, X(w2.T), 3); } } g.fillStyle = '#ff6a2b'; g.fillRect(X(ltOf(c)), 0, 1.5, 32); void hh; };
    requestAnimationFrame(drawTrk);
    cv.onpointerdown = (e) => { const r = cv.getBoundingClientRect(); const t = (e.clientX - r.left) / r.width * c.dur; const i = A2.strips.findIndex((s2, k) => t >= s2.start && t <= s2.start + s2.dur && Math.abs((e.clientY - r.top) - (10 + (k % 2) * 12)) < 9); if (i < 0) return; const s2 = A2.strips[i], st0 = s2.start, x0 = e.clientX; cv.setPointerCapture(e.pointerId); cv.onpointermove = (ev) => { s2.start = Math.max(-s2.dur + .1, Math.round((st0 + (ev.clientX - x0) / r.width * c.dur) * 100) / 100); GW.invalidate(); V.dirty(); drawTrk(); }; cv.onpointerup = () => { cv.onpointermove = null; GW.commit('تحريك حركة'); renderInsp(); }; };
    for (const s2 of A2.strips) {
      const r = h('div', 'v3-strip'); const srcRef = s2.src || o.model.ref; const srcMe = S.loadModel(srcRef); const srcClips = srcMe.status === 'ok' ? srcMe.clips.map(k => k.name) : [];
      const top = h('div', 'v3-inl');
      top.append(sel(srcClips.map(n => [n, n]), s2.clip, v => { s2.clip = v; GW.commit('حركة'); refreshAll(); }));
      if (others.length) top.append(sel([['', 'من هذا النموذج'], ...others.map(m => [m.id, 'من: ' + m.name])], s2.src || '', v => { s2.src = v || undefined; if (v) { const m2 = S.loadModel(v); m2.p.then(() => { const mm2 = S.models.get(v); if (mm2 && mm2.clips.length && !mm2.clips.find(k => k.name === s2.clip)) s2.clip = mm2.clips[0].name; renderInsp(); }); } GW.commit('حركة من نموذج آخر'); refreshAll(); }));
      const del = h('button', 'v3-ib', ico('trash', 13)); del.title = 'حذف'; del.onclick = () => { A2.strips = A2.strips.filter(x => x !== s2); GW.commit('حذف حركة'); refreshAll(); }; top.append(del); r.append(top);
      if (s2.src) { const ri = S.retargetInfo(o.model.ref, s2.src, s2.clip); if (ri && !ri.ok) r.append(h('div', 'v3-warn', `أسماء العظام لا تتطابق (${ri.matched}/${ri.total}). تعمل الحركات المنقولة مع الهياكل المتطابقة مثل Mixamo.`)); else if (ri) r.append(h('div', 'v3-ok', `عظام متطابقة ${ri.matched}/${ri.total}`)); }
      const g2 = h('div', 'v3-grid4'); const f = (lbl, k, o2) => { const w = h('label', 'v3-mini'); w.append(h('span', '', lbl), numIn(() => s2[k], (v, fin) => { s2[k] = o2.fix ? o2.fix(v) : v; GW.invalidate(); V.dirty(); drawTrk(); if (fin) GW.commit('حركة'); }, o2)); return w; };
      g2.append(f('البداية', 'start', { step: .02 }), f('المدة', 'dur', { step: .02, fix: v => Math.max(.1, v) }), f('السرعة', 'speed', { step: .01, fix: v => clamp(v, .05, 5) }), f('مزج', 'fade', { step: .01, fix: v => clamp(v, 0, 3) }), f('إزاحة', 'off', { step: .02 }));
      const lp = h('label', 'v3-mini'); lp.append(h('span', '', 'تكرار'), chk(s2.loop !== 0, v => { s2.loop = v ? 1 : 0; GW.commit('تكرار'); refreshAll(); })); g2.append(lp); r.append(g2); cs.body.append(r);
    }
    const addS = h('button', 'btn sm', `${ico('plus', 13)} إضافة حركة`); addS.disabled = !clips.length && !others.length;
    addS.onclick = () => { const last = A2.strips[A2.strips.length - 1]; const st = last ? Math.max(0, last.start + last.dur - .3) : ltOf(c); const name = clips[0] || (others[0] && S.models.get(others[0].id) && S.models.get(others[0].id).clips[0] && S.models.get(others[0].id).clips[0].name); A2.strips.push({ id: GW.uid(), clip: name, src: clips.length ? undefined : others[0] && others[0].id, start: Math.round(st * 100) / 100, dur: 2, speed: 1, loop: 1, fade: .3, off: 0 }); GW.commit('إضافة حركة'); refreshAll(); };
    cs.body.append(addS, plainRow('ثبات في المكان', chk(A2.inPlace !== 0, v => { A2.inPlace = v ? 1 : 0; GW.commit('حركة في المكان'); refreshAll(); })));
    B.append(cs);
    // path walking
    const ws = section('امشِ على مسار', 'walk', 'walk'); const w = o.walk;
    const draw = h('button', 'btn sm' + (V.pathDraw === o.id ? ' pri' : ''), `${ico('route', 13)} ${V.pathDraw === o.id ? 'إنهاء الرسم' : w && w.pts.length ? 'إعادة رسم المسار' : 'ارسم المسار على الأرض'}`);
    draw.onclick = () => { if (V.pathDraw === o.id) finishPath(); else { GW.showPanel('3dview'); V.startPath(o.id); } renderInsp(); }; ws.body.append(draw);
    if (w) {
      const wv = S.walkEval(w, 0); if (wv) ws.body.append(h('div', 'v3-sub', `الطول ${wv.L.toFixed(2)} م · المدة ${wv.T.toFixed(2)} ث · ${w.pts.length} نقاط`));
      const wset = (k, v, fin) => { w[k] = v; GW.invalidate(); V.dirty(); if (fin) { GW.commit('مسار المشي'); renderInsp(); } };
      ws.body.append(plainRow('مفعّل', chk(w.on, v => wset('on', v ? 1 : 0, true))), plainRow('يبدأ عند (ث)', numIn(() => w.start || 0, (v, fin) => wset('start', Math.max(0, v), fin), { step: .02 })), plainRow('السرعة (م/ث)', numIn(() => w.speed, (v, fin) => wset('speed', clamp(v, .1, 10), fin), { step: .01 })), plainRow('تسارع/تباطؤ (ث)', numIn(() => w.ease ?? .6, (v, fin) => wset('ease', clamp(v, 0, 5), fin), { step: .01 })), plainRow('طول الخطوة الكاملة (م)', numIn(() => w.stride || 1.4, (v, fin) => wset('stride', clamp(v, .2, 5), fin), { step: .01 })));
      if (clips.length) ws.body.append(plainRow('حركة المشي', sel(clips.map(n => [n, n]), w.clip, v => wset('clip', v, true))), plainRow('حركة الوقوف', sel([['', 'بدون'], ...clips.map(n => [n, n])], w.idle || '', v => wset('idle', v || null, true))));
      ws.body.append(h('div', 'v3-sub', 'تتبع سرعة الحركة المسافة المقطوعة فعليًا (طول الخطوة) فلا تنزلق القدمان، ويستدير الجسم مع اتجاه المسار.'));
      const clr = h('button', 'btn sm ghost', 'حذف المسار'); clr.onclick = () => { delete o.walk; GW.commit('حذف المسار'); refreshAll(); }; ws.body.append(clr);
    }
    B.append(ws);
    // look-at + pose
    const ls = section('النظر والوضعية', 'eye', 'look'); o.look = o.look || null;
    ls.body.append(plainRow('تتبع بالرأس', chk(o.look && o.look.on, v => { if (!o.look) o.look = { on: 1, target: P([0, 1.6, 4]), amount: P(1) }; o.look.on = v ? 1 : 0; GW.commit('النظر'); refreshAll(); })));
    if (o.look && o.look.on) { ls.body.append(vecRow('ينظر إلى', c, o.look.target), numRow('القوة', c, o.look.amount, { step: .01, min: 0, max: 1 })); const tc = h('button', 'chip', 'انظر إلى الكاميرا'); tc.onclick = () => { GW.setPv(o.look.target, ltOf(c), GW.clone(pv(c.s3d.cam.pos, ltOf(c)))); GW.commit('النظر إلى الكاميرا'); refreshAll(); }; ls.body.append(tc); }
    const rt = S.rts.get(c.id); const node = rt && rt.nodes.get(o.id) && rt.nodes.get(o.id).node; const bones = node ? (node.userData.bones || []).map(b => b.name) : [];
    if (bones.length) {
      ls.body.append(h('div', 'v3-sub', 'وضعية يدوية: اختر عظمة ثم دوّرها بالمقبض في العرض أو بالأرقام، وفعّل المفاتيح لتحريكها.'));
      ls.body.append(plainRow('العظمة', sel([['', 'اختر عظمة…'], ...bones.map(n => [n, n.replace(/^mixamorig:?/i, '')])], V.boneEdit || '', v => { V.boneEdit = v || null; if (!v && V.tc) V.tc.detach(); V.dirty(); renderInsp(); })));
      if (V.boneEdit) { o.pose = o.pose || {}; if (!o.pose[V.boneEdit]) o.pose[V.boneEdit] = P([0, 0, 0]); ls.body.append(vecRow('دوران العظمة', c, o.pose[V.boneEdit], { step: .5, dec: 1 })); const done = h('button', 'btn sm ghost', 'إنهاء تحرير العظمة'); done.onclick = () => { V.boneEdit = null; if (V.tc) V.tc.detach(); V.dirty(); renderInsp(); }; ls.body.append(done); }
    }
    B.append(ls);
  }

  /* ================= library ================= */
  const LB = { cat: 'rooms', thumbs: {} };
  GW.registerPanel('3dlib', 'مكتبة ثلاثي الأبعاد', (el) => { LB.el = el; renderLib(); });
  const THUMB_V = 'v3';
  function thumbKey(id) { return 'gws.s3d.th.' + THUMB_V + '.' + id; }
  function renderLib() {
    if (!LB.el) return; const el = LB.el; el.innerHTML = '';
    const top = h('div', 'v3-lbar'); top.dir = 'rtl';
    for (const [k, n] of S.CATS) { const b = h('button', 'chip' + (LB.cat === k ? ' on' : ''), esc(n)); b.onclick = () => { LB.cat = k; renderLib(); }; top.append(b); }
    el.append(top);
    const grid = h('div', 'v3-lgrid'); el.append(grid);
    if (LB.cat === 'models') return renderModels(el, grid);
    if (LB.cat === 'rooms') { const tp = h('div', 'v3-ltpl'); tp.append(h('span', '', 'مشهد كامل من قالب:')); for (const [k, n] of S.TEMPLATES) { const b = h('button', 'chip', esc(n)); b.onclick = () => { O.addScene(k); refreshAll(); }; tp.append(b); } el.insertBefore(tp, grid); }
    for (const L of Object.values(S.LIB).filter(x => x.cat === LB.cat)) grid.append(card(L.n, L.id, { t: L.id }, () => addLib(L.id)));
    pumpThumbs();
  }
  function card(name, tid, drag, onAdd, extra) {
    const d = h('div', 'v3-card'); d.draggable = true; d.title = name + ' — انقر للإضافة أو اسحب إلى العرض';
    const im = h('div', 'v3-thumb'); const cached = LB.thumbs[tid] || (() => { try { return localStorage.getItem(thumbKey(tid)); } catch (e) { return null; } })();
    if (cached) { LB.thumbs[tid] = cached; im.style.backgroundImage = `url(${cached})`; } else { im.classList.add('wait'); im.dataset.tid = tid; im.innerHTML = ico('cube3d', 22); }
    d.append(im, h('span', 'v3-cn', esc(name))); if (extra) d.append(extra);
    d.onclick = (e) => { if (e.target.closest('button')) return; onAdd(); };
    d.ondragstart = (e) => { e.dataTransfer.setData('application/x-gws-3d', JSON.stringify(drag)); e.dataTransfer.effectAllowed = 'copy'; };
    return d;
  }
  let pumping = false;
  async function pumpThumbs() {
    if (pumping || !S.T) { if (!S.T) S.ready.then(() => renderLib()); return; } pumping = true;
    try {
      for (let guard = 0; guard < 80; guard++) {
        const im = LB.el && LB.el.querySelector('.v3-thumb.wait'); if (!im) break; const tid = im.dataset.tid;
        await new Promise(r => setTimeout(r, 30)); let url = null; try { url = await S.thumb(tid); } catch (e) { console.warn('thumb', tid, e); }
        im.classList.remove('wait'); if (url) { LB.thumbs[tid] = url; im.innerHTML = ''; im.style.backgroundImage = `url(${url})`; if (!tid.startsWith('model:')) try { localStorage.setItem(thumbKey(tid), url); } catch (e) {} }
        else im.classList.add('none');
      }
    } finally { pumping = false; }
  }
  function renderModels(el, grid) {
    const bar = h('div', 'v3-mbar'); const imp = h('button', 'btn sm pri', `${ico('import', 14)} استيراد نموذج ثلاثي الأبعاد…`); imp.onclick = async () => { await O.importDialog(); renderLib(); refreshAll(); }; bar.append(imp, h('span', 'v3-sub', 'GLB / GLTF / OBJ+MTL / FBX / STL / PLY — أو اسحب الملفات إلى العرض ثلاثي الأبعاد'));
    el.insertBefore(bar, grid);
    const prj = GW.prj.models3d || [];
    if (prj.length) grid.append(h('div', 'v3-lh', 'في هذا المشروع'));
    for (const m of prj) { const me = S.models.get(m.id); const info = h('span', 'v3-cm', m.clips && m.clips.length ? `${m.clips.length} حركة` : (me && me.status === 'err' ? 'خطأ' : m.ext.toUpperCase())); grid.append(card(m.name, 'model:' + m.id, { model: m.id }, () => { const c = O.ensureClip(); O.addObj(c, 'model', { ref: m.id, name: m.name }); refreshAll(); }, info)); }
    const rem = O.remembered().filter(r => !prj.some(m => m.path === r.path));
    if (rem.length) { grid.append(h('div', 'v3-lh', 'نماذجي (من مشاريع سابقة)')); for (const r of rem) grid.append(card(r.name, 'remember:' + r.path, { model: 1, path: r.path, name: r.name, ext: r.ext }, async () => { const rec = await O.modelFromRemembered(r); const c = O.ensureClip(); O.addObj(c, 'model', { ref: rec.id, name: rec.name }); renderLib(); refreshAll(); })); }
    if (!prj.length && !rem.length) grid.append(h('div', 'v3-empty-s', `${ico('model3d', 22)}<span>لم تستورد أي نموذج بعد. تُنسخ النماذج المستوردة إلى مجلد «نماذج ثلاثية الأبعاد» بجانب المشروع حتى يبقى المشروع قابلًا للنقل.</span>`));
    el.append(h('div', 'v3-note', `<b>${ico('help', 13)} من أين أحصل على نماذج مجانية؟</b><span>نماذج بترخيص CC0 (مجانية حتى للاستخدام التجاري): <span dir="ltr">Poly Haven (polyhaven.com/models)</span>، <span dir="ltr">Kenney (kenney.nl/assets)</span>، <span dir="ltr">Quaternius (quaternius.com)</span>، و<span dir="ltr">Sketchfab</span> مع تفعيل فلتر «CC0 / Downloadable». للشخصيات المتحركة: <span dir="ltr">Mixamo</span> (حساب Adobe مجاني) — نزّل بصيغة FBX أو GLB «With Skin». تحقق دائمًا من ترخيص كل نموذج.</span>`));
    pumpThumbs();
  }
  S.thumb = async (tid) => {
    const T = S.T; const ren = S.renderer(); let obj, dispose = null;
    if (tid.startsWith('model:') || tid.startsWith('remember:')) { let ref = tid.slice(6); if (tid.startsWith('remember:')) return null; const me = S.loadModel(ref); await me.p; if (me.status !== 'ok') return null; obj = me.skinned ? T.X.SkeletonUtils.clone(me.obj) : me.obj.clone(true); }
    else { const L = S.LIB[tid]; if (!L) return null; const o = S.newObj(tid, {}); if (L.p) o.p = GW.clone(L.p); obj = L.build(S.K, o); dispose = obj; }
    const sc = new T.Scene(); sc.background = new T.Color('#1b1f25'); sc.environment = S.envTex(); sc.environmentIntensity = .6; sc.add(obj);
    const isLight = tid.startsWith('light:'); obj.traverse(x => { if (x.userData.vhelper) x.visible = true; });
    const hemi = new T.HemisphereLight(0xdfe8ff, 0x2a2622, .8); sc.add(hemi); const dl = new T.DirectionalLight(0xffffff, 2.2); dl.position.set(3, 6, 5); sc.add(dl);
    const box = new T.Box3().setFromObject(obj); if (box.isEmpty() || isLight) box.setFromCenterAndSize(new T.Vector3(0, .3, 0), new T.Vector3(.8, .8, .8));
    const ctr = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3()); const r = Math.max(sz.x, sz.y * 1.3, sz.z) * .62 + .05;
    const room = (S.LIB[tid] || {}).cat === 'rooms'; const cam = new T.PerspectiveCamera(room ? 55 : 35, 4 / 3, .02, 200);
    const dir = room ? new T.Vector3(.3, .2, 1).normalize() : new T.Vector3(.75, .55, 1).normalize(); cam.position.copy(ctr).add(dir.multiplyScalar(r / Math.tan((room ? 27 : 17.5) * D2R))); cam.lookAt(ctr);
    if (isLight) { const m = obj.children.find(x => x.isMesh) || obj; void m; }
    ren.setSize(192, 144, false); ren.toneMappingExposure = 1; ren.shadowMap.enabled = false; ren.render(sc, cam); const url = ren.domElement.toDataURL('image/jpeg', .82); ren.shadowMap.enabled = true;
    sc.remove(obj); if (dispose) dispose.traverse(x => { if (x.geometry && !x.geometry.userData.shared) x.geometry.dispose(); }); return url;
  };
  function addLib(t, at) {
    const c = O.ensureClip(); const L = S.LIB[t]; const lt = ltOf(c); let pos = null;
    if (at) pos = [r3(at.x), L && L.def && L.def.pos ? L.def.pos[1] : (at.y > .05 && L && L.cat !== 'rooms' ? r3(at.y) : 0), r3(at.z)];
    else if (L && L.cat !== 'rooms' && !(L.def && L.def.pos)) { const cp = pv(c.s3d.cam.pos, lt), tg = pv(c.s3d.cam.target, lt); pos = [r3(tg[0] + (cp[0] - tg[0]) * .25), 0, r3(tg[2] + (cp[2] - tg[2]) * .25)]; }
    if (L && L.cat === 'rooms') pos = [0, 0, 0];
    const o = O.addObj(c, t, pos ? { pos } : {}); if (L && L.p) o.p = GW.clone(L.p);
    if (t === 'text') o.rot = P([0, 0, 0]);
    GW.invalidate(); refreshAll(); return o;
  }
  S.addLib = addLib;

  /* ================= workspace, menus, Effect Controls ================= */
  GW.WS['3d'] = { n: 'ثلاثي الأبعاد', ico: 'cube3d', tip: 'ثلاثي الأبعاد: غرف وأثاث وشاشات تعرض فيديوهاتك، إضاءة، كاميرا متحركة ونماذج مستوردة', tl: ['3dview'], tr: ['program'], bl: ['3dlib', 'fxc', 'project'], br: ['timeline'], side: ['3dprops', '3dtree'], v: { '--c1': '56%', '--c4': '36%', '--r1': '60%', '--c3': '340px' } };
  if (GW.PANEL_ICO) Object.assign(GW.PANEL_ICO, { '3dview': 'cube3d', '3dtree': 'outline3d', '3dprops': 'settings', '3dlib': 'sofa' });
  const open3D = (key) => { if (key) O.addScene(key); if (GW.active.ws !== '3d') GW.setWorkspace('3d'); refreshAll(); };
  S.open = open3D;
  const wrapMenu = (name, fn) => { const e = GW.MENUS && GW.MENUS.find(m => m[0] === name); if (!e) return; const f = e[1]; e[1] = () => fn(f()); };
  const newItems = () => ({ label: 'مشهد ثلاثي الأبعاد جديد', sub: S.TEMPLATES.map(([k, n]) => ({ label: n, action: () => open3D(k) })) });
  wrapMenu('ملف', items => { const nw = items.find(x => x && x.label === 'جديد' && x.sub); if (nw) nw.sub = [...nw.sub, newItems()]; else items.push(newItems()); const ix = items.findIndex(x => x && x.label === 'استيراد…'); items.splice(ix >= 0 ? ix + 1 : items.length, 0, { label: 'استيراد نموذج ثلاثي الأبعاد…', action: () => { open3D(); O.importDialog(); } }); return items; });
  wrapMenu('رسومات', items => [...items, '-', newItems(), { label: 'استيراد نموذج ثلاثي الأبعاد…', action: () => { open3D(); O.importDialog(); } }, { label: 'فتح مساحة ثلاثي الأبعاد', action: () => open3D() }]);
  wrapMenu('نافذة', items => { const i = items.findIndex(x => x === '-' ); const add = ['3dview', '3dtree', '3dprops', '3dlib'].map(id => ({ label: GW.panels[id].title, action: () => GW.showPanel(id) })); const j = items.length - 2; items.splice(j > i ? j : items.length, 0, ...add); return items; });
  // Effect Controls: camera + selected object rows (keyframes appear in the lane / graph editor)
  const F = GW.FXC; if (F) { F.extra = F.extra || []; F.extra.push((Lp, c) => {
    if (c.kind !== 'scene3d' || !c.s3d) return; const B = F.builders; const sec = B.section('مشهد ثلاثي الأبعاد', { key: 's3d' });
    const btn = h('button', 'btn sm pri', `${ico('cube3d', 13)} فتح مساحة ثلاثي الأبعاد`); btn.onclick = () => { O.select(c, S.sel.obj); open3D(); }; sec.body.append(B.row(c, null, 'المحرر', btn, { noAnim: true }));
    const v3c = (p, step) => { const w = h('span', 'v3-vec'); [0, 1, 2].forEach(i => w.append(GW.scrub({ get: () => (pv(p, B.lt(c)) || [0, 0, 0])[i], set: (v, fin) => { const cur = GW.clone(pv(p, B.lt(c))); cur[i] = v; GW.setPv(p, clamp(B.lt(c), 0, c.dur), cur); GW.invalidate(); V.dirty(); if (fin) { GW.commit('تعديل خاصية'); F.render(); } else F.drawKeys(); }, step: step || .01, dec: 2 }))); return w; };
    const d = c.s3d; sec.body.append(B.row(c, d.cam.pos, 'موضع الكاميرا', v3c(d.cam.pos)), B.row(c, d.cam.target, 'هدف الكاميرا', v3c(d.cam.target)), B.row(c, d.cam.fov, 'مجال الرؤية', B.numCtl(c, d.cam.fov, { step: .1, min: 5, max: 120, unit: '°' })), B.row(c, d.exposure, 'التعريض', B.numCtl(c, d.exposure, { step: .01, dec: 2 })));
    const o = O.obj(c); if (o) { sec.body.append(B.row(c, o.pos, o.name + ': الموضع', v3c(o.pos)), B.row(c, o.rot, o.name + ': الدوران', v3c(o.rot, .5)), B.row(c, o.scl, o.name + ': المقياس', v3c(o.scl))); if (o.light) sec.body.append(B.row(c, o.light.int, o.name + ': الشدة', B.numCtl(c, o.light.int, { step: .05, dec: 2 }))); }
    Lp.append(sec);
  }); }

  if (GW.saveProject) { const save0 = GW.saveProject; GW.saveProject = async (as) => { const r = await save0(as); if (r && (GW.prj.models3d || []).length && await O.relocateModels()) return save0(false); return r; }; } // models follow the project
  /* ================= events ================= */
  GW.bus.on('s3d-sel', () => { renderTree(); renderInsp(); if (F && F.render && GW.isShown('fxc')) F.render(); });
  ['time', 'changed', 'hist', 'project', 'layout', 's3d-ready', 's3d-models', 'param'].forEach(ev => GW.bus.on(ev, () => V.dirty()));
  GW.bus.on('time', () => { if (IN.body && GW.isShown('3dprops')) { IN.body.querySelectorAll('.scrub').forEach(sc => sc.refresh && sc.refresh()); } });
  ['hist', 'project', 'selection', 'media'].forEach(ev => GW.bus.on(ev, () => { if (ev === 'selection') { const c = [...GW.sel.clips].map(i => GW.clipById(i)).find(x => x && x.kind === 'scene3d'); if (c && S.sel.clip !== c.id) { S.sel.clip = c.id; S.sel.obj = null; } } renderTree(); renderInsp(); }));
  GW.bus.on('s3d-models', () => { if (LB.cat === 'models') renderLib(); renderInsp(); });
  GW.bus.on('s3d-ready', () => { renderLib(); refreshAll(); });
  GW.bus.on('panel-shown', (id) => { if (id === '3dview') V.dirty(); if (id === '3dlib') renderLib(); if (id === '3dprops' || id === '3dtree') { renderTree(); renderInsp(); } });
  S.ui = { refresh: refreshAll, renderLib, view: V };
})();
