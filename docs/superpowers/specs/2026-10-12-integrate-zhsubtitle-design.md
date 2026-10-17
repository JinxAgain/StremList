# Architecture & Design Specification: Native Integration of zhsubtitle into StremList

- **Status**: Approved by Human Partner
- **Date**: 2026-10-12
- **Target Project**: `StremList`
- **Source Project**: `stremio-zhsubtitle`
- **Author**: Antigravity Brainstorming & Architecture Session

---

## 1. Executive Summary & Objective

### 1.1 Background & Motivation
`StremList` is an all-in-one Stremio addon providing seamless cloud offline streaming for 115 and PikPak via OpenList and torrent scrapers (Torrentio and Comet). `stremio-zhsubtitle` is a dedicated Python (FastAPI) Stremio subtitle addon that aggregates subtitles from Zimuku (`srtku.com`/`zmk.pw`) and SubHD (`subhd.tv`), normalizing ASS/SSA/VTT subtitles to clean UTF-8 SRT with zero-mojibake and deep compatibility for Harbor and Android TV clients.

This specification defines the complete, native **TypeScript** porting and architectural integration of `stremio-zhsubtitle` into `StremList`. The goal is to provide a unified, zero-Python, single-process Stremio addon that serves both high-speed cloud video streams and high-coverage Chinese subtitles via a single clean manifest URL (`http://127.0.0.1:7000/manifest.json`).

### 1.2 Core Success Criteria
1. **100% Native TypeScript**: Zero Python runtime or external pip dependencies required. Works out of the box with `npm start`, `start.bat`, and `pack.ps1`.
2. **Complete Parity with zhsubtitle Logic**:
   - Algorithmic 5-digit BMP pixel template matching for Zimuku verification (zero external OCR costs).
   - Zimuku Yunsuo WAF bypass (`security_verify_img` + `srcurl` cookie).
   - SubHD 4-step token download flow (`prepare-download` -> temp page -> `api/sub/down` -> archive download) and 403 cooldown protection.
   - Robust in-memory ZIP unpacking, encoding recovery (CP437 -> GB18030/GBK), and nested archive handling.
   - ASS/SSA dialogue sanitization (stripping `{\pos...}`, `{\p1}`, vector drawings, HTML tags) and normalization to standard UTF-8 SRT.
   - Comprehensive multi-factor subtitle scoring model (season/episode match, season packs, bilingual preference, release group agreement).
3. **Full Harbor & Cross-Platform Client Adaptation**:
   - Request path newline sanitization middleware preventing Starlette/Express routing breakage on Harbor multi-line torrent filenames.
   - Polymorphic media ID parsing supporting IMDb (`tt...`), TMDB (`tmdb:12345`, `tmdb:movie:12345`, `tmdb:tv:12345:1:14`), Kitsu, and filename metadata extraction.
   - Cinemeta + TMDB Addon + TheMovieDb web scraping fallback for resolving TMDB IDs to IMDb IDs.
   - OpenSubtitles v3 formatted labels (`Title · S01E01 · 1080p · [Bilingual SubHD]`) and clean ASCII filenames (<= 120 chars) avoiding character encoding issues in Android TV/ExoPlayer.
4. **Unified Configuration UI**:
   - Embeds Chinese subtitle settings (enable toggle, bilingual/simplified/traditional preference, source selection, max results, proxy) into `/configure`.
   - Settings persist to `.env` and apply server-wide to the clean manifest URL without requiring re-installation in Stremio.

---

## 2. System Architecture & Directory Layout

