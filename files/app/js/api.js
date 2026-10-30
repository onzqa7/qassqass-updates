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
   addMapLayer({id, type, …props, countries:[names], from, to:[names], place})   → layer   (country/invasion/arrow/front/route/marker/label/range/date/title/legend/inset/data)
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
    const o = {}; for (const k in p) if (!['id', 'type', 'countries', 'from', 'to', 'place'].includes(k)) o[k] = p[k];
    if (p.countries) o.keys = p.countries.map(n => countryKey(n, era));
    if (p.from) o.from = countryKey(p.from, era); if (p.to) o.to = (Array.isArray(p.to) ? p.to : [p.to]).map(n => countryKey(n, era));
    if (p.place) { const G = Geo(); G.loadAdmin1 && G.loadAdmin1(); const r = G.search(String(p.place), G.features(era, 0), 'ar', era, 5)[0]; if (!r) fail('place not found: ' + p.place); o.lon = r.lon; o.lat = r.lat; if (o.text == null && (type === 'marker' || type === 'label' || type === 'range')) o.text = r.name; }
    if (p.pts) o.pts = p.pts.map(pt => Array.isArray(pt) ? [+pt[0], +pt[1]] : fail('pts: [[lon,lat],…]'));
    const L = S.newLayer(type, o); scn.layers.push(L);
    GW.commit(label('طبقة خريطة: ' + S.LAYERS[type].ar)); GW.invalidate(); if (GW.MapUI && GW.MapUI.render) try { GW.MapUI.render(); } catch (e) {}
    return plain(L);
  };
  M.listMapStyles = () => { const S = A().Scene; return { styles: S.STYLE_ORDER.map(k => ({ id: k, name: S.STYLES[k].ar })), layers: Object.entries(S.LAYERS).map(([k, v]) => ({ type: k, name: v.ar })), modes: ['globe', 'flat'], arrows: ['military', 'line', 'dashed', 'double'] }; };

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
    if (kx !== 1 || ky !== 1) for (const c of s.clips) if (c.motion) { const sc = (p) => { if (p.k) p.k.forEach(k => k.v = [k.v[0] * kx, k.v[1] * ky]); p.v = [p.v[0] * kx, p.v[1] * ky]; }; sc(c.motion.pos); if (['text', 'map', 'color', 'adjust'].includes(c.kind)) { c.sw = W; c.sh = Hh; c.motion.anchor = GW.P([W / 2, Hh / 2]); } }
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
