// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

const SITE = process.env.PUBLIC_SITE_URL || 'https://meaningisthemission.com';

export default defineConfig({
  site: SITE,

  // Fully static: both lead forms post straight from the browser to the Growthmap
  // endpoint, so nothing needs a server runtime (playbook §4b).
  output: 'static',

  trailingSlash: 'always',
  build: { format: 'directory' },

  integrations: [
    sitemap({
      // The WordPress site publishes no sitemap at all — no SEO plugin, and core's
      // /wp-sitemap.xml 404s — so this one is new. It lists the six pages a reader
      // can reach; the 404 template is a route rather than a page, and the author
      // and category archives are `noindex, nofollow` on WordPress (cloned so their
      // URLs keep resolving, kept out of the sitemap so the clone advertises what
      // production means to).
      filter: (page) => !/\/(404|author|category)\//.test(page),
    }),
  ],

  vite: { plugins: [tailwindcss()] },
});
