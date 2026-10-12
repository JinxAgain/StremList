import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('AppConfig Subtitle Settings', () => {
  it('loads default subtitle configuration', () => {
    const cfg = loadConfig();
    expect(cfg.subtitleEnabled).toBe(true);
    expect(cfg.subtitleLang).toBe('bilingual');
    expect(cfg.subtitleSource).toBe('all');
    expect(cfg.subtitleMaxResults).toBe(8);
  });

  it('parses base64 encoded subtitle configuration override', () => {
    const customConfig = {
      subtitleEnabled: false,
      subtitleLang: 'chs' as const,
      subtitleSource: 'zimuku' as const,
      subtitleMaxResults: 5
    };
    const b64 = Buffer.from(JSON.stringify(customConfig)).toString('base64url');
    const cfg = loadConfig(b64);
    expect(cfg.subtitleEnabled).toBe(false);
    expect(cfg.subtitleLang).toBe('chs');
    expect(cfg.subtitleSource).toBe('zimuku');
    expect(cfg.subtitleMaxResults).toBe(5);
  });
});
