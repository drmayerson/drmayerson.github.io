// Stage 1B B9: the PNG tEXt chunk (the view's URL embedded in a snapshot).
import { describe, it, expect } from 'vitest';
import { crc32, pngWithText, pngTexts } from '../../../js/export.js';

// a 1x1 grey PNG (IHDR, IDAT, IEND)
const ONE = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('PNG export', () => {
  it('CRC-32 of "IEND" is the one every PNG carries', () => {
    expect(crc32(Uint8Array.from('IEND', (c) => c.charCodeAt(0))).toString(16)).toBe('ae426082');
  });
  it('a tEXt chunk with the URL goes in after IHDR and reads back; the image chunks are kept', () => {
    const url = 'https://drmayerson.github.io/foort-gpu/?metric=st3cr&lambda=0.005&v=3';
    const out = pngWithText(ONE.buffer, 'foort-gpu-url', url);
    expect(out.length).toBe(ONE.length + 12 + 'foort-gpu-url'.length + 1 + url.length);
    expect(pngTexts(out)['foort-gpu-url']).toBe(url);
    expect(String.fromCharCode(...out.subarray(12, 16))).toBe('IHDR');
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('tEXt');
    // the chunk's CRC covers its type and data
    const len = new DataView(out.buffer).getUint32(33);
    expect(new DataView(out.buffer).getUint32(41 + len)).toBe(crc32(out.subarray(37, 41 + len)));
    expect(() => pngWithText(new Uint8Array(8).buffer, 'k', 'v')).toThrow();
  });
});
