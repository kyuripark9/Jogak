import type { Raster, StripReader } from '../grid/raster.ts';

/**
 * 입력 파이프라인. 스크린샷, 긴 스크롤 캡처, 사파리 전체 페이지 PDF를 모두
 * 같은 StripReader로 바꿔서 그리드 감지에 넘긴다. 파일은 브라우저 밖으로 나가지 않는다.
 */

export type SourceKind = 'screenshot' | 'long' | 'pdf';

export interface LoadedSource {
  name: string;
  kind: SourceKind;
  reader: StripReader;
  dispose(): void;
}

/**
 * 띠 하나의 최대 픽셀 수. iOS 사파리는 캔버스 하나당 약 16.7M 픽셀(4096²)을 넘으면
 * 빈 캔버스를 돌려주고, 페이지 전체 캔버스 메모리도 제한이 있어서 넉넉히 1/4로 잡는다.
 */
export const MAX_STRIP_PIXELS = 4_000_000;

export const stripHeightFor = (width: number) => Math.max(64, Math.floor(MAX_STRIP_PIXELS / width));

function stripCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('캔버스를 만들 수 없어요.');
  return { canvas, ctx };
}

/** 사파리는 한계를 넘으면 오류 없이 빈(투명) 픽셀을 준다. 몇 점만 찍어 확인한다 */
function looksBlank(d: Uint8ClampedArray) {
  const step = Math.max(4, Math.floor(d.length / 4 / 997) * 4);
  for (let i = 3; i < d.length; i += step) if (d[i] !== 0) return false;
  return true;
}

function toRaster(img: ImageData): Raster {
  return { width: img.width, height: img.height, data: img.data };
}

export async function imageSource(file: File): Promise<LoadedSource> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`${file.name}: 이미지를 열 수 없어요.`);
  }
  const W = img.naturalWidth, H = img.naturalHeight;
  const stripHeight = stripHeightFor(W);
  const { canvas, ctx } = stripCanvas(W, Math.min(H, stripHeight));
  return {
    name: file.name,
    kind: H > W * 3 ? 'long' : 'screenshot',
    reader: {
      width: W,
      height: H,
      stripHeight,
      async readStrip(y, h) {
        if (canvas.height !== h) canvas.height = h;
        ctx.clearRect(0, 0, W, h);
        ctx.drawImage(img, 0, y, W, h, 0, 0, W, h);
        let data = ctx.getImageData(0, 0, W, h);
        if (looksBlank(data.data)) {
          // 큰 이미지를 <img>로 통째로 못 그리는 경우: 필요한 띠만 잘라 다시 디코딩
          const bmp = await createImageBitmap(file, 0, y, W, h);
          ctx.clearRect(0, 0, W, h);
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          data = ctx.getImageData(0, 0, W, h);
          if (looksBlank(data.data)) {
            throw new Error(`${file.name}: 이 기기에서는 이미지가 너무 커서 ${y}px 부근을 읽지 못했어요.`);
          }
        }
        return toRaster(data);
      },
    },
    dispose() {
      URL.revokeObjectURL(url);
      canvas.width = canvas.height = 0;
    },
  };
}

/** PDF 페이지를 이 폭으로 렌더한다 (아이폰 3배율 화면 폭과 비슷하게) */
const PDF_TARGET_WIDTH = 1170;

export async function pdfSources(file: File): Promise<LoadedSource[]> {
  // legacy 빌드: 최신 JS 기능(Map.getOrInsertComputed 등)을 폴리필해 두어 iOS 사파리에서도 돈다
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  let open = doc.numPages;
  const out: LoadedSource[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_TARGET_WIDTH / base.width });
    const W = Math.floor(viewport.width), H = Math.floor(viewport.height);
    const stripHeight = stripHeightFor(W);
    const { canvas, ctx } = stripCanvas(W, Math.min(H, stripHeight));
    out.push({
      name: doc.numPages > 1 ? `${file.name} · ${n}쪽` : file.name,
      kind: 'pdf',
      reader: {
        width: W,
        height: H,
        stripHeight,
        async readStrip(y, h) {
          if (canvas.height !== h) canvas.height = h;
          // 페이지 전체가 아니라 [y, y+h) 구간만 캔버스에 오도록 위로 민다
          await page.render({
            canvas,
            canvasContext: ctx,
            viewport,
            transform: [1, 0, 0, 1, 0, -y],
            background: '#ffffff',
          }).promise;
          return toRaster(ctx.getImageData(0, 0, W, h));
        },
      },
      dispose() {
        canvas.width = canvas.height = 0;
        if (--open === 0) void task.destroy();
      },
    });
  }
  return out;
}

/**
 * 파일들을 이름순(숫자는 숫자로)으로 정렬해서 읽는다. 아이폰 스크린샷 이름
 * (IMG_4101, IMG_4102 …)이 찍은 순서라서 스크롤 순서가 된다.
 */
export async function loadFiles(files: File[]): Promise<{ sources: LoadedSource[]; errors: string[] }> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const sources: LoadedSource[] = [];
  const errors: string[] = [];
  for (const f of sorted) {
    try {
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) sources.push(...(await pdfSources(f)));
      else sources.push(await imageSource(f));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { sources, errors };
}
