import { useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { href, navigate } from '../router';
import { tickets, timeLeft } from '../../services/tickets';
import { vaultFaces } from '../../services/vault';
import { persisted } from '../../services/store';
import { ArtCheck, ArtFace, ArtShield, ArtTakedown, ArtTrace } from '../shared/Art';
import { isAndroid } from '../../platform/environment';
import './hub.css';

const onboarded = persisted<boolean>('veil.onboarded.v1', false);

const SLIDES = [
  { art: ArtCheck, title: 'Found a fake of you?', text: 'Check any picture. Veil shows only what it can prove: AI labels, edits, and whether it was made from your photo.' },
  { art: ArtTrace, title: 'Find it everywhere', text: 'Veil learns your face as numbers on your phone and looks for it on the pages you choose.' },
  { art: ArtTakedown, title: 'Take it down', text: 'Every match becomes a ticket: the right place to send it, the notice written for you, and the 48-hour clock.' },
];

function Onboarding({ done }: { done: () => void }) {
  const [i, setI] = useState(0);
  const s = SLIDES[i]!;
  const Art = s.art;
  const last = i === SLIDES.length - 1;
  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      {last ? <span className="onboard-skip" aria-hidden="true" /> : <button className="onboard-skip" onClick={done}>Skip</button>}
      <div className="onboard-art" key={i}>
        <Art />
      </div>
      <div className="onboard-copy" key={`c${i}`}>
        <h1 id="onboard-title">{s.title}</h1>
        <p>{s.text}</p>
      </div>
      <div className="onboard-dots" aria-hidden="true">
        {SLIDES.map((_, k) => <span key={k} data-on={k === i || undefined} />)}
      </div>
      <button
        className="btn btn-lime onboard-next"
        onClick={() => {
          if (!last) return setI(i + 1);
          done();
          navigate('trace');
        }}
      >
        {last ? 'Add my face' : 'Next'}
      </button>
      {last && (
        <button className="onboard-later" onClick={done}>
          Later
        </button>
      )}
    </div>
  );
}

export default function AppHome() {
  const seen = onboarded.use();
  const list = tickets.use();
  const faces = vaultFaces.use();
  const open = list.filter((t) => t.status !== 'removed');
  const overdue = list.filter((t) => (timeLeft(t) ?? 1) < 0).length;
  const removed = list.length - open.length;

  if (!seen) return <Onboarding done={() => onboarded.set(true)} />;

  const cards = [
    { to: 'check' as const, colour: 'lime', title: 'I found a fake', line: 'Check a picture, then report it', Art: ArtCheck },
    { to: 'trace' as const, colour: 'sky', title: 'Is my face out there?', line: faces.length ? 'Scan pages for your face' : 'Add your face, then scan pages', Art: ArtTrace },
    {
      to: 'tickets' as const,
      colour: 'alarm',
      title: 'My takedowns',
      line: list.length ? `${open.length} in progress${overdue ? `, ${overdue} overdue` : ''}${removed ? `, ${removed} removed` : ''}` : 'Nothing to take down yet',
      Art: ArtTakedown,
    },
    { to: 'shield' as const, colour: 'paper', title: 'Before I post', line: 'Mark it so a fake can be traced to you', Art: ArtShield },
    // Video evidence is a desk tool: a full scan takes minutes on a phone, so it is offered on the web only.
    ...(isAndroid() ? [] : [{ to: 'video' as const, colour: 'sky', title: 'Is this video real?', line: 'Mark the moments worth a look and seal a record', Art: ArtCheck }]),
    { to: 'clean' as const, colour: 'char', title: 'Remove personal details', line: 'Street names, house numbers, plates, emails and phone numbers', Art: ArtCheck },
  ];

  return (
    <div className="hub">
      <header className="hub-head">
        <h1>What happened?</h1>
        <p>Pick what you need. Everything starts on your phone.</p>
      </header>

      {!faces.length && (
        <a className="hub-face" href={href('trace')}>
          <span className="hub-face-art"><ArtFace /></span>
          <span>
            <strong>Add your face first</strong>
            <span>One selfie. Veil keeps 128 numbers, never the photo.</span>
          </span>
          <ArrowRight size={22} weight="bold" aria-hidden="true" />
        </a>
      )}

      <div className="hub-cards">
        {cards.map(({ to, colour, title, line, Art }, k) => (
          <a key={to} className="hub-card" data-colour={colour} href={href(to)} style={{ ['--k' as string]: k }}>
            <span className="hub-card-copy">
              <strong>{title}</strong>
              <span>{line}</span>
            </span>
            <span className="hub-card-art"><Art /></span>
            <span className="hub-card-go" aria-hidden="true"><ArrowRight size={20} weight="bold" /></span>
          </a>
        ))}
      </div>

      <p className="hub-help">
        Scared or in danger? You are not alone. In the US, the Cyber Civil Rights Initiative helpline is{' '}
        <a href="tel:18448782274">844-878-2274</a>.
      </p>
    </div>
  );
}
