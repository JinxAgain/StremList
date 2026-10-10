# StremList ⚡

> Debrid-like Stremio addon integrating **OpenList** (115 & PikPak) with torrent indexers (**Torrentio** & **Comet**) for seamless instant cloud playback.

---

## 🌟 Features

- **Debrid-like Experience**: Click any movie or TV series stream in Stremio — StremList automatically searches torrents, creates an offline download task in OpenList (115 or PikPak), polls until ready, and plays directly.
- **Instant Cloud Playback (302 Redirect)**: Directly redirects playback to OpenList's raw streaming URL (`raw_url`). Zero media bandwidth is consumed on your StremList server.
- **Smart Cloud Cache Detection**: Checks both 115 and PikPak before creating new download tasks. If a torrent was previously downloaded on either drive, it starts streaming in under 500ms.
- **Parallel Torrent Aggregation**: Queries multiple upstreams (Torrentio, Comet) concurrently with timeout protection, deduplicates by `infoHash`, and filters out low quality or dead streams.
- **Smart Video Matcher**:
  - **Movies**: Filters out samples (< 100MB) and extras, automatically selecting the main feature film.
  - **Series**: Intelligently matches episodes by `S01E02`, `1x02`, `EP02`, or `第2集` patterns with fallback to stream index.
- **Hybrid Configuration**:
  - Personal local setup via `.env`
  - Web UI setup via `/configure` for one-click installation into Stremio.

---

## 🏗️ Architecture

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
|   - GET /configure                                                      |
|                                                                         |
|  [Scraper Aggregator]            [OpenList Client & Resolver]           |
|   - Torrentio & Comet             - Cache verification (115 / PikPak)   |
|   - Deduplication by infoHash     - Add offline download task           |
|   - Rewrite to /play/:hash        - Directory polling & abort detection |
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

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** >= 18.0.0
- An active [OpenList](https://fox.oplist.org) / AList instance with storage mounted (e.g. `/115` and/or `/pikpak`).

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/JinxAgain/StremList.git
cd StremList

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### 3. Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Edit `.env` to suit your environment:

```env
PORT=7000

# OpenList API endpoint and Token (from OpenList Admin -> Manage -> API Token)
OPENLIST_URL=http://127.0.0.1:5244
OPENLIST_TOKEN=your_openlist_token

# Default target storage ('115' or 'pikpak')
DEFAULT_DRIVE=115

# Upstream torrent indexers
TORRENTIO_URL=https://torrentio.strem.fun
COMET_URL=https://comet.elfhosted.com

# Polling configuration (timeout in seconds, interval in ms)
POLL_TIMEOUT=25
POLL_INTERVAL=1500
```

### 4. Running the Server

```bash
# Development mode (with live reload)
npm run dev

# Production mode
npm run build
npm start
```

Once started, open `http://127.0.0.1:7000/configure` in your browser to configure and click **Install Addon in Stremio**.

---

## 📺 How to Use with Stremio

1. Start StremList (`npm start`).
2. Open your web browser to `http://127.0.0.1:7000/configure`.
3. Fill in your OpenList server address and token, then click **Install Addon in Stremio**.
4. Stremio desktop will open and prompt you to install **StremList (115 / PikPak)**.
5. Search for any movie or show in Stremio.
6. Select any stream labeled `[StremList ⚡ 115/PikPak]` to play!

---

## 🧪 Testing

StremList includes a full test suite covering configuration, file matching, torrent scraping, OpenList integration, and end-to-end flows:

```bash
npm test
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
