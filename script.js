(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- Hero: fit the scene to portrait screens, then play the dawn ---------- */
  const heroArt = $(".hero-art");
  function fitHero() {
    const ratio = innerHeight / innerWidth;
    if (ratio > 1) {
      // Portrait: keep the flag and the filmmaker in frame, extend the sky upward
      const w = 820, x0 = 500, h = Math.max(1000, w * ratio);
      heroArt.setAttribute("viewBox", `${x0} ${1000 - h} ${w} ${h}`);
    } else {
      heroArt.setAttribute("viewBox", "0 0 1600 1000");
    }
  }
  fitHero();
  addEventListener("resize", fitHero);
  if (reduce) heroArt.pauseAnimations?.();
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("is-loaded")));

  /* ---------- Story: three scenes driven by scroll ---------- */
  const scenes = $$(".scene");
  const caps = [
    ["Grouse Mountain, 6:40 am", "Sunrise above the cloud line, locked off on a tripod.", ["1/50", "F8", "ISO 100"]],
    ["Stanley Park seawall, golden hour", "Walking alongside a cyclist on a gimbal.", ["1/50", "F2.8", "ISO 400"]],
    ["Gastown, after the rain", "Down low for streetlights on wet stone.", ["1/50", "F1.4", "ISO 3200"]],
  ];
  const capTitle = $("[data-cap-title]"), capText = $("[data-cap-text]"), capBox = $(".story-caption");
  const osd = { shutter: $('[data-osd="shutter"]'), iris: $('[data-osd="iris"]'), iso: $('[data-osd="iso"]') };
  const bars = $$(".story-progress i");
  let currentScene = 0;

  function story(p) {
    const n = scenes.length, t = p * n;
    scenes.forEach((s, i) => {
      const local = t - i;
      let op = clamp(Math.min((local + .12) / .24, (1.12 - local) / .24));
      if (i === 0 && local < .5) op = 1;
      if (i === n - 1 && local > .5) op = 1;
      s.style.opacity = op;
      s.style.transform = `scale(${1.06 - .06 * clamp(local)})`;
    });
    bars.forEach((b, i) => b.style.setProperty("--fill", clamp(t - i)));
    const idx = clamp(Math.floor(t), 0, n - 1);
    if (idx !== currentScene) {
      currentScene = idx;
      capBox.classList.add("swap");
      setTimeout(() => {
        const [a, b, o] = caps[idx];
        capTitle.textContent = a; capText.textContent = b;
        osd.shutter.textContent = o[0]; osd.iris.textContent = o[1]; osd.iso.textContent = o[2];
        capBox.classList.remove("swap");
      }, 180);
    }
  }

  // Running timecode, 24 frames per second
  const tc = $("[data-tc]");
  const t0 = performance.now();
  const pad = (n) => String(n).padStart(2, "0");
  setInterval(() => {
    const f = Math.floor((performance.now() - t0) / (1000 / 24));
    const s = Math.floor(f / 24);
    tc.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f % 24)}`;
  }, 1000 / 24);

  /* ---------- Scroll engine ---------- */
  const handlers = { story };
  const sticky = $$("[data-scrolly]");
  let ticking = false;
  function update() {
    ticking = false;
    navTone();
    for (const s of sticky) {
      const r = s.getBoundingClientRect();
      const total = r.height - innerHeight;
      if (r.bottom < -200 || r.top > innerHeight + 200) continue;
      handlers[s.dataset.scrolly](clamp(-r.top / total));
    }
  }
  // Nav switches between light and dark glass depending on what's under it
  const nav = $(".nav"), darkSections = $$("[data-nav='dark']");
  function navTone() {
    const y = 24;
    nav.classList.toggle("on-dark", darkSections.some((s) => { const r = s.getBoundingClientRect(); return r.top <= y && r.bottom > y; }));
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  update();

  /* ---------- Playground: shutter, aperture, ISO ---------- */
  const SH = [25, 50, 100, 250, 500, 1000, 2000];
  const AP = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
  const ISO = [100, 200, 400, 800, 1600, 3200, 6400, 12800];
  const sS = $("#sShutter"), sA = $("#sAperture"), sI = $("#sIso");
  const dof = $("[data-dof]"), motion = $("[data-motion]");
  const expo = $(".p-exposure"), grain = $(".p-grain"), meter = $("[data-meter]"), read = $("[data-exposure]");
  const out = { shutter: $('[data-out="shutter"]'), aperture: $('[data-out="aperture"]'), iso: $('[data-out="iso"]') };
  const note = { shutter: $('[data-note="shutter"]'), aperture: $('[data-note="aperture"]'), iso: $('[data-note="iso"]') };

  function play() {
    const sh = SH[sS.value], ap = AP[sA.value], iso = ISO[sI.value];
    out.shutter.textContent = `1/${sh}`;
    out.aperture.textContent = `f/${ap}`;
    out.iso.textContent = iso;

    motion.setAttribute("stdDeviation", `${(600 / sh).toFixed(1)} 0`);
    dof.setAttribute("stdDeviation", Math.max(0, 12 / ap - .75).toFixed(2));
    grain.setAttribute("opacity", (Math.pow(Math.log2(iso / 100) / 7, 1.6) * .6).toFixed(2));

    // Light reaching the sensor, relative to 1/50, f/4, ISO 800
    const stops = Math.log2((50 / sh) * (16 / (ap * ap)) * (iso / 800));
    const s = clamp(stops, -4, 4);
    expo.style.filter = `brightness(${Math.pow(2, s * .42).toFixed(3)})`;
    meter.style.left = `calc(${50 + (clamp(stops, -3, 3) / 3) * 50}% - 2px)`;
    const r = Math.round(stops * 3) / 3;
    read.textContent = Math.abs(r) < .2 ? "Exposure is spot on." : r > 0 ? `Too bright by ${fmt(r)} stop${Math.abs(r) > 1 ? "s" : ""}.` : `Too dark by ${fmt(-r)} stop${Math.abs(r) > 1 ? "s" : ""}.`;

    note.shutter.textContent = sh <= 25 ? "Slow: moving things smear into streaks." : sh === 50 ? "Double the frame rate at 24 fps. Motion looks natural, like cinema." : sh <= 250 ? "Faster: less blur, a crisper, more video look." : "Very fast: motion freezes, almost choppy on playback.";
    note.aperture.textContent = ap <= 2 ? "Wide open: lots of light, background melts away." : ap <= 4 ? "A balance of light and background detail." : ap <= 8 ? "Narrower: more of the scene is sharp." : "Pinhole: everything sharp, but very little light gets in.";
    note.iso.textContent = iso <= 200 ? "Cleanest image. Needs plenty of light." : iso <= 800 ? "A good everyday range." : iso <= 3200 ? "Brighter in the dark, with a little grain." : "Very sensitive. Visible grain shows up.";
  }
  const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1)).toString();
  [sS, sA, sI].forEach((el) => el.addEventListener("input", play));
  play();
})();
