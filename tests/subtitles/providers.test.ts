import { describe, it, expect, vi } from 'vitest';
import {
  extractSeasonsFromText,
  isEpisodeMatch,
  extractMetaFromFilename,
  formatSubtitleInfo
} from '../../src/services/subtitles/providers/base.js';
import { SubhdProvider } from '../../src/services/subtitles/providers/subhd.js';
import { ZimukuProvider } from '../../src/services/subtitles/providers/zimuku.js';
import { SubtitleCandidate, VideoQueryMeta } from '../../src/services/subtitles/types.js';

describe('BaseProvider utilities', () => {
  it('extracts seasons from text', () => {
    expect(Array.from(extractSeasonsFromText('Show S03E01'))).toEqual([3]);
    expect(Array.from(extractSeasonsFromText('Show 第三季'))).toEqual([3]);
    expect(Array.from(extractSeasonsFromText('Show 第1-3季'))).toEqual([1, 2, 3]);
  });

  it('matches episode correctly', () => {
    const [matches, isCollection] = isEpisodeMatch('Show S02E05 1080p', 2, 5);
    expect(matches).toBe(true);
    expect(isCollection).toBe(false);
  });

  it('extracts metadata from release filename', () => {
    const meta = extractMetaFromFilename('Severance.S01E01.1080p.WEB-DL.mkv');
    expect(meta.title).toBe('Severance');
    expect(meta.season).toBe(1);
    expect(meta.episode).toBe(1);
  });

  it('formats subtitle label and filename cleanly', () => {
    const cand: SubtitleCandidate = {
      id: 'sub123',
      provider: 'subhd',
      title: 'Severance S01E01 1080p WEB-DL x264 [Bilingual]',
      pageUrl: 'http://test',
      tags: { provider: 'subhd', lang: ['chs'], bilingual: true, fmt: ['srt'], source: ['official'], collection: false, imdbMatched: true },
      rate: 5,
      downloadsCount: 100,
      score: 1000
    };
    const query: VideoQueryMeta = {
      imdbId: 'tt123',
      mediaType: 'series',
      season: 1,
      episode: 1,
      title: 'Severance'
    };
    const { label, filename } = formatSubtitleInfo(cand, query);
    expect(label).toContain('Severance · S01E01');
    expect(label).toContain('[Bilingual SubHD]');
    expect(filename).toBe('Severance.S01E01.WEB-DL.1080p.x264.[Bilingual.SubHD].srt');
  });

  it('instantiates SubhdProvider and ZimukuProvider', () => {
    const subhd = new SubhdProvider();
    const zimuku = new ZimukuProvider();
    expect(subhd.name).toBe('subhd');
    expect(zimuku.name).toBe('zimuku');
  });
});
