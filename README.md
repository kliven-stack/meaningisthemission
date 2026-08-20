# meaningisthemission.com — Astro clone

A pixel-faithful static clone of the WordPress/Elementor site at
<https://meaningisthemission.com>, built to the team's
[migration playbook](../MIGRATION-PLAYBOOK.md). Astro 5, `output: 'static'`, no UI
framework, no serverless functions — the lead forms post straight from the browser to
the Growthmap endpoint (playbook §4b).

9 routes: 6 Elementor pages, the category and author archives, and the theme's 404
template. The site has no blog posts.

| Route | WordPress template |
| --- | --- |
| `/` | Elementor **canvas** — no header, no footer, no skip link |
| `/tools-sales-page/` ("Look Inside The Book") | default page template |
| `/work-book/` | Elementor header/footer |
| `/speaking/` ("Hire Mike To Speak") | default page template, plus popup template 210 |
| `/terms-of-use/` | Elementor header/footer |
| `/privacy-policy/` | Elementor header/footer |
| `/category/uncategorized/` | theme archive (empty, `noindex`) |
| `/author/admin/` | theme archive (empty, `noindex`) |
| `/404/` → `dist/404.html` | theme 404 |

The last three were not on any list: the site publishes **no sitemap at all**, so the
page inventory came from the REST API (`/wp-json/wp/v2/pages`) plus link discovery,
and the two archives were found by probing URLs WordPress still answers. Both are
empty and `noindex, nofollow` on production, but they resolve — and a URL that
resolves on WordPress and 404s here after cutover is a regression, not an
out-of-scope note (playbook §1). They are cloned and kept out of the sitemap.

---

## How the clone is put together

The site is Elementor 4.2.2 + Elementor Pro on `hello-elementor` and a child theme,
with Essential Addons and Ultimate Addons, behind LiteSpeed Cache. Fidelity comes from
shipping **Elementor's own compiled CSS verbatim**, in the exact order each page
linked it, rather than re-deriving any of it:

```
_extract/html/*.html        crawled WordPress HTML (gitignored; `npm run crawl`)
public/wp/css/*.css         one file per WordPress stylesheet handle, plus the
                            inline <style> blocks, URLs rewritten root-relative
public/wp/fonts/*.woff2     Lato, Oswald, Montserrat and Open Sans, latin only
public/wp-content/…         every image and icon font the pages reference
src/fragments/*.html        rendered Elementor markup, split header / content /
                            footer / popup, URLs rewritten
src/data/pages.json         per page: path, title, body class, viewport, favicons,
                            the ordered stylesheet list, which fragments to use
src/pages/[...slug].astro   one route renders all of it
src/scripts/elementor.js    replaces the WordPress JS (see below)
```

`src/styles/global.css` is Tailwind v4 **without preflight** and with `source(none)` —
a reset or a stray utility-name collision would repaint the ported markup. Only
`src/components` and `src/pages` are scanned.

### Fonts

WordPress links Lato and Oswald straight from `fonts.googleapis.com`. Both are
self-hosted here, latin and latin-ext only, `font-display: swap`, with the three
above-the-fold faces preloaded (playbook §2). Montserrat and Open Sans are self-hosted
too — they are what the LeadConnector form widgets render in, so the replacement forms
keep the same type. `npm run fonts` rebuilds all four.

### What replaced the WordPress JavaScript

`src/scripts/elementor.js` (~500 lines) stands in for elementor-frontend,
elementor-pro-frontend (sticky and popup), SmartMenus, e-sticky, Swiper, the Essential
Addons testimonial bundle and jQuery. It reproduces the **DOM contract** those scripts
created — the classes, inline styles and injected nodes the compiled CSS depends on —
each one read off the live post-init DOM with `npm run inspect`
(`scripts/inspect-live.mjs`) and the probes in `_extract/probe/`:

