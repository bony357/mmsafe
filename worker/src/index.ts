// Backend panelu admina MMSafe (Cloudflare Worker).
// Sprawdza hasło, wydaje krótkotrwałą sesję i zapisuje zmiany karuzeli promocji
// jako jeden commit w repozytorium GitHub. Token GitHub nigdy nie trafia do przeglądarki.

interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // "uzytkownik/repozytorium"
  GITHUB_BRANCH?: string;
  ALLOWED_ORIGIN: string; // np. "https://uzytkownik.github.io" (kilka po przecinku)
  GITHUB_API?: string; // tylko do testów lokalnych
  LOGIN_LIMITER?: RateLimit;
}

const DATA_PATH = 'src/content/promocje.json';
const IMG_DIR = 'src/assets/promo';
const SESSION_TTL = 8 * 60 * 60; // 8 h
const MAX_SLIDES = 10;
const MAX_POINTS = 8;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}\.(jpe?g|png|webp)$/;

interface Slide {
  id: string;
  image: string;
  tag: string;
  promo: string;
  title: string;
  text: string;
  points: string[];
  cta: string;
  link: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
    const cors: Record<string, string> = allowed.includes(origin)
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        }
      : { Vary: 'Origin' };

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    try {
      // Obrazki są publiczne (i tak są na stronie) – nie wymagają sesji ani CORS.
      const img = url.pathname.match(/^\/image\/([^/]+)$/);
      if (req.method === 'GET' && img) return await getImage(env, decodeURIComponent(img[1]));

      // Pozostałe endpointy tylko z dozwolonej domeny.
      if (!allowed.includes(origin)) throw new HttpError(403, 'Niedozwolone źródło żądania.');

      let body: unknown;
      if (req.method === 'POST' && url.pathname === '/login') body = await login(req, env);
      else if (req.method === 'GET' && url.pathname === '/slides') {
        await requireSession(req, env);
        body = await getSlides(env);
      } else if (req.method === 'POST' && url.pathname === '/save') {
        await requireSession(req, env);
        body = await save(req, env);
      } else throw new HttpError(404, 'Nie znaleziono.');

      return json(body, 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      console.error('Nieoczekiwany błąd', e instanceof Error ? e.message : String(e));
      return json({ error: 'Błąd serwera. Spróbuj ponownie za chwilę.' }, 500, cors);
    }
  },
};

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// ───────────── Sesja ─────────────

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(s));
}

function safeEqual(a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean {
  const x = a instanceof Uint8Array ? a : new Uint8Array(a);
  const y = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (x.byteLength !== y.byteLength) return false;
  return (crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean }).timingSafeEqual(x, y);
}

async function login(req: Request, env: Env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) throw new HttpError(500, 'Panel nie jest skonfigurowany.');
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.LOGIN_LIMITER) {
    const { success } = await env.LOGIN_LIMITER.limit({ key: `login:${ip}` });
    if (!success) throw new HttpError(429, 'Zbyt wiele prób logowania. Odczekaj minutę.');
  }
  const { password } = (await readJson(req, 10_000)) as { password?: unknown };
  const ok = typeof password === 'string' && safeEqual(await sha256(password), await sha256(env.ADMIN_PASSWORD));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600));
    throw new HttpError(401, 'Nieprawidłowe hasło.');
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = b64url(enc.encode(JSON.stringify({ exp })));
  const sig = b64url(await hmac(env.SESSION_SECRET, payload));
  return { token: `${payload}.${sig}`, exp };
}

async function requireSession(req: Request, env: Env) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw new HttpError(401, 'Zaloguj się ponownie.');
  let valid = false;
  try {
    valid = safeEqual(fromB64url(sig), await hmac(env.SESSION_SECRET, payload));
  } catch {
    valid = false;
  }
  if (!valid) throw new HttpError(401, 'Zaloguj się ponownie.');
  const { exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { exp: number };
  if (!exp || exp < Date.now() / 1000) throw new HttpError(401, 'Sesja wygasła. Zaloguj się ponownie.');
}

async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const len = Number(req.headers.get('Content-Length') ?? 0);
  if (len > maxBytes) throw new HttpError(413, 'Za duże żądanie.');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Za duże żądanie.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Niepoprawne dane.');
  }
}

