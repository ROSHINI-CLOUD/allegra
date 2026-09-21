import type { CatalogService } from '../catalog/catalog.js';
import type { UnifiedSong } from '../types.js';
import type { UserData } from '../user/store.js';
import type { TasteContext } from './recommendations.js';

export interface RecommendationInput {
  readonly context: TasteContext;
  readonly excludeIds: ReadonlySet<string>;
  readonly excludeSongs: UnifiedSong[];
}

/**
 * Turns a stored user (likes, recent plays, learned taste) into what `RecommendationService.recommend`
 * needs. Shared by the HTTP route and the MCP tool so the two surfaces can never drift apart.
 */
export async function buildRecommendationInput(catalog: CatalogService, user: UserData, currentId?: string | null): Promise<RecommendationInput> {
  const recentIds = [...user.recentlyPlayed].sort((left, right) => right.playedAt.localeCompare(left.playedAt)).map((entry) => entry.songId).slice(0, 20);
  const likedIds = user.likedSongIds.slice(0, 20);
  const allIds = [...new Set([...likedIds, ...recentIds, ...(currentId ? [currentId] : [])])];
  const songs = allIds.length > 0 ? await catalog.getSongs(allIds) : [];
  const byId = new Map(songs.map((song) => [song.id, song]));
  const describe = (id: string) => {
    const song = byId.get(id);
    return song ? { title: song.title, artist: song.artist } : null;
  };

  const context: TasteContext = {
    likedSongs: likedIds.map(describe).filter((song): song is { title: string; artist: string } => song !== null),
    recentSongs: recentIds.map(describe).filter((song): song is { title: string; artist: string } => song !== null),
    ...(currentId && byId.has(currentId) ? { currentSong: describe(currentId)! } : {}),
    ...(user.taste && user.taste.artists.length > 0 ? { favoriteArtists: user.taste.artists.map((entry) => entry.name) } : {}),
    ...(user.taste && user.taste.languages.length > 0 ? { favoriteLanguages: user.taste.languages.map((entry) => entry.name) } : {})
  };

  return { context, excludeIds: new Set([...likedIds, ...recentIds]), excludeSongs: songs };
}
