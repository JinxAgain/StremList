import axios, { AxiosInstance } from 'axios';
import { SubtitleCandidate, VideoQueryMeta } from '../types.js';

export const CN_NUM_MAP: Record<number, string> = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
  6: '六', 7: '七', 8: '八', 9: '九', 10: '十',
  11: '十一', 12: '十二', 13: '十三', 14: '十四', 15: '十五',
  16: '十六', 17: '十七', 18: '十八', 19: '十九', 20: '二十'
};

export const CN_SEASON_REV: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
  '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20
};

export function toCnSeason(season?: number): string {
  if (season === undefined || season === null) return '';
  const cnNum = CN_NUM_MAP[season] || String(season);
  return `第${cnNum}季`;
}

export function extractSeasonsFromText(text: string): Set<number> {
  const seasons = new Set<number>();
  if (!text) return seasons;

  // S01, S1, S04
  for (const m of text.matchAll(/\b[sS](\d{1,2})(?:[^\d]|$)/g)) {
    seasons.add(parseInt(m[1], 10));
  }

  // Season 1, Season 04
  for (const m of text.matchAll(/\bseason\s*(\d{1,2})\b/gi)) {
    seasons.add(parseInt(m[1], 10));
  }

  // 第1季, 第04季
  for (const m of text.matchAll(/第\s*(\d{1,2})\s*季/g)) {
    seasons.add(parseInt(m[1], 10));
  }

  // 第一季, 第四季, etc.
  for (const m of text.matchAll(/第\s*([一二三四五六七八九十]+)\s*季/g)) {
    const val = CN_SEASON_REV[m[1]];
    if (val) seasons.add(val);
  }

  // Season ranges: S01-S03, S1-S4
  for (const m of text.matchAll(/\b[sS](\d{1,2})\s*[-~至到]\s*[sS]?(\d{1,2})\b/g)) {
    const sStart = parseInt(m[1], 10);
    const sEnd = parseInt(m[2], 10);
    if (sStart > 0 && sStart <= sEnd && sEnd <= 30) {
      for (let s = sStart; s <= sEnd; s++) seasons.add(s);
    }
  }

  // Chinese season ranges: 第1-3季, 第一季至第三季
  for (const m of text.matchAll(/第\s*(\d{1,2})\s*[-~至到]\s*(\d{1,2})\s*季/g)) {
    const sStart = parseInt(m[1], 10);
    const sEnd = parseInt(m[2], 10);
    if (sStart > 0 && sStart <= sEnd && sEnd <= 30) {
      for (let s = sStart; s <= sEnd; s++) seasons.add(s);
    }
  }

  return seasons;
}

export function isEpisodeMatch(
  title: string,
  season?: number,
  episode?: number
): [boolean, boolean] {
  if (season === undefined && episode === undefined) {
    return [true, false];
  }

  const titleLower = title.toLowerCase();

  // Step 1: Strict Season Conflict Check
  if (season !== undefined) {
    const foundSeasons = extractSeasonsFromText(title);
    if (foundSeasons.size > 0 && !foundSeasons.has(season)) {
      return [false, false];
    }
  }

  // Step 2: Target Episode Match
  if (episode !== undefined) {
    const epPatterns = [
      new RegExp(`\\b[eE][pP]?0*${episode}\\b`, 'i'),
      new RegExp(`第\\s*0*${episode}\\s*[集话話]`, 'i'),
      new RegExp(`\\[0*${episode}\\]`, 'i'),
      new RegExp(`(?:^|[._ -])0*${episode}(?:[._ -]|\\.(srt|ass|ssa|vtt))`, 'i')
    ];
    if (season !== undefined) {
      epPatterns.unshift(new RegExp(`[sS]0*${season}[eE]0*${episode}\\b`, 'i'));
    }

    const matchedEp = epPatterns.some((pat) => pat.test(title));

    // Check if title explicitly specifies a different single episode
    const allEpsMatches = Array.from(titleLower.matchAll(/(?:^|[^a-zA-Z0-9]|s\d{1,2})[eE][pP]?(\d{1,3})(?!\d)/gi)).map((m) => parseInt(m[1], 10));
    const cnEpsMatches = Array.from(titleLower.matchAll(/第\s*(\d{1,3})\s*[集话話]/g)).map((m) => parseInt(m[1], 10));
    const allEps = [...allEpsMatches, ...cnEpsMatches];

    let hasDifferentEp = false;
    if (allEps.length > 0 && !allEps.includes(episode)) {
      hasDifferentEp = true;
    }

    if (matchedEp) {
      return [true, false];
    }
    if (hasDifferentEp) {
      return [false, false];
    }
  }

  // Step 3: Season pack / collection match
  const packRegex = /全|合集|pack|complete|\b\d+-\d+\b|全部|整季|季全|全集/i;
  const isPack = packRegex.test(titleLower);

  if (season !== undefined) {
    const foundSeasons = extractSeasonsFromText(title);
    const matchesTargetSeason = foundSeasons.size > 0 ? foundSeasons.has(season) : false;
    const hasExplicitEp = /(?:[eE][pP]?|第\s*)\d+|(?:\b|\D)\d{1,2}\s*[集话話]/.test(titleLower);

    if (matchesTargetSeason && (isPack || !hasExplicitEp)) {
      return [true, true];
    }
  }

  if (isPack && season === undefined) {
    return [true, true];
  }

  return [false, false];
}

