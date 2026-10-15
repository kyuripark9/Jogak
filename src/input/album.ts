import type { Raster } from '../grid/raster.ts';
import { distance, readExif } from './exif.ts';

/**
 * Input B: photos straight from a camera roll. Unlike Instagram screenshots, these carry
 * their own time and place, so memories can be grouped by what actually happened instead of guessed from color.
 */

export interface AlbumPhoto {
  name: string;
  /** Small copy for color extraction and the reveal; the full photo is never kept */
  thumb: Raster;
  /** Local time taken, "YYYY-MM-DDTHH:MM:SS" */
  taken: string;
  /** False when EXIF had no date and the file's modified time stood in */
  dated: boolean;
  gps?: [number, number];
}

const THUMB = 240;
/** Same day, but this far from the last photo: a different memory (a morning at the beach, an evening across town) */
export const NEW_PLACE_METERS = 1500;

export async function loadAlbum(files: File[], onProgress?: (done: number, total: number) => void) {
  const photos: AlbumPhoto[] = [];
  const errors: string[] = [];
  let done = 0;
  // A few at a time: decoding dozens of 12-megapixel photos at once can exhaust a phone's memory
  const queue = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        photos.push(await loadPhoto(f));
      } catch {
        errors.push(`${f.name}: could not open this photo.`);
      }
      onProgress?.(++done, files.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  // Oldest first, like every other input. Names break ties so a burst keeps its order
  photos.sort((a, b) => a.taken.localeCompare(b.taken) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { photos, errors };
}

async function loadPhoto(file: File): Promise<AlbumPhoto> {
  const exif = readExif(await file.slice(0, 256 * 1024).arrayBuffer());
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // Browsers apply the EXIF orientation when drawing, so portraits stay upright
    const w = Math.min(THUMB, img.naturalWidth), h = Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const thumb = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
    return { name: file.name, thumb, taken: exif.taken ?? localTime(file.lastModified), dated: !!exif.taken, gps: exif.gps };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function localTime(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * One key per photo; neighbors with the same key are one memory, and its size sets the weight.
 * A memory is a day, split again wherever the photographer moved more than NEW_PLACE_METERS.
 * Photos without a location stay with whatever place the day was already at.
 */
export function memoryKeys(photos: Pick<AlbumPhoto, 'taken' | 'gps'>[], newPlace = NEW_PLACE_METERS): string[] {
  let day = '', place = 0;
  let last: [number, number] | undefined;
  return photos.map((p) => {
    const d = p.taken.slice(0, 10);
    if (d !== day) {
      day = d;
      place = 0;
      last = undefined;
    }
    if (p.gps) {
      if (last && distance(last, p.gps) > newPlace) place++;
      last = p.gps;
    }
    return `${day}#${place}`;
  });
}
