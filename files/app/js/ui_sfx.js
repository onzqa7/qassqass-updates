'use strict';
/* Sound-effects library panel: categories, search, preview, insert / drag to the timeline */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const X = GW.SFX = { cat: 'all', q: '', list: null, cats: [], playing: null, audio: null };
  X.load = () => X._l || (X._l = Promise.all([fetch('sfx/catalog.json').then(r => r.ok ? r.json() : []).catch(() => []), fetch('sfx/categories.json').then(r => r.ok ? r.json() : []).catch(() => [])]).then(async ([l, c]) => {
    if (GW.lang === 'en') { // English names/uses (Arabic kept in tags so Arabic search still works)
      const E = window.__EN_SFX || {}; const CE = await fetch('sfx/categories_en.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
      for (const it of l) { const e = E[it.id]; if (e) { it.tags = [...(it.tags || []), it.ar]; it.ar = e.name || it.ar; it.use = e.use || it.use; } }
      for (const k of c) if (CE[k.id]) k.ar = CE[k.id];
    }
    X.base = l; X.cats = c; X.list = l.concat(mine()); render(); }));
  // "My sounds": the user's own sound files (e.g. a subscription library) — referenced in place, never copied or uploaded
  const MK = 'qq.sfx.mine';
  function mine() { try { return (JSON.parse(localStorage.getItem(MK) || '[]') || []).map(x => ({ ...x, cat: 'mine', mine: 1 })); } catch (e) { return []; } }
  function saveMine(arr) { try { localStorage.setItem(MK, JSON.stringify(arr.map(({ id, abs, ar, dur }) => ({ id, abs, ar, dur })))); } catch (e) {} }
  const nice = (n) => n.replace(/\.[a-z0-9]+$/i, '').replace(/^ES_/, '').replace(/\s*-\s*Epidemic Sound$/i, '').replace(/[_]+/g, ' ').trim();
  X.addMine = async () => {
    if (!window.gws || !gws.open) return;
    const f = await gws.open({ filter: 'media', multi: true, title: 'إضافة أصواتي' }); if (!f || !f.length) return;
    const cur = mine(); let n = 0;
    for (const x of f) {
      if (!/\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i.test(x.name) || cur.some(c => c.abs === x.path)) continue;
      const it = { id: 'u_' + Date.now().toString(36) + '_' + (n++), abs: x.path, ar: nice(x.name), dur: 0 };
      try { it.dur = await new Promise(res => { const a = new Audio(gws.mediaUrl(x.path)); a.onloadedmetadata = () => res(a.duration || 0); a.onerror = () => res(0); setTimeout(() => res(0), 4000); }); } catch (e) {}
      cur.push(it);
    }
    saveMine(cur); X.list = (X.base || []).concat(mine()); X.cat = 'mine'; render(); GW.toast('أُضيفت ' + n + ' أصوات إلى «أصواتي»');
  };
  X.removeMine = (it) => { saveMine(mine().filter(x => x.id !== it.id)); X.list = (X.base || []).concat(mine()); render(); };
  const norm = (s) => GW.Atlas && GW.Atlas.Geo ? GW.Atlas.Geo.norm(s) : String(s || '').toLowerCase();
  // absolute path of a bundled sfx file (unpacked from the app archive so FFmpeg can read it)
  X.path = async (it) => { if (it.abs) return it.abs; const p = await gws.paths(); return (p.sfxDir || '') + p.sep + it.file.replace(/^sfx\//, '').split('/').join(p.sep); };
  X.media = async (it) => {
    if (!window.gws) { GW.toast('متاح في نسخة سطح المكتب'); return null; }
    const path = await X.path(it); let m = GW.prj.media.find(x => x.path === path);
    if (!m) { const added = await GW.Media.importFiles([{ path, name: it.abs ? it.abs.split(/[\\/]/).pop() : it.ar + '.mp3', size: 1 }]); m = added[0] || GW.prj.media.find(x => x.path === path); }
    return m;
  };
  X.insert = async (it, t, row) => { const m = await X.media(it); if (!m) return; const s = GW.seq(); GW.TL.insertMedia([m], t != null ? t : s.t, 'overwrite', row != null ? { row } : {}); GW.toast('أُضيف: ' + it.ar); };
  X.play = (it, btn) => {
    if (X.audio) { X.audio.pause(); X.audio = null; document.querySelectorAll('.sfx-i .pl.on').forEach(b => { b.classList.remove('on'); b.innerHTML = GW.ico('play', 14); }); if (X.playing === it.id) { X.playing = null; return; } }
    const a = new Audio(it.abs ? gws.mediaUrl(it.abs) : it.file); a.volume = .9; a.play().catch(() => {}); X.audio = a; X.playing = it.id; btn.classList.add('on'); btn.innerHTML = GW.ico('stop', 14); a.onended = () => { btn.classList.remove('on'); btn.innerHTML = GW.ico('play', 14); X.playing = null; X.audio = null; };
  };
  let P = null;
  GW.registerPanel('sfx', 'المؤثرات الصوتية', (el) => { P = el; X.load(); render(); });
  function render() {
    if (!P) return;
    if (!X.list) { P.innerHTML = '<div class="empty">جارٍ تحميل المكتبة…</div>'; return; }
    if (!X.list.length) { P.innerHTML = '<div class="empty">مكتبة المؤثرات الصوتية غير متوفرة.</div>'; return; }
    P.innerHTML = `<div class="ptool"><input class="inp" style="flex:1" placeholder="ابحث: انفجار، صفارة، كاميرا، انتقال…" data-a="q" value="${esc(X.q)}"><span class="kv" style="color:var(--mute)">${X.list.length} صوت</span><button class="btn sm" data-a="mine" title="أضف ملفات صوتية من جهازك (مثل مكتبة Epidemic Sound) إلى قسم «أصواتي»">${GW.ico('plus', 13)}<span>أصواتي</span></button></div><div class="sfx-cats" data-a="cats"></div><div class="pscroll"><div class="sfx-list" data-a="list"></div></div>`;
    const cats = P.querySelector('[data-a=cats]');
    P.querySelector('[data-a=mine]').onclick = X.addMine;
    for (const [k, n] of [['all', 'الكل'], ...(X.list.some(x => x.mine) ? [['mine', 'أصواتي']] : []), ...X.cats.map(c => [c.id, c.ar])]) { const b = document.createElement('button'); b.className = 'chip' + (X.cat === k ? ' on' : ''); const cnt = k === 'all' ? X.list.length : X.list.filter(x => x.cat === k).length; b.textContent = `${n} (${cnt})`; b.onclick = () => { X.cat = k; render(); }; cats.append(b); }
    const q = P.querySelector('[data-a=q]'); q.onkeydown = e => e.stopPropagation(); q.oninput = () => { X.q = q.value; list(); };
    list();
  }
  function list() {
    const L = P.querySelector('[data-a=list]'); L.innerHTML = ''; const n = norm(X.q);
    const items = X.list.filter(x => (X.cat === 'all' || x.cat === X.cat) && (!n || norm([x.ar, x.use, ...(x.tags || [])].join(' ')).includes(n)));
    for (const it of items) {
      const r = document.createElement('div'); r.className = 'sfx-i'; r.draggable = true; r.title = 'اسحب إلى الخط الزمني، أو انقر مرتين للإضافة عند المؤشر' + (it.license ? '\nالترخيص: ' + it.license + (it.author ? ' — ' + it.author : '') : '');
      r.innerHTML = `<button class="pl">${GW.ico('play', 14)}</button><div><b>${esc(it.ar)}</b><p>${esc(it.use || '')}</p></div><span class="d">${(+it.dur || 0).toFixed(1)}s</span>`;
      const pl = r.querySelector('.pl'); pl.onclick = (e) => { e.stopPropagation(); X.play(it, pl); };
      r.ondblclick = () => X.insert(it);
      r.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-gws-sfx', it.id); e.dataTransfer.effectAllowed = 'copy'; X.media(it); });
      r.oncontextmenu = (e) => { e.preventDefault(); GW.menu(e.clientX, e.clientY, [{ label: 'إضافة عند المؤشر', action: () => X.insert(it) }, { label: 'تشغيل / إيقاف', action: () => X.play(it, pl) }, ...(it.mine ? ['-', { label: 'إزالة من «أصواتي»', action: () => X.removeMine(it) }] : [])]); };
      L.append(r);
    }
    if (!items.length) L.innerHTML = '<div class="empty">لا توجد نتائج.</div>';
  }
})();
