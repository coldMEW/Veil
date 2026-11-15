# Veil — Video Evidence Passport

Veil is a browser-first prototype for documenting video evidence without pretending to decide whether a video is “real” or AI-generated.

It is designed around a simple principle: preserve the original file, make technical facts and uncertainty visible, and give a reviewer a defensible record of what they observed.

## What this MVP does

- Opens original MP4 and MOV files locally in the browser.
- Identifies the ISO Base Media / QuickTime container from the file bytes, rather than trusting the filename.
- Computes a SHA-256 hash for the exact original bytes.
- Sends the original only to a local evidence vault running on the same computer, which hashes and stores the source bytes once.
- Issues an Ed25519-signed local receipt containing the server hash, receipt time, public-key fingerprint, and custody events.
- Inspects detailed container facts: MP4/MOV brands, top-level box layout, fast-start position, fragmentation, data payload, duration, average data rate, metadata boxes, tracks, codecs, video dimensions, and audio sample details when declared.
- Detects a C2PA UUID container marker as a **candidate only**. It does not validate a Content Credential signature or trust chain yet.
- Runs the pinned, MIT-licensed [Detectra v3](https://huggingface.co/TensorFold/detectra-v1) trained synthetic-image classifier locally over up to 12 evenly selected video frames. Veil verifies the downloaded model against its published SHA-256 before inference, then records the exact model revision, fingerprint, sampled scores, and timestamped high-score review signals.
- Scans the original locally for timestamped review signals: abrupt full-frame transitions, localized changes, exposure shifts, possible held frames, abrupt audio transitions, and (when the browser supports it) face-track discontinuities.
- Places each signal on a review timeline with a sampled-frame thumbnail and a one-click jump back to the original moment.
- Keeps the scan explicitly non-conclusive: normal edits, motion, compression, lighting, and detector limitations can create the same patterns.
- Lets a reviewer mark timestamped visual, audio, provenance, custody, or context observations.
- Binds a saved automated scan to the SHA-256 of the locally sealed original and stores a signed, append-only scan record without saving its browser thumbnails into the vault.
- Exports a transparent JSON evidence package and offers a print-friendly report for saving as PDF.
- Supports two report routes: an insurance-evidence review and a personal-deepfake incident package that another reporting tool can consume.

## What it intentionally does not claim

- A hash proves the identity of a file’s bytes, not who made it or whether the depicted event occurred.
- Missing Content Credentials do not mean a video is AI-generated or manipulated.
- A reviewer observation is not a fraud conclusion.
- The local receipt is signed by a key on this computer. It is not an independent server timestamp, cloud WORM archive, or C2PA signature validation.
- The scan generates human-review prompts; it does not make a deepfake, fraud, lip-sync, voice-clone, or claim-validity decision.
- The trained model is a frame-level synthetic-media classifier aggregated across sampled frames. Its score is a review signal, not a calibrated probability that the entire video is AI-generated.
- On first use, the browser downloads the public, pinned 43.7 MB model artifact from Hugging Face and loads the model runtime locally. The original video and its sampled frames remain in the browser and are not sent to those hosts. If the model cannot load or its fingerprint differs from the pinned one, Veil records that it was unavailable rather than fabricating a result.
- To keep a browser-local review stable, audio decoding is skipped for files above 120 MiB; the rest of the evidence record and frame sampling still proceed.

## Run locally

Requires Node 20 or later.

```bash
npm test
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

`npm run dev` watches the project and restarts after code changes. If an older Veil server is already running, stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd> and run the command again before refreshing the browser.

## Local evidence vault

The server stores local case data under `.veil-evidence/`, which is excluded from Git. Each case contains:

- the original MP4/MOV bytes, stored once;
- a signed receipt with its SHA-256 and inspected technical facts;
- append-only saved reviewer observations; and
- hash-bound, append-only automated review runs; and
- a locally generated Ed25519 key pair used to verify receipt integrity.

This is a local prototype vault. Treat it as an engineering demonstration rather than legal custody infrastructure until it is backed by controlled retention, access logging, key management, and independent timestamping.

## Production direction

An insurer-ready version needs a custody service outside the browser:

1. Create a server-signed receipt when original bytes are uploaded.
2. Store the original without re-encoding in immutable, access-controlled storage.
3. Record append-only custody events and artifact hashes.
4. Run C2PA validation and video-analysis workers asynchronously.
5. Export a signed, verifiable evidence package that separates facts, signals, reviewer observations, and limitations.

Deepfake classifiers can become timestamped review signals in that workflow. They should not become an automatic claim-denial or “AI/not AI” verdict.
