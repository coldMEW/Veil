import { useEffect, useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { Feed } from './HeroStory';

/*
 * The home story as a black-and-white picture book: painted frames crossfade as you scroll, the camera
 * pushes in slowly, mist and dust drift, a short caption tells each beat, then her dropped phone fills
 * the screen and its feed takes over. Only this scene is monochrome; the rest of the site keeps its colours.
 */

const FRAMES = ['/story/story-1-calm.webp', '/story/story-2-sees.webp', '/story/story-3-scream.webp'];
const PHONE = '/story/story-4-phone.webp';

const BEATS: Array<{ text: string; from: number; to: number }> = [
  { text: 'A quiet night at home.', from: 0.06, to: 0.17 },
  { text: 'Then a stranger tagged her in a post.', from: 0.19, to: 0.29 },
  { text: 'It was her face. She was never there.', from: 0.31, to: 0.43 },
  { text: 'And it was already everywhere.', from: 0.5, to: 0.6 },
];

/** Slow white dust, like stars over the picture. Canvas, one layer, paused when off screen. */
function Dust() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    let w = 0, h = 0, raf = 0, visible = true;
    const dots = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.4, v: Math.random() * 0.00025 + 0.00008, a: Math.random() * 0.6 + 0.2 }));
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.y -= d.v; d.x += Math.sin(d.y * 20) * 0.00015;
        if (d.y < -0.02) d.y = 1.02;
        ctx.globalAlpha = d.a;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2); ctx.fill();
      }
      if (visible) raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = Boolean(e?.isIntersecting);
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(tick);
    });
    size(); io.observe(c); window.addEventListener('resize', size);
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener('resize', size); };
  }, []);
  return <canvas ref={ref} className="book-dust" aria-hidden="true" />;
}

function Beat({ p, text, from, to }: { p: MotionValue<number>; text: string; from: number; to: number }) {
  const opacity = useTransform(p, [from, from + 0.025, to - 0.025, to], [0, 1, 1, 0]);
  const y = useTransform(p, [from, to], [14, -14]);
  return <motion.p className="book-beat" style={{ opacity, y }}>{text}</motion.p>;
}

function Frame({ p, src, fadeIn, fadeOut, alt, eager }: { p: MotionValue<number>; src: string; fadeIn: [number, number] | null; fadeOut: [number, number] | null; alt: string; eager?: boolean }) {
  const stops: number[] = [];
  const vals: number[] = [];
  if (fadeIn) { stops.push(fadeIn[0], fadeIn[1]); vals.push(0, 1); } else { stops.push(0); vals.push(1); }
  if (fadeOut) { stops.push(fadeOut[0], fadeOut[1]); vals.push(1, 0); } else { stops.push(1); vals.push(1); }
  const opacity = useTransform(p, stops, vals);
  return <motion.img className="book-frame" src={src} alt={alt} style={{ opacity }} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} />;
}

export function HeroBook({ onCheck, onTrace }: { onCheck: () => void; onTrace: () => void }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  const titleOpacity = useTransform(p, [0, 0.07], [1, 0]);
  const titleY = useTransform(p, [0, 0.07], [0, -50]);
  const camera = useTransform(p, [0, 0.46], [1.02, 1.14]);
  const cameraY = useTransform(p, [0, 0.46], ['0%', '-2%']);
  const roomOpacity = useTransform(p, [0.44, 0.5], [1, 0]);
  const shake = useTransform(p, [0.3, 0.32, 0.34, 0.36, 0.38], [0, -8, 8, -5, 0]);
  const phoneIn = useTransform(p, [0.44, 0.5], [0, 1]);
  const phoneScale = useTransform(p, [0.44, 0.5, 0.6, 0.68], [1.25, 1, 1, 3.4]);
  const phoneRot = useTransform(p, [0.44, 0.5], [-14, 0]);
  const phoneFade = useTransform(p, [0.64, 0.68], [1, 0]);
  const screenOpacity = useTransform(p, [0.62, 0.67], [0, 1]);
  const wide = typeof window !== 'undefined' && window.innerWidth > 860;
  const screenX = useTransform(p, [0.88, 0.94], ['0vw', wide ? '20vw' : '0vw']);
  const screenY = useTransform(p, [0.88, 0.94], ['0svh', wide ? '0svh' : '-14svh']);
  const screenEnd = useTransform(p, [0.6, 0.68, 0.88, 0.94], [0.3, 1, 1, wide ? 1 : 0.62]);
  const endOpacity = useTransform(p, [0.92, 0.96], [0, 1]);
  const endY = useTransform(p, [0.92, 0.96], [24, 0]);
  const mistX = useTransform(p, [0, 1], ['0%', '-18%']);

  const copy = (
    <div className="hero-copy">
      <h1>
        It’s not you.
        <br />
        Prove it.
      </h1>
      <p>Veil checks whether a picture of you is a deepfake, finds where your face has been posted, and files the takedown for you.</p>
      <div className="hero-actions">
        <button className="btn btn-lime" onClick={onCheck}>Check an image</button>
        <button className="btn btn-ghost-dark" onClick={onTrace}>Find my face online</button>
      </div>
    </div>
  );

  if (reduce) {
    return (
      <section className="hero book book-static" aria-labelledby="hero-title">
        <div className="hero-stage">
          <img className="book-frame" src={FRAMES[2]} alt="A woman at home screams as her phone falls: she has just seen a deepfake of herself." />
          <div id="hero-title" className="hero-title">{copy}</div>
        </div>
        <div className="hero-static-feed"><Feed p={p} static /></div>
      </section>
    );
  }

  return (
    <section className="hero book" ref={ref} aria-labelledby="hero-title">
      <div className="hero-sticky">
        <div className="hero-stage">
          <motion.div className="book-room" style={{ scale: camera, y: cameraY, opacity: roomOpacity, x: shake }}>
            <Frame p={p} src={FRAMES[0]!} fadeIn={null} fadeOut={[0.17, 0.2]} alt="A woman sits on her sofa at night, reading her phone." eager />
            <Frame p={p} src={FRAMES[1]!} fadeIn={[0.17, 0.2]} fadeOut={[0.29, 0.31]} alt="She freezes, staring at the phone, a hand over her mouth." />
            <Frame p={p} src={FRAMES[2]!} fadeIn={[0.29, 0.31]} fadeOut={null} alt="She screams and the phone falls from her hands." />
          </motion.div>
          <motion.div className="book-mist" style={{ x: mistX }} aria-hidden="true" />
          <motion.div className="book-phone" style={{ opacity: phoneIn, scale: phoneScale, rotate: phoneRot }}>
            <motion.img src={PHONE} alt="Her phone lies on the floor, still glowing." style={{ opacity: phoneFade }} loading="lazy" decoding="async" draggable={false} />
          </motion.div>
          <Dust />
          {BEATS.map((b) => <Beat key={b.text} p={p} {...b} />)}

          <motion.div className="hero-title" id="hero-title" style={{ opacity: titleOpacity, y: titleY }}>
            {copy}
          </motion.div>

          <motion.div className="phone-screen" style={{ scale: screenEnd, opacity: screenOpacity, x: screenX, y: screenY }}>
            <Feed p={p} />
          </motion.div>

          <motion.div className="hero-end" style={{ opacity: endOpacity, y: endY }}>
            <h2>Find it. Take it down.</h2>
            <div className="hero-actions">
              <button className="btn btn-lime" onClick={onCheck}>Check an image</button>
              <button className="btn btn-white" onClick={onTrace}>Find my face online</button>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
