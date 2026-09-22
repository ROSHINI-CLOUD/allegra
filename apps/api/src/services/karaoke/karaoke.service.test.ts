import assert from 'node:assert/strict';
import test from 'node:test';

import type { BatchClient } from '@aws-sdk/client-batch';
import type { S3Client } from '@aws-sdk/client-s3';

import { MemoryCacheStore } from '../../lib/cache.js';
import type { StreamResolver } from '../../lib/streamResolver.js';
import { CacheKaraokeAssetStore } from './asset-store.js';
import { KaraokeService, fingerprintFor } from './karaoke.service.js';
import {
  AwsBatchStemSeparationProvider,
  CLAIM_STALE_MS,
  classifyBatchFailure,
  keySegment,
  stemObjectKeys
} from './providers/aws-batch.provider.js';

const VERSION = 'test-v1';
const SOURCE_URL = 'https://cdn.example.com/audio/original.mp4?token=abc';

/** Minimal in-memory S3 honouring If-Match / If-None-Match, like the real service. */
class FakeS3 {
  public readonly objects = new Map<string, { body: string; etag: string }>();
  private counter = 0;

  public async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<unknown> {
    const name = command.constructor.name;
    const input = command.input;
    const key = String(input.Key);
    // Yield so concurrent callers genuinely interleave; the check-and-write below is
    // then synchronous, matching S3's atomic conditional writes.
    await Promise.resolve();
    const existing = this.objects.get(key);

    if (name === 'PutObjectCommand') {
      if (input.IfNoneMatch === '*' && existing) throw httpError(412, 'PreconditionFailed');
      if (typeof input.IfMatch === 'string' && existing?.etag !== input.IfMatch) throw httpError(412, 'PreconditionFailed');
      const etag = `"e${(this.counter += 1)}"`;
      const body = typeof input.Body === 'string' ? input.Body : `bytes:${(input.Body as Uint8Array).byteLength}`;
      this.objects.set(key, { body, etag });
      return { ETag: etag };
    }
    if (name === 'HeadObjectCommand') {
      if (!existing) throw httpError(404, 'NotFound');
      return {};
    }
    if (name === 'GetObjectCommand') {
      if (!existing) throw httpError(404, 'NoSuchKey');
      return { ETag: existing.etag, Body: { transformToString: async () => existing.body } };
    }
    if (name === 'DeleteObjectCommand') {
      this.objects.delete(key);
      return {};
    }
    throw new Error(`unexpected S3 command ${name}`);
  }
}

class FakeBatch {
  public submitted: Array<Record<string, unknown>> = [];
  private readonly states = new Map<string, { status: string; statusReason?: string; exitCode?: number }>();

  /** Sets Batch's reported state for one job (new jobs start RUNNABLE). */
  public setJob(jobId: string, state: { status: string; statusReason?: string; exitCode?: number }): void {
    this.states.set(jobId, state);
  }

  public async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<unknown> {
    if (command.constructor.name === 'SubmitJobCommand') {
      await Promise.resolve();
      this.submitted.push(command.input);
      return { jobId: `job-${this.submitted.length}` };
    }
    if (command.constructor.name === 'DescribeJobsCommand') {
      const jobId = (command.input.jobs as string[])[0] ?? '';
      const state = this.states.get(jobId) ?? { status: 'RUNNABLE' };
      return {
        jobs: [
          {
            status: state.status,
            ...(state.statusReason ? { statusReason: state.statusReason } : {}),
            ...(state.exitCode !== undefined ? { container: { exitCode: state.exitCode } } : {})
          }
        ]
      };
    }
    throw new Error(`unexpected Batch command ${command.constructor.name}`);
  }
}

function httpError(status: number, name: string): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

function fakeStream(url = SOURCE_URL): StreamResolver {
  return { resolveSourceUrl: async () => url } as unknown as StreamResolver;
}

function fakeFetch(): typeof fetch {
  return (async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'audio/mp4', 'content-length': '4' }
    })) as unknown as typeof fetch;
}

function build(options: { s3?: FakeS3; batch?: FakeBatch; now?: () => number } = {}) {
  const s3 = options.s3 ?? new FakeS3();
  const batch = options.batch ?? new FakeBatch();
  const provider = new AwsBatchStemSeparationProvider({
    region: 'ap-south-1',
    jobQueue: 'queue',
    jobDefinition: 'jobdef',
    bucket: 'bucket',
    separationVersion: VERSION,
    fetchImpl: fakeFetch(),
    s3Client: s3 as unknown as S3Client,
    batchClient: batch as unknown as BatchClient,
    ...(options.now ? { now: options.now } : {})
  });
  // A fresh service + cache per call models a brand-new serverless instance.
  const service = (): KaraokeService =>
    new KaraokeService({
      stream: fakeStream(),
      store: new CacheKaraokeAssetStore(new MemoryCacheStore(), VERSION),
      provider
    });
  return { s3, batch, provider, service };
}

function finishJob(s3: FakeS3, songId: string): void {
  const keys = stemObjectKeys(songId, fingerprintFor(SOURCE_URL), VERSION);
  s3.objects.set(keys.vocals, { body: 'v', etag: '"v"' });
  s3.objects.set(keys.instrumental, { body: 'i', etag: '"i"' });
  s3.objects.set(keys.manifest, { body: '{}', etag: '"m"' });
}

