import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const shotDir = process.env.SHOT_DIR;

test('builds a jogakbo from 36 sample scene photos', async ({ page }, info) => {
  await page.goto('/quilt.html');
  await page.click('[data-sample="natural"]');
  await page.waitForSelector('body[data-state="done"]', { timeout: 100_000 });
  await expect(page.locator('body')).toHaveAttribute('data-pieces', '36');
  const check = await page.evaluate(() => {
    const q = (window as any).__quilt;
    const total = q.patchwork.pieces.reduce((a: number, p: any) => a + p.area, 0);
    const wsum = q.memories.reduce((a: number, m: any) => a + m.weighed.weight, 0);
    // Whether area is proportional to weight (worst-case error)
    const err = Math.max(...q.memories.map((m: any) => Math.abs(q.patchwork.pieces[m.order].area / total - m.weighed.weight / wsum)));
    return { total, err, fabrics: [...new Set(q.memories.map((m: any) => m.fabric.fabric))] };
  });
  expect(check.total).toBeCloseTo(1000 * 1250, -2);
  expect(check.err).toBeLessThan(0.001);
  if (shotDir) {
    await page.locator('#quilt').screenshot({ path: join(shotDir, `quilt-${info.project.name}.png`) });
    await page.screenshot({ path: join(shotDir, `quilt-page-${info.project.name}.png`), fullPage: true });
  }
  console.log(JSON.stringify(check.fabrics));
});
