/**
 * Runtime for the cloned Elementor markup.
 *
 * The pages ship Elementor's compiled CSS verbatim, so the job here is to reproduce
 * the *DOM contract* the WordPress JS created — the classes, inline styles and
 * injected nodes the stylesheets and the layout depend on — not to re-invent the
 * behaviour (playbook §3.12). Every contract below was read off the live site's
 * post-init DOM with scripts/inspect-live.mjs and the probes in _extract/probe/.
 *
 * Replaces: elementor-frontend, elementor-pro-frontend (sticky, popup), smartmenus,
 * e-sticky, Swiper, the Essential Addons testimonial-slider bundle and jQuery.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const onReady = (fn) =>
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, { once: true })
    : fn();

const settingsOf = (el) => {
  try { return JSON.parse(el.getAttribute('data-settings') || '{}'); } catch { return {}; }
};

/* ------------------------------------------------------------------ *
 * Environment classes
 *
 * Elementor stamps the browser/OS onto <body>; its stylesheets key rules off
 * `.e--ua-appleWebkit`, so Safari renders differently without them. The live site
 * shows `e--ua-blink e--ua-mac e--ua-webkit` in headless Chrome on macOS.
 * ------------------------------------------------------------------ */
function initEnvironment() {
  const ua = navigator.userAgent;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const flags = {
    webkit: /AppleWebKit/i.test(ua),
    blink: /Chrome/i.test(ua) && !/Edge/i.test(ua),
    safari: isSafari,
    appleWebkit: isSafari,
    firefox: /Firefox/i.test(ua),
    gecko: /Gecko\//i.test(ua) && /Firefox/i.test(ua),
    edge: /Edg\//i.test(ua),
    mac: /Mac/i.test(navigator.platform || ua),
    windows: /Win/i.test(navigator.platform || ua),
    linux: /Linux/i.test(navigator.platform || ua) && !/Android/i.test(ua),
  };
  for (const [key, on] of Object.entries(flags)) {
    if (on) document.body.classList.add(`e--ua-${key}`);
  }
}

/* ------------------------------------------------------------------ *
 * Background lazy-load
 *
 * Elementor prints a stylesheet that blanks background images on the 4th and later
 * top-level flex containers until JS marks them `.e-lazyloaded`. This site's pages
 * are all built from the older `elementor-section` structure, so there is nothing
 * to reveal — but the guard stylesheet ships on every page, so the counterpart runs
 * too, and a container added later cannot lose its background.
 * ------------------------------------------------------------------ */
function initLazyBackgrounds() {
  const targets = document.querySelectorAll('.e-con.e-parent:not(.e-no-lazyload)');
  if (!targets.length) return;
  const reveal = (el) => el.classList.add('e-lazyloaded');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(reveal);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      reveal(entry.target);
      io.unobserve(entry.target);
    }
  }, { rootMargin: '200px 0px' });
  targets.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------ *
 * Sticky sections (e-sticky)
 *
 * The header section is `sticky: top` with `sticky_effects_offset: 5`. Contract,
 * off the live header: the section gains `elementor-sticky elementor-sticky--active
 * elementor-section--handles-inside`, is pinned with inline `position: fixed;
 * width: <spacer width>px; margin-top: 0px; margin-bottom: 0px; top: 0px`, and a
 * visibility-hidden clone (`elementor-sticky elementor-sticky__spacer`, keeping its
 * data-settings and its element ids) is inserted after it to hold the space. Past
 * the 5px offset it also gains `elementor-sticky--effects`, which the compiled CSS
 * animates.
 * ------------------------------------------------------------------ */
function initSticky() {
  const els = [...document.querySelectorAll('[data-settings]')].filter((el) => {
    const s = settingsOf(el);
    return s.sticky === 'top' || s.sticky === 'bottom';
  });

  for (const el of els) {
    const s = settingsOf(el);
    const effectsOffset = Number(s.sticky_effects_offset) || 0;
    const offset = Number(s.sticky_offset) || 0;

    const spacer = el.cloneNode(true);
    spacer.classList.add('elementor-sticky', 'elementor-sticky__spacer');
    spacer.classList.remove('elementor-sticky--active', 'elementor-sticky--effects');
    spacer.setAttribute('style', 'visibility: hidden; transition: none; animation: auto ease 0s 1 normal none running none;');
    el.after(spacer);

    el.classList.add('elementor-sticky', 'elementor-sticky--active', 'elementor-section--handles-inside');

    const pin = () => {
      const width = spacer.getBoundingClientRect().width;
      el.style.cssText = `position: fixed; width: ${width}px; margin-top: 0px; margin-bottom: 0px; ${s.sticky === 'bottom' ? 'bottom' : 'top'}: ${offset}px;`;
    };
    const sync = () => {
      el.classList.toggle('elementor-sticky--effects', window.scrollY > effectsOffset);
    };

    pin();
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', () => { pin(); sync(); });
  }
}

