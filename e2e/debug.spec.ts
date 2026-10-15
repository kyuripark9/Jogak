import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'fixtures', 'out');
const f = (n: string) => join(dir, n);
const shotDir = process.env.SHOT_DIR;

test.beforeAll(() => {
  if (!existsSync(f('long-scroll.png'))) throw new Error('Run npm run fixtures first to build the synthetic captures.');
});

async function upload(page: import('@playwright/test').Page, files: string[]) {
  await page.goto('/debug.html');
  await page.setInputFiles('#files', files);
  await page.waitForSelector('body[data-state="done"]', { timeout: 100_000 });
}

test('5 screenshots: skips the header, drops overlapping rows, yields 30 pieces', async ({ page }, info) => {
  // Shuffled uploads are put back in filename order
  await upload(page, ['IMG_4103.PNG', 'IMG_4100.PNG', 'IMG_4104.PNG', 'IMG_4101.PNG', 'IMG_4102.PNG'].map(f));
  await expect(page.locator('#summary')).toHaveAttribute('data-posts', '30');
  await expect(page.locator('#summary')).toHaveAttribute('data-aspect', '1.250');
  await expect(page.locator('.warnings')).toHaveCount(0);
  if (shotDir) await page.screenshot({ path: join(shotDir, `shots-${info.project.name}.png`), fullPage: true });
});

test('long scroll capture (over 20,000 px): read in strips, yields 120 pieces', async ({ page }, info) => {
  await upload(page, [f('long-scroll.png')]);
  await expect(page.locator('#summary')).toHaveAttribute('data-posts', '120');
  await expect(page.locator('#summary')).toHaveAttribute('data-aspect', /^1\.33/);
  await expect(page.locator('.source figcaption')).toContainText('strips');
  await expect(page.locator('.piece.placeholder')).toHaveCount(1);
  if (shotDir) await page.screenshot({ path: join(shotDir, `long-${info.project.name}.png`) });
});

test('Safari full-page PDF: rendered to an image, yields 36 pieces', async ({ page }, info) => {
  await upload(page, [f('instagram-fullpage.pdf')]);
  await expect(page.locator('#summary')).toHaveAttribute('data-posts', '36');
  await expect(page.locator('.piece.placeholder')).toHaveCount(2);
  if (shotDir) await page.screenshot({ path: join(shotDir, `pdf-${info.project.name}.png`), fullPage: true });
});
