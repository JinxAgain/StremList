import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { SubtitleCleaner } from './cleaner.js';

export interface SubtitleContentInspection {
  isBilingualContent: boolean;
  hasChineseContent: boolean;
  isEnglishOnlyContent: boolean;
}

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
    preferTraditional = false,
    preferAss = false,
    siteBilingual = false
  ): { buffer: Buffer; filename: string } | null {
    if (!contentBytes || contentBytes.length === 0) {
      return null;
    }

    const lowerName = originalFilename.toLowerCase();

    // Case 0: Sniff content buffer - if already a raw text subtitle, don't attempt archive extraction
    if (SubtitleExtractor.isRawSubtitleBuffer(contentBytes)) {
      const ext = SubtitleExtractor.sniffSubtitleExtension(contentBytes);
      const cleanName = SUBTITLE_EXTENSIONS.some((e) => lowerName.endsWith(e))
        ? originalFilename
        : `${path.parse(originalFilename).name}${ext}`;
      return { buffer: contentBytes, filename: cleanName };
    }

    // Case 1: GZIP stream
    if (
      (contentBytes.length >= 2 && contentBytes[0] === 0x1f && contentBytes[1] === 0x8b) ||
      lowerName.endsWith('.gz') ||
      lowerName.endsWith('.tgz')
    ) {
      try {
        const decompressed = zlib.gunzipSync(contentBytes);
        const cleanName = originalFilename.replace(/\.gz$/i, '');
        return this.extractBestSubtitle(
          decompressed,
          cleanName,
          episode,
          preferBilingual,
          preferTraditional,
          preferAss,
          siteBilingual
        );
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
      const zipRes = this.extractFromZip(
        contentBytes,
        episode,
        preferBilingual,
        preferTraditional,
        preferAss,
        siteBilingual
      );
      if (zipRes) return zipRes;
    }

    // Case 4: Generic Archive (.rar, .7z, .tar, etc.)
    return this.extractGenericArchive(
      contentBytes,
      originalFilename,
      episode,
      preferBilingual,
      preferTraditional,
      preferAss,
      siteBilingual
    );
  }

  public static inspectSubtitleContent(rawBytes: Buffer): SubtitleContentInspection {
    if (!rawBytes || rawBytes.length === 0) {
      return { isBilingualContent: false, hasChineseContent: false, isEnglishOnlyContent: false };
    }

    const { text } = SubtitleCleaner.detectAndDecode(rawBytes);
    if (!text) {
      return { isBilingualContent: false, hasChineseContent: false, isEnglishOnlyContent: false };
    }

    const lines = text.split(/\r?\n/);
    const isAss =
      text.includes('[Script Info]') ||
      text.includes('[Events]') ||
      lines.some((l) => l.trim().toLowerCase().startsWith('dialogue:'));

    const cues: Array<{ timestampKey: string; text: string }> = [];
    const maxCuesToSample = 3000;
    let lastCleanedText = '';

    if (isAss) {
      let inEvents = false;
      let formatCols: string[] | null = null;
      let startIdx = 1;
      let endIdx = 2;
      let textIdx = 9;

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const lowerLine = line.toLowerCase();
        if (lowerLine === '[events]') {
          inEvents = true;
          continue;
        }
        if (line.startsWith('[') && inEvents) {
          break;
        }

        if (inEvents || lowerLine.startsWith('dialogue:')) {
          if (lowerLine.startsWith('format:')) {
            const rawCols = line.substring(line.indexOf(':') + 1).trim();
            formatCols = rawCols.split(',').map((c) => c.trim().toLowerCase());
            const sIdx = formatCols.indexOf('start');
            const eIdx = formatCols.indexOf('end');
            const tIdx = formatCols.indexOf('text');
            if (sIdx !== -1) startIdx = sIdx;
            if (eIdx !== -1) endIdx = eIdx;
            if (tIdx !== -1) textIdx = tIdx;
            continue;
          }

          if (lowerLine.startsWith('dialogue:')) {
            const rawValues = line.substring(line.indexOf(':') + 1).trim();
            const numExpected = formatCols ? formatCols.length : textIdx + 1;
            const cols: string[] = [];
            let current = rawValues;
            for (let i = 0; i < numExpected - 1; i++) {
              const commaPos = current.indexOf(',');
              if (commaPos === -1) {
                cols.push(current);
                current = '';
                break;
              }
              cols.push(current.substring(0, commaPos).trim());
              current = current.substring(commaPos + 1).trim();
            }
            cols.push(current);

            if (cols.length > Math.max(startIdx, endIdx)) {
              const rawStart = cols[startIdx] || '';
              const rawText = cols[textIdx] ?? '';
              const cleanText = SubtitleCleaner.cleanDialogueText(rawText);
              if (cleanText) {
                // Deduplicate consecutive identical text lines (e.g. frame-by-frame ASS sign animations)
                if (cleanText === lastCleanedText) {
                  continue;
                }
                lastCleanedText = cleanText;
                cues.push({ timestampKey: rawStart, text: cleanText });
                if (cues.length >= maxCuesToSample) break;
              }
            }
          }
        }
      }
    } else {
      const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const blocks = normalized.trim().split(/\n\s*\n/);
      const timestampRe = /(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})/;

      for (const block of blocks) {
        const blockLines = block
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (blockLines.length === 0) continue;

        let timeLineIdx = -1;
        let startKey = '';
        for (let i = 0; i < blockLines.length; i++) {
          const m = blockLines[i].match(timestampRe);
          if (m) {
            timeLineIdx = i;
            startKey = m[1];
            break;
          }
        }
        if (timeLineIdx === -1) continue;

        const cleanText = SubtitleCleaner.cleanDialogueText(blockLines.slice(timeLineIdx + 1).join('\n'));
        if (cleanText) {
          if (cleanText === lastCleanedText) {
            continue;
          }
          lastCleanedText = cleanText;
          cues.push({ timestampKey: startKey, text: cleanText });
          if (cues.length >= maxCuesToSample) break;
        }
      }
    }

    const totalCues = cues.length;
    if (totalCues === 0) {
      return { isBilingualContent: false, hasChineseContent: false, isEnglishOnlyContent: false };
    }

    let cjkCues = 0;
    let sameCueBilingualCount = 0;
    const cjkTimestamps = new Set<string>();
    const latinOnlyTimestamps = new Set<string>();

    for (const cue of cues) {
      const cjkMatches = cue.text.match(/[\u4e00-\u9fff]/g);
      const cjkCount = cjkMatches ? cjkMatches.length : 0;
      const latinWords = cue.text.match(/[A-Za-z]{2,}(?:['’][A-Za-z]+)?/g) || [];

      if (cjkCount > 0) {
        cjkCues++;
        if (cue.timestampKey) cjkTimestamps.add(cue.timestampKey);
      } else if (latinWords.length >= 1) {
        if (cue.timestampKey) latinOnlyTimestamps.add(cue.timestampKey);
      }

      const cueLines = cue.text.split('\n').map((l) => l.trim()).filter(Boolean);
      let isMultiLineBilingual = false;
      if (cueLines.length >= 2) {
        const hasCjkLine = cueLines.some((l) => /[\u4e00-\u9fff]/.test(l));
        const hasPureLatinLine = cueLines.some(
          (l) => !/[\u4e00-\u9fff]/.test(l) && /[A-Za-z]{2,}/.test(l)
        );
        isMultiLineBilingual = hasCjkLine && hasPureLatinLine;
      }

      const isSameLineBilingual = cjkCount >= 2 && latinWords.length >= 3;
      if (isMultiLineBilingual || isSameLineBilingual) {
        sameCueBilingualCount++;
      }
    }

    let dualTrackCount = 0;
    for (const ts of cjkTimestamps) {
      if (latinOnlyTimestamps.has(ts)) {
        dualTrackCount++;
      }
    }

    const isSameCueBilingual =
      (sameCueBilingualCount >= 5 && sameCueBilingualCount / totalCues >= 0.15) ||
      (sameCueBilingualCount >= 2 && totalCues <= 15 && sameCueBilingualCount / totalCues >= 0.25);

    const isDualTrackBilingual =
      (dualTrackCount >= 5 && (dualTrackCount * 2) / totalCues >= 0.15) ||
      (dualTrackCount >= 2 && totalCues <= 20 && (dualTrackCount * 2) / totalCues >= 0.25);

    const isBilingualContent = isSameCueBilingual || isDualTrackBilingual;
    const hasChineseContent = cjkCues >= 5 || cjkCues / totalCues >= 0.15;
    const isEnglishOnlyContent = totalCues >= 2 && cjkCues / totalCues < 0.05;

    return {
      isBilingualContent,
      hasChineseContent,
      isEnglishOnlyContent
    };
  }

  public static isRawSubtitleBuffer(buf: Buffer): boolean {
    if (!buf || buf.length < 10) return false;
    // Archive magic bytes: PK (zip), Rar! (rar), 7z (7z), \x1f\x8b (gzip)
    if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return false;
    if (buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return false;
    if (buf.length >= 6 && buf.slice(0, 6).toString('binary') === '7z\xbc\xaf\x27\x1c') return false;
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return false;

    const sample = buf.slice(0, 4096).toString('utf-8', 0, Math.min(buf.length, 4096));
    if (sample.includes('[Script Info]') || sample.includes('ScriptType:') || sample.includes('Dialogue:')) {
      return true;
    }
    if (sample.includes('WEBVTT')) {
      return true;
    }
    if (/\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}/.test(sample)) {
      return true;
    }
    return false;
  }

  public static sniffSubtitleExtension(buf: Buffer): string {
    const sample = buf.slice(0, 4096).toString('utf-8', 0, Math.min(buf.length, 4096));
    if (sample.includes('[Script Info]') || sample.includes('ScriptType:')) return '.ass';
    if (sample.includes('WEBVTT')) return '.vtt';
    return '.srt';
  }

  private static extractFromZip(
    contentBytes: Buffer,
    episode?: number,
    preferBilingual = true,
    preferTraditional = false,
    preferAss = false,
    siteBilingual = false
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
        const bestName = this.pickBestFile(
          Object.keys(filesMap),
          episode,
          preferBilingual,
          preferTraditional,
          preferAss,
          siteBilingual,
          filesMap
        );
        if (bestName && filesMap[bestName]) {
          return { buffer: filesMap[bestName], filename: bestName };
        }
      }

      // Check for nested archives inside zip (e.g. season pack with per-episode zips)
      if (Object.keys(nestedMap).length > 0) {
        const bestArchive = this.pickBestFile(
          Object.keys(nestedMap),
          episode,
          preferBilingual,
          preferTraditional,
          preferAss,
          siteBilingual
        );
        if (bestArchive && nestedMap[bestArchive]) {
          return this.extractBestSubtitle(
            nestedMap[bestArchive],
            bestArchive,
            episode,
            preferBilingual,
            preferTraditional,
            preferAss,
            siteBilingual
          );
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
    preferTraditional = false,
    preferAss = false,
    siteBilingual = false
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
          const filesBufferMap: Record<string, Buffer> = {};
          for (const [fName, fullPath] of Object.entries(foundFiles)) {
            try {
              filesBufferMap[fName] = fs.readFileSync(fullPath);
            } catch {
              // Ignore single file read failure
            }
          }
          const bestName = this.pickBestFile(
            Object.keys(foundFiles),
            episode,
            preferBilingual,
            preferTraditional,
            preferAss,
            siteBilingual,
            filesBufferMap
          );
          if (bestName && (filesBufferMap[bestName] || foundFiles[bestName])) {
            const buf = filesBufferMap[bestName] || fs.readFileSync(foundFiles[bestName]);
            return { buffer: buf, filename: bestName };
          }
        }

        if (Object.keys(nestedArchives).length > 0) {
          const bestArchive = this.pickBestFile(
            Object.keys(nestedArchives),
            episode,
            preferBilingual,
            preferTraditional,
            preferAss,
            siteBilingual
          );
          if (bestArchive && nestedArchives[bestArchive]) {
            const buf = fs.readFileSync(nestedArchives[bestArchive]);
            return this.extractBestSubtitle(
              buf,
              bestArchive,
              episode,
              preferBilingual,
              preferTraditional,
              preferAss,
              siteBilingual
            );
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
    preferTraditional = false,
    preferAss = false,
    siteBilingual = false,
    fileContents?: Record<string, Buffer>
  ): string | null {
    if (!filenames || filenames.length === 0) {
      return null;
    }

    const chsPat = /(?:^|[^a-z0-9])(?:chs|gb|sc|zh[-_]?cn|zh[-_]?hans|chi|zho)(?:$|[^a-z0-9])|简|简体|简中/i;
    const chtPat = /(?:^|[^a-z0-9])(?:cht|tc|big5|zh[-_]?tw|zh[-_]?hk|zh[-_]?hant)(?:$|[^a-z0-9])|繁|繁体|繁體|繁中/i;
    const nonZhTagOnlyPat = /^(?:eng?|english|英文|英语|fre|fra|french|法语|德语|ger|deu|spa|esp|rus|jpn|jap|kor|ita|por)$/i;
    const engOnlyFilePat = /(?:^|[._ -])(?:eng?|english|英文|英语)[._ -]*(?:srt|ass|ssa|vtt)$/i;

    interface FileEvalMeta {
      filename: string;
      lower: string;
      lastTag: string;
      epScore: number;
      isExplicitBilingual: boolean;
      isChs: boolean;
      isCht: boolean;
      isEngOnlyTag: boolean;
      fmtScore: number;
    }

    const evalMetaMap = new Map<string, FileEvalMeta>();

    for (const filename of filenames) {
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

      // 2. Filename language flags
      const stem = path.parse(filename).name;
      const parts = stem.split(/[._ -]+/);
      const lastTag = parts.length > 0 ? parts[parts.length - 1].trim().toLowerCase() : '';

      const isExplicitBilingual = BILINGUAL_REGEX.test(lastTag) || BILINGUAL_REGEX.test(lower);
      const isCht = chtPat.test(lastTag) || chtPat.test(lower);
      const isChs = chsPat.test(lastTag) || chsPat.test(lower);
      const isEngOnlyTag =
        nonZhTagOnlyPat.test(lastTag) || (engOnlyFilePat.test(lower) && !isExplicitBilingual && !isChs && !isCht);

      // 3. Format score
      let fmtScore = 0;
      if (preferAss) {
        if (lower.endsWith('.ass') || lower.endsWith('.ssa')) fmtScore = 60;
        else if (lower.endsWith('.srt')) fmtScore = 50;
        else if (lower.endsWith('.vtt')) fmtScore = 20;
      } else {
        if (lower.endsWith('.srt')) fmtScore = 50;
        else if (lower.endsWith('.ass') || lower.endsWith('.ssa')) fmtScore = 40;
        else if (lower.endsWith('.vtt')) fmtScore = 20;
      }

      evalMetaMap.set(filename, {
        filename,
        lower,
        lastTag,
        epScore,
        isExplicitBilingual,
        isChs,
        isCht,
        isEngOnlyTag,
        fmtScore
      });
    }

    const allMetas = Array.from(evalMetaMap.values());
    const maxEpScore = Math.max(...allMetas.map((m) => m.epScore));
    if (maxEpScore <= -5000) {
      return null;
    }

    const targetEpMetas = allMetas.filter((m) => m.epScore === maxEpScore);
    const hasExplicitBilingualInEp = targetEpMetas.some((m) => m.isExplicitBilingual);

    const contentVerifiedBilingual = new Set<string>();
    const contentVerifiedEngOnly = new Set<string>();
    let allowFilenameInferredBilingual = false;

    if (siteBilingual && !hasExplicitBilingualInEp) {
      const hasBuffersForEp =
        Boolean(fileContents) && targetEpMetas.some((m) => Boolean(fileContents && fileContents[m.filename]));

      if (hasBuffersForEp && fileContents) {
        for (const m of targetEpMetas) {
          if (m.isEngOnlyTag) continue;
          const buf = fileContents[m.filename];
          if (!buf) continue;
          const inspection = this.inspectSubtitleContent(buf);
          if (inspection.isBilingualContent) {
            contentVerifiedBilingual.add(m.filename);
          } else if (inspection.isEnglishOnlyContent && !m.isChs && !m.isCht) {
            contentVerifiedEngOnly.add(m.filename);
          }
        }
      } else {
        allowFilenameInferredBilingual = true;
      }
    }

    const scoreFile = (filename: string): [number, number, number] => {
      const m = evalMetaMap.get(filename)!;
      const isUntagged = !m.isExplicitBilingual && !m.isChs && !m.isCht && !m.isEngOnlyTag;
      const isVerifiedBi = contentVerifiedBilingual.has(filename);
      const isVerifiedEngOnly = contentVerifiedEngOnly.has(filename);
      const isInferredBi = allowFilenameInferredBilingual && m.epScore === maxEpScore && isUntagged;

      let langScore = 400;
      if (m.isEngOnlyTag || isVerifiedEngOnly) {
        langScore = -2000;
      } else if (preferBilingual && m.isExplicitBilingual) {
        langScore = BILINGUAL_REGEX.test(m.lastTag) ? 1100 : 1000;
      } else if (preferBilingual && isVerifiedBi) {
        langScore = isUntagged ? 1060 : 1050;
      } else if (preferBilingual && isInferredBi) {
        langScore = 1000;
      } else if (preferTraditional && m.isCht) {
        langScore = 900;
      } else if (!preferTraditional && m.isChs) {
        langScore = 800;
      } else if (m.isExplicitBilingual || isVerifiedBi || isInferredBi) {
        langScore = 700;
      } else if (m.isChs) {
        langScore = 600;
      } else if (m.isCht) {
        langScore = 500;
      }

      return [m.epScore, langScore, m.fmtScore];
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
