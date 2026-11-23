import path from 'path';
import {
  BaseProvider,
  isEpisodeMatch,
  extractMetaFromFilename,
  extractFilenameFromResponse,
  parseSourceTagsFromText,
  parseLangAndBilingualFromText,
  hasChineseSubtitle,
  extractSeasonsFromText,
  extractSeasonAndBaseTitle
} from './base.js';
import {
  SubtitleExtractor,
  SUBTITLE_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  BILINGUAL_REGEX
} from '../core/extractor.js';
import {
  AssrtFileListItem,
  AssrtSubItem,
  DownloadOptions,
  SubtitleCandidate,
  SubtitleTags,
  VideoQueryMeta
} from '../types.js';
import { loadConfig } from '../../../config.js';

export interface AssrtQuotaResult {
  success: boolean;
  quota?: number;
  status?: number;
  message: string;
}

export interface AssrtStrictMatchResult {
  matched: boolean;
  isCollection: boolean;
  episodeMatched: boolean;
  yearMatched: boolean;
}

const TV_ONLY_PATTERNS = [
  /\b[sS]\d{1,2}\s*[eE]\d{1,3}\b/,
  /\bseason\s*\d+\b/i,
  /第\s*[0-9一二三四五六七八九十]+\s*[季集话話]/,
  /全\s*\d+\s*[集话話]/,
  /\b[eE][pP]\.?\s*\d{1,3}\b/
];

export class AssrtProvider extends BaseProvider {
  public readonly name = 'assrt';

  private static rateLimitedUntil = 0;
  private static unhealthyDomains = new Map<string, number>();

  private readonly baseUrl: string;
  private readonly fallbackUrls: string[];
  private readonly explicitToken?: string;

  constructor(proxy?: string, token?: string) {
    super(proxy);
    this.explicitToken = token?.trim() || undefined;
    this.baseUrl = (process.env.ASSRT_BASE_URL || 'https://api.assrt.net').replace(/\/+$/, '');
    const fallbacksEnv = process.env.ASSRT_FALLBACKS || 'http://api.makedie.me';
    this.fallbackUrls = fallbacksEnv
      .split(',')
      .map((u) => u.trim().replace(/\/+$/, ''))
      .filter(Boolean);
  }

  private normalizeFileList(filelist: unknown): AssrtFileListItem[] {
    if (Array.isArray(filelist)) {
      return filelist.filter(
        (item): item is AssrtFileListItem =>
          Boolean(item && typeof item === 'object' && typeof (item as any).f === 'string')
      );
    }
    if (filelist && typeof filelist === 'object') {
      return Object.values(filelist as Record<string, unknown>).filter(
        (item): item is AssrtFileListItem =>
          Boolean(item && typeof item === 'object' && typeof (item as any).f === 'string')
      );
    }
    return [];
  }

  private normalizeSubsList(subs: unknown): AssrtSubItem[] {
    if (Array.isArray(subs)) {
      return subs.filter(
        (item): item is AssrtSubItem =>
          Boolean(item && typeof item === 'object' && (item as any).id !== undefined)
      );
    }
    if (subs && typeof subs === 'object') {
      return Object.values(subs as Record<string, unknown>).filter(
        (item): item is AssrtSubItem =>
          Boolean(item && typeof item === 'object' && (item as any).id !== undefined)
      );
    }
    return [];
  }

  private cleanVideoName(raw?: string): string {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    if (/^(不知道|未知|无|暂无|none|unknown|n\/a|-+)$/i.test(trimmed)) {
      return '';
    }
    return trimmed;
  }

  public static isRateLimited(): boolean {
    return Date.now() / 1000 < this.rateLimitedUntil;
  }

  public static markRateLimited(durationSeconds = 60, reason = 'Quota exceeded'): void {
    this.rateLimitedUntil = Date.now() / 1000 + durationSeconds;
    console.warn(`[ASSRT] Rate limit detected (${reason}). Cooling down for ${durationSeconds}s.`);
  }

  public static isDomainHealthy(domain: string): boolean {
    const until = this.unhealthyDomains.get(domain) || 0;
    return Date.now() / 1000 > until;
  }

  public static markDomainUnhealthy(domain: string, cooldownSecs = 600): void {
    this.unhealthyDomains.set(domain, Date.now() / 1000 + cooldownSecs);
    console.warn(`[ASSRT] Marking endpoint ${domain} as unhealthy for ${cooldownSecs}s`);
  }

  private resolveToken(tokenOverride?: string): string {
    if (tokenOverride && tokenOverride.trim()) return tokenOverride.trim();
    if (this.explicitToken) return this.explicitToken;
    try {
      const cfg = loadConfig();
      if (cfg.assrtToken && cfg.assrtToken.trim()) {
        return cfg.assrtToken.trim();
      }
    } catch {
      // Ignore config read error and fall back to env
    }
    return process.env.ASSRT_TOKEN?.trim() || '';
  }

