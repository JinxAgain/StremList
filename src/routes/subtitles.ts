import { Request, Response, Router } from 'express';
import { cacheManager } from '../services/subtitles/cache/manager.js';
import { CinemetaClient } from '../services/subtitles/core/cinemeta.js';
import { SubtitleCleaner } from '../services/subtitles/core/cleaner.js';
import { SubtitleExtractor, SUBTITLE_EXTENSIONS } from '../services/subtitles/core/extractor.js';
import { SubtitleScorer } from '../services/subtitles/core/scorer.js';
import { extractMetaFromFilename, formatSubtitleInfo } from '../services/subtitles/providers/base.js';
import { SubhdProvider } from '../services/subtitles/providers/subhd.js';
import { ZimukuProvider } from '../services/subtitles/providers/zimuku.js';
import { SubtitleCandidate, SubtitleItem, VideoQueryMeta } from '../services/subtitles/types.js';
import { loadConfig } from '../config.js';

const subhdProvider = new SubhdProvider();
const zimukuProvider = new ZimukuProvider();

export const subtitlesRouter = Router();

function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str.replace(/%20/g, ' ');
  }
}

function getPublicBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || `127.0.0.1:7000`;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function parseMediaId(mediaType: string, idStr: string, extra = ''): VideoQueryMeta {
  const cleanId = safeDecodeURIComponent(idStr.replace(/\.json$/i, '')).trim();
  let season: number | undefined;
  let episode: number | undefined;
  let imdbId = cleanId;

  if (cleanId.startsWith('tmdb:') || cleanId.startsWith('kitsu:')) {
    const tokens = cleanId.split(':');
    const prefix = tokens[0];
    let rest: string[] = [];

    if (tokens.length > 2 && (tokens[1] === 'movie' || tokens[1] === 'tv')) {
      imdbId = `${prefix}:${tokens[1]}:${tokens[2]}`;
      rest = tokens.slice(3);
    } else if (tokens.length > 1) {
      imdbId = `${prefix}:${tokens[1]}`;
      rest = tokens.slice(2);
    } else {
      imdbId = cleanId;
    }

    if (rest.length >= 2) {
      season = parseInt(rest[0], 10) || undefined;
      episode = parseInt(rest[1], 10) || undefined;
    } else if (rest.length === 1) {
      season = parseInt(rest[0], 10) || undefined;
    }
  } else {
    const parts = cleanId.split(':');
    imdbId = parts[0];
    if (parts.length >= 3) {
      season = parseInt(parts[1], 10) || undefined;
      episode = parseInt(parts[2], 10) || undefined;
    } else if (parts.length === 2) {
      season = parseInt(parts[1], 10) || undefined;
    }
  }

  let filename = '';
  if (extra) {
    const unquotedExtra = safeDecodeURIComponent(extra.replace(/\.json$/i, ''));
    const m = unquotedExtra.match(/filename=([^&]+)/);
    if (m) {
      filename = m[1].trim();
    }
  }

  return {
    imdbId,
    mediaType: mediaType === 'series' ? 'series' : 'movie',
    season,
    episode,
    filename
  };
}

