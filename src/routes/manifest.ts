import { Request, Response } from 'express';
import { StremioManifest } from '../types/stremio.js';

export const MANIFEST: StremioManifest = {
  id: 'org.stremio.stremlist',
  version: '0.1.0',
  name: 'StremList (115 / PikPak)',
  description: 'Seamless cloud offline streaming for Stremio via OpenList and torrent indexers',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  }
};

export function handleManifest(_req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  return res.json(MANIFEST);
}
