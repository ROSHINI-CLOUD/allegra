import type { PlayStat } from './store.js';

/** Enough for a heavy listener's favourites without the profile growing without bound. */
export const MAX_PLAY_STATS = 200;
const HALF_LIFE_MS = 7 * 86_400_000;

/** Pressing play: one more play, moved to the front. Seconds arrive later with `recordListen`. */
export function recordPlay(stats: readonly PlayStat[] = [], songId: string, now = new Date()): PlayStat[] {
  return upsert(stats, songId, now, (stat) => ({ ...stat, plays: stat.plays + 1 }));
}

/** How long they actually stayed on the song. */
export function recordListen(stats: readonly PlayStat[] = [], songId: string, seconds: number, now = new Date()): PlayStat[] {
  if (!(seconds > 0)) return [...stats];
  return upsert(stats, songId, now, (stat) => ({ ...stat, seconds: stat.seconds + seconds, recent: stat.recent + seconds }));
}

/** `recent` decayed to `now`, so rows last touched at different times compare fairly. */
export function recentScore(stat: PlayStat, now = new Date()): number {
  return decay(stat.recent, stat.lastPlayedAt, now);
}

/** Songs they are into right now, strongest first. */
export function topRecent(stats: readonly PlayStat[] = [], limit: number, now = new Date()): string[] {
  return [...stats]
    .filter((stat) => stat.seconds > 0)
    .sort((left, right) => recentScore(right, now) - recentScore(left, now))
    .slice(0, limit)
    .map((stat) => stat.songId);
}

/** Songs they have spent the most time with, ever. */
export function topAllTime(stats: readonly PlayStat[] = [], limit: number): string[] {
  return [...stats]
    .filter((stat) => stat.seconds > 0)
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, limit)
    .map((stat) => stat.songId);
}

/** Signing in with guest history: the same song's plays and seconds add up. */
export function mergePlayStats(account: readonly PlayStat[] = [], guest: readonly PlayStat[] = [], now = new Date()): PlayStat[] {
  const merged = new Map<string, PlayStat>();
  for (const stat of [...account, ...guest]) {
    const existing = merged.get(stat.songId);
    if (!existing) {
      merged.set(stat.songId, stat);
      continue;
    }
    const later = existing.lastPlayedAt >= stat.lastPlayedAt ? existing.lastPlayedAt : stat.lastPlayedAt;
    merged.set(stat.songId, {
      songId: stat.songId,
      plays: existing.plays + stat.plays,
      seconds: existing.seconds + stat.seconds,
      recent: decay(existing.recent, existing.lastPlayedAt, new Date(later)) + decay(stat.recent, stat.lastPlayedAt, new Date(later)),
      lastPlayedAt: later
    });
  }
  const rows = [...merged.values()].sort((left, right) => right.lastPlayedAt.localeCompare(left.lastPlayedAt));
  return cap(rows, rows[0]?.songId, now);
}

function upsert(stats: readonly PlayStat[], songId: string, now: Date, change: (stat: PlayStat) => PlayStat): PlayStat[] {
  const existing = stats.find((stat) => stat.songId === songId);
  const base: PlayStat = existing
    ? { ...existing, recent: decay(existing.recent, existing.lastPlayedAt, now) }
    : { songId, plays: 0, seconds: 0, recent: 0, lastPlayedAt: now.toISOString() };
  const updated = { ...change(base), lastPlayedAt: now.toISOString() };
  return cap([updated, ...stats.filter((stat) => stat.songId !== songId)], songId, now);
}

/**
 * Over the cap, the rows that matter least go: little listening, long ago. The song just
 * touched always stays, or a new song could never get in once the list is full.
 */
function cap(stats: PlayStat[], keep: string | undefined, now: Date): PlayStat[] {
  if (stats.length <= MAX_PLAY_STATS) return stats;
  const worth = (stat: PlayStat): number => stat.seconds + 4 * recentScore(stat, now);
  const dropped = new Set(
    stats
      .filter((stat) => stat.songId !== keep)
      .sort((left, right) => worth(left) - worth(right) || left.lastPlayedAt.localeCompare(right.lastPlayedAt))
      .slice(0, stats.length - MAX_PLAY_STATS)
      .map((stat) => stat.songId)
  );
  return stats.filter((stat) => !dropped.has(stat.songId));
}

function decay(value: number, since: string, now: Date): number {
  const elapsed = now.getTime() - Date.parse(since);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return value;
  return value * 0.5 ** (elapsed / HALF_LIFE_MS);
}
