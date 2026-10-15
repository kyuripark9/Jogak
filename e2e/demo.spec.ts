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

test('landing page lays out a jogakbo with no upload, and Keep is locked', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('body[data-state="done"]');
  await expect(page.locator('#sew-status')).toContainText('left. Trace the red basting thread');
  await expect(page.locator('#save')).toBeDisabled();
  if (shotDir) await page.screenshot({ path: join(shotDir, `demo-${test.info().project.name}.png`), fullPage: true });
});

test('sewing the remaining seams lets you keep a PNG, and hanging it in a window lets light through', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Verified with mouse drags');
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto('/');
  await page.waitForSelector('body[data-state="done"]');
  await page.locator('#canvas').evaluate((c) => c.scrollIntoView({ block: 'start' }));

  for (let r = 0; r < 10; r++) {
    const left = await open(page);
    if (!left.length) break;
    for (const s of left) await drag(page, s.a, s.b);
  }
  await expect(page.locator('#sew-status')).toContainText('All sewn');
  await expect(page.locator('#save')).toBeEnabled();
  await page.waitForTimeout(700);
  if (shotDir) await page.locator('#canvas').screenshot({ path: join(shotDir, 'demo-wall.png') });

  await page.click('#light');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'light');
  await expect(page.locator('#light')).toHaveText('Hang it on the wall');
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

test('in light mode, multiplying pre-rendered fabric layers matches a fresh redraw', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One image comparison is enough');
  await page.goto('/');
  await page.waitForSelector('body[data-state="done"]');
  const diff = await page.evaluate(async () => {
    const path = '/src/render/quilt.ts';
    const { renderQuilt } = await import(path);
    const st = (window as any).__stage, q = (window as any).__quilt;
    const pieces = q.patchwork.pieces;
    const view = {
      sewing: st.sewing,
      transforms: pieces.map(() => ({ dx: 0, dy: 0, rot: 0, cx: 0, cy: 0 })),
      reveal: { index: 3, alpha: 1 },
      mode: 'light' as const,
      light: [420, 380] as [number, number],
    };
    const px = (layers: boolean) => {
      const c = document.createElement('canvas');
      // Render the layers first, then redraw with only the light moved
      if (layers) renderQuilt(c, q, 600, { ...view, light: [100, 100] }, { layers });
      renderQuilt(c, q, 600, view, { layers });
      return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    };
    const a = px(false), b = px(true);
    let worst = 0, sum = 0;
    for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); worst = Math.max(worst, d); sum += d; }
    return { worst, mean: sum / a.length };
  });
  // The multiply runs in two 8-bit passes, so only rounding differences remain
  expect(diff.mean).toBeLessThan(0.6);
  expect(diff.worst).toBeLessThan(6);
});
