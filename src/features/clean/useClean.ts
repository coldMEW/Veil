import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrivacyCandidate, TransformRecord } from '../../contracts';
import { OcrEngine, type ScanProgress } from './ocr/engine';
import { MiganInpainter, MIGAN_MODEL } from './inpaint';
import type { Pixels } from './mask';
import {
  candidatesFromOcr,
  rescanExport,
  runClean,
  textRemovalMask,
  TEXT_REMOVAL_DEFAULTS,
  type RescanResult,
} from './session';

export type FillMethod = 'migan_inpaint' | 'solid_redaction';

export type CleanState =
  | { status: 'idle' }
  | { status: 'scanning'; progress: ScanProgress | null }
  | { status: 'review'; candidates: PrivacyCandidate[] }
  | { status: 'cleaning'; candidates: PrivacyCandidate[]; step: string }
  | {
      status: 'done';
      candidates: PrivacyCandidate[];
      method: FillMethod;
      bytes: Uint8Array;
      sha256: string;
      metadataBlocks: string[];
      roundTripMismatches: number;
      rescan: RescanResult;
      selectedCount: number;
      transforms: TransformRecord[];
      preview: ImageBitmap;
      fellBack: string | null;
    }
  | { status: 'failed'; message: string; candidates: PrivacyCandidate[] | null };

/** Orientation-corrected RGBA pixels from the decoded bitmap. Stays in memory only. */
function bitmapPixels(bitmap: ImageBitmap): Pixels {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser could not read the photo pixels.');
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: img.width, height: img.height, data: img.data };
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/**
 * Clean flow: find text (OCR) -> person chooses -> remove -> fresh PNG -> re-scan the exported pixels.
 * Nothing is stored or sent; changing the photo cancels work and clears everything (product rule 7).
 */
