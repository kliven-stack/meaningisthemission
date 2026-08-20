/**
 * Measured fidelity check (playbook §2): load the same page from production and
 * from the local clone at 1440 / 900 / 390 px, then diff landmark bounding boxes
 * and computed styles element by element.
 *
 * Landmarks are matched by Elementor's stable `data-id`, plus a few structural
 * selectors, so the comparison does not depend on DOM order.
 *
 *   node scripts/compare.mjs [--only=/path/] [--width=1440]
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const LIVE = 'https://meaningisthemission.com';
const CLONE = process.env.CLONE_ORIGIN || 'http://localhost:4321';
const WIDTHS = [1440, 900, 390];
const TOLERANCE = { pos: 3, size: 3 };

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const pages = JSON.parse(await readFile(ROOT + 'src/data/pages.json', 'utf8'));
const targets = args.only ? pages.filter((p) => p.path === args.only) : pages;
const widths = args.width ? [Number(args.width)] : WIDTHS;

const PROBE = () => {
  // Force a full style recalculation before reading anything.
  //
  // Chrome resolves `margin-inline: auto` to its used value lazily: on a page whose
  // scripts never invalidate style after first layout — which is exactly what a
  // static clone is — `getComputedStyle(el).marginLeft` keeps answering `0px` for
  // the theme's auto-centred `main#content`, while the box really is at x=150.
  // Production's jQuery/Elementor churn happens to knock that cache over, so the two
  // sides disagreed about a margin they both render identically. Invalidate here so
  // the probe measures what is on screen.
  for (const sheet of document.styleSheets) {
    try {
      sheet.disabled = true;
      void document.documentElement.offsetWidth;
      sheet.disabled = false;
      void document.documentElement.offsetWidth;
    } catch { /* cross-origin */ }
  }

  const out = {};
  const push = (key, el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[key] = {
      x: Math.round(r.x), y: Math.round(r.y + window.scrollY),
      w: Math.round(r.width), h: Math.round(r.height),
      font: `${cs.fontFamily.split(',')[0].replace(/["']/g, '')} ${cs.fontSize} ${cs.fontWeight}`,
      color: cs.color,
      bg: cs.backgroundColor,
      display: cs.display,
      pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      margin: `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`,
      align: cs.textAlign,
    };
  };
  for (const el of document.querySelectorAll('[data-id]')) {
    // Carousel loop clones repeat their source data-id; measure the real slide.
    if (el.closest('.swiper-slide-duplicate')) continue;
    const key = `id:${el.getAttribute('data-id')}`;
    if (key in out) continue;
    push(key, el);
  }
  // Elementor's own elements all carry a data-id; the theme-rendered pages (the
  // posts, the category archive, and the four pages that use the Hello template)
  // carry none, so those would otherwise be compared as an empty box. Sweep their
  // leaves by document order instead — that is where their text and typography are.
  // Elementor's own elements all carry a data-id, so this sweep is about everything
  // inside them: the text nodes, the icons, the button and menu chrome, and the
  // theme-rendered pages (the two archives and the 404 template) whose markup
  // carries no data-id at all and would otherwise be compared as an empty box.
  const LEAVES = 'h1, h2, h3, h4, h5, h6, p, li, a, img, svg, i, span, button, figure, blockquote, time, hr,'
    + ' nav, ul, ol, .elementor-widget-container, .elementor-button-content-wrapper, .elementor-icon,'
    + ' .entry-title, .page-header, .page-content, .comments-area, .comment-body, .nav-links';
  document.querySelectorAll(LEAVES).forEach((el, i) => {
    if (el.closest('.swiper-slide-duplicate') || el.closest('.elementor-sticky__spacer')) return;
    push(`leaf:${i}:${el.tagName.toLowerCase()}`, el);
    // innerText, not textContent: with scripting on, a <noscript> block's markup
    // counts as text but renders as nothing, and the clone drops LiteSpeed's
    // <noscript> image twins (see scripts/extract.mjs). innerText compares what is
    // actually painted.
    out[`leaf:${i}:${el.tagName.toLowerCase()}`].text =
      (el instanceof HTMLElement ? el.innerText : el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  });

  for (const sel of ['body', 'header.elementor-location-header', 'footer.elementor-location-footer',
    'main#content', '[data-elementor-type="wp-page"]',
    '.eael-testimonial-slider-main', '.eael-testimonial-slider-main .swiper-wrapper',
    '.eael-testimonial-slider-main .swiper-slide-active']) {
    const el = document.querySelector(sel);
    if (el) push(`sel:${sel}`, el);
  }
  out['__page'] = { h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth };
  return out;
};

const browser = await chromium.launch();
const report = [];

