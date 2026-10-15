import type { Quilt } from '../quilt/build.ts';
import type { Pt } from '../layout/patchwork.ts';
import { renderQuilt, quiltScale, QUILT_MARGIN, type QuiltView } from '../render/quilt.ts';
import { Sewing, applyTransform, centroid, invertTransform, pointInPoly, project, type Transform } from './sewing.ts';

/**
 * Where the hand meets the jogakbo canvas.
 * - Press on a sewable seam (red basting thread) and trace along it to make stitches.
 * - Once a seam is fully sewn, the two scattered clusters are pulled into place and joined.
 * - Hover (desktop) or long-press (mobile) to see the original photo through that piece.
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
   * Where piece i should go. Re-expressing the cluster rotation about the piece's own center
   * keeps pieces from jumping when merged clusters change the pivot, so they glide smoothly.
   */
  private target(i: number): Transform {
    const t = this.sewing.transformOf(i);
    const c = centroid(this.q.patchwork.pieces[i].poly);
    const moved = applyTransform(t, c);
    return { dx: moved[0] - c[0], dy: moved[1] - c[1], rot: t.rot, cx: c[0], cy: c[1] };
  }

  /**
   * Light mode: hangs the jogakbo in a window. The light follows the hand (pointer), revealing
   * overlapping seams and threads, as if holding the cloth up and turning it against the light.
   */
  setMode(mode: 'wall' | 'light') {
    this.mode = mode;
    this.schedule();
  }

  /** Screen coordinates → quilt units */
  toQuilt(clientX: number, clientY: number): Pt {
    const r = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / r.width / quiltScale(this.pixelWidth);
    return [(clientX - r.left) * k - QUILT_MARGIN, (clientY - r.top) * k - QUILT_MARGIN];
  }

  /** Quilt units → screen coordinates (for tests) */
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
        // Straying off the seam breaks the stitching; coming back resumes from there
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
    // With reduced motion on, snap into place instead of gliding (same meaning, minus the motion)
    const ease = (k: number) => (REDUCED_MOTION.matches ? 1 : k);
    // Clusters are pulled into place
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
