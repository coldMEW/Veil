import { motion } from 'motion/react';
import { ArrowClockwise, Eye, EyeSlash, Play, Scan, StopCircle, WarningCircle } from '@phosphor-icons/react';
import { ResultCard, rowReveal } from '../../../components/ResultCard';
import { MODEL_INFO, type FocusState } from './useModelFocus';

interface ModelFocusCardProps {
  state: FocusState;
  onRun: () => void;
  onCancel: () => void;
  showOverlay: boolean;
  onToggleOverlay: () => void;
}

const ghostButton =
  'inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium transition-[color,border-color,transform] duration-200 hover:border-gold/60 hover:text-gold active:scale-[0.97]';

function Header({ sub }: { sub: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
        <Scan size={18} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-snug">Model-focus map</h3>
        <p className="mt-0.5 text-sm text-faint">{sub}</p>
      </div>
    </div>
  );
}

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

/** The model diagnostic: explicit run, visible progress, cancel, retry, and a result kept apart from physics. */
export function ModelFocusCard({ state, onRun, onCancel, showOverlay, onToggleOverlay }: ModelFocusCardProps) {
  if (state.status === 'done') {
    const t = state.result.timings;
    return (
      <motion.div variants={rowReveal} initial="hidden" animate="show">
        <ResultCard result={state.checkResult} />
        <div className="-mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 pb-4 pl-12">
          <button type="button" onClick={onToggleOverlay} className={ghostButton} aria-pressed={showOverlay}>
            {showOverlay ? <EyeSlash size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
            {showOverlay ? 'Hide on photo' : 'Show on photo'}
          </button>
          <p className="tabular text-xs text-faint">
            Model load {ms(t.loadMs)}, one pass {ms(t.baseMs)}, map {ms(t.occlusionMs)}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.article variants={rowReveal} className="py-4">
      {state.status === 'idle' && (
        <>
          <Header sub="Model diagnostic, not run yet" />
          <div className="pl-12">
            <p className="mt-2 text-sm text-muted text-pretty">
              Where one classifier responds inside the part of the photo it sees. Context only, never a verdict.
            </p>
            <button type="button" onClick={onRun} className={`${ghostButton} mt-3`}>
              <Play size={16} weight="fill" aria-hidden />
              Run model-focus map
            </button>
            <p className="mt-2 text-xs text-faint">
              Downloads a {(MODEL_INFO.bytes / 1e6).toFixed(0)} MB model once, then runs on this device. Nothing is uploaded.
            </p>
          </div>
        </>
      )}

      {(state.status === 'loading' || state.status === 'running') && (
        <>
          <Header sub={state.status === 'loading' ? 'Loading the model…' : `Measuring ${state.done} of ${state.total}`} />
          <div className="pl-12" role="status" aria-live="polite">
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised">
              <motion.div
                className="h-full origin-left rounded-full bg-gold"
                initial={false}
                animate={{ scaleX: state.status === 'running' ? state.done / state.total : 0.04 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <button type="button" onClick={onCancel} className={`${ghostButton} mt-3`}>
              <StopCircle size={16} aria-hidden />
              Cancel
            </button>
          </div>
        </>
      )}

      {state.status === 'failed' && (
        <>
          <Header sub="Model diagnostic, failed" />
          <div className="pl-12" role="alert">
            <p className="mt-2 flex items-start gap-1.5 text-sm text-danger">
              <WarningCircle size={16} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
              {state.message}
            </p>
            <p className="mt-1 text-sm text-muted">Nothing was concluded from this check.</p>
            <button type="button" onClick={onRun} className={`${ghostButton} mt-3`}>
              <ArrowClockwise size={16} aria-hidden />
              Try again
            </button>
          </div>
        </>
      )}
    </motion.article>
  );
}
