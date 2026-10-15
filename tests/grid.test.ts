import { describe, expect, it } from 'vitest';
import { analyze, cropRaster, downscale, rasterReader, signature, signatureDistance } from '../src/grid/index.ts';
import { addNoise, buildProfile, longCapture, screenshots, type Profile } from '../src/synth/profile.ts';

function truthIds(pr: Profile, result: Awaited<ReturnType<typeof analyze>>) {
  const truth = pr.cells.map((c) => signature(downscale(cropRaster(pr.raster, c.x, c.y, c.w, c.h), 240)));
  return result.posts.map((p) => {
    let best = -1, bd = Infinity;
    truth.forEach((t, id) => {
      const d = signatureDistance(t, p.cell.signature);
      if (d < bd) { bd = d; best = id; }
    });
    expect(bd).toBeLessThan(6);
    return best;
  });
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('multiple screenshots', () => {
  for (const aspect of [1, 1.25, 4 / 3]) {
    it(`aspect ${aspect.toFixed(2)}: skips the header and counts overlapping rows once`, async () => {
      const pr = buildProfile({ posts: 30, aspect, seed: 11 });
      const shots = screenshots(pr, [0, 1300, 2600, 3900, 5200]);
      const res = await analyze(shots.map((s) => ({ name: s.name, reader: rasterReader(s.raster) })));
      expect(res.aspect).toBeCloseTo(aspect, 1);
      expect(truthIds(pr, res)).toEqual(range(30));
      // First shot: the top of the first row below the header must equal the grid start
      expect(res.sources[0].headerEnd).toBe(pr.gridTop + shots[0].offset);
      expect(res.stitch.joins.every((j) => !j.warning)).toBe(true);
      // Cell bounds match the truth within 2px
      const c = res.posts[4].cell.rect, t = pr.cells[4];
      expect(Math.abs(c.x - t.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.w - t.w)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.h - t.h)).toBeLessThanOrEqual(2);
    });
  }

  it('dark mode, JPEG noise', async () => {
    const pr = buildProfile({ posts: 24, dark: true, seed: 5 });
    const shots = screenshots(pr, [0, 1400, 2800, 4200]).map((s) => ({ ...s, raster: addNoise(s.raster, 4) }));
    const res = await analyze(shots.map((s) => ({ name: s.name, reader: rasterReader(s.raster) })));
    expect(truthIds(pr, res)).toEqual(range(24));
  });

  it('warns when shots have no overlap', async () => {
    const pr = buildProfile({ posts: 30, seed: 2 });
    const shots = screenshots(pr, [0, 2400]);
    const res = await analyze(shots.map((s) => ({ name: s.name, reader: rasterReader(s.raster) })));
    expect(res.stitch.joins[0].warning).toBeTruthy();
  });

  it('counts the same screen once even if captured twice', async () => {
    const pr = buildProfile({ posts: 18, seed: 9 });
    const shots = screenshots(pr, [0, 1300, 1300]);
    const res = await analyze(shots.map((s) => ({ name: s.name, reader: rasterReader(s.raster) })));
    const ids = truthIds(pr, res);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('side margins and thick gutters, as in a web capture', () => {
  it('keeps the outer left and right margins out of cells', async () => {
    const pr = buildProfile({ posts: 21, aspect: 1, gutterPt: 2, seed: 4 });
    const cap = longCapture(pr, false);
    const pad = 60;
    const W = cap.raster.width + pad * 2;
    const r = { width: W, height: cap.raster.height, data: new Uint8ClampedArray(W * cap.raster.height * 4).fill(255) };
    for (let y = 0; y < r.height; y++) r.data.set(cap.raster.data.subarray(y * cap.raster.width * 4, (y + 1) * cap.raster.width * 4), (y * W + pad) * 4);
    const res = await analyze([{ name: 'web', reader: rasterReader(r, 2000) }]);
    expect(res.sources[0].columns?.left).toBe(pad);
    expect(res.sources[0].columns?.right).toBe(pad + cap.raster.width);
    expect(res.sources[0].columns?.gutterWidth).toBe(6);
    expect(truthIds(pr, res)).toEqual(range(21));
  });
});

describe('long scroll capture', () => {
  it('reading in strips gives the same result (incl. blank last-row cells and gray not-yet-loaded cells)', async () => {
    const pr = buildProfile({ posts: 110, aspect: 4 / 3, seed: 21, placeholders: [40] });
    const cap = longCapture(pr);
    expect(cap.raster.height).toBeGreaterThan(20000);
    let maxStrip = 0;
    const base = rasterReader(cap.raster, 1500);
    const reader = { ...base, readStrip: (y: number, h: number) => { maxStrip = Math.max(maxStrip, h); return base.readStrip(y, h); } };
    const res = await analyze([{ name: cap.name, reader }]);
    expect(maxStrip).toBeLessThanOrEqual(1500);
    expect(res.sources[0].stripCount).toBeGreaterThan(10);
    expect(res.posts.length).toBe(110);
    expect(res.posts[40].cell.kind).toBe('placeholder');
    expect(res.sources[0].cells.filter((c) => c.kind === 'empty').length).toBe(1);
    expect(truthIds(pr, res).filter((_, i) => i !== 40)).toEqual(range(110).filter((i) => i !== 40));
  });
});
