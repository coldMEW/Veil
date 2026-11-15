import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { closeImage } from '../lib/runtime/imageSession';
import { useRoute } from './router';
import { Home } from './home/Home';
import { Shell } from './shell/Shell';
import './app.css';
import { isAndroid } from '../platform/environment';

const CheckScreen = lazy(() => import('./check/CheckScreen'));
const TraceScreen = lazy(() => import('./trace/TraceScreen'));
const TicketsScreen = lazy(() => import('./tickets/TicketsScreen'));
const ShieldScreen = lazy(() => import('./shield/ShieldScreen'));
const VideoScreen = lazy(() => import('./video/VideoScreen'));
const AppHome = lazy(() => import('./hub/AppHome'));
const CleanScreen = lazy(() => import('./shield/ShieldScreen').then((m) => ({ default: () => <m.default mode="clean" /> })));

function Toasts() {
  const [items, setItems] = useState<Array<{ id: number; text: string }>>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const id = ++n;
      setItems((list) => [...list.slice(-2), { id, text: String((e as CustomEvent).detail) }]);
      window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4200);
    };
    window.addEventListener('veil-toast', on);
    return () => window.removeEventListener('veil-toast', on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <p key={t.id} className="toast">{t.text}</p>
      ))}
    </div>
  );
}

export function App() {
  const { route, param } = useRoute();
  // A picture opened in one tool does not follow you into another. (Home hands a picture to Check on purpose.)
  const previous = useRef(route);
  useEffect(() => {
    const from = previous.current;
    previous.current = route;
    if (from !== route && from !== 'home' && from !== 'app') closeImage();
  }, [route]);
  return (
    <>
      {route === 'home' && !isAndroid() ? (
        <Home />
      ) : (
        <Shell route={route === 'home' ? 'app' : route}>
          <Suspense fallback={<div className="screen-loading" aria-busy="true" />}>
            {(route === 'app' || route === 'home' || (route === 'video' && isAndroid())) && <AppHome />}
            {route === 'check' && <CheckScreen />}
            {route === 'trace' && <TraceScreen />}
            {route === 'tickets' && <TicketsScreen ticketId={param} />}
            {route === 'shield' && <ShieldScreen />}
            {route === 'clean' && <CleanScreen />}
            {route === 'video' && !isAndroid() && <VideoScreen />}
          </Suspense>
        </Shell>
      )}
      <Toasts />
    </>
  );
}

export function toast(text: string) {
  window.dispatchEvent(new CustomEvent('veil-toast', { detail: text }));
}
