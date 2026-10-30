'use strict';
/* Smart audio tools (أدوات الصوت الذكية):
   - removeSilence: detect silent ranges on audio clips (threshold dB / minimum length / padding) and extract them with ripple,
     cutting the linked video at the same points so picture and sound stay in sync (one undo step).
   - autoDuck: volume keyframes on music clips that dip while the voice track is speaking (attack / release ramps).
   - beatMarkers: tempo + beat grid of a music clip → sequence markers (the timeline already snaps to markers).
   - enhance: FFmpeg bake (highpass / afftdn / two-pass loudnorm) into a NEW wav that replaces the clip's source (original kept, undoable).
   Analysis uses the 100/s waveform peaks of media.js (disk cached) and, for beats, the decoded AudioBuffer. */
(function () {
  const AT = GW.AudioTools = {};
  const api = () => window.gws;
  const RATE = 100; // peaks per second (media.js: 480 samples @ 48 kHz)
  const tr = (s) => (GW.lang === 'en' && window.__EN_UI && window.__EN_UI[s]) || s; // GW.T is the playhead getter (app.js), so look the dictionary up directly
  const tf = (s, o = {}) => tr(s).replace(/\{(\w+)\}/g, (_, k) => (o[k] != null ? o[k] : ''));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const lin = (db) => Math.pow(10, db / 20);
  const fail = (m) => { throw new Error(m); };
  const cfg = (k, d) => { try { return Object.assign({}, d, JSON.parse(localStorage.getItem('gws.at.' + k) || '{}')); } catch (e) { return Object.assign({}, d); } };
  const saveCfg = (k, o) => { try { localStorage.setItem('gws.at.' + k, JSON.stringify(o)); } catch (e) {} };

  /* ---------------- interval helpers ---------------- */
  const union = (list) => { const a = list.filter(x => x[1] > x[0]).sort((p, q) => p[0] - q[0]); const out = []; for (const x of a) { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); } return out; };
  const subtract = (dom, cut) => { const out = []; for (const [a, b] of dom) { let cur = a; for (const [c, d] of cut) { if (d <= cur || c >= b) continue; if (c > cur) out.push([cur, c]); cur = Math.max(cur, d); } if (cur < b) out.push([cur, b]); } return out; };
  AT._iv = { union, subtract };

  /* ---------------- targets ---------------- */
  const hasAudio = (c) => { if (c.tt !== 'a' || !c.media) return false; const m = GW.media(c.media); return !!(m && (m.hasAudio || m.kind === 'audio') && !m.offline); };
  AT.audioOf = (s, c) => (c.tt === 'a' ? [c] : GW.linked(s, c).filter(x => x.tt === 'a'));
  AT.audioClips = (s, clips) => { const set = new Set(); for (const c of clips) AT.audioOf(s, c).forEach(a => set.add(a)); return [...set].filter(hasAudio); };
  AT.trackClips = (s, ti) => GW.trackClips(s, 'a', ti).filter(hasAudio);
  AT.selected = (s) => AT.audioClips(s, [...GW.sel.clips].map(id => GW.clipById(id, s)).filter(Boolean));

  /* ---------------- analysis ---------------- */
  // waveform envelope of a media (max |x| per 10 ms, 0..1)
  AT.envelope = async (m) => {
    const M = GW.Media; const r = M.ensureRt(m);
    for (let i = 0; i < 600 && r.status !== 'ready' && r.status !== 'error' && r.status !== 'offline'; i++) await GW.sleep(100);
    for (let i = 0; i < 1200 && !r._peaks; i++) {
      if (!r._pkBusy) { try { await M.loadPeaks(m); } catch (e) {} if (r._peaks || !r._pkBusy) break; }
      await GW.sleep(100);
    }
    if (r._peaks && r._peaks.length) return r._peaks;
    const ab = await M.loadAudio(m); if (!ab) fail('no audio: ' + m.name);
    const n = Math.ceil(ab.duration * RATE), out = new Float32Array(n), step = ab.sampleRate / RATE, chs = [];
    for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) chs.push(ab.getChannelData(c));
    for (let i = 0; i < n; i++) { let mx = 0; const s0 = Math.floor(i * step), s1 = Math.min(chs[0].length, Math.floor((i + 1) * step)); for (const d of chs) for (let k = s0; k < s1; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > mx) mx = v; } out[i] = mx; }
    return out;
  };
  // timeline ranges of clip c where its audio is at or above thrDb
  AT.loudRanges = (c, env, thrDb) => {
    const sp = c.speed || 1, L = lin(thrDb), out = [];
    const i0 = Math.max(0, Math.floor(c.in * RATE)), i1 = Math.min(env.length, Math.ceil((c.in + c.dur * sp) * RATE));
    const tl = (i) => GW.clamp(c.start + (i / RATE - c.in) / sp, c.start, c.start + c.dur);
    let a = -1;
    for (let i = i0; i < i1; i++) { const loud = env[i] >= L; if (loud && a < 0) a = i; else if (!loud && a >= 0) { out.push([tl(a), tl(i)]); a = -1; } }
    if (a >= 0) out.push([tl(a), tl(i1)]);
    return out;
  };

  /* ---------------- 1. remove silences ---------------- */
  // silent ranges (timeline seconds, frame-snapped) common to all target clips
  AT.detectSilences = async (s, clips, o = {}) => {
    const thr = o.threshold ?? -40, minSil = Math.max(0.05, o.minSilence ?? 0.5), pad = Math.max(0, o.padding ?? 0.1), fps = s.fps || 30;
    if (!clips.length) return [];
    const dom = union(clips.map(c => [c.start, c.start + c.dur]));
    const loud = [];
    for (const c of clips) { const env = await AT.envelope(GW.media(c.media)); loud.push(...AT.loudRanges(c, env, thr)); }
    const sil = subtract(dom, union(loud)).filter(([a, b]) => b - a >= minSil - 1e-6);
    const out = [];
    for (const [a, b] of sil) {
      const edgeA = dom.some(d => Math.abs(d[0] - a) < 1e-6), edgeB = dom.some(d => Math.abs(d[1] - b) < 1e-6);
      const a2 = Math.round((edgeA ? a : a + pad) * fps) / fps, b2 = Math.round((edgeB ? b : b - pad) * fps) / fps;
      if (b2 - a2 >= 1 / fps - 1e-6) out.push([a2, b2]);
    }
    return union(out);
  };
  // tracks rippled by a silence cut: the target audio tracks + tracks of their linked clips (or every unlocked track)
  AT.cutTracks = (s, clips, all) => {
    const unlocked = ([tt, ti]) => !(s[tt + 't'][ti] || {}).lock;
    if (all) return GW.ops.allTracks(s).filter(unlocked);
    const keys = new Set(); for (const c of clips) { keys.add(c.tt + ':' + c.ti); GW.linked(s, c).forEach(l => keys.add(l.tt + ':' + l.ti)); }
    return [...keys].map(k => { const [tt, ti] = k.split(':'); return [tt, +ti]; }).filter(unlocked);
  };
  // extract ranges (descending) on tracks; pieces of one linked group stay linked pairwise
  AT.extractRanges = (s, ranges, tracks, moveMarkers) => {
    const sorted = [...ranges].sort((a, b) => b[0] - a[0]);
    for (const [a, b] of sorted) {
      for (const [tt, ti] of tracks) GW.ops.clear(s, tt, ti, a, b);
      GW.ops.rippleClose(s, a, b, tracks);
      const d = b - a; if (moveMarkers) s.markers = s.markers.filter(m => !(m.t >= a + 1e-6 && m.t < b - 1e-6)); if (moveMarkers) for (const m of s.markers) if (m.t >= b - 1e-6) m.t -= d;
      if (moveMarkers && s.inP != null && s.inP >= b) s.inP -= d; if (moveMarkers && s.outP != null && s.outP >= b) s.outP -= d;
    }
    const fps = s.fps || 30; const groups = {};
    for (const c of s.clips) { c.start = Math.max(0, Math.round(c.start * fps * 1000) / (fps * 1000)); if (c.link) (groups[c.link] = groups[c.link] || []).push(c); }
    for (const id in groups) {
      const g = groups[id]; if (g.length <= 2 && new Set(g.map(c => c.tt)).size === g.length) continue;
      const by = {}; for (const c of g) { const k = Math.round(c.start * fps); (by[k] = by[k] || []).push(c); }
      let first = true; for (const k in by) { const nid = first ? id : GW.uid(); first = false; by[k].forEach(c => c.link = nid); }
    }
  };
  AT.removeSilence = async (o = {}) => {
    const s = o.seq || GW.seq(); const clips = o.clips || [];
    if (!clips.length) fail(tf('لا توجد مقاطع صوتية للتحليل'));
    const ranges = await AT.detectSilences(s, clips, o);
    const total = ranges.reduce((t, [a, b]) => t + b - a, 0);
    const res = { count: ranges.length, removed: r3(total), ranges: ranges.map(([a, b]) => [r3(a), r3(b)]) };
    if (o.dryRun || !ranges.length) return res;
    const tracks = AT.cutTracks(s, clips, !!o.allTracks); res.tracks = tracks.map(([tt, ti]) => (tt === 'v' ? 'V' : 'A') + (ti + 1));
    GW.stop && GW.stop();
    AT.extractRanges(s, ranges, tracks, !!o.allTracks); // markers / in-out follow the cut only when every track ripples
    GW.sel.clips.clear(); GW.commit(o.label || 'حذف الصمت'); GW.invalidate(); GW.bus.emit('selection');
    return res;
  };

  /* ---------------- 2. auto-ducking ---------------- */
  AT.voiceRanges = async (voice, thr, hold) => {
    const loud = [];
    for (const c of voice) { const env = await AT.envelope(GW.media(c.media)); loud.push(...AT.loudRanges(c, env, thr)); }
    let u = union(loud.map(([a, b]) => [a, b + hold])).map(([a, b]) => [a, b - hold]); // bridge pauses shorter than `hold`
    return u.filter(([a, b]) => b - a >= 0.05);
  };
  AT.autoDuck = async (o = {}) => {
    const s = o.seq || GW.seq(); const music = o.music || [], voice = o.voice || [];
    if (!music.length) fail(tf('لا توجد مقاطع موسيقى'));
    if (!voice.length) fail(tf('لا توجد مقاطع صوت للكلام'));
    const duck = -Math.abs(o.duck ?? 12), thr = o.threshold ?? -35, att = Math.max(0.01, o.attack ?? 0.2), rel = Math.max(0.01, o.release ?? 0.5), hold = Math.max(0, o.hold ?? 0.3);
    const vset = new Set(voice.map(c => c.id)); const mus = music.filter(c => !vset.has(c.id));
    // merge speech so that the ramps of two dips never overlap
    const vr = union((await AT.voiceRanges(voice, thr, hold)).map(([a, b]) => [a - att, b + rel])).map(([a, b]) => [a + att, b - rel]);
    const g = (t) => { // ducking offset (dB) at timeline time t
      for (const [a, b] of vr) { if (t < a - att || t > b + rel) continue; if (t < a) return duck * (t - (a - att)) / att; if (t <= b) return duck; return duck * (1 - (t - b) / rel); }
      return 0;
    };
    const out = []; let dips = 0;
    for (const c of mus) {
      const t0 = c.start, t1 = c.start + c.dur; const hit = vr.filter(([a, b]) => b + rel > t0 && a - att < t1); if (!hit.length) continue;
      const old = GW.clone(c.vol || GW.P(0)); const pts = new Set([0, c.dur]);
      for (const [a, b] of hit) for (const t of [a - att, a, b, b + rel]) if (t > t0 && t < t1) pts.add(t - t0);
      const inDip = (lt) => hit.some(([a, b]) => lt + t0 > a - att - 1e-6 && lt + t0 < b + rel + 1e-6);
      if (old.k) for (const k of old.k) if (!inDip(k.t) && k.t >= 0 && k.t <= c.dur) pts.add(k.t);
      const ks = [...pts].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 1e-3)
        .map(t => ({ t: r3(t), v: Math.round(Math.max(-60, GW.pv(old, t) + g(t + t0)) * 10) / 10, e: 'linear' }));
      // drop redundant interior keys (same value as both neighbours)
      const keep = ks.filter((k, i) => i === 0 || i === ks.length - 1 || !(k.v === ks[i - 1].v && k.v === ks[i + 1].v));
      c.vol = { v: keep[0].v, k: keep }; dips += hit.length; out.push({ id: c.id, keys: keep.length, dips: hit.length });
    }
    if (out.length) { GW.commit(o.label || 'خفض الموسيقى تلقائياً'); GW.invalidate(); GW.bus.emit('param'); }
    return { clips: out, dips, voiceRanges: vr.map(([a, b]) => [r3(a), r3(b)]) };
  };

  /* ---------------- 3. beat markers ---------------- */
  // tempo (autocorrelation of an onset envelope, weighted around 120 BPM) + phase → beat times in source seconds [from, to)
  AT.detectBeats = async (m, from = 0, to = Infinity) => {
    const ab = await GW.Media.loadAudio(m); if (!ab) fail('no audio: ' + m.name);
    const sr = ab.sampleRate, hop = 512, fr = sr / hop;
    const s0 = Math.max(0, Math.floor(from * sr)), s1 = Math.min(ab.length, Math.floor(Math.min(to, ab.duration) * sr));
    const n = Math.floor((s1 - s0) / hop); if (n < fr * 2) return { bpm: 0, beats: [] };
    const chs = []; for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) chs.push(ab.getChannelData(c));
    const eF = new Float32Array(n), eL = new Float32Array(n); let lp = 0; const k = 1 - Math.exp(-2 * Math.PI * 150 / sr);
    for (let i = 0; i < n; i++) { let a = 0, b = 0; for (let j = 0; j < hop; j++) { const idx = s0 + i * hop + j; let x = 0; for (const d of chs) x += d[idx]; x /= chs.length; lp += k * (x - lp); a += x * x; b += lp * lp; } eF[i] = Math.log(1e-9 + a); eL[i] = Math.log(1e-9 + b); }
    const on = new Float32Array(n); for (let i = 1; i < n; i++) on[i] = Math.max(0, eF[i] - eF[i - 1]) + Math.max(0, eL[i] - eL[i - 1]);
    // remove the local mean (≈0.5 s) so only real attacks remain
    const W = Math.round(fr * .25), cs = new Float64Array(n + 1); for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + on[i];
    const nv = new Float32Array(n); for (let i = 0; i < n; i++) { const a = Math.max(0, i - W), b = Math.min(n, i + W + 1); nv[i] = Math.max(0, on[i] - (cs[b] - cs[a]) / (b - a)); }
    const lagMin = Math.floor(fr * 60 / 200), lagMax = Math.min(n - 1, Math.ceil(fr * 60 / 55)); let best = 0, bestLag = 0; const ac = [];
    for (let L = lagMin; L <= lagMax; L++) { let sum = 0; for (let i = 0; i + L < n; i++) sum += nv[i] * nv[i + L]; sum /= (n - L); const bpm = 60 * fr / L; const w = Math.exp(-.5 * Math.pow(Math.log2(bpm / 120) / 1, 2)); ac[L] = sum; if (sum * w > best) { best = sum * w; bestLag = L; } }
    if (!bestLag || best <= 0) return { bpm: 0, beats: [] };
    let lag = bestLag; if (ac[bestLag - 1] != null && ac[bestLag + 1] != null) { const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1], den = a - 2 * b + c; if (Math.abs(den) > 1e-12) lag += GW.clamp(.5 * (a - c) / den, -.5, .5); }
    const at = (x) => { const i = Math.floor(x), f = x - i; return i < 0 || i + 1 >= n ? 0 : nv[i] * (1 - f) + nv[i + 1] * f; };
    let phase = 0, ps = -1; for (let p = 0; p < lag; p += .25) { let sum = 0; for (let x = p; x < n; x += lag) sum += at(x); if (sum > ps) { ps = sum; phase = p; } }
    const beats = [];
    for (let x = phase; x < n; x += lag) {
      const r = Math.max(1, Math.round(lag * .12)); let bi = Math.round(x), bv = -1; for (let i = Math.max(1, Math.round(x) - r); i <= Math.min(n - 1, Math.round(x) + r); i++) if (nv[i] > bv) { bv = nv[i]; bi = i; }
      if (bv <= 1e-6) bi = Math.round(x);
      // sample-accurate attack: first sample in the onset frame (and the one before) reaching half of the local peak
      const a0 = s0 + Math.max(0, bi - 1) * hop, a1 = Math.min(s1, s0 + (bi + 1) * hop); let pk = 0; for (let q = a0; q < a1; q++) { const v = Math.abs(chs[0][q]); if (v > pk) pk = v; }
      let t = (s0 + bi * hop) / sr; for (let q = a0; q < a1; q++) if (Math.abs(chs[0][q]) >= pk * .5) { t = q / sr; break; }
      if (!beats.length || t - beats[beats.length - 1] > lag / fr * .5) beats.push(t);
    }
    return { bpm: Math.round(60 * fr / lag * 10) / 10, beats };
  };
  AT.beatMarkers = async (o = {}) => {
    const s = o.seq || GW.seq(); const c = o.clip; if (!c) fail(tf('حدد مقطع موسيقى'));
    const m = GW.media(c.media); const sp = c.speed || 1; const every = Math.max(1, Math.round(o.every || 1));
    const r = await AT.detectBeats(m, c.in, c.in + c.dur * sp);
    const fps = s.fps || 30; const ts = r.beats.map(b => GW.snapFrame(c.start + (b - c.in) / sp, fps)).filter(t => t >= c.start - 1e-6 && t < c.start + c.dur - 1e-6).filter((t, i) => i % every === 0);
    const res = { bpm: r.bpm, count: ts.length, markers: ts.map(r3) };
    if (o.dryRun || !ts.length) return res;
    if (o.replace !== false) s.markers = s.markers.filter(mk => !(mk.beat && mk.t >= c.start - 1e-6 && mk.t <= c.start + c.dur + 1e-6));
    ts.forEach((t, i) => s.markers.push({ id: GW.uid(), t, name: tf('إيقاع {n}', { n: i + 1 }), color: '#ff6a2b', beat: 1 }));
    s.markers.sort((a, b) => a.t - b.t);
    GW.commit(o.label || 'علامات الإيقاع'); GW.bus.emit('markers'); GW.invalidate();
    return res;
  };

  /* ---------------- 4. enhance speech / loudness normalize (FFmpeg bake) ---------------- */
  AT.LOUD = [[-14, 'يوتيوب / سبوتيفاي (-14 LUFS)'], [-16, 'بودكاست / Apple (-16 LUFS)'], [-23, 'بث تلفزيوني EBU R128 (-23 LUFS)'], [-11, 'تيك توك / ريلز (-11 LUFS)']];
  const chainOf = (o) => { const f = []; if (o.highpass > 0) f.push('highpass=f=' + Math.round(o.highpass)); if (o.denoise > 0) f.push('afftdn=nr=' + GW.clamp(+o.denoise, 1, 97) + ':nf=-50:tn=1'); return f; };
  function ffRun(id, args, onT) {
    const prog = GW.bus._prog || (GW.bus._prog = {}); if (onT) prog[id] = onT;
    return Promise.resolve(api().ffRun(id, args)).finally(() => { delete prog[id]; });
  }
  const parseLoud = (log) => { const i = String(log || '').lastIndexOf('"input_i"'); if (i < 0) return null; const a = log.lastIndexOf('{', i), b = log.indexOf('}', i); try { const j = JSON.parse(log.slice(a, b + 1)); return isFinite(+j.input_i) && isFinite(+j.input_tp) ? j : null; } catch (e) { return null; } };
  AT.bake = async (m, o, onP) => {
    if (!api() || !m.path) fail(tf('هذه الميزة تحتاج نسخة سطح المكتب وملفًا محليًا'));
    const p = await GW.Media.cachePaths(); const dir = p.renders + p.sep + 'processed-audio';
    const tag = [o.highpass > 0 ? 'hp' + Math.round(o.highpass) : '', o.denoise > 0 ? 'nr' + o.denoise : '', o.loudness != null ? 'lufs' + Math.abs(o.loudness) : ''].filter(Boolean).join('_');
    const base = (m.name || 'audio').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_');
    const out = dir + p.sep + base + '_' + tag + '_' + GW.Media.hash((m.key || m.path) + '|' + tag).slice(0, 8) + '.wav';
    if (await api().exists(out) && await api().exists(out + '.ok')) return out;
    await api().writeText(dir + p.sep + '.keep', ''); // makes sure the folder exists
    const pre = chainOf(o); const id = 'enh_' + m.id; const dur = m.dur || 1;
    const outArgs = ['-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le'];
    const inArgs = ['-y', '-hide_banner', '-nostdin', '-stats', '-i', m.path, '-map', '0:a:0', '-vn', '-sn', '-dn'];
    let chain = pre.slice();
    if (o.loudness != null) {
      const I = GW.clamp(+o.loudness, -40, -5), TP = o.truePeak ?? -1.5, LRA = 11;
      onP && onP(0, tf('قياس الجهارة…'));
      const r1 = await ffRun(id, [...inArgs, '-af', [...pre, `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`].join(','), '-f', 'null', '-'], t => onP && onP(Math.min(49, t / dur * 50)));
      const j = r1.ok ? parseLoud(r1.log) : null;
      chain.push(j ? `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true` : `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}`);
    }
    if (!chain.length) fail(tf('لم يتم اختيار أي معالجة'));
    onP && onP(o.loudness != null ? 50 : 0, tf('معالجة الصوت…'));
    const r2 = await ffRun(id, [...inArgs, '-af', chain.join(','), ...outArgs, out], t => onP && onP((o.loudness != null ? 50 : 0) + Math.min(49, t / dur * (o.loudness != null ? 50 : 100))));
    if (!r2.ok) fail('ffmpeg: ' + String(r2.log || '').slice(-300));
    await api().writeText(out + '.ok', JSON.stringify({ src: m.path, chain }));
    return out;
  };
  AT.enhance = async (o = {}) => {
    const s = o.seq || GW.seq(); const clips = o.clips || []; if (!clips.length) fail(tf('حدد مقطعًا صوتيًا'));
    const opt = { highpass: +o.highpass || 0, denoise: +o.denoise || 0, loudness: o.loudness == null || o.loudness === '' || o.loudness === false ? null : +o.loudness, truePeak: o.truePeak };
    if (!opt.highpass && !opt.denoise && opt.loudness == null) fail(tf('لم يتم اختيار أي معالجة'));
    const byMedia = new Map(); for (const c of clips) { const src = GW.media(c.srcMedia) || GW.media(c.media); if (!byMedia.has(src.id)) byMedia.set(src.id, { m: src, clips: [] }); byMedia.get(src.id).clips.push(c); }
    const made = []; let k = 0;
    for (const { m, clips: cs } of byMedia.values()) {
      const onP = (pct, msg) => { const t = tf('تحسين الصوت') + ' (' + (k + 1) + '/' + byMedia.size + ') ' + m.name + ' — ' + Math.round(pct) + '%'; GW.status(msg ? msg + ' ' + t : t); o.onProgress && o.onProgress(pct, m); };
      const out = await AT.bake(m, opt, onP);
      let nm = GW.prj.media.find(x => x.path === out);
      if (!nm) {
        nm = { id: GW.uid(), kind: 'audio', name: out.split(/[\\/]/).pop(), path: out, size: 0, dur: 0, w: 0, h: 0, fps: 0, hasAudio: true, hasVideo: false, label: GW.LABELS.audio, added: Date.now(), derived: { from: m.id, ...opt } };
        GW.prj.media.push(nm); GW.Media.ensureRt(nm); await GW.Media.prepare(nm);
        if ((nm.dur || 0) <= 900) await GW.Media.loadAudio(nm).catch(() => {});
      }
      for (const c of cs) { if (!c.srcMedia) c.srcMedia = c.media; c.media = nm.id; }
      made.push({ media: nm.id, path: out, from: m.id, clips: cs.map(c => c.id) }); k++;
    }
    GW.status(''); GW.commit(o.label || (opt.denoise || opt.highpass ? 'تحسين الصوت' : 'توحيد مستوى الصوت')); GW.bus.emit('media'); GW.invalidate();
    if (GW.Audio.playing) GW.Audio.play(s, GW.Audio.now());
    return { media: made };
  };
  AT.restore = (o = {}) => {
    const cs = (o.clips || []).filter(c => c.srcMedia && GW.media(c.srcMedia)); if (!cs.length) fail(tf('لا يوجد صوت أصلي لاستعادته'));
    for (const c of cs) { c.media = c.srcMedia; delete c.srcMedia; }
    GW.commit(o.label || 'استعادة الصوت الأصلي'); GW.bus.emit('media'); GW.invalidate();
    return { clips: cs.map(c => c.id) };
  };

  /* ---------------- dialogs ---------------- */
  const trackOpts = (s, sel) => s.at.map((tr, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${GW.esc(tr.name || 'A' + (i + 1))} (${AT.trackClips(s, i).length})</option>`).join('');
  const head = (ico, txt) => `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:10px;color:var(--text2)"><span style="color:var(--accent);flex:none">${GW.ico(ico, 18)}</span><span>${GW.esc(txt)}</span></div>`;
  const numF = (k, label, v, step, min, max) => `<label class="fld"><span>${GW.esc(label)}</span><input class="inp" type="number" data-k="${k}" value="${v}" step="${step}" min="${min}" max="${max}" dir="ltr"></label>`;
  const prevBox = `<div data-k="prev" style="margin-top:4px;padding:8px 10px;border:1px solid var(--accentLine,var(--line));background:var(--accentBg,transparent);border-radius:4px;color:var(--accent);font-weight:600;min-height:20px"></div><div data-k="strip" style="position:relative;height:14px;margin-top:6px;background:var(--bg2,#222);border-radius:3px;overflow:hidden"></div>`;
  const wrapErr = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { console.error(e); GW.toast(e.message || String(e), 'err'); return false; } };

  AT.silenceDialog = (preset) => {
    const s = GW.seq(); const selc = AT.selected(s); const st = cfg('sil', { threshold: -40, minSilence: 0.5, padding: 0.1, allTracks: false, ti: 0 });
    const body = document.createElement('div');
    body.innerHTML = head('scissors', 'يحذف المقاطع الصامتة تلقائيًا مع إزاحة ما بعدها (Jump Cut)، ويقص الفيديو المرتبط في نفس النقاط ليبقى متزامنًا.') +
      `<label class="fld"><span>${GW.esc('المصدر')}</span><select class="inp" data-k="src">${selc.length ? `<option value="sel">${GW.esc(tf('المقاطع المحددة ({n})', { n: selc.length }))}</option>` : ''}${s.at.map((tr, i) => `<option value="${i}" ${!selc.length && i === st.ti ? 'selected' : ''}>${GW.esc(tf('كل مقاطع المسار {t}', { t: tr.name || 'A' + (i + 1) }))} (${AT.trackClips(s, i).length})</option>`).join('')}</select></label>
      <div class="grid2">${numF('threshold', 'عتبة الصمت (dB)', st.threshold, 1, -80, -5)}${numF('minSilence', 'أقل مدة للصمت (ث)', st.minSilence, 0.05, 0.05, 30)}${numF('padding', 'هامش حول الكلام (ث)', st.padding, 0.02, 0, 2)}</div>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" data-k="allTracks" ${st.allTracks ? 'checked' : ''}> ${GW.esc('إزاحة كل المسارات (العناوين والموسيقى تتبع القص)')}</label>` + prevBox;
    const q = (k) => body.querySelector(`[data-k=${k}]`);
    const read = () => ({ threshold: +q('threshold').value, minSilence: +q('minSilence').value, padding: +q('padding').value, allTracks: q('allTracks').checked, src: q('src').value });
    const clipsOf = (o) => (o.src === 'sel' ? selc : AT.trackClips(s, +o.src));
    let gen = 0, last = null;
    const preview = GW.debounce(async () => {
      const my = ++gen; const o = read(); const cs = clipsOf(o); q('prev').textContent = tf('جارٍ التحليل…'); q('strip').innerHTML = '';
      if (!cs.length) { q('prev').textContent = tf('لا توجد مقاطع صوتية للتحليل'); last = null; return; }
      try {
        const rg = await AT.detectSilences(s, cs, o); if (my !== gen) return; last = { o, cs, rg };
        const tot = rg.reduce((t, [a, b]) => t + b - a, 0); const t0 = Math.min(...cs.map(c => c.start)), t1 = Math.max(...cs.map(c => c.start + c.dur));
        q('prev').textContent = rg.length ? tf('سيُحذف {n} مقطعًا صامتًا · {sec} ث من {tot} ث', { n: rg.length, sec: f1(tot), tot: f1(t1 - t0) }) : tf('لم يُعثر على صمت بهذه الإعدادات');
        q('strip').innerHTML = cs.map(c => `<i style="position:absolute;top:3px;bottom:3px;left:${(c.start - t0) / (t1 - t0) * 100}%;width:${c.dur / (t1 - t0) * 100}%;background:var(--line2,#555)"></i>`).join('') + rg.map(([a, b]) => `<i style="position:absolute;top:0;bottom:0;left:${(a - t0) / (t1 - t0) * 100}%;width:${Math.max(.3, (b - a) / (t1 - t0) * 100)}%;background:var(--accent)"></i>`).join('');
        q('strip').style.direction = 'ltr';
      } catch (e) { if (my === gen) q('prev').textContent = e.message; }
    }, 220);
    body.addEventListener('input', preview); body.addEventListener('change', preview); preview();
    GW.modal({ title: 'حذف الصمت', width: 520, body, buttons: [{ label: 'إلغاء' }, { label: 'حذف الصمت', primary: true, action: wrapErr(async () => {
      const o = read(); saveCfg('sil', { ...o, ti: o.src === 'sel' ? st.ti : +o.src });
      const r = await AT.removeSilence({ ...o, clips: clipsOf(o) });
      GW.toast(r.count ? tf('تم حذف {n} مقطعًا صامتًا ({sec} ث)', { n: r.count, sec: f1(r.removed) }) : tf('لم يُعثر على صمت بهذه الإعدادات'));
    }) }] });
  };

  AT.duckDialog = () => {
    const s = GW.seq(); const selc = AT.selected(s); const st = cfg('duck', { music: 1, voice: 0, duck: 12, threshold: -35, attack: 0.2, release: 0.5 });
    let mu = selc.length ? selc[0].ti : st.music, vo = st.voice; if (mu === vo) vo = s.at.findIndex((t, i) => i !== mu && AT.trackClips(s, i).length); if (vo < 0) vo = mu === 0 ? 1 : 0;
    const body = document.createElement('div');
    body.innerHTML = head('sound', 'يضيف مفاتيح حركة لمستوى الموسيقى فتنخفض تلقائيًا أثناء الكلام وتعود بعده.') +
      `<div class="grid2"><label class="fld"><span>${GW.esc('مسار الموسيقى')}</span><select class="inp" data-k="music">${trackOpts(s, mu)}</select></label><label class="fld"><span>${GW.esc('مسار الكلام')}</span><select class="inp" data-k="voice">${trackOpts(s, vo)}</select></label>
      ${numF('duck', 'مقدار الخفض (dB)', st.duck, 1, 1, 40)}${numF('threshold', 'عتبة اكتشاف الكلام (dB)', st.threshold, 1, -80, -5)}${numF('attack', 'زمن الهبوط (ث)', st.attack, 0.05, 0.01, 3)}${numF('release', 'زمن العودة (ث)', st.release, 0.05, 0.01, 5)}</div>` + prevBox;
    const q = (k) => body.querySelector(`[data-k=${k}]`);
    const read = () => ({ music: +q('music').value, voice: +q('voice').value, duck: +q('duck').value, threshold: +q('threshold').value, attack: +q('attack').value, release: +q('release').value });
    let gen = 0;
    const preview = GW.debounce(async () => {
      const my = ++gen; const o = read(); q('strip').innerHTML = '';
      if (o.music === o.voice) { q('prev').textContent = tf('اختر مسارين مختلفين للموسيقى والكلام'); return; }
      const v = AT.trackClips(s, o.voice), mcs = AT.trackClips(s, o.music); if (!v.length || !mcs.length) { q('prev').textContent = tf(!mcs.length ? 'لا توجد مقاطع موسيقى' : 'لا توجد مقاطع صوت للكلام'); return; }
      q('prev').textContent = tf('جارٍ التحليل…');
      try {
        const vr = await AT.voiceRanges(v, o.threshold, 0.3); if (my !== gen) return;
        const t0 = Math.min(...[...v, ...mcs].map(c => c.start)), t1 = Math.max(...[...v, ...mcs].map(c => c.start + c.dur));
        q('prev').textContent = tf('سيتم خفض الموسيقى {n} مرة على {c} مقطع', { n: vr.length, c: mcs.length });
        q('strip').style.direction = 'ltr'; q('strip').innerHTML = vr.map(([a, b]) => `<i style="position:absolute;top:0;bottom:0;left:${(a - t0) / (t1 - t0) * 100}%;width:${Math.max(.3, (b - a) / (t1 - t0) * 100)}%;background:var(--accent)"></i>`).join('');
      } catch (e) { if (my === gen) q('prev').textContent = e.message; }
    }, 220);
    body.addEventListener('input', preview); body.addEventListener('change', preview); preview();
    GW.modal({ title: 'خفض الموسيقى تلقائياً', width: 520, body, buttons: [{ label: 'إلغاء' }, { label: 'تطبيق', primary: true, action: wrapErr(async () => {
      const o = read(); if (o.music === o.voice) { GW.toast(tf('اختر مسارين مختلفين للموسيقى والكلام')); return false; } saveCfg('duck', o);
      const r = await AT.autoDuck({ ...o, music: AT.trackClips(s, o.music), voice: AT.trackClips(s, o.voice) });
      GW.toast(r.clips.length ? tf('تم خفض الموسيقى {n} مرة', { n: r.dips }) : tf('لم يُكتشف كلام فوق الموسيقى'));
    }) }] });
  };

  AT.beatDialog = () => {
    const s = GW.seq(); const c = AT.selected(s)[0]; if (!c) { GW.toast(tf('حدد مقطع موسيقى')); return; }
    const st = cfg('beat', { every: 1, replace: true });
    const body = document.createElement('div');
    body.innerHTML = head('beat', 'يكتشف إيقاع المقطع ويضيف علامات على التسلسل؛ القص والسحب يلتصقان بالعلامات عند تفعيل المحاذاة المغناطيسية.') +
      `<label class="fld"><span>${GW.esc('علامة كل')}</span><select class="inp" data-k="every">${[[1, 'ضربة'], [2, 'ضربتين'], [4, '4 ضربات (مازورة)'], [8, '8 ضربات']].map(([v, n]) => `<option value="${v}" ${v === st.every ? 'selected' : ''}>${GW.esc(n)}</option>`).join('')}</select></label>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" data-k="replace" ${st.replace ? 'checked' : ''}> ${GW.esc('استبدال علامات الإيقاع السابقة على هذا المقطع')}</label>` + prevBox;
    const q = (k) => body.querySelector(`[data-k=${k}]`); let gen = 0;
    const preview = GW.debounce(async () => {
      const my = ++gen; q('prev').textContent = tf('جارٍ التحليل…');
      try { const r = await AT.beatMarkers({ clip: c, every: +q('every').value, dryRun: true }); if (my !== gen) return; q('prev').textContent = r.count ? tf('الإيقاع {bpm} BPM · {n} علامة', { bpm: r.bpm, n: r.count }) : tf('لم يُكتشف إيقاع واضح'); q('strip').style.direction = 'ltr'; q('strip').innerHTML = r.markers.map(t => `<i style="position:absolute;top:0;bottom:0;width:2px;left:${(t - c.start) / c.dur * 100}%;background:var(--accent)"></i>`).join(''); }
      catch (e) { if (my === gen) q('prev').textContent = e.message; }
    }, 150);
    body.addEventListener('change', preview); preview();
    GW.modal({ title: 'علامات الإيقاع', width: 480, body, buttons: [{ label: 'إلغاء' }, { label: 'إضافة العلامات', primary: true, action: wrapErr(async () => {
      const o = { every: +q('every').value, replace: q('replace').checked }; saveCfg('beat', o);
      const r = await AT.beatMarkers({ clip: c, ...o }); GW.toast(r.count ? tf('تمت إضافة {n} علامة إيقاع ({bpm} BPM)', { n: r.count, bpm: r.bpm }) : tf('لم يُكتشف إيقاع واضح'));
    }) }] });
  };

  AT.enhanceDialog = (mode) => {
    const s = GW.seq(); const cs = AT.selected(s); if (!cs.length) { GW.toast(tf('حدد مقطعًا صوتيًا')); return; }
    const st = cfg('enh', { denoiseOn: true, denoise: 12, hpOn: true, highpass: 80, loudOn: true, loudness: -14 });
    if (mode === 'loud') Object.assign(st, { denoiseOn: false, hpOn: false, loudOn: true });
    const body = document.createElement('div');
    const row = (k, on, label, field) => `<div style="display:grid;grid-template-columns:auto 1fr 210px;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" data-k="${k}On" ${on ? 'checked' : ''}><span>${GW.esc(label)}</span>${field}</div>`;
    body.innerHTML = head('wand', 'يعالج الصوت بواسطة FFmpeg ويحفظ ملف WAV جديدًا يحل محل مصدر المقطع. الملف الأصلي لا يتغير، ويمكن التراجع أو استعادة الأصل في أي وقت.') +
      row('denoise', st.denoiseOn, 'إزالة الضوضاء (afftdn)', `<input class="inp" type="number" data-k="denoise" value="${st.denoise}" min="1" max="40" step="1" dir="ltr" title="dB">`) +
      row('hp', st.hpOn, 'إزالة الطنين المنخفض (High-pass)', `<input class="inp" type="number" data-k="highpass" value="${st.highpass}" min="20" max="400" step="10" dir="ltr" title="Hz">`) +
      row('loud', st.loudOn, 'توحيد مستوى الصوت (Loudness)', `<select class="inp" data-k="loudness">${AT.LOUD.map(([v, n]) => `<option value="${v}" ${v === +st.loudness ? 'selected' : ''}>${GW.esc(n)}</option>`).join('')}</select>`) +
      `<div data-k="prev" style="margin-top:6px;color:var(--accent);font-weight:600">${GW.esc(tf('{n} مقطع صوتي', { n: cs.length }))}</div>`;
    const q = (k) => body.querySelector(`[data-k=${k}]`);
    GW.modal({ title: mode === 'loud' ? 'توحيد مستوى الصوت' : 'تحسين الصوت', width: 560, body, buttons: [{ label: 'إلغاء' }, { label: 'معالجة', primary: true, action: wrapErr(async (dlg) => {
      const o = { denoiseOn: q('denoiseOn').checked, denoise: +q('denoise').value, hpOn: q('hpOn').checked, highpass: +q('highpass').value, loudOn: q('loudOn').checked, loudness: +q('loudness').value };
      if (!o.denoiseOn && !o.hpOn && !o.loudOn) { GW.toast(tf('لم يتم اختيار أي معالجة')); return false; }
      if (mode !== 'loud') saveCfg('enh', o);
      dlg.querySelectorAll('button').forEach(b => b.disabled = true);
      const r = await AT.enhance({ clips: cs, denoise: o.denoiseOn ? o.denoise : 0, highpass: o.hpOn ? o.highpass : 0, loudness: o.loudOn ? o.loudness : null, label: mode === 'loud' ? 'توحيد مستوى الصوت' : undefined, onProgress: (p) => { q('prev').textContent = tf('معالجة الصوت…') + ' ' + Math.round(p) + '%'; } });
      GW.toast(tf('تمت معالجة الصوت: {n} ملف جديد (الأصل محفوظ)', { n: r.media.length }));
    }) }] });
  };

  /* ---------------- menus ---------------- */
  const C = GW.cmd;
  C.removeSilence = () => AT.silenceDialog(); C.autoDuck = () => AT.duckDialog(); C.beatMarkers = () => AT.beatDialog();
  C.enhanceAudio = () => AT.enhanceDialog(); C.normalizeAudio = () => AT.enhanceDialog('loud');
  C.restoreAudio = wrapErr(async () => { AT.restore({ clips: AT.selected(GW.seq()) }); GW.toast(tf('تمت استعادة الصوت الأصلي')); });
  AT.items = (c) => {
    const s = GW.seq(); const sel = AT.selected(s); const orig = sel.some(x => x.srcMedia);
    return [
      { label: 'حذف الصمت…', action: C.removeSilence }, { label: 'خفض الموسيقى تلقائياً…', action: C.autoDuck }, { label: 'علامات الإيقاع…', action: C.beatMarkers, disabled: !sel.length },
      '-', { label: 'تحسين الصوت (إزالة الضوضاء)…', action: C.enhanceAudio, disabled: !sel.length }, { label: 'توحيد مستوى الصوت (-14 LUFS)…', action: C.normalizeAudio, disabled: !sel.length },
      ...(orig || c ? [{ label: 'استعادة الصوت الأصلي', action: C.restoreAudio, disabled: !orig }] : [])
    ];
  };
  const addMenu = (name, items) => { const e = GW.MENUS && GW.MENUS.find(m => m[0] === name); if (!e) return; const f = e[1]; e[1] = () => [...f(), '-', ...items()]; };
  addMenu('مقطع', () => [{ label: 'أدوات الصوت الذكية', sub: AT.items().filter(x => x === '-' || !x.disabled) }]);
  addMenu('تسلسل', () => [{ label: 'حذف الصمت…', action: C.removeSilence }, { label: 'خفض الموسيقى تلقائياً…', action: C.autoDuck }]);
  // timeline clip context menu (ui_timeline.js calls GW.clipMenuHooks)
  (GW.clipMenuHooks = GW.clipMenuHooks || []).push((items, c, s) => { if (!AT.audioOf(s, c).some(hasAudio)) return; items.push('-', { label: 'أدوات الصوت الذكية', sub: AT.items(c).filter(x => x === '-' || !x.disabled) }); });
})();
