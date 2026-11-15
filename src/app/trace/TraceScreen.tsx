import { useEffect, useRef, useState } from 'react';
import { addFace, removeFace, vaultFaces } from '../../services/vault';
import { engines, type Face } from '../../services/engines';
import { scan, SEARCH_ENGINES, watchlist, type ScanProgress } from '../../services/trace';
import { href } from '../router';
import { siteOf } from '../../services/tickets';
import { toast } from '../App';
import { pendingTrace } from './pending';
import { useImageSession } from '../../lib/runtime/imageSession';

async function faceCrop(bitmap: ImageBitmap, face: Face): Promise<string> {
  const pad = 0.35;
  const x = Math.max(0, (face.box.x - face.box.w * pad) * bitmap.width);
  const y = Math.max(0, (face.box.y - face.box.h * pad) * bitmap.height);
  const w = Math.min(bitmap.width - x, face.box.w * (1 + 2 * pad) * bitmap.width);
  const h = Math.min(bitmap.height - y, face.box.h * (1 + 2 * pad) * bitmap.height);
  const c = new OffscreenCanvas(96, 96);
  c.getContext('2d')!.drawImage(bitmap, x, y, w, h, 0, 0, 96, 96);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return await new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(String(fr.result));
    fr.readAsDataURL(blob);
  });
}

async function enrol(bitmap: ImageBitmap, face?: Face): Promise<string | null> {
  const fe = await engines.face();
  if (!fe) return 'The face engine is not in this build yet.';
  const faces = face ? [face] : await fe.detectFaces(bitmap);
  if (!faces.length) return 'No face found in that picture. Try a clear, front-facing selfie.';
  if (faces.length > 1 && !face) return 'That picture has more than one face. Use a selfie with only you in it.';
  const f = faces[0]!;
  addFace(`Face ${vaultFaces.get().length + 1}`, await fe.embedFace(bitmap, f), await faceCrop(bitmap, f));
  return null;
}

type Tab = 'page' | 'engines' | 'watch';

