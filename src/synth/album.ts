import { scenePhoto } from './profile.ts';

/**
 * A sample camera roll for trying input B without your own photos (and for tests):
 * scene photos saved as JPEGs that carry EXIF capture times and locations, like a phone's.
 */

/** An APP1 Exif segment holding DateTimeOriginal and GPS, little-endian */
export function exifSegment(taken: string, gps?: [number, number]): Uint8Array {
  const exifIfd = 38, gpsIfd = 56, data = 110;
  const tiff = new DataView(new ArrayBuffer(data + 20 + 48));
  const b = new Uint8Array(tiff.buffer);
  const entry = (o: number, tag: number, type: number, count: number, value: number) => {
    tiff.setUint16(o, tag, true); tiff.setUint16(o + 2, type, true); tiff.setUint32(o + 4, count, true); tiff.setUint32(o + 8, value, true);
  };
  b.set([0x49, 0x49]);
  tiff.setUint16(2, 42, true);
  tiff.setUint32(4, 8, true);
  tiff.setUint16(8, 2, true);
  entry(10, 0x8769, 4, 1, exifIfd);
  entry(22, 0x8825, 4, 1, gpsIfd);
  tiff.setUint16(exifIfd, 1, true);
  entry(exifIfd + 2, 0x9003, 2, 20, data);
  // "2024-05-18T14:03:09" → "2024:05:18 14:03:09"
  const s = taken.replace(/-/g, ':').replace('T', ' ');
  for (let i = 0; i < 19; i++) b[data + i] = s.charCodeAt(i);
  if (gps) {
    tiff.setUint16(gpsIfd, 4, true);
    const ref = (o: number, tag: number, c: string) => { entry(o, tag, 2, 2, 0); b[o + 8] = c.charCodeAt(0); };
    const rat = (o: number, deg: number) => {
      const a = Math.abs(deg), d = Math.floor(a), m = Math.floor((a - d) * 60), sec = Math.round(((a - d) * 60 - m) * 60 * 1000);
      [[d, 1], [m, 1], [sec, 1000]].forEach(([n, q], i) => { tiff.setUint32(o + i * 8, n, true); tiff.setUint32(o + i * 8 + 4, q, true); });
    };
    ref(gpsIfd + 2, 1, gps[0] < 0 ? 'S' : 'N');
    entry(gpsIfd + 14, 2, 5, 3, data + 20);
    ref(gpsIfd + 26, 3, gps[1] < 0 ? 'W' : 'E');
    entry(gpsIfd + 38, 4, 5, 3, data + 44);
    rat(data + 20, gps[0]);
    rat(data + 44, gps[1]);
  }
  const len = 2 + 6 + b.length;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...b]);
}

/** Puts an Exif segment right after a JPEG's start-of-image marker */
export function withExif(jpeg: Uint8Array, segment: Uint8Array) {
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2));
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

const PLACES: [number, number][] = [
  [37.5796, 126.977], // a palace courtyard
  [37.5512, 126.9882], // a hilltop tower
  [35.1587, 129.1604], // a beach
  [33.4589, 126.9425], // an island crater
  [37.5326, 127.0246], // a riverside park
];

/** 29 photos over 9 days. Two of the days move between places, so they become two memories each */
export async function sampleAlbum(): Promise<File[]> {
  // [day, scene, place, photos]
  const plan: [string, number, number, number][] = [
    ['2024-03-30', 4, 0, 3], ['2024-04-21', 0, 1, 2], ['2024-04-21', 2, 4, 3], ['2024-06-08', 1, 2, 4],
    ['2024-07-13', 7, 3, 2], ['2024-08-31', 3, 4, 3], ['2024-10-05', 6, 0, 2], ['2024-10-05', 5, 1, 2],
    ['2024-12-24', 2, 1, 1], ['2025-02-15', 5, 4, 3], ['2025-05-03', 0, 2, 4],
  ];
  const files: File[] = [];
  let n = 0, hour = 9;
  let lastDay = '';
  for (const [day, scene, place, count] of plan) {
    hour = day === lastDay ? hour + 4 : 9;
    lastDay = day;
    for (let k = 0; k < count; k++) {
      n++;
      const r = scenePhoto(360, 450, scene, n * 17 + 3, 6);
      const c = document.createElement('canvas');
      c.width = r.width;
      c.height = r.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      const blob = await new Promise<Blob>((res) => c.toBlob((x) => res(x!), 'image/jpeg', 0.85));
      const taken = `${day}T${String(hour).padStart(2, '0')}:${String(10 + k * 7).padStart(2, '0')}:00`;
      const [la, lo] = PLACES[place];
      // A few meters of wander between shots at the same place
      const gps: [number, number] = [la + k * 0.0003, lo + k * 0.0002];
      const bytes = withExif(new Uint8Array(await blob.arrayBuffer()), exifSegment(taken, gps));
      // Shuffled names, as a camera roll export would not be in time order by name
      files.push(new File([bytes], `IMG_${4000 + ((n * 37) % 97)}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
    }
  }
  return files;
}
