import { describe, it, expect } from 'vitest';
import { SubtitleScorer } from '../../src/services/subtitles/core/scorer.js';
import { SubtitleCandidate, VideoQueryMeta } from '../../src/services/subtitles/types.js';

describe('SubtitleScorer', () => {
  it('penalizes candidate with conflicting season number', () => {
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'series',
      season: 4,
      episode: 2
    };

    const c1: SubtitleCandidate = {
      id: '1',
      provider: 'zimuku',
      title: 'Show S04E02 1080p WEB-DL [Bilingual]',
      pageUrl: 'http://test/1',
      tags: { provider: 'zimuku', lang: ['chs'], bilingual: true, fmt: ['srt'], source: ['official'], collection: false, imdbMatched: true },
      rate: 5,
      downloadsCount: 100,
      score: 0
    };

    const c2: SubtitleCandidate = {
      id: '2',
      provider: 'zimuku',
      title: 'Show S01E02 1080p WEB-DL [Bilingual]',
      pageUrl: 'http://test/2',
      tags: { provider: 'zimuku', lang: ['chs'], bilingual: true, fmt: ['srt'], source: ['official'], collection: false, imdbMatched: true },
      rate: 5,
      downloadsCount: 100,
      score: 0
    };

    const ranked = SubtitleScorer.rankCandidates([c1, c2], query, 'bilingual', 5);
    expect(ranked[0].id).toBe('1');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('rewards season pack and bilingual preference', () => {
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'series',
      season: 1,
      episode: 5
    };

    const candPack: SubtitleCandidate = {
      id: 'pack_1',
      provider: 'subhd',
      title: 'Show S01 全集精修双语 [Bilingual]',
      pageUrl: 'http://test/pack',
      tags: { provider: 'subhd', lang: ['chs'], bilingual: true, fmt: ['srt'], source: ['refined'], collection: true, imdbMatched: true },
      rate: 5,
      downloadsCount: 1000,
      score: 0
    };

    const ranked = SubtitleScorer.rankCandidates([candPack], query, 'bilingual', 5);
    expect(ranked[0].score).toBeGreaterThan(1500);
  });
});
