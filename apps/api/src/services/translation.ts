import { createHash } from 'node:crypto';

import { cachedLookup, cacheKey, type CacheStore } from '../lib/cache.js';
import { decodeHtml } from '../lib/decodeHtml.js';
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';
import { isoLanguage } from '../lib/languages.js';
import type { LyricLine } from '../types.js';

const HIT_TTL_SECONDS = 2_592_000; // 30 days, same as a lyrics cache hit
const MISS_TTL_SECONDS = 600;
const DEFAULT_BASE_URL = 'https://api.mymemory.translated.net';
const TIMEOUT_MS = 10_000;
/** MyMemory rejects a `q` over 500 bytes; leave room for the joining newlines. */
const MAX_BATCH_BYTES = 450;
const CONCURRENCY = 3;
const INSTRUMENTAL = '[INSTRUMENTAL]';

export interface TranslationResult {
  readonly lines: LyricLine[];
  readonly provider: string;
}

export interface TranslationOptions {
  readonly baseUrl?: string;
  /**
   * Sent as MyMemory's `de` parameter. Anonymous use is capped at 5,000 characters a day; with a
   * contact address it is 50,000. Server-side only — it never reaches the browser.
   */
  readonly contactEmail?: string;
  /** Optional self-hosted LibreTranslate origin, used only when MyMemory cannot answer. */
  readonly fallbackBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface MyMemoryResponse {
  readonly responseStatus?: number | string;
  readonly quotaFinished?: boolean;
  readonly responseData?: { readonly translatedText?: unknown };
}

interface LibreTranslateResponse {
  readonly translatedText?: unknown;
}

/**
 * Lyrics translation through MyMemory: machine translation from a public translation-memory
 * service — no LLM or paid key. An optional self-hosted LibreTranslate instance is the fallback;
 * no unmanaged public mirror is baked into the product. Lines are deduplicated (choruses repeat),
 * packed into as few requests as the 500-byte limit allows, and the whole song is cached.
 */
export class TranslationService {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(
    private readonly cache: CacheStore,
    private readonly options: TranslationOptions = {}
  ) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  public get isAvailable(): boolean {
    return true;
  }

  /**
   * `sourceLanguage` is the song's language when known (the catalog labels every song); without
   * it the provider detects the language itself. Returns null when the provider is down or out
   * of quota — the caller shows the original lyrics.
   */
  public async translate(
    lines: readonly LyricLine[],
    title: string,
    artist: string,
    targetLanguage = 'English',
    sourceLanguage?: string
  ): Promise<TranslationResult | null> {
    if (lines.length === 0) return null;
    const target = isoLanguage(targetLanguage) ?? 'en';
    const source = isoLanguage(sourceLanguage) ?? 'autodetect';
    if (source === target) return { lines: [...lines], provider: 'none' };

    const bodyHash = createHash('sha256')
      .update(lines.map((line) => line.text).join('\n'))
      .digest('hex')
      .slice(0, 16);
    const key = cacheKey('translate', 'mymemory-v1', title, artist, source, target, String(lines.length), bodyHash);

    return cachedLookup(this.cache, {
      key,
      hitTtlSeconds: HIT_TTL_SECONDS,
      missTtlSeconds: MISS_TTL_SECONDS,
      load: async () => {
        // A single line over the provider's limit (vanishingly rare in lyrics) keeps its original text.
        const unique = [...new Set(lines.map((line) => line.text.trim()))].filter(
          (text) => text && text !== INSTRUMENTAL && Buffer.byteLength(text, 'utf8') <= MAX_BATCH_BYTES
        );
        if (unique.length === 0) return { lines: [...lines], provider: 'mymemory' };
        const primary = await this.translateAll(unique, (text) => this.requestMyMemory(text, source, target));
        const fallback = !primary && this.options.fallbackBaseUrl
          ? await this.translateAll(unique, (text) => this.requestLibreTranslate(text, source, target))
          : null;
        const translated = primary ?? fallback;
        if (!translated) return null;
        return {
          lines: lines.map((line) => ({ ...line, text: translated.get(line.text.trim()) ?? line.text })),
          provider: primary ? 'mymemory' : 'libretranslate'
        };
      }
    });
  }

  private async translateAll(
    texts: readonly string[],
    request: (text: string) => Promise<string | null>
  ): Promise<Map<string, string> | null> {
    const batches = packBatches(texts);
    const out = new Map<string, string>();
    let failed = false;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!failed && next < batches.length) {
        const batch = batches[next++]!;
        const result = await this.translateBatch(batch, request);
        if (!result) {
          failed = true;
          return;
        }
        batch.forEach((text, index) => out.set(text, result[index]!));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
    // Half-translated lyrics read worse than the original, so it is all or nothing.
    return failed ? null : out;
  }

  /** One request for the batch; if the provider merges or splits lines, fall back to one request per line. */
  private async translateBatch(batch: readonly string[], request: (text: string) => Promise<string | null>): Promise<string[] | null> {
    const joined = await request(batch.join('\n'));
    if (joined === null) return null;
    const parts = joined.split('\n').map((part) => part.trim());
    if (parts.length === batch.length) return parts.map((part, index) => part || batch[index]!);
    if (batch.length === 1) return [joined.trim() || batch[0]!];
    const single: string[] = [];
    for (const text of batch) {
      const one = await request(text);
      if (one === null) return null;
      single.push(one.trim() || text);
    }
    return single;
  }

  private async requestMyMemory(text: string, source: string, target: string): Promise<string | null> {
    const url = new URL(`${this.baseUrl}/get`);
    url.searchParams.set('q', text);
    url.searchParams.set('langpair', `${source}|${target}`);
    if (this.options.contactEmail) url.searchParams.set('de', this.options.contactEmail);
    try {
      const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, this.timeoutMs, this.fetchImpl);
      if (!response.ok) return null;
      const body = (await response.json()) as MyMemoryResponse;
      // Out of quota comes back as HTTP 200 with a warning *as the translation*; never show that.
      if (body.quotaFinished || Number(body.responseStatus) !== 200) return null;
      const translated = body.responseData?.translatedText;
      return typeof translated === 'string' ? decodeHtml(translated) : null;
    } catch {
      return null;
    }
  }

  private async requestLibreTranslate(text: string, source: string, target: string): Promise<string | null> {
    const baseUrl = this.options.fallbackBaseUrl;
    if (!baseUrl) return null;
    const url = new URL('translate', `${baseUrl.replace(/\/+$/, '')}/`);
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: text, source: source === 'autodetect' ? 'auto' : source, target, format: 'text' })
        },
        this.timeoutMs,
        this.fetchImpl
      );
      if (!response.ok) return null;
      const body = (await response.json()) as LibreTranslateResponse;
      return typeof body.translatedText === 'string' ? decodeHtml(body.translatedText) : null;
    } catch {
      return null;
    }
  }
}

/** Greedy packing by UTF-8 size (Devanagari and Tamil are three bytes a character). Each text must fit alone. */
export function packBatches(texts: readonly string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const text of texts) {
    const size = Buffer.byteLength(text, 'utf8');
    if (current.length > 0 && bytes + 1 + size > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(text);
    bytes += (current.length > 1 ? 1 : 0) + size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
