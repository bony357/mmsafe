// Formularz wyceny: bez serwera – składa gotową wiadomość e-mail (mailto:)
// i otwiera ją w programie pocztowym użytkownika. Strona niczego nie zapisuje.
export function initContactForm(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('[data-form]');
  const sent = root.querySelector<HTMLElement>('[data-sent]');
  const reset = root.querySelector<HTMLButtonElement>('[data-reset]');
  const email = root.dataset.email;
  if (!form || !sent || !email) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
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
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    form.hidden = true;
    sent.hidden = false;
  });

  reset?.addEventListener('click', () => {
    form.reset();
    sent.hidden = true;
    form.hidden = false;
  });
}
