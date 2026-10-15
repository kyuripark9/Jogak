import { analyze, rasterReader, type AnalysisResult, type Raster, type SourceAnalysis, RowKind } from '../grid/index.ts';
import { loadFiles, stripHeightFor, type LoadedSource } from '../input/sources.ts';
import { buildProfile, longCapture, screenshots } from '../synth/profile.ts';

/**
 * 1단계 디버그 화면. 감지된 여백선과 줄을 원본 위에 겹쳐 보여 주고,
 * 잘라 낸 조각을 그리드 순서대로 늘어놓는다.
 */

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

const PREVIEW_WIDTH = 480;
const progress = $('#progress');
let pinned = 0;
let lastResult: AnalysisResult | null = null;
let current: LoadedSource[] = [];

function rasterCanvas(r: Raster, width = r.width) {
  const c = el('canvas');
  c.width = r.width;
  c.height = r.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  if (width !== r.width) {
    const s = el('canvas');
    s.width = width;
    s.height = Math.max(1, Math.round((r.height * width) / r.width));
    s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
    c.width = c.height = 0;
    return s;
  }
  return c;
}

async function run(sources: LoadedSource[], errors: string[] = []) {
  current.forEach((s) => s.dispose());
  current = sources;
  $('#sources').replaceChildren();
  $('#pieces').hidden = true;
  $('#summary').hidden = true;
  if (!sources.length) {
    progress.textContent = errors.join(' ') || 'No readable files.';
    return;
  }
  // 띠를 읽을 때마다 미리보기 조각을 쌓아 둔다 (긴 캡처도 한 캔버스에 올리지 않기 위해)
  const tiles: HTMLCanvasElement[][] = sources.map(() => []);
  const t0 = performance.now();
  const result = await analyze(
    sources.map((s) => ({ name: s.name, reader: s.reader })),
    {
      onStrip: (i, strip, _y, pass) => {
        if (pass === 1) tiles[i].push(rasterCanvas(strip, Math.min(PREVIEW_WIDTH, strip.width)));
      },
      onProgress: (m) => (progress.textContent = m),
    },
  );
  const ms = Math.round(performance.now() - t0);
  lastResult = result;
  (window as unknown as { __jogak: AnalysisResult }).__jogak = result;
  progress.textContent = `Read ${sources.length === 1 ? '1 capture' : `${sources.length} captures`} in ${ms} ms.` + (errors.length ? ` (${errors.join(' ')})` : '');
  renderSummary(result, sources);
  result.sources.forEach((s, i) => $('#sources').append(renderSource(result, s, i, tiles[i], sources[i])));
  renderPieces(result);
  document.body.dataset.state = 'done';
}

