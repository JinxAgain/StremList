export interface ScrapedStream {
  infoHash: string;
  name: string;
  title: string;
  fileIdx?: number;
  seeders?: number;
  resolution?: string;
  sizeBytes?: number;
}
