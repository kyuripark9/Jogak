# Stage 1 · Cutting up the Instagram capture grid

Upload a capture to `debug.html` and it draws the detected gutters and rows over the original, then lays out the cut pieces in grid order.

## Flow

```
file ─▶ input pipeline (src/input) ─▶ StripReader (reads strip by strip)
                                          │
        ┌─────────────────────────────────┘
        ▼
  scan       estimate background color → 1-bit "is it background?" mask per pixel
  columns    each row votes for short background runs bounded on both sides → vertical gutters
  rows       classify rows: grid row / blank row (horizontal gutter) / other (header, status bar)
  bands      a run of consecutive grid rows = one candidate row of cells
  aspect     settle one cell ratio (height/width) from the full rows of all captures
  classify   only rows with the right ratio that don't touch a capture edge are "full rows"
  cells      cut full rows into cells: thumbnail + 8×8 color signature
  stitch     find rows repeated across captures by signature and keep them once
```

Why each mechanism behaves the way it does:

- **No assumed cell size.** Cell width comes only from the distance between gutters, cell height only from the distance between horizontal gutters. 1:1, 4:5, and 3:4 all come out of the same code.
- **Gutters are found as "background color + thin + photo on both sides."** The column count isn't fixed either: of the gutter combinations that give equal cell widths, the one with the strongest vote wins.
- **The header isn't detected; it's discarded as "not grid."** Everything above the first full row is header, so the rule survives header redesigns.
- **Grid order = newest first.** Chronological order is the reverse. Pinned posts are dropped from the timeline on the debug screen with "First N".

## Failure cases and handling

| Situation | Why it's easy to get wrong | Handling |
|---|---|---|
| Header buttons, highlights row | Gaps between buttons and between circles look like gutters | If the vertical gaps don't line up with the grid gutters, the row is "other." Even if they do, the band is discarded when its height doesn't fit the cell ratio (0.85–1.6) |
| Header text lines | Gaps between letters are short background runs that blur the vote | Rows over 60% background are left out of the vote. Left/right edges use the mode, not the median (header rows vary; grid rows match exactly) |
| Tab icon row, selection underline | Sits right on top of the grid | A row with under 25% content inside the cells is not a grid row. A full row still counts even if the underline caps its top, as long as the height fits |
| Status bar and name bar on top, rows hidden by the bottom tab bar | The rows are cut off | Rows more than 3% shorter than the expected cell height, or touching a capture edge, are discarded as "cut-off rows" |
| Duplicate rows between screenshots | The same post gets cut twice | Compare signatures row by row (all 3 cells) and join at the position with the longest overlap against the end of the previous result. Two shots of the same screen are dropped entirely |
| Two captures with no overlapping full row | No way to know whether rows are missing in between | Compare the cut-off row at the bottom of the earlier capture with the top of the first row of the later one (or vice versa); pass if they continue directly. Otherwise warn "No rows overlap the previous screenshot, so some rows may be missing." |
| White areas in a photo touching a gutter | The gutter looks wider, or rows break | Gutter width only counts runs at least half the top vote. Breaks of 8% of the cell height or less are bridged |
| Smeared horizontal gutter merges two rows | Band is twice as tall | If the height matches k cells + k−1 gutters, split it into k rows |
| Long scrolling capture (tens of thousands of px) | iOS Safari canvas area limit (~16.7M px) | Read in strips of at most 4M px each and keep only the 1-bit mask (1/32 of the original). Cutting cells also re-reads several rows bundled into one strip. If a strip draws blank (empty pixels), only that strip is cropped and re-decoded with `createImageBitmap` |
| Safari full-page PDF | One long page of vectors plus images | pdf.js (legacy build, with polyfills for older Safari) renders only the strip ranges, fitted to a 1170px width |
| Empty slots in the last row | Background-colored cells come out as pieces | Cells that are 98% or more background are marked `empty` and excluded from the piece count |
| Gray cells before loading | They pollute color extraction | Nearly single-color cells are flagged "not loaded yet" (kept as pieces, but flagged) |
| Dark mode | Background is black | Background color is estimated as the most common color among rows that are one color across, so it just works |
| Outer left/right margins in web captures | The first cell doesn't start at x=0 | Left and right edges are found separately, as the mode across rows |

## Verification

There are no real captures yet, so verification uses fake profiles drawn by `src/synth/profile.ts` (profile picture, bio, buttons, highlights, tabs, status bar and tab bar, 4:5, 3:4, and 1:1 cells, photos with white edges, icons, gray cells).

- `npm test` — 8 unit tests: the three cell ratios, dark mode + noise, warning on captures with no overlap, the same screen twice, web left/right margins, and a 20,000px long capture read in 1500px strips. The cut pieces are checked against the ground-truth cells for order, count, no duplicates, and boundaries within ±2px.
- `npm run fixtures && npm run e2e` — real PNG/PDF files uploaded in a browser (desktop and mobile widths). 5 screenshots → 30 pieces, a 22,609px long capture → 120 pieces, a full-page PDF → 36 pieces.

## Not yet verified

- Whether decoding a very long PNG on **a real iPhone in Safari** hits the memory limit by itself. The canvas work is split into strips, but `<img>` decoding is up to the browser.
- **Real Instagram captures.** Synthetic images may differ from the real screen in gutter thickness, antialiasing, and icons.
- The actual structure of PDFs made by Safari (tested only with PDFs made by Chromium).
- Automatic detection of pinned posts (currently chosen by hand).
