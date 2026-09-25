// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SITE_URL / BASE_PATH ustawia workflow GitHub Pages (actions/configure-pages).
// Po przejściu na własną domenę: SITE_URL=https://mmsafe.pl, BASE_PATH=/
const site = process.env.SITE_URL || 'https://example.github.io';
const base = process.env.BASE_PATH !== undefined ? process.env.BASE_PATH || '/' : '/mmsafe';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  integrations: [sitemap({ filter: (page) => !page.includes('/admin') })],
});
