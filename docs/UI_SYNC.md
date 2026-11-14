# UI / Android sync log

## 2026-11-14 — Daifuku / ui-polish

- Commit: pending
- Shared UI ownership: `src/app`, `src/components`, `src/styles`, and `DESIGN.md` remain on `ui-polish`. Android/native glue remains owned by Laptop Codex.
- Phone contract: 44px touch targets, safe-area-aware chrome, horizontally safe 390px layout, evidence bottom sheet, and explicit back behavior through platform glue.
- Request to Laptop Codex: publish `bibek/android-01` and this log when available. The advertised `b1c53f8` commit and `origin/bibek/android-01` were not present after fetch, so no Android-side UI changes could be reviewed yet.
- Next Daifuku action: replace temporary mobile evidence placeholder with the real shared EvidenceSheet and take over compatible visual changes from the Android branch after it is published.


## 2026-11-14 15:17 CST - Laptop Codex / Android handoff loop 1

- Commits: `2d7611d` native wrapper; `cd050cc` device gate; `b1c53f8` prior UI merge;
  `4b3206b` WIP checkpoint before ownership changed. This entry accompanies the platform-isolation commit.
- Ownership accepted. No further edits to shared UI paths. Prior UI changes are WIP, not the new design authority.
- **Latest Bibek feedback supersedes the old monochrome direction:** redesign from scratch with UI UX Pro Max,
  larger visible icons (24-28px), Android touch areas >=48px, deliberate color, noticeable purposeful Anime.js
  motion, and much less text. He rejected both the original blue cards and the monochrome revision. Please
  implement on ui-polish; do not merely reskin the WIP. This is the top outstanding UI request.
- GitHub DESIGN.md was read from ui-polish, merged through `26192a0` in this loop. New color direction needs
  updating there by Daifuku while retaining safe areas, real sheet behavior and local-first guarantees.
- Native behavior now lives in `src/platform/*`. Old src/lib/native files are tiny compatibility reexports,
  so existing UI imports still work. Main entry initializes native code and loads native-only inset CSS.
- Shared UI integration API: `isAndroid()`, `takePhoto()`, `saveCleanCopy(bytes, filename)` from
  `src/platform/native`. Camera is user-triggered, saveToGallery=false; returned temporary file is removed
  after intake. Shared input uses the normal image session automatically. Explicit clean PNG export uses
  scoped MediaStore Pictures/Veil on Android10+, Capacitor Filesystem/Share fallback on older versions.
- Render camera and model controls in YOUR chrome; do not restore floating platform buttons. A camera
  button should call takePhoto, an optional-model menu dispatches `new Event('veil-models-open')`.
  `NativeModels` handles consent, size, progress, cancellation, hash validation and cache. Its UI is native-only.
- Toast event: `new CustomEvent('veil-toast', {detail:'message'})`. No blocking success alert needed.
- Back contract: native dispatches cancelable `veil-back`; shared UI prevents default when closing a sheet,
  report or image; unhandled Back exits. Respect defaultPrevented; native model modal handles Back first.
- Inset variables are supplied by Capacitor SystemBars. src/platform/native.css pads Android body. Please
  remove duplicate native inset CSS from shared styles in your redesign, keeping the platform import.
- **Pixel7 accepted (synthetic only)**: Android17, WebView157.0.8103.40, secure=true, coi=false, SAB absent,
  configured WASM1 thread. With WebView offline emulation (navigator.onLine=false), two planted strings found,
  OCR incl load2108ms, MI-GAN/export/rescan6054.7ms, rescan0 boxes, new PNG in Pictures/Veil. No observed remote
  requests or runtime exceptions. This validates the WIP build, not the forthcoming redesigned UI.
- Screenshots: scratch-eval/android/pixel7/01-home.png through 05-export-saved.png; web captures at
  scratch-eval/android/redesign/ (390/768/1440). All are synthetic and outside Git.
- **Phone now used instead of emulator**, per Bibek's direct instruction. Deleted only this task's AVD/system
  image; recovered ~13GB. USB serial2A261FDH2006NC. Smoke script: node scripts/android/device-smoke.mjs --serial
  2A261FDH2006NC. It queries only the named synthetic fixture/exports, never the user's existing photo collection.
- Independent review findings to fix: completed credentials currently say Not run (execution must differ from
  finding tone); peek sheet consumes its space with headings while actions are hidden; only the selected tool
  should highlight, labels >=12-13px. Keep real model/action buttons obvious, not buried under method text.
- Platform limits: FAL exported ONNX has hash/size but NO downloadable pinned URL in its manifest; model menu
  labels this unavailable. DiffVax pinned entry is cached on demand, but Protect processing is not wired in
  this shell. No claim of WebGPU or completed physical-camera capture acceptance yet.
- Next: Daifuku reads this log and ships full redesign. Laptop will fetch/merge each loop, rebuild APK and rerun
  the physical Pixel gate, then append exact results here. No PR/discussion posts from Laptop.


## 2026-11-14 15:28 CST - Laptop Codex / Android loop 2

- Fetched and merged ui-polish `647deab` (EvidenceSheet added). Shared UI files left untouched after WIP.
- Native implementation isolated in platform commit `022890f`; old lib/native paths are compatibility shims.
- Real Pixel7 optional DiffVax download passed: 36,640,862B in3515.9ms, cached SHA256 exactly
  44aa61ea8d6fbdc485bc897376cff41027e9885d5f68c3dd2e4bae8092cf3cd4. Progress sampled12 times. Only model GETs
  to huggingface.co and us.aws.cdn.hf.co. Consent screenshot scratch-eval/android/pixel7/07-model-consent.png.
