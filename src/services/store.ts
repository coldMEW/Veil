import { useSyncExternalStore } from 'react';

/**
 * A small persisted store. Lives in this browser/phone only (localStorage); every read and write
 * is guarded because storage can be missing (private windows, blocked site data).
 */
export function persisted<T>(key: string, initial: T) {
  let value: T = initial;
  try {
    const raw = localStorage.getItem(key);
    if (raw) value = JSON.parse(raw) as T;
  } catch {
    /* storage unavailable: start empty */
  }
  const listeners = new Set<() => void>();
  const api = {
    get: () => value,
    set(next: T | ((prev: T) => T)) {
      value = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota or blocked: keep in memory */
      }
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    use(): T {
      return useSyncExternalStore(api.subscribe, api.get);
    },
  };
  return api;
}

export function uid(prefix = ''): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 9).toUpperCase();
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
