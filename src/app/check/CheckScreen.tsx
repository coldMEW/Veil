import { useEffect, useMemo, useRef, useState } from 'react';
import { closeImage, openImageFile, useImageSession } from '../../lib/runtime/imageSession';
import { useCheck, type CheckInput, type Verdict } from '../../services/check';
import { fetchImageBytes } from '../../services/api';
import { createTicket } from '../../services/tickets';
import { thumbnail } from '../../services/engines';
import { navigate } from '../router';
import { toast } from '../App';
import { PhotoView } from '../shared/PhotoView';
import { DropZone } from '../shared/DropZone';
import { ArtCheck } from '../shared/Art';
import { pendingTrace } from '../trace/pending';

const VERDICT: Record<Verdict, { title: string; line: string; tone: string }> = {
  checking: { title: 'Checking', line: 'Veil is looking at this picture on your device.', tone: 'char' },
  fake: { title: 'Signs it was faked', line: 'The file itself shows it: a signed AI label, an edit trace, or a change from your original. Details below.', tone: 'alarm' },
  suspect: { title: 'A model flags it', line: 'Our AI-image model scores this picture as likely AI-made. That is a lead, not proof: no label, edit trace or mark was found in the file.', tone: 'paper' },
  derived: { title: 'Made from your photo', line: 'Your invisible Veil mark is inside this picture: it was made from a photo you shielded. If you did not post it, report it.', tone: 'sky' },
  signed: { title: 'Signed and unchanged', line: 'The camera that took it signed it, and it has not been changed since.', tone: 'lime' },
  unclear: { title: 'Nothing decisive', line: 'None of the checks found strong evidence either way. That does not prove the picture is real: add your original photo to compare.', tone: 'char' },
};

let sourceUrl: string | null = null;

export default function CheckScreen() {
  const session = useImageSession();
  const [original, setOriginal] = useState<ImageBitmap | null>(null);
  const [url, setUrl] = useState('');
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [foundAt, setFoundAt] = useState('');
  const originalInput = useRef<HTMLInputElement>(null);

  const input: CheckInput | null = useMemo(
    () => (session.status === 'ready' ? { assetId: session.asset.id, bytes: session.bytes, mimeType: session.asset.mimeType, bitmap: session.bitmap } : null),
    [session],
  );
  const check = useCheck(input, original);

  useEffect(() => {
    setOriginal(null);
    setFoundAt(sourceUrl ?? '');
  }, [input?.assetId]);

  const openUrl = async () => {
    if (!url.trim()) return;
    setLoadingUrl(true);
    try {
      const blob = await fetchImageBytes(url.trim());
      sourceUrl = url.trim();
      await openImageFile(new File([blob], url.split('/').pop()?.split('?')[0] || 'Image from the web', { type: blob.type }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open that address.');
    } finally {
      setLoadingUrl(false);
    }
  };

  const openTicket = async () => {
    if (!input) return;
    const page = foundAt.trim();
    if (!/^https?:\/\//i.test(page)) {
      toast('Add the web address where you found it.');
      return;
    }
    const t = createTicket({
      pageUrl: page,
      imageUrl: sourceUrl,
      match: { kind: 'manual', score: null, detail: 'Reported from a check in Veil.' },
      thumb: await thumbnail(input.bitmap),
      imageSha256: input.assetId,
      findings: check.evidence.map((e) => `${e.title}: ${e.says}`),
    });
    navigate('tickets', t.id);
  };

  if (session.status !== 'ready') {
    return (
      <div className="tool tool-empty">
        <DropZone
          art={<ArtCheck />}
          title="Is it really you?"
          line="Drop a picture, or choose one. Veil checks it on your device and shows only what it can prove."
          busy={session.status === 'loading' || loadingUrl}
          error={session.status === 'error' ? session.reason : null}
          onFile={(f) => {
            sourceUrl = null;
            void openImageFile(f);
          }}
        >
          <form
            className="url-row"
            onSubmit={(e) => {
              e.preventDefault();
              void openUrl();
            }}
          >
            <label className="sr-only" htmlFor="check-url">
              Or paste the address of a picture
            </label>
            <input id="check-url" type="url" inputMode="url" placeholder="Or paste the address of a picture" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-white btn-sm" type="submit" disabled={loadingUrl || !url.trim()}>
              Open
            </button>
          </form>
        </DropZone>
      </div>
    );
  }

  const v = VERDICT[check.verdict];
  const fake = check.verdict === 'fake' || check.verdict === 'derived';
  const face = check.faces?.[0];

  return (
    <div className="tool tool-split tool-check">
      <section className="stage" aria-label="The picture">
        <PhotoView bitmap={session.bitmap} label={session.fileName} />
        <div className="stage-bar">
          <span className="stage-name">{session.fileName}</span>
          <button className="btn btn-ghost-dark btn-sm" onClick={() => { sourceUrl = null; closeImage(); }}>
            Open another
          </button>
        </div>
      </section>

      <aside className="panel" aria-live="polite">
        <div className="verdict" data-tone={v.tone}>
          <h1>{v.title}</h1>
          <p>{v.line}</p>
          {check.pending.length > 0 && (
            <ul className="pending">
              {check.pending.map((p) => (
                <li key={p}>
                  <span className="pending-bar" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        {check.evidence.length > 0 && (
          <ol className="evidence">
            {check.evidence.map((e, i) => (
              <li key={e.id} className="rise" style={{ ['--i' as string]: i }} data-tone={e.tone}>
                <h2>{e.title}</h2>
                <p>{e.says}</p>
                <p className="how">{e.how}</p>
              </li>
            ))}
          </ol>
        )}

        {check.modelFailed && <p className="note">The AI-image model could not run here: {check.modelFailed}</p>}

        <div className="panel-block">
          <h2 className="panel-h">Have the real photo?</h2>
          <p>Give Veil the photo this was made from. It lines them up and finds what changed.</p>
          <button className="btn btn-ghost-dark btn-sm" onClick={() => originalInput.current?.click()}>
            {original ? 'Choose a different original' : 'Add my original'}
          </button>
          {original && !check.comparison && <p className="note">Comparing…</p>}
          {check.comparison && !check.comparison.changed && <p className="note">{check.comparison.says}</p>}
          <input
            ref={originalInput}
            type="file"
            accept="image/jpeg,image/png"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setOriginal(await createImageBitmap(f, { imageOrientation: 'from-image' }));
              e.target.value = '';
            }}
          />
        </div>

        {face && (
          <div className="panel-block">
            <h2 className="panel-h">Is this your face?</h2>
            <p>Find everywhere else it has been posted.</p>
            <button
              className="btn btn-ghost-dark btn-sm"
              onClick={() => {
                pendingTrace.set({ bitmap: session.bitmap, face });
                navigate('trace');
              }}
            >
              Find this face online
            </button>
          </div>
        )}

        <div className={`panel-block ${fake ? 'panel-block-alarm' : ''}`}>
          <h2 className="panel-h">Take it down</h2>
          <p>Where did you find it? Veil writes the notice, finds who to send it to and starts the clock.</p>
          <label className="sr-only" htmlFor="found-at">
            Web address where you found it
          </label>
          <input id="found-at" className="field" type="url" inputMode="url" placeholder="https://" value={foundAt} onChange={(e) => setFoundAt(e.target.value)} />
          <button className={`btn btn-sm ${fake ? 'btn-ink' : 'btn-alarm'}`} onClick={() => void openTicket()}>
            Open a takedown ticket
          </button>
        </div>
      </aside>
    </div>
  );
}
