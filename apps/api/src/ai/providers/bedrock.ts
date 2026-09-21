import { createHash, createHmac } from 'node:crypto';

import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js';
import type { AiCompleteOptions, AiProvider } from '../types.js';

const TIMEOUT_MS = 25_000;

export interface BedrockProviderOptions {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Required for temporary creds from `aws login` / STS (ASIA… keys). */
  readonly sessionToken?: string;
  readonly region: string;
  readonly modelId?: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Lowest-priority fallback: hand-rolled SigV4 so this doesn't need the AWS SDK
 * (deliberately dropped from this repo's dependencies earlier). Bedrock Runtime's
 * InvokeModel over the Anthropic Messages body shape — see
 * https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages.html
 */
export class BedrockProvider implements AiProvider {
  public readonly name = 'bedrock';
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken: string | undefined;
  private readonly region: string;
  private readonly modelId: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: BedrockProviderOptions) {
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.sessionToken = options.sessionToken;
    this.region = options.region;
    this.modelId = options.modelId ?? 'anthropic.claude-3-haiku-20240307-v1:0';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async complete(prompt: string, options: AiCompleteOptions = {}): Promise<string | null> {
    try {
      const host = `bedrock-runtime.${this.region}.amazonaws.com`;
      const path = `/model/${encodeURIComponent(this.modelId)}/invoke`;
      const body = JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.6,
        ...(options.system ? { system: options.system } : {}),
        messages: [{ role: 'user', content: prompt }]
      });

      const headers = this.signRequest('POST', host, path, body);
      const response = await fetchWithTimeout(`https://${host}${path}`, {
        method: 'POST',
        headers,
        body
      }, TIMEOUT_MS, this.fetchImpl);
      if (!response.ok) return null;
      const json = (await response.json()) as { content?: ReadonlyArray<{ text?: string }> };
      const text = json.content?.map((block) => block.text ?? '').join('').trim();
      return text || null;
    } catch {
      return null;
    }
  }

  /** Minimal AWS Signature Version 4 for a single POST request, no query string. */
  private signRequest(method: string, host: string, path: string, body: string): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const service = 'bedrock';

    const payloadHash = createHash('sha256').update(body).digest('hex');
    const tokenHeader = this.sessionToken ? `x-amz-security-token:${this.sessionToken}\n` : '';
    const canonicalHeaders =
      `content-type:application/json\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n` +
      tokenHeader;
    const signedHeaders = this.sessionToken
      ? 'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
      : 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    const kDate = createHmac('sha256', `AWS4${this.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(this.region).digest();
    const kService = createHmac('sha256', kRegion).update(service).digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return {
      'content-type': 'application/json',
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(this.sessionToken ? { 'x-amz-security-token': this.sessionToken } : {}),
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    };
  }
}
