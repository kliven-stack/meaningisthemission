// Self-host the Google families the pages request (playbook §2: no Google Fonts
// connection).
//
// Elementor links two families straight from fonts.googleapis.com — Lato (the
// kit's text/accent family) and Oswald (its primary/secondary heading family) —
// each requested across every weight from 100 to 900 plus italics. Google answers
// with only the weights that exist, split per unicode subset.
//
// This mirrors the woff2 binaries under public/wp/fonts/ and rewrites each
// stylesheet to root-relative URLs, keeping the original WordPress handle
// (`elementor-gf-lato`, `elementor-gf-oswald`) so BaseLayout can link them in the
// exact position the WordPress page had them in its cascade.
//
// Two differences from what Google serves, both no-ops for what renders:
//   * only the latin and latin-ext subsets are kept — the browser's unicode-range
//     gating already meant this English site never fetched Oswald's cyrillic or
//     vietnamese blocks;
//   * `font-display: swap` replaces Elementor's `display=auto` (playbook §2). Auto
//     leaves the decision to the browser, which in Chrome means a 3s invisible-text
//     block; swap paints fallback text immediately.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const HTML = path.join(ROOT, '_extract/html');
const FONTS = path.join(ROOT, 'public/wp/fonts');
const CSSDIR = path.join(ROOT, 'public/wp/css');
// A desktop Chrome UA is what makes Google serve woff2 rather than ttf.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const KEEP_SUBSETS = new Set(['latin', 'latin-ext']);

/**
 * Families the WordPress pages do not link, but our own components need.
 *
 * Montserrat is the face the two LeadConnector widgets render their fields in.
 * ContactForm.astro replaces those widgets with our own markup in the page rather
 * than in an iframe, so the family has to be self-hosted here for the replacement
 * to keep the type it is replacing.
 */
const EXTRA_FAMILIES = {
  'gm-montserrat': 'https://fonts.googleapis.com/css?family=Montserrat:400,600&display=auto',
};

await mkdir(FONTS, { recursive: true });
await mkdir(CSSDIR, { recursive: true });

// Which family stylesheets does the site link, and under which handle?
const sheets = new Map(); // handle -> url
for (const f of (await readdir(HTML)).filter((f) => f.endsWith('.html'))) {
  const html = await readFile(path.join(HTML, f), 'utf8');
  for (const m of html.matchAll(/<link[^>]*id='(elementor-gf-[^']*)-css'[^>]*href='([^']*)'/g)) {
    if (!sheets.has(m[1])) sheets.set(m[1], m[2].replace(/&#0?38;/g, '&').replace(/&amp;/g, '&'));
  }
}
for (const [handle, url] of Object.entries(EXTRA_FAMILIES)) sheets.set(handle, url);

const get = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
};

let files = 0;
let dropped = 0;
const index = {};

for (const [handle, url] of sheets) {
  const css = await (await get(url)).text();
  const family = handle.replace(/^elementor-gf-|^gm-/, '');
  const out = [];
  // Google labels each block with a `/* subset */` comment on the line before it.
  for (const m of css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)) {
    const [, subset, face] = m;
    if (!KEEP_SUBSETS.has(subset)) { dropped++; continue; }
    const weight = /font-weight:\s*(\d+)/.exec(face)?.[1] ?? '400';
    const style = /font-style:\s*(\w+)/.exec(face)?.[1] ?? 'normal';
    const name = `${family}-${weight}${style === 'italic' ? 'i' : ''}-${subset}.woff2`;
    const src = /url\((https:[^)]+)\)/.exec(face)?.[1];
    if (!src) continue;

    const dest = path.join(FONTS, name);
    if (!existsSync(dest)) {
      await writeFile(dest, Buffer.from(await (await get(src)).arrayBuffer()));
      files++;
    }
    out.push(`/* ${subset} */\n` + face
      .replace(/url\(https:[^)]+\)/, `url(/wp/fonts/${name})`)
      .replace(/font-display:\s*[\w-]+;?/, '')
      .replace(/@font-face\s*\{/, '@font-face {\n  font-display: swap;'));
  }
  await writeFile(path.join(CSSDIR, `${handle}.css`), out.join('\n') + '\n');
  index[handle] = out.length;
  console.log(`${handle.padEnd(24)} ${out.length} faces kept`);
}

console.log(`\n${sheets.size} families, ${files} font files downloaded, ${dropped} non-latin faces dropped`);
