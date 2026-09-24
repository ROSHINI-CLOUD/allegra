/**
 * Playlist covers live in Convex file storage. The browser resizes an image to a small square
 * WebP (JPEG where WebP encoding is missing) before it uploads, so a cover is tens of KB; the
 * cap below is generous for that and far below what a raw photo would be.
 */
export const MAX_COVER_BYTES = 300 * 1024;

export const COVER_CONTENT_TYPES = ['image/webp', 'image/jpeg'] as const;

export function isCoverContentType(value: string): value is (typeof COVER_CONTENT_TYPES)[number] {
  return (COVER_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Shape check for a Convex storage id before it is sent anywhere; Convex validates it for real. */
export function looksLikeStorageId(value: string): boolean {
  return /^[a-z0-9]{16,64}$/.test(value);
}

export interface StoredCover {
  readonly url: string;
  readonly contentType: string;
  readonly size: number;
}

/** Where cover bytes live. Convex implements it; without Convex, uploads are off (503). */
export interface CoverStorage {
  /** One-time URL the browser POSTs the image to; answers `{ storageId }`. */
  uploadUrl(): Promise<string>;
  /** What was stored under an id, or null when there is no such file. */
  inspect(storageId: string): Promise<StoredCover | null>;
  /** Best effort: a leftover file costs a few KB, a failed request must not. */
  remove(storageId: string): Promise<void>;
}
