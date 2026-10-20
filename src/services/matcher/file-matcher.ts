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
  filename?: string;
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

export function parseSeasonFromText(text: string): number | undefined {
  if (!text) return undefined;

  // Multi-season range (e.g. S01-S03, Season 1-2, S1~S2)
  if (/\b(?:s|season\s*)0*\d+\s*[-~～]\s*(?:s|season\s*)?0*\d+\b/i.test(text)) {
    return undefined;
  }

  // S02E01 format
  const seMatch = text.match(/(?:s|season\s*)0*(\d{1,2})[\s._-]*(?:e|episode\s*|x)0*\d+/i);
  if (seMatch) {
    const s = parseInt(seMatch[1], 10);
    if (s > 0) return s;
  }

  // Standalone season token (e.g. S02, S2, Season 2)
  const sMatch = text.match(/(?:^|[._\-\s\[(\b])(?:s|season\s*)0*(\d{1,2})(?:[._\-\s\])]|$)/i);
  if (sMatch) {
    const s = parseInt(sMatch[1], 10);
    if (s > 0) return s;
  }

  // Ordinal season (e.g. 2nd Season)
  const ordMatch = text.match(/\b0*(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  if (ordMatch) {
    const s = parseInt(ordMatch[1], 10);
    if (s > 0) return s;
  }

  // Chinese season (e.g. 第2季, 第02季)
  const cnMatch = text.match(/第\s*0*(\d{1,2})\s*季/);
  if (cnMatch) {
    const s = parseInt(cnMatch[1], 10);
    if (s > 0) return s;
  }

  return undefined;
}

export function parseSeasonEpisode(filename: string): { season?: number; episode?: number } | null {
  if (!filename) return null;

  // 1. Standard S01E02 / s1e2
  const sPattern = /(?:s|season\s*)0*(\d+)[\s._-]*(?:e|episode\s*|x)0*(\d+)/i;
  const sMatch = filename.match(sPattern);
  if (sMatch) {
    return {
      season: parseInt(sMatch[1], 10),
      episode: parseInt(sMatch[2], 10)
    };
  }

  // 2. 1x02 format
  const xPattern = /(?:^|[._\-\s\[])0*(\d+)x0*(\d+)(?:[._\-\s\]]|$)/i;
  const xMatch = filename.match(xPattern);
  if (xMatch) {
    return {
      season: parseInt(xMatch[1], 10),
      episode: parseInt(xMatch[2], 10)
    };
  }

  // 3. EP02 / E02 / 第02集 / 第02话 / 第02話
  const epPattern = /(?:^|[._\-\s\[【(])(?:ep|e|第)\s*0*(\d{1,4})(?:v\d+)?(?:\s*[集话話])?(?:[._\-\s\]】)]|$)/i;
  const epMatch = filename.match(epPattern);
  if (epMatch) {
    return {
      season: parseSeasonFromText(filename),
      episode: parseInt(epMatch[1], 10)
    };
  }

  // 4. Anime dash episode: " - 01 ", " - 01v2", etc.
  const dashPattern = /(?:^|[\s_])-\s*0*(\d{1,3})(?:v\d+)?(?:\s*[\[(._-]|\s+\d{3,4}p|\.[a-z0-9]{2,4}$)/i;
  const dashMatch = filename.match(dashPattern);
  if (dashMatch) {
    return {
      season: parseSeasonFromText(filename),
      episode: parseInt(dashMatch[1], 10)
    };
  }

  // 5. Anime bracket episode: "[01]", "[01v2]", ignoring [480], [720], [1080], [2160] or years
  const bracketMatches = Array.from(filename.matchAll(/\[0*(\d{1,3})(?:v\d+)?\](?!\s*(?:p|bit|fps)\b)/gi));
  for (const m of bracketMatches) {
    const epNum = parseInt(m[1], 10);
    if (epNum === 480 || epNum === 720 || epNum === 1080 || epNum === 2160 || (epNum >= 1900 && epNum <= 2099)) {
      continue;
    }
    return {
      season: parseSeasonFromText(filename),
      episode: epNum
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
    if (target.filename) {
      const trimmedTarget = target.filename.trim().toLowerCase();
      const exactMatch = videoCandidates.find(
        (c) => c.file.name.trim().toLowerCase() === trimmedTarget
      );
      if (exactMatch) {
        return exactMatch;
      }
    }
    // Pick the largest video file
    return videoCandidates.reduce((prev, curr) => (curr.file.size > prev.file.size ? curr : prev));
  }

  if (target.type === 'series') {
    // 1. If target.filename is set, check videoCandidates for exact case-insensitive match
    if (target.filename) {
      const trimmedTarget = target.filename.trim().toLowerCase();
      const exactMatch = videoCandidates.find(
        (c) => c.file.name.trim().toLowerCase() === trimmedTarget
      );
      if (exactMatch) {
        return exactMatch;
      }
    }

    // 2. Inferred season from target.season, target.filename, or target.title
    const inferredSeason =
      target.season ??
      (target.filename ? parseSeasonFromText(target.filename) : undefined) ??
      (target.title ? parseSeasonFromText(target.title) : undefined);

    const targetEpisode = target.episode;

    if (targetEpisode !== undefined) {
      // Pass 1: match candidates where parsed && parsed.episode === targetEpisode && (parsed.season === undefined || parsed.season === preferredSeason)
      const preferredSeason = inferredSeason ?? 1;
      const pass1Matches: T[] = [];
      for (const candidate of videoCandidates) {
        const parsed = parseSeasonEpisode(candidate.file.name);
        if (parsed && parsed.episode === targetEpisode) {
          const seasonMatch = parsed.season === undefined || parsed.season === preferredSeason;
          if (seasonMatch) {
            pass1Matches.push(candidate);
          }
        }
      }
      if (pass1Matches.length > 0) {
        return pass1Matches.reduce((prev, curr) => (curr.file.size > prev.file.size ? curr : prev));
      }

      // Pass 2: If Pass 1 found no matches AND target.season === undefined, match candidates where parsed && parsed.episode === targetEpisode regardless of parsed.season
      if (target.season === undefined) {
        const pass2Matches: T[] = [];
        for (const candidate of videoCandidates) {
          const parsed = parseSeasonEpisode(candidate.file.name);
          if (parsed && parsed.episode === targetEpisode) {
            pass2Matches.push(candidate);
          }
        }
        if (pass2Matches.length > 0) {
          return pass2Matches.reduce((prev, curr) => (curr.file.size > prev.file.size ? curr : prev));
        }
      }
    }

    // 3. Fallback to fileIdx if provided
    if (target.fileIdx !== undefined && target.fileIdx >= 0 && target.fileIdx < candidates.length) {
      const indexed = candidates[target.fileIdx];
      if (isVideoFile(indexed.file)) {
        return indexed;
      }
    }

    // 4. Fallback to largest video file
    return videoCandidates.reduce((prev, curr) => (curr.file.size > prev.file.size ? curr : prev));
  }

  return videoCandidates[0] || null;
}

export function matchPlayableFile(files: FileItem[], target: MatchTarget): FileItem | null {
  const wrapped = files.map((f) => ({ file: f }));
  const matched = matchPlayableCandidate(wrapped, target);
  return matched ? matched.file : null;
}
