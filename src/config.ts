import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  openlistUrl: string;
  openlistToken: string;
  openlistUsername?: string;
  openlistPassword?: string;
  defaultDrive: '115' | 'pikpak';
  torrentioUrl: string;
  cometUrl: string;
  pollTimeout: number; // in seconds, default 25
  pollInterval: number; // in ms, default 1500
  subtitleEnabled: boolean;
  subtitleLang: 'bilingual' | 'chs' | 'cht';
  subtitleSource: 'all' | 'subhd' | 'zimuku';
  subtitleMaxResults: number;
  subtitleProxy?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  port: 7000,
  openlistUrl: 'http://127.0.0.1:5244',
  openlistToken: '',
  defaultDrive: '115',
  torrentioUrl: 'https://torrentio.strem.fun',
  cometUrl: 'https://comet.elfhosted.com',
  pollTimeout: 25,
  pollInterval: 1500,
  subtitleEnabled: true,
  subtitleLang: 'bilingual',
  subtitleSource: 'all',
  subtitleMaxResults: 8,
  subtitleProxy: ''
};

function cleanUrl(url?: string): string {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}

export function saveConfigToEnv(updates: Record<string, string | number | undefined>): void {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
    for (const [key, val] of Object.entries(updates)) {
      if (val === undefined) continue;
      const strVal = String(val);
      process.env[key] = strVal;
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${strVal}`);
      } else {
        envContent += `\n${key}=${strVal}`;
      }
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
  } catch (err) {
    console.error('[Config] Failed to persist config to .env:', err);
  }
}

export function loadConfig(rawConfigStr?: string): AppConfig {
  const rawEnvToken = process.env.OPENLIST_TOKEN?.trim() || '';
  const sanitizedEnvToken = rawEnvToken === 'your_openlist_token_here' ? '' : rawEnvToken;

  const envConfig: AppConfig = {
    port: Number(process.env.PORT) || DEFAULT_CONFIG.port,
    openlistUrl: cleanUrl(process.env.OPENLIST_URL) || DEFAULT_CONFIG.openlistUrl,
    openlistToken: sanitizedEnvToken || DEFAULT_CONFIG.openlistToken,
    openlistUsername: process.env.OPENLIST_USERNAME?.trim() || '',
    openlistPassword: process.env.OPENLIST_PASSWORD || '',
    defaultDrive: (process.env.DEFAULT_DRIVE?.toLowerCase() === 'pikpak' ? 'pikpak' : '115') as '115' | 'pikpak',
    torrentioUrl: process.env.TORRENTIO_URL !== undefined ? cleanUrl(process.env.TORRENTIO_URL) : DEFAULT_CONFIG.torrentioUrl,
    cometUrl: process.env.COMET_URL !== undefined ? cleanUrl(process.env.COMET_URL) : DEFAULT_CONFIG.cometUrl,
    pollTimeout: Number(process.env.POLL_TIMEOUT) || DEFAULT_CONFIG.pollTimeout,
    pollInterval: Number(process.env.POLL_INTERVAL) || DEFAULT_CONFIG.pollInterval,
    subtitleEnabled: process.env.SUBTITLE_ENABLED !== 'false',
    subtitleLang: (process.env.SUBTITLE_LANG as 'bilingual' | 'chs' | 'cht') || DEFAULT_CONFIG.subtitleLang,
    subtitleSource: (process.env.SUBTITLE_SOURCE as 'all' | 'subhd' | 'zimuku') || DEFAULT_CONFIG.subtitleSource,
    subtitleMaxResults: Number(process.env.SUBTITLE_MAX_RESULTS) || DEFAULT_CONFIG.subtitleMaxResults,
    subtitleProxy: process.env.SUBTITLE_PROXY?.trim() || DEFAULT_CONFIG.subtitleProxy
  };

  if (!rawConfigStr) {
    return envConfig;
  }

  try {
    let jsonStr = rawConfigStr;
    // Attempt base64 decode if string doesn't start with {
    if (!rawConfigStr.trim().startsWith('{')) {
      jsonStr = Buffer.from(rawConfigStr, 'base64url').toString('utf-8');
      if (!jsonStr.trim().startsWith('{')) {
        jsonStr = Buffer.from(rawConfigStr, 'base64').toString('utf-8');
      }
    }

    const parsed = JSON.parse(jsonStr) as Partial<AppConfig>;

    let effectiveToken = (parsed.openlistToken && parsed.openlistToken.trim())
      ? parsed.openlistToken.trim()
      : envConfig.openlistToken;

    if (effectiveToken === 'your_openlist_token_here') {
      effectiveToken = envConfig.openlistToken;
    }

    // If URL token is a temporary JWT (starts with ey) and server has a permanent token (starts with openlist-), prefer the permanent one
    if (effectiveToken.startsWith('ey') && envConfig.openlistToken.startsWith('openlist-')) {
      effectiveToken = envConfig.openlistToken;
    }

    return {
      port: parsed.port || envConfig.port,
      openlistUrl: cleanUrl(parsed.openlistUrl) || envConfig.openlistUrl,
      openlistToken: effectiveToken,
      openlistUsername: envConfig.openlistUsername,
      openlistPassword: envConfig.openlistPassword,
      defaultDrive: parsed.defaultDrive?.toLowerCase() === 'pikpak' ? 'pikpak' : (parsed.defaultDrive ? '115' : envConfig.defaultDrive),
      torrentioUrl: cleanUrl(parsed.torrentioUrl) || envConfig.torrentioUrl,
      cometUrl: cleanUrl(parsed.cometUrl) || envConfig.cometUrl,
      pollTimeout: Number(parsed.pollTimeout) || envConfig.pollTimeout,
      pollInterval: Number(parsed.pollInterval) || envConfig.pollInterval,
      subtitleEnabled: parsed.subtitleEnabled !== undefined ? parsed.subtitleEnabled : envConfig.subtitleEnabled,
      subtitleLang: parsed.subtitleLang || envConfig.subtitleLang,
      subtitleSource: parsed.subtitleSource || envConfig.subtitleSource,
      subtitleMaxResults: Number(parsed.subtitleMaxResults) || envConfig.subtitleMaxResults,
      subtitleProxy: parsed.subtitleProxy !== undefined ? parsed.subtitleProxy : envConfig.subtitleProxy
    };
  } catch (error) {
    // If decoding or parsing fails, safely fallback to env config
    return envConfig;
  }
}

export function encodeConfig(config: Partial<AppConfig>): string {
  const cleanConfig: Partial<AppConfig> = {};
  if (config.openlistUrl) cleanConfig.openlistUrl = cleanUrl(config.openlistUrl);
  if (config.openlistToken) cleanConfig.openlistToken = config.openlistToken.trim();
  if (config.defaultDrive) cleanConfig.defaultDrive = config.defaultDrive;
  if (config.torrentioUrl) cleanConfig.torrentioUrl = cleanUrl(config.torrentioUrl);
  if (config.cometUrl) cleanConfig.cometUrl = cleanUrl(config.cometUrl);
  if (config.pollTimeout) cleanConfig.pollTimeout = config.pollTimeout;
  if (config.pollInterval) cleanConfig.pollInterval = config.pollInterval;
  if (config.subtitleEnabled !== undefined) cleanConfig.subtitleEnabled = config.subtitleEnabled;
  if (config.subtitleLang) cleanConfig.subtitleLang = config.subtitleLang;
  if (config.subtitleSource) cleanConfig.subtitleSource = config.subtitleSource;
  if (config.subtitleMaxResults) cleanConfig.subtitleMaxResults = config.subtitleMaxResults;
  if (config.subtitleProxy) cleanConfig.subtitleProxy = config.subtitleProxy.trim();

  return Buffer.from(JSON.stringify(cleanConfig)).toString('base64url');
}
