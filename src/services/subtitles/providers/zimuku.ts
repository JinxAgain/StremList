import * as cheerio from 'cheerio';
import {
  BaseProvider,
  isEpisodeMatch,
  extractSeasonsFromText,
  toCnSeason,
  extractMetaFromFilename,
  extractFilenameFromResponse,
  parseSourceTagsFromText,
  hasChineseSubtitle
} from './base.js';
import { ZimukuBmpSolver } from './zimuku-solver.js';
import { SubtitleCandidate, SubtitleTags, VideoQueryMeta } from '../types.js';

export class ZimukuProvider extends BaseProvider {
  public readonly name = 'zimuku';

  private static unhealthyDomains = new Map<string, number>();
  private readonly baseUrl: string;
  private readonly fallbackUrls: string[];
  private cookies: Record<string, string> = {};

  constructor(proxy?: string) {
    super(proxy);
    this.baseUrl = (process.env.ZIMUKU_BASE_URL || 'https://zmk.pw').replace(/\/+$/, '');
    const fallbacksEnv = process.env.ZIMUKU_FALLBACKS || 'https://srtku.com,https://zimuku.org';
    this.fallbackUrls = fallbacksEnv.split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean);
  }

  public static isDomainHealthy(domain: string): boolean {
    const until = ZimukuProvider.unhealthyDomains.get(domain) || 0;
    return Date.now() / 1000 > until;
  }

  public static markDomainUnhealthy(domain: string, cooldownSecs = 600): void {
    ZimukuProvider.unhealthyDomains.set(domain, Date.now() / 1000 + cooldownSecs);
    console.warn(`[Zimuku] Marking mirror ${domain} as unhealthy for ${cooldownSecs}s`);
  }

  private getCookieHeader(domain: string): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private setCookie(cookieStr?: string): void {
    if (!cookieStr) return;
    const parts = cookieStr.split(';');
    if (parts.length > 0) {
      const [k, v] = parts[0].split('=');
      if (k && v) {
        this.cookies[k.trim()] = v.trim();
      }
    }
  }

  private async fetchPage(urlStr: string, referer?: string): Promise<{ data: string | Buffer; status: number } | null> {
    const urlObj = new URL(urlStr);
    const domain = `${urlObj.protocol}//${urlObj.host}`;

    if (!ZimukuProvider.isDomainHealthy(domain)) {
      return null;
    }

    const headers: Record<string, string> = {
      Cookie: this.getCookieHeader(domain)
    };
    if (referer) headers['Referer'] = referer;
    const timeout = domain.includes('zmk.pw') ? 12000 : 5000;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await this.client.get(urlStr, {
          headers,
          timeout,
          responseType: 'arraybuffer',
          validateStatus: () => true
        });

        const setCookies = resp.headers['set-cookie'];
        if (Array.isArray(setCookies)) {
          setCookies.forEach((c) => this.setCookie(c));
        }

        const buffer = Buffer.from(resp.data);
        const text = buffer.toString('utf-8');

        // Detect Yunsuo WAF challenge page
        if (text.includes('security_verify_img') || text.includes('YunsuoAutoJump')) {
          console.info(`[Zimuku] WAF challenge detected for ${urlStr}, solving...`);
          const solved = await this.solveWafCaptcha(urlStr, text);
          if (solved) {
            headers.Cookie = this.getCookieHeader(domain);
            continue;
          } else {
            console.warn(`[Zimuku] Failed to solve WAF challenge for ${urlStr}`);
            return null;
          }
        }

        // Handle JS window.location.replace redirect
        const mRedirect = text.match(/window\.location\.replace\(['"]([^'"]+)['"]\)/);
        if (mRedirect) {
          const redirectUrl = this.normalizeUrl(domain, mRedirect[1]);
          try {
            const redirectResp = await this.client.get(redirectUrl, {
              headers: { ...headers, Referer: urlStr },
              timeout,
              responseType: 'arraybuffer',
              validateStatus: () => true
            });
            const redCookies = redirectResp.headers['set-cookie'];
            if (Array.isArray(redCookies)) {
              redCookies.forEach((c) => this.setCookie(c));
            }
            if (redirectResp.status === 200) {
              return { data: Buffer.from(redirectResp.data), status: redirectResp.status };
            }
          } catch {
            // Ignore redirect error
          }
        }

        if (resp.status !== 200) {
          console.warn(`[Zimuku] Non-200 status (${resp.status}) for ${urlStr}`);
          return null;
        }

        return { data: buffer, status: resp.status };
      } catch (err: any) {
        console.warn(`[Zimuku] GET ${urlStr} failed:`, err.message);
        if (!domain.includes('zmk.pw')) {
          ZimukuProvider.markDomainUnhealthy(domain, 600);
        }
        return null;
      }
    }

    return null;
  }

  private async solveWafCaptcha(urlStr: string, htmlText: string): Promise<boolean> {
    try {
      const $ = cheerio.load(htmlText);
      const imgSrc = $('img').attr('src') || '';
      if (!imgSrc.includes('data:image/bmp;base64,')) {
        return false;
      }

      const b64Data = imgSrc.split('data:image/bmp;base64,')[1];
      const code = new ZimukuBmpSolver(b64Data).recognize();
      console.info(`[Zimuku] Recognized BMP captcha code: ${code}`);

      const urlObj = new URL(urlStr);
      let srcurlHex = '';
      for (let i = 0; i < urlStr.length; i++) {
        srcurlHex += urlStr.charCodeAt(i).toString(16);
      }
      this.cookies['srcurl'] = srcurlHex;

      let codeHex = '';
      for (let i = 0; i < code.length; i++) {
        codeHex += code.charCodeAt(i).toString(16);
      }

      const verifyUrl = `${urlObj.protocol}//${urlObj.host}/?security_verify_img=${codeHex}`;
      const verifyResp = await this.client.get(verifyUrl, {
        headers: {
          Referer: urlStr,
          Cookie: this.getCookieHeader(`${urlObj.protocol}//${urlObj.host}`)
        },
        timeout: 10000,
        validateStatus: () => true
      });

      const setCookies = verifyResp.headers['set-cookie'];
      if (Array.isArray(setCookies)) {
        setCookies.forEach((c) => this.setCookie(c));
      }
      return true;
    } catch (err) {
      console.error('[Zimuku] Captcha bypass error:', err);
      return false;
    }
  }

  public async search(meta: VideoQueryMeta): Promise<SubtitleCandidate[]> {
    const queries = this.buildQueries(meta);
    if (queries.length === 0) return [];

    const endpoints = [this.baseUrl, ...this.fallbackUrls].filter((d, i, self) =>
      self.indexOf(d) === i && ZimukuProvider.isDomainHealthy(d)
    );
    if (endpoints.length === 0) endpoints.push(this.baseUrl);

    const candidates: SubtitleCandidate[] = [];
    const seenIds = new Set<string>();

    for (const domain of endpoints) {
      let domainDead = false;
      for (const q of queries) {
        const isImdb = q.startsWith('tt');
        const searchUrl = `${domain}/search?q=${encodeURIComponent(q)}`;
        const resp = await this.fetchPage(searchUrl);
        if (!resp) {
          domainDead = true;
          break;
        }

        const html = resp.data.toString();
        let newFound = 0;

        // 1. Prioritize Zimuku work cards (/subs/xxxxx.html)
        const workItems = await this.parseWorksFromSearch(html, domain, meta);
        for (const sub of workItems) {
          if (isImdb) sub.tags.imdbMatched = true;
          if (!seenIds.has(sub.id)) {
            seenIds.add(sub.id);
            candidates.push(sub);
            newFound++;
          }
        }

        // 2. Fallback to direct subtitle table if no work items found
        if (workItems.length === 0) {
          const tableItems = this.parseSubtitlesFromTable(html, domain, meta);
          for (const sub of tableItems) {
            if (isImdb) sub.tags.imdbMatched = true;
            if (!seenIds.has(sub.id)) {
              seenIds.add(sub.id);
              candidates.push(sub);
              newFound++;
            }
          }
        }

        if (isImdb && newFound > 0) break;
        if (candidates.length > 0 && meta.season) break;
      }

      if (candidates.length > 0) break;
      if (domainDead) continue;
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
      const s = meta.season || 1;
      const cnS = toCnSeason(s);
      if (s > 1) {
        if (cleanTitle) queries.push(`${cleanTitle} ${cnS}`);
      } else {
        if (isTtImdb) queries.push(meta.imdbId);
        if (cleanTitle) {
          queries.push(`${cleanTitle} S01`);
          queries.push(`${cleanTitle} 第一季`);
          queries.push(`${cleanTitle} Season 1`);
          queries.push(cleanTitle);
        }
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

  private parseSubtitleRow(
    $: cheerio.CheerioAPI,
    tr: any,
    domain: string,
    meta: VideoQueryMeta,
    workImdbMatched = false
  ): SubtitleCandidate | null {
    const isTv = meta.mediaType === 'series' || meta.season !== undefined;
    const firstTd = $(tr).find('td.first');
    const subA = firstTd.length
      ? firstTd.find('a[href*="/detail/"]').first()
      : $(tr).find('a[href*="/detail/"]').first();
    const href = subA.attr('href');
    if (!href) return null;

    const mId = href.match(/\/detail\/(\d+)\.html/);
    if (!mId) return null;
    const subId = mId[1];
    const detailUrl = this.normalizeUrl(domain, href);

    const title = (subA.attr('title') || subA.text()).trim();
    if (!title) return null;

    let isCollection = false;
    if (isTv && meta.episode !== undefined) {
      const [matches, col] = isEpisodeMatch(title, meta.season, meta.episode);
      if (!matches) return null;
      isCollection = col;
    }

    const tags: SubtitleTags = {
      provider: this.name,
      lang: [],
      bilingual: false,
      fmt: [],
      source: [],
      collection: isCollection,
      imdbMatched: workImdbMatched
    };

    // Extract language flags strictly from td.tac.lang img, td.tac img, td.first img alt/title/data-original-title
    // User requirement: Only care about "双语", "简体中文" (or "简体"), "繁體中文" (or "繁体").
    // Do NOT infer language or bilingual from title/filename.
    $(tr).find('td.tac.lang img, td.tac img, td.first img').each((_, img) => {
      const alt = `${$(img).attr('alt') || ''} ${$(img).attr('title') || ''} ${$(img).attr('data-original-title') || ''}`.trim();
      if (alt.includes('双语') || alt.includes('雙語')) tags.bilingual = true;
      if (alt.includes('简体中文') || alt.includes('简体') || alt.includes('简中') || alt.toLowerCase().includes('chs')) {
        if (!tags.lang.includes('chs')) tags.lang.push('chs');
      }
      if (alt.includes('繁體中文') || alt.includes('繁体中文') || alt.includes('繁体') || alt.includes('繁體') || alt.includes('繁中') || alt.toLowerCase().includes('cht')) {
        if (!tags.lang.includes('cht')) tags.lang.push('cht');
      }
    });

    if (tags.bilingual && tags.lang.length === 0) {
      tags.lang.push('chs');
    }

    if (!hasChineseSubtitle(tags)) return null;

    // Extract format badges
    $(tr).find('span.label-info').each((_, span) => {
      const text = $(span).text().trim().toLowerCase();
      text.split('/').forEach((f) => {
        const fc = f.trim();
        if (fc && !tags.fmt.includes(fc)) tags.fmt.push(fc);
      });
    });

    for (const fmt of ['ass', 'srt', 'ssa', 'vtt', 'sup']) {
      if (title.toLowerCase().endsWith('.' + fmt) && !tags.fmt.includes(fmt)) {
        tags.fmt.push(fmt);
      }
    }

    // Extract translation source badges
    const firstTdText = $(tr).find('td.first').text();
    parseSourceTagsFromText(firstTdText, tags.source);
    parseSourceTagsFromText(title, tags.source);

    // Rating
    let rate = 0;
    const ratingEl = $(tr).find('i[class*="rating-star"], span[class*="rating-star"]');
    const ratingStar = ratingEl.attr('title') || ratingEl.attr('data-original-title') || '';
    if (ratingStar) {
      const m = ratingStar.match(/(\d+(?:\.\d+)?)/);
      if (m) rate = parseFloat(m[1]);
    }

    // Download count (pure number or "1234次", excluding uploader/time cells)
    let downloadsCount = 0;
    $(tr).find('td.tac, td.last').each((_, td) => {
      if ($(td).find('img, a[href*="/u/"], span.glyphicon').length > 0) return;
      const txt = $(td).text().trim();
      const m = txt.match(/^(\d+)\s*次?$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > downloadsCount) downloadsCount = n;
      }
    });

    return {
      id: subId,
      provider: 'zimuku',
      title,
      pageUrl: detailUrl,
      tags,
      rate,
      downloadsCount,
      score: 0
    };
  }

  public parseSubtitlesFromTable(html: string, domain: string, meta: VideoQueryMeta): SubtitleCandidate[] {
    const $ = cheerio.load(html);
    const table = $('table.tborder2').first().length ? $('table.tborder2').first() : $('table.table').first();
    if (!table.length) return [];

    const candidates: SubtitleCandidate[] = [];
    table.find('tr').each((_, tr) => {
      const cand = this.parseSubtitleRow($, tr, domain, meta, false);
      if (cand) candidates.push(cand);
    });
    return candidates;
  }

  public async parseWorksFromSearch(html: string, domain: string, meta: VideoQueryMeta): Promise<SubtitleCandidate[]> {
    const $ = cheerio.load(html);
    const workDivs = $('div.item').toArray();
    const candidates: SubtitleCandidate[] = [];
    const isTv = meta.mediaType === 'series' || meta.season !== undefined;

    for (const div of workDivs) {
      const a = $(div).find('div.title p.tt a, a[href*="/subs/"]').first();
      if (!a.length) continue;

      const workTitle = a.text().trim();
      const workHref = a.attr('href') || '';
      if (!workHref) continue;

      if (isTv && meta.season !== undefined) {
        const workSeasons = extractSeasonsFromText(workTitle);
        if (workSeasons.size > 0 && !workSeasons.has(meta.season)) continue;
      }

      const workUrl = this.normalizeUrl(domain, workHref);
      const workResp = await this.fetchPage(workUrl);
      if (!workResp) continue;

      const workHtml = workResp.data.toString();
      const workImdbMatched = Boolean(
        meta.imdbId &&
        meta.imdbId.startsWith('tt') &&
        (workHtml.includes(`imdb.com/title/${meta.imdbId}`) || workHtml.includes(meta.imdbId))
      );
      const subs = this.parseSubtitlesFromWork(workHtml, domain, meta, workImdbMatched);
      if (subs.length > 0) {
        candidates.push(...subs);
        break;
      }
    }

    return candidates;
  }

  public parseSubtitlesFromWork(html: string, domain: string, meta: VideoQueryMeta, workImdbMatched = false): SubtitleCandidate[] {
    const $ = cheerio.load(html);
    const table = $('table#subtb, div.subs.box.clearfix table').first();
    if (!table.length) return [];

    const candidates: SubtitleCandidate[] = [];
    table.find('tr').each((_, tr) => {
      const cand = this.parseSubtitleRow($, tr, domain, meta, workImdbMatched);
      if (cand) candidates.push(cand);
    });
    return candidates;
  }

  private normalizeUrl(domain: string, href: string): string {
    try {
      const parsed = new URL(href, domain);
      let p = parsed.pathname;
      if (parsed.search) p += parsed.search;
      if (!p.startsWith('/')) p = '/' + p;
      return `${domain}${p}`;
    } catch {
      let clean = href.startsWith('http') ? href.replace(/^https?:\/\/[^/]+/, '') : href;
      if (!clean.startsWith('/')) clean = '/' + clean;
      return `${domain}${clean}`;
    }
  }

  public async download(candidate: SubtitleCandidate): Promise<{ buffer: Buffer; filename: string } | null> {
    let origDomain = this.baseUrl;
    if (candidate.pageUrl) {
      try {
        const u = new URL(candidate.pageUrl);
        origDomain = `${u.protocol}//${u.host}`;
      } catch {}
    }

    const domains = [origDomain, ...this.fallbackUrls].filter((d, i, self) =>
      self.indexOf(d) === i && ZimukuProvider.isDomainHealthy(d)
    );
    if (domains.length === 0) domains.push(origDomain);

    let path = `/detail/${candidate.id}.html`;
    if (candidate.pageUrl) {
      try {
        path = new URL(candidate.pageUrl).pathname;
      } catch {}
    }

    for (const domain of domains) {
      const detailUrl = `${domain}${path}`;
      const resp = await this.fetchPage(detailUrl);
      if (!resp) continue;

      const $ = cheerio.load(resp.data.toString());
      const dlSub = $('li.dlsub a').first();
      if (!dlSub.length || !dlSub.attr('href')) continue;

      const dlUrl = this.normalizeUrl(domain, dlSub.attr('href')!);
      const dlPageResp = await this.fetchPage(dlUrl, detailUrl);
      if (!dlPageResp) continue;

      const $dl = cheerio.load(dlPageResp.data.toString());
      const linksBox = $dl('div.clearfix').first();
      const links = linksBox.find('a[href]').toArray();

      for (const a of links) {
        const fileUrl = this.normalizeUrl(domain, $dl(a).attr('href')!);

        try {
          const fileResp = await this.client.get(fileUrl, {
            headers: { Referer: dlUrl, Cookie: this.getCookieHeader(domain) },
            responseType: 'arraybuffer',
            timeout: 25000,
            validateStatus: () => true
          });

          if (fileResp.status === 200 && fileResp.data) {
            const buf = Buffer.from(fileResp.data);
            if (buf.length >= 100) {
              const filename = extractFilenameFromResponse(
                fileResp.headers,
                fileUrl,
                buf,
                `zimuku_${candidate.id}.zip`
              );
              return { buffer: buf, filename };
            }
          }
        } catch (err: any) {
          console.debug(`[Zimuku] Download error from ${fileUrl}:`, err.message);
        }
      }
    }

    return null;
  }
}
