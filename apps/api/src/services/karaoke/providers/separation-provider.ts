/**
 * Seam for vocal-separation backends. KaraokeService only knows this interface —
 * AWS Batch (or a future adapter) stays behind it.
 *
 * Providers own durable job identity: the API runs on stateless serverless
 * functions, so "does a job already exist for this song?" must be answerable
 * from the backend itself, never from in-process memory.
 */
export interface SeparationJobInput {
  readonly audioUrl: string;
  readonly songId: string;
  readonly fingerprint: string;
}

/** Identity of one separation: same song + same source + same version = same stems. */
export interface SeparationIdentity {
  readonly songId: string;
  readonly fingerprint: string;
}

export type SeparationJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface SeparationJobResult {
  readonly status: SeparationJobStatus;
  readonly jobId: string;
  /** Present when status is completed — HTTPS URL the stream proxy can fetch. */
  readonly instrumentalUrl?: string;
  /** Present when status is completed — HTTPS URL the stream proxy can fetch. */
  readonly vocalsUrl?: string;
  /** Private object key for instrumental (preferred over public URL). */
  readonly instrumentalObjectKey?: string;
  /** Private object key for vocals. */
  readonly vocalsObjectKey?: string;
  /** Machine-facing reason; never shown raw to users. */
  readonly errorCode?: string;
}

export interface OpenedStem {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly abort: () => void;
}

export interface KaraokeSeparationProvider {
  readonly name: string;
  /** Model/pipeline version baked into stem identity. */
  readonly separationVersion: string;
  readonly separationModel?: string;

  /**
   * Current durable state for this identity, or null when no job was ever started.
   * Reconciles with the backend (e.g. Batch DescribeJobs) — safe to call on every poll.
   */
  findJob(identity: SeparationIdentity): Promise<SeparationJobResult | null>;

  /**
   * Idempotent start. Returns the existing job when one is already completed or
   * in flight; only one caller across all instances ever starts a fresh job.
   */
  createJob(input: SeparationJobInput): Promise<SeparationJobResult>;

  /** Opens a stem's bytes for the stream proxy (Range aware). Optional for URL-only providers. */
  openStem?(objectKey: string, range: string | undefined): Promise<OpenedStem>;
}
