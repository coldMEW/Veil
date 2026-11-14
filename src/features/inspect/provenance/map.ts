import type { CheckResult } from '../../../contracts';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as RecordValue) : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const trustOnly = (code: string) => /^(?:signingCredential|timeStamp)\.(?:untrusted|trusted)$/i.test(code);

/** Map validated SDK output without treating signed source declarations as physical inconsistencies. */
export function mapProvenance(store: unknown, assetId: string, sdkError = false): CheckResult {
  const raw = record(store);
  const label = typeof raw.active_manifest === 'string' ? raw.active_manifest : null;
  const manifests = record(raw.manifests);
  const manifest = label ? record(manifests[label]) : {};
  const present = !!label;
  const results = record(raw.validation_results);
  const active = record(results.activeManifest ?? results.active_manifest);
  const statuses: unknown[] = [...array(active.failure)];
  for (const ingredient of array(results.ingredientDeltas ?? results.ingredient_deltas)) {
    statuses.push(
      ...array(record(record(ingredient).validationDeltas ?? record(ingredient).validation_deltas).failure),
    );
  }
  statuses.push(...array(raw.validation_status).filter((s) => record(s).success !== true));
  const codes = [
    ...new Set(statuses.map((s) => record(s).code).filter((c): c is string => typeof c === 'string')),
  ];
  const failures = codes.filter((c) => !trustOnly(c));
  const actions = array(manifest.assertions).flatMap((a) => {
    const assertion = record(a);
    return typeof assertion.label === 'string' && assertion.label.startsWith('c2pa.actions')
      ? array(record(assertion.data).actions).map((a) => {
          const action = record(a);
          return { action: action.action ?? null, digitalSourceType: action.digitalSourceType ?? null };
        })
      : [];
  });
  const declaredSource = actions.map((a) => a.digitalSourceType).filter((v) => typeof v === 'string');
  const intact =
    present &&
    !failures.length &&
    (raw.validation_state === 'Valid' ||
      raw.validation_state === 'Trusted' ||
      array(active.success).some((s) => record(s).code === 'claimSignature.validated'));
  const failed = sdkError || (present && !intact && !failures.length);
  const reason = failed
    ? 'Content Credentials could not be checked by the SDK.'
    : !present
      ? 'No Content Credentials found; provenance is unknown.'
      : failures.length
        ? `Credential validation failed: ${failures.join(', ')}.`
        : 'Credentials are intact; this says who signed and what they declared, not whether the scene is real.';
  return {
    id: 'provenance',
    assetId,
    kind: 'provenance',
    title: 'Content Credentials',
    source: 'live',
    execution: failed ? 'failed' : 'complete',
    finding: failed
      ? 'inconclusive'
      : !present
        ? 'not_applicable'
        : failures.length
          ? 'inconsistent'
          : 'consistent',
    reason,
    observation: sdkError
      ? 'Credential inspection did not complete.'
      : !present
        ? 'No embedded credential manifest was read.'
        : declaredSource.length
          ? `The signed claim declares source type: ${declaredSource.join(', ')}.`
          : 'An embedded credential manifest records signing and editing declarations.',
    method:
      'C2PA SDK validation of embedded credentials, with remote manifests, OCSP and trust-list fetching disabled.',
    assumptions: ['Credentials refer to these exact input file bytes.'],
    limitations: [
      'Signer trust is unknown: no trust list or anchors were loaded.',
      'No remote manifests or certificate revocation services are consulted.',
      'A signature records a declaration, not the truth of the depicted scene.',
    ],
    evidence: {
      manifestPresent: sdkError ? null : present,
      integrity: {
        status: failures.length ? 'invalid' : intact ? 'valid' : 'not_checked',
        validationCodes: failures,
      },
      signer: { trust: 'unknown', details: manifest.signature_info ?? null },
      claimGenerator: manifest.claim_generator ?? manifest.claim_generator_info ?? null,
      declaredSource,
      actions,
      trustValidationCodes: codes.filter(trustOnly),
    },
    overlays: [],
  };
}
