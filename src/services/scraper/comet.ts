import axios from 'axios';
import { StreamResponse } from '../../types/stremio.js';
import { ScrapedStream } from '../../types/scraper.js';
import { extractInfoHash } from './torrentio.js';

export class CometScraper {
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
          results.push({
            infoHash: hash,
            name: s.name || 'Comet',
            title: s.title || '',
            fileIdx: s.fileIdx
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
