import { useId, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CaretDown,
  CheckCircle,
  CircleDashed,
  MinusCircle,
  Scan,
  SealCheck,
  Sun,
  WarningCircle,
  WaveSine,
  type IconProps,
} from '@phosphor-icons/react';
import { displayedFinding, type CheckResult, type EvidenceKind, type Execution, type Finding } from '../contracts';

const KIND: Record<EvidenceKind, { label: string; icon: ComponentType<IconProps> }> = {
  physical: { label: 'Physical', icon: Sun },
  model: { label: 'Model diagnostic', icon: Scan },
  signal: { label: 'Signal', icon: WaveSine },
  provenance: { label: 'Provenance', icon: SealCheck },
};

const EXECUTION_LABEL: Record<Execution, string> = {
  complete: 'Ran on this device',
  failed: 'Failed',
  timeout: 'Timed out',
  unavailable: 'Not run',
};

const FINDING: Record<Finding, { label: string; icon: ComponentType<IconProps>; tone: string }> = {
  consistent: { label: 'Fits this check', icon: CheckCircle, tone: 'text-fit' },
  inconsistent: { label: 'Does not fit this check', icon: WarningCircle, tone: 'text-misfit' },
  inconclusive: { label: 'Inconclusive', icon: CircleDashed, tone: 'text-muted' },
  not_applicable: { label: 'Not applicable', icon: MinusCircle, tone: 'text-muted' },
};

export const rowReveal = {
  hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
} as const;

/** One check in the evidence rail: observation first, method and limits on request. */
export function ResultCard({ result }: { result: CheckResult }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const finding = FINDING[displayedFinding(result)];
  const kind = KIND[result.kind];
  const KindIcon = kind.icon;
  const FindingIcon = finding.icon;

  return (
    <motion.article variants={rowReveal} className="py-4">
      <div className="flex gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
          <KindIcon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="font-semibold leading-snug">{result.title}</h3>
            <span className={`inline-flex items-center gap-1 text-sm font-medium ${finding.tone}`}>
              <FindingIcon size={15} weight="bold" aria-hidden />
              {finding.label}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-faint">
            {kind.label}, {EXECUTION_LABEL[result.execution].toLowerCase()}
            {result.source === 'recorded_fixture' && <span className="text-misfit">, recorded result</span>}
          </p>
          <p className="mt-2 text-sm text-muted text-pretty">{result.observation}</p>

          <button
            type="button"
            className="mt-2 -ml-1 inline-flex min-h-11 items-center gap-1 px-1 text-sm font-medium text-ink/80 hover:text-gold"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
          >
            Method and limits
            <CaretDown
              size={14}
              aria-hidden
              className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          </button>

          <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.18 } }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
            <dl id={detailsId} className="mt-1 space-y-3 rounded-xl bg-raised p-4 text-sm">
              <div>
                <dt className="font-medium">Method</dt>
                <dd className="mt-0.5 text-muted">{result.method}</dd>
              </div>
              <div>
                <dt className="font-medium">Assumptions</dt>
                <dd className="mt-0.5 text-muted">
                  {result.assumptions.length ? (
                    <ul className="list-disc space-y-1 pl-5">
                      {result.assumptions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  ) : (
                    'None stated.'
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-medium">What stays unknown</dt>
                <dd className="mt-0.5 text-muted">
                  <ul className="list-disc space-y-1 pl-5">
                    {result.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </div>
    </motion.article>
  );
}
