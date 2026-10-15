import { createRaster, cropRaster, type Raster } from '../grid/raster.ts';

/**
 * Fake Instagram profile for verification. To test the cutting rules without real captures,
 * it draws the header (profile photo, bio, buttons, highlights, tabs), portrait cells, and fixed top and bottom bars.
 * Units are iPhone 3x pixels (390pt → 1170px).
 */

export interface ProfileOptions {
  seed?: number;
  posts?: number;
  /** Cell height/width. 1, 1.25 (4:5), 4/3 (3:4) */
  aspect?: number;
  dark?: boolean;
  width?: number;
  /** Cell gutter in pt */
  gutterPt?: number;
  /** Post indices to draw as gray not-yet-loaded cells */
  placeholders?: number[];
  /**
   * 'test': random color blobs (for verifying cuts, traps included)
   * 'natural': scene colors like sea, forest, cafe, night street; runs of 1–4 of the same scene, as if shot the same day
   */
  style?: 'test' | 'natural';
}

type Scene = { name: string; sky: C; ground: C; accents: C[]; dots?: C };
export const SCENES: Scene[] = [
  { name: 'sea', sky: [176, 204, 226], ground: [52, 98, 136], accents: [[214, 196, 160], [120, 168, 204], [235, 240, 242]] },
  { name: 'forest', sky: [196, 210, 170], ground: [52, 82, 46], accents: [[104, 138, 74], [30, 48, 30], [150, 120, 80]] },
  { name: 'cafe', sky: [228, 214, 190], ground: [112, 80, 58], accents: [[196, 160, 120], [64, 44, 34], [244, 236, 220]] },
  { name: 'night', sky: [22, 26, 48], ground: [44, 50, 78], accents: [[70, 60, 90], [30, 34, 40]], dots: [244, 186, 96] },
  { name: 'blossom', sky: [242, 218, 222], ground: [150, 168, 112], accents: [[214, 152, 172], [250, 240, 238], [190, 120, 140]] },
  { name: 'snow', sky: [214, 220, 228], ground: [238, 240, 242], accents: [[120, 126, 140], [180, 188, 200]] },
  { name: 'autumn', sky: [222, 186, 120], ground: [150, 72, 40], accents: [[190, 112, 50], [92, 60, 40], [214, 160, 80]] },
  { name: 'dusk', sky: [238, 162, 112], ground: [72, 60, 98], accents: [[182, 100, 120], [250, 200, 150]] },
];

export interface TruthCell {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Profile {
  raster: Raster;
  scale: number;
  gridTop: number;
  cells: TruthCell[];
  dark: boolean;
}

type C = [number, number, number];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Painter {
  r: Raster;
  constructor(r: Raster) { this.r = r; }
  rect(x: number, y: number, w: number, h: number, c: C) {
    const { width: W, height: H, data } = this.r;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0, i = (yy * W + x0) * 4; xx < x1; xx++, i += 4) {
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
      }
    }
  }
  circle(cx: number, cy: number, rad: number, c: C, ring = 0) {
    const { width: W, height: H, data } = this.r;
    for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(H, Math.ceil(cy + rad)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(W, Math.ceil(cx + rad)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > rad || (ring && d < rad - ring)) continue;
        const i = (y * W + x) * 4;
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
      }
    }
  }
  /** Mock line of text: small rectangles in spaced runs */
  text(x: number, y: number, maxW: number, size: number, c: C, rnd: () => number) {
    let cx = x;
    while (cx < x + maxW) {
      const word = (2 + Math.floor(rnd() * 6)) * size * 0.55;
      for (let k = 0; k < word; k += size * 0.55) {
        const gh = size * (0.6 + rnd() * 0.4);
        this.rect(cx + k, y + size - gh, size * 0.42, gh, c);
      }
      cx += word + size * 0.4;
    }
  }
}

