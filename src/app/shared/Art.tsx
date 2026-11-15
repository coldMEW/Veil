/*
 * Small flat illustrations for the app, drawn in code and gently animated with CSS (see art.css).
 * One friendly character language: round shapes, two tones per object, ink outlines nowhere.
 */
import './art.css';

type ArtProps = { className?: string; label?: string };

const wrap = (label: string | undefined, className: string, body: React.ReactNode) => (
  <svg className={`art ${className}`} viewBox="0 0 240 200" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {body}
  </svg>
);

/** A photo being looked at through a magnifier that sweeps across it. */
export function ArtCheck({ className = '', label }: ArtProps) {
  return wrap(label, `art-check ${className}`, (
    <>
      <ellipse cx="120" cy="182" rx="80" ry="10" fill="currentColor" opacity=".12" />
      <g className="art-float">
        <rect x="52" y="30" width="120" height="140" rx="22" fill="#fff" />
        <rect x="64" y="42" width="96" height="84" rx="14" fill="#e9e3d6" />
        <circle cx="112" cy="78" r="20" fill="#f2c4a0" />
        <path d="M86 126 Q90 100 112 98 Q134 100 138 126 Z" fill="#7cc4ff" />
        <path d="M92 74 C92 54 132 50 134 74 C122 66 104 66 92 74Z" fill="#2b1d16" />
        <rect x="64" y="138" width="70" height="9" rx="4.5" fill="#d9d2c3" />
        <rect x="64" y="153" width="46" height="9" rx="4.5" fill="#e9e3d6" />
      </g>
      <g className="art-sweep">
        <circle cx="150" cy="96" r="30" fill="#c8f56a" opacity=".35" />
        <circle cx="150" cy="96" r="30" fill="none" stroke="#111" strokeWidth="9" />
        <rect x="168" y="118" width="14" height="44" rx="7" fill="#111" transform="rotate(-40 175 140)" />
      </g>
    </>
  ));
}

/** A face with a radar ring sweeping around it, and found dots lighting up. */
export function ArtTrace({ className = '', label }: ArtProps) {
  return wrap(label, `art-trace ${className}`, (
    <>
      <circle className="art-ring" cx="120" cy="100" r="78" fill="none" stroke="currentColor" strokeWidth="3" opacity=".25" />
      <circle className="art-ring art-ring-2" cx="120" cy="100" r="58" fill="none" stroke="currentColor" strokeWidth="3" opacity=".35" />
      <g className="art-radar">
        <path d="M120 100 L120 22 A78 78 0 0 1 187 61 Z" fill="currentColor" opacity=".18" />
      </g>
      <circle cx="120" cy="100" r="34" fill="#fff" />
      <circle cx="120" cy="98" r="18" fill="#f2c4a0" />
      <path d="M100 96 C100 74 140 72 142 96 C130 88 112 88 100 96Z" fill="#2b1d16" />
      <path d="M100 132 Q102 116 120 116 Q138 116 140 132 Z" fill="#ff6f5b" />
      <circle className="art-blip" cx="176" cy="54" r="7" fill="#ff6f5b" />
      <circle className="art-blip art-blip-2" cx="58" cy="140" r="7" fill="#ff6f5b" />
      <circle className="art-blip art-blip-3" cx="186" cy="138" r="7" fill="#c8f56a" />
    </>
  ));
}

/** A notice folds into a paper plane and flies off. */
export function ArtTakedown({ className = '', label }: ArtProps) {
  return wrap(label, `art-takedown ${className}`, (
    <>
      <path className="art-trail" d="M30 160 C70 150 90 120 120 112" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="2 12" strokeLinecap="round" opacity=".5" />
      <g className="art-plane">
        <path d="M120 112 L214 60 L170 150 L152 122 Z" fill="#fff" />
        <path d="M152 122 L214 60 L144 134 Z" fill="#e6dfd0" />
        <path d="M152 122 L160 148 L170 150 Z" fill="#d2cab9" />
      </g>
      <g className="art-float">
        <rect x="34" y="40" width="64" height="80" rx="14" fill="#fff" />
        <rect x="46" y="56" width="40" height="7" rx="3.5" fill="#ff6f5b" />
        <rect x="46" y="70" width="32" height="7" rx="3.5" fill="#e6dfd0" />
        <rect x="46" y="84" width="38" height="7" rx="3.5" fill="#e6dfd0" />
        <circle cx="80" cy="104" r="9" fill="#c8f56a" />
        <path d="M76 104 l3 3 l6 -6" stroke="#111" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </g>
    </>
  ));
}

/** A photo slides behind a shield that pulses once in a while. */
export function ArtShield({ className = '', label }: ArtProps) {
  return wrap(label, `art-shield ${className}`, (
    <>
      <ellipse cx="120" cy="182" rx="70" ry="9" fill="currentColor" opacity=".12" />
      <g className="art-float">
        <rect x="40" y="46" width="100" height="120" rx="20" fill="#fff" transform="rotate(-8 90 106)" />
        <rect x="52" y="60" width="76" height="70" rx="12" fill="#e9e3d6" transform="rotate(-8 90 106)" />
      </g>
      <g className="art-pulse">
        <path d="M150 40 L200 58 L200 104 C200 136 176 158 150 168 C124 158 100 136 100 104 L100 58 Z" fill="#111" />
        <path d="M150 52 L190 66 L190 104 C190 130 171 148 150 156 Z" fill="#2a2b33" />
        <path d="M128 104 l15 15 l29 -31" stroke="#c8f56a" strokeWidth="10" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle className="art-spark" cx="210" cy="36" r="5" fill="#fff" />
      <circle className="art-spark art-spark-2" cx="92" cy="30" r="4" fill="#fff" />
    </>
  ));
}

/** The person: a friendly head-and-shoulders, used when Veil asks for your face. */
export function ArtFace({ className = '', label }: ArtProps) {
  return wrap(label, `art-face ${className}`, (
    <>
      <circle className="art-ring" cx="120" cy="100" r="86" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="10 12" opacity=".5" />
      <path d="M62 196 Q66 140 120 134 Q174 140 178 196 Z" fill="#7cc4ff" />
      <rect x="108" y="116" width="24" height="26" rx="10" fill="#e7b48f" />
      <ellipse cx="120" cy="92" rx="38" ry="42" fill="#f2c4a0" />
      <path d="M80 90 C78 48 162 44 162 90 C148 72 104 68 80 90Z" fill="#2b1d16" />
      <g className="art-blink">
        <ellipse cx="106" cy="96" rx="4" ry="5" fill="#1d1d1d" />
        <ellipse cx="134" cy="96" rx="4" ry="5" fill="#1d1d1d" />
      </g>
      <path d="M108 114 q12 9 24 0" stroke="#a5503a" strokeWidth="4" fill="none" strokeLinecap="round" />
      <g className="art-corners" stroke="#111" strokeWidth="6" strokeLinecap="round" fill="none">
        <path d="M58 46 v-14 h14" /><path d="M182 46 v-14 h-14" /><path d="M58 154 v14 h14" /><path d="M182 154 v14 h-14" />
      </g>
    </>
  ));
}
