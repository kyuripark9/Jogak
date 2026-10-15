# Stage 4 · Hanging it in the window, keeping it, and the first screen

One line on why each mechanism behaves the way it does.

## Light mode ("Hold it up to the window light")

- **Light from behind the window + multiply compositing**: a jogakbo (Korean patchwork wrapping cloth) was made to hang in a window and filter sunlight, so with the light behind it only the overlapping seam allowances darken and the joins reveal themselves.
- **The light follows the pointer**: just as the bright spots shift when the sun moves, whichever piece you look into gets brighter.
- **Stitches go dark**: against the light, thread blocks it and reads as shadow.
- **Sheen only in wall mode ("Hang it on the wall")**: myeongju (silk) only shows its luster in light from the front.

## "Keep it as a PNG"

- **Unlocks only once fully sewn ("Finish sewing to keep it")**: pieces that aren't joined aren't one jogakbo yet.
- **Saves the mode you're looking at**: hung on the wall and held to the window are different memories, so it keeps the one you chose.
- **Tries 3000 → 2400 → 1600px in order**: big enough to print, but rebuilt smaller if it hits a phone's canvas limit.
- **Drawn in the browser and downloaded directly**: the photos are never uploaded anywhere. The file name is `jogakbo-YYYYMMDD.png`, the day it was sewn.

## First screen (demo)

- **A jogakbo shows up right away, no upload needed**: first-time visitors see what they'll make before they get captures ready.
- **Only a few large seams are left open** (`LEAVE_DEPTH = 2`): sewing the last few stitches of an almost-finished jogakbo teaches the sewing rules in one go.
- **Sample photos are swapped via `public/demo/manifest.json`**: change only each entry's `src` and `date` (day taken, oldest first) and it becomes your own photos. With dates, weight is grouped by day.

### How to swap the photos

1. Put photos in `public/demo/` (320–640px wide is plenty; they're shrunk to 240px anyway, only to pull colors).
2. Edit `manifest.json` into the form `[{ "src": "a.jpg", "date": "2024-05-02" }, ...]`.
3. `npm run build`.

## Checks

- `e2e/demo.spec.ts`: the first screen unfolds without an upload and saving is locked; sewing the remaining seams by dragging unlocks saving and downloads a 3000px PNG; hanging it in the window switches the mode.
