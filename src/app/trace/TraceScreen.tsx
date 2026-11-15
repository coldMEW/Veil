import { useEffect, useRef, useState } from 'react';
import { addFace, removeFace, vaultFaces } from '../../services/vault';
import { engines, type Face } from '../../services/engines';
import { scan, watchlist, type ScanHit, type ScanProgress } from '../../services/trace';
import { faceCrop as searchCrop, huntConsent, huntFace, hunts, type HuntProgress } from '../../services/hunt';
import { href } from '../router';
import { siteOf } from '../../services/tickets';
import { toast } from '../App';
import { pendingTrace } from './pending';
import { ArtFace, ArtTrace } from '../shared/Art';

async function thumbOf(bitmap: ImageBitmap, face: Face): Promise<string> {
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
  addFace(`Face ${vaultFaces.get().length + 1}`, await fe.embedFace(bitmap, f), await thumbOf(bitmap, f));
  return null;
}

type Tab = 'web' | 'page' | 'watch';

export default function TraceScreen() {
  const faces = vaultFaces.use();
  const watch = watchlist.use();
  const past = hunts.use();
  const consent = huntConsent.use();
  const selfie = useRef<HTMLInputElement>(null);
  const searchPhoto = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>('web');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [hunt, setHunt] = useState<HuntProgress | null>(null);
  const abort = useRef<AbortController | null>(null);

  // A face handed over from Check is added once, with consent implied by the tap that sent it.
  useEffect(() => {
    const p = pendingTrace.take();
    if (!p) return;
    void enrol(p.bitmap, p.face).then((err) => toast(err ?? 'Face added. Veil kept only its numbers.'));
  }, []);

  const needFace = () => {
    if (faces.length) return false;
    toast('Add your face first, so Veil knows what to look for.');
    return true;
  };

  const runScan = async (target: string) => {
    if (needFace()) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    const result = await scan(target, setProgress, abort.current.signal);
    setBusy(false);
    if (result.hits.length) toast(`${result.hits.length} ${result.hits.length === 1 ? 'match' : 'matches'}: takedown tickets opened.`);
  };

  const runHunt = async (file: File) => {
    if (needFace()) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const crop = await searchCrop(bmp);
      bmp.close();
      const r = await huntFace(crop, setHunt, abort.current.signal);
      if (r.hits.length) toast(`${r.hits.length} ${r.hits.length === 1 ? 'match' : 'matches'} on the web: takedown tickets opened.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The search failed.');
    } finally {
      setBusy(false);
    }
  };

  const startHunt = () => {
    if (needFace()) return;
    if (!consent) return setAsking(true);
    searchPhoto.current?.click();
  };

  const rescanAll = async () => {
    const pages = [...new Set([...watch.map((w) => w.url), ...past.flatMap((h) => h.pages)])];
    for (const p of pages) await runScan(p);
  };

  return (
    <div className="tool tool-trace">
      <section className="vault" aria-labelledby="vault-title">
        <div className="vault-art">{faces.length ? <ArtTrace /> : <ArtFace />}</div>
        <h1 id="vault-title">Your face</h1>
        <p>Veil turns a selfie into 128 numbers and keeps only those, on this device. It never stores the photo.</p>
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
        <h2 id="scan-title" className="sr-only">Look for your face</h2>
        <div className="tabs-inline" role="tablist" aria-label="Where to look">
          {([
            ['web', 'Search the web'],
            ['page', 'Check a page I know'],
            ['watch', `Watchlist${watch.length + past.length ? ` (${watch.length + past.length})` : ''}`],
          ] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'web' && (
          <div className="scan-body">
            <p className="scan-lede">Veil runs reverse image searches with your face across the web, opens every page that comes back, and checks each picture against your face on this device. Matches become takedown tickets.</p>
            <button className="btn btn-sky hunt-go" disabled={busy} onClick={startHunt}>
              {busy && hunt && hunt.stage !== 'done' ? 'Searching…' : 'Search the web for my face'}
            </button>
            {asking && (
              <div className="consent" role="dialog" aria-labelledby="consent-title">
                <h3 id="consent-title">Before the first search</h3>
                <p>To search the web, Veil sends a crop of your face from the photo you pick to Yandex and Bing image search. Your selfie and face numbers stay on this device. Results are checked on this device.</p>
                <div className="td-actions">
                  <button className="btn btn-sky" onClick={() => { huntConsent.set(true); setAsking(false); searchPhoto.current?.click(); }}>
                    I understand, search
                  </button>
                  <button className="btn btn-ghost-dark" onClick={() => setAsking(false)}>Not now</button>
                </div>
              </div>
            )}
            <input
              ref={searchPhoto}
              type="file"
              accept="image/jpeg,image/png"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void runHunt(f);
              }}
            />
            {hunt && <HuntResults p={hunt} />}
          </div>
        )}

        {tab === 'page' && (
          <div className="scan-body">
            <p className="scan-lede">Already know a page where fakes of you are posted? Paste it. Veil reads every picture on it and compares each face with yours.</p>
            <form
              className="url-row url-row-big"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) void runScan(url.trim());
              }}
            >
              <label className="sr-only" htmlFor="scan-url">Page or picture address</label>
              <input id="scan-url" type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="btn btn-ink" type="submit" disabled={busy || !url.trim()}>
                {busy ? 'Scanning…' : 'Scan'}
              </button>
            </form>
            <p className="small">
              Try it on the{' '}
              <button className="link-quiet linkish" onClick={() => { const demo = new URL('demo/leaks.html', window.location.href).href; setUrl(demo); void runScan(demo); }}>
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

        {tab === 'watch' && (
          <div className="scan-body">
            <p className="scan-lede">Pages Veil keeps an eye on: the ones you added and the ones earlier searches found. Check them all again in one go.</p>
            {watch.length + past.length ? (
              <>
                <button className="btn btn-sky" disabled={busy} onClick={() => void rescanAll()}>
                  {busy ? 'Checking…' : 'Check them all again'}
                </button>
                <ul className="watch">
                  {past.map((h) => (
                    <li key={h.at}>
                      <span className="watch-url">Web search, {new Date(h.at).toLocaleString()}</span>
                      <span className="small num">{h.candidates} pictures checked · {h.matches} matches · {h.pages.length} pages watched</span>
                    </li>
                  ))}
                  {watch.map((w) => (
                    <li key={w.url}>
                      <span className="watch-url">{w.url}</span>
                      <span className="small num">{w.lastScan ? `checked ${new Date(w.lastScan).toLocaleString()} · ${w.hits} found` : 'not checked yet'}</span>
                      <span className="watch-actions">
                        <button className="btn btn-ink btn-sm" disabled={busy} onClick={() => { setTab('page'); setUrl(w.url); void runScan(w.url); }}>Scan</button>
                        <button className="btn btn-ghost-light btn-sm" onClick={() => watchlist.set((l) => l.filter((x) => x.url !== w.url))}>Remove</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Nothing watched yet. Run a web search or add a page, and it will appear here.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function HitGrid({ hits }: { hits: ScanHit[] }) {
  return (
    <ul className="hits">
      {hits.map((h) => (
        <li key={h.imageUrl}>
          <img src={h.thumb} alt="Matching picture" />
          <div>
            <p className="hit-label" data-kind={h.kind}>
              {h.label}
              {h.kind === 'face' && <span className="num"> · {Math.round(h.score * 100)}</span>}
            </p>
            <p className="small hit-url">{siteOf(h.pageUrl)}</p>
            <a className="btn btn-alarm btn-sm" href={href('tickets', h.ticketId)}>Open ticket</a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function HuntResults({ p }: { p: HuntProgress }) {
  const pct = p.candidates ? Math.round((p.checked / p.candidates) * 100) : 0;
  return (
    <div className="results" aria-live="polite">
      <ul className="engine-list">
        {p.stage === 'searching' && !p.engines.length && <li><span className="pending-bar" aria-hidden="true" />Asking image search engines…</li>}
        {p.engines.map((e) => (
          <li key={e.engine} data-ok={e.ok || undefined}>
            <strong>{{ yandex: 'Yandex', bing: 'Bing', lens: 'Google Lens', web: 'Web' }[e.engine] ?? e.engine}</strong>
            <span className="num">{e.ok ? `${e.hits.length} results` : `no results (${e.error ?? 'unavailable'})`}</span>
          </li>
        ))}
      </ul>
      <div className="results-head">
        <p>
          {p.stage === 'checking' && <>Checking <span className="num">{p.checked}</span> of <span className="num">{p.candidates}</span> pictures for your face</>}
          {p.stage === 'done' && (p.hits.length
            ? <><strong className="num">{p.hits.length}</strong> {p.hits.length === 1 ? 'picture on the web shows' : 'pictures on the web show'} you. Tickets are open.</>
            : <>Checked {p.candidates} pictures from the web: none of them is you{p.faces ? ` (${p.faces} other faces seen)` : ''}.</>)}
          {p.stage === 'failed' && <>The search failed: {p.error}</>}
        </p>
        {p.stage === 'checking' && <div className="meter" style={{ ['--pct' as string]: `${pct}%` }} />}
      </div>
      {p.hits.length > 0 && <HitGrid hits={p.hits} />}
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
          {p.stage === 'checking' && <>Checking <span className="num">{p.done}</span> of <span className="num">{p.total}</span> pictures</>}
          {p.stage === 'done' && (p.hits.length
            ? <><strong className="num">{p.hits.length}</strong> {p.hits.length === 1 ? 'picture shows' : 'pictures show'} you. Tickets are open.</>
            : <>No picture on this page matches your face{p.faces ? ` (${p.faces} other faces seen)` : ''}.</>)}
          {p.stage === 'failed' && <>Could not scan: {p.error}</>}
        </p>
        {p.stage === 'checking' && <div className="meter" style={{ ['--pct' as string]: `${pct}%` }} />}
      </div>
      {p.hits.length > 0 && <HitGrid hits={p.hits} />}
    </div>
  );
}
