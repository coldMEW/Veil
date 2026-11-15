import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { inspectVideoContainer } from '../src/lib/videoFacts.js';

export const MAX_EVIDENCE_BYTES = 500 * 1024 * 1024;

export class EvidenceStoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'EvidenceStoreError';
    this.status = status;
  }
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(sorted(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isValidCaseId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(value);
}

function safeOriginalName(value) {
  const name = basename(String(value || 'original-video')).replace(/[^a-zA-Z0-9._() -]/g, '_').slice(0, 180);
  return name || 'original-video';
}

function storageExtension(originalName, facts) {
  const extension = extname(originalName).toLowerCase();
  if (extension === '.mp4' || extension === '.mov') return extension;
  return facts.majorBrand === 'qt' || facts.compatibleBrands?.includes('qt') ? '.mov' : '.mp4';
}

function clientHashState(clientHash, serverHash) {
  if (!clientHash) return { supplied: false, matchesServer: null, value: null };
  if (!/^[a-f0-9]{64}$/i.test(clientHash)) return { supplied: true, matchesServer: false, value: clientHash };
  return { supplied: true, matchesServer: clientHash.toLowerCase() === serverHash, value: clientHash.toLowerCase() };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function selectedNumbers(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const selected = {};
  for (const field of fields) {
    const number = finiteNumber(value[field]);
    if (number !== null) selected[field] = number;
  }
  return Object.keys(selected).length ? selected : null;
}

function analysisSignalCount(value) {
  const declared = finiteNumber(value?.signalCount);
  if (declared !== null) return Math.max(0, Math.min(40, Math.trunc(declared)));
  return Array.isArray(value?.signals) ? Math.min(40, value.signals.length) : 0;
}

function compactEvidence(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.startsWith('data:') ? '[data URI omitted]' : value.slice(0, 500);
  if (depth >= 3 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return value.slice(0, 40).map((entry) => compactEvidence(entry, depth + 1));

  const compacted = {};
  for (const [key, entry] of Object.entries(value).slice(0, 30)) {
    if (!/^[a-zA-Z0-9_]+$/.test(key) || /thumbnail|image|bitmap|pixel|datauri/i.test(key)) continue;
    compacted[key] = compactEvidence(entry, depth + 1);
  }
  return compacted;
}

function publicReceipt(envelope) {
  return envelope;
}

function sanitizeObservation(value) {
  if (!value || typeof value !== 'object') throw new EvidenceStoreError('Each observation must be an object.');
  const id = typeof value.id === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value.id) ? value.id : randomUUID();
  const categories = new Set(['visual', 'audio', 'provenance', 'custody', 'context']);
  const category = categories.has(value.category) ? value.category : 'context';
  const time = Number(value.time);
  const text = typeof value.text === 'string' ? value.text.trim().slice(0, 500) : '';
  if (!Number.isFinite(time) || time < 0) throw new EvidenceStoreError('Observation timestamp must be a non-negative number.');
  if (!text) throw new EvidenceStoreError('Observation text is required.');
  return {
    id,
    time: Number(time.toFixed(3)),
    category,
    text,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt.slice(0, 64) : new Date().toISOString(),
  };
}

function sanitizeAnalysis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EvidenceStoreError('Analysis record must be an object.');
  const text = (input, limit = 1_000) => (typeof input === 'string' ? input.slice(0, limit) : null);
  const sourceSha256 = typeof value.sourceSha256 === 'string' ? value.sourceSha256.toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new EvidenceStoreError('Analysis must identify the sealed source video with a SHA-256 hash.');
  const signals = Array.isArray(value.signals)
    ? value.signals.slice(0, 40).map((entry, index) => {
        const timeStart = nonNegativeNumber(entry?.timeStart);
        const requestedTimeEnd = nonNegativeNumber(entry?.timeEnd);
        return {
          id: text(entry?.id, 128) || `signal-${index + 1}`,
          check: text(entry?.check, 100) || 'unknown',
          title: text(entry?.title, 240) || 'Untitled review signal',
          observation: text(entry?.observation, 1_200) || 'No observation recorded.',
          timeStart,
          timeEnd: timeStart !== null && (requestedTimeEnd === null || requestedTimeEnd < timeStart) ? timeStart : requestedTimeEnd,
          evidence: compactEvidence(entry?.evidence) ?? {},
          method: text(entry?.method, 500),
          assumptions: Array.isArray(entry?.assumptions) ? entry.assumptions.filter((item) => typeof item === 'string').slice(0, 10).map((item) => item.slice(0, 500)) : [],
          limitations: Array.isArray(entry?.limitations) ? entry.limitations.filter((item) => typeof item === 'string').slice(0, 10).map((item) => item.slice(0, 500)) : [],
        };
      })
    : [];
  return {
    sourceSha256,
    engine: value.engine && typeof value.engine === 'object' ? { id: text(value.engine.id, 160), version: text(value.engine.version, 80), mode: text(value.engine.mode, 500) } : null,
    status: text(value.status, 50) || 'unknown',
    inspectedAt: text(value.inspectedAt, 64),
    sampledFrames: nonNegativeNumber(value.sampledFrames),
    frameIntervalEstimate: nonNegativeNumber(value.frameIntervalEstimate),
    temporal:
      value.temporal && typeof value.temporal === 'object'
        ? {
            metrics: selectedNumbers(value.temporal.metrics, ['sampledFrames', 'transitionCount', 'sceneThreshold', 'localThreshold', 'luminanceThreshold', 'medianTransitionDifference']),
            signalCount: analysisSignalCount(value.temporal),
          }
        : null,
    face:
      value.face && typeof value.face === 'object'
        ? {
            status: text(value.face.status, 50),
            reason: text(value.face.reason, 1_000),
            metrics: selectedNumbers(value.face.metrics, ['sampledFrames', 'framesWithFaces']),
            signalCount: analysisSignalCount(value.face),
          }
        : null,
    audio:
      value.audio && typeof value.audio === 'object'
        ? {
            status: text(value.audio.status, 50),
            reason: text(value.audio.reason, 1_000),
            metrics: selectedNumbers(value.audio.metrics, ['sampleRate', 'channels', 'duration', 'windows', 'transitionThresholdDb']),
            signalCount: analysisSignalCount(value.audio),
          }
        : null,
    unavailableChecks: Array.isArray(value.unavailableChecks)
      ? value.unavailableChecks
          .slice(0, 20)
          .filter((check) => check && typeof check === 'object')
          .map((check) => ({ id: text(check.id, 100) || 'unspecified', reason: text(check.reason, 1_000) || 'No reason recorded.' }))
      : [],
    signals,
    limitations: Array.isArray(value.limitations) ? value.limitations.filter((item) => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 500)) : [],
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(path, contents, mode) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode });
  await rename(temporary, path);
}

