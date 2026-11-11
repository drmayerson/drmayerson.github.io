// Runs the DOM-free core of ../index.html (<script id="ck-core">) in Node and returns its functions.
import fs from 'node:fs';
import vm from 'node:vm';
import { CHIRP_HTML } from './et-reach-lib.mjs';
export function loadChirpCore() {
  const html = fs.readFileSync(CHIRP_HTML, 'utf8');
  const m = html.match(/<script id="ck-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('ck-core script not found');
  const ctx = vm.createContext({});
  return vm.runInContext(m[1] + '\n;({REACH, TARGETS, analyze, synthChirp, fOfTau, tauOfF, pitchTrack, karaokeScore, targetSound, interpLog, reachZ, lookback, classify});', ctx);
}
