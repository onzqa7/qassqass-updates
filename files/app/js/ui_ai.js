'use strict';
/* «المونتير الذكي» — optional in-app AI editor (the app works fully without it).
   Provider: the user's own Anthropic API key (Settings; encrypted with Electron safeStorage in the main process, see the
   "ai" block in main.js — the key never reaches this renderer) or Claude Desktop via the existing MCP bridge (api.js).
   Loop: Messages API with tools generated from GW.AITools (ai_tools.js) → tool_use blocks run through GW.API.call here →
   tool_result (captureFrame returns an image so the model can see the frame) → … up to maxSteps.
   Plan mode (default): only read-only tools; the model proposes a plan, the user presses «نفّذ».
   Every execution run is folded into ONE undo step «المساعد: …»; «تراجع عن كل تعديلات المساعد» jumps back before the first run.
   Knowledge: SYSTEM below + app/ai/editing_playbook_ar.md. */
(function () {
  const { esc } = GW;
  const B = () => window.gwsAi || null;
  const AI = GW.AI = { st: null, msgs: [], items: [], busy: false, job: null, cancelled: false, groups: [], playbook: null, mode: 'plan', ctx: { sel: 1, clips: 0, tr: 0 }, lastPlan: false };
  const MAX_IMAGES = 3;

  /* ---------------- knowledge ---------------- */
  const SYSTEM = `You are «المونتير الذكي», the editing assistant built into قص قص (QassQass), an Arabic desktop video editor used by a documentary / war-history YouTuber who also makes Shorts.
You control the editor ONLY through the provided tools (they call the app's automation API; every edit is undoable and grouped as «المساعد: …» in History).
You are a general AI model following the editing playbook below — be honest about that; do not claim to have watched videos or to have hidden expertise.

Rules:
- Reply in the user's language (Arabic by default), short and concrete. Times in seconds.
- Always inspect before editing (getState; getTranscript when speech matters). Never invent clip ids.
- Follow the loop خطة → تنفيذ → مراجعة: in PLAN mode you can only use read-only tools; finish with a numbered plan (3–8 bullets) and stop. In EXECUTE mode carry out the approved plan, then review with captureFrame at key moments, fix visible problems, and end with a 2–5 line report.
- Prefer few precise calls. If a tool errors, correct the parameters once; otherwise skip and report.
- Don't export, save, open projects or delete media unless asked. Before destructive edits (ripple delete, silence removal) say what will go.
- Restraint beats effects: follow the playbook's limits on transitions, SFX density and stylised looks.`;
  async function playbook() {
    if (AI.playbook != null) return AI.playbook;
    let t = ''; try { const r = await fetch('ai/editing_playbook_ar.md'); if (r.ok) t = await r.text(); } catch (e) {}
    if (!t && B() && B().playbook) { try { t = await B().playbook(); } catch (e) {} }
    return (AI.playbook = t || '');
  }
  function contextLine() {
    const s = GW.seq(); const tr = s.transcript;
    const kinds = {}; for (const c of s.clips) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    return `Current editor state: sequence «${s.name}» ${s.w}×${s.h} @${s.fps}fps (${s.h > s.w ? 'vertical / Shorts' : 'horizontal / YouTube'}), duration ${GW.seqDur(s).toFixed(2)} s, playhead ${s.t.toFixed(2)} s, ${s.vt.length} video + ${s.at.length} audio tracks, clips: ${JSON.stringify(kinds)}, selected: ${GW.sel.clips.size}, transcript: ${tr && tr.segs.length ? tr.segs.length + ' segments (' + (tr.lang || '?') + ')' : 'none'}, captions on timeline: ${GW.Captions ? GW.Captions.captionClips(s).length : 0}. UI language: ${GW.lang}.`;
  }
  async function systemBlocks() {
    const pb = await playbook();
    return [{ type: 'text', text: SYSTEM + (pb ? '\n\n' + pb : ''), cache_control: { type: 'ephemeral' } }, { type: 'text', text: contextLine() }];
  }
  function attachContext() {
    const s = GW.seq(); const out = [];
    if (AI.ctx.sel && GW.sel.clips.size) { const cs = [...GW.sel.clips].map(id => GW.clipById(id, s)).filter(Boolean).map(c => GW.API.clipInfo(c)); out.push('Selected clips: ' + GW.AITools.compact(cs, 6000)); }
    if (AI.ctx.clips) { try { const st = GW.API.methods.getState({ media: false }); out.push('Timeline: ' + GW.AITools.compact(st.clips || st, 8000)); } catch (e) {} }
    if (AI.ctx.tr && s.transcript && s.transcript.segs.length) out.push('Transcript:\n' + s.transcript.segs.map((g, i) => `${i} [${g.t0.toFixed(2)}–${g.t1.toFixed(2)}] ${g.text}`).join('\n').slice(0, 12000));
    return out.join('\n\n');
  }

  /* ---------------- status / settings ---------------- */
  AI.refresh = async () => { if (!B()) return (AI.st = null); try { AI.st = await B().status(); } catch (e) { AI.st = null; } return AI.st; };
  AI.ready = () => !!(AI.st && AI.st.hasKey && AI.st.provider !== 'mcp');

  /* ---------------- undo grouping ---------------- */
  function beginGroup() { const H = GW.hist; return { pre: H.stack[H.idx], idx: H.idx }; }
  function endGroup(g, title) {
    const H = GW.hist; let j = -1; for (let i = H.idx; i >= 0; i--) if (H.stack[i] === g.pre) { j = i; break; }
    if (j < 0 || H.idx <= j) return null;
    const n = H.idx - j; if (n > 1) { H.stack.splice(j + 1, n - 1); H.labels.splice(j + 1, n - 1); }
    H.idx = j + 1; H.labels[H.idx] = 'المساعد: ' + String(title || 'تعديلات').replace(/\s+/g, ' ').slice(0, 48);
    const rec = { pre: g.pre, post: H.stack[H.idx], label: H.labels[H.idx] }; AI.groups.push(rec);
    GW.bus.emit('hist'); GW.markDirty(); return rec;
  }
  AI.undoAll = async (ask = true) => {
    const H = GW.hist; if (!AI.groups.length) { GW.toast('لا توجد تعديلات من المساعد'); return false; }
    const first = AI.groups[0]; let j = -1; for (let i = H.idx; i >= 0; i--) if (H.stack[i] === first.pre) { j = i; break; }
    if (j < 0) { GW.toast('تعذّر التراجع: تغيّر السجل كثيرًا — استخدم لوحة «السجل»', 'err'); return false; }
    if (j === H.idx) { GW.toast('تعديلات المساعد متراجَع عنها بالفعل'); return false; }
    const manual = H.labels.slice(j + 1, H.idx + 1).filter(l => !/^المساعد: /.test(l)).length;
    if (ask && !(await GW.ask('تراجع عن كل تعديلات المساعد', manual ? `سيُعاد المشروع إلى ما قبل أول تعديل للمساعد، ويشمل ذلك ${manual} تعديلًا يدويًا جاء بعده. يمكنك الإعادة من «السجل».` : 'سيُعاد المشروع إلى ما قبل أول تعديل للمساعد. يمكنك الإعادة من «السجل».', 'تراجع'))) return false;
    H.go(j); GW.invalidate(); push({ kind: 'note', text: 'تم التراجع عن كل تعديلات المساعد.' }); return true;
  };

  /* ---------------- tool execution ---------------- */
  const imgCount = () => AI.msgs.reduce((a, m) => a + (Array.isArray(m.content) ? m.content.reduce((b, c) => b + (c.type === 'tool_result' && Array.isArray(c.content) ? c.content.filter(x => x.type === 'image').length : 0), 0) : 0), 0);
  function pruneImages() { // keep only the newest MAX_IMAGES frames in the conversation (cost)
    let n = imgCount(); if (n <= MAX_IMAGES) return;
    for (const m of AI.msgs) { if (n <= MAX_IMAGES) break; if (!Array.isArray(m.content)) continue; for (const c of m.content) { if (n <= MAX_IMAGES) break; if (c.type === 'tool_result' && Array.isArray(c.content)) { const k = c.content.filter(x => x.type === 'image').length; if (k) { c.content = c.content.filter(x => x.type !== 'image').concat([{ type: 'text', text: '[older frame omitted]' }]); n -= k; } } } }
  }
  AI.execTool = async (name, input, mode) => {
    input = input && typeof input === 'object' ? input : {};
    if (!GW.AITools.list().some(r => r[0] === name)) return { error: 'unknown tool ' + name };
    if (mode === 'plan' && !GW.AITools.readOnly(name)) return { error: 'PLAN mode: editing tools are disabled until the user approves the plan («نفّذ»). Finish the plan now.' };
    try {
      if (name === 'captureFrame') { const r = await GW.API.call('captureFrame', Object.assign({ maxWidth: 640 }, input)); return { image: r, content: [{ type: 'image', source: { type: 'base64', media_type: r.mime || 'image/png', data: r.base64 } }, { type: 'text', text: `frame at ${r.time}s (${r.width}×${r.height})` }] }; }
      const r = await GW.API.call(name, input); return { result: r, content: GW.AITools.compact(r) };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  };
  const argSummary = (input) => { const s = GW.AITools.compact(input, 400); return s === '{}' ? '' : s; };

  /* ---------------- the loop ---------------- */
  AI.send = async (text, o = {}) => {
    text = String(text || '').trim(); if (!text || AI.busy) return false;
    await AI.refresh();
    if (!B()) { GW.toast('المونتير الذكي متاح في نسخة سطح المكتب', 'err'); return false; }
    if (!AI.ready()) { push({ kind: 'note', text: 'أضف مفتاح Anthropic API من «الإعدادات» أولًا، أو استخدم Claude Desktop عبر MCP.' }); AI.settings(); return false; }
    const mode = o.mode || AI.mode; const extra = o.noContext ? '' : attachContext();
    const userContent = [{ type: 'text', text: (extra ? extra + '\n\n---\n' : '') + (mode === 'plan' ? '[PLAN mode — read-only tools; propose a plan and stop]\n' : '[EXECUTE mode]\n') + text }];
    const last = AI.msgs[AI.msgs.length - 1];
    if (last && last.role === 'user') last.content = [].concat(last.content, userContent); else AI.msgs.push({ role: 'user', content: userContent });
    push({ kind: 'user', text, mode });
    AI.busy = true; AI.cancelled = false; AI.lastPlan = false; render();
    const grp = mode === 'exec' ? beginGroup() : null; let steps = 0, changed = 0; const maxSteps = (AI.st && AI.st.maxSteps) || 25;
    try {
      const system = await systemBlocks(); const tools = GW.AITools.tools({ readOnly: mode === 'plan' });
      while (!AI.cancelled) {
        if (steps >= maxSteps) { push({ kind: 'note', text: `توقف المساعد بعد ${maxSteps} خطوة (الحد الأقصى في الإعدادات).` }); break; }
        steps++; pruneImages();
        AI.job = 'ai' + GW.uid(); setStatus('يفكّر…');
        const r = await B().messages(AI.job, { system, messages: AI.msgs, tools }); AI.job = null;
        if (AI.cancelled) break;
        if (!r || !r.ok) { push({ kind: 'err', text: errText(r) }); break; }
        const msg = r.result || {}; const content = Array.isArray(msg.content) ? msg.content : [];
        AI.msgs.push({ role: 'assistant', content });
        for (const c of content) if (c.type === 'text' && c.text.trim()) push({ kind: 'ai', text: c.text });
        const uses = content.filter(c => c.type === 'tool_use');
        if (!uses.length || msg.stop_reason !== 'tool_use') { if (mode === 'plan') AI.lastPlan = true; break; }
        const results = [];
        for (const u of uses) {
          const it = push({ kind: 'step', name: u.name, args: argSummary(u.input), state: 'run' }); setStatus((GW.AITools.LABELS[u.name] || u.name) + '…');
          const h0 = GW.hist.idx; const x = AI.cancelled ? { error: 'cancelled by the user' } : await AI.execTool(u.name, u.input, mode);
          if (GW.hist.idx !== h0) changed++;
          it.state = x.error ? 'err' : 'ok'; it.err = x.error; if (x.image) it.img = 'data:' + (x.image.mime || 'image/png') + ';base64,' + x.image.base64; updItem(it);
          results.push(x.error ? { type: 'tool_result', tool_use_id: u.id, content: 'Error: ' + x.error, is_error: true } : { type: 'tool_result', tool_use_id: u.id, content: x.content });
        }
        AI.msgs.push({ role: 'user', content: results });
      }
      if (AI.cancelled) push({ kind: 'note', text: 'أُوقف المساعد.' });
    } catch (e) { push({ kind: 'err', text: 'خطأ: ' + (e && e.message ? e.message : e) }); }
    finally {
      AI.busy = false; AI.job = null; setStatus('');
      if (grp) { const g = endGroup(grp, o.title || text); if (g) push({ kind: 'note', text: 'جُمعت التعديلات في خطوة تراجع واحدة: «' + g.label + '»' }); }
      render();
    }
    return { steps, changed };
  };
  AI.approve = () => AI.send('الخطة موافق عليها — نفّذها الآن خطوة بخطوة ثم راجع النتيجة بالتقاط إطارات.', { mode: 'exec', noContext: true, title: AI.planTitle });
  AI.stop = () => { AI.cancelled = true; if (AI.job && B()) B().cancel(AI.job); };
  AI.reset = () => { if (AI.busy) return; AI.msgs = []; AI.items = []; AI.lastPlan = false; render(); };
  // one-shot text completion without tools (caption translation etc.)
  AI.complete = async (prompt, o = {}) => {
    await AI.refresh(); if (!B() || !AI.ready()) throw new Error('المونتير الذكي غير مُعدّ — أضف مفتاح API من الإعدادات');
    const r = await B().messages('aic' + GW.uid(), { system: o.system || 'You are a precise subtitle translator. Output only what is asked.', messages: [{ role: 'user', content: prompt }], max_tokens: o.maxTokens || 8192 });
    if (!r || !r.ok) throw new Error(errText(r));
    return (r.result.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  };
  function errText(r) {
    if (!r) return 'لا يوجد رد';
    if (r.error === 'no-key') return 'لا يوجد مفتاح API — أضفه من الإعدادات.';
    if (r.cancelled) return 'أُلغي الطلب.';
    if (r.status === 401) return 'المفتاح غير صالح (401). تحقق منه في الإعدادات.';
    if (r.status === 429) return 'تجاوزت حد الطلبات (429) — انتظر قليلًا ثم أعد المحاولة.';
    if (r.status === 529 || r.status === 503) return 'خدمة Anthropic مشغولة الآن — أعد المحاولة بعد قليل.';
    return 'فشل الطلب' + (r.status ? ' (' + r.status + ')' : '') + ': ' + (r.error || '');
  }

  /* ---------------- panel ---------------- */
  const QUICK = [
    ['short', 'رتّب لي شورت من هذا الفيديو', 'رتّب لي شورت (1080×1920، أقل من 60 ثانية) من هذا الفيديو: اختر أقوى مقطع بهوك قوي في أول 3 ثوانٍ، وأزل الصمت، وأضف ترجمة متحركة وعنوان هوك ومؤثرات صوتية خفيفة.', { tr: 1 }],
    ['captions', 'أضف ترجمة متحركة', 'أضف ترجمة متحركة مناسبة لهذا الفيديو (فرّغ الصوت إن لم يوجد تفريغ) وتأكد أنها لا تغطي الوجوه أو العناوين.', {}],
    ['sfx', 'أضف مؤثرات صوتية مناسبة', 'أضف مؤثرات صوتية مناسبة (whoosh على الانتقالات وحركات الكاميرا، impact على الكشف والأرقام، ورق للكولاج) بدون مبالغة، على مسار صوت منفصل.', { clips: 1 }],
    ['map', 'سوِّ مشهد خريطة للحدث', 'سوِّ مشهد خريطة للحدث المذكور عند مؤشر التشغيل (لقطة تأسيسية ← تقريب ← الحدث ← النتيجة) مع مفاتيح كاميرا وتاريخ ومؤثرات صوتية.', { tr: 1 }],
    ['audio', 'نظّف الصوت وخلّه جاهز ليوتيوب', 'نظّف صوت الحوار/التعليق وخلّه جاهز ليوتيوب (−14 LUFS) واخفض الموسيقى تحت الصوت.', { clips: 1 }],
    ['review', 'راجع المونتاج واقترح تحسينات', 'راجع المونتاج (التقط إطارات من الهوك وكل قسم والنهاية) واقترح تحسينات محددة بالتوقيت. لا تعدّل شيئًا.', { clips: 1, tr: 1 }]
  ];
  let P = null;
  const css = `
.ai-p{display:flex;flex-direction:column;height:100%;min-height:0}
.ai-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--line);background:var(--bg2)}
.ai-head .ai-ttl{font-weight:600;color:var(--text);display:inline-flex;align-items:center;gap:6px}
.ai-head .ai-ttl .ico{color:var(--accent2)}
.ai-head .sp{flex:1}
.ai-prov{font-size:var(--fs0);color:var(--mute);display:inline-flex;align-items:center;gap:5px}
.ai-prov .dot{width:6px;height:6px;border-radius:50%;background:var(--mute)}.ai-prov .dot.ok{background:var(--green)}
.ai-note{margin:6px 8px 0;padding:6px 9px;border-radius:var(--rad1);background:var(--bg1);border:1px solid var(--line);color:var(--mute);font-size:var(--fs0);line-height:1.6}
.ai-quick{display:flex;flex-wrap:wrap;gap:4px;padding:6px 8px;border-bottom:1px solid var(--line)}
.ai-quick .btn{height:24px;font-size:var(--fs0)}
.ai-list{flex:1;min-height:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px}
.ai-msg{padding:7px 10px;border-radius:var(--rad2);line-height:1.7;white-space:pre-wrap;word-break:break-word;max-width:96%}
.ai-msg.user{align-self:flex-start;background:var(--accentBg);border:1px solid var(--accentLine);color:#fff}
.ai-msg.ai{align-self:flex-end;background:var(--bg3);border:1px solid var(--line2);color:var(--text)}
.ai-msg.note{align-self:center;background:none;color:var(--mute);font-size:var(--fs0);padding:2px 6px}
.ai-msg.err{align-self:stretch;background:var(--redBg);border:1px solid rgba(239,83,80,.4);color:#ffb3b0;font-size:var(--fs1)}
.ai-msg .mode{font-size:10px;color:var(--accent2);margin-inline-start:6px}
.ai-msg ul{margin:2px 0;padding-inline-start:18px}
.ai-step{display:grid;grid-template-columns:14px minmax(0,1fr);gap:6px;align-items:start;padding:3px 8px;border-inline-start:2px solid var(--line3);font-size:var(--fs0);color:var(--text2)}
.ai-step .st{width:8px;height:8px;border-radius:50%;margin-top:5px;background:var(--mute)}
.ai-step.run .st{background:var(--accent);animation:ai-pulse .9s infinite alternate}.ai-step.ok .st{background:var(--green)}.ai-step.err .st{background:var(--red)}
.ai-step code{font:10.5px var(--f-mono);color:var(--mute);direction:ltr;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-step .e{color:#ff8a86}
.ai-step img{display:block;max-width:220px;margin-top:4px;border-radius:4px;border:1px solid var(--line2)}
@keyframes ai-pulse{from{opacity:.35}to{opacity:1}}
.ai-plan{display:flex;gap:6px;align-self:flex-end}
.ai-in{border-top:1px solid var(--line);padding:6px 8px;display:flex;flex-direction:column;gap:6px;background:var(--bg2)}
.ai-in textarea{width:100%;min-height:54px;max-height:160px;resize:vertical;padding:6px 8px;line-height:1.6;height:auto;font:inherit}
.ai-ctx{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:var(--fs0);color:var(--mute)}
.ai-ctx .chip{height:22px;padding:0 9px;font-size:var(--fs0);cursor:pointer;display:inline-flex;align-items:center;gap:4px;color:var(--text2)}
.ai-row{display:flex;gap:6px;align-items:center}.ai-row .sp{flex:1}
.ai-stat{font-size:var(--fs0);color:var(--accent2);min-height:16px}
.ai-set .frow{margin-bottom:8px}.ai-set .hint{color:var(--mute);font-size:var(--fs0);line-height:1.7;margin:4px 0 10px}
.ai-set .ok{color:var(--green)}.ai-set .warn2{color:var(--yellow)}
`;
  GW.registerPanel('ai', 'المونتير الذكي', (el) => {
    P = el; el.classList.add('ai-p'); el.dir = 'rtl';
    if (!document.getElementById('ai-css')) { const st = document.createElement('style'); st.id = 'ai-css'; st.textContent = css; document.head.append(st); }
    AI.refresh().then(render); render();
  });
  const ico = (n, s) => (GW.ico ? GW.ico(n, s || 13) : '');
  function mk(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function btn(label, on, cls, title) { const b = mk('button', 'btn sm ' + (cls || ''), label); b.onclick = on; if (title) b.title = title; return b; }
  function md(t) { // tiny, safe markdown: **bold**, bullets, numbered lists
    const lines = esc(t).split('\n'); let out = '', inL = false;
    for (const l of lines) { const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l); if (m) { if (!inL) { out += '<ul>'; inL = true; } out += '<li>' + m[1] + '</li>'; continue; } if (inL) { out += '</ul>'; inL = false; } out += l + '\n'; }
    if (inL) out += '</ul>'; return out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n+$/, '');
  }
  function push(it) { AI.items.push(it); if (it.kind === 'user') AI.planTitle = it.text; renderList(); return it; }
  function itemEl(it) {
    if (it.kind === 'step') {
      const e = mk('div', 'ai-step ' + it.state); const lab = GW.AITools.LABELS[it.name] || it.name;
      e.innerHTML = `<span class="st"></span><div><b>${esc(lab)}</b> <code title="${esc(it.args)}">${esc(it.name)} ${esc(it.args)}</code>${it.err ? `<div class="e">${esc(it.err)}</div>` : ''}</div>`;
      if (it.img) { const im = new Image(); im.src = it.img; im.alt = 'frame'; e.lastChild.append(im); }
      it.el = e; return e;
    }
    const e = mk('div', 'ai-msg ' + it.kind); if (it.kind === 'ai' || it.kind === 'user') { e.dataset.noi18n = ''; e.dir = 'auto'; } e.innerHTML = it.kind === 'ai' ? md(it.text) : esc(it.text) + (it.kind === 'user' ? `<span class="mode">${it.mode === 'plan' ? 'خطة' : 'تنفيذ'}</span>` : ''); it.el = e; return e;
  }
  function updItem(it) { if (it.el && it.el.parentNode) it.el.replaceWith(itemEl(it)); }
  function setStatus(t) { const e = P && P.querySelector('.ai-stat'); if (e) e.textContent = t || ''; }
  function renderList() {
    if (!P) return; const L = P.querySelector('.ai-list'); if (!L) return render();
    L.innerHTML = '';
    if (!AI.items.length) L.append(mk('div', 'empty', 'اكتب ما تريد، أو اختر إجراءً سريعًا.<br>يقترح المساعد خطة أولًا، ثم ينفّذها بعد موافقتك.'));
    for (const it of AI.items) L.append(itemEl(it));
    if (AI.lastPlan && !AI.busy) { const r = mk('div', 'ai-plan'); r.append(btn(ico('play', 12) + ' نفّذ', () => AI.approve(), 'pri', 'تنفيذ الخطة المقترحة'), btn('عدّل الخطة', () => { const ta = P.querySelector('.ai-in textarea'); if (ta) { ta.focus(); ta.placeholder = 'ما الذي تريد تغييره في الخطة؟'; } }, 'ghost')); L.append(r); }
    L.scrollTop = L.scrollHeight;
  }
  function render() {
    if (!P) return; const st = AI.st; P.innerHTML = '';
    const head = mk('div', 'ai-head');
    const prov = !B() ? 'نسخة سطح المكتب فقط' : !st ? '…' : st.provider === 'mcp' ? 'عبر Claude Desktop (MCP)' : st.hasKey ? 'Anthropic API · ' + st.model : 'غير مُعدّ';
    head.append(mk('span', 'ai-ttl', ico('sparkle', 14) + ' المونتير الذكي'), mk('span', 'sp'), mk('span', 'ai-prov', `<span class="dot ${AI.ready() ? 'ok' : ''}"></span>${esc(prov)}`), btn(ico('settings', 13), () => AI.settings(), 'ghost ico', 'إعدادات المونتير الذكي'));
    P.append(head);
    P.append(mk('div', 'ai-note', 'مساعد اختياري يستخدم نموذج ذكاء اصطناعي عام (Claude) مع «دليل المونتاج» المرفق بالبرنامج — ليس خبيرًا شاهد ملايين الفيديوهات، فراجع النتيجة دائمًا. كل تعديلاته قابلة للتراجع، والبرنامج يعمل كاملًا بدونه.'));
    if (st && st.provider === 'mcp') { const n = mk('div', 'empty', 'المساعد مضبوط على العمل عبر Claude Desktop (MCP).<br>تحدّث مع Claude من تطبيق Claude Desktop وسيتحكم بالبرنامج.'); n.append(mk('br'), btn('إعداد الاتصال بـ Claude Desktop…', () => GW.UI.assistantSettings(), 'pri')); P.append(n); return; }
    const q = mk('div', 'ai-quick');
    for (const [k, label, prompt, ctx] of QUICK) { const b = btn(esc(label), () => { Object.assign(AI.ctx, ctx); AI.send(prompt, { mode: k === 'review' ? 'plan' : AI.mode, title: label }); }, '', label); b.dataset.q = k; b.disabled = AI.busy; q.append(b); }
    P.append(q);
    P.append(mk('div', 'ai-list'));
    const inp = mk('div', 'ai-in');
    const ctx = mk('div', 'ai-ctx', '<span>إرفاق:</span>');
    for (const [k, n] of [['sel', 'التحديد'], ['clips', 'المقاطع'], ['tr', 'التفريغ']]) { const c = mk('span', 'chip' + (AI.ctx[k] ? ' on' : ''), (AI.ctx[k] ? ico('check', 11) : '') + esc(n)); c.dataset.ctx = k; c.onclick = () => { AI.ctx[k] = AI.ctx[k] ? 0 : 1; render(); }; ctx.append(c); }
    const ta = mk('textarea', 'inp'); ta.dir = 'auto'; ta.placeholder = 'مثال: اختصر المقدمة إلى 10 ثوانٍ وأضف عنوانًا للحدث عند 0:45'; ta.value = AI.draft || '';
    ta.oninput = () => { AI.draft = ta.value; };
    ta.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } };
    const go = () => { const v = ta.value.trim(); if (!v) return; AI.draft = ''; ta.value = ''; AI.send(v); };
    const row = mk('div', 'ai-row');
    const mode = mk('div', 'seg'); mode.style.flex = '0 0 auto';
    for (const [k, n, t] of [['plan', 'خطة أولًا', 'يقترح خطة بدون تعديل، ثم تضغط «نفّذ»'], ['exec', 'نفّذ مباشرة', 'ينفّذ فورًا']]) { const b = mk('button', AI.mode === k ? 'on' : '', esc(n)); b.title = t; b.onclick = () => { AI.mode = k; render(); }; mode.append(b); }
    row.append(mode, mk('span', 'sp'));
    if (AI.busy) row.append(btn(ico('stop', 12) + ' إيقاف', () => AI.stop(), 'danger'));
    else row.append(btn('تراجع عن كل تعديلات المساعد', () => AI.undoAll(), 'ghost', 'إعادة المشروع إلى ما قبل أول تعديل للمساعد'), btn('محادثة جديدة', () => AI.reset(), 'ghost'), btn(ico('arrow', 12) + ' إرسال', go, 'pri'));
    inp.append(ctx, ta, row, mk('div', 'ai-stat'));
    P.append(inp); renderList();
  }
  AI.render = render;

  /* ---------------- settings dialog ---------------- */
  AI.settings = async () => {
    await AI.refresh(); const body = mk('div', 'ai-set'); const F = GW.UI.form;
    let models = null;
    const draw = () => {
      const st = AI.st || {}; body.innerHTML = '';
      if (!B()) { body.append(mk('p', '', 'المونتير الذكي متاح في نسخة سطح المكتب فقط.')); return; }
      body.append(F.frow('مزوّد الذكاء', F.segIn([['anthropic', 'Anthropic API (مفتاحك)'], ['mcp', 'عبر Claude Desktop (MCP)']], st.provider || 'anthropic', async v => { AI.st = await B().setSettings({ provider: v }); draw(); render(); })));
      if (st.provider === 'mcp') {
        body.append(mk('p', 'hint', 'في هذا الوضع لا يرسل البرنامج أي طلب بنفسه: تتحدث مع Claude في تطبيق Claude Desktop، وهو يتحكم بالبرنامج عبر واجهة MCP المحلية.'), btn('إعداد الاتصال بـ Claude Desktop…', () => GW.UI.assistantSettings(), 'pri'));
        return;
      }
      const kst = mk('div', 'hint'); kst.dataset.a = 'keyst';
      kst.innerHTML = st.hasKey ? `<span class="ok">المفتاح محفوظ ${st.persisted ? 'ومشفّر على هذا الجهاز' : 'لهذه الجلسة فقط (لا يتوفر تشفير في النظام)'}</span> <span dir="ltr">${esc(st.keyHint)}</span>${st.backend === 'basic_text' ? '<br><span class="warn2">تنبيه: لا يوجد مخزن مفاتيح للنظام، التشفير هنا ضعيف.</span>' : ''}` : 'لا يوجد مفتاح بعد. أنشئ مفتاحًا من console.anthropic.com (التكلفة على حسابك).';
      const ki = mk('input', 'inp'); ki.type = 'password'; ki.dir = 'ltr'; ki.placeholder = st.hasKey ? '•••••••• (اتركه فارغًا للإبقاء على المحفوظ)' : 'sk-ant-…'; ki.autocomplete = 'off'; ki.spellcheck = false; ki.style.flex = '1'; ki.dataset.a = 'key';
      ki.onkeydown = e => e.stopPropagation();
      const save = btn('حفظ المفتاح', async () => { const v = ki.value.trim(); if (!v) return; const r = await B().setKey(v); ki.value = ''; if (!r.ok) { GW.toast(r.error === 'format' ? 'صيغة المفتاح غير صحيحة' : 'تعذر حفظ المفتاح', 'err'); return; } AI.st = r; GW.toast('تم حفظ المفتاح'); draw(); render(); }, 'pri'); save.dataset.a = 'savekey';
      const clr = btn('حذف', async () => { AI.st = await B().clearKey(); GW.toast('تم حذف المفتاح'); draw(); render(); }, 'ghost');
      body.append(F.frow('مفتاح API', [ki, save].concat(st.hasKey ? [clr] : [])), kst);
      const opts = [['claude-opus-5-5', 'claude-opus-5-5 (افتراضي)']]; for (const m of models || []) if (!opts.some(o => o[0] === m.id)) opts.push([m.id, m.name && m.name !== m.id ? m.id + ' — ' + m.name : m.id]);
      if (st.model && !opts.some(o => o[0] === st.model)) opts.push([st.model, st.model]);
      const ms = F.selectIn(opts, st.model || 'claude-opus-5-5', async v => { AI.st = await B().setSettings({ model: v }); render(); });
      const mi = mk('input', 'inp'); mi.dir = 'ltr'; mi.placeholder = 'معرّف نموذج آخر'; mi.style.width = '150px'; mi.onkeydown = async e => { e.stopPropagation(); if (e.key === 'Enter' && mi.value.trim()) { AI.st = await B().setSettings({ model: mi.value.trim() }); draw(); render(); } };
      const ref = btn('تحديث القائمة', async () => { const r = await B().models(); if (r.ok) { models = r.models; draw(); } else GW.toast('تعذر جلب النماذج: ' + (r.error === 'no-key' ? 'أضف المفتاح أولًا' : r.error), 'err'); }, 'ghost');
      body.append(F.frow('النموذج', [ms, mi, ref]));
      body.append(F.frow('أقصى عدد خطوات', F.rangeIn(st.maxSteps || 25, 5, 60, 1, GW.debounce(async v => { AI.st = await B().setSettings({ maxSteps: v }); }, 300))));
      body.append(mk('p', 'hint', 'يُحفظ المفتاح مشفّرًا (Electron safeStorage) في مجلد بيانات البرنامج، ولا يُرسل إلا إلى api.anthropic.com مع طلبات المساعد، ولا يُكتب في أي سجل. تُرسل مع كل طلب: تعليماتك، وملخص المشروع، و«دليل المونتاج»، ونتائج الأدوات (ومنها لقطات من الإطارات التي يطلبها المساعد).'));
    };
    draw();
    GW.modal({ title: 'إعدادات المونتير الذكي', width: 640, body, buttons: [{ label: 'إغلاق', primary: true }] });
  };

  /* ---------------- wiring ---------------- */
  if (GW.PANEL_LIST && !GW.PANEL_LIST.includes('ai')) GW.PANEL_LIST.push('ai');
  GW.bus.on('ready', () => { if (GW.PANEL_ICO) GW.PANEL_ICO.ai = 'sparkle'; AI.refresh(); });
  const addItem = (menuName, item) => { const e = GW.MENUS && GW.MENUS.find(m => m[0] === menuName); if (!e) return; const f = e[1]; e[1] = () => [...f(), '-', item]; };
  addItem('نافذة', { label: 'المونتير الذكي', action: () => GW.showPanel('ai') });
  addItem('تحرير', { label: 'إعدادات المونتير الذكي…', action: () => AI.settings() });
  GW.cmd.aiEditor = () => GW.showPanel('ai');
})();
