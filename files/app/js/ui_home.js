'use strict';
/* Home screen (design v5): hero + primary actions with aspect pickers, recent projects as poster cards (poster derived
   from the saved project file when readable, else a generated gradient), templates row, "what's new" card, shortcut hints. */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const I = (n, s) => GW.ico(n, s || 18);
  const T = (ar, en) => GW.lang === 'en' ? en : ar;
  const ASPECTS = [
    { id: '16:9', w: 1920, h: 1080, fps: 30, n: 'يوتيوب 1080p', en: 'YouTube 1080p' },
    { id: '9:16', w: 1080, h: 1920, fps: 30, n: 'ريلز / شورتس', en: 'Reels / Shorts' },
    { id: '1:1', w: 1080, h: 1080, fps: 30, n: 'مربع', en: 'Square' },
    { id: '4:5', w: 1080, h: 1350, fps: 30, n: 'إنستغرام', en: 'Instagram' }
  ];
  const PRESETS = [ASPECTS[0], { n: 'سينمائي 4K', w: 3840, h: 2160, fps: 25 }, ASPECTS[1], ASPECTS[2]];
  const TEMPLATES = [
    { id: 'title', n: 'عنوان افتتاحي', en: 'Opening title', d: 'نص متحرك على خلفية داكنة', den: 'Animated text on a dark plate', ws: 'graphics', paint: tplTitle },
    { id: 'lower', n: 'ثلث سفلي', en: 'Lower third', d: 'اسم + صفة بشريط ملوّن', den: 'Name + role on a colour bar', ws: 'graphics', paint: tplLower },
    { id: 'map', n: 'مقدمة خريطة', en: 'Map intro', d: 'كرة أرضية تنزل إلى موقع', den: 'Globe flying into a location', ws: 'maps', paint: tplMap },
    { id: 'inv', n: 'غزو على الخريطة', en: 'Invasion on the map', d: 'أسهم وجبهات متحركة', den: 'Animated arrows and fronts', ws: 'maps', inv: true, paint: tplInv },
    { id: 'reel', n: 'ريل رأسي', en: 'Vertical reel', d: '9:16 مع ترجمة تلقائية', den: '9:16 with auto captions', ws: 'edit', a: ASPECTS[1], paint: tplReel },
    { id: 'podcast', n: 'بودكاست', en: 'Podcast', d: 'موجة صوت + مؤثرات', den: 'Waveform + sound effects', ws: 'audio', paint: tplPod }
  ];
  const NEWS = [
    ['واجهة جديدة بالكامل: شريط علوي، لوحات بزجاج، خط زمني أوضح', 'All-new interface: top bar, glass panels, clearer timeline'],
    ['كرة أرضية ثلاثية الأبعاد بصور فضائية وتضاريس مجسّمة', '3D globe with satellite imagery and real terrain'],
    ['حدود أي تاريخ من 123 ألف سنة ق.م حتى اليوم', 'Borders from any date, 123,000 BC to today'],
    ['تفريغ صوتي وترجمة تلقائية بالعربية', 'Arabic transcription and automatic captions'],
    ['مكتبة مؤثرات صوتية ومولّد تعليق صوتي', 'Sound-effects library and voice-over generator']
  ];

  /* ---- template thumbnails (tiny canvas paintings, 16:9) ---- */
  function plate(g, w, h, c0, c1) { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  function tplTitle(g, w, h) { plate(g, w, h, '#15181d', '#0b0d10'); g.fillStyle = '#ff6a2b'; g.fillRect(w * .3, h * .62, w * .4, 3); g.fillStyle = '#f4efe6'; g.font = `800 ${Math.round(h * .2)}px Cairo, sans-serif`; g.textAlign = 'center'; g.fillText(GW.lang === 'en' ? 'TITLE' : 'عنوان', w / 2, h * .55); }
  function tplLower(g, w, h) { plate(g, w, h, '#1d2a38', '#0f151c'); g.fillStyle = '#ff6a2b'; g.fillRect(w * .08, h * .68, 4, h * .22); g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(w * .08 + 4, h * .68, w * .5, h * .22); g.fillStyle = '#fff'; g.fillRect(w * .13, h * .72, w * .3, 4); g.fillStyle = '#aab0b9'; g.fillRect(w * .13, h * .8, w * .2, 3); }
  function tplMap(g, w, h) { plate(g, w, h, '#061423', '#02070d'); const r = h * .62; const gr = g.createRadialGradient(w * .62, h * .55, r * .2, w * .62, h * .55, r); gr.addColorStop(0, '#2b6ea8'); gr.addColorStop(.7, '#123a5e'); gr.addColorStop(1, '#071a2c'); g.fillStyle = gr; g.beginPath(); g.arc(w * .62, h * .55, r, 0, 7); g.fill(); g.fillStyle = '#4a8a4f'; g.beginPath(); g.ellipse(w * .58, h * .5, r * .32, r * .2, -.4, 0, 7); g.fill(); g.fillStyle = '#ff6a2b'; g.beginPath(); g.arc(w * .6, h * .48, 3, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,106,43,.6)'; g.lineWidth = 1; g.beginPath(); g.arc(w * .6, h * .48, 7, 0, 7); g.stroke(); }
  function tplInv(g, w, h) { plate(g, w, h, '#2b2a22', '#15140f'); g.fillStyle = '#4e5a3a'; g.beginPath(); g.moveTo(0, h * .3); g.bezierCurveTo(w * .3, h * .1, w * .6, h * .5, w, h * .25); g.lineTo(w, h); g.lineTo(0, h); g.fill(); g.strokeStyle = '#ef5350'; g.lineWidth = 3; g.lineCap = 'round'; for (const [x0, y0, x1, y1] of [[w * .15, h * .75, w * .45, h * .5], [w * .25, h * .9, w * .55, h * .62]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 8, y1 + 1); g.moveTo(x1, y1); g.lineTo(x1 - 2, y1 + 8); g.stroke(); } }
  function tplReel(g, w, h) { plate(g, w, h, '#101216', '#0a0b0e'); const pw = h * .5, px = (w - pw) / 2; const gr = g.createLinearGradient(px, 0, px + pw, h); gr.addColorStop(0, '#ff6a2b'); gr.addColorStop(1, '#4cc2ff'); g.fillStyle = gr; g.fillRect(px, 4, pw, h - 8); g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(px + 6, h * .72, pw - 12, h * .12); g.fillStyle = '#fff'; g.fillRect(px + 12, h * .76, pw - 24, 3); }
  function tplPod(g, w, h) { plate(g, w, h, '#0f1a1a', '#080f10'); g.fillStyle = '#3fb8a8'; const n = 28; for (let i = 0; i < n; i++) { const a = (Math.sin(i * .9) * .5 + .5) * (Math.sin(i * .23) * .5 + .5) * h * .5 + 3; const x = w * .1 + i * (w * .8 / n); g.fillRect(x, h / 2 - a / 2, w * .8 / n - 2, a); } }

  /* ---- recent-project posters ---- */
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function paintPoster(cv, path, proj) {
    const w = cv.width = 360, h = cv.height = 202; const g = cv.getContext('2d'); const hh = hash(path); const hue = hh % 360;
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, `hsl(${hue} 38% 20%)`); gr.addColorStop(1, `hsl(${(hue + 50) % 360} 42% 9%)`); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const rg = g.createRadialGradient(w * .75, h * .2, 10, w * .75, h * .2, w * .7); rg.addColorStop(0, 'rgba(255,255,255,.12)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, h);
    const s = proj && proj.seqs && proj.seqs[0]; if (!s || !s.clips || !s.clips.length) { g.fillStyle = 'rgba(255,255,255,.08)'; g.font = '800 64px Cairo, sans-serif'; g.textAlign = 'center'; g.fillText('ق', w / 2, h * .68); return; }
    // mini timeline derived from the saved sequence: one lane per track, clip bars in their label colours
    const end = Math.max(1, ...s.clips.map(c => (c.start || 0) + (c.dur || 0))); const lanes = {}; let n = 0;
    for (const c of s.clips) { const k = c.tt + (c.ti || 0); if (lanes[k] == null) lanes[k] = n++; }
    const lh = Math.min(16, (h * .6) / Math.max(1, n)), top = h * .5 - (lh * n) / 2 + 10;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, top - 8, w, lh * n + 16);
    for (const c of s.clips) { const y = top + lanes[c.tt + (c.ti || 0)] * lh; const x = w * .06 + (c.start || 0) / end * w * .88, cw = Math.max(2, (c.dur || 0) / end * w * .88); g.fillStyle = c.label || (c.tt === 'a' ? '#3fb8a8' : '#8ad7ff'); g.globalAlpha = .9; g.beginPath(); g.roundRect(x, y + 2, cw - 1, lh - 4, 3); g.fill(); }
    g.globalAlpha = 1; g.fillStyle = '#ff6a2b'; g.fillRect(w * .06 + w * .88 * .3, top - 8, 2, lh * n + 16);
  }
  async function loadPosters(el) {
    if (!window.gws || !gws.readText) return;
    for (const card of el.querySelectorAll('.hm-r[data-r]')) {
      const cv = card.querySelector('canvas'); const path = card.dataset.r; let proj = null;
      try { if (await gws.exists(path)) { const txt = await gws.readText(path); if (txt.length < 4e7) proj = JSON.parse(txt); } } catch (e) { proj = null; }
      if (!cv.isConnected) return; paintPoster(cv, path, proj);
      const s = proj && proj.seqs && proj.seqs[0]; const meta = card.querySelector('.th i'); if (meta && s) meta.textContent = `${s.w}×${s.h} · ${s.fps}`;
      if (proj && proj.savedAt) { const sp = card.querySelector('.when'); if (sp) { const d = new Date(proj.savedAt); sp.textContent = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}  ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; } }
    }
  }

  async function start(p, then) {
    close(); await GW.newProjectCmd(); const s = GW.seq(); s.w = p.w; s.h = p.h; s.fps = p.fps; GW.hist.reset('مشروع جديد'); GW.bus.emit('project'); GW.invalidate();
    if (then) setTimeout(then, 50);
  }
  function close() { const el = document.getElementById('home'); if (el) el.remove(); }
  GW.UI.closeHome = close;
  let aspect = '16:9'; try { aspect = localStorage.getItem('qq.aspect') || '16:9'; } catch (e) {}

  GW.UI.home = () => {
    close(); const el = document.createElement('div'); el.id = 'home'; el.dir = GW.lang === 'en' ? 'ltr' : 'rtl';
    const rec = (GW.recent ? GW.recent() : []).slice(0, 8);
    const ar = ASPECTS.map(a => { const r = a.w / a.h; const fw = r >= 1 ? 22 : Math.round(22 * r), fh = r >= 1 ? Math.round(22 / r) : 22; return `<button data-ar="${a.id}" class="${a.id === aspect ? 'on' : ''}" title="${esc(T(a.n, a.en))} · ${a.w}×${a.h}"><i style="width:${fw}px;height:${fh}px"></i>${a.id}</button>`; }).join('');
    const upd = (GW.UI.updState && GW.UI.updState.info) || null; const notes = upd && (GW.lang === 'en' ? upd.notes_en || upd.notes_ar : upd.notes_ar || upd.notes_en);
    const newsItems = notes ? String(notes).split(/\r?\n/).map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 5) : NEWS.map(n => T(n[0], n[1]));
    el.innerHTML = `<div class="hm-top"><span class="lg-mark"></span><b data-noi18n>${T('قص قص', 'QassQass')}</b><span class="ver" dir="ltr">v${esc(GW.version || '2.4')}</span><span class="grow"></span><button class="btn hm-lang" data-noi18n title="Language / اللغة">${GW.lang === 'en' ? 'العربية' : 'English'}</button><button class="btn hm-close">${GW.ico('close', 14)}<span>${T('متابعة إلى المحرر', 'Continue to editor')}</span></button></div>
    <div class="hm-wrap"><div><div class="hm-brand"><img src="img/logo-mark.svg" alt="" class="hm-mark"><h1>${T('ماذا ستصنع اليوم؟', 'What will you make today?')}</h1><p>${T('مونتاج احترافي، كرة أرضية ثلاثية الأبعاد، وحدود أي تاريخ — في مكان واحد.', 'Professional editing, a 3D globe and borders from any date, in one place.')}</p></div>
      <div class="hm-side"><div class="hm-new"><button class="btn pri" data-a="new">${I('plus')}<span>${T('مشروع جديد', 'New project')}</span></button><div class="hm-ar">${ar}</div></div>
        <button class="btn" data-a="open">${I('folderopen')}<span>${T('فتح مشروع…', 'Open project…')}</span></button><button class="btn" data-a="import">${I('import')}<span>${T('استيراد وسائط…', 'Import media…')}</span></button>
        <div class="hm-sep"></div><div class="hm-q">${T('بداية سريعة', 'Quick start')}</div>
        <button class="btn" data-a="map">${I('globe')}<span>${T('مشهد خريطة', 'Map scene')}</span></button><button class="btn" data-a="inv">${I('swords')}<span>${T('غزو سريع على الخريطة', 'Quick invasion on the map')}</span></button><button class="btn" data-a="time">${I('clock')}<span>${T('الحدود عبر الزمن', 'Borders over time')}</span></button>
        <div class="hm-keys"><span>${T('استيراد وسائط', 'Import media')}</span><kbd>Ctrl+I</kbd><span>${T('شفرة / تحديد', 'Blade / select')}</span><kbd>C · V</kbd><span>${T('تشغيل / إيقاف', 'Play / pause')}</span><kbd>Space</kbd><span>${T('تصدير', 'Export')}</span><kbd>Ctrl+M</kbd><span>${T('كل الاختصارات', 'All shortcuts')}</span><kbd>Ctrl+/</kbd></div></div></div>
      <div><div class="hm-sec"><h2>${I('history', 16)}${T('المشاريع الأخيرة', 'Recent projects')}<small>${rec.length ? rec.length + ' ' + T('مشاريع', 'projects') : ''}</small></h2><div class="hm-recent">${rec.length ? rec.map(r => `<div class="hm-r" data-r="${esc(r)}" title="${esc(r)}"><div class="th"><canvas></canvas><i></i></div><div class="cap"><b>${esc(r.split(/[\\/]/).pop().replace(/\.(gwproj|qass)$/i, ''))}</b><span class="when">${esc(r.split(/[\\/]/).slice(-3, -1).join('/'))}</span></div></div>`).join('') : `<div class="hm-empty">${T('لا توجد مشاريع حديثة بعد. ابدأ مشروعًا جديدًا أو افتح ملف <span dir="ltr">.qass</span>', 'No recent projects yet. Start a new project or open a .qass file.')}</div>`}</div></div>
      <div class="hm-sec"><h2>${I('sparkle', 16)}${T('قوالب', 'Templates')}<small>${T('انقر لبدء مشروع جاهز', 'Click to start a ready-made project')}</small></h2><div class="hm-tpl">${TEMPLATES.map(t => `<div class="hm-t" data-t="${t.id}"><canvas width="352" height="198"></canvas><div class="cap"><b>${esc(T(t.n, t.en))}</b><span>${esc(T(t.d, t.den))}</span></div></div>`).join('')}</div></div>
      <div class="hm-grid2"><div class="hm-news"><h3>${I('bell', 16)}${T('ما الجديد', "What's new")}${upd && upd.version ? ` <span class="ver" dir="ltr" style="font:10.5px var(--f-mono);color:var(--mute)">${esc(upd.version)}</span>` : ''}</h3><ul>${newsItems.map(n => `<li>${esc(n)}</li>`).join('')}</ul>${GW.UI.updateNotes ? `<div class="more"><button class="btn sm ghost" data-a="notes">${T('كل الملاحظات…', 'All notes…')}</button></div>` : ''}</div>
      <div class="hm-feat"><div class="hm-f">${I('globe')}<b>${T('كرة أرضية ثلاثية الأبعاد', '3D globe')}</b><p>${T('صور فضائية عالية الدقة وتضاريس مجسّمة وكاميرا سينمائية.', 'High-res satellite imagery, real terrain and a cinematic camera.')}</p></div><div class="hm-f">${I('clock')}<b>${T('حدود أي تاريخ', 'Borders of any date')}</b><p>${T('حدود دقيقة باليوم 1886–2019 وحدود تاريخية حتى 123 ألف سنة ق.م.', 'Day-accurate borders 1886–2019 and historical borders back to 123,000 BC.')}</p></div><div class="hm-f">${I('film')}<b>${T('مونتاج كامل', 'Full editing')}</b><p>${T('مسارات متعددة، تأثيرات، تفريغ وترجمة، مؤثرات صوتية، وتصدير 4K.', 'Multiple tracks, effects, transcription and captions, SFX and 4K export.')}</p></div></div></div></div></div>`;
    document.body.append(el);
    el.querySelectorAll('.hm-t').forEach(d => { const t = TEMPLATES.find(x => x.id === d.dataset.t); const cv = d.querySelector('canvas'); const g = cv.getContext('2d'); try { t.paint(g, cv.width, cv.height); } catch (e) {} });
    el.querySelectorAll('.hm-r canvas').forEach(cv => paintPoster(cv, cv.closest('.hm-r').dataset.r, null));
    loadPosters(el);
    el.querySelector('.hm-close').onclick = close; el.querySelector('.hm-lang').onclick = () => GW.setLang(GW.lang === 'en' ? 'ar' : 'en');
    el.querySelectorAll('[data-ar]').forEach(b => b.onclick = () => { aspect = b.dataset.ar; try { localStorage.setItem('qq.aspect', aspect); } catch (e) {} el.querySelectorAll('[data-ar]').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => { close(); await GW.openProject(b.dataset.r); });
    const cur = () => ASPECTS.find(a => a.id === aspect) || ASPECTS[0];
    el.querySelectorAll('.hm-t').forEach(d => d.onclick = () => { const t = TEMPLATES.find(x => x.id === d.dataset.t); start(t.a || cur(), () => { if (t.ws === 'maps') { GW.setWorkspace('maps'); if (t.inv) { GW.showPanel('maps'); GW.MapUI && GW.MapUI.render(); } else GW.UI.addMapClip && GW.UI.addMapClip(GW.Atlas.newScene()); } else { GW.setWorkspace(t.ws); if (t.ws === 'graphics' && GW.showPanel) GW.showPanel('graphics'); } }); });
    const A = (k, fn) => { const b = el.querySelector(`[data-a=${k}]`); if (b) b.onclick = fn; };
    A('new', () => start(cur())); A('open', async () => { close(); await GW.openProject(); }); A('import', () => { close(); GW.cmd.importMedia(); });
    A('notes', () => GW.UI.updateNotes && GW.UI.updateNotes());
    A('map', () => start(cur(), () => GW.UI.addMapClip(GW.Atlas.newScene())));
    A('inv', () => start(cur(), () => { GW.setWorkspace('maps'); GW.showPanel('maps'); GW.MapUI.render(); }));
    A('time', () => start(cur(), () => { GW.setWorkspace('maps'); GW.showPanel('maps'); (GW.MapUI.secOpen = GW.MapUI.secOpen || {}).qt = true; GW.MapUI.render(); }));
  };
  GW.UI.homePresets = PRESETS;
})();
