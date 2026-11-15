/**
 * LRC helpers shared by the Echo lyrics providers.
 *
 * Providers hand back anything from word-synced "enhanced LRC" to Apple TTML.
 * Everything is normalised to `[mm:ss.xx]line` text, keeping word timings as
 * `<mm:ss.xxx>` tags inside the line (see `@shared/wordSync`) so the lyrics can
 * light up letter by letter. `stripWordTags` gives the plain line back.
 */
import { alignSyllables, enhancedLine, LyricWord, stripWordTags } from '@shared/wordSync';
import { decodeHtmlEntities, stripTags } from '../../utils/htmlText';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Milliseconds -> "[mm:ss.xx]". */
export const formatLrcTime = (ms: number): string => {
  const safe = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const centis = Math.floor((safe % 1000) / 10);
  return `[${pad(minutes)}:${pad(seconds)}.${pad(centis)}]`;
};

/**
 * TTML clock values: "12.5s", "340ms", "01:02.345", "1:02:03.4", "7.5".
 * Returns milliseconds, or null when unparseable.
 */
export const parseClock = (value: string | undefined): number | null => {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?s$/.test(v)) return Math.round(parseFloat(v) * 1000);
  if (/^\d+(\.\d+)?ms$/.test(v)) return Math.round(parseFloat(v));
  const parts = v.split(':');
  if (parts.length > 3 || parts.some(p => p === '' || isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  let seconds = 0;
  for (const n of nums) seconds = seconds * 60 + n;
  return Math.round(seconds * 1000);
};

const decodeEntities = decodeHtmlEntities;

/** Removes every `<span … ttm:role="x-bg">…</span>`, honouring nested spans. */
const stripBackgroundSpans = (body: string): string => {
  let result = body;
  for (;;) {
    const start = result.search(/<span\b[^>]*ttm:role="x-bg"[^>]*>/);
    if (start === -1) return result;
    const tagRegex = /<(\/?)span\b[^>]*>/g;
    tagRegex.lastIndex = start;
    let depth = 0;
    let end = result.length;
    let tag: RegExpExecArray | null;
    while ((tag = tagRegex.exec(result)) !== null) {
      depth += tag[1] ? -1 : 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    }
    result = result.slice(0, start) + result.slice(end);
  }
};

/**
 * The timed spans of a `<p>` body, in order. Text between spans (usually the
 * space that ends a word) joins the span before it; a span holding other spans
 * is skipped in favour of the ones inside it.
 */
const timedSpans = (body: string): LyricWord[] => {
  const spans: { text: string; start: number; end: number }[] = [];
  for (const m of body.matchAll(/<span\b([^>]*)>([^<]*)<\/span>|([^<]+)|<[^>]*>/g)) {
    if (m[3] !== undefined) {
      const last = spans[spans.length - 1];
      if (last) last.text += decodeEntities(m[3]);
      continue;
    }
    if (m[1] === undefined) continue;
    const start = parseClock(m[1].match(/\bbegin="([^"]+)"/)?.[1]);
    const end = parseClock(m[1].match(/\bend="([^"]+)"/)?.[1]);
    if (start === null) {
      const last = spans[spans.length - 1];
      if (last) last.text += decodeEntities(m[2]);
      continue;
    }
    spans.push({ text: decodeEntities(m[2]), start: start / 1000, end: (end ?? start) / 1000 });
  }
  return spans;
};

/**
 * Apple-style TTML -> LRC. Each `<p begin="…">` becomes one line, its timed word
 * (or syllable) spans kept as word tags. Background-vocal spans
 * (ttm:role="x-bg") are dropped so the main line stays readable.
 */
export const ttmlToLrc = (ttml: string): string => {
  const out: string[] = [];
  for (const match of ttml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const attrs = match[1];
    const begin = parseClock(attrs.match(/\bbegin="([^"]+)"/)?.[1]);
    if (begin === null) continue;
    const body = stripBackgroundSpans(match[2]).replace(/<br\s*\/?>/g, ' ');
    // Word spans are often written back-to-back with the space inside or
    // outside the tag — collapse tags to nothing, then normalise whitespace.
    const text = decodeEntities(stripTags(body)).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const syllables = alignSyllables(timedSpans(body), text);
    out.push(syllables.length > 0 ? enhancedLine(begin / 1000, syllables) : `${formatLrcTime(begin)}${text}`);
  }
  return out.join('\n');
};

/**
 * Normalises any LRC to clean lines, keeping word timing (`<00:12.34>`), and
 * dropping `{bg}` markers and metadata tags (`[ar:…]`, `[offset:…]`).
 */
export const toTimedLrc = (lrc: string): string =>
  lrc
    .split(/\r\n|\r|\n/)
    .map(line => line.replace(/\{bg\}/g, ''))
    .filter(line => !/^\[(ar|ti|al|by|offset|length|re|ve|au|#):/i.test(line.trim()))
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

/** As `toTimedLrc`, with the word timing taken out too: plain line LRC. */
export const toLineLrc = (lrc: string): string =>
  toTimedLrc(lrc)
    .split('\n')
    .map(line => stripWordTags(line))
    .filter(Boolean)
    .join('\n');

export const hasLrcTimestamps = (text: string): boolean => /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(text);
