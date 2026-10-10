import { Request, Response } from 'express';
import { loadConfig } from '../config.js';
import { ScraperAggregator } from '../services/scraper/aggregator.js';

export async function handleStream(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const { type, id: rawId, config: configParam } = req.params;
    const cleanId = (rawId || '').replace(/\.json$/, '');

    if (!cleanId || !type) {
      return res.json({ streams: [] });
    }

    const config = loadConfig(configParam);
    const aggregator = new ScraperAggregator(config.torrentioUrl, config.cometUrl);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host') || `127.0.0.1:${config.port}`;
    const baseUrl = `${protocol}://${host}`;

    console.log(`[Stream] 🎬 Stream discovery request for ${type}: "${cleanId}"`);
    const streams = await aggregator.fetchStreams(type, cleanId, baseUrl, configParam);
    console.log(`[Stream] ✅ Aggregated ${streams.length} unique streams for "${cleanId}"`);

    return res.json({ streams });
  } catch (error) {
    return res.json({ streams: [] });
  }
}
