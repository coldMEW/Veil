// Content Credentials (C2PA) and AI-tool metadata, read from the ORIGINAL file bytes.
// Uses the official contentauth SDK (@contentauth/c2pa-web 0.15.5, MIT) so signatures are
// verified by the reference implementation, not hand-parsed. The Wasm is served from this origin.
// Nothing is uploaded; the SDK runs in its own worker.

import { createC2pa, Context, Reader, type C2pa } from '@contentauth/c2pa-web';
import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url';
import type { CheckResult } from '../../../contracts';
import { readCameraHints, type CameraHints } from './cameraHints';

export const AI_SOURCE_TYPES: Record<string, string> = {
  trainedAlgorithmicMedia: 'Created by a generative AI model',
  compositeWithTrainedAlgorithmicMedia: 'Edited or combined with generative AI',
  algorithmicMedia: 'Created by an algorithm (not a camera)',
  compositeSynthetic: 'Composite including synthetic elements',
  digitalCapture: 'Captured by a digital camera',
};

/** Tool names that, when present in readable metadata, are reported verbatim as a hint. */
const AI_TOOL_PATTERN =
  /ChatGPT|OpenAI|DALL[·.\-\s]?E|gpt-image|Midjourney|Firefly|Generative Fill|Gemini|Imagen|Nano Banana|Copilot Designer|Bing Image Creator|Stable Diffusion|SDXL|Flux|Ideogram|Leonardo|Runway|Higgsfield|Made with Google AI/gi;

export interface CredentialSummary {
  present: boolean;
  /** e.g. "ChatGPT gpt-image" from claim_generator_info, or the claim generator string. */
  generator: string | null;
  signer: string | null;
  signedAt: string | null;
  actions: string[];
  /** Short IPTC digital source type codes found (e.g. trainedAlgorithmicMedia). */
  sourceTypes: string[];
  validationState: string | null;
  /** Validation status codes, e.g. signingCredential.untrusted. */
  statusCodes: string[];
  /** Failure codes with the SDK's explanation, for the evidence record. */
  failures: Array<{ code: string; explanation: string }>;
  /** True only when the SDK reports the image or claim no longer matches what was signed. */
  contentChanged: boolean;
  /** True when the signer certificate could not be validated or trusted (a trust question, not tampering). */
  credentialProblem: boolean;
  manifestCount: number;
}

export interface MetadataHints {
  /** AI tool names found in readable metadata text (XMP, EXIF, PNG text). */
  toolNames: string[];
  /** IPTC digital source types declared in XMP outside C2PA. */
  sourceTypes: string[];
  /** EXIF/XMP software or creator tool strings, verbatim. */
  software: string[];
}

export interface ProvenanceResult {
  credentials: CredentialSummary;
  hints: MetadataHints;
  /** Camera details from EXIF, if any. Information only: anyone can edit them. */
  camera?: CameraHints | null;
  error: string | null;
  ms: number;
}

let c2paPromise: Promise<C2pa> | null = null;

/**
 * Keep credential inspection local: do not fetch remote manifests, revocation
 * data, or trust lists. The result records that signer trust is unknown.
 */
export const OFFLINE_SETTINGS = {
  verify: {
    verifyAfterReading: true,
    verifyTrust: false,
    verifyTimestampTrust: false,
    remoteManifestFetch: false,
    ocspFetch: false,
  },
  trust: { verifyTrustList: false },
  cawgTrust: { verifyTrustList: false },
} as const;

function getC2pa(): Promise<C2pa> {
  c2paPromise ??= createC2pa({ wasmSrc });
  return c2paPromise;
}

const shortType = (uri: string) => uri.split('/').pop() ?? uri;

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 12 || out.length > 4000) return;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
}

