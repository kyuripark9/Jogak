# Jogak

A jogakbo album that sews memories together (jogakbo: Korean patchwork wrapping cloth). It takes photos trapped in Instagram's uniform grid and sews them back up as a jogakbo, with pieces and seams of every size. It runs entirely in the browser with no server, and your photos never leave it.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173/ (demo), /quilt.html, /debug.html
npm test           # grid detection unit tests
npm run fixtures   # build synthetic capture PNGs/PDFs (fixtures/out)
npm run demo-photos # regenerate the sample photos for the demo (public/demo)
npm run e2e        # upload files in a browser and check the results
npm run perf       # time the first screen, drawing, and saving
npm run og         # regenerate the link preview image (public/og.png)
npm run build      # static site in dist/
```

## Structure

| Module | What it does | Stage |
|---|---|---|
| `src/input` | Input pipeline that reads screenshots, long captures, and PDFs strip by strip | 1 |
| `src/grid` | Gutter detection, row classification, cell cutting, capture stitching (no DOM) | 1 |
| `src/synth` | Fake Instagram profile captures for testing | 1 |
| `src/debug` | Stage 1 inspection screen | 1 |
| `src/color` | k-means representative colors; mood → cloth (mosi, sambe, myeongju) | 2 |
| `src/layout` | Memory weight, irregular patchwork partitioning | 2 |
| `src/render` | Cloth weaving (noise), drawing the patchwork and its seams | 2 |
| `src/quilt` | Stage 2 patchwork screen | 2 |
| `src/interaction` | Sewing rules (order, stitches, scattering); drag, hover, long press | 3 |
| `src/render/export.ts`, `src/app` | Hanging it in the window (light mode); keeping it as a PNG once fully sewn | 4 |
| `src/app/base.css` | Shared base for every screen (hanji, ink color, running-stitch underline) | 5 |
| `src/demo`, `public/demo` | First screen you can see without uploading; replaceable sample photos | 4 |
| `src/input/album.ts`, `src/input/exif.ts` | Album photos: EXIF capture time and place → memories | 6 |

Cloth names: mosi (ramie), sambe (hemp), myeongju (silk). Hanji is Korean mulberry paper.

- Stage 1 overview and failure-case handling: [docs/stage-1-grid.md](docs/stage-1-grid.md)
- Stage 2 mechanisms and their reasons: [docs/stage-2-quilt.md](docs/stage-2-quilt.md)
- Stage 3 sewing and seeing the original through the cloth: [docs/stage-3-sewing.md](docs/stage-3-sewing.md)
- Stage 4 light mode, PNG export, demo: [docs/stage-4-light-export-demo.md](docs/stage-4-light-export-demo.md)
- Stage 5 polish and performance (measured numbers): [docs/stage-5-polish-performance.md](docs/stage-5-polish-performance.md)
- Stage 6, English site and album photos with EXIF date and place: [docs/stage-6-english-album.md](docs/stage-6-english-album.md)
- Stage 7, publishing to GitHub Pages, link preview, saved progress: [docs/stage-7-publish.md](docs/stage-7-publish.md)
