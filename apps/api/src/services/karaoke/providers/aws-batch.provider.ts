import { createHash } from 'node:crypto';

import { BatchClient, DescribeJobsCommand, SubmitJobCommand } from '@aws-sdk/client-batch';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

import { ProviderUnavailableError } from '../../../lib/errors.js';
import { fetchUntilHeaders, isAbortError } from '../../../lib/fetchWithTimeout.js';
import type {
  KaraokeSeparationProvider,
  OpenedStem,
  SeparationIdentity,
  SeparationJobInput,
  SeparationJobResult,
  SeparationJobStatus
} from './separation-provider.js';

const STAGE_TIMEOUT_MS = 60_000;
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
/** A claim with no Batch job id this old means the claimer died before submitting. */
export const CLAIM_STALE_MS = 120_000;
const DEFAULT_MODEL = 'htdemucs';

/** Worker exit codes — keep in sync with workers/stem-separator/worker.py. */
const EXIT_CODE_ERRORS: Readonly<Record<number, string>> = {
  10: 'INVALID_AUDIO',
  11: 'MODEL_FAILURE',
  12: 'UPLOAD_FAILURE',
  13: 'OUTPUT_MISMATCH'
};

export interface AwsBatchProviderOptions {
  readonly region: string;
  readonly jobQueue: string;
  readonly jobDefinition: string;
  readonly bucket: string;
  readonly separationVersion: string;
  readonly stemModel?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly batchClient?: BatchClient;
  readonly s3Client?: S3Client;
  /** Injectable clock for stale-claim tests. */
  readonly now?: () => number;
}

/** Durable per-identity state, stored in S3 so every serverless instance agrees. */
interface StateMarker {
  readonly songId: string;
  readonly sourceFingerprint: string;
  readonly separationVersion: string;
  readonly claimedAt: string;
  readonly attempt: number;
  readonly jobId?: string;
}

interface StoredMarker {
  readonly marker: StateMarker;
  readonly etag: string;
}

/**
 * Stages source audio into private S3 and submits exactly one AWS Batch GPU job
 * per (song, source, version).
 *
 * Truth lives in AWS, not in this process:
 *   - manifest.json exists            → stems are ready (worker writes it last)
 *   - karaoke-state marker + Batch    → job in flight / failed
 *   - S3 conditional write (If-None-Match / If-Match) is the cross-instance lock
 */
export class AwsBatchStemSeparationProvider implements KaraokeSeparationProvider {
  public readonly name = 'aws-batch';
  public readonly separationVersion: string;
  public readonly separationModel: string;
  private readonly jobQueue: string;
  private readonly jobDefinition: string;
  private readonly bucket: string;
  private readonly fetchImpl: typeof fetch;
  private readonly batch: BatchClient;
  private readonly s3: S3Client;
  private readonly now: () => number;

  public constructor(options: AwsBatchProviderOptions) {
    this.jobQueue = options.jobQueue;
    this.jobDefinition = options.jobDefinition;
    this.bucket = options.bucket;
    this.separationVersion = options.separationVersion;
    this.separationModel = options.stemModel?.trim() || DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;

    const credentials =
      options.accessKeyId && options.secretAccessKey
        ? {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
            ...(options.sessionToken ? { sessionToken: options.sessionToken } : {})
          }
        : undefined;
    const clientConfig = { region: options.region, ...(credentials ? { credentials } : {}) };
    this.batch = options.batchClient ?? new BatchClient(clientConfig);
    this.s3 = options.s3Client ?? new S3Client(clientConfig);
  }

  public async findJob(identity: SeparationIdentity): Promise<SeparationJobResult | null> {
    const stored = await this.readMarker(identity);
    return (await this.inspect(identity, stored)) ?? null;
  }

  public async createJob(input: SeparationJobInput): Promise<SeparationJobResult> {
    const identity = { songId: input.songId, fingerprint: input.fingerprint };
    const stored = await this.readMarker(identity);
    const current = await this.inspect(identity, stored);
    // Ready, queued, or running: never start a second job.
    if (current && current.status !== 'failed') return current;

    const claim = await this.tryClaim(identity, stored);
    if (!claim) {
      // Another instance won the race between our read and write.
      return (await this.inspect(identity, await this.readMarker(identity))) ?? { status: 'queued', jobId: 'pending' };
    }

    try {
      await this.stageSource(input.audioUrl, inputObjectKey(input.songId, input.fingerprint));
      const jobId = await this.submit(identity);
      await this.writeMarker(
        identity,
        { ...claim.marker, jobId },
        { ifMatch: claim.etag },
        // If a stale-claim takeover beat us here, the job is already submitted and
        // deterministic output keys make it idempotent — ignore the lost race.
        true
      );
      return { status: 'queued', jobId };
    } catch (error) {
      await this.releaseClaim(identity);
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError('BATCH_SUBMIT_FAILED');
    }
  }

