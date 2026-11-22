import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  extractCookieValue,
  subhdSession
} from '../../src/services/subtitles/providers/subhd-session.js';
import { SubhdProvider } from '../../src/services/subtitles/providers/subhd.js';

describe('SubHD WeChat session store and provider flow', () => {
  let tempSessionFile = '';

  beforeEach(() => {
    tempSessionFile = path.join(
      os.tmpdir(),
      `subhd-session-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`
    );
    process.env.SUBHD_SESSION_FILE = tempSessionFile;
    SubhdProvider.clearBlock();
  });

  afterEach(() => {
    subhdSession.clear();
    SubhdProvider.clearBlock();
    delete process.env.SUBHD_SESSION_FILE;
    vi.restoreAllMocks();
  });

  it('extractCookieValue parses cookie values from Set-Cookie string or array', () => {
    expect(
      extractCookieValue(
        [
          'tk_123=abc; Path=/; HttpOnly',
          'wxg=475a82341f2a650abd4bb5be55921b30; Max-Age=2592000; Path=/; HttpOnly'
        ],
        'wxg'
      )
    ).toBe('475a82341f2a650abd4bb5be55921b30');

    expect(extractCookieValue('wxg=val==withEquals; Path=/', 'wxg')).toBe('val==withEquals');
    expect(extractCookieValue(['other=1'], 'wxg')).toBeNull();
    expect(extractCookieValue(undefined, 'wxg')).toBeNull();
  });

  it('handles corrupt session files and expired wxg values gracefully', () => {
    fs.writeFileSync(tempSessionFile, '{not-valid-json', 'utf-8');
    expect(subhdSession.load()).toBeNull();

    const expired = Date.now() - 1000;
    subhdSession.save({
      wxg: 'expired_token',
      domain: 'https://subhd.tv',
      verified: true,
      verifiedAt: expired - 30 * 86400 * 1000,
      expiresAt: expired
    });
    expect(subhdSession.getWxg()).toBe('');

    subhdSession.save({
      wxg: 'active_token',
      domain: 'https://subhd.tv',
      verified: true,
      verifiedAt: Date.now(),
      expiresAt: Date.now() + 86400 * 1000
    });
    expect(subhdSession.getWxg()).toBe('active_token');
    expect(subhdSession.getDomain()).toBe('https://subhd.tv');
  });

  it('requestWechatCode saves unverified wxg cookie and returns QR details', async () => {
    const provider = new SubhdProvider();
    const client = (provider as any).client;
    const postSpy = vi.spyOn(client, 'post').mockResolvedValueOnce({
      status: 200,
      headers: {
        'set-cookie': ['wxg=newhexwxg123; Max-Age=2592000; Path=/; HttpOnly']
      },
      data: { code: '447797' }
    });

    const before = Date.now();
    const res = await provider.requestWechatCode();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(res.code).toBe('447797');
    expect(res.qrUrl).toBe('https://subhd.tv/public/images/wechat-qr.jpg');
    expect(res.expiresAt).toBeGreaterThanOrEqual(before + 4 * 60 * 1000);

    const stored = subhdSession.load();
    expect(stored).not.toBeNull();
    expect(stored?.wxg).toBe('newhexwxg123');
    expect(stored?.domain).toBe('https://subhd.tv');
    expect(stored?.verified).toBe(false);
    expect(stored?.verifiedAt).toBeUndefined();
    expect(stored?.expiresAt).toBeUndefined();
  });

  it('checkWechatStatus returns false with no network calls if session is absent', async () => {
    const provider = new SubhdProvider();
    const client = (provider as any).client;
    const getSpy = vi.spyOn(client, 'get');

    const res = await provider.checkWechatStatus();
    expect(res).toEqual({ verified: false });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('checkWechatStatus persists 30-day verified session and clears block when verified', async () => {
    subhdSession.save({
      wxg: 'pendingwxg',
      domain: 'https://subhd.tv',
      verified: false
    });
    SubhdProvider.markBlocked('wechat_required', 3600, 'test');
    expect(SubhdProvider.isRateLimited()).toBe(true);

    const provider = new SubhdProvider();
    const client = (provider as any).client;
    const getSpy = vi.spyOn(client, 'get').mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: { verified: true }
    });

    const before = Date.now();
    const res = await provider.checkWechatStatus();

    expect(res).toEqual({ verified: true });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(SubhdProvider.isRateLimited()).toBe(false);
    expect(SubhdProvider.getBlockState()).toEqual({ reason: null, until: 0 });

    const stored = subhdSession.load();
    expect(stored?.verified).toBe(true);
    expect(stored?.verifiedAt).toBeGreaterThanOrEqual(before);
    const thirtyDaysMs = 30 * 86400 * 1000;
    expect(stored?.expiresAt).toBeGreaterThanOrEqual(before + thirtyDaysMs - 5000);
    expect(stored?.expiresAt).toBeLessThanOrEqual(Date.now() + thirtyDaysMs + 5000);
  });
});
