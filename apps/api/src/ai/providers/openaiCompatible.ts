import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js';
import type { AiCompleteOptions, AiProvider } from '../types.js';

const TIMEOUT_MS = 20_000;

export interface OpenAiCompatibleProviderOptions {
  readonly name: string;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly extraHeaders?: Record<string, string>;
  readonly fetchImpl?: typeof fetch;
}

/** Shared client for any OpenAI-compatible /chat/completions API — Groq and OpenRouter both fit this shape. */
export class OpenAiCompatibleProvider implements AiProvider {
  public readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: OpenAiCompatibleProviderOptions) {
    this.name = options.name;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.extraHeaders = options.extraHeaders ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async complete(prompt: string, options: AiCompleteOptions = {}): Promise<string | null> {
    try {
      const messages = [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt }
      ];
      const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.6
        })
      }, TIMEOUT_MS, this.fetchImpl);
      if (!response.ok) return null;
      const json = (await response.json()) as {
        choices?: ReadonlyArray<{ message?: { content?: string } }>;
      };
      const text = json.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch {
      return null;
    }
  }
}
