# Protect engine

`DiffVaxImmunizer` only loads the pinned DiffVax artifact after SHA-256 verification. It performs an experimental local transform; protection is not established.

The pinned ONNX file is fetched to `public/models/diffvax/` by the model-fetch script and remains gitignored. Claude will mirror the reviewed artifact as a GitHub release asset before release; its URL must retain the pinned revision and SHA-256 recorded in `scripts/export/models.json`.

`tests/e2e/protect-gate.html?backend=wasm` and `?backend=webgpu` are development gates using synthetic pixels. `diffvax-gate.html` retains the direct 512-forward / `torch_ref.f32` numeric parity check.
