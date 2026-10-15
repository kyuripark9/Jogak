import type { Raster } from '../grid/raster.ts';
import { buildQuilt } from '../quilt/build.ts';
import { QuiltStage } from '../interaction/stage.ts';
import { Sewing, seamLength } from '../interaction/sewing.ts';
import { bindControls } from '../app/controls.ts';

/**
 * Landing page. A jogakbo shows up right away, with nothing uploaded.
 * It comes almost fully joined, leaving the last few large seams for visitors to sew and finish themselves.
 * Swap the photos by editing the list in public/demo/manifest.json (oldest first, with date taken).
 */

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const status = $('#sew-status');
/** Seams shallower (larger) than this depth are left for the visitor */
const LEAVE_DEPTH = 2;
const THUMB = 240;

/** One photo → a small image to pull colors from. The browser does the downscaling (240px is plenty for color and grain) */
async function loadRaster(src: string): Promise<Raster> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const w = Math.min(THUMB, img.naturalWidth), h = Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

function say(sw: Sewing) {
  const left = sw.seams.filter((s) => !s.sewn).length;
  document.body.dataset.sewn = String(sw.sewnCount);
  status.textContent = sw.done
    ? 'All sewn. It is one cloth now.'
    : `${left === 1 ? 'One last seam is' : `The last ${left} seams are`} left. Trace the red basting thread to sew it yourself.`;
}

async function main() {
  const base = new URL('./demo/', location.href);
  const list: { src: string; date?: string }[] = await (await fetch(new URL('manifest.json', base))).json();
  const thumbs = await Promise.all(list.map((m) => loadRaster(new URL(m.src, base).href)));
  const dates = list.every((m) => m.date) ? list.map((m) => m.date!) : undefined;
  const q = buildQuilt(thumbs, 11, dates);

  const sewing = new Sewing(q.patchwork);
  const order = q.patchwork.seams.map((_, i) => i).sort((a, b) => q.patchwork.seams[b].depth - q.patchwork.seams[a].depth);
  for (const i of order) {
    if (q.patchwork.seams[i].depth >= LEAVE_DEPTH) sewing.sew(i, 0, seamLength(q.patchwork.seams[i]), 0.15);
  }

  const canvas = $<HTMLCanvasElement>('#canvas');
  const cssW = Math.min(720, canvas.clientWidth || 720);
  let sync = () => {};
  const stage = new QuiltStage(
    canvas,
    q,
    Math.min(2048, Math.round(cssW * Math.min(2, devicePixelRatio || 1))),
    { onSewn: (_, sw) => { say(sw); sync(); } },
    sewing,
  );
  sync = bindControls(stage, q, $<HTMLButtonElement>('#light'), $<HTMLButtonElement>('#save'));
  say(sewing);
  document.body.dataset.state = 'done';
  (window as unknown as { __stage: QuiltStage; __quilt: typeof q }).__stage = stage;
  (window as unknown as { __quilt: typeof q }).__quilt = q;
}

main().catch((e) => {
  status.textContent = `Could not unfold the patchwork: ${e instanceof Error ? e.message : e}`;
});
