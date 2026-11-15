import { profile, type Law, type Ticket } from './tickets';

export const LAW_LABEL: Record<Law, string> = {
  policy: 'Platform rules (impersonation)',
  'take-it-down': 'TAKE IT DOWN Act (US)',
  dmca: 'DMCA copyright notice (US)',
  gdpr: 'GDPR right to erasure (EU/UK)',
};

export const LAW_NOTE: Record<Law, string> = {
  policy: 'For fakes that are not intimate. Every big platform bans impersonation and deceptive AI-made pictures of real people.',
  'take-it-down':
    'For intimate images made or shared without consent, real or AI-made. Covered platforms must remove them within 48 hours of a valid request.',
  dmca: 'When the fake was made from a photo you took. Your copyright in the original is the lever; Veil mark and the comparison are the proof.',
  gdpr: 'Your face is personal data. You can ask any site that serves people in the EU or UK to erase it without undue delay.',
};

function date(ms: number) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function noticeSubject(t: Ticket): string {
  if (t.law === 'dmca') return `DMCA takedown notice: ${t.site} (ref ${t.id})`;
  if (t.law === 'policy') return `Report: AI-made impersonation of me on ${t.site} (ref ${t.id})`;
  if (t.law === 'gdpr') return `Erasure request under GDPR Art. 17: ${t.site} (ref ${t.id})`;
  return `Removal request under the TAKE IT DOWN Act: ${t.site} (ref ${t.id})`;
}

export function noticeBody(t: Ticket): string {
  const p = profile.get();
  const name = p.name.trim() || '[your full name]';
  const email = p.email.trim() || '[your email]';
  const where = [`Page: ${t.pageUrl}`, t.imageUrl ? `Image: ${t.imageUrl}` : null].filter(Boolean).join('\n');
  const evidence = [
    `Found by Veil on ${date(t.createdAt)} (reference ${t.id}).`,
    t.match.detail,
    ...t.findings,
    t.imageSha256 ? `SHA-256 of the image as found: ${t.imageSha256}` : null,
  ]
    .filter(Boolean)
    .map((l) => `- ${l}`)
    .join('\n');

  if (t.law === 'dmca') {
    return `To the designated copyright agent of ${t.site},

I am the owner of the copyright in an original photograph. The material below copies and alters that photograph without my permission.

Infringing material:
${where}

Evidence:
${evidence}

I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law. The information in this notice is accurate, and under penalty of perjury, I am the owner of the exclusive right that is allegedly infringed.

Please remove or disable access to this material.

${name}
${email}
Signed electronically: /${name}/  ${date(Date.now())}`;
  }

  if (t.law === 'policy') {
    return `To the trust and safety team of ${t.site},

The picture below shows my face in a scene that never happened. It was made with AI or an editing tool and is posted without my consent. It impersonates me and misleads anyone who sees it, which breaks your rules on impersonation and on deceptive synthetic or manipulated media.

Where it is:
${where}

Evidence:
${evidence}

Please remove it and any copies, and tell me what you did.

${name}
${email}`;
  }

  if (t.law === 'gdpr') {
    return `To the data protection contact of ${t.site},

Under Article 17 of the General Data Protection Regulation (and the UK GDPR), I request the erasure of personal data about me: an image that shows my face and that I did not consent to.

Where it is:
${where}

Evidence:
${evidence}

Please erase this image and any copies without undue delay and confirm within one month, as Article 12(3) requires.

${name}
${email}`;
  }

  return `To the trust and safety team of ${t.site},

This is a removal request under Section 3 of the TAKE IT DOWN Act. The image below is an intimate visual depiction of me, or a digital forgery of me, published without my consent.

Where it is:
${where}

Evidence:
${evidence}

I state in good faith that this depiction is not consensual. Under the Act, please remove it, and any identical copies you can find, within 48 hours of receiving this request.

${name}
${email}
Signed electronically: /${name}/  ${date(Date.now())}`;
}

export function mailtoFor(t: Ticket, to: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(noticeSubject(t))}&body=${encodeURIComponent(noticeBody(t))}`;
}

/** A self-contained evidence file: open it, print it, attach it. Nothing is uploaded. */
export function evidencePack(t: Ticket): Blob {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const rows = [
    ['Reference', t.id],
    ['Opened', date(t.createdAt)],
    ['Site', t.site],
    ['Page', t.pageUrl],
    ['Image', t.imageUrl ?? '—'],
    ['Match', t.match.detail],
    ['Image SHA-256', t.imageSha256 ?? '—'],
    ['Legal route', LAW_LABEL[t.law]],
    ['Sent', t.sentAt ? date(t.sentAt) : 'not yet'],
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Veil evidence ${esc(t.id)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111}h1{font-size:28px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:20px 0}td{padding:8px 10px;vertical-align:top;border-bottom:1px solid #ddd;word-break:break-all}td:first-child{width:160px;color:#555}pre{white-space:pre-wrap;background:#f4f4f1;padding:16px}img{max-width:320px;border:1px solid #ccc}</style></head><body>
<h1>Evidence record ${esc(t.id)}</h1><p>Prepared with Veil on ${esc(date(Date.now()))}.</p>
${t.thumb ? `<img src="${t.thumb}" alt="The image as found">` : ''}
<table>${rows.map(([k, v]) => `<tr><td>${esc(k!)}</td><td>${esc(v!)}</td></tr>`).join('')}</table>
${t.findings.length ? `<h2>Findings</h2><ul>${t.findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
<h2>Notice</h2><pre>${esc(noticeBody(t))}</pre>
<h2>History</h2><ul>${t.log.map((l) => `<li>${esc(date(l.at))}: ${esc(l.text)}</li>`).join('')}</ul>
</body></html>`;
  return new Blob([html], { type: 'text/html' });
}
