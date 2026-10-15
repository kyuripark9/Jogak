/**
 * Builds synthetic capture files for verification (fixtures/out).
 * - 5 screenshots (4:5 cells, light)
 * - Long scroll capture PNG (3:4 cells, dark, over 20,000 px)
 * - Mock Safari full-page PDF (Chromium prints a long page as a single-page PDF)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { buildProfile, longCapture, screenshots } from '../src/synth/profile.ts';
import { png } from './png.ts';

const out = join(import.meta.dirname, '..', 'fixtures', 'out');
mkdirSync(out, { recursive: true });

const shotsProfile = buildProfile({ posts: 30, aspect: 1.25, seed: 11 });
for (const s of screenshots(shotsProfile, [0, 1300, 2600, 3900, 5200])) writeFileSync(join(out, s.name), png(s.raster));

const longProfile = buildProfile({ posts: 120, aspect: 4 / 3, dark: true, seed: 21, placeholders: [52] });
const long = longCapture(longProfile);
writeFileSync(join(out, 'long-scroll.png'), png(long.raster));

// Like Safari's 'Full Page' PDF: one long page, 390 CSS px wide
const pdfProfile = buildProfile({ posts: 36, aspect: 1.25, seed: 33, placeholders: [20, 21] });
const pdfImg = longCapture(pdfProfile, false).raster;
writeFileSync(join(out, 'pdf-source.png'), png(pdfImg));
const browser = await chromium.launch();
const page = await browser.newPage();
const cssH = Math.ceil(pdfImg.height / 3);
await page.setContent(
  `<html><body style="margin:0"><img src="data:image/png;base64,${png(pdfImg).toString('base64')}" style="display:block;width:390px"></body></html>`,
);
await page.pdf({ path: join(out, 'instagram-fullpage.pdf'), width: '390px', height: `${cssH}px`, printBackground: true, pageRanges: '1' });
await browser.close();

console.log(`fixtures → ${out}`);
console.log(`long-scroll.png ${long.raster.width}×${long.raster.height}, pdf page 390×${cssH}pt-ish`);
