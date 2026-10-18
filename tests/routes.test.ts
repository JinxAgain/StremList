import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { saveConfigToEnv } from '../src/config.js';

describe('HTTP Routes & Stremio Addon Protocol', () => {
  const app = createApp();

  afterAll(() => {
    delete process.env.SUBTITLE_ENABLED;
    delete process.env.SUBTITLE_LANG;
    delete process.env.SUBTITLE_SOURCE;
    delete process.env.SUBTITLE_MAX_RESULTS;
    delete process.env.SUBTITLE_PROXY;
    delete process.env.SUBTITLE_SHOW_ORIGINAL;
    delete process.env.SUBTITLE_KEEP_ORIGINAL_FORMAT;
    saveConfigToEnv({
      SUBTITLE_ENABLED: 'true',
      SUBTITLE_LANG: 'bilingual',
      SUBTITLE_SOURCE: 'all',
      SUBTITLE_MAX_RESULTS: '8',
      SUBTITLE_PROXY: '',
      SUBTITLE_SHOW_ORIGINAL: 'false',
      SUBTITLE_KEEP_ORIGINAL_FORMAT: 'false'
    });
  });

  it('GET /manifest.json returns valid Stremio Addon manifest', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('org.stremio.stremlist');
    expect(res.body.version).toBe('0.3.0');
    expect(res.body.logo).toContain('/logo.png');
    expect(res.body.resources).toContain('stream');
    expect(res.body.types).toContain('movie');
    expect(res.body.types).toContain('series');
  });

  it('GET /logo.png serves cinephile addon icon', async () => {
    const res = await request(app).get('/logo.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image');
  });

  it('GET /:config/manifest.json returns manifest for configured endpoint', async () => {
    const res = await request(app).get('/testconfig123/manifest.json');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('org.stremio.stremlist');
    expect(res.body.version).toBe('0.3.0');
  });

  it('GET /configure serves HTML configuration page', async () => {
    const res = await request(app).get('/configure');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('StremList');
    expect(res.text).toContain('OpenList');
  });

  it('POST /api/config/save updates and persists configuration', async () => {
    const res = await request(app)
      .post('/api/config/save')
      .send({
        openlistUrl: 'http://127.0.0.1:5244',
        openlistToken: 'saved-token-123',
        defaultDrive: '115'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(process.env.OPENLIST_TOKEN).toBe('saved-token-123');
    expect(process.env.DEFAULT_DRIVE).toBe('115');
  });

  it('POST /api/config/save updates subtitle configuration', async () => {
    try {
      const res = await request(app)
        .post('/api/config/save')
        .send({
          subtitleEnabled: false,
          subtitleLang: 'chs',
          subtitleSource: 'zimuku',
          subtitleMaxResults: 5,
          subtitleProxy: 'http://127.0.0.1:7890',
          subtitleShowOriginal: true,
          subtitleKeepOriginalFormat: true
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(process.env.SUBTITLE_ENABLED).toBe('false');
      expect(process.env.SUBTITLE_LANG).toBe('chs');
      expect(process.env.SUBTITLE_SOURCE).toBe('zimuku');
      expect(process.env.SUBTITLE_MAX_RESULTS).toBe('5');
      expect(process.env.SUBTITLE_PROXY).toBe('http://127.0.0.1:7890');
      expect(process.env.SUBTITLE_SHOW_ORIGINAL).toBe('true');
      expect(process.env.SUBTITLE_KEEP_ORIGINAL_FORMAT).toBe('true');

      // Verify GET /configure reflects the checked status
      const getRes = await request(app).get('/configure');
      expect(getRes.status).toBe(200);
      expect(getRes.text).toContain('id="subtitleShowOriginal" checked');
      expect(getRes.text).toContain('id="subtitleKeepOriginalFormat" checked');
    } finally {
      delete process.env.SUBTITLE_ENABLED;
      delete process.env.SUBTITLE_LANG;
      delete process.env.SUBTITLE_SOURCE;
      delete process.env.SUBTITLE_MAX_RESULTS;
      delete process.env.SUBTITLE_PROXY;
      delete process.env.SUBTITLE_SHOW_ORIGINAL;
      delete process.env.SUBTITLE_KEEP_ORIGINAL_FORMAT;
      saveConfigToEnv({
        SUBTITLE_ENABLED: 'true',
        SUBTITLE_LANG: 'bilingual',
        SUBTITLE_SOURCE: 'all',
        SUBTITLE_MAX_RESULTS: '8',
        SUBTITLE_PROXY: '',
        SUBTITLE_SHOW_ORIGINAL: 'false',
        SUBTITLE_KEEP_ORIGINAL_FORMAT: 'false'
      });
      delete process.env.SUBTITLE_SHOW_ORIGINAL;
      delete process.env.SUBTITLE_KEEP_ORIGINAL_FORMAT;
    }
  });
});
