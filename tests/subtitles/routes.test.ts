import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { cacheManager } from '../../src/services/subtitles/cache/manager.js';

describe('Subtitle & Harbor Routes', () => {
  const app = createApp();

  beforeEach(() => {
    delete process.env.SUBTITLE_SHOW_ORIGINAL;
    delete process.env.SUBTITLE_KEEP_ORIGINAL_FORMAT;
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
});
