import { fromBase64, persisted, toBase64, uid } from './store';

/** Your face, as numbers. The photo it came from is never stored. */
export interface VaultFace {
  id: string;
  label: string;
  addedAt: number;
  embedding: string; // base64 Float32Array (128-d, unit length)
  thumb: string; // tiny face crop data URL, so you can recognise the entry
}

/** A photo you shielded before posting: its fingerprint and Veil mark id, not the photo. */
export interface VaultPhoto {
  id: string;
  name: string;
  addedAt: number;
  pdq: string | null;
  mark: string | null; // payload as hex
  sha256: string;
  thumb: string;
}

export const vaultFaces = persisted<VaultFace[]>('veil.vault.faces.v1', []);
export const vaultPhotos = persisted<VaultPhoto[]>('veil.vault.photos.v1', []);

export function encodeEmbedding(e: Float32Array): string {
  return toBase64(new Uint8Array(e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength)));
}
export function decodeEmbedding(s: string): Float32Array {
  const bytes = fromBase64(s);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function addFace(label: string, embedding: Float32Array, thumb: string) {
  vaultFaces.set((list) => [...list, { id: uid('F'), label, addedAt: Date.now(), embedding: encodeEmbedding(embedding), thumb }]);
}
export function removeFace(id: string) {
  vaultFaces.set((list) => list.filter((f) => f.id !== id));
}

/** The secret behind your Veil mark. Generated once on this device; only you can detect your mark. */
export function markKey(): Uint8Array {
  const KEY = 'veil.mark.key.v1';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return fromBase64(existing);
    const key = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(KEY, toBase64(key));
    return key;
  } catch {
    // Without storage the key cannot persist; a session key still lets this visit work.
    return (sessionKey ??= crypto.getRandomValues(new Uint8Array(32)));
  }
}
let sessionKey: Uint8Array | undefined;

export function newMarkPayload(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
}

export function payloadHex(p: bigint | string | undefined): string | null {
  if (p === undefined) return null;
  return typeof p === 'bigint' ? p.toString(16).padStart(16, '0') : p;
}
