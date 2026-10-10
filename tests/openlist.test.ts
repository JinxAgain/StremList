import { describe, it, expect, vi } from 'vitest';
import { OpenListClient } from '../src/services/openlist/client.js';
import { PlaybackResolver } from '../src/services/openlist/resolver.js';
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

    let pollCount = 0;
    vi.spyOn(client, 'list').mockImplementation(async () => {
      pollCount++;
      if (pollCount < 3) {
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
});
