import { closeImage, useImageSession } from '../lib/runtime/imageSession';
import { setNativeBackFallback } from './native';
import { useEffect, useRef, useState } from 'react';
import { isAndroid } from './environment';
import { downloadModel, optionalModels, MODEL_CACHE, type OptionalModel } from './modelStore';
import { ensureOptionalModel, type ConsentRequest } from './modelConsent';

/** Android-only, explicit consent and cancellable progress; no photo data enters this flow. */
export function NativeModels() {
  const hasOpenSession = useImageSession().status !== 'empty';
  useEffect(() => {
    if (!isAndroid()) return;
    return setNativeBackFallback(() => {
      if (!hasOpenSession) return false;
      closeImage();
      return true;
    });
  }, [hasOpenSession]);
  const [toast, setToast] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (e: Event) => {
      setToast(String((e as CustomEvent).detail));
      clearTimeout(timer);
      timer = setTimeout(() => setToast(''), 4000);
    };
    window.addEventListener('veil-toast', show);
    return () => {
      window.removeEventListener('veil-toast', show);
      clearTimeout(timer);
    };
  }, []);
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [model, setModel] = useState<OptionalModel | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [cached, setCached] = useState<string[]>([]);
  useEffect(() => {
    if (!open || typeof caches === 'undefined') return;
    let stale = false;
    void caches.open(MODEL_CACHE).then(async (cache) => {
      const ids = await Promise.all(
        optionalModels.map(async (m) => ((await cache.match(m.path)) ? m.id : null)),
      );
      if (!stale) setCached(ids.filter((id): id is 'focus' | 'diffvax' => id !== null));
    });
    return () => {
      stale = true;
    };
  }, [open]);
  const controller = useRef<AbortController | null>(null);
  const active = useRef<ConsentRequest | null>(null);
  useEffect(() => {
    const receive = (event: Event) => {
      const next = (event as CustomEvent<ConsentRequest>).detail;
      if (active.current) {
        next.reject(Error('Another model request is open.'));
        return;
      }
      active.current = next;
      setRequest(next);
      setModel(optionalModels.find((m) => m.id === next.id) ?? null);
      setLoaded(null);
      setError('');
      setOpen(true);
    };
    const openModels = () => setOpen(true);
    window.addEventListener('veil-models-open', openModels);
    window.addEventListener('veil-model-consent', receive);
    return () => {
      window.removeEventListener('veil-models-open', openModels);
      window.removeEventListener('veil-model-consent', receive);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[aria-label="Offline models"][role="dialog"]');
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: Event) => {
      const key = event as KeyboardEvent;
      if (event.type === 'veil-back' || key.key === 'Escape') {
        event.preventDefault();
        controller.current?.abort();
        active.current?.reject(new DOMException('Download cancelled', 'AbortError'));
        active.current = null;
        setRequest(null);
        setModel(null);
        setOpen(false);
        setLoaded(null);
      } else if (key.key === 'Tab' && dialog) {
        const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = buttons[0],
          last = buttons.at(-1);
        if (key.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!key.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('veil-back', dismiss, true);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('veil-back', dismiss, true);
      window.removeEventListener('keydown', dismiss);
      previous?.focus();
    };
  }, [open]);
  if (!isAndroid()) return null;
  const cancel = () => {
    controller.current?.abort();
    active.current?.reject(new DOMException('Download cancelled', 'AbortError'));
    active.current = null;
    setRequest(null);
    setModel(null);
    setOpen(false);
    setLoaded(null);
  };
  const start = async () => {
    if (!model || !request) return;
    const abort = new AbortController();
    controller.current = abort;
    setLoaded(0);
    setError('');
    try {
      await downloadModel(model, abort.signal, setLoaded);
      request.resolve();
      active.current = null;
      setRequest(null);
      setModel(null);
      setOpen(false);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(String(e));
        setLoaded(null);
      }
    }
  };
  return (
    <>
      {toast && (
        <div className="native-toast" role="status">
          {toast}
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Offline models"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-5"
        >
          <section className="w-full max-w-sm rounded-2xl border bg-white p-6 text-black">
            <h2 className="text-lg font-semibold">Offline models</h2>
            <p className="my-3 text-sm">
              Text detection and clean fill are included. Optional downloads contain model weights only. Your
              photos stay on this device.
            </p>
            {model ? (
              <>
                <p>
                  {model.title} - {(model.bytes / 1e6).toFixed(1)} MB
                </p>
                <p className="my-2 text-sm">Download from Hugging Face and verify its checksum?</p>
                {loaded !== null && (
                  <>
                    <progress className="w-full" max={model.bytes} value={loaded} />
                    <p role="status">{Math.round((100 * loaded) / model.bytes)}%</p>
                  </>
                )}
                {error && (
                  <p role="alert" className="text-sm">
                    {error}
                  </p>
                )}
                <div className="mt-4 flex gap-3">
                  <button className="rounded-md border min-h-11 px-4 py-2" onClick={cancel}>
                    Cancel
                  </button>
                  {loaded === null && (
                    <button
                      className="rounded-md bg-neutral-900 min-h-11 px-4 py-2 text-white"
                      onClick={() => void start()}
                    >
                      Download
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                {optionalModels.map((m) => (
                  <button
                    key={m.id}
                    className="my-2 block text-sm underline"
                    onClick={() => void ensureOptionalModel(m.id).catch(() => undefined)}
                  >
                    {m.title} -{' '}
                    {cached.includes(m.id) ? 'On this device' : `${(m.bytes / 1e6).toFixed(1)} MB`}
                  </button>
                ))}
                <p className="my-3 text-xs">
                  Face-warp download is unavailable until its exported model has a pinned URL. Experimental
                  protection processing is not connected in this shell.
                </p>
                <button className="rounded-md border min-h-11 px-4 py-2" onClick={cancel}>
                  Close
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
