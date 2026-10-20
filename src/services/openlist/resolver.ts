import { OpenListClient } from './client.js';
import { AppConfig } from '../../config.js';
import { MatchTarget, matchPlayableCandidate, FileItem, parseSeasonFromText } from '../matcher/file-matcher.js';

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

interface PlayableCandidateItem {
  fullPath: string;
  file: FileItem;
}

// Module-level caches shared across resolver instances
const playUrlCache = new Map<string, CachedPlayUrl>();
const inFlightResolutions = new Map<string, Promise<string>>();
const recentOfflineTasks = new Map<string, number>(); // infoHash -> timestamp

export function clearPlayUrlCache(): void {
  playUrlCache.clear();
  inFlightResolutions.clear();
  recentOfflineTasks.clear();
}

function buildCacheKey(infoHash: string, target: MatchTarget): string {
  const h = infoHash.toLowerCase().trim();
  const f = target.fileIdx !== undefined ? target.fileIdx : 'def';
  const effectiveSeason =
    target.season ??
    (target.filename ? parseSeasonFromText(target.filename) : undefined) ??
    (target.title ? parseSeasonFromText(target.title) : undefined);
  const s = effectiveSeason !== undefined ? effectiveSeason : 'na';
  const e = target.episode !== undefined ? target.episode : 'na';
  return `${h}:${f}:${s}:${e}`;
}

async function collectCandidatesRecursive(
  client: OpenListClient,
  dirPath: string,
  refresh: boolean,
  depth = 0,
  maxDepth = 3
): Promise<PlayableCandidateItem[]> {
  if (depth > maxDepth) return [];
  const listResult = await client.list(dirPath, refresh).catch(() => ({ content: [] }));
  const rawItems = listResult.content || [];
  if (rawItems.length === 0) return [];

  const items = [...rawItems].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );

  const candidates: PlayableCandidateItem[] = [];
  const subDirs: FileItem[] = [];

  for (const item of items) {
    if (item.is_dir) {
      subDirs.push(item);
    } else {
      const cleanDir = dirPath.replace(/\/+$/, '');
      candidates.push({
        fullPath: `${cleanDir}/${item.name}`,
        file: item
      });
    }
  }

  if (subDirs.length > 0 && depth < maxDepth) {
    const subPromises = subDirs.map((sd) => {
      const subPath = `${dirPath.replace(/\/+$/, '')}/${sd.name}`;
      return collectCandidatesRecursive(client, subPath, refresh, depth + 1, maxDepth);
    });
    const nested = await Promise.all(subPromises);
    for (const nestedList of nested) {
      candidates.push(...nestedList);
    }
  }

  return candidates;
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
    const allCandidates = await collectCandidatesRecursive(this.client, dirPath, refresh, 0, 3);
    if (allCandidates.length === 0) return null;

    const matched = matchPlayableCandidate(allCandidates, target);
    return matched || null;
  }

  private async findPlayableByTitleInDir(
    dirPath: string,
    target: MatchTarget,
    refresh = false
  ): Promise<{ fullPath: string; file: FileItem } | null> {
    if (!target.title) return null;
    const listResult = await this.client.list(dirPath, refresh).catch(() => ({ content: [] }));
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
      // Quick check using local OpenList index first
      let cached = await this.findPlayableInPath(drivePath, target, false);
      // If not found in local cache, force live refresh from cloud drive to discover newly completed files
      // or incrementally downloaded series episodes before declaring a cache miss
      if (!cached) {
        cached = await this.findPlayableInPath(drivePath, target, true);
      }

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
    await this.client.mkdir(parentPrimary).catch(() => {});

    const normHash = infoHash.toLowerCase().trim();
    const lastSubmitted = recentOfflineTasks.get(normHash);
    const nowTs = Date.now();
    const RECENT_TASK_TTL_MS = 15 * 60 * 1000; // 15 minutes deduplication window

    if (lastSubmitted && nowTs - lastSubmitted < RECENT_TASK_TTL_MS) {
      const elapsedAgo = Math.round((nowTs - lastSubmitted) / 1000);
      console.log(
        `[Resolver] ⏳ Offline task for ${infoHash} was already submitted ${elapsedAgo}s ago. Skipping duplicate submission to cloud drive and proceeding to poll...`
      );
    } else {
      let magnetUrl = `magnet:?xt=urn:btih:${infoHash}`;
      if (target.title) {
        const cleanTitle = target.title.replace(/[\r\n\t]/g, ' ').trim();
        if (cleanTitle) {
          magnetUrl += `&dn=${encodeURIComponent(cleanTitle)}`;
        }
      }

      recentOfflineTasks.set(normHash, nowTs);
      const taskAdded = await this.client.addOfflineDownload(targetPath, [magnetUrl], targetDrive);
      if (!taskAdded) {
        console.warn(`[Resolver] ⚠️ Warning: addOfflineDownload API reported failure. Will still poll in case it queued.`);
        recentOfflineTasks.delete(normHash);
      }
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
          reject(new Error('CLIENT_ABORTED'));
        });
      }

      const poll = async () => {
        if (isAborted) return;
        pollAttempts++;
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

        if (Date.now() - startTime >= timeoutMs) {
          console.error(`[Resolver] ⏱️ Offline download polling timed out after ${elapsedSec}s for ${infoHash}`);
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
