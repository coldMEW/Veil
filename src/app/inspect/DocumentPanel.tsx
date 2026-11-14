import { FilePdf, WarningCircle } from '@phosphor-icons/react';
import { ResultCard } from '../../components/ResultCard';
import { documentEvidence, type DocumentEvidenceRow } from '../../features/inspect/document/documentEvidence';
import { analysePdf, toDocumentCheckResult } from '../../features/inspect/document/pdfForensics';

export interface DocumentPanelProps {
  fileName: string;
  sha256: string;
  byteLength: number;
  /** A PDF viewer may supply a known page count alongside the structure analysis. */
  analysis: Awaited<ReturnType<typeof analysePdf>> & { pageCount?: number };
  assetId: string;
}

const SEVERITY: Record<DocumentEvidenceRow['severity'], { dot: string; label: string }> = {
  info: { dot: 'bg-muted', label: 'Information' },
  notice: { dot: 'bg-gold', label: 'Notice' },
  warning: { dot: 'bg-misfit', label: 'Warning' },
};

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  const unit = bytes >= 1024 * 1024 ? 'MiB' : 'KiB';
  const divisor = unit === 'MiB' ? 1024 * 1024 : 1024;
  return `${(bytes / divisor).toFixed(1)} ${unit} (${bytes.toLocaleString('en-US')} bytes)`;
}

/** File facts and bounded structural observations, using the shared Inspect visual system. */
export function DocumentPanel({ fileName, sha256, byteLength, analysis, assetId }: DocumentPanelProps) {
  const result = toDocumentCheckResult(assetId, analysis);
  const rows = documentEvidence(analysis);
  const pages = Number.isSafeInteger(analysis.pageCount) && analysis.pageCount! > 0 ? analysis.pageCount : null;
  const banner = !analysis.isPdf ? null : analysis.signatures.changedAfterSigning ? {
    tone: 'border-misfit/50 bg-misfit/10 text-misfit',
    title: 'Changed after it was signed',
    detail: `${analysis.signatures.bytesAfterSignature.toLocaleString('en-US')} bytes follow the last declared signed range. Signature validity was not checked.`,
  } : analysis.revisions > 1 ? {
    tone: 'border-gold/40 bg-gold-soft text-gold',
    title: `Edited after it was first saved (${analysis.revisions} saves)`,
    detail: 'Incremental save markers were found. These can also come from routine document workflows.',
  } : analysis.c2pa.aiToolNames.length > 0 ? {
    tone: 'border-[#e5383b]/50 bg-[#e5383b]/10 text-[#b91c1c]',
    title: `Metadata names an AI tool: ${analysis.c2pa.aiToolNames.join(', ')}`,
    detail: 'Metadata can be changed or removed. A tool name does not establish who wrote the content.',
  } : null;

  return (
    <section aria-label="Document inspection" className="min-w-0">
      <header className="rounded-xl border border-line bg-raised p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-panel text-muted">
            <FilePdf size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="break-words font-semibold leading-snug text-ink"><bdi>{fileName}</bdi></h2>
            <p className="mt-1 text-sm text-muted">
              {analysis.isPdf ? `PDF ${analysis.version ?? 'version unknown'}` : 'PDF details unavailable'}
              {analysis.isPdf && pages !== null && `, ${pages} ${pages === 1 ? 'page' : 'pages'}`}
            </p>
            <p className="tabular mt-1 text-sm text-muted">{fileSize(byteLength)}</p>
          </div>
        </div>
        <dl className="mt-4 border-t border-line pt-3 text-xs">
          <dt className="font-medium text-muted">SHA-256 of the opened file</dt>
          <dd className="mt-1 break-all font-mono leading-relaxed text-ink/90">{sha256}</dd>
        </dl>
      </header>

      {banner && (
        <div className={`mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${banner.tone}`} role="status">
          <WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 break-words">
            <p className="font-semibold">{banner.title}</p>
            <p className="mt-1 leading-relaxed">{banner.detail}</p>
          </div>
        </div>
      )}

      <ResultCard result={result} />

      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full table-fixed text-left text-sm">
          <caption className="border-b border-line bg-raised px-3 py-3 text-left font-semibold text-ink">Document evidence</caption>
          <colgroup><col className="w-8" /><col className="w-1/3" /><col /></colgroup>
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th scope="col" className="py-2"><span className="sr-only">Severity</span></th>
              <th scope="col" className="py-2 pr-3 font-medium">Observation</th>
              <th scope="col" className="py-2 pr-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, index) => (
              <tr key={`${row.label}-${index}`}>
                <td className="py-3 pl-3 align-top">
                  <span role="img" aria-label={SEVERITY[row.severity].label} className={`mt-1 inline-block size-2 rounded-full ${SEVERITY[row.severity].dot}`} />
                </td>
                <th scope="row" className="break-words py-3 pr-3 align-top font-medium text-ink/90">{row.label}</th>
                <td className="break-words py-3 pr-3 align-top text-muted">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
