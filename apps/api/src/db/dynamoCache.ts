import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';
import { signAwsHeaders, type AwsCredentials } from '../lib/awsSigV4.js';
import type { CacheStore } from '../lib/cache.js';

const TIMEOUT_MS = 4_000;

export interface DynamoCacheStoreOptions {
  readonly tableName: string;
  readonly region: string;
  /** Static keys (local / explicit). When omitted, container role credentials are fetched. */
  readonly credentials?: AwsCredentials;
  readonly fetchImpl?: typeof fetch;
}

interface AttributeMap {
  readonly [key: string]: { S?: string; N?: string };
}

/**
 * Persistent cache adapter. Hand-rolled DynamoDB JSON protocol +
 * SigV4 — no AWS SDK (enforced by tests/infra). Soft-fails on outages so the
 * layered memory cache keeps serving.
 */
export class DynamoCacheStore implements CacheStore {
  private readonly tableName: string;
  private readonly region: string;
  private readonly staticCredentials: AwsCredentials | undefined;
  private readonly fetchImpl: typeof fetch;
  private cachedCredentials: AwsCredentials | null = null;
  private credentialsExpireAt = 0;

  public constructor(options: DynamoCacheStoreOptions) {
    this.tableName = options.tableName;
    this.region = options.region;
    this.staticCredentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async get<T>(key: string): Promise<T | null> {
    try {
      const body = JSON.stringify({
        TableName: this.tableName,
        Key: { cacheKey: { S: key } },
        ConsistentRead: false
      });
      const json = await this.call('GetItem', body);
      const item = json.Item as AttributeMap | undefined;
      if (!item?.payload?.S) return null;

      const expiresAt = item.expiresAt?.N ? Number.parseInt(item.expiresAt.N, 10) : 0;
      if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
        void this.delete(key);
        return null;
      }
      return JSON.parse(item.payload.S) as T;
    } catch {
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, ttlSeconds);
      const body = JSON.stringify({
        TableName: this.tableName,
        Item: {
          cacheKey: { S: key },
          payload: { S: JSON.stringify(value) },
          expiresAt: { N: String(expiresAt) }
        }
      });
      await this.call('PutItem', body);
    } catch {
      // LayeredCacheStore still keeps the in-process copy.
    }
  }

  public async delete(key: string): Promise<void> {
    try {
      const body = JSON.stringify({
        TableName: this.tableName,
        Key: { cacheKey: { S: key } }
      });
      await this.call('DeleteItem', body);
    } catch {
      // Best effort.
    }
  }

  private async call(operation: 'GetItem' | 'PutItem' | 'DeleteItem', body: string): Promise<Record<string, unknown>> {
    const credentials = await this.resolveCredentials();
    if (!credentials) throw new Error('No AWS credentials for DynamoDB cache.');

    const host = `dynamodb.${this.region}.amazonaws.com`;
    const headers = signAwsHeaders({
      method: 'POST',
      host,
      path: '/',
      body,
      region: this.region,
      service: 'dynamodb',
      credentials,
      extraHeaders: {
        'content-type': 'application/x-amz-json-1.0',
        'x-amz-target': `DynamoDB_20120810.${operation}`
      }
    });

    const response = await fetchWithTimeout(
      `https://${host}/`,
      { method: 'POST', headers, body },
      TIMEOUT_MS,
      this.fetchImpl
    );
    if (!response.ok) {
      throw new Error(`DynamoDB ${operation} failed with ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private async resolveCredentials(): Promise<AwsCredentials | null> {
    if (this.staticCredentials?.accessKeyId && this.staticCredentials.secretAccessKey) {
      return this.staticCredentials;
    }
    if (this.cachedCredentials && this.credentialsExpireAt > Date.now() + 60_000) {
      return this.cachedCredentials;
    }

    const fullUri = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI?.trim();
    const relativeUri = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim();
    const url = fullUri || (relativeUri ? `http://169.254.170.2${relativeUri}` : '');
    if (!url) return null;

    const auth = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN?.trim();
    const response = await fetchWithTimeout(
      url,
      { headers: auth ? { Authorization: auth } : {} },
      TIMEOUT_MS,
      this.fetchImpl
    );
    if (!response.ok) return null;
    const json = (await response.json()) as {
      AccessKeyId?: string;
      SecretAccessKey?: string;
      Token?: string;
      Expiration?: string;
    };
    if (!json.AccessKeyId || !json.SecretAccessKey) return null;
    this.cachedCredentials = {
      accessKeyId: json.AccessKeyId,
      secretAccessKey: json.SecretAccessKey,
      ...(json.Token ? { sessionToken: json.Token } : {})
    };
    this.credentialsExpireAt = json.Expiration ? Date.parse(json.Expiration) : Date.now() + 3_600_000;
    return this.cachedCredentials;
  }
}
