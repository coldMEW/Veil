import { useRef } from 'react';
import { HeroStory } from './HeroStory';
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
          <a key={s.id} href={`#${s.id}`} data-colour={s.colour} onClick={(e) => {
            e.preventDefault();
            document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' });
          }}>
            {s.label}
          </a>
        ))}
      </nav>

      <HeroStory onCheck={pick} onTrace={() => navigate('trace')} />

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
