import { paletteDistance, type Swatch } from '../color/extract.ts';

/**
 * 기억의 무게. 인스타 캡처에는 날짜가 없어서 "그날 사진 수"를 직접 알 수 없다.
 * 대신 시간순으로 이웃한 게시물의 색이 비슷하면 같은 날·같은 자리에서 찍었다고 보고
 * 한 묶음으로 센다. 묶음이 클수록 그날은 무거운 기억이고, 그 조각들은 커진다.
 * (앨범 사진 입력이 생기면 EXIF 날짜로 같은 날을 직접 묶는다)
 */

export interface Weighed {
  /** 묶음 번호 (시간순) */
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
    // 넓이가 사진 수에 정비례하면 큰 묶음이 화면을 다 먹으므로 완만하게 키운다
    return { group: x, groupSize: n, weight: 1 + Math.sqrt(n - 1) * 0.9 };
  });
}
