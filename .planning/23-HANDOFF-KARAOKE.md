# 23 — Karaoke (Scarleta) handoff

Branch: `fe/karaoke-scarleta`

## Architecture

Deep module `KaraokeService` (`status` / `request` / `pipeInstrumental`).
Provider seam: `KaraokeSeparationProvider` → `ScarletaKaraokeProvider` (+ Fake in tests).
Asset store: cache-backed (`CacheKaraokeAssetStore`); optional S3 copy when uploads config is present.

Browser never sees Scarleta. Instrumental plays via `/api/stream/karaoke/:songId` (Range → 206 preserved).

## Enable locally

1. Get a free key (`sk_free_*`) from Scarleta.
2. Set in `apps/api/.env`:
   ```
   SCARLETA_API_KEY=sk_free_...
   ```
3. Restart API. Immersive player shows a pill **Karaoke** control (DESIGN.md chartreuse when on).
4. Use one song under ~5 minutes (300 free tokens ≈ 5 minutes).

## Contract

See `docs/api-contract.md` § Karaoke. Shared DTO: `KaraokePayload` in `packages/shared/types.ts`.

## Honest limits

- Without `SCARLETA_API_KEY`, routes return 503 and the button stays hidden.
- Saavn CDN URLs may be short-lived; if Scarleta cannot fetch, status becomes `failed` and original audio keeps playing.
- S3 persist is best-effort when cover-upload AWS config exists; otherwise the stream proxies the provider result URL server-side only.
