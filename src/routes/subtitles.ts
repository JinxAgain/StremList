import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { cacheManager } from '../services/subtitles/cache/manager.js';
import { CinemetaClient } from '../services/subtitles/core/cinemeta.js';
import { SubtitleCleaner } from '../services/subtitles/core/cleaner.js';
import { SubtitleExtractor, SUBTITLE_EXTENSIONS } from '../services/subtitles/core/extractor.js';
import { SubtitleScorer } from '../services/subtitles/core/scorer.js';
import { extractMetaFromFilename, formatSubtitleInfo, extractSeasonAndBaseTitle } from '../services/subtitles/providers/base.js';
import { SubhdProvider } from '../services/subtitles/providers/subhd.js';
import { ZimukuProvider } from '../services/subtitles/providers/zimuku.js';
import { AssrtProvider } from '../services/subtitles/providers/assrt.js';
import { SubtitleCandidate, SubtitleItem, VideoQueryMeta } from '../services/subtitles/types.js';
import { loadConfig } from '../config.js';

const subhdProvider = new SubhdProvider();
const zimukuProvider = new ZimukuProvider();
const assrtProvider = new AssrtProvider();

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

async function withProviderTimeout<T>(
  task: Promise<T[]>,
  providerName: string,
  timeoutMs: number
): Promise<T[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T[]>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[Subtitles] Provider '${providerName}' timed out after ${timeoutMs}ms; continuing with available results.`
      );
      resolve([]);
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });

  try {
    return await Promise.race([
      task.catch((err: any) => {
        console.warn(`[Subtitles] Provider '${providerName}' search failed:`, err?.message || err);
        return [];
      }),
      timeoutPromise
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function sendSubtitleResponse(res: Response, bytes: Buffer, downloadName: string) {
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(downloadName)}"`);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(bytes);
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
      if (cleanId.startsWith('kitsu:')) {
        episode = parseInt(rest[0], 10) || undefined;
      } else {
        season = parseInt(rest[0], 10) || undefined;
      }
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

  const fnMeta = queryMeta.filename ? extractMetaFromFilename(queryMeta.filename) : null;
  if (fnMeta) {
    if (
      fnMeta.season !== null &&
      (queryMeta.season === undefined || (idStr.startsWith('kitsu:') && queryMeta.season === 1))
    ) {
      queryMeta.season = fnMeta.season;
    }
    if (queryMeta.episode === undefined && fnMeta.episode !== null) {
      queryMeta.episode = fnMeta.episode;
    }
  }

  // Pre-resolve media info if season is undefined for series (e.g. kitsu anime)
  let mediaTitle = '';
  let mediaYear: number | null = null;
  let resolvedImdbId: string | null = null;

  if (queryMeta.mediaType === 'series' && queryMeta.season === undefined) {
    const resolved = await CinemetaClient.resolveMediaInfo(
      queryMeta.mediaType,
      queryMeta.imdbId
    );
    mediaTitle = resolved.title;
    mediaYear = resolved.year;
    resolvedImdbId = resolved.resolvedImdb;

    if (mediaTitle) {
      const { season: inferredSeason, baseTitle } = extractSeasonAndBaseTitle(mediaTitle);
      if (inferredSeason !== undefined) {
        queryMeta.season = inferredSeason;
        queryMeta.baseTitle = baseTitle;
      }
    }
    if (queryMeta.season === undefined && idStr.startsWith('kitsu:')) {
      queryMeta.season = 1;
    }
  }

  const effectiveAssrtToken = (appConfig.assrtToken || process.env.ASSRT_TOKEN || '').trim();
  const hasAssrtToken = Boolean(effectiveAssrtToken);
  const assrtCacheTag =
    hasAssrtToken && (sourcePref === 'all' || sourcePref === 'no_subhd' || sourcePref === 'assrt')
      ? `:assrt_${crypto.createHash('sha256').update(effectiveAssrtToken).digest('hex').slice(0, 8)}`
      : '';
  const subhdWanted = sourcePref === 'all' || sourcePref === 'subhd';
  const subhdOff = subhdWanted && SubhdProvider.isRateLimited();
  const subhdCacheTag = subhdOff ? ':subhd_off' : '';

  // Invalidate any stale zero-season cache entry for this series if season is now known
  if (queryMeta.mediaType === 'series' && queryMeta.season !== undefined && queryMeta.season > 0) {
    const staleZeroKey = `${queryMeta.mediaType}:${queryMeta.imdbId}:0:${queryMeta.episode ?? 0}:${langPref}:${sourcePref}:${maxResults}${showOriginal ? ':orig' : ''}${keepOriginalFormat ? ':rawfmt' : ''}${assrtCacheTag}${subhdCacheTag}`;
    cacheManager.deleteSearchResult(staleZeroKey);
  }

  const cacheKey = `${queryMeta.mediaType}:${queryMeta.imdbId}:${queryMeta.season ?? 0}:${queryMeta.episode ?? 0}:${langPref}:${sourcePref}:${maxResults}${showOriginal ? ':orig' : ''}${keepOriginalFormat ? ':rawfmt' : ''}${assrtCacheTag}${subhdCacheTag}`;
  const configPrefix = configStr ? `/${encodeURIComponent(configStr)}` : '';
  const mapItemsWithBaseUrl = (items: SubtitleItem[]): SubtitleItem[] =>
    items.map((item) => {
      const effectivePath =
        configPrefix && !item.path.startsWith(`${configPrefix}/`)
          ? `${configPrefix}${item.path}`
          : item.path;
      return {
        ...item,
        path: effectivePath,
        url: `${baseUrl}${effectivePath}`
      };
    });

  // Check search cache
  const cached = cacheManager.getSearchResults(cacheKey);
  if (cached !== null) {
    return res.json({ subtitles: mapItemsWithBaseUrl(cached) });
  }

  // Single-flight lock per query key
  const unlock = await cacheManager.getFlightLock(cacheKey);
  try {
    // Re-check cache inside lock
    const rechecked = cacheManager.getSearchResults(cacheKey);
    if (rechecked !== null) {
      return res.json({ subtitles: mapItemsWithBaseUrl(rechecked) });
    }

    // Resolve media info via Cinemeta or TMDB (if not pre-resolved)
    if (!mediaTitle && !resolvedImdbId) {
      const resolved = await CinemetaClient.resolveMediaInfo(
        queryMeta.mediaType,
        queryMeta.imdbId
      );
      mediaTitle = resolved.title;
      mediaYear = resolved.year;
      resolvedImdbId = resolved.resolvedImdb;
    }

    if (resolvedImdbId && resolvedImdbId.startsWith('tt') && !queryMeta.imdbId.startsWith('tt')) {
      console.info(`[Subtitles] Resolved ${queryMeta.imdbId} -> ${resolvedImdbId}`);
      queryMeta.imdbId = resolvedImdbId;
    }

    let title = mediaTitle;
    let year = mediaYear;

    if (fnMeta) {
      if (!title && fnMeta.title) title = fnMeta.title;
      if (!year && fnMeta.year) year = fnMeta.year;
    }

    if (title && !queryMeta.baseTitle) {
      if (queryMeta.mediaType === 'series') {
        const { season: inferredSeason, baseTitle } = extractSeasonAndBaseTitle(title);
        if (queryMeta.season === undefined && inferredSeason !== undefined) {
          queryMeta.season = inferredSeason;
        }
        queryMeta.baseTitle = baseTitle;
      } else {
        queryMeta.baseTitle = title;
      }
    }

    queryMeta.title = title;
    queryMeta.year = year ?? undefined;

    console.info(
      `[Subtitles] Query: ${queryMeta.imdbId} ('${queryMeta.title}' ${queryMeta.year ?? ''}) S${queryMeta.season ?? 0}E${queryMeta.episode ?? 0}`
    );

    // Parallel search from providers with soft per-provider timeout
    const providerTimeoutMs = Number(process.env.SUBTITLE_PROVIDER_TIMEOUT_MS) || 5000;
    const tasks: Promise<SubtitleCandidate[]>[] = [];
    if (subhdWanted && !subhdOff) {
      tasks.push(withProviderTimeout(subhdProvider.search(queryMeta), 'subhd', providerTimeoutMs));
    }
    if (sourcePref === 'all' || sourcePref === 'no_subhd' || sourcePref === 'zimuku') {
      tasks.push(withProviderTimeout(zimukuProvider.search(queryMeta), 'zimuku', providerTimeoutMs));
    }
    if ((sourcePref === 'all' && hasAssrtToken) || sourcePref === 'no_subhd' || sourcePref === 'assrt') {
      tasks.push(
        withProviderTimeout(assrtProvider.search(queryMeta, appConfig.assrtToken), 'assrt', providerTimeoutMs)
      );
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
      const ext = format || (keepOriginalFormat ? 'ass' : 'srt');
      const rawParam = keepOriginalFormat ? '&raw=1' : '';
      const seasonParam = queryMeta.season !== undefined ? `&s=${queryMeta.season}` : '';
      const biParam = cand.tags.bilingual ? '&bi=1' : '';
      const encodedFilename = encodeURIComponent(filename);
      const relPath = `/subtitles/dl/${cand.provider}/${cand.id}/${epNum}/subtitle.${ext}?name=${encodedFilename}${rawParam}${seasonParam}${biParam}`;

      subtitles.push({
        id: `${cand.provider}_${cand.id}_${epNum}`,
        url: `${baseUrl}${configPrefix}${relPath}`,
        lang: 'chi',
        label,
        title: label,
        name: label,
        subtitleFileName: filename,
        movieReleaseName: label,
        SubFormat: ext,
        path: relPath
      });
    }

    const subhdBlockedDuringSearch = subhdWanted && !subhdOff && SubhdProvider.isRateLimited();
    if (subtitles.length > 0 && !subhdBlockedDuringSearch) {
      cacheManager.setSearchResults(cacheKey, subtitles);
    }

    return res.json({ subtitles: mapItemsWithBaseUrl(subtitles) });
  } finally {
    unlock();
  }
}

