/**
 * Removes every match of `pattern`, then looks again until nothing is left to remove.
 *
 * A single `replace` can leave a match behind when taking one piece out joins its neighbours into a new one
 * (`((a))` with `/\([^()]*\)/g` leaves `()`). CodeQL's js/incomplete-multi-character-sanitization flags any tag
 * strip done in one pass, and repeating until the text stops changing is the remedy it documents. It always
 * ends, because every pass that changes the text makes it shorter.
 */
export function removeUntilStable(value: string, pattern: RegExp): string {
  let previous: string;
  let out = value;
  do {
    previous = out;
    out = out.replace(pattern, '');
  } while (out !== previous);
  return out;
}

/**
 * Drops every `<…>` tag. Entities are not decoded here. For this pattern the repeat never changes the result
 * (`[^>]+` already swallows an inner `<`; checked over every string up to length 9 on `<`, `>`, `a`, `b`, `/`);
 * it is here so the guarantee does not rest on that reasoning.
 */
export function stripTags(value: string): string {
  return removeUntilStable(value, /<[^>]+>/g);
}
