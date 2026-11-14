import { useEffect, useRef, type ReactNode } from 'react';
import { animate, stagger } from 'animejs/animation';

export function MotionEntrance({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !ref.current) return;
    const items = ref.current.querySelectorAll('[data-enter]');
    const animation = animate(items, { opacity: [0, 1], translateY: [8, 0], delay: stagger(40), duration: 180, ease: 'outQuad' });
    return () => animation.cancel();
  }, []);
  return <div ref={ref}>{children}</div>;
}
