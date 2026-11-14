import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowCounterClockwise, CaretDown, CircleNotch, Eye, EyeSlash, FileText, MagnifyingGlass, Question, Sparkle,
  WarningCircle, WarningOctagon,
} from '@phosphor-icons/react';
import { rowReveal } from '../../components/ResultCard';
import { ViewStrip } from '../../features/inspect/model/ViewStrip';
import {
  evidenceLevel, GROUP_LABEL, LEVEL_TEXT, TONE_LABEL,
  type EvidenceGroup, type EvidenceLevel, type Finding, type FindingTone, type LayerId,
} from './findings';
import './evidence.css';

/** Status colours per tone: chip text, chip background, dot. The word is always shown, never colour alone. */
const TONE: Record<FindingTone, { fg: string; bg: string; dot: string }> = {
  alert: { fg: 'var(--ev-red-fg)', bg: 'var(--ev-red-bg)', dot: 'var(--ev-red-dot)' },
  notice: { fg: 'var(--ev-amber-fg)', bg: 'var(--ev-amber-bg)', dot: 'var(--ev-amber-dot)' },
  clear: { fg: 'var(--ev-green-fg)', bg: 'var(--ev-green-bg)', dot: 'var(--ev-green-dot)' },
  neutral: { fg: 'var(--ev-grey-fg)', bg: 'var(--ev-grey-bg)', dot: 'var(--ev-grey-dot)' },
  pending: { fg: 'var(--ev-blue-fg)', bg: 'var(--ev-blue-bg)', dot: 'var(--ev-blue-dot)' },
  idle: { fg: 'var(--ev-grey-fg)', bg: 'var(--ev-grey-bg)', dot: 'var(--ev-grey-dot)' },
};

const LEVEL: Record<EvidenceLevel, { icon: ReactNode; fg: string; bg: string }> = {
  strong: { icon: <WarningOctagon size={22} weight="fill" aria-hidden />, fg: 'var(--ev-red-fg)', bg: 'var(--ev-red-bg)' },
  some: { icon: <WarningCircle size={22} weight="fill" aria-hidden />, fg: 'var(--ev-amber-fg)', bg: 'var(--ev-amber-bg)' },
  // "None found" is deliberately grey, not green: passing these checks does not clear a photo.
  none: { icon: <MagnifyingGlass size={22} weight="bold" aria-hidden />, fg: 'var(--ev-grey-fg)', bg: 'var(--ev-grey-bg)' },
  unknown: { icon: <Question size={22} weight="bold" aria-hidden />, fg: 'var(--ev-grey-fg)', bg: 'var(--ev-grey-bg)' },
  checking: { icon: <CircleNotch size={22} weight="bold" className="animate-spin" aria-hidden />, fg: 'var(--ev-blue-fg)', bg: 'var(--ev-blue-bg)' },
};

const GROUP_ORDER: EvidenceGroup[] = ['provenance', 'model', 'signal', 'physical'];

const ghost =
  'inline-flex h-11 items-center gap-2 rounded-full border border-[var(--ev-line)] bg-[var(--ev-card)] px-4 text-sm font-medium text-[var(--ev-fg)] transition-[border-color,color,transform] duration-200 hover:border-[var(--ev-accent)]/40 hover:text-[var(--ev-accent)] active:scale-[0.97]';
const primary =
  'inline-flex h-11 items-center gap-2 rounded-full bg-[var(--ev-accent)] px-5 text-sm font-semibold text-white transition-[filter,transform] duration-200 hover:brightness-110 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40';

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

function StatusChip({ tone }: { tone: FindingTone }) {
  const t = TONE[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ color: t.fg, background: t.bg }}
    >
      <span className={`size-1.5 rounded-full ${tone === 'pending' ? 'animate-pulse' : ''}`} style={{ background: t.dot }} aria-hidden />
      {TONE_LABEL[tone]}
    </span>
  );
}

