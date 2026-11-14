// Review package 5 (C5): the observer time is wrapped in double precision before it reaches float32
import { describe, it, expect } from 'vitest';
import { wrapTime } from '../../../js/noise/noiseField.js';

describe('C5: wrapTime', () => {
  it('wraps into [0, T) and keeps sub-frame steps at t = 1e7 M', () => {
    const T = 1000;
    expect(wrapTime(1e7, T)).toBe(0);
    expect(wrapTime(1e7 + 0.3, T)).toBeCloseTo(0.3, 6);
    expect(wrapTime(-0.5, T)).toBeCloseTo(999.5, 9);
    expect(wrapTime(12345.6789, 0)).toBe(12345.6789);
    // in float32, 1e7 + 0.3 is 1e7: the step would be lost without the wrap
    expect(Math.fround(1e7 + 0.3) - Math.fround(1e7)).toBe(0);
    expect(Math.fround(wrapTime(1e7 + 0.3, T)) - Math.fround(wrapTime(1e7, T))).toBeCloseTo(0.3, 6);
    // the advection phase fract(t / D)
    const D = 40;
    expect(wrapTime((1e7 + 10) / D, 1)).toBeCloseTo(0.25, 9);
  });
});