/** Height of whatever sticky header is currently pinned, for anchor offsets. */
const stickyHeight = () => {
  const pinned = document.querySelector('.elementor-sticky--active');
  return pinned ? pinned.getBoundingClientRect().height : 0;
};

/* ------------------------------------------------------------------ *
 * Nav menu
 *
 * Two nav-menu widgets sit in the header: a horizontal one shown from tablet up
 * (`--dropdown-none`, so it has no toggle and SmartMenus only ever annotated its
 * lists) and a burger one shown at mobile only (`--stretch`). WordPress already
 * renders the toggle's `role`/`tabindex`/`aria-label`/`aria-expanded` and the
 * panel's `aria-hidden`, so what is left to reproduce is:
 *
 *   * `elementor-active` on the toggle while open, and `aria-expanded` tracking it;
 *   * the panel stretched to the viewport with inline `width`/`left`, and placed
 *     under the widget with inline `top` (live: `width: 390px; left: -303px;
 *     top: 42px` at 390, and `top: 0px` at 1440 where the widget is display:none);
 *   * on open Elementor writes `--menu-height` = the space left below the panel
 *     (`innerHeight - panel top`), which the compiled CSS uses as the panel's
 *     `max-height` — that, plus `transform: scaleY()`, is the whole animation.
 *
 * The menu has no submenus anywhere, so there is no hover-dropdown to keep open
 * (playbook §3.11 does not apply here).
 * ------------------------------------------------------------------ */
function initNavMenu(widget) {
  const dropdownNav = widget.querySelector('nav.elementor-nav-menu--dropdown');
  const toggle = widget.querySelector('.elementor-menu-toggle');
  const stretch = widget.classList.contains('elementor-nav-menu--stretch');
  if (!toggle || !dropdownNav) return;

  toggle.setAttribute('role', 'button');
  toggle.setAttribute('tabindex', '0');
  toggle.setAttribute('aria-label', 'Menu Toggle');

  /** Elementor's "stretch" option pins the panel to the viewport width. */
  const place = () => {
    const widgetRect = widget.getBoundingClientRect();
    dropdownNav.style.top = `${Math.round(widgetRect.height * 2) / 2}px`;
    if (!stretch) return;
    const left = dropdownNav.getBoundingClientRect().left - parseFloat(dropdownNav.style.left || '0');
    dropdownNav.style.width = `${document.documentElement.clientWidth}px`;
    dropdownNav.style.left = `${-left}px`;
  };

  const setOpen = (open) => {
    toggle.classList.toggle('elementor-active', open);
    toggle.setAttribute('aria-expanded', String(open));
    dropdownNav.setAttribute('aria-hidden', String(!open));
    if (open) {
      const top = dropdownNav.getBoundingClientRect().top;
      dropdownNav.style.setProperty('--menu-height', `${window.innerHeight - top}px`);
    } else {
      dropdownNav.style.removeProperty('--menu-height');
    }
  };

  place();
  setOpen(false);
  window.addEventListener('resize', () => {
    place();
    if (toggle.classList.contains('elementor-active')) setOpen(true);
  });

  const flip = () => setOpen(!toggle.classList.contains('elementor-active'));
  toggle.addEventListener('click', flip);
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
  });
  // Following a link closes the panel; so does Escape.
  dropdownNav.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.classList.contains('elementor-active')) setOpen(false);
  });
}

/* ------------------------------------------------------------------ *
 * In-page anchors
 *
 * /work-book/ links `#wtbm` from its hero button. Elementor scrolls to the target
 * smoothly and subtracts the pinned header's height, or it lands underneath it.
 * ------------------------------------------------------------------ */
function initAnchors() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href*="#"]');
    if (!link || link.target === '_blank') return;
    if (link.getAttribute('href').startsWith('#elementor-action')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname) return;
    const id = url.hash.slice(1);
    if (!id || id === 'content') return;
    const target = document.getElementById(id);
    if (!target) return;

    event.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - stickyHeight();
    window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    history.pushState(null, '', url.hash);
  });
}

