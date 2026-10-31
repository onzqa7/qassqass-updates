'use strict';
/* OFX plugins as normal effects («Universe (OFX)» in the Effects panel): every renderable plugin found by the scan (ui_ofx.js /
   ofx_bridge.js, cached) becomes a GW.FX type "ofx:<bundle>:<label>" whose params come from the plugin's descriptors, so
   Effect Controls, keyframes, presets (.rgx) and the effect chain work as for built-in effects.
   Rendering (gl.js R.multi hook): at the effect's place in the chain the layer is read back and sent to a persistent
   qq-ofxhost server (main process, ofx:fx IPC); the answer is uploaded as the new layer.
   - preview: asynchronous with a frame cache (clip, effect, time, size, params, upstream chain); until the answer arrives the
     last result for that effect is shown (or the untouched layer), then GW.invalidate() redraws. During playback the layer is
     sent at reduced resolution (OFX render scale) and only the newest frame is queued (older ones are dropped).
   - export: GW.OfxFx.settle() renders the frame, waits for every OFX request it caused, and renders it again from the cache
     (float pixels), so the exported frame always contains the effect. */
(function () {
  const R = GW.R; if (!R) return;
  const api = () => window.gws;
  const OXF = GW.OfxFx = { defs: {}, errors: {}, stats: { sent: 0, hits: 0, dropped: 0, ms: 0 } };
  const LS = 'gws.ofx.lib';
  const PREVIEW_PLAY = 640 * 360, PREVIEW_PAUSE = 1920 * 1080;
  const slug = (s) => String(s || '').replace(/[^\w؀-ۿ]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const hex = (rgb) => '#' + [0, 1, 2].map(i => Math.round(GW.clamp(+rgb[i] || 0, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  const unhex = (h) => { h = String(h || '#000000'); return [1, 3, 5].map(i => (parseInt(h.slice(i, i + 2), 16) || 0) / 255); };
  const isUniverse = (p) => /redgiant|universe/i.test((p.id || '') + ' ' + (p.bundle || ''));

  /* ================= descriptors → GW.FX definitions ================= */
  function mapParams(pl) {
    const out = [];
    for (const q of pl.params || []) {
      if (q.secret || ['Group', 'Page', 'PushButton', 'Custom', 'Parametric', 'Bytes', 'String', 'Integer3D', 'Double3D'].includes(q.type)) continue;
      const base = { k: q.name, n: q.label || q.name, ox: { type: q.type, dims: q.dims, spatial: q.spatial || null, defaultCoords: q.defaultCoords || null, choices: q.choices, enumv: q.enum, alpha: Array.isArray(q.default) ? q.default[3] : 1 } };
      if (q.type === 'Boolean') out.push({ ...base, t: 'bool', def: q.default ? 1 : 0 });
      else if (q.type === 'Choice') out.push({ ...base, t: 'select', def: String(q.default | 0), opts: (q.choices || []).map((c, i) => [String(i), c]) });
      else if (q.type === 'StrChoice') out.push({ ...base, t: 'select', def: String(q.default || ''), opts: (q.enum || q.choices || []).map((c, i) => [c, (q.choices || [])[i] || c]) });
      else if (q.type === 'RGB' || q.type === 'RGBA') out.push({ ...base, t: 'color', def: hex(q.default || [0, 0, 0]) });
      else if (q.type === 'Double2D' || q.type === 'Integer2D') out.push({ ...base, t: 'point', def: (q.default || [0, 0]).slice(0, 2) });
      else if (q.type === 'Double' || q.type === 'Integer') {
        const d = +q.default || 0; let lo = q.displayMin != null ? q.displayMin : q.min, hi = q.displayMax != null ? q.displayMax : q.max;
        if (lo == null || lo < -1e6) lo = Math.min(0, d); if (hi == null || hi > 1e6) hi = Math.max(100, d * 2, lo + 1);
        const step = q.type === 'Integer' ? 1 : (q.increment && q.increment < (hi - lo) / 20 ? q.increment : +((hi - lo) / 200).toPrecision(2));
        out.push({ ...base, t: 'num', def: d, min: lo, max: hi, step, unit: '' });
      }
    }
    return out;
  }
  OXF.typeOf = (pl) => 'ofx:' + slug(pl.match || pl.label) + ':' + slug(pl.label || pl.id);
  OXF.register = (plugins, { save } = {}) => {
    const keep = [];
    for (const pl of plugins || []) {
      if (!pl || pl.broken || !pl.renderable) continue;
      const type = OXF.typeOf(pl); const g = String(pl.grouping || '').replace(/^Universe\s*/i, '').trim();
      const def = { n: pl.label, cat: (isUniverse(pl) ? 'Universe (OFX)' : 'OFX') + (g ? ' · ' + g : ''), p: mapParams(pl), ofx: { bundle: pl.bundle, index: pl.index, id: pl.id, match: pl.match, label: pl.label, folder: pl.folder },
        fxcRows: (sec, c, fx) => fxcRows(sec, c, fx, type) };
      GW.FX[type] = def; OXF.defs[type] = def; R.multi[type] = (cur, pr, lt, pxs, fx, clipKey, list) => multi(cur, pr, lt, pxs, fx, clipKey, list, def);
      keep.push({ key: pl.key, id: pl.id, label: pl.label, grouping: pl.grouping, bundle: pl.bundle, index: pl.index, match: pl.match, renderable: true, params: pl.params, folder: pl.folder });
    }
    if (save) try { localStorage.setItem(LS, JSON.stringify(keep)); } catch (e) {}
    if (GW.UI.fxRefresh) GW.UI.fxRefresh(); if (GW.FXC && GW.FXC.render) GW.FXC.render(); GW.invalidate && GW.invalidate();
    return keep.length;
  };
  // project values (at local time) → host params; canonical spatial params with normalised defaults are stored 0–1 and sent in canonical px
  function hostParams(def, pr, fullW, fullH) {
    const o = {};
    for (const d of def.p) {
      let v = pr[d.k]; if (v === undefined) continue; const x = d.ox;
      if (d.t === 'bool') v = v ? 1 : 0;
      else if (d.t === 'select') v = x.type === 'Choice' ? (+v || 0) : String(v);
      else if (d.t === 'color') { v = unhex(v); if (x.type === 'RGBA') v.push(x.alpha == null ? 1 : x.alpha); }
      else if (d.t === 'point') { v = [+v[0] || 0, +v[1] || 0]; if (x.spatial === 'canonical' && x.defaultCoords === 'normalised') v = [v[0] * fullW, v[1] * fullH]; }
      else v = +v;
      o[d.k] = v;
    }
    return o;
  }

  /* ================= GPU ↔ CPU ================= */
  function readFbo(f, float) {
    const gl = R.gl, n = f.w * f.h * 4; gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    if (R.half) {
      const a = new Float32Array(n); gl.readPixels(0, 0, f.w, f.h, gl.RGBA, gl.FLOAT, a);
      if (float) return { fmt: 1, data: a };
      const u = new Uint8Array(n); for (let i = 0; i < n; i++) { const v = a[i]; u[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + .5) | 0; } return { fmt: 0, data: u };
    }
    const u = new Uint8Array(n); gl.readPixels(0, 0, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, u); return { fmt: 0, data: u };
  }
  const scratch = {};
  function uploadTo(W, H, img) { // cached result {w,h,fmt,data} → new layer FBO of W×H
    const gl = R.gl; const k = img.fmt ? 'f' : 'b'; let t = scratch[k];
    if (!t) { t = scratch[k] = { tex: gl.createTexture(), w: 0, h: 0 }; gl.bindTexture(gl.TEXTURE_2D, t.tex); for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v); }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    const fy = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), pm = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (img.fmt) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, img.w, img.h, 0, gl.RGBA, gl.FLOAT, img.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, img.w, img.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, fy); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, pm);
    const out = R.fbo(W, H); R.pass('copy', out, [t.tex]); return out;
  }

  /* ================= cache + requests ================= */
  const cache = new Map(); const MAXC = 24;                        // key → {w,h,fmt,data}
  const lastOf = new Map();                                        // fx.id → key of the newest result
  const inflight = new Map(); const want = new Map();             // fx.id → key  /  fx.id → queued request (preview: newest only)
  const pending = new Set();                                       // export: promises of requests started by the last frame
  const put = (k, v) => { cache.delete(k); cache.set(k, v); while (cache.size > MAXC) cache.delete(cache.keys().next().value); };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  let errToastAt = 0;
  async function send(req) {
    const t0 = performance.now(); OXF.stats.sent++;
    let r; try { r = await api().ofxFx(req.msg); } catch (e) { r = { ok: false, json: { code: 'IPC', detail: e.message } }; }
    OXF.stats.ms = performance.now() - t0;
    if (OXF.debug) { const { pixels, ...m } = req.msg; const mean = (a) => { let t = 0; for (let i = 0; i < a.length; i += 4 * 101) t += a[i]; return t / Math.ceil(a.length / 404); }; OXF.debug.push({ m, inMean: mean(pixels), ok: r && r.ok, json: r && r.json, outMean: r && r.pixels ? mean(req.msg.fmt ? new Float32Array(r.pixels.buffer, r.pixels.byteOffset, r.pixels.byteLength / 4) : r.pixels) : null }); }
    if (r && r.ok && r.pixels) {
      let px = r.pixels; if (px.byteOffset % 4) px = px.slice(); const data = req.msg.fmt ? new Float32Array(px.buffer, px.byteOffset, px.byteLength / 4) : new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
      put(req.key, { w: req.msg.w, h: req.msg.h, fmt: req.msg.fmt, data }); lastOf.set(req.fxId, req.key); delete OXF.errors[req.fxId];
    } else {
      const j = (r && r.json) || {}; const msg = GW.Ofx && GW.Ofx.errText ? GW.Ofx.errText(j.code, j.detail, j.messages) : (j.code + ' ' + (j.detail || ''));
      const had = OXF.errors[req.fxId]; OXF.errors[req.fxId] = { code: j.code, msg }; put(req.key, { error: true });
      if (!had && performance.now() - errToastAt > 4000) { errToastAt = performance.now(); GW.toast('تأثير OFX «' + req.label + '»: ' + msg, 'err'); if (GW.FXC && GW.FXC.render) setTimeout(() => GW.FXC.render(), 0); }
    }
  }
  function previewSend(req) {
    if (inflight.has(req.fxId)) { if (want.has(req.fxId)) OXF.stats.dropped++; want.set(req.fxId, req); return; }
    inflight.set(req.fxId, req.key);
    send(req).finally(() => {
      inflight.delete(req.fxId); GW.invalidate && GW.invalidate();
      const nx = want.get(req.fxId); want.delete(req.fxId); if (nx && !cache.has(nx.key)) previewSend(nx);
    });
  }

  /* ================= the effect-chain hook ================= */
  function multi(cur, pr, lt, pxs, fx, clipKey, list, def) {
    if (!api() || !api().ofxFx || clipKey == null) return cur; // hover thumbnails / web build: pass through
    const exporting = !!(GW.Render && GW.Render.exporting), playing = !!(GW.Render && GW.Render.playing) || !!(GW.pb && GW.pb.playing);
    const W = cur.w, H = cur.h; const c = GW.clipById ? GW.clipById(clipKey) : null; const s = GW.seq ? GW.seq() : null;
    const fps = (s && s.fps) || 30; const frame = Math.round(lt * fps * 1000) / 1000 * 1; // OFX time in frames (clip-local)
    let sc = 1; if (!exporting) { const cap = playing ? PREVIEW_PLAY : PREVIEW_PAUSE; if (W * H > cap) sc = Math.sqrt(cap / (W * H)); }
    const sw = Math.max(2, Math.round(W * sc)), sh = Math.max(2, Math.round(H * sc));
    const rs = Math.min(1, Math.max(.01, pxs * sc)); const fullW = sw / rs, fullH = sh / rs;
    const hp = hostParams(def, pr, fullW, fullH);
    // everything upstream of this effect that changes its input
    const i = list ? list.indexOf(fx) : -1; const up = [];
    if (i > 0) for (let j = 0; j < i; j++) { const f = list[j]; if (!f.on) continue; const o = {}; for (const k in f.params) o[k] = GW.pv(f.params[k], lt); up.push(f.type, o); }
    const src = c ? [c.media, c.in, c.speed || 1, c.kind, c.text ? JSON.stringify(c.text).length : 0] : [];
    const fmt = exporting && R.half ? 1 : 0;
    const key = [fx.id, clipKey, frame, sw, sh, fmt, hash(JSON.stringify([hp, up, src]))].join('|');
    const hit = cache.get(key); if (OXF.trace) OXF.trace.push({ key, hit: hit ? (hit.error ? 'error' : 'ok') : null, inflight: inflight.get(fx.id) || null, last: lastOf.get(fx.id) || null });
    if (hit) { OXF.stats.hits++; if (hit.error) return cur; cache.delete(key); cache.set(key, hit); return uploadTo(W, H, hit); } // applyEffects frees cur
    // read back (downscaled for preview) and request
    let rd; if (sw !== W || sh !== H) { const small = R.fbo(sw, sh); R.pass('copy', small, [cur.tex]); rd = readFbo(small, fmt === 1); R.free(small); } else rd = readFbo(cur, fmt === 1);
    const d = def.ofx;
    const req = { key, fxId: fx.id, label: def.n, msg: { op: 'render', bundle: d.bundle, index: d.index, inst: fx.id, w: sw, h: sh, time: frame, fps, fmt: rd.fmt, scale: rs, duration: Math.max(1, Math.round(((c && c.dur) || 10) * fps)), params: hp, pixels: rd.data, hostName: (GW.Ofx && GW.Ofx.cfg && GW.Ofx.cfg().hostName) || '' } };
    if (rd.fmt !== fmt) req.key = key.replace('|' + fmt + '|', '|' + rd.fmt + '|');
    if (exporting) { const p = send(req); pending.add(p); p.finally(() => pending.delete(p)); return cur; }
    previewSend(req);
    const lk = lastOf.get(fx.id); const last = lk && cache.get(lk);
    if (last && !last.error) return uploadTo(W, H, last);
    return cur;
  }
  // export: render, wait for the OFX answers this frame needed, render again (chained OFX effects may need a few rounds)
  OXF.pending = () => pending.size > 0;
  OXF.settle = async (acc, renderFn) => {
    for (let k = 0; k < 6 && pending.size; k++) { await Promise.all([...pending]); R.free(acc); acc = renderFn(); }
    return acc;
  };
  OXF.clearCache = () => { cache.clear(); lastOf.clear(); };
  OXF._io = { uploadTo, readFbo }; // tests / diagnostics

  /* ================= Effect Controls: presets + status ================= */
  function fxcRows(sec, c, fx, type) {
    const def = GW.FX[type]; if (!def) return;
    const top = document.createElement('div'); top.className = 'frow';
    const lab = document.createElement('label'); lab.textContent = 'إعداد مسبق'; const ctl = document.createElement('div'); ctl.className = 'ctl';
    const sel = document.createElement('select'); sel.className = 'sel'; sel.innerHTML = '<option value="">— …</option>'; sel.disabled = true; ctl.append(sel); top.append(lab, ctl);
    sec.body.prepend(top);
    const err = OXF.errors[fx.id]; if (err) { const e = document.createElement('div'); e.className = 'ofx-err'; e.style.cssText = 'color:var(--red,#e5484d);font-size:11.5px;padding:4px 8px;line-height:1.5'; e.textContent = err.msg; sec.body.prepend(e); }
    const d = def.ofx; const folder = d.folder || (GW.Ofx && GW.Ofx.lib && GW.Ofx.lib.folder) || (GW.Ofx && GW.Ofx.cfg && GW.Ofx.cfg().folder);
    if (!api() || !api().ofxPresets) { top.remove(); return; }
    api().ofxPresets({ folder, match: d.match }).then(list => {
      if (!list || !list.length) { top.remove(); return; }
      sel.innerHTML = '<option value="">— اختر إعدادًا مسبقًا (' + list.length + ') —</option>' + list.map((x, i) => `<option value="${i}">${GW.esc(x.name)}</option>`).join(''); sel.disabled = false;
      sel.onchange = () => {
        const pr = list[+sel.value]; if (!pr) return; const n = OXF.applyPreset(fx, def, pr);
        GW.commit('إعداد مسبق: ' + pr.name); GW.invalidate(); GW.toast('طُبّق الإعداد المسبق «' + pr.name + '» (' + n + ' معامل)');
      };
    }).catch(() => top.remove());
  }
  // .rgx param streams → effect params (matched by label, then name); replaces animation with the preset value
  OXF.applyPreset = (fx, def, preset) => {
    const norm = (s) => String(s || '').trim().toLowerCase(); let n = 0;
    for (const st of preset.streams || []) {
      const d = def.p.find(q => norm(q.n) === norm(st.name)) || def.p.find(q => norm(q.k) === norm(st.name)); if (!d) continue;
      let v = st.value;
      if (d.t === 'select') { const i = d.opts.findIndex(o => norm(o[1]) === norm(st.choiceString)); v = i >= 0 ? d.opts[i][0] : (d.ox.type === 'Choice' ? String(+v || 0) : String(v)); }
      else if (d.t === 'bool') v = v ? 1 : 0;
      else if (d.t === 'color') { if (!Array.isArray(v)) continue; v = hex(v); }
      else if (d.t === 'point') { if (!Array.isArray(v)) continue; v = v.slice(0, 2); }
      else if (typeof v !== 'number') continue;
      fx.params[d.k] = GW.P(v); n++;
    }
    return n;
  };

  /* ================= discovery ================= */
  // 1) instantly from the last scan (so saved projects render before the background scan finishes), 2) background scan (cached)
  try { const L = JSON.parse(localStorage.getItem(LS) || 'null'); if (Array.isArray(L) && L.length) OXF.register(L.map(p => ({ ...p, renderable: true }))); } catch (e) {}
  OXF.autoScan = async (o = {}) => {
    if (!api() || !api().ofxScan || !GW.Ofx) return null;
    try {
      const lib = await GW.Ofx.scan(o); for (const p of lib.plugins) p.folder = lib.folder;
      const n = OXF.register(lib.plugins, { save: true }); OXF.lastScan = { ok: true, n, folder: lib.folder, at: Date.now() }; return OXF.lastScan;
    } catch (e) { OXF.lastScan = { ok: false, error: e.message }; return OXF.lastScan; }
  };
  setTimeout(() => { OXF.autoScan(); }, 2500);
  if (api() && api().onOfxFxMsg) api().onOfxFxMsg(m => console.warn('OFX plugin:', m));
})();
