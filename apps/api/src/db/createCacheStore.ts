import type { CacheConfig } from '../config.js';
import { LayeredCacheStore, MemoryCacheStore, type CacheStore } from '../lib/cache.js';
import { DynamoCacheStore } from './dynamoCache.js';

/** Memory-only locally; memory + Dynamo when `DDB_TABLE_CACHE` is configured. */
export function createCacheStore(config?: CacheConfig, fetchImpl?: typeof fetch): CacheStore {
  if (!config) return new MemoryCacheStore();

  const dynamo = new DynamoCacheStore({
    tableName: config.tableName,
    region: config.region,
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            ...(config.sessionToken ? { sessionToken: config.sessionToken } : {})
          }
        }
      : {}),
    ...(fetchImpl ? { fetchImpl } : {})
  });

  return new LayeredCacheStore(new MemoryCacheStore(), dynamo);
}
