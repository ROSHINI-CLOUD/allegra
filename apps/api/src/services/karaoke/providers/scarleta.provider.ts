import { fetchWithTimeout, isAbortError } from '../../../lib/fetchWithTimeout.js';
import { ProviderUnavailableError, TimeoutError } from '../../../lib/errors.js';
import { parsePublicHttpsUrl } from '../../../lib/publicUrl.js';
import type {
  KaraokeSeparationProvider,
  SeparationJobInput,
  SeparationJobResult,
  SeparationJobStatus
} from './separation-provider.js';

const DEFAULT_BASE = 'https://api.scarleta.ai';
const REQUEST_TIMEOUT_MS = 25_000;

export interface ScarletaProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Scarleta Chat / Agent API (free-key compatible):
 * POST /v1/chat  → job_id
 * GET  /v1/chat/:job_id → status + result
 */
export class ScarletaKaraokeProvider implements KaraokeSeparationProvider {
  public readonly name = 'scarleta';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: ScarletaProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async createJob(input: SeparationJobInput): Promise<SeparationJobResult> {
    const response = await this.request('/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: 'Remove the vocals from this track and return the instrumental / accompaniment / no-vocals audio only.',
        audio_url: input.audioUrl
      })
    });
    const body = asRecord(await response.json().catch(() => null));
    const jobId = stringField(body, 'job_id') ?? stringField(body, 'id');
    if (!jobId) {
      throw new ProviderUnavailableError('Scarleta did not return a job id.');
    }
    const instrumentalUrl = extractInstrumentalUrl(body);
    return {
      status: mapStatus(stringField(body, 'status') ?? 'IN_QUEUE'),
      jobId,
      ...(instrumentalUrl ? { instrumentalUrl } : {})
    };
  }

  public async getJob(jobId: string): Promise<SeparationJobResult> {
    const response = await this.request(`/v1/chat/${encodeURIComponent(jobId)}`, { method: 'GET' });
    const body = asRecord(await response.json().catch(() => null));
    const status = mapStatus(stringField(body, 'status') ?? 'PROCESSING');
    const instrumentalUrl = extractInstrumentalUrl(body);
    const errorCode = stringField(body, 'error') ?? stringField(body, 'error_code');
    if (status === 'failed') {
      return errorCode ? { status, jobId, errorCode } : { status, jobId };
    }
    if (status === 'completed' && !instrumentalUrl) {
      return { status: 'failed', jobId, errorCode: 'MISSING_INSTRUMENTAL_URL' };
    }
    return {
      status,
      jobId,
      ...(instrumentalUrl ? { instrumentalUrl } : {}),
      ...(errorCode ? { errorCode } : {})
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}${path}`,
        {
          ...init,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers
          }
        },
        REQUEST_TIMEOUT_MS,
        this.fetchImpl
      );
      if (response.status === 401 || response.status === 403) {
        throw new ProviderUnavailableError('SCARLETA_AUTH');
      }
      if (response.status === 402 || response.status === 429) {
        throw new ProviderUnavailableError('SCARLETA_BALANCE_EXHAUSTED');
      }
      if (!response.ok && response.status !== 202) {
        throw new ProviderUnavailableError(`SCARLETA_HTTP_${response.status}`);
      }
      return response;
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      if (isAbortError(error)) throw new TimeoutError();
      throw new ProviderUnavailableError();
    }
  }
}

function mapStatus(raw: string): SeparationJobStatus {
  const value = raw.trim().toUpperCase();
  if (value === 'COMPLETED' || value === 'COMPLETE' || value === 'SUCCESS' || value === 'READY') return 'completed';
  if (value === 'FAILED' || value === 'ERROR' || value === 'CANCELLED' || value === 'CANCELED') return 'failed';
  if (value === 'IN_QUEUE' || value === 'QUEUED' || value === 'PENDING') return 'queued';
  return 'processing';
}

function extractInstrumentalUrl(body: Record<string, unknown>): string | undefined {
  const direct =
    stringField(body, 'instrumental_url') ??
    stringField(body, 'audio_url') ??
    stringField(body, 'output_url') ??
    stringField(body, 'url');
  if (direct && isHttps(direct)) return direct;

  const result = asRecord(body.result);
  const fromResult =
    stringField(result, 'instrumental_url') ??
    stringField(result, 'audio_url') ??
    stringField(result, 'output_url') ??
    stringField(result, 'url');
  if (fromResult && isHttps(fromResult)) return fromResult;

  const files = result.files ?? body.files;
  if (Array.isArray(files)) {
    for (const file of files) {
      const record = asRecord(file);
      const url = stringField(record, 'url') ?? stringField(record, 'audio_url');
      const kind = (stringField(record, 'type') ?? stringField(record, 'label') ?? stringField(record, 'name') ?? '').toLowerCase();
      if (url && isHttps(url) && (kind.includes('instrumental') || kind.includes('no-vocal') || kind.includes('accompaniment') || !kind)) {
        return url;
      }
    }
  }
  return undefined;
}

function isHttps(value: string): boolean {
  try {
    parsePublicHttpsUrl(value);
    return true;
  } catch {
    return false;
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
