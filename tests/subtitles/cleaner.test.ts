import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import { SubtitleCleaner } from '../../src/services/subtitles/core/cleaner.js';

describe('SubtitleCleaner', () => {
  it('detects and decodes GBK encoded bytes', () => {
    const rawGbk = iconv.encode('中文测试对白', 'gbk');
    const { text, encoding } = SubtitleCleaner.detectAndDecode(rawGbk);
    expect(text).toBe('中文测试对白');
    expect(['gb18030', 'gbk']).toContain(encoding);
  });

  it('converts ASS content to clean sorted SRT format', () => {
    const sampleAss = `[Script Info]
Title: Sample
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:20.50,0:01:23.00,Default,,0,0,0,,{\\pos(192,200)}Hello{\\b1} World{\\b0}
Dialogue: 0,0:01:10.00,0:01:12.45,Default,,0,0,0,,{\\p1}Drawing Command{\\p0}
Dialogue: 0,0:01:15.00,0:01:18.00,Default,,0,0,0,,Line One\\NLine Two
`;
    const srtBuffer = SubtitleCleaner.normalizeToUtf8Srt(Buffer.from(sampleAss, 'utf-8'), 'sample.ass');
    const srt = srtBuffer.toString('utf-8');

    expect(srt).toContain('00:01:15,000 --> 00:01:18,000');
    expect(srt).toContain('Line One\nLine Two');
    expect(srt).toContain('Hello World');
    expect(srt).not.toContain('{\\pos');
    expect(srt).not.toContain('{\\b1}');
    expect(srt).not.toContain('Drawing Command');
    // Ensure chronological order
    const idx1 = srt.indexOf('00:01:15,000');
    const idx2 = srt.indexOf('00:01:20,500');
    expect(idx1).toBeLessThan(idx2);
  });

  it('converts WebVTT to SRT correctly', () => {
    const sampleVtt = `WEBVTT
NOTE cue note

00:01.500 --> 00:04.000
WebVTT Subtitle line
`;
    const srt = SubtitleCleaner.vttToSrt(sampleVtt);
    expect(srt).toContain('00:00:01,500 --> 00:00:04,000');
    expect(srt).toContain('WebVTT Subtitle line');
  });

  it('preserves ASS tags and format while converting GBK to UTF-8 in normalizeToUtf8Original', () => {
    const rawAssGbk = iconv.encode(
      `[Script Info]\nTitle: 测试字幕\n[Events]\nFormat: Layer, Start, End, Text\nDialogue: 0,0:01:20.50,0:01:23.00,{\\pos(192,200)}中文对白\n`,
      'gbk'
    );
    const { buffer, ext } = SubtitleCleaner.normalizeToUtf8Original(rawAssGbk, 'test.ass');
    expect(ext).toBe('ass');
    const text = buffer.toString('utf-8');
    expect(text).toContain('{\\pos(192,200)}中文对白');
    expect(text).toContain('[Script Info]');
  });

  it('validates subtitle content properly with isValidSubtitleContent', () => {
    expect(SubtitleCleaner.isValidSubtitleContent('1\n00:00:01,000 --> 00:00:03,000\nHello\n')).toBe(true);
    expect(SubtitleCleaner.isValidSubtitleContent('[Script Info]\nTitle: Test\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hi')).toBe(true);
    expect(SubtitleCleaner.isValidSubtitleContent('WEBVTT\n\n00:01.000 --> 00:03.000\nHi\n')).toBe(true);
    expect(SubtitleCleaner.isValidSubtitleContent('Short text')).toBe(false);
    expect(SubtitleCleaner.isValidSubtitleContent('<html><head><title>404 Not Found</title></head><body>Error</body></html>')).toBe(false);
  });
});
