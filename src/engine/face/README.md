# Face engine

`detectFaces` and `embedFace` run in a serialized dedicated worker. `disposeFaceEngine` cancels pending work. Model weights are pinned in models.json and verified at download and worker load. Run `node scripts/fetch-models.mjs` first.

YuNet uses raw BGR CHW, 640-square bottom/right padding, score sqrt(class*objectness) >= 0.8, and IoU NMS 0.3. SFace uses a five-point similarity alignment to 112-square and raw RGB CHW: its graph contains normalization. Embeddings are L2 unit vectors.

Cosine >= 0.363 is OpenCV's LFW operating point; the intermediate >=0.212 band is a heuristic based on its CFP-FP operating point, not calibrated probability. These thresholds do not establish identity conclusively. Source: https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html . Model preprocessing follows pinned OpenCV Zoo models and OpenCV FaceDetectorYN/FaceRecognizerSF implementations.

YuNet is MIT; SFace is Apache-2.0. License source links and exact model hashes/revision/bytes are in the manifest. Weights are not committed.

Verification: `node src/engine/face/smoke.mjs` runs real ONNX models with onnxruntime-node. `node src/engine/face/browser-smoke.mjs` requires Vite on localhost:5190 and runs the real worker in Chromium with GPU disabled. Synthetic inputs validate execution and dimensions only, not detection accuracy or identity discrimination. WebGPU and physical-phone runtime remain unverified.
