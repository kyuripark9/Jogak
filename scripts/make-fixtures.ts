/**
 * 검증용 합성 캡처 파일을 만든다 (fixtures/out).
 * - 스크린샷 5장 (4:5 칸, 라이트)
 * - 긴 스크롤 캡처 PNG (3:4 칸, 다크, 2만 px 이상)
 * - 사파리 전체 페이지 PDF 흉내 (Chromium으로 긴 페이지 한 장짜리 PDF 인쇄)
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

// 사파리 '전체 페이지' PDF처럼: CSS 390px 폭의 긴 페이지 한 장
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
