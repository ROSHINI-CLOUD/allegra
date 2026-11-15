/**
 * Turning markup from a lyrics or catalog provider into plain text.
 *
 * Three things go wrong when this is done with a chain of `.replace` calls, and each one was flagged by CodeQL:
 *  - a single pass over a tag or comment can leave a match behind (`removeUntilStable`);
 *  - a closing tag can carry spaces, `</script >`, and a comment can end `--!>` (`removeNonContentBlocks`);
 *  - decoding `&amp;` first turns `&amp;lt;` into `&lt;` and then into `<`, one decode too many (`decodeHtmlEntities`).
 * Nothing here imports anything, so any screen or service can use it.
 */

/**
 * Removes every match of `pattern`, then looks again until nothing is left to remove. It always ends, because
 * every pass that changes the text makes it shorter.
 */
export const removeUntilStable = (value: string, pattern: RegExp): string => {
  let previous: string;
  let out = value;
  do {
    previous = out;
    out = out.replace(pattern, '');
  } while (out !== previous);
  return out;
};

/** Drops every `<…>` tag. Entities are not decoded here. */
export const stripTags = (value: string): string => removeUntilStable(value, /<[^>]+>/g);

const NON_CONTENT_BLOCKS: readonly RegExp[] = [
  // A browser ends the block at `</script` plus anything up to `>` (`</script >`, `</script\t\n bar>`), so match that.
  /<script\b[\s\S]*?<\/script[^>]*>/gi,
  /<style\b[\s\S]*?<\/style[^>]*>/gi,
  /<!--[\s\S]*?--!?>/g,
];

/** Removes `<script>` and `<style>` blocks and comments, whatever spaces sit in the closing tag. */
export const removeNonContentBlocks = (html: string): string => {
  let out = html;
  let previous: string;
  do {
    previous = out;
    for (const pattern of NON_CONTENT_BLOCKS) out = out.replace(pattern, '');
  } while (out !== previous);
  return out;
};

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };

/**
 * Decodes HTML entities in ONE pass, so `&amp;lt;` becomes `&lt;` (what the page meant) and not `<`.
 * Named: amp, apos, gt, lt, nbsp, quot. Numeric: `&#39;` and `&#x27;`. Anything else is left as written.
 */
export const decodeHtmlEntities = (value: string): string =>
  value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
      // A code point past U+10FFFF would make fromCodePoint throw.
      return Number.isNaN(code) || code > 0x10ffff ? entity : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[lower] ?? entity;
  });