/** Pure: turn a manifest store (as returned by the SDK) into the facts the card shows. */
export function summarizeManifestStore(store: unknown): CredentialSummary {
  const s = (store ?? {}) as {
    active_manifest?: string | null;
    manifests?: Record<string, Record<string, unknown>>;
    validation_state?: string | null;
    validation_status?: Array<{ code?: string; explanation?: string | null }> | null;
    validation_results?: { activeManifest?: { failure?: Array<{ code?: string; explanation?: string | null }> } } | null;
  };
  const manifests = s.manifests ?? {};
  const active = (s.active_manifest && manifests[s.active_manifest]) || Object.values(manifests)[0];
  if (!active) {
    return { present: false, generator: null, signer: null, signedAt: null, actions: [], sourceTypes: [], validationState: null, statusCodes: [], failures: [], contentChanged: false, credentialProblem: false, manifestCount: 0 };
  }
  const info = (active.claim_generator_info as Array<{ name?: string; version?: string | null }> | undefined) ?? [];
  const generator =
    info.map((g) => [g.name, g.version].filter(Boolean).join(' ')).filter(Boolean).join(', ') ||
    (typeof active.claim_generator === 'string' ? active.claim_generator : null);
  const sig = (active.signature_info ?? {}) as { issuer?: string | null; common_name?: string | null; time?: string | null };
  const strings: string[] = [];
  collectStrings(active.assertions, strings);
  const actions = [...new Set(strings.filter((x) => /^c2pa\.[a-z_.]+$/.test(x) && !/^c2pa\.(hash|thumbnail|ingredient|signature|claim)/.test(x)))];
  const sourceTypes = [...new Set(strings.filter((x) => x.includes('digitalsourcetype/')).map(shortType))];
  const failure = s.validation_results?.activeManifest?.failure ?? [];
  const statusCodes = [
    ...new Set([...(s.validation_status ?? []), ...failure].map((v) => v.code).filter((c): c is string => !!c)),
  ];
  const failures = [...(s.validation_status ?? []), ...failure]
    .filter((v) => v.code)
    .map((v) => ({ code: v.code!, explanation: (v.explanation ?? '').slice(0, 200) }));
  // Tampering codes (C2PA spec 2.x): the hashed content or claim no longer matches the signature.
  const contentChanged = statusCodes.some((c) => /(dataHash|bmffHash|boxesHash|collectionHash|hashedURI)\.mismatch|claimSignature\.mismatch|assertion\.missing|claim\.missing/.test(c));
  const credentialProblem = statusCodes.some((c) => /^signingCredential\.|^timeStamp\./.test(c));
  return {
    present: true,
    failures,
    contentChanged,
    credentialProblem,
    generator: generator || null,
    signer: sig.common_name || sig.issuer || null,
    signedAt: sig.time ?? null,
    actions,
    sourceTypes,
    validationState: s.validation_state ?? null,
    statusCodes,
    manifestCount: Object.keys(manifests).length,
  };
}

/** Pure: scan readable metadata text for AI tool names, IPTC source types and software strings. */
export function scanMetadataHints(bytes: Uint8Array): MetadataHints {
  // Metadata lives in the first ~256 KiB of JPEG/PNG files; PNG text chunks can be later, so also scan the tail.
  const head = bytes.subarray(0, Math.min(bytes.length, 262144));
  const tail = bytes.length > 262144 ? bytes.subarray(Math.max(262144, bytes.length - 65536)) : new Uint8Array();
  const text = new TextDecoder('latin1').decode(head) + '\n' + new TextDecoder('latin1').decode(tail);
  const toolNames = [...new Set((text.match(AI_TOOL_PATTERN) ?? []).map((t) => t.trim()))];
  const sourceTypes = [...new Set([...text.matchAll(/digitalsourcetype\/([A-Za-z]+)/g)].map((m) => m[1]!))];
  const software = [
    ...new Set(
      [...text.matchAll(/(?:xmp:CreatorTool|CreatorTool|tiff:Software|photoshop:History)[=">\s]+([^"<\n\r]{2,80})/g)].map((m) => m[1]!.trim()),
    ),
  ];
  return { toolNames, sourceTypes, software };
}

