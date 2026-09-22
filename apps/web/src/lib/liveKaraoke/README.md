# Browser live karaoke

In-browser vocal attenuation so listeners can try an instrumental mix without a server job.

## Backends

### midside (default, always available)

Stereo mid-side: attenuate Mid `(L+R)/2` (vocals often centered), keep Side `(L-R)/2`.
No model download. Works offline after the track has been fetched and decoded.

### scnet (scaffolding)

Optional ONNX path. Drop the model file here (gitignored):

```
apps/web/public/models/scnet-tran-core-2.75s-v1.onnx
```

Source (Hugging Face): `t4t2k1m/yt-precount-scnet-tran-onnx` (~47MB).

The worker probes for that file. Full `onnxruntime-web` + STFT/ISTFT inference is not wired yet; when the model or ORT is missing, the engine falls back to midside.

**TODO (SCNet drop-in):**

1. Add `onnxruntime-web` to `@allegra/web`.
2. Implement chunked inference in `scnetWorker.ts` (single-thread WASM first).
3. Only then consider COOP/COEP `require-corp` for multi-thread WASM — do **not** enable those headers globally while Google OAuth / Convex are in use; isolation breaks those flows.

## Usage

`useLiveKaraoke` fetches via `resolveApiUrl(song.streamUrl)` (or `/api/stream/:id`), runs midside, and swaps the main player source with `swapAudioSource(blobUrl)`. Turning off restores `song.streamUrl`.
