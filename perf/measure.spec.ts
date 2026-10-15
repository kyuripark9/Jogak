import { test } from '@playwright/test';

/** Performance measurement (prints numbers, not a test). A 4x CPU slowdown mimics an average phone. */
test.setTimeout(300_000);

for (const throttle of [1, 4]) {
  test(`demo perf x${throttle}`, async ({ page }, info) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const t0 = Date.now();
    await page.goto('/');
    await page.waitForSelector('body[data-state="done"]');
    const load = Date.now() - t0;
    const r = await page.evaluate(async () => {
      const st = (window as any).__stage;
      const time = (n: number) => { const a = performance.now(); for (let i = 0; i < n; i++) st.draw(); return (performance.now() - a) / n; };
      time(2);
      const wall = time(10);
      st.mode = 'light';
      const light = time(10);
      st.mode = 'wall';
      const c = document.querySelector('canvas')!;
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const marks = performance.getEntriesByType('resource').map((e: any) => [e.name.split('/').pop(), Math.round(e.duration)]);
      return { wall, light, canvas: [c.width, c.height], dcl: nav.domContentLoadedEventEnd, marks };
    });
    let exportMs = -1;
    if (throttle === 1) {
      exportMs = await page.evaluate(async () => {
        const { exportPng } = await import('/src/render/export.ts');
        const st = (window as any).__stage;
        const a = performance.now();
        // Draw directly, assuming everything is sewn
        const q = (window as any).__quilt;
        if (!q) return -2;
        await exportPng(q, st.sewing, 'wall');
        return performance.now() - a;
      });
    }
    console.log(info.project.name, `x${throttle}`, JSON.stringify({ load, ...r, exportMs, marks: undefined }));
  });
}

test('raf baseline', async ({ page }, info) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/');
  await page.waitForSelector('body[data-state="done"]');
  const r = await page.evaluate(async () => {
    const st = (window as any).__stage;
    const run = (fn: () => void) => new Promise<number>((done) => {
      const fr: number[] = []; let last = performance.now(), n = 0;
      const step = (now: number) => { fr.push(now - last); last = now; fn(); if (++n < 60) requestAnimationFrame(step); else { fr.sort((a, b) => a - b); done(fr[30]); } };
      requestAnimationFrame(step);
    });
    const idle = await run(() => {});
    const wall = await run(() => st.draw());
    st.mode = 'light';
    const light = await run(() => st.draw());
    const gl = (() => { const c = document.createElement('canvas').getContext('webgl'); const d = c?.getExtension('WEBGL_debug_renderer_info'); return d ? c!.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'none'; })();
    return { idle, wall, light, gl };
  });
  console.log(info.project.name, 'raf', JSON.stringify(r));
});
