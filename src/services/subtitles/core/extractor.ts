import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';

export const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt'];
export const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz'];

export const BILINGUAL_REGEX = new RegExp(
  '(?:双语|中英|简英|繁英|英简|英繁|zh[-_]en|' +
  '(?:chs|cht|zh|chi|zho|简|繁|简体|繁体)[&+._ /-]*(?:eng?|english|英文|英语)|' +
  '(?:eng?|english|英文|英语)[&+._ /-]*(?:chs|cht|zh|chi|zho|简|繁|简体|繁体)|' +
  '\\[(?:chs|cht|zh|简|繁|简体|繁体)[^\\]]*\\].*?\\[(?:eng?|english|英文|英语)[^\\]]*\\]|' +
  '\\[(?:eng?|english|英语)[^\\]]*\\].*?\\[(?:chs|cht|zh|简|繁|简体|繁体)[^\\]]*\\])',
  'i'
);

function fixArchiveFilename(rawName: string): string {
  try {
    const rawBuffer = iconv.encode(rawName, 'cp437');
    const decoded = iconv.decode(rawBuffer, 'gb18030');
    if (!decoded.includes('\ufffd')) {
      return decoded;
    }
  } catch {
    // Keep rawName on error
  }
  return rawName;
}

function get7zBinary(): string | null {
  const candidates = [
    '7zz',
    '7z',
    '7za',
    path.resolve(process.cwd(), 'data/bin/7zz'),
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe'
  ];

  for (const c of candidates) {
    if (path.isAbsolute(c) && fs.existsSync(c)) {
      return c;
    }
    // Check if command is executable
    try {
      const res = spawnSync(c, ['--help'], { stdio: 'ignore' });
      if (res.status === 0 || res.status === 7) {
        return c;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export class SubtitleExtractor {
  public static extractBestSubtitle(
    contentBytes: Buffer,
    originalFilename: string,
    episode?: number,
    preferBilingual = true,
    preferTraditional = false
  ): { buffer: Buffer; filename: string } | null {
    if (!contentBytes || contentBytes.length === 0) {
      return null;
    }

    const lowerName = originalFilename.toLowerCase();

    // Case 1: GZIP stream
    if (
      (contentBytes.length >= 2 && contentBytes[0] === 0x1f && contentBytes[1] === 0x8b) ||
      lowerName.endsWith('.gz') ||
      lowerName.endsWith('.tgz')
    ) {
      try {
        const decompressed = zlib.gunzipSync(contentBytes);
        const cleanName = originalFilename.replace(/\.gz$/i, '');
        return this.extractBestSubtitle(decompressed, cleanName, episode, preferBilingual, preferTraditional);
      } catch (err) {
        console.warn(`[Extractor] Gzip extraction failed:`, err);
      }
    }

    // Case 2: Standalone subtitle file
    if (SUBTITLE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      return { buffer: contentBytes, filename: originalFilename };
    }

    // Case 3: ZIP Archive
    if (
      (contentBytes.length >= 2 && contentBytes[0] === 0x50 && contentBytes[1] === 0x4b) ||
      lowerName.endsWith('.zip')
    ) {
      const zipRes = this.extractFromZip(contentBytes, episode, preferBilingual, preferTraditional);
      if (zipRes) return zipRes;
    }

    // Case 4: Generic Archive (.rar, .7z, .tar, etc.)
    return this.extractGenericArchive(contentBytes, originalFilename, episode, preferBilingual, preferTraditional);
  }

  private static extractFromZip(
    contentBytes: Buffer,
    episode?: number,
    preferBilingual = true,
    preferTraditional = false
  ): { buffer: Buffer; filename: string } | null {
    try {
      const zip = new AdmZip(contentBytes);
      const entries = zip.getEntries();
      const filesMap: Record<string, Buffer> = {};
      const nestedMap: Record<string, Buffer> = {};

      for (const entry of entries) {
        if (entry.isDirectory) continue;

        let name = entry.entryName;
        // Fix misdecoded CP437 filenames if needed
        name = fixArchiveFilename(name);

        const baseName = path.basename(name);
        const lowerBase = baseName.toLowerCase();

        if (SUBTITLE_EXTENSIONS.some((ext) => lowerBase.endsWith(ext))) {
          filesMap[baseName] = entry.getData();
        } else if (ARCHIVE_EXTENSIONS.some((ext) => lowerBase.endsWith(ext))) {
          nestedMap[baseName] = entry.getData();
        }
      }

      if (Object.keys(filesMap).length > 0) {
        const bestName = this.pickBestFile(Object.keys(filesMap), episode, preferBilingual, preferTraditional);
        if (bestName && filesMap[bestName]) {
          return { buffer: filesMap[bestName], filename: bestName };
        }
      }

      // Check for nested archives inside zip (e.g. season pack with per-episode zips)
      if (Object.keys(nestedMap).length > 0) {
        const bestArchive = this.pickBestFile(Object.keys(nestedMap), episode, preferBilingual, preferTraditional);
        if (bestArchive && nestedMap[bestArchive]) {
          return this.extractBestSubtitle(nestedMap[bestArchive], bestArchive, episode, preferBilingual, preferTraditional);
        }
      }
    } catch (err) {
      console.warn(`[Extractor] ZIP unpack error:`, err);
    }
    return null;
  }

  private static extractGenericArchive(
    contentBytes: Buffer,
    originalFilename: string,
    episode?: number,
    preferBilingual = true,
    preferTraditional = false
  ): { buffer: Buffer; filename: string } | null {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strem_zhsub_'));
    const archivePath = path.join(tempDir, originalFilename || 'archive.bin');
    const extractDest = path.join(tempDir, 'out');

    try {
      fs.writeFileSync(archivePath, contentBytes);
      fs.mkdirSync(extractDest, { recursive: true });

      let unpacked = false;
      const exe7z = get7zBinary();

      if (exe7z) {
        const res = spawnSync(exe7z, ['x', '-y', `-o${extractDest}`, archivePath], {
          timeout: 30000,
          stdio: 'ignore'
        });
        if (res.status === 0) {
          unpacked = true;
        }
      }

      if (unpacked) {
        const foundFiles: Record<string, string> = {};
        const nestedArchives: Record<string, string> = {};

        const walk = (dir: string) => {
          const files = fs.readdirSync(dir);
          for (const f of files) {
            const fullPath = path.join(dir, f);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              if (!f.includes('__MACOSX')) walk(fullPath);
            } else {
              if (f.startsWith('._')) continue;
              const lower = f.toLowerCase();
              if (SUBTITLE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
                foundFiles[f] = fullPath;
              } else if (ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
                nestedArchives[f] = fullPath;
              }
            }
          }
        };

        walk(extractDest);

        if (Object.keys(foundFiles).length > 0) {
          const bestName = this.pickBestFile(Object.keys(foundFiles), episode, preferBilingual, preferTraditional);
          if (bestName && foundFiles[bestName]) {
            const buf = fs.readFileSync(foundFiles[bestName]);
            return { buffer: buf, filename: bestName };
          }
        }

        if (Object.keys(nestedArchives).length > 0) {
          const bestArchive = this.pickBestFile(Object.keys(nestedArchives), episode, preferBilingual, preferTraditional);
          if (bestArchive && nestedArchives[bestArchive]) {
            const buf = fs.readFileSync(nestedArchives[bestArchive]);
            return this.extractBestSubtitle(buf, bestArchive, episode, preferBilingual, preferTraditional);
          }
        }
      }
    } catch (err) {
      console.error(`[Extractor] Generic archive extraction failed:`, err);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    return null;
  }

  public static pickBestFile(
    filenames: string[],
    episode?: number,
    preferBilingual = true,
    preferTraditional = false
  ): string | null {
    if (!filenames || filenames.length === 0) {
      return null;
    }

    const chsPat = /chs|gb|sc|简|简体|简中|zh-cn|zh-hans|chi|zho/i;
    const chtPat = /cht|tc|big5|繁|繁体|繁體|繁中|zh-tw|zh-hk|zh-hant/i;
    const engOnlyPat = /(?:^|[._ -])(?:eng?|english|英文)[._ -]*(?:srt|ass|ssa|vtt)$/i;

    const scoreFile = (filename: string): [number, number, number] => {
      const lower = filename.toLowerCase();

      // 1. Episode score
      let epScore = 0;
      if (episode !== undefined) {
        const epPatterns = [
          new RegExp(`\\b[eE][pP]?0*${episode}\\b`, 'i'),
          new RegExp(`s\\d{1,2}e0*${episode}\\b`, 'i'),
          new RegExp(`第\\s*0*${episode}\\s*[集话話]`, 'i'),
          new RegExp(`\\[0*${episode}\\]`, 'i'),
          new RegExp(`(?:^|[._ -])0*${episode}(?:[._ -]|\\.(srt|ass|ssa|vtt))`, 'i')
        ];
        const matchedTargetEp = epPatterns.some((pat) => pat.test(lower));

        const allEpsMatches = Array.from(lower.matchAll(/(?:^|[^a-zA-Z0-9]|s\d{1,2})[eE][pP]?(\d{1,3})(?!\d)/gi)).map((m) => parseInt(m[1], 10));
        const cnEpsMatches = Array.from(lower.matchAll(/第\s*(\d{1,3})\s*[集话話]/g)).map((m) => parseInt(m[1], 10));
        const allEps = [...allEpsMatches, ...cnEpsMatches];

        let hasDifferentEp = false;
        if (allEps.length > 0 && !allEps.includes(episode)) {
          hasDifferentEp = true;
        }

        if (matchedTargetEp) {
          epScore = 2000;
        } else if (hasDifferentEp) {
          epScore = -5000; // Disqualify wrong episode in season pack
        } else {
          epScore = 500;
        }
      }

      // 2. Language score
      const stem = path.parse(filename).name;
      const parts = stem.split(/[._ -]+/);
      const lastTag = parts.length > 0 ? parts[parts.length - 1].trim().toLowerCase() : '';

      const isEngOnlyTag = engOnlyPat.test(lastTag);
      const isBilingual = BILINGUAL_REGEX.test(lastTag) || BILINGUAL_REGEX.test(lower);
      const isCht = chtPat.test(lastTag) || chtPat.test(lower);
      const isChs = chsPat.test(lastTag) || chsPat.test(lower);

      let langScore = 400;
      if (isEngOnlyTag) {
        langScore = -2000;
      } else if (preferBilingual && isBilingual) {
        langScore = BILINGUAL_REGEX.test(lastTag) ? 1100 : 1000;
      } else if (preferTraditional && isCht) {
        langScore = 900;
      } else if (!preferTraditional && isChs) {
        langScore = 800;
      } else if (isBilingual) {
        langScore = 700;
      } else if (isChs) {
        langScore = 600;
      } else if (isCht) {
        langScore = 500;
      }

      // 3. Format score
      let fmtScore = 0;
      if (lower.endsWith('.srt')) {
        fmtScore = 50;
      } else if (lower.endsWith('.ass') || lower.endsWith('.ssa')) {
        fmtScore = 40;
      } else if (lower.endsWith('.vtt')) {
        fmtScore = 20;
      }

      return [epScore, langScore, fmtScore];
    };

    const sorted = [...filenames].sort((a, b) => {
      const sA = scoreFile(a);
      const sB = scoreFile(b);
      if (sA[0] !== sB[0]) return sB[0] - sA[0];
      if (sA[1] !== sB[1]) return sB[1] - sA[1];
      return sB[2] - sA[2];
    });

    const top = sorted[0];
    const topScore = scoreFile(top);
    if (topScore[0] <= -5000) {
      return null;
    }
    return top;
  }
}
