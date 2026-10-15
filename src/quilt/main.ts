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
    progress.textContent = errors.join(' ') || '읽을 수 있는 파일이 없어요.';
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
    progress.textContent = '조각으로 쓸 사진을 찾지 못했어요.';
    return;
  }
  progress.textContent = `${thumbs.length}조각 물들이는 중`;
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
  progress.textContent = `${thumbs.length}조각, ${groups}개의 날로 묶어 ${Math.round(performance.now() - t0)}ms 만에 이었어요.`;
  document.body.dataset.state = 'done';
  document.body.dataset.pieces = String(q.patchwork.pieces.length);
  (window as unknown as { __quilt: Quilt }).__quilt = q;
}

function updateSewStatus(sw: QuiltStage['sewing']) {
  const total = sw.seams.length;
  document.body.dataset.sewn = String(sw.sewnCount);
  sewStatus.textContent = sw.done
    ? `솔기 ${total}개를 모두 꿰맸어요. 한 장의 조각보가 되었어요.`
    : `솔기 ${sw.sewnCount} / ${total}. 붉은 시침실을 손가락이나 마우스로 따라 그으면 꿰매져요. 작은 조각부터 이어야 큰 솔기가 열립니다.`;
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
    info.innerHTML = `<strong>${m.order + 1}</strong> · ${FABRIC_NAMES[m.fabric.fabric]} · ${m.weighed.groupSize}장인 날 · 넓이 ${(area * 100).toFixed(1)}%`;
    li.append(rasterCanvas(m.thumb), chips, tile, info);
    ol.append(li);
  }
  const h = document.createElement('h2');
  h.textContent = '조각 장부';
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = '시간순(1이 가장 오래된 기억). 사진에서 뽑은 색 비율, 물들인 천, 묶인 날의 사진 수와 차지한 넓이.';
  box.replaceChildren(h, p, ol);
  box.hidden = false;
}

$('#files').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  if (!files.length) return;
  progress.textContent = '파일 여는 중';
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
  progress.textContent = '예시 캡처 만드는 중';
  await new Promise((r) => setTimeout(r, 20));
  const pr = buildProfile({ posts: 36, aspect: 1.25, seed: 5, style: 'natural' });
  const cap = longCapture(pr);
  await run([{ name: cap.name, kind: 'long', reader: rasterReader(cap.raster, stripHeightFor(cap.raster.width)), dispose() {} }]);
});
