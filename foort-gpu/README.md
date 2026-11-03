# FOORT-GPU

Browser ray tracer for black holes and fuzzballs with an equatorial disc, after
[FOORT](https://github.com/drmayerson/foort). Work in progress; see
`FOORT_GPU_STAGE1_PLAN.md` (plan), `PROGRESS.md` (checkpoint reports) and `DECISIONS.md`.

## Run locally

No build step. Serve this folder with any static server:

```
sh dev/serve.sh            # or: powershell -File dev\serve.ps1
```

then open <http://127.0.0.1:8765/> (capability report) and <http://127.0.0.1:8765/bench/> (backend benchmark).

## Layout

- `index.html`, `style.css`, `js/`: the app (plain ES modules, JSDoc + `// @ts-check`).
- `bench/`: the M0 WebGL2-vs-WebGPU benchmark (throwaway quality).
- `shaders/`: per-backend shader sources (from M3).
- `tools/`: offline tools (FOORT parity harness, noise generation); not loaded by the app.
- `dev/`: dev-only tooling. Needs Node.js ≥ 18:

```
cd dev
npm install
npx playwright install chromium   # only if Chrome is not installed
npm test                           # Vitest unit tests (pure-math modules, run in node)
npm run test:e2e                   # Playwright: capability page + benchmark agreement, in Chrome
npm run typecheck                  # optional tsc --checkJs
```
