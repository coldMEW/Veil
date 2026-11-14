# Veil

A local-first photo workspace that runs in the browser on laptops and Android Chrome. Photos are opened on the device and are not uploaded.

## What works today

- Open a JPEG or PNG (up to 10 MiB and 12 megapixels). Files are identified by their bytes, not their name, and anything else is rejected with a visible reason.
- The exact SHA-256 of the original file is shown.
- The photo is drawn orientation-corrected on a canvas that stays sharp on high-density screens.
- Inspect, Clean and Protect Lab tabs. The checks are not built yet, and each one says so instead of showing a result.

## Develop

Requires Node 24 (see `.nvmrc`). Clone outside OneDrive, Dropbox or iCloud.

```bash
npm ci
npm run dev        # http://localhost:5173
npm run typecheck
npm test
npm run build
```

To test on an Android phone over USB, run `adb reverse tcp:5173 tcp:5173` and open `http://localhost:5173` in Chrome on the phone.
