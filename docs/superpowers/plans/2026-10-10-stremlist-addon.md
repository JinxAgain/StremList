# StremList Addon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Stremio addon (StremList) in Node.js/TypeScript that aggregates torrent streams from Torrentio/Comet and automatically triggers offline download and direct streaming via OpenList (115 / PikPak) with 302 redirects.

**Architecture:** A lightweight Express HTTP server implementing Stremio's Addon protocol (`/manifest.json`, `/stream/:type/:id.json`), rewriting stream targets to a local `/play/:hash` endpoint. The play endpoint interacts with OpenList REST APIs to check cache, initiate offline tasks, poll for file readiness with client-abort detection, select the best video file, and issue an HTTP 302 redirect directly to OpenList's `raw_url`.

**Tech Stack:** Node.js (>= 18), TypeScript, Express, Axios, Vitest, dotenv.

**Spec:** [2026-10-10-stremlist-addon-design.md](file:///c:/Users/Barba/Documents/Git/StremList/docs/superpowers/specs/2026-10-10-stremlist-addon-design.md)

## Global Constraints

- Code and comments must be in English.
- Do not commit automatically to git; provide recommended English commit messages to the user.
- Stremio stream responses must conform to Stremio Addon Protocol v1.
- All OpenList API calls must handle error responses gracefully and never crash the process.
- Media traffic must never be proxied through the addon server; always return HTTP 302 Found to direct links.

## Review Focus

1. **Client player abort**: When a user closes or cancels Stremio playback during polling, the connection abort (`req.on('close')`) must immediately terminate the polling loop and release resources.
2. **Offline download timeout**: When a cloud drive does not finish offline caching within `pollTimeout` (default 25s), the server must return an HTTP 504 Gateway Timeout rather than hanging indefinitely.
3. **Empty / non-video torrent packages**: Torrents containing only archives, music, or samples (<100MB) must fail cleanly with HTTP 404 rather than attempting to stream an invalid file.
4. **Scraper failures**: If Torrentio or Comet times out (5s) or returns 5xx, the aggregator must gracefully continue with any available sources instead of failing the request.
5. **Config encoding fallback**: The addon must seamlessly support both root paths (`/manifest.json` using local `.env`) and encoded paths (`/:config/manifest.json` using URL configuration).

---

### Task 1: Project Scaffolding & Configuration Module

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `src/config.ts`
- Create: `src/types/stremio.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface AppConfig {
    port: number;
    openlistUrl: string;
    openlistToken: string;
    defaultDrive: '115' | 'pikpak';
    torrentioUrl: string;
    cometUrl: string;
    pollTimeout: number; // in seconds, default 25
    pollInterval: number; // in ms, default 1500
  }
  export function loadConfig(rawConfigStr?: string): AppConfig;
  export function encodeConfig(config: Partial<AppConfig>): string;
  ```

- [ ] **Step 1: Create package.json and tsconfig.json**
  Configure Node project with `express`, `cors`, `axios`, `dotenv`, `tsx`, `typescript`, `vitest`, and `@types/*`.

- [ ] **Step 2: Write failing tests for config parser in `tests/config.test.ts`**
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { loadConfig, encodeConfig } from '../src/config';

  describe('Config Module', () => {
    it('loads default config from env variables', () => {
      process.env.OPENLIST_URL = 'http://127.0.0.1:5244';
      process.env.OPENLIST_TOKEN = 'test-token';
      const config = loadConfig();
      expect(config.openlistUrl).toBe('http://127.0.0.1:5244');
      expect(config.defaultDrive).toBe('115');
      expect(config.pollTimeout).toBe(25);
    });

    it('decodes configuration string from URL path', () => {
      const encoded = encodeConfig({ defaultDrive: 'pikpak', openlistUrl: 'http://custom:5244' });
      const config = loadConfig(encoded);
      expect(config.defaultDrive).toBe('pikpak');
      expect(config.openlistUrl).toBe('http://custom:5244');
    });
  });
  ```

- [ ] **Step 3: Run test to verify it fails**
  Run: `npx vitest run tests/config.test.ts`
  Expected: FAIL (Cannot find module '../src/config')

- [ ] **Step 4: Implement `src/config.ts` and `src/types/stremio.ts`**
  Implement environment variable defaults, Base64/JSON encoding and decoding with fallback defaults.

- [ ] **Step 5: Run test to verify it passes**
  Run: `npx vitest run tests/config.test.ts`
  Expected: PASS

- [ ] **Step 6: Provide recommended git commit message**
  `chore: setup project scaffolding and configuration module`

---

### Task 2: File Matcher Service (TDD)

**Files:**
- Create: `src/services/matcher/file-matcher.ts`
- Test: `tests/file-matcher.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface FileItem {
    name: string;
    size: number;
    is_dir: boolean;
  }
  export interface MatchTarget {
    type: 'movie' | 'series';
    season?: number;
    episode?: number;
    fileIdx?: number;
  }
  export function matchPlayableFile(files: FileItem[], target: MatchTarget): FileItem | null;
  ```

- [ ] **Step 1: Write failing test in `tests/file-matcher.test.ts`**
  Test selecting largest video file for movies, excluding samples (<100MB), and matching `S01E03` / `1x03` for series.
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { matchPlayableFile } from '../src/services/matcher/file-matcher';

  describe('File Matcher', () => {
    it('selects the largest video file for movies and ignores samples', () => {
      const files = [
        { name: 'sample.mkv', size: 50 * 1024 * 1024, is_dir: false },
        { name: 'feature.nfo', size: 1024, is_dir: false },
        { name: 'Inception.2010.1080p.mkv', size: 12 * 1024 * 1024 * 1024, is_dir: false }
      ];
      const match = matchPlayableFile(files, { type: 'movie' });
      expect(match?.name).toBe('Inception.2010.1080p.mkv');
    });

    it('matches target season and episode for series', () => {
      const files = [
        { name: 'Breaking.Bad.S01E01.720p.mkv', size: 1024 * 1024 * 1024, is_dir: false },
        { name: 'Breaking.Bad.S01E02.720p.mkv', size: 1024 * 1024 * 1024, is_dir: false },
        { name: 'Breaking.Bad.S01E03.720p.mkv', size: 1024 * 1024 * 1024, is_dir: false }
      ];
      const match = matchPlayableFile(files, { type: 'series', season: 1, episode: 2 });
      expect(match?.name).toBe('Breaking.Bad.S01E02.720p.mkv');
    });

    it('returns null if no video files found or only non-video files present', () => {
      const files = [
        { name: 'audio.mp3', size: 10 * 1024 * 1024, is_dir: false },
        { name: 'readme.txt', size: 2048, is_dir: false }
      ];
      expect(matchPlayableFile(files, { type: 'movie' })).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/file-matcher.test.ts`
  Expected: FAIL (Cannot find module '../src/services/matcher/file-matcher')

- [ ] **Step 3: Implement `src/services/matcher/file-matcher.ts`**
  Implement video extension filtering, sample rejection (< 100MB or `sample` keyword), movie size comparison, and regex parsing for `SxxExx` / `1x01` / `EP01`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/file-matcher.test.ts`
  Expected: PASS

- [ ] **Step 5: Provide recommended git commit message**
  `feat: implement smart video file matcher for movies and series`

---

### Task 3: Torrent Scrapers & Aggregator (TDD)

**Files:**
- Create: `src/types/scraper.ts`
- Create: `src/services/scraper/torrentio.ts`
- Create: `src/services/scraper/comet.ts`
- Create: `src/services/scraper/aggregator.ts`
- Test: `tests/aggregator.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface ScrapedStream {
    infoHash: string;
    name: string;
    title: string;
    fileIdx?: number;
    seeders?: number;
    resolution?: string;
  }
  export class ScraperAggregator {
    constructor(private torrentioUrl: string, private cometUrl: string) {}
    async fetchStreams(type: string, id: string, baseUrl: string, configPath?: string): Promise<StremioStream[]>;
  }
  ```

- [ ] **Step 1: Write failing test in `tests/aggregator.test.ts`**
  Test deduplication by infoHash, rewriting URLs to target `/play/:hash` endpoint with query parameters.
  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import { ScraperAggregator } from '../src/services/scraper/aggregator';

  describe('Scraper Aggregator', () => {
    it('deduplicates streams by infoHash and rewrites stream URLs', async () => {
      const aggregator = new ScraperAggregator('https://torrentio.strem.fun', 'https://comet.test');
      // Mock internal fetchers
      vi.spyOn(aggregator as any, 'fetchTorrentio').mockResolvedValue([
        { infoHash: 'abc1234567890123456789012345678901234567', title: 'Movie 1080p', name: 'Torrentio' }
      ]);
      vi.spyOn(aggregator as any, 'fetchComet').mockResolvedValue([
        { infoHash: 'abc1234567890123456789012345678901234567', title: 'Movie 1080p Better', name: 'Comet' }
      ]);

      const streams = await aggregator.fetchStreams('movie', 'tt1234567', 'http://127.0.0.1:7000');
      expect(streams).toHaveLength(1);
      expect(streams[0].url).toContain('http://127.0.0.1:7000/play/abc1234567890123456789012345678901234567');
      expect(streams[0].name).toContain('StremList');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/aggregator.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implement `src/services/scraper/*.ts`**
  Implement Torrentio and Comet scrapers querying `/stream/:type/:id.json`, parsing `infoHash` and metadata, with `Promise.allSettled`, 5-second timeouts, deduplication, and URL rewriting.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/aggregator.test.ts`
  Expected: PASS

- [ ] **Step 5: Provide recommended git commit message**
  `feat: add Torrentio and Comet scrapers with stream aggregator and deduplication`

---

### Task 4: OpenList Client & Playback Resolver (TDD)

**Files:**
- Create: `src/types/openlist.ts`
- Create: `src/services/openlist/client.ts`
- Create: `src/services/openlist/resolver.ts`
- Test: `tests/openlist.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export class OpenListClient {
    constructor(private baseUrl: string, private token: string) {}
    async list(path: string, refresh?: boolean): Promise<{ content?: FileItem[] }>;
    async addOfflineDownload(path: string, urls: string[], tool?: string): Promise<boolean>;
    async getRawUrl(path: string): Promise<string | null>;
  }
  export class PlaybackResolver {
    constructor(private client: OpenListClient, private config: AppConfig) {}
    async resolvePlayUrl(
      infoHash: string,
      target: MatchTarget,
      onAbort?: (abortHandler: () => void) => void
    ): Promise<string>;
  }
  ```

- [ ] **Step 1: Write failing test in `tests/openlist.test.ts`**
  Test cache hit skipping offline creation, cache miss creating offline task, polling until file ready, and abortion cleanup.
  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import { OpenListClient } from '../src/services/openlist/client';
  import { PlaybackResolver } from '../src/services/openlist/resolver';

  describe('Playback Resolver', () => {
    it('returns direct link immediately if file already cached', async () => {
      const client = new OpenListClient('http://127.0.0.1:5244', 'token');
      vi.spyOn(client, 'list').mockResolvedValue({
        content: [{ name: 'Movie.2024.1080p.mkv', size: 10 * 1024 * 1024 * 1024, is_dir: false }]
      });
      vi.spyOn(client, 'getRawUrl').mockResolvedValue('https://115.com/download/direct.mkv');

      const resolver = new PlaybackResolver(client, {
        port: 7000,
        openlistUrl: 'http://127.0.0.1:5244',
        openlistToken: 'token',
        defaultDrive: '115',
        torrentioUrl: '',
        cometUrl: '',
        pollTimeout: 5,
        pollInterval: 100
      });

      const url = await resolver.resolvePlayUrl('hash123', { type: 'movie' });
      expect(url).toBe('https://115.com/download/direct.mkv');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/openlist.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implement `src/services/openlist/client.ts` and `resolver.ts`**
  Implement OpenList API calls, cache check on default drive then fallback drive, `addOfflineDownload` with magnet link, polling loop with timeout, and `AbortController` cancellation.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/openlist.test.ts`
  Expected: PASS

- [ ] **Step 5: Provide recommended git commit message**
  `feat: implement OpenList API client and playback resolver with polling and abortion support`

---

### Task 5: HTTP Server, Stremio Routes & Configure UI

**Files:**
- Create: `src/routes/manifest.ts`
- Create: `src/routes/stream.ts`
- Create: `src/routes/play.ts`
- Create: `src/routes/configure.ts`
- Create: `src/public/configure.html`
- Create: `src/app.ts`
- Create: `src/index.ts`
- Test: `tests/routes.test.ts`

**Interfaces:**
- Produces:
  Express application with routes:
  - `GET /manifest.json` and `GET /:config/manifest.json`
  - `GET /stream/:type/:id.json` and `GET /:config/stream/:type/:id.json`
  - `GET /play/:hash` and `GET /:config/play/:hash`
  - `GET /configure`
  - `GET /health`

- [ ] **Step 1: Write failing test in `tests/routes.test.ts`**
  ```typescript
  import { describe, it, expect } from 'vitest';
  import request from 'supertest';
  import { createApp } from '../src/app';

  describe('Express Routes', () => {
    const app = createApp();

    it('returns manifest with correct addon metadata', async () => {
      const res = await request(app).get('/manifest.json');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('org.stremio.stremlist');
      expect(res.body.resources).toContain('stream');
    });

    it('returns configure page HTML', async () => {
      const res = await request(app).get('/configure');
      expect(res.status).toBe(200);
      expect(res.text).toContain('StremList Configuration');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/routes.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implement routes, configure page, and Express app**
  - Implement `src/routes/manifest.ts` for Stremio manifest format.
  - Implement `src/routes/stream.ts` calling `ScraperAggregator`.
  - Implement `src/routes/play.ts` calling `PlaybackResolver`, handling `302 Found`, `504 Timeout`, and `req.on('close')`.
  - Implement `src/public/configure.html` and `src/routes/configure.ts` for setup page.
  - Implement `src/app.ts` and `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/routes.test.ts`
  Expected: PASS

- [ ] **Step 5: Provide recommended git commit message**
  `feat: add Express server with Stremio protocol routes and web configuration UI`

---

### Task 6: End-to-End Verification & Documentation

**Files:**
- Create: `README.md`
- Create: `tests/e2e.test.ts`

- [ ] **Step 1: Write E2E test verifying full flow integration**
  Verify `/manifest.json`, `/stream/movie/:id.json` URL rewrites, and mock `/play/:hash` 302 redirection.

- [ ] **Step 2: Run all tests in repository**
  Run: `npx vitest run`
  Expected: All test suites PASS

- [ ] **Step 3: Create README.md**
  Document project overview, prerequisites (Node.js, OpenList setup), quick start with `.env`, Web `/configure` installation, and Stremio desktop usage instructions.

- [ ] **Step 4: Provide recommended git commit message**
  `docs: add setup guide and end-to-end integration verification`
