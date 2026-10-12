import iconv from 'iconv-lite';

export class SubtitleCleaner {
  private static readonly CHARSET_ENCODINGS = [
    'utf-8',
    'gb18030',
    'gbk',
    'big5',
    'utf-16le',
    'utf-16be',
    'latin1'
  ];

  public static detectAndDecode(rawBytes: Buffer): { text: string; encoding: string } {
    if (!rawBytes || rawBytes.length === 0) {
      return { text: '', encoding: 'utf-8' };
    }

    // Check BOM headers explicitly
    if (rawBytes.length >= 3 && rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf) {
      return {
        text: rawBytes.subarray(3).toString('utf-8'),
        encoding: 'utf-8-sig'
      };
    }
    if (rawBytes.length >= 2 && rawBytes[0] === 0xff && rawBytes[1] === 0xfe) {
      return {
        text: iconv.decode(rawBytes.subarray(2), 'utf-16le'),
        encoding: 'utf-16le'
      };
    }
    if (rawBytes.length >= 2 && rawBytes[0] === 0xfe && rawBytes[1] === 0xff) {
      return {
        text: iconv.decode(rawBytes.subarray(2), 'utf-16be'),
        encoding: 'utf-16be'
      };
    }

    // Check UTF-8 first
    try {
      const decodedUtf8 = rawBytes.toString('utf-8');
      // If no replacement characters (0xFFFD), UTF-8 is valid
      if (!decodedUtf8.includes('\ufffd') && !decodedUtf8.includes('\x00')) {
        return { text: decodedUtf8, encoding: 'utf-8' };
      }
    } catch {
      // Fall through to other encodings
    }

    for (const enc of this.CHARSET_ENCODINGS) {
      try {
        if (!iconv.encodingExists(enc)) continue;
        const decoded = iconv.decode(rawBytes, enc);
        if (decoded.includes('\x00') && !enc.startsWith('utf-16')) {
          continue;
        }
        if (!decoded.includes('\ufffd')) {
          return { text: decoded, encoding: enc };
        }
      } catch {
        continue;
      }
    }

    // Fallback: decode utf-8 with lossy replace
    return { text: rawBytes.toString('utf-8'), encoding: 'utf-8-fallback' };
  }

  public static normalizeToUtf8Srt(rawBytes: Buffer, filename = ''): Buffer {
    const { text } = this.detectAndDecode(rawBytes);
    const lowerName = filename.toLowerCase();

    let cleanedSrt = '';
    if (lowerName.endsWith('.ass') || lowerName.endsWith('.ssa') || text.includes('[Script Info]') || text.includes('[Events]')) {
      cleanedSrt = this.assToSrt(text);
    } else if (lowerName.endsWith('.vtt') || text.trim().startsWith('WEBVTT')) {
      cleanedSrt = this.vttToSrt(text);
    } else {
      cleanedSrt = this.sanitizeSrt(text);
    }

    return Buffer.from(cleanedSrt, 'utf-8');
  }

  public static assTimeToSrtTime(assTime: string): string {
    const parts = assTime.trim().split(':');
    let hours = 0;
    let minutes = 0;
    let secondsPart = '00.00';

    if (parts.length === 2) {
      minutes = parseInt(parts[0], 10) || 0;
      secondsPart = parts[1];
    } else if (parts.length >= 3) {
      hours = parseInt(parts[0], 10) || 0;
      minutes = parseInt(parts[1], 10) || 0;
      secondsPart = parts[2];
    } else {
      return '00:00:00,000';
    }

    let secStr = '00';
    let fracStr = '00';
    if (secondsPart.includes('.')) {
      [secStr, fracStr] = secondsPart.split('.', 2);
    } else if (secondsPart.includes(',')) {
      [secStr, fracStr] = secondsPart.split(',', 2);
    } else {
      secStr = secondsPart;
    }

    const seconds = parseInt(secStr, 10) || 0;
    let millis = 0;
    if (fracStr.length === 1) {
      millis = parseInt(fracStr, 10) * 100;
    } else if (fracStr.length === 2) {
      millis = parseInt(fracStr, 10) * 10;
    } else if (fracStr.length >= 3) {
      millis = parseInt(fracStr.slice(0, 3), 10);
    }

    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
  }

  public static timeStrToSeconds(srtTime: string): number {
    try {
      const [timePart, millisPart] = srtTime.split(',');
      const [h, m, s] = timePart.split(':').map(Number);
      return h * 3600 + m * 60 + s + (parseInt(millisPart, 10) || 0) / 1000.0;
    } catch {
      return 0.0;
    }
  }

  public static cleanDialogueText(rawText: string): string {
    let text = rawText;

    // Remove drawing commands {\p1}...{\p0}
    text = text.replace(/\{\\p[1-9]\}.*?\{\\p0\}/gis, '');
    if (/\{\\p[1-9]\}/i.test(text)) {
      return '';
    }

    // Remove override tags like {\pos(x,y)}, {\b1}, etc.
    let cleaned = text.replace(/\{[^}]*\}/g, '');

    // Normalize escaped line breaks
    cleaned = cleaned.replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');

