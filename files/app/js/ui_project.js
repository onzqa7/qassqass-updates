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
  let view = 'list', query = '';
  try { view = localStorage.getItem('gws.projView') || 'list'; } catch (e) {}

  GW.registerPanel('project', 'المشروع', (el) => {
    el.innerHTML = `<div class="ptool" dir="rtl">
      <button class="btn sm" data-a="import" title="استيراد (Ctrl+I)">استيراد</button>
      <button class="btn sm" data-a="new" title="عنصر جديد">جديد ${GW.ico('down', 12)}</button>
      <span class="grow"></span><small data-a="pxq" style="color:var(--yellow);white-space:nowrap"></small>
      <input class="inp" data-a="q" placeholder="بحث…" style="width:120px">
      <button class="btn sm ico ghost" data-a="list" title="عرض قائمة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      <button class="btn sm ico ghost" data-a="grid" title="عرض أيقونات"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg></button>
    </div><div class="pscroll" data-a="body" tabindex="0"></div>`;
    el.querySelector('[data-a=import]').onclick = GW.cmd.importMedia;
    el.querySelector('[data-a=new]').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); GW.menu(r.right, r.bottom + 2, newItems()); };
    el.querySelector('[data-a=q]').oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
    el.querySelector('[data-a=list]').onclick = () => { view = 'list'; try { localStorage.setItem('gws.projView', view); } catch (e) {} render(); };
    el.querySelector('[data-a=grid]').onclick = () => { view = 'grid'; try { localStorage.setItem('gws.projView', view); } catch (e) {} render(); };
    const body = el.querySelector('[data-a=body]');
    body.addEventListener('contextmenu', e => { if (!e.target.closest('[data-id]')) GW.menu(e.clientX, e.clientY, [{ label: 'استيراد…', action: GW.cmd.importMedia }, '-', ...newItems()]); });
    body.addEventListener('keydown', e => { if (e.key === 'Delete') { e.stopPropagation(); delSelected(); } });
    GW.UI.projBody = body;
    render();
  });
  const newItems = () => [
    { label: 'تسلسل جديد…', action: GW.cmd.newSeq }, { label: 'نص', action: () => GW.cmd.newText() }, { label: 'خريطة حربية', action: GW.cmd.newMap },
    { label: 'لون ثابت', action: GW.cmd.newColor }, { label: 'طبقة ضبط (Adjustment Layer)', action: GW.cmd.newAdjust }, { label: 'طبقة فارغة (Null)', action: GW.cmd.newNull }, { label: 'كاميرا', action: GW.cmd.newCamera }
  ];

  function itemsList() {
    const out = [];
    for (const s of GW.prj.seqs) out.push({ id: s.id, kind: 'seq', name: s.name, dur: GW.seqDur(s), info: `${s.w}×${s.h}`, fps: s.fps, label: GW.LABELS.seq, seq: s });
    for (const m of GW.prj.media) out.push({ id: m.id, kind: m.kind, name: m.name, dur: m.dur, info: m.w ? `${m.w}×${m.h}` : (m.kind === 'audio' ? 'صوت' : ''), fps: m.fps, label: m.label || GW.LABELS[m.kind], m });
    return out.filter(x => !query || x.name.toLowerCase().includes(query));
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
    if (!list.length) { body.innerHTML = `<div class="empty">المشروع فارغ.<br>اضغط «استيراد» أو اسحب ملفات الفيديو والصوت والصور إلى هنا.<br><br><button class="btn pri" data-imp>استيراد وسائط</button></div>`; body.querySelector('[data-imp]').onclick = GW.cmd.importMedia; return; }
    if (view === 'grid') {
      body.innerHTML = '<div class="proj-grid"></div>'; const g = body.firstChild;
      for (const x of list) {
        const d = document.createElement('div'); d.className = 'gitem' + (GW.sel.media.has(x.id) ? ' sel' : ''); d.dataset.id = x.id; d.draggable = true;
        d.innerHTML = `<div class="th">${x.kind === 'seq' || x.kind === 'audio' ? ICON[x.kind] : ''}<i>${GW.fmtTC(x.dur || 0, x.fps || 30)}</i></div><div class="cap"><span class="chipc" style="width:9px;height:9px;border-radius:2px;background:${esc(x.label)}"></span><span>${esc(x.name)}</span></div>`;
        const r = x.m && GW.rt.m[x.m.id]; if (r && r.poster) { const th = d.querySelector('.th'); const c = r.poster.cloneNode ? (r.poster.tagName === 'IMG' ? r.poster.cloneNode() : copyCanvas(r.poster)) : null; if (c) th.prepend(c); }
        const st = x.m && statusText(x.m); if (st) d.querySelector('.cap').insertAdjacentHTML('beforeend', `<small class="st" style="color:var(--yellow)">${esc(st)}</small>`);
        bindItem(d, x); g.append(d);
      }
      return;
    }
    body.innerHTML = '<div class="proj-list"><div class="proj-head"><span>الاسم</span><span>المدة</span><span>الأبعاد</span><span>إطار/ث</span></div></div>';
    const L = body.firstChild;
    for (const x of list) {
      const d = document.createElement('div'); d.className = 'pitem' + (GW.sel.media.has(x.id) ? ' sel' : '') + (x.m && x.m.offline ? ' offline' : ''); d.dataset.id = x.id; d.draggable = true;
      const st = x.m ? statusText(x.m) : '';
      d.innerHTML = `<div class="nm"><span class="chipc" style="background:${esc(x.label)}"></span>${ICON[x.kind] || ICON.video}<span>${esc(x.name)}</span>${st ? `<small class="st">${esc(st)}</small>` : ''}</div><span class="kv">${x.dur ? GW.fmtTC(x.dur, x.fps || 30) : '—'}</span><span class="kv">${esc(x.info)}</span><span class="kv">${x.fps ? (+x.fps).toFixed(2).replace(/\.00$/, '') : ''}</span>`;
      d.querySelector('svg').style.cssText = 'width:15px;height:15px;color:var(--text2)';
      bindItem(d, x); L.append(d);
    }
  }
  function copyCanvas(c) { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); return n; }
  function bindItem(d, x) {
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
})();
