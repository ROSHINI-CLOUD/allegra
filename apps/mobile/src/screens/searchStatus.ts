/**
 * What the Online section of Search shows. Pure, so the rules are tested on their own (see searchStatus.test.ts).
 * First match wins: fresh results, then a request in flight, then a failed request, then no query yet, then empty.
 */
export type OnlineStatus = 'idle' | 'busy' | 'failed' | 'empty' | 'results';

export interface OnlineStatusInput {
  /** A request is in flight. */
  busy: boolean;
  /** The catalog answer for the current query; null means no query yet or scoped to the phone. */
  online: readonly unknown[] | null;
  /** Online results not already downloaded. */
  fresh: number;
  /** The last request threw. */
  failed: boolean;
}

export const onlineStatus = ({ busy, online, fresh, failed }: OnlineStatusInput): OnlineStatus => {
  if (fresh > 0) return 'results';
  if (busy) return 'busy';
  if (failed) return 'failed';
  if (online === null) return 'idle';
  return 'empty';
};