function renderSummary(r: AnalysisResult, sources: LoadedSource[]) {
  const box = $('#summary');
  const cols = r.sources.find((s) => s.columns)?.columns;
  const bg = r.sources.find((s) => s.bg)?.bg;
  const warnings = [
    ...r.sources.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`),
    ...r.stitch.joins.filter((j) => j.warning).map((j) => `${r.sources[j.sourceIndex].name}: ${j.warning}`),
  ];
  const kinds = { screenshot: 'screenshot', long: 'long capture', pdf: 'PDF' };
  const dl = el('dl', { class: 'facts' });
  const fact = (k: string, v: string | Node) => dl.append(el('dt', {}, k), el('dd', {}, v));
  fact('Captures', sources.map((s) => kinds[s.kind]).join(' · '));
  fact('Cell ratio', r.aspect ? `${ratioName(r.aspect)} (height/width ${r.aspect.toFixed(3)})` : 'Undetermined');
  fact('Columns', cols ? `${cols.cells.length} columns · cell ${Math.round(cols.cellWidth)}px · gutter ${cols.gutterWidth}px` : '—');
  if (bg) {
    const sw = el('span', { class: 'swatch' });
    sw.style.background = `rgb(${bg.join(',')})`;
    fact('Background (gutter) color', el('span', {}, sw, ` rgb(${bg.join(', ')})`));
  }
  fact('Pieces', `${r.posts.length} (${r.stitch.duplicates.size} duplicate rows removed)`);
  box.replaceChildren(el('h2', {}, 'Result'), dl);
  if (warnings.length) box.append(el('ul', { class: 'warnings' }, ...warnings.map((w) => el('li', {}, w))));
  const key = (style: string, label: string) => {
    const i = el('i');
    i.setAttribute('style', style);
    return el('li', {}, i, label);
  };
  box.append(
    el('h2', { class: 'legend-title' }, 'Overlay key'),
    el(
      'ul',
      { class: 'legend' },
      key('border:2px dashed var(--thread)', 'Cut cell'),
      key('border-left:2px dashed var(--indigo)', 'Vertical gutter'),
      key('background:rgba(243,238,227,.9);outline:1px solid var(--line)', 'Header (skipped)'),
      key('background:rgba(43,39,35,.55)', 'Cut-off row (discarded)'),
      key('background:repeating-linear-gradient(45deg,rgba(201,162,39,.6) 0 3px,transparent 3px 6px)', 'Row overlapping the previous capture'),
      key('background:linear-gradient(90deg,#a8432f 33%,#efe8da 33% 66%,#8c8478 66%)', 'Left ribbon: grid row / blank / other'),
    ),
  );
  box.hidden = false;
  box.dataset.posts = String(r.posts.length);
  box.dataset.aspect = r.aspect?.toFixed(3) ?? '';
}

function ratioName(a: number) {
  const known: [number, string][] = [[1, '1:1 square'], [1.25, '4:5 portrait'], [4 / 3, '3:4 portrait']];
  const hit = known.find(([v]) => Math.abs(v - a) < 0.02);
  return hit ? hit[1] : 'portrait';
}

function renderSource(r: AnalysisResult, s: SourceAnalysis, si: number, tiles: HTMLCanvasElement[], src: LoadedSource) {
  const fig = el('figure', { class: 'source', 'data-index': String(si) });
  const complete = s.bands.filter((b) => b.status === 'complete');
  const dupRows = complete.filter((_, ri) => r.stitch.duplicates.has(`${si}:${ri}`)).length;
  const join = r.stitch.joins.find((j) => j.sourceIndex === si);
  const facts = [
    `${s.width}×${s.height}px`,
    s.stripCount > 1 ? `read in ${s.stripCount} strips` : 'read in one pass',
    s.headerEnd != null ? `skipped top ${s.headerEnd}px` : '',
    `complete rows ${complete.length}`,
    `cut-off rows ${s.bands.filter((b) => b.status === 'partial').length}`,
    dupRows ? `rows overlapping the previous capture ${dupRows}` : '',
    join?.continuedByPartial ? 'continuity confirmed by a cut-off row' : '',
  ].filter(Boolean);
  fig.append(el('figcaption', {}, el('strong', {}, s.name), el('span', {}, facts.join(' · '))));

  const stage = el('div', { class: 'stage' });
  const ribbon = rowRibbon(s, tiles);
  const stack = el('div', { class: 'stack' }, ...tiles);
  stack.append(overlay(r, s, si), ribbon);
  stage.append(stack);
  fig.append(stage);
  if (s.error) fig.append(el('p', { class: 'warn' }, s.error));
  fig.dataset.kind = src.kind;
  fig.dataset.complete = String(complete.length);
  fig.dataset.duplicates = String(dupRows);
  return fig;
}

/** 왼쪽 띠: 행마다 그리드 행 / 빈 줄 / 그 밖(헤더·상단바) 중 무엇으로 읽었는지 */
function rowRibbon(s: SourceAnalysis, tiles: HTMLCanvasElement[]) {
  const h = tiles.reduce((p, t) => p + t.height, 0) || 1;
  const c = el('canvas', { class: 'ribbon', title: 'Row classification' });
  c.width = 1;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const colors = { [RowKind.Other]: '#8c8478', [RowKind.Gap]: '#efe8da', [RowKind.Grid]: '#a8432f' };
  if (s.rowKinds) {
    for (let py = 0; py < h; py++) {
      const k = s.rowKinds[Math.min(s.height - 1, Math.floor((py * s.height) / h))] as RowKind;
      ctx.fillStyle = colors[k];
      ctx.fillRect(0, py, 1, 1);
    }
  }
  return c;
}

function overlay(r: AnalysisResult, s: SourceAnalysis, si: number) {
  const o = svg('svg', { class: 'overlay', viewBox: `0 0 ${s.width} ${s.height}`, preserveAspectRatio: 'none' });
  const defs = svg('defs', {});
  const pat = svg('pattern', { id: `hatch${si}`, width: 24, height: 24, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.append(svg('rect', { width: 10, height: 24, fill: 'rgba(201,162,39,0.45)' }));
  defs.append(pat);
  o.append(defs);
  if (s.headerEnd != null && s.headerEnd > 0) {
    o.append(svg('rect', { x: 0, y: 0, width: s.width, height: s.headerEnd, class: 'skip' }));
  }
  const c = s.columns;
  const done = s.bands.filter((b) => b.status === 'complete');
  if (c && done.length) {
    // 여백선은 실제로 잘라 낸 그리드 구간에만 긋는다
    const y0 = done[0].y0, y1 = done[done.length - 1].y1;
    for (const g of c.gutters) {
      o.append(svg('rect', { x: g.x0, y: y0, width: g.x1 - g.x0, height: y1 - y0, class: 'gutter' }));
    }
  }
  let ri = 0;
  for (const b of s.bands) {
    if (b.status === 'complete' && c) {
      const dup = r.stitch.duplicates.has(`${si}:${ri}`);
      for (const [x0, x1] of c.cells) {
        o.append(svg('rect', { x: x0, y: b.y0, width: x1 - x0, height: b.y1 - b.y0, class: 'cell' }));
        if (dup) o.append(svg('rect', { x: x0, y: b.y0, width: x1 - x0, height: b.y1 - b.y0, fill: `url(#hatch${si})` }));
      }
      ri++;
    } else {
      o.append(svg('rect', { x: c?.left ?? 0, y: b.y0, width: (c?.right ?? s.width) - (c?.left ?? 0), height: b.y1 - b.y0, class: 'partial' }));
    }
  }
  return o;
}

