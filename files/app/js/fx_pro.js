'use strict';
/* Pro effects pack: Deep Glow (multi-octave HDR bloom), real VHS, CRT, film / lens / stylize / layer effects and extra
   transitions. Plugs into gl.js through R.FS (shaders), R.multi (multi-pass effects) and R.trans2 (transitions).
   Everything is a pure function of (params, local time) → deterministic for export. */
(function () {
  const R = GW.R, FS = R.FS;
  const n = (k, name, def, min, max, step, unit) => ({ k, n: name, t: 'num', def, min, max, step: step || 1, unit: unit || '' });
  const col = (k, name, def) => ({ k, n: name, t: 'color', def });
  const pt = (k, name, def) => ({ k, n: name, t: 'point', def });
  const bool = (k, name, def) => ({ k, n: name, t: 'bool', def: def ? 1 : 0 });
  const sel = (k, name, def, opts) => ({ k, n: name, t: 'select', def, opts });
  const ang = (k, name, def) => ({ k, n: name, t: 'num', def, min: -3600, max: 3600, step: 1, unit: '°' });

  /* ================= definitions ================= */
  const C_GLOW = 'توهج وإضاءة', C_TAPE = 'شاشات وأشرطة', C_FILM = 'فيلم وأرشيف', C_LENS = 'عدسة وضبابية', C_STY = 'أسلوب وطباعة', C_DIG = 'جليتش ورقمي', C_SHP = 'حدّة وتنقية', C_CAM = 'كاميرا وإطار', C_VIS = 'رؤية خاصة', C_LAY = 'طبقات ونصوص', C_GEN = 'توليد وخلفيات';
  const DEFS = {
    deepglow: { n: 'توهج عميق (Deep Glow)', cat: C_GLOW, p: [n('thr', 'العتبة', 55, 0, 100), n('knee', 'نعومة العتبة', 50, 0, 100), n('radius', 'نصف القطر', 300, 4, 3000), n('expo', 'التعريض', 0, -6, 6, .01), n('int', 'الشدة', 1, 0, 10, .01), n('falloff', 'التلاشي', 40, -50, 150),
      sel('colorMode', 'لون التوهج', 'source', [['source', 'من المصدر'], ['tint', 'لون واحد'], ['grad', 'تدرج داخلي ← خارجي']]), col('tint', 'لون الصبغة', '#ffa040'), col('inner', 'اللون الداخلي', '#ffffff'), col('outer', 'اللون الخارجي', '#ff5a1f'), n('disp', 'تشتت لوني', 0, -100, 100),
      n('aspect', 'نسبة الأبعاد', 100, 5, 100, 1, '%'), ang('angle', 'الدوران', 0), n('streak', 'خطوط أنامورفية', 0, 0, 300), n('streakLen', 'طول الخطوط', 60, 5, 100), col('streakCol', 'لون الخطوط', '#6fa8ff'),
      bool('luma', 'عتبة حسب الإضاءة', 0), bool('unmult', 'إزالة الأسود (Unmultiply)', 1), bool('preserve', 'حفظ اللون', 0), bool('rolloff', 'ضغط الإضاءات العالية', 1), bool('glowOnly', 'التوهج فقط', 0)] },
    edgeglow: { n: 'توهج الحواف (Edge Glow)', cat: C_GLOW, p: [n('thr', 'عتبة الحواف', 20, 0, 100), n('radius', 'نصف القطر', 120, 4, 2000), n('int', 'الشدة', .7, 0, 10, .01), sel('colorMode', 'اللون', 'source', [['source', 'من المصدر'], ['tint', 'لون واحد']]), col('tint', 'لون الصبغة', '#38c8ff'), n('falloff', 'التلاشي', 40, -50, 100), bool('glowOnly', 'التوهج فقط', 0)] },
    chromaglow: { n: 'توهج طيفي (Chromatic Glow)', cat: C_GLOW, p: [n('thr', 'العتبة', 55, 0, 100), n('radius', 'نصف القطر', 260, 4, 3000), n('int', 'الشدة', 1.2, 0, 10, .01), n('disp', 'تشتت الطيف', 80, 0, 100), n('falloff', 'التلاشي', 25, -50, 100), ang('hue', 'تدوير الطيف', 0)] },
    glimmer: { n: 'لمعان نجمي (Glimmer)', cat: C_GLOW, p: [n('thr', 'العتبة', 75, 0, 100), n('len', 'طول الأشعة', 90, 4, 600), n('rays', 'عدد الأشعة', 4, 2, 8), ang('angle', 'الزاوية', 45), n('int', 'الشدة', 1.5, 0, 10, .01), col('tint', 'اللون', '#ffffff'), n('twinkle', 'التلألؤ', 30, 0, 100)] },
    lensflare: { n: 'وهج عدسة احترافي (Lens Flare)', cat: C_GLOW, p: [sel('kind', 'النوع', 'sun', [['sun', 'شمس'], ['anam', 'أنامورفي'], ['spot', 'كشاف'], ['warm', 'دافئ ناعم']]), pt('center', 'المصدر', [.3, .3]), n('bright', 'السطوع', 100, 0, 400), n('scale', 'الحجم', 100, 10, 400, 1, '%'), col('color', 'اللون', '#ffb066'), n('ghosts', 'الانعكاسات', 60, 0, 200), n('streak', 'الخط الأفقي', 60, 0, 300), n('flick', 'الارتعاش', 10, 0, 100)] },
    halation: { n: 'هالة الفيلم (Halation)', cat: C_GLOW, p: [n('amount', 'القوة', 50, 0, 300), n('thr', 'العتبة', 68, 0, 100), n('radius', 'نصف القطر', 18, 1, 200), col('color', 'اللون', '#ff2a0a'), n('bloom', 'توهج عام', 10, 0, 100)] },
    leak2: { n: 'تسريبات ضوء احترافية', cat: C_GLOW, p: [n('amount', 'القوة', 70, 0, 150), sel('side', 'الموضع', 'left', [['left', 'يسار'], ['right', 'يمين'], ['top', 'أعلى'], ['corner', 'زاوية'], ['center', 'مركز']]), n('size', 'الحجم', 55, 5, 100), col('c1', 'اللون الساخن', '#ffd27a'), col('c2', 'اللون الأوسط', '#ff5a1f'), col('c3', 'اللون الخارجي', '#b0124a'), n('speed', 'السرعة', 1, 0, 10, .1), n('evol', 'التطور', 0, -3600, 3600), n('burn', 'الاحتراق للأبيض', 35, 0, 100), n('seed', 'البذرة', 3, 1, 999)] },
    pointzoom: { n: 'تكبير ضوئي (Point Zoom)', cat: C_GLOW, p: [pt('center', 'المركز', [.5, .5]), n('len', 'الطول', 40, 0, 100), n('thr', 'العتبة', 50, 0, 100), n('int', 'الشدة', 1.2, 0, 10, .01), col('tint', 'اللون', '#ffffff')] },
    vhsreal: { n: 'VHS حقيقي', cat: C_TAPE, p: [n('gen', 'فقدان الأجيال', 35, 0, 100), n('lumaBW', 'ضعف دقة الإضاءة', 40, 0, 100), n('chromaBW', 'ضعف دقة اللون', 60, 0, 100), n('shift', 'انزياح اللون', 35, 0, 100), n('halo', 'هالة الحدّة', 40, 0, 100), n('noiz', 'ضجيج الشريط', 35, 0, 100),
      n('drop', 'انقطاعات (Dropouts)', 20, 0, 100), n('track', 'خطأ التتبع', 15, 0, 100), n('trackSpd', 'سرعة شريط التتبع', 1, -10, 10, .1), n('wobble', 'تذبذب أفقي', 30, 0, 100), n('headSw', 'ضجيج تبديل الرؤوس', 60, 0, 100), n('jitter', 'ارتجاف', 25, 0, 100),
      n('sat', 'التشبع', 85, 0, 200), n('drift', 'انجراف الألوان', 30, 0, 100), n('interlace', 'ارتعاش الحقول (Interlace)', 35, 0, 100), bool('crop43', 'قص 4:3', 0),
      sel('osd', 'عرض الشاشة (OSD)', 'none', [['none', 'بدون'], ['play', 'تشغيل PLAY'], ['rec', 'تسجيل REC']]), bool('osdDate', 'عرض التاريخ والوقت', 0), n('year', 'السنة', 1994, 1970, 2030), n('month', 'الشهر', 10, 1, 12), n('day', 'اليوم', 14, 1, 31), n('hour', 'الساعة', 19, 0, 23), n('minute', 'الدقيقة', 42, 0, 59), n('seed', 'البذرة', 1, 1, 999)] },
    crt: { n: 'شاشة CRT', cat: C_TAPE, p: [n('curv', 'الانحناء', 35, 0, 100), n('corner', 'استدارة الزوايا', 30, 0, 100), n('vig', 'التظليل', 40, 0, 100),
      sel('mask', 'نمط الفوسفور', 'aperture', [['none', 'بدون'], ['aperture', 'شبكة فتحات (Trinitron)'], ['shadow', 'قناع ظل (نقاط)'], ['slot', 'قناع شقوق']]), n('maskSize', 'حجم القناع', 3, 1, 12, .1), n('maskStr', 'قوة القناع', 40, 0, 100),
      n('lines', 'عدد خطوط المسح', 240, 120, 1080), n('beamMin', 'عرض الحزمة (مظلم)', 20, 5, 100), n('beamMax', 'عرض الحزمة (مضيء)', 62, 5, 100), n('bloom', 'الهالة (Halation)', 35, 0, 200), n('bloomR', 'نصف قطر الهالة', 12, 1, 100),
      n('conv', 'خطأ التقارب', 25, 0, 100), n('flicker', 'الوميض', 15, 0, 100), n('roll', 'شريط التحديث المتدحرج', 20, 0, 100), n('rollSpd', 'سرعة الشريط', 1, -10, 10, .1), n('glare', 'انعكاس الزجاج', 25, 0, 100), n('border', 'الحد الأسود', 3, 0, 25, .1, '%'), n('bright', 'السطوع', 108, 50, 250, 1, '%'),
      sel('phos', 'الفوسفور', 'color', [['color', 'ملون'], ['amber', 'كهرماني'], ['green', 'أخضر'], ['white', 'أبيض']]), n('noise', 'التشويش', 8, 0, 100)] },
    filmgrain: { n: 'حبيبات فيلم حقيقية', cat: C_FILM, p: [sel('stock', 'الفيلم', '35', [['35', '35مم (ناعم)'], ['16', '16مم'], ['8', '8مم / سوبر 8']]), n('amount', 'القوة', 45, 0, 200), n('size', 'حجم الحبيبة', 100, 25, 400, 1, '%'), n('color', 'حبيبات ملونة', 35, 0, 100), n('shadows', 'في الظلال', 70, 0, 100), n('highs', 'في الإضاءات', 25, 0, 100), n('soft', 'النعومة', 40, 0, 100), n('fps', 'معدل التغير', 24, 1, 60), n('seed', 'البذرة', 1, 1, 999)] },
    filmdamage: { n: 'تلف الفيلم', cat: C_FILM, p: [n('dust', 'الغبار', 40, 0, 100), n('scratch', 'الخدوش', 35, 0, 100), n('hair', 'الشعيرات', 20, 0, 100), n('weave', 'اهتزاز البوابة', 30, 0, 100), n('flicker', 'الوميض', 30, 0, 100), n('blotch', 'البقع والحروق', 15, 0, 100), sel('tone', 'لون الخدوش', 'mix', [['mix', 'مختلط'], ['white', 'أبيض (نسخة عرض)'], ['black', 'أسود (نيجاتيف)']]), n('fps', 'معدل الإطارات', 24, 8, 30), n('seed', 'البذرة', 1, 1, 999)] },
    filmemu: { n: 'محاكاة أفلام (Kodak/Fuji)', cat: C_FILM, p: [sel('stock', 'الفيلم', 'k2383', [['k2383', 'Kodak 2383 (نسخة عرض)'], ['portra', 'Kodak Portra 400'], ['vision', 'Kodak Vision3 500T'], ['eterna', 'Fuji Eterna'], ['kchrome', 'Kodachrome 64'], ['velvia', 'Fuji Velvia'], ['trix', 'Kodak Tri-X (أبيض وأسود)']]), n('amount', 'القوة', 100, 0, 100), n('expo', 'التعريض', 0, -3, 3, .01), n('contrast', 'التباين', 0, -100, 100), n('warmth', 'الدفء', 0, -100, 100), n('fade', 'رفع الأسود', 0, 0, 100)] },
    olddoc: { n: 'مظهر وثائقي قديم', cat: C_FILM, p: [n('tone', 'السيبيا', 70, 0, 100), col('toneC', 'لون الصبغة', '#a87a4a'), n('grain', 'الحبيبات', 45, 0, 100), n('vig', 'التظليل', 55, 0, 100), n('flicker', 'الوميض', 35, 0, 100), n('soft', 'النعومة', 30, 0, 100), n('weave', 'اهتزاز الصورة', 25, 0, 100), n('dust', 'الغبار والخدوش', 30, 0, 100), n('contrast', 'التباين', 20, -50, 100), n('seed', 'البذرة', 1, 1, 999)] },
    noir: { n: 'نوار حديث (Noir)', cat: C_FILM, p: [n('contrast', 'التباين', 45, -50, 150), n('red', 'فلتر أحمر', 40, -100, 100), n('glow', 'توهج الإضاءات', 25, 0, 100), n('vig', 'التظليل', 50, 0, 100), n('grain', 'الحبيبات', 20, 0, 100), col('tint', 'صبغة', '#cfd6e0'), n('tintAmt', 'قوة الصبغة', 20, 0, 100)] },
    multitone: { n: 'تعدد الألوان (Multitone)', cat: C_FILM, p: [col('c1', 'الظلال العميقة', '#0d0b1f'), col('c2', 'الظلال', '#3a1e5c'), col('c3', 'المتوسطات', '#d0485f'), col('c4', 'الإضاءات', '#ffd59a'), n('amount', 'القوة', 100, 0, 100), n('contrast', 'التباين', 0, -100, 100)] },
    lensdist: { n: 'تشوه العدسة والانحراف اللوني', cat: C_LENS, p: [n('k1', 'التشوه', 20, -100, 100), n('k2', 'تشوه الحواف', 0, -100, 100), n('ca', 'الانحراف اللوني', 30, 0, 200), n('caEdge', 'تركيز على الحواف', 70, 0, 100), bool('fit', 'تكبير تلقائي لإخفاء الحواف', 1), n('vig', 'تظليل العدسة الطبيعي', 25, 0, 100), pt('center', 'المركز', [.5, .5])] },
    prism: { n: 'انكسار منشوري (Prism)', cat: C_LENS, p: [n('amount', 'القوة', 30, 0, 200), ang('angle', 'الزاوية', 0), sel('mode', 'النوع', 'radial', [['radial', 'شعاعي'], ['linear', 'خطي']]), n('samples', 'نعومة الطيف', 12, 3, 24), pt('center', 'المركز', [.5, .5])] },
    heatwave: { n: 'موجة حرارة (Heatwave)', cat: C_LENS, p: [n('amount', 'القوة', 30, 0, 200), n('scale', 'الحجم', 60, 5, 400), n('speed', 'السرعة', 1, 0, 10, .1), n('rise', 'الصعود', 1, -5, 5, .1), n('bottom', 'التركيز في الأسفل', 50, 0, 100), n('blur', 'ضبابية الهواء', 20, 0, 100)] },
    bokeh: { n: 'ضبابية عدسة سينمائية (Bokeh)', cat: C_LENS, p: [n('radius', 'نصف القطر', 16, 0, 120, .5), sel('depth', 'مصدر العمق', 'none', [['none', 'موحّد'], ['luma', 'من الإضاءة (الساطع بعيد)'], ['ilum', 'من الإضاءة (المظلم بعيد)'], ['alpha', 'من الشفافية/القناع'], ['vert', 'عمودي (أعلى بعيد)']]), n('focus', 'مسافة التركيز', 0, 0, 100), n('range', 'عمق الميدان', 20, 1, 100), sel('shape', 'شكل الفتحة', 'circle', [['circle', 'دائرة'], ['hex', 'سداسي'], ['oct', 'ثماني']]), n('boost', 'تعزيز النقاط الساطعة', 60, 0, 300), n('thr', 'عتبة النقاط', 70, 0, 100)] },
    tiltshift: { n: 'تيلت شيفت (مجسم مصغر)', cat: C_LENS, p: [pt('center', 'مركز التركيز', [.5, .55]), ang('angle', 'الزاوية', 0), n('width', 'عرض منطقة التركيز', 18, 0, 100), n('trans', 'نعومة الانتقال', 25, 1, 100), n('radius', 'الضبابية', 14, 0, 80, .5), n('sat', 'تشبع إضافي', 25, -100, 100), n('boost', 'تعزيز النقاط الساطعة', 40, 0, 300)] },
    mblur: { n: 'ضبابية حركة احترافية', cat: C_LENS, p: [sel('mode', 'النوع', 'dir', [['dir', 'اتجاهية'], ['radial', 'دورانية'], ['zoom', 'تكبير']]), n('amount', 'القوة', 40, 0, 400), ang('angle', 'الزاوية', 0), pt('center', 'المركز', [.5, .5]), sel('shutter', 'الغالق', 'center', [['center', 'متمركز'], ['trail', 'ذيل خلفي']])] },
    datamosh: { n: 'جليتش رقمي متقدم (Datamosh)', cat: C_DIG, p: [n('amount', 'القوة', 50, 0, 100), n('block', 'حجم الكتل', 24, 4, 200), n('smear', 'سحب البكسلات', 50, 0, 100), n('rgb', 'انفصال RGB', 30, 0, 100), n('slices', 'تمزق أفقي', 40, 0, 100), n('crush', 'تكسير الألوان', 30, 0, 100), n('speed', 'السرعة', 10, 0, 60, .1), n('seed', 'البذرة', 1, 1, 999)] },
    holo: { n: 'هولوغرام (Holomatrix)', cat: C_DIG, p: [col('color', 'اللون', '#3fd9ff'), n('lines', 'خطوط المسح', 50, 0, 100), n('lineSize', 'تباعد الخطوط', 4, 1, 30, .1), n('glitch', 'التشويش', 30, 0, 100), n('flicker', 'الوميض', 25, 0, 100), n('edge', 'إضاءة الحواف', 50, 0, 100), n('opacity', 'الشفافية', 85, 0, 100), n('rgb', 'انفصال الألوان', 20, 0, 100)] },
    electrify: { n: 'كهرباء (Electrify)', cat: C_DIG, p: [col('color', 'اللون', '#7cc8ff'), n('amount', 'القوة', 60, 0, 200), n('thr', 'عتبة الحواف', 25, 0, 100), n('detail', 'التفرع', 60, 0, 100), n('speed', 'السرعة', 12, 0, 60, .1), n('glow', 'التوهج', 60, 0, 200), n('seed', 'البذرة', 1, 1, 999)] },
    dither: { n: 'تنقيط (Dither)', cat: C_DIG, p: [sel('mode', 'الطريقة', 'bayer', [['bayer', 'منتظم (Bayer)'], ['noise', 'عشوائي (Blue Noise)'], ['diffuse', 'انتشار الخطأ'], ['halftone', 'نقاط نصفية']]), n('levels', 'مستويات الألوان', 2, 2, 16), n('size', 'حجم البكسل', 2, 1, 16, .5), sel('pal', 'اللوحة', 'mono', [['mono', 'أبيض وأسود'], ['source', 'ألوان المصدر'], ['gameboy', 'جيم بوي'], ['cga', 'CGA'], ['duo', 'لونين مخصصين']]), col('c1', 'اللون الداكن', '#1a1c2c'), col('c2', 'اللون الفاتح', '#f4f4f4'), n('amount', 'القوة', 100, 0, 100)] },
    print: { n: 'طباعة ونقاط (Halftone/Riso)', cat: C_STY, p: [sel('mode', 'النوع', 'cmyk', [['cmyk', 'طباعة CMYK'], ['riso', 'ريزوغراف'], ['news', 'جريدة (أسود)']]), n('size', 'حجم النقطة', 7, 2, 60, .1), ang('angle', 'الزاوية', 0), n('misreg', 'انزياح الطبقات', 15, 0, 100), n('ink', 'كثافة الحبر', 90, 0, 100), col('paper', 'لون الورق', '#f2ece0'), col('ink1', 'حبر ريزو 1', '#ff48b0'), col('ink2', 'حبر ريزو 2', '#0078bf'), n('grain', 'ملمس الورق', 30, 0, 100), n('amount', 'القوة', 100, 0, 100)] },
    celshade: { n: 'تظليل كرتوني (Cel Shading)', cat: C_STY, p: [n('levels', 'مستويات الظل', 4, 2, 12), n('softness', 'نعومة الحدود', 20, 0, 100), n('lines', 'خطوط الحبر', 60, 0, 100), n('thick', 'سماكة الخط', 1.5, .5, 6, .1), col('inkC', 'لون الحبر', '#14121a'), n('sat', 'التشبع', 120, 0, 200, 1, '%')] },
    sketch: { n: 'رسم تخطيطي (Sketch)', cat: C_STY, p: [sel('mode', 'النوع', 'pencil', [['pencil', 'قلم رصاص'], ['ink', 'حبر'], ['color', 'أقلام ملونة']]), n('stroke', 'عرض الخط', 2, .5, 10, .1), n('detail', 'التفاصيل', 60, 0, 100), n('hatch', 'التظليل المتقاطع', 40, 0, 100), col('paper', 'لون الورق', '#f4f1ea'), n('amount', 'القوة', 100, 0, 100)] },
    sharpen2: { n: 'حدّة ووضوح احترافي', cat: C_SHP, p: [n('amount', 'الحدّة', 80, 0, 500), n('radius', 'نصف القطر', 1.2, .3, 10, .1), n('thr', 'العتبة', 3, 0, 50), n('clarity', 'الوضوح (تباين محلي)', 25, -100, 100), n('cradius', 'نصف قطر الوضوح', 30, 5, 200), n('protect', 'حماية الإضاءات', 50, 0, 100)] },
    denoise: { n: 'إزالة التشويش (Denoise)', cat: C_SHP, p: [n('strength', 'القوة', 40, 0, 100), n('radius', 'نصف القطر', 3, 1, 8, .1), n('chroma', 'تنقية الألوان', 60, 0, 100), n('detail', 'حفظ التفاصيل', 30, 0, 100)] },
    handheld: { n: 'تثبيت ورجفة كاميرا يدوية', cat: C_CAM, p: [sel('mode', 'النمط', 'stand', [['stand', 'واقف (تنفس خفيف)'], ['walk', 'مشي'], ['run', 'جري'], ['vehicle', 'داخل مركبة'], ['tripod', 'حامل مهتز خفيف']]), n('amount', 'القوة', 100, 0, 400, 1, '%'), n('speed', 'السرعة', 100, 10, 400, 1, '%'), n('rot', 'الدوران', 100, 0, 400, 1, '%'), n('zoom', 'تكبير تعويضي', 6, 0, 30, .1, '%'), n('mblur', 'ضبابية الحركة', 50, 0, 200), n('seed', 'البذرة', 1, 1, 999)] },
    letterbox: { n: 'أشرطة سينمائية متحركة', cat: C_CAM, p: [sel('ratio', 'النسبة', '239', [['239', '2.39:1 سكوب'], ['235', '2.35:1'], ['200', '2:1'], ['185', '1.85:1'], ['166', '1.66:1'], ['133', '4:3 (أعمدة جانبية)'], ['100', '1:1']]), n('reveal', 'الظهور', 100, 0, 100, 1, '%'), n('offset', 'إزاحة الصورة', 0, -50, 50), n('soft', 'نعومة الحافة', 0, 0, 50), col('color', 'اللون', '#000000'), n('op', 'الشفافية', 100, 0, 100)] },
    hud: { n: 'واجهة تصويب (HUD)', cat: C_CAM, p: [col('color', 'اللون', '#7dffb0'), n('op', 'الشفافية', 80, 0, 100), sel('style', 'النمط', 'cam', [['cam', 'كاميرا تسجيل'], ['target', 'تصويب'], ['drone', 'طائرة مسيّرة']]), n('scan', 'خط المسح', 30, 0, 100), n('grid', 'الشبكة', 15, 0, 100), n('thick', 'السماكة', 3, .5, 8, .1)] },
    nvg: { n: 'رؤية ليلية احترافية', cat: C_VIS, p: [n('gain', 'التضخيم', 250, 50, 800, 1, '%'), n('noiz', 'التشويش', 45, 0, 100), n('bloom', 'توهج الإضاءات', 50, 0, 100), sel('tube', 'الأنبوب', 'bino', [['none', 'بدون'], ['mono', 'عدسة واحدة'], ['bino', 'منظار ثنائي']]), sel('phos', 'الفوسفور', 'green', [['green', 'أخضر P43'], ['white', 'أبيض P45']]), n('scint', 'التلألؤ', 30, 0, 100), n('vig', 'التظليل', 50, 0, 100)] },
    thermalcam: { n: 'كاميرا حرارية احترافية', cat: C_VIS, p: [sel('pal', 'لوحة الألوان', 'iron', [['white', 'أبيض ساخن'], ['black', 'أسود ساخن'], ['iron', 'حديد (Ironbow)'], ['rain', 'قوس قزح'], ['arctic', 'قطبي']]), n('lo', 'أدنى حرارة', 10, 0, 100), n('hi', 'أعلى حرارة', 90, 0, 100), n('warm', 'وزن الألوان الدافئة', 40, 0, 100), n('resol', 'دقة المستشعر', 320, 80, 1280), n('noiz', 'التشويش', 20, 0, 100), n('edge', 'تعزيز الحواف', 30, 0, 100), bool('hud', 'واجهة التصويب', 0)] },
    longshadow: { n: 'ظل طويل', cat: C_LAY, p: [ang('angle', 'الاتجاه', 135), n('len', 'الطول', 200, 0, 1500), col('color', 'اللون', '#000000'), n('op', 'الشفافية', 55, 0, 100), n('fade', 'التلاشي على الطول', 70, 0, 100)] },
    stroke: { n: 'حدود (Stroke)', cat: C_LAY, p: [n('width', 'العرض', 6, 0, 80, .1), col('color', 'اللون', '#e5484d'), sel('pos', 'الموضع', 'out', [['out', 'خارجي'], ['center', 'متوسط'], ['in', 'داخلي']]), n('op', 'الشفافية', 100, 0, 100), n('soft', 'النعومة', 0, 0, 20, .1), bool('only', 'الحدود فقط', 0)] },
    neon: { n: 'توهج نيون للنص', cat: C_LAY, p: [col('color', 'لون النيون', '#ff2bd6'), n('int', 'الشدة', 1.6, 0, 10, .01), n('radius', 'نصف القطر', 140, 4, 1000), n('core', 'تبييض القلب', 60, 0, 100), n('flicker', 'وميض النيون', 0, 0, 100), n('falloff', 'التلاشي', 35, -50, 100), n('seed', 'البذرة', 1, 1, 999)] },
    luster: { n: 'لمعان معدني للنص (Luster)', cat: C_LAY, p: [col('c1', 'اللون الداكن', '#6b4a12'), col('c2', 'اللون الفاتح', '#fff1b8'), n('bevel', 'البروز', 60, 0, 100), n('shine', 'شعاع اللمعان', 70, 0, 100), n('speed', 'سرعة الشعاع', 1, 0, 10, .1), ang('angle', 'زاوية الضوء', 135)] },
    texturize: { n: 'ملمس (ورق/خشن/قماش)', cat: C_STY, p: [sel('kind', 'الملمس', 'paper', [['paper', 'ورق قديم'], ['grunge', 'خشن متسخ'], ['canvas', 'قماش لوحة'], ['concrete', 'خرسانة']]), n('amount', 'القوة', 60, 0, 100), n('scale', 'المقياس', 100, 20, 400, 1, '%'), sel('blendm', 'المزج', 'overlay', [['overlay', 'تراكب'], ['mult', 'ضرب'], ['soft', 'ضوء ناعم']]), col('tint', 'لون الملمس', '#d8c8a8'), n('seed', 'البذرة', 1, 1, 999)] },
    spectral: { n: 'تدرج طيفي (Spectral)', cat: C_GEN, p: [sel('mode', 'النوع', 'flow', [['flow', 'انسيابي'], ['radial', 'شعاعي'], ['linear', 'خطي']]), n('scale', 'المقياس', 100, 10, 500), n('speed', 'السرعة', 1, 0, 10, .1), n('sat', 'التشبع', 85, 0, 100), n('bright', 'السطوع', 80, 0, 100), ang('hue', 'تدوير اللون', 0), sel('blendm', 'المزج', 'none', [['none', 'استبدال'], ['screen', 'شاشة'], ['overlay', 'تراكب'], ['color', 'لون']]), n('amount', 'القوة', 100, 0, 100)] },
    turbnoise: { n: 'ضجيج مضطرب (Turbulence)', cat: C_GEN, p: [n('scale', 'المقياس', 150, 5, 1000), n('detail', 'التفاصيل', 6, 1, 8), n('warp', 'الالتواء', 40, 0, 200), n('contrast', 'التباين', 120, 10, 400), n('speed', 'السرعة', 1, 0, 10, .1), n('evol', 'التطور', 0, -3600, 3600), col('c1', 'اللون 1', '#05060a'), col('c2', 'اللون 2', '#8fb4ff'), sel('blendm', 'المزج', 'none', [['none', 'استبدال'], ['screen', 'شاشة'], ['overlay', 'تراكب'], ['mult', 'ضرب']]), n('amount', 'القوة', 100, 0, 100)] }
  };
  Object.assign(GW.FX, DEFS);
  const TR = {
    vhsRewind: { n: 'ترجيع VHS', cat: 'شاشات وأشرطة' }, crtOff: { n: 'إطفاء شاشة CRT', cat: 'شاشات وأشرطة' }, glitchCut: { n: 'قطع جليتش', cat: 'رقمي' },
    filmBurn: { n: 'احتراق الفيلم', cat: 'سينمائي' }, leakWipe: { n: 'مسح بتسرب ضوئي', cat: 'سينمائي' }, whipBlur: { n: 'سحب سريع مع ضبابية حركة', cat: 'حركة' }, zoomThrough: { n: 'تكبير عبر المشهد', cat: 'تكبير' },
    expBlur: { n: 'تعريض ضبابي (Exposure Blur)', cat: 'سينمائي' }, bokehT: { n: 'انتقال بوكيه', cat: 'سينمائي' }, flickerCut: { n: 'قطع وامض', cat: 'رقمي' }, warpT: { n: 'التواء (Warp)', cat: 'تشويه' },
    flareT: { n: 'انتقال وهج عدسة', cat: 'سينمائي' }, insideCube: { n: 'داخل المكعب', cat: 'ثلاثي الأبعاد' }, shapeWipe: { n: 'مسح بشكل نجمة', cat: 'مسح' }, swishV: { n: 'سحب سريع عمودي', cat: 'حركة' }
  };
  Object.assign(GW.TRANS, TR);
  const TRK = Object.keys(TR);

  /* ================= shaders ================= */
  const H2 = `
float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 h22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h12(i),h12(i+vec2(1,0)),f.x),mix(h12(i+vec2(0,1)),h12(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=vn(p)*a; p=p*2.03+vec2(17.3,9.1); a*=.5; } return s; }
float n1(float x,float s){ float i=floor(x),f=fract(x); return mix(h12(vec2(i,s)),h12(vec2(i+1.,s)),f*f*(3.-2.*f))*2.-1.; }
vec3 rgb2yiq(vec3 c){ return vec3(dot(c,vec3(.299,.587,.114)),dot(c,vec3(.596,-.274,-.322)),dot(c,vec3(.211,-.523,.312))); }
vec3 yiq2rgb(vec3 y){ return vec3(y.x+.956*y.y+.621*y.z, y.x-.272*y.y-.647*y.z, y.x-1.106*y.y+1.703*y.z); }
float maxc(vec3 c){ return max(c.r,max(c.g,c.b)); }
vec3 hue2rgb(float h){ return clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.); }
vec2 rot2(vec2 p,float a){ float c=cos(a),s=sin(a); return vec2(c*p.x-s*p.y,s*p.x+c*p.y); }
`;
  const S = {};
  /* ---- Deep Glow: prefilter (soft-knee threshold, half res) → dual-filter down/up pyramid with per-octave weights → composite ---- */
  S.dg_pre = `uniform float thr,knee,tintMix,useLuma,srcMode,edgeMode; uniform vec3 tint;
    float br(vec3 c){ return useLuma>.5? luma(c) : maxc(c); }
    void main(){ vec2 e=.5/res; vec4 a=texture(t0,uv+vec2(-e.x,-e.y)), b=texture(t0,uv+vec2(e.x,-e.y)), c=texture(t0,uv+vec2(-e.x,e.y)), d=texture(t0,uv+vec2(e.x,e.y));
      vec3 cl=(a.rgb+b.rgb+c.rgb+d.rgb)*.25; float k;
      if(srcMode>.5){ cl=tint*(a.a+b.a+c.a+d.a)*.25; k=1.; }
      else if(edgeMode>.5){ vec2 E=1.5/vec2(textureSize(t0,0)); float gx=luma(texture(t0,uv+vec2(E.x,0.)).rgb)-luma(texture(t0,uv-vec2(E.x,0.)).rgb), gy=luma(texture(t0,uv+vec2(0.,E.y)).rgb)-luma(texture(t0,uv-vec2(0.,E.y)).rgb);
        float g=length(vec2(gx,gy)); k=smoothstep(thr*.5,thr*.5+.12,g)*2.; }
      else { float b0=br(cl); float kn=max(knee*max(thr,.02),1e-4); float sc=clamp(b0-thr+kn,0.,2.*kn); sc=sc*sc/(4.*kn); k=max(sc,b0-thr)/max(b0,1e-4); }
      vec3 g=max(cl*k,0.); if(tintMix>0.) g=mix(g,tint*maxc(g),tintMix); o=vec4(g,1.); }`;
  S.dg_down = `uniform vec2 d1,d2; void main(){ vec2 ts=1./vec2(textureSize(t0,0)); vec2 a=(d1+d2)*ts, b=(d1-d2)*ts; o=(texture(t0,uv)*4.+texture(t0,uv+a)+texture(t0,uv-a)+texture(t0,uv+b)+texture(t0,uv-b))/8.; }`;
  S.dg_up = `uniform sampler2D t1; uniform vec2 d1,d2; uniform vec3 w,wp;
    void main(){ vec2 ts=1./vec2(textureSize(t0,0)); vec2 a=d1*ts, b=d2*ts; vec4 s=texture(t0,uv+a)+texture(t0,uv-a)+texture(t0,uv+b)+texture(t0,uv-b);
      s+=(texture(t0,uv+(a+b)*.5)+texture(t0,uv+(a-b)*.5)+texture(t0,uv-(a+b)*.5)+texture(t0,uv-(a-b)*.5))*2.; o=vec4(s.rgb/12.*wp+texture(t1,uv).rgb*w,1.); }`;
  S.dg_streak = `uniform vec2 dir; uniform float stp,fall; void main(){ vec2 ts=1./vec2(textureSize(t0,0)); vec2 d=dir*ts*stp; vec3 s=texture(t0,uv).rgb; float ws=1.;
    for(int k=1;k<=3;k++){ float w=pow(fall,float(k)); s+=(texture(t0,uv+d*float(k)).rgb+texture(t0,uv-d*float(k)).rgb)*w; ws+=2.*w; } o=vec4(s/ws,1.); }`;
  S.dg_comp = `uniform sampler2D t1,t2; uniform float gain,sAmt,glowOnly,unm,roll,pres; uniform vec3 sCol;
    vec3 sh(vec3 x){ const float k=.8; return mix(x, k+(1.-k)*(1.-exp(-(x-k)/(1.-k))), step(k,x)); }
    void main(){ vec2 g2=.5/vec2(textureSize(t1,0)); vec3 g=(texture(t1,uv+g2).rgb+texture(t1,uv+vec2(-g2.x,g2.y)).rgb+texture(t1,uv+vec2(g2.x,-g2.y)).rgb+texture(t1,uv-g2).rgb)*.25*gain;
      if(sAmt>0.) g+=texture(t2,uv).rgb*sCol*sAmt;
      vec4 s=texture(t0,uv); vec3 c=glowOnly>.5? g : s.rgb+g; float a=glowOnly>.5?0.:s.a;
      if(unm>.5||glowOnly>.5) a=max(a,clamp(maxc(g),0.,1.));
      if(roll>.5){ float gm=smoothstep(0.,.08,maxc(g)); vec3 r; if(pres>.5){ float m=maxc(c); r=c*(sh(vec3(m)).x/max(m,1e-4)); } else r=sh(c); c=mix(c,r,gm); }
      o=vec4(max(c,0.),a); }`;
  S.dg_chroma = `uniform sampler2D t1; uniform float gain,disp,hue,unm; /* chromatic glow: R/G/B (and spectral blend) sampled at different radii of the blurred pyramid */
    void main(){ vec4 s=texture(t0,uv); vec3 acc=vec3(0.),ws=vec3(0.); for(int i=0;i<7;i++){ float t=float(i)/6.; vec3 w=hue2rgb(fract(t*.75+hue/360.)); float sc=1.+(t-.5)*disp*.5; vec2 q=.5+(uv-.5)/sc; acc+=texture(t1,q).rgb*w; ws+=w; }
      vec3 g=acc/ws*gain*3.; vec3 c=s.rgb+g; float a=unm>.5? max(s.a,clamp(maxc(g),0.,1.)) : s.a; o=vec4(c,a); }`;
  /* ---- VHS: pass 1 = tape geometry (tracking, wobble, head switching, jitter) + YIQ band-limiting (luma halo / chroma smear & delay) ---- */
  S.vhs1 = H2 + `uniform float gen,lumaBW,chromaBW,shift,halo,track,trackSpd,wobble,headSw,jitter,seed;
    float tband(float y){ float c=fract(time*trackSpd*.045+h12(vec2(seed,4.))); float d=y-c; d-=floor(d+.5); return exp(-d*d/(2.*.035*.035)); }
    void main(){ float g=gen/100.; float fld=floor(time*59.94), fr=floor(time*29.97); float y=1.-uv.y; float ln=floor(y*480.); float U=px/res.x;
      float jx=(h12(vec2(fr,seed))-.5)*jitter/100.*3.5;
      float wob=n1(y*5.+time*2.3,seed)*wobble/100.*4.+n1(y*36.+time*13.,seed+5.)*wobble/100.*1.3;
      float tb=tband(y)*track/100.; float tear=tb*((h12(vec2(ln,fld+seed))-.4)*70.+n1(y*30.+time*20.,seed+9.)*40.);
      float hz=smoothstep(.94,.96,y)*headSw/100.; float hs=hz*(30.+n1(ln*.7+fld,seed+2.)*18.)*(.4+.6*clamp((y-.94)/.06,0.,1.));
      float off=(jx+wob+tear+hs)*U; vec2 b=vec2(uv.x-off,uv.y);
      float sL=(.5+lumaBW/100.*2.6)*(1.+g*.9), sC=(2.+chromaBW/100.*15.)*(1.+g*.7);
      float Y1=0.,W1=0.,Y2=0.,W2=0.;
      for(int i=-6;i<=6;i++){ float x=float(i); vec3 c=texture(t0,b+vec2(x*sL*.5*U,0.)).rgb; float yy=dot(c,vec3(.299,.587,.114)); float w1=exp(-x*x*.125), w2=exp(-x*x/32.); Y1+=yy*w1; W1+=w1; Y2+=yy*w2; W2+=w2; }
      vec2 IQ=vec2(0.); float WC=0.; float cs=shift/100.*7.+g*2.5;
      for(int i=-14;i<=4;i++){ float x=float(i); float w=i<=0? exp(x*.2) : exp(-x*x*.5); vec3 c=texture(t0,b+vec2((x*sC/5.-cs)*U,0.)).rgb; IQ+=vec2(dot(c,vec3(.596,-.274,-.322)),dot(c,vec3(.211,-.523,.312)))*w; WC+=w; }
      IQ/=WC; float Y=Y1/W1, Yw=Y2/W2; Y+=(Y-Yw)*halo/100.*(1.6+g*1.5);
      float inb=step(0.,b.x)*step(b.x,1.); float a=texture(t0,b).a;
      o=vec4(Y*inb,IQ*inb+.5,mix(1.,a,inb)); }`;
  /* pass 2 = vertical chroma averaging, tape noise / streaks / dropouts, tracking snow, head-switch noise, colour drift, interlace, generation levels, 4:3, OSD */
  S.vhs2 = H2 + `uniform sampler2D t1; uniform float gen,noiz,drop,track,trackSpd,headSw,sat,drift,interlace,crop43,osdOn,seed;
    float tband(float y){ float c=fract(time*trackSpd*.045+h12(vec2(seed,4.))); float d=y-c; d-=floor(d+.5); return exp(-d*d/(2.*.035*.035)); }
    void main(){ float g=gen/100.; float fld=floor(time*59.94), fr=floor(time*29.97); float y=1.-uv.y; float ln=floor(y*480.);
      vec4 s=texture(t0,uv), s2=texture(t0,uv+vec2(0.,1./480.)); float Y=s.x; vec2 IQ=(s.yz+s2.yz)*.5-.5;
      float par=mod(ln+fld,2.); Y*=1.-interlace/100.*.10*par; Y+=interlace/100.*.02*(h12(vec2(fld,3.))-.5);
      float dr=drift/100.; float hr=n1(time*.35,seed+21.)*dr*.35+g*.06; float sa=sat/100.*(1.+n1(time*.5,seed+33.)*dr*.25)*(1.-g*.3);
      IQ=vec2(cos(hr)*IQ.x-sin(hr)*IQ.y,sin(hr)*IQ.x+cos(hr)*IQ.y)*sa;
      float nA=noiz/100.*(1.+g*1.5); float xs=uv.x*res.x/px;
      Y+=(h12(vec2(floor(xs/1.7),ln)+fld*vec2(7.13,3.71)+seed)-.5)*nA*.10;
      IQ+=(vec2(vn(vec2(xs/38.,ln*.35+fld*5.3+seed)),vn(vec2(xs/38.+50.,ln*.35+fld*5.3+seed)))-.5)*nA*.14;
      float r=h12(vec2(ln*1.37,fld+seed*3.)); float pS=nA*.012+drop/100.*.015;
      if(r<pS){ float x0=h12(vec2(ln,fld+11.)); float L=.02+.22*h12(vec2(ln,fld+13.)); float dx=uv.x-x0; float tl=dx>0.? exp(-dx/L*3.) : exp(dx*300.); Y=mix(Y,.95,clamp(tl,0.,1.)*.85); IQ*=1.-tl*.8; }
      float lb=floor(ln/3.); if(h12(vec2(lb*2.17,fr+seed*5.))<drop/100.*.02){ float x0=h12(vec2(lb,fld+21.)); float L=.04+.35*h12(vec2(lb,fld+23.)); float dx=uv.x-x0; float m=step(0.,dx)*step(dx,L); float sp=h12(vec2(floor(xs/3.),lb+fld)); Y=mix(Y,mix(.04,1.,step(.45,sp)),m*.9); IQ*=1.-m; }
      float tb=tband(y)*track/100.; float sn=h12(vec2(floor(xs/2.),ln)+fld*1.7); Y=mix(Y,sn>.5?.92:.08,tb*smoothstep(.3,1.,h12(vec2(ln,fld+77.)))*.85); Y*=1.-tb*.12; IQ*=1.-tb*.5;
      float hz=smoothstep(.94,.965,y)*headSw/100.; Y=mix(Y,h12(vec2(floor(xs/3.),ln+fld*3.)),hz*.3*step(.6,h12(vec2(ln,fld+5.)))); IQ*=1.-hz*.5;
      Y=Y*(1.-.12*g)+.03*g+.015;
      vec3 c=yiq2rgb(vec3(Y,IQ)); float a=s.w;
      if(crop43>.5){ float w43=(res.y*4./3.)/res.x; if(w43<1.){ float m=step(abs(uv.x-.5),w43*.5); c*=m; a=mix(1.,a,m); } }
      c=clamp(c,0.,1.); if(osdOn>.5){ vec4 t=texture(t1,uv); c=c*(1.-t.a)+t.rgb; a=max(a,t.a); }
      o=vec4(min(c,vec3(max(a,1e-4))),a); }`;
  /* ---- CRT ---- */
  S.crt = H2 + `uniform sampler2D t1; uniform float curv,corner,vig,mask,maskSize,maskStr,lines,beamMin,beamMax,bloom,conv,flicker,roll,rollSpd,glare,border,bright,phos,noiz;
    vec3 phosC(vec3 c){ float l=luma(c); if(phos>2.5) return l*vec3(.92,.96,1.); if(phos>1.5) return l*vec3(.25,1.,.42)*1.15; if(phos>.5) return l*vec3(1.,.62,.15)*1.2; return c; }
    vec3 smp(vec2 q){ vec2 cc=q-.5; float dx=conv/100.*(1.+abs(cc.x)*5.)*1.2*px/res.x; float dy=conv/100.*.5*px/res.y;
      vec3 c=vec3(texture(t0,q+vec2(dx,dy)).r,texture(t0,q).g,texture(t0,q-vec2(dx,dy)).b); vec2 h=vec2(.6*px/res.x,0.); c=c*.5+(texture(t0,q+h).rgb+texture(t0,q-h).rgb)*.25; return phosC(c); }
    void main(){ vec2 asp=vec2(res.x/res.y,1.); vec2 c=uv*2.-1.; float k=curv/100.;
      vec2 cw=c*vec2(1.+c.y*c.y*k*.10,1.+c.x*c.x*k*.15);
      float rad=corner/100.*.22+.01; vec2 p=abs(cw)*asp; vec2 q=p-(asp-rad); float d=length(max(q,0.))+min(max(q.x,q.y),0.)-rad; float ed=2.*px/res.y*2.;
      float scr=1.-smoothstep(-ed,0.,d);
      vec2 src=cw/(1.-border/100.)*.5+.5; float img=step(0.,src.x)*step(src.x,1.)*step(0.,src.y)*step(src.y,1.);
      float L=lines; float yl=src.y*L-.5; float i0=floor(yl); float f=yl-i0; vec3 col=vec3(0.);
      for(int j=0;j<2;j++){ float lj=i0+float(j); float dd=abs(f-float(j)); vec3 cc=smp(vec2(src.x,(lj+.5)/L)); cc*=cc;
        float w=mix(beamMin,beamMax,sqrt(maxc(cc)))/100.*.42+.06; col+=cc*exp(-dd*dd/(2.*w*w))*mix(1.,1./(w*2.5066),.65); }
      vec3 flat_=smp(src); flat_*=flat_; col=mix(flat_,col,smoothstep(1.15,2.,res.y/L));
      if(bloom>0.){ vec3 hb=texture(t1,src).rgb; hb=phosC(hb); col+=hb*hb*bloom/100.*.9; }
      vec2 fp=gl_FragCoord.xy/max(maskSize*px,.5); vec3 m=vec3(1.);
      if(mask>.5){ float xx=fp.x; if(mask>1.5&&mask<2.5) xx+=mod(floor(fp.y/2.),2.)*1.5; vec3 st=.5+.5*cos(6.2832*(xx/3.-vec3(0.,1./3.,2./3.))); st=st*st*1.;
        if(mask>1.5&&mask<2.5) st*=.65+.35*cos(6.2832*fp.y/2.); if(mask>2.5){ float gx=floor(fp.x/3.); float yy=fp.y+mod(gx,2.)*1.5; st*=smoothstep(0.,.25,fract(yy/3.))*(1.-smoothstep(.75,1.,fract(yy/3.)))*.4+.6; }
        float me=maskStr/100.*smoothstep(.9,2.4,maskSize*px); m=mix(vec3(1.),st*2.1,me); }
      col*=m;
      col*=1.+flicker/100.*(.05*n1(time*9.,7.)+.05*(h12(vec2(floor(time*30.),3.))-.5));
      float rb=fract(src.y+time*rollSpd*.12); col*=1.+roll/100.*.3*smoothstep(0.,.12,rb)*(1.-smoothstep(.12,.32,rb));
      col+=(h12(gl_FragCoord.xy+floor(time*30.)*vec2(91.7,37.3))-.5)*noiz/100.*.08;
      col*=1.-vig/100.*.7*pow(clamp(length(cw*vec2(.75,.85)),0.,1.4),3.);
      col=sqrt(max(col,0.))*bright/100.; col*=img;
      vec2 gp=cw-vec2(-.55,.6); float gl=glare/100.*(.10*exp(-dot(gp,gp)*2.2)+.06*exp(-abs(d)*60.)+.025*(1.-c.y)*.5);
      col+=vec3(.85,.9,1.)*gl;
      vec3 bez=vec3(.03)*(1.-.4*length(c))+vec3(.06)*exp(-max(d,0.)*30.); col=mix(bez,col,scr);
      o=vec4(clamp(col,0.,1.),1.); }`;
  /* ---- film ---- */
  S.fgrain = H2 + `uniform float stock,amount,size,color,shadows,highs,soft,fps,seed;
    float gv(vec2 p,float k){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h12(i+k),h12(i+vec2(1,0)+k),f.x),mix(h12(i+vec2(0,1)+k),h12(i+vec2(1,1)+k),f.x),f.y)-.5; }
    vec3 gr(vec2 p,float k){ return vec3(gv(p,k),gv(p,k+31.7),gv(p,k+63.1)); }
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float sc=stock<.5?1.:stock<1.5?1.9:3.2; float am=stock<.5?.75:stock<1.5?1.:1.4;
      float fr=floor(time*fps)+seed*7.; vec2 P=gl_FragCoord.xy/(sc*size/100.*1.1*px); vec2 jo=h22(vec2(fr,seed))*97.;
      vec3 g=gr(P+jo,fr*1.31)*1.6+gr(P*2.1+jo,fr*2.7)*mix(.9,.35,soft/100.);
      vec3 gm=vec3(g.r*.3+g.g*.5+g.b*.2); vec3 gg=mix(gm,g,color/100.);
      float l=luma(c); float resp=mix(shadows/100.,1.,smoothstep(0.,.3,l))*mix(1.,highs/100.,smoothstep(.55,1.,l))*(.7+1.2*l*(1.-l));
      c+=gg*amount/100.*.30*resp*am; o=pre(c,s.a); }`;
  S.fdamage = H2 + `uniform float dust,scratch,hair,weave,flicker,blotch,tone,fps,seed;
    void main(){ float fr=floor(time*fps)+seed*13.; vec2 asp=vec2(res.x/res.y,1.); vec2 U=px/res;
      vec2 wv=vec2(n1(time*2.1,seed)*.6+(h12(vec2(fr,1.))-.5)*.5, n1(time*1.7,seed+4.)*.8+(h12(vec2(fr,2.))-.5)*.6)*weave/100.*7.;
      vec4 s=texture(t0,uv+wv*U); vec3 c=unp(s);
      c*=1.+flicker/100.*((h12(vec2(fr,3.))-.5)*.24+n1(time*3.,seed+5.)*.08);
      if(blotch>0.){ float on=step(1.-blotch/100.*.45,h12(vec2(floor(fr/2.),6.))); vec2 bp=h22(vec2(fr,7.)); float d=length((uv-bp)*asp); float bm=fbm((uv-bp)*asp*5.+fr)+(.22-d)*1.6; float m=on*smoothstep(.60,.66,bm); float e=on*smoothstep(.52,.60,bm)*(1.-m);
        c=mix(c,c*vec3(1.05,.8,.5)+vec3(.15,.07,0.),e); c=mix(c,vec3(1.,.93,.75),m); }
      float sc=0.,sd=0.;
      for(int i=0;i<5;i++){ float fi=float(i); float on=step(h12(vec2(fi,floor(time*.7+fi*.37)+seed)),scratch/100.*.75);
        float x=h12(vec2(fi,seed+9.))+n1(time*.4+fi*3.,seed+fi)*.03+(h12(vec2(fr,fi))-.5)*.0015; float w=(.7+h12(vec2(fi,seed+10.))*1.6)*U.x; float d=abs(uv.x-x);
        float brk=smoothstep(.25,.45,vn(vec2(fi*7.,uv.y*6.+fr*.5))); float v=on*brk*(1.-smoothstep(w*.4,w*1.3,d))*(.55+.45*h12(vec2(fr,fi+20.)));
        if((tone<.5&&mod(fi,2.)<1.)||(tone>.5&&tone<1.5)) sc=max(sc,v); else sd=max(sd,v); }
      vec2 gp=uv*asp*9.; vec2 cell=floor(gp); vec2 cp=h22(cell+fr*vec2(3.1,7.7)); float pres=step(1.-dust/100.*.22,h12(cell*1.31+fr*.71));
      vec2 dp=gp-cell-.15-cp*.7; float rr=(.004+.016*pow(h12(cell+fr+2.),3.))*9.*.12; float dd=length(dp)*(1.+.6*(vn(dp*60.+fr)-.5)); float dm=pres*(1.-smoothstep(rr*.6,rr,dd));
      float white=tone<.5? step(.5,h12(cell+fr+5.)) : tone<1.5?1.:0.;
      if(h12(vec2(fr,41.))<hair/100.*.6){ vec2 hp=h22(vec2(fr,43.)); float ha=h12(vec2(fr,44.))*6.28; vec2 lp=(uv-hp)*asp; lp=vec2(cos(ha)*lp.x+sin(ha)*lp.y,-sin(ha)*lp.x+cos(ha)*lp.y); float L=.04+.08*h12(vec2(fr,45.));
        float hd=abs(lp.y-.012*sin(lp.x*40.+fr)-.02*lp.x*lp.x*20.); float hw=1.2*U.y; float hm=(1.-smoothstep(hw*.5,hw,hd))*step(abs(lp.x),L); sd=max(sd,hm*.9); }
      c=mix(c,vec3(.03),sd*.85); c=mix(c,vec3(.95),sc*.8); c=mix(c,mix(vec3(.04),vec3(.96),white),dm*.9);
      o=pre(c,s.a); }`;
  S.filmemu = H2 + `uniform float stock,amount,expo,contrast,warmth,fade;
    const vec3 K[7]=vec3[7](vec3(1.95,1.85,1.75),vec3(1.35,1.35,1.28),vec3(1.55,1.5,1.5),vec3(1.32,1.38,1.3),vec3(2.15,2.,1.85),vec3(2.1,2.05,2.),vec3(1.95));
    const float SAT[7]=float[7](1.06,.9,.95,.78,1.3,1.45,0.);
    const vec3 SH[7]=vec3[7](vec3(-.025,.0,.03),vec3(.012,.004,-.006),vec3(-.018,.0,.022),vec3(-.012,.012,0.),vec3(0.,-.006,.022),vec3(-.012,-.01,.03),vec3(0.));
    const vec3 HI[7]=vec3[7](vec3(.035,.012,-.035),vec3(.03,.014,-.018),vec3(.004,0.,-.006),vec3(0.,.012,-.01),vec3(.035,0.,-.035),vec3(.012,0.,0.),vec3(0.));
    const float FD[7]=float[7](.01,.035,.015,.03,0.,0.,.012);
    float cv(float x,float k){ k*=.62; float lx=log2(max(x,1e-4))-log2(.18); float y=1./(1.+exp(-k*lx)); float y0=1./(1.+exp(-k*(log2(.0015)-log2(.18)))), y1=1./(1.+exp(-k*(log2(1.)-log2(.18)))); return (y-y0)/(y1-y0); }
    void main(){ vec4 s=texture(t0,uv); vec3 c0=unp(s); int i=int(stock+.5); vec3 c=c0*exp2(expo); c=pow(max(c,0.),vec3(2.2));
      c*=vec3(1.+warmth/400.,1.,1.-warmth/400.);
      if(i==6) c=vec3(dot(c,vec3(.42,.46,.12)));
      vec3 k=K[i]*(1.+contrast/150.); vec3 r=vec3(cv(c.r,k.r),cv(c.g,k.g),cv(c.b,k.b));
      float l=luma(r); r=mix(vec3(l),r,SAT[i]+(i==6?0.:0.)); if(i==6) r=vec3(l);
      r+=SH[i]*(1.-smoothstep(0.,.5,l))*2.+HI[i]*smoothstep(.45,1.,l)*2.;
      float fd=FD[i]+fade/100.*.12; r=r*(1.-fd)+fd;
      o=pre(mix(c0,r,amount/100.),s.a); }`;
  S.olddoc = H2 + `uniform float tone,grain,vig,flicker,soft,weave,dust,contrast,seed; uniform vec3 toneC;
    void main(){ float fr=floor(time*18.)+seed*11.; vec2 U=px/res; vec2 asp=vec2(res.x/res.y,1.);
      vec2 wv=vec2(n1(time*1.9,seed)*.7+(h12(vec2(fr,1.))-.5)*.6,n1(time*1.5,seed+3.)+(h12(vec2(fr,2.))-.5)*.8)*weave/100.*8.; vec2 q=uv+wv*U;
      float r=soft/100.*2.5; vec4 s=texture(t0,q)*.4; s+=(texture(t0,q+vec2(r,0.)*U)+texture(t0,q-vec2(r,0.)*U)+texture(t0,q+vec2(0.,r)*U)+texture(t0,q-vec2(0.,r)*U))*.15;
      vec3 c=unp(s); float l=luma(c); l=clamp((l-.5)*(1.+contrast/100.)+.5,0.,1.);
      vec3 tc=mix(vec3(l),l*toneC/max(luma(toneC),.05)*.95+vec3(.02,.01,0.),tone/100.); vec3 cc=mix(c,tc,max(tone/100.,.85));
      cc*=1.+flicker/100.*((h12(vec2(fr,3.))-.5)*.3+n1(time*4.,seed+7.)*.06);
      float gn=(h12(gl_FragCoord.xy/(1.6*px)+fr*vec2(13.1,7.3))+h12(gl_FragCoord.xy/(1.6*px)+fr*vec2(5.7,11.9))-1.); cc+=gn*grain/100.*.22*(.4+l*(1.-l)*2.);
      float sx=h12(vec2(floor(time*.6),seed+1.)); float scr=(1.-smoothstep(.4*U.x,1.4*U.x,abs(uv.x-sx-n1(time*.5,seed)*.02)))*step(.4,vn(vec2(sx*9.,uv.y*5.+fr)))*step(.45,dust/100.);
      vec2 cell=floor(uv*asp*8.); vec2 cp=h22(cell+fr); float pr=step(1.-dust/100.*.2,h12(cell+fr*.77)); float dm=pr*(1.-smoothstep(.004,.008,length(uv*asp*8.-cell-.2-cp*.6)*.12*(1.+.5*h12(cell+fr+3.))));
      cc=mix(cc,vec3(.95,.92,.85),scr*.7); cc=mix(cc,vec3(.05),dm);
      float v=smoothstep(1.3,.35,length((uv-.5)*vec2(asp.x*.85,1.))*1.15); cc*=mix(1.,v,vig/100.);
      o=pre(cc,s.a); }`;
  S.noir = H2 + `uniform float contrast,red,glow,vig,grain; uniform vec3 tint; uniform float tintAmt;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec3 w=vec3(.3,.59,.11)+vec3(red,-red*.6,-red*.4)/100.*.5; float l=clamp(dot(c,w),0.,1.);
      float gl=0.; for(int i=0;i<8;i++){ float a=float(i)*.785; vec2 d=vec2(cos(a),sin(a))*10.*px/res; gl+=max(luma(unp(texture(t0,uv+d)))-.65,0.); } l+=gl/8.*glow/100.*1.5;
      float k=1.+contrast/100.; l=clamp(l,0.,1.); l=l<.5? .5*pow(2.*l,k) : 1.-.5*pow(2.*(1.-l),k);
      l+=(h12(gl_FragCoord.xy+floor(time*24.)*vec2(3.7,9.1))-.5)*grain/100.*.15; vec2 asp=vec2(res.x/res.y,1.); l*=mix(1.,smoothstep(1.2,.3,length((uv-.5)*asp)),vig/100.);
      vec3 r=mix(vec3(l),l*tint/max(luma(tint),.05),tintAmt/100.); o=pre(r,s.a); }`;
  S.multitone = `uniform vec3 c1,c2,c3,c4; uniform float amount,contrast; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=clamp((luma(c)-.5)*(1.+contrast/100.)+.5,0.,1.);
      vec3 r=l<.33?mix(c1,c2,l/.33):l<.66?mix(c2,c3,(l-.33)/.33):mix(c3,c4,(l-.66)/.34); o=pre(mix(c,r,amount/100.),s.a); }`;
  /* ---- lens ---- */
  S.lensdist = `uniform float k1,k2,ca,caEdge,fit,vig; uniform vec2 center;
    vec3 spec(float t){ return clamp(vec3(1.5-abs(t*4.-3.2),1.5-abs(t*4.-2.),1.5-abs(t*4.-.8)),0.,1.); }
    void main(){ vec2 C=vec2(center.x,1.-center.y); vec2 asp=vec2(res.x/res.y,1.); vec2 d=(uv-C)*asp; float dg=length(asp*.5); vec2 dn=d/dg; float r2=dot(dn,dn);
      float K1=k1/100.*.5, K2=k2/100.*.3; float fs=1.; if(fit>.5){ float m=1.+K1+K2; fs=m>1.?1./m:1.; }
      vec3 acc=vec3(0.),ws=vec3(0.); float A=0.,WA=0.;
      for(int i=0;i<9;i++){ float t=(float(i)+.5)/9.; vec3 w=spec(t); float cs=1.+ca/100.*.028*(t-.5)*mix(1.,r2*2.,caEdge/100.);
        vec2 q=C+d*(1.+K1*r2+K2*r2*r2)*cs*fs/asp; float inb=step(0.,q.x)*step(q.x,1.)*step(0.,q.y)*step(q.y,1.); vec4 sm=texture(t0,q)*inb; acc+=sm.rgb*w; ws+=w; A+=sm.a; WA+=1.; }
      float v=mix(1.,pow(cos(atan(length(dn)*.9)),4.),vig/100.); o=vec4(acc/ws*v,A/WA); o.rgb=min(o.rgb,vec3(o.a)); }`;
  S.prism = `uniform float amount,angle,mode,samples; uniform vec2 center;
    void main(){ vec2 C=vec2(center.x,1.-center.y); vec2 asp=vec2(res.x/res.y,1.); vec3 acc=vec3(0.),ws=vec3(0.); float A=0.; int N=int(samples);
      for(int i=0;i<24;i++){ if(i>=N) break; float t=(float(i)+.5)/float(N); vec3 w=clamp(vec3(1.5-abs(t*4.-3.2),1.5-abs(t*4.-2.),1.5-abs(t*4.-.8)),0.,1.); vec2 q;
        if(mode<.5){ q=C+(uv-C)*(1.+(t-.5)*amount/100.*.08); } else { vec2 dir=vec2(cos(radians(angle)),sin(radians(angle))); q=uv+dir*(t-.5)*amount*px/res*.8; }
        vec4 s=texture(t0,q); acc+=s.rgb*w; ws+=w; A+=s.a; }
      o=vec4(acc/ws,A/float(N)); o.rgb=min(o.rgb,vec3(max(o.a,1e-4))); }`;
  S.heatwave = H2 + `uniform float amount,scale,speed,rise,bottom,blur;
    void main(){ vec2 asp=vec2(res.x/res.y,1.); vec2 p=uv*res/(scale*px)+vec2(0.,-time*rise*.8); float t=time*speed;
      vec2 d=vec2(fbm(p+vec2(t*.7,0.))-.5,fbm(p*1.3+vec2(5.2,t))-.5); float m=mix(1.,smoothstep(1.,.0,uv.y)*1.3,bottom/100.);
      vec2 off=d*amount*px/res*m*2.; vec4 c=texture(t0,uv+off); float b=blur/100.*m*length(d)*6.; if(b>0.){ vec2 e=b*px/res*2.; c=c*.5+(texture(t0,uv+off+vec2(e.x,0.))+texture(t0,uv+off-vec2(e.x,0.))+texture(t0,uv+off+vec2(0.,e.y))+texture(t0,uv+off-vec2(0.,e.y)))*.125; } o=c; }`;
  S.bokeh = H2 + `uniform float radius,depth,focus,range,shape,boost,thr,sat,bandOn,bw,btr,bang; uniform vec2 bc;
    float cf(vec4 s,vec2 q){ if(bandOn>.5){ vec2 asp=vec2(res.x/res.y,1.); vec2 d=(q-vec2(bc.x,1.-bc.y))*asp; float a=radians(bang); float y=abs(-d.x*sin(a)+d.y*cos(a)); return smoothstep(bw*.5,bw*.5+btr+.001,y); }
      if(depth<.5) return 1.; float z; vec3 c=unp(s); if(depth<1.5) z=luma(c); else if(depth<2.5) z=1.-luma(c); else if(depth<3.5) z=1.-s.a; else z=q.y;
      return smoothstep(range/200.,range/200.+.2,abs(z-focus/100.)); }
    void main(){ vec4 s0=texture(t0,uv); float R=radius*px; if(R<.5){ o=s0; return; } vec4 acc=s0*.05; float ws=.05; float rot=h12(gl_FragCoord.xy)*6.2832;
      float nb=shape<1.5?6.:8.; float sg=6.2832/nb;
      for(int i=0;i<96;i++){ float fi=float(i); float rr=sqrt((fi+.5)/96.); float th=fi*2.39996+rot; float pr=1.; if(shape>.5){ float a=mod(th,sg)-sg*.5; pr=cos(sg*.5)/cos(a); }
        vec2 off=vec2(cos(th),sin(th))*rr*pr*R; vec2 q=uv+off/res; vec4 sm=texture(t0,q); float cs=cf(sm,q)*R; float w=clamp(cs-rr*R+1.,0.,1.);
        float lb=maxc(unp(sm)); w*=1.+boost/100.*5.*smoothstep(thr/100.,1.,lb)*lb; acc+=sm*w; ws+=w; }
      vec4 r=acc/ws; float f0=cf(s0,uv); r=mix(s0,r,smoothstep(0.,.08,f0)); if(sat!=0.){ vec3 c=unp(r); c=mix(vec3(luma(c)),c,1.+sat/100.); r=pre(c,r.a); } o=r; }`;
  S.mblur2 = H2 + `uniform float mode,amount,angle,shutter; uniform vec2 center;
    void main(){ vec2 C=vec2(center.x,1.-center.y); vec2 asp=vec2(res.x/res.y,1.); float j=h12(gl_FragCoord.xy); vec4 acc=vec4(0.); float ws=0.;
      for(int i=0;i<48;i++){ float t=(float(i)+j)/48.; float tt=shutter<.5?t-.5:-t; float w=shutter<.5?1.-abs(t-.5)*.9:1.-t*.7; vec2 q;
        if(mode<.5){ q=uv+vec2(cos(radians(angle)),-sin(radians(angle)))*amount*px/res*tt; }
        else if(mode<1.5){ float a=radians(amount*.25)*tt; vec2 p=(uv-C)*asp; p=rot2(p,a); q=p/asp+C; }
        else { q=C+(uv-C)/(1.+amount/250.*tt); }
        acc+=texture(t0,q)*w; ws+=w; } o=acc/ws; }`;
  /* ---- digital ---- */
  S.datamosh = H2 + `uniform float amount,block,smear,rgb,slices,crush,speed,seed;
    void main(){ float tt=floor(time*speed)+seed*13.; float A=amount/100.; vec2 P=uv*res; float B=max(block*px,2.);
      vec2 bi=floor(P/B); float on=step(h12(bi+tt*vec2(1.7,9.3)),A*.32); vec2 bi2=floor(P/(B*4.)); on=max(on,step(h12(bi2+tt*3.1),A*.12));
      vec2 q=uv; float sl=floor(uv.y*res.y/(B*.6)); float son=step(h12(vec2(sl,tt+5.)),slices/100.*A*.45); q.x+=son*(h12(vec2(sl,tt+6.))-.5)*.3*A;
      vec2 disp=(h22(bi+tt)-.5)*B*2.5/res; q+=on*disp;
      if(on>.5&&h12(bi*1.3+tt+.7)<smear/100.){ vec2 org=bi*B/res; if(h12(bi+tt+2.)>.5) q.x=org.x+disp.x; else q.y=org.y+B/res.y+disp.y; q.x+=(h12(vec2(floor(P.y/2.),tt))-.5)*.002; }
      float sp=rgb/100.*(on*.014+son*.02+.0025*A); vec4 cc=texture(t0,q); vec4 rr=texture(t0,q+vec2(sp,0.)), bb=texture(t0,q-vec2(sp,0.)); vec4 c=vec4(rr.r,cc.g,bb.b,cc.a);
      if(on>.5&&crush>0.){ vec3 bcol=unp(texture(t0,(bi+.5)*B/res+disp)); vec3 y=rgb2yiq(unp(c)); vec3 by=rgb2yiq(bcol); y.yz=mix(y.yz,by.yz*1.4,crush/100.); float lv=mix(48.,5.,crush/100.); y.x=floor(y.x*lv+.5)/lv; c.rgb=clamp(yiq2rgb(y),0.,1.)*c.a; }
      o=c; o.rgb=min(o.rgb,vec3(o.a)); }`;
  S.holo = H2 + `uniform vec3 color; uniform float lines,lineSize,glitch,flicker,edge,opacity,rgb;
    void main(){ float fr=floor(time*24.); vec2 U=px/res; float y=gl_FragCoord.y; float band=floor(uv.y*40.); float g=step(1.-glitch/100.*.25,h12(vec2(band,fr)));
      vec2 q=uv+vec2(g*(h12(vec2(band,fr+1.))-.5)*.06+n1(uv.y*30.+time*8.,2.)*glitch/100.*.003,0.);
      vec4 s=texture(t0,q); float sp=rgb/100.*6.*U.x; float r=texture(t0,q+vec2(sp,0.)).a, b=texture(t0,q-vec2(sp,0.)).a;
      float l=luma(unp(s)); vec2 E=1.5*U; float ga=abs(texture(t0,q+vec2(E.x,0.)).a-texture(t0,q-vec2(E.x,0.)).a)+abs(texture(t0,q+vec2(0.,E.y)).a-texture(t0,q-vec2(0.,E.y)).a);
      float ge=abs(luma(unp(texture(t0,q+vec2(E.x,0.))))-luma(unp(texture(t0,q-vec2(E.x,0.)))))+abs(luma(unp(texture(t0,q+vec2(0.,E.y))))-luma(unp(texture(t0,q-vec2(0.,E.y)))));
      float sc=1.-lines/100.*.6*step(.5,fract(y/(lineSize*px))); float mv=1.+.6*smoothstep(.96,1.,fract(uv.y*1.5-time*.35));
      float fl=1.-flicker/100.*(.35*step(.9,h12(vec2(fr,7.)))+.1*n1(time*20.,3.));
      vec3 c=color*(.35+l*.9)+color*(ga+ge*2.)*edge/100.*1.5; c*=sc*mv*fl; float a=s.a*opacity/100.*fl;
      vec3 fr_=vec3(max(r-s.a,0.),0.,max(b-s.a,0.))*opacity/100.; float a2=max(a,maxc(fr_)); o=vec4(min(c*a+fr_*.9,vec3(a2)),a2); }`;
  S.electrify = H2 + `uniform vec3 color; uniform float amount,thr,detail,speed,glow,seed;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float tt=floor(time*speed)+seed; vec2 U=px/res; vec2 p=uv*res/(px*60.);
      vec2 w=vec2(fbm(p+tt*1.7),fbm(p+vec2(4.1,tt*2.3)))-.5; vec2 q=uv+w*U*14.*detail/100.;
      vec2 E=1.5*U; float ga=abs(texture(t0,q+vec2(E.x,0.)).a-texture(t0,q-vec2(E.x,0.)).a)+abs(texture(t0,q+vec2(0.,E.y)).a-texture(t0,q-vec2(0.,E.y)).a);
      float gL=abs(luma(texture(t0,q+vec2(E.x,0.)).rgb)-luma(texture(t0,q-vec2(E.x,0.)).rgb))+abs(luma(texture(t0,q+vec2(0.,E.y)).rgb)-luma(texture(t0,q-vec2(0.,E.y)).rgb));
      float e=smoothstep(thr/100.*.4,thr/100.*.4+.15,max(ga,gL*1.5));
      float arcs=pow(1.-abs(fbm(uv*res/(px*25.)+tt*3.1)*2.-1.),12.)*smoothstep(.1,.5,e+fbm(uv*res/(px*80.)+tt))*detail/100.;
      float g=0.; for(int i=0;i<8;i++){ float a=float(i)*.785; vec2 d=vec2(cos(a),sin(a))*U*8.; g+=texture(t0,uv+d).a; } g=abs(g/8.-s.a); arcs*=smoothstep(.04,.3,g+e); float m=e*(.6+.4*h12(vec2(floor(uv.y*res.y/(px*3.)),tt)))+arcs;
      vec3 L=color*(m*1.5+g*glow/100.*2.)*amount/100.+vec3(1.)*m*m*amount/100.*.6; vec3 r=s.rgb+L; o=vec4(r,max(s.a,clamp(maxc(L),0.,1.))); }`;
  S.dither = H2 + `uniform float mode,levels,size,pal,amount; uniform vec3 c1,c2;
    float bayer(vec2 p){ vec2 q=mod(floor(p),8.);
      int x=int(q.x),y=int(q.y); int M[64]=int[64](0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21); return (float(M[y*8+x])+.5)/64.; }
    vec3 palq(vec3 c){ if(pal<.5||pal>3.5) return vec3(luma(c)); return c; }
    void main(){ float S=max(size*px,1.); vec2 P=floor(gl_FragCoord.xy/S); vec2 q=(P+.5)*S/res; vec4 s=texture(t0,q); vec3 c=unp(s); vec3 v=palq(c); float th;
      if(mode<.5) th=bayer(P); else if(mode<1.5) th=fract(h12(P)+h12(P*1.7+3.)*.5+.5*h12(P*.5)); else if(mode<2.5){ float e=0.; e+=(fract(luma(unp(texture(t0,(P+vec2(-1.,0.)+.5)*S/res)))*(levels-1.))-.5)*.4375; e+=(fract(luma(unp(texture(t0,(P+vec2(1.,1.)+.5)*S/res)))*(levels-1.))-.5)*.1875; e+=(fract(luma(unp(texture(t0,(P+vec2(0.,1.)+.5)*S/res)))*(levels-1.))-.5)*.3125; e+=(fract(luma(unp(texture(t0,(P+vec2(-1.,1.)+.5)*S/res)))*(levels-1.))-.5)*.0625; th=clamp(.5-e+(h12(P)-.5)*.3,0.,1.); }
      else { vec2 cp=fract(rot2(gl_FragCoord.xy,.785)/(S*4.))-.5; th=clamp(length(cp)*1.41,0.,1.); }
      float L=levels-1.; vec3 qv=floor(v*L+th)/L; vec3 r;
      if(pal<.5) r=qv; else if(pal<1.5) r=qv; else if(pal<2.5){ float l=qv.x; r=l<.34?vec3(.06,.22,.06):l<.67?vec3(.19,.38,.19):l<.99?vec3(.55,.67,.06):vec3(.61,.74,.06); r=mix(vec3(.06,.22,.06),vec3(.61,.74,.06),floor(luma(c)*3.+th)/3.); }
      else if(pal<3.5){ float l=floor(luma(c)*3.+th)/3.; vec3 p0=vec3(0.),p1=vec3(.33,1.,1.),p2=vec3(1.,.33,1.),p3=vec3(1.); r=l<.2?p0:l<.5?p1:l<.8?p2:p3; }
      else r=mix(c1,c2,qv.x);
      vec4 s0=texture(t0,uv); o=pre(mix(unp(s0),r,amount/100.),s0.a); }`;
  /* ---- stylize ---- */
  S.print = H2 + `uniform float mode,size,angle,misreg,ink,grain,amount; uniform vec3 paper,ink1,ink2;
    vec4 cmyk(vec3 c){ float k=1.-maxc(c); vec3 m=(1.-c-k)/max(1.-k,1e-3); return vec4(m,k); }
    float cov(vec2 P,float ang,float S,int ch,vec2 off){ float a=radians(ang+angle); vec2 p=rot2(P-off,-a)/S; vec2 cc=floor(p)+.5; vec2 f=p-cc; vec2 sp=rot2(cc*S,a)+off; vec3 c=unp(texture(t0,sp/res));
      float v; if(mode<.5){ vec4 k=cmyk(c); v=ch==0?k.x:ch==1?k.y:ch==2?k.z:k.w*.95; } else if(mode<1.5){ v=ch==0?clamp((1.-c.g)*1.1-.1,0.,1.):clamp((1.-c.r)*.7+(1.-luma(c))*.4-.15,0.,1.); v=pow(v,1.5); } else v=1.-luma(c);
      float r=sqrt(clamp(v,0.,1.))*.75; float aa=.7/S; return 1.-smoothstep(r-aa,r+aa,length(f)); }
    void main(){ vec2 P=gl_FragCoord.xy; float S=size*px; float mr=misreg/100.*S*.4; vec4 s=texture(t0,uv); vec3 c=paper; float id=ink/100.;
      float pg=.92+.08*fbm(P/(px*3.))*grain/100.*2.; float mot=.85+.3*vn(P/(px*6.));
      if(mode<.5){ c*=mix(vec3(1.),vec3(0.,.62,.9),cov(P,15.,S,0,vec2(mr,0.))*id*mot); c*=mix(vec3(1.),vec3(.92,.04,.52),cov(P,75.,S,1,vec2(0.,mr))*id*mot); c*=mix(vec3(1.),vec3(1.,.93,0.),cov(P,0.,S,2,vec2(-mr,-mr*.5))*id*mot); c*=mix(vec3(1.),vec3(.12,.11,.13),cov(P,45.,S,3,vec2(0.))*id); }
      else if(mode<1.5){ float g1=(h12(P*.37)-.5)*.25; c*=mix(vec3(1.),ink1,clamp(cov(P,15.,S,0,vec2(mr*2.,mr))+g1,0.,1.)*id*mot); c*=mix(vec3(1.),ink2,clamp(cov(P,75.,S,1,vec2(-mr,0.))+g1,0.,1.)*id*mot); }
      else c*=mix(vec3(1.),vec3(.1),cov(P,45.,S,3,vec2(0.))*id*mot);
      c*=pg; o=pre(mix(unp(s),c,amount/100.),s.a); }`;
  S.celshade = `uniform float levels,softness,lines,thick,sat; uniform vec3 inkC;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float L=luma(c); float q=L*levels; float fq=fract(q); float sw=softness/100.*.45+.02; float qs=(floor(q)+smoothstep(.5-sw,.5+sw,fq))/levels;
      vec3 c2=clamp(c*(qs/max(L,.02)),0.,1.); c2=mix(vec3(luma(c2)),c2,sat/100.);
      vec2 e=thick*px/res; float tl=luma(unp(texture(t0,uv+vec2(-e.x,e.y)))),t=luma(unp(texture(t0,uv+vec2(0.,e.y)))),tr=luma(unp(texture(t0,uv+e))),l=luma(unp(texture(t0,uv-vec2(e.x,0.)))),r=luma(unp(texture(t0,uv+vec2(e.x,0.)))),bl=luma(unp(texture(t0,uv-e))),b=luma(unp(texture(t0,uv-vec2(0.,e.y)))),br=luma(unp(texture(t0,uv+vec2(e.x,-e.y))));
      float gx=-tl-2.*l-bl+tr+2.*r+br, gy=-tl-2.*t-tr+bl+2.*b+br; float g=smoothstep(.25,.6,length(vec2(gx,gy))*lines/60.);
      float ea=abs(texture(t0,uv+vec2(e.x,0.)).a-texture(t0,uv-vec2(e.x,0.)).a)+abs(texture(t0,uv+vec2(0.,e.y)).a-texture(t0,uv-vec2(0.,e.y)).a); g=max(g,smoothstep(.2,.6,ea)*step(.01,lines));
      o=pre(mix(c2,inkC,g),s.a); }`;
  S.sketch = H2 + `uniform float mode,stroke,detail,hatch,amount; uniform vec3 paper;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float L=luma(c); vec2 U=px/res; vec2 P=gl_FragCoord.xy/px;
      float b1=0.,b2=0.; for(int i=0;i<12;i++){ float a=float(i)*.5236+.26; vec2 d=vec2(cos(a),sin(a)); b1+=luma(unp(texture(t0,uv+d*stroke*U))); b2+=luma(unp(texture(t0,uv+d*stroke*3.*U))); } b1/=12.; b2/=12.;
      float edge=smoothstep(.005,.07*(1.15-detail/100.),b2-L*.6-b1*.4); if(mode>.5&&mode<1.5) edge=step(.5,edge);
      vec2 jp=P+vec2(vn(P*.05),vn(P*.05+9.))*4.; float tone=1.-L; float h=0.;
      float h1=1.-smoothstep(.15,.45,abs(fract((jp.x+jp.y)/7.)-.5)*2.), h2=1.-smoothstep(.15,.45,abs(fract((jp.x-jp.y)/7.)-.5)*2.), h3=1.-smoothstep(.15,.4,abs(fract(jp.y/5.)-.5)*2.);
      h=h1*smoothstep(.35,.5,tone)+h2*smoothstep(.55,.7,tone)+h3*smoothstep(.75,.9,tone); h*=hatch/100.*(.6+.4*vn(P*.3));
      float pap=.94+.06*fbm(P*.15); float ink=clamp(edge*.95+h*.55,0.,1.); vec3 r;
      if(mode<1.5) r=paper*pap*(1.-ink*.88); else { vec3 cc=c/max(maxc(c),.05); r=paper*pap*(1.-ink*.75)*mix(vec3(1.),cc,clamp(ink*1.4+tone*.25,0.,1.)); }
      o=pre(mix(c,r,amount/100.),s.a); }`;
  S.shp_comb = `uniform sampler2D t1,t2; uniform float amount,thr,clarity,protect;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float L=luma(c); float Ls=luma(unp(texture(t1,uv))), Ll=luma(unp(texture(t2,uv)));
      float d=L-Ls; float th=thr/255.; d=sign(d)*max(abs(d)-th,0.); float hp=1.-protect/100.*smoothstep(.6,1.,L);
      float nl=L+d*amount/100.*2.*hp+(L-Ll)*clarity/100.*1.2*4.*L*(1.-L); o=pre(c+(nl-L),s.a); }`;
  S.denoise = H2 + `uniform float strength,radius,chroma,detail;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec3 y0=rgb2yiq(c); float sr=mix(.01,.13,strength/100.); float Rr=radius*px; float acc=0.,wl=0.; vec2 ac=vec2(0.); float wc=0.;
      for(int j=-3;j<=3;j++) for(int i=-3;i<=3;i++){ vec2 of=vec2(i,j)*Rr/3.; vec3 sy=rgb2yiq(unp(texture(t0,uv+of/res))); float ds=float(i*i+j*j)/9.; float dr=sy.x-y0.x;
        float w=exp(-ds*2.)*exp(-dr*dr/(2.*sr*sr)); acc+=sy.x*w; wl+=w; float w2=exp(-ds)*exp(-dr*dr/(8.*sr*sr)); ac+=sy.yz*w2; wc+=w2; }
      float Y=mix(acc/wl,y0.x,detail/100.*.6); vec2 IQ=mix(y0.yz,ac/wc,chroma/100.); o=pre(yiq2rgb(vec3(Y,IQ)),s.a); }`;
  /* ---- camera ---- */
  S.handheld = H2 + `uniform float mode,amount,speed,rot,zoom,mblur,seed;
    const float SW[5]=float[5](10.,14.,22.,6.,1.5), MD[5]=float[5](4.,6.,12.,3.,.8), JT[5]=float[5](.8,1.2,3.,4.,.3), JF[5]=float[5](6.,6.5,7.,14.,5.), BO[5]=float[5](0.,8.,18.,5.,0.), BF[5]=float[5](0.,1.9,2.8,.0,0.), RO[5]=float[5](.5,1.2,2.4,.7,.1);
    vec3 cam(float t){ int m=int(mode+.5); float T=t*speed/100.;
      float x=n1(T*.23,seed)*SW[m]+n1(T*1.1,seed+1.)*MD[m]+n1(T*JF[m],seed+2.)*JT[m]; float y=n1(T*.19,seed+3.)*SW[m]*.8+n1(T*1.3,seed+4.)*MD[m]+n1(T*JF[m]*1.1,seed+5.)*JT[m];
      if(BF[m]>0.){ float ph=T*BF[m]*3.14159; y+=(abs(sin(ph))-.63)*BO[m]; x+=sin(ph*.5)*BO[m]*.35; } if(m==3){ y+=pow(max(n1(T*2.3,seed+8.),0.),4.)*14.; }
      float r=(n1(T*.31,seed+6.)*.7+n1(T*1.7,seed+7.)*.3)*RO[m]; float k=amount/100.; return vec3(x*k,y*k,r*rot/100.*k); }
    vec2 xf(vec2 q,vec3 cm){ vec2 asp=vec2(res.x/res.y,1.); vec2 p=(q-.5)*asp; p=rot2(p,radians(cm.z)); p/=1.+zoom/100.; p=p/asp+.5; p-=vec2(cm.x,-cm.y)*px/res; return 1.-abs(1.-abs(p)); }
    void main(){ vec4 acc=vec4(0.); float sh=mblur/100./48.; float j=h12(gl_FragCoord.xy);
      for(int i=0;i<10;i++){ float t=time-sh*(float(i)+j)/10.; acc+=texture(t0,xf(uv,cam(t))); } o=acc/10.; }`;
  S.letterbox = `uniform float ratio,reveal,offset,soft,op; uniform vec3 color;
    void main(){ float Rt=ratio<.5?2.39:ratio<1.5?2.35:ratio<2.5?2.:ratio<3.5?1.85:ratio<4.5?1.66:ratio<5.5?1.3333:1.; float ar=res.x/res.y; float rv=reveal/100.;
      vec4 s=texture(t0,uv+vec2(0.,offset/100.*.2)); float m; float sf=max(soft*px/res.y,.5/res.y);
      if(Rt<=ar+.001&&ratio<4.5){ float b=(1.-ar/Rt)*.5*rv; m=smoothstep(b-sf,b+sf,uv.y)*smoothstep(b-sf,b+sf,1.-uv.y); }
      else { float b=(1.-Rt/ar)*.5*rv; float sx=sf*res.y/res.x; m=smoothstep(b-sx,b+sx,uv.x)*smoothstep(b-sx,b+sx,1.-uv.x); }
      float k=op/100.; vec4 bar=vec4(color,1.)*k+s*(1.-k); o=s*m+bar*(1.-m); }`;
  S.hud = H2 + `uniform vec3 color; uniform float op,style,scan,grid,thick;
    float ln(float d,float w){ return 1.-smoothstep(w*.5,w*.5+1.,d); }
    void main(){ vec4 s=texture(t0,uv); vec2 P=uv*res; vec2 Cc=res*.5; float W=thick*px; float m=0.; float u=res.y/100.;
      vec2 d=abs(P-Cc); vec2 bx=res*vec2(.42,.40); vec2 e=abs(d-bx); float br=12.*u;
      m=max(m,ln(e.x,W)*step(d.y,bx.y)*step(bx.y-br,d.y)); m=max(m,ln(e.y,W)*step(d.x,bx.x)*step(bx.x-br,d.x));
      if(style<.5){ m=max(m,ln(d.x,W)*step(d.y,2.5*u)*step(.8*u,d.y)); m=max(m,ln(d.y,W)*step(d.x,2.5*u)*step(.8*u,d.x)); float rec=length(P-vec2(res.x*.13,res.y*.86)); m=max(m,step(rec,1.4*u)*step(.5,fract(time)));
        for(int i=0;i<5;i++){ float bxx=res.x*.80+float(i)*2.2*u; m=max(m,step(abs(P.x-bxx),.7*u)*step(abs(P.y-res.y*.86),1.*u)*step(float(i),3.)); } }
      else if(style<1.5){ float r=length(P-Cc); m=max(m,ln(abs(r-9.*u),W)); m=max(m,ln(abs(r-1.2*u),W)); m=max(m,ln(d.x,W)*step(d.y,15.*u)*step(11.*u,d.y)); m=max(m,ln(d.y,W)*step(d.x,15.*u)*step(11.*u,d.x));
        float tk=mod(P.x-Cc.x,2.*u); m=max(m,ln(tk,W)*step(abs(P.y-res.y*.12),.8*u)*step(d.x,30.*u)); }
      else { m=max(m,ln(d.x,W)*step(d.y,4.*u)); m=max(m,ln(d.y,W)*step(d.x,4.*u)); float hz=P.y-Cc.y-(P.x-Cc.x)*.08; m=max(m,ln(abs(hz),W)*step(10.*u,d.x)*step(d.x,25.*u));
        for(int i=-4;i<=4;i++){ float yy=Cc.y+float(i)*6.*u; m=max(m,ln(abs(P.y-yy),W)*step(abs(P.x-res.x*.2),(i==0?2.5:1.2)*u)); m=max(m,ln(abs(P.y-yy),W)*step(abs(P.x-res.x*.8),(i==0?2.5:1.2)*u)); } }
      float gd=grid/100.*.35*max(ln(mod(P.x,res.x/12.),W*.5),ln(mod(P.y,res.y/8.),W*.5));
      float sl=scan/100.*.25*exp(-pow((fract(uv.y-time*.15)-.5)*30.,2.)); float k=clamp(m+gd,0.,1.)*op/100.;
      o=vec4(min(s.rgb*(1.-k)+color*k+vec3(sl)*s.a,vec3(1.)),max(s.a,k)); }`;
  /* ---- vision ---- */
  S.nvg = H2 + `uniform float gain,noiz,bloom,tube,phos,scint,vig;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float G=gain/100.; float L=luma(c)*G; vec2 U=px/res;
      float b=0.; for(int i=0;i<8;i++){ float a=float(i)*.785+.3; vec2 d=vec2(cos(a),sin(a)); b+=max(luma(unp(texture(t0,uv+d*6.*U)))*G-.85,0.)+max(luma(unp(texture(t0,uv+d*18.*U)))*G-.85,0.)*.6; } L+=b/8.*bloom/100.*1.6;
      float fr=floor(time*30.); float nz=(h12(gl_FragCoord.xy/max(px*1.2,1.)+fr*vec2(13.1,7.7))+h12(gl_FragCoord.xy/max(px*1.2,1.)+fr*vec2(3.3,17.9))-1.); L+=nz*noiz/100.*(.25+.5*(1.-smoothstep(0.,.5,L)))*.6;
      L+=step(1.-scint/100.*.004,h12(floor(gl_FragCoord.xy/(1.5*px))+fr*1.37))*.9; L=max(L,0.); L=L/(1.+L*.35)*1.25;
      vec3 cl=phos<.5? vec3(.16,1.,.3)*L+vec3(.0,.035,.01) : vec3(.86,.95,1.)*L+.025;
      vec2 asp=vec2(res.x/res.y,1.); vec2 p=(uv-.5)*asp; float m=1.;
      if(tube>.5&&tube<1.5) m=1.-smoothstep(.45,.475,length(p)); else if(tube>1.5) m=max(1.-smoothstep(.40,.425,length(p-vec2(-.27,0.))),1.-smoothstep(.40,.425,length(p-vec2(.27,0.))));
      cl*=(1.-vig/100.*smoothstep(.1,.7,length(p)))*m; o=vec4(clamp(cl,0.,1.),1.); }`;
  S.thermalcam = H2 + `uniform float pal,lo,hi,warm,resol,noiz,edge,hud;
    vec3 palette(float t){ if(pal<.5) return vec3(t); if(pal<1.5) return vec3(1.-t); if(pal<2.5){ return clamp(vec3(1.5*t*1.2-.05+.0, pow(t,1.6)*1.1-.05+smoothstep(.85,1.,t)*.3, .45*sin(t*3.6)+smoothstep(.85,1.,t)*.9),0.,1.); }
      if(pal<3.5) return hue2rgb(.7-t*.72)*smoothstep(0.,.08,t)+vec3(smoothstep(.93,1.,t)); return mix(mix(vec3(.02,.05,.2),vec3(.1,.6,.9),smoothstep(0.,.5,t)),vec3(1.,.95,.85),smoothstep(.5,1.,t)); }
    float heat(vec2 q){ vec3 c=unp(texture(t0,q)); return luma(c)+warm/100.*(c.r-c.b)*.6; }
    void main(){ vec2 g=vec2(resol,resol*res.y/res.x); vec2 f=uv*g-.5; vec2 i=floor(f); vec2 w=fract(f); w=w*w*(3.-2.*w);
      float h00=heat((i+.5)/g),h10=heat((i+vec2(1.5,.5))/g),h01=heat((i+vec2(.5,1.5))/g),h11=heat((i+1.5)/g); float h=mix(mix(h00,h10,w.x),mix(h01,h11,w.x),w.y);
      float hb=(h00+h10+h01+h11)*.25; h+=(h-hb)*edge/100.*3.; float fr=floor(time*25.); h+=(h12(floor(uv*g)+fr*vec2(7.1,3.3))-.5)*noiz/100.*.08+(h12(vec2(floor(uv.x*g.x),5.))-.5)*noiz/100.*.03;
      float t=clamp((h-lo/100.)/max(hi/100.-lo/100.,.01),0.,1.); vec3 c=palette(t);
      if(hud>.5){ vec2 P=uv*res; vec2 d=abs(P-res*.5); float u=res.y/100.; float m=max(step(d.x,.15*u)*step(d.y,4.*u)*step(1.2*u,d.y),step(d.y,.15*u)*step(d.x,4.*u)*step(1.2*u,d.x)); c=mix(c,vec3(1.),m); }
      float a0=texture(t0,uv).a; o=vec4(c*a0,a0); }`;
  /* ---- layers / text ---- */
  S.longshadow = H2 + `uniform float angle,len,op,fade; uniform vec3 color;
    void main(){ vec4 s=texture(t0,uv); vec2 d=vec2(cos(radians(angle)),-sin(radians(angle)))*px/res; float a=0.; float j=h12(gl_FragCoord.xy);
      for(int i=0;i<128;i++){ float t=(float(i)+j)/128.; float sa=texture(t0,uv-d*t*len).a; a=max(a,sa*(1.-fade/100.*t)); }
      a*=op/100.; o=s+vec4(color*a,a)*(1.-s.a); }`;
  S.stk_dil = `uniform float rad,inv; void main(){ float a0=texture(t0,uv).a; if(inv>.5) a0=1.-a0; float m=a0;
      for(int k=1;k<=6;k++){ float r=rad*float(k)/6.; int nn=6*k; for(int i=0;i<36;i++){ if(i>=nn) break; float th=6.2832*(float(i)+.5*float(k))/float(nn); float sa=texture(t0,uv+vec2(cos(th),sin(th))*r/res).a; if(inv>.5) sa=1.-sa; m=max(m,sa*clamp(rad-r+1.,0.,1.)); } } o=vec4(m); }`;
  S.stk_comp = `uniform sampler2D t1; uniform vec3 color; uniform float pos,op,only; uniform float useInv;
    void main(){ vec4 s=texture(t0,uv); float D=texture(t1,uv).a; float k;
      if(pos<.5){ k=D*op/100.; vec4 st=vec4(color*k,k); o=only>.5? st*(1.-s.a) : s+st*(1.-s.a); return; }
      float E=1.-D; k=clamp(s.a-E,0.,1.)*op/100.; if(only>.5){ o=vec4(color*k,k); return; } o=vec4(color*k,k)+s*(1.-k); }`;
  S.stk_ring = `uniform sampler2D t1,t2; uniform vec3 color; uniform float op,only; void main(){ vec4 s=texture(t0,uv); float D=texture(t1,uv).a, E=1.-texture(t2,uv).a; float k=clamp(D-E,0.,1.)*op/100.; o=only>.5? vec4(color*k,k) : vec4(color*k,k)+s*(1.-k); }`;
  S.neon_comp = H2 + `uniform sampler2D t1; uniform vec3 color; uniform float gain,core,flicker,seed;
    void main(){ vec4 s=texture(t0,uv); float fr=floor(time*14.); float fl=1.-flicker/100.*(step(.82,h12(vec2(fr,seed)))*.75+.12*(n1(time*25.,seed)*.5+.5));
      vec2 g2=.5/vec2(textureSize(t1,0)); vec3 g=(texture(t1,uv+g2).rgb+texture(t1,uv-g2).rgb+texture(t1,uv+vec2(g2.x,-g2.y)).rgb+texture(t1,uv+vec2(-g2.x,g2.y)).rgb)*.25*gain*fl;
      vec3 tube=mix(color*1.1,vec3(1.),core/100.*.9)*s.a*mix(.35,1.,fl); vec3 c=tube+g*(1.-s.a*.5); o=vec4(c,max(s.a,clamp(maxc(g),0.,1.))); }`;
  S.luster = H2 + `uniform vec3 c1,c2; uniform float bevel,shine,speed,angle;
    void main(){ vec4 s=texture(t0,uv); if(s.a<.002){ o=s; return; } vec2 U=1.5*px/res; float ax=texture(t0,uv+vec2(U.x,0.)).a-texture(t0,uv-vec2(U.x,0.)).a, ay=texture(t0,uv+vec2(0.,U.y)).a-texture(t0,uv-vec2(0.,U.y)).a;
      vec3 nrm=normalize(vec3(-ax*bevel/25.,-ay*bevel/25.,1.)); vec3 L=normalize(vec3(cos(radians(angle)),sin(radians(angle)),.8)); float df=clamp(dot(nrm,L),0.,1.); float sp=pow(clamp(dot(reflect(-L,nrm),vec3(0.,0.,1.)),0.,1.),16.);
      float g=uv.y*.6+.2; vec3 base=mix(c1,c2,clamp(g+(df-.6)*.8,0.,1.)); float x=uv.x+uv.y*.4; float sw=fract(time*speed*.25)*2.2-.6; float band=exp(-pow((x-sw)*9.,2.))*shine/100.;
      vec3 c=base+vec3(sp)*.6+vec3(band)*1.2; o=vec4(clamp(c,0.,1.)*s.a,s.a); }`;
  /* ---- generators ---- */
  S.spectral = H2 + `uniform float mode,scale,speed,sat,bright,hue,blendm,amount;
    void main(){ vec2 asp=vec2(res.x/res.y,1.); vec2 p=(uv-.5)*asp*100./scale; float t=time*speed*.1; float h;
      if(mode<.5) h=fbm(p*1.2+vec2(t,-t*.7))*1.6+p.x*.15+t; else if(mode<1.5) h=length(p)*.5-t+atan(p.y,p.x)/6.2832; else h=p.x*.3+p.y*.1+t;
      vec3 g=hue2rgb(fract(h+hue/360.)); g=mix(vec3(1.),g,sat/100.)*bright/100.;
      vec4 s=texture(t0,uv); vec3 c=unp(s); vec3 r=blendm<.5?g:blendm<1.5?1.-(1.-c)*(1.-g):blendm<2.5?mix(2.*c*g,1.-2.*(1.-c)*(1.-g),step(.5,c)):g*luma(c)/max(luma(g),.05);
      float k=amount/100.; o=pre(mix(c,r,k),blendm<.5?max(s.a,k):s.a); }`;
  S.texturize = `uniform float kind,amount,scale,blendm,seed; uniform vec3 tint;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec2 P=gl_FragCoord.xy/(px*scale/100.)+seed*37.; float v;
      if(kind<.5){ v=.55+.25*(fbm(P/180.)-.5)+.12*(vn(P/3.)-.5)+.1*(fbm(P/25.)-.5); float stain=smoothstep(.62,.7,fbm(P/260.+3.)); v-=stain*.18; v-=pow(length(uv-.5)*1.2,3.)*.25; }
      else if(kind<1.5){ v=.5+.35*(fbm(P/90.)-.5)+.2*(vn(P/2.)-.5); v-=step(.985,h12(floor(P/2.)))*.4; float scr=1.-smoothstep(.0,.04,abs(fract(P.x/400.+fbm(P/200.)*.6)-.5)); v-=scr*.15*step(.5,vn(P/80.)); }
      else if(kind<2.5){ vec2 w=fract(P/4.); float wv=sin(w.x*6.2832)*sin(w.y*6.2832); v=.5+.12*wv*sign(sin(floor(P.x/4.)+floor(P.y/4.)))+.1*(fbm(P/60.)-.5)+.06*(vn(P)-.5); }
      else { v=.5+.25*(fbm(P/40.)-.5)+.18*(vn(P/1.5)-.5); v-=step(.97,h12(floor(P/3.)))*.25*vn(P/30.); }
      float tv=clamp(.5+(v-.5)*2.6,0.,1.); vec3 t=clamp(mix(vec3(tv),tv*tint/max(luma(tint),.05),.6),0.,1.); vec3 r;
      if(blendm<.5) r=mix(2.*c*t,1.-2.*(1.-c)*(1.-t),step(.5,c)); else if(blendm<1.5) r=c*t*1.7; else r=mix(2.*c*t+c*c*(1.-2.*t),sqrt(c)*(2.*t-1.)+2.*c*(1.-t),step(.5,t));
      o=pre(mix(c,r,amount/100.),s.a); }`;
  S.turbnoise = H2 + `uniform float scale,detail,warp,contrast,speed,evol; uniform vec3 c1,c2; uniform float blendm,amount;
    float tb(vec2 p){ float s=0.,a=.5; for(int i=0;i<8;i++){ if(float(i)>=detail) break; s+=abs(vn(p)*2.-1.)*a; p=rot2(p,.6)*2.02+vec2(3.1,1.7); a*=.5; } return s; }
    void main(){ vec2 p=uv*res/(scale*px)*vec2(1.,1.); float t=time*speed*.15+evol/360.; vec2 w=vec2(tb(p+t),tb(p+vec2(5.2,1.3)-t))*warp/100.*2.; float v=tb(p+w+t*.5);
      v=clamp((v-.4)*contrast/100.+.5,0.,1.); vec3 g=mix(c1,c2,v); vec4 s=texture(t0,uv); vec3 c=unp(s);
      vec3 r=blendm<.5?g:blendm<1.5?1.-(1.-c)*(1.-g):blendm<2.5?mix(2.*c*g,1.-2.*(1.-c)*(1.-g),step(.5,c)):c*g; float k=amount/100.; o=pre(mix(c,r,k),blendm<.5?max(s.a,k):s.a); }`;
  S.glimmer = H2 + `uniform sampler2D t1; uniform float len,rays,angle,int_,twinkle; uniform vec3 tint;
    void main(){ vec4 s=texture(t0,uv); vec3 acc=vec3(0.); int N=int(rays); float fr=floor(time*12.);
      for(int r=0;r<8;r++){ if(r>=N) break; float a=radians(angle)+3.14159*float(r)/float(N); vec2 d=vec2(cos(a),sin(a))*len*px/res;
        for(int i=1;i<=20;i++){ float t=float(i)/20.; float w=pow(1.-t,2.2); acc+=(texture(t1,uv+d*t).rgb+texture(t1,uv-d*t).rgb)*w; } }
      float tw=1.-twinkle/100.*.6*(.5+.5*n1(time*6.,3.)); vec3 g=acc/(float(N)*1.6)*int_*tint*tw; o=vec4(s.rgb+g,max(s.a,clamp(maxc(g),0.,1.))); }`;
  S.lensflare = H2 + `uniform vec2 center; uniform float kind,bright,scale,ghosts,streak,flick; uniform vec3 color;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec2 asp=vec2(res.x/res.y,1.); vec2 C=vec2(center.x,1.-center.y); vec2 d=(uv-C)*asp/(scale/100.); float r=length(d); float k=bright/100.*(1.-flick/100.*.25*(.5+.5*n1(time*13.,1.)));
      vec3 f=vec3(0.); vec3 cl=color;
      if(kind<.5){ f+=cl*exp(-r*7.)*1.1+vec3(1.)*exp(-r*45.)*1.6; float ang=atan(d.y,d.x); f+=cl*pow(abs(sin(ang*6.+.3)),40.)*exp(-r*4.)*.5+vec3(1.)*pow(abs(cos(ang*9.)),80.)*exp(-r*3.)*.3; f+=hue2rgb(fract(r*1.4))*smoothstep(.05,.0,abs(r-.42))*.15; }
      else if(kind<1.5){ f+=vec3(.5,.7,1.)*exp(-abs(d.y)*140.)*exp(-abs(d.x)*.8)*1.4*streak/60.+vec3(.6,.8,1.)*exp(-abs(d.y)*25.)*exp(-abs(d.x)*2.5)*.3+vec3(1.)*exp(-r*35.)*1.6+cl*exp(-r*9.)*.6; }
      else if(kind<2.5){ f+=vec3(1.)*exp(-r*18.)*1.4+cl*exp(-r*3.5)*.7; float ang=atan(d.y,d.x); f+=vec3(1.)*pow(max(cos(ang*2.),0.),30.)*exp(-r*2.)*.25; }
      else { f+=cl*exp(-r*2.5)*.9+vec3(1.,.9,.75)*exp(-r*20.)*.9; }
      if(kind<.5||kind>2.5) f+=cl*exp(-abs(d.y)*90.)*exp(-abs(d.x)*2.)*streak/100.*.8;
      vec2 axis=(vec2(.5)-C)*asp; for(int i=1;i<7;i++){ float fi=float(i); float pos=-.4+fi*.38; vec2 gp=C*asp+axis*pos*2.; float gr=length(uv*asp-gp); float sz=(.025+.05*h12(vec2(fi,2.)))*scale/100.;
        vec3 gc=hue2rgb(fract(fi*.17+.55))*.6+cl*.4; f+=gc*(smoothstep(sz,sz*.6,gr)*.10+smoothstep(sz*.15,0.,abs(gr-sz))*.08)*ghosts/100.; }
      c=1.-(1.-c)*(1.-clamp(f*k,0.,1.)); o=pre(c,max(s.a,clamp(luma(f*k),0.,1.))); }`;
  S.leak2 = `uniform float amount,side,size,speed,evol,burn,seed; uniform vec3 c1,c2,c3;
    void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec2 asp=vec2(res.x/res.y,1.); vec2 p=uv*asp; float t=time*speed*.15+evol/360.+seed*1.7; vec2 o_;
      if(side<.5) o_=vec2(-.12,.55+.3*sin(t*1.3)); else if(side<1.5) o_=vec2(asp.x+.12,.5+.3*sin(t*1.1)); else if(side<2.5) o_=vec2(asp.x*(.5+.35*sin(t)),1.12); else if(side<3.5) o_=vec2(-.08,1.08); else o_=vec2(asp.x*.5+.2*sin(t),.5+.15*cos(t*1.3));
      vec2 d=p-o_; float r=length(d); float wob=fbm(d*2.2+vec2(t*.8,-t*.6))*.9+fbm(d*5.+t)*.25; float R=size/100.*1.4; float k=max(r/R+(wob-.55)*.9,0.); float m=exp(-k*k*2.5)*(.85+.15*n1(time*1.5,seed));
      vec3 lc=mix(c3,c2,smoothstep(.05,.45,m)); lc=mix(lc,c1,smoothstep(.45,.85,m)); lc=mix(lc,vec3(1.,.98,.92),smoothstep(.8,1.,m)*burn/100.);
      vec3 L=lc*m*amount/100.*1.4; c=1.-(1.-c)*(1.-clamp(L,0.,1.)); o=pre(c,max(s.a,clamp(maxc(L),0.,1.))); }`;
  S.pz_comp = `uniform sampler2D t1; uniform vec2 center; uniform float len,int_; uniform vec3 tint;
    void main(){ vec4 s=texture(t0,uv); vec2 C=vec2(center.x,1.-center.y); vec3 acc=vec3(0.); for(int i=0;i<40;i++){ float f=float(i)/40.*len/100.; acc+=texture(t1,C+(uv-C)*(1.-f)).rgb*(1.-float(i)/40.); }
      vec3 g=acc/20.*int_*tint; o=vec4(s.rgb+g,max(s.a,clamp(maxc(g),0.,1.))); }`;
  S.hal_bp = `uniform float thr; void main(){ vec4 s=texture(t0,uv); float l=maxc(s.rgb); float k=smoothstep(thr,thr+.25,l); o=vec4(s.rgb*k,1.); }`;
  S.hal_comp = `uniform sampler2D t1; uniform vec3 color; uniform float amount,bloom; void main(){ vec4 s=texture(t0,uv); vec3 b=texture(t1,uv).rgb; vec3 c=s.rgb; float l=luma(b);
      c+=color*l*amount/100.*1.4*(1.-c*.5)+b*bloom/100.*.8; o=vec4(c,s.a); }`;
  /* ---- transitions (t0 = A outgoing, t1 = B incoming) ---- */
  S.tr2 = H2 + `uniform sampler2D t1; uniform float p; uniform int kind;
    vec4 A(vec2 u){ return (u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.,0.,0.,1.):texture(t0,u); } vec4 Bt(vec2 u){ return (u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.,0.,0.,1.):texture(t1,u); }
    vec4 AB(vec2 u,float m){ return mix(A(u),Bt(u),m); }
    float ease(float x){ return x<.5?4.*x*x*x:1.-pow(-2.*x+2.,3.)/2.; }
    float star(vec2 p,float r){ float a=atan(p.y,p.x); float k=cos(3.14159/5.)/cos(mod(a+1.5708,1.2566)-.6283); return length(p)-r*mix(.5,1.,smoothstep(.7,1.,k)); }
    void main(){ vec2 u=uv; float e=ease(p); float k=sin(p*3.14159); float j=h12(gl_FragCoord.xy);
      if(kind==0){ float fr=floor(p*48.); float y=1.-u.y; float sp=k*k; float yy=fract(y+p*p*4.*sp+sp*.2); float ln=floor(yy*240.); float off=(h12(vec2(ln,fr))-.5)*.05*sp+n1(yy*7.+p*40.,3.)*.04*sp;
        float band=exp(-pow((fract(yy-p*6.)-.5)*9.,2.))*sp; off+=band*(h12(vec2(ln,fr+1.))-.5)*.35; vec2 q=vec2(u.x+off,1.-yy);
        vec4 c=AB(q,step(.5,p)); float sh=.012*sp; c.r=AB(q+vec2(sh,0.),step(.5,p)).r; c.b=AB(q-vec2(sh,0.),step(.5,p)).b;
        float sn=h12(vec2(floor(u.x*res.x/2.),ln)+fr); c.rgb=mix(c.rgb,vec3(step(.5,sn)),band*.7); c.rgb=mix(c.rgb,vec3(luma(c.rgb)),sp*.35); c.rgb+=step(.995-sp*.02,h12(vec2(ln,fr+9.)))*.7; o=vec4(min(c.rgb,1.),1.); return; }
      if(kind==1){ float q=p<.5?p*2.:(1.-p)*2.; vec2 c=u-.5; float sy=max(1.-smoothstep(0.,.55,q),.006), sx=max(1.-smoothstep(.55,.95,q),.004); vec2 su=c/vec2(sx,sy)+.5;
        float inside=step(abs(c.y),sy*.5)*step(abs(c.x),sx*.5); vec3 col=(p<.5?A(su):Bt(su)).rgb*inside; float br=smoothstep(.25,.9,q); col=mix(col,vec3(1.),br*inside*.85);
        float g=exp(-pow(c.y/(sy*.5+.004),2.)*.6)*exp(-pow(max(abs(c.x)-sx*.5,0.)/(.02+sx*.1),2.))*smoothstep(.45,1.,q); col+=vec3(.85,.9,1.)*g*.8*(1.-smoothstep(.97,1.,q)); o=vec4(min(col,1.),1.); return; }
      if(kind==2){ float fr=floor(p*24.); float cs=1.+floor(h12(vec2(fr,1.))*3.); vec2 bi=floor(u*vec2(16.,9.)*cs); float on=step(h12(bi+fr),k*.55); vec2 q=u; q.x+=on*(h12(bi+fr+3.)-.5)*.25*k;
        float sl=floor(u.y*30.); q.x+=step(h12(vec2(sl,fr+7.)),k*.4)*(h12(vec2(sl,fr+8.))-.5)*.18; float m=step(.5,p+(h12(bi+fr*.5+11.)-.5)*k*.7); float sp=.02*k;
        o=vec4(AB(q+vec2(sp,0.),m).r,AB(q,m).g,AB(q-vec2(sp,0.),m).b,1.); return; }
      if(kind==3){ vec2 asp=vec2(res.x/res.y,1.); float nn=fbm(u*asp*3.+vec2(1.7,4.2))*.7+(1.-length((u-vec2(.62,.45))*asp))*.6; float th=mix(1.42,-.2,p); float d=nn-th;
        float edge=exp(-pow(d*16.,2.)); float burned=smoothstep(-.015,.015,d); vec3 ca=A(u).rgb*mix(vec3(1.),vec3(1.,.55,.25),smoothstep(-.18,0.,d)); vec3 cb=mix(vec3(1.,.92,.75),Bt(u).rgb,clamp(smoothstep(0.,.4,d)*smoothstep(.25,.7,p)+smoothstep(.85,1.,p),0.,1.));
        vec3 c=mix(ca,cb,burned)+vec3(1.,.45,.12)*edge*1.3*(1.-smoothstep(.9,1.,p)); o=vec4(min(c,1.),1.); return; }
      if(kind==4){ vec2 asp=vec2(res.x/res.y,1.); float x=u.x+(fbm(u*asp*2.+p*2.)-.5)*.3+(u.y-.5)*.25; float d=x-mix(-.45,1.45,e); float gl=exp(-d*d*10.)*k*1.6;
        vec3 lc=mix(vec3(1.,.3,.08),vec3(1.,.92,.65),exp(-d*d*50.)); vec4 c=AB(u,smoothstep(.06,-.06,d)); o=vec4(1.-(1.-c.rgb)*(1.-clamp(lc*gl,0.,1.)),1.); return; }
      if(kind==5||kind==14){ vec4 acc=vec4(0.); for(int i=0;i<32;i++){ float t=(float(i)+j)/32.-.5; vec2 q=u; float sh=e; if(kind==5){ q.x+=t*.4*k; float x=q.x+sh; acc+=x<1.?A(vec2(x,q.y)):Bt(vec2(x-1.,q.y)); } else { q.y+=t*.4*k; float y=q.y-sh; acc+=y>0.?A(vec2(q.x,y)):Bt(vec2(q.x,y+1.)); } } o=acc/32.; o.a=1.; return; }
      if(kind==6){ vec2 c=u-.5; vec4 acc=vec4(0.); for(int i=0;i<24;i++){ float t=(float(i)+j)/24.; vec2 q=c/(1.+k*.6*t); if(p<.5){ float z=1.+pow(p*2.,2.)*5.; acc+=A(q/z+.5); } else { float z=1.+pow((1.-p)*2.,2.)*5.; acc+=Bt(q/z+.5); } }
        o=acc/24.; o.rgb+=vec3(exp(-pow((p-.5)*14.,2.)))*.6; o=min(o,vec4(1.)); o.a=1.; return; }
      if(kind==7){ vec2 c=u-.5; vec4 acc=vec4(0.); for(int i=0;i<16;i++){ float a=(float(i)+j)/16.*6.2832; vec2 q=u+vec2(cos(a),sin(a))*k*.02*sqrt((float(i)+.5)/16.); acc+=AB(q,smoothstep(.35,.65,p)); } acc/=16.; float ex=k*k*1.1; o=vec4(min(acc.rgb*(1.+ex)+vec3(ex*.12),1.),1.); return; }
      if(kind==8){ vec4 acc=vec4(0.); float ws=0.; float R=k*.035; for(int i=0;i<48;i++){ float fi=float(i); float rr=sqrt((fi+.5)/48.); float th=fi*2.39996+j*6.28; vec4 sm=AB(u+vec2(cos(th),sin(th))*rr*R*vec2(res.y/res.x,1.),smoothstep(.4,.6,p)); float w=1.+3.*pow(maxc(sm.rgb),4.)*k; acc+=sm*w; ws+=w; } o=acc/ws; o.a=1.; return; }
      if(kind==9){ float fr=floor(p*30.); float m=step(h12(vec2(fr,3.)),smoothstep(.12,.88,p)); vec4 c=AB(u,m); float fl=step(.8,h12(vec2(fr,5.)))*k; o=vec4(min(c.rgb+vec3(fl*.8),1.),1.); return; }
      if(kind==10){ vec2 c=u-.5; float r=length(c*vec2(res.x/res.y,1.)); float a=k*6.*(1.-smoothstep(0.,.7,r)); vec2 q=rot2(c,a)*(1.-k*.15)+.5; vec2 w=vec2(fbm(u*4.+p*3.),fbm(u*4.+7.-p*3.))-.5; q+=w*k*.08; o=AB(q,smoothstep(.35,.65,p)); o.a=1.; return; }
      if(kind==11){ vec2 asp=vec2(res.x/res.y,1.); vec2 C=vec2(mix(.15,.85,p),.35); vec2 d=(u-C)*asp; float r=length(d); vec4 c=AB(u,smoothstep(.4,.6,p)); vec3 f=vec3(1.,.8,.55)*exp(-r*5.)*1.3+vec3(1.)*exp(-r*30.)*1.5+vec3(.55,.75,1.)*exp(-abs(d.y)*120.)*exp(-abs(d.x)*1.2)*1.4;
        for(int i=1;i<5;i++){ vec2 gp=C*asp+(vec2(.5)-C)*asp*float(i)*.5; f+=hue2rgb(float(i)*.2+.5)*smoothstep(.05,.02,length(u*asp-gp))*.25; } f*=k*1.4; f+=vec3(exp(-pow((p-.5)*8.,2.)))*.8; o=vec4(1.-(1.-c.rgb)*(1.-clamp(f,0.,1.)),1.); return; }
      if(kind==12){ float ang=e*1.5708; float x=u.x; vec4 c; float w=cos(ang), w2=sin(ang); float edge=w; if(x>1.-w){ float xx=(x-(1.-w))/max(w,1e-3); float sh=1.-(1.-xx)*w2*.25; c=A(vec2(xx,(u.y-.5)/sh+.5))*(1.-e*.6); } else { float xx=x/max(1.-w,1e-3); float sh=1.-xx*w*.25; c=Bt(vec2(xx,(u.y-.5)/sh+.5))*(.4+e*.6); } o=vec4(c.rgb,1.); return; }
      if(kind==13){ vec2 asp=vec2(res.x/res.y,1.); vec2 d=(u-.5)*asp; float sel_=step(.5,h12(vec2(3.,7.))); float R=e*1.2; float sd=star(rot2(d,p*1.5),R); float m=smoothstep(.01,-.01,sd); o=AB(u,m); o.a=1.; return; }
      o=mix(A(u),Bt(u),p); }`;
  for (const k in S) if (!S[k].startsWith(H2)) S[k] = H2 + S[k];
  Object.assign(FS, S);
  const TRIDX = { vhsRewind: 0, crtOff: 1, glitchCut: 2, filmBurn: 3, leakWipe: 4, whipBlur: 5, zoomThrough: 6, expBlur: 7, bokehT: 8, flickerCut: 9, warpT: 10, flareT: 11, insideCube: 12, shapeWipe: 13, swishV: 14 };
  for (const k in TRIDX) R.trans2[k] = (a, b, p) => { const out = R.fbo(a.w, a.h); R.pass('tr2', out, [a.tex, b.tex], { p, kind: TRIDX[k] }); return out; };

  /* ================= multi-pass effects ================= */
  const idx = (type, k, v) => { const d = GW.FX[type].p.find(x => x.k === k); return Math.max(0, d.opts.findIndex(o => o[0] === v)); };
  const hex = GW.hexf;
  // multi-octave glow pyramid of `src` → half-res FBO (caller frees). o: radius (layer px), falloff, aspect, angle, pre-filter uniforms, per-octave colour
  function glowPyramid(src, o) {
    const w0 = Math.max(1, Math.ceil(src.w / 2)), h0 = Math.max(1, Math.ceil(src.h / 2));
    const L0 = R.fbo(w0, h0); R.pass('dg_pre', L0, [src.tex], o.pre);
    const asp = GW.clamp(o.aspect == null ? 1 : o.aspect, .05, 1), th = (o.angle || 0) * Math.PI / 180;
    const horiz = Math.abs(Math.cos(th)) >= Math.abs(Math.sin(th)); const res = th - (horiz ? 0 : Math.PI / 2) * Math.sign(Math.sin(th) || 1);
    const ca = Math.cos(res), sa = Math.sin(res); const d1 = [ca, sa], d2 = [-sa * asp, ca * asp];
    const want = GW.clamp(Math.ceil(Math.log2(Math.max(4, o.radius))), 2, 11);
    const L = [L0];
    for (let i = 1; i < want; i++) {
      const pv = L[i - 1]; if (pv.w <= 2 && pv.h <= 2) break;
      const fx = (a) => Math.max(1, Math.round((horiz ? w0 : h0) / Math.pow(2, i * a))), fy = (a) => Math.max(1, Math.round((horiz ? h0 : w0) / Math.pow(2, i * a)));
      const nw = horiz ? fx(1) : fy(asp), nh = horiz ? fy(asp) : fx(1);
      const f = R.fbo(nw, nh); R.pass('dg_down', f, [pv.tex], { d1, d2 }); L.push(f);
    }
    const nL = L.length, kf = ((o.falloff == null ? 50 : o.falloff) - 50) / 50; /* falloff 50 = inverse-square (equal energy per octave); lower = wider, brighter halo */ let W = []; let sum = 0;
    for (let i = 0; i < nL; i++) { const w = Math.pow(2, -kf * i) * (i === 0 ? .3 : i === 1 ? .65 : 1); W.push(w); sum += w; } // first octaves ≈ a blurred copy of the source: de-emphasised so the halo reads
    W = W.map((w, i) => { const t = nL > 1 ? i / (nL - 1) : 0; let c = [w / sum, w / sum, w / sum];
      if (o.grad) c = c.map((v, ch) => v * (o.grad[0][ch] + (o.grad[1][ch] - o.grad[0][ch]) * t));
      if (o.disp) { const s = (t * 2 - 1) * o.disp; c = [c[0] * Math.max(0, 1 + s * .6), c[1], c[2] * Math.max(0, 1 - s * .6)]; }
      if (o.spec) { const h = ((o.spec.hue / 360 + t * .8) % 1 + 1) % 1; const hc = [0, 2 / 3, 1 / 3].map(q => GW.clamp(Math.abs(((h + q) % 1) * 6 - 3) - 1, 0, 1)); const L = .2126 * hc[0] + .7152 * hc[1] + .0722 * hc[2]; c = c.map((v, ch) => v * (1 - o.spec.disp + o.spec.disp * hc[ch] / Math.max(.2, L) * .6)); }
      return c; });
    let acc = L[nL - 1], own = false;
    if (nL === 1) { const out = R.fbo(L0.w, L0.h); R.pass('dg_up', out, [L0.tex, L0.tex], { d1, d2, w: [0, 0, 0], wp: W[0] }); R.free(L0); return out; }
    for (let i = nL - 2; i >= 0; i--) { const out = R.fbo(L[i].w, L[i].h); R.pass('dg_up', out, [acc.tex, L[i].tex], { d1, d2, w: W[i], wp: own ? [1, 1, 1] : W[nL - 1] }); if (own) R.free(acc); acc = out; own = true; }
    for (const f of L) R.free(f);
    return acc;
  }
  R.multi.deepglow = (cur, p, lt, pxs) => {
    const mode = idx('deepglow', 'colorMode', p.colorMode);
    const pre = { thr: p.thr / 100, knee: p.knee / 100, tintMix: mode === 1 ? 1 : 0, tint: p.tint, useLuma: p.luma, srcMode: 0, edgeMode: 0 };
    const g = glowPyramid(cur, { pre, radius: p.radius * pxs, falloff: p.falloff, aspect: p.aspect / 100, angle: p.angle, grad: mode === 2 ? [hex(p.inner), hex(p.outer)] : null, disp: p.disp / 100 });
    let st = null;
    if (p.streak > 0) {
      const q = R.fbo(Math.max(1, Math.ceil(cur.w / 4)), Math.max(1, Math.ceil(cur.h / 4))); R.pass('dg_pre', q, [cur.tex], pre); st = q;
      const th = p.angle * Math.PI / 180, dir = [Math.cos(th), Math.sin(th)]; const passes = Math.round(2 + p.streakLen / 100 * 4);
      for (let i = 0; i < passes; i++) { const t = R.fbo(st.w, st.h); R.pass('dg_streak', t, [st.tex], { dir, stp: Math.pow(3, i) * Math.max(.5, pxs), fall: .85 }); R.free(st); st = t; }
    }
    const out = R.fbo(cur.w, cur.h);
    R.pass('dg_comp', out, [cur.tex, g.tex, (st || g).tex], { gain: Math.pow(2, p.expo) * p.int * 2.5, sAmt: st ? p.streak / 100 * 3 : 0, sCol: p.streakCol, glowOnly: p.glowOnly, unm: p.unmult, roll: p.rolloff, pres: p.preserve });
    R.free(g); if (st) R.free(st); return out;
  };
  R.multi.edgeglow = (cur, p, lt, pxs) => {
    const tint = idx('edgeglow', 'colorMode', p.colorMode) === 1;
    const g = glowPyramid(cur, { pre: { thr: p.thr / 100, knee: .5, tintMix: tint ? 1 : 0, tint: p.tint, useLuma: 0, srcMode: 0, edgeMode: 1 }, radius: p.radius * pxs, falloff: p.falloff });
    const out = R.fbo(cur.w, cur.h); R.pass('dg_comp', out, [cur.tex, g.tex, g.tex], { gain: p.int * 2.5, sAmt: 0, sCol: [1, 1, 1], glowOnly: p.glowOnly, unm: 1, roll: 1, pres: 0 }); R.free(g); return out;
  };
  R.multi.chromaglow = (cur, p, lt, pxs) => {
    const g = glowPyramid(cur, { pre: { thr: p.thr / 100, knee: .5, tintMix: 0, tint: [1, 1, 1], useLuma: 0, srcMode: 0, edgeMode: 0 }, radius: p.radius * pxs, falloff: p.falloff, spec: { disp: p.disp / 100, hue: p.hue } });
    const out = R.fbo(cur.w, cur.h); R.pass('dg_comp', out, [cur.tex, g.tex, g.tex], { gain: p.int * 3, sAmt: 0, sCol: [1, 1, 1], glowOnly: 0, unm: 1, roll: 1, pres: 0 }); R.free(g); return out;
  };
  R.multi.neon = (cur, p, lt, pxs) => {
    const g = glowPyramid(cur, { pre: { thr: 0, knee: .5, tintMix: 0, tint: p.color, useLuma: 0, srcMode: 1, edgeMode: 0 }, radius: p.radius * pxs, falloff: p.falloff });
    const out = R.fbo(cur.w, cur.h); R.pass('neon_comp', out, [cur.tex, g.tex], { color: p.color, gain: p.int * 4, core: p.core, flicker: p.flicker, seed: p.seed, time: lt }); R.free(g); return out;
  };
  R.multi.glimmer = (cur, p, lt, pxs) => {
    const q = R.fbo(Math.max(1, Math.ceil(cur.w / 2)), Math.max(1, Math.ceil(cur.h / 2))); R.pass('dg_pre', q, [cur.tex], { thr: p.thr / 100, knee: .3, tintMix: 0, tint: [1, 1, 1], useLuma: 0, srcMode: 0, edgeMode: 0 });
    const out = R.fbo(cur.w, cur.h); R.pass('glimmer', out, [cur.tex, q.tex], { len: p.len, rays: p.rays, angle: p.angle, int_: p.int, tint: p.tint, twinkle: p.twinkle, time: lt, px: pxs }); R.free(q); return out;
  };
  R.multi.pointzoom = (cur, p, lt, pxs) => {
    const q = R.fbo(Math.max(1, Math.ceil(cur.w / 2)), Math.max(1, Math.ceil(cur.h / 2))); R.pass('dg_pre', q, [cur.tex], { thr: p.thr / 100, knee: .5, tintMix: 0, tint: [1, 1, 1], useLuma: 0, srcMode: 0, edgeMode: 0 });
    const out = R.fbo(cur.w, cur.h); R.pass('pz_comp', out, [cur.tex, q.tex], { center: p.center, len: p.len, int_: p.int, tint: p.tint }); R.free(q); return out;
  };
  R.multi.halation = (cur, p, lt, pxs) => {
    const bp = R.fbo(cur.w, cur.h); R.pass('hal_bp', bp, [cur.tex], { thr: p.thr / 100 });
    const bl = R.blurTex(bp, Math.max(.5, p.radius * pxs * .5), 'both', 1); if (bl !== bp) R.free(bp);
    const out = R.fbo(cur.w, cur.h); R.pass('hal_comp', out, [cur.tex, bl.tex], { color: p.color, amount: p.amount, bloom: p.bloom }); R.free(bl); return out;
  };
  R.multi.sharpen2 = (cur, p, lt, pxs) => {
    const s = R.blurTex(cur, Math.max(.35, p.radius * pxs), 'both', 1), l = R.blurTex(cur, Math.max(.5, p.cradius * pxs * .5), 'both', 1);
    const out = R.fbo(cur.w, cur.h); R.pass('shp_comb', out, [cur.tex, s.tex, l.tex], { amount: p.amount, thr: p.thr, clarity: p.clarity, protect: p.protect });
    if (s !== cur) R.free(s); if (l !== cur) R.free(l); return out;
  };
  R.multi.tiltshift = (cur, p, lt, pxs) => {
    const out = R.fbo(cur.w, cur.h);
    R.pass('bokeh', out, [cur.tex], { radius: p.radius, depth: 0, focus: 0, range: 20, shape: 0, boost: p.boost, thr: 70, sat: p.sat, bandOn: 1, bw: p.width / 100, btr: p.trans / 100, bang: p.angle, bc: p.center, px: pxs, time: lt });
    return out;
  };
  R.multi.stroke = (cur, p, lt, pxs) => {
    const W = p.width * pxs, pos = idx('stroke', 'pos', p.pos); if (W < .1) { const o = R.fbo(cur.w, cur.h); R.pass('copy', o, [cur.tex]); return o; }
    const dil = (rad, inv) => { const a = R.fbo(cur.w, cur.h); R.pass('stk_dil', a, [cur.tex], { rad: rad / 2, inv }); const b = R.fbo(cur.w, cur.h); R.pass('stk_dil', b, [a.tex], { rad: rad / 2, inv: 0 }); R.free(a);
      if (p.soft > 0) { const c = R.blurTex(b, p.soft * pxs * .5, 'both', 1); if (c !== b) { R.free(b); return c; } } return b; };
    const out = R.fbo(cur.w, cur.h);
    if (pos === 0) { const D = dil(W, 0); R.pass('stk_comp', out, [cur.tex, D.tex], { color: p.color, pos: 0, op: p.op, only: p.only }); R.free(D); }
    else if (pos === 2) { const E = dil(W, 1); R.pass('stk_comp', out, [cur.tex, E.tex], { color: p.color, pos: 2, op: p.op, only: p.only }); R.free(E); }
    else { const D = dil(W / 2, 0), E = dil(W / 2, 1); R.pass('stk_ring', out, [cur.tex, D.tex, E.tex], { color: p.color, op: p.op, only: p.only }); R.free(D); R.free(E); }
    return out;
  };
  R.multi.crt = (cur, p, lt, pxs, fx) => {
    const bl = p.bloom > 0 ? R.blurTex(cur, Math.max(.5, p.bloomR * pxs), 'both', 1) : cur;
    const u = { ...p, time: lt, px: pxs, mask: idx('crt', 'mask', p.mask), phos: idx('crt', 'phos', p.phos) };
    const out = R.fbo(cur.w, cur.h); R.pass('crt', out, [cur.tex, bl.tex], u); if (bl !== cur) R.free(bl); return out;
  };
  /* ---- VHS OSD: blocky 5×7 VCR font drawn on a canvas, uploaded only when the text changes ---- */
  const GLY = { '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14], '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
    A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], J: [7, 2, 2, 2, 2, 18, 12], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], Y: [17, 17, 17, 10, 4, 4, 4],
    ':': [0, 12, 12, 0, 12, 12, 0], '.': [0, 0, 0, 0, 0, 12, 12], '>': [16, 24, 28, 30, 28, 24, 16], '*': [14, 31, 31, 31, 31, 31, 14], '-': [0, 0, 0, 31, 0, 0, 0] };
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const osdCache = new Map();
  function osdTex(fxId, p, lt, w, h) {
    const mode = idx('vhsreal', 'osd', p.osd); if (!mode && !p.osdDate) return null;
    const tot = Math.floor(p.hour * 3600 + p.minute * 60 + Math.max(0, lt)); const dayAdd = Math.floor(tot / 86400); const sec = tot % 86400;
    const hh = Math.floor(sec / 3600), mm = Math.floor(sec / 60) % 60, ss = sec % 60; const h12 = hh % 12 || 12;
    const dt = new Date(Date.UTC(Math.round(p.year), Math.round(p.month) - 1, Math.round(p.day) + dayAdd));
    const lines = [];
    if (mode === 1) lines.push(['tl', 'PLAY >']); if (mode === 2) lines.push(['tl', (Math.floor(lt * 2) % 2 ? '  ' : '* ') + 'REC']);
    if (mode) lines.push(['tr', 'SP']);
    if (p.osdDate) { lines.push(['bl1', (hh < 12 ? 'AM ' : 'PM ') + h12 + ':' + String(mm).padStart(2, '0') + (mode === 2 ? ':' + String(ss).padStart(2, '0') : '')]); lines.push(['bl2', MON[dt.getUTCMonth()] + '. ' + dt.getUTCDate() + ' ' + dt.getUTCFullYear()]); }
    const key = w + 'x' + h + '|' + p.crop43 + '|' + lines.map(l => l.join(':')).join('|');
    let e = osdCache.get(fxId); if (e && e.key === key) return e.tex;
    const cv = (e && e.cv) || document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
    const aw = p.crop43 && w / h > 4 / 3 ? h * 4 / 3 : w, ax = (w - aw) / 2; const u = Math.max(1, Math.round(h / 110));
    const drawStr = (s, x, y, red) => { for (let pass = 0; pass < 2; pass++) { g.fillStyle = pass ? '#f4f4f4' : 'rgba(0,0,0,.75)'; const o = pass ? 0 : Math.max(1, u * .6); let cx = x;
      for (const ch of s) { const gl = GLY[ch]; if (gl) { if (pass && ch === '*') g.fillStyle = '#ff2a2a'; for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (gl[r] >> (4 - c) & 1) g.fillRect(cx + c * u + o, y + r * u + o, u, u); if (pass) g.fillStyle = '#f4f4f4'; } cx += 6 * u; } } };
    const mx = ax + aw * .075, my = h * .08, wid = s => s.length * 6 * u;
    for (const [pos, s] of lines) { if (pos === 'tl') drawStr(s, mx, my); else if (pos === 'tr') drawStr(s, ax + aw - aw * .075 - wid(s), my); else if (pos === 'bl1') drawStr(s, mx, h - h * .08 - 7 * u * 2 - u * 3); else drawStr(s, mx, h - h * .08 - 7 * u); }
    const up = R.upload('osd:' + fxId, cv, w, h, key); osdCache.set(fxId, { key, tex: up.tex, cv }); if (osdCache.size > 32) osdCache.delete(osdCache.keys().next().value);
    return up.tex;
  }
  R.multi.vhsreal = (cur, p, lt, pxs, fx) => {
    const a = R.fbo(cur.w, cur.h); R.pass('vhs1', a, [cur.tex], { ...p, time: lt, px: pxs });
    const ot = osdTex(fx.id, p, lt, cur.w, cur.h);
    const out = R.fbo(cur.w, cur.h); R.pass('vhs2', out, [a.tex, ot || a.tex], { ...p, time: lt, px: pxs, osdOn: ot ? 1 : 0 }); R.free(a); return out;
  };
  // single-pass effects whose shader name differs from the type
  const ALIAS = { filmgrain: 'fgrain', filmdamage: 'fdamage', mblur: 'mblur2', glimmer: null };
  for (const t of Object.keys(DEFS)) {
    if (R.multi[t]) continue; const prog = ALIAS[t] || t;
    if (!FS[prog]) { console.warn('fx_pro: no shader for', t); continue; }
    if (prog === t) continue; // generic path in gl.js
    R.multi[t] = (cur, p, lt, pxs) => { const u = { ...p, time: lt, px: pxs }; for (const d of GW.FX[t].p) if (d.t === 'select') u[d.k] = idx(t, d.k, p[d.k]); const out = R.fbo(cur.w, cur.h); R.pass(prog, out, [cur.tex], u); return out; };
  }
  // shaders compiled by R.init are only those present at that moment; make sure ours compile up front when GL already exists
  GW.FXPro = { DEFS, TR, H2, S, idx, glowPyramid };
  /* offline thumbnails for the effects browser: the Program frame at the playhead (or a built-in test scene when the
     sequence is empty there) run through an effect list / transition → n ImageData frames (never touches the timeline) */
  GW.FXPro.thumbs = (spec, n, W) => {
    if (!R.gl) return null; const s = GW.seq(); if (!s) return null; W = W || 192; const sc = W / s.w; const frames = [];
    let base = null; try { base = GW.Render.frame(s, s.t, { scale: sc }); } catch (e) { base = null; }
    const w = base ? base.w : W, h = base ? base.h : Math.round(W * 9 / 16);
    const rd = (f) => { const b = R.readRGBA(f.w, f.h, f, null, false); return new ImageData(new Uint8ClampedArray(b.buffer, b.byteOffset, b.length), f.w, f.h); };
    let mean = 0; if (base) { const b = R.readRGBA(w, h, base, null, false); for (let i = 0; i < b.length; i += 16) mean += b[i] + b[i + 1] + b[i + 2]; mean /= b.length / 16; }
    if (!base || mean < 8) { if (base) R.free(base); const z = R.fbo(w, h); R.clear(z, 0, 0, 0, 1); base = R.fbo(w, h); R.pass('fourcol', base, [z.tex], { c1: '#1d2b53', c2: '#7e2553', c3: '#ff8a3d', c4: '#29adff', amount: 100 }); R.free(z);
      const f2 = R.fbo(w, h); R.pass('flare', f2, [base.tex], { center: [.68, .32], bright: 90, color: '#ffd28a' }); R.free(base); base = f2; }
    try {
      if (spec.group === 'tr') {
        const B0 = R.fbo(w, h); R.pass('hue', B0, [base.tex], { hue: 150, sat: 20, light: 0 }); const B = R.fbo(w, h); R.pass('flip', B, [B0.tex], { h: 1, v: 0 }); R.free(B0);
        for (let i = 0; i < n; i++) { const p = (i + .5) / n; const o = R.transition(base, B, spec.type, p); frames.push(rd(o)); R.free(o); } R.free(B);
      } else {
        const list = spec.fx || [GW.newFx(spec.type, 'v')];
        for (let i = 0; i < n; i++) { const cp = R.fbo(w, h); R.pass('copy', cp, [base.tex]); const o = R.applyEffects(cp, list, .4 + i * .2, sc); frames.push(rd(o)); R.free(o); }
      }
    } finally { R.free(base); }
    return frames;
  };
  if (R.gl) for (const k in S) try { R.prog(k); } catch (e) { console.error(e); }
})();
