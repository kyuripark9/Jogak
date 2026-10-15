import type { Quilt } from '../quilt/build.ts';
import { QUILT_HEIGHT, QUILT_WIDTH } from '../quilt/build.ts';
import type { Pt } from '../layout/patchwork.ts';
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

/** 솔기 위 손바느질. 천과 같은 계열의 실로 작게 떠서, 가까이 봐야 보인다 */
function stitches(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, s: number, seed: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  ctx.lineCap = 'round';
  // 접힌 시접의 가장 짙은 자리 (가는 선)
  ctx.strokeStyle = 'rgba(110, 86, 84, 0.16)';
  ctx.lineWidth = 0.8 * s;
  ctx.beginPath(); ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(b[0] * s, b[1] * s); ctx.stroke();
  // 홈질: 땀 길이와 간격, 줄이 손으로 뜬 것처럼 조금씩 어긋난다
  ctx.strokeStyle = 'rgba(255, 252, 246, 0.55)';
  ctx.lineWidth = 0.75 * s;
  let t = 3 + hash(seed) * 4;
  let k = 0;
  while (t < len - 3) {
    const st = 3.2 + hash(seed * 31 + k) * 1.8;
    const off = (hash(seed * 17 + k) - 0.5) * 0.8 + 2.2;
    const e = Math.min(len - 2, t + st);
    const wob = (hash(seed * 7 + k) - 0.5) * 0.5;
    ctx.beginPath();
    ctx.moveTo((a[0] + ux * t + nx * off) * s, (a[1] + uy * t + ny * off) * s);
    ctx.lineTo((a[0] + ux * e + nx * (off + wob)) * s, (a[1] + uy * e + ny * (off + wob)) * s);
    ctx.stroke();
    t = e + 3 + hash(seed * 13 + k) * 1.6;
    k++;
  }
}

/** 시접 너비 (조각보 단위). 이만큼 이웃 조각과 겹친다 */
const SEAM_ALLOWANCE = 6;

export function renderQuilt(canvas: HTMLCanvasElement, q: Quilt, pixelWidth: number) {
  // 둘레에 여백을 둬서 조각보 너머의 빛과 가장자리 단(시접이 겹친 테두리)이 보이게
  const M = 44;
  const s = pixelWidth / (QUILT_WIDTH + M * 2);
  canvas.width = Math.round((QUILT_WIDTH + M * 2) * s);
  canvas.height = Math.round((QUILT_HEIGHT + M * 2) * s);
  const ctx = canvas.getContext('2d')!;
  backdrop(ctx, canvas.width, canvas.height);
  ctx.translate(M * s, M * s);

  for (const p of q.patchwork.pieces) {
    const pattern = ctx.createPattern(tileCanvas(q, p.index), 'repeat')!;
    // 실 굵기가 화면 크기와 상관없이 같은 천처럼 보이도록, 결 방향은 조각마다 다르게
    const grain = (hash(p.index * 97 + 5) < 0.5 ? 0 : 90) + (hash(p.index * 13) - 0.5) * 8;
    pattern.setTransform(new DOMMatrix().scaleSelf(s * 0.9).rotateSelf(grain));
    ctx.save();
    ctx.beginPath();
    p.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.closePath();
    const weave = WEAVES[q.memories[p.index].fabric.fabric];
    ctx.globalAlpha = weave.opacity;
    ctx.fillStyle = pattern;
    ctx.fill();
    // 시접: 가장자리를 같은 천으로 한 번 더 덮어 안팎으로 겹치게 한다
    ctx.strokeStyle = pattern;
    ctx.lineWidth = SEAM_ALLOWANCE * s;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = weave.opacity * 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 윤기: 명주처럼 매끈한 천은 결 방향을 따라 넓고 흐린 빛이 한 번 지나간다
    const sheen = weave.sheen;
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

  q.patchwork.seams.forEach((seam, i) => stitches(ctx, seam.a, seam.b, s, i + 1));

  // 뒤에서 비치는 빛: 창 쪽 조각일수록 빛을 머금어 환해진다
  ctx.globalCompositeOperation = 'screen';
  const W = QUILT_WIDTH * s, H = QUILT_HEIGHT * s;
  const glow = ctx.createRadialGradient(W * 0.25, H * 0.15, 0, W * 0.25, H * 0.15, Math.hypot(W, H) * 0.8);
  glow.addColorStop(0, 'rgba(255, 248, 236, 0.32)');
  glow.addColorStop(1, 'rgba(255, 248, 236, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}
