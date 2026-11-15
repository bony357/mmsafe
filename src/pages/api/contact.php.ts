import type { APIRoute } from 'astro';
import source from '../../server/contact.php?raw';
import { company, contactTopics } from '../../data/site';

// Backend formularza wyceny (PHP na dhostingu). Adres skrzynki i listę tematów bierzemy z site.ts.
// CONTACT_RECIPIENT (zmienna w GitHub Actions) tymczasowo kieruje zapytania na inny adres, np. do testów.
export const GET: APIRoute = ({ site }) => {
  const config = { recipient: process.env.CONTACT_RECIPIENT || company.email, topics: contactTopics, origins: [site!.origin], site: site!.host };
  return new Response(source.replace('__CONFIG__', JSON.stringify(config)), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
