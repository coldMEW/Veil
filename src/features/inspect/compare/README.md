# Original-supported comparison

`compareImages(original, suspect, assetId)` accepts orientation-corrected RGBA
`Pixels` and returns a contract-valid observational `CheckResult`. It is synchronous,
DOM-free and suitable for running inside the caller's worker. No new dependencies.

Alignment maps original source pixels into suspect source pixels:
`B = scale * A + (tx, ty)`. Scale is restricted to 0.5–2.0; rotation is unsupported.
Twenty-five logarithmic coarse scales use gradient phase correlation, followed by
normalized gradient correlation and a finer 512-pixel search. Confidence is the
phase peak-to-sidelobe ratio, not a probability. Correlation and overlap guards
reject weak matches.

Difference analysis uses at most a 1024-pixel longest side, Gaussian smoothing,
trimmed per-channel affine tone fitting, luma/chroma residuals, an 8x8 local mean,
median/MAD normalization, majority cleanup and connected components. Regions
smaller than 0.2% of overlap are suppressed. Scores are relative measurements.

Region rects and the raster rect are normalized in the suspect image frame.
Raster values cover only that rect: render the complement as unexamined/hatching,
never as a red difference. Region `area` is working-image component pixels.
Timing excludes decoding, orientation correction, UI rendering and worker transfer.

Limits: calibration is synthetic and one local derivative check, not a general
validation dataset. Nonlinear tone changes, substantial re-rendering, shadows,
local geometry changes and repeated textures can defeat alignment or produce
extra regions. Global normalization can hide widespread changes. Small or subtle
objects can be suppressed by blur and area thresholds. This is an observation,
not an attribution or origin detector. No browser/Android timing was measured.
