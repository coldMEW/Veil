# Android wrapper

Veil uses bundled HTTPS localhost assets, not a remote server URL. Build with Node
24+, JDK21, Android SDK36 (Capacitor8 requirement). SDK35 is used for emulator
acceptance. Set JAVA_HOME and ANDROID_HOME in the build shell.

```
npm ci
node scripts/export/fetch-models.mjs
npm run build:android
cd android
.\gradlew.bat :app:assembleDebug :app:assembleRelease
```

prepare.mjs verifies and retains only the four Clean model artifacts in the APK.
It adds an Android-only CSP; website headers remain unchanged. Service workers are
not registered inside Capacitor. Runtime uses one WASM thread without isolation.

Images opened through the picker/share target stay in the existing memory session.
Camera.takePhoto uses native camera UI, saveToGallery:false and local file intake;
returned temporary captures are deleted after intake. Native camera infrastructure
may create temporary files; OS activity restoration is handled. No cloud camera API.

On Android10+, explicit Save clean copy writes a fresh PNG to Pictures/Veil via
scoped MediaStore (no broad storage permission). Older devices use Capacitor
Filesystem cache plus Android Share; that explicitly exported temporary copy is
retained so share recipients can read it. Older-device fallback needs acceptance.

Optional model download consent/progress/cancel is Android-only. Complete size and
SHA256 verification precedes caching. Model-focus and DiffVax download entries use
pinned Hugging Face revisions. Face-warp is unavailable until a public exported
ONNX URL is pinned. DiffVax processing is not connected in this shell.

No APK, models, local.properties, keystore or generated public assets belong in Git.
Debug APK permits WebView debugging; unsigned release is for signing separately.
