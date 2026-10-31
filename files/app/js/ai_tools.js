'use strict';
/* «المونتير الذكي» — curated tool registry: the most useful GW.API methods with clear JSON schemas, turned into Anthropic
   tool definitions. Tool name = API method name (GW.API.call(name, input)). Methods that are missing in this build
   (e.g. a module not loaded) are skipped automatically. Read-only tools are marked so the planning step can only look.
   Used by app/js/ui_ai.js. Keep descriptions short and concrete — they are part of every request. */
(function () {
  const S = (type, description, extra) => Object.assign(Array.isArray(type) ? { type } : { type }, description ? { description } : {}, extra || {});
  const str = (d, extra) => S('string', d, extra), num = (d) => S('number', d), bool = (d) => S('boolean', d);
  const arr = (d, items) => S('array', d, { items: items || { type: 'string' } });
  const obj = (d) => S('object', d);
  const T = (d) => num(d || 'Seconds on the sequence timeline');
  const track = str('Track "V1", "V2"… (video) or "A1", "A2"… (audio), 1-based');
  const id = str('Clip id (from getState)'); const ids = arr('Clip ids');
  // [name, group, readOnly, description, properties, required]
  const R = [
    // ---- look / inspect ----
    ['getState', 'inspect', 1, 'Project, active sequence (w, h, fps, dur, playhead), tracks, every clip (id, kind, track, start/end, fx, text, map layers), markers, media and selection. Call first and after edits to learn ids.', { clips: bool('Include clips (default true)'), media: bool('Include media (default true)') }],
    ['captureFrame', 'inspect', 1, 'Render the frame at a time and return it as an IMAGE so you can see the result (titles, captions, maps, colour). Use it to review your work.', { time: T('Time (default playhead)'), maxWidth: num('Max width px (default 640)') }],
    ['getTranscript', 'inspect', 1, 'The transcript of the active sequence (speech-to-text): segments [{i, t0, t1, text}] in sequence seconds, plus language. Empty if not transcribed yet.', { from: num('Only segments after this time'), to: num('Only segments before this time'), words: bool('Include per-word timings') }],
    ['listEffects', 'inspect', 1, 'Video effects (with params/ranges), audio effects and look presets.', {}],
    ['listTransitions', 'inspect', 1, 'Video and audio transitions.', {}],
    ['listSfx', 'inspect', 1, 'Search the built-in sound-effects library (whoosh, impact, explosion, paper, typewriter, riser, news sting…).', { query: str('Words, Arabic or English'), cat: str('Category id'), limit: num('Max results (default 20)') }],
    ['listTitlePresets', 'inspect', 1, 'Title presets for addText (main title, breaking bar, lower third, date & place, cinematic, subtitle, number, quote).', {}],
    ['listTemplates', 'inspect', 1, 'Motion-graphics templates (lower thirds, counters, collage scenes…) with their fields.', {}],
    ['listMapStyles', 'inspect', 1, 'Map styles, map layer types and options.', {}],
    ['listCaptionPresets', 'inspect', 1, 'Animated caption style presets (ids + names) for createCaptions / restyleCaptions.', {}],
    ['listAudioPresets', 'inspect', 1, 'Essential-sound presets for setAudioFx (dialogue clean-up, music, radio…).', {}],
    ['listProvinces', 'inspect', 1, 'Provinces (admin-1) of a country with Arabic names.', { country: str('Country name') }, ['country']],
    ['listCities', 'inspect', 1, 'Cities of a country (largest first) with Arabic names.', { country: str('Country name'), limit: num('Max results') }, ['country']],
    ['listCameraKeys', 'inspect', 1, 'Camera keyframes of a map clip.', { id }, ['id']],
    ['listShapes', 'inspect', 1, 'Shapes & graphics library (arrows, frames, highlights) for addLibraryShape.', {}],
    // ---- timeline ----
    ['importMedia', 'edit', 0, 'Import files (absolute paths on this computer). Waits until ready; returns media ids.', { paths: arr('Absolute file paths') }, ['paths']],
    ['addClip', 'edit', 0, 'Place media on the timeline (video brings its linked audio) or create a generator (kind: color | adjust | rect | ellipse | bar).', { media: str('Media id / name / path'), kind: str('Generator kind when no media'), track, start: T('Start (default playhead)'), dur: num('Duration seconds'), in: num('Source in-point seconds'), mode: str('overwrite (default) | insert (ripple)'), color: str('#hex for colour clips'), name: str('Clip name') }],
    ['moveClip', 'edit', 0, 'Move a clip (and linked) to a new start and/or track. Overwrites what it lands on.', { id, start: T('New start'), track, linked: bool('Move linked clips (default true)') }, ['id']],
    ['trimClip', 'edit', 0, 'Trim a clip: new start edge, end edge or duration, and/or source in-point.', { id, start: T('New start edge'), end: T('New end edge'), dur: num('New duration'), in: num('New source in-point'), linked: bool('Linked too (default true)') }, ['id']],
    ['splitAt', 'edit', 0, 'Razor cut at a time (all tracks crossing it, or only ids).', { time: T('Cut time'), ids }],
    ['deleteClips', 'edit', 0, 'Delete clips (with linked); ripple=true closes the gap.', { ids, ripple: bool('Ripple delete'), linked: bool('Include linked (default true)') }, ['ids']],
    ['setParam', 'edit', 0, 'Set or animate any clip property. path: "motion.scale" (%), "motion.pos" ([x,y] px), "motion.rot", "opacity" (0-100), "vol" (dB), "speed", "text.str", "text.size", "text.color", "text.font", "fx.<type>.<param>", "afx.<type>.<param>", "name". With time → keyframe there (call at two times to animate). keyframes → replace the animation.', { id, path: str('Property path'), value: S(['number', 'string', 'boolean', 'array'], 'Value'), time: T('Keyframe time (timeline seconds)'), ease: str('linear | ease | easeIn | easeOut | hold'), keyframes: arr('[{time, value, ease}]', { type: 'object' }) }, ['id', 'path']],
    ['setKeyEase', 'edit', 0, 'Change the easing of keyframes of a property (ease, easeIn, easeOut, linear, hold, bezier with influence %).', { id, path: str('Property path'), index: S(['number', 'string'], 'Key index or "all"'), time: T('Key time'), ease: str('Ease'), influence: num('Influence % (bezier)') }, ['id', 'path']],
    ['addEffect', 'edit', 0, 'Add a video effect (gblur, glow, vignette, lumetri, shake, grain…), an audio effect, or a look preset (cinematic, warDoc, oldFilm, nightVision, kenburns, fadeInOut…) to clips. See listEffects.', { id, ids, type: str('Effect / look type'), params: obj('Param values') }, ['type']],
    ['addTransition', 'edit', 0, 'Add a transition at the end (or start) of a clip: dissolve, dipBlack, whip, pushL, glitchT, crossZoom… or audio cpower.', { id, side: str('end (default) | start'), type: str('Transition type'), dur: num('Seconds'), align: str('center | start | end') }, ['id']],
    ['addText', 'edit', 0, 'Add a title / text clip. preset = title preset index or name; style overrides (font, size, color, weight, align, stroke, strokeColor, shadow, bg, bgColor, bgOp…); position [x,y] px or 0..1 fractions.', { text: str('Text (\\n = new line)'), start: T('Start'), dur: num('Duration (default 5)'), preset: S(['number', 'string'], 'Title preset'), style: obj('Text style overrides'), position: arr('[x, y]', { type: 'number' }), track, animIn: str('fade | pop | up | down | left | right | zoom | blur | wipe | type | words | none'), animOut: str('Exit animation') }, ['text']],
    ['setTextAnimator', 'edit', 0, 'After-Effects-style per char/word/line text animator on a text clip (presets typewriter, fadeUpWord, blurIn, bounce, slideSide, scaleIn, fadeOutWord).', { id, preset: str('Preset'), unit: str('char | word | line'), ease: str('none | out | back | elastic'), props: obj('{opacity, scale, rot, tracking, blur, pos, fill}'), replace: bool('Replace existing'), remove: bool('Remove all') }, ['id']],
    ['addTemplate', 'edit', 0, 'Add a motion-graphics template clip (see listTemplates) with field values.', { id: str('Template id'), start: T('Start'), dur: num('Duration'), track, fields: obj('{key: value}') }, ['id']],
    ['addShape', 'edit', 0, 'Vector shape layer (rect | ellipse | polygon | star | line | path).', { type: str('Shape type'), start: T('Start'), dur: num('Duration'), track, center: arr('[x,y] px', { type: 'number' }), size: arr('[w,h] px', { type: 'number' }), color: str('Fill #hex'), stroke: obj('{color, width}'), fill: bool('false = no fill') }, ['type']],
    ['addLibraryShape', 'edit', 0, 'Animated library graphic (arrow, circle highlight, frame…) from listShapes.', { id: str('Library shape id'), start: T('Start'), dur: num('Duration'), track, center: arr('[x,y]', { type: 'number' }), size: arr('[w,h]', { type: 'number' }), style: str('accent | white | black | red | green | gold | outline'), anim: str('draw | pop | slide | pulse | none') }, ['id']],
    ['addMarker', 'edit', 0, 'Timeline marker (use for notes / review points).', { time: T(), name: str('Name'), color: str('#hex'), note: str('Comment') }],
    ['setSequence', 'edit', 0, 'Change sequence name, frame size (1080x1920 for Shorts) or fps.', { name: str('Name'), w: num('Width'), h: num('Height'), fps: num('FPS') }],
    ['select', 'edit', 0, 'Select clips so the user sees them highlighted.', { ids }, ['ids']],
    ['seek', 'edit', 1, 'Move the playhead.', { time: T() }, ['time']],
    ['autoReframe', 'edit', 0, 'Horizontal clip in a vertical sequence: position keyframes follow the subject.', { id, smooth: num('Smoothing (default 60)'), zoom: num('Zoom % (default 100)') }, ['id']],
    ['detectScenes', 'edit', 0, 'Detect shot changes in a video clip; action cut | markers | none.', { id, sensitivity: num('0-100 (default 50)'), minShot: num('Min shot seconds'), action: str('cut | markers | none') }, ['id']],
    // ---- colour ----
    ['autoColor', 'colour', 0, 'Automatic white balance + levels on a clip.', { id, time: T('Analysis frame') }, ['id']],
    ['colorMatch', 'colour', 0, 'Match the colour of a clip to a reference frame (consistency between shots).', { id, refTime: T('Reference frame time'), time: T('Frame of this clip') }, ['id']],
    ['applyLut', 'colour', 0, 'Apply a creative LUT / look to clips.', { id, ids, look: str('LUT look name'), path: str('.cube path'), intensity: num('0-100'), slot: str('creative | input'), remove: bool('Remove') }],
    // ---- audio ----
    ['addSfx', 'audio', 0, 'Insert a sound effect from the library at a time (use listSfx ids, or query words).', { id: str('Sound id'), query: str('Search words when id unknown'), time: T('Insert time'), track: str('Audio track A1, A2…') }],
    ['removeSilence', 'audio', 0, 'Jump-cut: ripple-delete silent ranges (linked video cut too). dryRun first to preview.', { ids, track: str('Audio track (default A1)'), threshold: num('dB (default -40)'), minSilence: num('Seconds (default 0.5)'), padding: num('Seconds kept (default 0.1)'), allTracks: bool('Ripple every track'), dryRun: bool('Only report') }],
    ['removeFillers', 'audio', 0, 'Remove filler words (يعني / اممم / آآ / uh / um) using the transcript.', { dryRun: bool('Only report') }],
    ['textDelete', 'audio', 0, 'Ripple-delete transcript words/ranges on all unlocked tracks (text-based editing).', { ranges: arr('[[t0,t1]…]', { type: 'array', items: { type: 'number' } }), text: str('Exact phrase to delete') }],
    ['autoDuck', 'audio', 0, 'Duck music under the voice with volume keyframes (−12 to −18 dB typical).', { music: str('Music track (default A2)'), voice: str('Voice track (default A1)'), duck: num('dB dip (default 12)'), threshold: num('Voice threshold dB'), attack: num('s'), release: num('s') }],
    ['setDuck', 'audio', 0, 'Live (non-destructive) ducking on a track.', { track: str('Track A1…'), on: bool('On'), amount: num('dB'), thr: num('Threshold dB'), attack: num('s'), release: num('s') }, ['track']],
    ['enhanceAudio', 'audio', 0, 'Speech clean-up baked to a new WAV: high-pass, noise reduction and loudness (−14 LUFS for YouTube). Undoable.', { ids, denoise: num('dB, 0=off (default 12)'), highpass: num('Hz, 0=off (default 80)'), loudness: num('LUFS (default -14)') }, ['ids']],
    ['normalizeLoudness', 'audio', 0, 'Two-pass loudness normalisation only (YouTube −14, podcast −16).', { ids, target: num('LUFS (default -14)') }, ['ids']],
    ['setAudioFx', 'audio', 0, 'Set audio effects on clips/track: preset (listAudioPresets) or fx [{type, params}].', { id, ids, track: str('Track'), preset: str('Preset id'), fx: arr('[{type, params}]', { type: 'object' }), mode: str('replace | append') }],
    ['beatMarkers', 'audio', 0, 'Markers on the beats of a music clip (cut on the beat).', { id, every: num('Every N beats') }, ['id']],
    ['tts', 'audio', 0, 'Offline text-to-speech voice-over placed on an audio track.', { text: str('Text'), voice: str('Voice id'), speed: num('Speed'), track: str('Track'), at: T('Time') }],
    // ---- captions ----
    ['transcribe', 'captions', 0, 'Speech-to-text (whisper, offline) of the selected clips or the whole sequence. Can take minutes.', { src: str('sel | seq'), lang: str('ar | en | auto') }],
    ['createCaptions', 'captions', 0, 'Create animated word-timed captions from the transcript on a new top track (replaces earlier captions). For Shorts: 2-4 words, 1 line, preset like "hormozi" or "boldYellow".', { preset: str('Caption preset id (listCaptionPresets)'), maxWords: num('Words per caption'), lines: num('1 or 2'), pos: str('top | center | lower | bottom'), size: num('Size % (100 = default)'), keywords: bool('Highlight keywords (default true)') }],
    ['restyleCaptions', 'captions', 0, 'Apply a caption preset / position / size to all existing captions, keeping text and timing.', { preset: str('Caption preset id'), pos: str('top | center | lower | bottom'), size: num('Size %') }],
    ['translateCaptions', 'captions', 0, 'Replace the transcript text with your translation (same number of segments, same order). Word timings are spread evenly; recreate captions afterwards.', { lang: str('Target language code'), texts: arr('One translated string per transcript segment') }, ['texts']],
    // ---- maps ----
    ['addMapScene', 'maps', 0, 'Animated 3D war / history map clip. invasion: arrows from attacker to targets + camera fly-in + optional headline/date. timeline: borders from y0 to y1. blank: globe on a region.', { kind: str('invasion | timeline | blank'), from: str('Attacker country'), targets: arr('Target countries'), year: num('Borders year'), style: str('Map style (listMapStyles)'), mode: str('globe | flat'), headline: str('Headline'), sub: str('Sub headline'), date: bool('Date counter'), y0: num('timeline start year'), y1: num('timeline end year'), region: str('Country to frame'), start: T('Start'), dur: num('Duration'), track }],
    ['addMapLayer', 'maps', 0, 'Add an element to a map clip: country (countries[]), invasion (from, to[]), arrow/route/front (pts or via), marker/label/callout (place, text), date, title, legend, clash, strike, troops, move (animated route with symbols)…', { id: str('Map clip id'), type: str('Layer type'), countries: arr('Countries'), from: str('Attacker'), to: arr('Targets'), place: str('City / place'), via: arr('Places along a route'), text: str('Text'), color: str('#hex'), start: num('Seconds from clip start'), dur: num('Seconds visible') }, ['id', 'type']],
    ['setMapLook', 'maps', 0, 'Map look preset (doc_dark | doc_light) or style.', { id: str('Map clip id'), preset: str('doc_dark | doc_light'), style: str('Style id') }, ['id']],
    ['addCampaign', 'maps', 0, 'War campaign on a map: sides with colours, timed capture events (provinces/cities change hands), scoreboard. quick {a, b, year, events} builds a two-country war on a new clip.', { id: str('Map clip id'), sides: arr('[{name, color, countries}]', { type: 'object' }), events: arr('[{time, dur, from, to, provinces, cities, fx}]', { type: 'object' }), quick: obj('{a, b, year, events}'), camera: bool('Camera follows events') }],
    ['addCampaignEvent', 'maps', 0, 'One capture event on a campaign.', { id: str('Map clip id'), time: num('Seconds in clip'), dur: num('Duration'), from: str('Losing side'), to: str('Capturing side'), provinces: arr('Provinces'), cities: arr('Cities'), fx: str('clash | strike | none') }, ['id']],
    ['setCameraKey', 'maps', 0, 'Map camera keyframe at a time (only the given properties are keyed). Establishing wide → zoom to region → event → pull back.', { id: str('Map clip id'), time: T('Timeline time'), lon: num('Longitude'), lat: num('Latitude'), zoom: num('Zoom'), tilt: num('Tilt deg'), heading: num('Heading deg'), interp: str('fly | bezier | linear | hold'), ease: str('ease | easeIn | easeOut | linear') }, ['id']],
    ['deleteCameraKey', 'maps', 0, 'Delete a map camera key (or all).', { id: str('Map clip id'), time: T(), all: bool('All keys') }, ['id']],
    ['moveLeaderTo', 'maps', 0, 'Leader portrait layer travels to a city.', { id: str('Map clip id'), layer: str('Leader layer id'), city: str('City'), start: num('s'), dur: num('s') }, ['id', 'city']],
    // ---- 3D / collage ----
    ['add3DScene', 'other', 0, '3D scene clip: living | news | doc | office | warroom | studio | empty.', { preset: str('Preset'), lights: str('news | sunset | dark | day'), start: T('Start'), dur: num('Duration'), track }],
    ['addCollageTemplate', 'other', 0, 'Paper-collage template (scene-news, scene-board, scene-file, polaroid, tape, stamps…). Image fields take a media id.', { template: str('Template id'), start: T('Start'), dur: num('Duration'), track, fields: obj('Field values') }, ['template']],
    ['removeBackground', 'other', 0, 'Cut out the subject of an image / clip frame (PNG with alpha), optionally placed with a collage look.', { media: str('Media'), id, time: T('Frame time'), addToTimeline: bool('Place at playhead'), look: str('sticker | torn | newsprint | xerox') }],
    // ---- export ----
    ['listExportPresets', 'export', 1, 'Export presets (YouTube 1080p/4K, Shorts, …).', {}],
    ['exportPreset', 'export', 0, 'Export with a preset (only when the user asked to export).', { preset: str('Preset id'), out: str('Output path'), range: str('all | io') }, ['preset']]
  ];
  const A = GW.AITools = { R };
  const have = (n) => !!(GW.API && Object.prototype.hasOwnProperty.call(GW.API.methods, n));
  A.list = () => R.filter(r => have(r[0]));
  A.readOnly = (n) => { const r = R.find(x => x[0] === n); return !!(r && r[2]); };
  A.group = (n) => { const r = R.find(x => x[0] === n); return r ? r[1] : 'other'; };
  // Anthropic tool definitions (planning: read-only only). The last tool carries a cache breakpoint (tools + system are reused every step).
  A.tools = (o = {}) => {
    const L = A.list().filter(r => !o.readOnly || r[2]);
    const out = L.map(([name, , , description, props, req]) => ({ name, description, input_schema: Object.assign({ type: 'object', properties: props }, req ? { required: req } : {}) }));
    if (out.length && o.cache !== false) out[out.length - 1].cache_control = { type: 'ephemeral' };
    return out;
  };
  // short Arabic labels for the live step log
  A.LABELS = { getState: 'قراءة حالة المشروع', captureFrame: 'التقاط إطار للمراجعة', getTranscript: 'قراءة التفريغ', listEffects: 'قائمة المؤثرات', listTransitions: 'قائمة الانتقالات', listSfx: 'بحث في المؤثرات الصوتية', listTitlePresets: 'قوالب العناوين', listTemplates: 'قوالب الموشن', listMapStyles: 'أنماط الخرائط', listCaptionPresets: 'أنماط الترجمة', listAudioPresets: 'إعدادات الصوت', listProvinces: 'المحافظات', listCities: 'المدن', listCameraKeys: 'مفاتيح الكاميرا', listShapes: 'مكتبة الأشكال', importMedia: 'استيراد ملفات', addClip: 'إضافة مقطع', moveClip: 'نقل مقطع', trimClip: 'قص طرف مقطع', splitAt: 'قطع', deleteClips: 'حذف مقاطع', setParam: 'تعديل خاصية', setKeyEase: 'تنعيم المفاتيح', addEffect: 'إضافة تأثير', addTransition: 'إضافة انتقال', addText: 'إضافة نص', setTextAnimator: 'تحريك النص', addTemplate: 'إضافة قالب', addShape: 'إضافة شكل', addLibraryShape: 'إضافة رسم', addMarker: 'إضافة علامة', setSequence: 'إعداد التسلسل', select: 'تحديد مقاطع', seek: 'تحريك المؤشر', autoReframe: 'إعادة تأطير تلقائي', detectScenes: 'كشف المشاهد', autoColor: 'تصحيح لون تلقائي', colorMatch: 'مطابقة اللون', applyLut: 'تطبيق LUT', addSfx: 'إضافة مؤثر صوتي', removeSilence: 'حذف الصمت', removeFillers: 'حذف كلمات الحشو', textDelete: 'حذف بالنص', autoDuck: 'خفض الموسيقى تحت الصوت', setDuck: 'خفض تلقائي للمسار', enhanceAudio: 'تحسين الصوت', normalizeLoudness: 'توحيد الجهارة', setAudioFx: 'تأثيرات الصوت', beatMarkers: 'علامات الإيقاع', tts: 'تعليق صوتي آلي', transcribe: 'تفريغ الصوت', createCaptions: 'إنشاء الترجمة', restyleCaptions: 'نمط الترجمة', translateCaptions: 'ترجمة النص', addMapScene: 'مشهد خريطة', addMapLayer: 'عنصر خريطة', setMapLook: 'مظهر الخريطة', addCampaign: 'حملة عسكرية', addCampaignEvent: 'حدث في الحملة', setCameraKey: 'مفتاح كاميرا', deleteCameraKey: 'حذف مفتاح كاميرا', moveLeaderTo: 'تحريك القائد', add3DScene: 'مشهد ثلاثي الأبعاد', addCollageTemplate: 'قالب كولاج', removeBackground: 'قص الخلفية', listExportPresets: 'إعدادات التصدير', exportPreset: 'تصدير' };
  // compact JSON for tool results (keeps the context small)
  A.compact = (v, max = 12000) => { let s; try { s = JSON.stringify(v); } catch (e) { s = String(v); } if (s == null) s = 'null'; return s.length > max ? s.slice(0, max) + '…[truncated ' + (s.length - max) + ' chars]' : s; };
})();
