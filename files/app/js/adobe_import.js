'use strict';
/* «استيراد من أدوبي» — importers for the user's own Adobe / Red Giant / Video Copilot files, read at runtime from his disk.
   Nothing proprietary is bundled: compiled plug-ins (.aex/.prm/.ofx) cannot run here; we only read preset/settings files
   (presets are the user's data) and map them onto QassQass's own effects, export presets, audio presets, LUT library and fonts.
   Formats:
     .ffx            After Effects animation preset — RIFX (big-endian RIFF): LIST besc › tdsp paths + sspc (fnam, parT/pard defs,
                     tdgp › tdbs values: tdb4 flags, cdat static doubles, LIST list › lhd3 header + ldat keyframes).
     .prfpset        Premiere effect presets — XML (FilterPreset › VideoFilterComponent › *ComponentParam, ticks = 254016000000/s).
     .epr            Adobe Media Encoder / Premiere export preset — XML (ExportParam ParamIdentifier/ParamValue).
     .essentialsound Premiere Essential Sound preset — JSON (model_* arrays).
     .rgx            Red Giant Universe preset — JSON (param.stream block) + _media/<name>-preview.mp4 / -thumbnail.png.
     .cube / .3dl    LUTs (3dl converted to cube on load).   .obj models, .ttf/.otf fonts, footage/sounds → «مكتبتي».
   Pure parsers/mappers are exported for node unit tests (test/unit/adobe_import.js); the UI part runs only inside the app. */
