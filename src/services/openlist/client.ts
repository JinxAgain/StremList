import axios, { AxiosInstance } from 'axios';
import { FileItem } from '../matcher/file-matcher.js';
import { OpenListApiResponse, OpenListListData, OpenListGetData } from '../../types/openlist.js';
import { saveConfigToEnv } from '../../config.js';

export function normalizeToolName(drive: string): string {
  const lower = drive.toLowerCase();
  if (lower === 'pikpak') return 'PikPak';
  if (lower === '115') return '115';
  return drive;
}

export function getToolCandidates(drive: string): string[] {
  const lower = drive.toLowerCase();
  if (lower.includes('115')) {
    // In OpenList, 115 Open Platform registers as '115 Open', cookie driver registers as '115'
    return ['115 Open', '115', '115 Cloud', '115Open'];
  }
  if (lower.includes('pikpak')) {
    return ['PikPak', 'pikpak'];
  }
  return [drive];
}

export class OpenListClient {
  private http: AxiosInstance;
  private proxyChecked = false;
  private mountedDrivesCache: { drives: string[]; expiresAt: number } | null = null;
  private cachedHashesCache: { hashes: Set<string>; expiresAt: number } | null = null;

  constructor(private baseUrl: string, private token: string) {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    this.http = axios.create({
      baseURL: cleanBase,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: token } : {})
      }
    });
  }

  async getMountedDrives(forceRefresh = false): Promise<string[]> {
    const now = Date.now();
    if (!forceRefresh && this.mountedDrivesCache && this.mountedDrivesCache.expiresAt > now) {
      return this.mountedDrivesCache.drives;
    }

    const drives: string[] = [];

    // 1. Try /api/admin/storage/list
    try {
      const res = await this.http.get('/api/admin/storage/list', { timeout: 4000 });
      if (res.data?.code === 200 && Array.isArray(res.data.data?.content)) {
        for (const storage of res.data.data.content) {
          if (!storage.disabled && storage.mount_path) {
            const clean = storage.mount_path.replace(/^\/+|\/+$/g, '');
            if (clean && !drives.includes(clean)) {
              drives.push(clean);
            }
          }
        }
      }
    } catch {
      // Non-admin token or admin endpoint inaccessible
    }

    // 2. Fallback to list('/') to get top-level mount folders
    if (drives.length === 0) {
      try {
        const rootListing = await this.list('/', forceRefresh);
        for (const item of rootListing.content || []) {
          if (item.is_dir && item.name) {
            const clean = item.name.replace(/^\/+|\/+$/g, '');
            if (clean && !drives.includes(clean)) {
              drives.push(clean);
            }
          }
        }
      } catch {}
    }

    // 3. Fallback to DEFAULT_DRIVE from environment
    if (drives.length === 0) {
      const envDrive = normalizeToolName(process.env.DEFAULT_DRIVE || '115');
      drives.push(envDrive);
    }

    this.mountedDrivesCache = { drives, expiresAt: now + 30000 };
    return drives;
  }

  async getAllCachedHashes(forceRefresh = false): Promise<Set<string>> {
    const now = Date.now();
    if (!forceRefresh && this.cachedHashesCache && this.cachedHashesCache.expiresAt > now) {
      return this.cachedHashesCache.hashes;
    }

    const hashes = new Set<string>();
    const drives = await this.getMountedDrives(forceRefresh);

    await Promise.allSettled(
      drives.map(async (drive) => {
        try {
          const stremListDir = `/${drive}/StremList`;
          const listing = await this.list(stremListDir, false);
          for (const item of listing.content || []) {
            if (item.is_dir && item.name) {
              const lower = item.name.toLowerCase().trim();
              if (/^[a-f0-9]{40}$/.test(lower)) {
                hashes.add(lower);
              }
            }
          }
        } catch {
          // Ignore per-drive listing failures
        }
      })
    );

    this.cachedHashesCache = { hashes, expiresAt: now + 20000 };
    return hashes;
  }

  async refreshToken(): Promise<string | null> {
    const username = process.env.OPENLIST_USERNAME;
    const password = process.env.OPENLIST_PASSWORD;
    if (!username || !password) return null;

    try {
      console.log(`[OpenList] 🔄 Session token expired (401). Auto-refreshing in background using saved credentials...`);
      const cleanBase = this.baseUrl.replace(/\/+$/, '');
      const res = await axios.post(`${cleanBase}/api/auth/login`, {
        username,
        password
      }, { timeout: 8000 });

      if (res.data?.code === 200 && res.data.data?.token) {
        let newToken = res.data.data.token;
        try {
          const settingRes = await axios.get(`${cleanBase}/api/admin/setting/get?key=token`, {
            headers: { Authorization: newToken },
            timeout: 3000
          });
          if (settingRes.data?.code === 200 && settingRes.data?.data?.value) {
            newToken = settingRes.data.data.value.trim();
          }
        } catch {}

        this.token = newToken;
        this.http.defaults.headers['Authorization'] = newToken;
        saveConfigToEnv({ OPENLIST_TOKEN: newToken });
        console.log(`[OpenList] ✅ Token auto-refreshed successfully and saved to .env!`);
        return newToken;
      }
    } catch (err: any) {
      console.error(`[OpenList] ❌ Failed to auto-refresh token: ${err.message}`);
    }
    return null;
  }

  private async request<T = any>(endpoint: string, data: any): Promise<OpenListApiResponse<T> | null> {
    const execute = async () => {
      return await this.http.post<OpenListApiResponse<T>>(endpoint, data);
    };

    try {
      const response = await execute();

      if (response.data?.code === 401) {
        // Try fallback to server token if different
        if (process.env.OPENLIST_TOKEN && process.env.OPENLIST_TOKEN.trim() !== this.token) {
          console.warn(`[OpenList] ⚠️ Received 401 from ${endpoint}. Retrying with server token from .env...`);
          this.token = process.env.OPENLIST_TOKEN.trim();
          this.http.defaults.headers['Authorization'] = this.token;
          const retryRes = await execute();
          if (retryRes.data?.code !== 401) return retryRes.data;
        }

        // Try background auto-refresh
        const refreshedToken = await this.refreshToken();
        if (refreshedToken) {
          const retryRes = await execute();
          return retryRes.data;
        }
      }

      return response.data;
    } catch (error: any) {
      const is401 = error.response?.status === 401 || error.response?.data?.code === 401;
      if (is401) {
        if (process.env.OPENLIST_TOKEN && process.env.OPENLIST_TOKEN.trim() !== this.token) {
          console.warn(`[OpenList] ⚠️ HTTP 401 on ${endpoint}. Retrying with server token from .env...`);
          this.token = process.env.OPENLIST_TOKEN.trim();
          this.http.defaults.headers['Authorization'] = this.token;
          try {
            const retryRes = await execute();
            if (retryRes.data?.code !== 401) return retryRes.data;
          } catch {}
        }

        const refreshedToken = await this.refreshToken();
        if (refreshedToken) {
          try {
            const retryRes = await execute();
            return retryRes.data;
          } catch {}
        }
      }

      const msg = error.response?.data?.message || error.message;
      console.log(`[OpenList] Request to ${endpoint} error: ${msg}`);
      return null;
    }
  }

  async list(path: string, refresh = false): Promise<{ content?: FileItem[] }> {
    const data = await this.request<OpenListListData>('/api/fs/list', {
      path,
      refresh: !!refresh
    });

    if (data && data.code === 200 && data.data) {
      return { content: data.data.content || [] };
    }
    return { content: [] };
  }

  async mkdir(path: string): Promise<boolean> {
    const data = await this.request('/api/fs/mkdir', { path });
    return data?.code === 200;
  }

  async addOfflineDownload(path: string, urls: string[], tool?: string): Promise<boolean> {
    const candidates = getToolCandidates(tool || '115');
    console.log(`[OpenList] 📤 Adding offline download task...`);
    console.log(`[OpenList]    Destination Path: ${path}`);
    console.log(`[OpenList]    Magnet URL: ${urls[0]?.slice(0, 60)}...`);

    for (const currentTool of candidates) {
      console.log(`[OpenList]    Attempting Tool: "${currentTool}"`);
      const data = await this.request('/api/fs/add_offline_download', {
        path,
        urls,
        tool: currentTool
      });

      if (data && data.code === 200) {
        console.log(`[OpenList] ✅ Offline task created successfully with tool "${currentTool}"! Code 200`);
        return true;
      }

      const msg = data?.message || '';
      if (msg.includes('not found') || msg.includes('failed get offline download tool')) {
        console.warn(`[OpenList] ⚠️ Tool "${currentTool}" not found in OpenList. Trying next candidate...`);
        continue;
      }

      console.error(
        `[OpenList] ❌ Failed to create offline task. Code: ${data?.code}, Message: ${data?.message}`
      );
      return false;
    }

    return false;
  }

  async ensure115WebProxy(): Promise<boolean> {
    if (this.proxyChecked) return true;
    try {
      const listRes = await this.http.get('/api/admin/storage/list');
      if (listRes.data?.code === 200 && Array.isArray(listRes.data.data?.content)) {
        const storages = listRes.data.data.content;
        let anyUpdated = false;
        for (const storage of storages) {
          const is115 =
            (storage.driver && storage.driver.toLowerCase().includes('115')) ||
            (storage.mount_path && storage.mount_path.toLowerCase().includes('115'));

          if (is115) {
            const needsProxy = !storage.web_proxy || storage.webdav_policy !== 'native_proxy';
            if (needsProxy) {
              console.log(
                `[OpenList] 🔧 Found 115 storage "${storage.mount_path}" (id: ${storage.id}) without Web Proxy. Auto-enabling...`
              );
              const getRes = await this.http.get(`/api/admin/storage/get?id=${storage.id}`);
              if (getRes.data?.code === 200 && getRes.data.data) {
                const item = getRes.data.data;
                item.web_proxy = true;
                item.webdav_policy = 'native_proxy';
                const updateRes = await this.http.post('/api/admin/storage/update', item);
                if (updateRes.data?.code === 200) {
                  console.log(`[OpenList] ✅ Successfully enabled Web Proxy & Local Proxy for 115 storage in OpenList!`);
                  anyUpdated = true;
                } else {
                  console.warn(
                    `[OpenList] ⚠️ Could not auto-update 115 storage: ${updateRes.data?.message}`
                  );
                }
              }
            } else {
              this.proxyChecked = true;
              return true;
            }
          }
        }
        if (anyUpdated) {
          this.proxyChecked = true;
          return true;
        }
      }
    } catch {
      // Non-admin token or admin endpoint not accessible
    }
    return false;
  }

  private static rawUrlCache = new Map<string, { url: string; expiresAt: number }>();

  static clearRawUrlCache(): void {
    OpenListClient.rawUrlCache.clear();
  }

  async getRawUrl(path: string): Promise<string | null> {
    const cached = OpenListClient.rawUrlCache.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    const data = await this.request<OpenListGetData>('/api/fs/get', { path });
    if (data && data.code === 200 && data.data) {
      const cleanBase = this.baseUrl.replace(/\/+$/, '');
      let rawUrl = data.data.raw_url || '';

      if (rawUrl.startsWith('/')) {
        rawUrl = `${cleanBase}${rawUrl}`;
      }

      // Check if this file is on 115 storage
      const is115 =
        path.toLowerCase().startsWith('/115') ||
        rawUrl.includes('115cdn.net') ||
        rawUrl.includes('anxia.com');

      if (is115) {
        // Proactively verify and ensure OpenList Web Proxy is enabled
        this.ensure115WebProxy().catch(() => {});

        // Prefer OpenList's /d/ proxy stream endpoint
        if (data.data.sign) {
          const proxyUrl = `${cleanBase}/d${encodeURI(path)}?sign=${data.data.sign}`;
          console.log(`[OpenList] 🛡️ 115 stream route: using OpenList local proxy stream to prevent 403 hotlink rejection`);
          OpenListClient.rawUrlCache.set(path, {
            url: proxyUrl,
            expiresAt: Date.now() + 10 * 60 * 1000
          });
          return proxyUrl;
        }

        if (rawUrl.includes('115cdn.net') || rawUrl.includes('anxia.com')) {
          console.warn(`[OpenList] ⚠️ Warning: 115 direct CDN link detected. Stremio will receive 403 Forbidden if Web Proxy is disabled in OpenList!`);
          console.warn(`[OpenList] 💡 Solution: In OpenList (${cleanBase}), go to Storages -> Edit 115 -> Enable "Web Proxy" & set WebDAV Policy to "Local Proxy".`);
        }
      }

      if (rawUrl) {
        OpenListClient.rawUrlCache.set(path, {
          url: rawUrl,
          expiresAt: Date.now() + 10 * 60 * 1000
        });
        return rawUrl;
      }
    }
    return null;
  }
}
