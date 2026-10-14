export interface StremioResourceObject {
  name: string;
  types?: ('movie' | 'series' | 'anime' | 'other')[];
  idPrefixes?: string[];
  extra?: { name: string; isRequired?: boolean; options?: string[] }[];
}

export interface StremioManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  logo?: string;
  background?: string;
  resources: (string | StremioResourceObject)[];
  types: ('movie' | 'series' | 'anime' | 'other')[];
  idPrefixes?: string[];
  catalogs?: any[];
  behaviorHints?: {
    configurable?: boolean;
    configurationRequired?: boolean;
  };
}

export interface StremioStream {
  name: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    proxyHeaders?: Record<string, string>;
    filename?: string;
    videoSize?: number;
    [key: string]: any;
  };
}

export interface StreamResponse {
  streams: StremioStream[];
}
