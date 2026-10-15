import { describe, expect, it } from 'vitest';
import { layout } from '../src/layout/patchwork.ts';
import { Sewing, seamLength } from '../src/interaction/sewing.ts';

const pw = layout(Array(10).fill(1), 1000, 1250, { seed: 4 });

describe('sewing', () => {
  it('at first only small seams joining two pieces can be sewn', () => {
    const sw = new Sewing(pw);
    pw.seams.forEach((s, i) => expect(sw.isSewable(i)).toBe(s.to - s.from === 2));
  });

  it('a large seam opens only after all inner seams are sewn', () => {
    const sw = new Sewing(pw);
    const root = pw.seams.findIndex((s) => s.depth === 0);
    expect(sw.isSewable(root)).toBe(false);
    expect(sw.sew(root, 0, seamLength(pw.seams[root]), 0.1)).toBe(false);
    const order = pw.seams.map((_, i) => i).sort((a, b) => pw.seams[b].depth - pw.seams[a].depth);
    for (const i of order) if (i !== root) expect(sw.sew(i, 0, seamLength(pw.seams[i]), 0.1)).toBe(true);
    expect(sw.isSewable(root)).toBe(true);
    sw.sew(root, 0, seamLength(pw.seams[root]), 0.1);
    expect(sw.done).toBe(true);
    // Once fully joined, nothing is scattered
    expect(sw.transformOf(0)).toMatchObject({ dx: 0, dy: 0, rot: 0 });
  });

  it('stitches appear only where traced, and a seam completes past 90%', () => {
    const sw = new Sewing(pw);
    const i = pw.seams.findIndex((_, k) => sw.isSewable(k));
    const len = seamLength(pw.seams[i]);
    expect(sw.sew(i, 0, len * 0.5, 0.1)).toBe(false);
    expect(sw.coverage(i)).toBeCloseTo(0.5, 2);
    expect(sw.seams[i].stitches.every((t) => t.s1 <= len * 0.5 + 1e-9)).toBe(true);
    // Retracing the same span doesn't add overlapping stitches
    const n = sw.seams[i].stitches.length;
    sw.sew(i, len * 0.1, len * 0.4, 0.1);
    expect(sw.seams[i].stitches.length).toBe(n);
    expect(sw.sew(i, len * 0.5, len * 0.95, 0.1)).toBe(true);
    expect(sw.seams[i].sewn).toBe(true);
  });

  it('tracing fast makes long, sparse stitches', () => {
    const slow = new Sewing(pw), fast = new Sewing(pw);
    const i = pw.seams.findIndex((_, k) => slow.isSewable(k));
    const len = seamLength(pw.seams[i]);
    slow.sew(i, 0, len * 0.8, 0.05);
    fast.sew(i, 0, len * 0.8, 2);
    expect(fast.seams[i].stitches.length).toBeLessThan(slow.seams[i].stitches.length);
  });

  it('sewn clusters move together', () => {
    const sw = new Sewing(pw);
    const i = pw.seams.findIndex((_, k) => sw.isSewable(k));
    const s = pw.seams[i];
    expect(sw.transformOf(s.from)).not.toEqual(sw.transformOf(s.mid));
    sw.sew(i, 0, seamLength(s), 0.1);
    expect(sw.transformOf(s.from)).toEqual(sw.transformOf(s.mid));
  });
});
