import type { Patchwork, Pt, Seam } from '../layout/patchwork.ts';

/**
 * Sewing rules. State only, no DOM.
 *
 * - Seams can be sewn only in the reverse order of the cuts: both sides must already be joined
 *   into one cluster before the seam between them can be sewn. A real jogakbo, too, joins small pieces
 *   into strips first, then strips into panels.
 * - Unsewn clusters sit slightly scattered out of place. Larger clusters scatter less
 *   (a big panel lies flat under its own weight). Fully joined, nothing is scattered.
 * - Stitches appear only where the finger passes. Trace slowly for short, even stitches; trace fast
 *   for long, crooked ones. The effort of joining stays visible, and that makes the jogakbo yours.
 */

export interface Stitch {
  /** Distance from the seam's start (quilt units) */
  s0: number;
  s1: number;
  /** Offset from the seam (stitch start/end) */
  off0: number;
  off1: number;
}

export interface SeamState {
  sewn: boolean;
  /** Spans already stitched [s0, s1] (quilt units) */
  covered: [number, number][];
  stitches: Stitch[];
}

export interface Transform {
  dx: number;
  dy: number;
  /** Radians. Rotation about (cx, cy) */
  rot: number;
  cx: number;
  cy: number;
}

export const COMPLETE_AT = 0.9;

function hash(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export const seamLength = (s: Seam) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);

