/**
 * Irregular jogakbo partition. Repeatedly cuts a polygon with straight lines, like scissors through one cloth.
 * - Preserves time order: earlier (older) memories always fall on the same side of each cut.
 * - Area is exactly proportional to memory weight (cut position found by binary search).
 * - Lines tilt slightly like hand-cut cloth, and occasional diagonal cuts make triangles.
 *   A rebuttal to the uniform grid.
 */

export type Pt = [number, number];
export type Poly = Pt[];

export interface Piece {
  index: number;
  poly: Poly;
  area: number;
}

export interface Seam {
  a: Pt;
  b: Pt;
  /** Cut order (smaller for larger seams cut earlier) */
  depth: number;
  /** The two clusters this seam joins: pieces [from, mid) and [mid, to) */
  from: number;
  mid: number;
  to: number;
}

export interface Patchwork {
  width: number;
  height: number;
  pieces: Piece[];
  seams: Seam[];
}

export interface LayoutOptions {
  seed?: number;
  /** Hand-cut tilt (degrees) */
  maxTilt?: number;
  /** Chance of a diagonal cut when only two pieces remain */
  diagonalChance?: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function polyArea(p: Poly): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

function bbox(p: Poly) {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Splits a convex polygon into the n·x <= c side and the rest */
export function cut(p: Poly, n: Pt, c: number): [Poly, Poly, Pt[]] {
  const a: Poly = [], b: Poly = [], hits: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const P = p[i], Q = p[(i + 1) % p.length];
    const dp = n[0] * P[0] + n[1] * P[1] - c, dq = n[0] * Q[0] + n[1] * Q[1] - c;
    if (dp <= 0) a.push(P);
    if (dp >= 0) b.push(P);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      const X: Pt = [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
      a.push(X); b.push(X); hits.push(X);
    }
  }
  return [a, b, hits];
}

/** The c at which a cut along direction n leaves `ratio` of the area on the near side */
function cutAt(p: Poly, n: Pt, ratio: number): number {
  const proj = p.map((q) => n[0] * q[0] + n[1] * q[1]);
  let lo = Math.min(...proj), hi = Math.max(...proj);
  const total = polyArea(p);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (polyArea(cut(p, n, mid)[0]) / total < ratio) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function layout(weights: number[], width: number, height: number, opts: LayoutOptions = {}): Patchwork {
  const rand = rng(opts.seed ?? 7);
  const maxTilt = ((opts.maxTilt ?? 6) * Math.PI) / 180;
  const diag = opts.diagonalChance ?? 0.3;
  const pieces: Piece[] = [];
  const seams: Seam[] = [];

  const go = (poly: Poly, from: number, to: number, depth: number) => {
    if (to - from === 1) {
      pieces.push({ index: from, poly, area: polyArea(poly) });
      return;
    }
    const total = weights.slice(from, to).reduce((a, b) => a + b, 0);
    // Don't split exactly in half; split anywhere between 30–70% of the weight (like scraps)
    let acc = 0;
    const options: number[] = [];
    for (let k = from + 1; k < to; k++) {
      acc += weights[k - 1];
      const r = acc / total;
      if (r >= 0.3 && r <= 0.7) options.push(k);
    }
    if (options.length === 0) {
      // When weight is lopsided, take the most even split point
      let best = from + 1, bd = Infinity;
      acc = 0;
      for (let k = from + 1; k < to; k++) {
        acc += weights[k - 1];
        const d = Math.abs(acc / total - 0.5);
        if (d < bd) { bd = d; best = k; }
      }
      options.push(best);
    }
    const k = options[Math.floor(rand() * options.length)];
    const ratio = weights.slice(from, k).reduce((a, b) => a + b, 0) / total;

    const b = bbox(poly);
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    let n: Pt;
    if (to - from === 2 && Math.max(w, h) / Math.min(w, h) < 1.5 && rand() < diag) {
      // Cut parallel to a diagonal → triangles (n is the cut line's normal)
      const l = Math.hypot(w, h);
      n = rand() < 0.5 ? [h / l, -w / l] : [h / l, w / l];
    } else {
      // Cut across the long side; the thinner the piece, the less the tilt
      const tilt = (rand() * 2 - 1) * maxTilt * Math.min(1, Math.min(w, h) / Math.max(w, h) + 0.3);
      const angle = (w >= h ? 0 : Math.PI / 2) + tilt;
      n = [Math.cos(angle), Math.sin(angle)];
    }
    const c = cutAt(poly, n, ratio);
    const [first, second, hits] = cut(poly, n, c);
    const [sa, sb] = hits.length >= 2 ? hits : [first[0], first[0]];
    seams.push({ a: sa, b: sb, depth, from, mid: k, to });
    go(first, from, k, depth + 1);
    go(second, k, to, depth + 1);
  };

  if (weights.length > 0) {
    go([[0, 0], [width, 0], [width, height], [0, height]], 0, weights.length, 0);
  }
  pieces.sort((p, q) => p.index - q.index);
  return { width, height, pieces, seams };
}
