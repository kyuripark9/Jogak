import { countBg, type ScanResult } from './scan.ts';

/**
 * 그리드 감지. 칸 크기나 비율을 가정하지 않고, "칸 사이 여백은 바탕색이고
 * 양옆이 사진으로 막힌 가는 띠"라는 성질만으로 세로 여백선을 찾은 뒤
 * 행마다 그 여백선 위치가 바탕색인지로 그리드 행과 헤더 행을 가른다.
 */

export interface Gutter {
  /** [x0, x1) */
  x0: number;
  x1: number;
  /** 이 위치가 여백으로 뽑힌 행의 비율 (0~1) */
  strength: number;
}

export interface Columns {
  left: number;
  right: number;
  gutters: Gutter[];
  /** 칸별 [x0, x1) */
  cells: [number, number][];
  cellWidth: number;
  gutterWidth: number;
}

export const RowKind = {
  Other: 0,
  /** 가로 전체가 바탕색 (가로 여백 또는 빈 줄) */
  Gap: 1,
  /** 세로 여백선이 바탕색이고 칸 안에 내용이 있는 행 */
  Grid: 2,
} as const;
export type RowKind = (typeof RowKind)[keyof typeof RowKind];

export type Boundary = 'gap' | 'edge' | 'other';

export interface Band {
  y0: number;
  y1: number;
  top: Boundary;
  bottom: Boundary;
}

export function detectColumns(s: ScanResult): Columns | null {
  const { width: W, height: H } = s;
  const maxRun = Math.max(3, Math.round(W * 0.04));
  const votes = new Float64Array(W);
  const firsts: number[] = [];
  const lasts: number[] = [];
  let voters = 0;
  const step = Math.max(1, Math.floor(H / 8000));

  for (let y = 0; y < H; y += step) {
    // 대부분 바탕색인 행(헤더 글자 줄, 빈 줄)은 글자 사이 틈이 여백처럼 보이므로 투표에서 뺀다
    if (s.bgCount[y] > W * 0.6) continue;
    voters++;
    let x = 0;
    let first = -1, last = -1;
    while (x < W) {
      const bg = (s.mask[y * s.stride + (x >> 5)] & (1 << (x & 31))) !== 0;
      let e = x + 1;
      while (e < W && ((s.mask[y * s.stride + (e >> 5)] & (1 << (e & 31))) !== 0) === bg) e++;
      if (bg) {
        if (x > 0 && e < W && e - x <= maxRun) for (let i = x; i < e; i++) votes[i]++;
      } else {
        if (first < 0) first = x;
        last = e;
      }
      x = e;
    }
    if (first >= 0) { firsts.push(first); lasts.push(last); }
  }
  if (voters < 20) return null;

  const frac = Array.from(votes, (v) => v / voters);
  // 후보 여백: 투표율 0.3 이상이 이어진 구간
  const cands: Gutter[] = [];
  for (let x = 0; x < W; ) {
    if (frac[x] < 0.3) { x++; continue; }
    let e = x;
    let peak = 0, px = x;
    while (e < W && frac[e] >= 0.3) { if (frac[e] > peak) { peak = frac[e]; px = e; } e++; }
    let a = px, b = px + 1;
    while (a > x && frac[a - 1] >= peak * 0.5) a--;
    while (b < e && frac[b] >= peak * 0.5) b++;
    cands.push({ x0: a, x1: b, strength: peak });
    x = e;
  }
  cands.sort((p, q) => q.strength - p.strength);
  const top = cands.slice(0, 8).sort((p, q) => p.x0 - q.x0);

  // 그리드 행은 가장자리 위치가 정확히 같고, 헤더 행은 제각각이라 최빈값을 쓴다
  const left = mode(firsts);
  const right = mode(lasts);
  const usable = right - left;
  if (usable < W * 0.5) return null;

  // 칸 너비가 서로 같아지는 여백 조합 중 투표가 가장 강한 것
  let best: { gutters: Gutter[]; score: number } | null = null;
  for (let m = 1; m < 1 << top.length; m++) {
    const gs = top.filter((_, i) => m & (1 << i));
    if (gs.length > 6) continue;
    const cells = cellsFrom(left, right, gs);
    if (cells.some(([a, b]) => b - a < usable * 0.12)) continue;
    const widths = cells.map(([a, b]) => b - a);
    const mean = widths.reduce((p, q) => p + q, 0) / widths.length;
    const sd = Math.sqrt(widths.reduce((p, q) => p + (q - mean) ** 2, 0) / widths.length);
    if (sd / mean > 0.04 && Math.max(...widths) - Math.min(...widths) > 3) continue;
    const gw = gs.map((g) => g.x1 - g.x0);
    if (Math.max(...gw) - Math.min(...gw) > Math.max(3, Math.min(...gw))) continue;
    const score = gs.reduce((p, g) => p + g.strength, 0);
    if (!best || score > best.score) best = { gutters: gs, score };
  }
  if (!best) return null;
  const cells = cellsFrom(left, right, best.gutters);
  return {
    left,
    right,
    gutters: best.gutters,
    cells,
    cellWidth: cells.reduce((p, [a, b]) => p + b - a, 0) / cells.length,
    gutterWidth: median(best.gutters.map((g) => g.x1 - g.x0)),
  };
}

function cellsFrom(left: number, right: number, gs: Gutter[]): [number, number][] {
  const out: [number, number][] = [];
  let x = left;
  for (const g of gs) { out.push([x, g.x0]); x = g.x1; }
  out.push([x, right]);
  return out;
}

