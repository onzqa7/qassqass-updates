'use strict';
/* In-app updates (renderer side). Main-process logic: updater.js / bootstrap.js.
   - auto-check ~10 s after start (silent when offline / no feed), then every 6 h
   - unobtrusive banner: "تحديث جديد متاح X — تنزيل" → progress → "إعادة التشغيل للتحديث"
   - GW.UI.checkUpdates() (manual, with feedback) + an item appended to the Help menu */
(function () {
  const GW = window.GW; if (!GW || !window.gws || !gws.updStatus) return;
  GW.UI = GW.UI || {};
  const AUTO_DELAY = 10000, RECHECK = 6 * 3600e3;
  const esc = (s) => GW.esc ? GW.esc(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k) => { try { GW.toast(m, k); } catch (e) {} };
  const mb = (n) => n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب';
  const st = { info: null, phase: 'idle', dismissed: null, busy: false };
  GW.UI.updState = st;

  /* ---- banner ---- */
  const css = document.createElement('style');
  css.textContent = `
.upd-bn{position:fixed;left:12px;bottom:30px;z-index:250;direction:rtl;display:flex;align-items:center;gap:8px;max-width:min(520px,calc(100% - 24px));
  background:#1f2227;border:1px solid #3a3e46;border-inline-start:3px solid var(--blue,#2f8ef0);border-radius:8px;padding:6px 8px 6px 10px;box-shadow:0 6px 24px #0009;font-size:12px;color:var(--text,#ddd)}
.upd-bn[hidden]{display:none}
.upd-bn .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.upd-bn .t small{opacity:.7;margin-inline-start:6px}
.upd-bn .btn{height:22px;padding:0 9px}
.upd-bn .x{background:none;border:0;color:inherit;opacity:.6;cursor:pointer;font-size:12px;padding:0 3px}.upd-bn .x:hover{opacity:1}
.upd-bn .bar{width:120px;height:5px;background:#33373e;border-radius:3px;overflow:hidden;flex:none}
.upd-bn .bar i{display:block;height:100%;width:0;background:var(--blue,#2f8ef0);transition:width .15s}
.upd-bn.err{border-inline-start-color:var(--red,#e5484d)}
.upd-notes{white-space:pre-wrap;line-height:1.6;max-height:300px;overflow:auto;background:var(--bg1,#1d1d1d);border:1px solid var(--line2,#333);border-radius:4px;padding:8px 10px;margin-top:8px;user-select:text}`;
  document.head.append(css);
  const bn = document.createElement('div'); bn.className = 'upd-bn'; bn.id = 'updBanner'; bn.hidden = true; bn.setAttribute('role', 'status');
  const mount = () => { if (!bn.isConnected) document.body.append(bn); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  function render() {
    const i = st.info || {}; const v = `<bdi>${esc(i.version || '')}</bdi>`;
    bn.classList.remove('err');
    if (st.phase === 'available') {
      if (i.needsFull) bn.innerHTML = `<span class="t">إصدار جديد ${v} يتطلب تنزيل المثبّت الكامل</span>${i.fullUrl ? '<button class="btn pri" data-a="full">تنزيل</button>' : ''}<button class="btn ghost" data-a="notes">ما الجديد</button><button class="x" data-a="x" title="إخفاء">✕</button>`;
      else bn.innerHTML = `<span class="t">تحديث جديد متاح ${v}${i.bytes ? `<small>· ${mb(i.bytes)}</small>` : ''}</span><button class="btn pri" data-a="dl">تنزيل</button><button class="btn ghost" data-a="notes">ما الجديد</button><button class="x" data-a="x" title="لاحقًا">✕</button>`;
    } else if (st.phase === 'download') {
      const p = st.prog || {}; const pct = p.total ? Math.min(100, Math.round(100 * p.done / p.total)) : 0;
      const what = p.phase === 'verify' ? 'جارٍ التحقق من التحديث…' : p.phase === 'prepare' ? 'جارٍ تجهيز التحديث…' : `جارٍ تنزيل التحديث ${v}… ${pct}%` + (p.total ? `<small>· <bdi>${mb(p.done || 0)} / ${mb(p.total)}</bdi></small>` : '');
      bn.innerHTML = `<span class="t">${what}</span><span class="bar"><i style="width:${p.phase === 'verify' ? 100 : pct}%"></i></span>`;
    } else if (st.phase === 'ready') {
      bn.innerHTML = `<span class="t">التحديث ${v} جاهز</span><button class="btn pri" data-a="restart">إعادة التشغيل للتحديث</button><button class="x" data-a="x" title="لاحقًا (يُطبَّق عند التشغيل التالي)">✕</button>`;
    } else if (st.phase === 'error') {
      bn.classList.add('err');
      bn.innerHTML = `<span class="t">تعذّر تنزيل التحديث ${v}</span><button class="btn" data-a="dl">إعادة المحاولة</button><button class="x" data-a="x" title="إخفاء">✕</button>`;
    }
    bn.hidden = st.phase === 'idle' || st.dismissed === st.phase + ':' + (i.version || '');
    if (!bn.hidden) mount();
  }
  bn.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const k = a.dataset.a;
    if (k === 'dl') download();
    else if (k === 'restart') restart();
    else if (k === 'notes') notes();
    else if (k === 'full') { if (st.info && st.info.fullUrl) gws.updOpenFull(st.info.fullUrl); }
    else if (k === 'x') { st.dismissed = st.phase + ':' + ((st.info && st.info.version) || ''); render(); }
  });

  function notes() {
    const i = st.info || {}; if (!i.version) return;
    const n = i.notes_ar || i.notes_en || '';
    const size = i.needsFull ? 'يتطلب هذا الإصدار تنزيل المثبّت الكامل.' : (i.bytes != null ? `حجم التنزيل: ${mb(i.bytes)} (${i.files} من ${i.totalFiles} ملفًا)` : '');
    const body = `<p>الإصدار الحالي: <b>${esc(i.current || GW.version || '')}</b> — الإصدار الجديد: <b>${esc(i.version)}</b>${i.date ? ` (${esc(String(i.date).slice(0, 10))})` : ''}</p>${size ? `<p style="opacity:.75">${esc(size)}</p>` : ''}${n ? `<div class="upd-notes" dir="auto">${esc(n)}</div>` : ''}`;
    const buttons = [{ label: 'لاحقًا', value: null }];
    if (i.needsFull) { if (i.fullUrl) buttons.push({ label: 'تنزيل المثبّت', primary: true, action: () => { gws.updOpenFull(i.fullUrl); } }); }
    else if (st.phase === 'ready') buttons.push({ label: 'إعادة التشغيل للتحديث', primary: true, action: () => { restart(); } });
    else if (st.phase !== 'download') buttons.push({ label: 'تنزيل التحديث', primary: true, action: () => { download(); } });
    GW.modal({ title: 'تحديث قص قص', body, buttons, width: 520 });
  }

  async function check(manual) {
    if (st.busy && !manual) return null;
    let r; try { r = await gws.updCheck(); } catch (e) { r = { ok: false, error: String(e) }; }
    if (!r || !r.ok) {
      if (manual) toast(r && r.error === 'not-configured' ? 'خادم التحديثات غير مضبوط' : 'تعذّر الاتصال بخادم التحديثات — تحقّق من الاتصال بالإنترنت', 'err');
      return r;
    }
    if (!r.available) { if (manual) toast(`أنت تستخدم أحدث إصدار (${r.current})`); return r; }
    st.info = r;
    if (st.phase !== 'download') st.phase = r.staged ? 'ready' : 'available';
    if (manual) st.dismissed = null;
    render();
    if (manual && st.phase === 'available') notes();
    return r;
  }
  async function download() {
    if (st.busy) return; st.busy = true; st.phase = 'download'; st.prog = { phase: 'prepare' }; st.dismissed = null; render();
    let r; try { r = await gws.updDownload(); } catch (e) { r = { ok: false, error: String(e) }; }
    st.busy = false;
    if (r && r.ok && r.upToDate) { st.phase = 'idle'; render(); return r; }
    if (r && r.needsFull) { st.info = Object.assign(st.info || {}, { needsFull: true, fullUrl: r.fullUrl }); st.phase = 'available'; render(); return r; }
    if (!r || !r.ok) { st.phase = 'error'; render(); console.warn('update download failed:', r && r.error); return r; }
    st.info = Object.assign(st.info || {}, { version: r.version }); st.phase = 'ready'; render();
    return r;
  }
  async function restart() {
    const ok = await gws.updRestart().catch(() => false);
    if (!ok) toast('لا يوجد تحديث جاهز للتطبيق', 'err');
  }
  gws.onUpdProgress((p) => {
    if (!p) return;
    if (p.phase === 'ready') { st.info = Object.assign(st.info || {}, { version: p.version }); st.phase = 'ready'; }
    else if (p.phase === 'error') { if (st.phase === 'download') st.phase = 'error'; }
    else { st.phase = 'download'; st.prog = p; if (p.version) st.info = Object.assign(st.info || {}, { version: p.version }); }
    render();
  });

  GW.UI.checkUpdates = () => check(true);
  GW.UI.downloadUpdate = download;
  GW.UI.restartToUpdate = restart;
  GW.UI.updateNotes = notes;

  // Help menu item (GW.MENUS is built by app.js before boot.js wires the menu bar)
  try {
    const help = (GW.MENUS || []).find(m => m[0] === 'مساعدة');
    if (help && typeof help[1] === 'function') {
      const orig = help[1];
      help[1] = () => {
        const items = orig(); const it = { label: 'التحقق من وجود تحديثات…', action: () => GW.UI.checkUpdates() };
        if (st.phase === 'ready') it.label = 'إعادة التشغيل لتطبيق التحديث ' + ((st.info && st.info.version) || '');
        if (st.phase === 'ready') it.action = restart;
        const at = items.length ? items.length - 1 : 0;   // before "حول قص قص"
        items.splice(at, 0, it);
        return items;
      };
    }
  } catch (e) { console.warn(e); }

  // start-up: report a rollback / a just-applied update, restore a staged one, then auto-check
  setTimeout(async () => {
    let s = null; try { s = await gws.updStatus(); } catch (e) {}
    if (!s) return;
    // shown after the editor has settled so it is not lost during start-up
    if (s.rolledBack && s.rolledBack.version) setTimeout(() => toast(`تعذّر تشغيل التحديث ${s.rolledBack.version}، فتمت العودة إلى الإصدار ${s.version}`, 'err'), 1500);
    else if (s.applied && s.runningUpdate) setTimeout(() => toast(`تم التحديث إلى الإصدار ${s.version}`), 1500);
    if (s.staged) { st.info = Object.assign(st.info || {}, { version: s.staged }); st.phase = 'ready'; render(); }
    if (s.autoCheck === false) return;
    const auto = () => { if (navigator.onLine === false) return; check(false).catch(() => {}); };
    setTimeout(auto, AUTO_DELAY);
    setInterval(auto, RECHECK);
  }, 0);
})();
