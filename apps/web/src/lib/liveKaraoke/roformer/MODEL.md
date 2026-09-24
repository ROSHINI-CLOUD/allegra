# Mel-Band RoFormer (browser karaoke)

## Checkpoint

| Field | Value |
| --- | --- |
| Graph | `syhft_core_t1100.onnx` |
| Weights | `syhft_core_t1100.onnx.data` (~707 MB) |
| Source | [musetric/vocal-separation-roformer-onnx](https://huggingface.co/musetric/vocal-separation-roformer-onnx) |
| Weight lineage | SYH99999 MelBandRoformerBigSYHFTV1Fast (MIT) — Kim Vocal / SYHFT family |
| Architecture | Mel-Band RoFormer (arXiv:2310.01809) |
| License | MIT |
| Graph SHA-256 | `e6da40047d63ce9129c53d9c9f50b019ffae83de414e05b2800ab67fce13e374` |
| Data SHA-256 | `648db04fce69e556bc1fb08486ffd7f7ac50d370b1c6026e42ffea9cd621a7ed` |

## Runtime

- ONNX Runtime Web in a module worker (`separatorWorker.ts`) — WebGPU preferred, WASM fallback.
  The session lives for the page, so the model loads once per page.
- Host STFT/iSTFT: `n_fft=2048`, `hop=441`, 44.1 kHz stereo (songs are decoded at 44.1 kHz)
- Window: **T=1100 frames ≈ 11.00 s** (model export; multiple of 4 for WebGPU)
- Streaming layout (`chunks.ts`): chunks one ~10 s hop apart, overlapping only by a 1 s
  raised-cosine crossfade, so each second of audio passes through the model about once
- Order: the worker starts where the playhead will be when the chunk finishes, works
  forward, then fills in the start of the song; seeks re-aim it
- Instrumental: `I = mix − vocals` (mask applied to STFT → iSTFT vocals)
- Residual pass (soft subtract when the residual ratio is high) only when the first chunk
  shows the device has time for two passes
- Playback (`streamPlayer.ts`): the `<audio>` element stays the clock and keeps its source;
  ready segments play through Web Audio while its own output is muted, and anywhere not yet
  separated the original plays
- Mid-side fallback when the model cannot load, or a chunk takes longer than it plays

Measured (desktop, WebGPU): session build ~18 s cold, ~6.5 s per 10 s chunk (0.5 s of it
STFT), instrumental at the playhead ~27 s after the first press, ~12 s after a seek.

## Local vendor (optional, faster)

Place both files under `apps/web/public/models/roformer/` (gitignored).

## Phases

1. ~~Single-pass + overlap-add~~ (replaced by streaming)
2. Rolling ahead-of-playhead buffer — implemented (worker + stream player)
3. Residual pass (CLEAN) — implemented gated soft subtract
4. Spectral confidence mask
5. Device benchmark auto mode — partly: pace check falls back to mid-side on slow devices
6. OPFS → same-origin model serve + WebGPU graph polish
