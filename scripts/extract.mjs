// Split every crawled WordPress page into the pieces Astro re-assembles:
//   header / content / footer fragments, the ordered stylesheet list, and page metadata.
// Fragments keep Elementor's rendered markup verbatim (minus WordPress JS); only URLs
// are rewritten to be root-relative so the clone serves its own assets.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const HTML = path.join(ROOT, '_extract/html');
const FRAG = path.join(ROOT, 'src/fragments');
const CSSDIR = path.join(ROOT, 'public/wp/css');
const ORIGIN = 'https://meaningisthemission.com';
const ORIGIN_ESC = 'https:\\/\\/meaningisthemission.com';

// LeadConnector ("Trustymail") widget ids → the variant of our replacement form.
// The site embeds two, and no others: the "Speaking Inquiry Form" inside the
// Elementor popup that /speaking/ opens from its "Let's talk" button, and the
// "Free Chapter Opt In" that every page shows five seconds after load. WPForms is
// installed and loads its stylesheet on every page, but renders no form anywhere.
const LEAD_FORMS = {
  lM6u6ScOak0DXiTd8qge: 'speaking',
  b2amYJxAnRCZT9gR8iND: 'chapter',
};

// Hosts whose assets we mirror into public/ so the clone has no third-party image
// deps. This site references none — every image is on the WordPress origin.
const MIRRORED_HOSTS = new Set();
const extPath = (u) => '/wp/ext/' + new URL(u).host + new URL(u).pathname;

await rm(FRAG, { recursive: true, force: true });
await mkdir(FRAG, { recursive: true });

const assets = new Set();

/** Rewrite one URL-ish attribute value; records any asset that must be mirrored. */
function rewriteUrl(value) {
  if (!value) return value;
  const v = value.trim();
  if (v.startsWith(ORIGIN)) {
    const u = new URL(v);
    if (u.pathname.startsWith('/wp-content/') || u.pathname.startsWith('/wp-includes/')) assets.add(u.href);
    // /feed/ and wp-json are WordPress-only endpoints; drop them at the callsite instead.
    return u.pathname + u.search + u.hash;
  }
  if (/^https?:\/\//.test(v)) {
    try {
      const u = new URL(v);
      if (MIRRORED_HOSTS.has(u.host)) { assets.add(u.href); return extPath(u.href); }
    } catch { /* not a URL */ }
  }
  return value;
}

const rewriteSrcset = (v) => v.split(',').map((part) => {
  const s = part.trim();
  const sp = s.lastIndexOf(' ');
  if (sp === -1) return rewriteUrl(s);
  return rewriteUrl(s.slice(0, sp)) + s.slice(sp);
}).join(', ');

const URL_ATTRS = ['src', 'href', 'data-src', 'poster', 'content', 'data-thumb', 'data-thumbnail', 'action'];

