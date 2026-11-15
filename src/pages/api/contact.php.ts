import type { APIRoute } from 'astro';
import source from '../../server/contact.php?raw';
import { company, contactTopics } from '../../data/site';

// Backend formularza wyceny (PHP na dhostingu). Adres skrzynki i listę tematów bierzemy z site.ts.
// CONTACT_RECIPIENT (zmienna w GitHub Actions) tymczasowo kieruje zapytania na inny adres, np. do testów.
// SMTP_* to skrzynka, przez którą wysyłamy (hasło w sekretach GitHub, nie w repo).
export const GET: APIRoute = ({ site }) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  const smtp = SMTP_HOST && SMTP_USER && SMTP_PASSWORD
    ? { host: SMTP_HOST, port: Number(SMTP_PORT) || 465, user: SMTP_USER, password: SMTP_PASSWORD }
    : null;
  const config = { recipient: process.env.CONTACT_RECIPIENT || company.email, topics: contactTopics, origins: [site!.origin], site: site!.host, smtp };
  return new Response(source.replace('__CONFIG__', JSON.stringify(config)), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
