import { cropRaster } from './raster.ts';
import { signature, signatureDistance, type CellCrop } from './cells.ts';

/**
 * 스크린샷 여러 장을 한 줄로 잇는다. 캡처 사이에 겹친 줄은 칸 단위
 * 서명(signature)이 모두 같은지로 찾고, 겹침이 가장 긴 위치에서 이어 붙인다.
 * 줄 단위로만 비교하는 이유: 칸 하나는 우연히 닮을 수 있어도
 * 한 줄(보통 3칸)이 통째로 닮을 일은 거의 없다.
 */

export interface GridRow {
  sourceIndex: number;
  rowIndex: number;
  cells: CellCrop[];
}

/** 캡처 위아래 끝에 잘려 보이는 줄. 겹친 줄이 없을 때 이어짐을 확인하는 데 쓴다 */
export interface PartialRow {
  cells: CellCrop[];
  /** 잘린 줄이 온전한 줄 높이의 몇 분의 몇인지 */
  fraction: number;
}

export interface SourceEdges {
  top?: PartialRow;
  bottom?: PartialRow;
}

export interface Join {
  /** 이어 붙인 쪽 (뒤 캡처) */
  sourceIndex: number;
  /** 앞 결과와 겹쳐서 버린 줄 수 */
  overlapRows: number;
  /** 겹친 줄은 없지만 잘린 줄로 바로 이어짐을 확인함 */
  continuedByPartial?: boolean;
  warning?: string;
}

export interface StitchResult {
  rows: GridRow[];
  /** `${sourceIndex}:${rowIndex}` → 앞 캡처의 어느 줄과 같은지 */
  duplicates: Map<string, { sourceIndex: number; rowIndex: number }>;
  joins: Join[];
}

export const MATCH_THRESHOLD = 10;

export function rowsMatch(a: GridRow, b: GridRow): boolean {
  if (a.cells.length !== b.cells.length) return false;
  return a.cells.every((ca, i) => {
    const cb = b.cells[i];
    if (ca.kind !== cb.kind) return false;
    if (ca.kind === 'empty') return true;
    return signatureDistance(ca.signature, cb.signature) < MATCH_THRESHOLD;
  });
}

/** 온전한 줄의 [f0, f1) 높이 부분이 잘린 줄과 같은지 */
function partialMatches(full: GridRow, part: PartialRow, fromBottom: boolean): boolean {
  if (part.fraction < 0.15 || part.cells.length !== full.cells.length) return false;
  return full.cells.every((c, i) => {
    const pc = part.cells[i];
    if (c.kind === 'empty' || pc.kind === 'empty') return c.kind === pc.kind;
    const t = c.thumb;
    const h = Math.max(1, Math.round(t.height * Math.min(1, part.fraction)));
    const sub = cropRaster(t, 0, fromBottom ? t.height - h : 0, t.width, h);
    return signatureDistance(signature(sub), pc.signature) < MATCH_THRESHOLD;
  });
}

export function stitch(sources: GridRow[][], edges: SourceEdges[] = []): StitchResult {
  const rows: GridRow[] = [];
  const duplicates: StitchResult['duplicates'] = new Map();
  const joins: Join[] = [];
  let prevEdges: SourceEdges | undefined;
  for (const [si, next] of sources.entries()) {
    if (next.length === 0) continue;
    const myEdges = edges[si];
    if (rows.length === 0) { rows.push(...next); prevEdges = myEdges; continue; }
    // next[0]이 rows[j]에 겹치고 그 뒤로 rows 끝까지 모두 같은 가장 앞의 j
    let overlap = 0;
    for (let j = Math.max(0, rows.length - next.length); j < rows.length; j++) {
      const k = rows.length - j;
      let ok = true;
      for (let t = 0; t < k && ok; t++) ok = rowsMatch(rows[j + t], next[t]);
      if (ok) { overlap = k; break; }
    }
    // 뒤 캡처가 통째로 앞 결과 안에 있는 경우 (같은 화면을 두 번 찍음)
    let contained = -1;
    if (overlap === 0) {
      for (let j = 0; j + next.length <= rows.length && contained < 0; j++) {
        if (next.every((r, t) => rowsMatch(rows[j + t], r))) contained = j;
      }
    }
    const join: Join = { sourceIndex: next[0].sourceIndex, overlapRows: overlap };
    if (contained >= 0) {
      next.forEach((r, t) => duplicates.set(key(r), ref(rows[contained + t])));
      join.overlapRows = next.length;
      join.warning = '앞 캡처에 이미 모두 들어 있는 화면이에요.';
    } else {
      for (let t = 0; t < overlap; t++) duplicates.set(key(next[t]), ref(rows[rows.length - overlap + t]));
      const last = rows[rows.length - 1];
      if (
        overlap === 0 &&
        ((myEdges?.top && partialMatches(last, myEdges.top, true)) ||
          (prevEdges?.bottom && partialMatches(next[0], prevEdges.bottom, false)))
      ) {
        join.continuedByPartial = true;
      } else if (overlap === 0) {
        join.warning = '앞 캡처와 겹치는 줄이 없어요. 사이에 빠진 줄이 있을 수 있으니 조금씩 겹치게 찍어 주세요.';
      }
      rows.push(...next.slice(overlap));
    }
    joins.push(join);
    prevEdges = myEdges;
  }
  return { rows, duplicates, joins };
}

const key = (r: GridRow) => `${r.sourceIndex}:${r.rowIndex}`;
const ref = (r: GridRow) => ({ sourceIndex: r.sourceIndex, rowIndex: r.rowIndex });
