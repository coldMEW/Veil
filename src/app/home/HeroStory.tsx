import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { FacePortrait, Woman } from './Woman';

const VB_X = 80; // the viewBox is centred on her (x = 880), so a phone crop keeps her in frame
const VB_W = 1600;
const VB_H = 1000;
const PHONE_FLOOR = { x: 1018, y: 914 };

const FAKES = [
  { user: 'hot.leaks.daily', caption: 'guess who got caught', bg: '#2e2e2e', outfit: '#ff5a45', accent: '#4a4a4a', tag: 'Face swap' },
  { user: 'cryptowins_now', caption: '"I made $40k with this app"', bg: '#3a3a3a', outfit: '#d4f36b', tag: 'AI-made ad' },
  { user: 'anon_uploads', caption: 'more in my bio', bg: '#262626', outfit: '#7cc4ff', accent: '#555', tag: 'Face swap' },
];

function useOrigin(stage: React.RefObject<HTMLDivElement | null>, wrap: React.RefObject<HTMLDivElement | null>) {
  const [o, setO] = useState({ x: 0, y: 0, W: 1, H: 1, dx: 0, dy: 0 });
  useLayoutEffect(() => {
    const st = stage.current;
    const el = wrap.current;
    if (!st || !el) return;
    const measure = () => {
      // offset* sizes ignore the zoom transform, so this is the scene's resting geometry.
      const W = el.offsetWidth;
      const H = el.offsetHeight;
      const s = Math.max(W / VB_W, H / VB_H);
      const x = (W - VB_W * s) / 2 + (PHONE_FLOOR.x - VB_X) * s;
      const y = (H - VB_H * s) / 2 + PHONE_FLOOR.y * s;
      setO({ x, y, W: st.offsetWidth, H: st.offsetHeight, dx: st.offsetWidth / 2 - x, dy: st.offsetHeight / 2 - el.offsetTop - y });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(st);
    return () => ro.disconnect();
  }, [stage, wrap]);
  return o;
}

function Room() {
  return (
    <>
      <rect x="0" y="0" width="1800" height="1000" fill="#262626" />
      {/* window with the city at night */}
      <rect x="150" y="150" width="420" height="470" fill="#111" />
      <rect x="166" y="166" width="388" height="438" fill="#1a1a1a" />
      <circle cx="470" cy="250" r="34" fill="#5c5c5c" />
      <path d="M166 604 L166 470 L214 470 L214 420 L262 420 L262 500 L300 500 L300 380 L360 380 L360 460 L404 460 L404 520 L450 520 L450 430 L506 430 L506 490 L554 490 L554 604 Z" fill="#202020" />
      {[[228, 440], [244, 470], [318, 400], [334, 430], [318, 460], [470, 450], [486, 470], [420, 540]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="8" height="12" fill={x === 334 ? '#d4f36b' : '#4a4a4a'} />
      ))}
      <rect x="356" y="166" width="8" height="438" fill="#111" />
      <rect x="166" y="380" width="388" height="8" fill="#111" />
      <rect x="140" y="614" width="440" height="16" fill="#151515" />
      {/* picture on the wall */}
      <rect x="1180" y="230" width="230" height="170" fill="#151515" />
      <rect x="1194" y="244" width="202" height="142" fill="#333" />
      <path d="M1194 386 L1254 300 L1300 352 L1334 318 L1396 386 Z" fill="#454545" />
      {/* floor */}
      <rect x="0" y="830" width="1800" height="170" fill="#1b1b1b" />
      <rect x="0" y="822" width="1800" height="10" fill="#303030" />
      <ellipse cx="880" cy="900" rx="420" ry="40" fill="#222" />
      {/* lamp */}
      <polygon points="1430,330 1330,830 1640,830" fill="#ffffff" opacity="0.035" />
      <rect x="1428" y="330" width="8" height="500" fill="#151515" />
      <rect x="1392" y="822" width="80" height="12" rx="4" fill="#151515" />
      <path d="M1380 270 L1484 270 L1508 340 L1356 340 Z" fill="#5a5a5a" />
      {/* sofa */}
      <rect x="590" y="520" width="600" height="190" rx="28" fill="#3d3d3d" />
      <rect x="610" y="640" width="560" height="110" rx="14" fill="#474747" />
      <rect x="560" y="600" width="84" height="190" rx="22" fill="#363636" />
      <rect x="1136" y="600" width="84" height="190" rx="22" fill="#363636" />
      <rect x="590" y="786" width="14" height="40" fill="#151515" />
      <rect x="1176" y="786" width="14" height="40" fill="#151515" />
      <rect x="1010" y="560" width="120" height="96" rx="18" fill="#525252" />
      {/* side table and mug */}
      <rect x="1250" y="690" width="120" height="14" fill="#151515" />
      <rect x="1302" y="704" width="14" height="126" fill="#151515" />
      <rect x="1282" y="660" width="30" height="30" rx="4" fill="#5a5a5a" />
    </>
  );
}

