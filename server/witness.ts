// Veil's witness: it signs a hash together with the time it saw it. It never receives a video, a
// frame, a file name or anything about the person; only 64 hex characters. That gives an evidence
// record a time that does not come from the reviewer's own device.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let cached: { privateKey: KeyObject; jwk: { kty: string; crv: string; x: string; y: string }; keyId: string } | null = null;

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sorted(o[k])]));
}
const canonical = (value: unknown) => JSON.stringify(sorted(value));

function loadKey() {
  if (cached) return cached;
  let pem = process.env.VEIL_WITNESS_KEY?.replace(/\\n/g, '\n') ?? null;
  if (!pem) {
    // Local development: one key per checkout, kept in the git-ignored local-private folder.
    const file = resolve(process.cwd(), 'local-private', 'witness-key.pem');
    try {
      if (existsSync(file)) pem = readFileSync(file, 'utf8');
      else {
        pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, pem, { mode: 0o600 });
      }
    } catch {
      // Read-only file system: a key for this process only. Stamps stay checkable from the exported public key.
      pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    }
  }
  const privateKey = createPrivateKey(pem);
  const full = createPublicKey(privateKey).export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };
  const jwk = { kty: full.kty, crv: full.crv, x: full.x, y: full.y };
  const keyId = createHash('sha256').update(canonical(jwk)).digest('hex').slice(0, 16);
  cached = { privateKey, jwk, keyId };
  return cached;
}

export function witnessInfo() {
  const { jwk, keyId } = loadKey();
  return { keyId, algorithm: 'ECDSA P-256, SHA-256', publicKey: jwk, sees: 'A SHA-256 hash only. Never a video, frame or file name.' };
}

export function witness(digest: unknown, now = new Date()) {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) return null;
  const { privateKey, jwk, keyId } = loadKey();
  const at = now.toISOString();
  const message = canonical({ at, digest, purpose: 'veil-witness/v1' });
  // IEEE P1363 (r || s) is the signature format browsers verify with WebCrypto.
  const signature = sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { digest, at, keyId, publicKey: jwk, signature };
}
