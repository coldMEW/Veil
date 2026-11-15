import { useEffect, useMemo, useRef, useState } from 'react';
import { closeImage, openImageFile, useImageSession } from '../../lib/runtime/imageSession';
import { useClean } from '../../features/clean/useClean';
import { bitmapToImageData, engines, thumbnail } from '../../services/engines';
import { markKey, newMarkPayload, payloadHex, vaultPhotos } from '../../services/vault';
import { sha256Hex } from '../../features/clean/hash';
import { isAndroid } from '../../platform/environment';
import { saveCleanCopy } from '../../platform/native';
import { uid } from '../../services/store';
import { DropZone } from '../shared/DropZone';
import { PhotoView } from '../shared/PhotoView';
import { BeforeAfter } from './BeforeAfter';
import { toast } from '../App';

const CATEGORY: Record<string, string> = {
  plate: 'Licence plate',
  house_number: 'House or room number',
  street_sign: 'Street sign',
  address: 'Address',
  email: 'Email address',
  phone: 'Phone number',
  name: 'Name',
  text: 'Other text',
};

interface Result {
  bytes: Uint8Array;
  url: string;
  bitmap: ImageBitmap;
  marked: boolean;
  removed: number;
  name: string;
}

export default function ShieldScreen() {
  const session = useImageSession();
  const ready = session.status === 'ready' ? session : null;
  const clean = useClean(ready?.asset.id ?? null, ready?.asset.sha256 ?? null, ready?.bitmap ?? null);
  const [mark, setMark] = useState(true);
  const [wipe, setWipe] = useState(true);
  const [stage, setStage] = useState<'options' | 'working' | 'review' | 'done'>('options');
  const [step, setStep] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const finishing = useRef(false);

  useEffect(() => {
    setStage('options');
    setResult(null);
  }, [ready?.asset.id]);

  const finish = async (base: ImageBitmap, removed: number) => {
    if (!ready || finishing.current) return;
    finishing.current = true;
    try {
      setStage('working');
      let pixels = bitmapToImageData(base);
      let markHex: string | null = null;
      if (mark) {
        setStep('Hiding your Veil mark');
        const wm = await engines.watermark();
        if (wm) {
          const payload = newMarkPayload();
          pixels = await wm.embedMark(pixels, markKey(), payload);
          markHex = payloadHex(payload);
        } else {
          toast('The Veil mark engine is not in this build yet; the rest was done.');
        }
      }
      setStep('Writing a fresh file with no location data');
      const canvas = new OffscreenCanvas(pixels.width, pixels.height);
      canvas.getContext('2d')!.putImageData(pixels, 0, 0);
      const png = isAndroid();
      const blob = await canvas.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.93 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const bitmap = await createImageBitmap(blob);

      setStep('Adding it to your vault');
      const fp = await engines.fingerprint();
      const pdq = fp ? (await fp.pdqHash(bitmapToImageData(bitmap, 512))).hash : null;
      const name = ready.fileName.replace(/\.[^.]+$/, '');
      const entry = { id: uid('P'), name, addedAt: Date.now(), pdq, mark: markHex, sha256: await sha256Hex(bytes), thumb: await thumbnail(bitmap, 160) };
      vaultPhotos.set((list) => [...list, entry]);
      setResult({ bytes, url: URL.createObjectURL(blob), bitmap, marked: Boolean(markHex), removed, name: `${name}-veil.${png ? 'png' : 'jpg'}` });
      setStage('done');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Shielding failed.');
      setStage('options');
    } finally {
      finishing.current = false;
    }
  };

  // Clean finished: carry on with its pixels.
  useEffect(() => {
    if (clean.state.status === 'done' && stage === 'working') void finish(clean.state.preview, clean.state.selectedCount);
    if (clean.state.status === 'review' && stage === 'working') {
      if (clean.state.candidates.length === 0 && ready) void finish(ready.bitmap, 0);
      else setStage('review');
    }
    if (clean.state.status === 'failed' && stage === 'working') {
      toast(clean.state.message);
      setStage('options');
    }
  }, [clean.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    if (!ready) return;
    setStage('working');
    if (wipe) {
      setStep('Looking for street signs, numbers and plates');
      void clean.scan();
    } else void finish(ready.bitmap, 0);
  };

  const progressLabel = useMemo(() => {
    if (clean.state.status === 'scanning') return 'Looking for street signs, numbers and plates';
    if (clean.state.status === 'cleaning') return clean.state.step;
    return step;
  }, [clean.state, step]);

  if (!ready) {
    return (
      <div className="tool tool-empty">
        <DropZone
          title="Shield it first"
          line="Before you post a photo, Veil hides your mark in it, removes location data and paints out street signs and house numbers."
          busy={session.status === 'loading'}
          error={session.status === 'error' ? session.reason : null}
          onFile={(f) => void openImageFile(f)}
          cta="Choose a photo"
        />
      </div>
    );
  }

  return (
    <div className="tool tool-split">
      <section className="stage" aria-label="The photo">
        {stage === 'done' && result ? <BeforeAfter before={ready.bitmap} after={result.bitmap} /> : <PhotoView bitmap={ready.bitmap} label={ready.fileName} />}
        <div className="stage-bar">
          <span className="stage-name">{ready.fileName}</span>
          <button className="btn btn-ghost-dark btn-sm" onClick={() => closeImage()}>
            Open another
          </button>
        </div>
      </section>

      <aside className="panel">
        {stage === 'options' && (
          <>
            <div className="verdict" data-tone="paper">
              <h1>Shield this photo</h1>
              <p>You get a new copy to post. The photo you opened is not changed.</p>
            </div>
            <div className="choices">
              <label className="choice">
                <input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} />
                <span>
                  <strong>Hide my Veil mark</strong>
                  <span>Invisible. If a fake is made from this photo, Veil can prove it came from you.</span>
                </span>
              </label>
              <label className="choice">
                <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} />
                <span>
                  <strong>Remove where I live</strong>
                  <span>Street signs, house numbers and licence plates are found and painted out. You confirm each one.</span>
                </span>
              </label>
              <label className="choice">
                <input type="checkbox" checked disabled />
                <span>
                  <strong>Remove location data</strong>
                  <span>Always on. GPS, camera serial and time never make it into the new file.</span>
                </span>
              </label>
            </div>
            <button className="btn btn-lime" onClick={start}>
              Shield it
            </button>
          </>
        )}

        {stage === 'working' && (
          <div className="verdict" data-tone="char">
            <h1>Working</h1>
            <ul className="pending">
              <li>
                <span className="pending-bar" aria-hidden="true" />
                {progressLabel || 'Starting'}
              </li>
            </ul>
          </div>
        )}

        {stage === 'review' && clean.state.status === 'review' && (
          <>
            <div className="verdict" data-tone="paper">
              <h1>Remove these?</h1>
              <p>Veil picked the ones that give away where you are. Untick anything you want to keep.</p>
            </div>
            <ul className="candidates">
              {clean.state.candidates.map((c) => (
                <li key={c.id}>
                  <label className="choice">
                    <input type="checkbox" checked={c.selected} onChange={() => clean.toggle(c.id)} />
                    <span>
                      <strong>{CATEGORY[c.category] ?? 'Text'}</strong>
                      {c.text && <span>“{c.text}”</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="td-actions">
              <button
                className="btn btn-lime"
                onClick={() => {
                  setStage('working');
                  if (clean.state.status === 'review' && clean.state.candidates.some((c) => c.selected)) void clean.clean('migan_inpaint');
                  else void finish(ready.bitmap, 0);
                }}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {stage === 'done' && result && (
          <>
            <div className="verdict" data-tone="lime">
              <h1>Shielded</h1>
              <p>Drag across the photo to compare. The new copy is ready to post.</p>
            </div>
            <ol className="evidence">
              {result.marked && (
                <li data-tone="source">
                  <h2>Your Veil mark is inside</h2>
                  <p>Saved to your vault. If this photo is used in a fake, Check and Find my face will say so.</p>
                </li>
              )}
              {result.removed > 0 && (
                <li data-tone="real">
                  <h2>
                    {result.removed} {result.removed === 1 ? 'detail' : 'details'} painted out
                  </h2>
                  <p>Veil scanned the new copy again and no longer finds the selected text. That is not a guarantee nothing else gives your location away.</p>
                </li>
              )}
              <li data-tone="real">
                <h2>No location data</h2>
                <p>The new file was written from pixels only, so GPS, camera and time data are gone.</p>
              </li>
            </ol>
            <div className="td-actions">
              <button
                className="btn btn-lime"
                onClick={() =>
                  void saveCleanCopy(result.bytes, result.name)
                    .then(() => !isAndroid() && toast('Saved.'))
                    .catch((e) => toast(String(e)))
                }
              >
                Save the shielded copy
              </button>
              <button className="btn btn-ghost-dark" onClick={() => setStage('options')}>
                Start over
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