export function extractMetaFromFilename(
  filename: string
): { title: string; year: number | null; season: number | null; episode: number | null } {
  if (!filename) {
    return { title: '', year: null, season: null, episode: null };
  }

  let clean = decodeURIComponent(filename);
  clean = clean.replace(/\.(mkv|mp4|avi|ts|mov|m4v|iso|wmv|flv)$/i, '');

  let season: number | null = null;
  let episode: number | null = null;

  const sMatch = clean.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
  if (sMatch) {
    season = parseInt(sMatch[1], 10);
    episode = parseInt(sMatch[2], 10);
  }

  let year: number | null = null;
  const yMatch = clean.match(/\b(19\d\d|20\d\d)\b/);
  if (yMatch) {
    year = parseInt(yMatch[1], 10);
  }

  const cutoffPatterns = [
    /[Ss]\d{1,2}[Ee]\d{1,2}/,
    /\b(19\d\d|20\d\d)\b/,
    /\b(1080p|720p|2160p|4k|bluray|web-dl|webrip|hdtv|remux)\b/i
  ];

  let minIdx = clean.length;
  for (const pat of cutoffPatterns) {
    const m = clean.match(pat);
    if (m && m.index !== undefined && m.index < minIdx && m.index > 0) {
      minIdx = m.index;
    }
  }

  const titlePart = clean.slice(0, minIdx).replace(/^[ .\-_]+|[ .\-_]+$/g, '');
  const title = titlePart.replace(/[._]/g, ' ').trim();

  return { title, year, season, episode };
}

export function extractReleaseTags(candTitle: string): string[] {
  const tags: string[] = [];
  let text = (candTitle || '').trim();
  text = text.replace(/\.(zip|rar|7z|tar|gz|bz2|srt|ass|ssa|vtt)$/i, '');

  if (/官方|官译/i.test(text)) tags.push('Official');
  if (/精修|转载精修/i.test(text)) tags.push('Refined');
  if (/全\s*\d+\s*[集话話]|全集|合集|全部|整季|季全/i.test(text)) tags.push('Complete');

  if (/\b(remux)\b/i.test(text)) tags.push('REMUX');
  else if (/\b(blu-?ray|bdrip|brrip|blu\.ray)\b/i.test(text)) tags.push('BluRay');
  else if (/\b(web-?dl|amzn[\.\s_-]?web-?dl)\b/i.test(text)) tags.push('WEB-DL');
  else if (/\b(web-?rip)\b/i.test(text)) tags.push('WEBRip');
  else if (/\b(web)\b/i.test(text)) tags.push('WEB-DL');
  else if (/\b(hdtv|hdtvrip)\b/i.test(text)) tags.push('HDTV');
  else if (/\b(dvdrip|dvd)\b/i.test(text)) tags.push('DVDRip');
  else if (/\b(cam-?rip|cam|telesync|ts)\b/i.test(text)) tags.push('CAM-Rip');

  const resMatch = text.match(/(2160p|4k|1080p|1080i|720p|480p|576p)/i);
  if (resMatch) {
    const val = resMatch[1].toLowerCase();
    tags.push(val === '4k' ? '4K' : val);
  }

  if (/\b(x265|hevc|h[\.\s_-]?265)\b/i.test(text)) tags.push('x265');
  else if (/\b(x264|avc|h[\.\s_-]?264)\b/i.test(text)) tags.push('x264');

  if (/\b(10-?bit)\b/i.test(text)) tags.push('10bit');
  if (/\b(hdr10\+|hdr10|hdr)\b/i.test(text)) tags.push('HDR');
  if (/\b(dv|dolby[\.\s_-]?vision)\b/i.test(text)) tags.push('DV');

  if (/\b(atmos)\b/i.test(text)) tags.push('Atmos');
  else if (/\b(ddp[\.\s_-]?5[\.\s_-]?1|ddp)\b/i.test(text)) tags.push('DDP5.1');

  const groupMatch = text.match(/[-. ](PSA|KINGDOM|POKE|SCOPE|YTS|YIFY|RARBG|YYeTs|FLUX|NTb|BONE)\b/i);
  if (groupMatch) {
    tags.push(groupMatch[1].toUpperCase());
  } else if (/人人影视|yyets/i.test(text)) {
    tags.push('YYeTs');
  }

  if (tags.length === 0) {
    const cleanAscii = text.replace(/[^A-Za-z0-9]/g, ' ');
    for (const w of cleanAscii.split(/\s+/)) {
      if (w.length > 2 && !/^\d+$/.test(w) && !['the', 'and', 'srt', 'sub'].includes(w.toLowerCase())) {
        tags.push(w);
        if (tags.length >= 3) break;
      }
    }
  }

  // Deduplicate preserving order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const t of tags) {
    const tl = t.toLowerCase();
    if (!seen.has(tl)) {
      seen.add(tl);
      deduped.push(t);
    }
  }
  return deduped;
}

