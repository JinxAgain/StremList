import { describe, it, expect } from 'vitest';
import { VideoQueryMeta, SubtitleTags, SubtitleCandidate } from '../../src/services/subtitles/types.js';

describe('VideoQueryMeta', () => {
  it('correctly structures video query metadata', () => {
    const meta: VideoQueryMeta = {
      imdbId: 'tt0903747',
      mediaType: 'series',
      season: 1,
      episode: 2,
      title: 'Breaking Bad',
      year: 2008,
      filename: 'Breaking.Bad.S01E02.1080p.mkv'
    };
    expect(meta.mediaType).toBe('series');
    expect(meta.season).toBe(1);
    expect(meta.episode).toBe(2);
    expect(meta.title).toBe('Breaking Bad');
  });

  it('correctly structures subtitle candidate and tags', () => {
    const tags: SubtitleTags = {
      provider: 'zimuku',
      lang: ['chs'],
      bilingual: true,
      fmt: ['srt'],
      source: ['official'],
      collection: false,
      imdbMatched: true,
      episodeMatched: true,
      seasonMatched: true
    };
    const candidate: SubtitleCandidate = {
      id: 'sub_123',
      provider: 'zimuku',
      title: 'Sample Subtitle',
      pageUrl: 'https://zmk.pw/detail/123.html',
      tags,
      rate: 4.5,
      downloadsCount: 500,
      score: 1500
    };
    expect(candidate.tags.bilingual).toBe(true);
    expect(candidate.tags.episodeMatched).toBe(true);
    expect(candidate.tags.seasonMatched).toBe(true);
    expect(candidate.score).toBe(1500);
  });
});
