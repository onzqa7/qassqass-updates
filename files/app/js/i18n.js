'use strict';
/* UI language: Arabic (source) ⇄ English. Strings are translated at the DOM level from app/i18n/en.json,
   so every panel/menu/dialog is covered without touching each call site. GW.tr() is available for canvas text. */
(function () {
  const GW = window.GW = window.GW || {};
  let lang = 'ar'; try { lang = localStorage.getItem('qq.lang') || 'ar'; } catch (e) {}
  GW.lang = lang;
  let D0 = null; const Dget = () => D0 || (D0 = window.__EN_UI || null) || {};
  // the dictionary is a parser-inserted script (runs before the next <script> and before DOMContentLoaded; no sync XHR)
  if (lang === 'en' && !window.__EN_UI) document.write('<script src="i18n/en.js"><\/script>');
  const AR = /[؀-ۿ]/;
  const SEP = /(\s+[·—|•]\s+|:\s+|\s+\(|\)\s*|،\s*|\s*…$)/;
  function tr(s) {
    if (lang !== 'en' || !s || !AR.test(s)) return s;
    const D = Dget(); const t = s.trim(); if (D[t] != null) return s.replace(t, D[t]);
    // composite strings: translate pieces around common separators
    const parts = t.split(SEP); let changed = false;
    const out = parts.map(p => { const q = p.trim(); if (q && AR.test(q) && D[q] != null) { changed = true; return p.replace(q, D[q]); } return p; });
    if (changed) return s.replace(t, out.join(''));
    // prefix match: "label: dynamic"
    for (const k of [t.replace(/\s*\d[\d.,:]*\s*/g, ' ').trim()]) if (D[k] != null) return D[k];
    return s;
  }
  GW.tr = tr; // (GW.T is the playhead-time getter, set in app.js)
  GW.setLang = (l) => { try { localStorage.setItem('qq.lang', l); } catch (e) {} location.reload(); };
  if (lang !== 'en') return;
  document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr';
  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip'];
  function walk(n) {
    if (n.nodeType === 3) { const v = n.nodeValue; if (AR.test(v)) { const r = tr(v); if (r !== v) n.nodeValue = r; } return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName; if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return;
    if (n.isContentEditable || n.dataset && n.dataset.noi18n != null) return;
    if (n.getAttribute('dir') === 'rtl' && !(n.dataset && n.dataset.keepRtl != null)) n.setAttribute('dir', 'ltr');
    for (const a of ATTRS) { const v = n.getAttribute(a); if (v && AR.test(v)) { const r = tr(v); if (r !== v) n.setAttribute(a, r); } }
    if (tag === 'INPUT' && (n.type === 'button' || n.type === 'submit') && AR.test(n.value)) { const r = tr(n.value); if (r !== n.value) n.value = r; }
    if (tag === 'OPTION' && AR.test(n.textContent)) { const r = tr(n.textContent); if (r !== n.textContent) n.textContent = r; return; }
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  const mo = new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') walk(m.target);
      else if (m.type === 'attributes') { const n = m.target; if (m.attributeName === 'dir') { if (n.getAttribute('dir') === 'rtl' && !(n.dataset && n.dataset.keepRtl != null)) n.setAttribute('dir', 'ltr'); } else { const v = n.getAttribute(m.attributeName); if (v && AR.test(v)) { const r = tr(v); if (r !== v) n.setAttribute(m.attributeName, r); } } }
    }
  });
  const LTR = '.toast,.proj-head,.pitem,.proj-grid,.mon-empty,.tl-seqtabs,.fxc-left,.tree,.eg-grid,.form,.hist-i,.mk-i,.map-hero,.kbd-list,.kb-kbd .hint,.upd-bn,[data-a=seqname]';
  const css = document.createElement('style'); css.textContent = LTR.split(',').map(x => 'html[lang=en] ' + x).join(',') + '{direction:ltr!important}';
  (document.head || document.documentElement).appendChild(css);
  const start = () => { if (window.__noI18nObs) return; walk(document.body); mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['dir', ...ATTRS] }); document.title = tr(document.title); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  const _t = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  if (_t && _t.set) Object.defineProperty(document, 'title', { get() { return _t.get.call(document); }, set(v) { _t.set.call(document, tr(v)); } });
})();
