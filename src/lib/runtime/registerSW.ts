import { Capacitor } from '@capacitor/core';
export type UpdateAvailableCallback = (registration: ServiceWorkerRegistration) => void;

/** Optional update notification; never reload an active image session automatically. */
export async function registerSW(onUpdateAvailable?: UpdateAvailableCallback): Promise<ServiceWorkerRegistration | undefined> {
  if (Capacitor.isNativePlatform()) return;
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    const notified = new WeakSet<ServiceWorker>();
    const notify = (worker: ServiceWorker | null) => {
      if (!worker || notified.has(worker) || !navigator.serviceWorker.controller) return;
      notified.add(worker);
      try { onUpdateAvailable?.(registration); } catch { /* A notification must not disrupt the app. */ }
    };
    notify(registration.waiting);
    const watchInstalling = () => {
      const worker = registration.installing;
      if (!worker) return;
      const check = () => { if (worker.state === 'installed') notify(worker); };
      worker.addEventListener('statechange', check);
      check();
    };
    registration.addEventListener('updatefound', watchInstalling);
    watchInstalling();
    return registration;
  } catch {
    // Offline, unsupported contexts and disabled storage leave the app usable.
    return undefined;
  }
}
