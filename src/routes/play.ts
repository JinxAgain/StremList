import { Request, Response } from 'express';
import { loadConfig } from '../config.js';
import { OpenListClient } from '../services/openlist/client.js';
import { PlaybackResolver } from '../services/openlist/resolver.js';
import { MatchTarget } from '../services/matcher/file-matcher.js';

export async function handlePlay(req: Request, res: Response) {
  const { hash: infoHash, config: configParam } = req.params;
  const { type = 'movie', id = '', fileIdx, season, episode, title } = req.query;

  if (!infoHash) {
    return res.status(400).send('Missing infoHash parameter');
  }

  const config = loadConfig(configParam);
  if (!config.openlistUrl) {
    return res.status(500).send('OpenList URL is not configured');
  }

  const client = new OpenListClient(config.openlistUrl, config.openlistToken);
  const resolver = new PlaybackResolver(client, config);

  // Parse season & episode from query or id (e.g., tt1234567:1:3)
  let parsedSeason: number | undefined = season ? parseInt(String(season), 10) : undefined;
  let parsedEpisode: number | undefined = episode ? parseInt(String(episode), 10) : undefined;

  if (type === 'series' && String(id).includes(':')) {
    const parts = String(id).split(':');
    if (parts.length >= 3) {
      if (parsedSeason === undefined) parsedSeason = parseInt(parts[1], 10);
      if (parsedEpisode === undefined) parsedEpisode = parseInt(parts[2], 10);
    }
  }

  const target: MatchTarget = {
    type: type === 'series' ? 'series' : 'movie',
    season: parsedSeason,
    episode: parsedEpisode,
    fileIdx: fileIdx !== undefined ? parseInt(String(fileIdx), 10) : undefined,
    title: title ? String(title) : undefined
  };

  console.log(`[Play] 🍿 Incoming playback request for infoHash: ${infoHash}`);
  console.log(`[Play]    Target: ${type} ${id ? `(${id})` : ''} | Season: ${target.season ?? 'N/A'}, Episode: ${target.episode ?? 'N/A'}, FileIdx: ${target.fileIdx ?? 'N/A'}`);

  let abortHandler: (() => void) | null = null;
  req.on('close', () => {
    if (abortHandler) {
      abortHandler();
    }
  });

  try {
    const playUrl = await resolver.resolvePlayUrl(
      infoHash,
      target,
      (fn) => {
        abortHandler = fn;
      }
    );

    console.log(`[Play] 🚀 Issuing 302 Redirect to OpenList raw_url`);
    return res.redirect(302, playUrl);
  } catch (error: any) {
    console.error(`[Play] ❌ Playback failed for ${infoHash}: ${error.message}`);
    if (error.message === 'OFFLINE_DOWNLOAD_TIMEOUT') {
      return res.status(504).send(
        'Offline download timed out (25s). The task has been queued in your cloud drive. Please retry in a few moments.'
      );
    }
    if (error.message === 'CLIENT_ABORTED') {
      return;
    }
    return res.status(502).send(`Error resolving playback stream: ${error.message}`);
  }
}
