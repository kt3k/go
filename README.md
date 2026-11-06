# Go · 囲碁

Play **go** (igo, weiqi, baduk) against the computer, right in your browser.

- 9×9, 13×13 and 19×19 boards, handicap stones, komi
- Five opponents from Japanese folklore, from _Tanuki_ to _Ryūjin_
- Engine runs in a Web Worker: Monte-Carlo tree search with RAVE and tactical
  playouts
- Chinese (area) scoring with automatic dead-stone estimation; tap a group to
  change its status before accepting the count
- Pass, undo, hints, resign; step through earlier positions with ← →
- Positional superko, ko and suicide rules enforced
- Dark mode; interface in English and Japanese
- Works offline: fonts are self-hosted, nothing is loaded from a CDN

The UI follows the design of [shatranj](https://github.com/kt3k/shatranj).

## Development

Requires [Deno](https://deno.com) 2.x.

```sh
deno install     # fetch npm deps (tailwindcss, basecoat-css, fonts)
deno task dev    # build, watch and serve on http://localhost:8000
deno task test   # engine tests
deno task build  # production build into dist/
```

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds and
deploys `dist/` to GitHub Pages. In the repository settings, set **Pages → Build
and deployment → Source** to **GitHub Actions**.
