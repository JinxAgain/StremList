import { describe, it, expect, vi } from 'vitest';
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
    const { label, format } = formatSubtitleInfo(cand, query, { showOriginal: true, keepOriginalFormat: true });
    expect(label).toBe('[简][官译]蜘蛛侠：崭新之日.Spider-Man.Brand.New.Day.2026.官方简繁英粵[SubHD]');
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

  it('instantiates SubhdProvider and ZimukuProvider', () => {
    const subhd = new SubhdProvider();
    const zimuku = new ZimukuProvider();
    expect(subhd.name).toBe('subhd');
    expect(zimuku.name).toBe('zimuku');
  });
});

