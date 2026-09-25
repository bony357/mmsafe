// Panel admina karuzeli promocji. Rozmawia wyłącznie z Workerem (PUBLIC_ADMIN_API_URL).
// Wszystkie teksty wstawiamy przez textContent – bez innerHTML.

interface Slide {
  id: string;
  image: string; // nazwa pliku w repo albo "upload:<klucz>" dla nowego zdjęcia
  tag: string;
  promo: string;
  title: string;
  text: string;
  points: string[];
  cta: string;
  link: string;
}

const TOKEN_KEY = 'mmsafe-admin-token';
const MAX_SIDE = 1600;
const LINK_RE = /^https?:\/\/[^\s"'<>]+$/i;

export function initAdmin(root: HTMLElement) {
  const api = root.dataset.api ?? '';
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

  const views = {
    loading: $('loading'),
    config: $('config-error'),
    login: $('login-view'),
    list: $('list-view'),
  };
  const savebar = $('savebar');
  const saveStatus = $('save-status');
  const saveBtn = $<HTMLButtonElement>('save');
  const logoutBtn = $<HTMLButtonElement>('logout');
  const list = $<HTMLOListElement>('slides');
  const empty = $('empty');
  const dialog = $<HTMLDialogElement>('editor');
  const editorForm = $<HTMLFormElement>('editor-form');
  const editorError = $('editor-error');
  const preview = $<HTMLImageElement>('editor-preview');
  const fileInput = $<HTMLInputElement>('editor-file');

  let slides: Slide[] = [];
  let sha = '';
  let dirty = false;
  let saving = false;
  const uploads = new Map<string, string>(); // klucz -> data URL
  let editing: number | null = null; // indeks edytowanej promocji, null = nowa
  let pendingImage: string | null = null;

  // ───────── Sesja ─────────
  const storage = {
    get(): string | null {
      try {
        const raw = sessionStorage.getItem(TOKEN_KEY);
        if (!raw) return null;
        const { token, exp } = JSON.parse(raw);
        return exp * 1000 > Date.now() ? token : null;
      } catch {
        return null;
      }
    },
    set(token: string, exp: number) {
      try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp })); } catch { /* tryb prywatny */ }
      memoryToken = token;
    },
    clear() {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* */ }
      memoryToken = null;
    },
  };
  let memoryToken: string | null = storage.get();

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(api + path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}),
      },
    }).catch(() => {
      throw new Error('Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.');
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') {
      storage.clear();
      show('login');
      $('login-error').textContent = data.error ?? 'Zaloguj się ponownie.';
      throw new Error(data.error ?? 'Zaloguj się ponownie.');
    }
    if (!res.ok) throw new Error(data.error ?? `Błąd (${res.status}).`);
    return data as T;
  }

  // ───────── Widoki ─────────
  function show(view: keyof typeof views) {
    for (const [k, el] of Object.entries(views)) el.hidden = k !== view;
    logoutBtn.hidden = view !== 'list';
    savebar.hidden = view !== 'list';
  }

  function setDirty(v: boolean) {
    dirty = v;
    savebar.classList.toggle('dirty', v);
    saveBtn.disabled = !v || saving;
    $<HTMLButtonElement>('discard').disabled = !v || saving;
    if (v) saveStatus.textContent = 'Masz niezapisane zmiany.';
  }

  const imageSrc = (s: Slide) =>
    s.image.startsWith('upload:') ? uploads.get(s.image.slice(7)) ?? '' : `${api}/image/${encodeURIComponent(s.image)}`;

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function iconButton(icon: string, label: string, onClick: () => void, disabled = false, cls = 'icon-btn') {
    const b = el('button', cls);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.disabled = disabled;
    const i = el('span', 'ms', icon);
    i.setAttribute('aria-hidden', 'true');
    b.append(i);
    if (cls !== 'icon-btn') b.append(label);
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    list.replaceChildren();
    empty.hidden = slides.length > 0;
    $<HTMLButtonElement>('add').disabled = slides.length >= 10;
    slides.forEach((s, i) => {
      const li = el('li', 'slide');
      const img = el('img', 'thumb');
      img.src = imageSrc(s);
      img.alt = '';
      img.loading = 'lazy';
      const info = el('div', 'info');
      const labels = el('div', 'labels');
      labels.append(el('span', 'tag', s.tag), el('span', 'promo', s.promo));
      info.append(labels, el('strong', 'title', s.title), el('span', 'link muted', s.link));
      const actions = el('div', 'actions');
      actions.append(
        iconButton('arrow_upward', 'Przesuń wyżej', () => move(i, -1), i === 0),
        iconButton('arrow_downward', 'Przesuń niżej', () => move(i, 1), i === slides.length - 1),
        iconButton('edit', 'Edytuj', () => openEditor(i), false, 'btn small'),
        iconButton('delete', 'Usuń', () => remove(i), false, 'btn small danger'),
      );
      li.append(el('span', 'num', String(i + 1)), img, info, actions);
      list.append(li);
    });
  }

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= slides.length) return;
    [slides[i], slides[j]] = [slides[j], slides[i]];
    setDirty(true);
    render();
    (list.children[j]?.querySelector(d < 0 ? '[aria-label="Przesuń wyżej"]' : '[aria-label="Przesuń niżej"]') as HTMLButtonElement | null)?.focus();
  }

  function remove(i: number) {
    if (!confirm(`Usunąć promocję „${slides[i].title}”?`)) return;
    slides.splice(i, 1);
    setDirty(true);
    render();
  }

  // ───────── Edytor ─────────
  function field(name: string) {
    return editorForm.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
  }

  function setPreview(src: string | null) {
    preview.hidden = !src;
    if (src) preview.src = src;
    $('image-btn-text').textContent = src ? 'Zmień zdjęcie' : 'Wybierz zdjęcie';
  }

  function openEditor(i: number | null) {
    editing = i;
    const s = i === null ? null : slides[i];
    $('editor-title').textContent = s ? 'Edytuj promocję' : 'Nowa promocja';
    editorError.textContent = '';
    editorForm.reset();
    fileInput.value = '';
    for (const k of ['tag', 'promo', 'title', 'text', 'cta', 'link'] as const) field(k).value = s ? s[k] : '';
    field('points').value = s ? s.points.join('\n') : '';
    pendingImage = s ? s.image : null;
    setPreview(s ? imageSrc(s) : null);
    dialog.showModal();
  }

  async function resize(file: File): Promise<string> {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Wybierz plik JPG, PNG lub WebP.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Plik jest za duży (max 20 MB).');
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas.toDataURL('image/jpeg', 0.86);
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    editorError.textContent = '';
    try {
      const dataUrl = await resize(file);
      const key = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      uploads.set(key, dataUrl);
      pendingImage = `upload:${key}`;
      setPreview(dataUrl);
    } catch (e) {
      editorError.textContent = e instanceof Error ? e.message : 'Nie udało się wczytać zdjęcia.';
    }
  });

  editorForm.addEventListener('input', () => { editorError.textContent = ''; });

  editorForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (k: string) => field(k).value.trim();
    const link = v('link');
    if (!pendingImage) return void (editorError.textContent = 'Dodaj zdjęcie promocji.');
    if (link !== '#' && !LINK_RE.test(link)) return void (editorError.textContent = 'Link musi zaczynać się od https:// (albo wpisz „#”).');
    const points = v('points').split('\n').map((p) => p.trim()).filter(Boolean);
    if (points.length > 8) return void (editorError.textContent = 'Maksymalnie 8 zalet.');
    if (points.some((p) => p.length > 160)) return void (editorError.textContent = 'Każda zaleta może mieć max 160 znaków.');

    const slide: Slide = {
      id: editing === null ? '' : slides[editing].id,
      image: pendingImage,
      tag: v('tag'),
      promo: v('promo'),
      title: v('title'),
      text: v('text'),
      points,
      cta: v('cta'),
      link,
    };
    if (editing === null) slides.push(slide);
    else slides[editing] = slide;
    dialog.close();
    setDirty(true);
    render();
  });

  const closeEditor = () => dialog.close();
  $('editor-close').addEventListener('click', closeEditor);
  $('editor-cancel').addEventListener('click', closeEditor);

  // ───────── Wczytywanie i zapis ─────────
  async function load() {
    show('loading');
    try {
      const data = await request<{ slides: Slide[]; sha: string }>('/slides');
      slides = data.slides;
      sha = data.sha;
      uploads.clear();
      setDirty(false);
      saveStatus.textContent = '';
      render();
      show('list');
    } catch (e) {
      if (!views.login.hidden) return;
      views.loading.textContent = e instanceof Error ? e.message : 'Nie udało się wczytać promocji.';
    }
  }

  saveBtn.addEventListener('click', async () => {
    if (!dirty || saving) return;
    saving = true;
    saveBtn.disabled = true;
    saveStatus.textContent = 'Zapisywanie…';
    const used = new Set(slides.filter((s) => s.image.startsWith('upload:')).map((s) => s.image.slice(7)));
    const payload = {
      sha,
      slides,
      uploads: Object.fromEntries([...uploads].filter(([k]) => used.has(k))),
    };
    try {
      const res = await request<{ sha: string; slides: Slide[]; changed: boolean }>('/save', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      slides = res.slides;
      sha = res.sha;
      uploads.clear();
      saving = false;
      setDirty(false);
      render();
      saveStatus.textContent = res.changed
        ? 'Zapisano ✓ Zmiany pojawią się na stronie za ok. 1–2 minuty.'
        : 'Brak zmian do zapisania.';
    } catch (e) {
      saving = false;
      setDirty(true);
      saveStatus.textContent = e instanceof Error ? e.message : 'Nie udało się zapisać.';
    }
  });

  $('discard').addEventListener('click', () => {
    if (confirm('Cofnąć wszystkie niezapisane zmiany?')) load();
  });

  $<HTMLFormElement>('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const btn = form.querySelector('button')!;
    const input = form.elements.namedItem('password') as HTMLInputElement;
    $('login-error').textContent = '';
    btn.disabled = true;
    try {
      const { token, exp } = await request<{ token: string; exp: number }>('/login', {
        method: 'POST',
        body: JSON.stringify({ password: input.value }),
      });
      storage.set(token, exp);
      input.value = '';
      await load();
    } catch (err) {
      $('login-error').textContent = err instanceof Error ? err.message : 'Nie udało się zalogować.';
    } finally {
      btn.disabled = false;
    }
  });

  logoutBtn.addEventListener('click', () => {
    if (dirty && !confirm('Masz niezapisane zmiany. Wylogować mimo to?')) return;
    storage.clear();
    setDirty(false);
    show('login');
  });

  addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });
  $('add').addEventListener('click', () => openEditor(null));

  // Start
  if (!api) show('config');
  else if (memoryToken) load();
  else show('login');
}
