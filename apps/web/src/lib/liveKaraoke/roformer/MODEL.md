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

- ONNX Runtime Web — WebGPU preferred, WASM fallback
- Host STFT/iSTFT: `n_fft=2048`, `hop=441`, 44.1 kHz stereo
- Window: **T=1100 frames ≈ 11.00 s** (model export; multiple of 4 for WebGPU)
- Overlap: normal=2, clean=4, ultra=6
- Instrumental: `I = mix − vocals` (mask applied to STFT → iSTFT vocals)
- CLEAN/ULTRA: second pass on `I` with soft residual subtract when residual ratio high

## Local vendor (optional, faster)

Place both files under `apps/web/public/models/roformer/` (gitignored).

## Phases

1. Single-pass + overlap-add (this tree)
2. Rolling ahead-of-playhead buffer
3. Residual pass (CLEAN) — implemented gated soft subtract
4. Spectral confidence mask
5. Device benchmark auto mode
6. OPFS → same-origin model serve + WebGPU graph polish
