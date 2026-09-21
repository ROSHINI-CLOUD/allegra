import type { UserData } from '../user/store.js';

export interface ListeningStats {
  readonly totalPlaysLogged: number;
  readonly playsLast7Days: number;
  readonly minutesListenedLast7Days: number;
  readonly distinctSongsLast30Days: number;
  readonly topArtists: { name: string; score: number }[];
  readonly topLanguages: { name: string; score: number }[];
  readonly signals: number;
  readonly onboarded: boolean;
}

const DAY_MS = 86_400_000;

/** Pure so the MCP `get_listening_stats` tool and any future scheduled-Task summary share one definition of "recent". */
export function summarizeListening(user: UserData, now = new Date()): ListeningStats {
  const cutoff7 = now.getTime() - 7 * DAY_MS;
  const cutoff30 = now.getTime() - 30 * DAY_MS;
  const recent7 = user.recentlyPlayed.filter((entry) => Date.parse(entry.playedAt) >= cutoff7);
  const recent30 = user.recentlyPlayed.filter((entry) => Date.parse(entry.playedAt) >= cutoff30);
  const taste = user.taste;

  return {
    totalPlaysLogged: user.recentlyPlayed.length,
    playsLast7Days: recent7.length,
    minutesListenedLast7Days: Math.round((recent7.reduce((sum, entry) => sum + entry.playDuration, 0) / 60) * 10) / 10,
    distinctSongsLast30Days: new Set(recent30.map((entry) => entry.songId)).size,
    topArtists: (taste?.artists ?? []).slice(0, 5).map((entry) => ({ name: entry.name, score: entry.score })),
    topLanguages: (taste?.languages ?? []).slice(0, 5).map((entry) => ({ name: entry.name, score: entry.score })),
    signals: taste?.signals ?? 0,
    onboarded: taste?.onboarded ?? false
  };
}
