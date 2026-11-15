import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeVideo, type Progress, type VideoAnalysis, type VideoSignal } from '../../features/video/analyze';
import { formatBytes, inspectContainer, stamp, type ContainerFacts } from '../../features/video/container';
import { buildRecord, credentialFinding, videoReasons, videoVerdict, type CredentialFinding, type Note, type VideoRecord, type VideoVerdict } from '../../features/video/record';
import { appendEvent, seal, sha256Hex, verifySealed, witnessKeyId, type CustodyEvent, type Sealed, type VerifyLine } from '../../features/video/seal';
import { readProvenance } from '../../features/inspect/provenance/contentCredentials';
import { createTicket } from '../../services/tickets';
import { uid } from '../../services/store';
import { navigate } from '../router';
import { toast } from '../App';
import { DropZone } from '../shared/DropZone';
import { ArtCheck } from '../shared/Art';
import { Reasons } from '../shared/Reasons';
import './video.css';

const MAX_BYTES = 500 * 1024 * 1024;
const MAX_CREDENTIAL_BYTES = 200 * 1024 * 1024;

const VERDICT: Record<VideoVerdict, { title: string; line: string; tone: string }> = {
  checking: { title: 'Checking', line: 'Veil is going through this video on your device. Nothing is uploaded.', tone: 'char' },
  fake: { title: 'Signs it was faked', line: 'The file itself shows it, through its own signed label or signature. Details below.', tone: 'alarm' },
  suspect: { title: 'Worth a closer look', line: 'Veil found moments to review, not proof. Jump to each one and judge it with your own eyes.', tone: 'paper' },
  signed: { title: 'Credentials intact', line: 'The video still matches its signed Content Credentials. That shows it was not changed after signing.', tone: 'lime' },
  unclear: { title: 'Nothing decisive', line: 'None of the checks found strong evidence either way. That does not prove the video is real.', tone: 'char' },
};

interface Opened {
  file: File;
  url: string;
  caseId: string;
  createdAt: string;
  sha256: string | null;
  facts: ContainerFacts | null;
  credentials: CredentialFinding | null;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const shortHash = (h: string) => `${h.slice(0, 12)}…${h.slice(-8)}`;

/* ---------------- Check a record someone sent you ---------------- */

function VerifyRecord({ onClose }: { onClose: () => void }) {
  const [sealed, setSealed] = useState<Sealed<VideoRecord> | null>(null);
  const [lines, setLines] = useState<VerifyLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const recordInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const check = async (s: Sealed<VideoRecord>, video?: File) => {
    setBusy(true);
    try {
      const bytes = video ? new Uint8Array(await video.arrayBuffer()) : null;
      setLines(await verifySealed(s, bytes, await witnessKeyId()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tool tool-video-verify">
      <section className="verify-card">
        <h1>Check a record</h1>
        <p className="dropzone-line">Someone sent you a Veil video record. Add it here and Veil re-checks every signature from scratch, on your device.</p>
        <div className="td-actions">
          <button className="btn btn-lime" disabled={busy} onClick={() => recordInput.current?.click()}>
            {sealed ? 'Choose another record' : 'Choose the record (.json)'}
          </button>
          {sealed && (
            <button className="btn btn-ghost-dark" disabled={busy} onClick={() => videoInput.current?.click()}>
              Add the video too
            </button>
          )}
          <button className="btn btn-ghost-dark" onClick={onClose}>
            Back
          </button>
        </div>
        <input
          ref={recordInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const parsed = JSON.parse(await f.text()) as Sealed<VideoRecord>;
              setSealed(parsed);
              await check(parsed);
            } catch {
              setSealed(null);
              setLines([{ id: 'device', ok: false, title: 'Not a Veil video record', says: 'That file could not be read as a record.' }]);
            }
          }}
        />
        <input
          ref={videoInput}
          type="file"
          accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f && sealed) void check(sealed, f);
          }}
        />
        {busy && <p className="note">Checking…</p>}
        {lines && (
          <ol className="evidence verify-lines">
            {lines.map((l) => (
              <li key={l.id} data-tone={l.ok === true ? 'real' : l.ok === false ? 'fake' : undefined}>
                <h2>{l.title}</h2>
                <p>{l.says}</p>
              </li>
            ))}
          </ol>
        )}
        {sealed?.record?.asset && lines?.every((l) => l.ok !== false) && (
          <p className="note">
            Record for “{sealed.record.asset.name}” ({sealed.record.asset.size}), case {sealed.record.caseId}, {sealed.record.scan?.signals.length ?? 0} signals, {sealed.record.notes.length} reviewer notes.
          </p>
        )}
      </section>
    </div>
  );
}

