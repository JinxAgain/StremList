import { FileItem } from '../services/matcher/file-matcher.js';

export interface OpenListApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

export interface OpenListListData {
  content: FileItem[];
  total: number;
  read_me: string;
  write: boolean;
  provider: string;
}

export interface OpenListGetData {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  sign: string;
  thumb: string;
  type: number;
  raw_url: string;
  readme: string;
  provider: string;
}
