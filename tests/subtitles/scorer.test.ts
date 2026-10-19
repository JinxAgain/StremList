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

  it('correctly scores /d/<id> episode-matched and collection candidates', () => {
    const query: VideoQueryMeta = {
      imdbId: 'tt17491088',
      mediaType: 'series',
      season: 4,
      episode: 1,
      title: 'The Diplomat'
    };

    const cEp1: SubtitleCandidate = {
      id: 'uhcNw2',
      provider: 'subhd',
      title: 'The Diplomat S04E01 Windsor 720p NF WEB-DL DD 5 1 H 264-playWEB',
      pageUrl: 'https://subhd.tv/a/uhcNw2',
      tags: {
        provider: 'subhd',
        lang: ['chs'],
        bilingual: true,
        fmt: ['srt', 'ass'],
        source: ['official'],
        collection: false,
        imdbMatched: true,
        episodeMatched: true,
        seasonMatched: true
      },
      rate: 3,
      downloadsCount: 329,
      score: 0
    };

    const cCol1: SubtitleCandidate = {
      id: 'EwYufh',
      provider: 'subhd',
      title: 'The.Diplomat.S04.zh.subtitles',
      pageUrl: 'https://subhd.tv/a/EwYufh',
      tags: {
        provider: 'subhd',
        lang: ['chs'],
        bilingual: true,
        fmt: ['srt'],
        source: ['official'],
        collection: true,
        imdbMatched: true,
        seasonMatched: true
      },
      rate: 0,
      downloadsCount: 249,
      score: 0
    };

    const cCol2: SubtitleCandidate = {
      id: 'pQp5mk',
      provider: 'subhd',
      title: 'The.Diplomat.S04.2160p.NF.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-KHN',
      pageUrl: 'https://subhd.tv/a/pQp5mk',
      tags: {
        provider: 'subhd',
        lang: ['chs'],
        bilingual: true,
        fmt: ['ass'],
        source: ['official'],
        collection: true,
        imdbMatched: true,
        seasonMatched: true
      },
      rate: 0,
      downloadsCount: 48,
      score: 0
    };

    const scoreEp1 = SubtitleScorer.calculateScore(cEp1, query);
    const scoreCol1 = SubtitleScorer.calculateScore(cCol1, query);
    const scoreCol2 = SubtitleScorer.calculateScore(cCol2, query);

    // Both should receive high scores (> 2500) including season match (+400) and IMDb match (+1000)
    expect(scoreEp1).toBeGreaterThanOrEqual(2800);
    expect(scoreCol1).toBeGreaterThanOrEqual(2950);
    expect(scoreCol2).toBeGreaterThanOrEqual(2950);

    const ranked = SubtitleScorer.rankCandidates([cEp1, cCol1, cCol2], query, 'bilingual', 5);
    expect(ranked.map((c) => c.id)).toContain('uhcNw2');
    expect(ranked.map((c) => c.id)).toContain('EwYufh');
    expect(ranked.map((c) => c.id)).toContain('pQp5mk');
  });
});

