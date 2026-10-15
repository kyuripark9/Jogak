import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const shotDir = process.env.SHOT_DIR;

async function seams(page: Page) {
  return page.evaluate(() => {
    const st = (window as any).__stage;
    return st.sewing.pw.seams.map((s: any, i: number) => ({
      i,
      sewable: st.sewing.isSewable(i),
      a: st.toClient(s.a),
      b: st.toClient(s.b),
    }));
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

test.setTimeout(300_000);

test('tracing along seams sews the whole quilt, and hovering reveals the original', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Verified with mouse drags');
  // Fit the whole jogakbo on screen (mouse events don't reach off-screen coordinates)
  await page.setViewportSize({ width: 1280, height: 1700 });
  await page.goto('/quilt.html');
  await page.click('[data-sample="natural"]');
  await page.waitForSelector('body[data-state="done"]');
  await page.locator('#quilt canvas').evaluate((c) => c.scrollIntoView({ block: 'start' }));
  await expect(page.locator('body')).toHaveAttribute('data-sewn', '0');
  if (shotDir) await page.locator('#quilt canvas').screenshot({ path: join(shotDir, 'sew-0.png') });

  // Large seams can't be sewn at first
  const first = await seams(page);
  const locked = first.find((s: any) => !s.sewable)!;
  await drag(page, locked.a, locked.b);
  await expect(page.locator('body')).toHaveAttribute('data-sewn', '0');

  // Tracing only half doesn't join it yet
  const half = first.find((s: any) => s.sewable)!;
  await drag(page, half.a, [(half.a[0] + half.b[0]) / 2, (half.a[1] + half.b[1]) / 2]);
  await expect(page.locator('body')).toHaveAttribute('data-sewn', '0');

  let rounds = 0;
  while (rounds++ < 60) {
    const open = (await seams(page)).filter((s: any) => s.sewable);
    if (!open.length) break;
    for (const s of open) await drag(page, s.a, s.b);
    if (rounds === 2 && shotDir) await page.locator('#quilt canvas').screenshot({ path: join(shotDir, 'sew-mid.png') });
  }
  await expect(page.locator('body')).toHaveAttribute('data-sewn', '35');
  await expect(page.locator('#sew-status')).toContainText('seams sewn');
  await page.waitForTimeout(800);
  if (shotDir) await page.locator('#quilt canvas').screenshot({ path: join(shotDir, 'sew-done.png') });

  // Hovering a piece reveals the original
  const center = await page.evaluate(() => {
    const st = (window as any).__stage;
    const p = st.sewing.pw.pieces[5].poly;
    const c = [p.reduce((a: number, q: number[]) => a + q[0], 0) / p.length, p.reduce((a: number, q: number[]) => a + q[1], 0) / p.length];
    return st.toClient(c);
  });
  await page.mouse.move(center[0], center[1]);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__stage.revealed)).toBe(5);
  if (shotDir) await page.locator('#quilt canvas').screenshot({ path: join(shotDir, 'reveal.png') });
});
