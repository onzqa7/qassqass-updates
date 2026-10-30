'use strict';
/* نص إلى كلام (offline text-to-speech with Piper TTS — تعليق صوتي آلي).
   Engine + voices are downloaded on demand into userData (main.js "tts" block, like the whisper engines); synthesis
   runs in the main process (piper reads the text from stdin, writes a WAV next to the voices with an ASCII name) and the
   result is copied to Documents/QassQass/tts/, imported and placed on the target audio track at the playhead as ONE undo
   step. Batch mode: one clip per paragraph, laid out sequentially with a gap.
   Dialog: Sequence menu «نص إلى كلام…» · clip context menu on text clips · GW.cmd.tts · API: tts, listVoices. */
(function () {
  const { esc } = GW;
  const T = GW.TTS = { st: null, dl: {}, busy: null };
  const api = () => window.gws;
  const has = () => !!(api() && api().ttsStatus);
  const tr = (s) => (GW.lang === 'en' && window.__EN_UI && window.__EN_UI[s]) || s;
  const CFG = 'gws.tts';
  T.cfg = { voice: 'ar_JO-kareem-medium', speed: 1, pause: 0.6, gap: 0.5, batch: 0 };
  try { Object.assign(T.cfg, JSON.parse(localStorage.getItem(CFG) || '{}')); } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem(CFG, JSON.stringify(T.cfg)); } catch (e) {} };
  const fmtMB = (b) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';

  const css = document.createElement('style');
  css.textContent = `
.tts-dlg textarea.inp{width:100%;min-height:150px;resize:vertical;font-family:inherit;font-size:13px;line-height:1.7}
.tts-dlg .vrow{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;border:1px solid var(--line,#333);margin-top:4px;font-size:12px}
.tts-dlg .vrow.rec{border-color:var(--accent)}
.tts-dlg .vrow .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tts-dlg .vrow .sz{color:var(--text2);font:11px var(--f-mono,monospace);direction:ltr}
.tts-dlg .bar{height:6px;background:#111;border-radius:3px;overflow:hidden;direction:ltr;flex:1;min-width:60px}.tts-dlg .bar i{display:block;height:100%;width:0;background:var(--accent)}
.tts-dlg .eng{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--bg3,rgba(255,255,255,.04));font-size:12px;margin-bottom:8px}
.tts-dlg .eng .ok{color:var(--green,#3fb950)}.tts-dlg .eng .no{color:var(--yellow,#e3b341)}
.tts-dlg .hint{color:var(--text2);font-size:11px;margin:6px 0 0}
.tts-dlg .err{color:var(--red,#e5534b);font-size:11px}`;
  document.head.append(css);

  /* ---------- status / downloads ---------- */
  T.refresh = async () => { if (!has()) return (T.st = null); T.st = await api().ttsStatus(); return T.st; };
  if (has() && api().onTtsProgress) api().onTtsProgress(p => {
    if (p.kind === 'download') { const k = p.target + ':' + p.id; if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') delete T.dl[k]; else T.dl[k] = p; T.onDl && T.onDl(p); }
  });
  T.download = async (kind, id) => {
    if (!has()) return { ok: false, error: 'desktop only' };
    T.dl[kind + ':' + id] = { phase: 'download', got: 0, total: 0 }; T.onDl && T.onDl({ kind: 'download', target: kind, id, phase: 'start' });
    const r = await api().ttsDownload(kind, id); delete T.dl[kind + ':' + id]; await T.refresh(); T.onDl && T.onDl({ kind: 'download', target: kind, id, phase: r.ok ? 'done' : 'error', error: r.error });
    if (!r.ok && !r.cancelled) GW.toast(tr('تعذر التنزيل: ') + (r.error || ''), 'err');
    return r;
  };
  T.voices = () => (T.st ? T.st.voices : []);
  const installed = (id) => T.voices().find(v => v.id === id && v.installed);

  /* ---------- text sources ---------- */
  // text of the selected text clips (in timeline order), or the transcript, or nothing
  T.textFrom = (src, s) => {
    s = s || GW.seq();
    if (src === 'clips') return [...GW.sel.clips].map(id => GW.clipById(id, s)).filter(c => c && c.kind === 'text' && c.text).sort((a, b) => a.start - b.start).map(c => String(c.text.str || '').trim()).filter(Boolean).join('\n\n');
    if (src === 'transcript') { const t = s.transcript; return t ? t.segs.map(g => g.text).join(' ') : ''; }
    return '';
  };
  T.paragraphs = (text) => { const t = String(text || '').replace(/\r\n?/g, '\n').trim(); if (!t) return []; let p = t.split(/\n\s*\n+/).map(x => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean); if (p.length === 1 && /\n/.test(t)) p = t.split('\n').map(x => x.trim()).filter(Boolean); return p; };

  /* ---------- synthesis + placement ---------- */
  const outDir = async () => { const P = await api().paths(); return { dir: P.renders + P.sep + 'tts', sep: P.sep }; };
  const stamp = () => { const d = new Date(); const p2 = v => String(v).padStart(2, '0'); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`; };
  const slug = (t) => String(t || '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'tts';
  // generate WAVs for each paragraph (or the whole text) → [{path, name, seconds, text}]
  T.synth = async (texts, o = {}, onProg) => {
    if (!has()) throw new Error(tr('نص إلى كلام متاح في نسخة سطح المكتب'));
    const { dir, sep } = await outDir(); const out = []; const ts = stamp();
    for (let i = 0; i < texts.length; i++) {
      if (T.busy && T.busy.cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });
      onProg && onProg(i, texts.length);
      const name = `TTS_${ts}_${String(i + 1).padStart(2, '0')}_${slug(texts[i])}.wav`; const id = 'tts' + Date.now() + '_' + i;
      if (T.busy) T.busy.id = id;
      const r = await api().ttsRun({ id, text: texts[i], voice: o.voice || T.cfg.voice, speed: o.speed != null ? o.speed : T.cfg.speed, pause: o.pause != null ? o.pause : T.cfg.pause, speaker: o.speaker, out: dir + sep + name });
      if (!r.ok) { if (r.cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true }); throw new Error(r.error === 'engine-missing' ? tr('محرك Piper غير مثبّت') : r.error === 'voice-missing' ? tr('الصوت غير مثبّت') : r.error === 'empty-text' ? tr('النص فارغ') : String(r.error)); }
      out.push({ path: r.path, name, seconds: r.seconds, text: texts[i] });
    }
    return out;
  };
  // import the WAVs and place them sequentially from t on track ti (overwrite) — ONE undo step
  T.place = async (s, ti, t, files, gap, label) => {
    const H = GW.hist; const i0 = H.idx; const fps = s.fps || 30;
    const added = await GW.Media.importFiles(files.map(f => ({ path: f.path, name: f.name, size: 1 })));
    if (!GW.prj.seqs.includes(s)) s = GW.seq();
    GW.ops.ensureTrack(s, 'a', ti);
    const clips = []; let cur = GW.snapFrame(t, fps);
    for (const f of files) {
      const m = (added || []).find(x => x.path === f.path) || GW.prj.media.find(x => x.path === f.path); if (!m) continue;
      const dur = Math.max(1 / fps, GW.snapFrame(Math.min(f.seconds || m.dur || 0, m.dur || f.seconds || 0) || f.seconds, fps));
      const c = GW.newClip('audio', { seq: s, media: m.id, name: m.name, ti, start: cur, dur, in: 0, label: m.label });
      GW.ops.place(s, c, 'overwrite'); clips.push(c); cur = GW.snapFrame(cur + dur + (gap || 0), fps);
    }
    GW.sel.clips = new Set(clips.map(c => c.id));
    label = label || 'نص إلى كلام';
    if (H.idx > i0) { H.stack[H.idx] = JSON.stringify(GW.prj); H.labels[H.idx] = label; H.stack.length = H.idx + 1; H.labels.length = H.idx + 1; GW.bus.emit('hist'); GW.bus.emit('changed'); GW.markDirty(); }
    else GW.commit(label);
    if (clips.length) GW.seek(clips[clips.length - 1].start + clips[clips.length - 1].dur);
    GW.TL && GW.TL.invalidate(); GW.bus.emit('selection'); GW.invalidate();
    return clips;
  };
  // full pipeline: text → WAV(s) → clips. o: {text, voice, speed, pause, batch, gap, track, at}
  T.generate = async (o = {}, onProg) => {
    const s = GW.seq(); const text = String(o.text || '').trim(); if (!text) throw new Error(tr('النص فارغ'));
    const ti = o.track != null ? o.track : ((GW.TL && GW.TL.target ? GW.TL.target.a : 0) || 0);
    if ((s.at[ti] || {}).lock) throw new Error(tr('المسار مقفل'));
    const texts = o.batch ? T.paragraphs(text) : [text.replace(/\s*\n\s*/g, ' ')];
    T.busy = { cancelled: false };
    try {
      GW.stop && GW.stop();
      const files = await T.synth(texts, o, onProg);
      const t = o.at != null ? +o.at : s.t;
      const clips = await T.place(s, ti, t, files, o.batch ? (o.gap != null ? +o.gap : T.cfg.gap) : 0, o.label);
      return { files: files.map(f => ({ path: f.path, seconds: f.seconds })), clips: clips.map(c => ({ id: c.id, start: c.start, dur: c.dur, track: 'A' + (ti + 1) })) };
    } finally { T.busy = null; }
  };
  T.cancel = () => { if (T.busy) { T.busy.cancelled = true; if (T.busy.id && has()) api().ttsCancel(T.busy.id); } };

  /* ---------- dialog ---------- */
  T.dialog = async (o = {}) => {
    if (!has()) { GW.toast(tr('نص إلى كلام متاح في نسخة سطح المكتب'), 'err'); return null; }
    await T.refresh();
    const s = GW.seq(); const text0 = o.text != null ? o.text : (T.textFrom('clips', s) || '');
    const body = document.createElement('div'); body.className = 'form tts-dlg'; body.style.padding = '0';
    body.innerHTML = `<div class="eng" data-k="eng"></div>
      <div class="frow"><label>النص</label><div class="ctl" style="display:block"><textarea class="inp" data-k="txt" dir="auto" placeholder="اكتب أو الصق النص هنا… فقرة لكل سطر فارغ"></textarea>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button class="btn sm" data-k="fromClips">من مقاطع النص المحددة</button><button class="btn sm" data-k="fromTr">من نص التفريغ</button><span class="hint" data-k="cnt" style="margin:0 auto 0 0"></span></div></div></div>
      <div class="frow"><label>الصوت</label><div class="ctl" style="display:block" data-k="voices"></div></div>
      <div class="frow"><label>السرعة</label><div class="ctl"><input type="range" data-k="speed" min="0.5" max="2" step="0.05" style="flex:1"><span class="sz" data-k="speedV" style="min-width:40px;direction:ltr"></span></div></div>
      <div class="frow"><label>الوقفة بين الجمل</label><div class="ctl"><input type="range" data-k="pause" min="0" max="2" step="0.05" style="flex:1"><span class="sz" data-k="pauseV" style="min-width:40px;direction:ltr"></span></div></div>
      <div class="frow"><label>التقسيم</label><div class="ctl" style="flex-wrap:wrap"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="batch"> مقطع لكل فقرة (متتابعة)</label><span style="display:flex;gap:6px;align-items:center;margin-inline-start:12px">فاصل <input class="inp" type="number" data-k="gap" min="0" max="10" step="0.1" style="width:64px"> ث</span></div></div>
      <div class="frow"><label>الموضع</label><div class="ctl"><span class="hint" style="margin:0" data-k="pos"></span></div></div>
      <p class="hint">Piper TTS (رخصة MIT) · الأصوات من huggingface.co/rhasspy/piper-voices · تُحفظ الملفات في المستندات/QassQass/tts</p>
      <div data-k="prog" hidden style="display:flex;gap:8px;align-items:center;margin-top:8px"><span class="bar"><i data-k="progI"></i></span><span class="hint" style="margin:0" data-k="progT"></span></div>
      <div class="err" data-k="err"></div>`;
    const q = k => body.querySelector(`[data-k=${k}]`);
    q('txt').value = text0; q('speed').value = T.cfg.speed; q('pause').value = T.cfg.pause; q('batch').checked = !!T.cfg.batch; q('gap').value = T.cfg.gap;
    const upd = () => { q('speedV').textContent = (+q('speed').value).toFixed(2) + '×'; q('pauseV').textContent = (+q('pause').value).toFixed(2) + ' s'; const n = T.paragraphs(q('txt').value).length; q('cnt').textContent = n ? n + ' ' + tr('فقرة') + ' · ' + q('txt').value.trim().length + ' ' + tr('حرف') : ''; };
    q('speed').oninput = q('pause').oninput = q('txt').oninput = upd; upd();
    const ti = o.track != null ? o.track : ((GW.TL && GW.TL.target ? GW.TL.target.a : 0) || 0);
    q('pos').textContent = tr('المسار') + ' A' + (ti + 1) + ' · ' + GW.fmtTC(s.t, s.fps);
    q('fromClips').onclick = () => { const t = T.textFrom('clips', s); if (!t) return GW.toast(tr('لا توجد مقاطع نص محددة'), 'err'); q('txt').value = t; upd(); };
    q('fromTr').onclick = () => { const t = T.textFrom('transcript', s); if (!t) return GW.toast(tr('لا يوجد تفريغ لهذا التسلسل'), 'err'); q('txt').value = t; upd(); };
    const renderEng = () => {
      const st = T.st; const e = q('eng'); const E = st && st.engine; const d = T.dl['engine:piper'];
      if (!E) { e.innerHTML = `<span class="no">${esc(tr('حالة المحرك غير معروفة'))}</span>`; return; }
      if (d) { e.innerHTML = `<span>${esc(tr('تنزيل محرك Piper…'))}</span><span class="bar"><i style="width:${d.total ? Math.round(d.got / d.total * 100) : 0}%"></i></span><span class="sz">${d.phase === 'extract' ? esc(tr('فك الضغط')) : d.total ? fmtMB(d.got || 0) + ' / ' + fmtMB(d.total) : ''}</span><button class="btn sm" data-k="cancelEng">إلغاء</button>`; e.querySelector('[data-k=cancelEng]').onclick = () => api().ttsCancel('piper'); return; }
      if (E.installed) e.innerHTML = `<span class="ok">${GW.ico('check', 14)}</span><span>${esc(tr('محرك Piper مثبّت'))} <span class="sz">${esc(E.version)}</span></span><span style="flex:1"></span><button class="btn sm" data-k="openV">مجلد الأصوات</button>`;
      else e.innerHTML = `<span class="no">${esc(tr('محرك Piper غير مثبّت'))}</span><span class="sz">${fmtMB(E.size)}</span><span style="flex:1"></span>${E.downloadable ? `<button class="btn sm pri" data-k="dlEng">تنزيل المحرك</button>` : `<span class="hint" style="margin:0">${esc(tr('التنزيل متاح على ويندوز فقط'))}</span>`}`;
      const b = e.querySelector('[data-k=dlEng]'); if (b) b.onclick = () => T.download('engine', 'piper');
      const ov = e.querySelector('[data-k=openV]'); if (ov) ov.onclick = () => api().ttsOpenVoices();
    };
    const renderVoices = () => {
      const box = q('voices'); box.innerHTML = '';
      for (const v of T.voices()) {
        const row = document.createElement('div'); row.className = 'vrow' + (v.rec ? ' rec' : ''); const d = T.dl['voice:' + v.id];
        const sel = T.cfg.voice === v.id;
        row.innerHTML = `<input type="radio" name="ttsv" ${sel ? 'checked' : ''} ${v.installed ? '' : 'disabled'}><span class="nm" title="${esc(v.n)}">${esc(v.n)}</span><span class="sz">${v.installed ? fmtMB(v.bytes) : (v.mb ? '~' + v.mb + ' MB' : '')}</span>`;
        if (d) { row.insertAdjacentHTML('beforeend', `<span class="bar"><i style="width:${d.total ? Math.round(d.got / d.total * 100) : 0}%"></i></span><span class="sz">${d.total ? fmtMB(d.got || 0) + ' / ' + fmtMB(d.total) : '…'}</span>`); const c = document.createElement('button'); c.className = 'btn sm'; c.textContent = tr('إلغاء'); c.onclick = () => api().ttsCancel(v.id); row.append(c); }
        else if (!v.installed) { const b = document.createElement('button'); b.className = 'btn sm' + (v.rec ? ' pri' : ''); b.textContent = tr(v.partial ? 'استئناف' : 'تنزيل'); b.onclick = () => T.download('voice', v.id); row.append(b); }
        else { const x = document.createElement('button'); x.className = 'btn sm'; x.title = tr('حذف الصوت'); x.innerHTML = GW.ico('close', 12); x.onclick = async () => { if (await GW.ask(tr('حذف الصوت'), tr('حذف ملفات هذا الصوت من القرص؟'))) { await api().ttsRemoveVoice(v.id); await T.refresh(); renderVoices(); } }; row.append(x); }
        row.querySelector('input').onchange = () => { T.cfg.voice = v.id; saveCfg(); };
        box.append(row);
      }
      const imp = document.createElement('button'); imp.className = 'btn sm'; imp.style.marginTop = '6px'; imp.textContent = tr('استيراد صوت (.onnx)…');
      imp.onclick = async () => { const f = await api().open({ title: tr('استيراد صوت Piper (.onnx)') }); const p = Array.isArray(f) && f[0] ? f[0].path : null; if (!p) return; const r = await api().ttsImportVoice(p); if (!r.ok) return GW.toast(r.error || tr('تعذر الاستيراد'), 'err'); T.cfg.voice = r.id; saveCfg(); await T.refresh(); renderVoices(); };
      box.append(imp);
    };
    renderEng(); renderVoices();
    T.onDl = () => { renderEng(); renderVoices(); };
    let running = false;
    return new Promise(resolve => {
      const M = GW.modal({ title: 'نص إلى كلام (تعليق صوتي آلي)', width: 640, body, buttons: [{ label: 'إلغاء', value: null, action: () => { if (running) { T.cancel(); return false; } } }, { label: 'إنشاء ووضع عند المؤشر', primary: true, value: true, action: async () => {
        if (running) return false; q('err').textContent = '';
        const text = q('txt').value.trim(); if (!text) { q('err').textContent = tr('النص فارغ'); return false; }
        if (!(T.st && T.st.engine.installed)) { q('err').textContent = tr('نزّل محرك Piper أولاً'); return false; }
        if (!installed(T.cfg.voice)) { const first = T.voices().find(v => v.installed); if (first) { T.cfg.voice = first.id; renderVoices(); } else { q('err').textContent = tr('نزّل صوتاً أولاً'); return false; } }
        T.cfg.speed = +q('speed').value; T.cfg.pause = +q('pause').value; T.cfg.batch = q('batch').checked ? 1 : 0; T.cfg.gap = Math.max(0, +q('gap').value || 0); saveCfg();
        running = true; q('prog').hidden = false;
        try {
          const r = await T.generate({ text, voice: T.cfg.voice, speed: T.cfg.speed, pause: T.cfg.pause, batch: T.cfg.batch, gap: T.cfg.gap, track: ti }, (i, n) => { q('progI').style.width = Math.round(i / n * 100) + '%'; q('progT').textContent = tr('توليد') + ' ' + (i + 1) + ' / ' + n; });
          GW.toast(tr('تم إنشاء التعليق الصوتي: ') + r.clips.length + ' ' + tr('مقطع'));
          resolve(r); return true;
        } catch (e) { running = false; q('prog').hidden = true; if (!e.cancelled) q('err').textContent = String(e.message || e); return false; }
      } }], onClose: v => { T.onDl = null; if (!v) resolve(null); } });
      return M;
    });
  };

  /* ---------- menus / commands ---------- */
  GW.cmd.tts = () => T.dialog();
  const addMenu = (name, items) => { const e = GW.MENUS && GW.MENUS.find(m => m[0] === name); if (!e) return; const f = e[1]; e[1] = () => [...f(), '-', ...items()]; };
  addMenu('تسلسل', () => [{ label: 'نص إلى كلام (تعليق صوتي آلي)…', action: GW.cmd.tts }]);
  (GW.clipMenuHooks = GW.clipMenuHooks || []).push((items, c) => { if (c.kind !== 'text') return; items.push('-', { label: 'نص إلى كلام من هذا النص…', action: () => { GW.sel.clips = new Set([c.id]); T.dialog(); } }); });

  /* ---------- automation (GW.API) ---------- */
  const A = GW.API && GW.API.methods;
  if (A) {
    // listVoices() → { engine:{installed,version,size}, voices:[{id, lang, name, installed, mb}] }
    A.listVoices = async () => { const st = await T.refresh(); if (!st) throw new Error('tts needs the desktop app'); return { engine: { installed: st.engine.installed, version: st.engine.version, size: st.engine.size, downloadable: st.engine.downloadable }, voices: st.voices.map(v => ({ id: v.id, lang: v.lang, name: v.n, installed: v.installed, mb: v.mb || Math.round((v.bytes || 0) / 1048576) })) }; };
    // tts({text | fromClips | fromTranscript, voice, speed=1, pause=0.6, batch=false, gap=0.5, track='A1', at=playhead, download=false}) → {files, clips}
    A.tts = async (p = {}) => {
      if (!has()) throw new Error('tts needs the desktop app');
      await T.refresh();
      let text = p.text; if (!text && p.fromClips) text = T.textFrom('clips'); if (!text && p.fromTranscript) text = T.textFrom('transcript');
      if (!text || !String(text).trim()) throw new Error('text is empty (give text, fromClips or fromTranscript)');
      const voice = p.voice || T.cfg.voice;
      if (!T.st.engine.installed) { if (!p.download) throw new Error('Piper engine not installed (pass download:true or use the dialog)'); const r = await T.download('engine', 'piper'); if (!r.ok) throw new Error('engine download failed: ' + r.error); }
      if (!installed(voice)) { if (!p.download) throw new Error('voice not installed: ' + voice + ' (see listVoices; pass download:true)'); const r = await T.download('voice', voice); if (!r.ok) throw new Error('voice download failed: ' + r.error); }
      let ti = 0; if (p.track != null) { const t = GW.API.parseTrack(p.track, 'a'); ti = t ? t.ti : 0; }
      return T.generate({ text, voice, speed: p.speed, pause: p.pause, batch: !!p.batch, gap: p.gap, track: ti, at: p.at, label: 'المساعد: نص إلى كلام' });
    };
  }
})();
