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
