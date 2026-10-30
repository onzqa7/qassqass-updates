'use strict';
/* GeoWar Studio — shared helpers */
const GW = window.GW = window.GW || {};
GW.$ = (s, el = document) => el.querySelector(s);
GW.$$ = (s, el = document) => [...el.querySelectorAll(s)];
GW.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
GW.lerp = (a, b, t) => a + (b - a) * t;
GW.uid = () => Math.random().toString(36).slice(2, 10);
GW.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
GW.clone = o => JSON.parse(JSON.stringify(o));
GW.sleep = ms => new Promise(r => setTimeout(r, ms));
GW.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
GW.isAr = s => /[؀-ۿ]/.test(s || '');
GW.hex2rgb = h => { h = String(h || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h.slice(0, 6), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
GW.rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(GW.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
GW.rgba = (h, a) => { const [r, g, b] = GW.hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };
GW.hexf = h => GW.hex2rgb(h).map(v => v / 255);
GW.rng = seed => function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
GW.hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/* time */
GW.fmtTC = (t, fps) => {
  fps = fps || 30; const neg = t < 0; t = Math.abs(t);
  const fr = Math.round(t * fps); const f = fr % Math.round(fps); const s = Math.floor(fr / Math.round(fps));
  const p = n => String(n).padStart(2, '0');
  return (neg ? '-' : '') + p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60) + ':' + p(f);
};
GW.parseTC = (str, fps) => {
  str = String(str).trim(); if (!str) return null;
  if (/^[\d.]+s$/.test(str)) return parseFloat(str);
  const parts = str.split(/[:;.]/).map(x => parseInt(x, 10) || 0);
  while (parts.length < 4) parts.unshift(0);
  const [h, m, s, f] = parts.slice(-4);
  return h * 3600 + m * 60 + s + f / (fps || 30);
};
GW.fmtDur = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
GW.snapFrame = (t, fps) => Math.round(t * fps) / fps;

/* easing */
GW.ease = {
  linear: t => t,
  ease: t => t * t * (3 - 2 * t),
  in: t => t * t * t,
  out: t => 1 - Math.pow(1 - t, 3),
  inout: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  elastic: t => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI) / 3) + 1,
  hold: t => 0
};

/* animatable parameters: {v, k:[{t,v,e}]}  (t is clip-local seconds) */
function lerpVal(a, b, t) {
  if (Array.isArray(a)) return a.map((x, i) => lerpVal(x, b ? b[i] : x, t));
  if (typeof a === 'string' && a[0] === '#') { const A = GW.hex2rgb(a), B = GW.hex2rgb(b); return GW.rgb2hex(...A.map((x, i) => GW.lerp(x, B[i], t))); }
  if (typeof a === 'number') return GW.lerp(a, b, t);
  return t < 1 ? a : b;
}
GW.P = (v) => ({ v });
GW.pv = (p, t) => {
  if (p == null) return p;
  if (typeof p !== 'object' || Array.isArray(p) || !('v' in p)) return p;
  const k = p.k;
  if (!k || !k.length) return p.v;
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  let i = 0; while (i < k.length - 1 && k[i + 1].t <= t) i++;
  const A = k[i], B = k[i + 1];
  const u = (t - A.t) / (B.t - A.t || 1);
  if (A.e === 'hold') return A.v;
  if (A.bo || B.bi) return lerpVal(A.v, B.v, GW.bezierAt(GW.keyHandles(A, B), u)); // custom bezier handles (graph editor)
  // Hermite curve: slow departure when A eases out, slow arrival when B eases in
  const m0 = (A.e === 'ease' || A.e === 'easeOut') ? 0 : 1, m1 = (B.e === 'ease' || B.e === 'easeIn') ? 0 : 1;
  const u2 = u * u, u3 = u2 * u;
  const f = (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) + (u3 - u2) * m1;
  return lerpVal(A.v, B.v, f);
};
/* bezier keyframe interpolation (graph editor). Optional per-key handles, normalized to the segment:
   A.bo = [x, y] out-handle of A (P1 = (x, y)), B.bi = [x, y] in-handle of B (P2 = (1 − x, 1 − y)); x = influence, y = progress.
   Keys without handles keep the Hermite curve above — identical to the bezier with handles [1/3, m/3]. */
