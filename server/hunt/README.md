# Reverse-image candidate search

Pure TypeScript engine entry: `server/hunt/index.ts`. No Node/native dependencies in production modules. `hunt({bytes,type}, transport, opts)` uploads only after an explicit user action. This sends pixels to third-party providers; callers must explain that and obtain consent. `huntByUrl(publicHttpsUrl, transport, opts)` supports Bing/Lens URL mode without hosting an image. These are candidate URLs, never face-match or deepfake verdicts. Match faces on-device before creating tickets.

Transport implements get/postMultipart per types.ts. Optional withDeadline(deadlinePerformanceMs) enables execution cancellation; the fetch transport implements remaining-budget aborts per request/redirect. Basic adapters still get bounded returned results and no requests after expiry, but must cancel their own in-flight operation. Android supplies CapacitorHttp, cookie/session handling and ≤1024px upload preparation. Do not use browser cross-origin fetch as a substitute for native HTTP. Browser bundle compilation was verified; Android runtime is not yet verified.

- Yandex: current maintained-client prg=1/upfile HTML redirect, warm Images cookie session, ImagesApp data-state source sites plus similar list. Legacy JSON-block upload is not required. HTTP/parse/captcha failure is explicit; source hits survive optional enrichment errors as partial hits with ok:false/error.60-hit cap prioritizes host diversity so one image-board domain cannot crowd out other sources.
- Bing: base64 multipart upload and token/signature insights flow. Current live tests return a generic landing page without token/signature; reports parse-error, never fabricated matches. Experimental adapter retained for when provider support returns. URL mode also requires actual reverse-search proof before parsing images.
- Lens: SerpApi only with a server key and public HTTPS imageUrl. No key or no URL yields an explicit skipped/error result when requested. No image is silently uploaded/hosted to create a URL. Native API validates resolved source addresses; portable adapters should enforce DNS boundaries outside the core. SerpApi success was NOT tested because no key was available; real401 response is recorded.
- Web: optional quoted-name and quoted-name+(deepfake OR leak OR nude) DuckDuckGo HTML searches. Name queries leave the device. Maximum3 names/6 queries, each engine budget20s. Results are pages to scan, not accusations. Actual DuckDuckGo result anchors are recorded in fixtures.

Each engine independently returns `{engine,ok,hits,error?,ms}`. Only http(s) result URLs without credentials are retained; exact pageUrl+imageUrl duplicates removed. Cap60 per engine. Errors never mean there were no appearances. Captchas are not solved or bypassed.

## HTTP API

`api/hunt.ts` exports POST/GET for `/api/hunt`. POST accepts raw JPEG/PNG/WebP (8MiB maximum) or multipart file `image`. Optional query/form fields `engines` and `names` use comma lists; `imageUrl` must be public HTTPS. Returns bare HuntResult[]. Errors use400/405/413/415/429/502 with `{error}`. Server uses only process.env.SERPAPI_KEY, never accepts a client key. Sharp strips metadata and prepares JPEG85,longest side≤1024 before reverse uploads; original pixels are not persisted. No dependencies added.

Rate limiting is per-process10/min: trusted Vercel forwarded IP in Vercel; otherwise conservative shared bucket unless an adapter injects a trusted key. Enforcement precedes body parsing; memory capped. This is not a distributed limiter.

IMPORTANT: the existing Vite middleware still drops POST bodies. Its small stream-forwarding patch is outside this task's ownership and was handed to Claude at scratch-eval/hunt01-vite-body.patch. The exported POST handler passed a real HTTP-server+provider test independently; local Vite and the Android/UI integrations must be wired by their owner before claiming full app acceptance. The app-facing scan/image SSRF guard retains its previously documented DNS-rebinding limitation.

## Verification

- `node tests/hunt-network.mjs [external-out-dir]`: downloads the exact Commons source, resizes it to768px JPEG85, runs actual providers on it and on the fictional demo, saves raw provider responses and numeric results outside the repo. Exit nonzero unless a returned page matches that source's Wikipedia file URL.
- `node tests/hunt-api-network.mjs [external-out-dir]`: after the above input download, serves the actual exported POST handler on an ephemeral local port, uploads the full5.28MB source, performs real providers, checks the expected Wikipedia file URL. No mock transport.
- `npx tsc --noEmit -p tsconfig.json`; `npx vitest run --testTimeout=20000`; `npx vite build`.
- Fixtures in tests/hunt/fixtures are trimmed/extracted real responses. Positive Bing/Lens schema examples in tests are clearly synthetic; they do not establish live-provider success. Yandex provenance records the raw-response SHA256.

Protocol sources: [PicImageSearch pinned source](https://github.com/kitUIN/PicImageSearch/tree/784713e546273a09aae4b247a8b6f798825efafa/PicImageSearch/engines), [Yandex parser schema](https://github.com/kitUIN/PicImageSearch/blob/784713e546273a09aae4b247a8b6f798825efafa/PicImageSearch/model/yandex.py), [SerpApi Lens docs](https://serpapi.com/google-lens-api).
