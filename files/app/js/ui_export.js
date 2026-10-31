'use strict';
/* Export: render every frame on the GPU, pipe raw frames to FFmpeg, mux the offline audio mix */
(function () {
  const { $, clamp, esc } = GW;
  const UI = GW.UI;
  const FORMATS = [
    ['mp4', 'H.264 — MP4 (موصى به)', 'mp4', false, true], ['mp4h265', 'H.265 / HEVC — MP4', 'mp4', false, true], ['mov', 'Apple ProRes — MOV (يدعم الشفافية)', 'mov', true, true],
    ['webm', 'VP9 — WebM (يدعم الشفافية)', 'webm', true, true], ['png', 'تسلسل صور PNG (يدعم الشفافية)', 'png', true, false], ['jpg', 'تسلسل صور JPEG', 'jpg', false, false],
    ['gif', 'صورة متحركة GIF', 'gif', false, false], ['wav', 'صوت فقط — WAV', 'wav', false, true], ['mp3', 'صوت فقط — MP3', 'mp3', false, true]
  ];
  const fmtOf = k => FORMATS.find(f => f[0] === k);
  const state = { fmt: 'mp4', res: 'seq', fps: 'seq', q: 'high', range: 'all', audio: 1, alpha: 0, hw: 1, out: '' };
  const HWFMT = { mp4: 'h264_nvenc', mp4h265: 'hevc_nvenc' };
  try { Object.assign(state, JSON.parse(localStorage.getItem('gws.export') || '{}')); } catch (e) {}

  function resList(s) {
    const ar = s.w / s.h; const out = [['seq', `مطابقة التسلسل (${s.w}×${s.h})`]];
    for (const h of [2160, 1440, 1080, 720, 480]) { const short = Math.min(s.w, s.h); if (h === short) continue; const k = h / short; const w = Math.round(s.w * k / 2) * 2, hh = Math.round(s.h * k / 2) * 2; out.push([k.toFixed(4), `${w}×${hh}`]); }
    return out;
  }
  function dims(s, o) { o = o || state; if (o.res === 'seq') return [s.w, s.h, 1]; const k = +o.res; return [Math.round(s.w * k / 2) * 2, Math.round(s.h * k / 2) * 2, k]; }
  function range(s, o) { o = o || state; const d = GW.seqDur(s); if (o.t0 != null && o.t1 != null && +o.t1 > +o.t0) return [Math.max(0, +o.t0), Math.min(d, +o.t1)]; /* explicit range: export queue / API */ if (o.range === 'io' && (s.inP != null || s.outP != null)) return [s.inP || 0, s.outP ?? d]; return [0, d]; }

  UI.exportDialog = async () => {
    GW.stop(); const s = GW.seq(); const d = GW.seqDur(s);
    if (d <= 0) { GW.toast('التسلسل فارغ: أضف مقاطع قبل التصدير'); return; }
    if (!window.gws) { GW.toast('التصدير متاح في نسخة سطح المكتب من البرنامج', 'err'); return; }
    const paths = await gws.paths();
    const body = document.createElement('div'); body.className = 'exp';
    body.innerHTML = `<div class="form" style="padding:0">
        <div class="frow"><label>الصيغة</label><div class="ctl"><select class="sel" data-k="fmt">${FORMATS.map(f => `<option value="${f[0]}">${f[1]}</option>`).join('')}</select></div></div>
        <div class="frow"><label>الدقة</label><div class="ctl"><select class="sel" data-k="res">${resList(s).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div></div>
        <div class="frow"><label>معدل الإطارات</label><div class="ctl"><select class="sel" data-k="fps"><option value="seq">مطابقة التسلسل (${s.fps})</option>${[24, 25, 30, 50, 60].map(f => `<option value="${f}">${f}</option>`).join('')}</select></div></div>
        <div class="frow"><label>الجودة</label><div class="ctl"><select class="sel" data-k="q"><option value="best">أفضل (حجم كبير)</option><option value="high">عالية</option><option value="medium">متوسطة</option><option value="low">منخفضة (حجم صغير)</option></select></div></div>
        <div class="frow"><label>النطاق</label><div class="ctl"><select class="sel" data-k="range"><option value="all">التسلسل كاملًا</option><option value="io">من نقطة الدخول إلى الخروج</option></select></div></div>
        <div class="frow"><label>الصوت</label><div class="ctl"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="audio"> تضمين الصوت</label></div></div>
        <div class="frow" data-row="hw"><label>الترميز</label><div class="ctl"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="hw"> ترميز بالعتاد (NVIDIA NVENC)</label><small data-k="hwnote" style="color:var(--text2);margin-inline-start:8px"></small></div></div>
        <div class="frow" data-row="alpha"><label>الشفافية</label><div class="ctl"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="alpha"> خلفية شفافة (قناة ألفا)</label></div></div>
        <div class="frow"><label>ملف الإخراج</label><div class="ctl"><input class="inp" data-k="out" dir="ltr"><button class="btn sm" data-k="browse">استعراض…</button></div></div>
      </div>
      <div><div class="prev"><canvas data-k="prev"></canvas></div><div class="sum" data-k="sum"></div>
        <div data-k="progbox" hidden style="margin-top:10px"><div class="prog"><i data-k="bar"></i></div><div class="sum" data-k="stat"></div></div></div>`;
    const q = k => body.querySelector(`[data-k=${k}]`);
    for (const k of ['fmt', 'res', 'fps', 'q', 'range']) { const el = q(k); if ([...el.options].some(o => o.value === String(state[k]))) el.value = state[k]; el.onchange = () => { state[k] = el.value; if (k === 'fmt') fixExt(); upd(); }; }
    q('audio').checked = !!state.audio; q('audio').onchange = () => { state.audio = q('audio').checked ? 1 : 0; upd(); };
    q('alpha').checked = !!state.alpha; q('alpha').onchange = () => { state.alpha = q('alpha').checked ? 1 : 0; upd(); };
    let caps = null; q('hw').checked = !!state.hw; q('hw').onchange = () => { state.hw = q('hw').checked ? 1 : 0; upd(); };
    q('hwnote').textContent = 'جارٍ الفحص…'; GW.Media.caps().then(c => { caps = c || {}; upd(); });
    const safeName = (s.name || 'export').replace(/[\\/:*?"<>|]+/g, '_');
    q('out').value = (state.outDir || paths.renders) + paths.sep + safeName + '.' + fmtOf(state.fmt)[2];
    function fixExt() { const ext = fmtOf(state.fmt)[2]; q('out').value = q('out').value.replace(/\.[a-z0-9]+$/i, '') + '.' + ext; }
    fixExt();
    q('browse').onclick = async () => { const f = fmtOf(state.fmt); const p = await gws.saveDialog({ title: 'حفظ الملف المصدّر', defaultPath: q('out').value, ext: f[2] }); if (p) q('out').value = p; };
    function upd() {
      const f = fmtOf(state.fmt); body.querySelector('[data-row=alpha]').hidden = !f[3]; q('audio').disabled = !f[4];
      body.querySelector('[data-row=hw]').hidden = !HWFMT[state.fmt];
      const hwAvail = !!(caps && HWFMT[state.fmt] && caps[HWFMT[state.fmt]]); q('hw').disabled = !hwAvail;
      q('hwnote').textContent = !caps ? 'جارٍ الفحص…' : hwAvail ? (state.hw ? 'أسرع بعدة مرات' : '') : 'غير متاح على هذا الجهاز (ترميز برمجي)';
      const [w, h] = dims(s); const fps = state.fps === 'seq' ? s.fps : +state.fps; const [a, b] = range(s); const dur = Math.max(0, b - a);
      const mbps = { mp4: { best: 40, high: 22, medium: 12, low: 6 }, mp4h265: { best: 24, high: 13, medium: 7, low: 3.5 }, mov: { best: 300, high: 300, medium: 220, low: 220 }, webm: { best: 18, high: 10, medium: 6, low: 3 }, gif: { best: 30, high: 30, medium: 30, low: 30 }, png: { best: 600, high: 600, medium: 600, low: 600 }, jpg: { best: 120, high: 120, medium: 120, low: 120 }, wav: { best: 1.5, high: 1.5, medium: 1.5, low: 1.5 }, mp3: { best: .32, high: .32, medium: .32, low: .32 } }[state.fmt][state.q] * (w * h) / (1920 * 1080) * (state.fmt === 'wav' || state.fmt === 'mp3' ? 1920 * 1080 / (w * h) : fps / 30);
      const encName = HWFMT[state.fmt] ? (hwAvail && state.hw ? HWFMT[state.fmt] : (state.fmt === 'mp4' ? 'libx264' : 'libx265')) : '';
      q('sum').innerHTML = `${esc(f[1])}${encName ? ' · ' + encName : ''}<br>${w}×${h} · ${fps} fps · ${GW.fmtTC(dur, fps)} (${Math.round(dur * fps)} إطار)<br>الحجم التقديري: ${(mbps * dur / 8).toFixed(1)} MB`;
    }
    // preview of the current frame
    try { const pc = q('prev'); const [w, h] = dims(s); const sc = Math.min(1, 480 / w); pc.width = Math.round(w * sc); pc.height = Math.round(h * sc); GW.Program.draw(); pc.getContext('2d').drawImage(GW.R.canvas, 0, 0, pc.width, pc.height); } catch (e) {}
    upd();
    let running = false, cancel = false;
    const dlg = GW.modal({ title: 'تصدير الوسائط', width: 860, body, buttons: [
      { label: 'إغلاق', action: () => { if (running) { cancel = true; return false; } } },
      { label: 'تصدير', primary: true, action: async (el) => {
        if (running) return false; running = true; cancel = false; const btn = el.querySelectorAll('.dlg-f .btn')[1]; btn.disabled = true; el.querySelectorAll('.dlg-f .btn')[0].textContent = 'إلغاء';
        state.out = q('out').value; state.outDir = state.out.replace(/[\\/][^\\/]*$/, ''); try { localStorage.setItem('gws.export', JSON.stringify(state)); } catch (e) {}
        q('progbox').hidden = false;
        const res = await runExport(s, { ...state, out: q('out').value }, (p, msg) => { q('bar').style.width = (p * 100).toFixed(1) + '%'; q('stat').innerHTML = msg; }, () => cancel, q('prev'));
        running = false; btn.disabled = false; el.querySelectorAll('.dlg-f .btn')[0].textContent = 'إغلاق';
        if (res.ok) { q('stat').innerHTML = `<span style="color:var(--green)">تم التصدير بنجاح ✓</span><br>${esc(res.out)}`; showDone(el, res.out); }
        else if (res.cancelled) q('stat').textContent = 'تم إلغاء التصدير';
        else { q('stat').innerHTML = `<span style="color:var(--red)">فشل التصدير</span><br><pre style="white-space:pre-wrap;max-height:120px;overflow:auto;font-size:10px">${esc((res.log || res.error || '').slice(-1500))}</pre>`; }
        return false;
      } }] });
    function showDone(el, out) { const f = el.querySelector('.dlg-f'); if (f.querySelector('[data-done]')) return; const a = document.createElement('button'); a.className = 'btn'; a.dataset.done = 1; a.textContent = 'فتح المجلد'; a.onclick = () => gws.showItem(out); const b = document.createElement('button'); b.className = 'btn'; b.dataset.done = 1; b.textContent = 'تشغيل الملف'; b.onclick = () => gws.openPath(out); f.append(a, b); }
  };

  async function runExport(s, o, onProg, isCancel, prevCanvas) {
    const f = fmtOf(o.fmt); const [w, h, k] = dims(s, o); const fps = o.fps === 'seq' ? s.fps : +o.fps;
    const [t0, t1] = range(s, o); const n = Math.max(1, Math.round((t1 - t0) * fps));
    const paths = await gws.paths(); const tmpWav = paths.temp + paths.sep + 'gws_mix_' + Date.now() + '.wav';
    let out = o.out; if (o.fmt === 'png' || o.fmt === 'jpg') { const base = out.replace(/\.[a-z]+$/i, ''); out = base + paths.sep + base.split(/[\\/]/).pop() + '_%05d.' + o.fmt; }
    const started = performance.now(); const stats = {}; let pxMax = null, res = null;
    try {
      onProg(0, 'تجهيز الموارد…');
      await document.fonts.ready;
      let audioPath = null;
      if (f[4] && o.audio) { onProg(0, 'تجهيز الصوت…'); await GW.Media.ensureAudioRange(s, t0, t1); }
      if (f[4] && o.audio && GW.Audio.hasAudio(s)) { onProg(0, 'مزج الصوت…'); const ab = await GW.Audio.mixdown(s, t0, t1); await gws.writeBin(tmpWav, GW.Audio.wav(ab)); audioPath = tmpWav; }
      if (o.fmt === 'wav' || o.fmt === 'mp3') {
        if (!audioPath) return { ok: false, error: 'لا يوجد صوت في التسلسل' };
        const r = await gws.ffRun('exp', FFArgs.encodeArgs({ format: o.fmt, audio: audioPath, out })); await gws.remove(tmpWav);
        onProg(1, 'تم'); return { ok: r.ok, out, log: r.log };
      }
      const alpha = f[3] && o.alpha;
      // encoder: NVENC when asked for and detected; GPU-side yuv420p conversion for the 4:2:0 formats
      const caps = HWFMT[o.fmt] && o.hw !== 0 ? await GW.Media.caps() : {};
      let hw = HWFMT[o.fmt] && o.hw !== 0 && caps[HWFMT[o.fmt]] ? 'nvenc' : null;
      const yuv = !alpha && ['mp4', 'mp4h265', 'webm'].includes(o.fmt) && GW.R.canYUV(w, h) && o.gpuYuv !== 0 && !!GW.R.readback;
      const mode = yuv ? 'yuv' : alpha !== false ? 'rgba-straight' : 'rgba';
      GW.Render.exporting = true; GW.Media.ExportDec.begin(o.ffDecode === 0 ? 0 : fps); if (o.ffDecode === 0) GW.Media.ExportDec.on = false;
      const PXQ = GW.Media.Proxy; pxMax = PXQ.max; PXQ.max = 0; // give the encoder the GPU: background proxies wait
      res = await encodePass(hw);
      if (res.retry) { console.warn('hardware encoder failed, falling back to software', res.log); onProg(0, 'تعذر الترميز بالعتاد — إعادة المحاولة بالترميز البرمجي…'); hw = null; res = await encodePass(null); }
      if (!res.ok) return res;
      stats.hw = hw; stats.yuv = yuv; stats.dec = { ...GW.Media.ExportDec.stats }; stats.fps = n / ((performance.now() - started) / 1000);
      async function encodePass(hw) {
        const job = await gws.ffStart({ w, h, fps, format: o.fmt, out, audio: audioPath, quality: o.q, alpha, hw, inFmt: yuv ? 'yuv420p' : 'rgba' });
        if (!job.ok) return { ok: false, error: job.error };
        const rb = GW.R.readback(w, h, mode); const bytes = rb.bytes;
        const B = Math.max(1, Math.min(8, Math.floor((8 << 20) / bytes))); // pack small frames into ~8 MB writes
        const bufs = [0, 1, 2].map(() => new Uint8Array(bytes * B)); let bi = 0, fill = 0; const inflight = [];
        let sent = 0;
        const flush = async (final) => {
          if (fill) { const b = bufs[bi]; inflight.push(gws.ffFrame(job.id, fill === B ? b : b.subarray(0, fill * bytes))); sent += fill; bi = (bi + 1) % 3; fill = 0; }
          while (inflight.length >= 2 || (final && inflight.length)) if (!(await inflight.shift())) return false;
          return true;
        };
        const fail = async () => { rb.dispose(); const r = await gws.ffEnd(job.id); if (hw && sent <= B * 4) return { retry: true, log: r.log }; return { ok: false, log: r.log }; };
        let pending = null, lastUi = 0, lastPrev = -1e9;
        try {
          for (let i = 0; i < n; i++) {
            if (isCancel()) { rb.dispose(); await gws.ffCancel(job.id); return { cancelled: true }; }
            const t = t0 + i / fps;
            await GW.Render.prepareExportFrame(s, t, k);
            let acc = GW.Render.frame(s, t, { scale: k, exporting: true });
            if (GW.OfxFx && GW.OfxFx.pending()) acc = await GW.OfxFx.settle(acc, () => GW.Render.frame(s, t, { scale: k, exporting: true })); // OFX effects answer asynchronously (ofx_fx.js)
            if (acc.w !== w || acc.h !== h) { GW.R.free(acc); throw new Error('حجم الإطار غير متطابق'); }
            const slot = rb.kick(acc);
            const tn = performance.now();
            if (prevCanvas && tn - lastPrev > 500) { lastPrev = tn; const cv = GW.R.canvas; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } GW.R.present(acc, [0, 0, 0]); prevCanvas.getContext('2d').drawImage(cv, 0, 0, prevCanvas.width, prevCanvas.height); }
            GW.R.free(acc);
            if (pending) { await rb.collect(pending, bufs[bi].subarray(fill * bytes, (fill + 1) * bytes)); if (++fill === B && !(await flush(false))) return await fail(); }
            pending = slot;
            if (tn - lastUi > 200 || i === n - 1) { lastUi = tn; const el = (tn - started) / 1000; const sp = (i + 1) / el; const rem = (n - i - 1) / Math.max(sp, .01); onProg((i + 1) / n, `الإطار ${i + 1} / ${n} · ${sp.toFixed(1)} إطار/ث · المتبقي ${GW.fmtDur(rem)}${hw ? ' · NVENC' : ''}`); await GW.sleep(0); }
            if (i % 60 === 59) GW.R.trimPool();
          }
          if (pending) { await rb.collect(pending, bufs[bi].subarray(fill * bytes, (fill + 1) * bytes)); fill++; }
          if (!(await flush(true))) return await fail();
        } catch (e) { rb.dispose(); try { await gws.ffCancel(job.id); } catch (er) {} throw e; }
        rb.dispose();
        return { ok: true, job };
      }
      onProg(1, 'إنهاء الملف…');
      const r = await gws.ffEnd(res.job.id);
      if (audioPath) await gws.remove(tmpWav);
      stats.secs = (performance.now() - started) / 1000; UI.lastExportStats = stats;
      return { ok: r.ok, out: o.fmt === 'png' || o.fmt === 'jpg' ? out.replace(/[\\/][^\\/]*$/, '') : out, log: r.log, stats };
    } catch (e) { console.error(e); return { ok: false, error: e.message }; }
    finally { GW.Render.exporting = false; GW.Media.ExportDec.end(); if (pxMax != null) { GW.Media.Proxy.max = pxMax; GW.Media.Proxy.pump(); } GW.invalidate(); }
  }
  UI.runExport = runExport; UI.exportState = state;

  UI.exportFrame = async () => {
    GW.stop(); const s = GW.seq();
    let acc = GW.Render.frame(s, s.t, { scale: 1, exporting: false });
    if (GW.OfxFx && GW.OfxFx.defs && s.clips.some(c => (c.fx || []).some(f => GW.OfxFx.defs[f.type]))) { // OFX effects: full-quality frame like export
      GW.R.free(acc); GW.Render.exporting = true; try { acc = GW.Render.frame(s, s.t, { scale: 1, exporting: false }); acc = await GW.OfxFx.settle(acc, () => GW.Render.frame(s, s.t, { scale: 1, exporting: false })); } finally { GW.Render.exporting = false; }
    }
    const buf = GW.R.readRGBA(acc.w, acc.h, acc, null, true); const w = acc.w, h = acc.h; GW.R.free(acc);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), w, h), 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    if (!window.gws) { GW.toast('حفظ الإطار متاح في نسخة سطح المكتب'); return; }
    const paths = await gws.paths(); const p = await gws.saveDialog({ title: 'حفظ الإطار', defaultPath: paths.renders + paths.sep + (s.name || 'frame') + '_' + GW.fmtTC(s.t, s.fps).replace(/:/g, '-') + '.png', ext: 'png' });
    if (!p) return; await gws.writeBin(p, await blob.arrayBuffer()); GW.toast('تم حفظ الإطار'); GW.invalidate();
  };
})();
