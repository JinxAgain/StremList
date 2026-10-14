import { OpenListClient } from './client.js';
import { AppConfig } from '../../config.js';
import { MatchTarget, matchPlayableFile, FileItem } from '../matcher/file-matcher.js';

export function normalizeDriveName(drive: string): string {
  const lower = drive.toLowerCase();
  if (lower === 'pikpak') return 'PikPak';
  if (lower === '115') return '115';
  return drive;
}

interface CachedPlayUrl {
  url: string;
  expiresAt: number;
}

// Module-level caches shared across resolver instances
const playUrlCache = new Map<string, CachedPlayUrl>();
const inFlightResolutions = new Map<string, Promise<string>>();

export function clearPlayUrlCache(): void {
  playUrlCache.clear();
  inFlightResolutions.clear();
}

function buildCacheKey(infoHash: string, target: MatchTarget): string {
  const h = infoHash.toLowerCase().trim();
  const f = target.fileIdx !== undefined ? target.fileIdx : 'def';
  const s = target.season !== undefined ? target.season : 'na';
  const e = target.episode !== undefined ? target.episode : 'na';
  return `${h}:${f}:${s}:${e}`;
}

export class PlaybackResolver {
  constructor(private client: OpenListClient, private config: AppConfig) {}

  private getDrivePath(drive: string, infoHash: string): string {
    const actualDriveName = normalizeDriveName(drive);
    return `/${actualDriveName}/StremList/${infoHash}`;
  }

  async resolvePlayUrl(
    infoHash: string,
    target: MatchTarget,
    onAbort?: (abortHandler: () => void) => void
  ): Promise<string> {
    const cacheKey = buildCacheKey(infoHash, target);
    const now = Date.now();

    // 1. Check in-memory URL cache (10 minutes TTL) to prevent hammering OpenList & PikPak
    const cachedEntry = playUrlCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > now) {
      console.log(`[Resolver] ⚡ Returning cached play URL for ${infoHash} (expires in ${Math.round((cachedEntry.expiresAt - now) / 1000)}s)`);
      return cachedEntry.url;
    }

    // 2. Coalesce concurrent in-flight resolutions for the exact same target
    const inFlight = inFlightResolutions.get(cacheKey);
    if (inFlight) {
      console.log(`[Resolver] ⏳ Attaching to in-flight resolution for ${infoHash}...`);
      return await inFlight;
    }

    // 3. Initiate resolution and cache result
    const resolutionPromise = this.doResolvePlayUrl(infoHash, target, onAbort);
    inFlightResolutions.set(cacheKey, resolutionPromise);

