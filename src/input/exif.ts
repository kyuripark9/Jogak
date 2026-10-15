/**
 * The two facts Jogak takes from a camera photo's EXIF: when it was taken, and where.
 * A tiny reader instead of a library: we only need three tags, and the bytes never leave the browser.
 * Location is used only to tell memories apart. It is never drawn, shown on a map, or written into the PNG.
 */

export interface Exif {
  /** Local time the photo was taken, "YYYY-MM-DDTHH:MM:SS" (EXIF has no time zone, and neither does a memory) */
  taken?: string;
  /** [latitude, longitude] in degrees */
  gps?: [number, number];
}

const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME_ORIGINAL = 0x9003;
const GPS_LAT_REF = 1, GPS_LAT = 2, GPS_LON_REF = 3, GPS_LON = 4;

/** Reads EXIF from a JPEG. Anything else (PNG, HEIC, a screenshot with no EXIF) gives {}. */
export function readExif(buf: ArrayBuffer): Exif {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
  let p = 2;
  while (p + 4 <= v.byteLength) {
    if (v.getUint8(p) !== 0xff) return {};
    const marker = v.getUint8(p + 1);
    // Image data starts here; metadata always comes before it
    if (marker === 0xda || marker === 0xd9) return {};
    const len = v.getUint16(p + 2);
    if (marker === 0xe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) {
      try {
        return parseTiff(v, p + 10, Math.min(v.byteLength, p + 2 + len));
      } catch {
        return {};
      }
    }
    p += 2 + len;
  }
  return {};
}

interface Entry { type: number; count: number; at: number }

function parseTiff(v: DataView, t: number, end: number): Exif {
  const order = v.getUint16(t);
  if (order !== 0x4949 && order !== 0x4d4d) return {};
  const le = order === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const inside = (o: number, n: number) => o >= t && o + n <= end;

  const ifd = (off: number) => {
    const map = new Map<number, Entry>();
    const at = t + off;
    if (!inside(at, 2)) return map;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (!inside(e, 12)) break;
      map.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
    }
    return map;
  };
  // Values longer than four bytes live elsewhere; the entry holds their offset
  const valueAt = (e: Entry, size: number) => (e.count * size > 4 ? t + u32(e.at) : e.at);
  const ascii = (e?: Entry) => {
    if (!e || e.type !== 2) return undefined;
    const o = valueAt(e, 1);
    if (!inside(o, e.count)) return undefined;
    let s = '';
    for (let i = 0; i < e.count; i++) {
      const c = v.getUint8(o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const rationals = (e?: Entry) => {
    if (!e || e.type !== 5) return undefined;
    const o = valueAt(e, 8);
    if (!inside(o, e.count * 8)) return undefined;
    return Array.from({ length: e.count }, (_, i) => {
      const d = u32(o + i * 8 + 4);
      return d ? u32(o + i * 8) / d : NaN;
    });
  };

  const ifd0 = ifd(u32(t + 4));
  const out: Exif = {};
  const exifPtr = ifd0.get(TAG_EXIF_IFD);
  const original = exifPtr ? ascii(ifd(u32(exifPtr.at)).get(TAG_DATETIME_ORIGINAL)) : undefined;
  // The moment the shutter closed, not when the file was last edited
  const taken = parseExifDate(original) ?? parseExifDate(ascii(ifd0.get(TAG_DATETIME)));
  if (taken) out.taken = taken;

  const gpsPtr = ifd0.get(TAG_GPS_IFD);
  if (gpsPtr) {
    const g = ifd(u32(gpsPtr.at));
    const lat = dms(rationals(g.get(GPS_LAT)), ascii(g.get(GPS_LAT_REF)), 'S');
    const lon = dms(rationals(g.get(GPS_LON)), ascii(g.get(GPS_LON_REF)), 'W');
    // 0,0 is what some phones write when they had no fix
    if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) out.gps = [lat, lon];
  }
  return out;
}

function dms(r: number[] | undefined, ref: string | undefined, negative: string) {
  if (!r || r.length < 3 || r.some((x) => !Number.isFinite(x))) return undefined;
  const deg = r[0] + r[1] / 60 + r[2] / 3600;
  return ref === negative ? -deg : deg;
}

/** "2024:05:18 14:03:09" → "2024-05-18T14:03:09". Blank or zeroed dates (cameras with no clock) → undefined */
export function parseExifDate(s?: string): string | undefined {
  const m = s?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m || m[1] === '0000' || m[2] === '00' || m[3] === '00') return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** Great-circle distance in meters */
export function distance([la1, lo1]: [number, number], [la2, lo2]: [number, number]) {
  const r = Math.PI / 180;
  const a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 2 * 6371e3 * Math.asin(Math.min(1, Math.sqrt(a)));
}
