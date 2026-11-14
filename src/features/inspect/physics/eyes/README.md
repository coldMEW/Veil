# Eye highlight observations

Exports from index.ts:

- extractHighlights(crop: Pixels): Highlight[] — crop-local normalized pixel-center centroid, area in pixels, peak luma and crop-pixel bbox. Eight-connected components use inclusive threshold max(220, nearest-rank99th percentile of luma). Components below2pixels or above15% of crop area are dropped; descending area order, top5. Transparent RGB is composited onto dark before luma.
- eyeObservation(pixels, assetId, leftRect, rightRect): CheckResult — rectangles use normalized orientation-corrected image coordinates. Integer crops round outward. No crop comparison metric is computed. Result contains full-image-normalized shell box/point overlays and pixel crop bounds in evidence.cropsPx. Invalid/out-of-bounds or undersized crops produce not_applicable; missing highlights in both also produces not_applicable. One eye with highlights is inconclusive. Malformed RGBA buffers throw.
- sideBySide(pixels,leftRect,rightRect,size=128) — returns left/right {pixels,highlights,markers}. Each pixels buffer is a square RGBA preview, stretched from the crop using nearest-neighbor sampling. Markers use preview-pixel coordinates; highlight centroids retain crop-normalized coordinates. Input pixels are not modified. Invalid bounds/size throw; previews may be made for small crops even though observation applicability requires12pixels per side.

When both rectangles are valid, results contain two box overlays plus one points overlay. For an invalid rectangle only valid crop boxes are emitted; an invalid or non-finite box is never sent to the renderer. If either crop fails applicability, neither eye is analyzed and the reason explains why.

The requested limitation included a word also forbidden by the requested result-JSON regex. Its meaning is retained as: “Matching or non-matching highlights alone do not establish an image’s origin or editing history.”

No model, network request, input persistence, UI or dependencies. Detection is a bounded brightness observation with stated assumptions; glasses, lenses, occlusion, lighting, geometry, resolution and compression can affect results. Thresholding is not a validated reflection detector. No similarity score or origin conclusion is emitted.
