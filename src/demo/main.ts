import type { Raster } from '../grid/raster.ts';
import { buildQuilt } from '../quilt/build.ts';
import { QuiltStage, sharpWidth } from '../interaction/stage.ts';
import { Sewing, seamLength, type SeamState } from '../interaction/sewing.ts';
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

/**
 * Your stitches stay when you come back: a jogakbo is sewn over many sittings.
 * Only stitch positions are kept (in this browser's storage), never photos.
 */
function progressKey(list: { src: string; date?: string }[], seams: number) {
  let h = 0;
  for (const c of JSON.stringify(list)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  // A different photo list or layout makes old stitches meaningless, so it gets a different key
  return `jogak:demo:${(h >>> 0).toString(36)}:${seams}`;
}

function save(sw: Sewing, key: string) {
  try {
    localStorage.setItem(key, JSON.stringify(sw.seams));
  } catch {
    // Private browsing or full storage: sewing still works, it just won't be remembered
  }
}

function restore(sw: Sewing, key: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as SeamState[] | null;
    if (!Array.isArray(saved) || saved.length !== sw.seams.length) return false;
    saved.forEach((st, i) => Object.assign(sw.seams[i], { sewn: !!st.sewn, covered: st.covered ?? [], stitches: st.stitches ?? [] }));
    return true;
  } catch {
    return false;
  }
}

function forget(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing was stored
  }
}

async function main() {
  const base = new URL('./demo/', location.href);
  const list: { src: string; date?: string }[] = await (await fetch(new URL('manifest.json', base))).json();
  const thumbs = await Promise.all(list.map((m) => loadRaster(new URL(m.src, base).href)));
  const dates = list.every((m) => m.date) ? list.map((m) => m.date!) : undefined;
  const q = buildQuilt(thumbs, 11, dates);

  const key = progressKey(list, q.patchwork.seams.length);
  const sewing = new Sewing(q.patchwork);
  const restored = restore(sewing, key);
  if (!restored) {
    const order = q.patchwork.seams.map((_, i) => i).sort((a, b) => q.patchwork.seams[b].depth - q.patchwork.seams[a].depth);
    for (const i of order) {
      if (q.patchwork.seams[i].depth >= LEAVE_DEPTH) sewing.sew(i, 0, seamLength(q.patchwork.seams[i]), 0.15);
    }
  }
  const presewn = restored ? -1 : sewing.sewnCount;

  const canvas = $<HTMLCanvasElement>('#canvas');
  const unpick = $<HTMLButtonElement>('#unpick');
  const showUnpick = () => (unpick.hidden = sewing.sewnCount === presewn && !sewing.seams.some((st) => !st.sewn && st.stitches.length));
  let sync = () => {};
  let saveTimer = 0;
  const stage = new QuiltStage(
    canvas,
    q,
    sharpWidth(canvas),
    {
      onSewn: (_, sw) => { say(sw); sync(); },
      onChange: (sw) => {
        showUnpick();
        clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => save(sw, key), 300);
      },
    },
    sewing,
  );
  showUnpick();
  // Unpicking undoes your own stitches only; the seams that came already sewn stay sewn
  unpick.onclick = () => {
    forget(key);
    location.reload();
  };
  sync = bindControls(stage, q, $<HTMLButtonElement>('#light'), $<HTMLButtonElement>('#save'));
  say(sewing);
  document.body.dataset.state = 'done';
  (window as unknown as { __stage: QuiltStage; __quilt: typeof q }).__stage = stage;
  (window as unknown as { __quilt: typeof q }).__quilt = q;
}

main().catch((e) => {
  status.textContent = `Could not unfold the patchwork: ${e instanceof Error ? e.message : e}`;
});
