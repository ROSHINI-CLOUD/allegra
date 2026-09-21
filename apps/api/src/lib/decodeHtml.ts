const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"'
};

export function decodeHtml(value: string): string {
  return value
    .replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, body: string) => {
      const lower = body.toLowerCase();
      if (lower.startsWith('#x')) {
        const codePoint = Number.parseInt(lower.slice(2), 16);
        return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
      }
      if (lower.startsWith('#')) {
        const codePoint = Number.parseInt(lower.slice(1), 10);
        return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
      }
      return NAMED_ENTITIES[lower] ?? entity;
    });
}

/** UTF-8 punctuation that a provider re-read as Windows-1252, and what it was meant to be. */
const MOJIBAKE: ReadonlyArray<readonly [string, string]> = [
  ['\u00e2\u20ac\u0153', '\u201c'],
  ['\u00e2\u20ac\u009d', '\u201d'],
  ['\u00e2\u20ac\u02dc', '\u2018'],
  ['\u00e2\u20ac\u2122', '\u2019'],
  ['\u00e2\u20ac\u201c', '\u2013'],
  ['\u00e2\u20ac\u201d', '\u2014'],
  ['\u00e2\u20ac\u00a6', '\u2026'],
  ['\u00e2\u20ac', '"']
];

/** Repairs double-encoded quotes and dashes in provider prose (artist bios). */
export function repairMojibake(value: string): string {
  const repaired = MOJIBAKE.reduce((text, [broken, fixed]) => text.split(broken).join(fixed), value);
  // Providers also glue sentences together ("Pritam.Known"): restore the space after a full stop.
  return repaired.replace(/([a-z]{2}[.!?])([A-Z][a-z])/g, '$1 $2');
}
