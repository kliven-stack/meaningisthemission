/**
 * Functional tests against the built clone (playbook §2: "plus functional tests").
 *
 * Everything the replaced WordPress JS used to do is exercised here — the parts a
 * computed-style diff cannot see. Run `node scripts/serve.mjs` first.
 *
 *   node scripts/functional.mjs
 */
import { chromium } from 'playwright';

const ORIGIN = process.env.CLONE_ORIGIN || 'http://localhost:4321';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch();

const open = async (path, width = 1440, height = 900) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route('**://verified.trustymail.co/**', (r) => r.abort());
  await ctx.route('**://*.leadconnectorhq.com/**', (r) => r.abort());
  await ctx.route('**://www.youtube.com/**', (r) => r.abort());
  await ctx.route('**://links.sybrware.com/**', (r) => r.abort());
  const page = await ctx.newPage();
  await page.bringToFront();
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  return { ctx, page };
};

/**
 * The sticky header leaves a visibility-hidden clone of itself in the DOM (see
 * initSticky), so every header selector has to name the live copy.
 */
const HEADER = 'header .elementor-sticky--active';

/* ---------------------------------------------------------------- desktop nav */
// The widget is `--dropdown-mobile`: the horizontal menu shows at tablet and up,
// and the burger only takes over at ≤767.
for (const width of [1440, 900]) {
  const { ctx, page } = await open('/', width, 900);
  const items = await page.$$eval(`${HEADER} .elementor-nav-menu--main .elementor-item`,
    (els) => els.map((a) => `${a.textContent.trim()}→${a.getAttribute('href')}`));
  check(`nav @${width}: desktop menu renders both items`, items.length === 2, items.join(', '));
  check(`nav @${width}: current page is marked active`, await page.$eval(
    `${HEADER} .elementor-nav-menu--main .elementor-item`,
    (a) => a.classList.contains('elementor-item-active')));
  check(`nav @${width}: horizontal menu is visible`,
    await page.locator(`${HEADER} .elementor-nav-menu--main`).first().isVisible());
  check(`nav @${width}: burger is hidden`,
    !(await page.locator(`${HEADER} .elementor-menu-toggle`).first().isVisible()));
  // This menu has no submenus at all — SmartMenus only ever annotated it here.
  check(`nav @${width}: no submenu parents to open`, (await page.$$('header .menu-item-has-children')).length === 0);
  await ctx.close();
}

/* ---------------------------------------------------------------- burger menu */
for (const width of [767, 390]) {
  const { ctx, page } = await open('/', width, 844);
  const toggle = `${HEADER} .elementor-menu-toggle`;
  const panel = `${HEADER} nav.elementor-nav-menu--dropdown`;

  const height = () => page.$eval(panel, (n) => Math.round(n.getBoundingClientRect().height));
  check(`burger @${width}: toggle is visible`, await page.locator(toggle).first().isVisible());
  check(`burger @${width}: toggle carries its button semantics`, await page.$eval(toggle,
    (t) => t.getAttribute('role') === 'button' && t.tabIndex === 0 && t.getAttribute('aria-expanded') === 'false'));
  check(`burger @${width}: panel starts collapsed`, (await height()) === 0);

  await page.locator(toggle).first().click();
  await page.waitForTimeout(600);
  const openHeight = await height();
  check(`burger @${width}: opens`, openHeight > 40, `${openHeight}px`);
  check(`burger @${width}: toggle marked active and expanded`, await page.$eval(toggle,
    (t) => t.classList.contains('elementor-active') && t.getAttribute('aria-expanded') === 'true'));
  check(`burger @${width}: --menu-height is the space left below the panel`, await page.$eval(panel, (n) => {
    const declared = parseFloat(getComputedStyle(n).getPropertyValue('--menu-height'));
    return Math.abs(declared - (window.innerHeight - n.getBoundingClientRect().top)) < 2;
  }));
  check(`burger @${width}: panel stretches to the viewport`, await page.$eval(panel,
    (n) => Math.abs(n.getBoundingClientRect().width - document.documentElement.clientWidth) < 2
      && Math.abs(n.getBoundingClientRect().x) < 2));

  await page.locator(toggle).first().click();
  await page.waitForTimeout(600);
  check(`burger @${width}: closes`, (await height()) === 0);
  await ctx.close();
}

