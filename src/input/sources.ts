import type { Raster, StripReader } from '../grid/raster.ts';

/**
 * Input pipeline. Screenshots, long scroll captures, and Safari full-page PDFs all become
 * the same StripReader for grid detection. Files never leave the browser.
 */

export type SourceKind = 'screenshot' | 'long' | 'pdf';

export interface LoadedSource {
  name: string;
  kind: SourceKind;
  reader: StripReader;
  dispose(): void;
}

/**
 * Max pixels per strip. iOS Safari returns a blank canvas above ~16.7M pixels (4096²) per canvas,
 * and total canvas memory per page is capped too, so we stay at a safe quarter of that.
 */
export const MAX_STRIP_PIXELS = 4_000_000;

export const stripHeightFor = (width: number) => Math.max(64, Math.floor(MAX_STRIP_PIXELS / width));

function stripCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a canvas.');
  return { canvas, ctx };
}

/** Past its limits Safari silently returns blank (transparent) pixels; sample a few points to check */
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
    throw new Error(`${file.name}: could not open this image.`);
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
          // When a large <img> can't be drawn whole: decode just the needed strip again
          const bmp = await createImageBitmap(file, 0, y, W, h);
          ctx.clearRect(0, 0, W, h);
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          data = ctx.getImageData(0, 0, W, h);
          if (looksBlank(data.data)) {
            throw new Error(`${file.name}: this image is too large for this device; reading stopped near ${y}px.`);
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

/** Render PDF pages at this width (close to an iPhone's 3x screen width) */
const PDF_TARGET_WIDTH = 1170;

export async function pdfSources(file: File): Promise<LoadedSource[]> {
  // Legacy build: polyfills newer JS features (Map.getOrInsertComputed etc.) so it runs on iOS Safari
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
      name: doc.numPages > 1 ? `${file.name} · page ${n}` : file.name,
      kind: 'pdf',
      reader: {
        width: W,
        height: H,
        stripHeight,
        async readStrip(y, h) {
          if (canvas.height !== h) canvas.height = h;
          // Shift up so only [y, y+h) lands on the canvas, not the whole page
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
 * Reads files sorted by name (numbers compared numerically). iPhone screenshot names
 * (IMG_4101, IMG_4102 …) follow capture order, which is scroll order.
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
