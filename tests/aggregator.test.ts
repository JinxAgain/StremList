import { describe, it, expect, vi } from 'vitest';
import { ScraperAggregator } from '../src/services/scraper/aggregator.js';
import { TorrentioScraper } from '../src/services/scraper/torrentio.js';
import { CometScraper } from '../src/services/scraper/comet.js';

describe('Scraper Aggregator Service', () => {
  it('deduplicates streams by infoHash and rewrites stream URLs to /play/:hash', async () => {
    const aggregator = new ScraperAggregator('https://torrentio.strem.fun', 'https://comet.test');

    const testHash = '0123456789abcdef0123456789abcdef01234567';

    vi.spyOn(TorrentioScraper.prototype, 'fetchStreams').mockResolvedValue([
      {
        infoHash: testHash,
        name: 'Torrentio\n1080p',
        title: 'Movie 1080p\n👤 50',
        fileIdx: 0
      }
    ]);

    vi.spyOn(CometScraper.prototype, 'fetchStreams').mockResolvedValue([
      {
        infoHash: testHash.toUpperCase(), // Test case-insensitive deduplication
        name: 'Comet\n1080p',
        title: 'Movie 1080p\n👤 100',
        fileIdx: 0
      }
    ]);

    const streams = await aggregator.fetchStreams('movie', 'tt1234567', 'http://127.0.0.1:7000');

    expect(streams).toHaveLength(1);
    expect(streams[0].url).toContain(`http://127.0.0.1:7000/play/${testHash}`);
    expect(streams[0].url).toContain('type=movie');
    expect(streams[0].url).toContain('id=tt1234567');
    expect(streams[0].name).toContain('StremList');
  });

  it('includes configPath in rewritten play URL if provided', async () => {
    const aggregator = new ScraperAggregator('https://torrentio.strem.fun', 'https://comet.test');
    const testHash = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';

    vi.spyOn(TorrentioScraper.prototype, 'fetchStreams').mockResolvedValue([
      {
        infoHash: testHash,
        name: 'Torrentio\n4K',
        title: 'Movie 4K',
        fileIdx: 0
      }
    ]);
    vi.spyOn(CometScraper.prototype, 'fetchStreams').mockResolvedValue([]);

    const streams = await aggregator.fetchStreams('movie', 'tt1234567', 'http://127.0.0.1:7000', 'custom_config_123');

    expect(streams).toHaveLength(1);
    expect(streams[0].url).toContain(`http://127.0.0.1:7000/custom_config_123/play/${testHash}`);
  });

  it('tolerates scraper failure and returns streams from healthy scrapers', async () => {
    const aggregator = new ScraperAggregator('https://torrentio.strem.fun', 'https://comet.test');
    const testHash = '1111111111222222222233333333334444444444';

    vi.spyOn(TorrentioScraper.prototype, 'fetchStreams').mockResolvedValue([
      {
        infoHash: testHash,
        name: 'Torrentio',
        title: 'Healthy Stream',
        fileIdx: 0
      }
    ]);
    vi.spyOn(CometScraper.prototype, 'fetchStreams').mockRejectedValue(new Error('Network timeout'));

    const streams = await aggregator.fetchStreams('movie', 'tt1234567', 'http://127.0.0.1:7000');

    expect(streams).toHaveLength(1);
    expect(streams[0].url).toContain(testHash);
  });
});
