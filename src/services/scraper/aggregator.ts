import { StremioStream } from '../../types/stremio.js';
import { ScrapedStream } from '../../types/scraper.js';
import { TorrentioScraper } from './torrentio.js';
import { CometScraper } from './comet.js';

export class ScraperAggregator {
  private torrentio: TorrentioScraper;
  private comet: CometScraper;

  constructor(torrentioUrl: string, cometUrl: string) {
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

    // Deduplicate by lowercased infoHash
    const streamMap = new Map<string, ScrapedStream>();
    for (const stream of allStreams) {
      const hash = stream.infoHash.toLowerCase();
      const normalizedStream = { ...stream, infoHash: hash };
      if (!streamMap.has(hash)) {
        streamMap.set(hash, normalizedStream);
      } else {
        // If existing title is shorter, prefer more descriptive title
        const existing = streamMap.get(hash)!;
        if (stream.title.length > existing.title.length) {
          streamMap.set(hash, normalizedStream);
        }
      }
    }

    const uniqueStreams = Array.from(streamMap.values());

    // Rewrite stream URLs to StremList /play endpoint
    return uniqueStreams.map((item) => {
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

      const streamUrl = `${baseUrl.replace(/\/+$/, '')}${playRoute}?${params.toString()}`;

      return {
        name: `[StremList ⚡ 115/PikPak]\n${item.name || 'P2P'}`,
        title: item.title,
        url: streamUrl,
        behaviorHints: {
          bingeGroup: `stremlist-${item.infoHash}`
        }
      };
    });
  }
}
