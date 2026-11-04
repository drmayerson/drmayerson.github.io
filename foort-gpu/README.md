# FOORT-GPU

Browser ray tracer for black holes and fuzzballs with an equatorial disc, after
[FOORT](https://github.com/drmayerson/foort). Work in progress; see
`FOORT_GPU_STAGE1_PLAN.md` (plan), `PROGRESS.md` (checkpoint reports) and `DECISIONS.md`.

## Run locally

No build step. Serve this folder with any static server:

```
sh dev/serve.sh            # or: powershell -File dev\serve.ps1
```

then open <http://127.0.0.1:8765/> (the viewer), <http://127.0.0.1:8765/caps.html> (capability report) and
<http://127.0.0.1:8765/bench/> (backend benchmark). The viewer state is in the URL query (e.g. `?a=0.5&inc=80&view=sky`).

## Layout

- `index.html`, `style.css`, `js/`: the app (plain ES modules, JSDoc + `// @ts-check`).
- `bench/`: the M0 WebGL2-vs-WebGPU benchmark (throwaway quality).
- `shaders/glsl/`: WebGL2 shaders: `common.glsl` (tracer core), `trace_kerr_analytic.glsl` (analytic Kerr), `display.glsl` (views).
- `tools/`: offline tools (FOORT parity harness, noise generation); not loaded by the app.
- `dev/`: dev-only tooling. Needs Node.js ≥ 18:

```
cd dev
npm install
npx playwright install chromium   # only if Chrome is not installed
npm test                           # Vitest unit tests (pure-math modules, run in node)
npm run test:e2e                   # Playwright: capability page, benchmark agreement, viewer, in Chrome
node scripts/m3Level2.mjs          # GPU vs CPU reference images (reports in dev/reports/m3/)
node scripts/m3Level3.mjs          # analytic checks (shadow, capture, kerrCore escape directions, face-on)
node scripts/m3Perf.mjs            # trace timings vs the M0 benchmark
npm run typecheck                  # optional tsc --checkJs
```
