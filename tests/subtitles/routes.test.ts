import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

describe('Subtitle & Harbor Routes', () => {
  const app = createApp();

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
});
