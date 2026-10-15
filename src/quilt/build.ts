import type { Raster } from '../grid/raster.ts';
import { dyed, extract, type Extracted } from '../color/extract.ts';
import { weighByRuns, type Weighed } from '../layout/weight.ts';
import { layout, type Patchwork } from '../layout/patchwork.ts';
import type { FabricSpec } from '../render/fabric.ts';

/** 사진 한 장 → 기억 한 조각 */
export interface Memory {
  /** 시간순 번호 (0 = 가장 오래된 기억) */
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
 * thumbs: 시간순(오래된 것 먼저)으로 넘긴다.
 * 인스타 그리드는 최신순이므로 부르는 쪽에서 뒤집고 고정 게시물을 뺀다.
 */
export function buildQuilt(thumbs: Raster[], seed = 7): Quilt {
  const extracted = thumbs.map((t, i) => extract(t, { seed: i + 1 }));
  const weighed = weighByRuns(extracted.map((e) => e.palette));
  const memories = thumbs.map((thumb, i): Memory => {
    const e = extracted[i];
    const main = e.palette[0];
    // 씨실: 두 번째로 많은 색. 대표 색과 너무 같으면 대표 색을 살짝 어둡게
    const second = e.palette.find((s, k) => k > 0 && s.weight > 0.08) ?? main;
    const warp = dyed(main.lab);
    const weft = second === main ? [warp[0] - 4, warp[1], warp[2]] as typeof warp : dyed(second.lab);
    return { order: i, thumb, extracted: e, weighed: weighed[i], fabric: { fabric: e.fabric, warp, weft, seed: i * 7 + seed } };
  });
  const patchwork = layout(memories.map((m) => m.weighed.weight), QUILT_WIDTH, QUILT_HEIGHT, { seed });
  return { memories, patchwork };
}
