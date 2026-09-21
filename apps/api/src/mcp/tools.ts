import crypto from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { AuthService } from '../auth/auth.js';
import { buildRecommendationInput } from '../services/recommendationContext.js';
import { learn, tasteSummary } from '../routes/user.js';
import { newCode } from '../routes/shared.js';
import type { AppServices } from '../services.js';
import type { UnifiedSong } from '../types.js';
import { SIGNAL_WEIGHT, playWeight } from '../user/taste.js';
import type { LibraryRecord } from '../user/store.js';
import { loadCaller, type McpCaller } from './context.js';
import { summarizeListening } from './stats.js';

const SONG_ID = z.string().min(1).max(200);

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function leanSong(song: UnifiedSong) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    ...(song.album ? { album: song.album } : {}),
    duration: song.duration,
    ...(song.language ? { language: song.language } : {}),
    artwork: song.artwork
  };
}

function librarySummary(library: LibraryRecord) {
  return {
    id: library.id,
    name: library.name,
    ...(library.description ? { description: library.description } : {}),
    isPublic: library.isPublic,
    songIds: library.songIds,
    createdAt: library.createdAt
  };
}

/**
 * The caller's identity comes from the `Authorization` header the router already verified for
 * this HTTP request (see server.ts) — never from a tool argument, per the MCP authorization spec,
 * since a tool argument would put the credential in the model's own context. Each call still
 * re-reads the user fresh rather than trusting a snapshot taken earlier in the request, and must
 * never throw (hard rule 9 — one bad call can't take the MCP connection down).
 */
function withUser<A>(
  auth: AuthService,
  userId: string,
  handler: (args: A, caller: McpCaller) => Promise<CallToolResult>
): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      const caller = await loadCaller(auth, userId);
      if (!caller) return fail('Your Allegra session could not be loaded. Start a new session and try again.');
      return await handler(args, caller);
    } catch {
      return fail('Something went wrong on the Allegra side. Try again shortly.');
    }
  };
}

/**
 * Registers every Allegra tool on a fresh MCP server instance, bound to the one caller the
 * `Authorization` header resolved to for this HTTP request. Called once per stateless request —
 * see server.ts.
 */
