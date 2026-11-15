import {
  buildSubmitBody,
  classifyResponse,
  cleanToken,
  listenQualifies,
  retryDelaySec,
  type QueuedListen,
} from './listenbrainzApi';
import { flushQueue, MAX_BATCHES_PER_FLUSH, type FlushDeps } from './listenbrainzFlush';

const base = { title: 'Jai Ho', artist: 'A. R. Rahman', album: null, durationSec: 320, startedAt: 1_700_000_000_000, heardSec: 200 };

describe('listenQualifies', () => {
  it('counts a song heard for half its length', () => {
    expect(listenQualifies({ ...base, durationSec: 200, heardSec: 100 })).toBe(true);
    expect(listenQualifies({ ...base, durationSec: 200, heardSec: 99 })).toBe(false);
  });

  it('counts a long song after four minutes, not half', () => {
    expect(listenQualifies({ ...base, durationSec: 900, heardSec: 240 })).toBe(true);
    expect(listenQualifies({ ...base, durationSec: 900, heardSec: 239 })).toBe(false);
  });

  it('never counts a song of 30 seconds or less', () => {
    expect(listenQualifies({ ...base, durationSec: 30, heardSec: 30 })).toBe(false);
    expect(listenQualifies({ ...base, durationSec: 31, heardSec: 16 })).toBe(true);
  });

  it('counts a song of unknown length after four minutes only', () => {
    expect(listenQualifies({ ...base, durationSec: 0, heardSec: 239 })).toBe(false);
    expect(listenQualifies({ ...base, durationSec: 0, heardSec: 240 })).toBe(true);
  });

  it('refuses a listen without a title or an artist, which ListenBrainz would reject', () => {
    expect(listenQualifies({ ...base, title: '  ' })).toBe(false);
    expect(listenQualifies({ ...base, artist: '' })).toBe(false);
  });

  it('refuses non-finite numbers', () => {
    expect(listenQualifies({ ...base, heardSec: Number.NaN })).toBe(false);
    expect(listenQualifies({ ...base, startedAt: Number.NaN })).toBe(false);
  });
});

describe('buildSubmitBody', () => {
  const listen: QueuedListen = { id: 1, listenedAt: 1_700_000_000, title: 'Jai Ho', artist: 'A. R. Rahman', album: 'Slumdog Millionaire', durationSec: 319.6, attempts: 0 };

  it('sends an import with the listen time in seconds and the length in milliseconds', () => {
    const body = buildSubmitBody([listen], '1.68.0');
    expect(body.listen_type).toBe('import');
    expect(body.payload).toEqual([
      {
        listened_at: 1_700_000_000,
        track_metadata: {
          artist_name: 'A. R. Rahman',
          track_name: 'Jai Ho',
          release_name: 'Slumdog Millionaire',
          additional_info: { media_player: 'LuvLyrics', submission_client: 'LuvLyrics', submission_client_version: '1.68.0', duration_ms: 319_600 },
        },
      },
    ]);
  });

  it('leaves out the album, the length and the version when they are unknown', () => {
    const body = buildSubmitBody([{ ...listen, album: null, durationSec: 0 }], '');
    const info = body.payload[0]?.track_metadata;
    expect(info?.release_name).toBeUndefined();
    expect(info?.additional_info).toEqual({ media_player: 'LuvLyrics', submission_client: 'LuvLyrics' });
  });

  it('caps very long names', () => {
    const body = buildSubmitBody([{ ...listen, title: 'x'.repeat(900) }], '1');
    expect(body.payload[0]?.track_metadata.track_name).toHaveLength(300);
  });
});

describe('classifyResponse', () => {
  it('treats 2xx as sent', () => {
    expect(classifyResponse(200, null, 0)).toEqual({ kind: 'sent' });
  });

  it('stops on a refused token', () => {
    expect(classifyResponse(401, null, 0)).toEqual({ kind: 'invalid-token' });
  });

  it('waits out a rate limit using the server hint, within bounds', () => {
    expect(classifyResponse(429, 90, 0)).toEqual({ kind: 'retry', afterSec: 90 });
    expect(classifyResponse(429, 1, 0)).toEqual({ kind: 'retry', afterSec: 30 });
    expect(classifyResponse(429, 999_999, 0)).toEqual({ kind: 'retry', afterSec: 21_600 });
  });

  it('retries offline, timeouts and server errors with growing delays', () => {
    expect(classifyResponse(0, null, 0)).toEqual({ kind: 'retry', afterSec: 60 });
    expect(classifyResponse(503, null, 2)).toEqual({ kind: 'retry', afterSec: 1_800 });
    expect(classifyResponse(408, null, 9)).toEqual({ kind: 'retry', afterSec: 21_600 });
  });

  it('drops a batch ListenBrainz refuses as malformed', () => {
    expect(classifyResponse(400, null, 0)).toEqual({ kind: 'drop' });
    expect(classifyResponse(422, null, 0)).toEqual({ kind: 'drop' });
  });

  it('clamps the retry table', () => {
    expect(retryDelaySec(0)).toBe(60);
    expect(retryDelaySec(100)).toBe(21_600);
  });
});