export function buildProfile(o: ProfileOptions = {}): Profile {
  const W = o.width ?? 1170;
  const S = W / 390;
  const dark = o.dark ?? false;
  const nPosts = o.posts ?? 30;
  const aspect = o.aspect ?? 1.25;
  const rnd = rng(o.seed ?? 7);
  const bg: C = dark ? [0, 0, 0] : [255, 255, 255];
  const ink: C = dark ? [245, 245, 245] : [38, 38, 38];
  const soft: C = dark ? [54, 54, 54] : [239, 239, 239];
  const g = Math.round((o.gutterPt ?? 1) * S);
  const cw = Math.floor((W - 2 * g) / 3);
  const extra = W - 2 * g - cw * 3; // Leftover pixels go to the middle cell
  const ch = Math.round(cw * aspect);
  const rows = Math.ceil(nPosts / 3);

  // Header height (pt): profile row 110 + bio 74 + buttons 50 + highlights 112 + tabs 44
  const headerPt = { profile: 110, bio: 74, buttons: 50, highlights: 112, tabs: 44 };
  const gridTop = Math.round((headerPt.profile + headerPt.bio + headerPt.buttons + headerPt.highlights + headerPt.tabs) * S);
  const H = gridTop + rows * ch + (rows - 1) * g + Math.round(40 * S);
  const r = createRaster(W, H);
  const p = new Painter(r);
  p.rect(0, 0, W, H, bg);

  let y = 0;
  // Profile photo and counts
  p.circle(16 * S + 43 * S, y + 12 * S + 43 * S, 43 * S, [196, 150, 120]);
  for (let k = 0; k < 3; k++) {
    const bx = (130 + k * 86) * S;
    p.text(bx, y + 38 * S, 30 * S, 16 * S, ink, rnd);
    p.text(bx - 6 * S, y + 62 * S, 50 * S, 12 * S, ink, rnd);
  }
  y += headerPt.profile * S;
  // Name, bio
  p.text(16 * S, y, 120 * S, 13 * S, ink, rnd);
  p.text(16 * S, y + 22 * S, 330 * S, 13 * S, ink, rnd);
  p.text(16 * S, y + 44 * S, 220 * S, 13 * S, ink, rnd);
  y += headerPt.bio * S;
  // Buttons (Following | Message | +) — a trap: the gaps between buttons look like gutters
  const bw = (390 - 32 - 34 - 12) / 2;
  p.rect(16 * S, y + 6 * S, bw * S, 32 * S, soft);
  p.rect((16 + bw + 6) * S, y + 6 * S, bw * S, 32 * S, soft);
  p.rect((16 + 2 * bw + 12) * S, y + 6 * S, 34 * S, 32 * S, soft);
  y += headerPt.buttons * S;
  // Highlight circles — the gaps between them look like gutters too
  for (let k = 0; k < 5; k++) {
    const cx = (16 + 32 + k * 80) * S;
    p.circle(cx, y + 40 * S, 33 * S, [200, 200, 200]);
    p.circle(cx, y + 40 * S, 29 * S, [120 + rnd() * 100, 100 + rnd() * 100, 90 + rnd() * 100].map(Math.round) as C);
    p.text(cx - 20 * S, y + 82 * S, 40 * S, 10 * S, ink, rnd);
  }
  y += headerPt.highlights * S;
  // Tab icons and the selected-tab underline
  for (let k = 0; k < 3; k++) {
    const cx = (65 + k * 130) * S;
    p.rect(cx - 11 * S, y + 11 * S, 22 * S, 22 * S, ink);
    p.rect(cx - 8 * S, y + 14 * S, 16 * S, 16 * S, bg);
  }
  p.rect(0, gridTop - Math.round(1 * S), 130 * S, Math.round(1 * S), ink);

  // Grid. With 'natural', the same scene repeats 1–4 times in a row (memories from one day)
  const scenes: number[] = [];
  while (scenes.length < nPosts) {
    const sc = Math.floor(rnd() * SCENES.length);
    const run = 1 + Math.floor(rnd() ** 1.6 * 4);
    for (let k = 0; k < run; k++) scenes.push(sc);
  }
  const cells: TruthCell[] = [];
  for (let id = 0; id < nPosts; id++) {
    const row = Math.floor(id / 3), col = id % 3;
    const x = col === 0 ? 0 : col === 1 ? cw + g : 2 * cw + extra + 2 * g;
    const w = col === 1 ? cw + extra : cw;
    const cy = gridTop + row * (ch + g);
    cells.push({ id, x, y: cy, w, h: ch });
    if (o.placeholders?.includes(id)) p.rect(x, cy, w, ch, soft);
    else if (o.style === 'natural') paintScene(p, x, cy, w, ch, rnd, SCENES[scenes[id]]);
    else paintPhoto(p, x, cy, w, ch, rnd, id, dark);
  }
  return { raster: r, scale: S, gridTop, cells, dark };
}

