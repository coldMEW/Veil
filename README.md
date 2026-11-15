# Veil — deepfake defence for everyday people

Someone made a fake of you. Veil helps you prove it, find it and take it down, from your phone.

- **Check** — is this picture faked? Veil runs its checks on your device and lists only strong evidence: signed Content Credentials (C2PA) that say "made with AI" or that no longer match the picture, AI tool names in the file, a camera preview that disagrees with the picture, an AI-image model score of 90+ (Community Forensics ViT), your own Veil mark, and the exact changes compared with your original photo. A check with no signal is not listed.
- **Find my face** — Veil learns your face from a selfie as 128 numbers (YuNet + SFace, on device; the selfie is never stored or sent). Paste any page and it reads every picture on it and compares each face with yours; copies of your own photos are caught with PDQ, the perceptual hash StopNCII uses. One-tap reverse search on Google Lens, Yandex, Bing and TinEye, and a watchlist.
- **Take it down** — every match opens a ticket by itself: the platform's own report form or the host's abuse address (found with DNS + RDAP), a written notice (platform impersonation rules, the US TAKE IT DOWN Act for intimate images with its 48-hour removal clock, DMCA when the fake was made from your photo, GDPR Art. 17 in the EU/UK), an evidence file with SHA-256 hashes, and a re-check that closes the ticket when the picture is gone.
- **Shield** — before you post: an invisible Veil mark (keyed DCT watermark that survives re-compression and resizing) so a fake made from your photo can be traced back to you, metadata stripped, and street signs, house numbers and plates painted out (PaddleOCR + MI-GAN). It does not make photos unreadable to AI apps; nothing invisible can.

Web: one React build (Vite). Android: the same build in Capacitor, with the face, OCR and fill models bundled so it works offline; it reads web pages with the native HTTP client, so it needs no server.

## Develop

Node 24.

```bash
npm ci
npm run dev            # http://localhost:5173, also serves /api/* (page scan, image fetch, host lookup)
npm run typecheck
npm test
npm run build
npm run build:android  # then: cd android && ./gradlew assembleDebug  (JDK 21)
```

`/api/*` is `server/handlers.ts`: it fetches only public http(s) addresses the person asked to scan (no private networks, size and time limits) and never receives their photo or face data. It runs as Vercel functions (`api/[action].ts`) and as Vite middleware in dev and preview.

## Verify

`scripts/verify/` drives the real app in Chromium (and the Android WebView over CDP) with the fictional demo character in `public/demo/source/`: face matching, scanning the demo leaks page (`/demo/leaks.html`), tickets, Shield then Check for the mark, and Clean on a photo you supply. Private photos stay outside the repository.


## Python backend

Python 3.11. Keep the virtual environment and database outside the repository. From the repository root:

```powershell
python -m venv ..\scratch-eval\backend-py-venv
..\scratch-eval\backend-py-venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm run build
$env:VEIL_DB = (Join-Path (Resolve-Path ..\scratch-eval) 'veil-tickets.sqlite3')
..\scratch-eval\backend-py-venv\Scripts\python.exe -m backend
```

The loopback server uses port 8787 and serves `dist/` when built, with COOP/COEP headers. Public page/image
fetching is DNS-pinned, redirects are checked again, and response time/size are bounded. Hunt uploads only
when explicitly called: never submit a private photo for automated acceptance. Yandex/Bing return provider
errors honestly; Lens requires server-side `SERPAPI_KEY` plus an already-public HTTPS image URL.

For Vite development, run the backend separately, then `$env:VEIL_BACKEND='python'; npm run dev`.
Only `/api` is proxied. Without that environment variable the existing TypeScript middleware remains active.
The SQLite ticket API records no image bytes or face data. It accepts explicit ticket/sent/reply events and
rechecks sent/acknowledged tickets every 15 minutes while the server is running. An overdue event is a
48-hour follow-up reminder, not a claim about a legal deadline. Back up/protect the database as personal data.

Optional SMTP/IMAP credentials belong only in the server environment; never `VITE_*` or browser storage.
Unconfigured sending returns 503, not success. A caller-recorded `/sent` event is not proof of delivery.
Bind only to loopback unless adding appropriate authentication and TLS for a multi-user deployment.

**Integration boundary:** the current frontend ticket store is still localStorage; Claude must wire its
create/update/read flows to `/api/tickets` before SQLite becomes the app's system of record. Android's native
fetch path also does not automatically use this Python server. Backend acceptance alone does not prove
Gmail/SMTP delivery, IMAP replies, Android integration, or UI end-to-end ticket synchronization.

```powershell
..\scratch-eval\backend-py-venv\Scripts\python.exe -m pytest backend/tests -q
python scripts/verify/run.py --backend-only --backend-python ..\scratch-eval\backend-py-venv\Scripts\python.exe
```
