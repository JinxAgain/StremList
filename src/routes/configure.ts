import { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import axios from 'axios';
import { loadConfig, saveConfigToEnv } from '../config.js';
import { OpenListClient } from '../services/openlist/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function getConfigureHtmlPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'src/public/configure.html'),
    path.resolve(__dirname, '../public/configure.html'),
    path.resolve(__dirname, '../../src/public/configure.html'),
    path.resolve(process.cwd(), 'dist/public/configure.html')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

export function handleConfigure(_req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const htmlPath = getConfigureHtmlPath();
  try {
    const config = loadConfig();
    let html = fs.readFileSync(htmlPath, 'utf-8');

    // Pre-populate input fields with server config
    html = html.replace('value="http://127.0.0.1:5244"', `value="${config.openlistUrl}"`);
    if (config.openlistToken && config.openlistToken !== 'your_openlist_token_here') {
      html = html.replace('id="openlistToken"', `id="openlistToken" value="${config.openlistToken}"`);
    }
    if (config.defaultDrive.toLowerCase() === 'pikpak') {
      html = html.replace('<option value="115" selected>', '<option value="115">');
      html = html.replace('<option value="pikpak">', '<option value="pikpak" selected>');
    }
    if (config.torrentioUrl) {
      html = html.replace('value="https://torrentio.strem.fun"', `value="${config.torrentioUrl}"`);
    }
    if (config.cometUrl) {
      html = html.replace('value="https://comet.elfhosted.com"', `value="${config.cometUrl}"`);
    }

    // Pre-populate subtitle configuration
    if (!config.subtitleEnabled) {
      html = html.replace('id="subtitleEnabled" checked', 'id="subtitleEnabled"');
    }
    if (config.subtitleLang) {
      html = html.replace(`id="subtitleLang_${config.subtitleLang}"`, `id="subtitleLang_${config.subtitleLang}" selected`);
    }
    if (config.subtitleSource) {
      html = html.replace(`id="subtitleSource_${config.subtitleSource}"`, `id="subtitleSource_${config.subtitleSource}" selected`);
    }
    if (config.subtitleMaxResults) {
      html = html.replace(`id="subtitleMax_${config.subtitleMaxResults}"`, `id="subtitleMax_${config.subtitleMaxResults}" selected`);
    }
    if (config.subtitleProxy) {
      html = html.replace('id="subtitleProxy"', `id="subtitleProxy" value="${config.subtitleProxy}"`);
    }

    return res.send(html);
  } catch {
    return res.sendFile(htmlPath);
  }
}

export async function handleSaveConfig(req: Request, res: Response) {
  try {
    const {
      openlistUrl,
      openlistToken,
      defaultDrive,
      torrentioUrl,
      cometUrl,
      subtitleEnabled,
      subtitleLang,
      subtitleSource,
      subtitleMaxResults,
      subtitleProxy
    } = req.body || {};

    const updates: Record<string, string> = {};
    if (openlistUrl) updates['OPENLIST_URL'] = openlistUrl.trim().replace(/\/+$/, '');
    if (openlistToken !== undefined) updates['OPENLIST_TOKEN'] = openlistToken.trim();
    if (defaultDrive) updates['DEFAULT_DRIVE'] = defaultDrive.toLowerCase() === 'pikpak' ? 'pikpak' : '115';
    if (torrentioUrl !== undefined) updates['TORRENTIO_URL'] = torrentioUrl.trim();
    if (cometUrl !== undefined) updates['COMET_URL'] = cometUrl.trim();

    if (subtitleEnabled !== undefined) updates['SUBTITLE_ENABLED'] = String(subtitleEnabled);
    if (subtitleLang) updates['SUBTITLE_LANG'] = String(subtitleLang);
    if (subtitleSource) updates['SUBTITLE_SOURCE'] = String(subtitleSource);
    if (subtitleMaxResults !== undefined) updates['SUBTITLE_MAX_RESULTS'] = String(subtitleMaxResults);
    if (subtitleProxy !== undefined) updates['SUBTITLE_PROXY'] = String(subtitleProxy).trim();

    saveConfigToEnv(updates);
    return res.json({ success: true, message: 'Configuration saved successfully to .env' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function handleOpenListLogin(req: Request, res: Response) {
  try {
    const { url, username, password } = req.body;
    if (!url || !username || !password) {
      return res.status(400).json({ success: false, message: 'URL, username, and password are required' });
    }
    const cleanUrl = url.replace(/\/+$/, '');
    const loginRes = await axios.post(`${cleanUrl}/api/auth/login`, {
      username,
      password
    }, { timeout: 8000 });

    if (loginRes.data && loginRes.data.code === 200 && loginRes.data.data?.token) {
      const sessionToken = loginRes.data.data.token;
      let effectiveToken = sessionToken;
      let isPermanent = false;

      // Try discovering permanent API token from OpenList admin settings
      try {
        const settingRes = await axios.get(`${cleanUrl}/api/admin/setting/get?key=token`, {
          headers: { Authorization: sessionToken },
          timeout: 3000
        });
        if (settingRes.data?.code === 200 && settingRes.data?.data?.value) {
          const permVal = String(settingRes.data.data.value).trim();
          if (permVal.length > 0) {
            effectiveToken = permVal;
            isPermanent = true;
            console.log(`[OpenList] 🔑 Discovered permanent API token (${effectiveToken.slice(0, 10)}...) from OpenList admin settings!`);
          }
        }
      } catch {}

      // Persist credentials and token to .env for zero-maintenance auto-refresh
      saveConfigToEnv({
        OPENLIST_URL: cleanUrl,
        OPENLIST_TOKEN: effectiveToken,
        OPENLIST_USERNAME: username,
        OPENLIST_PASSWORD: password
      });

      // Automatically ensure 115 Web Proxy is enabled for smooth playback
      try {
        const client = new OpenListClient(cleanUrl, effectiveToken);
        await client.ensure115WebProxy();
      } catch {}

      return res.json({ success: true, token: effectiveToken, isPermanent });
    }

    return res.json({
      success: false,
      message: loginRes.data?.message || 'Invalid username or password'
    });
  } catch (error: any) {
    const msg = error.response?.data?.message || error.message;
    return res.json({ success: false, message: msg });
  }
}

export async function handleOpenListTest(req: Request, res: Response) {
  try {
    const { url, token } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: 'URL is required' });
    }
    const cleanUrl = url.replace(/\/+$/, '');
    const listRes = await axios.post(`${cleanUrl}/api/fs/list`, {
      path: '/',
      refresh: false
    }, {
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: token } : {})
      }
    });

    if (listRes.data && listRes.data.code === 200) {
      const items = listRes.data.data?.content || [];
      const drives = items.filter((i: any) => i.is_dir).map((i: any) => i.name);

      let proxyNotice: string | undefined;
      const has115 = drives.some((d: string) => d.toLowerCase().includes('115'));
      if (has115 && token) {
        try {
          const client = new OpenListClient(cleanUrl, token);
          const enabled = await client.ensure115WebProxy();
          if (enabled) {
            proxyNotice = '已自动为 115 开启 Web 本地代理，Stremio 可直接流畅播放！';
          }
        } catch {}
      }

      return res.json({ success: true, drives, proxyNotice });
    }

    return res.json({
      success: false,
      code: listRes.data?.code,
      message: listRes.data?.message || 'Access denied'
    });
  } catch (error: any) {
    const code = error.response?.status;
    const msg = error.response?.data?.message || error.message;
    return res.json({ success: false, code, message: msg });
  }
}
