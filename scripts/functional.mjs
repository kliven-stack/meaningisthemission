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
  // The lead widgets and the chat bubble are third-party and slow; the opt-in one
  // covers the viewport five seconds in, which would sit on top of everything under
  // test here. Blocked, exactly as scripts/compare.mjs blocks them.
  await ctx.route('**://verified.trustymail.co/**', (r) => r.abort());
  await ctx.route('**://*.leadconnectorhq.com/**', (r) => r.abort());
  await ctx.route('**://firebasestorage.googleapis.com/**', (r) => r.abort());
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
/** The header's two nav widgets: horizontal from tablet up, burger at mobile. */
const DESKTOP_NAV = `${HEADER} .elementor-element-ba334cc`;
const BURGER_NAV = `${HEADER} .elementor-element-3a564cd`;

/* ---------------------------------------------------------------- desktop nav */
// `elementor-hidden-mobile` on the horizontal widget and `elementor-hidden-desktop
// elementor-hidden-tablet` on the burger: the menu shows at tablet and up, the
// burger takes over at ≤767.
for (const width of [1440, 900]) {
  const { ctx, page } = await open('/work-book/', width, 900);
  const items = await page.$$eval(`${DESKTOP_NAV} .elementor-nav-menu--main .elementor-item`,
    (els) => els.map((a) => `${a.textContent.trim()}→${a.getAttribute('href')}`));
  check(`nav @${width}: desktop menu renders its three items`, items.length === 3, items.join(', '));
  check(`nav @${width}: current page is marked active`, await page.$eval(
    `${DESKTOP_NAV} .elementor-nav-menu--main .elementor-item-active`,
    (a) => a.getAttribute('href') === '/work-book/' && a.getAttribute('aria-current') === 'page'));
  check(`nav @${width}: horizontal menu is visible`,
    await page.locator(`${DESKTOP_NAV} .elementor-nav-menu--main`).first().isVisible());
  check(`nav @${width}: burger is hidden`,
    !(await page.locator(`${BURGER_NAV} .elementor-menu-toggle`).first().isVisible()));
  // No submenu anywhere on this site, so there is no hover-dropdown to keep open
  // (playbook §3.11 does not apply here) — assert that stays true.
  check(`nav @${width}: no submenu parents to open`, (await page.$$('header .menu-item-has-children')).length === 0);
  check(`nav @${width}: the "Get the book" button opens Amazon in a new tab`, await page.$eval(
    `${HEADER} .elementor-button-link`,
    (a) => a.getAttribute('href').startsWith('https://a.co/') && a.target === '_blank'));
  await ctx.close();
}

/* ---------------------------------------------------------------- burger menu */
for (const width of [767, 390]) {
  const { ctx, page } = await open('/work-book/', width, 844);
  const toggle = `${BURGER_NAV} .elementor-menu-toggle`;
  const panel = `${BURGER_NAV} nav.elementor-nav-menu--dropdown`;

  const height = () => page.$eval(panel, (n) => Math.round(n.getBoundingClientRect().height));
  check(`burger @${width}: toggle is visible`, await page.locator(toggle).first().isVisible());
  check(`burger @${width}: toggle carries its button semantics`, await page.$eval(toggle,
    (t) => t.getAttribute('role') === 'button' && t.tabIndex === 0 && t.getAttribute('aria-expanded') === 'false'));
  check(`burger @${width}: panel starts collapsed`, (await height()) === 0);
  check(`burger @${width}: panel holds the mobile menu's four items`,
    (await page.$$(`${panel} .elementor-item`)).length === 4);

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
  const { ctx, page } = await open('/work-book/');
  check('sticky: pinned and spacer inserted', await page.evaluate((s) => {
    const el = document.querySelector(s);
    const spacer = document.querySelector('header .elementor-sticky__spacer');
    return !!el && !!spacer && getComputedStyle(el).position === 'fixed'
      && Math.abs(el.getBoundingClientRect().height - spacer.getBoundingClientRect().height) < 2;
  }, HEADER));
  check('sticky: no effects class at rest', !(await page.$eval(HEADER,
    (el) => el.classList.contains('elementor-sticky--effects'))));
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(400);
  check('sticky: effects class past the 5px offset', await page.$eval(HEADER,
    (el) => el.classList.contains('elementor-sticky--effects')));
  check('sticky: header stays at the top of the viewport', await page.$eval(HEADER,
    (el) => Math.round(el.getBoundingClientRect().top) === 0));
  // The theme's custom CSS repaints the header black once it has effects.
  check('sticky: effects state repaints the bar', await page.$eval(HEADER,
    (el) => getComputedStyle(el).backgroundColor === 'rgb(0, 0, 0)'),
    await page.$eval(HEADER, (el) => getComputedStyle(el).backgroundColor));
  await ctx.close();
}

