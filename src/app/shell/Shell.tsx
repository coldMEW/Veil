import type { ReactNode } from 'react';
import { href, type Route } from '../router';
import { tickets } from '../../services/tickets';

export const CHAPTERS: Array<{ route: Exclude<Route, 'home'>; label: string; short: string; colour: string }> = [
  { route: 'check', label: 'Check', short: 'Check', colour: 'lime' },
  { route: 'trace', label: 'Find my face', short: 'Trace', colour: 'sky' },
  { route: 'tickets', label: 'Take down', short: 'Tickets', colour: 'alarm' },
  { route: 'shield', label: 'Shield', short: 'Shield', colour: 'paper' },
];

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const list = tickets.use();
  const open = list.filter((t) => t.status !== 'removed').length;
  const colour = CHAPTERS.find((c) => c.route === route)?.colour ?? 'lime';
  return (
    <div className="app" data-chapter={colour}>
      <header className="bar">
        <a className="wordmark" href={href('home')} aria-label="Veil home">
          Veil
        </a>
        <nav className="bar-nav" aria-label="Tools">
          {CHAPTERS.map((c) => (
            <a key={c.route} href={href(c.route)} aria-current={route === c.route ? 'page' : undefined} data-colour={c.colour}>
              {c.label}
              {c.route === 'tickets' && open > 0 && <span className="count num">{open}</span>}
            </a>
          ))}
        </nav>
        <p className="bar-local">Your face stays on this device</p>
      </header>
      <main className="screen">{children}</main>
      <nav className="tabs" aria-label="Tools">
        {CHAPTERS.map((c) => (
          <a key={c.route} href={href(c.route)} aria-current={route === c.route ? 'page' : undefined} data-colour={c.colour}>
            <span>{c.short}</span>
            {c.route === 'tickets' && open > 0 && <span className="count num">{open}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}
