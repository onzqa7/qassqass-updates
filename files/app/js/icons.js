'use strict';
/* Monochrome line icons (24×24, stroke = currentColor) used across the UI instead of emoji. */
(function () {
  const GW = window.GW = window.GW || {};
  const P = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    folder: '<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    import: '<path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M5 17v2.5h14V17"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
    map: '<path d="m3.5 6.5 5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
    swords: '<path d="m4 4 9 9M4 4v3.5M4 4h3.5M20 4l-9 9M20 4v3.5M20 4h-3.5"/><path d="m8.5 15.5-3 3M15.5 15.5l3 3M7 13l4 4M17 13l-4 4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    film: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>',
    close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
    key: '<path d="m12 4 8 8-8 8-8-8z"/>',
    keyon: '<path d="m12 4 8 8-8 8-8-8z" fill="currentColor"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1H5.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/>',
    up: '<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>', down: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeoff: '<path d="M4 4l16 16M9.9 6A8.6 8.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4M6.5 7.6A15.5 15.5 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', goto: '<path d="M5 12h12m0 0-4-4m4 4-4 4M19 5v14"/>',
    camera: '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
    text: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
    caption: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6"/>',
    wand: '<path d="m4 20 11-11M14 4v2.5M20 10h-2.5M18.2 5.8l-1.8 1.8M13 9l2 2"/>',
    scissors: '<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.6 8.4 20 17.5M8.6 15.6 20 6.5"/>',
    beat: '<path d="M3 12h3l2-6 3 12 3-9 2 3h5"/>',
    track: '<rect x="8" y="8" width="8" height="8"/><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"/><path d="M12 11v2M11 12h2"/>',
    trackf: '<path d="M5 6v12l7-6zM12 6v12l7-6z"/>', trackb: '<path d="M19 6v12l-7-6zM12 6v12l-7-6z"/>',
    step1f: '<path d="M7 6v12l8-6z"/><path d="M17 6v12"/>', step1b: '<path d="M17 6v12L9 12z"/><path d="M7 6v12"/>',
    mosaic: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
    /* design v4 additions: chevrons, reset, keyframe navigation (all 1.75px stroke, 24-grid) */
    left: '<path d="m14.5 6.5-5.5 5.5 5.5 5.5"/>', right: '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
    keyprev: '<path d="M16 5.5v13L6 12z" fill="currentColor" stroke="none"/>', keynext: '<path d="M8 5.5v13L18 12z" fill="currentColor" stroke="none"/>',
    keydia: '<path d="m12 5.5 6.5 6.5-6.5 6.5L5.5 12z"/>', keydiaon: '<path d="m12 5.5 6.5 6.5-6.5 6.5L5.5 12z" fill="currentColor"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  };
  /* design v4: keep the accent fill of horizontal sliders in sync with their value (CSS var --p) */
  const fill = (r) => { if (!r || r.type !== 'range' || r.getAttribute('orient') === 'vertical') return; const mn = +r.min || 0, mx = r.max === '' ? 100 : +r.max; const p = mx > mn ? (+r.value - mn) / (mx - mn) * 100 : 0; r.style.setProperty('--p', Math.max(0, Math.min(100, p)).toFixed(2) + '%'); };
  const fillAll = (root) => { if (root && root.querySelectorAll) root.querySelectorAll('input[type=range]').forEach(fill); if (root && root.type === 'range') fill(root); };
  document.addEventListener('input', e => fill(e.target), true);
  document.addEventListener('change', e => fill(e.target), true);
  document.addEventListener('pointerover', e => fill(e.target), true);
  document.addEventListener('DOMContentLoaded', () => { fillAll(document.body); new MutationObserver(ms => { for (const m of ms) { if (m.type === 'attributes') fill(m.target); else m.addedNodes.forEach(fillAll); } }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['value'] }); });
  GW.ico = (name, size = 16, cls = '') => `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
})();
