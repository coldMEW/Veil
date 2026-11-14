# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

One React codebase. On the web it uses its own Veil design language. The Android app (Capacitor wrapper of the same build) follows Android-native conventions: Material-style navigation, system back, edge-to-edge with insets, bottom sheets, share target, saving to Pictures/Veil. (Confirmed by Bibek, 2026-11-14.)

## Users

Everyday people who are about to share, post or rely on a photo: they want to know whether it can be trusted and to remove private details (house numbers, licence plates, names on screens or documents) before it leaves their hands. Often on a phone, often one-handed, without technical vocabulary. Hackathon judges see this same flow. (Confirmed.)

## Product Purpose

Veil lets a person inspect a photo for evidence of editing or generation, clean private text out of it, and protect it against AI editing, all on the device. Success: a non-expert finishes Inspect, Clean or Protect without help and understands what each result does and does not show.

## Positioning

Everything runs locally in the browser or phone (ONNX Runtime Web, WASM/WebGPU); no image is uploaded. Results are presented as evidence with method and limitations, never as a "real or fake" verdict.

## Operating Context

Three jobs on one photo: Inspect (checks such as content credentials/C2PA, metadata, shadow and light geometry, eye highlights, frequency spectrum, model-focus map, face-warp), Clean (OCR finds private text and plates; user picks what to remove; MI-GAN inpaints; fresh PNG export with metadata stripped; automatic rescan), Protect (DiffVax immunisation so diffusion edits of the photo degrade, with a proof card). A printable A4 report with the file SHA-256 records what was checked.

## Capabilities and Constraints

- Models load on demand; core Clean models ship with the Android app, larger ones download only after consent with size shown and sha256 verified.
- Checks that are not built or did not run must say so plainly; nothing may look like a result when it is not.
- CSP connect-src 'self' on the web; COOP/COEP for WASM threads.
- Never blur, pixelate or redact people in photos; Clean removes text and plates only.
- Feature freeze Sat Nov 14 11 PM CT; code freeze Sun noon.

## Brand Commitments

Name: Veil. Voice: plain, calm, exact; sentence case; no hype, no "AI detector", no "real or fake".

## Evidence on Hand

Real team test photos exist locally but are private and must never be committed, shown in screenshots that are committed, or described by their OCR text. Use synthetic images for fixtures. No testimonials, users or benchmarks exist; do not invent them.

## Product Principles

1. Evidence, not verdicts: every result shows its method and limits.
2. The photo stays the hero; tools and results serve it.
3. One obvious next step at every moment.
4. Local and honest: say what runs on the device, what was downloaded and what did not run.
5. Reversible: nothing is changed or saved without the person choosing it.

## Accessibility & Inclusion

WCAG 2.2 AA: keyboard and screen-reader operable overlays and sheets, 44px touch targets, visible focus, reduced motion respected.
