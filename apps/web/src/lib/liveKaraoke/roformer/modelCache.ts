import { ROFORMER_MODEL } from './config';

export type ModelProgress = {
  readonly phase: 'checking' | 'downloading' | 'caching' | 'ready' | 'error';
  readonly file?: string;
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
  readonly ratio: number;
  readonly message?: string;
};

const OPFS_DIR = 'allegra-roformer-v1';

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readOpfsFile(name: string): Promise<ArrayBuffer | null> {
  try {
    const dir = await opfsRoot();
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return file.arrayBuffer();
  } catch {
    return null;
  }
}

async function writeOpfsFile(name: string, data: ArrayBuffer): Promise<void> {
  const dir = await opfsRoot();
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

/** Bytes the downloaded model takes in this browser's private storage; 0 when none or unknown. */
export async function roformerCacheBytes(): Promise<number> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR);
    let total = 0;
    for (const name of [ROFORMER_MODEL.graphFile, ROFORMER_MODEL.dataFile]) {
      try {
        total += (await (await dir.getFileHandle(name)).getFile()).size;
      } catch {
        // Not downloaded (or partly): count what is there.
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Delete the downloaded model. A model already loaded this visit keeps working until the
 * page reloads; the next Karaoke start downloads it again.
 */
export async function clearRoformerCache(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`Model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body) return res.arrayBuffer();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total || loaded);
    }
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out.buffer;
}

/** Graph + weights exactly as ORT wants them: bytes in memory, or same-origin URLs. */
export interface RoformerModelFiles {
  readonly graph: Uint8Array | string;
  readonly data: Uint8Array | string;
  readonly fromCache: boolean;
}

/**
 * A vendored copy counts only if it is really the model. Next's catch-all answers any
 * unknown path with the app's HTML and a 200, which would otherwise pass for the graph.
 */
async function hasLocalModel(path: string, bytes: number, signal?: AbortSignal): Promise<boolean> {
  try {
    const head = await fetch(path, { method: 'HEAD', signal });
    const type = head.headers.get('content-type') ?? '';
    return (
      head.ok &&
      !type.includes('text/html') &&
      Number(head.headers.get('content-length') || 0) === bytes
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the RoFormer graph and its external weights. Order: vendored files under
 * `/models/roformer/`, then the OPFS cache, then a verified download from the pinned
 * Hugging Face commit (cached to OPFS for next time).
 */
export async function ensureRoformerModel(
  onProgress?: (p: ModelProgress) => void,
  signal?: AbortSignal
): Promise<RoformerModelFiles> {
  onProgress?.({ phase: 'checking', ratio: 0.02 });

  // Absolute: inside a worker a relative path resolves against the worker script, not the site.
  const localDir = `${globalThis.location.origin}/models/roformer`;
  const localGraph = `${localDir}/${ROFORMER_MODEL.graphFile}`;
  const localData = `${localDir}/${ROFORMER_MODEL.dataFile}`;
  if (
    (await hasLocalModel(localGraph, ROFORMER_MODEL.graphBytes, signal)) &&
    (await hasLocalModel(localData, ROFORMER_MODEL.dataBytes, signal))
  ) {
    onProgress?.({ phase: 'ready', ratio: 1, message: 'Using local model' });
    return { graph: localGraph, data: localData, fromCache: true };
  }

  const cachedGraph = await readOpfsFile(ROFORMER_MODEL.graphFile);
  const cachedData = await readOpfsFile(ROFORMER_MODEL.dataFile);
  if (
    cachedGraph &&
    cachedData &&
    cachedData.byteLength === ROFORMER_MODEL.dataBytes &&
    (await sha256Hex(cachedGraph)) === ROFORMER_MODEL.graphSha256
  ) {
    // Weights were hashed when written; a size check catches a truncated write
    // without re-hashing 740 MB on every play.
    onProgress?.({ phase: 'ready', ratio: 1, message: 'OPFS cache verified' });
    return {
      graph: new Uint8Array(cachedGraph),
      data: new Uint8Array(cachedData),
      fromCache: true
    };
  }

  onProgress?.({
    phase: 'downloading',
    file: ROFORMER_MODEL.graphFile,
    ratio: 0.05
  });
  const graphBuf = await downloadFile(
    `${ROFORMER_MODEL.baseUrl}/${ROFORMER_MODEL.graphFile}`,
    (loaded, total) =>
      onProgress?.({
        phase: 'downloading',
        file: ROFORMER_MODEL.graphFile,
        loadedBytes: loaded,
        totalBytes: total,
        ratio: 0.05 + 0.1 * (total ? loaded / total : 0)
      }),
    signal
  );
  if ((await sha256Hex(graphBuf)) !== ROFORMER_MODEL.graphSha256) {
    throw new Error('RoFormer graph checksum mismatch');
  }

  onProgress?.({
    phase: 'downloading',
    file: ROFORMER_MODEL.dataFile,
    ratio: 0.2
  });
  const dataBuf = await downloadFile(
    `${ROFORMER_MODEL.baseUrl}/${ROFORMER_MODEL.dataFile}`,
    (loaded, total) =>
      onProgress?.({
        phase: 'downloading',
        file: ROFORMER_MODEL.dataFile,
        loadedBytes: loaded,
        totalBytes: total,
        ratio: 0.2 + 0.7 * (total ? loaded / total : 0)
      }),
    signal
  );
  if ((await sha256Hex(dataBuf)) !== ROFORMER_MODEL.dataSha256) {
    throw new Error('RoFormer weights checksum mismatch');
  }

  onProgress?.({ phase: 'caching', ratio: 0.95 });
  try {
    await writeOpfsFile(ROFORMER_MODEL.graphFile, graphBuf);
    await writeOpfsFile(ROFORMER_MODEL.dataFile, dataBuf);
  } catch {
    /* OPFS optional */
  }

  onProgress?.({ phase: 'ready', ratio: 1 });
  return {
    graph: new Uint8Array(graphBuf),
    data: new Uint8Array(dataBuf),
    fromCache: false
  };
}
