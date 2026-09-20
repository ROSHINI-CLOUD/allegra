import type { LibraryRecord } from '../user/store.js';

/** Hard cap enforced both in our route and by the signed Content-Length on the PUT. */
export const MAX_COVER_BYTES = 2 * 1024 * 1024;

export const COVER_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
} as const;

export type CoverContentType = keyof typeof COVER_CONTENT_TYPES;

export function isCoverContentType(value: string): value is CoverContentType {
  return Object.prototype.hasOwnProperty.call(COVER_CONTENT_TYPES, value);
}

/** Keys always live under covers/<userId>/<libraryId>/ so a PATCH cannot point at someone else's object. */
export function coverKeyPrefix(userId: string, libraryId: string): string {
  return `covers/${userId}/${libraryId}/`;
}

export function isOwnedCoverKey(coverKey: string, userId: string, libraryId: string): boolean {
  if (!coverKey || coverKey.includes('..') || coverKey.startsWith('/') || coverKey.includes('\\')) {
    return false;
  }
  const prefix = coverKeyPrefix(userId, libraryId);
  if (!coverKey.startsWith(prefix)) return false;
  const rest = coverKey.slice(prefix.length);
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(rest);
}

export function publicCoverUrl(publicBaseUrl: string, coverKey: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/${coverKey.replace(/^\/+/, '')}`;
}

/** Drop any derived coverUrl before writing to the store. */
export function forPersistence(library: LibraryRecord): LibraryRecord {
  const { coverUrl: _drop, ...rest } = library as LibraryRecord & { coverUrl?: string };
  void _drop;
  return rest;
}

/** Derive the browser-facing URL from the stored key. coverUrl is never persisted. */
export function withCoverUrl(library: LibraryRecord, publicBaseUrl?: string): LibraryRecord {
  const stored = forPersistence(library);
  if (!stored.coverKey || !publicBaseUrl) return stored;
  return { ...stored, coverUrl: publicCoverUrl(publicBaseUrl, stored.coverKey) };
}

export function withCoverUrls(libraries: readonly LibraryRecord[], publicBaseUrl?: string): LibraryRecord[] {
  return libraries.map((library) => withCoverUrl(library, publicBaseUrl));
}
