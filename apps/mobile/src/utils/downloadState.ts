/**
 * Where a catalog song stands with downloads, for the button beside it:
 * not saved, waiting its turn, downloading (with progress), on the phone, or
 * failed. A song counts as on the phone when the download queue finished it
 * or the library already holds the same title by the same lead artist — so a
 * song saved last week still shows its tick when it turns up in a suggestion.
 */
import { matchKey } from '@shared/songRef';

// The key lives in packages/shared so Allegra web and Connect match songs exactly as the phone does.
export { matchKey };

export type DownloadPhase = 'idle' | 'queued' | 'paused' | 'downloading' | 'saved' | 'failed';

export interface DownloadState {
  phase: DownloadPhase;
  /** 0..1, only meaningful while downloading. */
  progress: number;
}

type QueueStatus = 'pending' | 'staging' | 'downloading' | 'completed' | 'failed' | 'paused';

const keyCache = new WeakMap<object, Set<string>>();

/** Keys of every song on the phone. Cached per songs array, so it is cheap to ask often. */
export const libraryKeys = (songs: readonly { title: string; artist?: string; audioUri?: string }[]): Set<string> => {
  const cached = keyCache.get(songs);
  if (cached) return cached;
  const keys = new Set<string>();
  for (const s of songs) if (s.audioUri) keys.add(matchKey(s.title, s.artist));
  keyCache.set(songs, keys);
  return keys;
};

export const downloadStateOf = (
  item: { status: QueueStatus; progress: number } | undefined,
  inLibrary: boolean,
): DownloadState => {
  const progress = Math.max(0, Math.min(1, item?.progress ?? 0));
  switch (item?.status) {
    case 'pending':
    case 'staging':
      return { phase: 'queued', progress: 0 };
    case 'downloading':
      return { phase: 'downloading', progress };
    case 'paused':
      return { phase: 'paused', progress };
    case 'completed':
      return { phase: 'saved', progress: 1 };
    case 'failed':
      return inLibrary ? { phase: 'saved', progress: 1 } : { phase: 'failed', progress: 0 };
    default:
      return inLibrary ? { phase: 'saved', progress: 1 } : { phase: 'idle', progress: 0 };
  }
};

const lookupCache = new WeakMap<object, Map<string, { id: string }>>();

/** The library song for each key, for finding the row a catalog song already has. Cached per songs array. */
export const libraryLookup = <T extends { id: string; title: string; artist?: string; audioUri?: string }>(songs: readonly T[]): Map<string, T> => {
  const cached = lookupCache.get(songs);
  if (cached) return cached as Map<string, T>;
  const map = new Map<string, T>();
  for (const s of songs) if (s.audioUri) map.set(matchKey(s.title, s.artist), s);
  lookupCache.set(songs, map);
  return map;
};
