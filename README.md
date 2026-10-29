# MMSafe Ubezpieczenia – strona www

Statyczna strona w [Astro](https://astro.build) (czysty HTML, przyjazny SEO), hostowana na dhostingu (mmsafe.pl), wgrywana automatycznie przez GitHub Actions.
Karuzelę „Aktualne promocje” edytuje się w panelu `/admin` po zalogowaniu hasłem. Hasło sprawdza mały, darmowy Cloudflare Worker, który zapisuje zmiany jako commit w tym repozytorium.

```
src/content/promocje.json   ← dane karuzeli (edytowane z panelu)
src/assets/promo/           ← zdjęcia promocji
src/data/site.ts            ← pozostałe treści: usługi, opinie, dane kontaktowe
src/components/             ← sekcje strony
src/pages/admin/            ← panel admina
worker/                     ← backend panelu (Cloudflare Worker)
```

## Praca lokalna

```bash
npm install
npm run dev        # http://localhost:4321/mmsafe/
npm run build      # wynik w dist/
```

## Wdrożenie (jednorazowo)

### 1. Hosting (dhosting, mmsafe.pl)

Strona jest wgrywana po FTPS na dhosting – poczta i DNS domeny zostają bez zmian.

1. *Settings → Secrets and variables → Actions → Secrets:* `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`.
2. Tamże, zakładka *Variables:* `FTP_DIR` – katalog strony na serwerze, zakończony `/` (np. `mmsafe.pl-pha9/public_html/`).
3. Każdy push na `main` buduje stronę i wgrywa zmienione pliki (workflow `.github/workflows/deploy.yml`). Można też uruchomić go ręcznie: *Actions → Wdrożenie na dhosting → Run workflow*.

### 2. Token GitHub dla Workera

*GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*:

- **Repository access:** *Only select repositories* → to repozytorium,
- **Permissions → Repository → Contents:** *Read and write* (nic więcej).

Zapisz token – przyda się w kroku 3. Tokeny fine-grained mają datę ważności. Po jej upływie wygeneruj nowy i ustaw go ponownie (`wrangler secret put GITHUB_TOKEN`).

### 3. Cloudflare Worker (backend panelu)

Potrzebne jest darmowe konto na [cloudflare.com](https://dash.cloudflare.com/sign-up).

```bash
cd worker
npm install
npx wrangler login
```

W `worker/wrangler.toml` uzupełnij:

- `GITHUB_REPO` – np. `jan-kowalski/mmsafe`,
- `ALLOWED_ORIGIN` – adres strony bez ścieżki, np. `https://mmsafe.pl`.

Ustaw sekrety (wrangler zapyta o wartość):

```bash
npx wrangler secret put ADMIN_PASSWORD   # hasło do panelu – długie, np. 4 losowe słowa
npx wrangler secret put SESSION_SECRET   # losowy ciąg, np. wynik: openssl rand -base64 32
npx wrangler secret put GITHUB_TOKEN     # token z kroku 2
npx wrangler deploy
```

Wrangler wypisze adres Workera, np. `https://mmsafe-admin.jan-kowalski.workers.dev`.

### 4. Połączenie panelu z Workerem

*GitHub → Settings → Secrets and variables → Actions → zakładka Variables → New repository variable*:

- **Name:** `ADMIN_API_URL`
- **Value:** adres Workera z kroku 3

Potem *Actions → Wdrożenie na dhosting → Run workflow* (albo dowolny push).

Panel działa pod adresem `https://mmsafe.pl/admin/`.

## Korzystanie z panelu

1. Wejdź na `/admin/` i wpisz hasło (sesja trwa 8 h lub do zamknięcia karty).
2. Strzałki ↑ ↓ zmieniają kolejność, „Edytuj” otwiera formularz, „Usuń” kasuje promocję, „Dodaj promocję” tworzy nową.
3. Zdjęcie jest automatycznie zmniejszane w przeglądarce (max 1600 px).
4. **Zapisz i opublikuj** wysyła wszystkie zmiany naraz. Strona zaktualizuje się po ok. 1–2 minutach.

Zmiana hasła: `cd worker && npx wrangler secret put ADMIN_PASSWORD`. Przebudowa strony nie jest potrzebna.
Wylogowanie wszystkich sesji: ustaw nowy `SESSION_SECRET`.

## Zabezpieczenia panelu

- Token GitHub jest przechowywany tylko jako sekret Workera i nigdy nie trafia do przeglądarki.
- Hasło jest porównywane w stałym czasie. Z jednego IP można próbować maks. 5 razy na minutę.
- Sesja to podpisany HMAC token z datą ważności.
- API przyjmuje żądania tylko z adresu strony (`ALLOWED_ORIGIN`).
- Worker waliduje dane: długości pól, linki tylko `https://` lub `#`, zdjęcia JPG/PNG/WebP do 3 MB (typ sprawdzany po zawartości pliku). Nazwy plików nadaje sam Worker.
- Zapis to jeden commit. Worker odrzuca zapis, jeśli dane w repo zmieniły się od wczytania panelu.
- Zdjęcia, których nie używa już żadna promocja, są usuwane z repo.

## Zmiana domeny

1. W `.github/workflows/deploy.yml` zmień `SITE_URL`, a w zmiennej `FTP_DIR` katalog na serwerze.
2. W `worker/wrangler.toml` zmień `ALLOWED_ORIGIN` i uruchom `npx wrangler deploy`.

## Test Workera lokalnie

```bash
cd worker
cp .dev.vars.example .dev.vars   # uzupełnij; ALLOWED_ORIGIN=http://localhost:4321
npx wrangler dev                 # http://localhost:8787
# w drugim terminalu, w katalogu głównym:
PUBLIC_ADMIN_API_URL=http://localhost:8787 npm run dev
```

Uwaga: lokalny Worker zapisuje do prawdziwego repozytorium wskazanego w `GITHUB_REPO`. Do testów użyj osobnej gałęzi (`GITHUB_BRANCH`) albo forka.
