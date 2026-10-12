import express, { Express } from 'express';
import cors from 'cors';
import { handleManifest } from './routes/manifest.js';
import { handleStream } from './routes/stream.js';
import { handlePlay } from './routes/play.js';
import { handleConfigure, handleOpenListLogin, handleOpenListTest, handleSaveConfig } from './routes/configure.js';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Request logger
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    });
    next();
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Addon Configuration UI & API
  app.get('/', (_req, res) => {
    res.redirect('/configure');
  });
  app.get('/configure', handleConfigure);
  app.post('/api/config/save', handleSaveConfig);
  app.post('/api/openlist/login', handleOpenListLogin);
  app.post('/api/openlist/test', handleOpenListTest);

  // Stremio Addon Protocol: Manifest
  app.get('/manifest.json', handleManifest);
  app.get('/:config/manifest.json', handleManifest);

  // Stremio Addon Protocol: Stream Resolver
  app.get('/stream/:type/:id', handleStream);
  app.get('/:config/stream/:type/:id', handleStream);

  // Playback & Cloud Redirection
  app.get('/play/:hash', handlePlay);
  app.get('/:config/play/:hash', handlePlay);

  return app;
}
