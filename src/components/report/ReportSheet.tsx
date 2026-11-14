import { useEffect, useId, useRef, type ReactNode } from 'react';
import { displayedFinding, type CheckResult, type Finding, type ImageAsset, type TransformRecord } from '../../contracts';
import '../../styles/print.css';

export interface ReportSheetProps {
  asset: ImageAsset;
  checks: readonly CheckResult[];
  transforms: readonly TransformRecord[];
  /** The opened file name is session state, rather than a property of ImageAsset. */
  fileName?: string;
  /** Lets a caller preserve the report's generation time instead of using render time. */
  generatedAt?: string | Date;
  open?: boolean;
  onClose?: () => void;
}

const findingLabel: Record<Finding, string> = {
  consistent: 'Compatible with this check',
  inconsistent: 'Difference reported',
  inconclusive: 'Inconclusive',
  not_applicable: 'Not applicable',
};

function formatDate(value: string | Date | undefined): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.valueOf()) ? 'Unavailable' : date.toLocaleString();
}

function evidenceValue(value: unknown): string {
  if (value === null) return 'None';
  if (value === undefined) return 'Unavailable';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return 'Unavailable';
  }
}

function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="report-field border-b border-[#eef0f3] py-2 last:border-b-0">
      <dt className="text-xs font-medium text-[#5f6670]">{label}</dt>
      <dd className={mono ? 'font-mono text-xs tabular break-all' : 'text-sm'}>{children}</dd>
    </div>
  );
}

function List({ items, empty = 'None stated.' }: { items: readonly string[]; empty?: string }) {
  return items.length ? <ul className="list-disc space-y-1 pl-4">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <>{empty}</>;
}

function FindingPill({ finding }: { finding: Finding }) {
  const tone = finding === 'consistent'
    ? 'bg-[#dcfae5] text-[#04250e]'
    : finding === 'inconsistent'
      ? 'bg-[#ffedea] text-[#831c1e]'
      : finding === 'not_applicable'
        ? 'bg-[#eeeeee] text-[#3d3d3d]'
        : 'bg-[#fffbeb] text-[#92400e]';
  return <span className={`inline-flex min-h-6 items-center rounded-full px-2 text-xs font-medium ${tone}`}>{findingLabel[finding]}</span>;
}

function CheckRecord({ check }: { check: CheckResult }) {
  const finding = displayedFinding(check);
  const entries = Object.entries(check.evidence);
  return (
    <section className="report-record break-inside-avoid border-b border-[#e3e6eb] py-5 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{check.title}</h3>
          <p className="mt-1 text-sm text-[#5f6670]">{check.observation || 'No observation recorded.'}</p>
        </div>
        <FindingPill finding={finding} />
      </div>
      <dl className="mt-4">
        <Field label="Check ID" mono>{check.id}</Field>
        <Field label="Execution">{check.execution}</Field>
        {check.reason && <Field label="Reason">{check.reason}</Field>}
        <Field label="Method">{check.method || 'Unavailable'}</Field>
        <Field label="Assumptions"><List items={check.assumptions} /></Field>
        <Field label="Limitations"><List items={check.limitations} empty="No limitations recorded." /></Field>
        <Field label="Evidence">
          {entries.length ? (
            <dl className="mt-1 divide-y divide-[#eef0f3] rounded-md border border-[#eef0f3] px-3">
              {entries.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 py-2 text-xs">
                  <dt className="text-[#5f6670]">{key}</dt>
                  <dd className="m-0 break-words font-mono tabular">{evidenceValue(value)}</dd>
                </div>
              ))}
            </dl>
          ) : 'No key values recorded.'}
        </Field>
      </dl>
    </section>
  );
}

