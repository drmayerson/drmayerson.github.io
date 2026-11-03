// Parsers for FOORT .dat output (first line: run description; then one line per geodesic:
// "<row> <column>  <diagnostic data>"; row = index along alpha, column along beta).
import { readFileSync, existsSync } from 'node:fs';

/** @param {string} file @returns {{header:string, rows:Map<string, string[]>}} */
export function readDat(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const rows = new Map();
  for (const l of lines.slice(1)) {
    if (!l.trim()) continue;
    const parts = l.trim().split(/\s+/);
    rows.set(`${parts[0]},${parts[1]}`, parts.slice(2));
  }
  return { header: lines[0], rows };
}

/**
 * All FOORT diagnostics of a run directory, keyed "i,j".
 * GeodesicPosition prints the final (t, log r, theta, phi) with 6 decimals (std::to_string), so r = exp(value).
 * @param {string} dir @param {string} name
 */
export function readFoortRun(dir, name) {
  const f = (d) => `${dir}/${name}_${d}.dat`;
  if (!existsSync(f('FourColorScreen'))) throw new Error(`no FOORT output in ${dir}`);
  const four = readDat(f('FourColorScreen'));
  const pos = readDat(f('GeodesicPosition'));
  const em = readDat(f('EquatorialEmission'));
  /** @type {Map<string, {quadrant:number, t:number, r:number, theta:number, phi:number, intensity:number, passes:number}>} */
  const out = new Map();
  for (const [k, v] of four.rows) {
    const p = pos.rows.get(k), e = em.rows.get(k);
    // p = ["1", ";;", t, logr, theta, phi]
    out.set(k, {
      quadrant: Number(v[0]),
      t: Number(p[2]), r: Math.exp(Number(p[3])), theta: Number(p[4]), phi: Number(p[5]),
      intensity: Number(e[0]), passes: Number(e[1]),
    });
  }
  return { header: four.header, pixels: out };
}
