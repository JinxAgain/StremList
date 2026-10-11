import axios, { AxiosInstance } from 'axios';
import { FileItem } from '../matcher/file-matcher.js';
import { OpenListApiResponse, OpenListListData, OpenListGetData } from '../../types/openlist.js';

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

  private async request<T = any>(endpoint: string, data: any): Promise<OpenListApiResponse<T> | null> {
    try {
      const response = await this.http.post<OpenListApiResponse<T>>(endpoint, data);

      if (response.data?.code === 401 && process.env.OPENLIST_TOKEN && process.env.OPENLIST_TOKEN.trim() !== this.token) {
        console.warn(`[OpenList] ⚠️ Received 401 from ${endpoint}: ${response.data?.message}. Retrying with server permanent token from .env...`);
        this.token = process.env.OPENLIST_TOKEN.trim();
        this.http.defaults.headers['Authorization'] = this.token;
        const retryRes = await this.http.post<OpenListApiResponse<T>>(endpoint, data);
        return retryRes.data;
      }

      return response.data;
    } catch (error: any) {
      if (error.response?.data?.code === 401 && process.env.OPENLIST_TOKEN && process.env.OPENLIST_TOKEN.trim() !== this.token) {
        console.warn(`[OpenList] ⚠️ HTTP 401 on ${endpoint}. Retrying with server permanent token from .env...`);
        this.token = process.env.OPENLIST_TOKEN.trim();
        this.http.defaults.headers['Authorization'] = this.token;
        try {
          const retryRes = await this.http.post<OpenListApiResponse<T>>(endpoint, data);
          return retryRes.data;
        } catch {}
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

  private proxyChecked = false;

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

  async getRawUrl(path: string): Promise<string | null> {
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
          return proxyUrl;
        }

        if (rawUrl.includes('115cdn.net') || rawUrl.includes('anxia.com')) {
          console.warn(`[OpenList] ⚠️ Warning: 115 direct CDN link detected. Stremio will receive 403 Forbidden if Web Proxy is disabled in OpenList!`);
          console.warn(`[OpenList] 💡 Solution: In OpenList (${cleanBase}), go to Storages -> Edit 115 -> Enable "Web Proxy" & set WebDAV Policy to "Local Proxy".`);
        }
      }

      return rawUrl || null;
    }
    return null;
  }
}
