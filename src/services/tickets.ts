import { persisted, uid } from './store';

export type MatchKind = 'face' | 'copy' | 'mark' | 'manual';
export type Law = 'policy' | 'take-it-down' | 'dmca' | 'gdpr';
export type TicketStatus = 'ready' | 'sent' | 'acknowledged' | 'needs_info' | 'rejected' | 'removed';

export interface Destination {
  name: string;
  /** The platform's own report page, when one is known. */
  reportUrl?: string;
  /** Abuse mailbox of the platform or of the company that hosts the site. */
  email?: string;
  /** How the destination was found. */
  source: 'platform' | 'host' | 'registrar' | 'none';
}

export interface Ticket {
  id: string;
  createdAt: number;
  pageUrl: string;
  imageUrl: string | null;
  site: string;
  match: { kind: MatchKind; score: number | null; detail: string };
  /** Evidence thumbnail of the found image (data URL, kept on this device). */
  thumb: string | null;
  imageSha256: string | null;
  findings: string[];
  law: Law;
  destinations: Destination[];
  status: TicketStatus;
  sentAt: number | null;
  removedAt: number | null;
  lastCheckedAt: number | null;
  lastCheck: string | null;
  log: Array<{ at: number; text: string }>;
  sentVia?: 'gmail' | 'mail-app' | 'form' | 'mailto' | null;
  gmailThreadId?: string | null;
  replies?: Array<{ at: number; from: string; snippet: string; verdict: string; messageId: string }>;
}

export const tickets = persisted<Ticket[]>('veil.tickets.v1', []);
export const profile = persisted<{ name: string; email: string; country: 'US' | 'EU' | 'UK' | 'other' }>('veil.profile.v1', {
  name: '',
  email: '',
  country: 'US',
});

export const HOURS_48 = 48 * 3600 * 1000;

/** Known platforms: their own report routes beat a generic abuse email. Checked 2026-11. */
const PLATFORMS: Array<{ match: RegExp; name: string; reportUrl: string; email?: string }> = [
  { match: /(^|\.)instagram\.com$/, name: 'Instagram', reportUrl: 'https://help.instagram.com/contact/1141853830778488' },
  { match: /(^|\.)(facebook|fb)\.com$/, name: 'Facebook', reportUrl: 'https://www.facebook.com/help/contact/144059062408922' },
  { match: /(^|\.)(x|twitter)\.com$/, name: 'X', reportUrl: 'https://help.x.com/forms/private-information' },
  { match: /(^|\.)tiktok\.com$/, name: 'TikTok', reportUrl: 'https://www.tiktok.com/legal/report/privacy' },
  { match: /(^|\.)reddit\.com$/, name: 'Reddit', reportUrl: 'https://support.reddithelp.com/hc/en-us/requests/new' },
  { match: /(^|\.)(youtube\.com|youtu\.be)$/, name: 'YouTube', reportUrl: 'https://support.google.com/youtube/answer/142443' },
  { match: /(^|\.)(t\.me|telegram\.org|telegram\.me)$/, name: 'Telegram', reportUrl: 'https://telegram.org/support', email: 'abuse@telegram.org' },
  { match: /(^|\.)discord(app)?\.(com|gg)$/, name: 'Discord', reportUrl: 'https://dis.gd/request' },
  { match: /(^|\.)snapchat\.com$/, name: 'Snapchat', reportUrl: 'https://help.snapchat.com/hc/en-us/requests/new' },
  { match: /(^|\.)pinterest\.com$/, name: 'Pinterest', reportUrl: 'https://help.pinterest.com/en/contact' },
  { match: /(^|\.)linkedin\.com$/, name: 'LinkedIn', reportUrl: 'https://www.linkedin.com/help/linkedin/ask/TS-NFPI' },
];

/** Routes that work wherever the image is hosted. */
export const ALWAYS = {
  googleSearch: { name: 'Google Search removal', url: 'https://support.google.com/websearch/answer/9116649' },
  stopNcii: { name: 'StopNCII (intimate images, adults)', url: 'https://stopncii.org/' },
  takeItDown: { name: 'Take It Down (under 18)', url: 'https://takeitdown.ncmec.org/' },
  ftc: { name: 'Report a platform that ignores you (FTC)', url: 'https://reportfraud.ftc.gov/' },
};

/** The demo feed page ships with Veil; it is shown under its made-up name. */
export const DEMO_SITE = 'fakefeed.example';
export function isDemoUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin && u.pathname.includes('/demo/');
  } catch {
    return false;
  }
}

