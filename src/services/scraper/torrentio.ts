import axios from 'axios';
import { StremioStream, StreamResponse } from '../../types/stremio.js';
import { ScrapedStream } from '../../types/scraper.js';

export function extractInfoHash(stream: StremioStream): string | null {
  if (stream.infoHash && /^[a-fA-F0-9]{40}$/i.test(stream.infoHash)) {
    return stream.infoHash.toLowerCase();
  }
  if (stream.url) {
    const match = stream.url.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

export class TorrentioScraper {
  constructor(private baseUrl: string) {}

  async fetchStreams(type: string, id: string): Promise<ScrapedStream[]> {
    if (!this.baseUrl) return [];

    try {
      const url = `${this.baseUrl}/stream/${type}/${encodeURIComponent(id)}.json`;
      const response = await axios.get<StreamResponse>(url, {
        timeout: 5000,
        headers: { 'User-Agent': 'StremList/0.1.0' }
      });

      if (!response.data || !Array.isArray(response.data.streams)) {
        return [];
      }

      const results: ScrapedStream[] = [];
      for (const s of response.data.streams) {
        const hash = extractInfoHash(s);
        if (hash) {
          const fullTitle = s.title || s.description || '';
          const fullDesc = s.description || s.title || '';
          results.push({
            infoHash: hash,
            name: s.name || 'Torrentio',
            title: fullTitle,
            description: fullDesc,
            fileIdx: s.fileIdx,
            sourceAddon: 'torrentio',
            behaviorHints: s.behaviorHints
          });
        }
      }

      return results;
    } catch (error) {
      // Graceful error handling for timeout / unreachable upstream
      return [];
    }
  }
}
