import { describe, it, expect } from 'vitest';
import { ZimukuBmpSolver } from '../../src/services/subtitles/providers/zimuku-solver.js';

describe('ZimukuBmpSolver', () => {
  it('throws error on invalid non-BMP data', () => {
    expect(() => new ZimukuBmpSolver('dGVzdA==')).toThrow('Invalid BMP data');
  });

  it('recognizes 5 digits from synthesized 100x27 BMP', () => {
    // 54-byte standard BMP header for 100x27 24bpp
    const width = 100;
    const height = 27;
    const stride = (width * 3 + 3) & ~3;
    const pixelBytes = stride * height;
    const totalSize = 54 + pixelBytes;

    const buffer = Buffer.alloc(totalSize);
    buffer.write('BM', 0);
    buffer.writeUInt32LE(totalSize, 2);
    buffer.writeUInt32LE(54, 10);
    buffer.writeUInt32LE(40, 14);
    buffer.writeInt32LE(width, 18);
    buffer.writeInt32LE(height, 22);
    buffer.writeUInt16LE(1, 26);
    buffer.writeUInt16LE(24, 28);

    // Fill with white background (255)
    buffer.fill(255, 54);

    const solver = new ZimukuBmpSolver(buffer.toString('base64'));
    const code = solver.recognize();
    expect(code).toBeDefined();
    expect(code.length).toBe(5);
  });
});