/**
 * Local evidence vault for the prototype. It signs receipts with a locally held
 * Ed25519 key, so it is tamper-evident on this machine but not an independent
 * third-party timestamp or production immutable-storage service.
 */
export class EvidenceStore {
  constructor(root) {
    this.root = resolve(root);
    this.casesRoot = join(this.root, 'cases');
    this.keysRoot = join(this.root, 'keys');
    this.privateKeyPath = join(this.keysRoot, 'receipt-private.pem');
    this.publicKeyPath = join(this.keysRoot, 'receipt-public.pem');
    this.privateKey = null;
    this.publicKey = null;
    this.publicKeyFingerprint = null;
    this.caseLocks = new Map();
  }

  async initialise() {
    if (this.privateKey) return;
    await mkdir(this.casesRoot, { recursive: true });
    await mkdir(this.keysRoot, { recursive: true });
    if (!(await exists(this.privateKeyPath)) || !(await exists(this.publicKeyPath))) {
      const pair = generateKeyPairSync('ed25519');
      await writeFile(this.privateKeyPath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
      await writeFile(this.publicKeyPath, pair.publicKey.export({ format: 'pem', type: 'spki' }), { mode: 0o644 });
    }
    const [privatePem, publicPem] = await Promise.all([readFile(this.privateKeyPath), readFile(this.publicKeyPath)]);
    this.privateKey = createPrivateKey(privatePem);
    this.publicKey = createPublicKey(publicPem);
    this.publicKeyFingerprint = sha256(publicPem);
  }

  casePath(caseId) {
    if (!isValidCaseId(caseId)) throw new EvidenceStoreError('Case ID is invalid.', 400);
    return join(this.casesRoot, caseId);
  }

  async withCaseLock(caseId, operation) {
    const previous = this.caseLocks.get(caseId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolveLock) => {
      release = resolveLock;
    });
    this.caseLocks.set(caseId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.caseLocks.get(caseId) === current) this.caseLocks.delete(caseId);
    }
  }

  async signPayload(payload) {
    await this.initialise();
    const signature = sign(null, Buffer.from(canonicalJson(payload)), this.privateKey).toString('base64url');
    return {
      payload,
      signature: {
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: this.publicKeyFingerprint,
        value: signature,
      },
    };
  }

  async verifyEnvelope(envelope) {
    await this.initialise();
    if (!envelope?.payload || !envelope?.signature?.value) return false;
    return verify(null, Buffer.from(canonicalJson(envelope.payload)), this.publicKey, Buffer.from(envelope.signature.value, 'base64url'));
  }

  async sealOriginal({ caseId, originalName, declaredMimeType, clientSha256, bytes }) {
    await this.initialise();
    if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes)) throw new EvidenceStoreError('Original video bytes are required.');
    if (bytes.byteLength === 0) throw new EvidenceStoreError('The video file is empty.');
    if (bytes.byteLength > MAX_EVIDENCE_BYTES) throw new EvidenceStoreError(`The local evidence vault accepts files up to ${MAX_EVIDENCE_BYTES} bytes.`, 413);

    const originalFileName = safeOriginalName(originalName);
    const typedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const facts = inspectVideoContainer(typedBytes);
    if (!facts.supported) throw new EvidenceStoreError(facts.reason);
    const target = this.casePath(caseId);
    if (await exists(target)) throw new EvidenceStoreError('A case with this ID already exists. Original evidence is write-once.', 409);
    await mkdir(target, { recursive: false });

    const serverSha256 = sha256(typedBytes);
    const storedFileName = `original${storageExtension(originalFileName, facts)}`;
    await writeFile(join(target, storedFileName), typedBytes, { flag: 'wx', mode: 0o400 });

    const receivedAt = new Date().toISOString();
    const clientHash = clientHashState(clientSha256, serverSha256);
    const payload = {
      schema: 'veil-local-evidence-receipt/v0.2',
      case: {
        id: caseId,
        receivedAt,
        storage: 'local managed evidence vault',
        custodyScope: 'Locally signed receipt. This is tamper-evident on the current machine, not an independent timestamp authority or cloud WORM archive.',
      },
      originalAsset: {
        originalFileName,
        storedFileName,
        declaredMimeType: declaredMimeType || null,
        byteLength: typedBytes.byteLength,
        serverSha256,
        clientSha256: clientHash,
        inspection: facts,
      },
      custodyEvents: [
        {
          sequence: 1,
          at: receivedAt,
          type: 'original_received',
          actor: 'veil-local-evidence-vault',
          detail: 'Original bytes were stored once and hashed by the local evidence vault.',
        },
        {
          sequence: 2,
          at: receivedAt,
          type: 'container_inspected',
          actor: 'veil-local-evidence-vault',
          detail: `Read ${facts.container ?? 'unknown container'} with ${facts.trackCount} track${facts.trackCount === 1 ? '' : 's'}.`,
        },
      ],
      observations: [],
      analysisRuns: [],
      limitations: [
        'A hash identifies exact bytes, not the person who recorded the video or the truth of what it depicts.',
        'This prototype detects a C2PA container marker but does not validate a manifest signature, signer trust, or timestamp trust.',
        'Original evidence is stored locally; production use requires independently controlled retention, access, and timestamp services.',
      ],
      software: { product: 'Veil Evidence Passport', version: '0.2.0', mode: 'local evidence vault' },
    };
    const envelope = await this.signPayload(payload);
    await writeAtomic(join(target, 'receipt.json'), `${JSON.stringify(envelope, null, 2)}\n`, 0o600);
    return publicReceipt(envelope);
  }

  async getCase(caseId) {
    const receiptPath = join(this.casePath(caseId), 'receipt.json');
    if (!(await exists(receiptPath))) throw new EvidenceStoreError('Evidence case not found.', 404);
    return JSON.parse(await readFile(receiptPath, 'utf8'));
  }

  async appendObservations(caseId, observations) {
    if (!Array.isArray(observations) || observations.length > 500) throw new EvidenceStoreError('Provide up to 500 observations.');
    return this.withCaseLock(caseId, async () => {
      const current = await this.getCase(caseId);
      if (!(await this.verifyEnvelope(current))) throw new EvidenceStoreError('The existing receipt signature cannot be verified.', 409);
      const accepted = observations.map(sanitizeObservation);
      const knownIds = new Set(current.payload.observations.map((observation) => observation.id));
      const additions = accepted.filter((observation) => !knownIds.has(observation.id));
      if (!additions.length) return current;

      const savedAt = new Date().toISOString();
      const payload = {
        ...current.payload,
        observations: [...current.payload.observations, ...additions],
        custodyEvents: [
          ...current.payload.custodyEvents,
          {
            sequence: current.payload.custodyEvents.length + 1,
            at: savedAt,
            type: 'review_observations_saved',
            actor: 'veil-local-evidence-vault',
            detail: `Recorded ${additions.length} timestamped reviewer observation${additions.length === 1 ? '' : 's'}.`,
          },
        ],
      };
      const envelope = await this.signPayload(payload);
      await writeAtomic(join(this.casePath(caseId), 'receipt.json'), `${JSON.stringify(envelope, null, 2)}\n`, 0o600);
      return publicReceipt(envelope);
    });
  }

  async appendAnalysis(caseId, analysis) {
    return this.withCaseLock(caseId, async () => {
      const current = await this.getCase(caseId);
      if (!(await this.verifyEnvelope(current))) throw new EvidenceStoreError('The existing receipt signature cannot be verified.', 409);
      const sanitized = sanitizeAnalysis(analysis);
      if (sanitized.sourceSha256 !== current.payload.originalAsset?.serverSha256) {
        throw new EvidenceStoreError('Analysis hash does not match the original sealed video.', 409);
      }

      const analysisFingerprint = sha256(canonicalJson(sanitized));
      if ((current.payload.analysisRuns ?? []).some((run) => run.analysisFingerprintSha256 === analysisFingerprint)) return current;

      const savedAt = new Date().toISOString();
      const run = {
        id: randomUUID(),
        savedAt,
        analysisFingerprintSha256: analysisFingerprint,
        analysis: sanitized,
      };
      const payload = {
        ...current.payload,
        analysisRuns: [...(current.payload.analysisRuns ?? []), run],
        custodyEvents: [
          ...current.payload.custodyEvents,
          {
            sequence: current.payload.custodyEvents.length + 1,
            at: savedAt,
            type: 'automated_analysis_saved',
            actor: 'veil-local-evidence-vault',
            detail: `Saved ${sanitized.signals.length} automated review signal${sanitized.signals.length === 1 ? '' : 's'} from ${sanitized.engine?.id ?? 'an unspecified analysis engine'}.`,
          },
        ],
      };
      const envelope = await this.signPayload(payload);
      await writeAtomic(join(this.casePath(caseId), 'receipt.json'), `${JSON.stringify(envelope, null, 2)}\n`, 0o600);
      return publicReceipt(envelope);
    });
  }

  async verification(caseId) {
    const envelope = await this.getCase(caseId);
    return {
      valid: await this.verifyEnvelope(envelope),
      caseId,
      publicKeyFingerprintSha256: this.publicKeyFingerprint,
      algorithm: envelope.signature?.algorithm ?? null,
    };
  }

  async publicKeyInfo() {
    await this.initialise();
    return {
      algorithm: 'Ed25519',
      fingerprintSha256: this.publicKeyFingerprint,
      pem: await readFile(this.publicKeyPath, 'utf8'),
      scope: 'Local prototype key; not a public certificate authority or independent timestamp service.',
    };
  }
}
