import * as cheerio from 'cheerio';
import { BaseProvider, isEpisodeMatch, extractSeasonsFromText, toCnSeason, extractMetaFromFilename } from './base.js';
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
    const until = this.unhealthyDomains.get(domain) || 0;
    return Date.now() / 1000 > until;
  }

  public static markDomainUnhealthy(domain: string, cooldownSecs = 600): void {
    this.unhealthyDomains.set(domain, Date.now() / 1000 + cooldownSecs);
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
          responseType: 'arraybuffer'
        });

        const setCookies = resp.headers['set-cookie'];
        if (Array.isArray(setCookies)) {
          setCookies.forEach((c) => this.setCookie(c));
        }

        const buffer = Buffer.from(resp.data);
        const text = buffer.toString('utf-8');

        // Detect Yunsuo WAF
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
          const redirectUrl = mRedirect[1];
          try {
            const redirectResp = await this.client.get(redirectUrl, {
              headers: { ...headers, Referer: urlStr },
              timeout,
              responseType: 'arraybuffer'
            });
            return { data: Buffer.from(redirectResp.data), status: redirectResp.status };
          } catch {
            // Ignore redirect error
          }
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
      await this.client.get(verifyUrl, {
        headers: {
          Referer: urlStr,
          Cookie: this.getCookieHeader(`${urlObj.protocol}//${urlObj.host}`)
        },
        timeout: 10000
      });
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

        // 1. Direct table
        const tableItems = this.parseSubtitlesFromTable(html, domain, meta);
        for (const sub of tableItems) {
          if (isImdb) sub.tags.imdbMatched = true;
          if (!seenIds.has(sub.id)) {
            seenIds.add(sub.id);
            candidates.push(sub);
            newFound++;
          }
        }

        // 2. Work cards
        const workItems = await this.parseWorksFromSearch(html, domain, meta);
        for (const sub of workItems) {
          if (isImdb) sub.tags.imdbMatched = true;
          if (!seenIds.has(sub.id)) {
            seenIds.add(sub.id);
            candidates.push(sub);
            newFound++;
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
        if (cleanTitle) {
          queries.push(`${cleanTitle} S01`);
          queries.push(`${cleanTitle} 第一季`);
        }
        if (isTtImdb) queries.push(meta.imdbId);
        if (cleanTitle) {
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

  private parseSubtitlesFromTable(html: string, domain: string, meta: VideoQueryMeta): SubtitleCandidate[] {
    const $ = cheerio.load(html);
    const table = $('table.tborder2').first().length ? $('table.tborder2').first() : $('table.table').first();
    if (!table.length) return [];

    const candidates: SubtitleCandidate[] = [];
    const isTv = meta.mediaType === 'series' || meta.season !== undefined;

    table.find('tr').each((_, tr) => {
      const firstTd = $(tr).find('td.first');
      if (!firstTd.length) return;

      const subA = firstTd.find('a').first();
      const href = subA.attr('href');
      if (!href) return;

      const title = subA.attr('title') || subA.text().trim();
      const mId = href.match(/\/detail\/(\d+)\.html/);
      const subId = mId ? mId[1] : href.split('/').pop()?.replace('.html', '') || '';
      const detailUrl = `${domain}/detail/${subId}.html`;

      let isCollection = false;
      if (isTv && meta.episode !== undefined) {
        const [matches, col] = isEpisodeMatch(title, meta.season, meta.episode);
        if (!matches) return;
        isCollection = col;
      }

      const tags: SubtitleTags = {
        provider: this.name,
        lang: [],
        bilingual: false,
        fmt: [],
        source: [],
        collection: isCollection,
        imdbMatched: false
      };

      const imgs = firstTd.find('img').toArray();
      const tacTd = $(tr).find('td.tac');
      if (tacTd.length) imgs.push(...tacTd.find('img').toArray());

      for (const img of imgs) {
        const alt = `${$(img).attr('alt') || ''} ${$(img).attr('title') || ''}`;
        if (alt.includes('双语')) tags.bilingual = true;
        if (alt.includes('简体') || alt.toLowerCase().includes('chs')) {
          if (!tags.lang.includes('chs')) tags.lang.push('chs');
        }
        if (alt.includes('繁体') || alt.toLowerCase().includes('cht')) {
          if (!tags.lang.includes('cht')) tags.lang.push('cht');
        }
      }

      if (title.includes('双语') || title.includes('中英')) tags.bilingual = true;
      if (tags.lang.length === 0) tags.lang.push('chs');

      const fmtSpan = firstTd.find('span.label-info');
      if (fmtSpan.length) {
        fmtSpan.text().trim().toLowerCase().split('/').forEach((f) => {
          const fc = f.trim();
          if (fc && !tags.fmt.includes(fc)) tags.fmt.push(fc);
        });
      }

      candidates.push({
        id: subId,
        provider: 'zimuku',
        title,
        pageUrl: detailUrl,
        tags,
        rate: 0,
        downloadsCount: 0,
        score: 0
      });
    });

    return candidates;
  }

  private async parseWorksFromSearch(html: string, domain: string, meta: VideoQueryMeta): Promise<SubtitleCandidate[]> {
    const $ = cheerio.load(html);
    const workDivs = $('div.item').slice(0, 3).toArray();
    const candidates: SubtitleCandidate[] = [];
    const isTv = meta.mediaType === 'series' || meta.season !== undefined;

    for (const div of workDivs) {
      const a = $(div).find('div.title p.tt a').first();
      if (!a.length) continue;

      const workTitle = a.text().trim();
      const workHref = a.attr('href') || '';
      if (!workHref) continue;

      if (isTv && meta.season !== undefined) {
        const workSeasons = extractSeasonsFromText(workTitle);
        if (workSeasons.size > 0 && !workSeasons.has(meta.season)) continue;
      }

      const workUrl = workHref.startsWith('http') ? workHref : `${domain}${workHref}`;
      const workResp = await this.fetchPage(workUrl);
      if (!workResp) continue;

      const workHtml = workResp.data.toString();
      const subs = this.parseSubtitlesFromWork(workHtml, domain, meta);
      candidates.push(...subs);
    }

    return candidates;
  }

  private parseSubtitlesFromWork(html: string, domain: string, meta: VideoQueryMeta): SubtitleCandidate[] {
    const $ = cheerio.load(html);
    const table = $('div.subs.box.clearfix tbody').first();
    if (!table.length) return [];

    const candidates: SubtitleCandidate[] = [];
    const isTv = meta.mediaType === 'series' || meta.season !== undefined;

    table.find('tr').each((_, tr) => {
      const subA = $(tr).find('a').first();
      const href = subA.attr('href');
      if (!href) return;

      const title = subA.text().trim();
      const mId = href.match(/\/detail\/(\d+)\.html/);
      const subId = mId ? mId[1] : href.split('/').pop()?.replace('.html', '') || '';
      const detailUrl = href.startsWith('http') ? href : `${domain}${href}`;

      let isCollection = false;
      if (isTv && meta.episode !== undefined) {
        const [matches, col] = isEpisodeMatch(title, meta.season, meta.episode);
        if (!matches) return;
        isCollection = col;
      }

      const tags: SubtitleTags = {
        provider: this.name,
        lang: [],
        bilingual: false,
        fmt: [],
        source: [],
        collection: isCollection,
        imdbMatched: false
      };

      if (title.includes('双语') || title.includes('中英')) tags.bilingual = true;
      tags.lang.push('chs');

      candidates.push({
        id: subId,
        provider: 'zimuku',
        title,
        pageUrl: detailUrl,
        tags,
        rate: 0,
        downloadsCount: 0,
        score: 0
      });
    });

    return candidates;
  }

  public async download(candidate: SubtitleCandidate): Promise<{ buffer: Buffer; filename: string } | null> {
    const domains = [this.baseUrl, ...this.fallbackUrls].filter(ZimukuProvider.isDomainHealthy);
    if (domains.length === 0) domains.push(this.baseUrl);

    for (const domain of domains) {
      const detailUrl = `${domain}/detail/${candidate.id}.html`;
      const resp = await this.fetchPage(detailUrl);
      if (!resp) continue;

      const $ = cheerio.load(resp.data.toString());
      const dlSub = $('li.dlsub a').first();
      if (!dlSub.length || !dlSub.attr('href')) continue;

      const dlPath = dlSub.attr('href')!;
      const dlUrl = dlPath.startsWith('http') ? dlPath : `${domain}${dlPath}`;
      const dlPageResp = await this.fetchPage(dlUrl, detailUrl);
      if (!dlPageResp) continue;

      const $dl = cheerio.load(dlPageResp.data.toString());
      const linksBox = $dl('div.clearfix').first();
      const links = linksBox.find('a[href]').toArray();

      for (const a of links) {
        const fileHref = $dl(a).attr('href')!;
        const fileUrl = fileHref.startsWith('http') ? fileHref : `${domain}${fileHref}`;

        try {
          const fileResp = await this.client.get(fileUrl, {
            headers: { Referer: dlUrl, Cookie: this.getCookieHeader(domain) },
            responseType: 'arraybuffer',
            timeout: 25000
          });

          if (fileResp.status === 200 && fileResp.data) {
            const buf = Buffer.from(fileResp.data);
            if (buf.length >= 100) {
              const cd = fileResp.headers['content-disposition'] || '';
              let filename = `zimuku_${candidate.id}.zip`;
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
          }
        } catch (err: any) {
          console.debug(`[Zimuku] Download error from ${fileUrl}:`, err.message);
        }
      }
    }

    return null;
  }
}
