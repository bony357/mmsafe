// Karuzela promocji: nieskończona pętla (po 2 klony z każdej strony, bo sąsiednie
// slajdy są widoczne po bokach), autoplay co 6 s, pauza na hover i w ukrytej karcie.
const INTERVAL = 6000;
const CLONES = 2;

export function initCarousel(root: HTMLElement) {
  const viewport = root.querySelector<HTMLElement>('[data-viewport]');
  const track = root.querySelector<HTMLElement>('[data-track]');
  if (!viewport || !track) return;

  const slides = Array.from(track.children) as HTMLElement[];
  const len = slides.length;
  // Slajdy poza kadrem nie są „widoczne” dla lazy-loadingu – dociągamy je po załadowaniu strony.
  const loadAll = () => track.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
  if (document.readyState === 'complete') loadAll(); else addEventListener('load', loadAll, { once: true });
  if (len < 2) return;

  const cloneOf = (el: HTMLElement) => {
    const c = el.cloneNode(true) as HTMLElement;
    c.classList.remove('is-active');
    c.setAttribute('aria-hidden', 'true');
    c.setAttribute('inert', '');
    return c;
  };
  for (let k = 1; k <= CLONES; k++) {
    track.prepend(cloneOf(slides[(len - k + len * CLONES) % len]));
    track.append(cloneOf(slides[(k - 1) % len]));
  }
  const all = Array.from(track.children) as HTMLElement[];

  const dots = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-dot]'));
  // pos: 1..len to prawdziwe slajdy, 0 i len+1 to klony, na które wjeżdżamy przy zawijaniu.
  let pos = 1;
  let anim = true;
  let paused = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    track.classList.toggle('no-anim', !anim);
    track.style.transition = anim ? 'transform .6s cubic-bezier(.6,0,.2,1)' : 'none';
    const idx = pos + CLONES - 1; // indeks w track.children
    track.style.setProperty('--pos', String(idx));
    all.forEach((el, k) => el.classList.toggle('is-active', k === idx));
    const i = (pos - 1 + len) % len;
    dots.forEach((d, k) => {
      d.classList.toggle('active', k === i);
      d.setAttribute('aria-current', k === i ? 'true' : 'false');
    });
    slides.forEach((s, k) => {
      const active = k === i;
      s.setAttribute('aria-hidden', active ? 'false' : 'true');
      s.toggleAttribute('inert', !active);
    });
  };

  const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => { anim = true; render(); }));

  const normalize = () => {
    if (pos === len + 1) pos = 1;
    else if (pos === 0) pos = len;
    else return;
    anim = false;
    render();
    settle();
  };

  const go = (n: number) => {
    if (pos < 1 || pos > len || !anim) return;
    pos = Math.max(0, Math.min(len + 1, n));
    anim = true;
    render();
    clearTimeout(fallback);
    fallback = setTimeout(normalize, 700);
  };

  const startTimer = () => {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!paused && !document.hidden) go(pos + 1);
    }, INTERVAL);
  };
  const manual = (n: number) => { go(n); startTimer(); };

  track.addEventListener('transitionend', (e) => {
    if (e.target === track && e.propertyName === 'transform') normalize();
  });
  viewport.addEventListener('mouseenter', () => { paused = true; });
  viewport.addEventListener('mouseleave', () => { paused = false; });
  viewport.addEventListener('focusin', () => { paused = true; });
  viewport.addEventListener('focusout', () => { paused = false; });
  root.querySelector('[data-prev]')?.addEventListener('click', () => manual(pos - 1));
  root.querySelector('[data-next]')?.addEventListener('click', () => manual(pos + 1));
  dots.forEach((d, k) => d.addEventListener('click', () => manual(k + 1)));

  // Kliknięcie w widoczny fragment sąsiedniej oferty przewija do niej.
  viewport.addEventListener('click', (e) => {
    const active = all[pos + CLONES - 1];
    if (active.contains(e.target as Node)) return;
    const r = active.getBoundingClientRect();
    if (e.clientX < r.left) manual(pos - 1);
    else if (e.clientX > r.right) manual(pos + 1);
  });

  // Przesuwanie palcem na telefonach
  let startX: number | null = null;
  viewport.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  viewport.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) manual(dx < 0 ? pos + 1 : pos - 1);
  });

  anim = false;
  render();
  settle();
  startTimer();
}
