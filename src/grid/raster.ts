/**
 * DOM 없이 다루는 RGBA 픽셀 버퍼. ImageData와 같은 모양이라 브라우저에서는
 * ImageData를 그대로, Node 테스트에서는 합성 버퍼를 그대로 넘길 수 있다.
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
 * 띠 단위로 읽을 수 있는 원본. 긴 스크롤 캡처나 PDF 페이지를
 * 한 번에 캔버스에 올리지 않고 [y, y+h) 구간만 꺼내 보기 위한 약속.
 */
export interface StripReader {
  width: number;
  height: number;
  /** 한 번에 읽을 띠의 최대 높이 (모바일 사파리 캔버스 면적 한계에서 계산) */
  stripHeight: number;
  readStrip(y: number, h: number): Promise<Raster>;
}

/** 메모리 위 Raster를 StripReader로 감싼다 (테스트, 합성 캡처용). */
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

/** 상자 필터 축소. 조각은 색과 느낌만 남기면 되므로 작은 크기로 충분하다. */
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
