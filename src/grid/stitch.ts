import { cropRaster } from './raster.ts';
import { signature, signatureDistance, type CellCrop } from './cells.ts';

/**
 * Stitches multiple screenshots into one sequence of rows. Rows overlapping between captures are found
 * by matching every per-cell signature, and captures are joined at the longest overlap.
 * Why compare whole rows only: a single cell can look alike by chance,
 * but a whole row (usually 3 cells) almost never does.
 */

export interface GridRow {
  sourceIndex: number;
  rowIndex: number;
  cells: CellCrop[];
}

/** A row cut off at a capture's top or bottom edge. Used to confirm continuity when no rows overlap */
export interface PartialRow {
  cells: CellCrop[];
  /** What fraction of a full row's height the cut-off row shows */
  fraction: number;
}

export interface SourceEdges {
  top?: PartialRow;
  bottom?: PartialRow;
}

export interface Join {
  /** The side being attached (the later capture) */
  sourceIndex: number;
  /** Rows discarded for overlapping the result so far */
  overlapRows: number;
  /** No overlapping rows, but a cut-off row confirmed it continues directly */
  continuedByPartial?: boolean;
  warning?: string;
}

export interface StitchResult {
  rows: GridRow[];
  /** `${sourceIndex}:${rowIndex}` → which earlier capture row it duplicates */
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

/** Whether the [f0, f1) height slice of a full row matches a cut-off row */
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
    // The earliest j where next[0] overlaps rows[j] and everything through the end of rows matches
    let overlap = 0;
    for (let j = Math.max(0, rows.length - next.length); j < rows.length; j++) {
      const k = rows.length - j;
      let ok = true;
      for (let t = 0; t < k && ok; t++) ok = rowsMatch(rows[j + t], next[t]);
      if (ok) { overlap = k; break; }
    }
    // The later capture lies entirely within the result so far (same screen captured twice)
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
      join.warning = 'This screenshot is already fully covered by the previous one.';
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
        join.warning = 'No rows overlap the previous screenshot, so some rows may be missing. Take screenshots that overlap a little.';
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
