// The WordPress pages embed two LeadConnector ("Trustymail") forms in iframes: the
// "Free Chapter Opt In" popup that every page shows after five seconds, and the
// "Speaking Inquiry Form" inside the Elementor popup /speaking/ opens from its
// "Let's talk" button. The widget host resets direct requests intermittently, so
// read them through the pages that embed them — the real field set, labels,
// rendered height at each breakpoint, and the box around them (playbook §7.5).
import { chromium } from 'playwright';

const ORIGIN = 'https://meaningisthemission.com';
const TARGETS = [
  ['/', 1440], ['/', 900], ['/', 390],
  // The speaking form only mounts once its Elementor popup is opened.
  ['/speaking/', 1440, 'popup'], ['/speaking/', 390, 'popup'],
];

const b = await chromium.launch();
for (const [path, width, open] of TARGETS) {
  const ctx = await b.newContext({ viewport: { width, height: 1200 } });
  const p = await ctx.newPage();
  await p.bringToFront();
  await p.goto(ORIGIN + path, { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(8000);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(3000);
  if (open === 'popup') {
    // The site's own opt-in popup covers the button, so trigger Elementor's
    // action directly rather than fighting the overlay for a real click.
    await p.evaluate(() => {
      const link = document.querySelector('a[href*="elementor-action"]');
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await p.waitForTimeout(6000);
  }

  console.log(`\n===== ${path} @${width}`);
  for (const el of await p.locator('iframe').all()) {
    const src = await el.getAttribute('src');
    const box = await el.boundingBox();
    const wrap = await el.evaluate((n) => {
      const w = n.closest('.elementor-widget-container');
      if (!w) return null;
      const r = w.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    console.log(`iframe ${src}`);
    console.log('  box:', box && { w: Math.round(box.width), h: Math.round(box.height) }, ' container:', wrap);
  }
  for (const frame of p.frames()) {
    if (!/trustymail|leadconnector|sybrware/.test(frame.url())) continue;
    try {
      const info = await frame.evaluate(() => ({
        height: document.body.scrollHeight,
        fields: [...document.querySelectorAll('input, select, textarea')]
          .filter((el) => el.type !== 'hidden')
          .map((el) => {
            const c = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return { tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || el.id || null,
              placeholder: el.placeholder || null, box: [Math.round(r.width), Math.round(r.height)],
              bg: c.backgroundColor, radius: c.borderRadius, pad: c.padding, font: `${c.fontFamily} ${c.fontSize}` };
          }),
        buttons: [...document.querySelectorAll('button, input[type=submit]')].map((el) => {
          const c = getComputedStyle(el); const r = el.getBoundingClientRect();
          return { text: (el.textContent || el.value || '').trim(), box: [Math.round(r.width), Math.round(r.height)],
            bg: c.backgroundColor, color: c.color, radius: c.borderRadius, font: `${c.fontFamily} ${c.fontSize} ${c.fontWeight}` };
        }).filter((x) => x.text),
      }));
      console.log('  frame:', frame.url());
      console.log('  ', JSON.stringify(info, null, 1).replace(/\n/g, '\n  '));
    } catch (e) { console.log('  frame read failed:', e.message.split('\n')[0]); }
  }
  await ctx.close();
}
await b.close();
