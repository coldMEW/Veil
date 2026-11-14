import { useEffect, useRef, type ReactNode } from 'react';
import { animate, stagger } from 'animejs';

export function MotionEntrance({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !ref.current) return;
    const items = ref.current.querySelectorAll('[data-enter]');
    const animation = animate(items, { opacity: [0, 1], translateY: [14, 0], delay: stagger(70), duration: 520, ease: 'outExpo' });
    return () => { animation.cancel(); };
  }, []);
  return <div ref={ref}>{children}</div>;
}
