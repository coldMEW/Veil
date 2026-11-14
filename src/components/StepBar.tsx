import { Check } from '@phosphor-icons/react';

const STEPS = ['Upload', 'Check', 'Results', 'Report'] as const;

/** Progress is descriptive: completed steps do not imply that a check passed. */
export function StepBar({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <nav aria-label="Inspection progress" className="shrink-0">
      <p className="tabular text-sm font-medium text-gold sm:hidden" aria-current="step">
        Step {step} of 4: {STEPS[step - 1]}
      </p>
      <ol className="hidden items-center gap-2 sm:flex lg:gap-3">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const current = number === step;
          const done = number < step;
          return (
            <li key={label} aria-current={current ? 'step' : undefined} className={`flex items-center gap-2 text-sm ${current ? 'font-semibold text-gold' : 'text-muted'}`}>
              <span className={`tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${current ? 'bg-gold text-gold-ink' : done ? 'bg-raised text-gold' : 'border border-line-strong'}`}>
                {done ? <Check size={14} weight="bold" aria-hidden /> : <span aria-hidden>{number}</span>}
              </span>
              <span>{label}<span className="sr-only">{done ? ', completed' : current ? ', current' : ', upcoming'}</span></span>
              {number < STEPS.length && <span className="ml-1 h-px w-4 bg-line-strong lg:w-6" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
