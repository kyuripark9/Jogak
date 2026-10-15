import type { Quilt } from '../quilt/build.ts';
import { QUILT_HEIGHT, QUILT_WIDTH } from '../quilt/build.ts';
import type { Pt } from '../layout/patchwork.ts';
import { Sewing, seamLength, type SeamState, type Transform } from '../interaction/sewing.ts';
import { WEAVES, weaveTile } from './fabric.ts';

/**
 * 정적인 조각보 그리기 (Canvas 2D). 창에 건 얇은 보자기처럼.
 * 1. 뒤에서 드는 빛: 아주 옅은 바탕에 한쪽에서 빛이 번진다. 얇은 천은 이 빛을 머금는다.
 * 2. 조각마다 짠 천을 반투명하게 깔고, 결 방향을 조금씩 틀어 놓는다 (자투리는 결이 제각각이니까).
 * 3. 시접: 조각이 이웃과 조금씩 겹쳐서 솔기 자리만 천이 두 겹, 세 겹이 되어 색이 짙어진다.
 *    실제 비치는 조각보에서 솔기가 선처럼 보이는 이유 그대로. 손으로 이은 자리가 작품의 일부.
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
  // 창에서 드는 빛: 왼쪽 위가 환하고 오른쪽 아래로 갈수록 살짝 가라앉는다
  const g = ctx.createRadialGradient(w * 0.22, h * 0.12, 0, w * 0.22, h * 0.12, Math.hypot(w, h) * 0.95);
  g.addColorStop(0, 'rgba(255, 253, 247, 0.95)');
  g.addColorStop(0.55, 'rgba(250, 244, 234, 0.4)');
  g.addColorStop(1, 'rgba(214, 204, 190, 0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 한지 섬유: 아주 옅게
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

/** 조각보 위에 그릴 바느질 상태. 없으면 다 꿰맨 모습 */
export interface QuiltView {
  sewing: Sewing;
  /** 조각별 지금 놓인 자리 (애니메이션 중간값) */
  transforms: Transform[];
  /** 원본이 비쳐 보이는 조각과 그 정도 (0~1) */
  reveal: { index: number; alpha: number } | null;
  /**
   * 'wall': 벽에 건 조각보 (천이 빛을 받아 반사)
   * 'light': 창에 건 조각보 (빛이 뒤에서 천을 지나온다. 겹친 시접은 더 짙어진다)
   */
  mode?: 'wall' | 'light';
  /** 빛 모드에서 빛이 드는 자리 (조각보 단위) */
  light?: Pt;
}

/** 시접 너비 (조각보 단위). 이만큼 이웃 조각과 겹친다 */
const SEAM_ALLOWANCE = 6;
/** 둘레 여백 */
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

/** 꿰맨 땀들. 솔기 a→b 방향 기준으로 s(거리), off(옆으로 떨어진 정도) */
function drawSeam(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, st: SeamState, s: number, light = false) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, nx = -uy, ny = ux;
  ctx.lineCap = 'round';
  if (st.sewn) {
    // 접힌 시접의 가장 짙은 자리
    ctx.strokeStyle = 'rgba(110, 86, 84, 0.16)';
    ctx.lineWidth = 0.8 * s;
    ctx.beginPath(); ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(b[0] * s, b[1] * s); ctx.stroke();
  }
  // 빛이 뒤에서 오면 실은 그림자처럼 어둡게 보인다
  ctx.strokeStyle = light ? 'rgba(96, 78, 70, 0.45)' : 'rgba(255, 252, 246, 0.6)';
  ctx.lineWidth = 0.75 * s;
  ctx.beginPath();
  for (const t of st.stitches) {
    ctx.moveTo((a[0] + ux * t.s0 + nx * t.off0) * s, (a[1] + uy * t.s0 + ny * t.off0) * s);
    ctx.lineTo((a[0] + ux * t.s1 + nx * t.off1) * s, (a[1] + uy * t.s1 + ny * t.off1) * s);
  }
  ctx.stroke();
}

/** 시침질: 꿰맬 수 있는 솔기에 임시로 뜬 성긴 붉은 실. "여기를 이으세요" */
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
 * 창. 빛이 드는 자리가 가장 밝고, 창살 그림자가 천 너머로 흐리게 비친다.
 * 조각보는 이 빛을 거르는 필터가 된다.
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
  // 창살: 넓고 흐린 줄 여러 겹으로 번지게
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

