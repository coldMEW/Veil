import { motion } from 'motion/react';
import { ArrowCounterClockwise, Check, Crosshair, Sun, Trash } from '@phosphor-icons/react';
import { ResultCard, rowReveal } from '../../../../components/ResultCard';
import type { CheckResult as CardResult, Overlay as CardOverlay } from '../../../../contracts';
import { explainShadowResult } from './shadowExplain';
import { explainReflectionResult } from './reflectionExplain';
import type { GeometryMode } from './lineGeometryCheck';
import type { CheckResult } from './shadowTypes';
import { MIN_PAIRS, type ShadowAnnotation } from './useShadowAnnotation';

const ghostButton =
  'inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium transition-[color,border-color,transform] duration-200 hover:border-gold/60 hover:text-gold active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40';

/** The shell's draft card contract has no rays or reason field yet; adapt without dropping meaning. */
function toCard(result: CheckResult, mode: GeometryMode): CardResult {
  const overlays: CardOverlay[] = [];
  for (const o of result.overlays) {
    if (o.type === 'points' || o.type === 'lines' || o.type === 'box') overlays.push(o);
    else if (o.type === 'rays') overlays.push({ type: 'lines', lines: o.rays, label: o.label });
  }
  // Plain-language text for people; the technical result stays intact in `evidence` for the report.
  const plain = mode === 'reflection' ? explainReflectionResult(result) : explainShadowResult(result);
  return {
    ...result,
    title: mode === 'reflection' ? 'Reflection geometry' : 'Shadow and light geometry',
    observation: `${plain.headline} ${plain.observation}`,
    method: plain.method,
    assumptions: plain.assumptions,
    limitations: plain.unknowns.length ? plain.unknowns : result.limitations,
    overlays,
  };
}

function Header({ sub, mode }: { sub: string; mode: GeometryMode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
        <Sun size={18} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-snug">{mode === 'reflection' ? 'Reflection geometry' : 'Shadow and light geometry'}</h3>
        <p className="mt-0.5 text-sm text-faint">{sub}</p>
      </div>
    </div>
  );
}

/** Physical check: the person marks object and shadow points; the lines are tested against one light. */
export function ShadowCard({ a, mode = 'shadow' }: { a: ShadowAnnotation; mode?: GeometryMode }) {
  const count = a.pairs.length;
  const step = mode === 'reflection'
    ? (a.pending ? 'Now tap its reflection in the mirror or water.' : 'Tap an object point, such as the corner of a window.')
    : (a.pending ? 'Now tap where that point’s shadow falls.' : 'Tap a point on an object, such as the top of a pole.');

  return (
    <motion.article variants={rowReveal} className="py-4">
      {!a.marking && count === 0 ? (
        <>
          <Header sub="Physical, not run yet" mode={mode} />
          <div className="pl-12">
            <p className="mt-2 text-sm text-muted text-pretty">
              {mode === 'reflection'
                ? 'Mark at least 3 points and where each one appears in the mirror or water. With one flat mirror, the lines should meet at one place.'
                : <>Mark at least {MIN_PAIRS} objects and where their shadows fall. Under one light, the lines should meet at
                  one place.</>}
            </p>
            <button type="button" onClick={() => a.setMarking(true)} className={`${ghostButton} mt-3`}>
              <Crosshair size={16} aria-hidden />
              Start marking
            </button>
          </div>
        </>
      ) : (
        <>
          {a.result ? (
            <ResultCard result={toCard(a.result, mode)} />
          ) : (
            <Header sub="Physical, marking" mode={mode} />
          )}
          <div className="pl-12">
            {a.marking && (
              <p className="mt-1 rounded-xl bg-gold-soft px-3 py-2 text-sm text-ink" role="status" aria-live="polite">
                <span className="tabular font-medium">
                  {count} pair{count === 1 ? '' : 's'}
                  {count < MIN_PAIRS ? ` of ${MIN_PAIRS} needed` : ''}.
                </span>{' '}
                {step}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {a.marking ? (
                <button type="button" onClick={() => a.setMarking(false)} className={ghostButton}>
                  <Check size={16} weight="bold" aria-hidden />
                  Done marking
                </button>
              ) : (
                <button type="button" onClick={() => a.setMarking(true)} className={ghostButton}>
                  <Crosshair size={16} aria-hidden />
                  Mark more
                </button>
              )}
              <button type="button" onClick={a.undo} disabled={count === 0 && !a.pending} className={ghostButton}>
                <ArrowCounterClockwise size={16} aria-hidden />
                Undo
              </button>
              <button type="button" onClick={a.clear} disabled={count === 0 && !a.pending} className={ghostButton}>
                <Trash size={16} aria-hidden />
                Clear
              </button>
            </div>
          </div>
        </>
      )}
    </motion.article>
  );
}
