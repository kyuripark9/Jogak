import type { Quilt } from '../quilt/build.ts';
import type { QuiltStage } from '../interaction/stage.ts';
import { download, exportName, exportPng } from '../render/export.ts';

/**
 * Two gestures below the jogakbo.
 * - Hang in the window / Hang on the wall: toggles light mode.
 * - Keep: unlocks only once every seam is sewn, because unjoined pieces aren't one cloth yet.
 */
export function bindControls(stage: QuiltStage, q: Quilt, lightBtn: HTMLButtonElement, saveBtn: HTMLButtonElement) {
  const sync = () => {
    lightBtn.textContent = stage.mode === 'light' ? 'Hang it on the wall' : 'Hold it up to the window light';
    lightBtn.setAttribute('aria-pressed', String(stage.mode === 'light'));
    const done = stage.sewing.done;
    saveBtn.disabled = !done;
    saveBtn.textContent = done ? 'Keep it as a PNG' : 'Finish sewing to keep it';
    document.body.dataset.mode = stage.mode;
  };
  lightBtn.onclick = () => {
    stage.setMode(stage.mode === 'light' ? 'wall' : 'light');
    sync();
  };
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Weaving a large image…';
    try {
      const blob = await exportPng(q, stage.sewing, stage.mode);
      download(blob, exportName());
      document.body.dataset.exported = String(blob.size);
    } catch (e) {
      saveBtn.textContent = e instanceof Error ? e.message : String(e);
      return;
    }
    sync();
  };
  sync();
  return sync;
}
