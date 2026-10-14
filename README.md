<div align="center">

<img src="src/public/logo.png" width="132" height="132" alt="StremList Vintage Cinephile Logo" style="border-radius: 28px; box-shadow: 0 12px 28px -5px rgba(217, 119, 6, 0.45);" />

# StremList 🎬

> Debrid-like Stremio addon integrating **OpenList** (115 & PikPak), torrent indexers (**Torrentio** & **Comet**), and **Chinese Subtitles** (SubHD, Shooter) for seamless instant cloud streaming.

[![Version](https://img.shields.io/badge/version-0.2.0-amber.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

</div>

---

## 🌟 Key Features (核心功能特性)

### 1. ⚡ Debrid-like Instant Cloud Playback (双网盘秒播与秒传)
- **Zero Server Bandwidth (302 原画直链)**: Direct 302 redirection to OpenList's cloud download URL (`raw_url`). Video streaming consumes zero bandwidth on your StremList host.
- **115 Anti-Hotlink Protection & Local Proxy (115 防盗链绕过)**: Automatically detects and routes 115 streams through OpenList's native `/d/` local proxy stream with HMAC sign, completely resolving `403 Forbidden` (`invalid signature`) errors on external players (Stremio / ExoPlayer / mpv).
- **Cross-Drive Cache Sniffing (跨网盘秒传探测)**: Before initiating offline downloads, StremList inspects both **115** and **PikPak**. If content was previously cached in either drive, playback begins in under 500ms without redundant downloads.
- **Automatic Offline Task Polling**: Automatically submits magnet hashes to OpenList, polls the cloud drive directory, and redirects the moment the media file is ready.

### 2. 🔍 Intelligent Scraper Aggregator & Sorter (多源聚合与智能排序)
- **Concurrent Multi-Source Scraping**: Concurrently queries **Torrentio** and **Comet** with isolated timeouts and error isolation.
- **Hash Deduplication & Seeder Merging**: Deduplicates identical torrents by `infoHash` and automatically merges metadata, preserving the highest seeder count reported across scrapers.
- **Smart Quality Hierarchy**: Priority ordering by resolution (4K / 2160p > 1080p > 720p), codec (Dolby Vision, HDR10+, Remux), and healthy seeder counts.
- **Dead Stream Filtering**: Automatically discards dead streams (0 seeders) or unplayable items, presenting only viable streams.
- **Clear Cloud Cache Badging**: Clearly marks cached cloud items with `[115⚡]` or `[PikPak⚡]` for instant playback, while pending magnets display `[115🧲]`.

### 3. 💬 Native Chinese Subtitle Ecosystem (全自动中文字幕生态)
- **Multi-Source Subtitle Indexers**: Integrated search across **SubHD**, **Shooter (伪射手)**, and **Zimuku**.
- **Smart Encoding Auto-Detection**: Uses `iconv-lite` to automatically detect and transcode diverse Chinese encodings (GBK, GB18030, Big5, UTF-8, UTF-16LE/BE) into clean UTF-8 VTT/SRT, eliminating subtitle mojibake and missing glyphs.
- **Archive Extraction & File Matching**: Automatically unzips `.zip` and `.rar` subtitle packages via `adm-zip`, analyzing filename tokens to match the exact release and episode.
- **Language Preference Priority**: Flexible sorting by Bilingual (双语), Simplified (简体中文), or Traditional (繁体中文).
- **Third-Party Client Compatibility**: Compatible with Stremio, Harbor, and AIOStreams.

### 4. 🌐 Pure Plugin URL Architecture (纯净插件 URL & 动态配置)
- **Zero-Reinstall Clean URL**: Install once via `http://127.0.0.1:7000/manifest.json`.
- **Dynamic Configuration Updates**: Any adjustments saved in the `/configure` Web UI take effect immediately on the server — no need to uninstall or re-add the plugin in Stremio.
- **Encrypted Parameter Fallback**: Fully backwards-compatible with `/:config/manifest.json` parameter endpoints.

### 5. 🛠️ Zero-Dependency Windows Tooling (零依赖 Windows 管理工具箱)
- **`start.bat`**: Interactive console launcher with live log streaming (enforces UTF-8 Code Page 65001, suppressing PowerShell `NativeCommandError` noise and Emoji mojibake).
- **`start-background.vbs` / `start-background.bat`**: 100% silent background daemon with zero CMD popup window and PID tracking in `stremlist.pid`.
- **`stop.bat`**: One-click shutdown script that terminates active server processes and frees port 7000.
- **`autostart-enable.bat` / `autostart-disable.bat`**: One-click Windows startup integration.
- **Auto-Portable Node.js**: Automatically downloads portable Node.js v20 LTS into `.bin` if not installed on the system.

---

## 🏗️ Architecture

```
+-----------------------------------------------------------------------------------+
|                                  Stremio Client                                   |
+-----------------------------------------------------------------------------------+
       | 1. Stream Query /stream/:type/:id.json          ^ 4. 302 Playback Redirect
       |    Subtitle Query /subtitles/:type/:id.json     |    (Direct / Local Proxy)
       v                                                 |
+--------------------------------------------------------+--------------------------+
|                                StremList Server                                   |
|                                                                                   |
|  [HTTP Router & Middleware]                                                       |
|   - GET /manifest.json (Clean URL) & /:config/manifest.json                       |
|   - GET /stream/:type/:id.json (Aggregated & Sorted Streams)                      |
|   - GET /subtitles/:type/:id.json (Cleaned & Encoded Subtitles)                   |
|   - GET /play/:hash (302 Redirect Handler)                                        |
|   - GET /configure & POST /api/config/save (Web Configuration)                    |
|   - GET /logo.png & /health (Static Assets & Monitoring)                          |
|                                                                                   |
|  [Scraper Aggregator & Sorter]         [OpenList Client & Playback Resolver]      |
|   - Parallel Torrentio & Comet query    - Cache sniffing (115 & PikPak)           |
|   - infoHash deduplication              - Folder preparation & offline submission |
|   - Seeder merging & 4K/HDR sorting     - 115 /d/ local proxy stream with HMAC    |
|                                                                                   |
|  [Chinese Subtitles Engine]                                                       |
|   - SubHD, Shooter & Zimuku scrapers                                              |
|   - Auto charset transcoding (iconv-lite: GBK/Big5 -> UTF-8)                      |
|   - Archive auto-extraction (.zip/.rar via adm-zip) & filename matcher            |
+-----------------------------------------------------------------------------------+
       | (Parallel Scraping)                     | (REST API)         | (Scraping)
       v                                         v                    v
+--------------------------+          +--------------------+  +---------------------+
| Upstream Indexers        |          | OpenList Service   |  | Subtitle Repos      |
| - Torrentio              |          | - 115 (/115)       |  | - SubHD             |
| - Comet                  |          | - PikPak (/pikpak) |  | - Shooter (伪射手)  |
+--------------------------+          +--------------------+  +---------------------+
```

---

## 🚀 Quick Start (快速开始)

### Method 1: Windows One-Click (Windows 推荐)

1. **First-Time Setup**:
   - Double-click **`start.bat`**.
   - Your browser will open `http://127.0.0.1:7000/configure`.
   - Enter your OpenList admin credentials, click **🔑 一键获取 Token**, then click **⚡ Install Addon in Stremio**.
   - **Install once and forget!** Stremio syncs your addon in your account across all devices.

2. **Silent Background Daemon**:
   - Double-click **`start-background.vbs`** (or **`start-background.bat`**).
   - Runs 100% silently in the background with **no command prompt window**.
   - Need to adjust settings later? Just double-click **`configure.bat`**.

3. **Auto-Start on Boot (开机自启)**:
   - Double-click **`autostart-enable.bat`** to register StremList in Windows Startup.
   - Run **`autostart-disable.bat`** to remove autostart at any time.

4. **Shutdown Service**:
   - Double-click **`stop.bat`** to terminate the service and free port 7000.

---

### Method 2: Cross-Platform (Linux / macOS / Docker)

```bash
# 1. Clone repository
git clone https://github.com/JinxAgain/StremList.git
cd StremList

# 2. Install dependencies
npm install

# 3. Create .env config
cp .env.example .env

# 4. Build and start
npm run build
npm start
```

---

## ⚙️ OpenList & Cloud Drive Configuration

### 1. 115 Cloud Storage Setup (Crucial)
115 CDN requires authorized signatures on external players. Direct connections will be blocked with `403 Forbidden`.

To ensure smooth playback:
1. In OpenList Admin Panel (`http://127.0.0.1:5244/@manage/storages`), click **Edit** on your `115` storage.
2. Enable **Web Proxy** (`web_proxy`: ON).
3. Set **WebDAV Policy** to **Local Proxy** (`native_proxy` / 本地代理).
4. Save settings.

> [!NOTE]
> When you test connections via StremList's Web UI with an OpenList admin account, StremList will **automatically enable Web Proxy and Local Proxy** for your 115 drive.

### 2. PikPak Storage Setup
Mount PikPak in OpenList under `/pikpak` or `/PikPak`. PikPak CDN links support direct streaming out of the box.

---

## 🛠️ Environment Variables (.env 全量配置表)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `7000` | HTTP port for StremList addon server |
| `OPENLIST_URL` | `http://127.0.0.1:5244` | OpenList server URL |
| `OPENLIST_TOKEN` | `""` | OpenList API Token (JWT or permanent token) |
| `DEFAULT_DRIVE` | `115` | Default target cloud drive (`115` or `pikpak`) |
| `TORRENTIO_URL` | `https://torrentio.strem.fun` | Upstream Torrentio scraper URL |
| `COMET_URL` | `https://comet.elfhosted.com` | Upstream Comet scraper URL |
| `POLL_TIMEOUT` | `25` | Maximum seconds to wait for offline download completion |
| `POLL_INTERVAL` | `3000` | Polling interval in milliseconds (3s default to avoid cloud rate limits) |
| `SUBTITLE_ENABLED`| `true` | Enable or disable Chinese subtitles engine |
| `SUBTITLE_LANG` | `bilingual` | Subtitle preference (`bilingual`, `zh-CN`, `zh-TW`) |
| `SUBTITLE_SOURCE` | `all` | Active subtitle scrapers (`all`, `subhd`, `shooter`, `zimuku`) |
| `SUBTITLE_MAX_RESULTS`| `8` | Maximum number of subtitle streams returned per title |
| `SUBTITLE_PROXY` | `""` | Optional HTTP/HTTPS proxy for subtitle providers |

---

## 📦 Multi-Flavor Release Packaging (分发版本矩阵)

Run `.\pack.bat` to build all production-ready distribution archives:

| Flavor | Target Archive | Subtitles | Description |
| :--- | :--- | :--- | :--- |
| **Plus** | `StremList-Plus-Windows.zip` | Enabled | Full-featured edition (115/PikPak + Chinese Subtitles). |
| **Lite** | `StremList-Lite-Windows.zip` | Disabled | Pure cloud streaming edition without subtitle scraper overhead. |
| **Debug**| `StremList-Windows-Debug.zip`| Enabled | Complete package with interactive console, live logs, and diagnostic tools. |

---

## 🧪 Testing

StremList includes a comprehensive automated test suite covering unit tests, scraper aggregation, encoding transcoding, and end-to-end integration:

```bash
npm test
```

---

## 🙏 Acknowledgments & Credits (致谢与致敬)

StremList stands on the shoulders of the open-source community and incredible media streaming projects:

- **[OpenList](https://fox.oplist.org) / [AList](https://alist.nn.ci/)**: The powerful cloud drive mounting and offline download engine that powers 115 and PikPak storage.
- **[Stremio](https://www.stremio.com/)**: The modern, extensible media center that revolutionizes home entertainment.
- **[Torrentio](https://torrentio.strem.fun/)**: The quintessential torrent provider addon for Stremio.
- **[Comet](https://github.com/g0ldy/comet)**: Exceptional, lightning-fast Stremio torrent indexing backend.
- **[SubHD](https://subhd.tv/) & [Shooter (伪射手 / 射手网)](https://assrt.net/)**: Invaluable subtitle resources created and maintained for Chinese film enthusiasts.
- **[AIOStreams](https://github.com/Viren070/AIOStreams) & [Harbor](https://github.com/mcaram/harbor)**: Inspiring architectural references for multi-addon aggregation and cross-platform desktop streaming.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