### 2.1 Directory Structure
```text
StremList/
├── package.json                          # Added deps: cheerio, adm-zip, iconv-lite, @types/...
├── src/
│   ├── app.ts                            # Harbor URL newline sanitization middleware & subtitle route mounting
│   ├── config.ts                         # Subtitle config variables & .env persistence
│   ├── routes/
│   │   ├── manifest.ts                   # Manifest resources: ['stream', 'subtitles'] & idPrefixes
│   │   ├── configure.ts                  # Configuration API endpoints for subtitle settings
│   │   └── subtitles.ts                  # Stremio subtitle list & on-demand download/streaming endpoints
│   ├── public/
│   │   └── configure.html                # Modern glassmorphism UI with Subtitle Settings card
│   └── services/
│       ├── openlist/                     # (Existing OpenList cloud drive service)
│       ├── scraper/                      # (Existing Torrentio/Comet scrapers)
│       └── subtitles/                    # Newly integrated subtitle subsystem
│           ├── types.ts                  # VideoQueryMeta, SubtitleCandidate, SubtitleTags, ProviderConfig
│           ├── providers/
│           │   ├── base.ts               # BaseProvider interface, season/episode regexes, tag extractors
│           │   ├── zimuku.ts             # Zimuku scraper, mirror failover, WAF bypass, ZimukuBmpSolver
│           │   └── subhd.ts              # SubHD scraper, 4-step token flow, 403 cooldown management
│           ├── core/
│           │   ├── cinemeta.ts           # Cinemeta resolver, TMDB Addon & TMDB web fallback
│           │   ├── extractor.ts          # adm-zip in-memory extraction, iconv-lite filename repair, pickBestFile
│           │   ├── cleaner.ts            # Charset auto-probing, ASS/SSA/VTT to UTF-8 SRT normalizer
│           │   └── scorer.ts             # Composite scoring model (season packs, bilingual, release tags)
│           └── cache/
│               └── manager.ts            # Search cache (12h TTL) + Disk SRT cache + Single-flight query locks
├── data/
│   └── cache/
│       ├── search_cache.json             # Serialized search results index
│       └── subtitles/                    # Physical normalized .srt cache files
└── tests/
    └── subtitles/
        ├── solver.test.ts                # BMP pixel solver accuracy tests
        ├── cleaner.test.ts               # ASS tag stripping & timestamp conversion tests
        ├── extractor.test.ts             # In-memory unzipping & episode matching tests
        └── routes.test.ts                # Harbor newline sanitization & route handler tests
```

### 2.2 Technology Stack & Zero C++ Compilation Guarantee
| Dependency | Purpose | Rationale |
| :--- | :--- | :--- |
| `cheerio` | Fast HTML DOM parsing | Pure JS, jQuery-like API, standard for scraping SubHD & Zimuku |
| `adm-zip` | In-memory ZIP extraction | Pure JS, zero external binaries, handles 95%+ of subtitle archives |
| `iconv-lite` | Charset decoding | Pure JS, robust decoding for GB18030, GBK, Big5, UTF-16, UTF-8 |
| `axios` | HTTP client with proxies | Already installed in StremList, handles headers, timeouts, and streaming |

---

## 3. Detailed Component Design

### 3.1 Harbor URL Path Sanitization Middleware (`src/app.ts`)
```typescript
app.use((req, res, next) => {
  // Harbor and certain clients forward raw or URL-encoded newlines in torrent filenames
  if (req.url.includes('%0A') || req.url.includes('%0D') || req.url.includes('\n') || req.url.includes('\r')) {
    req.url = req.url
      .replace(/(%0D%0A|%0A|%0D|\r\n|\n|\r)/gi, ' ')
      .replace(/\s+/g, ' ');
  }
  next();
});
```

### 3.2 Manifest Specification (`src/routes/manifest.ts`)
```typescript
export function getManifest(config?: Partial<AppConfig>): StremioManifest {
  const subtitleEnabled = config?.subtitleEnabled ?? true;
  const resources: any[] = ['stream'];

  if (subtitleEnabled) {
    resources.push({
      name: 'subtitles',
      types: ['movie', 'series'],
      extra: [
        { name: 'videoHash', isRequired: false },
        { name: 'videoSize', isRequired: false },
        { name: 'filename', isRequired: false }
      ]
    });
  }

  return {
    id: 'org.stremio.stremlist',
    version: '0.2.0',
    name: 'StremList (115 / PikPak + 中文字幕)',
    description: 'Seamless cloud offline streaming & Chinese subtitles (Zimuku & SubHD)',
    resources,
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb', 'kitsu'],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}
```

### 3.3 Media ID & Harbor Format Resolution (`src/services/subtitles/core/cinemeta.ts`)
1. **Supported ID Patterns**:
   - `tt0903747` / `tt0903747:1:1` -> IMDb ID with optional season/episode.
   - `tmdb:12345` / `tmdb:12345:1:14` / `tmdb:movie:12345` / `tmdb:tv:12345:1:14` -> TMDB ID.
   - `kitsu:1234:1` -> Kitsu catalog ID.
2. **Resolution Pipeline**:
   - If ID starts with `tt...`: Query `https://v3-cinemeta.strem.io/meta/{type}/{id}.json` for `name` and `year`.
   - If ID starts with `tmdb:...`:
     1. Query TMDB Addon: `https://94c8cb9f702d-tmdb-addon.baby-beamup.club/meta/{type}/tmdb:{id}.json` to extract `imdb_id`, `name`, and `year`.
     2. If addon fails: Scrape `https://www.themoviedb.org/{tv|movie}/{id}` HTML title tag `<title>Name (Year) &#8212; The Movie Database</title>`.
   - If no title resolved and `extra` contains `filename=...`: Use `extractMetaFromFilename` to extract clean title, year, season, and episode from the release filename.

