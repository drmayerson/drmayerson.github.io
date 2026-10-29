// Builds a single-file demo (no database) for previewing: dist/carpool-demo.html
// Usage: node tools/build-demo.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const js = (await build({ entryPoints: ['src/app.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020' })).outputFiles[0].text;
const css = readFileSync('styles.css', 'utf8');
const page = `<title>Carpool Dansles</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&display=swap">
<style>${css}</style>
<div id="app"></div>
<script>window.CARPOOL_CONFIG = {};</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
writeFileSync('dist/carpool-demo.html', page);
console.log(`dist/carpool-demo.html ${(page.length / 1024).toFixed(0)} KB`);
