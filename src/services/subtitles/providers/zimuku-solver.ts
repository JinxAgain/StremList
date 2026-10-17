/**
 * ZimukuBmpSolver recognizes 5 digits from Zimuku's 100x27 BMP verification image
 * using point-sampling template matching.
 */

export class ZimukuBmpSolver {
  private static readonly IMG_WIDTH = 100;
  private static readonly IMG_HEIGHT = 27;
  private static readonly CHAR_WIDTH = 20;
  private static readonly NUM_CHARS = 5;
  private static readonly PIXEL_DATA_OFFSET = 54;

  private static readonly SAMPLE_POINTS: [number, number][] = [
    [10, 7],
    [7, 8],
    [12, 8],
    [10, 13],
    [7, 19],
    [12, 19],
    [10, 20],
    [6, 13],
    [14, 13]
  ];

  private static readonly TEMPLATES: Record<string, number[]> = {
    '0': [1, 1, 1, 1, 1, 1, 1, 1, 0],
    '1': [0, 1, 0, 0, 0, 0, 1, 0, 0],
    '2': [1, 0, 1, 0, 1, 0, 1, 0, 0],
    '3': [1, 0, 1, 1, 0, 1, 1, 0, 0],
    '4': [0, 0, 1, 0, 0, 1, 0, 0, 0],
    '5': [1, 1, 0, 0, 0, 1, 1, 0, 0],
    '6': [1, 0, 1, 1, 1, 1, 1, 1, 0],
    '7': [1, 0, 1, 0, 0, 0, 0, 0, 0],
    '8': [1, 1, 1, 1, 1, 1, 1, 0, 0],
    '9': [1, 1, 1, 0, 1, 0, 1, 0, 0]
  };

  private readonly data: Buffer;
  private readonly stride: number;

  constructor(b64String: string) {
    this.data = Buffer.from(b64String, 'base64');
    if (
      this.data.length < ZimukuBmpSolver.PIXEL_DATA_OFFSET ||
      this.data[0] !== 0x42 || // 'B'
      this.data[1] !== 0x4d // 'M'
    ) {
      throw new Error('Invalid BMP data');
    }
    this.stride = (ZimukuBmpSolver.IMG_WIDTH * 3 + 3) & ~3;
  }

  public recognize(): string {
    const result: string[] = [];
    let oneOffset = 0;

    for (let i = 0; i < ZimukuBmpSolver.NUM_CHARS; i++) {
      const charX = i * ZimukuBmpSolver.CHAR_WIDTH;
      const features = ZimukuBmpSolver.SAMPLE_POINTS.map(([px, py]) =>
        this.isForeground(charX + px - oneOffset, py) ? 1 : 0
      );

      const digit = this.matchDigit(features);
      if (digit === '1') {
        oneOffset += 1;
      } else if (digit === '4') {
        oneOffset -= 1;
      }
      result.push(digit);
    }

    return result.join('');
  }

  private isForeground(x: number, y: number, threshold = 70): boolean {
    const bmpY = ZimukuBmpSolver.IMG_HEIGHT - 1 - y;
    const offset = ZimukuBmpSolver.PIXEL_DATA_OFFSET + bmpY * this.stride + x * 3;

    if (offset + 2 >= this.data.length) {
      return false;
    }

    const b = this.data[offset];
    const g = this.data[offset + 1];
    const r = this.data[offset + 2];

    return (r + g + b) / 3 < threshold;
  }

  private matchDigit(features: number[]): string {
    let best = '?';
    let minDiff = Infinity;

    for (const [digit, template] of Object.entries(ZimukuBmpSolver.TEMPLATES)) {
      let diff = 0;
      for (let i = 0; i < features.length; i++) {
        if (features[i] !== template[i]) {
          diff++;
        }
      }

      if (diff < minDiff) {
        minDiff = diff;
        best = digit;
      }
      if (minDiff === 0) {
        break;
      }
    }

    return best;
  }
}
