'use strict';
/* إضافات OFX (تجريبي) — experimental bridge to OpenFX image-effect plugins installed on this computer (e.g. Red Giant Universe).
   The plugins are loaded in place by tools/ofxhost (qq-ofxhost.exe, shipped in resources/bin/ofx); nothing is copied.
   No live preview: an effect is baked onto a clip — ffmpeg decode → qq-ofxhost → ffmpeg encode → new media file that replaces the
   clip source (one undo step; the original media stays in the project; «إزالة تأثير OFX» restores it). Effects stack: baking on an
   already-baked clip keeps a chain and removal restores the very first source.
   Main-process side: the /* ===== ofx ===== *\/ block in main.js (+ preload.js). Automation: GW.API.methods.ofxScan / ofxApply / ofxRemove. */
(function () {
  const { esc, clamp } = GW; const UI = GW.UI;
  const api = () => window.gws;
  const OX = GW.Ofx = { lib: null, busy: false };
  const KEY = 'gws.ofx';
  const cfg = () => { const o = { folder: '', hostName: '', enc: 'h264' }; try { Object.assign(o, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {} return o; };
  const saveCfg = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} };
  const fail = (m) => { throw new Error(m); };
  const selClips = () => [...GW.sel.clips].map(id => GW.clipById(id)).filter(Boolean);
  const short = (s) => String(s || '').replace(/^OfxImageEffectContext/, '').replace(/^OfxBitDepth/, '');
  const SUFFIX = / \(OFX: [^)]*\)$/;

  /* ================= error messages (Arabic, say exactly what failed) ================= */
  OX.errText = (code, detail, messages) => {
    const d = String(detail || '').trim(); let t;
    switch (code) {
      case 'HOST_MISSING': t = 'لم يُعثر على جسر OFX (qq-ofxhost) — أعد تثبيت البرنامج' + (d ? ' (' + d + ')' : ''); break;
      case 'FOLDER_MISSING': t = 'مجلد الإضافات غير موجود: ' + d; break;
      case 'BINARY_MISSING': t = 'لا توجد نسخة ويندوز 64-بت من الإضافة داخل الحزمة'; break;
      case 'LOAD_FAILED':
        t = /\b126\b/.test(d) ? 'تعذر تحميل الإضافة: مكتبة مطلوبة مفقودة (غالبًا Microsoft Visual C++ Redistributable أو مكتبات البرنامج الأصلي)'
          : /\b193\b/.test(d) ? 'تعذر تحميل الإضافة: الملف ليس إضافة ويندوز 64-بت صالحة'
          : 'تعذر تحميل ملف الإضافة: ' + d; break;
      case 'NO_PLUGIN': t = 'التأثير غير موجود في ملف الإضافة'; break;
      case 'DESCRIBE_FAILED': t = 'الإضافة رفضت التهيئة داخل قص قص: ' + d; break;
      case 'UNSUPPORTED_CONTEXT': t = 'هذا النوع من الإضافات (مثل الانتقالات) لا يدعمه الجسر بعد'; break;
      case 'NO_OUTPUT_CLIP': t = 'الإضافة لا تعرّف مخرجًا للصورة'; break;
      case 'INSTANCE_REFUSED': t = 'الإضافة رفضت التشغيل خارج البرامج المدعومة (رفضت إنشاء نسخة من التأثير)'; break;
      case 'MISSING_HOST_FEATURE': t = 'الإضافة تطلب ميزة غير متوفرة في الجسر التجريبي: ' + d; break;
      case 'RENDER_FAILED': t = 'فشل التصيير داخل الإضافة: ' + d; break;
      case 'CRASH': t = 'انهارت الإضافة أثناء التشغيل (' + d + ')'; break;
      case 'TIMEOUT': t = 'الإضافة لم تستجب في الوقت المحدد'; break;
      case 'INPUT_SHORT': case 'DECODE_FAILED': t = 'تعذر قراءة إطارات المقطع: ' + d; break;
      case 'ENCODE_FAILED': t = 'تعذر ترميز الملف الناتج: ' + d; break;
      case 'OUTPUT_WRITE': t = 'تعذر كتابة الإطارات الناتجة (المساحة ممتلئة؟)'; break;
      case 'PARAMS_JSON': t = 'قيم المعاملات غير صالحة'; break;
      case 'SPAWN_FAILED': t = 'تعذر تشغيل الجسر أو FFmpeg: ' + d; break;
      default: t = 'فشل جسر OFX (' + (code || '?') + ')' + (d ? ': ' + d : '');
    }
    const ms = (messages || []).filter(x => !/^Warning unknown parameter/.test(x)); if (ms.length) t += ' — رسالة الإضافة: ' + ms.slice(-2).join(' | ');
    return t;
  };

  /* ================= scanning ================= */
  OX.info = async () => { if (!api() || !api().ofxInfo) fail('متاح في نسخة سطح المكتب'); return api().ofxInfo(); };
  OX.scan = async (o = {}, onP) => {
    const info = await OX.info(); const c = cfg(); const folder = o.folder || c.folder || info.defaultFolder;
    const id = 'ofxscan_' + GW.uid(); OX._scanId = id;
    const off = api().onOfxProgress ? api().onOfxProgress(p => { if (p.id === id && onP) onP(p); }) : null;
    let r; try { r = await api().ofxScan({ folder, hostName: o.hostName || c.hostName || '', force: !!o.force, id }); } finally { if (off) off(); OX._scanId = null; }
    if (!r || !r.ok) fail(OX.errText(r && r.error, r && r.detail));
    const plugins = [];
    for (const b of r.bundles) {
      const match = String(b.bundle || '').split(/[\\/]/).pop().replace(/\.ofx\.bundle$/i, '').replace(/\.ofx$/i, '').replace(/_OFX$/i, '');
      if (b.error || !b.plugins) { plugins.push({ key: b.bundle + '#0', bundle: b.bundle, index: 0, label: match, grouping: '', broken: true, error: b.error, detail: b.detail, match }); continue; }
      // a binary may also export older versions of the same effect (same label): keep the newest one visible
      const ver = (p) => String(p.version || '0.0').split('.').map(Number); const newer = (a, b) => { const x = ver(a), y = ver(b); if (!!a.renderable !== !!b.renderable) return !!a.renderable; return x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : a.index > b.index; };
      const best = new Map(); for (const p of b.plugins) { if (p.error) continue; const k = p.label || p.id; if (!best.has(k) || newer(p, best.get(k))) best.set(k, p); }
      for (const p of b.plugins) { if (!p.error && best.get(p.label || p.id) !== p) continue; plugins.push(Object.assign({}, p, { key: b.bundle + '#' + p.index, bundle: b.bundle, match, broken: !!p.error, label: p.label || match, versions: b.plugins.length })); }
    }
    OX.lib = { folder: r.folder, host: r.host, plugins, at: Date.now(), cancelled: r.cancelled };
    return OX.lib;
  };
  OX.find = (q) => { const L = (OX.lib && OX.lib.plugins) || []; return L.find(p => p.key === q || p.id === q || p.label === q) || null; };

  /* ================= parameters ================= */
  const visible = (p) => !p.secret && !['Page', 'PushButton', 'Custom', 'Parametric', 'Bytes'].includes(p.type);
  const normUI = (p) => p.spatial === 'canonical' && p.defaultCoords === 'normalised'; // UI edits it as a fraction of the frame
  OX.defaults = (pl) => { const v = {}; for (const p of pl.params || []) if (visible(p) && p.type !== 'Group' && p.default !== undefined) v[p.name] = Array.isArray(p.default) ? p.default.slice() : p.default; return v; };
  // UI values → host values (normalised spatial params → pixels of the baked frame); only values that differ from the default are sent
  OX.hostParams = (pl, vals, W, H) => {
    const out = {};
    for (const p of pl.params || []) {
      if (!(p.name in vals) || !visible(p)) continue; let v = vals[p.name];
      if (JSON.stringify(v) === JSON.stringify(p.default) && !normUI(p)) continue;
      if (normUI(p)) { if (Array.isArray(v)) v = v.map((x, i) => x * (i === 0 ? W : i === 1 ? H : 1)); else v = v * (/Y/.test(p.doubleType || '') && !/XY/.test(p.doubleType || '') ? H : W); }
      if (p.type === 'Boolean') v = v ? 1 : 0;
      out[p.name] = v;
    }
    return out;
  };
  // Universe-style preset (.rgx param streams) → UI values (matched by parameter label, then name)
  OX.presetValues = (pl, preset) => {
    const vals = {}; let n = 0; const norm = (s) => String(s || '').trim().toLowerCase();
    const ps = (pl.params || []).filter(p => visible(p) && p.type !== 'Group');
    for (const s of preset.streams || []) {
      const p = ps.find(q => norm(q.label) === norm(s.name)) || ps.find(q => norm(q.name) === norm(s.name)); if (!p) continue;
      let v = s.value;
      if (p.type === 'Choice') { const i = (p.choices || []).findIndex(c => norm(c) === norm(s.choiceString)); v = i >= 0 ? i : +v || 0; }
      else if (p.type === 'Boolean') v = v ? 1 : 0;
      else if (p.type === 'RGB' || p.type === 'RGBA') { if (!Array.isArray(v)) continue; v = p.type === 'RGBA' ? [v[0], v[1], v[2], v[3] == null ? 1 : v[3]] : v.slice(0, 3); }
      else if (p.dims > 1) { if (!Array.isArray(v)) continue; v = v.slice(0, p.dims); }
      else if (p.type === 'String' || p.type === 'StrChoice') v = String(v);
      else if (typeof v !== 'number') continue;
      vals[p.name] = v; n++;
    }
    return { vals, matched: n };
  };
  const hex = (rgb) => '#' + rgb.slice(0, 3).map(x => Math.round(clamp(+x || 0, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  const unhex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  function numBox(v, step, on) { const i = document.createElement('input'); i.type = 'number'; i.className = 'inp'; i.style.width = '76px'; i.step = step; i.value = +(+v).toFixed(4); i.onkeydown = e => e.stopPropagation(); i.onchange = () => on(+i.value); return i; }
  function paramRow(F, p, vals, onCh) {
    const v = vals[p.name]; const set = (x) => { vals[p.name] = x; onCh && onCh(p, x); };
    const lab = p.label || p.name;
    if (p.type === 'Boolean') return F.frow(lab, F.checkIn(v, x => set(x)));
    if (p.type === 'Choice') return F.frow(lab, F.selectIn((p.choices || []).map((c, i) => [i, c]), v, x => set(+x)));
    if (p.type === 'StrChoice') return F.frow(lab, F.selectIn((p.enum || p.choices || []).map((c, i) => [c, (p.choices || [])[i] || c]), v, x => set(x)));
    if (p.type === 'RGB' || p.type === 'RGBA') {
      const parts = [F.colorIn(hex(v || [0, 0, 0]), h => { const a = unhex(h); set(p.type === 'RGBA' ? [...a, (vals[p.name] || [])[3] == null ? 1 : vals[p.name][3]] : a); })];
      if (p.type === 'RGBA') parts.push(numBox((v || [])[3] == null ? 1 : v[3], .01, a => { const c = (vals[p.name] || [0, 0, 0, 1]).slice(); c[3] = clamp(a, 0, 1); set(c); }));
      return F.frow(lab, parts);
    }
    if (p.type === 'String') { const i = document.createElement('input'); i.className = 'inp'; i.dir = 'auto'; i.value = v || ''; i.style.flex = '1'; i.onkeydown = e => e.stopPropagation(); i.oninput = () => set(i.value); return F.frow(lab, i); }
    if (p.dims > 1) { // 2D / 3D
      const pct = normUI(p) || p.spatial === 'normalised'; const arr = (v || []).slice();
      const boxes = arr.map((x, k) => numBox(pct ? x * 100 : x, pct ? 1 : (p.type.startsWith('Integer') ? 1 : .01), y => { const a = (vals[p.name] || arr).slice(); a[k] = pct ? y / 100 : y; set(a); }));
      const r = F.frow(lab + (pct ? ' (٪ من الإطار)' : ''), boxes); return r;
    }
    if (p.type === 'Double' || p.type === 'Integer') {
      const pct = normUI(p) || p.spatial === 'normalised'; const k = pct ? 100 : 1;
      let lo = p.displayMin != null ? p.displayMin : p.min, hi = p.displayMax != null ? p.displayMax : p.max;
      if (lo == null || lo < -1e6) lo = Math.min(0, (+v || 0)); if (hi == null || hi > 1e6) hi = Math.max(100, (+v || 0) * 2, lo + 1);
      const step = p.type === 'Integer' ? 1 : (p.increment && p.increment < (hi - lo) / 20 ? p.increment : +((hi - lo) / 200).toPrecision(2));
      const [rg] = F.rangeIn((+v || 0) * k, lo * k, hi * k, step * k, x => { nb.value = x; set(x / k); });
      rg.style.flex = '1';
      const nb = numBox((+v || 0) * k, step * k, x => { if (p.min != null) x = Math.max(p.min * k, x); if (p.max != null) x = Math.min(p.max * k, x); rg.value = x; set(p.type === 'Integer' ? Math.round(x / k) : x / k); });
      const r = F.frow(lab + (pct ? ' (٪)' : ''), [rg, nb]); if (p.hint) r.title = p.hint; return r;
    }
    return null;
  }
  OX.paramForm = (pl, vals, onCh) => {
    const F = UI.form; const f = document.createElement('div'); f.className = 'form ofx-form';
    const groups = new Map(); const holder = (p) => (p.parent && groups.get(p.parent)) || f;
    for (const p of pl.params || []) {
      if (p.type === 'Group') { if (p.secret) continue; const g = document.createElement('div'); g.className = 'ofx-grp'; g.append(F.sec(p.label || p.name)); holder(p).append(g); groups.set(p.name, g); continue; }
      if (!visible(p)) continue; const r = paramRow(F, p, vals, onCh); if (!r) continue; if (p.hint) r.title = p.hint; if (p.enabled === false) r.classList.add('dis'); holder(p).append(r);
    }
    if (!f.querySelector('.frow')) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'لا توجد معاملات قابلة للتعديل لهذا التأثير'; f.append(e); }
    return f;
  };

  /* ================= bake ================= */
  function videoClip(id) {
    let c = id ? GW.clipById(id) : null;
    if (!c && !id) c = selClips().find(x => x.kind === 'video') || null;
    if (!c || c.kind !== 'video') fail('حدد مقطع فيديو أولًا');
    const m = GW.media(c.media); if (!m || !m.path || m.offline) fail('ملف المقطع غير متاح');
    return { c, m };
  }
  const canH264 = () => { try { return !!document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'); } catch (e) { return false; } };
  // o = {id (clip), plugin (lib entry or key), values (UI values), enc:'h264'|'alpha', hostName}
  OX.bake = async (o = {}, onP, ctl = {}) => {
    const pl = typeof o.plugin === 'string' ? OX.find(o.plugin) : o.plugin; if (!pl) fail('التأثير غير موجود — امسح مجلد الإضافات أولًا');
    if (pl.broken) fail(OX.errText(pl.error, pl.detail));
    if (!pl.renderable) fail(OX.errText('UNSUPPORTED_CONTEXT'));
    const { c, m } = videoClip(o.id); const s = GW.seq(); const sp = c.speed || 1;
    const p = await GW.Media.cachePaths(); if (!p) fail('متاح في نسخة سطح المكتب');
    const fps = +(m.fps || s.fps || 30); const ss = Math.max(0, c.in); const len = Math.min((m.dur || 1e9) - ss, c.dur * sp);
    if (!(len > 0)) fail('مدة المقطع غير صالحة');
    const frames = Math.max(1, Math.round(len * fps));
    let W = m.w || s.w, H = m.h || s.h;
    const enc = o.enc === 'alpha' || !canH264() ? 'vp9' : 'h264'; if (enc === 'h264') { W -= W % 2; H -= H % 2; }
    const dir = p.renders + p.sep + 'ofx'; await api().writeText(dir + p.sep + '.keep', '');
    const base = (m.name || 'clip').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
    const tag = String(pl.label || 'fx').replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 24);
    const out = dir + p.sep + base + '_' + tag + '_' + GW.uid().slice(0, 5) + (enc === 'h264' ? '.mp4' : '.webm');
    const caps = enc === 'h264' && GW.Media.caps ? await GW.Media.caps().catch(() => ({})) : {};
    const encArgs = enc === 'vp9'
      ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '18', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-auto-alt-ref', '0', '-c:a', 'libopus', '-b:a', '192k']
      : caps.h264_nvenc && o.nvenc !== false ? ['-c:v', 'h264_nvenc', '-preset', 'p6', '-rc', 'vbr', '-cq', '15', '-b:v', '0', '-pix_fmt', 'yuv420p', '-g', String(Math.round(fps)), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-g', String(Math.round(fps)), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'];
    const params = OX.hostParams(pl, o.values || OX.defaults(pl), W, H);
    const jid = 'ofx_' + GW.uid(); ctl.kill = () => api().ofxCancel(jid);
    const off = api().onOfxProgress(ev => { if (ev.id !== jid) return; if (ev.total) onP && onP(Math.min(99, ev.done / ev.total * 100), 'تصيير الإطارات ' + ev.done + '/' + ev.total); else if (ev.msg && ctl.onMsg) ctl.onMsg(ev.msg); });
    onP && onP(0, 'تشغيل الإضافة');
    let r; try {
      r = await api().ofxRender({ id: jid, bundle: pl.bundle, index: pl.index, params, src: m.proxy && o.proxy ? m.proxy : m.path, ss, dur: len, w: W, h: H, fps, frames, out, encArgs, audio: !!m.hasAudio, hostName: o.hostName || cfg().hostName || '' });
    } finally { off && off(); }
    if (ctl.cancelled || (r && r.cancelled)) return null;
    if (!r || !r.ok) { const e = new Error(OX.errText(r && r.error, r && r.detail, r && r.messages)); e.code = r && r.error; e.res = r; throw e; }
    onP && onP(99, 'استيراد الملف الناتج');
    const HS = GW.hist, h0 = HS.idx;
    const added = await GW.Media.importFiles([{ path: out, name: out.split(/[\\/]/).pop(), size: 0 }]);
    const nm = added[0] || GW.prj.media.find(x => x.path === out); if (!nm) fail('تعذر استيراد الملف الناتج');
    if ((GW.rt.m[nm.id] || {}).status !== 'ready') fail('تعذر تجهيز الملف الناتج');
    const prev = c.ofx; const label = pl.label || pl.id;
    c.ofx = { orig: prev ? prev.orig : m.id, ss: +((prev ? prev.ss : 0) + ss).toFixed(6), stack: [...(prev ? prev.stack : []), { plugin: pl.id, label, bundle: pl.bundle, index: pl.index, values: o.values || {}, media: nm.id }] };
    c.media = nm.id; c.in = +(c.in - ss).toFixed(6);
    c.name = String(c.name || '').replace(SUFFIX, '') + ' (OFX: ' + c.ofx.stack.map(x => x.label).join(' + ') + ')';
    GW.Media.dropVid(c.id);
    GW.commit('تأثير OFX: ' + label);
    // the import made its own history entry: fold it into this one so a single undo restores the clip and the media bin
    if (HS.idx === h0 + 2 && HS.labels[h0 + 1] !== HS.labels[HS.idx]) { HS.stack.splice(h0 + 1, 1); HS.labels.splice(h0 + 1, 1); HS.idx--; GW.bus.emit('hist'); }
    GW.invalidate(); if (GW.TL) GW.TL.invalidate();
    return { media: nm, clip: c, frames: r.frames, messages: r.messages || [] };
  };
  OX.unbake = (id) => {
    const cs = id ? [GW.clipById(id)].filter(Boolean) : selClips(); let n = 0;
    for (const c of cs) { if (!c.ofx) continue; const o = GW.media(c.ofx.orig); if (!o) continue; c.media = o.id; c.in = +(c.in + c.ofx.ss).toFixed(6); c.name = String(c.name || '').replace(SUFFIX, ''); delete c.ofx; GW.Media.dropVid(c.id); n++; }
    if (n) { GW.commit('إزالة تأثير OFX'); GW.invalidate(); if (GW.TL) GW.TL.invalidate(); }
    return n;
  };

  /* ================= UI ================= */
  const st = document.createElement('style');
  st.textContent = `
  .ofx-dlg{display:flex;flex-direction:column;gap:8px;min-height:440px}
  .ofx-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ofx-top .inp{flex:1;min-width:200px;direction:ltr;text-align:left}
  .ofx-note{color:var(--text2);font-size:11.5px;line-height:1.6}
  .ofx-main{display:flex;gap:10px;min-height:360px;flex:1}
  .ofx-list{width:260px;flex:none;display:flex;flex-direction:column;gap:6px;border-inline-end:1px solid var(--line);padding-inline-end:8px}
  .ofx-items{overflow:auto;max-height:420px;display:flex;flex-direction:column}
  .ofx-g{font-size:11px;color:var(--text3,var(--text2));margin:8px 0 2px;text-transform:none}
  .ofx-it{padding:4px 8px;border-radius:3px;cursor:pointer;font-size:12px;display:flex;gap:6px;align-items:center;justify-content:space-between}
  .ofx-it:hover{background:var(--bg3,var(--bg2))}.ofx-it.on{background:var(--accent);color:#fff}
  .ofx-it small{opacity:.65;font-size:10px}
  .ofx-det{flex:1;min-width:0;overflow:auto;max-height:470px}
  .ofx-det h3{margin:0 0 4px;font-size:14px}.ofx-meta{color:var(--text2);font-size:11px;direction:ltr;text-align:left;word-break:break-all}
  .ofx-act{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
  .ofx-form .frow.dis{opacity:.5}.ofx-grp{margin-inline-start:6px}
  .ofx-err{color:var(--red,#e5484d);font-size:12px;line-height:1.6;white-space:pre-wrap}
  .ofx-pr{display:flex;flex-direction:column;gap:8px}.ofx-pr .ofx-st{color:var(--text2);font-size:11.5px;min-height:16px}.ofx-pr .ofx-log{max-height:90px;overflow:auto;font-size:11px;color:var(--text2);direction:ltr;text-align:left;white-space:pre-wrap}`;
  document.head.append(st);
  const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const btn = (label, on, cls) => { const b = el('button', 'btn sm ' + (cls || ''), label); b.onclick = on; return b; };

  function progressBox(title, onCancel) {
    const body = el('div', 'ofx-pr'); body.innerHTML = '<div class="prog"><i></i></div><div class="ofx-st"></div><div class="ofx-log"></div>';
    const S = { done: false };
    const m = GW.modal({ title, body, width: 460, buttons: [{ label: 'إلغاء', value: null }], onClose: () => { if (!S.done) { S.cancelled = true; onCancel && onCancel(); } } });
    S.set = (p, txt) => { body.querySelector('.prog i').style.width = clamp(p, 0, 100).toFixed(1) + '%'; if (txt != null) body.querySelector('.ofx-st').textContent = txt; };
    S.log = (t) => { const l = body.querySelector('.ofx-log'); l.textContent += t + '\n'; l.scrollTop = 1e9; };
    S.close = () => { S.done = true; m.close(); };
    return S;
  }

  // Settings → «إضافات OFX (تجريبي)»: only the plugins folder and a rescan. The effects themselves live in the Effects panel
  // («Universe (OFX)», ofx_fx.js); the old bake-onto-clip path stays as OX.bake / API ofxApply.
  UI.ofx = async () => {
    let info; try { info = await OX.info(); } catch (e) { GW.toast(e.message, 'err'); return; }
    const c0 = cfg(); if (!c0.folder) c0.folder = info.defaultFolder;
    const body = el('div', 'ofx-dlg'); body.style.minHeight = '0';
    const note = el('div', 'ofx-note', 'تجريبي: إضافات OpenFX المثبّتة على جهازك (مثل Red Giant Universe) تظهر تلقائيًا في لوحة التأثيرات ضمن «Universe (OFX)»، وتُستخدم مثل أي تأثير: اسحبها على المقطع وعدّل معاملاتها وإطاراتها المفتاحية في «عناصر التحكم بالتأثيرات». تُشغَّل الإضافات من مكانها (لا يُنسخ أي ملف). قد ترفض بعض الإضافات العمل خارج البرامج المدعومة رسميًا، أو تضع علامة مائية إن لم يتعرّف ترخيصها.');
    const top = el('div', 'ofx-top');
    const folderIn = el('input', 'inp'); folderIn.value = c0.folder; folderIn.onkeydown = e => e.stopPropagation(); folderIn.onchange = () => { c0.folder = folderIn.value.trim(); saveCfg(c0); };
    const stLine = el('div', 'ofx-note'); const errs = el('div', 'ofx-err');
    const show = () => {
      const L = (OX.lib && OX.lib.plugins) || []; const ok = L.filter(p => p.renderable).length, bad = L.filter(p => p.broken);
      stLine.textContent = !info.hostExists ? OX.errText('HOST_MISSING', info.host) : !OX.lib ? 'لم يتم المسح بعد' : 'عُثر على ' + L.length + ' تأثيرًا · متاح في لوحة التأثيرات: ' + ok + (bad.length ? ' · تعذر تحميل: ' + bad.length : '');
      errs.textContent = bad.slice(0, 6).map(p => p.label + ': ' + OX.errText(p.error, p.detail)).join('\n');
    };
    const rescan = async (force) => {
      c0.folder = folderIn.value.trim() || info.defaultFolder; saveCfg(c0); stLine.textContent = 'جارٍ قراءة الإضافات…'; errs.textContent = '';
      const r = GW.OfxFx ? await GW.OfxFx.autoScan({ folder: c0.folder, force, onP: null }) : null;
      if (r && !r.ok) { stLine.textContent = r.error; return; } show();
    };
    top.append(el('span', null, 'مجلد الإضافات'), folderIn,
      btn('اختيار…', async () => { const d = await api().ofxPickFolder(folderIn.value); if (d) { folderIn.value = d; c0.folder = d; saveCfg(c0); rescan(false); } }),
      btn('إعادة المسح', () => rescan(true), 'pri'), btn('مجلد السجل', () => api().ofxOpenLog()));
    body.append(note, top, stLine, errs); show();
    return GW.modal({ title: 'إضافات OFX (تجريبي)', body, width: 720, buttons: [{ label: 'إغلاق', value: null }] });
  };
  OX.cfg = cfg;

  /* ================= menus ================= */
  // effects are applied from the Effects panel; a clip baked with the old path can still be restored
  (GW.clipMenuHooks = GW.clipMenuHooks || []).push((items, c) => { if (c.kind === 'video' && c.ofx) items.push({ label: 'إزالة تأثير OFX المحمّص', action: () => OX.unbake(c.id) }); });

  /* ================= automation (GW.API) ================= */
  const A = GW.API && GW.API.methods;
  if (A) {
    // ofxScan({folder, force}) → {plugins:[{key,id,label,grouping,renderable,error}]}
    A.ofxScan = async (o = {}) => { const L = await OX.scan(o); return { folder: L.folder, plugins: L.plugins.map(p => ({ key: p.key, id: p.id, label: p.label, grouping: p.grouping, renderable: !!p.renderable, error: p.error || null, params: (p.params || []).filter(visible).map(q => ({ name: q.name, type: q.type, label: q.label, default: q.default })) })) }; };
    // ofxApply({id, plugin: key|id|label, values:{name: value}, enc:'h264'|'alpha'}) → {media, clip}
    A.ofxApply = async (o = {}) => { if (!OX.lib) await OX.scan({}); const pl = OX.find(o.plugin); if (!pl) fail('unknown OFX plugin: ' + o.plugin); const r = await OX.bake({ ...o, plugin: pl, values: Object.assign(OX.defaults(pl), o.values || {}) }); return r && { media: { id: r.media.id, name: r.media.name, path: r.media.path }, clip: GW.API.clipInfo(r.clip), frames: r.frames }; };
    A.ofxRemove = ({ id } = {}) => ({ restored: OX.unbake(id) });
  }
})();
