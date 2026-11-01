'use strict';
/* Media import, probing, proxies (Premiere-style, background NVENC queue), conformed audio cache (PCM),
   on-disk peaks & thumbnail caches keyed by a media hash (path+size+mtime), lazy preparation, video element pool. */
(function () {
  const rt = GW.rt = { m: {}, v: {}, paths: null };
  const api = () => window.gws;
  const M = GW.Media = {};
  const now = () => performance.now();

  /* ---------- settings ---------- */
  M.cfg = { proxies: true, proxyRes: 720, autoProxy: true, cacheDir: '' };
  try { Object.assign(M.cfg, JSON.parse(localStorage.getItem('gws.mediaCfg') || '{}')); } catch (e) {}
  M.saveCfg = () => { try { localStorage.setItem('gws.mediaCfg', JSON.stringify(M.cfg)); } catch (e) {} };

  /* ---------- small helpers ---------- */
  // bounded-concurrency task queue (front-insert for high priority)
  function limiter(n) {
    let active = 0; const q = [];
    const next = () => { while (active < n && q.length) { const [fn, res, rej] = q.shift(); active++; Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); }); } };
    const run = (fn, hi) => new Promise((res, rej) => { if (hi) q.unshift([fn, res, rej]); else q.push([fn, res, rej]); next(); });
    run.busy = () => active + q.length;
    return run;
  }
  M.limiter = limiter;
  const probeQ = limiter(6), testQ = limiter(4), audioQ = limiter(2), thumbQ = limiter(2), decodeQ = limiter(2), ioQ = limiter(12);
  M.queues = { probeQ, testQ, audioQ, thumbQ, decodeQ };
  function hash(s) { // 64-bit FNV-1a style (two lanes) → 16 hex chars
    let a = 0x811c9dc5, b = 0x9747b28c;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15; }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  M.hash = hash;
  const exists = (p) => ioQ(() => api().exists(p));

  M.url = (m, full) => {
    const r = rt.m[m.id] || {};
    if (r.blobUrl) return r.blobUrl;
    const compat = m.proxy || r.proxy; const px = m.px || r.px;
    let p = compat || m.path;
    if (!full && px && M.cfg.proxies && m.kind === 'video') p = px;
    if (!p) return '';
    return api() ? api().mediaUrl(p) : p;
  };
  M.usingProxy = (m) => !!(M.cfg.proxies && (m.px || (rt.m[m.id] || {}).px));

  /* ---------- runtime record with lazy getters (peaks / thumbs / poster / decoded audio) ---------- */
  function makeRt(m) {
    const r = { status: 'new', _m: m };
    Object.defineProperties(r, {
      peaks: { get() { if (!this._peaks && !this._pkBusy && this.status === 'ready' && (this._m.hasAudio || this._m.kind === 'audio')) M.loadPeaks(this._m); return this._peaks; }, set(v) { this._peaks = v; }, enumerable: true },
      thumbs: { get() { this._thUsed = now(); if (!this._thumbs && !this._thBusy) M.loadThumbs(this._m); return this._thumbs; }, set(v) { this._thumbs = v; }, enumerable: true },
      poster: { get() { if (!this._poster && !this._thBusy && this._m.kind === 'video') M.loadThumbs(this._m); return this._poster; }, set(v) { this._poster = v; }, enumerable: true },
      audio: { get() { this._aUsed = now(); if (!this._audio && !this._aBusy && this.status === 'ready' && (this._m.hasAudio || this._m.kind === 'audio')) M.loadAudio(this._m).catch(() => {}); return this._audio; }, set(v) { this._audio = v; }, enumerable: true }
    });
    return r;
  }
  M.ensureRt = (m) => { let r = rt.m[m.id]; if (!r) r = rt.m[m.id] = makeRt(m); r._m = m; return r; };

  /* ---------- import ---------- */
  M.importDialog = async () => {
    if (api()) { const files = await api().open({ filter: 'media', multi: true, title: 'استيراد وسائط' }); if (files.length) await M.importFiles(files); }
    else { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'video/*,audio/*,image/*'; inp.onchange = () => M.importFiles([...inp.files].map(f => ({ file: f, name: f.name, path: f.path || null, size: f.size }))); inp.click(); }
  };
  M.importFiles = async (files) => {
    const added = []; const have = new Set(GW.prj.media.map(m => m.path).filter(Boolean)); const dups = [];
    for (const f of files) {
      if (f.path && have.has(f.path)) { dups.push(f.path); continue; } if (f.path) have.add(f.path);
      const kind = GW.mediaKind(f.name);
      const m = { id: GW.uid(), kind, name: f.name, path: f.path || null, size: f.size || 0, dur: kind === 'image' ? (GW.durDefaults ? GW.durDefaults.still : 5) : 0, w: 0, h: 0, fps: 0, hasAudio: kind === 'audio', hasVideo: kind !== 'audio', label: GW.LABELS[kind], added: Date.now() };
      const r = M.ensureRt(m); if (f.file) r.blobUrl = URL.createObjectURL(f.file), r.file = f.file;
      GW.prj.media.push(m); added.push(m);
    }
    if (dups.length) { // duplicate import: no second copy; the existing items get selected and the user is told
      const ids = GW.prj.media.filter(m => dups.includes(m.path)).map(m => m.id); if (GW.sel && GW.sel.media) { GW.sel.media.clear(); ids.forEach(id => GW.sel.media.add(id)); }
      GW.toast(dups.length === 1 ? 'الملف موجود في المشروع مسبقًا: ' + dups[0].split(/[\\/]/).pop() : 'تم تخطي ' + dups.length + ' ملفات موجودة في المشروع مسبقًا');
      if (!added.length) { GW.bus.emit('media'); return GW.prj.media.filter(m => ids.includes(m.id)); }
    }
    if (!added.length) return [];
    GW.bus.emit('media');
    await Promise.all(added.map(m => M.prepare(m).catch(e => { console.error(e); setStatus(m, 'error'); GW.toast('تعذر تجهيز الملف: ' + m.name, 'err'); })));
    // small imports behave as before (audio decoded right away); big imports stay lazy and fill in from the background queues
    const total = added.reduce((a, m) => a + (m.hasAudio || m.kind === 'audio' ? (m.dur || 0) : 0), 0);
    if (total <= 600) await Promise.all(added.filter(m => (m.hasAudio || m.kind === 'audio') && rt.m[m.id] && rt.m[m.id].status === 'ready').map(m => M.loadAudio(m).catch(e => { console.warn(e); m.hasAudio = false; })));
    GW.commit('استيراد وسائط');
    GW.bus.emit('media');
    return added;
  };

  async function cachePaths() {
    if (!rt.paths && api()) rt.paths = await api().paths();
    const p = rt.paths; if (!p) return null;
    return M.cfg.cacheDir ? { ...p, cache: M.cfg.cacheDir } : p;
  }
  M.cachePaths = cachePaths;
  function setStatus(m, s, pct) { const r = M.ensureRt(m); r.status = s; r.pct = pct; GW.bus.emit('media-status', m); }
  function setBg(m, txt) { const r = M.ensureRt(m); if (r.bg === txt) return; r.bg = txt; GW.bus.emit('media-status', m); }
  M.bgText = (m) => { const r = rt.m[m.id]; return r ? r.bg || '' : ''; };

  // identity of the underlying file → cache key shared by every project
  async function mediaKey(m, st) {
    if (!m.path || !api()) return null;
    if (!st && api().stat) { try { st = await ioQ(() => api().stat(m.path)); } catch (e) {} }
    if (st) m.size = st.size;
    return hash(m.path + '|' + (st ? st.size : (m.size || 0)) + '|' + (st ? Math.round(st.mtimeMs) : 0));
  }

  /* ---------- preparation (lazy: metadata only; heavy work goes to background queues) ---------- */
  M.prepare = async (m) => {
    const r = M.ensureRt(m);
    let st = null; // one stat IPC answers both "is it online?" and "has it changed?"
    if (m.path && api()) { if (api().stat) { try { st = await ioQ(() => api().stat(m.path)); } catch (e) {} if (!st) { m.offline = 1; setStatus(m, 'offline'); return; } } else if (!(await exists(m.path))) { m.offline = 1; setStatus(m, 'offline'); return; } }
    m.offline = 0;
    const key = await mediaKey(m, st);
    if (key && m.key && m.key !== key) { m.proxy = null; m.px = null; m.ok = 0; r.proxy = r.px = null; } // file changed on disk
    const known = !!key && m.key === key && m.dur > 0 && (m.kind === 'audio' || m.kind === 'image' || m.w > 0);
    if (key) m.key = key;
    if (!known) {
      setStatus(m, 'probing');
      let probe = null;
      if (m.path && api()) { try { probe = await probeQ(() => api().ffProbe(m.path)); } catch (e) {} }
      if (probe) {
        if (probe.duration) m.dur = m.kind === 'image' ? (GW.durDefaults ? GW.durDefaults.still : 5) : probe.duration;
        if (probe.video && m.kind !== 'audio') { m.w = probe.video.w; m.h = probe.video.h; m.fps = probe.video.fps || 0; m.alpha = probe.video.alpha ? 1 : 0; m.codec = probe.video.codec; m.bits = probe.video.bits || 8; if (probe.rotate && Math.abs(probe.rotate) % 180 === 90) { const t = m.w; m.w = m.h; m.h = t; } }
        m.hasAudio = !!probe.audio; if (m.kind === 'video' && !probe.video) { m.kind = 'audio'; m.hasVideo = false; m.label = GW.LABELS.audio; }
      }
    }
    if (m.kind === 'image') await loadImage(m);
    else if (m.kind === 'video') {
      if (m.proxy || m.px) { // one round trip for both cache files when the bridge can batch
        const ps = [m.proxy, m.px].filter(Boolean);
        const ex = api().existsMany ? await ioQ(() => api().existsMany(ps)) : await Promise.all(ps.map(exists));
        const ok = new Map(ps.map((p, i) => [p, !!ex[i]])); if (m.proxy && !ok.get(m.proxy)) m.proxy = null; if (m.px && !ok.get(m.px)) m.px = null;
      }
      if (!m.px && m.key && PX.needs(m)) await PX.lookup(m); // proxies made by another project for the same file
      let ok = known && (m.ok || m.proxy) ? true : await testQ(() => testVideo(m));
      if (!ok && m.path && api()) { await makeCompat(m); ok = await testVideo(m); }
      if (!ok) { setStatus(m, 'error'); GW.toast('صيغة الفيديو غير مدعومة: ' + m.name, 'err'); return; }
      if (!m.proxy) m.ok = 1;
      if (M.cfg.autoProxy && !m.px && PX.needs(m)) PX.enqueue(m);
    }
    setStatus(m, 'ready');
    if ((m.hasAudio || m.kind === 'audio') && m.path && api()) M.audioPrep(m).then(() => { if (!r._peaks) M.loadPeaks(m); }).catch(e => console.warn('audio prep', m.name, e));
  };
  // project open: prepare everything with bounded parallelism, timeline media first
  M.prepareAll = (list) => {
    const used = new Set(); for (const s of GW.prj.seqs) for (const c of s.clips) if (c.media) used.add(c.media);
    const order = [...list].sort((a, b) => (used.has(b.id) ? 1 : 0) - (used.has(a.id) ? 1 : 0));
    const q = limiter(16);
    return Promise.all(order.map(m => q(() => M.prepare(m).catch(e => { console.warn(e); setStatus(m, 'error'); }))));
  };
  function loadImage(m) {
    return new Promise((res) => {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
      img.onload = () => { m.w = img.naturalWidth || 1920; m.h = img.naturalHeight || 1080; M.ensureRt(m).img = img; M.ensureRt(m).poster = img; res(true); };
      img.onerror = () => { setStatus(m, 'error'); res(false); };
      img.src = M.url(m, true);
    });
  }
  // can the browser decode the full-resolution source used for export?
  function testVideo(m) {
    return new Promise((res) => {
      const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'metadata';
      let done = false; const fin = ok => { if (done) return; done = true; clearTimeout(to); v.removeAttribute('src'); try { v.load(); } catch (e) {} res(ok); };
      const to = setTimeout(() => fin(false), 15000);
      v.onloadedmetadata = () => { if (!v.videoWidth) { fin(false); return; } if (!m.w) { m.w = v.videoWidth; m.h = v.videoHeight; } if (!m.dur || !isFinite(m.dur)) m.dur = v.duration; fin(true); };
      v.onerror = () => fin(false);
      v.src = M.url(m, true);
    });
  }

  /* ---------- background ffmpeg runner (low priority, cancellable when the bridge supports it) ---------- */
  const prog = GW.bus._prog = GW.bus._prog || {};
  if (window.gws) window.gws.onProgress((id, t) => { const f = prog[id]; if (f) f(t); });
  function ffBg(id, args, onT) {
    if (onT) prog[id] = onT;
    const p = api().mpRun ? api().mpRun(id, args, { low: true }) : api().ffRun(id, args);
    return Promise.resolve(p).finally(() => { delete prog[id]; });
  }

  /* ---------- hardware encoder detection (one quick lavfi encode per encoder, cached) ---------- */
  let capsP = null;
  M.caps = (force) => {
    if (capsP && !force) return capsP;
    return capsP = (async () => {
      if (!api()) return {};
      const p = await cachePaths(); const ver = (p && p.version) + '|' + (p && p.platform);
      if (!force) { try { const c = JSON.parse(localStorage.getItem('gws.ffcaps') || 'null'); if (c && c.ver === ver && Date.now() - c.at < 3 * 864e5) return c.caps; } catch (e) {} }
      const caps = {};
      if (api().ffCaps) { try { Object.assign(caps, await api().ffCaps()); } catch (e) {} }
      else await Promise.all(['h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv'].map(async enc => { try { caps[enc] = !!(await api().ffRun('caps_' + enc, FFArgs.capsTestArgs(enc))).ok; } catch (e) { caps[enc] = false; } }));
      try { localStorage.setItem('gws.ffcaps', JSON.stringify({ ver, at: Date.now(), caps })); } catch (e) {}
      return caps;
    })();
  };
  async function encChain(gpuPipeline) {
    const c = await M.caps(); const out = [];
    if (c.h264_nvenc) { if (gpuPipeline) out.push('nvenc-cuda'); out.push('nvenc'); }
    if (c.h264_qsv) out.push('qsv');
    out.push('x264'); return out;
  }

  /* ---------- full-res "optimized media" for formats the browser cannot decode (needed for export) ---------- */
  async function makeCompat(m) {
    const p = await cachePaths(); if (!p) return;
    const out = p.cache + p.sep + (m.key || m.id) + '_full_proxy.mp4';
    if (m.key && await exists(out) && await exists(out + '.ok')) { m.proxy = out; M.ensureRt(m).proxy = out; return; }
    setStatus(m, 'converting', 0);
    for (const enc of await encChain(false)) {
      const r = await ffBg('px_' + m.id, FFArgs.transcodeArgs(m.path, out, { enc, fps: m.fps }), (t) => setStatus(m, 'converting', m.dur ? Math.min(99, t / m.dur * 100) : 0));
      if (r.ok) { m.proxy = out; M.ensureRt(m).proxy = out; if (m.key) await api().writeText(out + '.ok', enc); GW.toast('تم تحويل الملف لصيغة مدعومة: ' + m.name); return; }
    }
  }

  /* ---------- proxies ---------- */
  const HEAVY = /^(hevc|h265|prores|dnxhd|dnxhr|cfhd|mpeg2video|av1|mjpeg|v210|r210|qtrle|hap|tiff|dpx|exr|cineform)$/i;
  const PX = M.Proxy = { q: [], active: new Map(), max: 2, noGpuPipe: {}, done: 0 };
  PX.res = () => (+M.cfg.proxyRes >= 1080 ? 1080 : 720);
  PX.path = (m, p, res) => p.cache + p.sep + m.key + '_' + (res || PX.res()) + '_proxy.mp4';
  // heavy = ≥2.5K, 10-bit+, or an intra/long-GOP pro codec — and actually bigger than the proxy size
  PX.needs = (m) => {
    if (m.kind !== 'video' || !m.path || !m.w) return false;
    const big = Math.max(m.w, m.h) >= 2560 || Math.min(m.w, m.h) >= 1440;
    const heavy = big || (m.bits || 8) > 8 || HEAVY.test(m.codec || '');
    return heavy && Math.min(m.w, m.h) > PX.res() + 8;
  };
  PX.lookup = async (m) => {
    const p = await cachePaths(); if (!p) return false;
    for (const res of [PX.res(), PX.res() === 720 ? 1080 : 720]) { const f = PX.path(m, p, res); if (await exists(f + '.ok') && await exists(f)) { m.px = f; M.ensureRt(m).px = f; return true; } }
    return false;
  };
  PX.state = (m) => { if (m.px || (rt.m[m.id] || {}).px) return 'ready'; if (PX.active.has(m.id)) return 'running'; if (PX.q.some(j => j.m.id === m.id)) return 'queued'; return ''; };
  PX.enqueue = (m, hi) => {
    if (!m || m.kind !== 'video' || !m.path || !m.key || !api() || m.offline || PX.state(m)) return false;
    const job = { m, pct: 0, cancelled: false };
    if (hi) PX.q.unshift(job); else PX.q.push(job);
    setBg(m, 'بانتظار البروكسي'); PX.pump(); PX.emit(); return true;
  };
  PX.cancel = (m) => {
    PX.q = PX.q.filter(j => { if (j.m.id === m.id) { setBg(m, ''); return false; } return true; });
    const j = PX.active.get(m.id); if (j) { j.cancelled = true; if (api().mpKill) api().mpKill('pxy_' + m.id); }
    PX.emit();
  };
  PX.cancelAll = () => { for (const j of PX.q) setBg(j.m, ''); PX.q = []; for (const [, j] of PX.active) { j.cancelled = true; if (api() && api().mpKill) api().mpKill('pxy_' + j.m.id); } PX.emit(); };
  PX.remove = async (m) => { PX.cancel(m); const f = m.px || (rt.m[m.id] || {}).px; m.px = null; const r = M.ensureRt(m); r.px = null; if (f && api()) { await api().remove(f + '.ok'); await api().remove(f); } swapVideos(m); GW.bus.emit('media-status', m); };
  PX.emit = GW.debounce(() => GW.bus.emit('proxy-queue', PX.summary()), 120);
  PX.summary = () => { let pct = 0; for (const [, j] of PX.active) pct += j.pct; return { queued: PX.q.length, active: PX.active.size, pct: PX.active.size ? pct / PX.active.size : 0, done: PX.done }; };
  PX.pump = () => {
    while (PX.active.size < PX.max && PX.q.length) {
      const job = PX.q.shift(); PX.active.set(job.m.id, job);
      runProxy(job).catch(e => console.warn('proxy', e)).finally(() => { PX.active.delete(job.m.id); PX.emit(); PX.pump(); if (!PX.active.size && !PX.q.length) GW.bus.emit('proxy-idle'); });
    }
  };
  async function runProxy(job) {
    const m = job.m; const p = await cachePaths(); if (!p || !m.key) return;
    const res = PX.res(); const out = PX.path(m, p, res);
    if (await exists(out + '.ok') && await exists(out)) { finish(); return; }
    const t0 = now(); const gk = (m.codec || '') + (m.bits || 8);
    for (const enc of await encChain(!PX.noGpuPipe[gk])) {
      if (job.cancelled) break;
      setBg(m, 'بروكسي 0%');
      const r = await ffBg('pxy_' + m.id, FFArgs.proxyArgs(m.path, out, { enc, res, w: m.w, h: m.h, fps: m.fps }), (t) => { job.pct = m.dur ? Math.min(99, t / m.dur * 100) : 0; setBg(m, 'بروكسي ' + Math.round(job.pct) + '%'); PX.emit(); });
      if (job.cancelled) break;
      if (r.ok) { job.enc = enc; job.secs = (now() - t0) / 1000; await api().writeText(out + '.ok', JSON.stringify({ enc, res, secs: +job.secs.toFixed(1), src: m.path })); finish(); return; }
      if (enc === 'nvenc-cuda') PX.noGpuPipe[gk] = 1; // e.g. ProRes / 4:2:2 → NVDEC can't: decode on the CPU next time
      console.warn('proxy encoder failed', enc, (r.log || '').slice(-300));
    }
    if (job.cancelled) { await api().remove(out); setBg(m, ''); return; }
    setBg(m, 'فشل البروكسي');
    function finish() { m.px = out; M.ensureRt(m).px = out; PX.done++; setBg(m, ''); swapVideos(m); GW.bus.emit('media-status', m); GW.invalidate(); }
  }
  // re-point every pooled <video> of this media at the right file (the pool compares URLs)
  function swapVideos(m) {
    for (const id in rt.v) if (rt.v[id].media === m.id) M.dropVid(id);
    const S = GW.Source; if (S && S.m === m && S.load && S.media) { try { const t = S.t(); S.load(m); S.seek(t); } catch (e) {} }
    GW.invalidate();
  }
  M.setProxies = (on) => {
    M.cfg.proxies = !!on; M.saveCfg();
    for (const id in rt.v) { const e = rt.v[id]; const m = GW.media(e.media); if (m && M.url(m) !== e.url) M.dropVid(id); }
    const S = GW.Source; if (S && S.m && S.m.kind === 'video' && S.load && S.media) { try { const t = S.t(); S.load(S.m); S.seek(t); } catch (e) {} }
    GW.bus.emit('proxies', M.cfg.proxies); GW.invalidate();
    GW.toast(M.cfg.proxies ? 'البروكسي: مفعّل للمعاينة (التصدير يستخدم الملفات الأصلية دائمًا)' : 'البروكسي: معطّل — المعاينة من الملفات الأصلية');
  };
  M.toggleProxies = () => M.setProxies(!M.cfg.proxies);
  M.createProxies = (list) => { let n = 0; for (const m of list) if (PX.enqueue(m, true)) n++; GW.toast(n ? `تمت إضافة ${n} ملف إلى قائمة إنشاء البروكسي` : 'لا توجد ملفات فيديو تحتاج بروكسي'); return n; };
  M.chooseCacheDir = async () => {
    if (!api()) return; const f = await api().open({ folder: true, title: 'مجلد ذاكرة الوسائط المؤقتة' }); if (!f.length) return;
    M.cfg.cacheDir = f[0].path; M.saveCfg(); GW.toast('مجلد الذاكرة المؤقتة: ' + M.cfg.cacheDir);
  };
  M.proxyMenu = (x, y) => {
    const sel = GW.prj.media.filter(m => GW.sel.media.has(m.id) && m.kind === 'video');
    GW.menu(x, y, [
      { label: 'استخدام البروكسي في المعاينة', check: M.cfg.proxies, action: M.toggleProxies },
      { label: 'إنشاء البروكسي تلقائيًا للملفات الثقيلة', check: M.cfg.autoProxy, action: () => { M.cfg.autoProxy = !M.cfg.autoProxy; M.saveCfg(); if (M.cfg.autoProxy) for (const m of GW.prj.media) if (!m.px && PX.needs(m)) PX.enqueue(m); } },
      '-',
      { label: 'دقة البروكسي: 1280×720', check: PX.res() === 720, action: () => { M.cfg.proxyRes = 720; M.saveCfg(); } },
      { label: 'دقة البروكسي: 1920×1080', check: PX.res() === 1080, action: () => { M.cfg.proxyRes = 1080; M.saveCfg(); } },
      '-',
      { label: 'إنشاء بروكسي للعناصر المحددة', disabled: !sel.length, action: () => M.createProxies(sel) },
      { label: 'إنشاء بروكسي لكل الفيديوهات', action: () => M.createProxies(GW.prj.media.filter(m => m.kind === 'video')) },
      { label: 'إيقاف قائمة البروكسي', disabled: !PX.q.length && !PX.active.size, action: PX.cancelAll },
      '-',
      { label: 'تغيير مجلد الذاكرة المؤقتة…', action: M.chooseCacheDir },
      { label: 'فتح مجلد الذاكرة المؤقتة', action: async () => { const p = await cachePaths(); if (p && api()) api().openPath(p.cache); } }
    ]);
  };

  /* ---------- audio: conformed PCM cache → peaks on disk → AudioBuffer only when needed ---------- */
  M.actx = () => rt.actx || (rt.actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'interactive' }));
  async function pcmPath(m) { const p = await cachePaths(); return p.cache + p.sep + (m.key || m.id) + '.pcm'; }
  async function pkPath(m) { const p = await cachePaths(); return p.cache + p.sep + (m.key || m.id) + '.pk16'; }
  // make sure the conformed audio exists on disk (one ffmpeg pass, shared across projects)
  M.audioPrep = (m) => {
    const r = M.ensureRt(m); if (r._prepP) return r._prepP;
    return r._prepP = (async () => {
      const pcm = await pcmPath(m);
      if (!(m.key && await exists(pcm + '.ok') && await exists(pcm))) {
        await audioQ(async () => {
          setBg(m, 'استخراج الصوت…');
          const res = await ffBg('au_' + m.id, FFArgs.audioArgs(m.proxy || m.path, pcm), (t) => setBg(m, 'استخراج الصوت ' + (m.dur ? Math.min(99, Math.round(t / m.dur * 100)) : 0) + '%'));
          setBg(m, '');
          if (!res.ok) { r._prepP = null; throw new Error('audio extract failed: ' + (res.log || '').slice(-200)); }
          await api().writeText(pcm + '.ok', '1');
        });
      }
      return pcm;
    })();
  };
  // waveform peaks (100/s, 0..1): disk cache → else computed by streaming the PCM (no full decode)
  M.loadPeaks = async (m) => {
    const r = M.ensureRt(m); if (r._peaks || r._pkBusy) return r._peaks;
    if (!m.path || !api()) return null;
    r._pkBusy = 1;
    try {
      const pk = await pkPath(m);
      if (m.key && await exists(pk)) {
        const buf = await (await fetch(api().mediaUrl(pk))).arrayBuffer();
        const u = new Uint16Array(buf, 0, buf.byteLength >> 1); const f = new Float32Array(u.length);
        for (let i = 0; i < u.length; i++) f[i] = u[i] / 65535;
        r._peaks = f;
      } else {
        await M.audioPrep(m);
        if (!r._peaks) await decodeQ(() => r._peaks ? null : streamPCM(m, false));
      }
      GW.bus.emit('peaks', m);
    } catch (e) { console.warn('peaks', m.name, e); }
    finally { r._pkBusy = 0; }
    return r._peaks;
  };
  async function savePeaks(m, f) {
    if (!m.key) return;
    try { const u = new Uint16Array(f.length); for (let i = 0; i < f.length; i++) u[i] = Math.round(Math.min(1, f[i]) * 65535); await api().writeBin(await pkPath(m), u.buffer); } catch (e) { console.warn(e); }
  }
  // stream the PCM file once: computes peaks if missing and (optionally) fills an AudioBuffer
  async function streamPCM(m, wantBuffer) {
    const r = M.ensureRt(m); const url = api().mediaUrl(await pcmPath(m));
    const res = await fetch(url); if (!res.ok) throw new Error('pcm ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    const needPeaks = !r._peaks;
    let L = null, R2 = null, ab = null; const parts = [];
    if (wantBuffer && total >= 4) { ab = M.actx().createBuffer(2, total >> 2, 48000); L = ab.getChannelData(0); R2 = ab.getChannelData(1); }
    const STEP = 480; const pk = needPeaks ? [] : null; let pkMax = 0, pkCnt = 0;
    let frame = 0; let carry = null; const rd = res.body.getReader();
    const eat = (u8) => {
      let n = u8.length >> 2; if (!n) return;
      if (L && frame + n > L.length) n = L.length - frame;
      const i16 = new Int16Array(u8.buffer, u8.byteOffset, n * 2);
      if (wantBuffer && !ab) parts.push(new Int16Array(i16)); // unknown length: keep a copy
      for (let i = 0, j = 0; i < n; i++, j += 2) {
        const a = i16[j] / 32768, b = i16[j + 1] / 32768;
        if (L) { L[frame + i] = a; R2[frame + i] = b; }
        if (pk) { const x = a < 0 ? -a : a, y = b < 0 ? -b : b; const v = x > y ? x : y; if (v > pkMax) pkMax = v; if (++pkCnt === STEP) { pk.push(pkMax); pkMax = 0; pkCnt = 0; } }
      }
      frame += n;
    };
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      let u8 = value;
      if (carry) { const t = new Uint8Array(carry.length + u8.length); t.set(carry); t.set(u8, carry.length); u8 = t; carry = null; }
      const use = u8.length & ~3;
      if (use < u8.length) carry = u8.slice(use);
      if (u8.byteOffset & 1) u8 = u8.slice(0, use); // Int16Array needs an aligned view
      eat(u8.subarray(0, use));
    }
    if (pk) { if (pkCnt) pk.push(pkMax); r._peaks = Float32Array.from(pk); savePeaks(m, r._peaks); GW.bus.emit('peaks', m); }
    if (wantBuffer && !ab) { ab = M.actx().createBuffer(2, Math.max(1, frame), 48000); L = ab.getChannelData(0); R2 = ab.getChannelData(1); let o = 0; for (const p of parts) { for (let i = 0, j = 0; j < p.length; i++, j += 2) { L[o + i] = p[j] / 32768; R2[o + i] = p[j + 1] / 32768; } o += p.length >> 1; } }
    return ab;
  }
  // decoded AudioBuffer for playback/mixdown — loaded on demand, LRU-evicted beyond the memory budget
  M.audioBudget = 6 * 1024 * 1024 * 1024;
  M.loadAudio = (m) => {
    const r = M.ensureRt(m);
    if (r._audio) return Promise.resolve(r._audio);
    if (r._aP) return r._aP;
    r._aBusy = 1;
    return r._aP = (async () => {
      try {
        let ab;
        if (m.path && api()) { await M.audioPrep(m); ab = await decodeQ(() => streamPCM(m, true)); }
        else { const buf = r.file ? await r.file.arrayBuffer() : await (await fetch(M.url(m, true))).arrayBuffer(); ab = await M.actx().decodeAudioData(buf); if (!r._peaks) { r._peaks = computePeaks(ab); GW.bus.emit('peaks', m); } }
        r._audio = ab; r._aUsed = now(); if (!m.dur || m.kind === 'audio') m.dur = ab.duration;
        enforceAudioBudget(m);
        if (GW.Audio && GW.Audio.onMediaDecoded) GW.Audio.onMediaDecoded(m);
        return ab;
      } finally { r._aBusy = 0; r._aP = null; }
    })();
  };
  function enforceAudioBudget(keep) {
    let tot = 0; const list = [];
    for (const id in rt.m) { const r = rt.m[id]; if (r._audio) { tot += r._audio.length * r._audio.numberOfChannels * 4; list.push(r); } }
    if (tot <= M.audioBudget) return;
    list.sort((a, b) => (a._aUsed || 0) - (b._aUsed || 0));
    for (const r of list) { if (tot <= M.audioBudget * .8) break; if (r._m === keep || now() - (r._aUsed || 0) < 15000) continue; tot -= r._audio.length * r._audio.numberOfChannels * 4; r._audio = null; }
  }
  // make sure every audio clip in [t0, t1] of sequence s is decoded (export / mixdown)
  M.ensureAudioRange = async (s, t0, t1, depth = 0) => {
    const need = new Set(); const subs = [];
    for (const c of s.clips) {
      if (c.start > t1 || c.start + c.dur < t0) continue;
      if (c.kind === 'nest' && depth < 4) { const sub = GW.prj.seqs.find(x => x.id === c.ref); if (sub && sub !== s) subs.push(M.ensureAudioRange(sub, GW.srcTime(c, Math.max(t0, c.start)), GW.srcTime(c, Math.min(t1, c.start + c.dur)), depth + 1)); continue; }
      if (c.tt === 'a' && c.media) need.add(c.media);
    }
    await Promise.all([...subs, ...[...need].map(id => { const m = GW.media(id); return m && (m.hasAudio || m.kind === 'audio') && !m.offline ? M.loadAudio(m).catch(e => console.warn(e)) : null; })]);
  };
  // prefetch decoded audio around the playhead so playback starts with sound
  M.prefetchAudio = GW.debounce(() => {
    const s = GW.seq && GW.seq(); if (!s) return; const t = s.t || 0;
    for (const c of s.clips) { if (c.tt !== 'a' || !c.media || c.start > t + 120 || c.start + c.dur < t - 5) continue; const m = GW.media(c.media); const r = m && rt.m[m.id]; if (r && r.status === 'ready' && !r._audio && !r._aBusy) M.loadAudio(m).catch(() => {}); }
  }, 400);
  function computePeaks(ab) {
    const rate = 100; const n = Math.ceil(ab.duration * rate); const out = new Float32Array(n);
    const step = ab.sampleRate / rate; const chs = [];
    for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) chs.push(ab.getChannelData(c));
    for (let i = 0; i < n; i++) { let mx = 0; const s0 = Math.floor(i * step), s1 = Math.min(chs[0].length, Math.floor((i + 1) * step)); for (const d of chs) for (let s = s0; s < s1; s += 2) { const v = d[s] < 0 ? -d[s] : d[s]; if (v > mx) mx = v; } out[i] = mx; }
    return out;
  }

  /* ---------- thumbnails: sprite sheet cached on disk, generated on demand (from the proxy when there is one) ---------- */
  const TH_H = 72;
  async function thPath(m) { const p = await cachePaths(); return p.cache + p.sep + (m.key || m.id) + '_th.jpg'; }
  const thCount = (m) => Math.max(1, Math.min(120, Math.ceil((m.dur || 1) / 2)));
  const thW = (m) => Math.max(16, Math.round(TH_H * (m.w || 16) / (m.h || 9)));
  M.loadThumbs = async (m) => {
    const r = M.ensureRt(m); if (r._thumbs || r._thBusy || m.kind !== 'video' || m.offline) return;
    if (r.status !== 'ready' || !m.dur) return;
    r._thBusy = 1;
    try {
      if (m.key && api()) {
        const f = await thPath(m);
        if (await exists(f)) { const img = await loadImg(api().mediaUrl(f)); if (img && img.naturalWidth >= thW(m)) { sliceSprite(m, img); return; } }
      }
      await thumbQ(() => genThumbs(m));
    } catch (e) { console.warn('thumbs', m.name, e); }
    finally { r._thBusy = 0; }
  };
  function loadImg(src) { return new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
  function sliceSprite(m, img) {
    const r = M.ensureRt(m); const cw = thW(m), n = Math.max(1, Math.floor(img.naturalWidth / cw)); const out = [];
    for (let i = 0; i < n; i++) { const c = document.createElement('canvas'); c.width = cw; c.height = TH_H; c.getContext('2d').drawImage(img, i * cw, 0, cw, TH_H, 0, 0, cw, TH_H); out.push({ t: Math.min(m.dur - .05, (i + .5) * m.dur / n), c }); }
    r._thumbs = out; r._thUsed = now(); r._poster = out[Math.floor(n * .1)].c;
    GW.bus.emit('thumbs', m); GW.bus.emit('media-status', m);
  }
  function genThumbs(m) {
    const r = M.ensureRt(m);
    return new Promise((res) => {
      const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; v.src = M.url(m);
      const N = thCount(m), cw = thW(m); const times = Array.from({ length: N }, (_, i) => Math.max(0, Math.min(m.dur - .05, (i + .5) * m.dur / N)));
      const sheet = document.createElement('canvas'); sheet.width = cw * N; sheet.height = TH_H; const sg = sheet.getContext('2d');
      const thumbs = []; let i = 0; let done = false;
      const fin = () => { if (done) return; done = true; clearTimeout(to); v.removeAttribute('src'); try { v.load(); } catch (e) {} res(); };
      const to = setTimeout(fin, 60000 + N * 500);
      const grab = () => {
        const c = document.createElement('canvas'); c.width = cw; c.height = TH_H;
        try { c.getContext('2d').drawImage(v, 0, 0, cw, TH_H); sg.drawImage(c, i * cw, 0); } catch (e) {}
        thumbs.push({ t: times[i], c }); if (i === Math.floor(N * .1)) { r._poster = c; GW.bus.emit('media-status', m); }
        i++;
        if (i < N) v.currentTime = times[i];
        else {
          r._thumbs = thumbs; r._thUsed = now(); if (!r._poster) r._poster = thumbs[0].c;
          GW.bus.emit('thumbs', m); GW.bus.emit('media-status', m);
          if (m.key && api()) sheet.toBlob(async (b) => { try { if (b) await api().writeBin(await thPath(m), await b.arrayBuffer()); } catch (e) {} }, 'image/jpeg', .8);
          fin();
        }
      };
      v.onseeked = grab; v.onloadeddata = () => { v.currentTime = times[0]; };
      v.onerror = fin;
    });
  }
  M.poster = (m) => { M.loadThumbs(m); };
  M.thumbAt = (m, t) => {
    const r = rt.m[m.id]; if (!r) return null; const th = r.thumbs;
    if (!th || !th.length) return r._poster || null;
    const n = th.length; const i = Math.max(0, Math.min(n - 1, Math.round(t / (m.dur || 1) * n - .5)));
    return th[i].c;
  };

  /* ---------- video element pool (one per clip) ---------- */
  const vbin = () => GW.$('#vbin');
  M.vid = (c) => {
    let e = rt.v[c.id];
    const m = GW.media(c.media); if (!m) return null;
    const url = M.url(m, GW.Render && GW.Render.exporting); // exports always decode the full-resolution originals
    if (e && e.url !== url) { M.dropVid(c.id); e = null; }
    if (!e) {
      const el = document.createElement('video'); el.crossOrigin = 'anonymous'; el.muted = true; el.preload = 'auto'; el.playsInline = true; el.disablePictureInPicture = true;
      el.src = url; vbin().append(el);
      el.addEventListener('seeked', () => GW.invalidate && GW.invalidate());
      el.addEventListener('loadeddata', () => GW.invalidate && GW.invalidate());
      e = rt.v[c.id] = { el, url, media: m.id };
    }
    e.used = now();
    return e.el;
  };
  M.dropVid = (id) => { const e = rt.v[id]; if (!e) return; try { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); e.el.remove(); } catch (er) {} delete rt.v[id]; if (GW.R && GW.R.gl) GW.R.dropTex('v:' + id); };
  M.gc = () => {
    const t = now();
    for (const id in rt.v) if (t - rt.v[id].used > 15000) M.dropVid(id);
    for (const id in rt.m) { const r = rt.m[id]; if (r._thumbs && t - (r._thUsed || 0) > 90000) r._thumbs = null; } // sprite stays on disk, poster in memory
  };
  setInterval(() => M.gc(), 5000);
  M.pauseAll = () => { for (const id in rt.v) { const el = rt.v[id].el; if (!el.paused) el.pause(); } };
  M.seekExact = (el, t) => new Promise((res) => {
    if (el.readyState >= 2 && Math.abs(el.currentTime - t) < 1e-3 && !el.seeking) { res(); return; }
    let done = false; const fin = () => { if (done) return; done = true; clearTimeout(to); el.removeEventListener('seeked', on); res(); };
    const on = () => { if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(() => fin()); else fin(); setTimeout(fin, 120); };
    const to = setTimeout(fin, 3000);
    el.addEventListener('seeked', on); el.currentTime = t;
  });
  /* ---------- export decoders (ffmpeg sequential decode instead of a <video> seek per frame) ---------- */
  const ED = M.ExportDec = { on: false, decs: new Map(), ready: new Map(), fps: 30, stats: { ff: 0, el: 0, opens: 0 } };
  ED.begin = (fps) => { ED.end(); ED.on = !!(api() && api().decOpen) && M.cfg.ffDecode !== false; ED.fps = fps; ED.stats = { ff: 0, el: 0, opens: 0 }; };
  ED.end = () => { for (const [, d] of ED.decs) closeDec(d); ED.decs.clear(); ED.ready.clear(); ED.on = false; };
  function closeDec(d) { d.dead = true; if (d.jid) api().decClose(d.jid); }
  ED.eligible = (c, m) => ED.on && m && m.kind === 'video' && m.path && !m.offline && !m.alpha && m.w > 0 && (c.speed || 1) > 0 && !(rt.m[m.id] || {}).blobUrl;
  async function readNext(d) { const p = d.pend || api().decRead(d.jid); d.pend = null; const f = await p; d.k++; d.cur = f; if (f) d.pend = api().decRead(d.jid); return f; }
  async function openDec(c, m, st) {
    const step = (c.speed || 1) / ED.fps;
    const src = m.proxy || m.path; // full-res original (or the full-res optimized copy for undecodable formats)
    // seek just under one source frame early so the frame on screen at st (pts ≤ st) survives ffmpeg's accurate-seek trim;
    // main re-bases time so st ↔ 0 and samples with floor semantics → output frame k = what <video> shows at st + k·step
    const start = Math.max(0, st - .999 / (m.fps || ED.fps));
    const r = await api().decOpen({ path: src, start, offset: st - start, w: m.w, h: m.h, fps: ED.fps / (c.speed || 1) });
    ED.stats.opens++;
    if (!r || !r.ok) return null;
    return { jid: r.id, w: r.w, h: r.h, st0: st, step, k: -1, cur: null, pend: null };
  }
  // decoded frame of clip c at source time st (or null → caller falls back to the <video> element)
  ED.frame = async (c, m, st) => {
    let d = ED.decs.get(c.id);
    if (d && d.fail) return null;
    const want = d ? Math.round((st - d.st0) / d.step) : 0;
    if (d && (want < d.k || want > d.k + 90 || Math.abs((d.st0 + want * d.step) - st) > d.step * .5)) { closeDec(d); ED.decs.delete(c.id); d = null; }
    if (!d) { d = await openDec(c, m, st); if (!d) { ED.decs.set(c.id, { fail: 1 }); return null; } ED.decs.set(c.id, d); }
    const k = Math.round((st - d.st0) / d.step);
    while (d.k < k) { if (!(await readNext(d))) { closeDec(d); ED.decs.set(c.id, { fail: 1 }); return null; } }
    return d.cur ? { data: d.cur, w: d.w, h: d.h } : null;
  };
  // per export frame: drop decoders of clips that are no longer on screen
  ED.retain = (ids) => { for (const [id, d] of ED.decs) if (!ids.has(id)) { if (!d.fail) closeDec(d); ED.decs.delete(id); } };
  M.waitReady = (el) => new Promise(res => { if (el.readyState >= 2) return res(); const f = () => { el.removeEventListener('loadeddata', f); res(); }; el.addEventListener('loadeddata', f); setTimeout(res, 5000); });
})();
