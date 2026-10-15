import { createRaster, type Raster } from '../grid/raster.ts';
import { labToRgb, type Lab } from '../color/lab.ts';
import type { Fabric } from '../color/extract.ts';

/**
 * Weaves cloth texture from noise. Warp (vertical) and weft (horizontal) are drawn separately and interlaced.
 * The warp is dyed the photo's main color and the weft its second color, so up close
 * the photo's other colors show between the threads.
 *
 * All three are thin cloths that let light through, like a bojagi hung in a window; only the weave differs.
 * - sambe (hemp): uneven threads, the thickest of the three (rough, busy memories)
 * - mosi (ramie): fine, open weave, the most see-through (clear, pale memories)
 * - myeongju (silk): dense and smooth, with a soft sheen in the light (calm, deep memories)
 */

export interface FabricSpec {
  fabric: Fabric;
  warp: Lab;
  weft: Lab;
  seed: number;
}

interface Weave {
  /** Spacing per thread (px) */
  pitch: number;
  /** Thread thickness / spacing */
  fill: number;
  /** How much thickness varies (slubs) */
  slub: number;
  /** Opacity of gaps between threads (0 is fully see-through) */
  gapAlpha: number;
  /** Thread surface grain */
  grain: number;
  /** Sheen (one band of light across the whole piece, drawn in render/quilt.ts) */
  sheen: number;
  /** Overall cloth opacity. Thinner cloth shows more of the light behind and neighboring pieces */
  opacity: number;
}

export const WEAVES: Record<Fabric, Weave> = {
  // All thin, light-through cloths: sambe is the thickest, mosi the most open, myeongju smooth with a sheen
  sambe: { pitch: 4, fill: 0.8, slub: 0.4, gapAlpha: 0.45, grain: 5, sheen: 0, opacity: 0.66 },
  mosi: { pitch: 3, fill: 0.6, slub: 0.18, gapAlpha: 0.15, grain: 3, sheen: 0.05, opacity: 0.56 },
  myeongju: { pitch: 2, fill: 0.92, slub: 0.05, gapAlpha: 0.75, grain: 1.5, sheen: 0.14, opacity: 0.6 },
};

function hash(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** 1D value noise (thickness varies slowly along a thread) */
function noise1(seed: number, x: number, period: number) {
  const i = Math.floor(x), f = x - i;
  const a = hash(seed * 7919 + (i % period)), b = hash(seed * 7919 + ((i + 1) % period));
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** Seamlessly repeating square tile */
export function weaveTile(spec: FabricSpec, size = 192): Raster {
  const wv = WEAVES[spec.fabric];
  const out = createRaster(size, size);
  const warp = labToRgb(spec.warp), weft = labToRgb(spec.weft);
  // An even thread count keeps the plain weave continuous across tile edges
  const n = Math.max(2, Math.round(size / wv.pitch / 2) * 2);
  const pitch = size / n;
  // Each thread's color varies slightly (hand-dyed thread)
  const tone = (kind: number, i: number) => 1 + (hash(spec.seed * 31 + kind * 1013 + i) - 0.5) * 0.05;
  const thickness = (kind: number, i: number, along: number) =>
    wv.fill * (1 - wv.slub / 2 + wv.slub * noise1(spec.seed + kind * 97 + i * 13, (along / size) * 6, 6));

  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / pitch), fy = (y + 0.5) / pitch - row;
    for (let x = 0; x < size; x++) {
      const col = Math.floor(x / pitch), fx = (x + 0.5) / pitch - col;
      // Thread cross-section: round, bright in the middle and darker at the edges
      const wWarp = thickness(0, col % n, y);
      const wWeft = thickness(1, row % n, x);
      const inWarp = Math.abs(fx - 0.5) < wWarp / 2;
      const inWeft = Math.abs(fy - 0.5) < wWeft / 2;
      // Plain weave: warp on top when (row + col) is even
      const warpOnTop = (row + col) % 2 === 0;
      let rgb: number[] | null = null, shade = 1;
      if (inWarp && (warpOnTop || !inWeft)) {
        const t = tone(0, col % n);
        const u = (fx - 0.5) / (wWarp / 2);
        shade = t * (1 - 0.07 * u * u) * (warpOnTop || !inWeft ? 1 : 0.96);
        rgb = warp;
      } else if (inWeft) {
        const t = tone(1, row % n);
        const u = (fy - 0.5) / (wWeft / 2);
        shade = t * (1 - 0.07 * u * u);
        rgb = weft;
      }
      const i = (y * size + x) * 4;
      const g = (hash(spec.seed * 104729 + y * size + x) - 0.5) * wv.grain;
      if (rgb) {
        for (let ch = 0; ch < 3; ch++) out.data[i + ch] = rgb[ch] * shade + g;
        out.data[i + 3] = 255;
      } else {
        // Gaps between threads: dark, and see-through depending on the cloth
        for (let ch = 0; ch < 3; ch++) out.data[i + ch] = warp[ch] * 0.9 + g;
        out.data[i + 3] = Math.round(255 * wv.gapAlpha);
      }
    }
  }
  return out;
}
