import { createRaster, type Raster } from '../grid/raster.ts';
import { labToRgb, type Lab } from '../color/lab.ts';
import type { Fabric } from '../color/extract.ts';

/**
 * 천 질감을 노이즈로 짠다. 날실(세로)과 씨실(가로)을 따로 그려 엮는다.
 * 날실은 사진의 대표 색, 씨실은 두 번째 색으로 물들여서 가까이 보면
 * 사진 속 다른 색이 실 사이로 비친다.
 *
 * 세 천 모두 창에 건 보자기처럼 빛이 비치는 얇은 천이고, 결만 다르다.
 * - 삼베: 굵기가 고르지 않은 실, 셋 중 가장 도톰함 (거칠고 어수선한 기억)
 * - 모시: 가늘고 성긴 엮음, 가장 많이 비친다 (맑고 옅은 기억)
 * - 명주: 촘촘하고 매끈하며 빛을 받으면 은은하게 윤이 난다 (차분하고 깊은 기억)
 */

export interface FabricSpec {
  fabric: Fabric;
  warp: Lab;
  weft: Lab;
  seed: number;
}

interface Weave {
  /** 실 한 가닥 간격 (px) */
  pitch: number;
  /** 실 굵기 / 간격 */
  fill: number;
  /** 굵기 들쭉날쭉 정도 */
  slub: number;
  /** 실 사이 빈틈의 불투명도 (0이면 완전히 비침) */
  gapAlpha: number;
  /** 실 표면 잡결 */
  grain: number;
  /** 윤기 (조각 전체에 한 번 흐르는 빛, render/quilt.ts에서 그림) */
  sheen: number;
  /** 천 전체의 불투명도. 얇을수록 뒤의 빛과 이웃 조각이 비친다 */
  opacity: number;
}

export const WEAVES: Record<Fabric, Weave> = {
  // 모두 빛이 비치는 얇은 천. 삼베가 가장 도톰하고, 모시가 가장 성기고, 명주는 매끈하게 윤이 난다
  sambe: { pitch: 4, fill: 0.8, slub: 0.4, gapAlpha: 0.45, grain: 5, sheen: 0, opacity: 0.66 },
  mosi: { pitch: 3, fill: 0.6, slub: 0.18, gapAlpha: 0.15, grain: 3, sheen: 0.05, opacity: 0.56 },
  myeongju: { pitch: 2, fill: 0.92, slub: 0.05, gapAlpha: 0.75, grain: 1.5, sheen: 0.14, opacity: 0.6 },
};

function hash(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** 1차원 값 노이즈 (실 한 가닥을 따라 굵기가 천천히 변한다) */
function noise1(seed: number, x: number, period: number) {
  const i = Math.floor(x), f = x - i;
  const a = hash(seed * 7919 + (i % period)), b = hash(seed * 7919 + ((i + 1) % period));
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** 이음매 없이 반복되는 정사각 타일 */
export function weaveTile(spec: FabricSpec, size = 192): Raster {
  const wv = WEAVES[spec.fabric];
  const out = createRaster(size, size);
  const warp = labToRgb(spec.warp), weft = labToRgb(spec.weft);
  // 실 가닥 수가 짝수여야 평직 무늬가 타일 경계에서 이어진다
  const n = Math.max(2, Math.round(size / wv.pitch / 2) * 2);
  const pitch = size / n;
  // 실마다 색이 조금씩 다르다 (손으로 물들인 실)
  const tone = (kind: number, i: number) => 1 + (hash(spec.seed * 31 + kind * 1013 + i) - 0.5) * 0.05;
  const thickness = (kind: number, i: number, along: number) =>
    wv.fill * (1 - wv.slub / 2 + wv.slub * noise1(spec.seed + kind * 97 + i * 13, (along / size) * 6, 6));

  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / pitch), fy = (y + 0.5) / pitch - row;
    for (let x = 0; x < size; x++) {
      const col = Math.floor(x / pitch), fx = (x + 0.5) / pitch - col;
      // 실 단면: 가운데가 밝고 가장자리가 어두운 둥근 실
      const wWarp = thickness(0, col % n, y);
      const wWeft = thickness(1, row % n, x);
      const inWarp = Math.abs(fx - 0.5) < wWarp / 2;
      const inWeft = Math.abs(fy - 0.5) < wWeft / 2;
      // 평직: (행+열)이 짝수면 날실이 위
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
        // 실 사이 빈틈: 어둡고, 천에 따라 뒤가 비친다
        for (let ch = 0; ch < 3; ch++) out.data[i + ch] = warp[ch] * 0.9 + g;
        out.data[i + 3] = Math.round(255 * wv.gapAlpha);
      }
    }
  }
  return out;
}
