import { analyze, rasterReader, type AnalysisResult, type Raster } from '../grid/index.ts';
import { loadFiles, stripHeightFor, type LoadedSource } from '../input/sources.ts';
import { loadAlbum, memoryKeys, type AlbumPhoto } from '../input/album.ts';
import { readExif } from '../input/exif.ts';
import { sampleAlbum } from '../synth/album.ts';
import { buildProfile, longCapture } from '../synth/profile.ts';
import { FABRIC_NAMES } from '../color/extract.ts';
import { buildQuilt, type Quilt } from './build.ts';
import { QuiltStage, sharpWidth } from '../interaction/stage.ts';
import { finishedView } from '../render/quilt.ts';
import { bindControls } from '../app/controls.ts';
import { weaveTile } from '../render/fabric.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const progress = $('#progress');
const pinnedSel = $<HTMLSelectElement>('#pinned');
/** What the patchwork is cut from: Instagram screenshots (undated) or album photos (dated, located) */
let source: { kind: 'grid'; result: AnalysisResult } | { kind: 'album'; photos: AlbumPhoto[] } | null = null;
let seed = 7;
let stage: QuiltStage | null = null;
const sewStatus = $('#sew-status');
// For tests and review: ?sewn=all starts fully sewn
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
  const result = await analyze(
    sources.map((s) => ({ name: s.name, reader: s.reader })),
    { onProgress: (m) => (progress.textContent = m) },
  );
  sources.forEach((s) => s.dispose());
  source = { kind: 'grid', result };
  sew();
}

function sew() {
  if (!source) return;
  let thumbs: Raster[];
  let keys: string[] | undefined;
  if (source.kind === 'grid') {
    const pinned = Number(pinnedSel.value);
    // The grid is newest first; drop pinned posts and unloaded cells, then reverse to start from the oldest memory
    thumbs = source.result.posts
      .filter((p) => p.gridIndex >= pinned && p.cell.kind === 'post')
      .map((p) => p.cell.thumb)
      .reverse();
  } else {
    thumbs = source.photos.map((p) => p.thumb);
    keys = memoryKeys(source.photos);
  }
  // Pinned posts only exist on an Instagram profile
  $('#pin-label').hidden = source.kind !== 'grid';
  if (!thumbs.length) {
    progress.textContent = 'Found no photos to use as pieces.';
    return;
  }
  progress.textContent = `Dyeing ${thumbs.length} pieces…`;
  const t0 = performance.now();
  const q = buildQuilt(thumbs, seed, keys);
  const canvas = $<HTMLCanvasElement>('#canvas');
  $('#quilt').hidden = false;
  stage?.destroy();
  stage = new QuiltStage(
    canvas,
    q,
    sharpWidth(canvas),
    { onSewn: (_, sw) => { updateSewStatus(sw); syncControls(); }, onChange: (sw) => updateSewStatus(sw) },
    startSewn ? finishedView(q).sewing : undefined,
  );
  const syncControls = bindControls(stage, q, $<HTMLButtonElement>('#light'), $<HTMLButtonElement>('#save'));
  updateSewStatus(stage.sewing);
  (window as unknown as { __stage: QuiltStage }).__stage = stage;
  $('#reseed').hidden = false;
  renderLedger(q, source.kind === 'album' ? source.photos : undefined);
  const groups = new Set(q.memories.map((m) => m.weighed.group)).size;
  const ms = Math.round(performance.now() - t0);
  if (source.kind === 'album') {
    const days = new Set(source.photos.map((p) => p.taken.slice(0, 10))).size;
    const undated = source.photos.filter((p) => !p.dated).length;
    progress.textContent =
      `${plural(thumbs.length, 'photo')} from ${plural(days, 'day')}, grouped into ${plural(groups, 'memory', 'memories')}, laid out in ${ms} ms.` +
      (undated ? ` ${plural(undated, 'photo')} had no capture date, so the file date stood in.` : '');
  } else {
    progress.textContent = `${thumbs.length} pieces grouped into ${plural(groups, 'day')}, laid out in ${ms} ms.`;
  }
  document.body.dataset.state = 'done';
  document.body.dataset.pieces = String(q.patchwork.pieces.length);
  (window as unknown as { __quilt: Quilt }).__quilt = q;
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function updateSewStatus(sw: QuiltStage['sewing']) {
  const total = sw.seams.length;
  document.body.dataset.sewn = String(sw.sewnCount);
  sewStatus.textContent = sw.done
    ? `All ${total} seams sewn. It is one cloth now.`
    : `Seams ${sw.sewnCount} / ${total}. Trace a red basting thread with your finger or mouse to sew it. Small pieces join first; the larger seams open after.`;
}

function renderLedger(q: Quilt, photos?: AlbumPhoto[]) {
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
    const when = photos ? ` · ${photos[m.order].taken.slice(0, 10)}` : '';
    const unit = photos ? 'in this memory' : 'that day';
    info.innerHTML = `<strong>${m.order + 1}</strong>${when} · ${FABRIC_NAMES[m.fabric.fabric]} · ${plural(m.weighed.groupSize, 'photo')} ${unit} · ${(area * 100).toFixed(1)}% of the area`;
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

async function runAlbum(files: File[]) {
  document.body.dataset.state = 'busy';
  progress.textContent = 'Reading photos…';
  const { photos, errors } = await loadAlbum(files, (n, total) => (progress.textContent = `Reading photos… ${n} / ${total}`));
  if (!photos.length) {
    progress.textContent = errors.join(' ') || 'No readable photos.';
    return;
  }
  source = { kind: 'album', photos };
  sew();
  if (errors.length) progress.textContent += ` (${errors.join(' ')})`;
}

$('#album').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  if (files.length) await runAlbum(files);
});

const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  // Camera photos carry a capture date; screenshots and PDFs do not
  if (await looksLikeAlbum(files)) return runAlbum(files);
  const { sources, errors } = await loadFiles(files);
  await run(sources, errors);
});

async function looksLikeAlbum(files: File[]) {
  const jpegs = files.filter((f) => f.type === 'image/jpeg');
  if (jpegs.length < files.length / 2) return false;
  const dated = await Promise.all(jpegs.slice(0, 5).map(async (f) => !!readExif(await f.slice(0, 256 * 1024).arrayBuffer()).taken));
  return dated.some(Boolean);
}

pinnedSel.addEventListener('change', sew);
// Same memories, different scissor cuts every time
$('#reseed').addEventListener('click', () => { seed++; sew(); });

$('[data-sample="natural"]').addEventListener('click', async () => {
  progress.textContent = 'Generating sample screenshots…';
  await new Promise((r) => setTimeout(r, 20));
  const pr = buildProfile({ posts: 36, aspect: 1.25, seed: 5, style: 'natural' });
  const cap = longCapture(pr);
  await run([{ name: cap.name, kind: 'long', reader: rasterReader(cap.raster, stripHeightFor(cap.raster.width)), dispose() {} }]);
});

$('[data-sample="album"]').addEventListener('click', async () => {
  progress.textContent = 'Generating a sample camera roll…';
  await runAlbum(await sampleAlbum());
});
