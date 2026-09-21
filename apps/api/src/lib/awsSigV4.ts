import { createHash, createHmac } from 'node:crypto';

/**
 * Shared SigV4 *header* signing for requests this API makes itself (DynamoDB,
 * Bedrock). Distinct from S3 query-string presigning in `s3Presign.ts`.
 */

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export interface SignAwsHeadersOptions {
  readonly method: string;
  readonly host: string;
  readonly path: string;
  readonly body: string;
  readonly region: string;
  readonly service: string;
  readonly credentials: AwsCredentials;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  readonly now?: Date;
}

export function signAwsHeaders(options: SignAwsHeadersOptions): Record<string, string> {
  const now = options.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(options.body).digest('hex');

  const headers: Record<string, string> = {
    'content-type': options.extraHeaders?.['content-type'] ?? 'application/json',
    host: options.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(options.credentials.sessionToken ? { 'x-amz-security-token': options.credentials.sessionToken } : {}),
    ...omit(options.extraHeaders, ['content-type', 'host', 'x-amz-content-sha256', 'x-amz-date', 'authorization'])
  };

  const signedHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [options.method, options.path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  const kDate = createHmac('sha256', `AWS4${options.credentials.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(options.region).digest();
  const kService = createHmac('sha256', kRegion).update(options.service).digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${options.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

function omit(
  headers: Readonly<Record<string, string>> | undefined,
  keys: readonly string[]
): Record<string, string> {
  if (!headers) return {};
  const blocked = new Set(keys.map((key) => key.toLowerCase()));
  const next: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!blocked.has(name.toLowerCase())) next[name] = value;
  }
  return next;
}
