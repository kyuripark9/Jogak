import type { RGB, StripReader } from './raster.ts';
import { scan, type ScanOptions } from './scan.ts';
import {
  classifyBands,
  classifyRows,
  detectColumns,
  estimateAspect,
  findBands,
  type ClassifiedBand,
  type Columns,
} from './detect.ts';
import { extractCells, type CellCrop } from './cells.ts';
import { stitch, type GridRow, type SourceEdges, type StitchResult } from './stitch.ts';

export * from './raster.ts';
export * from './detect.ts';
export * from './cells.ts';
export * from './stitch.ts';
export { scan } from './scan.ts';

export interface SourceInput {
  name: string;
  reader: StripReader;
}

export interface SourceAnalysis {
  name: string;
  width: number;
  height: number;
  stripCount: number;
  bg: RGB | null;
  columns: Columns | null;
  /** 행별 분류 (RowKind) — 디버그 띠 표시용 */
  rowKinds: Uint8Array | null;
  bands: ClassifiedBand[];
  /** 첫 온전한 줄의 위쪽 y. 그 위는 헤더로 보고 건너뛴다 */
  headerEnd: number | null;
  cells: CellCrop[];
  /** 첫 줄 위, 마지막 줄 아래에 잘려 보이는 줄 */
  edges: SourceEdges;
  error?: string;
}

export interface Post {
  /** 그리드 순서 (0 = 맨 위 왼쪽 = 가장 최근) */
  gridIndex: number;
  cell: CellCrop;
}

export interface AnalysisResult {
  sources: SourceAnalysis[];
  aspect: number | null;
  stitch: StitchResult;
  posts: Post[];
}

export interface AnalyzeOptions extends Pick<ScanOptions, 'tolerance'> {
  thumbWidth?: number;
  onStrip?: (sourceIndex: number, ...args: Parameters<NonNullable<ScanOptions['onStrip']>>) => void;
  onProgress?: (message: string) => void;
}

export async function analyze(inputs: SourceInput[], opts: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const pre = [];
  for (const [i, { name, reader }] of inputs.entries()) {
    opts.onProgress?.(`${name}: finding gutters…`);
    const base = {
      name,
      width: reader.width,
      height: reader.height,
      stripCount: Math.ceil(reader.height / reader.stripHeight),
    };
    try {
      const s = await scan(reader, {
        tolerance: opts.tolerance,
        onStrip: opts.onStrip && ((r, y, p) => opts.onStrip!(i, r, y, p)),
      });
      const columns = detectColumns(s);
      if (!columns) {
        pre.push({ ...base, s, columns: null, kinds: null, bands: [] });
        continue;
      }
      const kinds = classifyRows(s, columns);
      pre.push({ ...base, s, columns, kinds, bands: findBands(kinds, columns.cellWidth) });
    } catch (e) {
      pre.push({ ...base, s: null, columns: null, kinds: null, bands: [], error: String(e) });
    }
  }

  // 칸 비율은 모든 캡처가 공유한다 (같은 계정의 그리드)
  const aspect = estimateAspect(
    pre.flatMap((p) => (p.columns ? p.bands.map((band) => ({ band, cellWidth: p.columns!.cellWidth })) : [])),
  );

  const sources: SourceAnalysis[] = [];
  for (const [i, p] of pre.entries()) {
    const out: SourceAnalysis = {
      name: p.name,
      width: p.width,
      height: p.height,
      stripCount: p.stripCount,
      bg: p.s?.bg ?? null,
      columns: p.columns,
      rowKinds: p.kinds,
      bands: [],
      headerEnd: null,
      cells: [],
      edges: {},
      error: 'error' in p ? p.error : undefined,
    };
    if (!p.columns || !p.s) {
      out.error ??= 'Could not find the vertical gutters of a three-column (or multi-column) grid.';
    } else if (aspect == null) {
      out.error = 'No row is fully visible top to bottom, so the cell aspect ratio could not be determined.';
      out.bands = p.bands.map((b) => ({ ...b, status: 'partial' as const }));
    } else {
      out.bands = classifyBands(p.bands, p.columns, aspect);
      const complete = out.bands.filter((b) => b.status === 'complete');
      out.headerEnd = complete[0]?.y0 ?? null;
      opts.onProgress?.(`${p.name}: cutting ${complete.length * p.columns.cells.length} cells…`);
      out.cells = await extractCells(i, inputs[i].reader, p.s, p.columns, complete, { thumbWidth: opts.thumbWidth });
      if (complete.length) {
        const first = out.bands.indexOf(complete[0]);
        const last = out.bands.indexOf(complete[complete.length - 1]);
        const rowH = complete[0].y1 - complete[0].y0;
        const edge = async (b: ClassifiedBand | undefined, touching: number) => {
          if (!b || b.status !== 'partial' || Math.abs(touching) > p.columns!.gutterWidth + 3) return undefined;
          const cells = await extractCells(i, inputs[i].reader, p.s!, p.columns!, [b], { thumbWidth: opts.thumbWidth });
          return { cells, fraction: (b.y1 - b.y0) / rowH };
        };
        const above = out.bands[first - 1], below = out.bands[last + 1];
        out.edges = {
          top: await edge(above, above ? complete[0].y0 - above.y1 : 0),
          bottom: await edge(below, below ? below.y0 - complete[complete.length - 1].y1 : 0),
        };
      }
    }
    sources.push(out);
  }

  const perSource: GridRow[][] = sources.map((s, si) => {
    const rows: GridRow[] = [];
    for (const c of s.cells) {
      (rows[c.rowIndex] ??= { sourceIndex: si, rowIndex: c.rowIndex, cells: [] }).cells.push(c);
    }
    return rows;
  });
  const st = stitch(perSource, sources.map((s) => s.edges));
  const posts: Post[] = [];
  for (const row of st.rows) for (const cell of row.cells) if (cell.kind !== 'empty') posts.push({ gridIndex: posts.length, cell });
  return { sources, aspect, stitch: st, posts };
}
