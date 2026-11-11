// Recomputes every visitor-facing number of ET-horizon from the tables embedded in index.html,
// by running the page's own MODEL block, and checks the texts that quote them.
// Run from anywhere:  node et-horizon/dev/check-numbers.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const PHYS = JSON.parse(html.match(/<script id="phys" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const block = html.slice(html.indexOf('/* ================= MODEL-BEGIN'), html.indexOf('/* ================= MODEL-END'));
const textBlock = html.slice(html.indexOf('/* ================= text'), html.indexOf('const L=()=>T[LANG];'));
const M = new Function('PHYS', block + textBlock + '\nreturn {NUM,SHARE,REACH,RATE,tlOfZ,DcOfZ,BUMP,Z_IR,T};')(PHYS);
const { NUM, SHARE, REACH } = M;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fail++; };
const r1 = x => Math.round(x * 10) / 10;

console.log('--- numbers ---');
console.log('mergers per year: black holes', Math.round(NUM.perYr.BBH), '· neutron stars', Math.round(NUM.perYr.BNS));
console.log('one merger every', NUM.perMerger.toFixed(1), 's');
console.log('lookback z=1', r1(NUM.tl1), '· z=6', r1(NUM.tl6), '· z=14', r1(NUM.tlIR), '· CMB', r1(NUM.tlAll), 'billion years');
console.log('age of universe at z=14 ~', NUM.ageAtIR, 'million years');
console.log('comoving distance to CMB ~', NUM.cmbGly, 'billion light years');
console.log('half-reach 30+30: LVK z', REACH.lvk.zb.toFixed(3), `(${r1(NUM.lvkReachTl)} Gyr ago)`, '· ET z', REACH.et.zb.toFixed(2));
console.log('heard, black holes: LVK', (100 * SHARE.lvk.BBH).toFixed(3) + '%', '· ET', (100 * SHARE.et.BBH).toFixed(1) + '%');
console.log('heard, neutron stars: LVK', (100 * SHARE.lvk.BNS).toFixed(4) + '%', '· ET', (100 * SHARE.et.BNS).toFixed(1) + '%');
console.log('LVK per year:', Math.round(SHARE.lvk.BBH * NUM.perYr.BBH + SHARE.lvk.BNS * NUM.perYr.BNS));
console.log('takeaway: today', NUM.lvkPer1000, 'in 1000 · ET', NUM.etPer10, 'in 10');
console.log('Milky Way neutron-star merger: once every ~', NUM.mwYears, 'years');

console.log('--- checks ---');
ok(PHYS.meta.R0_BBH === 20 && PHYS.meta.R0_BNS === 100, 'local rates used are 20 and 100 per Gpc³ per year');
ok(NUM.perMerger > 30 && NUM.perMerger < 120, '"about one a minute" (30–120 s)');
ok(r1(NUM.tl6) === 12.9, 'visible-light limit z=6 reads 12.9 billion years');
ok(r1(NUM.tlIR) === 13.5, 'infrared limit z=14 reads 13.5 billion years');
ok(r1(NUM.tlAll) === 13.8, 'Big Bang afterglow 13.8 billion years');
ok(NUM.cmbGly === 45, 'source of the afterglow now ~45 billion light years away');
ok(NUM.lvkPer1000 === 1, "today: 1 in every 1000 black-hole collisions (was 2 with the old 15% peak)");
ok(NUM.etPer10 === 7, 'ET: 7 in every 10 black-hole collisions');
ok(NUM.mwYears === 100000, 'Milky Way: about once every 100,000 years');
ok(M.BUMP === 0.05, 'black-hole peak holds 5%');
// The info panel quotes the two rates and the bump; make sure the texts still say so in every language.
for (const [lang, re] of [['nl', /20 \(zwarte gaten\) en 100 \(neutronensterren\)/], ['en', /20 \(black holes\) and 100 \(neutron stars\)/], ['fr', /20 \(trous noirs\) et 100 \(étoiles à neutrons\)/]])
  ok(re.test(html), `info panel (${lang}) states the rates 20 and 100`);
ok(/BUMP\*100/.test(html), 'info panel derives the peak share from BUMP');
ok(!/fonts\.googleapis/.test(html), 'no Google Fonts request');
// X6: visitor texts (everything except the experts' info panel) carry no bare z and no M☉
const flat = (o) => typeof o === 'string' ? [o] : typeof o === 'function' ? [String(o(1))] : Array.isArray(o) ? o.flatMap(flat) : Object.values(o).flatMap(flat);
for (const l of ['nl', 'en', 'fr']) {
  const { about, ...rest } = M.T[l];
  const bad = flat(rest).filter(x => /\bz\s*[≈=]|M☉/.test(x));
  ok(bad.length === 0, `${l}: no bare z or M☉ in visitor text` + (bad.length ? ' -> ' + bad[0] : ''));
  const et = M.T[l].cap.gw_et[1];
  ok(et.includes(String(NUM.lvkPer1000)) && et.includes(String(NUM.etPer10)), `${l}: takeaway quotes ${NUM.lvkPer1000} in 1000 and ${NUM.etPer10} in 10`);
  ok(M.T[l].cap.ir[1].includes(l === 'en' ? '13.5' : '13,5') && /JWST/.test(M.T[l].cap.ir[1]), `${l}: infrared caption says 13.5 billion years and names JWST`);
}

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
