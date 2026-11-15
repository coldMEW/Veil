import { useEffect, useState } from 'react';
import {
  ALWAYS,
  deleteTicket,
  DEMO_SITE,
  isDemoUrl,
  siteOf,
  formatLeft,
  profile,
  tickets,
  timeLeft,
  updateTicket,
  matchLabel,
  statusLabel,
  type Destination,
  type Law,
  type Ticket,
} from '../../services/tickets';
import { evidencePack, LAW_LABEL, LAW_NOTE, mailtoFor, noticeBody, noticeSubject } from '../../services/notice';
import { hostInfo, urlStatus } from '../../services/api';
import { connectGmail, gmail, GOOGLE_CLIENT_ID, hasToken, mailAccount } from '../../services/mail';
import { isAndroid } from '../../platform/environment';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { href, navigate } from '../router';
import { toast } from '../App';
import { serverRecheck, syncTickets } from '../../services/ticketSync';
import { ArtTakedown } from '../shared/Art';

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}


/** While Tickets is open: read replies (Gmail) and re-check whether pictures are gone, on their own. */
function useAutoChecks(list: Ticket[]) {
  useEffect(() => {
    let live = true;
    const run = async () => {
      await syncTickets(); // the backend's timeline first, when there is one
      const open = tickets.get().filter((t) => t.sentAt && t.status !== 'removed' && t.status !== 'rejected');
      if (hasToken() && open.some((t) => t.gmailThreadId)) {
        try {
          const g = await gmail();
          const access = await connectGmail(); // returns the live token; never opens a window here (hasToken() was checked)
          const replies = await g.fetchReplies(access, open.map((t) => t.id));
          // Oldest first, so a later reply decides. Only replies in the thread Veil sent count.
          for (const r of [...replies].sort((x, y) => Date.parse(x.date) - Date.parse(y.date))) {
            const t = tickets.get().find((x) => x.id === r.ticketId);
            if (!t || r.threadId !== t.gmailThreadId || (t.replies ?? []).some((x) => x.messageId === r.messageId)) continue;
            const verdict = g.classifyReply(r.subject, r.snippet);
            const closed = t.status === 'removed';
            // A reply saying "removed" is a claim: the ticket closes only when the picture is really gone.
            let status: Ticket['status'] = closed || verdict === 'unknown' || verdict === 'removed' ? t.status : verdict;
            let note = verdict === 'unknown' ? 'read it below' : verdict.replace('_', ' ');
            if (verdict === 'removed' && !closed) {
              const check = await urlStatus(t.imageUrl ?? t.pageUrl).catch(() => null);
              if (check?.gone) {
                status = 'removed';
                note = `they say it is removed, and the picture is gone (${check.status})`;
              } else {
                status = t.status === 'ready' ? 'sent' : t.status === 'sent' ? 'acknowledged' : t.status;
                note = 'they say it is removed, but Veil can still reach the picture';
              }
            }
            updateTicket(
              t.id,
              (cur) => ({
                status,
                removedAt: status === 'removed' ? (cur.removedAt ?? Date.now()) : cur.removedAt,
                replies: [...(cur.replies ?? []), { at: Date.parse(r.date) || Date.now(), from: r.from, snippet: r.snippet, verdict, messageId: r.messageId }],
              }),
              `Reply from ${r.from}: ${note}.`,
            );
          }
        } catch {
          /* replies are retried on the next round */
        }
      }
      for (const t of open) {
        if (!live) return;
        if (t.lastCheckedAt && Date.now() - t.lastCheckedAt < 10 * 60 * 1000) continue;
        try {
          if (await serverRecheck(t)) continue; // the server looked and recorded what it saw
          const r = await urlStatus(t.imageUrl ?? t.pageUrl);
          if (r.gone) updateTicket(t.id, { status: 'removed', removedAt: Date.now(), lastCheckedAt: Date.now(), lastCheck: `Gone (${r.status})` }, `Checked automatically: the picture is gone (${r.status}). Ticket closed.`);
          else updateTicket(t.id, { lastCheckedAt: Date.now(), lastCheck: r.status >= 200 && r.status < 300 ? `Still up (${r.status})` : `Could not tell (the site answered ${r.status})` });
        } catch {
          /* offline or blocked; try again later */
        }
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 2 * 60 * 1000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [list.length]);
}

export default function TicketsScreen({ ticketId }: { ticketId: string | null }) {
  const list = tickets.use();
  const now = useNow();
  useAutoChecks(list);
  const selected = list.find((t) => t.id === ticketId) ?? null;

  return (
    <div className="tool tool-tickets" data-detail={selected ? 'open' : undefined}>
      <section className="ticket-list" aria-labelledby="tickets-title">
        <h1 id="tickets-title">Take it down</h1>
        {list.length === 0 ? (
          <div className="empty-note">
            <div className="empty-art"><ArtTakedown /></div>
            <p>No tickets yet. A ticket opens by itself when Veil finds your face or your photo somewhere, or when you report a fake from Check.</p>
            <a className="btn btn-alarm" href={href('trace')}>
              Find my face online
            </a>
          </div>
        ) : (
          <ul>
            {list.map((t) => {
              const s = statusLabel(t, now);
              return (
                <li key={t.id}>
                  <a href={href('tickets', t.id)} aria-current={t.id === ticketId ? 'true' : undefined}>
                    {t.thumb ? <img src={t.thumb} alt="" width="64" height="64" /> : <span className="thumb-blank" />}
                    <span className="tl-main">
                      <strong>{t.site}</strong>
                      <span>{matchLabel(t)}</span>
                      <span className="num tl-meta">Found {new Date(t.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {t.id}</span>
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
  const s = statusLabel(t, now);

  // Find who to tell, automatically, the first time a ticket is opened.
  useEffect(() => {
    if (t.destinations.some((d) => d.source === 'host' || d.source === 'registrar') || t.log.some((l) => l.text.startsWith('Looked up'))) return;
    let live = true;
    if (isDemoUrl(t.pageUrl)) {
      updateTicket(t.id, (cur) => ({ destinations: [...cur.destinations, { name: `${siteOf(t.pageUrl)} abuse team (demo)`, email: `abuse@${siteOf(t.pageUrl)}`, source: 'host' }] }), `Looked up the host: abuse@${DEMO_SITE} (demo).`);
      return;
    }
    setFinding(true);
    hostInfo(t.pageUrl)
      .then((h) => {
        if (!live) return;
        const found: Destination[] = [];
        if (h.hosting?.email) found.push({ name: `${h.hosting.name ?? 'Hosting company'} (hosts the site)`, email: h.hosting.email, source: 'host' });
        if (h.registrar?.email) found.push({ name: `${h.registrar.name ?? 'Registrar'} (sold the domain)`, email: h.registrar.email, source: 'registrar' });
        updateTicket(t.id, (cur) => ({ destinations: [...cur.destinations, ...found] }), found.length ? `Looked up the host: ${found.map((f) => f.email).join(', ')}.` : 'Looked up the host: no public abuse address.');
      })
      .catch(() => undefined) // a failed lookup is retried the next time the ticket is opened
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
      if (await serverRecheck(t)) {
        const now = tickets.get().find((x) => x.id === t.id);
        toast(now?.status === 'removed' ? 'It is gone. Ticket closed.' : (now?.lastCheck ?? 'Checked.'));
        return;
      }
      const r = await urlStatus(t.imageUrl ?? t.pageUrl);
      if (r.gone) updateTicket(t.id, { status: 'removed', removedAt: Date.now(), lastCheckedAt: Date.now(), lastCheck: `Gone (${r.status})` }, `Checked: the picture is gone (${r.status}). Ticket closed.`);
      else {
        const up = r.status >= 200 && r.status < 300;
        updateTicket(t.id, { lastCheckedAt: Date.now(), lastCheck: up ? `Still up (${r.status})` : `Could not tell (the site answered ${r.status})` }, up ? `Checked: still up (${r.status}).` : `Checked: could not tell, the site answered ${r.status}.`);
      }
      toast(r.gone ? 'It is gone. Ticket closed.' : r.status >= 200 && r.status < 300 ? 'Still up.' : 'Could not tell: the site did not give a clear answer.');
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
  const account = mailAccount.use();
  const [sending, setSending] = useState(false);

  const sendGmail = async () => {
    if (!emails.length) return toast('There is no email address for this site. Use the report form or Google Search removal.');
    if (!me.name.trim() || !me.email.trim()) return toast('Add your name and email first; the notice is signed with them.');
    setSending(true);
    try {
      const access = await connectGmail();
      const g = await gmail();
      const evidence = new Uint8Array(await evidencePack(t).arrayBuffer());
      const mime = g.buildMime({
        from: mailAccount.get().email ?? me.email,
        to: emails.map((d) => d.email!),
        replyTo: me.email,
        subject: g.tagSubject(t.id, noticeSubject(t)),
        text: noticeBody(t),
        attachment: { name: `veil-evidence-${t.id}.html`, type: 'text/html', bytes: evidence },
      });
      const sent = await g.sendGmail(access, mime);
      updateTicket(t.id, { status: 'sent', sentAt: Date.now(), sentVia: 'gmail', gmailThreadId: sent.threadId }, `Sent from ${mailAccount.get().email ?? me.email} to ${emails.map((d) => d.email).join(', ')} with the evidence file.`);
      toast('Sent. Veil will watch for their reply.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sending failed.');
    } finally {
      setSending(false);
    }
  };

  const sendWithMailApp = async () => {
    setSending(true);
    try {
      const html = await evidencePack(t).text();
      const file = await Filesystem.writeFile({ path: `veil-evidence-${t.id}.html`, data: html, directory: Directory.Cache, encoding: 'utf8' as never });
      await Share.share({
        title: noticeSubject(t),
        text: `To: ${emails.map((d) => d.email).join(', ') || '(the address on the report form)'}\n\n${noticeBody(t)}`,
        files: [file.uri],
        dialogTitle: 'Send the notice with',
      });
      // Opening the share sheet does not prove the email went out: the person confirms with "I sent it".
      updateTicket(t.id, { sentVia: 'mail-app' }, 'Opened in your mail app with the evidence file. Tap "I sent it" once it is sent.');
      toast('When the email is sent, tap "I sent it" to start the clock.');
    } catch (e) {
      if (!/cancel/i.test(String(e))) toast(e instanceof Error ? e.message : 'Could not open your mail app.');
    } finally {
      setSending(false);
    }
  };
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
          <p className="td-what">{matchLabel(t)}</p>
          <p className="small">{t.match.detail}</p>
          <a className="link-quiet small td-url" href={t.pageUrl} target="_blank" rel="noreferrer noopener">
            {t.pageUrl}
          </a>
        </div>
        <div className="td-clock" data-colour={s.tone}>
          {t.status === 'sent' && left !== null ? (
            <>
              <strong className="num">{formatLeft(left)}</strong>
              <span>of the 48-hour removal window (TAKE IT DOWN Act)</span>
            </>
          ) : t.status !== 'ready' && t.status !== 'removed' ? (
            <>
              <strong>{s.label.split(' · ')[0]}</strong>
              <span className="num">{t.sentAt ? `sent ${new Date(t.sentAt).toLocaleString()}` : ''}</span>
            </>
          ) : t.status === 'removed' ? (
            <>
              <strong>Removed</strong>
              <span className="num">{t.removedAt ? new Date(t.removedAt).toLocaleString() : ''}</span>
            </>
          ) : (
            <>
              <strong>Not sent yet</strong>
              <span>The notice is written. Send it below.</span>
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
          {!isAndroid() && GOOGLE_CLIENT_ID && emails[0] && (
            <button className="btn btn-alarm" disabled={sending} onClick={() => void sendGmail()}>
              {sending ? 'Sending…' : account.email ? `Send from ${account.email}` : 'Send from my Gmail'}
            </button>
          )}
          {isAndroid() && (
            <button className="btn btn-alarm" disabled={sending} onClick={() => void sendWithMailApp()}>
              Send with my email app
            </button>
          )}
          {!isAndroid() && emails[0] && (
            <a className="btn btn-ghost-light" href={mailtoFor(t, emails.map((d) => d.email).join(','))} onClick={() => window.setTimeout(() => updateTicket(t.id, (c) => (c.sentAt ? {} : { sentVia: 'mailto' })), 0)}>
              Open in my mail app
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
            <button className="btn btn-ink" onClick={() => updateTicket(t.id, { status: 'sent', sentAt: Date.now() }, t.law === 'take-it-down' ? 'Marked as sent. The 48-hour removal window started.' : 'Marked as sent.')}>
              I sent it
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
        {(t.replies ?? []).length > 0 && (
          <ul className="replies">
            {t.replies!.map((r) => (
              <li key={r.messageId} data-verdict={r.verdict}>
                <strong>{r.from}</strong> <span className="num">{new Date(r.at).toLocaleString()}</span>
                <p>{r.snippet}</p>
              </li>
            ))}
          </ul>
        )}
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