/** 다 꿰맨 상태 (정적 그림, 내보내기용) */
export function finishedView(q: Quilt): QuiltView {
  const sewing = new Sewing(q.patchwork);
  // 작은 솔기부터 차례로
  const order = q.patchwork.seams.map((_, i) => i).sort((x, y) => q.patchwork.seams[y].depth - q.patchwork.seams[x].depth);
  for (const i of order) sewing.sew(i, 0, seamLength(q.patchwork.seams[i]), 0.2);
  return { sewing, transforms: q.patchwork.pieces.map(() => IDENTITY), reveal: null };
}

/** 캔버스 픽셀 → 조각보 단위 배율 */
export function quiltScale(pixelWidth: number) {
  return pixelWidth / (QUILT_WIDTH + QUILT_MARGIN * 2);
}

export function renderQuilt(canvas: HTMLCanvasElement, q: Quilt, pixelWidth: number, view: QuiltView = finishedView(q)) {
  // 둘레에 여백을 둬서 조각보 너머의 빛과 가장자리 단(시접이 겹친 테두리)이 보이게
  const M = QUILT_MARGIN;
  const s = quiltScale(pixelWidth);
  const cw = Math.round((QUILT_WIDTH + M * 2) * s), ch = Math.round((QUILT_HEIGHT + M * 2) * s);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext('2d')!;
  const light = view.mode === 'light';
  const L: Pt = view.light ?? [QUILT_WIDTH * 0.3, QUILT_HEIGHT * 0.2];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (light) windowLight(ctx, cw, ch, (L[0] + M) * s, (L[1] + M) * s);
  else ctx.drawImage(cachedBackdrop(cw, ch), 0, 0);
  ctx.translate(M * s, M * s);
  const base = ctx.getTransform();
  // 빛 모드: 천이 빛을 곱해서 거른다. 두 겹이 되는 시접은 저절로 더 짙어진다
  const blend: GlobalCompositeOperation = light ? 'multiply' : 'source-over';

  for (const p of q.patchwork.pieces) {
    const pattern = ctx.createPattern(tileCanvas(q, p.index), 'repeat')!;
    // 실 굵기가 화면 크기와 상관없이 같은 천처럼 보이도록, 결 방향은 조각마다 다르게
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
      // 원본이 천 너머로 비친다: 사진을 먼저 깔고 천을 얇게 덮는다
      ctx.save();
      ctx.clip();
      const xs = p.poly.map((v) => v[0] * s), ys = p.poly.map((v) => v[1] * s);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
      const img = thumbCanvas(q, p.index);
      const k = Math.max(w / img.width, h / img.height);
      ctx.globalAlpha = reveal * 0.8;
      ctx.drawImage(img, x0 + (w - img.width * k) / 2, y0 + (h - img.height * k) / 2, img.width * k, img.height * k);
      ctx.restore();
    }
    ctx.globalCompositeOperation = blend;
    ctx.globalAlpha = (light ? Math.min(1, weave.opacity + 0.25) : weave.opacity) * (1 - 0.4 * reveal);
    ctx.fillStyle = pattern;
    ctx.fill();
    // 시접: 가장자리를 같은 천으로 한 번 더 덮어 안팎으로 겹치게 한다
    ctx.strokeStyle = pattern;
    ctx.lineWidth = SEAM_ALLOWANCE * s;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = weave.opacity * (light ? 0.85 : 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // 윤기: 명주처럼 매끈한 천은 결 방향을 따라 넓고 흐린 빛이 한 번 지나간다 (반사광이라 빛 모드엔 없음)
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

  q.patchwork.seams.forEach((seam, i) => {
    const st = view.sewing.seams[i];
    const sewable = view.sewing.isSewable(i);
    ctx.setTransform(base);
    if (sewable) drawBasting(ctx, seam.a, seam.b, s, view.sewing.coverage(i));
    if (st.stitches.length) {
      // 꿰맨 솔기는 그 덩어리와 함께 움직이고, 꿰매는 중인 솔기는 제자리
      if (st.sewn) withTransform(ctx, view.transforms[seam.from] ?? IDENTITY, s);
      drawSeam(ctx, seam.a, seam.b, st, s, light);
    }
  });
  ctx.setTransform(base);

  // 뒤에서 비치는 빛: 빛 가까운 조각일수록 빛을 머금어 환해진다
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
