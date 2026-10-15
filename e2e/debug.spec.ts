import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'fixtures', 'out');
const f = (n: string) => join(dir, n);
const shotDir = process.env.SHOT_DIR;

test.beforeAll(() => {
  if (!existsSync(f('long-scroll.png'))) throw new Error('먼저 npm run fixtures 로 합성 캡처를 만드세요.');
});

async function upload(page: import('@playwright/test').Page, files: string[]) {
  await page.goto('/debug.html');
  await page.setInputFiles('#files', files);
  await page.waitForSelector('body[data-state="done"]', { timeout: 100_000 });
}

test('스크린샷 5장: 헤더를 건너뛰고 겹친 줄을 빼서 30조각', async ({ page }, info) => {
  // 순서를 섞어 올려도 이름순으로 다시 놓는다
  await upload(page, ['IMG_4103.PNG', 'IMG_4100.PNG', 'IMG_4104.PNG', 'IMG_4101.PNG', 'IMG_4102.PNG'].map(f));
  await expect(page.locator('#summary')).toHaveAttribute('data-posts', '30');
  await expect(page.locator('#summary')).toHaveAttribute('data-aspect', '1.250');
  await expect(page.locator('.warnings')).toHaveCount(0);
  if (shotDir) await page.screenshot({ path: join(shotDir, `shots-${info.project.name}.png`), fullPage: true });
});

test('긴 스크롤 캡처 (2만 px 넘음): 띠로 나눠 읽고 120조각', async ({ page }, info) => {
  await upload(page, [f('long-scroll.png')]);
  await expect(page.locator('#summary')).toHaveAttribute('data-posts', '120');
  await expect(page.locator('#summary')).toHaveAttribute('data-aspect', /^1\.33/);
  await expect(page.locator('.source figcaption')).toContainText('strips');
  await expect(page.locator('.piece.placeholder')).toHaveCount(1);
  if (shotDir) await page.screenshot({ path: join(shotDir, `long-${info.project.name}.png`) });
});

test('사파리 전체 페이지 PDF: 이미지로 렌더해 36조각', async ({ page }, info) => {
  await upload(page, [f('instagram-fullpage.pdf')]);
  await expect(page.locator('#summary')).toHaveAttribute('data-posts', '36');
  await expect(page.locator('.piece.placeholder')).toHaveCount(2);
  if (shotDir) await page.screenshot({ path: join(shotDir, `pdf-${info.project.name}.png`), fullPage: true });
});
