import type { Quilt } from '../quilt/build.ts';
import type { Pt } from '../layout/patchwork.ts';
import { renderQuilt, quiltScale, QUILT_MARGIN, type QuiltView } from '../render/quilt.ts';
import { Sewing, applyTransform, centroid, invertTransform, pointInPoly, project, type Transform } from './sewing.ts';

/**
 * 조각보 캔버스와 손의 만남.
 * - 꿰맬 수 있는 솔기(붉은 시침실) 위에서 누르고 솔기를 따라 그으면 땀이 생긴다.
 * - 솔기를 다 꿰매면 흐트러져 있던 두 덩어리가 제자리로 당겨져 붙는다.
 * - 마우스를 올리거나(데스크톱) 길게 누르면(모바일) 그 조각 너머로 원본 사진이 비친다.
 */

const SEW_TOLERANCE_CSS = 22;
const LONG_PRESS_MS = 420;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

export interface StageEvents {
  onSewn?: (seam: number, sewing: Sewing) => void;
  onChange?: (sewing: Sewing) => void;
}

export class QuiltStage {
  readonly sewing: Sewing;
  private current: Transform[];
  private reveal: { index: number; alpha: number; target: number } | null = null;
  private raf = 0;
  private sewingSeam: { seam: number; lastS: number; lastT: number } | null = null;
  private press: { x: number; y: number; timer: number } | null = null;
  private canvas: HTMLCanvasElement;
  private q: Quilt;
  private pixelWidth: number;
  private events: StageEvents;
  mode: 'wall' | 'light' = 'wall';
  private light: Pt = [300, 250];
  private lightTarget: Pt = [300, 250];

