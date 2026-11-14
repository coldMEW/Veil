import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSW } from './registerSW';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function setup(controlled = true, waiting = false) {
  const worker = new EventTarget() as ServiceWorker;
  Object.defineProperty(worker, 'state', { value: 'installing', writable: true });
  const registration = new EventTarget() as ServiceWorkerRegistration;
  Object.defineProperties(registration, {
    installing: { value: worker }, waiting: { value: waiting ? worker : null },
  });
  const register = vi.fn(async () => registration);
  vi.stubGlobal('navigator', { serviceWorker: { register, controller: controlled ? {} : null } });
  vi.stubEnv('PROD', true);
  return { worker, registration, register };
}

describe('production service worker registration', () => {
  it('does not register in development or unsupported contexts', async () => {
    const { register } = setup();
    vi.stubEnv('PROD', false);
    expect(await registerSW()).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
    vi.stubEnv('PROD', true);
    vi.stubGlobal('navigator', {});
    expect(await registerSW()).toBeUndefined();
  });
  it('handles registration errors quietly', async () => {
    const { register } = setup();
    register.mockRejectedValueOnce(new Error('storage disabled'));
    expect(await registerSW()).toBeUndefined();
  });
  it('notifies once when an update installs, without forcing activation', async () => {
    const { register, registration, worker } = setup();
    const notify = vi.fn();
    expect(await registerSW(notify)).toBe(registration);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    expect(notify).not.toHaveBeenCalled();
    Object.defineProperty(worker, 'state', { value: 'installed' });
    registration.dispatchEvent(new Event('updatefound'));
    worker.dispatchEvent(new Event('statechange'));
    expect(notify).toHaveBeenCalledExactlyOnceWith(registration);
  });
  it('reports an already waiting update and does not label a first install as an update', async () => {
    const notify = vi.fn();
    setup(true, true);
    await registerSW(notify);
    expect(notify).toHaveBeenCalledTimes(1);
    notify.mockClear();
    const { worker } = setup(false);
    await registerSW(notify);
    Object.defineProperty(worker, 'state', { value: 'installed' });
    worker.dispatchEvent(new Event('statechange'));
    expect(notify).not.toHaveBeenCalled();
  });
});
