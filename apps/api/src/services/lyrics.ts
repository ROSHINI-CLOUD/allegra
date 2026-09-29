import { cacheKey, type CacheStore } from '../lib/cache.js';
import { LATE, withinBudget } from '../lib/deadline.js';
import { hasTimestamps, parseLyrics } from '../lib/lrc.js';
import { scoreLyrics } from '../lib/matcher.js';
import type { BetterLyricsProvider } from '../providers/betterlyrics.js';
import type { KuGouProvider } from '../providers/kugou.js';
import type { LrclibEntry, LrclibProvider } from '../providers/lrclib.js';
import type { LyricaProvider } from '../providers/lyrica.js';
import type { LyricsCandidate } from '../providers/lyricsCandidate.js';
import type { UnisonProvider } from '../providers/unison.js';
import type { YouLyPlusProvider } from '../providers/youlyplus.js';
import type { LyricsPayload } from '../types.js';

const HIT_TTL_SECONDS = 2_592_000;
const MISS_TTL_SECONDS = 86_400;
const ALTERNATIVES_TTL_SECONDS = 86_400;
const MAX_ALTERNATIVES = 6;
/**
 * How long a listener waits for an answer. A song with no lyrics walks every tier in turn, which
 * can take minutes; the web client gives up at 15 s and would report a dead connection instead of
 * "no lyrics". Past this, the lookup keeps running and caches its result for the next ask.
 */
const LOOKUP_BUDGET_MS = 11_000;

/** The optional sources behind LRCLIB. Each is asked only if configured, and none ever throws. */
export interface LyricsSources {
  readonly lyrica?: LyricaProvider;
  readonly betterLyrics?: BetterLyricsProvider;
  readonly youLyPlus?: YouLyPlusProvider;
  readonly unison?: UnisonProvider;
  readonly kugou?: KuGouProvider;
  /** Overrides LOOKUP_BUDGET_MS (tests). */
  readonly budgetMs?: number;
}

export class LyricsService {
  /** Lookups still running, by cache key, so a retry joins the one in flight instead of starting over. */
  private readonly inflight = new Map<string, Promise<LyricsPayload | null>>();

  private readonly lyrica: LyricaProvider | undefined;
  private readonly betterLyrics: BetterLyricsProvider | undefined;
  private readonly youLyPlus: YouLyPlusProvider | undefined;
  private readonly unison: UnisonProvider | undefined;
  private readonly kugou: KuGouProvider | undefined;
  private readonly budgetMs: number;

  public constructor(
    private readonly lrclib: LrclibProvider,
    private readonly cache: CacheStore,
    sources: LyricsSources = {}
  ) {
    this.lyrica = sources.lyrica;
    this.betterLyrics = sources.betterLyrics;
    this.youLyPlus = sources.youLyPlus;
    this.unison = sources.unison;
    this.kugou = sources.kugou;
    this.budgetMs = sources.budgetMs ?? LOOKUP_BUDGET_MS;
  }

