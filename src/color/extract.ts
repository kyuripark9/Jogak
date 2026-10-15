import type { Raster } from '../grid/raster.ts';
import { chroma, deltaE, labToRgb, rgbToLab, type Lab, type RGB } from './lab.ts';

/**
 * 사진 → 대표 색과 질감. 장면은 버리고 색과 느낌만 남긴다.
 * (기억은 시간이 지나면 장면보다 색과 느낌으로 남기 때문)
 */

export interface Swatch {
  lab: Lab;
  rgb: RGB;
  /** 이 색이 차지한 비율 (0~1) */
  weight: number;
}

export type Fabric = 'mosi' | 'sambe' | 'myeongju';

export const FABRIC_NAMES: Record<Fabric, string> = { mosi: '모시', sambe: '삼베', myeongju: '명주' };

export interface Feel {
  /** 밝기 평균 (L, 0~100) */
  lightness: number;
  /** 채도 평균 */
  chroma: number;
  /** 결의 거칠기: 이웃 픽셀 밝기 차이 평균 */
  roughness: number;
  /** 밝기 대비 (표준편차) */
  contrast: number;
}

export interface Extracted {
  palette: Swatch[];
  feel: Feel;
  fabric: Fabric;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 표본을 모은다. 오른쪽 위 모서리는 인스타가 릴스·여러 장 아이콘을 얹는 자리라
 * 사진 색이 아니므로 뺀다.
 */
function samples(t: Raster, maxSamples: number, skipIconCorner: boolean): Lab[] {
  const out: Lab[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((t.width * t.height) / maxSamples)));
  for (let y = 0; y < t.height; y += step) {
    for (let x = 0; x < t.width; x += step) {
      if (skipIconCorner && x > t.width * 0.8 && y < t.height * 0.15) continue;
      const i = (y * t.width + x) * 4;
      out.push(rgbToLab([t.data[i], t.data[i + 1], t.data[i + 2]]));
    }
  }
  return out;
}

/** k-means++ (Lab 공간). seed가 같으면 결과도 같다 */
export function kmeans(points: Lab[], k: number, seed = 1, iterations = 14): Swatch[] {
  if (points.length === 0) return [];
  const rand = rng(seed);
  const centers: Lab[] = [points[Math.floor(rand() * points.length)]];
  const d2 = new Float64Array(points.length);
  while (centers.length < Math.min(k, points.length)) {
    let sum = 0;
    points.forEach((p, i) => {
      let m = Infinity;
      for (const c of centers) m = Math.min(m, deltaE(p, c) ** 2);
      d2[i] = m;
      sum += m;
    });
    if (sum === 0) break;
    let r = rand() * sum, i = 0;
    while ((r -= d2[i]) > 0 && i < points.length - 1) i++;
    centers.push(points[i]);
  }
  const assign = new Int32Array(points.length);
  for (let it = 0; it < iterations; it++) {
    points.forEach((p, i) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, j) => {
        const d = deltaE(p, c);
        if (d < bd) { bd = d; best = j; }
      });
      assign[i] = best;
    });
    const acc = centers.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      const a = acc[assign[i]];
      a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++;
    });
    acc.forEach((a, j) => { if (a[3]) centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const counts = new Array(centers.length).fill(0);
  for (const a of assign) counts[a]++;
  return centers
    .map((lab, j) => ({ lab, rgb: labToRgb(lab), weight: counts[j] / points.length }))
    .filter((s) => s.weight > 0)
    .sort((p, q) => q.weight - p.weight);
}

function measureFeel(t: Raster, pts: Lab[]): Feel {
  const lum = new Float32Array(t.width * t.height);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = 0.2126 * t.data[i * 4] + 0.7152 * t.data[i * 4 + 1] + 0.0722 * t.data[i * 4 + 2];
  }
  let grad = 0, n = 0;
  for (let y = 1; y < t.height; y++) {
    for (let x = 1; x < t.width; x++) {
      const i = y * t.width + x;
      grad += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - t.width]);
      n++;
    }
  }
  const L = pts.map((p) => p[0]);
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  const sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length);
  return {
    lightness: mean,
    chroma: pts.reduce((a, p) => a + chroma(p), 0) / pts.length,
    roughness: grad / n / 2,
    contrast: sd,
  };
}

/**
 * 느낌 → 천. 어수선하고 결이 많은 장면은 거친 삼베, 맑고 옅은 장면은 비치는 모시,
 * 차분하고 색이 깊은 장면은 매끈한 명주.
 */
export function chooseFabric(f: Feel): Fabric {
  const sambe = f.roughness / 9 + f.contrast / 40;
  const mosi = (f.lightness - 45) / 25 + (25 - f.chroma) / 30;
  const myeongju = (f.chroma - 15) / 25 + (6 - f.roughness) / 6;
  if (sambe >= mosi && sambe >= myeongju) return 'sambe';
  return mosi >= myeongju ? 'mosi' : 'myeongju';
}

export function extract(thumb: Raster, opts: { k?: number; seed?: number; skipIconCorner?: boolean } = {}): Extracted {
  const pts = samples(thumb, 2500, opts.skipIconCorner ?? true);
  const palette = kmeans(pts, opts.k ?? 5, opts.seed ?? 1);
  const feel = measureFeel(thumb, pts);
  return { palette, feel, fabric: chooseFabric(feel) };
}

/**
 * 천에 물들인 색. 사진 색을 그대로 쓰지 않고 채도를 낮추고 밝기를 가운데로 당긴다.
 * 오래된 기억처럼, 천연 염색처럼 바랜 색.
 */
export function dyed(lab: Lab, fade = 0.38): Lab {
  return [lab[0] + (62 - lab[0]) * fade * 0.6, lab[1] * (1 - fade), lab[2] * (1 - fade)];
}

/** 두 팔레트의 거리: 각 색을 상대 팔레트의 가장 가까운 색과 맞대어 비율로 평균 */
export function paletteDistance(p: Swatch[], q: Swatch[]): number {
  const one = (a: Swatch[], b: Swatch[]) =>
    a.reduce((s, x) => s + x.weight * Math.min(...b.map((y) => deltaE(x.lab, y.lab))), 0);
  return (one(p, q) + one(q, p)) / 2;
}