export function formatSubtitleInfo(
  cand: SubtitleCandidate,
  query: VideoQueryMeta
): { label: string; filename: string } {
  const provTag = cand.provider.toLowerCase() === 'subhd' ? 'SubHD' : 'Zimuku';
  let langTag = 'Chs';
  if (cand.tags.bilingual) langTag = 'Bilingual';
  else if (cand.tags.lang.includes('cht')) langTag = 'Cht';

  const tagBracketSpace = `[${langTag} ${provTag}]`;
  const tagBracketDot = `[${langTag}.${provTag}]`;

  let cleanTitle = (query.title || 'Subtitle').replace(/[^A-Za-z0-9 ]/g, ' ').trim();
  cleanTitle = cleanTitle.split(/\s+/).join(' ') || 'Subtitle';
  const dotTitle = cleanTitle.replace(/\s+/g, '.');

  let epTag = '';
  if ((query.mediaType === 'series' || query.season !== undefined) && query.episode !== undefined) {
    const s = String(query.season ?? 1).padStart(2, '0');
    const ep = String(query.episode).padStart(2, '0');
    epTag = `S${s}E${ep}`;
  } else if (query.year) {
    epTag = String(query.year);
  }

  const tags = extractReleaseTags(cand.title || '');

  // Human readable label: OpenSubtitles v3 style
  const labelParts = [cleanTitle];
  if (epTag && !labelParts.includes(epTag)) labelParts.push(epTag);
  labelParts.push(...tags);
  labelParts.push(tagBracketSpace);
  const label = labelParts.join(' · ');

  // URL-safe ASCII filename
  const fnParts = [dotTitle];
  if (epTag && !fnParts.includes(epTag)) fnParts.push(epTag);
  fnParts.push(...tags);
  fnParts.push(tagBracketDot);
  let filenameBody = fnParts.join('.').replace(/\.+/g, '.').replace(/^[._\- ]+|[._\- ]+$/g, '');
  if (filenameBody.length > 120) {
    const truncated = filenameBody.slice(0, 120);
    filenameBody = truncated.includes('.') ? truncated.slice(0, truncated.lastIndexOf('.')) : truncated;
  }

  return { label, filename: `${filenameBody}.srt` };
}

export abstract class BaseProvider {
  public abstract readonly name: string;
  protected client: AxiosInstance;

  constructor(proxy?: string) {
    this.client = axios.create({
      timeout: 12000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });

    if (proxy) {
      // Axios proxy configuration can be passed if needed
    }
  }

  public abstract search(meta: VideoQueryMeta): Promise<SubtitleCandidate[]>;
  public abstract download(candidate: SubtitleCandidate): Promise<{ buffer: Buffer; filename: string } | null>;
}
