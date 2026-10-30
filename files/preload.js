// Bridge between the editor UI and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

function b64url(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

contextBridge.exposeInMainWorld('gws', {
  desktop: true,
  pathFor: (f) => { try { return webUtils.getPathForFile(f); } catch (e) { return null; } },
  mediaUrl: (p) => 'app://gws/__media/' + b64url(p) + '/' + encodeURIComponent((p.split(/[\\/]/).pop() || 'f')),
  open: (o) => ipcRenderer.invoke('dlg:open', o),
  saveDialog: (o) => ipcRenderer.invoke('dlg:save', o),
  readText: (p) => ipcRenderer.invoke('fs:readText', p),
  writeText: (p, s) => ipcRenderer.invoke('fs:writeText', p, s),
  writeBin: (p, b) => ipcRenderer.invoke('fs:writeBin', p, b),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  remove: (p) => ipcRenderer.invoke('fs:remove', p),
  paths: () => ipcRenderer.invoke('app:paths'),
  setDirty: (d) => ipcRenderer.invoke('app:dirty', d),
  closeNow: () => ipcRenderer.invoke('app:close-now'),
  setTitle: (t) => ipcRenderer.invoke('app:title', t),
  showItem: (p) => ipcRenderer.invoke('shell:show', p),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  ffAvailable: () => ipcRenderer.invoke('ff:available'),
  ffProbe: (p) => ipcRenderer.invoke('ff:probe', p),
  ffRun: (id, args) => ipcRenderer.invoke('ff:run', id, args),
  ffStart: (o) => ipcRenderer.invoke('ff:start', o),
  ffFrame: (id, buf) => ipcRenderer.invoke('ff:frame', id, buf),
  ffEnd: (id) => ipcRenderer.invoke('ff:end', id),
  ffCancel: (id) => ipcRenderer.invoke('ff:cancel', id),
  onProgress: (cb) => ipcRenderer.on('ff:progress', (e, id, t) => cb(id, t)),
  onSaveThenClose: (cb) => ipcRenderer.on('app:save-then-close', () => cb()),
  argvFile: () => ipcRenderer.invoke('app:argv-file'),
  onOpenFile: (cb) => ipcRenderer.on('app:open-file', (e, p) => cb(p))
  /* ===== updater ===== (in-app delta updates; see updater.js — leading commas keep the lines above untouched) */
  , updCheck: () => ipcRenderer.invoke('upd:check')
  , updDownload: () => ipcRenderer.invoke('upd:download')
  , updRestart: () => ipcRenderer.invoke('upd:restart')
  , updStatus: () => ipcRenderer.invoke('upd:status')
  , updOpenFull: (url) => ipcRenderer.invoke('upd:open-full', url)
  , onUpdProgress: (cb) => { const f = (e, p) => cb(p); ipcRenderer.on('upd:progress', f); return () => ipcRenderer.removeListener('upd:progress', f); }
  /* ===== /updater ===== */
  /* ===== whisper ===== (speech-to-text & captions; see the whisper block in main.js) */
  , asrStatus: () => ipcRenderer.invoke('asr:status')
  , asrModels: () => ipcRenderer.invoke('asr:models')
  , asrDownload: (kind, id) => ipcRenderer.invoke('asr:download', kind, id)
  , asrRun: (o) => ipcRenderer.invoke('asr:run', o)
  , asrCancel: (id) => ipcRenderer.invoke('asr:cancel', id)
  , asrRemoveModel: (id) => ipcRenderer.invoke('asr:remove-model', id)
  , asrImportModel: (p) => ipcRenderer.invoke('asr:import-model', p)
  , asrOpenModels: () => ipcRenderer.invoke('asr:open-models')
  , onAsrProgress: (cb) => { const f = (e, p) => cb(p); ipcRenderer.on('asr:progress', f); return () => ipcRenderer.removeListener('asr:progress', f); }
  /* ===== /whisper ===== */
  /* ===== media perf ===== (see the media perf block in main.js) */
  , stat: (p) => ipcRenderer.invoke('mp:stat', p)
  , existsMany: (list) => ipcRenderer.invoke('mp:existsMany', list)
  , mpRun: (id, args, o) => ipcRenderer.invoke('mp:run', id, args, o)
  , mpKill: (id) => ipcRenderer.invoke('mp:kill', id)
  , ffCaps: () => ipcRenderer.invoke('mp:caps')
  , decOpen: (o) => ipcRenderer.invoke('mp:decOpen', o)
  , decRead: (id) => ipcRenderer.invoke('mp:decRead', id)
  , decClose: (id) => ipcRenderer.invoke('mp:decClose', id)
  /* ===== /media perf ===== */
});

/* ===== api ===== (assistant automation bridge: main forwards JSON-RPC calls → GW.API in app/js/api.js) */
contextBridge.exposeInMainWorld('gwsApi', {
  status: () => ipcRenderer.invoke('api:status'),
  enable: (on) => ipcRenderer.invoke('api:enable', !!on),
  onCall: (cb) => { const f = (e, id, method, params) => cb(id, method, params); ipcRenderer.on('api:call', f); return () => ipcRenderer.removeListener('api:call', f); },
  reply: (id, res) => ipcRenderer.send('api:result', id, res)
});
/* ===== /api ===== */