    // Strip HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, '');

    // Clean whitespace and filter empty lines
    const lines = cleaned
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    return lines.join('\n');
  }

  public static assToSrt(assContent: string): string {
    const lines = assContent.split(/\r?\n/);
    let inEvents = false;
    let formatCols: string[] | null = null;
    let startIdx = 1;
    let endIdx = 2;
    let textIdx = 9;

    const cues: Array<{
      startSec: number;
      srtStart: string;
      srtEnd: string;
      text: string;
    }> = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.toLowerCase() === '[events]') {
        inEvents = true;
        continue;
      } else if (line.startsWith('[') && inEvents) {
        break;
      }

      if (inEvents) {
        if (line.toLowerCase().startsWith('format:')) {
          const rawCols = line.split(':', 2)[1];
          formatCols = rawCols.split(',').map((c) => c.trim().toLowerCase());
          const sIdx = formatCols.indexOf('start');
          const eIdx = formatCols.indexOf('end');
          const tIdx = formatCols.indexOf('text');
          if (sIdx !== -1) startIdx = sIdx;
          if (eIdx !== -1) endIdx = eIdx;
          if (tIdx !== -1) textIdx = tIdx;
          continue;
        }

        if (line.toLowerCase().startsWith('dialogue:')) {
          const rawValues = line.substring(line.indexOf(':') + 1).trim();
          const numExpected = formatCols ? formatCols.length : textIdx + 1;

          // Split only up to textIdx columns
          const cols: string[] = [];
          let current = rawValues;
          for (let i = 0; i < numExpected - 1; i++) {
            const commaPos = current.indexOf(',');
            if (commaPos === -1) {
              cols.push(current);
              current = '';
              break;
            }
            cols.push(current.substring(0, commaPos).trim());
            current = current.substring(commaPos + 1).trim();
          }
          cols.push(current);

          if (cols.length > Math.max(startIdx, endIdx)) {
            const rawStart = cols[startIdx];
            const rawEnd = cols[endIdx];
            const rawText = cols[textIdx] ?? '';

            const cleanText = this.cleanDialogueText(rawText);
            if (!cleanText) continue;

            const srtStart = this.assTimeToSrtTime(rawStart);
            const srtEnd = this.assTimeToSrtTime(rawEnd);
            const startSec = this.timeStrToSeconds(srtStart);

            cues.push({ startSec, srtStart, srtEnd, text: cleanText });
          }
        }
      }
    }

    cues.sort((a, b) => a.startSec - b.startSec);

    const outputBlocks = cues.map(
      (cue, idx) => `${idx + 1}\n${cue.srtStart} --> ${cue.srtEnd}\n${cue.text}\n`
    );

    return outputBlocks.join('\n').trim() + '\n';
  }

  public static vttToSrt(vttContent: string): string {
    const lines = vttContent.replace(/\r\n/g, '\n').split('\n');
    const filteredLines: string[] = [];
    let skipHeader = true;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (skipHeader) {
        if (line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
          continue;
        }
        if (!line) {
          skipHeader = false;
          continue;
        }
      }
      filteredLines.push(rawLine);
    }

    let text = filteredLines.join('\n');

    // Convert standard 00:01:23.450 -> 00:01:23,450
    text = text.replace(
      /(\d{2}:\d{2}:\d{2})\.(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2})\.(\d{3})/g,
      '$1,$2 --> $3,$4'
    );

    // Convert short 01:23.450 -> 00:01:23,450
    text = text.replace(
      /(?<!:)(\b\d{2}:\d{2})\.(\d{3})\s+-->\s+(\b\d{2}:\d{2})\.(\d{3})/g,
      '00:$1,$2 --> 00:$3,$4'
    );

    return this.sanitizeSrt(text);
  }

  public static sanitizeSrt(srtContent: string): string {
    const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.trim().split(/\n\s*\n/);

    const cues: Array<{
      startSec: number;
      srtStart: string;
      srtEnd: string;
      text: string;
    }> = [];

    const timestampRe = /(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})/;

    for (const block of blocks) {
      const lines = block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) continue;

      let timeLineIdx = -1;
      let match: RegExpMatchArray | null = null;

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(timestampRe);
        if (m) {
          timeLineIdx = i;
          match = m;
          break;
        }
      }

      if (!match || timeLineIdx === -1) continue;

      const rawStart = match[1];
      const rawEnd = match[2];
      const srtStart = this.assTimeToSrtTime(rawStart);
      const srtEnd = this.assTimeToSrtTime(rawEnd);

      const textLines = lines.slice(timeLineIdx + 1);
      const cleanText = this.cleanDialogueText(textLines.join('\n'));
      if (!cleanText) continue;

      const startSec = this.timeStrToSeconds(srtStart);
      cues.push({ startSec, srtStart, srtEnd, text: cleanText });
    }

    cues.sort((a, b) => a.startSec - b.startSec);

    const outputBlocks = cues.map(
      (cue, idx) => `${idx + 1}\n${cue.srtStart} --> ${cue.srtEnd}\n${cue.text}\n`
    );

    return outputBlocks.join('\n').trim() + '\n';
  }
}
