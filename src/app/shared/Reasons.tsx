import './reasons.css';

/**
 * Why Veil says what it says: up to three signs of tampering (red) and up to three signs the
 * picture or video was left alone (green). Only things that were actually measured appear here.
 */
export function Reasons({ reasons, noun }: { reasons: { for: string[]; against: string[]; source?: string[] }; noun: 'picture' | 'video' }) {
  const source = reasons.source ?? [];
  if (!reasons.for.length && !reasons.against.length && !source.length) return null;
  return (
    <div className="reasons">
      {source.length > 0 && (
        <section className="reasons-col" data-side="source" aria-label="Where it came from">
          <h2>Where it came from</h2>
          <ul>
            {source.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}
      {reasons.for.length > 0 && (
        <section className="reasons-col" data-side="for" aria-label="Signs of tampering">
          <h2>Why it may be tampered</h2>
          <ul>
            {reasons.for.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}
      {reasons.against.length > 0 && (
        <section className="reasons-col" data-side="against" aria-label="Signs it was not tampered with">
          <h2>Why it may be untouched</h2>
          <ul>
            {reasons.against.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}
      {(reasons.for.length > 0 || reasons.against.length > 0) && <p className="reasons-foot">These are the strongest things Veil measured in this {noun}. Neither list is proof on its own.</p>}
    </div>
  );
}
