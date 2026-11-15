import { useState } from 'react';
import { FacePortrait } from './Woman';
import { href } from '../router';

/* ---------------- Check: object on a disc ---------------- */

const CHECKS = [
  {
    name: 'Its own AI label',
    title: 'Made with AI, by its own label',
    says: 'Content Credentials signed by the generator say this picture was created by a generative AI model.',
    fact: 'Signed labels from OpenAI, Google, Adobe and camera makers are verified on your phone.',
    outfit: '#ff5a45',
  },
  {
    name: 'Our AI-image model',
    title: 'Looks AI-generated to our model',
    says: 'Our detector, trained on images from thousands of generators, scores this picture 97 out of 100 for AI-made.',
    fact: 'Shown only when the model is sure. A maybe is never listed.',
    outfit: '#7cc4ff',
  },
  {
    name: 'The hidden preview',
    title: 'The hidden preview shows something else',
    says: 'The small preview the camera stored inside the file no longer matches the picture. It was edited after it was taken.',
    fact: 'Most editing apps forget to update it.',
    outfit: '#d4f36b',
  },
  {
    name: 'Your original',
    title: 'Changed from your original',
    says: 'Lined up with the photo you really took, the face area differs and nothing else does.',
    fact: 'Give Veil the real photo and it points at the exact change.',
    outfit: '#ff5a45',
  },
  {
    name: 'Your Veil mark',
    title: 'Made from your photo',
    says: 'Your invisible Veil mark is still inside. This fake was made from the photo you shielded on 2 November.',
    fact: 'The mark survives face swaps, crops and re-uploads. Only your key can read it.',
    outfit: '#e6e4dd',
  },
];

export function CheckChapter({ onPick }: { onPick: () => void }) {
  const [active, setActive] = useState(0);
  const c = CHECKS[active]!;
  return (
    <section id="check" className="chapter ch-lime ch-check" aria-labelledby="check-title">
      <div className="check-disc" aria-hidden="true">
        <div className="disc" />
        <div className="verdict-card" data-ui key={active}>
          <div className="verdict-photo">
            <FacePortrait bg="#2a2a2a" outfit={c.outfit} />
          </div>
          <p className="verdict-label">Signs this picture was faked</p>
          <p className="verdict-title">{c.title}</p>
          <p className="verdict-says">{c.says}</p>
        </div>
      </div>
      <div className="check-list">
        <h2 id="check-title">Is it really you?</h2>
        <p className="chapter-lede">Drop in any picture. Veil runs five checks on your phone and shows only what it can prove.</p>
        <ul role="listbox" aria-label="What Veil checks">
          {CHECKS.map((x, i) => (
            <li key={x.name}>
              <button role="option" aria-selected={i === active} onClick={() => setActive(i)} onMouseEnter={() => setActive(i)}>
                {x.name}
              </button>
            </li>
          ))}
        </ul>
        <p className="check-fact" aria-live="polite">{c.fact}</p>
        <button className="btn btn-ink" onClick={onPick}>
          Check an image
        </button>
      </div>
    </section>
  );
}

/* ---------------- Trace: fixed output, live controls ---------------- */

const MATCHES = [
  { site: 'hot-leaks.example', kind: 'Face', score: 0.71, source: 'page', outfit: '#ff5a45' },
  { site: 'x.com/anon_uploads', kind: 'Face', score: 0.64, source: 'page', outfit: '#7cc4ff' },
  { site: 'yandex.com images', kind: 'Copy', score: 0.93, source: 'search', outfit: '#d4f36b' },
  { site: 'forum.example/t/8812', kind: 'Face', score: 0.44, source: 'watch', outfit: '#e6e4dd' },
  { site: 'cryptowins.example', kind: 'Copy', score: 0.88, source: 'search', outfit: '#ff5a45' },
];

