(() => {
  // Frosted nav gets a touch more opaque once you leave the hero.
  const nav = document.querySelector(".nav");
  let ticking = false;
  const update = () => { ticking = false; nav.classList.toggle("scrolled", scrollY > innerHeight * .5); };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
})();
