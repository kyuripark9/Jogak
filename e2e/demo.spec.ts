import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const shotDir = process.env.SHOT_DIR;

async function open(page: Page) {
  return page.evaluate(() => {
    const st = (window as any).__stage;
    return st.sewing.pw.seams
      .map((s: any, i: number) => ({ i, sewable: st.sewing.isSewable(i), a: st.toClient(s.a), b: st.toClient(s.b) }))
      .filter((s: any) => s.sewable);
  });
}

async function drag(page: Page, a: number[], b: number[], steps = 24) {
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps);
  }
  await page.mouse.up();
}

test.setTimeout(120_000);

test('업로드 없이 첫 화면에 조각보가 펼쳐지고 간직하기는 잠겨 있다', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('body[data-state="done"]');
  await expect(page.locator('#sew-status')).toContainText('마지막 솔기');
  await expect(page.locator('#save')).toBeDisabled();
  if (shotDir) await page.screenshot({ path: join(shotDir, `demo-${test.info().project.name}.png`), fullPage: true });
});

test('남은 솔기를 꿰매면 PNG로 간직하고, 창에 걸면 빛이 비친다', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '마우스 드래그로 확인');
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto('/');
  await page.waitForSelector('body[data-state="done"]');
  await page.locator('#canvas').evaluate((c) => c.scrollIntoView({ block: 'start' }));

  for (let r = 0; r < 10; r++) {
    const left = await open(page);
    if (!left.length) break;
    for (const s of left) await drag(page, s.a, s.b);
  }
  await expect(page.locator('#sew-status')).toContainText('다 이었어요');
  await expect(page.locator('#save')).toBeEnabled();
  await page.waitForTimeout(700);
  if (shotDir) await page.locator('#canvas').screenshot({ path: join(shotDir, 'demo-wall.png') });

  await page.click('#light');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'light');
  await expect(page.locator('#light')).toHaveText('벽에 걸기');
  const box = (await page.locator('#canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.25);
  await page.waitForTimeout(300);
  if (shotDir) await page.locator('#canvas').screenshot({ path: join(shotDir, 'demo-light.png') });

  const dl = page.waitForEvent('download');
  await page.click('#save');
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^jogakbo-\d{8}\.png$/);
  await expect(page.locator('body')).toHaveAttribute('data-exported', /\d+/);
  const size = Number(await page.locator('body').getAttribute('data-exported'));
  expect(size).toBeGreaterThan(200_000);
  if (shotDir) await file.saveAs(join(shotDir, 'demo-export.png'));
});