/* ---------------------------------------------------------------- in-page anchor */
{
  const { ctx, page } = await open('/work-book/');
  check('anchor: the target the hero button points at exists', (await page.$$('#wtbm')).length === 1);
  await page.locator('a[href$="#wtbm"]').first().click();
  await page.waitForTimeout(1500);
  const landed = await page.evaluate(() => {
    const target = document.getElementById('wtbm');
    const header = document.querySelector('.elementor-sticky--active');
    return {
      y: Math.round(window.scrollY),
      top: Math.round(target.getBoundingClientRect().top),
      headerH: Math.round(header.getBoundingClientRect().height),
      hash: location.hash,
    };
  });
  // Production lands at scrollY 605 with the target's top at 0 — under the pinned
  // header, because the section's `sticky_anchor_link_offset` is 0 (measured with
  // _extract/probe/anchor.mjs). Cloned faithfully; see the README's original-site
  // bugs.
  check('anchor: lands where production lands', Math.abs(landed.y - 605) < 6, `scrollY ${landed.y}`);
  check('anchor: target sits at the viewport top, as on production',
    Math.abs(landed.top) < 4, `top ${landed.top}px`);
  check('anchor: the hash is written to the URL', landed.hash === '#wtbm', landed.hash);
  await ctx.close();
}

/* ---------------------------------------------------------------- testimonials */
// One slide per view at every breakpoint, 10px apart, looped — so seven quotes
// become nine slides with a duplicate at each end.
for (const width of [1440, 900, 390]) {
  const { ctx, page } = await open('/', width, 900);
  await page.waitForTimeout(600);
  const read = () => page.evaluate(() => {
    const el = document.querySelector('.eael-testimonial-slider-main');
    const wrap = el.querySelector('.swiper-wrapper');
    const slides = [...wrap.children];
    const active = slides.find((s) => s.classList.contains('swiper-slide-active'));
    return {
      classes: el.className,
      count: slides.length,
      duplicates: slides.filter((s) => s.classList.contains('swiper-slide-duplicate')).length,
      widths: [...new Set(slides.map((s) => Math.round(s.getBoundingClientRect().width * 10) / 10))],
      gap: parseFloat(slides[0].style.marginRight || '0'),
      transform: wrap.style.transform,
      wrapperH: Math.round(wrap.getBoundingClientRect().height),
      activeH: Math.round(active.getBoundingClientRect().height),
      activeAt: slides.indexOf(active),
      activeIndex: active.dataset.swiperSlideIndex,
      containerW: Math.round(el.getBoundingClientRect().width),
      visible: slides.filter((s) => {
        const r = s.getBoundingClientRect(), c = el.getBoundingClientRect();
        return r.right > c.left + 1 && r.left < c.right - 1;
      }).length,
      labelled: slides.every((s) => s.getAttribute('role') === 'group' && /^\d \/ 7$/.test(s.getAttribute('aria-label'))),
    };
  });

  const state = await read();
  check(`slider @${width}: initialised classes`,
    /swiper-initialized/.test(state.classes) && /swiper-horizontal/.test(state.classes)
    && /swiper-autoheight/.test(state.classes) && /swiper-backface-hidden/.test(state.classes));
  check(`slider @${width}: seven quotes plus one duplicate each side`,
    state.count === 9 && state.duplicates === 2, `${state.count} slides`);
  check(`slider @${width}: slide width fills the track`,
    state.widths.length === 1 && Math.abs(state.widths[0] - state.containerW) < 1, `${state.widths[0]}px`);
  check(`slider @${width}: 10px between slides`, state.gap === 10, `${state.gap}px`);
  check(`slider @${width}: opens on the first real quote`,
    state.activeAt === 1 && state.activeIndex === '0', `active at ${state.activeAt}`);
  check(`slider @${width}: shows one quote at a time`, state.visible === 1, `${state.visible}`);
  check(`slider @${width}: autoHeight sizes the wrapper to the active quote`,
    Math.abs(state.wrapperH - state.activeH) < 2, `${state.wrapperH} vs ${state.activeH}`);
  check(`slider @${width}: every slide is a labelled group`, state.labelled);

  await page.locator('.swiper-button-next').first().click();
  await page.waitForTimeout(1400);
  const next = await read();
  check(`slider @${width}: the next arrow advances one quote`,
    next.activeIndex === '1' && next.transform !== state.transform,
    `${state.transform} → ${next.transform}`);
  check(`slider @${width}: autoHeight follows the new quote`,
    Math.abs(next.wrapperH - next.activeH) < 2, `${next.wrapperH} vs ${next.activeH}`);

  // Backwards past the start is what the loop duplicates are for.
  await page.locator('.swiper-button-prev').first().click();
  await page.waitForTimeout(1400);
  await page.locator('.swiper-button-prev').first().click();
  await page.waitForTimeout(1400);
  const back = await read();
  check(`slider @${width}: wraps backwards onto the last quote`,
    back.activeIndex === '6' && back.visible === 1, `index ${back.activeIndex}`);
  await ctx.close();
}

