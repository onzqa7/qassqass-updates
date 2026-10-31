'use strict';
/* App shell: panels, workspaces, menus, commands, shortcuts, playback, project files */
(function () {
  const { $, $$, clamp } = GW;
  GW.panels = {};
  GW.registerPanel = (id, title, build) => { GW.panels[id] = { id, title, build, el: null }; };
  GW.panelEl = (id) => { const p = GW.panels[id]; if (!p) return null; if (!p.el) { p.el = document.createElement('div'); p.el.className = 'panel'; p.el.dataset.panel = id; p.build(p.el); } return p.el; };

  /* ---------------- workspaces ---------------- */
  GW.WS = {
    edit: { n: 'تحرير', tl: ['source', 'fxc', 'mixer', 'markers'], tr: ['program'], bl: ['project', 'browser', 'effects', 'sfx', 'history'], br: ['timeline'], side: [], v: { '--c1': '40%', '--c4': '28%', '--r1': '54%' } },
    color: { n: 'ألوان', tl: ['fxc', 'source'], tr: ['program'], bl: ['project', 'effects'], br: ['timeline'], side: ['lumetri', 'scopes'], v: { '--c1': '34%', '--c4': '26%', '--r1': '58%', '--c3': '320px' } },
    effects: { n: 'تأثيرات', tl: ['fxc', 'source'], tr: ['program'], bl: ['project', 'history'], br: ['timeline'], side: ['effects', 'graphics'], v: { '--c1': '38%', '--c4': '24%', '--r1': '55%', '--c3': '300px' } },
    audio: { n: 'صوت', tl: ['mixer', 'fxc'], tr: ['program'], bl: ['project', 'effects'], br: ['timeline'], side: ['sfx'], v: { '--c1': '40%', '--c4': '24%', '--r1': '52%', '--c3': '360px' } },
    graphics: { n: 'رسومات', tl: ['fxc', 'source'], tr: ['program'], bl: ['project'], br: ['timeline'], side: ['graphics'], v: { '--c1': '34%', '--c4': '24%', '--r1': '56%', '--c3': '330px' } },
    maps: { n: 'الخرائط', tl: ['mapcam', 'source'], tr: ['program'], bl: ['fxc', 'project', 'effects'], br: ['timeline'], side: ['maps'], v: { '--c1': '52%', '--c4': '46%', '--r1': '58%', '--c3': '360px' } }
  };
  const FR = { tl: 'F_tl', tr: 'F_tr', bl: 'F_bl', br: 'F_br', side: 'F_side' };
  GW.active = { ws: 'edit', tabs: {} };
  function loadLayout(ws) { try { return JSON.parse(localStorage.getItem('gws.layout.' + ws) || 'null'); } catch (e) { return null; } }
  function saveLayout() { try { const root = document.documentElement.style; const o = {}; for (const k of ['--c1', '--c4', '--r1', '--c3']) if (root.getPropertyValue(k)) o[k] = root.getPropertyValue(k); localStorage.setItem('gws.layout.' + GW.active.ws, JSON.stringify(o)); } catch (e) {} }
  GW.setWorkspace = (ws) => {
    const W = GW.WS[ws]; if (!W) return;
    GW.active.ws = ws; try { localStorage.setItem('gws.ws', ws); } catch (e) {}
    const st = document.documentElement.style; const lay = loadLayout(ws) || W.v;
    for (const k of ['--c1', '--c4', '--r1', '--c3']) st.setProperty(k, lay[k] || W.v[k] || getComputedStyle(document.documentElement).getPropertyValue(k));
    // park all panels
    for (const id in GW.panels) { const el = GW.panels[id].el; if (el) $('#store').append(el); }
    for (const slot in FR) {
      const fr = $('#' + FR[slot]); const tabs = fr.querySelector('.tabs'), body = fr.querySelector('.fbody');
      const list = W[slot] || []; tabs.innerHTML = '';
      const act = GW.active.tabs[ws + slot] && list.includes(GW.active.tabs[ws + slot]) ? GW.active.tabs[ws + slot] : list[0];
      for (const id of list) {
        const b = document.createElement('button'); b.className = 'tab' + (id === act ? ' on' : ''); b.textContent = GW.panels[id].title; b.dataset.p = id;
        b.onclick = () => { GW.active.tabs[ws + slot] = id; GW.setWorkspace(ws); };
        tabs.append(b);
      }
      if (act) { body.append(GW.panelEl(act)); GW.bus.emit('panel-shown', act); }
    }
    $('#ws').classList.toggle('noside', !(W.side && W.side.length));
    $$('.wsb').forEach(b => b.classList.toggle('on', b.dataset.ws === ws));
    GW.bus.emit('layout'); GW.invalidate();
  };
  GW.showPanel = (id) => {
    const W = GW.WS[GW.active.ws];
    for (const slot in FR) if ((W[slot] || []).includes(id)) { GW.active.tabs[GW.active.ws + slot] = id; GW.setWorkspace(GW.active.ws); return; }
    // not in this workspace: open in side column
    W.side = [...(W.side || []), id]; GW.active.tabs[GW.active.ws + 'side'] = id; GW.setWorkspace(GW.active.ws);
  };
  GW.isShown = (id) => { const p = GW.panels[id]; return !!(p && p.el && p.el.isConnected && !p.el.closest('#store')); };

  function initSplitters() {
    $$('.split').forEach(sp => {
      sp.addEventListener('pointerdown', e => {
        e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
        const v = sp.dataset.var; const parent = sp.parentElement.getBoundingClientRect();
        const mv = ev => {
          let val;
          if (v === '--r1') { const r = $('#wsMain').getBoundingClientRect(); val = clamp((ev.clientY - r.top) / r.height * 100, 15, 85) + '%'; }
          else if (v === '--c3') { const r = $('#ws').getBoundingClientRect(); val = clamp(r.right - ev.clientX - 4, 220, r.width * .5) + 'px'; }
          else { val = clamp((ev.clientX - parent.left) / parent.width * 100, 12, 80) + '%'; }
          document.documentElement.style.setProperty(v, val); GW.bus.emit('layout');
        };
        const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); saveLayout(); GW.invalidate(); };
        sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
      });
    });
  }

  /* ---------------- playback ---------------- */
  const PB = GW.pb = { playing: false, rate: 1, loop: false, lastNow: 0, startT: 0, startClock: 0, dirty: true };
  GW.T = () => GW.seq().t || 0;
  GW.invalidate = () => { PB.dirty = true; };
  GW.seek = (t, keepPlay) => {
    const s = GW.seq(); const d = Math.max(GW.seqDur(s), 0);
    t = clamp(t, 0, Math.max(d, 0) + 3600);
    s.t = GW.snapFrame(t, s.fps);
    if (PB.playing && !keepPlay) GW.stop();
    PB.dirty = true; GW.bus.emit('time');
    if (GW.Media.prefetchAudio) GW.Media.prefetchAudio();
  };
  GW.play = (rate) => {
    const s = GW.seq(); rate = rate || 1;
    if (PB.playing && PB.rate === rate) { GW.stop(); return; }
    const end = (s.outP != null ? s.outP : GW.seqDur(s));
    if (rate > 0 && s.t >= end - 1 / s.fps) s.t = s.inP != null ? s.inP : 0;
    PB.playing = true; PB.rate = rate; PB.startT = s.t; PB.startClock = performance.now();
    GW.Render.playing = true;
    if (rate === 1) GW.Audio.play(s, s.t); else GW.Audio.stop();
    GW.bus.emit('play', true);
  };
  GW.stop = () => {
    if (!PB.playing) return;
    PB.playing = false; GW.Render.playing = false; GW.Audio.stop(); GW.Media.pauseAll();
    const s = GW.seq(); s.t = GW.snapFrame(s.t, s.fps); PB.dirty = true; GW.bus.emit('play', false); GW.bus.emit('time');
  };
  function loop(now) {
    const s = GW.seq();
    if (PB.playing && s) {
      let t = PB.rate === 1 && GW.Audio.playing ? GW.Audio.now() : PB.startT + (now - PB.startClock) / 1000 * PB.rate;
      const end = (s.outP != null && PB.startT < s.outP) ? s.outP : GW.seqDur(s);
      const start = s.inP != null ? s.inP : 0;
      if (PB.rate > 0 && t >= end) { if (PB.loop) { s.t = start; GW.play(PB.rate); GW.play(PB.rate); t = start; } else { s.t = end; GW.stop(); t = end; } }
      if (PB.rate < 0 && t <= 0) { t = 0; GW.stop(); }
      s.t = t; GW.bus.emit('time');
      // only recomposite when the sequence frame actually changes (a 60 Hz display no longer renders 30p twice)
      const fi = Math.floor(t * (s.fps || 30) + 1e-6);
      if (fi !== PB.lastFi || s !== PB.lastSeq) { PB.lastFi = fi; PB.lastSeq = s; PB.dirty = true; }
    }
    if (PB.dirty && GW.Program && !GW.Render.exporting) { PB.dirty = false; try { GW.Program.draw(); } catch (e) { console.error(e); } }
    GW.bus.emit('tick', now);
    requestAnimationFrame(loop);
  }
  GW.startLoop = () => requestAnimationFrame(loop);

  /* ---------------- commands ---------------- */
  const C = GW.cmd = {};
  const sel = () => [...GW.sel.clips].map(id => GW.clipById(id)).filter(Boolean);
  C.undo = () => GW.hist.undo(); C.redo = () => GW.hist.redo();
  C.importMedia = () => GW.Media.importDialog();
  C.newSeq = async () => {
    const s0 = GW.seq(); const s = GW.newSequence('تسلسل ' + String(GW.prj.seqs.length + 1).padStart(2, '0'), s0.w, s0.h, s0.fps);
    GW.prj.seqs.push(s); GW.prj.active = s.id; GW.commit('تسلسل جديد'); GW.bus.emit('project'); C.seqSettings();
  };
  C.seqSettings = () => GW.UI.seqSettings();
  C.addEdit = (all) => {
    const s = GW.seq(), t = s.t; let n = 0;
    let targets = all ? s.clips.slice() : (GW.sel.clips.size ? sel() : s.clips.filter(c => GW.TL && GW.TL.isTargeted(c)));
    if (!all && (!GW.TL || GW.TL.linked)) { const set = new Set(targets); targets.forEach(c => GW.linked(s, c).forEach(l => set.add(l))); targets = [...set]; }
    targets = targets.filter(c => t > c.start && t < c.start + c.dur && !(s[c.tt + 't'][c.ti] || {}).lock);
    n = GW.ops.splitGroup(s, targets, t).length;
    if (n) GW.commit('إضافة تعديل'); else GW.toast('لا يوجد مقطع تحت مؤشر التشغيل على المسارات المحددة');
  };
  C.del = (ripple) => {
    const s = GW.seq();
    if (!ripple && GW.CamKeys && GW.CamKeys.del()) return; // selected map camera keys (Effect Controls / viewer)
    if (GW.sel.trans) { s.trans = s.trans.filter(t => t.id !== GW.sel.trans); GW.sel.trans = null; GW.commit('حذف انتقال'); return; }
    const cs = sel(); if (!cs.length) { if (GW.TL && GW.TL.gap) { const g = GW.TL.gap; GW.TL.gap = null; GW.TL.rippleDeleteGapAtPlayhead({ tt: g.tt, ti: g.ti }, (g.t0 + g.t1) / 2); return; } if (ripple && GW.TL) GW.TL.rippleDeleteGapAtPlayhead(); return; }
    const withLinks = new Set(cs); cs.forEach(c => GW.linked(s, c).forEach(l => withLinks.add(l)));
    if (ripple) GW.ops.rippleDelete(s, [...withLinks]); else [...withLinks].forEach(c => GW.ops.remove(s, c));
    GW.sel.clips.clear(); GW.commit(ripple ? 'حذف مع إزاحة' : 'حذف');
  };
  C.selectAll = () => { GW.seq().clips.forEach(c => GW.sel.clips.add(c.id)); GW.bus.emit('selection'); };
  C.deselect = () => { GW.sel.clips.clear(); GW.sel.trans = null; GW.bus.emit('selection'); };
  C.toggleEnable = () => { const cs = sel(); if (!cs.length) return; const v = cs[0].on === 0 ? 1 : 0; cs.forEach(c => c.on = v); GW.commit(v ? 'تفعيل' : 'تعطيل'); };
  C.link = () => {
    const cs = sel(); if (!cs.length) return; const s = GW.seq();
    if (cs.some(c => c.link)) { const ids = new Set(cs.map(c => c.link).filter(Boolean)); s.clips.forEach(c => { if (ids.has(c.link)) c.link = null; }); GW.commit('فك الربط'); }
    else if (cs.length > 1) { const id = GW.uid(); cs.forEach(c => c.link = id); GW.commit('ربط'); }
  };
  C.speed = () => GW.UI.speedDialog(sel());
  C.label = (color) => { sel().forEach(c => c.label = color); GW.commit('لون التسمية'); };
  C.rename = async () => { const c = sel()[0]; if (!c) return; const n = await GW.prompt('إعادة تسمية', 'الاسم', c.name); if (n) { c.name = n; GW.commit('إعادة تسمية'); } };
  C.fitFrame = (fill) => {
    const s = GW.seq(); sel().filter(c => c.motion).forEach(c => { const f = fill ? Math.max(s.w / c.sw, s.h / c.sh) : Math.min(s.w / c.sw, s.h / c.sh); c.motion.scale = GW.P(Math.round(f * 10000) / 100); c.motion.pos = GW.P([s.w / 2, s.h / 2]); c.motion.anchor = GW.P([c.sw / 2, c.sh / 2]); });
    GW.commit(fill ? 'ملء الإطار' : 'ملاءمة الإطار');
  };
  C.markIn = () => { const s = GW.seq(); s.inP = s.t; if (s.outP != null && s.outP <= s.inP) s.outP = null; GW.commit('نقطة دخول'); };
  C.markOut = () => { const s = GW.seq(); s.outP = s.t; if (s.inP != null && s.inP >= s.outP) s.inP = null; GW.commit('نقطة خروج'); };
  C.clearIO = () => { const s = GW.seq(); s.inP = s.outP = null; GW.commit('مسح الدخول والخروج'); };
  C.markClip = () => { const c = sel()[0]; if (!c) return; const s = GW.seq(); s.inP = c.start; s.outP = c.start + c.dur; GW.commit('تحديد حول المقطع'); };
  C.marker = async () => { const s = GW.seq(); s.markers.push({ id: GW.uid(), t: s.t, name: 'علامة ' + (s.markers.length + 1), color: '#4e9a52' }); GW.commit('إضافة علامة'); };
  C.nextMarker = (dir) => { const s = GW.seq(); const ms = s.markers.map(m => m.t).sort((a, b) => a - b); const t = dir > 0 ? ms.find(x => x > s.t + 1e-4) : ms.reverse().find(x => x < s.t - 1e-4); if (t != null) GW.seek(t); };
  C.clearMarkers = () => { GW.seq().markers = []; GW.commit('مسح العلامات'); };
  C.editPoint = (dir) => {
    const s = GW.seq(); const pts = new Set([0]); s.clips.forEach(c => { pts.add(c.start); pts.add(c.start + c.dur); });
    const arr = [...pts].sort((a, b) => a - b); const t = dir > 0 ? arr.find(x => x > s.t + 1e-4) : arr.reverse().find(x => x < s.t - 1e-4);
    if (t != null) GW.seek(t);
  };
  C.step = (n) => { const s = GW.seq(); GW.seek(s.t + n / s.fps); };
  C.home = () => GW.seek(0); C.end = () => GW.seek(GW.seqDur(GW.seq()));
  C.lift = (extract) => { const s = GW.seq(); if (s.inP == null || s.outP == null) { GW.toast('حدد نقطتي الدخول والخروج أولًا (I و O)'); return; } GW.ops.liftRange(s, s.inP, s.outP, extract); if (extract) { s.outP = null; } GW.commit(extract ? 'استخراج' : 'رفع'); };
  C.defaultTrans = (audio) => GW.TL && GW.TL.applyTransitionAtPlayhead(audio ? 'cpower' : 'dissolve', audio ? 'a' : 'v');
  C.newText = (preset) => GW.UI.addTextClip(preset);
  C.newMap = () => GW.UI.addMapClip();
  C.newColor = () => GW.UI.addGenerator('color');
  C.newAdjust = () => GW.UI.addGenerator('adjust');
  C.newNull = () => GW.UI.addGenerator('null');
  C.newCamera = () => GW.UI.addGenerator('camera');
  C.newShape = (kind) => GW.UI.addShape(kind);
  C.exportMedia = () => GW.UI.exportDialog();
  C.exportFrame = () => GW.UI.exportFrame();
  C.copy = (cut) => {
    if (!cut && GW.CamKeys && GW.CamKeys.copy()) return; GW.lastCopy = 'clips';
    const cs = sel(); if (!cs.length) return; const s = GW.seq(); const all = new Set(cs); cs.forEach(c => GW.linked(s, c).forEach(l => all.add(l)));
    const t0 = Math.min(...[...all].map(c => c.start));
    GW.clipboard = { t0, clips: GW.clone([...all]) };
    if (cut) { [...all].forEach(c => GW.ops.remove(s, c)); GW.commit('قص'); } else GW.toast('تم النسخ: ' + all.size + ' مقطع');
  };
  C.paste = (insert) => {
    if (!insert && GW.CamKeys && GW.CamKeys.paste()) return;
    const cb = GW.clipboard; if (!cb) return; const s = GW.seq(); const off = s.t - cb.t0; const linkMap = {};
    const dur = Math.max(...cb.clips.map(c => c.start + c.dur)) - cb.t0;
    if (insert) GW.ops.rippleInsert(s, s.t, dur, GW.ops.allTracks(s));
    GW.sel.clips.clear();
    for (const c0 of cb.clips) { const c = GW.clone(c0); c.id = GW.uid(); if (c.link) c.link = linkMap[c.link] || (linkMap[c.link] = GW.uid()); c.start += off; GW.ops.ensureTrack(s, c.tt, c.ti); if (!insert) GW.ops.clear(s, c.tt, c.ti, c.start, c.start + c.dur); s.clips.push(c); GW.sel.clips.add(c.id); }
    GW.seek(s.t + dur); GW.commit(insert ? 'لصق مع إدراج' : 'لصق');
  };
  C.pasteAttrs = () => {
    const cb = GW.clipboard; if (!cb) return; const src = cb.clips.find(c => c.tt === 'v') || cb.clips[0];
    for (const c of sel()) { if (c.tt === 'v' && src.tt === 'v') { c.fx = GW.clone(src.fx || []).map(f => ({ ...f, id: GW.uid() })); c.motion = GW.clone(src.motion); c.opacity = GW.clone(src.opacity); c.blend = src.blend; } if (c.tt === 'a' && src.vol) { c.vol = GW.clone(src.vol); c.afx = GW.clone(src.afx || []); } }
    GW.commit('لصق السمات');
  };
  C.duplicate = () => { C.copy(); const s = GW.seq(); const cs = sel(); if (!cs.length) return; const end = Math.max(...cs.map(c => c.start + c.dur)); const keep = s.t; s.t = end; C.paste(false); s.t = keep; };
  C.zoomTL = (d) => GW.TL && GW.TL.zoom(d);
  C.fitTL = () => GW.TL && GW.TL.fit();
  C.tool = (t) => GW.TL && GW.TL.setTool(t);
  C.nudge = (dx) => {
    const s = GW.seq(); let cs = sel(); if (!cs.length) return;
    if (!GW.TL || GW.TL.linked) { const set = new Set(cs); cs.forEach(c => GW.linked(s, c).forEach(l => set.add(l))); cs = [...set]; }
    cs = cs.filter(c => !(s[c.tt + 't'][c.ti] || {}).lock); if (!cs.length) { GW.toast('المسار مقفل'); return; }
    let d = dx / s.fps; const minS = Math.min(...cs.map(c => c.start)); if (minS + d < 0) d = -minS; if (!d) return;
    for (const c of cs) c.start = GW.snapFrame(c.start + d, s.fps);
    const ex = new Set(cs.map(c => c.id)); for (const c of cs) GW.ops.clear(s, c.tt, c.ti, c.start, c.start + c.dur, ex); // overwrite like a drag
    if (GW.TL) GW.TL.ensureVisible(dx > 0 ? Math.max(...cs.map(c => c.start + c.dur)) : Math.min(...cs.map(c => c.start)));
    GW.commit(Math.abs(dx) > 1 ? 'تحريك 5 إطارات' : 'تحريك إطار');
  };
  // nest the selected clips into a new sequence (replaced by one nested clip), or just make a sub-sequence from them (timeline untouched)
  C.nest = (subOnly) => {
    const s = GW.seq(); let cs = sel(); if (!cs.length) { GW.toast('حدد مقاطع أولًا'); return; }
    const set = new Set(cs); cs.forEach(c => GW.linked(s, c).forEach(l => set.add(l))); cs = [...set];
    const t0 = Math.min(...cs.map(c => c.start)), t1 = Math.max(...cs.map(c => c.start + c.dur));
    const sub = GW.newSequence((subOnly ? 'تسلسل فرعي ' : 'متداخل ') + String(GW.prj.seqs.length + 1).padStart(2, '0'), s.w, s.h, s.fps);
    const vmin = Math.min(...cs.filter(c => c.tt === 'v').map(c => c.ti), 0), amin = Math.min(...cs.filter(c => c.tt === 'a').map(c => c.ti), 0);
    for (const c of cs) { const k = GW.clone(c); k.id = GW.uid(); k.start -= t0; k.ti = c.ti - (c.tt === 'v' ? vmin : amin); GW.ops.ensureTrack(sub, k.tt, k.ti); sub.clips.push(k); }
    sub.trans = GW.clone(s.trans.filter(tr => cs.some(c => c.id === tr.a) || cs.some(c => c.id === tr.b))); const idMap = new Map(cs.map((c, i) => [c.id, sub.clips[i].id])); sub.trans.forEach(tr => { tr.a = idMap.get(tr.a) || null; tr.b = idMap.get(tr.b) || null; tr.ti -= tr.tt === 'v' ? vmin : amin; });
    sub.markers = s.markers.filter(m => m.t >= t0 && m.t <= t1).map(m => ({ ...m, id: GW.uid(), t: m.t - t0 }));
    GW.prj.seqs.push(sub);
    if (subOnly) { GW.commit('تسلسل فرعي'); GW.bus.emit('project'); GW.toast('تم إنشاء تسلسل فرعي: ' + sub.name); return; }
    const ti = Math.min(...cs.filter(c => c.tt === 'v').map(c => c.ti), 0); cs.forEach(c => GW.ops.remove(s, c)); GW.sel.clips.clear();
    const n = GW.newClip('nest', { ti, start: t0, dur: t1 - t0, name: sub.name, sw: sub.w, sh: sub.h, label: GW.LABELS.nest }); n.ref = sub.id; n.vol = GW.P(0);
    GW.ops.ensureTrack(s, 'v', ti); s.clips.push(n); GW.sel.clips.add(n.id); GW.commit('تداخل'); GW.bus.emit('project'); GW.bus.emit('selection');
  };
  C.reveal = () => { const c = sel().find(x => x.media); if (!c) { GW.toast('المقطع المحدد ليس من ملف وسائط'); return; } GW.sel.media.clear(); GW.sel.media.add(c.media); GW.showPanel('project'); GW.UI.renderProject && GW.UI.renderProject(); const el = document.querySelector(`[data-panel=project] .pitem[data-id="${c.media}"]`); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); };
  // keyframe navigation / clipboard (all animated params of the selected clip, playhead-relative like Premiere's Effect Controls)
  C.gotoKey = (dir) => { const s = GW.seq(); const cs = sel(); if (!cs.length) return; let best = null; for (const c of cs) if (GW.CamKeys) for (const t of GW.CamKeys.times(c)) { if (dir > 0 ? t > s.t + 1e-4 : t < s.t - 1e-4) { if (best == null || (dir > 0 ? t < best : t > best)) best = t; } } for (const c of cs) GW.eachParam(c, p => { if (!p.k) return; for (const k of p.k) { const t = c.start + k.t; if (dir > 0 ? t > s.t + 1e-4 : t < s.t - 1e-4) { if (best == null || (dir > 0 ? t < best : t > best)) best = t; } } }); if (best != null) GW.seek(best); else GW.toast(dir > 0 ? 'لا يوجد مفتاح تالٍ' : 'لا يوجد مفتاح سابق'); };
  C.copyKeys = () => { const s = GW.seq(); const c = sel()[0]; if (!c) return; const lt = s.t - c.start; const out = []; let i = 0; GW.eachParam(c, p => { const k = GW.keyAt(p, lt); if (k) out.push({ i, v: GW.clone(k.v), e: k.e, ez: k.ez ? GW.clone(k.ez) : undefined }); i++; }); if (!out.length) { GW.toast('لا توجد مفاتيح عند مؤشر التشغيل'); return; } GW.keyClipboard = { n: i, keys: out }; GW.toast('تم نسخ ' + out.length + ' مفتاح'); };
  C.pasteKeys = () => { const kb = GW.keyClipboard; if (!kb) return; const s = GW.seq(); const cs = sel(); if (!cs.length) return; let n = 0; for (const c of cs) { const lt = clamp(GW.snapFrame(s.t - c.start, s.fps), 0, c.dur); if (s.t < c.start || s.t > c.start + c.dur) continue; let i = 0; GW.eachParam(c, p => { const k = kb.keys.find(x => x.i === i); i++; if (!k) return; if (!p.k) p.k = []; const ex = GW.keyAt(p, lt); if (ex) { ex.v = GW.clone(k.v); ex.e = k.e; } else p.k.push({ t: lt, v: GW.clone(k.v), e: k.e || 'linear' }); p.k.sort((a, b) => a.t - b.t); n++; }); } if (n) { GW.commit('لصق مفاتيح'); GW.bus.emit('param'); GW.invalidate(); } else GW.toast('ضع مؤشر التشغيل داخل المقطع الهدف'); };
  C.zoomSel = () => { if (!GW.TL) return; const cs = sel(); const s = GW.seq(); let a, b; if (cs.length) { a = Math.min(...cs.map(c => c.start)); b = Math.max(...cs.map(c => c.start + c.dur)); } else if (s.inP != null && s.outP != null) { a = s.inP; b = s.outP; } else { GW.TL.fit(); return; } GW.TL.zoomTo(a, b); };
  C.rippleTrim = (side) => GW.TL && GW.TL.rippleTrimToPlayhead(side);
  C.maximize = () => { const f = document.querySelector('.frame:hover') || document.querySelector('.frame.focus'); if (!f) return; f.classList.toggle('max'); GW.toggleMax(f); };
  C.saveProject = (as) => GW.saveProject(as);
  C.openProject = () => GW.openProject();
  C.newProject = () => GW.newProjectCmd();
  C.projectSettings = () => GW.UI.seqSettings();
  C.shortcuts = () => (GW.Keys ? GW.Keys.dialog() : GW.UI.shortcuts());
  C.about = () => GW.modal({ title: 'حول قص قص', body: `<p><b>قص قص</b> — برنامج مونتاج احترافي مع خرائط حربية وتاريخية ثلاثية الأبعاد ومكتبة مؤثرات صوتية.</p><p>الإصدار ${GW.version || '1.0.0'}</p><p>بيانات الحدود: Natural Earth، CShapes 2.0 (ETH Zürich)، historical-basemaps (A. Ourednik). الصور الفضائية: Esri World Imagery، Sentinel-2 cloudless (EOX)، NASA Blue/Black Marble. محرك التصدير: FFmpeg.</p>` });
  C.relink = (m) => GW.UI.relink(m);
  C.res = (r) => { GW.Program && GW.Program.setRes(r); };
  C.safe = () => { GW.Program && GW.Program.toggleSafe(); };
  C.toggleProxies = () => GW.Media.toggleProxies();
  C.addTrack = (tt) => { const s = GW.seq(); GW.ops.ensureTrack(s, tt, (tt === 'v' ? s.vt : s.at).length); GW.commit('إضافة مسار'); };
  C.delEmptyTracks = () => { const s = GW.seq(); for (const tt of ['v', 'a']) { const arr = s[tt + 't']; for (let i = arr.length - 1; i > 0; i--) { if (!s.clips.some(c => c.tt === tt && c.ti === i)) { arr.splice(i, 1); s.clips.forEach(c => { if (c.tt === tt && c.ti > i) c.ti--; }); s.trans.forEach(x => { if (x.tt === tt && x.ti > i) x.ti--; }); } } } GW.commit('حذف المسارات الفارغة'); };
  C.freeze = () => { const s = GW.seq(); const c = sel()[0]; if (!c || c.kind !== 'video') { GW.toast('حدد مقطع فيديو'); return; } const t = s.t; if (t <= c.start || t >= c.start + c.dur) { GW.toast('ضع مؤشر التشغيل داخل المقطع'); return; } const b = GW.ops.split(s, c, t); const st = GW.srcTime(b, t); b.speed = 1e-4; b.in = st; GW.commit('تجميد الإطار'); };
  C.detachAudio = () => { const cs = sel(); cs.forEach(c => { if (c.link) GW.seq().clips.forEach(x => { if (x.link === c.link) x.link = null; }); }); GW.commit('فصل الصوت'); };

  /* ---------------- menus ---------------- */
  const LBL = () => GW.LABEL_SET.map(([n, c]) => ({ label: n, action: () => C.label(c) }));
  GW.MENUS = [
    ['ملف', () => [
      { label: 'مشروع جديد', key: 'Ctrl+Alt+N', action: C.newProject }, { label: 'فتح مشروع…', key: 'Ctrl+O', action: C.openProject },
      { label: 'المشاريع الأخيرة', sub: GW.recent().length ? GW.recent().map(p => ({ label: p, action: () => GW.openProject(p) })) : [{ label: 'لا يوجد' }] },
      { label: 'النسخ التلقائية (آخر 10)', sub: GW.versions().length ? GW.versions().slice().reverse().map(p => ({ label: p.split(/[\\/]/).pop(), action: () => GW.openProject(p) })) : [{ label: 'لا يوجد' }] },
      '-', { label: 'حفظ', key: 'Ctrl+S', action: () => C.saveProject(false) }, { label: 'حفظ باسم…', key: 'Ctrl+Shift+S', action: () => C.saveProject(true) },
      '-', { label: 'استيراد…', key: 'Ctrl+I', action: C.importMedia },
      { label: 'جديد', sub: [{ label: 'تسلسل…', action: C.newSeq }, { label: 'نص', action: () => C.newText() }, { label: 'خريطة حربية', action: C.newMap }, { label: 'لون ثابت', action: C.newColor }, { label: 'طبقة ضبط (Adjustment Layer)', action: C.newAdjust }, { label: 'طبقة فارغة (Null)', action: C.newNull }, { label: 'كاميرا', action: C.newCamera }] },
      '-', { label: 'تصدير وسائط…', key: 'Ctrl+M', action: C.exportMedia }, { label: 'تصدير الإطار الحالي (PNG)', key: 'Ctrl+Shift+E', action: C.exportFrame }, { label: 'صورة مصغرة ليوتيوب (JPG 1280×720)…', action: () => GW.UI.thumbnailDialog && GW.UI.thumbnailDialog() }, { label: 'قائمة التصدير…', action: () => GW.UI.exportQueueDialog && GW.UI.exportQueueDialog() },
      '-', { label: 'إعدادات التسلسل…', action: C.seqSettings }
    ]],
    ['تحرير', () => [
      { label: 'تراجع: ' + (GW.hist.labels[GW.hist.idx] || ''), key: 'Ctrl+Z', action: C.undo, disabled: GW.hist.idx <= 0 }, { label: 'إعادة', key: 'Ctrl+Shift+Z', action: C.redo, disabled: GW.hist.idx >= GW.hist.stack.length - 1 },
      '-', { label: 'قص', key: 'Ctrl+X', action: () => C.copy(true) }, { label: 'نسخ', key: 'Ctrl+C', action: () => C.copy() }, { label: 'لصق', key: 'Ctrl+V', action: () => C.paste() },
      { label: 'لصق مع إدراج', key: 'Ctrl+Shift+V', action: () => C.paste(true) }, { label: 'لصق السمات', key: 'Ctrl+Alt+V', action: C.pasteAttrs },
      { label: 'تكرار', key: 'Ctrl+Shift+/', action: C.duplicate },
      '-', { label: 'مسح', key: 'Delete', action: () => C.del(false) }, { label: 'مسح مع إزاحة', key: 'Shift+Delete', action: () => C.del(true) },
      '-', { label: 'تحديد الكل', key: 'Ctrl+A', action: C.selectAll }, { label: 'إلغاء التحديد', key: 'Ctrl+Shift+A', action: C.deselect },
      '-', { label: 'الشاشة الرئيسية', action: () => GW.UI.home() }, { label: 'اختصارات لوحة المفاتيح', action: C.shortcuts }
    ]],
    ['مقطع', () => [
      { label: 'إعادة تسمية…', action: C.rename }, { label: 'السرعة / المدة…', key: 'Ctrl+R', action: C.speed },
      { label: 'تفعيل / تعطيل', key: 'Shift+E', action: C.toggleEnable }, { label: 'ربط / فك ربط', key: 'Ctrl+L', action: C.link }, { label: 'فصل الصوت عن الفيديو', action: C.detachAudio },
      '-', { label: 'ملاءمة حجم الإطار', action: () => C.fitFrame(false) }, { label: 'ملء الإطار', action: () => C.fitFrame(true) }, { label: 'تجميد الإطار عند المؤشر', action: C.freeze },
      '-', { label: 'لون التسمية', sub: LBL() }
    ]],
    ['تسلسل', () => [
      { label: 'إعدادات التسلسل…', action: C.seqSettings }, { label: 'تسلسل جديد…', action: C.newSeq },
      '-', { label: 'إضافة تعديل', key: 'Ctrl+K', action: () => C.addEdit(false) }, { label: 'إضافة تعديل لكل المسارات', key: 'Ctrl+Shift+K', action: () => C.addEdit(true) },
      { label: 'تطبيق انتقال الفيديو الافتراضي', key: 'Ctrl+D', action: () => C.defaultTrans(false) }, { label: 'تطبيق انتقال الصوت الافتراضي', key: 'Ctrl+Shift+D', action: () => C.defaultTrans(true) },
      '-', { label: 'رفع', key: ';', action: () => C.lift(false) }, { label: 'استخراج', key: "'", action: () => C.lift(true) },
      { label: 'تشذيب مع إزاحة حتى المؤشر (السابق)', key: 'Q', action: () => C.rippleTrim('start') }, { label: 'تشذيب مع إزاحة حتى المؤشر (التالي)', key: 'W', action: () => C.rippleTrim('end') },
      '-', { label: 'تداخل (Nest)…', cmd: 'seq.nest', action: () => C.nest(false) }, { label: 'إنشاء تسلسل فرعي من التحديد', cmd: 'seq.subseq', action: () => C.nest(true) },
      '-', { label: 'إضافة مسار فيديو', action: () => C.addTrack('v') }, { label: 'إضافة مسار صوت', action: () => C.addTrack('a') }, { label: 'حذف المسارات الفارغة', action: C.delEmptyTracks },
      '-', { label: GW.VO && GW.VO.rec ? 'إيقاف تسجيل التعليق الصوتي' : 'تسجيل تعليق صوتي', key: GW.Keys ? GW.Keys.first('seq.voiceover') : '', action: () => GW.VO && GW.VO.toggle() }, { label: 'إعدادات التسجيل الصوتي…', action: () => GW.VO && GW.VO.settings() },
      '-', { label: 'تكبير الخط الزمني', key: '=', action: () => C.zoomTL(1) }, { label: 'تصغير الخط الزمني', key: '-', action: () => C.zoomTL(-1) }, { label: 'عرض التسلسل كاملًا', key: '\\', action: C.fitTL }, { label: 'تكبير إلى التحديد', cmd: 'seq.zoomSel', action: C.zoomSel }
    ]],
    ['علامات', () => [
      { label: 'تحديد نقطة الدخول', key: 'I', action: C.markIn }, { label: 'تحديد نقطة الخروج', key: 'O', action: C.markOut }, { label: 'تحديد حول المقطع', key: 'X', action: C.markClip }, { label: 'مسح الدخول والخروج', key: 'Ctrl+Shift+X', action: C.clearIO },
      '-', { label: 'إضافة علامة', key: 'M', action: C.marker }, { label: 'العلامة التالية', key: 'Shift+M', action: () => C.nextMarker(1) }, { label: 'العلامة السابقة', key: 'Ctrl+Shift+M', action: () => C.nextMarker(-1) }, { label: 'مسح كل العلامات', action: C.clearMarkers }
    ]],
    ['رسومات', () => [
      { label: 'نص جديد', key: 'Ctrl+T', action: () => C.newText() }, { label: 'قوالب العناوين', sub: GW.TITLE_PRESETS.map((p, i) => ({ label: p.n, action: () => C.newText(i) })) },
      '-', { label: 'خريطة حربية جديدة', key: 'Ctrl+G', action: C.newMap }, { label: 'تحرير الخريطة المحددة', action: () => GW.UI.openMapEditor() },
      '-', { label: 'مستطيل', action: () => C.newShape('rect') }, { label: 'دائرة', action: () => C.newShape('ellipse') }, { label: 'لون ثابت', action: C.newColor }, { label: 'طبقة ضبط (Adjustment Layer)', action: C.newAdjust }, { label: 'طبقة فارغة (Null)', action: C.newNull }, { label: 'كاميرا', action: C.newCamera }
    ]],
    ['عرض', () => [
      { label: 'دقة التشغيل', sub: [['auto', 'تلقائي'], [1, 'كاملة'], [.5, '1/2'], [.25, '1/4']].map(([v, n]) => ({ label: n, check: GW.Program && GW.Program.res === v, action: () => C.res(v) })) },
      { label: 'إظهار هوامش الأمان', check: GW.Program && GW.Program.safe, action: C.safe },
      { label: 'تبديل البروكسي', check: GW.Media.cfg.proxies, action: C.toggleProxies },
      { label: 'تكرار التشغيل', check: PB.loop, action: () => { PB.loop = !PB.loop; } },
      '-', { label: 'اللغة / Language', sub: [{ label: 'العربية', check: (GW.lang || 'ar') === 'ar', action: () => GW.setLang('ar') }, { label: 'English', check: GW.lang === 'en', action: () => GW.setLang('en') }] },
      '-', { label: 'ملء الشاشة', key: 'F11', action: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); } }
    ]],
    ['نافذة', () => [
      ...Object.keys(GW.WS).map(k => ({ label: 'مساحة عمل: ' + GW.WS[k].n, check: GW.active.ws === k, action: () => GW.setWorkspace(k) })), '-',
      ...['project', 'browser', 'source', 'program', 'timeline', 'fxc', 'effects', 'graphics', 'lumetri', 'scopes', 'mixer', 'sfx', 'markers', 'history', 'maps', 'mapcam'].map(id => ({ label: GW.panels[id] ? GW.panels[id].title : id, action: () => GW.showPanel(id) })),
      '-', { label: 'إعادة ضبط مساحة العمل', action: () => { try { localStorage.removeItem('gws.layout.' + GW.active.ws); } catch (e) {} GW.setWorkspace(GW.active.ws); } }
    ]],
    ['مساعدة', () => [{ label: 'الشاشة الرئيسية', action: () => GW.UI.home() }, { label: 'اختصارات لوحة المفاتيح', action: C.shortcuts }, { label: 'حول قص قص', action: C.about }]]
  ];
  function initMenus() {
    const nav = $('#menus'); let open = null;
    GW.MENUS.forEach(([name, items]) => {
      const b = document.createElement('button'); b.className = 'mb-i'; b.textContent = name;
      const show = () => { GW.closeMenus(); $$('.mb-i').forEach(x => x.classList.remove('open')); b.classList.add('open'); const r = b.getBoundingClientRect(); const m = GW.menu(r.right, r.bottom + 2, items()); m.style.left = (GW.lang === 'en' ? Math.min(innerWidth - m.offsetWidth - 4, r.left) : Math.max(4, r.right - m.offsetWidth)) + 'px'; open = b; m.addEventListener('click', () => { b.classList.remove('open'); open = null; }); };
      b.onmousedown = (e) => { e.preventDefault(); if (open === b && document.querySelector('.ctx')) { GW.closeMenus(); b.classList.remove('open'); open = null; } else show(); };
      b.onmouseenter = () => { if (open && open !== b && document.querySelector('.ctx')) show(); };
      nav.append(b);
    });
    document.addEventListener('mousedown', e => { if (!e.target.closest('.ctx') && !e.target.closest('.mb-i')) { $$('.mb-i').forEach(x => x.classList.remove('open')); open = null; } });
    const wsb = $('#workspaces');
    for (const k in GW.WS) { const b = document.createElement('button'); b.className = 'wsb'; b.dataset.ws = k; b.textContent = GW.WS[k].n; b.onclick = () => GW.setWorkspace(k); wsb.append(b); }
    $('#btnExport').onclick = C.exportMedia;
  }

  /* ---------------- keyboard ---------------- */
  let jkl = 0;
  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable || (e.target.closest && e.target.closest('[contenteditable=""],[contenteditable=true]'))) {
      // focus is never trapped: Esc (or Enter in a single-line field outside dialogs) hands the keyboard back to the editor
      if (e.key === 'Escape' || (e.key === 'Enter' && tag === 'input' && !e.target.closest('.modal,.ctx') && !e.shiftKey)) { if (!document.querySelector('.modal')) { e.target.blur(); if (GW.TL && GW.TL.tracksEl) GW.TL.tracksEl.focus({ preventScroll: true }); } }
      return;
    }
    if (e.isComposing || document.querySelector('.modal') || ($('#mapEditor') && !$('#mapEditor').hidden)) return;
    if (GW.Keys) { GW.Keys.handle(e); return; } // customizable bindings (js/shortcuts.js); the legacy table below is the fallback
    const k = e.key, K = k.length === 1 ? k.toLowerCase() : k, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, alt = e.altKey;
    const run = (f) => { e.preventDefault(); f(); };
    if (ctrl) {
      if (K === 'z') return run(sh ? C.redo : C.undo); if (K === 'y') return run(C.redo);
      if (K === 's') return run(() => C.saveProject(sh)); if (K === 'o') return run(C.openProject); if (K === 'i') return run(C.importMedia);
      if (K === 'm') return run(C.exportMedia); if (K === 'e' && sh) return run(C.exportFrame);
      if (K === 'k') return run(() => C.addEdit(sh)); if (K === 'd') return run(() => C.defaultTrans(sh));
      if (K === 'c') return run(() => C.copy()); if (K === 'x') return run(sh ? C.clearIO : () => C.copy(true)); if (K === 'v') return run(alt ? C.pasteAttrs : () => C.paste(sh));
      if (K === 'a') return run(sh ? C.deselect : C.selectAll); if (K === 'l') return run(C.link); if (K === 'r') return run(C.speed);
      if (K === 't') return run(() => C.newText()); if (K === 'g') return run(C.newMap); if (K === 'n' && alt) return run(C.newProject);
      if (K === '/' && sh) return run(C.duplicate); if (K === 'm' && sh) return run(() => C.nextMarker(-1));
      return;
    }
    switch (K) {
      case ' ': return run(() => GW.play(1));
      case 'l': return run(() => { jkl = PB.playing && PB.rate > 0 ? Math.min(8, PB.rate * 2) : 1; GW.stop(); GW.play(jkl); });
      case 'k': return run(() => { if (!GW.pb.playing && GW.CamKeys && GW.CamKeys.kKey()) return; GW.stop(); });
      case 'j': return run(() => { jkl = PB.playing && PB.rate < 0 ? Math.max(-8, PB.rate * 2) : -1; GW.stop(); GW.play(jkl); });
      case 'ArrowLeft': return run(() => C.step(sh ? -5 : -1)); case 'ArrowRight': return run(() => C.step(sh ? 5 : 1));
      case 'ArrowUp': return run(() => C.editPoint(-1)); case 'ArrowDown': return run(() => C.editPoint(1));
      case 'Home': return run(C.home); case 'End': return run(C.end);
      case 'i': return run(C.markIn); case 'o': return run(C.markOut); case 'x': return run(C.markClip);
      case 'm': return run(sh ? () => C.nextMarker(1) : C.marker);
      case 'Delete': return run(() => C.del(sh)); case 'Backspace': return run(() => C.del(sh));
      case '=': case '+': return run(() => C.zoomTL(1)); case '-': return run(() => C.zoomTL(-1)); case '\\': return run(C.fitTL);
      case ';': return run(() => C.lift(false)); case "'": return run(() => C.lift(true));
      case ',': return run(() => GW.Source && GW.Source.edit('insert')); case '.': return run(() => GW.Source && GW.Source.edit('overwrite'));
      case 'q': return run(() => C.rippleTrim('start')); case 'w': return run(() => C.rippleTrim('end'));
      case 'v': return run(() => C.tool('select')); case 'c': return run(() => C.tool('razor')); case 'b': return run(() => C.tool('ripple'));
      case 'n': return run(() => C.tool('roll')); case 'r': return run(() => C.tool('rate')); case 'y': return run(() => C.tool('slip'));
      case 'h': return run(() => C.tool('hand')); case 'z': return run(() => C.tool('zoom')); case 'a': return run(() => C.tool('track')); case 't': return run(() => C.tool('text')); case 'p': return run(() => C.tool('pen'));
      case 'E': if (sh) return run(C.toggleEnable); break;
      case 'e': if (sh) return run(C.toggleEnable); break;
      case '`': return run(C.maximize);
      case 'Escape': return run(C.deselect);
    }
  }
  GW.toggleMax = (f) => {
    if (f.classList.contains('max')) { f._ph = document.createElement('div'); f._ph.style.display = 'none'; f.after(f._ph); f.style.cssText = 'position:fixed;inset:36px 6px 26px 6px;z-index:90'; }
    else { f.style.cssText = ''; if (f._ph) f._ph.remove(); }
    GW.bus.emit('layout');
  };

  /* ---------------- project files ---------------- */
  GW.recent = () => { try { return JSON.parse(localStorage.getItem('gws.recent') || '[]'); } catch (e) { return []; } };
  function addRecent(p) { try { const r = GW.recent().filter(x => x !== p); r.unshift(p); localStorage.setItem('gws.recent', JSON.stringify(r.slice(0, 10))); } catch (e) {} }
  // one compact stringify of the live project (no deep clone): transient map caches are lifted out and restored
  function serialize() {
    const P = GW.prj, lifted = [];
    for (const s of P.seqs) for (const c of s.clips) if (c.map && c.map.scene && '__auto' in c.map.scene) { lifted.push([c.map.scene, c.map.scene.__auto]); delete c.map.scene.__auto; }
    try { const j = JSON.stringify(P); return j.slice(0, -1) + ',"savedAt":' + Date.now() + ',"app":"QassQass","version":1}'; }
    finally { for (const [sc, v] of lifted) sc.__auto = v; }
  }
  GW.serializeProject = serialize;
  GW.saveProject = async (as) => {
    if (!window.gws) { GW.toast('الحفظ متاح في نسخة سطح المكتب'); return false; }
    let p = GW.prj.path;
    if (as || !p) { const paths = await gws.paths(); p = await gws.saveDialog({ title: 'حفظ المشروع', defaultPath: (paths.renders) + paths.sep + (GW.prj.name || 'مشروع') + '.qass', filter: 'project' }); if (!p) return false; }
    GW.prj.path = p; GW.prj.name = p.split(/[\\/]/).pop().replace(/\.(gwproj|qass)$/i, '');
    await gws.writeText(p, serialize()); addRecent(p);
    GW.hist.saved = JSON.stringify(GW.prj); GW.hist.stack[GW.hist.idx] = GW.hist.saved; GW.markDirty(); GW.toast('تم حفظ المشروع'); GW.status('تم الحفظ: ' + p);
    return true;
  };
  GW.loadProjectData = async (data, path) => {
    GW.stop(); for (const id in GW.rt.v) GW.Media.dropVid(id);
    const o = JSON.parse(data); if (!o.seqs) throw new Error('bad project');
    o.path = path || null; GW.prj = o; GW.sel.clips.clear();
    { const keep = new Set((o.media || []).map(m => m.id)); for (const id in GW.rt.m) if (!keep.has(id)) delete GW.rt.m[id]; } // release decoded audio/thumbs of the previous project
    GW.hist.reset('فتح المشروع'); GW.bus.emit('project'); GW.bus.emit('media');
    if (GW.Media.Proxy) GW.Media.Proxy.cancelAll();
    // lazy, bounded preparation: metadata + cache lookups only; peaks/thumbs/audio load from the disk cache on demand
    const em = GW.debounce(() => { GW.bus.emit('media'); GW.invalidate(); }, 250);
    GW.prjLoadT0 = performance.now();
    GW.Media.prepareAll(GW.prj.media).then(() => { GW.prjLoadMs = performance.now() - GW.prjLoadT0; em(); if (GW.UI.offlineCheck && GW.prj === o && !GW.noOfflineDialog) GW.UI.offlineCheck().catch(() => {}); }).catch(() => {});
    for (const m of GW.prj.media) GW.Media.ensureRt(m);
    GW.invalidate();
  };
  GW.openProject = async (path) => {
    if (!window.gws) return;
    if (!path) { const f = await gws.open({ filter: 'project', title: 'فتح مشروع' }); if (!f.length) return; path = f[0].path; }
    if (!(await GW.confirmDiscard())) return;
    try { await GW.loadProjectData(await gws.readText(path), path); addRecent(path); GW.toast('تم فتح المشروع'); }
    catch (e) { console.error(e); GW.toast('تعذر فتح المشروع: ' + e.message, 'err'); }
  };
  GW.confirmDiscard = async () => { if (GW.hist.stack[GW.hist.idx] === GW.hist.saved) return true; return GW.ask('تغييرات غير محفوظة', 'هناك تغييرات غير محفوظة في المشروع الحالي. هل تريد المتابعة بدون حفظ؟', 'متابعة بدون حفظ'); };
  GW.newProjectCmd = async () => {
    if (!(await GW.confirmDiscard())) return;
    GW.stop(); for (const id in GW.rt.v) GW.Media.dropVid(id);
    GW.prj = GW.newProject(); GW.sel.clips.clear(); GW.hist.reset('مشروع جديد'); GW.bus.emit('project'); GW.bus.emit('media'); GW.invalidate();
  };
  // autosave every 2 minutes while there are unsaved changes: autosave.qass + a timestamped copy in versions/ (last 10 kept)
  let lastAutosaved = null;
  async function autosave() {
    if (!window.gws || GW.hist.stack[GW.hist.idx] === GW.hist.saved) return;
    const cur = GW.hist.stack[GW.hist.idx]; if (cur === lastAutosaved) return; lastAutosaved = cur;
    try {
      const p = await gws.paths(); const data = serialize(); await gws.writeText(p.userData + p.sep + 'autosave.qass', data);
      const dir = p.userData + p.sep + 'versions'; const name = (GW.prj.name || 'مشروع').replace(/[\\/:*?"<>|]/g, '_');
      const stamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 23); await gws.writeText(dir + p.sep + name + '_' + stamp + '.qass', data);
      let list = []; try { list = JSON.parse(localStorage.getItem('gws.versions') || '[]'); } catch (e) {}
      list = list.filter(x => x !== dir + p.sep + name + '_' + stamp + '.qass'); list.push(dir + p.sep + name + '_' + stamp + '.qass'); while (list.length > 10) { const old = list.shift(); try { await gws.remove(old); } catch (e) {} }
      try { localStorage.setItem('gws.versions', JSON.stringify(list)); } catch (e) {}
      if (gws.listDir) { try { const d = await gws.listDir(dir); const olds = (d.entries || []).filter(x => !x.dir && /\.qass$/.test(x.name)).sort((x, y) => y.mtimeMs - x.mtimeMs).slice(10); for (const o of olds) await gws.remove(o.path); } catch (e) {} } // cap survives a lost localStorage
      GW.status('حفظ تلقائي: ' + new Date().toLocaleTimeString('en-GB'));
    } catch (e) { console.warn('autosave', e); }
  }
  GW.autosaveNow = autosave;
  setInterval(autosave, 120000);
  GW.versions = () => { try { return JSON.parse(localStorage.getItem('gws.versions') || '[]'); } catch (e) { return []; } };
  GW.status = (msg) => { const el = $('#stMsg'); if (el) el.textContent = msg; };

  GW.initShell = () => {
    initMenus(); initSplitters();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { GW.bus.emit('layout'); GW.invalidate(); });
    document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
    // OS file drop → import (and onto timeline if dropped there)
    let dragDepth = 0;
    window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#dropHint').hidden = false; } });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropHint').hidden = true; });
    window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', async e => {
      dragDepth = 0; $('#dropHint').hidden = true;
      if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault();
      const files = [...e.dataTransfer.files].map(f => ({ file: window.gws ? null : f, name: f.name, path: window.gws && window.gws.pathFor ? window.gws.pathFor(f) : (f.path || null), size: f.size }));
      const added = await GW.Media.importFiles(files);
      if (added.length && e.target.closest && e.target.closest('.tl-tracks') && GW.TL) GW.TL.dropMediaAt(added, e);
    });
    if (window.gws) gws.onSaveThenClose(async () => { if (await GW.saveProject(false)) gws.closeNow(); });
    GW.bus.emit('ready');
  };
})();
