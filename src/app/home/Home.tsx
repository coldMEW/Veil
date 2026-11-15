import { useEffect, useRef, useState } from 'react';
import { HeroBook } from './HeroBook';
import { CheckChapter, TraceChapter, TakedownChapter, ShieldChapter, RulesChapter, Faq, Closing, Footer } from './Chapters';
import { navigate, href } from '../router';
import { openImageFile } from '../../lib/runtime/imageSession';
import './home.css';

const SECTIONS = [
  { id: 'check', label: 'Check', colour: 'lime' },
  { id: 'trace', label: 'Find my face', colour: 'sky' },
  { id: 'takedown', label: 'Take it down', colour: 'alarm' },
  { id: 'shield', label: 'Shield', colour: 'paper' },
  { id: 'questions', label: 'Questions', colour: 'char' },
];

export function Home() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [solid, setSolid] = useState(false);
  // The bar turns solid once the story is behind you, and marks the chapter you are reading.
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const ids = SECTIONS.map((s) => s.id);
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-45% 0px -50% 0px' },
    );
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    const hero = document.querySelector('.hero');
    const heroIo = new IntersectionObserver(([e]) => e?.isIntersecting && e.intersectionRatio > 0.2 && setActive(null), { threshold: [0.2] });
    if (hero) heroIo.observe(hero);
    return () => { io.disconnect(); heroIo.disconnect(); };
  }, []);
  const pick = () => fileRef.current?.click();
  const onFile = (file: File | undefined) => {
    if (!file) return;
    void openImageFile(file);
    navigate('check');
  };

  return (
    <div className="home">
      <header className="home-bar" data-solid={solid || undefined}>
        <a className="brand" href={href('home')} aria-label="Veil home">
          <img src="/brand/veil-64.png" alt="" width="38" height="38" />
          <span className="wordmark">Veil</span>
        </a>
        <nav className="home-nav" aria-label="Sections">
          {SECTIONS.map((x) => (
            <a
              key={x.id}
              href={`#${x.id}`}
              data-colour-dot={x.colour}
              aria-current={active === x.id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {x.label}
            </a>
          ))}
        </nav>
        <div className="home-bar-end">
          <a className="home-bar-link" href={href('tickets')}>My tickets</a>
          <button className="btn btn-lime btn-sm" onClick={pick}>Check an image</button>
        </div>
      </header>

      <HeroBook onCheck={pick} onTrace={() => navigate('trace')} />

      <nav className="swatches-phone" aria-label="Tools">
        <a href={href('check')} data-colour="lime">Check an image</a>
        <a href={href('trace')} data-colour="sky">Find my face online</a>
        <a href={href('tickets')} data-colour="alarm">Take it down</a>
        <a href={href('shield')} data-colour="paper">Shield a photo</a>
      </nav>

      <CheckChapter onPick={pick} />
      <TraceChapter />
      <TakedownChapter />
      <ShieldChapter />
      <RulesChapter />
      <Faq />
      <Closing onPick={pick} />
      <Footer />

      <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}