- Pixel camera open/cancel passed; previous synthetic image retained. No photo taken or camera preview screenshot.
- Pulled explicitly saved synthetic PNG:139,870B, SHA2569faed44bd266d69b905c6913072b603ceb9957b9efaf90f06aa98124d2428201;
  chunks only IHDR/IDAT/IEND, no metadata chunks.
- Adding native cache hash validation when reusing a cached optional model, so an app update cannot silently use
  a stale DiffVax file at the same pathname. Platform-only behavior. Full refactored APK/phone gate next.
- The combined cancellation/Back automation lost its CDP connection after returning to the launcher; no Back
  PASS claimed from that attempt. Will rerun Back with explicit state checks and cancellation independently.
- UI request still OPEN: Bibek explicitly rejected current visuals and requested full UI UX Pro Max redesign
  with larger icons, color, visible motion, and much less copy. Awaiting Daifuku's pushed redesign to merge.


### Loop 2 verification follow-up (15:30 CST)

- Refactored source: tsc0; vitest329/329 (32 files,8.38s); Playwright9/9 (19.9s).
  Real browser Clean summary: 2 selected/2 planted found, outside changes0, metadata[], rescan[], total3019ms.
- Independent Pixel cancellation: throttled optional Model focus download cancelled at3000B; dialog closed;
  CacheStorage contains NO focus model. Evidence pixel7/cancel-check.json.
- Fresh-state Pixel Back acceptance PASSED: before expanded=true/file=true; Back1 expanded=false/file=true;
  Back2 home=true/file=false. The earlier combined-script disconnect was not used as acceptance.
  Evidence pixel7/back-check.json. No source workaround needed for the existing veil-back event contract.
- Will rebuild current refactored APK and rerun synthetic Clean before the next phone handoff. Full visual
  redesign remains Daifuku-owned and not accepted by Bibek yet; no shared UI edits made in this loop.


## 2026-11-14 15:33 CST - URGENT direct user feedback / native camera change

- Bibek again rejected the currently installed UI: font, button/icon sizes, too much copy and camera
  discoverability. He explicitly said redesign everything, inspect actual screenshots, and update each change.
  Please send a full visual redesign rather than further incremental monochrome components.
- Laptop is implementing a true in-app CameraX viewfinder (Android-owned CaptureActivity), replacing the
  system-camera intent. Native API stays takePhoto() from src/platform/native so shared chrome need not change.
- Daifuku MUST expose a primary >=48px labeled Take photo action beside Open photo in the empty workspace;
  a tiny camera glyph in the top bar is not discoverable. Native controls use24-28px icons and56px touch targets.
- Do not rely on the previous DESIGN.md colors: user has explicitly requested color and visible purposeful
  animation. Keep reduced motion and local-first guarantees. Native camera preview/capture stays on-device.
- Screenshot review confirms large empty gray area, tiny toolbar glyphs and unnecessary file-limit/task text.
  Device screenshots remain in scratch only. Native camera will be tested without photographing private scenes.


### Camera implementation update (15:38 CST)

- CameraX1.6.2 native in-app viewfinder now compiles (56s first Gradle build). Not yet claimed as physical
  preview/capture acceptance. JS takePhoto() signature is unchanged; native capturePhoto plugin replaces
  the external camera intent. Includes torch, front/back switch,80dp shutter,28dp icons/56dp hit targets,
  native press animation, scoped permission prompt, temporary JPEG cleanup; no gallery auto-save.
- Important font diagnostic: @fontsource-variable/geist names its face "Geist Variable", while old shared
  CSS sets font-family Geist. Please verify and use the actual loaded face in the new typography system.
- User explicitly wants per-change screenshots/updates. Please push one complete visible redesign loop
  soon, with an obvious labeled Take photo action. Existing empty screen is not accepted.


## 2026-11-14 15:42 CST - Laptop sync loop 3 / camera API ready

- Merged ui-polish `b6b3830`, resolving shared UI conflicts entirely in favor of Daifuku's branch. Prior
  laptop WIP is not retained as shared UI authority. No hand edits to shared UI files in this loop.
- **Integration regression to address:** current shared App/AppWorkspace/ImagePicker no longer exposes
  ANY camera action, optional-model menu, or veil-back handler. Native bridge takePhoto() is ready, but user
  cannot reach it from this UI. Please wire primary Take photo, Offline models and stateful Back urgently.
- Platform Back now has a safe image-session fallback: after dispatching cancelable veil-back to shared UI,
  unhandled Back closes the active file before exiting on the empty screen. Shared sheet/report state still
  needs its own preventDefault handler so Back collapses that state first.
- CameraX API: takePhoto() calls VeilIntake.capturePhoto -> in-app VeilCameraActivity -> local JPEG bytes
  -> existing image session. No shared UI API signature change. Capacitor Camera intent plugin removed as
  redundant (native dependency CameraX1.6.2 is pinned in android/app/build.gradle).
- Latest user demands remain unchanged: from-scratch visual redesign, new typography, larger buttons/icons,
  intentional color/motion, much less text; actual per-change screenshot review. Camera discoverability is
  their explicit complaint. Native preview permission/device checks are proceeding independently.
