# StremList Design Specification

**Date**: 2026-10-10  
**Status**: Approved Design  
**Target Scope**: MVP Release (Stremio Addon + OpenList + 115 / PikPak + Torrentio / Comet)

---

## 1. Overview & Goals

**StremList** is a lightweight, self-hosted Stremio addon service that connects Stremio with cloud storage platforms (primarily **115** and **PikPak**) through **OpenList** (an enhanced distribution/fork of AList) and upstream torrent indexers (**Torrentio**, **Comet**).

It delivers a seamless "Debrid-like" streaming experience:
1. In Stremio, the user browses movies or series.
2. Torrent streams aggregated from Torrentio and Comet are presented with rewritten stream links.
3. Upon clicking a stream, StremList checks if the torrent is already cached in 115 or PikPak.
4. If uncached, it triggers an instant offline download task via OpenList's API and holds the HTTP connection while polling the target folder.
5. Once ready, StremList identifies the correct video file and returns an HTTP `302 Found` redirect to OpenList's direct raw download link (`raw_url`).
6. Stremio streams video directly from the cloud drive without proxying heavy media traffic through the StremList server.

---

## 2. System Architecture

```
+-------------------------------------------------------------------------+
|                              Stremio Client                             |
+-------------------------------------------------------------------------+
       | 1. GET /stream/:type/:id.json          ^ 4. 302 Redirect to raw_url
       |                                        |    (direct cloud playback)
       v                                        |
+-----------------------------------------------+-------------------------+
|                           StremList Server                              |
|                                                                         |
|  [HTTP Router]                                                          |
|   - GET /manifest.json & /:config/manifest.json                         |
|   - GET /stream/:type/:id.json & /:config/stream/:type/:id.json         |
|   - GET /play/:hash & /:config/play/:hash                               |
|   - GET /configure & POST /configure                                    |
|                                                                         |
|  [Scraper Aggregator]            [OpenList Client & Resolver]           |
|   - Queries Torrentio & Comet     - Checks cache in 115 / PikPak        |
|   - Deduplicates by infoHash      - Triggers offline download task      |
|   - Ranks & rewrites stream URLs  - Polls directory with timeout        |
|                                   - Selects target video file           |
|                                   - Resolves raw playback URL           |
+-------------------------------------------------------------------------+
        | (Parallel HTTP requests)                      | (REST API)
        v                                               v
+-------------------------------+              +--------------------------+
| Upstream Indexers             |              | OpenList Service         |
| - Torrentio                   |              | - 115 Drive (/115)       |
| - Comet                       |              | - PikPak (/pikpak)       |
+-------------------------------+              +--------------------------+
```

---

## 3. End-to-End User Flow & Sequence

1. **Browse Content**:
   Stremio sends `GET /stream/:type/:id.json` (e.g. `movie/tt0111161.json` or `series/tt0944947:1:1.json`).
2. **Scraper Aggregation**:
   StremList concurrently queries configured upstream scrapers (Torrentio, Comet) with an isolated 5-second timeout per scraper.
3. **Deduplication & Stream Rewrite**:
   - Streams are deduplicated by 40-character `infoHash`.
   - Highest seeders and best quality streams are sorted first.
   - Stream URLs are rewritten to `http://<host>:<port>/play/<infoHash>?type=...&id=...&fileIdx=...&title=...`.
4. **Playback Initiation**:
   The user selects a stream in Stremio. Stremio's internal media player makes a `GET /play/<infoHash>?...` request.
5. **Cache Verification**:
   - StremList checks the default drive folder: `/<defaultDrive>/StremList/<infoHash>/`.
   - If not found, it checks the alternative drive folder (e.g., `/pikpak/StremList/<infoHash>/` if 115 is default, or vice versa).
   - If video files exist, it skips directly to **Step 8 (Resolve Playback Link)**.
6. **Trigger Offline Download**:
   If uncached, StremList invokes OpenList API:
   `POST /api/fs/add_offline_download`
   Target path: `/<defaultDrive>/StremList/<infoHash>`
   URLs: `["magnet:?xt=urn:btih:<infoHash>"]`
7. **Synchronous Polling**:
   - Holds the HTTP connection.
   - Polls `POST /api/fs/list` with `{ path, refresh: true }` every 1.5s (max 25s timeout).
   - If client aborts (`req.on('close')`), polling loop immediately exits.
8. **File Selection (Matcher)**:
   - Filters out non-video formats and sample clips (< 100MB).
   - For movies: Selects the largest video file.
   - For series: Matches target season and episode (e.g., `S01E01`, `1x01`, `EP01`).
9. **Resolve Playback Link & 302 Redirect**:
   - Calls `POST /api/fs/get` to retrieve `data.raw_url`.
   - Responds with `302 Found`, setting `Location: <raw_url>`.
   - Stremio plays the file directly.

---

## 4. Component Details & Interfaces

