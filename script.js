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

  /* ---------- Camera: scroll to explode, tap to learn ---------- */
  const cam = $(".cam");
  const fitCam = () => cam.setAttribute("viewBox", innerWidth < 760 ? "20 50 1170 560" : "0 0 1200 640");
  fitCam(); addEventListener("resize", fitCam);
  const hint = $("[data-hint]");
  let pinned = false;
  const parts = {
    lens: ["Lens", "Gathers light and bends it onto the sensor.", "Its focal length, in millimetres, sets how wide or tight the shot is. 24mm feels open and spacious; 85mm feels close and personal."],
    elements: ["Glass elements", "Shaped pieces of glass stacked inside the lens.", "Together they bring the picture into focus and cancel out distortion and colour fringing. Turning the focus ring slides some of them back and forth."],
    aperture: ["Aperture", "Thin blades that open and close like the pupil of an eye.", "It's measured in f-stops. A small number like f/1.4 is wide open: more light and a soft, blurry background. f/16 is a pinhole: darker, with everything sharp."],
    mount: ["Mount", "The metal ring where the lens locks onto the body.", "Gold contacts pass focus and aperture data between lens and camera. The FX3 uses Sony's E-mount, so any E-mount lens fits."],
    shutter: ["Shutter", "Decides how long each frame soaks up light.", "For video, a common rule is double your frame rate: 1/50 of a second at 24 fps gives natural motion blur. Faster speeds freeze motion and look crisp, even choppy."],
    sensor: ["Sensor", "The chip that turns light into the picture.", "The FX3 has a full-frame sensor, about the size of a 35mm film frame, with 12.1 megapixels. Fewer, larger pixels mean cleaner footage when the light is low."],
    body: ["Body and fan", "Holds the processor, memory cards and battery.", "The FX3 has a built-in fan behind those vents, so it can record for hours without overheating. The red tally lights tell everyone it's recording."],
    handle: ["Top handle", "A detachable handle with professional audio inputs.", "Its two XLR inputs take the same microphones used in film and broadcast, so clean sound goes straight into the camera."],
    screen: ["Screen", "A flip-out touchscreen for framing the shot.", "It swings out to the side and tilts, so you can frame from high, low, or facing yourself. Tap it to choose what to focus on."],
  };
  const cardName = $("[data-part-name]"), cardWhat = $("[data-part-what]"), cardWhy = $("[data-part-why]");
  const chips = $$(".chips button");

  function camera(p) {
    if (p < .04 && pinned) { pinned = false; cam.classList.remove("pinned"); }
    const e = reduce || pinned ? 1 : ease(clamp((p - .06) / .5));
    cam.style.setProperty("--e", e.toFixed(4));
    hint.textContent = e > .95 ? "Tap any part to see what it does." : "Keep scrolling. It opens up.";
  }

  function select(name) {
    const same = cam.dataset.active === name;
    $$(".part, .labels g", cam).forEach((el) => el.classList.toggle("is-on", !same && (el.dataset.part || el.dataset.for) === name));
    chips.forEach((c) => c.setAttribute("aria-pressed", String(!same && c.dataset.part === name)));
    if (same) {
      delete cam.dataset.active;
      cardName.textContent = "Tap a part"; cardWhat.textContent = "Each piece has one job. Pick one to see what it does."; cardWhy.textContent = "";
      return;
    }
    cam.dataset.active = name;
    const [n, w, y] = parts[name];
    cardName.textContent = n; cardWhat.textContent = w; cardWhy.textContent = y;
    if (!pinned) { pinned = true; cam.classList.add("pinned"); cam.style.setProperty("--e", 1); }
  }
  chips.forEach((c) => c.addEventListener("click", () => select(c.dataset.part)));
  $$(".part", cam).forEach((g) => g.addEventListener("click", () => select(g.dataset.part)));

  /* ---------- Scroll engine ---------- */
  const handlers = { story, camera };
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
