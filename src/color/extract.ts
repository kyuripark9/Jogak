import type { Raster } from '../grid/raster.ts';
import { chroma, deltaE, labToRgb, rgbToLab, type Lab, type RGB } from './lab.ts';

/**
 * Photo → dominant colors and texture. Drop the scene, keep only color and feel.
 * (Over time a memory survives as color and feel more than as a scene)
 */

export interface Swatch {
  lab: Lab;
  rgb: RGB;
  /** Share of the image this color covers (0–1) */
  weight: number;
}

export type Fabric = 'mosi' | 'sambe' | 'myeongju';

export const FABRIC_NAMES: Record<Fabric, string> = { mosi: 'mosi (ramie)', sambe: 'sambe (hemp)', myeongju: 'myeongju (silk)' };

export interface Feel {
  /** Mean lightness (L, 0–100) */
  lightness: number;
  /** Mean chroma */
  chroma: number;
  /** Grain roughness: mean luminance difference between neighboring pixels */
  roughness: number;
  /** Lightness contrast (standard deviation) */
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
 * Collects samples. The top-right corner is where Instagram overlays its Reels and carousel icons,
 * which aren't photo colors, so it's skipped.
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
 * k-means++ (in Lab space). Same seed, same result.
 * Distances are compared squared (only ordering matters, so skip the sqrt). A feed brings 100+ photos,
 * so this loop, run hundreds of thousands of times per photo, is most of the time it takes to lay out the jogakbo.
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
    // Shrink each nearest distance using only the newly added center
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
 * Feel → fabric. Busy, heavily textured scenes become coarse sambe (hemp); clear, pale scenes sheer mosi (ramie);
 * calm, deeply colored scenes smooth myeongju (silk).
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
 * The color as dyed into cloth. Instead of the raw photo color, lift it and drain chroma into a pastel.
 * Pale dye on thin cloth lets light layer the colors as it passes through, faded like an old memory.
 * Lightness order is kept, so darker scenes become slightly deeper pastels.
 */
export function dyed(lab: Lab): Lab {
  const L = 74 + (lab[0] - 55) * 0.28;
  const c = Math.hypot(lab[1], lab[2]);
  // Give even near-gray photos a faint warm cast (the tint of raw mosi)
  const k = c > 1 ? Math.min(0.75, 32 / c) : 0;
  const a = lab[1] * k, b = lab[2] * k + (c < 6 ? 4 : 0);
  return [L, a, b];
}

/** Distance between two palettes: match each color to its nearest in the other, averaged by share */
export function paletteDistance(p: Swatch[], q: Swatch[]): number {
  const one = (a: Swatch[], b: Swatch[]) =>
    a.reduce((s, x) => s + x.weight * Math.min(...b.map((y) => deltaE(x.lab, y.lab))), 0);
  return (one(p, q) + one(q, p)) / 2;
}