function paintScene(p: Painter, x: number, y: number, w: number, h: number, rnd: () => number, sc: Scene, noise = 12) {
  const { data, width: W } = p.r;
  const jitter = (c: C, a: number): C => c.map((v) => v + (rnd() - 0.5) * a) as C;
  const sky = jitter(sc.sky, 24), ground = jitter(sc.ground, 24);
  const horizon = h * (0.35 + rnd() * 0.3);
  const blobs = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({
    x: rnd() * w, y: horizon + (rnd() - 0.3) * h * 0.5, r: (0.08 + rnd() * 0.22) * w,
    c: jitter(sc.accents[Math.floor(rnd() * sc.accents.length)], 20),
  }));
  const dots = sc.dots ? Array.from({ length: 30 }, () => ({ x: rnd() * w, y: rnd() * h, r: 2 + rnd() * 6 })) : [];
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const t = yy < horizon ? yy / horizon : 1;
      let c: number[] = yy < horizon ? sky.map((v, k) => v * (1 - t * 0.25) + ground[k] * t * 0.25) : ground.map((v) => v * (0.9 + 0.2 * ((yy - horizon) / h)));
      for (const b of blobs) if ((xx - b.x) ** 2 + (yy - b.y) ** 2 < b.r ** 2) c = b.c;
      if (sc.dots) for (const d of dots) if ((xx - d.x) ** 2 + (yy - d.y) ** 2 < d.r ** 2) c = sc.dots;
      const n = (rnd() - 0.5) * noise;
      const i = ((y + yy) * W + x + xx) * 4;
      data[i] = c[0] + n; data[i + 1] = c[1] + n; data[i + 2] = c[2] + n; data[i + 3] = 255;
    }
  }
}

/** One scene photo for the demo */
export function scenePhoto(w: number, h: number, scene: number, seed: number, noise = 0): Raster {
  const r = createRaster(w, h);
  paintScene(new Painter(r), 0, 0, w, h, rng(seed), SCENES[scene % SCENES.length], noise);
  return r;
}

function paintPhoto(p: Painter, x: number, y: number, w: number, h: number, rnd: () => number, id: number, dark: boolean) {
  const { data, width: W } = p.r;
  const c1 = [rnd() * 255, rnd() * 255, rnd() * 255];
  const c2 = [rnd() * 255, rnd() * 255, rnd() * 255];
  const blobs = Array.from({ length: 4 }, () => ({
    x: rnd() * w, y: rnd() * h, r: (0.1 + rnd() * 0.3) * w, c: [rnd() * 255, rnd() * 255, rnd() * 255],
  }));
  // A few traps: photos where the background color touches the cell edge, and very bright photos
  const brightEdge = id % 7 === 3;
  const nearBg = id % 11 === 5;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const t = (xx / w + yy / h) / 2;
      let r = c1[0] * (1 - t) + c2[0] * t, g = c1[1] * (1 - t) + c2[1] * t, b = c1[2] * (1 - t) + c2[2] * t;
      for (const bl of blobs) {
        if ((xx - bl.x) ** 2 + (yy - bl.y) ** 2 < bl.r ** 2) { r = bl.c[0]; g = bl.c[1]; b = bl.c[2]; }
      }
      if (brightEdge && xx < w * 0.3 && yy < h * 0.5) r = g = b = dark ? 0 : 255;
      if (nearBg) { const v = dark ? 20 : 235; r = (r + v * 5) / 6; g = (g + v * 5) / 6; b = (b + v * 5) / 6; }
      const n = (rnd() - 0.5) * 10;
      const i = ((y + yy) * W + x + xx) * 4;
      data[i] = r + n; data[i + 1] = g + n; data[i + 2] = b + n; data[i + 3] = 255;
    }
  }
  // Reels/carousel icon
  if (id % 4 === 1) p.rect(x + w - 40, y + 20, 22, 22, [255, 255, 255]);
}

