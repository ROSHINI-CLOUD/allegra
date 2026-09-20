import type { AiCompleteOptions, AiProvider } from './types.js';

export interface AiResult {
  readonly text: string;
  readonly provider: string;
}

/** Same cascade shape as the music providers (Saavn -> Gaana): try each in order, first success wins. */
export class AiClient {
  public constructor(private readonly providers: readonly AiProvider[]) {}

  public get isConfigured(): boolean {
    return this.providers.length > 0;
  }

  /** The cascade in the order it will actually be tried. */
  public get providerNames(): readonly string[] {
    return this.providers.map((provider) => provider.name);
  }

  public async complete(prompt: string, options?: AiCompleteOptions): Promise<AiResult | null> {
    for (const provider of this.providers) {
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