export function registerTools(server: McpServer, services: AppServices, userId: string): void {
  const { auth, catalog, lyrics, translation, recommendations } = services;
  const bound = <A>(handler: (args: A, caller: McpCaller) => Promise<CallToolResult>) => withUser(auth, userId, handler);

  server.registerTool(
    'get_taste_profile',
    { description: "The listener's learned taste: top artists and languages, how many signals fed it, and whether onboarding is done.", inputSchema: {} },
    bound(async (_args, caller) => ok(tasteSummary(caller.user.taste)))
  );

  server.registerTool(
    'get_listening_stats',
    { description: 'Recent listening activity: plays and minutes in the last 7 days, distinct songs in the last 30, plus the current top artists/languages.', inputSchema: {} },
    bound(async (_args, caller) => ok(summarizeListening(caller.user)))
  );

  server.registerTool(
    'search_catalog',
    {
      description: 'Search the Allegra music catalog by title, artist, or lyrics fragment.',
      inputSchema: { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(25).optional() }
    },
    bound(async (args) => {
      const { results } = await catalog.search(args.query, args.limit ?? 10, 0);
      return ok(results.map(leanSong));
    })
  );

  server.registerTool(
    'get_lyrics',
    {
      description: 'Fetch lyrics (synced when available) for a song already known to Allegra by its song id.',
      inputSchema: { songId: SONG_ID, syncedOnly: z.boolean().optional() }
    },
    bound(async (args) => {
      const [song] = await catalog.getSongs([args.songId]);
      if (!song) return fail("Couldn't find that song.");
      const payload = await lyrics.find(song.title, song.artist, song.duration, args.syncedOnly ?? false);
      if (!payload) return fail('No lyrics found for this song.');
      return ok(payload);
    })
  );

  server.registerTool(
    'translate_lyrics',
    {
      description: 'Translate a song’s lyrics into another language, preserving meaning and line breaks.',
      inputSchema: { songId: SONG_ID, targetLanguage: z.string().min(1).max(40).optional() }
    },
    bound(async (args) => {
      if (!translation.isAvailable) return fail('Translation is not available right now.');
      const [song] = await catalog.getSongs([args.songId]);
      if (!song) return fail("Couldn't find that song.");
      const payload = await lyrics.find(song.title, song.artist, song.duration, false);
      if (!payload || payload.lines.length === 0) return fail('No lyrics to translate for this song.');
      const result = await translation.translate(payload.lines, song.title, song.artist, args.targetLanguage ?? 'English');
      if (!result) return fail('Could not translate this song right now.');
      return ok(result);
    })
  );

  server.registerTool(
    'get_recommendations',
    { description: "Songs to try next, reasoned from the listener's likes, recent plays, and learned taste.", inputSchema: {} },
    bound(async (_args, caller) => {
      if (!recommendations.isAvailable) return fail('Recommendations are not available right now.');
      const { context, excludeIds, excludeSongs } = await buildRecommendationInput(catalog, caller.user);
      const result = await recommendations.recommend(context, excludeIds, excludeSongs);
      if (!result) return fail('Not enough listening history yet for a recommendation.');
      return ok({ reasoning: result.reasoning, songs: result.songs.map(leanSong) });
    })
  );

  server.registerTool(
    'list_playlists',
    { description: "The listener's playlists (Allegra calls them libraries): name, visibility, and song ids.", inputSchema: {} },
    bound(async (_args, caller) => ok(caller.user.libraries.map(librarySummary)))
  );

  server.registerTool(
    'create_playlist',
    {
      description: 'Create a new, empty playlist in the listener’s library.',
      inputSchema: { name: z.string().min(1).max(100), description: z.string().max(500).optional(), isPublic: z.boolean().optional() }
    },
    bound(async (args, caller) => {
      const library: LibraryRecord = {
        id: crypto.randomUUID(),
        name: args.name.trim(),
        ...(args.description?.trim() ? { description: args.description.trim() } : {}),
        isPublic: args.isPublic === true,
        songIds: [],
        createdAt: new Date().toISOString()
      };
      await auth.update({ ...caller.user, libraries: [...caller.user.libraries, library] });
      return ok(librarySummary(library));
    })
  );

  server.registerTool(
    'add_song_to_playlist',
    {
      description: 'Add a song to one of the listener’s existing playlists.',
      inputSchema: { playlistId: z.string().min(1), songId: SONG_ID }
    },
    bound(async (args, caller) => {
      const index = caller.user.libraries.findIndex((library) => library.id === args.playlistId);
      const library = index >= 0 ? caller.user.libraries[index] : undefined;
      if (!library) return fail("Couldn't find that playlist.");
      const adding = !library.songIds.includes(args.songId);
      const updated: LibraryRecord = { ...library, songIds: adding ? [...library.songIds, args.songId] : library.songIds };
      const libraries = [...caller.user.libraries];
      libraries[index] = updated;
      const taught = adding ? await learn(catalog, caller.user, args.songId, () => SIGNAL_WEIGHT.playlistAdd) : caller.user;
      await auth.update({ ...taught, libraries });
      return ok(librarySummary(updated));
    })
  );

  server.registerTool(
    'share_playlist',
    { description: 'Create (or fetch the existing) share link for one of the listener’s playlists. This makes the playlist public.', inputSchema: { playlistId: z.string().min(1) } },
    bound(async (args, caller) => {
      const library = caller.user.libraries.find((item) => item.id === args.playlistId);
      if (!library) return fail("Couldn't find that playlist.");
      const store = auth.userStore;
      const existing = await store.findShare(caller.userId, library.id);
      const code = existing?.code ?? newCode();
      if (!existing) await store.saveShare({ code, ownerId: caller.userId, libraryId: library.id, createdAt: new Date().toISOString() });
      if (!library.isPublic) {
        await auth.update({ ...caller.user, libraries: caller.user.libraries.map((item) => (item.id === library.id ? { ...item, isPublic: true } : item)) });
      }
      return ok({ code, path: `#shared/${code}` });
    })
  );

  server.registerTool(
    'record_feedback',
    {
      description: 'Record a like, unlike, or skip for a song. Feeds the same taste model as playing the song in the app.',
      inputSchema: { songId: SONG_ID, action: z.enum(['like', 'unlike', 'skip']) }
    },
    bound(async (args, caller) => {
      const { user } = caller;
      if (args.action === 'like') {
        const isNew = !user.likedSongIds.includes(args.songId);
        const taught = isNew ? await learn(catalog, user, args.songId, () => SIGNAL_WEIGHT.like) : user;
        await auth.update({ ...taught, likedSongIds: isNew ? [...user.likedSongIds, args.songId] : user.likedSongIds });
        return ok({ songId: args.songId, action: args.action, liked: true });
      }
      if (args.action === 'unlike') {
        const wasLiked = user.likedSongIds.includes(args.songId);
        const taught = wasLiked ? await learn(catalog, user, args.songId, () => SIGNAL_WEIGHT.unlike) : user;
        await auth.update({ ...taught, likedSongIds: user.likedSongIds.filter((id) => id !== args.songId) });
        return ok({ songId: args.songId, action: args.action, liked: false });
      }
      const taught = await learn(catalog, user, args.songId, () => SIGNAL_WEIGHT.skip);
      if (taught !== user) await auth.update(taught);
      return ok({ songId: args.songId, action: args.action });
    })
  );

  server.registerTool(
    'log_listen',
    {
      description: 'Log how many seconds of a song were actually listened to. Mostly-heard counts as a vote for it; a few seconds counts against it — the same formula the player uses.',
      inputSchema: { songId: SONG_ID, playedSeconds: z.number().min(0).max(3600) }
    },
    bound(async (args, caller) => {
      const taught = await learn(catalog, caller.user, args.songId, (song) => playWeight(args.playedSeconds, song.duration));
      if (taught !== caller.user) await auth.update(taught);
      return ok(tasteSummary(taught.taste));
    })
  );
}
