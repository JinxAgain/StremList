import { describe, it, expect } from 'vitest';
import {
  matchPlayableFile,
  FileItem,
  parseSeasonFromText,
  parseSeasonEpisode
} from '../src/services/matcher/file-matcher.js';

describe('File Matcher Service', () => {
  it('selects the largest video file for movies and ignores samples or non-video files', () => {
    const files: FileItem[] = [
      { name: 'sample.mkv', size: 50 * 1024 * 1024, is_dir: false },
      { name: 'movie.sample.mp4', size: 80 * 1024 * 1024, is_dir: false },
      { name: 'Inception.2010.1080p.mkv', size: 12 * 1024 * 1024 * 1024, is_dir: false },
      { name: 'featurette.mov', size: 500 * 1024 * 1024, is_dir: false },
      { name: 'Subtitles.srt', size: 50 * 1024, is_dir: false },
      { name: 'some_folder', size: 0, is_dir: true }
    ];

    const match = matchPlayableFile(files, { type: 'movie' });
    expect(match).not.toBeNull();
    expect(match?.name).toBe('Inception.2010.1080p.mkv');
  });

  it('matches target season and episode for series using SxxExx format', () => {
    const files: FileItem[] = [
      { name: 'Breaking.Bad.S01E01.720p.mkv', size: 1024 * 1024 * 1024, is_dir: false },
      { name: 'Breaking.Bad.S01E02.720p.mkv', size: 1024 * 1024 * 1024, is_dir: false },
      { name: 'Breaking.Bad.S01E03.720p.mkv', size: 1024 * 1024 * 1024, is_dir: false },
      { name: 'Breaking.Bad.S02E01.720p.mkv', size: 1024 * 1024 * 1024, is_dir: false }
    ];

    const match = matchPlayableFile(files, { type: 'series', season: 1, episode: 2 });
    expect(match?.name).toBe('Breaking.Bad.S01E02.720p.mkv');
  });

  it('matches target episode with 1x02 or EP02 or Chinese 第2集 naming', () => {
    const files: FileItem[] = [
      { name: 'Anime 1x01 [1080p].mp4', size: 500 * 1024 * 1024, is_dir: false },
      { name: 'Anime 1x02 [1080p].mp4', size: 500 * 1024 * 1024, is_dir: false },
      { name: 'Anime EP03 [1080p].mp4', size: 500 * 1024 * 1024, is_dir: false }
    ];

    const match1 = matchPlayableFile(files, { type: 'series', season: 1, episode: 2 });
    expect(match1?.name).toBe('Anime 1x02 [1080p].mp4');

    const match2 = matchPlayableFile(files, { type: 'series', season: 1, episode: 3 });
    expect(match2?.name).toBe('Anime EP03 [1080p].mp4');
  });

  it('falls back to fileIdx or largest video if season/episode pattern is not found in filenames', () => {
    const files: FileItem[] = [
      { name: 'Episode_A.mkv', size: 400 * 1024 * 1024, is_dir: false },
      { name: 'Episode_B.mkv', size: 600 * 1024 * 1024, is_dir: false }
    ];

    const matchByIdx = matchPlayableFile(files, { type: 'series', season: 1, episode: 2, fileIdx: 0 });
    expect(matchByIdx?.name).toBe('Episode_A.mkv');

    const matchFallback = matchPlayableFile(files, { type: 'series', season: 1, episode: 5 });
    expect(matchFallback?.name).toBe('Episode_B.mkv');
  });

  it('returns null if no playable video files are found', () => {
    const files: FileItem[] = [
      { name: 'soundtrack.mp3', size: 10 * 1024 * 1024, is_dir: false },
      { name: 'instructions.txt', size: 1024, is_dir: false }
    ];

    const match = matchPlayableFile(files, { type: 'movie' });
    expect(match).toBeNull();
  });

  it('recognizes large extensionless files (> 50MB) saved by infoHash or clean title', () => {
    const files: FileItem[] = [
      { name: '8438ee05d038e9b25a268612ea624efb223db5cb', size: 2290962292, is_dir: false },
      { name: 'random_text_without_ext', size: 1024, is_dir: false }
    ];

    const match = matchPlayableFile(files, { type: 'movie' });
    expect(match).not.toBeNull();
    expect(match?.name).toBe('8438ee05d038e9b25a268612ea624efb223db5cb');
  });

  it('filters out Chinese ad promo clips and website links, selecting the real movie', () => {
    const files: FileItem[] = [
      {
        name: '【更多无水印高清电影请访问 www.HDBTHD.com】【更多无水印高清电影请访问 www.HDBTHD.com】.MKV',
        size: 636976, // 636 KB
        is_dir: false
      },
      {
        name: '最新电影发布页请访问www.BT天堂.com.mp4',
        size: 5 * 1024 * 1024,
        is_dir: false
      },
      {
        name: 'The.Fast.and.the.Furious.2001.2160p.UHD.BluRay.x265.10bit.mkv',
        size: 19 * 1024 * 1024 * 1024,
        is_dir: false
      }
    ];

    const match = matchPlayableFile(files, { type: 'movie' });
    expect(match).not.toBeNull();
    expect(match?.name).toBe('The.Fast.and.the.Furious.2001.2160p.UHD.BluRay.x265.10bit.mkv');
  });

  it('preserves full movie files even when release group branding contains a domain', () => {
    const files: FileItem[] = [
      {
        name: '【高清影视之家发布 www.HDBTHD.com】速度与激情.2001.2160p.mkv',
        size: 19 * 1024 * 1024 * 1024,
        is_dir: false
      }
    ];

    const match = matchPlayableFile(files, { type: 'movie' });
    expect(match).not.toBeNull();
    expect(match?.name).toBe('【高清影视之家发布 www.HDBTHD.com】速度与激情.2001.2160p.mkv');
  });

  it('does not reject 100MB-250MB anime or sitcom episodes containing release group domains', () => {
    const files: FileItem[] = [
      {
        name: 'Rick.and.Morty.S01E02.720p.HDTV.x264-[rarbg.to].mkv',
        size: 120 * 1024 * 1024, // 120 MB
        is_dir: false
      },
      {
        name: 'promo_trailer.mp4',
        size: 15 * 1024 * 1024, // 15 MB
        is_dir: false
      }
    ];

    const match = matchPlayableFile(files, { type: 'series', season: 1, episode: 2 });
    expect(match).not.toBeNull();
    expect(match?.name).toBe('Rick.and.Morty.S01E02.720p.HDTV.x264-[rarbg.to].mkv');
  });

  it('parses season from text correctly and rejects multi-season ranges', () => {
    expect(parseSeasonFromText('Cyberpunk Edgerunners S02 2160p NF WEB-DL')).toBe(2);
    expect(parseSeasonFromText('Show.S03E05.1080p')).toBe(3);
    expect(parseSeasonFromText('Show 2nd Season')).toBe(2);
    expect(parseSeasonFromText('Show 第3季')).toBe(3);
    expect(parseSeasonFromText('Show S01-S03 Complete')).toBeUndefined();
    expect(parseSeasonFromText('Show Season 1~2')).toBeUndefined();
  });

  it('parses season and episode for anime fansub patterns', () => {
    expect(parseSeasonEpisode('[SubsPlease] Anime - 01 (1080p).mkv')).toEqual({
      season: undefined,
      episode: 1
    });
    expect(parseSeasonEpisode('[Nekomoe] Anime [01][1080p].mkv')).toEqual({
      season: undefined,
      episode: 1
    });
    expect(parseSeasonEpisode('[Group] Anime S02 - 03v2 [720p].mkv')).toEqual({
      season: 2,
      episode: 3
    });
    expect(parseSeasonEpisode('Anime.EP04.mkv')).toEqual({
      season: undefined,
      episode: 4
    });
    expect(parseSeasonEpisode('Anime.第05话.mkv')).toEqual({
      season: undefined,
      episode: 5
    });
  });

  it('matches Cyberpunk.Edgerunners.S02E01 when target has season: undefined and title with S02', () => {
    const files: FileItem[] = [
      { name: 'Cyberpunk.Edgerunners.S01E01.1080p.mkv', size: 1024 * 1024 * 1024, is_dir: false },
      { name: 'Cyberpunk.Edgerunners.S02E01.2160p.mkv', size: 2 * 1024 * 1024 * 1024, is_dir: false },
      { name: 'Cyberpunk.Edgerunners.S02E02.2160p.mkv', size: 3 * 1024 * 1024 * 1024, is_dir: false }
    ];

    const match = matchPlayableFile(files, {
      type: 'series',
      season: undefined,
      episode: 1,
      title: 'Cyberpunk Edgerunners S02 2160p NF WEB-DL'
    });
    expect(match?.name).toBe('Cyberpunk.Edgerunners.S02E01.2160p.mkv');
  });

  it('matches S02E01 in a Season 2-only batch folder when target has season: undefined and no title', () => {
    const files: FileItem[] = [
      { name: 'Cyberpunk.Edgerunners.S02E01.mkv', size: 1024 * 1024 * 1024, is_dir: false },
      { name: 'Cyberpunk.Edgerunners.S02E02.mkv', size: 1024 * 1024 * 1024, is_dir: false }
    ];

    const match = matchPlayableFile(files, {
      type: 'series',
      season: undefined,
      episode: 1
    });
    expect(match?.name).toBe('Cyberpunk.Edgerunners.S02E01.mkv');
  });

  it('matches anime fansub filenames like SubsPlease dash format and bracket format', () => {
    const dandadanFiles: FileItem[] = [
      { name: '[SubsPlease] Dandadan - 01 (1080p).mkv', size: 1400 * 1024 * 1024, is_dir: false },
      { name: '[SubsPlease] Dandadan - 02 (1080p).mkv', size: 1400 * 1024 * 1024, is_dir: false }
    ];
    const bleachFiles: FileItem[] = [
      { name: '[Nekomoe] Bleach [01][1080p].mkv', size: 1200 * 1024 * 1024, is_dir: false },
      { name: '[Nekomoe] Bleach [02][1080p].mkv', size: 1200 * 1024 * 1024, is_dir: false }
    ];

    const match1 = matchPlayableFile(dandadanFiles, {
      type: 'series',
      season: undefined,
      episode: 1,
      title: 'Dandadan'
    });
    expect(match1?.name).toBe('[SubsPlease] Dandadan - 01 (1080p).mkv');

    const match2 = matchPlayableFile(bleachFiles, {
      type: 'series',
      season: undefined,
      episode: 2,
      title: 'Bleach'
    });
    expect(match2?.name).toBe('[Nekomoe] Bleach [02][1080p].mkv');
  });

  it('matches exact filename when target.filename is provided', () => {
    const files: FileItem[] = [
      { name: 'Show.S01E01.720p.mkv', size: 500 * 1024 * 1024, is_dir: false },
      { name: 'Show.S01E01.1080p.mkv', size: 1200 * 1024 * 1024, is_dir: false }
    ];

    const match = matchPlayableFile(files, {
      type: 'series',
      filename: 'Show.S01E01.720p.mkv'
    });
    expect(match?.name).toBe('Show.S01E01.720p.mkv');
  });
});
