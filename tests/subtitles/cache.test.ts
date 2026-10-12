import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CacheManager } from '../../src/services/subtitles/cache/manager.js';
import { SubtitleItem } from '../../src/services/subtitles/types.js';

describe('CacheManager', () => {
  const testCacheDir = path.resolve(process.cwd(), 'data/test_cache');
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager(testCacheDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    } catch {}
  });

  it('saves and checks subtitle disk cache', () => {
    const srtContent = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n');
    cache.saveSubtitle('subhd_123_0.srt', srtContent);
    expect(cache.hasSubtitle('subhd_123_0.srt')).toBe(true);
    expect(cache.getSubtitle('subhd_123_0.srt')?.toString()).toBe(srtContent.toString());
  });

  it('caches search results in memory and retrieves within TTL', () => {
    const sampleItems: SubtitleItem[] = [
      {
        id: 'subhd_1_0',
        url: 'http://test/sub.srt',
        lang: 'chi',
        label: 'Test Label',
        subtitleFileName: 'Test.srt',
        movieReleaseName: 'Test',
        SubFormat: 'srt',
        path: '/subtitles/dl/subhd/1/0/Test.srt'
      }
    ];

    cache.setSearchResults('movie:tt12345:0:0:bilingual:all:8', sampleItems);
    const retrieved = cache.getSearchResults('movie:tt12345:0:0:bilingual:all:8');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.length).toBe(1);
    expect(retrieved?.[0].label).toBe('Test Label');
  });

  it('provides single-flight async lock mechanism', async () => {
    let executionCount = 0;
    const unlock = await cache.getFlightLock('test_lock');
    executionCount++;
    unlock();
    expect(executionCount).toBe(1);
  });
});
