'use strict';
/* GW.API — automation layer for an AI assistant (Claude via MCP) or scripts.
   Every method takes ONE plain-JSON params object and returns plain JSON (or throws Error with a readable message).
   Call through GW.API.call(method, params) → Promise<result>. The Electron main process exposes the same methods as
   JSON-RPC 2.0 over http://127.0.0.1:<port>/ (see main.js "api" block); tools/mcp/qassqass-mcp.js turns them into MCP tools.

   Conventions
   - Times are SECONDS on the active sequence's timeline (floats; snapped to frames by the editor).
   - Tracks: "V1", "V2"… (video, 1-based) and "A1", "A2"… (audio). {tt:'v', ti:0} is also accepted.
   - Clips/media are referenced by their id (see getState). Media may also be referenced by file name or full path.
   - Every edit is one undo step labelled "المساعد: …" in the History panel, so the user can review / undo it.

   Methods (params → result)
   getState({clips=true, media=true})            → project / sequence / tracks / clips / transitions / markers / media summary
   importMedia({paths:[abs paths]})              → [media]           (waits until each file is decoded / proxied)
   addClip({media|kind, track, start, dur, in, mode:'overwrite'|'insert', color, name})  → [clip]  (media clip adds its linked audio too; kind: color|adjust|text|rect|ellipse|bar)
   moveClip({id, start, track, linked=true})     → [clip]            (overwrites what it lands on, like dragging in the timeline)
   trimClip({id, start, end, dur, in, linked=true}) → [clip]         (start/end are new timeline edges; in = new source in-point)
   splitAt({time, ids, allTracks})               → {left:[ids], right:[ids]}
   deleteClips({ids, ripple=false, linked=true}) → {deleted:[ids]}
   setParam({id, path, value, time, ease, keyframes})  → {path, value}
        path: "motion.scale" "motion.pos" "motion.rot" "opacity" "vol" "pan" "text.str" "text.size" "text.color" "name" "color" "speed"
              "fx.<type|id|index>.<param>" (e.g. "fx.gblur.amount"), "afx.reverb.mix", "map.scene.style", "map.scene.cam.zoom" …
              aliases: scale, position|pos, rotation|rot, anchor, opacity, volume, text
        time (seconds, timeline) → sets a keyframe there (creates animation); without time → constant (removes keyframes)
        keyframes: [{time, value, ease:'linear'|'ease'|'easeIn'|'easeOut'|'hold'}] → replaces the animation
   addEffect({id|ids, type, params})              → [{clip, fx}]     (video fx, audio fx (auto-detected) or a look preset: see listEffects)
   addTransition({id, side:'end'|'start', type='dissolve', dur, align:'center'|'start'|'end'}) → transition
   addText({text, start, dur=5, preset, style:{font,size,color,weight,align,stroke,strokeColor,bg,bgColor,…}, position:[x,y], track, animIn, animOut}) → clip
   addMapScene({kind:'invasion'|'timeline'|'blank', from, targets:[…], year, style, mode:'globe'|'flat', color, headline, sub, date, arrow, start, dur, track, open, y0, y1, region}) → clip
   addMapLayer({id, type, …props, countries:[names], from, to:[names], place, photo:path, via:[places|[lon,lat]], look:'doc'})   → layer   (country/invasion/arrow/front/route/marker/label/range/date/title/legend/inset/data)
   setMapLook({id, preset:'doc_dark'|'doc_light', style, look:{…}})   → {style, look}
   War campaigns (atlas/war.js; addMapLayer also takes clash/strike/troops/air/encircle/siege and front {mode:'attack'}):
   addCampaign({id, sides:[{name, color, countries:[names], fill, border}], events:[{time, dur, from, to, provinces:[names], cities:[names], fx:'clash'|'strike'|'none'}], camera, legend}
        | {quick:{a, b, year, events:N}, id?}) → campaign layer (quick = «حرب بين دولتين»: new clip unless id)
   addCampaignEvent({id, layer, time, dur, from, to, provinces, cities, country, fx, origin:'border'|'city', text, camera}) → event
   listProvinces({country}) → [{key, name, en, lon, lat}]      listCities({country, limit}) → [{key, name, en, lon, lat, capital}]
   moveLeaderTo({id, layer, city | lon,lat, start, dur, style:'direct'|'curve'|'route'|'via'}) → move segment (leader travels, chains)
   addMapLayer also takes the FX-pack types (atlas/fxpack.js): clouds {cover, scale, opacity, color, shadow, wind, speed, seed, pass, detail, above},
        move {pts|via, preset:'route'|'army', dash:'solid'|'dash'|'dot'|'dashdot'|'rail'|'feet'|'ants', head:'classic'|'chevron'|'notched'|'open'|'none', taper, tail, march, comet, glow,
              pulses, sym:'plane'|'jet'|'heli'|'missile'|'ship'|'tank'|'car'|'soldier'|'lib:tank'|'lib:ship'|'lib:soldier'|'dot', symN, loop, multi, spread, stagger, arc, curve},
        callout {place|lon,lat, text, sub, style:'minimal'|'boxed'|'pill'|'doc'|'mission', dot:'ring'|'square'|'star'|'dot'|'target'|'none', dir:'auto'|'ne'|…, accent},
        district {country:'السعودية' (all admin-1 regions) | regions:'name, name' | countries:[…], data:'name, value' lines, palette:'single'|'multi', lift, labels};
        country layers: outline:'natgeo'|'historic'|'neon'|'ribbon', cut:1 (paper cut-out lift). Styles: 'mission' (HUD), 'papercut'; look.borderStyle: natgeo|historic|neon|ribbon
   importRoute({id, path | text, name, follow=false, start, inDur=8, color, …move props}) → layer   GPX / GeoJSON / KML line → animated route (elevation profile when present);
        follow: camera keys along the route (setCameraKey)
   addSfx({id|query, time, track})                → [clip]
   addMarker({time, name, color, note})           → marker
   Smart audio (js/audio_tools.js; each edit = one undo step):
   removeSilence({ids | track='A1', threshold=-40 (dB), minSilence=0.5, padding=0.1, allTracks=false, dryRun=false})
        → {count, removed (s), ranges:[[t0,t1]], tracks}   ripple-extracts silent ranges; linked video is cut at the same points
   autoDuck({music='A2' | musicIds, voice='A1' | voiceIds, duck=12 (dB), threshold=-35, attack=0.2, release=0.5, hold=0.3})
        → {clips:[{id, keys, dips}], dips, voiceRanges}   volume keyframes on the music clips while the voice is present
   beatMarkers({id, every=1, replace=true, dryRun=false}) → {bpm, count, markers:[t]}   sequence markers on the beats of a music clip
   enhanceAudio({id | ids, denoise=12 (afftdn dB, 0=off), highpass=80 (Hz, 0=off), loudness=-14 (LUFS, null=off)}) → {media:[{media, path, from, clips}]}
        FFmpeg bake into a new WAV that replaces the clip source (original file kept; undo or restoreAudio brings it back)
   normalizeLoudness({id | ids, target=-14})      → like enhanceAudio with only two-pass loudnorm (YouTube -14, podcast -16, EBU -23)
   restoreAudio({ids})                           → {clips}   point baked clips back at their original media
   detectScenes({id, sensitivity=50 (0–100), minShot=0.5, action:'cut'|'markers'|'none'}) → {times, threshold}   FFmpeg scene score (ui_vtools.js)
   textDelete({ranges:[[t0,t1]]} | {words:[[segIndex, wordIndex]]} | {text:'phrase'}) → {removed, ranges}   ripple-delete transcript words on all unlocked tracks
   removeFillers({dryRun=false})                 → {count, words, ranges, removed}   يعني / اممم / آآ / uh / um …
   stabilize({id, strength=5 (1–10), method:'auto'|'vidstab'|'deshake'}) → {media, clip, method}   bakes a new file that replaces the clip source (original kept)
   unstabilize({id})                             → {restored}
   autoReframe({id, smooth=60, zoom=100})        → {keys, clip}   horizontal clip in a vertical sequence: position keyframes follow the subject
   select({ids})  seek({time})  play({rate})  stop()  undo()  redo()
   setSequence({name, w, h, fps})                 → sequence
   saveProject({path})  openProject({path, force})  newProject({force, w, h, fps})
   export({out, fmt:'mp4'|'mp4h265'|'mov'|'webm'|'gif'|'png'|'jpg'|'wav'|'mp3', res:'seq'|scale, fps:'seq'|n, quality:'best'|'high'|'medium'|'low', range:'all'|'io', audio, alpha, wait=true}) → {ok, out}
   exportStatus()  cancelExport()
   captureFrame({time, maxWidth=960})            → {mime:'image/png', base64, width, height, time}   (what the Program monitor shows)
   listEffects() listTransitions() listSfx({query, cat, limit}) listTitlePresets() listMapStyles() listMethods()
   addShape({type:'rect'|'ellipse'|'polygon'|'star'|'line'|'path', start, dur, track, center, size, color, pts, closed, stroke:{color,width}, fill}) → clip   vector shape layer (js/shape.js)
   listShapes()                                  → [{id, name, category, anim, strokeOnly, frame, box}]   shapes & graphics library (js/shape_lib.js)
   addLibraryShape({id, start, dur, track, center:[x,y], size:[w,h], style:'accent'|'white'|'black'|'red'|'green'|'gold'|'outline', color, anim:'draw'|'pop'|'slide'|'pulse'|'none', rot, mask:true (frames: add as mask on clip `clip`), clip}) → clip | mask
   setTextAnimator({id, preset, unit:'char'|'word'|'line', shape, ease, props:{opacity,scale,rot,tracking,blur,pos,fill}, start|end|offset: value | [{time,value,ease}], replace, remove}) → {id, animators}
   createBin({name, parent, color, media:[ids]})   → bin   project folder (bins persist in the project file)
   listTemplates()                               → [{id, name, category, dur, fields:[{key, name, type, default}]}]   motion graphics templates (js/mg.js)
   addTemplate({id, start, dur, track, fields:{key: value}}) → clip   animated template clip at the playhead (or start)
   setKeyEase({id, path, index|time|index:'all', ease:'linear'|'hold'|'ease'|'easeIn'|'easeOut'|'bezier', influence (%), in:[x,y], out:[x,y]}) → keys
        bezier handles are normalized to the segment: out = [influence 0…1, progress] after the key, in = before it (y=0 → zero speed)
   listCameraKeys({id}) → {mode, animated:[groups], keys:[{time, groups, interp, ease, roving, lon, lat, zoom, …, in, out}]}   map camera keys
   setCameraKey({id, time, lon, lat, zoom|altitudeKm, tilt, heading, roll, fov, offX, offY, interp:'fly'|'bezier'|'linear'|'hold', ease:'ease'|'easeIn'|'easeOut'|'linear', roving, in:[x,y], out:[x,y]}) → listCameraKeys
        only the given properties are keyed (sparse per property, like After Effects); no values = key the current camera
   deleteCameraKey({id, time, group:'pos'|'zoom'|'tilt'|'heading'|'roll'|'fov'|'off'} | {id, all:true}) → listCameraKeys
   batch({calls:[{method, params}], stopOnError=true}) → [{ok, result|error}]  */
