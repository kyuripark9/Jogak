import { describe, expect, it } from 'vitest';
import { layout } from '../src/layout/patchwork.ts';
import { Sewing, seamLength } from '../src/interaction/sewing.ts';

const pw = layout(Array(10).fill(1), 1000, 1250, { seed: 4 });

describe('바느질', () => {
  it('처음엔 조각 둘을 잇는 작은 솔기만 꿰맬 수 있다', () => {
    const sw = new Sewing(pw);
    pw.seams.forEach((s, i) => expect(sw.isSewable(i)).toBe(s.to - s.from === 2));
  });

  it('큰 솔기는 안쪽 솔기를 다 꿰맨 뒤에 열린다', () => {
    const sw = new Sewing(pw);
    const root = pw.seams.findIndex((s) => s.depth === 0);
    expect(sw.isSewable(root)).toBe(false);
    expect(sw.sew(root, 0, seamLength(pw.seams[root]), 0.1)).toBe(false);
    const order = pw.seams.map((_, i) => i).sort((a, b) => pw.seams[b].depth - pw.seams[a].depth);
    for (const i of order) if (i !== root) expect(sw.sew(i, 0, seamLength(pw.seams[i]), 0.1)).toBe(true);
    expect(sw.isSewable(root)).toBe(true);
    sw.sew(root, 0, seamLength(pw.seams[root]), 0.1);
    expect(sw.done).toBe(true);
    // 다 이으면 흐트러짐이 없다
    expect(sw.transformOf(0)).toMatchObject({ dx: 0, dy: 0, rot: 0 });
  });

  it('땀은 지나간 자리에만 생기고, 90%를 넘기면 솔기가 완성된다', () => {
    const sw = new Sewing(pw);
    const i = pw.seams.findIndex((_, k) => sw.isSewable(k));
    const len = seamLength(pw.seams[i]);
    expect(sw.sew(i, 0, len * 0.5, 0.1)).toBe(false);
    expect(sw.coverage(i)).toBeCloseTo(0.5, 2);
    expect(sw.seams[i].stitches.every((t) => t.s1 <= len * 0.5 + 1e-9)).toBe(true);
    // 같은 자리를 다시 그어도 땀이 겹쳐 생기지 않는다
    const n = sw.seams[i].stitches.length;
    sw.sew(i, len * 0.1, len * 0.4, 0.1);
    expect(sw.seams[i].stitches.length).toBe(n);
    expect(sw.sew(i, len * 0.5, len * 0.95, 0.1)).toBe(true);
    expect(sw.seams[i].sewn).toBe(true);
  });

  it('빨리 그으면 땀이 길고 성기다', () => {
    const slow = new Sewing(pw), fast = new Sewing(pw);
    const i = pw.seams.findIndex((_, k) => slow.isSewable(k));
    const len = seamLength(pw.seams[i]);
    slow.sew(i, 0, len * 0.8, 0.05);
    fast.sew(i, 0, len * 0.8, 2);
    expect(fast.seams[i].stitches.length).toBeLessThan(slow.seams[i].stitches.length);
  });

  it('꿰매면 두 덩어리가 같이 움직인다', () => {
    const sw = new Sewing(pw);
    const i = pw.seams.findIndex((_, k) => sw.isSewable(k));
    const s = pw.seams[i];
    expect(sw.transformOf(s.from)).not.toEqual(sw.transformOf(s.mid));
    sw.sew(i, 0, seamLength(s), 0.1);
    expect(sw.transformOf(s.from)).toEqual(sw.transformOf(s.mid));
  });
});
