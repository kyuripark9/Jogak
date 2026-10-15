/** sRGB ↔ CIELAB (D65). 색 거리를 사람 눈에 가깝게 재기 위해 Lab에서 계산한다. */
export type Lab = [number, number, number];
export type RGB = [number, number, number];

const toLinear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
const fi = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function rgbToLab([r8, g8, b8]: RGB): Lab {
  const r = toLinear(r8), g = toLinear(g8), b = toLinear(b8);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([L, a, bb]: Lab): RGB {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
  const x = fi(fx) * 0.95047, y = fi(fy), z = fi(fz) * 1.08883;
  return [
    fromLinear(3.2406 * x - 1.5372 * y - 0.4986 * z),
    fromLinear(-0.9689 * x + 1.8758 * y + 0.0415 * z),
    fromLinear(0.0557 * x - 0.204 * y + 1.057 * z),
  ];
}

export const deltaE = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
export const chroma = (p: Lab) => Math.hypot(p[1], p[2]);