(function () {
  const VERSION = 1;
  const UI = () => GW.UI;
  const seq = () => GW.seq();
  const r4 = (v) => typeof v === 'number' ? Math.round(v * 10000) / 10000 : v;
  const fail = (msg) => { throw new Error(msg); };
  const label = (s) => 'المساعد: ' + s;
  const amend = () => { const H = GW.hist; H.stack[H.idx] = JSON.stringify(GW.prj); GW.bus.emit('hist'); GW.markDirty(); }; // fold a follow-up change into the last undo step
  const num = (v, name) => { if (v == null || v === '') return null; const n = +v; if (!isFinite(n)) fail(name + ' must be a number'); return n; };
  const isParam = (o) => o && typeof o === 'object' && !Array.isArray(o) && 'v' in o && Object.keys(o).every(k => k === 'v' || k === 'k');
  const plain = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o));

  /* ---------------- lookups ---------------- */
  const trackName = (tt, ti) => (tt === 'v' ? 'V' : 'A') + (ti + 1);
  function parseTrack(spec, defTT) {
    if (spec == null || spec === '') return null;
    if (typeof spec === 'object') return { tt: spec.tt === 'a' ? 'a' : 'v', ti: Math.max(0, +spec.ti || 0) };
    if (typeof spec === 'number') return { tt: defTT || 'v', ti: Math.max(0, spec - 1) };
    const m = /^\s*([VA])\s*(\d+)\s*$/i.exec(String(spec)); if (!m) fail('bad track "' + spec + '" (use V1, V2… / A1, A2…)');
    return { tt: m[1].toLowerCase(), ti: Math.max(0, +m[2] - 1) };
  }
  function clipOf(id) { const c = GW.clipById(id); if (!c) fail('clip not found: ' + id); return c; }
  function mediaOf(ref) {
    const L = GW.prj.media; const m = L.find(x => x.id === ref) || L.find(x => x.path === ref) || L.find(x => x.name === ref) || L.find(x => (x.name || '').toLowerCase() === String(ref).toLowerCase());
    if (!m) fail('media not found: ' + ref + ' (import it first with importMedia)'); return m;
  }
  const withLinked = (s, cs, on) => { const set = new Set(cs); if (on !== false) cs.forEach(c => GW.linked(s, c).forEach(l => set.add(l))); return [...set]; };
  function freeVTrack(s, t, dur, minTi = 0) { for (let i = minTi; i < s.vt.length; i++) { if (s.vt[i].lock) continue; if (!s.clips.some(c => c.tt === 'v' && c.ti === i && c.start < t + dur && c.start + c.dur > t)) return i; } GW.ops.ensureTrack(s, 'v', s.vt.length); return s.vt.length - 1; }
  const newIds = (s, before) => s.clips.filter(c => !before.has(c.id));
  const snapshot = (s) => new Set(s.clips.map(c => c.id));

  /* ---------------- summaries ---------------- */
  function pvNow(p, c) { if (!isParam(p)) return p; const s = seq(); const v = GW.pv(p, Math.max(0, s.t - c.start)); return Array.isArray(v) ? v.map(r4) : r4(v); }
  function clipInfo(c) {
    const o = { id: c.id, kind: c.kind, name: c.name, track: trackName(c.tt, c.ti), start: r4(c.start), dur: r4(c.dur), end: r4(c.start + c.dur), in: r4(c.in || 0), speed: r4(c.speed || 1), enabled: c.on !== 0 };
    if (c.media) o.media = c.media; if (c.link) o.link = c.link;
    if (c.motion) o.motion = { pos: pvNow(c.motion.pos, c), scale: pvNow(c.motion.scale, c), rot: pvNow(c.motion.rot, c), animated: ['pos', 'scale', 'rot', 'anchor'].filter(k => GW.isAnim(c.motion[k])) };
    if (c.opacity) o.opacity = pvNow(c.opacity, c);
    if (c.vol) o.vol = pvNow(c.vol, c);
    if (c.fx && c.fx.length) o.fx = c.fx.map(f => ({ id: f.id, type: f.type, name: (GW.FX[f.type] || {}).n, on: f.on !== 0 }));
    if (c.afx && c.afx.length) o.afx = c.afx.map(f => ({ id: f.id, type: f.type, name: (GW.AFX[f.type] || {}).n }));
    if (c.text) o.text = { str: c.text.str, font: c.text.font, size: c.text.size, color: c.text.color, animIn: c.text.animIn, animOut: c.text.animOut };
    if (c.color) o.color = c.color;
    if (c.kind === 'map' && c.map && c.map.scene) { const sc = c.map.scene; o.map = { style: sc.style, mode: sc.mode, year: isParam(sc.year) ? GW.pv(sc.year, 0) : sc.year, layers: (sc.layers || []).map(L => ({ id: L.id, type: L.type, name: L.name, start: L.start, dur: L.dur })), camKeys: (sc.cam && sc.cam.keys || []).length }; }
    if (c.kind === 'nest') o.ref = c.ref;
    return o;
  }
  function mediaInfo(m) { const r = (GW.rt && GW.rt.m && GW.rt.m[m.id]) || {}; return { id: m.id, name: m.name, kind: m.kind, path: m.path, dur: r4(m.dur || 0), w: m.w, h: m.h, fps: m.fps, hasAudio: !!m.hasAudio, status: r.status || 'new', offline: !!m.offline }; }
  function transInfo(x) { return { id: x.id, kind: x.kind, track: trackName(x.tt, x.ti), a: x.a, b: x.b, dur: r4(x.dur), align: x.align }; }

  /* ---------------- methods ---------------- */
  const M = {};
  M.getState = ({ clips = true, media = true } = {}) => {
    const s = seq(); const H = GW.hist;
    return {
      app: 'QassQass', apiVersion: VERSION, version: GW.version || null,
      project: { name: GW.prj.name, path: GW.prj.path, dirty: H.stack[H.idx] !== H.saved, undo: H.labels[H.idx] || null, canUndo: H.idx > 0, canRedo: H.idx < H.stack.length - 1 },
      sequences: GW.prj.seqs.map(q => ({ id: q.id, name: q.name, active: q.id === s.id, w: q.w, h: q.h, fps: q.fps, dur: r4(GW.seqDur(q)), clips: q.clips.length })),
      sequence: { id: s.id, name: s.name, w: s.w, h: s.h, fps: s.fps, dur: r4(GW.seqDur(s)), playhead: r4(s.t), inPoint: s.inP, outPoint: s.outP, playing: !!GW.pb.playing },
      tracks: { video: s.vt.map((t, i) => ({ track: trackName('v', i), name: t.name, lock: !!t.lock, hidden: !!t.hide, clips: s.clips.filter(c => c.tt === 'v' && c.ti === i).length })), audio: s.at.map((t, i) => ({ track: trackName('a', i), name: t.name, lock: !!t.lock, mute: !!t.mute, solo: !!t.solo, vol: t.vol || 0, clips: s.clips.filter(c => c.tt === 'a' && c.ti === i).length })) },
      clips: clips ? [...s.clips].sort((a, b) => a.start - b.start || (a.tt === b.tt ? a.ti - b.ti : a.tt === 'v' ? -1 : 1)).map(clipInfo) : undefined,
      transitions: s.trans.map(transInfo),
      markers: s.markers.map(m => ({ id: m.id, time: r4(m.t), name: m.name, color: m.color, note: m.note })),
      media: media ? GW.prj.media.map(mediaInfo) : undefined,
      selection: [...GW.sel.clips]
    };
  };

  M.importMedia = async ({ paths } = {}) => {
    if (!window.gws) fail('importMedia needs the desktop app');
    if (typeof paths === 'string') paths = [paths]; if (!Array.isArray(paths) || !paths.length) fail('paths: array of absolute file paths');
    const files = []; for (const p of paths) { if (!(await gws.exists(p))) fail('file not found: ' + p); files.push({ path: p, name: String(p).split(/[\\/]/).pop(), size: 1 }); }
    await GW.Media.importFiles(files.filter(f => !GW.prj.media.some(m => m.path === f.path)));
    return paths.map(p => mediaInfo(GW.prj.media.find(m => m.path === p)));
  };

  async function waitMedia(m, ms = 60000) {
    const t0 = performance.now();
    while (!(m.offline || m.dur || m.kind === 'image')) { if (performance.now() - t0 > ms) fail('media still preparing: ' + m.name); await GW.sleep(150); }
    if (m.offline) fail('media is offline: ' + m.name);
  }
  M.addClip = async (p = {}) => {
    const s = seq(); const start = num(p.start, 'start') ?? s.t; const keepT = s.t; const row = parseTrack(p.track);
    if (p.media) {
      const m = mediaOf(p.media); await waitMedia(m); const before = snapshot(s);
      const o = {}; if (row) o.row = row; if (p.in != null) o.in = num(p.in, 'in'); if (p.dur != null) o.dur = num(p.dur, 'dur');
      if (row && row.tt === 'v' && m.kind === 'audio') fail('audio media must go on an audio track (A1, A2…)');
      GW.TL.insertMedia([m], start, p.mode === 'insert' ? 'insert' : 'overwrite', o); // a video file with track "A2" keeps the target video track and puts its audio on A2
      const added = newIds(s, before); if (!added.length) fail('could not add the clip');
      GW.hist.labels[GW.hist.idx] = label('إضافة ' + m.name); s.t = keepT; GW.bus.emit('time'); GW.bus.emit('hist');
      return added.map(clipInfo);
    }
    const kind = p.kind || 'color'; const dur = num(p.dur, 'dur') || 5;
    if (kind === 'text') return [await M.addText(p)];
    if (!['color', 'adjust', 'rect', 'ellipse', 'bar'].includes(kind)) fail('kind must be color | adjust | text | rect | ellipse | bar (or pass media)');
    const ti = row ? (row.tt === 'v' ? row.ti : fail('generators go on video tracks')) : freeVTrack(s, start, dur, GW.TL ? GW.TL.target.v : 0);
    GW.ops.ensureTrack(s, 'v', ti);
    let c;
    if (kind === 'rect' || kind === 'ellipse' || kind === 'bar') {
      c = GW.newClip('color', { ti, start, dur, color: p.color || (kind === 'bar' ? '#d6202f' : '#2f8ef0'), name: p.name || (kind === 'ellipse' ? 'دائرة' : kind === 'bar' ? 'شريط' : 'مستطيل') });
      c.masks.push({ id: GW.uid(), type: kind === 'ellipse' ? 'ellipse' : 'rect', on: 1, mode: 'add', inv: 0, feather: GW.P(0), opacity: GW.P(100), expansion: GW.P(0), center: GW.P(p.center || (kind === 'bar' ? [s.w / 2, s.h * .86] : [s.w / 2, s.h / 2])), size: GW.P(p.size || (kind === 'bar' ? [s.w * .9, s.h * .1] : kind === 'ellipse' ? [s.h * .4, s.h * .4] : [s.w * .4, s.h * .3])), rot: GW.P(0) });
    } else { c = GW.newClip(kind, { ti, start, dur, color: p.color, name: p.name }); if (kind === 'adjust') c.fx.push(GW.newFx('lumetri')); }
    if (p.mode === 'insert') GW.ops.rippleInsert(s, start, dur, GW.ops.allTracks(s)); else GW.ops.clear(s, 'v', ti, start, start + dur);
    s.clips.push(c); GW.commit(label('إضافة ' + (GW.KIND_NAME[c.kind] || kind))); GW.invalidate();
    return [clipInfo(c)];
  };

  M.moveClip = ({ id, start, track, linked = true } = {}) => {
    const s = seq(); const c = clipOf(id); const group = withLinked(s, [c], linked);
    const ns = num(start, 'start'); const d = ns == null ? 0 : Math.max(-Math.min(...group.map(g => g.start)), ns - c.start);
    const row = parseTrack(track, c.tt); if (row && row.tt !== c.tt) fail('cannot move a ' + (c.tt === 'v' ? 'video' : 'audio') + ' clip to ' + trackName(row.tt, row.ti));
    const dti = row ? row.ti - c.ti : 0;
    for (const g of group) { g.start = GW.snapFrame(g.start + d, s.fps); if (g === c && row) { GW.ops.ensureTrack(s, g.tt, row.ti); g.ti = row.ti; } else if (dti && g.tt === c.tt) { g.ti = Math.max(0, g.ti + dti); GW.ops.ensureTrack(s, g.tt, g.ti); } }
    const ex = new Set(group.map(g => g.id)); for (const g of group) GW.ops.clear(s, g.tt, g.ti, g.start, g.start + g.dur, ex);
    s.trans = s.trans.filter(x => !(ex.has(x.a) || ex.has(x.b)) || (x.a && x.b && ex.has(x.a) && ex.has(x.b)));
    GW.commit(label('تحريك مقطع')); GW.invalidate(); return group.map(clipInfo);
  };

  M.trimClip = ({ id, start, end, dur, in: inP, linked = true } = {}) => {
    const s = seq(); const c = clipOf(id); const group = withLinked(s, [c], linked); const fd = 1 / s.fps;
    let ns = num(start, 'start'), ne = num(end, 'end'); const nd = num(dur, 'dur'), ni = num(inP, 'in');
    if (nd != null && ne == null) ne = (ns ?? c.start) + nd;
    for (const g of group) {
      if (ns != null) { let d = GW.snapFrame(ns, s.fps) - g.start; d = Math.max(d, -g.in / (g.speed || 1)); d = Math.min(d, g.dur - fd); g.in += d * (g.speed || 1); g.start += d; g.dur -= d; GW.shiftKeys(g, d); }
      if (ne != null) { const max = GW.maxLen(g); let nd2 = GW.snapFrame(ne, s.fps) - g.start; nd2 = Math.max(fd, nd2); if (isFinite(max)) nd2 = Math.min(nd2, (max - g.in) / (g.speed || 1)); g.dur = nd2; }
      if (ni != null) { const max = GW.maxLen(g); g.in = Math.max(0, isFinite(max) ? Math.min(ni, max - g.dur * (g.speed || 1)) : ni); }
    }
    const ex = new Set(group.map(g => g.id)); for (const g of group) GW.ops.clear(s, g.tt, g.ti, g.start, g.start + g.dur, ex);
    GW.commit(label('تشذيب مقطع')); GW.invalidate(); return group.map(clipInfo);
  };

  M.splitAt = ({ time, ids, allTracks } = {}) => {
    const s = seq(); const t = num(time, 'time') ?? s.t;
    let cs = ids && ids.length ? withLinked(s, ids.map(clipOf)) : allTracks !== false ? s.clips.slice() : [...GW.sel.clips].map(GW.clipById).filter(Boolean);
    cs = cs.filter(c => t > c.start + 1e-4 && t < c.start + c.dur - 1e-4 && !(s[c.tt + 't'][c.ti] || {}).lock);
    if (!cs.length) fail('no clip crosses ' + t + 's');
    const right = GW.ops.splitGroup(s, cs, GW.snapFrame(t, s.fps));
    GW.commit(label('قص عند ' + r4(t) + 'ث')); GW.invalidate();
    return { left: cs.map(c => c.id), right: right.map(c => c.id) };
  };

  M.deleteClips = ({ ids, ripple = false, linked = true } = {}) => {
    const s = seq(); if (typeof ids === 'string') ids = [ids]; if (!ids || !ids.length) fail('ids required');
    const all = withLinked(s, ids.map(clipOf), linked);
    if (ripple) GW.ops.rippleDelete(s, all); else all.forEach(c => GW.ops.remove(s, c));
    all.forEach(c => GW.sel.clips.delete(c.id)); GW.commit(label(ripple ? 'حذف مع إزاحة' : 'حذف')); GW.invalidate(); GW.bus.emit('selection');
    return { deleted: all.map(c => c.id) };
  };

  /* ----- parameters ----- */
  const ALIAS = { scale: 'motion.scale', position: 'motion.pos', pos: 'motion.pos', rotation: 'motion.rot', rot: 'motion.rot', anchor: 'motion.anchor', volume: 'vol', text: 'text.str' };
  function resolve(c, path) {
    path = ALIAS[path] || String(path || ''); const segs = path.split('.').filter(Boolean); if (!segs.length) fail('path required');
    let obj = c, parent = null, key = null;
    for (let i = 0; i < segs.length; i++) {
      const k = segs[i];
      if (Array.isArray(obj)) {
        let idx = /^\d+$/.test(k) ? +k : obj.findIndex(x => x && (x.id === k || x.type === k));
        if (idx < 0 || idx >= obj.length) fail('no "' + k + '" in ' + segs.slice(0, i).join('.') + (segs[i - 1] === 'fx' || segs[i - 1] === 'afx' ? ' (add it with addEffect)' : ''));
        parent = obj; key = idx; obj = obj[idx];
        if (obj && obj.params && segs[i + 1] && !['params', 'on', 'type', 'id'].includes(segs[i + 1])) { parent = obj; key = 'params'; obj = obj.params; }
        continue;
      }
      if (obj == null || typeof obj !== 'object') fail('invalid path ' + path);
      if (!(k in obj) && i < segs.length - 1) fail('invalid path ' + path + ' ("' + k + '" not found)');
      parent = obj; key = k; obj = obj[k];
    }
    return { parent, key, obj, path };
  }
  const coerce = (old, v) => { if (typeof old === 'number' && typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v; return v; };
  M.setParam = ({ id, path, value, time, ease, keyframes } = {}) => {
    const s = seq(); const c = clipOf(id); const R = resolve(c, path);
    if (isParam(R.obj)) {
      const p = R.obj; const ez = ease || 'linear';
      if (Array.isArray(keyframes)) {
        const ks = keyframes.map(k => ({ t: k.t != null ? +k.t : (+k.time - c.start), v: coerce(p.v, k.value ?? k.v), e: k.ease || k.e || 'linear' })).sort((a, b) => a.t - b.t);
        if (ks.length) { p.k = ks; p.v = ks[0].v; } else delete p.k;
      } else if (time != null) {
        const lt = num(time, 'time') - c.start; const v = coerce(p.v, value);
        if (!p.k || !p.k.length) { p.k = [{ t: lt, v, e: ez }]; p.v = v; } else { GW.setPv(p, lt, v); const k = GW.keyAt(p, lt); if (k) k.e = ez; }
      } else { delete p.k; p.v = coerce(p.v, value); }
    } else if (R.obj !== null && typeof R.obj === 'object' && !Array.isArray(R.obj) && (value === null || typeof value !== 'object')) fail(R.path + ' is an object; set one of its fields: ' + Object.keys(R.obj).join(', '));
    else R.parent[R.key] = coerce(R.obj, value);
    if (c.kind === 'text' && R.path === 'text.str') c.name = (String(c.text.str).split('\n')[0] || 'نص').slice(0, 40);
    GW.commit(label('تعديل ' + R.path)); GW.invalidate(); GW.bus.emit('param'); if (GW.FXC && GW.FXC.render) try { GW.FXC.render(); } catch (e) {}
    return { id: c.id, path: R.path, value: plain(resolve(c, R.path).obj) };
  };

  /* ----- effects / transitions ----- */
  const LOOKS = { kenburns: 'تكبير بطيء (Ken Burns)', kenburnsOut: 'تصغير بطيء', fadeInOut: 'ظهور واختفاء تدريجي', cinematic: 'مظهر سينمائي كامل', warDoc: 'مظهر وثائقي حربي', explosionShake: 'اهتزاز انفجار', greenScreen: 'إزالة شاشة خضراء', oldFilm: 'فيلم قديم', nightVision: 'رؤية ليلية', thermal: 'كاميرا حرارية', quake: 'زلزال', dream: 'حلم / ذكرى', cctv: 'كاميرا مراقبة', storm: 'عاصفة وبرق', newsMap: 'خلفية أخبار متحركة', comic: 'رسم كوميكس', oldTV: 'تلفاز قديم', sunset: 'غروب دافئ', coldWar: 'حرب باردة (أزرق بارد)', flashback: 'استرجاع (فلاش باك)' };
  const pval = (v) => (v && typeof v === 'object' && Array.isArray(v.keyframes)) ? { v: v.keyframes[0].value, k: v.keyframes.map(k => ({ t: +k.t, v: k.value, e: k.ease || 'linear' })) } : GW.P(v);
  M.addEffect = ({ id, ids, type, params = {} } = {}) => {
    const s = seq(); const cs = (ids || [id]).filter(Boolean).map(clipOf); if (!cs.length) fail('id required');
    const audio = !GW.FX[type] && GW.AFX[type]; if (!GW.FX[type] && !GW.AFX[type]) fail('unknown effect "' + type + '" (see listEffects)');
    const out = [];
    for (let c of cs) {
      if (audio && c.tt !== 'a') c = GW.linked(s, c).find(x => x.tt === 'a') || fail('audio effect needs an audio clip');
      if (!audio && c.tt !== 'v') fail('video effect needs a video clip');
      const f = GW.newFx(type, audio ? 'a' : 'v'); const defs = (audio ? GW.AFX : GW.FX)[type].p;
      for (const k in params) { if (!defs.some(d => d.k === k)) fail('effect "' + type + '" has no param "' + k + '" (params: ' + defs.map(d => d.k).join(', ') + ')'); f.params[k] = pval(params[k]); }
      if (audio) (c.afx = c.afx || []).push(f); else (c.fx = c.fx || []).push(f);
      out.push({ clip: c.id, fx: { id: f.id, type, params: plain(f.params) } });
    }
    GW.commit(label('تأثير ' + ((GW.FX[type] || GW.AFX[type]).n))); GW.invalidate(); if (GW.FXC && GW.FXC.render) try { GW.FXC.render(); } catch (e) {}
    return out;
  };
  // looks (multi-effect presets) go through the Effects panel code path, applied per clip
  const addLook = (cs, type) => { const keep = new Set(GW.sel.clips); GW.sel.clips = new Set(cs.map(c => c.id)); try { UI().applyFxTo({ group: 'preset', type }, null, {}); } finally { GW.sel.clips = keep; GW.bus.emit('selection'); } GW.hist.labels[GW.hist.idx] = label('قالب: ' + LOOKS[type]); GW.bus.emit('hist'); return cs.map(c => ({ clip: c.id, look: type, fx: (c.fx || []).map(f => f.type) })); };
  const addEffect0 = M.addEffect;
  M.addEffect = (p = {}) => { if (LOOKS[p.type]) { const cs = (p.ids || [p.id]).filter(Boolean).map(clipOf).filter(c => c.tt === 'v'); if (!cs.length) fail('looks apply to video clips'); return addLook(cs, p.type); } return addEffect0(p); };

  M.addTransition = ({ id, side = 'end', type = 'dissolve', dur, align } = {}) => {
    const s = seq(); let c = clipOf(id); const audio = !!GW.ATRANS[type];
    if (!GW.TRANS[type] && !audio) fail('unknown transition "' + type + '" (see listTransitions)');
    if (audio && c.tt !== 'a') c = GW.linked(s, c).find(x => x.tt === 'a') || fail('audio transition needs an audio clip');
    if (!audio && c.tt !== 'v') fail('video transition needs a video clip');
    const before = new Set(s.trans.map(x => x.id));
    GW.TL.addTransitionAt(type, c, side === 'start' ? 'L' : 'R');
    const x = s.trans.find(t => !before.has(t.id)); if (!x) fail('could not add transition');
    if (dur != null) x.dur = Math.max(2 / s.fps, num(dur, 'dur')); if (align) x.align = align;
    GW.hist.labels[GW.hist.idx] = label('انتقال ' + (GW.TRANS[type] || GW.ATRANS[type]).n); amend(); GW.invalidate();
    return transInfo(x);
  };

  /* ----- text ----- */
  M.addText = (p = {}) => {
    const s = seq(); const start = num(p.start, 'start') ?? s.t; const dur = num(p.dur, 'dur') || 5; const row = parseTrack(p.track);
    let pi = p.preset; if (typeof pi === 'string' && !/^\d+$/.test(pi)) { pi = GW.TITLE_PRESETS.findIndex(x => x.n === p.preset || x.n.includes(p.preset)); if (pi < 0) fail('unknown title preset (see listTitlePresets)'); }
    const pr = pi != null && pi !== '' ? GW.TITLE_PRESETS[+pi] : null; if (pi != null && pi !== '' && !pr) fail('unknown title preset index ' + pi);
    const ti = row ? (row.tt === 'v' ? row.ti : fail('text goes on a video track')) : freeVTrack(s, start, dur, GW.TL ? GW.TL.target.v : 0);
    GW.ops.ensureTrack(s, 'v', ti);
    const c = GW.newClip('text', { ti, start, dur, name: pr ? pr.n : 'نص' });
    if (pr) Object.assign(c.text, GW.clone(pr.t));
    if (p.text != null) c.text.str = String(p.text);
    if (p.style && typeof p.style === 'object') for (const k in p.style) { if (!(k in c.text)) fail('unknown text style "' + k + '" (keys: ' + Object.keys(c.text).join(', ') + ')'); c.text[k] = coerce(c.text[k], p.style[k]); }
    if (p.animIn) c.text.animIn = p.animIn; if (p.animOut) c.text.animOut = p.animOut;
    let pos = p.position || p.pos || (pr && pr.pos ? pr.pos : null);
    if (pos) { if (pos[0] <= 1 && pos[1] <= 1) pos = [pos[0] * s.w, pos[1] * s.h]; c.motion.pos = GW.P([Math.round(pos[0]), Math.round(pos[1])]); }
    c.name = p.name || (c.text.str.split('\n')[0] || 'نص').slice(0, 40);
    if (p.mode === 'insert') GW.ops.rippleInsert(s, start, dur, GW.ops.allTracks(s)); else if (row) GW.ops.clear(s, 'v', ti, start, start + dur);
    s.clips.push(c); GW.commit(label('إضافة نص')); GW.invalidate();
    return clipInfo(c);
  };
  /* ---- shape layers (js/shape.js), text animators (js/text_anim.js), project bins (js/ui_project.js) ---- */
  M.addShape = (p = {}) => { // {type:'rect'|'ellipse'|'polygon'|'star'|'line'|'path', start, dur, track, center:[x,y], size:[w,h], color, pts:[[x,y,inX,inY,outX,outY]…], closed, name}
    if (!GW.Shape) fail('shape layers unavailable'); const type = p.type || 'rect'; if (!GW.Shape.TYPES.some(t => t[0] === type)) fail('type must be ' + GW.Shape.TYPES.map(t => t[0]).join(' | '));
    const row = parseTrack(p.track); if (row && row.tt !== 'v') fail('shapes go on video tracks');
    const c = GW.Shape.add(type, { start: num(p.start, 'start'), dur: num(p.dur, 'dur') || 5, ti: row ? row.ti : null, center: p.center, size: p.size, color: p.color, pts: p.pts, closed: p.closed, name: p.name, insert: p.mode === 'insert' });
    if (GW.TL && GW.TL.tool === 'pen') GW.TL.setTool('select');
    if (p.stroke) { c.shape.stroke.on = 1; if (p.stroke.color) c.shape.stroke.color = GW.P(p.stroke.color); if (p.stroke.width != null) c.shape.stroke.width = GW.P(+p.stroke.width); }
    if (p.fill === false) c.shape.fill.on = 0;
    GW.hist.labels[GW.hist.idx] = label('شكل جديد'); GW.bus.emit('hist'); GW.invalidate(); return clipInfo(c);
  };
  M.listShapes = () => { if (!GW.ShapeLib) fail('shapes library unavailable'); return GW.ShapeLib.list(); };
  M.addLibraryShape = (p = {}) => { // {id, start, dur, track, center, size, style, color, anim, rot, mask, clip, name}
    if (!GW.ShapeLib) fail('shapes library unavailable'); const it = GW.ShapeLib.get(p.id); if (!it) fail('unknown shape "' + p.id + '" (see listShapes)');
    if (p.mask) { const c = clipOf(p.clip); const mk = GW.ShapeLib.addMask(it.id, c); if (!mk) fail('mask not added'); return { id: mk.id, clip: c.id, type: 'path', points: GW.pv(mk.pts, 0).length }; }
    const row = parseTrack(p.track); if (row && row.tt !== 'v') fail('shapes go on video tracks');
    if (p.style && !GW.ShapeLib.STYLES.some(x => x[0] === p.style)) fail('style must be ' + GW.ShapeLib.STYLES.map(x => x[0]).join(' | '));
    if (p.anim && !GW.ShapeLib.ANIMS.some(x => x[0] === p.anim)) fail('anim must be ' + GW.ShapeLib.ANIMS.map(x => x[0]).join(' | '));
    const c = GW.ShapeLib.add(it.id, { start: num(p.start, 'start'), dur: num(p.dur, 'dur') || 5, ti: row ? row.ti : null, center: p.center, size: p.size, style: p.style, color: p.color, anim: p.anim, rot: p.rot, name: p.name, insert: p.mode === 'insert' });
    if (!c) fail('shape not added'); GW.hist.labels[GW.hist.idx] = label('إدراج شكل'); GW.bus.emit('hist'); GW.invalidate(); return clipInfo(c);
  };
  M.setTextAnimator = (p = {}) => { // {id, preset:'typewriter'|'fadeUpWord'|'blurIn'|'bounce'|'slideSide'|'scaleIn'|'fadeOutWord'|'custom', unit, shape, ease, props:{opacity,scale,rot,tracking,blur,pos:[x,y],fill}, start,end,offset (constant or [{time,value}]), replace=false, remove=false}
    const c = clipOf(p.id); if (c.kind !== 'text' || !c.text) fail('not a text clip'); if (!GW.TextAnim) fail('text animators unavailable');
    c.text.animators = c.text.animators || []; if (p.remove) { c.text.animators = []; GW.TextR.drop(c.id); GW.commit(label('حذف محرّكات النص')); GW.invalidate(); return { id: c.id, animators: [] }; }
    if (p.replace) c.text.animators = [];
    const an = GW.TextAnim.newAnimator(p.preset || 'custom', c.dur); if (p.unit) an.unit = p.unit; if (p.shape) an.sel.shape = p.shape; if (p.ease) an.sel.ease = p.ease; if (p.name) an.name = String(p.name);
    const setSel = (k) => { if (p[k] == null) return; const v = p[k]; if (Array.isArray(v)) { an.sel[k].k = v.map(o => ({ t: +o.time || 0, v: +o.value, e: o.ease || 'linear' })).sort((a, b) => a.t - b.t); an.sel[k].v = an.sel[k].k[0].v; } else { an.sel[k] = GW.P(+v); } };
    setSel('start'); setSel('end'); setSel('offset');
    if (p.props && typeof p.props === 'object') for (const k in p.props) { if (k === 'fill') { an.props.fillOn = 1; an.props.fill = GW.P(String(p.props.fill)); continue; } if (!(k in an.props)) fail('unknown animator property "' + k + '"'); an.props[k] = GW.P(k === 'pos' ? [+p.props[k][0] || 0, +p.props[k][1] || 0] : +p.props[k]); }
    c.text.animators.push(an); GW.TextR.drop(c.id); GW.commit(label('محرّك نص: ' + an.name)); GW.invalidate(); if (GW.FXC) GW.FXC.render();
    return { id: c.id, animators: plain(c.text.animators) };
  };
  M.createBin = (p = {}) => { // {name, parent (bin id or name), color, media:[ids|names]} → bin
    if (!GW.Bins) fail('bins unavailable'); let parent = null; if (p.parent) { const b = GW.prj.bins && GW.prj.bins.find(b => b.id === p.parent || b.name === p.parent); if (!b) fail('unknown parent bin'); parent = b.id; }
    const b = GW.Bins.create(p.name || 'مجلد جديد', parent); if (p.color) GW.Bins.setColor(b.id, p.color);
    if (Array.isArray(p.media) && p.media.length) GW.Bins.move(p.media.map(x => mediaOf(x).id), b.id);
    GW.hist.labels[GW.hist.idx] = label('مجلد جديد: ' + b.name); GW.bus.emit('hist'); return plain(b);
  };
  M.listTitlePresets = () => GW.TITLE_PRESETS.map((p, i) => ({ index: i, name: p.n, text: p.t.str, font: p.t.font, size: p.t.size, pos: p.pos || [.5, .5] }));

  /* ----- maps ----- */
  const A = () => GW.Atlas; const Geo = () => GW.Atlas.Geo;
  async function eraFor(year) { const G = Geo(); await G.load(); const era = G.era(+year || 2025, 'auto'); await G.ensureEra(era, 0); return era; }
  function countryKey(name, era) { const G = Geo(); const fs = G.features(era, 0) || []; const r = G.search(String(name), fs, 'ar', era, 5).find(x => x.kind === 'country' || x.kind === 'province'); if (!r) fail('unknown country / region: ' + name); return r.key || (r.f && r.f.key); }
  M.addMapScene = async (p = {}) => {
    if (!GW.MapUI || !A()) fail('map engine not available');
    const s = seq(); const keepT = s.t; const kind = p.kind || (p.y0 != null ? 'timeline' : p.from ? 'invasion' : 'blank');
    const row = parseTrack(p.track); if (row && row.tt !== 'v') fail('maps go on a video track');
    const errs = []; let made = null; const add0 = UI().addMapClip; const toast0 = GW.toast;
    UI().addMapClip = (scn, o = {}) => { made = add0(scn, { ...o, open: !!p.open, ...(row ? { ti: row.ti } : {}), ...(p.name ? { name: p.name } : {}) }); return made; };
    GW.toast = (m, k) => { if (k === 'err') errs.push(m); return toast0(m, k); };
    try {
      if (p.start != null) s.t = num(p.start, 'start');
      if (kind === 'invasion') {
        const targets = Array.isArray(p.targets) ? p.targets : String(p.targets || '').split(/[,،]+/).map(x => x.trim()).filter(Boolean);
        if (!p.from || !targets.length) fail('invasion needs from and targets');
        await GW.MapUI.quickInvasion({ from: p.from, targets, year: p.year || 2025, style: p.style || 'satellite', mode: p.mode || 'globe', color: p.color || '#e5243b', headline: p.headline || '', sub: p.sub || '', date: p.date ? 1 : 0, arrow: p.arrow || 'military' });
      } else if (kind === 'timeline') {
        await GW.MapUI.quickTimeline({ y0: +p.y0 || 1914, y1: +p.y1 || 1945, region: p.region || '', dur: +p.dur || 12, style: p.style || 'political', mode: p.mode || 'globe' });
      } else {
        const scn = A().newScene({ mode: p.mode || 'globe', ...(p.style ? { style: p.style } : {}), ...(p.year ? { year: GW.P(+p.year) } : {}) });
        if (p.center || p.region) { if (p.region) { const era = await eraFor(p.year); const G = Geo(); const f = (G.features(era, 0) || []).find(x => x.key === countryKey(p.region, era)); if (f) Object.assign(scn.cam, A().Cam.fit(f.bounds, 0, 0, .55)); } else Object.assign(scn.cam, { lon: +p.center[0], lat: +p.center[1], zoom: +p.zoom || 4 }); }
        UI().addMapClip(scn, { dur: num(p.dur, 'dur') || 10 });
      }
    } finally { UI().addMapClip = add0; GW.toast = toast0; s.t = keepT; GW.bus.emit('time'); }
    if (!made) fail(errs.join(' — ') || 'could not create the map scene');
    if (p.dur != null && kind !== 'blank') made.dur = Math.max(1 / s.fps, num(p.dur, 'dur'));
    GW.hist.labels[GW.hist.idx] = label('مشهد خريطة'); amend(); GW.invalidate();
    return clipInfo(made);
  };
  M.addMapLayer = async (p = {}) => {
    const c = clipOf(p.id); if (c.kind !== 'map' || !c.map || !c.map.scene) fail('not a map clip: ' + p.id);
    const S = A().Scene; const type = p.type; if (!S.LAYERS[type]) fail('unknown layer type (one of ' + Object.keys(S.LAYERS).join(', ') + ')');
    const scn = c.map.scene; const era = await eraFor(GW.pv(scn.year, 0));
    const o = {}; for (const k in p) if (!['id', 'type', 'countries', 'from', 'to', 'place', 'photo', 'via', 'look'].includes(k)) o[k] = p[k];
    if (p.photo) { // image/leader layer: photo file path → embedded (≤640px)
      const url = window.gws && gws.mediaUrl ? gws.mediaUrl(String(p.photo)) : String(p.photo); const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = url; }); if (!im) fail('photo not readable: ' + p.photo);
      const k = Math.min(1, 640 / Math.max(im.naturalWidth, im.naturalHeight)); const cv = document.createElement('canvas'); cv.width = im.naturalWidth * k | 0; cv.height = im.naturalHeight * k | 0; cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); const iid = GW.uid(); scn.images = scn.images || {}; scn.images[iid] = cv.toDataURL('image/jpeg', .9); o.img = iid;
    }
    if (p.via) { const G = Geo(); o.pts = []; for (const n of p.via) { if (Array.isArray(n)) { o.pts.push([+n[0], +n[1]]); continue; } const r = G.search(String(n), G.features(era, 0), 'ar', era, 5)[0]; if (!r) fail('place not found: ' + n); o.pts.push([r.lon, r.lat]); } }
    if (p.look && type === 'country') Object.assign(o, S.docCountry(Object.assign({}, o)));
    if (p.countries) o.keys = p.countries.map(n => countryKey(n, era));
    if (p.from) o.from = countryKey(p.from, era); if (p.to) o.to = (Array.isArray(p.to) ? p.to : [p.to]).map(n => countryKey(n, era));
    if (p.place) { const G = Geo(); G.loadAdmin1 && G.loadAdmin1(); const r = G.search(String(p.place), G.features(era, 0), 'ar', era, 5)[0]; if (!r) fail('place not found: ' + p.place); o.lon = r.lon; o.lat = r.lat; if (o.text == null && (type === 'marker' || type === 'label' || type === 'range' || type === 'callout')) o.text = r.name; }
    if (p.pts) o.pts = p.pts.map(pt => Array.isArray(pt) ? [+pt[0], +pt[1]] : fail('pts: [[lon,lat],…]'));
    const L = S.newLayer(type, o); if (o.lon == null && L.pts && L.pts.length) { L.lon = L.pts[0][0]; L.lat = L.pts[0][1]; } scn.layers.push(L);
    GW.commit(label('طبقة خريطة: ' + S.LAYERS[type].ar)); GW.invalidate(); if (GW.MapUI && GW.MapUI.render) try { GW.MapUI.render(); } catch (e) {}
    return plain(L);
  };
  // GPX / GeoJSON / KML → animated route layer (atlas/fxpack.js); follow → camera keys along the route head
  M.importRoute = async (p = {}) => {
    const c = clipOf(p.id); if (c.kind !== 'map' || !c.map || !c.map.scene) fail('not a map clip: ' + p.id); const FX = A().FX; if (!FX) fail('fx pack not loaded');
    let text = p.text; if (text == null) { if (!p.path) fail('path or text required'); text = await gws.readText(String(p.path)); }
    let tr; try { tr = FX.parseTrack(text, p.name || (p.path ? String(p.path).split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : '')); } catch (e) { fail(e.message); }
    const props = {}; for (const k in p) if (!['id', 'path', 'text', 'name', 'follow', 'start', 'inDur', 'keys', 'zoomIn'].includes(k)) props[k] = p[k];
    const L = FX.routeLayer(tr, { inDur: p.inDur != null ? +p.inDur : 8, props }); L.start = p.start != null ? Math.max(0, +p.start) : 0;
    const scn = c.map.scene; scn.layers.push(L);
    if (p.follow) FX.applyFollow(c, L, { keys: p.keys, zoomIn: p.zoomIn });
    else { const bb = d3.geoBounds({ type: 'LineString', coordinates: L.pts }); const Cm = A().Cam; const f = Cm.fit ? Cm.fit(bb, 0, 0, .7) : null; if (f && !(scn.cam.keys || []).length) Object.assign(scn.cam, { lon: f.lon, lat: f.lat, zoom: f.zoom }); }
    GW.commit(label('استيراد مسار')); GW.invalidate(); if (GW.MapUI && GW.MapUI.render) try { GW.MapUI.render(); } catch (e) {}
    return Object.assign(plain(L), { points: L.pts.length, km: tr.km, elevation: !!tr.eles });
  };
  // one-click looks: {id, preset:'doc_dark'|'doc_light'} or {id, style, look:{…overrides}} (labels, borders, colours, grade — see Maps panel)
  M.setMapLook = async ({ id, preset, style, look } = {}) => {
    const c = clipOf(id); if (c.kind !== 'map' || !c.map || !c.map.scene) fail('not a map clip: ' + id); const S = A().Scene; const scn = c.map.scene;
    if (preset) { if (!S.STYLES[preset]) fail('unknown preset'); S.applyDocLook(scn, preset); }
    if (style) { if (!S.STYLES[style]) fail('unknown style'); scn.style = style; }
    if (look && typeof look === 'object') Object.assign(scn.look, look);
    GW.commit(label('مظهر الخريطة')); GW.invalidate(); if (GW.MapUI && GW.MapUI.render) try { GW.MapUI.render(); } catch (e) {}
    return { style: scn.style, look: plain(scn.look) };
  };
  M.listMapStyles = () => { const S = A().Scene; return { styles: S.STYLE_ORDER.map(k => ({ id: k, name: S.STYLES[k].ar })), layers: Object.entries(S.LAYERS).map(([k, v]) => ({ type: k, name: v.ar })), modes: ['globe', 'flat'], arrows: ['military', 'line', 'dashed', 'double'] }; };
  /* ----- war campaigns (atlas/war.js) ----- */
  const WRa = () => { const W = GW.Atlas && GW.Atlas.War; if (!W) fail('war module not available'); return W; };
  const mapClip = (id) => { const c = clipOf(id); if (c.kind !== 'map' || !c.map || !c.map.scene) fail('not a map clip: ' + id); return c; };
  async function ccFor(name, era) { const G = Geo(); const f = WRa().findCountry(String(name), era); if (!f) fail('unknown country: ' + name); return { f, cc: WRa().ccOf(f) }; }
  function cityFor(n, cc) { const G = Geo(); const W = WRa(); if (n && typeof n === 'object' && n.lon != null) return { key: 'C:' + (n.name || n.n || 'x') + ':' + (cc || ''), n: n.name || n.n || '', a: n.ar || n.a || n.name || '', lon: +n.lon, lat: +n.lat };
    const q = G.norm(String(n)); const ps = (G.places || []).filter(p => (!cc || p[7] === cc) && (G.norm(p[3]) === q || G.norm(p[2]) === q)); const p = ps.sort((a, b) => a[4] - b[4])[0] || (cc ? null : (W.cities ? null : null)); if (!p) { const any = (G.places || []).filter(x => G.norm(x[3]).includes(q) || G.norm(x[2]).includes(q)).sort((a, b) => a[4] - b[4])[0]; if (!any) fail('city not found: ' + n); return W.cityRec(any); } return W.cityRec(p); }
  function provFor(n, cc) { const G = Geo(); const q = G.norm(String(n)); const ps = WRa().provinces(cc); const f = ps.find(x => G.norm(x.ar) === q || G.norm(x.en) === q) || ps.find(x => G.norm(x.ar).includes(q) || G.norm(x.en).includes(q)); if (!f) fail('province not found in ' + cc + ': ' + n + ' (see listProvinces)'); return f.key; }
  // listProvinces({country, year}) → admin-1 provinces of a country (Arabic + English names)
  M.listProvinces = async ({ country, year } = {}) => { if (!country) fail('country required'); const era = await eraFor(year || 2024); await WRa().loadA1(); const { cc } = await ccFor(country, era); return WRa().provinces(cc).map(f => ({ key: f.key, name: f.ar || f.en, en: f.en, type: f.properties.ty || '', lon: +f.lab[0].toFixed(3), lat: +f.lab[1].toFixed(3) })); };
  // listCities({country, limit}) → cities of a country, biggest first
  M.listCities = async ({ country, limit = 100, year } = {}) => { if (!country) fail('country required'); const era = await eraFor(year || 2024); const { cc } = await ccFor(country, era); return WRa().cities(cc).slice(0, limit).map(p => ({ key: 'C:' + p[2] + ':' + p[7], name: p[3] || p[2], en: p[2], lon: p[0], lat: p[1], capital: !!(p[6] & 1), rank: p[4] })); };
  // addCampaign({id (map clip) | new clip, year, style, sides:[{name, color, countries:[names], fill, border}], events:[…], quick:{a, b, events}, camera, legend…}) → layer
  M.addCampaign = async (p = {}) => {
    const W = WRa(); const S = A().Scene;
    if (p.quick) { // «حرب بين دولتين» quick builder
      const q = p.quick; const s = seq(); const before = snapshot(s);
      const into = p.id ? mapClip(p.id) : null; const L = await GW.WarUI.quickWar({ a: q.a, b: q.b, year: q.year || p.year || 2024, events: q.events || 5, fx: q.fx || 'mix', camera: p.camera === false ? 0 : 1, style: p.style || 'doc_dark', date: p.date ? 1 : 0, title: p.title || '', open: !!p.open }, into);
      if (!L) fail('could not build the war (check the country names)'); GW.hist.labels[GW.hist.idx] = label('حرب بين دولتين'); amend();
      const made = newIds(s, before); return Object.assign(plain(L), made.length ? { clip: made[0].id } : into ? { clip: into.id } : {});
    }
    const c = mapClip(p.id); const scn = c.map.scene; const era = await eraFor(p.year || GW.pv(scn.year, 0)); if (era.src !== 'hist') await W.loadA1();
    const sides = []; for (const [i, sd] of (p.sides || []).entries()) { const keys = []; for (const n of sd.countries || []) keys.push((await ccFor(n, era)).f.key); sides.push({ id: sd.id || String.fromCharCode(97 + i), name: sd.name || (keys[0] ? Geo().name(Geo().features(era, 0).find(f => f.key === keys[0]), 'ar', era) : 'طرف ' + (i + 1)), color: sd.color || ['#a8322a', '#3c6e8f', '#b0893a', '#4a7a3c'][i % 4], countries: keys, fill: sd.fill == null ? .5 : +sd.fill, border: sd.border || 'solid', ...(sd.split === false ? { split: 0 } : {}) }); }
    if (sides.length < 2) fail('a campaign needs at least two sides');
    const o = {}; for (const k of ['name', 'start', 'dur', 'legend', 'legendPos', 'legendTitle', 'captions', 'showCities', 'flip', 'borders', 'cityR', 'labels', 'provLines']) if (p[k] != null) o[k] = p[k];
    const L = S.newLayer('campaign', Object.assign({ sides, events: [], cities: [] }, o)); scn.layers.push(L);
    for (const ev of p.events || []) await addEv(c, L, ev, era);
    if (p.camera) W.applyCameraKeys(scn, W.cameraKeys(L, scn, {}));
    GW.commit(label('حملة عسكرية')); GW.invalidate(); if (GW.MapUI && GW.MapUI.render) try { GW.MapUI.render(); } catch (e) {}
    return plain(L);
  };
  async function addEv(c, L, ev, era) {
    const W = WRa(); const sideId = (v, d) => { if (v == null) return d; const sd = L.sides.find(x => x.id === v || x.name === v) || L.sides[+v]; if (!sd) fail('unknown side: ' + v); return sd.id; };
    const to = sideId(ev.to, L.sides[0].id), from = sideId(ev.from, (L.sides.find(x => x.id !== to) || {}).id);
    const fromSide = L.sides.find(x => x.id === from); const f0 = fromSide && Geo().features(era, 0).find(f => f.key === fromSide.countries[0]); let cc = f0 ? W.ccOf(f0) : null;
    if (ev.country) cc = (await ccFor(ev.country, era)).cc;
    const units = (ev.provinces || []).map(n => String(n).startsWith('P:') ? n : provFor(n, cc)).concat(ev.units || []);
    const cities = (ev.cities || []).map(n => cityFor(n, cc));
    const e = { id: GW.uid(), t: +(ev.time != null ? ev.time : ev.t || 0), dur: +(ev.dur || 2.5), from, to, units, cities, origin: ev.origin || 'border', fx: ev.fx || 'clash', caption: ev.caption === false ? 0 : 1, ...(ev.text ? { text: ev.text } : {}), ...(ev.shake ? { shake: 1 } : {}) };
    (L.events = L.events || []).push(e); L.events.sort((a, b) => a.t - b.t); return e;
  }
  // addCampaignEvent({id (map clip), layer, time, dur, from, to, provinces:[names], cities:[names|{name,lon,lat}], country, fx, origin, text}) → event
  M.addCampaignEvent = async (p = {}) => {
    const c = mapClip(p.id); const scn = c.map.scene; const L = scn.layers.find(x => x.type === 'campaign' && (!p.layer || x.id === p.layer)); if (!L) fail('no campaign layer in this map clip');
    const era = await eraFor(GW.pv(scn.year, 0)); if (era.src !== 'hist') await WRa().loadA1();
    const e = await addEv(c, L, p, era); if (p.camera) WRa().applyCameraKeys(scn, WRa().cameraKeys({ ...L, events: [e] }, scn, {}));
    GW.commit(label('حدث سيطرة')); GW.invalidate(); return plain(e);
  };
  // moveLeaderTo({id (map clip), layer (leader image layer id), city | lon,lat, start, dur, style:'direct'|'curve'|'route'|'via', via:[[lon,lat]]}) → move
  M.moveLeaderTo = async (p = {}) => {
    const c = mapClip(p.id); const L = c.map.scene.layers.find(x => x.id === p.layer) || c.map.scene.layers.filter(x => x.type === 'image').pop(); if (!L || L.type !== 'image') fail('leader layer not found: ' + p.layer);
    let to, name = p.name || ''; if (p.city) { const r = cityFor(p.city, null); to = [r.lon, r.lat]; name = name || r.a; } else if (p.lon != null) to = [+p.lon, +p.lat]; else fail('city or lon/lat required');
    const mv = WRa().addMove(L, { to, name, t: p.start, dur: p.dur || 3, style: p.style || 'curve', via: p.via });
    GW.commit(label('تحرك القائد إلى ' + name)); GW.invalidate(); if (GW.MapUI && GW.MapUI.render) try { GW.MapUI.render(); } catch (e) {} return plain(mv);
  };

  /* ----- sound effects ----- */
  M.listSfx = async ({ query, cat, limit = 50 } = {}) => {
    await GW.SFX.load(); const norm = (x) => GW.Atlas && GW.Atlas.Geo ? GW.Atlas.Geo.norm(x) : String(x || '').toLowerCase(); const n = query ? norm(query) : '';
    const items = (GW.SFX.list || []).filter(x => (!cat || x.cat === cat) && (!n || norm([x.id, x.ar, x.use, ...(x.tags || [])].join(' ')).includes(n)));
    return { categories: (GW.SFX.cats || []).map(c => ({ id: c.id, name: c.ar })), total: items.length, items: items.slice(0, limit).map(x => ({ id: x.id, name: x.ar, cat: x.cat, dur: x.dur, use: x.use, tags: x.tags })) };
  };
  M.addSfx = async ({ id, query, time, track } = {}) => {
    await GW.SFX.load(); let it = id && GW.SFX.list.find(x => x.id === id);
    if (!it && (query || id)) { const r = await M.listSfx({ query: query || id, limit: 1 }); it = r.items[0] && GW.SFX.list.find(x => x.id === r.items[0].id); }
    if (!it) fail('sound effect not found: ' + (id || query) + ' (see listSfx)');
    const s = seq(); const keepT = s.t; const row = parseTrack(track, 'a'); if (row && row.tt !== 'a') fail('sfx go on an audio track (A1, A2…)');
    const t0 = num(time, 'time') ?? s.t; let rw = row;
    if (!rw) { const d = +it.dur || 3; let ti = s.at.findIndex((tr, i) => !tr.lock && !s.clips.some(c => c.tt === 'a' && c.ti === i && c.start < t0 + d && c.start + c.dur > t0)); if (ti < 0) { ti = s.at.length; GW.ops.ensureTrack(s, 'a', ti); } rw = { tt: 'a', ti }; } // default: first free audio track (never overwrite dialogue / music)
    const before = snapshot(s); await GW.SFX.insert(it, t0, rw);
    const added = newIds(s, before); if (!added.length) fail('could not insert ' + it.id);
    GW.hist.labels[GW.hist.idx] = label('مؤثر صوتي: ' + it.ar); s.t = keepT; GW.bus.emit('time'); GW.bus.emit('hist');
    return added.map(clipInfo);
  };

  /* ----- transport / misc ----- */
  M.addMarker = ({ time, name, color, note } = {}) => { const s = seq(); const m = { id: GW.uid(), t: num(time, 'time') ?? s.t, name: name || 'علامة ' + (s.markers.length + 1), color: color || '#4e9a52' }; if (note) m.note = note; s.markers.push(m); GW.commit(label('إضافة علامة')); return { id: m.id, time: m.t, name: m.name }; };
  M.select = ({ ids = [] } = {}) => { GW.sel.clips = new Set((typeof ids === 'string' ? [ids] : ids).map(i => clipOf(i).id)); GW.bus.emit('selection'); return [...GW.sel.clips]; };
  M.seek = ({ time } = {}) => { GW.seek(num(time, 'time') || 0); return { playhead: r4(seq().t) }; };
  M.play = ({ rate = 1 } = {}) => { if (GW.pb.playing) GW.stop(); GW.play(+rate || 1); return { playing: true }; };
  M.stop = () => { GW.stop(); return { playing: false, playhead: r4(seq().t) }; };
  M.undo = () => { GW.hist.undo(); return { undo: GW.hist.labels[GW.hist.idx] }; };
  M.redo = () => { GW.hist.redo(); return { undo: GW.hist.labels[GW.hist.idx] }; };
  M.setSequence = ({ name, w, h, fps } = {}) => {
    const s = seq(); const W = w ? Math.max(16, Math.round(+w / 2) * 2) : s.w, Hh = h ? Math.max(16, Math.round(+h / 2) * 2) : s.h; const kx = W / s.w, ky = Hh / s.h;
    if (kx !== 1 || ky !== 1) for (const c of s.clips) if (c.motion) { const sc = (p) => { if (p.k) p.k.forEach(k => k.v = [k.v[0] * kx, k.v[1] * ky]); p.v = [p.v[0] * kx, p.v[1] * ky]; }; sc(c.motion.pos); if (['text', 'map', 'color', 'adjust', 'shape'].includes(c.kind)) { c.sw = W; c.sh = Hh; c.motion.anchor = GW.P([W / 2, Hh / 2]); } }
    if (name) s.name = String(name); s.w = W; s.h = Hh; if (fps) s.fps = +fps; GW.commit(label('إعدادات التسلسل')); GW.bus.emit('project');
    return M.getState({ clips: false, media: false }).sequence;
  };

  /* ----- project files ----- */
  const dirty = () => GW.hist.stack[GW.hist.idx] !== GW.hist.saved;
  M.saveProject = async ({ path } = {}) => {
    if (!window.gws) fail('saving needs the desktop app');
    if (path) { if (!/\.(qass|gwproj)$/i.test(path)) path += '.qass'; GW.prj.path = path; } else if (!GW.prj.path) fail('this project was never saved: pass path (e.g. C:\\Users\\me\\Documents\\QassQass\\project.qass)');
    const ok = await GW.saveProject(false); if (!ok) fail('save failed'); return { path: GW.prj.path };
  };
  M.openProject = async ({ path, force } = {}) => {
    if (!window.gws) fail('needs the desktop app'); if (!path) fail('path required');
    if (dirty() && !force) fail('the current project has unsaved changes: save it first or pass force:true');
    await GW.loadProjectData(await gws.readText(path), path); const h = document.getElementById('home'); if (h) h.remove();
    return M.getState({ media: true });
  };
  M.newProject = async ({ force, w, h, fps, name } = {}) => {
    if (dirty() && !force) fail('the current project has unsaved changes: save it first or pass force:true');
    GW.stop(); for (const id in GW.rt.v) GW.Media.dropVid(id);
    GW.prj = GW.newProject(); if (name) GW.prj.name = name; const s = GW.seq(); if (w) s.w = +w; if (h) s.h = +h; if (fps) s.fps = +fps;
    GW.sel.clips.clear(); GW.hist.reset('مشروع جديد'); GW.bus.emit('project'); GW.bus.emit('media'); GW.invalidate(); const hm = document.getElementById('home'); if (hm) hm.remove();
    return M.getState({ clips: false });
  };

  /* ----- export ----- */
  const job = { running: false, progress: 0, message: '', result: null, cancel: false, out: null };
  M.exportStatus = () => ({ running: job.running, progress: r4(job.progress), message: String(job.message || '').replace(/<[^>]+>/g, ''), out: job.out, result: job.result });
  M.cancelExport = () => { job.cancel = true; return M.exportStatus(); };
  M['export'] = async (p = {}) => {
    if (!window.gws) fail('export needs the desktop app'); if (job.running) fail('an export is already running (exportStatus / cancelExport)');
    const s = seq(); if (GW.seqDur(s) <= 0) fail('the sequence is empty');
    const st = UI().exportState || {}; const fmt = p.fmt || p.format || 'mp4';
    const ext = { mp4: 'mp4', mp4h265: 'mp4', mov: 'mov', webm: 'webm', png: 'png', jpg: 'jpg', gif: 'gif', wav: 'wav', mp3: 'mp3' }[fmt] || fail('unknown fmt ' + fmt);
    let out = p.out; if (!out) { const P = await gws.paths(); out = (st.outDir || P.renders) + P.sep + (s.name || 'export').replace(/[\\/:*?"<>|]+/g, '_') + '.' + ext; }
    const o = { fmt, res: p.res != null ? String(p.res) : 'seq', fps: p.fps != null ? String(p.fps) : 'seq', q: p.quality || p.q || 'high', range: p.range || 'all', audio: p.audio === false || p.audio === 0 ? 0 : 1, alpha: p.alpha ? 1 : 0, out };
    GW.stop(); Object.assign(job, { running: true, progress: 0, message: 'بدء التصدير', result: null, cancel: false, out });
    const run = UI().runExport(s, o, (pr, msg) => { job.progress = pr; job.message = msg; }, () => job.cancel, null)
      .then(r => { job.result = { ok: !!r.ok, cancelled: !!r.cancelled, out: r.out || out, error: r.ok ? undefined : (r.error || String(r.log || '').slice(-800)) }; return job.result; })
      .catch(e => (job.result = { ok: false, error: e.message })).finally(() => { job.running = false; });
    if (p.wait === false) return M.exportStatus();
    const r = await run; if (!r.ok && !r.cancelled) fail('export failed: ' + r.error); return r;
  };

  /* ----- frame capture (lets the assistant SEE the result) ----- */
  M.captureFrame = async ({ time, maxWidth = 960 } = {}) => {
    const s = seq(); const t = num(time, 'time') ?? s.t; const k = Math.min(1, Math.max(64, +maxWidth || 960) / s.w);
    GW.stop(); const was = GW.Render.exporting; GW.Render.exporting = true;
    try {
      await GW.Render.prepareExportFrame(s, t, k);
      const acc = GW.Render.frame(s, t, { scale: k, exporting: true }); const w = acc.w, h = acc.h;
      const buf = GW.R.readRGBA(w, h, acc, null, false); GW.R.free(acc);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), w, h), 0, 0);
      const url = cv.toDataURL('image/png');
      return { mime: 'image/png', base64: url.slice(url.indexOf(',') + 1), width: w, height: h, time: r4(t) };
    } finally { GW.Render.exporting = was; GW.invalidate(); }
  };

  /* ----- smart audio (GW.AudioTools in js/audio_tools.js) ----- */
  const AT = () => GW.AudioTools || fail('audio tools not loaded');
  const audioTargets = (ids, track, def) => {
    const s = seq(); if (typeof ids === 'string') ids = [ids];
    if (ids && ids.length) { const cs = AT().audioClips(s, ids.map(clipOf)); if (!cs.length) fail('no audio in clips ' + ids.join(', ')); return cs; }
    const row = parseTrack(track != null ? track : def, 'a'); if (!row) fail('ids or track required'); if (row.tt !== 'a') fail('need an audio track (A1, A2…)');
    const cs = AT().trackClips(s, row.ti); if (!cs.length) fail('no audio clips on ' + trackName('a', row.ti)); return cs;
  };
  M.removeSilence = async ({ ids, track, threshold = -40, minSilence = 0.5, padding = 0.1, allTracks = false, dryRun = false } = {}) =>
    AT().removeSilence({ clips: audioTargets(ids, track, 'A1'), threshold: num(threshold, 'threshold'), minSilence: num(minSilence, 'minSilence'), padding: num(padding, 'padding'), allTracks: !!allTracks, dryRun: !!dryRun, label: label('حذف الصمت') });
  M.autoDuck = async ({ music, musicIds, voice, voiceIds, duck = 12, threshold = -35, attack = 0.2, release = 0.5, hold = 0.3 } = {}) =>
    AT().autoDuck({ music: audioTargets(musicIds, music, 'A2'), voice: audioTargets(voiceIds, voice, 'A1'), duck: num(duck, 'duck'), threshold: num(threshold, 'threshold'), attack: num(attack, 'attack'), release: num(release, 'release'), hold: num(hold, 'hold'), label: label('خفض الموسيقى تلقائياً') });
  M.beatMarkers = async ({ id, every = 1, replace = true, dryRun = false } = {}) => {
    const c = AT().audioClips(seq(), [clipOf(id)])[0] || fail('clip has no audio: ' + id);
    return AT().beatMarkers({ clip: c, every: num(every, 'every'), replace: replace !== false, dryRun: !!dryRun, label: label('علامات الإيقاع') });
  };
  M.enhanceAudio = async ({ id, ids, denoise = 12, highpass = 80, loudness = -14 } = {}) =>
    AT().enhance({ clips: audioTargets(ids || (id ? [id] : null)), denoise: num(denoise, 'denoise') || 0, highpass: num(highpass, 'highpass') || 0, loudness: loudness == null || loudness === false ? null : num(loudness, 'loudness'), label: label('تحسين الصوت') });
  M.normalizeLoudness = async ({ id, ids, target = -14 } = {}) =>
    AT().enhance({ clips: audioTargets(ids || (id ? [id] : null)), denoise: 0, highpass: 0, loudness: num(target, 'target') ?? -14, label: label('توحيد مستوى الصوت') });
  M.restoreAudio = ({ id, ids } = {}) => AT().restore({ clips: audioTargets(ids || (id ? [id] : null)), label: label('استعادة الصوت الأصلي') });

  /* ----- catalogs ----- */
  const pdesc = (d) => { const o = { key: d.k, name: d.n, type: d.t, default: d.def }; if (d.min != null) { o.min = d.min; o.max = d.max; } if (d.opts) o.options = d.opts.map(x => x[0]); if (d.unit) o.unit = d.unit.trim(); return o; };
  M.listEffects = () => ({
    video: Object.entries(GW.FX).map(([k, v]) => ({ type: k, name: v.n, category: v.cat, params: v.p.map(pdesc) })),
    audio: Object.entries(GW.AFX).map(([k, v]) => ({ type: k, name: v.n, params: v.p.map(pdesc) })),
    looks: Object.entries(LOOKS).map(([k, n]) => ({ type: k, name: n, note: 'preset: several effects / keyframes at once' }))
  });
  M.listTransitions = () => ({ video: Object.entries(GW.TRANS).map(([k, v]) => ({ type: k, name: v.n, category: v.cat })), audio: Object.entries(GW.ATRANS).map(([k, v]) => ({ type: k, name: v.n })) });
  /* ----- motion graphics templates (js/mg.js) + keyframe easing (graph editor) ----- */
  M.listTemplates = () => GW.MG.list.map(T => ({ id: T.id, name: T.n, category: T.cat, dur: T.dur, fields: T.fields.map(f => ({ key: f.k, name: f.n, type: f.t, default: f.def, min: f.min, max: f.max, options: f.opts ? f.opts.map(o => o[0]) : undefined })) }));
  M.addTemplate = (p = {}) => {
    const T = GW.MG.get(p.id || p.template); if (!T) fail('unknown template "' + (p.id || p.template) + '" (see listTemplates)');
    const fields = p.fields || {}; for (const k in fields) { const fd = T.fields.find(f => f.k === k); if (!fd) fail('unknown field "' + k + '" for ' + T.id + ' (fields: ' + T.fields.map(f => f.k).join(', ') + ')'); if (fd.t === 'num') fields[k] = num(fields[k], k); else fields[k] = String(fields[k]); }
    const s = seq(); const row = parseTrack(p.track); if (row && row.tt !== 'v') fail('templates go on a video track');
    const c = GW.MG.add(T.id, { start: num(p.start, 'start') ?? s.t, dur: num(p.dur, 'dur') || T.dur, ti: row ? row.ti : undefined, track: row ? row.ti : undefined, fields, label: label('قالب ' + T.n) });
    GW.invalidate(); return { ...clipInfo(c), template: T.id, fields: c.text.mg.f };
  };
  M.setKeyEase = ({ id, path, index, time, ease, influence, in: hin, out: hout } = {}) => {
    const c = clipOf(id); const R = resolve(c, path); const p = R.obj; if (!isParam(p) || !p.k || !p.k.length) fail(R.path + ' has no keyframes');
    let ks; if (index === 'all') ks = p.k.slice(); else if (index != null) { ks = [p.k[+index]]; if (!ks[0]) fail('keyframe index out of range (0…' + (p.k.length - 1) + ')'); }
    else if (time != null) { const lt = num(time, 'time') - c.start; const k = p.k.reduce((a, b) => Math.abs(b.t - lt) < Math.abs(a.t - lt) ? b : a); if (Math.abs(k.t - lt) > .5 / seq().fps + 1e-6) fail('no keyframe at ' + time); ks = [k]; }
    else fail('index, time or index:"all" required');
    const EASES = ['linear', 'hold', 'ease', 'easeIn', 'easeOut', 'bezier'];
    const hv = (h, n) => { if (h == null) return null; const a = Array.isArray(h) ? h : [h.influence != null ? h.influence / 100 : 1 / 3, h.speed != null ? h.speed : h.y]; if (a.length !== 2 || !a.every(x => isFinite(+x))) fail(n + ': [influence 0…1, progress] or {influence %, y}'); return [clamp01(+a[0]), +a[1]]; };
    const clamp01 = v => Math.max(0, Math.min(1, v));
    for (const k of ks) {
      if (ease) { if (!EASES.includes(ease)) fail('ease: ' + EASES.join(' | ')); if (ease !== 'bezier') { k.e = ease; delete k.bi; delete k.bo; } }
      if (influence != null && ease && ease !== 'linear' && ease !== 'hold') { const f = clamp01(+influence / 100); if (ease !== 'easeOut') k.bi = [f, 0]; if (ease !== 'easeIn') k.bo = [f, 0]; }
      const hi = hv(hin, 'in'), ho = hv(hout, 'out'); if (hi) k.bi = hi; if (ho) k.bo = ho;
    }
    GW.commit(label('استيفاء المفاتيح')); GW.invalidate(); if (GW.FXC && GW.FXC.render) try { GW.FXC.render(); } catch (e) {}
    return { id: c.id, path: R.path, keys: p.k.map(k => ({ time: r4(c.start + k.t), value: plain(k.v), ease: k.e || 'linear', in: k.bi ? k.bi.map(r4) : undefined, out: k.bo ? k.bo.map(r4) : undefined })) };
  };
  /* ----- map camera keyframes (atlas/camera.js v2 keys; time = sequence seconds) ----- */
  const camClip = (id) => { const c = clipOf(id); if (c.kind !== 'map' || !c.map || !c.map.scene || !c.map.scene.cam) fail('not a map clip: ' + id); return c; };
  const camKeyInfo = (c, k) => { const Cm = A().Cam; const o = { time: r4(c.start + k.t - (c.in || 0)), groups: Cm.GLIST.filter(g => Cm.defines(k, g)), interp: Cm.interpOf(k), ease: Cm.easeKind(k), roving: !!k.roving };
    for (const f of Cm.FIELDS) if (k[f] != null || Cm.isLegacy(k)) o[f] = r4(Cm.keyVal(k, f, c.map.scene.cam)); if (k.ease && typeof k.ease === 'object') { o.in = Cm.handle(k, 'in').map(r4); o.out = Cm.handle(k, 'out').map(r4); } return o; };
  M.listCameraKeys = ({ id } = {}) => { const c = camClip(id); const cam = c.map.scene.cam; return { id: c.id, mode: c.map.scene.mode, animated: A().Cam.GLIST.filter(g => A().Cam.animated(cam, g)), keys: (cam.keys || []).slice().sort((a, b) => a.t - b.t).map(k => camKeyInfo(c, k)) }; };
  // setCameraKey({id, time, lon, lat, zoom|altitudeKm, tilt, heading, roll, fov, offX, offY, interp:'fly'|'bezier'|'linear'|'hold', ease:'ease'|'easeIn'|'easeOut'|'linear', roving, in:[x,y], out:[x,y]})
  M.setCameraKey = ({ id, time, interp, ease, roving, in: hin, out: hout, altitudeKm, ...vals } = {}) => {
    const c = camClip(id); const Cm = A().Cam; const scn = c.map.scene; const s = seq();
    const t = (time == null ? s.t : num(time, 'time')) - c.start; if (t < -1e-6 || t > c.dur + 1e-6) fail('time outside the map clip');
    const kt = Math.max(0, Math.min(c.dur, GW.snapFrame(t, s.fps))) + (c.in || 0);
    const v = {}; for (const f of Cm.FIELDS) if (vals[f] != null) v[f] = num(vals[f], f);
    if (altitudeKm != null) { const cur = Cm.atRaw(scn.cam, kt, scn.mode); v.zoom = Cm.zoomForAlt(num(altitudeKm, 'altitudeKm'), v.lat != null ? v.lat : cur.lat, v.fov != null ? v.fov : cur.fov); }
    if (!Object.keys(v).length) { const cur = Cm.atRaw(scn.cam, kt, scn.mode); for (const g of (Cm.animated(scn.cam) ? Cm.GLIST.filter(q => Cm.animated(scn.cam, q)) : Cm.GLIST)) for (const f of Cm.GROUPS[g]) v[f] = cur[f]; }
    const ks = Cm.setKey(scn.cam, kt, v, { eps: .5 / s.fps, mode: scn.mode });
    for (const k of ks) {
      if (interp) { if (!['fly', 'bezier', 'linear', 'hold'].includes(interp)) fail('interp: fly | bezier | linear | hold'); Cm.setInterp(k, interp); }
      if (ease) { if (!['ease', 'easeIn', 'easeOut', 'linear'].includes(ease)) fail('ease: ease | easeIn | easeOut | linear'); Cm.setInterp(k, ease); }
      if (roving != null) { if (roving) k.roving = 1; else delete k.roving; }
      for (const [h, side] of [[hin, 'in'], [hout, 'out']]) if (h != null) { if (!Array.isArray(h) || h.length !== 2) fail(side + ': [influence 0…1, progress]'); if (!k.ease || typeof k.ease !== 'object') k.ease = Cm.easyEase(); k.ease[side] = [Math.max(0, Math.min(1, +h[0])), +h[1]]; }
    }
    Cm.rove(scn.cam, scn.mode); GW.commit(label('مفتاح كاميرا')); GW.invalidate(); GW.bus.emit('camkeys'); if (GW.MapUI && GW.MapUI.render) try { GW.MapUI.render(); } catch (e) {}
    return M.listCameraKeys({ id: c.id });
  };
  // deleteCameraKey({id, time, group?}) or ({id, all:true})
  M.deleteCameraKey = ({ id, time, group, all } = {}) => {
    const c = camClip(id); const Cm = A().Cam; const cam = c.map.scene.cam;
    if (all) { Cm.modernize(cam); for (const g of Cm.GLIST) if (Cm.animated(cam, g)) Cm.setAnimated(cam, g, false, Math.max(0, seq().t - c.start) + (c.in || 0), c.map.scene.mode); cam.keys = []; }
    else {
      if (time == null) fail('time required (or all:true)'); if (group != null && !Cm.GROUPS[group]) fail('group: ' + Cm.GLIST.join(' | '));
      const kt = num(time, 'time') - c.start + (c.in || 0); const ks = Cm.keysAt(cam, kt, .5 / seq().fps + 1e-6).filter(k => !group || Cm.defines(k, group)); if (!ks.length) fail('no camera key at ' + time);
      for (const k of ks) Cm.delKey(cam, k, group || undefined);
    }
    Cm.rove(cam, c.map.scene.mode); GW.commit(label('حذف مفتاح كاميرا')); GW.invalidate(); GW.bus.emit('camkeys'); if (GW.MapUI && GW.MapUI.render) try { GW.MapUI.render(); } catch (e) {}
    return M.listCameraKeys({ id: c.id });
  };
  M.listMethods = () => Object.keys(M).sort();
  M.batch = async ({ calls = [], stopOnError = true } = {}) => {
    const out = [];
    for (const c of calls) { try { out.push({ ok: true, result: await call(c.method, c.params || {}, true) }); } catch (e) { out.push({ ok: false, error: e.message }); if (stopOnError) break; } }
    return out;
  };

  /* ---------------- dispatcher + activity badge ---------------- */
  let busy = 0, lastCall = 0;
  async function call(method, params, nested) {
    const f = Object.prototype.hasOwnProperty.call(M, method) ? M[method] : null;
    if (!f) fail('unknown method "' + method + '". Methods: ' + Object.keys(M).sort().join(', '));
    if (params != null && (typeof params !== 'object' || Array.isArray(params))) fail('params must be an object');
    if (!nested) { busy++; lastCall = Date.now(); badge(); }
    try { return plain(await f(params || {})); }
    finally { if (!nested) { busy--; badge(); } }
  }
  // applyLut({id|ids, slot:'creative'|'input', look|path, intensity, remove}) → lut.js · trackPoint({id, x, y, t, feat, search, dir, apply, target, mask}) → track.js
  M.applyLut = (p) => { if (!GW.LUT) fail('LUT module not loaded'); return GW.LUT.api(p); };
  // colour tools (color.js): setCurves({id, curves:{master|r|g|b|hueSat|hueHue|lumaSat:[[x,y]…]}, intensity, reset}) · colorMatch({id, refTime, time})
  // autoColor({id, time, wb=true, levels=true}) · setHslSecondary({id, on, color|hue, hueW, sat:[lo,hi], lum:[lo,hi], soft, denoise, show, temp, tint, contrast, saturation, exposure})
  M.setCurves = (p) => { if (!GW.Color) fail('colour module not loaded'); return GW.Color.setCurvesApi(p); };
  M.colorMatch = (p) => { if (!GW.Color) fail('colour module not loaded'); return GW.Color.matchApi(p); };
  M.autoColor = (p) => { if (!GW.Color) fail('colour module not loaded'); return GW.Color.autoApi(p); };
  M.setHslSecondary = (p) => { if (!GW.Color) fail('colour module not loaded'); return GW.Color.hslApi(p); };
  M.trackPoint = (p) => { if (!GW.Track) fail('tracker module not loaded'); return GW.Track.api(p); };
  GW.API = { version: VERSION, methods: M, call, parseTrack, clipInfo };

  function badge() {
    const st = document.getElementById('status'); if (!st) return; let b = document.getElementById('stAi');
    if (!b) { b = document.createElement('span'); b.id = 'stAi'; b.style.cssText = 'cursor:pointer'; b.title = 'المساعد الذكي — انقر للإعدادات'; b.onclick = () => UI().assistantSettings(); st.insertBefore(b, document.getElementById('stGpu')); }
    b.hidden = !AI.enabled; b.innerHTML = (GW.ico ? GW.ico('wand', 12) + ' ' : '') + (busy ? 'المساعد يعمل…' : 'المساعد متصل'); b.style.display = 'inline-flex'; b.style.alignItems = 'center'; b.style.gap = '4px';
    b.style.color = busy ? 'var(--accent,#ff6a2b)' : 'var(--text2)';
  }

  /* ---------------- settings + bridge to the main process ---------------- */
  const AI = { enabled: false, info: null };
  const bridge = () => window.gwsApi || null;
  async function refresh() { const B = bridge(); if (!B) return; try { const st = await B.status(); AI.enabled = !!st.enabled; AI.info = st; } catch (e) {} badge(); }
  if (bridge()) {
    bridge().onCall(async (id, method, params) => {
      let res; try { res = { ok: true, result: await call(method, params) }; } catch (e) { res = { ok: false, error: e && e.message ? e.message : String(e) }; }
      try { bridge().reply(id, res); } catch (e) { bridge().reply(id, { ok: false, error: 'result is not serialisable: ' + e.message }); }
    });
    GW.bus.on('ready', refresh);
  }

  UI().assistantSettings = async () => {
    const B = bridge(); await refresh(); const st = AI.info || {};
    const body = document.createElement('div');
    const cfg = (i) => JSON.stringify({ mcpServers: { qassqass: { command: i.exePath || 'node', args: [i.mcpScript || 'qassqass-mcp.js'], env: i.exePath ? { ELECTRON_RUN_AS_NODE: '1' } : {} } } }, null, 2);
    const draw = () => {
      const i = AI.info || {};
      body.innerHTML = `<label style="display:flex;gap:8px;align-items:center;font-weight:600;margin-bottom:10px"><input type="checkbox" data-a="on" ${AI.enabled ? 'checked' : ''} ${B ? '' : 'disabled'}> السماح للمساعد الذكي بالتحكم</label>
        <p>عند التفعيل يفتح البرنامج واجهة تحكم محلية على هذا الجهاز فقط (127.0.0.1) محمية برمز سري، فيستطيع Claude (عبر MCP) إضافة المقاطع والنصوص والخرائط والمؤثرات وتعديلها وتصدير الفيديو. كل تعديل يظهر في «السجل» ويمكن التراجع عنه.</p>
        ${!B ? '<p style="color:var(--yellow)">متاح في نسخة سطح المكتب فقط.</p>' : ''}
        ${AI.enabled && i.port ? `<div class="kv" style="margin:6px 0;color:var(--text2)">يعمل على المنفذ ${i.port} — ملف الاتصال: <span dir="ltr">${GW.esc(i.apiFile || '')}</span></div>` : ''}
        <div class="sec-t" style="margin-top:10px">إضافته إلى Claude Desktop</div>
        <p>افتح Claude Desktop، ثم Settings &gt; Developer &gt; Edit Config، ثم أضف ما يلي إلى الملف <span dir="ltr">claude_desktop_config.json</span> وأعد تشغيل Claude:</p>
        <textarea class="inp" readonly dir="ltr" rows="9" style="width:100%;height:auto;font:11px var(--f-mono);padding:6px" data-a="cfg">${GW.esc(cfg(i))}</textarea>
        <div style="display:flex;gap:6px;margin-top:6px"><button class="btn sm" data-a="copy">نسخ الإعداد</button>${i.mcpDir ? '<button class="btn sm" data-a="dir">فتح مجلد MCP</button>' : ''}</div>`;
      const on = body.querySelector('[data-a=on]'); if (on) on.onchange = async () => { try { AI.info = await B.enable(on.checked); AI.enabled = !!AI.info.enabled; GW.toast(AI.enabled ? 'تم السماح للمساعد الذكي بالتحكم' : 'تم إيقاف تحكم المساعد الذكي'); } catch (e) { GW.toast('تعذر التفعيل: ' + e.message, 'err'); } badge(); draw(); };
      body.querySelector('[data-a=copy]').onclick = async () => { const ta = body.querySelector('[data-a=cfg]'); try { await navigator.clipboard.writeText(ta.value); GW.toast('تم النسخ'); } catch (e) { ta.select(); document.execCommand('copy'); GW.toast('تم النسخ'); } };
      const d = body.querySelector('[data-a=dir]'); if (d) d.onclick = () => window.gws && gws.openPath(i.mcpDir);
    };
    draw(); void st;
    GW.modal({ title: 'المساعد الذكي (Claude)', width: 620, body, buttons: [{ label: 'إغلاق', primary: true }] });
  };

  // menu entries (Edit ▸ … and Help ▸ …) without touching app.js
  const addMenu = (name, items) => { const e = GW.MENUS && GW.MENUS.find(m => m[0] === name); if (!e) return; const f = e[1]; e[1] = () => [...f(), '-', ...items]; };
  addMenu('تحرير', [{ label: 'المساعد الذكي (Claude)…', action: () => UI().assistantSettings() }]);
  addMenu('مساعدة', [{ label: 'التحكم بواسطة Claude (MCP)…', action: () => UI().assistantSettings() }]);
})();
