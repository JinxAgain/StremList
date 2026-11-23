import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenListClient } from '../src/services/openlist/client.js';
import { PlaybackResolver, clearPlayUrlCache } from '../src/services/openlist/resolver.js';
import { AppConfig } from '../src/config.js';

const mockConfig: AppConfig = {
  port: 7000,
  openlistUrl: 'http://127.0.0.1:5244',
  openlistToken: 'mock-token',
  defaultDrive: '115',
  torrentioUrl: '',
  cometUrl: '',
  pollTimeout: 2, // 2 seconds for test speed
  pollInterval: 100 // 100ms for test speed
};

describe('OpenList Client & Playback Resolver', () => {
  beforeEach(() => {
    clearPlayUrlCache();
    OpenListClient.clearRawUrlCache();
    vi.restoreAllMocks();
  });
  it('returns direct link immediately if file is already cached in default drive', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');

    vi.spyOn(client, 'list').mockResolvedValue({
      content: [
        { name: 'Inception.2010.1080p.mkv', size: 10 * 1024 * 1024 * 1024, is_dir: false }
      ]
    });
    vi.spyOn(client, 'getRawUrl').mockResolvedValue('https://115.com/download/direct_inception.mkv');
    const addOfflineSpy = vi.spyOn(client, 'addOfflineDownload');

    const resolver = new PlaybackResolver(client, mockConfig);
    const url = await resolver.resolvePlayUrl('testhash123', { type: 'movie' });

    expect(url).toBe('https://115.com/download/direct_inception.mkv');
    expect(addOfflineSpy).not.toHaveBeenCalled();
  });

  it('checks fallback drive if default drive has no cache', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');
    vi.spyOn(client, 'getMountedDrives').mockResolvedValue(['115', 'PikPak']);

    vi.spyOn(client, 'list').mockImplementation(async (path: string) => {
      if (path.startsWith('/115/')) {
        return { content: [] };
      }
      if (path.toLowerCase().startsWith('/pikpak/')) {
        return {
          content: [
            { name: 'Inception.2010.1080p.mkv', size: 10 * 1024 * 1024 * 1024, is_dir: false }
          ]
        };
      }
      return { content: [] };
    });
    vi.spyOn(client, 'getRawUrl').mockResolvedValue('https://pikpak.me/download/direct_inception.mkv');
    const addOfflineSpy = vi.spyOn(client, 'addOfflineDownload');

    const resolver = new PlaybackResolver(client, mockConfig);
    const url = await resolver.resolvePlayUrl('testhash123', { type: 'movie' });

    expect(url).toBe('https://pikpak.me/download/direct_inception.mkv');
    expect(addOfflineSpy).not.toHaveBeenCalled();
  });

  it('triggers offline task and polls until video appears on cache miss', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');
    vi.spyOn(client, 'getMountedDrives').mockResolvedValue(['115']);

    let pollCount = 0;
    vi.spyOn(client, 'list').mockImplementation(async () => {
      pollCount++;
      if (pollCount < 4) {
        return { content: [] };
      }
      return {
        content: [
          { name: 'Oppenheimer.2023.1080p.mkv', size: 8 * 1024 * 1024 * 1024, is_dir: false }
        ]
      };
    });

    const addOfflineSpy = vi.spyOn(client, 'addOfflineDownload').mockResolvedValue(true);
    vi.spyOn(client, 'getRawUrl').mockResolvedValue('https://115.com/download/oppenheimer.mkv');

    const resolver = new PlaybackResolver(client, mockConfig);
    const url = await resolver.resolvePlayUrl('oppenheimerhash', { type: 'movie' });

    expect(addOfflineSpy).toHaveBeenCalledWith(
      '/115/StremList/oppenheimerhash',
      ['magnet:?xt=urn:btih:oppenheimerhash'],
      '115'
    );
    expect(url).toBe('https://115.com/download/oppenheimer.mkv');
  });

  it('throws OFFLINE_DOWNLOAD_TIMEOUT if video does not appear before timeout', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');

    vi.spyOn(client, 'list').mockResolvedValue({ content: [] });
    vi.spyOn(client, 'addOfflineDownload').mockResolvedValue(true);

    const resolver = new PlaybackResolver(client, {
      ...mockConfig,
      pollTimeout: 0.3, // 300ms
      pollInterval: 50
    });

    await expect(resolver.resolvePlayUrl('slowdownloadhash', { type: 'movie' }))
      .rejects
      .toThrow('OFFLINE_DOWNLOAD_TIMEOUT');
  });

  it('aborts polling immediately when abort callback is triggered', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');

    vi.spyOn(client, 'list').mockResolvedValue({ content: [] });
    vi.spyOn(client, 'addOfflineDownload').mockResolvedValue(true);

    const resolver = new PlaybackResolver(client, {
      ...mockConfig,
      pollTimeout: 5,
      pollInterval: 100
    });

    let triggerAbort: (() => void) | undefined;
    const playPromise = resolver.resolvePlayUrl(
      'aborthash',
      { type: 'movie' },
      (abortFn) => {
        triggerAbort = abortFn;
      }
    );

    // Trigger client abort after 150ms
    setTimeout(() => {
      if (triggerAbort) triggerAbort();
    }, 150);

    await expect(playPromise).rejects.toThrow('CLIENT_ABORTED');
  });

  it('getRawUrl for 115 returns OpenList /d/ proxy stream link with sign', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');

    vi.spyOn(client as any, 'request').mockResolvedValue({
      code: 200,
      message: 'success',
      data: {
        raw_url: 'https://cdnfhnfile.115cdn.net/123/movie.mkv?k=test',
        sign: 'mocksig123'
      }
    });

    const url = await client.getRawUrl('/115/StremList/hash/movie.mkv');
    expect(url).toBe('http://127.0.0.1:5244/d/115/StremList/hash/movie.mkv?sign=mocksig123');
  });

  it('getRawUrl prepends baseUrl if raw_url is a relative path', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');

    vi.spyOn(client as any, 'request').mockResolvedValue({
      code: 200,
      message: 'success',
      data: {
        raw_url: '/d/PikPak/StremList/hash/movie.mkv?sign=mocksig456',
        sign: 'mocksig456'
      }
    });

    const url = await client.getRawUrl('/PikPak/StremList/hash/movie.mkv');
    expect(url).toBe('http://127.0.0.1:5244/d/PikPak/StremList/hash/movie.mkv?sign=mocksig456');
  });

  it('automatically attempts token refresh when receiving 401 from OpenList', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'expired-token');
    const refreshSpy = vi.spyOn(client, 'refreshToken').mockResolvedValue('refreshed-new-token');

    let callCount = 0;
    vi.spyOn((client as any).http, 'post').mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return { data: { code: 401, message: 'token is expired' } };
      }
      return {
        data: {
          code: 200,
          data: { content: [{ name: 'test.mkv', size: 1000, is_dir: false }] }
        }
      };
    });

    const res = await client.list('/115');
    expect(refreshSpy).toHaveBeenCalled();
    expect(res.content?.length).toBe(1);
    expect(res.content?.[0].name).toBe('test.mkv');
  });

  it('caches resolved play URLs to avoid duplicate API calls on subsequent requests', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');
    vi.spyOn(client, 'list').mockResolvedValue({
      content: [{ name: 'Movie.2024.mkv', size: 1000, is_dir: false }]
    });
    const getRawSpy = vi.spyOn(client, 'getRawUrl').mockResolvedValue('https://115.com/direct/movie.mkv');

    const resolver = new PlaybackResolver(client, mockConfig);
    const url1 = await resolver.resolvePlayUrl('cachetest1', { type: 'movie' });
    const url2 = await resolver.resolvePlayUrl('cachetest1', { type: 'movie' });

    expect(url1).toBe('https://115.com/direct/movie.mkv');
    expect(url2).toBe('https://115.com/direct/movie.mkv');
    expect(getRawSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent in-flight resolution requests into a single OpenList call', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');
    vi.spyOn(client, 'list').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { content: [{ name: 'Concurrent.2024.mkv', size: 1000, is_dir: false }] };
    });
    const getRawSpy = vi.spyOn(client, 'getRawUrl').mockResolvedValue('https://115.com/direct/concurrent.mkv');

    const resolver = new PlaybackResolver(client, mockConfig);
    const [url1, url2, url3] = await Promise.all([
      resolver.resolvePlayUrl('inflighttest', { type: 'movie' }),
      resolver.resolvePlayUrl('inflighttest', { type: 'movie' }),
      resolver.resolvePlayUrl('inflighttest', { type: 'movie' })
    ]);

    expect(url1).toBe('https://115.com/direct/concurrent.mkv');
    expect(url2).toBe('https://115.com/direct/concurrent.mkv');
    expect(url3).toBe('https://115.com/direct/concurrent.mkv');
    expect(getRawSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to live refresh when a recent offline task exists to prevent duplicate offline downloads', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');
    vi.spyOn(client, 'getMountedDrives').mockResolvedValue(['115']);

    let fileReadyInCloud = false;
    vi.spyOn(client, 'list').mockImplementation(async (_path: string, refresh?: boolean) => {
      if (!fileReadyInCloud || !refresh) {
        return { content: [] };
      }
      return {
        content: [{ name: 'Below.S01E03.2160p.mkv', size: 5 * 1024 * 1024 * 1024, is_dir: false }]
      };
    });

    const addOfflineSpy = vi.spyOn(client, 'addOfflineDownload').mockResolvedValue(true);
    vi.spyOn(client, 'getRawUrl').mockResolvedValue('https://115.com/direct/below_e03.mkv');

    const fastResolver = new PlaybackResolver(client, {
      ...mockConfig,
      pollTimeout: 0.15,
      pollInterval: 50
    });

    // 1st attempt: submits offline download and times out before file is ready
    await expect(
      fastResolver.resolvePlayUrl('belowhash123', { type: 'series', season: 1, episode: 3 })
    ).rejects.toThrow('OFFLINE_DOWNLOAD_TIMEOUT');
    expect(addOfflineSpy).toHaveBeenCalledTimes(1);

    // Cloud completes download right after; 2nd request should force refresh parent + targetPath and hit cache immediately
    fileReadyInCloud = true;
    const url = await fastResolver.resolvePlayUrl('belowhash123', { type: 'series', season: 1, episode: 3 });

    expect(url).toBe('https://115.com/direct/below_e03.mkv');
    expect(addOfflineSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps in-flight polling alive for remaining subscribers when the first subscriber disconnects', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');
    vi.spyOn(client, 'getMountedDrives').mockResolvedValue(['PikPak']);
    vi.spyOn(client, 'addOfflineDownload').mockResolvedValue(true);
    vi.spyOn(client, 'getRawUrl').mockResolvedValue('https://pikpak.me/direct/episode4.mkv');

    let hashFolderVisible = false;
    const listedPaths: Array<{ path: string; refresh: boolean }> = [];
    vi.spyOn(client, 'list').mockImplementation(async (path: string, refresh = false) => {
      listedPaths.push({ path, refresh });
      if (path === '/PikPak/StremList' && refresh) {
        hashFolderVisible = true;
        return {
          content: [{ name: '88513d3f9b08044cc1269cbce9a97f42fae4dd1d', size: 0, is_dir: true }]
        };
      }
      if (
        path === '/PikPak/StremList/88513d3f9b08044cc1269cbce9a97f42fae4dd1d' &&
        refresh &&
        hashFolderVisible &&
        listedPaths.filter((p) => p.path === path && p.refresh).length >= 2
      ) {
        return {
          content: [{ name: 'Show.S02E04.1080p.mkv', size: 2 * 1024 * 1024 * 1024, is_dir: false }]
        };
      }
      return { content: [] };
    });

    const resolver = new PlaybackResolver(client, {
      ...mockConfig,
      defaultDrive: 'pikpak',
      pollTimeout: 3,
      pollInterval: 80
    });

    let abortProbeClient: (() => void) | undefined;
    const probePromise = resolver.resolvePlayUrl(
      '88513d3f9b08044cc1269cbce9a97f42fae4dd1d',
      { type: 'series', season: 2, episode: 4 },
      (fn) => {
        abortProbeClient = fn;
      }
    );

    let abortMpvClient: (() => void) | undefined;
    const mpvPromise = resolver.resolvePlayUrl(
      '88513d3f9b08044cc1269cbce9a97f42fae4dd1d',
      { type: 'series', season: 2, episode: 4 },
      (fn) => {
        abortMpvClient = fn;
      }
    );

    // Disconnect probe client #1 after 90ms (during first poll)
    setTimeout(() => {
      abortProbeClient?.();
    }, 90);

    await expect(probePromise).rejects.toThrow('CLIENT_ABORTED');
    const mpvUrl = await mpvPromise;
    expect(mpvUrl).toBe('https://pikpak.me/direct/episode4.mkv');
    expect(abortMpvClient).toBeDefined();

    // Verify parent /PikPak/StremList was refreshed before target hash folder succeeded
    const firstParentRefreshIdx = listedPaths.findIndex(
      (p) => p.path === '/PikPak/StremList' && p.refresh === true
    );
    expect(firstParentRefreshIdx).toBeGreaterThanOrEqual(0);
  });

  it('shares static mountedDrivesCache and cachedHashesCache across OpenListClient instances and updates via markHashCached', async () => {
    const client1 = new OpenListClient('http://127.0.0.1:5244', 'mock-token');
    const client2 = new OpenListClient('http://127.0.0.1:5244', 'mock-token');

    const hashA = '1111111111111111111111111111111111111111';
    const hashB = '2222222222222222222222222222222222222222';

    const listSpy1 = vi.spyOn(client1, 'list').mockImplementation(async (path: string) => {
      if (path === '/') {
        return { content: [{ name: 'PikPak', size: 0, is_dir: true }] };
      }
      if (path === '/PikPak/StremList') {
        return { content: [{ name: hashA, size: 0, is_dir: true }] };
      }
      return { content: [] };
    });
    const listSpy2 = vi.spyOn(client2, 'list');

    const hashes1 = await client1.getAllCachedHashes();
    expect(hashes1.has(hashA)).toBe(true);
    expect(listSpy1).toHaveBeenCalled();

    // Second instance should hit static cache without calling list()
    const hashes2 = await client2.getAllCachedHashes();
    expect(hashes2.has(hashA)).toBe(true);
    expect(listSpy2).not.toHaveBeenCalled();

    // markHashCached on client2 should immediately reflect in static cache
    client2.markHashCached(hashB);
    const hashes3 = await client1.getAllCachedHashes();
    expect(hashes3.has(hashB)).toBe(true);
  });

  it('skips duplicate addOfflineDownload if called again for the same infoHash within recent window', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');
    vi.spyOn(client, 'getMountedDrives').mockResolvedValue(['PikPak']);
    vi.spyOn(client, 'list').mockResolvedValue({ content: [] });
    const addOfflineSpy = vi.spyOn(client, 'addOfflineDownload').mockResolvedValue(true);

    const fastTimeoutResolver = new PlaybackResolver(client, {
      ...mockConfig,
      defaultDrive: 'PikPak',
      pollTimeout: 0.2,
      pollInterval: 50
    });

    // First attempt times out
    await expect(fastTimeoutResolver.resolvePlayUrl('dupetest123', { type: 'movie' })).rejects.toThrow(
      'OFFLINE_DOWNLOAD_TIMEOUT'
    );
    expect(addOfflineSpy).toHaveBeenCalledTimes(1);

    // Second attempt (retry after timeout) should NOT dispatch addOfflineDownload again
    await expect(fastTimeoutResolver.resolvePlayUrl('dupetest123', { type: 'movie' })).rejects.toThrow(
      'OFFLINE_DOWNLOAD_TIMEOUT'
    );
    expect(addOfflineSpy).toHaveBeenCalledTimes(1);
  });

  it('selects full movie in subdirectory over ad video file in root folder', async () => {
    const client = new OpenListClient('http://127.0.0.1:5244', 'mock-token');
    vi.spyOn(client, 'getMountedDrives').mockResolvedValue(['PikPak']);

    vi.spyOn(client, 'list').mockImplementation(async (path: string) => {
      if (path === '/PikPak/StremList/adtesthash') {
        return {
          content: [
            {
              name: '【更多无水印高清电影请访问 www.HDBTHD.com】【更多无水印高清电影请访问 www.HDBTHD.com】.MKV',
              size: 636976,
              is_dir: false
            },
            {
              name: '【高清影视之家发布 www.HDBTHD.com】速度与激情',
              size: 0,
              is_dir: true
            }
          ]
        };
      }
      if (path === '/PikPak/StremList/adtesthash/【高清影视之家发布 www.HDBTHD.com】速度与激情') {
        return {
          content: [
            {
              name: 'The.Fast.and.the.Furious.2001.2160p.UHD.BluRay.x265.10bit.mkv',
              size: 19 * 1024 * 1024 * 1024,
              is_dir: false
            }
          ]
        };
      }
      return { content: [] };
    });

    vi.spyOn(client, 'getRawUrl').mockImplementation(async (path: string) => {
      return `https://pikpak.me/download${path}`;
    });

    const resolver = new PlaybackResolver(client, { ...mockConfig, defaultDrive: 'PikPak' });
    const resolvedUrl = await resolver.resolvePlayUrl('adtesthash', { type: 'movie' });

    expect(resolvedUrl).toContain('The.Fast.and.the.Furious.2001.2160p.UHD.BluRay.x265.10bit.mkv');
    expect(resolvedUrl).not.toContain('更多无水印高清电影请访问');
  });
});
