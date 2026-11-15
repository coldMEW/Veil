import { useEffect, useMemo, useState } from 'react';
import { readProvenance, AI_SOURCE_TYPES, type ProvenanceResult } from '../features/inspect/provenance/contentCredentials';
import { useModelFocus } from '../features/inspect/model/useModelFocus';
import { sigmoid, OUTPUT_STRONG } from '../features/inspect/model/preprocess';
import {
  compareThumbnail,
  decodeThumbnail,
  exifOrientation,
  extractExifThumbnail,
  orientThumbnailLike,
  type ThumbnailComparison,
} from '../features/inspect/forensics/exifThumbnail';
import { compareImages } from '../features/inspect/compare';
import { bitmapToImageData, engines, type Face, type MarkResult } from './engines';
import { markKey, payloadHex, vaultPhotos } from './vault';

/** One piece of evidence that is strong enough to show. Weak or empty checks never become one. */
export interface Evidence {
  id: 'credentials' | 'metadata' | 'ai-model' | 'preview' | 'mark' | 'original';
  tone: 'fake' | 'real' | 'source';
  title: string;
  says: string;
  how: string;
}

export type Verdict = 'checking' | 'fake' | 'derived' | 'signed' | 'unclear';

const AI_TYPES = new Set(['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia', 'algorithmicMedia', 'compositeSynthetic']);

export function provenanceEvidence(r: ProvenanceResult): Evidence[] {
  const out: Evidence[] = [];
  const c = r.credentials;
  const aiTypes = [...new Set([...c.sourceTypes, ...r.hints.sourceTypes])].filter((t) => AI_TYPES.has(t));
  if (c.present && c.contentChanged) {
    out.push({
      id: 'credentials',
      tone: 'fake',
      title: 'Changed after it was signed',
      says: `This picture carries Content Credentials${c.signer ? ` signed by ${c.signer}` : ''}, but its pixels no longer match what was signed.`,
      how: 'C2PA signature check with the official Content Authenticity SDK, on this device.',
    });
  } else if (c.present && aiTypes.length) {
    out.push({
      id: 'credentials',
      tone: 'fake',
      title: 'Made with AI, by its own label',
      says: `${AI_SOURCE_TYPES[aiTypes[0]!] ?? aiTypes[0]}${c.generator ? ` (${c.generator})` : ''}. The label is signed${c.signer ? ` by ${c.signer}` : ''} and still matches the picture.`,
      how: 'C2PA Content Credentials, read and verified on this device.',
    });
  } else if (c.present && c.sourceTypes.includes('digitalCapture') && !c.contentChanged) {
    out.push({
      id: 'credentials',
      tone: 'real',
      title: 'Signed by the camera, unchanged',
      says: `The camera${c.signer ? ` (${c.signer})` : ''} signed this picture when it was taken, and not a pixel has changed since.`,
      how: 'C2PA Content Credentials, read and verified on this device.',
    });
  }
  if (!out.length && (r.hints.toolNames.length || aiTypes.length)) {
    const names = [...new Set(r.hints.toolNames)].slice(0, 3);
    out.push({
      id: 'metadata',
      tone: 'fake',
      title: 'The file names an AI tool',
      says: names.length
        ? `Hidden file data says it was made or edited with ${names.join(', ')}.`
        : `Hidden file data declares it as ${AI_SOURCE_TYPES[aiTypes[0]!] ?? 'AI-made'}.`,
      how: 'Read from the XMP, EXIF and PNG text inside the original file.',
    });
  }
  return out;
}

export function previewEvidence(cmp: ThumbnailComparison): Evidence | null {
  const differs = cmp.aspectRatioDifference > 0.02 || cmp.meanDifference > 12 || cmp.differingCells.length >= 2;
  if (!differs) return null;
  return {
    id: 'preview',
    tone: 'fake',
    title: 'The hidden preview shows something else',
    says: 'Cameras store a small preview inside each photo. This one no longer matches the picture: the picture was edited after it was taken.',
    how: 'The embedded EXIF preview compared with the full image, cell by cell.',
  };
}

export function aiEvidence(maxProbability: number): Evidence | null {
  if (maxProbability < OUTPUT_STRONG) return null;
  return {
    id: 'ai-model',
    tone: 'fake',
    title: 'Looks AI-generated to our model',
    says: `Our detector, trained on images from thousands of generators, scores this picture ${Math.round(maxProbability * 100)} out of 100 for AI-made.`,
    how: 'Community Forensics ViT (MIT), run on this device over three views of the picture.',
  };
}

export function markEvidence(mark: MarkResult): Evidence | null {
  if (!mark.found) return null;
  const hex = payloadHex(mark.payload);
  const photo = vaultPhotos.get().find((p) => p.mark === hex);
  return {
    id: 'mark',
    tone: 'source',
    title: 'Made from your photo',
    says: photo
      ? `Your invisible Veil mark is still inside. This picture was made from "${photo.name}", which you shielded on ${new Date(photo.addedAt).toLocaleDateString()}.`
      : 'Your invisible Veil mark is inside: this picture was made from a photo you shielded with Veil.',
    how: `Keyed watermark read on this device${hex ? ` (mark ${hex.slice(0, 8)})` : ''}. Only your key can find it.`,
  };
}

export interface CheckInput {
  assetId: string;
  bytes: Uint8Array;
  mimeType: string;
  bitmap: ImageBitmap;
}