/* ---------------------------------------------------------------- speaking popup */
{
  const { ctx, page } = await open('/speaking/');
  check('popup: nothing is in the document at rest, as on production',
    (await page.$$('[data-elementor-type="popup"]')).length === 0
    && (await page.$$('template[data-elementor-popup="210"]')).length === 1);

  await page.locator('a[href^="#elementor-action"]').first().click();
  await page.waitForTimeout(600);
  check('popup: the "Let\'s talk" button opens modal 210', await page.evaluate(() => {
    const modal = document.getElementById('elementor-popup-modal-210');
    if (!modal) return false;
    const inner = modal.querySelector('[data-elementor-type="popup"]');
    return modal.classList.contains('elementor-popup-modal')
      && modal.classList.contains('dialog-type-lightbox')
      && modal.getAttribute('aria-modal') === 'true'
      && !!modal.querySelector('.dialog-widget-content.dialog-lightbox-widget-content.animated')
      && !!modal.querySelector('.dialog-message.dialog-lightbox-message')
      && !!inner && inner.style.display === 'block'
      && document.body.classList.contains('dialog-lightbox-container');
  }));
  check('popup: the modal is on screen and centred', await page.$eval('#elementor-popup-modal-210', (m) => {
    const r = m.getBoundingClientRect();
    const c = getComputedStyle(m);
    return r.width > 0 && r.height > 0 && c.justifyContent === 'center' && c.alignItems === 'center';
  }));
  check('popup: the form the WordPress site puts in it is there', await page.evaluate(() =>
    !!document.querySelector('#elementor-popup-modal-210 iframe[src*="lM6u6ScOak0DXiTd8qge"]')
    || !!document.querySelector('#elementor-popup-modal-210 form.gm-form__form')));

  await page.locator('#elementor-popup-modal-210 .dialog-close-button').click();
  await page.waitForTimeout(400);
  check('popup: the close button hides it again', await page.evaluate(() =>
    document.getElementById('elementor-popup-modal-210').style.display === 'none'
    && !document.body.classList.contains('dialog-lightbox-container')));

  await page.locator('a[href^="#elementor-action"]').first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('popup: Escape closes it', await page.evaluate(() =>
    document.getElementById('elementor-popup-modal-210').style.display === 'none'));
  check('popup: the action href never navigates', page.url().endsWith('/speaking/'), page.url());
  await ctx.close();
}

/* ---------------------------------------------------------------- lead forms */
{
  const { ctx, page } = await open('/');
  const own = await page.$$('form.gm-form__form');
  if (own.length) {
    check('form: the opt-in popup is our own form', own.length === 1);
    check('form: it stays hidden until its five-second trigger',
      await page.$eval('#gm-optin', (el) => el.hidden));
    await page.waitForTimeout(5200);
    check('form: it opens after five seconds', await page.$eval('#gm-optin', (el) => !el.hidden));
    check('form: chapter variant carries its two fields',
      (await page.$$('.gm-form--chapter .gm-form__field')).length === 2);
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
        const input = f.querySelector('input, textarea, select');
        return !!f.querySelector(`label[for="${input.id}"]`);
      })));
    await page.locator('.gm-optin__close').click();
    await page.waitForTimeout(300);
    check('form: the popup closes', await page.$eval('#gm-optin', (el) => el.hidden));
  } else {
    check('form: the opt-in embed is retained while no endpoint is configured',
      (await page.$$('iframe[src*="b2amYJxAnRCZT9gR8iND"]')).length === 1);
    check('form: its loader script travels with it',
      (await page.$$('script[src*="verified.trustymail.co/js/form_embed.js"]')).length === 1);
    const { ctx: c2, page: p2 } = await open('/speaking/');
    await p2.locator('a[href^="#elementor-action"]').first().click();
    await p2.waitForTimeout(500);
    check('form: the speaking embed is retained inside the popup',
      (await p2.$$('#elementor-popup-modal-210 iframe[src*="lM6u6ScOak0DXiTd8qge"]')).length === 1);
    await c2.close();
  }
  await ctx.close();
}

