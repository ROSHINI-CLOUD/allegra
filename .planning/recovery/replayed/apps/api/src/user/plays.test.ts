import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_PLAY_STATS, mergePlayStats, recentScore, recordListen, recordPlay, topAllTime, topRecent } from './plays.js';
import type { PlayStat } from './store.js';

const DAY = 86_400_000;
const at = (days: number): Date => new Date(Date.UTC(2026, 8, 1) + days * DAY);

test('a play counts once; listening time arrives separately and adds up', () => {
  let stats = recordPlay([], 'a', at(0));
  stats = recordListen(stats, 'a', 200, at(0));
  stats = recordPlay(stats, 'a', at(0));
  stats = recordListen(stats, 'a', 100, at(0));
  assert.deepEqual(stats, [{ songId: 'a', plays: 2, seconds: 300, recent: 300, lastPlayedAt: at(0).toISOString() }]);
  assert.deepEqual(recordListen(stats, 'a', 0, at(0)), stats);
});

test('recent listening halves every week, all-time listening never fades', () => {
  const stats = recordListen([], 'a', 400, at(0));
  const [stat] = stats;
  assert.ok(stat);
  assert.equal(recentScore(stat, at(7)), 200);
  assert.equal(recentScore(stat, at(14)), 100);
  assert.equal(stat.seconds, 400);
});

test('this week and all time can disagree, which is the point of having both', () => {
  let stats = recordListen([], 'old-favourite', 5_000, at(0));
  stats = recordListen(stats, 'new-obsession', 900, at(30));
  assert.deepEqual(topRecent(stats, 1, at(30)), ['new-obsession']);
  assert.deepEqual(topAllTime(stats, 1), ['old-favourite']);
  // A song pressed but skipped before any listening time is nobody's favourite.
  assert.deepEqual(topAllTime(recordPlay([], 'skipped', at(0)), 5), []);
});

test('over the cap the least-listened rows go, but the song just played always stays', () => {
  let stats: PlayStat[] = [];
  for (let index = 0; index < MAX_PLAY_STATS; index += 1) stats = recordListen(stats, `s${index}`, 100 + index, at(0));
  stats = recordPlay(stats, 'brand-new', at(1));
  assert.equal(stats.length, MAX_PLAY_STATS);
  assert.equal(stats[0]?.songId, 'brand-new');
  assert.ok(!stats.some((stat) => stat.songId === 's0'));
  assert.ok(stats.some((stat) => stat.songId === `s${MAX_PLAY_STATS - 1}`));
});

test('signing in adds the guest tally to the account tally', () => {
  const account = recordListen([], 'a', 100, at(0));
  const guest = recordListen(recordListen([], 'a', 50, at(0)), 'b', 30, at(0));
  const merged = mergePlayStats(account, guest, at(0));
  assert.deepEqual(merged.map((stat) => [stat.songId, stat.plays, stat.seconds]).sort(), [['a', 0, 150], ['b', 0, 30]]);
  assert.deepEqual(mergePlayStats(undefined, undefined), []);
});
