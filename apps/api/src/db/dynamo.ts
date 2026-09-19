import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import type { CacheStore } from '../lib/cache.js';
import type { UserData, UserStore } from '../user/store.js';

export class DynamoCacheStore implements CacheStore {
  private readonly client: DynamoDBDocumentClient;

  public constructor(private readonly tableName: string) {
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  public async get<T>(key: string): Promise<T | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { cacheKey: key }
    }));
    const item = result.Item;
    if (!item || typeof item.value !== 'string' || typeof item.expiresAt !== 'number') {
      return null;
    }
    if (item.expiresAt <= Math.floor(Date.now() / 1000)) {
      await this.delete(key);
      return null;
    }
    try {
      return JSON.parse(item.value) as T;
    } catch {
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        cacheKey: key,
        value: JSON.stringify(value),
        expiresAt: Math.floor(Date.now() / 1000) + Math.max(1, ttlSeconds)
      }
    }));
  }

  public async delete(key: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { cacheKey: key }
    }));
  }
}

export class DynamoUserStore implements UserStore {
  private readonly client: DynamoDBDocumentClient;

  public constructor(private readonly tableName: string) {
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  public async get(userId: string): Promise<UserData | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { userId }
    }));
    const payload = result.Item?.payload;
    return typeof payload === 'string' ? parseUserData(payload) : null;
  }

  public async save(user: UserData): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { userId: user.userId, payload: JSON.stringify(user), updatedAt: Date.now() }
    }));
  }
}

function parseUserData(payload: string): UserData | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== 'object' || value === null || !('userId' in value) || typeof value.userId !== 'string') {
      return null;
    }
    return value as UserData;
  } catch {
    return null;
  }
}
