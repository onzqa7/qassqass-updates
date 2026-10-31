'use strict';
/* workspaces v6 — purpose-built pages (app.js GW.WS). Panels added here:
   «الصوت الأساسي» esound   — tag clips Dialogue / Music / SFX / Ambience → the right one-click tools (audio_fx.js presets, audio_tools.js repair)
   «محرر المقطع الصوتي» aclip — big waveform (or spectrum) of the selected audio clip, draggable gain envelope (c.vol keys), fade handles
                                  (single-sided audio transitions, same engine as preview/export), peak normalise
   «عدادات الجهارة» meters    — stereo peak meter + LUFS M / S / I and true peak (GW.AudioFX.meter) against a delivery target
   «التعليق الصوتي» vo        — voice-over recorder front-end (ui_voiceover.js GW.VO)
   «لقطات التسلسل» cstrip     — colour page clip strip: thumbnails of every picture clip, jump / compare, copy / paste grade
   «التسليم» deliver          — export presets, export queue with progress, render status (ui_export_presets.js)
   + Program A|B wipe against a reference still (colour page) and a graphics tool strip (text / shapes / align / safe guides). */
(function () {
  const { $, clamp, esc } = GW;
  const UI = GW.UI;
  const T = (ar, en) => GW.lang === 'en' ? en : ar;
  const AF = () => GW.AudioFX, AT = () => GW.AudioTools;
  const dbg = (db) => db <= -60 ? 0 : Math.pow(10, db / 20);
  const selClips = () => [...GW.sel.clips].map(id => GW.clipById(id)).filter(Boolean);
  const audioOf = (s, c) => (c.tt === 'a' ? [c] : GW.linked(s, c).filter(x => x.tt === 'a'));
  const selAudio = () => { const s = GW.seq(); const set = new Set(); for (const c of selClips()) audioOf(s, c).forEach(a => set.add(a)); return [...set]; };
  const empty = (ico, title, hint) => `<div class="empty v6e"><span class="v6e-ico">${GW.ico(ico, 26)}</span><b>${esc(title)}</b><span>${esc(hint)}</span></div>`;
  const liveRestart = () => { if (GW.pb.playing) { const s = GW.seq(); const t = s.t; GW.stop(); s.t = t; GW.play(1); } };
  const btn = (ico, label, cls, tip) => `<button class="btn sm ${cls || ''}" ${tip ? `title="${esc(tip)}"` : ''}>${ico ? GW.ico(ico, 13) : ''}<span>${esc(label)}</span></button>`;
  const run = (f) => async () => { try { await f(); } catch (e) { console.error(e); GW.toast(String(e.message || e), 'err'); } };

  /* ======================= Essential Sound ======================= */
  const TYPES = [['dlg', 'حوار', 'dialog'], ['music', 'موسيقى', 'music'], ['sfx', 'مؤثرات', 'bolt'], ['amb', 'أجواء', 'ambience']];
  let esEl = null;
  GW.registerPanel('esound', 'الصوت الأساسي', (el) => { esEl = el; el.innerHTML = '<div class="pscroll es6" data-a="b"></div>'; renderES(); });
  function guessType(c) { const m = GW.media(c.media) || {}; const n = (m.name || c.name || '').toLowerCase(); if (/music|song|موسيق|نشيد|beat/.test(n)) return 'music'; if (/sfx|whoosh|boom|hit|مؤثر/.test(n)) return 'sfx'; if (/amb|room|wind|rain|أجواء/.test(n)) return 'amb'; if (c.vo || /voice|vo_|dialog|تعليق|حوار|rec/.test(n)) return 'dlg'; return null; }
  function renderES() {
    if (!esEl) return; const b = esEl.querySelector('[data-a=b]'); const cs = selAudio(); const s = GW.seq();
    if (!cs.length) { b.innerHTML = empty('wave', 'لا يوجد مقطع صوتي محدد', 'حدد مقطعًا صوتيًا في الخط الزمني ثم صنّفه: حوار، موسيقى، مؤثرات أو أجواء — لتظهر أدواته المناسبة.'); return; }
    const types = new Set(cs.map(c => c.atype || '')); const cur = types.size === 1 ? [...types][0] : (types.size > 1 ? 'mixed' : '');
    const sug = !cur ? guessType(cs[0]) : null;
    b.innerHTML = `<div class="es-head"><div class="es-sel">${GW.ico('wave', 14)}<b>${cs.length === 1 ? esc(cs[0].name || 'مقطع') : cs.length + ' مقاطع صوتية'}</b>${cs.length === 1 ? `<span class="kv">${GW.fmtTC(cs[0].dur, s.fps)}</span>` : ''}</div>
      <div class="es-types">${TYPES.map(([k, n, ic]) => `<button class="es-type ${cur === k ? 'on' : ''} ${sug === k ? 'sug' : ''}" data-t="${k}">${GW.ico(ic, 20)}<span>${n}</span></button>`).join('')}</div>
      ${!cur ? `<div class="es-hint">${GW.ico('sparkle', 12)} اختر نوع الصوت${sug ? ' — مقترح: ' + TYPES.find(x => x[0] === sug)[1] : ''}</div>` : cur === 'mixed' ? '<div class="es-hint">المقاطع المحددة من أنواع مختلفة — اختر نوعًا لتوحيدها.</div>' : ''}</div><div class="es-body" data-a="tools"></div>`;
    b.querySelectorAll('[data-t]').forEach(x => x.onclick = () => { const t = x.dataset.t; const off = cur === t; cs.forEach(c => { if (off) delete c.atype; else c.atype = t; }); GW.commit(off ? 'إلغاء تصنيف الصوت' : 'تصنيف الصوت: ' + TYPES.find(y => y[0] === t)[1]); renderES(); });
    const tools = b.querySelector('[data-a=tools]');
    if (cur && cur !== 'mixed') esTools(tools, cur, cs, s);
    esLevel(tools, cs);
  }
  function card(box, ico, title, sub) { const d = document.createElement('div'); d.className = 'es-card'; d.innerHTML = `<div class="es-ct">${GW.ico(ico, 14)}<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div><div class="es-cb"></div>`; box.append(d); return d.querySelector('.es-cb'); }
  function action(box, ico, label, tip, f, cls) { const w = document.createElement('div'); w.innerHTML = btn(ico, label, 'es-act ' + (cls || ''), tip); const b = w.firstChild; b.onclick = run(f); box.append(b); return b; }
  const hasFx = (cs, t) => cs.length && cs.every(c => (c.afx || []).some(f => f.type === t));
  const addFx = (cs, type, params, label) => { AF().setFx(cs, [{ type, params: params || {} }], 'append'); GW.commit(label); liveRestart(); GW.FXC && GW.FXC.render && GW.FXC.render(); renderES(); };
  const rmFx = (cs, type, label) => { cs.forEach(c => { c.afx = (c.afx || []).filter(f => f.type !== type); }); GW.commit(label); liveRestart(); GW.FXC && GW.FXC.render && GW.FXC.render(); renderES(); };
  const toggleFx = (cs, type, params, n) => hasFx(cs, type) ? rmFx(cs, type, 'إزالة ' + n) : addFx(cs, type, params, n);
  function presetRow(box, ids, cs) {
    const row = document.createElement('div'); row.className = 'es-presets';
    for (const id of ids) { const P = AF().PRESETS[id]; if (!P) continue; const b = document.createElement('button'); b.className = 'chip'; b.textContent = P.n.replace(/^.*— /, ''); b.title = 'الصوت الأساسي: ' + P.n; b.onclick = run(async () => { await AF().applyPreset(id, cs); GW.toast('طُبّق: ' + P.n); renderES(); }); row.append(b); }
    box.append(row);
  }
  function esTools(box, t, cs, s) {
    if (t === 'dlg') {
      const p = card(box, 'dialog', 'إعداد الحوار', 'سلسلة جاهزة: تنقية، ضغط، محدد'); presetRow(p, ['dlg_clean', 'dlg_podcast', 'dlg_broadcast'], cs);
      const r = card(box, 'wand', 'إصلاح', 'أدوات بنقرة واحدة');
      action(r, 'sparkle', 'تقليل الضوضاء…', 'إزالة الضوضاء والطنين (FFmpeg) — الأصل محفوظ', () => AT().enhanceDialog()).classList.add('wide');
      action(r, 'wave', hasFx(cs, 'deesser') ? 'إزالة مزيل الصفير' : 'مزيل الصفير', 'يخفف حروف السين والشين الحادة', () => toggleFx(cs, 'deesser', { freq: 6500, thr: -30, ratio: 6 }, 'مزيل الصفير'), hasFx(cs, 'deesser') ? 'on' : '');
      action(r, 'sound', hasFx(cs, 'peq') ? 'إزالة الوضوح' : 'وضوح الصوت', 'معادل: يخفف الطنين ويبرز الكلام', () => toggleFx(cs, 'peq', { hp: 90, g2: -2, f2: 250, g4: 3, f4: 3500 }, 'وضوح الحوار'), hasFx(cs, 'peq') ? 'on' : '');
      const l = card(box, 'meter', 'الجهارة', 'توحيد المستوى لمنصة النشر');
      action(l, 'meter', 'توحيد الجهارة (-14 LUFS)…', 'تحليل وتطبيع الجهارة', () => AT().enhanceDialog('loud')).classList.add('wide');
      action(l, 'scissors', 'حذف الصمت…', 'إزالة الفراغات بين الجمل', () => AT().silenceDialog());
      action(l, 'chat', 'قياس المقطع', 'يقيس الجهارة المتكاملة وأعلى ذروة للمقطع', () => measure(l, cs));
    } else if (t === 'music') {
      const d = card(box, 'down', 'تحت الحوار', 'اخفض الموسيقى عندما يتكلم أحد');
      const ti = cs[0].ti; const D = s.at[ti] && s.at[ti].duck && s.at[ti].duck.on;
      action(d, 'down', D ? 'الخفض التلقائي مفعّل (الإعدادات)' : 'خفض تلقائي للمسار (Duck)', 'Sidechain مباشر بدون مفاتيح — يتبع أي تعديل', () => AF().duckDialog(ti), D ? 'on wide' : 'wide');
      action(d, 'key', 'خفض بمفاتيح حركة…', 'يكتب مفاتيح حجم الصوت حول الكلام', () => AT().duckDialog());
      presetRow(d, ['music_duck'], cs);
      const r = card(box, 'clock', 'المدة والإيقاع');
      action(r, 'scissors', 'ملاءمة طول التسلسل', 'يقص الموسيقى أو يمدها حتى نهاية الفيديو مع خفوت في النهاية', () => fitMusic(cs, s)).classList.add('wide');
      action(r, 'beat', 'علامات الإيقاع…', 'علامات على النبضات للقص على الإيقاع', () => AT().beatDialog());
      action(r, 'meter', 'توحيد الجهارة…', '', () => AT().enhanceDialog('loud'));
    } else if (t === 'sfx') {
      const p = card(box, 'bolt', 'مؤثرات صوتية', 'قص الترددات المنخفضة ومحدد ذروة'); presetRow(p, ['sfx'], cs);
      const r = card(box, 'sound', 'المكان والمسافة');
      action(r, 'ambience', hasFx(cs, 'reverb') ? 'إزالة الصدى' : 'صدى الغرفة', 'يضع المؤثر داخل المكان', () => toggleFx(cs, 'reverb', { kind: 'room', mix: 18 }, 'صدى'), hasFx(cs, 'reverb') ? 'on' : '');
      const pw = document.createElement('div'); pw.className = 'frow es-pan'; pw.innerHTML = '<label>التوازن</label><div class="ctl"></div>';
      const pv = GW.pv(cs[0].pan || GW.P(0), 0); const [ri, rv] = UI.form.rangeIn(pv, -100, 100, 1, v => { cs.forEach(c => { c.pan = GW.P(v); }); GW.commitSoon('توازن المقطع'); }); pw.querySelector('.ctl').append(ri, rv); r.append(pw);
      const l = card(box, 'music', 'مكتبة المؤثرات'); action(l, 'music', 'فتح مكتبة المؤثرات الصوتية', '', () => GW.showPanel('sfx')).classList.add('wide');
    } else if (t === 'amb') {
      const r = card(box, 'ambience', 'أجواء', 'خلفية هادئة لا تنافس الكلام');
      action(r, 'down', 'خفض المستوى -10 dB', '', () => { cs.forEach(c => { c.vol = GW.P(-10); }); GW.commit('مستوى الأجواء'); liveRestart(); renderES(); });
      const ti = cs[0].ti; const D = s.at[ti] && s.at[ti].duck && s.at[ti].duck.on;
      action(r, 'down', D ? 'الخفض التلقائي مفعّل' : 'خفض تحت الحوار', '', () => AF().duckDialog(ti), D ? 'on' : '');
      action(r, 'ambience', hasFx(cs, 'reverb') ? 'إزالة الاتساع' : 'اتساع (صدى قاعة)', '', () => toggleFx(cs, 'reverb', { kind: 'hall', mix: 25 }, 'اتساع الأجواء'), hasFx(cs, 'reverb') ? 'on' : '');
    }
  }
  function esLevel(box, cs) {
    const c0 = cs[0]; const anim = GW.isAnim(c0.vol || GW.P(0)); const v = GW.pv(c0.vol || GW.P(0), 0);
    const d = card(box, 'sound', 'مستوى المقطع', anim ? 'المقطع يحتوي مفاتيح حركة — عدّلها في محرر المقطع' : '');
    const f = document.createElement('div'); f.className = 'frow'; f.innerHTML = '<label>الكسب</label><div class="ctl"></div>';
    const [ri, rv] = UI.form.rangeIn(v, -40, 15, .5, x => { cs.forEach(c => { if (!GW.isAnim(c.vol)) c.vol = GW.P(x); }); GW.invalidate(); GW.commitSoon('مستوى الصوت'); GW.TL && GW.TL.invalidate && GW.TL.invalidate(); }); ri.disabled = anim;
    f.querySelector('.ctl').append(ri, rv); d.append(f);
    const row = document.createElement('div'); row.className = 'es-acts';
    action(row, 'wave', 'محرر المقطع', 'الموجة الكبيرة والمغلّف والخفوت', () => GW.showPanel('aclip'));
    action(row, 'wand', 'كل التأثيرات', 'عناصر التحكم في التأثيرات', () => GW.showPanel('fxc'));
    d.append(row);
  }
  function measure(box, cs) {
    const out = box.querySelector('.es-meas') || Object.assign(document.createElement('div'), { className: 'es-meas' }); box.append(out);
    const res = cs.map(c => { const m = GW.media(c.media); const r = m && GW.rt.m[m.id]; const ab = r && r.audio; if (!ab) return null; const sr = ab.sampleRate; const a = Math.max(0, Math.floor(c.in * sr)), b = Math.min(ab.length, Math.floor((c.in + c.dur * (c.speed || 1)) * sr)); if (b - a < sr * .4) return null; const v = { sampleRate: sr, numberOfChannels: Math.min(2, ab.numberOfChannels), length: b - a, getChannelData: (k) => ab.getChannelData(k).subarray(a, b) }; const L = GW.Loudness.measure(v); return { I: L.integrated + (GW.pv(c.vol || GW.P(0), 0)), TP: L.truePeak + GW.pv(c.vol || GW.P(0), 0) }; }).filter(Boolean);
    if (!res.length) { out.innerHTML = '<span class="mute">الصوت لم يُحمّل بعد — شغّل المقطع مرة ثم أعد المحاولة.</span>'; return; }
    const I = res.reduce((a, r) => a + r.I, 0) / res.length, TP = Math.max(...res.map(r => r.TP));
    out.innerHTML = `<span>المتكاملة <b class="${Math.abs(I + 14) <= 1 ? 'ok' : I > -13 ? 'hot' : ''}" dir="ltr">${I.toFixed(1)} LUFS</b></span><span>أعلى ذروة <b class="${TP > -1 ? 'hot' : ''}" dir="ltr">${TP.toFixed(1)} dBTP</b></span>`;
  }
  function fitMusic(cs, s) {
    const vEnd = Math.max(0, ...s.clips.filter(c => c.tt === 'v').map(c => c.start + c.dur)) || GW.seqDur(s); let n = 0;
    for (const c of cs) {
      const m = GW.media(c.media); const avail = m && m.dur ? (m.dur - c.in) / (c.speed || 1) : c.dur; const want = clamp(vEnd - c.start, .5, avail); if (want <= .2) continue;
      GW.ops.clear(s, c.tt, c.ti, c.start + c.dur, c.start + want, new Set([c.id])); c.dur = want;
      s.trans = s.trans.filter(x => !(x.tt === 'a' && x.a === c.id && !x.b)); s.trans.push({ id: GW.uid(), tt: 'a', ti: c.ti, a: c.id, b: null, kind: 'cpower', dur: Math.min(2, want / 3), align: 'center' }); n++;
    }
    if (!n) { GW.toast('لا يمكن الملاءمة'); return; }
    GW.commit('ملاءمة الموسيقى لطول التسلسل'); GW.toast('انتهت الموسيقى مع نهاية الفيديو، مع خفوت لمدة ثانيتين');
  }
  GW.bus.on('selection', () => { if (esEl && esEl.isConnected) renderES(); }); GW.bus.on('hist', () => { if (esEl && esEl.isConnected) renderES(); });
  GW.bus.on('panel-shown', (id) => { if (id === 'esound') renderES(); });

  /* ======================= Audio clip editor ======================= */
  const CE = { el: null, cv: null, mode: 'wave', zoom: 1, drag: null, spec: null, hover: null };
  GW.registerPanel('aclip', 'محرر المقطع الصوتي', (el) => {
    CE.el = el; el.innerHTML = `<div class="ptool ce-tool" dir="rtl"><span class="ce-name" data-a="name"></span><span class="grow"></span>
      <div class="seg ce-mode" data-a="mode"><button data-m="wave" class="on">${GW.ico('wave', 13)}<span>موجة</span></button><button data-m="spec">${GW.ico('scopes', 13)}<span>طيف</span></button></div>
      <span class="ce-zoom"><button class="tb" data-a="zo" title="تصغير الموجة">−</button><span data-a="zv" dir="ltr">×1</span><button class="tb" data-a="zi" title="تكبير الموجة">+</button></span>
      <button class="btn sm ghost" data-a="norm" title="ضبط الكسب لتصل الذروة إلى -1 dB">${GW.ico('meter', 13)}<span>تطبيع الذروة</span></button>
      <button class="btn sm ghost" data-a="reset" title="حذف مفاتيح الكسب والخفوت">${GW.ico('reset', 13)}<span>إعادة الضبط</span></button></div>
      <div class="ce-view" data-a="view"><canvas data-a="cv"></canvas><div class="ce-info" data-a="info"></div></div>
      <div class="ce-foot" data-a="foot">اسحب الخط الأصفر لتغيير الكسب · نقر مزدوج: مفتاح جديد · Alt+نقر على مفتاح: حذفه · اسحب المربعين في الأعلى للخفوت</div>`;
    const q = a => el.querySelector(`[data-a=${a}]`); CE.cv = q('cv'); CE.view = q('view'); CE.cv.title = q('foot').textContent;
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { CE.mode = b.dataset.m; el.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); drawCE(); });
    const zl = () => { q('zv').textContent = '×' + CE.zoom; drawCE(); };
    q('zi').onclick = () => { CE.zoom = Math.min(16, CE.zoom * 2); zl(); }; q('zo').onclick = () => { CE.zoom = Math.max(1, CE.zoom / 2); zl(); }; q('zv').onclick = () => { CE.zoom = 1; zl(); };
    q('norm').onclick = () => { const c = ceClip(); if (!c) return; const pk = peakOf(c); if (!pk) { GW.toast('الموجة لم تُحسب بعد'); return; } const db = 20 * Math.log10(pk); const g = clamp(-1 - db, -40, 24); c.vol = GW.P(Math.round(g * 10) / 10); GW.commit('تطبيع الذروة'); liveRestart(); };
    q('reset').onclick = () => { const c = ceClip(); if (!c) return; const s = GW.seq(); c.vol = GW.P(0); s.trans = s.trans.filter(x => !(x.tt === 'a' && ((x.a === c.id && !x.b) || (x.b === c.id && !x.a)))); GW.commit('إعادة ضبط كسب المقطع'); liveRestart(); };
    initCE(); new ResizeObserver(() => drawCE()).observe(CE.view);
  });
  function ceClip() { const cs = selAudio(); return cs[0] || null; }
  function peakOf(c) { const m = GW.media(c.media); const r = m && GW.rt.m[m.id]; const pk = r && r.peaks; if (!pk || !pk.length) return 0; const a = Math.floor(c.in * 100), b = Math.min(pk.length, Math.ceil((c.in + c.dur * (c.speed || 1)) * 100)); let mx = 0; for (let i = a; i < b; i++) if (pk[i] > mx) mx = pk[i]; return mx; }
  const fades = (s, c) => ({ fin: s.trans.find(x => x.tt === 'a' && x.b === c.id && !x.a), fout: s.trans.find(x => x.tt === 'a' && x.a === c.id && !x.b) });
  // geometry: x ↔ clip-local time, y ↔ dB on the envelope scale (+15 … -60, top 18% of the view reserved for nothing: full height)
  const G = { pad: 10, top: 22 };
  const DBMAX = 15, DBMIN = -60;
  const yOf = (db, H) => G.top + (1 - (clamp(db, DBMIN, DBMAX) - DBMIN) / (DBMAX - DBMIN)) * (H - G.top - 6);
  const dbOf = (y, H) => DBMIN + (1 - clamp((y - G.top) / (H - G.top - 6), 0, 1)) * (DBMAX - DBMIN);
  // envelope scale is not linear in dB around 0: use a soft curve so 0 dB sits at 40 % from the top
  const ENV = { y: (db, H) => { const u = db >= 0 ? .4 - db / DBMAX * .4 : .4 + Math.pow(-db / -DBMIN, .6) * .6; return G.top + u * (H - G.top - 6); }, db: (y, H) => { const u = clamp((y - G.top) / (H - G.top - 6), 0, 1); return u <= .4 ? (.4 - u) / .4 * DBMAX : -Math.pow((u - .4) / .6, 1 / .6) * -DBMIN; } };
  function drawCE() {
    const el = CE.el; if (!el || !el.isConnected) return; const cv = CE.cv; const W = CE.view.clientWidth, H = CE.view.clientHeight; if (W < 10 || H < 10) return;
    const dpr = Math.min(2, devicePixelRatio || 1); if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const c = ceClip(); const s = GW.seq(); const name = el.querySelector('[data-a=name]'); const foot = el.querySelector('[data-a=foot]'); const info = el.querySelector('[data-a=info]');
    el.classList.toggle('ce-empty', !c);
    if (!c) { name.textContent = ''; info.innerHTML = empty('wave', 'محرر المقطع الصوتي', 'حدد مقطعًا صوتيًا في الخط الزمني لعرض موجته الكبيرة، ورسم مغلّف الكسب وضبط الخفوت.'); return; }
    info.innerHTML = '';
    const m = GW.media(c.media); name.innerHTML = `${GW.ico('wave', 13)}<b>${esc(c.name || (m && m.name) || 'مقطع')}</b><span class="kv" dir="ltr">${GW.fmtTC(c.start, s.fps)} · ${c.dur.toFixed(2)}s</span>`;
    const x0 = G.pad, x1 = W - G.pad, tw = x1 - x0; const tx = (t) => x0 + t / c.dur * tw;
    // background + grid
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(x0, G.top, tw, H - G.top - 6);
    g.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--f-mono'); g.textBaseline = 'middle';
    // time ruler
    const step = [.1, .25, .5, 1, 2, 5, 10, 30, 60].find(st => tw / (c.dur / st) > 70) || 60;
    g.fillStyle = 'rgba(255,255,255,.4)'; g.strokeStyle = 'rgba(255,255,255,.07)'; g.textAlign = 'left';
    for (let t = 0; t <= c.dur + 1e-6; t += step) { const x = Math.round(tx(t)) + .5; g.beginPath(); g.moveTo(x, G.top); g.lineTo(x, H - 6); g.stroke(); g.fillText((step < 1 ? t.toFixed(2) : t.toFixed(0)) + 's', x + 3, 10); }
    const r = m && GW.rt.m[m.id]; const sp = c.speed || 1; const mid = G.top + (H - G.top - 6) / 2, amp = (H - G.top - 6) / 2 - 2;
    if (CE.mode === 'spec') drawSpec(g, c, r, x0, tw, G.top, H - G.top - 6);
    else {
      const pk = r && r.peaks;
      if (pk && pk.length) {
        const gain = dbg(GW.isAnim(c.vol) ? 0 : GW.pv(c.vol || GW.P(0), 0)) * CE.zoom; const top = [], bot = [];
        g.beginPath();
        for (let x = 0; x <= tw; x++) { const t0 = c.in + (x / tw) * c.dur * sp, t1 = c.in + ((x + 1) / tw) * c.dur * sp; let mx = 0; for (let i = Math.floor(t0 * 100); i < Math.max(Math.floor(t0 * 100) + 1, Math.ceil(t1 * 100)) && i < pk.length; i++) if (pk[i] > mx) mx = pk[i]; const lt = (x / tw) * c.dur; const env = GW.isAnim(c.vol) ? dbg(GW.pv(c.vol, lt)) : 1; top.push(Math.min(1, mx * gain * env)); }
        const grad = g.createLinearGradient(0, mid - amp, 0, mid + amp); grad.addColorStop(0, '#ff8d5c'); grad.addColorStop(.5, '#3fb8a8'); grad.addColorStop(1, '#ff8d5c');
        g.fillStyle = 'rgba(63,184,168,.85)';
        g.beginPath(); g.moveTo(x0, mid); top.forEach((v, i) => g.lineTo(x0 + i, mid - v * amp)); for (let i = top.length - 1; i >= 0; i--) g.lineTo(x0 + i, mid + top[i] * amp); g.closePath(); g.fill();
        g.fillStyle = 'rgba(239,83,80,.9)'; top.forEach((v, i) => { if (v >= .999) { g.fillRect(x0 + i, mid - amp, 1, 3); g.fillRect(x0 + i, mid + amp - 3, 1, 3); } });
        g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(x0, mid + .5); g.lineTo(x1, mid + .5); g.stroke();
      } else { g.fillStyle = 'rgba(255,255,255,.4)'; g.textAlign = 'center'; g.fillText(GW.tr('جارٍ تحليل الموجة…'), W / 2, H / 2); }
    }
    // fades (single-sided audio transitions)
    const { fin, fout } = fades(s, c); const fi = fin ? fin.dur : 0, fo = fout ? fout.dur : 0;
    g.fillStyle = 'rgba(0,0,0,.35)';
    if (fi > 0) { g.beginPath(); g.moveTo(x0, G.top); g.lineTo(tx(fi), G.top); g.lineTo(x0, H - 6); g.closePath(); g.fill(); }
    if (fo > 0) { g.beginPath(); g.moveTo(x1, G.top); g.lineTo(tx(c.dur - fo), G.top); g.lineTo(x1, H - 6); g.closePath(); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, H - 6); g.lineTo(tx(fi), G.top); g.moveTo(x1, H - 6); g.lineTo(tx(c.dur - fo), G.top); g.stroke();
    for (const [x, on] of [[tx(fi), fi > 0], [tx(c.dur - fo), fo > 0]]) { g.fillStyle = on ? '#e9ebef' : 'rgba(233,235,239,.55)'; g.fillRect(x - 5, G.top - 5, 10, 10); g.strokeStyle = '#0b0d10'; g.strokeRect(x - 5 + .5, G.top - 5 + .5, 9, 9); }
    // gain envelope
    const V = c.vol || GW.P(0); g.strokeStyle = '#e9c35a'; g.lineWidth = 2; g.beginPath();
    for (let x = 0; x <= tw; x += 2) { const lt = x / tw * c.dur; const y = ENV.y(GW.pv(V, lt), H); if (x) g.lineTo(x0 + x, y); else g.moveTo(x0, y); } g.stroke();
    g.fillStyle = 'rgba(233,195,90,.9)'; g.textAlign = 'right'; g.fillText('0 dB', W - 4, ENV.y(0, H) - 7);
    if (V.k) for (const k of V.k) { const x = tx(k.t), y = ENV.y(k.v, H); g.beginPath(); g.arc(x, y, CE.hover === k ? 6 : 4.5, 0, Math.PI * 2); g.fillStyle = '#e9c35a'; g.fill(); g.strokeStyle = '#0b0d10'; g.lineWidth = 1.5; g.stroke(); }
    // playhead
    if (s.t >= c.start && s.t <= c.start + c.dur) { const x = Math.round(tx(s.t - c.start)) + .5; g.strokeStyle = '#ff6a2b'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    // read-out
    const cur = GW.pv(V, clamp(s.t - c.start, 0, c.dur)); g.textAlign = 'left'; g.fillStyle = 'rgba(233,235,239,.85)';
    const lbl = `${cur >= 0 ? '+' : ''}${cur.toFixed(1)} dB${fi ? ` · ↗ ${fi.toFixed(2)}s` : ''}${fo ? ` · ↘ ${fo.toFixed(2)}s` : ''}${CE.drag && CE.drag.label ? ' · ' + CE.drag.label : ''}`; g.fillText(lbl, x0 + 4, H - 14);
    foot.hidden = false;
  }
  // spectrogram: 512-pt FFT columns over the clip's source range (decoded buffer), cached per clip/size
  function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } } for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2; const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
  function drawSpec(g, c, r, x0, tw, y0, h) {
    const ab = r && r.audio; if (!ab) { g.fillStyle = 'rgba(255,255,255,.4)'; g.textAlign = 'center'; g.fillText(GW.tr('جارٍ تحميل الصوت…'), x0 + tw / 2, y0 + h / 2); return; }
    const cols = Math.min(900, Math.floor(tw)), rows = Math.max(32, Math.min(256, Math.floor(h)));
    const key = [c.id, c.in, c.dur, cols, rows, ab.length].join('|');
    if (!CE.spec || CE.spec.key !== key) {
      const N = 512, sr = ab.sampleRate, d = ab.getChannelData(0), img = new ImageData(cols, rows); const re = new Float32Array(N), im = new Float32Array(N); const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (N - 1));
      const sp = c.speed || 1, fmax = Math.log(sr / 2), fmin = Math.log(40);
      for (let x = 0; x < cols; x++) {
        const t = c.in + (x + .5) / cols * c.dur * sp; const s0 = Math.floor(t * sr) - N / 2; for (let i = 0; i < N; i++) { const k = s0 + i; re[i] = (k >= 0 && k < d.length ? d[k] : 0) * win[i]; im[i] = 0; } fft(re, im);
        for (let y = 0; y < rows; y++) { const f = Math.exp(fmin + (1 - (y + .5) / rows) * (fmax - fmin)); const bin = Math.min(N / 2 - 1, Math.max(1, Math.round(f / sr * N))); const mag = Math.hypot(re[bin], im[bin]) / (N / 4); const db = 20 * Math.log10(mag + 1e-9); const v = clamp((db + 90) / 80, 0, 1);
          const o = (y * cols + x) * 4; const R = clamp(v * 3 - 1, 0, 1), Gc = clamp(v * 3 - 1.6, 0, 1) * .9 + clamp(v * 2 - 1.2, 0, 1) * .1, B = clamp(v * 2, 0, 1) * (1 - clamp(v * 2 - 1, 0, 1)) * .8 + clamp(v - .85, 0, 1) * 2;
          img.data[o] = 255 * clamp(R * 1.05, 0, 1); img.data[o + 1] = 255 * clamp(Gc + v * .25, 0, 1); img.data[o + 2] = 255 * clamp(B + v * .25, 0, 1); img.data[o + 3] = 255; }
      }
      const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows; cv.getContext('2d').putImageData(img, 0, 0); CE.spec = { key, cv };
    }
    g.imageSmoothingEnabled = true; g.drawImage(CE.spec.cv, x0, y0, tw, h);
    g.fillStyle = 'rgba(255,255,255,.5)'; g.textAlign = 'left'; const sr = ab.sampleRate, fmax = Math.log(sr / 2), fmin = Math.log(40);
    for (const f of [100, 1000, 5000, 10000]) { const y = y0 + (1 - (Math.log(f) - fmin) / (fmax - fmin)) * h; g.fillRect(x0, y, 6, 1); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, x0 + 8, y); }
  }
  function initCE() {
    const cv = CE.cv;
    const loc = (e) => { const r = cv.getBoundingClientRect(); const c = ceClip(); const W = r.width, H = r.height; const x0 = G.pad, tw = W - 2 * G.pad; const x = e.clientX - r.left, y = e.clientY - r.top; return { c, x, y, W, H, t: c ? clamp((x - x0) / tw * c.dur, 0, c.dur) : 0, tx: (t) => x0 + t / c.dur * tw }; };
    const hit = (L) => {
      const { c, x, y, H, tx } = L; if (!c) return null; const s = GW.seq(); const { fin, fout } = fades(s, c);
      if (Math.abs(y - G.top) < 9) { if (Math.abs(x - tx(fin ? fin.dur : 0)) < 9) return { k: 'fin' }; if (Math.abs(x - tx(c.dur - (fout ? fout.dur : 0))) < 9) return { k: 'fout' }; }
      const V = c.vol || GW.P(0); if (V.k) for (const k of V.k) if (Math.hypot(tx(k.t) - x, ENV.y(k.v, H) - y) < 8) return { k: 'key', key: k };
      if (Math.abs(ENV.y(GW.pv(V, L.t), H) - y) < 7) return { k: 'line' };
      return null;
    };
    cv.onpointermove = (e) => {
      const L = loc(e); if (!CE.drag) { const h = hit(L); cv.style.cursor = !h ? 'text' : h.k === 'line' ? 'ns-resize' : h.k === 'key' ? 'move' : 'ew-resize'; const hv = h && h.key; if (hv !== CE.hover) { CE.hover = hv; drawCE(); } return; }
      const D = CE.drag, c = L.c; if (!c) return; const s = GW.seq(); D.moved = true;
      if (D.k === 'line') { const db = Math.round(clamp(ENV.db(L.y, L.H), DBMIN, DBMAX) * 10) / 10; if (!GW.isAnim(c.vol)) c.vol = GW.P(db); else c.vol.k.forEach((k, i) => { k.v = Math.round(clamp(D.base[i] + (db - D.v0), DBMIN, DBMAX) * 10) / 10; }); D.label = (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB'; }
      else if (D.k === 'key') { const k = D.key; k.v = Math.round(clamp(ENV.db(L.y, L.H), DBMIN, DBMAX) * 10) / 10; const ks = c.vol.k; const i = ks.indexOf(k); const lo = i > 0 ? ks[i - 1].t + 1 / s.fps : 0, hi = i < ks.length - 1 ? ks[i + 1].t - 1 / s.fps : c.dur; k.t = GW.snapFrame(clamp(L.t, lo, hi), s.fps); D.label = k.v.toFixed(1) + ' dB'; }
      else if (D.k === 'fin' || D.k === 'fout') { const { fin, fout } = fades(s, c); const other = D.k === 'fin' ? (fout ? fout.dur : 0) : (fin ? fin.dur : 0); let d = D.k === 'fin' ? L.t : c.dur - L.t; d = clamp(GW.snapFrame(d, s.fps), 0, c.dur - other - 1 / s.fps); let tr = D.k === 'fin' ? fin : fout; if (d < 1 / s.fps) { if (tr) s.trans = s.trans.filter(x => x !== tr); } else { if (!tr) { tr = { id: GW.uid(), tt: 'a', ti: c.ti, a: D.k === 'fout' ? c.id : null, b: D.k === 'fin' ? c.id : null, kind: 'cpower', dur: d, align: 'center' }; s.trans.push(tr); } tr.dur = d; } D.label = GW.tr(D.k === 'fin' ? 'ظهور' : 'اختفاء') + ' ' + d.toFixed(2) + 's'; GW.TL && GW.TL.invalidate && GW.TL.invalidate(); }
      GW.invalidate(); drawCE();
    };
    cv.onpointerdown = (e) => {
      if (e.button !== 0) return; const L = loc(e); const c = L.c; if (!c) return; const h = hit(L);
      if (!h) { GW.seek(c.start + L.t); return; }
      if (h.k === 'key' && e.altKey) { c.vol.k = c.vol.k.filter(k => k !== h.key); if (!c.vol.k.length) c.vol = GW.P(h.key.v); GW.commit('حذف مفتاح كسب'); drawCE(); liveRestart(); return; }
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      CE.drag = Object.assign({ t: L.t, v0: GW.pv(c.vol || GW.P(0), L.t), base: GW.isAnim(c.vol) ? c.vol.k.map(k => k.v) : null }, h);
    };
    cv.onpointerup = cv.onpointercancel = () => { const D = CE.drag; CE.drag = null; if (D && D.moved) { GW.commit(D.k === 'fin' ? 'خفوت الظهور' : D.k === 'fout' ? 'خفوت الاختفاء' : 'مغلّف الكسب'); liveRestart(); } drawCE(); };
    cv.ondblclick = (e) => { const L = loc(e); const c = L.c; if (!c) return; const s = GW.seq(); const t = GW.snapFrame(L.t, s.fps); const db = Math.round(clamp(ENV.db(L.y, L.H), DBMIN, DBMAX) * 10) / 10; const V = c.vol || GW.P(0); if (!GW.isAnim(V)) { const v0 = V.v || 0; c.vol = { v: v0, k: [{ t, v: db, e: 'linear' }] }; if (t > .05) c.vol.k.unshift({ t: 0, v: v0, e: 'linear' }); if (t < c.dur - .05) c.vol.k.push({ t: c.dur, v: v0, e: 'linear' }); } else { V.k.push({ t, v: db, e: 'linear' }); V.k.sort((a, b) => a.t - b.t); } GW.commit('مفتاح كسب'); drawCE(); liveRestart(); };
  }
  let ceLast = 0; ['selection', 'hist', 'time', 'media', 'param'].forEach(ev => GW.bus.on(ev, () => { if (!CE.el || !CE.el.isConnected || CE.drag) return; const now = performance.now(); if (ev === 'time' && GW.pb.playing && now - ceLast < 80) return; ceLast = now; drawCE(); }));
  GW.bus.on('panel-shown', (id) => { if (id === 'aclip') requestAnimationFrame(drawCE); });
  GW.bus.on('layout', () => { if (CE.el && CE.el.isConnected) requestAnimationFrame(drawCE); });

  /* ======================= Loudness / peak meters ======================= */
  const MT = { el: null, target: -14, hold: [[-90, 0], [-90, 0]], idle: 0 };
  try { MT.target = +(localStorage.getItem('qq.lufsTarget') || -14); } catch (e) {}
  GW.registerPanel('meters', 'عدادات الصوت', (el) => {
    MT.el = el; el.innerHTML = `<div class="mt6"><div class="mt-big"><span class="mt-lbl">LUFS قصير</span><b data-k="s">—</b><span class="mt-sub" data-k="tgt"></span></div>
      <div class="mt-rows"><span>M</span><b data-k="m">—</b><span>I</span><b data-k="i">—</b><span>TP</span><b data-k="tp">—</b></div>
      <div class="mt-bars"><div class="mt-scale">${[0, -6, -12, -18, -24, -36, -48].map(v => `<span style="top:${(-v / 60 * 100).toFixed(1)}%">${v}</span>`).join('')}</div><canvas data-k="cv"></canvas></div>
      <div class="mt-foot"><select class="sel" data-k="target" title="هدف الجهارة">${[[-14, 'يوتيوب -14'], [-16, 'بودكاست -16'], [-23, 'EBU -23'], [-11, 'ريلز -11']].map(([v, n]) => `<option value="${v}" ${v === MT.target ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="tb" data-k="reset" title="إعادة ضبط القياس">${GW.ico('reset', 13)}</button></div></div>`;
    const q = k => el.querySelector(`[data-k=${k}]`);
    q('target').onchange = (e) => { MT.target = +e.target.value; try { localStorage.setItem('qq.lufsTarget', MT.target); } catch (er) {} MT.idle = 0; };
    q('reset').onclick = () => { if (AF() && AF().resetMeter) AF().resetMeter(); MT.idle = 0; };
  });
  const fmtL = (v) => (v == null || !isFinite(v) || v < -99) ? '—' : v.toFixed(1);
  GW.bus.on('tick', () => {
    const el = MT.el; if (!el || !el.isConnected) return; const A = GW.Audio; const on = A.playing;
    if (!on) { if (MT.idle > 2) return; MT.idle++; } else MT.idle = 0;
    const q = k => el.querySelector(`[data-k=${k}]`); const M = AF() && AF().meter;
    const r = M ? { m: M.momentary, s: M.shortTerm, i: M.integrated, tp: M.tpHold > 0 ? 20 * Math.log10(M.tpHold) : -Infinity } : {};
    const put = (k, v, cls) => { const e = q(k); const t = fmtL(v); if (e.textContent !== t) e.textContent = t; e.className = cls || ''; };
    const near = (v) => isFinite(v) && v > -99 ? (Math.abs(v - MT.target) <= 1 ? 'ok' : v > MT.target + 1 ? 'hot' : 'low') : '';
    put('s', r.s, near(r.s)); put('m', r.m); put('i', r.i, near(r.i)); put('tp', r.tp, isFinite(r.tp) && r.tp > -1 ? 'hot' : '');
    q('tgt').textContent = 'الهدف ' + MT.target + ' LUFS';
    const cv = q('cv'); const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return; if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.fillStyle = '#07080a'; g.fillRect(0, 0, W, H); const [l, rr] = on ? A.levels() : [0, 0]; const now = performance.now(); const bw = Math.floor((W - 6) / 2);
    [l, rr].forEach((v, i) => { const db = 20 * Math.log10(Math.max(v, 1e-6)); const y = (d) => clamp(-d / 60, 0, 1) * H; const x = 2 + i * (bw + 2);
      if (db > -60) { const gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, '#2fae6a'); gr.addColorStop(.7, '#4cc38a'); gr.addColorStop(.8, '#e9c35a'); gr.addColorStop(.97, '#ef5350'); g.fillStyle = gr; g.fillRect(x, y(db), bw, H - y(db)); }
      const hd = MT.hold[i]; if (db > hd[0] || now - hd[1] > 2000) MT.hold[i] = [db, now]; if (MT.hold[i][0] > -60) { g.fillStyle = MT.hold[i][0] > -1 ? '#ef5350' : '#fff'; g.fillRect(x, y(MT.hold[i][0]), bw, 2); } });
    g.fillStyle = 'rgba(255,255,255,.07)'; for (const d of [-6, -12, -18, -24, -36, -48]) g.fillRect(0, Math.round(-d / 60 * H), W, 1);
    // target band (short-term loudness marker, LUFS ≈ dBFS scale for orientation)
    if (isFinite(r.s) && r.s > -60) { g.fillStyle = 'rgba(76,194,255,.9)'; g.fillRect(0, Math.round(-r.s / 60 * H), W, 2); }
  });

  /* ======================= Voice-over ======================= */
  let voEl = null;
  GW.registerPanel('vo', 'التعليق الصوتي', (el) => { voEl = el; renderVO(); });
  function renderVO() {
    if (!voEl) return; const VO = GW.VO; const s = GW.seq();
    if (!VO) { voEl.innerHTML = empty('mic', 'التسجيل غير متاح', ''); return; }
    const tgt = (GW.TL && GW.TL.target && GW.TL.target.a) || 0; const rec = !!VO.rec;
    voEl.innerHTML = `<div class="vo6"><div class="vo-hero ${rec ? 'rec' : ''}"><button class="vo-rec" data-a="rec" title="${rec ? 'إيقاف التسجيل' : 'بدء التسجيل عند مؤشر التشغيل'}">${rec ? '<i class="sq"></i>' : '<i class="dot"></i>'}</button>
      <div class="vo-txt"><b>${rec ? 'جارٍ التسجيل…' : 'تسجيل تعليق صوتي'}</b><span>${rec ? 'اضغط للإيقاف — يُضاف المقطع إلى المسار تلقائيًا' : 'يبدأ من مؤشر التشغيل على المسار المحدد'}</span></div></div>
      <div class="form"><div class="frow"><label>المسار</label><div class="ctl"><select class="sel" data-a="tr">${s.at.map((t, i) => `<option value="${i}" ${i === tgt ? 'selected' : ''}>${esc(t.name || 'A' + (i + 1))}</option>`).join('')}</select></div></div>
      <div class="frow"><label>الميكروفون</label><div class="ctl"><span class="mute" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((VO.cfg && VO.cfg.deviceLabel) || 'الافتراضي')}</span><button class="btn sm" data-a="set">${GW.ico('settings', 12)}<span>الإعدادات</span></button></div></div></div>
      <div class="vo-tips">${GW.ico('sparkle', 12)}<span>بعد التسجيل: صنّف المقطع «حوار» في «الصوت الأساسي» لتنقيته وتوحيد جهارته بنقرة.</span></div></div>`;
    const q = a => voEl.querySelector(`[data-a=${a}]`);
    q('rec').onclick = run(async () => { if (VO.rec) await VO.stop(); else await VO.start(+q('tr').value); renderVO(); });
    q('tr').onchange = () => { if (GW.TL && GW.TL.target) { GW.TL.target.a = +q('tr').value; GW.TL.renderHeads && GW.TL.renderHeads(); } };
    q('set').onclick = () => VO.settings().then(() => renderVO());
  }
  GW.bus.on('panel-shown', (id) => { if (id === 'vo') renderVO(); }); GW.bus.on('project', () => { if (voEl && voEl.isConnected) renderVO(); });
  setInterval(() => { if (voEl && voEl.isConnected && !!(GW.VO && GW.VO.rec) !== voEl.querySelector('.vo-hero').classList.contains('rec')) renderVO(); }, 400);

  /* ======================= Colour: clip strip + grade clipboard + A|B compare ======================= */
  const CS = { el: null, grade: null };
  const isPic = (c) => c.tt === 'v' && ['video', 'image', 'nest', 'adjust'].includes(c.kind);
  const gradeFx = (c) => (c.fx || []).filter(f => GW.FX[f.type] && GW.FX[f.type].cat === 'تصحيح الألوان' || f.type === 'vignette' || f.type === 'lut');
  GW.registerPanel('cstrip', 'لقطات التسلسل', (el) => {
    CS.el = el; el.innerHTML = `<div class="cs6"><div class="cs-tools" dir="rtl">
      <button class="btn sm ghost" data-a="copy" title="نسخ تصحيح الألوان من اللقطة المحددة">${GW.ico('copy', 13)}<span>نسخ التصحيح</span></button>
      <button class="btn sm ghost" data-a="paste" title="لصق التصحيح على اللقطة المحددة">${GW.ico('import', 13)}<span>لصق</span></button>
      <button class="btn sm ghost" data-a="pasteAll" title="لصق التصحيح على كل اللقطات">${GW.ico('layers', 13)}<span>لصق على الكل</span></button>
      <span class="sep"></span>
      <button class="btn sm ghost" data-a="ref" title="التقاط الإطار الحالي كمرجع ومقارنته (A|B)">${GW.ico('split', 13)}<span>مقارنة A|B</span></button></div><div class="cs-row" data-a="row"></div></div>`;
    const q = a => el.querySelector(`[data-a=${a}]`);
    q('copy').onclick = () => { const c = selClips().find(isPic); if (!c) { GW.toast('حدد لقطة أولًا'); return; } CS.grade = GW.clone(gradeFx(c)); CS.from = c.name; GW.toast(CS.grade.length ? 'نُسخ التصحيح: ' + CS.grade.length + ' تأثير' : 'اللقطة بدون تصحيح ألوان'); renderCS(); };
    q('paste').onclick = () => pasteGrade(selClips().filter(isPic));
    q('pasteAll').onclick = () => pasteGrade(GW.seq().clips.filter(isPic));
    q('ref').onclick = () => Compare.toggle();
    renderCS();
  });
  function pasteGrade(targets) {
    if (!CS.grade) { GW.toast('انسخ تصحيحًا أولًا'); return; } if (!targets.length) { GW.toast('حدد لقطة'); return; }
    const types = new Set(CS.grade.map(f => f.type));
    for (const c of targets) { c.fx = (c.fx || []).filter(f => !types.has(f.type) && !gradeFx(c).includes(f)); c.fx.unshift(...GW.clone(CS.grade).map(f => ({ ...f, id: GW.uid() }))); }
    GW.commit('لصق تصحيح الألوان (' + targets.length + ')'); GW.invalidate(); renderCS();
  }
  function thumbOf(c) { const m = GW.media(c.media); const r = m && GW.rt.m[m.id]; return r && r.poster; }
  function renderCS() {
    const el = CS.el; if (!el) return; const row = el.querySelector('[data-a=row]'); const s = GW.seq(); const sl = row.scrollLeft;
    const cs = s.clips.filter(isPic).sort((a, b) => a.start - b.start || b.ti - a.ti); row.innerHTML = '';
    el.querySelector('[data-a=paste]').disabled = el.querySelector('[data-a=pasteAll]').disabled = !CS.grade;
    el.querySelector('[data-a=ref]').classList.toggle('on', Compare.on);
    if (!cs.length) { row.innerHTML = '<div class="cs-empty">' + GW.ico('image', 16) + '<span>لا توجد لقطات بعد — أضف فيديو إلى الخط الزمني لتظهر هنا للانتقال والمقارنة ونسخ التصحيح.</span></div>'; return; }
    const cur = cs.find(c => s.t >= c.start && s.t < c.start + c.dur && GW.sel.clips.has(c.id)) || cs.find(c => GW.sel.clips.has(c.id));
    cs.forEach((c, i) => {
      const d = document.createElement('div'); d.className = 'cs-card' + (c === cur ? ' on' : '') + (s.t >= c.start && s.t < c.start + c.dur ? ' ph' : ''); d.title = (c.name || '') + ' — ' + GW.fmtTC(c.start, s.fps);
      const g = gradeFx(c); const th = document.createElement('div'); th.className = 'cs-th';
      const p = thumbOf(c); if (p) { const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90; try { const k = Math.max(160 / (p.width || p.naturalWidth || 160), 90 / (p.height || p.naturalHeight || 90)); const w = (p.width || p.naturalWidth) * k, h = (p.height || p.naturalHeight) * k; cv.getContext('2d').drawImage(p, (160 - w) / 2, (90 - h) / 2, w, h); } catch (e) {} th.append(cv); }
      else th.innerHTML = GW.ico(c.kind === 'adjust' ? 'layers' : 'film', 18);
      d.append(th);
      d.insertAdjacentHTML('beforeend', `<div class="cs-meta"><span class="cs-n">${i + 1}</span><span class="cs-name">${esc(c.name || '')}</span>${g.length ? `<span class="cs-g" title="${esc(g.map(f => GW.FX[f.type] ? GW.FX[f.type].n : f.type).join('، '))}">${GW.ico('color', 11)}</span>` : ''}</div><span class="cs-tc" dir="ltr">V${c.ti + 1} · ${GW.fmtTC(c.start, s.fps)}</span>`);
      d.onclick = () => { GW.sel.clips.clear(); GW.sel.clips.add(c.id); GW.bus.emit('selection'); GW.seek(c.start + Math.min(c.dur / 2, 1)); };
      d.oncontextmenu = (e) => { e.preventDefault(); GW.menu(e.clientX, e.clientY, [{ label: 'نسخ التصحيح', action: () => { CS.grade = GW.clone(gradeFx(c)); renderCS(); } }, { label: 'لصق التصحيح هنا', disabled: !CS.grade, action: () => pasteGrade([c]) }, { label: 'إزالة التصحيح', disabled: !g.length, action: () => { c.fx = c.fx.filter(f => !g.includes(f)); GW.commit('إزالة تصحيح الألوان'); renderCS(); } }, '-', { label: 'اعتبار هذا الإطار مرجعًا (A|B)', action: () => { GW.seek(c.start + Math.min(c.dur / 2, 1)); requestAnimationFrame(() => Compare.capture(true)); } }]); };
      row.append(d);
    });
    row.scrollLeft = sl; const on = row.querySelector('.cs-card.on'); if (on && (on.offsetLeft < row.scrollLeft || on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth)) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  const csSoon = GW.debounce(() => { if (CS.el && CS.el.isConnected) renderCS(); }, 120);
  ['selection', 'hist', 'project', 'media'].forEach(ev => GW.bus.on(ev, csSoon));
  let lastCsT = -1; GW.bus.on('time', () => { if (!CS.el || !CS.el.isConnected || GW.pb.playing) return; const t = GW.seq().t; if (Math.abs(t - lastCsT) > .2) { lastCsT = t; csSoon(); } });
  GW.bus.on('panel-shown', (id) => { if (id === 'cstrip') renderCS(); });

  // A|B wipe: reference still (A) left of the divider, live program (B) right; drag the divider; Esc-free toggle from the strip / Program chip
  const Compare = GW.Compare = { on: false, x: .5, ref: null, refT: null };
  Compare.capture = (enable) => {
    const s = GW.seq(); if (!GW.R || !GW.R.gl) return false;
    try { const k = Math.min(1, 1280 / s.w); const acc = GW.Render.frame(s, s.t, { scale: k, exporting: false }); const w = acc.w, h = acc.h; const buf = GW.R.readRGBA(w, h, acc, null, true); GW.R.free(acc); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, w * h * 4), w, h), 0, 0); Compare.ref = c; Compare.refT = s.t; }
    catch (e) { console.error(e); GW.toast('تعذر التقاط الإطار المرجعي', 'err'); return false; }
    if (enable) Compare.on = true; GW.invalidate(); renderCS(); GW.toast('المرجع A: ' + GW.fmtTC(s.t, s.fps) + ' — انتقل إلى لقطة أخرى للمقارنة'); return true;
  };
  Compare.toggle = () => { if (Compare.on) { Compare.on = false; GW.invalidate(); renderCS(); drawCompare(); return; } if (!Compare.ref) Compare.capture(true); else { Compare.on = true; GW.invalidate(); renderCS(); } };
  function cmpEls() {
    const P = GW.Program; if (!P || !P.view) return null; let ov = P.view.querySelector('.cmp-ov');
    if (!ov) {
      ov = document.createElement('canvas'); ov.className = 'cmp-ov'; P.view.append(ov);
      const h = document.createElement('div'); h.className = 'cmp-h'; h.innerHTML = '<i></i><span class="cmp-a">A</span><span class="cmp-b">B</span>'; P.view.append(h);
      const chip = document.createElement('div'); chip.className = 'cmp-chip'; chip.innerHTML = `${GW.ico('split', 12)}<span>مقارنة A|B</span><button class="cmp-new" title="التقاط مرجع جديد من الإطار الحالي">${GW.ico('camera', 12)}</button><button class="cmp-x" title="إغلاق المقارنة">${GW.ico('close', 12)}</button>`; P.view.append(chip);
      chip.querySelector('.cmp-x').onclick = () => Compare.toggle(); chip.querySelector('.cmp-new').onclick = () => { Compare.on = false; drawCompare(); requestAnimationFrame(() => { GW.Program.draw(); Compare.capture(true); }); };
      h.onpointerdown = (e) => { e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId); const mv = (ev) => { const b = GW.Program.box; const r = P.view.getBoundingClientRect(); Compare.x = clamp((ev.clientX - r.left - b.x) / b.w, 0, 1); drawCompare(); }; h.onpointermove = mv; h.onpointerup = () => { h.onpointermove = null; }; };
    }
    return { ov, h: P.view.querySelector('.cmp-h'), chip: P.view.querySelector('.cmp-chip') };
  }
  function drawCompare() {
    const E = cmpEls(); if (!E) return; const on = Compare.on && Compare.ref; E.ov.hidden = E.h.hidden = E.chip.hidden = !on; if (!on) return;
    const P = GW.Program, b = P.box; if (!b) return; const W = P.view.clientWidth, H = P.view.clientHeight; const dpr = Math.min(2, devicePixelRatio || 1);
    if (E.ov.width !== Math.round(W * dpr) || E.ov.height !== Math.round(H * dpr)) { E.ov.width = Math.round(W * dpr); E.ov.height = Math.round(H * dpr); E.ov.style.width = W + 'px'; E.ov.style.height = H + 'px'; }
    const g = E.ov.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const xw = b.w * Compare.x; g.save(); g.beginPath(); g.rect(b.x, b.y, xw, b.h); g.clip(); g.drawImage(Compare.ref, b.x, b.y, b.w, b.h); g.restore();
    E.h.style.left = (b.x + xw) + 'px'; E.h.style.top = b.y + 'px'; E.h.style.height = b.h + 'px';
  }
  GW.bus.on('tick', () => { if (GW.Program && GW.Program.view && (Compare.on || GW.Program.view.querySelector('.cmp-ov:not([hidden])'))) drawCompare(); });

  /* ======================= Deliver (review / export page) ======================= */
  let dvEl = null; let dvRange = 'all';
  GW.registerPanel('deliver', 'التسليم', (el) => { dvEl = el; el.innerHTML = '<div class="pscroll dv6" data-a="b"></div>'; renderDV(); });
  const presetIco = (p) => p.frame ? 'image' : /^(wav|mp3)$/.test(p.f && p.f.fmt) ? 'music' : p.aspect && p.aspect < 1 ? 'film' : 'export';
  function renderDV() {
    if (!dvEl) return; const b = dvEl.querySelector('[data-a=b]'); const P = UI.ExportPresets, Q = UI.exportQueue; const s = GW.seq();
    if (!P || !Q) { b.innerHTML = empty('export', 'التصدير غير متاح', ''); return; }
    const st = UI.lastExportStats; const running = Q.running; const cur = Q.items.find(x => x.status === 'run');
    const waiting = Q.items.filter(x => x.status === 'wait').length, done = Q.items.filter(x => x.status === 'done').length, bad = Q.items.filter(x => x.status === 'err').length;
    const hasIO = s.inP != null || s.outP != null;
    b.innerHTML = `<div class="dv-status ${running ? 'run' : ''}"><div class="dv-st-ico">${GW.ico(running ? 'export' : done && !waiting ? 'check' : 'film', 18)}</div><div class="dv-st-t"><b>${running ? 'جارٍ العرض والتصدير' : waiting ? waiting + ' في قائمة الانتظار' : done ? 'اكتمل التصدير' : 'جاهز للتسليم'}</b>
        <span>${esc(s.name)} · ${s.w}×${s.h} · ${s.fps} إطار · ${GW.fmtTC(GW.seqDur(s), s.fps)}${st && st.secs ? ' · آخر تصدير ' + st.secs.toFixed(1) + 'ث' : ''}</span>
        ${cur ? `<div class="prog"><i style="width:${(cur.progress * 100).toFixed(1)}%"></i></div><span class="dv-cur">${esc(cur.name)} — <span dir="ltr">${Math.round(cur.progress * 100)}%</span></span>` : ''}</div></div>
      <div class="dv-sec"><div class="dv-h"><b>إعدادات التسليم</b><div class="seg dv-rng"><button data-r="all" class="${dvRange === 'all' ? 'on' : ''}">كامل التسلسل</button><button data-r="io" class="${dvRange === 'io' ? 'on' : ''}" ${hasIO ? '' : 'disabled title="حدد نقطتي الدخول والخروج (I و O)"'}>الدخول ← الخروج</button></div></div>
      <div class="dv-grid">${P.all().map(p => `<button class="dv-card" data-p="${esc(p.id)}" title="${esc(p.name)} — انقر للإضافة إلى قائمة التصدير">${GW.ico(presetIco(p), 16)}<span>${esc(p.name)}</span>${P.warn(s, p) ? `<i class="dv-warn" title="${esc(P.warn(s, p))}">!</i>` : ''}</button>`).join('')}</div>
      <button class="btn dv-custom" data-a="custom">${GW.ico('settings', 13)}<span>تصدير مخصص…</span></button></div>
      <div class="dv-sec"><div class="dv-h"><b>قائمة التصدير</b><span class="kv">${Q.items.length}</span><span class="grow"></span><button class="btn sm ghost" data-a="clear" ${done || bad ? '' : 'disabled'}>مسح المكتمل</button><button class="btn sm ${running ? '' : 'pri'}" data-a="run" ${running || waiting || bad ? '' : 'disabled'}>${GW.ico(running ? 'stop' : 'play', 12)}<span>${running ? 'إيقاف' : 'تشغيل القائمة'}</span></button></div>
      <div class="dv-list" data-a="list"></div></div>`;
    const L = b.querySelector('[data-a=list]');
    if (!Q.items.length) L.innerHTML = '<div class="dv-empty">' + GW.ico('export', 18) + '<span>القائمة فارغة — اختر إعدادًا مسبقًا أعلاه لإضافته، ثم شغّل القائمة لتصدير كل الملفات دفعة واحدة.</span></div>';
    const ST = { wait: 'في الانتظار', run: 'جارٍ', done: 'تم', err: 'فشل', cancel: 'أُلغي' };
    for (const it of Q.items) {
      const r = document.createElement('div'); r.className = 'dv-item ' + it.status;
      r.innerHTML = `<div class="dv-i-t"><b>${esc(it.name)}</b><span dir="ltr">${esc(it.o.out.split(/[\\/]/).pop())}</span>${it.error ? `<span class="err" title="${esc(it.error)}">${esc(String(it.error).slice(-90))}</span>` : ''}</div><div class="dv-i-p"><div class="prog"><i style="width:${(it.progress * 100).toFixed(1)}%"></i></div><span>${ST[it.status] || ''}${it.status === 'run' ? ' <span dir="ltr">' + Math.round(it.progress * 100) + '%</span>' : ''}</span></div><button class="ib" title="${it.status === 'done' ? 'إظهار الملف' : 'إزالة'}">${GW.ico(it.status === 'done' ? 'folder' : 'close', 13)}</button>`;
      r.querySelector('.ib').onclick = () => { if (it.status === 'done') { window.gws && gws.showItem(it.result || it.o.out); return; } if (it.status === 'run') return; Q.items = Q.items.filter(x => x !== it); Q.emit(); };
      L.append(r);
    }
    b.querySelectorAll('[data-r]').forEach(x => x.onclick = () => { dvRange = x.dataset.r; renderDV(); });
    b.querySelectorAll('[data-p]').forEach(x => x.onclick = run(async () => { const p = P.get(x.dataset.p); if (!p) return; if (!window.gws) { GW.toast('التصدير متاح في نسخة سطح المكتب', 'err'); return; } Q.add(await Q.fromPreset(p, GW.seq(), { range: dvRange })); GW.toast('أُضيف إلى قائمة التصدير: ' + p.name); }));
    b.querySelector('[data-a=custom]').onclick = () => GW.cmd.exportMedia();
    b.querySelector('[data-a=clear]').onclick = () => { Q.items = Q.items.filter(x => x.status === 'wait' || x.status === 'run'); Q.emit(); };
    b.querySelector('[data-a=run]').onclick = () => { if (Q.running) { Q.cancel = true; return; } Q.items.forEach(x => { if (x.status === 'err' || x.status === 'cancel') { x.status = 'wait'; x.progress = 0; x.error = null; } }); Q.run(); };
  }
  const dvSoon = GW.debounce(() => { if (dvEl && dvEl.isConnected) renderDV(); }, 80);
  ['export-queue', 'project', 'hist'].forEach(ev => GW.bus.on(ev, dvSoon)); GW.bus.on('panel-shown', (id) => { if (id === 'deliver') renderDV(); });

  /* ======================= Graphics tool strip in Program ======================= */
  function gtools() {
    const P = GW.Program; if (!P || !P.view || P.view.querySelector('.pg-gtools')) return;
    const d = document.createElement('div'); d.className = 'pg-gtools'; d.dir = 'rtl';
    const B = [['text', 'نص جديد (Ctrl+T)', () => GW.cmd.newText()], ['shapes', 'مستطيل', () => GW.UI.addShapeLayer ? GW.UI.addShapeLayer('rect') : GW.cmd.newShape('rect')], ['shape_ellipse', 'دائرة', () => GW.UI.addShapeLayer ? GW.UI.addShapeLayer('ellipse') : GW.cmd.newShape('ellipse')], ['pen', 'أداة القلم (P)', () => GW.cmd.tool('pen')], '|',
      ['alignh', 'توسيط أفقي', () => align('h')], ['alignv', 'توسيط عمودي', () => align('v')], '|', ['safe', 'هوامش الأمان للعناوين والحركة', () => { GW.Program.toggleSafe(); sync(); }]];
    for (const it of B) {
      if (it === '|') { const s = document.createElement('span'); s.className = 'sep'; d.append(s); continue; }
      const b = document.createElement('button'); b.className = 'tb'; b.dataset.k = it[0]; b.title = it[1];
      b.innerHTML = it[0] === 'alignh' ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M12 3v18"/><rect x="6" y="6.5" width="12" height="4" rx="1"/><rect x="8" y="13.5" width="8" height="4" rx="1"/></svg>' : it[0] === 'alignv' ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 12h18"/><rect x="6.5" y="6" width="4" height="12" rx="1"/><rect x="13.5" y="8" width="4" height="8" rx="1"/></svg>' : GW.ico(it[0], 15);
      b.onclick = it[2]; d.append(b);
    }
    P.view.append(d); const sync = () => { const sb = d.querySelector('[data-k=safe]'); sb.classList.toggle('on', !!GW.Program.safe); const pb = document.querySelector('[data-panel=program] [data-a=safe]'); if (pb) pb.classList.toggle('on', !!GW.Program.safe); }; sync(); GW.bus.on('workspace', sync);
  }
  function align(ax) {
    const s = GW.seq(); const cs = selClips().filter(c => c.tt === 'v' && c.motion); if (!cs.length) { GW.toast('حدد نصًا أو شكلًا أولًا'); return; }
    for (const c of cs) { const lt = clamp(s.t - c.start, 0, c.dur); const p = GW.pv(c.motion.pos, lt); const v = ax === 'h' ? [s.w / 2, p[1]] : [p[0], s.h / 2]; if (GW.isAnim(c.motion.pos)) GW.setPv(c.motion.pos, lt, v); else c.motion.pos = GW.P(v); }
    GW.commit(ax === 'h' ? 'توسيط أفقي' : 'توسيط عمودي'); GW.invalidate();
  }
  GW.bus.on('panel-shown', (id) => { if (id === 'program') { gtools(); cmpEls(); } });
  GW.bus.on('workspace', (ws) => { if (ws !== 'color' && Compare.on) { Compare.on = false; drawCompare(); } });
})();
