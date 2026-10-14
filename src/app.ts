import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { handleManifest } from './routes/manifest.js';
import { handleStream } from './routes/stream.js';
import { handlePlay } from './routes/play.js';
import { handleConfigure, handleOpenListLogin, handleOpenListTest, handleSaveConfig } from './routes/configure.js';
import { subtitlesRouter } from './routes/subtitles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPublicDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'src/public'),
    path.resolve(process.cwd(), 'dist/public'),
    path.resolve(__dirname, '../public'),
    path.resolve(__dirname, '../../src/public')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

export function createApp(): Express {
  const app = express();

  // Sanitize newlines (%0A, \r, \n) in request path for Harbor client compatibility
  app.use((req, _res, next) => {
    if (req.url && (req.url.includes('%0A') || req.url.includes('%0D') || req.url.includes('\n') || req.url.includes('\r'))) {
      req.url = req.url
        .replace(/(%0D%0A|%0A|%0D|\r\n|\n|\r)/gi, ' ')
        .replace(/\s+/g, ' ');
    }
    next();
  });

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

  // Static assets (Logo, Favicon, etc.)
  const publicDir = getPublicDir();
  app.use(express.static(publicDir));
  app.get(['/logo.png', '/logo.jpg', '/favicon.ico'], (req, res) => {
    const filename = req.path.endsWith('.ico') ? 'logo.png' : path.basename(req.path);
    const candidates = [
      path.join(publicDir, filename),
      path.join(publicDir, 'logo.png'),
      path.join(publicDir, 'logo.jpg'),
      path.resolve(process.cwd(), 'src/public', filename),
      path.resolve(process.cwd(), 'dist/public', filename)
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Content-Type', 'image/png');
        return res.sendFile(p);
      }
    }
    return res.status(404).end();
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

  // Stremio Subtitles Addon Protocol
  app.use(subtitlesRouter);

  return app;
}
