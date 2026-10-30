'use strict';
/* .cube LUTs for Lumetri: parser (1D / 3D, DOMAIN_MIN/MAX, sizes up to 65), cache by path (parsed data + GL texture),
   bundled looks in app/luts/, the Input/Creative LUT pickers (Effect Controls + Lumetri panel) and GW.API.applyLut.
   A Lumetri effect stores its slots as fx.lut = { in: {path, name}, cr: {path, name} }; intensities are the animatable
   params lutIn / lutCr. gl.js (R.lutPass) applies Input LUT → Lumetri basic correction → Creative LUT. */
(function () {
  const { esc, clamp } = GW;
  const api = () => window.gws;
  const L = GW.LUT = { cache: new Map() };
  // bundled looks: slot 'in' = technical camera-log input transforms, 'cr' = creative looks
  L.BUNDLED = [
    { path: 'luts/teal_orange.cube', n: 'تركوازي وبرتقالي', slot: 'cr', g: 'linear-gradient(90deg,#1d5560,#e09a55)' },
    { path: 'luts/film_warm.cube', n: 'فيلم دافئ', slot: 'cr', g: 'linear-gradient(90deg,#4a2c1a,#f0c890)' },
    { path: 'luts/bleach_bypass.cube', n: 'تبييض جزئي', slot: 'cr', g: 'linear-gradient(90deg,#2a2c2c,#c9c6bc)' },
    { path: 'luts/bw_contrast.cube', n: 'أبيض وأسود عالي التباين', slot: 'cr', g: 'linear-gradient(90deg,#000,#fff)' },
    { path: 'luts/cold_war_doc.cube', n: 'وثائقي الحرب الباردة', slot: 'cr', g: 'linear-gradient(90deg,#1c2a30,#a9c2c4)' },
    { path: 'luts/vintage_sepia.cube', n: 'سيبيا قديم', slot: 'cr', g: 'linear-gradient(90deg,#3a2614,#e6cfa2)' },
    { path: 'luts/slog3_to_rec709.cube', n: 'S-Log3 إلى Rec709 (تقريبي)', slot: 'in' },
    { path: 'luts/vlog_to_rec709.cube', n: 'V-Log إلى Rec709 (تقريبي)', slot: 'in' },
    { path: 'luts/clog3_to_rec709.cube', n: 'C-Log3 إلى Rec709 (تقريبي)', slot: 'in' }
  ];
  const builtin = p => /^luts\/[\w.-]+\.cube$/.test(p || '');
  L.nameOf = (p) => { const b = L.BUNDLED.find(x => x.path === p); return b ? b.n : String(p || '').split(/[\\/]/).pop().replace(/\.cube$/i, ''); };

  /* ---------- parser ---------- */
  L.parse = (text) => {
    let size3 = 0, size1 = 0, title = '', dmin = [0, 0, 0], dmax = [1, 1, 1]; const vals = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const ln = raw.replace(/#.*$/, '').trim(); if (!ln) continue;
      const c0 = ln.charCodeAt(0);
      if ((c0 >= 48 && c0 <= 57) || c0 === 45 || c0 === 46 || c0 === 43) { const p = ln.split(/\s+/); if (p.length < 3) throw new Error('سطر بيانات غير صالح في ملف LUT'); vals.push(+p[0], +p[1], +p[2]); continue; }
      const [k, ...a] = ln.split(/\s+/); const K = k.toUpperCase();
      if (K === 'TITLE') title = ln.slice(5).trim().replace(/^"|"$/g, '');
      else if (K === 'LUT_3D_SIZE') size3 = parseInt(a[0], 10);
      else if (K === 'LUT_1D_SIZE') size1 = parseInt(a[0], 10);
      else if (K === 'DOMAIN_MIN') dmin = a.slice(0, 3).map(Number);
      else if (K === 'DOMAIN_MAX') dmax = a.slice(0, 3).map(Number);
      else if (K === 'LUT_3D_INPUT_RANGE' || K === 'LUT_1D_INPUT_RANGE') { dmin = [+a[0], +a[0], +a[0]]; dmax = [+a[1], +a[1], +a[1]]; }
      // other keywords (LUT_IN_VIDEO_RANGE, …) are ignored
    }
    const d3 = size3 > 0; const N = d3 ? size3 : size1;
    if (!N) throw new Error('ملف LUT بلا حجم (LUT_3D_SIZE / LUT_1D_SIZE)');
    if (d3 && (N < 2 || N > 65)) throw new Error('حجم LUT ثلاثي الأبعاد غير مدعوم: ' + N + ' (2–65)');
    if (!d3 && (N < 2 || N > 65536)) throw new Error('حجم LUT أحادي البعد غير مدعوم: ' + N);
    const need = (d3 ? N * N * N : N) * 3;
    if (vals.length < need) throw new Error('بيانات LUT ناقصة: ' + vals.length / 3 + '/' + need / 3);
    if (vals.some(v => !isFinite(v)) || dmin.some(v => !isFinite(v)) || dmax.some(v => !isFinite(v))) throw new Error('قيم غير صالحة في ملف LUT');
    for (let i = 0; i < 3; i++) if (!(dmax[i] > dmin[i])) throw new Error('DOMAIN_MIN/MAX غير صالح');
    return { d3, N, title, dmin, dmax, data: new Float32Array(vals.slice(0, need)) };
  };
  // CPU reference (trilinear / linear) — same maths as the shaders; used by tests and the API
  L.sample = (lut, rgb) => {
    const N = lut.N, D = lut.data, x = [0, 1, 2].map(i => clamp((rgb[i] - lut.dmin[i]) / (lut.dmax[i] - lut.dmin[i]), 0, 1) * (N - 1));
    if (!lut.d3) return [0, 1, 2].map(ch => { const i0 = Math.floor(x[ch]), i1 = Math.min(N - 1, i0 + 1), f = x[ch] - i0; return D[i0 * 3 + ch] * (1 - f) + D[i1 * 3 + ch] * f; });
    const i0 = x.map(v => Math.min(N - 2, Math.floor(v))), f = x.map((v, i) => v - i0[i]); const out = [0, 0, 0];
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]); const o = (((i0[2] + dz) * N + (i0[1] + dy)) * N + (i0[0] + dx)) * 3;
      out[0] += D[o] * w; out[1] += D[o + 1] * w; out[2] += D[o + 2] * w;
    }
    return out;
  };

  /* ---------- cache by path ---------- */
  async function readText(p) {
    if (builtin(p)) { const r = await fetch(p); if (!r.ok) throw new Error('LUT غير موجود: ' + p); return r.text(); }
    if (api() && api().readText) return api().readText(p);
    if (api() && api().mediaUrl) { const r = await fetch(api().mediaUrl(p)); if (!r.ok) throw new Error('LUT غير موجود: ' + p); return r.text(); }
    throw new Error('LUT غير موجود: ' + p);
  }
  L.load = (p) => {
    let e = L.cache.get(p);
    if (!e) {
      e = { state: 'loading', lut: null, tex: null, err: null };
      e.promise = readText(p).then(t => { e.lut = L.parse(t); e.state = 'ok'; GW.invalidate && GW.invalidate(); return e.lut; })
        .catch(err => { e.state = 'err'; e.err = err.message || String(err); console.warn('LUT', p, e.err); if (!e.told) { e.told = 1; GW.toast && GW.toast('تعذر تحميل LUT: ' + L.nameOf(p) + ' — ' + e.err, 'err'); } return null; });
      L.cache.set(p, e);
    }
    return e.promise;
  };
  L.drop = (p) => { const e = L.cache.get(p); if (e && e.tex && GW.R.gl) GW.R.gl.deleteTexture(e.tex.tex); L.cache.delete(p); };
  // GL texture for a path (null while loading / on error → the pass is skipped and the frame re-rendered once loaded)
  L.tex = (p) => {
    const e = L.cache.get(p); if (!e) { L.load(p); return null; }
    if (e.state !== 'ok') return null;
    if (e.tex) return e.tex;
    const gl = GW.R.gl, u = e.lut, t = gl.createTexture();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (u.d3) {
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, u.N, u.N, u.N, 0, gl.RGB, gl.FLOAT, u.data);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_3D, null);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, u.N, 1, 0, gl.RGB, gl.FLOAT, u.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    return e.tex = { tex: t, d3: u.d3, N: u.N, dmin: u.dmin, dmax: u.dmax };
  };
  // every LUT path used anywhere in the project (all sequences → nested sequences are covered)
  L.paths = () => { const out = new Set(); for (const s of GW.prj.seqs) for (const c of s.clips) for (const f of (c.fx || [])) if (f.type === 'lumetri' && f.lut) for (const k of ['in', 'cr']) if (f.lut[k] && f.lut[k].path) out.add(f.lut[k].path); return [...out]; };
  // export: wait until every used LUT is parsed, so the first exported frames match the preview
  L.ready = async () => { const ps = L.paths(); if (ps.every(p => { const e = L.cache.get(p); return e && e.state !== 'loading'; })) return; await Promise.all(ps.map(p => L.load(p))); };
  GW.bus.on('project', () => { try { L.paths().forEach(p => L.load(p)); } catch (e) {} });

  /* ---------- model ops ---------- */
  L.lumetriOf = (c, create) => {
    let fx = (c.fx || []).find(f => f.type === 'lumetri');
    if (!fx && create) { fx = GW.newFx('lumetri'); c.fx = c.fx || []; c.fx.unshift(fx); }
    return fx || null;
  };
  L.setSlot = (fx, slot, path) => {
    if (!path) { if (fx.lut) { delete fx.lut[slot]; if (!fx.lut.in && !fx.lut.cr) delete fx.lut; } return; }
    fx.lut = fx.lut || {}; fx.lut[slot] = { path, name: L.nameOf(path) }; L.load(path);
    const k = slot === 'in' ? 'lutIn' : 'lutCr'; if (!fx.params[k]) fx.params[k] = GW.P(100);
  };
  L.importFile = async () => {
    if (api() && api().open) { const f = await api().open({ filter: 'cube', title: 'استيراد ملف LUT (.cube)' }); return f && f[0] ? f[0].path : null; }
    return null;
  };
  // validate before assigning (so a bad file is reported once, not on every frame)
  async function choose(fx, slot, path, label) {
    L.drop(path); const lut = await L.load(path); if (!lut) return false;
    L.setSlot(fx, slot, path); GW.commit(label || (slot === 'in' ? 'LUT الإدخال' : 'LUT إبداعي')); GW.invalidate(); return true;
  }

  /* ---------- UI: picker (select + intensity) ---------- */
  const st = document.createElement('style');
  st.textContent = `.lut-pick{display:flex;gap:6px;align-items:center;min-width:0;flex-wrap:wrap}.lut-pick select{max-width:180px;min-width:0}
  .lut-pick .lut-st{color:var(--mute);font-size:11px}.lut-pick .lut-st.err{color:#e5484d}
  .lut-looks{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:6px;margin:4px 0 8px}
  .lut-looks .look{cursor:pointer}.lut-looks .look.on{outline:2px solid var(--accent);outline-offset:1px}`;
  document.head.append(st);
  L.picker = (c, fx, slot, onChange) => {
    const w = document.createElement('span'); w.className = 'lut-pick'; w.dataset.lut = slot;
    const sl = document.createElement('select'); sl.className = 'sel'; sl.dataset.a = 'lut-' + slot;
    const add = (v, n) => { const o = document.createElement('option'); o.value = v; o.textContent = n; sl.append(o); };
    add('', 'بدون');
    const cur = fx && fx.lut && fx.lut[slot] && fx.lut[slot].path;
    const list = L.BUNDLED.filter(b => b.slot === slot).concat(L.BUNDLED.filter(b => b.slot !== slot));
    for (const b of list) add(b.path, b.n);
    if (cur && !L.BUNDLED.some(b => b.path === cur)) add(cur, L.nameOf(cur));
    add('__import', 'استيراد ملف .cube…');
    sl.value = cur || '';
    const stt = document.createElement('span'); stt.className = 'lut-st';
    const e = cur && L.cache.get(cur); if (e && e.state === 'err') { stt.textContent = 'ملف مفقود'; stt.classList.add('err'); stt.title = e.err; } else if (e && e.lut) stt.textContent = (e.lut.d3 ? '3D ' : '1D ') + e.lut.N + (e.lut.d3 ? '³' : '');
    sl.onchange = async () => {
      let p = sl.value;
      if (p === '__import') { p = await L.importFile(); if (!p) { sl.value = cur || ''; return; } }
      const f = fx || L.lumetriOf(c, true);
      if (!p) { L.setSlot(f, slot, null); GW.commit('إزالة LUT'); GW.invalidate(); }
      else if (!(await choose(f, slot, p))) { sl.value = cur || ''; return; }
      onChange && onChange();
    };
    w.append(sl, stt); return w;
  };
  // Effect Controls rows (ui_fxc.js fxBlock): picker row + keyframable intensity row per slot
  L.fxcRows = (sec, c, fx, row, numCtl) => {
    for (const [slot, k, n] of [['in', 'lutIn', 'LUT الإدخال'], ['cr', 'lutCr', 'LUT إبداعي']]) {
      sec.body.append(row(c, null, n, L.picker(c, fx, slot, () => GW.FXC.render()), { noAnim: true }));
      if (fx.lut && fx.lut[slot]) { const P = fx.params[k] || (fx.params[k] = GW.P(100)); sec.body.append(row(c, P, 'الشدة', numCtl(c, P, { min: 0, max: 100, step: .5, unit: '%' }), { def: 100 })); }
    }
  };
  // Lumetri panel section (ui_panels.js renderLum)
  L.panelRows = (f, c, fx, F, rerender) => {
    const lt = GW.seq().t - c.start;
    for (const [slot, k, n] of [['in', 'lutIn', 'LUT الإدخال'], ['cr', 'lutCr', 'LUT إبداعي']]) {
      f.append(F.frow(n, L.picker(c, fx, slot, rerender)));
      if (slot === 'cr') {
        const looks = document.createElement('div'); looks.className = 'lut-looks';
        for (const b of L.BUNDLED.filter(x => x.slot === 'cr')) { const d = document.createElement('div'); d.className = 'look' + (fx.lut && fx.lut.cr && fx.lut.cr.path === b.path ? ' on' : ''); d.dataset.lutLook = b.path; d.innerHTML = `<div style="background:${b.g}"></div>${esc(b.n)}`; d.onclick = async () => { if (await choose(fx, 'cr', b.path, 'LUT: ' + b.n)) rerender(); }; looks.append(d); }
        f.append(looks);
      }
      if (fx.lut && fx.lut[slot]) { const P = fx.params[k] || (fx.params[k] = GW.P(100)); f.append(F.frow('الشدة', F.rangeIn(GW.pv(P, lt), 0, 100, 1, v => { GW.setPv(P, lt, v); GW.invalidate(); GW.commitSoon('شدة LUT'); GW.bus.emit('param'); }))); }
    }
  };

  /* ---------- automation ---------- */
  // applyLut({id|ids, slot:'creative'|'input', path | look (bundled file name, e.g. "teal_orange"), intensity=100, remove})
  L.api = async ({ id, ids, slot = 'creative', path, look, intensity, remove } = {}) => {
    const s = GW.seq(); const cs = (ids || [id]).filter(Boolean).map(x => GW.clipById(x, s)).filter(Boolean);
    if (!cs.length) { const sel = [...GW.sel.clips].map(x => GW.clipById(x)).filter(c => c && c.tt === 'v'); cs.push(...sel); }
    if (!cs.length) throw new Error('id required (a video clip or adjustment layer)');
    const sk = /^(in|input)$/i.test(slot) ? 'in' : /^(cr|creative|look)$/i.test(slot) ? 'cr' : null; if (!sk) throw new Error('slot: "input" or "creative"');
    let p = path || null;
    if (look) { const b = L.BUNDLED.find(x => x.path === 'luts/' + String(look).replace(/\.cube$/i, '') + '.cube' || x.n === look); if (!b) throw new Error('unknown look "' + look + '". Bundled: ' + L.BUNDLED.map(x => x.path.slice(5, -5)).join(', ')); p = b.path; }
    if (!p && !remove) throw new Error('path or look required (or remove:true)');
    let lut = null; if (p) { L.drop(p); lut = await L.load(p); if (!lut) throw new Error('cannot load LUT: ' + ((L.cache.get(p) || {}).err || p)); }
    const out = [];
    for (const c of cs) {
      if (c.tt !== 'v' || !c.fx) throw new Error('LUTs apply to video clips / adjustment layers');
      const fx = L.lumetriOf(c, !!p); if (!fx) { out.push({ clip: c.id, removed: false }); continue; }
      L.setSlot(fx, sk, remove ? null : p);
      if (!remove && intensity != null) fx.params[sk === 'in' ? 'lutIn' : 'lutCr'] = GW.P(clamp(+intensity, 0, 100));
      out.push({ clip: c.id, fx: fx.id, slot: sk === 'in' ? 'input' : 'creative', path: remove ? null : p, name: remove ? null : L.nameOf(p), size: lut ? lut.N : null, dims: lut ? (lut.d3 ? 3 : 1) : null, intensity: remove ? null : GW.pv(fx.params[sk === 'in' ? 'lutIn' : 'lutCr'], 0) });
    }
    GW.commit('المساعد: ' + (remove ? 'إزالة LUT' : 'LUT: ' + L.nameOf(p))); GW.invalidate(); if (GW.FXC && GW.FXC.render) try { GW.FXC.render(); } catch (e) {}
    return out;
  };
})();
