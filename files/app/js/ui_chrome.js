'use strict';
/* design v5 — app chrome: top-bar actions (undo/redo/settings/project name), status-bar indicators (save state,
   timeline zoom), panel-header overflow menus + tab icons, delegated tooltips, first-run tips.
   Additive only: wraps GW.setWorkspace, never edits other panels' markup. Strings are bilingual inline (no en.json edits). */
(function () {
  const GW = window.GW; if (!GW) return; GW.UI = GW.UI || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const T = (ar, en) => GW.lang === 'en' ? en : ar;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PANEL_ICO = { project: 'folder', browser: 'drive', source: 'film', program: 'play', timeline: 'scissors', fxc: 'wand', effects: 'sparkle', graphics: 'shapes', lumetri: 'color', scopes: 'scopes', mixer: 'mixer', sfx: 'music', markers: 'marker', history: 'history', maps: 'globe', mapcam: 'camera', captions: 'caption', tts: 'sound', textanim: 'text' };
  GW.PANEL_ICO = PANEL_ICO;

  /* ---- top bar ---- */
  function initTop() {
    const u = $('#btnUndo'), r = $('#btnRedo'), st = $('#btnSettings');
    // static markup is parsed before the EN dictionary loads: translate the few chrome strings here
    if (GW.lang === 'en' && GW.tr) { for (const el of document.querySelectorAll('#menubar [title],#status [title]')) el.title = GW.tr(el.title); const ex = $('#btnExport'); if (ex) ex.textContent = GW.tr(ex.textContent); const sm = $('#stMsg'); if (sm) sm.textContent = GW.tr(sm.textContent); const fw = $('#ffWarn'); if (fw) fw.textContent = GW.tr(fw.textContent); }
    if (u) { u.innerHTML = GW.ico('undo', 16); u.onclick = () => GW.cmd && GW.cmd.undo(); }
    if (r) { r.innerHTML = GW.ico('redo', 16); r.onclick = () => GW.cmd && GW.cmd.redo(); }
    if (st) {
      st.innerHTML = GW.ico('settings', 16);
      st.onclick = () => {
        const b = st.getBoundingClientRect();
        const items = [
          { label: T('الشاشة الرئيسية', 'Home screen'), action: () => GW.UI.home && GW.UI.home() },
          { label: T('اختصارات لوحة المفاتيح', 'Keyboard shortcuts'), key: 'Ctrl+/', action: () => GW.cmd.shortcuts() },
          '-',
          { label: GW.lang === 'en' ? 'العربية' : 'English', action: () => GW.setLang(GW.lang === 'en' ? 'ar' : 'en') },
          { label: T('إعادة ضبط مساحة العمل', 'Reset workspace'), action: () => { try { localStorage.removeItem('gws.layout.' + GW.active.ws); } catch (e) {} GW.setWorkspace(GW.active.ws); } },
          { label: T('نصائح البدء', 'Getting-started tips'), action: () => GW.UI.tips(true) },
          '-',
          ...(GW.UI.checkUpdates ? [{ label: T('التحقق من التحديثات…', 'Check for updates…'), action: () => GW.UI.checkUpdates() }] : []),
          { label: T('حول قص قص', 'About QassQass'), action: () => GW.cmd.about() }
        ];
        const m = GW.menu(b.left, b.bottom + 6, items);
        m.style.left = (GW.lang === 'en' ? Math.min(innerWidth - m.offsetWidth - 6, b.right - m.offsetWidth) : Math.max(6, b.left)) + 'px';
      };
    }
    const upd = () => {
      const n = $('#prjName'); if (n) { const dirty = GW.hist && GW.hist.stack[GW.hist.idx] !== GW.hist.saved; n.textContent = (GW.prj && GW.prj.name) || T('مشروع بلا اسم', 'Untitled project'); n.classList.toggle('dirty', !!dirty); }
      if (u) u.disabled = !(GW.hist && GW.hist.idx > 0); if (r) r.disabled = !(GW.hist && GW.hist.idx < GW.hist.stack.length - 1);
      const sv = $('#stSave'); if (sv) { const dirty = GW.hist && GW.hist.stack[GW.hist.idx] !== GW.hist.saved; sv.innerHTML = `<i class="dot ${dirty ? 'warn' : 'ok'}"></i>${dirty ? T('تغييرات غير محفوظة', 'Unsaved changes') : T('محفوظ', 'Saved')}`; }
      const z = $('#stZoom'); if (z && GW.TL && GW.TL.pps) { const p = GW.TL.pps(); z.innerHTML = `${GW.ico('zoom', 12)}<span dir="ltr">${p >= 1000 ? (p / 1000).toFixed(1) + 'k' : Math.round(p)} px/s</span>`; }
    };
    // live UI frame rate (rAF count per second; cheap, no layout reads)
    const fpsEl = $('#stFps'); if (fpsEl) { let n = 0, t0 = performance.now(); const tick = (t) => { n++; if (t - t0 >= 1000) { const f = Math.round(n * 1000 / (t - t0)); fpsEl.innerHTML = `<i class="dot ${f >= 50 ? 'ok' : f >= 25 ? '' : 'warn'}"></i><span dir="ltr">${f} fps</span>`; n = 0; t0 = t; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    ['project', 'changed', 'layout', 'panel-shown'].forEach(ev => GW.bus.on(ev, upd));
    setInterval(upd, 1500); upd();
  }

  /* ---- panel headers: icons on tabs + overflow menu ---- */
  function decorate() {
    document.querySelectorAll('.frame>.tabs').forEach(tabs => {
      tabs.querySelectorAll('.tab').forEach(b => { if (!b.querySelector('svg') && PANEL_ICO[b.dataset.p]) b.insertAdjacentHTML('afterbegin', GW.ico(PANEL_ICO[b.dataset.p], 14, 'tab-ico')); });
      if (!tabs.querySelector('.tab-more')) {
        const mb = document.createElement('button'); mb.className = 'tab-more'; mb.title = T('خيارات اللوحة', 'Panel options'); mb.innerHTML = GW.ico('more', 14);
        mb.onclick = (e) => {
          e.stopPropagation(); const r = mb.getBoundingClientRect(); const fr = tabs.parentElement;
          const open = ['project', 'browser', 'source', 'program', 'timeline', 'fxc', 'effects', 'graphics', 'lumetri', 'scopes', 'mixer', 'sfx', 'markers', 'history', 'maps', 'mapcam'].filter(id => GW.panels[id]).map(id => ({ label: GW.panels[id].title, action: () => GW.showPanel(id) }));
          const m = GW.menu(r.left, r.bottom + 4, [
            { label: fr.classList.contains('max') ? T('استعادة حجم اللوحة', 'Restore panel size') : T('تكبير اللوحة', 'Maximize panel'), key: '`', action: () => GW.UI.togglePanelMax(fr) },
            '-', { label: T('فتح لوحة', 'Open panel'), sub: open }, '-',
            { label: T('إعادة ضبط مساحة العمل', 'Reset workspace'), action: () => { try { localStorage.removeItem('gws.layout.' + GW.active.ws); } catch (e) {} GW.setWorkspace(GW.active.ws); } }
          ]);
          m.style.left = Math.max(6, Math.min(innerWidth - m.offsetWidth - 6, GW.lang === 'en' ? r.right - m.offsetWidth : r.left)) + 'px';
        };
        tabs.append(mb);
      }
    });
  }
  GW.UI.togglePanelMax = (fr) => { fr.classList.toggle('max'); if (GW.toggleMax) GW.toggleMax(fr); else GW.bus.emit('layout'); GW.invalidate && GW.invalidate(); };
  const orig = GW.setWorkspace; GW.setWorkspace = function (ws) { const r = orig.apply(this, arguments); try { decorate(); } catch (e) {} return r; };

  /* ---- context menus: icon column (matched by label, AR/EN) ---- */
  const MENU_ICO = [[/^(مشروع جديد|new project)/i, 'plusbox'], [/^(فتح|open)/i, 'folderopen'], [/^(حفظ|save)/i, 'save'], [/^(استيراد|import)/i, 'import'], [/^(تصدير|export)/i, 'export'], [/^(تراجع|undo)/i, 'undo'], [/^(إعادة|redo)/i, 'redo'], [/^(حذف|delete|إزالة|remove|مسح|clear)/i, 'trash'], [/^(قص|cut)/i, 'scissors'], [/^(نسخ|copy|تكرار|duplicate)/i, 'copy'], [/(علامة|marker)/i, 'marker'], [/^(الشاشة الرئيسية|home)/i, 'grid'], [/(اختصارات|shortcuts)/i, 'settings'], [/(تحديث|update)/i, 'bell'], [/(خريطة|خرائط|map)/i, 'globe'], [/^(نص|text|عنوان|title)/i, 'text'], [/(صوت|audio|voice)/i, 'sound'], [/(ترجمة|caption|subtitle)/i, 'caption'], [/(تأثير|effect)/i, 'wand'], [/(تسلسل|sequence)/i, 'film'], [/(مساحة العمل|workspace|لوحة|panel|نافذة|window)/i, 'layers'], [/(حول|about|مساعدة|help)/i, 'sparkle'], [/(إطار|frame|صورة مصغرة|thumbnail)/i, 'image'], [/(شكل|shape)/i, 'shapes'], [/(لون|color|ألوان)/i, 'color']];
  function menuIcons(m) {
    m.querySelectorAll('.ctx-i').forEach(b => {
      if (b.querySelector('.mi')) return; const span = b.querySelector('span'); const label = span ? span.textContent.trim() : ''; const hit = MENU_ICO.find(r => r[0].test(label));
      if (hit && !b.querySelector('i')) b.insertAdjacentHTML('afterbegin', GW.ico(hit[1], 14, 'mi'));
    });
  }
  for (const k of ['menu', 'subMenu']) { const o = GW[k]; if (typeof o === 'function') GW[k] = function () { const m = o.apply(this, arguments); try { if (m) menuIcons(m); } catch (e) {} return m; }; }

  /* ---- tooltips: one delegated popover for every [title] (native tooltip suppressed) ---- */
  let tipEl = null, tipT = 0, tipFor = null;
  const showTip = (el) => {
    const txt = el.dataset.tip; if (!txt) return;
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.append(tipEl); }
    const m = /^(.*?)\s*\(([^()]{1,24})\)\s*$/.exec(txt); // "label (Ctrl+M)" → label + kbd
    tipEl.innerHTML = m ? `${esc(m[1])}<kbd>${esc(m[2])}</kbd>` : esc(txt);
    tipEl.style.display = 'block'; const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8; if (y + h > innerHeight - 4) y = r.top - h - 8;
    x = Math.max(6, Math.min(innerWidth - w - 6, x)); tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px'; tipEl.classList.add('on'); tipFor = el;
  };
  const hideTip = () => { clearTimeout(tipT); if (tipEl) { tipEl.classList.remove('on'); tipEl.style.display = 'none'; } tipFor = null; };
  document.addEventListener('pointerover', e => {
    const el = e.target.closest ? e.target.closest('[title],[data-tip]') : null; if (!el || el.closest('.ctx')) return;
    if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); }
    if (tipFor === el) return; clearTimeout(tipT); tipT = setTimeout(() => showTip(el), 450);
  }, true);
  document.addEventListener('pointerout', e => { const el = e.target.closest ? e.target.closest('[data-tip]') : null; if (el && !el.contains(e.relatedTarget)) { hideTip(); if (!el.hasAttribute('title')) el.setAttribute('title', el.dataset.tip); } }, true);
  document.addEventListener('pointerdown', hideTip, true); document.addEventListener('keydown', hideTip, true); window.addEventListener('blur', hideTip);

  /* ---- first-run tips ---- */
  const TIPS = [
    ['import', 'اسحب الفيديو والصوت إلى لوحة المشروع، أو اضغط Ctrl+I للاستيراد.', 'Drag video and audio into the Project panel, or press Ctrl+I to import.'],
    ['scissors', 'C للشفرة، V للتحديد، مسافة للتشغيل. اسحب حواف المقاطع لقصّها.', 'C for the blade, V for select, Space to play. Drag clip edges to trim.'],
    ['globe', 'من مساحة «الخرائط» أضف مشهد كرة أرضية بحدود أي تاريخ.', 'From the Maps workspace add a 3D globe scene with borders from any date.'],
    ['wand', 'الساعة ⏱ بجانب أي خاصية تُفعّل الإطارات المفتاحية.', 'The stopwatch next to any property turns on keyframes.']
  ];
  GW.UI.tips = (force) => {
    try { if (!force && localStorage.getItem('qq.tips')) return; } catch (e) {}
    const old = $('.tips'); if (old) old.remove();
    const el = document.createElement('div'); el.className = 'tips'; el.dir = GW.lang === 'en' ? 'ltr' : 'rtl'; let i = 0;
    const paint = () => { const t = TIPS[i]; el.innerHTML = `<div class="tips-ico">${GW.ico(t[0], 20)}</div><div class="tips-b"><b>${T('نصيحة', 'Tip')} ${i + 1}/${TIPS.length}</b><p>${esc(T(t[1], t[2]))}</p></div><div class="tips-a"><button class="btn sm ghost" data-a="next">${i < TIPS.length - 1 ? T('التالي', 'Next') : T('إغلاق', 'Close')}</button><button class="btn sm ghost ico" data-a="x" title="${T('إغلاق', 'Close')}">${GW.ico('close', 13)}</button></div>`; };
    const done = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 200); try { localStorage.setItem('qq.tips', '1'); } catch (e) {} };
    el.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'x' || i >= TIPS.length - 1) return done(); i++; paint(); });
    paint(); document.body.append(el); requestAnimationFrame(() => el.classList.add('on'));
  };

  document.addEventListener('DOMContentLoaded', () => {
    initTop(); decorate();
    if (window.gws && !gws.test) setTimeout(() => GW.UI.tips(), 2500);
  });
  if (document.readyState !== 'loading') { initTop(); decorate(); }
})();
