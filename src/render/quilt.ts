import type { Quilt } from '../quilt/build.ts';
import { QUILT_HEIGHT, QUILT_WIDTH } from '../quilt/build.ts';
import type { Pt } from '../layout/patchwork.ts';
import { Sewing, seamLength, type SeamState, type Transform } from '../interaction/sewing.ts';
import { WEAVES, weaveTile } from './fabric.ts';

/**
 * Static jogakbo rendering (Canvas 2D), like a thin bojagi (wrapping cloth) hung in a window.
 * 1. Backlight: light spreads from one side over a very pale ground. Thin cloth holds this light.
 * 2. Each piece's woven cloth is laid semi-transparent, its grain slightly turned (scraps never share a grain).
 * 3. Seam allowance: pieces overlap their neighbors a little, so cloth doubles or triples only at seams and darkens.
 *    Exactly why seams read as lines in a real translucent jogakbo. The hand-joined lines are part of the work.
 */

function hash(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const tileCache = new WeakMap<object, HTMLCanvasElement>();

function tileCanvas(q: Quilt, i: number) {
  const m = q.memories[i];
  let c = tileCache.get(m);
  if (!c) {
    const t = weaveTile(m.fabric);
    c = document.createElement('canvas');
    c.width = t.width;
    c.height = t.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(t.data), t.width, t.height), 0, 0);
    tileCache.set(m, c);
  }
  return c;
}

