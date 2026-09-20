import { createHash, createHmac } from 'node:crypto';

/**
 * Hand-rolled SigV4 *query-string* presigning for a single S3 PUT, so custom
 * playlist covers do not pull the AWS SDK into this API (see tests/infra).
 *
 * This is a different signing mode from `ai/providers/bedrock.ts`: there the
 * signature travels in an Authorization header on a request we make ourselves,
 * whereas here the signature has to live in the URL, because the request is made
 * later by someone else's browser with no credentials of its own.
 *
 * `content-length` and `content-type` are both signed, which is what actually
 * enforces the declared size and image type: S3 recomputes the signature from
 * the headers the browser really sent, so an upload that is bigger than the one
 * we agreed to, or not the type we agreed to, fails at S3 rather than on trust.
 */

export interface PresignPutOptions {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly bucket: string;
  readonly key: string;
  readonly contentType: string;
  readonly contentLength: number;
  /** Kept short: the browser uploads immediately, and a leaked URL should die fast. */
  readonly expiresInSeconds: number;
  /** Injectable so tests can pin the signature to a known instant. */
  readonly now?: Date;
}

export function presignPutUrl(options: PresignPutOptions): string {
  const host = `${options.bucket}.s3.${options.region}.amazonaws.com`;
  const canonicalUri = `/${encodeKey(options.key)}`;
  const amzDate = toAmzDate(options.now ?? new Date());
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${options.region}/s3/aws4_request`;

  // Signed headers must be sorted by name, and so must the query string.
  const signedHeaders = 'content-length;content-type;host';
  const canonicalHeaders =
    `content-length:${options.contentLength}\n` +
    `content-type:${options.contentType}\n` +
    `host:${host}\n`;

  const query = new Map<string, string>([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${options.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(options.expiresInSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders]
  ]);
  const canonicalQuery = [...query.entries()]
    .map(([name, value]) => [rfc3986(name), rfc3986(value)] as const)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');

  // A presigned URL is signed before the body exists, so the payload is unsigned.
  const canonicalRequest = ['PUT', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  const kDate = createHmac('sha256', `AWS4${options.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(options.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/** Each path segment is encoded, but the slashes between them are not. */
function encodeKey(key: string): string {
  return key.split('/').map(rfc3986).join('/');
}

/**
 * AWS wants RFC 3986, which encodeURIComponent nearly gives: it leaves !'()*
 * alone where AWS expects them percent-encoded, and a signature computed over
 * the wrong escaping is rejected with no useful message.
 */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
