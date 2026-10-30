'use strict';
/* Home screen (Premiere-style start page): new project presets, recent projects, quick starts */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const I = (n) => GW.ico(n, 18);
  const PRESETS = [
    { n: 'يوتيوب 1080p', d: '1920×1080 · 30', w: 1920, h: 1080, fps: 30 },
    { n: 'سينمائي 4K', d: '3840×2160 · 25', w: 3840, h: 2160, fps: 25 },
    { n: 'ريلز / شورتس / تيك توك', d: '1080×1920 · 30', w: 1080, h: 1920, fps: 30 },
    { n: 'مربع (إنستغرام)', d: '1080×1080 · 30', w: 1080, h: 1080, fps: 30 },
  ];
  async function start(p, then) {
    close(); await GW.newProjectCmd(); const s = GW.seq(); s.w = p.w; s.h = p.h; s.fps = p.fps; GW.hist.reset('مشروع جديد'); GW.bus.emit('project'); GW.invalidate();
    if (then) setTimeout(then, 50);
  }
  function close() { const el = document.getElementById('home'); if (el) el.remove(); }
  GW.UI.home = () => {
    close(); const el = document.createElement('div'); el.id = 'home'; el.dir = 'rtl';
    const rec = (GW.recent ? GW.recent() : []).slice(0, 8);
    el.innerHTML = `<button class="btn hm-lang" data-noi18n title="Language / اللغة">${GW.lang === 'en' ? 'العربية' : 'English'}</button><button class="btn hm-close">${GW.ico('close', 14)}<span>متابعة إلى المحرر</span></button><div class="hm-wrap"><div><div class="hm-brand"><img src="img/logo-full.png" alt="قص قص" class="hm-logo"><p>مونتاج احترافي · خرائط حربية وتاريخية</p></div>
      <div class="hm-side"><button class="btn pri" data-a="new">${I('plus')}<span>مشروع جديد</span></button><button class="btn" data-a="open">${I('folder')}<span>فتح مشروع…</span></button><button class="btn" data-a="import">${I('import')}<span>استيراد وسائط…</span></button><div class="hm-sep"></div><button class="btn" data-a="map">${I('globe')}<span>مشهد خريطة</span></button><button class="btn" data-a="inv">${I('swords')}<span>غزو سريع على الخريطة</span></button><button class="btn" data-a="time">${I('clock')}<span>الحدود عبر الزمن</span></button></div></div>
      <div><h2>ابدأ مشروعاً جديداً</h2><div class="hm-presets">${PRESETS.map((p, i) => { const r = p.w / p.h; const fw = r >= 1 ? 74 : Math.round(74 * r * 1.0), fh = r >= 1 ? Math.round(74 / r) : 74; return `<div class="hm-p" data-p="${i}"><div class="fr" style="width:${fw}px;height:${fh}px"></div><b>${esc(p.n)}</b><span>${esc(p.d)}</span></div>`; }).join('')}</div>
      <h2>المشاريع الأخيرة</h2><div class="hm-recent">${rec.length ? rec.map(r => `<div class="hm-r" data-r="${esc(r)}"><b>${esc(r.split(/[\\/]/).pop())}</b><span>${esc(r)}</span></div>`).join('') : '<div class="mp-note">لا توجد مشاريع حديثة بعد.</div>'}</div>
      <div class="hm-feat"><div class="hm-f">${I('globe')}<b>كرة أرضية ثلاثية الأبعاد</b><p>صور فضائية عالية الدقة، تضاريس مجسّمة، وكاميرا سينمائية حتى مستوى الشوارع.</p></div><div class="hm-f">${I('clock')}<b>حدود أي تاريخ</b><p>حدود دقيقة باليوم 1886–2019، وحدود تاريخية حتى 123 ألف سنة ق.م.</p></div><div class="hm-f">${I('film')}<b>مونتاج كامل</b><p>مسارات متعددة، تأثيرات وانتقالات، تفريغ وترجمة، مؤثرات صوتية، وتصدير 4K.</p></div></div></div></div>`;
    document.body.append(el);
    el.querySelector('.hm-close').onclick = close; el.querySelector('.hm-lang').onclick = () => GW.setLang(GW.lang === 'en' ? 'ar' : 'en');
    el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => start(PRESETS[+b.dataset.p]));
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => { close(); await GW.openProject(b.dataset.r); });
    const A = (k, fn) => { const b = el.querySelector(`[data-a=${k}]`); if (b) b.onclick = fn; };
    A('new', () => start(PRESETS[0])); A('open', async () => { close(); await GW.openProject(); }); A('import', () => { close(); GW.cmd.importMedia(); });
    A('map', () => start(PRESETS[0], () => GW.UI.addMapClip(GW.Atlas.newScene())));
    A('inv', () => start(PRESETS[0], () => { GW.setWorkspace('maps'); GW.showPanel('maps'); GW.MapUI.render(); }));
    A('time', () => start(PRESETS[0], () => { GW.setWorkspace('maps'); GW.showPanel('maps'); (GW.MapUI.secOpen = GW.MapUI.secOpen || {}).qt = true; GW.MapUI.render(); }));
  };
})();
