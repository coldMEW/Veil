import { useSyncExternalStore } from 'react';

export type Route = 'home' | 'check' | 'trace' | 'tickets' | 'shield';
const ROUTES: Route[] = ['home', 'check', 'trace', 'tickets', 'shield'];

function parse(): { route: Route; param: string | null } {
  const [head = '', param = null] = window.location.hash.replace(/^#\/?/, '').split('/');
  const route = (ROUTES as string[]).includes(head) ? (head as Route) : 'home';
  return { route, param };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse();
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
});

export function navigate(route: Route, param?: string) {
  window.location.hash = route === 'home' ? '/' : `/${route}${param ? `/${param}` : ''}`;
}

export function href(route: Route, param?: string) {
  return route === 'home' ? '#/' : `#/${route}${param ? `/${param}` : ''}`;
}

export function useRoute() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