function TransformRecordView({ transform, index }: { transform: TransformRecord; index: number }) {
  return (
    <section className="report-record break-inside-avoid border-b border-[#e3e6eb] py-5 last:border-b-0">
      <h3 className="text-base font-semibold">Transform {index + 1}: {transform.method}</h3>
      <dl className="mt-3">
        <Field label="Created">{formatDate(transform.createdAt)}</Field>
        <Field label="Synthetic content">{transform.synthetic ? 'Model-generated pixels may be present inside the selected region.' : 'No model-generated pixels recorded.'}</Field>
        <Field label="Input SHA-256" mono>{transform.inputSha256}</Field>
        <Field label="Output SHA-256" mono>{transform.outputSha256}</Field>
        {transform.maskSha256 && <Field label="Mask SHA-256" mono>{transform.maskSha256}</Field>}
        {transform.modelSha256 && <Field label="Model SHA-256" mono>{transform.modelSha256}</Field>}
        <Field label="Output">{transform.outputFormat}, {transform.outputWidth} × {transform.outputHeight} px</Field>
        <Field label="Parameters" mono>{evidenceValue(transform.parameters)}</Field>
      </dl>
    </section>
  );
}

/**
 * A transient, printable view of the results currently in memory. Rendering this
 * component never saves a report or an input image.
 */
export function ReportSheet({
  asset,
  checks,
  transforms,
  fileName = asset.id,
  generatedAt,
  open = true,
  onClose,
}: ReportSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusables = () => dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      : [];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const targets = focusables();
      if (!targets.length) {
        event.preventDefault();
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      priorFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="report-modal fixed inset-0 z-50 overflow-y-auto bg-[#f2f4f7]/90 p-4 sm:p-8" role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="mx-auto flex min-h-full w-full max-w-[900px] items-start justify-center">
        <article data-testid="report-sheet" className="veil-report my-auto w-full max-w-[794px] bg-white p-7 text-[#0a0a0a] shadow-[0_12px_36px_rgba(10,10,10,0.14)] sm:p-12 print:m-0 print:max-w-none print:p-0">
          <header className="border-b border-[#e3e6eb] pb-6">
            <div className="report-actions mb-6 flex items-center justify-end gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className="min-h-9 rounded-[6px] bg-[#e5e5e5] px-3 text-sm font-medium hover:bg-[#dcdcdc] active:scale-[.98]">Print</button>
              <button ref={closeRef} type="button" onClick={onClose} className="min-h-9 rounded-[6px] bg-[#141414] px-3 text-sm font-medium text-white hover:bg-black active:scale-[.98]">Close</button>
            </div>
            <h1 id={titleId} className="text-2xl font-semibold tracking-[-0.02em]">Veil evidence report</h1>
            <p className="mt-2 text-sm text-[#5f6670]">Observations and their limits for the opened file.</p>
            <dl className="mt-5">
              <Field label="File name">{fileName}</Field>
              <Field label="SHA-256" mono>{asset.sha256}</Field>
              <Field label="Dimensions">{asset.width} × {asset.height} px</Field>
              <Field label="MIME type">{asset.mimeType}</Field>
              <Field label="Generated">{formatDate(generatedAt)}</Field>
            </dl>
          </header>

          <section className="report-section mt-7" aria-labelledby={`${titleId}-checks`}>
            <h2 id={`${titleId}-checks`} className="text-base font-semibold">Checks</h2>
            {!checks.length && <p className="mt-3 text-sm text-[#5f6670]">No checks were recorded.</p>}
            <div className="mt-2">{checks.map((check) => <CheckRecord key={check.id} check={check} />)}</div>
          </section>

          <section className="report-section mt-7" aria-labelledby={`${titleId}-transforms`}>
            <h2 id={`${titleId}-transforms`} className="text-base font-semibold">Clean transforms</h2>
            {!transforms.length && <p className="mt-3 text-sm text-[#5f6670]">No Clean transforms were recorded.</p>}
            <div className="mt-2">{transforms.map((transform, index) => <TransformRecordView key={transform.id} transform={transform} index={index} />)}</div>
          </section>

          <footer className="mt-8 border-t border-[#e3e6eb] pt-4 text-sm text-[#5f6670]">
            Results are evidence, not verdicts. Each observation is limited to the method and input recorded above.
          </footer>
        </article>
      </div>
    </div>
  );
}
