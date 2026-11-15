# Ownership watermark format v1

Engine-only prototype. `embedMark(image, key32, payload)` returns same-size RGBA; payload is an unsigned bigint or decimal string up to 64 bits. `detectMark` returns the decoded decimal payload only on checksum/sync success. Keys must be 32 cryptographically random bytes; generate with crypto.getRandomValues, never a password or public asset ID. Do not persist keys or biometric data in reports.

Canonical 512x512 luminance, independent of aspect ratio, carries a keyed spatially spread repetition code in the (2,1) orthonormal 8x8 DCT coefficient. Binary QIM step 28, keyed ChaCha20 permutation and whitening, 64 payload bits + CRC32 + 16 sync bits, 36/37 spatial repetitions. A smooth luminance correction is bilinearly upsampled back to the source resolution; alpha is preserved. This is keyed QIM with spatial spreading, not a claim to reproduce any published commercial watermark.

Detection tries the full frame and four known 20%-single-edge crop hypotheses (left/right/top/bottom). Arbitrary crops, rotation, perspective changes, screenshots, heavy editing and deliberate watermark removal are not supported or guaranteed. It is not a cryptographic signature, and does not prove legal ownership, an unchanged image, or resistance to adaptive attacks. CRC is an error check, not authentication. Never present it as a verdict.

`confidence` is mean repetition vote margin, not a calibrated probability. `bitErrors` counts repetition disagreements against the recovered codeword, not independently known channel errors. `createMarkReader` copies analysis for repeated key queries, including all crop hypotheses, without retaining the caller's pixels. No model/network dependency.

Heavy operations can run through watermark.worker.ts: request {id,kind:'embed'|'detect',image,key,payload?}; response {id,value} or {id,error}. Embedding returns transferred ImageData. Instantiate as a module worker and terminate to cancel; no UI wiring is included.

Synthetic tests use a 1024-square photo-like texture, real sharp JPEG75, half-size Lanczos resize, 20% left crop, central 30%-area replacement, wrong keys and 1000-key unmarked trials. These establish observed behavior on that texture only. PSNR is measured over RGB, not alpha. Zero observed false positives is not a population-rate guarantee. Browser/phone worker behavior and real-photo robustness require separate acceptance.