export async function handleSubtitlesRequest(
  req: Request,
  res: Response,
  mediaType: string,
  idStr: string,
  extra = '',
  configStr = ''
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');

  if (mediaType !== 'movie' && mediaType !== 'series') {
    return res.status(404).json({ error: `Invalid media type: ${mediaType}` });
  }

  const appConfig = loadConfig(configStr);
  const langPref = appConfig.subtitleLang || 'bilingual';
  const sourcePref = appConfig.subtitleSource || 'all';
  const maxResults = appConfig.subtitleMaxResults || 8;
  const showOriginal = Boolean(appConfig.subtitleShowOriginal);
  const keepOriginalFormat = Boolean(appConfig.subtitleKeepOriginalFormat);

  const queryMeta = parseMediaId(mediaType, idStr, extra);
  const baseUrl = getPublicBaseUrl(req);

  const cacheKey = `${queryMeta.mediaType}:${queryMeta.imdbId}:${queryMeta.season ?? 0}:${queryMeta.episode ?? 0}:${langPref}:${sourcePref}:${maxResults}${showOriginal ? ':orig' : ''}${keepOriginalFormat ? ':rawfmt' : ''}`;

  // Check search cache
  const cached = cacheManager.getSearchResults(cacheKey);
  if (cached !== null) {
    const mapped = cached.map((item) => ({
      ...item,
      url: `${baseUrl}${item.path}`
    }));
    return res.json({ subtitles: mapped });
  }

  // Single-flight lock per query key
  const unlock = await cacheManager.getFlightLock(cacheKey);
  try {
    // Re-check cache inside lock
    const rechecked = cacheManager.getSearchResults(cacheKey);
    if (rechecked !== null) {
      const mapped = rechecked.map((item) => ({
        ...item,
        url: `${baseUrl}${item.path}`
      }));
      return res.json({ subtitles: mapped });
    }

    // Resolve media info via Cinemeta or TMDB
    let { title, year, resolvedImdb } = await CinemetaClient.resolveMediaInfo(
      queryMeta.mediaType,
      queryMeta.imdbId
    );

    if (resolvedImdb && resolvedImdb.startsWith('tt') && !queryMeta.imdbId.startsWith('tt')) {
      console.info(`[Subtitles] Resolved ${queryMeta.imdbId} -> ${resolvedImdb}`);
      queryMeta.imdbId = resolvedImdb;
    }

    if (!title && queryMeta.filename) {
      const fnMeta = extractMetaFromFilename(queryMeta.filename);
      if (fnMeta.title) title = fnMeta.title;
      if (!year && fnMeta.year) year = fnMeta.year;
      if (queryMeta.season === undefined && fnMeta.season !== null) queryMeta.season = fnMeta.season;
      if (queryMeta.episode === undefined && fnMeta.episode !== null) queryMeta.episode = fnMeta.episode;
    }

    queryMeta.title = title;
    queryMeta.year = year ?? undefined;

    console.info(
      `[Subtitles] Query: ${queryMeta.imdbId} ('${queryMeta.title}' ${queryMeta.year ?? ''}) S${queryMeta.season ?? 0}E${queryMeta.episode ?? 0}`
    );

    // Parallel search from providers
    const tasks: Promise<SubtitleCandidate[]>[] = [];
    if (sourcePref === 'all' || sourcePref === 'subhd') {
      tasks.push(subhdProvider.search(queryMeta));
    }
    if (sourcePref === 'all' || sourcePref === 'zimuku') {
      tasks.push(zimukuProvider.search(queryMeta));
    }

    const settled = await Promise.allSettled(tasks);
    const candidates: SubtitleCandidate[] = [];

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        candidates.push(...r.value);
      } else {
        console.warn(`[Subtitles] Provider search failed:`, r.reason);
      }
    }

    // Rank candidates
    const ranked = SubtitleScorer.rankCandidates(candidates, queryMeta, langPref, maxResults);
    console.info(`[Subtitles] Returning top ${ranked.length} subtitles for ${queryMeta.imdbId}`);

    const subtitles: SubtitleItem[] = [];
    for (const cand of ranked) {
      const epNum = queryMeta.episode ?? 0;
      const { label, filename, format } = formatSubtitleInfo(cand, queryMeta, {
        langPref,
        showOriginal,
        keepOriginalFormat
      });
      const rawQuery = keepOriginalFormat ? '?raw=1' : '';
      const encodedFilename = encodeURIComponent(filename);
      const relPath = `/subtitles/dl/${cand.provider}/${cand.id}/${epNum}/${encodedFilename}${rawQuery}`;

      subtitles.push({
        id: `${cand.provider}_${cand.id}_${epNum}`,
        url: `${baseUrl}${relPath}`,
        lang: 'chi',
        label,
        title: label,
        name: label,
        subtitleFileName: filename,
        movieReleaseName: label,
        SubFormat: format || (keepOriginalFormat ? 'ass' : 'srt'),
        path: relPath
      });
    }

    if (subtitles.length > 0) {
      cacheManager.setSearchResults(cacheKey, subtitles);
    }

    return res.json({ subtitles });
  } finally {
    unlock();
  }
}

