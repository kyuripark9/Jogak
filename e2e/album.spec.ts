import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const shotDir = process.env.SHOT_DIR;

test('sample camera roll: grouped by day and place, oldest first', async ({ page }, info) => {
  await page.goto('/quilt.html');
  await page.click('[data-sample="album"]');
  await page.waitForSelector('body[data-state="done"]');
  // 29 photos over 9 days; two days moved between places, so 11 memories
  await expect(page.locator('#progress')).toContainText('29 photos from 9 days, grouped into 11 memories');
  await expect(page.locator('#pin-label')).toBeHidden();
  const dates = await page.locator('.ledger li span:last-child').allInnerTexts();
  const days = dates.map((t) => t.match(/\d{4}-\d{2}-\d{2}/)![0]);
  expect(days).toEqual([...days].sort());
  expect(await page.evaluate(() => (window as any).__quilt.patchwork.pieces.length)).toBe(29);
  if (shotDir) await page.screenshot({ path: join(shotDir, `album-${info.project.name}.png`), fullPage: true });
});

test('real files through the album picker: EXIF date beats file order', async ({ page }) => {
  await page.goto('/quilt.html');
  // Build two JPEGs in the browser, stamp EXIF dates in reverse of their names, and hand them to the picker
  await page.evaluate(async () => {
    const path = '/src/synth/album.ts';
    const { exifSegment, withExif } = await import(path);
    const make = async (name: string, taken: string, color: string) => {
      const c = document.createElement('canvas');
      c.width = 300; c.height = 375;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color; ctx.fillRect(0, 0, 300, 375);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg'));
      return new File([withExif(new Uint8Array(await blob.arrayBuffer()), exifSegment(taken))], name, { type: 'image/jpeg' });
    };
    const dt = new DataTransfer();
    dt.items.add(await make('a.jpg', '2025-01-02T10:00:00', '#c03020'));
    dt.items.add(await make('b.jpg', '2023-06-01T10:00:00', '#2050c0'));
    const input = document.querySelector('#album') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForSelector('body[data-state="done"]');
  const first = await page.locator('.ledger li span:last-child').first().innerText();
  expect(first).toContain('2023-06-01');
});
