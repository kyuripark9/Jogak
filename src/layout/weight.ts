import { paletteDistance, type Swatch } from '../color/extract.ts';

/**
 * Memory weight. Instagram captures carry no dates, so "photos that day" can't be known directly.
 * Instead, chronologically adjacent posts with similar colors are treated as shot the same day
 * in the same place and counted as one group. The bigger the group, the heavier that day's memory, and the larger its pieces.
 * (Once album photos are supported, EXIF dates group same-day shots directly)
 */

export interface Weighed {
  /** Group number (chronological) */
  group: number;
  groupSize: number;
  weight: number;
}

export const SAME_DAY_DISTANCE = 16;

export function weighByRuns(palettes: Swatch[][], threshold = SAME_DAY_DISTANCE): Weighed[] {
  const group: number[] = [];
  let g = 0;
  palettes.forEach((p, i) => {
    if (i > 0 && paletteDistance(palettes[i - 1], p) >= threshold) g++;
    group.push(g);
  });
  const size = new Map<number, number>();
  for (const x of group) size.set(x, (size.get(x) ?? 0) + 1);
  return group.map((x) => {
    const n = size.get(x)!;
    // Area linear in photo count would let big groups swallow the quilt, so grow it gently
    return { group: x, groupSize: n, weight: 1 + Math.sqrt(n - 1) * 0.9 };
  });
}

/** When dates are known (album EXIF, demo list): the number of photos taken that day is the weight */
export function weighByDates(dates: string[]): Weighed[] {
  const group: number[] = [];
  let g = 0;
  dates.forEach((d, i) => {
    if (i > 0 && d !== dates[i - 1]) g++;
    group.push(g);
  });
  const size = new Map<number, number>();
  for (const x of group) size.set(x, (size.get(x) ?? 0) + 1);
  return group.map((x) => {
    const n = size.get(x)!;
    return { group: x, groupSize: n, weight: 1 + Math.sqrt(n - 1) * 0.9 };
  });
}
