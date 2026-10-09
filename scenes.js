/* West Coast scenes — procedural WebGL2 renders for the hero, the day sequence and the settings playground. */
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener("pointermove", (e) => { mouse.tx = e.clientX / innerWidth * 2 - 1; mouse.ty = -(e.clientY / innerHeight * 2 - 1); }, { passive: true });

  /* ---------- tiny GL kit ---------- */
  function makeGL(canvas, opts = {}) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, ...opts });
    if (!gl) return null;
    const tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
    return { gl, fsVAO: vao };
  }
  function program(gl, vs, fs) {
    const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(x)); throw new Error("shader"); } return x; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); throw new Error("link"); }
    const u = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) });
    return { p, u };
  }
  // Keep each canvas inside a pixel budget so phones stay smooth; adapt if frames run long.
  function sizer(canvas, budget, maxDpr) {
    const st = { scale: 1, slow: 0, fast: 0 };
    st.fit = () => {
      const r = canvas.getBoundingClientRect(), css = Math.max(1, r.width * r.height);
      const dpr = Math.min(devicePixelRatio || 1, maxDpr);
      const s = Math.min(dpr, Math.sqrt(budget / css)) * st.scale;
      const w = Math.max(2, Math.round(r.width * s)), h = Math.max(2, Math.round(r.height * s));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return { w, h, s, cssW: r.width, cssH: r.height };
    };
    st.tick = (dt) => {
      if (dt > .034) { st.slow++; st.fast = 0; } else if (dt < .018) { st.fast++; st.slow = 0; }
      if (st.slow > 20 && st.scale > .45) { st.scale *= .85; st.slow = 0; }
      if (st.fast > 120 && st.scale < 1) { st.scale = Math.min(1, st.scale * 1.08); st.fast = 0; }
    };
    return st;
  }
  function loopWhileVisible(el, frame) {
    let vis = false, running = false, last = 0;
    const run = (now) => {
      const dt = Math.min(.05, (now - last) / 1000 || .016); last = now;
      frame(now / 1000, dt);
      if (vis) requestAnimationFrame(run); else running = false;
    };
    new IntersectionObserver((e) => { vis = e[0].isIntersecting; if (vis && !running) { running = true; last = performance.now(); requestAnimationFrame(run); } }, { rootMargin: "150px" }).observe(el);
  }

  const VS_FULL = `#version 300 es
  layout(location=0) in vec2 aP; void main(){ gl_Position = vec4(aP, 0., 1.); }`;

  const COMMON = `#version 300 es
  precision highp float;
  uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse;
  out vec4 o;
  float h11(float p){ p = fract(p*.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
  float n1(float x){ float i = floor(x), f = fract(x); float u = f*f*(3. - 2.*f); return mix(h11(i), h11(i + 1.), u); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), u.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float a = .5, s = 0.; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++){ s += a*n2(p); p = m*p; a *= .5; } return s; }
  float fbm3(vec2 p){ float a = .5, s = 0.; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 3; i++){ s += a*n2(p); p = m*p; a *= .5; } return s; }
  float ridge(float x){ float s = 0., a = .62, f = 1.; for (int i = 0; i < 6; i++){ float n = n1(x*f + float(i)*17.3); s += a*pow(1. - abs(n*2. - 1.), 1.6); f *= 2.07; a *= .46; } return s; }
  vec3 aces(vec3 x){ return clamp((x*(2.51*x + .03))/(x*(2.43*x + .59) + .14), 0., 1.); }
  vec3 finish(vec3 c, vec2 fc){ c = aces(c); c = pow(c, vec3(1./2.2)); return c + (h21(fc + fract(uTime)*91.7) - .5)*(2./255.); }
  `;

  /* =====================================================================
     HERO — sky, Coast Mountains in fog, particle flag, rim-lit photographer
     ===================================================================== */
  (function hero() {
    const sec = document.querySelector(".hero");
    if (!sec) return;
    const cv = sec.querySelector(".hero-gl"), rainCv = sec.querySelector(".hero-rain");
    const K = makeGL(cv);
    if (!K) { sec.classList.add("no-webgl"); return; }
    const { gl, fsVAO } = K;

    const BG = program(gl, VS_FULL, COMMON + `
    uniform float uAsm; uniform vec2 uFlag;
    float hgt(float x, int i){
      float fi = float(i);
      float base = -.13 - .07*fi, amp = .2 - .05*fi, fr = 1.2 + 1.2*fi;
      return base + amp*(ridge(x*fr + 7.1*fi + 3.) - .62);
    }
    // height field used for rock relief inside each range
    float relief(vec2 q){ return fbm(q) + .5*fbm(q*2.7 + 3.1); }
    void main(){
      vec2 fc = gl_FragCoord.xy; vec2 p = (fc - .5*uRes)/uRes.y;
      vec2 m = uMouse;
      float y = p.y;
      vec3 col = mix(vec3(.030,.034,.040), vec3(.006,.008,.012), smoothstep(-.1, .55, y));
      // overcast deck catching the last cold light
      vec2 cp = vec2(p.x*.9 + uTime*.005 + m.x*.01, y*2.2);
      float cl = fbm(cp*1.8 + vec2(0., uTime*.002));
      float cd = fbm(cp*4.5 - vec2(uTime*.008, 0.));
      col = mix(col, vec3(.028,.031,.036)*(.5 + cd), smoothstep(.35, .85, cl)*smoothstep(-.05, .35, y));
      col += vec3(.05,.045,.045)*exp(-abs(y + .06)*10.)*smoothstep(1.2, -.8, p.x);
      // the flag's light bleeding into the mist
      vec2 fq = (p - uFlag)*vec2(.75, 1.25);
      col += vec3(.5,.08,.06)*exp(-dot(fq, fq)*6.)*.07*uAsm;
      vec3 haze = vec3(.026,.03,.036);
      for (int i = 0; i < 3; i++){
        float fi = float(i);
        float x = p.x + m.x*(.01 + .025*fi);
        float h = hgt(x, i);
        float e = .002;
        float sl = (hgt(x + e, i) - hgt(x - e, i))/(2.*e);
        if (y < h){
          vec2 q = vec2(x, y)*vec2(9., 9.) + fi*11.;
          float r0 = relief(q), rx = relief(q + vec2(.03, 0.)), ry = relief(q + vec2(0., .03));
          vec3 n = normalize(vec3(-(rx - r0)*14. - sl*.6, -(ry - r0)*14. + .4, 1.));
          float lit = max(dot(n, normalize(vec3(-.6, .55, .55))), 0.);
          float depth = h - y;
          // snow settles where the relief is gentle and high
          float snow = smoothstep(.55, .75, r0 + n.y*.5 - depth*2.2 + .2 - fi*.15)*step(fi, 1.5);
          vec3 rock = vec3(.010,.011,.013)*(.6 + r0);
          vec3 c = mix(rock, vec3(.13,.14,.155), snow);
          c *= .35 + 1.3*lit;
          c += vec3(.06,.062,.07)*exp(-depth*220.)*smoothstep(-.3, .4, -sl);
          if (i == 2) c = mix(c, vec3(.006,.008,.009), .7);
          float hz = (2. - fi)/2.;
          col = mix(c, haze, .62*hz + .08);
        }
        float band = exp(-pow((y - (h - .05 - .02*fi))*15., 2.));
        float mist = fbm(vec2(x*2.6 + uTime*.012*(fi + 1.), y*9. + fi*3.));
        col = mix(col, haze*1.5, smoothstep(.42, .8, mist)*band*.8);
      }
      o = vec4(finish(col, fc), 1.);
    }`);

    const FG = program(gl, VS_FULL, COMMON + `
    uniform float uAsm; uniform vec2 uFlag; uniform float uPX;
    float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
    float sdCap(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.); return length(pa - ba*h) - r; }
    float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b - a)/k, 0., 1.); return mix(b, a, h) - k*h*(1. - h); }
    float ground(float x){ return -.37 + .03*fbm3(vec2(x*5., 2.)) - .07*smoothstep(-.05, -1., x - uPX); }
    // Photographer seen from behind, hands on a camera atop a tripod.
    float sdE(vec2 p, vec2 r){ float k0 = length(p/r), k1 = length(p/(r*r)); return k0*(k0 - 1.)/max(k1, 1e-4); }
    // Photographer seen from behind, hands on a camera that sits on a tripod in front of him.
    float person(vec2 q){
      float d = sdE(q - vec2(0., .905), vec2(.058, .068));                       // head
      d = smin(d, sdE(q - vec2(0., .935), vec2(.062, .05)), .02);                // beanie
      d = smin(d, sdBox(q - vec2(0., .835), vec2(.03, .03)), .03);               // neck
      d = smin(d, sdCap(q, vec2(-.04, .815), vec2(-.165, .755), .052), .05);     // sloped shoulders
      d = smin(d, sdCap(q, vec2(.04, .815), vec2(.165, .755), .052), .05);
      d = smin(d, sdE(q - vec2(0., .65), vec2(.155, .19)), .06);                 // jacket
      d = smin(d, sdBox(q - vec2(0., .5), vec2(.14, .05)) - .015, .04);          // hem
      d = smin(d, sdCap(q, vec2(-.175, .76), vec2(-.2, .58), .04), .03);         // upper arms, forearms reach forward
      d = smin(d, sdCap(q, vec2(.175, .76), vec2(.195, .6), .04), .03);
      d = smin(d, sdCap(q, vec2(-.06, .47), vec2(-.075, .05), .052), .04);       // legs
      d = smin(d, sdCap(q, vec2(.06, .47), vec2(.085, .05), .052), .04);
      d = smin(d, sdE(q - vec2(-.085, .025), vec2(.055, .03)), .02);             // boots
      d = smin(d, sdE(q - vec2(.095, .025), vec2(.055, .03)), .02);
      float rig = sdCap(q, vec2(-.02, .79), vec2(-.36, -.01), .006);             // tripod
      rig = min(rig, sdCap(q, vec2(.02, .79), vec2(.34, -.01), .006));
      rig = min(rig, sdCap(q, vec2(0., .79), vec2(-.03, -.03), .006));
      rig = min(rig, sdBox(q - vec2(-.155, .845), vec2(.05, .036)) - .01);       // camera body past his shoulder
      rig = min(rig, sdBox(q - vec2(-.225, .842), vec2(.035, .026)) - .006);     // lens
      return min(d, rig);
    }
    void main(){
      vec2 fc = gl_FragCoord.xy; vec2 p = (fc - .5*uRes)/uRes.y;
      vec2 m = uMouse;
      float asp = uRes.x/uRes.y;
      p.x += m.x*.012;
      float gy = ground(p.x);
      vec3 C = vec3(0.); float A = 0.;
      // rock ledge
      if (p.y < gy){
        float t = fbm(p*vec2(18., 22.)), t2 = fbm(p*70.);
        vec3 rock = vec3(.006,.007,.008) + vec3(.02,.021,.024)*t*t2*1.6;
        float wet = smoothstep(.5, .7, fbm(p*vec2(6., 30.)));
        rock += vec3(.035,.038,.045)*wet*smoothstep(-.6, -.33, p.y)*.6;
        float edge = exp(-(gy - p.y)*160.);
        rock += vec3(.05,.053,.06)*edge*.5 + vec3(.03,.008,.006)*edge*uAsm*.4;
        C = rock; A = 1.;
      }
      // photographer
      float S = .25;
      vec2 base = vec2(uPX, ground(uPX) - .006);
      vec2 q = (p - base)/S;
      float d = person(q)*S;
      if (d < .0015){
        float e = .0015;
        vec2 g = normalize(vec2(person((p + vec2(e, 0.) - base)/S) - person((p - vec2(e, 0.) - base)/S),
                                person((p + vec2(0., e) - base)/S) - person((p - vec2(0., e) - base)/S)));
        float inner = smoothstep(.0, -.012, d);
        vec3 body = vec3(.004,.0045,.006);
        body += vec3(.006,.0065,.008)*fbm(q*vec2(24., 50.));
        // rim light: the bright sky ahead and the flag's red glow wrap the edges
        vec2 toFlag = normalize(uFlag - p);
        float rimSky = pow(max(dot(g, normalize(vec2(-.2, 1.))), 0.), 1.4);
        float rimFlag = pow(max(dot(g, toFlag), 0.), 2.);
        float rimW = smoothstep(-.0028, -.0004, d);
        body += (vec3(.12,.13,.15)*rimSky + vec3(.55,.08,.05)*rimFlag*uAsm)*rimW;
        float aa = smoothstep(.0015, -.0015, d);
        C = C*(1. - aa) + body*aa; A = A*(1. - aa) + aa;
      }
      // low mist drifting in front of the ledge
      float mist = fbm(vec2(p.x*2.2 - uTime*.03, p.y*6. + uTime*.01));
      float mb = smoothstep(-.18, -.45, p.y)*smoothstep(.45, .75, mist);
      vec3 mc = vec3(.04,.045,.052);
      C = C*(1. - mb*.7) + mc*mb*.7; A = A*(1. - mb*.7) + mb*.7;
      vec3 c = A > 0. ? C/A : vec3(0.);
      c = aces(c); c = pow(c, vec3(1./2.2));
      o = vec4(c*A, A);
    }`);

    // Flag particles
    const PV = program(gl, `#version 300 es
    layout(location=0) in vec2 aUV; layout(location=1) in vec3 aCol; layout(location=2) in vec4 aRnd;
    uniform mat4 uVP; uniform float uTime, uAsm, uScatter, uSize, uFW, uAsp; uniform vec2 uMouseN; uniform vec3 uFlagC;
    out vec3 vC; out float vA;
    void main(){
      float u = aUV.x, v = aUV.y, t = uTime;
      float ph = u*7.2 - t*1.9 + v*1.2;
      float w = (sin(ph)*.15 + sin(u*15. - t*3.1 + v*2.3)*.035)*smoothstep(0., .85, u);
      vec3 pos = vec3((u - .5)*uFW, (v - .5)*uFW*.5 - u*u*.05 + sin(u*5.5 - t*1.6)*.045*u, w*uFW*.32);
      float slope = cos(ph)*.15*7.2*smoothstep(0., .85, u);
      float shade = clamp(.82 - slope*.38, .3, 1.4);
      float k = smoothstep(aRnd.w*.55, aRnd.w*.55 + .45, uAsm);
      vec3 scat = (aRnd.xyz*2. - 1.)*vec3(4., 2.6, 3.) + vec3(0., .6, 0.);
      vec3 wind = vec3(2.8 + aRnd.x*2.5, 1.2 + aRnd.y*2., (aRnd.z - .5)*3.)*uScatter*(.35 + u*.9);
      wind += vec3(sin(t*1.3 + aRnd.y*30.), cos(t*1.1 + aRnd.x*30.), 0.)*.05*uScatter;
      vec3 P = mix(scat, pos, k) + wind + uFlagC;
      vec4 c = uVP*vec4(P, 1.);
      vec2 nd = c.xy/c.w; vec2 dm = (nd - uMouseN)*vec2(uAsp, 1.);
      float md = length(dm);
      c.xy += normalize(dm + 1e-5)*.07*exp(-md*md*28.)*c.w*k;
      gl_Position = c;
      gl_PointSize = uSize/c.w*(.75 + aRnd.y*.5);
      vC = aCol*shade*shade;
      vA = (.25 + .75*k)*(1. - clamp(uScatter*.7, 0., .8));
    }`, `#version 300 es
    precision highp float; in vec3 vC; in float vA; uniform float uGain; out vec4 o;
    void main(){ float d = length(gl_PointCoord - .5)*2.; float a = smoothstep(1., .0, d); a *= a; a *= vA*uGain; o = vec4(vC*a, a); }`);

    // Sample the Canadian flag into a particle grid
    const GX = innerWidth < 760 ? 110 : 150, GY = GX / 2;
    const fc = document.createElement("canvas"); fc.width = GX * 2; fc.height = GY * 2;
    const f2 = fc.getContext("2d");
    f2.fillStyle = "#d52b1e"; f2.fillRect(0, 0, fc.width, fc.height);
    f2.fillStyle = "#fff"; f2.fillRect(fc.width / 4, 0, fc.width / 2, fc.height);
    f2.save(); f2.scale(fc.width / 9600, fc.height / 4800); f2.fillStyle = "#d52b1e";
    f2.fill(new Path2D("m4890 4430-45-863a95 95 0 0 1 111-98l859 151-116-320a65 65 0 0 1 20-73l941-762-212-99a65 65 0 0 1-34-79l186-572-542 115a65 65 0 0 1-73-38l-105-247-423 454a65 65 0 0 1-111-57l204-1052-327 189a65 65 0 0 1-91-27l-332-652-332 652a65 65 0 0 1-91 27l-327-189 204 1052a65 65 0 0 1-111 57l-423-454-105 247a65 65 0 0 1-73 38l-542-115 186 572a65 65 0 0 1-34 79l-212 99 941 762a65 65 0 0 1 20 73l-116 320 859-151a95 95 0 0 1 111 98l-45 863z"));
    f2.restore();
    const px = f2.getImageData(0, 0, fc.width, fc.height).data;
    const N = GX * GY, uv = new Float32Array(N * 2), col = new Float32Array(N * 3), rnd = new Float32Array(N * 4);
    let k = 0;
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++, k++) {
      const u = (i + .5) / GX, v = (j + .5) / GY;
      const ix = Math.floor(u * fc.width), iy = Math.floor((1 - v) * fc.height), o4 = (iy * fc.width + ix) * 4;
      const red = px[o4 + 1] < 128;
      uv[k * 2] = u + (Math.random() - .5) * .7 / GX; uv[k * 2 + 1] = v + (Math.random() - .5) * .7 / GY;
      const c = red ? [1.0, .1, .06] : [.92, .93, .97];
      col.set(c, k * 3);
      rnd.set([Math.random(), Math.random(), Math.random(), Math.random() * .6 + u * .4], k * 4);
    }
    const pVAO = gl.createVertexArray(); gl.bindVertexArray(pVAO);
    for (const [data, loc, size] of [[uv, 0, 2], [col, 1, 3], [rnd, 2, 4]]) {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);

    // Rain and mist droplets on a 2D overlay
    const rctx = rainCv.getContext("2d");
    const drops = Array.from({ length: innerWidth < 760 ? 140 : 260 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), s: Math.random() }));
    const motes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), p: Math.random() * 6.28 }));

    const SZ = sizer(cv, 1.6e6, 1.75);
    let asm = 0, t0 = performance.now() / 1000, scatter = 0;
    const copy = sec.querySelector(".hero-copy");

    const persp = (fy, a, n, f) => { const t = 1 / Math.tan(fy / 2); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; };
    const mul = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k2 = 0; k2 < 4; k2++) o[i * 4 + j] += a[k2 * 4 + j] * b[i * 4 + k2]; return o; };
    const look = (e, c) => {
      const nz = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
      const z = nz([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = nz([z[2], 0, -z[0]]), y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -d(x, e), -d(y, e), -d(z, e), 1];
    };

    loopWhileVisible(sec, (now, dt) => {
      SZ.tick(dt);
      const { w, h, s, cssW, cssH } = SZ.fit();
      if (rainCv.width !== Math.round(cssW) || rainCv.height !== Math.round(cssH)) { rainCv.width = Math.round(cssW); rainCv.height = Math.round(cssH); }
      const kk = reduce ? 1 : 1 - Math.exp(-dt * 3);
      mouse.x += (mouse.tx - mouse.x) * kk; mouse.y += (mouse.ty - mouse.y) * kk;
      const r = sec.getBoundingClientRect();
      const prog = clamp(-r.top / Math.max(1, r.height - innerHeight));
      const intro = reduce ? 1 : clamp((now - t0 - .3) / 3.2);
      asm = intro * intro * (3 - 2 * intro);
      scatter += (smooth(.05, .95, prog) * 1.25 - scatter) * kk;
      copy.style.setProperty("--p", prog.toFixed(3));
      sec.style.setProperty("--asm", asm.toFixed(3));

      const asp = w / h;
      const flagW = Math.min(2.25, 3.85 * asp * .8);
      const flagY = asp < 1 ? .02 : -.17;
      const uFlagScreen = [0, (flagY / 3.85)];
      const PXv = asp < 1 ? .07 : clamp(asp * .19, .1, .36);

      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      // background
      gl.disable(gl.BLEND); gl.useProgram(BG.p); gl.bindVertexArray(fsVAO);
      gl.uniform2f(BG.u.uRes, w, h); gl.uniform1f(BG.u.uTime, now); gl.uniform2f(BG.u.uMouse, mouse.x, mouse.y);
      gl.uniform1f(BG.u.uAsm, asm * (1 - Math.min(1, scatter))); gl.uniform2f(BG.u.uFlag, uFlagScreen[0], uFlagScreen[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // particles
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(PV.p); gl.bindVertexArray(pVAO);
      const eye = [mouse.x * .35, mouse.y * .2, 6];
      const VP = mul(persp(35 * Math.PI / 180, asp, .1, 50), look(eye, [0, 0, 0]));
      gl.uniformMatrix4fv(PV.u.uVP, false, VP);
      gl.uniform1f(PV.u.uTime, now); gl.uniform1f(PV.u.uAsm, asm); gl.uniform1f(PV.u.uScatter, scatter);
      gl.uniform1f(PV.u.uFW, flagW); gl.uniform1f(PV.u.uAsp, asp); gl.uniform2f(PV.u.uMouseN, mouse.x, mouse.y);
      gl.uniform3f(PV.u.uFlagC, 0, flagY, 0);
      const spacing = flagW * h / 3.783 / GX;
      gl.uniform1f(PV.u.uSize, spacing * 6 * 5); gl.uniform1f(PV.u.uGain, .013);  // soft bloom
      gl.drawArrays(gl.POINTS, 0, N);
      gl.uniform1f(PV.u.uSize, spacing * 6 * 1.25); gl.uniform1f(PV.u.uGain, 1.0);
      gl.drawArrays(gl.POINTS, 0, N);
      // foreground
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(FG.p); gl.bindVertexArray(fsVAO);
      gl.uniform2f(FG.u.uRes, w, h); gl.uniform1f(FG.u.uTime, now); gl.uniform2f(FG.u.uMouse, mouse.x, mouse.y);
      gl.uniform1f(FG.u.uAsm, asm * (1 - Math.min(1, scatter))); gl.uniform2f(FG.u.uFlag, 0, flagY / 3.85 + .02);
      gl.uniform1f(FG.u.uPX, PXv);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // rain
      const W = rainCv.width, H = rainCv.height;
      rctx.clearRect(0, 0, W, H);
      const wind = .18 + mouse.x * .08;
      rctx.lineCap = "round";
      for (const d of drops) {
        const sp = .55 + d.z * 1.1;
        if (!reduce) { d.y += dt * sp * 1.15; d.x += dt * sp * wind * .5; }
        if (d.y > 1.05) { d.y = -.05; d.x = Math.random() * 1.2 - .1; }
        if (d.x > 1.1) d.x -= 1.2;
        const len = (8 + d.z * 22) * (H / 900), x = d.x * W, y = d.y * H;
        rctx.strokeStyle = `rgba(200,214,232,${.05 + d.z * .13})`; rctx.lineWidth = .6 + d.z * .9;
        rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x - len * wind * .45, y - len); rctx.stroke();
      }
      for (const m of motes) {
        if (!reduce) { m.x += dt * (.006 + m.z * .01) + Math.sin(now * .4 + m.p) * .0004; m.y += Math.cos(now * .3 + m.p) * .0003; }
        if (m.x > 1.02) m.x = -.02;
        const rr = (1 + m.z * 2.2) * (H / 900);
        rctx.fillStyle = `rgba(210,220,235,${.04 + m.z * .07})`;
        rctx.beginPath(); rctx.arc(m.x * W + mouse.x * 18 * m.z, m.y * H - mouse.y * 10 * m.z, rr, 0, 6.283); rctx.fill();
      }
    });
  })();

  /* =====================================================================
     WEST COAST SCENES — dawn alpine, seawall at sunset, Lions Gate at night
     ===================================================================== */
  const COAST_FS = COMMON + `
  uniform int uA, uB; uniform float uMix, uZoom;
  uniform float uShutter, uAperture, uISO, uPlay;

  // ---------- Scene 0: Coast Mountains at dawn ----------
  float aH(float x, int i){ float fi = float(i); float base = .03 - .095*fi, amp = .24 - .045*fi, fr = 1.05 + .85*fi;
    return base + amp*(ridge(x*fr + 11.3*fi + 1.7) - .6); }
  vec3 alpine(vec2 p){
    vec2 m = uMouse;
    vec2 S = vec2(-.5, .015);
    vec3 col = mix(vec3(.95,.46,.24), vec3(.03,.055,.11), smoothstep(-.08, .5, p.y));
    col = mix(col, vec3(.4,.22,.28), exp(-pow((p.y - .1)*7., 2.))*.35);
    float sd = length(p - S);
    col += vec3(1.,.5,.22)*exp(-sd*4.)*.7 + vec3(1.,.82,.58)*smoothstep(.026, .018, sd)*6.;
    float ci = fbm(vec2(p.x*1.4 + uTime*.004, p.y*7.));
    col = mix(col, vec3(.85,.42,.33)*.55, smoothstep(.55, .85, ci)*smoothstep(.12, .42, p.y)*.55);
    vec3 Ld = normalize(vec3(-.9, .25, .35));
    for (int i = 0; i < 4; i++){
      float fi = float(i);
      float x = p.x + m.x*(.008 + .022*fi);
      float h = aH(x, i);
      float e = .012;
      float sl = clamp((aH(x + e, i) - aH(x - e, i))/(2.*e), -2., 2.);
      if (p.y < h){
        vec2 q = vec2(x, p.y)*7.*(1. + fi*.6) + fi*13.;
        float r0 = fbm(q) + .5*fbm(q*2.7 + 3.1);
        float rx = fbm(q + vec2(.025, 0.)) + .5*fbm((q + vec2(.025, 0.))*2.7 + 3.1);
        float ry = fbm(q + vec2(0., .025)) + .5*fbm((q + vec2(0., .025))*2.7 + 3.1);
        vec3 n = normalize(vec3(-(rx - r0)*12. - sl*.25, -(ry - r0)*12. + .3, 1.));
        float lit = max(dot(n, Ld), 0.);
        float depth = h - p.y;
        float snow = smoothstep(.6, .76, r0 + n.y*.4 - depth*(2.2 + fi) + .22);
        vec3 rock = vec3(.03,.028,.03)*(.5 + r0);
        vec3 c = mix(rock, vec3(.75,.78,.86), snow);
        c *= vec3(.10,.13,.22) + vec3(1.,.55,.3)*2.1*lit*(1. - fi*.15);
        c += vec3(1.,.55,.32)*exp(-depth*220.)*max(-sl, 0.)*.5;
        float hz = (3. - fi)/3.;
        vec3 hc = mix(vec3(.7,.4,.34), vec3(.22,.24,.36), smoothstep(-.7, .6, p.x));
        col = mix(c, hc*.6, hz*hz*.72);
      }
      float yb = -.04 - .08*fi;
      float band = exp(-pow((p.y - yb)*10., 2.));
      float cl = fbm(vec2(x*2. + uTime*.01*(fi + 1.), p.y*6. + fi*4.));
      vec3 cc = mix(vec3(1.,.68,.52), vec3(.5,.53,.66), smoothstep(-.6, .5, p.x));
      col = mix(col, cc*.75, smoothstep(.45, .75, cl)*band*.8*step(.5, fi));
    }
    return col;
  }

  // ---------- Scene 1: Stanley Park seawall at sunset ----------
  float tree(vec2 p, float x0, float top, float w, bool full){
    float dy = top - p.y;
    if (dy < 0.) return 0.;
    float trunk = step(abs(p.x - x0), w*.05 + dy*.012);
    float cone = min(dy, 1.3)*w*.42;
    float br = full ? fbm(vec2(p.y*36. + x0*5., x0*3.)) : n1(p.y*30. + x0*5.);
    float jag = full ? (.45 + .7*br)*(.82 + .18*n2(vec2(p.y*160., p.x*90.))) : (.55 + .55*br);
    return max(trunk, smoothstep(.0025, -.0025, abs(p.x - x0) - cone*jag));
  }
  float canopy(vec2 p, bool full){
    float o = 0.;
    float hw = .5*uRes.x/uRes.y, k = clamp(hw/.8, .3, 1.), sk = sqrt(k);
    o = max(o, tree(p, -hw - .06*k, .95, .55*sk, full));
    o = max(o, tree(p, -hw + .17*k, .78, .45*sk, full));
    o = max(o, tree(p, -hw + .32*k, .52, .3*sk, full));
    o = max(o, tree(p, hw, .88, .5*sk, full));
    o = max(o, tree(p, hw + .17*k, .72, .5*sk, full));
    float edge = .44 - .2*p.x + (full ? .12*fbm3(p*vec2(5., 3.)) + .03*n2(p*120.) : .1*n1(p.x*5.));
    return max(o, smoothstep(-.003, .003, p.y - edge)*step(p.x, .5));
  }
  vec3 seawall(vec2 p){
    vec2 m = uMouse; p.x += m.x*.015;
    vec2 S = vec2(.14*clamp(.5*uRes.x/uRes.y/.8, .3, 1.), .1);
    float hz = -.02;
    vec3 sky = mix(vec3(1.,.5,.2)*1.05, vec3(.05,.1,.16), smoothstep(-.02, .45, p.y));
    float sd = length(p - S);
    sky += vec3(1.,.55,.25)*exp(-sd*4.5)*.8 + vec3(1.,.88,.65)*smoothstep(.028, .02, sd)*5.;
    vec3 col = sky;
    // North Shore across the water
    float ns = hz + .05 + .05*ridge(p.x*1.4 + 4.);
    if (p.y < ns) col = mix(vec3(.05,.045,.06), sky, .45);
    float wallTop = -.27 + .05*p.x;
    if (p.y < hz){
      float d = 1./(hz - p.y + .015);
      vec2 wv = vec2(p.x*d*.5, d*1.2 - uTime*.35);
      float w1 = fbm(wv*2.), w2 = fbm(wv*2. + vec2(.13, 0.));
      float nx = (w2 - w1)*6.;
      vec2 rp = vec2(p.x + nx*.04, hz + (hz - p.y)*.6);
      vec3 refl = mix(vec3(1.,.5,.2), vec3(.05,.1,.15), smoothstep(-.02, .35, rp.y));
      float glitter = exp(-pow((p.x - S.x)*(2.5 + d*.15), 2.))*pow(max(w1*1.6 - .55, 0.), 3.)*9.;
      col = mix(vec3(.006,.014,.02), refl, .5) + vec3(1.,.7,.4)*glitter*.8;
    }
    if (p.y < wallTop){
      float d = 1./(wallTop - p.y + .05);
      float st = fbm(vec2(p.x*d*2.6, d*3.));
      float joints = smoothstep(.04, .0, abs(fract(d*1.4) - .5) - .45) + smoothstep(.03, .0, abs(fract(p.x*d*.7) - .5) - .47);
      vec3 stone = mix(vec3(.018,.017,.016), vec3(.06,.055,.05), st)*(1. - joints*.45);
      float wet = smoothstep(.45, .6, fbm(vec2(p.x*4., d*.8)));
      vec3 r2 = vec3(1.,.55,.25)*exp(-pow((p.x - S.x)*2.4, 2.))*.8;
      col = stone + r2*wet*.5;
      col = mix(col, vec3(.02,.02,.022), smoothstep(.012, .0, abs(p.y - wallTop + .006)));
    }
    // canopy, rim light and god rays
    float occ = canopy(p, true);
    vec2 toS = normalize(S - p);
    float rim = occ*(1. - canopy(p + toS*.006, false));
    vec3 tc = vec3(.003,.009,.006) + vec3(.004,.012,.008)*fbm(p*40.);
    col = mix(col, tc, occ) + vec3(1.,.62,.3)*rim*1.3;
    float ray = 0.;
    for (int k = 0; k < 22; k++){ vec2 q = mix(p, S, float(k)/22.); ray += 1. - canopy(q, false); }
    ray /= 22.;
    float shaft = ray*exp(-length(p - S)*1.4)*(.55 + .45*fbm3(vec2(atan(p.y - S.y, p.x - S.x)*9., uTime*.05)));
    col += vec3(1.,.66,.34)*shaft*.5*(1. - occ*.7);
    return col;
  }

  // ---------- Scene 2: Lions Gate Bridge in fog, night ----------
  float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.); }
  float cY(float z){ return 5. + 85.*min(z*z/19600., 1.6); }
  vec2 bmap(vec3 p){
    float d = sdBox(p - vec3(0., -.5, 0.), vec3(10.5, .5, 2000.)); float id = 1.;
    float ax = abs(p.x);
    float rail = min(sdBox(vec3(ax - 10., p.y - 1.1, p.z), vec3(.06, .06, 2000.)),
                     sdBox(vec3(ax - 10., p.y - .55, mod(p.z, 2.5) - 1.25), vec3(.05, .55, .05)));
    if (rail < d){ d = rail; id = 3.; }
    float qz = mod(p.z + 16., 32.) - 16.;
    float lamp = min(sdBox(vec3(ax - 7.2, p.y - 4.6, qz), vec3(.11, 4.6, .11)), sdBox(vec3(ax - 6.5, p.y - 9.1, qz), vec3(.7, .07, .07)));
    if (lamp < d){ d = lamp; id = 3.; }
    float head = sdBox(vec3(ax - 5.8, p.y - 8.95, qz), vec3(.38, .12, .2));
    if (head < d){ d = head; id = 4.; }
    float sl = 170.*p.z/19600.;
    float cab = length(vec2(ax - 10.6, (p.y - cY(p.z))/sqrt(1. + sl*sl))) - .45;
    if (cab < d){ d = cab; id = 5.; }
    float hz = mod(p.z, 10.) - 5.;
    float sus = max(length(vec2(ax - 10.6, hz)) - .05, max(-p.y, p.y - cY(p.z)));
    if (sus < d){ d = sus; id = 5.; }
    vec3 tp = vec3(ax - 11.8, p.y - 46., p.z - 150.);
    float tw = sdBox(tp, vec3(1.7, 46., 2.4));
    tw = min(tw, sdBox(vec3(p.x, p.y - 31., p.z - 150.), vec3(12., 1.4, 1.6)));
    tw = min(tw, sdBox(vec3(p.x, p.y - 64., p.z - 150.), vec3(12., 1.4, 1.6)));
    tw = min(tw, sdBox(vec3(p.x, p.y - 90., p.z - 150.), vec3(13., 1.8, 2.)));
    if (tw < d){ d = tw; id = 6.; }
    return vec2(d, id);
  }
  float glowSeg(vec3 ro, vec3 rd, vec3 L, float tMax){
    vec3 oc = L - ro; float tc = dot(oc, rd); float h = sqrt(max(dot(oc, oc) - tc*tc, 1e-3));
    return (atan((tMax - tc)/h) - atan(-tc/h))/h*exp(-max(tc, 0.)*.012);
  }
  vec3 bridge(vec2 p){
    vec2 m = uMouse;
    vec3 ro = vec3(-2.4 + m.x*.8, 1.55, -12.);
    vec3 ta = vec3(.5, 13. + m.y*5., 140.);
    vec3 fw = normalize(ta - ro), rt = normalize(cross(fw, vec3(0,1,0))), up = cross(rt, fw);
    vec3 rd = normalize(p.x*rt + p.y*up + 1.45*fw);
    float t = 0., id = 0.;
    for (int i = 0; i < 110; i++){
      vec2 h = bmap(ro + rd*t);
      if (h.x < .0015*t){ id = h.y; break; }
      t += h.x*.9;
      if (t > 420.){ id = 0.; break; }
    }
    float tHit = id > 0. ? t : 420.;
    vec3 P = ro + rd*tHit;
    vec3 sodium = vec3(1.,.5,.16);
    vec3 col = vec3(0.);
    if (id > 0.){
      vec2 e = vec2(.004*t, 0.);
      vec3 n = normalize(vec3(bmap(P + e.xyy).x - bmap(P - e.xyy).x, bmap(P + e.yxy).x - bmap(P - e.yxy).x, bmap(P + e.yyx).x - bmap(P - e.yyx).x));
      vec3 base = vec3(.03);
      if (id == 1.){
        float ax = abs(P.x);
        base = ax < 6.2 ? vec3(.012) + .012*fbm(P.xz*3.) : vec3(.04);
        float dash = step(abs(P.x), .09)*step(fract(P.z/9.), .45) + step(abs(ax - 6.), .08);
        base = mix(base, vec3(.35,.33,.25), dash*(ax < 6.2 ? 1. : 0.));
      }
      if (id == 6.) base = vec3(.05,.055,.05);
      if (id == 5.) base = vec3(.06,.065,.06);
      // light from the nearest lamps
      vec3 L = vec3(0.);
      float qz0 = floor(P.z/32. + .5)*32.;
      for (int k = -1; k <= 1; k++){
        for (int s = -1; s <= 1; s += 2){
          vec3 lp = vec3(float(s)*5.8, 8.8, qz0 + float(k)*32.);
          vec3 lv = lp - P; float ld = length(lv);
          L += sodium*max(dot(n, lv/ld), 0.)*28./(ld*ld + 4.);
        }
      }
      col = base*(L + vec3(.01,.012,.016));
      if (id == 4.) col = sodium*vec3(5.);
      if (id == 1.){
        // wet asphalt: lamp reflections stretched into streaks
        float wet = .55 + .45*smoothstep(.35, .7, fbm(P.xz*.35));
        for (int k = 0; k < 8; k++){
          for (int s = -1; s <= 1; s += 2){
            vec3 lm = vec3(float(s)*5.8, -8.8, 32.*float(k));
            vec3 v = normalize(lm - ro); vec3 dlt = rd - v;
            float dx = dot(dlt, rt), dy = dot(dlt, up);
            col += sodium*exp(-dx*dx/.00006 - dy*dy/.004)*wet*.9*exp(-float(k)*.25);
          }
        }
      }
    }
    // fog and lamp in-scatter
    float sig = .011;
    float fogN = .6 + .8*fbm(vec2(rd.x*3. + uTime*.025, rd.y*4. - uTime*.01));
    float T = exp(-sig*tHit*fogN);
    vec3 fogC = vec3(.005,.007,.011) + vec3(.012,.008,.005)*smoothstep(.3, -.1, rd.y);
    col = col*T + fogC*(1. - T);
    vec3 ins = vec3(0.);
    float bok = uPlay > .5 ? 3.2/uAperture : 1.4/2.8;
    for (int k = -1; k < 9; k++){
      for (int s = -1; s <= 1; s += 2){
        vec3 lp = vec3(float(s)*5.8, 8.8, 32.*float(k));
        ins += sodium*glowSeg(ro, rd, lp, tHit)*.016*fogN;
        // bokeh discs for far lamps when the aperture is wide
        vec3 v = normalize(lp - ro); float ang = length(rd - v);
        float dist = length(lp - ro);
        float r = .0035 + bok*.012*smoothstep(10., 120., dist);
        float disc = smoothstep(r, r*.82, ang)*(.6 + .4*smoothstep(r*.6, r, ang));
        ins += sodium*disc*1.2*(.004/(r*r*900. + .004))*exp(-dist*.006)*step(dist, tHit + 1.);
      }
    }
    // traffic: tail lights going away, headlights coming toward us
    float sh = uPlay > .5 ? uShutter : 1./50.;
    for (int c = 0; c < 2; c++){
      float fc2 = float(c);
      float zr = 25. + mod(uTime*17. + fc2*110., 230.);
      float zo = 240. - mod(uTime*21. + 60. + fc2*120., 240.);
      float len = max(17.*sh*14., .3), leno = max(21.*sh*14., .3);
      for (int j = 0; j < 5; j++){
        float f = float(j)/4.;
        for (int s = -1; s <= 1; s += 2){
          vec3 tl = vec3(-2.3 + float(s)*.75, .85, zr - f*len);
          ins += vec3(1.,.06,.04)*glowSeg(ro, rd, tl, tHit)*.012/5.;
          vec3 hl = vec3(3.2 + float(s)*.75, .75, zo + f*leno);
          ins += vec3(.9,.92,1.)*glowSeg(ro, rd, hl, tHit)*.02/5.;
        }
      }
    }
    col += ins;
    col += vec3(.008,.01,.014)*smoothstep(-.1, .5, rd.y);
    return col;
  }

  vec3 scene(int i, vec2 p){ if (i == 0) return alpine(p); if (i == 1) return seawall(p); return bridge(p); }
  void main(){
    vec2 fc = gl_FragCoord.xy;
    vec2 p = (fc - .5*uRes)/uRes.y;
    p /= uZoom;
    vec3 col = scene(uA, p);
    if (uMix > .001) col = mix(col, scene(uB, p*(1. + (1. - uMix)*.06)), uMix);
    if (uPlay > .5){
      float light = uShutter*50.*(16./(uAperture*uAperture))*(uISO/800.);
      col *= light;
      float g = (h21(fc + fract(uTime*7.)*113.) - .5);
      col += g*.06*pow(log2(uISO/100.)/7., 1.6)*(.4 + col);
    }
    vec2 q = fc/uRes; col *= .55 + .45*pow(16.*q.x*q.y*(1. - q.x)*(1. - q.y), .22);
    o = vec4(finish(col, fc), 1.);
  }`;

  /* ---------- the day sequence ---------- */
  (function coast() {
    const sec = document.querySelector(".coast");
    if (!sec) return;
    const cv = sec.querySelector(".coast-gl");
    const K = makeGL(cv);
    if (!K) { sec.classList.add("no-webgl"); return; }
    const { gl, fsVAO } = K;
    const P = program(gl, VS_FULL, COAST_FS);
    const SZ = sizer(cv, 6.5e5, 2);
    const slides = [...sec.querySelectorAll(".slide")];
    const bars = [...sec.querySelectorAll(".coast-progress i")];
    let pSm = 0;
    loopWhileVisible(sec, (now, dt) => {
      SZ.tick(dt);
      const { w, h } = SZ.fit();
      const kk = reduce ? 1 : 1 - Math.exp(-dt * 4);
      mouse.x += (mouse.tx - mouse.x) * kk * .5; mouse.y += (mouse.ty - mouse.y) * kk * .5;
      const r = sec.getBoundingClientRect();
      const prog = clamp(-r.top / Math.max(1, r.height - innerHeight));
      pSm += (prog - pSm) * (reduce ? 1 : 1 - Math.exp(-dt * 8));
      const n = 3, t = pSm * n;
      const a = Math.min(n - 1, Math.floor(t)), lt = t - a;
      const mix = a < n - 1 ? smooth(.72, 1, lt) : 0;
      slides.forEach((s, i) => {
        const l = t - i;
        const vis = i === 0 ? (l < .5 ? 1 : 1 - smooth(.62, .8, l)) : i === n - 1 ? smooth(-.2, .05, l) : smooth(-.2, .05, l) * (1 - smooth(.62, .8, l));
        s.style.opacity = vis.toFixed(3);
        s.style.filter = `blur(${((1 - vis) * 10).toFixed(1)}px)`;
        s.style.transform = `translateY(${((1 - vis) * (l < .3 ? 24 : -24)).toFixed(1)}px) scale(${(1 + (1 - vis) * .03).toFixed(3)})`;
        s.setAttribute("aria-hidden", vis < .5 ? "true" : "false");
      });
      bars.forEach((b, i) => b.style.setProperty("--fill", clamp(t - i).toFixed(3)));
      gl.viewport(0, 0, w, h);
      gl.useProgram(P.p); gl.bindVertexArray(fsVAO);
      gl.uniform2f(P.u.uRes, w, h); gl.uniform1f(P.u.uTime, now); gl.uniform2f(P.u.uMouse, mouse.x, mouse.y);
      gl.uniform1i(P.u.uA, a); gl.uniform1i(P.u.uB, Math.min(n - 1, a + 1)); gl.uniform1f(P.u.uMix, mix);
      gl.uniform1f(P.u.uZoom, 1 + .05 * (lt < .72 ? lt / .72 : 1 - mix));
      gl.uniform1f(P.u.uPlay, 0); gl.uniform1f(P.u.uShutter, 1 / 50); gl.uniform1f(P.u.uAperture, 2.8); gl.uniform1f(P.u.uISO, 800);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
  })();

  /* ---------- settings playground (Lions Gate at night) ---------- */
  (function playground() {
    const sec = document.querySelector(".play");
    if (!sec) return;
    const cv = sec.querySelector(".play-gl");
    const SH = [25, 50, 100, 250, 500, 1000, 2000], AP = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16], ISO = [100, 200, 400, 800, 1600, 3200, 6400, 12800];
    const sS = sec.querySelector("#sShutter"), sA = sec.querySelector("#sAperture"), sI = sec.querySelector("#sIso");
    const out = { s: sec.querySelector('[data-out="shutter"]'), a: sec.querySelector('[data-out="aperture"]'), i: sec.querySelector('[data-out="iso"]') };
    const note = { s: sec.querySelector('[data-note="shutter"]'), a: sec.querySelector('[data-note="aperture"]'), i: sec.querySelector('[data-note="iso"]') };
    const meter = sec.querySelector("[data-meter]"), read = sec.querySelector("[data-exposure]");
    const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1)).toString();
    const state = { sh: 1 / 50, ap: 2.8, iso: 800 };
    function ui() {
      const sh = SH[sS.value], ap = AP[sA.value], iso = ISO[sI.value];
      state.sh = 1 / sh; state.ap = ap; state.iso = iso;
      out.s.textContent = `1/${sh}`; out.a.textContent = `f/${ap}`; out.i.textContent = iso;
      const stops = Math.log2((50 / sh) * (16 / (ap * ap)) * (iso / 800));
      meter.style.left = `calc(${50 + (clamp(stops, -3, 3) / 3) * 50}% - 2px)`;
      const r = Math.round(stops * 3) / 3;
      read.textContent = Math.abs(r) < .2 ? "Exposure is spot on." : r > 0 ? `Too bright by ${fmt(r)} stop${Math.abs(r) > 1 ? "s" : ""}.` : `Too dark by ${fmt(-r)} stop${Math.abs(r) > 1 ? "s" : ""}.`;
      note.s.textContent = sh <= 25 ? "Slow: car lights smear into long trails." : sh === 50 ? "Double the frame rate at 24 fps. Motion looks natural, like cinema." : sh <= 250 ? "Faster: shorter trails, a crisper look." : "Very fast: lights freeze into points.";
      note.a.textContent = ap <= 2 ? "Wide open: far streetlights bloom into big soft discs." : ap <= 4 ? "Balanced: soft discs, plenty of light." : ap <= 8 ? "Narrower: discs shrink, the frame darkens." : "Pinhole: lights stay sharp points, very little light gets in.";
      note.i.textContent = iso <= 200 ? "Cleanest image. Needs plenty of light." : iso <= 800 ? "A good everyday range." : iso <= 3200 ? "Brighter in the dark, with a little grain." : "Very sensitive. Visible grain shows up.";
    }
    [sS, sA, sI].forEach((el) => el.addEventListener("input", ui)); ui();
    const K = makeGL(cv);
    if (!K) { sec.classList.add("no-webgl"); return; }
    const { gl, fsVAO } = K;
    const P = program(gl, VS_FULL, COAST_FS);
    const SZ = sizer(cv, 3.2e5, 2);
    loopWhileVisible(sec, (now, dt) => {
      SZ.tick(dt);
      const { w, h } = SZ.fit();
      gl.viewport(0, 0, w, h);
      gl.useProgram(P.p); gl.bindVertexArray(fsVAO);
      gl.uniform2f(P.u.uRes, w, h); gl.uniform1f(P.u.uTime, now); gl.uniform2f(P.u.uMouse, 0, 0);
      gl.uniform1i(P.u.uA, 2); gl.uniform1i(P.u.uB, 2); gl.uniform1f(P.u.uMix, 0); gl.uniform1f(P.u.uZoom, 1);
      gl.uniform1f(P.u.uPlay, 1); gl.uniform1f(P.u.uShutter, state.sh); gl.uniform1f(P.u.uAperture, state.ap); gl.uniform1f(P.u.uISO, state.iso);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
  })();
})();
