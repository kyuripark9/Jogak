import type { Raster, RGB, StripReader } from './raster.ts';

/**
 * Sweeps the source twice, strip by strip.
 * Pass 1: estimate the background color (= gutter color between cells). Pass 2: record 1 bit per pixel for "is background".
 * This avoids holding a whole long capture as RGBA, keeping only a 1-bit mask (1/32 the size).
 */
export interface ScanResult {
  width: number;
  height: number;
  bg: RGB;
  /** ceil(width/32) 32-bit words per row. Bit 1 = background */
  mask: Uint32Array;
  stride: number;
  /** Background pixel count per row */
  bgCount: Uint32Array;
}

export interface ScanOptions {
  /** Background match tolerance (max per-channel difference), to absorb JPEG recompression and PDF antialiasing */
  tolerance?: number;
  /** Called for each strip read (e.g. to build preview tiles) */
  onStrip?: (strip: Raster, y: number, pass: 1 | 2) => void;
  onProgress?: (done: number, total: number) => void;
}

export const DEFAULT_TOLERANCE = 12;

function* strips(reader: StripReader) {
  for (let y = 0; y < reader.height; y += reader.stripHeight) {
    yield [y, Math.min(reader.stripHeight, reader.height - y)] as const;
  }
}

const near = (d: Uint8ClampedArray, i: number, r: number, g: number, b: number, tol: number) =>
  Math.abs(d[i] - r) <= tol && Math.abs(d[i + 1] - g) <= tol && Math.abs(d[i + 2] - b) <= tol;

export async function scan(reader: StripReader, opts: ScanOptions = {}): Promise<ScanResult> {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const { width: W, height: H } = reader;
  const nStrips = Math.ceil(H / reader.stripHeight);
  // Keep single-strip screenshots around so they aren't decoded twice
  let cached: Raster | null = null;
  const read = async (y: number, h: number) => {
    if (cached) return cached;
    const s = await reader.readStrip(y, h);
    if (nStrips === 1) cached = s;
    return s;
  };

  // Pass 1: collect colors of rows that are one color edge to edge (= horizontal gutters, blank header lines)
  const uniformHist = new Map<number, { n: number; r: number; g: number; b: number }>();
  const anyHist = new Map<number, number>();
  let done = 0;
  for (const [y0, h] of strips(reader)) {
    const s = await read(y0, h);
    opts.onStrip?.(s, y0, 1);
    const d = s.data;
    for (let y = 0; y < h; y++) {
      const row = y * W * 4;
      const ref = row + (W >> 1) * 4;
      const r = d[ref], g = d[ref + 1], b = d[ref + 2];
      let same = 0;
      for (let x = 0, i = row; x < W; x++, i += 4) if (near(d, i, r, g, b, tol)) same++;
      if (same >= W * 0.985) {
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const e = uniformHist.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += r; e.g += g; e.b += b;
        uniformHist.set(key, e);
      }
      if (y % 5 === 0) {
        for (let x = 0, i = row; x < W; x += 7, i += 28) {
          const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
          anyHist.set(key, (anyHist.get(key) ?? 0) + 1);
        }
      }
    }
    opts.onProgress?.(++done, nStrips * 2);
  }

  let bg: RGB;
  const best = [...uniformHist.values()].sort((a, b) => b.n - a.n)[0];
  if (best) {
    bg = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
  } else {
    // With no single-color rows at all, take the most common color as background
    const key = [...anyHist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0x7fff;
    bg = [((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4];
  }

  // Pass 2: background mask
  const stride = Math.ceil(W / 32);
  const mask = new Uint32Array(stride * H);
  const bgCount = new Uint32Array(H);
  const [br, bgG, bb] = bg;
  for (const [y0, h] of strips(reader)) {
    const s = await read(y0, h);
    opts.onStrip?.(s, y0, 2);
    const d = s.data;
    for (let y = 0; y < h; y++) {
      const row = y * W * 4;
      const mrow = (y0 + y) * stride;
      let c = 0;
      for (let x = 0, i = row; x < W; x++, i += 4) {
        if (near(d, i, br, bgG, bb, tol)) {
          mask[mrow + (x >> 5)] |= 1 << (x & 31);
          c++;
        }
      }
      bgCount[y0 + y] = c;
    }
    opts.onProgress?.(++done, nStrips * 2);
  }
  cached = null;
  return { width: W, height: H, bg, mask, stride, bgCount };
}

/** Background pixel count in [x0, x1) of row y */
export function countBg(s: ScanResult, y: number, x0: number, x1: number): number {
  let c = 0;
  const base = y * s.stride;
  for (let x = x0; x < x1; x++) if (s.mask[base + (x >> 5)] & (1 << (x & 31))) c++;
  return c;
}

export function isBg(s: ScanResult, x: number, y: number): boolean {
  return (s.mask[y * s.stride + (x >> 5)] & (1 << (x & 31))) !== 0;
}