  private getEndpoints(): string[] {
    const endpoints = [this.baseUrl, ...this.fallbackUrls].filter(
      (d, i, self) => self.indexOf(d) === i && AssrtProvider.isDomainHealthy(d)
    );
    if (endpoints.length === 0) endpoints.push(this.baseUrl);
    return endpoints;
  }

  /**
   * ASSRT API returns error 101 if keyword length <= 3.
   * Pads short titles with release year or a safe suffix so q.length > 3.
   */
  public ensureMinQueryLength(q: string, year?: number): string {
    const trimmed = (q || '').trim();
    if (!trimmed) return '';
    if (trimmed.length > 3) return trimmed;
    if (year) {
      const withYear = `${trimmed} ${year}`;
      if (withYear.length > 3) return withYear;
    }
    return `${trimmed} subtitle`;
  }

  private isSeriesMeta(meta: VideoQueryMeta): boolean {
    return (
      meta.mediaType === 'series' ||
      (meta.mediaType !== 'movie' && (meta.season !== undefined || meta.episode !== undefined))
    );
  }

  private normalizeTitle(text: string): string {
    return (text || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private stripLeadingArticle(normTitle: string): string {
    const stripped = normTitle.replace(/^(?:the|a|an)\s+/, '').trim();
    return stripped.length >= 4 ? stripped : normTitle;
  }

  private cleanTitleSegment(seg: string, isTv = false): string {
    let cleaned = (seg || '').trim();
    if (!cleaned) return '';

    // Remove trailing bracketed tags such as (2026), [Bilingual], etc.
    cleaned = cleaned.replace(/(?:\s*[\(\[【（][^()\[\]【】（）]*[\)\]】）])+\s*$/g, '').trim();

    // Cut off at season/episode/release markers
    const cutoffs = [
      /[sS]\d{1,2}\s*[eE]\d{1,3}/,
      /[sS]\d{1,2}\s*[-~至到]\s*[sS]?\d{1,2}/,
      /(?:^|[\s._\-])[sS]\d{1,2}(?:$|[\s._\-])/,
      /第\s*[0-9一二三四五六七八九十]+\s*[季集话話]/,
      /\bseason\s*\d{1,2}\b/i,
      /\b[eE][pP]\.?\s*\d{1,3}\b/,
      /\b(1080p|720p|2160p|4k|bluray|blu-ray|web-dl|webrip|hdtv|remux)\b/i
    ];
    let minIdx = cleaned.length;
    for (const pat of cutoffs) {
      const m = cleaned.match(pat);
      if (m && m.index !== undefined && m.index > 0 && m.index < minIdx) {
        minIdx = m.index;
      }
    }
    cleaned = cleaned.slice(0, minIdx).replace(/[\s._\-:]+$/, '').trim();

    if (isTv) {
      const { baseTitle } = extractSeasonAndBaseTitle(cleaned);
      return (baseTitle || cleaned).replace(/[\s._\-:]+$/, '').trim();
    }
    return cleaned;
  }

  private collectCandidateTitleVariants(item: AssrtSubItem, targetYear?: number, isTv = false): Set<string> {
    const variants = new Set<string>();

    const addVariant = (raw: string) => {
      const norm = this.normalizeTitle(raw);
      if (!norm) return;
      variants.add(norm);
      variants.add(this.stripLeadingArticle(norm));

      if (isTv) {
        const { baseTitle } = extractSeasonAndBaseTitle(raw);
        if (baseTitle && baseTitle !== raw) {
          const baseNorm = this.normalizeTitle(baseTitle);
          if (baseNorm) {
            variants.add(baseNorm);
            variants.add(this.stripLeadingArticle(baseNorm));
          }
        }
      }
    };

    const addSegmentVariants = (rawSeg: string) => {
      const cleaned = this.cleanTitleSegment(rawSeg, isTv);
      addVariant(cleaned);

      // Keep unstripped bracket-free variant for titles ending in numbers or sequels
      const noBrackets = rawSeg.replace(/(?:\s*[\(\[【（][^()\[\]【】（）]*[\)\]】）])+\s*$/g, '').trim();
      const withoutTrailingYear = cleaned.replace(/[\s._\-:]+(19\d\d|20\d\d)$/, '').trim();
      if (withoutTrailingYear && withoutTrailingYear !== cleaned) {
        addVariant(withoutTrailingYear);
      }
      if (noBrackets && noBrackets !== cleaned) {
        addVariant(noBrackets);
      }

      // Extract filename-style title if segment looks like a release name
      const fnParsed = extractMetaFromFilename(rawSeg);
      if (fnParsed.title) {
        addVariant(this.cleanTitleSegment(fnParsed.title, isTv));
      }

      if (targetYear) {
        const idx = rawSeg.search(new RegExp(`(?:^|[._\\s\\-(])${targetYear}(?:[._\\s\\-)]|$)`));
        if (idx > 0) {
          addVariant(this.cleanTitleSegment(rawSeg.slice(0, idx).replace(/[._]/g, ' '), isTv));
        }
      }
    };

    const splitAndAdd = (raw?: string) => {
      if (!raw) return;
      for (const part of raw.split('/')) {
        const trimmedPart = part.trim();
        if (!trimmedPart) continue;
        addSegmentVariants(trimmedPart);

        // Split bilingual segments written without '/' BEFORE cutting at season markers
        // e.g. "Cyberpunk Chinese Season 2 Cyberpunk: Edgerunners Season 2 (2026)"
        const cjkLatinMatch = trimmedPart.match(
          /^([\u4e00-\u9fff0-9：:·\s第季集话話一二三四五六七八九十]+?)\s+([A-Za-z][A-Za-z0-9\s:'\-.,&()]+)$/
        );
        if (cjkLatinMatch) {
          addSegmentVariants(cjkLatinMatch[1]);
          addSegmentVariants(cjkLatinMatch[2]);
        }
        const latinCjkMatch = trimmedPart.match(
          /^([A-Za-z][A-Za-z0-9\s:'\-.,&()]+?)\s+([\u4e00-\u9fff][\u4e00-\u9fff0-9：:·\s第季集话話一二三四五六七八九十()（）]+)$/
        );
        if (latinCjkMatch) {
          addSegmentVariants(latinCjkMatch[1]);
          addSegmentVariants(latinCjkMatch[2]);
        }
      }
    };

    splitAndAdd(item.native_name);
    splitAndAdd(item.title);

    for (const fn of [this.cleanVideoName(item.videoname), this.cleanVideoName(item.filename)]) {
      if (fn) {
        const parsed = extractMetaFromFilename(fn);
        if (parsed.title) {
          addVariant(this.cleanTitleSegment(parsed.title, isTv));
        }
        if (targetYear) {
          const idx = fn.search(new RegExp(`(?:^|[._\\s\\-(])${targetYear}(?:[._\\s\\-)]|$)`));
          if (idx > 0) {
            addVariant(this.cleanTitleSegment(fn.slice(0, idx).replace(/[._]/g, ' '), isTv));
          }
        }
      }
    }

    for (const f of this.normalizeFileList(item.filelist)) {
      const parsed = extractMetaFromFilename(f.f);
      if (parsed.title) {
        addVariant(this.cleanTitleSegment(parsed.title, isTv));
      }
    }

    return variants;
  }

  private collectTargetTitleVariants(meta: VideoQueryMeta, isTv: boolean): Set<string> {
    const targets = new Set<string>();
    const rawTitles = [meta.title, meta.baseTitle];
    if (meta.filename) {
      const parsed = extractMetaFromFilename(meta.filename);
      if (parsed.title) rawTitles.push(parsed.title);
    }

    for (const raw of rawTitles) {
      if (!raw || !raw.trim()) continue;
      const trimmed = raw.trim();
      const candidates = isTv ? [trimmed, extractSeasonAndBaseTitle(trimmed).baseTitle] : [trimmed];
      for (const t of candidates) {
        const norm = this.normalizeTitle(t);
        if (norm) {
          targets.add(norm);
          targets.add(this.stripLeadingArticle(norm));
        }
      }
    }
    return targets;
  }

  private filterFilesBySeason(files: string[], targetSeason?: number): string[] {
    if (targetSeason === undefined) return files;
    return files.filter((f) => {
      const seasons = extractSeasonsFromText(f);
      return seasons.size === 0 || seasons.has(targetSeason);
    });
  }

  private fileExplicitlyMatchesEpisode(filename: string, targetSeason: number, episode: number): boolean {
    const [m, col] = isEpisodeMatch(filename, targetSeason, episode);
    if (!m) return false;
    if (!col) return true;
    const lower = filename.toLowerCase();
    const rangeMatches = [
      ...Array.from(lower.matchAll(/(?:^|[^a-z0-9]|s\d{1,2})[eE][pP]?(\d{1,3})\s*[-~至到]\s*[eE]?[pP]?(\d{1,3})\b/gi)),
      ...Array.from(lower.matchAll(/(?:^|[^a-z0-9]|第)?\s*(\d{1,3})\s*[-~至到]\s*(\d{1,3})\s*[集话話]/g))
    ];
    return rangeMatches.some((rm) => {
      const startEp = parseInt(rm[1], 10);
      const endEp = parseInt(rm[2], 10);
      return startEp > 0 && startEp <= episode && episode <= endEp;
    });
  }

  private hasExplicitEpisodeMarkers(files: string[]): boolean {
    return files.some((f) =>
      /(?:[eE][pP]?|第\s*)\d+|(?:^|[._ -])\d{2,3}(?:[._ -]|\.(?:srt|ass|ssa|vtt))|\[\d{1,3}\]/i.test(f)
    );
  }

  /**
   * 4-stage strict matching filter to eliminate substring, cross-media,
   * older namesake, and wrong-episode false positives from full-text ASSRT search.
   */
  public isStrictAssrtMatch(item: AssrtSubItem, meta: VideoQueryMeta): AssrtStrictMatchResult {
    const reject: AssrtStrictMatchResult = {
      matched: false,
      isCollection: false,
      episodeMatched: false,
      yearMatched: false
    };

    const isTv = this.isSeriesMeta(meta);

    // Stage 1: Exact normalized title alignment
    const targetTitles = this.collectTargetTitleVariants(meta, isTv);
    if ((meta.title?.trim() || meta.baseTitle?.trim()) && targetTitles.size === 0) {
      return reject;
    }
    if (targetTitles.size > 0) {
      const candTitles = this.collectCandidateTitleVariants(item, meta.year, isTv);
      let titleAligned = false;
      for (const target of targetTitles) {
        if (candTitles.has(target)) {
          titleAligned = true;
          break;
        }
      }
      if (!titleAligned) {
        return reject;
      }
    }

    const fileNames = this.normalizeFileList(item.filelist).map((f) => f.f).filter(Boolean);
    const combinedText = [
      item.native_name || '',
      this.cleanVideoName(item.videoname),
      item.title || '',
      item.filename || ''
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    const fullTextWithFiles = `${combinedText} ${fileNames.join(' ')}`.trim();

    // Stage 2: Movie vs. Series isolation
    if (!isTv) {
      if (TV_ONLY_PATTERNS.some((pat) => pat.test(fullTextWithFiles))) {
        return reject;
      }
    }

    // Stage 3: Release year and upload_time temporal hard filter
    let yearMatched = false;
    if (meta.year) {
      if (!isTv && item.upload_time) {
        const um = String(item.upload_time).match(/^(\d{4})-/);
        if (um) {
          const uploadYear = parseInt(um[1], 10);
          if (uploadYear > 1990 && uploadYear < meta.year - 1) {
            return reject;
          }
        }
      }

      // Exclude 4-digit numbers that are part of the title itself (e.g., "Blade Runner 2049")
      const titleDigits = new Set(
        Array.from(`${meta.title || ''} ${meta.baseTitle || ''}`.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((m) =>
          parseInt(m[1], 10)
        )
      );
      const explicitYears = Array.from(combinedText.matchAll(/\b(19\d{2}|20\d{2})\b/g))
        .map((m) => parseInt(m[1], 10))
        .filter((y) => y !== 1080 && y !== 2160)
        .filter((y) => !(titleDigits.has(y) && Math.abs(y - meta.year!) > 1));

      if (explicitYears.length > 0) {
        const matchesMetaYear = explicitYears.some((y) => Math.abs(y - meta.year!) <= 1);
        if (matchesMetaYear) {
          yearMatched = true;
        } else if (!isTv) {
          return reject;
        }
      }
    }

    // Stage 4: Series season & episode verification (with filelist inspection)
    let isCollection = false;
    let episodeMatched = false;

    if (isTv) {
      const targetSeason = meta.season ?? 1;
      const foundSeasons = extractSeasonsFromText(combinedText);
      if (foundSeasons.size > 0 && !foundSeasons.has(targetSeason)) {
        return reject;
      }

      if (meta.episode !== undefined) {
        const [outerMatch, outerCol] = isEpisodeMatch(combinedText, targetSeason, meta.episode);
        const subFiles = fileNames.filter((f) =>
          SUBTITLE_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext))
        );

        if (subFiles.length > 0) {
          const seasonFiltered = this.filterFilesBySeason(subFiles, targetSeason);
          if (seasonFiltered.length === 0) {
            return reject;
          }

          const bestFile = SubtitleExtractor.pickBestFile(seasonFiltered, meta.episode);
          if (!bestFile) {
            return reject;
          }

          const epHitInFiles = seasonFiltered.some((f) =>
            this.fileExplicitlyMatchesEpisode(f, targetSeason, meta.episode!)
          );
          const hasExplicitEpInFiles = this.hasExplicitEpisodeMarkers(subFiles);

          if (!epHitInFiles && !(outerMatch && !outerCol && !hasExplicitEpInFiles)) {
            return reject;
          }

          episodeMatched = epHitInFiles || (outerMatch && !outerCol);
          isCollection = subFiles.length > 1 || outerCol;
        } else {
          if (!outerMatch) {
            return reject;
          }
          isCollection = outerCol;
          episodeMatched = !outerCol;
        }
      }
    }

    return {
      matched: true,
      isCollection,
      episodeMatched,
      yearMatched
    };
  }

  private buildTieredQueries(meta: VideoQueryMeta): Array<{ q: string; isFile: boolean }> {
    const queries: Array<{ q: string; isFile: boolean }> = [];
    let cleanTitle = (meta.title || '').trim();
    if (!cleanTitle && meta.filename) {
      const parsed = extractMetaFromFilename(meta.filename);
      if (parsed.title) cleanTitle = parsed.title;
      if (!meta.year && parsed.year) meta.year = parsed.year;
    }

    const isTv = this.isSeriesMeta(meta);
    const primaryTitle = isTv ? extractSeasonAndBaseTitle(cleanTitle).baseTitle || cleanTitle : cleanTitle;

    if (primaryTitle) {
      if (isTv) {
        const sPad = String(meta.season ?? 1).padStart(2, '0');
        if (meta.episode !== undefined) {
          const epPad = String(meta.episode).padStart(2, '0');
          queries.push({ q: `${primaryTitle} S${sPad}E${epPad}`, isFile: false });
        } else {
          queries.push({ q: `${primaryTitle} S${sPad}`, isFile: false });
        }
      } else if (meta.year) {
        queries.push({ q: `${primaryTitle} ${meta.year}`, isFile: false });
      } else {
        queries.push({ q: this.ensureMinQueryLength(primaryTitle, meta.year), isFile: false });
      }
    }

    // Tier 2 fallback: video filename (with is_file=1) or clean base title
    if (meta.filename) {
      const parsedPath = path.parse(meta.filename);
      const rawName = (parsedPath.name || meta.filename).trim();
      if (rawName.length > 3) {
        queries.push({ q: rawName, isFile: true });
      }
    }

    if (primaryTitle) {
      const paddedBase = this.ensureMinQueryLength(primaryTitle, meta.year);
      if (!queries.some((item) => item.q === paddedBase && !item.isFile)) {
        queries.push({ q: paddedBase, isFile: false });
      }
    }

    return queries.slice(0, 2);
  }

  private extractSubCandidate(
    sub: AssrtSubItem,
    meta: VideoQueryMeta,
    matchInfo: AssrtStrictMatchResult
  ): SubtitleCandidate | null {
    const subFiles = this.normalizeFileList(sub.filelist).map((f) => f.f).filter(Boolean);
    const cleanVid = this.cleanVideoName(sub.videoname);
    const subtypeLower = (sub.subtype || '').toLowerCase();

    // Extract text subtitle formats
    const fmt: string[] = [];
    for (const f of ['ass', 'srt', 'ssa', 'vtt']) {
      if (subtypeLower.includes(f) && !fmt.includes(f)) {
        fmt.push(f);
      }
    }
    for (const file of subFiles) {
      const lower = file.toLowerCase();
      for (const f of ['ass', 'srt', 'ssa', 'vtt']) {
        if (lower.endsWith(`.${f}`) && !fmt.includes(f)) {
          fmt.push(f);
        }
      }
    }

    // Skip bitmap-only VobSub/PGS entries or uploads without any recognized text subtitle format
    const hasSupportedFileExt = subFiles.some((f) => {
      const lower = f.toLowerCase();
      return (
        SUBTITLE_EXTENSIONS.some((ext) => lower.endsWith(ext)) ||
        ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))
      );
    });
    if (fmt.length === 0 || (subFiles.length > 0 && !hasSupportedFileExt)) {
      return null;
    }

    // Extract language & bilingual tags
    const tags: SubtitleTags = {
      provider: this.name,
      lang: [],
      bilingual: false,
      fmt,
      source: [],
      collection: matchInfo.isCollection,
      imdbMatched: Boolean(matchInfo.yearMatched || matchInfo.episodeMatched || matchInfo.isCollection),
      episodeMatched: matchInfo.episodeMatched,
      seasonMatched: this.isSeriesMeta(meta)
    };

    const langlist = sub.lang?.langlist || {};
    if (langlist.langdou) tags.bilingual = true;
    if (langlist.langchs && !tags.lang.includes('chs')) tags.lang.push('chs');
    if (langlist.langcht && !tags.lang.includes('cht')) tags.lang.push('cht');

    const langContext = [
      sub.lang?.desc || '',
      sub.native_name || '',
      cleanVid,
      sub.filename || '',
      ...subFiles
    ].join(' ');
    parseLangAndBilingualFromText(langContext, tags);

    if (tags.bilingual && tags.lang.length === 0) {
      tags.lang.push('chs');
    }

    if (!hasChineseSubtitle(tags)) {
      return null;
    }

    // Extract source quality tags and fansub/uploader info
    if (sub.release_site && sub.release_site.trim() && sub.release_site.trim() !== '个人') {
      tags.fansub = sub.release_site.trim();
    }
    if (sub.producer?.uploader) {
      tags.uploader = sub.producer.uploader.trim();
    }
    parseSourceTagsFromText(
      `${sub.release_site || ''} ${sub.producer?.source || ''} ${sub.native_name || ''} ${cleanVid}`,
      tags.source
    );
    if (sub.vote_machine_translate && !tags.source.includes('machine')) {
      tags.source.push('machine');
    }

    // Construct candidate title preserving Chinese title and release tags
    const rawNative = (sub.native_name || '').trim();
    const nativePrimary = rawNative.split('/')[0].trim();
    const videoRelease = (cleanVid || sub.filename || '').trim();
    let title = `ASSRT ${sub.id}`;
    if (videoRelease && nativePrimary && !videoRelease.toLowerCase().includes(nativePrimary.toLowerCase())) {
      title = `${nativePrimary} ${videoRelease}`.trim();
    } else if (videoRelease) {
      title = videoRelease;
    } else if (rawNative) {
      title = rawNative;
    } else if (sub.title) {
      title = sub.title.trim();
    }

    const rawScore = Number(sub.vote_score || 0);
    const rate = Math.min(5, Math.max(0, rawScore / 20));
    const downloadsCount = Number(sub.down_count || 0);
    const sid = String(sub.id);

    return {
      id: sid,
      provider: 'assrt',
      title,
      pageUrl: `https://assrt.net/xml/sub/${sid.slice(0, -3) || '0'}/${sid}.xml`,
      tags,
      rate,
      downloadsCount,
      score: 0
    };
  }

  public async search(meta: VideoQueryMeta, tokenOverride?: string): Promise<SubtitleCandidate[]> {
    if (AssrtProvider.isRateLimited()) return [];

    const token = this.resolveToken(tokenOverride);
    if (!token) return [];

    const queries = this.buildTieredQueries(meta);
    if (queries.length === 0) return [];

    const endpoints = this.getEndpoints();
    const candidates: SubtitleCandidate[] = [];
    const seenIds = new Set<string>();

    for (const domain of endpoints) {
      let domainFailed = false;

      for (const query of queries) {
        if (!query.q || query.q.length <= 3) continue;

        let resp: any;
        try {
          const params: Record<string, string | number> = {
            token,
            q: query.q,
            cnt: 15,
            pos: 0,
            filelist: 1
          };
          if (query.isFile) {
            params.is_file = 1;
          }

          resp = await this.client.get(`${domain}/v1/sub/search`, {
            params,
            headers: {
              Authorization: `Bearer ${token}`
            },
            timeout: 8000,
            validateStatus: () => true
          });
        } catch (err: any) {
          console.warn(`[ASSRT] Search failed on ${domain}:`, err.message);
          AssrtProvider.markDomainUnhealthy(domain, 600);
          domainFailed = true;
          break;
        }

        if (!resp.data || typeof resp.data !== 'object') {
          AssrtProvider.markDomainUnhealthy(domain, 300);
          domainFailed = true;
          break;
        }

        const apiStatus = resp.data?.status;
        if (apiStatus === 30900 || resp.status === 429) {
          AssrtProvider.markRateLimited(60, 'ASSRT status 30900 quota limit');
          return candidates;
        }

        if (apiStatus === 20001 || apiStatus === 1) {
          console.warn(`[ASSRT] Invalid token or user error (${apiStatus})`);
          return [];
        }

        if (resp.status >= 500 || (apiStatus !== undefined && apiStatus >= 30000)) {
          AssrtProvider.markDomainUnhealthy(domain, 300);
          domainFailed = true;
          break;
        }

        if (resp.status === 200 && apiStatus === 0) {
          const subs = this.normalizeSubsList(resp.data?.sub?.subs);
          for (const sub of subs) {
            const sid = String(sub.id);
            if (seenIds.has(sid)) continue;

            try {
              const matchInfo = this.isStrictAssrtMatch(sub, meta);
              if (!matchInfo.matched) continue;

              const candidate = this.extractSubCandidate(sub, meta, matchInfo);
              if (candidate) {
                seenIds.add(sid);
                candidates.push(candidate);
              }
            } catch (parseErr: any) {
              console.warn(`[ASSRT] Failed to parse subtitle ${sid}:`, parseErr.message);
            }
          }
        }

        // Stop early on Tier 1 hit to preserve 20 req/min quota
        if (candidates.length > 0) {
          return candidates;
        }
      }

      if (candidates.length > 0 || !domainFailed) {
        break;
      }
    }

    return candidates;
  }

  private isLikelyErrorPayload(buf: Buffer, contentType?: string): boolean {
    if (contentType) {
      const ct = contentType.toLowerCase();
      if (ct.includes('text/html') || ct.includes('application/json')) {
        return true;
      }
    }
    const sample = buf.slice(0, 512).toString('utf-8').trimStart().toLowerCase();
    if (
      sample.startsWith('<!doctype') ||
      sample.startsWith('<html') ||
      sample.startsWith('<head') ||
      sample.startsWith('<body')
    ) {
      return true;
    }
    if (sample.startsWith('{') && (sample.includes('"status"') || sample.includes('"errmsg"') || sample.includes('"error"'))) {
      return true;
    }
    return false;
  }

  public async download(
    candidate: SubtitleCandidate,
    options?: DownloadOptions
  ): Promise<{ buffer: Buffer; filename: string } | null> {
    if (AssrtProvider.isRateLimited()) return null;

    const token = this.resolveToken(options?.token);
    if (!token) return null;

    const endpoints = this.getEndpoints();

    for (const domain of endpoints) {
      let detailResp: any;
      try {
        detailResp = await this.client.get(`${domain}/v1/sub/detail`, {
          params: { token, id: candidate.id },
          headers: {
            Authorization: `Bearer ${token}`
          },
          timeout: 8000,
          validateStatus: () => true
        });
      } catch (err: any) {
        console.warn(`[ASSRT] Detail fetch failed on ${domain}:`, err.message);
        AssrtProvider.markDomainUnhealthy(domain, 600);
        continue;
      }

      if (!detailResp.data || typeof detailResp.data !== 'object') {
        AssrtProvider.markDomainUnhealthy(domain, 300);
        continue;
      }

      const apiStatus = detailResp.data?.status;
      if (apiStatus === 30900 || detailResp.status === 429) {
        AssrtProvider.markRateLimited(60, 'ASSRT detail status 30900 quota limit');
        return null;
      }

      if (detailResp.status >= 500 || (apiStatus !== undefined && apiStatus >= 30000)) {
        AssrtProvider.markDomainUnhealthy(domain, 300);
        continue;
      }

      if (detailResp.status !== 200 || apiStatus !== 0) {
        return null;
      }

      const detailList = this.normalizeSubsList(detailResp.data?.sub?.subs);
      const detail: AssrtSubItem | undefined = detailList[0];
      if (!detail) return null;

      const detailTags = {
        lang: [] as string[],
        bilingual: Boolean(candidate.tags.bilingual || options?.siteBilingual)
      };
      if (detail.lang?.langlist?.langdou) {
        detailTags.bilingual = true;
      }
      parseLangAndBilingualFromText(
        [
          detail.lang?.desc || '',
          detail.native_name || '',
          this.cleanVideoName(detail.videoname),
          detail.filename || ''
        ].join(' '),
        detailTags
      );
      if (detailTags.bilingual) {
        candidate.tags.bilingual = true;
      }

      // Priority 1: Direct onthefly single-file download from filelist
      const detailFiles = this.normalizeFileList(detail.filelist);
      if (detailFiles.length > 0) {
        const validFiles = detailFiles.filter(
          (item) =>
            item?.url &&
            item?.f &&
            SUBTITLE_EXTENSIONS.some((ext) => item.f.toLowerCase().endsWith(ext))
        );

        const seasonFilteredNames = this.filterFilesBySeason(
          validFiles.map((v) => v.f),
          options?.season
        );

        if (seasonFilteredNames.length > 0) {
          const preferBi = options?.preferBilingual ?? true;
          const preferTrad = options?.preferTraditional ?? false;
          const preferAss = options?.preferAss ?? false;
          const hasExplicitBiInFiles = seasonFilteredNames.some((n) => BILINGUAL_REGEX.test(n.toLowerCase()));
          const needsContentVerify =
            detailTags.bilingual && preferBi && !hasExplicitBiInFiles && seasonFilteredNames.length > 1;

          const remainingNames = [...seasonFilteredNames];
          const fetchedBuffers: Record<string, Buffer> = {};
          const maxAttempts = needsContentVerify ? Math.min(remainingNames.length, 3) : 1;

          for (let attempt = 0; attempt < maxAttempts && remainingNames.length > 0; attempt++) {
            const pickedName = SubtitleExtractor.pickBestFile(
              remainingNames,
              options?.episode,
              preferBi,
              preferTrad,
              preferAss,
              detailTags.bilingual
            );

            const targetItem = pickedName
              ? validFiles.find((v) => v.f === pickedName)
              : options?.episode === undefined
                ? validFiles.find((v) => v.f === remainingNames[0])
                : undefined;

            if (!targetItem?.url) break;

            try {
              const fileResp = await this.client.get(targetItem.url, {
                responseType: 'arraybuffer',
                timeout: 20000,
                validateStatus: () => true
              });
              if (fileResp.status === 200 && fileResp.data) {
                const buf = Buffer.from(fileResp.data);
                const contentType = String(fileResp.headers?.['content-type'] || '');
                if (buf.length >= 30 && !this.isLikelyErrorPayload(buf, contentType)) {
                  if (!needsContentVerify) {
                    return { buffer: buf, filename: targetItem.f };
                  }

                  fetchedBuffers[targetItem.f] = buf;
                  const inspection = SubtitleExtractor.inspectSubtitleContent(buf);
                  if (inspection.isBilingualContent) {
                    return { buffer: buf, filename: targetItem.f };
                  }

                  // Remove non-bilingual candidate and try next candidate in filelist
                  const idx = remainingNames.indexOf(targetItem.f);
                  if (idx !== -1) remainingNames.splice(idx, 1);
                  continue;
                }
              }
            } catch (fileErr: any) {
              console.warn(`[ASSRT] On-the-fly file download failed for ${targetItem.f}:`, fileErr.message);
            }
            break;
          }

          // If none of the inspected filelist entries had bilingual dialogue, pick the best verified Chinese one among fetched or remaining
          if (Object.keys(fetchedBuffers).length > 0) {
            const allCandidateNames = seasonFilteredNames;
            const bestVerifiedName = SubtitleExtractor.pickBestFile(
              allCandidateNames,
              options?.episode,
              preferBi,
              preferTrad,
              preferAss,
              detailTags.bilingual,
              fetchedBuffers
            );
            if (bestVerifiedName) {
              if (fetchedBuffers[bestVerifiedName]) {
                return { buffer: fetchedBuffers[bestVerifiedName], filename: bestVerifiedName };
              }
              const fallbackItem = validFiles.find((v) => v.f === bestVerifiedName);
              if (fallbackItem?.url) {
                try {
                  const fileResp = await this.client.get(fallbackItem.url, {
                    responseType: 'arraybuffer',
                    timeout: 20000,
                    validateStatus: () => true
                  });
                  if (fileResp.status === 200 && fileResp.data) {
                    const buf = Buffer.from(fileResp.data);
                    const contentType = String(fileResp.headers?.['content-type'] || '');
                    if (buf.length >= 30 && !this.isLikelyErrorPayload(buf, contentType)) {
                      return { buffer: buf, filename: fallbackItem.f };
                    }
                  }
                } catch (fileErr: any) {
                  console.warn(`[ASSRT] Fallback file download failed for ${fallbackItem.f}:`, fileErr.message);
                }
              }
            }
          }
        }
      }

      // Priority 2: Fallback to full archive URL (isolated from API domain health)
      if (detail.url) {
        try {
          const archiveResp = await this.client.get(detail.url, {
            responseType: 'arraybuffer',
            timeout: 25000,
            validateStatus: () => true
          });
          if (archiveResp.status === 200 && archiveResp.data) {
            const buf = Buffer.from(archiveResp.data);
            const contentType = String(archiveResp.headers?.['content-type'] || '');
            if (buf.length >= 30 && !this.isLikelyErrorPayload(buf, contentType)) {
              const filename =
                detail.filename ||
                extractFilenameFromResponse(archiveResp.headers, detail.url, buf, `assrt_${candidate.id}.zip`);
              return { buffer: buf, filename };
            }
          }
        } catch (archiveErr: any) {
          console.warn(`[ASSRT] Archive download failed for ${candidate.id}:`, archiveErr.message);
        }
      }

      return null;
    }

    return null;
  }

  public static async checkQuota(token: string, proxy?: string): Promise<AssrtQuotaResult> {
    const cleanToken = (token || '').trim();
    if (!cleanToken) {
      return { success: false, message: 'ASSRT API Token is required' };
    }

    const provider = new AssrtProvider(proxy, cleanToken);
    const endpoints = provider.getEndpoints();

    for (const domain of endpoints) {
      try {
        const resp = await provider.client.get(`${domain}/v1/user/quota`, {
          params: { token: cleanToken },
          headers: { Authorization: `Bearer ${cleanToken}` },
          timeout: 8000,
          validateStatus: () => true
        });

        if (!resp.data || typeof resp.data !== 'object') {
          AssrtProvider.markDomainUnhealthy(domain, 300);
          continue;
        }

        const apiStatus = resp.data?.status;
        if (resp.status === 200 && apiStatus === 0 && resp.data?.user?.quota !== undefined) {
          return {
            success: true,
            quota: Number(resp.data.user.quota),
            status: 0,
            message: 'OK'
          };
        }

        if (resp.status >= 500 || (apiStatus !== undefined && apiStatus >= 30000 && apiStatus !== 30900)) {
          AssrtProvider.markDomainUnhealthy(domain, 300);
          continue;
        }

        const errorMap: Record<number, string> = {
          1: 'No such user',
          20000: 'Missing essential arguments',
          20001: 'Invalid ASSRT token',
          30900: 'Quota exceeded (20 req/min limit)'
        };
        const msg =
          (apiStatus !== undefined && errorMap[apiStatus]) ||
          resp.data?.errmsg ||
          `HTTP ${resp.status} (status: ${apiStatus ?? 'unknown'})`;
        return { success: false, status: apiStatus, message: msg };
      } catch (err: any) {
        console.warn(`[ASSRT] Quota check failed on ${domain}:`, err.message);
        AssrtProvider.markDomainUnhealthy(domain, 600);
      }
    }

    return { success: false, message: 'Unable to reach ASSRT API servers' };
  }
}
