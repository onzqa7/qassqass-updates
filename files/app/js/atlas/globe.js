'use strict';
/* GeoWar Atlas — tile streaming + WebGL2 globe / flat renderer */
(function () {
  const A = GW.Atlas; const Cm = A.Cam; const PR = A.Providers; const v3 = Cm.v3;
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;

  /* ===================== tile cache ===================== */
  const T = A.Tiles = { cache: new Map(), queue: [], inflight: 0, frame: 0, max: 700, onLoad: null, failed: 0, loaded: 0 };
  T.url = (p, z, x, y) => '__tile/' + p + '/' + z + '/' + x + '/' + y;
  T.want = (p, z, x, y, prio) => {
    const k = p + '/' + z + '/' + x + '/' + y; let e = T.cache.get(k);
    if (!e) { e = { k, p, z, x, y, st: 0, used: T.frame, prio }; T.cache.set(k, e); T.queue.push(e); }
    else { e.used = T.frame; e.prio = Math.min(e.prio, prio); if (e.st === 3 && Date.now() - e.t > 30000) { e.st = 0; T.queue.push(e); } }
    return e;
  };
  T.pump = () => {
    if (!T.queue.length) return;
    T.queue.sort((a, b) => a.prio - b.prio);
    const vecT0 = performance.now(); const vecMs = T.vecBudget || 14; let vecN = 0; const skipped = [];
    while (T.inflight < 10 && T.queue.length) {
      const e = T.queue.shift(); if (e.st !== 0) continue;
      if (e.used < T.frame - 2 && !e.keep) { T.cache.delete(e.k); if (e.waiters) { for (const w of e.waiters) w(); e.waiters = null; } continue; } // no longer needed
      if (e.p.startsWith('vec:')) { // vector tiles are rendered locally, a few per frame
        if (vecN > 0 && performance.now() - vecT0 > vecMs) { skipped.push(e); continue; }
        vecN++; e.st = 1;
        try { e.bmp = A.VT.render(e); e.st = 2; T.loaded++; } catch (err) { e.st = 3; e.t = Date.now(); console.warn('vtile', err); }
        if (T.onLoad) T.onLoad(e); if (e.waiters) { for (const w of e.waiters) w(); e.waiters = null; }
        continue;
      }
      e.st = 1; T.inflight++;
      fetch(T.url(e.p, e.z, e.x, e.y)).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(b => createImageBitmap(b)).then(bmp => { e.bmp = bmp; e.st = 2; T.loaded++; })
        .catch(() => { e.st = 3; e.t = Date.now(); T.failed++; })
        .finally(() => { T.inflight--; T.pump(); if (T.onLoad) T.onLoad(e); if (e.waiters) { for (const w of e.waiters) w(); e.waiters = null; } });
    }
    if (skipped.length) { T.queue.push(...skipped); if (T.onLoad) setTimeout(() => T.onLoad(null), 0); }
  };
  T.evict = (gl) => {
    if (T.cache.size <= T.max) return;
    const arr = [...T.cache.values()].filter(e => e.st >= 2 && e.used < T.frame - 1 && !e.keep).sort((a, b) => a.used - b.used);
    for (const e of arr.slice(0, T.cache.size - T.max)) { if (e.tex) gl.deleteTexture(e.tex); if (e.bmp && e.bmp.close) e.bmp.close(); T.cache.delete(e.k); }
  };
  T.wait = (entries, ms) => Promise.race([
    Promise.all(entries.filter(e => e.st < 2).map(e => new Promise(r => { (e.waiters = e.waiters || []).push(r); }))),
    new Promise(r => setTimeout(r, ms))]);

  /* ===================== GL ===================== */
  const G = A.GL = {};
  const VS_SURF = `#version 300 es
  in vec3 a_rel; in vec2 a_uv; in float a_sh; uniform mat4 u_vp; uniform vec3 u_off, u_cam; uniform float u_hc;
  uniform int u_flat; uniform vec2 u_res, u_cs, u_sc; uniform float u_k;
  out vec2 v_uv; out vec3 v_n; out float v_h; out vec2 v_ll; out float v_sh;
  uniform vec3 u_cen;
  void main(){
    v_uv=a_uv; v_sh=a_sh;
    if(u_flat==1){ vec2 p=a_rel.xy+u_off.xy; vec2 s=vec2(p.x*u_cs.x+p.y*u_cs.y, -p.x*u_cs.y+p.y*u_cs.x)*u_k; gl_Position=vec4(s.x*2.0/u_res.x+u_sc.x, s.y*2.0/u_res.y+u_sc.y, 0.0, 1.0); v_h=1.0; v_n=vec3(1.0,0.0,0.0); v_ll=a_rel.xy+u_cen.xy; }
    else { vec3 p=a_rel+u_off; gl_Position=u_vp*vec4(p,1.0); v_n=u_cen+a_rel; v_h=dot(a_rel,u_cam)+u_hc; v_ll=vec2(0.0); }
  }`;
  const FS_SURF = `#version 300 es
  precision highp float; precision highp int; in vec2 v_uv; in vec3 v_n; in float v_h; in vec2 v_ll; in float v_sh; out vec4 o; uniform float u_shade;
  uniform sampler2D u_tex, u_night; uniform vec4 u_uvr; uniform float u_alpha, u_sat, u_bri, u_con, u_tintAmt, u_light, u_nightAmt, u_gamma, u_ge, u_geS, u_geL, u_warm; uniform vec3 u_tint, u_sun, u_geW, u_geT, u_gain, u_wGain; uniform float u_wAmt; uniform vec3 u_lvl; uniform int u_flat, u_mode;
  void main(){
    if(v_h<0.0) discard;
    vec4 c=texture(u_tex, u_uvr.xy+v_uv*u_uvr.zw);
    vec3 col=c.rgb;
    if(u_mode==0){
      float wM=smoothstep(0.02,0.10,col.b-col.r)*smoothstep(0.62,0.35,dot(col,vec3(.2126,.7152,.0722))); // water (blue-dominant) in the raw imagery
      col=pow(max(col,0.0),vec3(u_gamma)); vec3 c0=col;
      float l=dot(col,vec3(.2126,.7152,.0722)); col=mix(vec3(l),col,u_sat); col=(col-.5)*u_con+.5; col*=u_bri;
      col=mix(col, l*u_tint*1.6, u_tintAmt);
      col*=vec3(1.0+u_warm*.09, 1.0+u_warm*.015, 1.0-u_warm*.09); // warmth (+) / cool (-)
      col*=u_gain; // per-channel colour balance (style grade)
      if(u_lvl.z>0.0){ vec3 st=u_lvl.x+(col-u_lvl.x)*u_lvl.y; float ls=dot(st,vec3(.2126,.7152,.0722)); st=mix(vec3(ls),st,.62); col=mix(col, max(st,0.0), u_lvl.z*(1.0-wM)); } // land 'light': stretch highlights around a dark pivot
      col*=mix(vec3(1.0), u_wGain, wM*u_wAmt); // darken water by multiplication so seabed relief stays visible
      if(u_ge>0.0){ // 'Google Earth' look: deep navy water, neutral (less orange) land
        float l0=dot(c0,vec3(.2126,.7152,.0722)); float w=smoothstep(0.015,0.11,c0.b-c0.r)*smoothstep(0.75,0.45,l0); // water mask from the ungraded pixel
        float lw=(c0.g+c0.b)*.5*1.9; vec3 water=u_geW*lw+u_geW*.06;
        vec3 land=col*u_geT; float ll2=dot(land,vec3(.2126,.7152,.0722)); land=mix(vec3(ll2),land,u_geS)*u_geL;
        col=mix(col, mix(land, water, w), u_ge);
      }
      col*=mix(1.0, clamp(v_sh, .55, 1.25), u_shade);
      if(u_light>0.0 && u_flat==0){ vec3 n=normalize(v_n); float d=dot(n,u_sun); float day=smoothstep(-.12,.18,d);
        vec2 ll=vec2(atan(n.y,n.x)/6.2831853+.5, .5-asin(clamp(n.z,-1.0,1.0))/3.14159265);
        vec3 nl=texture(u_night,ll).rgb*u_nightAmt; col=mix(nl+col*.06, col*(0.35+0.65*clamp(d*1.6+.3,0.0,1.0)), mix(1.0-u_light,1.0,day)); }
      o=vec4(clamp(col,0.0,1.0),1.0)*u_alpha;
    } else if(u_mode==1){ // multiply overlay (hillshade): output premultiplied shade for DST_COLOR blend
      if(v_sh<0.0) discard; float s=mix(1.0, dot(col,vec3(.333)), u_alpha*c.a); o=vec4(vec3(s),1.0);
    } else { if(v_sh<0.0) discard; o=c*u_alpha; } // straight overlay (skirt walls skipped: no vertical streaks of border lines) (labels): texture already premultiplied
  }`;
  const VS_FULL = `#version 300 es
  in vec2 a_p; out vec2 v_uv; void main(){ v_uv=a_p*.5+.5; gl_Position=vec4(a_p,0.0,1.0); }`;
  const FS_SKY = `#version 300 es
  precision highp float; in vec2 v_uv; out vec4 o;
  uniform vec3 u_r,u_u,u_a,u_C,u_space,u_space2,u_atmo; uniform float u_f,u_atmoAmt,u_stars,u_bg,u_hs; uniform vec2 u_res,u_sc; uniform int u_pass;
  float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  void main(){
    vec2 px=v_uv*u_res; vec3 dir=normalize(u_a+u_r*(px.x-u_res.x*.5-u_sc.x)/u_f+u_u*(px.y-u_res.y*.5+u_sc.y)/u_f);
    float b=dot(u_C,dir); float c=dot(u_C,u_C)-1.0; float disc=b*b-c; float tg=-1.0; if(disc>=0.0){ tg=-b-sqrt(disc); }
    float R2=(1.0+u_hs)*(1.0+u_hs); float c2=dot(u_C,u_C)-R2; float d2=b*b-c2; float L=0.0;
    if(d2>0.0){ float sq=sqrt(d2); float t0=max(0.0,-b-sq), t1=-b+sq; if(tg>0.0) t1=tg; L=max(0.0,t1-t0); }
    float haze=1.0-exp(-L/(u_hs*2.2));
    if(u_pass==0){
      if(tg>0.0){ o=vec4(0.0); return; }
      vec3 sp=mix(u_space2,u_space,clamp(v_uv.y*1.2-.1,0.0,1.0));
      float st=0.0; if(u_stars>0.0){ vec3 q=floor(dir*700.0); float h=hash(q); st=step(.9985,h)*(.25+.75*hash(q+3.1))*u_stars; }
      float closest=sqrt(max(0.0,c-b*b+1.0)); float hh=max(0.0,closest-1.0); float fwd=step(b,0.0);
      float glow=(exp(-hh/(u_hs*.35))*.75+exp(-hh/(u_hs*2.2))*.22)*fwd;
      vec3 col=sp+vec3(st); float a=u_bg;
      vec3 atm=mix(u_atmo,vec3(.85,.93,1.0),exp(-hh/(u_hs*.12))*.5)*glow*u_atmoAmt;
      col=col*a*(1.0-glow*.5)+atm; o=vec4(col, max(a, clamp(glow,0.0,1.0)*u_atmoAmt));
    } else {
      if(tg<0.0){ o=vec4(0.0); return; }
      float hg=1.0-exp(-max(0.0,L-u_hs*1.3)/(u_hs*3.0)); float h=clamp(hg*.8,0.0,.8)*u_atmoAmt; o=vec4(u_atmo*h, h);
    }
  }`;
  const FS_QUAD = `#version 300 es
  precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D u_tex; uniform float u_alpha;
  void main(){ o=texture(u_tex,v_uv)*u_alpha; }`;
  const FS_POST = `#version 300 es
  precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_vig,u_grain,u_paper,u_sepia,u_seed,u_letter,u_con,u_sat;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float s=0.0,a=.5; for(int i=0;i<5;i++){ s+=noise(p)*a; p*=2.03; a*=.5; } return s; }
  void main(){
    vec4 c=texture(u_tex,v_uv); vec3 col=c.a>0.0?c.rgb/c.a:vec3(0.0);
    float l=dot(col,vec3(.299,.587,.114)); col=mix(vec3(l),col,u_sat); col=(col-.5)*u_con+.5;
    if(u_sepia>0.0){ vec3 sp=vec3(l*1.07+.06,l*.92+.04,l*.72+.02); col=mix(col,sp,u_sepia); }
    vec2 asp=vec2(u_res.x/u_res.y,1.0);
    if(u_paper>0.0){ vec2 q=v_uv*asp*3.0; float n=fbm(q*2.0)*.6+fbm(q*9.0)*.4; float fib=noise(vec2(q.x*60.0,q.y*4.0))*.5; col*=mix(1.0, .80+.22*n+fib*.05, u_paper); col=mix(col, col*vec3(1.0,.96,.86), u_paper*.5); }
    if(u_vig>0.0){ vec2 d=(v_uv-.5)*asp/asp.x*1.0; float r=length((v_uv-.5)*vec2(1.0,.85)); col*=1.0-u_vig*smoothstep(.3,.95,r); }
    if(u_grain>0.0){ float g=hash(v_uv*u_res+u_seed*91.7)-.5; col+=g*u_grain*.18; }
    if(u_letter>0.0){ float bar=u_letter*.5; if(v_uv.y<bar||v_uv.y>1.0-bar){ col=vec3(0.0); c.a=1.0; } }
    o=vec4(clamp(col,0.0,1.0)*c.a,c.a);
  }`;

  function sh(gl, type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.slice(0, 200)); return s; }
  function prog(gl, vs, fs) {
    const p = gl.createProgram(); gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_rel'); gl.bindAttribLocation(p, 0, 'a_p'); gl.bindAttribLocation(p, 1, 'a_uv'); gl.bindAttribLocation(p, 2, 'a_sh'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const inf = gl.getActiveUniform(p, i); u[inf.name] = gl.getUniformLocation(p, inf.name); }
    return { p, u };
  }
  G.init = () => {
    if (G.gl) return G;
    const cv = G.canvas = document.createElement('canvas'); cv.width = 16; cv.height = 16;
    const gl = G.gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    G.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    G.surf = prog(gl, VS_SURF, FS_SURF); G.sky = prog(gl, VS_FULL, FS_SKY); G.quad = prog(gl, VS_FULL, FS_QUAD); G.post = prog(gl, VS_FULL, FS_POST);
    G.fullVao = gl.createVertexArray(); gl.bindVertexArray(G.fullVao); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    G.white = texFrom(new Uint8Array([255, 255, 255, 255]), 1, 1);
    G.idx = {}; G.meshes = new Map(); G.canvasTex = {}; G.base = {};
    return G;
  };
  function texFrom(data, w, h) { const gl = G.gl; const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
  function texImage(src, mip, wrapS) {
    const gl = G.gl; const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); if (G.aniso) gl.texParameterf(gl.TEXTURE_2D, G.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, G.anisoMax || (G.anisoMax = gl.getParameter(G.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return t;
  }
  G.texImage = texImage;
  // bundled equirect base textures
  G.baseTex = (name) => {
    if (G.base[name] !== undefined) return G.base[name];
    G.base[name] = null; const img = new Image(); img.onload = () => { G.base[name] = texImage(img, true, true); if (T.onLoad) T.onLoad(); }; img.src = 'assets/' + name + '.webp';
    return null;
  };
  G.loadImg = (url) => new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null); img.src = url; });

  /* ---- meshes ---- */
  function gridIndex(nx, ny) {
    const k = nx + 'x' + ny; if (G.idx[k]) return G.idx[k];
    const gl = G.gl; const ix = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; ix.push(a, c, b, b, c, d); }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ix), gl.STATIC_DRAW);
    return G.idx[k] = { buf, n: ix.length };
  }
  function makeMesh(key, nx, ny, fn) { // fn(i/nx, j/ny, i, j) -> [rx,ry,rz,u,v,(shade)] relative coords
    const gl = G.gl; const data = new Float32Array((nx + 1) * (ny + 1) * 6); let o = 0;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const r = fn(i / nx, j / ny, i, j); data.set(r, o); if (r.length < 6) data[o + 5] = 1; o += 6; }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    const ix = gridIndex(nx, ny); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ix.buf); gl.bindVertexArray(null);
    const m = { vao, vb, n: ix.n, used: 0 }; G.meshes.set(key, m); return m;
  }
  const tileLon = (x, z) => x / Math.pow(2, z) * 360 - 180;
  const tileLat = (y, z) => { const n = Math.PI * (1 - 2 * y / Math.pow(2, z)); return Math.atan(Math.sinh(n)) * DEG; };
  const tileMy = (y, z) => Math.PI * (1 - 2 * y / Math.pow(2, z));
  G.tileLon = tileLon; G.tileLat = tileLat;
  // globe tile mesh: tile centre (3D, float64) + relative verts
  /* ---- 3D terrain (Terrarium elevation tiles, decoded on the CPU, displaced into tile meshes) ---- */
  const TZMAX = 12;
  function demHeights(e) {
    if (e.h) return e.h; if (!e.bmp) return null;
    try { const oc = new OffscreenCanvas(256, 256); const g = oc.getContext('2d', { willReadFrequently: true }); g.drawImage(e.bmp, 0, 0, 256, 256); const d = g.getImageData(0, 0, 256, 256).data; const h = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768; e.h = h; if (e.bmp.close) e.bmp.close(); e.bmp = null; } catch (err) { e.h = null; }
    return e.h;
  }
  // best available elevation source for render tile (z,x,y): returns {e (dem entry), zt, xt, yt, sig}
  function demFor(z, x, y) {
    if (z < 5) return null; let zt = Math.min(z, TZMAX); let xt = x >> (z - zt), yt = y >> (z - zt);
    const want = T.want('terrain', zt, xt, yt, zt * 10 + 3);
    for (let k = 0; k <= 6 && zt - k >= 4; k++) {
      const zz = zt - k, xx = xt >> k, yy = yt >> k; const e = T.cache.get('terrain/' + zz + '/' + xx + '/' + yy);
      if (e && e.st === 2 && demHeights(e)) { e.used = T.frame; return { e, zt: zz, xt: xx, yt: yy, sig: zz + '/' + xx + '/' + yy }; }
    }
    void want; return null;
  }
  function demSample(d, lon, lat) {
    const n = Math.pow(2, d.zt); const fx = ((lon + 180) / 360 * n - d.xt) * 256 - .5;
    const la = Math.max(-85.05, Math.min(85.05, lat)) * RAD; const fy = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n - d.yt) * 256 - .5;
    const x0 = Math.max(0, Math.min(254, Math.floor(fx))), y0 = Math.max(0, Math.min(254, Math.floor(fy))); const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0)); const h = d.e.h;
    const v = h[y0 * 256 + x0] * (1 - ax) * (1 - ay) + h[y0 * 256 + x0 + 1] * ax * (1 - ay) + h[(y0 + 1) * 256 + x0] * (1 - ax) * ay + h[(y0 + 1) * 256 + x0 + 1] * ax * ay;
    return Math.max(-500, v);
  }
  G.elevation = (lon, lat, z) => { const n = Math.pow(2, z || 10); const x = Math.floor((lon + 180) / 360 * n); const la = lat * RAD; const y = Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n); const d = demFor(z || 10, x, y); return d ? demSample(d, lon, lat) : 0; };
  function globeTile(z, x, y) {
    const ex = G.terrEx || 0; const dem = ex > 0 ? demFor(z, x, y) : null;
    const key = 'g' + z + '/' + x + '/' + y + (dem ? '|' + dem.sig + '|' + ex : ''); let m = G.meshes.get(key); if (m) return m;
    const n = z < 3 ? 24 : z < 6 ? 16 : dem ? (z < 12 ? 24 : 16) : z < 10 ? 8 : 4; const n2 = Math.pow(2, z);
    const lc = (x + .5) / n2 * 360 - 180, yc = Math.PI * (1 - 2 * (y + .5) / n2); const cen = v3.fromLL(lc, Math.atan(Math.sinh(yc)) * DEG);
    let H = null, sh = null;
    if (dem) { // heights + hillshade on the vertex grid
      H = new Float32Array((n + 1) * (n + 1)); const LA = new Float32Array(n + 1);
      for (let j = 0; j <= n; j++) { LA[j] = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + j / n) / n2))) * DEG; for (let i = 0; i <= n; i++) H[j * (n + 1) + i] = demSample(dem, (x + i / n) / n2 * 360 - 180, LA[j]); }
      sh = new Float32Array((n + 1) * (n + 1)); const dxm = 360 / n2 / n * 111320 * Math.cos(lc * 0 + (LA[n >> 1]) * RAD);
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const dym = Math.abs((LA[Math.max(0, j - 1)] - LA[Math.min(n, j + 1)]) * 110540) || 1;
        const gx = (H[j * (n + 1) + Math.min(n, i + 1)] - H[j * (n + 1) + Math.max(0, i - 1)]) / (dxm * (Math.min(n, i + 1) - Math.max(0, i - 1)) || 1);
        const gy = (H[Math.max(0, j - 1) * (n + 1) + i] - H[Math.min(n, j + 1) * (n + 1) + i]) / dym;
        const nx = -gx * ex, ny = -gy * ex, nz = 1, l = Math.hypot(nx, ny, nz); const d = (nx * -.55 + ny * .55 + nz * .63) / l; sh[j * (n + 1) + i] = Math.max(.55, Math.min(1.25, d / .63));
      }
    }
    const k = ex / 6371000;
    if (!H) m = makeMesh(key, n, n, (fu, fv) => { const lo = (x + fu) / n2 * 360 - 180; const my = Math.PI * (1 - 2 * (y + fv) / n2); const la = Math.atan(Math.sinh(my)) * DEG; const p = v3.fromLL(lo, la); return [p[0] - cen[0], p[1] - cen[1], p[2] - cen[2], fu, fv, 1]; });
    else { // terrain mesh with a skirt ring (hides cracks between tiles of different detail)
      const skirt = 2 * Math.PI / n2 * .04;
      m = makeMesh(key, n + 2, n + 2, (a, b, I, J) => {
        const i = Math.max(0, Math.min(n, I - 1)), j = Math.max(0, Math.min(n, J - 1)); const edge = I === 0 || J === 0 || I === n + 2 || J === n + 2;
        const fu = i / n, fv = j / n; const lo = (x + fu) / n2 * 360 - 180; const my = Math.PI * (1 - 2 * (y + fv) / n2); const la = Math.atan(Math.sinh(my)) * DEG;
        const p = v3.mul(v3.fromLL(lo, la), 1 + H[j * (n + 1) + i] * k - (edge ? skirt : 0)); return [p[0] - cen[0], p[1] - cen[1], p[2] - cen[2], fu, fv, edge ? -100 : sh[j * (n + 1) + i]]; // skirt marked (overlays skip it)
      });
    }
    m.cen = cen; m.terr = !!dem; return m;
  }
  function globeBase() {
    let m = G.meshes.get('gbase'); if (m) return m;
    m = makeMesh('gbase', 128, 64, (fu, fv) => { const lo = fu * 360 - 180, la = 90 - fv * 180; const p = v3.fromLL(lo, la); return [p[0] * .9999, p[1] * .9999, p[2] * .9999, fu, fv]; });
    m.cen = [0, 0, 0]; m.keep = 1; return m;
  }
  // flat tile mesh: relative mercator coords (x rad, y merc) to tile origin (x0,y0 top-left)
  function flatTile(z, x, y) {
    const key = 'f' + z + '/' + x + '/' + y; let m = G.meshes.get(key); if (m) return m;
    const n2 = Math.pow(2, z); const w = 2 * Math.PI / n2;
    m = makeMesh(key, 1, 1, (fu, fv) => [fu * w, -fv * w, 0, fu, fv]);
    m.x0 = x * w - Math.PI; m.y0 = tileMy(y, z); return m;
  }
  function flatBase() {
    let m = G.meshes.get('fbase'); if (m) return m;
    const ymax = Cm.mercY(85.0511);
    m = makeMesh('fbase', 1, 64, (fu, fv) => { const my = ymax - fv * 2 * ymax; const la = Cm.mercLat(my); return [fu * 2 * Math.PI, my - ymax, 0, fu, (90 - la) / 180]; });
    m.x0 = -Math.PI; m.y0 = ymax; m.keep = 1; return m;
  }

  /* ---- tile selection ---- */
  G.selectTiles = (vw, prov, quality = 1, zBias = 0) => {
    const P = PR.P[prov]; if (!P) return [];
    const maxZ = P.max; const size = (P.size || 256); const out = [];
    if (vw.mode === 'flat') {
      let z = Math.round(vw.zoom + Math.log2(vw.H / Cm.REF_H) + Math.log2(256 / size) + Math.log2(quality) + zBias); z = Math.max(0, Math.min(maxZ, z)); const n2 = Math.pow(2, z), w = 2 * Math.PI / n2;
      const lon0 = vw.lon * RAD; const x0 = Math.floor((vw.mxRange[0] + lon0 + Math.PI) / w), x1 = Math.floor((vw.mxRange[1] + lon0 + Math.PI) / w);
      const yA = Math.max(0, Math.floor((Math.PI - vw.myRange[1]) / w)), yB = Math.min(n2 - 1, Math.floor((Math.PI - vw.myRange[0]) / w));
      if (x1 - x0 > 64 || yB - yA > 64) return out;
      for (let xi = x0; xi <= x1; xi++) for (let yi = yA; yi <= yB; yi++) { const xx = ((xi % n2) + n2) % n2; const copy = Math.floor(xi / n2); out.push({ z, x: xx, y: yi, copy, prio: z * 10 + Math.hypot(xi - (x0 + x1) / 2, yi - (yA + yB) / 2) * .1 }); }
      return out;
    }
    const target = 256 * 1.25 / quality * (size / 256) / Math.pow(2, zBias); // zBias > 0: finer tiles (sharper, more of them)
    const Cp = vw.C; const W = vw.W, H = vw.H;
    const zCap = Math.max(3, Math.round(vw.zoom + Math.log2(H / Cm.REF_H) + 3.5 + zBias)); // near-camera tiles in tilted views: never more than ~3.5 levels finer than the view (memory/time)
    const visit = (z, x, y) => {
      const n2 = Math.pow(2, z); const pts = []; let anyVis = false, anyFront = false;
      const g = z < 3 ? 4 : 2;
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (let j = 0; j <= g; j++) for (let i = 0; i <= g; i++) {
        const lo = (x + i / g) / n2 * 360 - 180, la = tileLat(y + j / g, z); const p = v3.fromLL(lo, la);
        const vis = v3.dot(p, Cp) >= 1; if (vis) anyVis = true;
        const s = vw.project(lo, la); pts.push(s);
        if (s) { anyFront = true; minx = Math.min(minx, s[0]); maxx = Math.max(maxx, s[0]); miny = Math.min(miny, s[1]); maxy = Math.max(maxy, s[1]); }
      }
      if (z >= 2) {
        if (!anyVis) { // tile entirely beyond horizon? test containment of the nadir / target
          const lo0 = tileLon(x, z), lo1 = tileLon(x + 1, z), la0 = tileLat(y + 1, z), la1 = tileLat(y, z);
          const inside = (ll) => ll[0] >= lo0 && ll[0] <= lo1 && ll[1] >= la0 && ll[1] <= la1;
          if (!inside([vw.lon, vw.lat]) && !inside(v3.toLL(Cp))) return;
        }
        if (anyFront && (maxx < -W * .1 || minx > W * 1.1 || maxy < -H * .1 || miny > H * 1.1) && pts.every(Boolean)) return;
      }
      // projected size along edges
      let sz = 0; for (let j = 0; j <= g; j++) for (let i = 0; i < g; i++) { const a = pts[j * (g + 1) + i], b = pts[j * (g + 1) + i + 1]; if (a && b) sz = Math.max(sz, Math.hypot(a[0] - b[0], a[1] - b[1]) * g); }
      for (let i = 0; i <= g; i++) for (let j = 0; j < g; j++) { const a = pts[j * (g + 1) + i], b = pts[(j + 1) * (g + 1) + i]; if (a && b) sz = Math.max(sz, Math.hypot(a[0] - b[0], a[1] - b[1]) * g); }
      const partial = !pts.every(Boolean);
      if (z < maxZ && z < zCap && (z < 2 || sz > target || (partial && z < 3)) && out.length < 400) { const z1 = z + 1; visit(z1, 2 * x, 2 * y); visit(z1, 2 * x + 1, 2 * y); visit(z1, 2 * x, 2 * y + 1); visit(z1, 2 * x + 1, 2 * y + 1); return; }
      const cx = (minx + maxx) / 2 - W / 2, cy = (miny + maxy) / 2 - H / 2;
      out.push({ z, x, y, prio: z * 10 + Math.hypot(cx / W, cy / H) * 5 });
    };
    visit(0, 0, 0);
    return out;
  };

  /* ---- render ---- */
  function ensureFbo(W, H) {
    const gl = G.gl;
    if (G.fb && G.fbW === W && G.fbH === H) return;
    if (G.fb) { gl.deleteFramebuffer(G.fb); gl.deleteTexture(G.fbTex); }
    G.fbTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, G.fbTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    G.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, G.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, G.fbTex, 0);
    if (G.fbDepth) gl.deleteRenderbuffer(G.fbDepth); G.fbDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, G.fbDepth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, G.fbDepth);
    G.fbW = W; G.fbH = H;
  }
  function canvasTex(slot, cv) {
    const gl = G.gl; let t = G.canvasTex[slot];
    if (!t) { t = G.canvasTex[slot] = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
    gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return t;
  }
  function drawQuad(tex, alpha) { const gl = G.gl, p = G.quad; gl.useProgram(p.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(p.u.u_tex, 0); gl.uniform1f(p.u.u_alpha, alpha == null ? 1 : alpha); gl.bindVertexArray(G.fullVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  // find a ready ancestor texture for a tile; returns {e, uvr}
  function tileTex(prov, z, x, y) {
    let zz = z, xx = x, yy = y, s = 1, ox = 0, oy = 0;
    while (zz >= 0) {
      const e = T.cache.get(prov + '/' + zz + '/' + xx + '/' + yy);
      if (e && e.st === 2) { e.used = T.frame; if (!e.tex) { e.tex = texImage(e.bmp, true, false); if (e.bmp.close) e.bmp.close(); e.bmp = null; } return { tex: e.tex, uvr: [ox, oy, s, s] }; }
      // move to parent
      const px = xx & 1, py = yy & 1; s *= .5; ox = ox * .5 + px * .5; oy = oy * .5 + py * .5; xx >>= 1; yy >>= 1; zz--;
      if (zz >= 0 && (z - zz <= 2 || zz <= 4)) T.want(prov, zz, xx, yy, zz < z - 2 ? zz * 10 - 50 : z * 10 + 8); // keep a close parent visible as fallback, but the wanted tiles load first (coarse z≤4 first only when nothing is there)
    }
    return null;
  }

  /* draw one layer of tiles (prov) with mode 0 normal / 1 multiply / 2 overlay */
  function drawTiles(vw, prov, sel, st, mode, alpha) {
    const gl = G.gl, p = G.surf;
    for (const t of sel) {
      const tt = tileTex(prov, t.z, t.x, t.y); if (!tt) continue;
      if (vw.mode === 'flat') {
        const m = flatTile(t.z, t.x, t.y); m.used = T.frame;
        const lon0 = vw.lon * RAD; let ox = m.x0 + t.copy * 2 * Math.PI - lon0; const oy = m.y0 - vw.y0;
        gl.uniform3f(p.u.u_off, ox, oy, 0);
        gl.uniform4f(p.u.u_uvr, tt.uvr[0], tt.uvr[1], tt.uvr[2], tt.uvr[3]);
        gl.bindTexture(gl.TEXTURE_2D, tt.tex); gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
      } else {
        const m = globeTile(t.z, t.x, t.y); m.used = T.frame;
        const off = v3.sub(m.cen, vw.C); gl.uniform3f(p.u.u_off, off[0], off[1], off[2]); gl.uniform3f(p.u.u_cen, m.cen[0], m.cen[1], m.cen[2]);
        gl.uniform1f(p.u.u_hc, v3.dot(m.cen, vw.C) - 1);
        gl.uniform4f(p.u.u_uvr, tt.uvr[0], tt.uvr[1], tt.uvr[2], tt.uvr[3]);
        gl.bindTexture(gl.TEXTURE_2D, tt.tex); gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
      }
    }
  }
  function setSurfUniforms(vw, st, mode, alpha) {
    const gl = G.gl, p = G.surf; gl.useProgram(p.p);
    gl.uniform1i(p.u.u_tex, 0); gl.uniform1i(p.u.u_night, 1); gl.uniform1i(p.u.u_mode, mode); gl.uniform1f(p.u.u_alpha, alpha);
    gl.uniform1f(p.u.u_shade, mode === 0 ? (G.terrEx > 0 ? (st.terrShade == null ? .45 : st.terrShade) : 0) : 0);
    gl.uniform1f(p.u.u_sat, st.sat == null ? 1 : st.sat); gl.uniform1f(p.u.u_bri, st.bri == null ? 1 : st.bri); gl.uniform1f(p.u.u_con, st.con == null ? 1 : st.con); gl.uniform1f(p.u.u_gamma, st.gamma || 1); gl.uniform1f(p.u.u_ge, st.ge || 0);
    { const gn = st.gain || [1, 1, 1]; if (p.u.u_gain) gl.uniform3f(p.u.u_gain, gn[0], gn[1], gn[2]); } { const lv = st.lvl || [0, 1, 0]; if (p.u.u_lvl) gl.uniform3f(p.u.u_lvl, lv[0], lv[1], lv[2]); } { const wg = st.wGain || [1, 1, 1]; if (p.u.u_wGain) { gl.uniform3f(p.u.u_wGain, wg[0], wg[1], wg[2]); gl.uniform1f(p.u.u_wAmt, st.wAmt || 0); } } const gW = st.geW || [.20, .33, .68], gT = st.geT || [.97, .96, 1.04]; gl.uniform3f(p.u.u_geW, gW[0], gW[1], gW[2]); gl.uniform3f(p.u.u_geT, gT[0], gT[1], gT[2]); gl.uniform1f(p.u.u_geS, st.geS == null ? .8 : st.geS); gl.uniform1f(p.u.u_geL, st.geL == null ? .86 : st.geL); gl.uniform1f(p.u.u_warm, st.warm || 0);
    const tint = st.tint || [1, 1, 1]; gl.uniform3f(p.u.u_tint, tint[0], tint[1], tint[2]); gl.uniform1f(p.u.u_tintAmt, st.tintAmt || 0);
    gl.uniform1f(p.u.u_light, st.light || 0); gl.uniform1f(p.u.u_nightAmt, st.nightAmt == null ? 1 : st.nightAmt);
    const sun = v3.fromLL(st.sunLon || 0, st.sunLat || 0); gl.uniform3f(p.u.u_sun, sun[0], sun[1], sun[2]);
    gl.uniform2f(p.u.u_res, vw.W, vw.H);
    if (vw.mode === 'flat') { gl.uniform1i(p.u.u_flat, 1); gl.uniform1f(p.u.u_k, vw.kpx); gl.uniform2f(p.u.u_sc, 2 * (vw.offX || 0) / vw.W, -2 * (vw.offY || 0) / vw.H); gl.uniform2f(p.u.u_cs, vw.ch, vw.sh); gl.uniform3f(p.u.u_cen, 0, 0, 0); }
    else {
      gl.uniform1i(p.u.u_flat, 0);
      // vp = projM * view
      const a = vw.projM, b = vw.view, m = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + i] * b[j * 4 + k]; m[j * 4 + i] = s; }
      gl.uniformMatrix4fv(p.u.u_vp, false, m); gl.uniform3f(p.u.u_cam, vw.C[0], vw.C[1], vw.C[2]);
    }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.baseTex('night') || G.white); gl.activeTexture(gl.TEXTURE0);
  }
  G.colorTex = (rgb) => { const k = rgb.map(v => Math.round(v * 255)).join(','); G._ct = G._ct || {}; if (!G._ct[k]) { const c = rgb.map(v => Math.round(v * 255)); G._ct[k] = texFrom(new Uint8Array([c[0], c[1], c[2], 255]), 1, 1); } return G._ct[k]; };
  function drawBase(vw, st, baseName, baseColor) {
    const tex = baseName ? G.baseTex(baseName) : baseColor ? G.colorTex(baseColor) : null; if (!tex) return false;
    const gl = G.gl, p = G.surf; setSurfUniforms(vw, st, 0, 1);
    gl.uniform4f(p.u.u_uvr, 0, 0, 1, 1); gl.bindTexture(gl.TEXTURE_2D, tex);
    if (vw.mode === 'flat') { const m = flatBase(); for (const copy of [-1, 0, 1]) { gl.uniform3f(p.u.u_off, m.x0 + copy * 2 * Math.PI - vw.lon * RAD, m.y0 - vw.y0, 0); gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0); } }
    else { const m = globeBase(); const off = v3.mul(vw.C, -1); gl.uniform3f(p.u.u_off, off[0], off[1], off[2]); gl.uniform3f(p.u.u_cen, 0, 0, 0); gl.uniform1f(p.u.u_hc, -1); gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0); }
    return true;
  }
  function sky(vw, st, pass, bgAlpha) {
    const gl = G.gl, p = G.sky; gl.useProgram(p.p);
    gl.uniform3fv(p.u.u_r, vw.r); gl.uniform3fv(p.u.u_u, vw.u); gl.uniform3fv(p.u.u_a, vw.a); gl.uniform3fv(p.u.u_C, vw.C);
    gl.uniform1f(p.u.u_f, vw.f); gl.uniform2f(p.u.u_res, vw.W, vw.H); gl.uniform2f(p.u.u_sc, vw.offX || 0, vw.offY || 0); gl.uniform1i(p.u.u_pass, pass);
    gl.uniform3fv(p.u.u_space, st.space || [0.01, 0.015, 0.03]); gl.uniform3fv(p.u.u_space2, st.space2 || st.space || [0.02, 0.03, 0.06]); gl.uniform3fv(p.u.u_atmo, st.atmoCol || [0.35, 0.6, 1]);
    gl.uniform1f(p.u.u_atmoAmt, st.atmo == null ? 1 : st.atmo); gl.uniform1f(p.u.u_stars, st.stars || 0); gl.uniform1f(p.u.u_bg, bgAlpha); gl.uniform1f(p.u.u_hs, .025);
    gl.bindVertexArray(G.fullVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* Main GL frame. L = { st (style look), base: provider id|null, baseTex: bundled equirect name|null, overlays:[{prov,mode,alpha}], cvBase, cvTop, bg:'full'|'alpha', post:{...} } */
  G.frame = (vw, L) => {
    G.init(); const gl = G.gl; const W = vw.W, H = vw.H; T.frame++;
    if (G.canvas.width !== W || G.canvas.height !== H) { G.canvas.width = W; G.canvas.height = H; }
    ensureFbo(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.fb); gl.viewport(0, 0, W, H); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    const st = L.st; const bgA = L.bg === 'alpha' ? 0 : 1;
    const bgc = st.bgFlat || [0, 0, 0];
    gl.clearColor(vw.mode === 'flat' ? bgc[0] * bgA : 0, vw.mode === 'flat' ? bgc[1] * bgA : 0, vw.mode === 'flat' ? bgc[2] * bgA : 0, vw.mode === 'flat' ? bgA : 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const want = [];
    if (vw.mode !== 'flat') sky(vw, st, 0, bgA);
    // surface
    if (L.surfaceColor && vw.mode !== 'flat') { /* vector styles draw their own ocean via canvas */ }
    G.terrEx = vw.mode === 'flat' ? 0 : (L.terrain || 0);
    if (G.terrEx > 0) { gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); }
    drawBase(vw, st, L.baseTex, L.baseColor);
    if (L.base) {
      const sel = G.selectTiles(vw, L.base, L.quality || 1, L.zBias || 0);
      for (const t of sel) want.push(T.want(L.base, t.z, t.x, t.y, t.prio));
      setSurfUniforms(vw, st, 0, 1); drawTiles(vw, L.base, sel, st, 0, 1);
      if (G.terrEx > 0) for (const t of sel) { if (t.z >= 5) { const e = T.cache.get('terrain/' + Math.min(t.z, TZMAX) + '/' + (t.x >> Math.max(0, t.z - TZMAX)) + '/' + (t.y >> Math.max(0, t.z - TZMAX))); if (e && e.st < 2) want.push(e); } }
    }
    gl.disable(gl.DEPTH_TEST);
    if (L.vec) { // vector map tiles (borders, fills, coasts…) draped like imagery
      const sel = G.selectTiles(vw, L.vec, (L.quality || 1), L.vecBias || 0);
      for (const t of sel) want.push(T.want(L.vec, t.z, t.x, t.y, t.prio - 1));
      setSurfUniforms(vw, st, 2, 1); drawTiles(vw, L.vec, sel, st, 2, 1);
    }
    if (L.cvBase) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); drawQuad(canvasTex('base', L.cvBase), 1); }
    for (const ov of L.overlays || []) {
      const sel = G.selectTiles(vw, ov.prov, L.quality || 1, ov.prov === 'hillshade' ? -.5 : 0);
      for (const t of sel) want.push(T.want(ov.prov, t.z, t.x, t.y, t.prio + 5));
      setSurfUniforms(vw, st, ov.mode, ov.alpha);
      if (ov.mode === 1) gl.blendFunc(gl.DST_COLOR, gl.ZERO); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drawTiles(vw, ov.prov, sel, st, ov.mode, ov.alpha);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    if (vw.mode !== 'flat') sky(vw, st, 1, bgA);
    if (L.cvTop) drawQuad(canvasTex('top', L.cvTop), 1);
    // post → canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const p = G.post, po = L.post || {}; gl.useProgram(p.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.fbTex); gl.uniform1i(p.u.u_tex, 0);
    gl.uniform2f(p.u.u_res, W, H); gl.uniform1f(p.u.u_vig, po.vig || 0); gl.uniform1f(p.u.u_grain, po.grain || 0); gl.uniform1f(p.u.u_paper, po.paper || 0); gl.uniform1f(p.u.u_sepia, po.sepia || 0);
    gl.uniform1f(p.u.u_seed, po.seed || 0); gl.uniform1f(p.u.u_letter, po.letter || 0); gl.uniform1f(p.u.u_con, po.con || 1); gl.uniform1f(p.u.u_sat, po.sat == null ? 1 : po.sat);
    gl.bindVertexArray(G.fullVao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    T.pump(); T.evict(gl);
    // mesh LRU
    if (G.meshes.size > 900) for (const [k, m] of G.meshes) { if (!m.keep && m.used < T.frame - 3) { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vb); G.meshes.delete(k); } }
    return { canvas: G.canvas, want };
  };
})();