function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f4efe6';
  ctx.fillRect(0, 0, w, h);
  // Window light: bright at top left, settling slightly toward bottom right
  const g = ctx.createRadialGradient(w * 0.22, h * 0.12, 0, w * 0.22, h * 0.12, Math.hypot(w, h) * 0.95);
  g.addColorStop(0, 'rgba(255, 253, 247, 0.95)');
  g.addColorStop(0.55, 'rgba(250, 244, 234, 0.4)');
  g.addColorStop(1, 'rgba(214, 204, 190, 0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Hanji fibers, very faint
  ctx.lineWidth = Math.max(0.5, w / 2000);
  for (let i = 0; i < (w * h) / 1400; i++) {
    const x = hash(i * 3 + 1) * w, y = hash(i * 3 + 2) * h, a = hash(i * 3 + 3) * Math.PI;
    const l = 6 + hash(i * 5) * 22;
    ctx.strokeStyle = `rgba(170, 150, 120, ${0.03 + hash(i * 7) * 0.04})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

/** Sewing state to draw on the jogakbo. Omitted means fully sewn */
export interface QuiltView {
  sewing: Sewing;
  /** Where each piece sits right now (mid-animation values) */
  transforms: Transform[];
  /** The piece showing its original photo, and how much (0–1) */
  reveal: { index: number; alpha: number } | null;
  /**
   * 'wall': jogakbo hung on a wall (the cloth reflects light)
   * 'light': jogakbo hung in a window (light passes through from behind; overlapping seam allowances darken)
   */
  mode?: 'wall' | 'light';
  /** Where the light falls in light mode (quilt units) */
  light?: Pt;
}

/** Seam allowance width (quilt units): how far a piece overlaps its neighbors */
const SEAM_ALLOWANCE = 6;
/** Outer margin */
export const QUILT_MARGIN = 44;

const IDENTITY: Transform = { dx: 0, dy: 0, rot: 0, cx: 0, cy: 0 };

function withTransform(ctx: CanvasRenderingContext2D, t: Transform, s: number) {
  ctx.translate((t.cx + t.dx) * s, (t.cy + t.dy) * s);
  ctx.rotate(t.rot);
  ctx.translate(-t.cx * s, -t.cy * s);
}

const thumbCache = new WeakMap<object, HTMLCanvasElement>();
function thumbCanvas(q: Quilt, i: number) {
  const m = q.memories[i];
  let c = thumbCache.get(m);
  if (!c) {
    c = document.createElement('canvas');
    c.width = m.thumb.width;
    c.height = m.thumb.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(m.thumb.data), c.width, c.height), 0, 0);
    thumbCache.set(m, c);
  }
  return c;
}

/** Sewn stitches, relative to seam direction a→b: s (distance along), off (sideways offset) */
function drawSeam(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, st: SeamState, s: number, light = false) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, nx = -uy, ny = ux;
  ctx.lineCap = 'round';
  if (st.sewn) {
    // The darkest line of the folded seam allowance
    ctx.strokeStyle = 'rgba(110, 86, 84, 0.16)';
    ctx.lineWidth = 0.8 * s;
    ctx.beginPath(); ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(b[0] * s, b[1] * s); ctx.stroke();
  }
  // Backlit, thread reads dark like a shadow
  ctx.strokeStyle = light ? 'rgba(96, 78, 70, 0.45)' : 'rgba(255, 252, 246, 0.6)';
  ctx.lineWidth = 0.75 * s;
  ctx.beginPath();
  for (const t of st.stitches) {
    ctx.moveTo((a[0] + ux * t.s0 + nx * t.off0) * s, (a[1] + uy * t.s0 + ny * t.off0) * s);
    ctx.lineTo((a[0] + ux * t.s1 + nx * t.off1) * s, (a[1] + uy * t.s1 + ny * t.off1) * s);
  }
  ctx.stroke();
}

/** Basting: loose temporary red thread on a sewable seam. "Join here" */
function drawBasting(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, s: number, progress: number) {
  ctx.save();
  ctx.strokeStyle = `rgba(178, 74, 62, ${0.78 - progress * 0.45})`;
  ctx.lineWidth = Math.max(1.7 * s, 2);
  ctx.setLineDash([11 * s, 9 * s]);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(b[0] * s, b[1] * s); ctx.stroke();
  ctx.restore();
}

/**
 * The window. Brightest where the light falls, with the lattice shadow showing faintly through the cloth.
 * The jogakbo becomes a filter for this light.
 */
function windowLight(ctx: CanvasRenderingContext2D, w: number, h: number, lx: number, ly: number) {
  ctx.fillStyle = '#efe9df';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.hypot(w, h) * 0.75);
  g.addColorStop(0, 'rgba(255, 255, 252, 1)');
  g.addColorStop(0.45, 'rgba(255, 252, 244, 0.9)');
  g.addColorStop(1, 'rgba(236, 228, 214, 0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Lattice: several wide, faint layered lines so it blurs
  for (let k = 0; k < 4; k++) {
    ctx.strokeStyle = `rgba(150, 136, 118, ${0.035})`;
    ctx.lineWidth = w * (0.012 + k * 0.012);
    ctx.beginPath();
    ctx.moveTo(w * 0.64, 0); ctx.lineTo(w * 0.64, h);
    ctx.moveTo(0, h * 0.4); ctx.lineTo(w, h * 0.4);
    ctx.stroke();
  }
}

const backdropCache = new Map<string, HTMLCanvasElement>();
function cachedBackdrop(w: number, h: number) {
  const key = `${w}x${h}`;
  let c = backdropCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    backdrop(c.getContext('2d')!, w, h);
    backdropCache.clear();
    backdropCache.set(key, c);
  }
  return c;
}

/** Fully sewn state (static image, for export) */
export function finishedView(q: Quilt): QuiltView {
  const sewing = new Sewing(q.patchwork);
  // Smallest seams first
  const order = q.patchwork.seams.map((_, i) => i).sort((x, y) => q.patchwork.seams[y].depth - q.patchwork.seams[x].depth);
  for (const i of order) sewing.sew(i, 0, seamLength(q.patchwork.seams[i]), 0.2);
  return { sewing, transforms: q.patchwork.pieces.map(() => IDENTITY), reveal: null };
}

/** Canvas pixels per quilt unit */
export function quiltScale(pixelWidth: number) {
  return pixelWidth / (QUILT_WIDTH + QUILT_MARGIN * 2);
}

interface Frame {
  q: Quilt;
  view: QuiltView;
  s: number;
  light: boolean;
  L: Pt;
}

/** The pieces. ctx must be aligned to the jogakbo origin (inside the margin) */
function drawPieces(ctx: CanvasRenderingContext2D, { q, view, s, light }: Frame) {
  // Light mode: cloth filters light by multiplying, so doubled seam allowances darken on their own
  const blend: GlobalCompositeOperation = light ? 'multiply' : 'source-over';
  for (const p of q.patchwork.pieces) {
    const pattern = ctx.createPattern(tileCanvas(q, p.index), 'repeat')!;
    // Thread scale tracks the quilt so it reads as the same cloth at any screen size; grain direction varies per piece
    const grain = (hash(p.index * 97 + 5) < 0.5 ? 0 : 90) + (hash(p.index * 13) - 0.5) * 8;
    pattern.setTransform(new DOMMatrix().scaleSelf(s * 0.9).rotateSelf(grain));
    ctx.save();
    withTransform(ctx, view.transforms[p.index] ?? IDENTITY, s);
    ctx.beginPath();
    p.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.closePath();
    const weave = WEAVES[q.memories[p.index].fabric.fabric];
    const reveal = view.reveal?.index === p.index ? view.reveal.alpha : 0;
    if (reveal > 0) {
      // The original shows through the cloth: lay the photo first, then a thin layer of cloth over it.
      // In the window, the photo also filters light like slide film (multiply)
      ctx.save();
      ctx.clip();
      const xs = p.poly.map((v) => v[0] * s), ys = p.poly.map((v) => v[1] * s);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
      const img = thumbCanvas(q, p.index);
      const k = Math.max(w / img.width, h / img.height);
      ctx.globalCompositeOperation = blend;
      ctx.globalAlpha = reveal * 0.8;
      ctx.drawImage(img, x0 + (w - img.width * k) / 2, y0 + (h - img.height * k) / 2, img.width * k, img.height * k);
      ctx.restore();
    }
    ctx.globalCompositeOperation = blend;
    ctx.globalAlpha = (light ? Math.min(1, weave.opacity + 0.25) : weave.opacity) * (1 - 0.4 * reveal);
    ctx.fillStyle = pattern;
    ctx.fill();
    // Seam allowance: cover the edge once more with the same cloth so it overlaps inside and out
    ctx.strokeStyle = pattern;
    ctx.lineWidth = SEAM_ALLOWANCE * s;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = weave.opacity * (light ? 0.85 : 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Sheen: smooth cloth like myeongju gets one wide, soft band of light along the grain (reflected light, so none in light mode)
    if (weave.sheen > 0 && !light) {
      const xs = p.poly.map((v) => v[0] * s), ys = p.poly.map((v) => v[1] * s);
      const g = ctx.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      const at = 0.3 + hash(p.index * 41) * 0.4;
      g.addColorStop(0, 'rgba(255,252,244,0)');
      g.addColorStop(at, `rgba(255,252,244,${weave.sheen})`);
      g.addColorStop(1, 'rgba(255,252,244,0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Basting thread and stitches */
function drawThreads(ctx: CanvasRenderingContext2D, { q, view, s, light }: Frame) {
  const base = ctx.getTransform();
  q.patchwork.seams.forEach((seam, i) => {
    const st = view.sewing.seams[i];
    ctx.setTransform(base);
    if (view.sewing.isSewable(i)) drawBasting(ctx, seam.a, seam.b, s, view.sewing.coverage(i));
    if (st.stitches.length) {
      // Sewn seams move with their cluster; seams being sewn stay put
      if (st.sewn) withTransform(ctx, view.transforms[seam.from] ?? IDENTITY, s);
      drawSeam(ctx, seam.a, seam.b, st, s, light);
    }
  });
  ctx.setTransform(base);
}

/** Backlight glow: pieces nearer the light hold more of it and brighten */
function drawGlow(ctx: CanvasRenderingContext2D, { s, light, L }: Frame) {
  const M = QUILT_MARGIN;
  ctx.globalCompositeOperation = 'screen';
  const W = QUILT_WIDTH * s, H = QUILT_HEIGHT * s;
  const gx = light ? L[0] * s : W * 0.25, gy = light ? L[1] * s : H * 0.15;
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.hypot(W, H) * (light ? 0.55 : 0.8));
  glow.addColorStop(0, `rgba(255, 248, 236, ${light ? 0.42 : 0.32})`);
  glow.addColorStop(1, 'rgba(255, 248, 236, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-M * s, -M * s, W + 2 * M * s, H + 2 * M * s);
  ctx.globalCompositeOperation = 'source-over';
}

/** Light-mode layer cache: when only the light moves, cloth and thread aren't rewoven */
interface Layers {
  key: string;
  /** How much light the cloth lets through (cloth multiplied onto white) */
  cloth: HTMLCanvasElement;
  /** Thread (transparent background) */
  thread: HTMLCanvasElement;
}
const layerCache = new WeakMap<HTMLCanvasElement, Layers>();

function layerKey(view: QuiltView, cw: number) {
  let stitches = 0;
  for (const st of view.sewing.seams) stitches += st.stitches.length * 2 + (st.sewn ? 1 : 0);
  const r = view.reveal ? `${view.reveal.index}:${view.reveal.alpha.toFixed(3)}` : '-';
  const t = view.transforms.map((x) => `${x.dx.toFixed(2)},${x.dy.toFixed(2)},${x.rot.toFixed(4)}`).join(';');
  return `${cw}|${stitches}|${r}|${t}`;
}

function layer(c: HTMLCanvasElement | undefined, w: number, h: number) {
  c ??= document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { c, ctx };
}

export interface RenderOptions {
  /**
   * In light mode, render cloth and thread into separate layers. Light passes through cloth by multiplication (light × cloth),
   * so when only the light moves, multiplying one pre-rendered cloth layer gives the identical image.
   * Screen only: on large canvases like export it doubles memory, so it's off.
   */
  layers?: boolean;
}

export function renderQuilt(
  canvas: HTMLCanvasElement,
  q: Quilt,
  pixelWidth: number,
  view: QuiltView = finishedView(q),
  opts: RenderOptions = {},
) {
  // Leave a margin so the light beyond the jogakbo and its edge hem (where seam allowances overlap) stay visible
  const M = QUILT_MARGIN;
  const s = quiltScale(pixelWidth);
  const cw = Math.round((QUILT_WIDTH + M * 2) * s), ch = Math.round((QUILT_HEIGHT + M * 2) * s);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext('2d')!;
  const light = view.mode === 'light';
  const f: Frame = { q, view, s, light, L: view.light ?? [QUILT_WIDTH * 0.3, QUILT_HEIGHT * 0.2] };
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (light && opts.layers) {
    const key = layerKey(view, cw);
    let lay = layerCache.get(canvas);
    if (!lay || lay.key !== key) {
      const cloth = layer(lay?.cloth, cw, ch);
      cloth.ctx.fillStyle = '#fff';
      cloth.ctx.fillRect(0, 0, cw, ch);
      cloth.ctx.translate(M * s, M * s);
      drawPieces(cloth.ctx, f);
      const thread = layer(lay?.thread, cw, ch);
      thread.ctx.clearRect(0, 0, cw, ch);
      thread.ctx.translate(M * s, M * s);
      drawThreads(thread.ctx, f);
      lay = { key, cloth: cloth.c, thread: thread.c };
      layerCache.set(canvas, lay);
    }
    windowLight(ctx, cw, ch, (f.L[0] + M) * s, (f.L[1] + M) * s);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lay.cloth, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lay.thread, 0, 0);
    ctx.translate(M * s, M * s);
    drawGlow(ctx, f);
    return;
  }

  if (light) windowLight(ctx, cw, ch, (f.L[0] + M) * s, (f.L[1] + M) * s);
  else ctx.drawImage(cachedBackdrop(cw, ch), 0, 0);
  ctx.translate(M * s, M * s);
  drawPieces(ctx, f);
  drawThreads(ctx, f);
  drawGlow(ctx, f);
}
