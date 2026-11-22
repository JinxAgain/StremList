import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { cacheManager } from '../../src/services/subtitles/cache/manager.js';
import { CinemetaClient } from '../../src/services/subtitles/core/cinemeta.js';
import { AssrtProvider } from '../../src/services/subtitles/providers/assrt.js';
import { SubhdProvider } from '../../src/services/subtitles/providers/subhd.js';
import { subhdSession } from '../../src/services/subtitles/providers/subhd-session.js';
import { ZimukuProvider } from '../../src/services/subtitles/providers/zimuku.js';
import { parseMediaId } from '../../src/routes/subtitles.js';

describe('Subtitle & Harbor Routes', () => {
  const app = createApp();
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      'SUBTITLE_SHOW_ORIGINAL',
      'SUBTITLE_KEEP_ORIGINAL_FORMAT',
      'ASSRT_TOKEN',
      'SUBTITLE_SOURCE',
      'SUBTITLE_LANG',
      'SUBTITLE_MAX_RESULTS'
    ]) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it('includes subtitles in manifest', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.body.resources).toContainEqual(
      expect.objectContaining({ name: 'subtitles' })
    );
    expect(res.body.idPrefixes).toContain('tmdb');
  });

  it('sanitizes Harbor newlines in URL path without 404', async () => {
    const res = await request(app).get('/health%0A');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('handles CORS options preflight for subtitle download', async () => {
    const res = await request(app).options('/subtitles/dl/subhd/123/0/test.srt');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('routes subtitle search requests with filename extra', async () => {
    cacheManager.setSearchResults('movie:tt1234567:0:0:bilingual:all:8', [
      { id: '1', lang: 'zh-CN', path: '/subtitles/dl/subhd/1/0/test.srt' }
    ]);
    const res = await request(app).get('/subtitles/movie/tt1234567/filename=Test.Movie.2024.1080p.mkv.json');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.subtitles)).toBe(true);
    expect(res.body.subtitles.length).toBeGreaterThan(0);
  });

  it('routes configured subtitle search using cache key with :orig:rawfmt', async () => {
    const customConfig = {
      subtitleShowOriginal: true,
      subtitleKeepOriginalFormat: true
    };
    const b64 = Buffer.from(JSON.stringify(customConfig)).toString('base64url');

    cacheManager.setSearchResults('movie:tt7654321:0:0:bilingual:all:8:orig:rawfmt', [
      {
        id: 'subhd_77_0',
        url: 'http://127.0.0.1:7000/subtitles/dl/subhd/77/0/test.ass?raw=1',
        lang: 'chi',
        label: '[简][官译]测试原名[SubHD]',
        subtitleFileName: 'test.ass',
        movieReleaseName: 'test',
        SubFormat: 'ass',
        path: '/subtitles/dl/subhd/77/0/test.ass?raw=1'
      }
    ]);

    const res = await request(app).get(`/${b64}/subtitles/movie/tt7654321.json`);
    expect(res.status).toBe(200);
    expect(res.body.subtitles).toHaveLength(1);
    expect(res.body.subtitles[0].SubFormat).toBe('ass');
    expect(res.body.subtitles[0].path).toContain('?raw=1');
    expect(res.body.subtitles[0].label).toContain('[简][官译]');
  });

  it('downloads and serves cached raw ASS subtitle without conversion', async () => {
    const sampleAss = `[Script Info]
Title: Cached Raw ASS
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:20.50,0:01:23.00,Default,,0,0,0,,{\\pos(192,200)}Hello ASS World
`;
    cacheManager.saveSubtitle('subhd_99999_0_orig.ass', Buffer.from(sampleAss, 'utf-8'));

    const res = await request(app).get('/subtitles/dl/subhd/99999/0/movie.ass?raw=1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('{\\pos(192,200)}Hello ASS World');
    expect(res.text).toContain('[Script Info]');
  });

  it('downloads and converts ASS to clean SRT when raw is not requested', async () => {
    const sampleSrt = `1
00:01:20,500 --> 00:01:23,000
Hello Converted SRT World
`;
    cacheManager.saveSubtitle('subhd_88888_0.srt', Buffer.from(sampleSrt, 'utf-8'));

    const res = await request(app).get('/subtitles/dl/subhd/88888/0/movie.srt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('00:01:20,500 --> 00:01:23,000');
    expect(res.text).toContain('Hello Converted SRT World');
    expect(res.text).not.toContain('[Script Info]');
  });

  it('downloads encoded filename with brackets and Chinese characters properly', async () => {
    const sampleAss = `[Script Info]\nTitle: Encoded Test\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:01:00.00,0:01:02.00,Default,,0,0,0,,Chinese Subtitle\n`;
    cacheManager.saveSubtitle('subhd_77777_0_orig.ass', Buffer.from(sampleAss, 'utf-8'));

    const encoded = encodeURIComponent('[双][官译]测试原名[SubHD].ass');
    const res = await request(app).get(`/subtitles/dl/subhd/77777/0/${encoded}?raw=1`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Chinese Subtitle');
  });

  it('serves generic subtitle.ext URL pattern with name query param for Harbor compatibility', async () => {
    const sampleAss = `[Script Info]\nTitle: Harbor Subtitle Test\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:01:00.00,0:01:02.00,Default,,0,0,0,,Harbor Compatible Subtitle\n`;
    cacheManager.saveSubtitle('subhd_66666_0_orig.ass', Buffer.from(sampleAss, 'utf-8'));

    const encodedName = encodeURIComponent('Saving.Private.Ryan.1998.2160p.REMUX.[Bilingual.Zimuku].ass');
    const res = await request(app).get(`/subtitles/dl/subhd/66666/0/subtitle.ass?name=${encodedName}&raw=1`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-disposition']).toContain(encodedName);
    expect(res.text).toContain('Harbor Compatible Subtitle');
  });

  it('parseMediaId correctly parses kitsu series IDs', () => {
    const meta1 = parseMediaId('series', 'kitsu:50016:1');
    expect(meta1.imdbId).toBe('kitsu:50016');
    expect(meta1.season).toBeUndefined();
    expect(meta1.episode).toBe(1);

    const meta2 = parseMediaId('series', 'kitsu:50016:2:1');
    expect(meta2.imdbId).toBe('kitsu:50016');
    expect(meta2.season).toBe(2);
    expect(meta2.episode).toBe(1);
  });

  it('routes subtitle request for kitsu:50016:1 with filename overriding season to S02', async () => {
    cacheManager.setSearchResults('series:kitsu:50016:2:1:bilingual:all:8', [
      { id: 'subhd_kitsu_1', lang: 'zh-CN', path: '/subtitles/dl/subhd/101/1/edgerunners.srt' }
    ]);

    const res = await request(app).get(
      '/subtitles/series/kitsu:50016:1/filename=Cyberpunk.Edgerunners.S02E01.2160p.mkv.json'
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.subtitles)).toBe(true);
    expect(res.body.subtitles.length).toBe(1);
    expect(res.body.subtitles[0].path).toContain('/subtitles/dl/subhd/101/1/edgerunners.srt');
  });

  it('routes subtitle request for kitsu:50016:4 without filename and infers season 2 from title', async () => {
    vi.spyOn(CinemetaClient, 'resolveMediaInfo').mockResolvedValueOnce({
      title: 'Cyberpunk: Edgerunners II',
      year: 2026,
      resolvedImdb: 'tt12590266'
    });

    cacheManager.setSearchResults('series:kitsu:50016:2:4:bilingual:all:8', [
      { id: 'subhd_s2_ep4', lang: 'zh-CN', path: '/subtitles/dl/subhd/202/4/edgerunners_s02e04.srt' }
    ]);

    const res = await request(app).get('/subtitles/series/kitsu:50016:4.json');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.subtitles)).toBe(true);
    expect(res.body.subtitles.length).toBe(1);
    expect(res.body.subtitles[0].path).toContain('/subtitles/dl/subhd/202/4/edgerunners_s02e04.srt');
  });

  it('downloads and serves ASSRT subtitle via /subtitles/dl/assrt/:id/:ep route', async () => {
    const cacheFile = cacheManager.getSubtitlePath('assrt_654321_0.srt');
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);

    const sampleSrt = `1\n00:00:05,000 --> 00:00:08,000\nASSRT Live Route Subtitle\n`;
    const spy = vi.spyOn(AssrtProvider.prototype, 'download').mockResolvedValueOnce({
      buffer: Buffer.from(sampleSrt, 'utf-8'),
      filename: 'The.Odyssey.2026.chs&eng.srt'
    });

    try {
      const res = await request(app).get('/subtitles/dl/assrt/654321/0/subtitle.srt');
      expect(res.status).toBe(200);
      expect(res.text).toContain('ASSRT Live Route Subtitle');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    }
  });

  it('POST /api/assrt/test checks ASSRT token quota', async () => {
    const spy = vi.spyOn(AssrtProvider, 'checkQuota').mockResolvedValueOnce({
      success: true,
      quota: 19,
      status: 0,
      message: 'OK'
    });

    const res = await request(app)
      .post('/api/assrt/test')
      .send({ token: 'testtoken1234567890123456789012' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      quota: 19,
      status: 0,
      message: 'OK'
    });
    expect(spy).toHaveBeenCalledWith('testtoken1234567890123456789012', undefined);
    spy.mockRestore();
  });

  it('dispatches no_subhd subtitleSource to Zimuku and ASSRT without invoking SubHD', async () => {
    const customConfig = {
      subtitleSource: 'no_subhd',
      assrtToken: 'testtoken1234567890123456789012'
    };
    const b64 = Buffer.from(JSON.stringify(customConfig)).toString('base64url');
    const cacheKey = 'movie:tt33764258:0:0:bilingual:no_subhd:8:assrt_45f082f6';
    cacheManager.deleteSearchResult(cacheKey);

    vi.spyOn(CinemetaClient, 'resolveMediaInfo').mockResolvedValueOnce({
      title: 'The Odyssey',
      year: 2026,
      resolvedImdb: 'tt33764258'
    });

    const subhdSpy = vi.spyOn(SubhdProvider.prototype, 'search').mockResolvedValue([]);
    const zimukuSpy = vi.spyOn(ZimukuProvider.prototype, 'search').mockResolvedValue([]);
    const assrtSpy = vi.spyOn(AssrtProvider.prototype, 'search').mockResolvedValueOnce([
      {
        id: '654322',
        provider: 'assrt',
        title: 'The.Odyssey.2026.1080p.BluRay',
        pageUrl: 'https://assrt.net/xml/sub/654/654322.xml',
        tags: {
          provider: 'assrt',
          lang: ['chs'],
          bilingual: true,
          fmt: ['srt'],
          source: ['official'],
          collection: false,
          imdbMatched: true
        },
        rate: 5,
        downloadsCount: 50,
        score: 0
      }
    ]);

    try {
      const res = await request(app).get(`/${b64}/subtitles/movie/tt33764258.json`);
      expect(res.status).toBe(200);
      expect(subhdSpy).not.toHaveBeenCalled();
      expect(zimukuSpy).toHaveBeenCalledTimes(1);
      expect(assrtSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'The Odyssey', year: 2026 }), 'testtoken1234567890123456789012');
      expect(res.body.subtitles).toHaveLength(1);
      expect(res.body.subtitles[0].label).toContain('[ASSRT]');
      expect(res.body.subtitles[0].path).toContain(`/${b64}/subtitles/dl/assrt/654322/0/`);
    } finally {
      cacheManager.deleteSearchResult(cacheKey);
    }
  });

  it('propagates /:config assrtToken and season across search and download without .env ASSRT_TOKEN', async () => {
    const customConfig = {
      subtitleSource: 'assrt',
      assrtToken: 'urlconfigtoken123456789012345678'
    };
    const b64 = Buffer.from(JSON.stringify(customConfig)).toString('base64url');
    const cacheFile = cacheManager.getSubtitlePath('assrt_707070_s2_4.srt');
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);

    vi.spyOn(CinemetaClient, 'resolveMediaInfo').mockResolvedValueOnce({
      title: 'Sample Show',
      year: 2023,
      resolvedImdb: 'tt9991111'
    });
    const subhdSpy = vi.spyOn(SubhdProvider.prototype, 'search').mockResolvedValue([]);
    const zimukuSpy = vi.spyOn(ZimukuProvider.prototype, 'search').mockResolvedValue([]);
    vi.spyOn(AssrtProvider.prototype, 'search').mockResolvedValueOnce([
      {
        id: '707070',
        provider: 'assrt',
        title: 'Sample.Show.S02E04.1080p',
        pageUrl: 'https://assrt.net/xml/sub/707/707070.xml',
        tags: {
          provider: 'assrt',
          lang: ['chs'],
          bilingual: true,
          fmt: ['srt'],
          source: [],
          collection: false,
          imdbMatched: true,
          seasonMatched: true,
          episodeMatched: true
        },
        rate: 5,
        downloadsCount: 10,
        score: 0
      }
    ]);
    const dlSpy = vi.spyOn(AssrtProvider.prototype, 'download').mockResolvedValueOnce({
      buffer: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nURL Config ASSRT\n', 'utf-8'),
      filename: 'Sample.Show.S02E04.srt'
    });

    try {
      const searchRes = await request(app).get(`/${b64}/subtitles/series/tt9991111:2:4.json`);
      expect(searchRes.status).toBe(200);
      expect(subhdSpy).not.toHaveBeenCalled();
      expect(zimukuSpy).not.toHaveBeenCalled();
      expect(searchRes.body.subtitles).toHaveLength(1);
      const dlPath = searchRes.body.subtitles[0].path;
      expect(dlPath).toContain(`/${b64}/subtitles/dl/assrt/707070/4/`);
      expect(dlPath).toContain('&s=2');

      const dlRes = await request(app).get(dlPath);
      expect(dlRes.status).toBe(200);
      expect(dlRes.text).toContain('URL Config ASSRT');
      expect(dlSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: '707070', provider: 'assrt' }),
        expect.objectContaining({
          episode: 4,
          season: 2,
          token: 'urlconfigtoken123456789012345678'
        })
      );
    } finally {
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
      for (const k of Array.from((cacheManager as any).searchCache.keys()) as string[]) {
        if (k.includes('tt9991111')) cacheManager.deleteSearchResult(k);
      }
    }
  });

  it('does not infer TV season from movie sequel titles like Toy Story 2', async () => {
    vi.spyOn(CinemetaClient, 'resolveMediaInfo').mockResolvedValueOnce({
      title: 'Toy Story 2',
      year: 1999,
      resolvedImdb: 'tt0120363'
    });
    vi.spyOn(SubhdProvider.prototype, 'search').mockResolvedValue([]);
    vi.spyOn(ZimukuProvider.prototype, 'search').mockResolvedValue([]);
    const assrtSpy = vi.spyOn(AssrtProvider.prototype, 'search').mockResolvedValueOnce([]);

    const b64 = Buffer.from(JSON.stringify({ subtitleSource: 'assrt', assrtToken: 'tok1234567890123456789012345678' })).toString('base64url');
    const res = await request(app).get(`/${b64}/subtitles/movie/tt0120363.json`);
    expect(res.status).toBe(200);
    expect(assrtSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'movie',
        title: 'Toy Story 2',
        baseTitle: 'Toy Story 2',
        season: undefined
      }),
      'tok1234567890123456789012345678'
    );
  });

  it('isolates search cache under sourcePref=all between token-less and ASSRT-configured requests', async () => {
    cacheManager.setSearchResults('movie:tt5555555:0:0:bilingual:all:8', [
      { id: 'zimuku_1', url: '', lang: 'chi', label: 'Zimuku Only', subtitleFileName: 'z.srt', movieReleaseName: 'z', SubFormat: 'srt', path: '/subtitles/dl/zimuku/1/0/z.srt' }
    ]);

    vi.spyOn(CinemetaClient, 'resolveMediaInfo').mockResolvedValueOnce({
      title: 'Unique Cache Test Movie',
      year: 2025,
      resolvedImdb: 'tt5555555'
    });
    vi.spyOn(SubhdProvider.prototype, 'search').mockResolvedValue([]);
    vi.spyOn(ZimukuProvider.prototype, 'search').mockResolvedValue([]);
    const assrtSpy = vi.spyOn(AssrtProvider.prototype, 'search').mockResolvedValueOnce([
      {
        id: '808080',
        provider: 'assrt',
        title: 'Unique.Cache.Test.Movie.2025.1080p',
        pageUrl: 'https://assrt.net/xml/sub/808/808080.xml',
        tags: { provider: 'assrt', lang: ['chs'], bilingual: true, fmt: ['srt'], source: [], collection: false, imdbMatched: true },
        rate: 5,
        downloadsCount: 10,
        score: 0
      }
    ]);

    try {
      const noTokenRes = await request(app).get('/subtitles/movie/tt5555555.json');
      expect(noTokenRes.body.subtitles[0].id).toBe('zimuku_1');

      const withTokenB64 = Buffer.from(JSON.stringify({ assrtToken: 'isolatedtoken123456789012345678' })).toString('base64url');
      const withTokenRes = await request(app).get(`/${withTokenB64}/subtitles/movie/tt5555555.json`);
      expect(assrtSpy).toHaveBeenCalledTimes(1);
      expect(withTokenRes.body.subtitles[0].id).toBe('assrt_808080_0');
    } finally {
      for (const k of Array.from((cacheManager as any).searchCache.keys()) as string[]) {
        if (k.includes('tt5555555')) cacheManager.deleteSearchResult(k);
      }
    }
  });

  it('caches failed upstream downloads in negative cache to avoid repeated slow retries', async () => {
    const failKey = 'zimuku:999888:0:0';
    cacheManager.clearDownloadFailed(failKey);
    const dlSpy = vi.spyOn(ZimukuProvider.prototype, 'download').mockResolvedValue(null);

    try {
      const first = await request(app).get('/subtitles/dl/zimuku/999888/0/subtitle.srt');
      expect(first.status).toBe(404);
      expect(dlSpy).toHaveBeenCalledTimes(1);

      const second = await request(app).get('/subtitles/dl/zimuku/999888/0/subtitle.srt');
      expect(second.status).toBe(404);
      expect(dlSpy).toHaveBeenCalledTimes(1);
    } finally {
      cacheManager.clearDownloadFailed(failKey);
    }
  });

  it('applies per-provider search timeout so hanging providers do not block fast providers', async () => {
    const origTimeout = process.env.SUBTITLE_PROVIDER_TIMEOUT_MS;
    process.env.SUBTITLE_PROVIDER_TIMEOUT_MS = '50';

    const customConfig = {
      subtitleSource: 'no_subhd',
      assrtToken: 'timeouttoken1234567890123456789'
    };
    const b64 = Buffer.from(JSON.stringify(customConfig)).toString('base64url');

    vi.spyOn(CinemetaClient, 'resolveMediaInfo').mockResolvedValueOnce({
      title: 'Fast Response Movie',
      year: 2025,
      resolvedImdb: 'tt6666666'
    });
    vi.spyOn(ZimukuProvider.prototype, 'search').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(AssrtProvider.prototype, 'search').mockResolvedValueOnce([
      {
        id: '909090',
        provider: 'assrt',
        title: 'Fast.Response.Movie.2025.1080p',
        pageUrl: 'https://assrt.net/xml/sub/909/909090.xml',
        tags: { provider: 'assrt', lang: ['chs'], bilingual: true, fmt: ['srt'], source: [], collection: false, imdbMatched: true },
        rate: 5,
        downloadsCount: 20,
        score: 0
      }
    ]);

    try {
      const start = Date.now();
      const res = await request(app).get(`/${b64}/subtitles/movie/tt6666666.json`);
      const elapsed = Date.now() - start;

      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(1500);
      expect(res.body.subtitles).toHaveLength(1);
      expect(res.body.subtitles[0].id).toBe('assrt_909090_0');
    } finally {
      if (origTimeout === undefined) delete process.env.SUBTITLE_PROVIDER_TIMEOUT_MS;
      else process.env.SUBTITLE_PROVIDER_TIMEOUT_MS = origTimeout;
      for (const k of Array.from((cacheManager as any).searchCache.keys()) as string[]) {
        if (k.includes('tt6666666')) cacheManager.deleteSearchResult(k);
      }
    }
  });

  it('POST /api/subhd/wechat/code, GET /status, POST /reset handle WeChat gate session', async () => {
    const tmpSession = path.join(
      os.tmpdir(),
      `subhd-route-session-${process.pid}-${Math.random().toString(36).slice(2)}.json`
    );
    const origEnv = process.env.SUBHD_SESSION_FILE;
    process.env.SUBHD_SESSION_FILE = tmpSession;
    SubhdProvider.clearBlock();

    const codeSpy = vi.spyOn(SubhdProvider.prototype, 'requestWechatCode').mockResolvedValueOnce({
      code: '447797',
      expiresAt: 1795341862000,
      qrUrl: 'https://subhd.tv/public/images/wechat-qr.jpg',
      domain: 'https://subhd.tv'
    });
    const statusSpy = vi.spyOn(SubhdProvider.prototype, 'checkWechatStatus').mockImplementation(async () => {
      subhdSession.save({
        wxg: 'mock_wxg',
        domain: 'https://subhd.tv',
        verified: true,
        verifiedAt: 1795340000000,
        expiresAt: 1797932000000
      });
      return { verified: true };
    });

    try {
      const codeRes = await request(app).post('/api/subhd/wechat/code');
      expect(codeRes.status).toBe(200);
      expect(codeRes.body).toEqual({
        success: true,
        code: '447797',
        expiresAt: 1795341862000,
        qrUrl: 'https://subhd.tv/public/images/wechat-qr.jpg',
        account: '火星研究社'
      });
      expect(codeSpy).toHaveBeenCalledTimes(1);

      SubhdProvider.markBlocked('wechat_required', 3600, 'test');
      const statusRes = await request(app).get('/api/subhd/wechat/status');
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.verified).toBe(true);
      expect(statusRes.body.verifiedAt).toBe(1795340000000);
      expect(statusRes.body.expiresAt).toBe(1797932000000);
      expect(statusRes.body.block.reason).toBe('wechat_required');
      expect(statusSpy).toHaveBeenCalledTimes(1);

      const resetRes = await request(app).post('/api/subhd/wechat/reset');
      expect(resetRes.status).toBe(200);
      expect(resetRes.body).toEqual({ success: true });
      expect(subhdSession.load()).toBeNull();
    } finally {
      subhdSession.clear();
      SubhdProvider.clearBlock();
      if (origEnv === undefined) delete process.env.SUBHD_SESSION_FILE;
      else process.env.SUBHD_SESSION_FILE = origEnv;
    }
  });

  it('skips SubHD search and isolates results under :subhd_off cache key when SubHD is blocked', async () => {
    const blockedCacheKey = 'movie:tt1122334:0:0:bilingual:all:8:subhd_off';
    const normalCacheKey = 'movie:tt1122334:0:0:bilingual:all:8';
    cacheManager.deleteSearchResult(blockedCacheKey);
    cacheManager.deleteSearchResult(normalCacheKey);

    SubhdProvider.markBlocked('turnstile_required', 3600, 'test');

    vi.spyOn(CinemetaClient, 'resolveMediaInfo').mockResolvedValueOnce({
      title: 'Fallback Only Movie',
      year: 2025,
      resolvedImdb: 'tt1122334'
    });
    const subhdSpy = vi.spyOn(SubhdProvider.prototype, 'search').mockResolvedValue([]);
    const zimukuSpy = vi.spyOn(ZimukuProvider.prototype, 'search').mockResolvedValueOnce([
      {
        id: '334455',
        provider: 'zimuku',
        title: 'Fallback.Only.Movie.2025.1080p',
        pageUrl: 'https://zmk.pw/detail/334455.html',
        tags: {
          provider: 'zimuku',
          lang: ['chs'],
          bilingual: true,
          fmt: ['srt'],
          source: [],
          collection: false,
          imdbMatched: true
        },
        rate: 5,
        downloadsCount: 120,
        score: 0
      }
    ]);

    try {
      const res = await request(app).get('/subtitles/movie/tt1122334.json');
      expect(res.status).toBe(200);
      expect(subhdSpy).not.toHaveBeenCalled();
      expect(zimukuSpy).toHaveBeenCalledTimes(1);
      expect(res.body.subtitles).toHaveLength(1);
      expect(res.body.subtitles[0].id).toBe('zimuku_334455_0');
      expect(cacheManager.getSearchResults(blockedCacheKey)).not.toBeNull();
      expect(cacheManager.getSearchResults(normalCacheKey)).toBeNull();
    } finally {
      SubhdProvider.clearBlock();
      cacheManager.deleteSearchResult(blockedCacheKey);
      cacheManager.deleteSearchResult(normalCacheKey);
    }
  });
});