(function (root) {
  const AI = {};
  const TPS = 254016000000; // Premiere ticks per second

  /* ================= RIFX (.ffx) ================= */
  const id4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  AI.riff = (u8) => {
    const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 12 || id4(b, 0) !== 'RIFX') throw new Error('not a RIFX file');
    const walk = (o, end, depth) => {
      const out = [];
      while (o + 8 <= end) {
        const id = id4(b, o); let sz = dv.getUint32(o + 4); const s = o + 8; if (s + sz > end) sz = Math.max(0, end - s);
        if (id === 'LIST') { const type = id4(b, s); out.push({ id, type, kids: type === 'btdk' || depth > 40 ? [] : walk(s + 4, s + sz, depth + 1) }); }
        else out.push({ id, off: s, len: sz });
        o = s + sz + (sz & 1);
      }
      return out;
    };
    const total = Math.min(b.length, 8 + dv.getUint32(4));
    return { b, dv, form: id4(b, 8), kids: walk(12, total, 0) };
  };
  const cstr = (R, c) => { // tdmn / fnam / tdsn / pdnm: raw latin text, or (AE 2023+) a nested 'Utf8' sub-chunk
    let o = c.off, n = c.len; const b = R.b;
    if (n >= 8 && id4(b, o) === 'Utf8') { const L = R.dv.getUint32(o + 4); o += 8; n = Math.min(L, n - 8); return new TextDecoder('utf-8').decode(b.subarray(o, o + n)).replace(/\0[\s\S]*$/, ''); }
    let e = o; while (e < o + n && b[e]) e++;
    let s = new TextDecoder('utf-8').decode(b.subarray(o, e));
    return s.replace(/^[\x00-\x1f]+/, '');
  };
  const f64s = (R, c) => { const a = []; for (let i = 0; i + 8 <= c.len; i += 8) a.push(R.dv.getFloat64(c.off + i)); return a; };
  // tdb4: [0..1] marker 0xdb99, [2..3] components; byte 13 bit0 = color; byte 14 … (see lottie-docs “Parsing AEP Files”)
  const tdb4Of = (R, c) => { const b = R.b, o = c.off; return { dims: R.dv.getUint16(o + 2), color: !!(b[o + 57] & 1) || false, raw: o }; };
  // keyframes: lhd3 count @10 (u16), item size @18 (u16); ldat items: u32 time, u8 ease(1 lin, 2 bez, 3 hold), …, then values
  const keysOf = (R, list, dims) => {
    const h = list.kids.find(k => k.id === 'lhd3'), d = list.kids.find(k => k.id === 'ldat'); if (!h || !d) return null;
    const n = R.dv.getUint16(h.off + 10), sz = R.dv.getUint16(h.off + 18); if (!n || !sz || d.len < n * sz) return null;
    const keys = [];
    for (let i = 0; i < n; i++) {
      const o = d.off + i * sz; const t = R.dv.getUint32(o), ez = R.b[o + 4]; let v;
      const nd = Math.max(1, dims || 1);
      if (sz === 8 + 40 * nd) { v = []; for (let j = 0; j < nd; j++) v.push(R.dv.getFloat64(o + 8 + j * 8)); } // multi-dim: value block first
      else if (sz >= 48 + 24 * nd && sz < 48 + 24 * nd + 16) { v = []; for (let j = 0; j < nd; j++) v.push(R.dv.getFloat64(o + 48 + j * 8)); } // spatial: header + 5 doubles, then value
      else if (sz >= 48 + 32) { v = []; for (let j = 0; j < 4; j++) v.push(R.dv.getFloat64(o + 48 + j * 8)); } // color ARGB
      else v = [R.dv.getFloat64(o + 8)];
      keys.push({ t, e: ez === 3 ? 'hold' : ez === 1 ? 'linear' : 'ease', v: v.length === 1 ? v[0] : v });
    }
    return keys;
  };
  const PARD_T = { 0: 'layer', 2: 'num', 3: 'angle', 4: 'bool', 5: 'color', 6: 'point', 7: 'enum', 9: 'paint', 10: 'num', 12: 'num', 13: 'group', 18: 'point3' };
  // generic property tree (tdgp) → flat list of {match, name, dims, v, keys, expr}
  const propsOf = (R, kids, out, path) => {
    let pending = null;
    for (const c of kids) {
      if (c.id === 'tdmn') { pending = cstr(R, c); continue; }
      if (c.id === 'LIST' && c.type === 'tdgp') { propsOf(R, c.kids, out, pending ? path.concat(pending) : path); pending = null; continue; }
      if (c.id === 'LIST' && (c.type === 'tdbs' || c.type === 'om-s' || c.type === 'otst')) {
        const bs = c.type === 'tdbs' ? c : (c.kids.find(k => k.id === 'LIST' && k.type === 'tdbs') || c);
        const t4 = bs.kids.find(k => k.id === 'tdb4'), cd = bs.kids.find(k => k.id === 'cdat'), ls = bs.kids.find(k => k.id === 'LIST' && k.type === 'list');
        const nm = bs.kids.find(k => k.id === 'tdsn'), ex = bs.kids.find(k => k.id === 'Utf8');
        const info = t4 ? tdb4Of(R, t4) : { dims: 1 };
        const p = { match: pending || '', path, name: nm ? cstr(R, nm) : '', dims: info.dims, kind: c.type === 'tdbs' ? 'value' : c.type };
        if (cd) { const a = f64s(R, cd); p.v = info.dims > 1 ? a.slice(0, info.dims) : a[0]; p.raw = a; }
        if (ls) { const k = keysOf(R, ls, info.dims); if (k && k.length) { p.keys = k; if (p.v == null) p.v = k[0].v; } }
        if (ex) { const s = cstr(R, ex); if (s && s !== '-_0_/-') p.expr = s; }
        out.push(p); pending = null; continue;
      }
    }
    return out;
  };
  AI.parseFFX = (u8, name) => {
    const R = AI.riff(u8); const res = { kind: 'ffx', name: name || '', effects: [], props: [], targets: [], warnings: [] };
    if (R.form !== 'FaFX') res.warnings.push('form ' + R.form);
    const besc = R.kids.find(k => k.id === 'LIST' && k.type === 'besc'); if (!besc) throw new Error('no besc');
    for (const c of besc.kids) {
      if (c.id === 'LIST' && c.type === 'tdsp') { // a target path, e.g. ADBE Effect Parade › ADBE Fast Blur  |  ADBE Transform Group › ADBE Position
        const path = []; for (const s of c.kids) if (s.id === 'LIST' && s.type === 'tdsi') { const m = s.kids.find(k => k.id === 'tdmn'); if (m) path.push(cstr(R, m)); }
        if (path.length && path[0] !== 'ADBE End of path sentinel') res.targets.push(path);
      } else if (c.id === 'LIST' && c.type === 'sspc') { // one effect instance
        const fn = c.kids.find(k => k.id === 'fnam'); const parT = c.kids.find(k => k.id === 'LIST' && k.type === 'parT'); const gp = c.kids.find(k => k.id === 'LIST' && k.type === 'tdgp');
        const defs = {}; let cur = null;
        if (parT) for (const k of parT.kids) {
          if (k.id === 'tdmn') cur = cstr(R, k);
          else if (k.id === 'pard' && cur) { const t = R.b[k.off + 15]; let n = ''; { let e = k.off + 16; while (e < k.off + 48 && R.b[e]) e++; n = new TextDecoder('latin1').decode(R.b.subarray(k.off + 16, e)); } defs[cur] = { type: PARD_T[t] || ('t' + t), name: n }; }
          else if (k.id === 'pdnm' && cur && defs[cur]) defs[cur].opts = cstr(R, k).split('|');
        }
        const vals = gp ? propsOf(R, gp.kids, [], []) : [];
        let match = ''; for (const v of vals) { const m = /^(.*)-(\d{4})$/.exec(v.match); if (m) { match = m[1]; break; } }
        const fx = { match, name: fn ? cstr(R, fn) : '', params: [] };
        for (const v of vals) {
          const m = /-(\d{4})$/.exec(v.match); if (!m) continue; const idx = +m[1]; if (!idx) continue; const d = defs[v.match] || {};
          if (d.type === 'group') continue;
          fx.params.push({ idx, name: v.name || d.name || '', type: d.type || (v.dims > 1 ? 'point' : 'num'), opts: d.opts, v: v.v, keys: v.keys, expr: v.expr, dims: v.dims });
        }
        res.effects.push(fx);
      } else if (c.id === 'LIST' && c.type === 'tdgp') { // layer properties (transform, text animators, masks…)
        propsOf(R, c.kids, res.props, []);
      }
    }
    // effects listed in tdsp but without sspc (rare): keep the match name so they are reported
    for (const p of res.targets) if (p[0] === 'ADBE Effect Parade' && p[1] && !res.effects.some(e => e.match === p[1])) res.effects.push({ match: p[1], name: p[1], params: [] });
    // keyframe times: ldat stores ticks; presets are authored at arbitrary layer times → normalise to the first key and seconds
    const all = []; const each = (p) => { if (p.keys) all.push(p); };
    res.effects.forEach(e => e.params.forEach(each)); res.props.forEach(each);
    if (all.length) { let t0 = Infinity; for (const p of all) for (const k of p.keys) t0 = Math.min(t0, k.t); for (const p of all) for (const k of p.keys) k.t = (k.t - t0) / AI.FFX_TICKS; }
    res.animated = all.length > 0;
    return res;
  };
  AI.FFX_TICKS = 2997; // empirical (570 AE presets): ldat times are 1/100-frame units of the authoring comp, almost always 29.97 fps (deltas 100 = 1 frame, 2997 = 1 s)

  /* ================= tiny XML (prfpset / epr) ================= */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unesc = (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()]);
  AI.xml = (text) => {
    const rootN = { tag: '#root', a: {}, k: [], t: '' }; const st = [rootN]; const re = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|([^<]+)/g; let m;
    while ((m = re.exec(text))) {
      const top = st[st.length - 1];
      if (m[6] != null) { if (m[6].trim()) top.t += unesc(m[6]); continue; }
      if (m[5] != null) { top.t += m[5]; continue; }
      if (!m[2]) continue;
      if (m[1]) { if (st.length > 1) st.pop(); continue; }
      const a = {}; m[3].replace(/([\w.:-]+)\s*=\s*"([^"]*)"/g, (x, k, v) => { a[k] = unesc(v); });
      const n = { tag: m[2], a, k: [], t: '' }; top.k.push(n); if (!m[4]) st.push(n);
    }
    return rootN;
  };
  const kid = (n, tag) => n && n.k.find(x => x.tag === tag);
  const kids = (n, tag) => (n ? n.k.filter(x => x.tag === tag) : []);
  const txt = (n, tag) => { const x = kid(n, tag); return x ? x.t.trim() : ''; };

  /* ================= Premiere effect presets (.prfpset) ================= */
  const prColor = (s) => { // 4×16-bit ARGB packed in a u64 decimal string
    try { const n = BigInt(s); const ch = (sh) => Number((n >> BigInt(sh)) & 0xffffn) >> 8; return '#' + [ch(32), ch(16), ch(0)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return '#000000'; }
  };
  const prVal = (s, ctl) => {
    if (s == null || s === '') return null;
    if (ctl === 5) return prColor(s);
    if (s.includes(':')) return s.split(':').map(Number);
    if (s === 'true' || s === 'false') return s === 'true' ? 1 : 0;
    const v = Number(s); return isFinite(v) ? v : s;
  };
  const prKeys = (s, ctl) => s.split(';').filter(x => x.trim()).map(k => { const f = k.split(','); return { tick: Number(f[0]), v: prVal(f[1], ctl), e: f[3] === '4' || f[2] === '4' ? 'hold' : (f[3] === '0' ? 'linear' : 'ease') }; }).filter(k => isFinite(k.tick));
  // keyframe lists: rounded, 'ease' implied, long baked lists decimated to ≤ 300 keys (first/last kept)
  const rnd = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : Array.isArray(v) ? v.map(rnd) : v);
  AI.compactKeys = (keys, max = 300) => {
    let ks = keys; if (ks.length > max) { const out = []; const st = (ks.length - 1) / (max - 1); for (let i = 0; i < max; i++) out.push(ks[Math.round(i * st)]); ks = out; }
    return ks.map(k => { const o = { t: Math.round(k.t * 1000) / 1000, v: rnd(k.v) }; if (k.e && k.e !== 'ease') o.e = k.e; return o; });
  };
  AI.parsePrfpset = (text, o = {}) => {
    // lazy object index: top-level <Tag ObjectID="n" …>…</Tag> spans; each object is parsed on demand (files reach 450 MB).
    // A node Buffer is scanned byte-wise (no giant JS string); a string (small files, browser) with a regex.
    const idx = new Map(); let slice;
    if (typeof text !== 'string' && text && typeof text.indexOf === 'function' && typeof text.toString === 'function') {
      const B = text; const pats = [' ObjectID="', ' ObjectUID="']; slice = (a, b) => B.toString('utf8', a, b);
      for (const pat of pats) {
        let i = 0;
        while ((i = B.indexOf(pat, i)) >= 0) {
          let lt = i; while (lt > 0 && B[lt] !== 60 && i - lt < 80) lt--; const tag = B.toString('latin1', lt + 1, i);
          const q = B.indexOf(34, i + pat.length); const id = B.toString('latin1', i + pat.length, q); const gt = B.indexOf(62, q);
          if (B[lt] !== 60 || gt < 0 || !/^[A-Za-z_][\w.]*$/.test(tag)) { i = q > i ? q : i + 1; continue; }
          if (B[gt - 1] === 47) { i = gt; continue; }
          const end = B.indexOf('</' + tag + '>', gt); if (end < 0) { i = gt; continue; }
          idx.set(id, [lt, end + tag.length + 3]); i = end;
        }
      }
    } else {
      text = String(text); slice = (a, b) => text.slice(a, b); const re = /<([A-Za-z_][\w.]*) Object(?:ID|UID)="([^"]+)"[^>]*?(\/?)>/g; let m;
      while ((m = re.exec(text))) { if (m[3]) continue; const end = text.indexOf('</' + m[1] + '>', re.lastIndex); if (end < 0) continue; idx.set(m[2], [m.index, end + m[1].length + 3]); re.lastIndex = end; }
    }
    const cache = new Map();
    const obj = (id) => { if (id == null) return null; if (cache.has(id)) return cache.get(id); const sp = idx.get(id); const n = sp ? AI.xml(slice(sp[0], sp[1])).k[0] : null; if (cache.size > 4000) cache.clear(); cache.set(id, n); return n; };
    const ref = (n) => n && obj(n.a.ObjectRef || n.a.ObjectURef);
    const keep = o.keepParams || (() => true);
    const out = [];
    const param = (pn, i) => {
      const ctl = +txt(pn, 'ParameterControlType'); const nm = txt(pn, 'Name'); const kf = txt(pn, 'Keyframes'); const sk = txt(pn, 'StartKeyframe'); const cv = txt(pn, 'CurrentValue');
      const p = { idx: i + 1, name: nm, ctl, type: { 1: 'num', 2: 'num', 3: 'angle', 4: 'bool', 5: 'color', 6: 'point', 7: 'enum', 8: 'num', 11: 'group', 12: 'groupEnd' }[ctl] || 'other' };
      if (kf) { p.keys = prKeys(kf, ctl); if (p.keys.length) p.v = p.keys[0].v; }
      if (p.v == null && sk) { const k = prKeys(sk, ctl)[0]; if (k) p.v = k.v; }
      if (p.v == null) p.v = prVal(cv, ctl);
      if (typeof p.v === 'string' && p.v.length > 200) p.v = null; // blobs (Lumetri curves, masks)
      if (p.keys && !p.keys.length) delete p.keys;
      return p;
    };
    const walk = (bin, path, depth) => {
      if (depth > 30) return;
      for (const it of kids(kid(bin, 'Items'), 'Item')) {
        const n = ref(it); if (!n) continue; const base = kid(n, 'TreeItemBase'); const name = txt(base, 'Name');
        if (n.tag === 'BinTreeItem') { walk(n, path.concat(name), depth + 1); continue; }
        if (n.tag !== 'TreeItem') continue;
        const item = ref(kid(base, 'Data')) || ref(kid(n, 'Data')); if (!item) continue;
        const fps = []; const f1 = kid(item, 'FilterPreset'); if (f1 && (f1.a.ObjectRef || f1.a.ObjectURef)) fps.push(ref(f1)); for (const x of kids(kid(item, 'FilterPresets'), 'FilterPreset')) fps.push(ref(x));
        const list = fps.filter(Boolean); if (!list.length) continue;
        const pr = { kind: 'prfpset', name, path, type: +txt(list[0], 'Type') || 0, desc: txt(list[0], 'Description'), effects: [] };
        let span = 0;
        for (const fp of list) {
          const t0 = +txt(fp, 'AnchorInPoint') || 0, t1 = +txt(fp, 'AnchorOutPoint') || 0; if (t1 > t0) span = Math.max(span, (t1 - t0) / TPS);
          const c = ref(kid(fp, 'Component')); if (!c) continue;
          const cb = kid(c, 'Component'); const match = (txt(c, 'MatchName') || txt(fp, 'FilterMatchName')).replace(/^(AE|PR)\./, '');
          const fx = { match, name: txt(cb, 'DisplayName') || txt(cb, 'InstanceName') || match, params: [] };
          if (keep(match)) {
            const plist = kids(kid(cb, 'Params'), 'Param').sort((a, b) => +a.a.Index - +b.a.Index).map(p => ref(p)).filter(Boolean);
            let grp = '';
            plist.forEach((pn, i) => { const p = param(pn, i); if (p.type === 'group') { grp = p.name; return; } if (p.type === 'groupEnd') { grp = ''; return; } p.grp = grp; if (p.keys) p.keys = AI.compactKeys(p.keys.map(k => ({ t: (k.tick - t0) / TPS, v: k.v, e: k.e }))); fx.params.push(p); });
          }
          pr.effects.push(fx);
        }
        pr.span = Math.round(span * 1000) / 1000;
        pr.animated = pr.effects.some(e => e.params.some(p => p.keys && p.keys.length > 1));
        out.push(pr);
      }
    };
    let rootBin = null;
    for (const [id] of idx) { const n = obj(id); if (n && n.tag === 'Tree') { rootBin = ref(kid(n, 'RootBin')); break; } if (n && n.tag === 'BinTreeItem') { rootBin = n; break; } }
    if (rootBin) walk(rootBin, [], 0);
    for (const p of out) if (p.path[0] === 'Presets' || p.path[0] === 'Root') p.path = p.path.slice(p.path[1] === 'Presets' ? 2 : 1);
    return out;
  };

  /* ================= effect mapping ================= */
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const hex = (r, g, b) => '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  const W = 1920, H = 1080;
  // value converters: p = parsed param (v = number | [..] | '#hex'), returns our value
  const C = {
    num: (v) => (Array.isArray(v) ? v[0] : +v || 0),
    pct: (v) => C.num(v), // already percent
    bool: (v) => (C.num(v) ? 1 : 0),
    color: (v) => { if (typeof v === 'string') return v; if (Array.isArray(v)) { const a = v.length >= 4 ? v.slice(1, 4) : v; const sc = a.every(x => x <= 1.0001) ? 255 : 1; return hex(a[0] * sc, a[1] * sc, a[2] * sc); } return '#000000'; },
    // points: Premiere = normalized [x, y]; AE ffx effect points = pixels (or normalized in newer versions when both ≤ 2)
    pt: (v) => { if (!Array.isArray(v)) return [0.5, 0.5]; const [x, y] = v; if (Math.abs(x) <= 2 && Math.abs(y) <= 2) return [x, y]; return [x / W, y / H]; },
    enumIdx: (v, src) => Math.max(0, Math.round(C.num(v)) - (src === 'ffx' ? 1 : 0))
  };
  const sel = (arr) => (v, src) => arr[C.enumIdx(v, src)] ?? arr[0];
  const mul = (k, add) => (v) => C.num(v) * k + (add || 0);
  const pxPctH = (v) => C.num(v) / H * 100;
  // MAP[matchname] = { fx, p: { 'param name (normalised)': [ourKey, conv] }, set: {fixed params}, approx: reason, post(fxParams, P) }
  const MAP = AI.MAP = {
    'ADBE Gaussian Blur 2': { fx: 'gblur', p: { blurriness: ['amount', C.num], 'blur dimensions': ['dims', sel(['both', 'h', 'v'])], 'repeat edge pixels': ['edges', C.bool] } },
    'ADBE Fast Blur': { fx: 'gblur', p: { blurriness: ['amount', C.num], 'blur dimensions': ['dims', sel(['both', 'h', 'v'])], 'repeat edge pixels': ['edges', C.bool] } },
    'ADBE Box Blur2': { fx: 'gblur', p: { 'blur radius': ['amount', mul(2)], 'blur dimensions': ['dims', sel(['both', 'h', 'v'])] } },
    'ADBE Gaussian Blur': { fx: 'gblur', p: { blurriness: ['amount', C.num] } },
    'ADBE Channel Blur': { fx: 'chroma', p: { 'red blurriness': ['amount', mul(.2)] }, approx: 'Channel Blur → انحراف لوني' },
    'ADBE Motion Blur': { fx: 'dblur', p: { direction: ['angle', C.num], 'blur length': ['len', C.num] } },
    'ADBE Radial Blur': { fx: 'radialblur', p: { amount: ['angle', mul(.5)], center: ['center', C.pt] }, post: (o, P) => { const t = P.get('type'); if (t && C.enumIdx(t.v, P.src) === 1) { o.__type = 'zblur'; o.amount = o.angle * 2; delete o.angle; } } },
    'ADBE Camera Lens Blur': { fx: 'lensblur', p: { 'blur radius': ['radius', C.num] } },
    'ADBE Sharpen': { fx: 'sharpen', p: { 'sharpen amount': ['amount', C.num] } },
    'ADBE Unsharp Mask': { fx: 'unsharp', p: { amount: ['amount', C.num], radius: ['radius', C.num] } },
    'ADBE Glo2': { fx: 'glow', p: { 'glow threshold': ['thr', C.num], 'glow radius': ['radius', C.num], 'glow intensity': ['int', C.num] } },
    'ADBE Glow': { fx: 'glow', p: { 'glow threshold': ['thr', C.num], 'glow radius': ['radius', C.num], 'glow intensity': ['int', C.num] } },
    'ADBE Alpha Glow': { fx: 'glow', p: { glow: ['radius', C.num], 'start color': ['color', C.color] }, set: { colorMix: 60 }, approx: 'Alpha Glow → توهج' },
    'ADBE Tint': { fx: 'tint', p: { 'map black to': ['black', C.color], 'map white to': ['white', C.color], 'amount to tint': ['amount', C.num] } },
    'ADBE Fill': { fx: 'tint', p: { color: ['black', C.color], opacity: ['amount', (v) => C.num(v) <= 1 ? C.num(v) * 100 : C.num(v)] }, post: (o) => { o.white = o.black; } },
    'ADBE HUE SATURATION': { fx: 'hue', p: { 'master hue': ['hue', C.num], 'master saturation': ['sat', C.num], 'master lightness': ['light', C.num] } },
    'ADBE Color Balance (HLS)': { fx: 'hue', p: { hue: ['hue', C.num], lightness: ['light', C.num], saturation: ['sat', C.num] } },
    'ADBE Easy Levels2': { fx: 'levels', p: { 'input black': ['inB', (v) => C.num(v) <= 1 ? C.num(v) * 255 : C.num(v)], 'input white': ['inW', (v) => C.num(v) <= 1 ? C.num(v) * 255 : C.num(v)], gamma: ['gamma', C.num], 'output black': ['outB', (v) => C.num(v) <= 1 ? C.num(v) * 255 : C.num(v)], 'output white': ['outW', (v) => C.num(v) <= 1 ? C.num(v) * 255 : C.num(v)] } },
    'ADBE Levels': { fx: 'levels', p: { 'input black': ['inB', C.num], 'input white': ['inW', C.num], gamma: ['gamma', C.num], 'output black': ['outB', C.num], 'output white': ['outW', C.num] } },
    'ADBE Levels2': { fx: 'levels', p: { 'rgb black input level': ['inB', C.num], 'rgb white input level': ['inW', C.num], 'rgb gamma': ['gamma', (v) => C.num(v) / 100 || 1], 'rgb black output level': ['outB', C.num], 'rgb white output level': ['outW', C.num] } },
    'ADBE Brightness & Contrast 2': { fx: 'brightcon', p: { brightness: ['bri', C.num], contrast: ['con', C.num] } },
    'ADBE Brightness & Contrast': { fx: 'brightcon', p: { brightness: ['bri', C.num], contrast: ['con', C.num] } },
    'ADBE ProcAmp': { fx: 'procamp', p: { brightness: ['bri', C.num], contrast: ['con', C.num], hue: ['hue', C.num], saturation: ['sat', C.num] } },
    'ADBE Black&White': { fx: 'bw', set: { amount: 100 } },
    'ADBE Invert': { fx: 'invert', p: { 'blend with original': ['amount', (v) => 100 - C.num(v)] } },
    'ADBE Posterize': { fx: 'posterize', p: { level: ['levels', C.num] } },
    'ADBE Threshold2': { fx: 'threshold', p: { level: ['level', C.num] } },
    'ADBE Exposure2': { fx: 'exposure', p: { exposure: ['expo', C.num], offset: ['offs', C.num], 'gamma correction': ['gam', C.num] } },
    'ADBE Vibrance': { fx: 'vibrance', p: { vibrance: ['vib', C.num], saturation: ['sat', C.num] } },
    'ADBE Photo Filter': { fx: 'photofilter', p: { color: ['color', C.color], density: ['density', C.num], 'preserve luminosity': ['keep', C.bool] } },
    'ADBE Tritone': { fx: 'tritone', p: { highlights: ['hi', C.color], midtones: ['mid', C.color], shadows: ['sh', C.color], 'blend with original': ['amount', (v) => 100 - C.num(v)] } },
    'ADBE Leave Color': { fx: 'colorpass', p: { 'color to leave': ['key', C.color], tolerance: ['tol', C.num], 'amount to decolor': ['amount', C.num] } },
    'ADBE Color Replace': { fx: 'replcol', p: { 'target color': ['from_', C.color], 'replace color': ['to_', C.color], similarity: ['tol', C.num] } },
    'ADBE Change To Color': { fx: 'replcol', p: { from: ['from_', C.color], to: ['to_', C.color] } },
    'ADBE Gamma Correction': { fx: 'gammafx', p: { gamma: ['gam', (v) => C.num(v) / 10 || 1] } },
    'ADBE Shadow/Highlight': { fx: 'shadhigh', p: { 'shadow amount': ['sh', C.num], 'highlight amount': ['hl', C.num] } },
    'ADBE Channel Mixer': { fx: 'chmix', p: { 'red red': ['rr', C.num], 'red green': ['rg', C.num], 'red blue': ['rb', C.num], 'green red': ['gr', C.num], 'green green': ['gg', C.num], 'green blue': ['gb', C.num], 'blue red': ['br', C.num], 'blue green': ['bg', C.num], 'blue blue': ['bb', C.num] } },
    'ADBE Color Balance 2': { fx: 'colorbal', p: { 'shadow red balance': ['sr', C.num], 'shadow green balance': ['sg', C.num], 'shadow blue balance': ['sb', C.num], 'midtone red balance': ['mr', C.num], 'midtone green balance': ['mg', C.num], 'midtone blue balance': ['mb', C.num], 'highlight red balance': ['hr', C.num], 'highlight green balance': ['hg', C.num], 'highlight blue balance': ['hb', C.num] } },
    'ADBE Color Balance': { fx: 'colorbal', p: { red: ['mr', C.num], green: ['mg', C.num], blue: ['mb', C.num] } },
    'ADBE AEASCCDL': { fx: 'chmix', p: { 'red slope': ['rr', mul(100)], 'green slope': ['gg', mul(100)], 'blue slope': ['bb', mul(100)] }, approx: 'ASC CDL → خلاط القنوات (الميل فقط)' },
    'ADBE Noise': { fx: 'grain', p: { 'amount of noise': ['amount', C.num] }, set: { anim: 1 } },
    'ADBE Noise HLS': { fx: 'grain', p: { lightness: ['amount', C.num], 'grain size': ['size', C.num] }, set: { anim: 1 } },
    'ADBE Noise HLS Auto': { fx: 'grain', p: { lightness: ['amount', C.num], 'grain size': ['size', C.num] }, set: { anim: 1 } },
    'ADBE Drop Shadow': { fx: 'shadow', p: { 'shadow color': ['color', C.color], opacity: ['op', (v) => C.num(v) > 100 ? C.num(v) / 2.55 : C.num(v)], direction: ['dir', C.num], distance: ['dist', C.num], softness: ['soft', C.num] } },
    'ADBE Alpha Adjust': { fx: 'alphaadj', p: { opacity: ['opacity', C.num], 'invert alpha': ['inv', C.bool], 'ignore alpha': ['ignore', C.bool] } },
    'ADBE Wave Warp': { fx: 'wave', p: { 'wave height': ['amp', C.num], 'wave width': ['len', C.num], direction: ['dir', (v) => C.num(v) - 90], 'wave speed': ['speed', C.num] } },
    'ADBE Magnify': { fx: 'magnify', p: { center: ['center', C.pt], magnification: ['mag', C.num], size: ['size', pxPctH] } },
    'ADBE Offset': { fx: 'offsetfx', p: { 'shift center to': ['__shift', C.pt] }, post: (o) => { if (o.__shift) { o.ox = (o.__shift[0] - .5) * 100; o.oy = (o.__shift[1] - .5) * 100; delete o.__shift; } } },
    'ADBE Grid': { fx: 'gridfx', p: { width: ['size', C.num], border: ['width', C.num], color: ['color', C.color], opacity: ['amount', C.num] } },
    'ADBE Mirror': { fx: 'mirror', p: { 'reflection angle': ['mode', (v) => { const a = ((C.num(v) % 360) + 360) % 360; return (a > 45 && a < 135) || (a > 225 && a < 315) ? 'v' : 'h'; }] } },
    'ADBE Turbulent Displace': { fx: 'turb', p: { amount: ['amount', C.num], size: ['size', C.num], evolution: ['evol', C.num] } },
    'ADBE Fractal Noise': { fx: 'fractal', p: { contrast: ['contrast', C.num], brightness: ['bright', C.num], scale: ['scale', C.num], evolution: ['evol', C.num] } },
    'ADBE Ramp': { fx: 'ramp', p: { 'start of ramp': ['a', C.pt], 'start color': ['c1', C.color], 'end of ramp': ['b', C.pt], 'end color': ['c2', C.color], 'ramp shape': ['radial', (v, s) => (C.enumIdx(v, s) === 1 ? 1 : 0)], 'blend with original': ['amount', (v) => 100 - C.num(v)] } },
    'ADBE 4ColorGradient': { fx: 'fourcol', p: { 'color 1': ['c1', C.color], 'color 2': ['c2', C.color], 'color 3': ['c3', C.color], 'color 4': ['c4', C.color], opacity: ['amount', C.num] } },
    'ADBE Lens Flare': { fx: 'flare', p: { 'flare center': ['center', C.pt], 'flare brightness': ['bright', C.num] } },
    'ADBE Lightning': { fx: 'lightning', p: { 'start point': ['a', C.pt], 'end point': ['b', C.pt], 'outside color': ['color', C.color] } },
    'ADBE Lightning 2': { fx: 'lightning', p: { origin: ['a', C.pt], direction: ['b', C.pt], 'glow color': ['color', C.color] } },
    'ADBE Checkerboard': { fx: 'checker', p: { width: ['size', C.num], color: ['c1', C.color], opacity: ['amount', C.num] } },
    'ADBE Circle': { fx: 'circlefx', p: { center: ['center', C.pt], radius: ['radius', pxPctH], 'feather outer edge': ['feather', C.num], color: ['color', C.color], 'invert circle': ['inv', C.bool] } },
    'ADBE Twirl': { fx: 'twirl', p: { angle: ['angle', C.num], 'twirl radius': ['radius', C.num], 'twirl center': ['center', C.pt] } },
    'ADBE Spherize': { fx: 'spherize', p: { radius: ['radius', pxPctH], 'center of sphere': ['center', C.pt] } },
    'ADBE Bulge': { fx: 'spherize', p: { 'horizontal radius': ['radius', pxPctH], 'bulge center': ['center', C.pt], 'bulge height': ['amount', mul(25)] }, approx: 'Bulge → كروية' },
    'ADBE Ripple': { fx: 'ripple', p: { center: ['center', C.pt], 'wave width': ['len', C.num], 'wave height': ['amp', C.num], 'wave speed': ['speed', C.num] } },
    'ADBE Polar Coordinates': { fx: 'polar', p: { interpolation: ['amount', C.num], 'type of conversion': ['mode', sel(['r2p', 'p2r'])] } },
    'ADBE Tile': { fx: 'mtile', p: { 'tile width': ['tx', (v) => Math.max(1, Math.round(100 / Math.max(1, C.num(v))))], 'tile height': ['ty', (v) => Math.max(1, Math.round(100 / Math.max(1, C.num(v))))], 'mirror edges': ['mirrorE', C.bool] } },
    'ADBE Find Edges': { fx: 'findedges', p: { invert: ['inv', C.bool], 'blend with original': ['amount', (v) => 100 - C.num(v)] } },
    'ADBE Emboss': { fx: 'emboss', p: { direction: ['angle', C.num], relief: ['amount', C.num] } },
    'ADBE Color Emboss': { fx: 'emboss', p: { direction: ['angle', C.num], relief: ['amount', C.num] }, set: { colored: 1 } },
    'ADBE Mosaic': { fx: 'pixelate', p: { 'vertical blocks': ['size', (v) => Math.max(2, Math.round(H / Math.max(1, C.num(v))))] } },
    'ADBE Roughen Edges': { fx: 'roughen', p: { border: ['amount', C.num], scale: ['scale', C.num] } },
    'ADBE Strobe': { fx: 'strobe', p: { 'strobe color': ['color', C.color], 'strobe period secs': ['freq', (v) => 1 / Math.max(.01, C.num(v))] } },
    'ADBE Brush Strokes': { fx: 'brush', p: { 'brush size': ['size', C.num] } },
    'ADBE Color Key': { fx: 'ckey', p: { 'key color': ['key', C.color], 'color tolerance': ['tol', (v) => C.num(v) / 2.55], 'edge feather': ['soft', mul(10)] } },
    'ADBE Ultra Key': { fx: 'ultrakey', p: { 'key color': ['key', C.color] } },
    'ADBE Keylight': { fx: 'ultrakey', p: { 'screen colour': ['key', C.color] }, approx: 'Keylight → Ultra Key' },
    'Keylight 906': { fx: 'ultrakey', p: { 'screen colour': ['key', C.color] }, approx: 'Keylight → Ultra Key' },
    'ADBE Linear Color Key2': { fx: 'ckey', p: { 'key color': ['key', C.color], 'matching tolerance': ['tol', C.num], 'matching softness': ['soft', C.num] } },
    'ADBE Luma Key': { fx: 'lkey', p: { threshold: ['thr', (v) => C.num(v) / 2.55], 'edge feather': ['soft', mul(5)] } },
    'ADBE Extract': { fx: 'lkey', p: {}, approx: 'Extract → مفتاح الإضاءة' },
    'ADBE AECrop': { fx: 'crop', p: { left: ['l', C.num], top: ['t', C.num], right: ['r', C.num], bottom: ['b', C.num], 'edge feather': ['feather', C.num] } },
    'ADBE Crop': { fx: 'crop', p: { left: ['l', C.num], top: ['t', C.num], right: ['r', C.num], bottom: ['b', C.num] } },
    'ADBE Horizontal Flip': { fx: 'flip', set: { h: 1, v: 0 } },
    'ADBE Vertical Flip': { fx: 'flip', set: { h: 0, v: 1 } },
    'ADBE Lens Distortion': { fx: 'lens', p: { curvature: ['amount', (v) => -C.num(v)] } },
    'ADBE Optics Compensation': { fx: 'lens', p: { 'field of view fov': ['amount', (v) => C.num(v) / 2] } },
    'ADBE Posterize Time': null, 'ADBE Echo': null,
    // CC (Cycore, ships with AE)
    'CC Kaleida': { fx: 'kaleido', p: { center: ['center', C.pt], size: ['segs', (v) => 6], rotation: ['angle', C.num] } },
    'CC Radial Fast Blur': { fx: 'zblur', p: { center: ['center', C.pt], amount: ['amount', C.num] } },
    'CC Radial Blur': { fx: 'zblur', p: { center: ['center', C.pt], amount: ['amount', C.num] } },
    'CC Light Rays': { fx: 'rays', p: { center: ['center', C.pt], intensity: ['intensity', C.num], radius: ['length_', (v) => C.num(v) / 2] } },
    'CC Lens': { fx: 'lens', p: { size: ['amount', (v) => C.num(v) / 2] } },
    'CC Toner': { fx: 'tritone', p: { highlights: ['hi', C.color], midtones: ['mid', C.color], shadows: ['sh', C.color], 'blend w original': ['amount', (v) => 100 - C.num(v)] } },
    'CC Vignette': { fx: 'vignette', p: { amount: ['amount', C.num] } },
    'CC Threshold': { fx: 'threshold', p: { threshold: ['level', C.num] } },
    'CC Cross Blur': { fx: 'gblur', p: { radius_x: ['amount', C.num] }, approx: 'CC Cross Blur → ضبابية غاوسية' },
    'CC Vector Blur': { fx: 'gblur', p: { amount: ['amount', C.num] }, approx: 'CC Vector Blur → ضبابية غاوسية' },
    'CC Color Offset': { fx: 'rgbsplit', p: {}, approx: 'CC Color Offset → انفصال الألوان' },
    'CC Simple Wire Removal': null,
    // third-party approximations (the original plug-in is not available inside QassQass)
    'Mettle SkyBox Glow': { fx: 'glow', p: { 'glow radius': ['radius', (v) => C.num(v) / 8] }, approx: 'Mettle SkyBox Glow → توهج' },
    'Mettle SkyBox Chromatic Aberrations': { fx: 'chroma', p: { 'aberration blue': ['amount', (v) => Math.abs(C.num(v)) / 2] }, approx: 'Mettle → انحراف لوني' },
    'Mettle SkyBox Digital Glitch': { fx: 'glitch', p: { 'master amplitude': ['amount', C.num] }, approx: 'Mettle Digital Glitch → جليتش رقمي' },
    'Mettle SkyBox Fractal Noise': { fx: 'fractal', p: { contrast: ['contrast', C.num], brightness: ['bright', C.num], evolution: ['evol', C.num] }, approx: 'Mettle Fractal Noise → ضجيج كسوري' },
    'Mettle SkyBox Sharpen': { fx: 'sharpen', p: { 'sharpen amount': ['amount', C.num] }, approx: 'Mettle Sharpen → حدّة' },
    'Mettle SkyBox Color Gradients': { fx: 'fourcol', p: { 'color 1': ['c1', C.color], 'color 2': ['c2', C.color], 'color 3': ['c3', C.color], 'color 4': ['c4', C.color], opacity: ['amount', C.num] }, approx: 'Mettle Color Gradients → تدرج أربعة ألوان' }
  };
  Object.assign(MAP, {
    'ADBE Easy Levels': MAP['ADBE Easy Levels2'], 'ADBE Pro Levels': MAP['ADBE Easy Levels2'], 'ADBE Pro Levels2': MAP['ADBE Easy Levels2'],
    'ADBE Noise HLS Auto2': MAP['ADBE Noise HLS Auto'], 'ADBE Noise HLS2': MAP['ADBE Noise HLS'], 'ADBE Box Blur': MAP['ADBE Box Blur2'], 'ADBE CHANNEL MIXER': MAP['ADBE Channel Mixer'],
    'ADBE Median': { fx: 'gblur', p: { radius: ['amount', C.num] }, approx: 'Median → ضبابية غاوسية' },
    'ADBE Dust & Scratches': { fx: 'gblur', p: { radius: ['amount', C.num] }, approx: 'Dust & Scratches → ضبابية غاوسية' },
    'ADBE Replicate': { fx: 'replicate', p: { count: ['count', C.num] } },
    'ADBE RGB Color Corrector': { fx: 'gammafx', p: { gamma: ['gam', C.num] }, approx: 'RGB Color Corrector → تصحيح جاما' },
    'ADBE Lumetri': { fx: 'lumetri', p: { temperature: ['temp', C.num], tint: ['tint', C.num], saturation: ['sat', C.num], exposure: ['exposure', C.num], contrast: ['contrast', C.num], highlights: ['highlights', C.num], shadows: ['shadows', C.num], whites: ['whites', C.num], blacks: ['blacks', C.num], 'faded film': ['fade', C.num], vibrance: ['vib', C.num] } },
    'CS Vignette': { fx: 'vignette', p: { amount: ['amount', C.num] }, approx: 'CS Vignette → تظليل الأطراف' },
    'ADBE LightingEffect': null, 'ADBE Corner Pin': null, 'ADBE Arithmetic': null, 'ADBE Calculations': null, 'ADBE Paint Bucket': null, 'ADBE Text': null
  });
  // AE «Behaviors» (pseudo-effects driven by expressions) → keyframes / effects of ours
  AI.BEHAVIOR = {
    'ADBE CM FadeInOutFrames': 'fade', 'ADBE CM FadeInOutmsec': 'fade', 'ADBE CM Spin': 'spin', 'ADBE CM WigglePosition': 'shake', 'ADBE CM WiggleRotation': 'shake', 'ADBE CM WiggleScale': 'shake', 'ADBE CM Wigglerama': 'shake', 'ADBE CM WiggleShear': 'shake', 'ADBE CM WiggleGelatin': 'shake',
    'ADBE CM ScaleBounceRandom': 'shake', 'ADBE CM OpacityFlashRandom': 'strobe', 'ADBE CM OpacityFlashMarkers': 'strobe', 'ADBE CM LightLeaksRandom': 'leak', 'ADBE CM LightLeaksMarkers': 'leak', 'ADBE CM Throw': 'drift', 'ADBE CM AutoscrollHorizontal': 'drift', 'ADBE CM AutoscrollVertical': 'drift'
  };
  // AE transition presets built from «CM Trans*» pseudo-effects → QassQass transitions
  const AI_TR_EXTRA = ({ 'ADBE CM TransDissolve': 'dissolve', 'ADBE CM DissolveUnmelt': 'dissolve', 'ADBE CM TransFade': 'dipBlack', 'ADBE CM TransFadeMask': 'lumaFade', 'ADBE CM TransIris': 'iris', 'ADBE IRIS_WIPE': 'iris', 'ADBE CM TransWipe': 'wipeL', 'ADBE CM TransSlide': 'slideL', 'ADBE CM SlideVariable': 'slideL', 'ADBE CM TransStretch': 'stretchT', 'ADBE CM TransCard': 'flipOver', 'ADBE CM TransCorner': 'wipeD', 'ADBE CM TransDirection': 'wipeR', 'ADBE CM TransRadial': 'clock', 'ADBE CM CornerReveal': 'wipeD', 'ADBE CM GridWipe': 'checkerW', 'APC CardWipeCam': 'flipOver', 'ADBE CM Zoom2DSpin': 'spin', 'ADBE CM Zoom3DTumble': 'spin', 'ADBE CM ZoomBubble': 'zoomIn', 'ADBE CM ZoomSpiral': 'spin', 'ADBE CM ZoomWobble': 'zoomIn', 'ADBE CM FlyToInset': 'zoomIn' });
  // audio effects inside presets (AE «ADBE Aud *», Premiere internal / GUID audio filters by display name)
  AI.AUDIO = [[/Aud Reverb|Reverb/i, 'reverb', { mix: 30, size: 2 }], [/Lowpass|Low ?Pass/i, 'lowpass', { freq: 4000 }], [/Highpass|High ?Pass/i, 'highpass', { freq: 120 }], [/Bass/i, 'eq3', { low: 6, mid: 0, high: 0 }], [/Treble/i, 'eq3', { low: 0, mid: 0, high: 6 }], [/Dynamics|Compressor/i, 'comp', { thr: -24, ratio: 4 }], [/Delay|Echo/i, 'delay', { time: .3, fb: 35, mix: 30 }], [/Flanger|Chorus/i, 'delay', { time: .02, fb: 50, mix: 40 }], [/Gain|Amplify|Volume/i, 'gain', { db: 0 }]];
  // AE text presets (ADBE Text Animators) → our text animators, by preset name
  AI.TEXT = [[/typewriter|decoder|type ?on|characters? (shuffle|in)|random (fade|shuffle)/i, 'typewriter'], [/blur|smoke|fog|foggy/i, 'blurIn'], [/bounce|drop|rain|pop|buzz|jump/i, 'bounce'], [/fly|slide|swing|wipe|sweep|twist/i, 'slideSide'], [/scale|zoom|grow|shrink|center spiral|spin/i, 'scaleIn'], [/fade.*out|out$|evaporate|dissolve out/i, 'fadeOutWord'], [/fade|up|reveal|in$/i, 'fadeUpWord']];
  AI.textPresetFor = (name) => { const n = String(name || '').replace(/\.ffx$/i, ''); for (const [re, id] of AI.TEXT) if (re.test(n)) return id; return 'fadeUpWord'; };
  // Adobe transition-type effects (single clip, keyframed completion) → suggested QassQass transitions
  AI.TRANSITION_FX = Object.assign({ 'ADBE Block Dissolve': 'randBlocks', 'ADBE Gradient Wipe': 'gradW', 'ADBE Venetian Blinds': 'blinds', 'ADBE Linear Wipe': 'wipeL', 'ADBE Radial Wipe': 'clock', 'ADBE IRIS': 'iris', 'ADBE Iris Wipe': 'iris', 'ADBE Card Wipe': 'flipOver', 'CC Scale Wipe': 'stretchT', 'CC Radial ScaleWipe': 'iris', 'CC Grid Wipe': 'checkerW', 'CC Jaws': 'zigzag', 'CC Line Sweep': 'wipeL', 'CC Twister': 'spin', 'CC Glass Wipe': 'dissolve', 'CC Light Wipe': 'flash', 'CC Image Wipe': 'gradW' }, AI_TR_EXTRA);
  // non-effects carried in presets: masks, expression controls, AE helper effects → ignored (reported, never block a preset)
  const IGNORE = new Set(['ADBE AEMask', 'ADBE AEMask2', 'ADBE Effect Built In Params', 'ADBE Solid Composite', 'ADBE Slider Control', 'ADBE Point Control', 'ADBE Angle Control', 'ADBE Checkbox Control', 'ADBE Color Control', 'ADBE Layer Control', 'ADBE Mask Parade', 'ADBE Mask Atom', 'ADBE GROW BOUNDS', 'ADBE Set Matte2', 'ADBE Set Matte3']);
  AI.IGNORE = IGNORE;
  const VENDOR = (m) => {
    if (/^S_/.test(m)) return 'Boris FX Sapphire'; if (/^BCC|^Boris/.test(m)) return 'Boris FX Continuum'; if (/Mettle/.test(m)) return 'Mettle SkyBox'; if (/^Universe|^uni\./i.test(m)) return 'Red Giant Universe';
    if (/^tc |Trapcode|^3DStroke|Shine|Starglow|Particular/i.test(m)) return 'Red Giant Trapcode'; if (/^MB|Magic Bullet|Looks/i.test(m)) return 'Red Giant Magic Bullet'; if (/^VIDEOCOPILOT|^VC |Optical Flares|Element/i.test(m)) return 'Video Copilot';
    if (/^APC /.test(m)) return 'Adobe (Psunami/Particle legacy)'; if (/^CC /.test(m)) return 'Cycore CC'; if (/^ADBE /.test(m)) return 'Adobe'; if (/^[0-9a-f-]{36}$/i.test(m) || /^\d+ /.test(m)) return 'Premiere (audio/internal)'; return 'third-party';
  };
  AI.vendorOf = VENDOR;
  const pkey = (s) => norm(s).replace(/\s+/g, ' ');
  // value at time + keyframes for a parsed param, converted by fn
  const conv = (p, fn, src) => {
    const out = { v: fn(p.v, src) };
    if (p.keys && p.keys.length > 1) out.k = p.keys.map(k => ({ t: k.t, e: k.e || 'ease', v: fn(k.v, src) }));
    return out;
  };
  const isNumP = (x) => typeof x.v === 'number';
  /* mapEffects(effects, src) → { fx:[{type, params:{k:{v,k?}}}], motion:{pos,scale,rot,anchor}, opacity, blend, unmapped:[{match,name,reason,vendor,suggest}], approx:[], total, mapped } */
  AI.mapEffects = (effects, src, fxDefs) => {
    const FXD = fxDefs || (root.GW && root.GW.FX) || null;
    const res = { fx: [], motion: {}, opacity: null, unmapped: [], approx: [], ignored: [], total: 0, mapped: 0 };
    for (const e of effects) {
      const m = e.match;
      if (IGNORE.has(m)) { res.ignored.push(m); continue; }
      res.total++;
      const P = new Map(); for (const p of e.params) { const k = pkey(p.name); if (k && !P.has(k)) P.set(k, p); } P.src = src;
      const g = (n) => P.get(n);
      if (m === 'ADBE Motion' || m === 'ADBE Graphic Group') { // Premiere Motion: normalized pos/anchor, scale %, rotation °
        const pos = g('position'), sc = g('scale'), rot = g('rotation'), an = g('anchor point');
        if (pos) res.motion.pos = conv(pos, C.pt, src); if (sc) res.motion.scale = conv(sc, C.num, src); if (rot) res.motion.rot = conv(rot, C.num, src); if (an) res.motion.anchor = conv(an, C.pt, src);
        res.mapped++; continue;
      }
      if (m === 'ADBE Basic 3D') { // swivel / tilt → 3D layer rotation (QassQass 3D layers: motion.rotY / rotX / posZ)
        const sw = g('swivel'), ti = g('tilt'), di = g('distance to image'); res.motion3d = {};
        if (sw) res.motion3d.rotY = conv(sw, C.num, src); if (ti) res.motion3d.rotX = conv(ti, C.num, src); if (di) res.motion3d.posZ = conv(di, mul(10), src);
        res.approx.push('Basic 3D → طبقة ثلاثية الأبعاد'); res.mapped++; continue;
      }
      if (m === 'ADBE Opacity') { const op = g('opacity'); if (op) res.opacity = conv(op, C.num, src); const bm = g('blend mode'); if (bm && typeof bm.v === 'number' && bm.v) res.blend = bm.v; res.mapped++; continue; }
      if (m === 'ADBE Geometry' || m === 'ADBE Geometry2') { // Transform effect → our xform (+ alphaadj for its opacity)
        const params = {}; const sc = g('scale height') || g('scale'), rot = g('rotation'), sk = g('skew'), pos = g('position'), an = g('anchor point'), op = g('opacity');
        const scW = g('scale width'), uni = g('uniform scale') || g('');
        if (sc) params.scale = conv(sc, (v) => Math.abs(C.num(v)), src); if (rot) params.rot = conv(rot, C.num, src); if (sk) params.skew = conv(sk, C.num, src);
        const flipH = (sc && C.num(sc.v) < 0 && uni && C.num(uni.v)) || (scW && C.num(scW.v) < 0 && !(uni && C.num(uni.v))), flipV = sc && C.num(sc.v) < 0 && !(uni && C.num(uni.v));
        if (flipH || flipV) res.fx.push({ type: 'flip', params: { h: { v: flipH ? 1 : 0 }, v: { v: flipV ? 1 : 0 } }, from: m, name: e.name });
        if (pos) { const a = an ? C.pt(an.v) : [.5, .5]; const off = (v, i) => (C.pt(v)[i] - a[i]) * 100; params.ox = conv(pos, (v) => off(v, 0), src); params.oy = conv(pos, (v) => off(v, 1), src); }
        res.fx.push({ type: 'xform', params, from: m, name: e.name });
        if (op && (op.keys && op.keys.length > 1 || C.num(op.v) < 100)) res.fx.push({ type: 'alphaadj', params: { opacity: conv(op, C.num, src) }, from: m, name: e.name });
        const sh = g('shutter angle'); if (sh && C.num(sh.v) > 0 && !g('use composition s shutter angle')?.v) res.fx.push({ type: 'dblur', params: { len: { v: Math.min(60, C.num(sh.v) / 12) } }, from: m, name: 'Shutter', approx: 1 });
        res.mapped++; continue;
      }
      if (AI.BEHAVIOR[m]) { // AE behaviours: expression-driven → our closest keyframes/effects
        const b = AI.BEHAVIOR[m]; const num = (n, d) => { const p = g(n); return p ? C.num(p.v) : d; };
        if (b === 'fade') { const fi = num('fade in duration frames', num('fade in duration milliseconds', 500) / 33.3), fo = num('fade out duration frames', num('fade out duration milliseconds', 500) / 33.3); res.fadeInOut = [fi / 30, fo / 30]; }
        else if (b === 'spin') res.spin = num('rotation speed degrees per second', 90);
        else if (b === 'shake') res.fx.push({ type: 'shake', params: { amount: { v: Math.min(100, num('wiggle amount', num('position wiggle amount', 12))) }, freq: { v: Math.min(30, num('wiggle speed wiggles per second', 3)) } }, from: m, name: e.name, approx: 1 });
        else if (b === 'strobe') res.fx.push({ type: 'strobe', params: {}, from: m, name: e.name, approx: 1 });
        else if (b === 'leak') res.fx.push({ type: 'leak', params: {}, from: m, name: e.name, approx: 1 });
        else if (b === 'drift') res.drift = 1;
        res.approx.push('Behavior → ' + b); res.mapped++; continue;
      }
      const au = /^ADBE Aud |^Internal |Flanger|Dynamics|^\d{10} |^[0-9a-f]{8}-/i.test(m) ? AI.AUDIO.find(([re]) => re.test(m + ' ' + (e.name || ''))) : null;
      if (au) { const params = {}; for (const k in au[2]) params[k] = { v: au[2][k] }; (res.afx = res.afx || []).push({ type: au[1], params, from: m, name: e.name }); res.mapped++; continue; }
      const T = MAP[m];
      if (T === undefined || T === null) {
        const sug = AI.TRANSITION_FX[m]; if (sug) res.transition = res.transition || sug;
        res.unmapped.push({ match: m, name: e.name, vendor: VENDOR(m), suggest: sug || null, reason: sug ? 'transition' : (VENDOR(m) === 'Adobe' || VENDOR(m) === 'Cycore CC' ? 'no-equivalent' : 'third-party') });
        continue;
      }
      if (FXD && !FXD[T.fx]) { res.unmapped.push({ match: m, name: e.name, vendor: VENDOR(m), reason: 'missing-fx:' + T.fx }); continue; }
      const params = {}; for (const k in (T.set || {})) params[k] = { v: T.set[k] };
      for (const [name, [key, fn]] of Object.entries(T.p || {})) { const p = g(name); if (!p || p.v == null) continue; try { params[key] = conv(p, fn, src); } catch (er) { /* skip bad value */ } }
      if (T.post) { const flat = {}; for (const k in params) flat[k] = params[k].v; const before = JSON.stringify(flat); T.post(flat, P); if (JSON.stringify(flat) !== before) { for (const k in params) if (!(k in flat)) delete params[k]; for (const k in flat) if (k !== '__type' && (!params[k] || params[k].v !== flat[k])) params[k] = { v: flat[k] }; } if (flat.__type) { res.fx.push({ type: flat.__type, params, from: m, name: e.name, approx: T.approx ? 1 : 0 }); res.mapped++; if (T.approx) res.approx.push(T.approx); continue; } }
      // clamp to our ranges / drop unknown keys
      if (FXD && FXD[T.fx]) for (const k in params) { const d = FXD[T.fx].p.find(x => x.k === k); if (!d) { delete params[k]; continue; } if (d.t === 'num') { const cl = (x) => Math.max(d.min, Math.min(d.max, +x || 0)); params[k].v = cl(params[k].v); if (params[k].k) params[k].k.forEach(q => { q.v = cl(q.v); }); } }
      res.fx.push({ type: T.fx, params, from: m, name: e.name, approx: T.approx ? 1 : 0 }); if (T.approx) res.approx.push(T.approx);
      res.mapped++;
    }
    res.status = !res.total ? (res.ignored.length ? 'none' : 'empty') : res.mapped === res.total ? (res.approx.length ? 'approx' : 'full') : res.mapped ? 'partial' : 'none';
    return res;
  };
  // ffx layer properties (Transform group) → motion / opacity
  AI.mapProps = (props, res) => {
    const by = (m) => props.find(p => p.match === m);
    const op = by('ADBE Opacity'); if (op && (op.keys || op.v != null)) res.opacity = conv(op, C.num, 'ffx');
    const sc = by('ADBE Scale'); if (sc && sc.keys) res.motion.scale = conv(sc, (v) => Array.isArray(v) ? v[0] : v, 'ffx');
    const rz = by('ADBE Rotate Z'); if (rz && rz.keys) res.motion.rot = conv(rz, C.num, 'ffx');
    const ps = by('ADBE Position'); if (ps && ps.keys) res.motion.posDelta = conv(ps, (v) => Array.isArray(v) ? v.slice(0, 2) : [0, 0], 'ffx');
    const txt0 = props.some(p => p.path && p.path.some(x => /^ADBE Text/.test(x)) || /^ADBE Text/.test(p.match));
    if (txt0) res.text = true;
    return res;
  };
  AI.mapPreset = (pr, fxDefs) => {
    const src = pr.kind === 'ffx' ? 'ffx' : 'prem';
    const r = AI.mapEffects(pr.effects || [], src, fxDefs);
    if (pr.props && pr.props.length) {
      AI.mapProps(pr.props, r); if (r.opacity || Object.keys(r.motion).length) { r.total++; r.mapped++; }
      if (r.text) { r.total++; r.mapped++; r.textAnim = AI.textPresetFor(pr.name); r.approx.push('Text → ' + r.textAnim); }
      else if (pr.props.some(p => p.path && p.path.includes('ADBE Mask Parade'))) r.ignored.push('ADBE Mask Parade');
    }
    if (!r.total && r.ignored.length) r.status = 'none';
    else r.status = !r.total ? 'empty' : r.mapped === r.total ? (r.approx.length ? 'approx' : 'full') : r.mapped ? 'partial' : (r.transition ? 'transition' : 'none');
    if (r.status === 'none' && r.transition) r.status = 'transition';
    r.kind = r.textAnim ? 'text' : r.transition && !r.fx.length ? 'transition' : r.afx && !r.fx.length ? 'audio' : 'video';
    return r;
  };

  /* ================= export presets (.epr) ================= */
  AI.parseEPR = (text, file) => {
    const X = AI.xml(text); const P = {};
    const visit = (n) => { if (n.tag === 'ExportParam' || /Param$/.test(n.tag)) { const id = txt(n, 'ParamIdentifier'); const v = txt(n, 'ParamValue'); if (id && v !== '' && !(id in P)) P[id] = v; } n.k.forEach(visit); };
    visit(X);
    const root0 = X.k[0] || X; const presetName = txt(root0, 'PresetName') || (root0.a && root0.a.PresetName) || '';
    const clean = (x) => String(x || '').replace(/^\(?\$\$\$\/[^=]*=/, '').replace(/\)$/, '').trim();
    const name = clean(presetName) || String(file || '').split(/[\\/]/).pop().replace(/\.epr$/i, '');
    const num = (...ks) => { for (const k of ks) if (P[k] != null && isFinite(+P[k])) return +P[k]; return null; };
    const cc = (v) => { const n = +v; if (!isFinite(n) || n < 0x20000000 || n > 0xffffffff) return ''; return String.fromCharCode(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255); }; // numeric FourCC → 'H264'
    const fmtRaw = cc(txt(root0, 'ExporterFileType')) + ' ' + cc(P.ADBEVideoCodec) + ' ' + cc(txt(root0, 'ExporterClassID')) + ' ' + (txt(root0, 'ExporterFileType') || '') + ' ' + (txt(root0, 'ExporterClassID') || '') + ' ' + (txt(root0, 'ExporterName') || '') + ' ' + (P.ADBEVideoCodec || '') + ' ' + String(file || '');
    const w = num('ADBEVideoWidth'), h = num('ADBEVideoHeight'); const fpsT = num('ADBEVideoFPS'); const fps = fpsT ? Math.round(TPS / fpsT * 1000) / 1000 : null;
    let vbr = num('ADBEVideoTargetBitrate', 'ADBEVideoMaxBitrate'); const audioOnly = !w && !h && (/audio|aiff|wav|mp3|aac/i.test(name + ' ' + fmtRaw) || P.ADBEVideoEnable === 'false');
    const codec = /hevc|h\.?265|48455643/i.test(fmtRaw) ? 'hevc' : /h\.?264|4e49434b|48323634|avc/i.test(fmtRaw + name) ? 'h264' : /prores|apcn|apch|4d6f6f56|quicktime/i.test(fmtRaw) ? 'prores' : /mp3|4d503320/i.test(fmtRaw + name) ? 'mp3' : /wav|57415645|aiff|41494646/i.test(fmtRaw + name) ? 'wav' : /png/i.test(fmtRaw + name) ? 'png' : /jpe?g/i.test(fmtRaw + name) ? 'jpg' : /gif/i.test(fmtRaw + name) ? 'gif' : /mxf|dnx|4d584620/i.test(fmtRaw + name) ? 'mxf' : 'other';
    const folder = txt(root0, 'FolderDisplayPath'); const internal = /SequencePreview|ConsolidateAndTranscode|IngestPresets|EncoderPresets[\\/](?!.*[\\/])/i.test(String(file || '')) && !/MediaIO/i.test(String(file || ''));
    return { kind: 'epr', name, folder, internal, file, w, h, fps, vbr, audioOnly, codec, abr: num('ADBEAudioBitrate'), srate: num('ADBEAudioRatePerSecond'), fieldCount: Object.keys(P).length };
  };
  AI.mapEPR = (e) => {
    if (e.internal) return null;
    const fmt = e.audioOnly ? (e.codec === 'mp3' ? 'mp3' : 'wav') : ({ h264: 'mp4', hevc: 'mp4h265', prores: 'mov', mxf: 'mov', png: 'png', jpg: 'jpg', gif: 'gif', mp3: 'mp3', wav: 'wav' }[e.codec] || null);
    if (!fmt) return null;
    const f = { fmt, audio: 1, alpha: 0, hw: 1 };
    if (!e.audioOnly) { const short = e.w && e.h ? Math.min(e.w, e.h) : null; f.h = short || 'seq'; f.fps = e.fps ? String(Math.round(e.fps * 100) / 100).replace(/\.0+$/, '') : 'seq'; f.q = e.vbr && e.vbr >= 30 ? 'best' : e.vbr && e.vbr < 8 ? 'medium' : 'high'; }
    const p = { name: 'أدوبي: ' + e.name, f }; if (e.w && e.h && e.h > e.w) p.aspect = e.w / e.h; else if (e.w && e.h && e.w === e.h) p.aspect = 1;
    return p;
  };

  /* ================= Essential Sound (.essentialsound) ================= */
  const ES_EQ = ['background', 'intercom', 'trunk', 'radio', 'telephone', 'tv', 'bass', 'treble', 'vocal', 'loudness'];
  AI.parseEssentialSound = (json, file) => {
    const d = typeof json === 'string' ? JSON.parse(json) : json; const pd = d.PresetData || {}; const M = pd.Models || {};
    const nm = String(d.Name || '').replace(/^\$\$\$\/[^=]*=/, '') || String(file || '').split(/[\\/]/).pop().replace(/\.essentialsound$/i, '');
    return { kind: 'essentialsound', name: nm, mode: pd.ModeID || 'dialog', isConfig: !pd.Config && M.model_clarity && !Array.isArray(M.model_clarity), models: M, file };
  };
  AI.mapEssentialSound = (es) => {
    if (es.isConfig) return null; const M = es.models; const a = (k) => (Array.isArray(M[k]) ? M[k] : []); const fx = []; const fx_ = (type, params) => fx.push({ type, params });
    const R = a('model_restoration'), Cl = a('model_clarity'), Sx = a('model_soundeffects'), V = a('model_volume'), L = a('model_loudness');
    // repair: [on, noise_on, noise, rumble_on, rumble, dehum_on, dehum, deess_on, deess, hum_hz, reverb_on, reverb]
    if (R[0] && R[3]) fx_('highpass', { freq: Math.round(60 + (+R[4] || 0) * 10) });
    if (R[0] && R[7]) fx_('deesser', { freq: 6500, thr: Math.round(-20 - (+R[8] || 0) * 3), ratio: 6 });
    // clarity: [on, dynamics_on, dynamics, eq_on, eq_amount, eq_preset, enhance_on, high_tone, …]
    if (Cl[0] && Cl[3]) { const pre = ES_EQ[Cl[5]] || ''; const amt = Math.min(1, (+Cl[4] || 0) / 10); if (/radio|telephone|intercom|trunk|tv/.test(pre)) fx_('radio', { amount: Math.round(amt * 100) }); else if (pre === 'bass') fx_('eq3', { low: Math.round(amt * 6), mid: 0, high: 0 }); else if (pre === 'treble') fx_('eq3', { low: 0, mid: 0, high: Math.round(amt * 6) }); else if (pre) fx_('eq3', { low: Math.round(amt * 2), mid: Math.round(amt * 3), high: Math.round(amt * 2) }); }
    if (Cl[0] && Cl[1]) fx_('comp', { thr: Math.round(-16 - (+Cl[2] || 0) * 1.4), ratio: Math.round((1.5 + (+Cl[2] || 0) * .35) * 10) / 10 });
    // creative reverb: [on, reverb_on, amount, preset]
    if (Sx[0] && Sx[1]) fx_('reverb', { mix: Math.round(Math.min(100, (+Sx[2] || 0) * 10)), size: Math.round((1 + (+Sx[3] || 0) * .4) * 10) / 10 });
    // clip volume: [on, level_on, dB]
    if (V[0] && V[1] && +V[2]) fx_('gain', { db: Math.round(+V[2] * 10) / 10 });
    if (L[0] && L[1]) fx_('limiter', { ceil: -1 });
    return { n: 'أدوبي: ' + es.name, cat: { dialog: 'حوار', music: 'موسيقى', sfx: 'مؤثرات', ambience: 'أجواء' }[es.mode] || 'أدوبي', fx, duck: es.mode === 'music' && !!(M.model_ducking && M.model_ducking[0]) };
  };

  /* ================= Red Giant Universe (.rgx) ================= */
  AI.parseRGX = (json, file) => {
    const d = typeof json === 'string' ? JSON.parse(json) : json; const blk = ((d.content || {}).blocks || []).find(b => b.block_type_id === 'param.stream') || {}; const v = blk.values || {};
    const f = String(file || ''); const dir = f.replace(/[\\/][^\\/]*$/, ''); const base = f.split(/[\\/]/).pop().replace(/\.rgx$/i, ''); const sep = f.includes('\\') ? '\\' : '/';
    return { kind: 'rgx', name: (d.naming && d.naming.name) || base, plugin: v.matchname || '', version: v.plugin_version || '', params: (v.param_streams || []).map(p => ({ name: p.name, type: p.type, v: p.value })), preview: dir ? dir + sep + '_media' + sep + base + '-preview.mp4' : null, thumb: dir ? dir + sep + '_media' + sep + base + '-thumbnail.png' : null, file };
  };
  // Universe effect → QassQass original (ids checked against GW.FX at runtime; missing ones are listed as reference only)
  // Universe effect → QassQass candidates, best first: the effects engineer's originals (fx_pro.js: deepglow, glimmer, holo…) then
  // the basic equivalent. Transitions resolve against GW.TRANS. Ids missing in this build are skipped; none left → «reference only».
  const U = (fx, ...alt) => [fx, ...alt];
  AI.UNIVERSE = {
    Universe_Blur_Blur_Premium: U('gblur'), Universe_Blur_Box_Bokeh: U('bokeh', 'lensblur'), Universe_Blur_Compound_Blur_Premium: U('bokeh', 'lensblur'), Universe_Blur_Spot_Blur: U('tiltshift', 'lensblur'),
    Universe_CrumplePop_Finisher: U('sharpen2', 'unsharp'), Universe_CrumplePop_Fisheye_Fixer: U('lensdist', 'lens'), Universe_CrumplePop_Grain16: U('filmgrain', 'grain'), Universe_CrumplePop_OverLight: U('leak2', 'leak'), Universe_CrumplePop_ShrinkRay: U('tiltshift', 'lensblur'),
    Universe_Distort_Camera_Shake_Pro: U('handheld', 'shake'), Universe_Distort_Chromatic_Aberration: U('lensdist', 'chroma'), Universe_Distort_Heatwave: U('heatwave', 'turb'), Universe_Distort_Picture_in_Picture: U('xform'), Universe_Distort_Prism_Displacement: U('prism', 'rgbsplit'), Universe_Distort_RGB_Separation: U('rgbsplit'),
    Universe_Generators_Fractal_Background: U('fractal'), Universe_Generators_Gradient_Ramp: U('ramp'), Universe_Generators_Soft_Gradient_Background: U('fourcol'), Universe_Generators_Spectralicious: U('spectral', 'fourcol'),
    Universe_Glow_Chromatic_Glow: U('chromaglow', 'glow'), Universe_Glow_Edge_Glow_Premium: U('edgeglow', 'glow'), Universe_Glow_Glimmer: U('glimmer', 'glow'), Universe_Glow_Glo_Fi_Premium: U('deepglow', 'glow'), Universe_Glow_Glow: U('deepglow', 'glow'), Universe_Glow_Point_Zoom: U('pointzoom', 'zblur'), Universe_Glow_Quantum: U('deepglow', 'glow'),
    Universe_Motion_Graphics_HUD_Components: U('hud'), Universe_Motion_Graphics_Reframe: U('xform'), Universe_Noise_Turbulence_Noise: U('turbnoise', 'fractal'),
    Universe_Stylize_Analog: U('vhsreal', 'vhs'), Universe_Stylize_Carousel: U('mtile'), Universe_Stylize_ChromaTown: U('multitone', 'duotone'), Universe_Stylize_Electrify: U('electrify', 'lightning'), Universe_Stylize_Glitch: U('datamosh', 'glitch'), Universe_Stylize_Holomatrix: U('holo', 'scanlines'),
    Universe_Stylize_Knoll_Light_Factory_EZ: U('lensflare', 'flare'), Universe_Stylize_Misfire_Premium: U('filmdamage', 'grain'), Universe_Stylize_Multitone: U('multitone', 'tritone'), Universe_Stylize_Noir_Moderne: U('noir', 'bw'), Universe_Stylize_RetroGrade: U('olddoc', 'sepia'), Universe_Stylize_Sketchify: U('sketch', 'findedges'),
    Universe_Stylize_Symbol_Mapper: U('print', 'halftone'), Universe_Stylize_Texturize: U('texturize', 'emboss'), Universe_Stylize_Texturize_Motion: U('texturize', 'emboss'), Universe_Stylize_VHS: U('vhsreal', 'vhs'),
    Universe_Text_Long_Shadow: U('longshadow', 'shadow'), Universe_Text_Luster: U('luster', 'glow'), Universe_Text_Glo_Fi_II: U('neon', 'glow'), Universe_Utilities_Unmult_Premium: U('unmult')
  };
  AI.UNIVERSE_TR = {
    Universe_Transitions_Blinds: U('blinds'), Universe_Transitions_Camera_Shake_Transition: U('whipBlur', 'whip'), Universe_Transitions_Carousel_Transition: U('cube'), Universe_Transitions_Channel_Blur: U('chromaT'), Universe_Transitions_Channel_Surf: U('glitchCut', 'glitchT'),
    Universe_Transitions_Clock_Wipe: U('clock'), Universe_Transitions_Color_Mosaic: U('pixelT'), Universe_Transitions_Color_Stripe: U('bandSlide'), Universe_Transitions_Cube: U('cube'), Universe_Transitions_Diamond_Wave: U('irisDiamond'), Universe_Transitions_Dolly_Fade: U('zoomThrough', 'crossZoom'),
    Universe_Transitions_Exposure_Blur: U('expBlur', 'blurx'), Universe_Transitions_Film_Transition: U('filmBurn', 'filmDiss'), Universe_Transitions_Flicker_Cut: U('flickerCut', 'flash'), Universe_Transitions_Fold: U('flipOver'), Universe_Transitions_Glitch_Transition: U('glitchCut', 'glitchT'),
    Universe_Transitions_HalfLight: U('leakWipe', 'lightLeakT'), Universe_Transitions_Inside_Cube: U('insideCube', 'cube'), Universe_Transitions_Knoll_Light_Transition: U('flareT', 'lightLeakT'), Universe_Transitions_Linear_Wipe: U('wipeL'), Universe_Transitions_RetroGrade_Transition: U('filmBurn', 'filmDiss'),
    Universe_Transitions_Rubics_Cube: U('cube'), Universe_Transitions_Shape_Wipe: U('shapeWipe', 'iris'), Universe_Transitions_Slide: U('slideL'), Universe_Transitions_Soft_Edge_Wipe_Premium: U('gradW'), Universe_Transitions_Spectralicious_Transition: U('neonSweep'), Universe_Transitions_Stretch: U('stretchT'),
    Universe_Transitions_Swish_Pan_Premium: U('whipBlur', 'whip'), Universe_Transitions_Triangle_Wave: U('zigzag'), Universe_Transitions_Turbulence_Transition: U('dissolve'), Universe_Transitions_Unfold: U('flipOver'), Universe_Transitions_VHS_Transition: U('vhsRewind', 'glitchT'), Universe_Transitions_Warp: U('warpT', 'zoomBlurT')
  };
  AI.universeTarget = (plugin, fxDefs, trDefs) => {
    const FXD = fxDefs || (root.GW && root.GW.FX) || {}; const TRD = trDefs || (root.GW && root.GW.TRANS) || {};
    const own = Object.keys(FXD).find(k => FXD[k].universe === plugin); if (own) return { fx: own, exact: 1 };
    const tl = AI.UNIVERSE_TR[plugin]; if (tl) { const i = tl.findIndex(id => TRD[id]); return i < 0 ? null : { tr: tl[i], exact: i === 0 && tl.length > 1 ? 1 : 0 }; }
    const fl = AI.UNIVERSE[plugin]; if (fl) { const i = fl.findIndex(id => FXD[id]); if (i >= 0) return { fx: fl[i], exact: i === 0 && fl.length > 1 ? 1 : 0 }; }
    const s = plugin.toLowerCase(); const kw = [['glitch', 'glitch'], ['vhs', 'vhs'], ['glow', 'glow'], ['blur', 'gblur'], ['shake', 'shake'], ['flare', 'flare'], ['grain', 'grain'], ['vignette', 'vignette'], ['halftone', 'halftone'], ['leak', 'leak'], ['ray', 'rays'], ['pixel', 'pixelate'], ['chromatic', 'chroma'], ['wave', 'wave'], ['kaleido', 'kaleido']];
    if (!/^Universe_(Text|Motion_Graphics|Utilities)_/.test(plugin)) for (const [k, v] of kw) if (s.includes(k) && FXD[v]) return { fx: v, exact: 0 };
    return null;
  };

  /* ================= LUTs: .3dl → .cube text ================= */
  AI.is3dl = (t) => { const ln = String(t).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')); return ln.length > 8 && /^\d+(\s+\d+)+$/.test(ln[0]) && ln[0].split(/\s+/).length !== 3 && /^\d+\s+\d+\s+\d+$/.test(ln[1]) && !/LUT_3D_SIZE/i.test(t); };
  AI.threeDLtoCube = (t) => {
    const ln = String(t).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#') && !/^(3DMESH|Mesh)/i.test(s));
    const N = ln[0].split(/\s+/).length; const rows = ln.slice(1).map(s => s.split(/\s+/).map(Number)).filter(r => r.length === 3 && r.every(isFinite));
    if (rows.length < N * N * N) throw new Error('3dl: ' + rows.length + ' rows < ' + N ** 3);
    let mx = 0; for (const r of rows) for (const v of r) mx = Math.max(mx, v); const sc = mx > 4095 ? 65535 : mx > 1023 ? 4095 : mx > 1 ? 1023 : 1;
    // 3dl order: blue fastest? (R outer, G, B inner) — cube wants R fastest: reorder
    const out = ['# converted from .3dl by QassQass', 'LUT_3D_SIZE ' + N];
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) { const x = rows[(r * N + g) * N + b]; out.push((x[0] / sc).toFixed(6) + ' ' + (x[1] / sc).toFixed(6) + ' ' + (x[2] / sc).toFixed(6)); }
    return out.join('\n');
  };

  /* ================= file classification (used by the main-process scanner result) ================= */
  AI.EXT = {
    ffx: 'ffx', prfpset: 'prfpset', epr: 'epr', essentialsound: 'essentialsound', rgx: 'rgx', cube: 'lut', '3dl': 'lut', look: 'look',
    obj: 'model', fbx: 'model', glb: 'model', gltf: 'model', e3d: 'e3d', ttf: 'font', otf: 'font',
    mov: 'footage', mp4: 'footage', webm: 'footage', png: 'image', jpg: 'image', wav: 'sound', mp3: 'sound', aif: 'sound', aiff: 'sound',
    aex: 'plugin', prm: 'plugin', ofx: 'plugin', jsx: 'script', jsxbin: 'script', mogrt: 'mogrt', aep: 'aep', prproj: 'prproj'
  };
  AI.classify = (p) => AI.EXT[String(p).toLowerCase().split('.').pop()] || null;

  /* ================= runtime (inside the app only) ================= */
  AI.reasonText = (u) => {
    if (u.reason === 'third-party') return 'إضافة خارجية (' + u.vendor + ') غير متاحة في قص قص';
    if (u.reason === 'transition') return 'تأثير انتقال — استخدم انتقال «' + u.suggest + '»';
    if (u.reason === 'text-animator') return 'محرّك نص';
    if (String(u.reason).startsWith('missing-fx')) return 'التأثير المقابل غير متوفر في هذه النسخة';
    return 'لا يوجد مقابل في قص قص بعد';
  };
  // keyframe time of a mapped key on clip c (Premiere: 0 = stretch to clip, 1 = anchor to in point, 2 = anchor to out point)
  AI.keyTime = (k, rec, c) => {
    const span = rec.span || 0; let t = k.t;
    if (rec.kind === 'prfpset') { if (rec.type === 0 && span > 0) t = k.t / span * c.dur; else if (rec.type === 2) t = c.dur - (span - k.t); }
    return Math.max(0, Math.min(c.dur, t));
  };
  // apply one mapped preset to clip c (no commit). P(v|{v,k}) → model param
  AI.applyTo = (c, it, seq, o = {}) => {
    const GW = root.GW; const s = seq || GW.seq(); const m = it.map; const rec = it.rec; const made = { fx: 0, keys: 0 };
    const prm = (x, f) => { const fn = f || (v => v); if (!x) return null; if (x.k && x.k.length > 1) { const k = x.k.map(q => ({ t: Math.round(AI.keyTime(q, rec, c) * 1000) / 1000, v: fn(q.v), e: q.e || 'ease' })).sort((a, b) => a.t - b.t); made.keys += k.length; return { v: k[0].v, k }; } return GW.P(fn(x.v)); };
    if (c.tt === 'v') {
      for (const f of m.fx) { if (!GW.FX[f.type]) continue; const o = GW.newFx(f.type, 'v'); for (const k in f.params) { const d = GW.FX[f.type].p.find(x => x.k === k); if (!d) continue; const P = prm(f.params[k]); if (P) o.params[k] = P; } o.adobe = it.name; c.fx = c.fx || []; c.fx.push(o); made.fx++; }
      const mo = m.motion || {}; const sw = c.sw || s.w, sh = c.sh || s.h; const fit = (c.kind === 'video' || c.kind === 'image') ? Math.min(s.w / sw, s.h / sh) : 1;
      if (c.motion) {
        if (mo.pos) c.motion.pos = prm(mo.pos, v => [Math.round(v[0] * s.w * 10) / 10, Math.round(v[1] * s.h * 10) / 10]);
        if (mo.scale) c.motion.scale = prm(mo.scale, v => Math.round(v * fit * 100) / 100);
        if (mo.rot) c.motion.rot = prm(mo.rot);
        if (mo.anchor) c.motion.anchor = prm(mo.anchor, v => [Math.round(v[0] * sw * 10) / 10, Math.round(v[1] * sh * 10) / 10]);
        if (m.motion3d && GW.X && GW.X.ensure3D) { c.td = 1; GW.X.ensure3D(c); for (const k of ['rotX', 'rotY', 'posZ']) if (m.motion3d[k]) c.motion[k] = prm(m.motion3d[k]); }
        if (m.spin) { const r0 = GW.pv(c.motion.rot, 0) || 0; c.motion.rot = { v: r0, k: [{ t: 0, v: r0, e: 'linear' }, { t: c.dur, v: r0 + m.spin * c.dur, e: 'linear' }] }; }
      }
      if (m.opacity) c.opacity = prm(m.opacity);
      if (m.fadeInOut) { const [a, b] = m.fadeInOut.map(x => Math.min(c.dur / 3, Math.max(.05, x))); c.opacity = { v: 0, k: [{ t: 0, v: 0, e: 'linear' }, { t: a, v: 100, e: 'linear' }, { t: c.dur - b, v: 100, e: 'linear' }, { t: c.dur, v: 0, e: 'linear' }] }; }
      if (!o.preview && m.textAnim && c.kind === 'text' && c.text && GW.TextAnim) { c.text.animators = c.text.animators || []; const an = GW.TextAnim.newAnimator(m.textAnim, c.dur); an.name = it.name; c.text.animators.push(an); made.fx++; GW.TextR && GW.TextR.drop && GW.TextR.drop(c.id); }
      if (!o.preview && m.transition && !m.fx.length && GW.TRANS && GW.TRANS[m.transition] && GW.TL && GW.TL.addTransitionAt) { try { GW.TL.addTransitionAt(m.transition, c, 'L'); made.fx++; } catch (e) {} }
    }
    if (!o.preview && m.afx && m.afx.length) { const as = c.tt === 'a' ? [c] : GW.linked(s, c).filter(x => x.tt === 'a'); for (const a of as) for (const f of m.afx) { if (!GW.AFX[f.type]) continue; const o = GW.newFx(f.type, 'a'); for (const k in f.params) if (k in o.params) o.params[k] = GW.P(f.params[k].v); a.afx = a.afx || []; a.afx.push(o); made.fx++; } }
    return made;
  };

  function installRuntime() {
    const GW = root.GW; const api = () => root.gws; const tr = (x) => (GW.tr ? GW.tr(x) : x); const esc = GW.esc || (x => String(x));
    const LS = 'qq.adobeImport'; let cfg = {}; try { cfg = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { cfg = {}; }
    const saveCfg = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) {} };
    AI.lib = null; AI.items = []; AI.byId = new Map();
    const grp = (it) => it.src === 'ae' ? 'After Effects › ' + (it.rec.folder || '') : 'Premiere' + (it.rec.path && it.rec.path.length ? ' › ' + it.rec.path.slice(-2).join(' › ') : '');
    AI.build = () => {
      const L = AI.lib || {}; const items = [];
      (L.ffx || []).forEach((rec, i) => { rec.kind = 'ffx'; items.push({ id: 'ae' + i, src: 'ae', name: rec.name, rec }); });
      (L.prfpset || []).forEach((rec, i) => items.push({ id: 'pr' + i, src: 'pr', name: rec.name, rec }));
      for (const it of items) { it.map = AI.mapPreset(it.rec, GW.FX); it.group = grp(it); it.ok = it.map.status === 'full' || it.map.status === 'approx' || it.map.status === 'partial' || it.map.status === 'transition'; it.why = it.map.unmapped.map(u => (u.name || u.match) + ': ' + AI.reasonText(u)).join('\n') || (it.map.status === 'empty' ? tr('قالب أشكال/أقنعة/تعبيرات بلا تأثيرات قابلة للتحويل') : it.map.status === 'none' ? tr('لا يوجد مقابل في قص قص بعد') : ''); }
      AI.items = items; AI.byId = new Map(items.map(x => [x.id, x]));
      // LUTs → LUT library (Lumetri pickers)
      if (GW.LUT && GW.LUT.BUNDLED) for (const l of L.luts || []) if (!GW.LUT.BUNDLED.some(b => b.path === l.p)) GW.LUT.BUNDLED.push({ path: l.p, n: 'أدوبي: ' + l.name, slot: l.slot, adobe: 1 });
      // Essential Sound presets → «الصوت الأساسي»
      if (GW.AudioFX && GW.AudioFX.PRESETS) for (const es of L.essentialsound || []) { const m = AI.mapEssentialSound(es); if (!m) continue; m.fx = m.fx.filter(f => GW.AFX[f.type]); if (!m.fx.length) continue; let h = 7; for (const ch of es.name) h = (h * 31 + ch.codePointAt(0)) >>> 0; const id = 'adobe_' + es.mode + '_' + h.toString(36); GW.AudioFX.PRESETS[id] = m; }
      AI.registerFonts();
      if (GW.UI && GW.UI.fxRefresh) GW.UI.fxRefresh();
      if (GW.bus) GW.bus.emit('adobe');
    };
    AI.stats = () => { const st = { total: AI.items.length }; for (const it of AI.items) st[it.map.status] = (st[it.map.status] || 0) + 1; return st; };
    // fonts: user / pack fonts become text fonts; Adobe's own app fonts are listed only (licensed to Adobe apps)
    AI.registerFonts = () => {
      if (!root.FontFace || !api() || !api().mediaUrl) return; const L = AI.lib || {}; AI._fonts = AI._fonts || new Set();
      for (const f of L.fonts || []) {
        if (f.app || (f.oss && !cfg.ossFonts)) continue; const key = f.family + '|' + f.weight + '|' + (f.italic ? 1 : 0); if (AI._fonts.has(key)) continue; AI._fonts.add(key);
        try { const ff = new FontFace(f.family, 'url("' + api().mediaUrl(f.p) + '")', { weight: String(f.weight), style: f.italic ? 'italic' : 'normal' }); document.fonts.add(ff); } catch (e) { continue; }
        if (GW.FONTS && !GW.FONTS.includes(f.family)) GW.FONTS.push(f.family);
      }
    };
    AI.models = () => ((AI.lib && AI.lib.models) || []).map(m => ({ path: m.p, name: m.name, format: m.fmt, mtl: m.mtl }));
    AI.e3dModels = () => ((AI.lib && AI.lib.e3d) || []).map(m => ({ path: m.p, name: m.name, note: 'e3d — صيغة Element 3D مغلقة (غير مدعومة)' }));
    AI.media = () => (AI.lib && AI.lib.media) || [];
    AI.universe = () => {
      const by = {}; for (const r of (AI.lib && AI.lib.rgx) || []) { (by[r.plugin] = by[r.plugin] || []).push(r); }
      return Object.keys(by).sort().map(k => ({ plugin: k, target: AI.universeTarget(k, GW.FX), presets: by[k] }));
    };
    AI.load = async () => { if (!api() || !api().adobeLibrary) return null; const l = await api().adobeLibrary(); if (l) { AI.lib = l; AI.build(); } return l; };
    AI.setLibrary = (l) => { AI.lib = l; AI.build(); };
    AI.roots = async () => { if (cfg.roots && cfg.roots.length) return cfg.roots; return api() && api().adobeDefaults ? api().adobeDefaults() : []; };
    AI.scan = async (o = {}) => {
      if (!api() || !api().adobeScan) throw new Error(tr('متاح في نسخة سطح المكتب فقط'));
      const roots = o.roots || await AI.roots(); const r = await api().adobeScan({ roots, plugins: o.plugins !== false });
      if (!r || !r.ok) throw new Error((r && (r.error || (r.busy && tr('فحص آخر قيد التشغيل')))) || 'scan failed');
      await AI.load(); return r;
    };
    AI.applyPreset = (id, clips) => {
      const it = AI.byId.get(id); if (!it) return 0; if (!it.ok) { GW.toast(tr('تعذر تطبيق القالب: ') + it.why.split('\n')[0], 'err'); return 0; }
      const s = GW.seq(); let n = 0; for (const c of clips) { AI.applyTo(c, it, s); n++; }
      if (n) { GW.commit(tr('قالب أدوبي: ') + it.name); GW.invalidate(); if (GW.FXC && GW.FXC.render) GW.FXC.render(); }
      if (it.map.unmapped.length) GW.toast(tr('طُبّق جزئيًا — ') + it.map.unmapped.length + tr(' تأثير بلا مقابل'));
      return n;
    };
    // Effects panel group «من أدوبي» (consumed by ui_panels.js renderTree when present)
    // shown under its own chip «من أدوبي» (and in «الكل» only while searching); long lists are capped to keep the tree fast
    GW.UI.fxExtraCats = () => (AI.items.length ? [['adobe', 'من أدوبي', 'import']] : []);
    GW.UI.fxExtraGroups = (cat, q) => {
      if (!AI.items.length || (cat !== 'adobe' && !(cat === 'all' && q) && cat !== 'fav')) return [];
      let list = AI.items; if (q) list = list.filter(it => it.name.toLowerCase().includes(q) || it.group.toLowerCase().includes(q));
      const cap = cat === 'adobe' ? 2500 : 300; if (cat !== 'fav' && list.length > cap) list = list.slice(0, cap);
      return [['من أدوبي', 'adobe', list.map(it => [it.id, it.name, it.group])]];
    };
    GW.UI.fxDecorateLeaf = (leaf, grp, k) => {
      if (grp !== 'adobe') return; const it = AI.byId.get(k); if (!it) return;
      const st = it.map.status; const tag = document.createElement('span'); tag.className = 'adb-tag'; tag.textContent = st === 'full' ? '' : st === 'approx' ? '≈' : st === 'partial' ? '½' : st === 'transition' ? '⇄' : '✕';
      leaf.querySelector('.lf-n').after(tag);
      if (!it.ok) { leaf.classList.add('adb-off'); leaf.draggable = false; }
      leaf.title = (it.src === 'ae' ? 'After Effects (.ffx)' : 'Premiere (.prfpset)') + ' — ' + it.rec.effects.map(e => e.name || e.match).join('، ') + (it.why ? '\n' + it.why : '') + (it.map.approx.length ? '\n≈ ' + it.map.approx.join('، ') : '');
    };
    GW.UI.fxApplyExtra = (f, clips) => { if (f.group !== 'adobe') return false; AI.applyPreset(f.type, clips); return true; };
    GW.UI.fxPreviewExtra = (c, grp, k) => { if (grp !== 'adobe') return false; const it = AI.byId.get(k); if (!it || !it.ok) return true; AI.applyTo(c, it, null, { preview: true }); return true; };

    /* ---------- styles ---------- */
    const st = document.createElement('style');
    st.textContent = `.adb-dlg{display:flex;flex-direction:column;gap:10px;max-height:72vh;overflow:auto}.adb-roots{display:flex;flex-direction:column;gap:4px}
    .adb-root{display:flex;gap:6px;align-items:center;font-size:12px}.adb-root code{flex:1;direction:ltr;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}
    .adb-root .no{color:var(--mute)}.adb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
    .adb-card{border:1px solid var(--line,#333);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}.adb-card b{font-size:18px}
    .adb-card span{color:var(--mute);font-size:11.5px}.adb-card .btn{align-self:flex-start;margin-top:4px}.adb-prog{font-size:12px;color:var(--mute);min-height:16px}
    .adb-bar{display:flex;gap:4px;height:8px;border-radius:4px;overflow:hidden;background:var(--line,#333)}.adb-bar i{display:block}
    .tree .leaf.adb-off{opacity:.45}.tree .leaf.adb-off .lf-n{text-decoration:line-through dotted}.tree .leaf .adb-tag{font-size:10px;color:var(--mute);margin-inline-start:auto}
    .mylib{display:flex;flex-direction:column;height:100%}.mylib .ml-list{flex:1;overflow:auto;padding:4px}.mylib .ml-it{display:flex;gap:8px;align-items:center;padding:4px 8px;border-radius:5px;cursor:grab;font-size:12px}
    .mylib .ml-it:hover{background:var(--hover,rgba(127,127,127,.12))}.mylib .ml-it em{color:var(--mute);font-style:normal;margin-inline-start:auto;font-size:11px}.mylib .ml-h{color:var(--mute);font-size:11px;padding:8px 8px 2px}
    .mylib video,.mylib img.ml-th{width:64px;height:36px;object-fit:cover;border-radius:3px;background:#000}`;
    document.head.append(st);

    /* ---------- dialog «استيراد من أدوبي» ---------- */
    AI.openDialog = async () => {
      const body = document.createElement('div'); body.className = 'adb-dlg';
      let roots = await AI.roots().catch(() => []);
      const paint = () => {
        const L = AI.lib; const st0 = AI.stats();
        const cnt = (k) => (L && L[k] ? L[k].length : 0);
        body.innerHTML = `<div>${esc(tr('يقرأ قص قص ملفاتك من أدوبي و Red Giant و Video Copilot في أماكنها (دون نسخ) ويحوّلها إلى قوالب وإعدادات قص قص. الإضافات المترجمة (.aex/.ofx) لا تعمل هنا، لكنها تُحلَّل ويُقترح أقرب بديل.'))}</div>
          <div><b>${esc(tr('المجلدات'))}</b><div class="adb-roots" data-a="roots"></div><div style="display:flex;gap:6px;margin-top:6px"><button class="btn sm" data-a="add">${esc(tr('إضافة مجلد…'))}</button><button class="btn sm ghost" data-a="reset">${esc(tr('المجلدات الافتراضية'))}</button></div></div>
          <div style="display:flex;gap:8px;align-items:center"><button class="btn pri" data-a="scan">${esc(L ? tr('إعادة الفحص') : tr('فحص الآن'))}</button><label style="font-size:12px"><input type="checkbox" data-a="plg" ${cfg.noPlugins ? '' : 'checked'}> ${esc(tr('تحليل الإضافات (PiPL)'))}</label><span class="adb-prog" data-a="prog">${L ? esc(tr('آخر فحص: ') + new Date(L.at).toLocaleString()) : ''}</span></div>
          <div class="adb-grid" data-a="cards"></div>`;
        const rb = body.querySelector('[data-a=roots]');
        roots.forEach((r, i) => { const d = document.createElement('div'); d.className = 'adb-root'; d.innerHTML = `<input type="checkbox" ${r.off ? '' : 'checked'}><code title="${esc(r.path)}">${esc(r.path)}</code><span class="no">${r.exists === false ? esc(tr('غير موجود')) : ''}</span><button class="btn sm ghost ico">${GW.ico ? GW.ico('close', 12) : '✕'}</button>`; d.querySelector('input').onchange = (e) => { r.off = !e.target.checked; cfg.roots = roots; saveCfg(); }; d.querySelector('button').onclick = () => { roots.splice(i, 1); cfg.roots = roots; saveCfg(); paint(); }; rb.append(d); });
        body.querySelector('[data-a=add]').onclick = async () => { const p = api() && api().adobePickFolder ? await api().adobePickFolder() : null; if (!p) return; roots.push({ path: p, kind: 'user', media: true, exists: true }); cfg.roots = roots; saveCfg(); paint(); };
        body.querySelector('[data-a=reset]').onclick = async () => { cfg.roots = null; saveCfg(); roots = await AI.roots(); paint(); };
        body.querySelector('[data-a=plg]').onchange = (e) => { cfg.noPlugins = !e.target.checked; saveCfg(); };
        body.querySelector('[data-a=scan]').onclick = async (e) => {
          const b = e.target; b.disabled = true; const pr = body.querySelector('[data-a=prog]'); const off = api().onAdobeProgress ? api().onAdobeProgress(p => { pr.textContent = p.phase === 'scan' ? tr('فحص: ') + p.root : p.phase + (p.n ? ' ' + p.i + '/' + p.n : p.file ? ' ' + String(p.file).split(/[\\/]/).pop() : ''); }) : null;
          try { const r = await AI.scan({ roots: roots.filter(x => !x.off), plugins: !cfg.noPlugins }); GW.toast(tr('اكتمل فحص ملفات أدوبي') + ' (' + Math.round(r.ms / 1000) + 's)'); } catch (er) { GW.toast(String(er.message || er), 'err'); } finally { off && off(); b.disabled = false; paint(); }
        };
        const cards = body.querySelector('[data-a=cards]'); if (!L) return;
        const card = (n, title, sub, btn, act) => { const d = document.createElement('div'); d.className = 'adb-card'; d.innerHTML = `<b>${n}</b><div>${esc(tr(title))}</div><span>${esc(sub || '')}</span>`; if (btn) { const x = document.createElement('button'); x.className = 'btn sm'; x.textContent = tr(btn); x.onclick = act; d.append(x); } cards.append(d); };
        const ok = (st0.full || 0) + (st0.approx || 0) + (st0.partial || 0) + (st0.transition || 0);
        card(st0.total, 'قوالب تأثيرات (AE .ffx + Premiere)', tr('قابلة للتطبيق: ') + ok + ' · ' + tr('كاملة: ') + (st0.full || 0) + ' · ' + tr('تقريبية: ') + (st0.approx || 0) + ' · ' + tr('جزئية: ') + (st0.partial || 0) + ' · ' + tr('بلا مقابل: ') + (st0.none || 0), 'عرض في لوحة التأثيرات', () => { GW.showPanel('effects'); if (GW.UI.fxSetCat) GW.UI.fxSetCat('adobe'); });
        const eps = (L.epr || []).map(AI.mapEPR).filter(Boolean);
        card(cnt('epr'), 'إعدادات تصدير (.epr)', tr('قابلة للتحويل: ') + eps.length, 'استيراد إلى إعدادات التصدير', () => { const n = AI.importExportPresets(); GW.toast(tr('أُضيف ') + n + tr(' إعداد تصدير')); });
        card(cnt('essentialsound'), 'قوالب الصوت الأساسي', tr('تظهر في قائمة «الصوت الأساسي»'));
        card(cnt('luts'), 'جداول ألوان LUT', tr('تظهر في منتقي LUT في Lumetri') + (cnt('looks') ? ' · .look: ' + cnt('looks') + tr(' (غير مدعوم)') : ''));
        card(cnt('fonts'), 'خطوط', tr('مسجّلة: ') + (AI._fonts ? AI._fonts.size : 0) + ' · ' + tr('خطوط Universe المفتوحة: ') + (L.fonts || []).filter(f => f.oss).length, cfg.ossFonts ? null : 'تفعيل خطوط Universe المفتوحة', () => { cfg.ossFonts = 1; saveCfg(); AI.registerFonts(); paint(); });
        card(cnt('models'), 'نماذج ثلاثية الأبعاد (.obj)', 'e3d: ' + cnt('e3d') + tr(' (صيغة مغلقة)'));
        card(cnt('media'), 'وسائط ومؤثرات صوتية', tr('في لوحة «مكتبتي»'), 'فتح مكتبتي', () => GW.showPanel('mylib'));
        card(cnt('rgx'), 'قوالب Red Giant Universe', tr('مع معاينات فيديو'), 'فتح مكتبتي', () => { AI._libTab = 'universe'; GW.showPanel('mylib'); });
        card(cnt('plugins'), 'إضافات (.aex/.prm/.ofx)', tr('للعرض فقط — راجع التقرير'));
        card(cnt('scripts'), 'سكربتات (.jsx)', tr('لا تعمل في قص قص'));
      };
      paint();
      GW.modal({ title: tr('استيراد من أدوبي'), body, width: 760 });
    };
    AI.importExportPresets = () => {
      const P = GW.UI && GW.UI.ExportPresets; if (!P) return 0; const LSK = 'gws.exportPresets'; let list = P.custom(); let n = 0;
      for (const e of (AI.lib && AI.lib.epr) || []) { const p = AI.mapEPR(e); if (!p) continue; if (list.some(x => x.name === p.name)) continue; list.push({ id: 'adb_' + GW.uid(), name: p.name, suf: e.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24), aspect: p.aspect, f: p.f }); n++; }
      try { localStorage.setItem(LSK, JSON.stringify(list)); } catch (e) {} return n;
    };

    /* ---------- «مكتبتي» panel: footage / overlays / sounds / models / Universe presets (linked in place) ---------- */
    GW.registerPanel('mylib', 'مكتبتي', (el) => {
      el.innerHTML = `<div class="mylib" dir="rtl"><div class="ptool"><div class="seg" data-a="tabs"><button data-t="media">${esc(tr('وسائط'))}</button><button data-t="universe">Universe</button><button data-t="models">${esc(tr('نماذج 3D'))}</button></div><input class="inp" data-a="q" placeholder="${esc(tr('بحث…'))}" style="flex:1;min-width:60px"></div><div class="ml-list" data-a="list"></div></div>`;
      const list = el.querySelector('[data-a=list]'); let q = '';
      const render = () => {
        const tab = AI._libTab || 'media'; el.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === tab)); list.innerHTML = '';
        if (!AI.lib) { list.innerHTML = `<div class="empty">${esc(tr('لم يُفحص بعد — ملف › استيراد من أدوبي'))}</div>`; return; }
        const ql = q.toLowerCase(); let shown = 0; const MAX = 400;
        const row = (html, path, drag) => { const d = document.createElement('div'); d.className = 'ml-it'; d.innerHTML = html; if (path && drag) { d.draggable = true; d.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-gws-files', JSON.stringify([path])); e.dataTransfer.effectAllowed = 'copy'; }); d.ondblclick = () => GW.Browser && GW.Browser.importPaths([path]).then(ms => { if (ms[0] && GW.Source) GW.Source.load(ms[0]); GW.toast(tr('تم الاستيراد إلى المشروع')); }); } list.append(d); shown++; return d; };
        if (tab === 'media') {
          let lastDir = null; for (const m of AI.media()) { if (ql && !m.name.toLowerCase().includes(ql) && !m.dir.toLowerCase().includes(ql)) continue; if (shown > MAX) break; if (m.dir !== lastDir) { const h = document.createElement('div'); h.className = 'ml-h'; h.textContent = m.dir; list.append(h); lastDir = m.dir; } row(`${GW.ico ? GW.ico(m.k === 'sound' ? 'sound' : m.k === 'image' ? 'image' : 'film', 14) : ''}<span>${esc(m.name)}</span><em>${esc(m.k)}</em>`, m.p, true); }
        } else if (tab === 'models') {
          for (const m of AI.models()) { if (ql && !m.name.toLowerCase().includes(ql)) continue; const d = row(`${GW.ico ? GW.ico('cube3d', 14) : ''}<span>${esc(m.name)}</span><em>.${esc(m.format)}${m.mtl ? ' + mtl' : ''}</em>`); d.title = m.path; d.ondblclick = () => { if (GW.S3D && GW.S3D.importModel) GW.S3D.importModel(m.path); else GW.toast(tr('افتح مشهدًا ثلاثي الأبعاد ثم استورد النموذج: ') + m.path); }; }
          for (const m of AI.e3dModels()) { if (ql && !m.name.toLowerCase().includes(ql)) continue; const d = row(`<span style="opacity:.5">${esc(m.name)}.e3d</span><em>${esc(tr('غير مدعوم'))}</em>`); d.title = m.note; }
        } else {
          for (const u of AI.universe()) {
            const ps = u.presets.filter(r => !ql || r.name.toLowerCase().includes(ql) || u.plugin.toLowerCase().includes(ql)); if (!ps.length) continue; if (shown > MAX) break;
            const h = document.createElement('div'); h.className = 'ml-h'; const tdef = u.target && (u.target.tr ? GW.TRANS[u.target.tr] : GW.FX[u.target.fx]); h.textContent = u.plugin.replace(/^Universe_/, '').replace(/_/g, ' ') + ' — ' + (u.target ? '→ ' + (tdef ? tr(tdef.n) : (u.target.fx || u.target.tr)) + (u.target.exact ? '' : ' ≈') : tr('مرجع فقط')); list.append(h);
            for (const r of ps.slice(0, 60)) { const d = row(`${r.hasThumb ? `<img class="ml-th" loading="lazy" src="${esc(api().mediaUrl(r.thumb))}">` : ''}<span>${esc(r.name)}</span>`); if (r.hasPreview) { d.onmouseenter = () => { const img = d.querySelector('img'); if (!img || d._v) return; const v = document.createElement('video'); v.src = api().mediaUrl(r.preview); v.muted = true; v.autoplay = true; v.loop = true; img.replaceWith(v); d._v = v; }; } d.ondblclick = () => { if (!u.target) { GW.toast(tr('لا يوجد مقابل في قص قص لهذا التأثير')); return; } GW.UI.applyFxTo(u.target.tr ? { group: 'tr', type: u.target.tr } : { group: 'v', type: u.target.fx }, null, {}); }; }
          }
        }
        if (!shown) list.innerHTML = `<div class="empty">${esc(tr('لا توجد عناصر'))}</div>`;
      };
      el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { AI._libTab = b.dataset.t; render(); });
      el.querySelector('[data-a=q]').oninput = (e) => { q = e.target.value.trim(); render(); }; el.querySelector('[data-a=q]').onkeydown = e => e.stopPropagation();
      render(); GW.bus && GW.bus.on && GW.bus.on('adobe', () => { if (el.isConnected) render(); });
    });
    if (GW.PANEL_LIST && !GW.PANEL_LIST.includes('mylib')) GW.PANEL_LIST.push('mylib');
    // .3dl LUTs (Universe, LUT Buddy, Autodesk) load through the .cube parser
    if (GW.LUT && GW.LUT.parse && !GW.LUT._adb3dl) { const p0 = GW.LUT.parse; GW.LUT.parse = (t) => (AI.is3dl(t) ? p0(AI.threeDLtoCube(t)) : p0(t)); GW.LUT._adb3dl = 1; }
    // load the cached library (if any) once the app is up
    setTimeout(() => { AI.load().catch(() => {}); }, 1500);
  }
  if (root.GW && root.document && root.GW.UI && root.GW.registerPanel) { try { installRuntime(); } catch (e) { console.warn('adobe import', e); } }

  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
  if (root.GW) root.GW.AdobeImport = Object.assign(AI, root.GW.AdobeImport || {}, AI);
})(typeof window !== 'undefined' ? window : globalThis);
