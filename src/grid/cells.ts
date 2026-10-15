import { cropRaster, downscale, type Raster, type StripReader } from './raster.ts';
import { countBg, type ScanResult } from './scan.ts';
import type { ClassifiedBand, Columns } from './detect.ts';

export type CellKind =
  /** A post */
  | 'post'
  /** Empty slot in the last row (background only) */
  | 'empty'
  /** Gray cell not yet loaded (common in PDF and web captures) */
  | 'placeholder';

export interface CellCrop {
  sourceIndex: number;
  /** Complete-row index within the source (from 0) */
  rowIndex: number;
  col: number;
  rect: { x: number; y: number; w: number; h: number };
  thumb: Raster;
  /** 8×8 RGB means for duplicate matching (outer 6% excluded) */
  signature: Float32Array;
  kind: CellKind;
}

export interface ExtractOptions {
  thumbWidth?: number;
}

export async function extractCells(
  sourceIndex: number,
  reader: StripReader,
  s: ScanResult,
  c: Columns,
  rows: ClassifiedBand[],
  opts: ExtractOptions = {},
): Promise<CellCrop[]> {
  const thumbWidth = opts.thumbWidth ?? 240;
  const out: CellCrop[] = [];
  // Read several rows as one strip to cut down on decodes and PDF renders
  let i = 0;
  while (i < rows.length) {
    const start = rows[i].y0;
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].y1 - start <= reader.stripHeight) j++;
    const end = rows[j].y1;
    const strip = await reader.readStrip(start, end - start);
    for (let r = i; r <= j; r++) {
      const band = rows[r];
      c.cells.forEach(([x0, x1], col) => {
        const rect = { x: x0, y: band.y0, w: x1 - x0, h: band.y1 - band.y0 };
        const crop = cropRaster(strip, rect.x, rect.y - start, rect.w, rect.h);
        const thumb = downscale(crop, thumbWidth);
        out.push({
          sourceIndex,
          rowIndex: r,
          col,
          rect,
          thumb,
          signature: signature(thumb),
          kind: cellKind(s, rect, thumb),
        });
      });
    }
    i = j + 1;
  }
  return out;
}

function cellKind(s: ScanResult, r: CellCrop['rect'], thumb: Raster): CellKind {
  let bg = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y += 3) { bg += countBg(s, y, r.x, r.x + r.w); n += r.w; }
  if (bg / n > 0.98) return 'empty';
  // Nearly one color (tiny standard deviation) → not-yet-loaded placeholder
  const d = thumb.data;
  let sum = 0, sq = 0, m = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += v; sq += v * v; m++;
  }
  const sd = Math.sqrt(sq / m - (sum / m) ** 2);
  return sd < 2.5 ? 'placeholder' : 'post';
}

export function signature(t: Raster): Float32Array {
  const G = 8;
  const sig = new Float32Array(G * G * 3);
  const ix = Math.round(t.width * 0.06), iy = Math.round(t.height * 0.06);
  const w = t.width - ix * 2, h = t.height - iy * 2;
  for (let gy = 0; gy < G; gy++) {
    const y0 = iy + Math.floor((gy * h) / G), y1 = iy + Math.floor(((gy + 1) * h) / G);
    for (let gx = 0; gx < G; gx++) {
      const x0 = ix + Math.floor((gx * w) / G), x1 = ix + Math.floor(((gx + 1) * w) / G);
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0, k = (y * t.width + x0) * 4; x < x1; x++, k += 4) {
          r += t.data[k]; g += t.data[k + 1]; b += t.data[k + 2]; n++;
        }
      }
      const o = (gy * G + gx) * 3;
      sig[o] = r / n; sig[o + 1] = g / n; sig[o + 2] = b / n;
    }
  }
  return sig;
}

/** Mean channel difference between two cells (0–255) */
export function signatureDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}
