/**
 * DOM-free RGBA pixel buffer. Same shape as ImageData, so the browser can pass
 * ImageData as-is and Node tests can pass synthetic buffers as-is.
 */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RGB = [number, number, number];

export function createRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/**
 * A source readable strip by strip: the contract for pulling out just [y, y+h)
 * of a long scroll capture or PDF page instead of putting it all on one canvas.
 */
export interface StripReader {
  width: number;
  height: number;
  /** Max strip height per read (derived from mobile Safari's canvas area limit) */
  stripHeight: number;
  readStrip(y: number, h: number): Promise<Raster>;
}

/** Wraps an in-memory Raster as a StripReader (for tests and synthetic captures). */
export function rasterReader(r: Raster, stripHeight = r.height): StripReader {
  return {
    width: r.width,
    height: r.height,
    stripHeight,
    async readStrip(y, h) {
      return cropRaster(r, 0, y, r.width, h);
    },
  };
}

export function cropRaster(r: Raster, x: number, y: number, w: number, h: number): Raster {
  const out = createRaster(w, h);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * r.width + x) * 4;
    out.data.set(r.data.subarray(src, src + w * 4), row * w * 4);
  }
  return out;
}

/** Box-filter downscale. Pieces only need color and feel, so a small size is enough. */
export function downscale(r: Raster, maxWidth: number): Raster {
  if (r.width <= maxWidth) return r;
  const s = r.width / maxWidth;
  const w = maxWidth;
  const h = Math.max(1, Math.round(r.height / s));
  const out = createRaster(w, h);
  for (let oy = 0; oy < h; oy++) {
    const y0 = Math.floor(oy * s);
    const y1 = Math.min(r.height, Math.max(y0 + 1, Math.floor((oy + 1) * s)));
    for (let ox = 0; ox < w; ox++) {
      const x0 = Math.floor(ox * s);
      const x1 = Math.min(r.width, Math.max(x0 + 1, Math.floor((ox + 1) * s)));
      let cr = 0, cg = 0, cb = 0, ca = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * r.width + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          cr += r.data[i]; cg += r.data[i + 1]; cb += r.data[i + 2]; ca += r.data[i + 3]; n++;
        }
      }
      const o = (oy * w + ox) * 4;
      out.data[o] = cr / n; out.data[o + 1] = cg / n; out.data[o + 2] = cb / n; out.data[o + 3] = ca / n;
    }
  }
  return out;
}