// ───────────── GitHub ─────────────

async function gh<T = any>(env: Env, path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<T> {
  const api = env.GITHUB_API ?? 'https://api.github.com';
  const res = await fetch(`${api}/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: accept,
      'User-Agent': 'mmsafe-admin-worker',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 404) throw new HttpError(404, 'Nie znaleziono pliku w repozytorium.');
  if (res.status === 409 || res.status === 422) throw new HttpError(409, 'Konflikt zapisu – odśwież stronę i spróbuj ponownie.');
  if (!res.ok) {
    console.error('GitHub API', res.status, path);
    throw new HttpError(502, 'Nie udało się połączyć z repozytorium.');
  }
  return (accept.endsWith('raw') ? res : res.json()) as Promise<T>;
}

const branch = (env: Env) => env.GITHUB_BRANCH || 'main';

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function readDataFile(env: Env) {
  const file = await gh<{ content: string; sha: string }>(env, `/contents/${DATA_PATH}?ref=${branch(env)}`);
  const data = JSON.parse(decodeBase64Utf8(file.content)) as { slides: Slide[] };
  return { slides: data.slides ?? [], sha: file.sha };
}

async function getSlides(env: Env) {
  return readDataFile(env);
}

async function getImage(env: Env, name: string): Promise<Response> {
  if (!IMAGE_NAME.test(name)) throw new HttpError(404, 'Nie znaleziono.');
  const res = await gh<Response>(env, `/contents/${IMG_DIR}/${name}?ref=${branch(env)}`, {}, 'application/vnd.github.raw');
  const ext = name.split('.').pop()!.toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return new Response(res.body, {
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  });
}

// ───────────── Zapis ─────────────

function str(v: unknown, field: string, max: number, required = true): string {
  if (typeof v !== 'string') throw new HttpError(400, `Brak pola „${field}”.`);
  const s = v.trim();
  if (required && !s) throw new HttpError(400, `Pole „${field}” nie może być puste.`);
  if (s.length > max) throw new HttpError(400, `Pole „${field}” jest za długie (max ${max} znaków).`);
  return s;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'promocja'
  );
}

function detectImage(bytes: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

function randomId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(6))).replace(/[-_]/g, 'x').toLowerCase();
}

async function save(req: Request, env: Env) {
  const body = (await readJson(req, 25 * 1024 * 1024)) as {
    sha?: unknown;
    slides?: unknown;
    uploads?: unknown;
  };
  if (!Array.isArray(body.slides)) throw new HttpError(400, 'Niepoprawne dane.');
  if (body.slides.length > MAX_SLIDES) throw new HttpError(400, `Maksymalnie ${MAX_SLIDES} promocji.`);
  const uploads = (body.uploads && typeof body.uploads === 'object' ? body.uploads : {}) as Record<string, unknown>;

  // Aktualny stan repo + kontrola konfliktu (ktoś zapisał w międzyczasie).
  const current = await readDataFile(env);
  if (body.sha !== current.sha) throw new HttpError(409, 'Promocje zostały w międzyczasie zmienione. Odśwież stronę.');

  const ref = await gh<{ object: { sha: string } }>(env, `/git/ref/heads/${branch(env)}`);
  const headSha = ref.object.sha;
  const head = await gh<{ tree: { sha: string } }>(env, `/git/commits/${headSha}`);
  const listing = await gh<{ name: string; type: string }[]>(env, `/contents/${IMG_DIR}?ref=${branch(env)}`).catch((e) => {
    if (e instanceof HttpError && e.status === 404) return [];
    throw e;
  });
  const existing = new Set(listing.filter((f) => f.type === 'file').map((f) => f.name));

  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
  const usedIds = new Set<string>();
  const usedImages = new Set<string>();
  const uploaded = new Map<string, string>();

  const slides: Slide[] = [];
  for (const [i, raw] of (body.slides as Record<string, unknown>[]).entries()) {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Niepoprawne dane.');
    const n = `Promocja ${i + 1}: `;
    const wrap = <T>(fn: () => T): T => {
      try {
        return fn();
      } catch (e) {
        if (e instanceof HttpError) throw new HttpError(e.status, n + e.message);
        throw e;
      }
    };

    const title = wrap(() => str(raw.title, 'Tytuł', 120));
    const link = wrap(() => str(raw.link, 'Link', 500));
    if (link !== '#' && !/^https?:\/\/[^\s"'<>]+$/i.test(link)) throw new HttpError(400, `${n}link musi zaczynać się od https:// (lub „#”).`);
    if (!Array.isArray(raw.points)) throw new HttpError(400, `${n}brak listy punktów.`);
    const points = raw.points.map((p) => wrap(() => str(p, 'Punkt', 160))).filter(Boolean);
    if (points.length > MAX_POINTS) throw new HttpError(400, `${n}maksymalnie ${MAX_POINTS} punktów.`);

    // Zdjęcie: istniejący plik albo nowe z "uploads".
    const imgRef = wrap(() => str(raw.image, 'Zdjęcie', 120));
    let image: string;
    if (imgRef.startsWith('upload:')) {
      const key = imgRef.slice(7);
      if (uploaded.has(key)) image = uploaded.get(key)!;
      else {
        const dataUrl = uploads[key];
        if (typeof dataUrl !== 'string') throw new HttpError(400, `${n}brak przesłanego zdjęcia.`);
        const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
        let bytes: Uint8Array;
        try {
          bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        } catch {
          throw new HttpError(400, `${n}uszkodzony plik zdjęcia.`);
        }
        if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(400, `${n}zdjęcie jest za duże (max 3 MB).`);
        const ext = detectImage(bytes);
        if (!ext) throw new HttpError(400, `${n}dozwolone są tylko zdjęcia JPG, PNG lub WebP.`);
        image = `promo-${Date.now().toString(36)}-${randomId()}.${ext}`;
        const blob = await gh<{ sha: string }>(env, '/git/blobs', {
          method: 'POST',
          body: JSON.stringify({ content: b64, encoding: 'base64' }),
        });
        tree.push({ path: `${IMG_DIR}/${image}`, mode: '100644', type: 'blob', sha: blob.sha });
        uploaded.set(key, image);
      }
    } else {
      if (!IMAGE_NAME.test(imgRef) || !existing.has(imgRef)) throw new HttpError(400, `${n}wybierz zdjęcie.`);
      image = imgRef;
    }
    usedImages.add(image);

    let id = slugify(title);
    for (let k = 2; usedIds.has(id); k++) id = `${slugify(title)}-${k}`;
    usedIds.add(id);

    slides.push({
      id,
      image,
      tag: wrap(() => str(raw.tag, 'Etykieta', 40)),
      promo: wrap(() => str(raw.promo, 'Plakietka', 40)),
      title,
      text: wrap(() => str(raw.text, 'Opis', 600)),
      points,
      cta: wrap(() => str(raw.cta, 'Tekst przycisku', 40)),
      link,
    });
  }

  // Usuwamy zdjęcia, których żadna promocja już nie używa.
  for (const name of existing) {
    if (!usedImages.has(name)) tree.push({ path: `${IMG_DIR}/${name}`, mode: '100644', type: 'blob', sha: null });
  }

  const content = JSON.stringify({ slides }, null, 2) + '\n';
  const dataBlob = await gh<{ sha: string }>(env, '/git/blobs', {
    method: 'POST',
    body: JSON.stringify({ content, encoding: 'utf-8' }),
  });
  if (dataBlob.sha === current.sha && tree.length === 0) return { ok: true, changed: false, sha: current.sha, slides };
  tree.push({ path: DATA_PATH, mode: '100644', type: 'blob', sha: dataBlob.sha });

  const newTree = await gh<{ sha: string }>(env, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: head.tree.sha, tree }),
  });
  const commit = await gh<{ sha: string }>(env, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: 'Aktualizacja promocji (panel admina)',
      tree: newTree.sha,
      parents: [headSha],
      author: { name: 'Panel MMSafe', email: 'panel@mmsafe.invalid', date: new Date().toISOString() },
    }),
  });
  await gh(env, `/git/refs/heads/${branch(env)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { ok: true, changed: true, sha: dataBlob.sha, slides };
}
