'use strict';
/* Export presets, export queue (قائمة التصدير) and the YouTube thumbnail helper.
   - Presets only set the existing export-dialog fields (fmt / res / fps / q / audio / alpha / hw); resolution is stored as the
     output's short side in px and mapped to the dialog's per-sequence scale options. Custom presets live in localStorage.
   - The queue runs UI.runExport items one after another (each with its own preset, range and output) with progress.
   - Thumbnail: the current frame, cover-cropped to 1280×720, JPG under 2 MB; the preview can show YouTube's duration badge area.
   API (GW.API.methods): listExportPresets · exportPreset · exportQueue · exportQueueStatus · exportThumbnail */
(function () {
  const { esc } = GW;
  const UI = GW.UI;
  const LS = 'gws.exportPresets';
  const BUILTIN = [
    { id: 'yt4k', name: 'يوتيوب 4K — H.264 (معدل بت عالٍ)', suf: '4K', f: { fmt: 'mp4', h: 2160, fps: 'seq', q: 'best', audio: 1, alpha: 0, hw: 1 } },
    { id: 'yt4kHevc', name: 'يوتيوب 4K — HEVC', suf: '4K_HEVC', f: { fmt: 'mp4h265', h: 2160, fps: 'seq', q: 'best', audio: 1, alpha: 0, hw: 1 } },
    { id: 'yt1080', name: 'يوتيوب 1080p', suf: '1080p', f: { fmt: 'mp4', h: 1080, fps: 'seq', q: 'high', audio: 1, alpha: 0, hw: 1 } },
    { id: 'shorts30', name: 'شورتس / تيك توك / ريلز — 1080×1920 ‏30 إطار', suf: 'Shorts30', aspect: 9 / 16, f: { fmt: 'mp4', h: 1080, fps: '30', q: 'high', audio: 1, alpha: 0, hw: 1 } },
    { id: 'shorts60', name: 'شورتس / تيك توك / ريلز — 1080×1920 ‏60 إطار', suf: 'Shorts60', aspect: 9 / 16, f: { fmt: 'mp4', h: 1080, fps: '60', q: 'high', audio: 1, alpha: 0, hw: 1 } },
    { id: 'square', name: 'إنستغرام مربع — 1080×1080', suf: 'Square', aspect: 1, f: { fmt: 'mp4', h: 1080, fps: '30', q: 'high', audio: 1, alpha: 0, hw: 1 } },
    { id: 'prores', name: 'نسخة رئيسية — ProRes 422 HQ (MOV)', suf: 'Master', f: { fmt: 'mov', h: 'seq', fps: 'seq', q: 'best', audio: 1, alpha: 0 } },
    { id: 'podcastWav', name: 'صوت فقط — WAV (بودكاست)', suf: 'Audio', f: { fmt: 'wav', audio: 1 } },
    { id: 'podcastMp3', name: 'صوت فقط — MP3 (بودكاست)', suf: 'Podcast', f: { fmt: 'mp3', audio: 1 } },
    { id: 'thumbPng', name: 'صورة مصغرة PNG للإطار الحالي', suf: 'Frame', frame: 'png', f: { fmt: 'png' } },
    { id: 'thumbYt', name: 'صورة مصغرة يوتيوب — JPG ‏1280×720 (أقل من 2 MB)', suf: 'Thumb', frame: 'yt', f: { fmt: 'jpg' } }
  ];
  const P = UI.ExportPresets = { builtin: BUILTIN };
  P.custom = () => { try { const a = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.id && x.f) : []; } catch (e) { return []; } };
  P.all = () => [...BUILTIN.map(p => ({ ...p, builtin: true })), ...P.custom().map(p => ({ ...p, builtin: false }))];
  P.get = (id) => P.all().find(p => p.id === id || p.name === id) || null;
  const EXT = { mp4: 'mp4', mp4h265: 'mp4', mov: 'mov', webm: 'webm', png: 'png', jpg: 'jpg', gif: 'gif', wav: 'wav', mp3: 'mp3' };
  const safeName = (s) => (s.name || 'export').replace(/[\\/:*?"<>|]+/g, '_');
  // short side in px ↔ the dialog's 'res' value (scale of the sequence)
  function resFor(s, h) {
    if (h == null || h === 'seq') return 'seq'; const short = Math.min(s.w, s.h);
    if (Math.abs(h - short) < 1) return 'seq'; return (h / short).toFixed(4);
  }
  function hFor(s, res) { if (res == null || res === 'seq') return 'seq'; return Math.round(Math.min(s.w, s.h) * +res); }
  // preset → export options for sequence s (only existing fields)
  P.options = (s, p, over = {}) => {
    const f = p.f || {}; const o = { fmt: f.fmt || 'mp4', res: resFor(s, f.h), fps: f.fps != null ? String(f.fps) : 'seq', q: f.q || 'high', audio: f.audio === 0 ? 0 : 1, alpha: f.alpha ? 1 : 0, hw: f.hw === 0 ? 0 : 1 };
    for (const k of ['fmt', 'res', 'fps', 'q', 'audio', 'alpha', 'hw']) if (over[k] != null) o[k] = typeof o[k] === 'number' ? +over[k] : String(over[k]);
    return o;
  };
  P.warn = (s, p) => {
    if (!p || !p.aspect) return '';
    const ar = s.w / s.h; if (Math.abs(ar - p.aspect) < 0.02) return '';
    return p.aspect < 1 ? `تنبيه: التسلسل ليس عموديًا 9:16 — أنشئ تسلسلًا بمقاس 1080×1920 لهذا الإعداد (${s.w}×${s.h})` : `تنبيه: التسلسل ليس مربعًا 1:1 — أنشئ تسلسلًا بمقاس 1080×1080 لهذا الإعداد (${s.w}×${s.h})`;
  };
  P.saveCustom = (name, o, s) => {
    s = s || GW.seq(); o = o || UI.exportState; if (!name) return null;
    const list = P.custom().filter(x => x.name !== name);
    const p = { id: 'c_' + GW.uid(), name, suf: name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24), f: { fmt: o.fmt, h: hFor(s, o.res), fps: String(o.fps), q: o.q, audio: o.audio ? 1 : 0, alpha: o.alpha ? 1 : 0, hw: o.hw === 0 ? 0 : 1 } };
    list.push(p); try { localStorage.setItem(LS, JSON.stringify(list)); } catch (e) {}
    return p;
  };
  P.removeCustom = (id) => { try { localStorage.setItem(LS, JSON.stringify(P.custom().filter(x => x.id !== id))); } catch (e) {} };

  /* ---------- frame grabs (thumbnails) ---------- */
  function grabFrame(s) {
    GW.stop(); const acc = GW.Render.frame(s, s.t, { scale: 1, exporting: false });
    const w = acc.w, h = acc.h; const buf = GW.R.readRGBA(w, h, acc, null, true); GW.R.free(acc); GW.invalidate();
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, w * h * 4), w, h), 0, 0);
    return c;
  }
  function cover(src, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const k = Math.max(W / src.width, H / src.height); const sw = W / k, sh = H / k;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, W, H); return c;
  }
  const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
  const MAXB = 2 * 1024 * 1024 - 1024;
  P.thumbnail = async (s, out) => {
    const c = cover(grabFrame(s), 1280, 720); let q = 0.95, b = null;
    for (; q >= 0.3; q -= 0.05) { b = await toBlob(c, 'image/jpeg', q); if (b && b.size <= MAXB) break; }
    if (!b) return { ok: false, error: 'تعذر ترميز الصورة' };
    await gws.writeBin(out, await b.arrayBuffer()); return { ok: true, out, bytes: b.size, quality: +q.toFixed(2), w: 1280, h: 720 };
  };
  P.framePng = async (s, out, o = {}) => {
    let c = grabFrame(s); if (o.res && o.res !== 'seq') { const k = +o.res; c = cover(c, Math.round(c.width * k / 2) * 2, Math.round(c.height * k / 2) * 2); }
    const b = await toBlob(c, 'image/png'); await gws.writeBin(out, await b.arrayBuffer()); return { ok: true, out, bytes: b.size, w: c.width, h: c.height };
  };
  // YouTube overlays: duration badge (bottom-right) and the watch-progress bar (bottom edge), in 1280×720 space
  P.drawSafe = (g, W, H) => {
    const k = W / 1280; g.save();
    g.fillStyle = 'rgba(229,57,53,.25)'; g.strokeStyle = '#ff5252'; g.lineWidth = Math.max(1, 2 * k); g.setLineDash([6 * k, 4 * k]);
    const bw = 190 * k, bh = 74 * k, bx = W - bw - 14 * k, by = H - bh - 14 * k; g.fillRect(bx, by, bw, bh); g.strokeRect(bx, by, bw, bh);
    g.setLineDash([]); g.fillStyle = 'rgba(0,0,0,.8)'; const pw = 92 * k, ph = 40 * k; g.fillRect(W - pw - 24 * k, H - ph - 24 * k, pw, ph);
    g.fillStyle = '#fff'; g.font = `600 ${Math.round(26 * k)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('12:34', W - pw / 2 - 24 * k, H - ph / 2 - 24 * k);
    g.fillStyle = 'rgba(255,0,0,.55)'; g.fillRect(0, H - 8 * k, W * .35, 8 * k);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.setLineDash([4, 4]); g.strokeRect(W * .05, H * .05, W * .9, H * .9);
    g.restore();
  };

  /* ---------- queue ---------- */
  const Q = UI.exportQueue = { items: [], running: false, cancel: false, cur: null };
  let qSeq = 1;
  Q.add = (it) => {
    const s = GW.prj.seqs.find(x => x.id === it.seqId) || GW.seq();
    let out = it.o.out; const used = new Set(Q.items.filter(x => x.status !== 'done').map(x => x.o.out));
    if (used.has(out)) { const m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(out); let n = 2; while (used.has(m[1] + '_' + n + (m[2] || ''))) n++; out = m[1] + '_' + n + (m[2] || ''); }
    const item = { id: qSeq++, seqId: s.id, name: it.name || 'تصدير', frame: it.frame || null, o: { ...it.o, out }, status: 'wait', progress: 0, msg: '' };
    Q.items.push(item); Q.emit(); return item;
  };
  Q.emit = () => GW.bus.emit('export-queue', Q);
  Q.status = () => ({ running: Q.running, items: Q.items.map(x => ({ id: x.id, name: x.name, out: x.o.out, t0: x.o.t0, t1: x.o.t1, fmt: x.o.fmt, status: x.status, progress: +x.progress.toFixed(3), message: String(x.msg || '').replace(/<[^>]+>/g, ''), error: x.error })) });
  Q.runItem = async (it) => {
    const s = GW.prj.seqs.find(x => x.id === it.seqId) || GW.seq();
    it.status = 'run'; it.progress = 0; it.msg = ''; Q.cur = it; Q.emit();
    let r;
    try {
      if (it.frame === 'yt') r = await P.thumbnail(s, it.o.out);
      else if (it.frame) r = await P.framePng(s, it.o.out, it.o);
      else r = await UI.runExport(s, it.o, (p, msg) => { it.progress = p; it.msg = msg; Q.emit(); }, () => Q.cancel, null);
    } catch (e) { r = { ok: false, error: e.message }; }
    it.progress = r.ok ? 1 : it.progress; it.status = r.ok ? 'done' : r.cancelled ? 'cancel' : 'err'; it.result = r.out || it.o.out;
    if (!r.ok && !r.cancelled) it.error = r.error || String(r.log || '').slice(-600);
    it.msg = r.ok ? 'تم' : r.cancelled ? 'أُلغي' : 'فشل'; Q.cur = null; Q.emit(); return r;
  };
  Q.run = async () => {
    if (Q.running) return Q.status(); if (!window.gws) { GW.toast('التصدير متاح في نسخة سطح المكتب من البرنامج', 'err'); return Q.status(); }
    Q.running = true; Q.cancel = false; Q.emit(); GW.stop();
    try { for (const it of Q.items) { if (Q.cancel) break; if (it.status !== 'wait') continue; await Q.runItem(it); } }
    finally { Q.running = false; Q.emit(); }
    const done = Q.items.filter(x => x.status === 'done').length, bad = Q.items.filter(x => x.status === 'err').length;
    GW.toast(bad ? `اكتملت قائمة التصدير — ناجح: ${done} · فشل: ${bad}` : `اكتملت قائمة التصدير — ملفات: ${done}`, bad ? 'err' : '');
    return Q.status();
  };
  Q.fromPreset = async (p, s, over = {}) => {
    s = s || GW.seq(); const paths = await gws.paths(); const st = UI.exportState || {};
    const o = P.options(s, p, over);
    const ext = p.frame === 'yt' ? 'jpg' : EXT[o.fmt] || 'mp4';
    o.out = over.out || ((st.outDir || paths.renders) + paths.sep + safeName(s) + '_' + (p.suf || p.id) + '.' + ext);
    const d = GW.seqDur(s);
    if (over.t0 != null || over.t1 != null) { o.t0 = Math.max(0, +over.t0 || 0); o.t1 = over.t1 != null ? +over.t1 : d; }
    else if (over.range === 'io' && (s.inP != null || s.outP != null)) { o.t0 = s.inP || 0; o.t1 = s.outP ?? d; }
    return { name: p.name, frame: p.frame || null, seqId: s.id, o };
  };

  UI.exportQueueDialog = () => {
    const body = document.createElement('div'); body.className = 'xq';
    body.innerHTML = `<div data-k="list" style="display:flex;flex-direction:column;gap:6px;max-height:52vh;overflow:auto"></div>
      <div class="form" style="padding:0;margin-top:10px"><div class="frow"><label>إضافة إعداد مسبق</label><div class="ctl"><select class="sel" data-k="pre">${P.all().map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><select class="sel" data-k="rng" style="max-width:190px"><option value="all">التسلسل كاملًا</option><option value="io">من نقطة الدخول إلى الخروج</option></select><button class="btn sm" data-k="add">${GW.ico('plus', 12)} إضافة</button></div></div></div>`;
    const q = k => body.querySelector(`[data-k=${k}]`);
    const fmtR = (o) => o.t0 != null ? `${GW.fmtTC(o.t0, GW.seq().fps)} → ${GW.fmtTC(o.t1, GW.seq().fps)}` : 'كامل';
    const ST = { wait: ['في الانتظار', 'var(--text2)'], run: ['جارٍ التصدير', 'var(--accent)'], done: ['تم', 'var(--green)'], err: ['فشل', 'var(--red)'], cancel: ['أُلغي', 'var(--orange)'] };
    function render() {
      const L = q('list'); L.innerHTML = '';
      if (!Q.items.length) { L.innerHTML = '<div style="color:var(--text2);padding:18px;text-align:center">القائمة فارغة: أضف عناصر من نافذة التصدير («إضافة إلى القائمة») أو من الإعدادات المسبقة أدناه.</div>'; }
      for (const it of Q.items) {
        const r = document.createElement('div'); r.className = 'xq-row'; r.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) 130px 26px;gap:8px;align-items:center;padding:7px 9px;background:var(--bg3);border-radius:5px;border-inline-start:3px solid ' + ST[it.status][1];
        r.innerHTML = `<div style="min-width:0"><b style="font-size:12px">${esc(it.name)}</b><div style="font:10.5px var(--f-mono);color:var(--text2);direction:ltr;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(it.o.out)}">${esc(fmtR(it.o))} · ${esc(it.o.out.split(/[\\/]/).pop())}</div>${it.error ? `<div style="color:var(--red);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(it.error)}">${esc(it.error.slice(-160))}</div>` : ''}</div>
          <div><div class="prog"><i style="width:${(it.progress * 100).toFixed(1)}%;background:${ST[it.status][1]}"></i></div><div style="font-size:10.5px;color:${ST[it.status][1]};margin-top:3px"><span>${ST[it.status][0]}</span>${it.status === 'run' ? ' <span dir="ltr">' + Math.round(it.progress * 100) + '%</span>' : ''}</div></div>
          <button class="ib" data-del title="${it.status === 'done' ? 'فتح المجلد' : 'إزالة من القائمة'}">${GW.ico(it.status === 'done' ? 'folder' : 'close', 14)}</button>`;
        r.querySelector('[data-del]').onclick = () => { if (it.status === 'done') { gws.showItem(it.result || it.o.out); return; } if (it.status === 'run') return; Q.items = Q.items.filter(x => x !== it); render(); };
        L.append(r);
      }
      const btns = dlg && dlg.el.querySelectorAll('.dlg-f .btn'); if (btns) { btns[2].textContent = Q.running ? 'إيقاف' : 'تشغيل القائمة'; btns[2].disabled = !Q.running && !Q.items.some(x => x.status === 'wait'); }
    }
    q('add').onclick = async () => { const p = P.get(q('pre').value); if (!p) return; Q.add(await Q.fromPreset(p, GW.seq(), { range: q('rng').value })); };
    const onQ = () => { if (body.isConnected) render(); }; GW.bus.on('export-queue', onQ);
    const dlg = GW.modal({ title: 'قائمة التصدير', width: 720, body, buttons: [
      { label: 'إغلاق' },
      { label: 'مسح المكتمل', action: () => { Q.items = Q.items.filter(x => x.status === 'wait' || x.status === 'run'); render(); return false; } },
      { label: 'تشغيل القائمة', primary: true, action: () => { if (Q.running) { Q.cancel = true; return false; } Q.items.forEach(x => { if (x.status === 'err' || x.status === 'cancel') { x.status = 'wait'; x.progress = 0; x.error = null; } }); Q.run(); return false; } }] });
    render(); return dlg;
  };

  /* ---------- thumbnail dialog ---------- */
  UI.thumbnailDialog = async () => {
    if (!window.gws) { GW.toast('حفظ الإطار متاح في نسخة سطح المكتب'); return; }
    const s = GW.seq(); GW.stop(); const paths = await gws.paths();
    const src = cover(grabFrame(s), 1280, 720);
    const body = document.createElement('div');
    body.innerHTML = `<div style="position:relative;background:#000;border:1px solid #333;border-radius:6px;overflow:hidden;aspect-ratio:16/9"><canvas data-k="cv" width="1280" height="720" style="width:100%;height:100%;display:block"></canvas></div>
      <div class="form" style="padding:0;margin-top:10px">
        <div class="frow"><label>منطقة الأمان</label><div class="ctl"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="safe" checked> إظهار مكان شارة المدة وشريط التقدم في يوتيوب (للمعاينة فقط)</label></div></div>
        <div class="frow"><label>ملف الإخراج</label><div class="ctl"><input class="inp" data-k="out" dir="ltr"><button class="btn sm" data-k="browse">استعراض…</button></div></div>
      </div><div class="sum" data-k="sum" style="font:11px var(--f-mono);color:var(--text2);margin-top:6px">1280×720 · JPG · ${GW.fmtTC(s.t, s.fps)}</div>`;
    const q = k => body.querySelector(`[data-k=${k}]`);
    q('out').value = (UI.exportState && UI.exportState.outDir || paths.renders) + paths.sep + safeName(s) + '_thumb_' + GW.fmtTC(s.t, s.fps).replace(/:/g, '-') + '.jpg';
    const draw = () => { const g = q('cv').getContext('2d'); g.drawImage(src, 0, 0); if (q('safe').checked) P.drawSafe(g, 1280, 720); };
    q('safe').onchange = draw; draw();
    q('browse').onclick = async () => { const p = await gws.saveDialog({ title: 'حفظ الصورة المصغرة', defaultPath: q('out').value, ext: 'jpg' }); if (p) q('out').value = p; };
    GW.modal({ title: 'صورة مصغرة ليوتيوب', width: 760, body, buttons: [{ label: 'إغلاق' }, { label: 'حفظ JPG', primary: true, action: async () => {
      const r = await P.thumbnail(s, q('out').value);
      if (r.ok) { q('sum').innerHTML = `<span style="color:var(--green)">تم الحفظ</span> · 1280×720 · ${(r.bytes / 1024).toFixed(0)} KB · q=${r.quality}<br>${esc(r.out)}`; GW.toast('تم حفظ الصورة المصغرة'); }
      else q('sum').innerHTML = `<span style="color:var(--red)">${esc(r.error || 'فشل')}</span>`;
      return false;
    } }] });
  };

  /* ---------- export dialog: preset row, save/delete, add to queue ---------- */
  const orig = UI.exportDialog;
  UI.exportDialog = async (...a) => {
    const before = new Set(document.querySelectorAll('.dlg'));
    const r = await orig.apply(UI, a);
    const dlg = [...document.querySelectorAll('.dlg')].find(d => !before.has(d) && d.querySelector('.exp'));
    if (dlg) try { enhance(dlg); } catch (e) { console.error(e); }
    return r;
  };
  function enhance(dlg) {
    const s = GW.seq(); const exp = dlg.querySelector('.exp'); const form = exp.querySelector('.form');
    const q = k => exp.querySelector(`[data-k=${k}]`);
    let frameMode = null, applying = false;
    const row = document.createElement('div'); row.className = 'frow';
    row.innerHTML = `<label>إعداد مسبق</label><div class="ctl"><select class="sel" data-k="preset"></select><button class="btn sm" data-k="psave" title="حفظ الإعدادات الحالية كإعداد مسبق مخصص">حفظ…</button><button class="btn sm" data-k="pdel" title="حذف الإعداد المخصص" hidden>حذف</button></div>`;
    form.prepend(row);
    const warn = document.createElement('div'); warn.style.cssText = 'color:var(--orange);font-size:11px;margin-top:6px'; warn.hidden = true; exp.querySelector('[data-k=sum]').after(warn);
    const sel = q('preset');
    const fill = (val) => { const all = P.all(); sel.innerHTML = `<option value="">— مخصص —</option><optgroup label="مدمجة">${all.filter(p => p.builtin).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>${all.some(p => !p.builtin) ? `<optgroup label="محفوظة">${all.filter(p => !p.builtin).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>` : ''}`; sel.value = val || ''; q('pdel').hidden = !(P.get(sel.value) && !P.get(sel.value).builtin); };
    fill('');
    const setVal = (k, v) => { const el = q(k); if (!el) return; if (el.type === 'checkbox') { if (el.disabled) return; el.checked = !!+v; } else { if (![...el.options].some(o => o.value === String(v))) return; el.value = String(v); } el.dispatchEvent(new Event('change')); };
    function apply(p) {
      applying = true; const o = P.options(s, p);
      for (const k of ['fmt', 'res', 'fps', 'q', 'audio', 'alpha', 'hw']) setVal(k, o[k]);
      applying = false; frameMode = p.frame || null;
      const ext = p.frame === 'yt' ? 'jpg' : EXT[o.fmt]; const out = q('out');
      out.value = out.value.replace(/[^\\/]*$/, '') + safeName(s) + '_' + (p.suf || p.id) + '.' + ext;
      const w = P.warn(s, p); warn.textContent = w; warn.hidden = !w;
      if (frameMode) { warn.hidden = false; warn.style.color = 'var(--text2)'; warn.textContent = (frameMode === 'yt' ? 'صورة 1280×720 JPG (أقل من 2 MB)' : 'صورة PNG') + ' — ' + 'الإطار عند: ' + GW.fmtTC(s.t, s.fps); } else warn.style.color = 'var(--orange)';
      q('pdel').hidden = p.builtin !== false;
    }
    sel.onchange = () => { const p = P.get(sel.value); if (p) apply(p); else { frameMode = null; warn.hidden = true; q('pdel').hidden = true; } };
    // editing any field by hand detaches from the preset
    for (const k of ['fmt', 'res', 'fps', 'q', 'audio', 'alpha', 'hw']) { const el = q(k); if (el) el.addEventListener('change', () => { if (!applying && sel.value) { sel.value = ''; frameMode = null; warn.hidden = true; q('pdel').hidden = true; } }); }
    q('psave').onclick = async () => { const n = await GW.prompt('حفظ إعداد مسبق', 'اسم الإعداد', ''); if (!n) return; const p = P.saveCustom(n.trim(), UI.exportState, s); fill(p.id); GW.toast('تم حفظ الإعداد المسبق: ' + p.name); };
    q('pdel').onclick = async () => { const p = P.get(sel.value); if (!p || p.builtin) return; if (!(await GW.ask('حذف الإعداد المسبق', 'حذف الإعداد المسبق: ' + p.name, 'حذف'))) return; P.removeCustom(p.id); fill(''); };
    // footer: add to queue + open queue
    const foot = dlg.querySelector('.dlg-f'); const btns = foot.querySelectorAll('.btn'); const expBtn = btns[btns.length - 1];
    const addB = document.createElement('button'); addB.className = 'btn'; addB.dataset.k = 'qadd'; addB.textContent = 'إضافة إلى القائمة';
    const openB = document.createElement('button'); openB.className = 'btn'; openB.dataset.k = 'qopen';
    const lbl = () => { const n = Q.items.filter(x => x.status === 'wait' || x.status === 'run').length; openB.textContent = 'قائمة التصدير' + (n ? ` (${n})` : ''); };
    lbl(); GW.bus.on('export-queue', () => { if (openB.isConnected) lbl(); });
    foot.append(addB, openB); // appended: ui_export.js addresses its own buttons by index [0] / [1]
    addB.onclick = () => {
      const st = UI.exportState; const p = P.get(sel.value);
      const o = { fmt: st.fmt, res: st.res, fps: st.fps, q: st.q, audio: st.audio, alpha: st.alpha, hw: st.hw, out: q('out').value };
      const d = GW.seqDur(s); if (st.range === 'io' && (s.inP != null || s.outP != null)) { o.t0 = s.inP || 0; o.t1 = s.outP ?? d; }
      const it = Q.add({ name: p ? p.name : (q('fmt').selectedOptions[0] || {}).textContent || 'تصدير', frame: frameMode, seqId: s.id, o });
      GW.toast('أُضيف إلى قائمة التصدير: ' + it.o.out.split(/[\\/]/).pop());
    };
    openB.onclick = () => UI.exportQueueDialog();
    // the frame presets save a still instead of rendering the range
    foot.addEventListener('click', async (e) => {
      if (e.target !== expBtn || !frameMode) return; e.stopImmediatePropagation(); e.preventDefault();
      const out = q('out').value; const r = frameMode === 'yt' ? await P.thumbnail(s, out) : await P.framePng(s, out, UI.exportState);
      q('progbox').hidden = false; q('bar').style.width = '100%';
      q('stat').innerHTML = r.ok ? `<span style="color:var(--green)">تم حفظ الصورة</span> · ${r.w}×${r.h} · ${(r.bytes / 1024).toFixed(0)} KB<br>${esc(r.out)}` : `<span style="color:var(--red)">${esc(r.error || 'فشل')}</span>`;
    }, true);
  }

  /* ---------- automation API ---------- */
  function regApi() {
    const A = GW.API && GW.API.methods; if (!A) return false;
    const fail = (m) => { throw new Error(m); };
    A.listExportPresets = () => P.all().map(p => ({ id: p.id, name: p.name, builtin: p.builtin, frame: p.frame || undefined, fields: { ...P.options(GW.seq(), p), h: p.f.h }, warning: P.warn(GW.seq(), p) || undefined }));
    // exportPreset({preset, out?, range:'all'|'io', t0?, t1?, res?, fps?, quality?, wait=true}) → {ok, out}
    A.exportPreset = async (p = {}) => {
      if (!window.gws) fail('exportPreset needs the desktop app');
      const pr = P.get(p.preset || p.id || p.name) || fail('unknown preset "' + (p.preset || '') + '". Presets: ' + P.all().map(x => x.id).join(', '));
      const s = GW.seq(); if (!pr.frame && GW.seqDur(s) <= 0) fail('the sequence is empty');
      if (Q.running) fail('the export queue is running (exportQueueStatus)');
      const it = Q.add(await Q.fromPreset(pr, s, { ...p, q: p.quality || p.q }));
      const run = (async () => { Q.running = true; Q.cancel = false; try { return await Q.runItem(it); } finally { Q.running = false; Q.emit(); } })();
      if (p.wait === false) return Q.status();
      const r = await run; if (!r.ok && !r.cancelled) fail('export failed: ' + (it.error || r.error || '')); return { ok: !!r.ok, cancelled: !!r.cancelled, out: it.result, preset: pr.id, bytes: r.bytes };
    };
    // exportQueue({items:[{preset, out?, range?, t0?, t1?, res?, fps?, quality?}], wait=true}) → [{ok, out, preset}]
    A.exportQueue = async ({ items = [], wait = true } = {}) => {
      if (!window.gws) fail('exportQueue needs the desktop app'); if (!Array.isArray(items) || !items.length) fail('items: [{preset, out?, t0?, t1?}]');
      if (Q.running) fail('the export queue is already running');
      const added = []; for (const x of items) { const pr = P.get(x.preset) || fail('unknown preset ' + x.preset); added.push(Q.add(await Q.fromPreset(pr, GW.seq(), { ...x, q: x.quality || x.q }))); }
      const run = Q.run(); if (wait === false) return Q.status(); await run;
      return added.map(it => ({ ok: it.status === 'done', status: it.status, out: it.result || it.o.out, name: it.name, error: it.error }));
    };
    A.exportQueueStatus = () => Q.status();
    A.cancelExportQueue = () => { Q.cancel = true; return Q.status(); };
    // exportThumbnail({out?}) → current frame as a 1280×720 JPG under 2 MB
    A.exportThumbnail = async ({ out } = {}) => {
      if (!window.gws) fail('exportThumbnail needs the desktop app'); const s = GW.seq();
      if (!out) { const pa = await gws.paths(); out = pa.renders + pa.sep + safeName(s) + '_thumb.jpg'; }
      return P.thumbnail(s, out);
    };
    // voice-over: recordVoiceover({track:'A1'|index, seconds?, countdown?, preroll?, muteOthers?}) → {path, clip, start, dur}
    A.recordVoiceover = async ({ track, seconds, countdown = false, preroll = 0, muteOthers = true } = {}) => {
      if (!GW.VO) fail('voice-over module not loaded'); const ti = typeof track === 'string' ? Math.max(0, (parseInt(track.replace(/\D/g, ''), 10) || 1) - 1) : (+track || 0);
      const ok = await GW.VO.start(ti, { noDialog: true, countdown: countdown ? 1 : 0, preroll: +preroll || 0, muteOthers: muteOthers ? 1 : 0 }); if (!ok) fail('could not start recording (microphone unavailable?)');
      if (!seconds) return { recording: true, track: 'A' + (ti + 1), hint: 'call stopVoiceover' };
      await GW.sleep(Math.min(3600, +seconds) * 1000); return GW.VO.stop();
    };
    A.stopVoiceover = () => (GW.VO && GW.VO.rec ? GW.VO.stop() : null);
    return true;
  }
  if (!regApi()) document.addEventListener('DOMContentLoaded', regApi);
})();
