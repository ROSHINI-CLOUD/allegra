import type { SaavnSong } from '../providers/saavn.js';
import type { UnifiedSong } from '../types.js';
import { decodeHtml } from './decodeHtml.js';

export function normalizeSong(
  raw: SaavnSong,
  source: 'Saavn' | 'Gaana'
): UnifiedSong | null {
  if (raw.id === undefined) {
    return null;
  }

  const id = String(raw.id).trim();
  const title = decodeHtml((raw.name ?? raw.title ?? '').trim());
  const artist = decodeHtml(getArtist(raw));
  const stream = pickAsset(raw.downloadUrl, '320kbps');
  if (!id || !title || !stream) {
    return null;
  }

  const image = pickAsset(raw.image, '500x500') ?? '';
  const duration = toNonNegativeNumber(raw.duration);
  const playCount = source === 'Gaana' ? 0 : parsePlayCount(raw.playCount ?? raw.play_count);
  const album = getAlbum(raw);
  const optional = {
    ...(raw.language ? { language: decodeHtml(raw.language) } : {})
  };

  return {
    id,
    title,
    artist,
    ...(album ? { album: decodeHtml(album) } : {}),
    artwork: image,
    streamUrl: `/api/stream/${encodeURIComponent(id)}`,
    duration,
    hasLyrics: raw.hasLyrics === true,
    ...optional,
    playCount,
    source
  };
}

/**
 * A key that is the same for two provider rows describing the same recording.
 * The providers list one row per release, so the same song comes back several
 * times with a different id — which makes a shelf or a recommendation show it
 * twice in a row. The title loses its "(From "Some Film")" / "(Telugu)" trailers,
 * which is where the rows disagree most, and the artist credits are sorted
 * because a re-release often lists the same people in a different order.
 */
export function songIdentity(song: UnifiedSong): string {
  const title = flatten(song.title.replace(/[([][^)\]]*[)\]]/gu, ' '));
  const artists = flatten(song.artist).split(' ').sort().join(' ');
  return `${title}|${artists}`;
}

/**
 * Group provider rows that describe the same recording. Elects one canonical
 * row and attaches the rest as flat `variants`. Order of first appearance of
 * each recording identity is preserved.
 *
 * Election (any song, not just one title):
 * 1. Meaningful playCount lead (near-ties ignored — Saavn copies often differ by 1)
 * 2. Album name matches the song title (official single) over editorial placements
 * 3. Real primary artist over "Various Artists"
 * 4. Albums not shared across many artists in this result set
 */
export function collapseRecordings(songs: readonly UnifiedSong[]): UnifiedSong[] {
  if (songs.length <= 1) {
    return [...songs];
  }

  const groups = new Map<string, UnifiedSong[]>();
  const order: string[] = [];
  for (const song of songs) {
    const key = songIdentity(song);
    const existing = groups.get(key);
    if (existing) {
      existing.push(song);
    } else {
      groups.set(key, [song]);
      order.push(key);
    }
  }

  const albumDiversity = albumArtistCounts(songs);

  return order.map((key) => {
    const group = groups.get(key) ?? [];
    const canonical = electCanonical(group, albumDiversity);
    const variants = group
      .filter((song) => song.id !== canonical.id)
      .map(stripVariants);
    if (variants.length === 0) {
      return stripVariants(canonical);
    }
    return { ...stripVariants(canonical), variants };
  });
}

function electCanonical(
  group: readonly UnifiedSong[],
  albumDiversity: ReadonlyMap<string, number>
): UnifiedSong {
  return [...group].sort((left, right) => {
    // Day-lists / "best of" shells often outrank the studio cut on raw plays.
    // Prefer a real release unless the compilation has a clear blowout (~5×).
    const leftComp = isCompilationAlbum(left.album);
    const rightComp = isCompilationAlbum(right.album);
    if (leftComp !== rightComp) {
      const compilation = leftComp ? left : right;
      const release = leftComp ? right : left;
      if (!isPlayCountBlowout(compilation.playCount, release.playCount)) {
        return leftComp ? 1 : -1;
      }
    }

    // Saavn stamps nearly the same playCount on every placement of a hit.
    // A lead of 1 must not beat the official cut; a true blowout still should.
    const play = comparePlayCount(left.playCount, right.playCount);
    if (play !== 0) return play;

    const titleAlbum =
      Number(albumMatchesTitle(right)) - Number(albumMatchesTitle(left));
    if (titleAlbum !== 0) return titleAlbum;

    const various = Number(isVariousArtists(left.artist)) - Number(isVariousArtists(right.artist));
    if (various !== 0) return various;

    const leftAlbum = left.album ? albumDiversity.get(flatten(left.album)) ?? 0 : 0;
    const rightAlbum = right.album ? albumDiversity.get(flatten(right.album)) ?? 0 : 0;
    if (leftAlbum !== rightAlbum) return leftAlbum - rightAlbum;

    // Stable leftover: higher playCount even inside the near-tie band.
    return right.playCount - left.playCount;
  })[0]!;
}

