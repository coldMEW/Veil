import { useEffect, useRef } from 'react';
import { animate } from 'animejs';

/**
 * Empty-screen illustration: real public-domain photos floating in 3D, each marked the way Veil marks
 * a photo. Both faces are StyleGAN images (machine-generated, public domain), so the AI label is true.
 * Sources and licences: /hero/credits.json.
 */
interface Card {
  src: string;
  alt: string;
  w: number;
  h: number;
  x: string;
  y: string;
  z: number;
  r: number;
  tag: { text: string; tone: 'alert' | 'clean' | 'clear' | 'info' };
  box?: { x: number; y: number; w: number; h: number };
  phone?: boolean;
}

const CARDS: Card[] = [
  { src: '/hero/street.webp', alt: 'A street of colourful houses', w: 300, h: 200, x: '4%', y: '6%', z: -120, r: -7, tag: { text: 'Shadows fit one light', tone: 'clear' }, phone: true },
  { src: '/hero/face-a.webp', alt: 'A face made by an image generator', w: 210, h: 210, x: '52%', y: '0%', z: 40, r: 6, tag: { text: 'AI signal: look closer', tone: 'alert' }, box: { x: 0.18, y: 0.16, w: 0.64, h: 0.72 }, phone: true },
  { src: '/hero/plate.webp', alt: 'A car number plate', w: 280, h: 89, x: '10%', y: '52%', z: 80, r: -3, tag: { text: 'Plate removed', tone: 'clean' }, box: { x: 0.22, y: 0.25, w: 0.7, h: 0.55 }, phone: true },
  { src: '/hero/door.webp', alt: 'A white house front with a name sign by the door', w: 170, h: 227, x: '64%', y: '46%', z: -40, r: 5, tag: { text: 'Private text found', tone: 'info' }, box: { x: 0.53, y: 0.7, w: 0.2, h: 0.06 } },
  { src: '/hero/face-b.webp', alt: 'A second face made by an image generator', w: 150, h: 150, x: '36%', y: '70%', z: -160, r: -9, tag: { text: 'No Content Credentials', tone: 'info' } },
];

const TAG: Record<Card['tag']['tone'], string> = {
  alert: 'bg-[#ff5a3c] text-white',
  clean: 'bg-[#10b39a] text-white',
  clear: 'bg-[#2fbf5b] text-white',
  info: 'bg-white/90 text-ink',
};
const BOX: Record<Card['tag']['tone'], string> = {
  alert: 'shadow-[0_0_0_2.5px_#ff5a3c]',
  clean: 'shadow-[0_0_0_2.5px_#10b39a] bg-[#10b39a]/85',
  clear: 'shadow-[0_0_0_2.5px_#2fbf5b]',
  info: 'shadow-[0_0_0_2.5px_#ffd23f]',
};

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function HeroStage({ compact = false }: { compact?: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced() || !stage.current || !world.current) return;
    const floats = Array.from(stage.current.querySelectorAll<HTMLElement>('[data-float]')).map((el, i) =>
      animate(el, {
        translateY: [0, i % 2 ? -14 : 12, 0],
        rotate: [0, i % 2 ? 1.2 : -1.2, 0],
        duration: 5200 + i * 700,
        loop: true,
        ease: 'inOutSine',
        delay: i * -900,
      }),
    );
    const enter = animate(stage.current.querySelectorAll('[data-card]'), {
      opacity: [0, 1],
      scale: [0.9, 1],
      duration: 900,
      delay: (_: unknown, i: number) => 120 + i * 90,
      ease: 'outExpo',
    });
    // Pointer parallax: the whole set tilts a little toward the pointer (fine pointers only).
    const el = stage.current;
    const w = world.current;
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const onMove = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      const px = (e.clientX - b.left) / b.width - 0.5;
      const py = (e.clientY - b.top) / b.height - 0.5;
      animate(w, { rotateY: -14 + px * 10, rotateX: 10 - py * 8, duration: 700, ease: 'outQuart' });
    };
    if (fine) window.addEventListener('pointermove', onMove);
    return () => {
      floats.forEach((a) => a.cancel());
      enter.cancel();
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  const cards = compact ? CARDS.filter((c) => c.phone) : CARDS;
  return (
    <div
      ref={stage}
      aria-hidden
      className={`relative w-full select-none overflow-hidden rounded-[28px] bg-[#2b44d6] ${compact ? 'h-[260px]' : 'h-full min-h-[520px]'}`}
      style={{ perspective: '1100px' }}
    >
      {/* Colour field: two soft lights from the subject's palette, not decoration over content. */}
      <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#7a5cff] opacity-70 blur-[90px]" />
      <div className="absolute -bottom-32 -right-20 size-[460px] rounded-full bg-[#10b39a] opacity-60 blur-[100px]" />
      <div className="absolute bottom-10 left-1/3 size-[260px] rounded-full bg-[#ff7a59] opacity-40 blur-[90px]" />
      <div
        ref={world}
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d', transform: 'rotateY(-14deg) rotateX(10deg)' }}
      >
        {cards.map((c, i) => {
          const scale = compact ? 0.62 : 1;
          return (
            <div
              key={c.src}
              data-card
              className="absolute"
              style={{
                left: compact ? ['2%', '50%', '18%'][i] : c.x,
                top: compact ? ['6%', '4%', '58%'][i] : c.y,
                transform: `translateZ(${c.z}px) rotate(${c.r}deg)`,
                transformStyle: 'preserve-3d',
              }}
            >
              <figure
                data-float
                className="relative overflow-hidden rounded-[14px] bg-white p-1.5 shadow-[0_30px_60px_-20px_rgb(10_14_60/0.55),0_8px_18px_-8px_rgb(10_14_60/0.35)]"
                style={{ width: c.w * scale + 12 }}
              >
                <div className="relative overflow-hidden rounded-[9px]" style={{ height: c.h * scale }}>
                  <img src={c.src} alt={c.alt} width={c.w} height={c.h} draggable={false} className="size-full object-cover" decoding="async" />
                  {c.box && (
                    <span
                      className={`absolute rounded-[6px] ${BOX[c.tag.tone]}`}
                      style={{ left: `${c.box.x * 100}%`, top: `${c.box.y * 100}%`, width: `${c.box.w * 100}%`, height: `${c.box.h * 100}%` }}
                    />
                  )}
                </div>
                <figcaption
                  className={`absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-md backdrop-blur ${TAG[c.tag.tone]}`}
                >
                  {c.tag.text}
                </figcaption>
              </figure>
            </div>
          );
        })}
      </div>
      <p className="absolute bottom-3 right-4 text-[10px] text-white/70">Faces: StyleGAN, public domain. Photos: CC0.</p>
    </div>
  );
}
