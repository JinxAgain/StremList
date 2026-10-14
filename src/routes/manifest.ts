import { Request, Response } from 'express';
import { StremioManifest } from '../types/stremio.js';
import { loadConfig } from '../config.js';

export const MANIFEST: StremioManifest = {
  id: 'org.stremio.stremlist',
  version: '0.2.0',
  name: 'StremList (115 / PikPak)',
  description: 'Seamless cloud offline streaming for Stremio via OpenList and torrent indexers',
  logo: 'http://127.0.0.1:7000/logo.png',
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
  catalogs: [],
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
  const host = req.get('host') || `127.0.0.1:${config.port}`;
  const protocol = req.protocol || 'http';

  const manifest: StremioManifest = {
    ...MANIFEST,
    version: '0.2.0',
    logo: `${protocol}://${host}/logo.png`,
    resources: [...MANIFEST.resources]
  };

  if (!config.subtitleEnabled) {
    manifest.resources = manifest.resources.filter(
      (r) => (typeof r === 'string' ? r : r.name) !== 'subtitles'
    );
  }

  return res.json(manifest);
}