function renderPieces(r: AnalysisResult) {
  const box = $('#pieces');
  const sel = el('select', { id: 'pinned' });
  for (let n = 0; n <= 3; n++) sel.append(el('option', { value: String(n) }, n === 0 ? 'None' : `First ${n}`));
  (sel as HTMLSelectElement).value = String(pinned);
  sel.addEventListener('change', () => {
    pinned = Number((sel as HTMLSelectElement).value);
    if (lastResult) renderPieces(lastResult);
  });
  const list = el('ol', { class: 'pieces' });
  const timeline = r.posts.length - pinned;
  for (const p of r.posts) {
    const isPinned = p.gridIndex < pinned;
    // 그리드는 최신이 맨 앞. 고정 게시물을 뺀 나머지를 뒤집으면 시간 순서
    const chrono = isPinned ? null : timeline - (p.gridIndex - pinned);
    const flags = [isPinned ? 'pinned' : '', p.cell.kind === 'placeholder' ? 'not loaded yet' : ''].filter(Boolean);
    const li = el(
      'li',
      { class: `piece ${p.cell.kind}${isPinned ? ' pinned' : ''}`, title: `${r.sources[p.cell.sourceIndex].name} · ${p.cell.rect.x},${p.cell.rect.y}` },
      rasterCanvas(p.cell.thumb),
      el('span', { class: 'n' }, `#${p.gridIndex + 1}`),
      el('span', { class: 't' }, chrono ? `#${chrono} in time` : 'not in timeline'),
    );
    if (flags.length) li.append(el('span', { class: 'flag' }, flags.join(' · ')));
    list.append(li);
  }
  box.replaceChildren(
    el('h2', {}, 'Cut pieces'),
    el('p', { class: 'hint' }, 'Laid out in grid order (top left is the most recent). #1 in time is the oldest memory.'),
    el('label', { class: 'pin' }, 'Pinned posts at the top of the profile ', sel),
    list,
  );
  box.hidden = false;
}

// ── 입력 ─────────────────────────────────────────────────────────

async function fromFiles(files: File[]) {
  progress.textContent = 'Opening files…';
  document.body.dataset.state = 'busy';
  const { sources, errors } = await loadFiles(files);
  await run(sources, errors);
}

$('#files').addEventListener('change', (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  if (files.length) void fromFiles(files);
});

const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void fromFiles(files);
});

/** 합성 캡처는 메모리에서 바로 읽는다 (긴 캡처를 PNG로 만들 캔버스가 모바일에선 너무 크다) */
function memorySource(name: string, r: Raster, kind: LoadedSource['kind']): LoadedSource {
  return { name, kind, reader: rasterReader(r, stripHeightFor(r.width)), dispose() {} };
}

document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((b) =>
  b.addEventListener('click', async () => {
    progress.textContent = 'Generating sample screenshots…';
    document.body.dataset.state = 'busy';
    await new Promise((r) => setTimeout(r, 20));
    if (b.dataset.sample === 'shots') {
      const pr = buildProfile({ posts: 30, aspect: 1.25, seed: 11 });
      const shots = screenshots(pr, [0, 1300, 2600, 3900, 5200]);
      await run(shots.map((s) => memorySource(s.name, s.raster, 'screenshot')));
    } else {
      const pr = buildProfile({ posts: 45, aspect: 4 / 3, dark: true, seed: 21, placeholders: [31] });
      const cap = longCapture(pr);
      await run([memorySource(cap.name, cap.raster, 'long')]);
    }
  }),
);
