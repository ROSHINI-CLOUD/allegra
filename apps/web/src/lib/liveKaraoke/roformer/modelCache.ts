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

/**
 * Ensure RoFormer weights are verified in OPFS, then return a model URL ORT can load.
 * Session uses HuggingFace resolve URL so the sibling `.onnx.data` resolves correctly.
 * Prefer `/models/roformer/...` when the operator has vendored files locally.
 */
export async function ensureRoformerModel(
  onProgress?: (p: ModelProgress) => void,
  signal?: AbortSignal
): Promise<{ modelUrl: string; fromCache: boolean }> {
  onProgress?.({ phase: 'checking', ratio: 0.02 });

  const localGraph = `/models/roformer/${ROFORMER_MODEL.graphFile}`;
  try {
    const head = await fetch(localGraph, { method: 'HEAD', signal });
    if (head.ok) {
      onProgress?.({ phase: 'ready', ratio: 1, message: 'Using local model' });
      return { modelUrl: localGraph, fromCache: true };
    }
  } catch {
    /* continue */
  }

  const cachedGraph = await readOpfsFile(ROFORMER_MODEL.graphFile);
  const cachedData = await readOpfsFile(ROFORMER_MODEL.dataFile);
  if (cachedGraph && cachedData) {
    const gOk = (await sha256Hex(cachedGraph)) === ROFORMER_MODEL.graphSha256;
    const dOk = (await sha256Hex(cachedData)) === ROFORMER_MODEL.dataSha256;
    if (gOk && dOk) {
      onProgress?.({ phase: 'ready', ratio: 1, message: 'OPFS cache verified' });
      return {
        modelUrl: `${ROFORMER_MODEL.baseUrl}/${ROFORMER_MODEL.graphFile}`,
        fromCache: true
      };
    }
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
    modelUrl: `${ROFORMER_MODEL.baseUrl}/${ROFORMER_MODEL.graphFile}`,
    fromCache: false
  };
}
