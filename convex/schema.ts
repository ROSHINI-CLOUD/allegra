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
  /** S3 object key for a custom playlist cover. ASCII path only. */
  coverKey: v.optional(v.string())
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
    taste: v.optional(taste)
  })
    .index('by_userId', ['userId'])
    .index('by_email', ['email']),

  /** A playlist someone chose to share. Live: it points at the owner's playlist, so edits show up for everyone with the link. */
  shares: defineTable({
    code: v.string(),
    ownerId: v.string(),
    libraryId: v.string(),
    createdAt: v.string()
  })
    .index('by_code', ['code'])
    .index('by_owner_library', ['ownerId', 'libraryId'])
});
