// Przewijane opinie – jak w prototypie: 0,035 px/ms, pauza po najechaniu kursorem.
const SPEED = 0.035;

export function initMarquee(root: HTMLElement) {
  const track = root.querySelector<HTMLElement>('[data-marquee-track]');
  if (!track) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let x = 0;
  let hover = false;
  let last = performance.now();
  root.addEventListener('mouseenter', () => { hover = true; });
  root.addEventListener('mouseleave', () => { hover = false; });

  const tick = (t: number) => {
    const dt = Math.min(64, t - last);
    last = t;
    if (!hover) x -= dt * SPEED;
    const half = track.scrollWidth / 2 + 10;
    if (-x >= half) x += half;
    track.style.transform = `translateX(${x}px)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