/** True when album is the song's own single (title ≈ album), not a playlist placement. */
function albumMatchesTitle(song: UnifiedSong): boolean {
  if (!song.album) return false;
  const title = flatten(song.title.replace(/[([][^)\]]*[)\]]/gu, ' '));
  const album = flatten(song.album);
  if (!title || !album) return false;
  return album === title || album.startsWith(`${title} `) || title.startsWith(album);
}

/**
 * Meaningful playCount comparison. Near-ties (within 2% or 2_000 plays) count as
 * equal so editorial playlist rows cannot win by a single play over the single.
 */
function comparePlayCount(left: number, right: number): number {
  const delta = right - left;
  if (delta === 0) return 0;
  const scale = Math.max(left, right, 1);
  if (Math.abs(delta) <= 2_000 || Math.abs(delta) / scale <= 0.02) return 0;
  return delta;
}

/** True when `high` clearly outranks `low` (≈5× or a huge absolute gap). */
function isPlayCountBlowout(high: number, low: number): boolean {
  if (high <= low) return false;
  if (high >= low * 5) return true;
  return high - low >= 5_000_000;
}

/** How many distinct primary artists share each album name in this result set. */
function albumArtistCounts(songs: readonly UnifiedSong[]): Map<string, number> {
  const artistsByAlbum = new Map<string, Set<string>>();
  for (const song of songs) {
    if (!song.album) continue;
    const albumKey = flatten(song.album);
    const artistKey = flatten(song.artist);
    const set = artistsByAlbum.get(albumKey) ?? new Set<string>();
    set.add(artistKey);
    artistsByAlbum.set(albumKey, set);
  }
  const counts = new Map<string, number>();
  for (const [album, artists] of artistsByAlbum) {
    counts.set(album, artists.size);
  }
  return counts;
}

function isVariousArtists(artist: string): boolean {
  return /\bvarious\s+artists\b/i.test(artist);
}

/** Playlist / themed day-list / "best of" shells — not the song's own release. */
function isCompilationAlbum(album: string | undefined): boolean {
  if (!album) return false;
  return /\b(best of|greatest hits|hits|playlist|world music day|valentine|holi|diwali|christmas|new year|top\s*\d+|chartbusters?|jukebox|collection|anthology|various)\b/i.test(
    album
  );
}

function stripVariants(song: UnifiedSong): UnifiedSong {
  if (!song.variants) return song;
  const { variants, ...rest } = song;
  void variants;
  return rest;
}

function flatten(value: string): string {
  return decodeHtml(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function getArtist(raw: SaavnSong): string {
  if (raw.primaryArtists?.trim()) {
    return raw.primaryArtists.trim();
  }

  const names = raw.artists?.primary
    ?.map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name));
  return names?.join(', ') || 'Unknown Artist';
}

function getAlbum(raw: SaavnSong): string | null {
  if (typeof raw.album === 'string') {
    return raw.album.trim() || null;
  }
  return raw.album?.name?.trim() || null;
}

function pickAsset(
  assets: readonly { readonly quality?: string; readonly url?: string }[] | undefined,
  preferredQuality: string
): string | null {
  if (!assets) {
    return null;
  }

  const usable = assets.filter((asset) => Boolean(asset.url));
  const preferred = usable.find((asset) => asset.quality === preferredQuality);
  return preferred?.url ?? usable.at(-1)?.url ?? null;
}

function parsePlayCount(value: number | string | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
  }

  if (typeof value === 'string') {
    const digits = value.replace(/\D/g, '');
    return digits ? Number.parseInt(digits, 10) : 0;
  }

  return 0;
}

function toNonNegativeNumber(value: number | string | undefined): number {
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