function Phone({ p }: { p: MotionValue<number> }) {
  const x = useTransform(p, [0.3, 0.42, 0.46], [880, 980, PHONE_FLOOR.x]);
  const y = useTransform(p, [0.3, 0.36, 0.42, 0.44, 0.46], [548, 500, PHONE_FLOOR.y, PHONE_FLOOR.y - 14, PHONE_FLOOR.y]);
  const rotate = useTransform(p, [0.3, 0.44], [-12, 354]);
  const screen = useTransform(p, [0.12, 0.18], ['#e9f7c9', '#ff5a45']);
  return (
    <motion.g style={{ x, y, rotate }}>
      <rect x="-18" y="-32" width="36" height="64" rx="6" fill="#0d0d0d" />
      <motion.rect x="-14" y="-27" width="28" height="54" rx="3" style={{ fill: screen }} />
    </motion.g>
  );
}

function Stamp({ p, at, children }: { p: MotionValue<number>; at: number; children: ReactNode }) {
  const opacity = useTransform(p, [at, at + 0.015], [0, 1]);
  const scale = useTransform(p, [at, at + 0.02], [1.4, 1]);
  return (
    <motion.div className="stamp" style={{ opacity, scale }}>
      {children}
    </motion.div>
  );
}

function Feed({ p, static: isStatic }: { p: MotionValue<number>; static?: boolean }) {
  const scroll = useTransform(p, [0.66, 0.82], ['0%', '-58%']);
  const scan = useTransform(p, [0.82, 0.9], ['-10%', '110%']);
  const done = useTransform(p, [0.9, 0.93], [0, 1]);
  return (
    <div className="feed" aria-hidden="true">
      <div className="feed-top">
        <span>Following</span>
        <span className="feed-top-strong">For you</span>
      </div>
      <motion.div className="feed-list" style={isStatic ? undefined : { y: scroll }}>
        {FAKES.map((f, i) => (
          <article key={f.user} className="post">
            <header>
              <span className="post-avatar" />
              <strong>{f.user}</strong>
            </header>
            <div className="post-media">
              <FacePortrait bg={f.bg} outfit={f.outfit} accent={f.accent} />
              {isStatic ? (
                <div className="stamp">Deepfake · ticket filed</div>
              ) : (
                <Stamp p={p} at={0.83 + i * 0.025}>
                  {f.tag} · ticket filed
                </Stamp>
              )}
            </div>
            <p className="post-caption">
              <strong>{f.user}</strong> {f.caption}
            </p>
          </article>
        ))}
      </motion.div>
      {!isStatic && <motion.div className="feed-scan" style={{ top: scan }} />}
      <motion.div className="feed-done" style={isStatic ? undefined : { opacity: done }}>
        <strong className="num">3 fakes found</strong>
        <span>3 takedown tickets opened</span>
      </motion.div>
    </div>
  );
}

