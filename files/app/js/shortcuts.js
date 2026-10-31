'use strict';
/* Keyboard shortcuts: command registry, bindings (presets + user overrides), key dispatch and the
   Premiere-style "اختصارات لوحة المفاتيح" dialog.
   - Every command: { id, cat, label, defaults: [combo…], run(e), rep?: allow key-repeat, fixed?: not editable / handled elsewhere }
   - A combo is a canonical string "Ctrl+Alt+Shift+Key" built from the PHYSICAL key (KeyboardEvent.code), so
     shortcuts work the same with an Arabic keyboard layout. Keys: A–Z, 0–9, F1–F24, Num0–Num9, Num+ Num- Num* Num/ Num. NumEnter,
     Left Right Up Down, Space, Enter, Tab, Escape, Backspace, Delete, Insert, Home, End, PageUp, PageDown, and - = [ ] \ ; ' , . / `
   - Persisted in localStorage 'gws.keys' as { preset, over: { id: [combos] } } (over = differences from the preset).
   API: GW.Keys.handle(e) · .combo(e) · .get(id) · .set(id, combos) · .label(id) · .preset(name) · .reset(id?) · .export() · .import(obj) · .dialog() */
(function () {
  const { esc } = GW;
  const K = GW.Keys = { cmds: {}, order: [], cats: [], preset: 'qass', over: {}, map: new Map() };
  const C = () => GW.cmd;
  const PB = () => GW.pb;

  /* ---------------- key names ---------------- */
  const CODE = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlBackslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    NumpadAdd: 'Num+', NumpadSubtract: 'Num-', NumpadMultiply: 'Num*', NumpadDivide: 'Num/', NumpadDecimal: 'Num.', NumpadEnter: 'NumEnter', NumpadEqual: 'Num=' };
  const KEYFALL = { ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Esc: 'Escape', Del: 'Delete', '+': '=', _: '-' };
  const MODS = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'OS', 'Hyper', 'Super'];
  K.keyName = (e) => {
    const c = e.code || '';
    let m;
    if ((m = /^Key([A-Z])$/.exec(c))) return m[1];
    if ((m = /^Digit(\d)$/.exec(c))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(c))) return 'Num' + m[1];
    if (/^F\d{1,2}$/.test(c)) return c;
    if (CODE[c]) return CODE[c];
    const k = e.key || ''; if (!k || MODS.includes(k) || k === 'Unidentified' || k === 'Dead' || k === 'Process') return null;
    if (KEYFALL[k]) return KEYFALL[k];
    if (/^F\d{1,2}$/.test(k)) return k;
    return k.length === 1 ? k.toUpperCase() : k;
  };
  K.combo = (e) => { const k = K.keyName(e); if (!k) return null; return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + k; };
  // canonical form of a user/preset written combo ("shift+ctrl+k" → "Ctrl+Shift+K")
  K.norm = (s) => {
    s = String(s || '').trim(); if (!s) return null;
    let ctrl = 0, alt = 0, sh = 0, m;
    const MRE = /^(ctrl|control|cmd|meta|command|alt|option|opt|shift)\s*\+\s*/i;
    while ((m = MRE.exec(s)) && s.length > m[0].length) { const l = m[1].toLowerCase(); if (l === 'alt' || l === 'option' || l === 'opt') alt = 1; else if (l === 'shift') sh = 1; else ctrl = 1; s = s.slice(m[0].length); }
    let key = s.trim(); if (!key) return null;
    const alias = { esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', backspace: 'Backspace', space: 'Space', spacebar: 'Space', enter: 'Enter', return: 'Enter', tab: 'Tab', ins: 'Insert', insert: 'Insert', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', pgup: 'PageUp', pgdn: 'PageDown', left: 'Left', right: 'Right', up: 'Up', down: 'Down', arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down', '←': 'Left', '→': 'Right', '↑': 'Up', '↓': 'Down', plus: '=', '+': '=', minus: '-', '_': '-', numenter: 'NumEnter' };
    const l = key.toLowerCase();
    if (alias[l]) key = alias[l];
    else if (/^f\d{1,2}$/.test(l)) key = l.toUpperCase();
    else if (/^num(pad)?\s*(\d|[+\-*/.=])$/.test(l)) key = 'Num' + l.slice(-1);
    else if (key.length === 1) key = key.toUpperCase();
    return (ctrl ? 'Ctrl+' : '') + (alt ? 'Alt+' : '') + (sh ? 'Shift+' : '') + key;
  };

  /* ---------------- command registry ---------------- */
  const CATS = [['file', 'ملف'], ['edit', 'تحرير'], ['clip', 'مقطع'], ['seq', 'تسلسل'], ['mark', 'علامات'], ['play', 'التشغيل والتنقل'], ['tool', 'الأدوات'], ['gfx', 'رسومات'], ['view', 'عرض ونافذة']];
  K.cats = CATS;
  const def = (id, label, defaults, run, o = {}) => { K.cmds[id] = { id, cat: id.split('.')[0], label, defaults: defaults.map(K.norm), run, ...o }; K.order.push(id); };
  K.register = def; // other modules may add commands: GW.Keys.register('x.y', 'اسم', ['Ctrl+…'], fn)
  let jkl = 0;
  // file
  def('file.newProject', 'مشروع جديد', ['Ctrl+Alt+N'], () => C().newProject());
  def('file.open', 'فتح مشروع…', ['Ctrl+O'], () => C().openProject());
  def('file.save', 'حفظ', ['Ctrl+S'], () => C().saveProject(false));
  def('file.saveAs', 'حفظ باسم…', ['Ctrl+Shift+S'], () => C().saveProject(true));
  def('file.import', 'استيراد…', ['Ctrl+I'], () => C().importMedia());
  def('file.export', 'تصدير وسائط…', ['Ctrl+M'], () => C().exportMedia());
  def('file.exportFrame', 'تصدير الإطار الحالي (PNG)', ['Ctrl+Shift+E'], () => C().exportFrame());
  def('file.newSeq', 'تسلسل جديد…', [], () => C().newSeq());
  def('file.seqSettings', 'إعدادات التسلسل…', [], () => C().seqSettings());
  // edit
  def('edit.undo', 'تراجع', ['Ctrl+Z'], () => C().undo(), { rep: 1 });
  def('edit.redo', 'إعادة', ['Ctrl+Shift+Z', 'Ctrl+Y'], () => C().redo(), { rep: 1 });
  def('edit.cut', 'قص', ['Ctrl+X'], () => C().copy(true));
  def('edit.copy', 'نسخ', ['Ctrl+C'], () => C().copy());
  def('edit.paste', 'لصق', ['Ctrl+V'], () => C().paste());
  def('edit.pasteInsert', 'لصق مع إدراج', ['Ctrl+Shift+V'], () => C().paste(true));
  def('edit.pasteAttrs', 'لصق السمات', ['Ctrl+Alt+V'], () => C().pasteAttrs());
  def('edit.duplicate', 'تكرار', ['Ctrl+Shift+/'], () => C().duplicate());
  def('edit.clear', 'مسح', ['Delete', 'Backspace'], () => C().del(false));
  def('edit.rippleDelete', 'مسح مع إزاحة', ['Shift+Delete', 'Shift+Backspace'], () => C().del(true));
  def('edit.selectAll', 'تحديد الكل', ['Ctrl+A'], () => C().selectAll());
  def('edit.deselect', 'إلغاء التحديد', ['Ctrl+Shift+A', 'Escape'], () => C().deselect());
  def('edit.shortcuts', 'اختصارات لوحة المفاتيح…', ['Ctrl+Alt+K'], () => K.dialog());
  // clip
  def('clip.rename', 'إعادة تسمية…', ['F2'], () => C().rename());
  def('clip.reveal', 'إظهار في لوحة المشروع', ['Shift+F'], () => C().reveal());
  def('clip.speed', 'السرعة / المدة…', ['Ctrl+R'], () => C().speed());
  def('clip.enable', 'تفعيل / تعطيل', ['Shift+E'], () => C().toggleEnable());
  def('clip.link', 'ربط / فك ربط', ['Ctrl+L'], () => C().link());
  def('clip.detachAudio', 'فصل الصوت عن الفيديو', [], () => C().detachAudio());
  def('clip.fitFrame', 'ملاءمة حجم الإطار', [], () => C().fitFrame(false));
  def('clip.fillFrame', 'ملء الإطار', [], () => C().fitFrame(true));
  def('clip.freeze', 'تجميد الإطار عند المؤشر', [], () => C().freeze());
  def('clip.nudgeL', 'تحريك المقطع إطارًا لليسار', ['Alt+Left'], () => C().nudge(-1), { rep: 1 });
  def('clip.nudgeR', 'تحريك المقطع إطارًا لليمين', ['Alt+Right'], () => C().nudge(1), { rep: 1 });
  def('clip.nudgeL5', 'تحريك المقطع 5 إطارات لليسار', ['Alt+Shift+Left'], () => C().nudge(-5), { rep: 1 });
  def('clip.nudgeR5', 'تحريك المقطع 5 إطارات لليمين', ['Alt+Shift+Right'], () => C().nudge(5), { rep: 1 });
  // sequence
  def('seq.addEdit', 'إضافة تعديل', ['Ctrl+K'], () => C().addEdit(false));
  def('seq.addEditAll', 'إضافة تعديل لكل المسارات', ['Ctrl+Shift+K'], () => C().addEdit(true));
  def('seq.transV', 'تطبيق انتقال الفيديو الافتراضي', ['Ctrl+D'], () => C().defaultTrans(false));
  def('seq.transA', 'تطبيق انتقال الصوت الافتراضي', ['Ctrl+Shift+D'], () => C().defaultTrans(true));
  def('seq.lift', 'رفع', [';'], () => C().lift(false));
  def('seq.extract', 'استخراج', ["'"], () => C().lift(true));
  def('seq.rippleTrimPrev', 'تشذيب مع إزاحة حتى المؤشر (السابق)', ['Q'], () => C().rippleTrim('start'));
  def('seq.rippleTrimNext', 'تشذيب مع إزاحة حتى المؤشر (التالي)', ['W'], () => C().rippleTrim('end'));
  def('seq.insert', 'إدراج من المصدر', [','], () => GW.Source && GW.Source.edit('insert'));
  def('seq.overwrite', 'استبدال من المصدر', ['.'], () => GW.Source && GW.Source.edit('overwrite'));
  def('seq.addTrackV', 'إضافة مسار فيديو', [], () => C().addTrack('v'));
  def('seq.addTrackA', 'إضافة مسار صوت', [], () => C().addTrack('a'));
  def('seq.delEmptyTracks', 'حذف المسارات الفارغة', [], () => C().delEmptyTracks());
  def('seq.voiceover', 'تسجيل تعليق صوتي (بدء / إيقاف)', ['Ctrl+Alt+R'], () => GW.VO && GW.VO.toggle());
  def('seq.zoomIn', 'تكبير الخط الزمني', ['=', 'Shift+=', 'Num+'], () => C().zoomTL(1), { rep: 1 });
  def('seq.zoomOut', 'تصغير الخط الزمني', ['-', 'Num-'], () => C().zoomTL(-1), { rep: 1 });
  def('seq.fit', 'عرض التسلسل كاملًا', ['\\'], () => C().fitTL());
  def('seq.zoomSel', 'تكبير إلى التحديد', ['Shift+\\'], () => C().zoomSel());
  def('seq.nest', 'تداخل (Nest)…', [], () => C().nest(false));
  def('seq.subseq', 'إنشاء تسلسل فرعي من التحديد', [], () => C().nest(true));
  def('seq.deleteGap', 'حذف الفراغ عند المؤشر مع إزاحة', [], () => GW.TL && GW.TL.rippleDeleteGapAtPlayhead());
  def('seq.snap', 'المحاذاة المغناطيسية (تشغيل / إيقاف)', ['S'], () => { const TL = GW.TL; if (!TL) return; TL.snap = !TL.snap; const b = TL.el && TL.el.querySelector('[data-a=snap]'); if (b) b.classList.toggle('on', TL.snap); GW.toast(TL.snap ? 'المحاذاة: تشغيل' : 'المحاذاة: إيقاف'); });
  // markers
  def('mark.in', 'تحديد نقطة الدخول', ['I'], () => C().markIn());
  def('mark.out', 'تحديد نقطة الخروج', ['O'], () => C().markOut());
  def('mark.clip', 'تحديد حول المقطع', ['X'], () => C().markClip());
  def('mark.clearIO', 'مسح الدخول والخروج', ['Ctrl+Shift+X'], () => C().clearIO());
  def('mark.add', 'إضافة علامة', ['M'], () => C().marker());
  def('mark.next', 'العلامة التالية', ['Shift+M'], () => C().nextMarker(1));
  def('mark.prev', 'العلامة السابقة', ['Ctrl+Shift+M'], () => C().nextMarker(-1));
  def('mark.clearAll', 'مسح كل العلامات', [], () => C().clearMarkers());
  // playback & navigation
  def('play.toggle', 'تشغيل / إيقاف', ['Space'], () => GW.play(1));
  def('play.fwd', 'تشغيل للأمام (أسرع مع كل ضغطة)', ['L'], () => { const p = PB(); jkl = p.playing && p.rate > 0 ? Math.min(8, p.rate * 2) : 1; GW.stop(); GW.play(jkl); });
  def('play.stop', 'إيقاف (أو مفتاح كاميرا للخريطة المحددة عند التوقف)', ['K'], () => { if (!GW.pb.playing && GW.CamKeys && GW.CamKeys.kKey()) return; GW.stop(); });
  def('play.rev', 'تشغيل للخلف (أسرع مع كل ضغطة)', ['J'], () => { const p = PB(); jkl = p.playing && p.rate < 0 ? Math.max(-8, p.rate * 2) : -1; GW.stop(); GW.play(jkl); });
  def('play.stepB', 'إطار للخلف', ['Left'], () => C().step(-1), { rep: 1 });
  def('play.stepF', 'إطار للأمام', ['Right'], () => C().step(1), { rep: 1 });
  def('play.stepB5', '5 إطارات للخلف', ['Shift+Left'], () => C().step(-5), { rep: 1 });
  def('play.stepF5', '5 إطارات للأمام', ['Shift+Right'], () => C().step(5), { rep: 1 });
  def('play.prevEdit', 'نقطة التعديل السابقة', ['Up'], () => C().editPoint(-1), { rep: 1 });
  def('play.nextEdit', 'نقطة التعديل التالية', ['Down'], () => C().editPoint(1), { rep: 1 });
  def('play.home', 'الذهاب إلى البداية', ['Home'], () => C().home());
  def('play.end', 'الذهاب إلى النهاية', ['End'], () => C().end());
  def('play.loop', 'تكرار التشغيل (تشغيل / إيقاف)', [], () => { PB().loop = !PB().loop; GW.toast(PB().loop ? 'تكرار التشغيل: تشغيل' : 'تكرار التشغيل: إيقاف'); });
  // tools
  for (const [t, n, k] of [['select', 'أداة التحديد', 'V'], ['track', 'تحديد المسار للأمام', 'A'], ['ripple', 'تعديل مع إزاحة', 'B'], ['roll', 'تعديل متدحرج', 'N'], ['rate', 'تمديد السرعة', 'R'], ['razor', 'أداة القص (الشفرة)', 'C'], ['slip', 'أداة الانزلاق', 'Y'], ['slide', 'أداة الانزلاق مع تحريك', 'U'], ['pen', 'أداة القلم / المفاتيح', 'P'], ['hand', 'أداة اليد', 'H'], ['zoom', 'أداة التكبير', 'Z'], ['text', 'أداة النص', 'T']]) def('tool.' + t, n, [k], () => C().tool(t));
  // graphics
  def('gfx.newText', 'نص جديد', ['Ctrl+T'], () => C().newText());
  def('gfx.newMap', 'خريطة حربية جديدة', ['Ctrl+G'], () => C().newMap());
  def('gfx.editMap', 'تحرير الخريطة المحددة', [], () => GW.UI.openMapEditor());
  def('gfx.rect', 'مستطيل', [], () => C().newShape('rect'));
  def('gfx.ellipse', 'دائرة', [], () => C().newShape('ellipse'));
  def('gfx.color', 'لون ثابت', [], () => C().newColor());
  def('gfx.adjust', 'طبقة ضبط', [], () => C().newAdjust());
  // keyframe interpolation (Effect Controls; After Effects keys): selected keyframe, else the selected clip's keys under the playhead
  def('gfx.easyEase', 'تسهيل سهل للمفاتيح (Easy Ease)', ['F9'], () => GW.FXC && GW.FXC.easeKeys('ease'));
  def('gfx.easeIn', 'تسهيل دخول المفاتيح', ['Shift+F9'], () => GW.FXC && GW.FXC.easeKeys('easeIn'));
  def('gfx.easeOut', 'تسهيل خروج المفاتيح', ['Ctrl+Shift+F9'], () => GW.FXC && GW.FXC.easeKeys('easeOut'));
  def('gfx.keyHold', 'مفتاح ثابت (Hold) تشغيل / إيقاف', ['Ctrl+Alt+H'], () => GW.FXC && GW.FXC.easeKeys('hold'));
  def('gfx.keyLinear', 'استيفاء خطي للمفاتيح', [], () => GW.FXC && GW.FXC.easeKeys('linear'));
  def('gfx.prevKey', 'المفتاح السابق (المقطع المحدد)', ['['], () => C().gotoKey(-1), { rep: 1 });
  def('gfx.nextKey', 'المفتاح التالي (المقطع المحدد)', [']'], () => C().gotoKey(1), { rep: 1 });
  def('gfx.copyKeys', 'نسخ مفاتيح الحركة عند المؤشر', ['Ctrl+Alt+C'], () => C().copyKeys());
  def('gfx.pasteKeys', 'لصق مفاتيح الحركة عند المؤشر', ['Ctrl+Alt+Shift+V'], () => C().pasteKeys());
  def('gfx.templates', 'مكتبة قوالب الرسوم المتحركة', [], () => GW.UI.egTab && GW.UI.egTab('mg'));
  // view & window
  def('view.maximize', 'تكبير اللوحة تحت المؤشر', ['`'], () => C().maximize());
  def('view.fullscreen', 'ملء الشاشة', ['F11'], () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }, { fixed: 1 });
  def('view.safe', 'إظهار هوامش الأمان', [], () => C().safe());
  def('view.home', 'الشاشة الرئيسية', [], () => GW.UI.home && GW.UI.home());
  ['edit', 'color', 'effects', 'audio', 'graphics', 'maps'].forEach((ws, i) => def('view.ws.' + ws, 'مساحة عمل: ' + ((GW.WS && GW.WS[ws]) ? GW.WS[ws].n : ws), ['Alt+Shift+' + (i + 1)], () => GW.setWorkspace(ws)));
  const RESERVED = { F12: 'أدوات المطور', 'Ctrl+Shift+I': 'أدوات المطور' };

  /* ---------------- presets ---------------- */
  const PRESETS = {
    qass: { n: 'قص قص الافتراضي', over: {} },
    premiere: { n: 'Adobe Premiere Pro', over: {
      'edit.redo': ['Ctrl+Shift+Z'], 'edit.deselect': ['Ctrl+Shift+A'], 'seq.zoomIn': ['='], 'seq.zoomOut': ['-'], 'gfx.newMap': [], 'edit.shortcuts': ['Ctrl+Alt+K'],
      'play.prevEdit': ['Up'], 'play.nextEdit': ['Down'], 'clip.enable': ['Shift+E'], 'mark.clearIO': ['Ctrl+Shift+X'], 'view.ws.edit': ['Alt+Shift+1'], 'view.ws.color': ['Alt+Shift+2'], 'view.ws.effects': ['Alt+Shift+3'], 'view.ws.audio': ['Alt+Shift+4'], 'view.ws.graphics': ['Alt+Shift+5'], 'view.ws.maps': ['Alt+Shift+6']
    } },
    resolve: { n: 'DaVinci Resolve', over: {
      'file.newSeq': ['Ctrl+N'], 'edit.redo': ['Ctrl+Shift+Z'], 'edit.pasteAttrs': ['Alt+V'], 'edit.clear': ['Backspace'], 'edit.rippleDelete': ['Delete', 'Shift+Backspace'], 'edit.duplicate': [], 'edit.deselect': ['Ctrl+Shift+A', 'Escape'],
      'clip.enable': ['D'], 'clip.link': ['Ctrl+Alt+L'], 'clip.speed': ['R'], 'clip.freeze': ['Shift+R'],
      'clip.nudgeL': [','], 'clip.nudgeR': ['.'], 'clip.nudgeL5': ['Shift+,'], 'clip.nudgeR5': ['Shift+.'],
      'seq.addEdit': ['Ctrl+B', 'Ctrl+\\'], 'seq.addEditAll': ['Ctrl+Shift+\\'], 'seq.transV': ['Alt+T', 'Ctrl+T'], 'seq.transA': ['Shift+T'], 'seq.lift': [], 'seq.extract': [],
      'seq.rippleTrimPrev': ['Ctrl+Shift+['], 'seq.rippleTrimNext': ['Ctrl+Shift+]'], 'seq.insert': ['F9'], 'seq.overwrite': ['F10'],
      'seq.zoomIn': ['Ctrl+='], 'seq.zoomOut': ['Ctrl+-'], 'seq.fit': ['Shift+Z'], 'seq.snap': ['N'],
      'mark.clearIO': ['Alt+X'], 'mark.next': ['Shift+Down'], 'mark.prev': ['Shift+Up'], 'play.loop': ['Ctrl+/'],
      'tool.select': ['A'], 'tool.razor': ['B'], 'tool.ripple': ['T'], 'tool.track': ['Y'], 'tool.roll': [], 'tool.rate': [], 'tool.slip': [], 'tool.pen': [], 'tool.hand': [], 'tool.zoom': [], 'tool.text': [],
      'gfx.newText': [], 'view.maximize': ['Ctrl+F'], 'edit.shortcuts': ['Ctrl+Alt+K']
    } }
  };
  K.PRESETS = PRESETS;
  // full binding table of a preset: listed commands replaced; the others keep the defaults that do not collide
  K.presetBinds = (name) => {
    const P = PRESETS[name] || PRESETS.qass; const out = {}; const used = new Set();
    for (const id in P.over) if (K.cmds[id]) { out[id] = P.over[id].map(K.norm).filter(Boolean); out[id].forEach(c => used.add(c)); }
    for (const id of K.order) if (!out[id]) out[id] = K.cmds[id].defaults.filter(c => !used.has(c));
    return out;
  };

  /* ---------------- state ---------------- */
  let base = null; // bindings of the active preset
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  K.get = (id) => (K.over[id] || (base && base[id]) || []).slice();
  K.all = () => { const o = {}; for (const id of K.order) o[id] = K.get(id); return o; };
  K.isCustom = () => Object.keys(K.over).length > 0;
  function rebuild() {
    K.map = new Map();
    for (const id of K.order) for (const c of K.get(id)) { if (!K.map.has(c)) K.map.set(c, []); K.map.get(c).push(id); }
    refreshTitles(); GW.bus && GW.bus.emit('keys');
  }
  function save() { try { localStorage.setItem('gws.keys', JSON.stringify({ preset: K.preset, over: K.over })); } catch (e) {} }
  function load() {
    let o = null; try { o = JSON.parse(localStorage.getItem('gws.keys') || 'null'); } catch (e) {}
    K.preset = o && PRESETS[o.preset] ? o.preset : 'qass'; base = K.presetBinds(K.preset); K.over = {};
    if (o && o.over) for (const id in o.over) if (K.cmds[id] && Array.isArray(o.over[id]) && !K.cmds[id].fixed) K.over[id] = o.over[id].map(K.norm).filter(Boolean);
    rebuild();
  }
  K.set = (id, combos, noSave) => {
    const cmd = K.cmds[id]; if (!cmd || cmd.fixed) return false;
    const list = [...new Set((combos || []).map(K.norm).filter(Boolean))];
    if (same(list, base[id] || [])) delete K.over[id]; else K.over[id] = list;
    rebuild(); if (!noSave) save(); return true;
  };
  // assign a combo to a command; the combo is removed from any other command (returns the ids it was taken from)
  K.assign = (id, combo, replaceIdx) => {
    combo = K.norm(combo); if (!combo || !K.cmds[id]) return [];
    const taken = (K.map.get(combo) || []).filter(x => x !== id);
    for (const o of taken) K.set(o, K.get(o).filter(c => c !== combo), true);
    const cur = K.get(id); if (replaceIdx != null && replaceIdx >= 0 && replaceIdx < cur.length) cur[replaceIdx] = combo; else if (!cur.includes(combo)) cur.push(combo);
    K.set(id, cur); return taken;
  };
  K.unbind = (id, combo) => K.set(id, K.get(id).filter(c => c !== K.norm(combo)));
  K.reset = (id) => { if (id) { delete K.over[id]; } else K.over = {}; rebuild(); save(); };
  K.usePreset = (name) => { if (!PRESETS[name]) return false; K.preset = name; base = K.presetBinds(name); K.over = {}; rebuild(); save(); return true; };
  K.conflicts = () => [...K.map.entries()].filter(([, ids]) => ids.length > 1);
  K.label = (id) => K.get(id).join(' ، ');
  K.first = (id) => K.get(id)[0] || '';
  K.export = () => ({ app: 'QassQass', type: 'keyboard-shortcuts', version: 1, preset: K.preset, presetName: PRESETS[K.preset].n, custom: K.isCustom(), binds: K.all(), labels: Object.fromEntries(K.order.map(id => [id, K.cmds[id].label])) });
  K.import = (o) => {
    if (typeof o === 'string') o = JSON.parse(o);
    if (!o || typeof o !== 'object' || !o.binds) throw new Error('ملف اختصارات غير صالح');
    K.preset = PRESETS[o.preset] ? o.preset : 'qass'; base = K.presetBinds(K.preset); K.over = {};
    for (const id in o.binds) { if (!K.cmds[id] || K.cmds[id].fixed || !Array.isArray(o.binds[id])) continue; const l = o.binds[id].map(K.norm).filter(Boolean); if (!same(l, base[id] || [])) K.over[id] = l; }
    rebuild(); save(); return true;
  };

  /* ---------------- dispatch ---------------- */
  K.handle = (e) => {
    const combo = K.combo(e); if (!combo) return false;
    const ids = K.map.get(combo); if (!ids || !ids.length) return false;
    const cmd = K.cmds[ids[0]]; if (cmd.fixed) return false; // handled by the main process (e.g. F11)
    e.preventDefault();
    if (e.repeat && !cmd.rep) return true;
    try { cmd.run(e); } catch (er) { console.error('shortcut', cmd.id, er); }
    return true;
  };
  K.run = (id) => { const c = K.cmds[id]; if (!c) throw new Error('unknown command ' + id); return c.run(); };

  /* ---------------- menus show the current bindings ---------------- */
  // menu items carry their default key text (key: 'Ctrl+O'); an optional cmd: 'file.open' wins. Map → live binding.
  let byDefault = null;
  const defaultOwner = (key) => { if (!byDefault) { byDefault = new Map(); for (const id of K.order) for (const c of K.cmds[id].defaults) if (!byDefault.has(c)) byDefault.set(c, id); } return byDefault.get(K.norm(key)); };
  const liveItems = (items) => (items || []).map(it => {
    if (!it || it === '-' || typeof it !== 'object') return it;
    const id = it.cmd || (it.key ? defaultOwner(it.key) : null); let o = it;
    if (id && K.cmds[id]) o = { ...it, key: K.first(id) || '' };
    if (it.sub) o = { ...o, sub: liveItems(it.sub) };
    return o;
  });
  const menu0 = GW.menu; GW.menu = (x, y, items) => menu0(x, y, liveItems(items));
  // timeline tool buttons: tooltip "(V)" follows the binding
  function refreshTitles() {
    document.querySelectorAll('.tools .tb[data-tool]').forEach(b => { const k = K.first('tool.' + b.dataset.tool); b.title = b.title.replace(/\s*\([^)]*\)\s*$/, '') + (k ? ' (' + k + ')' : ''); });
    const ex = document.getElementById('btnExport'); if (ex) { const k = K.first('file.export'); ex.title = 'تصدير الوسائط' + (k ? ' (' + k + ')' : ''); }
  }
  GW.bus.on('ready', refreshTitles); GW.bus.on('panel-shown', id => { if (id === 'timeline') refreshTitles(); });

  /* ---------------- dialog ---------------- */
  const CSS = `
.kb-dlg .dlg-b{padding:0;display:flex;flex-direction:column;min-height:0}
.kb-top{display:flex;gap:6px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.kb-top .sel{min-width:190px}.kb-top .inp{flex:1;min-width:160px}
.kb-kbd{padding:8px 14px;border-bottom:1px solid var(--line);direction:ltr;background:#1b1b1b}
.kb-kbd .r{display:flex;gap:3px;margin-bottom:3px}
.kb-kbd .k{flex:none;width:30px;height:26px;border:1px solid #3c3c3c;border-radius:3px;background:#2a2a2a;color:#bbb;font:10px var(--f-mono);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden}
.kb-kbd .k.w15{width:46px}.kb-kbd .k.w2{width:62px}.kb-kbd .k.w25{width:78px}.kb-kbd .k.sp{width:220px}.kb-kbd .gap{width:14px;flex:none}
.kb-kbd .k.on{background:color-mix(in srgb,var(--accent,#ff6a2b) 26%,#2a2a2a);border-color:color-mix(in srgb,var(--accent,#ff6a2b) 60%,#3c3c3c);color:#fff}.kb-kbd .k.mod{background:#33302a}.kb-kbd .k.mod.act{background:#4a4a4a;color:#fff;border-color:#8a8a8a}
.kb-kbd .k.fx{background:#262626;color:#666;cursor:default}.kb-kbd .k:hover{outline:1px solid #8a8a8a}
.kb-kbd .hint{font:11px var(--f-ui);color:var(--mute);direction:rtl;min-height:16px;margin-top:4px}
.kb-list{overflow:auto;min-height:0;flex:1;max-height:46vh}
.kb-cat{position:sticky;top:0;background:#262626;padding:5px 14px;font-weight:600;color:var(--text2);border-bottom:1px solid var(--line);z-index:1}
.kb-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(220px,1.3fr) 64px;align-items:center;gap:8px;padding:3px 14px;border-bottom:1px solid #262626;min-height:30px}
.kb-row:hover{background:#2a2a2a}.kb-row.sel{background:#33302e;box-shadow:inset -2px 0 var(--accent,#ff6a2b)}.kb-row.mod .kb-n::after{content:" *";color:var(--accent,#ff6a2b)}
.kb-row.bad{box-shadow:inset 3px 0 var(--red)}
.kb-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kb-n small{color:var(--faint);font:10px var(--f-mono);margin-inline-start:6px}
.kb-bs{display:flex;gap:4px;flex-wrap:wrap;direction:ltr;justify-content:flex-end}
.kb-b{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 4px 0 7px;border-radius:3px;background:#383838;border:1px solid #4a4a4a;font:11px var(--f-mono);color:#e6e6e6;cursor:pointer}
.kb-b.conf{border-color:var(--red);background:#4a2526}.kb-b.cap{background:#3a2a22;border-color:var(--accent,#ff6a2b);color:#fff;padding:0 8px;animation:kbp 1s infinite;font-family:var(--f-ui)}
@keyframes kbp{50%{border-color:#777}}
.kb-b i{font-style:normal;color:#999;padding:0 2px;display:inline-flex}.kb-b i:hover{color:var(--red)}
.kb-add{height:22px;width:22px;border-radius:3px;border:1px dashed #555;background:none;color:#aaa;cursor:pointer}.kb-add:hover{border-color:var(--accent,#ff6a2b);color:#fff}
.kb-rs{background:none;border:0;color:var(--mute);cursor:pointer;font-size:10px;display:inline-flex;align-items:center;gap:3px;white-space:nowrap}.kb-rs:hover{color:#fff}.kb-rs[disabled]{visibility:hidden}
.kb-lock{color:var(--faint);font:11px var(--f-ui)}
.kb-msg{padding:6px 14px;border-top:1px solid var(--line);min-height:28px;color:var(--text2)}.kb-msg.warn{color:var(--yellow)}.kb-msg.err{color:var(--red)}
`;
  function injectCss() { if (document.getElementById('kbCss')) return; const s = document.createElement('style'); s.id = 'kbCss'; s.textContent = CSS; document.head.append(s); }
  const KB_ROWS = [
    ['Escape', 'gap', 'F1', 'F2', 'F3', 'F4', 'gap', 'F5', 'F6', 'F7', 'F8', 'gap', 'F9', 'F10', 'F11', 'F12'],
    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace:w2', 'gap', 'Insert', 'Home', 'PageUp', 'gap', 'Num/', 'Num*', 'Num-'],
    ['Tab:w15', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\:w15', 'gap', 'Delete', 'End', 'PageDown', 'gap', 'Num7', 'Num8', 'Num9', 'Num+'],
    ['#Caps:w2', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter:w25'],
    ['@Shift:w25', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', '@Shift:w25', 'gap', 'gap', 'Up', 'gap', 'gap', 'Num1', 'Num2', 'Num3', 'NumEnter'],
    ['@Ctrl:w15', 'gap', '@Alt:w15', 'Space:sp', '@Alt:w15', 'gap', '@Ctrl:w15', 'gap', 'Left', 'Down', 'Right', 'gap', 'Num0:w2', 'Num.']
  ];
  const SHORT = { Escape: 'Esc', Backspace: '⌫', Delete: 'Del', Insert: 'Ins', PageUp: 'PgUp', PageDown: 'PgDn', Left: '←', Right: '→', Up: '↑', Down: '↓', Enter: 'Enter', NumEnter: 'Ent', Space: 'Space' };

  K.dialog = () => {
    injectCss();
    if (document.querySelector('.kb-dlg')) return;
    let q = '', selId = null, capture = null, mods = { Ctrl: 0, Alt: 0, Shift: 0 }, onlyMod = false;
    const body = document.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;min-height:0;height:100%';
    body.innerHTML = `<div class="kb-top">
        <select class="sel" data-a="preset" title="الإعداد المسبق للاختصارات">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.n)}</option>`).join('')}</select>
        <input class="inp" data-a="q" placeholder="ابحث عن أمر أو اختصار (مثال: قص، Ctrl+K)">
        <label style="display:flex;gap:4px;align-items:center;color:var(--text2)"><input type="checkbox" data-a="mod"> المعدّلة فقط</label>
        <button class="btn sm" data-a="exp">تصدير…</button><button class="btn sm" data-a="imp">استيراد…</button><button class="btn sm" data-a="reset">استعادة الإعداد المسبق</button>
      </div>
      <div class="kb-kbd" data-a="kbd"></div>
      <div class="kb-list" data-a="list"></div>
      <div class="kb-msg" data-a="msg">انقر على اختصار لتغييره، أو على + لإضافة اختصار، ثم اضغط المفاتيح الجديدة (Esc للإلغاء).</div>`;
    const $q = (a) => body.querySelector(`[data-a=${a}]`);
    const msg = (t, kind) => { const m = $q('msg'); m.className = 'kb-msg ' + (kind || ''); m.innerHTML = t; };
    const presetSel = $q('preset');
    const syncPreset = () => { presetSel.value = K.preset; presetSel.title = K.isCustom() ? 'معدّل' : ''; [...presetSel.options].forEach(o => o.textContent = PRESETS[o.value].n + (o.value === K.preset && K.isCustom() ? ' (معدّل)' : '')); };
    presetSel.onchange = async () => {
      const v = presetSel.value;
      if (K.isCustom() && !(await GW.ask('تغيير الإعداد المسبق', 'لديك تعديلات على الاختصارات الحالية ستُفقد. هل تريد المتابعة؟ (يمكنك تصديرها أولًا)', 'متابعة'))) { syncPreset(); return; }
      K.usePreset(v); msg('تم تطبيق الإعداد المسبق: <b>' + esc(PRESETS[v].n) + '</b>'); render();
    };
    $q('q').oninput = (e) => { q = e.target.value.trim(); renderList(); };
    $q('q').onkeydown = (e) => e.stopPropagation();
    $q('mod').onchange = (e) => { onlyMod = e.target.checked; renderList(); };
    $q('reset').onclick = async () => { if (!K.isCustom()) { msg('لا توجد تعديلات.'); return; } if (await GW.ask('استعادة الإعداد المسبق', 'ستُحذف كل تعديلاتك على «' + PRESETS[K.preset].n + '».', 'استعادة')) { K.reset(); msg('تمت استعادة الإعداد المسبق.'); render(); } };
    $q('exp').onclick = () => exportFile().then(p => p && msg('تم التصدير: ' + esc(p))).catch(e => msg(esc(e.message), 'err'));
    $q('imp').onclick = () => importFile().then(ok => { if (ok) { msg('تم استيراد الاختصارات.'); render(); } }).catch(e => msg('تعذر الاستيراد: ' + esc(e.message), 'err'));

    function matches(id) {
      const c = K.cmds[id]; if (onlyMod && !K.over[id]) return false; if (!q) return true;
      const l = q.toLowerCase(); const nq = K.norm(q);
      return c.label.toLowerCase().includes(l) || id.includes(l) || K.get(id).some(b => b.toLowerCase().includes(l) || b === nq);
    }
    function renderList() {
      const L = $q('list'); const keep = L.scrollTop; L.innerHTML = ''; let n = 0;
      for (const [cat, catName] of CATS) {
        const ids = K.order.filter(id => K.cmds[id].cat === cat && matches(id)); if (!ids.length) continue;
        const h = document.createElement('div'); h.className = 'kb-cat'; h.textContent = catName; L.append(h);
        for (const id of ids) { L.append(row(id)); n++; }
      }
      if (!n) L.innerHTML = '<div class="empty">لا توجد أوامر مطابقة.</div>';
      L.scrollTop = keep;
    }
    function row(id) {
      const c = K.cmds[id]; const r = document.createElement('div'); const binds = K.get(id);
      const bad = binds.some(b => (K.map.get(b) || []).length > 1);
      r.className = 'kb-row' + (id === selId ? ' sel' : '') + (K.over[id] ? ' mod' : '') + (bad ? ' bad' : ''); r.dataset.id = id;
      r.innerHTML = `<div class="kb-n" title="${esc(id)}">${esc(c.label)}</div><div class="kb-bs"></div><button class="kb-rs" title="استعادة الاختصار الافتراضي" ${K.over[id] ? '' : 'disabled'}>افتراضي</button>`;
      const bs = r.querySelector('.kb-bs');
      if (c.fixed) { bs.innerHTML = binds.map(b => `<span class="kb-b" style="cursor:default">${esc(b)}</span>`).join('') + '<span class="kb-lock">ثابت</span>'; }
      else {
        binds.forEach((b, i) => {
          const conf = (K.map.get(b) || []).length > 1; const isCap = capture && capture.id === id && capture.idx === i;
          const el = document.createElement('span'); el.className = 'kb-b' + (conf ? ' conf' : '') + (isCap ? ' cap' : ''); el.title = conf ? 'تعارض مع: ' + K.map.get(b).filter(x => x !== id).map(x => K.cmds[x].label).join('، ') : 'انقر للتغيير';
          el.innerHTML = isCap ? 'اضغط المفاتيح…' : `${esc(b)}<i title="إزالة">${GW.ico ? GW.ico('close', 10) : 'x'}</i>`;
          el.onclick = (e) => { e.stopPropagation(); if (e.target.tagName === 'I') { K.unbind(id, b); msg('أُزيل <b>' + esc(b) + '</b> من «' + esc(c.label) + '»'); render(); return; } startCapture(id, i); };
          bs.append(el);
        });
        if (capture && capture.id === id && capture.idx == null) { const el = document.createElement('span'); el.className = 'kb-b cap'; el.textContent = 'اضغط المفاتيح…'; bs.append(el); }
        const add = document.createElement('button'); add.className = 'kb-add'; add.textContent = '+'; add.title = 'إضافة اختصار'; add.onclick = (e) => { e.stopPropagation(); startCapture(id, null); }; bs.append(add);
      }
      r.querySelector('.kb-rs').onclick = (e) => { e.stopPropagation(); K.reset(id); msg('أُعيد «' + esc(c.label) + '» إلى الافتراضي'); render(); };
      r.onclick = () => { selId = id; renderList(); renderKbd(); };
      r.ondblclick = () => { if (!c.fixed) startCapture(id, null); };
      return r;
    }
    function startCapture(id, idx) { selId = id; capture = { id, idx }; msg('اضغط تركيبة المفاتيح الجديدة لـ «' + esc(K.cmds[id].label) + '» — Esc للإلغاء'); renderList(); renderKbd(); }
    function commitCombo(combo) {
      const cap = capture; capture = null; const id = cap.id; const c = K.cmds[id];
      if (RESERVED[combo]) { msg('<b>' + esc(combo) + '</b> محجوز للنظام (' + RESERVED[combo] + ')', 'err'); render(); return; }
      const fixedOwner = (K.map.get(combo) || []).find(x => K.cmds[x].fixed);
      if (fixedOwner) { msg('<b>' + esc(combo) + '</b> مستخدم في «' + esc(K.cmds[fixedOwner].label) + '» ولا يمكن تغييره', 'err'); render(); return; }
      const taken = K.assign(id, combo, cap.idx);
      if (taken.length) msg('<b>' + esc(combo) + '</b> كان مستخدمًا في «' + taken.map(x => esc(K.cmds[x].label)).join('، ') + '» — نُقل إلى «' + esc(c.label) + '»', 'warn');
      else msg('تم تعيين <b>' + esc(combo) + '</b> إلى «' + esc(c.label) + '»');
      render();
    }
    const onCap = (e) => {
      if (!capture) return;
      if (!document.body.contains(body)) { window.removeEventListener('keydown', onCap, true); return; }
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { capture = null; msg('أُلغي.'); render(); return; }
      const combo = K.combo(e); if (!combo) return; // a modifier alone: keep waiting
      commitCombo(combo);
    };
    window.addEventListener('keydown', onCap, true);

    // keyboard map: keys bound with the chosen modifiers are highlighted; click a key to assign it to the selected command
    function renderKbd() {
      const box = $q('kbd'); box.innerHTML = '';
      const prefix = (mods.Ctrl ? 'Ctrl+' : '') + (mods.Alt ? 'Alt+' : '') + (mods.Shift ? 'Shift+' : '');
      for (const rw of KB_ROWS) {
        const r = document.createElement('div'); r.className = 'r';
        for (const spec of rw) {
          if (spec === 'gap') { const g = document.createElement('span'); g.className = 'gap'; r.append(g); continue; }
          const [name0, w] = spec.split(/:(?=[a-z0-9]+$)/); const el = document.createElement('span'); el.className = 'k' + (w ? ' ' + w : '');
          if (name0[0] === '@') { const m = name0.slice(1); el.classList.add('mod'); if (mods[m]) el.classList.add('act'); el.textContent = m; el.onclick = () => { mods[m] = mods[m] ? 0 : 1; renderKbd(); }; r.append(el); continue; }
          if (name0[0] === '#') { el.classList.add('fx'); el.textContent = name0.slice(1); r.append(el); continue; }
          const combo = prefix + name0; const ids = K.map.get(combo) || [];
          el.textContent = SHORT[name0] || name0;
          if (ids.length) { el.classList.add('on'); if (ids.includes(selId)) el.style.background = 'var(--accent,#ff6a2b)'; }
          el.onmouseenter = () => { box.querySelector('.hint').textContent = combo + (ids.length ? ': ' + ids.map(x => K.cmds[x].label).join('، ') : ' — غير مستخدم') + (selId ? ' (انقر للتعيين إلى «' + K.cmds[selId].label + '»)' : ''); };
          el.onclick = () => { if (!selId || K.cmds[selId].fixed) { msg('اختر أمرًا من القائمة أولًا ثم انقر على المفتاح.'); return; } capture = { id: selId, idx: null }; commitCombo(combo); };
          r.append(el);
        }
        box.append(r);
      }
      const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'المفاتيح الملونة مستخدمة' + (prefix ? ' مع ' + prefix.slice(0, -1) : '') + ' — انقر Ctrl / Alt / Shift لعرض التركيبات الأخرى'; box.append(hint);
    }
    function render() { syncPreset(); renderKbd(); renderList(); }
    render();
    GW.modal({ title: 'اختصارات لوحة المفاتيح', width: 980, body, buttons: [{ label: 'إغلاق', primary: true }], onClose: () => { capture = null; window.removeEventListener('keydown', onCap, true); } }).el.classList.add('kb-dlg');
    setTimeout(() => $q('q').focus(), 40);
  };

  async function exportFile() {
    const txt = JSON.stringify(K.export(), null, 2); const name = 'QassQass-shortcuts-' + (K.preset) + (K.isCustom() ? '-custom' : '') + '.json';
    if (window.gws && gws.saveDialog) { const p0 = await gws.paths(); const p = await gws.saveDialog({ title: 'تصدير الاختصارات', defaultPath: p0.docs + p0.sep + name, ext: 'json' }); if (!p) return null; await gws.writeText(p, txt); return p; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); return name;
  }
  async function importFile() {
    if (window.gws && gws.open && !gws.test) { const f = await gws.open({ filter: 'json', title: 'استيراد الاختصارات' }); if (!f.length) return false; K.import(await gws.readText(f[0].path)); return true; }
    return new Promise((res, rej) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = () => { const f = i.files[0]; if (!f) return res(false); f.text().then(t => { K.import(t); res(true); }).catch(rej); }; i.click(); });
  }

  load();
})();
