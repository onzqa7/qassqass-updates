'use strict';
/* Project model, effect/transition registry, edit operations, history */
(function () {
  const { uid, clamp, clone, P } = GW;

  GW.LABELS = { video: '#8f7fd6', audio: '#3fae8f', image: '#b08bd8', text: '#d8749f', shape: '#4fb3c8', map: '#d9823f', color: '#5f97d1', adjust: '#9da3ad', seq: '#4e9a52', nest: '#4e9a52', null: '#c9a227', camera: '#6f7c8f' };
  GW.LABEL_SET = [['بنفسجي', '#8f7fd6'], ['نعناعي', '#3fae8f'], ['لافندر', '#b08bd8'], ['وردي', '#d8749f'], ['برتقالي', '#d9823f'], ['أزرق', '#5f97d1'], ['أصفر', '#d6c04a'], ['أحمر', '#d6544e'], ['أخضر', '#4e9a52'], ['رمادي', '#9da3ad']];
  GW.KIND_NAME = { video: 'فيديو', audio: 'صوت', image: 'صورة', text: 'نص', shape: 'شكل', map: 'خريطة حربية', color: 'لون ثابت', adjust: 'طبقة ضبط', seq: 'تسلسل', nest: 'تسلسل متداخل', null: 'طبقة فارغة', camera: 'كاميرا' };

  /* ---------------- effect definitions ---------------- */
  const n = (k, name, def, min, max, step, unit) => ({ k, n: name, t: 'num', def, min, max, step: step || 1, unit: unit || '' });
  const col = (k, name, def) => ({ k, n: name, t: 'color', def });
  const pt = (k, name, def) => ({ k, n: name, t: 'point', def });
  const bool = (k, name, def) => ({ k, n: name, t: 'bool', def: def ? 1 : 0 });
  const sel = (k, name, def, opts) => ({ k, n: name, t: 'select', def, opts });
  const ang = (k, name, def) => ({ k, n: name, t: 'num', def, min: -3600, max: 3600, step: 1, unit: '°' });
  GW.FX = {
    lumetri: { n: 'تصحيح الألوان Lumetri', cat: 'تصحيح الألوان', p: [n('exposure', 'التعريض', 0, -4, 4, .01), n('contrast', 'التباين', 0, -100, 100), n('highlights', 'الإضاءات', 0, -100, 100), n('shadows', 'الظلال', 0, -100, 100), n('whites', 'الأبيض', 0, -100, 100), n('blacks', 'الأسود', 0, -100, 100), n('temp', 'حرارة اللون', 0, -100, 100), n('tint', 'الصبغة', 0, -100, 100), n('sat', 'التشبع', 100, 0, 200), n('vib', 'الحيوية', 0, -100, 100), n('fade', 'بهتان الفيلم', 0, 0, 100), col('shadowTint', 'لون الظلال', '#808080'), col('highTint', 'لون الإضاءات', '#808080'), { ...n('lutIn', 'شدة LUT الإدخال', 100, 0, 100), lut: 'in' }, { ...n('lutCr', 'شدة LUT الإبداعي', 100, 0, 100), lut: 'cr' },
      // curves (fx.curves, color.js) and HSL secondary (fx.hsl: range) — grp params are drawn by GW.Color.fxcRows under their own sections
      { ...n('cvInt', 'شدة المنحنيات', 100, 0, 100), grp: 'curves' }, { ...n('hslTemp', 'حرارة اللون', 0, -100, 100), grp: 'hsl' }, { ...n('hslTint', 'الصبغة', 0, -100, 100), grp: 'hsl' }, { ...n('hslCon', 'التباين', 0, -100, 100), grp: 'hsl' }, { ...n('hslSat', 'التشبع', 100, 0, 200), grp: 'hsl' }, { ...n('hslExp', 'التعريض', 0, -4, 4, .01), grp: 'hsl' }] },
    bw: { n: 'أبيض وأسود', cat: 'تصحيح الألوان', p: [n('amount', 'القوة', 100, 0, 100)] },
    sepia: { n: 'بني قديم (سيبيا)', cat: 'تصحيح الألوان', p: [n('amount', 'القوة', 100, 0, 100)] },
    hue: { n: 'تدرج اللون والتشبع', cat: 'تصحيح الألوان', p: [ang('hue', 'تدوير اللون', 0), n('sat', 'التشبع', 0, -100, 100), n('light', 'الإضاءة', 0, -100, 100)] },
    levels: { n: 'المستويات', cat: 'تصحيح الألوان', p: [n('inB', 'أسود الإدخال', 0, 0, 254), n('inW', 'أبيض الإدخال', 255, 1, 255), n('gamma', 'جاما', 1, .1, 5, .01), n('outB', 'أسود الإخراج', 0, 0, 255), n('outW', 'أبيض الإخراج', 255, 0, 255)] },
    tint: { n: 'صبغة', cat: 'تصحيح الألوان', p: [col('black', 'تحويل الأسود إلى', '#000000'), col('white', 'تحويل الأبيض إلى', '#ffffff'), n('amount', 'القوة', 100, 0, 100)] },
    duotone: { n: 'لونين (Duotone)', cat: 'تصحيح الألوان', p: [col('c1', 'لون الظلال', '#1b1446'), col('c2', 'لون الإضاءات', '#ffb347'), n('amount', 'القوة', 100, 0, 100)] },
    invert: { n: 'عكس الألوان', cat: 'تصحيح الألوان', p: [n('amount', 'القوة', 100, 0, 100)] },
    posterize: { n: 'تقليل الألوان', cat: 'تصحيح الألوان', p: [n('levels', 'المستويات', 6, 2, 32)] },
    gblur: { n: 'ضبابية غاوسية', cat: 'ضبابية وحدّة', p: [n('amount', 'الضبابية', 10, 0, 300, .5), sel('dims', 'الاتجاه', 'both', [['both', 'أفقي وعمودي'], ['h', 'أفقي'], ['v', 'عمودي']]), bool('edges', 'تكرار حواف البكسل', 1)] },
    dblur: { n: 'ضبابية اتجاهية', cat: 'ضبابية وحدّة', p: [ang('angle', 'الزاوية', 0), n('len', 'الطول', 20, 0, 400)] },
    zblur: { n: 'ضبابية تكبير (شعاعية)', cat: 'ضبابية وحدّة', p: [pt('center', 'المركز', [.5, .5]), n('amount', 'القوة', 20, 0, 100)] },
    sharpen: { n: 'حدّة', cat: 'ضبابية وحدّة', p: [n('amount', 'القوة', 50, 0, 300)] },
    ckey: { n: 'مفتاح لوني (شاشة خضراء)', cat: 'المفاتيح', p: [col('key', 'لون المفتاح', '#00d03c'), n('tol', 'التفاوت', 30, 0, 100), n('soft', 'النعومة', 15, 0, 100), n('spill', 'إزالة الانعكاس', 50, 0, 100), n('choke', 'تقليص الحواف', 0, 0, 100)] },
    lkey: { n: 'مفتاح الإضاءة', cat: 'المفاتيح', p: [n('thr', 'العتبة', 20, 0, 100), n('soft', 'النعومة', 10, 0, 100), bool('inv', 'عكس', 0)] },
    crop: { n: 'قص', cat: 'تحويل', p: [n('l', 'يسار', 0, 0, 100, .1, '%'), n('t', 'أعلى', 0, 0, 100, .1, '%'), n('r', 'يمين', 0, 0, 100, .1, '%'), n('b', 'أسفل', 0, 0, 100, .1, '%'), n('feather', 'تنعيم الحافة', 0, 0, 200)] },
    flip: { n: 'قلب', cat: 'تحويل', p: [bool('h', 'أفقي', 1), bool('v', 'عمودي', 0)] },
    mirror: { n: 'مرآة', cat: 'تحويل', p: [sel('mode', 'النوع', 'h', [['h', 'نصف أفقي'], ['v', 'نصف عمودي'], ['q', 'أرباع']])] },
    shake: { n: 'اهتزاز الكاميرا', cat: 'تحويل', p: [n('amount', 'المسافة', 12, 0, 200), n('rot', 'الدوران', 1, 0, 30, .1), n('freq', 'التردد', 6, .1, 40, .1), n('zoom', 'تكبير تعويضي', 4, 0, 50, .5, '%'), n('seed', 'البذرة', 1, 1, 999)] },
    wave: { n: 'تموج', cat: 'تشويه', p: [n('amp', 'الارتفاع', 10, 0, 200), n('len', 'طول الموجة', 120, 4, 1000), n('speed', 'السرعة', 1, -20, 20, .1), ang('dir', 'الاتجاه', 0)] },
    lens: { n: 'عدسة (عين السمكة)', cat: 'تشويه', p: [n('amount', 'القوة', 30, -100, 100)] },
    pixelate: { n: 'بكسلة (موزاييك)', cat: 'تشويه', p: [n('size', 'حجم البكسل', 16, 1, 200)] },
    glow: { n: 'توهج', cat: 'إضاءة ونمط', p: [n('thr', 'العتبة', 60, 0, 100), n('radius', 'نصف القطر', 25, 0, 200), n('int', 'الشدة', 1, 0, 5, .01), col('color', 'لون التوهج', '#ffffff'), n('colorMix', 'مزج اللون', 0, 0, 100)] },
    vignette: { n: 'تظليل الأطراف', cat: 'إضاءة ونمط', p: [n('amount', 'القوة', 60, -100, 100), n('size', 'الحجم', 60, 0, 100), n('round', 'الاستدارة', 50, 0, 100), n('feather', 'النعومة', 50, 1, 100)] },
    grain: { n: 'حبيبات الفيلم', cat: 'إضاءة ونمط', p: [n('amount', 'القوة', 25, 0, 100), n('size', 'الحجم', 1.5, .5, 8, .1), bool('anim', 'متحركة', 1)] },
    glitch: { n: 'جليتش رقمي', cat: 'إضاءة ونمط', p: [n('amount', 'القوة', 50, 0, 100), n('block', 'حجم الكتل', 40, 4, 300), n('split', 'انفصال الألوان', 10, 0, 100), n('speed', 'السرعة', 8, 0, 60, .1)] },
    rgbsplit: { n: 'انفصال الألوان', cat: 'إضاءة ونمط', p: [n('amount', 'المسافة', 8, 0, 200, .5), ang('angle', 'الزاوية', 0)] },
    vhs: { n: 'شريط VHS', cat: 'إضاءة ونمط', p: [n('amount', 'القوة', 60, 0, 100), n('lines', 'خطوط المسح', 50, 0, 100), n('wobble', 'التذبذب', 30, 0, 100)] },
    shadow: { n: 'ظل ساقط', cat: 'إضاءة ونمط', p: [col('color', 'اللون', '#000000'), n('op', 'الشفافية', 60, 0, 100), ang('dir', 'الاتجاه', 135), n('dist', 'المسافة', 10, 0, 300), n('soft', 'النعومة', 15, 0, 200)] },
    leak: { n: 'تسرب ضوئي', cat: 'إضاءة ونمط', p: [n('amount', 'القوة', 60, 0, 100), col('color', 'اللون', '#ff7a2f'), n('speed', 'السرعة', 1, 0, 10, .1), n('seed', 'البذرة', 1, 1, 99)] },
    bars: { n: 'أشرطة سينمائية', cat: 'إضاءة ونمط', p: [n('ratio', 'نسبة العرض', 2.39, 1, 4, .01), col('color', 'اللون', '#000000')] },
    scanlines: { n: 'خطوط شاشة', cat: 'إضاءة ونمط', p: [n('amount', 'القوة', 30, 0, 100), n('size', 'المسافة', 3, 1, 20, .5)] },
    twirl: { n: 'دوامة (Twirl)', cat: 'تشويه', p: [pt('center', 'المركز', [.5, .5]), ang('angle', 'الزاوية', 180), n('radius', 'نصف القطر', 40, 1, 150)] },
    spherize: { n: 'كروية (Spherize)', cat: 'تشويه', p: [pt('center', 'المركز', [.5, .5]), n('radius', 'نصف القطر', 35, 1, 150), n('amount', 'القوة', 60, -100, 100)] },
    turb: { n: 'إزاحة مضطربة (Turbulent Displace)', cat: 'تشويه', p: [n('amount', 'الكمية', 30, 0, 300), n('size', 'الحجم', 60, 1, 500), n('evol', 'التطور', 0, -3600, 3600), n('speed', 'السرعة التلقائية', 1, 0, 20, .1)] },
    ripple: { n: 'تموج دائري (Ripple)', cat: 'تشويه', p: [pt('center', 'المركز', [.5, .5]), n('amp', 'الارتفاع', 8, 0, 100), n('len', 'طول الموجة', 40, 4, 400), n('speed', 'السرعة', 1, -20, 20, .1)] },
    offsetfx: { n: 'إزاحة (Offset)', cat: 'تشويه', p: [n('ox', 'أفقي', 0, -100, 100, .1, '%'), n('oy', 'عمودي', 0, -100, 100, .1, '%')] },
    polar: { n: 'إحداثيات قطبية', cat: 'تشويه', p: [n('amount', 'القوة', 100, 0, 100), sel('mode', 'التحويل', 'r2p', [['r2p', 'مستطيل إلى قطبي'], ['p2r', 'قطبي إلى مستطيل']])] },
    kaleido: { n: 'مشكال (Kaleida)', cat: 'تشويه', p: [n('segs', 'عدد الأجزاء', 6, 2, 32), ang('angle', 'الزاوية', 0), pt('center', 'المركز', [.5, .5])] },
    mtile: { n: 'تبليط (Motion Tile)', cat: 'تشويه', p: [n('tx', 'أعمدة', 3, 1, 20), n('ty', 'صفوف', 3, 1, 20), bool('mirrorE', 'حواف معكوسة', 1)] },
    magnify: { n: 'عدسة مكبرة', cat: 'تشويه', p: [pt('center', 'المركز', [.5, .5]), n('size', 'الحجم', 18, 1, 60), n('mag', 'التكبير', 200, 100, 800, 1, '%')] },
    xform: { n: 'تحويل (Transform)', cat: 'تحويل', p: [n('scale', 'المقياس', 100, 1, 1000, .1, '%'), ang('rot', 'الدوران', 0), n('ox', 'إزاحة أفقية', 0, -100, 100, .1, '%'), n('oy', 'إزاحة عمودية', 0, -100, 100, .1, '%'), n('skew', 'الميل', 0, -70, 70, .1, '°')] },
    fractal: { n: 'ضجيج كسوري (Fractal Noise)', cat: 'توليد', p: [n('scale', 'المقياس', 120, 4, 1000), n('contrast', 'التباين', 160, 10, 500), n('bright', 'السطوع', 0, -100, 100), n('evol', 'التطور', 0, -3600, 3600), n('speed', 'سرعة تلقائية', 1, 0, 20, .1), col('c1', 'اللون 1', '#000000'), col('c2', 'اللون 2', '#ffffff'), sel('blendm', 'المزج', 'none', [['none', 'استبدال'], ['overlay', 'تراكب'], ['screen', 'شاشة'], ['soft', 'ضوء ناعم']]), n('amount', 'القوة', 100, 0, 100)] },
    ramp: { n: 'تدرج لوني (Gradient Ramp)', cat: 'توليد', p: [pt('a', 'نقطة البداية', [.5, 0]), col('c1', 'لون البداية', '#0b1a3a'), pt('b', 'نقطة النهاية', [.5, 1]), col('c2', 'لون النهاية', '#e5484d'), bool('radial', 'شعاعي', 0), n('amount', 'القوة', 100, 0, 100)] },
    fourcol: { n: 'تدرج أربعة ألوان', cat: 'توليد', p: [col('c1', 'أعلى يسار', '#ff4d6d'), col('c2', 'أعلى يمين', '#8b5cff'), col('c3', 'أسفل يسار', '#ffb347'), col('c4', 'أسفل يمين', '#4c8dff'), n('amount', 'القوة', 100, 0, 100)] },
    flare: { n: 'وهج العدسة (Lens Flare)', cat: 'توليد', p: [pt('center', 'المركز', [.3, .3]), n('bright', 'السطوع', 100, 0, 300), col('color', 'اللون', '#ffb066')] },
    rays: { n: 'أشعة ضوئية (Light Rays)', cat: 'توليد', p: [pt('center', 'مصدر الضوء', [.5, .3]), n('intensity', 'الشدة', 60, 0, 300), n('length_', 'الطول', 40, 0, 100), col('color', 'اللون', '#fff2d0')] },
    lightning: { n: 'برق (Lightning)', cat: 'توليد', p: [pt('a', 'البداية', [.35, 0]), pt('b', 'النهاية', [.6, .85]), col('color', 'اللون', '#8fc8ff'), n('width', 'العرض', 2, .5, 20, .1), n('seed', 'البذرة', 1, 1, 99), n('speed', 'التغير', 1, 0, 10, .1)] },
    gridfx: { n: 'شبكة (Grid)', cat: 'توليد', p: [n('size', 'الحجم', 80, 4, 600), n('width', 'سماكة الخط', 1.5, .2, 20, .1), col('color', 'اللون', '#ffffff'), n('amount', 'الشفافية', 40, 0, 100)] },
    checker: { n: 'رقعة شطرنج', cat: 'توليد', p: [n('size', 'الحجم', 60, 4, 600), col('c1', 'اللون 1', '#ffffff'), col('c2', 'اللون 2', '#000000'), n('amount', 'القوة', 100, 0, 100)] },
    circlefx: { n: 'دائرة', cat: 'توليد', p: [pt('center', 'المركز', [.5, .5]), n('radius', 'نصف القطر', 25, 0, 150), n('feather', 'التنعيم', 2, 0, 100), col('color', 'اللون', '#e5484d'), bool('inv', 'عكس', 0)] },
    brightcon: { n: 'السطوع والتباين', cat: 'تصحيح الألوان', p: [n('bri', 'السطوع', 0, -100, 100), n('con', 'التباين', 0, -100, 100)] },
    procamp: { n: 'ProcAmp', cat: 'تصحيح الألوان', p: [n('bri', 'السطوع', 0, -100, 100), n('con', 'التباين', 100, 0, 200), ang('hue', 'تدرج اللون', 0), n('sat', 'التشبع', 100, 0, 300)] },
    colorbal: { n: 'توازن الألوان', cat: 'تصحيح الألوان', p: [n('sr', 'ظلال أحمر', 0, -100, 100), n('sg', 'ظلال أخضر', 0, -100, 100), n('sb', 'ظلال أزرق', 0, -100, 100), n('mr', 'متوسط أحمر', 0, -100, 100), n('mg', 'متوسط أخضر', 0, -100, 100), n('mb', 'متوسط أزرق', 0, -100, 100), n('hr', 'إضاءات أحمر', 0, -100, 100), n('hg', 'إضاءات أخضر', 0, -100, 100), n('hb', 'إضاءات أزرق', 0, -100, 100)] },
    chmix: { n: 'خلاط القنوات', cat: 'تصحيح الألوان', p: [n('rr', 'أحمر←أحمر', 100, -200, 200), n('rg', 'أحمر←أخضر', 0, -200, 200), n('rb', 'أحمر←أزرق', 0, -200, 200), n('gr', 'أخضر←أحمر', 0, -200, 200), n('gg', 'أخضر←أخضر', 100, -200, 200), n('gb', 'أخضر←أزرق', 0, -200, 200), n('br', 'أزرق←أحمر', 0, -200, 200), n('bg', 'أزرق←أخضر', 0, -200, 200), n('bb', 'أزرق←أزرق', 100, -200, 200)] },
    exposure: { n: 'التعريض (Exposure)', cat: 'تصحيح الألوان', p: [n('expo', 'التعريض', 0, -5, 5, .01), n('offs', 'الإزاحة', 0, -50, 50, .1), n('gam', 'جاما', 1, .1, 5, .01)] },
    vibrance: { n: 'الحيوية (Vibrance)', cat: 'تصحيح الألوان', p: [n('vib', 'الحيوية', 30, -100, 100), n('sat', 'التشبع', 0, -100, 100)] },
    photofilter: { n: 'فلتر تصوير (دافئ/بارد)', cat: 'تصحيح الألوان', p: [col('color', 'لون الفلتر', '#ec8a00'), n('density', 'الكثافة', 25, 0, 100), bool('keep', 'حفظ الإضاءة', 1)] },
    tritone: { n: 'ثلاثة ألوان (Tritone)', cat: 'تصحيح الألوان', p: [col('hi', 'الإضاءات', '#fff4dc'), col('mid', 'المتوسطات', '#b5653a'), col('sh', 'الظلال', '#1a0e0a'), n('amount', 'القوة', 100, 0, 100)] },
    colorpass: { n: 'إبقاء لون واحد (Color Pass)', cat: 'تصحيح الألوان', p: [col('key', 'اللون المحفوظ', '#d0201f'), n('tol', 'التفاوت', 20, 0, 100), n('amount', 'القوة', 100, 0, 100)] },
    replcol: { n: 'استبدال لون', cat: 'تصحيح الألوان', p: [col('from_', 'اللون الأصلي', '#2f8ef0'), col('to_', 'اللون الجديد', '#e5484d'), n('tol', 'التفاوت', 25, 0, 100), n('amount', 'القوة', 100, 0, 100)] },
    gammafx: { n: 'تصحيح جاما', cat: 'تصحيح الألوان', p: [n('gam', 'جاما', 1, .1, 5, .01)] },
    limiter: { n: 'محدد الفيديو (Video Limiter)', cat: 'تصحيح الألوان', p: [n('lo', 'الحد الأدنى', 6, 0, 50), n('hi', 'الحد الأعلى', 94, 50, 100)] },
    shadhigh: { n: 'الظلال والإضاءات', cat: 'تصحيح الألوان', p: [n('sh', 'رفع الظلال', 35, 0, 100), n('hl', 'خفض الإضاءات', 0, 0, 100)] },
    threshold: { n: 'عتبة (أبيض وأسود حاد)', cat: 'تصحيح الألوان', p: [n('level', 'المستوى', 128, 0, 255)] },
    findedges: { n: 'إيجاد الحواف', cat: 'أسلوب', p: [n('amount', 'القوة', 100, 0, 100), bool('inv', 'عكس', 1)] },
    emboss: { n: 'نقش بارز (Emboss)', cat: 'أسلوب', p: [ang('angle', 'الاتجاه', 45), n('amount', 'القوة', 60, 0, 300), bool('colored', 'ملوّن', 0)] },
    brush: { n: 'ضربات فرشاة (رسم زيتي)', cat: 'أسلوب', p: [n('size', 'حجم الفرشاة', 12, 2, 60)] },
    halftone: { n: 'نقاط الطباعة (Halftone)', cat: 'أسلوب', p: [n('size', 'حجم النقطة', 8, 2, 60), ang('angle', 'الزاوية', 45), n('amount', 'القوة', 100, 0, 100)] },
    toon: { n: 'كرتون', cat: 'أسلوب', p: [n('levels', 'مستويات الألوان', 5, 2, 16), n('edge', 'الحدود', 60, 0, 200)] },
    unmult: { n: 'إزالة الأسود (Unmult)', cat: 'أسلوب', p: [] },
    replicate: { n: 'تكرار (Replicate)', cat: 'أسلوب', p: [n('count', 'العدد', 2, 1, 16)] },
    roughen: { n: 'حواف خشنة (Roughen Edges)', cat: 'أسلوب', p: [n('amount', 'القوة', 8, 0, 100), n('scale', 'المقياس', 20, 1, 200)] },
    strobe: { n: 'ضوء وامض (Strobe)', cat: 'أسلوب', p: [n('freq', 'التردد', 4, .1, 30, .1), n('duty', 'مدة الوميض', 30, 1, 100, 1, '%'), col('color', 'اللون', '#ffffff'), sel('mode', 'النوع', 'color', [['color', 'لون'], ['invert', 'عكس']])] },
    thermal: { n: 'كاميرا حرارية', cat: 'أسلوب', p: [n('amount', 'القوة', 100, 0, 100)] },
    nightvis: { n: 'رؤية ليلية', cat: 'أسلوب', p: [n('amount', 'القوة', 100, 0, 100), n('grain_', 'الحبيبات', 40, 0, 100)] },
    chroma: { n: 'انحراف لوني (Chromatic Aberration)', cat: 'أسلوب', p: [n('amount', 'القوة', 6, 0, 60, .1)] },
    radialblur: { n: 'ضبابية دورانية', cat: 'ضبابية وحدّة', p: [pt('center', 'المركز', [.5, .5]), ang('angle', 'الزاوية', 10)] },
    lensblur: { n: 'ضبابية عدسة (Bokeh)', cat: 'ضبابية وحدّة', p: [n('radius', 'نصف القطر', 12, 0, 100, .5)] },
    unsharp: { n: 'قناع الحدة (Unsharp Mask)', cat: 'ضبابية وحدّة', p: [n('amount', 'القوة', 60, 0, 500), n('radius', 'نصف القطر', 1.5, .5, 10, .1)] },
    ultrakey: { n: 'Ultra Key (مفتاح متقدم)', cat: 'المفاتيح', p: [col('key', 'لون المفتاح', '#00d03c'), n('tol', 'التفاوت', 40, 0, 100), n('soft', 'النعومة', 20, 0, 100), n('spill', 'إزالة الانعكاس', 70, 0, 100), n('choke', 'تضييق القناع', 0, 0, 90)] },
    alphaadj: { n: 'ضبط الشفافية (Alpha Adjust)', cat: 'المفاتيح', p: [n('opacity', 'الشفافية', 100, 0, 100), bool('inv', 'عكس الشفافية', 0), bool('ignore', 'تجاهل الشفافية', 0)] }
  };
  GW.TRANS = {
    addDiss: { n: 'تلاشي إضافي (Additive)', cat: 'تلاشي' }, filmDiss: { n: 'تلاشي سينمائي (Film)', cat: 'تلاشي' }, lumaFade: { n: 'تلاشي حسب الإضاءة', cat: 'تلاشي' }, blurColor: { n: 'ضبابية إلى أبيض', cat: 'تلاشي' },
    irisBox: { n: 'قزحية مربعة', cat: 'قزحية' }, irisDiamond: { n: 'قزحية ماسية', cat: 'قزحية' }, irisCross: { n: 'قزحية متقاطعة', cat: 'قزحية' },
    barnH: { n: 'أبواب الحظيرة (أفقي)', cat: 'مسح' }, barnV: { n: 'أبواب الحظيرة (عمودي)', cat: 'مسح' }, blinds: { n: 'ستائر فينيسية', cat: 'مسح' }, checkerW: { n: 'مسح شطرنجي', cat: 'مسح' }, radialW: { n: 'مسح شعاعي', cat: 'مسح' }, gradW: { n: 'مسح متدرج', cat: 'مسح' }, randBlocks: { n: 'كتل عشوائية', cat: 'مسح' }, zigzag: { n: 'مسح متعرج', cat: 'مسح' }, pinwheel: { n: 'مروحة', cat: 'مسح' }, neonSweep: { n: 'مسح نيون', cat: 'مسح' },
    crossZoom: { n: 'تكبير متقاطع (Cross Zoom)', cat: 'تكبير' }, zoomBlurT: { n: 'تكبير ضبابي', cat: 'تكبير' },
    cube: { n: 'دوران مكعب', cat: 'ثلاثي الأبعاد' }, flipOver: { n: 'قلب (Flip Over)', cat: 'ثلاثي الأبعاد' }, stretchT: { n: 'تمدد', cat: 'ثلاثي الأبعاد' },
    splitT: { n: 'انشقاق أفقي', cat: 'انزلاق' }, centerSplit: { n: 'انشقاق من المنتصف', cat: 'انزلاق' }, bandSlide: { n: 'أشرطة منزلقة', cat: 'انزلاق' },
    lightLeakT: { n: 'تسرب ضوئي', cat: 'سينمائي' }, chromaT: { n: 'تسرب لوني (Chroma Leak)', cat: 'سينمائي' },
    dissolve: { n: 'تلاشي متقاطع', cat: 'تلاشي' }, dipBlack: { n: 'تلاشي إلى الأسود', cat: 'تلاشي' }, dipWhite: { n: 'تلاشي إلى الأبيض', cat: 'تلاشي' },
    blurx: { n: 'ضبابية متقاطعة', cat: 'تلاشي' }, flash: { n: 'وميض', cat: 'تلاشي' },
    pushL: { n: 'دفع لليسار', cat: 'حركة' }, pushR: { n: 'دفع لليمين', cat: 'حركة' }, pushU: { n: 'دفع للأعلى', cat: 'حركة' }, pushD: { n: 'دفع للأسفل', cat: 'حركة' },
    slideL: { n: 'انزلاق لليسار', cat: 'حركة' }, slideR: { n: 'انزلاق لليمين', cat: 'حركة' }, whip: { n: 'سحب سريع (Whip)', cat: 'حركة' }, spin: { n: 'دوران', cat: 'حركة' }, zoomIn: { n: 'تكبير', cat: 'حركة' },
    wipeL: { n: 'مسح لليسار', cat: 'مسح' }, wipeR: { n: 'مسح لليمين', cat: 'مسح' }, wipeU: { n: 'مسح للأعلى', cat: 'مسح' }, wipeD: { n: 'مسح للأسفل', cat: 'مسح' },
    iris: { n: 'قزحية دائرية', cat: 'مسح' }, clock: { n: 'مسح دائري (ساعة)', cat: 'مسح' }, glitchT: { n: 'جليتش', cat: 'رقمي' }, pixelT: { n: 'بكسلة', cat: 'رقمي' }
  };
  GW.ATRANS = { cpower: { n: 'قوة ثابتة (Constant Power)' }, cgain: { n: 'كسب ثابت (Constant Gain)' } };
  GW.AFX = {
    gain: { n: 'كسب', p: [n('db', 'الكسب', 0, -40, 24, .1, ' dB')] },
    lowpass: { n: 'تمرير منخفض', p: [n('freq', 'التردد', 8000, 20, 20000, 10, ' Hz')] },
    highpass: { n: 'تمرير عالي', p: [n('freq', 'التردد', 120, 20, 20000, 10, ' Hz')] },
    eq3: { n: 'معادل ثلاثي', p: [n('low', 'منخفض', 0, -24, 24, .1, ' dB'), n('mid', 'متوسط', 0, -24, 24, .1, ' dB'), n('high', 'عالي', 0, -24, 24, .1, ' dB')] },
    reverb: { n: 'صدى غرفة (Reverb)', p: [n('mix', 'المزج', 30, 0, 100), n('size', 'الحجم', 2, .2, 8, .1, ' ث')] },
    delay: { n: 'تأخير (Echo)', p: [n('time', 'الزمن', .3, .02, 2, .01, ' ث'), n('fb', 'التغذية الراجعة', 35, 0, 90), n('mix', 'المزج', 30, 0, 100)] },
    comp: { n: 'ضاغط ديناميكي', p: [n('thr', 'العتبة', -24, -60, 0, .5, ' dB'), n('ratio', 'النسبة', 4, 1, 20, .1)] },
    radio: { n: 'صوت راديو / هاتف', p: [n('amount', 'القوة', 100, 0, 100)] }
  };
  GW.newFx = (type, group) => {
    const def = (group === 'a' ? GW.AFX : GW.FX)[type];
    const params = {}; for (const p of def.p) params[p.k] = P(clone(p.def));
    return { id: uid(), type, on: 1, params };
  };

  /* ---------------- project / sequences ---------------- */
  GW.newSequence = (name, w, h, fps) => ({
    id: uid(), name: name || 'تسلسل 01', w: w || 1920, h: h || 1080, fps: fps || 30,
    vt: [{ id: uid(), name: 'V1' }, { id: uid(), name: 'V2' }, { id: uid(), name: 'V3' }],
    at: [{ id: uid(), name: 'A1', vol: 0 }, { id: uid(), name: 'A2', vol: 0 }, { id: uid(), name: 'A3', vol: 0 }],
    clips: [], trans: [], markers: [], inP: null, outP: null, t: 0, zoom: 60, scroll: 0, master: 0
  });
  GW.newProject = () => {
    const s = GW.newSequence();
    return { v: 1, name: 'مشروع بلا عنوان', path: null, media: [], seqs: [s], active: s.id, created: Date.now() };
  };
  GW.prj = GW.newProject();
  GW.seq = () => GW.prj.seqs.find(s => s.id === GW.prj.active) || GW.prj.seqs[0];
  GW.media = id => GW.prj.media.find(m => m.id === id);
  GW.clipById = (id, s) => (s || GW.seq()).clips.find(c => c.id === id);
  GW.sel = { clips: new Set(), trans: null, media: new Set(), fx: null, panelFocus: 'timeline' };

  /* ---------------- clips ---------------- */
  GW.newClip = (kind, o = {}) => {
    const s = o.seq || GW.seq();
    const sw = o.sw || (kind === 'null' ? 100 : s.w), sh = o.sh || (kind === 'null' ? 100 : s.h);
    const fit = (kind === 'video' || kind === 'image') ? Math.min(s.w / sw, s.h / sh) * 100 : 100;
    const c = {
      id: uid(), kind, media: o.media || null, name: o.name || GW.KIND_NAME[kind], tt: kind === 'audio' ? 'a' : 'v', ti: o.ti || 0,
      start: o.start || 0, dur: o.dur || 5, in: o.in || 0, speed: 1, link: o.link || null, on: 1, label: o.label || GW.LABELS[kind] || '#888',
      sw, sh
    };
    if (c.tt === 'v') {
      c.motion = { pos: P([s.w / 2, s.h / 2]), scale: P(Math.round(fit * 100) / 100), scaleW: P(100), uni: 1, rot: P(0), anchor: P([sw / 2, sh / 2]) };
      c.opacity = P(100); c.blend = 'normal'; c.masks = []; c.fx = [];
    }
    if (c.tt === 'a' || o.hasAudio) { c.vol = P(0); c.pan = P(0); c.afx = []; }
    if (kind === 'text') c.text = GW.defaultText(o.textValue);
    if (kind === 'shape' && GW.Shape) c.shape = GW.Shape.defaults(o.shapeType || 'rect', s, o);
    if (kind === 'color') c.color = o.color || '#1f6feb';
    if (kind === 'map') c.map = { scene: o.scene || null };
    if (kind === 'camera' || kind === 'null') { c.motion.scale = P(100); if (kind === 'null') c.motion.pos = P([s.w / 2, s.h / 2]); }
    if (kind === 'camera') { // AE default two-node camera, 50 mm preset (zoom ≈ 1777.8 px on 1920 wide)
      const z = Math.round(s.w * 50 / 54 * 10) / 10; c.td = 1; GW.X.ensure3D(c); c.motion.posZ = P(-z);
      c.cam = { type: 'two', poi: P([s.w / 2, s.h / 2]), poiZ: P(0), zoom: P(z), dof: 0, focus: P(z), aperture: P(25.3), blurLvl: P(100) };
    }
    return c;
  };
  GW.defaultText = (txt) => ({
    str: txt || 'نص جديد', font: 'Cairo', weight: 800, size: 96, color: '#ffffff', align: 'center', tracking: 0, leading: 1.2, italic: 0, caps: 0,
    stroke: 0, strokeColor: '#000000', shadow: 1, shadowColor: '#000000', shadowOp: 60, shadowBlur: 12, shadowDist: 6, shadowAng: 135,
    bg: 0, bgColor: '#000000', bgOp: 70, bgPad: 24, bgRad: 8, animIn: 'fade', animOut: 'fade', animDur: .5, boxW: 0
  });
  GW.srcTime = (c, t) => c.in + (t - c.start) * (c.speed || 1);
  GW.clipEnd = c => c.start + c.dur;
  GW.seqDur = s => { let e = 0; for (const c of (s || GW.seq()).clips) e = Math.max(e, c.start + c.dur); return e; };
  GW.trackClips = (s, tt, ti) => s.clips.filter(c => c.tt === tt && c.ti === ti).sort((a, b) => a.start - b.start);
  GW.clipAt = (s, tt, ti, t) => s.clips.find(c => c.tt === tt && c.ti === ti && t >= c.start - 1e-6 && t < c.start + c.dur - 1e-6);
  GW.maxLen = c => { if (c.kind === 'nest') { const sub = GW.prj.seqs.find(x => x.id === c.ref); return sub ? GW.seqDur(sub) : Infinity; } const m = c.media && GW.media(c.media); if (!m || m.kind === 'image' || !m.dur) return Infinity; return m.dur; };
  GW.linked = (s, c) => c.link ? s.clips.filter(x => x.link === c.link && x !== c) : [];

  /* keyframes follow the clip-local timeline; shift when a clip's head moves */
  function eachParam(c, fn) {
    const visit = o => { if (!o || typeof o !== 'object') return; if ('v' in o && (o.k || o.v !== undefined) && Object.keys(o).every(k => k === 'v' || k === 'k')) { fn(o); return; } for (const k in o) if (k !== 'scene') visit(o[k]); };
    visit(c.motion); visit(c.cam); visit({ o: c.opacity }); visit({ v: c.vol }); visit({ p: c.pan });
    (c.fx || []).forEach(f => visit(f.params)); (c.afx || []).forEach(f => visit(f.params)); (c.masks || []).forEach(m => visit(m));
    if (c.text && c.text.animators) visit(c.text.animators); if (c.shape) visit(c.shape); if (c.s3d) visit(c.s3d); // 3D scenes (s3d.js) // text animators (text_anim.js) / shape layers (shape.js)
  }
  GW.eachParam = eachParam;
  GW.shiftKeys = (c, dt, from, to) => eachParam(c, p => { if (!p.k) return; p.k.forEach(k => k.t -= dt); if (from != null) { p.k = p.k.filter(k => k.t >= from - 1e-6 && k.t <= to + 1e-6); if (!p.k.length) delete p.k; } });

  /* ---------------- edit operations ---------------- */
  GW.ops = {
    split(s, c, t) {
      if (t <= c.start + 1e-4 || t >= c.start + c.dur - 1e-4) return null;
      const b = clone(c); b.id = uid();
      const off = t - c.start;
      b.start = t; b.dur = c.dur - off; b.in = c.in + off * (c.speed || 1);
      c.dur = off;
      eachParam(c, p => { if (p.k) { const keep = p.k.filter(k => k.t <= off + 1e-6); if (keep.length !== p.k.length) { p.v = GW.pv(p, off); } p.k = keep.length ? keep : undefined; if (!p.k) delete p.k; } });
      eachParam(b, p => { if (p.k) { const v0 = GW.pv(p, off); p.k = p.k.filter(k => k.t >= off - 1e-6).map(k => ({ ...k, t: k.t - off })); if (!p.k.length) { delete p.k; p.v = v0; } } });
      s.clips.push(b);
      // transitions at clip end now belong to the second half
      for (const tr of s.trans) if (tr.a === c.id) tr.a = b.id;
      return b;
    },
    // split several clips at t; right-hand pieces of one linked group stay linked to each other
    splitGroup(s, clips, t) {
      const map = {}; const out = [];
      for (const c of clips) { const b = GW.ops.split(s, c, t); if (!b) continue; if (c.link) b.link = map[c.link] || (map[c.link] = uid()); out.push(b); }
      return out;
    },
    // clear [t0,t1) on a track (overwrite edit)
    clear(s, tt, ti, t0, t1, except) {
      for (const c of GW.trackClips(s, tt, ti)) {
        if (except && except.has(c.id)) continue;
        const e = c.start + c.dur;
        if (e <= t0 + 1e-6 || c.start >= t1 - 1e-6) continue;
        if (c.start >= t0 - 1e-6 && e <= t1 + 1e-6) { GW.ops.remove(s, c); continue; }
        if (c.start < t0 && e > t1) { const b = GW.ops.split(s, c, t1); c.dur = t0 - c.start; continue; }
        if (c.start < t0) { c.dur = t0 - c.start; continue; }
        const cut = t1 - c.start; c.in += cut * (c.speed || 1); c.start = t1; c.dur -= cut; GW.shiftKeys(c, cut);
      }
    },
    remove(s, c) { s.clips = s.clips.filter(x => x !== c); s.trans = s.trans.filter(tr => tr.a !== c.id && tr.b !== c.id); GW.sel.clips.delete(c.id); },
    // push everything at/after t on given tracks to the right by d
    rippleInsert(s, t, d, tracks) {
      for (const [tt, ti] of tracks) {
        const crossing = GW.clipAt(s, tt, ti, t);
        if (crossing && crossing.start < t - 1e-6) GW.ops.split(s, crossing, t);
        for (const c of GW.trackClips(s, tt, ti)) if (c.start >= t - 1e-6) c.start += d;
      }
      for (const m of s.markers) if (m.t >= t) m.t += d;
    },
    // close a gap [t0,t1) on given tracks
    rippleClose(s, t0, t1, tracks) {
      const d = t1 - t0; if (d <= 0) return;
      for (const [tt, ti] of tracks) for (const c of GW.trackClips(s, tt, ti)) if (c.start >= t1 - 1e-6) c.start -= d;
    },
    allTracks(s) { return [...s.vt.map((x, i) => ['v', i]), ...s.at.map((x, i) => ['a', i])]; },
    rippleDelete(s, clips) {
      const byTrack = {};
      for (const c of clips) { (byTrack[c.tt + c.ti] = byTrack[c.tt + c.ti] || []).push(c); }
      for (const key in byTrack) {
        const list = byTrack[key].sort((a, b) => b.start - a.start);
        for (const c of list) { const t0 = c.start, t1 = c.start + c.dur; GW.ops.remove(s, c); GW.ops.rippleClose(s, t0, t1, [[c.tt, c.ti]]); }
      }
    },
    place(s, c, mode) { // mode: 'overwrite' | 'insert'
      if (mode === 'insert') GW.ops.rippleInsert(s, c.start, c.dur, GW.ops.allTracks(s).filter(([tt, ti]) => !(s[tt + 't'][ti] || {}).lock));
      else GW.ops.clear(s, c.tt, c.ti, c.start, c.start + c.dur);
      s.clips.push(c);
    },
    ensureTrack(s, tt, ti) {
      const arr = tt === 'v' ? s.vt : s.at;
      while (arr.length <= ti) arr.push(tt === 'v' ? { id: uid(), name: 'V' + (arr.length + 1) } : { id: uid(), name: 'A' + (arr.length + 1), vol: 0 });
    },
    liftRange(s, t0, t1, extract) {
      const tracks = GW.ops.allTracks(s).filter(([tt, ti]) => !(s[tt + 't'][ti] || {}).lock);
      for (const [tt, ti] of tracks) GW.ops.clear(s, tt, ti, t0, t1);
      if (extract) GW.ops.rippleClose(s, t0, t1, tracks);
    }
  };

  /* ---------------- media from file ---------------- */
  GW.mediaKind = name => {
    const e = (name.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'tif', 'tiff', 'avif'].includes(e)) return 'image';
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma', 'aiff', 'aif'].includes(e)) return 'audio';
    return 'video';
  };

  /* ---------------- history ---------------- */
  const H = GW.hist = { stack: [], idx: -1, labels: [], max: 120, saved: null };
  const strip = () => JSON.stringify(GW.prj);
  H.reset = (label) => { H.stack = [strip()]; H.labels = [label || 'فتح المشروع']; H.idx = 0; H.saved = H.stack[0]; GW.bus.emit('hist'); GW.markDirty(); };
  H.push = (label) => {
    const s = strip();
    if (H.stack[H.idx] === s) return;
    H.stack = H.stack.slice(0, H.idx + 1); H.labels = H.labels.slice(0, H.idx + 1);
    H.stack.push(s); H.labels.push(label || 'تعديل');
    if (H.stack.length > H.max) { H.stack.shift(); H.labels.shift(); }
    H.idx = H.stack.length - 1; GW.bus.emit('hist'); GW.markDirty();
  };
  H.go = (i) => {
    if (i < 0 || i >= H.stack.length || i === H.idx) return;
    H.idx = i; const keepT = GW.seq() ? GW.seq().t : 0;
    GW.prj = JSON.parse(H.stack[i]);
    const s = GW.seq(); if (s) s.t = keepT;
    for (const id of [...GW.sel.clips]) if (!GW.clipById(id)) GW.sel.clips.delete(id);
    GW.bus.emit('hist'); GW.bus.emit('project'); GW.markDirty();
  };
  H.undo = () => H.go(H.idx - 1);
  H.redo = () => H.go(H.idx + 1);
  GW.commit = (label) => { H.push(label); GW.bus.emit('changed'); };
  GW.commitSoon = GW.debounce((label) => GW.commit(label), 350);
  GW.markDirty = () => {
    const d = H.stack[H.idx] !== H.saved;
    if (window.gws) { gws.setDirty(d); gws.setTitle((d ? '• ' : '') + (GW.prj.name || 'مشروع') + ' — قص قص'); }
    else document.title = (d ? '• ' : '') + (GW.prj.name || 'مشروع') + ' — قص قص';
  };
})();
