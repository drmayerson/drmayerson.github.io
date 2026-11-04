import { openViewer } from './gpuRunner.mjs';
import { writeFileSync } from 'node:fs';
const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
for (const [name, q] of [['kerr', 'N=512'], ['kerr80', 'N=512&inc=80'], ['mn', 'N=512&preset=Test_MNrun&metric=mankoNovikov&alpha3=1&inc=30&mu=0.658826&gamma=-1.5']]) {
  await v.page.goto(`${base}?${q}`);
  await v.page.waitForFunction(() => /done|failed|not valid|error/i.test(document.getElementById('status').textContent), null, { timeout: 120000 });
  await v.page.waitForTimeout(200);
  console.log(name, await v.page.evaluate(() => document.getElementById('status').textContent + ' | ' + document.getElementById('legend').textContent));
  const url = await v.page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
  writeFileSync(`../tools/foort_parity/build/m5_${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
await v.close();