/* ------------------------------------------------------------------ *
 * Popups (Elementor Pro)
 *
 * /speaking/ has one popup template, opened by its "Let's talk" button through an
 * `#elementor-action:action=popup:open&settings=<base64>` href. The template's own
 * trigger list is empty, so the link is the only way in.
 *
 * Contract, read off the live DOM after clicking that link (_extract/probe/):
 * a `.dialog-widget.dialog-lightbox-widget.dialog-type-buttons.dialog-type-lightbox
 * .elementor-popup-modal#elementor-popup-modal-<id>` is appended to <body> with
 * `aria-modal`, `role="document"` and `tabindex="0"`; inside it a
 * `.dialog-widget-content.dialog-lightbox-widget-content.animated` holds the close
 * button, an empty `.dialog-header` and a `.dialog-message` containing the popup
 * template with `style="display: block;"` (the compiled CSS hides
 * `[data-elementor-type=popup]` otherwise — playbook §3.12). <body> gains
 * `dialog-body dialog-lightbox-body dialog-container dialog-lightbox-container`.
 *
 * Elementor keeps the template out of the document until it is opened; BaseLayout
 * puts it in a <template> for the same reason, so this clones it on first open.
 * ------------------------------------------------------------------ */
const BODY_DIALOG_CLASSES = ['dialog-body', 'dialog-lightbox-body', 'dialog-container', 'dialog-lightbox-container'];
const openModals = new Map();

function openPopup(id) {
  let modal = openModals.get(id);
  if (!modal) {
    const template = document.querySelector(`template[data-elementor-popup="${id}"]`);
    if (!template) return;

    modal = document.createElement('div');
    modal.className = 'dialog-widget dialog-lightbox-widget dialog-type-buttons dialog-type-lightbox elementor-popup-modal';
    modal.id = `elementor-popup-modal-${id}`;
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'document');
    modal.tabIndex = 0;
    modal.innerHTML =
      '<div class="dialog-widget-content dialog-lightbox-widget-content animated">'
      + '<a role="button" tabindex="0" aria-label="Close" href="#" class="dialog-close-button dialog-lightbox-close-button"><i class="eicon-close"></i></a>'
      + '<div class="dialog-header dialog-lightbox-header"></div>'
      + '<div class="dialog-message dialog-lightbox-message"></div>'
      + '</div>';

    const message = modal.querySelector('.dialog-message');
    message.append(template.content.cloneNode(true));
    for (const el of message.querySelectorAll('[data-elementor-type="popup"]')) {
      el.style.display = 'block';
    }

    const close = (event) => { event?.preventDefault(); closePopup(id); };
    modal.querySelector('.dialog-close-button').addEventListener('click', close);
    // Clicking the backdrop — the modal itself, outside its content — closes it.
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close(event);
    });

    document.body.append(modal);
    openModals.set(id, modal);
    // Lets ContactForm.astro bind a form that did not exist at load time.
    document.dispatchEvent(new CustomEvent('gm:mounted', { detail: { root: modal } }));
  }

  modal.style.display = '';
  document.body.classList.add(...BODY_DIALOG_CLASSES);
  modal.focus();
}

function closePopup(id) {
  const modal = openModals.get(id);
  if (!modal) return;
  modal.style.display = 'none';
  document.body.classList.remove(...BODY_DIALOG_CLASSES);
}

