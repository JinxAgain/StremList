import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { SubtitleExtractor } from '../../src/services/subtitles/core/extractor.js';

describe('SubtitleExtractor', () => {
  it('extracts target episode from zip and prefers bilingual subtitle', () => {
    const zip = new AdmZip();
    zip.addFile('Show.S01E01.chs.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nEp1\n'));
    zip.addFile('Show.S01E04.chs.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nEp4 CHS\n'));
    zip.addFile('Show.S01E04.chs&eng.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nEp4 Bilingual\n'));
    const zipBuffer = zip.toBuffer();

    const result = SubtitleExtractor.extractBestSubtitle(zipBuffer, 'Show.S01.zip', 4, true, false);
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('Show.S01E04.chs&eng.srt');
  });

  it('rejects wrong episode in pickBestFile', () => {
    const files = ['Show.S01E01.srt', 'Show.S01E02.srt'];
    const best = SubtitleExtractor.pickBestFile(files, 3);
    // When requesting E03, both E01 and E02 are disqualified with -5000 points
    expect(best).toBeNull();
  });

  it('detects and recovers raw ASS text even if misnamed as .zip', () => {
    const rawAss = Buffer.from('[Script Info]\nTitle: Test Sub\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello');
    expect(SubtitleExtractor.isRawSubtitleBuffer(rawAss)).toBe(true);
    expect(SubtitleExtractor.sniffSubtitleExtension(rawAss)).toBe('.ass');

    const result = SubtitleExtractor.extractBestSubtitle(rawAss, 'subhd_Cmr0uS.zip');
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('subhd_Cmr0uS.ass');
  });

  it('detects and recovers raw SRT text even if misnamed as .zip', () => {
    const rawSrt = Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nHello World\n');
    expect(SubtitleExtractor.isRawSubtitleBuffer(rawSrt)).toBe(true);
    expect(SubtitleExtractor.sniffSubtitleExtension(rawSrt)).toBe('.srt');

    const result = SubtitleExtractor.extractBestSubtitle(rawSrt, 'subtitle_archive.zip');
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('subtitle_archive.srt');
  });

  it('selects ASS over SRT when preferAss is true', () => {
    const files = ['Movie.chs.srt', 'Movie.chs.ass'];
    const bestNormal = SubtitleExtractor.pickBestFile(files, undefined, true, false, false);
    expect(bestNormal).toBe('Movie.chs.srt');

    const bestAss = SubtitleExtractor.pickBestFile(files, undefined, true, false, true);
    expect(bestAss).toBe('Movie.chs.ass');
  });

  it('disqualifies English-only subtitle files in pickBestFile', () => {
    const files = ['Movie.eng.srt', 'Movie.chs.srt'];
    const best = SubtitleExtractor.pickBestFile(files, undefined, true, false, false);
    expect(best).toBe('Movie.chs.srt');

    const engOnlyFiles = ['Movie.english.srt', 'Movie.fre.srt'];
    const bestEngOnly = SubtitleExtractor.pickBestFile(engOnlyFiles, undefined, true, false, false);
    // Both are non-Chinese only tags, should be penalized and if no Chinese exists, rank appropriately
    expect(bestEngOnly).not.toBeNull();
  });

  it('verifies dialogue content to pick untagged bilingual .ass in Small.Prophets pack when siteBilingual is true', () => {
    const zip = new AdmZip();

    const engSrt = [
      '1',
      '00:01:11,240 --> 00:01:12,320',
      'Hello, Michael.',
      '',
      '2',
      '00:01:19,280 --> 00:01:21,680',
      'Morning... morning.',
      '',
      '3',
      '00:01:23,000 --> 00:01:25,600',
      'By the way, mate, I was just thinking about your garden.'
    ].join('\n');

    const chsSrt = [
      '1',
      '00:01:11,240 --> 00:01:12,320',
      '你好，迈克尔。',
      '',
      '2',
      '00:01:19,280 --> 00:01:21,680',
      '早……早啊。',
      '',
      '3',
      '00:01:23,000 --> 00:01:25,600',
      '对了，老兄，我刚刚在想你家花园的事。'
    ].join('\n');

    const chtSrt = [
      '1',
      '00:01:11,240 --> 00:01:12,320',
      '你好，邁克爾。',
      '',
      '2',
      '00:01:19,280 --> 00:01:21,680',
      '早……早啊。',
      '',
      '3',
      '00:01:23,000 --> 00:01:25,600',
      '對了，老兄，我剛剛在想你家花園的事。'
    ].join('\n');

    // Simulates horan's .chs.ass which still has "Title: Bilingual subtitle file" in header and isolated English proper nouns
    const chsAssWithResidualHeader = [
      '[Script Info]',
      'Title: Bilingual subtitle file',
      'Script Updated By: horan',
      'ScriptType: v4.00+',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize',
      'Style: Default,KaiTi,18',
      'Style: Merged,Arial,11',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:01:11.24,0:01:12.32,Default,,0,0,0,,你好，迈克尔。',
      'Dialogue: 0,0:01:19.28,0:01:21.68,Default,,0,0,0,,早……早啊。',
      'Dialogue: 0,0:01:23.00,0:01:25.60,Default,,0,0,0,,我现在住在一家Costcutter便利店楼上的破公寓里。',
      'Dialogue: 0,0:01:26.00,0:01:28.00,Default,,0,0,0,,Pickles。',
      'Dialogue: 0,0:01:29.00,0:01:31.00,Default,,0,0,0,,好吧，那我回头处理。'
    ].join('\n');

    const bilingualUntaggedAss = [
      '[Script Info]',
      'Title: Bilingual subtitle file',
      'Script Updated By: horan',
      'ScriptType: v4.00+',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:01:11.24,0:01:12.32,Default,,0,0,0,,你好，迈克尔。\\N{\\rMerged}Hello, Michael.',
      'Dialogue: 0,0:01:19.28,0:01:21.68,Default,,0,0,0,,早……早啊。\\N{\\rMerged}Morning... morning.',
      'Dialogue: 0,0:01:23.00,0:01:25.60,Default,,0,0,0,,我现在住在一家Costcutter便利店楼上的破公寓里。\\N{\\rMerged}I live in a flat above a Costcutter.',
      'Dialogue: 0,0:01:26.00,0:01:28.00,Default,,0,0,0,,好吧，那我回头处理。\\N{\\rMerged}All right, I will sort it out.'
    ].join('\n');

    zip.addFile('Small.Prophets.S01E01.1080p.WEBRip.x265-KONTRAST.eng.srt', Buffer.from(engSrt, 'utf-8'));
    zip.addFile('Small.Prophets.S01E01.1080p.WEBRip.x265-KONTRAST.cht.srt', Buffer.from(chtSrt, 'utf-8'));
    zip.addFile('Small.Prophets.S01E01.1080p.WEBRip.x265-KONTRAST.chs.srt', Buffer.from(chsSrt, 'utf-8'));
    zip.addFile('Small.Prophets.S01E01.1080p.WEBRip.x265-KONTRAST.chs.ass', Buffer.from(chsAssWithResidualHeader, 'utf-8'));
    zip.addFile('Small.Prophets.S01E01.1080p.WEBRip.x265-KONTRAST.ass', Buffer.from(bilingualUntaggedAss, 'utf-8'));
    zip.addFile('Small.Prophets.S01E02.1080p.WEBRip.x265-KONTRAST.ass', Buffer.from(bilingualUntaggedAss, 'utf-8'));

    const zipBuf = zip.toBuffer();

    const extracted = SubtitleExtractor.extractBestSubtitle(
      zipBuf,
      '[zmk.pw]Small.Prophets.S01.1080p.WEBRip.x265-KONTRAST@horan.v2.zip',
      1,
      true,
      false,
      false,
      true
    );

    expect(extracted).not.toBeNull();
    expect(extracted?.filename).toBe('Small.Prophets.S01E01.1080p.WEBRip.x265-KONTRAST.ass');
  });

  it('rejects untagged English-only file via content inspection even when siteBilingual is true', () => {
    const zip = new AdmZip();
    const engOnlySrt = [
      '1',
      '00:00:01,000 --> 00:00:03,000',
      'Previously on the show.',
      '',
      '2',
      '00:00:04,000 --> 00:00:06,000',
      'We have to leave right now.',
      '',
      '3',
      '00:00:07,000 --> 00:00:09,000',
      'There is no time left.'
    ].join('\n');

    const chsOnlySrt = [
      '1',
      '00:00:01,000 --> 00:00:03,000',
      '前情提要。',
      '',
      '2',
      '00:00:04,000 --> 00:00:06,000',
      '我们必须马上离开。',
      '',
      '3',
      '00:00:07,000 --> 00:00:09,000',
      '已经没有时间了。'
    ].join('\n');

    zip.addFile('Movie.2026.1080p.srt', Buffer.from(engOnlySrt, 'utf-8'));
    zip.addFile('Movie.2026.1080p.chs.srt', Buffer.from(chsOnlySrt, 'utf-8'));

    const res = SubtitleExtractor.extractBestSubtitle(zip.toBuffer(), 'Movie.2026.zip', undefined, true, false, false, true);
    expect(res).not.toBeNull();
    expect(res?.filename).toBe('Movie.2026.1080p.chs.srt');
  });

  it('recognizes dual-track ASS (same timestamp separate CN and EN Dialogue lines) as bilingual content', () => {
    const dualTrackAss = Buffer.from(
      [
        '[Script Info]',
        'ScriptType: v4.00+',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:01:01.00,0:01:03.00,CN,,0,0,0,,你好，世界。',
        'Dialogue: 0,0:01:01.00,0:01:03.00,EN,,0,0,0,,Hello, world.',
        'Dialogue: 0,0:01:05.00,0:01:07.00,CN,,0,0,0,,我们要去哪里？',
        'Dialogue: 0,0:01:05.00,0:01:07.00,EN,,0,0,0,,Where are we going?',
        'Dialogue: 0,0:01:10.00,0:01:12.00,CN,,0,0,0,,跟紧我。',
        'Dialogue: 0,0:01:10.00,0:01:12.00,EN,,0,0,0,,Stay close to me.'
      ].join('\n'),
      'utf-8'
    );

    const inspection = SubtitleExtractor.inspectSubtitleContent(dualTrackAss);
    expect(inspection.isBilingualContent).toBe(true);
    expect(inspection.hasChineseContent).toBe(true);
    expect(inspection.isEnglishOnlyContent).toBe(false);
  });

  it('recognizes non-interleaved dual-track ASS (300 CN lines followed by 300 EN lines) and deduplicates repeated sign frames', () => {
    const lines: string[] = [
      '[Script Info]',
      'ScriptType: v4.00+',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
    ];
    // 250 frame-by-frame repeated sign animation lines at the start
    for (let i = 0; i < 250; i++) {
      lines.push(`Dialogue: 0,0:00:01.${String(i % 100).padStart(2, '0')},0:00:02.00,Sign,,0,0,0,,{\\pos(100,200)}招牌特效字幕`);
    }
    // 300 Chinese dialogue lines first
    for (let i = 1; i <= 300; i++) {
      const m = String(Math.floor(i / 60)).padStart(2, '0');
      const s = String(i % 60).padStart(2, '0');
      lines.push(`Dialogue: 0,0:${m}:${s}.00,0:${m}:${s}.80,CN,,0,0,0,,这是第${i}句中文台词。`);
    }
    // Followed by 300 English dialogue lines at matching timestamps
    for (let i = 1; i <= 300; i++) {
      const m = String(Math.floor(i / 60)).padStart(2, '0');
      const s = String(i % 60).padStart(2, '0');
      lines.push(`Dialogue: 0,0:${m}:${s}.00,0:${m}:${s}.80,EN,,0,0,0,,This is English dialogue line number ${i}.`);
    }

    const inspection = SubtitleExtractor.inspectSubtitleContent(Buffer.from(lines.join('\n'), 'utf-8'));
    expect(inspection.isBilingualContent).toBe(true);
    expect(inspection.hasChineseContent).toBe(true);
    expect(inspection.isEnglishOnlyContent).toBe(false);
  });
});