export function TraceChapter() {
  const [source, setSource] = useState<'all' | 'page' | 'search' | 'watch'>('all');
  const [strict, setStrict] = useState(40);
  const [numbers, setNumbers] = useState(false);
  const threshold = 0.36 + (strict / 100) * 0.3;
  const shown = MATCHES.filter((m) => (source === 'all' || m.source === source) && m.score >= threshold);
  return (
    <section id="trace" className="chapter ch-sky ch-trace" aria-labelledby="trace-title">
      <div className="trace-output">
        <div className="match-panel" data-ui>
          <p className="match-head">
            <strong className="num">{shown.length}</strong> {shown.length === 1 ? 'place' : 'places'} with your face
          </p>
          {numbers ? (
            <div className="vector" aria-label="Your face as 128 numbers">
              {Array.from({ length: 64 }, (_, i) => (
                <span key={i} className="num">{(Math.sin(i * 12.9898) * 0.2).toFixed(2)}</span>
              ))}
            </div>
          ) : (
            <ul>
              {shown.map((m) => (
                <li key={m.site}>
                  <span className="match-thumb">
                    <FacePortrait bg="#2a2a2a" outfit={m.outfit} />
                  </span>
                  <span className="match-site">{m.site}</span>
                  <span className="match-kind">{m.kind === 'Face' ? `Face ${Math.round(m.score * 100)}` : 'Copy of your photo'}</span>
                </li>
              ))}
              {!shown.length && <li className="match-empty">Nothing this strict yet.</li>}
            </ul>
          )}
        </div>
      </div>
      <div className="trace-blocks">
        <h2 id="trace-title">Find my face</h2>
        <div className="trace-block">
          <p className="block-claim">Your face becomes 128 numbers, on your phone.</p>
          <p>Veil learns your face from one selfie and keeps only the numbers. The photo is never stored, and the numbers never leave the device.</p>
          <label className="toggle">
            <input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} />
            <span>Show what is stored</span>
          </label>
        </div>
        <div className="trace-block">
          <p className="block-claim">Scan the places fakes turn up.</p>
          <p>Paste any page and Veil reads every picture on it. Or send the picture to Google Lens, Bing, Yandex and TinEye in one tap, and keep a watchlist that is checked again for you.</p>
          <div className="segmented" role="radiogroup" aria-label="Where the match came from">
            {(['all', 'page', 'search', 'watch'] as const).map((s) => (
              <button key={s} role="radio" aria-checked={source === s} onClick={() => setSource(s)}>
                {{ all: 'All', page: 'Pages', search: 'Search engines', watch: 'Watchlist' }[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="trace-block">
          <p className="block-claim">Copies, even cropped or recoloured.</p>
          <p>Every picture is also fingerprinted with PDQ, the hash StopNCII and the big platforms use, so re-uploads of your own photo are caught too.</p>
          <label className="range">
            <span>How strict</span>
            <input type="range" min="0" max="100" value={strict} onChange={(e) => setStrict(Number(e.target.value))} />
          </label>
        </div>
        <a className="btn btn-ink" href={href('trace')}>
          Find my face online
        </a>
      </div>
    </section>
  );
}

/* ---------------- Take down: one card, four fields ---------------- */

function TicketCard({ step }: { step: 0 | 1 | 2 | 3 }) {
  return (
    <div className="ticket-card" data-ui>
      <div className="ticket-card-top">
        <span className="ticket-thumb">
          <FacePortrait bg="#2a2a2a" outfit="#ff5a45" />
        </span>
        <span>
          <strong>hot-leaks.example</strong>
          <span className="num">VT-7Q2K9</span>
        </span>
      </div>
      <p className="ticket-line">Face match 71 · face swap</p>
      {step >= 1 && <p className="ticket-line">To: abuse@hosting.example · TAKE IT DOWN Act</p>}
      {step === 2 && <p className="ticket-clock num">47 h 12 min left</p>}
      {step === 3 && <p className="ticket-gone">Removed in 19 h</p>}
      {step < 2 && <p className="ticket-state">{step === 0 ? 'Opened automatically' : 'Notice written, evidence attached'}</p>}
    </div>
  );
}

export function TakedownChapter() {
  const fields: Array<{ clause: string; colour: string; step: 0 | 1 | 2 | 3 }> = [
    { clause: 'First, a ticket opens by itself.', colour: 'alarm', step: 0 },
    { clause: 'Then Veil finds who to tell.', colour: 'char', step: 1 },
    { clause: 'Then the 48-hour clock starts.', colour: 'paper', step: 2 },
    { clause: 'Then it’s gone, and we check.', colour: 'lime', step: 3 },
  ];
  return (
    <section id="takedown" className="ch-takedown" aria-labelledby="takedown-title">
      {fields.map((f, i) => (
        <div key={f.clause} className="takedown-field" data-colour={f.colour}>
          {i === 0 && <h2 id="takedown-title">Take it down</h2>}
          <TicketCard step={f.step} />
          <p className="takedown-clause">{f.clause}</p>
        </div>
      ))}
    </section>
  );
}

/* ---------------- Shield ---------------- */

export function ShieldChapter() {
  return (
    <section id="shield" className="chapter ch-paper ch-shield" aria-labelledby="shield-title">
      <div className="shield-copy">
        <h2 id="shield-title">Shield it first</h2>
        <p className="chapter-lede">Before you post, Veil hides a mark in the picture that nobody can see, strips the location data, and wipes the street signs and house numbers that say where you live.</p>
        <ul className="shield-list">
          <li>
            <strong>An invisible Veil mark.</strong> If someone makes a fake from this photo, Veil can prove it came from you.
          </li>
          <li>
            <strong>No location inside.</strong> GPS, camera serial and time are removed from the file.
          </li>
          <li>
            <strong>No street name in sight.</strong> Signs, house numbers and plates are found and painted out.
          </li>
        </ul>
        <a className="btn btn-ink" href={href('shield')}>
          Shield a photo
        </a>
      </div>
      <div className="shield-pair" data-ui aria-hidden="true">
        <figure>
          <FacePortrait bg="#cfcdc5" outfit="#1f1f1f" accent="#7cc4ff" />
          <figcaption>What you see</figcaption>
        </figure>
        <figure className="shield-mark">
          <FacePortrait bg="#cfcdc5" outfit="#1f1f1f" accent="#7cc4ff" />
          <figcaption>What Veil can read: your mark</figcaption>
        </figure>
      </div>
    </section>
  );
}

/* ---------------- Rules: large marks on tiles ---------------- */

const RULES = ['TAKE IT DOWN Act', 'DMCA §512', 'GDPR Art. 17', 'UK Online Safety Act', 'StopNCII', 'Google removal'];

export function RulesChapter() {
  return (
    <section id="rules" className="chapter ch-char ch-rules" aria-labelledby="rules-title">
      <div className="rules-grid">
        <div className="rules-head">
          <h2 id="rules-title">Built on real rules</h2>
          <p>Veil writes notices under these laws and points you to these services. We are not affiliated with any of them.</p>
        </div>
        {RULES.map((r) => (
          <p key={r} className="rule-tile">
            {r}
          </p>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Questions ---------------- */

const QUESTIONS = [
  ['Is my face uploaded anywhere?', 'No. Checks and face matching run on your phone. Veil keeps your face as 128 numbers on the device. Only the pages you ask it to scan are fetched, through our server, and your photo never goes with them.'],
  ['How sure is the check?', 'Veil only shows a result when it is strong: a signed label, a mismatch inside the file, your own mark, or a model score above 90. If nothing is decisive, it says so instead of guessing.'],
  ['Will the site really take it down?', 'Under the TAKE IT DOWN Act, covered platforms in the US must remove non-consensual intimate images within 48 hours of a valid request. Veil writes that request, sends it to the right place, and tracks the clock. Sites that ignore it can be reported to the FTC, their host and Google Search.'],
  ['What if the fake is not explicit?', 'Use the copyright route when it was made from a photo you took, or the GDPR route if you are in the EU or UK. Impersonation and scam ads break every big platform’s rules too.'],
  ['Can Veil stop AI from editing my photos?', 'Nothing reliably stops today’s large models from editing a picture. Veil does what does work: it marks your photo so a fake made from it can be traced and proved, and removes what gives away where you live.'],
  ['Does it work on videos?', 'Not yet. Veil checks still pictures today, including frames you screenshot from a video.'],
  ['What does it cost?', 'Nothing. Veil is free for people protecting themselves.'],
];

export function Faq() {
  return (
    <section id="questions" className="chapter ch-night ch-faq" aria-labelledby="faq-title">
      <h2 id="faq-title">Questions</h2>
      <div className="faq-list">
        {QUESTIONS.map(([q, a]) => (
          <details key={q} name="faq">
            <summary>
              <span>{q}</span>
              <span className="plus" aria-hidden="true" />
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Closing: a sentence with a blank ---------------- */

export function Closing({ onPick }: { onPick: () => void }) {
  return (
    <section className="chapter ch-lime ch-closing" aria-labelledby="closing-title">
      <h2 id="closing-title">
        Check the picture{' '}
        <button className="blank" onClick={onPick}>
          choose it
        </button>{' '}
        now.
      </h2>
      <p>It opens on your phone. Nothing is uploaded unless you ask Veil to search the web.</p>
    </section>
  );
}

export function Footer() {
  const letters = [
    { l: 'V', c: 'lime', h: 100 },
    { l: 'E', c: 'sky', h: 78 },
    { l: 'I', c: 'alarm', h: 90 },
    { l: 'L', c: 'paper', h: 66 },
  ];
  return (
    <footer className="footer">
      <div className="block-mark" aria-label="Veil">
        {letters.map((x) => (
          <span key={x.l} data-colour={x.c} style={{ height: `${x.h}%` }} aria-hidden="true">
            {x.l}
          </span>
        ))}
      </div>
      <div className="footer-links">
        <a href={href('check')}>Check an image</a>
        <a href={href('trace')}>Find my face</a>
        <a href={href('tickets')}>Take it down</a>
        <a href={href('shield')}>Shield a photo</a>
        <a href="https://stopncii.org/" target="_blank" rel="noreferrer">StopNCII</a>
        <a href="https://takeitdown.ncmec.org/" target="_blank" rel="noreferrer">Take It Down (under 18)</a>
      </div>
      <p className="footer-note">If you are in danger, call your local emergency number. In the US, the Cyber Civil Rights Initiative helpline is 844-878-2274.</p>
      <p className="footer-copy">© 2026 Veil. Made at Ignite.</p>
    </footer>
  );
}
