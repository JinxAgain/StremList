import * as cheerio from 'cheerio';
import { BaseProvider, isEpisodeMatch, extractMetaFromFilename } from './base.js';
import { SubtitleCandidate, SubtitleTags, VideoQueryMeta } from '../types.js';

const SOURCE_BADGE_MAP: Record<string, string> = {
  官方字幕: 'official',
  官方: 'official',
  官译: 'official',
  转载精修: 'reprint',
  精修: 'reprint',
  转载: 'reprint',
  原创翻译: 'original',
  原创: 'original',
  自翻: 'original',
  AI校对: 'ai',
  AI润色: 'ai',
  AI翻译: 'ai',
  机器翻译: 'machine',
  机翻: 'machine'
};

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
          const resp = await this.client.get(searchUrl, { timeout: 6000 });
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

    const blocks = $('div.bg-white.shadow-sm.rounded-3.mb-4, div.bg-white.shadow-sm.rounded-3.mb-5').toArray();

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

      const headText = $b.find('div.f16 a').first().text().trim();
      const viewText = ($b.find('div.view-text a').first().text() || $b.find('div.text-secondary a').first().text()).trim();
      const title = viewText && viewText !== headText && headText ? `${headText} - ${viewText}` : (viewText || headText || `SubHD ${sid}`);

      let isCollection = false;
      if (isTv && meta.episode !== undefined) {
        const [matches, col] = isEpisodeMatch(title, meta.season, meta.episode);
        if (!matches) continue;
        isCollection = col;
      }

      const { tags, dlCount } = this.parseTagsFromCard($, $b);
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

  private parseTagsFromCard($: cheerio.CheerioAPI, $b: cheerio.Cheerio<any>): { tags: SubtitleTags; dlCount: number } {
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

      if ((text.includes('简体') || text.includes('简中')) && !tags.lang.includes('chs')) tags.lang.push('chs');
      if ((text.includes('繁体') || text.includes('繁中')) && !tags.lang.includes('cht')) tags.lang.push('cht');
      if (text.includes('双语') || text.includes('中英')) tags.bilingual = true;

      for (const fmt of ['ass', 'srt', 'ssa', 'vtt']) {
        if (text.toUpperCase().includes(fmt.toUpperCase()) && !tags.fmt.includes(fmt)) {
          tags.fmt.push(fmt);
        }
      }

      if ($(span).find('i.download, i.cloud').length || /下载/.test(text)) {
        const m = text.match(/(\d+)/);
        if (m) dlCount = parseInt(m[1], 10);
      }
    });

    if (tags.lang.length === 0) tags.lang.push('chs');

    const zuEl = $b.find('a[href^="/zu/"]').first();
    if (zuEl.length) tags.fansub = zuEl.text().trim();

    return { tags, dlCount };
  }

  public async download(candidate: SubtitleCandidate): Promise<{ buffer: Buffer; filename: string } | null> {
    const sid = candidate.id;
    const domains = [this.baseUrl, ...this.fallbackUrls].filter((d, i, self) =>
      self.indexOf(d) === i && SubhdProvider.isDomainHealthy(d)
    );
    if (domains.length === 0) domains.push(this.baseUrl);

    for (const domain of domains) {
      const pageUrl = `${domain}/a/${sid}`;
      try {
        const ajaxHeaders = {
          Origin: domain,
          Referer: pageUrl,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01'
        };

        // Step 1: POST prepare-download
        const prepResp = await this.client.post(
          `${domain}/api/sub/prepare-download`,
          { sid },
          { headers: ajaxHeaders, timeout: 5000 }
        );

        if (prepResp.status === 403 || !prepResp.data?.success) {
          const msg = String(prepResp.data?.msg || '');
          if (msg.includes('频率过高')) SubhdProvider.markRateLimited(600, 'prepare-download rate limit');
          continue;
        }

        const downPath = prepResp.data.url || `/down/${sid}`;
        const downUrl = downPath.startsWith('http') ? downPath : `${domain}${downPath}`;

        // Step 2: Visit temp page
        const tempResp = await this.client.get(downUrl, {
          headers: { Referer: pageUrl },
          timeout: 5000
        });
        if (tempResp.status === 403) {
          SubhdProvider.markRateLimited(600, 'temp page 403');
          continue;
        }

        // Step 3: POST /api/sub/down
        const apiResp = await this.client.post(
          `${domain}/api/sub/down`,
          { sid, cap: '' },
          { headers: { ...ajaxHeaders, Referer: downUrl }, timeout: 5000 }
        );

        if (apiResp.status === 403 || !apiResp.data?.success || !apiResp.data?.url) {
          const msg = String(apiResp.data?.msg || '');
          if (msg.includes('频率过高')) SubhdProvider.markRateLimited(600, 'api/sub/down rate limit');
          continue;
        }

        let fileUrl: string = apiResp.data.url;
        if (!fileUrl.startsWith('http')) fileUrl = `${domain}${fileUrl}`;

        // Step 4: Fetch actual archive bytes
        const fileResp = await this.client.get(fileUrl, {
          headers: { Referer: downUrl },
          responseType: 'arraybuffer',
          timeout: 25000
        });

        if (fileResp.status === 200 && fileResp.data) {
          const buf = Buffer.from(fileResp.data);
          let filename = `subhd_${sid}.zip`;
          const cd = fileResp.headers['content-disposition'] || '';
          const mStar = cd.match(/filename\*=(?:utf-8|UTF-8)''([^;]+)/i);
          if (mStar) {
            try {
              filename = decodeURIComponent(mStar[1].replace(/['"]/g, ''));
            } catch {}
          } else {
            const mFn = cd.match(/filename="?([^";]+)"?/i);
            if (mFn) filename = mFn[1].trim();
          }

          return { buffer: buf, filename };
        }
      } catch (err: any) {
        console.warn(`[SubHD] Download error on ${domain} for ${sid}:`, err.message);
      }
    }

    return null;
  }
}