### 3.4 Provider Implementations

#### 3.4.1 Zimuku Provider (`zimuku.ts`)
- **Mirror Domains**: Default `https://zmk.pw`, fallbacks `https://srtku.com`, `https://zimuku.org`. Unhealthy mirrors enter a 10-minute cooldown.
- **Pure TS Algorithmic BMP Solver (`ZimukuBmpSolver`)**:
  - Input: 100x27 24-bit BMP Buffer from Yunsuo WAF `data:image/bmp;base64,...`.
  - Feature matching: 9 strategic sample points per character column, matching templates for digits 0-9. Variable spacing adjustment for digit `1` (+1) and `4` (-1).
- **Yunsuo WAF Bypass**:
  - Detects `security_verify_img` / `YunsuoAutoJump`.
  - Solves BMP captcha, converts code and URL to hex strings.
  - Sets cookie `srcurl={hexUrl}` and GETs `/?security_verify_img={hexCode}` to acquire clearance.
- **Search Query Construction**:
  - TV Season > 1: `Title 第X季` (Chinese numerals).
  - TV Season 1: `Title S01`, `Title 第一季`, `IMDb ID`, `Title`.
  - Movie: `IMDb ID`, `Title Year`, `Title`.
- **Parsing**: Cheerio parses direct table (`table.tborder2`, `table.table`) and work cards (`div.item`).
- **Download**: Detail page -> `li.dlsub a` -> Download page `div.clearfix a` -> Fetch archive buffer.

#### 3.4.2 SubHD Provider (`subhd.ts`)
- **Mirror Domains**: Default `https://subhd.tv`, fallbacks `https://subhd.me`, `https://subhd.one`, `https://subhd.cc`.
- **403 & Rate-Limit Cooldown**:
  - If 403 Forbidden or `下载频率过高` occurs, mark provider rate-limited for 10 minutes.
  - SubHD score is demoted in candidate ranking, gracefully prioritizing Zimuku.
- **4-Step Token Download Flow**:
  1. `POST {domain}/api/sub/prepare-download` with JSON `{"sid": sid}` and Ajax headers -> returns `down_path`.
  2. `GET {domain}{down_path}` with Referer header -> visits temp page.
  3. `POST {domain}/api/sub/down` with JSON `{"sid": sid, "cap": ""}` -> returns final `file_url`.
  4. `GET {file_url}` -> returns archive bytes and filename.

### 3.5 Core Subtitle Pipeline

#### 3.5.1 Extractor (`extractor.ts`)
- **In-Memory ZIP Extraction**:
  - Loads buffer using `adm-zip`.
  - Checks filename byte encoding: if UTF-8 bit (0x800) not present, decodes raw CP437 bytes using `iconv-lite.decode(raw, 'gb18030')` or `gbk`.
  - Handles nested archives (e.g. season pack ZIP containing per-episode ZIPs).
- **External 7z / Unrar Fallback**:
  - For `.rar` or `.7z`, checks available system binaries (`C:\Program Files\7-Zip\7z.exe`, `data/bin/7zz`, or PATH `7z`/`unrar`). Executes via `child_process.spawnSync`.
- **Candidate File Scoring (`pickBestFile`)**:
  - Target episode match: +2000 points.
  - Wrong episode penalty: -5000 points (immediate disqualification).
  - Language preference: Bilingual explicit tag (+1100), bilingual body (+1000), traditional (+900), simplified (+800), pure English (-2000 disqualified).
  - Format preference: `.srt` (+50), `.ass`/`.ssa` (+40), `.vtt` (+20).

#### 3.5.2 Cleaner (`cleaner.ts`)
- **Charset Prober**: Probes UTF-8 with BOM, UTF-8, GB18030, GBK, Big5, UTF-16LE, UTF-16BE, Latin-1. Returns decoded string without BOM.
- **ASS/SSA Sanitization (`assToSrt`)**:
  - Reads `[Events]` section and maps dynamic columns from `Format: ...`.
  - Removes vector drawing commands `{\p1}...{\p0}` and style tags `{\pos(x,y)}`, `{\b1}`, etc.
  - Converts escaped newlines `\N`, `\n`, `\h` to standard spaces and line breaks.
  - Strips HTML tags.
  - Converts ASS timestamp `0:01:23.45` to SRT `00:01:23,450`.
  - Chronologically sorts cues, renumbers from 1, and emits valid UTF-8 SRT.
- **VTT Sanitizer (`vttToSrt`)**: Strips WEBVTT headers and note blocks, converts dot timestamps to commas, and normalizes cues.

