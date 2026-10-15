# Stage 7 · Ready to publish

| Mechanism | Why |
|---|---|
| GitHub Pages deploy on every push to `main` (`.github/workflows/pages.yml`) | A portfolio needs a link that always shows the latest version. The site is static, so nothing else is needed. |
| CI on every pull request: unit tests + production build (`ci.yml`) | A change that breaks the build or the slicing logic is caught before it reaches the live link. |
| Link preview image `public/og.png`, made from the real demo patchwork (`npm run og`) | When the link is shared, the preview shows what the page actually makes, not a stock graphic. |
| Canvas redraws at the new size when the window or phone rotates (`ResizeObserver` in `stage.ts`) | Threads stay crisp instead of being stretched from the first size. |
| The demo remembers your stitches in this browser | A jogakbo is sewn over several sittings. Only stitch positions are stored, never photos. |
| "Unpick my stitches" | Unpicking is how you undo sewing. It removes only your stitches; the seams that came already sewn stay sewn. |

## Going live (one time, for the repo owner)

1. Merge the pull request into `main`.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The next push to `main` (or **Actions → Deploy to GitHub Pages → Run workflow**) publishes to `https://kyuripark9.github.io/Jogak/`.

The preview tags in `index.html` assume that address. Change `og:url` and `og:image` if the site moves to a custom domain.

## Checked

- `e2e/demo.spec.ts`: a sewn seam survives a reload, and unpicking returns to the starting state; shrinking the window shrinks the canvas resolution.
- CI ran green on the pull request.
