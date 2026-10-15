/**
 * The link preview image (public/og.png, 1200×630) shown when someone shares the portfolio link.
 * It is the real demo patchwork, fully sewn, so the preview shows what the page actually makes.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const server = await createServer({ root, server: { port: 5181, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5181/');
  await page.waitForSelector('body[data-state="done"]');
  const dataUrl = await page.evaluate(async () => {
    const path = '/src/render/quilt.ts';
    const { renderQuilt, finishedView } = await import(path);
    const q = (window as any).__quilt;
    const quilt = document.createElement('canvas');
    renderQuilt(quilt, q, 520, finishedView(q));
    const W = 1200, H = 630;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f3eee3';
    ctx.fillRect(0, 0, W, H);
    const h = H - 60, w = (quilt.width * h) / quilt.height;
    ctx.shadowColor = 'rgba(43,39,35,0.22)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(quilt, W - w - 70, 30, w, h);
    ctx.shadowColor = 'transparent';
    const serif = '"Iowan Old Style", Palatino, Georgia, serif';
    ctx.fillStyle = '#2b2723';
    ctx.font = `600 84px ${serif}`;
    ctx.fillText('Jogak', 80, 250);
    ctx.fillStyle = '#6f675c';
    ctx.font = `400 34px ${serif}`;
    ctx.fillText('Memories sewn into patchwork', 82, 310);
    ctx.font = `400 24px ${serif}`;
    ['Your photos, dyed into sheer cloth', 'and stitched together by hand.', 'Nothing leaves your browser.'].forEach((t, i) => ctx.fillText(t, 82, 390 + i * 36));
    // A short run of basting thread under the title
    ctx.strokeStyle = '#a8432f';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(82, 342);
    ctx.lineTo(500, 342);
    ctx.stroke();
    return c.toDataURL('image/png');
  });
  writeFileSync(join(root, 'public', 'og.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('public/og.png');
} finally {
  await browser.close();
  await server.close();
}
