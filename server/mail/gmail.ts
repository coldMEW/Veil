// Gmail through the person's own account. Browser-safe: fetch, TextEncoder and btoa only (no Node imports).

const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const wrap76 = (s: string) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
/** RFC 2047 encoded-word for non-ASCII header text. */
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(enc.encode(s))}?=`);
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export const TAG = /\[Veil (VT-[A-Z0-9]+)\]/;
export function tagSubject(ticketId: string, subject: string): string {
  return TAG.test(subject) ? subject : `[Veil ${ticketId}] ${subject}`;
}
export function ticketIdFrom(subject: string): string | null {
  return subject.match(TAG)?.[1] ?? null;
}

export interface Mail {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  text: string;
  attachment?: { name: string; type: string; bytes: Uint8Array };
}

const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function buildMime(m: Mail): string {
  const to = m.to.map(clean);
  if (!to.length || to.length > 5 || to.some((a) => !ADDRESS.test(a))) throw new Error('A notice needs one to five valid email addresses.');
  if (!ADDRESS.test(clean(m.from))) throw new Error('The sender address is not valid.');
  const boundary = `veil-${crypto.randomUUID()}`;
  const head = [
    `From: ${clean(m.from)}`,
    `To: ${to.join(', ')}`,
    ...(m.replyTo && ADDRESS.test(clean(m.replyTo)) ? [`Reply-To: ${clean(m.replyTo)}`] : []),
    `Subject: ${header(clean(m.subject))}`,
    'MIME-Version: 1.0',
  ];
  const textPart = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(enc.encode(m.text)))].join('\r\n');
  if (!m.attachment) return [...head, textPart].join('\r\n');
  const name = clean(m.attachment.name).replace(/["\\]/g, '_');
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    textPart,
    `--${boundary}`,
    `Content-Type: ${m.attachment.type}; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(m.attachment.bytes)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Gmail answered ${res.status}.`);
  }
  return (await res.json()) as T;
}

export async function sendGmail(token: string, mime: string): Promise<{ id: string; threadId: string }> {
  return api(token, 'messages/send', { method: 'POST', body: JSON.stringify({ raw: b64url(enc.encode(mime)) }) });
}

export interface Reply { ticketId: string; messageId: string; threadId: string; from: string; date: string; subject: string; snippet: string }

/** Replies to Veil notices: tagged mail that the person did not send themselves. */
export async function fetchReplies(token: string, ticketIds: string[]): Promise<Reply[]> {
  if (!ticketIds.length) return [];
  const me = (await api<{ emailAddress: string }>(token, 'profile')).emailAddress.toLowerCase();
  const list = await api<{ messages?: Array<{ id: string }> }>(token, `messages?maxResults=50&q=${encodeURIComponent('subject:"[Veil VT-" newer_than:60d')}`);
  const out: Reply[] = [];
  for (const { id } of list.messages ?? []) {
    const msg = await api<{ id: string; threadId: string; snippet: string; payload: { headers: Array<{ name: string; value: string }> } }>(
      token,
      `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    const h = (n: string) => msg.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? '';
    const ticketId = ticketIdFrom(h('subject'));
    if (!ticketId || !ticketIds.includes(ticketId)) continue;
    if (h('from').toLowerCase().includes(me)) continue; // the person's own sent copy
    out.push({ ticketId, messageId: msg.id, threadId: msg.threadId, from: h('from'), date: h('date'), subject: h('subject'), snippet: msg.snippet });
  }
  return out;
}

export type Verdict = 'acknowledged' | 'removed' | 'rejected' | 'needs_info' | 'unknown';

const NEGATED = /\bremoved (nothing|no content|none)\b|\b(nothing|no content) (has been|was|were) (removed|taken down)|\b(has|have|was|were|is|are)\s+not\s+(yet\s+)?(been\s+)?(removed|taken down|deleted|disabled)|\bif\b[^.]{0,60}\b(removed|taken down)|\b(not|unable to|cannot|can't|won't)\s+(remove|take (it|this|the content) down|delete)/i;
const REMOVED = /\b(has|have) been (removed|taken down|deleted|disabled)|\bwe('ve| have)? (removed|taken down|deleted|disabled)|\bis no longer available|\bdisabled access\b|\bcontent was removed|\bremoved the (reported )?(content|image|photo|post|material)/i;
const REJECTED = /does(n't| not) violate|not in violation|no violation|unable to take action|will not be (removed|taking action)|cannot (take action|remove)|not (be )?able to (remove|act)|declin(e|ed) (your|the) request|request (is|was|has been) (denied|rejected|declined)|isn't against our|not against our/i;
const NEEDS = /more information|additional information|please provide|need you to|verify your identity|proof of identity|could you (send|provide|confirm)|missing (information|details)|incomplete (notice|request)/i;
const ACK = /received your (report|request|notice|message)|we('re| are) (reviewing|looking into)|ticket (number|id)|case (number|id)|thank you for (contacting|reaching out|your report)|will review|under review/i;

/** Keyword rules, strictest first. Anything unclear stays 'unknown' and is shown to the person to read. */
export function classifyReply(subject: string, text: string): Verdict {
  const t = `${subject}\n${text}`.replace(/\s+/g, ' ');
  if (REJECTED.test(t)) return 'rejected';
  if (NEEDS.test(t)) return 'needs_info';
  if (REMOVED.test(t) && !NEGATED.test(t)) return 'removed';
  if (ACK.test(t)) return 'acknowledged';
  return 'unknown';
}
