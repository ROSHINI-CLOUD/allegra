/** Mel-Band RoFormer ONNX (musetric / SYHFT lineage) — browser host config. */

export const ROFORMER_SAMPLE_RATE = 44_100;
export const ROFORMER_N_FFT = 2048;
export const ROFORMER_HOP = 441;
export const ROFORMER_FREQ_BINS = ROFORMER_N_FFT / 2 + 1; // 1025
/** Stereo packed on freq axis: L then R → 2050. */
export const ROFORMER_PACKED_FREQ = ROFORMER_FREQ_BINS * 2; // 2050
/**
 * Model time frames (multiple of 4 for WebGPU MatMul).
 * Centred STFT: 1100 frames cover (1100 - 1) × hop 441 ≈ 10.99 s at 44.1 kHz.
 */
export const ROFORMER_FRAMES = 1100;
export const ROFORMER_CHUNK_SAMPLES = (ROFORMER_FRAMES - 1) * ROFORMER_HOP;

/** Hugging Face files (MIT weights via SYH99999; ONNX export musetric). */
export const ROFORMER_MODEL = {
  id: 'musetric/vocal-separation-roformer-onnx',
  graphFile: 'syhft_core_t1100.onnx',
  dataFile: 'syhft_core_t1100.onnx.data',
  graphSha256: 'e6da40047d63ce9129c53d9c9f50b019ffae83de414e05b2800ab67fce13e374',
  dataSha256: '648db04fce69e556bc1fb08486ffd7f7ac50d370b1c6026e42ffea9cd621a7ed',
  /** Graph size in bytes; anything else at the local path is not the model. */
  graphBytes: 10_598_027,
  dataBytes: 741_190_540,
  /**
   * Pinned to a commit, not `main`: the repo replaces the core in place, and a moving
   * `main` breaks the checksum and silently drops karaoke to mid-side.
   */
  baseUrl:
    'https://huggingface.co/musetric/vocal-separation-roformer-onnx/resolve/4720922b290b256f80228dbf5b48b592620e70f7'
} as const;

export const RESIDUAL_DEFAULTS: {
  residualRatioThreshold: number;
  suppressionStrength: number;
  epsilon: number;
} = {
  residualRatioThreshold: 0.08,
  suppressionStrength: 0.88,
  epsilon: 1e-8
};
