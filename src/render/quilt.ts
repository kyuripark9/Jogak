import type { Quilt } from '../quilt/build.ts';
import { QUILT_HEIGHT, QUILT_WIDTH } from '../quilt/build.ts';
import type { Pt } from '../layout/patchwork.ts';
import { WEAVES, weaveTile } from './fabric.ts';

/**
 * 정적인 조각보 그리기 (Canvas 2D).
 * 1. 한지 배접: 모시처럼 성긴 천은 실 사이로 이 바탕이 비친다.
 * 2. 조각마다 짠 천을 깔되, 결 방향을 조금씩 틀어 놓는다 (자투리는 결이 제각각이니까).
 * 3. 솔기: 접힌 시접의 그늘과 손바느질 홈질 땀. 손으로 이은 자리가 작품의 일부.
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

function hanji(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#ede4d1';
  ctx.fillRect(0, 0, w, h);
  // 닥 섬유: 가늘고 긴 옅은 선들
  ctx.lineWidth = Math.max(0.6, w / 1600);
  for (let i = 0; i < (w * h) / 900; i++) {
    const x = hash(i * 3 + 1) * w, y = hash(i * 3 + 2) * h, a = hash(i * 3 + 3) * Math.PI;
    const l = 6 + hash(i * 5) * 22;
    ctx.strokeStyle = `rgba(150, 128, 96, ${0.05 + hash(i * 7) * 0.07})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

function seamLine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, s: number, seed: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  // 시접이 겹쳐 도톰해진 자리의 그늘과 볕
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(48, 36, 24, 0.22)';
  ctx.lineWidth = 3.2 * s;
  ctx.beginPath(); ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(b[0] * s, b[1] * s); ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 250, 238, 0.16)';
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo((a[0] + nx * 1.6) * s, (a[1] + ny * 1.6) * s);
  ctx.lineTo((b[0] + nx * 1.6) * s, (b[1] + ny * 1.6) * s);
  ctx.stroke();
  // 홈질: 땀 길이와 간격, 줄이 손으로 뜬 것처럼 조금씩 어긋난다
  ctx.strokeStyle = 'rgba(238, 230, 212, 0.92)';
  ctx.lineWidth = 1.15 * s;
  let t = 3 + hash(seed) * 4;
  let k = 0;
  while (t < len - 3) {
    const st = 5 + hash(seed * 31 + k) * 2.4;
    const off = (hash(seed * 17 + k) - 0.5) * 1.1 + 2.6;
    const e = Math.min(len - 2, t + st);
    ctx.beginPath();
    ctx.moveTo((a[0] + ux * t + nx * off) * s, (a[1] + uy * t + ny * off) * s);
    ctx.lineTo((a[0] + ux * e + nx * (off + (hash(seed * 7 + k) - 0.5) * 0.6)) * s, (a[1] + uy * e + ny * (off + (hash(seed * 7 + k) - 0.5) * 0.6)) * s);
    ctx.stroke();
    t = e + 4 + hash(seed * 13 + k) * 2;
    k++;
  }
}

export function renderQuilt(canvas: HTMLCanvasElement, q: Quilt, pixelWidth: number) {
  const s = pixelWidth / QUILT_WIDTH;
  canvas.width = Math.round(QUILT_WIDTH * s);
  canvas.height = Math.round(QUILT_HEIGHT * s);
  const ctx = canvas.getContext('2d')!;
  hanji(ctx, canvas.width, canvas.height);

  for (const p of q.patchwork.pieces) {
    const pattern = ctx.createPattern(tileCanvas(q, p.index), 'repeat')!;
    // 실 굵기가 화면 크기와 상관없이 같은 천처럼 보이도록, 결 방향은 조각마다 다르게
    const grain = (hash(p.index * 97 + 5) < 0.5 ? 0 : 90) + (hash(p.index * 13) - 0.5) * 8;
    pattern.setTransform(new DOMMatrix().scaleSelf(s * 0.9).rotateSelf(grain));
    ctx.save();
    ctx.beginPath();
    p.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.closePath();
    ctx.fillStyle = pattern;
    ctx.fill();
    // 윤기: 명주처럼 매끈한 천은 결 방향을 따라 넓고 흐린 빛이 한 번 지나간다
    const sheen = WEAVES[q.memories[p.index].fabric.fabric].sheen;
    if (sheen > 0) {
      const xs = p.poly.map((v) => v[0] * s), ys = p.poly.map((v) => v[1] * s);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      const at = 0.3 + hash(p.index * 41) * 0.4;
      g.addColorStop(0, 'rgba(255,252,244,0)');
      g.addColorStop(at, `rgba(255,252,244,${sheen})`);
      g.addColorStop(1, 'rgba(255,252,244,0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  q.patchwork.seams.forEach((seam, i) => seamLine(ctx, seam.a, seam.b, s, i + 1));
  const W = QUILT_WIDTH, H = QUILT_HEIGHT;
  const edge: [Pt, Pt][] = [[[0, 0], [W, 0]], [[W, 0], [W, H]], [[W, H], [0, H]], [[0, H], [0, 0]]];
  edge.forEach(([a, b], i) => seamLine(ctx, a, b, s, 1000 + i));
}
