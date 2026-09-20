import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const library = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  isPublic: v.boolean(),
  songIds: v.array(v.string()),
  createdAt: v.string()
});

const recent = v.object({
  songId: v.string(),
  playDuration: v.number(),
  playedAt: v.string()
});

export default defineSchema({
  users: defineTable({
    userId: v.string(),
    isGuest: v.boolean(),
    createdAt: v.string(),
    libraries: v.array(library),
    likedSongIds: v.array(v.string()),
    recentlyPlayed: v.array(recent),
    settings: v.any()
  }).index('by_userId', ['userId'])
});
