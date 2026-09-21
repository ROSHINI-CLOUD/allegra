export interface AiCompleteOptions {
  readonly system?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/** Every provider must never throw — a failure is a null result, so the cascade can try the next one. */
export interface AiProvider {
  readonly name: string;
  complete(prompt: string, options?: AiCompleteOptions): Promise<string | null>;
}