#### 3.5.3 Scorer (`scorer.ts`)
Calculates composite score:
- IMDb exact match bonus: +1000.
- Season conflict penalty: -5000 (if candidate title specifies another season).
- Season pack / collection bonus: +1150 (prioritized for full series coverage).
- Target episode direct match: +1000.
- Release year agreement: +150 (±1 yr); non-match penalty: -1500.
- Language preference:
  - Bilingual first: Bilingual (+600), Simplified (+350), Traditional (+300).
  - Simplified only: Simplified (+600), Bilingual (+450), Traditional (+200).
- Translation source badges: Official (+100), Refined/Reprint (+80), Original (+60).
- Quality match: 4K (+80), 1080p (+60), BluRay (+60), WEB-DL (+50).
- Player release filename matching: Matching release group (+120), resolution (+60), source (+40).

### 3.6 Two-Tier Cache & Single-Flight Mutex (`cache/manager.ts`)
1. **Search Results Index**:
   - Cache key: `{mediaType}:{imdbId}:{season}:{episode}:{lang}:{source}:{maxResults}`.
   - Stored in memory with asynchronous write to `data/cache/search_cache.json`. TTL: 12 hours.
   - Cache hit returns in `<1ms`, dynamically re-mapping URLs to the current request host.
2. **Disk SRT Cache**:
   - File location: `data/cache/subtitles/{provider}_{subId}_{episodeNum}.srt`.
   - Before downloading from upstream, checks if valid SRT (size >= 20 bytes, contains `-->`) exists on disk. Cache hit streams in `<5ms`.
3. **Single-Flight Lock**:
   - In-memory lock per query key prevents duplicate parallel upstream scraping tasks during simultaneous client requests.

---

## 4. Web Configuration Integration (`/configure`)

### 4.1 UI Layout & Controls
In `src/public/configure.html`, a new section **中文字幕设置 (Chinese Subtitles)** will be added below the OpenList and Scraper sections:
- **启用中文字幕插件**: Checkbox toggle (default: checked).
- **首选字幕语言**: Select (`bilingual` 双语优先, `chs` 仅简体, `cht` 仅繁体).
- **默认检索字幕源**: Select (`all` 全部聚合检索, `subhd` 仅使用 SubHD, `zimuku` 仅使用 Zimuku).
- **最大返回条数**: Select (`5`, `8` [默认], `10`).
- **上游网络代理**: Input text (default: empty).

### 4.2 Configuration Flow & Clean Installation
- On saving in `/configure`, `POST /api/config/save` persists updates to `.env`:
  ```env
  SUBTITLE_ENABLED=true
  SUBTITLE_LANG=bilingual
  SUBTITLE_SOURCE=all
  SUBTITLE_MAX_RESULTS=8
  SUBTITLE_PROXY=""
  ```
- Stremio installation link remains the clean URL:
  `http://127.0.0.1:7000/manifest.json` (or `stremio://127.0.0.1:7000/manifest.json`).
- Changes made in `/configure` take effect immediately without requiring re-installation in Stremio.

---

## 5. Verification & Testing Strategy

### 5.1 Automated Unit & Integration Tests (Vitest)
1. `tests/subtitles/solver.test.ts`: Test `ZimukuBmpSolver` against base64-encoded BMP test vectors to verify 100% digit recognition accuracy.
2. `tests/subtitles/cleaner.test.ts`: Test `SubtitleCleaner` on sample ASS dialogues with styling tags, drawing commands, and GBK charset to verify clean UTF-8 SRT output.
3. `tests/subtitles/extractor.test.ts`: Test in-memory unzipping, CP437 filename repair, and `pickBestFile` episode selection.
4. `tests/subtitles/routes.test.ts`:
   - Test Harbor `%0A` newline URL sanitization middleware.
   - Test `/manifest.json` resources and idPrefixes.
   - Test subtitle endpoint routing and mock response formats.

### 5.2 Build & Packaging Verification
1. Run `npm run build` to verify clean TypeScript compilation with zero type errors.
2. Run `npm test` to verify all test suites pass.
3. Verify `pack.ps1` produces a valid standalone `StremList-Windows-Debug.zip`.

---

## 6. Spec Self-Review Checklist
- [x] **Placeholder Scan**: No "TBD", "TODO", or undefined requirements.
- [x] **Internal Consistency**: Matches existing StremList Express architecture and zhsubtitle verified behaviors.
- [x] **Scope Check**: Focuses strictly on porting and integrating zhsubtitle logic into StremList.
- [x] **Ambiguity Check**: Harbor compatibility, clean URL behavior, and zero-Python constraints are explicitly defined.
