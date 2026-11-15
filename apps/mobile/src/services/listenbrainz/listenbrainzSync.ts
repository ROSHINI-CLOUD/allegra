/**
 * Optional ListenBrainz copy of the listening history. The listener pastes their own ListenBrainz token in Settings;
 * the phone then sends each finished listen straight to ListenBrainz. No Allegra server is involved, the token never
 * leaves the phone's keystore except to ListenBrainz, and the history itself stays in `listen_log`.
 */
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { clearQueue, dropStaleListens, dueListens, deferListens, enqueueListen, nextDueAt, queuedCount, removeListens } from '../../database/listenbrainzQueries';
import {
  buildSubmitBody,
  cleanToken,
  listenQualifies,
  submitListens,
  validateToken,
  type ListenInput,
} from './listenbrainzApi';
import { flushQueue } from './listenbrainzFlush';

const KEY = 'allegra.listenbrainz.v1';
/** Wait a little after a listen so a skip streak sends one request, not one each. */
const FLUSH_DELAY_MS = 20_000;

interface Saved {
  token: string;
  username: string;
  enabled: boolean;
  /** ListenBrainz refused the token; sending stays off until a new one is pasted. */
  needsToken: boolean;
}

export interface ListenbrainzState {
  loaded: boolean;
  connected: boolean;
  username: string;
  enabled: boolean;
  needsToken: boolean;
  pending: number;
  set: (patch: Partial<Omit<ListenbrainzState, 'set'>>) => void;
}

export const useListenbrainzStore = create<ListenbrainzState>()((set) => ({
  loaded: false,
  connected: false,
  username: '',
  enabled: false,
  needsToken: false,
  pending: 0,
  set: (patch) => set(patch),
}));

let saved: Saved | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

async function readSaved(): Promise<Saved | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const json = JSON.parse(raw) as Partial<Saved>;
    if (typeof json.token !== 'string' || typeof json.username !== 'string') return null;
    return { token: json.token, username: json.username, enabled: json.enabled === true, needsToken: json.needsToken === true };
  } catch {
    // An unreadable entry (a keystore key that no longer exists) reads as "not connected".
    await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
    return null;
  }
}

async function writeSaved(next: Saved | null): Promise<void> {
  saved = next;
  if (next) await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  else await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  useListenbrainzStore.getState().set({
    connected: next !== null,
    username: next?.username ?? '',
    enabled: next?.enabled ?? false,
    needsToken: next?.needsToken ?? false,
  });
}

async function refreshPending(): Promise<void> {
  useListenbrainzStore.getState().set({ pending: await queuedCount().catch(() => 0) });
}

/** Called once at start-up (and on foreground). Reads the saved link and sends whatever is waiting. */
export async function loadListenbrainz(): Promise<void> {
  saved = await readSaved();
  useListenbrainzStore.getState().set({
    loaded: true,
    connected: saved !== null,
    username: saved?.username ?? '',
    enabled: saved?.enabled ?? false,
    needsToken: saved?.needsToken ?? false,
  });
  await refreshPending();
  scheduleFlush(0);
}

export type ConnectResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export async function connectListenbrainz(rawToken: string): Promise<ConnectResult> {
  const token = cleanToken(rawToken);
  if (!token) return { ok: false, reason: 'That does not look like a ListenBrainz token. Copy it from your ListenBrainz settings page.' };
  const check = await validateToken(token);
  if (check.kind === 'unreachable') return { ok: false, reason: 'Could not reach ListenBrainz. Check your connection and try again.' };
  if (check.kind === 'invalid') return { ok: false, reason: 'ListenBrainz did not accept that token.' };
  await writeSaved({ token, username: check.username, enabled: true, needsToken: false });
  scheduleFlush(0);
  return { ok: true };
}

export async function setListenbrainzEnabled(enabled: boolean): Promise<void> {
  if (!saved) return;
  await writeSaved({ ...saved, enabled });
  if (enabled) scheduleFlush(0);
}

/** Forgets the token and anything not yet sent. Already-sent listens stay on the listener's ListenBrainz profile. */
export async function disconnectListenbrainz(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  await writeSaved(null);
  await clearQueue().catch(() => undefined);
  await refreshPending();
}

/** A finished listen, as stored in `listen_log`. Queued only when it counts and the copy is on. */
export function queueListenbrainzListen(input: ListenInput): void {
  if (!saved || !saved.enabled || saved.needsToken) return;
  if (!listenQualifies(input)) return;
  enqueueListen({
    listenedAt: Math.floor(input.startedAt / 1000),
    title: input.title.trim(),
    artist: input.artist.trim(),
    album: input.album?.trim() || null,
    durationSec: Math.max(0, input.durationSec),
  })
    .then(refreshPending)
    .then(() => scheduleFlush(FLUSH_DELAY_MS))
    .catch(() => undefined);
}

function scheduleFlush(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flushListenbrainz().catch(() => undefined);
  }, delayMs);
}

/** One pass over the queue. Safe to call at any time; a second call while one runs waits for it. */
export function flushListenbrainz(): Promise<void> {
  if (flushing) return flushing;
  flushing = run().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function run(): Promise<void> {
  const link = saved;
  if (!link || !link.enabled || link.needsToken) return;
  try {
    await dropStaleListens(Date.now());
    const appVersion = Constants.expoConfig?.version ?? '';
    const outcome = await flushQueue({
      now: Date.now,
      dueListens,
      removeListens,
      deferListens,
      submit: (batch) => submitListens(link.token, buildSubmitBody(batch, appVersion)),
    });
    if (outcome.invalidToken) {
      await writeSaved({ ...link, needsToken: true });
    } else if (outcome.nextAttemptAt !== null) {
      scheduleFlush(Math.max(5_000, outcome.nextAttemptAt - Date.now()));
    } else {
      const later = await nextDueAt();
      if (later !== null && later > Date.now()) scheduleFlush(later - Date.now());
    }
  } catch {
    // A database or network surprise must never reach playback. The next listen or foreground tries again.
  } finally {
    await refreshPending();
  }
}

let started = false;
/** Boot hook: loads the link and sends again whenever the app comes back to the foreground. */
export function startListenbrainzSync(): void {
  if (started) return;
  started = true;
  loadListenbrainz().catch(() => undefined);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') scheduleFlush(2_000);
  });
}
