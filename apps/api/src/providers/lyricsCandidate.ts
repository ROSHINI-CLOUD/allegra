/** One rendering of a song's lyrics as an aggregator returns it, before it becomes a LyricsPayload. */
export interface LyricsCandidate {
  /** LRC (`[mm:ss.xx] line`) when synced, otherwise plain text, one line per lyric line. */
  readonly lyrics: string;
  readonly source: string;
  /** The recording the provider filed it under ("Artist — Title"), when it says. */
  readonly filedAs?: string;
}

/** `[mm:ss.xx]` for a time in milliseconds. */
export function lrcStamp(milliseconds: number): string {
  const safe = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const centiseconds = Math.floor((safe % 1_000) / 10);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function looksLikeHtml(value: string): boolean {
  return /<div|<html|<!doctype/i.test(value);
}
