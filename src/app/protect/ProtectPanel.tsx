import { DownloadSimple, ShieldCheck, ArrowCounterClockwise, WarningCircle } from '@phosphor-icons/react';
import type { ProtectState } from './useProtect';

const MB = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

function save(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

interface Props {
  state: ProtectState;
  fileName: string;
  onProtect: () => void;
  onReset: () => void;
  showAfter: boolean;
  onShowAfter: (v: boolean) => void;
}

/** Protect tab: the model downloads by itself, one button protects, the result is a new file. */
export function ProtectPanel({ state, fileName, onProtect, onReset, showAfter, onShowAfter }: Props) {
  const base = fileName.replace(/\.[^.]+$/, '') || 'photo';
  return (
    <div data-testid="protect-panel" className="flex flex-col gap-4">
      <header className="hidden px-1 lg:block">
        <h2 className="text-xl font-semibold tracking-[-0.015em]">Protect from AI edits</h2>
        <p className="mt-1 text-sm text-muted text-pretty">
          Adds a pattern you can’t see that is designed to make AI photo editors produce broken results when someone tries to change your photo.
        </p>
      </header>

      <section className="card overflow-hidden">
        <div className="flex items-start gap-3 p-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[#efe7fd] text-[#7a3fe0]">
            <ShieldCheck size={24} weight="duotone" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{state.status === 'done' ? 'Protected copy ready' : 'Protect this photo'}</p>
            <p className="mt-0.5 text-sm text-muted">
              {state.status === 'done'
                ? `Done in ${(state.ms / 1000).toFixed(1)} s on this device (${state.backend === 'webgpu' ? 'GPU' : 'CPU'}).`
                : 'Runs on this device. Your original stays as it is; you get a new file.'}
            </p>
          </div>
        </div>

        {state.status === 'downloading' && (
          <div className="px-5 pb-5" role="status">
            <div className="flex justify-between text-xs text-muted">
              <span>Getting the protection model</span>
              <span className="tabular">{MB(state.loaded)} of {MB(state.total)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-[#7a3fe0] transition-[width] duration-200" style={{ width: `${Math.min(100, (state.loaded / state.total) * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-faint">Downloaded once, checked against its fingerprint, then kept for next time.</p>
          </div>
        )}

        {state.status === 'protecting' && (
          <div className="px-5 pb-5" role="status">
            <div className="h-2 overflow-hidden rounded-full bg-raised">
              <div className="skeleton h-full w-2/3 rounded-full bg-[#7a3fe0]" />
            </div>
            <p className="mt-2 text-sm text-muted">{state.step}…</p>
          </div>
        )}

        {(state.status === 'idle' || state.status === 'ready') && (
          <div className="px-5 pb-5">
            <button type="button" onClick={onProtect} className="btn btn-primary w-full !bg-[#7a3fe0] hover:!bg-[#6830c9]">
              <ShieldCheck size={18} weight="bold" aria-hidden />
              Protect photo
            </button>
            <p className="mt-2 text-center text-xs text-faint">{state.status === 'ready' ? 'Protection model ready.' : 'Preparing the protection model…'}</p>
          </div>
        )}

        {state.status === 'failed' && (
          <div className="px-5 pb-5" role="alert">
            <p className="flex items-start gap-2 rounded-control bg-alert-bg p-3 text-sm text-alert-ink">
              <WarningCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
              {state.message}
            </p>
            <button type="button" onClick={onProtect} className="btn btn-tonal mt-3 w-full">Try again</button>
          </div>
        )}

        {state.status === 'done' && (
          <div className="grid gap-4 px-5 pb-5">
            <div className="grid grid-cols-2 rounded-control bg-raised p-1" role="group" aria-label="Show on the photo">
              {[false, true].map((after) => (
                <button
                  key={String(after)}
                  type="button"
                  aria-pressed={showAfter === after}
                  onClick={() => onShowAfter(after)}
                  className={`h-10 rounded-[9px] text-sm font-semibold transition-colors ${showAfter === after ? 'bg-panel shadow-[var(--shadow-card)]' : 'text-muted'}`}
                >
                  {after ? 'Protected' : 'Original'}
                </button>
              ))}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-control bg-raised p-3">
                <dt className="text-xs text-faint">Visible change (PSNR)</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold">{Number.isFinite(state.psnr) ? `${state.psnr.toFixed(1)} dB` : '∞'}</dd>
              </div>
              <div className="rounded-control bg-raised p-3">
                <dt className="text-xs text-faint">Similarity (SSIM)</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold">{state.ssim.toFixed(3)}</dd>
              </div>
            </dl>
            <button type="button" onClick={() => save(state.bytes, `${base}-protected.png`)} className="btn btn-primary w-full !bg-[#7a3fe0] hover:!bg-[#6830c9]">
              <DownloadSimple size={18} weight="bold" aria-hidden />
              Save protected copy
            </button>
            <button type="button" onClick={onReset} className="btn btn-tonal w-full">
              <ArrowCounterClockwise size={18} aria-hidden />
              Start over
            </button>
            <p className="truncate font-mono text-[11px] text-faint" title={state.sha256}>SHA-256 {state.sha256}</p>
          </div>
        )}
      </section>

      <section className="card p-5 text-sm">
        <p className="font-semibold">What to expect</p>
        <ul className="mt-2 grid gap-1.5 text-muted">
          <li>Higher PSNR means the change is harder to see; above 40 dB is usually invisible.</li>
          <li>Experimental: it targets one family of AI editors (Stable Diffusion inpainting). It is not a guarantee.</li>
          <li>Re-saving, cropping or screenshots can weaken it.</li>
        </ul>
      </section>
    </div>
  );
}
