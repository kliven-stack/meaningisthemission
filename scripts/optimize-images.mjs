// The WordPress uploads are unprocessed exports — 65 MB for a site whose largest
// rendered image is 1180 px wide. Re-encode them in place: same filenames, same
// pixel dimensions, so no markup changes and the fidelity diff is unaffected. A
// manifest keeps the pass idempotent — re-running never re-compresses an
// already-compressed file.
//
// One documented exception to "same pixel dimensions", worth 55 MB of the 65:
// `3b8f7a94…jpg` is an 8611 × 5740 camera original, 29 MB, stored twice, and it is
// referenced only from Elementor's compiled CSS as a `background-size: cover`
// layer on /speaking/ and /tools-sales-page/. Nothing declares a width or a height
// for it, no srcset entry names it, and at every viewport the clone is verified at
// it is painted into a box under 1600 px wide. Images in exactly that position —
// CSS `url()` only, no markup dimensions — are capped at MAX_CSS_WIDTH. Everything
// else keeps its pixels. The fidelity diff is re-run after this pass either way.
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const UPLOADS = path.join(ROOT, 'public/wp-content/uploads');
const CSSDIR = path.join(ROOT, 'public/wp/css');
const FRAGDIR = path.join(ROOT, 'src/fragments');
const MANIFEST = path.join(ROOT, '_extract/image-manifest.json');

/** Retina headroom over the widest box any of these backgrounds is painted into. */
const MAX_CSS_WIDTH = 2560;

const manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : {};

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Every upload path the compiled stylesheets reference from a `url()`. */
const cssReferenced = new Set();
for await (const file of walk(CSSDIR)) {
  if (!file.endsWith('.css')) continue;
  const css = await readFile(file, 'utf8');
  for (const m of css.matchAll(/url\(\s*['"]?(\/wp-content\/uploads\/[^'")]+)['"]?\s*\)/g)) {
    cssReferenced.add(decodeURIComponent(m[1]));
  }
}

/** Every upload path the ported markup names, in any attribute. */
const markupReferenced = new Set();
for await (const file of walk(FRAGDIR)) {
  const html = await readFile(file, 'utf8');
  for (const m of html.matchAll(/\/wp-content\/uploads\/[^\s"')]+/g)) {
    markupReferenced.add(decodeURIComponent(m[0]));
  }
}

const mb = (n) => (n / 1048576).toFixed(1);
let before = 0, after = 0, done = 0, skipped = 0, resized = 0;

for await (const file of walk(UPLOADS)) {
  const ext = path.extname(file).toLowerCase();
  // WebP is already compressed; SVG is text.
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) continue;

  const rel = path.relative(ROOT, file);
  const url = '/' + path.relative(path.join(ROOT, 'public'), file).split(path.sep).join('/');
  const size = (await stat(file)).size;
  if (manifest[rel] === size) { skipped++; continue; }

  const input = await readFile(file);
  let image = sharp(input, { failOn: 'none' });
  const meta = await image.metadata();

  // The exception above: CSS-only backgrounds may lose pixels nothing asked for.
  const cssOnly = cssReferenced.has(url) && !markupReferenced.has(url);
  const capped = cssOnly && meta.width > MAX_CSS_WIDTH;
  if (capped) image = image.resize({ width: MAX_CSS_WIDTH });

  const output = ext === '.png'
    // Lossless only for PNG: a palette re-encode quantises to 256 colours, which
    // bands the book-cover artwork.
    ? await image.png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer()
    : await image.jpeg({ quality: 82, mozjpeg: true, progressive: true }).toBuffer();

  before += size;
  if (output.length >= size) {
    // Already well compressed — leave the original bytes alone.
    after += size;
    manifest[rel] = size;
    skipped++;
    continue;
  }

  // Paranoia: outside the documented exception, never let a re-encode change the
  // pixel dimensions the markup declares.
  const check = await sharp(output).metadata();
  if (!capped && (check.width !== meta.width || check.height !== meta.height)) {
    console.warn(`SKIP (size changed) ${rel}`);
    after += size;
    continue;
  }

  await writeFile(file, output);
  after += output.length;
  manifest[rel] = output.length;
  done++;
  if (capped) {
    resized++;
    console.log(`resized  ${rel}  ${meta.width}×${meta.height} → ${check.width}×${check.height}  ${mb(size)} → ${mb(output.length)} MB`);
  }
}

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`re-encoded ${done} (${resized} CSS-only backgrounds capped at ${MAX_CSS_WIDTH}px), left alone ${skipped}`);
console.log(`${mb(before)} MB → ${mb(after)} MB`);
