/** LLMs like to wrap JSON in ```json fences or add a sentence before/after it. Pull out the first {...} or [...] block. */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const openChar = candidate[start];
  const closeChar = openChar === '[' ? ']' : '}';
  const end = candidate.lastIndexOf(closeChar);
  if (end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
