/**
 * Seam for vocal-removal backends. Callers only know createJob + getJob —
 * Scarleta (or a future Demucs/Fadr adapter) stays behind this interface.
 */
export interface SeparationJobInput {
  readonly audioUrl: string;
  readonly songId: string;
  readonly fingerprint: string;
}

export type SeparationJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface SeparationJobResult {
  readonly status: SeparationJobStatus;
  readonly jobId: string;
  /** Present when status is completed. */
  readonly instrumentalUrl?: string;
  /** Machine-facing reason; never shown raw to users. */
  readonly errorCode?: string;
}

export interface KaraokeSeparationProvider {
  readonly name: string;
  createJob(input: SeparationJobInput): Promise<SeparationJobResult>;
  getJob(jobId: string): Promise<SeparationJobResult>;
}
