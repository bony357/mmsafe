// Formularz wyceny: wysyła zapytanie do api/contact.php (PHP na dhostingu), który przesyła je e-mailem.
// Gdy serwer nie odpowiada (np. podczas `astro dev`), proponuje wysłanie gotowej wiadomości przez mailto:.
export function initContactForm(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('[data-form]');
  const sent = root.querySelector<HTMLElement>('[data-sent]');
  const reset = root.querySelector<HTMLButtonElement>('[data-reset]');
  const error = root.querySelector<HTMLElement>('[data-error]');
  const errorText = root.querySelector<HTMLElement>('[data-error-text]');
  const errorFallback = root.querySelector<HTMLElement>('[data-error-fallback]');
  const errorMail = root.querySelector<HTMLAnchorElement>('[data-error-mail]');
  const submit = form?.querySelector<HTMLButtonElement>('[type=submit]');
  const { email, endpoint } = root.dataset;
  if (!form || !sent || !error || !errorText || !errorFallback || !errorMail || !submit || !email || !endpoint) return;
  const label = submit.textContent;
  // Czas od wejścia na stronę – serwer odrzuca wysyłki szybsze niż 3 s (boty)
  const started = Date.now();

  const mailto = (f: FormData) => {
    const get = (k: string) => String(f.get(k) ?? '').trim();
    const subject = `Zapytanie o wycenę – ${get('topic')}`;
    const body = [
      `Imię i nazwisko: ${get('name')}`,
      `Telefon: ${get('phone')}`,
      `Interesuje mnie: ${get('topic')}`,
      '',
      get('message'),
      '',
      'Wyrażam zgodę na przetwarzanie moich danych osobowych w celu przygotowania oferty.',
    ].join('\r\n');
    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const showError = (text: string, mailHref?: string) => {
    errorText.textContent = text;
    errorFallback.hidden = !mailHref;
    if (mailHref) errorMail.href = mailHref;
    error.hidden = false;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    f.set('elapsed', String(Date.now() - started));
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Wysyłanie…';
    try {
      const res = await fetch(endpoint, { method: 'POST', body: f });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        form.hidden = true;
        sent.hidden = false;
      } else if (res.status === 422 || res.status === 429) {
        showError(data.error ?? 'Sprawdź dane w formularzu.');
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      showError('Nie udało się wysłać formularza.', mailto(f));
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  reset?.addEventListener('click', () => {
    form.reset();
    error.hidden = true;
    sent.hidden = true;
    form.hidden = false;
  });
}
