/* FX3 studio — a small purpose-built WebGL2 renderer.
   Procedural geometry, strip-softbox reflections, exploded view, inspector. */
(() => {
  const stage = document.querySelector(".studio");
  if (!stage) return;
  const canvas = stage.querySelector(".studio-canvas");
  const flareCv = stage.querySelector(".studio-flare");
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) { stage.classList.add("no-webgl"); return; }
  const fctx = flareCv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- math ---------------- */
  const PI = Math.PI;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const M = {
    I: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
    T(x, y, z) { const m = M.I(); m[12] = x; m[13] = y; m[14] = z; return m; },
    RX(a) { const m = M.I(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    RY(a) { const m = M.I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
    RZ(a) { const m = M.I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
    persp(fy, asp, n, f) { const m = new Float32Array(16), t = 1 / Math.tan(fy / 2); m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m; },
    look(e, c, up) {
      const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
    },
    xp(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; },
    xv(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]]; },
    chain(...ms) { return ms.reduce((a, b) => M.mul(a, b)); },
  };

  /* ---------------- geometry ---------------- */
  const G = () => ({ p: [], n: [], t: [], uv: [], i: [] });
  function V(g, p, n, t, uv) { g.p.push(p[0], p[1], p[2]); g.n.push(n[0], n[1], n[2]); g.t.push(t[0], t[1], t[2]); g.uv.push(uv[0], uv[1]); return g.p.length / 3 - 1; }

  // Rounded box with true radius edges and smooth normals.
  function rbox(w, h, d, r, seg = 5) {
    const g = G(), H = [w / 2, h / 2, d / 2];
    r = Math.min(r, H[0] * .999, H[1] * .999, H[2] * .999);
    const coords = (A) => {
      const e = A - r, L = [];
      for (let k = seg; k >= 1; k--) L.push(-(e + r * Math.tan(k / seg * PI / 4)));
      L.push(-e, e);
      for (let k = 1; k <= seg; k++) L.push(e + r * Math.tan(k / seg * PI / 4));
      return L;
    };
    const C = [coords(H[0]), coords(H[1]), coords(H[2])];
    const faces = [[0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0]];
    for (const [na, s, ua, va] of faces) {
      const U = C[ua], W = C[va], m = U.length, mv = W.length, base = g.p.length / 3;
      for (let i = 0; i < m; i++) for (let j = 0; j < mv; j++) {
        const q = [0, 0, 0]; q[na] = s * H[na]; q[ua] = U[i]; q[va] = W[j];
        const inner = q.map((x, k) => clamp(x, -(H[k] - r), H[k] - r));
        let dv = q.map((x, k) => x - inner[k]); const L = Math.hypot(dv[0], dv[1], dv[2]) || 1; dv = dv.map((x) => x / L);
        const t = [0, 0, 0]; t[ua] = 1;
        V(g, inner.map((x, k) => x + dv[k] * r), dv, t, [i / (m - 1), j / (mv - 1)]);
      }
      for (let i = 0; i < m - 1; i++) for (let j = 0; j < mv - 1; j++) {
        const a = base + i * mv + j, b = base + (i + 1) * mv + j, c = b + 1, d2 = a + 1;
        g.i.push(a, b, c, a, c, d2);
      }
    }
    return g;
  }

  // Surface of revolution around +z. Profile is [[r, z], ...] from back to front.
  function lathe(prof, segs = 72, smoothDeg = 38) {
    const g = G(), sn = [];
    for (let k = 0; k < prof.length - 1; k++) {
      const dr = prof[k + 1][0] - prof[k][0], dz = prof[k + 1][1] - prof[k][1], l = Math.hypot(dr, dz) || 1;
      sn.push([dz / l, -dr / l]);
    }
    const ct = Math.cos(smoothDeg * PI / 180);
    const nAt = (k, end) => {
      const n = sn[k], nb = end ? sn[k + 1] : sn[k - 1];
      if (nb && n[0] * nb[0] + n[1] * nb[1] > ct) { const a = [n[0] + nb[0], n[1] + nb[1]], l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l]; }
      return n;
    };
    let tot = 0; const acc = [0];
    for (let k = 0; k < prof.length - 1; k++) { tot += Math.hypot(prof[k + 1][0] - prof[k][0], prof[k + 1][1] - prof[k][1]); acc.push(tot); }
    for (let k = 0; k < prof.length - 1; k++) {
      const base = g.p.length / 3;
      for (const e of [0, 1]) {
        const [r, z] = prof[k + e], [nr, nz] = nAt(k, e), v = acc[k + e] / tot;
        for (let s = 0; s <= segs; s++) {
          const a = s / segs * PI * 2, c = Math.cos(a), si = Math.sin(a);
          V(g, [r * c, r * si, z], [nr * c, nr * si, nz], [-si, c, 0], [s / segs, v]);
        }
      }
      for (let s = 0; s < segs; s++) { const a = base + s, b = a + 1, c = base + segs + 2 + s, d = base + segs + 1 + s; g.i.push(a, b, c, a, c, d); }
    }
    return g;
  }

  // A flat rectangle facing +z (for displays and sensor dies).
  function quad(w, h) {
    const g = G();
    V(g, [-w / 2, -h / 2, 0], [0, 0, 1], [1, 0, 0], [0, 0]); V(g, [w / 2, -h / 2, 0], [0, 0, 1], [1, 0, 0], [1, 0]);
    V(g, [w / 2, h / 2, 0], [0, 0, 1], [1, 0, 0], [1, 1]); V(g, [-w / 2, h / 2, 0], [0, 0, 1], [1, 0, 0], [0, 1]);
    g.i.push(0, 1, 2, 0, 2, 3); return g;
  }

  function xf(g, m) {
    for (let k = 0; k < g.p.length; k += 3) {
      const p = M.xp(m, [g.p[k], g.p[k + 1], g.p[k + 2]]), n = norm(M.xv(m, [g.n[k], g.n[k + 1], g.n[k + 2]])), t = norm(M.xv(m, [g.t[k], g.t[k + 1], g.t[k + 2]]));
      g.p[k] = p[0]; g.p[k + 1] = p[1]; g.p[k + 2] = p[2]; g.n[k] = n[0]; g.n[k + 1] = n[1]; g.n[k + 2] = n[2]; g.t[k] = t[0]; g.t[k + 1] = t[1]; g.t[k + 2] = t[2];
    }
    return g;
  }
  const at = (g, x, y, z, ...rot) => xf(g, M.chain(M.T(x, y, z), ...(rot.length ? rot : [M.I()])));
  // A cylinder (lathe) whose axis points along +y or +x instead of +z
  const upY = M.RX(-PI / 2), alongX = M.RY(PI / 2);

  /* ---------------- materials ---------------- */
  const lin = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map((c) => Math.pow(c, 2.2)); };
  const MAT = {
    body:   { base: lin("#34353a"), metal: 0, rough: .42, pat: 8 },
    bodyDk: { base: lin("#17181a"), metal: 0, rough: .52, pat: 8 },
    rubber: { base: lin("#141416"), metal: 0, rough: .78, pat: 4 },
    vent:   { base: lin("#030303"), metal: 0, rough: .9, pat: 0 },
    alloy:  { base: lin("#c9ccd1"), metal: 1, rough: .26, pat: 3 },
    steel:  { base: lin("#8d9198"), metal: 1, rough: .32, pat: 3 },
    gold:   { base: lin("#d6a74a"), metal: 1, rough: .28, pat: 0 },
    lensBody: { base: lin("#1c1d20"), metal: 0, rough: .5, pat: 8 },
    knurl:  { base: lin("#141518"), metal: 0, rough: .62, pat: 1, knurl: 220 },
    dial:   { base: lin("#3a3c41"), metal: 1, rough: .34, pat: 2, knurl: 60 },
    glass:  { base: lin("#020306"), metal: 0, rough: .04, pat: 5 },
    element:{ base: lin("#0a1020"), metal: 0, rough: .03, pat: 5 },
    sensor: { base: lin("#101315"), metal: 0, rough: .12, pat: 6 },
    ceramic:{ base: lin("#26262a"), metal: 0, rough: .4, pat: 0 },
    screen: { base: lin("#020202"), metal: 0, rough: .08, pat: 7 },
    red:    { base: lin("#b3140c"), metal: 0, rough: .3, pat: 0 },
    tally:  { base: lin("#3a0604"), metal: 0, rough: .1, pat: 10 },
    hole:   { base: lin("#050505"), metal: 0, rough: .8, pat: 0 },
    label:  { base: lin("#8f9196"), metal: 0, rough: .5, pat: 0 },
    fan:    { base: lin("#1f2023"), metal: 0, rough: .42, pat: 0 },
  };

  /* ---------------- model ---------------- */
  // Units: cm. x right, y up, z toward the subject (lens points +z).
  const MOUNT_C = [1.0, -0.35];
  const meshes = [];
  const add$ = (part, mat, g) => meshes.push({ part, mat, g });

  // Body shell
  add$("body", MAT.body, rbox(12.9, 7.6, 4.4, .6, 6));
  // Grip (operator's right)
  add$("body", MAT.rubber, at(rbox(3.3, 7.5, 3.1, 1.25, 6), -4.8, -0.05, 2.95));
  add$("body", MAT.bodyDk, at(rbox(3.4, .5, 3.2, .22, 3), -4.8, 3.62, 2.95));
  // Front mount housing
  add$("body", MAT.bodyDk, at(lathe([[0, -.1], [3.3, -.1], [3.3, .12], [3.12, .3], [0, .3]], 80), MOUNT_C[0], MOUNT_C[1], 2.05));
  // Top: record button on grip, zoom collar, rear dial, shoe, threads
  add$("body", MAT.red, at(lathe([[0, 0], [.62, 0], [.62, .22], [.48, .3], [0, .3]], 48), -4.6, 3.86, 3.4, upY));
  add$("body", MAT.dial, at(lathe([[0, 0], [.42, 0], [.42, .36], [0, .36]], 48), -4.6, 4.08, 3.4, upY));
  add$("body", MAT.dial, at(lathe([[0, 0], [.95, 0], [.95, .32], [.82, .42], [0, .42]], 64), 4.1, 3.78, -1.25, upY));
  add$("body", MAT.alloy, at(rbox(2.3, .22, 2.2, .06, 2), .9, 3.86, .2));
  add$("body", MAT.bodyDk, at(rbox(2.0, .14, 1.9, .05, 2), .9, 3.98, .2));
  const threads = [[-2.4, .9], [3.7, .9], [-2.4, -1.4]];
  for (const [x, z] of threads) {
    add$("body", MAT.steel, at(lathe([[0, -.05], [.42, -.05], [.42, .02], [0, .02]], 40), x, 3.8, z, upY));
    add$("body", MAT.hole, at(lathe([[0, -.04], [.27, -.04], [.27, .03], [0, .03]], 32), x, 3.82, z, upY));
  }
  // Tally lamps (front top right, rear)
  add$("tally", MAT.tally, at(rbox(.6, .32, .12, .1, 3), 5.15, 3.05, 2.22));
  add$("tally", MAT.tally, at(rbox(.6, .32, .12, .1, 3), 4.7, 3.2, -2.22));
  // Cooling exhaust on the side opposite the grip
  for (let k = 0; k < 8; k++) add$("body", MAT.vent, at(rbox(.16, 4.4, .22, .08, 2), 6.42, .1, -1.4 + k * .4));
  add$("body", MAT.bodyDk, at(rbox(.12, 5.0, 3.2, .1, 2), 6.38, .1, 0));
  // Side ports panel (grip side) and media door seam
  add$("body", MAT.bodyDk, at(rbox(.12, 3.6, 2.2, .2, 3), -6.42, -.5, -.3));
  // Bottom thread
  add$("body", MAT.steel, at(lathe([[0, -.05], [.45, -.05], [.45, .02], [0, .02]], 40), MOUNT_C[0], -3.82, 0, M.RX(PI / 2)));

  // Mount: brushed alloy bayonet ring with contacts
  add$("mount", MAT.alloy, at(lathe([[2.32, 0], [2.95, 0], [2.95, .3], [2.75, .38], [2.32, .38], [2.32, 0]], 96, 30), MOUNT_C[0], MOUNT_C[1], 2.32));
  for (let k = 0; k < 3; k++) {
    const a = k * 2 * PI / 3 + .4;
    add$("mount", MAT.alloy, at(rbox(1.6, .3, .12, .05, 2), MOUNT_C[0] + Math.cos(a) * 2.18, MOUNT_C[1] + Math.sin(a) * 2.18, 2.5, M.RZ(a + PI / 2)));
  }
  for (let k = 0; k < 10; k++) add$("mount", MAT.gold, at(rbox(.16, .2, .06, .03, 1), MOUNT_C[0] - .9 + k * .2, MOUNT_C[1] - 2.0, 2.48));

  // Sensor package: IBIS plate, ceramic carrier, die
  add$("sensor", MAT.steel, at(rbox(6.0, 4.9, .22, .3, 3), MOUNT_C[0], MOUNT_C[1], 1.2));
  add$("sensor", MAT.ceramic, at(rbox(4.6, 3.6, .28, .18, 3), MOUNT_C[0], MOUNT_C[1], 1.44));
  add$("sensor", MAT.gold, at(rbox(4.2, 3.2, .04, .05, 1), MOUNT_C[0], MOUNT_C[1], 1.59));
  add$("sensor", MAT.sensor, at(quad(3.56, 2.38), MOUNT_C[0], MOUNT_C[1], 1.62));

  // Lens (a fast standard prime): mount flange, barrel, knurled focus ring, front lip
  const lensProf = [
    [2.25, 2.68], [2.75, 2.68], [2.75, 3.05], [3.05, 3.15], [3.1, 4.3],
    [3.0, 4.35], [3.0, 4.6], [3.26, 4.62], [3.26, 7.9], [3.0, 7.92], [3.0, 8.2],
    [3.12, 8.25], [3.18, 10.6], [3.32, 10.75], [3.32, 11.25], [3.2, 11.32], [2.72, 11.32], [2.66, 11.05],
  ];
  add$("lens", MAT.lensBody, at(lathe(lensProf.slice(0, 7), 96, 30), MOUNT_C[0], MOUNT_C[1], 0));
  add$("lens", MAT.knurl, at(lathe([[3.0, 4.6], [3.26, 4.62], [3.26, 7.9], [3.0, 7.92]], 192, 30), MOUNT_C[0], MOUNT_C[1], 0));
  add$("lens", MAT.lensBody, at(lathe(lensProf.slice(9), 96, 30), MOUNT_C[0], MOUNT_C[1], 0));
  add$("lens", MAT.alloy, at(lathe([[2.76, 2.6], [2.9, 2.6], [2.9, 2.72], [2.76, 2.72]], 96), MOUNT_C[0], MOUNT_C[1], 0));
  add$("lens", MAT.label, at(rbox(.08, .5, .08, .02, 1), MOUNT_C[0], MOUNT_C[1] + 3.13, 4.0));
  // Front element: coated dome
  const dome = []; for (let k = 0; k <= 16; k++) { const a = k / 16; dome.push([2.66 * Math.cos(a * PI / 2) , 11.0 + .38 * Math.sin(a * PI / 2)]); }
  add$("lens", MAT.glass, at(lathe(dome, 96, 80), MOUNT_C[0], MOUNT_C[1], 0));

  // Internal glass elements (pulled out in the exploded view)
  const element = (R, th) => { const pr = []; for (let k = 0; k <= 12; k++) { const a = k / 12; pr.push([R * Math.sin(a * PI / 2), -th / 2 * Math.cos(a * PI / 2) - .06]); } for (let k = 12; k >= 0; k--) { const a = k / 12; pr.push([R * Math.sin(a * PI / 2), th / 2 * Math.cos(a * PI / 2) + .06]); } return lathe(pr, 80, 80); };
  add$("elements", MAT.element, at(element(2.45, .7), MOUNT_C[0], MOUNT_C[1], 5.2));
  add$("elements", MAT.element, at(element(2.25, .5), MOUNT_C[0], MOUNT_C[1], 7.0));
  add$("elements", MAT.element, at(element(2.05, .9), MOUNT_C[0], MOUNT_C[1], 8.9));
  for (const z of [5.2, 7.0, 8.9]) add$("elements", MAT.steel, at(lathe([[2.0, -.12], [2.6, -.12], [2.6, .12], [2.0, .12]], 80), MOUNT_C[0], MOUNT_C[1], z));

  // Rear screen
  add$("screen", MAT.bodyDk, at(rbox(7.9, 5.6, .55, .35, 4), .55, -.35, -2.55));
  add$("screen", MAT.screen, at(xf(quad(6.6, 4.95), M.RY(PI)), .55, -.35, -2.84));
  add$("screen", MAT.steel, at(rbox(.3, 3.8, .45, .1, 2), 4.45, -.35, -2.5));

  // Cooling fan (sits behind the exhaust)
  add$("fan", MAT.bodyDk, at(lathe([[2.0, -.45], [2.2, -.45], [2.2, .45], [2.0, .45], [2.0, -.45]], 72, 30), 0, 0, 0));
  add$("fanRotor", MAT.fan, at(lathe([[0, -.35], [.72, -.35], [.72, .32], [0, .38]], 48), 0, 0, 0));
  for (let k = 0; k < 11; k++) add$("fanRotor", MAT.fan, xf(rbox(1.25, .5, .08, .03, 1), M.chain(M.RZ(k * 2 * PI / 11), M.T(1.35, 0, 0), M.RX(.55))));
  // move fan geometry so its axis is x, centred inside the body
  for (const m of meshes) if (m.part === "fan" || m.part === "fanRotor") xf(m.g, M.chain(M.T(4.3, .1, 0), alongX));

  // XLR top handle
  add$("handle", MAT.body, at(rbox(2.1, 1.7, 9.0, .8, 5), .9, 6.55, 1.0));
  add$("handle", MAT.rubber, at(rbox(2.15, .9, 5.0, .44, 4), .9, 7.15, .2));
  add$("handle", MAT.body, at(rbox(1.7, 2.4, 1.5, .4, 4), .9, 4.95, .2));
  add$("handle", MAT.body, at(rbox(4.0, 2.7, 2.4, .5, 5), .9, 5.05, 3.75));
  add$("handle", MAT.alloy, at(rbox(1.9, .25, 1.8, .06, 2), .9, 4.05, .2));
  for (const x of [-.05, 1.85]) {
    add$("handle", MAT.alloy, at(lathe([[0, 0], [.92, 0], [.92, .14], [.8, .2], [.7, .2], [.7, .05], [0, .05]], 64), x, 4.95, 4.95));
    add$("handle", MAT.hole, at(lathe([[0, 0], [.7, 0], [.7, .06], [0, .06]], 48), x, 4.95, 4.96));
    for (let k = 0; k < 3; k++) { const a = PI / 2 + k * 2 * PI / 3; add$("handle", MAT.alloy, at(lathe([[0, 0], [.13, 0], [.13, .1], [0, .1]], 16), x + Math.cos(a) * .36, 4.95 + Math.sin(a) * .36, 5.0)); }
    add$("handle", MAT.dial, at(lathe([[0, 0], [.42, 0], [.42, .5], [.36, .56], [0, .56]], 48), x, 6.4, 4.3, upY));
  }

  // Battery (slides out of the grip)
  add$("battery", MAT.bodyDk, at(rbox(2.3, 5.0, 3.6, .3, 3), -4.8, -.9, 2.0));
  add$("battery", MAT.label, at(rbox(2.32, 1.2, 3.62, .2, 2), -4.8, .5, 2.0));
  add$("battery", MAT.gold, at(rbox(.8, .06, .5, .02, 1), -4.8, 1.62, 2.4));

  /* ---------------- parts & explode choreography ---------------- */
  const PARTS = {
    body:     { off: [0, 0, 0], delay: 0 },
    tally:    { off: [0, 0, 0], delay: 0 },
    handle:   { off: [0, 3.4, -.6], delay: 0 },
    lens:     { off: [0, 0, 6.2], delay: .04 },
    elements: { off: [0, 6.6, 6.2], delay: .2 },
    mount:    { off: [0, 0, 3.6], delay: .1 },
    sensor:   { off: [0, 0, 1.9], delay: .18 },
    screen:   { off: [0, 0, -4.4], delay: .08, swing: [4.45, -2.5, .5] },
    fan:      { off: [5.8, 0, 0], delay: .16 },
    fanRotor: { off: [5.8, 0, 0], delay: .16, spin: true },
    battery:  { off: [-4.6, -3.2, 0], delay: .22 },
  };

  /* ---------------- GPU upload ---------------- */
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };

  const VS = `#version 300 es
  layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aT; layout(location=3) in vec2 aUV;
  uniform mat4 uVP, uM;
  out vec3 vW, vN, vT; out vec2 vUV;
  void main(){ vec4 w = uM * vec4(aP,1.); vW = w.xyz; vN = mat3(uM) * aN; vT = mat3(uM) * aT; vUV = aUV; gl_Position = uVP * w; }`;

  const FS = `#version 300 es
  precision highp float;
  in vec3 vW, vN, vT; in vec2 vUV; out vec4 o;
  uniform vec3 uCam, uBase, uEmis;
  uniform float uMetal, uRough, uKnurl, uExposure, uDim, uTally, uTime;
  uniform int uPat;
  uniform vec3 uSL[5], uST[5], uSC[5]; uniform vec2 uSS[5];
  float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
  float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float strip(vec3 d, int k, float r){
    vec3 L = uSL[k], T = uST[k]; vec3 B = cross(L, T);
    float fl = dot(d, L); if (fl <= 0.) return 0.;
    float hl = uSS[k].x, hw = uSS[k].y;
    float w = hw + r*r*1.1, wl = hl + r*r*1.1;
    float a = 1. - smoothstep(hw*.35, w, abs(dot(d, B)));
    float b = 1. - smoothstep(hl*.8, wl, abs(dot(d, T)));
    return a * b * (hw / w) * smoothstep(0., .25, fl);
  }
  vec3 envSpec(vec3 d, float r){
    vec3 c = vec3(.0035) + vec3(.012) * smoothstep(-.1, .9, d.y) * (1. - r*.5);
    c += vec3(.02, .021, .024) * smoothstep(.0, -.6, d.y) * .5;
    for (int k = 0; k < 5; k++) c += uSC[k] * strip(d, k, r);
    return c;
  }
  vec3 envDiff(vec3 n){
    vec3 c = vec3(.012) + vec3(.02) * max(n.y, 0.);
    for (int k = 0; k < 5; k++) c += uSC[k] * uSS[k].x * uSS[k].y * 1.6 * max(dot(n, uSL[k]), 0.);
    return c;
  }
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
  void main(){
    vec3 N = normalize(vN), T = normalize(vT - N*dot(vT, normalize(vN)));
    vec3 Vd = normalize(uCam - vW);
    if (dot(N, Vd) < -.2) N = -N;
    vec3 base = uBase; float rough = uRough; float metal = uMetal; vec3 emis = uEmis;
    vec3 specTint = vec3(1.);
    if (uPat == 1) { // straight knurl (focus ring)
      float ph = vUV.x * uKnurl * 6.28318;
      float edge = smoothstep(0., .04, vUV.y) * smoothstep(1., .96, vUV.y);
      N = normalize(N + T * cos(ph) * .55 * edge);
      base *= .7 + .3 * (.5 + .5 * sin(ph));
    } else if (uPat == 2) { // diamond knurl (dials)
      float ph = vUV.x * uKnurl * 6.28318; vec3 Bt = cross(N, T);
      N = normalize(N + T * cos(ph) * .35 + Bt * cos(vUV.y * 90.) * .12);
    } else if (uPat == 3) { // spun / brushed alloy
      float s = n3(vec3(vUV.y * 900., vUV.x * 6., 0.));
      rough = clamp(rough + (s - .5) * .12, .05, 1.);
      base *= .92 + .1 * s;
    } else if (uPat == 4) { // pebbled rubber
      vec3 q = vW * 26.;
      N = normalize(N + (vec3(n3(q), n3(q + 7.1), n3(q + 13.7)) - .5) * .42);
      rough = clamp(rough + (n3(q * 2.) - .5) * .2, .3, 1.);
    } else if (uPat == 5) { // multi-coated glass
      float c = clamp(dot(N, Vd), 0., 1.);
      specTint = mix(vec3(.5, .55, 1.3), vec3(.7, 1.0, .72), smoothstep(.15, .95, c)) * 1.25;
      float rr = vUV.y;
      emis += vec3(.004, .005, .012) * (.5 + .5 * cos(rr * 30.)) * (1. - rr);
    } else if (uPat == 6) { // sensor die: thin-film colour
      float c = clamp(dot(N, Vd), 0., 1.);
      vec3 tint = .5 + .5 * cos(6.28318 * (c * 1.8 + vUV.x * .9 + vUV.y * .6 + vec3(0., .33, .67)));
      base = tint * .05; specTint = tint * 1.8;
      float g = step(.9, fract(vUV.x * 180.)) + step(.9, fract(vUV.y * 120.));
      emis += tint * .006 * g;
    } else if (uPat == 7) { // live view on the rear screen
      vec2 u = vUV;
      vec3 sky = mix(vec3(.85, .55, .38), vec3(.16, .28, .5), smoothstep(.3, 1., u.y));
      float m = .38 + .09 * sin(u.x * 8. + 1.) + .05 * sin(u.x * 21.);
      vec3 img = u.y < m ? vec3(.04, .055, .08) * (1. + u.y) : sky;
      vec2 f = abs(u - .5);
      float frame = step(.47, max(f.x, f.y)) * (1. - step(.49, max(f.x, f.y)));
      img = mix(img, vec3(.9), frame * .4);
      float rec = 1. - smoothstep(.012, .018, length(u - vec2(.07, .91)));
      img = mix(img, vec3(1., .1, .06), rec * (.4 + .6 * uTally));
      emis += img * .55;
    } else if (uPat == 8) { // powder-coated magnesium
      rough = clamp(rough + (n3(vW * 70.) - .5) * .1, .05, 1.);
    } else if (uPat == 10) { // tally lamp
      emis += vec3(1., .08, .04) * uTally * 3.2;
    }
    float NoV = clamp(dot(N, Vd), 1e-3, 1.);
    vec3 F0 = mix(vec3(.04), base, metal);
    vec3 F = F0 + (max(vec3(1. - rough), F0) - F0) * pow(1. - NoV, 5.);
    vec3 R = reflect(-Vd, N);
    vec3 spec = envSpec(R, rough) * F * specTint * (1. - rough * .45);
    vec3 diff = base * (1. - metal) * envDiff(N) * (1. - F);
    float ao = .55 + .45 * smoothstep(-1., .6, N.y);
    vec3 col = (diff * ao + spec) * uDim + emis;
    col = aces(col * uExposure);
    o = vec4(pow(col, vec3(1. / 2.2)), 1.);
  }`;

  const P = prog(VS, FS);
  const U = {}; for (const n of ["uVP", "uM", "uCam", "uBase", "uEmis", "uMetal", "uRough", "uKnurl", "uExposure", "uDim", "uTally", "uTime", "uPat", "uSL", "uST", "uSC", "uSS"]) U[n] = gl.getUniformLocation(P, n);

  function upload(g) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = (data, loc, size) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
    buf(g.p, 0, 3); buf(g.n, 1, 3); buf(g.t, 2, 3); buf(g.uv, 3, 2);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(g.i), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: g.i.length };
  }
  const drawables = meshes.map((m) => ({ ...upload(m.g), part: m.part, mat: m.mat }));

  // Glow sprites (tally bloom) and the soft floor shadow
  const PS = prog(`#version 300 es
  layout(location=0) in vec2 aQ; uniform mat4 uVP; uniform vec3 uC, uR, uU; uniform float uS; out vec2 vQ;
  void main(){ vQ = aQ; vec3 w = uC + (uR * aQ.x + uU * aQ.y) * uS; gl_Position = uVP * vec4(w, 1.); }`,
  `#version 300 es
  precision highp float; in vec2 vQ; uniform vec3 uCol; uniform float uA; out vec4 o;
  void main(){ float d = length(vQ); float a = exp(-d*d*9.) * .9 + exp(-d*d*1.6) * .25; a *= uA * (1. - smoothstep(.85, 1., d)); o = vec4(uCol * a, a); }`);
  const PU = { vp: gl.getUniformLocation(PS, "uVP"), c: gl.getUniformLocation(PS, "uC"), r: gl.getUniformLocation(PS, "uR"), u: gl.getUniformLocation(PS, "uU"), s: gl.getUniformLocation(PS, "uS"), col: gl.getUniformLocation(PS, "uCol"), a: gl.getUniformLocation(PS, "uA") };
  const SH = prog(`#version 300 es
  layout(location=0) in vec2 aQ; uniform mat4 uVP; uniform vec4 uF; out vec2 vQ;
  void main(){ vQ = aQ; gl_Position = uVP * vec4(uF.x + aQ.x * uF.z, uF.y, aQ.y * uF.w + 1.5, 1.); }`,
  `#version 300 es
  precision highp float; in vec2 vQ; uniform float uA; out vec4 o;
  void main(){ float d = length(vQ); float a = (1. - smoothstep(.0, 1., d)); a = a*a*uA; o = vec4(0., 0., 0., a); }`);
  const SU = { vp: gl.getUniformLocation(SH, "uVP"), f: gl.getUniformLocation(SH, "uF"), a: gl.getUniformLocation(SH, "uA") };
  const quadVAO = gl.createVertexArray(); gl.bindVertexArray(quadVAO);
  const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);

  /* ---------------- studio lights (strip softboxes) ---------------- */
  const strips = (keyDir) => {
    const up = [0, 1, 0];
    const vert = (L) => norm(sub(up, scl(L, dot(up, L))));
    const S = [
      { L: keyDir, T: vert(keyDir), s: [.5, .17], c: [5.2, 5.0, 4.8] },                         // key: tall softbox front-left
      { L: norm([.86, .22, -.46]), T: vert(norm([.86, .22, -.46])), s: [.62, .045], c: [9, 9.6, 10.5] }, // hard rim right
      { L: norm([-.84, .18, -.5]), T: vert(norm([-.84, .18, -.5])), s: [.55, .05], c: [5.5, 5.6, 6] },  // rim left
      { L: [0, 1, 0], T: [1, 0, 0], s: [.7, .32], c: [1.6, 1.6, 1.7] },                             // overhead
      { L: norm([.35, -.15, 1]), T: [1, 0, 0], s: [.6, .1], c: [.35, .35, .38] },                     // low fill card
    ];
    return { L: S.flatMap((x) => x.L), T: S.flatMap((x) => x.T), C: S.flatMap((x) => x.c), S: S.flatMap((x) => x.s) };
  };

  /* ---------------- interaction state ---------------- */
  const VIEWS = {
    overview: { yaw: .72, pitch: .26, dist: 50, target: () => lerp3([.6, 1.9, 2.8], [.6, 2.6, 3.6], E) },
    top:      { yaw: .35, pitch: 1.2, dist: 48, target: () => lerp3([.6, 1, 1.6], [.8, 1.5, 3.4], E) },
    mount:    { yaw: 1.0, pitch: .3, dist: 40, target: () => partPos("mount", [MOUNT_C[0], MOUNT_C[1], 2.4]) },
    cooling:  { yaw: 1.3, pitch: .2, dist: 40, target: () => partPos("fan", [4.3, .1, 0]) },
    rear:     { yaw: 2.6, pitch: .22, dist: 34, target: () => partPos("screen", [.55, -.35, -2.6]) },
  };
  const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  let view = "overview";
  let E = 0, Etarget = 0;
  const cam = { yaw: VIEWS.overview.yaw, pitch: VIEWS.overview.pitch, dist: 50, target: [.6, 1.9, 2.8] };
  const goal = { yaw: cam.yaw, pitch: cam.pitch };
  let tally = true, fan = true, fanAngle = 0, fanSpeed = 1;
  let active = null;
  let cursor = [.32, .24], cursorGoal = [.32, .24];
  let lastInput = 0;

  const partE = (name) => { const p = PARTS[name]; return ease(clamp((E - p.delay) / (1 - .25), 0, 1)); };
  function partMatrix(name) {
    const p = PARTS[name], e = partE(name);
    let m = M.T(p.off[0] * e, p.off[1] * e, p.off[2] * e);
    if (p.swing) { const [hx, hz, ang] = p.swing; m = M.chain(m, M.T(hx, 0, hz), M.RY(ang * e), M.T(-hx, 0, -hz)); }
    if (p.spin) m = M.chain(m, M.T(4.3, .1, 0), M.RX(fanAngle), M.T(-4.3, -.1, 0));
    return m;
  }
  const partPos = (name, p) => M.xp(partMatrix(name), p);

  /* ---------------- hotspots ---------------- */
  const HOT = [
    { id: "lens", part: "lens", p: [MOUNT_C[0] + 1.6, MOUNT_C[1] + 1.6, 11.3], n: [0, 0, 1], title: "Optical path", lines: [["Mount", "Sony E-mount"], ["Flange back", "18 mm"], ["Image circle", "Full-frame, 35.6 × 23.8 mm"]] },
    { id: "elements", part: "elements", p: [MOUNT_C[0], MOUNT_C[1] + 2.45, 7.0], n: [0, 1, 0], min: .55, title: "Glass elements", lines: [["Role", "Focus light, cancel distortion"], ["Coating", "Multi-layer, cuts flare and ghosting"]] },
    { id: "mount", part: "mount", p: [MOUNT_C[0] + 2.1, MOUNT_C[1] + 2.1, 2.7], n: [.4, .4, .8], title: "E-mount", lines: [["Flange back", "18 mm"], ["Contacts", "Focus, aperture, lens data"], ["Lenses", "Any E-mount, full-frame or APS-C"]] },
    { id: "sensor", part: "sensor", p: [MOUNT_C[0] + 1.2, MOUNT_C[1] + .8, 1.65], n: [0, 0, 1], min: .45, title: "Exmor R CMOS", lines: [["Type", "Back-illuminated, full-frame"], ["Resolution", "12.1 MP stills / 10.2 MP video"], ["Dynamic range", "15+ stops (S-Log3)"], ["ISO", "80 to 102,400, expands to 409,600"], ["Stabilisation", "5-axis in-body + Active Mode"]] },
    { id: "cooling", part: "fan", p: [4.75, 1.6, 1.4], n: [1, 0, 0], min: .4, title: "Active cooling", lines: [["Fan", "Built in, behind the side exhaust"], ["Processor", "BIONZ XR"], ["Sustained", "4K 60p for hours, no overheat stop"]] },
    { id: "tally", part: "tally", p: [5.15, 3.05, 2.3], n: [0, 0, 1], title: "Tally lamps", lines: [["Position", "Front and rear"], ["State", "Red while recording"]] },
    { id: "handle", part: "handle", p: [-.05, 4.95, 5.1], n: [0, 0, 1], title: "XLR handle", lines: [["Inputs", "2 × XLR/TRS, 48 V phantom"], ["Aux", "3.5 mm stereo"], ["Audio", "Up to 24-bit, 4-channel"]] },
    { id: "rig", part: "body", p: [-2.4, 3.85, .9], n: [0, 1, 0], title: "Rigging points", lines: [["Threads", "5 × 1/4\"-20 on the body"], ["Result", "Mount accessories without a cage"]] },
    { id: "screen", part: "screen", p: [-1.8, 1.4, -2.85], n: [0, 0, -1], title: "Vari-angle screen", lines: [["Size", "3.0-inch touchscreen"], ["Resolution", "2.36 million dots"]] },
    { id: "record", part: "battery", p: [-4.8, -2.2, 3.82], n: [0, 0, 1], min: .45, title: "Recording", lines: [["Video", "4K up to 120p, 10-bit 4:2:2"], ["RAW", "16-bit over HDMI, 4264 × 2408"], ["Media", "Dual CFexpress Type A / SD"], ["Weight", "715 g with battery and card"]] },
  ];
  const hotLayer = stage.querySelector(".hot-layer");
  const panel = stage.querySelector(".inspector");
  const lead = stage.querySelector(".lead");
  for (const h of HOT) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "hot"; b.dataset.id = h.id; b.setAttribute("aria-label", h.title);
    b.innerHTML = "<i></i><span>" + h.title + "</span>";
    b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse" && !pinnedSel) select(h.id); });
    b.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !pinnedSel) select(null); });
    b.addEventListener("focus", () => select(h.id));
    b.addEventListener("click", () => select(active === h.id ? null : h.id, true));
    hotLayer.appendChild(b); h.el = b;
  }
  let pinnedSel = false;
  function select(id, pin = false) {
    pinnedSel = pin && !!id;
    active = id;
    HOT.forEach((h) => h.el.classList.toggle("is-on", h.id === id));
    stage.classList.toggle("inspecting", !!id);
    if (!id) { panel.hidden = true; return; }
    const h = HOT.find((x) => x.id === id);
    panel.querySelector("h3").textContent = h.title;
    panel.querySelector("dl").innerHTML = h.lines.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    panel.hidden = false;
  }

  /* ---------------- controls ---------------- */
  const viewBtns = [...stage.querySelectorAll("[data-view]")];
  viewBtns.forEach((b) => b.addEventListener("click", () => {
    view = b.dataset.view; viewBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    goal.yaw = VIEWS[view].yaw; goal.pitch = VIEWS[view].pitch; lastInput = performance.now(); click();
  }));
  const tallyBtn = stage.querySelector("[data-toggle='tally']"), fanBtn = stage.querySelector("[data-toggle='fan']");
  tallyBtn.addEventListener("click", () => { tally = !tally; tallyBtn.setAttribute("aria-pressed", String(tally)); click(); });
  fanBtn.addEventListener("click", () => { fan = !fan; fanBtn.setAttribute("aria-pressed", String(fan)); click(); });

  let actx = null;
  function click() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = "square"; o.frequency.value = 2400; g.gain.setValueAtTime(.025, t); g.gain.exponentialRampToValueAtTime(.0001, t + .03);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .035);
    } catch (e) { /* audio is optional */ }
  }

  // Drag to orbit (horizontal drags only on touch, so vertical scroll still works)
  let drag = null, vel = 0;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, yaw: goal.yaw, pitch: goal.pitch, id: e.pointerId, moved: false }; vel = 0; });
  addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    cursorGoal = [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; canvas.setPointerCapture?.(e.pointerId); }
    const ny = drag.yaw + dx * .006;
    vel = ny - goal.yaw; goal.yaw = ny;
    if (e.pointerType === "mouse") goal.pitch = clamp(drag.pitch + dy * .004, -.2, 1.35);
    lastInput = performance.now();
  });
  const endDrag = () => { drag = null; };
  addEventListener("pointerup", endDrag); addEventListener("pointercancel", endDrag);

  /* ---------------- scroll scrub ---------------- */
  const readout = { sep: stage.querySelector("[data-r='sep']"), az: stage.querySelector("[data-r='az']"), el: stage.querySelector("[data-r='el']"), fan: stage.querySelector("[data-r='fan']") };
  const hint = stage.querySelector("[data-hint]");
  function onScroll() {
    const r = stage.getBoundingClientRect(), total = r.height - innerHeight;
    const p = clamp(-r.top / total);
    Etarget = clamp((p - .08) / .62);
  }
  addEventListener("scroll", onScroll, { passive: true });

  /* ---------------- render loop ---------------- */
  let W = 0, Hh = 0, dpr = 1;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, innerWidth < 760 ? 2 : 1.75);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr)); Hh = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = Hh; flareCv.width = W; flareCv.height = Hh;
  }
  addEventListener("resize", resize); resize(); onScroll();

  let last = performance.now(), VP = null, eye = [0, 0, 0];
  let visible = true, running = false;
  const kick = () => { if (!running && visible) { running = true; last = performance.now(); requestAnimationFrame(frame); } };
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; kick(); }, { rootMargin: "200px" }).observe(stage);

  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const k = (s) => reduce ? 1 : 1 - Math.exp(-dt * s);
    E += (Etarget - E) * k(5);
    if (!drag && Math.abs(vel) > 1e-4) { goal.yaw += vel; vel *= Math.pow(.02, dt); }
    if (!drag && view === "overview" && !reduce && now - lastInput > 5000) goal.yaw += dt * .05;
    cam.yaw += (goal.yaw - cam.yaw) * k(6); cam.pitch += (goal.pitch - cam.pitch) * k(6);
    const vw = VIEWS[view];
    const aspect = W / Hh, narrow = aspect < .9;
    const dGoal = vw.dist * (1 + (view === "overview" || view === "top" ? .42 * E : .12 * E)) * (narrow ? 1.75 : 1);
    cam.dist += (dGoal - cam.dist) * k(5);
    const tg = vw.target(); cam.target = lerp3(cam.target, tg, k(5));
    cursor = lerp3([...cursor, 0], [...cursorGoal, 0], k(3)).slice(0, 2);
    fanSpeed += ((fan ? 1 : 0) - fanSpeed) * k(1.5);
    fanAngle += dt * fanSpeed * 26;

    const cp = Math.cos(cam.pitch);
    eye = add(cam.target, scl([Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp], cam.dist));
    const proj = M.persp(26 * PI / 180, aspect, .5, 200);
    const viewM = M.look(eye, cam.target, [0, 1, 0]);
    VP = M.mul(proj, viewM);

    gl.viewport(0, 0, W, Hh);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // floor shadow
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(SH); gl.uniformMatrix4fv(SU.vp, false, VP);
    gl.uniform4f(SU.f, .6, -5.4 - E * 2.2, 11 + E * 4, 7 + E * 3); gl.uniform1f(SU.a, .75 - E * .25);
    gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLES, 0, 6);

    // model
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.useProgram(P);
    gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniform3fv(U.uCam, eye);
    gl.uniform1f(U.uExposure, 1.5); gl.uniform1f(U.uTally, tally ? 1 : 0); gl.uniform1f(U.uTime, now / 1000);
    // key softbox follows the cursor a little
    const key = norm([-.62 + (cursor[0] - .32) * 1.1, .58 - (cursor[1] - .24) * .8, .55]);
    const S = strips(key);
    gl.uniform3fv(U.uSL, S.L); gl.uniform3fv(U.uST, S.T); gl.uniform3fv(U.uSC, S.C); gl.uniform2fv(U.uSS, S.S);
    const activePart = active ? HOT.find((h) => h.id === active).part : null;
    const mats = {};
    for (const d of drawables) {
      const pm = mats[d.part] || (mats[d.part] = partMatrix(d.part));
      gl.uniformMatrix4fv(U.uM, false, pm);
      const m = d.mat;
      gl.uniform3fv(U.uBase, m.base); gl.uniform3fv(U.uEmis, [0, 0, 0]);
      gl.uniform1f(U.uMetal, m.metal); gl.uniform1f(U.uRough, m.rough); gl.uniform1f(U.uKnurl, m.knurl || 0); gl.uniform1i(U.uPat, m.pat);
      const same = !activePart || d.part === activePart || (activePart === "fan" && d.part === "fanRotor");
      gl.uniform1f(U.uDim, same ? 1 : .28);
      gl.bindVertexArray(d.vao); gl.drawElements(gl.TRIANGLES, d.count, gl.UNSIGNED_INT, 0);
    }

    // tally bloom
    const right = [viewM[0], viewM[4], viewM[8]], upv = [viewM[1], viewM[5], viewM[9]];
    if (tally) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.useProgram(PS); gl.uniformMatrix4fv(PU.vp, false, VP); gl.uniform3fv(PU.r, right); gl.uniform3fv(PU.u, upv);
      gl.bindVertexArray(quadVAO);
      const pulse = .85 + .15 * Math.sin(now / 420);
      for (const [p, nrm] of [[[5.15, 3.05, 2.32], [0, 0, 1]], [[4.7, 3.2, -2.32], [0, 0, -1]]]) {
        const face = clamp(dot(nrm, norm(sub(eye, p))) * 1.4 + .15);
        if (face <= 0) continue;
        gl.uniform3fv(PU.c, p); gl.uniform3fv(PU.col, [1, .12, .06]);
        gl.uniform1f(PU.s, 1.5); gl.uniform1f(PU.a, .9 * face * pulse); gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.uniform1f(PU.s, .5); gl.uniform3fv(PU.col, [1, .55, .45]); gl.uniform1f(PU.a, .7 * face); gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
    }

    drawFlare(key);
    placeHotspots();
    hud();
    if (visible) requestAnimationFrame(frame); else running = false;
  }

  function toScreen(p) {
    const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13], w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
    if (w <= 0) return null;
    return [(x / w * .5 + .5) * W / dpr, (1 - (y / w * .5 + .5)) * Hh / dpr];
  }

  function placeHotspots() {
    const cw = W / dpr, ch = Hh / dpr;
    for (const h of HOT) {
      const pm = partMatrix(h.part);
      const wp = M.xp(pm, h.p), wn = norm(M.xv(pm, h.n));
      const s = toScreen(wp);
      const facing = dot(wn, norm(sub(eye, wp))) > .05;
      const show = s && facing && E >= (h.min || 0) && s[0] > 8 && s[0] < cw - 8 && s[1] > 60 && s[1] < ch - 70;
      h.el.style.transform = s ? `translate(${s[0]}px, ${s[1]}px)` : "";
      h.el.classList.toggle("hidden", !show);
      h.screen = s;
    }
    // hairline from the active hotspot to the inspector
    const h = active && HOT.find((x) => x.id === active);
    if (h && h.screen && !panel.hidden && !h.el.classList.contains("hidden")) {
      const pr = panel.getBoundingClientRect(), sr = stage.querySelector(".studio-stage").getBoundingClientRect();
      const px = pr.left - sr.left + (h.screen[0] < pr.left - sr.left ? 0 : pr.width), py = pr.top - sr.top + 22;
      lead.setAttribute("x1", h.screen[0]); lead.setAttribute("y1", h.screen[1]); lead.setAttribute("x2", px); lead.setAttribute("y2", py);
      lead.style.opacity = 1;
    } else lead.style.opacity = 0;
  }

  // Glint on the front element, with ghosts along the optical axis of the frame
  function drawFlare(key) {
    const cw = W, ch = Hh; fctx.clearRect(0, 0, cw, ch);
    const lp = partMatrix("lens");
    const c = M.xp(lp, [MOUNT_C[0], MOUNT_C[1], 11.38]);
    const toEye = norm(sub(eye, c));
    const facing = clamp(dot([0, 0, 1], toEye));
    const Hv = norm(add(key, toEye));
    const g = add(c, [Hv[0] * 1.9, Hv[1] * 1.9, 0]);
    const s = toScreen(g); if (!s) return;
    const amt = Math.pow(facing, 3) * clamp(dot(Hv, [0, 0, 1]) * 1.2) * (1 - E * .3);
    if (amt < .02) return;
    const x = s[0] * dpr, y = s[1] * dpr, R = Math.min(cw, ch);
    fctx.globalCompositeOperation = "lighter";
    let gr = fctx.createRadialGradient(x, y, 0, x, y, R * .05);
    gr.addColorStop(0, `rgba(255,255,255,${.55 * amt})`); gr.addColorStop(.3, `rgba(170,200,255,${.18 * amt})`); gr.addColorStop(1, "rgba(0,0,0,0)");
    fctx.fillStyle = gr; fctx.beginPath(); fctx.arc(x, y, R * .05, 0, PI * 2); fctx.fill();
    // anamorphic streak
    gr = fctx.createLinearGradient(x - R * .4, y, x + R * .4, y);
    gr.addColorStop(0, "rgba(80,140,255,0)"); gr.addColorStop(.5, `rgba(140,185,255,${.35 * amt})`); gr.addColorStop(1, "rgba(80,140,255,0)");
    fctx.fillStyle = gr; fctx.fillRect(x - R * .4, y - 1.2 * dpr, R * .8, 2.4 * dpr);
    // ghosts
    const cx = cw / 2, cy = ch / 2;
    for (const [t, r, col] of [[.55, .018, "120,255,170"], [1.25, .035, "160,120,255"], [1.6, .012, "255,190,120"]]) {
      const gx = x + (cx - x) * t * 2, gy = y + (cy - y) * t * 2;
      const gg = fctx.createRadialGradient(gx, gy, 0, gx, gy, R * r);
      gg.addColorStop(0, `rgba(${col},${.08 * amt})`); gg.addColorStop(.8, `rgba(${col},${.05 * amt})`); gg.addColorStop(1, `rgba(${col},0)`);
      fctx.fillStyle = gg; fctx.beginPath(); fctx.arc(gx, gy, R * r, 0, PI * 2); fctx.fill();
    }
    fctx.globalCompositeOperation = "source-over";
  }

  const pad3 = (n) => String(Math.round(n)).padStart(3, "0");
  let hudLast = 0;
  function hud() {
    const now = performance.now(); if (now - hudLast < 80) return; hudLast = now;
    readout.sep.textContent = pad3(E * 100) + "%";
    readout.az.textContent = pad3(((cam.yaw * 180 / PI) % 360 + 360) % 360) + "°";
    readout.el.textContent = (cam.pitch < 0 ? "-" : "+") + String(Math.round(Math.abs(cam.pitch * 180 / PI))).padStart(2, "0") + "°";
    readout.fan.textContent = fan ? "AUTO" : "OFF";
    hint.classList.toggle("done", E > .9);
    stage.style.setProperty("--head", clamp(1 - E * 1.6).toFixed(3));
    stage.classList.toggle("is-rec", tally);
  }

  kick();
})();
