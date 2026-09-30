import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

import { TimeoutError } from '../lib/errors.js';
import { fetchUntilHeaders, isAbortError } from '../lib/fetchWithTimeout.js';

/**
 * Every Convex function the API calls. convex/ sits outside this package's rootDir, so these are
 * names rather than the generated `api`; convexGateway.test.ts checks each one is exported there.
 */
export const CONVEX_QUERIES = [
  'profiles:get',
  'profiles:byEmail',
  'profiles:identity',
  'shares:get',
  'shares:byLibrary',
  'covers:inspect',
  'library:changes'
] as const;
export const CONVEX_MUTATIONS = [
  'profiles:save',
  'shares:save',
  'shares:remove',
  'oauth:consume',
  'covers:generateUploadUrl',
  'covers:remove',
  'library:apply'
] as const;

export type ConvexQuery = (typeof CONVEX_QUERIES)[number];
export type ConvexMutation = (typeof CONVEX_MUTATIONS)[number];

/** The transport the gateway drives: ConvexHttpClient in production, a fake in tests. */
export interface ConvexClientLike {
  query(name: ConvexQuery, args: Record<string, unknown>): Promise<unknown>;
  mutation(name: ConvexMutation, args: Record<string, unknown>): Promise<unknown>;
}

export interface ConvexGatewayOptions {
  readonly url: string;
  readonly serverSecret: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly client?: ConvexClientLike;
}

/** Long enough for a large library batch (convex/library.ts reads up to ~12k rows), short of hanging a request. */
const CONVEX_TIMEOUT_MS = 15_000;

/**
 * The API's one way into Convex. Every call carries the server secret that the Convex functions
 * check, and gives up with TimeoutError after the timeout (the Convex function may still finish;
 * every mutation the API sends is safe to repeat). Mutations from different requests run in
 * parallel: ConvexHttpClient queues them by default, which on a warm function instance would
 * make every listener wait behind every other.
 */
export class ConvexGateway {
  private readonly client: ConvexClientLike;
  private readonly secret: string;
  private readonly timeoutMs: number;

  public constructor(options: ConvexGatewayOptions) {
    this.secret = options.serverSecret;
    this.timeoutMs = options.timeoutMs ?? CONVEX_TIMEOUT_MS;
    this.client = options.client ?? httpClient(options.url, this.timeoutMs, options.fetchImpl ?? fetch);
  }

  public query(name: ConvexQuery, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.withinTimeout(() => this.client.query(name, { ...args, secret: this.secret }));
  }

  public mutation(name: ConvexMutation, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.withinTimeout(() => this.client.mutation(name, { ...args, secret: this.secret }));
  }

  private async withinTimeout(call: () => Promise<unknown>): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new TimeoutError()), this.timeoutMs);
    });
    try {
      return await Promise.race([
        call().catch((error: unknown) => {
          throw isAbortError(error) ? new TimeoutError() : error;
        }),
        deadline
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function httpClient(url: string, timeoutMs: number, fetchImpl: typeof fetch): ConvexClientLike {
  // Plain HTTP with no auth token: access is gated by the secret each Convex function checks.
  // The fetch deadline cancels the request itself; the gateway's race also covers a stalled body.
  const client = new ConvexHttpClient(url, {
    fetch: async (input, init) => (await fetchUntilHeaders(input, init ?? {}, timeoutMs, fetchImpl)).response
  });
  return {
    query: (name, args) => client.query(makeFunctionReference<'query', Record<string, unknown>, unknown>(name), args),
    mutation: (name, args) =>
      client.mutation(makeFunctionReference<'mutation', Record<string, unknown>, unknown>(name), args, { skipQueue: true })
  };
}