/* ---------------------------------------------------------------- sticky header */
{
  const { ctx, page } = await open('/');
  const sticky = HEADER;
  check('sticky: pinned and spacer inserted', await page.evaluate((s) => {
    const el = document.querySelector(s);
    const spacer = document.querySelector('header .elementor-sticky__spacer');
    return !!el && !!spacer && getComputedStyle(el).position === 'fixed'
      && Math.abs(el.getBoundingClientRect().height - spacer.getBoundingClientRect().height) < 2;
  }, sticky));
  check('sticky: no effects class at rest', !(await page.$eval(sticky,
    (el) => el.classList.contains('elementor-sticky--effects'))));
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(400);
  check('sticky: effects class past the 5px offset', await page.$eval(sticky,
    (el) => el.classList.contains('elementor-sticky--effects')));
  check('sticky: header stays at the top of the viewport', await page.$eval(sticky,
    (el) => Math.round(el.getBoundingClientRect().top) === 0));
  await ctx.close();
}

/* ---------------------------------------------------------------- counters */
// Two of the home page's three counters render their from-value server-side; the
// third renders nothing at all, so without this they read "$ B+".
{
  const { ctx, page } = await open('/');
  const values = async () => page.$$eval('.elementor-counter-number', (els) => els.map((e) => e.textContent));

  // The served markup carries the from-values; one of the three is empty, so that
  // counter reads "$ B+" until this runs.
  const served = await (await fetch(ORIGIN + '/')).text();
  const rendered = [...served.matchAll(/class="elementor-counter-number"[^>]*>([^<]*)</g)].map((m) => m[1]);
  check('counter: served markup holds the from-values',
    JSON.stringify(rendered) === JSON.stringify(['', '0', '0']), JSON.stringify(rendered));

  await page.evaluate(() => document.querySelector('.elementor-counter').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(2600);
  const done = await values();
  check('counter: counts up to the to-value', JSON.stringify(done) === JSON.stringify(['19.9', '58', '75']), JSON.stringify(done));
  await ctx.close();
}

/* ---------------------------------------------------------------- menu anchor */
{
  const { ctx, page } = await open('/');
  check('anchor: the target the nav points at exists', (await page.$$('#contact-us')).length === 1);
  await page.locator(`${HEADER} .elementor-nav-menu--main a[href*="#contact-us"]`).first().click();
  await page.waitForTimeout(2000);
  const landed = await page.evaluate(() => {
    const target = document.getElementById('contact-us');
    const header = document.querySelector('.elementor-sticky--active');
    return { y: Math.round(window.scrollY),
      clearance: Math.round(target.getBoundingClientRect().top - header.getBoundingClientRect().height) };
  });
  // Production lands at scrollY 6277 with 23px of clearance below the pinned
  // header (measured at 1440 with scripts/probe-anchor); the clone matches it.
  check('anchor: lands where production lands', Math.abs(landed.y - 6277) < 6, `scrollY ${landed.y}`);
  check('anchor: target clears the pinned header', landed.clearance > 0 && landed.clearance < 40,
    `${landed.clearance}px below it`);
  await ctx.close();
}

/* ---------------------------------------------------------------- video widget */
{
  const { ctx, page } = await open('/free-training/');
  check('video: the placeholder div is replaced by the iframe, not wrapped',
    (await page.$$('div.elementor-video')).length === 0 && (await page.$$('iframe.elementor-video')).length === 6);
  const src = await page.$eval('iframe.elementor-video', (f) => f.getAttribute('src'));
  check('video: embeds the YouTube id from data-settings',
    src.startsWith('https://www.youtube.com/embed/XHOmBV4js_E?') && src.includes('controls=1'), src.slice(0, 70));
  check('video: keeps the wrapper aspect-ratio chain', await page.$eval('iframe.elementor-video', (f) => {
    const r = f.getBoundingClientRect();
    return r.height > 100 && Math.abs(r.width / r.height - 16 / 9) < 0.2;
  }));
  await ctx.close();
}

/* ---------------------------------------------------------------- media carousel */
for (const [width, perView, space] of [[1440, 5, 0], [900, 2, 10], [390, 1, 10]]) {
  const { ctx, page } = await open('/about/', width, 900);
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => {
    const el = document.querySelector('.elementor-main-swiper');
    const wrap = el.querySelector('.swiper-wrapper');
    const slides = [...wrap.children];
    return {
      classes: el.className,
      count: slides.length,
      duplicates: slides.filter((s) => s.classList.contains('swiper-slide-duplicate')).length,
      widths: [...new Set(slides.map((s) => Math.round(s.getBoundingClientRect().width * 10) / 10))],
      gap: parseFloat(slides[0].style.marginRight || '0'),
      transform: wrap.style.transform,
      active: slides.findIndex((s) => s.classList.contains('swiper-slide-active')),
      activeIndex: slides.find((s) => s.classList.contains('swiper-slide-active'))?.dataset.swiperSlideIndex,
      containerW: Math.round(el.getBoundingClientRect().width),
      visible: slides.filter((s) => {
        const r = s.getBoundingClientRect(), c = el.getBoundingClientRect();
        return r.right > c.left + 1 && r.left < c.right - 1;
      }).length,
    };
  });
  check(`carousel @${width}: initialised classes`,
    /swiper-initialized/.test(state.classes) && /swiper-horizontal/.test(state.classes));
  check(`carousel @${width}: ${perView} duplicates each side`,
    state.count === 5 + perView * 2 && state.duplicates === perView * 2, `${state.count} slides`);
  check(`carousel @${width}: slide width fills the track`, state.widths.length === 1
    && Math.abs(state.widths[0] - (state.containerW - space * (perView - 1)) / perView) < 1, `${state.widths[0]}px`);
  check(`carousel @${width}: ${space}px between slides`, state.gap === space, `${state.gap}px`);
  check(`carousel @${width}: opens on the first real slide`,
    state.active === perView && state.activeIndex === '0', `active at ${state.active}`);
  check(`carousel @${width}: shows ${perView} slide(s) at a time`, state.visible === perView, `${state.visible}`);

  const before = await page.$eval('.swiper-wrapper', (w) => w.style.transform);
  await page.locator('.elementor-swiper-button-next').click();
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const wrap = document.querySelector('.swiper-wrapper');
    const slides = [...wrap.children];
    return { transform: wrap.style.transform,
      activeIndex: slides.find((s) => s.classList.contains('swiper-slide-active'))?.dataset.swiperSlideIndex };
  });
  check(`carousel @${width}: the next arrow advances one slide`,
    after.activeIndex === '1' && after.transform !== before, `${before} → ${after.transform}`);
  await ctx.close();
}

