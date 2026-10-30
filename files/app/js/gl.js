'use strict';
/* GPU compositor: sources → layer → effects → masks → placement → blend, plus transitions. */
(function () {
  const R = GW.R = { gl: null, canvas: null, progs: {}, pool: [], tex: new WeakMap(), half: false };
  const VS = `#version 300 es
in vec2 a; out vec2 uv; void main(){ uv=a*.5+.5; gl_Position=vec4(a,0.,1.); }`;
  // perspective placement for 3D layers: uM4 maps layer px straight to clip space (w = camera depth → perspective-correct uv)
  const VS_PLACE3 = `#version 300 es
in vec2 a; uniform mat4 uM4; uniform vec2 uL; out vec2 uv;
void main(){ vec2 lp=(a*.5+.5)*uL; lp.y=uL.y-lp.y; uv=vec2(lp.x/uL.x,1.-lp.y/uL.y); gl_Position=uM4*vec4(lp,0.,1.); }`;
  const VS_PLACE = `#version 300 es
in vec2 a; uniform mat3 uM; uniform vec2 uL; uniform vec2 uOut; out vec2 uv;
void main(){ vec2 lp=(a*.5+.5)*uL; lp.y=uL.y-lp.y; vec3 p=uM*vec3(lp,1.); uv=vec2(lp.x/uL.x,1.-lp.y/uL.y); gl_Position=vec4(p.x/uOut.x*2.-1.,1.-p.y/uOut.y*2.,0.,1.); }`;
  const HEAD = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t0; uniform vec2 res; uniform float time; uniform float px;
vec3 unp(vec4 c){ return c.a>0.0001? c.rgb/c.a : vec3(0.); }
vec4 pre(vec3 c,float a){ return vec4(clamp(c,0.,1.)*a,a); }
float luma(vec3 c){ return dot(c,vec3(.2126,.7152,.0722)); }
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(float x){ float i=floor(x),f=fract(x); float a=hash(vec2(i,1.3)),b=hash(vec2(i+1.,1.3)); return mix(a,b,f*f*(3.-2.*f))*2.-1.; }
`;
  const FS = {
    copy: `void main(){ o=texture(t0,uv); }`,
    present: `uniform vec3 bg; uniform float flip; uniform float straight; void main(){ vec2 u=uv; if(flip>.5) u.y=1.-u.y; vec4 c=texture(t0,u);
      if(straight>.5){ o=vec4(unp(c),c.a); } else { o=vec4(c.rgb+bg*(1.-c.a),1.); } }`,
    fill: `uniform vec4 col; void main(){ o=vec4(col.rgb*col.a,col.a); }`,
    mask: `uniform sampler2D t1; void main(){ vec4 c=texture(t0,uv); float m=texture(t1,uv).a; o=c*m; }`,
    place: `uniform float op; void main(){ o=texture(t0,uv)*op; }`,
    place3: `uniform float op; void main(){ o=texture(t0,uv)*op; }`,
    blend: `uniform sampler2D t1; uniform int mode; uniform float op;
      vec3 B(vec3 b, vec3 s){
        if(mode==1) return b*s; if(mode==2) return b+s-b*s; if(mode==3) return mix(2.*b*s,1.-2.*(1.-b)*(1.-s),step(.5,b));
        if(mode==4) return min(b,s); if(mode==5) return max(b,s); if(mode==6) return min(b+s,vec3(1.)); if(mode==7) return abs(b-s);
        if(mode==8) return mix(2.*b*s+b*b*(1.-2.*s), sqrt(b)*(2.*s-1.)+2.*b*(1.-s), step(.5,s));
        if(mode==9) return min(vec3(1.),b/max(1.-s,vec3(.001))); if(mode==10) return 1.-min(vec3(1.),(1.-b)/max(s,vec3(.001)));
        if(mode==11) return mix(2.*b*s,1.-2.*(1.-b)*(1.-s),step(.5,s));
        return s; }
      void main(){ vec4 s=texture(t0,uv)*op; vec4 d=texture(t1,uv);
        if(mode==0){ o=s+d*(1.-s.a); return; }
        vec3 cs=unp(s), cb=unp(d); vec3 r=(1.-d.a)*s.rgb+(1.-s.a)*d.rgb+s.a*d.a*B(cb,cs); o=vec4(r,s.a+d.a*(1.-s.a)); }`,
    /* ---- effects ---- */
    lumetri: `uniform float exposure,contrast,highlights,shadows,whites,blacks,temp,tint,sat,vib,fade; uniform vec3 shadowTint,highTint;
      /* curves (t1 = 256×7 R32F: master,R,G,B, hue→sat, hue→hue, luma→sat) and HSL secondary; both gated by uniforms so the untouched path is unchanged */
      uniform sampler2D t1; uniform float cvOn,cvInt,hslOn,hslShow,hslHue,hslHueW,hslSatLo,hslSatHi,hslLumLo,hslLumHi,hslSoft,hslDen,hslTemp,hslTint,hslCon,hslSat,hslExp;
      vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x); }
      vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }
      float cvS(float x,int row){ float p=clamp(x,0.,1.)*255.; int i=int(floor(p)); float f=p-floor(p); float a=texelFetch(t1,ivec2(i,row),0).r; float b=texelFetch(t1,ivec2(min(i+1,255),row),0).r; return mix(a,b,f); }
      vec3 curves(vec3 c){ c=clamp(c,0.,1.); vec3 m=vec3(cvS(c.r,0),cvS(c.g,0),cvS(c.b,0)); m=vec3(cvS(m.r,1),cvS(m.g,2),cvS(m.b,3)); vec3 h=rgb2hsv(m); float h0=h.x; h.y=clamp(h.y*cvS(h0,4)*2.,0.,1.); h.x=fract(h.x+cvS(h0,5)-.5); h.y=clamp(h.y*cvS(luma(m),6)*2.,0.,1.); return hsv2rgb(h); }
      float hslMask(vec3 c){ vec3 h=rgb2hsv(clamp(c,0.,1.)); float L=luma(c); float dh=abs(fract(h.x-hslHue/360.+.5)-.5)*360.; float sf=hslSoft/100.;
        float m=1.-smoothstep(hslHueW*.5,hslHueW*.5+sf*60.+.5,dh); m*=smoothstep(hslSatLo-sf*.25-.001,hslSatLo,h.y)*(1.-smoothstep(hslSatHi,hslSatHi+sf*.25+.001,h.y)); m*=smoothstep(hslLumLo-sf*.25-.001,hslLumLo,L)*(1.-smoothstep(hslLumHi,hslLumHi+sf*.25+.001,L)); return m; }
      void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s);
        float mk=0.; if(hslOn>.5){ mk=hslMask(c); if(hslDen>0.){ vec2 e=hslDen*px/res; mk=(mk+hslMask(unp(texture(t0,uv+vec2(e.x,0.))))+hslMask(unp(texture(t0,uv-vec2(e.x,0.))))+hslMask(unp(texture(t0,uv+vec2(0.,e.y))))+hslMask(unp(texture(t0,uv-vec2(0.,e.y)))))/5.; } }
        c*=exp2(exposure);
        float l=luma(c);
        c+=(whites/100.)*.25*smoothstep(.5,1.,l)+(blacks/100.)*.25*(1.-smoothstep(0.,.5,l));
        c+=(highlights/100.)*.35*smoothstep(.35,1.,l)*(1.-l*.3)+(shadows/100.)*.35*(1.-smoothstep(0.,.6,l));
        c=(c-.5)*(1.+contrast/100.)+.5;
        c*=vec3(1.+temp/250.,1.,1.-temp/250.); c*=vec3(1.+tint/400.,1.-tint/250.,1.+tint/400.);
        l=luma(c); float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b)); float vs=1.+(vib/100.)*(1.-(mx-mn));
        c=mix(vec3(l),c,(sat/100.)*vs);
        c+=(shadowTint-.5)*.4*(1.-smoothstep(0.,.55,l)); c+=(highTint-.5)*.4*smoothstep(.45,1.,l);
        c=mix(c,c*.85+.08,fade/100.);
        if(cvOn>.5) c=mix(c,curves(c),cvInt/100.);
        if(hslOn>.5){ if(hslShow>.5) c=vec3(mk); else { vec3 d=c*exp2(hslExp); d=(d-.5)*(1.+hslCon/100.)+.5; d*=vec3(1.+hslTemp/250.,1.,1.-hslTemp/250.); d*=vec3(1.+hslTint/400.,1.-hslTint/250.,1.+hslTint/400.); d=mix(vec3(luma(d)),d,hslSat/100.); c=mix(c,d,mk); } }
        o=pre(c,s.a); }`,
    bw: `uniform float amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); o=pre(mix(c,vec3(luma(c)),amount/100.),s.a); }`,
    sepia: `uniform float amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec3 sp=vec3(dot(c,vec3(.393,.769,.189)),dot(c,vec3(.349,.686,.168)),dot(c,vec3(.272,.534,.131))); o=pre(mix(c,sp,amount/100.),s.a); }`,
    hue: `uniform float hue,sat,light; vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x); }
      vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }
      void main(){ vec4 s=texture(t0,uv); vec3 h=rgb2hsv(unp(s)); h.x=fract(h.x+hue/360.); h.y=clamp(h.y*(1.+sat/100.),0.,1.); vec3 c=hsv2rgb(h); c=light>0.?mix(c,vec3(1.),light/100.):c*(1.+light/100.); o=pre(c,s.a); }`,
    levels: `uniform float inB,inW,gamma,outB,outW; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); c=clamp((c-inB/255.)/max((inW-inB)/255.,.001),0.,1.); c=pow(c,vec3(1./gamma)); c=mix(vec3(outB/255.),vec3(outW/255.),c); o=pre(c,s.a); }`,
    tint: `uniform vec3 black,white; uniform float amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); o=pre(mix(c,mix(black,white,luma(c)),amount/100.),s.a); }`,
    duotone: `uniform vec3 c1,c2; uniform float amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=smoothstep(.05,.95,luma(c)); o=pre(mix(c,mix(c1,c2,l),amount/100.),s.a); }`,
    invert: `uniform float amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); o=pre(mix(c,1.-c,amount/100.),s.a); }`,
    posterize: `uniform float levels; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); o=pre(floor(c*levels)/(levels-1.),s.a); }`,
    blur1d: `uniform vec2 dir; uniform float sigma; uniform float edges; void main(){ vec4 acc=vec4(0.); float wsum=0.;
      for(int i=-12;i<=12;i++){ float x=float(i); float w=exp(-x*x/(2.*sigma*sigma+1e-4)); vec2 u=uv+dir*x/res; if(edges>.5) u=clamp(u,.5/res,1.-.5/res); acc+=texture(t0,u)*w; wsum+=w; } o=acc/wsum; }`,
    dblur: `uniform float angle,len; void main(){ vec2 d=vec2(cos(radians(angle)),-sin(radians(angle)))*len*px/res; vec4 acc=vec4(0.); for(int i=0;i<32;i++){ float f=float(i)/31.-.5; acc+=texture(t0,uv+d*f); } o=acc/32.; }`,
    zblur: `uniform vec2 center; uniform float amount; void main(){ vec2 c=vec2(center.x,1.-center.y); vec4 acc=vec4(0.); for(int i=0;i<32;i++){ float f=1.-float(i)/31.*amount/100.*.6; acc+=texture(t0,c+(uv-c)*f); } o=acc/32.; }`,
    sharpen: `uniform float amount; void main(){ vec2 e=1./res; vec4 c=texture(t0,uv); vec4 n=texture(t0,uv+vec2(e.x,0.))+texture(t0,uv-vec2(e.x,0.))+texture(t0,uv+vec2(0.,e.y))+texture(t0,uv-vec2(0.,e.y)); vec4 r=c+(c*4.-n)*amount/100.; o=vec4(clamp(r.rgb,0.,r.a),c.a); }`,
    ckey: `uniform vec3 key; uniform float tol,soft,spill,choke; vec2 cbcr(vec3 c){ return vec2(-.1687*c.r-.3313*c.g+.5*c.b,.5*c.r-.4187*c.g-.0813*c.b); }
      void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float d=distance(cbcr(c),cbcr(key)); float t=tol/100.*.35; float sf=soft/100.*.25+.001;
        float a=smoothstep(t,t+sf,d); a=clamp((a-choke/100.)/(1.-choke/100.+.001),0.,1.);
        vec3 k=normalize(key+.001); float sp=spill/100.; int dom=(key.g>key.r&&key.g>key.b)?1:(key.b>key.r?2:0);
        if(dom==1) c.g=mix(c.g,min(c.g,(c.r+c.b)*.5),sp); else if(dom==2) c.b=mix(c.b,min(c.b,(c.r+c.g)*.5),sp); else c.r=mix(c.r,min(c.r,(c.g+c.b)*.5),sp);
        o=pre(c,s.a*a); }`,
    lkey: `uniform float thr,soft,inv; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float a=smoothstep(thr/100.,thr/100.+soft/100.+.001,luma(c)); if(inv>.5) a=1.-a; o=pre(c,s.a*a); }`,
    crop: `uniform float l,t,r,b,feather; void main(){ vec2 p=uv*res; float f=max(feather*px,.001); float x0=l/100.*res.x,x1=res.x*(1.-r/100.),y1=res.y*(1.-t/100.),y0=b/100.*res.y;
      float a=smoothstep(x0,x0+f,p.x)*(1.-smoothstep(x1-f,x1,p.x))*smoothstep(y0,y0+f,p.y)*(1.-smoothstep(y1-f,y1,p.y)); if(feather<.01) a=step(x0,p.x)*step(p.x,x1)*step(y0,p.y)*step(p.y,y1); o=texture(t0,uv)*a; }`,
    flip: `uniform float h,v; void main(){ vec2 u=uv; if(h>.5) u.x=1.-u.x; if(v>.5) u.y=1.-u.y; o=texture(t0,u); }`,
    mirror: `uniform float mode; void main(){ vec2 u=uv; if(mode<.5||mode>1.5) u.x=u.x>.5?1.-u.x:u.x; if(mode>.5) u.y=u.y<.5?1.-u.y:u.y; o=texture(t0,u); }`,
    wave: `uniform float amp,len,speed,dir; void main(){ vec2 p=uv*res; float a=radians(dir); vec2 d=vec2(cos(a),sin(a)); vec2 n=vec2(-d.y,d.x); float ph=dot(p,d)/(len*px)*6.2832+time*speed*6.2832; p+=n*sin(ph)*amp*px; o=texture(t0,p/res); }`,
    lens: `uniform float amount; void main(){ vec2 c=uv-.5; float r=length(c*vec2(res.x/res.y,1.)); float k=amount/100.; vec2 u=.5+c*(1.+k*r*r)/(1.+k*.25); o=(u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.):texture(t0,u); }`,
    pixelate: `uniform float size; void main(){ vec2 s=vec2(max(size*px,1.))/res; o=texture(t0,(floor(uv/s)+.5)*s); }`,
    bright: `uniform float thr; uniform vec3 color; uniform float colorMix; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=luma(c); float k=smoothstep(thr/100.,thr/100.+.15,l); c=mix(c,color*l,colorMix/100.); o=vec4(c*k*s.a,k*s.a); }`,
    addmix: `uniform sampler2D t1; uniform float k; void main(){ vec4 a=texture(t0,uv),b=texture(t1,uv); o=vec4(min(a.rgb+b.rgb*k,vec3(max(a.a,1.))),max(a.a,clamp(b.a*k,0.,1.))); o.rgb=min(o.rgb,vec3(o.a)); }`,
    vignette: `uniform float amount,size,round,feather; void main(){ vec4 s=texture(t0,uv); vec2 c=(uv-.5)*2.; c.x*=mix(1.,res.x/res.y,round/100.); float d=length(c)/(mix(.6,1.6,size/100.)); float v=smoothstep(1.-feather/100.,1.+feather/100.*.2,d);
      vec3 col=unp(s); col=amount>0.?col*(1.-v*amount/100.):mix(col,vec3(1.),v*-amount/100.); o=pre(col,s.a); }`,
    grain: `uniform float amount,size,anim; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec2 g=floor(uv*res/max(size*px,.5)); float n=hash(g+(anim>.5?floor(time*24.)*vec2(17.1,3.7):vec2(0.)))-.5; c+=n*amount/100.*.35*(1.-abs(luma(c)-.5)); o=pre(c,s.a); }`,
    glitch: `uniform float amount,block,split,speed; void main(){ float tt=floor(time*speed); vec2 b=floor(uv*res/(block*px)); float r=hash(b.yy*vec2(1.,0.)+tt); vec2 u=uv; float on=step(1.-amount/100.*.6,r);
      u.x+=on*(hash(vec2(b.y,tt))-.5)*.2*amount/100.; float sp=split*px/res.x*(on+.2);
      vec4 c=texture(t0,u); vec4 rr=texture(t0,u+vec2(sp,0.)), bb=texture(t0,u-vec2(sp,0.)); o=vec4(rr.r,c.g,bb.b,max(c.a,max(rr.a,bb.a))); o.rgb=min(o.rgb,vec3(o.a)); }`,
    rgbsplit: `uniform float amount,angle; void main(){ vec2 d=vec2(cos(radians(angle)),sin(radians(angle)))*amount*px/res; vec4 c=texture(t0,uv),r=texture(t0,uv+d),b=texture(t0,uv-d); o=vec4(r.r,c.g,b.b,max(c.a,max(r.a,b.a))); o.rgb=min(o.rgb,vec3(o.a)); }`,
    vhs: `uniform float amount,lines,wobble; void main(){ vec2 u=uv; float k=amount/100.; u.x+=noise(u.y*12.+time*3.)*.004*wobble/100.*3.+ (hash(vec2(floor(u.y*res.y/3.),floor(time*20.)))-.5)*.002*k;
      vec4 c=texture(t0,u); vec4 r=texture(t0,u+vec2(.003*k,0.)); vec4 b=texture(t0,u-vec2(.003*k,0.)); vec3 col=vec3(r.r,c.g,b.b); col=mix(col,unp(c),1.-k);
      float sl=.5+.5*sin(uv.y*res.y*3.14159/max(2.*px,1.)); col*=1.-lines/100.*.35*sl; col+= (hash(uv*res+time)-.5)*.08*k; o=pre(unp(vec4(col*c.a,c.a))*0.+col,c.a); }`,
    shadowmk: `uniform vec3 color; uniform float op,dir,dist; void main(){ vec2 d=vec2(cos(radians(dir)),-sin(radians(dir)))*dist*px/res; float a=texture(t0,uv+vec2(-d.x,-d.y)).a; o=vec4(color*a*op/100.,a*op/100.); }`,
    under: `uniform sampler2D t1; void main(){ vec4 s=texture(t0,uv),d=texture(t1,uv); o=s+d*(1.-s.a); }`,
    leak: `uniform float amount,speed,seed; uniform vec3 color; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float tt=time*speed*.2+seed*7.;
      vec2 p=vec2(.5+.6*sin(tt*1.3),.5+.5*cos(tt*.9)); float g=exp(-pow(distance(uv*vec2(res.x/res.y,1.),p*vec2(res.x/res.y,1.)),2.)*2.5);
      float g2=exp(-pow(distance(uv,vec2(.5+.5*cos(tt*.7+2.),.5+.4*sin(tt*1.1))),2.)*4.); vec3 l=color*(g*.9+g2*.5)*amount/100.; c=1.-(1.-c)*(1.-l); o=pre(c,s.a); }`,
    bars: `uniform float ratio; uniform vec3 color; void main(){ vec4 s=texture(t0,uv); float h=res.x/ratio/res.y; float b=(1.-h)*.5; if(b>0.&&(uv.y<b||uv.y>1.-b)) o=vec4(color,1.); else o=s; }`,
    scanlines: `uniform float amount,size; void main(){ vec4 s=texture(t0,uv); float l=step(.5,fract(uv.y*res.y/(size*px))); o=vec4(s.rgb*(1.-l*amount/100.*.6),s.a); }`,
    /* ---- v2 effects ---- */
    twirl: `uniform vec2 center; uniform float angle,radius; void main(){ vec2 asp=vec2(res.x/res.y,1.); vec2 d=(uv-center)*asp; float r=length(d); float R=radius/100.; float k=1.-smoothstep(0.,R,r); float a=radians(angle)*k*k; d=mat2(cos(a),-sin(a),sin(a),cos(a))*d; o=texture(t0,d/asp+center); }`,
    spherize: `uniform vec2 center; uniform float radius,amount; void main(){ vec2 asp=vec2(res.x/res.y,1.); vec2 d=(uv-center)*asp; float R=radius/100.; float r=length(d)/R; vec2 u=uv; if(r<1.){ float k=amount/100.; float nr=mix(r,r*r*(3.-2.*r)*.9+r*.1, k>0.?k:0.); if(k<0.) nr=mix(r,sqrt(r),-k); u=center+(r>0.?d/r*nr*R:d)/asp; } o=texture(t0,u); }`,
    turb: `uniform float amount,size,evol,speed; vec2 h2(vec2 p){ return vec2(hash(p),hash(p+19.19)); } float n2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=n2(p)*a; p*=2.03; a*=.5; } return s; }
      void main(){ vec2 p=uv*res/(size*px*2.+1.); float t=evol/60.+time*speed*.3; vec2 d=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t))-.5; o=texture(t0,uv+d*amount*px/res*2.); }`,
    ripple: `uniform vec2 center; uniform float amp,len,speed; void main(){ vec2 asp=vec2(res.x/res.y,1.); vec2 d=(uv-center)*asp; float r=length(d); float ph=r*res.y/(len*px)*6.2832-time*speed*6.2832; vec2 u=uv+ (r>0.?d/r:vec2(0.))/asp*sin(ph)*amp*px/res.y; o=texture(t0,u); }`,
    offsetfx: `uniform float ox,oy; void main(){ o=texture(t0,fract(uv-vec2(ox,-oy)/100.)); }`,
    polar: `uniform float amount; uniform float mode; void main(){ vec2 c=uv-.5; float r=length(c)*2.; float a=atan(c.y,c.x)/6.2832+.5; vec2 pol=mode<.5?vec2(a,1.-r):vec2(.5+uv.y*.5*cos(uv.x*6.2832), .5+uv.y*.5*sin(uv.x*6.2832)); vec2 u=mix(uv,pol,amount/100.); o=(u.x<0.||u.y<0.||u.x>1.||u.y>1.)?vec4(0.):texture(t0,u); }`,
    kaleido: `uniform float segs,angle; uniform vec2 center; void main(){ vec2 asp=vec2(res.x/res.y,1.); vec2 d=(uv-center)*asp; float r=length(d); float a=atan(d.y,d.x)-radians(angle); float s=6.2832/max(2.,segs); a=mod(a,s); a=abs(a-s*.5); vec2 p=vec2(cos(a),sin(a))*r; o=texture(t0,clamp(p/asp+center,0.,1.)); }`,
    mtile: `uniform float tx,ty,mirrorE; void main(){ vec2 p=uv*vec2(tx,ty); vec2 f=fract(p); if(mirrorE>.5){ vec2 i=floor(p); f=mix(f,1.-f,mod(i,2.)); } o=texture(t0,f); }`,
    magnify: `uniform vec2 center; uniform float size,mag; void main(){ vec2 asp=vec2(res.x/res.y,1.); vec2 d=(uv-center)*asp; float r=length(d); float R=size/100.; vec2 u=uv; if(r<R) u=center+d/asp/max(1.,mag/100.); vec4 c=texture(t0,u); float ring=smoothstep(R-.004,R,r)*(1.-smoothstep(R,R+.004,r)); o=mix(c,vec4(1.),ring*.8); }`,
    xform: `uniform float scale,rot,ox,oy,skew; void main(){ vec2 asp=vec2(res.x/res.y,1.); vec2 p=(uv-.5-vec2(ox,-oy)/100.)*asp; float a=radians(rot); p=mat2(cos(a),sin(a),-sin(a),cos(a))*p; p.x-=p.y*tan(radians(skew)); p/=max(.01,scale/100.); vec2 u=p/asp+.5; o=(u.x<0.||u.y<0.||u.x>1.||u.y>1.)?vec4(0.):texture(t0,u); }`,
    fractal: `uniform float scale,contrast,bright,evol,speed,blendm,amount; uniform vec3 c1,c2; float n2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
      void main(){ vec2 p=uv*res/(scale*px+1.); float t=evol/60.+time*speed*.25; float s=0.,a=.5; vec2 q=p; for(int i=0;i<6;i++){ s+=n2(q+t*(1.+float(i)*.3))*a; q=q*2.02+vec2(1.7,9.2); a*=.5; }
        s=clamp((s-.5)*contrast/100.+.5+bright/100.,0.,1.); vec3 n=mix(c1,c2,s); vec4 b=texture(t0,uv); vec3 c=unp(b); float k=amount/100.; vec3 r=blendm<.5?n:blendm<1.5?c*n*2.:blendm<2.5?1.-(1.-c)*(1.-n):c+n-.5; float al=blendm<.5?max(b.a,k):b.a; o=pre(mix(c,r,k),al); }`,
    ramp: `uniform vec2 a,b; uniform vec3 c1,c2; uniform float radial,amount; void main(){ vec2 asp=vec2(res.x/res.y,1.); float t; if(radial>.5) t=length((uv-a)*asp)/max(.001,length((b-a)*asp)); else { vec2 d=(b-a)*asp; t=dot((uv-a)*asp,d)/max(1e-6,dot(d,d)); } t=clamp(t,0.,1.); vec4 s=texture(t0,uv); vec3 c=unp(s); float k=amount/100.; o=pre(mix(c,mix(c1,c2,t),k),max(s.a,k)); }`,
    fourcol: `uniform vec3 c1,c2,c3,c4; uniform float amount; void main(){ vec3 g=mix(mix(c1,c2,uv.x),mix(c3,c4,uv.x),1.-uv.y); vec4 s=texture(t0,uv); vec3 c=unp(s); float k=amount/100.; o=pre(mix(c,g,k),max(s.a,k)); }`,
    flare: `uniform vec2 center; uniform float bright; uniform vec3 color; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec2 asp=vec2(res.x/res.y,1.); vec2 d=(uv-center)*asp; float r=length(d); float k=bright/100.;
      vec3 f=color*(exp(-r*9.)*1.2+exp(-r*40.)*1.5)+vec3(1.)*exp(-r*90.); float streak=exp(-abs(d.y)*90.)*exp(-abs(d.x)*1.6)*.9; f+=color*streak;
      vec2 axis=(vec2(.5)-center)*asp; for(int i=1;i<5;i++){ float fi=float(i); vec2 gp=center*asp+axis*fi*.55; float gr=length(uv*asp-gp); f+=mix(color,vec3(.4,.7,1.),fi/4.)*smoothstep(.06/fi+.02,.0,gr)*.18; }
      c=1.-(1.-c)*(1.-clamp(f*k,0.,1.)); o=pre(c,max(s.a,clamp(luma(f*k),0.,1.))); }`,
    rays: `uniform vec2 center; uniform float intensity,length_; uniform vec3 color; void main(){ vec4 acc=vec4(0.); vec2 d=(uv-center); for(int i=0;i<24;i++){ float f=float(i)/24.*length_/100.; vec4 s=texture(t0,uv-d*f); acc+=s*smoothstep(.45,1.,luma(unp(s))); } acc/=24.; vec4 s=texture(t0,uv); vec3 c=unp(s); c=1.-(1.-c)*(1.-acc.rgb*color*intensity/50.); o=pre(c,s.a); }`,
    lightning: `uniform vec2 a,b; uniform vec3 color; uniform float width,seed,speed; float n1(float x){ float i=floor(x),f=fract(x); return mix(hash(vec2(i,seed)),hash(vec2(i+1.,seed)),f*f*(3.-2.*f))-.5; }
      void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec2 asp=vec2(res.x/res.y,1.); vec2 A=a*asp,B=b*asp,P=uv*asp; vec2 ab=B-A; float t=clamp(dot(P-A,ab)/dot(ab,ab),0.,1.); vec2 n=normalize(vec2(-ab.y,ab.x)); float tt=floor(time*speed*12.);
        float off=(n1(t*8.+tt*3.1)*.6+n1(t*23.+tt*7.7)*.3+n1(t*57.+tt)*.15)*length(ab)*.18*sin(t*3.14159); float dd=abs(dot(P-(A+ab*t),n)-off); float w=width*px/res.y;
        float core=smoothstep(w,0.,dd), glow=exp(-dd/(w*6.))*.8; vec3 l=color*glow+vec3(core); c=1.-(1.-c)*(1.-clamp(l,0.,1.)); o=pre(c,max(s.a,clamp(core+glow*.5,0.,1.))); }`,
    gridfx: `uniform float size,width,amount; uniform vec3 color; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec2 p=uv*res/(size*px); vec2 f=abs(fract(p-.5)-.5)*size*px; float l=1.-smoothstep(0.,width*px,min(f.x,f.y)); c=mix(c,color,l*amount/100.); o=pre(c,max(s.a,l*amount/100.)); }`,
    checker: `uniform float size,amount; uniform vec3 c1,c2; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec2 p=floor(uv*res/(size*px)); vec3 k=mod(p.x+p.y,2.)<1.?c1:c2; o=pre(mix(c,k,amount/100.),max(s.a,amount/100.)); }`,
    circlefx: `uniform vec2 center; uniform float radius,feather,inv; uniform vec3 color; void main(){ vec4 s=texture(t0,uv); vec2 asp=vec2(res.x/res.y,1.); float r=length((uv-center)*asp); float m=1.-smoothstep(radius/100.-feather/200.,radius/100.+feather/200.+.0005,r); if(inv>.5) m=1.-m; o=vec4(color*m,m)+s*(1.-m); }`,
    brightcon: `uniform float bri,con; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); c=(c-.5)*(1.+con/100.)+.5+bri/100.; o=pre(c,s.a); }`,
    procamp: `uniform float bri,con,hue,sat; vec3 hr(vec3 c,float a){ const vec3 k=vec3(.57735); float ca=cos(a); return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.-ca); } void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); c=(c-.5)*(con/100.)+.5+bri/100.; c=hr(c,radians(hue)); c=mix(vec3(luma(c)),c,sat/100.); o=pre(c,s.a); }`,
    colorbal: `uniform float sr,sg,sb,mr,mg,mb,hr,hg,hb; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=luma(c); float ws=1.-smoothstep(0.,.5,l), wh=smoothstep(.5,1.,l), wm=1.-ws-wh; c+=(vec3(sr,sg,sb)*ws+vec3(mr,mg,mb)*wm+vec3(hr,hg,hb)*wh)/250.; o=pre(c,s.a); }`,
    chmix: `uniform float rr,rg,rb,gr,gg,gb,br,bg,bb; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); c=vec3(dot(c,vec3(rr,rg,rb)),dot(c,vec3(gr,gg,gb)),dot(c,vec3(br,bg,bb)))/100.; o=pre(c,s.a); }`,
    exposure: `uniform float expo,offs,gam; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); c=pow(max(c*exp2(expo)+offs/100.,0.),vec3(1./max(.05,gam))); o=pre(c,s.a); }`,
    vibrance: `uniform float vib,sat; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=luma(c); float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b)); float v=1.+vib/100.*(1.-(mx-mn)); c=mix(vec3(l),c,v*(1.+sat/100.)); o=pre(c,s.a); }`,
    photofilter: `uniform vec3 color; uniform float density,keep; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=luma(c); vec3 f=c*mix(vec3(1.),color*1.6,density/100.); if(keep>.5) f*=l/max(.001,luma(f)); o=pre(f,s.a); }`,
    tritone: `uniform vec3 hi,mid,sh; uniform float amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=luma(c); vec3 t=l<.5?mix(sh,mid,l*2.):mix(mid,hi,(l-.5)*2.); o=pre(mix(c,t,amount/100.),s.a); }`,
    colorpass: `uniform vec3 key; uniform float tol,amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float d=distance(normalize(c+.001),normalize(key+.001))+abs(luma(c)-luma(key))*.3; float k=smoothstep(tol/100.,tol/100.+.15,d); o=pre(mix(c,vec3(luma(c)),k*amount/100.),s.a); }`,
    replcol: `uniform vec3 from_,to_; uniform float tol,amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float d=distance(c,from_); float k=1.-smoothstep(tol/100.,tol/100.+.12,d); vec3 r=to_*(luma(c)/max(.001,luma(from_))); o=pre(mix(c,r,k*amount/100.),s.a); }`,
    gammafx: `uniform float gam; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); o=pre(pow(c,vec3(1./max(.05,gam))),s.a); }`,
    limiter: `uniform float lo,hi; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); o=pre(clamp(c,lo/100.,hi/100.),s.a); }`,
    shadhigh: `uniform float sh,hl; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=luma(c); c+=c*(sh/100.)*(1.-smoothstep(0.,.5,l))*1.2; c-=(1.-c)*(hl/100.)*smoothstep(.5,1.,l)*.8; o=pre(c,s.a); }`,
    threshold: `uniform float level; void main(){ vec4 s=texture(t0,uv); float l=step(level/255.,luma(unp(s))); o=pre(vec3(l),s.a); }`,
    findedges: `uniform float amount,inv; void main(){ vec2 e=1./res; float tl=luma(unp(texture(t0,uv+vec2(-e.x,e.y)))),t=luma(unp(texture(t0,uv+vec2(0.,e.y)))),tr=luma(unp(texture(t0,uv+e)));
      float l=luma(unp(texture(t0,uv-vec2(e.x,0.)))),r=luma(unp(texture(t0,uv+vec2(e.x,0.)))),bl=luma(unp(texture(t0,uv-e))),b=luma(unp(texture(t0,uv-vec2(0.,e.y)))),br=luma(unp(texture(t0,uv+vec2(e.x,-e.y))));
      float gx=-tl-2.*l-bl+tr+2.*r+br, gy=-tl-2.*t-tr+bl+2.*b+br; float g=clamp(length(vec2(gx,gy)),0.,1.); vec3 ed=inv>.5?vec3(1.-g):vec3(g); vec4 s=texture(t0,uv); o=pre(mix(unp(s),ed,amount/100.),s.a); }`,
    emboss: `uniform float angle,amount,colored; void main(){ vec2 d=vec2(cos(radians(angle)),sin(radians(angle)))*px/res*1.5; vec4 s=texture(t0,uv); vec3 c=unp(s); vec3 a=unp(texture(t0,uv-d)), b=unp(texture(t0,uv+d)); float e=luma(b-a)*amount/50.+.5; vec3 r=colored>.5?c+(e-.5):vec3(e); o=pre(r,s.a); }`,
    brush: `uniform float size; void main(){ vec2 e=size*px/res/4.; vec3 m[4]; vec3 s2[4]; for(int k=0;k<4;k++){ m[k]=vec3(0.); s2[k]=vec3(0.); }
      for(int j=-3;j<=3;j++) for(int i=-3;i<=3;i++){ vec3 c=unp(texture(t0,uv+vec2(i,j)*e)); int q=(i<=0?0:1)+(j<=0?0:2); m[q]+=c; s2[q]+=c*c; if(i==0&&j<=0){} }
      float best=1e9; vec3 res_=vec3(0.); for(int k=0;k<4;k++){ vec3 mm=m[k]/16.; vec3 v=abs(s2[k]/16.-mm*mm); float vv=v.r+v.g+v.b; if(vv<best){ best=vv; res_=mm; } } vec4 s=texture(t0,uv); o=pre(res_,s.a); }`,
    halftone: `uniform float size,angle,amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float a=radians(angle); mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a)); vec2 p=R*(uv*res)/(size*px); vec2 f=fract(p)-.5; float l=luma(c); float r=sqrt(1.-l)*.62; float dot_=1.-smoothstep(r-.06,r+.06,length(f)); o=pre(mix(c,vec3(1.-dot_)*mix(vec3(1.),c/max(.001,max(c.r,max(c.g,c.b))),.0),amount/100.),s.a); }`,
    toon: `uniform float levels,edge; void main(){ vec2 e=1./res; vec4 s=texture(t0,uv); vec3 c=unp(s); c=floor(c*levels+.5)/levels; float gx=luma(unp(texture(t0,uv+vec2(e.x,0.))))-luma(unp(texture(t0,uv-vec2(e.x,0.)))), gy=luma(unp(texture(t0,uv+vec2(0.,e.y))))-luma(unp(texture(t0,uv-vec2(0.,e.y)))); float g=smoothstep(.08,.25,length(vec2(gx,gy))*edge/50.); o=pre(c*(1.-g),s.a); }`,
    unmult: `void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s)*s.a; float m=max(c.r,max(c.g,c.b)); o=vec4(c,m); }`,
    replicate: `uniform float count; void main(){ o=texture(t0,fract(uv*max(1.,floor(count)))); }`,
    roughen: `uniform float amount,scale; float n2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); } void main(){ vec2 d=(vec2(n2(uv*res/(scale*px)),n2(uv*res/(scale*px)+7.))-.5)*amount*px/res; vec4 s=texture(t0,uv); float a=texture(t0,uv+d).a; o=s*(a/max(.0001,s.a)); o=min(o,vec4(1.)); }`,
    strobe: `uniform float freq,duty,mode; uniform vec3 color; void main(){ vec4 s=texture(t0,uv); float on=step(fract(time*freq),duty/100.); vec3 c=unp(s); c=mode<.5?mix(c,color,on):mix(c,1.-c,on); o=pre(c,s.a); }`,
    thermal: `uniform float amount; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=luma(c); vec3 t=l<.25?mix(vec3(0.,0.,.2),vec3(.4,0.,.6),l*4.):l<.5?mix(vec3(.4,0.,.6),vec3(.9,.1,.1),(l-.25)*4.):l<.75?mix(vec3(.9,.1,.1),vec3(1.,.8,0.),(l-.5)*4.):mix(vec3(1.,.8,0.),vec3(1.),(l-.75)*4.); o=pre(mix(c,t,amount/100.),s.a); }`,
    nightvis: `uniform float amount,grain_; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float l=luma(c)*1.6; vec3 g=vec3(.1,1.,.3)*l; g+=(hash(uv*res+time*61.)-.5)*grain_/100.*.4; float v=1.-smoothstep(.35,.75,length(uv-.5)); g*=v; o=pre(mix(c,g,amount/100.),s.a); }`,
    radialblur: `uniform vec2 center; uniform float angle; void main(){ vec4 acc=vec4(0.); vec2 asp=vec2(res.x/res.y,1.); vec2 d=(uv-center)*asp; for(int i=0;i<24;i++){ float a=radians(angle)*(float(i)/23.-.5); vec2 p=mat2(cos(a),-sin(a),sin(a),cos(a))*d; acc+=texture(t0,p/asp+center); } o=acc/24.; }`,
    lensblur: `uniform float radius; void main(){ vec4 acc=vec4(0.); float w=0.; for(int i=0;i<48;i++){ float fi=float(i); float r=sqrt((fi+.5)/48.); float a=fi*2.39996; vec2 off=vec2(cos(a),sin(a))*r*radius*px/res; vec4 s=texture(t0,uv+off); float b=1.+luma(unp(s))*luma(unp(s))*3.; acc+=s*b; w+=b; } o=acc/w; }`,
    unsharp: `uniform float amount,radius; void main(){ vec2 e=radius*px/res; vec4 s=texture(t0,uv); vec4 bl=(texture(t0,uv+vec2(e.x,0.))+texture(t0,uv-vec2(e.x,0.))+texture(t0,uv+vec2(0.,e.y))+texture(t0,uv-vec2(0.,e.y))+texture(t0,uv+e)+texture(t0,uv-e)+texture(t0,uv+vec2(e.x,-e.y))+texture(t0,uv+vec2(-e.x,e.y)))/8.; vec3 c=unp(s)+(unp(s)-unp(bl))*amount/50.; o=pre(c,s.a); }`,
    ultrakey: `uniform vec3 key; uniform float tol,soft,spill,choke; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec3 kk=normalize(key+.0001); float cd=distance(normalize(c+.0001),kk)+abs(luma(c)-luma(key))*.25; float a=smoothstep(tol/100.*.6,tol/100.*.6+soft/100.*.5+.001,cd); a=clamp((a-choke/100.)/(1.-choke/100.+.0001),0.,1.);
      float m=max(c.r,max(c.g,c.b)); int ch=key.g>=key.r&&key.g>=key.b?1:key.b>=key.r?2:0; if(ch==1) c.g=mix(c.g,min(c.g,max(c.r,c.b)),spill/100.); else if(ch==2) c.b=mix(c.b,min(c.b,max(c.r,c.g)),spill/100.); else c.r=mix(c.r,min(c.r,max(c.g,c.b)),spill/100.); o=pre(c,s.a*a); }`,
    alphaadj: `uniform float opacity,inv,ignore; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); float a=ignore>.5?1.:s.a; if(inv>.5) a=1.-a; a*=opacity/100.; o=pre(c,a); }`,
    chroma: `uniform float amount; void main(){ vec2 d=(uv-.5)*amount*px/res*2.; vec4 r=texture(t0,uv+d),g=texture(t0,uv),b=texture(t0,uv-d); o=vec4(r.r,g.g,b.b,max(g.a,max(r.a,b.a))); o.rgb=min(o.rgb,vec3(o.a)); }`,
    /* ---- .cube LUTs (Lumetri input / creative): straight colour in, trilinear 3D texture / per-channel 1D, re-premultiplied ---- */
    lut3: `uniform highp sampler3D t3; uniform float N,amt; uniform vec3 dmin,dmax; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec3 x=clamp((c-dmin)/(dmax-dmin),0.,1.); vec3 r=texture(t3,x*((N-1.)/N)+.5/N).rgb; o=pre(mix(c,r,amt),s.a); }`,
    lut1: `uniform sampler2D t1; uniform float N,amt; uniform vec3 dmin,dmax; void main(){ vec4 s=texture(t0,uv); vec3 c=unp(s); vec3 x=clamp((c-dmin)/(dmax-dmin),0.,1.)*((N-1.)/N)+.5/N; vec3 r=vec3(texture(t1,vec2(x.r,.5)).r,texture(t1,vec2(x.g,.5)).g,texture(t1,vec2(x.b,.5)).b); o=pre(mix(c,r,amt),s.a); }`,
    /* ---- transitions: t0 = A (outgoing), t1 = B (incoming) ---- */
    tr: `uniform sampler2D t1; uniform float p; uniform int kind;
      vec4 A(vec2 u){ return (u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.):texture(t0,u); } vec4 Bt(vec2 u){ return (u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.):texture(t1,u); }
      float ease(float x){ return x<.5?4.*x*x*x:1.-pow(-2.*x+2.,3.)/2.; }
      void main(){ float e=ease(p); vec2 u=uv;
        if(kind==0){ o=mix(A(u),Bt(u),p); return; }
        if(kind==1||kind==2){ vec4 m=kind==1?vec4(0.,0.,0.,1.):vec4(1.); o=p<.5?mix(A(u),m,p*2.):mix(m,Bt(u),(p-.5)*2.); return; }
        if(kind==3){ float lod=sin(p*3.14159)*5.; o=mix(textureLod(t0,u,lod),textureLod(t1,u,lod),smoothstep(.3,.7,p)); return; }
        if(kind==4){ vec4 c=mix(A(u),Bt(u),smoothstep(.45,.55,p)); float f=exp(-pow((p-.5)*7.,2.)); o=c+vec4(f)*(1.-c*0.); o=min(o,vec4(1.)); return; }
        if(kind>=5&&kind<=8){ vec2 d=kind==5?vec2(-1.,0.):kind==6?vec2(1.,0.):kind==7?vec2(0.,1.):vec2(0.,-1.); vec4 a=A(u-d*e), b=Bt(u-d*(e-1.)); o=b+a*(1.-b.a); return; }
        if(kind==9||kind==10){ vec2 d=kind==9?vec2(-1.,0.):vec2(1.,0.); vec4 b=Bt(u-d*(e-1.)); o=b+A(u)*(1.-b.a); return; }
        if(kind==11){ vec4 acc=vec4(0.); for(int i=0;i<16;i++){ float s=(float(i)/15.-.5)*.25*sin(p*3.14159); vec2 uu=u+vec2(s,0.); vec4 a=A(uu-vec2(-e,0.)), b=Bt(uu-vec2(-(e-1.),0.)); acc+=b+a*(1.-b.a); } o=acc/16.; return; }
        if(kind==12){ float ang=e*6.2832; float sc=1.+sin(p*3.14159)*1.5; vec2 c=(u-.5)*vec2(res.x/res.y,1.); c=mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*c*sc; vec2 uu=c/vec2(res.x/res.y,1.)+.5; o=p<.5?A(uu):Bt(uu); return; }
        if(kind==13){ vec2 ua=(u-.5)/(1.+e*1.5)+.5; vec2 ub=(u-.5)*(1.6-e*.6)+.5; o=mix(A(ua),Bt(ub),smoothstep(.2,.8,p)); return; }
        if(kind>=14&&kind<=17){ float x=kind==14?1.-u.x:kind==15?u.x:kind==16?u.y:1.-u.y; float m=smoothstep(e-.04,e+.04,x*(1.+.08)-.04); o=mix(Bt(u),A(u),m); return; }
        if(kind==18){ float r=length((u-.5)*vec2(res.x/res.y,1.)); float R=e*length(vec2(res.x/res.y,1.))*.55; float m=smoothstep(R-.02,R+.02,r); o=mix(Bt(u),A(u),m); return; }
        if(kind==19){ vec2 c=u-.5; float a=atan(c.x,c.y)/6.2832+.5; float m=smoothstep(e-.01,e+.01,a); o=mix(Bt(u),A(u),m); return; }
        if(kind==20){ float g=sin(p*3.14159); float row=floor(u.y*24.); float off=(hash(vec2(row,floor(p*20.)))-.5)*.25*g; vec2 uu=u+vec2(off,0.); vec4 a=A(uu),b=Bt(uu); vec4 c=mix(a,b,step(.5,p+(hash(vec2(row,3.))-.5)*.3*g)); o=vec4(mix(c.r,Bt(uu+vec2(.01*g,0.)).r,g*.5),c.g,c.b,c.a); return; }
        if(kind==21){ float s=max(1.,sin(p*3.14159)*48.); vec2 g=s/res; vec2 uu=(floor(u/g)+.5)*g; o=mix(A(uu),Bt(uu),step(.5,p)); return; }
        if(kind==22){ o=min(A(u)*(1.-max(0.,p*2.-1.))+Bt(u)*min(1.,p*2.),vec4(1.)); return; }
        if(kind==23){ vec4 a=A(u),b=Bt(u); vec3 la=pow(a.rgb,vec3(2.2)),lb=pow(b.rgb,vec3(2.2)); o=vec4(pow(mix(la,lb,p),vec3(1./2.2)),mix(a.a,b.a,p)); return; }
        if(kind==24){ vec2 d=abs(u-.5); float m=step(max(d.x,d.y),e*.5); o=mix(A(u),Bt(u),m); return; }
        if(kind==25){ vec2 d=abs(u-.5); float m=step(d.x+d.y,e); o=mix(A(u),Bt(u),m); return; }
        if(kind==26){ vec2 d=abs(u-.5); float m=step(min(d.x,d.y),e*.5); o=mix(A(u),Bt(u),m); return; }
        if(kind==27){ float m=step(abs(u.x-.5),e*.5); o=mix(A(u),Bt(u),m); return; }
        if(kind==28){ float m=step(abs(u.y-.5),e*.5); o=mix(A(u),Bt(u),m); return; }
        if(kind==29){ float m=step(fract(u.y*12.),e); o=mix(A(u),Bt(u),m); return; }
        if(kind==30){ vec2 c=floor(u*vec2(8.,6.)); float off=mod(c.x+c.y,2.)*.5; float m=step(fract(u.x*8.),clamp(e*2.-off,0.,1.)); o=mix(A(u),Bt(u),m); return; }
        if(kind==31){ float a=atan(u.y,u.x)/1.5708; float m=step(1.-a,e); o=mix(A(u),Bt(u),m); return; }
        if(kind==32){ float n=hash(floor(u*res/18.))*.6+u.x*.4; float m=smoothstep(n-.05,n+.05,e*1.1); o=mix(A(u),Bt(u),m); return; }
        if(kind==33){ float n=hash(floor(u*vec2(16.,9.))+3.1); float m=step(n,e); o=mix(A(u),Bt(u),m); return; }
        if(kind==34){ float z=u.x+abs(fract(u.y*10.)-.5)*.1; float m=step(z,e*1.1); o=mix(A(u),Bt(u),m); return; }
        if(kind==35){ vec2 c=u-.5; float a=fract(atan(c.y,c.x)/1.5708); float m=step(a,e); o=mix(A(u),Bt(u),m); return; }
        if(kind==36){ vec4 acc=vec4(0.); float st=sin(p*3.14159)*.35; for(int i=0;i<16;i++){ float f=float(i)/15.; vec2 uu=mix(u,vec2(.5),f*st); acc+=mix(A(uu),Bt(uu),smoothstep(.4,.6,p)); } o=acc/16.; return; }
        if(kind==37){ float ang=e*1.5708; if(u.x< 1.-e){ float x=u.x/(1.-e+1e-4); float sh=1.+sin(ang)*.15*(x); o=A(vec2(x,(u.y-.5)/sh+.5))*(1.-e*.5); } else { float x=(u.x-(1.-e))/(e+1e-4); float sh=1.+cos(ang)*.15*(1.-x); o=Bt(vec2(x,(u.y-.5)/sh+.5))*(.5+e*.5); } return; }
        if(kind==38){ float w=abs(cos(p*3.14159)); vec2 uu=vec2((u.x-.5)/max(w,.001)+.5,u.y); o=(abs(u.x-.5)>w*.5)?vec4(0.,0.,0.,1.):(p<.5?A(uu):Bt(uu)); return; }
        if(kind==39){ vec4 c=mix(A(u),Bt(u),smoothstep(.35,.65,p)); float f=sin(p*3.14159); float g=exp(-pow(distance(u,vec2(.2+.6*p,.4)),2.)*3.); vec3 l=vec3(1.,.55,.2)*g*f*1.6+vec3(1.,.9,.7)*f*.25; o=vec4(1.-(1.-c.rgb)*(1.-clamp(l,0.,1.)),max(c.a,f)); return; }
        if(kind==40){ float f=sin(p*3.14159); vec2 d=vec2(.03*f,0.); vec4 a=mix(A(u),Bt(u),smoothstep(.4,.6,p)); vec4 r=mix(A(u+d),Bt(u+d),smoothstep(.4,.6,p)), b=mix(A(u-d),Bt(u-d),smoothstep(.4,.6,p)); o=vec4(r.r,a.g,b.b,a.a)+vec4(.3,0.,.4,0.)*f*.5; return; }
        if(kind==41){ float f=sin(p*3.14159); float lod=f*6.; vec4 c=mix(textureLod(t0,u,lod),textureLod(t1,u,lod),smoothstep(.45,.55,p)); o=mix(c,vec4(1.),f*.85); return; }
        if(kind==42){ float l=dot(A(u).rgb,vec3(.299,.587,.114)); float m=smoothstep(l-.1,l+.1,e*1.2-.1); o=mix(A(u),Bt(u),m); return; }
        if(kind==43){ if(p<.5){ float k=1.+e*6.; o=A(vec2((u.x-.5)/k+.5,u.y)); } else { float k=1.+(1.-e)*6.; o=Bt(vec2((u.x-.5)/k+.5,u.y)); } return; }
        if(kind==44){ float h=u.y<.5?-1.:1.; vec4 a=A(u+vec2(0.,h*e*.5)); vec4 b=Bt(u); o=(abs(u.y-.5)<e*.5)?b:a; return; }
        if(kind==45){ float band=floor(u.y*6.); float dir=mod(band,2.)<1.?1.:-1.; vec4 b=Bt(u+vec2(dir*(1.-e),0.)); o=b+A(u)*(1.-b.a); return; }
        if(kind==46){ vec4 acc=vec4(0.); float st=sin(p*3.14159)*.5; for(int i=0;i<16;i++){ float f=float(i)/15.; vec2 uu=(u-.5)*(1.-f*st)+.5; acc+=p<.5?A((uu-.5)/(1.+e*2.)+.5):Bt((uu-.5)*(3.-e*2.)+.5); } o=acc/16.; return; }
        if(kind==47){ float x=u.x+u.y*.3; float m=step(x,e*1.35); float edge=exp(-pow((x-e*1.35)*25.,2.)); vec4 c=mix(A(u),Bt(u),m); o=vec4(min(c.rgb+vec3(.2,.6,1.)*edge*1.2,vec3(1.)),max(c.a,edge)); return; }
        if(kind==48){ vec2 d=vec2(e*.5,0.); vec4 a=u.x<.5?A(u+d):A(u-d); float m=step(abs(u.x-.5),e*.5); o=mix(a,Bt(u),m); return; }
        o=mix(A(u),Bt(u),p); }`
  };
  // RGBA (premultiplied, over black) → planar yuv420p BT.709 limited range, packed 4 bytes per RGBA8 texel:
  // rows [0,H) = Y, [H,1.25H) = U (two chroma rows per packed row), [1.25H,1.5H) = V. Output target is (W/4)×(1.5H).
  FS.yuvpack = `uniform vec2 sz;
    vec3 smp(vec2 p){ return clamp(texture(t0, vec2(p.x/sz.x, 1.-p.y/sz.y)).rgb, 0., 1.); }
    void main(){ float x=floor(gl_FragCoord.x), y=floor(gl_FragCoord.y); float W=sz.x, H=sz.y; vec4 r;
      if(y<H){ vec3 K=vec3(.2126,.7152,.0722); float yy=y+.5;
        r=vec4(dot(smp(vec2(4.*x+.5,yy)),K), dot(smp(vec2(4.*x+1.5,yy)),K), dot(smp(vec2(4.*x+2.5,yy)),K), dot(smp(vec2(4.*x+3.5,yy)),K))*(219./255.)+16./255.;
      } else { float k=y-H; float q=H*.25; bool isV=k>=q; if(isV) k-=q; float hw=W*.125; bool odd=x>=hw; float cr=2.*k+(odd?1.:0.); float cb=4.*(odd?x-hw:x);
        vec3 K=isV? vec3(.5,-.4542,-.0458) : vec3(-.1146,-.3854,.5); float yy=2.*cr+1.;
        r=vec4(dot(smp(vec2(2.*cb+1.,yy)),K), dot(smp(vec2(2.*cb+3.,yy)),K), dot(smp(vec2(2.*cb+5.,yy)),K), dot(smp(vec2(2.*cb+7.,yy)),K))*(224./255.)+128./255.;
      }
      o=r; }`;
  // planar yuv420p (BT.709 limited) → RGB, used by the export decoders
  FS.yuv2rgb = `uniform sampler2D t1; uniform sampler2D t2;
    void main(){ float Y=(texture(t0,uv).r-16./255.)*(255./219.); float U=(texture(t1,uv).r-128./255.)*(255./224.); float V=(texture(t2,uv).r-128./255.)*(255./224.);
      o=vec4(clamp(vec3(Y+1.5748*V, Y-.1873*U-.4681*V, Y+1.8556*U),0.,1.),1.); }`;
  const TR_KIND = { addDiss: 22, filmDiss: 23, irisBox: 24, irisDiamond: 25, irisCross: 26, barnH: 27, barnV: 28, blinds: 29, checkerW: 30, radialW: 31, gradW: 32, randBlocks: 33, zigzag: 34, pinwheel: 35, crossZoom: 36, cube: 37, flipOver: 38, lightLeakT: 39, chromaT: 40, blurColor: 41, lumaFade: 42, stretchT: 43, splitT: 44, bandSlide: 45, zoomBlurT: 46, neonSweep: 47, centerSplit: 48, dissolve: 0, dipBlack: 1, dipWhite: 2, blurx: 3, flash: 4, pushL: 5, pushR: 6, pushU: 7, pushD: 8, slideL: 9, slideR: 10, whip: 11, spin: 12, zoomIn: 13, wipeL: 14, wipeR: 15, wipeU: 16, wipeD: 17, iris: 18, clock: 19, glitchT: 20, pixelT: 21 };
  const BLEND = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, add: 6, difference: 7, softlight: 8, dodge: 9, burn: 10, hardlight: 11 };
  GW.BLENDS = [['normal', 'عادي'], ['multiply', 'ضرب'], ['screen', 'شاشة'], ['overlay', 'تراكب'], ['softlight', 'ضوء ناعم'], ['hardlight', 'ضوء ساطع'], ['darken', 'تغميق'], ['lighten', 'تفتيح'], ['add', 'إضافة'], ['difference', 'فرق'], ['dodge', 'تفتيح لوني'], ['burn', 'حرق لوني']];

  R.init = (canvas) => {
    const gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 غير مدعوم على هذا الجهاز');
    R.gl = gl; R.canvas = canvas;
    R.half = !!gl.getExtension('EXT_color_buffer_float') && !!gl.getExtension('EXT_color_buffer_half_float') || !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    R.quad = buf;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    for (const k in FS) prog(k);
    R.maskCanvas = document.createElement('canvas');
    R.maskCtx = R.maskCanvas.getContext('2d');
  };
  function sh(type, src) { const gl = R.gl, s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src.slice(0, 300)); return s; }
  function prog(name) {
    if (R.progs[name]) return R.progs[name];
    const gl = R.gl, p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, name === 'place' ? VS_PLACE : name === 'place3' ? VS_PLACE3 : VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, HEAD + FS[name]));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link ' + name + ': ' + gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = { loc: gl.getUniformLocation(p, info.name), type: info.type }; }
    return R.progs[name] = { p, u };
  }
  R.prog = prog;

  /* ---- framebuffers ---- */
  R.fbo = (w, h, mips) => {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const pool = R.pool, mm = !!mips;
    for (let i = pool.length - 1; i >= 0; i--) { const f = pool[i]; if (f.w === w && f.h === h && !!f.mips === mm) { pool[i] = pool[pool.length - 1]; pool.pop(); return f; } }
    const gl = R.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (R.half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h, mips };
  };
  R.free = (f) => { if (!f) return; R.pool.push(f); if (R.pool.length > 48) { const x = R.pool.shift(); R.gl.deleteFramebuffer(x.fb); R.gl.deleteTexture(x.tex); } };
  R.trimPool = () => { while (R.pool.length > 12) { const x = R.pool.shift(); R.gl.deleteFramebuffer(x.fb); R.gl.deleteTexture(x.tex); } };

  /* ---- draw helpers ---- */
  function bindTarget(f) { const gl = R.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fb : null); gl.viewport(0, 0, f ? f.w : R.canvas.width, f ? f.h : R.canvas.height); }
  function setU(pr, name, v) {
    const u = pr.u[name]; if (!u) return; const gl = R.gl;
    if (typeof v === 'number' || typeof v === 'boolean') { if (u.type === gl.INT || u.type === gl.SAMPLER_2D || u.type === gl.BOOL || u.type === gl.SAMPLER_3D) gl.uniform1i(u.loc, +v); else gl.uniform1f(u.loc, +v); }
    else if (typeof v === 'string' && v[0] === '#') gl.uniform3fv(u.loc, GW.hexf(v));
    else if (v.length === 2) gl.uniform2fv(u.loc, v); else if (v.length === 3) gl.uniform3fv(u.loc, v); else if (v.length === 4) gl.uniform4fv(u.loc, v); else if (v.length === 9) gl.uniformMatrix3fv(u.loc, false, v); else if (v.length === 16) gl.uniformMatrix4fv(u.loc, false, v);
  }
  const TN = ['t0', 't1', 't2', 't3'], RES2 = new Float32Array(2);
  R.pass = (name, target, textures, uniforms) => {
    const gl = R.gl, pr = prog(name);
    gl.useProgram(pr.p); bindTarget(target);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (textures) for (let i = 0; i < textures.length; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, textures[i]); setU(pr, TN[i] || 't' + i, i); }
    const w = target ? target.w : R.canvas.width, h = target ? target.h : R.canvas.height;
    RES2[0] = w; RES2[1] = h; setU(pr, 'res', RES2);
    for (const k in (uniforms || {})) setU(pr, k, uniforms[k]);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  R.clear = (f, r = 0, g = 0, b = 0, a = 0) => { const gl = R.gl; bindTarget(f); gl.clearColor(r, g, b, a); gl.clear(gl.COLOR_BUFFER_BIT); };

  /* ---- texture upload from DOM sources ---- */
  const srcTex = new Map(); // key -> {tex, w, h, ver}
  R.upload = (key, source, w, h, ver) => {
    const gl = R.gl; let e = srcTex.get(key);
    if (!e) { const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); e = { tex, ver: null, w: 0, h: 0 }; srcTex.set(key, e); }
    if (ver !== undefined && ver !== null && e.ver === ver) return e;
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); e.ver = ver; e.w = w; e.h = h; } catch (err) { console.warn('upload failed', key, err); }
    return e;
  };
  R.dropTex = (key) => { const e = srcTex.get(key); if (e) { R.gl.deleteTexture(e.tex); srcTex.delete(key); } const y = yuvTex.get(key); if (y) { for (const t of y.t) R.gl.deleteTexture(t); yuvTex.delete(key); } };
  // raw yuv420p frame → three R8 planes → converted straight into the target FBO (scaled by the sampler)
  const yuvTex = new Map();
  R.yuvLayer = (key, fr, target) => {
    const gl = R.gl; let e = yuvTex.get(key);
    if (!e) { e = { t: [0, 1, 2].map(() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }), w: 0, h: 0 }; yuvTex.set(key, e); }
    const w = fr.w, h = fr.h, cw = w >> 1, ch = h >> 1, d = fr.data; const u8 = d instanceof Uint8Array ? d : new Uint8Array(d.buffer || d, d.byteOffset || 0, d.byteLength);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const planes = [[0, w, h], [w * h, cw, ch], [w * h + cw * ch, cw, ch]];
    for (let i = 0; i < 3; i++) { const [o, pw, ph] = planes[i]; gl.bindTexture(gl.TEXTURE_2D, e.t[i]); const view = u8.subarray(o, o + pw * ph); if (e.w !== w || e.h !== h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, pw, ph, 0, gl.RED, gl.UNSIGNED_BYTE, view); else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, pw, ph, gl.RED, gl.UNSIGNED_BYTE, view); }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); e.w = w; e.h = h;
    R.pass('yuv2rgb', target, e.t);
    return target;
  };

  /* ---- effects on a layer (ping-pong) ---- */
  function blurTex(f, sigma, dims, edges) {
    // separable gaussian with downsampling for large radii
    if (sigma < .3) return f;
    let cur = f, owned = false, scale = 1;
    const dn = sigma > 5 ? Math.min(16, Math.pow(2, Math.floor(Math.log2(sigma / 3)))) : 1;
    if (dn > 1) { const s = R.fbo(f.w / dn, f.h / dn); R.pass('copy', s, [f.tex]); cur = s; owned = true; scale = dn; }
    const sg = sigma / scale;
    const passes = sg > 12 ? 2 : 1;
    for (let i = 0; i < passes; i++) {
      const sgi = sg / Math.sqrt(passes);
      if (dims !== 'v') { const t = R.fbo(cur.w, cur.h); R.pass('blur1d', t, [cur.tex], { dir: [1, 0], sigma: Math.min(sgi, 12) / 1, edges }); if (owned) R.free(cur); cur = t; owned = true; }
      if (dims !== 'h') { const t = R.fbo(cur.w, cur.h); R.pass('blur1d', t, [cur.tex], { dir: [0, 1], sigma: Math.min(sgi, 12), edges }); if (owned) R.free(cur); cur = t; owned = true; }
    }
    if (scale > 1) { const up = R.fbo(f.w, f.h); R.pass('copy', up, [cur.tex]); R.free(cur); cur = up; }
    return cur;
  }
  R.blurTex = blurTex;
  function fxParams(fx, lt) { const o = {}; for (const k in fx.params) o[k] = GW.pv(fx.params[k], lt); return o; }
  R.applyEffects = (layer, fxList, lt, pxs, clipKey) => {
    let cur = layer;
    for (const fx of fxList) {
      if (!fx.on || !GW.FX[fx.type]) continue;
      const pr = fxParams(fx, lt), t = fx.type;
      if (t === 'shake') continue; // handled in transform
      if (t === 'gblur') { const out = blurTex(cur, pr.amount * pxs * .5, pr.dims, pr.edges); if (out !== cur) { R.free(cur); cur = out; } continue; }
      if (t === 'glow') {
        const br = R.fbo(cur.w, cur.h); R.pass('bright', br, [cur.tex], { thr: pr.thr, color: pr.color, colorMix: pr.colorMix });
        const bl = blurTex(br, Math.max(.5, pr.radius * pxs * .5), 'both', 1); if (bl !== br) R.free(br);
        const out = R.fbo(cur.w, cur.h); R.pass('addmix', out, [cur.tex, bl.tex], { k: pr.int }); R.free(bl); R.free(cur); cur = out; continue;
      }
      if (t === 'shadow') {
        const sm = R.fbo(cur.w, cur.h); R.pass('shadowmk', sm, [cur.tex], { color: pr.color, op: pr.op, dir: pr.dir, dist: pr.dist, px: pxs });
        const bl = blurTex(sm, pr.soft * pxs * .5, 'both', 0); if (bl !== sm) R.free(sm);
        const out = R.fbo(cur.w, cur.h); R.pass('under', out, [cur.tex, bl.tex]); R.free(bl); R.free(cur); cur = out; continue;
      }
      const name = t === 'mirror' ? 'mirror' : t;
      const u = { ...pr, time: lt, px: pxs };
      for (const d of GW.FX[t].p) if (d.t === 'select' && t !== 'mirror') u[d.k] = Math.max(0, d.opts.findIndex(o => o[0] === pr[d.k]));
      if (t === 'mirror') u.mode = { h: 0, v: 1, q: 2 }[pr.mode] ?? 0;
      if (t === 'lumetri' && fx.lut) cur = R.lutPass(cur, fx.lut.in, pr.lutIn); // Input LUT before the basic correction
      const texs = [cur.tex];
      if (t === 'lumetri') { // curves + HSL secondary (color.js); explicit defaults so an older project without these params renders as before
        const CV = GW.Curves, cvT = CV && fx.curves && !CV.isIdentity(fx.curves) ? R.curvesTex(fx) : null;
        u.cvOn = cvT ? 1 : 0; u.cvInt = pr.cvInt == null ? 100 : pr.cvInt; if (cvT) texs.push(cvT);
        const H = fx.hsl; u.hslOn = H && H.on ? 1 : 0;
        if (u.hslOn) { u.hslShow = H.show ? 1 : 0; u.hslHue = H.hue; u.hslHueW = H.hueW; u.hslSatLo = H.sat[0] / 100; u.hslSatHi = H.sat[1] / 100; u.hslLumLo = H.lum[0] / 100; u.hslLumHi = H.lum[1] / 100; u.hslSoft = H.soft || 0; u.hslDen = H.denoise || 0; }
        else { u.hslShow = 0; u.hslHue = 0; u.hslHueW = 0; u.hslSatLo = 0; u.hslSatHi = 0; u.hslLumLo = 0; u.hslLumHi = 0; u.hslSoft = 0; u.hslDen = 0; }
        for (const [k, d] of [['hslTemp', 0], ['hslTint', 0], ['hslCon', 0], ['hslSat', 100], ['hslExp', 0]]) if (u[k] == null) u[k] = d;
      }
      const out = R.fbo(cur.w, cur.h); R.pass(name, out, texs, u); R.free(cur); cur = out;
      if (t === 'lumetri' && fx.lut) cur = R.lutPass(cur, fx.lut.cr, pr.lutCr); // Creative LUT after it
    }
    return cur;
  };
  // baked curves of a Lumetri effect → 256×7 R32F texture, cached per effect and re-uploaded only when the curve points change
  const cvTex = new Map();
  R.curvesTex = (fx) => {
    const gl = R.gl, key = JSON.stringify(fx.curves); let e = cvTex.get(fx.id);
    if (e && e.key === key) return e.tex;
    if (!e) { const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v); e = { tex, key: null }; cvTex.set(fx.id, e); if (cvTex.size > 64) { const k0 = cvTex.keys().next().value; gl.deleteTexture(cvTex.get(k0).tex); cvTex.delete(k0); } }
    const data = GW.Curves.bake(fx.curves);
    gl.bindTexture(gl.TEXTURE_2D, e.tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, 7, 0, gl.RED, gl.FLOAT, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    e.key = key; return e.tex;
  };
  // one LUT slot ({path}) at intensity amt (0–100, default 100) → new layer; unchanged (same object) when unset / not loaded yet
  R.lutPass = (cur, slot, amt) => {
    if (!slot || !slot.path || !GW.LUT) return cur;
    const k = GW.clamp(amt == null ? 1 : amt / 100, 0, 1); if (k <= 0) return cur;
    const L = GW.LUT.tex(slot.path); if (!L) return cur;
    const gl = R.gl, out = R.fbo(cur.w, cur.h), U = { N: L.N, amt: k, dmin: L.dmin, dmax: L.dmax };
    if (L.d3) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_3D, L.tex); U.t3 = 3; R.pass('lut3', out, [cur.tex], U); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_3D, null); gl.activeTexture(gl.TEXTURE0); }
    else R.pass('lut1', out, [cur.tex, L.tex], U);
    R.free(cur); return out;
  };

  /* ---- masks (rasterized with canvas 2D, blur = feather) ---- */
  R.maskTex = (masks, lt, lw, lh, ls, key) => {
    const c = R.maskCanvas, g = R.maskCtx;
    if (c.width !== lw || c.height !== lh) { c.width = lw; c.height = lh; }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, lw, lh); g.filter = 'none';
    let first = true;
    for (const m of masks) {
      if (m.on === 0) continue;
      const feather = GW.pv(m.feather, lt) * ls, op = GW.pv(m.opacity, lt) / 100, exp = GW.pv(m.expansion, lt) * ls;
      const shape = new Path2D();
      if (m.type === 'path') {
        const pts = GW.pv(m.pts, lt) || [];
        pts.forEach((p, i) => i ? shape.lineTo(p[0] * ls, p[1] * ls) : shape.moveTo(p[0] * ls, p[1] * ls)); shape.closePath();
      } else {
        const ctr = GW.pv(m.center, lt), sz = GW.pv(m.size, lt), rot = GW.pv(m.rot, lt) * Math.PI / 180;
        const cx = ctr[0] * ls, cy = ctr[1] * ls, w = sz[0] * ls / 2, h = sz[1] * ls / 2;
        if (m.type === 'ellipse') shape.ellipse(cx, cy, Math.abs(w), Math.abs(h), rot, 0, Math.PI * 2);
        else { const cs = Math.cos(rot), sn = Math.sin(rot); const P = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [cx + x * cs - y * sn, cy + x * sn + y * cs]); P.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath(); }
      }
      const tmp = R._mtmp || (R._mtmp = document.createElement('canvas')); if (tmp.width !== lw || tmp.height !== lh) { tmp.width = lw; tmp.height = lh; }
      const tg = tmp.getContext('2d'); tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, lw, lh);
      tg.filter = feather > .5 ? `blur(${feather / 2}px)` : 'none';
      tg.fillStyle = `rgba(255,255,255,${op})`; tg.fill(shape);
      if (exp > 0) { tg.lineJoin = 'round'; tg.lineWidth = exp * 2; tg.strokeStyle = `rgba(255,255,255,${op})`; tg.stroke(shape); }
      if (exp < 0) { tg.globalCompositeOperation = 'destination-out'; tg.lineJoin = 'round'; tg.lineWidth = -exp * 2; tg.strokeStyle = '#fff'; tg.stroke(shape); tg.globalCompositeOperation = 'source-over'; }
      if (m.inv) { tg.globalCompositeOperation = 'xor'; tg.filter = 'none'; tg.fillStyle = `rgba(255,255,255,${op})`; tg.fillRect(0, 0, lw, lh); tg.globalCompositeOperation = 'source-over'; }
      const mode = first ? 'source-over' : ({ add: 'source-over', sub: 'destination-out', inter: 'destination-in' }[m.mode || 'add']);
      g.globalCompositeOperation = mode; g.drawImage(tmp, 0, 0); g.globalCompositeOperation = 'source-over';
      first = false;
    }
    return R.upload('mask:' + key, c, lw, lh, null).tex;
  };

  /* ---- transform matrix: layer px → output px ---- */
  R.placeMatrix = (c, lt, ls, r, extra) => {
    const m = c.motion; const pos = GW.pv(m.pos, lt), an = GW.pv(m.anchor, lt);
    const s = GW.pv(m.scale, lt) / 100, sw = m.uni ? s : GW.pv(m.scaleW, lt) / 100;
    let rot = GW.pv(m.rot, lt) * Math.PI / 180;
    let ox = 0, oy = 0, zs = 1;
    if (extra) { ox = extra.x || 0; oy = extra.y || 0; rot += (extra.rot || 0) * Math.PI / 180; zs = extra.zoom || 1; }
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const a = sw * zs / ls, d = s * zs / ls;
    // p = r * (pos + off + R * (S * (lp/ls) - S*anchor))
    const m00 = r * cs * a, m01 = -r * sn * d, m10 = r * sn * a, m11 = r * cs * d;
    const tx = r * (pos[0] + ox - (cs * sw * zs * an[0] - sn * s * zs * an[1]));
    const ty = r * (pos[1] + oy - (sn * sw * zs * an[0] + cs * s * zs * an[1]));
    return [m00, m10, 0, m01, m11, 0, tx, ty, 1]; // column-major mat3
  };
  R.placeLayer = (layer, M, outW, outH, op) => {
    const gl = R.gl, pr = prog('place'), out = R.fbo(outW, outH);
    R.clear(out);
    gl.useProgram(pr.p); bindTarget(out);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, layer.tex);
    setU(pr, 't0', 0); setU(pr, 'uM', M); setU(pr, 'uL', [layer.w, layer.h]); setU(pr, 'uOut', [outW, outH]); setU(pr, 'op', op);
    gl.disable(gl.BLEND); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return out;
  };
  R.placeLayer3 = (layer, M4, outW, outH, op) => {
    const gl = R.gl, pr = prog('place3'), out = R.fbo(outW, outH);
    R.clear(out);
    gl.useProgram(pr.p); bindTarget(out);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, layer.tex);
    setU(pr, 't0', 0); setU(pr, 'uM4', M4); setU(pr, 'uL', [layer.w, layer.h]); setU(pr, 'op', op);
    gl.disable(gl.BLEND); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return out;
  };
  R.blend = (src, dst, mode, op) => { const out = R.fbo(dst.w, dst.h); R.pass('blend', out, [src.tex, dst.tex], { mode: BLEND[mode] || 0, op: op ?? 1 }); return out; };
  R.transition = (a, b, kind, p) => {
    const out = R.fbo(a.w, a.h); const k = TR_KIND[kind] ?? 0;
    if (k === 3) { for (const f of [a, b]) { R.gl.bindTexture(R.gl.TEXTURE_2D, f.tex); R.gl.texParameteri(R.gl.TEXTURE_2D, R.gl.TEXTURE_MIN_FILTER, R.gl.LINEAR_MIPMAP_LINEAR); R.gl.generateMipmap(R.gl.TEXTURE_2D); } }
    R.pass('tr', out, [a.tex, b.tex], { p, kind: k });
    if (k === 3) for (const f of [a, b]) { R.gl.bindTexture(R.gl.TEXTURE_2D, f.tex); R.gl.texParameteri(R.gl.TEXTURE_2D, R.gl.TEXTURE_MIN_FILTER, R.gl.LINEAR); }
    return out;
  };
  R.present = (f, bg, straight, toFbo) => {
    if (toFbo) { R.pass('present', toFbo, [f.tex], { bg: bg || [0, 0, 0], flip: 1, straight: straight ? 1 : 0 }); return; }
    const gl = R.gl; R.pass('present', null, [f.tex], { bg: bg || [0, 0, 0], flip: 0, straight: 0 });
  };
  // GPU-side RGBA→yuv420p: 1.5 bytes/pixel instead of 4 (2.7× less readback, IPC and pipe traffic, no swscale in FFmpeg)
  R.canYUV = (w, h) => w % 8 === 0 && h % 4 === 0;
  function packTarget(w, h) {
    const gl = R.gl; let t = R._yt; const pw = w / 4, ph = h * 1.5;
    if (t && t.w === pw && t.h === ph) return t;
    if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pw, ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return R._yt = { fb, tex, w: pw, h: ph };
  }
  const SZ2 = new Float32Array(2);
  R.readYUV420 = (w, h, f, buf) => {
    const gl = R.gl; const t = packTarget(w, h); const out = buf || new Uint8Array(w * h * 3 / 2);
    SZ2[0] = w; SZ2[1] = h; R.pass('yuvpack', t, [f.tex], { sz: SZ2 });
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  };
  // Asynchronous double-buffered readback through PIXEL_PACK buffers + fences: the GPU copy of frame N
  // overlaps with seeking/compositing frame N+1. mode: 'yuv' | 'rgba' | 'rgba-straight'
  R.readback = (w, h, mode) => {
    const gl = R.gl; const yuv = mode === 'yuv'; const bytes = yuv ? w * h * 3 / 2 : w * h * 4;
    const slots = [0, 1].map(() => { const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ); return { b, sync: null }; });
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    let k = 0;
    const api = {
      bytes,
      // render target → PBO (non-blocking); returns a slot to collect later
      kick(f) {
        const s = slots[k]; k ^= 1;
        let fb, rw, rh;
        if (yuv) { const t = packTarget(w, h); SZ2[0] = w; SZ2[1] = h; R.pass('yuvpack', t, [f.tex], { sz: SZ2 }); fb = t.fb; rw = t.w; rh = t.h; }
        else { const rb = rgbaTarget(w, h); R.present(f, [0, 0, 0], mode === 'rgba-straight', rb); fb = rb.fb; rw = w; rh = h; }
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.b);
        gl.readPixels(0, 0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        if (s.sync) gl.deleteSync(s.sync);
        s.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
        return s;
      },
      // wait (without blocking the thread) for the fence, then copy the pixels into dst
      async collect(s, dst) {
        for (let n = 0; s.sync; n++) { const st = gl.clientWaitSync(s.sync, 0, 0); if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED) break; await new Promise(r => n < 4 ? queueMicrotask(r) : setTimeout(r, 0)); if (n > 2000) break; }
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.b); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, dst, 0, bytes); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        return dst;
      },
      dispose() { for (const s of slots) { if (s.sync) gl.deleteSync(s.sync); gl.deleteBuffer(s.b); } }
    };
    return api;
  };
  function rgbaTarget(w, h) {
    const gl = R.gl; let rb = R._rb;
    if (!rb || rb.w !== w || rb.h !== h) { if (rb) { gl.deleteFramebuffer(rb.fb); gl.deleteTexture(rb.tex); } const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); rb = R._rb = { fb, tex, w, h }; }
    return rb;
  }
  R.readRGBA = (w, h, f, buf, straight) => {
    const gl = R.gl; const out = buf || new Uint8Array(w * h * 4);
    let rb = R._rb; if (!rb || rb.w !== w || rb.h !== h) { if (rb) { gl.deleteFramebuffer(rb.fb); gl.deleteTexture(rb.tex); } const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); rb = R._rb = { fb, tex, w, h }; }
    R.present(f, [0, 0, 0], straight !== false, rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rb.fb); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  };
})();