    try {
      const resolvedUrl = await resolutionPromise;
      // Cache valid playback URL for 10 minutes
      playUrlCache.set(cacheKey, {
        url: resolvedUrl,
        expiresAt: Date.now() + 10 * 60 * 1000
      });
      return resolvedUrl;
    } finally {
      inFlightResolutions.delete(cacheKey);
    }
  }

  private async findPlayableInPath(
    dirPath: string,
    target: MatchTarget,
    refresh = false
  ): Promise<{ fullPath: string; file: FileItem } | null> {
    const listResult = await this.client.list(dirPath, refresh);
    const items = listResult.content || [];
    if (items.length === 0) {
      // If this is a specific hash directory /<Drive>/StremList/<hash> and it has 0 items,
      // it's an empty dangling folder from a failed offline download.
      // Clean it up so it stops creating false-positive cache hits in Harbor/Stremio!
      const isHashDir = /\/StremList\/[a-f0-9]{40}$/i.test(dirPath);
      if (isHashDir) {
        const hash = dirPath.split('/').pop() || '';
        console.warn(`[Resolver] 🧹 Detected empty dangling hash folder ${dirPath}. Removing to prevent false cache hits...`);
        this.client.remove(dirPath).catch(() => {});
        this.client.evictCachedHash(hash);
      }
      return null;
    }

    // Check directly in this directory
    const matched = matchPlayableFile(items, target);
    if (matched) {
      return {
        fullPath: `${dirPath.replace(/\/+$/, '')}/${matched.name}`,
        file: matched
      };
    }

    // Check inside subdirectories (torrents often extract into a folder)
    const subDirs = items.filter((i) => i.is_dir);
    for (const subDir of subDirs) {
      const subPath = `${dirPath.replace(/\/+$/, '')}/${subDir.name}`;
      const subList = await this.client.list(subPath, refresh);
      const subItems = subList.content || [];
      const subMatched = matchPlayableFile(subItems, target);
      if (subMatched) {
        return {
          fullPath: `${subPath}/${subMatched.name}`,
          file: subMatched
        };
      }
    }

    return null;
  }

  private async findPlayableByTitleInDir(
    dirPath: string,
    target: MatchTarget,
    refresh = false
  ): Promise<{ fullPath: string; file: FileItem } | null> {
    if (!target.title) return null;
    const listResult = await this.client.list(dirPath, refresh);
    const items = listResult.content || [];
    const cleanTarget = target.title.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    const keywords = cleanTarget.split(/\s+/).filter((w) => w.length > 2);
    if (keywords.length === 0) return null;

    const subDirs = items.filter((i) => i.is_dir);
    for (const subDir of subDirs) {
      const dirNameClean = subDir.name.toLowerCase().replace(/[^a-z0-9]/g, ' ');
      const matches = keywords.slice(0, Math.min(3, keywords.length)).every((kw) => dirNameClean.includes(kw));
      if (matches) {
        const subPath = `${dirPath.replace(/\/+$/, '')}/${subDir.name}`;
        const found = await this.findPlayableInPath(subPath, target, refresh);
        if (found) return found;
      }
    }
    return null;
  }

  private async doResolvePlayUrl(
    infoHash: string,
    target: MatchTarget,
    onAbort?: (abortHandler: () => void) => void
  ): Promise<string> {
    const mountedDrives = await this.client.getMountedDrives();
    const primaryDrive = normalizeDriveName(this.config.defaultDrive || '115');

    // Ensure primaryDrive is checked first, followed by all other mounted drives
    const candidateDrives = [
      primaryDrive,
      ...mountedDrives.map(normalizeDriveName).filter((d) => d.toLowerCase() !== primaryDrive.toLowerCase())
    ];

    console.log(`[Resolver] 🔍 Checking cache for hash ${infoHash} across drives: [${candidateDrives.join(', ')}]...`);

    // 1. Fast Cache Check: Check /<Drive>/StremList/<hash> for each mounted drive
    for (const drive of candidateDrives) {
      const drivePath = this.getDrivePath(drive, infoHash);
      const cached = await this.findPlayableInPath(drivePath, target, false);
      if (cached) {
        console.log(`[Resolver] ⚡ Cache HIT in drive "${drive}"! Found: ${cached.file.name}`);
        const rawUrl = await this.client.getRawUrl(cached.fullPath);
        if (rawUrl) {
          console.log(`[Resolver] 🚀 Direct URL retrieved: ${rawUrl}`);
          return rawUrl;
        }
      }
    }

    // 2. Smart Title Cache Check in /<Drive>/StremList/ and /<Drive>/ across all drives
    if (target.title) {
      for (const drive of candidateDrives) {
        const parentDir = `/${drive}/StremList`;
        const rootDir = `/${drive}`;

        let titleCached = await this.findPlayableByTitleInDir(parentDir, target, false);
        if (!titleCached) {
          titleCached = await this.findPlayableByTitleInDir(rootDir, target, false);
        }

        if (titleCached) {
          console.log(`[Resolver] ⚡ Cache HIT in drive "${drive}" by title match! Found: ${titleCached.file.name}`);
          const rawUrl = await this.client.getRawUrl(titleCached.fullPath);
          if (rawUrl) {
            console.log(`[Resolver] 🚀 Direct URL retrieved: ${rawUrl}`);
            return rawUrl;
          }
        }
      }
    }

    // 3. Cache Miss: Add Offline Task to DEFAULT_DRIVE (config.defaultDrive)
    const targetDrive = primaryDrive;
    const targetPath = this.getDrivePath(targetDrive, infoHash);
    const parentPrimary = `/${targetDrive}/StremList`;
    const rootDrive = `/${targetDrive}`;

    console.log(`[Resolver] ⏳ Cache MISS across all drives. Starting offline download on DEFAULT_DRIVE "${targetDrive}"...`);
    // Ensure parent /StremList directory exists
    await this.client.mkdir(parentPrimary);

    let magnetUrl = `magnet:?xt=urn:btih:${infoHash}`;
    if (target.title) {
      const cleanTitle = target.title.replace(/[\r\n\t]/g, ' ').trim();
      if (cleanTitle) {
        magnetUrl += `&dn=${encodeURIComponent(cleanTitle)}`;
      }
    }

    const taskAdded = await this.client.addOfflineDownload(targetPath, [magnetUrl], targetDrive);
    if (!taskAdded) {
      console.warn(`[Resolver] ⚠️ Warning: addOfflineDownload API reported failure. Will still poll in case it queued.`);
    }

    // 5. Synchronous Polling Loop with Abort Detection & Timeout
    const timeoutMs = (this.config.pollTimeout || 25) * 1000;
    const intervalMs = this.config.pollInterval || 1500;
    const startTime = Date.now();
    let pollAttempts = 0;

    return new Promise<string>((resolve, reject) => {
      let isAborted = false;
      let timer: NodeJS.Timeout | null = null;

      if (onAbort) {
        onAbort(() => {
          isAborted = true;
          if (timer) clearTimeout(timer);
          console.log(`[Resolver] 🛑 Client disconnected/aborted playback for ${infoHash}`);
          // If aborted, clean up empty targetPath if left dangling
          this.client.list(targetPath, false).then((res) => {
            if (!res.content || res.content.length === 0) {
              this.client.remove(targetPath).catch(() => {});
              this.client.evictCachedHash(infoHash);
            }
          }).catch(() => {});
          reject(new Error('CLIENT_ABORTED'));
        });
      }

      const poll = async () => {
        if (isAborted) return;
        pollAttempts++;
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

        if (Date.now() - startTime >= timeoutMs) {
          console.error(`[Resolver] ⏱️ Offline download polling timed out after ${elapsedSec}s for ${infoHash}`);
          // Clean up dangling empty targetPath if it was created but contains no files
          this.client.list(targetPath, false).then((res) => {
            if (!res.content || res.content.length === 0) {
              console.warn(`[Resolver] 🧹 Cleaning up empty target folder on timeout: ${targetPath}`);
              this.client.remove(targetPath).catch(() => {});
              this.client.evictCachedHash(infoHash);
            }
          }).catch(() => {});
          reject(new Error('OFFLINE_DOWNLOAD_TIMEOUT'));
          return;
        }

        console.log(`[Resolver] 🔄 Polling ${targetPath} (attempt #${pollAttempts}, elapsed ${elapsedSec}s)...`);

        try {
          let readyFile = await this.findPlayableInPath(targetPath, target, true);
          if (!readyFile && target.title) {
            readyFile = await this.findPlayableByTitleInDir(parentPrimary, target, true);
          }
          if (!readyFile && target.title) {
            readyFile = await this.findPlayableByTitleInDir(rootDrive, target, true);
          }

          if (readyFile) {
            console.log(
              `[Resolver] 🎉 File ready! "${readyFile.file.name}" (${(readyFile.file.size / (1024 * 1024 * 1024)).toFixed(2)} GB)`
            );
            const rawUrl = await this.client.getRawUrl(readyFile.fullPath);
            if (rawUrl) {
              console.log(`[Resolver] 🚀 302 Redirect URL ready: ${rawUrl}`);
              resolve(rawUrl);
              return;
            }
          }
        } catch (err: any) {
          console.warn(`[Resolver] Polling transient error: ${err.message}`);
        }

        if (!isAborted) {
          timer = setTimeout(poll, intervalMs);
        }
      };

      // Start first poll iteration
      timer = setTimeout(poll, intervalMs);
    });
  }
}
