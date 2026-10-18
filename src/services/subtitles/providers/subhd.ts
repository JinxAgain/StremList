import * as cheerio from 'cheerio';
import {
  BaseProvider,
  isEpisodeMatch,
  extractMetaFromFilename,
  extractFilenameFromResponse,
  SOURCE_BADGE_MAP,
  parseSourceTagsFromText,
  hasChineseSubtitle
} from './base.js';
import { SubtitleCandidate, SubtitleTags, VideoQueryMeta } from '../types.js';

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
    const queries = this.buildQueries(meta);
    if (queries.length === 0) return [];

    const endpoints = [this.baseUrl, ...this.fallbackUrls].filter((d, i, self) =>
      self.indexOf(d) === i && SubhdProvider.isDomainHealthy(d)
    );
    if (endpoints.length === 0) endpoints.push(this.baseUrl);

    const candidates: SubtitleCandidate[] = [];
    const seenSids = new Set<string>();

    for (const domain of endpoints) {
      let foundAny = false;
      for (const q of queries) {
        const isImdb = q.startsWith('tt');
        const searchUrl = `${domain}/search/${encodeURIComponent(q)}`;
        let newFound = 0;

        try {
          const resp = await this.client.get(searchUrl, { timeout: 6000, validateStatus: () => true });
          if (resp.status === 200 && typeof resp.data === 'string') {
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

  private parseSearchResults(html: string, domain: string, meta: VideoQueryMeta): SubtitleCandidate[] {
    const $ = cheerio.load(html);
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
        const m = href.match(/^\/a\/([0-9A-Za-z]+)/);
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

      const { tags, dlCount } = this.parseTagsFromCard($, $b, title);
      if (!hasChineseSubtitle(tags)) continue;
      tags.collection = isCollection;

      items.push({
        id: sid,
        provider: 'subhd',
        title,
        pageUrl: `${domain}/a/${sid}`,
        tags,
        rate: 0,
        downloadsCount: dlCount,
        score: 0
      });
    }

    return items;
  }

  private parseTagsFromCard($: cheerio.CheerioAPI, $b: cheerio.Cheerio<any>, title = ''): { tags: SubtitleTags; dlCount: number } {
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

    const zuEl = $b.find('a[href^="/zu/"]').first();
    if (zuEl.length) tags.fansub = zuEl.text().trim();

    return { tags, dlCount };
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