for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  // Videos never settle and third-party embeds vary run to run; block both sides
  // identically so the geometry is comparable (playbook §7.6).
  await ctx.route('**/*.{mp4,mov,webm}', (r) => r.abort());
  await ctx.route('**://*.googletagmanager.com/**', (r) => r.abort());
  await ctx.route('**://*.google-analytics.com/**', (r) => r.abort());
  // The LeadConnector embeds are blocked on both sides. The "Free Chapter Opt In"
  // popup is the reason this matters: it covers the viewport five seconds after
  // load, and whether it has arrived yet would decide every measurement below. Its
  // own box is fixed-position and takes nothing out of the page's flow, so blocking
  // it costs the comparison nothing. Same for the chat bubble.
  // KEEP_EMBEDS=1 lets them load on both sides, to check the geometry they actually
  // produce. Off by default: the host resets headless traffic at random, so a run
  // that keeps them is only meaningful when it succeeds.
  if (!process.env.KEEP_EMBEDS) await ctx.route('**://verified.trustymail.co/**', (r) => r.abort());
  await ctx.route('**://*.leadconnectorhq.com/**', (r) => r.abort());
  await ctx.route('**://firebasestorage.googleapis.com/**', (r) => r.abort());

  for (const page of targets) {
    const measure = async (origin) => {
      const tab = await ctx.newPage();
      await tab.bringToFront();
      try {
        await tab.goto(origin + page.path, { waitUntil: 'load', timeout: 90000 });
        // Text wraps differently against fallback metrics. Production serves large
        // unsubsetted TTFs, so it swaps in noticeably later than the clone's woff2 —
        // measuring before both have settled invents differences that are not there.
        await tab.evaluate(() => document.fonts.ready);
        await tab.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await tab.waitForTimeout(1200);
        await tab.evaluate(() => window.scrollTo(0, 0));
        await tab.waitForTimeout(800);
        // The testimonial slider never advances on its own (its autoplay delay is
        // the bundle's 999999ms fallback), but pin it to the first slide anyway so
        // a stray interaction cannot make the geometry diff non-deterministic.
        // Production runs real Swiper, the clone runs the reimplementation in
        // src/scripts/elementor.js — both are asked for loop index 0, no transition.
        await tab.evaluate(() => {
          for (const el of document.querySelectorAll('.eael-testimonial-slider-main')) {
            if (el.swiper) { el.swiper.autoplay?.stop(); el.swiper.slideToLoop(0, 0); }
            else if (el.eCarousel) el.eCarousel.reset();
          }
        });
        await tab.waitForTimeout(250);
        return await tab.evaluate(PROBE);
      } finally { await tab.close(); }
    };

    // Sequentially, never concurrently: background tabs throttle layout work.
    const live = await measure(LIVE);
    const clone = await measure(CLONE);

    const diffs = [];
    for (const key of Object.keys(live)) {
      const a = live[key], b = clone[key];
      if (!b) { diffs.push({ key, kind: 'missing' }); continue; }
      if (key === '__page') {
        if (Math.abs(a.h - b.h) > 24) diffs.push({ key, kind: 'page-height', live: a.h, clone: b.h });
        continue;
      }
      for (const prop of ['x', 'y', 'w', 'h']) {
        const limit = prop === 'x' || prop === 'y' ? TOLERANCE.pos : TOLERANCE.size;
        if (Math.abs(a[prop] - b[prop]) > limit) diffs.push({ key, kind: prop, live: a[prop], clone: b[prop] });
      }
      for (const prop of ['font', 'color', 'bg', 'display', 'pad', 'margin', 'align', 'text']) {
        if (a[prop] === undefined && b[prop] === undefined) continue;
        if (a[prop] !== b[prop]) diffs.push({ key, kind: prop, live: a[prop], clone: b[prop] });
      }
    }
    const extra = Object.keys(clone).filter((k) => !(k in live));
    report.push({ path: page.path, width, checked: Object.keys(live).length, diffs, extra });
    const flag = diffs.length ? 'DIFF' : ' ok ';
    console.log(`${flag} ${String(width).padStart(4)} ${page.path.padEnd(56)} ${Object.keys(live).length} nodes, ${diffs.length} diffs${extra.length ? `, ${extra.length} extra` : ''}`);
  }
  await ctx.close();
}

await browser.close();
await mkdir(ROOT + '_extract', { recursive: true });
const REPORT = ROOT + (process.env.REPORT_PATH || '_extract/compare-report.json');
await writeFile(REPORT, JSON.stringify(report, null, 2));
const total = report.reduce((n, r) => n + r.diffs.length, 0);
console.log(`\n${report.length} comparisons, ${total} diffs → ${REPORT}`);
