import axios from 'axios';

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

    return { title: '', year: null, resolvedImdb: null };
  }
}
