// Crawl the live WordPress site and save raw HTML to _extract/html/, plus a
// manifest of what was found.
//
// This site publishes no sitemap: Yoast is not installed and WordPress core's
// own /wp-sitemap.xml 404s (a redirect plugin points /sitemap.xml at it, and it
// is not there either). The REST API is open, so the page inventory comes from
// /wp-json/wp/v2/pages instead — an authoritative list rather than a guess — and
// link discovery from every crawled page picks up anything the API does not
// enumerate (archives, orphan pages, the WordPress front page).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://meaningisthemission.com';
const OUT = new URL('../_extract/', import.meta.url).pathname;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { tries = 4 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml' }, redirect: 'follow' });
      const body = await res.text();
      return { status: res.status, url: res.url, body, type: res.headers.get('content-type') || '' };
    } catch (err) {
      if (i === tries - 1) return { status: 0, url, body: '', type: '', error: String(err) };
      await sleep(800 * (i + 1));
    }
  }
}

// slug for a URL path: "/" -> "index", "/blog/foo/" -> "blog__foo"
export const slugOf = (pathname) => {
  const p = pathname.replace(/^\/+|\/+$/g, '');
  return p === '' ? 'index' : p.replace(/\//g, '__');
};

const norm = (u) => {
  try {
    const url = new URL(u, ORIGIN);
    if (url.origin !== ORIGIN) return null;
    if (/\.(jpe?g|png|gif|svg|webp|avif|pdf|mp4|zip|css|js|xml|ico)$/i.test(url.pathname)) return null;
    if (/^\/(wp-admin|wp-json|wp-content|wp-includes|feed|xmlrpc)/.test(url.pathname)) return null;
    if (url.pathname.includes('/feed')) return null;
    url.hash = '';
    url.search = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  } catch { return null; }
};

/** Every published page, post and category archive, straight from the REST API. */
async function restUrls() {
  const urls = new Set();
  for (const type of ['pages', 'posts', 'categories', 'tags']) {
    const r = await get(`${ORIGIN}/wp-json/wp/v2/${type}?per_page=100&_fields=link,count`);
    if (r.status !== 200) { console.warn(`rest ${type}: ${r.status}`); continue; }
    let items = [];
    try { items = JSON.parse(r.body); } catch { continue; }
    for (const item of items) {
      // An empty term archive is a WordPress URL with nothing on it; it still
      // resolves, so it is still crawled — `count` only decides the log line.
      const n = norm(item.link);
      if (n) urls.add(n);
    }
    console.log(`rest ${type}: ${items.length}`);
  }
  return [...urls];
}

const run = async () => {
  await mkdir(path.join(OUT, 'html'), { recursive: true });
  const seeds = await restUrls();
  // Roots WordPress serves that neither the REST API enumerates nor any page
  // links. The author archive answers 200 (empty, `noindex, nofollow`, but a real
  // URL); a URL that resolves on WordPress and 404s here after cutover is a
  // regression, not an out-of-scope note (playbook §1).
  const extras = ['/author/admin/'].map((p) => ORIGIN + p);
  const queue = [...new Set([ORIGIN + '/', ...seeds, ...extras])];
  const seen = new Set(queue);
  const manifest = [];

  for (let i = 0; i < queue.length; i++) {
    const url = queue[i];
    const file = path.join(OUT, 'html', slugOf(new URL(url).pathname) + '.html');
    let res;
    if (existsSync(file) && !process.env.FORCE) {
      res = { status: 200, url, body: await readFile(file, 'utf8'), cached: true };
    } else {
      res = await get(url);
      // A URL that redirects is not a page of its own — WordPress resolves it to
      // one we already have. Record it so vercel.json can reproduce the redirect,
      // but do not save a second copy of the target's HTML.
      const redirected = res.url && new URL(res.url).pathname !== new URL(url).pathname;
      if (res.status === 200 && /html/.test(res.type) && !redirected) await writeFile(file, res.body);
      await sleep(250);
    }
    const finalPath = new URL(res.url || url).pathname;
    manifest.push({
      url, status: res.status, finalUrl: res.url, slug: slugOf(finalPath),
      redirect: new URL(res.url || url).pathname !== new URL(url).pathname,
      fromRest: seeds.includes(url),
    });
    console.log(`${res.status} ${res.cached ? 'cache' : 'fetch'} ${url}`);
    if (res.status !== 200) continue;

    // Discover more same-host links (pagination, archives, orphan pages).
    for (const m of res.body.matchAll(/href=["']([^"']+)["']/g)) {
      const n = norm(m[1]);
      if (n && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }

  // The theme's 404 template, so unknown URLs land on the site's own page rather
  // than the host's default. Fetched from a URL WordPress is guaranteed to miss.
  const notFound = await get(`${ORIGIN}/this-page-does-not-exist-clone-probe/`);
  if (notFound.status === 404) {
    await writeFile(path.join(OUT, 'html', '404.html'), notFound.body);
    manifest.push({ url: `${ORIGIN}/404/`, status: 200, finalUrl: `${ORIGIN}/404/`, slug: '404', fromRest: false });
    console.log('404 template captured');
  }

  await writeFile(path.join(OUT, 'crawl-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.length} urls, ${manifest.filter((m) => m.status === 200).length} ok`);
};

if (import.meta.url === `file://${process.argv[1]}`) await run();