export async function handleDownloadSubtitle(req: Request, res: Response) {
  const provider = String(req.params.provider || '').toLowerCase();
  const subId = String(req.params.subId || '');
  const episodeNum = parseInt(req.params.episodeNum || '0', 10) || 0;
  const seasonNum = parseInt(String(req.query.s || ''), 10) || undefined;
  const filename = String(req.params.filename || '');
  const configStr = req.params.config ? String(req.params.config) : undefined;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');

  const appConfig = loadConfig(configStr);
  const keepOriginal =
    req.query.raw === '1' ||
    Boolean(appConfig.subtitleKeepOriginalFormat) ||
    /\.(ass|ssa|vtt)$/i.test(filename);
  const langPref = appConfig.subtitleLang || 'bilingual';

  const extMatch = filename.match(/\.(srt|ass|ssa|vtt)$/i);
  const reqExt = extMatch ? extMatch[1].toLowerCase() : 'srt';
  const seasonPart = provider === 'assrt' && seasonNum ? `_s${seasonNum}` : '';
  const cacheFilename = keepOriginal
    ? `${provider}_${subId}${seasonPart}_${episodeNum}_orig.${reqExt}`
    : `${provider}_${subId}${seasonPart}_${episodeNum}.srt`;

  const downloadName = (req.query.name as string) || filename;
  const siteBilingual =
    req.query.bi === '1' ||
    /\[双\]|\[Bilingual\./i.test(downloadName);

  // 1. Fast path: disk cache hit
  if (cacheManager.hasSubtitle(cacheFilename)) {
    const cachedBytes = cacheManager.getSubtitle(cacheFilename);
    if (cachedBytes) {
      return sendSubtitleResponse(res, cachedBytes, downloadName);
    }
  }

  const failKey = `${provider}:${subId}:${seasonNum ?? 0}:${episodeNum}`;
  if (cacheManager.isDownloadFailed(failKey)) {
    return res.status(404).send('Upstream subtitle download recently failed');
  }
  if (provider === 'subhd' && SubhdProvider.isRateLimited()) {
    return res.status(404).send('SubHD temporarily rate-limited or verification required');
  }

  // 2. Slow path: single-flight fetch from upstream
  const unlock = await cacheManager.getFlightLock(`dl:${cacheFilename}`);
  try {
    // Re-check disk cache and negative cache inside lock
    if (cacheManager.hasSubtitle(cacheFilename)) {
      const cachedBytes = cacheManager.getSubtitle(cacheFilename);
      if (cachedBytes) {
        return sendSubtitleResponse(res, cachedBytes, downloadName);
      }
    }
    if (cacheManager.isDownloadFailed(failKey)) {
      return res.status(404).send('Upstream subtitle download recently failed');
    }
    if (provider === 'subhd' && SubhdProvider.isRateLimited()) {
      return res.status(404).send('SubHD temporarily rate-limited or verification required');
    }

    console.info(`[Download] Cache MISS: '${cacheFilename}'. Fetching from upstream ${provider}...`);
    let downloaded: { buffer: Buffer; filename: string } | null = null;

    const candidate: SubtitleCandidate = {
      id: subId,
      provider: provider as 'subhd' | 'zimuku' | 'assrt',
      title: '',
      pageUrl:
        provider === 'subhd'
          ? `https://subhd.tv/a/${subId}`
          : provider === 'assrt'
            ? `https://assrt.net/xml/sub/${subId.slice(0, -3) || '0'}/${subId}.xml`
            : `https://zmk.pw/detail/${subId}.html`,
      tags: { provider, lang: [], bilingual: siteBilingual, fmt: [], source: [], collection: false, imdbMatched: false },
      rate: 0,
      downloadsCount: 0,
      score: 0
    };

    if (provider === 'subhd') {
      downloaded = await subhdProvider.download(candidate);
    } else if (provider === 'zimuku') {
      downloaded = await zimukuProvider.download(candidate);
    } else if (provider === 'assrt') {
      downloaded = await assrtProvider.download(candidate, {
        episode: episodeNum > 0 ? episodeNum : undefined,
        season: seasonNum,
        token: appConfig.assrtToken,
        preferBilingual: langPref === 'bilingual',
        preferTraditional: langPref === 'cht',
        preferAss: keepOriginal,
        siteBilingual
      });
    } else {
      return res.status(400).send('Unknown subtitle provider');
    }

    if (!downloaded || !downloaded.buffer) {
      cacheManager.markDownloadFailed(failKey, 1800);
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
        preferAss,
        Boolean(candidate.tags.bilingual)
      );
      if (!extracted) {
        cacheManager.markDownloadFailed(failKey, 1800);
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
        cacheManager.markDownloadFailed(failKey, 1800);
        return res.status(502).send('Subtitle normalization resulted in invalid original subtitle format');
      }
    } else {
      outputBuffer = SubtitleCleaner.normalizeToUtf8Srt(subBytes, subName);
      if (!SubtitleCleaner.isValidSubtitleContent(outputBuffer.toString('utf-8'))) {
        cacheManager.markDownloadFailed(failKey, 1800);
        return res.status(502).send('Subtitle normalization resulted in invalid SRT format');
      }
    }

    // 5. Save to disk cache
    cacheManager.saveSubtitle(cacheFilename, outputBuffer);
    cacheManager.clearDownloadFailed(failKey);

    // 6. Stream to player
    return sendSubtitleResponse(res, outputBuffer, downloadName);
  } finally {
    unlock();
  }
}

// OPTIONS pre-flight
subtitlesRouter.options('/subtitles/dl/:provider/:subId/:episodeNum/:filename(*)?', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  return res.status(204).end();
});

subtitlesRouter.options('/:config/subtitles/dl/:provider/:subId/:episodeNum/:filename(*)?', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  return res.status(204).end();
});

// Download endpoints (standard and configured)
subtitlesRouter.get('/subtitles/dl/:provider/:subId/:episodeNum/:filename(*)?', handleDownloadSubtitle);
subtitlesRouter.get('/:config/subtitles/dl/:provider/:subId/:episodeNum/:filename(*)?', handleDownloadSubtitle);

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

