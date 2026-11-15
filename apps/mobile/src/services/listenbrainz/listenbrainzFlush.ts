/**
 * One pass over the ListenBrainz queue, with every outside effect passed in so the rules can be tested without a
 * phone: which rows go out, what an answer does to them, and when to try again.
 */
import { BATCH_SIZE, classifyResponse, type QueuedListen, type SubmitResult } from './listenbrainzApi';

export interface FlushDeps {
  readonly now: () => number;
  readonly dueListens: (nowMs: number, limit: number) => Promise<QueuedListen[]>;
  readonly submit: (batch: readonly QueuedListen[]) => Promise<SubmitResult>;
  readonly removeListens: (ids: readonly number[]) => Promise<void>;
  readonly deferListens: (ids: readonly number[], nextAttemptAtMs: number) => Promise<void>;
}

export interface FlushOutcome {
  readonly sent: number;
  readonly dropped: number;
  readonly retried: number;
  /** ListenBrainz refused the token: the caller must stop sending and ask the listener to reconnect. */
  readonly invalidToken: boolean;
  /** When to look again (ms since the epoch), or null when the queue is empty or the token was refused. */
  readonly nextAttemptAt: number | null;
}

/** At most this many batches per pass, so one flush cannot hold the phone's network for long. */
export const MAX_BATCHES_PER_FLUSH = 6;

export async function flushQueue(deps: FlushDeps): Promise<FlushOutcome> {
  let sent = 0;
  let dropped = 0;
  let retried = 0;
  let nextAttemptAt: number | null = null;

  for (let pass = 0; pass < MAX_BATCHES_PER_FLUSH; pass += 1) {
    const batch = await deps.dueListens(deps.now(), BATCH_SIZE);
    if (batch.length === 0) break;
    const ids = batch.map((listen) => listen.id);
    const attempts = Math.max(...batch.map((listen) => listen.attempts));
    const result = await deps.submit(batch);
    const verdict = classifyResponse(result.status, result.retryAfterSec, attempts);

    if (verdict.kind === 'sent') {
      await deps.removeListens(ids);
      sent += batch.length;
      continue;
    }
    if (verdict.kind === 'drop') {
      await deps.removeListens(ids);
      dropped += batch.length;
      continue;
    }
    if (verdict.kind === 'invalid-token') {
      return { sent, dropped, retried, invalidToken: true, nextAttemptAt: null };
    }
    // Retry later. Stop this pass: the rest of the queue would meet the same answer.
    const at = deps.now() + verdict.afterSec * 1000;
    await deps.deferListens(ids, at);
    retried += batch.length;
    nextAttemptAt = at;
    break;
  }
  return { sent, dropped, retried, invalidToken: false, nextAttemptAt };
}
