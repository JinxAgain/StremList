import { ScrapedStream } from '../../types/scraper.js';

export interface StreamScore {
  isCached: boolean;
  resolutionRank: number;
  resolutionLabel: string;
  qualityScore: number;
  seeders: number;
  sizeBytes: number;
}

export function extractResolution(text: string): { rank: number; label: string } {
  const upper = text.toUpperCase();

  if (/\b(4K|2160P|UHD)\b/.test(upper)) {
    return { rank: 9, label: '2160p' };
  }
  if (/\b(1440P|2K|QHD)\b/.test(upper)) {
    return { rank: 7, label: '1440p' };
  }
  if (/\b(1080P|FHD)\b/.test(upper)) {
    return { rank: 6, label: '1080p' };
  }
  if (/\b(720P|HD)\b/.test(upper)) {
    return { rank: 5, label: '720p' };
  }
  if (/\b(576P)\b/.test(upper)) {
    return { rank: 4, label: '576p' };
  }
  if (/\b(480P|SD)\b/.test(upper)) {
    return { rank: 3, label: '480p' };
  }
  if (/\b(360P|240P)\b/.test(upper)) {
    return { rank: 2, label: '360p' };
  }

  return { rank: 1, label: '' };
}

export function hasExplicitSeeders(text: string): boolean {
  return /👤\s*\d+|\b\d+\s*(?:seeds?|seeders?)\b|\bS\s*:\s*\d+\b/i.test(text);
}

export function extractSeeders(text: string): number {
  // Common patterns:
  // 👤 15
  // S: 15 / S:15
  // 15 SEEDS / 15 seeds / 15 seeders
  const emojiMatch = text.match(/👤\s*(\d+)/);
  if (emojiMatch) return parseInt(emojiMatch[1], 10);

  const seedMatch = text.match(/\b(\d+)\s*(?:seeds?|seeders?)\b/i);
  if (seedMatch) return parseInt(seedMatch[1], 10);

  const sTagMatch = text.match(/\bS\s*:\s*(\d+)\b/i);
  if (sTagMatch) return parseInt(sTagMatch[1], 10);

  return 0;
}

