import fs from 'fs';
import path from 'path';

export interface SubhdSessionData {
  wxg: string;
  domain: string;
  verified: boolean;
  verifiedAt?: number;
  expiresAt?: number;
  updatedAt: number;
}

const SESSION_TTL_MS = 30 * 86400 * 1000;

function getSessionFilePath(): string {
  return process.env.SUBHD_SESSION_FILE || path.resolve(process.cwd(), 'data/subhd-session.json');
}

/**
 * Extracts a named cookie value from Set-Cookie response headers.
 */
export function extractCookieValue(
  setCookie: string[] | string | undefined,
  name: string
): string | null {
  if (!setCookie || !name) return null;
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const header of headers) {
    if (typeof header !== 'string') continue;
    const firstPart = header.split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = firstPart.slice(0, eqIdx).trim();
    const val = firstPart.slice(eqIdx + 1).trim();
    if (key === name && val) {
      return val;
    }
  }
  return null;
}

class SubhdSessionStore {
  public load(): SubhdSessionData | null {
    const filePath = getSessionFilePath();
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.wxg !== 'string' || !parsed.wxg) {
        return null;
      }
      return {
        wxg: parsed.wxg,
        domain: typeof parsed.domain === 'string' ? parsed.domain : '',
        verified: Boolean(parsed.verified),
        verifiedAt: typeof parsed.verifiedAt === 'number' ? parsed.verifiedAt : undefined,
        expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
      };
    } catch {
      return null;
    }
  }

  public save(partial: Partial<SubhdSessionData>): SubhdSessionData {
    const filePath = getSessionFilePath();
    const existing = this.load();
    const merged: SubhdSessionData = {
      wxg: existing?.wxg || '',
      domain: existing?.domain || '',
      verified: existing?.verified ?? false,
      ...(existing?.verifiedAt !== undefined ? { verifiedAt: existing.verifiedAt } : {}),
      ...(existing?.expiresAt !== undefined ? { expiresAt: existing.expiresAt } : {}),
      ...partial,
      updatedAt: Date.now()
    };

    if ('verifiedAt' in partial && partial.verifiedAt === undefined) {
      delete merged.verifiedAt;
    }
    if ('expiresAt' in partial && partial.expiresAt === undefined) {
      delete merged.expiresAt;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  }

  public clear(): void {
    const filePath = getSessionFilePath();
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }

  public getWxg(): string {
    const session = this.load();
    if (!session || !session.wxg) return '';
    if (session.verified && session.expiresAt && session.expiresAt < Date.now()) {
      return '';
    }
    return session.wxg;
  }

  public getDomain(): string {
    return this.load()?.domain || '';
  }

  public markVerified(): SubhdSessionData | null {
    const session = this.load();
    if (!session || !session.wxg) return null;
    const now = Date.now();
    return this.save({
      verified: true,
      verifiedAt: now,
      expiresAt: now + SESSION_TTL_MS
    });
  }

  public markUnverified(): SubhdSessionData | null {
    const session = this.load();
    if (!session || !session.wxg) return null;
    return this.save({
      verified: false,
      verifiedAt: undefined,
      expiresAt: undefined
    });
  }
}

export const subhdSession = new SubhdSessionStore();