test('first request submits exactly one Batch job and reports queued', async () => {
  const { batch, service } = build();
  const { payload, accepted } = await service().request('song-1');
  assert.equal(accepted, true);
  assert.equal(payload.status, 'queued');
  assert.equal(batch.submitted.length, 1);

  const env = (batch.submitted[0]?.containerOverrides as { environment: Array<{ name: string; value: string }> }).environment;
  assert.equal(env.find((e) => e.name === 'SEPARATION_VERSION')?.value, VERSION);
  assert.equal(env.find((e) => e.name === 'TRACK_ID')?.value, 'song-1');
});

test('20 simultaneous requests across separate instances create ONE Batch job', async () => {
  const { batch, service } = build();
  const results = await Promise.all(Array.from({ length: 20 }, () => service().request('song-2')));

  assert.equal(batch.submitted.length, 1);
  for (const result of results) {
    assert.ok(result.payload.status === 'queued' || result.payload.status === 'processing');
    assert.equal(result.accepted, true);
  }
});

test('status follows Batch: queued → processing → ready with both stems', async () => {
  const { s3, batch, service } = build();
  const instance = service();
  await instance.request('song-3');

  assert.equal((await instance.status('song-3')).status, 'queued');
  batch.setJob('job-1', { status: 'RUNNING' });
  assert.equal((await instance.status('song-3')).status, 'processing');

  batch.setJob('job-1', { status: 'SUCCEEDED' });
  finishJob(s3, 'song-3');
  const ready = await instance.status('song-3');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.instrumentalUrl, '/api/stream/karaoke/song-3/instrumental');
  assert.equal(ready.vocalsUrl, '/api/stream/karaoke/song-3/vocals');
});

test('ready stems survive a full restart with no new Batch job', async () => {
  const { s3, batch, service } = build();
  await service().request('song-4');
  batch.setJob('job-1', { status: 'SUCCEEDED' });
  finishJob(s3, 'song-4');
  assert.equal((await service().status('song-4')).status, 'ready');

  // Brand-new service + empty cache = restarted backend / another user's instance.
  const again = await service().request('song-4');
  assert.equal(again.payload.status, 'ready');
  assert.equal(again.accepted, false);
  assert.equal(batch.submitted.length, 1);
});

test('stems already in S3 are reused even when no job record exists', async () => {
  const { s3, batch, service } = build();
  finishJob(s3, 'song-5');
  const result = await service().request('song-5');
  assert.equal(result.payload.status, 'ready');
  assert.equal(batch.submitted.length, 0);
});

test('a re-signed source URL is the same song and does not re-separate', () => {
  assert.equal(
    fingerprintFor('https://cdn.example.com/a/b.mp4?token=1'),
    fingerprintFor('https://cdn.example.com/a/b.mp4?token=2')
  );
  assert.notEqual(fingerprintFor('https://cdn.example.com/a/b.mp4'), fingerprintFor('https://cdn.example.com/a/c.mp4'));
});

test('a failed job can be retried once, by exactly one caller', async () => {
  const { batch, service } = build();
  await service().request('song-6');
  batch.setJob('job-1', { status: 'FAILED', exitCode: 11 });

  const failed = await service().status('song-6');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.retryable, true);

  await Promise.all(Array.from({ length: 10 }, () => service().request('song-6')));
  assert.equal(batch.submitted.length, 2);
});

test('a claim whose owner died before submitting is taken over after the stale window', async () => {
  let clock = 1_000_000;
  const { s3, batch, service } = build({ now: () => clock });
  const stateKey = `karaoke-state/song-7/${fingerprintFor(SOURCE_URL)}/${VERSION}.json`;
  s3.objects.set(stateKey, {
    body: JSON.stringify({
      songId: 'song-7',
      sourceFingerprint: fingerprintFor(SOURCE_URL),
      separationVersion: VERSION,
      claimedAt: new Date(clock).toISOString(),
      attempt: 1
    }),
    etag: '"stale"'
  });

  // Fresh claim: waiting, no takeover.
  assert.equal((await service().request('song-7')).payload.status, 'queued');
  assert.equal(batch.submitted.length, 0);

  clock += CLAIM_STALE_MS + 1_000;
  await Promise.all(Array.from({ length: 5 }, () => service().request('song-7')));
  assert.equal(batch.submitted.length, 1);
});

test('song ids with path characters cannot shape S3 prefixes', () => {
  assert.equal(keySegment('abc_DEF-123'), 'abc_DEF-123');
  const hostile = keySegment('../other/track');
  assert.match(hostile, /^h-[0-9a-f]{24}$/);
  assert.ok(!hostile.includes('/'));
});

test('batch failures are classified for retry policy', () => {
  assert.equal(classifyBatchFailure('Host EC2 (instance i-1) terminated.'), 'SPOT_INTERRUPTION');
  assert.equal(classifyBatchFailure('Job attempt duration exceeded timeout of 3600 seconds'), 'TIMEOUT');
  assert.equal(classifyBatchFailure(undefined, undefined, 10), 'INVALID_AUDIO');
  assert.equal(classifyBatchFailure(undefined, undefined, 12), 'UPLOAD_FAILURE');
  assert.equal(classifyBatchFailure(undefined, undefined, 1), 'MODEL_FAILURE');
});

test('karaoke is unavailable without a provider', () => {
  const service = new KaraokeService({
    stream: fakeStream(),
    store: new CacheKaraokeAssetStore(new MemoryCacheStore(), VERSION)
  });
  assert.equal(service.isAvailable, false);
});