export function extractSize(text: string, videoSizeHint?: number): number {
  if (videoSizeHint && videoSizeHint > 0) {
    return videoSizeHint;
  }

  // 💾 1.23 GB or 1.23 GB or 500 MB
  const match = text.match(/(?:💾\s*)?(\d+(?:\.\d+)?)\s*(GB|MB|KB|TB|B)\b/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  switch (unit) {
    case 'TB':
      return Math.round(value * 1024 * 1024 * 1024 * 1024);
    case 'GB':
      return Math.round(value * 1024 * 1024 * 1024);
    case 'MB':
      return Math.round(value * 1024 * 1024);
    case 'KB':
      return Math.round(value * 1024);
    default:
      return Math.round(value);
  }
}

export function calculateQualityScore(text: string): number {
  let score = 0;
  const upper = text.toUpperCase();

  // 1. Source format
  if (/\bREMUX\b/.test(upper)) {
    score += 1000;
  } else if (/\b(BLURAY|BLU-RAY|BDRIP|BRRIP)\b/.test(upper)) {
    score += 800;
  } else if (/\b(WEB-?DL|WEBRIP)\b/.test(upper)) {
    score += 600;
  } else if (/\b(HDRIP|HDTV)\b/.test(upper)) {
    score += 400;
  } else if (/\b(DVDRIP|DVD)\b/.test(upper)) {
    score += 200;
  } else if (/\b(CAM|CAMRIP|TS|TELESYNC|SCREENER|SCR)\b/.test(upper)) {
    score -= 1000; // Penalize CAM / screener
  }

  // 2. High Dynamic Range
  if (/\b(DOVI|DV|DOLBY[\.\s_-]?VISION)\b/.test(upper)) {
    score += 500;
  }
  if (/\bHDR10\+\b/.test(upper)) {
    score += 400;
  } else if (/\b(HDR10|HDR|HLG)\b/.test(upper)) {
    score += 300;
  }

  // 3. Video Codec
  if (/\b(AV1)\b/.test(upper)) {
    score += 250;
  } else if (/\b(HEVC|H\.?265|X265)\b/.test(upper)) {
    score += 200;
  } else if (/\b(AVC|H\.?264|X264)\b/.test(upper)) {
    score += 100;
  }

  // 4. Enhanced audio
  if (/\b(ATMOS|TRUEHD|DTS-HD|FLAC)\b/.test(upper)) {
    score += 150;
  } else if (/\b(DDP|EAC3|AC3|5\.1|7\.1)\b/.test(upper)) {
    score += 80;
  }

  return score;
}

export function computeStreamScore(stream: ScrapedStream): StreamScore {
  const combinedText = `${stream.name} ${stream.title} ${stream.description || ''} ${
    stream.behaviorHints?.filename || ''
  }`;

  const res = extractResolution(combinedText);
  const seeders = stream.seeders ?? extractSeeders(combinedText);
  const sizeBytes = stream.sizeBytes ?? extractSize(combinedText, stream.behaviorHints?.videoSize);
  let qualityScore = calculateQualityScore(combinedText);

  // Penalize single-language foreign dubs (e.g. Russian, Italian, etc.) if not dual/multi/English
  const upper = combinedText.toUpperCase();
  const hasCyrillic = /[\u0400-\u04FF]/.test(combinedText);
  const isMultiOrEng = /\b(MULTI|DUAL|ENG|ENGLISH)\b/.test(upper);
  if (hasCyrillic && !isMultiOrEng) {
    qualityScore -= 600;
  }

  return {
    isCached: !!stream.isCached,
    resolutionRank: res.rank,
    resolutionLabel: res.label,
    qualityScore,
    seeders,
    sizeBytes
  };
}

/**
 * Sorts streams strictly adhering to Comet / RTN ranking standards:
 * 1. Cached streams first (instant playback from OpenList drives)
 * 2. Resolution descending (2160p > 1440p > 1080p > 720p > 480p > unknown)
 * 3. For cached streams: Quality & Codec Score (Remux > BluRay > WEB-DL, DV/HDR) -> Size
 * 4. For uncached streams: Seeders descending (cloud offline health) -> Quality -> Size
 */
export function sortStreams(streams: ScrapedStream[]): ScrapedStream[] {
  const scored = streams.map((stream) => ({
    stream,
    score: computeStreamScore(stream)
  }));

  scored.sort((a, b) => {
    // 1. Cached vs Uncached (Cached streams always first)
    if (a.score.isCached !== b.score.isCached) {
      return a.score.isCached ? -1 : 1;
    }

    // 2. Resolution
    if (a.score.resolutionRank !== b.score.resolutionRank) {
      return b.score.resolutionRank - a.score.resolutionRank;
    }

    // 3. Within same resolution:
    if (a.score.isCached) {
      // For cached streams, quality & codec score is primary (instant playback)
      if (a.score.qualityScore !== b.score.qualityScore) {
        return b.score.qualityScore - a.score.qualityScore;
      }
      if (a.score.sizeBytes !== b.score.sizeBytes) {
        return b.score.sizeBytes - a.score.sizeBytes;
      }
    } else {
      // For uncached streams, seeders are paramount for offline cloud downloading!
      // More seeders = faster download and higher cloud instant-cache (秒传) rate
      if (a.score.seeders !== b.score.seeders) {
        return b.score.seeders - a.score.seeders;
      }
      if (a.score.qualityScore !== b.score.qualityScore) {
        return b.score.qualityScore - a.score.qualityScore;
      }
      if (a.score.sizeBytes !== b.score.sizeBytes) {
        return b.score.sizeBytes - a.score.sizeBytes;
      }
    }

    return 0;
  });

  return scored.map((item) => item.stream);
}
