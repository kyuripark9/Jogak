# Stage 3 · Sewing interaction and seeing the original through the cloth

In `quilt.html` the jogakbo (Korean patchwork wrapping cloth) doesn't arrive already sewn. The pieces are laid out slightly shifted from their places, and the seams only join when you sew them yourself.

| Mechanism | How | Why |
|---|---|---|
| Scattered scraps | An unsewn cluster sits up to 9 units and 2.2° off its place. Larger clusters scatter less, by 1/√n, and a fully joined one sits at 0 | A piece that isn't yours yet doesn't stay put. A big panel's weight holds it to the floor |
| Basting | Loose red temporary thread is drawn only on the seams you can sew right now | Basting to hold things in place before sewing is the real order of work. It shows where to sew without a word |
| Sewing order | A seam opens only once the clusters on both sides are each fully joined (the reverse of the cuts) | A real jogakbo also joins small pieces into strips, and strips into panels |
| Stitching | Press on a basting thread and trace along the seam; stitches appear only where your hand passed. Move too far from the seam and the thread breaks; tracing the same spot again doesn't double the stitches | The effort of joining stays in the cloth |
| Hand speed | Trace slowly and stitches are short (3.2) and even; trace fast and they're long (up to 10.2), loose, and crooked | The same jogakbo keeps the hand of whoever sewed it, and that makes it theirs |
| Finishing | Past 90%, the needle fills the remaining gap and the two clusters are pulled into place and snap together (a short vibration on mobile) | You aren't asked to land the last few stitches exactly. The moment it joins should be felt in the hand |
| Seeing the original through | Hover over a piece on desktop, or press and hold (0.42 s) on mobile, and the photo slides under the cloth while the cloth thins | Photos are only seen through cloth. Memories remain as color, not scenes, and the scene shows through only when you come close |

Sewn stitches move with their cluster. Rebuild from the same memories and a different hand leaves different stitches.

## Verification

- `npm test`: at first only small seams open; large seams open after everything inside them is sewn; stitches appear only where traced (tracing over them doesn't add more); completion at 90%; fast tracing gives loose stitches; sewn clusters move together.
- `npm run e2e`: in a desktop browser, traces all 35 seams with the mouse to finish, checks that locked seams and half-traced seams don't join, and that hovering over a piece reveals the original.

## Not yet verified

- How long press and finger drag feel on a real phone (automated tests use only the mouse).
- Whether seams on very short edges (such as the short side of a triangle piece) are easy to grab with a finger.
- Sewing progress isn't saved yet. A refresh starts over.
