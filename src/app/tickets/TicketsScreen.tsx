import { useEffect, useState } from 'react';
import {
  ALWAYS,
  deleteTicket,
  formatLeft,
  profile,
  tickets,
  timeLeft,
  updateTicket,
  type Destination,
  type Law,
  type Ticket,
} from '../../services/tickets';
import { evidencePack, LAW_LABEL, LAW_NOTE, mailtoFor, noticeBody, noticeSubject } from '../../services/notice';
import { hostInfo, urlStatus } from '../../services/api';
import { href, navigate } from '../router';
import { toast } from '../App';

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function statusOf(t: Ticket, now: number): { label: string; tone: string } {
  if (t.status === 'removed') return { label: 'Removed', tone: 'lime' };
  if (t.status === 'sent') {
    const left = timeLeft(t, now) ?? 0;
    return left < 0 ? { label: formatLeft(left), tone: 'alarm' } : { label: formatLeft(left), tone: 'paper' };
  }
  return { label: 'Ready to send', tone: 'alarm' };
}

export default function TicketsScreen({ ticketId }: { ticketId: string | null }) {
  const list = tickets.use();
  const now = useNow();
  const selected = list.find((t) => t.id === ticketId) ?? null;

  return (
    <div className="tool tool-tickets" data-detail={selected ? 'open' : undefined}>
      <section className="ticket-list" aria-labelledby="tickets-title">
        <h1 id="tickets-title">Take it down</h1>
        {list.length === 0 ? (
          <div className="empty-note">
            <p>No tickets yet. A ticket opens by itself when Veil finds your face or your photo somewhere, or when you report a fake from Check.</p>
            <a className="btn btn-ink" href={href('trace')}>
              Find my face online
            </a>
          </div>
        ) : (
          <ul>
            {list.map((t) => {
              const s = statusOf(t, now);
              return (
                <li key={t.id}>
                  <a href={href('tickets', t.id)} aria-current={t.id === ticketId ? 'true' : undefined}>
                    {t.thumb ? <img src={t.thumb} alt="" width="64" height="64" /> : <span className="thumb-blank" />}
                    <span className="tl-main">
                      <strong>{t.site}</strong>
                      <span className="num">{t.id}</span>
                    </span>
                    <span className="pill num" data-colour={s.tone}>
                      {s.label}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {selected ? (
        <TicketDetail key={selected.id} t={selected} now={now} />
      ) : (
        list.length > 0 && (
          <section className="ticket-detail ticket-placeholder">
            <p>Choose a ticket to send it, follow the clock and check whether the picture is gone.</p>
          </section>
        )
      )}
    </div>
  );
}

function TicketDetail({ t, now }: { t: Ticket; now: number }) {
  const me = profile.use();
  const [finding, setFinding] = useState(false);
  const [checking, setChecking] = useState(false);
  const s = statusOf(t, now);

  // Find who to tell, automatically, the first time a ticket is opened.
  useEffect(() => {
    if (t.destinations.some((d) => d.source === 'host' || d.source === 'registrar') || t.log.some((l) => l.text.startsWith('Looked up'))) return;
    let live = true;
    setFinding(true);
    hostInfo(t.pageUrl)
      .then((h) => {
        if (!live) return;
        const found: Destination[] = [];
        if (h.hosting?.email) found.push({ name: `${h.hosting.name ?? 'Hosting company'} (hosts the site)`, email: h.hosting.email, source: 'host' });
        if (h.registrar?.email) found.push({ name: `${h.registrar.name ?? 'Registrar'} (sold the domain)`, email: h.registrar.email, source: 'registrar' });
        updateTicket(t.id, (cur) => ({ destinations: [...cur.destinations, ...found] }), found.length ? `Looked up the host: ${found.map((f) => f.email).join(', ')}.` : 'Looked up the host: no public abuse address.');
      })
      .catch(() => live && updateTicket(t.id, {}, 'Looked up the host: lookup unavailable.'))
      .finally(() => live && setFinding(false));
    return () => {
      live = false;
    };
  }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${noticeSubject(t)}\n\n${noticeBody(t)}`);
      toast('Notice copied.');
    } catch {
      toast('Copy did not work here. Select the text and copy it.');
    }
  };

  const recheck = async () => {
    setChecking(true);
    try {
      const r = await urlStatus(t.imageUrl ?? t.pageUrl);
      if (r.gone) updateTicket(t.id, { status: 'removed', removedAt: Date.now(), lastCheckedAt: Date.now(), lastCheck: `Gone (${r.status})` }, `Checked: the picture is gone (${r.status}). Ticket closed.`);
      else updateTicket(t.id, { lastCheckedAt: Date.now(), lastCheck: `Still up (${r.status})` }, `Checked: still up (${r.status}).`);
      toast(r.gone ? 'It is gone. Ticket closed.' : 'Still up.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not check.');
    } finally {
      setChecking(false);
    }
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(evidencePack(t));
    a.download = `veil-evidence-${t.id}.html`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const emails = t.destinations.filter((d) => d.email);
  const forms = t.destinations.filter((d) => d.reportUrl);
  const left = timeLeft(t, now);

  return (
    <section className="ticket-detail" aria-labelledby="ticket-title">
      <a className="back-link" href={href('tickets')}>
        All tickets
      </a>
      <header className="td-head">
        {t.thumb && <img src={t.thumb} alt="The picture as found" />}
        <div>
          <h2 id="ticket-title">{t.site}</h2>
          <p className="num small">
            {t.id} · opened {new Date(t.createdAt).toLocaleString()}
          </p>
          <p>{t.match.detail}</p>
          <a className="link-quiet small td-url" href={t.pageUrl} target="_blank" rel="noreferrer noopener">
            {t.pageUrl}
          </a>
        </div>
        <div className="td-clock" data-colour={s.tone}>
          {t.status === 'sent' && left !== null ? (
            <>
              <strong className="num">{formatLeft(left)}</strong>
              <span>of the 48-hour removal window</span>
            </>
          ) : t.status === 'removed' ? (
            <>
              <strong>Removed</strong>
              <span className="num">{t.removedAt ? new Date(t.removedAt).toLocaleString() : ''}</span>
            </>
          ) : (
            <>
              <strong>Ready</strong>
              <span>Send it to start the clock</span>
            </>
          )}
        </div>
      </header>

      <div className="td-step">
        <h3>Who to tell</h3>
        <ul className="dest">
          {t.destinations.map((d) => (
            <li key={`${d.name}-${d.email ?? d.reportUrl}`}>
              <strong>{d.name}</strong>
              {d.email && <span>{d.email}</span>}
              {d.reportUrl && (
                <a className="link-quiet" href={d.reportUrl} target="_blank" rel="noreferrer noopener">
                  Report form
                </a>
              )}
            </li>
          ))}
          {finding && <li className="muted">Looking up who hosts {t.site}…</li>}
          {!finding && t.destinations.length === 0 && <li className="muted">No platform form or public abuse address was found. Use Google Search removal below and keep the evidence.</li>}
          <li>
            <strong>{ALWAYS.googleSearch.name}</strong>
            <a className="link-quiet" href={ALWAYS.googleSearch.url} target="_blank" rel="noreferrer noopener">
              Removes it from search results
            </a>
          </li>
          <li>
            <strong>{ALWAYS.stopNcii.name}</strong>
            <a className="link-quiet" href={ALWAYS.stopNcii.url} target="_blank" rel="noreferrer noopener">
              Blocks re-uploads on member platforms
            </a>
          </li>
        </ul>
      </div>

      <div className="td-step">
        <h3>The notice</h3>
        <div className="segmented on-light" role="radiogroup" aria-label="Legal route">
          {(Object.keys(LAW_LABEL) as Law[]).map((l) => (
            <button key={l} role="radio" aria-checked={t.law === l} onClick={() => updateTicket(t.id, { law: l })}>
              {LAW_LABEL[l]}
            </button>
          ))}
        </div>
        <p className="small">{LAW_NOTE[t.law]}</p>
        <div className="me-row">
          <label>
            <span>Your name</span>
            <input className="field" value={me.name} onChange={(e) => profile.set({ ...me, name: e.target.value })} autoComplete="name" />
          </label>
          <label>
            <span>Your email</span>
            <input className="field" type="email" value={me.email} onChange={(e) => profile.set({ ...me, email: e.target.value })} autoComplete="email" />
          </label>
        </div>
        <pre className="notice" tabIndex={0} aria-label="Notice text">
          {noticeBody(t)}
        </pre>
        <div className="td-actions">
          {emails[0] && (
            <a className="btn btn-alarm" href={mailtoFor(t, emails.map((d) => d.email).join(','))}>
              Email it
            </a>
          )}
          {forms[0] && (
            <a className="btn btn-alarm" href={forms[0].reportUrl} target="_blank" rel="noreferrer noopener" onClick={() => void copy()}>
              Copy and open {forms[0].name}
            </a>
          )}
          <button className="btn btn-ghost-light" onClick={() => void copy()}>
            Copy notice
          </button>
          <button className="btn btn-ghost-light" onClick={download}>
            Evidence file
          </button>
        </div>
      </div>

      <div className="td-step">
        <h3>After you send it</h3>
        <div className="td-actions">
          {t.status === 'ready' && (
            <button className="btn btn-ink" onClick={() => updateTicket(t.id, { status: 'sent', sentAt: Date.now() }, 'Marked as sent. The 48-hour clock started.')}>
              I sent it: start the clock
            </button>
          )}
          {t.status !== 'removed' && (
            <button className="btn btn-ink" disabled={checking} onClick={() => void recheck()}>
              {checking ? 'Checking…' : 'Check if it is gone'}
            </button>
          )}
          {t.status === 'sent' && left !== null && left < 0 && (
            <a className="btn btn-alarm" href={ALWAYS.ftc.url} target="_blank" rel="noreferrer noopener">
              Report the platform to the FTC
            </a>
          )}
        </div>
        {t.lastCheck && <p className="small">Last check: {t.lastCheck}, {t.lastCheckedAt ? new Date(t.lastCheckedAt).toLocaleString() : ''}</p>}
        <ol className="log">
          {t.log.map((l) => (
            <li key={l.at + l.text}>
              <span className="num">{new Date(l.at).toLocaleString()}</span> {l.text}
            </li>
          ))}
        </ol>
        <button
          className="link-quiet linkish small"
          onClick={() => {
            deleteTicket(t.id);
            navigate('tickets');
          }}
        >
          Delete this ticket
        </button>
      </div>
    </section>
  );
}