  /**
   * The best lyrics for a song, or null: none found, or none found within the budget (the lookup
   * then finishes in the background, so asking again shortly gets its answer from the cache).
   */
  public async find(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsPayload | null> {
    const cleaned = cleanLyricsQuery(title, artist);
    const key = cacheKey('lyrics', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    let lookup = this.inflight.get(key);
    if (!lookup) {
      lookup = this.cascade(title, artist, duration, syncedOnly).finally(() => this.inflight.delete(key));
      this.inflight.set(key, lookup);
    }
    const value = await withinBudget(lookup, this.budgetMs);
    return value === LATE ? null : value;
  }

  /**
   * Cascade: LRCLIB (exact, then search, across title/artist variants) -> Lyrica and
   * BetterLyrics together -> a miss. Each tier is optional and never throws.
   */
  private async cascade(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsPayload | null> {
    const cleaned = cleanLyricsQuery(title, artist);
    const lead = leadArtist(cleaned.artist);
    const key = cacheKey('lyrics', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    const missKey = cacheKey('lyrics', 'miss', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    if (await this.cache.get<boolean>(missKey)) {
      return null;
    }
    const cached = await this.cache.get<LyricsPayload>(key);
    if (cached) {
      return cached;
    }

    // 1. LRCLIB. The first attempt is the song exactly as the catalog names it; later ones are
    //    looser (lead artist, each co-artist, title without a "- New Version" suffix) and must
    //    still resemble the requested title so a loose search never returns a different song.
    const attempts = lrclibAttempts(cleaned.title, cleaned.artist);
    for (const [index, attempt] of attempts.entries()) {
      const payload = await this.fromLrclib(attempt.title, attempt.artist, cleaned.title, duration, syncedOnly, index > 0);
      if (payload) {
        await this.cache.set(key, payload, HIT_TTL_SECONDS);
        return payload;
      }
    }
    if (lead) {
      const loose = (await this.lrclib.searchText(`${cleaned.title} ${lead}`)).filter((entry) => isUsable(entry, syncedOnly) && titlesAlike(entry.trackName, cleaned.title));
      const best = loose.sort((left, right) => scoreLyrics(right, cleaned.title, duration).score - scoreLyrics(left, cleaned.title, duration).score)[0];
      if (best) {
        const payload = toPayload(best, cleaned.title, duration, 'LRCLIB-search');
        await this.cache.set(key, payload, HIT_TTL_SECONDS);
        return payload;
      }
    }

    // 2. The optional aggregators, asked together so a slow one does not delay the others.
    const aggregated = await this.fromAggregators(cleaned.title, cleaned.artist, lead, duration, syncedOnly);
    const found = aggregated
      .map((candidate) => candidatePayload(candidate, cleaned.title, duration))
      .filter((payload) => !syncedOnly || payload.type === 'synced')
      // Synced beats plain; on a tie the earlier source in fromAggregators' order wins.
      .sort((left, right) => Number(right.type === 'synced') - Number(left.type === 'synced'))[0];
    if (found) {
      await this.cache.set(key, found, HIT_TTL_SECONDS);
      return found;
    }

    await this.cache.set(missKey, true, MISS_TTL_SECONDS);
    return null;
  }

  private async fromLrclib(
    title: string,
    artist: string,
    requestedTitle: string,
    duration: number | undefined,
    syncedOnly: boolean,
    requireSimilarTitle: boolean
  ): Promise<LyricsPayload | null> {
    const precise = await this.lrclib.get(title, artist, duration);
    const fromGet = precise && isUsable(precise, syncedOnly) ? precise : null;
    const candidates = fromGet
      ? [fromGet]
      : (await this.lrclib.search(title, artist, duration)).filter((candidate) => isUsable(candidate, syncedOnly) && (!requireSimilarTitle || titlesAlike(candidate.trackName, requestedTitle)));
    const best = candidates.sort((left, right) => scoreLyrics(right, requestedTitle, duration).score - scoreLyrics(left, requestedTitle, duration).score)[0];
    return best ? toPayload(best, requestedTitle, duration, fromGet === best ? 'LRCLIB' : 'LRCLIB-search') : null;
  }

  /**
   * One answer from each aggregator, in preference order: Better Lyrics and LyricsPlus (word-timed,
   * often Apple), Unison (community-ranked), Lyrica, then KuGou, whose keyword search is the likeliest
   * to land on another recording.
   */
  private async fromAggregators(
    title: string,
    artist: string,
    lead: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsCandidate[]> {
    const artistForSearch = lead || artist;
    const found = await Promise.all([
      this.betterLyrics ? this.betterLyrics.find(title, artistForSearch, duration) : Promise.resolve(null),
      this.youLyPlus ? this.youLyPlus.find(title, artistForSearch, duration) : Promise.resolve(null),
      this.unison ? this.unison.find(title, artistForSearch, duration) : Promise.resolve(null),
      this.findLyrica(title, artist, lead, duration, syncedOnly),
      this.kugou ? this.kugou.find(title, artistForSearch, duration) : Promise.resolve(null)
    ]);
    return found.filter((candidate): candidate is LyricsCandidate => candidate !== null);
  }

  private async findLyrica(
    title: string,
    artist: string,
    lead: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<{ readonly lyrics: string; readonly source: string } | null> {
    if (!this.lyrica) {
      return null;
    }
    const first = await this.lyrica.find(title, lead || artist, duration, syncedOnly);
    if (first || !lead || lead === artist) {
      return first;
    }
    return this.lyrica.find(title, artist, duration, syncedOnly);
  }

  /**
   * Every distinct usable rendering the providers have, for the "Other lyrics" picker. Unlike
   * find() it asks every tier at once instead of stopping at the first hit, so it runs only when a
   * listener asks. An empty list is an answer (nothing else matched), not a failure.
   */
  public async alternatives(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsPayload[]> {
    const cleaned = cleanLyricsQuery(title, artist);
    const lead = leadArtist(cleaned.artist);
    const key = cacheKey('lyrics-alternatives', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    const cached = await this.cache.get<LyricsPayload[]>(key);
    if (cached) {
      return cached;
    }

    const attempts = lrclibAttempts(cleaned.title, cleaned.artist);
    // Every tier gets the same budget; whatever has answered by then is the list. A tier still
    // running is left to finish on its own, and the list is not cached, so a later ask sees it.
    const artistForSearch = lead || cleaned.artist;
    const single = (lookup: Promise<LyricsCandidate | null>): Promise<LyricsCandidate[]> => lookup.then((candidate) => (candidate ? [candidate] : []));
    const [lrclibSettled, looseSettled, ...aggregatorSettled] = await Promise.all([
      withinBudget(Promise.all(attempts.map((attempt) => this.lrclib.search(attempt.title, attempt.artist, duration))), this.budgetMs),
      withinBudget(lead ? this.lrclib.searchText(`${cleaned.title} ${lead}`) : Promise.resolve([]), this.budgetMs),
      // Same preference order as fromAggregators; Unison and KuGou can offer several versions each.
      withinBudget(this.betterLyrics ? single(this.betterLyrics.find(cleaned.title, artistForSearch, duration)) : Promise.resolve([]), this.budgetMs),
      withinBudget(this.youLyPlus ? single(this.youLyPlus.find(cleaned.title, artistForSearch, duration)) : Promise.resolve([]), this.budgetMs),
      withinBudget(this.unison ? this.unison.search(cleaned.title, artistForSearch, duration) : Promise.resolve([]), this.budgetMs),
      withinBudget(single(this.findLyrica(cleaned.title, cleaned.artist, lead, duration, syncedOnly)), this.budgetMs),
      withinBudget(this.kugou ? this.kugou.findAll(cleaned.title, artistForSearch, duration) : Promise.resolve([]), this.budgetMs)
    ]);
    const complete = lrclibSettled !== LATE && looseSettled !== LATE && aggregatorSettled.every((value) => value !== LATE);
    const searches = lrclibSettled === LATE ? [] : lrclibSettled;
    const loose = looseSettled === LATE ? [] : looseSettled;
    const aggregated = aggregatorSettled.flatMap((value) => (value === LATE ? [] : value));

    const fromLrclib = [...searches.flat(), ...loose]
      .filter((entry) => isUsable(entry, syncedOnly) && titlesAlike(entry.trackName, cleaned.title))
      .sort((left, right) => scoreLyrics(right, cleaned.title, duration).score - scoreLyrics(left, cleaned.title, duration).score)
      .map((entry) => {
        const payload = toPayload(entry, cleaned.title, duration, 'LRCLIB');
        // Several LRCLIB entries share a source name; the recording they were filed under tells them apart.
        const filedAs = [entry.artistName, entry.trackName].filter(Boolean).join(' — ');
        return filedAs ? { ...payload, matchReason: `${filedAs} • ${payload.matchReason}` } : payload;
      });
    const fromAggregators = aggregated
      .map((candidate) => candidatePayload(candidate, cleaned.title, duration))
      .filter((payload) => !syncedOnly || payload.type === 'synced');

    const seen = new Set<string>();
    const versions = [...fromAggregators, ...fromLrclib]
      .filter((payload) => {
        const fingerprint = lyricsFingerprint(payload);
        if (!fingerprint || seen.has(fingerprint)) {
          return false;
        }
        seen.add(fingerprint);
        return true;
      })
      // Stable: synced first, each group keeping its provider and score order.
      .sort((left, right) => Number(right.type === 'synced') - Number(left.type === 'synced'))
      .slice(0, MAX_ALTERNATIVES);

    if (complete) {
      await this.cache.set(key, versions, versions.length > 0 ? ALTERNATIVES_TTL_SECONDS : MISS_TTL_SECONDS / 4);
    }
    return versions;
  }

  public async search(title: string, artist: string, duration?: number): Promise<Array<{
    readonly title: string;
    readonly artist: string;
    readonly duration?: number;
    readonly type: 'synced' | 'plain';
    readonly matchScore: number;
    readonly matchReason: string;
  }>> {
    const cleaned = cleanLyricsQuery(title, artist);
    const entries = await this.lrclib.search(cleaned.title, cleaned.artist, duration);
    return entries
      .filter((entry) => isUsable(entry, false))
      .map((entry) => {
        const score = scoreLyrics(entry, cleaned.title, duration);
        return {
          title: entry.trackName ?? cleaned.title,
          artist: entry.artistName ?? cleaned.artist,
          ...(entry.duration !== undefined ? { duration: entry.duration } : {}),
          type: entry.syncedLyrics?.trim() ? 'synced' as const : 'plain' as const,
          matchScore: score.score,
          matchReason: score.reason
        };
      })
      .sort((left, right) => right.matchScore - left.matchScore);
  }
}

export function cleanLyricsQuery(title: string, artist: string): { title: string; artist: string } {
  let cleanSong = title
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\(Official.*?\)/gi, '')
    .replace(/\(MP3_\d+K\)/gi, '')
    .replace(/\(Audio\)/gi, '')
    // Catalog decorations that no lyrics database has in a track name: (From "Jawan"),
    // (Original Motion Picture Soundtrack), (Telugu), [Remastered] ...
    .replace(/\((?:from|original|remaster|feat|ft)\b[^)]*\)/gi, '')
    .replace(/\((?:hindi|telugu|tamil|kannada|malayalam|punjabi|bengali|marathi|english)\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+-\s+(?:from|original|remaster)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  let cleanArtist = artist === 'Unknown Artist' ? '' : artist.trim();

  if (!cleanArtist && cleanSong.includes(' - ')) {
    const parts = cleanSong.split(' - ');
    cleanArtist = (parts[0] ?? '').trim();
    cleanSong = parts.slice(1).join(' - ').trim();
  }

  return {
    title: cleanSong || title.trim(),
    artist: cleanArtist || artist.trim()
  };
}

/** The first credited artist of "A, B & C feat. D". */
export function leadArtist(artist: string): string {
  return (artist.split(/,|&| feat\.? | ft\.? | x /i)[0] ?? artist).trim();
}

/** Ordered, de-duplicated (title, artist) pairs to try against LRCLIB, exact pair first. */
function lrclibAttempts(title: string, artist: string): Array<{ readonly title: string; readonly artist: string }> {
  const lead = leadArtist(artist);
  const shortTitle = (title.split(/\s+-\s+/)[0] ?? title).trim();
  const coArtists = artist.split(/,|&| feat\.? | ft\.? | x /i).map((name) => name.trim()).filter(Boolean).slice(1, 3);
  const candidates = [
    { title, artist },
    { title, artist: lead },
    ...(shortTitle && shortTitle !== title ? [{ title: shortTitle, artist: lead }] : []),
    ...coArtists.map((name) => ({ title, artist: name }))
  ];
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = `${candidate.title.toLocaleLowerCase()}|${candidate.artist.toLocaleLowerCase()}`;
      if (!candidate.title || !candidate.artist || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

/** Loose title guard for fuzzy searches: one name contains the other after normalising. */
function titlesAlike(found: string | undefined, wanted: string): boolean {
  const normalise = (value: string): string => value.toLocaleLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const left = normalise(found ?? '');
  const right = normalise(wanted);
  return left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));
}

function toPayload(best: LrclibEntry, title: string, duration: number | undefined, source: 'LRCLIB' | 'LRCLIB-search'): LyricsPayload {
  const raw = best.syncedLyrics?.trim() || best.plainLyrics?.trim() || '';
  const score = scoreLyrics(best, title, duration);
  const synced = Boolean(best.syncedLyrics?.trim());
  return {
    source: synced ? source : 'interpolated',
    type: synced ? 'synced' : 'plain',
    matchScore: score.score,
    matchReason: score.reason,
    lines: parseLyrics(raw, duration ?? best.duration ?? 180)
  };
}

function toPayloadFromRaw(raw: string, title: string, duration: number | undefined, source: string): LyricsPayload {
  const synced = hasTimestamps(raw);
  const lines = parseLyrics(raw, duration ?? 180);
  return {
    source: synced ? source : 'interpolated',
    type: synced ? 'synced' : 'plain',
    matchScore: synced ? 50 : 20,
    matchReason: `${title} • ${synced ? 'Synced' : 'Plain text'}`,
    lines
  };
}

/** An aggregator's candidate as a payload; the recording it was filed under leads its match reason. */
function candidatePayload(candidate: LyricsCandidate, title: string, duration: number | undefined): LyricsPayload {
  const payload = toPayloadFromRaw(candidate.lyrics, title, duration, candidate.source);
  return candidate.filedAs ? { ...payload, matchReason: `${candidate.filedAs} • ${payload.type === 'synced' ? 'Synced' : 'Plain text'}` } : payload;
}

/** Same words and same kind means the same version, whichever provider or entry it came from. */
function lyricsFingerprint(payload: LyricsPayload): string {
  const words = payload.lines
    .map((line) => line.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean)
    .slice(0, 8)
    .join('|');
  return words ? `${payload.type}:${words}` : '';
}

function isUsable(entry: LrclibEntry, syncedOnly: boolean): boolean {
  const synced = entry.syncedLyrics?.trim() ?? '';
  const plain = entry.plainLyrics?.trim() ?? '';
  if (containsHtml(synced) || containsHtml(plain)) {
    return false;
  }
  return Boolean((syncedOnly ? synced : synced || plain));
}

function containsHtml(value: string): boolean {
  return /<div|<html|<!doctype/i.test(value);
}
