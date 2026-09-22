import { createHash, createHmac } from 'node:crypto';

import type { AwsCredentials } from './awsSigV4.js';

export interface PutObjectBytesOptions {
  readonly credentials: AwsCredentials;
  readonly region: string;
  readonly bucket: string;
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: Date;
}

/** Server-side S3 PUT with header SigV4 over binary bodies (no AWS SDK). */
export async function putObjectBytes(options: PutObjectBytesOptions): Promise<void> {
  const host = `${options.bucket}.s3.${options.region}.amazonaws.com`;
  const path = `/${encodeKey(options.key)}`;
  const body = Buffer.from(options.body);
  const now = options.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(body).digest('hex');

  const headers: Record<string, string> = {
    'content-length': String(body.byteLength),
    'content-type': options.contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(options.credentials.sessionToken ? { 'x-amz-security-token': options.credentials.sessionToken } : {})
  };

  const signedHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = ['PUT', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${options.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  const kDate = createHmac('sha256', `AWS4${options.credentials.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(options.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://${host}${path}`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${options.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    },
    body
  });
  if (!response.ok) {
    throw new Error(`S3 PUT failed with HTTP ${response.status}`);
  }
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}
