// The evidence record for one video, and the maths that makes it tamper-evident.
//
// Three things protect a record:
//   1. the SHA-256 of the exact file, computed on this device (the video itself is never sent anywhere);
//   2. a custody log where every entry carries the hash of the entry before it, so none can be
//      removed, reordered or reworded without breaking the chain;
//   3. two signatures over the whole record: one from a key that never leaves this device, and one
//      from Veil's server, which sees only a hash and adds the time it saw it.
// Anyone can re-check all three later from the exported file alone (see verifySealed).

export const SCHEMA = 'veil-video-passport/v1';
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface CustodyEvent {
  seq: number;
  at: string;
  type: string;
  detail: string;
  /** Hash of the previous entry; the first entry points at the file's own SHA-256. */
  prev: string;
  hash: string;
}

export interface Witness {
  /** SHA-256 of the canonical record that was shown to the server. */
  digest: string;
  at: string;
  keyId: string;
  publicKey: JsonWebKey;
  signature: string;
}

export interface Sealed<T> {
  record: T;
  device: { algorithm: 'ECDSA P-256, SHA-256'; keyId: string; publicKey: JsonWebKey };
  signature: string;
  witness: Witness | null;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => [k, sorted(o[k])]));
}

/** JSON with keys in a fixed order, so the same record always gives the same bytes. */
export function canonical(value: unknown): string {
  return JSON.stringify(sorted(value));
}

const hexOf = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
const utf8 = (s: string) => new TextEncoder().encode(s);

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  return hexOf(await crypto.subtle.digest('SHA-256', (typeof data === 'string' ? utf8(data) : data) as BufferSource));
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** A short, stable name for a public key: the first 16 hex digits of the hash of its coordinates. */
export async function keyId(jwk: JsonWebKey): Promise<string> {
  return (await sha256Hex(canonical({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))).slice(0, 16);
}

export async function appendEvent(log: CustodyEvent[], fileSha256: string, type: string, detail: string, at = new Date().toISOString()): Promise<CustodyEvent[]> {
  const body = { seq: log.length + 1, at, type, detail, prev: log.at(-1)?.hash ?? fileSha256 };
  return [...log, { ...body, hash: await sha256Hex(canonical(body)) }];
}

/** Index of the first broken entry, or -1 when the whole chain holds. */
export async function brokenAt(log: CustodyEvent[], fileSha256: string): Promise<number> {
  let prev = fileSha256;
  for (let i = 0; i < log.length; i++) {
    const e = log[i]!;
    const { hash, ...body } = e;
    if (e.seq !== i + 1 || e.prev !== prev || hash !== (await sha256Hex(canonical(body)))) return i;
    prev = hash;
  }
  return -1;
}

export async function signRecord<T>(record: T, keys: CryptoKeyPair): Promise<Sealed<T>> {
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const signature = await crypto.subtle.sign(SIGN, keys.privateKey, utf8(canonical(record)) as BufferSource);
  return {
    record,
    device: { algorithm: 'ECDSA P-256, SHA-256', keyId: await keyId(publicKey), publicKey: { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y } },
    signature: toBase64Url(new Uint8Array(signature)),
    witness: null,
  };
}

async function verifyWith(jwk: JsonWebKey, signature: string, message: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, ALG, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, fromBase64Url(signature) as BufferSource, utf8(message) as BufferSource);
  } catch {
    return false;
  }
}

/** What the server signs: the record's hash and the time, nothing else. */
export const witnessMessage = (digest: string, at: string) => canonical({ at, digest, purpose: 'veil-witness/v1' });

export interface VerifyLine {
  id: 'file' | 'chain' | 'device' | 'witness';
  /** true = holds, false = broken, null = could not be checked. */
  ok: boolean | null;
  title: string;
  says: string;
}

interface RecordShape {
  schema?: string;
  asset?: { sha256?: string; name?: string };
  events?: CustodyEvent[];
}

/**
 * Re-checks an exported record from scratch. `file` is optional: without it the record can still be
 * shown to be unaltered, but not that it describes a particular video.
 */