export default function TraceScreen() {
  const faces = vaultFaces.use();
  const watch = watchlist.use();
  const session = useImageSession();
  const selfie = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>('page');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const abort = useRef<AbortController | null>(null);

  // A face handed over from Check is added once, with consent implied by the tap that sent it.
  useEffect(() => {
    const p = pendingTrace.take();
    if (!p) return;
    void enrol(p.bitmap, p.face).then((err) => toast(err ?? 'Face added. Veil kept only its numbers.'));
  }, []);

  const runScan = async (target: string) => {
    if (!faces.length) {
      toast('Add your face first, so Veil knows what to look for.');
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    const result = await scan(target, setProgress, abort.current.signal);
    setBusy(false);
    if (result.hits.length) toast(`${result.hits.length} ${result.hits.length === 1 ? 'match' : 'matches'}: takedown tickets opened.`);
  };

  const demo = new URL('demo/leaks.html', window.location.href).href;
  const openPicture = session.status === 'ready' ? session : null;

  return (
    <div className="tool tool-trace">
      <section className="vault" aria-labelledby="vault-title">
        <h1 id="vault-title">Your face</h1>
        <p>Veil turns a selfie into 128 numbers and keeps only those, on this device. It never stores or sends the photo.</p>
        {faces.length > 0 && (
          <ul className="vault-list">
            {faces.map((f) => (
              <li key={f.id}>
                <img src={f.thumb} alt="" width="56" height="56" />
                <span>
                  <strong>{f.label}</strong>
                  <span className="num">added {new Date(f.addedAt).toLocaleDateString()}</span>
                </span>
                <button className="btn btn-ghost-light btn-sm" onClick={() => removeFace(f.id)} aria-label={`Forget ${f.label}`}>
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="btn btn-ink" disabled={busy} onClick={() => selfie.current?.click()}>
          {faces.length ? 'Add another selfie' : 'Add a selfie'}
        </button>
        <p className="small">Two or three selfies in different light make matches more reliable.</p>
        <input
          ref={selfie}
          type="file"
          accept="image/jpeg,image/png"
          capture="user"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
            const err = await enrol(bmp);
            bmp.close();
            toast(err ?? 'Face added. Veil kept only its numbers.');
          }}
        />
      </section>

      <section className="scan" aria-labelledby="scan-title">
        <h2 id="scan-title" className="sr-only">
          Look for your face
        </h2>
        <div className="tabs-inline" role="tablist" aria-label="Where to look">
          {([
            ['page', 'Scan a page'],
            ['engines', 'Search engines'],
            ['watch', `Watchlist${watch.length ? ` (${watch.length})` : ''}`],
          ] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'page' && (
          <div className="scan-body">
            <p className="scan-lede">Paste a page where fakes get posted, or the address of one picture. Veil reads every picture on it and compares each face with yours, on this device.</p>
            <form
              className="url-row url-row-big"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) void runScan(url.trim());
              }}
            >
              <label className="sr-only" htmlFor="scan-url">
                Page or picture address
              </label>
              <input id="scan-url" type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="btn btn-ink" type="submit" disabled={busy || !url.trim()}>
                {busy ? 'Scanning…' : 'Scan'}
              </button>
            </form>
            <p className="small">
              Try it on the{' '}
              <button className="link-quiet linkish" onClick={() => { setUrl(demo); void runScan(demo); }}>
                demo leaks page
              </button>
              .{' '}
              {url.trim() && !watch.some((w) => w.url === url.trim()) && (
                <button className="link-quiet linkish" onClick={() => watchlist.set((l) => [...l, { url: url.trim(), addedAt: Date.now(), lastScan: null, hits: 0 }])}>
                  Add this page to the watchlist
                </button>
              )}
            </p>
            {progress && <Results p={progress} />}
          </div>
        )}

        {tab === 'engines' && (
          <div className="scan-body">
            <p className="scan-lede">Search engines index billions of pictures Veil cannot reach. Each button sends the picture to that company, so only use the ones you trust.</p>
            {openPicture ? (
              <ul className="engines">
                {SEARCH_ENGINES.map((e) => (
                  <li key={e.id}>
                    <button
                      className="btn btn-ink"
                      onClick={async () => {
                        try {
                          const blob = await new Promise<Blob>((r) => {
                            const c = document.createElement('canvas');
                            c.width = openPicture.bitmap.width;
                            c.height = openPicture.bitmap.height;
                            c.getContext('2d')!.drawImage(openPicture.bitmap, 0, 0);
                            c.toBlob((b) => r(b!), 'image/png');
                          });
                          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                          toast(`Picture copied. Paste it into ${e.name}.`);
                        } catch {
                          toast(`Upload the picture on ${e.name}.`);
                        }
                        window.open(e.upload, '_blank', 'noopener');
                      }}
                    >
                      {e.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Open a picture in <a className="link-quiet" href={href('check')}>Check</a> first, then come back here to search for it.
              </p>
            )}
          </div>
        )}

        {tab === 'watch' && (
          <div className="scan-body">
            <p className="scan-lede">Pages you want Veil to keep an eye on. Scan them again whenever you open Veil.</p>
            {watch.length ? (
              <ul className="watch">
                {watch.map((w) => (
                  <li key={w.url}>
                    <span className="watch-url">{w.url}</span>
                    <span className="small num">{w.lastScan ? `checked ${new Date(w.lastScan).toLocaleString()} · ${w.hits} found` : 'not checked yet'}</span>
                    <span className="watch-actions">
                      <button className="btn btn-ink btn-sm" disabled={busy} onClick={() => { setTab('page'); setUrl(w.url); void runScan(w.url); }}>
                        Scan
                      </button>
                      <button className="btn btn-ghost-light btn-sm" onClick={() => watchlist.set((l) => l.filter((x) => x.url !== w.url))}>
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nothing on the watchlist yet. Scan a page, then add it.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Results({ p }: { p: ScanProgress }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="results" aria-live="polite">
      <div className="results-head">
        <p>
          {p.stage === 'reading' && 'Reading the page…'}
          {p.stage === 'checking' && (
            <>
              Checking <span className="num">{p.done}</span> of <span className="num">{p.total}</span> pictures
            </>
          )}
          {p.stage === 'done' &&
            (p.hits.length ? (
              <>
                <strong className="num">{p.hits.length}</strong> {p.hits.length === 1 ? 'picture shows' : 'pictures show'} you. Tickets are open.
              </>
            ) : (
              <>No picture on this page matches your face{p.faces ? ` (${p.faces} other faces seen)` : ''}.</>
            ))}
          {p.stage === 'failed' && <>Could not scan: {p.error}</>}
        </p>
        {p.stage === 'checking' && <div className="meter" style={{ ['--pct' as string]: `${pct}%` }} />}
      </div>
      {p.hits.length > 0 && (
        <ul className="hits">
          {p.hits.map((h) => (
            <li key={h.imageUrl} className="rise">
              <img src={h.thumb} alt="Matching picture" />
              <div>
                <p className="hit-label" data-kind={h.kind}>
                  {h.label}
                  {h.kind === 'face' && <span className="num"> · {Math.round(h.score * 100)}</span>}
                </p>
                <p className="small hit-url">{siteOf(h.pageUrl)}</p>
                <a className="btn btn-alarm btn-sm" href={href('tickets', h.ticketId)}>
                  Open ticket
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
