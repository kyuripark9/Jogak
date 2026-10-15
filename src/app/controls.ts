import type { Quilt } from '../quilt/build.ts';
import type { QuiltStage } from '../interaction/stage.ts';
import { download, exportName, exportPng } from '../render/export.ts';

/**
 * 조각보 아래 두 가지 손짓.
 * - 창에 걸기 / 벽에 걸기: 빛 모드 전환.
 * - 간직하기: 솔기를 다 꿰맨 뒤에만 열린다. 이어지지 않은 조각은 아직 한 장이 아니니까.
 */
export function bindControls(stage: QuiltStage, q: Quilt, lightBtn: HTMLButtonElement, saveBtn: HTMLButtonElement) {
  const sync = () => {
    lightBtn.textContent = stage.mode === 'light' ? '벽에 걸기' : '창에 걸어 빛에 비춰 보기';
    lightBtn.setAttribute('aria-pressed', String(stage.mode === 'light'));
    const done = stage.sewing.done;
    saveBtn.disabled = !done;
    saveBtn.textContent = done ? 'PNG로 간직하기' : '다 꿰매면 간직할 수 있어요';
    document.body.dataset.mode = stage.mode;
  };
  lightBtn.onclick = () => {
    stage.setMode(stage.mode === 'light' ? 'wall' : 'light');
    sync();
  };
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '큰 그림으로 짓는 중';
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
