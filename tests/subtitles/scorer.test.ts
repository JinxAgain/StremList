import { describe, it, expect } from 'vitest';
import { SubtitleScorer } from '../../src/services/subtitles/core/scorer.js';
import { SubhdProvider } from '../../src/services/subtitles/providers/subhd.js';
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

  it('penalizes SubHD candidates when rate-limited', () => {
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'movie',
      title: 'Movie'
    };

    const cSubhd: SubtitleCandidate = {
      id: 'subhd_1',
      provider: 'subhd',
      title: 'Movie 1080p WEB-DL [Bilingual]',
      pageUrl: 'http://test/subhd',
      tags: { provider: 'subhd', lang: ['chs'], bilingual: true, fmt: ['srt'], source: ['official'], collection: false, imdbMatched: true },
      rate: 5,
      downloadsCount: 100,
      score: 0
    };

    const normalScore = SubtitleScorer.calculateScore(cSubhd, query);

    // Mock rate limit
    SubhdProvider.markRateLimited(60, 'test');

    const rateLimitedScore = SubtitleScorer.calculateScore(cSubhd, query);
    expect(normalScore - rateLimitedScore).toBe(2000);

    // Reset rate limit
    (SubhdProvider as any).rateLimitedUntil = 0;
  });

  it('penalizes SUP-only bitmap subtitles', () => {
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'movie',
      title: 'Movie'
    };

    const cSrt: SubtitleCandidate = {
      id: '1',
      provider: 'zimuku',
      title: 'Movie 1080p',
      pageUrl: 'http://test/1',
      tags: { provider: 'zimuku', lang: ['chs'], bilingual: true, fmt: ['srt'], source: [], collection: false, imdbMatched: true },
      rate: 0,
      downloadsCount: 0,
      score: 0
    };

    const cSup: SubtitleCandidate = {
      id: '2',
      provider: 'zimuku',
      title: 'Movie 1080p',
      pageUrl: 'http://test/2',
      tags: { provider: 'zimuku', lang: ['chs'], bilingual: true, fmt: ['sup'], source: [], collection: false, imdbMatched: true },
      rate: 0,
      downloadsCount: 0,
      score: 0
    };

    const srtScore = SubtitleScorer.calculateScore(cSrt, query);
    const supScore = SubtitleScorer.calculateScore(cSup, query);
    expect(srtScore - supScore).toBeGreaterThanOrEqual(2000);
  });

  it('scores AI and machine translation sources correctly', () => {
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'movie',
      title: 'Movie'
    };

    const cBase: SubtitleCandidate = {
      id: '0',
      provider: 'zimuku',
      title: 'Movie',
      pageUrl: '',
      tags: { provider: 'zimuku', lang: ['chs'], bilingual: true, fmt: ['srt'], source: [], collection: false, imdbMatched: false },
      rate: 0,
      downloadsCount: 0,
      score: 0
    };

    const cOfficial = { ...cBase, id: '1', tags: { ...cBase.tags, source: ['official'] } };
    const cAi = { ...cBase, id: '2', tags: { ...cBase.tags, source: ['ai'] } };
    const cMachine = { ...cBase, id: '3', tags: { ...cBase.tags, source: ['machine'] } };

    const baseScore = SubtitleScorer.calculateScore(cBase, query);
    const officialScore = SubtitleScorer.calculateScore(cOfficial, query);
    const aiScore = SubtitleScorer.calculateScore(cAi, query);
    const machineScore = SubtitleScorer.calculateScore(cMachine, query);

    expect(officialScore - baseScore).toBe(100);
    expect(aiScore - baseScore).toBe(40);
    expect(baseScore - machineScore).toBe(50);
  });
});
