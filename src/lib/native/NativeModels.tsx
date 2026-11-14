import { useEffect, useRef, useState } from 'react';
import { isAndroid, takePhoto } from './platform';
import { downloadModel, optionalModels, type OptionalModel } from './modelStore';
import { ensureOptionalModel, type ConsentRequest } from './modelConsent';

/** Android-only, explicit consent and cancellable progress; no photo data enters this flow. */
export function NativeModels() {
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [model, setModel] = useState<OptionalModel | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
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
    window.addEventListener('veil-model-consent', receive);
    return () => {
      window.removeEventListener('veil-model-consent', receive);
      controller.current?.abort();
    };
  }, []);
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
      <button
        className="fixed bottom-3 left-3 z-40 rounded-full border bg-white px-3 py-2 text-xs"
        style={{ bottom: 'calc(12px + var(--safe-area-inset-bottom, 0px))' }}
        onClick={() =>
          void takePhoto().catch((e) => {
            if (!/cancel/i.test(String(e))) alert(String(e));
          })
        }
      >
        Take photo
      </button>
      <button
        className="fixed bottom-3 right-3 z-40 rounded-full border bg-white px-3 py-2 text-xs"
        style={{ bottom: 'calc(12px + var(--safe-area-inset-bottom, 0px))' }}
        onClick={() => setOpen(true)}
      >
        Offline models
      </button>
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
                  {model.title} ? {(model.bytes / 1e6).toFixed(1)} MB
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
                  <button className="rounded-full border px-4 py-2" onClick={cancel}>
                    Cancel
                  </button>
                  {loaded === null && (
                    <button
                      className="rounded-full bg-neutral-900 px-4 py-2 text-white"
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
                    {m.title} ? {(m.bytes / 1e6).toFixed(1)} MB
                  </button>
                ))}
                <p className="my-3 text-xs">
                  Face-warp download is unavailable until its exported model has a pinned URL. Experimental
                  protection processing is not connected in this shell.
                </p>
                <button className="rounded-full border px-4 py-2" onClick={cancel}>
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
