import { describe, expect, it } from 'vitest';
import { distance, parseExifDate, readExif } from '../src/input/exif.ts';
import { memoryKeys } from '../src/input/album.ts';

/** A minimal JPEG: SOI, an APP1 Exif segment with IFD0 → Exif IFD (DateTimeOriginal) and GPS IFD, then SOS. */
function jpeg(opts: { le: boolean; date?: string; gps?: { lat: [number, number, number]; latRef: string; lon: [number, number, number]; lonRef: string } }) {
  const tiff: number[] = [];
  const le = opts.le;
  const w16 = (o: number, x: number) => { tiff[o] = le ? x & 255 : x >> 8; tiff[o + 1] = le ? x >> 8 : x & 255; };
  const w32 = (o: number, x: number) => {
    const b = [x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255];
    (le ? b.reverse() : b).forEach((y, i) => (tiff[o + i] = y));
  };
  const entry = (o: number, tag: number, type: number, count: number, value: number) => { w16(o, tag); w16(o + 2, type); w32(o + 4, count); w32(o + 8, value); };
  // Header
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]));
  w16(2, 42);
  w32(4, 8);
  // IFD0 at 8: two entries
  const ifd0 = 8, exifIfd = 8 + 2 + 2 * 12 + 4, gpsIfd = exifIfd + 2 + 12 + 4, data = gpsIfd + 2 + 4 * 12 + 4;
  w16(ifd0, 2);
  entry(ifd0 + 2, 0x8769, 4, 1, exifIfd);
  entry(ifd0 + 14, 0x8825, 4, 1, gpsIfd);
  w32(ifd0 + 26, 0);
  // Exif IFD: DateTimeOriginal (20 bytes, stored at data)
  w16(exifIfd, opts.date ? 1 : 0);
  if (opts.date) entry(exifIfd + 2, 0x9003, 2, 20, data);
  w32(exifIfd + 14, 0);
  const date = (opts.date ?? '').padEnd(19, ' ') + '\0';
  [...date].forEach((c, i) => (tiff[data + i] = c.charCodeAt(0)));
  // GPS IFD
  const latAt = data + 20, lonAt = latAt + 24;
  w16(gpsIfd, opts.gps ? 4 : 0);
  if (opts.gps) {
    const ref = (o: number, s: string) => { entry(o, 0, 2, 2, 0); tiff[o + 8] = s.charCodeAt(0); tiff[o + 9] = 0; tiff[o + 10] = 0; tiff[o + 11] = 0; };
    ref(gpsIfd + 2, opts.gps.latRef); w16(gpsIfd + 2, 1);
    entry(gpsIfd + 14, 2, 5, 3, latAt);
    ref(gpsIfd + 26, opts.gps.lonRef); w16(gpsIfd + 26, 3);
    entry(gpsIfd + 38, 4, 5, 3, lonAt);
    const rat = (o: number, [d, m, s]: number[]) => { w32(o, d); w32(o + 4, 1); w32(o + 8, m); w32(o + 12, 1); w32(o + 16, Math.round(s * 100)); w32(o + 20, 100); };
    rat(latAt, opts.gps.lat);
    rat(lonAt, opts.gps.lon);
  }
  for (let i = 0; i < tiff.length; i++) tiff[i] ??= 0;
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2]).buffer;
}

describe('readExif', () => {
  for (const le of [true, false]) {
    it(`reads the capture time and location (${le ? 'little' : 'big'}-endian)`, () => {
      const e = readExif(jpeg({ le, date: '2024:05:18 14:03:09', gps: { lat: [37, 34, 12.5], latRef: 'N', lon: [126, 58, 40], lonRef: 'E' } }));
      expect(e.taken).toBe('2024-05-18T14:03:09');
      expect(e.gps![0]).toBeCloseTo(37 + 34 / 60 + 12.5 / 3600, 6);
      expect(e.gps![1]).toBeCloseTo(126 + 58 / 60 + 40 / 3600, 6);
    });
  }

  it('makes southern and western coordinates negative', () => {
    const e = readExif(jpeg({ le: true, date: '2023:12:01 09:00:00', gps: { lat: [33, 52, 0], latRef: 'S', lon: [151, 12, 0], lonRef: 'W' } }));
    expect(e.gps![0]).toBeLessThan(0);
    expect(e.gps![1]).toBeLessThan(0);
  });

  it('gives nothing for files without EXIF, and survives garbage', () => {
    expect(readExif(jpeg({ le: true }))).toEqual({});
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({});
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 40, 0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]).buffer)).toEqual({});
  });

  it('ignores zeroed camera clocks', () => {
    expect(parseExifDate('0000:00:00 00:00:00')).toBeUndefined();
    expect(parseExifDate('2022:01:02 03:04:05')).toBe('2022-01-02T03:04:05');
  });
});

describe('memoryKeys', () => {
  const seoul: [number, number] = [37.5665, 126.978];
  const nearby: [number, number] = [37.5675, 126.979]; // ~140 m
  const busan: [number, number] = [35.1796, 129.0756];

  it('splits a day where the photographer moved, not where they paused', () => {
    expect(distance(seoul, nearby)).toBeLessThan(200);
    const keys = memoryKeys([
      { taken: '2024-05-18T09:00:00', gps: seoul },
      { taken: '2024-05-18T09:20:00', gps: nearby },
      { taken: '2024-05-18T10:00:00' }, // no location: stays with the morning
      { taken: '2024-05-18T19:00:00', gps: busan },
      { taken: '2024-05-19T08:00:00', gps: busan }, // new day, new memory
    ]);
    expect(keys).toEqual(['2024-05-18#0', '2024-05-18#0', '2024-05-18#0', '2024-05-18#1', '2024-05-19#0']);
  });
});
