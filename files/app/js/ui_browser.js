'use strict';
/* Media browser (مستعرض الوسائط): browse disk folders through gws.listDir, thumbnails, drag to the timeline / project panel.
   Dropped or double-clicked files are imported into the project (into the open bin) and placed on the timeline. */
(function () {
  const { esc } = GW; const BR = GW.Browser = {};
  let dir = null, parent = null, entries = [], loading = false, onlyMedia = true, filter = '', view = 'grid', err = '';
  try { dir = localStorage.getItem('gws.browserDir') || null; view = localStorage.getItem('gws.browserView') || 'grid'; } catch (e) {}
  const EXT = /\.(mp4|mov|mkv|webm|avi|m4v|mts|m2ts|mxf|mp3|wav|m4a|aac|ogg|flac|opus|aiff?|png|jpe?g|webp|gif|bmp|tiff?|avif|svg)$/i;
  const fmtSize = n => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';
  GW.registerPanel('browser', 'مستعرض الوسائط', (el) => {
    el.innerHTML = `<div class="ptool" dir="rtl">
      <button class="btn sm ico ghost" data-a="up" title="المجلد الأعلى">${GW.ico('up', 14)}</button>
      <button class="btn sm ico ghost" data-a="roots" title="الأقراص / المنزل">${GW.ico('drive', 14)}</button>
      <button class="btn sm ico ghost" data-a="pick" title="اختيار مجلد…">${GW.ico('folderopen', 14)}</button>
      <span class="grow" data-a="path" style="color:var(--mute);font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" dir="ltr"></span>
      <label style="display:flex;gap:4px;align-items:center;font-size:11px;white-space:nowrap"><input type="checkbox" data-a="media" checked> وسائط فقط</label>
      <input class="inp" data-a="q" placeholder="تصفية…" style="width:90px">
      <button class="btn sm ico ghost" data-a="list" title="عرض قائمة">${GW.ico('menu', 14)}</button>
      <button class="btn sm ico ghost" data-a="grid" title="عرض مصغرات">${GW.ico('grid', 14)}</button>
    </div><div class="pscroll" data-a="body" tabindex="0"></div>`;
    BR.el = el;
    el.querySelector('[data-a=up]').onclick = () => { if (parent) BR.go(parent); };
    el.querySelector('[data-a=roots]').onclick = async (e) => { if (!window.gws || !gws.fsRoots) return; const roots = await gws.fsRoots(); const r = e.currentTarget.getBoundingClientRect(); GW.menu(r.right, r.bottom + 2, roots.map(x => ({ label: x.name, action: () => BR.go(x.path) }))); };
    el.querySelector('[data-a=pick]').onclick = async () => { if (!window.gws) return; const f = await gws.open({ folder: 1, title: 'اختيار مجلد' }); if (f.length) BR.go(f[0].path); };
    el.querySelector('[data-a=media]').onchange = (e) => { onlyMedia = e.target.checked; render(); };
    el.querySelector('[data-a=q]').oninput = (e) => { filter = e.target.value.trim().toLowerCase(); render(); };
    el.querySelector('[data-a=list]').onclick = () => { view = 'list'; try { localStorage.setItem('gws.browserView', view); } catch (e) {} render(); };
    el.querySelector('[data-a=grid]').onclick = () => { view = 'grid'; try { localStorage.setItem('gws.browserView', view); } catch (e) {} render(); };
    const body = el.querySelector('[data-a=body]');
    body.addEventListener('contextmenu', e => { if (e.target.closest('[data-path]')) return; GW.menu(e.clientX, e.clientY, [{ label: 'تحديث', action: () => BR.go(dir) }, { label: 'استيراد كل وسائط المجلد', action: () => BR.importPaths(entries.filter(x => !x.dir && EXT.test(x.name)).map(x => x.path)) }]); });
    BR.go(dir);
  });
  BR.go = async (d) => {
    if (!window.gws || !gws.listDir) { err = 'استعراض الملفات متاح في نسخة سطح المكتب'; entries = []; render(); return; }
    loading = true; render();
    try { const r = await gws.listDir(d || null); dir = r.dir; parent = r.parent; entries = r.entries || []; err = r.error || ''; try { localStorage.setItem('gws.browserDir', dir); } catch (e) {} }
    catch (e) { err = e.message; entries = []; }
    loading = false; render();
  };
  BR.dir = () => dir; BR.entries = () => entries;
  BR.importPaths = async (paths) => { // → media list (already-imported paths are reused)
    const have = new Map(GW.prj.media.filter(m => m.path).map(m => [m.path, m])); const files = paths.filter(p => !have.has(p)).map(p => ({ path: p, name: p.split(/[\\/]/).pop(), size: (entries.find(x => x.path === p) || {}).size || 0 }));
    if (files.length) await GW.Media.importFiles(files);
    return paths.map(p => GW.prj.media.find(m => m.path === p)).filter(Boolean);
  };
  BR.dropToTimeline = async (paths, t, row, mode) => {
    const ms = await BR.importPaths(paths); if (!ms.length) return;
    const ready = async (m) => { const t0 = performance.now(); while (!(m.offline || m.dur || m.kind === 'image') && performance.now() - t0 < 20000) await GW.sleep(120); };
    for (const m of ms) await ready(m);
    GW.TL.insertMedia(ms.filter(m => !m.offline), t, mode || 'overwrite', { row }); GW.toast('تمت إضافة ' + ms.length + ' ملف إلى الخط الزمني');
  };
  function render() {
    const el = BR.el; if (!el) return; const body = el.querySelector('[data-a=body]'); el.querySelector('[data-a=path]').textContent = dir || '';
    el.querySelector('[data-a=up]').disabled = !parent; body.innerHTML = '';
    if (err) { body.innerHTML = `<div class="empty">${esc(err)}</div>`; return; }
    if (loading && !entries.length) { body.innerHTML = '<div class="empty">جارٍ القراءة…</div>'; return; }
    const list = entries.filter(x => (x.dir || !onlyMedia || EXT.test(x.name)) && (!filter || x.name.toLowerCase().includes(filter)));
    if (!list.length) { body.innerHTML = '<div class="empty">لا توجد وسائط في هذا المجلد.</div>'; return; }
    const have = new Set(GW.prj.media.map(m => m.path).filter(Boolean));
    if (view === 'grid') {
      const g = document.createElement('div'); g.className = 'proj-grid'; body.append(g);
      for (const x of list) { const d = document.createElement('div'); d.className = 'gitem'; d.dataset.path = x.path; d.draggable = !x.dir; const kind = x.dir ? 'dir' : GW.mediaKind(x.name); d.innerHTML = `<div class="th">${x.dir ? GW.ico('folder', 40) : kind === 'audio' ? GW.ICON.audio : ''}<i>${x.dir ? '' : esc(fmtSize(x.size))}</i></div><div class="cap">${have.has(x.path) ? `<span class="chipc" style="width:8px;height:8px;border-radius:50%;background:var(--accent)" title="مستورد في المشروع"></span>` : ''}<span>${esc(x.name)}</span></div>`; if (!x.dir && kind !== 'audio') thumb(d.querySelector('.th'), x, kind); bind(d, x); g.append(d); }
      return;
    }
    const L = document.createElement('div'); L.className = 'proj-list'; L.innerHTML = '<div class="proj-head"><span>الاسم</span><span>الحجم</span><span>النوع</span><span></span></div>'; body.append(L);
    for (const x of list) { const d = document.createElement('div'); d.className = 'pitem'; d.dataset.path = x.path; d.draggable = !x.dir; const kind = x.dir ? 'dir' : GW.mediaKind(x.name); d.innerHTML = `<div class="nm">${x.dir ? GW.ico('folder', 15) : (GW.ICON[kind] || GW.ICON.video)}<span>${esc(x.name)}</span>${have.has(x.path) ? '<small class="st" style="color:var(--accent)">في المشروع</small>' : ''}</div><span class="kv">${x.dir ? '—' : esc(fmtSize(x.size))}</span><span class="kv">${x.dir ? 'مجلد' : esc(GW.KIND_NAME[kind] || kind)}</span><span class="kv"></span>`; d.querySelector('svg').style.cssText = 'width:15px;height:15px;color:var(--text2)'; bind(d, x); L.append(d); }
  }
  const thumbQ = []; let thumbBusy = 0;
  function thumb(th, x, kind) {
    const url = window.gws ? gws.mediaUrl(x.path) : null; if (!url) return;
    if (kind === 'image') { const im = new Image(); im.loading = 'lazy'; im.src = url; im.onload = () => th.prepend(im); return; }
    if (kind !== 'video') return;
    thumbQ.push(() => new Promise(res => { // sequential poster grabs: one <video> at a time
      const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url; let done = false; const fin = () => { if (done) return; done = true; v.src = ''; res(); };
      const tm = setTimeout(fin, 6000);
      v.onloadedmetadata = () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) { fin(); } };
      v.onseeked = () => { try { const c = document.createElement('canvas'); c.width = 160; c.height = Math.max(1, Math.round(160 * v.videoHeight / Math.max(1, v.videoWidth))); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); if (th.isConnected) th.prepend(c); } catch (e) {} clearTimeout(tm); fin(); };
      v.onerror = () => { clearTimeout(tm); fin(); };
    }));
    pump();
  }
  async function pump() { if (thumbBusy || !thumbQ.length) return; thumbBusy = 1; while (thumbQ.length) { try { await thumbQ.shift()(); } catch (e) {} } thumbBusy = 0; }
  function bind(d, x) {
    d.addEventListener('dblclick', () => { if (x.dir) BR.go(x.path); else BR.importPaths([x.path]).then(ms => { if (ms[0] && GW.Source) GW.Source.load(ms[0]); GW.toast('تم استيراد ' + x.name); }); });
    d.addEventListener('dragstart', e => { const sel = [x.path]; e.dataTransfer.setData('application/x-gws-files', JSON.stringify(sel)); e.dataTransfer.effectAllowed = 'copy'; });
    d.addEventListener('contextmenu', e => {
      e.preventDefault(); const items = [];
      if (x.dir) items.push({ label: 'فتح', action: () => BR.go(x.path) }, { label: 'استيراد كل وسائط المجلد', action: async () => { const r = await gws.listDir(x.path); BR.importPaths((r.entries || []).filter(y => !y.dir && EXT.test(y.name)).map(y => y.path)); } });
      else items.push({ label: 'استيراد إلى المشروع', action: () => BR.importPaths([x.path]) }, { label: 'إدراج في التسلسل عند المؤشر', action: () => BR.dropToTimeline([x.path], GW.seq().t, null, 'overwrite') }, { label: 'فتح في شاشة المصدر', action: () => BR.importPaths([x.path]).then(ms => ms[0] && GW.Source && GW.Source.load(ms[0])) });
      if (window.gws) items.push('-', { label: 'إظهار في المجلد', action: () => gws.showItem(x.path) });
      GW.menu(e.clientX, e.clientY, items);
    });
  }
  GW.bus.on('media', () => { if (BR.el && BR.el.isConnected) render(); });
  // project panel accepts browser files too (import into the open bin)
  const bindProj = () => { const pb = GW.UI && GW.UI.projBody; if (!pb || pb._brDrop) return; pb._brDrop = 1; pb.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-gws-files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }); pb.addEventListener('drop', e => { const d = e.dataTransfer.getData('application/x-gws-files'); if (!d) return; e.preventDefault(); BR.importPaths(JSON.parse(d)); }); };
  GW.bus.on('project', bindProj); GW.bus.on('media', bindProj); setTimeout(bindProj, 1500);
})();
