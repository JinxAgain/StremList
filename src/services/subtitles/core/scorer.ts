import { SubtitleCandidate, VideoQueryMeta } from '../types.js';
import { extractSeasonsFromText } from '../providers/base.js';
import { SubhdProvider } from '../providers/subhd.js';

export class SubtitleScorer {
  public static rankCandidates(
    candidates: SubtitleCandidate[],
    query: VideoQueryMeta,
    langPreference = 'bilingual',
    maxResults = 8
  ): SubtitleCandidate[] {
    if (!candidates || candidates.length === 0) {
      return [];
    }

    const scored = candidates.map((cand) => {
      cand.score = this.calculateScore(cand, query, langPreference);
      return cand;
    });

    // Sort descending by score, rate, downloads
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.rate !== a.rate) return b.rate - a.rate;
      return b.downloadsCount - a.downloadsCount;
    });

    // Deduplicate candidates with exact same (provider, id)
    const seen = new Set<string>();
    const deduped: SubtitleCandidate[] = [];

    for (const c of scored) {
      const key = `${c.provider}:${c.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(c);
      }
    }

    return deduped.slice(0, maxResults);
  }

  public static calculateScore(
    candidate: SubtitleCandidate,
    query: VideoQueryMeta,
    langPref = 'bilingual'
  ): number {
    let score = 0.0;
    const titleLower = (candidate.title || '').toLowerCase();
    const isTv = query.mediaType === 'series' || query.season !== undefined;

    if (candidate.provider === 'subhd' && SubhdProvider.isRateLimited()) {
      score -= 2000.0;
    }

    if (
      candidate.tags.fmt.length > 0 &&
      !candidate.tags.fmt.some((f) => ['srt', 'ass', 'ssa', 'vtt'].includes(f.toLowerCase()))
    ) {
      score -= 2000.0;
    }

    // 1. Season conflict check for TV series
    let hasSeasonConflict = false;
    let candSeasons = new Set<number>();
    if (isTv && query.season !== undefined) {
      candSeasons = extractSeasonsFromText(candidate.title);
      if (candSeasons.size > 0 && !candSeasons.has(query.season)) {
        hasSeasonConflict = true;
      }
    }

    // IMDb exact match bonus
    if (candidate.tags.imdbMatched && !hasSeasonConflict) {
      score += 1000.0;
    }

    // 2. Release year verification
    if (query.year) {
      const candYearsMatches = Array.from(titleLower.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((m) => parseInt(m[1], 10));
      const candYears = candYearsMatches.filter((y) => y !== 1080 && y !== 2160);
      if (candYears.length > 0) {
        if (candYears.some((y) => Math.abs(y - query.year!) <= 1)) {
          score += 150.0;
        } else if (!candidate.tags.imdbMatched) {
          score -= 1500.0;
        }
      }
    }

    // 3. Episode matching for TV series
    if (isTv && query.episode !== undefined) {
      const ep = query.episode;
      const s = query.season;

      if (hasSeasonConflict) {
        score -= 5000.0; // Heavy penalty if candidate title explicitly indicates a different season!
      } else if ((candSeasons.size > 0 && s !== undefined && candSeasons.has(s)) || Boolean(candidate.tags.seasonMatched)) {
        score += 400.0; // Explicit season match bonus
      }

      // Extract all explicit episode numbers
      const eps1 = Array.from(titleLower.matchAll(/(?:^|[^a-zA-Z0-9]|s\d{1,2})[eE][pP]?(\d{1,3})(?!\d)/gi)).map((m) => parseInt(m[1], 10));
      const eps2 = Array.from(titleLower.matchAll(/第\s*(\d{1,3})\s*[集话話]/g)).map((m) => parseInt(m[1], 10));
      const foundEps = Array.from(new Set([...eps1, ...eps2])).sort((a, b) => a - b);

      const matchedEp = foundEps.includes(ep) || Boolean(candidate.tags.episodeMatched);

      // Check season match
      let seasonMatches = false;
      if (s !== undefined) {
        const seasonPats = [
          new RegExp(`\\bs0*${s}\\b`, 'i'),
          new RegExp(`\\bs0*${s}[^\\d]`, 'i'),
          new RegExp(`season\\s*0*${s}\\b`, 'i'),
          new RegExp(`第\\s*0*${s}\\s*季`)
        ];
        seasonMatches = seasonPats.some((pat) => pat.test(titleLower)) || candSeasons.has(s) || Boolean(candidate.tags.seasonMatched);
      } else if (Boolean(candidate.tags.seasonMatched)) {
        seasonMatches = true;
      }

      // Check if mentions conflicting other episode
      let hasConflictingEp = false;
      if (foundEps.length > 0) {
        if (!foundEps.includes(ep)) {
          const rangeMatch = titleLower.match(/\b[eE]?(\d{1,3})\s*[-~至到]\s*[eE]?(\d{1,3})\b/);
          if (rangeMatch) {
            const startEp = parseInt(rangeMatch[1], 10);
            const endEp = parseInt(rangeMatch[2], 10);
            if (!(startEp <= ep && ep <= endEp)) {
              hasConflictingEp = true;
            }
          } else {
            hasConflictingEp = true;
          }
        }
      }

      const isSeasonPack =
        candidate.tags.collection ||
        /全|合集|pack|complete|\b\d+-\d+\b|全部|整季|季全|全集/.test(titleLower) ||
        (seasonMatches && !matchedEp && !hasConflictingEp);

      if (isSeasonPack && !hasSeasonConflict && (seasonMatches || s === undefined || Boolean(candidate.tags.collection))) {
        score += 1150.0;
      } else if (matchedEp && !hasSeasonConflict) {
        score += 1000.0;
      } else if (hasConflictingEp) {
        score -= 600.0;
      } else {
        score -= 200.0;
      }
    }

    // 4. Language preference scoring strictly from tags
    const tags = candidate.tags;
    const isBilingual = Boolean(tags.bilingual);
    const isCht = tags.lang.includes('cht');
    const isChs = tags.lang.includes('chs');

    if (langPref === 'bilingual') {
      if (isBilingual) score += 600.0;
      else if (isChs) score += 350.0;
      else if (isCht) score += 300.0;
    } else if (langPref === 'cht') {
      if (isCht) score += 600.0;
      else if (isBilingual) score += 450.0;
      else if (isChs) score += 200.0;
    } else {
      if (isChs && !isCht) score += 600.0;
      else if (isBilingual) score += 450.0;
      else if (isCht) score += 200.0;
    }

    // 5. Format bonus
    for (const fmt of tags.fmt) {
      const f = fmt.toLowerCase();
      if (f === 'ass' || f === 'ssa') score += 30.0;
      else if (f === 'srt') score += 20.0;
    }

    // 6. Source translation quality bonus
    for (const src of tags.source) {
      const sLower = src.toLowerCase();
      if (/official|官方|官译/.test(sLower)) score += 100.0;
      else if (/ai|ai校对|ai润色|ai翻译/.test(sLower)) score += 40.0;
      else if (/machine|机器翻译|机翻/.test(sLower)) score -= 50.0;
      else if (/reprint|精修|转载精修/.test(sLower)) score += 80.0;
      else if (/original|原创/.test(sLower)) score += 60.0;
    }

    // 7. Rating and popularity bonus
    if (candidate.rate > 0) {
      score += Math.min(candidate.rate * 10.0, 50.0);
    }
    if (candidate.downloadsCount > 0) {
      score += Math.min(candidate.downloadsCount / 50.0, 40.0);
    }

    // 8. Video quality & release group matching
    if (/2160p|4k|uhd/.test(titleLower)) score += 80.0;
    else if (titleLower.includes('1080p')) score += 60.0;
    else if (titleLower.includes('720p')) score += 20.0;

    if (/bluray|bdrip|remux/.test(titleLower)) score += 60.0;
    else if (/web-dl|webrip|amzn|nf|hulu/.test(titleLower)) score += 50.0;
    else if (titleLower.includes('hdtv')) score += 10.0;

    // Filename matching bonus
    if (query.filename) {
      const fnLower = query.filename.toLowerCase();
      for (const grp of ['trollhd', 'sauron', 'casstudio', 'yyets', 'fix', 'chd', 'wiki', 'ntb', 'dim', 'ctrlhd']) {
        if (titleLower.includes(grp) && fnLower.includes(grp)) {
          score += 120.0;
          break;
        }
      }
      for (const res of ['2160p', '1080p', '720p']) {
        if (titleLower.includes(res) && fnLower.includes(res)) {
          score += 60.0;
          break;
        }
      }
      for (const srcTag of ['bluray', 'web-dl', 'webrip', 'hdtv']) {
        if (titleLower.includes(srcTag) && fnLower.includes(srcTag)) {
          score += 40.0;
          break;
        }
      }
    }

    return score;
  }
}
