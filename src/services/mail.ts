import { persisted } from './store';

/*
 * Sending from the person's own Gmail. The token comes from Google's OAuth popup (implicit flow, no client
 * secret in the app) and stays in this tab's memory only; it expires after about an hour and is asked for again.
 * Mail logic (MIME, send, replies, classification) lives in server/mail/gmail.ts, which is browser-safe.
 */

export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
const SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

let token: { value: string; expires: number } | null = null;
export const mailAccount = persisted<{ email: string | null }>('veil.mail.account.v1', { email: null });

export function hasToken(): boolean {
  return Boolean(token && token.expires > Date.now() + 30_000);
}

/** Opens Google's sign-in popup and resolves with an access token. */
export function connectGmail(): Promise<string> {
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error('Gmail sign-in is not set up in this build (no Google client ID).'));
  if (hasToken()) return Promise.resolve(token!.value);
  const state = crypto.randomUUID();
  const redirect = new URL('oauth.html', window.location.href).href;
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'token', scope: SCOPES, state, include_granted_scopes: 'true', prompt: 'select_account' }).toString();
  const popup = window.open(url, 'veil-google', 'width=480,height=640');
  if (!popup) return Promise.reject(new Error('The sign-in window was blocked. Allow pop-ups for Veil and try again.'));
  return new Promise((resolve, reject) => {
    const done = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'veil-oauth') return;
      window.removeEventListener('message', done);
      window.clearInterval(watch);
      const p = new URLSearchParams(String(e.data.hash ?? '').replace(/^#/, ''));
      if (p.get('state') !== state) return reject(new Error('Sign-in did not match this request.'));
      const access = p.get('access_token');
      if (!access) return reject(new Error(p.get('error') ?? 'Sign-in was cancelled.'));
      token = { value: access, expires: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000 };
      void fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${access}` } })
        .then((r) => r.json())
        .then((j: { emailAddress?: string }) => mailAccount.set({ email: j.emailAddress ?? null }))
        .catch(() => undefined);
      resolve(access);
    };
    window.addEventListener('message', done);
    const watch = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(watch);
        window.removeEventListener('message', done);
        if (!hasToken()) reject(new Error('Sign-in was closed.'));
      }
    }, 500);
  });
}

export function disconnectGmail() {
  token = null;
  mailAccount.set({ email: null });
}

export interface GmailModule {
  buildMime(m: { from: string; to: string[]; replyTo?: string; subject: string; text: string; attachment?: { name: string; type: string; bytes: Uint8Array } }): string;
  sendGmail(token: string, mime: string): Promise<{ id: string; threadId: string }>;
  fetchReplies(token: string, ticketIds: string[]): Promise<Array<{ ticketId: string; messageId: string; threadId: string; from: string; date: string; subject: string; snippet: string }>>;
  classifyReply(subject: string, text: string): 'acknowledged' | 'removed' | 'rejected' | 'needs_info' | 'unknown';
  tagSubject(ticketId: string, subject: string): string;
}

const mod = import.meta.glob('../../server/mail/gmail.ts');
export async function gmail(): Promise<GmailModule> {
  const load = mod['../../server/mail/gmail.ts'];
  if (!load) throw new Error('Gmail sending is not in this build yet.');
  return (await load()) as GmailModule;
}