export function classifyRows(s: ScanResult, c: Columns): Uint8Array {
  const { width: W, height: H } = s;
  const kinds = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    if (s.bgCount[y] >= W * 0.97) { kinds[y] = RowKind.Gap; continue; }
    let ok = c.gutters.every((g) => countBg(s, y, g.x0, g.x1) >= (g.x1 - g.x0) * 0.75);
    if (ok && c.left > 2) ok = countBg(s, y, 0, c.left) >= c.left * 0.75;
    if (ok && W - c.right > 2) ok = countBg(s, y, c.right, W) >= (W - c.right) * 0.75;
    if (ok) {
      // 헤더의 아이콘 줄처럼 거의 빈 행은 그리드가 아니다
      ok = c.cells.some(([a, b]) => 1 - countBg(s, y, a, b) / (b - a) >= 0.25);
    }
    kinds[y] = ok ? RowKind.Grid : RowKind.Other;
  }
  return kinds;
}

/**
 * Grid 행이 이어진 구간을 띠(band)로 묶는다. 사진 속 흰 부분 때문에 생긴
 * 짧은 Other 행 끊김은 이어 붙이고, 위아래가 무엇으로 막혔는지 기록한다.
 */
export function findBands(kinds: Uint8Array, cellWidth: number): Band[] {
  const H = kinds.length;
  const bridge = Math.max(2, Math.round(cellWidth * 0.08));
  const segs: [number, number][] = [];
  for (let y = 0; y < H; ) {
    if (kinds[y] !== RowKind.Grid) { y++; continue; }
    let e = y;
    while (e < H && kinds[e] === RowKind.Grid) e++;
    const prev = segs[segs.length - 1];
    if (prev && y - prev[1] <= bridge && allKind(kinds, prev[1], y, RowKind.Other)) prev[1] = e;
    else segs.push([y, e]);
    y = e;
  }
  const minH = cellWidth * 0.3;
  return segs
    .filter(([a, b]) => b - a >= minH)
    .map(([y0, y1]) => ({
      y0,
      y1,
      top: y0 === 0 ? 'edge' : kinds[y0 - 1] === RowKind.Gap ? 'gap' : 'other',
      bottom: y1 === H ? 'edge' : kinds[y1] === RowKind.Gap ? 'gap' : 'other',
    }));
}

function allKind(k: Uint8Array, a: number, b: number, kind: RowKind) {
  for (let y = a; y < b; y++) if (k[y] !== kind) return false;
  return true;
}

/**
 * 칸 세로 비율(높이/너비). 1:1, 4:5, 3:4 어느 것도 가정하지 않고, 위아래가 모두
 * 가로 여백으로 막힌 띠들의 비율 중 가장 많이 겹치는 값을 고른다.
 * 0.85~1.6 밖은 헤더의 하이라이트 줄 같은 가짜 띠로 보고 뺀다.
 */
export function estimateAspect(samples: { band: Band; cellWidth: number }[]): number | null {
  const ratiosOf = (pred: (b: Band) => boolean) =>
    samples
      .filter((s) => pred(s.band))
      .map((s) => (s.band.y1 - s.band.y0) / s.cellWidth)
      .filter((r) => r >= 0.85 && r <= 1.6);
  let ratios = ratiosOf((b) => b.top === 'gap' && b.bottom === 'gap');
  if (ratios.length === 0) ratios = ratiosOf((b) => b.top !== 'edge' && b.bottom !== 'edge');
  if (ratios.length === 0) return null;
  let bestGroup: number[] = [];
  for (const r of ratios) {
    const g = ratios.filter((q) => Math.abs(q - r) <= r * 0.025);
    if (g.length > bestGroup.length) bestGroup = g;
  }
  return median(bestGroup);
}

export type BandStatus = 'complete' | 'partial' | 'header-like';

export interface ClassifiedBand extends Band {
  status: BandStatus;
  /** 가로 여백 없이 붙은 여러 줄을 나눈 경우 원래 띠 */
  splitFrom?: [number, number];
}

/** 예상 칸 높이와 맞고 캡처 가장자리에 닿지 않은 띠만 온전한 줄로 인정한다. */
export function classifyBands(bands: Band[], c: Columns, aspect: number): ClassifiedBand[] {
  const expect = aspect * c.cellWidth;
  const tol = Math.max(3, expect * 0.03);
  const out: ClassifiedBand[] = [];
  for (const b of bands) {
    const h = b.y1 - b.y0;
    const touchesEdge = b.top === 'edge' || b.bottom === 'edge';
    if (!touchesEdge && Math.abs(h - expect) <= tol) {
      out.push({ ...b, status: 'complete' });
      continue;
    }
    // 가로 여백이 뭉개져 두 줄 이상이 붙은 띠
    const k = Math.round((h + c.gutterWidth) / (expect + c.gutterWidth));
    if (!touchesEdge && k >= 2 && Math.abs(h - (k * expect + (k - 1) * c.gutterWidth)) <= tol * k) {
      const step = (h + c.gutterWidth) / k;
      for (let i = 0; i < k; i++) {
        const y0 = Math.round(b.y0 + i * step);
        out.push({
          y0,
          y1: Math.round(y0 + step - c.gutterWidth),
          top: i === 0 ? b.top : 'gap',
          bottom: i === k - 1 ? b.bottom : 'gap',
          status: 'complete',
          splitFrom: [b.y0, b.y1],
        });
      }
      continue;
    }
    out.push({ ...b, status: touchesEdge || h < expect - tol ? 'partial' : 'header-like' });
  }
  return out;
}

function mode(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best = 0, bestN = -1;
  for (const [x, n] of counts) if (n > bestN) { bestN = n; best = x; }
  return best;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
