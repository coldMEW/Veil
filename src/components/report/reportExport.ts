import type { ModelManifest } from '../../contracts';
import { buildReport, canonicalJson } from '../../features/report/report';

export type EvidenceReport = ReturnType<typeof buildReport>;

/** Keep display and downloaded JSON consistent, even for a stale invalid finding. */
export function prepareReport(report: EvidenceReport, modelManifests: readonly ModelManifest[] = []) {
  return {
    ...report,
    inspect: {
      ...report.inspect,
      checks: report.inspect.checks.map((check) => ({
        ...check,
        finding: check.execution === 'complete' ? check.finding : 'inconclusive' as const,
        reason: check.reason || (check.execution !== 'complete' ? `Check did not complete (${check.execution}).` : null),
      })),
    },
    modelManifests,
  };
}

export function serializeReport(report: EvidenceReport, modelManifests: readonly ModelManifest[] = []): string {
  return canonicalJson(prepareReport(report, modelManifests));
}

export function reportFilename(report: Pick<EvidenceReport, 'original'>): string {
  const hash = report.original.sha256;
  return `veil-report-${/^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : 'unknown-input'}.json`;
}
