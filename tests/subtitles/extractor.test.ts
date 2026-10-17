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

  it('detects and recovers raw ASS text even if misnamed as .zip', () => {
    const rawAss = Buffer.from('[Script Info]\nTitle: Test Sub\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello');
    expect(SubtitleExtractor.isRawSubtitleBuffer(rawAss)).toBe(true);
    expect(SubtitleExtractor.sniffSubtitleExtension(rawAss)).toBe('.ass');

    const result = SubtitleExtractor.extractBestSubtitle(rawAss, 'subhd_Cmr0uS.zip');
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('subhd_Cmr0uS.ass');
  });

  it('detects and recovers raw SRT text even if misnamed as .zip', () => {
    const rawSrt = Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nHello World\n');
    expect(SubtitleExtractor.isRawSubtitleBuffer(rawSrt)).toBe(true);
    expect(SubtitleExtractor.sniffSubtitleExtension(rawSrt)).toBe('.srt');

    const result = SubtitleExtractor.extractBestSubtitle(rawSrt, 'subtitle_archive.zip');
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('subtitle_archive.srt');
  });

  it('selects ASS over SRT when preferAss is true', () => {
    const files = ['Movie.chs.srt', 'Movie.chs.ass'];
    const bestNormal = SubtitleExtractor.pickBestFile(files, undefined, true, false, false);
    expect(bestNormal).toBe('Movie.chs.srt');

    const bestAss = SubtitleExtractor.pickBestFile(files, undefined, true, false, true);
    expect(bestAss).toBe('Movie.chs.ass');
  });

  it('disqualifies English-only subtitle files in pickBestFile', () => {
    const files = ['Movie.eng.srt', 'Movie.chs.srt'];
    const best = SubtitleExtractor.pickBestFile(files, undefined, true, false, false);
    expect(best).toBe('Movie.chs.srt');

    const engOnlyFiles = ['Movie.english.srt', 'Movie.fre.srt'];
    const bestEngOnly = SubtitleExtractor.pickBestFile(engOnlyFiles, undefined, true, false, false);
    // Both are non-Chinese only tags, should be penalized and if no Chinese exists, rank appropriately
    expect(bestEngOnly).not.toBeNull();
  });
});
