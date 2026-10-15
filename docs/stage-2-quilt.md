# Stage 2 · Color and texture extraction, and the irregular jogakbo

Upload a capture to `quilt.html` (or pick "Sample: 36 scene photos") and the photos cut out in stage 1 are dyed into scraps of cloth and joined into a single jogakbo (Korean patchwork wrapping cloth).

## Mechanisms and their reasons

| Mechanism | How | Why |
|---|---|---|
| Representative colors | k-means on thumbnail samples in Lab color space (k=5, k-means++, fixed seed). The top-right 15%×20% is excluded | Memories stay as colors more than as scenes. The icon spot isn't the photo's color |
| Pastel dyeing | Lift lightness toward ~74 (keeping lightness order) and pull chroma down to at most 32 (`dyed`) | Thin cloth takes a pale dye, so light passes through and the colors layer. Like old memories, no vivid color survives |
| Warp and weft | Warp is the most common color, weft the second | Up close, the photo's other colors show between the threads |
| Choosing the cloth | Score on texture roughness (neighbor lightness difference), contrast, lightness, and chroma. All three cloths are sheer; only opacity differs, 0.56–0.66 | Busy scenes get **sambe** (hemp), the thickest of the three; clear, pale scenes get **mosi** (ramie), the most see-through; calm, deep-colored scenes get **myeongju** (silk), which has a sheen |
| Memory weight | Chronologically adjacent posts with close palettes are grouped as the same day. Weight = 1 + 0.9·√(group size−1) | Instagram captures have no dates, so "photos that day" is estimated from how far the colors carry on. If area were directly proportional to photo count, big days would eat the screen, so it's softened |
| Irregular partitioning | Repeatedly cut a convex polygon with straight lines, the way scissors divide cloth. Split anywhere between 30% and 70% of the weight, and binary-search the cut position to match area exactly | A rebuttal to the uniform grid. Sizes are arbitrary, but area is exactly the memory's weight |
| Hand-cut lines | ±6° tilt. A rectangle with only two pieces left becomes a diagonal 30% of the time → triangle pieces | The triangle pieces of traditional jogakbo; the trace of a hand that didn't use a ruler |
| Time order | Earlier (older) memories always stay on the same side of each cut | Pieces from the same day stay together, and time flows top to bottom |
| Grain direction | Each piece 0° or 90°, ±4° | Scraps come with their grain going every which way |
| Seams | Each piece covers 6 extra units at its edge with the same cloth so it overlaps its neighbor. Only the overlaps become two or three layers thick and read as darker lines. Small running stitches in a matching tone go on top | This is exactly why seams show as lines in a sheer jogakbo. Where the hand joined it is part of the work |
| Backlight | Pale hanji (mulberry paper) ground + light spreading from the top left, applied once more over the pieces with screen | Like a wrapping cloth hung in a window, the cloth holds the light. Stage 4's light mode makes this light move |

## Verification

- `npm test`: k-means finds two colors and their ratio, excludes the icon spot, gives the same result for the same input, chooses cloth by mood, groups the same day, and partitions with area proportional to weight within 1e-4 and no gaps.
- `npm run e2e`: builds a jogakbo from the 36 samples and checks area proportionality (error < 0.1%) and that all three cloths appear.

## Open judgment calls

- Estimating "the same day" from continuing colors is an approximation. Different days with similar colors get grouped. When album photos (EXIF dates) come in, they will be grouped directly by date.
- The cloth texture is currently a tile woven in JS on Canvas 2D. The plan is to move it to a WebGL shader to handle transmission in light mode (stage 4).
