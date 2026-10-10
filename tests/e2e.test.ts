import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ScraperAggregator } from '../src/services/scraper/aggregator.js';
import { OpenListClient } from '../src/services/openlist/client.js';

describe('End-to-End Workflow Verification', () => {
  const app = createApp();

  it('performs end-to-end flow: discovery -> stream list -> play resolution 302', async () => {
    const testHash = 'abcdef0123456789abcdef0123456789abcdef01';

    // 1. Mock scraper streams for movie tt0111161
    vi.spyOn(ScraperAggregator.prototype, 'fetchStreams').mockResolvedValue([
      {
        name: '[StremList ⚡ 115/PikPak]',
        title: 'The Shawshank Redemption 1080p',
        url: `http://127.0.0.1:7000/play/${testHash}?type=movie&id=tt0111161&title=Shawshank`
      }
    ]);

    // 2. Query stream list endpoint
    const streamRes = await request(app).get('/stream/movie/tt0111161.json');
    expect(streamRes.status).toBe(200);
    expect(streamRes.body.streams).toHaveLength(1);
    expect(streamRes.body.streams[0].url).toContain(`/play/${testHash}`);

    // 3. Mock OpenList returning cached file
    vi.spyOn(OpenListClient.prototype, 'list').mockResolvedValue({
      content: [
        { name: 'The.Shawshank.Redemption.1080p.mkv', size: 12 * 1024 * 1024 * 1024, is_dir: false }
      ]
    });
    vi.spyOn(OpenListClient.prototype, 'getRawUrl').mockResolvedValue(
      'https://115.com/direct/shawshank.mkv'
    );

    // 4. Click play: GET /play/:hash -> verify 302 Found redirect
    const playRes = await request(app).get(`/play/${testHash}?type=movie&id=tt0111161`);
    expect(playRes.status).toBe(302);
    expect(playRes.headers.location).toBe('https://115.com/direct/shawshank.mkv');
  });
});
