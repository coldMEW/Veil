import { saveCleanCopy } from '../../lib/native/platform';
import { motion } from 'motion/react';
import {
  ArrowCounterClockwise,
  Broom,
  CheckCircle,
  DownloadSimple,
  MagnifyingGlass,
  StopCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import type { PrivacyCategory } from '../../contracts';
import { rowReveal } from '../../components/ResultCard';
import type { CleanState, FillMethod } from './useClean';

const CATEGORY: Record<PrivacyCategory, string> = {
  address: 'Address',
  plate: 'Licence plate',
  email: 'Email',
  phone: 'Phone number',
  face: 'Face',
  room_or_id_number: 'Room or ID number',
  other_text: 'Other text',
  manual: 'Marked by you',
};

const ghost =
  'inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium transition-[color,border-color,transform] duration-200 hover:border-gold/60 hover:text-gold active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40';
const primary =
  'inline-flex h-11 items-center gap-2 rounded-full bg-gold px-5 text-sm font-semibold text-gold-ink transition-transform duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40';

interface Props {
  state: CleanState;
  fileName: string;
  method: FillMethod;
  onMethod: (m: FillMethod) => void;
  onScan: () => void;
  onCancel: () => void;
  onToggle: (id: string) => void;
  onAll: (selected: boolean) => void;
  onClean: () => void;
  onBack: () => void;
  showAfter: boolean;
  onShowAfter: (v: boolean) => void;
}



export function CleanFlow(p: Props) {
  const { state } = p;
  const base = p.fileName.replace(/\.[^.]+$/, '');

  if (state.status === 'idle') {
    return (
      <motion.div variants={rowReveal} className="mt-7">
        <h2 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em]">Clean</h2>
        <p className="mt-2 text-muted text-pretty">
          Find text that could identify you, choose what to remove, then save a fresh copy without camera or location data.
        </p>
        <button type="button" onClick={p.onScan} className={`${primary} mt-5`}>
          <MagnifyingGlass size={16} weight="bold" aria-hidden />
          Find private text
        </button>
        <p className="mt-2 text-xs text-faint">Runs on this device. The first run downloads the text models once.</p>
      </motion.div>
    );
  }

  if (state.status === 'scanning' || state.status === 'cleaning') {
    const label =
      state.status === 'cleaning'
        ? state.step
        : state.progress
          ? `${state.progress.stage === 'detect' ? 'Looking for text' : 'Reading text'}: ${state.progress.completed} of ${state.progress.total}`
          : 'Loading the text models';
    const frac = state.status === 'scanning' && state.progress ? state.progress.completed / Math.max(1, state.progress.total) : 0.08;
    return (
      <div className="mt-7" role="status" aria-live="polite">
        <p className="font-medium">{label}…</p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised">
          <motion.div className="h-full origin-left rounded-full bg-gold" initial={false} animate={{ scaleX: frac }} />
        </div>
        {state.status === 'scanning' && (
          <button type="button" onClick={p.onCancel} className={`${ghost} mt-4`}>
            <StopCircle size={16} aria-hidden />
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (state.status === 'failed') {
    return (
      <div className="mt-7" role="alert">
        <p className="flex items-start gap-1.5 text-danger">
          <WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
          {state.message}
        </p>
        <p className="mt-1 text-sm text-muted">Nothing was removed or saved.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={state.candidates ? p.onBack : p.onScan} className={ghost}>
            <ArrowCounterClockwise size={16} aria-hidden />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'review') {
    const selected = state.candidates.filter((c) => c.selected).length;
    return (
      <div className="mt-7">
        <h2 className="text-xl font-semibold tracking-[-0.025em]">
          {state.candidates.length ? `Found ${state.candidates.length} text region${state.candidates.length === 1 ? '' : 's'}` : 'No text found'}
        </h2>
        <p className="mt-1 text-sm text-muted text-pretty">
          {state.candidates.length
            ? 'Likely private details are pre-selected. Nothing is removed until you choose. Text that was not found here can still be in the photo.'
            : 'This scan found no text. That does not mean the photo has no private details.'}
        </p>
        {state.candidates.length > 0 && (
          <>
            <div className="mt-3 flex gap-3 text-sm">
              <button type="button" className="min-h-11 font-medium text-ink/80 hover:text-gold" onClick={() => p.onAll(true)}>
                Select all
              </button>
              <button type="button" className="min-h-11 font-medium text-ink/80 hover:text-gold" onClick={() => p.onAll(false)}>
                Select none
              </button>
            </div>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
              {state.candidates.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={c.selected}
                      onChange={() => p.onToggle(c.id)}
                      className="size-5 shrink-0 accent-[var(--color-gold)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{CATEGORY[c.category]}</span>
                      {c.text && <span className="block truncate font-mono text-xs text-muted">{c.text}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <fieldset className="mt-5">
              <legend className="text-sm font-semibold">How to remove it</legend>
              <div className="mt-2 grid gap-2">
                {(
                  [
                    ['migan_inpaint', 'Fill in the background', 'An on-device model paints over the text. The filled area is invented.'],
                    ['solid_redaction', 'Cover with solid blocks', 'Simple and predictable. The covered area is obvious.'],
                  ] as const
                ).map(([m, title, body]) => (
                  <label
                    key={m}
                    className={`flex cursor-pointer gap-3 rounded-2xl border p-3 ${p.method === m ? 'border-gold/70 bg-gold-soft' : 'border-line'}`}
                  >
                    <input type="radio" name="fill" checked={p.method === m} onChange={() => p.onMethod(m)} className="mt-1 accent-[var(--color-gold)]" />
                    <span>
                      <span className="block text-sm font-medium">{title}</span>
                      <span className="block text-xs text-muted">{body}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={p.onClean} disabled={selected === 0} className={primary}>
            <Broom size={16} weight="bold" aria-hidden />
            Remove {selected} selected
          </button>
          <button type="button" onClick={p.onScan} className={ghost}>
            <ArrowCounterClockwise size={16} aria-hidden />
            Scan again
          </button>
        </div>
      </div>
    );
  }

  // done
  const clear = state.rescan.stillDetected.length === 0;
  return (
    <div className="mt-7">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.025em]">
        {clear ? (
          <CheckCircle size={22} weight="bold" className="text-fit" aria-hidden />
        ) : (
          <WarningCircle size={22} weight="bold" className="text-misfit" aria-hidden />
        )}
        Fresh copy ready
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-muted">
        <li>
          {clear
            ? `This re-scan no longer detects the selected text (${state.selectedCount} region${state.selectedCount === 1 ? '' : 's'}). That is not a guarantee that all private information is gone.`
            : `This re-scan still detects text in ${state.rescan.stillDetected.length} of ${state.selectedCount} selected regions. Review before sharing.`}
        </li>
        <li>
          {state.metadataBlocks.length === 0
            ? 'The new file has no camera, location or other metadata blocks.'
            : `The new file still has metadata: ${state.metadataBlocks.join(', ')}.`}
        </li>
        <li>{state.method === 'migan_inpaint' ? 'The removed areas were filled in by a model; those pixels are invented.' : 'The removed areas are covered with solid blocks.'}</li>
        {state.fellBack && <li className="text-misfit">{state.fellBack}</li>}
      </ul>
      <div className="mt-4 rounded-2xl border border-line bg-raised px-4 py-2.5">
        <p className="text-xs text-faint">SHA-256 of the new file</p>
        <p className="truncate font-mono text-[13px] text-ink/90" title={state.sha256}>
          {state.sha256}
        </p>
      </div>
      <div className="mt-4 inline-flex rounded-full border border-line p-1" role="group" aria-label="Compare">
        {([false, true] as const).map((after) => (
          <button
            key={String(after)}
            type="button"
            aria-pressed={p.showAfter === after}
            onClick={() => p.onShowAfter(after)}
            className={`h-9 rounded-full px-4 text-sm font-medium ${p.showAfter === after ? 'bg-gold text-gold-ink' : 'text-muted'}`}
          >
            {after ? 'After' : 'Before'}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void saveCleanCopy(state.bytes, `${base}-clean.png`).catch((e) => alert(String(e)))} className={primary}>
          <DownloadSimple size={16} weight="bold" aria-hidden />
          Save clean copy
        </button>
        <button type="button" onClick={p.onBack} className={ghost}>
          <ArrowCounterClockwise size={16} aria-hidden />
          Change selection
        </button>
      </div>
    </div>
  );
}