export interface OriginalComparison {
  says: string;
  regions: Array<{ x: number; y: number; w: number; h: number }>;
  changed: boolean;
}

/** Runs every strong check on the open image and keeps only the decisive ones. */
export function useCheck(input: CheckInput | null, original: ImageBitmap | null) {
  const assetId = input?.assetId ?? null;
  const [provenance, setProvenance] = useState<ProvenanceResult | null>(null);
  const [preview, setPreview] = useState<ThumbnailComparison | null | 'none'>(null);
  const [mark, setMark] = useState<MarkResult | null | 'none'>(null);
  const [faces, setFaces] = useState<Face[] | null | 'none'>(null);
  const [comparison, setComparison] = useState<OriginalComparison | null>(null);
  const model = useModelFocus(assetId, input?.bitmap ?? null);

  useEffect(() => {
    setProvenance(null);
    setPreview(null);
    setMark(null);
    setFaces(null);
    if (!input) return;
    let live = true;
    void readProvenance(input.bytes, input.mimeType).then((r) => live && setProvenance(r));
    void (async () => {
      const thumbBytes = extractExifThumbnail(input.bytes);
      if (!thumbBytes) return live && setPreview('none');
      try {
        const bmp = await decodeThumbnail(thumbBytes);
        const t = bitmapToImageData(bmp);
        bmp.close();
        const main = bitmapToImageData(input.bitmap, 1024);
        const thumb = orientThumbnailLike({ rgba: t.data, width: t.width, height: t.height }, main, exifOrientation(input.bytes));
        if (live) setPreview(compareThumbnail(thumb, { rgba: main.data, width: main.width, height: main.height }));
      } catch {
        if (live) setPreview('none');
      }
    })();
    void (async () => {
      const wm = await engines.watermark();
      if (!wm) return live && setMark('none');
      try {
        const r = await wm.detectMark(bitmapToImageData(input.bitmap, 2048), markKey());
        if (live) setMark(r);
      } catch {
        if (live) setMark('none');
      }
    })();
    void (async () => {
      const fe = await engines.face();
      if (!fe) return live && setFaces('none');
      try {
        const found = await fe.detectFaces(input.bitmap);
        if (live) setFaces(found);
      } catch {
        if (live) setFaces('none');
      }
    })();
    return () => {
      live = false;
    };
  }, [input]);

  // The AI-image model starts by itself; it is the slowest check.
  const { run } = model;
  useEffect(() => {
    if (assetId) void run();
  }, [assetId, run]);

  useEffect(() => {
    setComparison(null);
    if (!input || !original) return;
    const timer = window.setTimeout(() => {
      try {
        const a = bitmapToImageData(original, 1600);
        const b = bitmapToImageData(input.bitmap, 1600);
        const r = compareImages({ width: a.width, height: a.height, data: a.data }, { width: b.width, height: b.height, data: b.data }, input.assetId);
        const regions = (r.overlays ?? []).flatMap((o) => ('rect' in o && o.rect ? [{ x: o.rect.x, y: o.rect.y, w: o.rect.width, h: o.rect.height }] : []));
        setComparison({ says: r.observation, regions, changed: r.finding === 'inconsistent' || regions.length > 0 });
      } catch (e) {
        setComparison({ says: e instanceof Error ? e.message : 'The two pictures could not be compared.', regions: [], changed: false });
      }
    }, 30);
    return () => window.clearTimeout(timer);
  }, [input, original]);

  const aiProbability = useMemo(() => {
    if (model.state.status !== 'done') return null;
    const r = model.state.result;
    const logits = r.views?.length ? r.views.map((v) => v.logit) : [r.logit];
    return sigmoid(Math.max(...logits));
  }, [model.state]);

  const evidence = useMemo(() => {
    const list: Evidence[] = [];
    if (mark && mark !== 'none') {
      const e = markEvidence(mark);
      if (e) list.push(e);
    }
    if (comparison?.changed) {
      list.push({
        id: 'original',
        tone: 'fake',
        title: 'Changed from your original',
        says: comparison.says,
        how: 'Your original aligned to this picture, then compared colour by colour.',
      });
    }
    if (provenance) list.push(...provenanceEvidence(provenance));
    if (preview && preview !== 'none') {
      const e = previewEvidence(preview);
      if (e) list.push(e);
    }
    if (aiProbability !== null) {
      const e = aiEvidence(aiProbability);
      if (e) list.push(e);
    }
    return list;
  }, [mark, comparison, provenance, preview, aiProbability]);

  const pending: string[] = [];
  if (input) {
    if (!provenance) pending.push('Reading Content Credentials');
    if (preview === null) pending.push('Comparing the hidden preview');
    if (mark === null) pending.push('Looking for your Veil mark');
    if (model.state.status === 'idle' || model.state.status === 'loading') pending.push('Loading the AI-image model');
    if (model.state.status === 'running') pending.push(`AI-image model ${model.state.done}/${model.state.total}`);
  }
  const modelFailed = model.state.status === 'failed' ? model.state.message : null;

  const verdict: Verdict = evidence.some((e) => e.tone === 'fake')
    ? 'fake'
    : evidence.some((e) => e.tone === 'source')
      ? 'derived'
    : pending.length
      ? 'checking'
      : evidence.some((e) => e.tone === 'real')
        ? 'signed'
        : 'unclear';

  return { evidence, pending, verdict, faces: faces === 'none' ? null : faces, facesUnavailable: faces === 'none', aiProbability, modelFailed, comparison };
}
