/**
 * Songs that are in the library but only online (liked or added on another device).
 * They show in Liked songs and playlists like any other song and play by streaming:
 * the catalog is asked for the song (by its exact id, else by the same title and lead
 * artist) when it is played, a few at a time, and remembered.
 */
import { matchKey, parseSongRef, songRef, toMobileId, type SongRef } from '@shared/songRef';

import type { OnlineSongRow } from '../../database/syncQueries';
import { removeOnlinePlaylistSong } from '../../database/syncQueries';
import { searchMusic } from '../MultiSourceSearchService';
import { StreamService } from '../stream/StreamService';
import { toStreamSong } from '../stream/streamSong';
import { prepareNextInQueue, usePlayerStore } from '../../store/playerStore';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import type { Song, UnifiedSong } from '../../types/song';
import { record } from './LibrarySync';
import { playlistItemOp } from './plan';

/** Played straight away; the rest of the list resolves behind it. */
const FIRST_WINDOW = 12;
const PARALLEL = 4;

const resolved = new Map<string, UnifiedSong>();
const failed = new Set<string>();

export const isOnlineSong = (song: { id: string; audioUri?: string }): boolean => song.id.startsWith('stream:') && !song.audioUri;

/** An online row as the lists show it: a stream song whose audio is found when it plays. */
export function onlineRowToSong(row: OnlineSongRow): Song {
  const ref = row.ref as SongRef;
  const cached = resolved.get(ref);
  return {
    ...(cached ? toStreamSong(cached) : {}),
    id: toMobileId(ref),
    title: row.title,
    artist: row.artist,
    album: row.album,
    gradientId: 'dynamic',
    duration: row.duration,
    dateCreated: new Date(row.at).toISOString(),
    dateModified: new Date(row.at).toISOString(),
    playCount: 0,
    lyrics: [],
    coverImageUri: row.artwork || cached?.highResArt || undefined,
    audioUri: cached ? toStreamSong(cached).audioUri : undefined,
  };
}

async function resolveOne(song: Song): Promise<UnifiedSong | null> {
  const ref = song.id.startsWith('stream:') ? (song.id.slice('stream:'.length) as SongRef) : null;
  if (!ref || !parseSongRef(ref)) return null;
  const hit = resolved.get(ref);
  if (hit) return hit;
  if (failed.has(ref)) return null;
  try {
    const key = matchKey(song.title, song.artist);
    const hits = await searchMusic(`${song.title} ${song.artist ?? ''}`.trim(), song.artist || undefined);
    const exact = hits.find(candidate => songRef(candidate.source, candidate.id) === ref);
    const same = exact ?? hits.find(candidate => matchKey(candidate.title, candidate.artist) === key);
    if (same && (same.streamUrl || same.downloadUrl)) {
      resolved.set(ref, same);
      return same;
    }
  } catch {
    // Offline: try again next time it is played.
    return null;
  }
  failed.add(ref);
  return null;
}

/** Resolves songs a few at a time, keeping their order. Songs that cannot be found are left out. */
async function resolveAll(songs: readonly Song[]): Promise<Song[]> {
  const out: (Song | null)[] = new Array(songs.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < songs.length) {
      const i = next++;
      const song = songs[i];
      if (!isOnlineSong(song)) {
        out[i] = song;
        continue;
      }
      const hit = await resolveOne(song);
      if (hit) {
        StreamService.register([hit]);
        out[i] = { ...song, ...toStreamSong(hit), id: song.id, title: song.title, artist: song.artist, coverImageUri: song.coverImageUri ?? toStreamSong(hit).coverImageUri };
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return out.filter((song): song is Song => song !== null);
}

/**
 * Plays a list that may hold online songs, starting at `index`. Downloaded-only lists
 * go straight to the queue as before. Resolves to false when nothing could be played.
 */
export async function playList(playlistId: string, songs: readonly Song[], index: number): Promise<boolean> {
  const player = usePlayerStore.getState();
  if (!songs.some(isOnlineSong)) {
    player.setPlaylistQueue(playlistId, [...songs], index);
    return true;
  }
  const from = songs.slice(Math.max(0, index));
  const first = await resolveAll(from.slice(0, FIRST_WINDOW));
  if (first.length === 0) return false;
  usePlayerStore.getState().setPlaylistQueue(playlistId, first, 0);

  const rest = from.slice(FIRST_WINDOW);
  if (rest.length > 0) {
    resolveAll(rest)
      .then(more => {
        const state = usePlayerStore.getState();
        if (more.length === 0 || state.currentPlaylistId !== playlistId || !state.playlistQueue) return;
        state.updateQueue([...state.playlistQueue, ...more.filter(song => !state.playlistQueue?.some(queued => queued.id === song.id))]);
        prepareNextInQueue();
      })
      .catch(() => undefined);
  }
  return true;
}

/** Removes an online song from a playlist here and on the account. */
export async function removeOnlineFromPlaylist(playlistId: string, songId: string): Promise<void> {
  const ref = songId.slice('stream:'.length);
  if (!parseSongRef(ref)) return;
  const at = Date.now();
  await removeOnlinePlaylistSong(playlistId, ref);
  record(playlistItemOp(playlistId, ref as SongRef, false, at));
  useOnlineLibraryStore.getState().bumpPlaylists();
}
