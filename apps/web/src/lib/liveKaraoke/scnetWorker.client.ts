import type { ScnetAvailability } from './types';
import type { ScnetWorkerRequest, ScnetWorkerResponse } from './scnetWorker';

let cached: ScnetAvailability | null = null;

/**
 * Probe SCNet availability via a short-lived worker.
 * Never throws — returns available: false on any failure.
 */
export async function probeScnetAvailability(): Promise<ScnetAvailability> {
  if (cached) return cached;

  if (typeof Worker === 'undefined') {
    cached = { available: false, reason: 'Web Workers unavailable' };
    return cached;
  }

  try {
    const worker = new Worker(new URL('./scnetWorker.ts', import.meta.url), {
      type: 'module'
    });

    const result = await new Promise<ScnetAvailability>((resolve) => {
      const timer = window.setTimeout(() => {
        worker.terminate();
        resolve({ available: false, reason: 'SCNet probe timed out' });
      }, 8_000);

      worker.onmessage = (event: MessageEvent<ScnetWorkerResponse>) => {
        window.clearTimeout(timer);
        worker.terminate();
        const data = event.data;
        if (data.type === 'probe') {
          resolve({
            available: data.available,
            ...(data.reason ? { reason: data.reason } : {})
          });
          return;
        }
        resolve({ available: false, reason: 'Unexpected worker response' });
      };

      worker.onerror = () => {
        window.clearTimeout(timer);
        worker.terminate();
        resolve({ available: false, reason: 'SCNet worker failed to start' });
      };

      const req: ScnetWorkerRequest = { type: 'probe' };
      worker.postMessage(req);
    });

    cached = result;
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'SCNet probe failed';
    cached = { available: false, reason };
    return cached;
  }
}

export function resetScnetProbeCache(): void {
  cached = null;
}
