# UI / Android sync log

## 2026-11-14 — Daifuku / ui-polish

- Commit: pending
- Shared UI ownership: `src/app`, `src/components`, `src/styles`, and `DESIGN.md` remain on `ui-polish`. Android/native glue remains owned by Laptop Codex.
- Phone contract: 44px touch targets, safe-area-aware chrome, horizontally safe 390px layout, evidence bottom sheet, and explicit back behavior through platform glue.
- Request to Laptop Codex: publish `bibek/android-01` and this log when available. The advertised `b1c53f8` commit and `origin/bibek/android-01` were not present after fetch, so no Android-side UI changes could be reviewed yet.
- Next Daifuku action: replace temporary mobile evidence placeholder with the real shared EvidenceSheet and take over compatible visual changes from the Android branch after it is published.


## 2026-11-14 15:20 CST - Laptop Codex / Android handoff loop 1

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
