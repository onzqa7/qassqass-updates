'use strict';
/* Voice-over recording (تسجيل تعليق صوتي), like Premiere's Voice-over Record button.
   Mic button on each audio track header (ui_timeline.js) · Sequence menu · shortcut 'seq.voiceover'.
   Flow: input device (remembered) → 3-2-1 countdown → the sequence plays from the playhead (minus pre-roll) while the mic is
   captured as raw PCM through the app AudioContext (same clock as playback, so samples map exactly to sequence time) →
   stop on Space / Esc / the button → 16-bit WAV in Documents/QassQass/recordings → imported and placed on the track at the
   start time (overwrite), as ONE undo step. */
(function () {
  const { esc } = GW;
  const VO = GW.VO = { rec: null };
  const CFG_KEY = 'gws.vo';
  VO.cfg = { deviceId: '', deviceLabel: '', countdown: 1, preroll: 0, muteOthers: 1, asked: 0 };
  try { Object.assign(VO.cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(VO.cfg)); } catch (e) {} };
  VO.icon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="5.5" y="1.8" width="5" height="8" rx="2.5"/><path d="M3.3 7.6a4.7 4.7 0 009.4 0M8 12.4v2"/></svg>';

  const css = document.createElement('style');
  css.textContent = `
.th-row .ib.vo{color:#7f7f7f}.th-row .ib.vo:hover{color:#ff8a80}.th-row .ib.vo.on{color:#fff;background:#b3261e}
.vo-count{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;pointer-events:none;background:rgba(0,0,0,.25)}
.vo-count b{font:700 120px var(--f-mono,monospace);color:#fff;text-shadow:0 4px 24px rgba(0,0,0,.6);width:200px;height:200px;border-radius:50%;display:grid;place-items:center;background:rgba(179,38,30,.85)}
.vo-hud{position:fixed;z-index:8999;top:56px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg2,#222);border:1px solid #b3261e;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:12px;color:var(--text,#ddd)}
.vo-hud .dot{width:10px;height:10px;border-radius:50%;background:#e53935;animation:voblink 1s infinite}
@keyframes voblink{50%{opacity:.25}}
.vo-hud .tc{font:600 13px var(--f-mono,monospace);direction:ltr;min-width:96px}
.vo-hud .lvl{width:160px;height:10px;background:#111;border-radius:3px;overflow:hidden;position:relative;direction:ltr}
.vo-hud .lvl i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,var(--green,#3fb950) 0,var(--green,#3fb950) 70%,var(--yellow,#e3b341) 85%,var(--red,#e5534b) 100%)}
.vo-hud .lvl u{position:absolute;top:0;bottom:0;width:2px;background:#fff;left:0}
.vo-hud .db{font:11px var(--f-mono,monospace);color:var(--text2,#aaa);direction:ltr;min-width:44px}
.vo-dev .meter{height:8px;background:#111;border-radius:3px;overflow:hidden;direction:ltr;margin-top:6px}.vo-dev .meter i{display:block;height:100%;width:0;background:var(--accent,#2f8ef0)}`;
  document.head.append(css);

  /* ---------- devices & settings ---------- */
  async function devices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) { return []; }
  }
  function getStream(deviceId) {
    const a = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } };
    if (deviceId) a.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ audio: a, video: false }).catch(e => {
      if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) return navigator.mediaDevices.getUserMedia({ audio: { ...a, deviceId: undefined } }); // remembered device unplugged → default
      throw e;
    });
  }
  VO.settings = () => new Promise(async (resolve) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { GW.toast('الميكروفون غير متاح في هذه البيئة', 'err'); return resolve(false); }
    let probe = null; try { probe = await getStream(VO.cfg.deviceId); } catch (e) { GW.toast('تعذر الوصول إلى الميكروفون: ' + (e.message || e.name), 'err'); return resolve(false); }
    const list = await devices(); // labels are only filled after permission
    const body = document.createElement('div'); body.className = 'form vo-dev'; body.style.padding = '0';
    body.innerHTML = `<div class="frow"><label>جهاز الإدخال</label><div class="ctl"><select class="sel" data-k="dev">${list.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || ('ميكروفون ' + (i + 1)))}</option>`).join('') || '<option value="">الافتراضي</option>'}</select></div></div>
      <div class="frow"><label>مستوى الإدخال</label><div class="ctl" style="display:block"><div class="meter"><i data-k="m"></i></div></div></div>
      <div class="frow"><label>العد التنازلي</label><div class="ctl"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="cd"> عد تنازلي 3-2-1 قبل التسجيل</label></div></div>
      <div class="frow"><label>التشغيل المسبق قبل نقطة التسجيل</label><div class="ctl"><select class="sel" data-k="pre">${[0, 1, 2, 3, 5].map(v => `<option value="${v}">${v ? v + (GW.lang === 'en' ? ' s' : ' ث') : 'بدون'}</option>`).join('')}</select></div></div>
      <div class="frow"><label>الصوت أثناء التسجيل</label><div class="ctl"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="mute"> كتم صوت المسارات الأخرى أثناء التسجيل</label></div></div>
      <p style="color:var(--text2);font-size:11px;margin:8px 0 0">يُحفظ التسجيل بصيغة WAV في مجلد المستندات/QassQass/recordings. أوقف التسجيل بمفتاح المسافة أو Esc.</p>`;
    const q = k => body.querySelector(`[data-k=${k}]`);
    const cur = probe.getAudioTracks()[0]; const curId = cur && cur.getSettings ? cur.getSettings().deviceId : '';
    const dev = q('dev'); if ([...dev.options].some(o => o.value === (VO.cfg.deviceId || curId))) dev.value = VO.cfg.deviceId || curId;
    q('cd').checked = !!VO.cfg.countdown; q('pre').value = String(VO.cfg.preroll || 0); q('mute').checked = !!VO.cfg.muteOthers;
    // live input meter for the chosen device
    let stream = probe, raf = 0, an = null, src = null; const buf = new Float32Array(1024);
    const hook = () => { try { src && src.disconnect(); } catch (e) {} const ctx = GW.Media.actx(); if (ctx.state === 'suspended') ctx.resume(); src = ctx.createMediaStreamSource(stream); an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an); };
    const tick = () => { if (an) { an.getFloatTimeDomainData(buf); let p = 0; for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i])); const db = p > 0 ? 20 * Math.log10(p) : -90; q('m').style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%'; } raf = requestAnimationFrame(tick); };
    hook(); tick();
    dev.onchange = async () => { stream.getTracks().forEach(t => t.stop()); try { stream = await getStream(dev.value); hook(); } catch (e) { GW.toast('تعذر فتح الجهاز: ' + e.message, 'err'); } };
    const cleanup = () => { cancelAnimationFrame(raf); try { src && src.disconnect(); } catch (e) {} stream.getTracks().forEach(t => t.stop()); };
    GW.modal({ title: 'إعدادات التسجيل الصوتي', width: 560, body, buttons: [{ label: 'إلغاء', value: false }, { label: 'حفظ', primary: true, value: true, action: () => {
      const o = dev.selectedOptions[0]; VO.cfg.deviceId = dev.value; VO.cfg.deviceLabel = o ? o.textContent : ''; VO.cfg.countdown = q('cd').checked ? 1 : 0; VO.cfg.preroll = +q('pre').value || 0; VO.cfg.muteOthers = q('mute').checked ? 1 : 0; VO.cfg.asked = 1; saveCfg();
    } }], onClose: v => { cleanup(); resolve(!!v); } });
  });

  /* ---------- recording ---------- */
  const tgtTrack = () => (GW.TL && GW.TL.target ? GW.TL.target.a : 0) || 0;
  VO.toggle = (ti) => VO.rec ? VO.stop() : VO.start(ti == null ? tgtTrack() : ti);
  VO.isRecording = () => !!VO.rec;
  VO.start = async (ti, opts = {}) => {
    if (VO.rec) return VO.stop();
    const s = GW.seq(); ti = Math.max(0, ti | 0); GW.ops.ensureTrack(s, 'a', ti);
    if ((s.at[ti] || {}).lock) { GW.toast('المسار مقفل: افتح القفل للتسجيل عليه', 'err'); return false; }
    if (!window.gws) { GW.toast('التسجيل متاح في نسخة سطح المكتب', 'err'); return false; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { GW.toast('الميكروفون غير متاح في هذه البيئة', 'err'); return false; }
    if (!VO.cfg.asked && !opts.noDialog) { const ok = await VO.settings(); if (!ok) return false; }
    const cfg = { ...VO.cfg, ...opts };
    GW.stop();
    let stream; try { stream = await getStream(cfg.deviceId); } catch (e) { GW.toast('تعذر الوصول إلى الميكروفون: ' + (e.message || e.name), 'err'); return false; }
    const ctx = GW.Media.actx(); if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const R = VO.rec = { s, ti, start: GW.snapFrame(s.t, s.fps), stream, chunks: [], peaks: [], state: 'count', level: 0, peakHold: 0, cfg, sr: ctx.sampleRate };
    GW.TL && GW.TL.renderHeads && GW.TL.renderHeads();
    // capture graph: mic → ScriptProcessor (raw PCM) → silent sink (keeps the processor pulled)
    const src = ctx.createMediaStreamSource(stream); const N = 2048;
    const sp = ctx.createScriptProcessor(N, 1, 1); const sink = ctx.createGain(); sink.gain.value = 0;
    src.connect(sp); sp.connect(sink); sink.connect(ctx.destination); R.nodes = [src, sp, sink];
    sp.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0); let p = 0; for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > p) p = a; }
      R.level = p; R.peakHold = Math.max(p, R.peakHold * .97);
      if (R.state !== 'rec' || !GW.Audio.playing) return;
      // sequence time of the first input sample: the input block was captured one block before its output plays
      const ctxT = e.playbackTime - d.length / ctx.sampleRate;
      const t = GW.Audio.t0 + (ctxT - GW.Audio.c0);
      R.chunks.push({ t, d: new Float32Array(d) }); R.peaks.push([t, p]);
    };
    hud(R);
    if (cfg.countdown) { const ok = await countdown(R); if (!ok) { cleanup(R); VO.rec = null; GW.TL && GW.TL.renderHeads(); return false; } }
    if (VO.rec !== R) return false;
    // transport: play from start − pre-roll; keep playing past the sequence end while recording
    const t0 = Math.max(0, R.start - (cfg.preroll || 0)); R.outP0 = s.outP; R.loop0 = GW.pb.loop; GW.pb.loop = false;
    s.outP = Math.max(GW.seqDur(s), R.start) + 6 * 3600;
    s.t = t0; GW.play(1); R.state = 'rec';
    if (cfg.muteOthers && GW.Audio.master) { R.mg = GW.Audio.master.gain.value; GW.Audio.master.gain.value = 0; }
    R.onKey = (e) => { if (e.key === ' ' || e.code === 'Space' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); if (!e.repeat) VO.stop(); } };
    window.addEventListener('keydown', R.onKey, true);
    return true;
  };
  function countdown(R) {
    return new Promise(res => {
      const el = document.createElement('div'); el.className = 'vo-count'; document.body.append(el); let n = 3;
      R.cdEl = el; R.cdCancel = () => { clearInterval(iv); el.remove(); window.removeEventListener('keydown', onk, true); res(false); };
      const onk = (e) => { if (e.key === 'Escape' || e.key === ' ' || e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); R.cdCancel(); } };
      window.addEventListener('keydown', onk, true);
      const show = () => { el.innerHTML = `<b>${n}</b>`; };
      show(); const iv = setInterval(() => { n--; if (n <= 0) { clearInterval(iv); el.remove(); window.removeEventListener('keydown', onk, true); R.cdCancel = null; res(true); } else show(); }, 1000);
    });
  }
  function hud(R) {
    const el = document.createElement('div'); el.className = 'vo-hud'; el.dir = 'rtl';
    el.innerHTML = `<span class="dot"></span><b>تسجيل تعليق صوتي</b><span style="color:var(--text2)">A${R.ti + 1}</span><span class="tc" data-k="tc">00:00:00:00</span><span class="lvl"><i data-k="lv"></i><u data-k="pk"></u></span><span class="db" data-k="db">-∞ dB</span><button class="btn sm pri" data-k="stop">${GW.ico ? GW.ico('stop', 12) : ''} إيقاف</button>`;
    document.body.append(el); R.hud = el;
    el.querySelector('[data-k=stop]').onclick = () => VO.stop();
    const lv = el.querySelector('[data-k=lv]'), pk = el.querySelector('[data-k=pk]'), tc = el.querySelector('[data-k=tc]'), dbEl = el.querySelector('[data-k=db]');
    const pct = v => { const db = v > 0 ? 20 * Math.log10(v) : -90; return Math.max(0, Math.min(100, (db + 60) / 60 * 100)); };
    const loop = () => {
      if (VO.rec !== R) return;
      lv.style.width = pct(R.level) + '%'; pk.style.left = pct(R.peakHold) + '%';
      const db = R.level > 0 ? 20 * Math.log10(R.level) : -90; dbEl.textContent = db <= -60 ? '-∞ dB' : db.toFixed(1) + ' dB';
      const el2 = R.state === 'rec' ? Math.max(0, R.s.t - R.start) : 0; tc.textContent = GW.fmtTC(el2, R.s.fps);
      R.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  function cleanup(R) {
    cancelAnimationFrame(R.raf); if (R.cdCancel) R.cdCancel();
    for (const n of R.nodes || []) { try { n.onaudioprocess = null; n.disconnect(); } catch (e) {} }
    try { R.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    if (R.hud) R.hud.remove(); if (R.onKey) window.removeEventListener('keydown', R.onKey, true);
  }
  // overlay on the timeline: growing recording region + live peaks on the target track (called from drawOverlay)
  VO.drawOverlay = (g, W, H) => {
    const R = VO.rec; if (!R || R.state !== 'rec' || R.s !== GW.seq() || !GW.TL) return;
    const TL = GW.TL; const row = TL.rowOf('a', R.ti); if (!row) return;
    const x0 = Math.round(TL.x(R.start)), x1 = Math.round(TL.x(Math.max(R.start, R.s.t))); const y = row.y - TL.vs + 1, h = row.h - 2;
    if (x1 < 0 || x0 > W) return;
    g.fillStyle = 'rgba(179,38,30,.55)'; g.fillRect(x0, y, Math.max(1, x1 - x0), h);
    g.strokeStyle = '#ff5a4f'; g.lineWidth = 1; g.strokeRect(x0 + .5, y + .5, Math.max(1, x1 - x0) - 1, h - 1);
    g.fillStyle = 'rgba(255,255,255,.85)'; const mid = y + h / 2; let lastX = -1;
    for (const [t, p] of R.peaks) { if (t < R.start) continue; const x = Math.round(TL.x(t)); if (x === lastX || x < x0 || x > x1) continue; lastX = x; const a = Math.max(1, p * (h / 2 - 2)); g.fillRect(x, mid - a, 1, a * 2); }
    if (h > 16) { g.fillStyle = '#fff'; g.font = '600 10px sans-serif'; g.textBaseline = 'top'; g.fillText(GW.tr ? GW.tr('تسجيل…') : 'تسجيل…', x0 + 4, y + 2); }
  };

  VO.stop = async () => {
    const R = VO.rec; if (!R) return null;
    if (R.state === 'count') { cleanup(R); VO.rec = null; GW.TL && GW.TL.renderHeads(); return null; }
    if (R.state !== 'rec') return null;
    R.state = 'saving'; const stopT = GW.Audio.playing && GW.Audio.now() != null ? GW.Audio.now() : R.s.t; // audio clock: exact even when frames lag
    GW.stop(); if (R.mg != null && GW.Audio.master) GW.Audio.master.gain.value = R.mg;
    R.s.outP = R.outP0; GW.pb.loop = R.loop0;
    await GW.sleep(60); cleanup(R); VO.rec = null; GW.TL && GW.TL.renderHeads();
    try {
      const sr = R.sr; const chunks = R.chunks;
      if (!chunks.length) { GW.toast('لم يُسجَّل أي صوت', 'err'); GW.seek(R.start); return null; }
      const dur = Math.max(0, stopT - R.start); const n = Math.round(dur * sr);
      if (n < sr * 0.1) { GW.toast('التسجيل قصير جدًا', 'err'); GW.seek(R.start); return null; }
      const pcm = new Float32Array(n);
      // place every chunk by its own timestamp → robust to dropped blocks; gaps stay silent
      let lastEnd = -Infinity;
      for (const c of chunks) {
        let off = Math.round((c.t - R.start) * sr); if (off < lastEnd && off > lastEnd - c.d.length) off = lastEnd; // remove jitter overlaps
        for (let i = 0; i < c.d.length; i++) { const k = off + i; if (k >= 0 && k < n) pcm[k] = c.d[i]; }
        lastEnd = off + c.d.length;
      }
      const wav = GW.Audio.wav({ sampleRate: sr, length: n, numberOfChannels: 1, getChannelData: () => pcm });
      const P = await gws.paths(); const dir = P.renders + P.sep + 'recordings';
      const d = new Date(); const p2 = v => String(v).padStart(2, '0');
      const name = `VO_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}_A${R.ti + 1}.wav`;
      const path = dir + P.sep + name;
      await gws.writeBin(path, wav);
      const clip = await VO.place(R.s, R.ti, R.start, path, name, n / sr);
      GW.toast('تم حفظ التعليق الصوتي: ' + name);
      return clip ? { path, clip: clip.id, start: clip.start, dur: clip.dur, track: 'A' + (R.ti + 1) } : { path };
    } catch (e) { console.error(e); GW.toast('تعذر حفظ التسجيل: ' + e.message, 'err'); return null; }
  };
  // import the file and drop it on the track at t; the import + placement are merged into one undo step
  VO.place = async (s, ti, t, path, name, dur) => {
    const H = GW.hist; const i0 = H.idx;
    const added = await GW.Media.importFiles([{ path, name, size: 1 }]);
    const m = (added && added[0]) || GW.prj.media.find(x => x.path === path); if (!m) return null;
    if (!GW.prj.seqs.includes(s)) s = GW.seq();
    GW.ops.ensureTrack(s, 'a', ti);
    const c = GW.newClip('audio', { seq: s, media: m.id, name: m.name, ti, start: t, dur: Math.min(dur, m.dur || dur), in: 0, label: m.label });
    GW.ops.place(s, c, 'overwrite');
    GW.sel.clips = new Set([c.id]);
    const label = 'تسجيل تعليق صوتي';
    if (H.idx > i0) { H.stack[H.idx] = JSON.stringify(GW.prj); H.labels[H.idx] = label; H.stack.length = H.idx + 1; H.labels.length = H.idx + 1; GW.bus.emit('hist'); GW.bus.emit('changed'); GW.markDirty(); }
    else GW.commit(label);
    GW.seek(t + c.dur); GW.TL && GW.TL.invalidate(); GW.bus.emit('selection'); GW.invalidate();
    return c;
  };

  // playback stopped some other way (monitor button, end of a nested sequence…) → finish the take
  GW.bus.on('play', (p) => { if (!p && VO.rec && VO.rec.state === 'rec') VO.stop(); });
  GW.bus.on('project', () => { if (VO.rec && VO.rec.s !== GW.seq()) VO.stop(); });
})();
if (GW.TL && GW.TL.headsIn) GW.TL.renderHeads();
