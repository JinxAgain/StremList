import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { SubtitleExtractor } from '../../src/services/subtitles/core/extractor.js';

describe('SubtitleExtractor', () => {
  it('extracts target episode from zip and prefers bilingual subtitle', () => {
    const zip = new AdmZip();
    zip.addFile('Show.S01E01.chs.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nEp1\n'));
    zip.addFile('Show.S01E04.chs.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nEp4 CHS\n'));
    zip.addFile('Show.S01E04.chs&eng.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nEp4 Bilingual\n'));
    const zipBuffer = zip.toBuffer();

    const result = SubtitleExtractor.extractBestSubtitle(zipBuffer, 'Show.S01.zip', 4, true, false);
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('Show.S01E04.chs&eng.srt');
  });

  it('rejects wrong episode in pickBestFile', () => {
    const files = ['Show.S01E01.srt', 'Show.S01E02.srt'];
    const best = SubtitleExtractor.pickBestFile(files, 3);
    // When requesting E03, both E01 and E02 are disqualified with -5000 points
    expect(best).toBeNull();
  });
});