/** Paints the fixed status bar + name row at the top and the tab bar at the bottom */
function paintChrome(p: Painter, W: number, H: number, S: number, dark: boolean, rnd: () => number, top: boolean, bottom: boolean) {
  const bg: C = dark ? [0, 0, 0] : [255, 255, 255];
  const ink: C = dark ? [245, 245, 245] : [38, 38, 38];
  if (top) {
    p.rect(0, 0, W, 91 * S, bg);
    p.text(30 * S, 16 * S, 40 * S, 14 * S, ink, rnd);
    p.rect(W - 80 * S, 18 * S, 60 * S, 12 * S, ink);
    p.text(140 * S, 60 * S, 110 * S, 16 * S, ink, rnd);
    p.rect(W - 50 * S, 58 * S, 22 * S, 22 * S, ink);
  }
  if (bottom) {
    p.rect(0, H - 83 * S, W, 83 * S, bg);
    p.rect(0, H - 83 * S, W, Math.max(1, Math.round(0.33 * S)), dark ? [38, 38, 38] : [219, 219, 219]);
    for (let k = 0; k < 5; k++) p.rect((27 + k * 78) * S, H - 70 * S, 24 * S, 24 * S, ink);
  }
}

export interface Capture {
  name: string;
  raster: Raster;
  /** Capture coordinate = profile coordinate + offset (where profile y lands on screen) */
  offset: number;
}

/** iPhone-sized screenshots taken while scrolling down from the top */
export function screenshots(pr: Profile, scrolls: number[], viewportH = 2532): Capture[] {
  const W = pr.raster.width, S = pr.scale;
  const top = Math.round(91 * S);
  const maxScroll = pr.raster.height - (viewportH - top - Math.round(83 * S));
  return scrolls.map((want, k) => {
    const sy = Math.max(0, Math.min(want, maxScroll));
    const r = createRaster(W, viewportH);
    const p = new Painter(r);
    p.rect(0, 0, W, viewportH, pr.dark ? [0, 0, 0] : [255, 255, 255]);
    const h = Math.min(viewportH - top, pr.raster.height - sy);
    r.data.set(cropRaster(pr.raster, 0, sy, W, h).data, top * W * 4);
    paintChrome(p, W, viewportH, S, pr.dark, rng(100 + k), true, true);
    return { name: `IMG_${String(4100 + k)}.PNG`, raster: r, offset: top - sy };
  });
}

/** One long image stitched together by a scroll-capture app */
export function longCapture(pr: Profile, withChrome = true): Capture {
  const W = pr.raster.width, S = pr.scale;
  const top = withChrome ? Math.round(91 * S) : 0;
  const bottom = withChrome ? Math.round(83 * S) : 0;
  const r = createRaster(W, pr.raster.height + top + bottom);
  r.data.set(pr.raster.data, top * W * 4);
  const p = new Painter(r);
  if (withChrome) paintChrome(p, W, r.height, S, pr.dark, rng(99), true, true);
  return { name: 'long-scroll.png', raster: r, offset: top };
}

/** Mock JPEG recompression: light noise */
export function addNoise(r: Raster, amp: number, seed = 3): Raster {
  const rnd = rng(seed);
  const out = { ...r, data: new Uint8ClampedArray(r.data) };
  for (let i = 0; i < out.data.length; i += 4) {
    const n = (rnd() - 0.5) * 2 * amp;
    out.data[i] += n; out.data[i + 1] += n; out.data[i + 2] += n;
  }
  return out;
}
