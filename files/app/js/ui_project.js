'use strict';
/* Project panel (bin): media, sequences, new items */
(function () {
  const { $, esc } = GW;
  GW.UI = GW.UI || {};
  const ICON = {
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-6-6-9 9"/></svg>',
    seq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M8 5v5M13 5v5"/></svg>'
  };
  GW.ICON = ICON;
  let view = 'list', query = '', cur = null, sortBy = 'none'; // cur: bin id | 'smart:<kind>' | null (root)
  try { view = localStorage.getItem('gws.projView') || 'list'; sortBy = localStorage.getItem('gws.projSort') || 'none'; } catch (e) {}

  /* ---- bins (مجلدات): GW.prj.bins = [{id, name, parent, color}], media.bin / seq.bin = bin id. Older projects have no bins → everything in the root. ---- */
  const B = GW.Bins = {
    all: () => GW.prj.bins || (GW.prj.bins = []),
    get: id => B.all().find(b => b.id === id) || null,
    children: parent => B.all().filter(b => (b.parent || null) === (parent || null)),
    create(name, parent) { const b = { id: GW.uid(), name: name || 'مجلد جديد', parent: parent || null, color: null }; B.all().push(b); GW.commit('مجلد جديد'); render(); return b; },
    rename(id, name) { const b = B.get(id); if (b && name) { b.name = name; GW.commit('إعادة تسمية المجلد'); render(); } },
    setColor(id, color) { const b = B.get(id); if (b) { b.color = color; GW.commit('لون المجلد'); render(); } },
    remove(id) { const b = B.get(id); if (!b) return; const up = b.parent || null; for (const m of GW.prj.media) if (m.bin === id) m.bin = up; for (const q of GW.prj.seqs) if (q.bin === id) q.bin = up; for (const x of B.all()) if (x.parent === id) x.parent = up; GW.prj.bins = B.all().filter(x => x.id !== id); if (cur === id) cur = up; GW.commit('حذف مجلد'); render(); },
    move(ids, bin) { // media / sequence / bin ids → bin (null = root); a bin cannot move into itself or its descendants
      let n = 0; for (const id of ids) { const m = GW.media(id); if (m) { if ((m.bin || null) !== (bin || null)) { if (bin) m.bin = bin; else delete m.bin; n++; } continue; } const q = GW.prj.seqs.find(x => x.id === id); if (q) { if (bin) q.bin = bin; else delete q.bin; n++; continue; } const b = B.get(id); if (b && b.id !== bin && !B.isInside(bin, b.id)) { b.parent = bin || null; n++; } }
      if (n) { GW.commit('نقل إلى مجلد'); render(); } return n;
    },
    isInside: (id, ancestor) => { let b = B.get(id); while (b) { if (b.id === ancestor) return true; b = B.get(b.parent); } return false; },
    path: id => { const out = []; let b = B.get(id); while (b) { out.unshift(b); b = B.get(b.parent); } return out; },
    usedIds: () => { const u = new Set(); for (const q of GW.prj.seqs) for (const c of q.clips) if (c.media) u.add(c.media); return u; },
    unused: () => { const u = B.usedIds(); return GW.prj.media.filter(m => !u.has(m.id)); },
    search: q => { q = String(q || '').toLowerCase(); return [...GW.prj.media, ...GW.prj.seqs].filter(x => x.name.toLowerCase().includes(q)); },
    SMART: [['smart:video', 'فيديو', 'video'], ['smart:audio', 'صوت', 'audio'], ['smart:image', 'صور', 'image'], ['smart:maps', 'خرائط', 'maps'], ['smart:unused', 'غير مستخدم', 'unused']],
    smartItems(kind) { if (kind === 'unused') return B.unused(); if (kind === 'maps') return GW.prj.seqs.filter(q => q.clips.some(c => c.kind === 'map')); return GW.prj.media.filter(m => m.kind === kind); },
    open(id) { cur = id || null; query = ''; const el = GW.panels.project.el; if (el) { const q = el.querySelector('[data-a=q]'); if (q) q.value = ''; } render(); },
    current: () => cur,
    async removeUnused() { const un = B.unused(); if (!un.length) { GW.toast('لا توجد وسائط غير مستخدمة'); return 0; } if (!(await GW.ask('إزالة غير المستخدم', `سيتم حذف ${un.length} عنصر غير مستخدم في أي تسلسل من المشروع (الملفات تبقى على القرص). متابعة؟`, 'إزالة'))) return 0; const ids = new Set(un.map(m => m.id)); GW.prj.media = GW.prj.media.filter(m => !ids.has(m.id)); for (const id of ids) GW.sel.media.delete(id); GW.commit('إزالة غير المستخدم'); GW.bus.emit('project'); render(); GW.toast('تمت إزالة ' + un.length + ' عنصر'); return un.length; },
    async consolidate(dir) { // copy every media file into one folder (gws.copyFile) and point the project at the copies
      if (!window.gws || !gws.copyFile) { GW.toast('تجميع الملفات متاح في نسخة سطح المكتب'); return null; }
      if (!dir) { const f = await gws.open({ folder: 1, title: 'اختر مجلد التجميع' }); if (!f.length) return null; dir = f[0].path; }
      const sep = dir.includes('\\') ? '\\' : '/'; const used = B.usedIds(); let n = 0, skipped = 0; const names = new Set();
      for (const m of GW.prj.media) { if (!m.path || m.offline) { skipped++; continue; } let name = m.path.split(/[\\/]/).pop(); if (names.has(name)) { const i = name.lastIndexOf('.'); name = (i > 0 ? name.slice(0, i) : name) + '_' + m.id.slice(0, 4) + (i > 0 ? name.slice(i) : ''); } names.add(name); const dst = dir + sep + name; if (dst === m.path) continue; try { const ok = await gws.copyFile(m.path, dst); if (ok === false) { skipped++; continue; } m.path = dst; n++; } catch (e) { console.error('consolidate', e); skipped++; } }
      GW.commit('تجميع الملفات'); render(); GW.toast(`تم نسخ ${n} ملف إلى المجلد` + (skipped ? ` (تخطي ${skipped})` : '')); return { dir, copied: n, skipped, unused: GW.prj.media.length - used.size };
    }
  };
  const SORTS = [['none', 'بدون ترتيب'], ['name', 'الاسم'], ['kind', 'النوع'], ['dur', 'المدة'], ['date', 'تاريخ الإضافة']];

  GW.registerPanel('project', 'المشروع', (el) => {
    el.innerHTML = `<div class="ptool" dir="rtl">
      <button class="btn sm" data-a="import" title="استيراد (Ctrl+I)">استيراد</button>
      <button class="btn sm" data-a="new" title="عنصر جديد">جديد ${GW.ico('down', 12)}</button>
      <button class="btn sm ico ghost" data-a="bin" title="مجلد جديد">${GW.ico('folderplus', 15)}</button>
      <span class="grow"></span><small data-a="pxq" style="color:var(--yellow);white-space:nowrap"></small>
      <select class="sel" data-a="sort" title="ترتيب" style="width:auto;max-width:110px">${SORTS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
      <input class="inp" data-a="q" placeholder="بحث في كل المجلدات…" style="width:120px">
      <button class="btn sm ico ghost" data-a="list" title="عرض قائمة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      <button class="btn sm ico ghost" data-a="grid" title="عرض أيقونات"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg></button>
    </div><div class="pscroll" data-a="body" tabindex="0"></div>`;
    el.querySelector('[data-a=import]').onclick = GW.cmd.importMedia;
    el.querySelector('[data-a=new]').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); GW.menu(r.right, r.bottom + 2, newItems()); };
    el.querySelector('[data-a=q]').oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
    el.querySelector('[data-a=bin]').onclick = async () => { const n = await GW.prompt('مجلد جديد', 'الاسم', 'مجلد جديد'); if (n) B.create(n, typeof cur === 'string' && cur.startsWith('smart:') ? null : cur); };
    const so = el.querySelector('[data-a=sort]'); so.value = sortBy; so.onchange = () => { sortBy = so.value; try { localStorage.setItem('gws.projSort', sortBy); } catch (e) {} render(); };
    el.querySelector('[data-a=list]').onclick = () => { view = 'list'; try { localStorage.setItem('gws.projView', view); } catch (e) {} render(); };
    el.querySelector('[data-a=grid]').onclick = () => { view = 'grid'; try { localStorage.setItem('gws.projView', view); } catch (e) {} render(); };
    const body = el.querySelector('[data-a=body]');
    body.addEventListener('contextmenu', e => { if (!e.target.closest('[data-id]')) GW.menu(e.clientX, e.clientY, [{ label: 'استيراد…', action: GW.cmd.importMedia }, '-', ...newItems(), '-', ...binItems()]); });
    body.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-gws-media') && !e.target.closest('[data-bin]')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    body.addEventListener('drop', e => { if (e.target.closest('[data-bin]')) return; const d = e.dataTransfer.getData('application/x-gws-media'); if (!d) return; e.preventDefault(); if (typeof cur === 'string' && cur.startsWith('smart:')) return; B.move(JSON.parse(d), cur); }); // drop on the list background → current bin
    body.addEventListener('keydown', e => { if (e.key === 'Delete') { e.stopPropagation(); delSelected(); } });
    GW.UI.projBody = body;
    render();
  });
  const newItems = () => [
    { label: 'تسلسل جديد…', action: GW.cmd.newSeq }, { label: 'نص', action: () => GW.cmd.newText() }, { label: 'خريطة حربية', action: GW.cmd.newMap },
    { label: 'شكل جديد', sub: GW.Shape ? GW.Shape.TYPES.map(([k, n]) => ({ label: n, action: () => GW.UI.addShapeLayer(k) })) : [] },
    { label: 'لون ثابت', action: GW.cmd.newColor }, { label: 'طبقة ضبط (Adjustment Layer)', action: GW.cmd.newAdjust }, { label: 'طبقة فارغة (Null)', action: GW.cmd.newNull }, { label: 'كاميرا', action: GW.cmd.newCamera }
  ];
  const binItems = () => [
    { label: 'مجلد جديد…', action: async () => { const n = await GW.prompt('مجلد جديد', 'الاسم', 'مجلد جديد'); if (n) B.create(n, typeof cur === 'string' ? null : cur); } },
    { label: 'إزالة غير المستخدم…', action: () => B.removeUnused() },
    { label: 'تجميع الملفات في مجلد…', disabled: !window.gws, action: () => B.consolidate() }
  ];
  const binRow = (b) => { const kids = B.children(b.id).length + GW.prj.media.filter(m => m.bin === b.id).length + GW.prj.seqs.filter(q => q.bin === b.id).length; return { id: b.id, kind: 'bin', name: b.name, dur: 0, info: kids + ' عنصر', fps: '', label: b.color || '#c9a227', bin: b }; };
  const smartRow = ([id, n, kind]) => ({ id, kind: 'smart', name: n, dur: 0, info: B.smartItems(kind).length + ' عنصر', fps: '', label: '#9da3ad', smart: kind });
  const mediaRow = m => ({ id: m.id, kind: m.kind, name: m.name, dur: m.dur, info: m.w ? `${m.w}×${m.h}` : (m.kind === 'audio' ? 'صوت' : ''), fps: m.fps, label: m.label || GW.LABELS[m.kind], m, where: m.bin ? B.path(m.bin).map(b => b.name).join(' / ') : '' });
  const seqRow = s => ({ id: s.id, kind: 'seq', name: s.name, dur: GW.seqDur(s), info: `${s.w}×${s.h}`, fps: s.fps, label: GW.LABELS.seq, seq: s, where: s.bin ? B.path(s.bin).map(b => b.name).join(' / ') : '' });
  function itemsList() {
    let out = [];
    const smart = typeof cur === 'string' && cur.startsWith('smart:') ? cur.slice(6) : null;
    if (query) { out = [...GW.prj.seqs.map(seqRow), ...GW.prj.media.map(mediaRow)].filter(x => x.name.toLowerCase().includes(query)); } // search spans every bin
    else if (smart) { out = B.smartItems(smart).map(x => x.clips ? seqRow(x) : mediaRow(x)); }
    else {
      if (cur && !B.get(cur)) cur = null;
      const bins = B.children(cur).map(binRow); const sm = !cur && (GW.prj.media.length || B.all().length) ? B.SMART.map(smartRow) : [];
      out = [...bins, ...sm, ...GW.prj.seqs.filter(q => (q.bin || null) === cur).map(seqRow), ...GW.prj.media.filter(m => (m.bin || null) === cur).map(mediaRow)];
    }
    if (sortBy !== 'none') { const rank = { bin: 0, smart: 1, seq: 2, video: 3, image: 4, audio: 5 }; const cmp = { name: (a, b) => a.name.localeCompare(b.name, 'ar'), kind: (a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.name.localeCompare(b.name, 'ar'), dur: (a, b) => (b.dur || 0) - (a.dur || 0), date: (a, b) => ((a.m && a.m.added) || 0) - ((b.m && b.m.added) || 0) }[sortBy]; out.sort((a, b) => (rank[a.kind] <= 1 ? 0 : 1) - (rank[b.kind] <= 1 ? 0 : 1) || cmp(a, b)); }
    return out;
  }
  function crumbs() {
    const bar = document.createElement('div'); bar.className = 'crumbs'; bar.dir = 'rtl'; bar.style.cssText = 'display:flex;gap:4px;align-items:center;padding:3px 8px;border-bottom:1px solid var(--line);font-size:11.5px;color:var(--mute);flex-wrap:wrap';
    const mk = (n, id, ico) => { const a = document.createElement('span'); a.innerHTML = (ico ? GW.ico(ico, 12) + ' ' : '') + esc(n); a.style.cssText = 'cursor:pointer;display:inline-flex;align-items:center;gap:3px'; a.dataset.bin = id || 'root'; a.onclick = () => B.open(id); a.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-gws-media')) { e.preventDefault(); a.style.color = 'var(--accent)'; } }); a.addEventListener('dragleave', () => { a.style.color = ''; }); a.addEventListener('drop', e => { const d = e.dataTransfer.getData('application/x-gws-media'); if (!d) return; e.preventDefault(); a.style.color = ''; B.move(JSON.parse(d), id); }); return a; };
    bar.append(mk('المشروع', null, 'folderopen'));
    if (typeof cur === 'string' && cur.startsWith('smart:')) { const sm = B.SMART.find(x => x[0] === cur); bar.append(document.createTextNode('›'), mk(sm ? sm[1] : cur, cur, 'smart')); }
    else for (const b of B.path(cur)) { bar.append(document.createTextNode('›'), mk(b.name, b.id, 'folder')); }
    if (query) bar.append(document.createTextNode('›'), Object.assign(document.createElement('span'), { textContent: 'نتائج البحث في كل المجلدات' }));
    return bar;
  }
  function statusText(m) {
    const r = GW.rt.m[m.id] || {};
    if (m.offline) return 'غير متصل';
    return { probing: 'تحليل…', converting: 'تحويل ' + Math.round(r.pct || 0) + '%', audio: 'استخراج الصوت…', error: 'خطأ', new: '…' }[r.status] || (GW.Media.bgText ? GW.Media.bgText(m) : '');
  }
  function render() {
    const body = GW.UI.projBody; if (!body) return; body._rows = null;
    const list = itemsList();
    const t = GW.panels.project.el && GW.panels.project.el.closest('.frame') && GW.panels.project.el.closest('.frame').querySelector('.tab.on[data-p=project]');
    if (t) t.textContent = 'المشروع: ' + (GW.prj.name || '');
    if (!list.length && !cur && !query) { body.innerHTML = `<div class="empty">المشروع فارغ.<br>اضغط «استيراد» أو اسحب ملفات الفيديو والصوت والصور إلى هنا.<br><br><button class="btn pri" data-imp>استيراد وسائط</button></div>`; body.querySelector('[data-imp]').onclick = GW.cmd.importMedia; return; }
    body.innerHTML = ''; body.append(crumbs());
    if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = query ? 'لا نتائج.' : 'المجلد فارغ — اسحب الوسائط إلى هنا.'; body.append(e); return; }
    if (view === 'grid') {
      const g = document.createElement('div'); g.className = 'proj-grid'; body.append(g);
      for (const x of list) {
        const d = document.createElement('div'); d.className = 'gitem' + (GW.sel.media.has(x.id) ? ' sel' : ''); d.dataset.id = x.id; d.draggable = true;
        d.innerHTML = `<div class="th">${x.kind === 'seq' || x.kind === 'audio' ? ICON[x.kind] : x.kind === 'bin' || x.kind === 'smart' ? GW.ico(x.kind === 'bin' ? 'folder' : 'smart', 40) : ''}<i>${x.kind === 'bin' || x.kind === 'smart' ? esc(x.info) : GW.fmtTC(x.dur || 0, x.fps || 30)}</i></div><div class="cap"><span class="chipc" style="width:9px;height:9px;border-radius:2px;background:${esc(x.label)}"></span><span>${esc(x.name)}</span></div>`;
        if (x.kind === 'bin' || x.kind === 'smart') { d.dataset.bin = x.id; d.querySelector('.th svg').style.cssText = 'color:' + x.label; }
        const r = x.m && GW.rt.m[x.m.id]; if (r && r.poster) { const th = d.querySelector('.th'); const c = r.poster.cloneNode ? (r.poster.tagName === 'IMG' ? r.poster.cloneNode() : copyCanvas(r.poster)) : null; if (c) th.prepend(c); }
        const st = x.m && statusText(x.m); if (st) d.querySelector('.cap').insertAdjacentHTML('beforeend', `<small class="st" style="color:var(--yellow)">${esc(st)}</small>`);
        bindItem(d, x); g.append(d);
      }
      return;
    }
    const L = document.createElement('div'); L.className = 'proj-list'; L.innerHTML = '<div class="proj-head"><span>الاسم</span><span>المدة</span><span>الأبعاد</span><span>إطار/ث</span></div>'; body.append(L);
    for (const x of list) {
      const d = document.createElement('div'); d.className = 'pitem' + (GW.sel.media.has(x.id) ? ' sel' : '') + (x.m && x.m.offline ? ' offline' : ''); d.dataset.id = x.id; d.draggable = true;
      const st = x.m ? statusText(x.m) : '';
      const ico = x.kind === 'bin' ? GW.ico('folder', 15) : x.kind === 'smart' ? GW.ico('smart', 15) : (ICON[x.kind] || ICON.video);
      d.innerHTML = `<div class="nm"><span class="chipc" style="background:${esc(x.label)}"></span>${ico}<span>${esc(x.name)}</span>${x.where && query ? `<small class="st" style="color:var(--mute)">${esc(x.where)}</small>` : ''}${st ? `<small class="st">${esc(st)}</small>` : ''}</div><span class="kv">${x.dur ? GW.fmtTC(x.dur, x.fps || 30) : '—'}</span><span class="kv">${esc(x.info)}</span><span class="kv">${x.fps ? (+x.fps).toFixed(2).replace(/\.00$/, '') : ''}</span>`;
      if (x.kind === 'bin' || x.kind === 'smart') { d.dataset.bin = x.id; d.querySelector('svg').style.cssText = 'width:15px;height:15px;color:' + x.label; }
      else d.querySelector('svg').style.cssText = 'width:15px;height:15px;color:var(--text2)';
      bindItem(d, x); L.append(d);
    }
  }
  function copyCanvas(c) { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); return n; }
  function bindBin(d, x) {
    d.addEventListener('dblclick', () => B.open(x.id));
    d.addEventListener('mousedown', e => { if (e.button !== 2) { GW.sel.media.clear(); GW.sel.media.add(x.id); render(); } });
    if (x.kind === 'bin') {
      d.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-gws-media', JSON.stringify([x.id])); e.dataTransfer.effectAllowed = 'move'; });
      d.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-gws-media')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; d.classList.add('sel'); } });
      d.addEventListener('dragleave', () => { if (!GW.sel.media.has(x.id)) d.classList.remove('sel'); });
      d.addEventListener('drop', e => { const dd = e.dataTransfer.getData('application/x-gws-media'); if (!dd) return; e.preventDefault(); e.stopPropagation(); B.move(JSON.parse(dd).filter(id => id !== x.id), x.id); });
    } else d.draggable = false;
    d.addEventListener('contextmenu', e => {
      e.preventDefault(); const items = [{ label: 'فتح', action: () => B.open(x.id) }];
      if (x.kind === 'bin') items.push({ label: 'إعادة تسمية…', action: async () => { const n = await GW.prompt('إعادة تسمية', 'الاسم', x.name); if (n) B.rename(x.id, n); } }, { label: 'لون التسمية', sub: [{ label: 'بدون', action: () => B.setColor(x.id, null) }, ...GW.LABEL_SET.map(([n, c]) => ({ label: n, action: () => B.setColor(x.id, c) }))] }, { label: 'مجلد فرعي جديد…', action: async () => { const n = await GW.prompt('مجلد جديد', 'الاسم', 'مجلد جديد'); if (n) B.create(n, x.id); } }, '-', { label: 'حذف المجلد (تبقى العناصر)', action: () => B.remove(x.id) });
      GW.menu(e.clientX, e.clientY, items);
    });
  }
  function bindItem(d, x) {
    if (x.kind === 'bin' || x.kind === 'smart') return bindBin(d, x);
    d.addEventListener('mousedown', e => {
      if (e.button === 2 && GW.sel.media.has(x.id)) return;
      if (e.ctrlKey || e.metaKey) { GW.sel.media.has(x.id) ? GW.sel.media.delete(x.id) : GW.sel.media.add(x.id); }
      else if (e.shiftKey && GW.sel.media.size) { const list = itemsList().map(i => i.id); const a = list.indexOf([...GW.sel.media].pop()), b = list.indexOf(x.id); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) GW.sel.media.add(list[i]); }
      else { GW.sel.media.clear(); GW.sel.media.add(x.id); }
      render(); GW.UI.projBody.focus();
    });
    d.addEventListener('dblclick', () => { if (x.kind === 'seq') { GW.prj.active = x.id; GW.bus.emit('project'); } else if (x.m) GW.Source && GW.Source.load(x.m); });
    d.addEventListener('dragstart', e => {
      if (!GW.sel.media.has(x.id)) { GW.sel.media.clear(); GW.sel.media.add(x.id); }
      const ids = [...GW.sel.media].filter(id => GW.media(id) || GW.prj.seqs.some(q => q.id === id));
      e.dataTransfer.setData('application/x-gws-media', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'copy';
      GW.dragMedia = ids;
    });
    d.addEventListener('dragend', () => { GW.dragMedia = null; });
    d.addEventListener('contextmenu', e => {
      e.preventDefault();
      const items = [];
      if (x.m) {
        items.push({ label: 'فتح في شاشة المصدر', action: () => GW.Source.load(x.m) }, { label: 'إدراج في التسلسل عند المؤشر', action: () => GW.TL.insertMedia([x.m], GW.seq().t, 'overwrite') }, { label: 'تسلسل جديد من المقطع', action: () => seqFromMedia(x.m) }, '-');
        items.push({ label: 'إعادة تسمية…', action: async () => { const n = await GW.prompt('إعادة تسمية', 'الاسم', x.m.name); if (n) { x.m.name = n; GW.commit('إعادة تسمية'); render(); } } });
        items.push({ label: 'لون التسمية', sub: GW.LABEL_SET.map(([n, c]) => ({ label: n, action: () => { for (const id of GW.sel.media) { const m = GW.media(id); if (m) m.label = c; } GW.commit('لون التسمية'); render(); } })) });
        items.push({ label: 'نقل إلى مجلد', sub: [{ label: 'المشروع (الجذر)', action: () => B.move([...GW.sel.media], null) }, ...B.all().map(b => ({ label: B.path(b.id).map(q => q.name).join(' / '), action: () => B.move([...GW.sel.media], b.id) })), '-', { label: 'مجلد جديد…', action: async () => { const n = await GW.prompt('مجلد جديد', 'الاسم', 'مجلد جديد'); if (n) { const b = B.create(n, typeof cur === 'string' ? null : cur); B.move([...GW.sel.media], b.id); } } }] });
        if (window.gws && x.m.path) items.push({ label: 'إظهار في المجلد', action: () => gws.showItem(x.m.path) });
        if (window.gws && x.m.kind === 'video' && x.m.path) { const st = GW.Media.Proxy.state(x.m); items.push(st === 'ready' ? { label: 'حذف البروكسي', action: () => GW.Media.Proxy.remove(x.m) } : st ? { label: 'إلغاء إنشاء البروكسي', action: () => GW.Media.Proxy.cancel(x.m) } : { label: 'إنشاء بروكسي', action: () => GW.Media.createProxies(GW.prj.media.filter(m => GW.sel.media.has(m.id) && m.kind === 'video')) }); }
        if (x.m.offline || window.gws) items.push({ label: 'إعادة ربط الملف…', action: () => GW.UI.relink(x.m) });
        items.push('-', { label: 'حذف من المشروع', action: delSelected });
      } else {
        items.push({ label: 'فتح التسلسل', action: () => { GW.prj.active = x.id; GW.bus.emit('project'); } }, { label: 'إعدادات التسلسل…', action: () => { GW.prj.active = x.id; GW.bus.emit('project'); GW.cmd.seqSettings(); } },
          { label: 'إعادة تسمية…', action: async () => { const n = await GW.prompt('إعادة تسمية', 'الاسم', x.seq.name); if (n) { x.seq.name = n; GW.commit('إعادة تسمية'); GW.bus.emit('project'); } } },
          { label: 'تكرار التسلسل', action: () => { const c = GW.clone(x.seq); c.id = GW.uid(); c.name += ' (نسخة)'; c.clips.forEach(cl => cl.id = GW.uid()); GW.prj.seqs.push(c); GW.commit('تكرار تسلسل'); GW.bus.emit('project'); } },
          '-', { label: 'حذف التسلسل', disabled: GW.prj.seqs.length < 2, action: delSelected });
      }
      GW.menu(e.clientX, e.clientY, items);
    });
  }
  async function delSelected() {
    const ids = [...GW.sel.media]; if (!ids.length) return;
    const binIds = ids.filter(id => B.get(id)); if (binIds.length) { for (const id of binIds) B.remove(id); for (const id of binIds) GW.sel.media.delete(id); if (binIds.length === ids.length) return; }
    const used = GW.prj.seqs.some(s => s.clips.some(c => ids.includes(c.media)));
    if (used && !(await GW.ask('حذف من المشروع', 'بعض العناصر مستخدمة في التسلسلات وسيتم حذف مقاطعها أيضًا. متابعة؟', 'حذف'))) return;
    for (const s of GW.prj.seqs) s.clips.filter(c => ids.includes(c.media)).forEach(c => GW.ops.remove(s, c));
    GW.prj.media = GW.prj.media.filter(m => !ids.includes(m.id));
    const seqIds = ids.filter(id => GW.prj.seqs.some(s => s.id === id));
    if (seqIds.length && GW.prj.seqs.length > seqIds.length) { GW.prj.seqs = GW.prj.seqs.filter(s => !seqIds.includes(s.id)); if (!GW.prj.seqs.some(s => s.id === GW.prj.active)) GW.prj.active = GW.prj.seqs[0].id; }
    GW.sel.media.clear(); GW.commit('حذف من المشروع'); GW.bus.emit('project'); render();
  }
  function seqFromMedia(m) {
    const s = GW.newSequence(m.name.replace(/\.[^.]+$/, ''), m.w || 1920, m.h || 1080, Math.round(m.fps) || 30);
    GW.prj.seqs.push(s); GW.prj.active = s.id; GW.bus.emit('project'); GW.TL.insertMedia([m], 0, 'overwrite');
  }
  GW.UI.relink = async (m) => {
    if (!window.gws) return; const f = await gws.open({ filter: 'media', title: 'إعادة ربط: ' + m.name }); if (!f.length) return;
    m.path = f[0].path; m.proxy = null; m.offline = 0; delete GW.rt.m[m.id]; for (const id in GW.rt.v) if (GW.rt.v[id].media === m.id) GW.Media.dropVid(id);
    await GW.Media.prepare(m); GW.commit('إعادة ربط'); render(); GW.invalidate();
  };
  // status changes (proxy %, audio extraction…) patch the row in place instead of rebuilding a 1000s-item list
  const renderSoon = GW.debounce(render, 150);
  function patchStatus(m) {
    const body = GW.UI.projBody; if (!m || !m.id || !body || view !== 'list' || m.offline) return false;
    if (!body._rows) { body._rows = new Map(); for (const el of body.querySelectorAll('.pitem[data-id]')) body._rows.set(el.dataset.id, el.querySelector('.nm')); }
    const row = body._rows.get(m.id); if (!row || !row.isConnected) return false;
    const txt = statusText(m); let st = row.querySelector('.st');
    if (!txt) { if (st) st.remove(); return true; }
    if (!st) { st = document.createElement('small'); st.className = 'st'; row.append(st); }
    if (st.textContent !== txt) st.textContent = txt; return true;
  }
  GW.bus.on('proxy-queue', (q) => { const el = GW.panels.project.el && GW.panels.project.el.querySelector('[data-a=pxq]'); if (el) el.textContent = q && (q.active || q.queued) ? `بروكسي: ${q.active} قيد الإنشاء${q.queued ? ` · ${q.queued} بالانتظار` : ''} · ${Math.round(q.pct)}%` : ''; });
  GW.bus.on('media', render); GW.bus.on('media-status', (m) => { if (!patchStatus(m)) renderSoon(); }); GW.bus.on('project', render); GW.bus.on('changed', GW.debounce(render, 200));
  GW.UI.renderProject = render;
  // files imported while a bin is open land in that bin
  if (GW.Media && GW.Media.importFiles) { const imp0 = GW.Media.importFiles; GW.Media.importFiles = async (...a) => { const before = new Set(GW.prj.media.map(m => m.id)); const r = await imp0(...a); const b = cur && B.get(cur); if (b) { for (const m of GW.prj.media) if (!before.has(m.id) && !m.bin) m.bin = b.id; render(); } return r; }; }
})();
