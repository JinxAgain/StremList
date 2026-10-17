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

  it('correctly labels cached streams with ⚡ and uncached with ⬇️ based on OpenList', async () => {
    const cachedHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const uncachedHash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const mockOpenListClient = {
      getAllCachedHashes: vi.fn().mockResolvedValue(new Set([cachedHash]))
    } as any;

    const aggregator = new ScraperAggregator(
      'https://torrentio.strem.fun',
      'https://comet.test',
      mockOpenListClient,
      '115'
    );

    vi.spyOn(TorrentioScraper.prototype, 'fetchStreams').mockResolvedValue([
      {
        infoHash: uncachedHash,
        name: 'Torrentio 1080p',
        title: 'Uncached Movie 1080p',
        fileIdx: 0
      },
      {
        infoHash: cachedHash,
        name: 'Torrentio 1080p',
        title: 'Cached Movie 1080p',
        fileIdx: 0
      }
    ]);
    vi.spyOn(CometScraper.prototype, 'fetchStreams').mockResolvedValue([]);

    const streams = await aggregator.fetchStreams('movie', 'tt1234567', 'http://127.0.0.1:7000');

    expect(streams).toHaveLength(2);
    // Cached stream sorted first, with ⚡
    expect(streams[0].url).toContain(cachedHash);
    expect(streams[0].name).toContain('[115⚡]');

    // Uncached stream sorted second, with 🧲
    expect(streams[1].url).toContain(uncachedHash);
    expect(streams[1].name).toContain('[115🧲]');
  });

  it('preserves Comet description and behaviorHints', async () => {
    const testHash = 'cccccccccccccccccccccccccccccccccccccccc';
    const aggregator = new ScraperAggregator('https://torrentio.strem.fun', 'https://comet.test');

    vi.spyOn(TorrentioScraper.prototype, 'fetchStreams').mockResolvedValue([]);
    vi.spyOn(CometScraper.prototype, 'fetchStreams').mockResolvedValue([
      {
        infoHash: testHash,
        name: 'Comet 2160p',
        title: 'Full Title from Comet\n💾 15 GB 👤 500',
        description: 'Full Title from Comet\n💾 15 GB 👤 500',
        behaviorHints: {
          filename: 'Movie.2024.2160p.mkv',
          videoSize: 16106127360
        }
      }
    ]);

    const streams = await aggregator.fetchStreams('movie', 'tt1234567', 'http://127.0.0.1:7000');

    expect(streams).toHaveLength(1);
    expect(streams[0].title).toBe('Full Title from Comet\n💾 15 GB 👤 500');
    expect(streams[0].behaviorHints?.filename).toBe('Movie.2024.2160p.mkv');
    expect(streams[0].behaviorHints?.videoSize).toBe(16106127360);
  });

  it('does not label streams with ⚡ if the hash folder exists but contains 0 files', async () => {
    const emptyHash = 'dddddddddddddddddddddddddddddddddddddddd';

    const mockOpenListClient = {
      getAllCachedHashes: vi.fn().mockResolvedValue(new Set([emptyHash])),
      hasCachedContent: vi.fn().mockResolvedValue(false) // Folder exists but has 0 files
    } as any;

    const aggregator = new ScraperAggregator(
      'https://torrentio.strem.fun',
      'https://comet.test',
      mockOpenListClient,
      '115'
    );

    vi.spyOn(TorrentioScraper.prototype, 'fetchStreams').mockResolvedValue([
      {
        infoHash: emptyHash,
        name: 'Torrentio 1080p',
        title: 'Empty Folder Movie 1080p',
        fileIdx: 0
      }
    ]);
    vi.spyOn(CometScraper.prototype, 'fetchStreams').mockResolvedValue([]);

    const streams = await aggregator.fetchStreams('movie', 'tt1234567', 'http://127.0.0.1:7000');
    expect(streams).toHaveLength(1);
    // Crucially: marked with 🧲 (uncached), NEVER ⚡!
    expect(streams[0].name).toContain('[115🧲]');
    expect(streams[0].name).not.toContain('⚡');
  });
});
