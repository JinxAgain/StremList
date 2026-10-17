import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../src/app.js';
import { cacheManager } from '../../src/services/subtitles/cache/manager.js';
import { encodeConfig } from '../../src/config.js';

describe('End-to-End Subtitle Flow', () => {
  const app = createApp();
  const testCacheDir = path.resolve(process.cwd(), 'data/cache');
  const testSubFile = 'subhd_test_e2e_0.srt';
  const testSubContent = '1\n00:00:01,000 --> 00:00:03,000\nHello World from StremList E2E\n';

  beforeAll(() => {
    delete process.env.SUBTITLE_SHOW_ORIGINAL;
    delete process.env.SUBTITLE_KEEP_ORIGINAL_FORMAT;
    cacheManager.saveSubtitle(testSubFile, testSubContent);
    // Pre-populate search caches to test routing and response serialization deterministically
    cacheManager.setSearchResults('movie:tt1234567:0:0:bilingual:all:8', [
      {
        id: 'subhd_test_e2e_0',
        url: 'http://127.0.0.1:7000/subtitles/dl/subhd/test_e2e/0/Test.Movie.srt',
        path: '/subtitles/dl/subhd/test_e2e/0/Test.Movie.srt',
        lang: 'zh',
        format: 'srt',
        rating: 90
      }
    ]);
    cacheManager.setSearchResults('series:tmdb:1399:1:1:bilingual:all:8', [
      {
        id: 'subhd_test_e2e_1',
        url: 'http://127.0.0.1:7000/subtitles/dl/subhd/test_e2e_1/0/GOT.S01E01.srt',
        path: '/subtitles/dl/subhd/test_e2e_1/0/GOT.S01E01.srt',
        lang: 'zh',
        format: 'srt',
        rating: 95
      }
    ]);
  });

  afterAll(() => {
    const subPath = path.join(testCacheDir, 'subtitles', testSubFile);
    if (fs.existsSync(subPath)) {
      try {
        fs.unlinkSync(subPath);
      } catch {}
    }
  });

  it('serves manifest with clean stream & subtitle resources', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.body.resources).toEqual(
      expect.arrayContaining(['stream', expect.objectContaining({ name: 'subtitles' })])
    );
    const subResource = res.body.resources.find((r: any) => typeof r === 'object' && r.name === 'subtitles');
    expect(subResource.idPrefixes).toContain('tt');
    expect(subResource.idPrefixes).toContain('tmdb');
    expect(subResource.idPrefixes).toContain('kitsu');
  });

  it('omits subtitles from manifest when disabled via encoded config', async () => {
    const customConfig = { subtitleEnabled: false };
    const b64 = encodeConfig(customConfig as any);
    const res = await request(app).get(`/${b64}/manifest.json`);
    expect(res.status).toBe(200);
    const subResource = res.body.resources.find((r: any) => typeof r === 'object' && r.name === 'subtitles');
    expect(subResource).toBeUndefined();
  });

  it('serves cached subtitle download directly with correct headers', async () => {
    const res = await request(app).get('/subtitles/dl/subhd/test_e2e/0/Test.Movie.srt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.text).toBe(testSubContent);
  });

  it('sanitizes Harbor newlines in subtitle queries without 404', async () => {
    const res = await request(app).get('/subtitles/movie/tt1234567%0A.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('subtitles');
    expect(Array.isArray(res.body.subtitles)).toBe(true);
    expect(res.body.subtitles.length).toBeGreaterThan(0);
  });

  it('handles Harbor tmdb format gracefully', async () => {
    const res = await request(app).get('/subtitles/series/tmdb:1399:1:1.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('subtitles');
    expect(Array.isArray(res.body.subtitles)).toBe(true);
  });
});
