'use strict';
/* Boot: build the shell, restore the workspace, connect the map engine, start the render loop */
(async function () {
  const { $ } = GW;
  GW.initShell();
  let ws = 'edit'; try { ws = localStorage.getItem('gws.ws') || 'edit'; } catch (e) {}
  GW.setWorkspace(GW.WS[ws] ? ws : 'edit');
  GW.hist.reset('مشروع جديد');
  GW.bus.on('project', () => { const s = GW.seq(); $('#stSeq').textContent = `${s.name} · ${s.w}×${s.h} · ${s.fps} إطار/ث`; GW.markDirty(); });
  GW.bus.on('changed', () => { const s = GW.seq(); $('#stSeq').textContent = `${s.name} · ${s.w}×${s.h} · ${s.fps} إطار/ث`; });
  GW.bus.emit('project');
  // map engine: redraw when tiles / data arrive
  if (GW.Atlas) GW.Atlas.onAsset = () => GW.invalidate();
  GW.startLoop();
  if (window.gws) {
    const p = await gws.paths(); GW.version = p.version;
    const ok = await gws.ffAvailable(); if (!ok) { $('#ffWarn').hidden = false; GW.toast('لم يتم العثور على محرك FFmpeg: التصدير والتحويل غير متاحين', 'err'); }
    gws.onOpenFile(f => GW.openProject(f));
    const argFile = gws.argvFile ? await gws.argvFile() : null;
    if (argFile) { await GW.openProject(argFile); GW.status('تم فتح: ' + argFile); return; }
    let restored = false;
    try {
      const auto = p.userData + p.sep + 'autosave.qass';
      if (await gws.exists(auto)) {
        const txt = await gws.readText(auto); const o = JSON.parse(txt);
        if (o && o.seqs && o.seqs.some(s => s.clips.length) && Date.now() - (o.savedAt || 0) < 7 * 864e5) {
          if (await GW.ask('استعادة العمل', 'تم العثور على نسخة محفوظة تلقائيًا من آخر جلسة (' + new Date(o.savedAt).toLocaleString(GW.lang === 'en' ? 'en' : 'ar') + '). هل تريد استعادتها؟', 'استعادة')) { await GW.loadProjectData(txt, o.path || null); GW.hist.saved = null; GW.markDirty(); restored = true; }
          else await gws.remove(auto);
        }
      }
    } catch (e) { console.warn(e); }
    if (!restored && !gws.test && GW.UI.home) GW.UI.home();
  }
  GW.status('جاهز — اسحب ملفاتك إلى لوحة المشروع للبدء');
})();