export function useClean(assetId: string | null, sha256: string | null, bitmap: ImageBitmap | null) {
  const [state, setState] = useState<CleanState>({ status: 'idle' });
  const engineRef = useRef<OcrEngine | null>(null);
  const inpainterRef = useRef<MiganInpainter | null>(null);
  const pixelsRef = useRef<Pixels | null>(null);
  const runRef = useRef(0);
  const cleanWithRef = useRef<((c: PrivacyCandidate[], m: FillMethod) => Promise<void>) | null>(null);

  useEffect(() => {
    runRef.current++;
    engineRef.current?.dispose();
    engineRef.current = null;
    pixelsRef.current = null;
    setState((prev) => {
      if (prev.status === 'done') prev.preview.close();
      return { status: 'idle' };
    });
  }, [assetId]);

  useEffect(() => () => engineRef.current?.dispose(), []);

  const pixels = useCallback(() => {
    if (!bitmap) throw new Error('No photo is open.');
    pixelsRef.current ??= bitmapPixels(bitmap);
    return pixelsRef.current;
  }, [bitmap]);

  const engine = useCallback(async () => {
    let e = engineRef.current;
    if (!e || e.state !== 'ready') {
      e?.dispose();
      e = new OcrEngine();
      engineRef.current = e;
      await e.load('/models/ocr/', { detVariant: 'v3' });
    }
    return e;
  }, []);

  /** With `auto`, the confidently found high-risk text (house numbers, plates, street names…) is removed straight away. */
  const scan = useCallback(async (opts: { auto?: boolean } = {}) => {
    if (!assetId || !sha256) return;
    const run = ++runRef.current;
    setState({ status: 'scanning', progress: null });
    try {
      const e = await engine();
      const boxes = await e.scan(pixels(), {
        onProgress: (p) => run === runRef.current && setState({ status: 'scanning', progress: p }),
      });
      if (run !== runRef.current) return;
      const candidates = candidatesFromOcr(sha256, boxes);
      setState({ status: 'review', candidates });
      if (opts.auto && candidates.some((c) => c.selected)) await cleanWithRef.current?.(candidates, 'migan_inpaint');
    } catch (err) {
      if (run !== runRef.current) return;
      setState(isAbort(err) ? { status: 'idle' } : { status: 'failed', message: message(err), candidates: null });
    }
  }, [assetId, sha256, engine, pixels]);

  const cancel = useCallback(() => {
    runRef.current++;
    engineRef.current?.cancel();
    setState({ status: 'idle' });
  }, []);

  const toggle = useCallback((id: string) => {
    setState((prev) =>
      prev.status === 'review'
        ? { ...prev, candidates: prev.candidates.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)) }
        : prev,
    );
  }, []);

  const setAll = useCallback((selected: boolean) => {
    setState((prev) =>
      prev.status === 'review' ? { ...prev, candidates: prev.candidates.map((c) => ({ ...c, selected })) } : prev,
    );
  }, []);

  const cleanWith = useCallback(
    async (candidates: PrivacyCandidate[], method: FillMethod) => {
      if (!sha256) return;
      const selected = candidates.filter((c) => c.selected);
      if (!selected.length) return;
      const run = ++runRef.current;
      const step = (s: string) => run === runRef.current && setState({ status: 'cleaning', candidates, step: s });
      try {
        const src = pixels();
        step('Building the removal mask');
        const { mask, dilatePx } = textRemovalMask(src, candidates);
        let used: FillMethod = method;
        let fellBack: string | null = null;
        let inpainter: MiganInpainter | undefined;
        if (method === 'migan_inpaint') {
          try {
            step('Loading the fill model');
            if (!inpainterRef.current || inpainterRef.current.state !== 'ready') {
              const m = new MiganInpainter();
              await m.load(`/models/migan/${MIGAN_MODEL.file}`, 'wasm');
              inpainterRef.current = m;
            }
            inpainter = inpainterRef.current;
          } catch (err) {
            used = 'solid_redaction';
            fellBack = `The fill model could not load (${message(err)}), so the selected text was covered with solid blocks instead.`;
          }
        }
        step(used === 'migan_inpaint' ? 'Filling the selected text' : 'Covering the selected text');
        const out = await runClean({
          src,
          srcSha256: sha256,
          mask,
          expansionPx: dilatePx,
          method: used,
          inpainter,
          inpaintMaxSide: TEXT_REMOVAL_DEFAULTS.inpaintMaxSide,
          modelSha256: used === 'migan_inpaint' ? MIGAN_MODEL.sha256 : undefined,
        });
        step('Re-scanning the exported file');
        const e = await engine();
        const rescan = await rescanExport(e, out.verification.decoded, selected);
        const d = out.verification.decoded;
        const preview = await createImageBitmap(new ImageData(new Uint8ClampedArray(d.data), d.width, d.height));
        if (run !== runRef.current) {
          preview.close();
          return;
        }
        setState({
          status: 'done',
          candidates,
          method: used,
          bytes: out.bytes,
          sha256: out.verification.sha256,
          metadataBlocks: out.verification.metadata.metadataBlocks,
          roundTripMismatches: out.verification.roundTripMismatches,
          rescan,
          selectedCount: selected.length,
          transforms: out.transforms,
          preview,
          fellBack,
        });
      } catch (err) {
        if (run !== runRef.current) return;
        setState({ status: 'failed', message: message(err), candidates });
      }
    },
    [sha256, pixels, engine],
  );

  cleanWithRef.current = cleanWith;

  const clean = useCallback(
    async (method: FillMethod) => {
      if (state.status !== 'review') return;
      await cleanWith(state.candidates, method);
    },
    [state, cleanWith],
  );

  const backToReview = useCallback(() => {
    setState((prev) => {
      if (prev.status === 'done') {
        prev.preview.close();
        return { status: 'review', candidates: prev.candidates };
      }
      if (prev.status === 'failed' && prev.candidates) return { status: 'review', candidates: prev.candidates };
      return { status: 'idle' };
    });
  }, []);

  return { state, scan, cancel, toggle, setAll, clean, backToReview };
}
