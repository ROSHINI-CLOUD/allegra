import assert from 'node:assert/strict';
import test from 'node:test';

import type { UserData } from '../user/store.js';
import { summarizeListening } from './stats.js';

const NOW = new Date('2026-09-21T00:00:00.000Z');

function user(overrides: Partial<UserData> = {}): UserData {
  return {
    userId: 'u1',
    isGuest: false,
    createdAt: NOW.toISOString(),
    libraries: [],
    likedSongIds: [],
    recentlyPlayed: [],
    settings: {},
    ...overrides
  };
}

test('counts only plays inside each recency window', () => {
  const stats = summarizeListening(user({
    recentlyPlayed: [
      { songId: 'a', playDuration: 120, playedAt: '2026-09-20T00:00:00.000Z' }, // 1 day ago
      { songId: 'b', playDuration: 60, playedAt: '2026-09-10T00:00:00.000Z' }, // 11 days ago
      { songId: 'c', playDuration: 30, playedAt: '2026-06-01T00:00:00.000Z' } // outside 30 days
    ]
  }), NOW);

  assert.equal(stats.totalPlaysLogged, 3);
  assert.equal(stats.playsLast7Days, 1);
  assert.equal(stats.minutesListenedLast7Days, 2);
  assert.equal(stats.distinctSongsLast30Days, 2);
});

test('surfaces the existing taste profile without recomputing it', () => {
  const stats = summarizeListening(user({
    taste: {
      artists: [{ name: 'Arijit Singh', score: 5 }],
      languages: [{ name: 'Hindi', score: 3 }],
      signals: 12,
      onboarded: true,
      updatedAt: NOW.toISOString()
    }
  }), NOW);

  assert.deepEqual(stats.topArtists, [{ name: 'Arijit Singh', score: 5 }]);
  assert.deepEqual(stats.topLanguages, [{ name: 'Hindi', score: 3 }]);
  assert.equal(stats.signals, 12);
  assert.equal(stats.onboarded, true);
});

test('handles a listener with no history yet', () => {
  const stats = summarizeListening(user(), NOW);
  assert.equal(stats.totalPlaysLogged, 0);
  assert.equal(stats.minutesListenedLast7Days, 0);
  assert.deepEqual(stats.topArtists, []);
  assert.equal(stats.onboarded, false);
});