export function HeroStory({ onCheck, onTrace }: { onCheck: () => void; onTrace: () => void }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const origin = useOrigin(stage, wrap);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  const titleOpacity = useTransform(p, [0, 0.1], [1, 0]);
  const titleY = useTransform(p, [0, 0.1], [0, -40]);
  const notify = useTransform(p, [0.1, 0.13, 0.28, 0.31], [0, 1, 1, 0]);
  const notifyY = useTransform(p, [0.1, 0.13], [16, 0]);
  const scream = useTransform(p, [0.18, 0.32], [0, 1]);
  const sceneScale = useTransform(p, [0.48, 0.66], [1, 7]);
  const sceneX = useTransform(p, [0.48, 0.66], [0, origin.dx]);
  const sceneY = useTransform(p, [0.48, 0.66], [0, origin.dy]);
  const narrow = origin.W < 860;
  const phoneX = useTransform(p, [0.88, 0.94], ['0vw', narrow ? '0vw' : '20vw']);
  const phoneY = useTransform(p, [0.88, 0.94], ['0svh', narrow ? '-14svh' : '0svh']);
  const phoneEnd = useTransform(p, [0.56, 0.66, 0.88, 0.94], [0.25, 1, 1, narrow ? 0.62 : 1]);
  const sceneOpacity = useTransform(p, [0.58, 0.66], [1, 0]);
  const phoneOpacity = useTransform(p, [0.56, 0.6], [0, 1]);
  const ctaOpacity = useTransform(p, [0.92, 0.96], [0, 1]);
  const ctaY = useTransform(p, [0.92, 0.96], [24, 0]);
  const shake = useTransform(p, [0.22, 0.24, 0.26, 0.28, 0.3], [0, -6, 6, -4, 0]);

  const title = (
    <div className="hero-copy">
      <h1>
        It’s not you.
        <br />
        Prove it.
      </h1>
      <p>Veil checks whether a picture of you is a deepfake, finds where your face has been posted, and files the takedown for you.</p>
      <div className="hero-actions">
        <button className="btn btn-lime" onClick={onCheck}>
          Check an image
        </button>
        <button className="btn btn-ghost-dark" onClick={onTrace}>
          Find my face online
        </button>
      </div>
    </div>
  );

  if (reduce) {
    return (
      <section className="hero hero-static" aria-labelledby="hero-title">
        <div className="hero-stage" ref={stage}>
          <svg className="scene" viewBox={`${VB_X} 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <Room />
            <Woman scream={useTransform(p, () => 1)} />
          </svg>
          <div id="hero-title">{title}</div>
        </div>
        <div className="hero-static-feed">
          <Feed p={p} static />
        </div>
      </section>
    );
  }

  return (
    <section className="hero" ref={ref} aria-labelledby="hero-title">
      <div className="hero-sticky">
        <div className="hero-stage" ref={stage}>
          <motion.div className="scene-wrap" ref={wrap} style={{ scale: sceneScale, opacity: sceneOpacity, transformOrigin: `${origin.x}px ${origin.y}px`, x: sceneX, y: sceneY }}>
            <motion.div className="scene-shake" style={{ x: shake }}>
            <svg className="scene" viewBox={`${VB_X} 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label="A woman at home looks at her phone, sees a deepfake of herself, screams and drops the phone.">
              <Room />
              <Woman scream={scream} />
              <Phone p={p} />
            </svg>
            </motion.div>
            <motion.div className="notify" style={{ opacity: notify, y: notifyY }} aria-hidden="true">
              <strong>hot.leaks.daily</strong> tagged you in a post
            </motion.div>
          </motion.div>

          <motion.div className="hero-title" id="hero-title" style={{ opacity: titleOpacity, y: titleY }}>
            {title}
          </motion.div>

          <motion.div className="phone-screen" style={{ scale: phoneEnd, opacity: phoneOpacity, x: phoneX, y: phoneY }}>
            <Feed p={p} />
          </motion.div>

          <motion.div className="hero-end" style={{ opacity: ctaOpacity, y: ctaY }}>
            <h2>Find it. Take it down.</h2>
            <div className="hero-actions">
              <button className="btn btn-lime" onClick={onCheck}>
                Check an image
              </button>
              <button className="btn btn-white" onClick={onTrace}>
                Find my face online
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
