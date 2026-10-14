import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, encodeConfig } from '../src/config.js';

describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads default config from environment variables', () => {
    process.env.PORT = '8000';
    process.env.OPENLIST_URL = 'http://127.0.0.1:5244';
    process.env.OPENLIST_TOKEN = 'secret-token';
    process.env.DEFAULT_DRIVE = '115';
    process.env.POLL_TIMEOUT = '30';
    process.env.POLL_INTERVAL = '2000';

    process.env.TORRENTIO_URL = 'https://torrentio.strem.fun';
    process.env.COMET_URL = 'https://comet.elfhosted.com';

    const config = loadConfig();

    expect(config.port).toBe(8000);
    expect(config.openlistUrl).toBe('http://127.0.0.1:5244');
    expect(config.openlistToken).toBe('secret-token');
    expect(config.defaultDrive).toBe('115');
    expect(config.pollTimeout).toBe(30);
    expect(config.pollInterval).toBe(2000);
    expect(config.torrentioUrl).toBe('https://torrentio.strem.fun');
    expect(config.cometUrl).toBe('https://comet.elfhosted.com');
  });

  it('provides safe fallbacks if environment variables are not set', () => {
    delete process.env.PORT;
    delete process.env.OPENLIST_URL;
    delete process.env.OPENLIST_TOKEN;
    delete process.env.DEFAULT_DRIVE;
    delete process.env.TORRENTIO_URL;
    delete process.env.COMET_URL;
    delete process.env.POLL_TIMEOUT;
    delete process.env.POLL_INTERVAL;

    const config = loadConfig();

    expect(config.port).toBe(7000);
    expect(config.openlistUrl).toBe('http://127.0.0.1:5244');
    expect(config.openlistToken).toBe('');
    expect(config.defaultDrive).toBe('115');
    expect(config.pollTimeout).toBe(25);
    expect(config.pollInterval).toBe(3000);
  });

  it('encodes and decodes configuration string for URL path', () => {
    const rawPartial = {
      openlistUrl: 'http://192.168.1.100:5244',
      openlistToken: 'my-custom-token',
      defaultDrive: 'pikpak' as const,
      pollTimeout: 20
    };

    const encoded = encodeConfig(rawPartial);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);

    const config = loadConfig(encoded);
    expect(config.openlistUrl).toBe('http://192.168.1.100:5244');
    expect(config.openlistToken).toBe('my-custom-token');
    expect(config.defaultDrive).toBe('pikpak');
    expect(config.pollTimeout).toBe(20);
  });
});