/* ---------------------------------------------------------------- chat widget */
{
  const { ctx, page } = await open('/');
  check('chat: the GoHighLevel bubble element is on the page', await page.evaluate(() => {
    const el = document.querySelector('chat-widget');
    return !!el && el.getAttribute('location-id') === 'mBcn9uyxLoH0epkheHbN';
  }));
  await ctx.close();
}

/* ---------------------------------------------------------------- templates */
// The home page uses Elementor's canvas template: no header, no footer, no skip
// link. Every other page has all three.
{
  const { ctx, page } = await open('/');
  check('canvas: the home page has no header or footer, as on production',
    (await page.$$('header.elementor-location-header')).length === 0
    && (await page.$$('footer.elementor-location-footer')).length === 0
    && (await page.$$('a.skip-link')).length === 0);
  check('canvas: it keeps its own viewport meta', await page.$eval('meta[name="viewport"]',
    (m) => m.content === 'width=device-width, initial-scale=1.0, viewport-fit=cover'), '');
  await ctx.close();
}
{
  const { ctx, page } = await open('/terms-of-use/');
  check('header/footer template: header, footer and skip link all present',
    (await page.$$('header.elementor-location-header')).length === 1
    && (await page.$$('footer.elementor-location-footer')).length === 1
    && (await page.$$('a.skip-link[href="#content"]')).length === 1);
  await ctx.close();
}

/* ---------------------------------------------------------------- fonts */
// Self-hosted, latin only, and no connection to fonts.googleapis.com (playbook §2).
// The WordPress pages link Lato and Oswald straight from Google; the clone serves
// the same faces from public/wp/fonts/.
//
// The embeds are blocked here as everywhere else, and that is the honest scope for
// this check: while the original LeadConnector widgets are retained they pull
// Google Fonts and a Facebook pixel from inside their own iframe, which is the
// third party's connection, not the page's. Configuring PUBLIC_CONTACT_ENDPOINT
// swaps them for our own forms and that goes away too.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**://verified.trustymail.co/**', (r) => r.abort());
  await ctx.route('**://*.leadconnectorhq.com/**', (r) => r.abort());
  const external = [];
  ctx.on('request', (r) => {
    const host = new URL(r.url()).host;
    if (host !== 'localhost:4321') external.push(r.url());
  });
  const page = await ctx.newPage();
  await page.goto(ORIGIN + '/work-book/', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  check('fonts: the page itself contacts no font CDN',
    !external.some((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), external.join(', '));
  check('fonts: every stylesheet and font the page links is same-origin',
    await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"], link[as="font"]')]
      .every((l) => new URL(l.href).origin === location.origin)));
  // `.elementor-heading-title`, not a bare `h1, h2`: with the endpoint configured
  // the opt-in form's own heading is the first h2 in the document, and it is
  // deliberately set in the widget's Open Sans rather than the kit's Oswald.
  check('fonts: headings render in Oswald', await page.$eval('.elementor-heading-title',
    (h) => getComputedStyle(h).fontFamily.startsWith('Oswald')),
    await page.$eval('.elementor-heading-title', (h) => getComputedStyle(h).fontFamily));
  check('fonts: both families actually loaded', await page.evaluate(() => {
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
    return loaded.includes('Oswald') && loaded.includes('Lato');
  }));
  await ctx.close();
}

/* ---------------------------------------------------------------- images */
{
  const { ctx, page } = await open('/');
  await page.waitForTimeout(800);
  check('images: every image above the fold has decoded', await page.evaluate(() =>
    [...document.images]
      .filter((i) => i.getBoundingClientRect().top < window.innerHeight && i.getBoundingClientRect().height > 0)
      .every((i) => i.complete && i.naturalWidth > 0)));
  await ctx.close();
}

/* ---------------------------------------------------------------- routes */
{
  const { ctx, page } = await open('/no-such-page-here/');
  check("404: unknown URLs get the theme's own page", await page.evaluate(() =>
    document.body.classList.contains('error404') && !!document.querySelector('header .elementor-nav-menu')));
  await ctx.close();
}
{
  // /home/ is the front page's own slug; WordPress 301s it to /.
  const res = await fetch(ORIGIN + '/home', { redirect: 'manual' });
  check('redirect: /home → /', res.status === 308 && res.headers.get('location') === '/',
    `${res.status} ${res.headers.get('location')}`);
}
for (const path of ['/', '/speaking/', '/tools-sales-page/', '/work-book/', '/terms-of-use/',
  '/privacy-policy/', '/category/uncategorized/', '/author/admin/']) {
  const res = await fetch(ORIGIN + path);
  check(`route: ${path} resolves`, res.status === 200, String(res.status));
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exitCode = 1;
}
