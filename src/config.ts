import dotenv from 'dotenv';

dotenv.config();

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

const DEFAULT_CONFIG: AppConfig = {
  port: 7000,
  openlistUrl: 'http://127.0.0.1:5244',
  openlistToken: '',
  defaultDrive: '115',
  torrentioUrl: 'https://torrentio.strem.fun',
  cometUrl: 'https://comet.elfhosted.com',
  pollTimeout: 25,
  pollInterval: 1500
};

function cleanUrl(url?: string): string {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}

export function loadConfig(rawConfigStr?: string): AppConfig {
  const envConfig: AppConfig = {
    port: Number(process.env.PORT) || DEFAULT_CONFIG.port,
    openlistUrl: cleanUrl(process.env.OPENLIST_URL) || DEFAULT_CONFIG.openlistUrl,
    openlistToken: process.env.OPENLIST_TOKEN?.trim() || DEFAULT_CONFIG.openlistToken,
    defaultDrive: (process.env.DEFAULT_DRIVE?.toLowerCase() === 'pikpak' ? 'pikpak' : '115') as '115' | 'pikpak',
    torrentioUrl: cleanUrl(process.env.TORRENTIO_URL) || DEFAULT_CONFIG.torrentioUrl,
    cometUrl: cleanUrl(process.env.COMET_URL) || DEFAULT_CONFIG.cometUrl,
    pollTimeout: Number(process.env.POLL_TIMEOUT) || DEFAULT_CONFIG.pollTimeout,
    pollInterval: Number(process.env.POLL_INTERVAL) || DEFAULT_CONFIG.pollInterval
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
    // If URL token is a temporary JWT (starts with ey) and server has a permanent token (starts with openlist-), prefer the permanent one
    if (effectiveToken.startsWith('ey') && envConfig.openlistToken.startsWith('openlist-')) {
      effectiveToken = envConfig.openlistToken;
    }

    return {
      port: parsed.port || envConfig.port,
      openlistUrl: cleanUrl(parsed.openlistUrl) || envConfig.openlistUrl,
      openlistToken: effectiveToken,
      defaultDrive: parsed.defaultDrive?.toLowerCase() === 'pikpak' ? 'pikpak' : (parsed.defaultDrive ? '115' : envConfig.defaultDrive),
      torrentioUrl: cleanUrl(parsed.torrentioUrl) || envConfig.torrentioUrl,
      cometUrl: cleanUrl(parsed.cometUrl) || envConfig.cometUrl,
      pollTimeout: Number(parsed.pollTimeout) || envConfig.pollTimeout,
      pollInterval: Number(parsed.pollInterval) || envConfig.pollInterval
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

  return Buffer.from(JSON.stringify(cleanConfig)).toString('base64url');
}
