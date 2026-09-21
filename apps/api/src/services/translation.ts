import { createHash } from 'node:crypto';

import type { AiClient } from '../ai/aiClient.js';
import { extractJson } from '../ai/json.js';
import { cachedLookup, cacheKey, type CacheStore } from '../lib/cache.js';
import type { LyricLine } from '../types.js';

const HIT_TTL_SECONDS = 2_592_000; // 30 days, same as a lyrics cache hit
const MISS_TTL_SECONDS = 600;

export interface TranslationResult {
  readonly lines: LyricLine[];
  readonly provider: string;
}

const SYSTEM_PROMPT = `You translate song lyrics. Capture the meaning, emotion, and poetic intent of each line in natural, idiomatic language — never a literal word-for-word translation. Keep line breaks: return exactly one translated string per input line, in the same order. Respond with ONLY a JSON array of strings, nothing else — no commentary, no markdown fences.`;

export class TranslationService {
  public constructor(
    private readonly ai: AiClient,
    private readonly cache: CacheStore
  ) {}

  public get isAvailable(): boolean {
    return this.ai.isConfigured;
  }

  public async translate(
    lines: readonly LyricLine[],
    title: string,
    artist: string,
    targetLanguage = 'English'
  ): Promise<TranslationResult | null> {
    if (lines.length === 0 || !this.ai.isConfigured) return null;

    const bodyHash = createHash('sha256')
      .update(lines.map((line) => line.text).join('\n'))
      .digest('hex')
      .slice(0, 16);
    const key = cacheKey('translate', title, artist, targetLanguage, String(lines.length), bodyHash);

    return cachedLookup(this.cache, {
      key,
      hitTtlSeconds: HIT_TTL_SECONDS,
      missTtlSeconds: MISS_TTL_SECONDS,
      load: async () => {
        const translatable = lines.map((line) => (line.text === '[INSTRUMENTAL]' ? null : line.text));
        const prompt = `Song: "${title}" by ${artist}\nTarget language: ${targetLanguage}\n\nLines (JSON array, some may be null for instrumental sections — return null back for those, unchanged):\n${JSON.stringify(translatable)}`;

        const result = await this.ai.complete(prompt, { system: SYSTEM_PROMPT, maxTokens: 2048, temperature: 0.4 });
        if (!result) return null;

        const translated = extractJson<Array<string | null>>(result.text);
        if (!translated || translated.length !== lines.length) return null;

        return {
          lines: lines.map((line, index) => ({
            ...line,
            text: line.text === '[INSTRUMENTAL]' ? line.text : (translated[index]?.trim() || line.text)
          })),
          provider: result.provider
        };
      }
    });
  }
}
