import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowCounterClockwise, CaretDown, Eye, EyeSlash, FileText, Sparkle } from '@phosphor-icons/react';
import { rowReveal } from '../../components/ResultCard';
import { TONE_LABEL, type Finding, type FindingTone, type LayerId } from './findings';

const DOT: Record<FindingTone, string> = {
  alert: 'bg-[#e5383b]',
  notice: 'bg-[#ffb000]',
  clear: 'bg-fit',
  pending: 'bg-gold animate-pulse',
  idle: 'bg-line-strong',
};
const LABEL_TONE: Record<FindingTone, string> = {
  alert: 'text-[#b91c1c]',
  notice: 'text-[#b45309]',
  clear: 'text-fit',
  pending: 'text-gold',
  idle: 'text-faint',
};

const ghost =
  'inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium transition-[color,border-color,transform] duration-200 hover:border-gold/60 hover:text-gold active:scale-[0.97]';
const primary =
  'inline-flex h-11 items-center gap-2 rounded-full bg-gold px-5 text-sm font-semibold text-gold-ink transition-transform duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40';

interface Props {
  fileName: string;
  findings: Finding[];
  layers: Partial<Record<LayerId, { visible: boolean; available: boolean; toggle: () => void }>>;
  checking: boolean;
  /** Optional tools that need the person to mark something (face box, shadows). */
  deeper: ReactNode;
  /** The full cards with method, assumptions and limits. */
  details: ReactNode;
  onReport: () => void;
  onNew: () => void;
}

/** Step 3: a plain-language summary first, layers on the photo, tools and details below. */
export function ResultsPanel({ fileName, findings, layers, checking, deeper, details, onReport, onNew }: Props) {
  const [open, setOpen] = useState(false);
  const flagged = findings.filter((f) => f.tone === 'alert').length;
  return (
    <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
      <motion.header variants={rowReveal}>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">{checking ? 'Checking' : 'Results'}</p>
        <h2 className="mt-1 truncate text-2xl font-semibold tracking-[-0.03em]" title={fileName}>
          {checking ? 'Running the checks…' : flagged ? `${flagged} thing${flagged === 1 ? '' : 's'} worth a closer look` : 'What we found'}
        </h2>
        <p className="mt-1 text-sm text-muted text-pretty">
          Each line is evidence from one check, with its own limits. Veil never gives a single “real or fake” verdict.
        </p>
      </motion.header>

      <motion.ul variants={rowReveal} className="mt-5 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised" aria-label="What we found">
        {findings.map((f) => {
          const layer = f.layer ? layers[f.layer] : undefined;
          return (
            <li key={f.id} className="flex items-start gap-3 px-4 py-3.5" data-finding={f.id} data-tone={f.tone}>
              <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${DOT[f.tone]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-semibold leading-snug">{f.title}</p>
                  <p className={`text-xs font-semibold ${LABEL_TONE[f.tone]}`}>{TONE_LABEL[f.tone]}</p>
                </div>
                <p className="mt-0.5 text-sm text-muted text-pretty">{f.headline}</p>
              </div>
              {layer?.available && (
                <button
                  type="button"
                  onClick={layer.toggle}
                  aria-pressed={layer.visible}
                  aria-label={`${layer.visible ? 'Hide' : 'Show'} ${f.title} on the photo`}
                  className="-mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-night/40 hover:text-gold"
                >
                  {layer.visible ? <Eye size={18} aria-hidden /> : <EyeSlash size={18} aria-hidden />}
                </button>
              )}
            </li>
          );
        })}
      </motion.ul>

      <motion.section variants={rowReveal} className="mt-7" aria-labelledby="deeper-h">
        <h3 id="deeper-h" className="flex items-center gap-2 text-sm font-semibold">
          <Sparkle size={16} className="text-gold" aria-hidden />
          Go deeper
        </h3>
        <p className="mt-0.5 text-sm text-muted">These tools need you to mark something on the photo.</p>
        <div className="mt-2 divide-y divide-line">{deeper}</div>
      </motion.section>

      <motion.section variants={rowReveal} className="mt-4 border-t border-line pt-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-12 w-full items-center justify-between text-left text-sm font-semibold hover:text-gold"
        >
          How each check works and its limits
          <CaretDown size={16} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="divide-y divide-line">{details}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      <motion.div variants={rowReveal} className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
        <button type="button" onClick={onReport} disabled={checking} className={primary}>
          <FileText size={16} weight="bold" aria-hidden />
          Create report
        </button>
        <button type="button" onClick={onNew} className={ghost}>
          <ArrowCounterClockwise size={16} aria-hidden />
          Check another file
        </button>
      </motion.div>
    </motion.div>
  );
}
