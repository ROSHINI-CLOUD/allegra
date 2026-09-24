import { lookup } from 'node:dns/promises';
import net from 'node:net';

import type { CacheStore } from '../lib/cache.js';
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';
import { isPrivateHostname } from '../lib/publicUrl.js';
import { newJti, type OAuthSigner } from './tokens.js';

export interface OAuthClient {
  readonly clientId: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
  /** For the consent screen: where the client's identity comes from. */
  readonly kind: 'metadata-document' | 'registered';
}

const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 512;
const MAX_METADATA_BYTES = 16 * 1024;
const METADATA_TIMEOUT_MS = 5_000;
const METADATA_TTL_SECONDS = 3_600;
const CLIENT_PREFIX = 'mcpc_';

/**
 * Redirect URIs must be HTTPS, or plain HTTP only to this machine (native clients listening on a
 * loopback port). No fragments, no credentials in the URI.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopback(url.hostname);
}

export function isLoopbackRedirect(uri: string): boolean {
  try {
    return isLoopback(new URL(uri).hostname);
  } catch {
    return false;
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  // Printable, single line, short: it is shown on the consent screen.
  const name = [...value].filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f && char !== '<' && char !== '>').join('').trim().slice(0, 80);
  return name || fallback;
}

/**
 * Resolves a `client_id` from either registration style the MCP spec allows:
 *
 *   - Dynamic Client Registration (RFC 7591): the id we issued, a signed token carrying the
 *     client's redirect URIs — nothing stored server-side.
 *   - Client ID Metadata Documents: an HTTPS URL the client hosts, fetched (with SSRF guards)
 *     and required to name itself with that exact URL.
 */
export class OAuthClients {
  public constructor(
    private readonly signer: OAuthSigner,
    private readonly cache: CacheStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly resolveHost: (host: string) => Promise<readonly string[]> = defaultResolve
  ) {}

  /** RFC 7591 registration. Returns the client or a reason it was refused. */
  public register(body: Record<string, unknown>): { client: OAuthClient } | { error: string; description: string } {
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
      return { error: 'invalid_redirect_uri', description: 'redirect_uris must list 1 to 10 URIs.' };
    }
    if (!uris.every(isAllowedRedirectUri)) {
      return { error: 'invalid_redirect_uri', description: 'Redirect URIs must be https, or http on localhost.' };
    }
    const method = body.token_endpoint_auth_method;
    if (method !== undefined && method !== 'none') {
      return { error: 'invalid_client_metadata', description: 'Only public clients (token_endpoint_auth_method "none") are supported.' };
    }
    const name = cleanName(body.client_name, 'MCP client');
    const redirectUris = [...new Set(uris as string[])];
    // The nonce makes every registration its own client, even with identical metadata.
    const clientId = CLIENT_PREFIX + this.signer.sign('client', { n: name, r: redirectUris, jti: newJti() });
    return { client: { clientId, name, redirectUris, kind: 'registered' } };
  }

  public async resolve(clientId: string): Promise<OAuthClient | null> {
    if (clientId.startsWith(CLIENT_PREFIX)) {
      const claims = this.signer.verify('client', clientId.slice(CLIENT_PREFIX.length));
      if (!claims || !Array.isArray(claims.r) || !claims.r.every(isAllowedRedirectUri)) return null;
      return { clientId, name: cleanName(claims.n, 'MCP client'), redirectUris: claims.r as string[], kind: 'registered' };
    }
    if (clientId.startsWith('https://')) return this.fromMetadataDocument(clientId);
    return null;
  }

  private async fromMetadataDocument(clientId: string): Promise<OAuthClient | null> {
    const url = safeMetadataUrl(clientId);
    if (!url) return null;
    const key = `oauth-client:v1:${clientId}`;
    const cached = await this.cache.get<OAuthClient | { none: true }>(key);
    if (cached) return 'none' in cached ? null : cached;

    const client = await this.fetchMetadata(url, clientId);
    await this.cache.set(key, client ?? { none: true }, client ? METADATA_TTL_SECONDS : 300);
    return client;
  }

  private async fetchMetadata(url: URL, clientId: string): Promise<OAuthClient | null> {
    try {
      // SSRF: the host must resolve only to public addresses. (Checked here; the fetch re-resolves,
      // but a redirect is refused outright and the answer is size- and time-bounded.)
      const addresses = await this.resolveHost(url.hostname);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) return null;
      const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, redirect: 'error' }, METADATA_TIMEOUT_MS, this.fetchImpl);
      if (!response.ok) return null;
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_METADATA_BYTES) return null;
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_METADATA_BYTES) return null;
      const document = JSON.parse(text) as Record<string, unknown>;
      if (document.client_id !== clientId) return null;
      const uris = document.redirect_uris;
      if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every(isAllowedRedirectUri)) return null;
      if (document.token_endpoint_auth_method !== undefined && document.token_endpoint_auth_method !== 'none') return null;
      return { clientId, name: cleanName(document.client_name, url.hostname), redirectUris: uris as string[], kind: 'metadata-document' };
    } catch {
      return null;
    }
  }
}

/** A client id URL we are willing to fetch: https, default port, a path, nothing private. */
export function safeMetadataUrl(value: string): URL | null {
  if (value.length > MAX_URI_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hash || url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;
  if (url.pathname === '/' || url.pathname === '') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) || isPrivateHostname(host) || !host.includes('.')) return null;
  return url;
}

async function defaultResolve(host: string): Promise<readonly string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

/** Loopback, link-local, private, CGNAT and unique-local ranges, IPv4 and IPv6 (incl. mapped). */
export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ip = mapped?.[1] ?? value;
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('ff');
  }
  return true;
}