/* ---------------------------------------------------------------- lead forms */
{
  const { ctx, page } = await open('/');
  const own = await page.$$('form.gm-form__form');
  if (own.length) {
    check('form: both widgets are replaced on the home page', own.length === 2);
    check('form: contact variant carries its four fields',
      (await page.$$('.gm-form--contact .gm-form__field')).length === 4);
    check('form: subscribe variant carries its two fields',
      (await page.$$('.gm-form--subscribe .gm-form__field')).length === 2);
    // The field itself keeps its intrinsic size; what hides it is the 1x1 clipped
    // wrapper around it. A bot filling the form by name still finds it.
    check('form: honeypot is hidden from people', await page.$eval('input[name="website"]', (hp) => {
      const wrap = hp.closest('.gm-form__hp');
      const r = wrap.getBoundingClientRect();
      const cs = getComputedStyle(wrap);
      return hp.tabIndex === -1 && r.width <= 1 && r.height <= 1
        && cs.overflow === 'hidden' && cs.clipPath !== 'none';
    }));
    check('form: required fields block submission',
      await page.$eval('form.gm-form__form', (f) => !f.checkValidity()));
    check('form: every field has a real label', await page.$$eval('.gm-form__field',
      (fields) => fields.every((f) => {
        const input = f.querySelector('input, textarea');
        return !!f.querySelector(`label[for="${input.id}"]`);
      })));
  } else {
    check('form: LeadConnector embeds retained while no endpoint is configured',
      (await page.$$('iframe[src*="verified.trustymail.co/widget/form"]')).length === 2);
    check('form: the subscribe embed is on every page, via the footer',
      (await page.$$('footer iframe[src*="fLnKCikdak4YmU1PBIUQ"]')).length === 1);
  }
  await ctx.close();
}

/* ---------------------------------------------------------------- chat widget */
{
  const { ctx, page } = await open('/');
  check('chat: the GoHighLevel bubble element is on the page', await page.evaluate(() => {
    const el = document.querySelector('chat-widget');
    return !!el && el.getAttribute('location-id') === 'nB1dgSjTylng4YMB6pV8';
  }));
  await ctx.close();
}

/* ---------------------------------------------------------------- images */
// LiteSpeed's lazy-load rewrite is undone at extract time, so nothing on the page
// should still be waiting for a data-src swap (playbook §3.10: visible images only).
{
  const { ctx, page } = await open('/');
  await page.waitForTimeout(800);
  check('images: no LiteSpeed placeholders survive', await page.evaluate(() =>
    document.querySelectorAll('img[data-lazyloaded], img[src^="data:image/gif"]').length === 0));
  check('images: every image above the fold has decoded', await page.evaluate(() =>
    [...document.images]
      .filter((i) => i.getBoundingClientRect().top < window.innerHeight && i.getBoundingClientRect().height > 0)
      .every((i) => i.complete && i.naturalWidth > 0)));
  await ctx.close();
}

/* ---------------------------------------------------------------- 404 */
{
  const { ctx, page } = await open('/no-such-page-here/');
  check('404: unknown URLs get the theme\'s own page', await page.evaluate(() =>
    document.body.classList.contains('error404') && !!document.querySelector('header .elementor-nav-menu')));
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exitCode = 1;
}
