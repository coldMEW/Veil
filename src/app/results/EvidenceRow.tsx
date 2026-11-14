import { CaretDown, Eye, EyeSlash } from '@phosphor-icons/react';
import { animate } from 'animejs';
import { useLayoutEffect, useRef } from 'react';
import { displayedFinding, type CheckResult } from '../../contracts';

type EvidenceStatus = 'positive' | 'negative' | 'neutral' | 'not-run';

const STATUS: Record<EvidenceStatus, { label: string; className: string }> = {
  positive: { label: 'Compatible', className: 'bg-[#dcfae5] text-[#04250e]' },
  negative: { label: 'Difference found', className: 'bg-[#ffedea] text-[#831c1e]' },
  neutral: { label: 'Inconclusive', className: 'bg-[#eeeeee] text-[#3d3d3d]' },
  'not-run': { label: 'Not run', className: 'bg-[#eeeeee] text-[#3d3d3d]' },
};

function statusFor(check: CheckResult): EvidenceStatus {
  if (check.execution !== 'complete') return 'not-run';
  switch (displayedFinding(check)) {
    case 'consistent': return 'positive';
    case 'inconsistent': return 'negative';
    default: return 'neutral';
  }
}

function evidenceValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'Unavailable';
  try { return JSON.stringify(value); } catch { return String(value); }
}

export interface EvidenceRowProps {
  check: CheckResult;
  /** Controlled expansion makes the selected evidence unambiguous to the canvas overlay. */
  open: boolean;
  onToggle: () => void;
  /** Whether this check's visual evidence is currently shown on the photo. */
  showOnPhoto?: boolean;
  onShowOnPhoto?: (show: boolean) => void;
}

/** A keyboard-accessible, contract-backed record of one local evidence check. */
export function EvidenceRow({ check, open, onToggle, showOnPhoto = false, onShowOnPhoto }: EvidenceRowProps) {
  const details = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const detailsId = `evidence-details-${check.id}`;
  const status = STATUS[statusFor(check)];
  const hasOverlay = check.overlays.length > 0;

  useLayoutEffect(() => {
    const element = details.current;
    if (!element) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = element.getBoundingClientRect().height;
    const to = open ? element.scrollHeight : 0;
    const applyFinalState = () => {
      element.style.height = open ? 'auto' : '0px';
      element.style.opacity = open ? '1' : '0';
    };

    if (!initialized.current || reduceMotion) {
      initialized.current = true;
      applyFinalState();
      return;
    }

    const animation = animate(element, {
      height: [from, to],
      opacity: open ? [0, 1] : [1, 0],
      duration: 180,
      ease: 'cubicBezier(.2, .8, .2, 1)',
      onComplete: applyFinalState,
    });
    return () => { animation.cancel(); };
  }, [open]);

  return (
    <article className="border-b border-line last:border-b-0" data-check-id={check.id}>
      <div className="flex min-h-11 items-start gap-2 py-2">
        <button
          data-testid="evidence-row"
          data-check-id={check.id}
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-[var(--radius-control)] py-1 text-left transition-colors duration-120 hover:bg-raised focus-visible:outline-offset-2"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <strong className="text-sm font-medium leading-5 text-ink">{check.title}</strong>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
            </span>
            <span className="mt-0.5 block truncate text-sm leading-5 text-muted">{check.observation}</span>
          </span>
          <CaretDown
            size={16}
            aria-hidden
            className={`mt-0.5 shrink-0 text-muted transition-transform duration-180 ${open ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          type="button"
          aria-pressed={showOnPhoto}
          aria-label={`${showOnPhoto ? 'Hide' : 'Show'} ${check.title} on the photo`}
          title={hasOverlay ? `${showOnPhoto ? 'Hide from' : 'Show on'} photo` : 'This check has no photo overlay'}
          disabled={!hasOverlay || !onShowOnPhoto}
          onClick={() => onShowOnPhoto?.(!showOnPhoto)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted transition-colors duration-120 hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {showOnPhoto ? <Eye size={16} aria-hidden /> : <EyeSlash size={16} aria-hidden />}
          <span className="sr-only">Show on photo</span>
        </button>
      </div>

      <div
        ref={details}
        id={detailsId}
        data-testid="evidence-details"
        aria-hidden={!open}
        className="overflow-hidden"
        style={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
      >
        <div className="grid gap-3 border-t border-line pb-3 pt-3 text-sm text-muted">
          <section>
            <h4 className="font-medium text-ink">Method</h4>
            <p className="mt-0.5">{check.method}</p>
          </section>
          <section>
            <h4 className="font-medium text-ink">Assumptions</h4>
            <p className="mt-0.5">{check.assumptions.length ? check.assumptions.join(' ') : 'None recorded.'}</p>
          </section>
          <section>
            <h4 className="font-medium text-ink">Limitations</h4>
            <p className="mt-0.5">{check.limitations.length ? check.limitations.join(' ') : 'None recorded.'}</p>
          </section>
          <section>
            <h4 className="font-medium text-ink">Evidence</h4>
            {Object.keys(check.evidence).length > 0 ? (
              <dl className="mt-1 divide-y divide-line border-y border-line">
                {Object.entries(check.evidence).map(([key, value]) => (
                  <div key={key} className="grid min-h-8 grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-2 py-1.5">
                    <dt className="truncate text-xs">{key}</dt>
                    <dd className="break-words text-right font-mono text-xs tabular text-ink">{evidenceValue(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="mt-0.5">No key measurements were recorded.</p>}
          </section>
        </div>
      </div>
    </article>
  );
}
