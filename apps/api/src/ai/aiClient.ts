import type { AiCompleteOptions, AiProvider } from './types.js';

export interface AiResult {
  readonly text: string;
  readonly provider: string;
}

export interface AiClientOptions {
  /**
   * Cap how many providers may be attempted per `complete` call.
   * When `AI_PRIMARY` is set we pass 2 (primary + one fallback) so a hanging
   * Bedrock call does not walk the entire paid cascade.
   */
  readonly maxAttempts?: number;
}

/** Same cascade shape as the music providers (Saavn -> Gaana): try each in order, first success wins. */
export class AiClient {
  private readonly maxAttempts: number;

  public constructor(
    private readonly providers: readonly AiProvider[],
    options: AiClientOptions = {}
  ) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? Number.POSITIVE_INFINITY);
  }

  public get isConfigured(): boolean {
    return this.providers.length > 0;
  }

  /** The cascade in the order it will actually be tried. */
  public get providerNames(): readonly string[] {
    return this.providers.map((provider) => provider.name);
  }

  public async complete(prompt: string, options?: AiCompleteOptions): Promise<AiResult | null> {
    let attempts = 0;
    for (const provider of this.providers) {
      if (attempts >= this.maxAttempts) break;
      attempts += 1;
      try {
        const text = await provider.complete(prompt, options);
        if (text) {
          return { text, provider: provider.name };
        }
      } catch {
        // Providers are documented to never throw, but one bad implementation
        // shouldn't stop the cascade from trying the next provider.
      }
    }
    return null;
  }
}