describe('cleanToken', () => {
  it('accepts a UUID and trims whitespace', () => {
    expect(cleanToken('  3f8a2c1e-9b7d-4e6a-8c55-0a1b2c3d4e5f \n')).toBe('3f8a2c1e-9b7d-4e6a-8c55-0a1b2c3d4e5f');
  });

  it('rejects anything that is not a plain token', () => {
    expect(cleanToken('short')).toBeNull();
    expect(cleanToken('has spaces inside the token value ok')).toBeNull();
    expect(cleanToken('Token 3f8a2c1e-9b7d-4e6a-8c55-0a1b2c3d4e5f')).toBeNull();
  });
});

function queue(count: number, attempts = 0): QueuedListen[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1, listenedAt: 1_700_000_000 + index, title: `Song ${index}`, artist: 'Artist', album: null, durationSec: 200, attempts,
  }));
}

function harness(rows: QueuedListen[], status: (call: number) => number, retryAfter: number | null = null) {
  let pending = [...rows];
  const calls: number[][] = [];
  const deferred: Array<{ ids: readonly number[]; at: number }> = [];
  const deps: FlushDeps = {
    now: () => 1_000_000,
    dueListens: async (_now, limit) => pending.slice(0, limit),
    submit: async (batch) => {
      calls.push(batch.map(listen => listen.id));
      return { status: status(calls.length), retryAfterSec: retryAfter };
    },
    removeListens: async (ids) => { pending = pending.filter(row => !ids.includes(row.id)); },
    deferListens: async (ids, at) => {
      deferred.push({ ids, at });
      pending = pending.filter(row => !ids.includes(row.id));
    },
  };
  return { deps, calls, deferred, left: () => pending.length };
}

describe('flushQueue', () => {
  it('sends the oldest listens in batches of 50 and clears them', async () => {
    const h = harness(queue(120), () => 200);
    const outcome = await flushQueue(h.deps);
    expect(h.calls.map(batch => batch.length)).toEqual([50, 50, 20]);
    expect(outcome).toMatchObject({ sent: 120, dropped: 0, retried: 0, invalidToken: false, nextAttemptAt: null });
    expect(h.left()).toBe(0);
  });

  it('does nothing when the queue is empty', async () => {
    const h = harness([], () => 200);
    expect(await flushQueue(h.deps)).toMatchObject({ sent: 0, nextAttemptAt: null });
    expect(h.calls).toHaveLength(0);
  });

  it('stops after the first failed batch and defers it', async () => {
    const h = harness(queue(120), () => 503);
    const outcome = await flushQueue(h.deps);
    expect(h.calls).toHaveLength(1);
    expect(outcome.retried).toBe(50);
    expect(outcome.nextAttemptAt).toBe(1_000_000 + 60_000);
    expect(h.deferred[0]?.at).toBe(1_060_000);
  });

  it('uses a longer wait once a batch has failed before', async () => {
    const h = harness(queue(3, 2), () => 0);
    const outcome = await flushQueue(h.deps);
    expect(outcome.nextAttemptAt).toBe(1_000_000 + 1_800_000);
  });

  it('keeps the queue and reports a refused token', async () => {
    const h = harness(queue(10), () => 401);
    const outcome = await flushQueue(h.deps);
    expect(outcome).toMatchObject({ invalidToken: true, sent: 0, nextAttemptAt: null });
    expect(h.left()).toBe(10);
    expect(h.deferred).toHaveLength(0);
  });

  it('drops a refused batch and carries on with the next', async () => {
    const h = harness(queue(70), call => (call === 1 ? 400 : 200));
    const outcome = await flushQueue(h.deps);
    expect(outcome).toMatchObject({ dropped: 50, sent: 20 });
    expect(h.left()).toBe(0);
  });

  it('caps one pass so a huge queue cannot hold the network', async () => {
    const h = harness(queue(500), () => 200);
    await flushQueue(h.deps);
    expect(h.calls).toHaveLength(MAX_BATCHES_PER_FLUSH);
    expect(h.left()).toBe(500 - MAX_BATCHES_PER_FLUSH * 50);
  });

  it('honours a rate-limit hint', async () => {
    const h = harness(queue(5), () => 429, 120);
    const outcome = await flushQueue(h.deps);
    expect(outcome.nextAttemptAt).toBe(1_000_000 + 120_000);
  });
});
