import { fetchImageBytes, scanPage } from './api';
import { bitmapToImageData, engines, PDQ_MATCH, thumbnail } from './engines';
import { decodeEmbedding, markKey, payloadHex, vaultFaces, vaultPhotos } from './vault';
import { createTicket, type Ticket } from './tickets';
import { sha256Hex } from '../features/clean/hash';
import { persisted } from './store';

export interface ScanHit {
  imageUrl: string;
  pageUrl: string;
  thumb: string;
  kind: 'face' | 'copy' | 'mark';
  score: number;
  label: string;
  ticketId: string;
}

export interface ScanProgress {
  stage: 'reading' | 'checking' | 'done' | 'failed';
  page: string;
  total: number;
  done: number;
  faces: number;
  hits: ScanHit[];
  skipped: number;
  error?: string;
}

export const watchlist = persisted<Array<{ url: string; addedAt: number; lastScan: number | null; hits: number }>>('veil.watch.v1', []);

const MAX_IMAGES = 40;

async function examine(imageUrl: string, pageUrl: string): Promise<ScanHit | null | 'faces'> {
  const blob = await fetchImageBytes(imageUrl);
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    if (bitmap.width < 64 || bitmap.height < 64) return null;
    const [face, fp, wm] = await Promise.all([engines.face(), engines.fingerprint(), engines.watermark()]);
    const pixels = bitmapToImageData(bitmap, 2048);
    let best: Omit<ScanHit, 'thumb' | 'ticketId' | 'imageUrl' | 'pageUrl'> | null = null;
    let sawFace = false;

    // 1. Your Veil mark: proof it was made from your photo.
    if (wm) {
      const r = await wm.detectMark(pixels, markKey());
      const hex = payloadHex(r.payload);
      if (r.found) {
        const photo = vaultPhotos.get().find((p) => p.mark === hex);
        best = { kind: 'mark', score: r.confidence, label: photo ? `Made from your photo "${photo.name}"` : 'Contains your Veil mark' };
      }
    }
    // 2. A copy of a photo you registered (PDQ, survives resizing and recompression).
    if (!best && fp && vaultPhotos.get().length) {
      const { hash } = await fp.pdqHash(bitmapToImageData(bitmap, 512));
      for (const p of vaultPhotos.get()) {
        if (!p.pdq) continue;
        const d = fp.hamming(hash, p.pdq);
        if (d <= (fp.PDQ_MATCH_THRESHOLD ?? PDQ_MATCH)) {
          best = { kind: 'copy', score: 1 - d / 256, label: `Copy of your photo "${p.name}"` };
          break;
        }
      }
    }
    // 3. Your face, anywhere in the picture.
    if (face && vaultFaces.get().length) {
      const found = await face.detectFaces(bitmap);
      sawFace = found.length > 0;
      const mine = vaultFaces.get().map((f) => decodeEmbedding(f.embedding));
      for (const f of found) {
        const e = await face.embedFace(bitmap, f);
        for (const m of mine) {
          const c = face.compareFaces(e, m);
          if (c.match === 'different') continue;
          if (!best || (best.kind === 'face' && c.cosine > best.score)) {
            best = { kind: 'face', score: c.cosine, label: c.match === 'same' ? 'Your face' : 'Possibly your face' };
          }
        }
      }
    }
    if (!best) return sawFace ? 'faces' : null;

    const thumb = await thumbnail(bitmap);
    const sha = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
    const detail =
      best.kind === 'face'
        ? `Face match: similarity ${best.score.toFixed(2)} to the face I registered (same person at 0.36 and above).`
        : best.kind === 'copy'
          ? `${best.label}, matched by PDQ perceptual hash.`
          : `${best.label}: my private watermark was detected in this image.`;
    const ticket: Ticket = createTicket({
      pageUrl,
      imageUrl,
      match: { kind: best.kind, score: best.score, detail },
      thumb,
      imageSha256: sha,
    });
    return { ...best, imageUrl, pageUrl, thumb, ticketId: ticket.id };
  } finally {
    bitmap.close();
  }
}

/** Scan one page (or one image address). Calls back as it goes. */
export async function scan(url: string, onProgress: (p: ScanProgress) => void, signal?: AbortSignal): Promise<ScanProgress> {
  const p: ScanProgress = { stage: 'reading', page: url, total: 0, done: 0, faces: 0, hits: [], skipped: 0 };
  onProgress({ ...p });
  try {
    const page = await scanPage(url);
    if (page.status >= 400) throw new Error(`The site answered ${page.status}.`);
    const images = page.images.slice(0, MAX_IMAGES);
    p.stage = 'checking';
    p.total = images.length;
    onProgress({ ...p });
    let next = 0;
    const worker = async () => {
      while (next < images.length && !signal?.aborted) {
        const img = images[next++]!;
        try {
          const r = await examine(img.url, page.pageUrl);
          if (r === 'faces') p.faces++;
          else if (r) {
            p.faces++;
            p.hits = [...p.hits, r];
          }
        } catch {
          p.skipped++;
        }
        p.done++;
        onProgress({ ...p, hits: [...p.hits] });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    p.stage = 'done';
  } catch (e) {
    p.stage = 'failed';
    p.error = e instanceof Error ? e.message : 'The page could not be scanned.';
  }
  onProgress({ ...p });
  watchlist.set((list) => list.map((w) => (w.url === url ? { ...w, lastScan: Date.now(), hits: p.hits.length } : w)));
  return p;
}

/** One-tap reverse searches. Each one sends the picture to that company, so the person chooses. */
export const SEARCH_ENGINES = [
  { id: 'lens', name: 'Google Lens', byUrl: (u: string) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(u)}`, upload: 'https://lens.google.com/' },
  { id: 'yandex', name: 'Yandex Images', byUrl: (u: string) => `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(u)}`, upload: 'https://yandex.com/images/' },
  { id: 'bing', name: 'Bing Visual Search', byUrl: (u: string) => `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encodeURIComponent(u)}`, upload: 'https://www.bing.com/visualsearch' },
  { id: 'tineye', name: 'TinEye', byUrl: (u: string) => `https://tineye.com/search?url=${encodeURIComponent(u)}`, upload: 'https://tineye.com/' },
  { id: 'pimeyes', name: 'PimEyes (face search)', byUrl: null, upload: 'https://pimeyes.com/en' },
] as const;
