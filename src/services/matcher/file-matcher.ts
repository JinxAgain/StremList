export interface FileItem {
  name: string;
  size: number;
  is_dir: boolean;
}

export interface MatchTarget {
  type: 'movie' | 'series';
  season?: number;
  episode?: number;
  fileIdx?: number;
  title?: string;
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.ts',
  '.mov',
  '.wmv',
  '.flv',
  '.m4v',
  '.webm'
]);

const SAMPLE_REGEX = /(^|[._\-\s])(sample|featurette|trailer|bonus|extra)([._\-\s]|$)/i;

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return filename.slice(dotIndex).toLowerCase();
}

function isVideoFile(file: FileItem): boolean {
  if (file.is_dir) return false;
  return VIDEO_EXTENSIONS.has(getExtension(file.name));
}

function isSampleFile(file: FileItem): boolean {
  // Always ignore if name explicitly contains sample/trailer keyword
  if (SAMPLE_REGEX.test(file.name)) {
    return true;
  }
  // Ignore small clips (< 90MB) if named sample
  if (file.size < 90 * 1024 * 1024 && /sample/i.test(file.name)) {
    return true;
  }
  return false;
}

function parseSeasonEpisode(filename: string): { season?: number; episode?: number } | null {
  // Standard S01E02 / s1e2
  const sPattern = /(?:s|season\s*)0*(\d+)[\s._-]*(?:e|episode\s*|x)0*(\d+)/i;
  const sMatch = filename.match(sPattern);
  if (sMatch) {
    return {
      season: parseInt(sMatch[1], 10),
      episode: parseInt(sMatch[2], 10)
    };
  }

  // 1x02 format
  const xPattern = /(?:^|[._\-\s\[])0*(\d+)x0*(\d+)(?:[._\-\s\]]|$)/i;
  const xMatch = filename.match(xPattern);
  if (xMatch) {
    return {
      season: parseInt(xMatch[1], 10),
      episode: parseInt(xMatch[2], 10)
    };
  }

  // EP02 / E02 / 第02集
  const epPattern = /(?:ep|e|第)\s*0*(\d+)(?:\s*集)?(?:[._\-\s\]]|$)/i;
  const epMatch = filename.match(epPattern);
  if (epMatch) {
    return {
      season: 1, // Default season 1 when only episode number is given
      episode: parseInt(epMatch[1], 10)
    };
  }

  return null;
}

export function matchPlayableFile(files: FileItem[], target: MatchTarget): FileItem | null {
  const videoFiles = files.filter(f => isVideoFile(f) && !isSampleFile(f));
  if (videoFiles.length === 0) {
    return null;
  }

  if (target.type === 'movie') {
    // Pick the largest video file
    return videoFiles.reduce((prev, curr) => (curr.size > prev.size ? curr : prev));
  }

  if (target.type === 'series') {
    const targetSeason = target.season ?? 1;
    const targetEpisode = target.episode;

    if (targetEpisode !== undefined) {
      // 1. Try regex pattern match on filenames
      for (const file of videoFiles) {
        const parsed = parseSeasonEpisode(file.name);
        if (parsed) {
          const seasonMatch = parsed.season === undefined || parsed.season === targetSeason;
          if (seasonMatch && parsed.episode === targetEpisode) {
            return file;
          }
        }
      }
    }

    // 2. Fallback to fileIdx if provided
    if (target.fileIdx !== undefined && target.fileIdx >= 0 && target.fileIdx < files.length) {
      const indexedFile = files[target.fileIdx];
      if (isVideoFile(indexedFile)) {
        return indexedFile;
      }
    }

    // 3. Fallback to largest video file
    return videoFiles.reduce((prev, curr) => (curr.size > prev.size ? curr : prev));
  }

  return videoFiles[0] || null;
}
