# StremList ⚡

> Debrid-like Stremio addon integrating **OpenList** (115 & PikPak) with torrent indexers (**Torrentio** & **Comet**) for seamless instant cloud playback.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

---

## 🌟 Key Features

- **Debrid-like Cloud Streaming**: Click any movie or TV series stream in Stremio — StremList automatically searches torrents, creates an offline download task in OpenList (115 or PikPak), polls until ready, and plays immediately.
- **Instant Cloud Playback (302 Redirect)**: Redirects playback directly to OpenList's stream URL (`raw_url`). Zero media bandwidth is consumed on your StremList server.
- **Smart Cloud Cache Detection**: Checks both 115 and PikPak before creating new download tasks. If a torrent was previously downloaded on either drive, it starts streaming in under 500ms.
- **115 Anti-Hotlink Protection & Local Proxy**: Automatically configures and resolves 115 streams through OpenList's native `/d/` local proxy stream, bypassing 115 CDN's `403 Forbidden` (`invalid signature`) checks on external video players (Stremio / ExoPlayer / mpv).
- **Parallel Torrent Aggregation**: Queries multiple upstreams (Torrentio, Comet) concurrently with timeout protection, deduplicates by `infoHash`, and filters out low-quality or dead streams.
- **Smart Video Matcher**:
  - **Movies**: Filters out samples (< 100MB) and extras, automatically selecting the main feature film.
  - **Series**: Intelligently matches episodes by `S01E02`, `1x02`, `EP02`, or `第2集` patterns with fallback to stream index.
- **Zero-Dependency Windows Tooling**:
  - `start.bat`: One-click interactive console with live debug log.
  - `start-background.vbs` / `start-background.bat`: **Completely silent background runner without console window**.
  - `stop.bat`: One-click shutdown script.
  - Automatically fetches portable Node.js v20 if Node is not installed on the system.
- **Web Configuration UI**: Visual setup at `http://127.0.0.1:7000/configure` with one-click OpenList admin authentication and one-click Stremio addon installation.

---

## 🏗️ Architecture

```
+-------------------------------------------------------------------------+
|                              Stremio Client                             |
+-------------------------------------------------------------------------+
       | 1. GET /stream/:type/:id.json          ^ 4. 302 Redirect to stream
       |                                        |    (direct / proxy playback)
       v                                        |
+-----------------------------------------------+-------------------------+
|                           StremList Server                              |
|                                                                         |
|  [HTTP Router]                                                          |
|   - GET /manifest.json & /:config/manifest.json                         |
|   - GET /stream/:type/:id.json & /:config/stream/:type/:id.json         |
|   - GET /play/:hash & /:config/play/:hash                               |
|   - GET /configure & POST /api/openlist/login & /api/openlist/test      |
|                                                                         |
|  [Scraper Aggregator]            [OpenList Client & Resolver]           |
|   - Torrentio & Comet             - Cache verification (115 / PikPak)   |
|   - Deduplication by infoHash     - Pre-creates download folders        |
|   - Rewrite to /play/:hash        - Adds offline download (115 Open)    |
|                                   - Resolves raw / proxy playback URL   |
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

### Method 1: Windows One-Click (Recommended for Windows)

Simply clone or download this repository, and use the included scripts:

1. **First-Time Setup & Stremio Installation**:
   - Double-click **`start.bat`**.
   - Your browser will open to `http://127.0.0.1:7000/configure`.
   - Enter your OpenList admin credentials to fetch the token, then click **⚡ Install Addon in Stremio**.
   - **You only need to install it once!** Stremio saves your addon configuration in your account, so you never need to reinstall it after computer reboots.

2. **Silent Background Execution**:
   - Double-click **`start-background.vbs`** (or **`start-background.bat`**).
   - Launches 100% silently in the background with **zero console window** and **no browser popup**.
   - Need to adjust settings later? Just double-click **`configure.bat`**.
   - All server logs are written to `debug.log`.

3. **Auto-Start on Boot (Windows Startup)**:
   - Double-click **`autostart-enable.bat`** — automatically adds StremList to your Windows Startup folder!
   - StremList will silently run in the background every time Windows starts up.
   - To disable autostart at any time, double-click **`autostart-disable.bat`**.

