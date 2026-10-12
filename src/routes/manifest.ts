import { Request, Response } from 'express';
import { StremioManifest } from '../types/stremio.js';
import { loadConfig } from '../config.js';

export const MANIFEST: StremioManifest = {
  id: 'org.stremio.stremlist',
  version: '0.1.0',
  name: 'StremList (115 / PikPak)',
  description: 'Seamless cloud offline streaming for Stremio via OpenList and torrent indexers',
  resources: [
    'stream',
    {
      name: 'subtitles',
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tmdb', 'kitsu'],
      extra: [
        { name: 'videoHash', isRequired: false },
        { name: 'videoSize', isRequired: false },
        { name: 'filename', isRequired: false }
      ]
    }
  ],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb', 'kitsu'],
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  }
};

export function handleManifest(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');

  const config = loadConfig(req.params.config);
  const manifest: StremioManifest = {
    ...MANIFEST,
    resources: [...MANIFEST.resources]
  };

  if (!config.subtitleEnabled) {
    manifest.resources = manifest.resources.filter(
      (r) => (typeof r === 'string' ? r : r.name) !== 'subtitles'
    );
  }

  return res.json(manifest);
}
