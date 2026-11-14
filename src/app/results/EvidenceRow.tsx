import { useLayoutEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { CaretDown, Eye, EyeSlash } from '@phosphor-icons/react';
import type { FindingTone } from './findings';
import type { EvidenceItem } from './evidence';

const PILL: Record<FindingTone, string> = {
  alert: 'bg-alert-bg text-alert-ink',
  notice: 'bg-notice-bg text-notice-ink',
  clear: 'bg-clear-bg text-clear-ink',
  neutral: 'bg-idle-bg text-idle-ink',
  pending: 'bg-idle-bg text-idle-ink',
  idle: 'bg-idle-bg text-idle-ink',
};

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One check: a pill, a title and one plain sentence. Opens in place to show how it works and its limits. */
export function EvidenceRow({ item, open, onToggle }: { item: EvidenceItem; open: boolean; onToggle: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const [shown, setShown] = useState(open);

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    if (first.current || reduced()) {
      first.current = false;
      el.style.height = open ? 'auto' : '0px';
      el.style.opacity = open ? '1' : '0';
      if (!open) setShown(false);
      return;
    }
    if (open) setShown(true);
    const full = el.scrollHeight;
    const a = animate(el, {
      height: open ? [el.offsetHeight, full] : [el.offsetHeight, 0],
      opacity: open ? [0, 1] : [1, 0],
      duration: open ? 260 : 200,
      ease: 'outExpo',
      onComplete: () => {
        if (open) el.style.height = 'auto';
        else setShown(false);
      },
    });
    return () => void a.cancel();
  }, [open]);

  const panelId = `evidence-${item.id}`;
  return (
    <article
      className={`rounded-panel transition-[background-color,box-shadow] duration-200 ${open ? 'bg-panel shadow-[var(--shadow-card)]' : 'hover:bg-panel/70'}`}
      data-tone={item.tone}
    >
      <div className="flex items-start gap-1 p-1.5">
        <button
          type="button"
          data-testid="evidence-row"
          data-check-id={item.id}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-h-14 flex-1 items-start gap-3 rounded-[12px] px-2.5 py-2.5 text-left"
        >
          <span
            aria-hidden
            className={`tabular mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${open ? 'bg-gold text-gold-ink' : 'bg-raised text-muted'}`}
          >
            {item.number}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold leading-snug">{item.title}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[item.tone]}`}>
                {item.tone === 'pending' && <span className="pulse-dot size-1.5 rounded-full bg-current" aria-hidden />}
                {item.label}
              </span>
            </span>
            <span className="mt-1 block text-sm text-muted text-pretty">{item.headline}</span>
          </span>
          <CaretDown
            size={18}
            aria-hidden
            className={`mt-1 shrink-0 text-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {item.layer?.available && (
          <button
            type="button"
            onClick={item.layer.toggle}
            aria-pressed={item.layer.visible}
            aria-label={`${item.layer.visible ? 'Hide' : 'Show'} the ${item.title} map on the photo`}
            className="icon-btn shrink-0"
          >
            {item.layer.visible ? <Eye size={20} aria-hidden /> : <EyeSlash size={20} aria-hidden />}
          </button>
        )}
      </div>

      <div ref={body} id={panelId} className="overflow-hidden" style={{ height: 0, opacity: 0 }}>
        {(open || shown) && (
          <div data-testid="evidence-details" className="grid gap-4 px-4 pb-4 pl-[3.25rem] text-sm">
            {item.why.length > 0 && <Section label="Why">{item.why.join(' ')}</Section>}
            <Section label="Method">{item.method}</Section>
            {item.assumptions.length > 0 && <Section label="Assumptions">{item.assumptions.join(' ')}</Section>}
            <Section label="Limitations">{item.limitations.join(' ')}</Section>
            {item.numbers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-faint">Measured</p>
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {item.numbers.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted first-letter:uppercase">{k}</dt>
                      <dd className="tabular truncate text-right font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <p className="text-xs text-faint">
              {item.region ? `Outlined on the photo as ${item.number}: ${item.regionLabel.toLowerCase()}.` : 'Nothing to outline on the photo yet.'}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-faint">{label}</p>
      <p className="mt-0.5 text-ink/90 text-pretty">{children}</p>
    </div>
  );
}
