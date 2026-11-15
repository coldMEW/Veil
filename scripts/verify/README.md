# One-command local verification

From the repository root, install the locked Node dependencies (`npm ci`), Chromium (`npx playwright install chromium`) and Python3.11 dependencies (`python -m pip install Pillow numpy`). Fetch pinned models with `node scripts/fetch-models.mjs` and `node scripts/export/fetch-models.mjs --only migan,ocr-det-v3,ocr-rec-en,ocr-dict-en`. No other Python packages are used.

```powershell
python scripts/verify/run.py --serve --url http://localhost:5192/
python scripts/verify/run.py --serve --url http://localhost:5192/ --photo "C:\private\photo.jpg" --out "C:\private\verify-new"
```

The default URL is http://localhost:5191/. Use a free port with --serve;5191 may belong to another teammate. Without --serve, use an already-running app. --serve starts npx vite with --strictPort and stops only its owned process tree. An occupied port fails rather than attaching to or stopping someone else's server.

Outputs default to ../scratch-eval/verify-TIMESTAMP/. --out must be new/empty and outside the repository; existing outputs are never deleted or reused. Outputs include report.md, results.json, screenshots, exported images, unit logs and optional private Clean crops. They are sensitive local artifacts: do not commit or publish them. No OCR strings, face embeddings, keys or payloads are collected. Face cosines are recorded only for the public fictional demo fixtures required by this task. No takedown message is sent; the browser creates local draft tickets only.

Acceptance:
- Face: every fake-* and selfie-2/3 same vs selfie-1 at0.363; other-person must have a detected face and remain below threshold.
- Trace: exactly the five expected demo files, excluding other-person, and five local tickets. Scan timing excludes enrollment.
- Mark: UI Check shows Made from your photo after700px/JPEG72. Python measures RGB PSNR and decimal MB. A second3000x4000 export must be<4,000,000bytes. This12MP-sized fixture is an upscaled fictional demo, not a natural12MP-detail or worst-case compression benchmark.
- Optional Clean: actual app picker/review/export with the watermark disabled. Pillow applies EXIF orientation, then counts pixels whose maximum RGB absolute difference exceeds8. Every8-connected component bbox is retained in clean-components.json; by default EVERY component gets a full-resolution before-left/after-right PNG crop with12px context. --min-region-pixels can explicitly limit previews; excluded boxes still remain in JSON. JPEG re-encoding noise can change pixels globally, so this is not an outside-approved-mask invariant test. No OCR text is read by the driver.
- Unit: strict tsc, full Vitest with20000ms timeout, production Vite build. Any failure gives nonzero runner exit; optional Clean without --photo is marked SKIP.

Drivers emit a single VEIL_VERIFY_JSON record and use VEIL_URL/VEIL_OUT. Arbitrary driver stdout is not persisted, protecting private error details. Drivers use fresh browser contexts. Shield keeps one context across export/repost so its private mark key persists. Repeated uploads use full document navigation to prevent hitting the comparison-original picker on a stale screen.

Synthetic Python tests: `python -m unittest discover -s scripts/verify -p test_run.py`. Server tests: `npx vitest run server --testTimeout=20000`. DNS/fetch are mocked in server tests; the existing validation-then-fetch DNS rebinding race is not eliminated by these guard tests.