4. **Stop Background Server**:
   - Double-click **`stop.bat`** to cleanly terminate the background StremList process and free port 7000.

> [!TIP]
> **No Node.js installed?** No problem! The start scripts will automatically detect if Node.js is missing and download the official portable Node.js v20 LTS into a local `.bin` folder.

---

### Method 2: Cross-Platform (Linux / macOS / Windows)

#### 1. Prerequisites
- **Node.js** >= 18.0.0
- An active [OpenList](https://fox.oplist.org) or AList instance with mounted storage (`/115` and/or `/pikpak`).

#### 2. Install & Start

```bash
# Clone the repository
git clone https://github.com/JinxAgain/StremList.git
cd StremList

# Install dependencies
npm install

# Copy example environment configuration
cp .env.example .env

# Run development server
npm run dev
```

For production deployment:

```bash
npm run build
npm start
```

---

## ⚙️ OpenList & Cloud Drive Configuration

### 1. 115 Cloud Storage Setup (Crucial)

115 Cloud CDN enforces strict anti-hotlink validation (checking `User-Agent` and client session signatures). If third-party media players (Stremio / ExoPlayer / mpv) connect to raw 115 CDN links directly, 115 rejects them with `HTTP 403 Forbidden` (`invalid signature`).

To ensure smooth playback:
1. In OpenList Admin Panel (`http://127.0.0.1:5244/@manage/storages`), click **Edit** on your `115` or `115 Open` storage.
2. Enable **Web Proxy** (`web_proxy`: ON).
3. Set **WebDAV Policy** to **Local Proxy** (`native_proxy` / 本地代理).
4. Save the storage settings.

> [!NOTE]
> **Automatic Optimization**: When you connect via StremList's Web UI (`/configure`) using an OpenList Admin account, **StremList automatically enables Web Proxy and Local Proxy for your 115 mount** via the OpenList Admin API.

### 2. PikPak Storage Setup

Mount your PikPak drive in OpenList at `/pikpak` or `/PikPak`. PikPak CDN links support direct streaming out of the box.

---

## 📺 How to Use with Stremio

1. Start StremList (e.g. double-click `start-background.vbs` or run `npm run dev`).
2. Open your browser to `http://127.0.0.1:7000/configure`.
3. Enter your OpenList URL (default: `http://127.0.0.1:5244`).
4. Click **🔑 一键获取 Token** and enter your OpenList admin credentials, or paste your API Token directly.
5. Click **🔍 测试连接** to verify connectivity.
6. Click **⚡ Install Addon in Stremio** (or copy the manifest link to install manually in Stremio).
7. In Stremio, search for any movie or TV series and select any stream labeled `[StremList ⚡ 115/PikPak]`!

---

## 🛠️ Environment Variables (.env)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `7000` | HTTP port for StremList addon server |
| `OPENLIST_URL` | `http://127.0.0.1:5244` | OpenList server URL |
| `OPENLIST_TOKEN` | `""` | OpenList API Token (JWT or permanent token) |
| `DEFAULT_DRIVE` | `115` | Default target cloud drive (`115` or `pikpak`) |
| `TORRENTIO_URL` | `https://torrentio.strem.fun` | Upstream Torrentio scraper URL |
| `COMET_URL` | `https://comet.elfhosted.com` | Upstream Comet scraper URL |
| `POLL_TIMEOUT` | `25` | Maximum seconds to wait for offline download completion |
| `POLL_INTERVAL` | `1500` | Polling interval in milliseconds |

---

## 📦 Packaging for Distribution

To produce a clean, ready-to-use distribution `.zip` archive for other Windows users:

```powershell
.\pack.bat
# or: powershell -ExecutionPolicy Bypass -File pack.ps1
```

This creates `StremList-Windows-Debug.zip`, which contains all source code, dependencies manifest, and launcher scripts (`start.bat`, `start-background.vbs`, `stop.bat`).

---

## 🧪 Testing

Run the full automated test suite (including unit and end-to-end integration tests):

```bash
npm test
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
