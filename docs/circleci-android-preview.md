# CircleCI Android preview (build, install, smoke test)

A manually triggered CircleCI workflow, `android-preview`, that builds a downloadable LuvLyrics APK and
tests it on a cloud Android emulator. It is separate from the GitHub Actions release path
(`mobile-apk.yml`, which owns `apk-latest`) and never publishes anything.

**Status: configured and validated locally. No CircleCI run has happened yet.** Every number marked
*estimate* below is unmeasured until the first run finishes; the "First run" section is where to record them.

## What it does

| Job | Does | Output |
|---|---|---|
| `build-preview-apk` | `assembleRelease` for `arm64-v8a` + `x86_64` in one APK, signed with the public Expo debug key, JS bundled (no Metro). Verifies signature, package, version, not-debuggable, both ABIs, embedded bundle. | `LuvLyrics-preview-<version>-<sha7>-universal.apk` in Artifacts under `preview/`, plus `build-logs/` |
| `emulator-smoke` | Boots an API 34 `google_apis` x86_64 emulator with KVM, installs that APK, runs the repo's launch gate and the mini-player flow. | JUnit in the Tests tab; screenshots, logcat, `summary.txt` under `emulator-smoke/` |

They are two jobs on purpose: a red test never loses the APK, and **Rerun workflow from failed** retests without
rebuilding.

Nothing in it reads a production keystore, Sentry token or other secret. `EXPO_PUBLIC_SENTRY_DSN` is unset, so
the preview reports nothing to Sentry.

## What was checked against the repo and CircleCI's docs

| Fact | Value | Source |
|---|---|---|
| Android package | `com.lyricflow.app` | `apps/mobile/app.json`, `android/app/build.gradle` |
| Variants | `debug`, `release` only. There is no `preview` Gradle variant; `eas.json`'s `preview` is an EAS cloud profile and is not used. The workflow builds **`release`**. | `build.gradle`, `eas.json` |
| App | Expo 54, React Native 0.81.5, Hermes, New Architecture, `minSdk 24`, `compileSdk`/`targetSdk 36` | `package.json`, RN `libs.versions.toml` |
| Toolchain | JDK 17, Node 20, Gradle 8.14.3, AGP 8.11.0, Kotlin 2.1.20, build-tools 36.0.0, NDK 27.1.12297006 | RN `libs.versions.toml`, `mobile-apk.yml` |
| Native ABIs | Both supported. `llama.rn` defaults to `x86_64, arm64-v8a`; Skia ships prebuilts for both. CI already builds each ABI on its own. | `llama.rn/android/build.gradle`, `mobile-apk.yml` |
| Image | `android:2026.10.1`, newest dated tag. Has nested virtualization, x86 emulators, SDK platforms 29-35 and NDK 28.0.12433566. **Not** platform 36, build-tools 36 or NDK 27.1: `sdk-packages.sh` installs those. | circleci.com/developer/machine/image/android |
| Runner | Android images run on the Linux VM executor. `medium` = 2 vCPU, 7.5 GB, 150 GB disk. `large` = 4 vCPU, 15 GB. Both are available on Free. | circleci.com/docs/guides/execute/android-machine-image/, pricing page |
| Cost rate | Linux VM `medium` 10 credits/min, `large` 20. The price list has no separate Android row, so I assume the Android classes bill as these. Confirm on the first run under Plan Usage. | circleci.com/pricing/price-list/ |
| Free plan | 30,000 credits/month, 2 GB storage included, 5 users, no card required | circleci.com/pricing/ |

The docs recommend `large` or above for Android. `medium` is the default here because it is the cheaper class and
you asked to start there. If a build is OOM-killed or too slow, trigger again with `android-resource-class=large`.

## The APK

* **One universal file** (`arm64-v8a` + `x86_64`), so the same file installs on a phone and runs on the emulator.
* **Signed with the public Expo debug key**, the same CI-only identity `mobile-apk.yml` uses for every non-main build. It is
  published on npm, so it is not a release identity.
* **The same package ID as the real app.** Android will refuse to install it over a production-signed LuvLyrics
  ("signatures conflict"). Uninstall the real app first (that deletes its local data), or install on another phone
  or profile. It talks to the same backend as a release build.
* The build's `arm64-v8a` libraries list shows extra `llama.rn` CPU-feature variants (`v8`, `v8_2`, `dotprod`,
  `i8mm`). That is expected; `build-report.txt` says so.
* **Which slice the emulator tested:** the `x86_64` libraries of this same file (`env.txt` records
  `primaryCpuAbi=x86_64`). The `arm64-v8a` slice is checked statically only.

## One-time dashboard setup (Free plan)

1. Push this branch to GitHub. Config is read from the branch you trigger, so it must exist there.
   ```
   git switch -c chore/circleci-android-preview
   git add .circleci docs/circleci-android-preview.md docs/README.md
   git commit -m "chore(infra): add a manual CircleCI Android preview build and emulator smoke test"
   git push -u origin chore/circleci-android-preview
   ```
2. Sign up at https://app.circleci.com/signup with GitHub. Choose the Free plan. **Do not add a payment method or
   upgrade**; without one, the worst case is that builds stop when the month's credits run out.
3. **Projects**, create a project for `peterish8/allegra`. The wizard has you install the CircleCI GitHub App; grant it
   that one repository only.
4. When it asks for the pipeline's config, use **`.circleci/config.yml`** on branch `chore/circleci-android-preview`
   (switch it to `main` after merging).
5. **Project Settings > Project Setup**: the first trigger is "All pushes". You can delete it. It is harmless if you
   keep it: a push compiles the workflow to nothing (`run-android-preview` defaults to `false`; verified with
   `circleci config process`), so no job starts and no credits are spent.
