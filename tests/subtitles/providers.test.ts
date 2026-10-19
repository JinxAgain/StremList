import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  extractSeasonsFromText,
  isEpisodeMatch,
  extractMetaFromFilename,
  formatSubtitleInfo,
  parseSourceTagsFromText,
  parseLangAndBilingualFromText,
  hasChineseSubtitle,
  extractReleaseTags
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

  it('matches episode correctly and handles episode ranges', () => {
    const [matches, isCollection] = isEpisodeMatch('Show S02E05 1080p', 2, 5);
    expect(matches).toBe(true);
    expect(isCollection).toBe(false);

    // Episode range tests
    const [rangeMatch1, isCol1] = isEpisodeMatch('Show S01E01-E03 1080p', 1, 2);
    expect(rangeMatch1).toBe(true);
    expect(isCol1).toBe(true);

    const [rangeMatch2, isCol2] = isEpisodeMatch('Show 第1-3集', 1, 3);
    expect(rangeMatch2).toBe(true);
    expect(isCol2).toBe(true);

    const [rangeMatch3] = isEpisodeMatch('Show S01E01-03 1080p', 1, 4);
    expect(rangeMatch3).toBe(false);

    // tt0434706 (Monster 2004) anime full pack tests
    const [monsterPack1, isMonsterCol1] = isEpisodeMatch('怪物[全74集] Monster (2004) BD简体中文字幕 - 炎之川', 1, 12);
    expect(monsterPack1).toBe(true);
    expect(isMonsterCol1).toBe(true);

    const [monsterPack2, isMonsterCol2] = isEpisodeMatch('怪物 官方简繁字幕 MONSTER (2004) 官方字幕', 1, 12);
    expect(monsterPack2).toBe(true);
    expect(isMonsterCol2).toBe(true);

    const [monsterRar, isMonsterRarCol] = isEpisodeMatch('怪物 MONSTER (2004).rar', 1, 12);
    expect(monsterRar).toBe(true);
    expect(isMonsterRarCol).toBe(true);

    const [monsterChs, isMonsterChsCol] = isEpisodeMatch('怪物.Monster.2004.(全72集)Chs', 1, 12);
    expect(monsterChs).toBe(true);
    expect(isMonsterChsCol).toBe(true);

    // Season 2 query should not match Season 1 / unversioned pack
    const [monsterS2] = isEpisodeMatch('怪物[全74集] Monster (2004)', 2, 12);
    expect(monsterS2).toBe(false);
  });

  it('prioritizes meta.imdbId first for Zimuku Season 1 queries', () => {
    const zimuku = new ZimukuProvider();
    const queries = (zimuku as any).buildQueries({
      mediaType: 'series',
      imdbId: 'tt0434706',
      title: 'Monster',
      year: 2004,
      season: 1,
      episode: 12
    });
    expect(queries[0]).toBe('tt0434706');
    expect(queries).toContain('Monster S01');
    expect(queries).toContain('Monster 第一季');
  });

  it('parses source tags, lang tags, and checks hasChineseSubtitle', () => {
    expect(parseSourceTagsFromText('官方字幕 AI润色 机翻')).toEqual(['official', 'ai', 'machine']);

    const tags1 = { lang: [], bilingual: false };
    parseLangAndBilingualFromText('中英双语 简体中字', tags1);
    expect(tags1.bilingual).toBe(true);
    expect(tags1.lang).toContain('chs');
    expect(hasChineseSubtitle(tags1)).toBe(true);

    const tagsUnderscoreChs = { lang: [], bilingual: false };
    parseLangAndBilingualFromText('Movie.chs_eng.1080p', tagsUnderscoreChs);
    expect(tagsUnderscoreChs.bilingual).toBe(true);
    expect(tagsUnderscoreChs.lang).toContain('chs');

    const tagsUnderscoreCht = { lang: [], bilingual: false };
    parseLangAndBilingualFromText('Movie.cht_eng.1080p', tagsUnderscoreCht);
    expect(tagsUnderscoreCht.bilingual).toBe(true);
    expect(tagsUnderscoreCht.lang).toContain('cht');

    const tagsEngOnly = { lang: [], bilingual: false };
    parseLangAndBilingualFromText('English Only Subtitle 1080p', tagsEngOnly);
    expect(tagsEngOnly.bilingual).toBe(false);
    expect(tagsEngOnly.lang).toEqual([]);
    expect(hasChineseSubtitle(tagsEngOnly)).toBe(false);
  });

  it('extracts release tags with proper ordering', () => {
    const tags = extractReleaseTags('VisionQuest.S01E01.2160p.WEB-DL.x265.HDR.DV.Atmos.FLUX');
    expect(tags).toEqual(['2160p', 'WEB-DL', 'x265', 'HDR', 'DV', 'Atmos', 'FLUX']);
  });

  it('extracts metadata from release filename', () => {
    const meta = extractMetaFromFilename('Severance.S01E01.1080p.WEB-DL.mkv');
    expect(meta.title).toBe('Severance');
    expect(meta.season).toBe(1);
    expect(meta.episode).toBe(1);
  });

  it('formats subtitle label and filename with front-loaded tags', () => {
    const cand: SubtitleCandidate = {
      id: 'sub123',
      provider: 'subhd',
      title: 'VisionQuest S01E01 2160p WEB-DL x265 HDR DV Atmos FLUX',
      pageUrl: 'http://test',
      tags: {
        provider: 'subhd',
        lang: ['chs'],
        bilingual: true,
        fmt: ['srt'],
        source: ['ai'],
        collection: false,
        imdbMatched: true
      },
      rate: 5,
      downloadsCount: 100,
      score: 1000
    };
    const query: VideoQueryMeta = {
      imdbId: 'tt123',
      mediaType: 'series',
      season: 1,
      episode: 1,
      title: 'VisionQuest'
    };
    const { label, filename, format } = formatSubtitleInfo(cand, query);
    expect(label).toBe('[双] · [AI] · VisionQuest · S01E01 · 2160p · WEB-DL · x265 · HDR · DV · Atmos · FLUX · [SubHD]');
    expect(filename).toBe('VisionQuest.S01E01.2160p.WEB-DL.x265.HDR.DV.Atmos.FLUX.[Bilingual.SubHD].srt');
    expect(format).toBe('srt');
  });

  it('formats subtitle label with showOriginal enabled', () => {
    const cand: SubtitleCandidate = {
      id: 'sub456',
      provider: 'subhd',
      title: '蜘蛛侠：崭新之日.Spider-Man.Brand.New.Day.2026.官方简繁英粵.zip',
      pageUrl: 'http://test',
      tags: {
        provider: 'subhd',
        lang: ['chs'],
        bilingual: false,
        fmt: ['ass'],
        source: ['official'],
        collection: false,
        imdbMatched: true
      },
      rate: 5,
      downloadsCount: 100,
      score: 1000
    };
    const query: VideoQueryMeta = {
      imdbId: 'tt456',
      mediaType: 'movie',
      title: 'Spider-Man'
    };
    const { label, filename, format } = formatSubtitleInfo(cand, query, { showOriginal: true, keepOriginalFormat: true });
    expect(label).toBe('[简][官译]蜘蛛侠：崭新之日.Spider-Man.Brand.New.Day.2026.官方简繁英粵[SubHD]');
    expect(filename).toBe('[简][官译]蜘蛛侠：崭新之日.Spider-Man.Brand.New.Day.2026.官方简繁英粵[SubHD].ass');
    expect(format).toBe('ass');
  });

  it('formats language badges correctly for [简], [繁], [双]', () => {
    const query: VideoQueryMeta = { imdbId: 'tt1', mediaType: 'movie', title: 'Test' };
    const baseCand: SubtitleCandidate = {
      id: '1',
      provider: 'zimuku',
      title: 'Test Movie',
      pageUrl: '',
      tags: { provider: 'zimuku', lang: ['cht'], bilingual: false, fmt: ['srt'], source: ['machine'], collection: false, imdbMatched: true },
      rate: 4,
      downloadsCount: 10,
      score: 100
    };

    const resCht = formatSubtitleInfo(baseCand, query);
    expect(resCht.label).toContain('[繁] · [机翻]');

    const candChs: SubtitleCandidate = {
      ...baseCand,
      tags: { ...baseCand.tags, lang: ['chs'], source: ['official'] }
    };
    const resChs = formatSubtitleInfo(candChs, query);
    expect(resChs.label).toContain('[简] · [官译]');

    const candBi: SubtitleCandidate = {
      ...baseCand,
      tags: { ...baseCand.tags, bilingual: true, source: [] }
    };
    const resBi = formatSubtitleInfo(candBi, query);
    expect(resBi.label.startsWith('[双] · Test')).toBe(true);
  });

  it('formats subtitle label with Complete tag for collection candidates', () => {
    const query: VideoQueryMeta = {
      imdbId: 'tt17491088',
      mediaType: 'series',
      season: 4,
      episode: 1,
      title: 'The Diplomat'
    };
    const cand1: SubtitleCandidate = {
      id: 'sub_col1',
      provider: 'subhd',
      title: 'The.Diplomat.S04.zh.subtitles',
      pageUrl: 'http://test/a/EwYufh',
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
      rate: 5,
      downloadsCount: 249,
      score: 1500
    };
    const res1 = formatSubtitleInfo(cand1, query);
    expect(res1.label).toContain('Complete');
    expect(res1.filename).toContain('Complete');

    const cand2: SubtitleCandidate = {
      id: 'sub_col2',
      provider: 'subhd',
      title: 'The.Diplomat.S04.2160p.NF.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-KHN',
      pageUrl: 'http://test/a/pQp5mk',
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
      rate: 5,
      downloadsCount: 48,
      score: 1500
    };
    const res2 = formatSubtitleInfo(cand2, query);
    expect(res2.label).toContain('Complete');
    expect(res2.filename).toContain('Complete');
  });

  it('parses Zimuku work page HTML with language flags, formats, ratings and filters non-Chinese', () => {
    const zimuku = new ZimukuProvider();
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'movie',
      title: 'Spider-Man'
    };

    const workHtml = `
      <div class="subs box clearfix">
        <table>
          <tbody>
            <tr>
              <td class="first">
                <a href="/detail/12345.html" title="蜘蛛侠：崭新之日.Spider-Man.Brand.New.Day.2026.官方简繁">
                  蜘蛛侠：崭新之日.Spider-Man.Brand.New.Day.2026.官方简繁
                </a>
                <span class="label label-info">ASS/SRT</span>
                <span>官方字幕</span>
              </td>
              <td class="tac lang">
                <img src="/images/lang/double.png" alt="双语" title="双语" />
                <img src="/images/lang/chs.png" alt="简体" title="简体" />
              </td>
              <td class="tac">
                <i class="rating-star" title="4.8"></i>
              </td>
              <td class="tac hidden-xs">384</td>
              <td class="last hidden-xs"><a href="/u/At9XJkxw0">Mitch7701</a> <br> 2天前</td>
            </tr>
            <!-- Non-Chinese row (English only) -->
            <tr>
              <td class="first">
                <a href="/detail/99999.html" title="Spider-Man.English.Only.srt">Spider-Man.English.Only.srt</a>
                <span class="label label-info">SRT</span>
              </td>
              <td class="tac lang">
                <img src="/images/lang/en.png" alt="英语" title="英语" />
              </td>
              <td class="tac">
                <i class="rating-star" title="3.0"></i>
              </td>
              <td class="tac">50</td>
              <td class="last hidden-xs"><a href="/u/EnUser123">EnUser123</a></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const candidates = zimuku.parseSubtitlesFromWork(workHtml, 'https://zimuku.org', query, true);
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe('12345');
    expect(candidates[0].title).toBe('蜘蛛侠：崭新之日.Spider-Man.Brand.New.Day.2026.官方简繁');
    expect(candidates[0].tags.bilingual).toBe(true);
    expect(candidates[0].tags.lang).toContain('chs');
    expect(candidates[0].tags.fmt).toEqual(['ass', 'srt']);
    expect(candidates[0].tags.source).toContain('official');
    expect(candidates[0].rate).toBe(4.8);
    expect(candidates[0].downloadsCount).toBe(384);
    expect(candidates[0].tags.imdbMatched).toBe(true);
  });

  it('parses Subhd search card HTML with SVG download count and filters non-Chinese', () => {
    const subhd = new SubhdProvider();
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'movie',
      title: 'Spider-Man'
    };

    const searchHtml = `
      <div class="bg-white shadow-sm rounded-3 mb-4">
        <div class="f16"><a href="/a/78901">蜘蛛侠：崭新之日</a></div>
        <div class="view-text"><a href="/a/78901">Spider-Man.Brand.New.Day.2026.官方简繁</a></div>
        <div>
          <span>双语</span>
          <span>简中</span>
          <span>官方译本</span>
          <span>ASS</span>
          <svg class="bi-download"></svg><span>888</span>
        </div>
      </div>
      <!-- Non-Chinese card (German only) -->
      <div class="bg-white shadow-sm rounded-3 mb-4">
        <div class="f16"><a href="/a/78902">Spider-Man German</a></div>
        <div class="view-text"><a href="/a/78902">Spider-Man.2026.German</a></div>
        <div>
          <span>德语</span>
          <span>SRT</span>
          <svg class="bi-download"></svg><span>100</span>
        </div>
      </div>
    `;

    // parseSearchResults is private, so we can test it via any cast
    const candidates = (subhd as any).parseSearchResults(searchHtml, 'https://subhd.tv', query);
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe('78901');
    expect(candidates[0].title).toBe('Spider-Man.Brand.New.Day.2026.官方简繁');
    expect(candidates[0].tags.bilingual).toBe(true);
    expect(candidates[0].tags.lang).toContain('chs');
    expect(candidates[0].tags.fmt).toContain('ass');
    expect(candidates[0].tags.source).toContain('official');
    expect(candidates[0].downloadsCount).toBe(888);
  });

  it('correctly extracts subtitle id /a/... even when search card has movie link /d/... before subtitle link', () => {
    const subhd = new SubhdProvider();
    const query: VideoQueryMeta = {
      imdbId: 'tt36137784',
      mediaType: 'movie',
      title: 'Spider-Man'
    };

    const searchHtml = `
      <div class="bg-white shadow-sm rounded-3 mb-4">
        <div class="row">
          <div class="col-2">
            <a href="/d/36137784"><img src="/poster.jpg" /></a>
          </div>
          <div class="col-10">
            <div class="f16"><a href="/a/yItJar">蜘蛛侠：崭新之日</a></div>
            <div class="view-text"><a href="/a/yItJar">Spider-Man.Brand.New.Day.2026.Official</a></div>
            <div>
              <span>双语</span>
              <span>简中</span>
              <span>官方译本</span>
              <span>ASS</span>
              <svg class="bi-download"></svg><span>666</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const candidates = (subhd as any).parseSearchResults(searchHtml, 'https://subhd.tv', query);
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe('yItJar');
    expect(candidates[0].pageUrl).toBe('https://subhd.tv/a/yItJar');
    expect(candidates[0].downloadsCount).toBe(666);
  });

  it('correctly parses detail rows div.row.pt-2.mb-2 on SubHD /d/ page', () => {
    const subhd = new SubhdProvider();
    const query: VideoQueryMeta = {
      imdbId: 'tt36137784',
      mediaType: 'movie',
      title: 'Spider-Man'
    };

    const detailHtml = `
      <div class="bg-white shadow-sm rounded-3 mb-5">
        <div class="row pt-2 mb-2">
          <div class="f16"><a href="/a/sub101">蜘蛛侠：崭新之日 Row 1</a></div>
          <div class="view-text"><a href="/a/sub101">Spider-Man.Brand.New.Day.2026.Row1</a></div>
          <div><span>简中</span><span>SRT</span></div>
        </div>
        <div class="row pt-2 mb-2">
          <div class="f16"><a href="/a/sub102">蜘蛛侠：崭新之日 Row 2</a></div>
          <div class="view-text"><a href="/a/sub102">Spider-Man.Brand.New.Day.2026.Row2</a></div>
          <div><span>简中</span><span>ASS</span></div>
        </div>
      </div>
    `;

    const candidates = (subhd as any).parseSearchResults(detailHtml, 'https://subhd.tv', query);
    expect(candidates.length).toBe(2);
    expect(candidates[0].id).toBe('sub101');
    expect(candidates[1].id).toBe('sub102');
  });

  it('normalizes protocol-relative work URLs to active domain and stops on first matching work in parseWorksFromSearch', async () => {
    const zimuku = new ZimukuProvider();
    const query: VideoQueryMeta = {
      imdbId: 'tt36983905',
      mediaType: 'movie',
      title: 'The Uprising'
    };

    const searchHtml = `
      <div class="box clearfix">
        <div class="item prel clearfix">
          <div class="title">
            <p class="tt clearfix">
              <a href="//zimuku.org/subs/78819.html" target="_blank"><b>起义 The Uprising (2026)</b></a>
            </p>
          </div>
        </div>
        <div class="item prel clearfix">
          <div class="title">
            <p class="tt clearfix">
              <a href="//zimuku.org/subs/48918.html" target="_blank"><b>大学同学 第二季 Friends from College (2019)</b></a>
            </p>
          </div>
        </div>
      </div>
    `;

    const workPageHtml = `
      <div class="subs box clearfix">
        <table class="table" id="subtb">
          <tbody>
            <tr>
              <td class="first">
                <a href="//zimuku.org/detail/237139.html" title="The.Uprising.2026.1080p.srt"><b>The.Uprising.2026.1080p.srt</b></a>
                <span class="label label-info">SRT</span>
              </td>
              <td class="tac lang">
                <img src="/images/chs.gif" alt="简体中文" data-original-title="简体中文" />
              </td>
              <td class="tac hidden-xs">
                <i class="rating-star" data-original-title="字幕质量:9.7分"></i>
              </td>
              <td class="tac hidden-xs">496</td>
              <td class="last hidden-xs">
                <span class="glyphicon glyphicon-user"></span> <a href="/u/A31vKZjt0">与狼共舞</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const requestedUrls: string[] = [];
    vi.spyOn(zimuku as any, 'fetchPage').mockImplementation(async (url: string) => {
      requestedUrls.push(url);
      return { data: workPageHtml, status: 200 };
    });

    const candidates = await zimuku.parseWorksFromSearch(searchHtml, 'https://zmk.pw', query);

    // 1. URL must be normalized to active domain without double slash or zimuku.org in path
    expect(requestedUrls).toEqual(['https://zmk.pw/subs/78819.html']);
    expect(requestedUrls[0]).not.toContain('//zimuku.org');

    // 2. Only first matching work was scraped (Friends from College was ignored)
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe('237139');
    expect(candidates[0].pageUrl).toBe('https://zmk.pw/detail/237139.html');
  });

  it('ignores homepage /subs/... links and parses data-original-title for language and rating in parseSubtitlesFromWork', () => {
    const zimuku = new ZimukuProvider();
    const query: VideoQueryMeta = {
      imdbId: 'tt36983905',
      mediaType: 'movie',
      title: 'The Uprising'
    };

    const mixedHtml = `
      <div class="subs box clearfix">
        <table class="table" id="subtb">
          <tbody>
            <!-- Homepage work link that should be completely ignored -->
            <tr>
              <td class="first">
                <a href="/subs/74167.html" title="10号舱里的女人 (2025)">10号舱里的女人 (2025)</a>
              </td>
              <td class="tac lang"><img src="/lang/chs.png" alt="简体" /></td>
              <td class="tac">100</td>
            </tr>
            <!-- Valid subtitle detail link with protocol-relative URL & data-original-title -->
            <tr>
              <td class="first">
                <a href="//zimuku.org/detail/237139.html" title="起义：罗宾汉的崛起.The Uprising.2026.srt">
                  <b>起义：罗宾汉的崛起.The Uprising.2026.srt</b>
                </a>
                <span class="label label-info">SRT</span>
              </td>
              <td class="tac lang">
                <img src="/china.gif" alt="" title="" data-original-title="简体中文" />
                <img src="/jollyroger.gif" alt="" title="" data-original-title="双语" />
              </td>
              <td class="tac hidden-xs">
                <i class="rating-star" title="" data-original-title="字幕质量:9.7分"></i>
              </td>
              <td class="tac hidden-xs">496</td>
              <td class="last hidden-xs">
                <span class="glyphicon glyphicon-user"></span> <a href="https://zimuku.org/u/A31vKZjt0">与狼共舞</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const candidates = zimuku.parseSubtitlesFromWork(mixedHtml, 'https://zmk.pw', query, false);

    // /subs/74167.html must be ignored! Only /detail/237139.html extracted!
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe('237139');
    expect(candidates[0].pageUrl).toBe('https://zmk.pw/detail/237139.html');
    expect(candidates[0].tags.bilingual).toBe(true);
    expect(candidates[0].tags.lang).toContain('chs');
    expect(candidates[0].rate).toBe(9.7);
    expect(candidates[0].downloadsCount).toBe(496);
  });

  it('strictly parses SubHD language and bilingual from card badges without using title (e.g. 官方简繁英)', () => {
    const subhd = new SubhdProvider();
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'movie',
      title: 'Masterplan'
    };

    const cardHtml = `
      <div class="bg-white shadow-sm rounded-3 mb-4">
        <div class="f16"><a href="/a/99123">偷天父子兵</a></div>
        <div class="view-text"><a href="/a/99123">偷天父子兵.Masterplan.2026.官方简繁英</a></div>
        <div>
          <span>官方字幕</span>
          <span>简体</span>
          <span>繁体</span>
          <span>英语</span>
          <span>SRT</span>
        </div>
      </div>
    `;

    const candidates = (subhd as any).parseSearchResults(cardHtml, 'https://subhd.tv', query);
    expect(candidates.length).toBe(1);
    expect(candidates[0].tags.bilingual).toBe(false);
    expect(candidates[0].tags.lang).toEqual(['chs', 'cht']);
    expect(candidates[0].tags.source).toContain('official');
  });

  it('strictly parses Zimuku language and bilingual from alt attributes without using title (e.g. 官方简繁英)', () => {
    const zimuku = new ZimukuProvider();
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'movie',
      title: 'Masterplan'
    };

    const workHtml = `
      <div class="subs box clearfix">
        <table id="subtb">
          <tbody>
            <tr>
              <td class="first">
                <a href="/detail/88123.html" title="偷天父子兵.Masterplan.2026.官方简繁英">
                  <b>偷天父子兵.Masterplan.2026.官方简繁英</b>
                </a>
                <span class="label label-info">SRT</span>
              </td>
              <td class="tac lang">
                <img src="/chs.png" alt="简体中文" />
                <img src="/cht.png" alt="繁體中文" />
                <img src="/en.png" alt="英语" />
              </td>
              <td class="tac"><i class="rating-star" title="4.0"></i></td>
              <td class="tac">120</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const candidates = zimuku.parseSubtitlesFromWork(workHtml, 'https://zimuku.org', query, false);
    expect(candidates.length).toBe(1);
    expect(candidates[0].tags.bilingual).toBe(false);
    expect(candidates[0].tags.lang).toEqual(['chs', 'cht']);
  });

  it('instantiates SubhdProvider and ZimukuProvider', () => {
    const subhd = new SubhdProvider();
    const zimuku = new ZimukuProvider();
    expect(subhd.name).toBe('subhd');
    expect(zimuku.name).toBe('zimuku');
  });

  describe('SubhdProvider work ID resolution and season hopping', () => {
    const subhd = new SubhdProvider();

    it('parses items from searchD JSON and HTML fallback', () => {
      const fromJson = subhd.parseItemsFromSearchD({
        items: [
          { id: 37354420, title: '头号外交官 第四季', title2: 'The Diplomat Season 4', type: 'TVSeries', year: '2026' }
        ]
      });
      expect(fromJson.length).toBe(1);
      expect(fromJson[0].id).toBe('37354420');
      expect(fromJson[0].title).toBe('头号外交官 第四季');

      const fromHtml = subhd.parseItemsFromSearchD({
        text: '<a href="/d/37354420">头号外交官 第四季 (2026)</a>'
      });
      expect(fromHtml.length).toBe(1);
      expect(fromHtml[0].id).toBe('37354420');
      expect(fromHtml[0].title).toBe('头号外交官 第四季 (2026)');
    });

    it('matches subject item correctly for The Diplomat and Monster', () => {
      const diplomatItems = [
        { id: '37354420', title: '头号外交官 第四季', title2: 'The Diplomat Season 4', type: 'TVSeries', year: '2026' },
        { id: '37006365', title: '头号外交官 第三季', title2: 'The Diplomat Season 3', type: 'TVSeries', year: '2025' },
        { id: '36394815', title: '头号外交官 第二季', title2: 'The Diplomat Season 2', type: 'TVSeries', year: '2024' },
        { id: '35881452', title: '头号外交官 第一季', title2: 'The Diplomat Season 1', type: 'TVSeries', year: '2023' }
      ];

      // Exact Season 4 query
      const matchS4 = subhd.matchSubjectItem(diplomatItems, {
        imdbId: 'tt17491088',
        mediaType: 'series',
        season: 4,
        episode: 1
      }, true);
      expect(matchS4).toEqual({ dId: '37354420', exactSeason: true, imdbMatched: true });

      // Exact Season 1 query
      const matchS1 = subhd.matchSubjectItem(diplomatItems, {
        imdbId: 'tt17491088',
        mediaType: 'series',
        season: 1,
        episode: 1
      }, true);
      expect(matchS1).toEqual({ dId: '35881452', exactSeason: true, imdbMatched: true });

      // Season 4 query when only Season 1 is returned in searchD items -> exactSeason is false for hopping
      const hopCandidate = subhd.matchSubjectItem([diplomatItems[3]], {
        imdbId: 'tt17491088',
        mediaType: 'series',
        season: 4,
        episode: 1
      }, true);
      expect(hopCandidate).toEqual({ dId: '35881452', exactSeason: false, imdbMatched: true });

      // tt0434706 (Monster 2004) unversioned anime TV series
      const monsterItems = [
        { id: '31034', title: '怪物', title2: 'Monster (2004)', type: 'TVSeries', year: '2004' }
      ];
      const matchMonster = subhd.matchSubjectItem(monsterItems, {
        imdbId: 'tt0434706',
        mediaType: 'series',
        season: 1,
        episode: 12
      }, true);
      expect(matchMonster).toEqual({ dId: '31034', exactSeason: true, imdbMatched: true });

      // CleanTitle matching without IMDb
      const matchTitle = subhd.matchSubjectItem(diplomatItems, {
        imdbId: '',
        mediaType: 'series',
        title: 'The Diplomat',
        season: 4,
        episode: 1
      }, false);
      expect(matchTitle).toEqual({ dId: '37354420', exactSeason: true, imdbMatched: false });

      // Unmatched cleanTitle
      const noMatch = subhd.matchSubjectItem(diplomatItems, {
        imdbId: '',
        mediaType: 'series',
        title: 'Completely Different Show',
        season: 4
      }, false);
      expect(noMatch).toBeNull();
    });

    it('finds related season work ID from detail page HTML (同系列作品)', () => {
      const htmlPath = path.resolve('头号外交官 第四季 The Diplomat 分享交流下载字幕平台 - SubHD.htm');
      const html = fs.existsSync(htmlPath)
        ? fs.readFileSync(htmlPath, 'utf8')
        : `
          <div class="col-lg-3">
            <div class="bg-white shadow-sm rounded-3 mb-3">
              <a href="/d/35881452"><img alt="头号外交官 第一季" /></a>
              <a href="/d/36394815"><img alt="头号外交官 第二季" /></a>
              <a href="/d/37006365"><img alt="头号外交官 第三季" /></a>
              <a href="/d/37354420"><img alt="头号外交官 第四季" /></a>
            </div>
          </div>
        `;

      expect(subhd.findRelatedSeasonWorkId(html, 1)).toBe('35881452');
      expect(subhd.findRelatedSeasonWorkId(html, 2)).toBe('36394815');
      expect(subhd.findRelatedSeasonWorkId(html, 3)).toBe('37006365');
      expect(subhd.findRelatedSeasonWorkId(html, 4)).toBe('37354420');
      expect(subhd.findRelatedSeasonWorkId(html, 5)).toBeNull();
    });

    it('extracts work ID from search results HTML cards', () => {
      const searchHtml = `
        <div class="bg-white shadow-sm rounded-3 mb-4">
          <div class="row">
            <div class="col-2">
              <a href="/d/37354420"><img alt="头号外交官 第四季" /></a>
            </div>
            <div class="col-10">
              <div class="f16"><a href="/d/37354420">头号外交官 第四季 The Diplomat</a></div>
              <div class="view-text"><a href="/a/EwYufh">The.Diplomat.S04.zh.subtitles</a></div>
            </div>
          </div>
        </div>
      `;

      // S04 query matches
      const resS4 = subhd.extractWorkIdFromSearchHtml(searchHtml, {
        imdbId: 'tt17491088',
        mediaType: 'series',
        season: 4,
        episode: 1
      }, true);
      expect(resS4).toEqual({ dId: '37354420', exactSeason: true, imdbMatched: true });

      // S02 query does not match
      const resS2 = subhd.extractWorkIdFromSearchHtml(searchHtml, {
        imdbId: 'tt17491088',
        mediaType: 'series',
        season: 2,
        episode: 1
      }, true);
      expect(resS2).toBeNull();
    });

    it('parses detail page HTML (/d/37354420) for S04E01 and S04E08 with collections', () => {
      const htmlPath = path.resolve('头号外交官 第四季 The Diplomat 分享交流下载字幕平台 - SubHD.htm');
      expect(fs.existsSync(htmlPath)).toBe(true);
      const html = fs.readFileSync(htmlPath, 'utf8');

      // S04E01: should return exactly uhcNw2 (Ep 1), EwYufh (Collection 1), pQp5mk (Collection 2)
      const resE01 = subhd.parseDetailPage(html, 'https://subhd.tv', {
        imdbId: 'tt17491088',
        mediaType: 'series',
        season: 4,
        episode: 1
      }, true);

      expect(resE01.map((c) => c.id)).toEqual(['uhcNw2', 'EwYufh', 'pQp5mk']);

      const ep1 = resE01.find((c) => c.id === 'uhcNw2')!;
      expect(ep1.tags.collection).toBe(false);
      expect(ep1.tags.episodeMatched).toBe(true);
      expect(ep1.tags.seasonMatched).toBe(true);
      expect(ep1.tags.imdbMatched).toBe(true);
      expect(ep1.tags.bilingual).toBe(true);
      expect(ep1.tags.source).toContain('official');

      const col1 = resE01.find((c) => c.id === 'EwYufh')!;
      expect(col1.tags.collection).toBe(true);
      expect(col1.tags.imdbMatched).toBe(true);
      expect(col1.tags.bilingual).toBe(true);
      expect(col1.tags.source).toContain('official');
      expect(col1.downloadsCount).toBe(249);
      expect(col1.tags.uploader).toBe('tk1');

      const col2 = resE01.find((c) => c.id === 'pQp5mk')!;
      expect(col2.tags.collection).toBe(true);
      expect(col2.tags.imdbMatched).toBe(true);
      expect(col2.tags.bilingual).toBe(true);
      expect(col2.tags.source).toContain('official');
      expect(col2.downloadsCount).toBe(48);
      expect(col2.tags.uploader).toBe('yesno');

      // S04E08: should return exactly eVRsd6 (Ep 8), EwYufh (Collection 1), pQp5mk (Collection 2)
      const resE08 = subhd.parseDetailPage(html, 'https://subhd.tv', {
        imdbId: 'tt17491088',
        mediaType: 'series',
        season: 4,
        episode: 8
      }, true);

      expect(resE08.map((c) => c.id)).toEqual(['eVRsd6', 'EwYufh', 'pQp5mk']);
      const ep8 = resE08.find((c) => c.id === 'eVRsd6')!;
      expect(ep8.tags.collection).toBe(false);
      expect(ep8.tags.episodeMatched).toBe(true);
      expect(ep8.tags.seasonMatched).toBe(true);
      expect(ep8.tags.imdbMatched).toBe(true);
    });

    it('executes full two-stage search flow (/searchD/tt17491088 -> /d/37354420)', async () => {
      const htmlPath = path.resolve('头号外交官 第四季 The Diplomat 分享交流下载字幕平台 - SubHD.htm');
      const html = fs.readFileSync(htmlPath, 'utf8');

      const subhdInstance = new SubhdProvider();
      const client = (subhdInstance as any).client;

      vi.spyOn(client, 'get').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/searchD/tt17491088')) {
          return {
            status: 200,
            data: {
              items: [
                { id: '37354420', title: '头号外交官 第四季', title2: 'The Diplomat Season 4', type: 'TVSeries', year: '2026' }
              ]
            }
          };
        }
        if (urlStr.includes('/d/37354420')) {
          return {
            status: 200,
            data: html
          };
        }
        return { status: 404, data: '' };
      });

      const results = await subhdInstance.search({
        imdbId: 'tt17491088',
        mediaType: 'series',
        season: 4,
        episode: 1,
        title: 'The Diplomat'
      });

      expect(results.length).toBe(3);
      expect(results.map((c) => c.id)).toEqual(['uhcNw2', 'EwYufh', 'pQp5mk']);
      expect(results[0].tags.episodeMatched).toBe(true);
      expect(results[1].tags.collection).toBe(true);
      expect(results[2].tags.collection).toBe(true);
    });
  });
});



