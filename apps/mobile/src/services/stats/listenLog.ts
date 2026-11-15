/**
 * Feeds Listening stats (1.45.0): every listen the tracker sees end (services/sync/listenTracker `onLeft`), signed in
 * or not, goes into the phone's `listen_log`, unless the listener paused it (Settings `listeningStats`). Nothing here
 * leaves the phone.
 */
import { matchKey } from '@shared/songRef';
import { insertListen, type ListenEntry, type ListenExitKind } from '../../database/listenLogQueries';
import type { HeardSong, ListenEnding } from '../sync/listenTracker';
import { songRefOf } from '../share/shareService';
import { useSettingsStore } from '../../store/settingsStore';
import { listenQualifies } from '../listenbrainz/listenbrainzApi';

/** Shorter than this is a tap-through, not a listen: kept out of the log. */
export const MIN_LOGGED_SECONDS = 1;

/** A finished listen -> its log row, or null when it is too short to keep. */
export function listenEntryFor(song: HeardSong, ending: ListenEnding, startedAtIso: string): ListenEntry | null {
  if (!(ending.heardSeconds >= MIN_LOGGED_SECONDS) || !song.title) return null;
  const startedAt = Date.parse(startedAtIso);
  if (!Number.isFinite(startedAt)) return null;
  return {
    songKey: matchKey(song.title, song.artist),
    songId: song.id,
    ref: songRefOf({ id: song.id, originId: song.originId }),
    title: song.title,
    artist: song.artist ?? '',
    album: song.album ?? null,
    // The catalog's https cover outlives a deleted download's file.
    artwork: song.coverRemoteUri || song.artwork || null,
    durationSec: Math.max(0, song.duration ?? 0),
    startedAt,
    heardSec: Math.round(ending.heardSeconds * 10) / 10,
    exit: ending.exit as ListenExitKind,
  };
}

let onLogged: (() => void) | null = null;
/** The stats page refreshes as listens land while it is open. */
export function setOnListenLogged(listener: (() => void) | null): void {
  onLogged = listener;
}

export function logListen(song: HeardSong, ending: ListenEnding, startedAtIso: string): void {
  // The optional ListenBrainz copy is its own switch, so it does not depend on Listening stats being on.
  copyToListenbrainz(song, ending, startedAtIso);
  if (!useSettingsStore.getState().listeningStats) return;
  const entry = listenEntryFor(song, ending, startedAtIso);
  if (!entry) return;
  insertListen(entry).then(() => onLogged?.()).catch(() => undefined);
}

/**
 * Queues a finished listen for the optional ListenBrainz copy. The sync module (keystore, app state) loads on first use,
 * and only for a listen that counts, so listeners who never connect pay nothing.
 */
function copyToListenbrainz(song: HeardSong, ending: ListenEnding, startedAtIso: string): void {
  const startedAt = Date.parse(startedAtIso);
  if (!Number.isFinite(startedAt) || !song.title) return;
  const input = {
    title: song.title,
    artist: song.artist ?? '',
    album: song.album ?? null,
    durationSec: Math.max(0, song.duration ?? 0),
    startedAt,
    heardSec: ending.heardSeconds,
  };
  if (!listenQualifies(input)) return;
  import('../listenbrainz/listenbrainzSync').then(m => m.queueListenbrainzListen(input)).catch(() => undefined);
}
