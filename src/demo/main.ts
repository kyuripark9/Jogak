import type { Raster } from '../grid/raster.ts';
import { buildQuilt } from '../quilt/build.ts';
import { QuiltStage } from '../interaction/stage.ts';
import { Sewing, seamLength } from '../interaction/sewing.ts';
import { bindControls } from '../app/controls.ts';

/**
 * 첫 화면. 아무것도 올리지 않아도 조각보가 바로 보인다.
 * 거의 다 이어 둔 채로 마지막 큰 솔기 몇 개만 남겨, 방문자가 직접 꿰매어 완성하게 한다.
 * 사진은 public/demo/manifest.json 목록을 바꾸면 교체된다 (오래된 순, 찍은 날짜).
 */

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const status = $('#sew-status');
/** 이 깊이보다 얕은(큰) 솔기는 방문자 몫으로 남긴다 */
const LEAVE_DEPTH = 2;
const THUMB = 240;

/** 사진 한 장 → 색을 뽑을 작은 그림. 줄이는 일은 브라우저에 맡긴다 (240px이면 색과 결이 충분하다) */
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
    ? '다 이었어요. 이제 한 장의 조각보입니다.'
    : `마지막 솔기 ${left}개가 남았어요. 붉은 시침실을 따라 그어 직접 꿰매 보세요.`;
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
  status.textContent = `조각보를 펼치지 못했어요: ${e instanceof Error ? e.message : e}`;
});
