import type { ReactNode } from 'react';
import { House } from '@phosphor-icons/react/dist/ssr/House';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass';
import { UserFocus } from '@phosphor-icons/react/dist/ssr/UserFocus';
import { PaperPlaneTilt } from '@phosphor-icons/react/dist/ssr/PaperPlaneTilt';
import { ShieldCheck } from '@phosphor-icons/react/dist/ssr/ShieldCheck';
import { Eraser } from '@phosphor-icons/react/dist/ssr/Eraser';
import { href, type Route } from '../router';
import { tickets } from '../../services/tickets';

export const CHAPTERS: Array<{ route: Exclude<Route, 'home' | 'app'>; label: string; short: string; colour: string }> = [
  { route: 'check', label: 'Check', short: 'Check', colour: 'lime' },
  { route: 'trace', label: 'Find my face', short: 'Trace', colour: 'sky' },
  { route: 'tickets', label: 'Take down', short: 'Tickets', colour: 'alarm' },
  { route: 'shield', label: 'Shield', short: 'Shield', colour: 'paper' },
  { route: 'clean', label: 'Remove details', short: 'Clean', colour: 'paper' },
  { route: 'video', label: 'Video evidence', short: 'Video', colour: 'sky' },
];

const TAB_ICON = {
  check: (p: object) => <MagnifyingGlass {...p} />,
  trace: (p: object) => <UserFocus {...p} />,
  tickets: (p: object) => <PaperPlaneTilt {...p} />,
  shield: (p: object) => <ShieldCheck {...p} />,
  clean: (p: object) => <Eraser {...p} />,
  video: (p: object) => <MagnifyingGlass {...p} />,
};

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const list = tickets.use();
  const open = list.filter((t) => t.status !== 'removed').length;
  const colour = CHAPTERS.find((c) => c.route === route)?.colour ?? 'night';
  return (
    <div className="app" data-chapter={colour}>
      <header className="bar">
        <a className="brand" href={href('home')} aria-label="Veil home">
          <img src="/brand/veil-64.png" alt="" width="38" height="38" />
          <span className="wordmark">Veil</span>
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
        <a href={href('app')} aria-current={route === 'app' ? 'page' : undefined} data-colour="home">
          <House size={22} weight={route === 'app' ? 'fill' : 'bold'} aria-hidden="true" />
          <span>Home</span>
        </a>
        {CHAPTERS.filter((c) => c.route !== 'clean' && c.route !== 'video').map((c) => (
          <a key={c.route} href={href(c.route)} aria-current={route === c.route || (c.route === 'shield' && route === 'clean') ? 'page' : undefined} data-colour={c.colour}>
            {TAB_ICON[c.route]({ size: 22, weight: route === c.route ? 'fill' : 'bold', 'aria-hidden': true })}
            <span>{c.short}</span>
            {c.route === 'tickets' && open > 0 && <span className="count num">{open}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}
