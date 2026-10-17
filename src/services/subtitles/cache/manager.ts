import fs from 'fs';
import path from 'path';
import { SubtitleItem } from '../types.js';

interface CacheEntry {
  data: SubtitleItem[];
  createdAt: number;
}

export class CacheManager {
  private readonly cacheDir: string;
  private readonly subtitlesDir: string;
  private readonly searchCacheFile: string;
  private searchCache = new Map<string, CacheEntry>();
  private readonly ttlSeconds: number;
  private flightLocks = new Map<string, Promise<void>>();
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(customCacheDir?: string, ttlHours = 12) {
    this.cacheDir = customCacheDir || path.resolve(process.cwd(), 'data/cache');
    this.subtitlesDir = path.join(this.cacheDir, 'subtitles');
    this.searchCacheFile = path.join(this.cacheDir, 'search_cache.json');
    this.ttlSeconds = ttlHours * 3600;

    this.ensureDirectories();
    this.loadSearchCache();
  }

  private ensureDirectories(): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.mkdirSync(this.subtitlesDir, { recursive: true });
    } catch {}
  }

  private loadSearchCache(): void {
    try {
      if (fs.existsSync(this.searchCacheFile)) {
        const raw = fs.readFileSync(this.searchCacheFile, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
        const now = Math.floor(Date.now() / 1000);
        for (const [k, v] of Object.entries(parsed)) {
          if (now - v.createdAt < this.ttlSeconds) {
            this.searchCache.set(k, v);
          }
        }
      }
    } catch {
      // Ignore corrupted cache file
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      try {
        const obj: Record<string, CacheEntry> = {};
        for (const [k, v] of this.searchCache.entries()) {
          obj[k] = v;
        }
        fs.writeFileSync(this.searchCacheFile, JSON.stringify(obj), 'utf-8');
      } catch {}
    }, 2000);
  }

  public getSearchResults(key: string): SubtitleItem[] | null {
    const entry = this.searchCache.get(key);
    if (!entry) return null;

    const now = Math.floor(Date.now() / 1000);
    if (now - entry.createdAt < this.ttlSeconds) {
      return entry.data;
    } else {
      this.searchCache.delete(key);
      this.scheduleSave();
      return null;
    }
  }

  public setSearchResults(key: string, data: SubtitleItem[]): void {
    if (!data || data.length === 0) return;
    this.searchCache.set(key, {
      data,
      createdAt: Math.floor(Date.now() / 1000)
    });
    this.scheduleSave();
  }

  public getSubtitlePath(filename: string): string {
    return path.join(this.subtitlesDir, filename);
  }

  public hasSubtitle(filename: string): boolean {
    const filePath = this.getSubtitlePath(filename);
    try {
      if (!fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      if (stat.size < 20) return false;

      // Ensure content is valid subtitle (SRT, ASS, SSA, or VTT)
      const fd = fs.openSync(filePath, 'r');
      const sample = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, sample, 0, 4096, 0);
      fs.closeSync(fd);

      if (bytesRead > 0) {
        const sampleStr = sample.toString('utf-8', 0, bytesRead);
        if (
          sampleStr.includes('-->') ||
          sampleStr.includes('[Script Info]') ||
          sampleStr.includes('[Events]') ||
          sampleStr.includes('Dialogue:') ||
          sampleStr.includes('WEBVTT')
        ) {
          return true;
        }
      }
      fs.unlinkSync(filePath);
      return false;
    } catch {
      return false;
    }
  }

  public getSubtitle(filename: string): Buffer | null {
    const filePath = this.getSubtitlePath(filename);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
    } catch {}
    return null;
  }

  public saveSubtitle(filename: string, content: Buffer | string): void {
    const filePath = this.getSubtitlePath(filename);
    try {
      if (typeof content === 'string') {
        fs.writeFileSync(filePath, content, 'utf-8');
      } else {
        fs.writeFileSync(filePath, content);
      }
    } catch (err) {
      console.error(`[CacheManager] Failed to save subtitle ${filename}:`, err);
    }
  }

  public cleanExpired(): void {
    const now = Math.floor(Date.now() / 1000);
    let changed = false;
    for (const [k, v] of this.searchCache.entries()) {
      if (now - v.createdAt >= this.ttlSeconds) {
        this.searchCache.delete(k);
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
  }

  public async getFlightLock(key: string): Promise<() => void> {
    while (this.flightLocks.has(key)) {
      await this.flightLocks.get(key);
    }

    let resolveFn: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });

    this.flightLocks.set(key, lockPromise);

    return () => {
      this.flightLocks.delete(key);
      resolveFn();
    };
  }
}

export const cacheManager = new CacheManager();