function cleanFragment($, $el) {
  // Scripts inside the ported markup belong to third-party embeds (the
  // LeadConnector iframe resizer), not to WordPress — dropping them leaves the
  // embed unsized. It keeps its original absolute URL: the iframe it sizes is
  // served by the same third-party host, so mirroring the loader would not remove
  // a dependency, only add a copy that goes stale. Inline scripts are
  // WordPress/Elementor plumbing and do go.
  $el.find('script').each((i, el) => {
    const $s = $(el);
    const src = $s.attr('src');
    if (!src || src.startsWith('data:')) { $s.remove(); return; }
  });
  // Stylesheets are collected separately, in document order, and re-linked from
  // <head> — including the per-widget <style> blocks Elementor prints inline.
  // Leaving the originals here would duplicate every rule.
  $el.find('link[rel="stylesheet"], style').remove();

  $el.find('[src], [href], [data-src], [poster], [data-thumb], [data-thumbnail], [srcset], [data-settings], [data-elementor-lightbox-slideshow], [action]').addBack().each((i, el) => {
    const $e = $(el);
    for (const a of URL_ATTRS) {
      const v = $e.attr(a);
      if (v && (v.startsWith('http') || v.startsWith('//'))) $e.attr(a, rewriteUrl(v));
    }
    for (const a of ['srcset', 'data-srcset', 'imagesrcset']) {
      const v = $e.attr(a);
      if (v) $e.attr(a, rewriteSrcset(v));
    }
    // Elementor stores widget config as a JSON blob (background videos, lightbox
    // slideshows). URLs in there are JSON-escaped, so match both spellings.
    for (const a of ['data-settings', 'data-elementor-lightbox-slideshow']) {
      let v = $e.attr(a);
      if (!v) continue;
      const before = v;
      v = v.split(ORIGIN_ESC).join('').split(ORIGIN).join('');
      if (v !== before) $e.attr(a, v);
      for (const m of v.matchAll(/\\?\/wp-content[^"'& ]+?\.(?:mp4|webm|mov|jpe?g|png|webp|gif|svg)/gi)) {
        assets.add(ORIGIN + m[0].replace(/\\/g, ''));
      }
    }
  });
  // Inline style="...url(...)..." backgrounds
  $el.find('[style]').addBack().each((i, el) => {
    const $e = $(el);
    const s = $e.attr('style');
    if (s && s.includes(ORIGIN)) {
      for (const m of s.matchAll(new RegExp(ORIGIN.replace(/\./g, '\\.') + '[^)\\s"\']*', 'g'))) assets.add(m[0]);
      $e.attr('style', s.split(ORIGIN).join(''));
    }
  });
  // The LeadConnector inquiry form is wrapped in markers so the page can swap in
  // our own static form when a Growthmap endpoint is configured (playbook §4b).
  for (const [formId, variant] of Object.entries(LEAD_FORMS)) {
    $el.find(`iframe[src*="${formId}"]`).each((i, el) => {
      const $frame = $(el);
      // Wrap the whole HTML widget, so swapping in our form also drops the embed's
      // loader script rather than leaving it hunting for an iframe that is gone.
      const $widget = $frame.closest('[data-widget_type="html.default"]');
      const $target = $widget.length ? $widget : $frame;
      if ($widget.length) {
        $widget.prepend(`<!--gm-form:${variant}:start-->`);
        $widget.append(`<!--gm-form:${variant}:end-->`);
      } else {
        $target.before(`<!--gm-form:${variant}:start-->`);
        $target.after(`<!--gm-form:${variant}:end-->`);
      }
    });
  }

  // WordPress-only endpoints that do not exist on the clone.
  $el.find('a[href^="/feed"], a[href^="/wp-json"], a[href^="/xmlrpc.php"]').each((i, el) => {
    $(el).attr('href', '/');
  });
  return $.html($el);
}

const inlineCss = new Map(); // filename -> content
function saveInline(id, content) {
  const hash = createHash('sha1').update(content).digest('hex').slice(0, 8);
  const name = `inline-${id.replace(/-inline-css$/, '').replace(/[^a-z0-9-]/gi, '-')}-${hash}`;
  if (content.includes(ORIGIN)) {
    for (const m of content.matchAll(new RegExp(ORIGIN.replace(/\./g, '\\.') + '[^)\\s"\']*', 'g'))) assets.add(m[0]);
    content = content.split(ORIGIN).join('');
  }
  inlineCss.set(name, content);
  return name;
}

const files = (await readdir(HTML)).filter((f) => f.endsWith('.html')).sort();
const manifest = JSON.parse(await readFile(path.join(ROOT, '_extract/crawl-manifest.json'), 'utf8'));
const pathBySlug = new Map();
for (const m of manifest) if (m.status === 200) {
  const p = new URL(m.finalUrl || m.url).pathname.toLowerCase();
  if (!pathBySlug.has(m.slug.toLowerCase())) pathBySlug.set(m.slug.toLowerCase(), p);
}

const shared = new Map(); // fragment name -> html (header/footer/popup, deduped by id)
const pages = [];
let optIn = null;
let chatWidget = null;

for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  const urlPath = pathBySlug.get(slug.toLowerCase());
  if (!urlPath) { console.warn('no url for', file); continue; }
  const raw = await readFile(path.join(HTML, file), 'utf8');
  const $ = cheerio.load(raw, { decodeEntities: false });

  // --- stylesheet order: external handles and inline blocks, interleaved as authored
  const css = [];
  $('head link[rel="stylesheet"], head style, body link[rel="stylesheet"], body style').each((i, el) => {
    const $e = $(el);
    if (el.tagName === 'link') {
      const id = ($e.attr('id') || '').replace(/-css$/, '');
      if (id) css.push({ type: 'file', name: id });
    } else {
      // Elementor prints one id-less <style> (the background lazy-load guard).
      const id = ($e.attr('id') || 'anon').replace(/-css$/, '');
      const content = $e.html() || '';
      if (!content.trim()) return;
      css.push({ type: 'file', name: saveInline(id, content) });
    }
  });

  // --- the two site-wide LeadConnector embeds
  //
  // Both are custom-code blocks the theme prints, and both are identical on every
  // page, so each is stored once.
  //
  // The "Free Chapter Opt In" iframe and its loader are written into <head>; an
  // <iframe> is not head content, so the parser relocates both to the top of
  // <body>, which is exactly where production's DOM has them. The loader turns the
  // iframe into its own `.ep-overlay` popup at runtime and shows it after five
  // seconds.
  if (!optIn) {
    const $frame = $('iframe[src*="b2amYJxAnRCZT9gR8iND"]').first();
    if ($frame.length) {
      const $loader = $('script[src*="verified.trustymail.co/js/form_embed.js"]').first();
      optIn = '<!--gm-form:chapter:start-->' + $.html($frame)
        + ($loader.length ? '\n' + $.html($loader) : '') + '<!--gm-form:chapter:end-->';
    }
  }

  // The GoHighLevel chat bubble at the foot of every page. It is the client's own
  // GoHighLevel property and outlives the WordPress install, so it is kept verbatim
  // rather than dropped.
  const $chat = $('chat-widget');
  if ($chat.length && !chatWidget) {
    const $loader = $('script[src*="widgets.leadconnectorhq.com/loader.js"]').first();
    chatWidget = $.html($chat) + ($loader.length ? '\n' + $.html($loader) : '');
  }

  // --- regions
  //
  // The home page uses Elementor's `elementor_canvas` template: no header, no
  // footer, no skip link — just the page's own container. Every other page is
  // either `elementor_header_footer` (header + Elementor content + footer) or a
  // theme-rendered archive (header + `main#content` + footer).
  const $header = $('body > header[data-elementor-type="header"]');
  const $footer = $('body > footer[data-elementor-type="footer"]');
  const $popups = $('body > div[data-elementor-type="popup"]');
  const $content = $('body > div[data-elementor-type]:not([data-elementor-type="popup"]), body > main#content');

  // Header/footer markup is shared, but WordPress bakes per-page state into it
  // (current-menu-* classes, and which logo image gets fetchpriority/lazy). Dedupe
  // by content hash so every distinct variant is stored exactly once, verbatim.
  const region = ($el, kind) => {
    if (!$el.length) return null;
    const id = $el.attr('data-elementor-id') || 'x';
    const html = cleanFragment($, $el);
    const name = `${kind}-${id}-${createHash('sha1').update(html).digest('hex').slice(0, 8)}`;
    if (!shared.has(name)) shared.set(name, html);
    return name;
  };

  const headerFrag = region($header, 'header');
  const footerFrag = region($footer, 'footer');
  const popupFrags = $popups.map((i, el) => region($(el), 'popup')).get();

  const contentHtml = $content.length
    ? $content.map((i, el) => cleanFragment($, $(el))).get().join('\n')
    : '';
  const contentName = `page-${slug}`;
  await writeFile(path.join(FRAG, `${contentName}.html`), contentHtml);

  // --- head metadata
  //
  // Document-wide selectors, not `head …`: WordPress writes the opt-in <iframe>
  // into <head>, and an <iframe> is not head content, so every parser — cheerio's
  // as much as a browser's — closes <head> there and moves the rest of the block
  // into <body>. On this site that strands three of the four favicon links, the
  // TileImage meta and (on the canvas-templated home page) the viewport meta. They
  // are collected wherever the parser put them and re-emitted from <head>, which is
  // where WordPress meant them to be.
  //
  // WordPress prints three `rel="icon"` links and one `apple-touch-icon`, all
  // pointing at the same SVG; the first is relative and typed `image/png`. Kept
  // exactly as served, quirks included (see the README's "Original-site bugs").
  const favicons = $('link[rel="icon"], link[rel="apple-touch-icon"]').map((i, el) => ({
    rel: $(el).attr('rel'),
    href: rewriteUrl($(el).attr('href')),
    sizes: $(el).attr('sizes') || null,
    type: $(el).attr('type') || null,
  })).get();
  const tile = rewriteUrl($('meta[name="msapplication-TileImage"]').attr('content')) || null;

  // No SEO plugin is installed: the pages carry no Open Graph, Twitter card or
  // schema.org markup at all, and no meta description. Nothing to re-emit — the
  // field stays for parity with the layout's contract, and the gap is reported in
  // the README rather than silently filled in.
  const seoHead = $('meta[property^="og:"], meta[name^="twitter:"], meta[property^="article:"], script.yoast-schema-graph, meta[name="google-site-verification"]')
    .map((i, el) => $.html(el).split(ORIGIN).join('__ORIGIN__').split(ORIGIN_ESC).join('__ORIGIN_ESC__'))
    .get().join('\n');

  pages.push({
    slug,
    path: urlPath,
    title: $('head title').text(),
    description: $('head meta[name="description"]').attr('content') || null,
    robots: $('head meta[name="robots"]').attr('content') || null,
    // The canvas template prints a different viewport than the theme's header,
    // and omits the XFN profile link; both are per-page, so both are recorded.
    viewport: $('meta[name="viewport"]').first().attr('content') || 'width=device-width, initial-scale=1',
    hasProfileLink: $('head link[rel="profile"]').length > 0,
    hasCanonical: $('head link[rel="canonical"]').length > 0,
    bodyClass: ($('body').attr('class') || '').trim(),
    lang: $('html').attr('lang') || 'en-US',
    hasSkipLink: $('body > a.skip-link').length > 0,
    header: headerFrag,
    footer: footerFrag,
    popups: popupFrags,
    content: contentName,
    css,
    favicons,
    tile,
    seoHead,
  });
  console.log(`${slug.padEnd(30)} css:${String(css.length).padStart(2)} ${(headerFrag || '-').padEnd(20)} ${contentName.padEnd(34)} ${footerFrag || '-'}${popupFrags.length ? ' +' + popupFrags.join(',') : ''}`);
}

for (const [name, html] of shared) await writeFile(path.join(FRAG, `${name}.html`), html);
await mkdir(CSSDIR, { recursive: true });
for (const [name, content] of inlineCss) await writeFile(path.join(CSSDIR, `${name}.css`), content);

await mkdir(path.join(ROOT, 'src/data'), { recursive: true });
await writeFile(path.join(ROOT, 'src/data/pages.json'), JSON.stringify(pages, null, 2));
await writeFile(path.join(ROOT, '_extract/assets.json'), JSON.stringify([...assets].sort(), null, 2));
await writeFile(path.join(FRAG, 'opt-in.html'), optIn ?? '');
await writeFile(path.join(FRAG, 'chat-widget.html'), chatWidget ?? '');

console.log(`\n${pages.length} pages, ${shared.size} shared fragments, ${inlineCss.size} inline css, ${assets.size} assets`);
