import { motion, useReducedMotion } from 'motion/react';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ViewfinderProps {
  rect: Rect | null;
  tone: 'gold' | 'muted' | 'danger';
  /** Gentle idle breathing while waiting for a photo. Off under reduced motion. */
  breathing?: boolean;
  /** Distance the brackets sit outside the rect. */
  gap?: number;
}

const SIZE = 22;
const TONE = { gold: 'text-gold', muted: 'text-faint', danger: 'text-danger' } as const;
const SPRING = { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 } as const;

/**
 * Veil's signature: four camera-viewfinder brackets. They frame the drop area,
 * tighten on drag, and glide to the exact bounds of a photo once it opens.
 */
export function Viewfinder({ rect, tone, breathing = false, gap = 0 }: ViewfinderProps) {
  const reduce = useReducedMotion();
  if (!rect || rect.w <= 0 || rect.h <= 0) return null;

  const left = rect.x - gap;
  const top = rect.y - gap;
  const right = rect.x + rect.w + gap - SIZE;
  const bottom = rect.y + rect.h + gap - SIZE;
  const corners = [
    { key: 'tl', x: left, y: top, rotate: 0 },
    { key: 'tr', x: right, y: top, rotate: 90 },
    { key: 'br', x: right, y: bottom, rotate: 180 },
    { key: 'bl', x: left, y: bottom, rotate: 270 },
  ];

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ transformOrigin: `${rect.x + rect.w / 2}px ${rect.y + rect.h / 2}px` }}
      animate={breathing && !reduce ? { scale: [1, 0.988, 1] } : { scale: 1 }}
      transition={breathing && !reduce ? { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
    >
      {corners.map((c) => (
        <motion.span
          key={c.key}
          className={`absolute left-0 top-0 block transition-colors duration-300 ${TONE[tone]}`}
          style={{ width: SIZE, height: SIZE }}
          initial={false}
          animate={{ x: c.x, y: c.y }}
          transition={SPRING}
        >
          {/* One rounded L, rotated per corner. */}
          <svg viewBox="0 0 22 22" width={SIZE} height={SIZE} style={{ transform: `rotate(${c.rotate}deg)` }}>
            <path d="M1 21V10a9 9 0 0 1 9-9h11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </motion.span>
      ))}
    </motion.div>
  );
}
