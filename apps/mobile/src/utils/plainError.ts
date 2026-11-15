/**
 * What a listener reads when something fails. DESIGN.md §9: never show a raw `error.message`.
 *
 * Messages this app wrote itself ("This LuvLink invite has expired or was revoked.") pass through. Everything
 * else (a fetch's "Network request failed", a Convex "[CONVEX M(...)] Server Error", JSON, a stack line)
 * becomes `fallback`, or a plain connection line when the failure was the network.
 */

const CONNECTION = 'Check your connection and try again.';

const NETWORK = /network request failed|failed to fetch|network error|timed? ?out|econn|enotfound|offline|socket|connection (lost|closed|reset)/i;
const TECHNICAL = /[{}[\]<>]|\bconvex\b|request id|server error|uncaught|exception|\b\w*error\b\s*:|\bat \S+:\d+|\bstatus (code )?\d{3}\b|\bhttp \d{3}\b|\bundefined\b|\bnull\b|\bnan\b/i;
const MAX_LENGTH = 140;

/** A ConvexError carries its payload on `data`: a string, or `{ code, message }`. */
const authoredMessage = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
  const { data } = error as { data: unknown };
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null && 'message' in data) {
    const { message } = data as { message: unknown };
    if (typeof message === 'string') return message;
  }
  return undefined;
};

const isPlain = (text: string): boolean => text.length > 0 && text.length <= MAX_LENGTH && !TECHNICAL.test(text);

/** The sentence to show, or `fallback` when the error carries nothing a listener should read. */
export const plainErrorMessage = (error: unknown, fallback: string): string => {
  const authored = authoredMessage(error);
  const raw = (authored ?? (error instanceof Error ? error.message : typeof error === 'string' ? error : '')).trim();
  if (NETWORK.test(raw)) return CONNECTION;
  return isPlain(raw) ? raw : fallback;
};