### 4.1 Project Directory Structure
```
StremList/
├── docs/
│   └── superpowers/specs/2026-10-10-stremlist-addon-design.md
├── src/
│   ├── index.ts                # Server bootstrapper & listener
│   ├── app.ts                  # App factory, middlewares, route mounting
│   ├── config.ts               # Env parsing & config validation
│   ├── types/
│   │   ├── stremio.ts          # Manifest, Stream, Meta types
│   │   ├── openlist.ts         # OpenList API request/response types
│   │   └── scraper.ts          # Torrent stream representation
│   ├── routes/
│   │   ├── manifest.ts         # Stremio manifest endpoints
│   │   ├── stream.ts           # Stream discovery endpoints
│   │   ├── play.ts             # Play resolution & 302 redirect
│   │   └── configure.ts        # Configuration web page & install button
│   ├── services/
│   │   ├── scraper/
│   │   │   ├── aggregator.ts   # Concurrency, timeout, deduplication
│   │   │   ├── torrentio.ts    # Torrentio scraper client
│   │   │   └── comet.ts        # Comet scraper client
│   │   ├── openlist/
│   │   │   ├── client.ts       # OpenList API client (list, add_offline, get)
│   │   │   └── resolver.ts     # Directory polling & raw link acquisition
│   │   └── matcher/
│   │       └── file-matcher.ts # Movie largest file & series SxxExx regex
│   └── public/
│       └── configure.html      # Responsive web UI for addon setup
├── tests/
│   ├── file-matcher.test.ts    # Matcher regex & size rules
│   └── aggregator.test.ts      # Deduplication & ranking tests
├── package.json
├── tsconfig.json
└── .env.example
```

### 4.2 Configuration Model (Hybrid)
Settings can be defined in `.env` (for local personal instances) or encoded as URL path parameters `/:config/` for multi-user / cloud instances:

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
```

### 4.3 OpenList API Endpoints Used
1. **Offline Download**:
   - `POST /api/fs/add_offline_download`
   - Headers: `Authorization: <token>`, `Content-Type: application/json`
   - Payload:
     ```json
     {
       "path": "/115/StremList/<hash>",
       "urls": ["magnet:?xt=urn:btih:<hash>"],
       "tool": "115"
     }
     ```
2. **List Files**:
   - `POST /api/fs/list`
   - Payload:
     ```json
     {
       "path": "/115/StremList/<hash>",
       "refresh": true
     }
     ```
3. **Get Direct URL**:
   - `POST /api/fs/get`
   - Payload:
     ```json
     {
       "path": "/115/StremList/<hash>/<filename>"
     }
     ```
   - Extract `data.raw_url`.

### 4.4 File Matching Algorithm
- Supported extensions: `.mp4`, `.mkv`, `.avi`, `.ts`, `.mov`, `.wmv`, `.flv`, `.m4v`.
- Reject condition: `size < 104857600` (100 MB) or filename matching `/(sample|featurette|trailer)/i`.
- **Movie**: Pick candidate with maximum `size`.
- **Series**:
  - Regex pattern: `/(?:s|season\s*)0*(\d+)[\s._-]*(?:e|episode\s*|x)0*(\d+)/i` and `/(?:ep|第)0*(\d+)/i`.
  - Compare matched season/episode with requested `season` and `episode`.
  - Fallback: Use `fileIdx` if available, otherwise largest file.

---

## 5. Error Handling & Edge Cases

| Failure Scenario | Handling Behavior |
|------------------|-------------------|
| Torrentio or Comet times out | Isolated per scraper with `Promise.allSettled`; remaining scrapers succeed without blocking. |
| All scrapers fail or no streams found | Returns `{ streams: [] }` with HTTP 200 to Stremio. |
| OpenList unreachable or auth failure | Logs structured error; `/play` returns HTTP 502 with diagnostic message. |
| Torrent offline download not instant (> 25s) | Returns HTTP 504 Gateway Timeout. Task continues in background on cloud drive. |
| User closes player before 25s | Listener on `req.on('close')` clears polling timer and releases pending promises. |
| Torrent contains no video files | Returns HTTP 404 with message `No playable video files found`. |

---

## 6. Testing & Verification

1. **Unit Tests (Vitest / Jest)**:
   - `file-matcher.test.ts`: Verify movie selection picks largest file; series matcher picks `S01E03` correctly out of multi-file packages.
   - `aggregator.test.ts`: Verify deduplication by infoHash, quality sort (4k > 1080p), and URL rewrite formatting.
2. **Integration Verification**:
   - Boot local server: verify `GET /manifest.json` returns valid Stremio Addon manifest.
   - Query `GET /stream/movie/tt0111161.json`: verify stream list from Torrentio/Comet rewritten to `/play/<hash>`.
   - Access `/configure`: verify web UI loads and builds valid `stremio://` install links.
