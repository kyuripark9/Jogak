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

export const FABRIC_NAMES: Record<Fabric, string> = { mosi: 'mosi (ramie)', sambe: 'sambe (hemp)', myeongju: 'myeongju (silk)' };

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

/**
 * k-means++ (Lab 공간). seed가 같으면 결과도 같다.
 * 거리는 제곱한 채로 비교한다 (순서만 필요하니 제곱근을 뺀다). 피드 한 장에 사진이 백 장 넘게 오므로
 * 사진마다 수십만 번 도는 이 부분이 조각보를 펼치는 시간의 대부분이다.
 */
export function kmeans(points: Lab[], k: number, seed = 1, iterations = 14): Swatch[] {
  const n = points.length;
  if (n === 0) return [];
  const P = new Float64Array(n * 3);
  points.forEach((p, i) => { P[i * 3] = p[0]; P[i * 3 + 1] = p[1]; P[i * 3 + 2] = p[2]; });
  const rand = rng(seed);
  const C: number[] = [];
  const pick = (i: number) => C.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  pick(Math.floor(rand() * n));
  const d2 = new Float64Array(n).fill(Infinity);
  while (C.length / 3 < Math.min(k, n)) {
    // 새로 더한 중심만 보고 가장 가까운 거리를 줄여 간다
    const j = C.length - 3, c0 = C[j], c1 = C[j + 1], c2 = C[j + 2];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i * 3] - c0, b = P[i * 3 + 1] - c1, c = P[i * 3 + 2] - c2;
      const d = a * a + b * b + c * c;
      if (d < d2[i]) d2[i] = d;
      sum += d2[i];
    }
    if (sum === 0) break;
    let r = rand() * sum, i = 0;
    while ((r -= d2[i]) > 0 && i < n - 1) i++;
    pick(i);
  }
  const m = C.length / 3;
  const assign = new Int32Array(n);
  const acc = new Float64Array(m * 4);
  for (let it = 0; it < iterations; it++) {
    acc.fill(0);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      let best = 0, bd = Infinity;
      for (let j = 0; j < m; j++) {
        const a = x - C[j * 3], b = y - C[j * 3 + 1], c = z - C[j * 3 + 2];
        const d = a * a + b * b + c * c;
        if (d < bd) { bd = d; best = j; }
      }
      assign[i] = best;
      acc[best * 4] += x; acc[best * 4 + 1] += y; acc[best * 4 + 2] += z; acc[best * 4 + 3]++;
    }
    for (let j = 0; j < m; j++) {
      const c = acc[j * 4 + 3];
      if (c) { C[j * 3] = acc[j * 4] / c; C[j * 3 + 1] = acc[j * 4 + 1] / c; C[j * 3 + 2] = acc[j * 4 + 2] / c; }
    }
  }
  const counts = new Array(m).fill(0);
  for (const a of assign) counts[a]++;
  return counts
    .map((count, j): Swatch => {
      const lab: Lab = [C[j * 3], C[j * 3 + 1], C[j * 3 + 2]];
      return { lab, rgb: labToRgb(lab), weight: count / n };
    })
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
 * 천에 물들인 색. 사진 색을 그대로 쓰지 않고 밝게 띄우고 채도를 덜어 파스텔로 만든다.
 * 얇은 천에 옅게 물든 색이라 빛이 지나가며 색이 겹치고, 오래된 기억처럼 바래 있다.
 * 밝기 순서는 남겨 둬서 어두운 장면은 조금 더 깊은 파스텔이 된다.
 */
export function dyed(lab: Lab): Lab {
  const L = 74 + (lab[0] - 55) * 0.28;
  const c = Math.hypot(lab[1], lab[2]);
  // 거의 무채색인 사진도 아주 옅게나마 따뜻한 기가 돌게 (생모시 빛)
  const k = c > 1 ? Math.min(0.75, 32 / c) : 0;
  const a = lab[1] * k, b = lab[2] * k + (c < 6 ? 4 : 0);
  return [L, a, b];
}

/** 두 팔레트의 거리: 각 색을 상대 팔레트의 가장 가까운 색과 맞대어 비율로 평균 */
export function paletteDistance(p: Swatch[], q: Swatch[]): number {
  const one = (a: Swatch[], b: Swatch[]) =>
    a.reduce((s, x) => s + x.weight * Math.min(...b.map((y) => deltaE(x.lab, y.lab))), 0);
  return (one(p, q) + one(q, p)) / 2;
}
