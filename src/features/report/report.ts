import type { CheckResult, ImageAsset, PrivacyCandidate, TransformRecord } from '../../contracts';
import { enforceInvariants } from '../../contracts';

/**
 * Deterministic evidence report. No LLM. Never contains OCR text or pixels.
 * A SHA-256 identifies bytes; it is not chain of custody.
 */
export interface ReportInput {
  appVersion: string;
  commit: string;
  generatedAt: string; // ISO time, supplied by caller so tests are deterministic
  original: ImageAsset;
  exported?: ImageAsset;
  checks: CheckResult[];
  candidates: PrivacyCandidate[];
  transforms: TransformRecord[];
  verification?: {
    exportMetadataBlocks: string[];
    roundTripMismatches: number;
    rescan?: { stillDetectedCount: number; totalBoxes: number; selectedCount: number } | 'not_run';
  };
  protection?: { status: 'not_tested' | 'unavailable' | 'experimental_transform_only' | 'measured'; note: string };
}

export const REPORT_SCHEMA = 'veil.report/v1';

export function buildReport(input: ReportInput) {
  const checks = input.checks.map(enforceInvariants).map((c) => ({
    id: c.id,
    assetId: c.assetId,
    kind: c.kind,
    title: c.title,
    execution: c.execution,
    finding: c.finding,
    reason: c.reason ?? null,
    observation: c.observation,
    method: c.method,
    assumptions: c.assumptions,
    limitations: c.limitations,
    source: c.source,
    evidence: c.evidence,
    overlayCount: c.overlays.length,
  }));

  const selected = input.candidates.filter((c) => c.selected);
  const byCategory: Record<string, number> = {};
  for (const c of selected) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;

  const rescan = input.verification?.rescan;
  const privacyStatement =
    rescan === undefined || rescan === 'not_run'
      ? 'The exported image was not re-scanned.'
      : rescan.stillDetectedCount === 0
        ? `This re-scan no longer detects text in the ${rescan.selectedCount} selected region(s). This is not a guarantee that all private information is gone.`
        : `The re-scan still detects text in ${rescan.stillDetectedCount} of ${rescan.selectedCount} selected region(s). Review before sharing.`;

  return {
    schema: REPORT_SCHEMA,
    app: { version: input.appVersion, commit: input.commit },
    generatedAt: input.generatedAt,
    original: assetSummary(input.original),
    exported: input.exported ? assetSummary(input.exported) : null,
    hashNote: 'SHA-256 identifies exact file bytes; it is not chain of custody.',
    inspect: {
      checks,
      summary: 'Observations are listed individually. There is no overall authenticity score.',
    },
    clean: {
      selectedRegions: selected.length,
      selectedByCategory: sortKeys(byCategory),
      detectionSources: [...new Set(selected.map((c) => c.sourceMethod))].sort(),
      transforms: input.transforms.map((t) => ({
        method: t.method,
        synthetic: t.synthetic,
        inputSha256: t.inputSha256,
        outputSha256: t.outputSha256,
        maskSha256: t.maskSha256 ?? null,
        maskExpansionPx: t.maskExpansionPx ?? null,
        modelSha256: t.modelSha256 ?? null,
        seed: t.seed ?? null,
        parameters: t.parameters,
        output: `${t.outputFormat} ${t.outputWidth}x${t.outputHeight}`,
      })),
      syntheticContentNote: input.transforms.some((t) => t.synthetic)
        ? 'Inpainted regions contain model-generated (synthetic) background.'
        : null,
      verification: input.verification
        ? {
            exportMetadataBlocks: input.verification.exportMetadataBlocks,
            roundTripMismatches: input.verification.roundTripMismatches,
            rescan: rescan ?? 'not_run',
          }
        : null,
      privacyStatement,
    },
    protect: input.protection ?? { status: 'not_tested', note: 'No protection experiment was run.' },
  };
}

function assetSummary(a: ImageAsset) {
  return {
    sha256: a.sha256,
    mimeType: a.mimeType,
    byteLength: a.byteLength,
    encodedWidth: a.encodedWidth,
    encodedHeight: a.encodedHeight,
    width: a.width,
    height: a.height,
    parentId: a.parentId,
  };
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Canonical JSON: recursively sorted keys, 2-space indent, trailing newline. Same input => same bytes. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value), null, 2) + '\n';
}
