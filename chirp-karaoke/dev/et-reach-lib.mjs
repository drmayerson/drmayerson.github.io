// Loads ET-horizon's own detection-probability tables and reach code, straight from
// ../../et-horizon/index.html, so Chirp-karaoke is generated from (and tested against)
// exactly what ET-horizon shows. Node >= 18, no dependencies.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ET_HTML = path.resolve(here, '../../et-horizon/index.html');
export const CHIRP_HTML = path.resolve(here, '../index.html');

export function loadEtHorizon() {
  const src = fs.readFileSync(ET_HTML, 'utf8');
  const m = src.match(/<script id="phys" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('PHYS table not found in et-horizon/index.html');
  const PHYS = JSON.parse(m[1]);
  // The reach helpers: from "function bsearch" up to (not including) "const MC3030".
  const a = src.indexOf('function bsearch'), b = src.indexOf('const MC3030');
  if (a < 0 || b < 0 || b < a) throw new Error('reach helpers not found in et-horizon/index.html');
  const code = src.slice(a, b) + '\n;({bsearch, interp, DcOfZ, zOfDc, tlOfZ, pdet, zAtP, Zc, DC, TLB});';
  const ctx = vm.createContext({ PHYS, Math });
  const api = vm.runInContext(code, ctx);
  return { PHYS, ...api };
}
