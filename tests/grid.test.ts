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

describe('스크린샷 여러 장', () => {
  for (const aspect of [1, 1.25, 4 / 3]) {
    it(`비율 ${aspect.toFixed(2)}: 헤더를 건너뛰고 겹친 줄을 한 번만 센다`, async () => {
      const pr = buildProfile({ posts: 30, aspect, seed: 11 });
      const shots = screenshots(pr, [0, 1300, 2600, 3900, 5200]);
      const res = await analyze(shots.map((s) => ({ name: s.name, reader: rasterReader(s.raster) })));
      expect(res.aspect).toBeCloseTo(aspect, 1);
      expect(truthIds(pr, res)).toEqual(range(30));
      // 첫 장: 헤더 아래 첫 줄의 위쪽이 그리드 시작과 같아야 한다
      expect(res.sources[0].headerEnd).toBe(pr.gridTop + shots[0].offset);
      expect(res.stitch.joins.every((j) => !j.warning)).toBe(true);
      // 칸 경계가 실제와 2px 안으로 맞는다
      const c = res.posts[4].cell.rect, t = pr.cells[4];
      expect(Math.abs(c.x - t.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.w - t.w)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.h - t.h)).toBeLessThanOrEqual(2);
    });
  }

  it('다크 모드, JPEG 노이즈', async () => {
    const pr = buildProfile({ posts: 24, dark: true, seed: 5 });
    const shots = screenshots(pr, [0, 1400, 2800, 4200]).map((s) => ({ ...s, raster: addNoise(s.raster, 4) }));
    const res = await analyze(shots.map((s) => ({ name: s.name, reader: rasterReader(s.raster) })));
    expect(truthIds(pr, res)).toEqual(range(24));
  });

  it('겹침 없이 찍으면 경고한다', async () => {
    const pr = buildProfile({ posts: 30, seed: 2 });
    const shots = screenshots(pr, [0, 2400]);
    const res = await analyze(shots.map((s) => ({ name: s.name, reader: rasterReader(s.raster) })));
    expect(res.stitch.joins[0].warning).toBeTruthy();
  });

  it('같은 화면을 두 번 찍어도 한 번만 센다', async () => {
    const pr = buildProfile({ posts: 18, seed: 9 });
    const shots = screenshots(pr, [0, 1300, 1300]);
    const res = await analyze(shots.map((s) => ({ name: s.name, reader: rasterReader(s.raster) })));
    const ids = truthIds(pr, res);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('웹 캡처처럼 양옆 여백이 있고 칸 여백이 두꺼운 경우', () => {
  it('좌우 바깥 여백을 칸에 넣지 않는다', async () => {
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

describe('긴 스크롤 캡처', () => {
  it('띠 단위로 읽어도 결과가 같다 (마지막 줄 빈칸, 로딩 전 회색 칸 포함)', async () => {
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
