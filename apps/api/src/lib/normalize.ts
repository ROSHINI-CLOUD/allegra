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