  /** Authenticated GetObject for the stream proxy (Range → 206 preserved). */
  public async openStem(key: string, range: string | undefined): Promise<OpenedStem> {
    const controller = new AbortController();
    try {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(range ? { Range: range } : {}) }),
        { abortSignal: controller.signal }
      );
      const headers = new Headers();
      if (response.ContentType) headers.set('content-type', response.ContentType);
      if (response.ContentLength !== undefined) headers.set('content-length', String(response.ContentLength));
      if (response.ContentRange) headers.set('content-range', response.ContentRange);
      headers.set('accept-ranges', response.AcceptRanges ?? 'bytes');
      const body = response.Body ? (response.Body.transformToWebStream() as ReadableStream<Uint8Array>) : null;
      return { status: response.ContentRange ? 206 : 200, headers, body, abort: () => controller.abort() };
    } catch (error) {
      if (httpStatus(error) === 416) {
        return { status: 416, headers: new Headers(), body: null, abort: () => undefined };
      }
      throw error;
    }
  }

  private async inspect(
    identity: SeparationIdentity,
    stored: StoredMarker | null
  ): Promise<SeparationJobResult | null> {
    const keys = this.stemKeys(identity);
    if (await this.exists(keys.manifest)) {
      return {
        status: 'completed',
        jobId: stored?.marker.jobId ?? 'completed',
        instrumentalObjectKey: keys.instrumental,
        vocalsObjectKey: keys.vocals
      };
    }
    if (!stored) return null;

    const { jobId, claimedAt } = stored.marker;
    if (!jobId) {
      // Claim without a job id: claimer is mid-submit, or died.
      const age = this.now() - Date.parse(claimedAt);
      return age > CLAIM_STALE_MS ? null : { status: 'queued', jobId: 'pending' };
    }

    let described;
    try {
      described = await this.batch.send(new DescribeJobsCommand({ jobs: [jobId] }));
    } catch {
      throw new ProviderUnavailableError('BATCH_DESCRIBE_FAILED');
    }
    const job = described.jobs?.[0];
    if (!job) return { status: 'failed', jobId, errorCode: 'BATCH_JOB_MISSING' };

    const mapped = mapBatchStatus(job.status);
    if (mapped === 'failed') {
      return {
        status: 'failed',
        jobId,
        errorCode: classifyBatchFailure(job.statusReason, job.container?.reason, job.container?.exitCode)
      };
    }
    if (mapped === 'completed') {
      // Worker writes the manifest before exiting 0; SUCCEEDED without it is a bad run.
      return { status: 'failed', jobId, errorCode: 'OUTPUT_MISSING' };
    }
    return { status: mapped, jobId };
  }

  /** Atomic claim: only one caller across all instances gets a non-null result. */
  private async tryClaim(identity: SeparationIdentity, stored: StoredMarker | null): Promise<StoredMarker | null> {
    const marker: StateMarker = {
      songId: identity.songId,
      sourceFingerprint: identity.fingerprint,
      separationVersion: this.separationVersion,
      claimedAt: new Date(this.now()).toISOString(),
      attempt: (stored?.marker.attempt ?? 0) + 1
    };
    const etag = await this.writeMarker(identity, marker, stored ? { ifMatch: stored.etag } : { ifNoneMatch: true });
    return etag ? { marker, etag } : null;
  }

  private async writeMarker(
    identity: SeparationIdentity,
    marker: StateMarker,
    condition: { ifMatch?: string; ifNoneMatch?: boolean },
    tolerateLostRace = false
  ): Promise<string | null> {
    try {
      const result = await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.stateKey(identity),
          Body: JSON.stringify(marker),
          ContentType: 'application/json',
          ...(condition.ifMatch ? { IfMatch: condition.ifMatch } : {}),
          ...(condition.ifNoneMatch ? { IfNoneMatch: '*' } : {})
        })
      );
      return result.ETag ?? '';
    } catch (error) {
      const status = httpStatus(error);
      if (status === 412 || status === 409) return null;
      if (tolerateLostRace) return null;
      throw error;
    }
  }

  private async readMarker(identity: SeparationIdentity): Promise<StoredMarker | null> {
    try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.stateKey(identity) }));
      const text = (await response.Body?.transformToString()) ?? '';
      const marker = JSON.parse(text) as StateMarker;
      return { marker, etag: response.ETag ?? '' };
    } catch (error) {
      if (isMissing(error)) return null;
      throw new ProviderUnavailableError('STATE_READ_FAILED');
    }
  }

  private async releaseClaim(identity: SeparationIdentity): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.stateKey(identity) }));
    } catch {
      // Stale-claim takeover recovers if this fails.
    }
  }

  private async submit(identity: SeparationIdentity): Promise<string> {
    const trackId = keySegment(identity.songId);
    const sourceObject = inputObjectKey(identity.songId, identity.fingerprint);
    const submitted = await this.batch.send(
      new SubmitJobCommand({
        jobName: `kara-${trackId}-${identity.fingerprint}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128),
        jobQueue: this.jobQueue,
        jobDefinition: this.jobDefinition,
        containerOverrides: {
          environment: [
            { name: 'TRACK_ID', value: trackId },
            { name: 'SOURCE_OBJECT', value: sourceObject },
            { name: 'SOURCE_FINGERPRINT', value: identity.fingerprint },
            { name: 'STEM_MODEL', value: this.separationModel },
            { name: 'SEPARATION_VERSION', value: this.separationVersion },
            { name: 'KARAOKE_S3_BUCKET', value: this.bucket }
          ]
        }
      })
    );
    if (!submitted.jobId) throw new ProviderUnavailableError('BATCH_SUBMIT_NO_ID');
    return submitted.jobId;
  }

  private async stageSource(audioUrl: string, key: string): Promise<void> {
    if (await this.exists(key)) return;

    let upstream: { response: Response; abort: () => void };
    try {
      upstream = await fetchUntilHeaders(audioUrl, {}, STAGE_TIMEOUT_MS, this.fetchImpl);
    } catch (error) {
      throw new ProviderUnavailableError(isAbortError(error) ? 'SOURCE_FETCH_TIMEOUT' : 'SOURCE_FETCH_FAILED');
    }
    const declared = Number(upstream.response.headers.get('content-length') ?? 0);
    if (!upstream.response.ok || !upstream.response.body || declared > MAX_SOURCE_BYTES) {
      upstream.abort();
      throw new ProviderUnavailableError('SOURCE_FETCH_FAILED');
    }
    const bytes = new Uint8Array(await upstream.response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) {
      throw new ProviderUnavailableError('SOURCE_FETCH_FAILED');
    }
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: upstream.response.headers.get('content-type') ?? 'audio/mpeg'
      })
    );
  }

  private async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw new ProviderUnavailableError('STATE_READ_FAILED');
    }
  }

  private stateKey(identity: SeparationIdentity): string {
    return `karaoke-state/${keySegment(identity.songId)}/${identity.fingerprint}/${this.separationVersion}.json`;
  }

  private stemKeys(identity: SeparationIdentity): { vocals: string; instrumental: string; manifest: string } {
    return stemObjectKeys(identity.songId, identity.fingerprint, this.separationVersion);
  }
}

/** Song ids come from a provider and may contain `/` — never let them shape S3 prefixes. */
export function keySegment(songId: string): string {
  if (/^[A-Za-z0-9_-]{1,64}$/.test(songId)) return songId;
  return `h-${createHash('sha256').update(songId).digest('hex').slice(0, 24)}`;
}

export function inputObjectKey(songId: string, fingerprint: string): string {
  return `karaoke-input/${keySegment(songId)}/${fingerprint}.audio`;
}

export function stemObjectKeys(
  songId: string,
  fingerprint: string,
  separationVersion: string
): { vocals: string; instrumental: string; manifest: string } {
  const prefix = `karaoke/${keySegment(songId)}/${fingerprint}/${separationVersion}`;
  return {
    vocals: `${prefix}/vocals.m4a`,
    instrumental: `${prefix}/instrumental.m4a`,
    manifest: `${prefix}/manifest.json`
  };
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const meta = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return meta?.httpStatusCode;
}

function isMissing(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined;
  return httpStatus(error) === 404 || name === 'NoSuchKey' || name === 'NotFound';
}

function mapBatchStatus(status: string | undefined): SeparationJobStatus {
  switch (status) {
    case 'SUBMITTED':
    case 'PENDING':
    case 'RUNNABLE':
    case 'STARTING':
      return 'queued';
    case 'SUCCEEDED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    default:
      return 'processing';
  }
}

export function classifyBatchFailure(
  statusReason?: string,
  containerReason?: string,
  exitCode?: number
): string {
  const text = `${statusReason ?? ''} ${containerReason ?? ''}`.toLowerCase();
  if (text.includes('host ec2') || text.includes('spot') || text.includes('interrupted')) return 'SPOT_INTERRUPTION';
  if (text.includes('timeout') || text.includes('timed out') || text.includes('duration exceeded')) return 'TIMEOUT';
  if (text.includes('capacity') || text.includes('unable to place') || text.includes('cancel')) return 'AWS_CAPACITY';
  if (text.includes('cannotpull')) return 'IMAGE_PULL_FAILED';
  if (exitCode !== undefined && EXIT_CODE_ERRORS[exitCode]) return EXIT_CODE_ERRORS[exitCode];
  return 'MODEL_FAILURE';
}
