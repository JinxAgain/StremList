<div align="center">

<img src="src/public/logo.png" width="132" height="132" alt="StremList 复古影迷图标" style="border-radius: 28px; box-shadow: 0 12px 28px -5px rgba(217, 119, 6, 0.45);" />

# StremList 🎬

**[ English ](README.md)** | **[ 简体中文 ](README_zh.md)**

> 类似 Debrid 体验的 Stremio 聚合插件，深度整合 **OpenList**（115 网盘与 PikPak）、上游磁力索引器（**Torrentio** 与 **Comet**）以及**中文字幕生态**（SubHD 与 字幕库 Zimuku），实现云端极速原画秒播与原生字幕集成。

[![Version](https://img.shields.io/badge/version-0.2.0-amber.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

</div>

---

## 🌟 核心功能特性

### 1. ⚡ 云端极速原画秒播 (Debrid-like)
- **零服务器带宽消耗 (302 原画直链)**：通过 HTTP 302 直接重定向至 OpenList 云端下载直链 (`raw_url`)，流媒体播放不消耗 StremList 主机流量。
- **115 防盗链保护与本地代理**：自动识别 115 数据流并通过 OpenList 原生 `/d/` 本地 HMAC 代理转发，彻底解决外部播放器（Stremio / ExoPlayer / mpv）中的 `403 Forbidden` (`invalid signature`) 报错。
- **跨网盘秒传探测**：在提交离线下载前，智能探测 **115** 与 **PikPak**。若任意网盘已缓存该资源，500ms 内即刻起播，避免重复下载。
- **离线任务智能轮询**：自动向 OpenList 提交磁力哈希，高频轮询网盘目录，并在媒体文件就绪瞬间完成 302 起播重定向。
- **任务去重与防冲突保护**：内置 15 分钟离线任务去重窗口，防止播放器因超时重试向网盘重复派发相同下载任务或生成冲突重名文件夹。
- **智能广告短片与样片过滤**：自动过滤压制组宣传短片、网址水印和 sample 样片，全局比对并始终优先选取完整正片或剧集。

### 2. 🔍 智能多源聚合与清晰度排序
- **多源并发抓取**：并行并发检索 **Torrentio** 与 **Comet**，各源独立超时与容错隔离。
- **Hash 去重与做种数合并**：基于 `infoHash` 合并重复磁力，并取各索引器汇报的最大做种数。
- **影迷级画质阶梯排序**：按分辨率（4K / 2160p > 1080p > 720p）、编码与规格（Dolby Vision、HDR10+、Remux）及做种健康度自动排序。
- **死种智能剔除**：自动过滤 0 做种数或失效磁力，只呈现真正可用的流媒体资源。
- **精准云端秒播角标**：仅当网盘内实际存在非空媒体文件时才标记 `[115⚡]` 或 `[PikPak⚡]`，待离线磁力标注为 `[115🧲]`。

### 3. 💬 原生中文字幕生态
- **多源字幕索引**：深度集成 **SubHD** 与 **字幕库 (Zimuku)** 双源索引。
- **智能编码自动转码**：采用 `iconv-lite` 自动识别并转码常见中文编码（GBK、GB18030、Big5、UTF-8、UTF-16），输出纯净 UTF-8 VTT/SRT，彻底解决字幕乱码与缺字。
- **压缩包自动解压与智能匹配**：通过 `adm-zip` 自动解压 `.zip` 与 `.rar` 字幕包，智能分词匹配剧集与对应压制版本。
- **语言偏好灵活排序**：支持双语优先（Bilingual）、简体中文（chs）、繁体中文（cht）排序。
- **第三方客户端完全兼容**：完美兼容 Stremio 原生播放器、Harbor 以及 AIOStreams。

### 4. 🌐 纯净插件 URL 架构与动态配置
- **一次安装永久生效**：通过 `http://127.0.0.1:7000/manifest.json` 单一纯净 URL 安装。
- **热配置即时生效**：在 `/configure` 网页控制台保存配置即可在服务端即时生效，无需在 Stremio 中反复卸载重装插件。
- **加密参数端点向下兼容**：完全兼容 `/:config/manifest.json` 参数化安装方式。

### 5. 🛠️ Windows 零依赖管理工具箱
- **`start.bat`**：交互式控制台启动器，支持实时日志输出（强制 UTF-8 65001 代码页，屏蔽 PowerShell 干扰并杜绝 Emoji 乱码）。
- **`start-background.vbs` / `start-background.bat`**：100% 静默后台运行，无任何 CMD 弹窗，支持 `stremlist.pid` 进程追踪。
- **`stop.bat`**：一键关闭服务并释放 7000 端口。
- **`autostart-enable.bat` / `autostart-disable.bat`**：一键注册或移除 Windows 开机自启。
- **便携 Node.js 自动拉取**：系统未安装 Node.js 时自动下载 LTS 便携版至 `.bin`，零环境门槛开箱即用。

---

## 🏗️ 架构设计图

```
+-----------------------------------------------------------------------------------+
|                                  Stremio 客户端                                   |
+-----------------------------------------------------------------------------------+
       | 1. 查询流媒体 /stream/:type/:id.json            ^ 4. 302 播放重定向
       |    查询字幕 /subtitles/:type/:id.json           |    (原画直链 / 本地代理流)
       v                                                 |
+--------------------------------------------------------+--------------------------+
|                                StremList 服务端                                   |
|                                                                                   |
|  [HTTP 路由与中间件]                                                              |
|   - GET /manifest.json (纯净 URL) & /:config/manifest.json                        |
|   - GET /stream/:type/:id.json (多源聚合与清晰度排序流)                           |
|   - GET /subtitles/:type/:id.json (清洗并转码后的中文字幕)                        |
|   - GET /play/:hash (302 重定向处理中心)                                          |
|   - GET /configure & POST /api/config/save (Web 配置控制台)                       |
|   - GET /logo.png & /health (静态资源与健康监控)                                  |
|                                                                                   |
|  [刮削聚合与排序引擎]                  [OpenList 客户端与播放解析器]              |
|   - 并行查询 Torrentio 与 Comet         - 跨网盘秒传探测 (115 与 PikPak)          |
|   - infoHash 去重与元数据合并           - 离线任务智能去重与防冲突                |
|   - 做种数合并与 4K/HDR 阶梯排序        - 树形递归发现与正片择优                  |
|                                         - 115 /d/ 本地代理流 (HMAC 签名防盗链)    |
|                                                                                   |
|  [中文字幕引擎]                                                                   |
|   - SubHD 与 字幕库 (Zimuku) 双源抓取                                             |
|   - 智能编码识别与转码 (iconv-lite: GBK/Big5 -> UTF-8)                            |
|   - 压缩包自动解压 (.zip/.rar) 与智能文件名匹配                                   |
+-----------------------------------------------------------------------------------+
       | (并发抓取)                              | (REST API)         | (字幕抓取)
       v                                         v                    v
+--------------------------+          +--------------------+  +---------------------+
| 上游磁力索引器           |          | OpenList 网盘服务  |  | 字幕资源库          |
| - Torrentio              |          | - 115 (/115)       |  | - SubHD             |
| - Comet                  |          | - PikPak (/pikpak) |  | - 字幕库 (Zimuku)   |
+--------------------------+          +--------------------+  +---------------------+
```

---

## 🚀 快速上手

### 方式一：Windows 一键启动（推荐）

1. **首次配置**：
   - 双击运行 **`start.bat`**。
   - 浏览器将自动打开配置控制台 `http://127.0.0.1:7000/configure`。
   - 输入 OpenList 管理员账号密码，点击 **🔑 一键获取 Token**，接着点击 **⚡ Install Addon in Stremio** 安装插件。
   - **一次安装，全平台同步**！Stremio 账号会自动将插件同步至您的手机、电视、平板等所有设备。

2. **静默后台守护运行**：
   - 双击 **`start-background.vbs`**（或 **`start-background.bat`**）。
   - 100% 静默无黑框后台运行。
   - 后续如需修改配置，随时双击 **`configure.bat`** 即可打开配置页。

3. **开机自启动**：
   - 双击 **`autostart-enable.bat`** 注册 Windows 开机自启。
   - 随时双击 **`autostart-disable.bat`** 取消开机自启。

4. **关闭退出服务**：
   - 双击 **`stop.bat`** 即可优雅终止服务进程并释放 7000 端口。

---

### 方式二：跨平台部署 (Linux / macOS / Docker)

```bash
# 1. 克隆仓库
git clone https://github.com/JinxAgain/StremList.git
cd StremList

# 2. 安装项目依赖
npm install

# 3. 创建配置文件
cp .env.example .env

# 4. 构建并启动服务
npm run build
npm start
```

---

## ⚙️ OpenList 与云盘配置指南

### 1. 115 网盘配置（关键必读）

115 官方 CDN 限制外部播放器直连，直接播放会触发 `403 Forbidden`（防盗链签名失效）。

**优化步骤**：
1. 打开 OpenList 管理后台（`http://127.0.0.1:5244/@manage/storages`），点击 **编辑** 您的 `115` 存储。
2. 开启 **Web 代理**（`web_proxy`: 开启）。
3. 将 **WebDAV 策略** 设置为 **本地代理**（`native_proxy` / 本地代理）。
4. 保存配置。

> [!TIP]
> 在 StremList 的 Web 配置控制台使用管理员账号测试连接时，StremList 会**全自动检测并为您优化开启** 115 的 Web 代理与本地代理！

### 2. PikPak 网盘配置（关键必读）

在 OpenList 中挂载 PikPak 存储，挂载路径设为 `/pikpak` 或 `/PikPak`。

> [!IMPORTANT]
> 在 OpenList 存储管理中编辑 PikPak 时，务必**关闭【禁用媒体链接】**（取消勾选“禁用媒体链接”，保持开启媒体直链），以允许外部播放器直接获取 PikPak 官方原画直链播放。StremList 登录测试时也会全自动为您优化关闭此选项！

---

## 🛠️ 环境变量完整配置表 (.env)

| 环境变量名 | 默认值 | 配置说明 |
| :--- | :--- | :--- |
| `PORT` | `7000` | StremList 插件服务端 HTTP 监听端口 |
| `OPENLIST_URL` | `http://127.0.0.1:5244` | OpenList 服务完整访问地址 |
| `OPENLIST_TOKEN` | `""` | OpenList API Token（JWT 或后台永久令牌） |
| `DEFAULT_DRIVE` | `115` | 默认离线下载目标网盘（`115` 或 `pikpak`） |
| `TORRENTIO_URL` | `https://torrentio.strem.fun` | 上游 Torrentio 刮削器地址 |
| `COMET_URL` | `https://comet.elfhosted.com` | 上游 Comet 刮削器地址 |
| `POLL_TIMEOUT` | `30` | 离线下载轮询等待最大秒数 |
| `POLL_INTERVAL` | `3000` | 网盘轮询检查间隔时间（毫秒，默认 3s 避免频率超限） |
| `SUBTITLE_ENABLED` | `true` | 是否开启内置中文字幕聚合引擎 |
| `SUBTITLE_LANG` | `bilingual` | 默认字幕语言偏好（`bilingual` 双语, `chs` 简体, `cht` 繁体） |
| `SUBTITLE_SOURCE` | `all` | 启用的字幕来源（`all` 全部, `subhd`, `zimuku`） |
| `SUBTITLE_MAX_RESULTS` | `8` | 单个媒体最大返回的字幕条数 |
| `SUBTITLE_PROXY` | `""` | 访问字幕源的可选 HTTP/HTTPS 代理地址 |

---

## 📦 多版本打包与发行矩阵

运行 `.\pack.bat` 即可一键生成各发行版本的压缩分发包：

| 版本规格 | 输出压缩包文件名 | 内置字幕 | 版本说明 |
| :--- | :--- | :--- | :--- |
| **Plus** | `StremList-Plus-Windows.zip` | 开启 | 全功能旗舰版（115/PikPak 秒播 + 中文字幕自动聚合）。 |
| **Lite** | `StremList-Lite-Windows.zip` | 关闭 | 纯净轻量版，专为不需要中文字幕模块的用户设计。 |
| **Debug** | `StremList-Windows-Debug.zip` | 开启 | 完整调试版，包含交互式运行控制台、实时日志追踪与诊断工具。 |

---

## 🧪 测试验证

StremList 拥有完善的自动化单元测试与集成测试覆盖，包含流媒体聚合、画质排序、字符集转码及全链路播放解析：

```bash
npm test
```

---

## 🙏 致谢与鸣谢

StremList 离不开开源社区与优秀流媒体生态项目的启发与支持，特此致敬：

- **[OpenList](https://fox.oplist.org) / [AList](https://alist.nn.ci/)**：卓越强大的多网盘挂载与离线下载引擎，为 115 与 PikPak 云端播放提供核心底座。
- **[Stremio](https://www.stremio.com/)**：现代、极致且可扩展的家庭流媒体中心。
- **[Torrentio](https://torrentio.strem.fun/)**：Stremio 社区标杆级的磁力索引与提供器。
- **[Comet](https://github.com/g0ldy/comet)**：极速高品质的 Stremio 磁力索引后端。
- **[SubHD](https://subhd.tv/) & [字幕库 (Zimuku)](https://zmk.pw/)**：广大影迷爱好者长期维护的中文优质字幕宝库。
- **[AIOStreams](https://github.com/Viren070/AIOStreams) & [Harbor](https://github.com/mcaram/harbor)**：提供卓越架构参考的插件聚合与桌面端流媒体播放器。

---

## 📄 开源许可证

本项目基于 MIT License 协议开源。详见 [LICENSE](LICENSE) 文件。
