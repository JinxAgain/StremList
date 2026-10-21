import axios from 'axios';
import { extractSeasonAndBaseTitle } from '../providers/base.js';

export class CinemetaClient {
  private static readonly CINEMETA_URL = 'https://v3-cinemeta.strem.io';

  public static async resolveMediaInfo(
    mediaType: string,
    idStr: string
  ): Promise<{ title: string; year: number | null; resolvedImdb: string | null }> {
    if (!idStr) {
      return { title: '', year: null, resolvedImdb: null };
    }

    const cleanType = mediaType === 'series' ? 'series' : 'movie';

    // 1. Standard IMDb ID
    if (idStr.startsWith('tt')) {
      const url = `${this.CINEMETA_URL}/meta/${cleanType}/${idStr}.json`;
      try {
        const resp = await axios.get(url, { timeout: 4000 });
        if (resp.status === 200 && resp.data?.meta) {
          const name = String(resp.data.meta.name || '').trim();
          let year: number | null = null;
          const yearVal = resp.data.meta.year || resp.data.meta.releaseInfo;
          if (yearVal) {
            const m = String(yearVal).match(/(\d{4})/);
            if (m) year = parseInt(m[1], 10);
          }
          return { title: name, year, resolvedImdb: idStr };
        }
      } catch (err) {
        console.debug(`[Cinemeta] Cinemeta resolution error for ${idStr}:`, err);
      }
      return { title: '', year: null, resolvedImdb: idStr };
    }

    // 2. TMDB ID resolution (e.g. tmdb:1083381 or tmdb:movie:1083381)
    if (idStr.startsWith('tmdb:')) {
      const tokens = idStr.split(':');
      let tmdbIdPart = tokens[1] || '';
      if (tokens.length > 2 && (tokens[1] === 'movie' || tokens[1] === 'tv')) {
        tmdbIdPart = tokens[2];
      }

      // Try TMDB Addon first
      const tmdbAddonUrl = `https://94c8cb9f702d-tmdb-addon.baby-beamup.club/meta/${cleanType}/tmdb:${tmdbIdPart}.json`;
      try {
        const resp = await axios.get(tmdbAddonUrl, { timeout: 4000 });
        if (resp.status === 200 && resp.data?.meta) {
          const meta = resp.data.meta;
          const name = String(meta.name || '').trim();
          const resolvedImdb = meta.imdb_id ? String(meta.imdb_id).trim() : null;
          let year: number | null = null;
          const yearVal = meta.year || meta.releaseInfo;
          if (yearVal) {
            const m = String(yearVal).match(/(\d{4})/);
            if (m) year = parseInt(m[1], 10);
          }
          if (name) {
            return { title: name, year, resolvedImdb };
          }
        }
      } catch (err) {
        console.debug(`[Cinemeta] TMDB addon lookup failed for ${idStr}:`, err);
      }

      // Fallback: Scrape title and year from themoviedb.org
      const tmdbWebType = mediaType === 'series' ? 'tv' : 'movie';
      const tmdbWebUrl = `https://www.themoviedb.org/${tmdbWebType}/${tmdbIdPart}`;
      try {
        const headers = {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        };
        const resp = await axios.get(tmdbWebUrl, { timeout: 3500, headers });
        if (resp.status === 200 && typeof resp.data === 'string') {
          const m = resp.data.match(/<title>\s*(.*?)\s*(?:\((?:TV Series\s*)?(\d{4})\))?\s*&#8212;\s*The Movie Database/);
          if (m) {
            const name = m[1].trim();
            const year = m[2] ? parseInt(m[2], 10) : null;
            return { title: name, year, resolvedImdb: null };
          }
        }
      } catch (err) {
        console.debug(`[Cinemeta] TheMovieDb web fallback failed for ${idStr}:`, err);
      }
    }

    // 3. Kitsu ID resolution (e.g. kitsu:50016)
    if (idStr.startsWith('kitsu:')) {
      const kitsuUrl = `https://anime-kitsu.strem.fun/meta/${cleanType}/${encodeURIComponent(idStr)}.json`;
      try {
        const resp = await axios.get(kitsuUrl, { timeout: 4000 });
        if (resp.status === 200 && resp.data?.meta) {
          const meta = resp.data.meta;
          const name = String(meta.name || '').trim();
          const resolvedImdb = meta.imdb_id ? String(meta.imdb_id).trim() : null;
          let year: number | null = null;
          const yearVal = meta.year || meta.releaseInfo;
          if (yearVal) {
            const m = String(yearVal).match(/(\d{4})/);
            if (m) year = parseInt(m[1], 10);
          }
          if (name) {
            return { title: name, year, resolvedImdb };
          }
        }
      } catch (err) {
        console.debug(`[Cinemeta] Kitsu lookup failed for ${idStr}:`, err);
      }

      // Fallback: Query official Kitsu API (e.g. https://kitsu.io/api/edge/anime/50016)
      try {
        const kitsuNumId = idStr.replace(/^kitsu:/i, '').split(':')[0];
        if (kitsuNumId && /^\d+$/.test(kitsuNumId)) {
          const officialKitsuUrl = `https://kitsu.io/api/edge/anime/${kitsuNumId}`;
          const kResp = await axios.get(officialKitsuUrl, {
            timeout: 4000,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              Accept: 'application/vnd.api+json'
            }
          });
          if (kResp.status === 200 && kResp.data?.data?.attributes) {
            const attr = kResp.data.data.attributes;
            const name = String(
              attr.canonicalTitle || attr.titles?.en_jp || attr.titles?.en || ''
            ).trim();
            let year: number | null = null;
            if (attr.startDate) {
              const m = String(attr.startDate).match(/^(\d{4})/);
              if (m) year = parseInt(m[1], 10);
            }

            let resolvedImdb: string | null = null;
            if (name) {
              const { baseTitle } = extractSeasonAndBaseTitle(name);
              const searchTitle = baseTitle || name;
              try {
                const searchUrl = `${this.CINEMETA_URL}/catalog/${cleanType}/top/search=${encodeURIComponent(searchTitle)}.json`;
                const cResp = await axios.get(searchUrl, { timeout: 3000 });
                if (cResp.status === 200 && Array.isArray(cResp.data?.metas) && cResp.data.metas.length > 0) {
                  const match = cResp.data.metas[0];
                  if (match?.id && match.id.startsWith('tt')) {
                    resolvedImdb = match.id;
                  }
                }
              } catch (searchErr) {
                console.debug(`[Cinemeta] Cinemeta catalog search fallback failed for "${searchTitle}":`, searchErr);
              }

              return { title: name, year, resolvedImdb };
            }
          }
        }
      } catch (kErr) {
        console.debug(`[Cinemeta] Official Kitsu API fallback failed for ${idStr}:`, kErr);
      }

      return { title: '', year: null, resolvedImdb: null };
    }

    return { title: '', year: null, resolvedImdb: null };
  }
}