/** Read C2PA from the original bytes. Never throws; failures are reported in `error`. */
export async function readProvenance(bytes: Uint8Array, mimeType: string): Promise<ProvenanceResult> {
  const t0 = performance.now();
  const hints = scanMetadataHints(bytes);
  let credentials = summarizeManifestStore(null);
  let error: string | null = null;
  try {
    const c2pa = await getC2pa();
    const reader = await Reader.fromBlob(
      c2pa,
      mimeType,
      new Blob([bytes as BlobPart], { type: mimeType }),
      new Context(OFFLINE_SETTINGS),
    );
    if (reader) {
      try {
        credentials = summarizeManifestStore(await reader.manifestStore());
      } finally {
        await reader.free();
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // "No manifest" is the normal case for most photos, not an error.
    if (!/no.?manifest|ManifestNotFound|JumbfNotFound|not found/i.test(msg)) error = msg;
  }
  return { credentials, hints, camera: readCameraHints(bytes), error, ms: performance.now() - t0 };
}

const AI_TYPES = new Set(['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia', 'algorithmicMedia', 'compositeSynthetic']);

export function toProvenanceCheckResult(assetId: string, r: ProvenanceResult): CheckResult {
  const c = r.credentials;
  const aiTypes = [...new Set([...c.sourceTypes, ...r.hints.sourceTypes])].filter((t) => AI_TYPES.has(t));
  const sigInvalid = c.contentChanged;
  const untrusted = c.credentialProblem;
  let observation: string;
  if (c.present) {
    const made = aiTypes.length ? AI_SOURCE_TYPES[aiTypes[0]!] ?? aiTypes[0] : 'Content Credentials are attached';
    observation = `${made}${c.generator ? `: ${c.generator}` : ''}${c.signer ? `, signed by ${c.signer}` : ''}.`;
    if (sigInvalid) observation += ' The image no longer matches what was signed: it was changed after the credentials were added.';
    else if (untrusted) observation += ' The signature matches the image; the signer certificate was not validated against a trust list here.';
  } else if (aiTypes.length || r.hints.toolNames.length) {
    observation = `No Content Credentials, but the file's metadata names ${[...r.hints.toolNames, ...aiTypes.map((t) => AI_SOURCE_TYPES[t] ?? t)].slice(0, 3).join(', ')}.`;
  } else {
    observation = 'No Content Credentials or AI-tool metadata found in this file.';
  }
  const finding: CheckResult['finding'] = c.present || aiTypes.length || r.hints.toolNames.length ? (sigInvalid ? 'inconsistent' : 'consistent') : 'inconclusive';
  return {
    id: 'provenance',
    assetId,
    kind: 'provenance',
    execution: r.error ? 'failed' : 'complete',
    finding: r.error ? 'inconclusive' : finding,
    title: 'Content credentials',
    observation: r.error ? `Content Credentials could not be read (${r.error}).` : observation,
    method:
      'Reads C2PA Content Credentials from the original file bytes with the official contentauth SDK (@contentauth/c2pa-web 0.15.5), which checks the manifest signature and that the image still matches it. Also scans readable metadata (XMP, EXIF, PNG text) for AI tool names and IPTC digital source types.',
    assumptions: ['The file is the original download, not a screenshot or re-save.'],
    limitations: [
      'No credentials does not mean real: screenshots, re-saving and most apps remove them.',
      untrusted || c.present
        ? 'The signer certificate was not checked against the C2PA trust list in this version; the signer name is what the certificate states.'
        : 'Only declared metadata is read; it can be removed or edited.',
      'Credentials describe how the file was made, not whether its content is true.',
    ],
    evidence: { credentials: c, hints: r.hints, ms: Math.round(r.ms) },
    overlays: [],
    source: 'live',
    ...(finding === 'inconclusive' && !r.error ? { reason: 'No credentials or AI metadata present.' } : {}),
    ...(r.error ? { reason: 'The credential reader failed.' } : {}),
  } as CheckResult;
}
