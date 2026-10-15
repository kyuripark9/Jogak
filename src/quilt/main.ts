import { analyze, rasterReader, type AnalysisResult, type Raster } from '../grid/index.ts';
import { loadFiles, stripHeightFor, type LoadedSource } from '../input/sources.ts';
import { buildProfile, longCapture } from '../synth/profile.ts';
import { FABRIC_NAMES } from '../color/extract.ts';
import { buildQuilt, type Quilt } from './build.ts';
import { QuiltStage } from '../interaction/stage.ts';
import { finishedView } from '../render/quilt.ts';
import { bindControls } from '../app/controls.ts';
import { weaveTile } from '../render/fabric.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const progress = $('#progress');
const pinnedSel = $<HTMLSelectElement>('#pinned');
let result: AnalysisResult | null = null;
let seed = 7;
let stage: QuiltStage | null = null;
const sewStatus = $('#sew-status');
// 테스트·확인용: ?sewn=all 이면 다 꿰맨 상태로 시작
const startSewn = new URLSearchParams(location.search).get('sewn') === 'all';

function rasterCanvas(r: Raster) {
  const c = document.createElement('canvas');
  c.width = r.width;
  c.height = r.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  return c;
}

async function run(sources: LoadedSource[], errors: string[] = []) {
  document.body.dataset.state = 'busy';
  if (!sources.length) {
    progress.textContent = errors.join(' ') || 'No readable files.';
    return;
  }
  result = await analyze(
    sources.map((s) => ({ name: s.name, reader: s.reader })),
    { onProgress: (m) => (progress.textContent = m) },
  );
  sources.forEach((s) => s.dispose());
  sew();
}

function sew() {
  if (!result) return;
  const pinned = Number(pinnedSel.value);
  // 그리드는 최신순. 고정 게시물과 불러오기 전 칸을 빼고 뒤집으면 오래된 기억부터
  const thumbs = result.posts
    .filter((p) => p.gridIndex >= pinned && p.cell.kind === 'post')
    .map((p) => p.cell.thumb)
    .reverse();
  if (!thumbs.length) {
    progress.textContent = 'Found no photos to use as pieces.';
    return;
  }
  progress.textContent = `Dyeing ${thumbs.length} pieces…`;
  const t0 = performance.now();
  const q = buildQuilt(thumbs, seed);
  const canvas = $<HTMLCanvasElement>('#canvas');
  $('#quilt').hidden = false;
  const cssW = Math.min(720, canvas.clientWidth || 720);
  stage?.destroy();
  stage = new QuiltStage(
    canvas,
    q,
    Math.min(2048, Math.round(cssW * Math.min(2, devicePixelRatio || 1))),
    { onSewn: (_, sw) => { updateSewStatus(sw); syncControls(); }, onChange: (sw) => updateSewStatus(sw) },
    startSewn ? finishedView(q).sewing : undefined,
  );
  const syncControls = bindControls(stage, q, $<HTMLButtonElement>('#light'), $<HTMLButtonElement>('#save'));
  updateSewStatus(stage.sewing);
  (window as unknown as { __stage: QuiltStage }).__stage = stage;
  $('#reseed').hidden = false;
  renderLedger(q);
  const groups = new Set(q.memories.map((m) => m.weighed.group)).size;
  progress.textContent = `${thumbs.length} pieces grouped into ${plural(groups, 'day')}, laid out in ${Math.round(performance.now() - t0)} ms.`;
  document.body.dataset.state = 'done';
  document.body.dataset.pieces = String(q.patchwork.pieces.length);
  (window as unknown as { __quilt: Quilt }).__quilt = q;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function updateSewStatus(sw: QuiltStage['sewing']) {
  const total = sw.seams.length;
  document.body.dataset.sewn = String(sw.sewnCount);
  sewStatus.textContent = sw.done
    ? `All ${total} seams sewn. It is one cloth now.`
    : `Seams ${sw.sewnCount} / ${total}. Trace a red basting thread with your finger or mouse to sew it. Small pieces join first; the larger seams open after.`;
}

function renderLedger(q: Quilt) {
  const box = $('#ledger');
  const ol = document.createElement('ol');
  ol.className = 'ledger';
  const total = q.patchwork.pieces.reduce((a, p) => a + p.area, 0);
  for (const m of q.memories) {
    const li = document.createElement('li');
    const chips = document.createElement('span');
    chips.className = 'chips';
    for (const s of m.extracted.palette) {
      const i = document.createElement('i');
      i.style.background = `rgb(${s.rgb.join(',')})`;
      i.style.width = `${s.weight * 100}%`;
      chips.append(i);
    }
    const tile = rasterCanvas(weaveTile(m.fabric, 64));
    tile.className = 'swatch-fabric';
    const area = q.patchwork.pieces[m.order].area / total;
    const info = document.createElement('span');
    info.innerHTML = `<strong>${m.order + 1}</strong> · ${FABRIC_NAMES[m.fabric.fabric]} · ${plural(m.weighed.groupSize, 'photo')} that day · ${(area * 100).toFixed(1)}% of the area`;
    li.append(rasterCanvas(m.thumb), chips, tile, info);
    ol.append(li);
  }
  const h = document.createElement('h2');
  h.textContent = 'Piece ledger';
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = 'In time order (1 is the oldest memory): color ratios taken from the photo, the cloth it was dyed into, how many photos share its day, and the area it takes.';
  box.replaceChildren(h, p, ol);
  box.hidden = false;
}

$('#files').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  if (!files.length) return;
  progress.textContent = 'Opening files…';
  const { sources, errors } = await loadFiles(files);
  await run(sources, errors);
});

const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  const { sources, errors } = await loadFiles(files);
  await run(sources, errors);
});

pinnedSel.addEventListener('change', sew);
// 같은 기억이라도 가위질은 매번 다르다
$('#reseed').addEventListener('click', () => { seed++; sew(); });

$('[data-sample="natural"]').addEventListener('click', async () => {
  progress.textContent = 'Generating sample screenshots…';
  await new Promise((r) => setTimeout(r, 20));
  const pr = buildProfile({ posts: 36, aspect: 1.25, seed: 5, style: 'natural' });
  const cap = longCapture(pr);
  await run([{ name: cap.name, kind: 'long', reader: rasterReader(cap.raster, stripHeightFor(cap.raster.width)), dispose() {} }]);
});
