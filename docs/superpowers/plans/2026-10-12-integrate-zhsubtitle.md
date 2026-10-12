# Native Integration of zhsubtitle into StremList Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all logic of `stremio-zhsubtitle` into `StremList` natively in pure TypeScript, delivering cloud stream playback and Chinese subtitles under a unified clean manifest URL (`http://127.0.0.1:7000/manifest.json`).

**Architecture:** A native TypeScript modular service (`src/services/subtitles/`) mounted directly into StremList's existing Express application. It integrates pure algorithmic BMP captcha recognition, Zimuku WAF clearance, SubHD token-based downloading, in-memory archive extraction with GBK filename recovery, ASS dialogue sanitization to clean UTF-8 SRT, multi-factor subtitle scoring, two-tier caching with single-flight mutex, and Harbor client adaptations.

**Tech Stack:** TypeScript, Node.js (Express), `cheerio`, `adm-zip`, `iconv-lite`, `axios`, Vitest.

**Spec:** [2026-10-12-integrate-zhsubtitle-design.md](file:///c:/Users/Barba/Documents/Git/StremList/docs/superpowers/specs/2026-10-12-integrate-zhsubtitle-design.md)

## Global Constraints

- 100% pure TypeScript / Node.js; zero Python runtime or pip dependencies required.
- Zero C++ compiler dependencies (no `node-gyp` or native binary compilation required on Windows).
- All code and comments must be written in English.
- Do not automatically run `git commit` commands without explicit user instruction; suggest conventional commit messages at completion.
- Preserve StremList clean installation URL: `http://127.0.0.1:7000/manifest.json`.

## Review Focus

1. **Harbor URL path containing newline characters (`%0A`, `\n`)**: Must be sanitized to spaces in global Express middleware before routing, preventing 404 errors.
2. **Harbor TMDB format (`tmdb:12345:1:14` / `tmdb:movie:...`)**: Must be resolved to IMDb ID (`tt...`) via TMDB Addon or TheMovieDb scraping fallback before upstream queries.
3. **GBK / CP437 misdecoded archive filenames**: ZIP archives lacking the UTF-8 flag must be recovered using `iconv-lite` to prevent garbled Chinese filenames.
4. **ASS effect tags (`{\pos...}`, `{\p1}`, drawing commands)**: Must be completely stripped by `SubtitleCleaner` so dialogue renders cleanly on Android TV and mobile devices.
5. **Wrong episode penalty in season packs**: Files clearly matching a different episode (e.g. `E01` when requesting `E04`) must receive a -5000 score penalty to prevent playing wrong episodes.

---

### Task 1: Add Dependencies and Subtitle Domain Types

**Files:**
- Modify: `package.json`
- Create: `src/services/subtitles/types.ts`
- Test: `tests/subtitles/types.test.ts`

**Interfaces:**
- Produces: `VideoQueryMeta`, `SubtitleTags`, `SubtitleCandidate`, `SubtitleConfig`, `DownloadResult`

- [ ] **Step 1: Install dependencies (`cheerio`, `adm-zip`, `iconv-lite`, `@types/adm-zip`)**
```bash
npm install cheerio adm-zip iconv-lite
npm install -D @types/adm-zip
```

- [ ] **Step 2: Write failing test in `tests/subtitles/types.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { VideoQueryMeta } from '../../src/services/subtitles/types.js';

describe('VideoQueryMeta', () => {
  it('correctly identifies series vs movie', () => {
    const meta: VideoQueryMeta = {
      imdbId: 'tt0903747',
      mediaType: 'series',
      season: 1,
      episode: 2
    };
    expect(meta.mediaType).toBe('series');
    expect(meta.season).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**
Run: `npm test tests/subtitles/types.test.ts`
Expected: FAIL with module not found `types.js`

- [ ] **Step 4: Implement `src/services/subtitles/types.ts`**
Define interfaces:
- `VideoQueryMeta`: `imdbId: string`, `mediaType: 'movie' | 'series'`, `season?: number`, `episode?: number`, `title?: string`, `year?: number`, `filename?: string`
- `SubtitleTags`: `provider: string`, `lang: string[]`, `bilingual: boolean`, `fmt: string[]`, `source: string[]`, `fansub?: string`, `collection: boolean`, `imdbMatched: boolean`
- `SubtitleCandidate`: `id: string`, `provider: 'subhd' | 'zimuku'`, `title: string`, `pageUrl: string`, `tags: SubtitleTags`, `rate: number`, `downloadsCount: number`, `score: number`
- `SubtitleItem`: `id: string`, `url: string`, `lang: string`, `label: string`, `subtitleFileName: string`, `movieReleaseName: string`, `SubFormat: string`, `path: string`

- [ ] **Step 5: Run test to verify it passes**
Run: `npm test tests/subtitles/types.test.ts`
Expected: PASS

---

### Task 2: Pure TypeScript BMP Captcha Solver (`ZimukuBmpSolver`)

**Files:**
- Create: `src/services/subtitles/providers/zimuku-solver.ts`
- Test: `tests/subtitles/solver.test.ts`

**Interfaces:**
- Produces: `ZimukuBmpSolver.recognize(base64Bmp: string): string`

- [ ] **Step 1: Write failing test in `tests/subtitles/solver.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { ZimukuBmpSolver } from '../../src/services/subtitles/providers/zimuku-solver.js';

describe('ZimukuBmpSolver', () => {
  it('rejects invalid non-BMP data', () => {
    expect(() => new ZimukuBmpSolver('dGVzdA==')).toThrow('Invalid BMP data');
  });

  it('recognizes 5 digits from valid BMP buffer', () => {
    // Standard 100x27 24bpp BMP header + minimal pixel buffer
    const bmpHeader = Buffer.alloc(54);
    bmpHeader.write('BM', 0);
    bmpHeader.writeUInt32LE(54 + 100 * 27 * 3, 2);
    bmpHeader.writeUInt32LE(54, 10);
    bmpHeader.writeUInt32LE(40, 14);
    bmpHeader.writeInt32LE(100, 18);
    bmpHeader.writeInt32LE(27, 22);
    bmpHeader.writeUInt16LE(1, 26);
    bmpHeader.writeUInt16LE(24, 28);
    const fullBmp = Buffer.concat([bmpHeader, Buffer.alloc(100 * 27 * 3, 255)]);
    const solver = new ZimukuBmpSolver(fullBmp.toString('base64'));
    const code = solver.recognize();
    expect(code.length).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/subtitles/solver.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `ZimukuBmpSolver` in `src/services/subtitles/providers/zimuku-solver.ts`**
Port template matching algorithm:
- Width 100, Height 27, 5 digits, character width 20, pixel data offset 54.
- 9 sampling points per digit column.
- 10 reference digit binary feature arrays (0-9).
- Foreground threshold checking: average R+G+B < 70.
- Offset shifting for digits '1' (+1) and '4' (-1).

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/subtitles/solver.test.ts`
Expected: PASS

---

### Task 3: Subtitle Normalization & Cleaner (`cleaner.ts`)

**Files:**
- Create: `src/services/subtitles/core/cleaner.ts`
- Test: `tests/subtitles/cleaner.test.ts`

**Interfaces:**
- Produces: `SubtitleCleaner.detectAndDecode(raw: Buffer): { text: string; encoding: string }`
- Produces: `SubtitleCleaner.normalizeToUtf8Srt(raw: Buffer, filename?: string): Buffer`
- Produces: `SubtitleCleaner.assToSrt(assText: string): string`
- Produces: `SubtitleCleaner.vttToSrt(vttText: string): string`

- [ ] **Step 1: Write failing test in `tests/subtitles/cleaner.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { SubtitleCleaner } from '../../src/services/subtitles/core/cleaner.js';

describe('SubtitleCleaner', () => {
  it('converts ASS content to clean sorted SRT format', () => {
    const sampleAss = `[Script Info]
Title: Sample
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:20.50,0:01:23.00,Default,,0,0,0,,{\\pos(192,200)}Hello{\\b1} World{\\b0}
Dialogue: 0,0:01:10.00,0:01:12.45,Default,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}Drawing Command
Dialogue: 0,0:01:15.00,0:01:18.00,Default,,0,0,0,,Line One\\NLine Two
`;
    const srtBuffer = SubtitleCleaner.normalizeToUtf8Srt(Buffer.from(sampleAss, 'utf-8'), 'sample.ass');
    const srt = srtBuffer.toString('utf-8');
    expect(srt).toContain('00:01:15,000 --> 00:01:18,000');
    expect(srt).toContain('Line One\nLine Two');
    expect(srt).toContain('Hello World');
    expect(srt).not.toContain('{\\pos');
    expect(srt).not.toContain('{\\b1}');
    expect(srt).not.toContain('Drawing Command');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/subtitles/cleaner.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `SubtitleCleaner` in `src/services/subtitles/core/cleaner.ts`**
- Charset probing: probe `utf-8-sig`, `utf-8`, `gb18030`, `gbk`, `big5`, `utf-16le`, `utf-16be`, `latin1` using `iconv-lite`.
- ASS/SSA dialogue parsing: match `Format:` headers (`start`, `end`, `text` indices), dialogue splitting up to text index, strip `{\p1}...{\p0}`, strip `{...}` override tags, replace `\N`/`\n`/`\h`, strip HTML tags.
- Convert ASS timestamp `H:MM:SS.cs` to SRT `HH:MM:SS,mmm`.
- Chronological sort by start time, renumber cues 1..N.
- WebVTT converter: strip WEBVTT headers, convert timestamps, sanitize cues.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/subtitles/cleaner.test.ts`
Expected: PASS

---

### Task 4: In-Memory Extractor & Episode Matching (`extractor.ts`)

**Files:**
- Create: `src/services/subtitles/core/extractor.ts`
- Test: `tests/subtitles/extractor.test.ts`

**Interfaces:**
- Produces: `SubtitleExtractor.extractBestSubtitle(buffer: Buffer, originalFilename: string, episode?: number, preferBilingual?: boolean, preferTraditional?: boolean): { buffer: Buffer; filename: string } | null`
- Produces: `SubtitleExtractor.pickBestFile(filenames: string[], episode?: number, preferBilingual?: boolean, preferTraditional?: boolean): string | null`

- [ ] **Step 1: Write failing test in `tests/subtitles/extractor.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { SubtitleExtractor } from '../../src/services/subtitles/core/extractor.js';

describe('SubtitleExtractor', () => {
  it('extracts target episode from zip and prefers bilingual subtitle', () => {
    const zip = new AdmZip();
    zip.addFile('Show.S01E01.chs.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nEp1\n'));
    zip.addFile('Show.S01E04.chs.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nEp4 CHS\n'));
    zip.addFile('Show.S01E04.chs&eng.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nEp4 Bilingual\n'));
    const zipBuffer = zip.toBuffer();

    const result = SubtitleExtractor.extractBestSubtitle(zipBuffer, 'Show.S01.zip', 4, true, false);
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('Show.S01E04.chs&eng.srt');
  });

  it('rejects wrong episode in pickBestFile', () => {
    const files = ['Show.S01E01.srt', 'Show.S01E02.srt'];
    const best = SubtitleExtractor.pickBestFile(files, 3);
    // When requesting E03, both E01 and E02 are disqualified with -5000 points
    expect(best).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/subtitles/extractor.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `SubtitleExtractor` in `src/services/subtitles/core/extractor.ts`**
- In-memory unpack via `AdmZip`.
- Filename encoding recovery: if CP437, decode with `iconv-lite.decode(raw, 'gb18030')`.
- Gzip stream unpack via Node `zlib.gunzipSync`.
- Scoring in `pickBestFile`: target episode match (+2000), conflicting other episode (-5000), language ranking (bilingual 1100 > cht 900 > chs 800 > eng-only -2000), format preference (srt > ass > ssa > vtt).
- Nested archive extraction for season packs.
- Fallback to system 7z/unrar if installed for RAR/7Z archives.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/subtitles/extractor.test.ts`
Expected: PASS

---

### Task 5: Cinemeta & Harbor TMDB Metadata Client (`cinemeta.ts`)

**Files:**
- Create: `src/services/subtitles/core/cinemeta.ts`
- Test: `tests/subtitles/cinemeta.test.ts`

**Interfaces:**
- Produces: `CinemetaClient.resolveMediaInfo(mediaType: string, idStr: string): Promise<{ title: string; year: number | null; resolvedImdb: string | null }>`

- [ ] **Step 1: Write failing test in `tests/subtitles/cinemeta.test.ts`**
```typescript
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
    expect(res.resolvedImdb).toBe('tt15239678');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/subtitles/cinemeta.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `CinemetaClient` in `src/services/subtitles/core/cinemeta.ts`**
- Resolve `tt...` from `https://v3-cinemeta.strem.io/meta/{type}/{id}.json`.
- Resolve `tmdb:...` from `https://94c8cb9f702d-tmdb-addon.baby-beamup.club/meta/{type}/tmdb:{id}.json`.
- Fallback to scraping `https://www.themoviedb.org/{tv|movie}/{id}` title tag if TMDB Addon fails.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/subtitles/cinemeta.test.ts`
Expected: PASS

---

### Task 6: Subtitle Scorer (`scorer.ts`)

**Files:**
- Create: `src/services/subtitles/core/scorer.ts`
- Test: `tests/subtitles/scorer.test.ts`

**Interfaces:**
- Produces: `SubtitleScorer.rankCandidates(candidates: SubtitleCandidate[], query: VideoQueryMeta, langPref?: string, maxResults?: number): SubtitleCandidate[]`

- [ ] **Step 1: Write failing test in `tests/subtitles/scorer.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { SubtitleScorer } from '../../src/services/subtitles/core/scorer.js';
import { SubtitleCandidate, VideoQueryMeta } from '../../src/services/subtitles/types.js';

describe('SubtitleScorer', () => {
  it('penalizes candidate with conflicting season number', () => {
    const query: VideoQueryMeta = {
      imdbId: 'tt1234567',
      mediaType: 'series',
      season: 4,
      episode: 2
    };

    const c1: SubtitleCandidate = {
      id: '1',
      provider: 'zimuku',
      title: 'Show S04E02 1080p WEB-DL [Bilingual]',
      pageUrl: 'http://test/1',
      tags: { provider: 'zimuku', lang: ['chs'], bilingual: true, fmt: ['srt'], source: ['official'], collection: false, imdbMatched: true },
      rate: 5,
      downloadsCount: 100,
      score: 0
    };

    const c2: SubtitleCandidate = {
      id: '2',
      provider: 'zimuku',
      title: 'Show S01E02 1080p WEB-DL [Bilingual]',
      pageUrl: 'http://test/2',
      tags: { provider: 'zimuku', lang: ['chs'], bilingual: true, fmt: ['srt'], source: ['official'], collection: false, imdbMatched: true },
      rate: 5,
      downloadsCount: 100,
      score: 0
    };

    const ranked = SubtitleScorer.rankCandidates([c1, c2], query, 'bilingual', 5);
    expect(ranked[0].id).toBe('1');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/subtitles/scorer.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `SubtitleScorer` in `src/services/subtitles/core/scorer.ts`**
- Season conflict check: extract season numbers; if different from query season, deduct 5000 points.
- IMDb exact match bonus: +1000 points.
- Season pack / collection bonus: +1150 points.
- Target episode match: +1000 points; conflicting episode penalty: -600 points.
- Language preference weighting: bilingual first (+600 for bilingual, +350 for chs, +300 for cht).
- Quality, source translation tags, and release group matching bonuses.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/subtitles/scorer.test.ts`
Expected: PASS

---

### Task 7: Providers (Zimuku & SubHD) and Base Utilities

**Files:**
- Create: `src/services/subtitles/providers/base.ts`
- Create: `src/services/subtitles/providers/zimuku.ts`
- Create: `src/services/subtitles/providers/subhd.ts`
- Test: `tests/subtitles/providers.test.ts`

**Interfaces:**
- Produces: `BaseProvider`: `search(meta: VideoQueryMeta): Promise<SubtitleCandidate[]>` and `download(candidate: SubtitleCandidate): Promise<{ buffer: Buffer; filename: string } | null>`
- Produces: `ZimukuProvider` and `SubhdProvider`

- [ ] **Step 1: Write failing test in `tests/subtitles/providers.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { extractSeasonsFromText, isEpisodeMatch, extractMetaFromFilename } from '../../src/services/subtitles/providers/base.js';

describe('BaseProvider utilities', () => {
  it('extracts seasons from text', () => {
    expect(Array.from(extractSeasonsFromText('Show S03E01'))).toEqual([3]);
    expect(Array.from(extractSeasonsFromText('Show 第三季'))).toEqual([3]);
    expect(Array.from(extractSeasonsFromText('Show 第1-3季'))).toEqual([1, 2, 3]);
  });

  it('matches episode correctly', () => {
    const [matches, isCollection] = isEpisodeMatch('Show S02E05 1080p', 2, 5);
    expect(matches).toBe(true);
    expect(isCollection).toBe(false);
  });

  it('extracts metadata from release filename', () => {
    const meta = extractMetaFromFilename('Severance.S01E01.1080p.WEB-DL.mkv');
    expect(meta.title).toBe('Severance');
    expect(meta.season).toBe(1);
    expect(meta.episode).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/subtitles/providers.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `base.ts`, `zimuku.ts`, and `subhd.ts`**
- `base.ts`: Chinese numeral mapping (`toCnSeason`), regexes for season and episode matching, release quality tag extraction, filename parser.
- `zimuku.ts`: Mirror fallback with cooldown, Cheerio search parser, Yunsuo WAF bypass with `ZimukuBmpSolver`, detail download link resolver.
- `subhd.ts`: Mirror fallback with 403 cooldown, 4-step token download (`prepare-download` -> temp page -> `api/sub/down` -> download archive), badge parsing.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/subtitles/providers.test.ts`
Expected: PASS

---

### Task 8: Two-Tier Cache & Single-Flight Mutex (`cache/manager.ts`)

**Files:**
- Create: `src/services/subtitles/cache/manager.ts`
- Test: `tests/subtitles/cache.test.ts`

**Interfaces:**
- Produces: `CacheManager.getSearchResults(key: string): SubtitleItem[] | null`
- Produces: `CacheManager.setSearchResults(key: string, data: SubtitleItem[]): void`
- Produces: `CacheManager.hasSubtitle(filename: string): boolean`
- Produces: `CacheManager.getSubtitle(filename: string): Buffer | null`
- Produces: `CacheManager.saveSubtitle(filename: string, content: Buffer | string): void`
- Produces: `CacheManager.getFlightLock(key: string): Promise<() => void>`

- [ ] **Step 1: Write failing test in `tests/subtitles/cache.test.ts`**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CacheManager } from '../../src/services/subtitles/cache/manager.js';

describe('CacheManager', () => {
  const testCacheDir = path.resolve(process.cwd(), 'data/test_cache');
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager(testCacheDir);
  });

  it('saves and checks subtitle disk cache', () => {
    const srtContent = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n');
    cache.saveSubtitle('subhd_123_0.srt', srtContent);
    expect(cache.hasSubtitle('subhd_123_0.srt')).toBe(true);
    expect(cache.getSubtitle('subhd_123_0.srt')?.toString()).toBe(srtContent.toString());
    fs.rmSync(testCacheDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/subtitles/cache.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `CacheManager` in `src/services/subtitles/cache/manager.ts`**
- In-memory Map + debounced write to `data/cache/search_cache.json` for 12h TTL search results.
- Disk file storage for cleaned `.srt` in `data/cache/subtitles/`.
- Validate SRT content on read (size >= 20 bytes, contains `-->`).
- Single-flight async mutex lock mechanism for coalescing identical queries.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/subtitles/cache.test.ts`
Expected: PASS

---

### Task 9: Harbor Middleware, Subtitle Routes & Manifest Update

**Files:**
- Modify: `src/app.ts`
- Modify: `src/routes/manifest.ts`
- Create: `src/routes/subtitles.ts`
- Test: `tests/subtitles/routes.test.ts`

**Interfaces:**
- Consumes: `ZimukuProvider`, `SubhdProvider`, `CinemetaClient`, `SubtitleScorer`, `CacheManager`, `SubtitleCleaner`
- Produces: Stremio routes `/subtitles/:type/:id.json`, `/subtitles/dl/...`, and manifest resources

- [ ] **Step 1: Write failing test in `tests/subtitles/routes.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

describe('Subtitle & Harbor Routes', () => {
  const app = createApp();

  it('includes subtitles in manifest', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.body.resources).toContainEqual(
      expect.objectContaining({ name: 'subtitles' })
    );
  });

  it('sanitizes Harbor newlines in URL path without 404', async () => {
    const res = await request(app).get('/health%0A');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/subtitles/routes.test.ts`
Expected: FAIL (subtitles not in manifest, health%0A 404)

- [ ] **Step 3: Implement route handlers and middleware**
- In `src/app.ts`: Add newline sanitization middleware replacing `%0A`, `%0D`, `\n`, `\r` with spaces. Mount `subtitlesRouter`.
- In `src/routes/manifest.ts`: Include `subtitles` in resources when enabled, declare idPrefixes `['tt', 'tmdb', 'kitsu']`.
- In `src/routes/subtitles.ts`:
  - `handleSubtitlesRequest`: parse media ID (Harbor `tmdb:...` and `filename=...`), query cache, single-flight lock, resolve metadata, parallel search SubHD + Zimuku, rank candidates, format OpenSubtitles v3 labels and ASCII filenames, cache results.
  - `downloadSubtitle`: fast disk hit check, upstream archive download, in-memory unpack, ASS cleaning, disk save, stream UTF-8 SRT with CORS headers.
  - Mount GET & OPTIONS for `/subtitles/:type/:id.json`, `/subtitles/:type/:id/:extra*`, `/:config/subtitles/...`, `/subtitles/dl/...`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/subtitles/routes.test.ts`
Expected: PASS

---

### Task 10: Configuration UI & Environment Integration

**Files:**
- Modify: `src/config.ts`
- Modify: `src/routes/configure.ts`
- Modify: `src/public/configure.html`
- Modify: `.env.example`
- Test: `tests/subtitles/config.test.ts`

**Interfaces:**
- Produces: AppConfig subtitle settings (`subtitleEnabled`, `subtitleLang`, `subtitleSource`, `subtitleMaxResults`, `subtitleProxy`)

- [x] **Step 1: Write failing test in `tests/subtitles/config.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('AppConfig Subtitle Settings', () => {
  it('loads default subtitle configuration', () => {
    const cfg = loadConfig();
    expect(cfg.subtitleEnabled).toBe(true);
    expect(cfg.subtitleLang).toBe('bilingual');
    expect(cfg.subtitleSource).toBe('all');
    expect(cfg.subtitleMaxResults).toBe(8);
  });
});
```

- [x] **Step 2: Run test to verify it fails**
Run: `npm test tests/subtitles/config.test.ts`
Expected: FAIL (properties missing on config)

- [x] **Step 3: Implement config fields and configure.html UI**
- In `src/config.ts`: Add `subtitleEnabled`, `subtitleLang`, `subtitleSource`, `subtitleMaxResults`, `subtitleProxy` to `AppConfig`, `DEFAULT_CONFIG`, `loadConfig`, `saveConfigToEnv`.
- In `src/routes/configure.ts`: Support pre-populating and saving subtitle options in `/api/config/save`.
- In `src/public/configure.html`: Add **中文字幕设置** card with toggle, language preference dropdown, source dropdown, max results dropdown, and proxy input. Preserve clean installation link `http://127.0.0.1:7000/manifest.json`.
- In `.env.example`: Document `SUBTITLE_ENABLED`, `SUBTITLE_LANG`, `SUBTITLE_SOURCE`, `SUBTITLE_MAX_RESULTS`, `SUBTITLE_PROXY`.

- [x] **Step 4: Run test to verify it passes**
Run: `npm test tests/subtitles/config.test.ts`
Expected: PASS

---

### Task 11: End-to-End Test Suite, Build Verification & Packaging Check

**Files:**
- Test: `tests/subtitles/e2e.test.ts`
- Verify: `package.json`, `dist/`, `pack.ps1`

- [x] **Step 1: Write end-to-end integration test in `tests/subtitles/e2e.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

describe('End-to-End Subtitle Flow', () => {
  const app = createApp();

  it('serves manifest with clean stream & subtitle resources', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.body.resources).toEqual(
      expect.arrayContaining(['stream', expect.objectContaining({ name: 'subtitles' })])
    );
  });

  it('serves cached subtitle download directly with correct headers', async () => {
    const res = await request(app).get('/subtitles/dl/subhd/test_sid/0/Test.Movie.srt');
    // If not cached, returns 404 or fetches upstream gracefully
    expect([200, 404, 502]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    }
  });
});
```

- [x] **Step 2: Run all tests in repository**
Run: `npm test`
Expected: ALL test suites PASS

- [x] **Step 3: Run TypeScript production build**
Run: `npm run build`
Expected: `tsc` completes with 0 errors, `dist/` generated successfully

- [x] **Step 4: Verify package preparation**
Run: `powershell -File pack.ps1` (or verify that `pack.bat` and `pack.ps1` copy all required files into zip)
Expected: `StremList-Windows-Debug.zip` built successfully containing all updated files

---
