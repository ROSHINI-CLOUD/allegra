import type { UnifiedSong } from '@shared/types';

/** Collect tracks that share an album identity with the seed song. */
export function collectAlbumTracks(seed: UnifiedSong, pools: readonly (readonly UnifiedSong[])[]): UnifiedSong[] {
  const albumName = seed.album?.trim();
  if (!albumName) return [seed];

  const identity = `${albumName.toLocaleLowerCase()}|${seed.artist.replace(/\s+/g, ' ').trim().toLocaleLowerCase()}`;
  const seen = new Set<string>();
  const tracks: UnifiedSong[] = [];

  for (const pool of pools) {
    for (const song of pool) {
      if (!song.album?.trim()) continue;
      const key = `${song.album.trim().toLocaleLowerCase()}|${song.artist.replace(/\s+/g, ' ').trim().toLocaleLowerCase()}`;
      if (key !== identity || seen.has(song.id)) continue;
      seen.add(song.id);
      tracks.push(song);
    }
  }

  if (!seen.has(seed.id)) tracks.unshift(seed);
  return tracks.length > 0 ? tracks : [seed];
}

export function formatAlbumDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 min';
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours} hr` : `${hours} hr ${rem} min`;
}
