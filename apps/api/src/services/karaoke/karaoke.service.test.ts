import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../../lib/cache.js';
import type { StreamResolver } from '../../lib/streamResolver.js';
import { CacheKaraokeAssetStore } from './asset-store.js';
import { KaraokeService } from './karaoke.service.js';
import type { KaraokeSeparationProvider, SeparationJobResult } from './providers/separation-provider.js';

class FakeProvider implements KaraokeSeparationProvider {
  public readonly name = 'fake';
  public createCalls = 0;
  private readonly jobs = new Map<string, SeparationJobResult>();

  public constructor(private readonly completeImmediately = false) {}

  public async createJob(): Promise<SeparationJobResult> {
    this.createCalls += 1;
    const jobId = `job-${this.createCalls}`;
    const result: SeparationJobResult = this.completeImmediately
      ? { status: 'completed', jobId, instrumentalUrl: 'https://cdn.example.com/inst.mp3' }
      : { status: 'queued', jobId };
    this.jobs.set(jobId, result);
    return result;
  }

  public async getJob(jobId: string): Promise<SeparationJobResult> {
    const existing = this.jobs.get(jobId);
    if (!existing) return { status: 'failed', jobId, errorCode: 'MISSING' };
    if (existing.status === 'queued') {
      const next: SeparationJobResult = {
        status: 'completed',
        jobId,
        instrumentalUrl: 'https://cdn.example.com/inst.mp3'
      };
      this.jobs.set(jobId, next);
      return next;
    }
    return existing;
  }
}

function fakeStream(url = 'https://cdn.example.com/original.mp3'): StreamResolver {
  return {
    resolveSourceUrl: async () => url
  } as unknown as StreamResolver;
}

test('karaoke cache hit does not create another provider job', async () => {
  const provider = new FakeProvider(true);
  const service = new KaraokeService({
    stream: fakeStream(),
    store: new CacheKaraokeAssetStore(new MemoryCacheStore()),
    provider,
    schedule: () => undefined
  });

  const first = await service.request('song-1');
  assert.equal(first.payload.status, 'ready');
  assert.equal(provider.createCalls, 1);

  const second = await service.request('song-1');
  assert.equal(second.payload.status, 'ready');
  assert.equal(provider.createCalls, 1);
  assert.equal(second.payload.instrumentalUrl, '/api/stream/karaoke/song-1');
});

test('concurrent karaoke requests claim a single provider job', async () => {
  const provider = new FakeProvider(false);
  const store = new CacheKaraokeAssetStore(new MemoryCacheStore());
  const scheduled: Array<() => Promise<void>> = [];
  const service = new KaraokeService({
    stream: fakeStream(),
    store,
    provider,
    schedule: (work) => {
      scheduled.push(work);
    }
  });

  const [a, b] = await Promise.all([service.request('song-2'), service.request('song-2')]);
  assert.equal(provider.createCalls, 1);
  assert.ok(a.payload.status === 'processing' || a.payload.status === 'queued');
  assert.ok(b.payload.status === 'processing' || b.payload.status === 'queued');

  for (const work of scheduled) await work();
  const ready = await service.status('song-2');
  assert.equal(ready.status, 'ready');
});

test('karaoke is unavailable without a provider', async () => {
  const service = new KaraokeService({
    stream: fakeStream(),
    store: new CacheKaraokeAssetStore(new MemoryCacheStore())
  });
  assert.equal(service.isAvailable, false);
});
