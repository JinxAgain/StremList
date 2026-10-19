/**
 * Domain types and interfaces for the subtitle subsystem.
 */

export interface VideoQueryMeta {
  imdbId: string;
  mediaType: 'movie' | 'series';
  season?: number;
  episode?: number;
  title?: string;
  year?: number;
  filename?: string;
}

export interface SubtitleTags {
  provider: string;
  lang: string[];
  bilingual: boolean;
  fmt: string[];
  source: string[];
  fansub?: string;
  uploader?: string;
  collection: boolean;
  imdbMatched: boolean;
  episodeMatched?: boolean;
  seasonMatched?: boolean;
}

export interface SubhdSubjectItem {
  id: string;
  title: string;
  title2?: string;
  year?: string;
  type?: string;
  rating?: string;
  poster?: string;
}

export interface SubtitleCandidate {
  id: string;
  provider: 'subhd' | 'zimuku';
  title: string;
  pageUrl: string;
  tags: SubtitleTags;
  rate: number;
  downloadsCount: number;
  score: number;
}

export interface SubtitleItem {
  id: string;
  url: string;
  lang: string;
  label: string;
  title?: string;
  name?: string;
  subtitleFileName: string;
  movieReleaseName: string;
  SubFormat: string;
  path: string;
}

export interface DownloadResult {
  buffer: Buffer;
  filename: string;
}

export interface SubtitleConfig {
  enabled: boolean;
  lang: 'bilingual' | 'chs' | 'cht';
  source: 'all' | 'subhd' | 'zimuku';
  maxResults: number;
  proxy?: string;
  showOriginal?: boolean;
  keepOriginalFormat?: boolean;
}

export interface FormatSubtitleOptions {
  langPref?: 'bilingual' | 'chs' | 'cht';
  showOriginal?: boolean;
  keepOriginalFormat?: boolean;
}
