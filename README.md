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
- Runs [Detectra v3](https://huggingface.co/TensorFold/detectra-v1) and [imdet PE-Small](https://huggingface.co/Deckard618/imdet) locally on up to 24 sampled frames. Consecutive flagged samples appear as a passage in the report. Exact model details and frame scores remain in the evidence export.
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
- On first use, the browser downloads around 91 MB of public model files from Hugging Face. It verifies the pinned hashes and runs both checks locally. The optional Google SynthID link opens Google's verification instructions for users who choose to share a clip with Google.
- To keep a browser-local review stable, audio decoding is skipped for files above 120 MiB; the rest of the evidence record and frame sampling still proceed.

## Run locally

Requires Node 20.12 or later.

```bash
npm test
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

### Optional cloud checks

Copy `.env.example` to `.env` in the project folder, fill in the keys you have, and restart Veil. The server also accepts environment variables set before running `npm run dev`. Keep keys out of Git and out of the browser.

- `GEMINI_API_KEY` enables Google's video and sound observations. `VEIL_GEMINI_MODEL` optionally overrides the default `gemini-3.8-flash`.
- `HIVE_API_KEY` enables Hive timestamped generation and face-manipulation scores. Use the API key for a Hive AI-Generated Image and Video Detection project.
- `OPENAI_API_KEY` enables a GPT comparison and OpenAI provenance checks on up to four JPEG stills. Veil prioritizes before-and-after samples around flagged passages. The key's organization needs separate access to the Content Provenance API for its watermark checks. `VEIL_OPENAI_MODEL` optionally overrides `gpt-5-mini`.

Select **Run all connected cloud checks on this video** before opening a clip, or click **Send media for cloud checks** after opening it. The prototype accepts MP4 or MOV clips up to 14 MB and 90 seconds for this option. The report groups results by time and shows failed checks in **Check details**. Google's official SynthID video verifier remains an external user-run check. The OpenAI verifier accepts images and audio, so Veil submits sampled stills and reports detections at their timestamps.

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
