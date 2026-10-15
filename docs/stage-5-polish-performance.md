# Stage 5 · Polish and performance

## Measured (`npm run perf`)

Headless Chromium (SwiftShader), 24 demo photos. "×4" means the CPU throttled 4× to mimic an average phone.

| | Before | After |
|---|---|---|
| First screen until the jogakbo unfolds | 1.31 s (×4: 2.47 s) | 0.56 s (×4: 1.38 s) |
| Color extraction, 24 photos (Node) | 350ms | 47ms |
| One frame while the light follows your hand in light mode (×4) | 100ms (10fps) | 33ms (30fps) |
| Building a 3000px PNG | 1.5 s | 1.5 s (unchanged) |

## What was fixed, and why

- **k-means on flat arrays with squared distances**: distances are only compared, so the square root isn't needed. With over a hundred photos in one feed this is most of the wait, so it was cut 7×. Same results (unit tests still pass).
- **Precompute sRGB → linear values**: there are only 256 possible 8-bit values.
- **The browser shrinks the demo photos**: instead of pulling every pixel of a large image and shrinking it in JS, it's shrunk while drawing at 240px.
- **Layering light mode**: window light passes through cloth multiplicatively (light × cloth). So once the cloth and thread are captured, moving only the light takes just three layers, window → multiply captured cloth → thread, for the same picture. `e2e/demo.spec.ts` compares it pixel by pixel against a full redraw (mean difference under 0.6/255). It's turned off when building a large PNG because it doubles memory use.
- **Original photos also multiply when held to the window**: against the light, a photo filters light like slide film. It also fits the layering.
- **No redraw while the mouse moves over the same piece**: if nothing changed, nothing is drawn.

## What was polished, and why

- **On wide screens, the jogakbo stands on the left with the intro and gesture hints beside it**: while sewing, the remaining seam count and buttons must always be visible, and the whole jogakbo must fit on one screen to see where to sew (fitted to the screen height).
- **Only the hints that fit the device**: with a mouse, "Hover over a piece"; with only fingers, "Press and hold a piece". Never hint at a gesture you don't have.
- **44px button height**: tall enough to press comfortably with a finger.
- **Respects the reduced-motion setting**: pieces snap into place instead of sliding. The meaning (it joined) stays; only the motion goes.
- **iPhone notch and home bar insets (safe-area)**, address bar tinted hanji (Korean mulberry paper) color (`theme-color`).
- **Icon**: four pieces and one red basting thread mid-sew.
- **"Your photos never leave this browser."**: the one promise you need to know before uploading a photo.
- **Shared styles split out**: the base every screen uses (`src/app/base.css`) was pulled out of the stage 1 inspection screen's styles.

## Not done yet

- Checking touch and speed on real iPhones and Android phones (the numbers here are emulated).
- Rotating the screen or resizing the window only stretches the canvas with CSS; the resolution stays as first drawn.
- A 3000px PNG is about 20MB. The cloth's fine weave doesn't compress well.
