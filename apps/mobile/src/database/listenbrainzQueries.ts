/**
 * The queue behind the optional ListenBrainz copy of the listening history. A row waits here until ListenBrainz
 * accepts it. Disconnecting clears it. Nothing here touches `listen_log`.
 */
import { withDbRead, withDbWrite } from './db';
import { MAX_AGE_MS, MAX_QUEUED, type QueuedListen } from '../services/listenbrainz/listenbrainzApi';

interface QueueRow {
  id: number; listened_at: number; title: string; artist: string; album: string | null;
  duration_sec: number; attempts: number;
}

const toListen = (row: QueueRow): QueuedListen => ({
  id: row.id, listenedAt: row.listened_at, title: row.title, artist: row.artist, album: row.album,
  durationSec: row.duration_sec, attempts: row.attempts,
});

/** Adds one listen. The same start time, title and artist is kept once, so a repeated report cannot double-send. */
export async function enqueueListen(listen: Omit<QueuedListen, 'id' | 'attempts'>): Promise<void> {
  await withDbWrite(async db => {
    await db.runAsync(
      `INSERT OR IGNORE INTO listenbrainz_queue (listened_at, title, artist, album, duration_sec, attempts, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [listen.listenedAt, listen.title, listen.artist, listen.album, listen.durationSec],
    );
    // Bounded storage: when the cap is passed the oldest rows go first.
    await db.runAsync(
      `DELETE FROM listenbrainz_queue WHERE id IN (
         SELECT id FROM listenbrainz_queue ORDER BY listened_at DESC LIMIT -1 OFFSET ?
       )`,
      [MAX_QUEUED],
    );
  });
}

/** Rows older than the retention window will not be sent; remove them. Returns how many went. */
export async function dropStaleListens(nowMs: number): Promise<void> {
  const oldest = Math.floor((nowMs - MAX_AGE_MS) / 1000);
  await withDbWrite(db => db.runAsync('DELETE FROM listenbrainz_queue WHERE listened_at < ?', [oldest]));
}

/** The oldest listens that are due, up to `limit`. */
export async function dueListens(nowMs: number, limit: number): Promise<QueuedListen[]> {
  const rows = await withDbRead(db => db.getAllAsync<QueueRow>(
    'SELECT id, listened_at, title, artist, album, duration_sec, attempts FROM listenbrainz_queue WHERE next_attempt_at <= ? ORDER BY listened_at ASC LIMIT ?',
    [nowMs, limit],
  ));
  return rows.map(toListen);
}

export async function removeListens(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const marks = ids.map(() => '?').join(',');
  await withDbWrite(db => db.runAsync(`DELETE FROM listenbrainz_queue WHERE id IN (${marks})`, [...ids]));
}

/** Push a batch back: one more attempt, not due again until `nextAttemptAtMs`. */
export async function deferListens(ids: readonly number[], nextAttemptAtMs: number): Promise<void> {
  if (ids.length === 0) return;
  const marks = ids.map(() => '?').join(',');
  await withDbWrite(db => db.runAsync(
    `UPDATE listenbrainz_queue SET attempts = attempts + 1, next_attempt_at = ? WHERE id IN (${marks})`,
    [nextAttemptAtMs, ...ids],
  ));
}

export async function queuedCount(): Promise<number> {
  const row = await withDbRead(db => db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM listenbrainz_queue'));
  return row?.n ?? 0;
}

/** The soonest a deferred row becomes due, or null when nothing is waiting. */
export async function nextDueAt(): Promise<number | null> {
  const row = await withDbRead(db => db.getFirstAsync<{ at: number | null }>('SELECT MIN(next_attempt_at) AS at FROM listenbrainz_queue'));
  return row?.at ?? null;
}

export async function clearQueue(): Promise<void> {
  await withDbWrite(db => db.execAsync('DELETE FROM listenbrainz_queue'));
}
