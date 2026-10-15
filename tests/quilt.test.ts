import { describe, expect, it } from 'vitest';
import { createRaster } from '../src/grid/raster.ts';
import { chooseFabric, extract, kmeans } from '../src/color/extract.ts';
import { deltaE, rgbToLab } from '../src/color/lab.ts';
import { weighByRuns } from '../src/layout/weight.ts';
import { layout, polyArea } from '../src/layout/patchwork.ts';

function twoTone(a: number[], b: number[], frac: number) {
  const r = createRaster(100, 100);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const c = x < frac * 100 ? a : b, i = (y * 100 + x) * 4;
    r.data.set([c[0], c[1], c[2], 255], i);
  }
  return r;
}

describe('색 추출', () => {
  it('k-means가 두 색과 그 비율을 찾는다', () => {
    const e = extract(twoTone([200, 60, 40], [40, 80, 160], 0.7), { k: 3, skipIconCorner: false });
    expect(deltaE(e.palette[0].lab, rgbToLab([200, 60, 40]))).toBeLessThan(2);
    expect(e.palette[0].weight).toBeCloseTo(0.7, 1);
    expect(deltaE(e.palette[1].lab, rgbToLab([40, 80, 160]))).toBeLessThan(2);
  });

  it('오른쪽 위 아이콘 자리를 빼고 본다', () => {
    const r = twoTone([90, 120, 60], [90, 120, 60], 1);
    for (let y = 2; y < 12; y++) for (let x = 85; x < 97; x++) r.data.set([255, 255, 255, 255], (y * 100 + x) * 4);
    const e = extract(r, { k: 3 });
    expect(e.palette.every((s) => s.lab[0] < 90)).toBe(true);
  });

  it('같은 입력이면 같은 결과', () => {
    const pts = Array.from({ length: 300 }, (_, i) => rgbToLab([i % 255, (i * 7) % 255, (i * 13) % 255]));
    expect(kmeans(pts, 4, 3)).toEqual(kmeans(pts, 4, 3));
  });

  it('느낌에 따라 천이 갈린다', () => {
    expect(chooseFabric({ lightness: 80, chroma: 8, roughness: 2, contrast: 8 })).toBe('mosi');
    expect(chooseFabric({ lightness: 45, chroma: 10, roughness: 14, contrast: 30 })).toBe('sambe');
    expect(chooseFabric({ lightness: 40, chroma: 45, roughness: 1.5, contrast: 10 })).toBe('myeongju');
  });
});

describe('기억의 무게와 분할', () => {
  it('색이 이어지는 게시물을 한 날로 묶는다', () => {
    const p = (c: number[]) => [{ lab: rgbToLab(c as [number, number, number]), rgb: c as [number, number, number], weight: 1 }];
    const w = weighByRuns([p([200, 60, 40]), p([205, 62, 42]), p([40, 80, 160]), p([200, 60, 40])]);
    expect(w.map((x) => x.group)).toEqual([0, 0, 1, 2]);
    expect(w[0].weight).toBeGreaterThan(w[2].weight);
  });

  it('조각 넓이가 무게에 비례하고, 빈틈 없이 한 장을 채운다', () => {
    const weights = Array.from({ length: 40 }, (_, i) => 1 + (i % 5) * 0.4);
    const pw = layout(weights, 1000, 1250, { seed: 3 });
    const total = pw.pieces.reduce((a, p) => a + p.area, 0);
    const wsum = weights.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1000 * 1250, -1);
    pw.pieces.forEach((p, i) => {
      expect(p.index).toBe(i);
      expect(Math.abs(polyArea(p.poly) / total - weights[i] / wsum)).toBeLessThan(1e-4);
    });
    expect(pw.seams.length).toBe(39);
  });

  it('seed마다 가위질이 다르다', () => {
    const w = Array(12).fill(1);
    expect(layout(w, 100, 100, { seed: 1 }).pieces[0].poly).not.toEqual(layout(w, 100, 100, { seed: 2 }).pieces[0].poly);
  });
});
