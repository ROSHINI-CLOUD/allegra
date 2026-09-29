export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const { response } = await fetchUntilHeaders(input, init, timeoutMs, fetchImpl);
  return response;
}

export async function fetchUntilHeaders(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch
): Promise<{ response: Response; abort: () => void }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const parent = init.signal;
  const onParentAbort = (): void => controller.abort();
  if (parent) {
    if (parent.aborted) {
      controller.abort();
    } else {
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  try {
    const response = await fetchImpl(input, { ...init, signal: controller.signal });
    return { response, abort: () => controller.abort() };
  } finally {
    clearTimeout(timeout);
    parent?.removeEventListener('abort', onParentAbort);
  }
}

export interface FetchedBody {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
}

/**
 * fetchWithTimeout's deadline ends when the headers arrive; this one also covers reading the body,
 * so a server that answers and then stalls mid-body cannot hang the caller. For small JSON/text
 * responses, never for streamed audio.
 */
export async function fetchBodyWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch
): Promise<FetchedBody> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(input, { ...init, signal: controller.signal });
    return { ok: response.ok, status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}
