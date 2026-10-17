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
  '.webm',
  '.iso',
  '.m2ts'
]);

const SAMPLE_REGEX = /(^|[._\-\s\[])(sample|featurette|trailer|bonus|extra|promo|preview|teaser)([._\-\s\]]|$)/i;

const EXPLICIT_AD_REGEX =
  /(?:请访问|发布页|扫码|关注公众号|宣传片|广告|片花|解压密码|防封|更多.*(?:电影|资源|高清)|最新电影发布)/i;

const DOMAIN_REGEX =
  /(?:www\.|https?:\/\/|\.com\b|\.net\b|\.cn\b|\.org\b|\.cc\b|\.tv\b|\.vip\b|\.top\b|\.xyz\b|\.me\b)/i;

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return filename.slice(dotIndex).toLowerCase();
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

export function isVideoFile(file: FileItem): boolean {
  if (file.is_dir) return false;
  const ext = getExtension(file.name);
  if (VIDEO_EXTENSIONS.has(ext)) return true;
  // Support extensionless video files (e.g. PikPak/115 saving files named purely by infoHash or title)
  // Media files are typically large (> 50MB)
  if (ext === '' && file.size > 50 * 1024 * 1024) return true;
  return false;
}

export function isAdOrSampleFile(file: FileItem, targetType?: 'movie' | 'series'): boolean {
  // 1. Explicit ad phrases in filename indicating promo clips or ad files (under 150MB)
  if (EXPLICIT_AD_REGEX.test(file.name) && file.size < 150 * 1024 * 1024) {
    return true;
  }

  // 2. Sample/trailer pattern in filename with standard scene sample size limit (< 80MB)
  if (SAMPLE_REGEX.test(file.name) && file.size < 80 * 1024 * 1024) {
    return true;
  }

  // 3. Domain / website links in filename for tiny promo clips (< 40MB)
  // Notice: 20-min anime or sitcom episodes (100MB-250MB) frequently contain release group tags (e.g. [rarbg.to], [nyaa.si])
  // so we never reject files >= 40MB or files with valid episode numbers.
  if (DOMAIN_REGEX.test(file.name) && file.size < 40 * 1024 * 1024) {
    if (!parseSeasonEpisode(file.name)) {
      return true;
    }
  }

  return false;
}

export function matchPlayableCandidate<T extends { file: FileItem }>(
  candidates: T[],
  target: MatchTarget
): T | null {
  // 1. Filter video files excluding ads and samples
  let videoCandidates = candidates.filter(
    (c) => isVideoFile(c.file) && !isAdOrSampleFile(c.file, target.type)
  );

  // 2. Resilient fallback: if all video files were filtered out, allow any video >= 20MB
  if (videoCandidates.length === 0) {
    videoCandidates = candidates.filter(
      (c) => isVideoFile(c.file) && c.file.size >= 20 * 1024 * 1024
    );
  }

  if (videoCandidates.length === 0) {
    return null;
  }

  if (target.type === 'movie') {
    // Pick the largest video file
    return videoCandidates.reduce((prev, curr) => (curr.file.size > prev.file.size ? curr : prev));
  }

  if (target.type === 'series') {
    const targetSeason = target.season ?? 1;
    const targetEpisode = target.episode;

    if (targetEpisode !== undefined) {
      // 1. Try regex pattern match on filenames
      const matches: T[] = [];
      for (const candidate of videoCandidates) {
        const parsed = parseSeasonEpisode(candidate.file.name);
        if (parsed) {
          const seasonMatch = parsed.season === undefined || parsed.season === targetSeason;
          if (seasonMatch && parsed.episode === targetEpisode) {
            matches.push(candidate);
          }
        }
      }
      if (matches.length > 0) {
        return matches.reduce((prev, curr) => (curr.file.size > prev.file.size ? curr : prev));
      }
    }

    // 2. Fallback to fileIdx if provided
    if (target.fileIdx !== undefined && target.fileIdx >= 0 && target.fileIdx < candidates.length) {
      const indexed = candidates[target.fileIdx];
      if (isVideoFile(indexed.file)) {
        return indexed;
      }
    }

    // 3. Fallback to largest video file
    return videoCandidates.reduce((prev, curr) => (curr.file.size > prev.file.size ? curr : prev));
  }

  return videoCandidates[0] || null;
}

export function matchPlayableFile(files: FileItem[], target: MatchTarget): FileItem | null {
  const wrapped = files.map((f) => ({ file: f }));
  const matched = matchPlayableCandidate(wrapped, target);
  return matched ? matched.file : null;
}
