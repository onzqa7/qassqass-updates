'use strict';
/* أسلوب الكولاج — collage / cut-out / mixed-media effects for clips:
   «قصاصة» (cutout): sticker border by alpha dilation (outward for cut-outs, inset for opaque photos), torn-paper edge
     (procedural noise on the border), lifted-paper drop shadow, paper texture, halftone / photocopy looks, random tilt, pop entrance;
   «ستوب موشن» (stopmo): holds the layer at N fps (picture, motion and effects) with a small random offset / rotation / scale per hold;
   «طباعة نقطية» (halftone), «نسخة مصورة» (photocopy), «ملمس ورق» (papertex): single-pass looks.
   The shaders are compiled here and dropped into GW.R.progs, the multi-pass ones run through a wrapper around R.applyEffects,
   and the transform parts use the render.js hooks (RN.xfHooks / RN.holdHooks). */
(function () {
  const R = GW.R, RN = GW.Render; if (!R || !RN) return;
  const n = (k, name, def, min, max, step, unit) => ({ k, n: name, t: 'num', def, min, max, step: step || 1, unit: unit || '' });
  const col = (k, name, def) => ({ k, n: name, t: 'color', def });
  const bool = (k, name, def) => ({ k, n: name, t: 'bool', def: def ? 1 : 0 });
  const ang = (k, name, def) => ({ k, n: name, t: 'num', def, min: -3600, max: 3600, step: 1, unit: '°' });
  const CAT = 'كولاج وورق';
  Object.assign(GW.FX, {
    cutout: { n: 'قصاصة (كولاج)', cat: CAT, p: [n('bw', 'سماكة الحد', 10, 0, 80, .5), col('bcol', 'لون الحد', '#ffffff'), bool('inset', 'حد داخلي للصور المعتمة', 1),
      n('torn', 'حافة ممزقة', 35, 0, 100), n('tsc', 'حجم التمزق', 26, 4, 200), n('shOp', 'ظل الورقة', 45, 0, 100), n('shDist', 'ارتفاع الورقة', 10, 0, 120), n('shSoft', 'نعومة الظل', 14, 0, 120), ang('shDir', 'اتجاه الظل', 120),
      n('paper', 'ملمس الورق', 40, 0, 100), n('ht', 'طباعة نقطية (هافتون)', 0, 0, 100), n('hts', 'حجم النقاط', 6, 2, 40, .5), n('pc', 'نسخة مصورة (فوتوكوبي)', 0, 0, 100),
      n('tilt', 'ميل عشوائي', 3, 0, 25, .1, '°'), n('pop', 'دخول قفزة', 0, 0, 2, .05, ' ث'), n('boil', 'غليان الحافة (إطار/ث)', 0, 0, 24), n('seed', 'البذرة', 1, 1, 999)] },
    stopmo: { n: 'ستوب موشن (اهتزاز الإطارات)', cat: CAT, p: [n('fps', 'الإطارات في الثانية', 10, 1, 30), bool('hold', 'تثبيت الصورة بين الإطارات', 1), n('amount', 'إزاحة عشوائية', 4, 0, 60, .5),
      n('rot', 'دوران عشوائي', 1.2, 0, 20, .1, '°'), n('scale', 'تغير الحجم', 1, 0, 20, .1, '%'), n('seed', 'البذرة', 1, 1, 999)] },
    halftone: { n: 'طباعة نقطية (هافتون)', cat: CAT, p: [n('amount', 'القوة', 100, 0, 100), n('size', 'حجم النقاط', 7, 2, 60, .5), ang('angle', 'زاوية الشبكة', 45), col('ink', 'لون الحبر', '#1d1b19'), col('paper', 'لون الورق', '#f1ebdd'), n('color', 'الإبقاء على اللون', 30, 0, 100)] },
    photocopy: { n: 'نسخة مصورة (فوتوكوبي)', cat: CAT, p: [n('amount', 'القوة', 100, 0, 100), n('contrast', 'التباين', 60, 0, 100), n('noise', 'البقع والضجيج', 40, 0, 100), col('ink', 'لون الحبر', '#141414'), col('paper', 'لون الورق', '#efece4'), bool('anim', 'متحركة', 1)] },
    papertex: { n: 'ملمس ورق', cat: CAT, p: [n('amount', 'القوة', 50, 0, 100), n('scale', 'الحجم', 100, 20, 400, 1, '%'), col('tint', 'لون الورق', '#e9dcc0'), n('tintAmt', 'صبغة الورق', 25, 0, 100), n('fold', 'طيات وتجاعيد', 30, 0, 100), n('seed', 'البذرة', 1, 1, 999)] }
  });

  /* ---------------- shaders ---------------- */
  const VS = `#version 300 es
in vec2 a; out vec2 uv; void main(){ uv=a*.5+.5; gl_Position=vec4(a,0.,1.); }`;
  const HEAD = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t0; uniform vec2 res; uniform float time; uniform float px;
vec3 unp(vec4 c){ return c.a>0.0001? c.rgb/c.a : vec3(0.); }
vec4 pre(vec3 c,float a){ return vec4(clamp(c,0.,1.)*a,a); }
float luma(vec3 c){ return dot(c,vec3(.2126,.7152,.0722)); }
float h2(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+17.1; a*=.5; } return s/.9375; }
float paperTex(vec2 Q,float sd){ return .55*fbm(Q/7.+sd)+.25*vn(Q*vec2(.12,1.6)+sd*2.)+.2*vn(Q*vec2(1.4,.1)+sd*3.); }
`;
  const FS = {
    cc_cut: `uniform float bw,torn,tsc,seed,paper,ht,hts,pc,inset,boil; uniform vec3 bcol;
void main(){
  vec2 P=uv*res; vec2 Q=P/max(px,1e-3); vec4 c=texture(t0,uv); float sd=seed*1.37+boil*.731;
  float B=bw*px; float aa=max(.75,px*.8);
  float nl=fbm(Q/max(tsc,1.)+sd), nh=vn(Q/2.4+sd*3.1);
  float jag=torn*(1.7*(nl-.5)+.8*(nh-.5));
  float rr=max(B*.12,B*(1.-jag));
  float d=0.;
  if(c.a<.5 && B>.01){
    d=1e5; float Rm=B*(1.+torn*.9)+aa*2.; float NR=clamp(floor(Rm/1.6),3.,12.); float a0=h2(P+sd)*.314;
    for(int k=1;k<=12;k++){ if(float(k)>NR) break; float r=Rm*float(k)/NR;
      for(int j=0;j<20;j++){ float an=a0+float(j)*.31416; float a=texture(t0,uv+vec2(cos(an),sin(an))*r/res).a; if(a>.5) d=min(d,r-(a-.5)*Rm/NR); }
      if(d<1e4) break; }
  }
  float stk=c.a>=.5?1.:(B>.01?1.-smoothstep(rr-aa,rr+aa,d):0.);
  float e=min(min(P.x,P.y),min(res.x-P.x,res.y-P.y));
  float tornCut=inset>.5?torn*B*.5*(.9*nl+.5*nh):0.;
  float keep=inset>.5&&torn>0.?smoothstep(tornCut-aa,tornCut+aa,e):1.;
  float ri=inset>.5?max(0.,B*.8*(1.-jag*.6))+tornCut:0.;
  float inB=inset>.5&&B>.01?1.-smoothstep(ri-aa,ri+aa,e):0.;
  vec3 img=unp(c); float l=luma(img);
  if(pc>0.){ float nz=(h2(floor(Q*1.3)+sd)-.5)*.22+(vn(Q/38.+sd)-.5)*.3; float t=smoothstep(.36,.64,l+nz); vec3 ph=mix(vec3(.07,.07,.075),vec3(.95,.94,.9),t); img=mix(img,ph,pc); l=luma(img); }
  if(ht>0.){ float S=max(hts,1.); vec2 g=mat2(.7071,-.7071,.7071,.7071)*Q/S; vec2 f=fract(g)-.5; float rad=sqrt(clamp(1.-l,0.,1.))*.64; float ink=1.-smoothstep(rad-.07,rad+.07,length(f)); vec3 hc=mix(vec3(.97,.95,.9),img*.42,ink); img=mix(img,hc,ht); }
  float Sa=max(c.a,stk)*keep;
  float picA=c.a*(1.-inB)*keep;
  float fib=c.a<.5?smoothstep(rr-3.*px,rr,d):(inset>.5?1.-smoothstep(tornCut,tornCut+3.*px,e):0.);
  vec3 bc=bcol*(1.-.16*torn*fib);
  float tx=1.-paper*(.16*paperTex(Q,sd)-.03);
  vec3 colr=mix(bc*tx,img*mix(1.,tx,.55),Sa>1e-4?clamp(picA/Sa,0.,1.):0.);
  o=pre(colr,Sa);
}`,
    cc_ht: `uniform float amount,size,angle,color; uniform vec3 ink,paper;
void main(){ vec4 c=texture(t0,uv); vec3 img=unp(c); float l=luma(img); vec2 Q=uv*res/max(px,1e-3); float an=radians(angle); mat2 m=mat2(cos(an),-sin(an),sin(an),cos(an));
  vec2 f=fract(m*Q/max(size,1.))-.5; float rad=sqrt(clamp(1.-l,0.,1.))*.66; float k=1.-smoothstep(rad-.06,rad+.06,length(f));
  vec3 inkc=mix(ink,img*.5,color/100.); vec3 r=mix(mix(paper,img*.25+paper*.75,color/100.*.5),inkc,k); o=pre(mix(img,r,amount/100.),c.a); }`,
    cc_pc: `uniform float amount,contrast,noise,anim; uniform vec3 ink,paper;
void main(){ vec4 c=texture(t0,uv); vec3 img=unp(c); float l=luma(img); vec2 Q=uv*res/max(px,1e-3); float tt=anim>.5?floor(time*12.):0.;
  float nz=noise/100.*((h2(floor(Q*1.2)+tt)-.5)*.35+(vn(Q/30.+tt*.37)-.5)*.35); float w=mix(.35,.05,contrast/100.);
  float t=smoothstep(.5-w,.5+w,l+nz); float spk=step(.997-noise/100.*.012,h2(floor(Q*.7)+tt*1.7)); vec3 r=mix(ink,paper,t); r=mix(r,ink,spk*t);
  float streak=noise/100.*.12*vn(vec2(Q.x/3.,tt)); r*=1.-streak; o=pre(mix(img,r,amount/100.),c.a); }`,
    cc_paper: `uniform float amount,scale,tintAmt,fold,seed; uniform vec3 tint;
void main(){ vec4 c=texture(t0,uv); vec3 img=unp(c); vec2 Q=uv*res/max(px,1e-3)*100./max(scale,1.); float sd=seed*1.31;
  float p=paperTex(Q,sd); float cr=0.; for(int i=0;i<3;i++){ vec2 dir=normalize(vec2(h2(vec2(sd,float(i)))-.5,h2(vec2(float(i),sd))-.5)+1e-3); float s=dot(Q-res/max(px,1e-3)*.5,dir)/9.+fbm(Q/180.+float(i))*14.; cr+=exp(-abs(fract(s/24.)-.5)*30.)*(h2(vec2(floor(s/24.),float(i)+sd))>.6?1.:0.); }
  vec3 r=img*mix(vec3(1.),tint,tintAmt/100.)*(1.-amount/100.*(.2*p-.05))*(1.-fold/100.*.18*cr)+fold/100.*.05*cr; o=pre(r,c.a); }`
  };
  function ensure(name) {
    if (R.progs[name]) return; const gl = R.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('collage shader ' + name + ': ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, HEAD + FS[name])); gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('collage link ' + name + ': ' + gl.getProgramInfoLog(p));
    const u = {}; const cnt = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < cnt; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = { loc: gl.getUniformLocation(p, info.name), type: info.type }; }
    R.progs[name] = { p, u };
  }
  const C = GW.Collage = GW.Collage || {};
  C.ensureShaders = () => { for (const k in FS) ensure(k); };
  const one = (name) => (cur, pr, lt, pxs) => { ensure(name); const out = R.fbo(cur.w, cur.h); R.pass(name, out, [cur.tex], Object.assign({}, pr, { time: lt, px: pxs })); R.free(cur); return out; };
  const MINE = {
    stopmo: (cur) => cur, // transform + time hold only (hooks below)
    halftone: one('cc_ht'), photocopy: one('cc_pc'), papertex: one('cc_paper'),
    cutout: (cur, pr, lt, pxs) => {
      ensure('cc_cut'); const boil = pr.boil > 0 ? Math.floor(lt * pr.boil + 1e-6) : 0;
      let out = R.fbo(cur.w, cur.h);
      R.pass('cc_cut', out, [cur.tex], { bw: pr.bw, bcol: pr.bcol, inset: pr.inset ? 1 : 0, torn: pr.torn / 100, tsc: pr.tsc, seed: pr.seed, paper: pr.paper / 100, ht: pr.ht / 100, hts: pr.hts, pc: pr.pc / 100, boil, time: lt, px: pxs });
      R.free(cur);
      if (pr.shOp > 0) { // lifted paper: the stock drop-shadow passes (gl.js) on the sticker silhouette
        const sm = R.fbo(out.w, out.h); R.pass('shadowmk', sm, [out.tex], { color: '#000000', op: pr.shOp, dir: pr.shDir, dist: pr.shDist, px: pxs });
        const bl = R.blurTex(sm, Math.max(.5, pr.shSoft * pxs * .5), 'both', 0); if (bl !== sm) R.free(sm);
        const o2 = R.fbo(out.w, out.h); R.pass('under', o2, [out.tex, bl.tex]); R.free(bl); R.free(out); out = o2;
      }
      return out;
    }
  };
  C.MINE = MINE;
  const params = (fx, lt) => { const o = {}; for (const k in fx.params) o[k] = GW.pv(fx.params[k], lt); return o; };
  const orig = R.applyEffects;
  R.applyEffects = (layer, list, lt, pxs, key) => {
    if (!list.some(f => f.on && MINE[f.type])) return orig(layer, list, lt, pxs, key);
    let cur = layer, run = [];
    const flush = () => { if (run.length) { cur = orig(cur, run, lt, pxs, key); run = []; } };
    for (const f of list) { if (f.on && MINE[f.type]) { flush(); cur = MINE[f.type](cur, params(f, lt), lt, pxs, f); } else run.push(f); }
    flush(); return cur;
  };

  /* ---------------- transform hooks ---------------- */
  const hsh = (a, b, c) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
  const strSeed = (s) => { let h = 7; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) % 100003; return h; };
  const back = (t) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  C.stopKey = (fx, lt) => Math.floor(lt * Math.max(.1, GW.pv(fx.params.fps, lt)) + 1e-6);
  RN.xfHooks.push((c, lt, e) => {
    if (!c.fx || !c.fx.length) return e; let out = e;
    const add = (x, y, rot, zoom) => { out = Object.assign({ x: 0, y: 0, rot: 0, zoom: 1 }, out || {}); out.x += x; out.y += y; out.rot += rot; out.zoom *= zoom; };
    for (const f of c.fx) {
      if (!f.on) continue;
      if (f.type === 'stopmo') { const p = params(f, lt); const k = C.stopKey(f, lt); const r = (i) => hsh(k, p.seed, i) * 2 - 1; add(r(1) * p.amount, r(2) * p.amount, r(3) * p.rot, 1 + r(4) * p.scale / 100); }
      else if (f.type === 'cutout') { const p = params(f, lt); const tl = (hsh(strSeed(c.id), p.seed, 9) * 2 - 1) * p.tilt; const z = p.pop > 0 && lt < p.pop ? Math.max(.001, back(GW.clamp(lt / p.pop, 0, 1))) : 1; if (tl || z !== 1) add(0, 0, tl, z); }
    }
    return out;
  });
  RN.holdHooks.push((c, t) => {
    const f = c.fx.find(x => x.type === 'stopmo' && x.on); if (!f) return t; const lt = t - c.start;
    if (!GW.pv(f.params.hold, lt)) return t; const fps = Math.max(.1, GW.pv(f.params.fps, lt));
    return c.start + Math.floor(lt * fps + 1e-6) / fps;
  });

  /* ---------------- one-click looks on clips ---------------- */
  C.LOOKS = {
    sticker: { n: 'ملصق أبيض', fx: [['cutout', { bw: 12, torn: 0, paper: 25, shOp: 50, tilt: 2 }]] },
    torn: { n: 'ورق ممزق', fx: [['cutout', { bw: 9, torn: 70, tsc: 22, paper: 55, shOp: 45, tilt: 3 }]] },
    newsprint: { n: 'قصاصة صحيفة', fx: [['cutout', { bw: 6, torn: 55, paper: 60, ht: 70, hts: 5, shOp: 40, tilt: 2.5, bcol: '#efe8d8' }]] },
    xerox: { n: 'فوتوكوبي', fx: [['cutout', { bw: 8, torn: 40, paper: 50, pc: 85, shOp: 40, tilt: 2 }]] },
    stop: { n: 'ستوب موشن', fx: [['stopmo', { fps: 10, amount: 4, rot: 1.2 }]] },
    pop: { n: 'قصاصة بدخول قفزة + ستوب موشن', fx: [['cutout', { bw: 11, torn: 25, paper: 35, shOp: 50, tilt: 3, pop: .45 }], ['stopmo', { fps: 12, amount: 2.5, rot: .8, hold: 0 }]] }
  };
  // add (or update) a look's effects on clips; returns the effects touched
  C.applyLook = (clips, look, o = {}) => {
    const L = C.LOOKS[look]; if (!L) throw new Error('unknown look ' + look); const made = [];
    for (const c of clips) {
      if (!c || c.tt !== 'v' || !c.fx) continue;
      for (const [type, pr] of L.fx) {
        let f = c.fx.find(x => x.type === type); if (!f) { f = GW.newFx(type, 'v'); c.fx.push(f); }
        for (const k in pr) f.params[k] = GW.P(pr[k]); if (o.seed) f.params.seed = GW.P(o.seed); f.on = 1; made.push(f);
      }
    }
    if (o.commit !== false) { GW.commit('مظهر كولاج: ' + L.n); GW.invalidate(); if (GW.FXC && GW.FXC.render) try { GW.FXC.render(); } catch (e) {} }
    return made;
  };
})();
