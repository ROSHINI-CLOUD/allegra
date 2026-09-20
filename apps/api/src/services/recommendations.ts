import type { AiClient } from '../ai/aiClient.js';
import { extractJson } from '../ai/json.js';
import { songIdentity } from '../lib/normalize.js';
import type { UnifiedSong } from '../types.js';

/** The one CatalogService call this needs — narrow on purpose so tests can fake it. */
export interface SongSearcher {
  search(query: string, limit: number, page: number): Promise<{ results: UnifiedSong[] }>;
}

export interface TasteContext {
  readonly likedSongs: ReadonlyArray<{ title: string; artist: string }>;
  readonly recentSongs: ReadonlyArray<{ title: string; artist: string }>;
  readonly currentSong?: { title: string; artist: string };
  /** Learned over time, strongest first. Tells the model who this listener actually loves, not just what they last played. */
  readonly favoriteArtists?: readonly string[];
  readonly favoriteLanguages?: readonly string[];
}

export interface RecommendationResult {
  readonly songs: UnifiedSong[];
  readonly provider: string;
  readonly reasoning: string;
}

const SYSTEM_PROMPT = `You are a music taste analyst for a streaming app. Given a listener's liked and recently played songs, infer their taste (genres, languages, moods, era, artists) and produce search queries that would surface songs they'd likely enjoy next — favor discovery over repeating what they already have. Respond with ONLY JSON: {"queries": string[3..5], "reasoning": "one short sentence"}. No markdown fences, no commentary.`;

export class RecommendationService {
  public constructor(
    private readonly ai: AiClient,
    private readonly catalog: SongSearcher
  ) {}

  public get isAvailable(): boolean {
    return this.ai.isConfigured;
  }

  /**
   * `excludeSongs` are the listener's liked and recently played songs. They are
   * wanted in full, not just as ids, because the catalog hands the same recording
   * back under a different release id — so excluding by id alone happily
   * recommends a song that is already sitting in the listener's likes.
   */
  public async recommend(
    context: TasteContext,
    excludeIds: ReadonlySet<string>,
    excludeSongs: readonly UnifiedSong[] = [],
    limit = 12
  ): Promise<RecommendationResult | null> {
    if (!this.ai.isConfigured) return null;
    if (context.likedSongs.length === 0 && context.recentSongs.length === 0 && !context.currentSong && !(context.favoriteArtists?.length)) return null;

    const prompt = describeTaste(context);
    // Gemini 2.5 spends part of maxOutputTokens on hidden "thoughts", so 400
    // routinely truncates the JSON mid-object and the whole recommend path returns null.
    const result = await this.ai.complete(prompt, { system: SYSTEM_PROMPT, maxTokens: 2048, temperature: 0.8 });
    if (!result) return null;

    const parsed = extractJson<{ queries?: unknown; reasoning?: unknown }>(result.text);
    const queries = toQueries(parsed?.queries);
    if (queries.length === 0) return null;

    const seen = new Set(excludeIds);
    // Overlapping queries ("Arijit Singh top hits" and "Hindi romantic") return
    // the same recording under different release ids, so id alone is not enough
    // to keep a song off the shelf twice — or to keep one the listener already
    // has off it at all.
    const identities = new Set(excludeSongs.map(songIdentity));
    const songs: UnifiedSong[] = [];
    for (const query of queries) {
      if (songs.length >= limit) break;
      try {
        const { results } = await this.catalog.search(query, 6, 0);
        for (const song of results) {
          if (songs.length >= limit) break;
          if (seen.has(song.id)) continue;
          const identity = songIdentity(song);
          if (identities.has(identity)) continue;
          seen.add(song.id);
          identities.add(identity);
          songs.push(song);
        }
      } catch {
        // one bad query shouldn't sink the whole recommendation
      }
    }
    if (songs.length === 0) return null;

    const reasoning = typeof parsed?.reasoning === 'string' ? parsed.reasoning.trim() : '';
    return { songs, provider: result.provider, reasoning: reasoning || 'Based on what you’ve been listening to.' };
  }
}

/**
 * The prompt asks for `{"queries": string[]}` but the model is not bound by it.
 * Some providers (NVIDIA's Llama in particular) reliably answer with the queries
 * as one comma-separated *string*, which is perfectly usable — it just is not an
 * array. Reading only the array shape threw away every one of those answers, and
 * calling .filter on a non-array threw outright, so accept both and take nothing
 * else. Returns at most five non-empty queries.
 */
function toQueries(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\s*[,\n]\s*/u)
      : [];
  return parts
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 5);
}

function describeTaste(context: TasteContext): string {
  const lines: string[] = [];
  if (context.favoriteArtists && context.favoriteArtists.length > 0) lines.push(`Favourite artists, strongest first: ${context.favoriteArtists.slice(0, 12).join(', ')}`);
  if (context.favoriteLanguages && context.favoriteLanguages.length > 0) lines.push(`Favourite languages: ${context.favoriteLanguages.slice(0, 4).join(', ')}`);
  if (context.currentSong) lines.push(`Currently playing: "${context.currentSong.title}" by ${context.currentSong.artist}`);
  if (context.likedSongs.length > 0) {
    lines.push(`Liked songs:\n${context.likedSongs.slice(0, 20).map((song) => `- "${song.title}" by ${song.artist}`).join('\n')}`);
  }
  if (context.recentSongs.length > 0) {
    lines.push(`Recently played:\n${context.recentSongs.slice(0, 20).map((song) => `- "${song.title}" by ${song.artist}`).join('\n')}`);
  }
  return lines.join('\n\n');
}
