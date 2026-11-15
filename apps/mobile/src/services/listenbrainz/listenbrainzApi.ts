/**
 * ListenBrainz (open source) is the optional place a listener can copy their listening history to.
 * Nothing here talks to an Allegra server: the phone sends the listener's own token straight to
 * api.listenbrainz.org, so there is nothing to host. The history itself stays in `listen_log`.
 *
 * Pure parts (payload, eligibility, response classification, retry) live here so they can be tested
 * without a network or a database.
 */
import { SCROBBLE_RULES } from '@shared/scrobble';

export const LISTENBRAINZ_ROOT = 'https://api.listenbrainz.org/1';
export const CLIENT_NAME = 'LuvLyrics';
/** ListenBrainz takes far more, but a small batch keeps one bad row from costing much on a retry. */
export const BATCH_SIZE = SCROBBLE_RULES.batchSize;
/** Queued listens older than this are dropped rather than sent, and the queue never holds more than the cap. */
export const MAX_AGE_MS = 30 * 86_400_000;
export const MAX_QUEUED = 500;
const NAME_MAX = 300;

export interface QueuedListen {
  readonly id: number;
  /** Seconds since the epoch when the listen started. */
  readonly listenedAt: number;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly durationSec: number;
  readonly attempts: number;
}

export interface ListenInput {
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly durationSec: number;
  /** ms since the epoch. */
  readonly startedAt: number;
  readonly heardSec: number;
}

/**
 * Whether a listen counts: Last.fm's published rule, which ListenBrainz suggests too. The track must be longer than
 * 30 s and heard for half its length or 4 minutes, whichever comes first. A track with no known length counts after
 * 4 minutes. Names must exist, since ListenBrainz refuses a listen without them.
 */
export function listenQualifies(input: ListenInput): boolean {
  if (input.title.trim() === '' || input.artist.trim() === '') return false;
  if (!Number.isFinite(input.startedAt) || !Number.isFinite(input.heardSec)) return false;
  if (!(input.durationSec > 0)) return input.heardSec >= SCROBBLE_RULES.capSec;
  if (input.durationSec <= SCROBBLE_RULES.minTrackSec) return false;
  return input.heardSec >= Math.min(input.durationSec / 2, SCROBBLE_RULES.capSec);
}

interface ListenBrainzListen {
  listened_at: number;
  track_metadata: {
    artist_name: string;
    track_name: string;
    release_name?: string;
    additional_info: {
      media_player: string;
      submission_client: string;
      submission_client_version?: string;
      duration_ms?: number;
    };
  };
}

export interface SubmitBody {
  listen_type: 'import';
  payload: ListenBrainzListen[];
}

export function buildSubmitBody(listens: readonly QueuedListen[], appVersion: string): SubmitBody {
  return {
    listen_type: 'import',
    payload: listens.map((listen) => ({
      listened_at: listen.listenedAt,
      track_metadata: {
        artist_name: listen.artist.slice(0, NAME_MAX),
        track_name: listen.title.slice(0, NAME_MAX),
        ...(listen.album ? { release_name: listen.album.slice(0, NAME_MAX) } : {}),
        additional_info: {
          media_player: CLIENT_NAME,
          submission_client: CLIENT_NAME,
          ...(appVersion ? { submission_client_version: appVersion } : {}),
          ...(listen.durationSec > 0 ? { duration_ms: Math.round(listen.durationSec * 1000) } : {}),
        },
      },
    })),
  };
}

/** What to do with a batch after ListenBrainz (or the network) answered. */
export type SubmitVerdict =
  | { readonly kind: 'sent' }
  | { readonly kind: 'retry'; readonly afterSec: number }
  | { readonly kind: 'invalid-token' }
  | { readonly kind: 'drop' };

const RETRY_STEPS_SEC = [60, 300, 1_800, 7_200, 21_600] as const;

/** Delay after `attempts` failures (1-based). The last step repeats. */
export function retryDelaySec(attempts: number): number {
  const index = Math.min(Math.max(Math.floor(attempts), 1), RETRY_STEPS_SEC.length) - 1;
  return RETRY_STEPS_SEC[index] ?? 21_600;
}

function clampDelay(sec: number): number {
  return Number.isFinite(sec) ? Math.min(Math.max(Math.ceil(sec), 30), 21_600) : 300;
}

/** `status` is 0 for a request that never got an answer (offline, timeout). */
export function classifyResponse(status: number, retryAfterSec: number | null, attempts: number): SubmitVerdict {
  if (status >= 200 && status < 300) return { kind: 'sent' };
  if (status === 401) return { kind: 'invalid-token' };
  if (status === 429) return { kind: 'retry', afterSec: clampDelay(retryAfterSec ?? retryDelaySec(attempts + 1)) };
  if (status === 0 || status === 408 || status >= 500) return { kind: 'retry', afterSec: retryDelaySec(attempts + 1) };
  // Any other 4xx means the batch itself is refused; sending it again cannot change that.
  return { kind: 'drop' };
}

export interface SubmitResult {
  readonly status: number;
  readonly retryAfterSec: number | null;
}

async function call(path: string, token: string, init: { method: 'GET' | 'POST'; body?: string }, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${LISTENBRAINZ_ROOT}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Token ${token}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function submitListens(token: string, body: SubmitBody, timeoutMs = 15_000): Promise<SubmitResult> {
  const response = await call('/submit-listens', token, { method: 'POST', body: JSON.stringify(body) }, timeoutMs);
  if (!response) return { status: 0, retryAfterSec: null };
  const reset = Number(response.headers.get('X-RateLimit-Reset-In'));
  return { status: response.status, retryAfterSec: Number.isFinite(reset) && reset > 0 ? reset : null };
}

export type TokenCheck =
  | { readonly kind: 'valid'; readonly username: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unreachable' };

/** Asks ListenBrainz whether a pasted token is real, and whose it is. */
export async function validateToken(token: string, timeoutMs = 10_000): Promise<TokenCheck> {
  const response = await call('/validate-token', token, { method: 'GET' }, timeoutMs);
  if (!response) return { kind: 'unreachable' };
  if (response.status >= 500 || response.status === 429) return { kind: 'unreachable' };
  try {
    const json = (await response.json()) as { valid?: unknown; user_name?: unknown };
    if (json.valid === true && typeof json.user_name === 'string' && json.user_name !== '') {
      return { kind: 'valid', username: json.user_name };
    }
  } catch {
    // An unreadable answer is treated like a bad token.
  }
  return { kind: 'invalid' };
}

/** A pasted token: ListenBrainz tokens are UUIDs; accept a single-line value of sane length. */
export function cleanToken(raw: string): string | null {
  const token = raw.trim();
  return /^[A-Za-z0-9-]{16,64}$/.test(token) ? token : null;
}
