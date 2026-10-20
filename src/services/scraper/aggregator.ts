import { StremioStream } from '../../types/stremio.js';
import { ScrapedStream } from '../../types/scraper.js';
import { TorrentioScraper } from './torrentio.js';
import { CometScraper } from './comet.js';
import { sortStreams, extractResolution, extractSeeders, hasExplicitSeeders } from './sorter.js';
import { OpenListClient } from '../openlist/client.js';
import { normalizeDriveName } from '../openlist/resolver.js';

export class ScraperAggregator {
  private torrentio: TorrentioScraper;
  private comet: CometScraper;

  constructor(
    torrentioUrl: string,
    cometUrl: string,
    private openlistClient?: OpenListClient,
    private defaultDrive: string = '115'
  ) {
    this.torrentio = new TorrentioScraper(torrentioUrl);
    this.comet = new CometScraper(cometUrl);
  }

  async fetchStreams(
    type: string,
    id: string,
    baseUrl: string,
    configPath?: string
  ): Promise<StremioStream[]> {
    const results = await Promise.allSettled([
      this.torrentio.fetchStreams(type, id),
      this.comet.fetchStreams(type, id)
    ]);

    const allStreams: ScrapedStream[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        allStreams.push(...r.value);
      }
    }

    // Deduplicate by lowercased infoHash while merging behaviorHints and seeders
    const streamMap = new Map<string, ScrapedStream>();
    for (const stream of allStreams) {
      const hash = stream.infoHash.toLowerCase();
      const normalizedStream = { ...stream, infoHash: hash };
      if (!streamMap.has(hash)) {
        streamMap.set(hash, normalizedStream);
      } else {
        const existing = streamMap.get(hash)!;
        const mergedHints = {
          ...(existing.behaviorHints || {}),
          ...(normalizedStream.behaviorHints || {})
        };

        const existingSeeders =
          existing.seeders ?? extractSeeders(`${existing.title} ${existing.description || ''}`);
        const streamSeeders =
          stream.seeders ?? extractSeeders(`${stream.title} ${stream.description || ''}`);
        const bestSeeders = Math.max(existingSeeders, streamSeeders);

        // Prefer stream with richer information (longer title) or Comet RTN badges
        const baseStream =
          stream.title.length > existing.title.length ? normalizedStream : existing;

        let enrichedTitle = baseStream.title;
        let enrichedDesc = baseStream.description || baseStream.title;

        // If chosen stream lacks explicit seeders or had 👤 0, update with the best seeders count
        if (bestSeeders > 0) {
          if (/👤\s*0\b/.test(enrichedTitle)) {
            enrichedTitle = enrichedTitle.replace(/👤\s*0\b/, `👤 ${bestSeeders}`);
          } else if (!hasExplicitSeeders(enrichedTitle)) {
            if (enrichedTitle.includes('💾')) {
              enrichedTitle = enrichedTitle.replace('💾', `👤 ${bestSeeders} 💾`);
            } else {
              enrichedTitle = `${enrichedTitle}\n👤 ${bestSeeders}`;
            }
          }

          if (enrichedDesc) {
            if (/👤\s*0\b/.test(enrichedDesc)) {
              enrichedDesc = enrichedDesc.replace(/👤\s*0\b/, `👤 ${bestSeeders}`);
            } else if (!hasExplicitSeeders(enrichedDesc)) {
              if (enrichedDesc.includes('💾')) {
                enrichedDesc = enrichedDesc.replace('💾', `👤 ${bestSeeders} 💾`);
              } else {
                enrichedDesc = `${enrichedDesc}\n👤 ${bestSeeders}`;
              }
            }
          }
        }

        streamMap.set(hash, {
          ...baseStream,
          title: enrichedTitle,
          description: enrichedDesc,
          seeders: bestSeeders > 0 ? bestSeeders : baseStream.seeders,
          behaviorHints: mergedHints
        });
      }
    }

    let uniqueStreams = Array.from(streamMap.values());

    // Check OpenList cache across ALL mounted drives
    let cachedHashes = new Set<string>();
    if (this.openlistClient) {
      try {
        cachedHashes = await this.openlistClient.getAllCachedHashes();
      } catch {
        // Fallback gracefully if OpenList is unreachable
      }
    }

    // Assign isCached flag: verify candidate matching streams actually have content (not empty folders)
    const matchingStreams = uniqueStreams.filter((s) => cachedHashes.has(s.infoHash));
    const verifiedHashes = new Set<string>();

    if (this.openlistClient && matchingStreams.length > 0) {
      await Promise.allSettled(
        matchingStreams.map(async (s) => {
          if (typeof this.openlistClient!.hasCachedContent === 'function') {
            const hasContent = await this.openlistClient!.hasCachedContent(s.infoHash);
            if (hasContent) {
              verifiedHashes.add(s.infoHash);
            }
          } else {
            verifiedHashes.add(s.infoHash);
          }
        })
      );
    }

    uniqueStreams = uniqueStreams.map((s) => ({
      ...s,
      isCached: verifiedHashes.has(s.infoHash)
    }));

    // Sort streams according to Comet / RTN ranking standards
    const sortedStreams = sortStreams(uniqueStreams);

    const driveLabel = normalizeDriveName(this.defaultDrive || '115');

    // Rewrite stream URLs to StremList /play endpoint
    return sortedStreams.map((item) => {
      const playRoute = configPath ? `/${configPath}/play/${item.infoHash}` : `/play/${item.infoHash}`;
      const params = new URLSearchParams();
      params.set('type', type);
      params.set('id', id);
      if (item.fileIdx !== undefined) {
        params.set('fileIdx', String(item.fileIdx));
      }
      if (item.title) {
        params.set('title', item.title.split('\n')[0]);
      }
      if (item.behaviorHints?.filename) {
        params.set('filename', item.behaviorHints.filename);
      }

      const streamUrl = `${baseUrl.replace(/\/+$/, '')}${playRoute}?${params.toString()}`;

      // Format name to match Comet:
      // Cached streams get ⚡ (e.g. "[115⚡] StremList 2160p") -> Harbor matches /[⚡✅]/ and marks CACHED
      // Uncached streams get 🧲 (e.g. "[115🧲] StremList 2160p") -> matches Comet source code for torrents and avoids Harbor's UNCACHED_EMOJI_RX trust filter rejection
      const icon = item.isCached ? '⚡' : '🧲';
      const res = extractResolution(`${item.name} ${item.title} ${item.description || ''}`).label;
      const resSuffix = res ? ` ${res}` : '';
      const prefix = `[${driveLabel}${icon}] StremList${resSuffix}`;
      const cleanItemName = (item.name || 'P2P').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

      const behaviorHints: Record<string, any> = {
        bingeGroup: `stremlist-${item.infoHash}`
      };
      if (item.behaviorHints?.filename) {
        behaviorHints.filename = item.behaviorHints.filename;
      }
      if (
        typeof item.behaviorHints?.videoSize === 'number' &&
        item.behaviorHints.videoSize > 0
      ) {
        behaviorHints.videoSize = Math.floor(item.behaviorHints.videoSize);
      }

      return {
        name: `${prefix}\n${cleanItemName}`,
        title: item.title,
        url: streamUrl,
        behaviorHints
      };
    });
  }
}
