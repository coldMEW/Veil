# Embedded Content Credentials

`readProvenance(bytes, assetId)` validates original file bytes and returns a shared CheckResult. Keep
originals for this check; cleaned/exported pixels have different provenance. SDK errors return
failed/inconclusive. Results never substitute a signed origin declaration for a scene-consistency finding.

SDK: exact @contentauth/c2pa-web0.17.0, API read from installed README/declarations: createC2pa({wasmSrc}),
Reader.fromBlob(runtime,format,blob,Context), reader.manifestStore(), reader.free(), runtime.dispose(). WASM
is imported from @contentauth/c2pa-web/resources/c2pa.wasm?url and served from the application origin. The
bundled blob worker is used because the SDK rejects HTTP workerSrc even on localhost. CSP must allow blob
workers and WASM compilation; connect-src remains self. No CDN is used.

Context explicitly sets verifyAfterReading:true, verifyTrust:false, verifyTimestampTrust:false,
remoteManifestFetch:false, ocspFetch:false, and verifyTrustList:false for trust/cawgTrust. No trust
anchor/list URLs are configured. No resource, thumbnail, identity-resolution, remote-manifest, OCSP or
trust-list API is called by this module. Signer trust is always unknown, independently of file/signature
integrity. A missing remote-only manifest cannot be validated offline.

Evidence separates manifestPresent, integrity/status/validationCodes, signer/details/trust, claimGenerator,
declaredSource and actions. An SDK failure has manifestPresent:null and integrity:not_checked. Missing
embedded credentials are not_applicable; verified intact credentials are consistent; integrity failures are
inconsistent. Those findings concern credentials, not scene authenticity.

Mapping tests use mock SDK output, including a trainedAlgorithmicMedia declaration that stays consistent.
Test-only trust warnings are kept separate from integrity errors. Text/claims are data; consumers must render
strings escaped rather than as HTML.

## Browser check

Start Vite on5181, then:

```powershell
npx playwright test tests/e2e/provenance.spec.ts --browser chromium --workers 1 --reporter list --output node_modules/.cache/provenance-results
```

The test generates an unsigned JPEG in canvas. It downloads the public CAI c2pa-rs CA.jpg fixture at test time
from revision0e92435c6d621c02c9bde2a8d82346295ed1f509, sdk/tests/fixtures/CA.jpg. Repository licensing was
checked at that revision (LICENSE-MIT/dual Apache-2.0); fixture ownership remains upstream. No fixture is
vendored or redistributed by this change. Source/license links:

- https://github.com/contentauth/c2pa-rs/blob/0e92435c6d621c02c9bde2a8d82346295ed1f509/sdk/tests/fixtures/CA.jpg
- https://github.com/contentauth/c2pa-rs/blob/0e92435c6d621c02c9bde2a8d82346295ed1f509/LICENSE-MIT

A second buffer alters three bytes after the MAIN JPEG Start-of-Scan; marker parsing skips embedded
APP/JUMBF/thumbnail segments. The embedded credentials remain present and the SDK must report
assertion.dataHash.mismatch. The test imposes connect-src self, blocks off-origin HTTP(S) in the browser
context and asserts zero attempted off-origin requests. Fixture download is performed by the Node test runner
before browser processing, not by the application or SDK. Development HMR websocket warnings under the
restrictive test policy do not constitute credential network requests.

This P1 library has no UI wiring and no trust-list support. Browser success on these fixtures does not
establish trusted signer identity, revocation status or the truth of signed declarations.
