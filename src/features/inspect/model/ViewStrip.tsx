import type { FocusResult } from './focusTypes';
import { OUTPUT_LEANS, OUTPUT_RAISED, OUTPUT_STRONG, sigmoid } from './preprocess';

type Views = NonNullable<FocusResult['views']>;
type ViewWord = 'very AI-like' | 'AI-like' | 'raised' | 'camera-like';

const ORDER = { start: 0, center: 1, end: 2 } as const;
const orderedViews = (views: Views): Views => [...views].sort((a, b) => ORDER[a.label] - ORDER[b.label]);

/** Display words for this detector's output, without a calibrated probability claim. */
export function viewWord(logit: number): ViewWord {
  if (!Number.isFinite(logit)) throw new Error('The model produced a non-finite output.');
  const output = sigmoid(logit);
  if (output >= OUTPUT_STRONG) return 'very AI-like';
  if (output >= OUTPUT_LEANS) return 'AI-like';
  if (output >= OUTPUT_RAISED) return 'raised';
  return 'camera-like';
}

/** Names correspond to start, center, end, even when inference returned center first. */
export function viewNames(views: Views): string[] {
  const sorted = orderedViews(views);
  if (sorted.length === 1) return ['Centre crop'];
  const first = sorted[0];
  if (!first) return [];
  const horizontal = sorted.some((view) => view.crop.x !== first.crop.x);
  const vertical = sorted.some((view) => view.crop.y !== first.crop.y);
  const names = horizontal
    ? { start: 'Left', center: 'Middle', end: 'Right' }
    : vertical
      ? { start: 'Top', center: 'Middle', end: 'Bottom' }
      : { start: 'Centre crop', center: 'Centre crop', end: 'Centre crop' };
  return sorted.map((view) => names[view.label]);
}

const COLORS = { 'very AI-like': '#e5383b', 'AI-like': '#ffb000', raised: '#f5c451' } as const;

export function ViewStrip({ views, compact = false }: { views: Views; compact?: boolean }) {
  const sorted = orderedViews(views);
  const names = viewNames(views);
  return (
    <figure className={compact ? 'space-y-2 text-xs' : 'space-y-3 text-sm'}>
      <figcaption className="font-medium text-muted">Detector output by part of the photo</figcaption>
      {sorted.map((view, index) => {
        const word = viewWord(view.logit);
        const position = Math.max(0, Math.min(1, sigmoid(view.logit)));
        const color = word === 'camera-like' ? undefined : COLORS[word];
        return (
          <div key={view.label} title={`raw output ${view.logit.toFixed(2)}`}>
            <p className="text-ink">
              <span className="font-medium">{names[index]}: </span>
              <span className={word === 'camera-like' ? 'text-fit' : undefined}>{word}</span>
            </p>
            {/* Flex weights position the marker without percentage labels or styles. */}
            <div aria-hidden="true" className="mt-1 flex items-center rounded-full bg-line-strong/50" style={{ height: '0.5rem' }}>
              <span className={word === 'camera-like' ? 'bg-fit' : undefined}
                style={{ flexGrow: position, flexBasis: 0, height: '0.25rem', backgroundColor: color }} />
              <span className={`shrink-0 rounded-full ${word === 'camera-like' ? 'bg-fit' : ''}`}
                style={{ width: '0.5rem', height: '0.5rem', backgroundColor: color }} />
              <span style={{ flexGrow: 1 - position, flexBasis: 0 }} />
            </div>
            {(!compact || index === sorted.length - 1) && (
              <p className="mt-1 flex justify-between text-xs text-faint">
                <span>camera-like</span><span>AI-like</span>
              </p>
            )}
          </div>
        );
      })}
    </figure>
  );
}
