import type { LrclibEntry } from '../providers/lrclib.js';

export interface LyricScore {
  readonly score: number;
  readonly reason: string;
}

export function scoreLyrics(entry: LrclibEntry, title: string, duration?: number): LyricScore {
  const titleScore = similarity(normalize(entry.trackName ?? ''), normalize(title));
  const score = Math.min(
    100,
    (titleScore > 0.8 ? 30 : titleScore > 0.5 ? 15 : 0) +
      (entry.syncedLyrics?.trim() ? 20 : 0) +
      (duration !== undefined && entry.duration !== undefined
        ? Math.abs(entry.duration - duration) <= 2
          ? 10
          : Math.abs(entry.duration - duration) <= 10
            ? 5
            : 0
        : 0)
  );
  const reasons = [
    ...(titleScore > 0.5 ? ['Title match'] : []),
    ...(entry.syncedLyrics?.trim() ? ['Synced'] : []),
    ...(duration !== undefined && entry.duration !== undefined && Math.abs(entry.duration - duration) <= 2
      ? ['Exact duration']
      : [])
  ];
  return { score, reason: reasons.join(' • ') || 'Best available match' };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function similarity(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }
  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}
