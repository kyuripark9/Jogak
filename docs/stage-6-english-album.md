# Stage 6 · English site and album photos (input B)

## English

Every page, label, status line, error, doc, and code comment is in English, because Jogak is a portfolio piece for a US audience.
Korean craft words stay, romanized and glossed: jogakbo (patchwork wrapping cloth), mosi (ramie), sambe (hemp), myeongju (silk).
The type is a Latin serif stack (Iowan Old Style, Palatino, Georgia) in place of the Korean myeongjo stack.

## Album photos

`quilt.html` now has two ways in: **Choose photos from your album** and **Upload Instagram screenshots**. Dropping files onto the box picks the right one (dated JPEGs go to the album path).

| Mechanism | Why |
|---|---|
| Read the EXIF capture time (`DateTimeOriginal`) with a ~150-line reader (`src/input/exif.ts`) | Camera photos know when they happened, so memories are grouped by what happened instead of guessed from color. Three tags don't justify a library. |
| Sort by capture time, not file name | Camera-roll exports aren't in time order by name; the oldest memory should be piece 1. |
| A memory is one day, split again when the photographer moved more than 1.5 km (`memoryKeys`) | A morning at the beach and an evening across town are two memories, even on the same date. Brief walks don't split a memory. |
| Photos without GPS stay with the place the day was already at | Missing data shouldn't invent a new memory. |
| No EXIF date → file modified time, and the status line says how many | Better a guessed time than a dropped photo, but you should know it was guessed. |
| Location is used only for grouping | It's never drawn, shown on a map, or written into the PNG. It stays on the device like everything else. |
| Decode three photos at a time, keep only a 240 px copy | Dozens of 12-megapixel photos at once can exhaust a phone's memory; color and texture survive at 240 px. |
| "Sample: 29 album photos" builds a camera roll in the browser with real EXIF | So visitors without their own photos (and the tests) can see day-and-place grouping: 29 photos, 9 days, 11 memories. |

## Checked

- `tests/exif.test.ts`: little- and big-endian EXIF, southern and western coordinates, files with no or broken EXIF, zeroed camera clocks, and day/place splitting.
- `e2e/album.spec.ts`: the sample album gives 11 memories in time order; two real JPEGs given to the picker are ordered by EXIF date, not by name.

## Not yet

- iOS Safari may remove location when a photo is chosen through the file picker. Then grouping falls back to one memory per day.
- HEIC files open only in browsers that decode HEIC (Safari). iPhones usually convert to JPEG when a photo is picked.
