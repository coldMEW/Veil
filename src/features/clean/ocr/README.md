ï»¿# OCR adapter

Install exact dependencies listed in the CLEAN-OCR handoff, then run:

- `node scripts/export/ocr/fetch.mjs` (verifies cached/downloaded model SHA-256 and size)
- `node scripts/export/ocr/smoke.mjs` (synthetic 3000x2000 image, 14px planted text)
- `node scripts/export/ocr/smoke.mjs "<private-image-path>"` (private result prints only found/count/timing)

Browser integration: import `OcrEngine` from `./engine`, call `load('/models/ocr/')`, then `scan(imageData, {onProgress, signal})`. Input pixels must already be orientation-corrected. Results contain normalized `rect`, source-pixel `pixelRect`, text and detector/recognizer scores. Text stays in memory; callers must not persist/log it. The engine copies caller pixels before transfer. `cancel()` terminates the worker, including WASM; call `load()` before scanning again. `dispose()` releases the worker. Failed/time-limited scans reject rather than return an empty successful result.

Recognition is PP-OCRv5 English: the actual ONNX recognition height is 48 despite upstream config claiming 32. Detector input is BGR with ImageNet normalization. Detection uses overlapping 960px source tiles plus a whole-image pass. PCA-oriented connected-component envelopes approximate DB contours/unclip. Recognition affine-warps each quad horizontally; masks retain its axis-aligned envelope. Strong perspective, curved text and seam fragments remain limitations. A default additional 90-degree detector pass handles steep/vertical text; steep recognition compares both reading directions. Disable with rotateTiles:false for the original pass budget. Cross-orientation suppression occurs after recognition and favors longer confident lines over short overlapping fragments. Every returned box carries its rule-based privacy category. Scores are technical diagnostics, not a privacy guarantee. Whole-image processing, downloads, and phone memory/latency require real-device qualification. Synthetic benchmark timing excludes fixture canvas/font generation; load time is separate. The default scan rejects excessive box/tile counts explicitly instead of silently truncating.

The application shell does not yet import this engine. Passing the shell production build alone does not validate the worker in a browser. Worker bundle compilation is a separate build check; browser and Android runtime acceptance must be reported independently.

## OCR-02 detector selection

Default: PP-OCRv3 mobile detector (`det-v3.onnx`, SHA-256 `ee40e80071ba3a320d4efda75f3e22047a7d049e9bf7bcaaf9daea23fc21b935`) with the existing PP-OCRv5 English recognizer (`4e16deb22c4da6468bdca539b2cd3c8687825538b67109177c47d359ab994cd7`). This is an intentional cross-version pairing: detection supplies image crops to independent recognition. The upstream config recommends same-version recognition; this application validates its pairing with actual scans instead.

Use `node scripts/export/ocr/fetch.mjs --det v3` (default) or `--det v5`; then `engine.load('/models/ocr/', {detVariant: 'v3'})`. v5 is optional and stored separately. Smoke accepts `--det v3|v5`, optional `--tile 512`, and an optional private file path. It reports exact-match results for 10/14/20px and rotated text plus detector/recognizer timings. No private OCR strings are printed.

The pinned `detection/v3/config.json` describes the model but contains no normalization, side-limit or postprocessing thresholds. The manifest therefore identifies our explicit BGR/ImageNet, 960px, 0.3/0.6/1.5 DB settings as application defaults, not config-supplied values.

Browser gate: run Vite on port5175 and open `/tests/e2e/ocr-gate.html`. It uses a dedicated WASM worker, explicit Vite `?url` WASM asset wiring and reports to `#out`/`window.__G6`. A served page is not browser acceptance until Chrome returns its result.

## OCR-04 integration

This port uses the shell's onnxruntime-web1.20.1 through ../ortEnv.getOrt('wasm'); it does not maintain another WASM setup. The helper chooses up to4threads when cross-origin isolated. The pinned recognizer dimensions48/438 are validated by output decoding;1.20.1 lacks the newer session metadata APIs. Public engine.scan accepts RGBA pixel objects (including ImageData and Clean Pixels). candidatesFromOcr preserves quads and uses glyph removal; rescanExport forwards decoded export pixels and propagates scanner failures. Strict indexed-access assertions in the kernels refer to image-length, crop-bound and loop-bound invariants; no compiler strictness settings were disabled.

Node smoke requires exact dev dependencies: onnxruntime-node1.20.1, sharp0.35.5, @napi-rs/canvas1.1.1 and esbuild0.28.2. Production browser runtime remains1.20.1. Browser gate for this port is http://localhost:5176/tests/e2e/ocr-gate.html.