export async function handleDownloadSubtitle(req: Request, res: Response) {
  const provider = String(req.params.provider || '').toLowerCase();
  const subId = String(req.params.subId || '');
  const episodeNum = parseInt(req.params.episodeNum || '0', 10) || 0;
  const filename = String(req.params.filename || '');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');

  const appConfig = loadConfig();
  const keepOriginal =
    req.query.raw === '1' ||
    Boolean(appConfig.subtitleKeepOriginalFormat) ||
    /\.(ass|ssa|vtt)$/i.test(filename);
  const langPref = appConfig.subtitleLang || 'bilingual';

  const extMatch = filename.match(/\.(srt|ass|ssa|vtt)$/i);
  const reqExt = extMatch ? extMatch[1].toLowerCase() : 'srt';
  const cacheFilename = keepOriginal
    ? `${provider}_${subId}_${episodeNum}_orig.${reqExt}`
    : `${provider}_${subId}_${episodeNum}.srt`;

  // 1. Fast path: disk cache hit
  if (cacheManager.hasSubtitle(cacheFilename)) {
    const cachedBytes = cacheManager.getSubtitle(cacheFilename);
    if (cachedBytes) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cachedBytes);
    }
  }

  // 2. Slow path: fetch from upstream
  console.info(`[Download] Cache MISS: '${cacheFilename}'. Fetching from upstream ${provider}...`);
  let downloaded: { buffer: Buffer; filename: string } | null = null;

  const candidate: SubtitleCandidate = {
    id: subId,
    provider: provider as 'subhd' | 'zimuku',
    title: '',
    pageUrl: provider === 'subhd' ? `https://subhd.tv/a/${subId}` : `https://zmk.pw/detail/${subId}.html`,
    tags: { provider, lang: [], bilingual: false, fmt: [], source: [], collection: false, imdbMatched: false },
    rate: 0,
    downloadsCount: 0,
    score: 0
  };

  if (provider === 'subhd') {
    downloaded = await subhdProvider.download(candidate);
  } else if (provider === 'zimuku') {
    downloaded = await zimukuProvider.download(candidate);
  } else {
    return res.status(400).send('Unknown subtitle provider');
  }

  if (!downloaded || !downloaded.buffer) {
    return res.status(404).send('Upstream subtitle download failed');
  }

  const { buffer: archiveBytes, filename: rawFilename } = downloaded;
  const targetEp = episodeNum > 0 ? episodeNum : undefined;

  let subBytes: Buffer | null = null;
  let subName = rawFilename;

  const preferBilingual = langPref === 'bilingual';
  const preferTraditional = langPref === 'cht';
  const preferAss = keepOriginal;

  // 3. Direct subtitle vs archive unpack
  if (
    SUBTITLE_EXTENSIONS.some((ext) => rawFilename.toLowerCase().endsWith(ext)) ||
    SubtitleExtractor.isRawSubtitleBuffer(archiveBytes)
  ) {
    subBytes = archiveBytes;
  } else {
    const extracted = SubtitleExtractor.extractBestSubtitle(
      archiveBytes,
      rawFilename,
      targetEp,
      preferBilingual,
      preferTraditional,
      preferAss
    );
    if (!extracted) {
      return res.status(502).send('Failed to extract subtitle from archive');
    }
    subBytes = extracted.buffer;
    subName = extracted.filename;
  }

  // 4. Normalize
  let outputBuffer: Buffer;
  if (keepOriginal) {
    const orig = SubtitleCleaner.normalizeToUtf8Original(subBytes, subName);
    outputBuffer = orig.buffer;
    if (!SubtitleCleaner.isValidSubtitleContent(outputBuffer.toString('utf-8'))) {
      return res.status(502).send('Subtitle normalization resulted in invalid original subtitle format');
    }
  } else {
    outputBuffer = SubtitleCleaner.normalizeToUtf8Srt(subBytes, subName);
    if (!SubtitleCleaner.isValidSubtitleContent(outputBuffer.toString('utf-8'))) {
      return res.status(502).send('Subtitle normalization resulted in invalid SRT format');
    }
  }

  // 5. Save to disk cache
  cacheManager.saveSubtitle(cacheFilename, outputBuffer);

  // 6. Stream to player
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(outputBuffer);
}

// OPTIONS pre-flight
subtitlesRouter.options('/subtitles/dl/:provider/:subId/:episodeNum/:filename(*)?', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  return res.status(204).end();
});

// Download endpoint
subtitlesRouter.get('/subtitles/dl/:provider/:subId/:episodeNum/:filename(*)?', handleDownloadSubtitle);

// Subtitle query endpoints (standard and configured)
subtitlesRouter.get('/subtitles/:mediaType/:idStr.json', (req, res) => {
  return handleSubtitlesRequest(req, res, req.params.mediaType, req.params.idStr);
});

subtitlesRouter.get('/subtitles/:mediaType/:idStr/:extra(*)?', (req, res) => {
  return handleSubtitlesRequest(req, res, req.params.mediaType, req.params.idStr, req.params.extra || '');
});

subtitlesRouter.get('/:config/subtitles/:mediaType/:idStr.json', (req, res) => {
  return handleSubtitlesRequest(req, res, req.params.mediaType, req.params.idStr, '', req.params.config);
});

subtitlesRouter.get('/:config/subtitles/:mediaType/:idStr/:extra(*)?', (req, res) => {
  return handleSubtitlesRequest(req, res, req.params.mediaType, req.params.idStr, req.params.extra || '', req.params.config);
});

