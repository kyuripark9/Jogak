import type { Raster } from '../grid/raster.ts';
import { dyed, extract, type Extracted } from '../color/extract.ts';
import { weighByDates, weighByRuns, type Weighed } from '../layout/weight.ts';
import { layout, type Patchwork } from '../layout/patchwork.ts';
import type { FabricSpec } from '../render/fabric.ts';

/** One photo → one memory piece */
export interface Memory {
  /** Chronological index (0 = oldest memory) */
  order: number;
  thumb: Raster;
  extracted: Extracted;
  weighed: Weighed;
  fabric: FabricSpec;
}

export interface Quilt {
  memories: Memory[];
  patchwork: Patchwork;
}

export const QUILT_WIDTH = 1000;
export const QUILT_HEIGHT = 1250;

/**
 * thumbs: pass in chronological order (oldest first).
 * The Instagram grid is newest first, so the caller reverses it and drops pinned posts.
 */
export function buildQuilt(thumbs: Raster[], seed = 7, dates?: string[]): Quilt {
  // Instagram captures have an icon in each cell's top right; dated photos (album, demo) don't
  const extracted = thumbs.map((t, i) => extract(t, { seed: i + 1, skipIconCorner: !dates }));
  const weighed = dates ? weighByDates(dates) : weighByRuns(extracted.map((e) => e.palette));
  const memories = thumbs.map((thumb, i): Memory => {
    const e = extracted[i];
    const main = e.palette[0];
    // Weft: the second most common color; if too close to the main color, a slightly darker main
    const second = e.palette.find((s, k) => k > 0 && s.weight > 0.08) ?? main;
    const warp = dyed(main.lab);
    const weft = second === main ? [warp[0] - 4, warp[1], warp[2]] as typeof warp : dyed(second.lab);
    return { order: i, thumb, extracted: e, weighed: weighed[i], fabric: { fabric: e.fabric, warp, weft, seed: i * 7 + seed } };
  });
  const patchwork = layout(memories.map((m) => m.weighed.weight), QUILT_WIDTH, QUILT_HEIGHT, { seed });
  return { memories, patchwork };
}
