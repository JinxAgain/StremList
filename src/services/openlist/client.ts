import axios, { AxiosInstance } from 'axios';
import { FileItem } from '../matcher/file-matcher.js';
import { OpenListApiResponse, OpenListListData, OpenListGetData } from '../../types/openlist.js';

export function normalizeToolName(drive: string): string {
  const lower = drive.toLowerCase();
  if (lower === 'pikpak') return 'PikPak';
  if (lower === '115') return '115';
  return drive;
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
    const actualTool = normalizeToolName(tool || '115');
    console.log(`[OpenList] 📤 Adding offline download task...`);
    console.log(`[OpenList]    Destination Path: ${path}`);
    console.log(`[OpenList]    Tool: ${actualTool}`);
    console.log(`[OpenList]    Magnet URL: ${urls[0]?.slice(0, 60)}...`);

    const data = await this.request('/api/fs/add_offline_download', {
      path,
      urls,
      tool: actualTool
    });

    if (data && data.code === 200) {
      console.log(`[OpenList] ✅ Offline task created successfully! Code 200`);
      return true;
    }

    console.error(
      `[OpenList] ❌ Failed to create offline task. Code: ${data?.code}, Message: ${data?.message}`
    );
    return false;
  }

  async getRawUrl(path: string): Promise<string | null> {
    const data = await this.request<OpenListGetData>('/api/fs/get', { path });
    if (data && data.code === 200 && data.data?.raw_url) {
      return data.data.raw_url;
    }
    return null;
  }
}
