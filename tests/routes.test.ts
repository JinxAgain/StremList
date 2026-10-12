import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('HTTP Routes & Stremio Addon Protocol', () => {
  const app = createApp();

  it('GET /manifest.json returns valid Stremio Addon manifest', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('org.stremio.stremlist');
    expect(res.body.resources).toContain('stream');
    expect(res.body.types).toContain('movie');
    expect(res.body.types).toContain('series');
  });

  it('GET /:config/manifest.json returns manifest for configured endpoint', async () => {
    const res = await request(app).get('/testconfig123/manifest.json');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('org.stremio.stremlist');
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
});