/* ---------------- The screen ---------------- */

export default function VideoScreen() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [events, setEvents] = useState<CustodyEvent[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [purpose, setPurpose] = useState<VideoRecord['purpose']>('claim');
  const [sealed, setSealed] = useState<Sealed<VideoRecord> | null>(null);
  const [now, setNow] = useState(0);
  const [noteText, setNoteText] = useState('');
  const [foundAt, setFoundAt] = useState('');
  const [verifying, setVerifying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const run = useRef<{ id: number; abort: AbortController | null }>({ id: 0, abort: null });
  const log = useRef<CustodyEvent[]>([]);

  const close = useCallback(() => {
    run.current.abort?.abort();
    run.current.id++;
    setOpened((o) => {
      if (o) URL.revokeObjectURL(o.url);
      return null;
    });
    setAnalysis(null);
    setProgress(null);
    setScanError(null);
    setEvents([]);
    setNotes([]);
    setSealed(null);
    setNow(0);
    log.current = [];
  }, []);
  // Leaving the screen stops the scan and lets go of the video.
  useEffect(() => close, [close]);

  const record = async (sha: string, type: string, detail: string) => {
    log.current = await appendEvent(log.current, sha, type, detail);
    setEvents(log.current);
  };

  const open = async (file: File) => {
    close();
    setError(null);
    if (file.size > MAX_BYTES) return setError(`That video is ${formatBytes(file.size)}. Veil can check videos up to 500 MB on a device.`);
    const id = ++run.current.id;
    const abort = new AbortController();
    run.current.abort = abort;
    const live = () => run.current.id === id;
    setOpening(true);
    try {
      let bytes: Uint8Array | null = new Uint8Array(await file.arrayBuffer());
      const facts = inspectContainer(bytes);
      if (!facts.supported) {
        setError('Veil reads MP4 and MOV videos. This file is something else, or it is damaged.');
        return;
      }
      const sha256 = await sha256Hex(bytes);
      if (!live()) return;
      const base: Opened = { file, url: URL.createObjectURL(file), caseId: uid('VC-'), createdAt: new Date().toISOString(), sha256, facts, credentials: null };
      setOpened(base);
      setOpening(false);
      await record(sha256, 'opened', `Opened "${file.name}" (${formatBytes(file.size)}) on this device. The file was not uploaded.`);
      await record(sha256, 'fingerprinted', `SHA-256 computed from the original bytes: ${sha256}.`);
      await record(sha256, 'file-read', `${facts.container}, ${facts.tracks.length} track${facts.tracks.length === 1 ? '' : 's'}${facts.writtenBy.length ? `, written by ${facts.writtenBy.join(', ')}` : ''}.`);

      // Content Credentials are only parsed when the file actually carries them.
      const provenance = facts.c2paBoxes && file.size <= MAX_CREDENTIAL_BYTES ? await readProvenance(bytes, facts.container?.startsWith('QuickTime') ? 'video/quicktime' : 'video/mp4') : 'skipped';
      bytes = null; // the fingerprint is done: let go of the copy in memory
      if (!live()) return;
      const credentials = credentialFinding(facts, provenance);
      setOpened({ ...base, credentials });
      if (facts.c2paBoxes) await record(sha256, 'credentials-checked', credentials.note);

      try {
        const result = await analyzeVideo(file, (p) => live() && setProgress(p), abort.signal);
        if (!live()) return;
        setAnalysis(result);
        await record(sha256, 'scanned', `${result.frames.length} frames examined in ${result.took.toFixed(1)} s; ${result.signals.length} moment${result.signals.length === 1 ? '' : 's'} marked for review.`);
      } catch (e) {
        if (!live() || (e instanceof DOMException && e.name === 'AbortError')) return;
        setScanError(e instanceof Error ? e.message : 'The scan stopped unexpectedly.');
        await record(sha256, 'scan-failed', 'The automated scan could not finish on this device.');
      }
    } catch (e) {
      if (live()) setError(e instanceof Error ? e.message : 'That video could not be opened.');
    } finally {
      if (live()) {
        setOpening(false);
        setProgress(null);
      }
    }
  };

  const scanning = Boolean(opened) && !analysis && !scanError;

  // Seal whenever the finished record changes: the signature always covers what is on screen.
  const current = useMemo(() => {
    if (!opened?.sha256 || !opened.facts || scanning) return null;
    return buildRecord({ caseId: opened.caseId, purpose, createdAt: opened.createdAt, file: opened.file, sha256: opened.sha256, container: opened.facts, credentials: opened.credentials, analysis, notes, events });
  }, [opened, purpose, analysis, notes, events, scanning]);
  useEffect(() => {
    setSealed(null);
    if (!current) return;
    let live = true;
    const timer = window.setTimeout(() => void seal(current).then((s) => live && setSealed(s)).catch(() => undefined), 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [current]);

  const jump = (time: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, time);
    setNow(time);
    v.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const addNote = async () => {
    const text = noteText.trim();
    if (!text || !opened?.sha256) return;
    const note: Note = { id: uid('N-'), at: new Date().toISOString(), time: Number(now.toFixed(1)), text: text.slice(0, 500) };
    setNotes((n) => [...n, note]);
    setNoteText('');
    await record(opened.sha256, 'note-added', `Reviewer note at ${stamp(note.time)}: ${note.text}`);
  };

  const openTicket = () => {
    if (!opened) return;
    const page = foundAt.trim();
    if (!/^https?:\/\//i.test(page)) return toast('Add the web address where you found it.');
    const reasons = videoReasons(opened.facts!, opened.credentials, analysis);
    const t = createTicket({
      pageUrl: page,
      imageUrl: null,
      match: { kind: 'manual', score: null, detail: 'Reported from a video check in Veil.' },
      thumb: analysis?.signals.find((s) => s.thumb)?.thumb ?? analysis?.frames[0]?.thumb ?? null,
      imageSha256: opened.sha256,
      findings: [`Video "${opened.file.name}", SHA-256 ${opened.sha256}`, ...reasons.for],
    });
    navigate('tickets', t.id);
  };

  if (verifying) return <VerifyRecord onClose={() => setVerifying(false)} />;

  if (!opened) {
    return (
      <div className="tool tool-empty">
        <DropZone
          art={<ArtCheck />}
          title="Is the video real?"
          line="Drop an MP4 or MOV. Veil goes through it on this device, marks the moments worth a look, and seals a record nobody can quietly change."
          cta="Choose a video"
          accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
          busy={opening}
          error={error}
          onFile={(f) => void open(f)}
        >
          <button className="linkish video-verify-link" onClick={() => setVerifying(true)}>
            Got a record from someone else? Check it
          </button>
        </DropZone>
      </div>
    );
  }

  const facts = opened.facts!;
  const verdictKey = videoVerdict(opened.credentials, analysis, scanning);
  const v = VERDICT[verdictKey];
  const reasons = videoReasons(facts, opened.credentials, analysis);
  const seconds = analysis?.seconds ?? facts.seconds ?? 0;
  const model = analysis?.signals.filter((s) => s.family === 'model') ?? [];
  const other = analysis?.signals.filter((s) => s.family !== 'model') ?? [];
  const pct = (t: number) => `${Math.min(100, Math.max(0, seconds ? (t / seconds) * 100 : 0))}%`;
  const videoTrack = facts.tracks.find((t) => t.kind === 'video');

  const signalItem = (s: VideoSignal, i: number) => (
    <li key={s.id} className="rise signal" style={{ ['--i' as string]: i }} data-tone={s.family === 'model' ? 'fake' : undefined}>
      <button className="signal-jump" onClick={() => jump(s.start)} aria-label={`Jump to ${stamp(s.start)}`}>
        {s.thumb ? <img src={s.thumb} alt="" /> : <span className="signal-nothumb" aria-hidden="true" />}
        <span className="num">{s.end - s.start > 0.15 ? `${stamp(s.start)} to ${stamp(s.end)}` : stamp(s.start)}</span>
      </button>
      <div>
        <h2>{s.title}</h2>
        <p>{s.says}</p>
        <p className="how">Could also be: {s.innocent}</p>
        <p className="how">{s.how}</p>
      </div>
    </li>
  );

  return (
    <div className="tool tool-split tool-video">
      <section className="stage" aria-label="The video">
        <div className="video-frame">
          <video ref={video} src={opened.url} controls playsInline preload="metadata" onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
        </div>
        <div className="vt" role="group" aria-label="Moments marked in the video">
          <div className="vt-track">
            {analysis?.frames.map((f) => (
              <span key={f.time} className="vt-tick" style={{ left: pct(f.time) }} data-level={(f.ai ?? 0) >= 0.9 || (f.faceFake ?? 0) >= 0.85 ? 'high' : (f.ai ?? 0) >= 0.5 ? 'mid' : 'low'} />
            ))}
            {analysis?.signals.map((s) => (
              <button key={s.id} className="vt-mark" data-family={s.family} style={{ left: pct(s.start), width: `max(10px, calc(${pct(s.end)} - ${pct(s.start)}))` }} onClick={() => jump(s.start)} title={`${s.title}, ${stamp(s.start)}`} aria-label={`${s.title} at ${stamp(s.start)}`} />
            ))}
            {scanning && progress?.phase === 'frames' && <span className="vt-scan" style={{ left: pct(progress.time ?? 0) }} />}
            <span className="vt-now" style={{ left: pct(now) }} />
          </div>
          <div className="vt-legend">
            <span className="num">{stamp(now)}</span>
            <span><i data-family="model" /> Model flag</span>
            <span><i data-family="picture" /> Picture change</span>
            <span><i data-family="sound" /> Sound change</span>
            <span className="num">{stamp(seconds)}</span>
          </div>
        </div>
        <div className="stage-bar">
          <span className="stage-name">{opened.file.name}</span>
          <button className="btn btn-ghost-dark btn-sm" onClick={close}>
            Open another
          </button>
        </div>
      </section>

      <aside className="panel" aria-live="polite">
        <div className="verdict" data-tone={v.tone}>
          <h1>{v.title}</h1>
          <p>{v.line}</p>
          {scanning && (
            <ul className="pending">
              <li>
                <span className="pending-bar" aria-hidden="true" />
                {progress?.phase === 'frames'
                  ? `Frame ${progress.done} of ${progress.total}, at ${stamp(progress.time ?? 0)}`
                  : progress?.phase === 'sound'
                    ? 'Listening to the sound'
                    : 'Loading the models'}
              </li>
            </ul>
          )}
          {analysis && <p className="verdict-meta num">{analysis.frames.length} frames examined in {analysis.took.toFixed(1)} s, all on this device.</p>}
        </div>

        {scanError && <p className="note">The scan could not finish here: {scanError} The file record below is still valid.</p>}

        {!scanning && <Reasons reasons={reasons} noun="video" />}

        {model.length > 0 && <ol className="evidence signals">{model.map(signalItem)}</ol>}

        {other.length > 0 && (
          <details className="maybe signals-more">
            <summary>{other.length} picture and sound change{other.length === 1 ? '' : 's'} (usually ordinary editing)</summary>
            <ol className="evidence signals">{other.map(signalItem)}</ol>
          </details>
        )}

        <div className="panel-block passport">
          <h2 className="panel-h">Evidence record</h2>
          <dl className="passport-facts">
            <div><dt>Fingerprint</dt><dd className="num" title={opened.sha256 ?? ''}>{opened.sha256 ? shortHash(opened.sha256) : 'Working…'}</dd></div>
            <div><dt>File</dt><dd>{facts.container}, {formatBytes(opened.file.size)}{videoTrack?.width ? `, ${videoTrack.width} × ${videoTrack.height}` : ''}{videoTrack?.codec ? `, ${videoTrack.codec}` : ''}</dd></div>
            <div><dt>Recorded</dt><dd>{facts.createdAt ? `${new Date(facts.createdAt).toLocaleString()} (as written in the file)` : 'No date written in the file'}</dd></div>
            <div><dt>Saved by</dt><dd>{facts.writtenBy.length ? facts.writtenBy.join(', ') : 'No software named'}</dd></div>
            <div><dt>Credentials</dt><dd>{opened.credentials?.note ?? 'Checking…'}</dd></div>
            <div>
              <dt>Seal</dt>
              <dd>
                {scanning
                  ? 'Seals when the scan ends'
                  : !sealed
                    ? 'Sealing…'
                    : sealed.witness
                      ? `Signed on this device (key ${sealed.device.keyId}). Veil's server stamped the time: ${new Date(sealed.witness.at).toLocaleString()}. It saw a fingerprint only.`
                      : `Signed on this device (key ${sealed.device.keyId}). No server reachable, so the times are this device's own.`}
              </dd>
            </div>
          </dl>
          <ol className="custody">
            {events.map((e) => (
              <li key={e.seq}>
                <span className="num">{new Date(e.at).toLocaleTimeString()}</span>
                <span>{e.detail}</span>
              </li>
            ))}
          </ol>
          <div className="td-actions">
            <button className="btn btn-lime btn-sm" disabled={!sealed} onClick={() => sealed && download(`veil-record-${opened.caseId}.json`, JSON.stringify(sealed, null, 2))}>
              Download record
            </button>
            <button className="btn btn-ghost-dark btn-sm" disabled={!sealed} onClick={() => window.print()}>
              Print report
            </button>
          </div>
          <p className="note">The record holds numbers and text only. The video and its frames stay with you.</p>
        </div>

        <div className="panel-block">
          <h2 className="panel-h">Add what you see</h2>
          <p>Pause where something looks wrong and write it down. Each note is tied to that moment and sealed into the record.</p>
          <form
            className="note-row"
            onSubmit={(e) => {
              e.preventDefault();
              void addNote();
            }}
          >
            <label className="sr-only" htmlFor="video-note">Note at {stamp(now)}</label>
            <input id="video-note" className="field" maxLength={500} placeholder={`What do you see at ${stamp(now)}?`} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <button className="btn btn-ghost-dark btn-sm" type="submit" disabled={!noteText.trim() || scanning}>
              Add note
            </button>
          </form>
          {notes.length > 0 && (
            <ul className="notes">
              {notes.map((n) => (
                <li key={n.id}>
                  <button className="linkish num" onClick={() => jump(n.time)}>{stamp(n.time)}</button>
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel-block">
          <h2 className="panel-h">What is this for?</h2>
          <div className="segmented" role="radiogroup" aria-label="What the record is for">
            <button role="radio" aria-checked={purpose === 'claim'} onClick={() => setPurpose('claim')}>A claim or case</button>
            <button role="radio" aria-checked={purpose === 'personal'} onClick={() => setPurpose('personal')}>A fake of me</button>
          </div>
          {purpose === 'claim' ? (
            <p>The record keeps facts about the file, the moments marked, and your notes apart, so a reviewer or adjuster can see what was measured and what was judged.</p>
          ) : (
            <>
              <p>Where did you find it? Veil writes the notice, finds who to send it to and starts the clock.</p>
              <label className="sr-only" htmlFor="video-found-at">Web address where you found it</label>
              <input id="video-found-at" className="field" type="url" inputMode="url" placeholder="https://" value={foundAt} onChange={(e) => setFoundAt(e.target.value)} />
              <button className="btn btn-alarm btn-sm" onClick={openTicket}>Open a takedown ticket</button>
            </>
          )}
        </div>

        {analysis && (
          <details className="maybe">
            <summary>What ran on this device</summary>
            <ul className="ran">
              {analysis.checks.map((c) => (
                <li key={c.id} data-ran={c.ran || undefined}>
                  <strong>{c.label}</strong>
                  <span>{c.note}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </aside>

      {/* Printed only: the report a reviewer files. */}
      {sealed && (
        <section className="video-report" aria-hidden="true">
          <h1>Veil video evidence report</h1>
          <p>Case {sealed.record.caseId} · {sealed.record.purpose === 'claim' ? 'Claim or case review' : 'Personal report'} · sealed {new Date(sealed.witness?.at ?? sealed.record.events.at(-1)?.at ?? sealed.record.createdAt).toLocaleString()}</p>
          <h2>The file</h2>
          <p>{sealed.record.asset.name} · {sealed.record.asset.size} · {facts.container}</p>
          <p className="mono">SHA-256 {sealed.record.asset.sha256}</p>
          <p>{sealed.record.credentials?.note}</p>
          <h2>Summary: {v.title}</h2>
          {sealed.record.reasons.for.length > 0 && (<><h3>Signs of tampering</h3><ul>{sealed.record.reasons.for.map((r) => <li key={r}>{r}</li>)}</ul></>)}
          {sealed.record.reasons.against.length > 0 && (<><h3>Signs it was left alone</h3><ul>{sealed.record.reasons.against.map((r) => <li key={r}>{r}</li>)}</ul></>)}
          <h2>Moments marked for review</h2>
          {analysis?.signals.length ? (
            <table>
              <thead><tr><th>Time</th><th>What</th><th>Could also be</th></tr></thead>
              <tbody>{analysis.signals.map((s) => (<tr key={s.id}><td>{stamp(s.start)}</td><td><strong>{s.title}.</strong> {s.says}</td><td>{s.innocent}</td></tr>))}</tbody>
            </table>
          ) : <p>None.</p>}
          <h2>Reviewer notes</h2>
          {notes.length ? <ul>{notes.map((n) => <li key={n.id}>{stamp(n.time)}: {n.text}</li>)}</ul> : <p>None.</p>}
          <h2>Handling log</h2>
          <ol>{sealed.record.events.map((e) => <li key={e.seq}>{new Date(e.at).toLocaleString()}: {e.detail}</li>)}</ol>
          <h2>Seal</h2>
          <p className="mono">Device key {sealed.device.keyId} · signature {sealed.signature.slice(0, 32)}…</p>
          <p>{sealed.witness ? `Server time stamp ${sealed.witness.at}, key ${sealed.witness.keyId}. The server received a fingerprint only.` : 'No server time stamp: sealed offline.'}</p>
          <h2>Limits</h2>
          <ul>{sealed.record.limits.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
