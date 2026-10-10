import { OpenListClient } from './client.js';
import { AppConfig } from '../../config.js';
import { MatchTarget, matchPlayableFile, FileItem } from '../matcher/file-matcher.js';

export function normalizeDriveName(drive: string): string {
  const lower = drive.toLowerCase();
  if (lower === 'pikpak') return 'PikPak';
  if (lower === '115') return '115';
  return drive;
}

export class PlaybackResolver {
  constructor(private client: OpenListClient, private config: AppConfig) {}

  private getDrivePath(drive: string, infoHash: string): string {
    const actualDriveName = normalizeDriveName(drive);
    return `/${actualDriveName}/StremList/${infoHash}`;
  }

  private async findPlayableInPath(
    dirPath: string,
    target: MatchTarget,
    refresh = false
  ): Promise<{ fullPath: string; file: FileItem } | null> {
    const listResult = await this.client.list(dirPath, refresh);
    const items = listResult.content || [];
    if (items.length === 0) return null;

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

  async resolvePlayUrl(
    infoHash: string,
    target: MatchTarget,
    onAbort?: (abortHandler: () => void) => void
  ): Promise<string> {
    const primaryDrive = this.config.defaultDrive;
    const fallbackDrive = primaryDrive.toLowerCase() === '115' ? 'pikpak' : '115';

    const primaryPath = this.getDrivePath(primaryDrive, infoHash);
    const fallbackPath = this.getDrivePath(fallbackDrive, infoHash);

    console.log(`[Resolver] 🔍 Checking cache for hash ${infoHash}...`);
    console.log(`[Resolver]    Primary path:  ${primaryPath}`);
    console.log(`[Resolver]    Fallback path: ${fallbackPath}`);

    // 1. Fast Cache Check: Primary Drive by hash
    const primaryCached = await this.findPlayableInPath(primaryPath, target, false);
    if (primaryCached) {
      console.log(`[Resolver] ⚡ Cache HIT in primary drive! Found: ${primaryCached.file.name}`);
      const rawUrl = await this.client.getRawUrl(primaryCached.fullPath);
      if (rawUrl) {
        console.log(`[Resolver] 🚀 Direct URL retrieved: ${rawUrl}`);
        return rawUrl;
      }
    }

    // 2. Fast Cache Check: Fallback Drive by hash
    const fallbackCached = await this.findPlayableInPath(fallbackPath, target, false);
    if (fallbackCached) {
      console.log(`[Resolver] ⚡ Cache HIT in fallback drive! Found: ${fallbackCached.file.name}`);
      const rawUrl = await this.client.getRawUrl(fallbackCached.fullPath);
      if (rawUrl) {
        console.log(`[Resolver] 🚀 Direct URL retrieved: ${rawUrl}`);
        return rawUrl;
      }
    }

    // 3. Smart Title Cache Check in /<Drive>/StremList/
    const parentPrimary = `/${normalizeDriveName(primaryDrive)}/StremList`;
    const titleCached = await this.findPlayableByTitleInDir(parentPrimary, target, false);
    if (titleCached) {
      console.log(`[Resolver] ⚡ Cache HIT in StremList directory by title match! Found: ${titleCached.file.name}`);
      const rawUrl = await this.client.getRawUrl(titleCached.fullPath);
      if (rawUrl) {
        console.log(`[Resolver] 🚀 Direct URL retrieved: ${rawUrl}`);
        return rawUrl;
      }
    }

    // 4. Cache Miss: Add Offline Task to Primary Drive
    console.log(`[Resolver] ⏳ Cache MISS in both drives. Starting offline download...`);
    // Pre-create directory so cloud drive has dedicated target folder
    await this.client.mkdir(primaryPath);
    const magnetUrl = `magnet:?xt=urn:btih:${infoHash}`;
    const taskAdded = await this.client.addOfflineDownload(primaryPath, [magnetUrl], primaryDrive);
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

        console.log(`[Resolver] 🔄 Polling ${primaryPath} (attempt #${pollAttempts}, elapsed ${elapsedSec}s)...`);

        try {
          let readyFile = await this.findPlayableInPath(primaryPath, target, true);
          if (!readyFile && target.title) {
            readyFile = await this.findPlayableByTitleInDir(parentPrimary, target, true);
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
