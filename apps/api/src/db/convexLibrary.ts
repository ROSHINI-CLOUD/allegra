import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

import type { LibraryChange, LibraryOp, RejectReason } from '../shared/library.js';
import type { LibraryApplyResult, LibraryPage, LibraryStore } from '../user/library.js';
import type { ConvexClientLike } from './convex.js';

/** convex/library.ts. anyApi is untyped, so name what we use. */
const libraryApi = anyApi.library as unknown as { readonly apply: unknown; readonly changes: unknown };

const REJECT_REASONS: readonly RejectReason[] = ['bad_time', 'no_playlist', 'missing_name'];

export interface ConvexLibraryStoreOptions {
  readonly url: string;
  readonly serverSecret: string;
  readonly client?: ConvexClientLike;
}

/** Library sync in Convex: one transaction per batch, rules in packages/shared/library.ts. */
export class ConvexLibraryStore implements LibraryStore {
  private readonly client: ConvexClientLike;
  private readonly secret: string;

  public constructor(options: ConvexLibraryStoreOptions) {
    this.client = options.client ?? (new ConvexHttpClient(options.url) as unknown as ConvexClientLike);
    this.secret = options.serverSecret;
  }

  public async apply(userId: string, ops: readonly LibraryOp[]): Promise<LibraryApplyResult> {
    return parseApply(await this.client.mutation(libraryApi.apply, { secret: this.secret, userId, ops }));
  }

  public async changes(userId: string, since: number, limit: number): Promise<LibraryPage> {
    let page = await this.client.query(libraryApi.changes, { secret: this.secret, userId, since, limit });
    // A listener whose library still lives only in their profile: move it into rows (an empty
    // batch does just that), so the first sync sends everything they already have.
    if (isRecord(page) && page.seeded === false) {
      await this.apply(userId, []);
      page = await this.client.query(libraryApi.changes, { secret: this.secret, userId, since, limit });
    }
    return parsePage(page);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseApply(value: unknown): LibraryApplyResult {
  if (!isRecord(value) || typeof value.rev !== 'number') throw new Error('Unexpected library reply');
  const rejected = Array.isArray(value.rejected)
    ? value.rejected.flatMap((item) =>
        isRecord(item) && typeof item.index === 'number' && REJECT_REASONS.includes(item.reason as RejectReason)
          ? [{ index: item.index, reason: item.reason as RejectReason }]
          : []
      )
    : [];
  const removedCoverKeys = Array.isArray(value.removedCoverKeys) ? value.removedCoverKeys.filter((key): key is string => typeof key === 'string') : [];
  return { rev: value.rev, rejected, removedCoverKeys };
}

function parsePage(value: unknown): LibraryPage {
  if (!isRecord(value) || typeof value.rev !== 'number' || !Array.isArray(value.changes)) throw new Error('Unexpected library reply');
  // Built by packages/shared/library.ts toChange on the Convex side; kinds are checked, the rest passes through.
  const changes = value.changes.filter(
    (change): change is LibraryChange => isRecord(change) && (change.kind === 'like' || change.kind === 'playlist' || change.kind === 'playlist_item')
  );
  return { rev: value.rev, changes, more: value.more === true };
}
