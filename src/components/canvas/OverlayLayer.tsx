import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import type { Rect } from './Viewfinder';
import type { EvidenceItem } from '../../app/results/evidence';

interface Props {
  items: EvidenceItem[];
  /** Where the photo is drawn inside the canvas well, in CSS pixels. */
  photo: Rect | null;
  selected: string | null;
  onSelect: (id: string) => void;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The areas each check looked at, drawn on the photo and keyed by the row number.
 * Every outline is a real, focusable control: selecting one opens its evidence row, and the reverse.
 */
export function OverlayLayer({ items, photo, selected, onSelect }: Props) {
  if (!photo || photo.w < 1) return null;
  const placed = items.filter((i) => i.region);
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-label="Areas each check looked at">
      {placed.map((item) => {
        // Checks that looked at the whole photo share one frame; their number badges sit side by side.
        const wholeIndex = placed.filter((p) => isWhole(p)).indexOf(item);
        return (
          <Mark key={item.id} item={item} photo={photo} badgeOffset={Math.max(0, wholeIndex) * 30} active={selected === item.id} dim={selected !== null && selected !== item.id} onSelect={onSelect} />
        );
      })}
    </div>
  );
}

const isWhole = (i: EvidenceItem) => !!i.region && i.region.w > 0.98 && i.region.h > 0.98;

function Mark({ item, photo, active, dim, onSelect, badgeOffset }: { item: EvidenceItem; photo: Rect; active: boolean; dim: boolean; onSelect: (id: string) => void; badgeOffset: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const r = item.region!;
  // A whole-image region sits just inside the photo edge so its outline stays visible.
  const whole = r.w > 0.98 && r.h > 0.98;
  const inset = whole ? 6 : 0;
  const style = {
    left: photo.x + r.x * photo.w + inset,
    top: photo.y + r.y * photo.h + inset,
    width: Math.max(16, r.w * photo.w - inset * 2),
    height: Math.max(16, r.h * photo.h - inset * 2),
  };

  useEffect(() => {
    if (!active || !ref.current || reduced()) return;
    const a = animate(ref.current, { scale: [0.985, 1], duration: 240, ease: 'outExpo' });
    return () => void a.cancel();
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      data-testid="overlay"
      data-check-id={item.id}
      data-selected={active ? 'true' : 'false'}
      aria-pressed={active}
      aria-label={`${item.number}. ${item.title}: ${item.regionLabel.toLowerCase()}`}
      onClick={() => onSelect(item.id)}
      className={[
        'pointer-events-auto absolute rounded-[10px] transition-[opacity,box-shadow,background-color] duration-200',
        active
          ? 'bg-[rgb(43_68_214/0.08)] shadow-[0_0_0_2.5px_var(--overlay),0_0_0_6px_rgb(255_255_255/0.55)]'
          : 'shadow-[0_0_0_1.5px_rgb(255_255_255/0.9),0_0_0_3px_rgb(43_68_214/0.55)] hover:bg-[rgb(43_68_214/0.06)]',
        dim ? 'opacity-35' : 'opacity-100',
      ].join(' ')}
      style={style}
    >
      <span
        aria-hidden
        className={[
          'tabular absolute top-2 inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-full px-1.5 text-xs font-bold shadow-sm',
          active ? 'z-10 bg-[var(--overlay)] text-white' : 'bg-white text-[var(--overlay)]',
        ].join(' ')}
        style={{ left: 8 + badgeOffset }}
      >
        {item.number}
        {active && <span className="pr-1 font-semibold">{item.regionLabel}</span>}
      </span>
    </button>
  );
}
