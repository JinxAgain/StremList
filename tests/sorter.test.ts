import { describe, it, expect } from 'vitest';
import {
  extractResolution,
  extractSeeders,
  extractSize,
  calculateQualityScore,
  sortStreams
} from '../src/services/scraper/sorter.js';
import { ScrapedStream } from '../src/types/scraper.js';

describe('Stream Sorter & Metadata Extractor', () => {
  describe('extractResolution', () => {
    it('correctly identifies 4K / 2160p', () => {
      expect(extractResolution('Movie 2160p HDR').rank).toBe(9);
      expect(extractResolution('Movie.4k.UHD').rank).toBe(9);
    });

    it('correctly identifies 1080p and 720p', () => {
      expect(extractResolution('Movie 1080p WEB-DL').rank).toBe(6);
      expect(extractResolution('Movie FHD H.264').rank).toBe(6);
      expect(extractResolution('Movie 720p HD').rank).toBe(5);
    });

    it('falls back to rank 1 for unknown resolution', () => {
      expect(extractResolution('Some.Movie.Release').rank).toBe(1);
    });
  });

  describe('extractSeeders', () => {
    it('extracts seeders from emoji or text patterns', () => {
      expect(extractSeeders('Title\n👤 45 💾 1.2 GB')).toBe(45);
      expect(extractSeeders('Title 1080p 875 SEEDS')).toBe(875);
      expect(extractSeeders('S: 120 | 1080p')).toBe(120);
    });
  });

  describe('extractSize', () => {
    it('uses videoSize hint when present', () => {
      expect(extractSize('Title', 1073741824)).toBe(1073741824);
    });

    it('parses size string units correctly', () => {
      const gbSize = extractSize('Title 💾 1.5 GB');
      expect(gbSize).toBe(Math.round(1.5 * 1024 * 1024 * 1024));

      const mbSize = extractSize('Title 💾 500 MB');
      expect(mbSize).toBe(500 * 1024 * 1024);
    });
  });

  describe('calculateQualityScore', () => {
    it('ranks Remux > BluRay > WEB-DL > CAM', () => {
      const remux = calculateQualityScore('Movie 2160p REMUX HEVC');
      const bluray = calculateQualityScore('Movie 1080p BluRay x264');
      const webdl = calculateQualityScore('Movie 1080p WEB-DL H264');
      const cam = calculateQualityScore('Movie CAM TS');

      expect(remux).toBeGreaterThan(bluray);
      expect(bluray).toBeGreaterThan(webdl);
      expect(webdl).toBeGreaterThan(cam);
    });

    it('gives bonus to Dolby Vision and HDR10+', () => {
      const dovi = calculateQualityScore('Movie 2160p WEB-DL DV HDR10+ HEVC');
      const sdr = calculateQualityScore('Movie 2160p WEB-DL SDR HEVC');

      expect(dovi).toBeGreaterThan(sdr);
    });
  });

  describe('sortStreams (mimicking Comet / RTN logic)', () => {
    it('places cached streams first, then orders by resolution and quality', () => {
      const streams: ScrapedStream[] = [
        {
          infoHash: 'hash_uncached_4k',
          name: 'Torrentio 4K',
          title: 'Movie.2024.2160p.WEB-DL\n👤 100 💾 15 GB',
          isCached: false
        },
        {
          infoHash: 'hash_cached_1080p',
          name: 'Torrentio 1080p',
          title: 'Movie.2024.1080p.BluRay\n👤 20 💾 6 GB',
          isCached: true
        },
        {
          infoHash: 'hash_cached_4k',
          name: 'Torrentio 4K Remux',
          title: 'Movie.2024.2160p.REMUX.DV\n👤 50 💾 50 GB',
          isCached: true
        },
        {
          infoHash: 'hash_uncached_720p',
          name: 'Torrentio 720p',
          title: 'Movie.2024.720p.HDTV\n👤 10 💾 2 GB',
          isCached: false
        }
      ];

      const sorted = sortStreams(streams);

      // Cached streams must come first:
      expect(sorted[0].infoHash).toBe('hash_cached_4k');
      expect(sorted[1].infoHash).toBe('hash_cached_1080p');

      // Uncached streams must come next:
      expect(sorted[2].infoHash).toBe('hash_uncached_4k');
      expect(sorted[3].infoHash).toBe('hash_uncached_720p');
    });

    it('prioritizes active seeders over lower/unknown seeders in same resolution for uncached streams', () => {
      const streams: ScrapedStream[] = [
        {
          infoHash: 'hash_unknown_seeds',
          name: 'Comet 1080p',
          title: 'Movie.2024.1080p.NF.WEB-DL.DV.HDR.Atmos\n💾 3.3 GB',
          isCached: false
        },
        {
          infoHash: 'hash_active_seeds',
          name: 'Comet 1080p',
          title: 'Movie.2024.1080p.WEBRip\n👤 25 💾 3.5 GB',
          isCached: false
        }
      ];

      const sorted = sortStreams(streams);
      expect(sorted[0].infoHash).toBe('hash_active_seeds');
      expect(sorted[1].infoHash).toBe('hash_unknown_seeds');
    });
  });
});
