// Stage 1B B8: physical units and the telescope beam.
import { describe, it, expect } from 'vitest';
import { unitsOf, formatDuration, niceBelow, beamSigmaPx, T_SUN_S, L_SUN_KM } from '../../../js/units.js';

describe('physical units (E6)', () => {
  it('the solar-mass units', () => {
    expect(T_SUN_S * 1e6).toBeCloseTo(4.925, 3);   // us per M_sun
    expect(L_SUN_KM).toBeCloseTo(1.477, 3);         // km per M_sun
  });
  it('Sgr A* and M87*: the angle of 1 M as published (5.12 and 3.8 uas)', () => {
    expect(unitsOf('sgra').thetaUas).toBeCloseTo(5.12, 2);   // GRAVITY 2022: R_g = 5.12 uas at 8.277 kpc
    expect(unitsOf('m87').thetaUas).toBeCloseTo(3.8, 1);     // EHT 2019 Paper VI: GM/Dc^2 = 3.8 uas
    expect(unitsOf('sgra').tS).toBeCloseTo(21.16, 1);        // GM/c^3 = 21 s for Sgr A*
    // real time for Sgr A*: 1 s of the observer's clock is 1 / 21.2 = 0.047 M
    expect(1 / unitsOf('sgra').tS).toBeCloseTo(0.0473, 3);
    expect(unitsOf('m87').tS / 3600).toBeCloseTo(8.89, 1);   // 8.9 h per M for M87*
  });
  it('dimensionless and custom', () => {
    expect(unitsOf('M')).toBeNull();
    const u = unitsOf('custom', 2e6, 10);
    expect(u.Msun).toBe(2e6);
    expect(u.thetaUas).toBeCloseTo(unitsOf('sgra').thetaUas * (2e6 / 4.297e6) * (8.277 / 10), 6);
  });
  it('durations and round numbers', () => {
    expect(formatDuration(21.2)).toBe('21.2 s');
    expect(formatDuration(3600 * 8.9)).toBe('8.90 h');
    expect(formatDuration(5e-5)).toBe('50.0 µs');
    expect(niceBelow(7.3)).toBe(5); expect(niceBelow(0.031)).toBe(0.02); expect(niceBelow(150)).toBe(100);
  });
  it('beam: FWHM in uas -> sigma in pixels through theta_g and the pixel size', () => {
    // Sgr A*, 20 uas = 3.906 M; screen 15 M over 512 px: 0.0293 M/px; sigma = FWHM / 2.3548
    const s = beamSigmaPx(20, unitsOf('sgra'), 15, 512);
    expect(s).toBeCloseTo(20 / 5.1228 / 2.35482 / (15 / 512), 1);
    expect(beamSigmaPx(2, null, 15, 512)).toBeCloseTo(2 / 2.354820045 / (15 / 512), 6);   // in M directly
  });
});