6. **Usage Controls** (storage is billed as size x retention days, and artifacts count). Suggested: artifacts 14 days,
   workspaces 3 days, caches 7 days.

## Run it

1. **Pipelines**, pick the project, **Trigger Pipeline**.
2. Pick the pipeline; set the config source branch and checkout branch to `chore/circleci-android-preview`.
3. **Add +** one parameter: name `run-android-preview`, type boolean, value `true`. Optionally add
   `android-resource-class` = `large`.
4. **Run Pipeline**. A parameter that is not declared in the config fails with `Unexpected argument(s)`, so type the
   names exactly.

From a terminal (token from User Settings > Personal API Tokens; keep it out of the repo). The pipeline definition
id is in Project Setup:

```
curl -X POST https://circleci.com/api/v3/runs \
  --header "Authorization: Bearer $CIRCLE_TOKEN" --header "Content-Type: application/json" \
  --data '{"data":{"attributes":{"config":{"branch":"chore/circleci-android-preview"},
    "checkout":{"branch":"chore/circleci-android-preview"},
    "parameters":{"run-android-preview":true}},
    "references":{"pipeline":{"id":"<pipeline-definition-id>"}}}}'
```

Download the APK from the `build-preview-apk` job's **Artifacts** tab. Artifact URLs need you to be signed in.

## What the emulator tests

Both stages always run; the job fails if any `FAIL` line exists, and logs are collected either way.

| Stage | Checks | Selectors |
|---|---|---|
| Environment | `/dev/kvm` usable (`emulator -accel-check`, fails rather than falling back to software); boot within 420 s; CPU ABI is `x86_64`; the installed app's `primaryCpuAbi` is `x86_64` | system |
| Launch gate (the repo's `.github/scripts/mobile-launch-check.sh`) | process starts and stays up 30 s with no crash; a `lyricflow://` link navigates; About opens with its Updates panel; the screen layer never dies; the same again after force-stop | accessibility labels, `[diag:link]` log lines |
| Mini-player flow (`.circleci/scripts/miniplayer-flow.sh`) | Imports a generated 30 s WAV through the app's own "Add songs from this phone", plays it, then for 2 rounds: tap `Now playing: <title>. Open player` opens Now Playing (`Up next`, Previous / Play-Pause / Next present), then dismiss (`Close player`, else Back) returns to the mini-player | the app's own labels and visible text; no coordinates |

### Coverage gaps (reported as skipped tests in every run)

* **arm64 is not executed.** An x86_64 emulator cannot run it. Install the APK on a physical arm64 phone.
* **Playback is a generated local WAV**, so streaming through YouTube Music metadata and catalog audio is not
  exercised by the deterministic flow. The repo has no test fixture and `lyricflow://play?q=` needs live providers.
  If the fixture import fails, the flow falls back to a live track, labelled live and non-deterministic.
* **The launch gate's player stage is live too.** It passes when there is no network, so it shows the screen stays
  alive, not that streaming works.
* **No audible output check:** the emulator runs `-noaudio`. The app's playback state and the media session are
  what is observed.
* **The fixture path is unproven until the first run.** It drives several screens that I could verify only by reading
  source and testing the selectors against a sample `uiautomator` dump. If a step fails, the `fail-*.png` and
  `fail-*.xml` files in `emulator-smoke/flow/` show the screen, and **Rerun workflow from failed** retests the
  emulator job alone.

## Cost and time

Credits = minutes x rate. These are **estimates**, to be replaced by measurements:

| Job | Estimated minutes | Credits (medium) |
|---|---|---|
| `build-preview-apk` | cold 55-85 (Gradle builds `llama.rn` as several arm64 CPU variants plus x86_64 on 2 vCPU, which is the slow part), warm 40-65 | 400-850 |
| `emulator-smoke` | 18-28 (sdk image 3, boot 3-5, launch gate 6-8, flow 3-6) | 180-280 |
| Full run | 60-110 | **~600-1,100** |

At that rate the Free plan's 30,000 credits cover roughly 27-50 full runs a month, so the workflow costs ₹0 as long
as you stay on Free with no card. Ceilings: Gradle is wrapped in `timeout 90m` (900 credits worst case on medium),
emulator boot has a 420 s limit, the smoke stage 25 min.

Caches are deliberately small: `~/.npm`, `~/.gradle/caches/modules-2` and `~/.gradle/wrapper/dists`, keyed by
`package-lock.json`, the Gradle wrapper version and the pinned toolchain. The Android system image, NDK and Gradle
transforms are **not** cached (each is 0.5-1.5 GB and storage is metered).

**No emulator snapshot cache** yet. `timings.txt` records `emulator-boot`; add a snapshot only if that is a
significant share of the job and the snapshot's size fits the storage budget.

## First run: fill this in

| Item | Value |
|---|---|
| Pipeline link | |
| Branch / commit | |
| `build-preview-apk` elapsed, credits | |
| `emulator-smoke` elapsed, credits | |
| Emulator boot seconds (`timings.txt`) | |
| APK size, sha256 (`build-report.txt`) | |
| Checks passed / failed / gaps (Tests tab) | |
| Real credit rate for the Android medium class (Plan Usage) | |

## Troubleshooting

* **Exit 137 or "killed" in the Gradle step:** out of memory on `medium`. Trigger with `android-resource-class=large`.
* **`/dev/kvm is missing`:** the emulator job stops on purpose; nothing runs in software emulation.
* **"MediaStore never indexed the fixture":** the emulator's media scan did not pick up the pushed WAV; the log
  lists `/sdcard/Music`. The flow then tries a live track so the run still yields evidence.
* **Gradle cache key:** it contains `ndk27.1.12297006`. `sdk-packages.sh` warns if React Native's NDK changes; update the key then.
