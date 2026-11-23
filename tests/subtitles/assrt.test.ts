import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { AssrtProvider } from '../../src/services/subtitles/providers/assrt.js';
import { formatSubtitleInfo } from '../../src/services/subtitles/providers/base.js';
import { SubtitleScorer } from '../../src/services/subtitles/core/scorer.js';
import { AssrtSubItem, SubtitleCandidate, VideoQueryMeta } from '../../src/services/subtitles/types.js';

describe('AssrtProvider', () => {
  beforeEach(() => {
    (AssrtProvider as any).rateLimitedUntil = 0;
    (AssrtProvider as any).unhealthyDomains.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (AssrtProvider as any).rateLimitedUntil = 0;
    (AssrtProvider as any).unhealthyDomains.clear();
  });

  it('pads short keywords <= 3 chars to avoid error 101', () => {
    const provider = new AssrtProvider(undefined, 'testtoken1234567890123456789012');
    expect(provider.ensureMinQueryLength('Her', 2013)).toBe('Her 2013');
    expect(provider.ensureMinQueryLength('奥德赛', 2026)).toBe('奥德赛 2026');
    expect(provider.ensureMinQueryLength('Up')).toBe('Up subtitle');
    expect(provider.ensureMinQueryLength('The Odyssey', 2026)).toBe('The Odyssey');
  });

  it('formats ASSRT subtitle label and filename properly', () => {
    const cand: SubtitleCandidate = {
      id: '602333',
      provider: 'assrt',
      title: 'The.Odyssey.2026.1080p.BluRay.x264',
      pageUrl: 'https://assrt.net/xml/sub/602/602333.xml',
      tags: {
        provider: 'assrt',
        lang: ['chs'],
        bilingual: true,
        fmt: ['ass'],
        source: ['official'],
        collection: false,
        imdbMatched: true
      },
      rate: 4.5,
      downloadsCount: 100,
      score: 0
    };

    const formatted = formatSubtitleInfo(
      cand,
      { imdbId: 'tt1234567', mediaType: 'movie', title: 'The Odyssey', year: 2026 },
      { keepOriginalFormat: true }
    );
    expect(formatted.label).toContain('[双]');
    expect(formatted.label).toContain('[官译]');
    expect(formatted.label).toContain('[ASSRT]');
    expect(formatted.filename).toContain('[Bilingual.ASSRT].ass');
  });

  describe('4-stage strict matching filter (isStrictAssrtMatch)', () => {
    const provider = new AssrtProvider(undefined, 'testtoken1234567890123456789012');

    it('rejects prefix/substring false positives like 2001: A Space Odyssey when searching The Odyssey', () => {
      const meta: VideoQueryMeta = {
        imdbId: 'tt33764258',
        mediaType: 'movie',
        title: 'The Odyssey',
        year: 2026
      };

      const wrongMovie: AssrtSubItem = {
        id: 100001,
        native_name: '2001太空漫游 / 2001: A Space Odyssey',
        videoname: '2001.A.Space.Odyssey.1968.2160p.BluRay',
        upload_time: '2026-02-01 12:00:00',
        subtype: 'Subrip(srt)',
        lang: { langlist: { langdou: true }, desc: '双语' }
      };

      const wrongSpinOff: AssrtSubItem = {
        id: 100002,
        native_name: "Assassin's Creed Odyssey (2026)",
        videoname: 'Assassins.Creed.Odyssey.2026.1080p',
        upload_time: '2026-03-01 12:00:00',
        subtype: 'Subrip(srt)',
        lang: { langlist: { langdou: true }, desc: '双语' }
      };

      const rightMovie: AssrtSubItem = {
        id: 100003,
        native_name: '奥德赛 / The Odyssey',
        videoname: 'The.Odyssey.2026.1080p.Blu-ray.Remux',
        upload_time: '2026-11-16 07:43:00',
        subtype: 'ASS',
        lang: { langlist: { langdou: true }, desc: '双语' }
      };

      expect(provider.isStrictAssrtMatch(wrongMovie, meta).matched).toBe(false);
      expect(provider.isStrictAssrtMatch(wrongSpinOff, meta).matched).toBe(false);
      const ok = provider.isStrictAssrtMatch(rightMovie, meta);
      expect(ok.matched).toBe(true);
      expect(ok.yearMatched).toBe(true);
    });

    it('rejects older namesake movies via upload_time and explicit release year mismatch', () => {
      const meta: VideoQueryMeta = {
        imdbId: 'tt33764258',
        mediaType: 'movie',
        title: 'The Odyssey',
        year: 2026
      };

      const oldByUploadTime: AssrtSubItem = {
        id: 100004,
        native_name: '奥德赛 / The Odyssey',
        videoname: 'The.Odyssey.DVDRip.x264',
        upload_time: '2015-08-21 22:11:00',
        subtype: 'Subrip(srt)',
        lang: { langlist: { langchs: true } }
      };

      const oldByYear: AssrtSubItem = {
        id: 100005,
        native_name: '奥德赛 / The Odyssey (1997)',
        videoname: 'The.Odyssey.1997.1080p.BluRay',
        upload_time: '2026-05-01 10:00:00',
        subtype: 'Subrip(srt)',
        lang: { langlist: { langchs: true } }
      };

      expect(provider.isStrictAssrtMatch(oldByUploadTime, meta).matched).toBe(false);
      expect(provider.isStrictAssrtMatch(oldByYear, meta).matched).toBe(false);
    });

    it('preserves title-embedded numbers such as Blade Runner 2049 (2017)', () => {
      const meta: VideoQueryMeta = {
        imdbId: 'tt1856101',
        mediaType: 'movie',
        title: 'Blade Runner 2049',
        year: 2017
      };

      const matchWithYear: AssrtSubItem = {
        id: 100006,
        native_name: '银翼杀手2049 / Blade Runner 2049 (2017)',
        videoname: 'Blade.Runner.2049.2017.1080p.BluRay.x264',
        upload_time: '2018-01-10 12:00:00',
        subtype: 'ASS',
        lang: { langlist: { langdou: true } }
      };

      const matchWithoutReleaseYear: AssrtSubItem = {
        id: 100007,
        native_name: '银翼杀手2049 / Blade Runner 2049',
        videoname: 'Blade.Runner.2049.1080p.BluRay',
        upload_time: '2018-01-10 12:00:00',
        subtype: 'ASS',
        lang: { langlist: { langdou: true } }
      };

      const originalBladeRunner: AssrtSubItem = {
        id: 100008,
        native_name: '银翼杀手 / Blade Runner (1982)',
        videoname: 'Blade.Runner.1982.1080p.BluRay',
        upload_time: '2018-01-10 12:00:00',
        subtype: 'ASS',
        lang: { langlist: { langdou: true } }
      };

      expect(provider.isStrictAssrtMatch(matchWithYear, meta).matched).toBe(true);
      expect(provider.isStrictAssrtMatch(matchWithoutReleaseYear, meta).matched).toBe(true);
      expect(provider.isStrictAssrtMatch(originalBladeRunner, meta).matched).toBe(false);
    });

    it('isolates movies from TV series entries', () => {
      const movieMeta: VideoQueryMeta = {
        imdbId: 'tt1234567',
        mediaType: 'movie',
        title: 'Fargo',
        year: 1996
      };

      const tvEntry: AssrtSubItem = {
        id: 100009,
        native_name: '冰血暴 第一季 / Fargo S01E01',
        videoname: 'Fargo.S01E01.1080p.WEB-DL',
        upload_time: '2014-04-20 12:00:00',
        subtype: 'Subrip(srt)',
        lang: { langlist: { langdou: true } }
      };

      expect(provider.isStrictAssrtMatch(tvEntry, movieMeta).matched).toBe(false);
    });

    it('verifies series season/episode via filelist=1 and rejects packs lacking the target episode', () => {
      const seriesMeta: VideoQueryMeta = {
        imdbId: 'tt17491088',
        mediaType: 'series',
        title: 'The Diplomat',
        season: 4,
        episode: 3,
        year: 2023
      };

      const wrongSeason: AssrtSubItem = {
        id: 200001,
        native_name: '头号外交官 第一季 / The Diplomat S01E03',
        videoname: 'The.Diplomat.S01E03.1080p.NF.WEB-DL',
        upload_time: '2023-05-01 00:00:00',
        subtype: 'Subrip(srt)'
      };

      const incompletePack: AssrtSubItem = {
        id: 200002,
        native_name: '头号外交官 第四季全集 / The Diplomat S04',
        videoname: 'The.Diplomat.S04.1080p.NF.WEB-DL',
        upload_time: '2026-10-20 00:00:00',
        subtype: 'ASS',
        filelist: [
          { f: 'The.Diplomat.S04E01.chs.ass' },
          { f: 'The.Diplomat.S04E02.chs.ass' }
        ]
      };

      const validPack: AssrtSubItem = {
        id: 200003,
        native_name: '头号外交官 第四季 / The Diplomat S04',
        videoname: 'The.Diplomat.S04.1080p.NF.WEB-DL',
        upload_time: '2026-10-20 00:00:00',
        subtype: 'ASS',
        filelist: [
          { f: 'The.Diplomat.S04E01.chs&eng.ass' },
          { f: 'The.Diplomat.S04E02.chs&eng.ass' },
          { f: 'The.Diplomat.S04E03.chs&eng.ass' }
        ]
      };

      expect(provider.isStrictAssrtMatch(wrongSeason, seriesMeta).matched).toBe(false);
      expect(provider.isStrictAssrtMatch(incompletePack, seriesMeta).matched).toBe(false);
      const validRes = provider.isStrictAssrtMatch(validPack, seriesMeta);
      expect(validRes.matched).toBe(true);
      expect(validRes.isCollection).toBe(true);
      expect(validRes.episodeMatched).toBe(true);
    });

    it('handles PHP empty object filelist ({}), placeholder videoname, and bilingual season titles', () => {
      const inceptionMeta: VideoQueryMeta = {
        imdbId: 'tt1375666',
        mediaType: 'movie',
        title: 'Inception',
        year: 2010
      };
      const inceptionItem: any = {
        id: 679247,
        native_name: '盗梦空间',
        videoname: 'Inception.2010.1080p.BluRay.x264-REFiNED',
        upload_time: '2020-01-01 00:00:00',
        subtype: 'Subrip(srt)',
        filelist: {}
      };
      expect(provider.isStrictAssrtMatch(inceptionItem, inceptionMeta).matched).toBe(true);

      const oppenheimerMeta: VideoQueryMeta = {
        imdbId: 'tt15398776',
        mediaType: 'movie',
        title: 'Oppenheimer',
        year: 2023
      };
      const oppenheimerItem: any = {
        id: 699487,
        native_name: 'Oppenheimer.2023.IMAX.1080p.BluRay.10Bit.X265.DD.5.1-Chivaman',
        videoname: '不知道',
        upload_time: '2025-03-18 20:49:45',
        subtype: 'Subrip(srt)',
        filelist: {}
      };
      expect(provider.isStrictAssrtMatch(oppenheimerItem, oppenheimerMeta).matched).toBe(true);

      const edgerunnersMeta: VideoQueryMeta = {
        imdbId: 'tt12590266',
        mediaType: 'series',
        title: 'Cyberpunk: Edgerunners',
        season: 2,
        episode: 1,
        year: 2022
      };
      const edgerunnersItem: any = {
        id: 734039,
        native_name: '赛博朋克：边缘行者 第二季 Cyberpunk: Edgerunners Season 2 (2026)',
        videoname: '不知道',
        upload_time: '2026-10-01 12:00:00',
        subtype: 'ASS',
        filelist: {}
      };
      expect(provider.isStrictAssrtMatch(edgerunnersItem, edgerunnersMeta).matched).toBe(true);
    });

    it('preserves movie sequel numbers (2-9 / Roman II-X) without stripping or misclassifying as TV', () => {
      const toyStory2: VideoQueryMeta = {
        imdbId: 'tt0120363',
        mediaType: 'movie',
        title: 'Toy Story 2',
        year: 1999
      };
      const district9: VideoQueryMeta = {
        imdbId: 'tt1136608',
        mediaType: 'movie',
        title: 'District 9',
        year: 2009
      };
      const malcolmX: VideoQueryMeta = {
        imdbId: 'tt0104797',
        mediaType: 'movie',
        title: 'Malcolm X',
        year: 1992
      };

      expect((provider as any).buildTieredQueries(toyStory2)[0].q).toBe('Toy Story 2 1999');
      expect((provider as any).buildTieredQueries(district9)[0].q).toBe('District 9 2009');
      expect((provider as any).buildTieredQueries(malcolmX)[0].q).toBe('Malcolm X 1992');

      const ts1: AssrtSubItem = {
        id: 300001,
        native_name: '玩具总动员 / Toy Story (1999)',
        videoname: 'Toy.Story.1999.1080p',
        upload_time: '2020-01-01 00:00:00',
        subtype: 'Subrip(srt)'
      };
      const ts2: AssrtSubItem = {
        id: 300002,
        native_name: '玩具总动员2 / Toy Story 2 (1999)',
        videoname: 'Toy.Story.2.1999.1080p.BluRay',
        upload_time: '2020-01-01 00:00:00',
        subtype: 'Subrip(srt)'
      };

      expect(provider.isStrictAssrtMatch(ts1, toyStory2).matched).toBe(false);
      expect(provider.isStrictAssrtMatch(ts2, toyStory2).matched).toBe(true);
    });

    it('normalizes diacritics (Léon -> Leon) and rejects punctuation-only targets', () => {
      const leonMeta: VideoQueryMeta = {
        imdbId: 'tt0110413',
        mediaType: 'movie',
        title: 'Léon',
        year: 1994
      };
      const leonItem: AssrtSubItem = {
        id: 300003,
        native_name: '这个杀手不太冷 / Leon (1994)',
        videoname: 'Leon.1994.1080p.BluRay',
        upload_time: '2020-01-01 00:00:00',
        subtype: 'ASS'
      };
      expect(provider.isStrictAssrtMatch(leonItem, leonMeta).matched).toBe(true);

      const emptyMeta: VideoQueryMeta = {
        imdbId: 'tt0000000',
        mediaType: 'movie',
        title: '???',
        year: 2020
      };
      expect(provider.isStrictAssrtMatch(leonItem, emptyMeta).matched).toBe(false);
    });

    it('filters multi-season packs by target season and rejects packs with README.srt fallback on Season 1', () => {
      const multiSeasonMissingS02E03: AssrtSubItem = {
        id: 300004,
        native_name: 'Sample Show S01-S04',
        videoname: 'Sample.Show.S01-S04.1080p',
        upload_time: '2025-01-01 00:00:00',
        subtype: 'ASS',
        filelist: [
          { f: 'Sample.Show.S01E03.chs.ass' },
          { f: 'Sample.Show.S02E01.chs.ass' }
        ]
      };
      const s02e03Meta: VideoQueryMeta = {
        imdbId: 'tt9999999',
        mediaType: 'series',
        title: 'Sample Show',
        season: 2,
        episode: 3
      };
      expect(provider.isStrictAssrtMatch(multiSeasonMissingS02E03, s02e03Meta).matched).toBe(false);

      const s01PackWithReadme: AssrtSubItem = {
        id: 300005,
        native_name: 'Sample Show 第一季合集',
        videoname: 'Sample.Show.S01.1080p',
        upload_time: '2025-01-01 00:00:00',
        subtype: 'ASS',
        filelist: [
          { f: 'Sample.Show.S01E01.chs.ass' },
          { f: 'Sample.Show.S01E02.chs.ass' },
          { f: 'README.srt' }
        ]
      };
      const s01e03Meta: VideoQueryMeta = {
        imdbId: 'tt9999999',
        mediaType: 'series',
        title: 'Sample Show',
        season: 1,
        episode: 3
      };
      expect(provider.isStrictAssrtMatch(s01PackWithReadme, s01e03Meta).matched).toBe(false);
    });
  });

  describe('search(), download(), failover, rate limit, and checkQuota()', () => {
    it('returns [] immediately when token is missing', async () => {
      const orig = process.env.ASSRT_TOKEN;
      delete process.env.ASSRT_TOKEN;
      try {
        const provider = new AssrtProvider();
        const getSpy = vi.spyOn((provider as any).client, 'get');
        const results = await provider.search({
          imdbId: 'tt33764258',
          mediaType: 'movie',
          title: 'The Odyssey',
          year: 2026
        });
        expect(results).toEqual([]);
        expect(getSpy).not.toHaveBeenCalled();
      } finally {
        if (orig !== undefined) process.env.ASSRT_TOKEN = orig;
      }
    });

    it('performs tiered search, filters VobSub-only and non-Chinese subs, and stops on Tier 1 hit', async () => {
      const provider = new AssrtProvider(undefined, 'testtoken1234567890123456789012');
      const getSpy = vi.spyOn((provider as any).client, 'get').mockResolvedValue({
        status: 200,
        data: {
          status: 0,
          sub: {
            subs: [
              {
                id: 601001,
                native_name: '奥德赛 / The Odyssey',
                videoname: 'The.Odyssey.2026.1080p.BluRay.x264',
                upload_time: '2026-11-16 07:43:00',
                subtype: 'ASS',
                vote_score: 90,
                release_site: '官方译本',
                lang: { langlist: { langdou: true }, desc: '双语' },
                filelist: [{ f: 'The.Odyssey.2026.chs&eng.ass' }]
              },
              {
                id: 601002,
                native_name: '奥德赛 / The Odyssey',
                videoname: 'The.Odyssey.2026.1080p.BluRay',
                upload_time: '2026-11-16 07:43:00',
                subtype: 'VobSub',
                lang: { langlist: { langdou: true }, desc: '双语' }
              },
              {
                id: 601004,
                native_name: '奥德赛 / The Odyssey',
                videoname: 'The.Odyssey.2026.2160p.BluRay',
                upload_time: '2026-11-16 07:43:00',
                lang: { langlist: { langchs: true }, desc: '简体' },
                filelist: [{ f: 'The.Odyssey.2026.2160p.sup' }]
              },
              {
                id: 601005,
                native_name: '奥德赛 / The Odyssey',
                videoname: 'The.Odyssey.2026.1080p.txt',
                upload_time: '2026-11-16 07:43:00',
                lang: { langlist: { langchs: true }, desc: '简体' },
                filelist: {}
              },
              {
                id: 601006,
                native_name: '奥德赛 / The Odyssey',
                videoname: 'The.Odyssey.2026.2160p.PGS',
                upload_time: '2026-11-16 07:43:00',
                subtype: 'PGS',
                lang: { langlist: { langchs: true }, desc: '简体' },
                filelist: {}
              },
              {
                id: 601007,
                native_name: '奥德赛 / The Odyssey',
                videoname: 'The.Odyssey.2026.1080p',
                upload_time: '2026-11-16 07:43:00',
                subtype: 'ASS',
                lang: { langlist: { langchs: true }, desc: '简体' },
                filelist: [{ f: 'The.Odyssey.2026.1080p.sup' }]
              },
              {
                id: 601003,
                native_name: '奥德赛 / The Odyssey',
                videoname: 'The.Odyssey.2026.1080p.English',
                upload_time: '2026-11-16 07:43:00',
                subtype: 'Subrip(srt)',
                lang: { langlist: { langeng: true }, desc: '英' }
              }
            ]
          }
        }
      });

      const candidates = await provider.search({
        imdbId: 'tt33764258',
        mediaType: 'movie',
        title: 'The Odyssey',
        year: 2026,
        filename: 'The.Odyssey.2026.1080p.BluRay.mkv'
      });

      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(getSpy.mock.calls[0][1]?.params).toMatchObject({
        q: 'The Odyssey 2026',
        cnt: 15,
        filelist: 1
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe('601001');
      expect(candidates[0].provider).toBe('assrt');
      expect(candidates[0].rate).toBe(4.5);
      expect(candidates[0].tags.bilingual).toBe(true);
      expect(candidates[0].tags.fmt).toContain('ass');
      expect(candidates[0].tags.source).toContain('official');
    });

    it('falls back to Tier 2 is_file=1 query when Tier 1 returns empty', async () => {
      const provider = new AssrtProvider(undefined, 'testtoken1234567890123456789012');
      const getSpy = vi
        .spyOn((provider as any).client, 'get')
        .mockResolvedValueOnce({
          status: 200,
          data: { status: 0, sub: { subs: [] } }
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 0,
            sub: {
              subs: [
                {
                  id: 602001,
                  native_name: '奥德赛 / The Odyssey',
                  videoname: 'The.Odyssey.2026.1080p.Blu-ray.Remux-CiNEPHiLES',
                  upload_time: '2026-11-16 08:00:00',
                  subtype: 'Subrip(srt)',
                  lang: { langlist: { langchs: true }, desc: '简体' }
                }
              ]
            }
          }
        });

      const candidates = await provider.search({
        imdbId: 'tt33764258',
        mediaType: 'movie',
        title: 'The Odyssey',
        year: 2026,
        filename: 'The.Odyssey.2026.1080p.Blu-ray.Remux-CiNEPHiLES.mkv'
      });

      expect(getSpy).toHaveBeenCalledTimes(2);
      expect(getSpy.mock.calls[1][1]?.params).toMatchObject({
        q: 'The.Odyssey.2026.1080p.Blu-ray.Remux-CiNEPHiLES',
        is_file: 1,
        filelist: 1
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe('602001');
    });

    it('triggers 30900 quota cooldown and applies scorer penalty', async () => {
      const provider = new AssrtProvider(undefined, 'testtoken1234567890123456789012');
      vi.spyOn((provider as any).client, 'get').mockResolvedValue({
        status: 503,
        data: { status: 30900, errmsg: 'you are exceeding request limits' }
      });

      const res = await provider.search({
        imdbId: 'tt33764258',
        mediaType: 'movie',
        title: 'The Odyssey',
        year: 2026
      });
      expect(res).toEqual([]);
      expect(AssrtProvider.isRateLimited()).toBe(true);

      const cand: SubtitleCandidate = {
        id: '601001',
        provider: 'assrt',
        title: 'The Odyssey 2026',
        pageUrl: 'https://assrt.net/xml/sub/601/601001.xml',
        tags: { provider: 'assrt', lang: ['chs'], bilingual: true, fmt: ['srt'], source: [], collection: false, imdbMatched: true },
        rate: 4,
        downloadsCount: 0,
        score: 0
      };
      const penalized = SubtitleScorer.calculateScore(cand, { imdbId: 'tt33764258', mediaType: 'movie', title: 'The Odyssey', year: 2026 });
      (AssrtProvider as any).rateLimitedUntil = 0;
      const normal = SubtitleScorer.calculateScore(cand, { imdbId: 'tt33764258', mediaType: 'movie', title: 'The Odyssey', year: 2026 });
      expect(normal - penalized).toBe(2000);
    });

    it('fails over to backup domain api.makedie.me when primary api.assrt.net fails', async () => {
      const provider = new AssrtProvider(undefined, 'testtoken1234567890123456789012');
      const getSpy = vi
        .spyOn((provider as any).client, 'get')
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 0,
            sub: {
              subs: [
                {
                  id: 603001,
                  native_name: '奥德赛 / The Odyssey',
                  videoname: 'The.Odyssey.2026.1080p',
                  upload_time: '2026-11-16 09:00:00',
                  subtype: 'Subrip(srt)',
                  lang: { langlist: { langchs: true } }
                }
              ]
            }
          }
        });

      const candidates = await provider.search({
        imdbId: 'tt33764258',
        mediaType: 'movie',
        title: 'The Odyssey',
        year: 2026
      });

      expect(getSpy.mock.calls[0][0]).toContain('https://api.assrt.net/v1/sub/search');
      expect(getSpy.mock.calls[1][0]).toContain('http://api.makedie.me/v1/sub/search');
      expect(candidates).toHaveLength(1);
    });

    it('fails over when primary returns non-JSON HTML and preserves full native_name when videoname is placeholder', async () => {
      const provider = new AssrtProvider(undefined, 'testtoken1234567890123456789012');
      const getSpy = vi
        .spyOn((provider as any).client, 'get')
        .mockResolvedValueOnce({
          status: 403,
          data: '<html><body>Blocked</body></html>'
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 0,
            sub: {
              subs: [
                {
                  id: 603002,
                  native_name: '奥德赛 / The Odyssey 2026 1080p BluRay',
                  videoname: '不知道',
                  upload_time: '2026-11-16 09:00:00',
                  subtype: 'Subrip(srt)',
                  lang: { langlist: { langchs: true } }
                }
              ]
            }
          }
        });

      const candidates = await provider.search({
        imdbId: 'tt33764258',
        mediaType: 'movie',
        title: 'The Odyssey',
        year: 2026
      });

      expect(getSpy.mock.calls[1][0]).toContain('http://api.makedie.me/v1/sub/search');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].title).toBe('奥德赛 / The Odyssey 2026 1080p BluRay');
    });

    it('rejects HTML/JSON error payloads from onthefly, disambiguates seasons in download(), and isolates archive CDN errors', async () => {
      const provider = new AssrtProvider(undefined, 'testtoken1234567890123456789012');
      const cand: SubtitleCandidate = {
        id: '604999',
        provider: 'assrt',
        title: 'Sample Show S01-S02',
        pageUrl: 'https://assrt.net/xml/sub/604/604999.xml',
        tags: { provider: 'assrt', lang: ['chs'], bilingual: true, fmt: ['ass'], source: [], collection: true, imdbMatched: true },
        rate: 4,
        downloadsCount: 10,
        score: 0
      };

      const zip = new AdmZip();
      zip.addFile('Sample.Show.S02E03.ass', Buffer.from('[Script Info]\nTitle: S02E03\n'));
      const zipBuf = zip.toBuffer();

      // Case 1: filters by season (picks S02E03, not S01E03) and falls back to archive when onthefly returns HTML 200
      const spy1 = vi
        .spyOn((provider as any).client, 'get')
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 0,
            sub: {
              subs: [
                {
                  id: 604999,
                  filename: 'Sample.Show.zip',
                  url: 'https://file0.assrt.net/download/604999/Sample.Show.zip?api=1',
                  filelist: [
                    { f: 'Sample.Show.S01E03.chs.ass', url: 'https://file0.assrt.net/onthefly/604999/-/1/s1e3.ass' },
                    { f: 'Sample.Show.S02E03.chs.ass', url: 'https://file0.assrt.net/onthefly/604999/-/2/s2e3.ass' }
                  ]
                }
              ]
            }
          }
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'text/html' },
          data: Buffer.from('<!DOCTYPE html><html><body>Temporary CDN Error</body></html>')
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/zip' },
          data: zipBuf
        });

      const dl1 = await provider.download(cand, { episode: 3, season: 2 });
      expect(spy1.mock.calls[1][0]).toBe('https://file0.assrt.net/onthefly/604999/-/2/s2e3.ass');
      expect(spy1.mock.calls[2][0]).toBe('https://file0.assrt.net/download/604999/Sample.Show.zip?api=1');
      expect(dl1?.filename).toBe('Sample.Show.zip');
      spy1.mockRestore();

      // Case 2: archive CDN network error does NOT mark api.assrt.net unhealthy
      const spy2 = vi
        .spyOn((provider as any).client, 'get')
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 0,
            sub: {
              subs: [
                {
                  id: 604999,
                  filename: 'Sample.Show.zip',
                  url: 'https://file0.assrt.net/download/604999/Sample.Show.zip?api=1'
                }
              ]
            }
          }
        })
        .mockRejectedValueOnce(new Error('ETIMEDOUT'));

      const dl2 = await provider.download(cand, { episode: 3, season: 2 });
      expect(dl2).toBeNull();
      expect(spy2).toHaveBeenCalledTimes(2);
      expect(AssrtProvider.isDomainHealthy('https://api.assrt.net')).toBe(true);
      spy2.mockRestore();

      // Case 3: onthefly content verification rejects untagged English-only .srt and selects verified bilingual .ass
      const engOnlySrt = Buffer.from(
        '1\n00:00:01,000 --> 00:00:03,000\nHello Michael.\n\n2\n00:00:04,000 --> 00:00:06,000\nGood morning.\n',
        'utf-8'
      );
      const biAss = Buffer.from(
        [
          '[Script Info]',
          'ScriptType: v4.00+',
          '[Events]',
          'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
          'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,你好迈克尔\\NHello Michael.',
          'Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,早上好\\NGood morning.',
          'Dialogue: 0,0:00:07.00,0:00:09.00,Default,,0,0,0,,回头见\\NSee you later.'
        ].join('\n'),
        'utf-8'
      );
      const spy3 = vi
        .spyOn((provider as any).client, 'get')
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 0,
            sub: {
              subs: [
                {
                  id: 604999,
                  lang: { langlist: { langdou: true }, desc: '双语' },
                  filelist: [
                    { f: 'Sample.Show.S02E03.srt', url: 'https://file0.assrt.net/onthefly/604999/-/1/s2e3.srt' },
                    { f: 'Sample.Show.S02E03.ass', url: 'https://file0.assrt.net/onthefly/604999/-/2/s2e3.ass' },
                    { f: 'Sample.Show.S02E03.chs.srt', url: 'https://file0.assrt.net/onthefly/604999/-/3/s2e3.chs.srt' }
                  ]
                }
              ]
            }
          }
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'text/plain' },
          data: engOnlySrt
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'text/plain' },
          data: biAss
        });

      const dl3 = await provider.download(cand, { episode: 3, season: 2, preferBilingual: true, preferAss: false });
      expect(dl3?.filename).toBe('Sample.Show.S02E03.ass');
      expect(dl3?.buffer.toString('utf-8')).toContain('你好迈克尔');
      spy3.mockRestore();
    });

    it('prioritizes onthefly filelist direct download and falls back to full archive url', async () => {
      const provider = new AssrtProvider(undefined, 'testtoken1234567890123456789012');
      const assContent = Buffer.from('[Script Info]\nTitle: Episode 2\n[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello World\n', 'utf-8');

      const cand: SubtitleCandidate = {
        id: '604001',
        provider: 'assrt',
        title: 'Show S01',
        pageUrl: 'https://assrt.net/xml/sub/604/604001.xml',
        tags: { provider: 'assrt', lang: ['chs'], bilingual: true, fmt: ['ass'], source: [], collection: true, imdbMatched: true },
        rate: 4,
        downloadsCount: 10,
        score: 0
      };

      // Case 1: filelist onthefly succeeds directly
      const spy1 = vi
        .spyOn((provider as any).client, 'get')
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 0,
            sub: {
              subs: [
                {
                  id: 604001,
                  filename: 'Show.S01.rar',
                  url: 'https://file0.assrt.net/download/604001/Show.S01.rar?api=1',
                  filelist: [
                    { f: 'Show.S01E01.chs&eng.ass', url: 'https://file0.assrt.net/onthefly/604001/-/1/Show.S01E01.ass' },
                    { f: 'Show.S01E02.chs&eng.ass', url: 'https://file0.assrt.net/onthefly/604001/-/2/Show.S01E02.ass' }
                  ]
                }
              ]
            }
          }
        })
        .mockResolvedValueOnce({
          status: 200,
          data: assContent
        });

      const dl1 = await provider.download(cand, { episode: 2, preferBilingual: true, preferAss: true });
      expect(spy1).toHaveBeenCalledTimes(2);
      expect(spy1.mock.calls[1][0]).toBe('https://file0.assrt.net/onthefly/604001/-/2/Show.S01E02.ass');
      expect(dl1?.filename).toBe('Show.S01E02.chs&eng.ass');
      expect(dl1?.buffer.toString('utf-8')).toContain('Episode 2');

      spy1.mockRestore();

      // Case 2: onthefly fails, falls back to full archive url
      const zip = new AdmZip();
      zip.addFile('Show.S01E02.srt', Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nFallback Zip Subtitle\n'));
      const zipBuf = zip.toBuffer();

      const spy2 = vi
        .spyOn((provider as any).client, 'get')
        .mockResolvedValueOnce({
          status: 200,
          data: {
            status: 0,
            sub: {
              subs: [
                {
                  id: 604001,
                  filename: 'Show.S01.zip',
                  url: 'https://file0.assrt.net/download/604001/Show.S01.zip?api=1',
                  filelist: [
                    { f: 'Show.S01E02.chs&eng.ass', url: 'https://file0.assrt.net/onthefly/604001/-/2/Show.S01E02.ass' }
                  ]
                }
              ]
            }
          }
        })
        .mockResolvedValueOnce({ status: 404, data: Buffer.alloc(0) })
        .mockResolvedValueOnce({ status: 200, data: zipBuf, headers: {} });

      const dl2 = await provider.download(cand, { episode: 2 });
      expect(spy2).toHaveBeenCalledTimes(3);
      expect(spy2.mock.calls[2][0]).toBe('https://file0.assrt.net/download/604001/Show.S01.zip?api=1');
      expect(dl2?.filename).toBe('Show.S01.zip');
      expect(dl2?.buffer.length).toBe(zipBuf.length);
    });

    it('checks user quota, fails over on 5xx, and surfaces invalid token errors', async () => {
      const mockGet = vi
        .fn()
        .mockResolvedValueOnce({ status: 502, data: 'Bad Gateway' })
        .mockResolvedValueOnce({
          status: 200,
          data: { status: 0, user: { result: 'succeed', action: 'quota', quota: 20 } }
        })
        .mockResolvedValueOnce({
          status: 400,
          data: { status: 20001, errmsg: 'invalid token' }
        });

      vi.spyOn(axios, 'create').mockReturnValue({
        defaults: {},
        get: mockGet
      } as any);

      const ok = await AssrtProvider.checkQuota('validtoken1234567890123456789012');
      expect(ok).toEqual({ success: true, quota: 20, status: 0, message: 'OK' });
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet.mock.calls[1][0]).toContain('http://api.makedie.me/v1/user/quota');

      const bad = await AssrtProvider.checkQuota('badtoken');
      expect(bad.success).toBe(false);
      expect(bad.status).toBe(20001);
      expect(bad.message).toContain('Invalid ASSRT token');
    });
  });
});