GW.keyHandles = (A, B) => {
  const m0 = (A.e === 'ease' || A.e === 'easeOut') ? 0 : 1, m1 = (B.e === 'ease' || B.e === 'easeIn') ? 0 : 1;
  const o = A.bo || [1 / 3, m0 / 3], i = B.bi || [1 / 3, m1 / 3];
  return [GW.clamp(o[0], 0, 1), o[1], 1 - GW.clamp(i[0], 0, 1), 1 - i[1]];
};
// progress f at time-fraction u of the cubic bezier (0,0) (x1,y1) (x2,y2) (1,1); x solved by Newton + bisection
GW.bezierAt = (h, u) => {
  const [x1, y1, x2, y2] = h; if (u <= 0) return 0; if (u >= 1) return 1;
  const bx = s => ((1 - 3 * x2 + 3 * x1) * s + (3 * x2 - 6 * x1)) * s * s + 3 * x1 * s;
  const dx = s => 3 * (1 - 3 * x2 + 3 * x1) * s * s + 2 * (3 * x2 - 6 * x1) * s + 3 * x1;
  let s = u;
  for (let n = 0; n < 8; n++) { const e = bx(s) - u; if (Math.abs(e) < 1e-7) break; const d = dx(s); if (Math.abs(d) < 1e-6) break; s -= e / d; }
  if (!(s >= 0 && s <= 1) || Math.abs(bx(s) - u) > 1e-6) { let a = 0, b = 1; s = u; for (let n = 0; n < 50; n++) { const v = bx(s); if (Math.abs(v - u) < 1e-8) break; if (v < u) a = s; else b = s; s = (a + b) / 2; } }
  return ((1 - 3 * y2 + 3 * y1) * s + (3 * y2 - 6 * y1)) * s * s + 3 * y1 * s;
};
GW.cubicBezier = (x1, y1, x2, y2) => u => GW.bezierAt([x1, y1, x2, y2], u);
GW.isAnim = p => !!(p && p.k && p.k.length);
GW.setPv = (p, t, v) => {
  if (!p.k || !p.k.length) { p.v = v; return; }
  const e = 1 / 240; const ex = p.k.find(x => Math.abs(x.t - t) < e);
  if (ex) ex.v = v; else { p.k.push({ t, v, e: 'linear' }); p.k.sort((a, b) => a.t - b.t); }
};
GW.toggleAnim = (p, t) => {
  if (p.k && p.k.length) { p.v = GW.pv(p, t); delete p.k; }
  else p.k = [{ t, v: p.v, e: 'linear' }];
};
GW.keyAt = (p, t) => p && p.k ? p.k.find(x => Math.abs(x.t - t) < 1 / 120) : null;

/* events */
GW.bus = (() => { const m = {}; return { on(e, f) { (m[e] || (m[e] = [])).push(f); }, emit(e, ...a) { (m[e] || []).forEach(f => { try { f(...a); } catch (er) { console.error(er); } }); } }; })();

/* toast + small dialogs */
GW.toast = (msg, kind) => {
  let t = GW.$('#toast');
  t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false;
  clearTimeout(GW._tt); GW._tt = setTimeout(() => t.hidden = true, kind === 'err' ? 6000 : 3200);
};
GW.modal = ({ title, body, buttons, width, onClose }) => {
  const wrap = document.createElement('div'); wrap.className = 'modal';
  const dlg = document.createElement('div'); dlg.className = 'dlg'; dlg.dir = 'rtl'; if (width) dlg.style.width = `min(${width}px, 100%)`;
  dlg.innerHTML = `<div class="dlg-h"><b>${GW.esc(title || '')}</b><button class="x" aria-label="إغلاق">✕</button></div><div class="dlg-b"></div><div class="dlg-f"></div>`;
  const b = dlg.querySelector('.dlg-b'); if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
  const f = dlg.querySelector('.dlg-f');
  const close = (v) => { wrap.remove(); onClose && onClose(v); };
  (buttons || [{ label: 'إغلاق', value: null }]).forEach(btn => {
    const e = document.createElement('button'); e.className = 'btn ' + (btn.primary ? 'pri' : ''); e.textContent = btn.label;
    e.onclick = async () => { if (btn.action) { const r = await btn.action(dlg); if (r === false) return; } close(btn.value); }; f.append(e);
  });
  dlg.querySelector('.x').onclick = () => close(null);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
  wrap.append(dlg); document.body.append(wrap);
  const first = dlg.querySelector('input,select,textarea'); if (first) setTimeout(() => first.focus(), 30);
  return { el: dlg, close };
};
GW.ask = (title, msg, okLabel) => new Promise(res => GW.modal({ title, body: `<p>${GW.esc(msg)}</p>`, buttons: [{ label: 'إلغاء', value: false }, { label: okLabel || 'موافق', value: true, primary: true }], onClose: v => res(!!v) }));
GW.prompt = (title, label, value) => new Promise(res => {
  const body = document.createElement('div'); body.innerHTML = `<label class="fld"><span>${GW.esc(label)}</span><input class="inp" value="${GW.esc(value || '')}"></label>`;
  const inp = body.querySelector('input');
  const m = GW.modal({ title, body, buttons: [{ label: 'إلغاء', value: null }, { label: 'موافق', primary: true, action: () => { m._v = inp.value; } }], onClose: v => res(v === null ? null : (m._v ?? null)) });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { m._v = inp.value; m.close(true); } });
});