/** The top of the results: the strongest flag any single check raised, and the reasons for it. */
function EvidenceSummary({ findings }: { findings: Finding[] }) {
  const level = evidenceLevel(findings);
  const look = LEVEL[level];
  const text = LEVEL_TEXT[level];
  const flagged = findings.filter((f) => f.tone === 'alert' || f.tone === 'notice')
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'alert' ? -1 : 1));
  return (
    <motion.section variants={rowReveal} className="ev-surface p-5" aria-labelledby="ev-summary-h" aria-live="polite">
      <div className="flex items-start gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl" style={{ color: look.fg, background: look.bg }}>
          {look.icon}
        </span>
        <div className="min-w-0 self-center">
          <h2 id="ev-summary-h" className="ev-display text-[1.375rem] font-semibold leading-tight text-balance">{text.title}</h2>
          {text.body && <p className="mt-0.5 text-[13px] text-[var(--ev-muted)]">{text.body}</p>}
        </div>
      </div>

      {flagged.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-[var(--ev-line)] pt-4" aria-label="What points to this">
          {flagged.map((f) => (
            <li key={f.id} className="flex items-start gap-2.5">
              <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: TONE[f.tone].dot }} aria-hidden />
              <p className="min-w-0 text-pretty">
                <span className="block font-semibold leading-snug">{f.short ?? f.headline}</span>
                <span className="block text-xs text-[var(--ev-faint)]">{f.title}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

    </motion.section>
  );
}

/** The basis behind one line: what was measured, what it showed, and when it can be wrong. */
function Why({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  if (!f.why?.length) return null;
  const id = `why-${f.id}`;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-[13px] font-semibold text-[var(--ev-accent)] hover:underline"
      >
        Why
        <CaretDown size={13} weight="bold" className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="why"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pb-1 pt-2 text-[13px] leading-relaxed text-[var(--ev-muted)]">
              {f.views && f.views.length > 0 && (
                <div className="rounded-xl bg-[var(--ev-bg)] p-3">
                  <ViewStrip views={f.views} compact />
                </div>
              )}
              <ul className="space-y-1.5">
                {f.why.map((line) => (
                  <li key={line} className="flex gap-2 text-pretty">
                    <span className="mt-[9px] size-1 shrink-0 rounded-full bg-[var(--ev-faint)]" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
              {f.limits && (
                <p className="text-pretty">
                  <span className="font-semibold text-[var(--ev-fg)]">Limits: </span>
                  {f.limits}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EvidenceRow({ f, layer }: { f: Finding; layer?: { visible: boolean; available: boolean; toggle: () => void } }) {
  return (
    <li className="px-4 py-4" data-finding={f.id} data-tone={f.tone}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h4 className="text-[15px] font-semibold leading-snug">{f.title}</h4>
            <StatusChip tone={f.tone} />
          </div>
          <p className="mt-0.5 text-[var(--ev-muted)] text-pretty" title={f.headline}>{f.short ?? f.headline}</p>
          <Why f={f} />
        </div>
        {layer?.available && (
          <button
            type="button"
            onClick={layer.toggle}
            aria-pressed={layer.visible}
            aria-label={`${layer.visible ? 'Hide' : 'Show'} ${f.title} on the photo`}
            title={`${layer.visible ? 'Hide' : 'Show'} on the photo`}
            className="-mr-1 -mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--ev-faint)] transition-colors hover:bg-[var(--ev-bg)] hover:text-[var(--ev-accent)]"
          >
            {layer.visible ? <Eye size={18} aria-hidden /> : <EyeSlash size={18} aria-hidden />}
          </button>
        )}
      </div>
    </li>
  );
}

/** Step 3: what the evidence adds up to first, each check's reasons next, tools and details below. */
export function ResultsPanel({ fileName: _fileName, findings, layers, checking, deeper, details, onReport, onNew }: Props) {
  const [open, setOpen] = useState(false);
  // Optional tools nobody has run yet are listed once, not as empty rows.
  const shown = findings.filter((f) => f.tone !== 'idle');
  const notRun = findings.filter((f) => f.tone === 'idle');
  const groups = GROUP_ORDER.map((g) => ({ g, items: shown.filter((f) => f.group === g) })).filter((x) => x.items.length);
  return (
    <motion.div
      className="evidence-ui"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.04 } } }}
    >
      <EvidenceSummary findings={findings} />

      <div className="mt-6 space-y-5">
        {groups.map(({ g, items }) => (
          <motion.section key={g} variants={rowReveal} aria-labelledby={`ev-g-${g}`}>
            <h3 id={`ev-g-${g}`} className="mb-2 px-1 text-[13px] font-semibold text-[var(--ev-faint)]">{GROUP_LABEL[g]}</h3>
            <ul className="ev-surface divide-y divide-[var(--ev-line)] overflow-hidden">
              {items.map((f) => <EvidenceRow key={f.id} f={f} layer={f.layer ? layers[f.layer] : undefined} />)}
            </ul>
          </motion.section>
        ))}
        {notRun.length > 0 && (
          <motion.p variants={rowReveal} className="px-1 text-[13px] text-[var(--ev-faint)] text-pretty">
            Not run: {notRun.map((f) => f.title).join(', ')}
          </motion.p>
        )}
      </div>

      <motion.section variants={rowReveal} className="mt-8" aria-labelledby="deeper-h">
        <h3 id="deeper-h" className="flex items-center gap-2 px-1 text-[15px] font-semibold">
          <Sparkle size={16} weight="fill" className="text-[var(--ev-accent)]" aria-hidden />
          Go deeper
        </h3>
        <div className="ev-surface mt-3 divide-y divide-[var(--ev-line)] px-4">{deeper}</div>
      </motion.section>

      <motion.section variants={rowReveal} className="mt-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-12 w-full items-center justify-between rounded-xl px-1 text-left text-[15px] font-semibold hover:text-[var(--ev-accent)]"
        >
          Method and limits
          <CaretDown size={16} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="ev-surface divide-y divide-[var(--ev-line)] px-4">{details}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      <motion.div variants={rowReveal} className="mt-6 flex flex-wrap gap-2 border-t border-[var(--ev-line)] pt-5">
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
