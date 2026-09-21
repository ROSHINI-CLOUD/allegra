import type { LyricLine } from '../types.js';

const TIMESTAMP = /(?:\[\s*|\(\s*|)(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?(?:\s*\]|\s*\)|)/g;

/** LRC header tags such as [ar:Artist], [length: 3:47] or [offset:+200]. They are metadata, not lyrics. */
const ID_TAG = /^\s*\[\s*(?:ar|ti|al|au|by|length|offset|re|ve|id|la|tool|#)\s*:/i;

export function parseLyrics(raw: string, duration: number): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (ID_TAG.test(line)) {
      continue;
    }
    const stamps = [...line.matchAll(TIMESTAMP)];
    if (stamps.length === 0) {
      continue;
    }
    const text = line.replace(TIMESTAMP, '').trim() || '[INSTRUMENTAL]';
    for (const stamp of stamps) {
      const minutes = Number.parseInt(stamp[1] ?? '0', 10);
      const seconds = Number.parseInt(stamp[2] ?? '0', 10);
      const fraction = stamp[3] ?? '';
      const timestamp = minutes * 60 + seconds + (fraction ? Number(fraction) / 10 ** fraction.length : 0);
      lines.push({ timestamp, text, lineOrder: 0 });
    }
  }

  if (lines.length > 0) {
    return lines
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((line, lineOrder) => ({ ...line, lineOrder }));
  }

  const plain = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !ID_TAG.test(line));
  const safeDuration = duration > 0 ? duration : 180;
  const timePerLine = plain.length > 0 ? safeDuration / plain.length : 0;
  return plain.map((text, lineOrder) => ({
    timestamp: lineOrder * timePerLine,
    text,
    lineOrder
  }));
}

export function hasTimestamps(value: string): boolean {
  return /(?:\[\s*|\(\s*|)\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?(?:\s*\]|\s*\)|)/.test(value);
}