/* context menu */
GW.menu = (x, y, items) => {
  GW.closeMenus();
  const m = document.createElement('div'); m.className = 'ctx'; m.dir = 'rtl';
  for (const it of items) {
    if (it === '-') { m.insertAdjacentHTML('beforeend', '<hr>'); continue; }
    const b = document.createElement('button'); b.className = 'ctx-i'; b.disabled = !!it.disabled;
    b.innerHTML = `<span>${GW.esc(it.label)}</span>${it.key ? `<kbd>${GW.esc(it.key)}</kbd>` : ''}${it.check ? '<i>✓</i>' : ''}`;
    if (it.sub) { b.classList.add('has-sub'); b.onmouseenter = () => { const r = b.getBoundingClientRect(); GW.subMenu(r.left, r.top, it.sub, m); }; }
    else b.onclick = () => { GW.closeMenus(); it.action && it.action(); };
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  return m;
};
GW.subMenu = (x, y, items, parent) => {
  GW.$$('.ctx.sub').forEach(s => s.remove());
  const m = document.createElement('div'); m.className = 'ctx sub'; m.dir = 'rtl';
  for (const it of items) {
    if (it === '-') { m.insertAdjacentHTML('beforeend', '<hr>'); continue; }
    const b = document.createElement('button'); b.className = 'ctx-i'; b.innerHTML = `<span>${GW.esc(it.label)}</span>${it.check ? '<i>✓</i>' : ''}`;
    b.onclick = () => { GW.closeMenus(); it.action && it.action(); }; m.append(b);
  }
  document.body.append(m); const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, x - r.width + 2) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
};
GW.closeMenus = () => GW.$$('.ctx').forEach(m => m.remove());
document.addEventListener('mousedown', e => { if (!e.target.closest('.ctx') && !e.target.closest('.mb-i')) GW.closeMenus(); });

/* scrubby number input like Premiere (drag horizontally to change) */
GW.scrub = (opts) => {
  const el = document.createElement('span'); el.className = 'scrub'; el.tabIndex = 0; el.dir = 'ltr';
  const fmt = v => (opts.fmt ? opts.fmt(v) : (Math.round(v * Math.pow(10, opts.dec ?? 1)) / Math.pow(10, opts.dec ?? 1)).toFixed(opts.dec ?? 1)) + (opts.unit || '');
  let val = opts.get();
  const show = () => { val = opts.get(); el.textContent = fmt(val); };
  show();
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault();
    const x0 = e.clientX, v0 = opts.get(); let moved = false;
    el.setPointerCapture(e.pointerId);
    const mv = ev => {
      const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true; if (!moved) return;
      const step = (opts.step || 1) * (ev.shiftKey ? 10 : ev.ctrlKey ? .1 : 1);
      let nv = v0 + dx * step; if (opts.min != null) nv = Math.max(opts.min, nv); if (opts.max != null) nv = Math.min(opts.max, nv);
      opts.set(nv, false); el.textContent = fmt(nv);
    };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      if (moved) opts.set(opts.get(), true); else edit();
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
  const edit = () => {
    const inp = document.createElement('input'); inp.className = 'scrub-edit'; inp.value = String(Math.round(opts.get() * 1000) / 1000); inp.dir = 'ltr';
    el.replaceWith(inp); inp.select();
    const done = ok => { if (ok) { let v = parseFloat(inp.value); if (!isNaN(v)) { if (opts.min != null) v = Math.max(opts.min, v); if (opts.max != null) v = Math.min(opts.max, v); opts.set(v, true); } } inp.replaceWith(el); show(); };
    inp.onkeydown = e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); };
    inp.onblur = () => done(true);
  };
  el.addEventListener('keydown', e => { if (e.key === 'Enter') edit(); });
  el.refresh = show;
  return el;
};