  constructor(canvas: HTMLCanvasElement, q: Quilt, pixelWidth: number, events: StageEvents = {}, sewing?: Sewing) {
    this.canvas = canvas;
    this.q = q;
    this.pixelWidth = pixelWidth;
    this.events = events;
    this.sewing = sewing ?? new Sewing(q.patchwork);
    this.current = q.patchwork.pieces.map((p) => this.target(p.index));
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    canvas.addEventListener('pointerleave', this.leave);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.draw();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.up);
    this.canvas.removeEventListener('pointerleave', this.leave);
  }

  /**
   * 조각 i가 가야 할 자리. 덩어리 기준 회전을 조각 자기 중심 기준으로 바꿔 두면
   * 덩어리가 합쳐져 회전 중심이 바뀌어도 조각이 튀지 않고 부드럽게 옮겨 간다.
   */
  private target(i: number): Transform {
    const t = this.sewing.transformOf(i);
    const c = centroid(this.q.patchwork.pieces[i].poly);
    const moved = applyTransform(t, c);
    return { dx: moved[0] - c[0], dy: moved[1] - c[1], rot: t.rot, cx: c[0], cy: c[1] };
  }

  /**
   * 빛 모드: 조각보를 창에 건다. 손(포인터)을 따라 빛이 드는 자리가 옮겨 가서,
   * 천을 들고 빛에 이리저리 비춰 보는 것처럼 겹친 솔기와 실이 드러난다.
   */
  setMode(mode: 'wall' | 'light') {
    this.mode = mode;
    this.schedule();
  }

  /** 화면 좌표 → 조각보 단위 */
  toQuilt(clientX: number, clientY: number): Pt {
    const r = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / r.width / quiltScale(this.pixelWidth);
    return [(clientX - r.left) * k - QUILT_MARGIN, (clientY - r.top) * k - QUILT_MARGIN];
  }

  /** 조각보 단위 → 화면 좌표 (테스트용) */
  toClient([x, y]: Pt): Pt {
    const r = this.canvas.getBoundingClientRect();
    const k = r.width / this.canvas.width * quiltScale(this.pixelWidth);
    return [r.left + (x + QUILT_MARGIN) * k, r.top + (y + QUILT_MARGIN) * k];
  }

  private tolerance() {
    const r = this.canvas.getBoundingClientRect();
    return (SEW_TOLERANCE_CSS * this.canvas.width) / r.width / quiltScale(this.pixelWidth);
  }

  pieceAt(p: Pt): number | null {
    const pieces = this.q.patchwork.pieces;
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (pointInPoly(invertTransform(this.current[i], p), pieces[i].poly)) return i;
    }
    return null;
  }

  private setReveal(index: number | null) {
    if (index == null) {
      if (!this.reveal || this.reveal.target === 0) return;
      this.reveal.target = 0;
    } else if (!this.reveal || this.reveal.index !== index) {
      this.reveal = { index, alpha: 0, target: 1 };
    } else if (this.reveal.target !== 1) {
      this.reveal.target = 1;
    } else {
      return;
    }
    this.schedule();
  }

  get revealed() {
    return this.reveal && this.reveal.target > 0 ? this.reveal.index : null;
  }

  private down = (e: PointerEvent) => {
    const p = this.toQuilt(e.clientX, e.clientY);
    const near = this.sewing.nearestSewable(p, this.tolerance());
    if (near) {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.sewingSeam = { seam: near.seam, lastS: near.s, lastT: e.timeStamp };
      this.setReveal(null);
      return;
    }
    if (e.pointerType !== 'mouse') {
      const timer = window.setTimeout(() => this.setReveal(this.pieceAt(p)), LONG_PRESS_MS);
      this.press = { x: e.clientX, y: e.clientY, timer };
    }
  };

  private move = (e: PointerEvent) => {
    const p = this.toQuilt(e.clientX, e.clientY);
    if (this.mode === 'light') {
      this.lightTarget = p;
      this.schedule();
    }
    if (this.sewingSeam) {
      const sw = this.sewingSeam;
      const seam = this.q.patchwork.seams[sw.seam];
      const pr = project(seam, p);
      if (pr.dist > this.tolerance() * 1.8) {
        // 실이 솔기에서 벗어나면 땀이 끊긴다. 돌아오면 그 자리부터 다시
        sw.lastS = NaN;
        return;
      }
      if (Number.isNaN(sw.lastS)) {
        sw.lastS = pr.s;
        sw.lastT = e.timeStamp;
        return;
      }
      const dt = Math.max(1, e.timeStamp - sw.lastT);
      const speed = Math.abs(pr.s - sw.lastS) / dt;
      const done = this.sewing.sew(sw.seam, sw.lastS, pr.s, speed);
      sw.lastS = pr.s;
      sw.lastT = e.timeStamp;
      if (done) {
        this.sewingSeam = null;
        navigator.vibrate?.(12);
        this.events.onSewn?.(sw.seam, this.sewing);
      }
      this.events.onChange?.(this.sewing);
      this.schedule();
      return;
    }
    if (this.press) {
      if (Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 10) {
        clearTimeout(this.press.timer);
        this.press = null;
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const near = this.sewing.nearestSewable(p, this.tolerance());
      this.canvas.style.cursor = near ? 'crosshair' : 'default';
      this.setReveal(near ? null : this.pieceAt(p));
    }
  };

  private up = () => {
    this.sewingSeam = null;
    if (this.press) {
      clearTimeout(this.press.timer);
      this.press = null;
      this.setReveal(null);
    }
  };

  private leave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && !this.sewingSeam) this.setReveal(null);
  };

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = () => {
    this.raf = 0;
    let moving = false;
    // 움직임 줄이기를 켠 사람에게는 미끄러지는 대신 한 번에 자리를 잡는다 (뜻은 같고 움직임만 뺀다)
    const ease = (k: number) => (REDUCED_MOTION.matches ? 1 : k);
    // 덩어리가 제자리로 당겨진다
    this.q.patchwork.pieces.forEach((p, i) => {
      const t = this.target(p.index), c = this.current[i];
      const k = ease(0.16);
      const next = {
        dx: c.dx + (t.dx - c.dx) * k,
        dy: c.dy + (t.dy - c.dy) * k,
        rot: c.rot + (t.rot - c.rot) * k,
        cx: t.cx,
        cy: t.cy,
      };
      if (Math.abs(t.dx - c.dx) + Math.abs(t.dy - c.dy) + Math.abs(t.rot - c.rot) * 100 > 0.05) moving = true;
      this.current[i] = next;
    });
    const dl = Math.hypot(this.lightTarget[0] - this.light[0], this.lightTarget[1] - this.light[1]);
    if (this.mode === 'light' && dl > 0.5) {
      this.light = [this.light[0] + (this.lightTarget[0] - this.light[0]) * ease(0.12), this.light[1] + (this.lightTarget[1] - this.light[1]) * ease(0.12)];
      moving = true;
    }
    if (this.reveal) {
      this.reveal.alpha += (this.reveal.target - this.reveal.alpha) * ease(0.2);
      if (Math.abs(this.reveal.target - this.reveal.alpha) > 0.01) moving = true;
      else if (this.reveal.target === 0) this.reveal = null;
    }
    this.draw();
    if (moving) this.schedule();
  };

  draw() {
    const view: QuiltView = {
      sewing: this.sewing,
      transforms: this.current,
      reveal: this.reveal ? { index: this.reveal.index, alpha: this.reveal.alpha } : null,
      mode: this.mode,
      light: this.light,
    };
    renderQuilt(this.canvas, this.q, this.pixelWidth, view, { layers: true });
  }
}