| Feature | Contract |
| --- | --- |
| Environment | `e--ua-*` classes on `<body>` (Elementor's Safari sheet keys off them), plus the two inert nodes it appends last: `#elementor-device-mode` and the empty `.e-font-icon-svg-symbols` sprite |
| Sticky header | pinned copy + a visibility-hidden `elementor-sticky__spacer` clone; `elementor-sticky--effects` past the 5px offset, which the theme's CSS repaints black |
| Burger menu | two nav widgets — horizontal from tablet up, burger at ≤767. On open Elementor writes `--menu-height` = the space left below the panel, which the CSS uses as `max-height`; the stretch option pins the panel to the viewport with inline `width`/`left`/`top` |
| In-page anchor | scrolls the target to the top of the viewport, offset by the section's `sticky_anchor_link_offset` (0 here — see the bugs below) |
| Popup | Elementor Pro keeps the template out of the document until opened; a `<template>` does the same, and `openPopup()` builds the `dialog-widget` / `dialog-message` structure around a clone and adds the four `dialog-*` classes to `<body>` |
| Testimonial slider | Swiper's loop/duplicate/class/transform/autoHeight contract at the measured 1 slide per view and 10px gap, seven quotes plus one duplicate each side |

The site has no submenus anywhere, so the hover-dropdown close-delay pitfall
(playbook §3.11) does not arise — a functional test asserts that stays true.

The GoHighLevel chat bubble (`<chat-widget>` + its loader) is kept as-is; it is the
client's own property and outlives the WordPress install. `PUBLIC_CHAT_WIDGET=off`
removes it.

---

## Forms

Two LeadConnector ("Trustymail") widgets are embedded on the WordPress site. WPForms
is installed and loads its 40 KB stylesheet on every page, but renders no form
anywhere.

| Variant | Where | Fields |
| --- | --- | --- |
| `chapter` | "Free Chapter Opt In" — a popup **every page** opens 5s after load, at most 3 times per visitor | Full Name\*, Email\*, consent |
| `speaking` | "Speaking Inquiry Form" — inside the Elementor popup /speaking/ opens from its "Let's talk" button | event name, start date, attendee count, In Person / Virtual / Hybrid, location, notes, Your Name\*, Business Email\*, Phone\*, consent |

`src/components/ContactForm.astro` replaces both with static forms that POST
`FormData` to `PUBLIC_CONTACT_ENDPOINT`: inline success/error via `aria-live`, button
disabled in flight, a CSS-hidden `website` honeypot, native validation.
`src/components/OptInPopup.astro` wraps the first in a shell that reproduces the
widget's five-second trigger, three-show cap and the theme's navy-gradient overlay.
Field set, copy, placeholders, select options, consent text, colours (`#eceef2`
fields, `#851577` button), radii and paddings were measured off the live widgets with
`npm run form:inspect`.

**Until `PUBLIC_CONTACT_ENDPOINT` is set, the original embeds ship instead** — a
deploy before the endpoint exists never replaces a working form with a dead one. Set
the variable in Vercel and the next build swaps them.

One deliberate difference: the widgets mark nothing `required`, so a blank submission
reaches GoHighLevel and the asterisks are decoration. Ours use native validation on
the fields the asterisks claim are required.

Note that while the embeds are retained they pull Google Fonts and a Facebook pixel
from inside their own iframe. Those go away with the swap; the chat bubble stays.

---

## Original-site bugs, cloned faithfully

Everything here reproduces production exactly. Each has a one-line fix ready — say the
word and it ships.

1. **Every page is `noindex, nofollow`.** Including the home page, and including what
   Googlebot is served. The site is invisible to search. Nothing in `robots.txt`
   suggests it is intentional. → `PUBLIC_NOINDEX=off` drops the tag; the clone already
   publishes a sitemap.
2. **No sitemap and no SEO metadata at all.** No SEO plugin is installed:
   `/sitemap.xml` redirects to `/wp-sitemap.xml`, which 404s. No page has a meta
   description, Open Graph tag, Twitter card or schema.org markup, so every share
   preview falls back to whatever the scraper can guess. → the clone publishes
   `/sitemap-index.xml`; descriptions and OG tags need copy from the client.
3. **`/`, `/speaking/` and `/work-book/` have no `<h1>`.** All three open with an
   `<h2>` instead.
4. **The opt-in popup's background image 404s.** The theme's custom CSS paints
   `.ep-popup` with `url(/wp-content/uploads/2024/03/47122-1.jpgcontent/uploads/2024/03/47122-1.jpg)`
   — the path pasted over itself, minus its first segment. The real file is there at
   `…/47122-1.jpg`. Only the gradient behind it has ever shown. → delete the duplicated
   half of the URL.
5. **The `#wtbm` anchor on /work-book/ lands under the sticky header.** The header
   section's `sticky_anchor_link_offset` is 0, so clicking the hero button scrolls the
   target's top to y=0 and the 101px header covers it. → set the offset in Elementor.
6. **Two dead outbound links.** `/privacy-policy/` links `https://getonup.io/`
   (NXDOMAIN) and `/terms-of-use/` links `https://www.teamonup.com/privacy-policy`
   (404). Verified 2026-08-20.
7. **"Download Speaker Media Kit" on /speaking/ points at `https://drive.google.com/`** —
   Drive's front door, not a file.
8. **The testimonial slider never advances.** Essential Addons prints no
   `data-autoplay_speed`, so its bundle falls back to a 999999 ms delay: autoplay is
   nominally on and fires roughly every 17 minutes. The arrows work. Also, the seventh
   quote ("Dangerous Dave Ruth, ThD") has an empty company line where the other six
   have one.
9. **WPForms ships on every page for nothing.** ~40 KB of CSS and its Elementor
   integration script load site-wide; no WPForms form exists. → deactivate the plugin.
10. **Favicon markup quirks.** The same SVG is linked four times, and the first link
    declares `type="image/png"`. Harmless, reproduced as served.
11. **The opt-in `<iframe>` is written into `<head>`.** An `<iframe>` is not head
    content, so every parser closes `<head>` at that point and moves the rest into
    `<body>` — which strands three favicon links, the `msapplication-TileImage` meta
    and (on the canvas-templated home page) the viewport meta outside `<head>`. The
    clone collects them and re-emits them from `<head>`, where WordPress meant them to
    be; nothing about the rendering changes.

---

## Verification

Run the harness against the production build, not the dev server:

```bash
npm run build
npm run serve          # dist/ on :4321 — check the <title> is this site's, not
                       # another clone's stale server (playbook §7.6)
npm run compare        # computed styles + bounding boxes vs production
npm run functional     # everything the diff cannot see
npm run audit          # every internal href / src / srcset / url() resolves in dist/
```

Latest run, 2026-08-20:

| Check | Result |
| --- | --- |
| `compare` at 1440 / 900 / 390 | **27 comparisons, 0 diffs** (88–411 landmark nodes per page) |
| Full-page pixel diff, 7 pages × 2 widths | **0.000%** differing pixels on 13 of 14; 0.006% on `/speaking/` @390 — JPEG re-encode noise inside one photo |
| `functional` | **106/106**, in both form modes |
| `audit` | 710 references, 0 regressions (1 known-broken, listed above) |

`compare.mjs` blocks the LeadConnector embeds and the chat bubble on both sides: the
opt-in popup covers the viewport five seconds in, and whether it had arrived yet would
decide every measurement. Its box is fixed-position and takes nothing out of the
page's flow, so blocking it costs the comparison nothing. `KEEP_EMBEDS=1` lets them
load — only meaningful when the widget host does not reset the connection, which it
does at random.

### Images

The uploads were unprocessed exports: **64.5 MB → 7.1 MB**, re-encoded in place at the
same filenames and the same pixel dimensions, so no markup changed and the fidelity
diff is unaffected. One documented exception, worth 55 MB of the 57: an 8611 × 5740
camera original stored twice and referenced **only** from Elementor's compiled CSS as
a `background-size: cover` layer. Nothing declares a width for it and no srcset names
it, so images in exactly that position are capped at 2560px. The diff above was re-run
afterwards.

---

## Local development

```bash
npm install
npm run dev            # http://localhost:4321
npm run build
```

`npm run preview` works — the site is fully static, with no Vercel adapter.

### Re-running the pipeline

```bash
npm run crawl          # fetch the live pages into _extract/html/ (FORCE=1 to refetch)
npm run css            # every stylesheet handle + the assets they reference
npm run fonts          # self-host Lato, Oswald, Montserrat, Open Sans
npm run extract        # split into fragments + src/data/pages.json
npm run media          # mirror every referenced image
npm run images         # re-encode the uploads (idempotent)
```

### Environment

Everything is documented in `.env.example`. All of it is optional; the defaults
reproduce production.

| Variable | Default | Effect |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | production domain | canonical tags and sitemap |
| `PUBLIC_CONTACT_ENDPOINT` | *(empty)* | set it and our forms replace the embeds |
| `PUBLIC_FORM_MODE` | `growthmap` | `embed` forces the originals back |
| `PUBLIC_CHAT_WIDGET` | `on` | the GoHighLevel bubble |
| `PUBLIC_OPT_IN_POPUP` | `on` | the five-second free-chapter popup |
| `PUBLIC_NOINDEX` | `on` | keeps WordPress's `noindex, nofollow` (bug 1) |

## Deployment

Import the repo at vercel.com/new; the standard config deploys with zero settings.
`vercel.json` carries the security headers and the redirects WordPress served
(`/home` → `/`, the sitemap aliases, the feeds). Set `PUBLIC_CONTACT_ENDPOINT` when the
Growthmap endpoint exists, then redeploy.
