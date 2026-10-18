import axios from 'axios';
import { StreamResponse } from '../../types/stremio.js';
import { ScrapedStream } from '../../types/scraper.js';
import { extractInfoHash } from './torrentio.js';

export class CometScraper {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl ? baseUrl.trim().replace(/\/+$/, '').replace(/\/manifest\.json$/i, '').replace(/\/+$/, '') : '';
  }

  async fetchStreams(type: string, id: string): Promise<ScrapedStream[]> {
    if (!this.baseUrl) return [];

    try {
      const url = `${this.baseUrl}/stream/${type}/${encodeURIComponent(id)}.json`;
      const response = await axios.get<StreamResponse>(url, {
        timeout: 5000,
        headers: { 'User-Agent': 'StremList/0.3.0' }
      });

      if (!response.data || !Array.isArray(response.data.streams)) {
        return [];
      }

      const results: ScrapedStream[] = [];
      for (const s of response.data.streams) {
        const hash = extractInfoHash(s);
        if (hash) {
          const rawName = s.name || 'Comet';
          // Clean up upstream prefix like "[TORRENT🧲] " or "[RD⚡] " to get clean label
          const cleanName = rawName.replace(/^\[[^\]]+\]\s*/, '').trim() || 'Comet';
          const fullTitle = s.title || s.description || '';
          const fullDesc = s.description || s.title || '';

          results.push({
            infoHash: hash,
            name: cleanName,
            title: fullTitle,
            description: fullDesc,
            fileIdx: s.fileIdx,
            sourceAddon: 'comet',
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
