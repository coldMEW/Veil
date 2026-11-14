import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, FilePdf, ImageSquare, ShieldCheck, UploadSimple } from '@phosphor-icons/react';
import { MAX_INPUT_BYTES, MAX_INPUT_PIXELS } from '../../lib/runtime/imageIntake';

type Mode = 'photo' | 'document' | 'clean';

const CHOICES = [
  {
    mode: 'photo', title: 'Check a photo', icon: ImageSquare, accept: 'image/jpeg,image/png',
    description: 'See the evidence in a photo: Content Credentials, model focus, face warps and shadows.',
  },
  {
    mode: 'document', title: 'Check a document', icon: FilePdf, accept: 'application/pdf',
    description: "See a PDF's save history, editing apps and AI-tool traces.",
  },
  {
    mode: 'clean', title: 'Remove private details', icon: ShieldCheck, accept: 'image/jpeg,image/png',
    description: 'Find addresses, plates and phone numbers, then save a clean copy.',
  },
] as const;

/** Routing hints only. The intake layer still checks the actual file bytes. */
function fileMode(file: File): 'photo' | 'document' | null {
  if (file.type === 'application/pdf') return 'document';
  if (file.type === 'image/jpeg' || file.type === 'image/png') return 'photo';
  if (!file.type) {
    if (/\.pdf$/i.test(file.name)) return 'document';
    if (/\.(?:jpe?g|png)$/i.test(file.name)) return 'photo';
  }
  return null;
}

export function HomeScreen({ onPick }: { onPick: (mode: Mode, file: File) => void }) {
  const inputs = useRef<Partial<Record<Mode, HTMLInputElement | null>>>({});
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  const choose = useCallback((mode: Mode, file: File) => {
    const kind = fileMode(file);
    if (!kind || mode === 'document' && kind !== 'document' || mode !== 'document' && kind !== 'photo') {
      setError(mode === 'document' ? 'Choose a PDF document.' : 'Choose a JPEG or PNG photo.');
      return;
    }
    if (file.size === 0) { setError('This file is empty. Choose another file.'); return; }
    if (file.size > MAX_INPUT_BYTES) {
      setError(`Choose a file up to ${MAX_INPUT_BYTES / (1024 * 1024)} MiB.`);
      return;
    }
    setError(null);
    onPick(mode, file);
  }, [onPick]);

  useEffect(() => {
    const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files') || !!event.dataTransfer?.files.length;
    const reset = () => { dragDepth.current = 0; setDragging(false); };
    const enter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      reset();
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      if (files.length !== 1) { setError('Choose one file at a time.'); return; }
      const file = files[0]!;
      const mode = fileMode(file);
      if (!mode) { setError('Drop a JPEG or PNG photo, or a PDF document.'); return; }
      choose(mode, file);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    // Window listeners include the header and margins, not just the card region.
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('keydown', escape);
    };
  }, [choose]);

  return (
    <motion.div
      className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-10 sm:px-8 sm:py-16 lg:py-20"
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-4xl">What do you want to check?</h1>
        <p className="mt-3 text-base leading-relaxed text-muted">Everything runs on this device. Nothing is uploaded.</p>
      </header>

      <div className="mt-8 grid gap-4 md:grid-cols-3 sm:mt-10">
        {CHOICES.map(({ mode, title, description, icon: Icon, accept }) => (
          <div key={mode} className="min-w-0">
            <button
              type="button"
              className="group flex min-h-56 w-full flex-col items-start rounded-2xl border border-line-strong bg-panel p-5 text-left transition-colors duration-200 hover:border-gold/60 hover:bg-raised sm:p-6 md:h-full"
              aria-label={`${title}: Choose file`}
              onClick={() => inputs.current[mode]?.click()}
            >
              <Icon size={28} weight="duotone" className="text-gold" aria-hidden />
              <span className="mt-5 text-lg font-semibold leading-snug text-ink">{title}</span>
              <span className="mt-2 text-sm leading-relaxed text-muted">{description}</span>
              <span className="mt-auto flex min-h-11 items-center gap-2 pt-5 text-sm font-semibold text-gold">
                Choose file <ArrowRight size={16} weight="bold" aria-hidden />
              </span>
            </button>
            <input
              ref={(node) => { inputs.current[mode] = node; }}
              type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = ''; // Choosing the same file again must still work.
                if (file) choose(mode, file);
              }}
            />
          </div>
        ))}
      </div>

      {error && <p className="mt-4 rounded-xl border border-misfit/40 bg-misfit/10 px-4 py-3 text-sm text-misfit" role="alert">{error}</p>}

      <section aria-labelledby="how-it-works" className="mt-10 border-t border-line pt-6 sm:mt-12">
        <h2 id="how-it-works" className="text-sm font-semibold text-ink">How it works</h2>
        <ol className="mt-4 grid gap-4 text-sm sm:grid-cols-3 sm:gap-6">
          {[
            ['Upload', 'Choose a file from your device.'],
            ['Check', 'Veil examines the available evidence.'],
            ['Results', 'Review the findings and their limits.'],
          ].map(([title, description], index) => (
            <li key={title} className="flex items-start gap-3">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-raised text-xs text-muted" aria-hidden>{index + 1}</span>
              <div><p className="font-medium text-ink/90">{title}</p><p className="mt-1 leading-relaxed text-muted">{description}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-8 text-xs leading-relaxed text-muted">
        JPEG, PNG or PDF, up to {MAX_INPUT_BYTES / (1024 * 1024)} MiB per file. Photos up to {MAX_INPUT_PIXELS / 1e6} megapixels.
        <span className="hidden sm:inline"> You can also drop a file anywhere on this screen.</span>
      </p>

      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-gold bg-night/95 p-6" role="status" aria-live="polite">
          <div className="text-center">
            <UploadSimple size={36} className="mx-auto text-gold" aria-hidden />
            <p className="mt-4 text-2xl font-semibold text-gold">Drop your file here</p>
            <p className="mt-2 text-sm text-muted">JPEG or PNG for a photo check. PDF for a document check.</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
