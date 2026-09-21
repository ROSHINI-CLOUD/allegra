import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js';
import type { AiCompleteOptions, AiProvider } from '../types.js';

const TIMEOUT_MS = 20_000;

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
}

/** https://ai.google.dev/api/generate-content */
export class GeminiProvider implements AiProvider {
  public readonly name = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'gemini-2.5-flash';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async complete(prompt: string, options: AiCompleteOptions = {}): Promise<string | null> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
        generationConfig: {
          maxOutputTokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.6,
          // Gemini 2.5 burns output budget on hidden thoughts; keep them off so
          // short structured replies (recommend JSON, lyric arrays) aren't truncated.
          thinkingConfig: { thinkingBudget: 0 }
        }
      };
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }, TIMEOUT_MS, this.fetchImpl);
      if (!response.ok) return null;
      const json = (await response.json()) as {
        candidates?: ReadonlyArray<{ content?: { parts?: ReadonlyArray<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
      return text || null;
    } catch {
      return null;
    }
  }
}
