import { useEffect, useRef, useState } from 'react';
import { HeroBook } from './HeroBook';
import { CheckChapter, TraceChapter, TakedownChapter, ShieldChapter, RulesChapter, Faq, Closing, Footer } from './Chapters';
import { navigate, href } from '../router';
import { openImageFile } from '../../lib/runtime/imageSession';
import './home.css';

const SWATCHES = [
  { id: 'check', label: 'Check an image', colour: 'lime' },
  { id: 'trace', label: 'Find my face', colour: 'sky' },
  { id: 'takedown', label: 'Take it down', colour: 'alarm' },
  { id: 'shield', label: 'Shield a photo', colour: 'paper' },
  { id: 'questions', label: 'Questions', colour: 'char' },
];

export function Home() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<string | null>(null);
  // The rail marks the chapter you are reading.
  useEffect(() => {
    const ids = SWATCHES.map((s) => s.id);
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-45% 0px -50% 0px' },
    );
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  const pick = () => fileRef.current?.click();
  const onFile = (file: File | undefined) => {
    if (!file) return;
    void openImageFile(file);
    navigate('check');
  };

  return (
    <div className="home">
      <header className="home-bar">
        <a className="brand" href={href('home')} aria-label="Veil home">
          <img src="/brand/veil-64.png" alt="" width="38" height="38" />
          <span className="wordmark">Veil</span>
        </a>
        <a className="home-bar-link" href={href('tickets')}>
          My tickets
        </a>
      </header>

      <nav className="swatches" aria-label="Sections">
        {SWATCHES.map((s) => (
          <a key={s.id} href={`#${s.id}`} data-colour={s.colour} data-active={active === s.id || undefined} onClick={(e) => {
            e.preventDefault();
            document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' });
          }}>
            {s.label}
          </a>
        ))}
      </nav>

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
