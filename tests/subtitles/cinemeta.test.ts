import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { CinemetaClient } from '../../src/services/subtitles/core/cinemeta.js';

vi.mock('axios');

describe('CinemetaClient', () => {
  it('resolves IMDb ID via Cinemeta', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      status: 200,
      data: { meta: { name: 'Breaking Bad', year: '2008' } }
    } as any);

    const res = await CinemetaClient.resolveMediaInfo('series', 'tt0903747');
    expect(res.title).toBe('Breaking Bad');
    expect(res.year).toBe(2008);
    expect(res.resolvedImdb).toBe('tt0903747');
  });

  it('resolves TMDB ID to IMDb ID via TMDB addon', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      status: 200,
      data: { meta: { name: 'Dune: Part Two', year: '2024', imdb_id: 'tt15239678' } }
    } as any);

    const res = await CinemetaClient.resolveMediaInfo('movie', 'tmdb:693134');
    expect(res.title).toBe('Dune: Part Two');
    expect(res.year).toBe(2024);
    expect(res.resolvedImdb).toBe('tt15239678');
  });

  it('resolves Kitsu ID to title, year, and IMDb ID via anime-kitsu', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      status: 200,
      data: {
        meta: {
          name: 'Cyberpunk: Edgerunners',
          year: '2022',
          imdb_id: 'tt12590266'
        }
      }
    } as any);

    const res = await CinemetaClient.resolveMediaInfo('series', 'kitsu:50016');
    expect(res.title).toBe('Cyberpunk: Edgerunners');
    expect(res.year).toBe(2022);
    expect(res.resolvedImdb).toBe('tt12590266');
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
      'https://anime-kitsu.strem.fun/meta/series/kitsu%3A50016.json',
      { timeout: 4000 }
    );
  });
});