export async function verifySealed(sealed: Sealed<RecordShape>, file?: Uint8Array | null, trustedWitnessKeyId?: string | null): Promise<VerifyLine[]> {
  const lines: VerifyLine[] = [];
  const record = sealed?.record;
  const sha = record?.asset?.sha256 ?? '';
  if (!record || record.schema !== SCHEMA || !/^[a-f0-9]{64}$/.test(sha)) {
    return [{ id: 'device', ok: false, title: 'Not a Veil video record', says: 'This file is not a record exported by Veil, or it is damaged.' }];
  }

  if (file) {
    const actual = await sha256Hex(file);
    lines.push(
      actual === sha
        ? { id: 'file', ok: true, title: 'Same video', says: 'The video you added is byte for byte the one this record was made for.' }
        : { id: 'file', ok: false, title: 'Different video', says: 'The video you added is not the one this record describes. Even one changed byte gives a different fingerprint.' },
    );
  } else {
    lines.push({ id: 'file', ok: null, title: 'Video not added', says: 'Add the video too and Veil will confirm it is the exact file this record was made for.' });
  }

  const events = Array.isArray(record.events) ? record.events : [];
  const broken = await brokenAt(events, sha);
  lines.push(
    broken === -1
      ? { id: 'chain', ok: true, title: 'History complete', says: `All ${events.length} entries of the handling log are present and in order.` }
      : { id: 'chain', ok: false, title: 'History altered', says: `Entry ${broken + 1} of the handling log was changed, removed or reordered after it was written.` },
  );

  const message = canonical(record);
  const deviceOk = Boolean(sealed.device?.publicKey && sealed.signature) && (await verifyWith(sealed.device.publicKey, sealed.signature, message));
  lines.push(
    deviceOk
      ? { id: 'device', ok: true, title: 'Record unchanged', says: `Signed on the reviewer's device (key ${sealed.device.keyId}) and not altered since.` }
      : { id: 'device', ok: false, title: 'Record altered', says: 'The record does not match its signature: something in it was changed after it was sealed.' },
  );

  const w = sealed.witness;
  if (!w) {
    lines.push({ id: 'witness', ok: null, title: 'No independent time', says: 'This record was sealed offline, so its times come from the reviewer\'s own device.' });
  } else {
    const digestOk = w.digest === (await sha256Hex(message));
    const signatureOk = await verifyWith(w.publicKey, w.signature, witnessMessage(w.digest, w.at));
    const known = trustedWitnessKeyId ? (await keyId(w.publicKey)) === trustedWitnessKeyId : null;
    if (!digestOk || !signatureOk || known === false) {
      lines.push({ id: 'witness', ok: false, title: 'Witness stamp invalid', says: known === false ? 'The time stamp was not made with this Veil server\'s key.' : 'The server time stamp does not belong to this record.' });
    } else {
      lines.push({
        id: 'witness',
        ok: known === null ? null : true,
        title: known === null ? 'Witness stamp present' : 'Existed at this time',
        says: `${known === null ? 'A server stamp matches this record; Veil could not reach the server to confirm its key.' : 'Veil\'s server saw this exact record'} on ${new Date(w.at).toLocaleString()}. The server saw only a fingerprint, never the video.`,
      });
    }
  }
  return lines;
}

/* ---------------- Browser only: the device key and the server stamp ---------------- */

const DB = 'veil-evidence';
const STORE = 'keys';

function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

let deviceKeys: Promise<CryptoKeyPair> | null = null;
/**
 * This device's signing key. The private half is created as non-extractable and kept in IndexedDB,
 * so no script (ours included) can read or copy it. If storage is blocked the key lasts for this visit.
 */
export function deviceKey(): Promise<CryptoKeyPair> {
  return (deviceKeys ??= (async () => {
    try {
      const stored = await idb<CryptoKeyPair | undefined>('readonly', (s) => s.get('device-signing-v1'));
      if (stored?.privateKey && stored.publicKey) return stored;
    } catch {
      /* storage unavailable: fall through to a key for this visit */
    }
    const pair = (await crypto.subtle.generateKey(ALG, false, ['sign', 'verify'])) as CryptoKeyPair;
    try {
      await idb('readwrite', (s) => s.put(pair, 'device-signing-v1'));
    } catch {
      /* kept in memory only */
    }
    return pair;
  })());
}

/** Asks Veil's server to stamp a hash with its time. Returns null when there is no server (offline, Android). */
export async function requestWitness(digest: string): Promise<Witness | null> {
  try {
    const res = await fetch('/api/witness', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digest }), signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const w = (await res.json()) as Witness;
    if (w.digest !== digest || !w.signature || !w.publicKey) return null;
    return (await verifyWith(w.publicKey, w.signature, witnessMessage(w.digest, w.at))) ? w : null;
  } catch {
    return null;
  }
}

export async function witnessKeyId(): Promise<string | null> {
  try {
    const res = await fetch('/api/witness', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return ((await res.json()) as { keyId?: string }).keyId ?? null;
  } catch {
    return null;
  }
}

export async function seal<T>(record: T): Promise<Sealed<T>> {
  const sealed = await signRecord(record, await deviceKey());
  sealed.witness = await requestWitness(await sha256Hex(canonical(record)));
  return sealed;
}
