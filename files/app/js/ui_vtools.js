'use strict';
/* أدوات الفيديو الذكية — scene edit detection (FFmpeg scene score), text-based editing (transcript words → ripple delete
   across all unlocked tracks, filler-word removal), stabilization baked to a new media file (vidstab, falls back to
   deshake) and auto reframe for vertical sequences (low-res frame difference + edge saliency → smoothed position keys).
   Everything is one undo step; exposed to automation through GW.API.methods (detectScenes, textDelete, removeFillers,
   stabilize, unstabilize, autoReframe). */
(function () {
  const { esc, clamp } = GW; const UI = GW.UI;
  const api = () => window.gws;
  const VT = GW.VTools = {};
  const prog = GW.bus._prog = GW.bus._prog || {}; // media.js dispatches ff:progress events through this map

  /* ================= shared helpers ================= */
  function ff(id, args, onT) {
    if (onT) prog[id] = onT;
    const p = api().mpRun ? api().mpRun(id, args, { low: true }) : api().ffRun(id, args);
    return Promise.resolve(p).finally(() => { delete prog[id]; });
  }
  const kill = (id) => { try { if (api() && api().mpKill) api().mpKill(id); } catch (e) {} };
  // file path as a filter option value (Windows drive colon + backslashes)
  const fpath = (p) => "'" + String(p).replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:') + "'";
  const fail = (m) => { throw new Error(m); };
  const selClips = () => [...GW.sel.clips].map(id => GW.clipById(id)).filter(Boolean);
  const snap = (t, fps) => Math.round(t * fps) / fps;
  function videoClip(id) {
    let c = id ? GW.clipById(id) : null;
    if (!c && !id) c = selClips().find(x => x.kind === 'video') || null;
    if (!c || c.kind !== 'video') fail('حدد مقطع فيديو أولًا');
    const m = GW.media(c.media); if (!m || !m.path || m.offline) fail('ملف المقطع غير متاح');
    return { c, m };
  }
  const srcLow = (m) => m.px || m.proxy || m.path;   // analysis: the proxy is fine
  const srcFull = (m) => m.proxy || m.path;          // baking: full-resolution source
  async function cache() { const p = await GW.Media.cachePaths(); if (!p) fail('متاح في نسخة سطح المكتب'); return p; }
  const st = document.createElement('style');
  st.textContent = `
  .vt-pr{display:flex;flex-direction:column;gap:8px}.vt-pr .vt-st{color:var(--text2);font-size:11.5px;min-height:16px}
  .vt-strip{position:relative;height:22px;background:var(--bg1);border:1px solid var(--line2);border-radius:3px;overflow:hidden}
  .vt-strip i{position:absolute;top:0;bottom:0;width:2px;background:var(--accent);margin-inline-start:-1px}
  .vt-strip i.lo{background:var(--line3)}
  .vt-res{font-size:12px;color:var(--text2)}.vt-res b{color:var(--accent)}
  .vt-te{padding:8px 10px;line-height:2.05;font-size:14px;user-select:none;outline:0}
  .vt-te p{margin:0 0 4px}
  .vt-te .ts{font:10.5px var(--f-mono);color:var(--mute);margin-inline-end:6px;cursor:pointer;direction:ltr;display:inline-block}
  .vt-te .ts:hover{color:var(--text)}
  .vt-te .tw{cursor:text;border-radius:3px;padding:1px 1px}
  .vt-te .tw:hover{background:var(--bg4)}
  .vt-te .tw.fill{text-decoration:underline dotted var(--accent);text-underline-offset:5px}
  .vt-te .tw.cur{box-shadow:inset 0 -2px 0 var(--accent)}
  .vt-te .tw.sel{background:var(--accent);color:#fff}
  .vt-bar{display:flex;gap:4px;flex-wrap:wrap;align-items:center;padding:6px 8px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg2);z-index:1}
  .vt-bar .vt-info{color:var(--text2);font-size:11px;margin-inline-start:auto}
  .vt-bar .btn svg{vertical-align:-3px;margin-inline-end:3px}
  .vt-hint{color:var(--mute);font-size:11px;padding:4px 10px 0}`;
  document.head.append(st);

  // modal with a progress bar; resolves cancel through st.cancelled + onCancel
  function progressBox(title, onCancel) {
    const body = document.createElement('div'); body.className = 'vt-pr';
    body.innerHTML = '<div class="prog"><i></i></div><div class="vt-st"></div>';
    const S = { cancelled: false, done: false };
    const m = GW.modal({ title, body, width: 440, buttons: [{ label: 'إلغاء', value: null }], onClose: () => { if (!S.done) { S.cancelled = true; onCancel && onCancel(); } } });
    S.set = (p, txt) => { body.querySelector('.prog i').style.width = clamp(p, 0, 100).toFixed(1) + '%'; if (txt != null) body.querySelector('.vt-st').textContent = txt; };
    S.close = () => { S.done = true; m.close(); };
    return S;
  }

  /* ================= 1. scene edit detection ================= */
  // ffmpeg scene score per frame above a low floor → [{t: source offset from c.in (s), score}]
  VT.analyseScenes = async (c, m, onP, ctl = {}) => {
    const p = await cache(); const sp = c.speed || 1; const len = c.dur * sp;
    const out = p.cache + p.sep + 'scd_' + GW.uid() + '.txt'; const id = 'scd_' + GW.uid(); ctl.kill = () => kill(id);
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-stats', '-ss', c.in.toFixed(3), '-t', len.toFixed(3), '-i', srcLow(m), '-map', '0:v:0', '-an', '-sn', '-dn',
      '-vf', `scale=320:-2:flags=fast_bilinear,select='gt(scene,0.06)',metadata=print:file=${fpath(out)}`, '-f', 'null', '-'];
    const r = await ff(id, args, (t) => onP && onP(Math.min(99, t / len * 100)));
    if (ctl.cancelled || r.killed) { api().remove(out); return null; }
    if (!r.ok) fail('فشل تحليل المشاهد: ' + String(r.log || '').slice(-200));
    const txt = (await api().exists(out)) ? await api().readText(out) : ''; api().remove(out);
    const res = []; const re = /pts_time:(-?[\d.]+)[^\n]*\n\s*lavfi\.scene_score=([\d.]+)/g; let mm;
    while ((mm = re.exec(txt))) res.push({ t: +mm[1], score: +mm[2] });
    return res;
  };
  const thrOf = (sens) => +(0.6 - clamp(sens, 0, 100) / 100 * 0.5).toFixed(3); // 0 → 0.6 (only hard cuts), 100 → 0.1
  // sequence times of the cuts for a sensitivity (0–100) and a minimum shot length
  VT.pickCuts = (scores, c, sens, minShot, fps) => {
    const thr = thrOf(sens); const sp = c.speed || 1; const end = c.start + c.dur; const out = []; let last = c.start;
    for (const x of scores) {
      if (x.score < thr) continue;
      const t = snap(c.start + Math.max(0, x.t) / sp, fps);
      if (t - last < minShot - 1e-6 || t >= end - Math.max(1 / fps, minShot * .5)) continue;
      out.push(t); last = t;
    }
    return out;
  };
  VT.applyCuts = (c, times, action) => {
    const s = GW.seq();
    if (action === 'markers') {
      times.forEach((t, i) => s.markers.push({ id: GW.uid(), t, name: 'تغيّر مشهد ' + (i + 1), color: '#ff6a2b', note: 'كشف تغيّر المشاهد' }));
    } else {
      let group = [c, ...GW.linked(s, c)];
      for (const t of times) {
        const map = {};
        group = group.map(x => { if (!(t > x.start + 1e-4 && t < x.start + x.dur - 1e-4)) return x; const b = GW.ops.split(s, x, t); if (!b) return x; if (x.link) b.link = map[x.link] || (map[x.link] = GW.uid()); return b; });
      }
    }
    GW.commit(action === 'markers' ? 'علامات تغيّر المشاهد' : 'قطع عند تغيّر المشاهد'); GW.invalidate(); if (GW.TL) GW.TL.invalidate();
    return times.length;
  };
  const SC_KEY = 'gws.vt.scene';
  const scOpts = () => { const o = { sens: 50, minShot: .5, action: 'cut' }; try { Object.assign(o, JSON.parse(localStorage.getItem(SC_KEY) || '{}')); } catch (e) {} return o; };
  UI.sceneDetect = async (id) => {
    let c, m; try { ({ c, m } = videoClip(id)); } catch (e) { GW.toast(e.message, 'err'); return; }
    const o = scOpts(); const F = UI.form; const ctl = { cancelled: false };
    const body = document.createElement('div'); body.className = 'form vt-pr'; body.style.padding = '0';
    const pr = document.createElement('div'); pr.innerHTML = '<div class="prog"><i></i></div><div class="vt-st">جارٍ تحليل المشاهد…</div>';
    const strip = document.createElement('div'); strip.className = 'vt-strip';
    const res = document.createElement('div'); res.className = 'vt-res';
    body.append(pr, strip, res,
      F.frow('الحساسية', F.rangeIn(o.sens, 0, 100, 1, v => { o.sens = v; draw(); })),
      F.frow('أقصر لقطة (ث)', F.rangeIn(o.minShot, .1, 5, .1, v => { o.minShot = v; draw(); })),
      F.frow('النتيجة', F.segIn([['cut', 'قطع المقطع'], ['markers', 'إضافة علامات']], o.action, v => { o.action = v; })));
    let scores = null;
    const s = GW.seq();
    const draw = () => {
      if (!scores) return; const thr = thrOf(o.sens); const cuts = VT.pickCuts(scores, c, o.sens, o.minShot, s.fps); const sp = c.speed || 1;
      strip.innerHTML = scores.filter(x => x.score >= .1).map(x => `<i class="${x.score >= thr ? '' : 'lo'}" style="inset-inline-start:${(x.t / sp / c.dur * 100).toFixed(2)}%;opacity:${x.score >= thr ? 1 : .6}"></i>`).join('');
      res.innerHTML = 'تغيّرات المشاهد: <b>' + cuts.length + '</b>';
    };
    const dlg = GW.modal({ title: 'كشف تغيّر المشاهد', body, width: 480, onClose: () => { ctl.cancelled = true; if (ctl.kill) ctl.kill(); }, buttons: [{ label: 'إلغاء', value: null }, { label: 'تطبيق', primary: true, action: () => {
      if (!scores) return false; try { localStorage.setItem(SC_KEY, JSON.stringify(o)); } catch (e) {}
      const cuts = VT.pickCuts(scores, c, o.sens, o.minShot, s.fps); if (!cuts.length) { GW.toast('لم يتم العثور على تغيّر مشاهد بهذه الحساسية'); return false; }
      VT.applyCuts(c, cuts, o.action); GW.toast((o.action === 'markers' ? 'علامات مضافة: ' : 'قطع مضافة: ') + cuts.length);
    } }] });
    try {
      scores = await VT.analyseScenes(c, m, (p) => { pr.querySelector('i').style.width = p.toFixed(1) + '%'; pr.querySelector('.vt-st').textContent = 'جارٍ تحليل المشاهد · ' + Math.round(p) + '%'; }, ctl);
      if (!scores) return; pr.querySelector('i').style.width = '100%'; pr.querySelector('.vt-st').textContent = 'اكتمل التحليل — اضبط الحساسية ثم اضغط «تطبيق»'; draw();
    } catch (e) { pr.querySelector('.vt-st').textContent = e.message; GW.toast(e.message, 'err'); void dlg; }
  };

  /* ================= 2. text-based editing ================= */
  const CAP = () => GW.Captions;
  // remove [t0,t1) ranges (sequence seconds) from every unlocked track, keep sync, remap transcript + markers
  VT.deleteRanges = (ranges, label, s) => {
    s = s || GW.seq(); const fps = s.fps || 30;
    let rs = ranges.map(([a, b]) => [snap(Math.min(a, b), fps), snap(Math.max(a, b), fps)]).filter(([a, b]) => b - a > 1e-6).sort((x, y) => x[0] - y[0]);
    const mg = []; for (const r of rs) { const l = mg[mg.length - 1]; if (l && r[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], r[1]); else mg.push([...r]); } rs = mg;
    if (!rs.length) return { removed: 0, ranges: [] };
    const links = new Set();
    for (const [a, b] of rs) for (const c of s.clips) if (c.link && c.start < b && c.start + c.dur > a) links.add(c.link);
    for (let i = rs.length - 1; i >= 0; i--) GW.ops.liftRange(s, rs[i][0], rs[i][1], true);
    // pieces of one linked group that were cut apart get their own link ids (clear() clones the link)
    for (const L of links) {
      const g = s.clips.filter(c => c.link === L); const by = new Map();
      for (const c of g) { const k = Math.round(c.start * 1000); if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
      if (by.size > 1) { let first = true; for (const [, list] of by) { const id = first ? L : GW.uid(); first = false; list.forEach(c => c.link = list.length > 1 ? id : null); } }
      else if (g.length === 1) g[0].link = null;
    }
    const inside = (t) => rs.some(([a, b]) => t > a + 1e-6 && t < b - 1e-6);
    const map = (t) => { let d = 0; for (const [a, b] of rs) { if (t >= b) d += b - a; else if (t > a) return a - d; } return t - d; };
    s.markers = s.markers.filter(mk => !inside(mk.t)); s.markers.forEach(mk => mk.t = map(mk.t));
    if (s.inP != null) s.inP = map(s.inP); if (s.outP != null) s.outP = map(s.outP); if (s.inP != null && s.outP != null && s.outP <= s.inP) s.outP = null;
    const tr = s.transcript;
    if (tr && tr.segs) {
      const out = [];
      for (const g of tr.segs) {
        const ws = CAP().alignWords(g).filter(w => !inside((w.t0 + w.t1) / 2)).map(w => ({ w: w.w, t0: +map(w.t0).toFixed(3), t1: +map(w.t1).toFixed(3) }));
        if (!ws.length) continue;
        out.push({ id: g.id, t0: +Math.min(map(g.t0), ws[0].t0).toFixed(3), t1: +Math.max(ws[ws.length - 1].t1, Math.min(map(g.t1), ws[ws.length - 1].t1 + 1)).toFixed(3), text: ws.map(w => w.w).join(' '), words: ws });
      }
      tr.segs = out;
    }
    s.t = map(s.t);
    GW.sel.clips.clear(); GW.commit(label || 'حذف من النص'); GW.bus.emit('selection'); GW.invalidate(); if (GW.TL) GW.TL.invalidate();
    return { removed: +rs.reduce((a, [x, y]) => a + y - x, 0).toFixed(3), ranges: rs };
  };
  const TASH = /[\u064B-\u065F\u0670\u0640]/g, PUNC = /[.,!?؟،؛;:"'«»()[\]{}\-–—…]/g;
  const FILL_AR = [/^يعني$/, /^[اآأإ]+م{2,}$/, /^م{2,}$/, /^ه+م{2,}$/, /^[اآأ]{2,}$/, /^آ+$/, /^[اآأ]+ه+$/, /^إ+ه+$/];
  const FILL_EN = [/^u+h+$/, /^u+m+$/, /^u+h+m+$/, /^e+r+m*$/, /^h+m+$/, /^m{2,}$/, /^a+h+$/, /^a{2,}$/, /^o+h+$/];
  VT.isFiller = (w) => { const x = String(w || '').toLowerCase().replace(TASH, '').replace(PUNC, '').trim(); if (!x) return false; return (GW.isAr(x) ? FILL_AR : FILL_EN).some(r => r.test(x)); };
  // flat list of transcript words [{gi, wi, w, t0, t1}]
  VT.words = (s) => { const tr = CAP().transcript(s); const out = []; if (!tr) return out; tr.segs.forEach((g, gi) => CAP().alignWords(g).forEach((w, wi) => out.push({ gi, wi, w: w.w, t0: w.t0, t1: w.t1 }))); return out; };
  // consecutive flat indices → time ranges
  VT.rangesOf = (flat, idx) => {
    const ii = [...idx].sort((a, b) => a - b); const rs = [];
    for (const i of ii) { const w = flat[i]; if (!w) continue; const l = rs[rs.length - 1]; if (l && l.last === i - 1) { l.r[1] = w.t1; l.last = i; } else rs.push({ r: [w.t0, w.t1], last: i }); }
    return rs.map(x => x.r);
  };
  VT.fillers = (s) => { const flat = VT.words(s); return flat.map((w, i) => VT.isFiller(w.w) ? i : -1).filter(i => i >= 0); };
  UI.removeFillers = async () => {
    const s = GW.seq(); const tr = CAP().transcript(s);
    if (!tr || !tr.segs.length) { GW.toast('لا يوجد تفريغ بعد — ابدأ التفريغ من لوحة «التفريغ والترجمة»'); GW.showPanel('captions'); return; }
    const flat = VT.words(s); const idx = VT.fillers(s);
    if (!idx.length) { GW.toast('لم يتم العثور على كلمات حشو'); return; }
    const rs = VT.rangesOf(flat, idx); const tot = rs.reduce((a, [x, y]) => a + y - x, 0);
    const ok = await GW.ask('إزالة كلمات الحشو', 'كلمات الحشو: ' + idx.length + ' · ' + tot.toFixed(1) + ' ث — ' + 'سيتم حذفها من الخط الزمني مع إزاحة كل المسارات غير المقفلة.', 'حذف');
    if (!ok) return;
    VT.deleteRanges(rs, 'إزالة كلمات الحشو', s); TE.sel.clear(); GW.toast('تمت إزالة كلمات الحشو: ' + idx.length);
  };

  // transcript panel: word view (hooked from ui_captions.js renderBody when CAP.textMode is on)
  const TE = VT.te = { sel: new Set(), anchor: -1, flat: [] };
  function teDelete() {
    const s = GW.seq(); if (!TE.sel.size) { GW.toast('حدد كلمات في النص أولًا'); return; }
    const rs = VT.rangesOf(TE.flat, TE.sel); const n = TE.sel.size; TE.sel.clear(); TE.anchor = -1;
    const r = VT.deleteRanges(rs, 'حذف من النص', s); GW.toast('كلمات محذوفة: ' + n + ' · ' + r.removed.toFixed(1) + ' ث');
  }
  VT.renderTextEdit = (s, tr) => {
    const wrap = document.createElement('div');
    const flat = TE.flat = VT.words(s); for (const i of [...TE.sel]) if (i >= flat.length) TE.sel.delete(i);
    const bar = document.createElement('div'); bar.className = 'vt-bar';
    const b = (label, ico, f, cls, title) => { const x = document.createElement('button'); x.className = 'btn sm ' + (cls || ''); x.innerHTML = (ico && GW.ico ? GW.ico(ico, 13) : '') + '<span>' + esc(label) + '</span>'; x.onclick = f; if (title) x.title = title; return x; };
    const info = document.createElement('span'); info.className = 'vt-info';
    bar.append(b('حذف المحدد', 'close', teDelete, 'pri', 'حذف الكلمات المحددة من الخط الزمني مع إزاحة كل المسارات غير المقفلة (Delete)'),
      b('تحديد كلمات الحشو', 'check', () => { TE.sel = new Set(VT.fillers(s)); paint(); if (!TE.sel.size) GW.toast('لم يتم العثور على كلمات حشو'); }),
      b('إزالة كلمات الحشو', 'wand', () => UI.removeFillers(), '', 'يعني، اممم، آآ، uh، um…'),
      b('إلغاء التحديد', null, () => { TE.sel.clear(); paint(); }), info);
    const box = document.createElement('div'); box.className = 'vt-te'; box.tabIndex = 0; box.dir = 'auto';
    let html = ''; let gi = -1;
    flat.forEach((w, i) => {
      if (w.gi !== gi) { if (gi >= 0) html += '</p>'; gi = w.gi; const g = tr.segs[gi]; html += `<p><span class="ts" data-t="${g.t0}">${fmtT(g.t0)}</span>`; }
      html += `<span class="tw${VT.isFiller(w.w) ? ' fill' : ''}" data-i="${i}">${esc(w.w)}</span> `;
    });
    if (gi >= 0) html += '</p>';
    box.innerHTML = html;
    const hint = document.createElement('div'); hint.className = 'vt-hint'; hint.textContent = 'انقر كلمة أو اسحب لتحديد عبارة (Shift للتوسيع، Ctrl للإضافة) ثم اضغط Delete — كلمات الحشو مسطّرة.';
    const spans = [...box.querySelectorAll('.tw')];
    function paint() {
      spans.forEach((x, i) => x.classList.toggle('sel', TE.sel.has(i)));
      const rs = VT.rangesOf(flat, TE.sel); const d = rs.reduce((a, [x, y]) => a + y - x, 0);
      info.textContent = TE.sel.size ? 'المحدد: ' + TE.sel.size + ' · ' + d.toFixed(1) + ' ث' : '';
    }
    let drag = null;
    const range = (a, z) => { const o = new Set(); for (let i = Math.min(a, z); i <= Math.max(a, z); i++) o.add(i); return o; };
    box.addEventListener('mousedown', e => {
      const ts = e.target.closest('.ts'); if (ts) { GW.seek(+ts.dataset.t + 1e-3); return; }
      const t = e.target.closest('.tw'); if (!t || e.button !== 0) return; e.preventDefault(); box.focus();
      const i = +t.dataset.i;
      if (e.shiftKey && TE.anchor >= 0) TE.sel = range(TE.anchor, i);
      else if (e.ctrlKey || e.metaKey) { if (TE.sel.has(i)) TE.sel.delete(i); else TE.sel.add(i); TE.anchor = i; }
      else { TE.sel = new Set([i]); TE.anchor = i; GW.seek(flat[i].t0 + 1e-3); }
      drag = { a: TE.anchor, base: (e.ctrlKey || e.metaKey) ? new Set(TE.sel) : null }; paint();
    });
    box.addEventListener('mouseover', e => {
      if (!drag || !(e.buttons & 1)) { drag = null; return; } const t = e.target.closest('.tw'); if (!t) return;
      const r = range(drag.a, +t.dataset.i); TE.sel = drag.base ? new Set([...drag.base, ...r]) : r; paint();
    });
    box.addEventListener('mouseup', () => { drag = null; });
    box.addEventListener('keydown', e => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); teDelete(); }
      else if (e.key === 'Escape') { e.stopPropagation(); TE.sel.clear(); paint(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); TE.sel = new Set(flat.map((_, i) => i)); paint(); }
    });
    TE.box = box; TE.spans = spans; TE.lastCur = -1;
    wrap.append(bar, hint, box); paint(); markWord();
    return wrap;
  };
  const fmtT = t => { t = Math.max(0, t); const m = Math.floor(t / 60), x = t - m * 60; return m + ':' + (x < 10 ? '0' : '') + x.toFixed(1); };
  function markWord() {
    if (!TE.box || !TE.box.isConnected) return; const t = GW.T(); const i = TE.flat.findIndex(w => t >= w.t0 && t < w.t1);
    if (i === TE.lastCur) return; if (TE.spans[TE.lastCur]) TE.spans[TE.lastCur].classList.remove('cur');
    TE.lastCur = i; if (TE.spans[i]) { TE.spans[i].classList.add('cur'); if (GW.pb.playing) TE.spans[i].scrollIntoView({ block: 'nearest' }); }
  }
  GW.bus.on('time', markWord);
  if (GW.Captions) GW.Captions.renderTextEdit = VT.renderTextEdit;
  UI.textEdit = () => { const C = CAP(); C.textMode = true; GW.showPanel('captions'); if (C.renderBody) C.renderBody(); if (!C.transcript()) GW.toast('لا يوجد تفريغ بعد — اضغط «بدء التفريغ» أولًا'); };

  /* ================= 3. stabilize ================= */
  let vsP = null;
  VT.hasVidstab = () => vsP || (vsP = (async () => {
    try { const p = await cache(); const f = p.cache + p.sep + 'vs_test_' + GW.uid() + '.trf';
      const r = await ff('vstest_' + GW.uid(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=10:d=0.3', '-vf', 'vidstabdetect=result=' + fpath(f), '-f', 'null', '-']);
      api().remove(f); return !!r.ok; } catch (e) { return false; }
  })());
  const canH264 = () => { try { return !!document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'); } catch (e) { return false; } };
  VT.stabilize = async (o = {}, onP, ctl = {}) => {
    const { c, m } = videoClip(o.id); const s = GW.seq();
    const strength = clamp(+o.strength || 5, 1, 10);
    let method = o.method || 'auto'; const vs = await VT.hasVidstab(); if (method === 'auto') method = vs ? 'vidstab' : 'deshake'; if (method === 'vidstab' && !vs) method = 'deshake';
    const p = await cache(); const sp = c.speed || 1;
    const ss = Math.max(0, c.in - .5); const len = Math.min((m.dur || 1e9) - ss, c.dur * sp + (c.in - ss) + .5);
    const h264 = canH264(); const ext = h264 ? '.mp4' : '.webm';
    const dir = p.renders + p.sep + 'stabilized'; await api().writeText(dir + p.sep + '.keep', '');
    const base = (m.name || 'clip').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    const out = dir + p.sep + base + '_stab_' + GW.uid().slice(0, 5) + ext;
    const id = 'stab_' + GW.uid(); ctl.kill = () => kill(id);
    const inArgs = ['-ss', ss.toFixed(3), '-t', len.toFixed(3), '-i', srcFull(m)];
    let vf;
    if (method === 'vidstab') {
      const trf = p.cache + p.sep + id + '.trf';
      onP && onP(0, 'تحليل الاهتزاز');
      const r1 = await ff(id, ['-y', '-hide_banner', '-loglevel', 'error', '-stats', ...inArgs, '-map', '0:v:0', '-an', '-vf', `vidstabdetect=shakiness=${Math.min(10, 3 + Math.round(strength * .7))}:accuracy=12:result=${fpath(trf)}`, '-f', 'null', '-'], t => onP && onP(Math.min(45, t / len * 45), 'تحليل الاهتزاز'));
      if (ctl.cancelled || r1.killed) { api().remove(trf); return null; }
      if (!r1.ok) { api().remove(trf); fail('فشل تحليل الاهتزاز: ' + String(r1.log || '').slice(-200)); }
      vf = `vidstabtransform=input=${fpath(trf)}:smoothing=${Math.round(4 + strength * 4)}:optzoom=1:zoomspeed=0.2:interpol=bicubic,unsharp=5:5:0.6:3:3:0.3,format=yuv420p`;
      ctl.trf = trf;
    } else {
      const rr = Math.round(8 + strength * 6);
      vf = `deshake=rx=${Math.min(64, rr)}:ry=${Math.min(64, rr)}:edge=3,format=yuv420p`;
    }
    const enc = [];
    const caps = h264 && GW.Media.caps ? await GW.Media.caps().catch(() => ({})) : {};
    const encs = !h264 ? ['vp9'] : caps.h264_nvenc ? ['nvenc', 'x264'] : ['x264'];
    let r2 = null;
    for (const e of encs) {
      enc.length = 0;
      if (e === 'vp9') enc.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-deadline', 'realtime', '-cpu-used', '6', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '160k');
      else if (e === 'nvenc') enc.push('-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-g', String(Math.round(m.fps || 30)), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart');
      else enc.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-g', String(Math.round(m.fps || 30)), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart');
      const p0 = method === 'vidstab' ? 45 : 0;
      onP && onP(p0, 'تثبيت الإطارات');
      r2 = await ff(id, ['-y', '-hide_banner', '-loglevel', 'error', '-stats', ...inArgs, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, ...enc, out], t => onP && onP(p0 + Math.min(99 - p0, t / len * (100 - p0)), 'تثبيت الإطارات'));
      if (r2.ok || ctl.cancelled || r2.killed) break;
    }
    if (ctl.trf) api().remove(ctl.trf);
    if (ctl.cancelled || r2.killed) { api().remove(out); return null; }
    if (!r2.ok) fail('فشل التثبيت: ' + String(r2.log || '').slice(-200));
    onP && onP(99, 'استيراد الملف المثبّت');
    const added = await GW.Media.importFiles([{ path: out, name: out.split(/[\\/]/).pop(), size: 0 }]);
    const nm = added[0] || GW.prj.media.find(x => x.path === out); if (!nm) fail('تعذر استيراد الملف المثبّت');
    if ((GW.rt.m[nm.id] || {}).status !== 'ready') fail('تعذر تجهيز الملف المثبّت');
    // the clip (and every piece of the same source using the same range) now plays the stabilized file; original media stays in the project
    const cs = s.clips.filter(x => x === c);
    for (const x of cs) { x.stab = { orig: m.id, ss: +ss.toFixed(4), method }; x.media = nm.id; x.in = +(x.in - ss).toFixed(6); if (!/\(مثبّت\)$/.test(x.name)) x.name = (x.name || '') + ' (مثبّت)'; GW.Media.dropVid(x.id); }
    GW.commit('تثبيت الفيديو'); GW.invalidate(); if (GW.TL) GW.TL.invalidate();
    return { media: nm, clip: c, method };
  };
  VT.unstabilize = (id) => {
    const s = GW.seq(); const cs = id ? [GW.clipById(id)].filter(Boolean) : selClips(); let n = 0;
    for (const c of cs) { if (!c.stab) continue; const o = GW.media(c.stab.orig); if (!o) continue; c.media = o.id; c.in = +(c.in + c.stab.ss).toFixed(6); c.name = String(c.name || '').replace(/ \(مثبّت\)$/, ''); delete c.stab; GW.Media.dropVid(c.id); n++; }
    if (n) { GW.commit('إلغاء التثبيت'); GW.invalidate(); } void s; return n;
  };
  UI.stabilize = async (id) => {
    let c; try { ({ c } = videoClip(id)); } catch (e) { GW.toast(e.message, 'err'); return; }
    const F = UI.form; const o = { strength: 5, method: 'auto' }; const vs = await VT.hasVidstab();
    const body = document.createElement('div'); body.className = 'form'; body.style.padding = '0';
    body.append(F.frow('القوة', F.rangeIn(o.strength, 1, 10, 1, v => { o.strength = v; })),
      F.frow('الطريقة', F.selectIn([['auto', vs ? 'تلقائي (VidStab)' : 'تلقائي (Deshake)'], ...(vs ? [['vidstab', 'VidStab — تحليل بمرورين (أدق)']] : []), ['deshake', 'Deshake — مرور واحد (أسرع)']], o.method, v => { o.method = v; })));
    const note = document.createElement('p'); note.style.cssText = 'color:var(--text2);font-size:11.5px;margin:6px 0 0';
    note.textContent = 'يُنشأ ملف فيديو جديد مثبّت ويحل محل مصدر المقطع. الملف الأصلي يبقى في المشروع، ويمكن التراجع أو «إلغاء التثبيت» في أي وقت.';
    body.append(note);
    GW.modal({ title: 'تثبيت الفيديو', body, width: 460, buttons: [{ label: 'إلغاء', value: null }, { label: 'تثبيت', primary: true, action: () => { run(); } }] });
    async function run() {
      const ctl = {}; const pb = progressBox('تثبيت الفيديو: ' + c.name, () => { ctl.cancelled = true; if (ctl.kill) ctl.kill(); });
      try { const r = await VT.stabilize({ id: c.id, strength: o.strength, method: o.method }, (p, t) => pb.set(p, t ? t + ' · ' + Math.round(p) + '%' : null), ctl); pb.close(); if (r) GW.toast('تم تثبيت المقطع (' + (r.method === 'vidstab' ? 'VidStab' : 'Deshake') + ')'); else GW.toast('أُلغي التثبيت'); }
      catch (e) { pb.close(); GW.toast(e.message, 'err'); }
    }
  };

  /* ================= 4. auto reframe for vertical sequences ================= */
  // low-res gray frames → per 0.5 s window, the source-x centre of the crop window holding most motion (+ some edge saliency)
  VT.analyseReframe = async (c, m, visFrac, onP, ctl = {}) => {
    const p = await cache(); const sp = c.speed || 1; const len = c.dur * sp; const FPS = 6;
    const W = 96, H = Math.max(8, Math.round(W * c.sh / c.sw / 2) * 2);
    const out = p.cache + p.sep + 'rfr_' + GW.uid() + '.gray'; const id = 'rfr_' + GW.uid(); ctl.kill = () => kill(id);
    const r = await ff(id, ['-y', '-hide_banner', '-loglevel', 'error', '-stats', '-ss', c.in.toFixed(3), '-t', len.toFixed(3), '-i', srcLow(m), '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `fps=${FPS},scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', out], t => onP && onP(Math.min(90, t / len * 90)));
    if (ctl.cancelled || r.killed) { api().remove(out); return null; }
    if (!r.ok) fail('فشل تحليل الحركة: ' + String(r.log || '').slice(-200));
    const buf = new Uint8Array(await (await fetch(api().mediaUrl(out))).arrayBuffer()); api().remove(out);
    const fs = W * H; const n = Math.floor(buf.length / fs); if (n < 1) fail('لا توجد إطارات للتحليل');
    const WIN = .5; const nWin = Math.max(1, Math.ceil(len / WIN));
    const colM = Array.from({ length: nWin }, () => new Float32Array(W)), colE = Array.from({ length: nWin }, () => new Float32Array(W));
    for (let f = 0; f < n; f++) {
      const j = Math.min(nWin - 1, Math.floor(f / FPS / WIN)); const o0 = f * fs, o1 = (f - 1) * fs; const cm = colM[j], ce = colE[j];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x; const v = buf[o0 + i];
        if (f > 0) { const d = Math.abs(v - buf[o1 + i]); if (d > 10) cm[x] += d; }
        const g = Math.abs(buf[o0 + i + 1] - buf[o0 + i - 1]) + Math.abs(buf[o0 + i + W] - buf[o0 + i - W]); if (g > 24) ce[x] += g;
      }
    }
    const win = Math.max(1, Math.round(W * visFrac)); const half = win / 2;
    const centres = []; let prev = W / 2;
    for (let j = 0; j < nWin; j++) {
      const cm = colM[j], ce = colE[j]; let sm = 0, se = 0; for (let x = 0; x < W; x++) { sm += cm[x]; se += ce[x]; }
      const moving = sm > fs * 0.4; // ignore compression noise
      const prof = new Float32Array(W); for (let x = 0; x < W; x++) prof[x] = (moving ? cm[x] / sm * .8 : 0) + (se ? ce[x] / se * (moving ? .2 : 1) : 0);
      if (!moving && !se) { centres.push(prev); continue; }
      // best crop window (prefix sums); ties → nearest to the previous centre
      const ps = new Float32Array(W + 1); for (let x = 0; x < W; x++) ps[x + 1] = ps[x] + prof[x];
      let best = -1, bx = prev - half;
      for (let x0 = 0; x0 + win <= W; x0++) { const v = ps[x0 + win] - ps[x0] - Math.abs(x0 + half - prev) * 1e-4; if (v > best) { best = v; bx = x0; } }
      // refine inside the window: weighted centroid, so the subject (not the window edge) is centred
      let sw = 0, sx = 0; for (let x = Math.floor(bx); x < Math.min(W, bx + win); x++) { sw += prof[x]; sx += prof[x] * (x + .5); }
      const cx = sw > 0 ? sx / sw : bx + half; prev = cx; centres.push(cx);
    }
    onP && onP(95);
    return { centres: centres.map(x => x / W), win: WIN, n: nWin };
  };
  VT.smooth = (xs, amount) => { // median of 3, then zero-phase exponential smoothing
    if (xs.length < 3) return xs.slice();
    const md = xs.map((x, i) => { const a = xs[Math.max(0, i - 1)], b = x, c = xs[Math.min(xs.length - 1, i + 1)]; return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); });
    const a = clamp(1 - amount / 100 * .92, .05, 1); const f = md.slice(); for (let i = 1; i < f.length; i++) f[i] = f[i - 1] + a * (md[i] - f[i - 1]);
    for (let i = f.length - 2; i >= 0; i--) f[i] = f[i + 1] + a * (f[i] - f[i + 1]);
    return f;
  };
  VT.reframe = async (o = {}, onP, ctl = {}) => {
    const { c, m } = videoClip(o.id); const s = GW.seq();
    if (!(s.h > s.w)) fail('التأطير التلقائي يتطلب تسلسلًا عموديًا (مثل 1080×1920)');
    if (!(c.sw > c.sh)) fail('المقطع ليس أفقيًا');
    const zoom = clamp(+o.zoom || 100, 100, 300); const amount = clamp(o.smooth == null ? 60 : +o.smooth, 0, 100);
    const scale = s.h / c.sh * zoom; // percent
    const visW = s.w / (scale / 100); const visFrac = Math.min(1, visW / c.sw);
    const an = await VT.analyseReframe(c, m, visFrac, onP, ctl); if (!an) return null;
    const sm = VT.smooth(an.centres, amount); const sp = c.speed || 1; const fps = s.fps || 30;
    const lo = visW / 2, hi = c.sw - visW / 2; const y = s.h / 2;
    const px = (u) => { const cx = clamp(u * c.sw, Math.min(lo, hi), Math.max(lo, hi)); return Math.round((s.w / 2 + (c.sw / 2 - cx) * scale / 100) * 10) / 10; };
    let ks = sm.map((u, j) => ({ t: snap(Math.min(c.dur, (j * an.win + an.win / 2) / sp), fps), v: [px(u), y], e: 'linear' }));
    ks.unshift({ t: 0, v: [ks[0].v[0], y], e: 'linear' }); ks.push({ t: snap(c.dur, fps), v: [ks[ks.length - 1].v[0], y], e: 'linear' });
    ks = ks.filter((k, i) => i === 0 || k.t > ks[i - 1].t + 1e-6);
    // drop keys that a straight line through their neighbours already reproduces (≤ 2 px)
    const keep = [ks[0]];
    for (let i = 1; i < ks.length - 1; i++) { const a = keep[keep.length - 1], b = ks[i + 1], k = ks[i]; const u = (k.t - a.t) / (b.t - a.t || 1); if (Math.abs(a.v[0] + (b.v[0] - a.v[0]) * u - k.v[0]) > 2) keep.push(k); }
    if (ks.length > 1) keep.push(ks[ks.length - 1]);
    c.motion.scale = GW.P(Math.round(scale * 100) / 100); c.motion.anchor = GW.P([c.sw / 2, c.sh / 2]);
    c.motion.pos = keep.length > 1 && keep.some(k => Math.abs(k.v[0] - keep[0].v[0]) > .5) ? { v: keep[0].v, k: keep } : GW.P(keep[0].v);
    GW.commit('تأطير تلقائي'); GW.invalidate(); GW.bus.emit('param'); if (GW.TL) GW.TL.invalidate();
    return { keys: (c.motion.pos.k || []).length, scale: c.motion.pos && c.motion.scale.v, centres: an.centres };
  };
  UI.reframe = async (id) => {
    let c; try { ({ c } = videoClip(id)); const s = GW.seq(); if (!(s.h > s.w)) fail('التأطير التلقائي يتطلب تسلسلًا عموديًا (مثل 1080×1920)'); if (!(c.sw > c.sh)) fail('المقطع ليس أفقيًا'); } catch (e) { GW.toast(e.message, 'err'); return; }
    const F = UI.form; const o = { smooth: 60, zoom: 100 };
    const body = document.createElement('div'); body.className = 'form'; body.style.padding = '0';
    body.append(F.frow('نعومة حركة الكاميرا', F.rangeIn(o.smooth, 0, 100, 1, v => { o.smooth = v; })), F.frow('تكبير إضافي (%)', F.rangeIn(o.zoom, 100, 200, 5, v => { o.zoom = v; })));
    const note = document.createElement('p'); note.style.cssText = 'color:var(--text2);font-size:11.5px;margin:6px 0 0'; note.textContent = 'يحلل الحركة في المقطع ويكتب إطارات مفتاحية للموضع حتى يبقى الموضوع داخل الإطار العمودي. تُستبدل مفاتيح الموضع الحالية.';
    body.append(note);
    GW.modal({ title: 'تأطير تلقائي', body, width: 440, buttons: [{ label: 'إلغاء', value: null }, { label: 'تحليل وتطبيق', primary: true, action: () => { run(); } }] });
    async function run() {
      const ctl = {}; const pb = progressBox('تأطير تلقائي: ' + c.name, () => { ctl.cancelled = true; if (ctl.kill) ctl.kill(); });
      try { const r = await VT.reframe({ id: c.id, smooth: o.smooth, zoom: o.zoom }, p => pb.set(p, 'تحليل الحركة · ' + Math.round(p) + '%'), ctl); pb.close(); if (r) GW.toast('إطارات مفتاحية للتأطير التلقائي: ' + r.keys); }
      catch (e) { pb.close(); GW.toast(e.message, 'err'); }
    }
  };

  /* ================= commands, menus, context menu ================= */
  const C = GW.cmd;
  C.sceneDetect = () => UI.sceneDetect(); C.stabilize = () => UI.stabilize(); C.unstabilize = () => { if (!VT.unstabilize()) GW.toast('المقطع المحدد غير مثبّت'); };
  C.reframe = () => UI.reframe(); C.textEdit = () => UI.textEdit(); C.removeFillers = () => UI.removeFillers();
  const clipItems = () => [
    { label: 'كشف تغيّر المشاهد…', action: C.sceneDetect }, { label: 'تثبيت الفيديو…', action: C.stabilize },
    ...(selClips().some(c => c.stab) ? [{ label: 'إلغاء التثبيت', action: C.unstabilize }] : []),
    { label: 'تأطير تلقائي (9:16)…', action: C.reframe, disabled: !(GW.seq().h > GW.seq().w) }
  ];
  const seqItems = () => [{ label: 'التعديل بالنص', action: C.textEdit }, { label: 'إزالة كلمات الحشو…', action: C.removeFillers }];
  const wrapMenu = (name, f2) => { const e = GW.MENUS && GW.MENUS.find(m => m[0] === name); if (!e) return false; const f = e[1]; e[1] = () => [...f(), '-', ...f2()]; return true; };
  wrapMenu('مقطع', () => [{ label: 'أدوات الفيديو الذكية', sub: clipItems().filter(x => x === '-' || !x.disabled) }]); wrapMenu('تسلسل', seqItems);
  // a shared «أدوات ذكية» menu (if another module creates it) gets the video tools too — checked when the menu bar is built
  const init0 = GW.initShell;
  GW.initShell = (...a) => { wrapMenu('أدوات ذكية', () => [...clipItems(), '-', ...seqItems()]); return init0(...a); };
  // timeline clip context menu (ui_timeline.js calls GW.clipMenuHooks)
  (GW.clipMenuHooks = GW.clipMenuHooks || []).push((items, c, s) => {
    if (c.kind !== 'video') return;
    const sub = [{ label: 'كشف تغيّر المشاهد…', action: () => UI.sceneDetect(c.id) }, c.stab ? { label: 'إلغاء التثبيت', action: () => VT.unstabilize(c.id) } : { label: 'تثبيت الفيديو…', action: () => UI.stabilize(c.id) }];
    if (s.h > s.w && c.sw > c.sh) sub.push({ label: 'تأطير تلقائي', action: () => UI.reframe(c.id) });
    items.push('-', { label: 'أدوات الفيديو الذكية', sub });
  });

  /* ================= automation (GW.API) ================= */
  const A = GW.API && GW.API.methods;
  if (A) {
    const lbl = (x) => 'المساعد: ' + x;
    const relabel = (x) => { const H = GW.hist; if (H.labels[H.idx] === x) { H.labels[H.idx] = lbl(x); GW.bus.emit('hist'); } };
    // detectScenes({id, sensitivity=50 (0–100), minShot=0.5, action:'cut'|'markers'|'none'}) → {times, threshold}
    A.detectScenes = async ({ id, sensitivity = 50, minShot = .5, action = 'cut' } = {}) => {
      const { c, m } = videoClip(id); const sc = await VT.analyseScenes(c, m); const times = VT.pickCuts(sc, c, +sensitivity, +minShot, GW.seq().fps);
      if (action !== 'none' && times.length) { VT.applyCuts(c, times, action === 'markers' ? 'markers' : 'cut'); relabel(action === 'markers' ? 'علامات تغيّر المشاهد' : 'قطع عند تغيّر المشاهد'); }
      return { times, threshold: thrOf(+sensitivity), applied: action !== 'none' ? action : null };
    };
    // textDelete({ranges:[[t0,t1]…]} | {words:[[segIndex, wordIndex]…]} | {text:'phrase'}) → {removed, ranges}
    A.textDelete = ({ ranges, words, text } = {}) => {
      const s = GW.seq(); let rs = [];
      if (Array.isArray(ranges)) rs = ranges.map(r => [+r[0], +r[1]]);
      else {
        const flat = VT.words(s); if (!flat.length) fail('no transcript on this sequence (transcribe first)'); const idx = new Set();
        if (Array.isArray(words)) for (const [gi, wi] of words) { const i = flat.findIndex(w => w.gi === +gi && w.wi === +wi); if (i < 0) fail('word not found: ' + gi + ':' + wi); idx.add(i); }
        else if (text) { const norm = x => String(x).toLowerCase().replace(TASH, '').replace(PUNC, ''); const q = String(text).split(/\s+/).filter(Boolean).map(norm);
          for (let i = 0; i + q.length <= flat.length; i++) if (q.every((w, k) => norm(flat[i + k].w) === w)) for (let k = 0; k < q.length; k++) idx.add(i + k);
          if (!idx.size) fail('phrase not found in transcript: ' + text); }
        else fail('give ranges, words or text');
        rs = VT.rangesOf(flat, idx);
      }
      const r = VT.deleteRanges(rs, 'حذف من النص', s); relabel('حذف من النص'); return r;
    };
    // removeFillers({dryRun}) → {count, words, ranges, removed}
    A.removeFillers = ({ dryRun = false } = {}) => {
      const s = GW.seq(); const flat = VT.words(s); if (!flat.length) fail('no transcript on this sequence (transcribe first)');
      const idx = VT.fillers(s); const rs = VT.rangesOf(flat, idx); const out = { count: idx.length, words: idx.map(i => flat[i].w), ranges: rs };
      if (!dryRun && rs.length) { Object.assign(out, VT.deleteRanges(rs, 'إزالة كلمات الحشو', s)); relabel('إزالة كلمات الحشو'); }
      return out;
    };
    // stabilize({id, strength=5 (1–10), method:'auto'|'vidstab'|'deshake'}) → {media, clip, method}
    A.stabilize = async (o = {}) => { const r = await VT.stabilize(o); relabel('تثبيت الفيديو'); return { media: { id: r.media.id, name: r.media.name, path: r.media.path }, clip: GW.API.clipInfo(r.clip), method: r.method }; };
    A.unstabilize = ({ id } = {}) => ({ restored: VT.unstabilize(id) });
    // autoReframe({id, smooth=60 (0–100), zoom=100 (%)}) → {keys}
    A.autoReframe = async (o = {}) => { const r = await VT.reframe(o); relabel('تأطير تلقائي'); return { keys: r.keys, clip: GW.API.clipInfo(GW.clipById(o.id) || selClips()[0]) }; };
  }
})();
