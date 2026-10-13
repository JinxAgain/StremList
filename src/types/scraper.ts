export interface ScrapedStream {
  infoHash: string;
  name: string;
  title: string;
  description?: string;
  fileIdx?: number;
  seeders?: number;
  resolution?: string;
  sizeBytes?: number;
  sourceAddon?: 'torrentio' | 'comet' | string;
  isCached?: boolean;
  behaviorHints?: {
    filename?: string;
    videoSize?: number;
    bingeGroup?: string;
    [key: string]: any;
  };
}
