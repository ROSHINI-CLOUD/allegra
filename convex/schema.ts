import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const library = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  isPublic: v.boolean(),
  songIds: v.array(v.string()),
  createdAt: v.string(),
  /** Convex storage id of a custom playlist cover (owned by this playlist). */
  coverKey: v.optional(v.string()),
  /** Served URL for the cover. Kept alongside the id: Convex URLs cannot be derived from it. */
  coverUrl: v.optional(v.string())
});

const recent = v.object({
  songId: v.string(),
  playDuration: v.number(),
  playedAt: v.string()
});

const tasteEntry = v.object({ name: v.string(), score: v.number() });

/** What we have learned about a listener. Arrays, not records: Convex field names must be ASCII, artist names are not. */
const taste = v.object({
  artists: v.array(tasteEntry),
  languages: v.array(tasteEntry),
  signals: v.number(),
  onboarded: v.boolean(),
  updatedAt: v.string()
});

/** How much one song has been listened to (apps/api/src/user/plays.ts). Capped at 200 per listener. */
export const playStat = v.object({
  songId: v.string(),
  plays: v.number(),
  seconds: v.number(),
  recent: v.number(),
  lastPlayedAt: v.string()
});

/** A catalog row as stored inside a song relation: enough to rank and show it without a lookup. */
export const relatedSong = v.object({
  id: v.string(),
  title: v.string(),
  artist: v.string(),
  album: v.optional(v.string()),
  artwork: v.string(),
  duration: v.number(),
  hasLyrics: v.boolean(),
  language: v.optional(v.string()),
  playCount: v.number(),
  source: v.union(v.literal('Saavn'), v.literal('Gaana'))
});

export default defineSchema({
  // Convex Auth owns `users`, `authAccounts`, `authSessions` and friends. It is the
  // identity record (who signed in with Google); `profiles` below is what they listen to.
  ...authTables,

  /**
   * One row per listener, keyed by `userId`.
   *
   * For a signed-in listener that is their Convex Auth user id, so the identity and
   * the library stay joined without duplicating either. For a guest it is a random
   * id held only by that browser.
   */
  profiles: defineTable({
    userId: v.string(),
    isGuest: v.boolean(),
    createdAt: v.string(),
    libraries: v.array(library),
    likedSongIds: v.array(v.string()),
    recentlyPlayed: v.array(recent),
    settings: v.any(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    taste: v.optional(taste),
    playStats: v.optional(v.array(playStat))
  })
    .index('by_userId', ['userId'])
    .index('by_email', ['email']),

  /**
   * "Listeners of this song go on to play…" — YouTube Music's song radio and the catalog's own
   * suggestions, merged and matched to catalog rows. Not per listener: a song's neighbours are
   * the same for everyone, so each is worked out once and shared (Echo's related_song_map).
   * Derived data: losing a row only costs a recompute.
   */
  songRelations: defineTable({
    songId: v.string(),
    songs: v.array(relatedSong),
    updatedAt: v.string()
  }).index('by_songId', ['songId']),

  /** A playlist someone chose to share. Live: it points at the owner's playlist, so edits show up for everyone with the link. */
  shares: defineTable({
    code: v.string(),
    ownerId: v.string(),
    libraryId: v.string(),
    createdAt: v.string()
  })
    .index('by_code', ['code'])
    .index('by_owner_library', ['ownerId', 'libraryId']),

  /** Spent OAuth codes and refresh tokens (MCP connect), kept only until they expire. */
  oauthGrants: defineTable({
    jti: v.string(),
    expiresAt: v.number()
  })
    .index('by_jti', ['jti'])
    .index('by_expiresAt', ['expiresAt'])
});
