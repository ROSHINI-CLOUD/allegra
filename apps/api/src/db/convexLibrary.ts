import type { LibraryChange, LibraryOp, RejectReason } from '../shared/library.js';
import type { LibraryApplyResult, LibraryPage, LibraryStore } from '../user/library.js';
import type { ConvexGateway } from './convexGateway.js';

const REJECT_REASONS: readonly RejectReason[] = ['bad_time', 'no_playlist', 'missing_name'];

/** Library sync in Convex: one transaction per batch, rules in packages/shared/library.ts. */
export class ConvexLibraryStore implements LibraryStore {
  public constructor(private readonly convex: ConvexGateway) {}

  public async apply(userId: string, ops: readonly LibraryOp[]): Promise<LibraryApplyResult> {
    return parseApply(await this.convex.mutation('library:apply', { userId, ops }));
  }

  public async changes(userId: string, since: number, limit: number): Promise<LibraryPage> {
    let page = await this.convex.query('library:changes', { userId, since, limit });
    // A listener whose library still lives only in their profile: move it into rows (an empty
    // batch does just that), so the first sync sends everything they already have.
    if (isRecord(page) && page.seeded === false) {
      await this.apply(userId, []);
      page = await this.convex.query('library:changes', { userId, since, limit });
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
