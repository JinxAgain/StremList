import * as cheerio from 'cheerio';
import {
  BaseProvider,
  isEpisodeMatch,
  extractMetaFromFilename,
  extractFilenameFromResponse,
  SOURCE_BADGE_MAP,
  parseSourceTagsFromText,
  hasChineseSubtitle,
  extractSeasonsFromText
} from './base.js';
import { SubtitleCandidate, SubtitleTags, VideoQueryMeta, SubhdSubjectItem } from '../types.js';

export interface ResolvedSubhdWork {
  dId: string;
  exactSeason: boolean;
  imdbMatched: boolean;
}

export class SubhdProvider extends BaseProvider {
  public readonly name = 'subhd';

  private static rateLimitedUntil = 0;
  private static unhealthyDomains = new Map<string, number>();

  private readonly baseUrl: string;
  private readonly fallbackUrls: string[];

  constructor(proxy?: string) {
    super(proxy);
    this.baseUrl = (process.env.SUBHD_BASE_URL || 'https://subhd.tv').replace(/\/+$/, '');
    const fallbacksEnv = process.env.SUBHD_FALLBACKS || 'https://subhd.me,https://subhd.one,https://subhd.cc';
    this.fallbackUrls = fallbacksEnv.split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean);
  }

  public static isRateLimited(): boolean {
    return Date.now() / 1000 < this.rateLimitedUntil;
  }

  public static markRateLimited(durationSeconds = 600, reason = 'Rate limited'): void {
    this.rateLimitedUntil = Date.now() / 1000 + durationSeconds;
    console.warn(`[SubHD] IP rate limit detected (${reason}). Cooling down for ${durationSeconds}s.`);
  }

  public static isDomainHealthy(domain: string): boolean {
    const until = this.unhealthyDomains.get(domain) || 0;
    return Date.now() / 1000 > until;
  }

  public static markDomainUnhealthy(domain: string, cooldownSecs = 600): void {
    this.unhealthyDomains.set(domain, Date.now() / 1000 + cooldownSecs);
    console.warn(`[SubHD] Marking mirror ${domain} as unhealthy for ${cooldownSecs}s`);
  }

  public async search(meta: VideoQueryMeta): Promise<SubtitleCandidate[]> {
    if (SubhdProvider.isRateLimited()) return [];

    const endpoints = [this.baseUrl, ...this.fallbackUrls].filter((d, i, self) =>
      self.indexOf(d) === i && SubhdProvider.isDomainHealthy(d)
    );
    if (endpoints.length === 0) endpoints.push(this.baseUrl);

    const candidates: SubtitleCandidate[] = [];
    const seenSids = new Set<string>();

    let cleanTitle = (meta.title || '').trim();
    if (!cleanTitle && meta.filename) {
      const parsed = extractMetaFromFilename(meta.filename);
      if (parsed.title) cleanTitle = parsed.title;
      if (!meta.year && parsed.year) meta.year = parsed.year;
    }

    const isTtImdb = Boolean(meta.imdbId && meta.imdbId.startsWith('tt'));

    for (const domain of endpoints) {
      // Stage 1: /searchD/ subject lookup
      const subjectQueries: string[] = [];
      if (isTtImdb) subjectQueries.push(meta.imdbId);
      if (cleanTitle) subjectQueries.push(cleanTitle);

      for (const q of subjectQueries) {
        const isImdb = q.startsWith('tt');
        const url = `${domain}/searchD/${encodeURIComponent(q)}`;
        try {
          const resp = await this.client.get(url, { timeout: 6000, validateStatus: () => true });
          if (resp.status === 200 && resp.data) {
            const items = this.parseItemsFromSearchD(resp.data);
            const resolved = this.matchSubjectItem(items, meta, isImdb);
            if (resolved) {
              const detailCandidates = await this.fetchAndParseDetail(domain, resolved, meta);
              for (const c of detailCandidates) {
                if (!seenSids.has(c.id)) {
                  seenSids.add(c.id);
                  candidates.push(c);
                }
              }
              if (candidates.length > 0) {
                return candidates;
              }
            }
          } else if (resp.status === 403) {
            SubhdProvider.markRateLimited(600, 'HTTP 403 on searchD');
          }
        } catch (err: any) {
          console.warn(`[SubHD] searchD failed for ${url}:`, err.message);
          if (domain !== this.baseUrl) SubhdProvider.markDomainUnhealthy(domain, 600);
        }
      }

      // Stage 2: /search/ fallback
      const queries = this.buildQueries(meta);
      const fetchedDids = new Set<string>();
      let foundAny = false;

      for (const q of queries) {
        const isImdb = q.startsWith('tt');
        const searchUrl = `${domain}/search/${encodeURIComponent(q)}`;
        let newFound = 0;

        try {
          const resp = await this.client.get(searchUrl, { timeout: 6000, validateStatus: () => true });
          if (resp.status === 200 && typeof resp.data === 'string') {
            const resolved = this.extractWorkIdFromSearchHtml(resp.data, meta, isImdb);
            if (resolved && !fetchedDids.has(resolved.dId)) {
              fetchedDids.add(resolved.dId);
              const detailCandidates = await this.fetchAndParseDetail(domain, resolved, meta);
              for (const item of detailCandidates) {
                if (!seenSids.has(item.id)) {
                  seenSids.add(item.id);
                  candidates.push(item);
                  newFound++;
                }
              }
              if (detailCandidates.length > 0) foundAny = true;
            }

            if (newFound === 0) {
              const items = this.parseSearchResults(resp.data, domain, meta);
              for (const item of items) {
                if (isImdb) item.tags.imdbMatched = true;
                if (!seenSids.has(item.id)) {
                  seenSids.add(item.id);
                  candidates.push(item);
                  newFound++;
                }
              }
              if (items.length > 0) foundAny = true;
            }
          } else if (resp.status === 403) {
            SubhdProvider.markRateLimited(600, 'HTTP 403 on search');
          }
        } catch (err: any) {
          console.warn(`[SubHD] Search failed for ${searchUrl}:`, err.message);
          if (domain !== this.baseUrl) SubhdProvider.markDomainUnhealthy(domain, 600);
        }

        if (isImdb && newFound > 0) break;
        if (foundAny && candidates.length >= 5) break;
      }

      if (candidates.length > 0) break;
    }

    return candidates;
  }

  private async fetchAndParseDetail(
    domain: string,
    resolved: ResolvedSubhdWork,
    meta: VideoQueryMeta
  ): Promise<SubtitleCandidate[]> {
    const isTv = meta.mediaType === 'series' || meta.season !== undefined;
    const targetSeason = meta.season ?? 1;
    let currentDid = resolved.dId;

    try {
      let detailUrl = `${domain}/d/${currentDid}`;
      let resp = await this.client.get(detailUrl, { timeout: 6000, validateStatus: () => true });

      if (resp.status === 403) {
        SubhdProvider.markRateLimited(600, 'HTTP 403 on /d/');
        return [];
      }

      if (resp.status !== 200 || typeof resp.data !== 'string') {
        return [];
      }

      let html = resp.data;

      if (isTv) {
        const h1Text = cheerio.load(html)('h1.view-text, h1').first().text().trim();
        const h1Seasons = extractSeasonsFromText(h1Text);
        const seasonMismatch = h1Seasons.size > 0 && !h1Seasons.has(targetSeason);

        if (!resolved.exactSeason || seasonMismatch) {
          const relatedDid = this.findRelatedSeasonWorkId(html, targetSeason);
          if (relatedDid && relatedDid !== currentDid) {
            currentDid = relatedDid;
            detailUrl = `${domain}/d/${currentDid}`;
            const hopResp = await this.client.get(detailUrl, { timeout: 6000, validateStatus: () => true });
            if (hopResp.status === 200 && typeof hopResp.data === 'string') {
              html = hopResp.data;
            }
          }
        }
      }

      return this.parseDetailPage(html, domain, meta, resolved.imdbMatched);
    } catch (err: any) {
      console.warn(`[SubHD] Detail fetch failed for /d/${currentDid}:`, err.message);
      return [];
    }
  }

  private buildQueries(meta: VideoQueryMeta): string[] {
    const queries: string[] = [];
    let cleanTitle = (meta.title || '').trim();
    if (!cleanTitle && meta.filename) {
      const parsed = extractMetaFromFilename(meta.filename);
      if (parsed.title) cleanTitle = parsed.title;
      if (!meta.year && parsed.year) meta.year = parsed.year;
    }

    const isTtImdb = Boolean(meta.imdbId && meta.imdbId.startsWith('tt'));

    if (meta.mediaType === 'series' || meta.season !== undefined) {
      const s = String(meta.season ?? 1).padStart(2, '0');
      const ep = meta.episode !== undefined ? String(meta.episode).padStart(2, '0') : null;

      if (isTtImdb && ep) queries.push(`${meta.imdbId} S${s}E${ep}`);
      if (isTtImdb) {
        queries.push(`${meta.imdbId} S${s}`);
        queries.push(meta.imdbId);
      }
      if (cleanTitle) {
        if (ep) queries.push(`${cleanTitle} S${s}E${ep}`);
        queries.push(`${cleanTitle} S${s}`);
        queries.push(cleanTitle);
      }
    } else {
      if (isTtImdb) queries.push(meta.imdbId);
      if (cleanTitle) {
        if (meta.year) queries.push(`${cleanTitle} ${meta.year}`);
        queries.push(cleanTitle);
      }
    }

    return Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean)));
  }

  public parseItemsFromSearchD(data: any): SubhdSubjectItem[] {
    if (!data) return [];
    if (Array.isArray(data?.items) && data.items.length > 0) {
      return data.items.map((it: any) => ({
        id: String(it.id),
        title: String(it.title || ''),
        title2: it.title2 ? String(it.title2) : undefined,
        year: it.year ? String(it.year) : undefined,
        type: it.type ? String(it.type) : undefined,
        rating: it.rating ? String(it.rating) : undefined,
        poster: it.poster ? String(it.poster) : undefined
      }));
    }
    if (typeof data?.text === 'string' && data.text.length > 0) {
      const $ = cheerio.load(data.text);
      const items: SubhdSubjectItem[] = [];
      $('a[href*="/d/"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const m = href.match(/(?:^|\/)d\/([0-9A-Za-z]+)/);
        if (m) {
          items.push({
            id: m[1],
            title: $(a).text().trim()
          });
        }
      });
      return items;
    }
    return [];
  }

  public matchSubjectItem(
    items: SubhdSubjectItem[],
    meta: VideoQueryMeta,
    isImdbQuery: boolean
  ): ResolvedSubhdWork | null {
    if (!items || items.length === 0) return null;

    const normalizeTitle = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();

    let pool = [...items];

    if (!isImdbQuery) {
      const cleanTitle = (meta.title || '').trim();
      if (cleanTitle) {
        const normClean = normalizeTitle(cleanTitle);
        if (normClean) {
          pool = pool.filter((item) => {
            const normTitle = normalizeTitle(item.title || '');
            const normTitle2 = normalizeTitle(item.title2 || '');
            return (
              normTitle === normClean ||
              normTitle2 === normClean ||
              normTitle.startsWith(normClean) ||
              normTitle2.startsWith(normClean) ||
              (normClean.length >= 3 && (normTitle.includes(normClean) || normTitle2.includes(normClean)))
            );
          });
        }
      }
    }

    if (pool.length === 0) return null;

    const isTv = meta.mediaType === 'series' || meta.season !== undefined;

    if (isTv) {
      const targetSeason = meta.season ?? 1;
      const tvItems = pool.filter((it) => !it.type || it.type === 'TVSeries');
      const searchPool = tvItems.length > 0 ? tvItems : pool;

      // Pass 1: exact season match
      for (const item of searchPool) {
        const fullText = `${item.title || ''} ${item.title2 || ''}`;
        const seasons = extractSeasonsFromText(fullText);
        if (seasons.has(targetSeason)) {
          return { dId: String(item.id), exactSeason: true, imdbMatched: isImdbQuery };
        }
      }

      // Pass 2: if targetSeason === 1, find item where extractSeasonsFromText has size === 0
      if (targetSeason === 1) {
        for (const item of searchPool) {
          const fullText = `${item.title || ''} ${item.title2 || ''}`;
          const seasons = extractSeasonsFromText(fullText);
          if (seasons.size === 0) {
            return { dId: String(item.id), exactSeason: true, imdbMatched: isImdbQuery };
          }
        }
      }

      // Pass 3: if isImdbQuery && pool.length > 0, return first item with exactSeason: false
      if (isImdbQuery && searchPool.length > 0) {
        return { dId: String(searchPool[0].id), exactSeason: false, imdbMatched: true };
      }
    } else {
      // Movie
      const movieItems = pool.filter((it) => !it.type || it.type === 'Movie');
      const searchPool = movieItems.length > 0 ? movieItems : pool;

      let best = searchPool[0];
      if (meta.year) {
        const yearMatch = searchPool.find((it) => it.year && Math.abs(parseInt(it.year, 10) - meta.year!) <= 1);
        if (yearMatch) best = yearMatch;
      }
      return { dId: String(best.id), exactSeason: true, imdbMatched: isImdbQuery };
    }

    return null;
  }

  public findRelatedSeasonWorkId(html: string, targetSeason: number): string | null {
    if (!html) return null;
    const $ = cheerio.load(html);
    const links = $('div.col-lg-3 a[href*="/d/"], div.bg-white.shadow-sm.rounded-3.mb-3 a[href*="/d/"]').toArray();
    for (const el of links) {
      const $a = $(el);
      const href = $a.attr('href') || '';
      const m = href.match(/(?:^|\/)d\/([0-9A-Za-z]+)/);
      if (!m) continue;
      const text = `${$a.text()} ${$a.find('img').attr('alt') || ''} ${$a.attr('title') || ''}`.trim();
      const seasons = extractSeasonsFromText(text);
      if (seasons.has(targetSeason)) {
        return m[1];
      }
      if (targetSeason === 1 && seasons.size === 0 && text.length > 0) {
        return m[1];
      }
    }
    return null;
  }

  public extractWorkIdFromSearchHtml(
    html: string,
    meta: VideoQueryMeta,
    isImdbQuery = false
  ): ResolvedSubhdWork | null {
    if (!html) return null;
    const $ = cheerio.load(html);
    const cards = $('div.bg-white.shadow-sm.rounded-3.mb-4').toArray();
    const isTv = meta.mediaType === 'series' || meta.season !== undefined;
    const targetSeason = meta.season ?? 1;

    for (const card of cards) {
      const $c = $(card);
      let dId: string | null = null;
      let dTitle = '';

      $c.find('a[href*="/d/"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const m = href.match(/(?:^|\/)d\/([0-9A-Za-z]+)/);
        if (m) {
          dId = m[1];
          const imgAlt = $(a).find('img').attr('alt') || '';
          const aText = $(a).text().trim();
          dTitle = `${imgAlt} ${aText}`.trim();
          return false;
        }
      });

      if (!dId) continue;

      const f16Text = $c.find('div.f16').text().trim();
      const combinedTitle = `${dTitle} ${f16Text}`.trim();

      if (isTv) {
        const seasons = extractSeasonsFromText(combinedTitle);
        if (seasons.has(targetSeason) || (targetSeason === 1 && seasons.size === 0)) {
          return { dId, exactSeason: true, imdbMatched: isImdbQuery };
        }
      } else {
        // Movie
        return { dId, exactSeason: true, imdbMatched: isImdbQuery };
      }
    }

    return null;
  }

  public parseDetailPage(
    html: string,
    domain: string,
    meta: VideoQueryMeta,
    imdbMatched = false
  ): SubtitleCandidate[] {
    if (!html) return [];
    const $ = cheerio.load(html);
    const isTv = meta.mediaType === 'series' || meta.season !== undefined;

    const isImdbMatched = imdbMatched || Boolean(meta.imdbId && meta.imdbId.startsWith('tt') && html.includes(meta.imdbId));

    if (isTv && meta.season !== undefined) {
      const h1Text = $('h1.view-text, h1').first().text().trim();
      const h1Seasons = extractSeasonsFromText(h1Text);
      if (h1Seasons.size > 0 && !h1Seasons.has(meta.season)) {
        return [];
      }
    }

    const container = $('div.bg-white.shadow-sm.rounded-3.mb-5')
      .filter((_, el) => $(el).find('a[href*="/a/"]').length > 0)
      .first();

    if (container.length === 0) {
      return this.parseSearchResults(html, domain, meta);
    }

    const hasSectionHeaders = container.children('div.px-3.py-1').length > 0;
    const items: SubtitleCandidate[] = [];
    const seenSids = new Set<string>();

    let currentSection: { type: 'none' | 'episode' | 'collection' | 'other'; episode?: number } = { type: 'none' };

    for (const child of container.children().toArray()) {
      const $el = $(child);

      if ($el.is('div') && $el.hasClass('px-3') && $el.hasClass('py-1')) {
        const secText = $el.text().trim();
        const epMatch = secText.match(/第\s*(\d+)\s*[集话話期]/) || secText.match(/^[Ee][Pp]?\s*(\d+)$/);
        if (epMatch) {
          currentSection = { type: 'episode', episode: parseInt(epMatch[1], 10) };
        } else if (/合集|全集|整季/.test(secText)) {
          currentSection = { type: 'collection' };
        } else {
          currentSection = { type: 'other' };
        }
        continue;
      }

      if ($el.hasClass('row')) {
        let sid: string | null = null;
        $el.find('a[href]').each((_, a) => {
          const href = $(a).attr('href') || '';
          const m = href.match(/(?:^|\/)a\/([0-9A-Za-z]+)(?:$|[/?#])/);
          if (m) {
            sid = m[1];
            return false;
          }
        });

        if (!sid || seenSids.has(sid)) continue;

        const title = (
          $el.find('div.view-text a[href*="/a/"]').first().text() ||
          $el.find('div.view-text a').first().text() ||
          $el.find('div.view-text').first().text() ||
          $el.find('div.f16 a').first().text() ||
          $el.find('div.f16').first().text() ||
          `SubHD ${sid}`
        ).trim();

        let isCollection = false;
        let episodeMatched = false;

        if (isTv && meta.episode !== undefined) {
          if (hasSectionHeaders) {
            if (currentSection.type === 'episode') {
              if (currentSection.episode !== meta.episode) continue;
              isCollection = false;
              episodeMatched = true;
            } else if (currentSection.type === 'collection') {
              const rangeMatch = title.match(/[Ee][Pp]?\s*(\d{1,3})\s*[-~至到]\s*[Ee]?[Pp]?\s*(\d{1,3})/);
              if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (start <= end && (meta.episode < start || meta.episode > end)) {
                  continue;
                }
              }
              isCollection = true;
            } else {
              const [match, col] = isEpisodeMatch(title, meta.season, meta.episode);
              if (!match) continue;
              isCollection = col;
            }
          } else {
            const [match, col] = isEpisodeMatch(title, meta.season, meta.episode);
            if (!match) continue;
            isCollection = col;
          }
        }

        const { tags, dlCount, rate } = this.parseTagsFromCard($, $el, title);
        if (!hasChineseSubtitle(tags)) continue;

        tags.collection = isCollection;
        tags.imdbMatched = isImdbMatched;
        if (episodeMatched) tags.episodeMatched = true;
        if (isTv && meta.season !== undefined) tags.seasonMatched = true;

        seenSids.add(sid);
        items.push({
          id: sid,
          provider: 'subhd',
          title,
          pageUrl: `${domain}/a/${sid}`,
          tags,
          rate,
          downloadsCount: dlCount,
          score: 0
        });
      }
    }

    return items;
  }

  public parseSearchResults(html: string, domain: string, meta: VideoQueryMeta): SubtitleCandidate[] {
    const $ = cheerio.load(html);

    const hasDetailContainer = $('div.bg-white.shadow-sm.rounded-3.mb-5')
      .filter((_, el) => $(el).find('div.row.pt-2.mb-2').length > 0)
      .length > 0;
    if (hasDetailContainer) {
      return this.parseDetailPage(html, domain, meta);
    }

    const items: SubtitleCandidate[] = [];
    const seenSids = new Set<string>();
    const isTv = meta.mediaType === 'series' || meta.season !== undefined;

    const detailRows = $('div.row.pt-2.mb-2').toArray();
    const blocks = detailRows.length > 0
      ? detailRows
      : $('div.bg-white.shadow-sm.rounded-3.mb-4, div.bg-white.shadow-sm.rounded-3.mb-5').toArray();

    for (const block of blocks) {
      const $b = $(block);
      let sid: string | null = null;

      $b.find('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const m = href.match(/(?:^|\/)a\/([0-9A-Za-z]+)(?:$|[/?#])/);
        if (m) {
          sid = m[1];
          return false;
        }
      });

      if (!sid || seenSids.has(sid)) continue;
      seenSids.add(sid);

      const headText = ($b.find('div.f16 a, a.f16').first().text() || $b.find('div.f16').first().text()).trim();
      const viewText = ($b.find('div.view-text a').first().text() || $b.find('div.text-secondary a').first().text() || $b.find('div.view-text').text()).trim();
      const title = viewText || headText || `SubHD ${sid}`;

      let isCollection = false;
      if (isTv && meta.episode !== undefined) {
        const matchText = headText && viewText && !viewText.includes(headText) ? `${headText} - ${viewText}` : title;
        const [matches, col] = isEpisodeMatch(matchText, meta.season, meta.episode);
        if (!matches) continue;
        isCollection = col;
      }

      const { tags, dlCount, rate } = this.parseTagsFromCard($, $b, title);
      if (!hasChineseSubtitle(tags)) continue;
      tags.collection = isCollection;

      items.push({
        id: sid,
        provider: 'subhd',
        title,
        pageUrl: `${domain}/a/${sid}`,
        tags,
        rate,
        downloadsCount: dlCount,
        score: 0
      });
    }

    return items;
  }

  private parseTagsFromCard($: cheerio.CheerioAPI, $b: cheerio.Cheerio<any>, title = ''): { tags: SubtitleTags; dlCount: number; rate: number } {
    const tags: SubtitleTags = {
      provider: this.name,
      lang: [],
      bilingual: false,
      fmt: [],
      source: [],
      collection: false,
      imdbMatched: false
    };

    let dlCount = 0;
    let rate = 0;

    $b.find('span').each((_, span) => {
      const text = $(span).text().trim();
      if (!text) return;

      for (const [cn, key] of Object.entries(SOURCE_BADGE_MAP)) {
        if (text.includes(cn) && !tags.source.includes(key)) {
          tags.source.push(key);
          break;
        }
      }

      if ((text === '简体' || text === '简中' || text.includes('简体') || text.includes('简中')) && !tags.lang.includes('chs')) tags.lang.push('chs');
      if ((text === '繁体' || text === '繁中' || text === '繁體' || text.includes('繁体') || text.includes('繁中') || text.includes('繁體')) && !tags.lang.includes('cht')) tags.lang.push('cht');
      if (text === '双语' || text === '雙語' || text.includes('双语') || text.includes('雙語')) tags.bilingual = true;

      for (const fmt of ['ass', 'srt', 'ssa', 'vtt', 'sup']) {
        if (text.toUpperCase().includes(fmt.toUpperCase()) && !tags.fmt.includes(fmt)) {
          tags.fmt.push(fmt);
        }
      }
    });

    if (tags.bilingual && tags.lang.length === 0) {
      tags.lang.push('chs');
    }

    parseSourceTagsFromText(title, tags.source);

    // Rate parsing: span.text-danger span.align-baseline
    const rateText = $b.find('span.text-danger span.align-baseline').text().trim();
    if (rateText) {
      const parsedRate = parseFloat(rateText);
      if (!isNaN(parsedRate)) rate = parsedRate;
    }

    // Download count parsing: SVG download icon or legacy elements
    const svgDlText = $b.find('svg.bi-download').next('span').text().trim() ||
                      $b.find('svg.bi-download').parent().text().trim();
    if (svgDlText) {
      const m = svgDlText.match(/(\d+)/);
      if (m) dlCount = parseInt(m[1], 10);
    }
    if (!dlCount) {
      $b.find('span').each((_, span) => {
        const text = $(span).text().trim();
        if ($(span).find('i.download, i.cloud').length || /下载/.test(text)) {
          const m = text.match(/(\d+)/);
          if (m) dlCount = parseInt(m[1], 10);
        }
      });
    }
    if (!dlCount) {
      const col2Text = $b.find('div.col-2.d-none.d-lg-block div.text-end.text-secondary, div.text-end.text-secondary').text().trim();
      const m = col2Text.match(/(\d+)/);
      if (m) dlCount = parseInt(m[1], 10);
    }

    const zuEl = $b.find('a[href*="/zu/"]').first();
    if (zuEl.length) tags.fansub = zuEl.text().trim();

    const uEl = $b.find('a[href*="/u/"]').first();
    if (uEl.length) tags.uploader = uEl.text().trim();

    return { tags, dlCount, rate };
  }

  public async download(candidate: SubtitleCandidate): Promise<{ buffer: Buffer; filename: string } | null> {
    const sid = candidate.id;
    let origDomain = this.baseUrl;
    if (candidate.pageUrl) {
      try {
        const u = new URL(candidate.pageUrl);
        origDomain = `${u.protocol}//${u.host}`;
      } catch {}
    }

    const domains = [origDomain, ...this.fallbackUrls].filter((d, i, self) =>
      self.indexOf(d) === i && SubhdProvider.isDomainHealthy(d)
    );
    if (domains.length === 0) domains.push(origDomain);

    for (const domain of domains) {
      const pageUrl = `${domain}/a/${sid}`;
      try {
        const cookies: Record<string, string> = {};
        const updateCookies = (setCookieHeaders?: string[] | string) => {
          if (!setCookieHeaders) return;
          const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
          for (const header of arr) {
            const parts = header.split(';');
            if (parts.length > 0) {
              const [k, v] = parts[0].split('=');
              if (k && v) {
                cookies[k.trim()] = v.trim();
              }
            }
          }
        };
        const getCookieHeader = () => {
          return Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
        };

        const ajaxHeaders: Record<string, string> = {
          Origin: domain,
          Referer: pageUrl,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          Accept: 'application/json, text/javascript, */*; q=0.01'
        };

        // Step 1: POST prepare-download
        const prepResp = await this.client.post(
          `${domain}/api/sub/prepare-download`,
          { sid },
          {
            headers: { ...ajaxHeaders, Cookie: getCookieHeader() },
            timeout: 8000,
            validateStatus: () => true
          }
        );
        updateCookies(prepResp.headers['set-cookie']);

        if (prepResp.status === 403 || !prepResp.data?.success) {
          const msg = String(prepResp.data?.msg || '');
          if (msg.includes('频率过高')) SubhdProvider.markRateLimited(600, 'prepare-download rate limit');
          continue;
        }

        const downPath = prepResp.data.url || `/down/${sid}`;
        const downUrl = downPath.startsWith('http') ? downPath : `${domain}${downPath}`;

        // Step 2: Visit temp page (essential before requesting /api/sub/down)
        const tempResp = await this.client.get(downUrl, {
          headers: {
            Referer: pageUrl,
            'User-Agent': ajaxHeaders['User-Agent'],
            Cookie: getCookieHeader()
          },
          timeout: 8000,
          validateStatus: () => true
        });
        updateCookies(tempResp.headers['set-cookie']);

        if (tempResp.status === 403) {
          SubhdProvider.markRateLimited(600, 'temp page 403');
          continue;
        }

        // Step 3: POST /api/sub/down
        const apiResp = await this.client.post(
          `${domain}/api/sub/down`,
          { sid, cap: '' },
          {
            headers: {
              ...ajaxHeaders,
              Referer: downUrl,
              Cookie: getCookieHeader()
            },
            timeout: 8000,
            validateStatus: () => true
          }
        );
        updateCookies(apiResp.headers['set-cookie']);

        if (apiResp.status === 403 || !apiResp.data?.success || !apiResp.data?.url) {
          const msg = String(apiResp.data?.msg || '');
          if (msg.includes('频率过高')) SubhdProvider.markRateLimited(600, 'api/sub/down rate limit');
          continue;
        }

        let fileUrl: string = apiResp.data.url;
        if (!fileUrl.startsWith('http')) fileUrl = `${domain}${fileUrl}`;

        // Step 4: Fetch actual archive bytes
        const fileResp = await this.client.get(fileUrl, {
          headers: {
            Referer: downUrl,
            'User-Agent': ajaxHeaders['User-Agent'],
            Cookie: getCookieHeader()
          },
          responseType: 'arraybuffer',
          timeout: 25000,
          validateStatus: () => true
        });

        if (fileResp.status === 200 && fileResp.data) {
          const buf = Buffer.from(fileResp.data);
          const filename = extractFilenameFromResponse(fileResp.headers, fileUrl, buf, `subhd_${sid}.zip`);
          return { buffer: buf, filename };
        }
      } catch (err: any) {
        console.warn(`[SubHD] Download error on ${domain} for ${sid}:`, err.message);
      }
    }

    return null;
  }
}