export function siteOf(url: string): string {
  try {
    // Each bundled test page is shown under its own made-up site name.
    if (isDemoUrl(url)) return /\/demo\/real/.test(new URL(url, window.location.href).pathname) ? 'campusfeed.example' : DEMO_SITE;
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function platformFor(url: string): Destination | null {
  const host = siteOf(url);
  const p = PLATFORMS.find((x) => x.match.test(host));
  return p ? { name: p.name, reportUrl: p.reportUrl, email: p.email, source: 'platform' } : null;
}

/** Intimate images get the TAKE IT DOWN Act; the person picks that. Other fakes start from the platform's own rules. */
export function defaultLaw(hasOriginal: boolean): Law {
  const c = profile.get().country;
  if (c === 'EU' || c === 'UK') return 'gdpr';
  // Copyright needs the person to confirm they took the original; Veil never assumes it.
  void hasOriginal;
  return 'policy';
}

export function createTicket(input: {
  pageUrl: string;
  imageUrl: string | null;
  match: Ticket['match'];
  thumb: string | null;
  imageSha256: string | null;
  findings?: string[];
  destinations?: Destination[];
}): Ticket {
  // One ticket per image: a second find of the same image updates the first.
  const existing = tickets.get().find((t) => (input.imageUrl && t.imageUrl === input.imageUrl) || (!input.imageUrl && t.pageUrl === input.pageUrl));
  if (existing) return existing;
  const platform = platformFor(input.pageUrl);
  const ticket: Ticket = {
    id: uid('VT-'),
    createdAt: Date.now(),
    pageUrl: input.pageUrl,
    imageUrl: input.imageUrl,
    site: siteOf(input.pageUrl),
    match: input.match,
    thumb: input.thumb,
    imageSha256: input.imageSha256,
    findings: input.findings ?? [],
    law: defaultLaw(input.match.kind === 'mark' || input.match.kind === 'copy'),
    destinations: input.destinations ?? (platform ? [platform] : []),
    status: 'ready',
    sentAt: null,
    removedAt: null,
    lastCheckedAt: null,
    lastCheck: null,
    log: [{ at: Date.now(), text: 'Ticket opened automatically from a match.' }],
  };
  tickets.set((list) => [ticket, ...list]);
  return ticket;
}

export function updateTicket(id: string, patch: Partial<Ticket> | ((t: Ticket) => Partial<Ticket>), logText?: string) {
  tickets.set((list) =>
    list.map((t) => {
      if (t.id !== id) return t;
      const p = typeof patch === 'function' ? patch(t) : patch;
      // The same destination is never listed twice (lookups can run more than once).
      if (p.destinations) p.destinations = p.destinations.filter((d, i, all) => all.findIndex((o) => (o.email ?? o.reportUrl ?? o.name) === (d.email ?? d.reportUrl ?? d.name)) === i);
      return { ...t, ...p, log: logText ? [...t.log, { at: Date.now(), text: logText }] : t.log };
    }),
  );
}

export function deleteTicket(id: string) {
  tickets.set((list) => list.filter((t) => t.id !== id));
}

export function timeLeft(t: Ticket, now = Date.now()): number | null {
  // The 48-hour removal window exists in the TAKE IT DOWN Act only; other routes have no fixed clock.
  if (!t.sentAt || t.law !== 'take-it-down' || t.status === 'removed' || t.status === 'rejected') return null;
  return t.sentAt + HOURS_48 - now;
}

export function formatLeft(ms: number): string {
  const sign = ms < 0 ? -1 : 1;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const text = h > 0 ? `${h} h ${m} min` : `${m} min`;
  return sign < 0 ? `${text} overdue` : `${text} left`;
}

/** What was found, in words a person understands at a glance. */
export function matchLabel(t: Ticket): string {
  if (t.match.kind === 'face') return t.match.score !== null ? `Matches your face (similarity ${t.match.score.toFixed(2)})` : 'Matches your face';
  if (t.match.kind === 'copy') return 'A copy of your photo';
  if (t.match.kind === 'mark') return 'Carries your Veil mark';
  return 'You reported it from Check';
}

function hours(ms: number): string {
  const h = Math.round(ms / 3600000);
  return h < 1 ? `${Math.max(1, Math.round(ms / 60000))} min` : `${h} h`;
}

/** Where the ticket stands, as a concrete sentence for the list and the header. */
export function statusLabel(t: Ticket, now = Date.now()): { label: string; tone: 'alarm' | 'paper' | 'lime' } {
  const via = t.sentVia === 'gmail' ? 'from your Gmail' : t.sentVia === 'mail-app' ? 'from your mail app' : '';
  switch (t.status) {
    case 'ready':
      return { label: 'Not sent yet', tone: 'alarm' };
    case 'removed':
      return { label: `Removed after ${hours((t.removedAt ?? now) - (t.sentAt ?? t.createdAt))}`, tone: 'lime' };
    case 'rejected':
      return { label: 'Rejected: escalate it', tone: 'alarm' };
    case 'needs_info':
      return { label: 'They asked for more info', tone: 'alarm' };
    case 'acknowledged': {
      const left = timeLeft(t, now);
      return { label: left !== null && left < 0 ? `Received, ${formatLeft(left)}` : 'They confirmed receipt', tone: 'paper' };
    }
    default: {
      const left = timeLeft(t, now);
      if (left === null) return { label: `Sent ${via}`.trim() + (t.sentAt ? ` · ${hours(now - t.sentAt)} ago` : ''), tone: 'paper' };
      return left < 0 ? { label: `No reply, ${formatLeft(left)}`, tone: 'alarm' } : { label: `Waiting for reply · ${formatLeft(left)}`, tone: 'paper' };
    }
  }
}