function mergeIntervals(xs: [number, number][]): [number, number][] {
  const s = [...xs].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Parts of [a, b] not yet covered */
function uncovered(covered: [number, number][], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  let x = a;
  for (const [c0, c1] of covered) {
    if (c1 <= x) continue;
    if (c0 >= b) break;
    if (c0 > x) out.push([x, Math.min(c0, b)]);
    x = Math.max(x, c1);
    if (x >= b) break;
  }
  if (x < b) out.push([x, b]);
  return out;
}

export class Sewing {
  readonly pw: Patchwork;
  readonly seams: SeamState[];
  /** Seams nested inside each seam */
  private inner: number[][];

  constructor(pw: Patchwork) {
    this.pw = pw;
    this.seams = pw.seams.map(() => ({ sewn: false, covered: [], stitches: [] }));
    this.inner = pw.seams.map((s, i) =>
      pw.seams.flatMap((t, j) => (j !== i && t.from >= s.from && t.to <= s.to ? [j] : [])),
    );
  }

  get sewnCount() {
    return this.seams.filter((s) => s.sewn).length;
  }

  get done() {
    return this.seams.every((s) => s.sewn);
  }

  isSewable(i: number) {
    return !this.seams[i].sewn && this.inner[i].every((j) => this.seams[j].sewn);
  }

  /** Cluster [from, to) containing piece p: the span of the first sewn seam found from the top */
  component(p: number): [number, number] {
    let best: [number, number] = [p, p + 1];
    let bestDepth = Infinity;
    this.pw.seams.forEach((s, i) => {
      if (this.seams[i].sewn && p >= s.from && p < s.to && s.depth < bestDepth) {
        bestDepth = s.depth;
        best = [s.from, s.to];
      }
    });
    return best;
  }

  /** The cluster's scatter offset. Pieces in the same cluster move together */
  transformOf(p: number): Transform {
    const [from, to] = this.component(p);
    const n = to - from;
    const total = this.pw.pieces.length;
    let cx = 0, cy = 0, area = 0;
    for (let i = from; i < to; i++) {
      const pc = this.pw.pieces[i];
      const c = centroid(pc.poly);
      cx += c[0] * pc.area; cy += c[1] * pc.area; area += pc.area;
    }
    cx /= area; cy /= area;
    if (n === total) return { dx: 0, dy: 0, rot: 0, cx, cy };
    const k = 1 / Math.sqrt(n);
    const h = (m: number) => hash(from * 7919 + to * 104729 + m) * 2 - 1;
    return { dx: h(1) * 9 * k, dy: h(2) * 9 * k, rot: ((h(3) * 2.2 * Math.PI) / 180) * k, cx, cy };
  }

  /**
   * Sews seam i over [s0, s1]. speed is in quilt units/ms.
   * Returns true if this call completes the seam.
   */
  sew(i: number, s0: number, s1: number, speed: number): boolean {
    const st = this.seams[i];
    if (!this.isSewable(i)) return false;
    const len = seamLength(this.pw.seams[i]);
    const a = Math.max(0, Math.min(s0, s1)), b = Math.min(len, Math.max(s0, s1));
    if (b - a < 0.5) return false;
    // The faster the trace, the longer the stitches, drifting off the seam and crooked
    const v = Math.min(1, speed / 1.2);
    const stitchLen = 3.2 + v * 7;
    const gap = 2.6 + v * 4;
    const wob = 0.4 + v * 2.2;
    for (const [u0, u1] of uncovered(st.covered, a, b)) {
      for (let x = u0 + gap / 2; x < u1; x += stitchLen + gap) {
        const k = st.stitches.length;
        const base = 2.2 + (hash(i * 131 + k) - 0.5) * wob;
        st.stitches.push({ s0: x, s1: Math.min(u1, x + stitchLen), off0: base, off1: base + (hash(i * 71 + k) - 0.5) * wob });
      }
    }
    st.covered = mergeIntervals([...st.covered, [a, b]]);
    const cov = st.covered.reduce((p, [x, y]) => p + y - x, 0) / len;
    if (cov >= COMPLETE_AT) {
      // The needle fills in the short gaps left over
      for (const [u0, u1] of uncovered(st.covered, 0, len)) {
        for (let x = u0 + 1.3; x < u1; x += 5.8) {
          const k = st.stitches.length;
          const base = 2.2 + (hash(i * 131 + k) - 0.5) * 0.4;
          st.stitches.push({ s0: x, s1: Math.min(u1, x + 3.2), off0: base, off1: base });
        }
      }
      st.covered = [[0, len]];
      st.sewn = true;
      return true;
    }
    return false;
  }

  coverage(i: number) {
    const len = seamLength(this.pw.seams[i]);
    return this.seams[i].covered.reduce((p, [x, y]) => p + y - x, 0) / len;
  }

  /** The sewable seam nearest to a point (within maxDist) */
  nearestSewable(p: Pt, maxDist: number): { seam: number; s: number; dist: number } | null {
    let best: { seam: number; s: number; dist: number } | null = null;
    this.pw.seams.forEach((seam, i) => {
      if (!this.isSewable(i)) return;
      const pr = project(seam, p);
      if (pr.dist <= maxDist && (!best || pr.dist < best.dist)) best = { seam: i, ...pr };
    });
    return best;
  }
}

export function project(seam: Seam, p: Pt) {
  const dx = seam.b[0] - seam.a[0], dy = seam.b[1] - seam.a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const t = (p[0] - seam.a[0]) * ux + (p[1] - seam.a[1]) * uy;
  const s = Math.max(0, Math.min(len, t));
  const qx = seam.a[0] + ux * s, qy = seam.a[1] + uy * s;
  return { s, dist: Math.hypot(p[0] - qx, p[1] - qy) };
}

export function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}

export function applyTransform(t: Transform, [x, y]: Pt): Pt {
  const c = Math.cos(t.rot), s = Math.sin(t.rot);
  const rx = x - t.cx, ry = y - t.cy;
  return [t.cx + rx * c - ry * s + t.dx, t.cy + rx * s + ry * c + t.dy];
}

export function invertTransform(t: Transform, [x, y]: Pt): Pt {
  const c = Math.cos(-t.rot), s = Math.sin(-t.rot);
  const rx = x - t.dx - t.cx, ry = y - t.dy - t.cy;
  return [t.cx + rx * c - ry * s, t.cy + rx * s + ry * c];
}

export function pointInPoly(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