function initPopups() {
  if (!document.querySelector('template[data-elementor-popup]')) return;

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#elementor-action"]');
    if (!link) return;
    // `#elementor-action:action=popup:open&settings=<base64 json>`, percent-encoded
    // in the href WordPress prints.
    const raw = decodeURIComponent(link.getAttribute('href').slice(1));
    const [, action] = /^elementor-action:action=([\w:]+)/.exec(raw) || [];
    const [, settings] = /settings=([\w+/=-]+)/.exec(raw) || [];
    if (!action || !settings) return;
    let id;
    try { id = JSON.parse(atob(settings.replace(/-/g, '+').replace(/_/g, '/'))).id; } catch { return; }
    event.preventDefault();
    if (action === 'popup:open') openPopup(id);
    else if (action === 'popup:close') closePopup(id);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const [id, modal] of openModals) {
      if (modal.style.display !== 'none') closePopup(id);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Testimonial slider (Essential Addons + Swiper)
 *
 * The "A LOOK Inside" quotes on the home page. Swiper's markup is load-bearing:
 * without the inline widths and the wrapper transform, all seven slides stack at
 * their CSS width and the section renders as a column of quotes.
 *
 * The options come from the widget's data-attributes, resolved through Essential
 * Addons' own defaults (public/wp/css/… has the styles; the logic is in the
 * per-post bundle `eael-32.js`):
 *
 *   slidesPerView 1 at every breakpoint, spaceBetween 10, slidesPerGroup 1,
 *   effect slide, speed 1000, loop true, autoHeight true, grabCursor false,
 *   autoplay delay 999999 — the widget prints no `data-autoplay_speed`, so the
 *   bundle's fallback leaves it nominally on but ~17 minutes apart. It never
 *   advances on its own, and neither does this (see the README's faithful quirks).
 *
 * Contract, read off the live DOM at 1440 and 390:
 *
 *   widget      + `e-widget-swiper`
 *   container   + `swiper-initialized swiper-horizontal swiper-pointer-events
 *                 swiper-autoheight`, and `swiper-backface-hidden` while the total
 *                 slide count is under Swiper's `maxBackfaceHiddenSlides` (10)
 *   wrapper       `transition-duration: <ms>; transform: translate3d(x,0,0);
 *                 height: <active slide>px` plus an id and `aria-live="off"`
 *   loop          one duplicate each side (slidesPerView), the last slide prepended
 *                 and the first appended, each keeping the source's
 *                 `data-swiper-slide-index`, `role="group"` and `aria-label="n / 7"`
 *   slides        inline `width` = containerWidth - space*(spv-1) / spv, and
 *                 `margin-right` = spaceBetween
 *   classes       active / next / prev on the real run, and duplicate-active /
 *                 duplicate-next / duplicate-prev on the elements that mirror them
 *   arrows        `tabindex="0" role="button" aria-label aria-controls=<wrapper id>`
 *   plus          a `<span class="swiper-notification" aria-live="assertive"
 *                 aria-atomic="true">` at the end of the container
 * ------------------------------------------------------------------ */
const EAEL_BREAKPOINTS = [
  { min: 1024, perView: 'items', space: 'margin' },
  { min: 768, perView: 'itemsTablet', space: 'marginTablet' },
  { min: 0, perView: 'itemsMobile', space: 'marginMobile' },
];

function initTestimonialSlider(widget) {
  const container = widget.querySelector('.eael-testimonial-slider-main');
  const wrapper = container?.querySelector('.swiper-wrapper');
  if (!wrapper) return;

  const data = container.dataset;
  const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));
  const config = {
    items: num(data.items, 3),
    itemsTablet: num(data.itemsTablet, 3),
    itemsMobile: num(data.itemsMobile, 3),
    margin: num(data.margin, 10),
    marginTablet: num(data.marginTablet, 10),
    marginMobile: num(data.marginMobile, 10),
    speed: num(data.speed, 400),
    loop: num(data.loop, 0) === 1,
  };

  const originals = [...wrapper.children];
  const total = originals.length;
  if (!total) return;

  originals.forEach((slide, i) => {
    slide.dataset.swiperSlideIndex = String(i);
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-label', `${i + 1} / ${total}`);
  });

  widget.classList.add('e-widget-swiper');
  container.classList.add('swiper-initialized', 'swiper-horizontal', 'swiper-pointer-events', 'swiper-autoheight');
  wrapper.id = `swiper-wrapper-${Math.random().toString(16).slice(2, 19)}`;
  wrapper.setAttribute('aria-live', 'off');

  const notification = document.createElement('span');
  notification.className = 'swiper-notification';
  notification.setAttribute('aria-live', 'assertive');
  notification.setAttribute('aria-atomic', 'true');
  container.append(notification);

  const breakpoint = () => {
    const width = window.innerWidth;
    const bp = EAEL_BREAKPOINTS.find((b) => width >= b.min);
    return { perView: config[bp.perView], space: config[bp.space] };
  };

  let slides = originals;
  let activeIndex = 0;
  let realIndex = 0;
  let step = 0;
  let animating = false;

  const setTranslate = (x, ms, height) => {
    wrapper.style.cssText = `transition-duration: ${ms}ms; transform: translate3d(${x}px, 0px, 0px); height: ${height}px;`;
  };

  /** autoHeight: the wrapper is exactly as tall as the slide on screen. */
  const activeHeight = () => Math.round(slides[activeIndex]?.getBoundingClientRect().height || 0);

  const markClasses = () => {
    for (const slide of slides) {
      slide.classList.remove('swiper-slide-active', 'swiper-slide-next', 'swiper-slide-prev',
        'swiper-slide-duplicate-active', 'swiper-slide-duplicate-next', 'swiper-slide-duplicate-prev');
    }
    const active = slides[activeIndex];
    active?.classList.add('swiper-slide-active');
    slides[activeIndex + 1]?.classList.add('swiper-slide-next');
    slides[activeIndex - 1]?.classList.add('swiper-slide-prev');
    if (!config.loop) return;

    // Swiper mirrors the active/next/prev marks onto the matching duplicate — or
    // onto the real slide, when the marked one is itself a duplicate.
    const mirror = (index, cls, source) => {
      const wanted = source?.classList.contains('swiper-slide-duplicate')
        ? ':not(.swiper-slide-duplicate)'
        : '.swiper-slide-duplicate';
      wrapper.querySelectorAll(`.swiper-slide${wanted}[data-swiper-slide-index="${index}"]`)
        .forEach((el) => el.classList.add(cls));
    };
    mirror(realIndex, 'swiper-slide-duplicate-active', active);
    mirror((realIndex + 1) % total, 'swiper-slide-duplicate-next', slides[activeIndex + 1]);
    mirror((realIndex - 1 + total) % total, 'swiper-slide-duplicate-prev', slides[activeIndex - 1]);
  };

  const duplicate = (el) => {
    const copy = el.cloneNode(true);
    copy.classList.add('swiper-slide-duplicate');
    return copy;
  };

  const layout = () => {
    const { perView, space } = breakpoint();

    // Rebuild the loop copies whenever the count changes with the breakpoint.
    if (config.loop) {
      for (const el of [...wrapper.children]) {
        if (el.classList.contains('swiper-slide-duplicate')) el.remove();
      }
      wrapper.prepend(...originals.slice(total - perView).map(duplicate));
      wrapper.append(...originals.slice(0, perView).map(duplicate));
      activeIndex = perView + realIndex;
    } else {
      activeIndex = realIndex;
    }
    slides = [...wrapper.children];

    container.classList.toggle('swiper-backface-hidden', slides.length < 10);

    const width = container.clientWidth;
    const slideWidth = Math.round(((width - space * (perView - 1)) / perView) * 1000) / 1000;
    step = slideWidth + space;
    for (const slide of slides) {
      slide.style.width = `${slideWidth}px`;
      slide.style.marginRight = `${space}px`;
    }

    markClasses();
    setTranslate(-step * activeIndex, 0, activeHeight());
  };

  const slideBy = (delta) => {
    if (animating) return;
    const target = activeIndex + delta;
    if (!config.loop && (target < 0 || target >= slides.length)) return;
    animating = true;
    activeIndex = target;
    realIndex = (realIndex + (delta % total) + total) % total;
    markClasses();
    setTranslate(-step * activeIndex, config.speed, activeHeight());
    setTimeout(() => {
      animating = false;
      if (!config.loop) return;
      // Loop fix: hop back onto the real run without a transition, exactly as
      // Swiper does once the duplicate has scrolled into place.
      const { perView } = breakpoint();
      if (activeIndex >= perView + total || activeIndex < perView) {
        activeIndex = perView + realIndex;
        markClasses();
        setTranslate(-step * activeIndex, 0, activeHeight());
      }
    }, config.speed);
  };

  for (const [selector, delta, label] of [
    [data.arrowNext, 1, 'Next slide'],
    [data.arrowPrev, -1, 'Previous slide'],
  ]) {
    const button = selector && widget.querySelector(selector);
    if (!button) continue;
    button.setAttribute('tabindex', '0');
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-controls', wrapper.id);
    button.addEventListener('click', () => slideBy(delta));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); slideBy(delta); }
    });
  }

  layout();
  window.addEventListener('resize', layout);
  // Web fonts land after first layout and change how the quotes wrap, which changes
  // the height autoHeight has just written.
  document.fonts?.ready.then(layout);

  /** Lets scripts/compare.mjs pin the carousel to a deterministic first slide. */
  container.eCarousel = { reset() { realIndex = 0; layout(); } };
}

/* ------------------------------------------------------------------ */
onReady(() => {
  initEnvironment();
  initLazyBackgrounds();
  initSticky();
  initAnchors();
  initPopups();

  for (const widget of document.querySelectorAll('[data-widget_type]')) {
    // The sticky spacer is a visibility-hidden clone; wiring its widgets up would
    // duplicate every document-level listener for no visible effect.
    if (widget.closest('.elementor-sticky__spacer')) continue;
    const type = widget.getAttribute('data-widget_type');
    if (type === 'nav-menu.default') initNavMenu(widget);
    else if (type === 'eael-testimonial-slider.default') initTestimonialSlider(widget);
  }
});
