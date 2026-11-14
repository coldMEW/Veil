import { motion } from 'motion/react';
import { ArrowClockwise, Eye, EyeSlash, Selection, SmileyWink, StopCircle, WarningCircle, X } from '@phosphor-icons/react';
import { ResultCard, rowReveal } from '../../components/ResultCard';
import type { WarpState } from '../../features/inspect/warp/useWarpDetector';
import { HIGH, LOW } from '../../features/inspect/warp/preprocess';

const ghost =
  'inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium transition-[color,border-color,transform] duration-200 hover:border-gold/60 hover:text-gold active:scale-[0.97]';

interface Props {
  state: WarpState;
  marking: boolean;
  onMark: () => void;
  onStopMarking: () => void;
  onRetry: () => void;
  onCancel: () => void;
  showOverlay: boolean;
  onToggleOverlay: () => void;
}

function Header({ sub }: { sub: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
        <SmileyWink size={18} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-snug">Face warp map</h3>
        <p className="mt-0.5 text-sm text-faint">{sub}</p>
      </div>
    </div>
  );
}

/** Colour key for the overlay. Thresholds are display choices, not probabilities. */
export function WarpLegend() {
  return (
    <div className="mt-3 rounded-xl bg-raised p-3 text-xs text-muted" aria-label="Colour key">
      <div className="h-2.5 rounded-full" style={{ background: 'linear-gradient(90deg, transparent 0%, #ffd43b 30%, #ff9f1c 65%, #e5383b 100%)' }} />
      <div className="mt-1.5 flex justify-between tabular">
        <span>No colour: under {LOW} px</span>
        <span className="text-[#a16207]">Yellow</span>
        <span className="text-[#b91c1c]">Red: {HIGH} px or more</span>
      </div>
      <p className="mt-1.5">Predicted warp: how far the model thinks each part of the face was pushed or pulled.</p>
    </div>
  );
}

/** Model diagnostic: where a face looks reshaped by a Liquify-style warp. Never a verdict. */
export function FaceWarpCard({ state, marking, onMark, onStopMarking, onRetry, onCancel, showOverlay, onToggleOverlay }: Props) {
  if (state.status === 'done' && !marking) {
    const t = state.result.timings;
    return (
      <motion.div variants={rowReveal} initial="hidden" animate="show">
        <ResultCard result={state.checkResult} />
        <div className="-mt-1 pb-4 pl-12">
          {showOverlay && <WarpLegend />}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={onToggleOverlay} className={ghost} aria-pressed={showOverlay}>
              {showOverlay ? <EyeSlash size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              {showOverlay ? 'Hide on photo' : 'Show on photo'}
            </button>
            <button type="button" onClick={onMark} className={ghost}>
              <Selection size={16} aria-hidden />
              Mark another face
            </button>
          </div>
          <p className="tabular mt-2 text-xs text-faint">
            {state.result.backend === 'webgpu' ? 'GPU' : 'CPU'}: model {Math.round(t.loadMs)} ms, inference {Math.round(t.inferenceMs)} ms
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.article variants={rowReveal} className="py-4">
      {marking ? (
        <>
          <Header sub="Model diagnostic, marking the face" />
          <div className="pl-12">
            <p className="mt-2 rounded-xl bg-gold-soft px-3 py-2 text-sm text-ink" role="status" aria-live="polite">
              Drag a tight box over the face: eyebrows to chin, ear to ear. Veil widens it to the crop the model was trained on.
            </p>
            <button type="button" onClick={onStopMarking} className={`${ghost} mt-3`}>
              <X size={16} aria-hidden />
              Cancel
            </button>
          </div>
        </>
      ) : state.status === 'loading' || state.status === 'running' ? (
        <>
          <Header sub={state.status === 'loading' ? 'Loading the model…' : 'Measuring the face…'} />
          <div className="pl-12" role="status" aria-live="polite">
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised">
              <motion.div
                className="h-full origin-left rounded-full bg-gold"
                initial={{ scaleX: 0.05 }}
                animate={{ scaleX: state.status === 'running' ? 0.7 : 0.3 }}
                transition={{ duration: 0.6 }}
              />
            </div>
            <button type="button" onClick={onCancel} className={`${ghost} mt-3`}>
              <StopCircle size={16} aria-hidden />
              Cancel
            </button>
          </div>
        </>
      ) : state.status === 'failed' ? (
        <>
          <Header sub="Model diagnostic, failed" />
          <div className="pl-12" role="alert">
            <p className="mt-2 flex items-start gap-1.5 text-sm text-danger">
              <WarningCircle size={16} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
              {state.message}
            </p>
            <p className="mt-1 text-sm text-muted">Nothing was concluded from this check.</p>
            <button type="button" onClick={onRetry} className={`${ghost} mt-3`}>
              <ArrowClockwise size={16} aria-hidden />
              Try again
            </button>
          </div>
        </>
      ) : (
        <>
          <Header sub="Model diagnostic, not run yet" />
          <div className="pl-12">
            <p className="mt-2 text-sm text-muted text-pretty">
              Shows where a face looks pushed or pulled, as Photoshop’s Face-Aware Liquify does. Red marks the strongest
              predicted warp, yellow weaker. It does not detect other edits or AI generation.
            </p>
            <button type="button" onClick={onMark} className={`${ghost} mt-3`}>
              <Selection size={16} aria-hidden />
              Mark the face
            </button>
          </div>
        </>
      )}
    </motion.article>
  );
}
