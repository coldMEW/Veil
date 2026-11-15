import { isAndroid } from '../platform/environment';
import { persisted } from './store';
import { isDemoUrl, tickets, updateTicket, type Ticket } from './tickets';

/*
 * The Python backend is the durable record for tickets on the web: it keeps the timeline, re-checks
 * every 15 minutes whether the picture is gone even when Veil is closed, and flags overdue ones.
 * Only ticket facts are sent (addresses, route, match kind and score); never the photo, thumbnail or face data.
 * Without the backend (or on Android, which works offline) tickets stay on the device and nothing breaks.
 */

interface ServerEvent { at: string; type: string; detail: Record<string, unknown> }
interface ServerTicket { id: string; status: string; events: ServerEvent[] }

const synced = persisted<Record<string, { created?: boolean; sent?: boolean; events?: number }>>('veil.sync.v1', {});
let available: Promise<boolean> | null = null;

export function backendAvailable(): Promise<boolean> {
  if (isAndroid()) return Promise.resolve(false);
  return (available ??= fetch('/api/health')
    .then(async (r) => r.ok && typeof ((await r.json()) as { python?: unknown }).python === 'string')
    .catch(() => false));
}

async function post<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const mark = (id: string, patch: { created?: boolean; sent?: boolean; events?: number }) => synced.set((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
const syncable = (t: Ticket) => /^https?:\/\//i.test(t.pageUrl) && !isDemoUrl(t.pageUrl);

function describe(e: ServerEvent): string | null {
  const status = e.detail?.status;
  switch (e.type) {
    case 'removed':
      return `Veil's server checked: the picture is gone (${e.detail?.via === 'not-listed-on-page' ? 'no longer on the page' : status}).`;
    case 'present':
      return `Veil's server checked: still up (${status}).`;
    case 'unknown':
      return `Veil's server checked: could not tell (the site answered ${status ?? 'nothing'}).`;
    case 'overdue':
      return '48 hours have passed since this was sent with no removal. Time to follow up.';
    default:
      return null; // created, sent, reply: already in the local history
  }
}

/** Push new tickets and "sent" facts, then pull the server's timeline into each ticket. */
export async function syncTickets(): Promise<void> {
  if (!(await backendAvailable())) return;
  const state = synced.get();
  const list = tickets.get().filter(syncable);
  for (const t of list) {
    if (!state[t.id]?.created) {
      const ok = await post('/api/tickets', {
        id: t.id,
        pageUrl: t.pageUrl,
        imageUrl: t.imageUrl,
        site: t.site,
        law: t.law,
        matchKind: t.match.kind,
        matchScore: t.match.score !== null ? Math.max(0, Math.min(1, t.match.score)) : null,
        createdAt: t.createdAt,
      });
      if (ok) mark(t.id, { created: true });
      else continue;
    }
    if (t.sentAt && !synced.get()[t.id]?.sent) {
      const to = t.destinations.map((d) => d.email).filter((e): e is string => Boolean(e)).slice(0, 20);
      // The server only accepts a "sent" fact with recipients; form-only reports are tracked by re-checks.
      if (to.length && (await post(`/api/tickets/${t.id}/sent`, { via: t.sentVia ?? 'manual', to, at: t.sentAt }))) mark(t.id, { sent: true });
    }
  }
  const ids = list.filter((t) => synced.get()[t.id]?.created).map((t) => t.id);
  if (!ids.length) return;
  let server: ServerTicket[] = [];
  try {
    const r = await fetch(`/api/tickets?ids=${encodeURIComponent(ids.join(','))}`);
    if (!r.ok) return;
    server = (await r.json()) as ServerTicket[];
  } catch {
    return;
  }
  for (const s of server) apply(s);
}

function apply(s: ServerTicket) {
  const t = tickets.get().find((x) => x.id === s.id);
  if (!t) return;
  const seen = synced.get()[s.id]?.events ?? 0;
  for (const e of s.events.slice(seen)) {
    const text = describe(e);
    const at = Date.parse(e.at) || Date.now();
    if (e.type === 'removed' && t.status !== 'removed') updateTicket(s.id, { status: 'removed', removedAt: at, lastCheckedAt: at, lastCheck: 'Gone' }, text ?? undefined);
    else if (text) updateTicket(s.id, e.type === 'present' || e.type === 'unknown' ? { lastCheckedAt: at, lastCheck: e.type === 'present' ? `Still up (${e.detail?.status})` : 'Could not tell' } : {}, text);
  }
  mark(s.id, { events: s.events.length });
}

/** Ask the server to look right now. Returns false when the backend is not there, so the caller can fall back. */
export async function serverRecheck(t: Ticket): Promise<boolean> {
  if (!syncable(t) || !(await backendAvailable())) return false;
  await syncTickets();
  if (!synced.get()[t.id]?.created) return false;
  const s = await post<ServerTicket>(`/api/tickets/${t.id}/recheck`);
  if (!s) return false;
  apply(s);
  return true;
}
